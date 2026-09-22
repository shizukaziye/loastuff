/**
 * dp-extract.js — the exact finished-gem distribution, no dice.
 *
 *   node tools/dp-extract.js --rarity=epic --cost=10 --pair=0 --baseline=80 \
 *        --gpd=1000000 --mode=game --out=...
 *   node tools/dp-extract.js --mode=mirror --identity     (the zero-noise check)
 *
 * Forward-propagates the astrogem calculator's own cutting DP into the exact
 * probability of every finished gem — 3,750 configs plus the dismantled atom —
 * and the expected gold to get there. Implements docs/research/
 * dp-extractor-design.md; every rule cited there is followed literally, and
 * the design doc is the reference for WHY each piece looks the way it does.
 *
 * Two modes, two jobs:
 *
 *   game    sequential-proportional draw (what the game and cutOneGem do),
 *           decide()'s gate and tie order, gold at procCostAt — the ledger
 *           prices. This is the published answer.
 *   mirror  conditional-Bernoulli draw, no Reset, _emax's tie-to-K, gold at
 *           solver.procCost. In this mode the tower property gives an exact
 *           identity against solver.W — the validation with no error bar:
 *
 *              sum_c P(c)*gemValue(c) - E[gold]  ==  W(fresh)
 *
 * The draw layer is modelled exactly: the 4-unique-then-25% pick is worth
 * half the S-band, and the tempting per-possibility shortcut understates
 * P(grade >= 90) by 52% (design doc §3.3, measured).
 */
"use strict";
var REPO = "C:/Users/Shizu/loastuff/loa-astrogem-calc";
var A = require(REPO + "/model/astrogem.js");

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) ARGS[m[1]] = m[2] === undefined ? true : m[2];
});

var RARITY = String(ARGS.rarity || "epic");
if (!A.RARITY[RARITY]) throw new Error("unknown rarity " + RARITY);
// trap 8: cut-engine holds a live reference to A.RARITY.epic
A.RARITY.epic.maxTurns = A.RARITY[RARITY].maxTurns;
A.RARITY.epic.maxRerolls = A.RARITY[RARITY].maxRerolls;

var DP = require(REPO + "/model/dp.js");
var Engine = require(REPO + "/tools/lib/cut-engine.js");

// Laws depend only on levels, cm and the turn flag — never on names or cost —
// so one global cache serves every cell of every cost, pair and baseline.
var globalLawCache = {}, globalLawOrder = [];

/**
 * One exact cell. opts: { rarity, cost, pair, baseline, gpd, roster, axis,
 * mode ("game"|"mirror"), allowReset, solver? } — pass `solver` to share one
 * DP memo across the 18 cells of a (baseline, gpd) block.
 */
