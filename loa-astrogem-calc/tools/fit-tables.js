/**
 * fit-tables.js — per-cost-table scoring bake-off (Shizu, 2026-08-09).
 *
 * Fits TABLE forms of the willpower price (one free value per effective cost,
 * the "rating for 3/4/5/6/7/8/9/10" idea) and compares every system, old and
 * new, on the packer's ground truth. Two discrepancy metrics per system:
 *
 *   disp  : top-12-by-score vs the packer's socketed 12 (membership misses)
 *   floor : benched gems scoring ABOVE the worst socketed gem — every one of
 *           these is a player-visible "why is this benched?" inconsistency,
 *           counted across the WHOLE collection, not just the top 12.
 *
 * Systems:
 *   live      : original site model — gemDamage × M(effCost), order 0.16
 *   B-linear  : rawLin + 0.156·order + 0.048·(4.25 − eff)      [prior fit]
 *   A-slope   : (rawLin + 0.156·order) × (1 + 0.040·(5 − eff)) [prior fit]
 *   K-table   : rawLin + w·order + K[eff]        (fit w + K[3..9], K[5] = 0)
 *   M-table   : (rawLin + w·order) × Mt[eff]     (fit w + Mt[3..9], Mt[5] = 1)
 *   K-floor   : K-table refit with the FLOOR metric as the objective
 *   C table   : empirical P(socketed | config), logistic backoff  [ceiling]
 *
 * Protocol: train on accounts idx < 4000 per tier, test on the rest (1000/tier).
 *   node tools/fit-tables.js <labels-dir>
 */
"use strict";
var fs = require("fs");
var path = require("path");
var A = require("../model/astrogem.js");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/fit-tables.js <labels-dir>"); process.exit(1); }
var TRAIN_MAX = parseInt(process.argv[3], 10) || 4000;

// ---------------- load labels ----------------
var accounts = [];
fs.readdirSync(dir).filter(function (f) { return /^labels-T\d-.*\.json$/.test(f); }).forEach(function (f) {
  var d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  d.rows.forEach(function (r) {
    var gems = r.kept.map(function (t) {
      var pool = A.EFFECT_POOLS[t[0]];
      var cfg = {
        baseCost: t[0], gemType: "order",
        willpowerLevel: t[1], orderLevel: t[2],
        effect1: pool[t[3]], effect1Level: t[4],
        effect2: pool[t[5]], effect2Level: t[6]
      };
      var e1i = t[3], l1 = t[4], e2i = t[5], l2 = t[6];
      if (e2i < e1i) { var tmp = e1i; e1i = e2i; l1 = t[6]; e2i = tmp; l2 = t[4]; }
      var eff = t[0] - t[1];
      return {
        rawLin: A.effectScore(cfg.effect1, cfg.effect1Level) + A.effectScore(cfg.effect2, cfg.effect2Level),
        order: cfg.orderLevel,
        eff: eff,
        live: A.gemDamage(cfg) * A.willpowerMultiplier(eff),
        key: t[0] + "|" + e1i + ":" + l1 + "|" + e2i + ":" + l2 + "|" + t[1] + "|" + t[2],
        sock: false
      };
    });
    r.sock.forEach(function (i) { gems[i].sock = true; });
    accounts.push({ tier: d.tier, idx: r.a, gems: gems, k: r.sock.length, train: r.a < TRAIN_MAX });
  });
});
var train = accounts.filter(function (a) { return a.train; });
var test = accounts.filter(function (a) { return !a.train; });
console.log("loaded " + accounts.length + " accounts (" + train.length + " train / " + test.length + " test)\n");

