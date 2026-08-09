/**
 * account-study.js — synthetic-account study: what should you cut at each stage?
 *
 * Design (Shizu interview, 2026-08-08):
 *   Three economy tiers, each with its own DP cutting policy and collection size
 *   (sized so ~6 of the socketed 12 land above the tier baseline; from the DP's
 *   own pAbove: 6/p at the 60/30/10 mix):
 *     T1: gpd 1.5M, baseline grade 70, N=120   (72 c8 / 36 c9 / 12 c10)
 *     T2: gpd 3.0M, baseline grade 75, N=230   (138 / 69 / 23)
 *     T3: gpd 5.0M, baseline grade 80, N=420   (252 / 126 / 42)
 *
 *   Per account (10,000 per tier):
 *     1. Cut N epic ORDER gems (advisor DP policy at the tier's baseline/gpd,
 *        advisor-style resets, uniform random pairs). KEEP only grade >= 55 (B-).
 *     2. Pack 12 kept gems into 3 order cores, 17 willpower supply each,
 *        maximizing the BANDED raw grid damage (below).
 *     3. Roster analysis: raw-optimal roster vs top-12-by-grade — the
 *        "are we overrating cost-3 gems?" test.
 *     4. Phase 2 (revised 2026-08-08): per cost, 1,000 SINGLE-GEM experiments
 *        from the same base state — cut one gem (from the pre-cut tier bank,
 *        same policy), B- filter (a discard is an automatic no-gain, gold still
 *        spent), full-repack delta with that one gem added. Report p(gain),
 *        mean gain GIVEN a gain, and mean gold per single cut.
 *
 * BANDED grid damage (Shizu's order-floor answer): per core, by its order-point
 * total — 17+: no penalty (and the standard above-17 order bonus); 14–16: that
 * core's gems' effect levels count at 95% in the stat buckets; 10–13: 90%;
 * <=9: 85%. Interpretation: the penalty scales the core's own gems' bucket
 * contributions (core options amplify their own core).
 *
 * Packer: pool pruning + multi-seed greedy + swap local search; grouping of a
 * fixed 12 into cores is solved EXACTLY by anchored enumeration (5,775
 * partitions, cost-pruned). `--selftest` brute-forces small pools to verify.
 *
 * Usage:
 *   node tools/account-study.js --make-bank --tier=T1 --cost=8 [--size=100000] --out=<file>
 *   node tools/account-study.js --tier=T1 --banks=<dir> --from=0 --to=2500 --out=<file> [--progress]
 *   node tools/account-study.js --selftest
 *   node tools/account-study.js --screen-check --tier=T1 --banks=<dir> [--accounts=20]
 */
"use strict";

var fs = require("fs");
var A = require("../model/astrogem.js");
var DP = require("../model/dp.js");
var Engine = require("./lib/cut-engine.js");

var mulberry32 = Engine.mulberry32;
var fnv1a = Engine.fnv1a;
var cutOneGem = Engine.cutOneGem;

// ---------------- CLI ----------------
var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) ARGS[m[1]] = m[2] === undefined ? true : m[2];
});

var TIERS = {
  T1: { name: "T1", gpd: 1500000, bl: 70, counts: { 8: 72, 9: 36, 10: 12 } },
  T2: { name: "T2", gpd: 3000000, bl: 75, counts: { 8: 138, 9: 69, 10: 23 } },
  T3: { name: "T3", gpd: 5000000, bl: 80, counts: { 8: 252, 9: 126, 10: 42 } }
};
var KEEP_GRADE = 55;      // B- floor: anything below is discarded on the spot
var SINGLES = parseInt(ARGS.singles, 10) || 1000;   // single-gem experiments per cost
var CORE_SUPPLY = 17, CORES = 3, SLOTS = 4;
var BANKS = null;         // per-tier { 8: entries, 9: entries, 10: entries }

// ---------------- gem meta ----------------
var B = A.SCORING.baselines;
var BUCKETS = ["Attack Power", "Additional Damage", "Boss Damage"];
function bukTerm(name, lvl) {
  var s = name === "Attack Power" ? B.attackPower : name === "Additional Damage" ? B.additionalDamage : B.bossDamage;
  return Math.log((1 + s.other + lvl * (s.gridAdd / s.levels)) / (1 + s.other));
}
function gemMeta(cfg) {
  var atk = 0, add = 0, boss = 0;
  [[cfg.effect1, cfg.effect1Level], [cfg.effect2, cfg.effect2Level]].forEach(function (p) {
    if (p[0] === "Attack Power") atk += p[1];
    else if (p[0] === "Additional Damage") add += p[1];
    else if (p[0] === "Boss Damage") boss += p[1];
  });
  return {
    cfg: cfg,
    cost: A.willpowerCost(cfg.baseCost, cfg.willpowerLevel),
    order: cfg.orderLevel,
    atk: atk, add: add, boss: boss,
    rawLin: A.effectScore(cfg.effect1, cfg.effect1Level) + A.effectScore(cfg.effect2, cfg.effect2Level),
    grade: A.grade(cfg),
    empty: false
  };
}
var EMPTY = { cfg: null, cost: 0, order: 0, atk: 0, add: 0, boss: 0, rawLin: 0, grade: -1, empty: true };

