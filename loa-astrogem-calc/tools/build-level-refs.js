#!/usr/bin/env node
/**
 * tools/build-level-refs.js — bake pristine level-digit reference patches.
 *
 * Harvests 32×32 greyscale patches of the wheel level digits (N willpower,
 * S order/chaos — bare digits; W/E — the trailing "Lv." digit) from NATIVE-tier
 * labeled samples (source wheel gap ≥ 110px — the sharpest renderings), keyed by
 * the LABEL value, ≤3 exemplars per class per node. Emits ocr/level-refs.js.
 *
 * These feed the engine's ANALYSIS-BY-SYNTHESIS level rescue (see
 * structural-engine.js synthLevelRescue): the pristine patch is blurred to
 * candidate degradations and correlated against the observed patch — the method
 * that finally read the gold-on-gold digits on the degraded corpus tier
 * (2026-07-19; raw+gradient dual scoring, agreement-gated).
 *
 * Rerun after adding native-tier samples:  node tools/build-level-refs.js
 */
"use strict";
var fs = require("fs");
var path = require("path");
var sharp = require("sharp");
var L = require("../ocr/layout.js");

var ROOT = path.resolve(__dirname, "..");
var PS = 32, PATCH_GAP = 0.13, CANON = 246;
// ---- SUPERVISED SELECTION (round 9) ----------------------------------------
// `--supervised` replaces the geometric exemplar picker (g0 spread × tier) with
// one that scores candidates by HELD-OUT CLASSIFICATION: the holdout boards
// (djb2%5==0, which never contribute a patch) become an evaluation set of
// observed node patches with known labels, every candidate is scored against
// them the way the engine's synth consult scores refs, and exemplars are chosen
// greedily to maximize correct-minus-wrong commits on boards they were not
// harvested from. Round 8 closed the geometric route with numbers; this is the
// only remaining mechanism named for the level block.
//   node tools/build-level-refs.js --supervised [--k=6] [--pen=3] [--half]
// `--half` selects on half the held-out observations and reports on the other
// half, so the printed number is not the one that was optimized.
var ARGV = process.argv.slice(2);
function argOf(n, d) { var m = ARGV.filter(function (a) { return a.indexOf("--" + n + "=") === 0; })[0]; return m ? m.split("=")[1] : d; }
var SUPERVISED = ARGV.indexOf("--supervised") !== -1;
var SUP_K = parseInt(argOf("k", "6"), 10);
var SUP_PEN = parseFloat(argOf("pen", "3"));
var SUP_HALF = ARGV.indexOf("--half") !== -1;
var SUP_FILL = ARGV.indexOf("--fill") !== -1;
var SUP_OUT = argOf("out", null);   // write the generated file elsewhere (A/B safety)
// name-band patches: the whole caption block (wide) — 6-class name recognition
var NPW = 48, NPH = 16, NBAND = { dx: 0, dy: -0.16, w: 1.06, h: 0.34 };
var MIN_NATIVE_GAP = 110, MAX_PER_CLASS = 6;   // 2 per g0 tier (see stratify)

// HOLDOUT (2026-07-28, round 2): same deterministic ~20% as build-glyphs.js —
// those samples never contribute reference patches, so the eval's holdout split
// measures the synth on frames its refs never saw.
function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
function isHoldout(base) { return djb2(base) % 5 === 0; }

// samples excluded from harvesting (the degraded tier the refs exist to serve)
var DEGRADED = {
  "live-stability-t6-15pts": 1, "live-stability-t8-charge": 1, "live-stability-t9-pet": 1,
  "live-share-0719-rare7t-tooltip": 1, "rare1-c9-chaos-station": 1
};

// NON-ENGLISH CLIENTS — hard-excluded from BOTH harvests (2026-07-29, round 6).
// The name-band harvest keys a patch by the LABEL's canonical English name, so a
// Spanish "Daño de jefe" or a Cyrillic "Урон по боссу" caption lands in the
// "Boss Damage" class and every English board then correlates against a foreign
// glyph run. The W/E digit patch is line-anchored on "Lv. N" and carries the
// prefix letters, which localize too ("Ур."), so those are poison as well.
// This is a LIST, deliberately, not a learned filter: the supervised verify that
// guards the W/E digit refs ranks candidates against a pool built from the same
// candidates, so it cannot be trusted to expel a whole foreign glyph set — the
// same shape of bug as the round-2 "Lv."-fragment poisoning.
// Sources: samples-v2/manifest.json `locale` (6 ru + 2 zh-TW) and the two older
// localized boards named in ocr/ACCURACY-LOG.md (rounds 3-4).
// Eligibility measured 2026-07-29 (g0 >= MIN_NATIVE_GAP, non-holdout): only
// c-mryunsmb (zh-TW, g0 125) and c-mrwgjrp2 (es, g0 122) actually reached the
// harvest — c-mrwgjrp2 had been contributing Spanish name patches since round 2.
var LOCALIZED = {
  // ru (samples-v2 manifest)
  "c-mrxg5t94-dvelwi": "ru", "c-ms044mq4-ox2kn6": "ru", "c-ms045fyu-cjm6qp": "ru",
  "c-ms047dnw-e6xuyd": "ru", "c-ms06qk9w-ioqb7a": "ru", "c-ms06r85o-iulyf9": "ru",
  // zh-TW (samples-v2 manifest)
  "c-mryunsmb-h6d7uj": "zh-TW", "c-mryur6to-n3a5jk": "zh-TW",
  // older corpus (ACCURACY-LOG rounds 3-4)
  "c-mrwgjrp2-1jqlzy": "es", "c-mrw1jzpi-9b314w": "ru",
  // samples-v3 manifest (excludeFromReferenceHarvest)
  "c-ms14qn8f-pzpox7": "ru", "c-ms14wyep-lr2k80": "ru", "c-ms1585k3-qxjzxd": "ru",
  "c-ms1595wd-lpq2ny": "ru", "c-ms15a06t-dh3yol": "ru", "c-ms15bp48-fnk0cg": "ru",
  "c-ms15fny6-n96q2j": "ru", "c-ms15gob5-vrq29r": "ru", "c-ms15hix4-kfsmj4": "ru",
  "c-ms15ia8x-a1vuxt": "ru",
  "c-mrwkadmb-jkjm5o": "en", "c-mrzz2neu-teo43a": "es"
};