// ---------------- metrics ----------------
function displacements(acc, scoreFn) {
  var gems = acc.gems, n = gems.length, k = acc.k;
  if (!k) return 0;
  var idx = new Array(n), sc = new Array(n);
  for (var i = 0; i < n; i++) { idx[i] = i; sc[i] = scoreFn(gems[i]); }
  idx.sort(function (a, b) { return sc[b] - sc[a] || a - b; });
  var hit = 0;
  for (var j = 0; j < k; j++) if (gems[idx[j]].sock) hit++;
  return k - hit;
}
// benched gems scoring strictly above the worst socketed gem
function floorInversions(acc, scoreFn) {
  var gems = acc.gems, n = gems.length;
  var minSock = Infinity, i, s;
  for (i = 0; i < n; i++) if (gems[i].sock) { s = scoreFn(gems[i]); if (s < minSock) minSock = s; }
  if (!isFinite(minSock)) return 0;
  var c = 0;
  for (i = 0; i < n; i++) if (!gems[i].sock && scoreFn(gems[i]) > minSock + 1e-12) c++;
  return c;
}
function meanOf(accs, scoreFn, metric) {
  var s = 0;
  accs.forEach(function (a) { s += metric(a, scoreFn); });
  return s / accs.length;
}

// ---------------- table-form fitting (coordinate descent) ----------------
// params = [w, v3, v4, v6, v7, v8, v9]  (v5 gauge-fixed: K5 = 0 / M5 = 1)
var COSTS = [3, 4, 6, 7, 8, 9];
function makeKTable(p) {
  var K = { 5: 0 };
  COSTS.forEach(function (c, i) { K[c] = p[i + 1]; });
  return function (g) { return g.rawLin + p[0] * g.order + K[g.eff]; };
}
function makeMTable(p) {
  var Mt = { 5: 1 };
  COSTS.forEach(function (c, i) { Mt[c] = p[i + 1]; });
  return function (g) { return (g.rawLin + p[0] * g.order) * Mt[g.eff]; };
}
function coordDescent(accs, make, p0, steps0, passes, metric, label) {
  var p = p0.slice(), steps = steps0.slice();
  var best = meanOf(accs, make(p), metric);
  for (var pass = 0; pass < passes; pass++) {
    for (var d = 0; d < p.length; d++) {
      var tryVals = [p[d] - 2 * steps[d], p[d] - steps[d], p[d] + steps[d], p[d] + 2 * steps[d]];
      for (var t = 0; t < tryVals.length; t++) {
        var q = p.slice(); q[d] = tryVals[t];
        var v = meanOf(accs, make(q), metric);
        if (v < best - 1e-9) { best = v; p = q; }
      }
    }
    for (var s = 0; s < steps.length; s++) steps[s] /= 2.2;
    console.log("  [" + label + "] pass " + (pass + 1) + "/" + passes + ": objective " + best.toFixed(4));
  }
  return { p: p, obj: best };
}

var t0 = Date.now();
// init from the prior linear/slope fits
var initK = [0.156].concat(COSTS.map(function (c) { return 0.048 * (5 - c); }));
var initM = [0.156].concat(COSTS.map(function (c) { return 1 + 0.040 * (5 - c); }));
var stepK = [0.01].concat(COSTS.map(function () { return 0.03; }));
var stepM = [0.01].concat(COSTS.map(function () { return 0.03; }));

console.log("=== fitting table forms (train " + train.length + " accounts) ===");
var fitK = coordDescent(train, makeKTable, initK, stepK, 4, displacements, "K disp");
var fitM = coordDescent(train, makeMTable, initM, stepM, 4, displacements, "M disp");
var fitKF = coordDescent(train, makeKTable, fitK.p, stepK, 4, floorInversions, "K floor");
var fitMF = coordDescent(train, makeMTable, fitM.p, stepM, 4, floorInversions, "M floor");
console.log("fit time " + ((Date.now() - t0) / 1000).toFixed(0) + "s\n");

function fmtTable(p, gaugeVal, name) {
  var vals = { 5: gaugeVal };
  COSTS.forEach(function (c, i) { vals[c] = p[i + 1]; });
  return name + " w=" + p[0].toFixed(4) + "  " + [3, 4, 5, 6, 7, 8, 9].map(function (c) {
    return "c" + c + ":" + vals[c].toFixed(3);
  }).join(" ");
}
console.log(fmtTable(fitK.p, 0, "K-table (K5=0)  "));
console.log(fmtTable(fitM.p, 1, "M-table (M5=1)  "));
console.log(fmtTable(fitKF.p, 0, "K-floor (K5=0)  "));
console.log(fmtTable(fitMF.p, 1, "M-floor (M5=1)  "));
console.log("");

