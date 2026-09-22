/**
 * arkgrid-account.js — simulate an account building its ark grid.
 *
 *   node tools/arkgrid-account.js --rarity=rare --n=4000 --out=data/arkgrid-account-rare.json
 *
 * The band model says a grid is "24 gems at grade X". That is enough to price
 * the ladder but not to show one, because it throws away the spread: the band
 * is set by the WEAKEST of the 24, and the other 23 sit above it. Two players
 * both sitting on A+ can hold quite different grids.
 *
 * So this builds the grid the way a player does. Cut a gem with the advisor at
 * your current baseline; if it adds more damage than your weakest slot does,
 * socket it and the old one is gone. Your baseline is then the grade of the new
 * weakest, which is the app's own advice, so the advisor tracks you as you
 * improve. Duds that reach relic fuse with two legendary fodder.
 *
 * Sockets are decided on DAMAGE, not on grade. The two do not move together: a
 * gem can grade higher on its willpower and order credit while putting less
 * into the side nodes, so swapping on grade can lower the grid. Grade still
 * names the band, because that is what the app's baseline advice reads.
 *
 * The trace is monotone in gold, so one account answers every budget: walk it
 * and stop where one more gem stops paying,
 *
 *     gold for the next gem / (damage it adds x 3 dealers)  >  your gold per damage
 *
 * and report the grid standing there — its weakest grade (the band), its mean,
 * its node levels and what it cost in gems and weeks.
 */
"use strict";
var QUIET = require("./quiet-hours.js");
var REPO = "C:/Users/Shizu/loastuff/loa-astrogem-calc";
var A = require(REPO + "/model/astrogem.js");

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) ARGS[m[1]] = m[2] === undefined ? true : m[2];
});
var RARITY = String(ARGS.rarity || "epic");
if (!A.RARITY[RARITY]) throw new Error("unknown rarity " + RARITY);
var BUDGET_RARITY = { maxTurns: A.RARITY[RARITY].maxTurns, maxRerolls: A.RARITY[RARITY].maxRerolls };
A.RARITY.epic.maxTurns = BUDGET_RARITY.maxTurns;
A.RARITY.epic.maxRerolls = BUDGET_RARITY.maxRerolls;

var DP = require(REPO + "/model/dp.js");
var Engine = require(REPO + "/tools/lib/cut-engine.js");
var DPX = require("./dp-extract.js");
var fsMod = require("fs"), pathMod = require("path");
var mulberry32 = Engine.mulberry32, fnv1a = Engine.fnv1a, cutOneGem = Engine.cutOneGem;

var SLOTS = 24;
// The grid is two separate halves and a gem cannot cross between them: an order
// gem only ever goes in an order core. So the account keeps two pools of twelve
// and a fresh gem only competes with its own kind.
//
// The six cores pay different rates per order/chaos point — Chaos Moon is worth
// more than twice Order Star — and coreKeyOf reads these IDs, so passing 0..5
// silently fell back to the average rate for all six.
var CORES = {
  order: [10002, 10001, 10003],   // Moon 0.0702, Sun 0.0682, Star 0.0486
  chaos: [10005, 10006, 10004]    // Moon 0.1052, Star 0.0869, Sun 0.0826
};
var HALF = 12;
var CUTS_PER_WEEK = { uncommon: 70, rare: 26, epic: 9 };
var AXIS = String(ARGS.axis || "support");
var PARTY = AXIS === "dps" ? 1 : 3;
// Axis facade: every grading, damage, ladder and order-rate call routes
// through AX, so the same account machinery runs both charts. gemDamage =
// effects + order, so DPS effects-only = gemDamage minus the order part.
var DPP = A.orderScore(5) - A.orderScore(4);
var AX = AXIS === "dps" ? {
  grade: function (g) { return A.grade(g); },
  dmgFull: function (g) { return A.gemDamage(g); },
  dmgEff: function (g) { return A.gemDamage(g) - A.orderScore(g.orderLevel || 0); },
  ladder: A.RANK_LADDER,
  gridDamage: function (p) { return A.gridDamage(p, "dps"); },
  orderRate: function () { return Math.exp(DPP / 100) - 1; },
  gradeToScore: A.gradeToScore
} : {
  grade: function (g) { return A.supportGrade(g); },
  dmgFull: function (g) { return A.supportDamage(g); },
  dmgEff: function (g) { return A.supportDamage(g, 0); },
  ladder: A.SUPPORT_RANK_LADDER,
  gridDamage: function (p) { return A.gridDamage(p, "support"); },
  orderRate: function (coreId) { return Math.exp(A.supportOrderValueForCore(coreId) / 100) - 1; },
  gradeToScore: A.supportGradeToScore
};
var N = parseInt(ARGS.n, 10) || 4000;          // gems cut per account
var SEED = String(ARGS.seed || "gpd-2026-08-14");
// default is the original eight; --gpds=comma-list overrides so the anchor
// sweep can shard the 28-tier grid across processes
var GPDS = ARGS.gpds
  ? String(ARGS.gpds).split(",").map(function (x) { return parseInt(x, 10); })
  : [250000, 500000, 1000000, 2000000, 4000000, 8000000, 16000000, 25000000];
