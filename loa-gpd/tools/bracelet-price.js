/**
 * Price an UNROLLED support bracelet, and cost the path to each rank.
 *
 * An unrolled bracelet has its two combat traits fixed and all seven rolls left
 * on the three granted slots. Every one of them carries the same expected line
 * value, so the price is a pure function of the stat pair — which is why
 * Shizu's twenty market quotes list nothing but stats.
 *
 * Supply is therefore the stat-pair distribution (Stove's bands, convolved),
 * and demand is the accessory market's Pareto:
 *
 *   price(D) = integral[base..D] pmin * (1 - F(x))^(-1/a) dx  -  20 pheons
 *
 * The seller nets the pheons less, so the fit works in listed gold.
 *
 * Reaching a rank then costs (price + pheons) / P(the rolls get you there),
 * minimised over which stat pair you buy — a cheap bracelet you reroll many
 * times can beat an expensive one, and the model says which.
 */
"use strict";
var fs = require("fs");
var B = require("../model/bracelet.js");

var PHEON_GOLD = (850 / 100) * (25000 / 95);
var TAX = 20 * PHEON_GOLD;
var SAMPLES = [
  [63,89,333],[81,72,899],[79,79,1000],[76,86,1111],[99,67,2300],
  [71,97,3500],[73,96,3500],[71,99,4000],[91,84,5000],[109,69,8000],
  [117,70,10000],[77,113,15000],[118,89,19000],[95,114,57000],
  [113,99,57777],[117,98,60000],[116,101,60000],[118,100,60000],
  [120,100,80000],[107,116,80000]
];

// ---- supply: the stat pair --------------------------------------------------
var BANDS = [[10,61,66],[16,67,72],[16,73,78],[16,79,84],[10,85,90],
             [10,91,96],[10,97,102],[4,103,108],[4,109,114],[4,115,120]];
var pStat = new Float64Array(121);
BANDS.forEach(function (b) {
  var n = b[2] - b[1] + 1;
  for (var v = b[1]; v <= b[2]; v++) pStat[v] += (b[0] / 100) / n;
});
var pSum = new Float64Array(241);
for (var i = 61; i <= 120; i++) for (var j = 61; j <= 120; j++) pSum[i + j] += pStat[i] * pStat[j];
var cdfSum = new Float64Array(241), acc = 0;
for (var s = 0; s <= 240; s++) { acc += pSum[s]; cdfSum[s] = acc; }

var PER = B.TRAIT_PER_POINT;
var BASE_SUM = 122;

/** Gross gold for a stat sum, before the pheon tax. */
function gross(sum, a, pmin) {
  var g = 0;
  for (var k = BASE_SUM; k <= sum; k++) {
    var f = Math.min(cdfSum[k - 1] || 0, 1 - 1e-12);
    g += pmin * Math.pow(1 - f, -1 / a) * PER;      // PER = damage per stat point
  }
  return g;
}
// The quotes are LISTED market prices. Pheons are what the buyer pays on top,
// not a deduction from the seller — that subtraction belongs in the accessory
// model, which prices seller value. So the fit is the bare integral.
function listed(sum, a, pmin) { return gross(sum, a, pmin); }

// ---- fit --------------------------------------------------------------------
var best = null;
for (var a = 0.2; a <= 8; a += 0.005) {
  var num = 0, den = 0;
  SAMPLES.forEach(function (q) {
    var g = gross(q[0] + q[1], a, 1);
    if (g > 0) { num += Math.log(q[2] / g); den++; }
  });
  var pmin = Math.exp(num / den), e = 0;
  SAMPLES.forEach(function (q) {
    e += Math.pow(Math.log((listed(q[0] + q[1], a, pmin) + 1) / (q[2] + 1)), 2);
  });
  if (!best || e < best.e) best = { a: a, pmin: pmin, e: e };
}
console.log("pheon " + Math.round(PHEON_GOLD).toLocaleString() + "g, bracelet tax " +
  Math.round(TAX).toLocaleString() + "g");
console.log("fit over the stat pair: a = " + best.a.toFixed(3) + ", pmin = " +
  best.pmin.toFixed(0) + ", rms log error " + Math.sqrt(best.e / SAMPLES.length).toFixed(3));
console.log("(accessory market fits a = 1.25 to 1.48)\n");
console.log("stats   | quoted  | model   | ratio");
SAMPLES.forEach(function (q) {
  var m = listed(q[0] + q[1], best.a, best.pmin);
  console.log((q[0] + "+" + q[1]).padStart(7) + " | " + q[2].toLocaleString().padStart(7) + " | " +
    Math.round(m).toLocaleString().padStart(7) + " | " + (m / q[2]).toFixed(2));
});
module.exports = { fit: best, listed: listed, TAX: TAX, cdfSum: cdfSum, pSum: pSum, PER: PER };

// ---- what it costs to reach a rank -----------------------------------------
// The lines are independent of the stat pair, so P(reach rank | stats) is one
// line-damage distribution read at a different threshold. Buying a cheap
// bracelet and rerolling many can beat buying an expensive one; this finds the
// cheapest stat pair to buy for each target.
if (require.main === module) {
  function m32(x){var q=x>>>0;return function(){q=(q+0x6D2B79F5)|0;var t=q;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  var rand = m32(20260814);
  var th = B.lockThresholds(rand, 7, 200000);
  var TRIALS = 2000000, LBIN = 0.005, lineHist = new Float64Array(4000);
  for (var n = 0; n < TRIALS; n++) {
    var br = B.rollBracelet(rand, 7, th);
    var b = Math.min(3999, Math.round(br.lineDamage / LBIN));
    lineHist[b] += 1;
  }
  var tailAbove = new Float64Array(4001);      // P(line damage >= bin)
  var run2 = 0;
  for (var k = 3999; k >= 0; k--) { run2 += lineHist[k]; tailAbove[k] = run2 / TRIALS; }
  function pLineAtLeast(d) {
    if (d <= 0) return 1;
    var b2 = Math.ceil(d / LBIN);
    return b2 >= 4000 ? 0 : tailAbove[b2];
  }

  var floorD = B.floor(), spanD = B.anchor() - floorD;
  console.log("\ncheapest route to each rank (buy unrolled, use all seven rolls)");
  console.log("rank | need  | buy stats | listed  | p(hit)   | bracelets | expected gold");
  B.LADDER.forEach(function (row) {
    if (!isFinite(row[1])) return;
    var target = floorD + (row[1] / 100) * spanD;
    var bestBuy = null;
    for (var sum = 122; sum <= 240; sum++) {
      if (pSum[sum] < 1e-12) continue;
      var p = pLineAtLeast(target - sum * PER);
      if (p <= 0) continue;
      var cost = (listed(sum, best.a, best.pmin) + TAX) / p;
      if (!bestBuy || cost < bestBuy.cost) bestBuy = { sum: sum, p: p, cost: cost };
    }
    if (!bestBuy) { console.log(row[0].padEnd(4) + " | unreachable"); return; }
    console.log(row[0].padEnd(4) + " | " + target.toFixed(2).padStart(5) + " | " +
      String(bestBuy.sum).padStart(9) + " | " +
      Math.round(listed(bestBuy.sum, best.a, best.pmin)).toLocaleString().padStart(7) + " | " +
      (100 * bestBuy.p).toFixed(4).padStart(8) + "% | " +
      (1 / bestBuy.p).toFixed(1).padStart(9) + " | " +
      Math.round(bestBuy.cost).toLocaleString().padStart(13));
  });
}
