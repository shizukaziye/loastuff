/**
 * band-cost.js — what one astrogem at each grade band costs to produce.
 *
 *   node tools/band-cost.js --rarity=epic --n=300000 --out=data/band-cost-epic.json
 *   node tools/band-cost.js --rarity=rare --n=300000 --out=data/band-cost-rare.json
 *
 * Reconstructed from docs/research/ark-grid.md Appendix A, with the raw gem's
 * rarity added. Everything is simulated with the astrogem calculator's own cut
 * engine and model — nothing in that repo is edited on disk.
 *
 * RARITY is the raw gem you feed the cutter, and it buys turns and rerolls:
 *
 *   rare   7 turns, 2 rerolls
 *   epic   9 turns, 3 rerolls
 *
 * Two fewer turns and one fewer reroll is a large cut in the reachable level
 * sum, so rares clear a grade band far less often AND land under the relic
 * line (level sum 16) more often, which is what makes a dud fusable. Rares
 * therefore cost more twice over: more gems to get a hit, and fewer of the
 * misses worth recycling.
 *
 * The cut engine is epic-only by its own header and reads its reroll budget
 * from A.RARITY.epic. That is a live object, so pointing it at the rare budget
 * in this process is enough; the file on disk is untouched.
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
var BUDGET = { maxTurns: A.RARITY[RARITY].maxTurns, maxRerolls: A.RARITY[RARITY].maxRerolls };
// retarget the engine's budget before it is required (live object, disk untouched)
A.RARITY.epic.maxTurns = BUDGET.maxTurns;
A.RARITY.epic.maxRerolls = BUDGET.maxRerolls;

var DP = require(REPO + "/model/dp.js");
var Econ = require(REPO + "/loadout-econ.js");
var Engine = require(REPO + "/tools/lib/cut-engine.js");
var mulberry32 = Engine.mulberry32, fnv1a = Engine.fnv1a, cutOneGem = Engine.cutOneGem;

var N = parseInt(ARGS.n, 10) || 20000;
var SEED = String(ARGS.seed || "gpd-2026-08-13");
var GPD = parseInt(ARGS.gpd, 10) || 2500000;
var BL = parseFloat(ARGS.bl) || 80;
var FUSE_TARGET = String(ARGS["fuse-target"] || "same");
var MIX = (function () {
  var p = String(ARGS.mix || "60,30,10").split(/[:,/]/).map(Number);
  return { 8: p[0] / 100, 9: p[1] / 100, 10: p[2] / 100 };
})();
var BANDS = ARGS.bands ? String(ARGS.bands).split(",").map(Number) : Econ.GRADE_ROWS_SUPPORT;
var LADDER = A.SUPPORT_RANK_LADDER;
function letterOf(g) {
  for (var i = 0; i < LADDER.length; i++) if (g >= LADDER[i][1] - 1e-9) return LADDER[i][0];
  return "F-";
}

var _partCache = {};
function partsOfSum(s) {
  if (_partCache[s]) return _partCache[s];
  var out = [];
  for (var w = 1; w <= 5; w++) for (var o = 1; o <= 5; o++)
    for (var a = 1; a <= 5; a++) for (var b = 1; b <= 5; b++)
      if (w + o + a + b === s) out.push([w, o, a, b]);
  _partCache[s] = out;
  return out;
}
function sampleTierGem(cost, tierName, rand, gemType) {
  var sumDist = A.outputLevelSumDist(tierName);
  var r = rand(), acc = 0, sum = null;
  Object.keys(sumDist).forEach(function (k) {
    if (sum !== null) return;
    acc += sumDist[k];
    if (r <= acc) sum = parseInt(k, 10);
  });
  if (sum === null) sum = parseInt(Object.keys(sumDist).pop(), 10);
  var parts = partsOfSum(sum), p = parts[Math.floor(rand() * parts.length)];
  var pool = A.EFFECT_POOLS[cost];
  var i = Math.floor(rand() * pool.length), j = Math.floor(rand() * (pool.length - 1));
  if (j >= i) j++;
  return { baseCost: cost, gemType: gemType || "order", willpowerLevel: p[0], orderLevel: p[1],
    effect1: pool[i], effect1Level: p[2], effect2: pool[j], effect2Level: p[3] };
}
function drawTier(dist, rand) {
  var r = rand();
  if (r <= dist.legendary) return "legendary";
  if (r <= dist.legendary + dist.relic) return "relic";
  return "ancient";
}
function pairsOf(cost) {
  var pool = A.EFFECT_POOLS[cost], out = [];
  for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) out.push([pool[i], pool[j]]);
  return out;
}
function pickCost(r) { return r < MIX[8] ? 8 : (r < MIX[8] + MIX[9] ? 9 : 10); }

var ROSTER_BOUND = !!ARGS.rb;
var pairs = { 8: pairsOf(8), 9: pairsOf(9), 10: pairsOf(10) };

/**
 * Cut N fresh gems under one advisor policy, then replay the dud-fusion
 * cascade once per requested band. Exported so the grid driver can sweep
 * baselines and gold-per-damage without paying for a process each time.
 */