function extract(opts) {
var COST = opts.cost;
var BASELINE = opts.baseline;
var GPD = opts.gpd;
var ROSTER = opts.roster !== false;
var AXIS = opts.axis || "support";
var MODE = opts.mode || "game";
var T = A.RARITY[RARITY].maxTurns;
var MAXR0 = A.RARITY[RARITY].maxRerolls;
var ALLOW_RESET = MODE === "mirror" ? false : (opts.allowReset !== false);

var POOL = A.EFFECT_POOLS[COST];
var PAIRS = [];
for (var pi = 0; pi < POOL.length; pi++)
  for (var pj = pi + 1; pj < POOL.length; pj++) PAIRS.push([pi, pj]);
var START_PAIR = opts.pair || 0;

var solver = opts.solver || new DP.Solver(
  AXIS === "support" ? A.supportGradeToScore(BASELINE) : A.gradeToScore ? A.gradeToScore(BASELINE) : BASELINE,
  GPD, ROSTER, { axis: AXIS, maxTurns: T });

// ---- config indexing: (wp, ord, pairSlot, lvlA, lvlB), 3750 dense ----------
var NCFG = 5 * 5 * 6 * 5 * 5;
var pairSlotByNames = {};
PAIRS.forEach(function (p, s) {
  pairSlotByNames[POOL[p[0]] + "|" + POOL[p[1]]] = { slot: s, flip: false };
  pairSlotByNames[POOL[p[1]] + "|" + POOL[p[0]]] = { slot: s, flip: true };
});
function idxOfCfg(c) {
  var k = pairSlotByNames[c.effect1 + "|" + c.effect2];
  if (!k) throw new Error("pair not in pool: " + c.effect1 + "/" + c.effect2);
  var la = k.flip ? c.effect2Level : c.effect1Level;
  var lb = k.flip ? c.effect1Level : c.effect2Level;
  return (((c.willpowerLevel - 1) * 5 + (c.orderLevel - 1)) * 6 + k.slot) * 25 +
    (la - 1) * 5 + (lb - 1);
}
var CFG = new Array(NCFG);
for (var ci = 0; ci < NCFG; ci++) {
  var lb0 = ci % 5, la0 = ((ci / 5) | 0) % 5, sl = ((ci / 25) | 0) % 6;
  var ord0 = ((ci / 150) | 0) % 5, wp0 = ((ci / 750) | 0) % 5;
  CFG[ci] = { baseCost: COST, gemType: "order",
    willpowerLevel: wp0 + 1, orderLevel: ord0 + 1,
    effect1: POOL[PAIRS[sl][0]], effect1Level: la0 + 1,
    effect2: POOL[PAIRS[sl][1]], effect2Level: lb0 + 1 };
}
function freshIdx(slot) { return (((0) * 5 + 0) * 6 + slot) * 25; }

// ---- state indexing --------------------------------------------------------
var RMAX = MAXR0 + 2 * T + 1;                      // reroll ceiling, inclusive
var NT = T + 1, NM = 3, NU = 2;
function sIdx(ci2, t, r, mi, u) {
  return ((((ci2 * NT) + t) * RMAX + r) * NM + mi) * NU + u;
}
var NS = NCFG * NT * RMAX * NM * NU;
var mass = new Float64Array(NS), goldM = new Float64Array(NS), gold2M = new Float64Array(NS);

// ---- W cache: dp.js's own values, dense ------------------------------------
var Wc = new Float64Array(NCFG * NT * RMAX * NM).fill(NaN);
function W(ci2, t, r, cm) {
  if (r >= RMAX) r = RMAX - 1;
  var k = ((ci2 * NT + t) * RMAX + r) * NM + (cm / 100 + 1);
  var v = Wc[k];
  if (v === v) return v;
  v = solver.W(CFG[ci2], t, r, cm);
  Wc[k] = v;
  return v;
}

// ---- possibilities + branches per (configIdx, cmIdx, tFlag) ----------------
var possCache = {};
function possFor(ci2, cm, t) {
  var tf = t <= 1 ? 1 : 0;
  var key = ci2 * 6 + (cm / 100 + 1) * 2 + tf;
  var got = possCache[key];
  if (got) return got;
  var c = CFG[ci2];
  var op = A.outcomeProbabilities({
    config: c, processCostMultiplier: cm, turnsRemaining: t
  });
  var list = op.possibilities.map(function (p) {
    // the raw table row must become the advisor's outcome shape first —
    // without this, change_side_option degrades to do_nothing and no gem
    // ever escapes a dead pair (which is how this bug announced itself:
    // every finished support gem on Boss/Add graded under 70)
    var brs = DP.outcomeBranchesActual(c, Engine.toAdvisorOutcome(p));
    return { prob: p.prob,
      b: brs.map(function (b) {
        return { ci: idxOfCfg(b.config), dR: b.dRerolls || 0, dCm: b.dCm || 0,
          w: b.w != null ? b.w : (b.weight != null ? b.weight : 1) };
      }) };
  });
  possCache[key] = list;
  return list;
}

// ---- draw-class laws -------------------------------------------------------
// class key: the four LEVELS + cm + the t<=1 flag; the law never reads names.
var lawCache = globalLawCache, lawOrder = globalLawOrder;
function lawFor(c, cm, t, probs) {
  var tf = t <= 1 ? 1 : 0;
  var key = MODE + ":" + c.willpowerLevel + "," + c.orderLevel + "," +
    c.effect1Level + "," + c.effect2Level + "," + cm + "," + tf;
  var got = lawCache[key];
  if (got) return got;
  var n = probs.length;
  var subs = { a: [], b: [], c: [], d: [], p: [] };
  if (MODE === "mirror") {
    // conditional Bernoulli: P(O) proportional to the product of p_i
    var tot = 0, i, j, k, l;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++)
      for (k = j + 1; k < n; k++) for (l = k + 1; l < n; l++) {
        var w = probs[i] * probs[j] * probs[k] * probs[l];
        subs.a.push(i); subs.b.push(j); subs.c.push(k); subs.d.push(l);
        subs.p.push(w); tot += w;
      }
    for (i = 0; i < subs.p.length; i++) subs.p[i] /= tot;
  } else {
    // sequential-proportional without replacement, collapsed over order.
    // For subset {i,j,k,l} the 24 orderings share numerator w_i w_j w_k w_l
    // and chain denominators S, S-x, S-x-y, R+u (R = S minus the subset) —
    // summed with scalars only. The recursive version allocated two arrays
    // per node (~1M per class) and turned a 16ms law into minutes.
    var S = 0, i4, j4, k4, l4;
    for (i4 = 0; i4 < n; i4++) S += probs[i4];
    var w4 = [0, 0, 0, 0];
    for (i4 = 0; i4 < n; i4++) for (j4 = i4 + 1; j4 < n; j4++)
      for (k4 = j4 + 1; k4 < n; k4++) for (l4 = k4 + 1; l4 < n; l4++) {
        w4[0] = probs[i4]; w4[1] = probs[j4]; w4[2] = probs[k4]; w4[3] = probs[l4];
        var num = w4[0] * w4[1] * w4[2] * w4[3];
        if (num === 0) continue;
        var R = S - w4[0] - w4[1] - w4[2] - w4[3];
        var inv = 0;
        for (var f4 = 0; f4 < 4; f4++) for (var s4 = 0; s4 < 4; s4++) {
          if (s4 === f4) continue;
          var d1 = S - w4[f4], d2 = d1 - w4[s4];
          for (var t4 = 0; t4 < 4; t4++) {
            if (t4 === f4 || t4 === s4) continue;
            inv += 1 / (d1 * d2 * (R + w4[6 - f4 - s4 - t4]));
          }
        }
        subs.a.push(i4); subs.b.push(j4); subs.c.push(k4); subs.d.push(l4);
        subs.p.push(num / S * inv);
      }
  }
  var out = {
    a: Uint8Array.from(subs.a), b: Uint8Array.from(subs.b),
    c: Uint8Array.from(subs.c), d: Uint8Array.from(subs.d),
    p: Float64Array.from(subs.p),
    incl: new Float64Array(n)                       // P(i in O)
  };
  for (var z = 0; z < out.p.length; z++) {
    out.incl[out.a[z]] += out.p[z]; out.incl[out.b[z]] += out.p[z];
    out.incl[out.c[z]] += out.p[z]; out.incl[out.d[z]] += out.p[z];
  }
  lawCache[key] = out;
  lawOrder.push(key);
  if (lawOrder.length > 500) delete lawCache[lawOrder.shift()];
  return out;
}