// ---------------- banded grid damage ----------------
function bandPenalty(pts) {
  // 2026-08-09 (Shizu): doubled from -5/-10/-15 — under the soft bands the
  // packer parked one core at 14-16 in most accounts, while every real
  // endgame grid holds 17+ on all cores. These rates make sub-17 cores
  // essentially never optimal.
  if (pts >= 17) return 0;
  if (pts >= 14) return 0.10;
  if (pts >= 10) return 0.20;
  return 0.30;
}
// groups: array of 3 arrays of metas (each length <= 4)
// 2026-08-09 CORRECTED ATTACHMENT (Shizu): a sub-17 core's penalty hits the
// WHOLE character's damage (a core option is a global multiplier), not just
// that core's own gems — the old per-core-gems attachment made -5% worth
// ~0.03% total (a fifth of one order point) and the packer rightly ignored
// it. Now each sub-17 core multiplies TOTAL damage by (1 - band), so a
// 14-16 core costs 10% of everything — ~60 order points — and the packer
// forces 17 wherever the collection allows.
function damageOfGroups(groups) {
  var atk = 0, add = 0, boss = 0, d = 0, mult = 1;
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g], pts = 0, i;
    for (i = 0; i < grp.length; i++) pts += grp[i].order;
    mult *= (1 - bandPenalty(pts));
    for (i = 0; i < grp.length; i++) {
      atk += grp[i].atk; add += grp[i].add; boss += grp[i].boss;
    }
    d += Math.log(1 + B.order.perPoint * Math.max(0, pts - 17));
  }
  d += bukTerm("Attack Power", atk) + bukTerm("Additional Damage", add) + bukTerm("Boss Damage", boss);
  return 100 * d * mult;
}

// ---------------- exact grouping of a fixed 12 ----------------
// sel: array of exactly 12 metas (EMPTY-padded if needed). Returns
// { dmg, groups } for the best cost-feasible 4/4/4 partition, or null.
// Anchored enumeration kills the 3!-fold core symmetry: gem 0 is in group A;
// the lowest-index remaining gem is in group B.
function bestGrouping(sel) {
  var n = 12;
  var cost = new Float64Array(n), pts = new Float64Array(n);
  for (var i = 0; i < n; i++) { cost[i] = sel[i].cost; pts[i] = sel[i].order; }
  var best = -Infinity, bestA = 0, bestB = 0;
  var idx = [0, 0, 0, 0];

  // enumerate A = {0, a1, a2, a3}
  for (var a1 = 1; a1 <= n - 3; a1++) for (var a2 = a1 + 1; a2 <= n - 2; a2++) for (var a3 = a2 + 1; a3 <= n - 1; a3++) {
    var costA = cost[0] + cost[a1] + cost[a2] + cost[a3];
    if (costA > CORE_SUPPLY) continue;
    var maskA = 1 | (1 << a1) | (1 << a2) | (1 << a3);
    // remaining indices
    var rem = [];
    for (var r = 1; r < n; r++) if (!(maskA & (1 << r))) rem.push(r);
    // B contains rem[0]
    for (var b1 = 1; b1 <= 5; b1++) for (var b2 = b1 + 1; b2 <= 6; b2++) for (var b3 = b2 + 1; b3 <= 7; b3++) {
      var i0 = rem[0], i1 = rem[b1], i2 = rem[b2], i3 = rem[b3];
      var costB = cost[i0] + cost[i1] + cost[i2] + cost[i3];
      if (costB > CORE_SUPPLY) continue;
      var maskB = (1 << i0) | (1 << i1) | (1 << i2) | (1 << i3);
      // C = the rest
      var costC = 0, cIdx = [];
      for (var c = 1; c < n; c++) {
        var bit = 1 << c;
        if (!(maskA & bit) && !(maskB & bit)) { costC += cost[c]; cIdx.push(c); }
      }
      if (costC > CORE_SUPPLY) continue;
      var gA = [sel[0], sel[a1], sel[a2], sel[a3]];
      var gB = [sel[i0], sel[i1], sel[i2], sel[i3]];
      var gC = [sel[cIdx[0]], sel[cIdx[1]], sel[cIdx[2]], sel[cIdx[3]]];
      var dmg = damageOfGroups([gA, gB, gC]);
      if (dmg > best) { best = dmg; bestA = maskA; bestB = maskB; }
    }
  }
  if (best === -Infinity) return null;
  var gAo = [], gBo = [], gCo = [];
  for (var k = 0; k < n; k++) {
    var bitk = 1 << k;
    if (bestA & bitk) gAo.push(sel[k]);
    else if (bestB & bitk) gBo.push(sel[k]);
    else gCo.push(sel[k]);
  }
  return { dmg: best, groups: [gAo, gBo, gCo] };
}

// quick feasibility: can these 12 costs be packed 4/4/4 under 17 each? First-fit
// decreasing across permutations of bin order; falls back to exact on failure.
function quickFeasible(sel) {
  var total = 0;
  for (var i = 0; i < sel.length; i++) total += sel[i].cost;
  if (total > CORE_SUPPLY * CORES) return false;
  return true; // cheap necessary check; exact grouping settles sufficiency
}

// ---------------- packer ----------------
function prunePool(kept) {
  if (kept.length <= 44) return kept.slice();
  var byRaw = kept.slice().sort(function (a, b) { return b.rawLin - a.rawLin; });
  var byEff = kept.slice().sort(function (a, b) { return (b.rawLin / (b.cost + 1)) - (a.rawLin / (a.cost + 1)); });
  var byOrder = kept.slice().sort(function (a, b) { return (b.order - a.order) || (b.rawLin - a.rawLin); });
  var byCheap = kept.slice().sort(function (a, b) { return (a.cost - b.cost) || (b.rawLin - a.rawLin); });
  var set = new Set();
  var pool = [];
  function take(arr, k) {
    for (var i = 0; i < arr.length && k > 0; i++) {
      if (!set.has(arr[i])) { set.add(arr[i]); pool.push(arr[i]); k--; }
    }
  }
  take(byRaw, 24); take(byEff, 10); take(byOrder, 8); take(byCheap, 8);
  return pool;
}

