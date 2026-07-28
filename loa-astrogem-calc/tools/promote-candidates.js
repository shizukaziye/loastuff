#!/usr/bin/env node
/**
 * tools/promote-candidates.js — move triaged candidates into the eval corpus with
 * per-field trust masks.
 *
 * Trust model (see ocr/ACCURACY-LOG.md): a collected label is only trustworthy on
 * (a) fields the user explicitly corrected, and (b) fields where the CURRENT engine
 * agrees with it. A field the user left alone AND the engine disputes is unknown —
 * it may be a frozen collection-time parser error (several confirmed by pixel
 * review). Those fields get `_mask.skip` until a human resolves them; the disputes
 * land in samples/review-queue.json for pixel arbitration.
 *
 * Input:  samples/candidates/ (triage output) + an eval run over it (--eval=<file>,
 *         the stdout of tools/eval-ocr.js --dir=samples/candidates)
 * Output: samples/c-<id>.png/.json (masked labels) + samples/review-queue.json
 *
 * Usage:  node tools/promote-candidates.js --eval=/tmp/cand-eval.json [--max-mask=6]
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var CAND = path.join(ROOT, "samples", "candidates");
var SAMPLES = path.join(ROOT, "samples");

var args = { eval: null, maxMask: 6 };
process.argv.forEach(function (a) {
  var m;
  if ((m = a.match(/^--eval=(.+)$/))) args.eval = m[1];
  else if ((m = a.match(/^--max-mask=(\d+)$/))) args.maxMask = +m[1];
});
if (!args.eval) { console.error("need --eval=<eval-ocr output file over samples/candidates>"); process.exit(1); }

var manifest = JSON.parse(fs.readFileSync(path.join(CAND, "candidates-manifest.json"), "utf8"));
var byId = {};
manifest.forEach(function (m) { byId[m.id] = m; });

// Parse the human miss lines from the eval output: "  <id>  fields N/M  outcomes P%  miss: a(x≠y), ..."
var missesById = {};
fs.readFileSync(args.eval, "utf8").split("\n").forEach(function (line) {
  var m = line.match(/^\s+(\S+)\s+fields \d+\/\d+\s+outcomes ([\d.]+)%(?:\s+miss: (.*))?$/);
  if (!m || !byId[m[1]]) return;
  var fields = [];
  var missStr = m[3] || "";
  var fm, re = /(\w+)\(([^)]*)≠([^)]*)\)/g;
  while ((fm = re.exec(missStr))) fields.push({ field: fm[1], engine: fm[2], label: fm[3] });
  if (parseFloat(m[2]) < 100) fields.push({ field: "outcomes", engine: "(set)", label: "(set)" });
  missesById[m[1]] = fields;
});

var queue = [];
var promoted = 0, held = 0;
manifest.forEach(function (m) {
  var id = m.id;
  var labelPath = path.join(CAND, id + ".json");
  var imgPath = path.join(CAND, id + ".png");
  if (!fs.existsSync(labelPath) || !fs.existsSync(imgPath)) return;
  var label = JSON.parse(fs.readFileSync(labelPath, "utf8"));
  var corrected = {};
  (m.changed || []).forEach(function (c) {
    var f = c.field.split(".").pop();
    if (/^outcomes\./.test(c.field) || c.field === "outcomes") f = "outcomes";
    corrected[f] = true;
  });
  var skip = [];
  (missesById[id] || []).forEach(function (d) {
    if (!corrected[d.field]) {
      if (skip.indexOf(d.field) === -1) skip.push(d.field);
      queue.push({ id: id, field: d.field, engineNow: d.engine, label: d.label, cls: m.class, res: m.width + "x" + m.height });
    }
  });
  if (skip.length > args.maxMask) { held++; return; }   // too little trustworthy signal
  if (skip.length) label._mask = { skip: skip.sort() };
  label._origin = { collected: id, class: m.class, ts: m.ts, promoted: "2026-07-27" };
  fs.writeFileSync(path.join(SAMPLES, "c-" + id + ".json"), JSON.stringify(label, null, 2) + "\n");
  fs.copyFileSync(imgPath, path.join(SAMPLES, "c-" + id + ".png"));
  promoted++;
});

// Review queue: most-disputed fields first, so pixel time goes where it pays most.
var freq = {};
queue.forEach(function (q) { freq[q.field] = (freq[q.field] || 0) + 1; });
queue.sort(function (a, b) { return (freq[b.field] - freq[a.field]) || a.id.localeCompare(b.id); });
fs.writeFileSync(path.join(SAMPLES, "review-queue.json"), JSON.stringify(queue, null, 2) + "\n");

console.log("promoted " + promoted + " candidates into samples/ as c-<id> pairs (" + held + " held back: >" + args.maxMask + " masked fields)");
console.log("masked-field disputes queued for pixel review: " + queue.length + " -> samples/review-queue.json");
Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).forEach(function (f) {
  console.log("  " + f + "  x" + freq[f]);
});