// ---- absorbers -------------------------------------------------------------
var fin = new Float64Array(NCFG), finG = new Float64Array(NCFG), finG2 = new Float64Array(NCFG);
var dis = 0, disG = 0, disG2 = 0;
var resetBucket = new Array(6).fill(null).map(function () { return { m: 0, g: 0, g2: 0 }; });

function push(arrM, arrG, arrG2, at, fm, fg, fg2, price) {
  arrM[at] += fm;
  arrG[at] += fg + price * fm;
  arrG2[at] += fg2 + 2 * price * fg + price * price * fm;
}
function absorbFinal(ci2, fm, fg, fg2) { fin[ci2] += fm; finG[ci2] += fg; finG2[ci2] += fg2; }

// ---- the forward pass ------------------------------------------------------
var t0 = process.hrtime.bigint();
var seedU = ALLOW_RESET ? 0 : 1;
mass[sIdx(freshIdx(START_PAIR), T, MAXR0, 1, seedU)] = 1;

var vBuf = new Float64Array(32), G = new Float64Array(32);

for (var phase = seedU; phase <= 1; phase++) {
  if (phase === 1 && ALLOW_RESET) {
    for (var s5 = 0; s5 < 6; s5++) {
      var bk = resetBucket[s5];
      if (!bk.m) continue;
      var at5 = sIdx(freshIdx(s5), T, MAXR0, 1, 1);
      mass[at5] += bk.m; goldM[at5] += bk.g; gold2M[at5] += bk.g2;
    }
  }
  for (var t = T; t >= 1; t--) {
    var rCeil = Math.min(RMAX - 1, MAXR0 + 2 * (T - t));
    for (var r = rCeil; r >= 0; r--) {
      for (var mi = 0; mi < NM; mi++) {
        var cm = (mi - 1) * 100;
        for (var ci3 = 0; ci3 < NCFG; ci3++) {
          var at = sIdx(ci3, t, r, mi, phase);
          var m0 = mass[at];
          if (m0 <= 0) continue;
          var g0 = goldM[at], g20 = gold2M[at];
          mass[at] = 0; goldM[at] = 0; gold2M[at] = 0;

          var c = CFG[ci3];
          var fresh = (t === T);
          var poss = possFor(ci3, cm, t);
          var n = poss.length;
          var probs = poss.map(function (p) { return p.prob; });

          // v_i: branch-averaged continuation, dp.js's own W
          for (var i = 0; i < n; i++) {
            var v = 0, bs = poss[i].b;
            for (var b2 = 0; b2 < bs.length; b2++) {
              var br = bs[b2];
              v += br.w * W(br.ci, t - 1, Engine.clampR(r + br.dR), Engine.clampCm(cm + br.dCm));
            }
            vBuf[i] = v;
          }

          var pcDec = solver.procCost(cm);
          var C = fresh ? 0 : solver.gemValue(c);
          var R = (r >= 1 && !fresh)
            ? -(r === 1 ? A.COSTS.finalReroll : 0) + W(ci3, t, r - 1, cm)
            : -Infinity;
          var Z = -Infinity;
          if (phase === 0 && !fresh)
            Z = -A.COSTS.reset + W(freshIdx(pairSlotByNames[c.effect1 + "|" + c.effect2].slot), T, MAXR0, 0);

          // the gate collapsed to (threshold, strictness, fallback) — §3.2
          var theta, strict = false, alpha;
          if (MODE === "mirror") {
            theta = Math.max(C, R); strict = true;          // ties to K, per _emax
            alpha = R >= C ? "reroll" : "complete";
          } else if (fresh || phase === 1 || Z === -Infinity) {
            theta = Math.max(R, C);
            alpha = R >= C ? "reroll" : "complete";
          } else if (t === 1) {
            theta = Math.max(R, C, Z);
            alpha = Z > Math.max(R, C) ? "reset" : (R >= C ? "reroll" : "complete");
          } else if (C < R) {
            theta = R; alpha = "reroll";
          } else if (Z > C) {
            theta = C; strict = true; alpha = "reset";
          } else {
            theta = C; alpha = C > R ? "complete" : "reroll";
          }
          var T4 = 4 * (theta + pcDec);

          // always-process shortcut: if the worst four already clear, F = 1
          var law = null, F = 0;
          var sorted = vBuf.slice(0, n);
          Array.prototype.sort.call(sorted, function (x, y) { return x - y; });
          var worst4 = sorted[0] + sorted[1] + sorted[2] + sorted[3];
          if (strict ? worst4 > T4 : worst4 >= T4) {
            law = lawFor(c, cm, t, probs);
            F = 1;
            for (var i5 = 0; i5 < n; i5++) G[i5] = law.incl[i5];
          } else {
            law = lawFor(c, cm, t, probs);
            for (var z0 = 0; z0 < n; z0++) G[z0] = 0;
            for (var z = 0; z < law.p.length; z++) {
              var S = vBuf[law.a[z]] + vBuf[law.b[z]] + vBuf[law.c[z]] + vBuf[law.d[z]];
              if (strict ? S > T4 : S >= T4) {
                var pz = law.p[z];
                F += pz;
                G[law.a[z]] += pz; G[law.b[z]] += pz;
                G[law.c[z]] += pz; G[law.d[z]] += pz;
              }
            }
          }

          // process branch
          if (F > 0) {
            var priceP = MODE === "mirror" ? solver.procCost(cm) : Engine.procCostAt(cm);
            for (var i3 = 0; i3 < n; i3++) {
              var qi = G[i3] / 4;
              if (qi <= 0) continue;
              var bs3 = poss[i3].b;
              for (var b3 = 0; b3 < bs3.length; b3++) {
                var br3 = bs3[b3];
                var f = qi * br3.w;
                var dst = sIdx(br3.ci, t - 1, Engine.clampR(r + br3.dR),
                  Engine.clampCm(cm + br3.dCm) / 100 + 1, phase);
                push(mass, goldM, gold2M, dst, f * m0, f * g0, f * g20, priceP);
              }
            }
          }

          // fallback branch, weight 1 - F
          var fr = 1 - F;
          if (fr > 1e-15) {
            var fm = fr * m0, fg = fr * g0, fg2 = fr * g20;
            if (alpha === "reroll") {
              var priceR = r === 1 ? A.COSTS.finalReroll : 0;
              push(mass, goldM, gold2M, sIdx(ci3, t, r - 1, mi, phase), fm, fg, fg2, priceR);
            } else if (alpha === "reset") {
              var slot = pairSlotByNames[c.effect1 + "|" + c.effect2].slot;
              resetBucket[slot].m += fm;
              resetBucket[slot].g += fg + A.COSTS.reset * fm;
              resetBucket[slot].g2 += fg2 + 2 * A.COSTS.reset * fg + A.COSTS.reset * A.COSTS.reset * fm;
            } else if (fresh) {
              dis += fm; disG += fg; disG2 += fg2;   // dismantled unprocessed
            } else {
              absorbFinal(ci3, fm, fg, fg2);
            }
          }
        }
      }
    }
  }
  // t = 0: forced complete
  for (var ci4 = 0; ci4 < NCFG; ci4++) {
    for (var r4 = 0; r4 < RMAX; r4++) for (var mi4 = 0; mi4 < NM; mi4++) {
      var at4 = sIdx(ci4, 0, r4, mi4, phase);
      if (mass[at4] > 0) {
        absorbFinal(ci4, mass[at4], goldM[at4], gold2M[at4]);
        mass[at4] = 0; goldM[at4] = 0; gold2M[at4] = 0;
      }
    }
  }
  if (!ALLOW_RESET) break;
}

