/**
 * fit-support-roster.js — support-axis scoring fit on ROSTER-BOUND joint labels
 * (account-study.js --roster-study --axis=support; 9-tuples with side + fused).
 *
 * The support analog of the DPS roster refit. Accounts were cut under the LIVE
 * f03e73a support model (pristine worktree), roster-bound: nothing abandoned,
 * per-side keep floor-5 rule, per-side fusion of discarded relic+ with 2
 * legendary c10s. One unified score must serve both sides; sockets are
 * side-gated so displacement is per-side top-k vs the packer, summed.
 *
 * Candidates:
 *   live-native  : (rawLin + 0.043·order) × M_NAT           [shipped f03e73a]
 *   low-regime   : (rawLin + 0.026·order) × M_LOW           [staged, suspect]
 *   fit-wM       : fit w + multiplicative toll (native seed AND steep seed)
 *   fit-wK       : fit w + ADDITIVE per-cost credit (the form that won DPS)
 *   split-w      : winner form with separate w_order / w_chaos
 *   C table      : P(socketed | config, side) empirical + logistic backoff
 *
 * Usage: node tools/fit-support-roster.js <labels-dir> [trainCapPerTier=1200]
 * Reads supR*.json files with axis:"support".
 */
"use strict";
var fs = require("fs");
var path = require("path");
var A = require("../model/astrogem.js");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/fit-support-roster.js <labels-dir> [trainCapPerTier]"); process.exit(1); }
var TRAIN_CAP = parseInt(process.argv[3], 10) || 1200;

var M_NAT = { 3: 1.146, 4: 1.106, 5: 1.000, 6: 0.891, 7: 0.842, 8: 0.772, 9: 0.660 };
var W_NAT = 0.043;
var M_LOW = { 3: 1.121, 4: 1.062, 5: 1.000, 6: 0.942, 7: 0.848, 8: 0.774, 9: 0.677 };
var W_LOW = 0.026;

// ---------------- load roster joint labels ----------------
var byTier = {};
fs.readdirSync(dir).filter(function (f) { return /^supR\d.*\.json$/.test(f); }).forEach(function (f) {
  var d;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return; }
  if (!d || d.axis !== "support" || !d.rows) return;
  if (!byTier[d.tier]) byTier[d.tier] = [];
  d.rows.forEach(function (r) {
    var gems = r.kept.map(function (t) {
      var pool = A.EFFECT_POOLS[t[0]];
      var e1i = t[3], l1 = t[4], e2i = t[5], l2 = t[6];
      if (e2i < e1i) { var tmp = e1i; e1i = e2i; l1 = t[6]; e2i = tmp; l2 = t[4]; }
      return {
        rawLin: A.supportEffectScore(pool[t[3]], t[4]) + A.supportEffectScore(pool[t[5]], t[6]),
        order: t[2],
        eff: t[0] - t[1],
        side: t[7] === 1 ? 1 : 0,
        fused: t[8] === 1,
        key: t[0] + "|" + e1i + ":" + l1 + "|" + e2i + ":" + l2 + "|" + t[1] + "|" + t[2] + "|s" + (t[7] === 1 ? 1 : 0),
        sock: false
      };
    });
    (r.sockO || []).forEach(function (i) { gems[i].sock = true; });
    (r.sockC || []).forEach(function (i) { gems[i].sock = true; });
    byTier[d.tier].push({
      tier: d.tier, idx: r.a, gems: gems,
      kO: (r.sockO || []).length, kC: (r.sockC || []).length
    });
  });
});
var TIERS = Object.keys(byTier).sort();
var train = [], test = [];
TIERS.forEach(function (tn) {
  var rows = byTier[tn];
  rows.sort(function (a, b) { return a.idx - b.idx; });
  var cut = Math.floor(rows.length * 0.6);
  rows.forEach(function (r, i) {
    if (i < cut) { if (i < TRAIN_CAP) train.push(r); }
    else test.push(r);
  });
  console.log(tn + ": " + rows.length + " accounts (" + Math.min(cut, TRAIN_CAP) + " train used / " + (rows.length - cut) + " test)");
});
console.log("total train " + train.length + " / test " + test.length + "\n");
if (!train.length) { console.error("no roster support labels found in " + dir); process.exit(1); }

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
function meanDisp(accs, scoreFn) {
  var s = 0;
  accs.forEach(function (a) { s += displacements(a, scoreFn); });
  return s / accs.length;
}

