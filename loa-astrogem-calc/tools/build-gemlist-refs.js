#!/usr/bin/env node
/**
 * tools/build-gemlist-refs.js — GENERATES ocr/gemlist-refs.js.
 *
 * Harvests the effect-name and digit templates the Ark Grid list reader matches
 * against, straight from labelled screenshots. It calls the reader's OWN cutting
 * code (ocr/gemlist-engine.js `_cutLine`), so a template can never be harvested
 * through different geometry than the one that later reads it.
 *
 *   node tools/build-gemlist-refs.js [--samples samples/gemlist]
 *
 * Input:  samples/gemlist/labels.json  (see that file's _note) + the .jpeg/.png
 *         screenshots it names. `samples/` is gitignored — the corpus lives on
 *         disk, the generated refs file is what gets committed.
 * Output: ocr/gemlist-refs.js
 *
 * BANDS. Both patch kinds are size-normalized before matching, but normalizing
 * does not undo blur: a digit that was 17 px tall on a 4K capture and one that
 * was 11 px tall at 1440p end up the same size with visibly different stroke
 * weight, and averaging them together blurs both (the same lesson tools/
 * build-glyphs.js learned as GLYPH_BANDS). So the corpus is harvested at several
 * scales and kept in SEPARATE bands keyed by the row pitch they were seen at;
 * the reader picks the band nearest the pitch it measured.
 *
 * Re-run after adding screenshots — more exemplars only sharpen the averages.
 * Then re-run `npm run eval-gemlist` and `npm run eval-gemlist-holdout`.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var sharp = require("sharp");
var E = require("../ocr/gemlist-engine.js");

var ROOT = path.join(__dirname, "..");
var argv = process.argv.slice(2);
function arg(flag, dflt) {
  var i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
var SAMPLES = path.resolve(ROOT, arg("--samples", "samples/gemlist"));

// Downscale factors applied to every sample. 1.0 is whatever the capture is;
// the rest step down to the smallest pitch the reader accepts (62 — see
// MIN_PITCH in the engine). Going below that only builds templates out of mush
// and drags the whole bank down, which is exactly what happened when this list
// reached 0.42.
var SCALES = [1.0, 0.82, 0.66];

async function loadImage(file, scale) {
  var img = sharp(file);
  if (scale !== 1.0) {
    var meta = await sharp(file).metadata();
    img = img.resize({ width: Math.round(meta.width * scale) });
  }
  var o = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: o.info.width, height: o.info.height, data: o.data };
}

function Bag(size) { this.size = size; this.map = {}; }
Bag.prototype.add = function (key, patch) {
  if (!patch || key == null || key === "null" || key === "undefined") return;
  var e = this.map[key] || (this.map[key] = { sum: new Float64Array(this.size), n: 0 });
  for (var i = 0; i < this.size; i++) e.sum[i] += patch[i];
  e.n++;
};
Bag.prototype.finish = function () {
  var out = {}, self = this;
  Object.keys(this.map).forEach(function (k) {
    var e = self.map[k], a = new Uint8Array(self.size);
    for (var i = 0; i < self.size; i++) a[i] = Math.max(0, Math.min(255, Math.round(e.sum[i] / e.n * 255)));
    out[k] = { bytes: a, n: e.n };
  });
  return out;
};

(async function main() {
  var labels = JSON.parse(fs.readFileSync(path.join(SAMPLES, "labels.json"), "utf8"));
  var bands = [], missed = [], totalLines = 0;

  for (var sc = 0; sc < SCALES.length; sc++) {
    var scale = SCALES[sc];
    var names = new Bag(E.NAME_W * E.NAME_H);
    var digits = new Bag(E.DIGIT_W * E.DIGIT_H);
    var pitches = [], lines = 0;

    for (var si = 0; si < labels.shots.length; si++) {
      var shot = labels.shots[si];
      var img = await loadImage(path.join(SAMPLES, shot.file), scale);
      var m = E._buildMasks(img);
      var panel = E._findPanel(m);
      if (!panel) { missed.push("x" + scale + " " + shot.file + ": no panel"); continue; }
      if (panel.rowsY.length !== shot.rows.length)
        missed.push("x" + scale + " " + shot.file + ": found " + panel.rowsY.length + " rows, labels have " + shot.rows.length);
      pitches.push(panel.pitch);
      var n = Math.min(panel.rowsY.length, shot.rows.length);
      for (var r = 0; r < n; r++) {
        var t = shot.rows[r];
        var L1 = E._cutLine(m, panel, panel.rowsY[r], 1);
        var L2 = E._cutLine(m, panel, panel.rowsY[r], 2);
        digits.add(String(t.cost), L1.digit);
        digits.add(String(t.pts), L2.digit);
        digits.add(String(t.l1), L1.level);
        digits.add(String(t.l2), L2.level);
        names.add(t.e1, L1.name);
        names.add(t.e2, L2.name);
        lines += 2;
        if (!L1.digit || !L2.digit || !L1.name || !L2.name || !L1.level || !L2.level)
          missed.push("x" + scale + " " + shot.file + " row" + r + ": a field cut empty");
      }
    }
    if (!pitches.length) continue;
    pitches.sort(function (a, b) { return a - b; });
    bands.push({
      pitch: pitches[Math.floor(pitches.length / 2)],
      names: names.finish(), digits: digits.finish(), lines: lines
    });
    totalLines += lines;
  }

  function b64(bytes) { return Buffer.from(bytes).toString("base64"); }
  function block(obj, indent) {
    return Object.keys(obj).sort().map(function (k) {
      return indent + JSON.stringify(k) + ": u(\"" + b64(obj[k].bytes) + "\")";
    }).join(",\n");
  }
  var bandJs = bands.map(function (b) {
    return "    { pitch: " + b.pitch.toFixed(2) + ",\n" +
      "      names: {\n" + block(b.names, "        ") + "\n      },\n" +
      "      digits: {\n" + block(b.digits, "        ") + "\n      } }";
  }).join(",\n");

  var prov = bands.map(function (b) {
    return " *   pitch " + b.pitch.toFixed(1) + " — " + b.lines + " lines · names " +
      Object.keys(b.names).sort().map(function (k) { return k + ":" + b.names[k].n; }).join(" ") +
      " · digits " + Object.keys(b.digits).sort().map(function (k) { return k + ":" + b.digits[k].n; }).join(" ");
  }).join("\n");

  var out = "/**\n" +
" * ocr/gemlist-refs.js — GENERATED by tools/build-gemlist-refs.js (do not hand-edit).\n" +
" *\n" +
" * Averaged coverage maps of the Ark Grid list panel's glyphs, harvested from\n" +
" * labelled screenshots through the reader's own cutting geometry.\n" +
" *   names  — " + E.NAME_W + "x" + E.NAME_H + ", scaled by ROW PITCH (so width carries meaning),\n" +
" *            left-aligned on the first white column of the name.\n" +
" *   digits — " + E.DIGIT_W + "x" + E.DIGIT_H + ", scaled to a fixed glyph height and centred, which\n" +
" *            makes them immune to a slightly-off pitch estimate.\n" +
" *\n" +
" * BANDS: one set per capture size. Size-normalizing does not undo blur, so a\n" +
" * 4K glyph and a 1440p one are kept apart and the reader picks the band nearest\n" +
" * the pitch it measured. Values are bytes 0-255 = coverage x 255, base64'd.\n" +
" *\n" +
" * Provenance: " + labels.shots.length + " screenshots x " + bands.length + " scales, " + totalLines + " lines.\n" +
prov + "\n" +
" */\n" +
"(function (root) {\n" +
"  \"use strict\";\n" +
"  // base64 bytes -> Float32Array of 0..1\n" +
"  function u(s) {\n" +
"    var bin = (typeof atob === \"function\") ? atob(s) : Buffer.from(s, \"base64\").toString(\"latin1\");\n" +
"    var a = new Float32Array(bin.length);\n" +
"    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i) / 255;\n" +
"    return a;\n" +
"  }\n" +
"  var REFS = {\n" +
"    w: { name: [" + E.NAME_W + ", " + E.NAME_H + "], digit: [" + E.DIGIT_W + ", " + E.DIGIT_H + "] },\n" +
"    bands: [\n" + bandJs + "\n    ]\n" +
"  };\n" +
"  if (typeof module !== \"undefined\" && module.exports) module.exports = REFS;\n" +
"  else root.GemListRefs = REFS;\n" +
"})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";

  fs.writeFileSync(path.join(ROOT, "ocr", "gemlist-refs.js"), out);
  var kb = (fs.statSync(path.join(ROOT, "ocr", "gemlist-refs.js")).size / 1024).toFixed(0);
  console.log("wrote ocr/gemlist-refs.js — " + bands.length + " bands, " + totalLines + " lines, " + kb + " KB");
  bands.forEach(function (b) {
    console.log("  pitch " + b.pitch.toFixed(1).padStart(6) + "  names " + Object.keys(b.names).length +
      "  digits " + Object.keys(b.digits).sort().join(""));
  });
  if (missed.length) {
    console.log("\n  " + missed.length + " harvest problem(s):");
    missed.slice(0, 30).forEach(function (s) { console.log("    " + s); });
  }
})().catch(function (e) { console.error(e); process.exit(1); });