// ---------------- C table (ceiling reference) ----------------
var scoreB = function (g) { return g.rawLin + 0.156 * g.order + 0.048 * (4.25 - g.eff); };
var aL = 0, bL = 0;
(function () {
  for (var it = 0; it < 30; it++) {
    var g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    train.forEach(function (acc) {
      acc.gems.forEach(function (g) {
        var x = scoreB(g);
        var pr = 1 / (1 + Math.exp(-(aL + bL * x)));
        var y = g.sock ? 1 : 0, e = y - pr, wgt = pr * (1 - pr);
        g0 += e; g1 += e * x;
        h00 += wgt; h01 += wgt * x; h11 += wgt * x * x;
      });
    });
    var det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    var da = (g0 * h11 - g1 * h01) / det, db = (g1 * h00 - g0 * h01) / det;
    aL += da; bL += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
})();
var table = {};
train.forEach(function (acc) {
  acc.gems.forEach(function (g) {
    var e = table[g.key];
    if (!e) { e = table[g.key] = { n: 0, s: 0 }; }
    e.n++; if (g.sock) e.s++;
  });
});
var SMOOTH = 25;
function scoreC(g) {
  var p0 = 1 / (1 + Math.exp(-(aL + bL * scoreB(g))));
  var e = table[g.key];
  if (!e) return p0;
  return (e.s + SMOOTH * p0) / (e.n + SMOOTH);
}

// ---------------- evaluation ----------------
var scorers = [
  ["live (damage x M)", function (g) { return g.live; }],
  ["B-linear (prior)", scoreB],
  ["A-slope (prior)", function (g) { return (g.rawLin + 0.156 * g.order) * (1 + 0.040 * (5 - g.eff)); }],
  ["K-table", makeKTable(fitK.p)],
  ["M-table", makeMTable(fitM.p)],
  ["K-floor-fit", makeKTable(fitKF.p)],
  ["M-floor-fit", makeMTable(fitMF.p)],
  ["C table (ceiling)", scoreC]
];

// the adjudicated pair: c10 wp2 Boss5/Add5 order5  vs  perfect c8 Add5/Atk5
var monster = { rawLin: A.effectScore("Boss Damage", 5) + A.effectScore("Additional Damage", 5), order: 5, eff: 8 };
monster.live = (monster.rawLin + A.orderScore(5)) * A.willpowerMultiplier(8);
var p8gem = { rawLin: A.effectScore("Additional Damage", 5) + A.effectScore("Attack Power", 5), order: 5, eff: 3 };
p8gem.live = (p8gem.rawLin + A.orderScore(5)) * A.willpowerMultiplier(3);
monster.key = "x"; p8gem.key = "y"; // no C-table cells: C falls back to logistic

["T1", "T2", "T3", "ALL"].forEach(function (tn) {
  var accs = (tn === "ALL") ? test : test.filter(function (a) { return a.tier === tn; });
  console.log("=== TEST " + tn + " (" + accs.length + " held-out accounts) ===");
  console.log("| Scorer | top-12 misses | floor inversions | exact-12 | monster vs perfect-c8 |");
  console.log("|---|---|---|---|---|");
  scorers.forEach(function (s) {
    var name = s[0], fn = s[1];
    var d = 0, fl = 0, exact = 0;
    accs.forEach(function (a) {
      var dd = displacements(a, fn);
      d += dd; if (dd === 0) exact++;
      fl += floorInversions(a, fn);
    });
    var verdict = fn(monster) > fn(p8gem) ? "monster wins (WRONG)" : "perfect c8 wins (right)";
    console.log("| " + name + " | " + (d / accs.length).toFixed(3) + " | " + (fl / accs.length).toFixed(3) +
      " | " + (100 * exact / accs.length).toFixed(1) + "% | " + verdict + " |");
  });
  console.log("");
});
