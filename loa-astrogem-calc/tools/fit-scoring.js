/**
 * fit-scoring.js — bake-off of three scoring transforms against the packer's
 * roster choices (labels from account-study.js --dump-labels).
 *
 * Goal (Shizu, 2026-08-08): transform the score — primarily its willpower
 * contribution — to minimize displacements vs the raw-optimal top 12.
 *
 * Scorers:
 *   base : current gemValue (damage × M(effCost))                  [reference]
 *   A    : (rawLin + w·order) × (1 + s·(5 − effCost))              [retuned M]
 *   B    : rawLin + w·order − λ·effCost                            [additive willpower price]
 *   C    : smoothed P(socketed | config) from train accounts,      [empirical table]
 *          logistic backoff on the fitted B score for thin cells
 *
 * Protocol: fit on accounts 0–7499 per tier (pooled), test on 7500–9999.
 * Metrics: mean displacements/account (top-k by score vs packer's k socketed),
 * exact-match rate, and damage loss of the scorer's greedy-feasible roster vs
 * the packer's optimum. Per-tier refits reported to show parameter drift.
 *
 *   node tools/fit-scoring.js <dir with labels-*.json>
 */
"use strict";
var fs = require("fs");
var path = require("path");
var A = require("../model/astrogem.js");
var M = require("./account-study.js");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/fit-scoring.js <dir>"); process.exit(1); }

var TRAIN_MAX = 7500;

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
      if (e2i < e1i || (e2i === e1i)) { var tmp = e1i; e1i = t[5]; l1 = t[6]; e2i = tmp; l2 = t[4]; }
      return {
        cfg: cfg,
        rawLin: A.effectScore(cfg.effect1, cfg.effect1Level) + A.effectScore(cfg.effect2, cfg.effect2Level),
        order: cfg.orderLevel,
        eff: cfg.baseCost - cfg.willpowerLevel,
        base: A.gemValue(cfg),
        key: t[0] + "|" + e1i + ":" + l1 + "|" + e2i + ":" + l2 + "|" + t[1] + "|" + t[2],
        sock: false
      };
    });
    r.sock.forEach(function (i) { gems[i].sock = true; });
    accounts.push({ tier: d.tier, idx: r.a, gems: gems, k: r.sock.length, optDmg: r.dmg, train: r.a < TRAIN_MAX });
  });
});
console.log("loaded " + accounts.length + " accounts from " + dir + "\n");

// ---------------- displacement evaluation ----------------
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
function meanDisp(accs, scoreFn) {
  var s = 0;
  accs.forEach(function (a) { s += displacements(a, scoreFn); });
  return s / accs.length;
}

// ---------------- fit A and B by grid search ----------------
function fitGrid(accs, make, s0, s1, ds, w0, w1, dw) {
  var best = null;
  for (var s = s0; s <= s1 + 1e-12; s += ds) {
    for (var w = w0; w <= w1 + 1e-12; w += dw) {
      var fn = make(s, w);
      var d = meanDisp(accs, fn);
      if (!best || d < best.d) best = { s: s, w: w, d: d };
    }
  }
  return best;
}
function fitTwoStage(accs, make, sMax, wMax) {
  var c = fitGrid(accs, make, 0, sMax, sMax / 14, 0, wMax, wMax / 10);
  var sStep = sMax / 14, wStep = wMax / 10;
  var r = fitGrid(accs, make,
    Math.max(0, c.s - sStep), c.s + sStep, sStep / 5,
    Math.max(0, c.w - wStep), c.w + wStep, wStep / 5);
  return r;
}
var makeA = function (s, w) { return function (g) { return (g.rawLin + w * g.order) * (1 + s * (5 - g.eff)); }; };
var makeB = function (l, w) { return function (g) { return g.rawLin + w * g.order - l * g.eff; }; };

var train = accounts.filter(function (a) { return a.train; });
var test = accounts.filter(function (a) { return !a.train; });

console.log("=== fits (pooled train, " + train.length + " accounts) ===");
var t0 = Date.now();
var fitA = fitTwoStage(train, makeA, 0.14, 0.20);
console.log("A: M-slope s=" + fitA.s.toFixed(4) + "/cost-level (was 0.0984), order w=" + fitA.w.toFixed(4) +
  " (was 0.1599) -> train disp " + fitA.d.toFixed(3));
