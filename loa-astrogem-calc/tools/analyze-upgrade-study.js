/**
 * analyze-upgrade-study.js — turn upgrade-cost-study result JSONs into the
 * study report tables (markdown to stdout).
 *
 *   node tools/analyze-upgrade-study.js <dir-with-study-*.json>
 *
 * Sections:
 *   1. Per-character tables: per (type × cost) — p(upgrade)/gem, gems, gold
 *      (with process/reroll/reset split), headline raw whole-grid damage gain,
 *      value-scale gain, share of upgrades that LOWER raw damage, winner
 *      willpower profile.
 *   2. Cross-profile efficiency: gold per 1% raw grid damage, by cost.
 *   3. Willpower evidence: value-vs-raw divergence and winner wp composition.
 */
"use strict";
var fs = require("fs");
var path = require("path");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/analyze-upgrade-study.js <dir>"); process.exit(1); }

var files = fs.readdirSync(dir).filter(function (f) { return /^study-.*\.json$/.test(f); });
if (!files.length) { console.error("no study-*.json in " + dir); process.exit(1); }

var cells = [];
files.forEach(function (f) {
  var d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  d.results.forEach(function (r) { cells.push(r); });
});

function byKey(c) { return c.character + ":" + c.gemType; }
var profiles = {};
cells.forEach(function (c) {
  var k = byKey(c);
  if (!profiles[k]) profiles[k] = {};
  profiles[k][c.baseCost] = c;
});

function fmtGold(x) {
  if (x == null || !isFinite(x)) return "—";
  if (Math.abs(x) >= 1000000) return (x / 1000000).toFixed(2) + "M";
  if (Math.abs(x) >= 1000) return (x / 1000).toFixed(1) + "k";
  return String(Math.round(x));
}
function fmtN(x, d) { return (x == null || !isFinite(x)) ? "—" : x.toFixed(d == null ? 2 : d); }
function pctS(x) { return (x == null || !isFinite(x)) ? "—" : (100 * x).toFixed(1) + "%"; }

function wpSummary(w) {
  if (!w) return "—";
  var hist = w.wpLevelHist || {}, tot = 0, hi = 0, sum = 0;
  Object.keys(hist).forEach(function (k) { tot += hist[k]; sum += hist[k] * Number(k); if (Number(k) >= 4) hi += hist[k]; });
  if (!tot) return "—";
  return fmtN(sum / tot, 2) + " (wp4+: " + pctS(hi / tot) + ")";
}

// ---------- 1. per-character tables ----------
var chars = {};
cells.forEach(function (c) { chars[c.character] = true; });

console.log("# Upgrade-cost study — results\n");
Object.keys(chars).sort().forEach(function (ch) {
  var meta = cells.find(function (c) { return c.character === ch; });
  console.log("## " + ch + "  (axis " + meta.axis + ", gpd " + fmtGold(meta.gpd) + ")\n");
  console.log("| Profile | Cost | Baseline | Slots | p(feasible)/gem | p(wp-free) | Gems mean (p50/p90) | Gold mean | …process/reroll/reset | Δ raw grid dmg | Δ value (same swap) | value-vetoed | Winner wp mean | Replaced grade | Resets/trial | Mode |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  ["order", "chaos"].forEach(function (type) {
    [8, 9, 10].forEach(function (cost) {
      var c = (profiles[ch + ":" + type] || {})[cost];
      if (!c) return;
      if (c.mode === "no-slots") {
        console.log("| " + ch + " " + type + " | c" + cost + " | " + c.baselineGrade +
          " | 0 | — | — | — | — | — | — | — | — | — | — | — | **no same-cost slots** |");
        return;
      }
      var w = c.winners;
      console.log("| " + ch + " " + type + " | c" + cost +
        " | " + c.baselineGrade +
        " | " + c.candidateCount +
        " | " + pctS(c.pUpgradePerGem) +
        " | " + (c.pUpgradeWpFree != null ? pctS(c.pUpgradeWpFree) : "—") +
        " | " + fmtN(c.gems.mean, 1) + " (" + c.gems.p50 + "/" + c.gems.p90 + ")" +
        " | " + fmtGold(c.gold.mean) +
        " | " + fmtGold(c.goldSplit.process) + "/" + fmtGold(c.goldSplit.reroll) + "/" + fmtGold(c.goldSplit.reset) +
        " | " + (w ? fmtN(w.meanDRawGrid, 4) + "%" : "—") +
        " | " + (w ? fmtN(w.meanDValue, 4) : "—") +
        " | " + (w ? pctS(w.shareValueNegative) : "—") +
        " | " + wpSummary(w) +
        " | " + (w ? fmtN(w.meanReplacedGrade, 1) : "—") +
        " | " + fmtN(c.resetsPerTrial, 2) +
        " | " + c.mode + (c.cappedTrials ? " (" + c.cappedTrials + " capped!)" : "") + " |");
    });
  });
  console.log("");
});