// ---- results ---------------------------------------------------------------
var totM = dis, totG = disG;
for (var cf = 0; cf < NCFG; cf++) { totM += fin[cf]; totG += finG[cf]; }
var secs = Number(process.hrtime.bigint() - t0) / 1e9;

return { fin: fin, finG: finG, finG2: finG2, dis: dis, disG: disG, disG2: disG2,
  totM: totM, totG: totG, secs: secs, CFG: CFG, NCFG: NCFG, solver: solver,
  freshCfg: CFG[freshIdx(START_PAIR)], T: T, MAXR0: MAXR0, POOL: POOL, PAIRS: PAIRS };
}

/** The 3,750-config table for a cost, in the extractor's canonical order. */
function buildCfgTable(cost) {
  var POOL = A.EFFECT_POOLS[cost], PAIRS = [];
  for (var i = 0; i < POOL.length; i++)
    for (var j = i + 1; j < POOL.length; j++) PAIRS.push([i, j]);
  var CFG = new Array(3750);
  for (var ci = 0; ci < 3750; ci++) {
    var lb = ci % 5, la = ((ci / 5) | 0) % 5, sl = ((ci / 25) | 0) % 6;
    var ord = ((ci / 150) | 0) % 5, wp = ((ci / 750) | 0) % 5;
    CFG[ci] = { baseCost: cost, gemType: "order",
      willpowerLevel: wp + 1, orderLevel: ord + 1,
      effect1: POOL[PAIRS[sl][0]], effect1Level: la + 1,
      effect2: POOL[PAIRS[sl][1]], effect2Level: lb + 1 };
  }
  return CFG;
}