var MIX = { 8: 0.6, 9: 0.3, 10: 0.1 };
// --draw=dd samples finished gems from the EXACT per-cell distribution the
// extractor computes (game mode: sequential law, decide's gate, ledger gold),
// instead of walking nine turns per gem. Cells cache to disk and are shared
// by every shard; once warm, a draw is a binary search.
var DRAW = String(ARGS.draw || "mc");
var CELL_DIR = "data/cells/" + (AXIS === "dps" ? "dps-" : "") + RARITY;
if (DRAW === "dd") fsMod.mkdirSync(CELL_DIR, { recursive: true });
var cfgTables = { 8: DPX.buildCfgTable(8), 9: DPX.buildCfgTable(9), 10: DPX.buildCfgTable(10) };
var cellCache = {}, cellOrder = [];
function cellFor(cost, pairIdx, band, gpd) {
  var key = cost + "_" + pairIdx + "_" + band + "_" + gpd;
  var got = cellCache[key];
  if (got) return got;
  var file = pathMod.join(CELL_DIR, "bl" + band + "-g" + gpd + "-c" + cost + "-p" + pairIdx + ".json");
  var cell;
  if (fsMod.existsSync(file)) {
    var d = JSON.parse(fsMod.readFileSync(file, "utf8"));
    cell = { fin: Float64Array.from(d.fin), finG: Float64Array.from(d.finG),
      dis: d.dis, disG: d.disG };
  } else {
    // share the account's own solver so a block's 18 cells reuse one DP memo
    var ex = DPX.extract({ rarity: RARITY, cost: cost, pair: pairIdx, baseline: band,
      gpd: gpd, roster: ROSTER, axis: AXIS, mode: "game", allowReset: true,
      solver: solverFor(band, gpd) });
    cell = { fin: ex.fin, finG: ex.finG, dis: ex.dis, disG: ex.disG };
    var tmp = file + "." + process.pid + ".tmp";
    fsMod.writeFileSync(tmp, JSON.stringify({ fin: Array.from(ex.fin),
      finG: Array.from(ex.finG), dis: ex.dis, disG: ex.disG, sig: A.MODEL_SIG }));
    fsMod.renameSync(tmp, file);
  }
  // prefix sums over the 3,751 atoms for O(log n) sampling
  var cum = new Float64Array(3751), acc = 0;
  for (var i = 0; i < 3750; i++) { acc += cell.fin[i]; cum[i] = acc; }
  cum[3750] = acc + cell.dis;
  cell.cum = cum; cell.tot = cum[3750];
  cellCache[key] = cell;
  cellOrder.push(key);
  if (cellOrder.length > 4000) delete cellCache[cellOrder.shift()];
  return cell;
}
/** One gem, drawn from the exact distribution. Mirrors cutOneGem's contract. */
function drawGemDD(cost, pairIdx, band, gpd, rand) {
  var cell = cellFor(cost, pairIdx, band, gpd);
  var x = rand() * cell.tot, lo = 0, hi = 3750;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (cell.cum[mid] < x) lo = mid + 1; else hi = mid; }
  if (x > cell.cum[3749]) {                          // the dismantled atom
    return { spent: cell.dis > 0 ? cell.disG / cell.dis : 0, processes: 0, cfg: null };
  }
  var mass = cell.fin[lo];
  return { spent: mass > 0 ? cell.finG[lo] / mass : 0, processes: 1,
    cfg: cfgTables[cost][lo] };
}
var NODES = AXIS === "dps"
  ? ["Attack Power", "Additional Damage", "Boss Damage"]
  : ["Ally Attack Enh.", "Brand Power", "Ally Damage Enh."];
var SHORT = AXIS === "dps"
  ? { "Attack Power": "atk", "Additional Damage": "add dmg", "Boss Damage": "boss" }
  : { "Ally Attack Enh.": "ally atk", "Brand Power": "brand", "Ally Damage Enh.": "ally dmg" };

function pairsOf(cost) {
  var pool = A.EFFECT_POOLS[cost], out = [];
  for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) out.push([pool[i], pool[j]]);
  return out;
}
var PAIRS = { 8: pairsOf(8), 9: pairsOf(9), 10: pairsOf(10) };

