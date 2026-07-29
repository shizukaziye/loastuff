#!/usr/bin/env node
/**
 * tools/build-glyphs.js — harvest the game's digit glyphs from the labeled corpus.
 *
 * The closed-vocabulary reads (wheel levels, points header, Process (x/N), reroll
 * pill) don't need OCR: the game renders one fixed font, and after the engine's
 * resolution normalization every glyph arrives at one fixed size. This tool cuts
 * glyph boxes out of every labeled sample at the engine's own locations, names them
 * from the ground truth (only when the segmentation is unambiguous), averages the
 * bitmaps per character, and emits ocr/glyphs.js.
 *
 * Letters ("Process", "Astrogem Points", "Lv") are harvested too — as DISTRACTOR
 * classes, so a matcher can reject "o"-looks-like-"0" instead of accepting it.
 *
 * Usage:  node tools/build-glyphs.js            # writes ocr/glyphs.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var sharp = require("sharp");
var L = require("../ocr/layout.js");

var SAMPLES = path.join(__dirname, "..", "samples");
var OUT = path.join(__dirname, "..", "ocr", "glyphs.js");
var CANON_GAP = 246;

// HOLDOUT (2026-07-28, round 2): ~20% of the corpus, picked by a deterministic
// name hash, never feeds the harvest — the eval can then report template accuracy
// on samples the templates never saw. Same rule in tools/build-level-refs.js.
function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
function isHoldout(base) { return djb2(base) % 5 === 0; }

// the DIM white mask, matching the engine's find/read mask for footer text (strict
// v>0.72 keeps only a sparse skeleton on 2x-upscaled captures)
function isWhite(r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.3 && c.v > 0.6; }
function isGold(r, g, b) { return L.isGoldText(r, g, b); }

// accumulators: char -> { sum: Float64Array, n } — one pooled set plus one per
// RESOLUTION BAND. The corpus is now dominated by ×2-upscaled small-monitor
// captures whose bilinear-fattened strokes average into different silhouettes
// than native-tier glyphs (measured: a native-built '+' template outscored the
// true serif-'1' on a ×2 points header, killing the level checksum). The band is
// the engine's own normalization factor (scaleF), which it knows at parse time.
var CUR_BAND = "n";   // set per sample from its scaleF
// Every instance is STORED (label, band, bitmap) rather than folded into a
// running average: a PURIFICATION pass after the loop ejects mislabeled
// instances before any averaging. Positional labeling has measured leak modes
// — eroded "Lv." fragments entered '+' (the native '+' template rendered as a
// serif-'1' and outscored real ones), shifted Process-pair tails leak digits
// into '('/'/' — and a 0.5-thresholded average of polluted or misaligned
// instances turns to mush (the native '2'/'3'/'8' were unrecognizable).
var INSTANCES = [];
function addInstance(ch, mask, box) {
  var bm = L.glyphBitmap(mask, box);
  INSTANCES.push({ ch: ch, band: CUR_BAND, bm: bm });
}
// Shape sanity for GOLD-SOURCE digit instances (wheel levels, outcome amounts):
// the diamond-TIP missegmentation is a SOLID wide triangle (fill ≥~0.5, aspect
// ≥~0.85) while real digits are strokes. Without this gate the tips flooded the
// white '1'/'2'/'3' classes (found 2026-07-18: all three templates had become
// near-identical triangles — the cause of every dim-'3' template failure).
function addDigitInstance(ch, mask, box) {
  var a = box.w / Math.max(1, box.h);
  var isOne = ch === "1";
  if (isOne ? a >= 0.6 : (a < 0.3 || a > 0.85)) return;
  var bm = L.glyphBitmap(mask, box), ink = 0;
  for (var i = 0; i < bm.length; i++) ink += bm[i];
  var fill = ink / bm.length;
  if (fill < 0.1 || fill > 0.48) return;   // tips are solid; digits are strokes
  addInstance(ch, mask, box);
}

// segment a rect of the raster through a chroma mask; drop dust boxes
function segRect(raster, rect, pred) {
  var sub = L.crop(raster, rect);
  var mask = L.chromaMask(sub, pred);
  var boxes = L.segmentGlyphs(mask, { minColPx: 1, gapCols: 1 });
  var hs = boxes.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
  var medH = hs.length ? hs[hs.length >> 1] : 0;
  // 1.7 upper bound matches the engine's segmentDigitBoxes (unified 2026-07-18;
  // was 1.6 here — a silent divergence between harvest and read segmentation)
  return { mask: mask, boxes: boxes.filter(function (b) { return b.h >= medH * 0.55 && b.h <= medH * 1.7 && b.w >= 2; }) };
}

(async function () {
  var files = fs.readdirSync(SAMPLES).filter(function (f) { return /\.(png|webp|jpe?g)$/i.test(f); });
  var used = 0, held = 0;
  for (var fi = 0; fi < files.length; fi++) {
    var img = files[fi];
    var base = img.replace(/\.(png|webp|jpe?g)$/i, "");
    if (isHoldout(base)) { held++; continue; }
    var truthFile = path.join(SAMPLES, base + ".json");
    if (!fs.existsSync(truthFile)) continue;
    var truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
    if (truth._unusable) continue;

    var dec = await sharp(path.join(SAMPLES, img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    var raster = { width: dec.info.width, height: dec.info.height, data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length) };
    var found = L.panelOrWhole(raster);
    if (!found || !found.anchors) continue;
    if (L.fitWheel) found.anchors = L.fitWheel(raster, found.anchors);

    // mirror the engine's normalization (crop margin skipped: coordinates only)
    var g0 = found.anchors.gold.y - found.anchors.red.y;
    var fRaw = CANON_GAP / Math.max(8, g0);
    var scaleF = fRaw <= 0.65 ? 0.5 : fRaw <= 1.25 ? 1 : Math.min(3, Math.round(fRaw));
    CUR_BAND = scaleF >= 3 ? "u3" : scaleF >= 2 ? "u2" : "n";
    if (scaleF !== 1) raster = L.upscaleBilinear(raster, scaleF);
    var red = { x: found.anchors.red.x * scaleF, y: found.anchors.red.y * scaleF };
    var gold = { x: found.anchors.gold.x * scaleF, y: found.anchors.gold.y * scaleF };
    var cx = red.x, redY = red.y, goldY = gold.y, gap = goldY - redY;

    used++;

    // ---- Process (x/N): "Process(x/N)" -> label digits + letter distractors ----
    var btn = L.findMaskedTextLine(raster,
      { x: cx + gap * 0.2, y: goldY + gap * 1.95, w: gap * 2.15, h: gap * 0.75 }, isWhite,
      { maxRowFill: 0.75, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.24), minRowPx: Math.max(4, Math.round(gap * 0.04)), accept: function (r) { return r.w >= gap * 0.5; } });
    if (btn && truth.state && truth.state.currentTurn != null && truth.state.maxTurns != null) {
      var grow = Math.round(btn.h * 0.45);
      var seg = segRect(raster, { x: btn.x - grow, y: btn.y - grow, w: btn.w + grow * 2, h: btn.h + grow * 2 }, isWhite);
      var x = truth.state.maxTurns - truth.state.currentTurn + 1;
      // letters of "Process" merge unpredictably, but the TAIL "( x / N )" segments
      // reliably — label just the last five boxes positionally
      var n = seg.boxes.length;
      if (n >= 7) {
        addInstance("(", seg.mask, seg.boxes[n - 5]);
        addInstance(String(x), seg.mask, seg.boxes[n - 4]);
        addInstance("/", seg.mask, seg.boxes[n - 3]);
        addInstance(String(truth.state.maxTurns), seg.mask, seg.boxes[n - 2]);
        addInstance(")", seg.mask, seg.boxes[n - 1]);
      }
    }

    // ---- footer cost row: "Processing Cost   900" — THE source of '0' glyphs ----
    // (nothing else in the closed vocabulary contains a zero; without it "10"/"12"
    // Astrogem Points can never template-read). The number is right-aligned and far
    // from the label, so: take the line's TRAILING box run after the last wide gap;
    // accept only when it has exactly the cost's digit count (900/450 — skip 1,800,
    // its comma merges unpredictably) and digit-ish aspects. The Balance row below
    // fails the count guard (7 digits + commas), "…1 time" fails the wide-gap guard.
    var costVal = truth.state && truth.state.processCost;
    if (costVal === 900 || costVal === 450) {
      var costDigits = String(costVal).split("");
      var bandTop = goldY + gap * 1.13;
      for (var rowI = 0; rowI < 2; rowI++) {
        var costLn = L.findMaskedTextLine(raster,
          { x: cx - gap * 2.3, y: bandTop, w: gap * 4.6, h: gap * 0.5 }, isWhite,
          { maxRowFill: 0.75, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.2), minRowPx: Math.max(3, Math.round(gap * 0.03)), accept: function (r) { return r.w >= gap * 0.8; } });
        if (!costLn) break;
        bandTop = costLn.y + costLn.h + 2;   // next iteration scans below this row
        var cgrow = Math.round(costLn.h * 0.45);
        var segC = segRect(raster, { x: costLn.x - cgrow, y: costLn.y - cgrow, w: costLn.w + cgrow * 2, h: costLn.h + cgrow * 2 }, isWhite);
        var bx = segC.boxes;
        if (bx.length < costDigits.length + 2) continue;
        var chs = bx.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
        var cmedH = chs.length ? chs[chs.length >> 1] : 0;
        // trailing run = boxes after the last gap wider than 1.5×medH
        var runStart = bx.length - 1;
        while (runStart > 0 && (bx[runStart].x - (bx[runStart - 1].x + bx[runStart - 1].w)) < cmedH * 1.5) runStart--;
        var run = bx.slice(runStart);
        var wideGapBefore = runStart > 0 &&
          (bx[runStart].x - (bx[runStart - 1].x + bx[runStart - 1].w)) >= cmedH * 1.5;
        var aspectsOk = run.every(function (b) { var a = b.w / Math.max(1, b.h); return a >= 0.25 && a <= 1.0; });
        if (wideGapBefore && run.length === costDigits.length && aspectsOk) {
          for (var cdi = 0; cdi < costDigits.length; cdi++) addInstance(costDigits[cdi], segC.mask, run[cdi]);
          break;   // harvested the cost row; don't scan further rows
        }
      }
    }

    // ---- points header: "N Astrogem Points" ----
    var cfg = truth.config || {};
    var pts = (cfg.willpowerLevel | 0) + (cfg.orderLevel | 0) + (cfg.effect1Level | 0) + (cfg.effect2Level | 0);
    var ptsRect = { x: cx - gap * 1.55, y: redY - gap * 1.23, w: gap * 3.1, h: gap * 0.26 };
    var segP = segRect(raster, ptsRect, isWhite);
    var digits = String(pts).split("");
    // label the LEADING digit run positionally when the box count is in the plausible
    // window for "N Astrogem Points" (digits + 8..16 letter boxes; bad merges change
    // the count and skip the sample). The letters feed the DISTRACTOR pool — without
    // them, "Astrogem" letters can pass as digits in the matcher.
    if (segP.boxes.length >= digits.length + 8 && segP.boxes.length <= digits.length + 16) {
      for (var b2 = 0; b2 < digits.length; b2++) addInstance(digits[b2], segP.mask, segP.boxes[b2]);
      var letters = ["A", "s", "t", "r", "o", "g", "e", "m"];
      for (var b3 = 0; b3 < Math.min(letters.length, segP.boxes.length - digits.length); b3++) {
        addInstance(letters[b3], segP.mask, segP.boxes[digits.length + b3]);
      }
    }

    // ---- wheel level lines (gold): W/E "Lv. N"; N node bare digit ----
    function levelLine(p) {
      return L.findMaskedTextLine(raster, { x: p.x - gap * 0.5, y: p.y - gap * 0.35, w: gap * 1.0, h: gap * 0.72 }, isGold, {
        rejectFill: 0.22, maxRowFill: 0.6, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.22), minRowPx: 3,
        accept: function (r) { var c = r.x + r.w / 2; return Math.abs(c - p.x) <= gap * 0.28 && r.w >= gap * 0.03 && r.w <= gap * 0.85; }
      });
    }
    var geo = L.wheelGeometry({ red: red, gold: gold });
    var wheelJobs = [
      { p: geo.nodeW, val: cfg.effect1Level, kind: "lv" },
      { p: geo.nodeE, val: cfg.effect2Level, kind: "lv" },
      { p: geo.nodeN, val: cfg.willpowerLevel, kind: "bare" }
    ];
    wheelJobs.forEach(function (j) {
      if (j.val == null) return;
      var line = levelLine(j.p);
      if (!line) return;
      var grow2 = Math.round(line.h * 0.5);
      var segL = segRect(raster, { x: line.x - grow2, y: line.y - grow2, w: line.w + grow2 * 2, h: line.h + grow2 * 2 }, isGold);
      // Gold level digits share the WHITE digit templates (same masked shape). Harvest
      // them as plain digit labels ONLY when the digit box is unambiguous, so we don't
      // poison the clean footer-digit templates with the diamond-tip mis-segmentation.
      if (j.kind === "bare") {
        if (segL.boxes.length === 1) addDigitInstance(String(j.val), segL.mask, segL.boxes[0]);
      } else {
        // "Lv. N": the digit is the RIGHTMOST box; only accept clean 3-4 box splits
        if (segL.boxes.length === 3 || segL.boxes.length === 4) {
          addDigitInstance(String(j.val), segL.mask, segL.boxes[segL.boxes.length - 1]);
          addInstance("L", segL.mask, segL.boxes[0]);
          addInstance("v", segL.mask, segL.boxes[1]);
        }
      }
    });

    // ---- outcome amount lines (chartreuse — same face as the gold wheel digits) ----
    var outs = truth.outcomes || [];
    var iconXs = geo.outIconXs, iconY = geo.outIconY;
    for (var oi = 0; oi < Math.min(4, outs.length); oi++) {
      var o = outs[oi];
      if (!o || (o.type !== "raise_effect" && o.type !== "lower_effect")) continue;
      var isLower = o.type === "lower_effect";
      var amtPred = isLower ? L.isRedAmountText : L.isAmountText;   // lowers render RED
      var capRect = { x: iconXs[oi] - gap * 0.44, y: iconY - gap * 0.16, w: gap * 0.88, h: gap * 0.52 };
      var amtLine = L.findMaskedTextLine(raster, capRect, amtPred, {
        rejectFill: isLower ? 0.3 : undefined,
        maxRowFill: 0.7, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.2), minRowPx: 3,
        accept: function (r) { var c = r.x + r.w / 2; return Math.abs(c - iconXs[oi]) <= gap * 0.24 && r.w >= gap * 0.04 && r.w <= gap * 0.6; }
      });
      if (!amtLine) continue;
      var ag = Math.round(amtLine.h * 0.5);
      var segA = segRect(raster, { x: amtLine.x, y: amtLine.y - ag, w: amtLine.w, h: amtLine.h + ag * 2 }, amtPred);
      // "+N"/"-N" = 2 boxes; "Lv. N" = 2-4 boxes; the digit is LAST either way (the
      // ▲/▼ is green/red-solid, outside the text masks' line bounds)
      if (segA.boxes.length >= 2 && segA.boxes.length <= 4) {
        addDigitInstance(String(o.amount || 1), segA.mask, segA.boxes[segA.boxes.length - 1]);
        if (segA.boxes.length === 2 && segA.boxes[0].w <= segA.boxes[1].w * 1.4) {
          // GEOMETRY guard (2026-07-28): "Lv." erodes to fragments that pass the
          // width test and flooded the sign classes — the '+' template averaged
          // into a serif-'1' (an 'L' sliver IS that shape) and real ones then
          // template-matched '+'. A true '+' is a small near-square cross and a
          // '−' a squat wide bar; an 'L' is digit-tall, a 'v.' blob mid-height.
          var sb = segA.boxes[0], db = segA.boxes[1];
          var sAsp = sb.w / Math.max(1, sb.h), sRelH = sb.h / Math.max(1, db.h);
          var signOk = isLower
            ? (sAsp >= 1.3 && sRelH <= 0.45)
            : (sAsp >= 0.6 && sAsp <= 1.15 && sRelH >= 0.4 && sRelH <= 0.8);
          if (signOk) addInstance(isLower ? "-" : "+", segA.mask, segA.boxes[0]);
        }
      }
    }

    // ---- reroll pill "n / m" (white) — model rerolls minus the paid one ----
    var st = truth.state || {};
    if (st.rerollsRemaining != null && st.rerollsRemaining >= 1 && !/charge/i.test(JSON.stringify(truth._note || ""))) {
      var pillRect = { x: geo.rerollPill.x - gap * 0.42, y: geo.rerollPill.y - gap * 0.14, w: gap * 0.84, h: gap * 0.28 };
      var segR = segRect(raster, pillRect, isWhite);
      var freeShown = st.rerollsRemaining - 1;
      var denom = st.maxTurns === 9 ? 2 : 1;
      if (freeShown <= denom && segR.boxes.length === 3) {
        addInstance(String(freeShown), segR.mask, segR.boxes[0]);
        addInstance("/", segR.mask, segR.boxes[1]);
        addInstance(String(denom), segR.mask, segR.boxes[2]);
      }
    }
  }

  // ---- purification (2026-07-28 round 2) ----
  // Pass 1: per-class mean bitmaps over ALL instances. Pass 2: an instance
  // whose similarity ranks ANOTHER class's mean above its own label — or whose
  // own-class similarity is junk-level — is dropped. One round is enough: the
  // leaks are a minority per class, so the initial means still point the right
  // way. Pass 3: averages rebuilt from survivors only.
  var SZ = L.GLYPH_W * L.GLYPH_H;
  function meansOf(insts) {
    var m = {};
    insts.forEach(function (it) {
      if (!m[it.ch]) m[it.ch] = { sum: new Float64Array(SZ), n: 0 };
      for (var i = 0; i < SZ; i++) m[it.ch].sum[i] += it.bm[i];
      m[it.ch].n++;
    });
    Object.keys(m).forEach(function (ch) {
      var a = m[ch], avg = new Float64Array(SZ);
      for (var i = 0; i < SZ; i++) avg[i] = a.sum[i] / a.n;
      m[ch] = { avg: avg, n: a.n };
    });
    return m;
  }
  function simTo(bm, avg) {
    var diff = 0;
    for (var i = 0; i < SZ; i++) diff += Math.abs(bm[i] - avg[i]);
    return 1 - diff / SZ;
  }
  // Purify PER BAND (native and ×2 strokes are different shapes — pooled means
  // mixed them and legit digits got ejected against their own blurred average),
  // two iterations (survivor means re-seed the second pass). A band class with
  // too few instances borrows the all-band mean as its seed.
  var dropped = {}, kept = INSTANCES;
  for (var round = 0; round < 2; round++) {
    var allMeans = meansOf(kept);
    var bandMeans = {
      n: meansOf(kept.filter(function (it) { return it.band === "n"; })),
      u2: meansOf(kept.filter(function (it) { return it.band === "u2"; })),
      u3: meansOf(kept.filter(function (it) { return it.band === "u3"; }))
    };
    dropped = {};
    var next = [];
    kept.forEach(function (it) {
      var m = bandMeans[it.band];
      function seed(ch) {
        var bm2 = m[ch];
        return (bm2 && bm2.n >= 4) ? bm2.avg : (allMeans[ch] && allMeans[ch].avg);
      }
      var ownAvg = seed(it.ch);
      if (!ownAvg) { dropped[it.ch] = (dropped[it.ch] || 0) + 1; return; }
      var own = simTo(it.bm, ownAvg), bestCh = it.ch, best = own;
      Object.keys(allMeans).forEach(function (ch) {
        if (ch === it.ch) return;
        var av = seed(ch);
        if (!av) return;
        var s = simTo(it.bm, av);
        if (s > best) { best = s; bestCh = ch; }
      });
      if (bestCh !== it.ch || own < 0.55) dropped[it.ch] = (dropped[it.ch] || 0) + 1;
      else next.push(it);
    });
    kept = next;
  }
  console.log("purify: dropped(last round) " + Object.keys(dropped).sort().map(function (c) { return c + ":" + dropped[c]; }).join(" ") +
    "  (kept " + kept.length + "/" + INSTANCES.length + ")");

  // ---- emit ----
  function bakeAtlas(insts, minN) {
    var m = meansOf(insts), out = {};
    Object.keys(m).sort().forEach(function (ch) {
      if (m[ch].n < (minN || 1)) return;   // too few instances for a stable average
      var bits = [];
      for (var i = 0; i < SZ; i++) bits.push(m[ch].avg[i] >= 0.5 ? 1 : 0);
      out[ch] = bits;
    });
    return out;
  }
  var atlas = bakeAtlas(kept, 1);
  // band templates need >=10 surviving instances: a thin band template SHADOWS
  // the (better-fed) pooled one at parse time, and thin-class native overlays
  // measurably broke native amount/level reads (outcome silents at 0.85 on
  // legacy boards). Under the floor, the band falls back to pooled.
  var bands = {
    n: bakeAtlas(kept.filter(function (it) { return it.band === "n"; }), 10),
    u2: bakeAtlas(kept.filter(function (it) { return it.band === "u2"; }), 10),
    u3: bakeAtlas(kept.filter(function (it) { return it.band === "u3"; }), 10)
  };
  function countsOf(insts) {
    var c = {};
    insts.forEach(function (it) { c[it.ch] = (c[it.ch] || 0) + 1; });
    return Object.keys(c).sort().map(function (ch) { return ch + ":" + c[ch]; }).join("  ");
  }
  var counts = countsOf(kept);
  var body = "/**\n * ocr/glyphs.js — GENERATED by tools/build-glyphs.js (do not hand-edit).\n" +
    " * Binary " + L.GLYPH_W + "x" + L.GLYPH_H + " templates of the game's own glyphs, harvested from the labeled\n" +
    " * corpus at the engine's canonical scale. Digit keys '0'-'9' cover ALL fonts —\n" +
    " * gold wheel digits chroma-mask to the same silhouettes as the white footer\n" +
    " * ones. Letters/signs are DISTRACTOR classes for rejection.\n" +
    " * GLYPH_BANDS: per-resolution-band variants keyed by the engine's own\n" +
    " * normalization factor (n = native/downscale, u2 = ×2 upscale, u3 = ×3);\n" +
    " * ×2-fattened strokes average into different silhouettes than native ones,\n" +
    " * and the engine overlays its band onto the pooled atlas at parse time.\n" +
    " * Provenance: harvested " + new Date().toISOString().slice(0, 10) + " from " + used + " labeled samples (holdout\n" +
    " * djb2%5==0 excluded: " + held + " samples; rule mirrored in build-level-refs.js);\n" +
    " * label-noise purification kept " + kept.length + "/" + INSTANCES.length + " instances.\n" +
    " * Instances per class (pooled, post-purify): " + counts + "\n" +
    " * Band instances: n[" + countsOf(kept.filter(function (it) { return it.band === "n"; })) + "]\n" +
    " *   u2[" + countsOf(kept.filter(function (it) { return it.band === "u2"; })) + "]\n" +
    " *   u3[" + countsOf(kept.filter(function (it) { return it.band === "u3"; })) + "]\n */\n" +
    "(function (root) {\n  \"use strict\";\n  var GLYPH_ATLAS = " + JSON.stringify(atlas) + ";\n" +
    "  var GLYPH_BANDS = " + JSON.stringify(bands) + ";\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = { GLYPH_ATLAS: GLYPH_ATLAS, GLYPH_BANDS: GLYPH_BANDS };\n" +
    "  else root.OcrGlyphs = { GLYPH_ATLAS: GLYPH_ATLAS, GLYPH_BANDS: GLYPH_BANDS };\n})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(OUT, body);
  console.log("samples used: " + used + "   holdout skipped: " + held);
  console.log("classes: " + Object.keys(atlas).length +
    "  bands n/u2/u3: " + Object.keys(bands.n).length + "/" + Object.keys(bands.u2).length + "/" + Object.keys(bands.u3).length);
  console.log("instances: " + counts);
  console.log("wrote " + OUT);
})().catch(function (e) { console.error(e); process.exit(1); });