function policy(BL, GPD, BANDS, N) {
var baselineValue = A.supportGradeToScore(BL);
var solvers = {};
[8, 9, 10].forEach(function (c) {
  solvers[c] = new DP.Solver(baselineValue, GPD, ROSTER_BOUND,
    { axis: "support", maxTurns: BUDGET.maxTurns });
});
var cutRand = mulberry32(fnv1a("cut:" + SEED + ":" + BL + ":" + GPD + ":" + RARITY));
var stream = new Array(N);
var totalCutGold = 0, dismantled = 0, resets = 0;
for (var n = 0; n < N; n++) {
  var cost = pickCost(cutRand());
  var pr = pairs[cost][Math.floor(cutRand() * pairs[cost].length)];
  var res = cutOneGem(solvers[cost],
    { baseCost: cost, gemType: "order", effect1: pr[0], effect2: pr[1] }, cutRand, true);
  totalCutGold += res.spent;
  resets += res.resets;
  var rec = { gold: res.spent, cfg: null, grade: 0, dmg: 0, ls: 0 };
  if (res.processes > 0) {
    rec.cfg = res.cfg;
    rec.grade = A.supportGrade(res.cfg);
    rec.dmg = A.supportDamage(res.cfg);
    rec.ls = A.levelSum(res.cfg);
  } else dismantled++;
  stream[n] = rec;
}

// ---------- 2. per-row fusion cascade replay ----------
function runBand(band) {
  var fuseRand = mulberry32(fnv1a("fuse:" + SEED + ":" + BL + ":" + GPD + ":" + RARITY + ":" + band));
  var eG = new Float64Array(N), eS = new Float64Array(N),
      eSc = new Float64Array(N), eGc = new Float64Array(N);
  var fusions = 0, cutSucc = 0, fuseSucc = 0, dmgSum = 0, dmgN = 0, gradeSum = 0;
  for (var n = 0; n < N; n++) {
    var rec = stream[n], g0 = rec.gold, s0 = 0;
    eGc[n] = rec.gold;
    var queue = [];
    if (rec.cfg) {
      if (rec.grade >= band) {
        cutSucc++; s0++; eSc[n] = 1;
        dmgSum += rec.dmg; dmgN++; gradeSum += rec.grade;
      } else if (rec.ls >= 16) queue.push(rec.cfg);
    }
    var guard = 0;
    while (queue.length && guard++ < 500) {
      var fg = queue.pop();
      fusions++; g0 += A.COSTS.fusion;
      var inTier = A.classifyTier(A.levelSum(fg));
      var outTier = drawTier(A.fusionOutputDist([inTier, "legendary", "legendary"]), fuseRand);
      if (outTier === "legendary") continue;
      var outCost = (FUSE_TARGET === "same") ? fg.baseCost
        : (fuseRand() < 2 / 3 ? parseInt(FUSE_TARGET, 10) : fg.baseCost);
      var outCfg = sampleTierGem(outCost, outTier, fuseRand, "order");
      var og = A.supportGrade(outCfg);
      if (og >= band) {
        fuseSucc++; s0++;
        dmgSum += A.supportDamage(outCfg); dmgN++; gradeSum += og;
      } else if (A.levelSum(outCfg) >= 16) queue.push(outCfg);
    }
    eG[n] = g0; eS[n] = s0;
  }
  function ratio(G, S) {
    var sg = 0, ss = 0, i;
    for (i = 0; i < N; i++) { sg += G[i]; ss += S[i]; }
    if (ss === 0) return { r: Infinity, se: Infinity };
    var R = sg / ss, mS = ss / N, v = 0;
    for (i = 0; i < N; i++) { var d = G[i] - R * S[i]; v += d * d; }
    v /= (N - 1);
    return { r: R, se: Math.sqrt(v / N) / mS };
  }
  var withF = ratio(eG, eS), noF = ratio(eGc, eSc), succ = cutSucc + fuseSucc;
  return { band: band, letter: letterOf(band), succ: succ, fusions: fusions,
    goldPerHit: withF.r, goldSE: withF.se, gemsPerHit: succ ? N / succ : Infinity,
    processedPerHit: succ ? (N - dismantled) / succ : Infinity,
    goldPerHitNoFuse: noF.r, gemsPerHitNoFuse: cutSucc ? N / cutSucc : Infinity,
    fusedShare: succ ? fuseSucc / succ : 0,
    meanDamage: dmgN ? dmgSum / dmgN : null, meanGrade: dmgN ? gradeSum / dmgN : null };
}

  return { rows: BANDS.map(runBand), totalCutGold: totalCutGold,
           dismantled: dismantled, resets: resets };
}