function seedSelection(pool, keyFn) {
  var sorted = pool.slice().sort(function (a, b) { return keyFn(b) - keyFn(a); });
  var sel = [];
  for (var i = 0; i < sorted.length && sel.length < 12; i++) {
    sel.push(sorted[i]);
    // keep the running multiset packable: greedy check on sorted costs
    var costs = sel.map(function (x) { return x.cost; }).sort(function (x, y) { return y - x; });
    var bins = [0, 0, 0], cnt = [0, 0, 0], ok = true;
    for (var c = 0; c < costs.length; c++) {
      var placed = false;
      // best-fit decreasing
      var bi = -1, bslack = Infinity;
      for (var bidx = 0; bidx < 3; bidx++) {
        if (cnt[bidx] >= SLOTS) continue;
        var slack = CORE_SUPPLY - bins[bidx] - costs[c];
        if (slack >= 0 && slack < bslack) { bslack = slack; bi = bidx; }
      }
      if (bi >= 0) { bins[bi] += costs[c]; cnt[bi]++; placed = true; }
      if (!placed) { ok = false; break; }
    }
    if (!ok) sel.pop();
  }
  while (sel.length < 12) sel.push(EMPTY);
  return sel;
}

// Damage if groups[gi][slot] were replaced by gem g (no mutation). O(12).
// Mirrors damageOfGroups' whole-damage multiplicative band penalty.
function damageWithSwap(groups, gi, slot, g) {
  var atk = 0, add = 0, boss = 0, d = 0, mult = 1;
  for (var q = 0; q < groups.length; q++) {
    var grp = groups[q], pts = 0, i, x;
    for (i = 0; i < grp.length; i++) {
      x = (q === gi && i === slot) ? g : grp[i];
      pts += x.order;
      atk += x.atk; add += x.add; boss += x.boss;
    }
    mult *= (1 - bandPenalty(pts));
    d += Math.log(1 + B.order.perPoint * Math.max(0, pts - 17));
  }
  d += bukTerm("Attack Power", atk) + bukTerm("Additional Damage", add) + bukTerm("Boss Damage", boss);
  return 100 * d * mult;
}

// Local search from a starting grouping: in-place swap evaluation (O(12) per
// candidate, cost-checked per core), exact regroup (bestGrouping) after each
// accepted swap. Monotone — never returns less than the start.
function localSearch(groupsInit, pool) {
  var groups = groupsInit.map(function (grp) { return grp.slice(); });
  var dmg = damageOfGroups(groups);
  var guard = 0;
  for (;;) {
    if (guard++ > 60) break;
    var gcost = groups.map(function (grp) {
      var c = 0; grp.forEach(function (x) { c += x.cost; }); return c;
    });
    var inSet = new Set();
    groups.forEach(function (grp) { grp.forEach(function (x) { inSet.add(x); }); });
    var bestD = dmg + 1e-6, bo = null, bgi = -1, bslot = -1;
    for (var oi = 0; oi < pool.length; oi++) {
      var o = pool[oi];
      if (inSet.has(o)) continue;
      for (var gi = 0; gi < groups.length; gi++) {
        for (var slot = 0; slot < groups[gi].length; slot++) {
          var cur = groups[gi][slot];
          if (gcost[gi] - cur.cost + o.cost > CORE_SUPPLY) continue;
          var d2 = damageWithSwap(groups, gi, slot, o);
          if (d2 > bestD) { bestD = d2; bo = o; bgi = gi; bslot = slot; }
        }
      }
    }
    if (!bo) break;
    groups[bgi][bslot] = bo;
    var flat = [];
    groups.forEach(function (grp) { grp.forEach(function (x) { flat.push(x); }); });
    while (flat.length < 12) flat.push(EMPTY);
    var re = bestGrouping(flat);
    if (re && re.dmg >= bestD - 1e-9) { groups = re.groups; dmg = re.dmg; }
    else { dmg = bestD; } // keep the in-place grouping (regroup can't be worse; guard anyway)
  }
  var sel = [];
  groups.forEach(function (grp) { grp.forEach(function (x) { sel.push(x); }); });
  while (sel.length < 12) sel.push(EMPTY);
  return { sel: sel, dmg: dmg, groups: groups };
}

function packCollection(kept, seedSolution) {
  var pool = prunePool(kept);
  var seeds = [];
  if (seedSolution) seeds.push(seedSolution.slice());
  seeds.push(seedSelection(pool, function (g) { return g.rawLin; }));
  if (!seedSolution) seeds.push(seedSelection(pool, function (g) { return g.rawLin / (g.cost + 1); }));

  var best = null;
  seeds.forEach(function (sel) {
    var res = bestGrouping(sel);
    if (!res) return;
    var ls = localSearch(res.groups, pool);
    if (!best || ls.dmg > best.dmg) best = ls;
  });
  if (!best) { // degenerate: nothing packable (shouldn't happen) — all empties
    var empt = [];
    for (var e = 0; e < 12; e++) empt.push(EMPTY);
    return { sel: empt, dmg: 0, groups: [[], [], []] };
  }
  return best;
}

