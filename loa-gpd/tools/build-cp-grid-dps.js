// Interim grid feed for the DPS CP card. Until the dd-dps sweep publishes
// arkgrid-rows-dps-*.json, the card needs SOME budget-varying cores/nodes —
// riding the anchor's near-max grid inflated the floor. The spot-anchor runs
// (tools/.cache/anchors-dps) carry real damage-validated accounts per tier,
// which is plenty for CP (the whole grid swings ~1,100 bp). The dd-dps
// publish supersedes this file; the page prefers the real rows when present.
"use strict";
var fs = require("fs");
var path = require("path");

var DIR = path.join(__dirname, ".cache", "anchors-dps");
var tiers = [];
fs.readdirSync(DIR).filter(function (f) {
  return /^epic-s\d+\.json$/.test(f);
}).forEach(function (f) {
  var shard = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  (shard.rows || []).forEach(function (r) {
    if (!r.perCore || !r.nodes) return;
    tiers.push({ gpd: r.gpd, perCore: r.perCore, nodes: r.nodes });
  });
});
tiers.sort(function (a, b) { return a.gpd - b.gpd; });
// one tier per gpd (shards should not overlap; keep the first if they do)
tiers = tiers.filter(function (t, i) { return !i || t.gpd !== tiers[i - 1].gpd; });

var out = {
  note: "interim CP-card grid feed from the DPS spot anchors; " +
    "superseded by arkgrid-rows-dps-*.json when the dd-dps sweep publishes",
  tiers: tiers
};
fs.writeFileSync(path.join(__dirname, "..", "data", "cp-grid-dps.json"),
  JSON.stringify(out));
console.log("cp-grid-dps.json:", tiers.length, "tiers,",
  tiers[0].gpd, "->", tiers[tiers.length - 1].gpd);