if (require.main !== module) {
  module.exports = { policy: policy, BUDGET: BUDGET, RARITY: RARITY,
                     letterOf: letterOf, A: A };
  return;
}

var _r = policy(BL, GPD, BANDS, N);
var out = _r.rows, totalCutGold = _r.totalCutGold,
    dismantled = _r.dismantled, resets = _r.resets;
console.log("# " + RARITY + " raw gems — " + BUDGET.maxTurns + " turns, " + BUDGET.maxRerolls +
  " rerolls   baseline " + BL + "  gpd " + GPD + "  N=" + N + "  mix=" +
  (MIX[8] * 100) + ":" + (MIX[9] * 100) + ":" + (MIX[10] * 100) + "  MODEL_SIG=" + A.MODEL_SIG);
console.log("# cut stream " + Math.round(totalCutGold) + "g, " + dismantled +
  " dismantled unprocessed, " + resets + " resets");
console.log(["band", "letter", "hits", "gold/hit", "SE", "drawn/hit", "fused%", "goldNoFuse"].join("\t"));
out.forEach(function (r) {
  console.log([r.band, r.letter, r.succ, Math.round(r.goldPerHit), Math.round(r.goldSE),
    r.gemsPerHit.toFixed(2), (100 * r.fusedShare).toFixed(1), Math.round(r.goldPerHitNoFuse)].join("\t"));
});
if (ARGS.out) require("fs").writeFileSync(ARGS.out, JSON.stringify({
  meta: { rarity: RARITY, turns: BUDGET.maxTurns, rerolls: BUDGET.maxRerolls, N: N, seed: SEED,
    bl: BL, gpd: GPD, mix: MIX, fuseTarget: FUSE_TARGET, sig: A.MODEL_SIG,
    totalCutGold: totalCutGold, dismantled: dismantled, resets: resets }, rows: out }, null, 1));
