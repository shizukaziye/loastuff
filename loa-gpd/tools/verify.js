/**
 * verify.js — checks the model against outside sources it must agree with.
 *
 *   node tools/verify.js
 *
 * Nothing here is self-referential: every expected number comes from bebkok's
 * support buff calculator, the researched karma mechanic, the game tables
 * themselves, or — for the vambrace — published numbers from outside the feed
 * the table was baked from. If one of these fails, the model has drifted.
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

// ---- lookup.js loads the same model files the chart does -------------------
// On a page that is not the chart (a profile), lookup.js fetches the four model
// files itself, with pins of its own. They must be the chart's pins, or after a
// model edit that page runs the old file for as long as the zone caches it.
console.log("lookup.js — model pins match index.html's script tags");
var Lookup = require(path.join(root, "lookup.js"));
var page = require("fs").readFileSync(path.join(root, "index.html"), "utf8");
Lookup.MODELS.forEach(function (m) {
  var file = m[0].replace(/\?.*$/, ""), pin = (m[0].match(/\?v=(.*)$/) || [])[1];
  var tag = page.match(new RegExp("src='" + file.replace(/[.\/]/g, "\\$&") + "\\?v=([^']*)'"));
  check(file + " pin", tag ? tag[1] : "no tag", pin);
});

// ---- a Sidereal weapon, and the normal weapons that only look like one -----
// Real pulls, as the bracelet worker sends them. Azuron is one of the 63
// calibration-panel characters whose normal 1675 weapon kept its advanced
// honing from the 1590 set; Legendarymember is the Sidereal the rule was
// written for (lostark.bible, 2026-11-17: weapon +10, armour +25, item level
// 1805 — a normal +10 beside that armour would be 1787.5).
console.log("lookup.js — Sidereal weapon");
function wearer(weapon, armour, adv, ilvl, idRead) {
  return { honeWeapon: weapon, weaponAdv: adv, ilvlExact: ilvl, weaponIdRead: idRead,
           armorPieces: { head: armour[0], torso: armour[1], legs: armour[2], hands: armour[3], shoulders: armour[4] },
           advPieces: { weapon: adv, head: adv, torso: adv, legs: adv, hands: adv, shoulders: adv } };
}
var azuron = [16, 16, 16, 17, 16], legend = [25, 25, 25, 25, 25];
check("a 1675 weapon that kept advanced 40 is normal", Lookup.sidereal(wearer(17, azuron, 40, 1756.6661, null)), false);
check("Legendarymember's +10 fits neither set", Lookup.sidereal(wearer(10, legend, 40, 1805.0001, null)), true);
check("the worker's item id wins: Sidereal", Lookup.sidereal(wearer(17, azuron, 40, 1756.6661, true)), true);
check("the worker's item id wins: normal", Lookup.sidereal(wearer(10, legend, 40, 1805.0001, false)), false);
check("no item level to test: taken as normal", Lookup.sidereal(wearer(10, legend, 40, null, null)), false);
check("a +20 or better is never the shape", Lookup.sidereal(wearer(23, [21, 21, 21, 21, 21], 40, 1781.6661, null)), false);

// ---- the vambrace (October 2026) -------------------------------------------
// The table is Maxroll's planner feed (data/vambrace.json). Every number below
// comes from somewhere else: loagg's table of expected taps, a Korean player's
// published +0 to +10 totals, the limit break costs both regions' write-ups
// give, and one character read off lostark.bible. docs/research/vambrace.md.
console.log("vambrace — the game table against outside sources");
var Vambrace = require(path.join(root, "model/vambrace.js"));
var vData = require(path.join(root, "data/vambrace.json"));
check("the Epic +0 piece, main stat", vData.base.mainStat, 10500);
check("the Epic +0 piece, weapon power", vData.base.weaponPower, 3500);
// expected taps with no breath, one rate per five levels (loagg, to a decimal)
[[1, 4.9], [6, 6.6], [11, 11.4], [16, 17.5], [21, 32.4]].forEach(function (w) {
  var t = Honing.expectedAt(vData.recipe[w[0]], {}, {}, 0).taps;
  check("taps with no breath, +" + (w[0] - 1) + " to +" + w[0], Math.round(t * 10) / 10, w[1]);
});
// a full load of both breaths doubles the base rate, at every level
var doubles = 0;
for (var vl = 1; vl <= vData.maxLevel; vl++) {
  var vr = vData.recipe[vl], load = 0;
  Honing.juicesOf(vr).forEach(function (j) { load += j.max; });
  if (Honing.breaths(vr, {}, {}, load).boost === vr.success) doubles++;
}
check("a full load of both breaths doubles base", doubles, 25);
// +0 to +10 with no breath, as a Korean player published it
var sum10 = { guardian: 0, destruction: 0, leapstone: 0, fusion: 0, gold: 0, silver: 0, shards: 0, grow: 0 };
for (vl = 1; vl <= 10; vl++) {
  var r10 = vData.recipe[vl], t10 = Honing.expectedAt(r10, {}, {}, 0).taps;
  sum10.guardian += r10.mats["66102107"] * t10;
  sum10.destruction += r10.mats["66102007"] * t10;
  sum10.leapstone += r10.mats["66110226"] * t10;
  sum10.fusion += r10.mats["6861013"] * t10;
  sum10.gold += r10.gold * t10;
  sum10.silver += r10.silver * t10;
  sum10.shards += r10.shards * t10;
  sum10.grow += r10.growShards;
}
check("+0 to +10: guardian stones", sum10.guardian, 122232, 1.5e-3);
check("+0 to +10: destruction stones", sum10.destruction, 40319, 1.5e-3);
check("+0 to +10: leapstones", sum10.leapstone, 2106, 1.5e-3);
check("+0 to +10: fusion material", sum10.fusion, 1546, 1.5e-3);
check("+0 to +10: honing fee", sum10.gold, 362990, 1.5e-3);
check("+0 to +10: silver", sum10.silver, 4812480, 1.5e-3);
check("+0 to +10: growth shards", sum10.grow, 1578000);
check("+0 to +10: shards in all", sum10.shards + sum10.grow, 2596650, 1.5e-3);
// the limit breaks: Spectral Shade or Deathly Hand, no gold
var lb = vData.limitBreak;
check("limit break at +10", lb["10"].cost.amount + " or " + lb["10"].or.amount, "200 or 100");
check("limit break at +15", lb["15"].cost.amount + " or " + lb["15"].or.amount, "240 or 120");
check("limit break at +20, Deathly Hand only", lb["20"].cost.amount + (lb["20"].or ? " or" : ""), "150");
check("each limit break is 1% basic attack power", [10, 15, 20].map(function (n) {
  return Vambrace.limitBreakAt(vData, n).apPct; }).join(), "0.01,0.01,0.01");
// Legendarymember (lostark.bible, 2026-11-17), read with the vambrace at +14/+15
// and at +20: 14,114 more main stat, which is the table's step through that
// character's 9% main-stat pool. So the vambrace's main stat is raw, and takes
// the percentages with it.
var ms20 = Vambrace.statsAt(vData, 20).ms - Vambrace.statsAt(vData, 15).ms;
check("main stat, +15 to +20", ms20, 12948);
check("  through a 9% main-stat pool", ms20 * 1.09, 14114, 1e-4);
check("  and +14 carries the same as +15", Vambrace.statsAt(vData, 14).ms, Vambrace.statsAt(vData, 15).ms);

console.log("vambrace — the model");
// gear.js: the raw stats take the pools, the flat goes in beside the root
var bare = Gear.stats(honingData, {}, 21, 25);
var worn = Gear.stats(honingData, { vambrace: Vambrace.statsAt(vData, 25) }, 21, 25);
var D = Gear.DEFAULTS;
check("a +25 adds its weapon power, with the pool",
      worn.wp - bare.wp, (3500 + 19440) * (1 + D.earringWpPct + D.arkGridWpPct + D.karmaWpPct), 1e-9);
check("a +25 adds its main stat, with the pool",
      worn.ms - bare.ms, (10500 + 63210) * (1 + D.skinMsPct + D.strongholdMsPct), 1e-9);
check("a +25's flat basic attack power", worn.apFlat, 9050);
check("an Ancient's three limit breaks", worn.apPct - bare.apPct, 0.03, 1e-9);
check("wearing none changes nothing", JSON.stringify(Gear.stats(honingData, { vambrace: Vambrace.NONE }, 21, 25)) ===
      JSON.stringify(Object.assign({}, bare, { apFlat: 0 })) ? 1 : 0, 1);
// a +10 with its limit break still to do is the level's stats on the old grade
var held = Vambrace.statsAt(vData, 10, "epic"), done = Vambrace.statsAt(vData, 10);
check("a +10 before its limit break: same stats", held.ms + "/" + held.wp + "/" + held.apFlat,
      done.ms + "/" + done.wp + "/" + done.apFlat);
check("a +10 before its limit break: no 1% yet", held.apPct + " then " + done.apPct, "0 then 0.01");
// the DPS axis's damage is baked; it must be what its builder computes today
var baked = require(path.join(root, "data/rows-dps.json")).vambraceDamage;
var built = require(path.join(__dirname, "build-vambrace-dps.js")).compute();
check("rows-dps.json vambraceDamage is its builder's",
      JSON.stringify(baked) === JSON.stringify(built.damage) ? 1 : 0, 1);
var vTotal = baked.base;
Object.keys(baked.steps).forEach(function (k) { vTotal += baked.steps[k]; });
check("none to +25 is the steps and the piece",
      vTotal, 100 * Math.log(built.attackMax / built.attackNone), 1e-5);

// The chart's rows. A stretch nobody stops inside is priced as one, so gold per
// 1% never falls along the ladder and the step that reaches a limit break is
// never drawn as a bargain on its own.
console.log("vambrace — the chart's rows");
Lookup.use({ Support: Support, Gear: Gear, Honing: Honing, Karma: Karma, Vambrace: Vambrace,
             LoseiiScore: require(path.join(root, "model/loseii-score.js")),
             Astrogem: require(path.join(root, "../loa-astrogem-calc/model/astrogem.js")),
             Bracelet: require(path.join(root, "../loa-bracelet-calc/model/bracelet.js")),
             Subrank: require(path.join(root, "../loa-bracelet-calc/subrank.js")) });
var fs = require("fs"), files = {};
Lookup.DATA_FILES.forEach(function (f) {
  var file = path.join(root, "data", f);
  files[f] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
});
var DATA = Lookup.data();
Lookup.absorb(DATA, files);
var d0 = Lookup.defaults(DATA.honing);
["support", "dps"].forEach(function (axis) {
  var ctx = {};
  for (var k in DATA) ctx[k] = DATA[k];
  ctx.axis = axis; ctx.prices = d0.prices; ctx.enabled = d0.enabled;
  ctx.gem8Price = d0.gem8Price; ctx.accFilter = d0.accFilter;
  var v = Lookup.steps(ctx).filter(function (r) { return r.series === "vambrace"; });
  check(axis + ": one row a level", v.length, 25);
  var rising = true, whole = true, gold = 0, own = 0, pooled = 0;
  v.forEach(function (r, i) {
    if (i && r.gpd < v[i - 1].gpd * (1 - 1e-12)) rising = false;
    gold += r.gold; own += r.damage;
    if (r.poolG == null) pooled += r.gold;
    else if (r.to === r.poolTo) pooled += r.poolG;      // each stretch once, at its last step
    if (!(r.gold > 0 && r.damage > 0)) whole = false;
  });
  check(axis + ": every step costs gold and buys damage", whole ? 1 : 0, 1);
  check(axis + ": gold per 1% never falls", rising ? 1 : 0, 1);
  check(axis + ": the stretches hold every step's gold", pooled, gold, 1e-9);
  [10, 15, 20].forEach(function (n) {
    var r = v[n - 1];
    check(axis + ": +" + n + " is priced with the steps before it",
          r.poolTo === "+" + n && parseInt(r.poolFrom.slice(1), 10) < n - 1 ? 1 : 0, 1);
    check(axis + ": +" + n + " carries its limit break", r.breakDamage > 0 && r.breakDamage < r.damage ? 1 : 0, 1);
  });
  var x = Lookup.vambraceExtras(ctx, axis);
  check(axis + ": the +0 piece is worth something, and costs no row", x.base > 0 ? 1 : 0, 1);
});
// what a pull carries: lostark.bible's "bracer" slot, +N and the item id
var seen = Lookup.vambraceOf(20, 134501406, true);
check("Legendarymember's vambrace reads +20 Relic", seen.level + " " + seen.grade, "20 relic");
check("  so its limit break to Ancient is still to do", vData.limitBreak["20"].to !== seen.grade ? 1 : 0, 1);
check("a character with none reads as none", Lookup.vambraceOf(null, null, true), null);
check("a pull from before the workers looked is unread", Lookup.vambraceOf(undefined, undefined, false), undefined);

// One character, placed four ways: a stored pull (Paroxysmal, a 1796 dealer)
// with the vambrace field as the Workers send it.
console.log("vambrace — a looked-up character");
var member = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/loseii-panel.json"), "utf8"))
  .members.filter(function (m) { return m.name === "Paroxysmal"; })[0];
function placed(vambrace) {
  var rec = JSON.parse(JSON.stringify(member.record));
  if (vambrace !== undefined) rec.profile.vambrace = vambrace;
  var pos = Lookup.place({ record: rec, axis: "dps", now: rec.pulledAt });
  var e = pos.list.filter(function (x) { return x.key === "vambrace"; })[0];
  return { pos: pos, e: e };
}
var rowsDps = (function () {
  var ctx = {};
  for (var k in DATA) ctx[k] = DATA[k];
  ctx.axis = "dps"; ctx.prices = d0.prices; ctx.enabled = d0.enabled;
  ctx.gem8Price = d0.gem8Price; ctx.accFilter = d0.accFilter;
  return Lookup.steps(ctx).filter(function (r) { return r.series === "vambrace"; });
})();
function span(a, b, f) { var t = 0; for (var i = a; i < b; i++) t += rowsDps[i][f]; return t; }

var mid = placed({ honing: 12, id: 134401406 });
check("a Legendary +12 reads as one", mid.e.seen, "+12 Legendary");
check("  its last step is the one step it took", mid.e.last.gold, rowsDps[11].gold, 1e-12);
check("  priced at what that step alone bought", mid.e.last.gpd, rowsDps[11].gold / rowsDps[11].damage, 1e-12);
check("  its next step runs to +15", mid.e.next.from + " to " + mid.e.next.to, "+12 to +15");
check("  for the three steps' gold", mid.e.next.gold, span(12, 15, "gold"), 1e-12);
check("  and the three steps' damage, break included", mid.e.next.damage, span(12, 15, "damage"), 1e-12);
check("  which is cheaper per 1% than +12 to +13 alone",
      mid.e.next.gpd < rowsDps[12].gold / rowsDps[12].damage ? 1 : 0, 1);

// +10 and still Epic: the limit break is not done. It takes raid drops and no
// gold, so there is nothing to buy on this ladder until it is.
var held = placed({ honing: 10, id: 134301406 });
check("a +10 that is still Epic reads as one", held.e.seen, "+10 Epic");
check("  nothing past +10 is offered", held.e.next, null);
check("  and the row says what it waits on",
      /limit break to Legendary comes first: 200 Spectral Shade or 100 Deathly Hand/.test(held.e.nextWhy || "") ? 1 : 0, 1);
check("  the vambrace is not the next buy", held.pos.next.vambrace === undefined && held.pos.bestKey !== "vambrace" ? 1 : 0, 1);
check("  its last step has not bought the break's 1% yet",
      held.e.last.damage, rowsDps[9].damage - rowsDps[9].breakDamage, 1e-12);
var done = placed({ honing: 10, id: 134401406 });
check("the same +10 once Legendary is offered +15", done.e.next && done.e.next.to, "+15");
check("  and its last step carries the break", done.e.last.damage, rowsDps[9].damage, 1e-12);

var top = placed({ honing: 25, id: 134601406 });
check("an Ancient +25 has nothing left", top.e.next === null && !top.e.nextWhy ? 1 : 0, 1);
var none = placed(null);
check("no vambrace worn: says so, and is not placed",
      /^no vambrace on this character/.test(none.e.why || "") && none.e.next === undefined ? 1 : 0, 1);
var unread = placed(undefined);
check("a pull that never looked: says that instead",
      /^no vambrace in the pull/.test(unread.e.why || "") ? 1 : 0, 1);

console.log(fails ? "\n" + fails + " FAILED" : "\nall checks pass");
process.exit(fails ? 1 : 0);
