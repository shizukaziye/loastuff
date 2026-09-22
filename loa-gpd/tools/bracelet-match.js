/**
 * Percentile-matched support bands.
 *
 * The two axes have different shapes, not just different scales, so no single
 * anchor makes a support A- as rare as a DPS A-. Instead we read the DPS band
 * rarities off its own distribution and cut the support ladder at the same
 * rarities — the approach the astrogem calculator already took when it moved to
 * percentile-aware letter bands.
 *
 *   node tools/bracelet-match.js      (needs both --dump histograms)
 */
"use strict";
var fs = require("fs");
var LADDER = [["S+",100.1],["S",95],["S-",90],["A+",85],["A",80],["A-",75],
  ["B+",70],["B",65],["B-",60],["C+",55],["C",50],["C-",45],["D+",40],["D",35],
  ["D-",30],["F+",20],["F",10]];
var dps = JSON.parse(fs.readFileSync("tools/.cache/hist-dps.json", "utf8"));
var sup = JSON.parse(fs.readFileSync("tools/.cache/hist-support.json", "utf8"));

/** share of the run scoring at or above `score` */
function shareAbove(h, score) {
  var n = 0, from = Math.max(0, Math.ceil(score / h.bin));
  for (var i = from; i < h.hist.length; i++) n += h.hist[i];
  return n / h.n;
}
/** the score with exactly `share` of the run at or above it */
function scoreAt(h, share) {
  var target = share * h.n, run = 0;
  for (var i = h.hist.length - 1; i >= 0; i--) {
    run += h.hist[i];
    if (run >= target) return i * h.bin;
  }
  return 0;
}

console.log("rank | DPS opens | DPS rarity  | support cut | support rarity | 1 in");
LADDER.forEach(function (row) {
  var rarity = shareAbove(dps, row[1]);
  var cut = scoreAt(sup, rarity);
  console.log(row[0].padEnd(4) + " | " + String(row[1]).padStart(9) + " | " +
    (100 * rarity).toFixed(5).padStart(10) + "% | " + cut.toFixed(1).padStart(11) + " | " +
    (100 * shareAbove(sup, cut)).toFixed(5).padStart(13) + "% | " +
    (rarity > 0 ? Math.round(1 / rarity).toLocaleString() : "-"));
});
