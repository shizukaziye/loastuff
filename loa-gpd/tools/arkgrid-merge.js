/**
 * arkgrid-merge.js — pool sharded account runs into one canonical file.
 *
 *   node tools/arkgrid-merge.js --rarity=rare --in=<file,file,...> --out=data/arkgrid-account-rare.json
 *   node tools/arkgrid-merge.js --rarity=rare --dir=tools/.cache/dd --out=...
 *
 * Each shard of arkgrid-account.js covers a few gpd tiers and computes rungs
 * from its own crossings only. Rung selection needs every tier at once: a
 * band's rung is the cheapest qualifying crossing over ALL budgets, so it can
 * only be chosen after the shards are pooled. This reads the shards' rows and
 * crossRaw, re-runs the carry-forward pass and the clearing-cut selection over
 * the merged set — the same rules, the same coverage gate — and writes the
 * exact shape build-arkgrid-account-rows.js reads.
 *
 * Shards may still be partial: tiers present are merged, tiers absent are
 * simply not there yet. Rung golds only fall as tiers land (a new tier can
 * offer a cheaper crossing, never invalidate one), so a partial merge is a
 * valid ladder — just a shorter one.
 */
"use strict";
var fs = require("fs"), path = require("path");
var REPO = "C:/Users/Shizu/loastuff/loa-astrogem-calc";
var A = require(REPO + "/model/astrogem.js");

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)=(.*)$/);
  if (m) ARGS[m[1]] = m[2];
});
var RARITY = ARGS.rarity || "rare";
var AXIS = ARGS.axis || "support";
var LADDER = AXIS === "dps" ? A.RANK_LADDER : A.SUPPORT_RANK_LADDER;
var OUT = ARGS.out;
if (!OUT) { console.error("need --out"); process.exit(1); }

var files = [];
if (ARGS.in) files = ARGS.in.split(",");
else if (ARGS.dir) files = fs.readdirSync(ARGS.dir)
  .filter(function (f) { return f.indexOf(RARITY + "-") === 0 && /\.json$/.test(f); })
  .map(function (f) { return path.join(ARGS.dir, f); });
if (!files.length) { console.error("no shard files"); process.exit(1); }

function letterOf(g) {
  var L = LADDER;
  for (var i = 0; i < L.length; i++) if (g >= L[i][1] - 1e-9) return L[i][0];
  return "F-";
}

var NODES = AXIS === "dps"
  ? ["Attack Power", "Additional Damage", "Boss Damage"]
  : ["Ally Attack Enh.", "Brand Power", "Ally Damage Enh."];
var SHORT = AXIS === "dps"
  ? { "Attack Power": "atk", "Additional Damage": "add dmg", "Boss Damage": "boss" }
  : { "Ally Attack Enh.": "ally atk", "Brand Power": "brand", "Ally Damage Enh.": "ally dmg" };
var CUTS_PER_WEEK = { uncommon: 70, rare: 26, epic: 9 };

var head = null, rows = [], AVG = {};
files.forEach(function (f) {
  var doc;
  try { doc = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.error("skip " + f + ": " + e.message); return; }
  if (doc.rarity !== RARITY) { console.error("skip " + f + ": rarity " + doc.rarity); return; }
  if (!head) head = doc;
  if (head.sig !== doc.sig) { console.error("MODEL SIG MISMATCH: " + f); process.exit(1); }
  (doc.rows || []).forEach(function (r) { rows.push(r); });
  Object.keys(doc.crossRaw || {}).forEach(function (band) {
    AVG[band] = (AVG[band] || []).concat(doc.crossRaw[band]);
  });
});
if (!head) { console.error("no readable shards"); process.exit(1); }

// one row per gpd — a resumed shard can carry a tier twice; last write wins
var byGpd = {};
rows.forEach(function (r) { byGpd[r.gpd] = r; });
rows = Object.keys(byGpd).map(function (g) { return byGpd[g]; })
  .sort(function (a, b) { return a.gpd - b.gpd; });
// same dedupe inside each band's cells
Object.keys(AVG).forEach(function (band) {
  var byG = {};
  AVG[band].forEach(function (c) { byG[c.gpd] = c; });
  AVG[band] = Object.keys(byG).map(function (g) { return byG[g]; })
    .sort(function (a, b) { return a.gpd - b.gpd; });
});

// carry the best grid so far up the merged budget axis (each shard only did
// this within its own interleaved tiers)
for (var i = 1; i < rows.length; i++) {
  if (rows[i].reachable === false) continue;
  var prev = rows[i - 1];
  if (prev.reachable === false) continue;
  if (rows[i].damage < prev.damage) {
    var keep = rows[i].gpd, g = rows[i].gold, gems = rows[i].gems, wk = rows[i].weeks;
    rows[i] = JSON.parse(JSON.stringify(prev));
    rows[i].gpd = keep;
    rows[i].gold = Math.max(g, prev.gold);
    rows[i].gems = Math.max(gems, prev.gems);
    rows[i].weeks = Math.max(wk, prev.weeks);
  }
}

// clearing-cut rung selection over the pooled cells, coverage-gated.
// Cells are priced by their unconditional median (goldMed) when the shard
// recorded one — sustained-crossing shards do; old first-touch shards fall
// back to the conditional mean and should not be mixed into a new ladder.
function cellPrice(a) { return a.goldMed != null ? a.goldMed : a.gold; }
var LADDER_ASC = LADDER.slice().reverse();
var rungs = [];
LADDER_ASC.forEach(function (row, k) {
  var best = null;
  for (var j = k; j < LADDER_ASC.length; j++) {
    (AVG[LADDER_ASC[j][0]] || []).forEach(function (a) {
      if (a.coverage < 0.8) return;
      if (!best || cellPrice(a) < cellPrice(best)) best = a;
    });
  }
  if (!best) return;
  rungs.push({ band: row[0], weakBand: letterOf(best.weakest),
    cut: row[1] === -Infinity ? 0 : row[1],
    gold: Math.round(cellPrice(best)), damage: Number(best.damage.toFixed(4)),
    gems: Math.round(best.gems), weeks: best.gems / CUTS_PER_WEEK[RARITY],
    mean: Number(best.mean.toFixed(1)), weakest: Number(best.weakest.toFixed(1)),
    cores: Math.round(best.cores), samples: best.count,
    perCore: best.perCore.map(function (v) { return Math.round(v); }),
    nodes: NODES.map(function (n, q) { return [SHORT[n], Math.round(best.node[q])]; }) });
});

fs.writeFileSync(OUT, JSON.stringify({
  rarity: RARITY, slots: head.slots, cutsPerWeek: head.cutsPerWeek,
  turns: head.turns, rerolls: head.rerolls,
  n: head.n, party: head.party, sig: head.sig, draw: head.draw || "mc", axis: AXIS,
  merged: files.length, tiers: rows.length,
  rows: rows, rungs: rungs, crossRaw: AVG
}, null, 1));
console.log(RARITY + ": " + files.length + " shards, " + rows.length + " tiers, " +
  rungs.length + " rungs -> " + OUT);
rungs.forEach(function (r) {
  console.log("  " + r.band.padEnd(4) + Math.round(r.gold / 1000).toLocaleString().padStart(8) +
    "k" + (r.damage.toFixed(3) + "%").padStart(9) + String(r.gems).padStart(6) + " gems");
});