// ---------- 2. gold per 1% raw grid damage ----------
console.log("## Gold per 1% raw (whole-grid) damage gained\n");
console.log("| Profile | c8 | c9 | c10 | cheapest |");
console.log("|---|---|---|---|---|");
Object.keys(profiles).sort().forEach(function (k) {
  var row = ["| " + k];
  var best = null, bestCost = null;
  [8, 9, 10].forEach(function (cost) {
    var c = profiles[k][cost];
    if (!c || c.mode === "no-slots") { row.push("no slots"); return; }
    if (!c.winners || !(c.winners.meanDRawGrid > 0)) { row.push("—"); return; }
    var gp = c.gold.mean / c.winners.meanDRawGrid;
    row.push(fmtGold(gp));
    if (best == null || gp < best) { best = gp; bestCost = cost; }
  });
  row.push(bestCost ? ("c" + bestCost) : "—");
  console.log(row.join(" | ") + " |");
});
console.log("");

// ---------- 2b. gems per 1% raw grid damage ----------
console.log("## Epic gems cut per 1% raw (whole-grid) damage gained\n");
console.log("(Marginal rate at the CURRENT grid: E[gems per upgrade] / E[raw Δ per upgrade].");
console.log("Support profiles are per-ally party-damage units.)\n");
console.log("| Profile | c8 | c9 | c10 | best |");
console.log("|---|---|---|---|---|");
Object.keys(profiles).sort().forEach(function (k) {
  var row = ["| " + k];
  var best = null, bestCost = null;
  [8, 9, 10].forEach(function (cost) {
    var c = profiles[k][cost];
    if (!c || c.mode === "no-slots") { row.push("no slots"); return; }
    if (!c.winners || !(c.winners.meanDRawGrid > 0)) { row.push("—"); return; }
    var gp = c.gems.mean / c.winners.meanDRawGrid;
    row.push(gp >= 1000 ? (gp / 1000).toFixed(1) + "k" : gp.toFixed(1));
    if (best == null || gp < best) { best = gp; bestCost = cost; }
  });
  row.push(bestCost ? ("c" + bestCost) : "—");
  console.log(row.join(" | ") + " |");
});
console.log("");

// ---------- 3. willpower evidence ----------
console.log("## Willpower evidence — value-scale vs raw, winner + replaced composition\n");
console.log("| Profile | Cost | Δvalue | Δ raw grid | value-vetoed | winner M | replaced M | winner wpCost hist | replaced cost hist |");
console.log("|---|---|---|---|---|---|---|---|---|");
Object.keys(profiles).sort().forEach(function (k) {
  [8, 9, 10].forEach(function (cost) {
    var c = profiles[k][cost];
    if (!c || c.mode === "no-slots" || !c.winners) return;
    var w = c.winners;
    function h(obj) {
      return Object.keys(obj || {}).sort(function (a, b) { return a - b; })
        .map(function (kk) { return kk + ":" + obj[kk]; }).join(" ");
    }
    console.log("| " + k + " | c" + cost +
      " | " + fmtN(w.meanDValue, 4) +
      " | " + fmtN(w.meanDRawGrid, 4) +
      " | " + pctS(w.shareValueNegative) +
      " | " + fmtN(w.meanWinnerM, 3) +
      " | " + fmtN(w.meanReplacedM, 3) +
      " | " + h(w.wpCostHist) +
      " | " + h(w.replacedCostHist) + " |");
  });
});