// Solvers are by far the expensive part — a whole DP solve each — so they are
// cached and the baseline is snapped to the grade band it sits in. A player
// does not re-read the advisor over a tenth of a grade, and snapping keeps the
// solver count to twelve bands rather than forty-odd grade points.
var BAND_CUTS = AX.ladder.slice().reverse().map(function (r) {
  return r[1] === -Infinity ? 0 : r[1];
});
function snap(g) {
  var q = BAND_CUTS[0];
  for (var i = 0; i < BAND_CUTS.length; i++) if (g >= BAND_CUTS[i]) q = BAND_CUTS[i];
  return q;
}
// Roster-bound, matching the fitted corpus and the calculator's own default
// advice since astrogems stopped being sellable. Off, the DP abandons gems to
// save gold the cutter charges anyway, and the chart reads cheaper than a
// player following the site's advisor actually pays.
var ROSTER = true;
// The cache holds at most a handful of solvers. A deep epic run kept every
// (band, gpd) solver it ever built — the nine-turn memos run to hundreds of
// megabytes each — and died of heap. Baselines only climb inside a run, so
// evicting the oldest costs nearly nothing.
// Warm across every account of one budget — a hundred accounts climb the same
// band sequence, and refilling a nine-turn memo per account was most of the
// bill — then cleared when the budget changes, because another gpd's memos are
// dead weight and the epic ones run to hundreds of megabytes.
var solverCache = {}, solverOrder = [], solverGpd = null;
function solverFor(baseline, gpd) {
  if (gpd !== solverGpd) { solverCache = {}; solverOrder = []; solverGpd = gpd; }
  var q = snap(baseline);
  var key = q + "_" + gpd;
  if (!solverCache[key]) {
    solverCache[key] = new DP.Solver(AX.gradeToScore(q), gpd, ROSTER,
      { axis: AXIS, maxTurns: BUDGET_RARITY.maxTurns });
    solverOrder.push(key);
    while (solverOrder.length > 10) delete solverCache[solverOrder.shift()];
  }
  return solverCache[key];
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

/**
 * Pack one half's three cores out of everything that half owns.
 *
 * A core is FOUR gems and holds two separate seventeens, pulling against each
 * other:
 *
 *   willpower  the four effective costs (baseCost - willpowerLevel) must fit
 *              inside 17. The perfect core is exactly 5+5+4+3.
 *   order      only the order points ABOVE 17 pay anything, and four gems can
 *              reach 20, so the last three points are the whole prize.
 *
 * So a gem is never good or bad on its own — a cheap high-willpower gem earns
 * its place by letting an expensive one fit beside it. That is also why gems
 * you are not wearing still matter: a core can be re-packed 4+4+4+5 into
 * 3+4+5+5 using something already in the box, which is Shizu's point and the
 * reason this keeps an inventory instead of only the equipped twelve.
 *
 * Each core is solved exactly, best-paying core first, by a small DP over
 * (gems used, willpower spent, order points). The state space is 4 x 18 x 21,
 * so this is cheap enough to redo whenever the inventory changes.
 */
var CORE_WP = 17, ORDER_FLOOR = 17, PER_CORE = 4;
function effCost(g) { return g.baseCost - (g.willpowerLevel || 0); }

/**
 * A core that misses seventeen order points does not merely earn nothing — it
 * taxes the WHOLE grid. Ported from the astrogem calculator's own account study
 * (tools/account-study.js, Shizu 2026-08-09), where it is applied log-additively
 * per core so the multiplier lands on the total.
 *
 * Three percent sounds mild and is not: on the support axis it is worth about
 * ninety to a hundred and ninety order points depending on the core, far more
 * than any side-node trade can return. That is
 * deliberate — it makes the packer force 17+ wherever the collection allows,
 * rather than quietly settling for a fourteen-point core with prettier lines.
 */
function bandPenalty(pts) {
  if (pts >= 17) return 0;
  if (pts >= 14) return 0.03;
  if (pts >= 10) return 0.06;
  return 0.09;
}

var WSPAN = CORE_WP + 1, DSPAN = 4 * 5 + 1, NSTATE = (PER_CORE + 1) * WSPAN * DSPAN;
function stateIdx(u, w, d) { return (u * WSPAN + w) * DSPAN + d; }

// Scratch buffers, reused across calls — this runs after every socketed gem and
// allocating a fresh DP each time was the whole cost of the simulation.
var _score = new Float64Array(NSTATE);
var _prev = new Int32Array(NSTATE);
var _took = new Int32Array(NSTATE);

function packCore(pool, rate) {
  _score.fill(-Infinity);
  _prev.fill(-1);
  _took.fill(-1);
  _score[stateIdx(0, 0, 0)] = 0;
  for (var i = 0; i < pool.length; i++) {
    var g = pool[i], c = effCost(g), o = g.orderLevel || 0;
    if (c > CORE_WP) continue;
    var eff = AX.dmgEff(g);                   // effects only; order priced below
    for (var u = PER_CORE - 1; u >= 0; u--) {
      for (var w = 0; w + c <= CORE_WP; w++) {
        for (var d = 0; d + o < DSPAN; d++) {
          var from = stateIdx(u, w, d);
          var base = _score[from];
          if (base === -Infinity) continue;
          var to = stateIdx(u + 1, w + c, d + o);
          var val = base + eff;
          if (val > _score[to]) { _score[to] = val; _prev[to] = from; _took[to] = i; }
        }
      }
    }
  }
  var winner = -1, winVal = -Infinity;
  for (var w2 = 0; w2 <= CORE_WP; w2++) {
    for (var d2 = 0; d2 < DSPAN; d2++) {
      var st = stateIdx(PER_CORE, w2, d2);
      if (_score[st] === -Infinity) continue;
      var total = _score[st] + 100 * Math.log(1 + rate * Math.max(0, d2 - ORDER_FLOOR))
        + 100 * Math.log(1 - bandPenalty(d2));
      if (total > winVal) { winVal = total; winner = st; }
    }
  }
  if (winner < 0) return null;
  var picks = [];
  for (var cur = winner; cur >= 0 && _took[cur] >= 0; cur = _prev[cur]) picks.push(_took[cur]);
  return { picks: picks, value: winVal };
}

/**
 * Best legal layout of a half: three cores, four gems each, from the inventory.
 *
 * The cores are filled greedily one after another, which depends on the order
 * they are filled in — so all six orderings of the three cores are tried and
 * the best total kept. Not a full joint solve, but it removes the one bias the
 * fixed ordering had: the first core skimming gems a later core needed more.
 */
var PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function packHalf(inv, half) {
  var bestPlaced = null, bestVal = -Infinity;
  for (var pi = 0; pi < PERMS.length; pi++) {
    var left = inv.slice(), placed = [], val = 0, ok = true;
    for (var k = 0; k < 3 && ok; k++) {
      var coreId = CORES[half][PERMS[pi][k]];
      // supportOrderValueForCore returns log-damage per point; the order
      // bracket needs the linear rate, exp(v/100)-1, exactly as the
      // calculator converts it (astrogem.js supportGridDamage)
      var rate = AX.orderRate(coreId);
      var got = packCore(left, rate);
      if (!got) { ok = false; break; }
      val += got.value;
      var taken = {};
      got.picks.forEach(function (idx) {
        taken[idx] = true;
        placed.push(Object.assign({}, left[idx], { coreBase: coreId }));
      });
      left = left.filter(function (_, idx) { return !taken[idx]; });
    }
    if (ok && val > bestVal) { bestVal = val; bestPlaced = placed; }
  }
  return bestPlaced;
}

/**
 * The grid's damage and its node levels.
 *
 * The band penalty is NOT subtracted here, on purpose. Its job is in the
 * packer's objective, where it forces cores to seventeen the way Shizu ruled
 * ("even -3% should be enough to force all 17s"). Physically it stands for the
 * core threshold bonuses a sub-17 core fails to unlock — and those live in the
 * gear baseline (the weapon core's flats), not in this row. Subtracting it
 * here made low-budget grids report NEGATIVE damage, which no set of equipped
 * gems can do to a character. So the packer avoids sub-17 cores at almost any
 * cost, and the number reported is the damage the worn grid actually adds.
 */
// display order for the six cores: order half then chaos half, each in the
// CORES arrays' own sequence, so the card reads the same grid every time
var CORE_SEQ = CORES.order.concat(CORES.chaos);
function gridState(packed) {
  var placed = packed.order.concat(packed.chaos);
  var per = {};
  placed.forEach(function (g) { per[g.coreBase] = (per[g.coreBase] || 0) + (g.orderLevel || 0); });
  var node = [0, 0, 0], pts = 0, corePts = {};
  placed.forEach(function (g) {
    for (var q = 0; q < 3; q++) {
      if (g.effect1 === NODES[q]) node[q] += g.effect1Level;
      if (g.effect2 === NODES[q]) node[q] += g.effect2Level;
    }
    pts += g.orderLevel || 0;
    corePts[g.coreBase] = (corePts[g.coreBase] || 0) + (g.orderLevel || 0);
  });
  // THE AXIS FACADE EXISTS FOR THIS. Hardcoding "support" here scored every
  // DPS grid with the support damage model, which does not recognise Attack
  // Power / Additional Damage / Boss Damage effects at all: the same grid
  // reads 11.55 through the dps model and 1.10 through support, a 10.5x
  // understatement. Every DPS account therefore saw its own improvements as
  // near-worthless, stopped about ten times too early, and produced a ladder
  // of four rungs. Caught 2026-09-21 when Shizu said the DPS ark grid did not
  // make sense to him.
  return { damage: AX.gridDamage(placed), node: node, cores: pts / 6,
    perCore: CORE_SEQ.map(function (id) { return per[id] || 0; }) };
}

/**
 * One account. Each cut is an order gem or a chaos one and can only ever go in
 * its own half. Everything cut is KEPT: an unequipped gem is not waste, it is a
 * packing option, so the inventory is what gets solved rather than a fixed
 * twenty-four.
 *
 * The inventory is pruned to the best few dozen a side. Solving the pack is
 * cheap but not free, and a gem outside the top of the pile can never earn a
 * core slot — it is beaten on damage AND it frees no willpower a better gem
 * does not free more of.
 */
var KEEP = 26;

function runAccount(gpd, rep) {
  var rand = mulberry32(fnv1a("acct:" + SEED + ":" + RARITY + ":" + (rep || 0)));
  var inv = { order: [], chaos: [] };
  var packed = { order: null, chaos: null };
  var trace = [], gold = 0, cut = 0, lastImpGold = 0;

  while (cut < N) {
    var half = rand() < 0.5 ? "order" : "chaos";
    var eq = packed[half];
    // the advisor's baseline is the weakest grade you are actually wearing
    var weakest = eq ? Math.min.apply(null, eq.map(function (g) { return AX.grade(g); })) : 0;
    var r0 = rand();
    var cost = r0 < MIX[8] ? 8 : (r0 < MIX[8] + MIX[9] ? 9 : 10);
    var pr = PAIRS[cost][Math.floor(rand() * PAIRS[cost].length)];
    var res = DRAW === "dd"
      ? drawGemDD(cost, PAIRS[cost].indexOf(pr), snap(weakest), gpd, rand)
      : cutOneGem(solverFor(weakest, gpd),
          { baseCost: cost, gemType: half, effect1: pr[0], effect2: pr[1] }, rand, true);
    gold += res.spent;
    cut++;
    var got = res.processes > 0 ? res.cfg : null;
    if (!got) continue;

    var mine = inv[half];
    var fused = false;
    mine.push(got);
    if (mine.length > KEEP) {
      // Choose the drop, and never a budget-enabler if it can be helped: a gem
      // at effective cost four or less is willpower headroom, and the packer
      // turns headroom into damage the gem itself does not carry. Pruning on
      // damage alone would throw away precisely the gems that make 5+5+4+3
      // cores possible.
      var dropAt = function () {
        mine.sort(function (a, b) { return AX.dmgFull(b) - AX.dmgFull(a); });
        for (var j = mine.length - 1; j >= 0; j--) if (effCost(mine[j]) > 4) return j;
        return mine.length - 1;
      };
      var drop = mine.splice(dropAt(), 1)[0];
      fused = true;              // the pack may have been wearing the drop
      // a dud deep in the pile is worth fusing rather than carrying
      if (A.levelSum(drop) >= 16) {
        gold += A.COSTS.fusion;
        var outTier = drawTier(A.fusionOutputDist([A.classifyTier(A.levelSum(drop)), "legendary", "legendary"]), rand);
        if (outTier !== "legendary") {
          mine.push(sampleTierGem(drop.baseCost, outTier, rand, half));
          if (mine.length > KEEP) mine.splice(dropAt(), 1);
        }
      }
    }
    // Repack unless the new gem is dominated on every axis a core can want —
    // less damage than everything worn, no cheaper willpower, no more order
    // points. Such a gem cannot enter any optimal core, and most cuts produce
    // one; skipping them is what makes a hundred accounts a budget affordable.
    // Fusion always repacks: it REMOVED a gem, so the pack must be re-solved.
    var mustPack = fused || !packed[half];
    if (!mustPack) {
      var gD = AX.dmgFull(got), gC = effCost(got), gO = got.orderLevel || 0;
      var minD = Infinity, maxC = 0, minO = Infinity;
      for (var pi2 = 0; pi2 < packed[half].length; pi2++) {
        var pg = packed[half][pi2];
        var d2 = AX.dmgFull(pg);
        if (d2 < minD) minD = d2;
        var c2 = effCost(pg);
        if (c2 > maxC) maxC = c2;
        var o2 = pg.orderLevel || 0;
        if (o2 < minO) minO = o2;
      }
      mustPack = gD > minD || gC < maxC || gO > minO;
    }
    if (mustPack) packed[half] = packHalf(mine, half) || packed[half];
    // a drought so long that even a generous future socket (0.1% a dealer at
    // twice the budget) could not repay it ends the account: the stop rule
    // would never buy anything past this point
    if (trace.length && (gold - lastImpGold) > gpd * 0.6) break;
    if (packed.order && packed.chaos) {
      var st = gridState(packed);
      var all = packed.order.concat(packed.chaos);
      var grades = all.map(function (g) { return AX.grade(g); });
      if (!trace.length || st.damage > trace[trace.length - 1].damage + 1e-9) lastImpGold = gold;
      trace.push({ gold: gold, cut: cut, damage: st.damage,
        weakest: Math.min.apply(null, grades),
        mean: grades.reduce(function (a, b) { return a + b; }, 0) / SLOTS,
        node: st.node.slice(), cores: st.cores, perCore: st.perCore });
    }
  }
  return trace;
}

function letterOf(g) {
  var L = AX.ladder;
  for (var i = 0; i < L.length; i++) if (g >= L[i][1] - 1e-9) return L[i][0];
  return "F-";
}

// --reps takes one number or a comma list aligned to the budgets: a hundred
// cheap accounts cost less than five dear ones, so the sampling goes where
// the gold is thin and the rung selection actually reads.
var REPS_LIST = String(ARGS.reps || "1").split(",").map(function (x) { return parseInt(x, 10) || 1; });
function repsFor(gi) { return REPS_LIST[Math.min(gi, REPS_LIST.length - 1)]; }

/** One account's stopping point at this budget. */
function stopAt(gpd, rep) {
  var trace = runAccount(gpd, rep);
  // Until twelve gems a side can form three cores inside their willpower
  // budget there is no legal grid at all, so an account can finish with an
  // empty trace. That is a real outcome, not an error: it says this budget
  // never reached a wearable grid.
  if (!trace.length) return null;
  // Stop where continuing stops paying. The first version tested a fixed
  // twelve-CUT window and quit at the first crossing — but at higher grids an
  // improvement lands once in fifty cuts, so nearly every window is a drought
  // and the account quit at the first dry spell. A 25M account was stopping
  // after a sixth of its cuts, which is why the chart recommended tiers Shizu
  // could smell were too low.
  //
  // The honest accounting: a dry cut's gold belongs to the next improvement
  // it eventually buys. So the trace reduces to improvement EVENTS carrying
  // all gold since the previous event, events pool into groups of five to tame
  // single-event noise, and the account stops after the LAST group that still
  // paid inside the budget — a later cheap group can rescue an expensive
  // stretch, which is exactly how sunk droughts work.
  var events = [], lastIdx = 0;
  for (var i = 1; i < trace.length; i++) {
    if (trace[i].damage > trace[lastIdx].damage + 1e-9) {
      events.push({ gold: trace[i].gold - trace[lastIdx].gold,
                    dmg: trace[i].damage - trace[lastIdx].damage, idx: i });
      lastIdx = i;
    }
  }
  // Groups of five events tame single-event noise; PAVA then pools adjacent
  // groups whenever a later one is cheaper per damage, so an expensive stretch
  // and the cheap group behind it merge into one purchase — bought only if the
  // POOLED rate fits the budget. The first version accepted any group that fit
  // on its own, which quietly bought the dear stretch in front of it: a 1M
  // budget was averaging 1.27M per percent. Pooled blocks have monotone rates,
  // so the stop is a clean first crossing.
  var GROUP = 5, blocks = [];
  for (var g = 0; g < events.length; g += GROUP) {
    var slice = events.slice(g, g + GROUP);
    var gG = 0, gD = 0;
    slice.forEach(function (e) { gG += e.gold; gD += e.dmg; });
    blocks.push({ gold: gG, dmg: gD, idx: slice[slice.length - 1].idx });
    while (blocks.length > 1) {
      var a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      if (b.gold / b.dmg >= a.gold / a.dmg) break;
      blocks.splice(blocks.length - 2, 2,
        { gold: a.gold + b.gold, dmg: a.dmg + b.dmg, idx: b.idx });
    }
  }
  var stop = trace[0], capped = true;
  for (var bi = 0; bi < blocks.length; bi++) {
    if (blocks[bi].gold / (blocks[bi].dmg * PARTY) > gpd) { capped = false; break; }
    stop = trace[blocks[bi].idx];
  }
  // ARKGRID_DUMP_BLOCKS=1: print the pooled sequence the crossing test saw —
  // evidence for stop-rule audits, dead in normal runs
  if (process.env.ARKGRID_DUMP_BLOCKS && rep < 3) {
    console.error("blocks rep " + rep + " (gpd " + gpd + "):");
    blocks.forEach(function (b, i) {
      console.error("  #" + i + "  gold " + Math.round(b.gold / 1000) + "k  dmg " +
        b.dmg.toFixed(4) + "  rate " + Math.round(b.gold / (b.dmg * PARTY) / 1000) +
        "k  thru gem " + trace[b.idx].cut);
    });
  }
  // capped means even the final group was worth buying: the account ran out
  // of gems, not of reasons — the tier reported is a floor, so raise N
  stop = Object.assign({ capped: capped }, stop);
  // Every band the account CROSSED on its way to the stop, with the state the
  // moment the gems' mean first cleared the cut. Budget stops alone made the
  // chart skip grades — no budget's optimum lands on B+, so B+ vanished. The
  // rungs give the ladder every letter an account actually passed through.
  var LADDER_ASC = AX.ladder.slice().reverse();
  var stopIdx = trace.indexOf(stop.capped != null ? trace.find(function (t) {
    return t.gold === stop.gold && t.cut === stop.cut; }) : stop);
  if (stopIdx < 0) stopIdx = trace.length - 1;
  // A band's crossing is recorded SUSTAINED: from the point after which the
  // worn mean never again dips below the cut before the stop. The first touch
  // catches a lucky wobble of a mean the packer optimizes for damage, not
  // grade — measured on 62k accounts it underprices the high bands by 3-4%
  // and, worse, flattens the marginal curve between rungs, which is what hid
  // B behind B+ on the chart. The first-touch state rides along as fGold for
  // reference.
  var crossings = [];
  LADDER_ASC.forEach(function (row) {
    var cut = row[1] === -Infinity ? 0 : row[1];
    var first = null, lastBelow = -1;
    for (var ci = 0; ci <= stopIdx; ci++) {
      if (first === null && trace[ci].mean >= cut) first = ci;
      if (trace[ci].mean < cut) lastBelow = ci;
    }
    if (first === null) return;
    var sus = lastBelow + 1 <= stopIdx && trace[lastBelow + 1] ? lastBelow + 1 : first;
    crossings.push(Object.assign({ band: row[0], fGold: trace[first].gold }, trace[sus]));
  });
  stop.crossings = crossings;
  // --xcross=<file>: bias instrumentation. Alongside the FIRST touch of each
  // cut, record the SUSTAINED crossing — the point after which the worn mean
  // never again dips below the cut before the stop (swaps optimize damage,
  // not mean grade, so the mean can regress). First-touch catches lucky
  // wobbles and flattens the marginal curve between rungs; this measures by
  // how much. One JSON line per account, raw golds for honest error bars.
  if (ARGS.xcross) {
    var xrec = { gpd: gpd, rep: rep, stopGold: stop.gold, capped: !!stop.capped, bands: {} };
    LADDER_ASC.forEach(function (row) {
      var cut = row[1] === -Infinity ? 0 : row[1];
      var first = null, lastBelow = -1;
      for (var ci = 0; ci <= stopIdx; ci++) {
        if (first === null && trace[ci].mean >= cut) first = ci;
        if (trace[ci].mean < cut) lastBelow = ci;
      }
      if (first === null) return;
      var sus = lastBelow + 1 <= stopIdx && trace[lastBelow + 1] ? lastBelow + 1 : null;
      xrec.bands[row[0]] = {
        f: [trace[first].gold, trace[first].damage, trace[first].cut],
        s: sus !== null ? [trace[sus].gold, trace[sus].damage, trace[sus].cut] : null
      };
    });
    require("fs").appendFileSync(ARGS.xcross, JSON.stringify(xrec) + "\n");
  }
  return stop;
}

// One account is one sample and samples wobble — a richer budget can land a
// slightly worse grid than a poorer one, which must never show on the card.
// Averaging several accounts per budget settles it honestly. The DP solvers are
// cached across reps, so the extra cost is cutting, not solving.
var _t0 = process.hrtime.bigint();
var CROSS = {};   // band -> gpd -> { sums..., count }
function feedCross(gpd, c) {
  var byG = CROSS[c.band] = CROSS[c.band] || {};
  var a = byG[gpd] = byG[gpd] || { gold: 0, fGold: 0, damage: 0, cut: 0, mean: 0, weakest: 0,
    cores: 0, node: [0, 0, 0], perCore: [0, 0, 0, 0, 0, 0], count: 0, golds: [] };
  a.gold += c.gold; a.fGold += (c.fGold != null ? c.fGold : c.gold); a.damage += c.damage; a.cut += c.cut;
  a.mean += c.mean; a.weakest += c.weakest; a.cores += c.cores;
  // raw sustained golds, kept in memory only: the cell's price is the MEDIAN,
  // which the conditional mean cannot give us — at 80% coverage the mean of
  // the crossers alone runs about 7% under the population's typical cost
  a.golds.push(Math.round(c.gold));
  for (var k = 0; k < 3; k++) a.node[k] += c.node[k];
  for (var q = 0; q < 6; q++) a.perCore[q] += (c.perCore ? c.perCore[q] : 0);
  a.count++;
}

function writeOut(partial) {
  if (!ARGS.out) return;
  require("fs").writeFileSync(ARGS.out, JSON.stringify({
    rarity: RARITY, slots: SLOTS, cutsPerWeek: CUTS_PER_WEEK[RARITY],
    turns: BUDGET_RARITY.maxTurns, rerolls: BUDGET_RARITY.maxRerolls,
    n: N, party: PARTY, sig: A.MODEL_SIG, draw: DRAW, axis: AXIS, partial: partial, rows: out
  }, null, 1));
}

var out = [];
GPDS.forEach(function (gpd, gi) {
  var REPS = repsFor(gi);
  console.error("  gpd " + (gpd / 1e6).toFixed(2) + "M  x" + REPS + " accounts  at " +
    (Number(process.hrtime.bigint() - _t0) / 1e9).toFixed(0) + "s");
  var acc = { gold: 0, cut: 0, damage: 0, weakest: 0, mean: 0, cores: 0,
              node: [0, 0, 0], perCore: [0, 0, 0, 0, 0, 0] };
  var got = 0, cappedReps = 0;
  for (var r = 0; r < REPS; r++) {
    if (r && r % 10 === 0) {
      console.error("    rep " + r + "/" + REPS + "  at " +
        (Number(process.hrtime.bigint() - _t0) / 1e9).toFixed(0) + "s");
      // yield the machine during Shizu's prime hours; progress is kept and
      // the tier resumes on its own (tools/quiet-hours.js)
      QUIET.waitIfQuiet(function (m) { console.error(m); });
    }
    var st = stopAt(gpd, r);
    if (!st) continue;
    got++;
    if (st.capped) cappedReps++;
    (st.crossings || []).forEach(function (c) { feedCross(gpd, c); });
    acc.gold += st.gold; acc.cut += st.cut; acc.damage += st.damage;
    acc.weakest += st.weakest; acc.mean += st.mean; acc.cores += st.cores;
    for (var k = 0; k < 3; k++) acc.node[k] += st.node[k];
    for (var q = 0; q < 6; q++) acc.perCore[q] += (st.perCore ? st.perCore[q] : 0);
  }
  if (!got) {
    out.push({ gpd: gpd, reachable: false });
    writeOut(true);                              // checkpoint: one tier per write
    return;
  }
  function avg(v) { return v / got; }
  out.push({
    gpd: gpd, gold: Math.round(avg(acc.gold)), gems: Math.round(avg(acc.cut)),
    weeks: avg(acc.cut) / CUTS_PER_WEEK[RARITY],
    damage: Number(avg(acc.damage).toFixed(4)),
    band: letterOf(avg(acc.weakest)),
    weakest: Number(avg(acc.weakest).toFixed(1)),
    mean: Number(avg(acc.mean).toFixed(1)),
    meanBand: letterOf(avg(acc.mean)),
    cores: Math.round(avg(acc.cores)),
    capped: cappedReps > 0,
    perCore: acc.perCore.map(function (v) { return Math.round(avg(v)); }),
    nodes: NODES.map(function (n, k) { return [SHORT[n], Math.round(avg(acc.node[k]))]; })
  });
  writeOut(true);                                // checkpoint: one tier per write
});

// One account per budget is one sample, and samples wobble: a richer budget
// occasionally lands a slightly worse grid than a poorer one, which must never
// show on the card. Carry the best grid so far up the budget axis. Averaging
// several accounts per budget would be the better fix and needs a longer run.
for (var i = 1; i < out.length; i++) {
  if (out[i].damage < out[i - 1].damage) {
    var keep = out[i].gpd, g = out[i].gold, gems = out[i].gems, wk = out[i].weeks;
    out[i] = JSON.parse(JSON.stringify(out[i - 1]));
    out[i].gpd = keep;
    // the cost of standing here is still what THIS budget paid for it
    out[i].gold = Math.max(g, out[i - 1].gold);
    out[i].gems = Math.max(gems, out[i - 1].gems);
    out[i].weeks = Math.max(wk, out[i - 1].weeks);
  }
}

console.log(RARITY + " — " + N.toLocaleString() + " gems cut per account, " +
  CUTS_PER_WEEK[RARITY] + " cuts a week\n");
console.log("budget".padStart(8) + "gems".padStart(7) + "weeks".padStart(7) + "gold".padStart(9) +
  "band".padStart(6) + "weakest".padStart(9) + "mean".padStart(7) + "damage".padStart(9) + "  nodes");
out.forEach(function (r) {
  console.log(((r.gpd / 1e6).toFixed(2) + "M").padStart(8) + String(r.gems).padStart(7) +
    r.weeks.toFixed(0).padStart(7) + (Math.round(r.gold / 1000) + "k").padStart(9) +
    r.band.padStart(6) + r.weakest.toFixed(1).padStart(9) + r.mean.toFixed(1).padStart(7) +
    (r.damage.toFixed(3) + "%").padStart(9) + (r.capped ? " CAPPED" : "") + "  " +
    r.nodes.map(function (n) { return n[0] + " " + n[1]; }).join(", "));
});
// Per-budget averages first; then each rung takes the cheapest state whose
// mean CLEARS the cut, searching every band at or above it. A state at B
// clears B- by definition, so a lower rung can never price above a higher
// one — gold is monotone by construction. The per-band chained selection this
// replaces handed B- a dearer crossing than B when budget curves crossed.
var LADDER_ASC2 = AX.ladder.slice().reverse();
// A cell only qualifies when at least 80% of its budget's accounts crossed
// the band. Without the gate, the lucky minority of 250k accounts that
// reached B before their economic cutoff priced EVERY band below it — their
// crossings are cheap at every band precisely because they are the lucky
// ones, and the whole bottom of the ladder collapsed onto one survivor.
var AVG = {};
LADDER_ASC2.forEach(function (row) {
  var byG = CROSS[row[0]];
  if (!byG) return;
  AVG[row[0]] = Object.keys(byG).map(function (g) {
    var a = byG[g], c = a.count;
    var gi = GPDS.indexOf(Number(g));
    a.golds.sort(function (x, y) { return x - y; });
    // UNCONDITIONAL median: index 50% of the budget's reps, not of the
    // crossers — accounts that never crossed are censored above everything
    // observed, so while coverage holds above 50% this order statistic is
    // exact and carries no survivor tilt. The crossers-only median would
    // still flatter the cell.
    var medIdx = gi >= 0 ? Math.floor(0.5 * repsFor(gi)) : (c >> 1);
    return { gpd: Number(g), gold: a.gold / c,
      goldMed: medIdx < c ? a.golds[medIdx] : null,
      fGold: a.fGold / c, damage: a.damage / c, gems: a.cut / c,
      mean: a.mean / c, weakest: a.weakest / c, cores: a.cores / c,
      node: a.node.map(function (v) { return v / c; }),
      perCore: a.perCore.map(function (v) { return v / c; }),
      count: c, coverage: gi >= 0 ? c / repsFor(gi) : 0 };
  });
});
var rungs = [];
// a cell's price is its unconditional median; cells too thin to have one
// (goldMed null) never qualify — the coverage gate already excludes them
function cellPrice(a) { return a.goldMed != null ? a.goldMed : a.gold; }
LADDER_ASC2.forEach(function (row, k) {
  var best = null;
  for (var j = k; j < LADDER_ASC2.length; j++) {
    (AVG[LADDER_ASC2[j][0]] || []).forEach(function (a) {
      if (a.coverage < 0.8 || a.goldMed == null) return;
      if (!best || cellPrice(a) < cellPrice(best)) best = a;
    });
  }
  if (!best) return;
  rungs.push({ band: row[0], weakBand: letterOf(best.weakest),
    cut: row[1] === -Infinity ? 0 : row[1],
    gold: Math.round(cellPrice(best)), damage: Number(best.damage.toFixed(4)),
    gems: Math.round(best.gems), weeks: best.gems / CUTS_PER_WEEK[RARITY],
    mean: Number(best.mean.toFixed(1)), weakest: Number(best.weakest.toFixed(1)),
    cores: Math.round(best.cores), samples: best.count,
    perCore: best.perCore.map(function (v) { return Math.round(v); }),
    nodes: NODES.map(function (n, q) { return [SHORT[n], Math.round(best.node[q])]; }) });
});
console.log("\nrungs (cheapest crossing per band):");
rungs.forEach(function (r) {
  console.log("  " + r.band.padEnd(4) + Math.round(r.gold / 1000).toLocaleString().padStart(8) +
    "k" + (r.damage.toFixed(3) + "%").padStart(9) + String(r.gems).padStart(6) + " gems");
});

if (ARGS.out) {
  require("fs").writeFileSync(ARGS.out, JSON.stringify({
    rarity: RARITY, slots: SLOTS, cutsPerWeek: CUTS_PER_WEEK[RARITY],
    turns: BUDGET_RARITY.maxTurns, rerolls: BUDGET_RARITY.maxRerolls,
    n: N, party: PARTY, sig: A.MODEL_SIG, draw: DRAW, axis: AXIS, rows: out, rungs: rungs,
    crossRaw: AVG
  }, null, 1));
  console.error("wrote " + ARGS.out);
}
