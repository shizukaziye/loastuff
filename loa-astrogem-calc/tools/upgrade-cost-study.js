/**
 * upgrade-cost-study.js — "cut until upgrade" study for the willpower methodology.
 *
 * For each profile (character × gemType) and each base cost 8/9/10, simulate
 * cutting fresh EPIC astrogems under the advisor's DP-optimal policy — at the
 * grader's per-type recommended baseline and CP-derived gpd — until the finished
 * gem is an UPGRADE: swapping it in for SOME equipped gem of its type raises the
 * raw whole-grid damage (best swap over all same-type slots, strictly > 0).
 * Record how many gems, how much gold, and the damage gained.
 *
 * Study design (interview with Shizu, 2026-08-06; v2 criterion same day):
 *   - Upgrade      : best FEASIBLE SAME-COST swap Δ(raw gridDamage) > 0. A cut gem
 *                    replaces an equipped gem of the SAME base cost (like for like),
 *                    and the willpower budget still binds — every observed core
 *                    packs exactly to its supply (all 30 cores: 15 or 17, zero
 *                    slack), so feasible = wpLevel(new) >= wpLevel(replaced).
 *                    A cost with no equipped same-cost gem on that side cannot
 *                    upgrade at all (reported as "no-slots", not simulated).
 *                    The willpower-free same-cost p is tracked for comparison.
 *                    (v1: value > weakest; v2: any-slot raw; v3: cross-cost
 *                    budget-feasible — all superseded by this rule.)
 *   - DP baseline   : per-type recommendation (typeBaseline, bumped 3rd-lowest)
 *   - gpd           : cpToGpd(combatPower) (falls back to GPD_DEFAULT)
 *   - Gem pool      : every attempt draws a UNIFORM random effect pair (all 6)
 *   - Gold          : NRB — processing (cost outcomes move 0..1800) + paid
 *                     reroll (3,800) + resets (20,000). Gems themselves free.
 *   - Resets        : advisor-style — ranked when Complete would win (or last
 *                     turn), taken when it tops the ranking; once per gem;
 *                     same-pair assumption; not counted as a new gem.
 *   - Headline gain : the best swap's Δ(raw gridDamage). Willpower never enters
 *                     this number by construction. The SAME swap's value delta
 *                     (Δ gemValue, includes M) rides alongside and may be
 *                     negative — raw-approved, value-vetoed upgrades.
 *
 * Decision semantics mirror dp.js topLevelAdvice (the advisor), NOT chooseAction:
 *   - fresh gem (0 processes): Complete == dismantle for 0 (a junk pair whose
 *     process EV is negative gets discarded unprocessed — value 0, gold 0)
 *   - reroll gated until processed once; Complete gated the same
 *   - Reset ranked when (last turn || Complete would win) and unused, valued
 *     −20k + W(fresh same pair); never on a fresh gem
 *   - tie-break order on equal values: Process, Reroll, Complete, Reset
 *
 * Modes:
 *   node tools/upgrade-cost-study.js --chars=<dir> [--char=Name] [--type=order]
 *        [--cost=9] [--trials=10000] [--batch=5000] [--budget=25000000]
 *        [--out=<file>] [--progress]
 *   node tools/upgrade-cost-study.js --validate     (rollout-vs-W gate, no study)
 *
 * Every cell runs a per-gem BATCH first (p-hat + winner stats). If literal
 * until-upgrade trials would exceed the gem budget, the cell switches to
 * BOOTSTRAP mode: trials resample gems i.i.d. from an enlarged batch — the
 * gems-until-upgrade process is i.i.d.-geometric, so this is statistically
 * identical, and the mode is flagged in the output.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var A = require("../model/astrogem.js");
var N = require("../model/nested.js");
var DP = require("../model/dp.js");
var Econ = require("../loadout-econ.js");
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
var TRIALS = parseInt(ARGS.trials, 10) || 10000;
var BATCH = parseInt(ARGS.batch, 10) || 5000;
var GEM_BUDGET = parseInt(ARGS.budget, 10) || 25000000; // max literal gems per cell
var GEM_CAP = parseInt(ARGS.cap, 10) || 200000;         // per-trial safety cap
var EPIC = A.RARITY.epic; // { maxTurns: 9, maxRerolls: 3 }

// ---------------- pairs / buckets ----------------
function pairsOf(baseCost) {
  var pool = A.EFFECT_POOLS[baseCost], out = [];
  for (var i = 0; i < pool.length; i++)
    for (var j = i + 1; j < pool.length; j++)
      out.push([pool[i], pool[j]]);
  return out;
}
function bucketOf(baseCost, e1, e2, axis) {
  var esFn = (axis === "support") ? A.supportEffectScore : A.effectScore;
  var pool = A.EFFECT_POOLS[baseCost];
  var live = pool.filter(function (e) { return esFn(e, 1) > 0; })
    .sort(function (a, b) { return esFn(b, 1) - esFn(a, 1); });
  var v1 = esFn(e1, 1) > 0, v2 = esFn(e2, 1) > 0;
  if (v1 && v2) return "2D";
  if (!v1 && !v2) return "No";
  var liveEff = v1 ? e1 : e2;
  return liveEff === live[0] ? "Op" : "Sub";
}

// ---------------- best-swap evaluator (raw whole-grid damage) ----------------
// Fast Δ(gridDamage) for replacing equipped gem X with finished config N (N inherits
// X's core). Mirrors A.gridDamage / supportGridDamage term-for-term; runCell verifies
// it against a full recompute before trusting it.
function makeSwapEval(allGems, axis) {
  var B = A.SCORING.baselines;
  var support = (axis === "support");
  var lv = { "Attack Power": 0, "Additional Damage": 0, "Boss Damage": 0 };
  var corePts = {}, coreRate = {};
  allGems.forEach(function (g) {
    if (!support) {
      if (lv[g.effect1] != null) lv[g.effect1] += g.effect1Level || 0;
      if (lv[g.effect2] != null) lv[g.effect2] += g.effect2Level || 0;
    }
    var k = A.coreKeyOf(g);
    corePts[k] = (corePts[k] || 0) + (g.orderLevel || 0);
    if (support && coreRate[k] == null) coreRate[k] = Math.exp(A.supportOrderValueForCore(k) / 100) - 1;
  });
  var BUK = { "Attack Power": B.attackPower, "Additional Damage": B.additionalDamage, "Boss Damage": B.bossDamage };
  function bukTerm(name, lvl) {
    var s = BUK[name];
    return Math.log((1 + s.other + lvl * (s.gridAdd / s.levels)) / (1 + s.other));
  }
  function coreTermD(pts) { return Math.log(1 + B.order.perPoint * Math.max(0, pts - 17)); }
  function coreTermS(k, pts) { return Math.log(1 + coreRate[k] * Math.max(0, pts - 17)); }
  // Returns the raw whole-grid damage change (% units) of the swap X -> N.
  return function swapDelta(X, N) {
    var k = A.coreKeyOf(X);
    var pts = corePts[k] || 0;
    var pts2 = pts - (X.orderLevel || 0) + (N.orderLevel || 0);
    if (support) {
      var dEff = A.supportEffectScore(N.effect1, N.effect1Level) + A.supportEffectScore(N.effect2, N.effect2Level)
        - A.supportEffectScore(X.effect1, X.effect1Level) - A.supportEffectScore(X.effect2, X.effect2Level);
      return dEff + 100 * (coreTermS(k, pts2) - coreTermS(k, pts));
    }
    var touched = {};
    [[X.effect1, -(X.effect1Level || 0)], [X.effect2, -(X.effect2Level || 0)],
     [N.effect1, +(N.effect1Level || 0)], [N.effect2, +(N.effect2Level || 0)]].forEach(function (p) {
      if (BUK[p[0]] != null) touched[p[0]] = (touched[p[0]] || 0) + p[1];
    });
    var d = 0;
    for (var name in touched) {
      if (!touched[name]) continue;
      d += bukTerm(name, lv[name] + touched[name]) - bukTerm(name, lv[name]);
    }
    d += coreTermD(pts2) - coreTermD(pts);
    return 100 * d;
  };
}

// ---------------- percentile helper ----------------
function pct(sortedArr, q) {
  if (!sortedArr.length) return NaN;
  var idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round(q * (sortedArr.length - 1))));
  return sortedArr[idx];
}

// ---------------- one cell ----------------
function runCell(cell, opts) {
  // No equipped gem of this cost on this side: a same-cost swap has no target, so an
  // upgrade is structurally impossible. Report it, don't simulate it.
  if (!cell.candidates.length) {
    if (opts && opts.progress) console.log("[cell] " + cell.name + "  NO same-cost slots — structurally degenerate");
    return {
      cell: cell.name, character: cell.character, gemType: cell.gemType, baseCost: cell.baseCost,
      axis: cell.axis, gpd: cell.gpd, baselineGrade: cell.baselineGrade, baseline: cell.baseline,
      candidateCount: 0, mode: "no-slots", trials: 0, batchGems: 0,
      pUpgradePerGem: 0, pUpgradeWpFree: 0, winners: null
    };
  }
  var seed = fnv1a(cell.name);
  var rand = mulberry32(seed);
  var solver = new DP.Solver(cell.baseline, cell.gpd, false, { axis: cell.axis, maxTurns: EPIC.maxTurns });
  var valueOf = (cell.axis === "support") ? A.supportValue : A.gemValue;
  var pairs = pairsOf(cell.baseCost);
  var t0 = Date.now();

  // Best-swap evaluator + self-test: delta must equal a full gridDamage recompute.
  var swapDelta = makeSwapEval(cell.allGems, cell.axis);
  var gridBase = A.gridDamage(cell.allGems, cell.axis);
  (function selfTest() {
    var probe = { baseCost: cell.baseCost, gemType: cell.gemType, willpowerLevel: 3, orderLevel: 4,
      effect1: A.EFFECT_POOLS[cell.baseCost][0], effect1Level: 5,
      effect2: A.EFFECT_POOLS[cell.baseCost][2], effect2Level: 2 };
    for (var i = 0; i < Math.min(3, cell.candidates.length); i++) {
      var cand = cell.candidates[i];
      var after = cell.allGems.slice();
      after[cand.idx] = { slot: cand.gem.slot, coreBase: cand.gem.coreBase,
        baseCost: probe.baseCost, gemType: probe.gemType,
        willpowerLevel: probe.willpowerLevel, orderLevel: probe.orderLevel,
        effect1: probe.effect1, effect1Level: probe.effect1Level,
        effect2: probe.effect2, effect2Level: probe.effect2Level };
      var full = A.gridDamage(after, cell.axis) - gridBase;
      var fast = swapDelta(cand.gem, probe);
      if (Math.abs(full - fast) > 1e-9) {
        throw new Error("swapDelta self-test failed for " + cell.name + ": full=" + full + " fast=" + fast);
      }
    }
  })();

  // Best same-cost swap, twice: willpower-free (for the tax comparison) and FEASIBLE.
  // Candidates are already same-cost, so the budget rule effCost(new) <=
  // effCost(replaced) — every observed core packs exactly to its supply (all 30
  // cores across the five rosters: 15 or 17, zero slack) — reduces to
  // wpLevel(new) >= wpLevel(replaced).
  function bestSwap(cfg) {
    var effN = A.willpowerCost(cfg.baseCost, cfg.willpowerLevel);
    var bestD = -Infinity, bestI = -1, feasD = -Infinity, feasI = -1;
    for (var i = 0; i < cell.candidates.length; i++) {
      var X = cell.candidates[i].gem;
      var d = swapDelta(X, cfg);
      if (d > bestD) { bestD = d; bestI = i; }
      if (effN <= A.willpowerCost(X.baseCost, X.willpowerLevel) && d > feasD) { feasD = d; feasI = i; }
    }
    return { dAny: bestD, iAny: bestI, dFeas: feasD, iFeas: feasI };
  }

  function oneGem() {
    var pr = pairs[Math.floor(rand() * pairs.length)];
    var pairCfg = { baseCost: cell.baseCost, gemType: cell.gemType, effect1: pr[0], effect2: pr[1] };
    var res = cutOneGem(solver, pairCfg, rand, true);
    res.value = valueOf(res.cfg);
    var bs = bestSwap(res.cfg);
    res.bestDRaw = bs.dFeas; res.bestCand = bs.iFeas;   // stop rule: best FEASIBLE swap
    res.isUpgrade = bs.dFeas > 0;
    res.isUpgradeWpFree = bs.dAny > 0;                  // same cost, willpower ignored
    return res;
  }

  // ---- batch: p-hat + winner statistics ----
  var batch = [], winners = 0, winnersWpFree = 0;
  var batchN = Math.max(BATCH, 1);
  for (var i = 0; i < batchN; i++) { var g = oneGem(); batch.push(g); if (g.isUpgrade) winners++; if (g.isUpgradeWpFree) winnersWpFree++; }
  // enlarge the batch until we have decent winner stats (or give up at 40x)
  while (winners < 200 && batch.length < batchN * 40) {
    var g2 = oneGem(); batch.push(g2); if (g2.isUpgrade) winners++; if (g2.isUpgradeWpFree) winnersWpFree++;
  }
  var pHat = winners / batch.length;
  var pWpFreeHat = winnersWpFree / batch.length;

  // ---- literal vs bootstrap trial mode ----
  var expectedGems = pHat > 0 ? TRIALS / pHat : Infinity;
  var mode = (expectedGems <= GEM_BUDGET) ? "literal" : "bootstrap";
  if (pHat === 0) mode = "degenerate";

  var trials = [];
  var gemPool = batch; // bootstrap resampling pool
  var trand = mulberry32(seed ^ 0x9E3779B9);
  var totalGems = 0;

  if (mode !== "degenerate") {
    for (var tr = 0; tr < TRIALS; tr++) {
      var gems = 0, gold = 0, goldProcess = 0, goldReroll = 0, goldReset = 0;
      var resets = 0, rerolls = 0, processes = 0, fodder = 0, winner = null, capped = false;
      for (;;) {
        var res2 = (mode === "literal") ? oneGem() : gemPool[Math.floor(trand() * gemPool.length)];
        gems++; gold += res2.spent;
        goldProcess += res2.spentProcess; goldReroll += res2.spentReroll; goldReset += res2.spentReset;
        resets += res2.resets; rerolls += res2.rerollsUsed; processes += res2.processes;
        if (res2.isUpgrade) { winner = res2; break; }
        fodder += N.calculateGemValue(res2.value, cell.baseline, cell.gpd, res2.cfg, cell.axis);
        if (gems >= GEM_CAP) { capped = true; break; }
      }
      totalGems += gems;
      trials.push({ gems: gems, gold: gold, goldProcess: goldProcess, goldReroll: goldReroll, goldReset: goldReset,
        resets: resets, rerolls: rerolls, processes: processes, fodder: fodder, winner: winner, capped: capped });
    }
  }

  // ---- aggregate ----
  function agg(field) {
    var arr = trials.map(function (x) { return x[field]; }).sort(function (a, b) { return a - b; });
    var s = 0; arr.forEach(function (v) { s += v; });
    var mean = arr.length ? s / arr.length : NaN;
    var v2 = 0; arr.forEach(function (v) { v2 += (v - mean) * (v - mean); });
    return {
      mean: mean,
      sd: arr.length > 1 ? Math.sqrt(v2 / (arr.length - 1)) : 0,
      p10: pct(arr, 0.10), p50: pct(arr, 0.50), p90: pct(arr, 0.90)
    };
  }

  // winner stats: from trials in literal/bootstrap mode.
  var wins = trials.filter(function (x) { return x.winner; }).map(function (x) { return x.winner; });
  var wStats = null;
  if (wins.length) {
    var dVal = 0, dRawGrid = 0, wpHist = {}, costHist = {}, tierHist = {}, bucketHist = {};
    var mSum = 0, valNeg = 0, gradeSum = 0;
    var replM = 0, replGrade = 0, replCostHist = {}, replWpCostHist = {};
    wins.forEach(function (w) {
      var cfg = w.cfg;
      var X = cell.candidates[w.bestCand].gem;   // the gem the best swap replaces
      dRawGrid += w.bestDRaw;
      var dv = w.value - valueOf(X);             // value delta of the CHOSEN swap (may be < 0)
      dVal += dv;
      if (dv < 0) valNeg++;
      wpHist[cfg.willpowerLevel] = (wpHist[cfg.willpowerLevel] || 0) + 1;
      var wpc = A.willpowerCost(cfg.baseCost, cfg.willpowerLevel);
      costHist[wpc] = (costHist[wpc] || 0) + 1;
      var tier = A.classifyTier(A.levelSum(cfg));
      tierHist[tier] = (tierHist[tier] || 0) + 1;
      var bk = bucketOf(cfg.baseCost, cfg.effect1, cfg.effect2, cell.axis);
      bucketHist[bk] = (bucketHist[bk] || 0) + 1;
      mSum += (cell.axis === "support") ? A.supportWillpowerMultiplier(wpc) : A.willpowerMultiplier(wpc);
      gradeSum += (cell.axis === "support") ? A.supportGrade(cfg) : A.grade(cfg);
      var xWpc = A.willpowerCost(X.baseCost, X.willpowerLevel);
      replM += (cell.axis === "support") ? A.supportWillpowerMultiplier(xWpc) : A.willpowerMultiplier(xWpc);
      replGrade += (cell.axis === "support") ? A.supportGrade(X) : A.grade(X);
      replCostHist[X.baseCost] = (replCostHist[X.baseCost] || 0) + 1;
      replWpCostHist[xWpc] = (replWpCostHist[xWpc] || 0) + 1;
    });
    var nW = wins.length;
    wStats = {
      count: nW,
      meanDValue: dVal / nW,
      meanDRawGrid: dRawGrid / nW,
      shareValueNegative: valNeg / nW,
      meanWinnerGrade: gradeSum / nW,
      meanWinnerM: mSum / nW,
      meanReplacedM: replM / nW,
      meanReplacedGrade: replGrade / nW,
      replacedCostHist: replCostHist,
      replacedWpCostHist: replWpCostHist,
      wpLevelHist: wpHist,
      wpCostHist: costHist,
      tierHist: tierHist,
      bucketHist: bucketHist
    };
  }

  var out = {
    cell: cell.name,
    character: cell.character, gemType: cell.gemType, baseCost: cell.baseCost,
    axis: cell.axis, gpd: cell.gpd,
    baselineGrade: cell.baselineGrade, baseline: cell.baseline,
    candidateCount: cell.candidates.length,
    gridBase: gridBase,
    mode: mode, seed: seed,
    batchGems: batch.length, pUpgradePerGem: pHat, pUpgradeWpFree: pWpFreeHat,
    trials: trials.length,
    cappedTrials: trials.filter(function (x) { return x.capped; }).length,
    gems: agg("gems"), gold: agg("gold"),
    goldSplit: { process: agg("goldProcess").mean, reroll: agg("goldReroll").mean, reset: agg("goldReset").mean },
    batchWinners: winners,
    resetsPerTrial: agg("resets").mean, rerollsPerTrial: agg("rerolls").mean,
    processesPerGem: (function () {
      var p = 0, g = 0;
      trials.forEach(function (x) { p += x.processes; g += x.gems; });
      return g ? p / g : NaN;
    })(),
    fodderCreditPerTrial: agg("fodder").mean,
    winners: wStats,
    solverNodes: solver.nodes,
    elapsedSec: (Date.now() - t0) / 1000
  };
  if (opts && opts.progress) {
    console.log("[cell] " + cell.name + "  mode=" + mode + "  p=" + (pHat * 100).toFixed(3) + "%  gems~" + (out.gems.mean || 0).toFixed(1) +
      "  gold~" + Math.round(out.gold.mean || 0).toLocaleString() + "  (" + out.elapsedSec.toFixed(0) + "s, " + solver.nodes + " nodes)");
  }
  return out;
}

// ---------------- profile construction ----------------
function buildCells(charFile, filters) {
  var d = JSON.parse(fs.readFileSync(charFile, "utf8"));
  var name = d.name || path.basename(charFile).replace(/^char_/, "").replace(/\.json$/, "");
  var axis = Econ.defaultModeFor(d);
  var gpd = Econ.cpToGpd(d.combatPower) || Econ.GPD_DEFAULT;
  var cells = [];
  ["order", "chaos"].forEach(function (type) {
    if (filters.type && filters.type !== type) return;
    var tb = Econ.typeBaseline(d.gems, type, axis);
    if (!tb) { console.warn("  [skip] " + name + " " + type + ": no valid gems"); return; }
    var baseline = (axis === "support") ? A.supportGradeToScore(tb.baseGrade) : A.gradeToScore(tb.baseGrade);
    [8, 9, 10].forEach(function (cost) {
      if (filters.cost && Number(filters.cost) !== cost) return;
      // replacement candidates: equipped gems of this type AND this base cost — a cut
      // gem replaces like for like (same-cost swap; Shizu's rule). Willpower
      // feasibility then reduces to wpLevel(new) >= wpLevel(replaced).
      var candidates = [];
      d.gems.forEach(function (g, i) {
        if (g.gemType !== type) return;
        if (g.baseCost !== cost) return;
        if (!A.validateConfig(g).valid) return;
        candidates.push({ idx: i, gem: g });
      });
      cells.push({
        name: name + ":" + type + ":c" + cost,
        character: name, gemType: type, baseCost: cost,
        axis: axis, gpd: gpd,
        baselineGrade: tb.baseGrade, baseline: baseline,
        candidates: candidates,
        allGems: d.gems
      });
    });
  });
  return cells;
}

// ---------------- validation mode (rollout vs exact W, resets OFF) ----------------
function validate() {
  console.log("=== upgrade-cost-study rollout validation (resets OFF, mean net vs exact W) ===");
  var RUNS = parseInt(ARGS.runs, 10) || 20000;
  var cases = [
    { cost: 9, pair: ["Boss Damage", "Attack Power"], baseline: A.gradeToScore(75), gpd: 5000000, label: "c9 2D @75/5M" },
    { cost: 10, pair: ["Boss Damage", "Additional Damage"], baseline: A.gradeToScore(65), gpd: 2500000, label: "c10 2D @65/2.5M" },
    { cost: 8, pair: ["Brand Power", "Ally Damage Enh."], baseline: A.gradeToScore(75), gpd: 5000000, label: "c8 No-bucket @75/5M" },
    { cost: 9, pair: ["Boss Damage", "Ally Damage Enh."], baseline: A.gradeToScore(90), gpd: 5000000, label: "c9 Op @90/5M" }
  ];
  var fails = 0;
  cases.forEach(function (c, ci) {
    var solver = new DP.Solver(c.baseline, c.gpd, false, { axis: "dps", maxTurns: EPIC.maxTurns });
    var startCfg = {
      baseCost: c.cost, gemType: "order", willpowerLevel: 1, orderLevel: 1,
      effect1: c.pair[0], effect1Level: 1, effect2: c.pair[1], effect2Level: 1
    };
    var wDP = solver.W(startCfg, EPIC.maxTurns, EPIC.maxRerolls, 0);
    var rand = mulberry32(fnv1a("validate" + ci));
    var sum = 0, sumSq = 0;
    for (var i = 0; i < RUNS; i++) {
      var res = cutOneGem(solver, { baseCost: c.cost, gemType: "order", effect1: c.pair[0], effect2: c.pair[1] }, rand, false);
      // dismantled fresh gems realize 0; otherwise terminal value is direct-or-fodder
      var realized = (res.processes === 0) ? 0 : N.calculateGemValue(A.gemValue(res.cfg), c.baseline, c.gpd, res.cfg, "dps");
      var x = realized - res.spent;
      sum += x; sumSq += x * x;
    }
    var mean = sum / RUNS;
    var sd = Math.sqrt(Math.max(0, sumSq / RUNS - mean * mean));
    var se = sd / Math.sqrt(RUNS);
    var d = wDP - mean;
    var genuine = Math.max(0, Math.abs(d) - 5 * se);
    var rel = genuine / Math.max(1, Math.abs(mean));
    var ok = rel <= 0.02 || Math.abs(d) <= 1500;
    if (!ok) fails++;
    console.log("  " + c.label + "  W=" + Math.round(wDP).toLocaleString() +
      "  MC=" + Math.round(mean).toLocaleString() + " ±" + Math.round(se) +
      "  Δ=" + Math.round(d) + " (" + ((Math.abs(d) / Math.max(1, Math.abs(mean))) * 100).toFixed(2) + "%)  " + (ok ? "PASS" : "*** FAIL ***"));
  });
  console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURES");
  process.exit(fails === 0 ? 0 : 1);
}

// ---------------- main ----------------
if (ARGS.validate) { validate(); }
else {
  var dir = ARGS.chars;
  if (!dir) { console.error("--chars=<dir with char_*.json> required (or --validate)"); process.exit(1); }
  var files = fs.readdirSync(dir).filter(function (f) { return /^char_.*\.json$/.test(f); });
  if (ARGS.char) files = files.filter(function (f) { return f.toLowerCase() === ("char_" + ARGS.char + ".json").toLowerCase(); });
  if (!files.length) { console.error("no char_*.json matched in " + dir); process.exit(1); }
  var results = [];
  files.forEach(function (f) {
    var cells = buildCells(path.join(dir, f), { type: ARGS.type, cost: ARGS.cost });
    cells.forEach(function (cell) {
      results.push(runCell(cell, { progress: !!ARGS.progress }));
    });
  });
  var outPath = ARGS.out || path.join(dir, "study-results" + (ARGS.char ? "-" + ARGS.char : "") + ".json");
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), trials: TRIALS, results: results }, null, 2));
  console.log("wrote " + outPath + " (" + results.length + " cells)");
}
