#!/usr/bin/env node
/**
 * tools/eval-gemlist.js — accuracy gate for the Ark Grid list reader.
 *
 *   node tools/eval-gemlist.js [--samples samples/gemlist] [--gate 1.0] [-v]
 *   node tools/eval-gemlist.js --holdout        (leave-one-screenshot-out)
 *   node tools/eval-gemlist.js --scales         (every capture size, silents only)
 *
 * The plain run scores the SHIPPED ocr/gemlist-refs.js, whose templates were
 * harvested from these same screenshots — it proves the geometry and the
 * matching agree with the labels, not that the reader generalizes. `--holdout`
 * is the honest number: for each screenshot it rebuilds the templates from the
 * OTHER ones and reads that shot with templates that never saw it.
 *
 * Runs ocr/gemlist-engine.js over every labelled screenshot and scores it field
 * by field (cost, points, both effect names, both levels, gem type). Two numbers
 * matter, and the second one matters more:
 *
 *   ACCURACY  — fields read correctly.
 *   SILENTS   — fields read WRONG while the reader raised no flag. A silent
 *               error grades a gem the user never gets asked about, so the gate
 *               fails on a single one however good the accuracy looks.
 *
 * Exit code 1 when either gate fails, so it can sit in front of a deploy.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var sharp = require("sharp");
var E = require("../ocr/gemlist-engine.js");

var ROOT = path.join(__dirname, "..");
var argv = process.argv.slice(2);
function arg(f, d) { var i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; }
var VERBOSE = argv.indexOf("-v") >= 0 || argv.indexOf("--verbose") >= 0;
var SAMPLES = path.resolve(ROOT, arg("--samples", "samples/gemlist"));
// The shipped-refs run must be perfect; the holdout fold is allowed the fields
// whose glyph simply isn't in the training fold (digits 8 and 9 appear once
// each in the corpus). ZERO silent errors is required either way.
var GATE = parseFloat(arg("--gate", argv.indexOf("--holdout") >= 0 ? "0.97" : "1.0"));

var HOLDOUT = argv.indexOf("--holdout") >= 0;
var REFS = HOLDOUT ? null : require("../ocr/gemlist-refs.js");

async function loadImage(file) {
  var o = await sharp(file).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  return { width: o.info.width, height: o.info.height, data: o.data };
}

// Harvest templates from a set of already-decoded shots — the same averaging
// tools/build-gemlist-refs.js does, in memory, so --holdout can leave one out.
function harvestRefs(entries) {
  var nameSum = {}, digitSum = {};
  function add(bag, size, key, patch) {
    if (!patch || key == null) return;
    var e = bag[key] || (bag[key] = { sum: new Float64Array(size), n: 0 });
    for (var i = 0; i < size; i++) e.sum[i] += patch[i];
    e.n++;
  }
  entries.forEach(function (en) {
    var panel = E._findPanel(en.masks);
    if (!panel) return;
    var n = Math.min(panel.rowsY.length, en.shot.rows.length);
    for (var r = 0; r < n; r++) {
      var t = en.shot.rows[r];
      var L1 = E._cutLine(en.masks, panel, panel.rowsY[r], 1);
      var L2 = E._cutLine(en.masks, panel, panel.rowsY[r], 2);
      add(digitSum, E.DIGIT_W * E.DIGIT_H, String(t.cost), L1.digit);
      add(digitSum, E.DIGIT_W * E.DIGIT_H, String(t.pts), L2.digit);
      add(digitSum, E.DIGIT_W * E.DIGIT_H, String(t.l1), L1.level);
      add(digitSum, E.DIGIT_W * E.DIGIT_H, String(t.l2), L2.level);
      add(nameSum, E.NAME_W * E.NAME_H, t.e1, L1.name);
      add(nameSum, E.NAME_W * E.NAME_H, t.e2, L2.name);
    }
  });
  function done(bag, size) {
    var out = {};
    Object.keys(bag).forEach(function (k) {
      var a = new Float32Array(size);
      for (var i = 0; i < size; i++) a[i] = bag[k].sum[i] / bag[k].n;
      out[k] = a;
    });
    return out;
  }
  return { names: done(nameSum, E.NAME_W * E.NAME_H), digits: done(digitSum, E.DIGIT_W * E.DIGIT_H) };
}

// --scales: read every screenshot at a range of capture sizes, from 4K down past
// the point the reader refuses. Accuracy is expected to sag at the bottom; what
// must NOT happen at any size is a wrong field the reader failed to flag.
var FIELD_MAP = { cost: "cost", points: "pts", effect1: "e1", effect1Level: "l1", effect2: "e2", effect2Level: "l2" };
async function scaleSweep(labels, refs, pools) {
  var WIDTHS = [3840, 3413, 3072, 2880, 2560, 2400, 2300, 2133, 1920, 1600];
  var anySilent = 0;
  console.log("width  pitch  read      fields          flags  silent");
  for (var wi = 0; wi < WIDTHS.length; wi++) {
    var W = WIDTHS[wi], tot = 0, ok = 0, sil = [], refused = 0, flags = 0, rows = 0, pitch = 0;
    for (var si = 0; si < labels.shots.length; si++) {
      var shot = labels.shots[si];
      var o = await sharp(path.join(SAMPLES, shot.file)).resize({ width: W })
        .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      var res = E.parse({ width: o.info.width, height: o.info.height, data: o.data }, { refs: refs, pools: pools });
      if (!res.ok) { refused++; continue; }
      pitch = res.panel.pitch;
      /* eslint-disable no-loop-func */
      res.rows.forEach(function (got, r) {
        var want = shot.rows[r];
        if (!want) return;
        rows++; flags += got.flags.length;
        Object.keys(FIELD_MAP).forEach(function (k) {
          var f = FIELD_MAP[k];
          tot++;
          if (got[k] === want[f]) ok++;
          else if (got.flags.indexOf(f) < 0) sil.push(shot.file + " row" + r + " " + f + ": " + JSON.stringify(got[k]) + " != " + JSON.stringify(want[f]));
        });
      });
    }
    anySilent += sil.length;
    console.log(String(W).padStart(5) + "  " + (pitch ? pitch.toFixed(0) : "-").padStart(5) +
      "  " + (refused ? "refused " + refused + "/4" : rows + " rows").padEnd(9) +
      "  " + String(ok).padStart(3) + "/" + String(tot).padEnd(4) +
      (tot ? (100 * ok / tot).toFixed(1).padStart(6) + "%" : "      -") +
      "  " + String(flags).padStart(5) + "  " + String(sil.length).padStart(6));
    sil.forEach(function (s) { console.log("        SILENT " + s); });
  }
  console.log("\n" + (anySilent ? "GATE FAILED — " + anySilent + " silent error(s) across the sweep" : "no silent errors at any capture size"));
  process.exit(anySilent ? 1 : 0);
}