var fitB = fitTwoStage(train, makeB, 0.14, 0.20);
console.log("B: lambda=" + fitB.s.toFixed(4) + "/willpower point, order w=" + fitB.w.toFixed(4) +
  " -> train disp " + fitB.d.toFixed(3) + "   (" + ((Date.now() - t0) / 1000).toFixed(0) + "s)");

// per-tier refits (drift diagnostic)
["T1", "T2", "T3"].forEach(function (tn) {
  var tt = train.filter(function (a) { return a.tier === tn; });
  var fa = fitTwoStage(tt, makeA, 0.14, 0.20);
  var fb = fitTwoStage(tt, makeB, 0.14, 0.20);
  console.log("  " + tn + ": A(s=" + fa.s.toFixed(3) + ", w=" + fa.w.toFixed(3) + ") · B(λ=" + fb.s.toFixed(3) + ", w=" + fb.w.toFixed(3) + ")");
});

// ---------------- C: propensity table with logistic backoff ----------------
var scoreBfit = makeB(fitB.s, fitB.w);
// 1D logistic p(sock) ~ a + b·scoreB, Newton on train gems
var aL = 0, bL = 0;
(function () {
  for (var it = 0; it < 30; it++) {
    var g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    train.forEach(function (acc) {
      acc.gems.forEach(function (g) {
        var x = scoreBfit(g);
        var p = 1 / (1 + Math.exp(-(aL + bL * x)));
        var y = g.sock ? 1 : 0, e = y - p, wgt = p * (1 - p);
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
  var p0 = 1 / (1 + Math.exp(-(aL + bL * scoreBfit(g))));
  var e = table[g.key];
  if (!e) return p0;
  return (e.s + SMOOTH * p0) / (e.n + SMOOTH);
}
var nCells = Object.keys(table).length;
console.log("C: " + nCells + " config cells (logistic backoff a=" + aL.toFixed(2) + " b=" + bL.toFixed(2) + ", m=" + SMOOTH + ")\n");

// ---------------- evaluation ----------------
var scorers = {
  "base (gemValue)": function (g) { return g.base; },
  "A retuned-M": makeA(fitA.s, fitA.w),
  "B additive-λ": makeB(fitB.s, fitB.w),
  "C table": scoreC
};

function greedyDamageLoss(acc, scoreFn) {
  var metas = acc.gems.map(function (g) { return M.gemMeta(g.cfg); });
  var scored = metas.map(function (m, i) { return { m: m, s: scoreFn(acc.gems[i]) }; });
  scored.sort(function (x, y) { return y.s - x.s; });
  var sel = M.seedSelection(scored.map(function (x) { return x.m; }), function () { return 0; });
  // seedSelection with constant key keeps the presorted order and enforces feasibility
  var res = M.bestGrouping(sel);
  return acc.optDmg - (res ? res.dmg : 0);
}

["T1", "T2", "T3", "ALL"].forEach(function (tn) {
  var accs = (tn === "ALL") ? test : test.filter(function (a) { return a.tier === tn; });
  console.log("=== TEST " + tn + " (" + accs.length + " held-out accounts) ===");
  console.log("| Scorer | mean displacements | exact-12 match | share ≤1 | damage loss vs packer |");
  console.log("|---|---|---|---|---|");
  Object.keys(scorers).forEach(function (name) {
    var fn = scorers[name];
    var d = 0, exact = 0, le1 = 0, loss = 0;
    accs.forEach(function (a) {
      var dd = displacements(a, fn);
      d += dd; if (dd === 0) exact++; if (dd <= 1) le1++;
      loss += greedyDamageLoss(a, fn);
    });
    console.log("| " + name + " | " + (d / accs.length).toFixed(3) + " | " +
      (100 * exact / accs.length).toFixed(1) + "% | " + (100 * le1 / accs.length).toFixed(1) + "% | " +
      (loss / accs.length).toFixed(4) + "% |");
  });
  console.log("");
});
