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

// ---------------- axis strategy (2026-08-09: support gets the DPS treatment) ----------------
// --axis=support --side=order|chaos runs the SUPPORT twin of the study: gems cut
// by support DP solvers against support-grade baselines, packed by party-damage
// value with PER-CORE order rates (each support core converts order points at
// its own rate, so which group lands on which core matters — solved exactly by
// sorting group order-totals onto sorted rates; see supDamageOfGroups).
var AXIS = ARGS.axis === "support" ? "support" : "dps";
var SIDE = ARGS.side === "chaos" ? "chaos" : "order";   // selftest/sizing only; dumps run BOTH sides jointly
var SUP_SIDE_CORES = { order: [10001, 10002, 10003], chaos: [10004, 10005, 10006] };
function sideRates(side) {
  // --star-mult=X perturbs the provisional Order Star (serenade, core 10003)
  // rate for sensitivity runs; 1 (default) = the model's value.
  var starMult = parseFloat(ARGS["star-mult"]) || 1;
  return SUP_SIDE_CORES[side].map(function (id) {
    var v = A.supportOrderValueForCore(id) * (id === 10003 ? starMult : 1);
    return Math.exp(v / 100) - 1;
  }).sort(function (a, b) { return b - a; });
}
var SUP_RATES_BY_SIDE = { order: sideRates("order"), chaos: sideRates("chaos") };
// The rate set the support objective currently prices against. A JOINT support
// account packs twice (order gems -> order cores, chaos gems -> chaos cores);
// the packer switches this before each side's pack, same pattern as ORACLE_MODE.
var SUP_RATES = SUP_RATES_BY_SIDE[SIDE];
function setSupSide(side) { SUP_RATES = SUP_RATES_BY_SIDE[side]; }
// support PER-SIDE collection sizes (the 6/pAbove rule on support solvers;
// --size-support measured pAbove ~6x DPS because the x3 party gpd makes the DP
// play much harder for keeps). An account cuts BOTH sides: totals are 2x these.
var SUPPORT_COUNTS = {
  T1: { 8: 11, 9: 6, 10: 2 },
  T2: { 8: 17, 9: 8, 10: 3 },
  T3: { 8: 32, 9: 16, 10: 5 }
};
// fixed-N variant (--fixed-n): DPS-sized collections PER SIDE for fit signal —
// realistic-N selectivity is ~1.6:1, which barely exercises the ranking.
function tierCounts(tier) {
  if (AXIS !== "support") return tier.counts;
  if (ARGS["fixed-n"]) return tier.counts;
  return SUPPORT_COUNTS[tier.name] || tier.counts;
}
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
  if (AXIS === "support") {
    // support meta: rawLin holds the SUPPORT lines (linear party-% per ally);
    // the bucket fields stay zero (the support objective has no buckets).
    return {
      cfg: cfg,
      cost: A.willpowerCost(cfg.baseCost, cfg.willpowerLevel),
      order: cfg.orderLevel,
      atk: 0, add: 0, boss: 0,
      rawLin: A.supportEffectScore(cfg.effect1, cfg.effect1Level) + A.supportEffectScore(cfg.effect2, cfg.effect2Level),
      grade: A.supportGrade(cfg),
      empty: false
    };
  }
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
var ORACLE_MODE = false;   // 17-forcing pass inside packCollection17
function bandPenalty(pts) {
  // 2026-08-09 (Shizu): -3/-6/-9. With the log-additive attachment even -3%
  // (~19 order points) dwarfs any side-node trade, so the packer forces 17+
  // wherever the collection allows; larger rates only distort the sub-17
  // fallback cases.
  if (pts >= 17) return 0;
  if (ORACLE_MODE) return pts >= 14 ? 0.50 : (pts >= 10 ? 0.75 : 0.99);
  if (pts >= 14) return 0.03;
  if (pts >= 10) return 0.06;
  return 0.09;
}
// groups: array of 3 arrays of metas (each length <= 4)
// 2026-08-09 THIRD attachment (Shizu -3/-6/-9 "done properly"): a core option
// multiplies the CHARACTER's whole damage, but d here is only the grid's
// log-damage (~0.065), so `d * (1-pen)` priced -3% at ~1.2 order points and
// the packer skipped feasible 17s (pilot oracle caught it). The penalty must
// join the character-damage exponent: d += log(1-pen). That prices -3% at
// ~19 order points independent of grid size, so 17+ wins wherever feasible.
function damageOfGroups(groups) {
  if (AXIS === "support") return supDamageOfGroups(groups);
  var atk = 0, add = 0, boss = 0, d = 0;
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g], pts = 0, i;
    for (i = 0; i < grp.length; i++) pts += grp[i].order;
    d += Math.log(1 - bandPenalty(pts));
    for (i = 0; i < grp.length; i++) {
      atk += grp[i].atk; add += grp[i].add; boss += grp[i].boss;
    }
    d += Math.log(1 + B.order.perPoint * Math.max(0, pts - 17));
  }
  d += bukTerm("Attack Power", atk) + bukTerm("Additional Damage", add) + bukTerm("Boss Damage", boss);
  return 100 * d;
}