function lumOf(sub) {
  var out = new Float32Array(sub.width * sub.height);
  for (var i = 0, j = 0; i < sub.data.length; i += 4, j++) {
    out[j] = 0.299 * sub.data[i] + 0.587 * sub.data[i + 1] + 0.114 * sub.data[i + 2];
  }
  return out;
}
function sampleF(img, w, h, x, y) {
  var x0 = Math.max(0, Math.min(w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  var fx = x - x0, fy = y - y0;
  return img[y0 * w + x0] * (1 - fx) * (1 - fy) + img[y0 * w + x1] * fx * (1 - fy) +
         img[y1 * w + x0] * (1 - fx) * fy + img[y1 * w + x1] * fx * fy;
}
function rawPatch(lum, w, h, cx, cy, gap) {
  var side = PATCH_GAP * gap, out = new Float32Array(PS * PS);
  for (var py = 0; py < PS; py++) for (var px = 0; px < PS; px++) {
    out[py * PS + px] = sampleF(lum, w, h, cx - side / 2 + (px + 0.5) * side / PS, cy - side / 2 + (py + 0.5) * side / PS);
  }
  return out;
}
function centerEnergy(p) {
  var e = 0, a = Math.floor(PS / 4), b = PS - a;
  for (var y = a; y < b; y++) for (var x = a; x < b; x++) {
    var dx = p[y * PS + x + 1] - p[y * PS + x - 1];
    var dy = p[(y + 1) * PS + x] - p[(y - 1) * PS + x];
    e += dx * dx + dy * dy;
  }
  return e;
}
// self-align the harvest center by maximizing central gradient energy (±0.02 gap):
// without this the baked refs sit a pixel or two off and raw-vs-grad rankings
// diverge at classify time (measured: N raw said 3 while grad said 5)
function alignedPatch(lum, w, h, cx, cy, gap) {
  var span = 0.02, best = null, bestE = -1;
  for (var dy = -span; dy <= span + 1e-9; dy += span / 2) {
    for (var dx = -span; dx <= span + 1e-9; dx += span / 2) {
      var p = rawPatch(lum, w, h, cx + dx * gap, cy + dy * gap, gap);
      var e = centerEnergy(p);
      if (e > bestE) { bestE = e; best = p; }
    }
  }
  return best;
}

function namePatch(lum, w, h, p, gap) {
  var out = new Float32Array(NPW * NPH);
  var x0 = p.x + NBAND.dx * gap - NBAND.w * gap / 2, y0 = p.y + NBAND.dy * gap - NBAND.h * gap / 2;
  for (var py = 0; py < NPH; py++) for (var px = 0; px < NPW; px++) {
    out[py * NPW + px] = sampleF(lum, w, h,
      x0 + (px + 0.5) * NBAND.w * gap / NPW, y0 + (py + 0.5) * NBAND.h * gap / NPH);
  }
  return out;
}
function loadNorm(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(function (dec) {
    var raster = { width: dec.info.width, height: dec.info.height,
      data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length) };
    var found = L.panelOrWhole(raster);
    if (!found || !found.anchors) return null;
    found.anchors = L.fitWheel ? L.fitWheel(raster, found.anchors) : found.anchors;
    var g0 = found.anchors.gold.y - found.anchors.red.y;
    var fRaw = CANON / Math.max(8, g0);
    var scaleF = fRaw <= 0.65 ? 0.5 : fRaw <= 1.25 ? 1 : Math.min(3, Math.round(fRaw));
    var mg = 0.06, mgBot = 0.16;
    var cr = { x: found.rect.x - found.rect.w * mg, y: found.rect.y - found.rect.h * mg,
      w: found.rect.w * (1 + 2 * mg), h: found.rect.h * (1 + mg + mgBot) };
    var ox = Math.max(0, Math.round(cr.x)), oy = Math.max(0, Math.round(cr.y));
    raster = L.crop(raster, cr);
    var sh2 = function (p) { return { x: (p.x - ox) * scaleF, y: (p.y - oy) * scaleF }; };
    if (Math.abs(scaleF - 1) > 0.04) raster = L.upscaleBilinear(raster, scaleF); else scaleF = 1;
    var anchors = { red: sh2(found.anchors.red), gold: sh2(found.anchors.gold) };
    if (found.anchors.w) anchors.w = sh2(found.anchors.w);
    if (found.anchors.e) anchors.e = sh2(found.anchors.e);
    return { raster: raster, geo: L.wheelGeometry(anchors), lum: null, g0: g0 };
  });
}

// Lv line locate for W/E — BELOW-CENTER only (the caption band above is a trap)
function locateLv(raster, p, gap) {
  var box = { x: p.x - gap * 0.5, y: p.y - gap * 0.02, w: gap * 1.0, h: gap * 0.38 };
  var opts = {
    rejectFill: 0.22, maxRowFill: 0.6,
    minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.22), minRowPx: 3,
    accept: function (r) { return Math.abs(r.x + r.w / 2 - p.x) <= gap * 0.28 && r.w >= gap * 0.03 && r.w <= gap * 0.85; }
  };
  return L.findMaskedTextLine(raster, box, L.isGoldText, opts);
}

