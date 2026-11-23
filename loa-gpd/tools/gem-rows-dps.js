/**
 * gem-rows-dps.js — the DPS chart's three skill-gem rows, from their parts.
 *
 *   node tools/gem-rows-dps.js          rewrite the gem rows in data/rows-dps.json
 *   node tools/gem-rows-dps.js --check  exit 1 if the file differs from what this computes
 *
 * A level of a T4 gem set moves three things for a dealer:
 *
 *   skill damage   the damage gems, 32 / 36 / 40 / 44% at level 7..10, on
 *                  every skill (bebkok's sheet, DataHidden C3:G13; Shizu's
 *                  model, commit 11b0fca: the whole of the damage is taken as
 *                  gemmed)
 *   cooldown       the cooldown gems, 18 / 20 / 22 / 24%; casts go as
 *                  1 / (1 − cooldown), and 70% of a dealer's damage sits on
 *                  cooldown (commit 11b0fca)
 *   attack power   every gem's basic attack power side effect, 0.60 / 0.80 /
 *                  1.00 / 1.20% a gem at level 7..10 (the bracelet worker reads
 *                  it off each gem, {type:2, id:150}, and the page's own
 *                  attack-power total agrees on 103 of 117 corpus loadouts —
 *                  eleven level 10s and a 9-7 stone are 14.7%). Priced through
 *                  the bracelet model's attackPower on its default profile,
 *                  whose 12.5% base already counts eleven level-9 gems.
 *
 * The first two were the row until 2026-09-25; the third was left out, and it
 * is about 1.9% a level. The three multiply. `damage` stays a percent, as the
 * rows' other damage figures are read.
 */
"use strict";
var fs = require("fs"), path = require("path");
var G = path.dirname(__dirname) + path.sep, R = path.dirname(path.dirname(__dirname)) + path.sep;
var B = require(R + "loa-bracelet-calc/model/bracelet.js");
var FILE = G + "data/rows-dps.json";

var SKILL_DMG = { 7: 0.32, 8: 0.36, 9: 0.40, 10: 0.44 };
var COOLDOWN = { 7: 0.18, 8: 0.20, 9: 0.22, 10: 0.24 };
var ON_COOLDOWN = 0.70;
var AP_PER_GEM = { 7: 0.006, 8: 0.008, 9: 0.010, 10: 0.012 };
var GEMS = 11;

var P = B.normalizeProfile({});
function attack(level) {
  var p = Object.assign({}, P, { baseApPct: P.baseApPct - GEMS * AP_PER_GEM[9] + GEMS * AP_PER_GEM[level] });
  return B.attackPower(p, 0, 0);
}
function pct(x) { return (x * 100).toFixed(2) + "%"; }

function row(prev, lv) {
  var dmg = (1 + SKILL_DMG[lv]) / (1 + SKILL_DMG[lv - 1]);
  var casts = (1 - COOLDOWN[lv - 1]) / (1 - COOLDOWN[lv]);
  var cd = 1 + ON_COOLDOWN * (casts - 1);
  var ap = attack(lv) / attack(lv - 1);
  var total = dmg * cd * ap;
  var r = Object.assign({}, prev);
  r.damage = Math.round((total - 1) * 100 * 1e5) / 1e5;
  r.mats = [
    prev.mats[0],
    ["skill damage", Math.round(SKILL_DMG[lv - 1] * 100) + "% → " + Math.round(SKILL_DMG[lv] * 100) + "%", 0],
    ["cooldown reduction", Math.round(COOLDOWN[lv - 1] * 100) + "% → " + Math.round(COOLDOWN[lv] * 100) + "%", 0],
    ["basic attack power", (GEMS * AP_PER_GEM[lv - 1] * 100).toFixed(1) + "% → " + (GEMS * AP_PER_GEM[lv] * 100).toFixed(1) + "%", 0]
  ];
  r.odds = "no chance involved. " + pct(dmg - 1) + " from the damage bucket, " + pct(cd - 1) + " from casting " +
    pct(casts - 1) + " more often with " + Math.round(ON_COOLDOWN * 100) + "% of damage on cooldown, and " +
    pct(ap - 1) + " from the gems' basic attack power";
  r.minimum = "every gem at level " + lv + " — " + Math.round(SKILL_DMG[lv] * 100) + "% skill damage, " +
    Math.round(COOLDOWN[lv] * 100) + "% cooldown and " + (AP_PER_GEM[lv] * 100).toFixed(1) + "% basic attack power a gem";
  return r;
}

var data = JSON.parse(fs.readFileSync(FILE, "utf8"));
var out = JSON.parse(JSON.stringify(data));
out.rows = out.rows.map(function (r) {
  if (r.series !== "gems") return r;
  var lv = parseInt(String(r.to).replace(/[^0-9]/g, ""), 10);
  return row(r, lv);
});
var text = JSON.stringify(out, null, 1) + "\n";
if (process.argv.indexOf("--check") >= 0) {
  var same = JSON.stringify(out) === JSON.stringify(data);
  console.log(same ? "gem rows match their parts" : "gem rows differ from their parts — run node tools/gem-rows-dps.js");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(FILE, text);
out.rows.filter(function (r) { return r.series === "gems"; }).forEach(function (r) {
  console.log(r.label, r.damage + "%", "—", r.odds.replace(/^no chance involved\. /, ""));
});
