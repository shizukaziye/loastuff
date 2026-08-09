/**
 * fit-support.js — support-axis scoring fit on JOINT order+chaos labels
 * (account-study.js --dump-labels --axis=support [--fixed-n]).
 *
 * A support account packs both sides; sockets are type-gated, so displacement
 * is measured PER SIDE (top-12 among that side's gems vs the packer's 12) and
 * summed. One score must serve both sides — the bench asks how much each
 * relaxation buys:
 *
 *   transplant   : (supEff + 0.02501·order) × M_DPS[eff]        [shipped today]
 *   fit-w        : fit w, M frozen to the DPS toll               [does w move?]
 *   fit-w+M      : fit w AND the support toll table              [does the toll transfer?]
 *   split-w      : fit w_order / w_chaos separately (+ table)    [is one weight enough?]
 *   C table      : P(socketed | config, side) with logistic backoff  [ceiling]
 *
 * Usage: node tools/fit-support.js <labels-dir> [trainMax=3000]
 * Loads labels-sup*.json (axis:"support" files) only.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var A = require("../model/astrogem.js");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/fit-support.js <labels-dir> [trainMax]"); process.exit(1); }
var TRAIN_MAX = parseInt(process.argv[3], 10) || 3000;

var M_DPS = { 3: 1.074, 4: 1.034, 5: 1.000, 6: 0.963, 7: 0.914, 8: 0.844, 9: 0.735 };
var W_TRANSPLANT = A.SUPPORT_SCORING.orderPerPoint * (0.1571 / A.SCORING.orderPerPoint);

// ---------------- load joint labels ----------------
var accounts = [];
fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
  var d;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return; }
  if (!d || d.axis !== "support" || !d.rows) return;
  d.rows.forEach(function (r) {
    var gems = r.kept.map(function (t) {
      var pool = A.EFFECT_POOLS[t[0]];
      var e1i = t[3], l1 = t[4], e2i = t[5], l2 = t[6];
      if (e2i < e1i) { var tmp = e1i; e1i = e2i; l1 = t[6]; e2i = tmp; l2 = t[4]; }
      return {
        rawLin: A.supportEffectScore(pool[t[3]], t[4]) + A.supportEffectScore(pool[t[5]], t[6]),
        order: t[2],
        eff: t[0] - t[1],
        side: t[7] === 1 ? 1 : 0,   // 0 = order side, 1 = chaos side
        key: t[0] + "|" + e1i + ":" + l1 + "|" + e2i + ":" + l2 + "|" + t[1] + "|" + t[2] + "|s" + (t[7] === 1 ? 1 : 0),
        sock: false
      };
    });
    (r.sockO || []).forEach(function (i) { gems[i].sock = true; });
    (r.sockC || []).forEach(function (i) { gems[i].sock = true; });
    var kO = (r.sockO || []).length, kC = (r.sockC || []).length;
    accounts.push({ tier: d.tier, idx: r.a, gems: gems, kO: kO, kC: kC, train: r.a < TRAIN_MAX });
  });
});
var train = accounts.filter(function (a) { return a.train; });
var test = accounts.filter(function (a) { return !a.train; });
console.log("loaded " + accounts.length + " joint support accounts (" + train.length + " train / " + test.length + " test)\n");
if (!accounts.length) { console.error("no support labels found in " + dir); process.exit(1); }

// ---------------- metrics (side-gated) ----------------
function sideDisplacements(acc, scoreFn, side, k) {
  if (!k) return 0;
  var idx = [], sc = [];
  for (var i = 0; i < acc.gems.length; i++) {
    if (acc.gems[i].side !== side) continue;
    idx.push(i); sc.push(scoreFn(acc.gems[i]));
  }
  var ord = idx.map(function (_, j) { return j; });
  ord.sort(function (a, b) { return sc[b] - sc[a] || a - b; });
  var hit = 0;
  for (var j = 0; j < k && j < ord.length; j++) if (acc.gems[idx[ord[j]]].sock) hit++;
  return k - hit;
}
function displacements(acc, scoreFn) {
  return sideDisplacements(acc, scoreFn, 0, acc.kO) + sideDisplacements(acc, scoreFn, 1, acc.kC);
}
function floorInversions(acc, scoreFn) {
  var c = 0;
  for (var side = 0; side <= 1; side++) {
    var minSock = Infinity, i, s;
    for (i = 0; i < acc.gems.length; i++)
      if (acc.gems[i].side === side && acc.gems[i].sock) { s = scoreFn(acc.gems[i]); if (s < minSock) minSock = s; }
    if (!isFinite(minSock)) continue;
    for (i = 0; i < acc.gems.length; i++)
      if (acc.gems[i].side === side && !acc.gems[i].sock && scoreFn(acc.gems[i]) > minSock + 1e-12) c++;
  }
  return c;
}
function meanOf(accs, scoreFn, metric) {
  var s = 0;
  accs.forEach(function (a) { s += metric(a, scoreFn); });
  return s / accs.length;
}

// ---------------- fitting ----------------
var COSTS = [3, 4, 6, 7, 8, 9];
function tableOf(p, off) {
  var Mt = { 5: 1 };
  COSTS.forEach(function (c, i) { Mt[c] = p[off + i]; });
  return Mt;
}
// fit-w only: p = [w]
function makeW(p) {
  return function (g) { return (g.rawLin + p[0] * g.order) * M_DPS[g.eff]; };
}
// fit-w + support table: p = [w, m3, m4, m6, m7, m8, m9]
function makeWM(p) {
  var Mt = tableOf(p, 1);
  return function (g) { return (g.rawLin + p[0] * g.order) * Mt[g.eff]; };
}
// split w by side + table: p = [wOrder, wChaos, m3, m4, m6, m7, m8, m9]
function makeSplit(p) {
  var Mt = tableOf(p, 2);
  return function (g) { return (g.rawLin + (g.side === 1 ? p[1] : p[0]) * g.order) * Mt[g.eff]; };
}
function coordDescent(accs, make, p0, steps0, passes, label) {
  var p = p0.slice(), steps = steps0.slice();
  var best = meanOf(accs, make(p), displacements);
  for (var pass = 0; pass < passes; pass++) {
    for (var d = 0; d < p.length; d++) {
      var tryVals = [p[d] - 2 * steps[d], p[d] - steps[d], p[d] + steps[d], p[d] + 2 * steps[d]];
      for (var t = 0; t < tryVals.length; t++) {
        if (tryVals[t] < 0) continue;
        var q = p.slice(); q[d] = tryVals[t];
        var v = meanOf(accs, make(q), displacements);
        if (v < best - 1e-9) { best = v; p = q; }
      }
    }
    for (var s = 0; s < steps.length; s++) steps[s] /= 2.2;
    console.log("  [" + label + "] pass " + (pass + 1) + "/" + passes + ": train disp " + best.toFixed(4));
  }
  return { p: p, obj: best };
}

var t0 = Date.now();
console.log("=== fits (train " + train.length + " accounts) ===");
var mInit = COSTS.map(function (c) { return M_DPS[c]; });
var fitW = coordDescent(train, makeW, [W_TRANSPLANT], [0.004], 5, "fit-w");
var fitWM = coordDescent(train, makeWM, [fitW.p[0]].concat(mInit), [0.004].concat(COSTS.map(function () { return 0.02; })), 5, "fit-w+M");
var fitSp = coordDescent(train, makeSplit, [fitWM.p[0], fitWM.p[0]].concat(fitWM.p.slice(1)), [0.004, 0.004].concat(COSTS.map(function () { return 0.015; })), 5, "split-w");
console.log("fit time " + ((Date.now() - t0) / 1000).toFixed(0) + "s\n");

console.log("fit-w   : w=" + fitW.p[0].toFixed(5) + "  (transplant w=" + W_TRANSPLANT.toFixed(5) + ")");
function fmtM(Mt) { return [3, 4, 5, 6, 7, 8, 9].map(function (c) { return "c" + c + ":" + Mt[c].toFixed(3); }).join(" "); }
console.log("fit-w+M : w=" + fitWM.p[0].toFixed(5) + "  " + fmtM(tableOf(fitWM.p, 1)) + "  (DPS toll: " + fmtM(M_DPS) + ")");
console.log("split-w : wO=" + fitSp.p[0].toFixed(5) + " wC=" + fitSp.p[1].toFixed(5) + "  " + fmtM(tableOf(fitSp.p, 2)) + "\n");

// ---------------- C table ----------------
var scoreT = function (g) { return (g.rawLin + W_TRANSPLANT * g.order) * M_DPS[g.eff]; };
var aL = 0, bL = 0;
(function () {
  for (var it = 0; it < 30; it++) {
    var g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    train.forEach(function (acc) {
      acc.gems.forEach(function (g) {
        var x = scoreT(g);
        var pr = 1 / (1 + Math.exp(-(aL + bL * x)));
        var y = g.sock ? 1 : 0, e = y - pr, wgt = pr * (1 - pr);
        g0 += e; g1 += e * x;
        h00 += wgt; h01 += wgt * x; h11 += wgt * x * x;
      });
    });
    var det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    aL += (g0 * h11 - g1 * h01) / det; bL += (g1 * h00 - g0 * h01) / det;
    if (!isFinite(aL) || !isFinite(bL)) { aL = 0; bL = 0; break; }
  }
})();
var table = {};
train.forEach(function (acc) {
  acc.gems.forEach(function (g) {
    var e = table[g.key] || (table[g.key] = { n: 0, s: 0 });
    e.n++; if (g.sock) e.s++;
  });
});
function scoreC(g) {
  var p0 = 1 / (1 + Math.exp(-(aL + bL * scoreT(g))));
  var e = table[g.key];
  return e ? (e.s + 25 * p0) / (e.n + 25) : p0;
}

// ---------------- evaluation ----------------
var scorers = [
  ["transplant (shipped)", scoreT],
  ["fit-w (DPS toll)", makeW(fitW.p)],
  ["fit-w+M (support toll)", makeWM(fitWM.p)],
  ["split-w", makeSplit(fitSp.p)],
  ["C table (ceiling)", scoreC]
];
["T1", "T2", "T3", "ALL"].forEach(function (tn) {
  var accs = (tn === "ALL") ? test : test.filter(function (a) { return a.tier === tn; });
  if (!accs.length) return;
  console.log("=== TEST " + tn + " (" + accs.length + " held-out joint accounts) ===");
  console.log("| Scorer | side-gated top-12 misses | floor inversions | exact match |");
  console.log("|---|---|---|---|");
  scorers.forEach(function (s) {
    var d = 0, fl = 0, exact = 0;
    accs.forEach(function (a) {
      var dd = displacements(a, s[1]);
      d += dd; if (dd === 0) exact++;
      fl += floorInversions(a, s[1]);
    });
    console.log("| " + s[0] + " | " + (d / accs.length).toFixed(3) + " | " + (fl / accs.length).toFixed(3) +
      " | " + (100 * exact / accs.length).toFixed(1) + "% |");
  });
  console.log("");
});