module.exports = { extract: extract, buildCfgTable: buildCfgTable };

if (require.main !== module) return;

// ---- CLI --------------------------------------------------------------------
var COST = parseInt(ARGS.cost, 10) || 10;
var MODE = String(ARGS.mode || "game");
var AXIS = String(ARGS.axis || "support");
var res = extract({ rarity: RARITY, cost: COST, pair: parseInt(ARGS.pair, 10) || 0,
  baseline: ARGS.baseline != null ? parseFloat(ARGS.baseline) : 80,
  gpd: parseInt(ARGS.gpd, 10) || 1000000,
  roster: ARGS.roster !== "false", axis: AXIS, mode: MODE,
  allowReset: ARGS.reset !== "false" });
var fin = res.fin, finG = res.finG, finG2 = res.finG2, dis = res.dis;
var totM = res.totM, totG = res.totG, secs = res.secs;
var CFG = res.CFG, NCFG = res.NCFG, solver = res.solver;
var POOL = res.POOL, PAIRS = res.PAIRS;
var START_PAIR = parseInt(ARGS.pair, 10) || 0;
var T = res.T, MAXR0 = res.MAXR0;
var GPD = parseInt(ARGS.gpd, 10) || 1000000;
var BASELINE = ARGS.baseline != null ? parseFloat(ARGS.baseline) : 80;
var ROSTER = ARGS.roster !== "false";
var ALLOW_RESET = MODE === "mirror" ? false : (ARGS.reset !== "false");