// ---------------- single-gem delta (phase 2) ----------------
// Δ(optimal damage) from adding ONE new kept gem g to the collection. The base
// pack is locally optimal for its own pool, so any improving first move must
// PLACE g. Screen: (1) g into any slot under the current grouping; (2) if that
// fails but g is proxy-competitive with the weakest socketed gem, one exact
// regroup with g replacing it. On a hit, run the full local search seeded from
// the hit. `--screen-check` validates this against from-scratch packs.
function singleGemDelta(base, kept, basePool, g) {
  var groups = base.groups;
  var seedGroups = null;
  var gcost = groups.map(function (grp) { var c = 0; grp.forEach(function (x) { c += x.cost; }); return c; });
  for (var gi = 0; gi < groups.length && !seedGroups; gi++) {
    for (var slot = 0; slot < groups[gi].length; slot++) {
      var cur = groups[gi][slot];
      if (gcost[gi] - cur.cost + g.cost > CORE_SUPPLY) continue;
      if (damageWithSwap(groups, gi, slot, g) > base.dmg + 1e-9) { seedGroups = groups; break; }
    }
  }
  if (!seedGroups) {
    var proxy = function (x) { return x.rawLin + 0.08 * x.order; };
    var flat = base.sel, minI = -1, minP = Infinity;
    for (var i = 0; i < flat.length; i++) { var p = proxy(flat[i]); if (p < minP) { minP = p; minI = i; } }
    if (minI >= 0 && proxy(g) > minP - 0.02) {
      var cand = flat.slice(); cand[minI] = g;
      var re = bestGrouping(cand);
      if (re && re.dmg > base.dmg + 1e-9) seedGroups = re.groups;
    }
  }
  if (!seedGroups) return 0;
  var pool = basePool.indexOf(g) === -1 ? basePool.concat([g]) : basePool;
  var ls = localSearch(seedGroups, pool);
  return Math.max(0, ls.dmg - base.dmg);
}

// Grade-greedy roster: add by grade desc while packable; grouping-optimized damage.
function gradeGreedyRoster(kept) {
  var sorted = kept.slice().sort(function (a, b) { return b.grade - a.grade; });
  var sel = seedSelection(sorted, function (g) { return g.grade; });
  var res = bestGrouping(sel);
  return { sel: sel, dmg: res ? res.dmg : 0 };
}

// ---------------- self-test: brute force small pools ----------------
function selfTest() {
  console.log("=== packer self-test: brute force vs packCollection ===");
  var rand = mulberry32(fnv1a("packer-selftest"));
  var worst = 0, trials = 30;
  for (var t = 0; t < trials; t++) {
    // random pool of 14 kept-ish gems
    var kept = [];
    for (var i = 0; i < 14; i++) {
      var cost = 8 + Math.floor(rand() * 3);
      var pool = A.EFFECT_POOLS[cost];
      var a = Math.floor(rand() * 4), b2 = Math.floor(rand() * 4);
      while (b2 === a) b2 = Math.floor(rand() * 4);
      var cfg = {
        baseCost: cost, gemType: "order",
        willpowerLevel: 1 + Math.floor(rand() * 5), orderLevel: 1 + Math.floor(rand() * 5),
        effect1: pool[a], effect1Level: 1 + Math.floor(rand() * 5),
        effect2: pool[b2], effect2Level: 1 + Math.floor(rand() * 5)
      };
      kept.push(gemMeta(cfg));
    }
    // brute force: all C(14,12) selections
    var bestBF = 0;
    for (var x = 0; x < 14; x++) for (var y = x + 1; y < 14; y++) {
      var sel = [];
      for (var k = 0; k < 14; k++) if (k !== x && k !== y) sel.push(kept[k]);
      var r = bestGrouping(sel);
      if (r && r.dmg > bestBF) bestBF = r.dmg;
    }
    var packed = packCollection(kept);
    var gap = bestBF > 0 ? (bestBF - packed.dmg) / bestBF : 0;
    if (gap > worst) worst = gap;
  }
  console.log("worst shortfall vs brute force over " + trials + " pools: " + (100 * worst).toFixed(3) + "%");
  if (worst > 0.005) { console.log("FAIL (>0.5%)"); process.exit(1); }
  console.log("PASS");
  process.exit(0);
}

