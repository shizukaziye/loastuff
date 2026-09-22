/**
 * verify-bracelet-bands.js — every bracelet rung example, on both axes,
 * re-scored EXACTLY through the calculator's braceletScore (full lines plus
 * traits, no table-sum shortcut). A rung whose example lands in a different
 * band than its letter is a defect — either the rung is mis-banded or the
 * card is drawing an incomplete bracelet.
 *
 *   node tools/verify-bracelet-bands.js [support|dps]
 *
 * Run after build-bracelet-rows.js or build-bracelet-rows-dps.js. Exits
 * non-zero on any mismatch so a build chain can gate on it.
 */
"use strict";
var fs = require("fs");
var BC = require("../../loa-bracelet-calc/model/bracelet.js");
var S = require("../../loa-bracelet-calc/subrank.js");

var TIER_TO = { blue: "low", epic: "mid", LEG: "high" };
var AXES = {
  support: { file: "data/rows.json", profile: BC.normalizeProfile({ role: "support" }),
             traits: function (p) { return { spec: p, swift: p }; } },
  dps: { file: "data/rows-dps.json", profile: null,
         traits: function (p) { return { crit: p, spec: p }; } }
};

var only = process.argv[2];
var bad = 0;

Object.keys(AXES).forEach(function (axis) {
  if (only && only !== axis) return;
  var A = AXES[axis];
  var doc;
  try { doc = JSON.parse(fs.readFileSync(A.file, "utf8")); }
  catch (e) { console.log(axis + ": no " + A.file + " — skipped\n"); return; }
  var rows = doc.rows.filter(function (r) { return r.series === "bracelet"; });
  console.log("=== " + axis + " (" + rows.length + " rungs) ===");
  rows.forEach(function (r) {
    if (!r.hit || !r.hit.stats) return;
    var pair = +String(r.hit.stats).split("/")[0];
    var lines = (r.hit.lines || []).map(function (l) {
      return { cat: "special", family: l.id, tier: TIER_TO[l.tier] || "low" };
    });
    var sc = S.braceletScore({ grade: "ancient", lines: lines,
      traits: A.traits(pair), profile: A.profile });
    var ok = sc.band.key === r.to;
    if (!ok) bad++;
    console.log((r.from + " -> " + r.to).padEnd(12) +
      ("example " + r.hit.stats).padEnd(18) +
      "exact score " + sc.score.toFixed(1).padStart(6) +
      "  band " + sc.band.key.padEnd(3) +
      (ok ? "  OK" : "  MISMATCH") +
      "  dmg " + sc.damagePct.toFixed(2) + "%");
  });
  console.log("");
});

console.log(bad ? bad + " rung(s) mismatch" : "all rungs verified against braceletScore");
process.exit(bad ? 1 : 0);
