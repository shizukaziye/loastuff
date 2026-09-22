/**
 * verify.js — checks the model against outside sources it must agree with.
 *
 *   node tools/verify.js
 *
 * Nothing here is self-referential: every expected number comes from bebkok's
 * support buff calculator, the researched karma mechanic, or the game tables
 * themselves. If one of these fails, the model has drifted.
 */
"use strict";

var path = require("path");
var root = path.dirname(__dirname);
var Gear = require(path.join(root, "model/gear.js"));
var Support = require(path.join(root, "model/support.js"));
var Honing = require(path.join(root, "model/honing.js"));
var Karma = require(path.join(root, "model/karma.js"));
var honingData = require(path.join(root, "data/honing-t4upper.json"));
var karmaData = require(path.join(root, "data/karma.json"));

var fails = 0;

function check(label, got, want, tol) {
  var ok = tol ? Math.abs(got - want) <= Math.abs(want) * tol : got === want;
  if (!ok) fails++;
  console.log(
    (ok ? "  ok  " : "  FAIL") + " " + label.padEnd(42) +
    String(typeof got === "number" ? +got.toFixed(4) : got).padStart(16) +
    "   want " + (typeof want === "number" ? +want.toFixed(4) : want)
  );
}

// ---- bebkok's support buff calculator, tab "Sup buff calc v3.81" -----------
// His saved character: every piece at ilvl 1755 (honing +16), karma level 30.
console.log("bebkok support buff calc v3.81 — saved character");
var armour = 0;
honingData.armor.slots.forEach(function (s) {
  armour += honingData.armor.mainStat[s][16].base;
});
check("armour main stat, +16 (CJ13)", armour, 549859);
check("weapon power, +16 (CK10)", honingData.weapon.weaponPower[16].base, 193270);

// This checks the ASSEMBLY, not our defaults, so every input is his: a Relic
// weapon core (3,900 flat / 2.94%), 2,400 of accessory weapon-power flat, 66,000
// accessory main stat, karma at 3%, level-10 gems and no Adrenaline. Our
// reference character differs on all of those on purpose.
var g = Gear.stats(honingData, {
  karmaWpPct: 0.03, arkGridWpFlat: 3900, arkGridWpPct: 0.0294,
  accessoryWpFlat: 2400, accessoryMainStat: 66000,
  gemApPct: 0.132, adrenalineApPct: 0
}, 16, 16);
check("total weapon power (DN22)", g.wp, 226085.218, 1e-9);
check("total main stat (DN26)", g.ms, 687158.89, 1e-9);
// his DP29 floors weapon power and main stat before the square root; we don't,
// so allow the rounding gap
check("support basic attack power (DP29)",
      Support.baseAtk(g.wp, g.ms) * (1 + g.apPct), 184566.1151, 2e-6);

// ---- karma, from docs/research/karma.md -----------------------------------
console.log("karma — Enlightenment, 900g a try");
var karmaGold = 0;
Karma.ladder(karmaData, Karma.ENLIGHTENMENT, {}, 21, 30).forEach(function (s) {
  karmaGold += s.gold;
});
check("attempts, 21 to 22 (20%, 10% energy)",
      Karma.expectedAttempts(2000, 1000), 4.571, 1e-3);
check("attempts, 29 to 30 (0.25%, 0.08%)",
      Karma.expectedAttempts(25, 8), 382.538, 1e-4);
check("gold, level 21 to 30", karmaGold, 682171, 1e-4);

// ---- honing, from the game tables -----------------------------------------
console.log("honing — T4 Upper (1675)");
var prices = { "6861013": 125, "66102007": 9, "66102107": 0.3,
               "66110226": 25, "66111131": 300, "66111132": 150 };
var enabled = { shards: false };
var w25 = Honing.step(honingData, "weapon", 25, prices, enabled);
check("weapon +25 base rate", w25.baseRate, 0.5);
check("weapon +25 juice at the optimum", w25.juice, 50);
check("weapon +25 expected taps", w25.taps, 45.7, 1e-2);
var a12 = Honing.step(honingData, "armor", 12, prices, enabled);
check("armour +12 buys no breath", a12.juice, 0);

// ---- bracelet model invariants ---------------------------------------------
// The audit found the floor stranding three bands under a score nothing could
// reach, and a hand-edited line table drifting from its generator. These pin
// the invariants that broke.
var Bracelet = require(path.join(root, "model/bracelet.js"));
console.log("bracelet — ladder and floor");
var worst = Bracelet.score(2 * 61 * Bracelet.TRAIT_PER_POINT);   // 61/61, no scoring line
check("worst possible bracelet scores 0 (F, not F-)", worst, 0);
check("a 61/61 with nothing ranks F", Bracelet.rank(worst) === "F" ? 1 : 0, 1);
check("families 17 and 19 identical at low", Bracelet.SUPPORT_LINE[17][0], Bracelet.SUPPORT_LINE[19][0]);
check("families 17 and 19 identical at mid", Bracelet.SUPPORT_LINE[17][1], Bracelet.SUPPORT_LINE[19][1]);
check("beating the anchor is S+", Bracelet.rank(100) === "S+" ? 1 : 0, 1);

console.log(fails ? "\n" + fails + " FAILED" : "\nall checks pass");
process.exit(fails ? 1 : 0);
