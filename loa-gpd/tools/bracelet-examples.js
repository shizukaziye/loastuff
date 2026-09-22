/** An example bracelet sitting just above each rank cut, plus what you buy. */
"use strict";
var B = require("../model/bracelet.js");
function m32(s){var a=s>>>0;return function(){a=(a+0x6D2B79F5)|0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
var rand = m32(20260814), th = B.lockThresholds(rand, 7, 200000);
var NAME = { 16: "defence shred", 17: "crit resist", 18: "shielded dmg", 19: "crit dmg resist",
             20: "weapon power (stacking)", 21: "weapon power", 22: "weapon power (stacks)",
             29: "ally atk power", 30: "ally damage", 33: "weapon power" };
var found = {};
for (var i = 0; i < 3000000 && Object.keys(found).length < B.LADDER.length; i++) {
  var br = B.rollBracelet(rand, 7, th);
  var sc = B.score(br.damage), rk = B.rank(sc);
  if (found[rk] && found[rk].score <= sc) continue;
  var cut = 0;
  B.LADDER.forEach(function (r) { if (r[0] === rk) cut = r[1]; });
  if (!isFinite(cut) || sc > cut + 0.6) continue;       // want one just above the cut
  found[rk] = {
    score: sc, spec: br.spec, swift: br.swift,
    lines: br.held.filter(function (x) { return x.label && x.label !== "mainstat"; })
      .map(function (x) {
        return NAME[x.family] + " " + (x.label.indexOf("LEG") > 0 ? "legendary" :
               x.label.indexOf("epic") > 0 ? "epic" : "blue");
      })
  };
}
var out = {};
B.LADDER.forEach(function (r) {
  var e = found[r[0]];
  if (!e) return;
  out[r[0]] = {
    cut: r[1], example: {
      stats: e.spec + "/" + e.swift,
      lines: e.lines.length ? e.lines : ["nothing"],
      score: Math.round(e.score * 10) / 10
    }
  };
});
console.log(JSON.stringify(out, null, 1));