// ---------------- score forms ----------------
var COSTS = [3, 4, 6, 7, 8, 9];   // cost 5 pinned (M=1 / K=0)
function tableOf(p, off) {
  var T = { 5: 1 };   // cost 5 pinned: M=1 for mult, overridden to 0 for additive
  COSTS.forEach(function (c, i) { T[c] = p[off + i]; });
  return T;
}
function clampEff(e) { return e < 3 ? 3 : (e > 9 ? 9 : e); }
// multiplicative: p = [w, m3, m4, m6, m7, m8, m9]
function makeWM(p) {
  var T = tableOf(p, 1);
  return function (g) { return (g.rawLin + p[0] * g.order) * T[clampEff(g.eff)]; };
}
// additive: p = [w, k3, k4, k6, k7, k8, k9], K5 = 0
function makeWK(p) {
  var T = tableOf(p, 1); T[5] = 0;
  return function (g) { return g.rawLin + p[0] * g.order + T[clampEff(g.eff)]; };
}
// split order weight on a base form: p = [wO, wC].concat(rest)
function makeSplitWM(p) {
  var T = tableOf(p, 2);
  return function (g) { return (g.rawLin + (g.side === 1 ? p[1] : p[0]) * g.order) * T[clampEff(g.eff)]; };
}
function makeSplitWK(p) {
  var T = tableOf(p, 2); T[5] = 0;
  return function (g) { return g.rawLin + (g.side === 1 ? p[1] : p[0]) * g.order + T[clampEff(g.eff)]; };
}
// allowNeg: additive credits may cross zero; multiplicative tolls and order
// weights stay positive.
function coordDescent(accs, make, p0, steps0, passes, label, allowNeg) {
  var p = p0.slice(), steps = steps0.slice();
  var best = meanDisp(accs, make(p));
  for (var pass = 0; pass < passes; pass++) {
    for (var d = 0; d < p.length; d++) {
      var tryVals = [p[d] - 2 * steps[d], p[d] - steps[d], p[d] + steps[d], p[d] + 2 * steps[d]];
      for (var t = 0; t < tryVals.length; t++) {
        if (!allowNeg[d] && tryVals[t] < 0) continue;
        var q = p.slice(); q[d] = tryVals[t];
        var v = meanDisp(accs, make(q));
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
var NO_NEG_7 = [false, false, false, false, false, false, false];
var ALLOW_K = [false, true, true, true, true, true, true];

// multiplicative: native seed and steep seed, keep the better
var mNat = COSTS.map(function (c) { return M_NAT[c]; });
var mSteep = [1.25, 1.12, 0.88, 0.78, 0.68, 0.55];
var fitM_a = coordDescent(train, makeWM, [W_NAT].concat(mNat), [0.004].concat(COSTS.map(function () { return 0.02; })), 5, "wM native-seed", NO_NEG_7);
var fitM_b = coordDescent(train, makeWM, [W_NAT].concat(mSteep), [0.004].concat(COSTS.map(function () { return 0.02; })), 5, "wM steep-seed", NO_NEG_7);
var fitM = fitM_a.obj <= fitM_b.obj ? fitM_a : fitM_b;

// additive: zero seed and DPS-shape seed (DPS K scaled to support value range)
var kZero = [0, 0, 0, 0, 0, 0];
var kDps = [0.032, 0.023, -0.030, -0.056, -0.079, -0.108];
var fitK_a = coordDescent(train, makeWK, [W_NAT].concat(kZero), [0.004].concat(COSTS.map(function () { return 0.008; })), 5, "wK zero-seed", ALLOW_K);
var fitK_b = coordDescent(train, makeWK, [W_NAT].concat(kDps), [0.004].concat(COSTS.map(function () { return 0.008; })), 5, "wK dps-seed", ALLOW_K);
var fitK = fitK_a.obj <= fitK_b.obj ? fitK_a : fitK_b;

// split-w refinement of BOTH fitted forms
var fitMS = coordDescent(train, makeSplitWM, [fitM.p[0], fitM.p[0]].concat(fitM.p.slice(1)),
  [0.003, 0.003].concat(COSTS.map(function () { return 0.012; })), 4, "wM split-w",
  [false, false].concat(COSTS.map(function () { return false; })));
var fitKS = coordDescent(train, makeSplitWK, [fitK.p[0], fitK.p[0]].concat(fitK.p.slice(1)),
  [0.003, 0.003].concat(COSTS.map(function () { return 0.005; })), 4, "wK split-w",
  [false, false].concat(COSTS.map(function () { return true; })));
console.log("fit time " + ((Date.now() - t0) / 1000).toFixed(0) + "s\n");

function fmtT(T, dec) { return [3, 4, 5, 6, 7, 8, 9].map(function (c) { return "c" + c + ":" + T[c].toFixed(dec); }).join(" "); }
console.log("fit-wM  : w=" + fitM.p[0].toFixed(5) + "  " + fmtT(tableOf(fitM.p, 1), 3) + (fitM === fitM_b ? "  [steep seed won]" : "  [native seed won]"));
var KT = tableOf(fitK.p, 1); KT[5] = 0;
console.log("fit-wK  : w=" + fitK.p[0].toFixed(5) + "  " + fmtT(KT, 4) + (fitK === fitK_b ? "  [dps seed won]" : "  [zero seed won]"));
console.log("wM split: wO=" + fitMS.p[0].toFixed(5) + " wC=" + fitMS.p[1].toFixed(5));
console.log("wK split: wO=" + fitKS.p[0].toFixed(5) + " wC=" + fitKS.p[1].toFixed(5) + "\n");

// ---------------- C table (ceiling) ----------------
var scoreNat = function (g) { return (g.rawLin + W_NAT * g.order) * M_NAT[clampEff(g.eff)]; };
var aL = 0, bL = 0;
(function () {
  for (var it = 0; it < 30; it++) {
    var g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    train.forEach(function (acc) {
      acc.gems.forEach(function (g) {
        var x = scoreNat(g);
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
var ctab = {};
train.forEach(function (acc) {
  acc.gems.forEach(function (g) {
    var e = ctab[g.key] || (ctab[g.key] = { n: 0, s: 0 });
    e.n++; if (g.sock) e.s++;
  });
});
function scoreC(g) {
  var p0 = 1 / (1 + Math.exp(-(aL + bL * scoreNat(g))));
  var e = ctab[g.key];
  return e ? (e.s + 25 * p0) / (e.n + 25) : p0;
}

// ---------------- evaluation ----------------
var scorers = [
  ["live-native (shipped)", scoreNat],
  ["low-regime (staged)", function (g) { return (g.rawLin + W_LOW * g.order) * M_LOW[clampEff(g.eff)]; }],
  ["fit-wM (mult refit)", makeWM(fitM.p)],
  ["fit-wK (additive refit)", makeWK(fitK.p)],
  ["fit-wM split-w", makeSplitWM(fitMS.p)],
  ["fit-wK split-w", makeSplitWK(fitKS.p)],
  ["C table (ceiling)", scoreC]
];
TIERS.concat(["ALL"]).forEach(function (tn) {
  var accs = (tn === "ALL") ? test : test.filter(function (a) { return a.tier === tn; });
  if (!accs.length) return;
  console.log("=== TEST " + tn + " (" + accs.length + " held-out joint accounts) ===");
  console.log("| Scorer | side-gated top-k misses | floor inversions | exact match |");
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
