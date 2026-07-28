#!/usr/bin/env node
/**
 * tools/triage-collected.js — sort pulled Advisor records into eval-corpus candidates.
 *
 * The collected feed (samples/collected/, via tools/pull-collected.js) mixes three
 * very different things and only one of them is parser ground truth:
 *
 *   1. SAME-BOARD FIX — the user corrected fields, and the final state still
 *      describes the screenshot (same turn, no gold spent, no history). These are
 *      parser failures with user-verified labels: the corpus gold.
 *   2. PROGRESSION — the user parsed a screenshot, then played on: final describes a
 *      LATER board (turn advanced / gold grew / history non-empty / outcomes all
 *      replaced). The screenshot's truth at parse time is unknowable from the record.
 *      Treating these as corrections would poison the corpus — excluded.
 *   3. CLEAN CONFIRM — changed is empty. Weak positives (a wrong parse the user
 *      didn't notice still confirms), useful as regression controls, sampled only.
 *
 * Output: samples/candidates/<id>.png + <id>.json (label built from `final` in the
 * samples/README.md schema) + candidates-manifest.json with per-record classification,
 * image hash dedupe, resolution, parse-time confidences and what changed — so the
 * promotion step can pixel-verify the right fields instead of trusting labels blind.
 *
 * Usage:  node tools/triage-collected.js [--max-fix=N] [--max-clean=N]
 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var sharp = require("sharp");

var ROOT = path.resolve(__dirname, "..");
var COLLECTED = path.join(ROOT, "samples", "collected");
var OUT = path.join(ROOT, "samples", "candidates");

var args = { maxFix: 200, maxClean: 40 };
process.argv.forEach(function (a) {
  var m;
  if ((m = a.match(/^--max-fix=(\d+)$/))) args.maxFix = +m[1];
  else if ((m = a.match(/^--max-clean=(\d+)$/))) args.maxClean = +m[1];
});

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }

// final -> samples/README.md ground-truth schema
function labelFromFinal(fin) {
  return {
    config: {
      baseCost: fin.config.baseCost,
      gemType: fin.config.gemType,
      willpowerLevel: fin.config.willpowerLevel,
      orderLevel: fin.config.orderLevel,
      effect1: fin.config.effect1,
      effect1Level: fin.config.effect1Level,
      effect2: fin.config.effect2,
      effect2Level: fin.config.effect2Level
    },
    state: {
      currentTurn: fin.currentTurn,
      maxTurns: fin.maxTurns,
      rerollsRemaining: fin.rerollsRemaining,
      processCost: fin.processCost,
      processCostMultiplier: fin.processCostMultiplier,
      totalGoldSpent: fin.totalGoldSpent,
      rosterBound: !!fin.rosterBound
    },
    outcomes: (fin.outcomes || []).map(function (o) {
      var out = { type: o.type };
      if (o.target != null) out.target = o.target;
      if (o.amount != null) out.amount = o.amount;
      if (o.change != null) out.change = o.change;   // reroll_increase / change_gold_cost carry `change`, not amount
      return out;
    })
  };
}

function classify(rec) {
  var par = rec.parse || {}, fin = rec.final || {};
  var ps = par.state || {};
  var changed = rec.changed || [];
  if (!fin.config || !fin.outcomes) return "malformed";
  if (changed.length === 0) return "clean";
  // Progression signals: the final board is not the parsed screenshot's board.
  if ((fin.history || []).length > 0) return "progression";
  if (ps.currentTurn != null && fin.currentTurn != null && fin.currentTurn !== ps.currentTurn) {
    // The user may also have FIXED a misread turn — treat as progression only when
    // other movement corroborates (gold moved, or every outcome row replaced).
    var goldMoved = (fin.totalGoldSpent || 0) !== (ps.totalGoldSpent || 0);
    var outcomesChanged = changed.filter(function (c) { return /^outcomes\./.test(c.field); }).length;
    if (goldMoved || outcomesChanged >= 3) return "progression";
    return "turnfix";
  }
  if ((fin.totalGoldSpent || 0) !== (ps.totalGoldSpent || 0)) return "progression";
  return "fix";
}

(async function () {
  fs.mkdirSync(OUT, { recursive: true });
  var files = fs.readdirSync(COLLECTED).filter(function (f) { return f.endsWith(".json"); });
  var byClass = { fix: [], turnfix: [], clean: [], progression: [], malformed: [] };
  var seenHash = Object.create(null);
  var dupes = 0;

  for (var i = 0; i < files.length; i++) {
    var rec = readJson(path.join(COLLECTED, files[i]));
    if (!rec) continue;
    var img = path.join(COLLECTED, files[i].replace(/\.json$/, ".webp"));
    if (!fs.existsSync(img)) { continue; }
    var cls = classify(rec);
    var hash = crypto.createHash("sha1").update(fs.readFileSync(img)).digest("hex").slice(0, 16);
    if (seenHash[hash]) { dupes++; continue; }
    seenHash[hash] = true;
    byClass[cls] && byClass[cls].push({ rec: rec, img: img, hash: hash });
  }

  console.log("triage over " + files.length + " records (" + dupes + " duplicate images skipped):");
  Object.keys(byClass).forEach(function (k) { console.log("  " + k + ": " + byClass[k].length); });

  // Field-level tallies for the same-board fixes: the honest hotspot list.
  var tally = Object.create(null);
  byClass.fix.forEach(function (e) {
    (e.rec.changed || []).forEach(function (c) { tally[c.field] = (tally[c.field] || 0) + 1; });
  });
  console.log("\nsame-board correction hotspots (parser failures with verified labels):");
  Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).forEach(function (f) {
    console.log("  " + f + "  x" + tally[f]);
  });

  // Emit candidates: all same-board fixes (up to cap), then an even sample of cleans.
  var manifest = [];
  async function emit(entry, cls) {
    var rec = entry.rec;
    var png = path.join(OUT, rec.id + ".png");
    var meta = await sharp(entry.img).png().toFile(png);
    var label = labelFromFinal(rec.final);
    fs.writeFileSync(path.join(OUT, rec.id + ".json"), JSON.stringify(label, null, 2) + "\n");
    manifest.push({
      id: rec.id, class: cls, hash: entry.hash, ts: rec.ts,
      width: meta.width, height: meta.height,
      engine: (rec.meta || {}).engine, source: (rec.meta || {}).source,
      changed: (rec.changed || []).map(function (c) { return { field: c.field, parsed: c.parsed, corrected: c.corrected }; }),
      confidence: (rec.parse || {}).confidence || null
    });
  }

  var fixes = byClass.fix.slice(0, args.maxFix);
  for (var j = 0; j < fixes.length; j++) await emit(fixes[j], "fix");
  var cleans = byClass.clean;
  var step = Math.max(1, Math.floor(cleans.length / Math.max(1, args.maxClean)));
  var took = 0;
  for (var k = 0; k < cleans.length && took < args.maxClean; k += step, took++) await emit(cleans[k], "clean");

  fs.writeFileSync(path.join(OUT, "candidates-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("\nwrote " + manifest.length + " candidates (" + fixes.length + " fix + " + took + " clean) to samples/candidates/");
  console.log("Next: verify labels (pixel-check the corrected fields), then promote into samples/.");
})().catch(function (e) { console.error(e); process.exit(1); });