// ---------------- one account ----------------
function runAccount(tier, accountIdx, solvers) {
  var rand = mulberry32(fnv1a(tier.name + "#" + accountIdx));
  var kept = [];
  var cutGold = 0;

  function cutBatch(cost, count) {
    var solver = solvers[cost];
    var pool = A.EFFECT_POOLS[cost];
    var pairs = [];
    for (var i = 0; i < pool.length; i++)
      for (var j = i + 1; j < pool.length; j++) pairs.push([pool[i], pool[j]]);
    var out = [], gold = 0;
    for (var n = 0; n < count; n++) {
      var pr = pairs[Math.floor(rand() * pairs.length)];
      var res = cutOneGem(solver, { baseCost: cost, gemType: "order", effect1: pr[0], effect2: pr[1] }, rand, true);
      gold += res.spent;
      var meta = gemMeta(res.cfg);
      if (res.processes > 0 && meta.grade >= KEEP_GRADE) out.push(meta);
    }
    return { kept: out, gold: gold };
  }

  // phase 1: the collection
  [8, 9, 10].forEach(function (cost) {
    var r = cutBatch(cost, tier.counts[cost]);
    kept = kept.concat(r.kept);
    cutGold += r.gold;
  });

  var base = packCollection(kept);
  var socketed = base.sel.filter(function (g) { return !g.empty; });

  // roster analysis
  var greedy = gradeGreedyRoster(kept);
  var greedySet = new Set(greedy.sel.filter(function (g) { return !g.empty; }));
  var optSet = new Set(socketed);
  var overlap = 0;
  optSet.forEach(function (g) { if (greedySet.has(g)) overlap++; });
  // benched-better pairs: benched gem grade > socketed gem grade (cross effCost)
  var benched = kept.filter(function (g) { return !optSet.has(g); });
  var minSockGrade = Infinity, sockCostHist = {}, aboveBl = 0, coreBands = { b17: 0, b14: 0, b10: 0, b9: 0 };
  socketed.forEach(function (g) {
    if (g.grade < minSockGrade) minSockGrade = g.grade;
    sockCostHist[g.cost] = (sockCostHist[g.cost] || 0) + 1;
    if (g.grade >= tier.bl) aboveBl++;
  });
  base.groups.forEach(function (grp) {
    var pts = 0; grp.forEach(function (g) { pts += g.order; });
    if (pts >= 17) coreBands.b17++; else if (pts >= 14) coreBands.b14++; else if (pts >= 10) coreBands.b10++; else coreBands.b9++;
  });
  var benchedBetter = 0, benchedBetterLowCost = 0;
  benched.forEach(function (g) {
    if (g.grade > minSockGrade) {
      benchedBetter++;
      if (g.cost <= 4) benchedBetterLowCost++;
    }
  });

  // phase 2: 1,000 single-gem experiments per cost, from the SAME base state.
  // Gems come from the pre-cut tier bank (i.i.d. from the same policy); each is
  // B- filtered (a discarded gem is an automatic no-gain, its gold still spent),
  // then evaluated as a full-repack delta with that one gem added.
  var singles = {};
  var basePool = prunePool(kept);
  [8, 9, 10].forEach(function (cost) {
    var bank = BANKS[cost];
    var start = (accountIdx * 997) % bank.length;   // prime stride decorrelates slices
    var gold = 0, gains = 0, gainSum = 0, keptN = 0;
    for (var i = 0; i < SINGLES; i++) {
      var e = bank[(start + i) % bank.length];
      gold += e.spent;
      if (!e.meta) continue;
      keptN++;
      var d = singleGemDelta(base, kept, basePool, e.meta);
      if (d > 1e-9) { gains++; gainSum += d; }
    }
    singles["c" + cost] = {
      pGain: gains / SINGLES,
      condGain: gains ? gainSum / gains : 0,
      goldPerCut: gold / SINGLES,
      keptRate: keptN / SINGLES
    };
  });

  return {
    tier: tier.name, account: accountIdx,
    keptCount: kept.length, cutGold: cutGold,
    baseDmg: base.dmg, aboveBaseline: aboveBl,
    sockCostHist: sockCostHist, coreBands: coreBands,
    minSockGrade: isFinite(minSockGrade) ? minSockGrade : null,
    greedyDmg: greedy.dmg, rosterOverlap: overlap,
    benchedBetter: benchedBetter, benchedBetterLowCost: benchedBetterLowCost,
    singles: singles
  };
}

// ---------------- bank helpers ----------------
function makeSolvers(tier) {
  var baseline = A.gradeToScore(tier.bl);
  var solvers = {};
  [8, 9, 10].forEach(function (cost) {
    solvers[cost] = new DP.Solver(baseline, tier.gpd, false, { axis: "dps", maxTurns: Engine.EPIC.maxTurns });
  });
  return solvers;
}
function loadBanks(dir, tierName) {
  var banks = {};
  [8, 9, 10].forEach(function (cost) {
    var p = dir + "/bank-" + tierName + "-c" + cost + ".json";
    var d = JSON.parse(fs.readFileSync(p, "utf8"));
    d.entries.forEach(function (e) { e.meta = e.cfg ? gemMeta(e.cfg) : null; });
    banks[cost] = d.entries;
  });
  return banks;
}

// ---------------- library use ----------------
// require()d by tools/fit-scoring.js — expose the internals and skip the CLI.
if (require.main !== module) {
  module.exports = {
    TIERS: TIERS, KEEP_GRADE: KEEP_GRADE, EMPTY: EMPTY,
    gemMeta: gemMeta, bandPenalty: bandPenalty, damageOfGroups: damageOfGroups,
    bestGrouping: bestGrouping, prunePool: prunePool, seedSelection: seedSelection,
    localSearch: localSearch, packCollection: packCollection,
    gradeGreedyRoster: gradeGreedyRoster, singleGemDelta: singleGemDelta,
    makeSolvers: makeSolvers
  };
  return;
}