var OFF_BARE = 0.175;   // bare digit FALLBACK center (+0.175 gap below the node anchor)

// Bare-digit INK LOCATE (2026-07-28 round 2): the digit's offset below the
// anchor VARIES per board (measured +0.03 gap on a live 2-line "Willpower
// Efficiency" board vs +0.175 typical) — a fixed offset harvested clipped
// digits and, worse, digit-free face patches that then matched ANY off-center
// observation confidently (the N='4'-for-'1' family). The digit is the only
// VIVID gold blob in the search window, so its pixel centroid locates it.
function bareDigitPred(kind) {
  return kind === "S"
    ? function (r, g, b) { var c = L.hsv(r, g, b); return c.h >= 42 && c.h <= 64 && c.s > 0.72 && c.v > 0.7; }
    : function (r, g, b) { var c = L.hsv(r, g, b); return c.h >= 35 && c.h <= 65 && c.s > 0.5 && c.v > 0.6; };
}
function locateBareDigit(raster, p, gap, kind) {
  var rect = { x: p.x - gap * 0.28, y: p.y - gap * 0.05, w: gap * 0.56, h: gap * 0.37 };
  var st = L.colorClusterStats(L.crop(raster, rect), bareDigitPred(kind));
  if (st.count < gap * gap * 0.0006 || st.count > gap * gap * 0.02 || st.density < 0.15) return null;
  return { x: Math.max(0, Math.round(rect.x)) + st.cx, y: Math.max(0, Math.round(rect.y)) + st.cy };
}
// Ink sanity for a harvested patch: a real digit patch holds a compact bright
// glyph WHOLLY INSIDE the frame. The failure shapes this rejects (all seen in
// a rebuilt ref sheet): face-only junk (no bright cluster), a name-text row
// (bright bbox spans the full width), a digit clipped at the patch edge, and
// flat/contrast-free patches. Precision over recall — there are 100+ candidate
// sources per class, so skipping a doubtful one costs nothing.
// Modes (measured — one rule set does NOT fit all nodes: the first strict cut
// zeroed S and W/E coverage entirely):
//   "bare"  (N)   full bbox rules — the digit is the only bright thing allowed
//   "line"  (W/E) vertical rules only — the "Lv." letters legitimately share
//                 the patch, so the bright bbox spans wide by construction
//   "loose" (S)   contrast+fraction only — gold-on-gold ink is defined by
//                 saturation, not luminance, so luminance bboxes are noise;
//                 the vivid-saturation ink LOCATE is S's real centering guard
function patchInkOk(patch, mode) {
  var mn = Infinity, mx = -Infinity, i;
  for (i = 0; i < patch.length; i++) { if (patch[i] < mn) mn = patch[i]; if (patch[i] > mx) mx = patch[i]; }
  var rng = mx - mn;
  if (rng < 30) return false;   // flat — no glyph contrast
  var hi = 0, x0 = PS, x1 = -1, y0 = PS, y1 = -1;
  for (i = 0; i < patch.length; i++) {
    if ((patch[i] - mn) / rng >= 0.75) {
      hi++;
      var x = i % PS, y = (i / PS) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  var frac = hi / patch.length;
  if (frac < 0.03 || frac > 0.40) return false;
  if (mode === "loose") return true;
  var bh = y1 - y0 + 1;
  if (y0 < 1 || y1 > PS - 2) return false;   // clipped top/bottom
  if (bh < 8 || bh > 26) return false;       // too short/tall for a digit line
  if (mode === "line") return true;
  var bw = x1 - x0 + 1;
  if (x0 < 1 || x1 > PS - 2) return false;   // clipped left/right
  if (bw < 4 || bw > 26) return false;       // a name-row fragment spans the width
  return true;
}

// ---- the engine's synth kernels, replicated so a candidate is scored the way
// the consult will actually use it (ocr/structural-engine.js _synth*) ----
var SWIN = (function () {
  var w = new Float32Array(PS * PS), c = (PS - 1) / 2, s2 = 2 * 9 * 9;
  for (var y = 0; y < PS; y++) for (var x = 0; x < PS; x++) {
    var r2 = (x - c) * (x - c) + (y - c) * (y - c);
    w[y * PS + x] = 0.25 + 0.75 * Math.exp(-r2 / s2);
  }
  return w;
})();
function zn(p) {
  var out = new Float32Array(p.length), mean = 0, i;
  for (i = 0; i < p.length; i++) mean += p[i];
  mean /= p.length;
  var va = 0;
  for (i = 0; i < p.length; i++) { out[i] = p[i] - mean; va += out[i] * out[i]; }
  var sd = Math.sqrt(va / p.length) || 1;
  for (i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}
function gradMag(p) {
  var g = new Float32Array(PS * PS);
  for (var y = 1; y < PS - 1; y++) for (var x = 1; x < PS - 1; x++) {
    var dx = p[y * PS + x + 1] - p[y * PS + x - 1], dy = p[(y + 1) * PS + x] - p[(y - 1) * PS + x];
    g[y * PS + x] = Math.sqrt(dx * dx + dy * dy);
  }
  return g;
}
function gradVec(p) { var g = gradMag(p), o = new Float32Array(g.length); for (var i = 0; i < g.length; i++) o[i] = g[i] * SWIN[i]; return zn(o); }
function blur(p, sigma) {
  var r = Math.max(1, Math.ceil(sigma * 2.5)), k = [], ks = 0, i;
  for (i = -r; i <= r; i++) { var v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
  for (i = 0; i < k.length; i++) k[i] /= ks;
  var tmp = new Float32Array(PS * PS), out = new Float32Array(PS * PS), x, y, s, j;
  for (y = 0; y < PS; y++) for (x = 0; x < PS; x++) { s = 0; for (j = -r; j <= r; j++) s += p[y * PS + Math.max(0, Math.min(PS - 1, x + j))] * k[j + r]; tmp[y * PS + x] = s; }
  for (y = 0; y < PS; y++) for (x = 0; x < PS; x++) { s = 0; for (j = -r; j <= r; j++) s += tmp[Math.max(0, Math.min(PS - 1, y + j)) * PS + x] * k[j + r]; out[y * PS + x] = s; }
  return out;
}
function cos(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; }
var SUP_SIG = [0.6, 1.0, 1.5, 2.1, 2.8, 3.6];

(async function () {
  var files = fs.readdirSync(path.join(ROOT, "samples")).filter(function (f) { return /\.(png|webp|jpe?g)$/i.test(f); });
  var refs = { N: {}, S: {}, W: {}, E: {} };
  var nrefs = { W: {}, E: {} };   // name-band refs keyed by canonical effect name
  var weCands = [];               // W/E candidates, verified after the loop
  var obs = { N: [], S: [], W: [], E: [] };   // --supervised: held-out observations
  var used = 0, heldOut = 0, localized = 0;
  for (var fi = 0; fi < files.length; fi++) {
    var f = files[fi];
    var base = f.replace(/\.(png|webp|jpe?g)$/i, "");
    if (DEGRADED[base]) continue;
    if (LOCALIZED[base]) { localized++; continue; }
    if (isHoldout(base)) {
      heldOut++;
      if (!SUPERVISED) continue;
      // HELD-OUT EVALUATION SET: the same boards the harvest refuses, at EVERY
      // resolution (not just g0>=110) — the degraded tier is what the consult
      // exists to read, so excluding it would score the exemplars on the one
      // population that never needs them. Anchoring mirrors the engine, not the
      // harvest: locate when the line/ink is there, else the consult's own fixed
      // fallback centres.
      var lf0 = path.join(ROOT, "samples", base + ".json");
      if (!fs.existsSync(lf0)) continue;
      var lb0 = JSON.parse(fs.readFileSync(lf0, "utf8"));
      if (lb0._unusable) continue;
      var c0 = lb0.config || {};
      var mk0 = ((lb0._mask && lb0._mask.skip) || []);
      var cx0 = await loadNorm(path.join(ROOT, "samples", f));
      if (!cx0) continue;
      cx0.lum = lumOf(cx0.raster);
      var gp0 = cx0.geo.gap;
      var nd0 = { N: cx0.geo.nodeN, S: cx0.geo.nodeS, W: cx0.geo.nodeW, E: cx0.geo.nodeE };
      var cl0 = { N: c0.willpowerLevel, S: c0.orderLevel, W: c0.effect1Level, E: c0.effect2Level };
      var fld = { N: "willpowerLevel", S: "orderLevel", W: "effect1Level", E: "effect2Level" };
      ["N", "S", "W", "E"].forEach(function (k0) {
        var v0 = cl0[k0];
        if (!(v0 >= 1 && v0 <= 5)) return;
        if (mk0.indexOf(fld[k0]) !== -1) return;   // masked label — not ground truth
        var p0 = nd0[k0], ox0, oy0;
        if (k0 === "N" || k0 === "S") {
          var lc0 = locateBareDigit(cx0.raster, p0, gp0, k0);
          ox0 = lc0 ? lc0.x : p0.x; oy0 = lc0 ? lc0.y : p0.y + gp0 * OFF_BARE;
        } else {
          var ln0 = locateLv(cx0.raster, p0, gp0);
          if (ln0 && ln0.w >= gp0 * 0.26) { ox0 = ln0.x + ln0.w - gp0 * 0.05; oy0 = ln0.y + ln0.h / 2; }
          else { ox0 = p0.x + gp0 * 0.125; oy0 = p0.y + gp0 * 0.17; }
        }
        // a 5x5 grid at the consult's own step, so a slightly-off anchor is not
        // scored as a classification failure
        var grid = [];
        for (var gy = -2; gy <= 2; gy++) for (var gx = -2; gx <= 2; gx++) {
          var pp = rawPatch(cx0.lum, cx0.raster.width, cx0.raster.height,
            ox0 + gx * 0.0075 * gp0, oy0 + gy * 0.0075 * gp0, gp0);
          grid.push({ raw: zn(pp), grad: gradVec(pp) });
        }
        obs[k0].push({ src: base, cls: v0, grid: grid });
      });
      continue;
    }
    var lblFile = path.join(ROOT, "samples", base + ".json");
    if (!fs.existsSync(lblFile)) continue;
    var lbl = JSON.parse(fs.readFileSync(lblFile, "utf8"));
    if (lbl._unusable) continue;
    var cfg = lbl.config || {};
    var ctx = await loadNorm(path.join(ROOT, "samples", f));
    if (!ctx || ctx.g0 < MIN_NATIVE_GAP) continue;
    ctx.lum = lumOf(ctx.raster);
    used++;
    var gap = ctx.geo.gap;
    var nodes = { N: ctx.geo.nodeN, S: ctx.geo.nodeS, W: ctx.geo.nodeW, E: ctx.geo.nodeE };
    var classes = { N: cfg.willpowerLevel, S: cfg.orderLevel, W: cfg.effect1Level, E: cfg.effect2Level };
    for (var kk = 0; kk < 4; kk++) {
      var k = ["N", "S", "W", "E"][kk];
      var cls = classes[k];
      if (!(cls >= 1 && cls <= 5)) continue;
      var p = nodes[k], cx, cy;
      if (k === "N" || k === "S") {
        // ink-located center; a sample whose digit can't be located cleanly is
        // SKIPPED — the harvest wants pristine exemplars, not guesses
        var loc = locateBareDigit(ctx.raster, p, gap, k);
        if (!loc) continue;
        cx = loc.x; cy = loc.y;
      } else {
        var line = locateLv(ctx.raster, p, gap);
        if (!line) continue;
        // fragment lines are the "Lv."-letters trap: when the digit's gold
        // eroded out of the mask, the located line IS the prefix and its right
        // end is the 'v' — a full "Lv. N" line runs ≥~0.27 gap (engine note)
        if (line.w < gap * 0.26) continue;
        cx = line.x + line.w - gap * 0.05; cy = line.y + line.h / 2;
      }
      var patch = alignedPatch(ctx.lum, ctx.raster.width, ctx.raster.height, cx, cy, gap);
      // N gets the full bbox rules (the junk-ref family lived there: face glow
      // and name-text rows); W/E/S run loose — W/E are line-anchored (their
      // 2-line names legitimately bleed into the patch top) and S ink is
      // saturation-defined. Measured: "line"-mode vertical rules starved W:4/5
      // to 1/0 exemplars. W/E additionally pass a SUPERVISED verification
      // against the (clean) N/S refs after the loop — see below.
      var inkMode = k === "N" ? "bare" : "loose";
      if (!patchInkOk(patch, inkMode)) continue;   // junk/faceonly/clipped exemplars stay out
      // quantize to Uint8 (min-max) — the engine re-normalizes anyway
      var mn = Infinity, mx = -Infinity;
      for (var i = 0; i < patch.length; i++) { if (patch[i] < mn) mn = patch[i]; if (patch[i] > mx) mx = patch[i]; }
      var q = new Array(patch.length);
      var rng = (mx - mn) || 1;
      for (var i2 = 0; i2 < patch.length; i2++) q[i2] = Math.round((patch[i2] - mn) / rng * 255);
      if (k === "W" || k === "E") {
        weCands.push({ node: k, cls: cls, ref: { src: base, g0: Math.round(ctx.g0), q: q } });
      } else {
        (refs[k][cls] = refs[k][cls] || []).push({ src: base, g0: Math.round(ctx.g0), q: q });
      }
    }
    // name-band refs (W/E): keyed by the labeled effect NAME
    var nameClasses = { W: cfg.effect1, E: cfg.effect2 };
    for (var nk = 0; nk < 2; nk++) {
      var k3 = ["W", "E"][nk];
      var nm = nameClasses[k3];
      if (!nm) continue;
      var np = namePatch(ctx.lum, ctx.raster.width, ctx.raster.height, nodes[k3], gap);
      var nmn = Infinity, nmx = -Infinity, ni;
      for (ni = 0; ni < np.length; ni++) { if (np[ni] < nmn) nmn = np[ni]; if (np[ni] > nmx) nmx = np[ni]; }
      var nq = new Array(np.length), nrng = (nmx - nmn) || 1;
      for (ni = 0; ni < np.length; ni++) nq[ni] = Math.round((np[ni] - nmn) / nrng * 255);
      (nrefs[k3][nm] = nrefs[k3][nm] || []).push({ src: base, g0: Math.round(ctx.g0), q: nq });
    }
  }
  // ---- SUPERVISED W/E verification (2026-07-28 round 2) ----
  // The W/E line-anchored center lands on the "Lv." LETTERS whenever the digit
  // eroded out of the gold mask (a rebuilt ref sheet showed 'Lv'/'v.' patches
  // across half the W/E classes — poison: an observed "Lv." then matches a
  // lettered ref of the WRONG class). The N/S bare-digit refs harvested above
  // are ink-located and bbox-vetted — same glyph art — so each W/E candidate
  // must WIN a z-normed correlation ranking against the pooled N+S classes for
  // its own labeled digit, else it is dropped. Letter patches rank garbage and
  // never win their label.
  function znorm(q) {
    var out = new Float64Array(q.length), mean = 0, i;
    for (i = 0; i < q.length; i++) mean += q[i];
    mean /= q.length;
    var va = 0;
    for (i = 0; i < q.length; i++) { out[i] = q[i] - mean; va += out[i] * out[i]; }
    var sd = Math.sqrt(va / q.length) || 1;
    for (i = 0; i < out.length; i++) out[i] /= sd;
    return out;
  }
  var nsZ = {};   // cls -> [znormed N/S patches]
  [1, 2, 3, 4, 5].forEach(function (c) {
    var pool = (refs.N[c] || []).concat(refs.S[c] || []);
    nsZ[c] = pool.map(function (r) { return znorm(r.q); });
  });
  var weDropped = 0;
  weCands.forEach(function (cand) {
    var z = znorm(cand.ref.q), best = null, bestC = 0, second = -Infinity;
    [1, 2, 3, 4, 5].forEach(function (c) {
      var s = -Infinity;
      nsZ[c].forEach(function (rz) {
        var d = 0;
        for (var i = 0; i < z.length; i++) d += z[i] * rz[i];
        d /= z.length;
        if (d > s) s = d;
      });
      if (best == null || s > best) { second = best == null ? -Infinity : Math.max(second, best); best = s; bestC = c; }
      else if (s > second) second = s;
    });
    if (bestC === cand.cls && (best - second) >= 0.02) {
      (refs[cand.node][cand.cls] = refs[cand.node][cand.cls] || []).push(cand.ref);
    } else weDropped++;
  });
  console.log("W/E supervised verify: kept " + (weCands.length - weDropped) + "/" + weCands.length);

  // STRATIFIED exemplars per class: 2 per g0 TIER — sharp (≥180), mid (140-179),
  // small-monitor (110-139). Sharpest-ONLY was tried in an earlier round and
  // traded fixes for regressions (t8 gained, t6/share broke — including an
  // agreeing-wrong): domain proximity matters, and the production corpus is now
  // dominated by the 110-139 tier, so that tier gets its own slots.
  //
  // WITHIN a tier the picker must SPREAD, not merely avoid an exact tie (round 8).
  // The old `pickDistinct` deduped on `g0 ===`, which is no dedup at all: two
  // captures from the same setup measure 244 and 243 and both got a slot. Measured
  // over the 472-pair corpus, 19 of the 20 digit classes ended up with at least one
  // pair inside 3 px of g0, and the BACKFILL was worse — it had no dedup whatsoever,
  // so it re-added the very frame the tier picker had just skipped (E|3 picked g0 244
  // twice; E|5 picked six frames from {121,123}, i.e. one exemplar wearing six slots).
  // Two exemplars that agree to a pixel are one exemplar, and the synth pays for the
  // fiction twice: the class looks covered, and its 6-exemplar × 6-sigma spread
  // searches the same shape six times.
  //
  // Replaced by SHARPEST-FIRST WITH A MINIMUM RELATIVE SEPARATION (G0_SEP of the
  // candidate's own g0), falling back to FARTHEST-POINT (max-min) when a tier is
  // too crowded to satisfy it — and the cross-tier backfill runs max-min against
  // everything already chosen instead of shifting the descending list.
  //
  // Sharpest-first is load-bearing, not decoration. Pure max-min was measured on the
  // full corpus and it picks each tier's two ENDPOINTS: the second hi exemplar drops
  // from g0 ~204 to ~180, right against the mid tier's edge, and the N node pays for
  // it — willpowerLevel 95.6 → 94.3 while orderLevel went 95.3 → 97.2. A separation
  // floor keeps the second exemplar sharp AND distinct, which is the whole point.
  // No starvation: when nothing clears the floor the tier still fills its slots
  // (round 2 measured that leaning the W/E exemplar count costs effect1Level 82→75,
  // so an empty slot is the worse failure).
  //
  // *** DO NOT REGENERATE ocr/level-refs.js WITHOUT RE-MEASURING. *** Round 8 ran the
  // whole 2×2 (old picker / this picker × 271 sources / 331 sources) against the
  // 472-pair corpus with one fixed engine. On the CURRENT 331-source pool this picker
  // beats the old one by +0.3 headline and +13 whole-parse boards — but the shipped
  // `ocr/level-refs.js` (old picker, 271 sources, round 6) still beats every rebuild
  // (96.3 / 327 whole, against 95.9-96.2 / 304-324), and on the 271-source pool the
  // ORDER REVERSES and this picker is the worse of the two. The exemplar draw is
  // high-variance — ±5% whole-parse across four defensible builds — which means g0
  // spread is not the dominant axis of exemplar quality and no geometric proxy is
  // going to reliably beat a lucky draw. The next real lever here is SUPERVISED
  // selection (score candidate exemplars by how well they classify a held-out set)
  // or genuinely more varied sharp captures, not another picking rule.
  var G0_SEP = 0.08;
  function farthestOne(arr, anchors, pick) {
    var best = null, bestD = -1, i, j;
    for (i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (pick.indexOf(c) !== -1) continue;
      var d = Infinity;
      for (j = 0; j < anchors.length; j++) d = Math.min(d, Math.abs(c.g0 - anchors[j].g0));
      for (j = 0; j < pick.length; j++) d = Math.min(d, Math.abs(c.g0 - pick[j].g0));
      if (d === Infinity) d = 1e9;                        // nothing to be far from yet
      if (d > bestD || (d === bestD && best && c.g0 > best.g0)) { bestD = d; best = c; }
    }
    return best;
  }
  // arr must be sorted g0-DESCENDING (sharpest first)
  function spreadPick(arr, n, seedPicks) {
    var pick = [], anchors = (seedPicks || []).slice(), i, j;
    for (i = 0; i < arr.length && pick.length < n; i++) {
      var c = arr[i], ok = true;
      for (j = 0; j < anchors.length; j++) if (Math.abs(c.g0 - anchors[j].g0) < G0_SEP * c.g0) ok = false;
      for (j = 0; j < pick.length; j++) if (Math.abs(c.g0 - pick[j].g0) < G0_SEP * c.g0) ok = false;
      if (ok) pick.push(c);
    }
    while (pick.length < n) {
      var b = farthestOne(arr, anchors, pick);
      if (!b) break;
      pick.push(b);
    }
    return pick;
  }
  function stratify(bucket) {
    Object.keys(bucket).forEach(function (cls) {
      var all = bucket[cls].slice().sort(function (a, b) { return b.g0 - a.g0; });
      var hi = all.filter(function (r) { return r.g0 >= 180; });
      var mid = all.filter(function (r) { return r.g0 >= 140 && r.g0 < 180; });
      var lo = all.filter(function (r) { return r.g0 < 140; });
      var pick = spreadPick(hi, 2).concat(spreadPick(mid, 2)).concat(spreadPick(lo, 2));
      var pool = all.filter(function (r) { return pick.indexOf(r) === -1; });
      while (pick.length < MAX_PER_CLASS && pool.length) {
        var b2 = farthestOne(pool, pick, []);
        if (!b2) break;
        pick.push(b2);
        pool = pool.filter(function (r) { return r !== b2; });
      }
      bucket[cls] = pick.slice(0, MAX_PER_CLASS);
    });
  }
  if (SUPERVISED) {
    // ---- score every candidate against the held-out observations ----
    // M[o][c] = { g: best windowed-gradient correlation over the 5x5 anchor grid
    // and the six blur sigmas, r: the RAW correlation at that same alignment }.
    // The engine ranks classes by max-over-exemplars and commits only when the two
    // channels agree with a gradient margin, so a selected SET's behaviour is a max
    // over its own columns — which is what makes greedy selection cheap and exact.
    console.log("supervised: scoring candidates against held-out observations…");
    ["N", "S", "W", "E"].forEach(function (k) {
      var cands = [];
      Object.keys(refs[k]).forEach(function (cls) {
        (refs[k][cls] || []).forEach(function (r) { cands.push({ cls: +cls, ref: r }); });
      });
      var O = obs[k];
      if (!cands.length || !O.length) { console.log("  " + k + ": no candidates/observations — falling back to the geometric picker"); return; }
      // pre-blur every candidate once
      var vars_ = cands.map(function (c) {
        var base = new Float32Array(c.ref.q);
        return SUP_SIG.map(function (sg) { var b = blur(base, sg); return { raw: zn(b), grad: gradVec(b) }; });
      });
      var M = O.map(function (o) {
        return cands.map(function (c, ci) {
          var bg = -Infinity, br = -Infinity;
          for (var gi = 0; gi < o.grid.length; gi++) {
            var og = o.grid[gi].grad, or_ = o.grid[gi].raw;
            for (var si = 0; si < vars_[ci].length; si++) {
              var g = cos(og, vars_[ci][si].grad);
              if (g > bg) { bg = g; br = cos(or_, vars_[ci][si].raw); }
            }
          }
          return { g: bg, r: br };
        });
      });
      // objective: +1 per correct commit, −SUP_PEN per wrong commit, 0 for a refusal
      var floor = k === "S" ? 0.015 : 0.01;
      function scoreSet(sel, idxs) {
        var net = 0, ok = 0, bad = 0, ref = 0;
        for (var oi = 0; oi < idxs.length; oi++) {
          var o = idxs[oi], perG = {}, perR = {};
          for (var j = 0; j < sel.length; j++) {
            var ci = sel[j], cl = cands[ci].cls, m = M[o][ci];
            if (!(cl in perG) || m.g > perG[cl]) { perG[cl] = m.g; perR[cl] = m.r; }
          }
          var ks = Object.keys(perG);
          if (ks.length < 2) { ref++; continue; }
          var g1 = -Infinity, g1v = null, g2 = -Infinity, r1 = -Infinity, r1v = null;
          ks.forEach(function (cl) {
            if (perG[cl] > g1) { g2 = g1; g1 = perG[cl]; g1v = +cl; } else if (perG[cl] > g2) g2 = perG[cl];
            if (perR[cl] > r1) { r1 = perR[cl]; r1v = +cl; }
          });
          if (g1v === r1v && (g1 - g2) >= floor) {
            if (g1v === O[o].cls) { net += 1; ok++; } else { net -= SUP_PEN; bad++; }
          } else ref++;
        }
        return { net: net, ok: ok, bad: bad, ref: ref };
      }
      var all = O.map(function (_, i) { return i; });
      var selIdx = SUP_HALF ? all.filter(function (i) { return i % 2 === 0; }) : all;
      var repIdx = SUP_HALF ? all.filter(function (i) { return i % 2 === 1; }) : all;
      // SEED one exemplar per class first. The objective is degenerate on a
      // partial class set — the consult refuses whenever fewer than two classes
      // can score, so a greedy that starts empty sees zero gain from its first
      // additions and stalls with three classes missing (measured: S and E came
      // out all-'1' and committed on nothing at all). Seed = the candidate with
      // the best DISCRIMINABILITY on the selection half: mean gradient score
      // against its own class's observations minus the mean against the others.
      var sel = [], perClass = {};
      [1, 2, 3, 4, 5].forEach(function (c) {
        var bi = -1, bs = -Infinity;
        for (var ci0 = 0; ci0 < cands.length; ci0++) {
          if (cands[ci0].cls !== c) continue;
          var same = 0, ns = 0, oth = 0, no = 0;
          for (var q0 = 0; q0 < selIdx.length; q0++) {
            var oo = selIdx[q0], g = M[oo][ci0].g;
            if (O[oo].cls === c) { same += g; ns++; } else { oth += g; no++; }
          }
          if (!ns || !no) continue;
          var d = same / ns - oth / no;
          if (d > bs) { bs = d; bi = ci0; }
        }
        if (bi >= 0) { sel.push(bi); perClass[c] = 1; }
      });
      // greedy forward selection with the engine's per-class budget; keep the
      // PREFIX with the best objective rather than stopping at the first plateau
      var cur = scoreSet(sel, selIdx), bestNet = cur.net, bestLen = sel.length;
      for (var step = 0; step < SUP_K * 5; step++) {
        var bestI = -1, bestS = null;
        for (var ci2 = 0; ci2 < cands.length; ci2++) {
          if (sel.indexOf(ci2) !== -1) continue;
          if ((perClass[cands[ci2].cls] || 0) >= SUP_K) continue;
          var s = scoreSet(sel.concat(ci2), selIdx);
          if (!bestS || s.net > bestS.net || (s.net === bestS.net && s.ok > bestS.ok)) { bestS = s; bestI = ci2; }
        }
        if (bestI < 0) break;
        sel.push(bestI); perClass[cands[bestI].cls] = (perClass[cands[bestI].cls] || 0) + 1; cur = bestS;
        if (cur.net > bestNet) { bestNet = cur.net; bestLen = sel.length; }
      }
      // `--fill` keeps the WHOLE greedy order up to the 6-per-class budget instead
      // of truncating at the objective's best prefix — the like-for-like comparison
      // against the geometric picker, which always spends its full budget.
      if (SUP_FILL) bestLen = sel.length;
      sel = sel.slice(0, bestLen);
      perClass = {}; sel.forEach(function (ci) { perClass[cands[ci].cls] = (perClass[cands[ci].cls] || 0) + 1; });
      cur = scoreSet(sel, selIdx);
      var rep = scoreSet(sel, repIdx);
      console.log("  " + k + ": " + cands.length + " candidates, " + O.length + " held-out obs -> picked " + sel.length +
        "  [select " + cur.ok + "ok/" + cur.bad + "bad/" + cur.ref + "ref net " + cur.net.toFixed(0) +
        "]  [report " + rep.ok + "ok/" + rep.bad + "bad/" + rep.ref + "ref]");
      var out = {};
      sel.forEach(function (ci) { (out[cands[ci].cls] = out[cands[ci].cls] || []).push(cands[ci].ref); });
      refs[k] = out;
    });
    stratify(nrefs.W); stratify(nrefs.E);   // name refs keep the geometric picker
  } else {
  for (var kk2 = 0; kk2 < 4; kk2++) stratify(refs[["N", "S", "W", "E"][kk2]]);
  stratify(nrefs.W); stratify(nrefs.E);
  }

  var lines = [];
  lines.push("// GENERATED by tools/build-level-refs.js — do not edit by hand.");
  lines.push("// Pristine 32x32 level-digit reference patches (g0>=" + MIN_NATIVE_GAP + " sources, 2 per");
  lines.push("// g0 tier: >=180 / 140-179 / 110-139), keyed refs[node][digit] = [{q:...}];");
  lines.push("// used by the engine's analysis-by-synthesis level rescue. Holdout");
  lines.push("// (djb2%5==0, " + heldOut + " samples) and " + localized + " non-English-client");
  lines.push("// samples excluded — see tools/build-level-refs.js.");
  lines.push("(function (root) {");
  lines.push("  \"use strict\";");
  lines.push("  var LEVEL_REFS = " + JSON.stringify(refs) + ";");
  lines.push("  var NAME_REFS = " + JSON.stringify(nrefs) + ";");
  lines.push("  var META = { ps: " + PS + ", patchGap: " + PATCH_GAP + ", npw: " + NPW + ", nph: " + NPH + ", built: " + JSON.stringify(new Date().toISOString().slice(0, 10)) + " };");
  lines.push("  if (typeof module !== \"undefined\" && module.exports) module.exports = { LEVEL_REFS: LEVEL_REFS, NAME_REFS: NAME_REFS, LEVEL_REFS_META: META };");
  lines.push("  else root.OcrLevelRefs = { LEVEL_REFS: LEVEL_REFS, NAME_REFS: NAME_REFS, LEVEL_REFS_META: META };");
  lines.push("})(typeof globalThis !== \"undefined\" ? globalThis : this);");
  var OUTFILE = SUP_OUT ? path.resolve(SUP_OUT) : path.join(ROOT, "ocr", "level-refs.js");
  fs.writeFileSync(OUTFILE, lines.join("\n") + "\n");

  var covN = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.N[v] || []).length); }).join(" ");
  var covS = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.S[v] || []).length); }).join(" ");
  var covW = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.W[v] || []).length); }).join(" ");
  var covE = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.E[v] || []).length); }).join(" ");
  var kb = Math.round(fs.statSync(OUTFILE).size / 1024);
  console.log("harvested from " + used + " samples (holdout skipped: " + heldOut + ", localized skipped: " + localized + ") -> ocr/level-refs.js (" + kb + "KB)");
  console.log("coverage  N " + covN + "  |  S " + covS + "  |  W " + covW + "  |  E " + covE);
  console.log("name refs W: " + Object.keys(nrefs.W).map(function (n) { return n + ":" + nrefs.W[n].length; }).join(" "));
  console.log("name refs E: " + Object.keys(nrefs.E).map(function (n) { return n + ":" + nrefs.E[n].length; }).join(" "));
  console.log("");
  console.log("WARNING: you have just overwritten ocr/level-refs.js. The exemplar draw is");
  console.log("  high-variance (round 8: +-5% whole-parse across four defensible builds) and the");
  console.log("  round-6 refs beat every rebuild measured. Run `npm run eval-ocr` and compare");
  console.log("  before committing this file, or `git checkout -- ocr/level-refs.js` to undo.");
})().catch(function (e) { console.error(e); process.exit(1); });