// SUPPORT grid value (party damage per ally): effects are LINEAR (no buckets),
// order converts PER CORE at that core's own rate. For a fixed 3-way split the
// optimal core assignment is sorted: highest order total -> highest-rate core
// (the pairwise difference ln((1+r1·x)/(1+r2·x)) is increasing in x, so the
// assignment is a rearrangement argument — exact, not a heuristic). Band
// penalties are core-uniform and attach to the party-damage exponent, exactly
// like the DPS attachment.
function supDamageOfGroups(groups) {
  var eff = 0, d = 0;
  var pts = [0, 0, 0];
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    for (var i = 0; i < grp.length; i++) {
      eff += grp[i].rawLin;
      pts[g] += grp[i].order;
    }
  }
  pts.sort(function (a, b) { return b - a; });          // pair with SUP_RATES (desc)
  for (var k = 0; k < 3; k++) {
    d += Math.log(1 + SUP_RATES[k] * Math.max(0, pts[k] - 17));
    d += Math.log(1 - bandPenalty(pts[k]));
  }
  return eff + 100 * d;
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
  // order desc then cost asc: cheap order carriers keep 17x3 inside the budget
  var byOrderCheap = kept.slice().sort(function (a, b) { return (b.order - a.order) || (a.cost - b.cost); });
  var byCheap = kept.slice().sort(function (a, b) { return (a.cost - b.cost) || (b.rawLin - a.rawLin); });
  var set = new Set();
  var pool = [];
  function take(arr, k) {
    for (var i = 0; i < arr.length && k > 0; i++) {
      if (!set.has(arr[i])) { set.add(arr[i]); pool.push(arr[i]); k--; }
    }
  }
  // 2026-08-09: order slices widened (8 -> 16+8). Under keep-all pools the old
  // 8-gem order slice starved the packer of order carriers — the feasibility
  // certifier found 17x3 packings (e.g. 12x cost3/order5) that never entered
  // the pruned pool. A 17x3 grid can need 12+ order-heavy gems, some cheap.
  take(byRaw, 24); take(byEff, 10); take(byOrder, 16); take(byOrderCheap, 12); take(byCheap, 8);
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
// Mirrors damageOfGroups' log-additive band penalty (and the support twin's
// sorted core assignment).
function damageWithSwap(groups, gi, slot, g) {
  if (AXIS === "support") return supDamageWithSwap(groups, gi, slot, g);
  var atk = 0, add = 0, boss = 0, d = 0;
  for (var q = 0; q < groups.length; q++) {
    var grp = groups[q], pts = 0, i, x;
    for (i = 0; i < grp.length; i++) {
      x = (q === gi && i === slot) ? g : grp[i];
      pts += x.order;
      atk += x.atk; add += x.add; boss += x.boss;
    }
    d += Math.log(1 - bandPenalty(pts));
    d += Math.log(1 + B.order.perPoint * Math.max(0, pts - 17));
  }
  d += bukTerm("Attack Power", atk) + bukTerm("Additional Damage", add) + bukTerm("Boss Damage", boss);
  return 100 * d;
}
function supDamageWithSwap(groups, gi, slot, g) {
  var eff = 0, d = 0;
  var pts = [0, 0, 0];
  for (var q = 0; q < groups.length; q++) {
    var grp = groups[q];
    for (var i = 0; i < grp.length; i++) {
      var x = (q === gi && i === slot) ? g : grp[i];
      eff += x.rawLin;
      pts[q] += x.order;
    }
  }
  pts.sort(function (a, b) { return b - a; });
  for (var k = 0; k < 3; k++) {
    d += Math.log(1 + SUP_RATES[k] * Math.max(0, pts[k] - 17));
    d += Math.log(1 - bandPenalty(pts[k]));
  }
  return eff + 100 * d;
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
  seeds.push(seedSelection(pool, function (g) { return g.rawLin / (g.cost + 1); }));
  seeds.push(seedSelection(pool, function (g) { return g.order * 1000 + g.rawLin; }));
  // cheap order carriers: the witness shape for tight 17x3 packings
  seeds.push(seedSelection(pool, function (g) { return g.order * 1000 - g.cost; }));

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

// Pack with 17-cores as a hard preference. In-game, core order 17 is a
// discrete breakpoint (top core-option rank) — real endgame grids always run
// 17+ — so the packer maximizes the number of 17-point cores FIRST and only
// then damage; the -3/-6/-9 band prices the genuinely infeasible residue.
// (At an honest -3% about 2-9% of keep-all accounts would optimally park a
// core at 14-16 because their only 17x3 needs many weak-line order carriers;
// the smooth penalty is a stand-in for the breakpoint, so the breakpoint
// wins.) The oracle pass crosses damage valleys single-swap search cannot;
// its selection then seeds the real objective, which polishes damage without
// breaking 17s (a single swap never gains the ~19 points a 17-core is worth).
function count17(p) {
  var n = 0;
  for (var g = 0; g < p.groups.length; g++) {
    var pts = 0;
    for (var i = 0; i < p.groups[g].length; i++) pts += p.groups[g][i].order;
    if (pts >= 17) n++;
  }
  return n;
}
function pick17(a, b) {
  var ca = count17(a), cb = count17(b);
  if (ca !== cb) return ca > cb ? a : b;
  return a.dmg > b.dmg ? a : b;
}

// Exact 17x3 feasibility on (cost, order) classes; returns a concrete 12-gem
// witness seed (best rawLin per class) or null. Only order >= 2 / cost <= 8
// gems can sit in a 17-core (5+5+5+2 floor; companions cost >= 3 each).
function certWitnessSeed(kept) {
  var cls = new Map();
  kept.forEach(function (g) {
    if (g.order < 2 || g.cost > 8) return;
    var k = g.cost + ":" + g.order;
    if (!cls.has(k)) cls.set(k, []);
    cls.get(k).push(g);
  });
  var list = [];
  cls.forEach(function (gems, k) {
    gems.sort(function (a, b) { return b.rawLin - a.rawLin; });
    var p = k.split(":");
    list.push({ c: +p[0], o: +p[1], gems: gems });
  });
  list.sort(function (a, b) { return (b.o - a.o) || (a.c - b.c); });
  var L = list.length;
  var cands = [];
  (function rec(start, picked, sc, so) {
    if (picked.length === 4) { if (so >= 17) cands.push(picked.slice()); return; }
    var need = 4 - picked.length;
    if (start >= L || so + need * list[start].o < 17) return;
    for (var i = start; i < L; i++) {
      if (so + need * list[i].o < 17) break;
      var used = 0;
      for (var p = 0; p < picked.length; p++) if (picked[p] === i) used++;
      if (used >= list[i].gems.length) continue;
      if (sc + list[i].c > 17 - 3 * (need - 1)) continue;
      picked.push(i); rec(i, picked, sc + list[i].c, so + list[i].o); picked.pop();
    }
  })(0, [], 0, 0);
  var counts = list.map(function (x) { return x.gems.length; });
  var memo = new Map();
  function solve(k, minCore) {
    if (k === 0) return [];
    var key = counts.join(",") + "|" + k + "|" + minCore;
    if (memo.has(key)) return memo.get(key);
    var res = null;
    for (var ci = minCore; ci < cands.length && !res; ci++) {
      var core = cands[ci], ok = true, i;
      var use = new Map();
      for (i = 0; i < core.length; i++) use.set(core[i], (use.get(core[i]) || 0) + 1);
      use.forEach(function (u, idx) { if (counts[idx] < u) ok = false; });
      if (!ok) continue;
      use.forEach(function (u, idx) { counts[idx] -= u; });
      var rest = solve(k - 1, ci);
      use.forEach(function (u, idx) { counts[idx] += u; });
      if (rest) res = core.concat(rest);
    }
    memo.set(key, res);
    return res;
  }
  var flat = solve(3, 0);
  if (!flat) return null;
  var cursor = new Map();
  return flat.map(function (idx) {
    var at = cursor.get(idx) || 0;
    cursor.set(idx, at + 1);
    return list[idx].gems[at];
  });
}

function packCollection17(kept) {
  var plain = packCollection(kept);
  ORACLE_MODE = true;
  var oracle = packCollection(kept);
  ORACLE_MODE = false;
  var assisted = packCollection(kept, oracle.sel);
  var best = pick17(assisted, plain);
  if (count17(best) < 3) {
    // heuristic search ended sub-17: ask the exact certifier for a witness
    // and re-pack from it (~1 in 15k accounts; all-17 results never get here)
    var w = certWitnessSeed(kept);
    if (w) {
      ORACLE_MODE = true;
      var o2 = packCollection(kept, w);
      ORACLE_MODE = false;
      best = pick17(packCollection(kept, o2.sel), best);
    }
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
    var proxy = function (x) { return x.rawLin + (AXIS === "support" ? 0.02 : 0.08) * x.order; };
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
  console.log("=== packer self-test: brute force vs packCollection (axis=" + AXIS +
    (AXIS === "support" ? " side=" + SIDE : "") + ") ===");
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
  var baseline = AXIS === "support" ? A.supportGradeToScore(tier.bl) : A.gradeToScore(tier.bl);
  var solvers = {};
  [8, 9, 10].forEach(function (cost) {
    solvers[cost] = new DP.Solver(baseline, tier.gpd, false, { axis: AXIS, maxTurns: Engine.EPIC.maxTurns });
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
    packCollection17: packCollection17,
    gradeGreedyRoster: gradeGreedyRoster, singleGemDelta: singleGemDelta,
    makeSolvers: makeSolvers,
    // support-side packing (fit-support-roster.js packer adjudication; pass
    // --axis=support in the REQUIRING script's argv — AXIS reads process.argv)
    setSupSide: setSupSide, supDamageOfGroups: supDamageOfGroups
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
  function tupleOf(g) {
    var c = g.cfg;
    var t = [c.baseCost, c.willpowerLevel, c.orderLevel,
      A.EFFECT_POOLS[c.baseCost].indexOf(c.effect1), c.effect1Level,
      A.EFFECT_POOLS[c.baseCost].indexOf(c.effect2), c.effect2Level];
    if (AXIS === "support") t.push(g.side === "chaos" ? 1 : 0);
    return t;
  }
  for (var da = dFrom; da < dTo; da++) {
    var dCounts = tierCounts(dTier);
    if (AXIS === "support") {
      // JOINT support account (Shizu 2026-08-09: "study order and chaos at the
      // same time"): one account cuts BOTH gem types — same cut mechanics, but
      // each side packs into its own 3 cores at its own per-core rates. One
      // score must serve both sides; the fit measures unified vs split weights
      // on these joint labels.
      var dAll = [], dSide = {};
      ["order", "chaos"].forEach(function (side) {
        var sRand = mulberry32(fnv1a("sup-" + side + ":" + dTier.name + "#" + da));
        var sKept = [];
        [8, 9, 10].forEach(function (cost) {
          var dp = A.EFFECT_POOLS[cost], dPairs = [];
          for (var x = 0; x < dp.length; x++) for (var y = x + 1; y < dp.length; y++) dPairs.push([dp[x], dp[y]]);
          for (var di = 0; di < dCounts[cost]; di++) {
            var dpr = dPairs[Math.floor(sRand() * dPairs.length)];
            var dres = cutOneGem(dSolvers[cost], { baseCost: cost, gemType: "order", effect1: dpr[0], effect2: dpr[1] }, sRand, true);
            var dm = gemMeta(dres.cfg);
            dm.side = side;
            if (dres.processes > 0 && (dKeepAll || dm.grade >= KEEP_GRADE)) sKept.push(dm);
          }
        });
        setSupSide(side);
        var sPack = packCollection17(sKept);
        dSide[side] = {
          kept: sKept,
          set: new Set(sPack.sel.filter(function (g) { return !g.empty; })),
          dmg: sPack.dmg,
          cores: sPack.groups.map(function (grp) {
            var p = 0; grp.forEach(function (x) { p += x.order; }); return p;
          })
        };
        dAll = dAll.concat(sKept);
      });
      dRows.push({
        a: da,
        kept: dAll.map(tupleOf),
        sockO: dAll.map(function (g, i) { return dSide.order.set.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
        sockC: dAll.map(function (g, i) { return dSide.chaos.set.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
        dmgO: dSide.order.dmg, dmgC: dSide.chaos.dmg,
        coresO: dSide.order.cores, coresC: dSide.chaos.cores
      });
    } else {
    var dRand = mulberry32(fnv1a(dTier.name + "#" + da));
    var dKept = [];
    [8, 9, 10].forEach(function (cost) {
      var dp = A.EFFECT_POOLS[cost], dPairs = [];
      for (var x = 0; x < dp.length; x++) for (var y = x + 1; y < dp.length; y++) dPairs.push([dp[x], dp[y]]);
      for (var di = 0; di < dCounts[cost]; di++) {
        var dpr = dPairs[Math.floor(dRand() * dPairs.length)];
        var dres = cutOneGem(dSolvers[cost], { baseCost: cost, gemType: "order", effect1: dpr[0], effect2: dpr[1] }, dRand, true);
        var dm = gemMeta(dres.cfg);
        if (dres.processes > 0 && (dKeepAll || dm.grade >= KEEP_GRADE)) dKept.push(dm);
      }
    });
    var dPack = packCollection17(dKept);
    var dSet = new Set(dPack.sel.filter(function (g) { return !g.empty; }));
    dRows.push({
      a: da,
      kept: dKept.map(tupleOf),
      sock: dKept.map(function (g, i) { return dSet.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
      dmg: dPack.dmg,
      cores: dPack.groups.map(function (grp) {
        var p = 0; grp.forEach(function (x) { p += x.order; }); return p;
      })
    });
    }
    if (ARGS.progress && (da - dFrom + 1) % 250 === 0) {
      console.log("[labels " + dTier.name + "] " + (da - dFrom + 1) + "/" + (dTo - dFrom) +
        " (" + ((Date.now() - dT0) / 1000).toFixed(0) + "s)");
    }
  }
  fs.writeFileSync(ARGS.out || ("labels-" + dTier.name + "-" + dFrom + "-" + dTo + ".json"),
    JSON.stringify({ tier: dTier.name, axis: AXIS, side: AXIS === "support" ? SIDE : null, from: dFrom, to: dTo, rows: dRows }));
  console.log("wrote " + (ARGS.out || "labels") + " (" + dRows.length + " accounts, " + ((Date.now() - dT0) / 1000).toFixed(0) + "s)");
}
else if (ARGS.selftest) { selfTest(); }
else if (ARGS["size-roster"] || ARGS["roster-study"]) {
  // ---- ROSTER-BOUND distribution study (Shizu 2026-08-10) ----
  // Cut epics as ROSTER-BOUND gems (processing is FREE in the DP — nothing is
  // abandoned for gold reasons; the true stat distribution emerges), cost mix
  // 57/28/15 (fusing toward 10s + selector 10s), four descending tiers. Per
  // account: cut -> equip best 12 -> keep everything grading >= (lowest
  // equipped - 5) -> every discarded RELIC-or-better (level sum 16+) fuses
  // with 2 legendary c10s (infinite supply assumed): legendary outputs are
  // DISMANTLED (no infinite-supply abuse), sub-threshold relic+ outputs
  // re-fuse until none remain, keepers join the pool -> final re-equip.
  // --bl=g1,g2,g3,g4 overrides the four tier baselines (R1..R4 order).
  var ROSTER_TIERS = {
    R1: { name: "R1", gpd: 6000000, bl: 90 },
    R2: { name: "R2", gpd: 2500000, bl: 85 },
    R3: { name: "R3", gpd: 1000000, bl: 80 },
    R4: { name: "R4", gpd: 500000, bl: 75 }
  };
  if (ARGS.bl) {
    var _bls = String(ARGS.bl).split(",").map(Number);
    ["R1", "R2", "R3", "R4"].forEach(function (tn, i) { if (_bls[i]) ROSTER_TIERS[tn].bl = _bls[i]; });
  }
  // --mix=60,30,10 overrides the default cut mix; --fuse-target=9|10 sets the
  // fusion selector cost (2/3 you get the target, 1/3 the input cost);
  // --seed-tag=X namespaces the RNG streams so variant corpora are disjoint
  // from the originals while PAIRED variants (same tag+counts, different
  // fuse-target) share identical cut pools.
  var ROSTER_MIX = (function () {
    if (!ARGS.mix) return { 8: 0.57, 9: 0.28, 10: 0.15 };
    var p = String(ARGS.mix).split(/[:,/]/).map(Number);
    return { 8: p[0] / 100, 9: p[1] / 100, 10: p[2] / 100 };
  })();
  var FUSE_AUTO = String(ARGS["fuse-target"] || "") === "auto";
  var FUSE_TARGET = parseInt(ARGS["fuse-target"], 10) || 10;
  if (FUSE_AUTO && AXIS === "support") { console.error("--fuse-target=auto is DPS-only for now"); process.exit(1); }
  var SEED_TAG = ARGS["seed-tag"] ? String(ARGS["seed-tag"]) : "";
  function makeRosterSolvers(tier) {
    // axis-aware: support roster accounts cut under the LIVE support model
    // (run this from the pristine worktree so "live" means what players see).
    var baseline = AXIS === "support" ? A.supportGradeToScore(tier.bl) : A.gradeToScore(tier.bl);
    var s = {};
    [8, 9, 10].forEach(function (cost) {
      s[cost] = new DP.Solver(baseline, tier.gpd, true, { axis: AXIS, maxTurns: Engine.EPIC.maxTurns });
    });
    return s;
  }
  function rosterValue(cfg) { return AXIS === "support" ? A.supportValue(cfg) : A.gemValue(cfg); }
  // Sizing rule both axes: expect HALF the sockets above the tier baseline.
  // The 20-account R1 pilot showed a roster-scale support pool fills 12 sockets
  // per side (the sell-study's ~9.3 was pool starvation, not budget), so the
  // support mirror of DPS's 6-of-12 is ALSO 6 per side.
  var ROSTER_EXPECT = 6;
  // uniform random gem of (cost, tier): level sum ~ outputLevelSumDist, stat
  // partition uniform among all 1-5 splits of that sum, effect pair uniform.
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
    var parts = partsOfSum(sum);
    var p = parts[Math.floor(rand() * parts.length)];
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

  if (ARGS["size-roster"]) {
    var SZ = parseInt(ARGS.cuts, 10) || 400;
    var sizeBaselineOf = function (tier) {
      return AXIS === "support" ? A.supportGradeToScore(tier.bl) : A.gradeToScore(tier.bl);
    };
    Object.keys(ROSTER_TIERS).forEach(function (tn) {
      var tier = ROSTER_TIERS[tn];
      var solvers = makeRosterSolvers(tier);
      var baseline = sizeBaselineOf(tier);
      var pAbove = {};
      [8, 9, 10].forEach(function (cost) {
        var pool = A.EFFECT_POOLS[cost], pairs = [];
        for (var x = 0; x < pool.length; x++) for (var y = x + 1; y < pool.length; y++) pairs.push([pool[x], pool[y]]);
        var rand = mulberry32(fnv1a("size-roster:" + AXIS + ":" + tn + ":c" + cost));
        var above = 0;
        for (var n = 0; n < SZ; n++) {
          var pr = pairs[Math.floor(rand() * pairs.length)];
          var res = cutOneGem(solvers[cost], { baseCost: cost, gemType: "order", effect1: pr[0], effect2: pr[1] }, rand, true);
          if (res.processes > 0 && rosterValue(res.cfg) >= baseline) above++;
        }
        pAbove[cost] = above / SZ;
      });
      var mixP = ROSTER_MIX[8] * pAbove[8] + ROSTER_MIX[9] * pAbove[9] + ROSTER_MIX[10] * pAbove[10];
      var N = mixP > 0 ? Math.ceil(ROSTER_EXPECT / mixP) : Infinity;
      console.log(tn + " (" + (tier.gpd / 1e6) + "M/" + tier.bl + "): pAbove c8=" + pAbove[8].toFixed(3) +
        " c9=" + pAbove[9].toFixed(3) + " c10=" + pAbove[10].toFixed(3) + "  mix p=" + mixP.toFixed(4) +
        "  -> N=" + N + " per " + (AXIS === "support" ? "SIDE" : "account") +
        "  counts {8:" + Math.round(ROSTER_MIX[8] * N) + ", 9:" + Math.round(ROSTER_MIX[9] * N) + ", 10:" + Math.round(ROSTER_MIX[10] * N) + "}");
    });
    process.exit(0);
  }

  // ---- the study proper ----
  var rTier = ROSTER_TIERS[ARGS.tier];
  if (!rTier) { console.error("--roster-study needs --tier=R1..R4"); process.exit(1); }
  var rCounts = {
    8: parseInt(ARGS.c8, 10), 9: parseInt(ARGS.c9, 10), 10: parseInt(ARGS.c10, 10)
  };
  if (!rCounts[8] || !rCounts[9] || !rCounts[10]) { console.error("--roster-study needs --c8/--c9/--c10 counts (from --size-roster)"); process.exit(1); }
  var rSolvers = makeRosterSolvers(rTier);
  var rFrom = parseInt(ARGS.from, 10) || 0;
  var rTo = ARGS.to != null ? parseInt(ARGS.to, 10) : rFrom + 1000;
  var rRows = [];
  var rT0 = Date.now();
  // Cut a pool with the roster-bound solvers. seedPrefix "roster" reproduces
  // the DPS corpus byte-for-byte; support sides use their own prefixes.
  function rosterCutPool(seedPrefix, ra, gemType) {
    var sp = seedPrefix + SEED_TAG;
    var cutRand = mulberry32(fnv1a(sp + ":" + rTier.name + "#" + ra));
    var fuseRand = mulberry32(fnv1a(sp + "-fuse:" + rTier.name + "#" + ra));
    var cut = [];
    [8, 9, 10].forEach(function (cost) {
      var pool = A.EFFECT_POOLS[cost], pairs = [];
      for (var x = 0; x < pool.length; x++) for (var y = x + 1; y < pool.length; y++) pairs.push([pool[x], pool[y]]);
      for (var ci = 0; ci < rCounts[cost]; ci++) {
        var pr = pairs[Math.floor(cutRand() * pairs.length)];
        var res = cutOneGem(rSolvers[cost], { baseCost: cost, gemType: gemType, effect1: pr[0], effect2: pr[1] }, cutRand, true);
        if (res.processes > 0) { var m = gemMeta(res.cfg); m.fused = false; cut.push(m); }
      }
    });
    return { cut: cut, fuseRand: fuseRand };
  }
  // equip -> keep >= floor-5 -> fuse discarded relic+ with 2 leg c10s
  // (legendary outputs dismantled, sub-threshold relic+ re-queued) -> re-equip.
  // For support, call setSupSide(side) FIRST so both packs use the side rates.
  function rosterEquipFuse(cut, fuseRand, gemType) {
    var pack1 = packCollection17(cut);
    var sock1 = pack1.sel.filter(function (g) { return !g.empty; });
    var floor1 = sock1.length ? Math.min.apply(null, sock1.map(function (g) { return g.grade; })) : 0;
    var thr = floor1 - 5;
    var sockSet1 = new Set(sock1);
    var keepPool = cut.filter(function (g) { return sockSet1.has(g) || g.grade >= thr; });
    var feed = cut.filter(function (g) { return !sockSet1.has(g) && g.grade < thr && A.levelSum(g.cfg) >= 16; });
    var stats = { fusions: 0, keptFromFusion: 0, legDismantled: 0, refused: 0 };
    var queue = feed.slice(), guard = 0;
    while (queue.length && guard++ < 500) {
      var fg = queue.pop();
      stats.fusions++;
      var inTier = A.classifyTier(A.levelSum(fg.cfg));
      var outTier = drawTier(A.fusionOutputDist([inTier, "legendary", "legendary"]), fuseRand);
      if (outTier === "legendary") { stats.legDismantled++; continue; }
      var outCost = fuseRand() < (2 / 3) ? FUSE_TARGET : fg.cfg.baseCost;
      var outCfg = sampleTierGem(outCost, outTier, fuseRand, gemType);
      var om = gemMeta(outCfg); om.fused = true;
      if (om.grade >= thr) { keepPool.push(om); stats.keptFromFusion++; }
      else { stats.refused++; queue.push(om); }
    }
    var pack2 = packCollection17(keepPool);
    var sock2 = pack2.sel.filter(function (g) { return !g.empty; });
    var floor2 = sock2.length ? Math.min.apply(null, sock2.map(function (g) { return g.grade; })) : 0;
    return { keepPool: keepPool, pack2: pack2, sock2Set: new Set(sock2),
      cutN: cut.length, floor1: floor1, floor2: floor2, thr: thr,
      fus: [stats.fusions, stats.keptFromFusion, stats.legDismantled, stats.refused] };
  }
  function coresOf(pack) {
    return pack.groups.map(function (grp) {
      var p = 0; grp.forEach(function (x) { p += x.order; }); return p;
    });
  }
  // ---- adaptive fusion target (--fuse-target=auto, DPS axis only) ----
  // Each account CALCULATES whether to steer fusion outputs to c9 or c10:
  // enumerate the fusion-output distribution exactly (outTier x level-sum x
  // partition x ordered effect pair, exact probabilities) and score every
  // concrete output by its EXACT single-swap packer marginal against the
  // current grid. The marginal is O(#slots) per candidate via a precomputed
  // per-slot table (core order totals, eviction constants, budget headroom,
  // global bucket sums) — the same math damageOfGroups uses, decomposed.
  // K/grades never enter the decision, so the current model cannot bias it.
  function slotTableOf(pack) {
    var slots = [], sums = { atk: 0, add: 0, boss: 0 };
    pack.groups.forEach(function (grp) {
      grp.forEach(function (x) { sums.atk += x.atk; sums.add += x.add; sums.boss += x.boss; });
    });
    pack.groups.forEach(function (grp) {
      var pts = 0, cost = 0;
      grp.forEach(function (x) { pts += x.order; cost += x.cost; });
      var coreBase = Math.log(1 - bandPenalty(pts)) + Math.log(1 + B.order.perPoint * Math.max(0, pts - 17));
      grp.forEach(function (x) {
        slots.push({ old: x, pts: pts, coreBase: coreBase, headroom: CORE_SUPPLY - (cost - x.cost) });
      });
    });
    return { slots: slots, sums: sums };
  }
  function swapMarginal(tab, g) {
    var best = 0;
    for (var i = 0; i < tab.slots.length; i++) {
      var s = tab.slots[i];
      if (g.cost > s.headroom) continue;
      var npts = s.pts - s.old.order + g.order;
      var d = Math.log(1 - bandPenalty(npts)) + Math.log(1 + B.order.perPoint * Math.max(0, npts - 17)) - s.coreBase
        + bukTerm("Attack Power", tab.sums.atk - s.old.atk + g.atk) - bukTerm("Attack Power", tab.sums.atk)
        + bukTerm("Additional Damage", tab.sums.add - s.old.add + g.add) - bukTerm("Additional Damage", tab.sums.add)
        + bukTerm("Boss Damage", tab.sums.boss - s.old.boss + g.boss) - bukTerm("Boss Damage", tab.sums.boss);
      if (d > best) best = d;
    }
    return 100 * best;
  }
  // E[swap-marginal of ONE fusion output] at target cost T for an input tier.
  // Only the 2/3 selector branch differs between targets, so the c9-vs-c10
  // decision compares these directly.
  function fusionTargetEV(T, inTier, tab) {
    var outDist = A.fusionOutputDist([inTier, "legendary", "legendary"]);
    var pool = A.EFFECT_POOLS[T];
    var ev = 0;
    Object.keys(outDist).forEach(function (ot) {
      if (ot === "legendary" || !outDist[ot]) return;   // legendary outputs are dismantled
      var sumDist = A.outputLevelSumDist(ot);
      Object.keys(sumDist).forEach(function (sk) {
        var sum = parseInt(sk, 10);
        var parts = partsOfSum(sum);
        var per = (outDist[ot] * sumDist[sk]) / (parts.length * pool.length * (pool.length - 1));
        for (var pi = 0; pi < parts.length; pi++) {
          var p = parts[pi];
          for (var i = 0; i < pool.length; i++) for (var j = 0; j < pool.length; j++) {
            if (j === i) continue;
            var m = gemMeta({ baseCost: T, gemType: "order", willpowerLevel: p[0], orderLevel: p[1],
              effect1: pool[i], effect1Level: p[2], effect2: pool[j], effect2Level: p[3] });
            ev += per * swapMarginal(tab, m);
          }
        }
      });
    });
    return ev;
  }
  function chooseTarget(pack, queue) {
    var tab = slotTableOf(pack);
    var nRel = 0, nAnc = 0;
    queue.forEach(function (g) { if (A.classifyTier(A.levelSum(g.cfg)) === "ancient") nAnc++; else nRel++; });
    var tot = nRel + nAnc || 1;
    var e9 = (nRel * fusionTargetEV(9, "relic", tab) + nAnc * fusionTargetEV(9, "ancient", tab)) / tot;
    var e10 = (nRel * fusionTargetEV(10, "relic", tab) + nAnc * fusionTargetEV(10, "ancient", tab)) / tot;
    return { t: e10 >= e9 ? 10 : 9, e9: e9, e10: e10 };
  }
  // Adaptive variant of rosterEquipFuse: same cut/keep/fuse mechanics, but the
  // selector target is chosen per account and RE-CHOSEN after every upgrade
  // that changes the equipped grid.
  function rosterEquipFuseAuto(cut, fuseRand, gemType) {
    var pack1 = packCollection17(cut);
    var sock1 = pack1.sel.filter(function (g) { return !g.empty; });
    var floor1 = sock1.length ? Math.min.apply(null, sock1.map(function (g) { return g.grade; })) : 0;
    var thr = floor1 - 5;
    var sockSet1 = new Set(sock1);
    var keepPool = cut.filter(function (g) { return sockSet1.has(g) || g.grade >= thr; });
    var feed = cut.filter(function (g) { return !sockSet1.has(g) && g.grade < thr && A.levelSum(g.cfg) >= 16; });
    var stats = { fusions: 0, keptFromFusion: 0, legDismantled: 0, refused: 0 };
    var queue = feed.slice(), guard = 0;
    var pack = pack1;
    var choice = chooseTarget(pack, queue);
    var hist = { t0: choice.t, e9_0: choice.e9, e10_0: choice.e10, switches: 0, upgrades: 0, tF: choice.t };
    while (queue.length && guard++ < 500) {
      var fg = queue.pop();
      stats.fusions++;
      var inTier = A.classifyTier(A.levelSum(fg.cfg));
      var outTier = drawTier(A.fusionOutputDist([inTier, "legendary", "legendary"]), fuseRand);
      if (outTier === "legendary") { stats.legDismantled++; continue; }
      var outCost = fuseRand() < (2 / 3) ? choice.t : fg.cfg.baseCost;
      var outCfg = sampleTierGem(outCost, outTier, fuseRand, gemType);
      var om = gemMeta(outCfg); om.fused = true;
      if (om.grade >= thr) {
        keepPool.push(om);
        stats.keptFromFusion++;
        if (swapMarginal(slotTableOf(pack), om) > 1e-9) {
          pack = packCollection17(keepPool);
          hist.upgrades++;
          var nc = chooseTarget(pack, queue);
          if (nc.t !== choice.t) hist.switches++;
          choice = nc;
          hist.tF = choice.t;
        }
      }
      else { stats.refused++; queue.push(om); }
    }
    var pack2 = packCollection17(keepPool);
    var sock2 = pack2.sel.filter(function (g) { return !g.empty; });
    var floor2 = sock2.length ? Math.min.apply(null, sock2.map(function (g) { return g.grade; })) : 0;
    return { keepPool: keepPool, pack2: pack2, sock2Set: new Set(sock2),
      cutN: cut.length, floor1: floor1, floor2: floor2, thr: thr,
      fus: [stats.fusions, stats.keptFromFusion, stats.legDismantled, stats.refused],
      hist: hist };
  }
  for (var ra = rFrom; ra < rTo; ra++) {
    if (AXIS === "support") {
      // JOINT roster support account: both sides cut/equip/keep/fuse
      // independently (fusion feeds the side's own gem type); one row
      // carries both so a single unified score can be fitted against it.
      var sides = {}, all = [];
      ["order", "chaos"].forEach(function (side) {
        var cp = rosterCutPool("sup-roster-" + side, ra, side);
        setSupSide(side);
        var sr = rosterEquipFuse(cp.cut, cp.fuseRand, side);
        sr.keepPool.forEach(function (g) { g.side = side; });
        sides[side] = sr;
        all = all.concat(sr.keepPool);
      });
      rRows.push({
        a: ra,
        kept: all.map(function (g) {
          var c = g.cfg;
          return [c.baseCost, c.willpowerLevel, c.orderLevel,
            A.EFFECT_POOLS[c.baseCost].indexOf(c.effect1), c.effect1Level,
            A.EFFECT_POOLS[c.baseCost].indexOf(c.effect2), c.effect2Level,
            g.side === "chaos" ? 1 : 0, g.fused ? 1 : 0];
        }),
        sockO: all.map(function (g, i) { return sides.order.sock2Set.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
        sockC: all.map(function (g, i) { return sides.chaos.sock2Set.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
        cutN: sides.order.cutN + sides.chaos.cutN,
        floor1: [sides.order.floor1, sides.chaos.floor1],
        floor2: [sides.order.floor2, sides.chaos.floor2],
        thr: [sides.order.thr, sides.chaos.thr],
        fus: [sides.order.fus, sides.chaos.fus],
        coresO: coresOf(sides.order.pack2), coresC: coresOf(sides.chaos.pack2),
        dmgO: sides.order.pack2.dmg, dmgC: sides.chaos.pack2.dmg
      });
    } else {
      var cp1 = rosterCutPool("roster", ra, "order");
      var dres = FUSE_AUTO ? rosterEquipFuseAuto(cp1.cut, cp1.fuseRand, "order")
                           : rosterEquipFuse(cp1.cut, cp1.fuseRand, "order");
      rRows.push({
        a: ra,
        kept: dres.keepPool.map(function (g) {
          var c = g.cfg;
          return [c.baseCost, c.willpowerLevel, c.orderLevel,
            A.EFFECT_POOLS[c.baseCost].indexOf(c.effect1), c.effect1Level,
            A.EFFECT_POOLS[c.baseCost].indexOf(c.effect2), c.effect2Level, g.fused ? 1 : 0];
        }),
        sock: dres.keepPool.map(function (g, i) { return dres.sock2Set.has(g) ? i : -1; }).filter(function (i) { return i >= 0; }),
        cutN: dres.cutN, floor1: dres.floor1, floor2: dres.floor2, thr: dres.thr,
        fus: dres.fus,
        ft: dres.hist ? [dres.hist.t0, dres.hist.tF, dres.hist.switches, dres.hist.upgrades,
          +dres.hist.e9_0.toFixed(6), +dres.hist.e10_0.toFixed(6)] : undefined,
        cores: coresOf(dres.pack2),
        dmg: dres.pack2.dmg
      });
    }
    if (ARGS.progress && (ra - rFrom + 1) % 100 === 0) {
      console.log("[roster " + rTier.name + (AXIS === "support" ? "/sup" : "") + "] " + (ra - rFrom + 1) + "/" + (rTo - rFrom) + " (" + ((Date.now() - rT0) / 1000).toFixed(0) + "s)");
    }
  }
  fs.writeFileSync(ARGS.out || ("roster-" + rTier.name + "-" + rFrom + "-" + rTo + ".json"),
    JSON.stringify({ tier: rTier.name, axis: AXIS, gpd: rTier.gpd, bl: rTier.bl, mix: ROSTER_MIX, fuseTarget: FUSE_TARGET, seedTag: SEED_TAG, counts: rCounts, rosterBound: true, from: rFrom, to: rTo, rows: rRows }));
  console.log("wrote " + (ARGS.out || "roster") + " (" + rRows.length + " accounts, " + ((Date.now() - rT0) / 1000).toFixed(0) + "s)");
  process.exit(0);
}
else if (ARGS["size-support"]) {
  // Empirical above-baseline rates for the SUPPORT solvers -> collection sizes
  // by the same 6/pAbove rule the DPS study used (at the 60/30/10 cost mix).
  // Usage: node tools/account-study.js --size-support --axis=support
  if (AXIS !== "support") { console.error("--size-support needs --axis=support"); process.exit(1); }
  var SZ_CUTS = parseInt(ARGS.cuts, 10) || 400;
  Object.keys(TIERS).forEach(function (tn) {
    var szTier = TIERS[tn];
    var szSolvers = makeSolvers(szTier);
    var szBaseline = A.supportGradeToScore(szTier.bl);
    var pAbove = {};
    [8, 9, 10].forEach(function (cost) {
      var pool = A.EFFECT_POOLS[cost], pairs = [];
      for (var x = 0; x < pool.length; x++) for (var y = x + 1; y < pool.length; y++) pairs.push([pool[x], pool[y]]);
      var rand = mulberry32(fnv1a("size:sup:" + tn + ":c" + cost));
      var above = 0;
      for (var n = 0; n < SZ_CUTS; n++) {
        var pr = pairs[Math.floor(rand() * pairs.length)];
        var res = cutOneGem(szSolvers[cost], { baseCost: cost, gemType: "order", effect1: pr[0], effect2: pr[1] }, rand, true);
        if (res.processes > 0 && A.supportValue(res.cfg) >= szBaseline) above++;
      }
      pAbove[cost] = above / SZ_CUTS;
    });
    var mixP = 0.6 * pAbove[8] + 0.3 * pAbove[9] + 0.1 * pAbove[10];
    var N = mixP > 0 ? Math.ceil(6 / mixP) : Infinity;
    console.log(tn + ": pAbove c8=" + pAbove[8].toFixed(3) + " c9=" + pAbove[9].toFixed(3) +
      " c10=" + pAbove[10].toFixed(3) + "  mix p=" + mixP.toFixed(4) +
      "  -> N=" + N + "  counts {8:" + Math.round(0.6 * N) + ", 9:" + Math.round(0.3 * N) + ", 10:" + Math.round(0.1 * N) + "}");
  });
  process.exit(0);
}
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