console.log(MODE + "  " + RARITY + " c" + COST + " pair " + POOL[PAIRS[START_PAIR][0]] +
  "/" + POOL[PAIRS[START_PAIR][1]] + "  baseline " + BASELINE + "  gpd " + GPD +
  "  roster " + ROSTER);
console.log("mass " + totM.toFixed(12) + "   E[gold] " + totG.toFixed(4) +
  "   P(dismantled) " + dis.toFixed(6) + "   " + secs.toFixed(1) + "s");

if (ARGS.identity || MODE === "mirror") {
  var ev = 0;
  for (var cf2 = 0; cf2 < NCFG; cf2++) if (fin[cf2] > 0) ev += fin[cf2] * solver.gemValue(CFG[cf2]);
  var lhs = ev - totG;
  var rhs = solver.W(res.freshCfg, T, MAXR0, 0);
  var rel = Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs));
  console.log("IDENTITY  sum P*value - E[gold] = " + lhs.toFixed(9) +
    "   W(fresh) = " + rhs.toFixed(9) + "   rel err " + rel.toExponential(3) +
    (rel < 1e-9 ? "   PASS" : "   FAIL"));
}

if (AXIS === "support") {
  var bands = [70, 80, 86.7, 90, 93.3];
  var line = bands.map(function (cut) {
    var p = 0;
    for (var cf3 = 0; cf3 < NCFG; cf3++)
      if (fin[cf3] > 0 && A.supportGrade(CFG[cf3]) >= cut) p += fin[cf3];
    return "P(>=" + cut + ") " + p.toExponential(4);
  }).join("   ");
  console.log(line);
}

