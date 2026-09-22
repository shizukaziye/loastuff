/**
 * Regenerate the support bracelet line values at the reference character.
 *
 * The buff halves (ally attack power, ally damage, weapon power, main stat) go
 * through model/support.js. The party-wide debuff halves of families 16-19 have
 * no channel there, so they use the bracelet calculator's own crit and defence
 * functions — the same code its DPS numbers come from, so the two tools cannot
 * disagree about what a shred line does.
 *
 * Families 20/21/22 take MAX STACKS AT FULL UPTIME, per Shizu.
 */
"use strict";
var S = require("../model/support.js");
var G = require("../model/gear.js");
var D = require("../../loa-bracelet-calc/model/bracelet.js");
var honing = require("../data/honing-t4upper.json");

var P = S.DEFAULTS, prof = D.DEFAULT_PROFILE;
var gear = G.stats(honing, {}, 25, 25);
var base = S.contribution(P, gear, {});

/** Ancient raw values, low / mid / high, from the Stove disclosure. */
var RAW = {
  16: { shred: [1.8, 2.1, 2.5], rider: [2, 2.5, 3] },     // enemy defence
  17: { crit:  [1.8, 2.1, 2.5], rider: [2, 2.5, 3] },     // enemy crit resist
  18: { dmg:   [0.9, 1.1, 1.3], rider: [2, 2.5, 3] },     // shielded target
  19: { cdmg:  [3.6, 4.2, 4.8], rider: [2, 2.5, 3] },     // enemy crit dmg resist
  29: { atkEnh: [4, 5, 6] },
  30: { allyDmg: [6, 7.5, 9] },
  20: { wp: [1160 * 6, 1320 * 6, 1480 * 6] },                       // 6 stacks
  21: { wp: [7200 + 2000, 8100 + 2200, 9000 + 2400] },              // rider up
  22: { wp: [6900 + 130 * 30, 7800 + 140 * 30, 8700 + 150 * 30] },  // 30 stacks
  33: { wp: [7200, 8100, 9000] }
};

function critMult(dCritRate, dCritDamage) {
  var a = D.allyCritFactor(prof, 0, 0);
  var b = D.allyCritFactor(prof, dCritRate / 100, dCritDamage / 100);
  return b / a;
}

var out = {};
Object.keys(RAW).forEach(function (fam) {
  var r = RAW[fam], vals = [];
  for (var t = 0; t < 3; t++) {
    var lines = {}, mult = 1, g = gear;
    if (r.rider) lines.allyAtkEnh = r.rider[t] / 100;
    if (r.atkEnh) lines.allyAtkEnh = r.atkEnh[t] / 100;
    if (r.allyDmg) lines.allyDmg = r.allyDmg[t] / 100;
    if (r.wp) g = G.stats(honing, { braceletWpFlat: r.wp[t] }, 25, 25);
    if (r.crit) mult *= critMult(r.crit[t], 0);
    if (r.cdmg) mult *= critMult(0, r.cdmg[t]);
    if (r.shred) mult *= D.defShredGain(prof, r.shred[t]);   // takes percent, not a fraction
    if (r.dmg) mult *= 1 + prof.shieldUptime * r.dmg[t] / 100;
    vals.push(100 * Math.log(S.contribution(P, g, lines) * mult / base));
  }
  out[fam] = vals;
});

console.log("support bracelet lines at the reference character (ancient low/mid/high)");
Object.keys(out).sort(function (a, b) { return out[b][2] - out[a][2]; }).forEach(function (f) {
  console.log("  f" + f.padStart(2) + ": " + out[f].map(function (x) { return x.toFixed(3).padStart(6); }).join(" "));
});
console.log("\nSUPPORT_LINE = {");
Object.keys(out).sort(function (a, b) { return a - b; }).forEach(function (f) {
  console.log("    " + f + ": [" + out[f].map(function (x) { return x.toFixed(3); }).join(", ") + "],");
});
console.log("  };");