// ---------------- main ----------------
if (ARGS["dump-labels"]) {
  // Regenerate accounts (same seeds as the study) and dump compact per-account
  // labels for scoring fits: the kept collection + which gems the packer socketed.
  var dTier = TIERS[ARGS.tier];
  if (!dTier) { console.error("--dump-labels needs --tier"); process.exit(1); }
  var dSolvers = makeSolvers(dTier);
  var dKeepAll = !!ARGS["keep-all"];   // Shizu 2026-08-09: pack over EVERY finished
                                       // gem, no grade filter — the filter is
                                       // grade-based and grading is being refit
  var dFrom = parseInt(ARGS.from, 10) || 0;
  var dTo = ARGS.to != null ? parseInt(ARGS.to, 10) : dFrom + 10000;
  var dRows = [];
  var dT0 = Date.now();
  for (var da = dFrom; da < dTo; da++) {
    var dRand = mulberry32(fnv1a(dTier.name + "#" + da));
    var dKept = [];
    [8, 9, 10].forEach(function (cost) {
      var dp = A.EFFECT_POOLS[cost], dPairs = [];
      for (var x = 0; x < dp.length; x++) for (var y = x + 1; y < dp.length; y++) dPairs.push([dp[x], dp[y]]);
      for (var di = 0; di < dTier.counts[cost]; di++) {
        var dpr = dPairs[Math.floor(dRand() * dPairs.length)];
        var dres = cutOneGem(dSolvers[cost], { baseCost: cost, gemType: "order", effect1: dpr[0], effect2: dpr[1] }, dRand, true);
        var dm = gemMeta(dres.cfg);
        if (dres.processes > 0 && (dKeepAll || dm.grade >= KEEP_GRADE)) dKept.push(dm);
      }
    });
    var dPack = packCollection(dKept);
    var dSet = new Set(dPack.sel.filter(function (g) { return !g.empty; }));
    dRows.push({
      a: da,
      kept: dKept.map(function (g) {
        var c = g.cfg;
        return [c.baseCost, c.willpowerLevel, c.orderLevel,
          A.EFFECT_POOLS[c.baseCost].indexOf(c.effect1), c.effect1Level,
          A.EFFECT_POOLS[c.baseCost].indexOf(c.effect2), c.effect2Level];
      }),
      sock: dKept.map(function (g, i) { return dSet.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
      dmg: dPack.dmg
    });
    if (ARGS.progress && (da - dFrom + 1) % 250 === 0) {
      console.log("[labels " + dTier.name + "] " + (da - dFrom + 1) + "/" + (dTo - dFrom) +
        " (" + ((Date.now() - dT0) / 1000).toFixed(0) + "s)");
    }
  }
  fs.writeFileSync(ARGS.out || ("labels-" + dTier.name + "-" + dFrom + "-" + dTo + ".json"),
    JSON.stringify({ tier: dTier.name, from: dFrom, to: dTo, rows: dRows }));
  console.log("wrote " + (ARGS.out || "labels") + " (" + dRows.length + " accounts, " + ((Date.now() - dT0) / 1000).toFixed(0) + "s)");
}
else if (ARGS.selftest) { selfTest(); }
else if (ARGS["make-bank"]) {
  var bTier = TIERS[ARGS.tier];
  var bCost = parseInt(ARGS.cost, 10);
  var bSize = parseInt(ARGS.size, 10) || 100000;
  if (!bTier || !bCost) { console.error("--make-bank needs --tier and --cost"); process.exit(1); }
  var bSolver = makeSolvers(bTier)[bCost];
  var bPool = A.EFFECT_POOLS[bCost], bPairs = [];
  for (var bi = 0; bi < bPool.length; bi++)
    for (var bj = bi + 1; bj < bPool.length; bj++) bPairs.push([bPool[bi], bPool[bj]]);
  var bRand = mulberry32(fnv1a("bank:" + bTier.name + ":c" + bCost));
  var entries = [];
  var bt0 = Date.now();
  for (var bn = 0; bn < bSize; bn++) {
    var bp = bPairs[Math.floor(bRand() * bPairs.length)];
    var br = cutOneGem(bSolver, { baseCost: bCost, gemType: "order", effect1: bp[0], effect2: bp[1] }, bRand, true);
    var keepIt = br.processes > 0 && A.grade(br.cfg) >= KEEP_GRADE;
    entries.push({ spent: br.spent, cfg: keepIt ? br.cfg : null });
  }
  var bOut = ARGS.out || ("bank-" + bTier.name + "-c" + bCost + ".json");
  fs.writeFileSync(bOut, JSON.stringify({ tier: bTier.name, cost: bCost, size: bSize, entries: entries }));
  console.log("wrote " + bOut + " (" + bSize + " cuts, " + ((Date.now() - bt0) / 1000).toFixed(0) + "s, kept " +
    entries.filter(function (e) { return e.cfg; }).length + ")");
}
else if (ARGS.grades) {
  // Grade statistics for the study's own accounts (phase 1 rebuilt from the same
  // seeds; no banks needed). Reports mean grades of the socketed 12 and the kept
  // collection.
  var gTier = TIERS[ARGS.tier];
  if (!gTier) { console.error("--grades needs --tier"); process.exit(1); }
  var gSolvers = makeSolvers(gTier);
  var gN = parseInt(ARGS.accounts, 10) || 1000;
  var sockSum = 0, sockN = 0, keptSum = 0, keptN = 0, sockMin = 0, greedySum = 0, greedyN = 0;
  for (var ga = 0; ga < gN; ga++) {
    var gRand = mulberry32(fnv1a(gTier.name + "#" + ga));
    var gKept = [];
    [8, 9, 10].forEach(function (cost) {
      var gp = A.EFFECT_POOLS[cost], gPairs = [];
      for (var x = 0; x < gp.length; x++) for (var y = x + 1; y < gp.length; y++) gPairs.push([gp[x], gp[y]]);
      for (var gi = 0; gi < gTier.counts[cost]; gi++) {
        var gpr = gPairs[Math.floor(gRand() * gPairs.length)];
        var gres = cutOneGem(gSolvers[cost], { baseCost: cost, gemType: "order", effect1: gpr[0], effect2: gpr[1] }, gRand, true);
        var gm = gemMeta(gres.cfg);
        if (gres.processes > 0 && gm.grade >= KEEP_GRADE) gKept.push(gm);
      }
    });
    var gBase = packCollection(gKept);
    var gMin = Infinity;
    gBase.sel.forEach(function (g) { if (!g.empty) { sockSum += g.grade; sockN++; if (g.grade < gMin) gMin = g.grade; } });
    if (isFinite(gMin)) sockMin += gMin;
    gKept.forEach(function (g) { keptSum += g.grade; keptN++; });
    var gGreedy = gradeGreedyRoster(gKept);
    gGreedy.sel.forEach(function (g) { if (!g.empty) { greedySum += g.grade; greedyN++; } });
  }
  console.log(gTier.name + " (" + gN + " accounts): socketed mean grade " + (sockSum / sockN).toFixed(1) +
    " · socketed min (avg) " + (sockMin / gN).toFixed(1) +
    " · kept-collection mean " + (keptSum / keptN).toFixed(1) +
    " · grade-greedy roster mean " + (greedySum / greedyN).toFixed(1));
}
else if (ARGS.inversions) {
  // Phase 3: when do lower-graded gems get socketed above higher-graded ones?
  // Rebuild phase-1 states (same seeds as the study), compare the raw-optimal
  // roster R against the grade-greedy feasible roster G. Promoted = R \ G
  // (socketed despite lower grade); Displaced = G \ R (benched despite higher
  // grade). Each promoted gem gets a reason tag relative to the account's
  // displaced set: 'damage' (out-damages the displaced mean), 'order' (order >= 4,
  // weaker raw — band glue), 'budget' (effCost <= 3, weaker raw — willpower glue),
  // 'mixed' otherwise.
  var iTier = TIERS[ARGS.tier];
  if (!iTier) { console.error("--inversions needs --tier"); process.exit(1); }
  var iSolvers = makeSolvers(iTier);
  var iN = parseInt(ARGS.accounts, 10) || 1000;
  var agg = {
    accounts: 0, promoted: 0,
    pCost: {}, dCost: {}, pGrade: 0, dGrade: 0, pRaw: 0, dRaw: 0, pOrder: 0, dOrder: 0,
    reasons: { damage: 0, order: 0, budget: 0, mixed: 0 },
    extremes: {}, extremeGap: 0, extremeGapMax: 0,
    top12Feasible: 0
  };
  for (var ia = 0; ia < iN; ia++) {
    var iRand = mulberry32(fnv1a(iTier.name + "#" + ia));
    var iKept = [];
    [8, 9, 10].forEach(function (cost) {
      var ip = A.EFFECT_POOLS[cost], iPairs = [];
      for (var x = 0; x < ip.length; x++) for (var y = x + 1; y < ip.length; y++) iPairs.push([ip[x], ip[y]]);
      for (var ii = 0; ii < iTier.counts[cost]; ii++) {
        var ipr = iPairs[Math.floor(iRand() * iPairs.length)];
        var ires = cutOneGem(iSolvers[cost], { baseCost: cost, gemType: "order", effect1: ipr[0], effect2: ipr[1] }, iRand, true);
        var im = gemMeta(ires.cfg);
        if (ires.processes > 0 && im.grade >= KEEP_GRADE) iKept.push(im);
      }
    });
    var R = packCollection(iKept);
    var G = gradeGreedyRoster(iKept);
    var Rset = new Set(R.sel.filter(function (g) { return !g.empty; }));
    var Gset = new Set(G.sel.filter(function (g) { return !g.empty; }));
    var promoted = [], displaced = [];
    Rset.forEach(function (g) { if (!Gset.has(g)) promoted.push(g); });
    Gset.forEach(function (g) { if (!Rset.has(g)) displaced.push(g); });
    agg.accounts++;
    if (promoted.length && displaced.length) {
      var dRawMean = 0;
      displaced.forEach(function (g) { dRawMean += g.rawLin; });
      dRawMean /= displaced.length;
      promoted.forEach(function (g) {
        agg.promoted++;
        agg.pCost[g.cost] = (agg.pCost[g.cost] || 0) + 1;
        agg.pGrade += g.grade; agg.pRaw += g.rawLin; agg.pOrder += g.order;
        var tag = (g.rawLin >= dRawMean) ? "damage"
          : (g.order >= 4) ? "order"
          : (g.cost <= 3) ? "budget" : "mixed";
        agg.reasons[tag]++;
      });
      displaced.forEach(function (g) {
        agg.dCost[g.cost] = (agg.dCost[g.cost] || 0) + 1;
        agg.dGrade += g.grade; agg.dRaw += g.rawLin; agg.dOrder += g.order;
      });
      // extreme inversion: highest-grade displaced vs lowest-grade promoted
      var Dstar = displaced.slice().sort(function (a, b) { return b.grade - a.grade; })[0];
      var Pstar = promoted.slice().sort(function (a, b) { return a.grade - b.grade; })[0];
      var key = "c" + Pstar.cost + "≻c" + Dstar.cost;
      agg.extremes[key] = (agg.extremes[key] || 0) + 1;
      var gap = Dstar.grade - Pstar.grade;
      agg.extremeGap += gap;
      if (gap > agg.extremeGapMax) agg.extremeGapMax = gap;
    }
    // is the PURE top-12-by-grade multiset even packable?
    var top12 = iKept.slice().sort(function (a, b) { return b.grade - a.grade; }).slice(0, 12);
    while (top12.length < 12) top12.push(EMPTY);
    if (bestGrouping(top12)) agg.top12Feasible++;
  }
  var nP = agg.promoted, nD = agg.promoted; // |promoted| == |displaced| per account? not exactly, use own counts
  var dTot = 0; Object.keys(agg.dCost).forEach(function (k) { dTot += agg.dCost[k]; });
  function hist(h, tot) {
    return Object.keys(h).sort(function (a, b) { return a - b; })
      .map(function (k) { return k + ": " + (100 * h[k] / tot).toFixed(1) + "%"; }).join(" · ");
  }
  console.log("=== " + iTier.name + " inversions (" + agg.accounts + " accounts) ===");
  console.log("promoted (socketed despite lower grade): " + (nP / agg.accounts).toFixed(2) + "/account · mean grade " +
    (agg.pGrade / nP).toFixed(1) + " · rawLin " + (agg.pRaw / nP).toFixed(3) + " · order " + (agg.pOrder / nP).toFixed(2));
  console.log("  effCost: " + hist(agg.pCost, nP));
  console.log("displaced (benched despite higher grade): " + (dTot / agg.accounts).toFixed(2) + "/account · mean grade " +
    (agg.dGrade / dTot).toFixed(1) + " · rawLin " + (agg.dRaw / dTot).toFixed(3) + " · order " + (agg.dOrder / dTot).toFixed(2));
  console.log("  effCost: " + hist(agg.dCost, dTot));
  console.log("promotion reasons: damage " + (100 * agg.reasons.damage / nP).toFixed(1) + "% · order-glue " +
    (100 * agg.reasons.order / nP).toFixed(1) + "% · budget-glue " + (100 * agg.reasons.budget / nP).toFixed(1) +
    "% · mixed " + (100 * agg.reasons.mixed / nP).toFixed(1) + "%");
  var exTot = 0; Object.keys(agg.extremes).forEach(function (k) { exTot += agg.extremes[k]; });
  var exTop = Object.keys(agg.extremes).sort(function (a, b) { return agg.extremes[b] - agg.extremes[a]; }).slice(0, 6)
    .map(function (k) { return k + " " + (100 * agg.extremes[k] / exTot).toFixed(1) + "%"; }).join(" · ");
  console.log("extreme pair (lowest-grade promoted ≻ highest-grade displaced): " + exTop);
  console.log("  mean grade gap " + (agg.extremeGap / exTot).toFixed(1) + " pts · max " + agg.extremeGapMax.toFixed(1) + " pts");
  console.log("pure top-12-by-grade packable: " + (100 * agg.top12Feasible / agg.accounts).toFixed(1) + "% of accounts");
}
else if (ARGS["screen-check"]) {
  // Validate singleGemDelta's screen against from-scratch packs.
  var cTier = TIERS[ARGS.tier || "T1"];
  BANKS = loadBanks(ARGS.banks || ".", cTier.name);
  var cSolvers = makeSolvers(cTier);
  var nAcc = parseInt(ARGS.accounts, 10) || 20, perAcc = 40;
  var cases = 0, missed = 0, valDiff = 0, maxMiss = 0, maxDiff = 0;
  for (var ca = 0; ca < nAcc; ca++) {
    // build a phase-1 state directly (fresh account ids outside the study range)
    var rand2 = mulberry32(fnv1a(cTier.name + "#" + (900000 + ca)));
    var kept2 = [];
    [8, 9, 10].forEach(function (cost) {
      var pool2 = A.EFFECT_POOLS[cost], pairs2 = [];
      for (var x = 0; x < pool2.length; x++) for (var y = x + 1; y < pool2.length; y++) pairs2.push([pool2[x], pool2[y]]);
      for (var n2 = 0; n2 < cTier.counts[cost]; n2++) {
        var pr2 = pairs2[Math.floor(rand2() * pairs2.length)];
        var res2 = cutOneGem(cSolvers[cost], { baseCost: cost, gemType: "order", effect1: pr2[0], effect2: pr2[1] }, rand2, true);
        var m2 = gemMeta(res2.cfg);
        if (res2.processes > 0 && m2.grade >= KEEP_GRADE) kept2.push(m2);
      }
    });
    var base2 = packCollection(kept2);
    var basePool2 = prunePool(kept2);
    var crand = mulberry32(fnv1a("screencheck" + ca));
    for (var s = 0; s < perAcc; s++) {
      var cost3 = [8, 9, 10][Math.floor(crand() * 3)];
      var bank3 = BANKS[cost3];
      var e3 = bank3[Math.floor(crand() * bank3.length)];
      if (!e3.meta) continue;
      cases++;
      var fast = singleGemDelta(base2, kept2, basePool2, e3.meta);
      var full = Math.max(0, packCollection(kept2.concat([e3.meta]), base2.sel).dmg - base2.dmg);
      var diff = Math.abs(full - fast);
      if (fast <= 1e-9 && full > 1e-6) { missed++; if (full > maxMiss) maxMiss = full; }
      else if (diff > 1e-6) { valDiff++; if (diff > maxDiff) maxDiff = diff; }
    }
  }
  console.log("screen-check: " + cases + " cases, missed gains " + missed + " (max " + maxMiss.toFixed(5) +
    "%), value diffs " + valDiff + " (max " + maxDiff.toFixed(5) + "%)");
  process.exit(missed > cases * 0.005 ? 1 : 0);
}
else {
  var tierName = ARGS.tier;
  if (!tierName || !TIERS[tierName]) { console.error("--tier=T1|T2|T3 required (or --selftest / --make-bank / --screen-check)"); process.exit(1); }
  var tier = TIERS[tierName];
  if (!ARGS.banks) { console.error("--banks=<dir with bank-*.json> required for the study"); process.exit(1); }
  BANKS = loadBanks(ARGS.banks, tierName);
  var from = parseInt(ARGS.from, 10) || 0;
  var to = ARGS.to != null ? parseInt(ARGS.to, 10) : (ARGS.accounts != null ? from + parseInt(ARGS.accounts, 10) : from + 10000);
  var outPath = ARGS.out || ("account-study-" + tierName + "-" + from + "-" + to + ".json");

  var solvers = makeSolvers(tier);
  var rows = [];
  var t0 = Date.now();
  for (var acc = from; acc < to; acc++) {
    rows.push(runAccount(tier, acc, solvers));
    if (ARGS.progress && (acc - from + 1) % 100 === 0) {
      var el = (Date.now() - t0) / 1000;
      var done = acc - from + 1;
      console.log("[" + tierName + "] " + done + "/" + (to - from) + " accounts  (" + el.toFixed(0) + "s, " +
        (el / done * 1000).toFixed(0) + "ms/account, ETA " + ((to - from - done) * el / done / 60).toFixed(1) + "min)");
    }
  }
  fs.writeFileSync(outPath, JSON.stringify({
    tier: tier, singles: SINGLES, keepGrade: KEEP_GRADE,
    generated: true, from: from, to: to,
    elapsedSec: (Date.now() - t0) / 1000,
    rows: rows
  }));
  console.log("wrote " + outPath + " (" + rows.length + " accounts, " + ((Date.now() - t0) / 1000).toFixed(0) + "s)");
}
