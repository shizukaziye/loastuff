/** Cut a million bracelets, keep the ones a support would keep, rank them. */
"use strict";
var B = require("../model/bracelet.js");

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var N = Number(process.argv[2] || 1000000);
var rand = mulberry32(20260813);
var kept = [], cut = 0;
for (var i = 0; i < N; i++) {
  var b = B.roll(rand, true);
  if (!B.isKeeper(b)) { cut++; continue; }
  kept.push({ d: B.score(b, true), b: b });
}
kept.sort(function (x, y) { return x.d - y.d; });

// scale 0-100 by the best bracelet the roll can physically produce
var best = 2 * 120 * B.TRAIT_PER_POINT + B.SUPPORT_LINE[17][2] + B.SUPPORT_LINE[19][2] + B.SUPPORT_LINE[16][2];
console.log("cut " + N.toLocaleString() + ", kept " + kept.length.toLocaleString() +
            " (" + (100 * kept.length / N).toFixed(2) + "%), discarded " + cut.toLocaleString());
console.log("perfect bracelet = " + best.toFixed(3) + " damage points = score 100\n");

function at(p) { return kept[Math.min(kept.length - 1, Math.floor(p / 100 * kept.length))]; }
console.log("percentile |  damage  | score | what it rolled");
[1,5,10,20,30,40,50,60,70,75,80,85,90,95,97,99,99.5,99.9,99.99,100].forEach(function (p) {
  var k = at(p === 100 ? 99.9999 : p);
  var lines = k.b.specials.filter(function (s) { return B.SUPPORT_LINE[s.family]; })
    .map(function (s) { return "f" + s.family + ["b","e","L"][s.tier]; }).join("+") || "none";
  var traits = k.b.traits.map(function (t) {
    return (t.stat === "spec" ? "SP" : t.stat === "swiftness" ? "SW" : "--") + t.value;
  }).join("/") || "no traits";
  console.log(String(p).padStart(10) + " | " + k.d.toFixed(3).padStart(8) + " | " +
    (100 * k.d / best).toFixed(1).padStart(5) + " | " + traits.padEnd(12) + " " + lines);
});

console.log("\nscore band -> share of kept bracelets, and percentile of the band floor");
var bands = [0,10,20,30,40,50,60,70,80,90];
bands.forEach(function (lo, idx) {
  var hi = idx + 1 < bands.length ? bands[idx + 1] : 101;
  var n = kept.filter(function (k) { var s = 100 * k.d / best; return s >= lo && s < hi; }).length;
  var below = kept.filter(function (k) { return 100 * k.d / best < lo; }).length;
  console.log("  " + String(lo).padStart(3) + "-" + String(hi === 101 ? 100 : hi).padStart(3) +
    " | " + String(n).padStart(8) + " | " + (100 * n / kept.length).toFixed(3).padStart(7) + "% | " +
    "floor at percentile " + (100 * below / kept.length).toFixed(2));
});