(async function main() {
  var labels = JSON.parse(fs.readFileSync(path.join(SAMPLES, "labels.json"), "utf8"));
  var POOLS = require("../model/astrogem.js").EFFECT_POOLS;
  if (argv.indexOf("--scales") >= 0) return scaleSweep(labels, require("../ocr/gemlist-refs.js"), POOLS);
  var tot = 0, ok = 0, silent = [], flaggedOk = 0, flaggedWrong = 0, rowsOk = 0, rowsTot = 0;
  var eqOk = 0, eqTot = 0, eqBad = [];   // the "equipped" badge — informational, scored apart
  var unseen = [];   // holdout: classes the training fold never saw

  var decoded = [];
  if (HOLDOUT) {
    for (var d = 0; d < labels.shots.length; d++) {
      var im = await loadImage(path.join(SAMPLES, labels.shots[d].file));
      decoded.push({ shot: labels.shots[d], img: im, masks: E._buildMasks(im) });
    }
  }

  for (var si = 0; si < labels.shots.length; si++) {
    var shot = labels.shots[si];
    var img, refs = REFS;
    if (HOLDOUT) {
      img = decoded[si].img;
      refs = harvestRefs(decoded.filter(function (_, k) { return k !== si; }));
      // A digit or name that only ever appears on the held-out shot cannot be
      // read by a fold that never saw it — say so instead of scoring it as skill.
      shot.rows.forEach(function (t, r) {
        [String(t.cost), String(t.pts), String(t.l1), String(t.l2)].forEach(function (k) {
          if (!refs.digits[k]) unseen.push(shot.file + " row" + r + " digit " + k);
        });
        [t.e1, t.e2].forEach(function (k) { if (!refs.names[k]) unseen.push(shot.file + " row" + r + " name " + k); });
      });
    } else {
      img = await loadImage(path.join(SAMPLES, shot.file));
    }
    var t0 = Date.now();
    var res = E.parse(img, { refs: refs, pools: POOLS });
    var ms = Date.now() - t0;
    if (!res.ok) { console.log("FAIL " + shot.file + ": " + res.error); process.exit(1); }
    console.log("\n" + shot.file + "  —  " + res.rows.length + " rows, pitch " +
      res.panel.pitch.toFixed(2) + ", iconCx " + res.panel.iconCx.toFixed(1) + "  (" + ms + " ms)");
    if (res.rows.length !== shot.rows.length)
      console.log("  !! row count " + res.rows.length + " vs labelled " + shot.rows.length);

    var n = Math.min(res.rows.length, shot.rows.length);
    for (var r = 0; r < n; r++) {
      var got = res.rows[r], want = shot.rows[r], bad = [];
      rowsTot++;
      [["cost", got.cost, want.cost], ["pts", got.points, want.pts],
       ["e1", got.effect1, want.e1], ["l1", got.effect1Level, want.l1],
       ["e2", got.effect2, want.e2], ["l2", got.effect2Level, want.l2],
       ["type", got.gemType, shot.type]].forEach(function (f) {
        tot++;
        var good = f[1] === f[2];
        if (good) ok++;
        else {
          bad.push(f[0] + ": got " + JSON.stringify(f[1]) + " want " + JSON.stringify(f[2]));
          if (got.flags.indexOf(f[0]) < 0) silent.push(shot.file + " row" + r + " " + f[0] + ": " + JSON.stringify(f[1]) + " != " + JSON.stringify(f[2]));
        }
      });
      if (want.equipped != null && got.equipped != null) {
        eqTot++;
        if (got.equipped === want.equipped) eqOk++;
        else eqBad.push(shot.file + " row" + r + ": got " + got.equipped + " want " + want.equipped);
      }
      got.flags.forEach(function (f) {
        var pair = { cost: [got.cost, want.cost], pts: [got.points, want.pts], e1: [got.effect1, want.e1],
                     l1: [got.effect1Level, want.l1], e2: [got.effect2, want.e2], l2: [got.effect2Level, want.l2] }[f];
        if (pair) { if (pair[0] === pair[1]) flaggedOk++; else flaggedWrong++; }
      });
      if (!bad.length) rowsOk++;
      if (bad.length || VERBOSE) {
        console.log("  row " + r + (bad.length ? "  WRONG" : "  ok   ") +
          "  cost " + got.cost + " pts " + got.points +
          " | " + got.effect1 + " " + got.effect1Level +
          " / " + got.effect2 + " " + got.effect2Level +
          " | " + got.gemType + (got.equipped ? " [equipped]" : "") +
          (got.flags.length ? "  flags=" + got.flags.join(",") : ""));
        bad.forEach(function (b) { console.log("        " + b); });
      }
    }
  }

  var acc = ok / tot;
  console.log("\n=========================================================");
  console.log(HOLDOUT ? "LEAVE-ONE-SCREENSHOT-OUT" : "shipped ocr/gemlist-refs.js (templates saw these shots)");
  console.log("fields     " + ok + "/" + tot + "  =  " + (acc * 100).toFixed(2) + "%");
  console.log("whole rows " + rowsOk + "/" + rowsTot);
  console.log("flags      " + (flaggedOk + flaggedWrong) + " raised (" + flaggedWrong + " on a genuinely wrong field, " + flaggedOk + " false alarms)");
  console.log("equipped   " + eqOk + "/" + eqTot + " (badge only — never feeds a grade)");
  eqBad.forEach(function (s) { console.log("   " + s); });
  console.log("SILENT     " + silent.length + (silent.length ? "  <-- wrong AND unflagged" : ""));
  silent.forEach(function (s) { console.log("   " + s); });
  if (HOLDOUT && unseen.length) {
    console.log("note       " + unseen.length + " field(s) had NO template in their fold (unreadable by construction):");
    unseen.slice(0, 12).forEach(function (s) { console.log("   " + s); });
  }
  console.log("=========================================================");
  var fail = (acc < GATE) || silent.length > 0 || (eqTot > 0 && eqOk < eqTot);
  if (fail) console.log("GATE FAILED (need accuracy >= " + GATE + " and 0 silents)");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