// --mc=N: cut N gems with cutOneGem from the same start under the same solver
// and compare — game mode only, the sequential law is what the simulator runs.
// Tolerance shape from verify-dp: pass if within max(2%, 4 sigma, floor).
if (ARGS.mc && MODE === "game") {
  var NMC = parseInt(ARGS.mc, 10) || 50000;
  var rand = Engine.mulberry32(Engine.fnv1a("dpx-mc:" + RARITY + COST + BASELINE + GPD));
  var pairCfg = { baseCost: COST, gemType: "order",
    effect1: POOL[PAIRS[START_PAIR][0]], effect2: POOL[PAIRS[START_PAIR][1]] };
  var mcGold = 0, mcGold2 = 0, mcDis = 0, mcDmg = 0, mcFin = 0;
  var bandsMC = [70, 80, 86.7, 90], mcHit = [0, 0, 0, 0];
  for (var g5 = 0; g5 < NMC; g5++) {
    var res = Engine.cutOneGem(solver, pairCfg, rand, ALLOW_RESET);
    mcGold += res.spent; mcGold2 += res.spent * res.spent;
    if (res.processes > 0) {
      mcFin++;
      if (AXIS === "support") {
        mcDmg += A.supportDamage(res.cfg);
        var gr = A.supportGrade(res.cfg);
        for (var bq = 0; bq < bandsMC.length; bq++) if (gr >= bandsMC[bq]) mcHit[bq]++;
      }
    } else mcDis++;
  }
  var exDmg = 0, exFin2 = 0;
  var exHit = [0, 0, 0, 0];
  for (var cf5 = 0; cf5 < NCFG; cf5++) {
    if (fin[cf5] <= 0) continue;
    exFin2 += fin[cf5];
    exDmg += fin[cf5] * A.supportDamage(CFG[cf5]);
    var gr2 = A.supportGrade(CFG[cf5]);
    for (var bq2 = 0; bq2 < bandsMC.length; bq2++) if (gr2 >= bandsMC[bq2]) exHit[bq2] += fin[cf5];
  }
  function cmp(name, exact, mcMean, mcSd, floor) {
    var se = mcSd / Math.sqrt(NMC);
    var d = Math.abs(exact - mcMean);
    var tol = Math.max(0.02 * Math.abs(mcMean), 4 * se, floor);
    var sig = se > 0 ? (d / se).toFixed(2) : "-";
    console.log("  " + name.padEnd(22) + "exact " + exact.toPrecision(6).padStart(12) +
      "   mc " + mcMean.toPrecision(6).padStart(12) + "   " + sig + " sigma   " +
      (d <= tol ? "PASS" : "FAIL"));
  }
  console.log("MC comparison, N = " + NMC.toLocaleString());
  var gM = mcGold / NMC, gSd = Math.sqrt(Math.max(0, mcGold2 / NMC - gM * gM));
  cmp("E[gold]", totG, gM, gSd, 50);
  cmp("P(dismantled)", dis, mcDis / NMC, Math.sqrt(mcDis / NMC * (1 - mcDis / NMC)), 2e-5);
  if (AXIS === "support" && mcFin > 0) {
    cmp("mean supportDamage", exDmg / exFin2, mcDmg / mcFin, 0.05, 1e-4);
    for (var bq3 = 0; bq3 < bandsMC.length; bq3++) {
      var pm = mcHit[bq3] / NMC;
      cmp("P(grade>=" + bandsMC[bq3] + ")", exHit[bq3], pm, Math.sqrt(pm * (1 - pm)), 2e-5);
    }
  }
}

if (ARGS.out) {
  require("fs").writeFileSync(String(ARGS.out), JSON.stringify({
    mode: MODE, rarity: RARITY, cost: COST, pair: START_PAIR, baseline: BASELINE,
    gpd: GPD, roster: ROSTER, axis: AXIS, sig: A.MODEL_SIG,
    mass: totM, eGold: totG, dismantled: { m: dis, g: disG, g2: disG2 },
    fin: Array.from(fin), finG: Array.from(finG), finG2: Array.from(finG2)
  }));
  console.log("wrote " + ARGS.out);
}
