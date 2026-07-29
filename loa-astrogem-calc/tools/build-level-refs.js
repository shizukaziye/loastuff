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

(async function () {
  var files = fs.readdirSync(path.join(ROOT, "samples")).filter(function (f) { return /\.(png|webp|jpe?g)$/i.test(f); });
  var refs = { N: {}, S: {}, W: {}, E: {} };
  var nrefs = { W: {}, E: {} };   // name-band refs keyed by canonical effect name
  var weCands = [];               // W/E candidates, verified after the loop
  var used = 0, heldOut = 0, localized = 0;
  for (var fi = 0; fi < files.length; fi++) {
    var f = files[fi];
    var base = f.replace(/\.(png|webp|jpe?g)$/i, "");
    if (DEGRADED[base]) continue;
    if (LOCALIZED[base]) { localized++; continue; }
    if (isHoldout(base)) { heldOut++; continue; }
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
  // dominated by the 110-139 tier, so that tier gets its own slots. Within a
  // tier, prefer DISTINCT g0 values (same-g0 frames are usually the same
  // monitor/user — near-duplicates that waste an exemplar slot).
  function pickDistinct(arr, n) {
    var pick = [], seen = {};
    for (var i = 0; i < arr.length && pick.length < n; i++) {
      if (seen[arr[i].g0]) continue;
      seen[arr[i].g0] = 1; pick.push(arr[i]);
    }
    for (var j = 0; j < arr.length && pick.length < n; j++) {
      if (pick.indexOf(arr[j]) === -1) pick.push(arr[j]);
    }
    return pick;
  }
  function stratify(bucket) {
    Object.keys(bucket).forEach(function (cls) {
      var all = bucket[cls].slice().sort(function (a, b) { return b.g0 - a.g0; });
      var hi = all.filter(function (r) { return r.g0 >= 180; });
      var mid = all.filter(function (r) { return r.g0 >= 140 && r.g0 < 180; });
      var lo = all.filter(function (r) { return r.g0 < 140; });
      var pick = pickDistinct(hi, 2).concat(pickDistinct(mid, 2)).concat(pickDistinct(lo, 2));
      var pool = all.filter(function (r) { return pick.indexOf(r) === -1; });
      while (pick.length < MAX_PER_CLASS && pool.length) pick.push(pool.shift());
      bucket[cls] = pick.slice(0, MAX_PER_CLASS);
    });
  }
  for (var kk2 = 0; kk2 < 4; kk2++) stratify(refs[["N", "S", "W", "E"][kk2]]);
  stratify(nrefs.W); stratify(nrefs.E);

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
  fs.writeFileSync(path.join(ROOT, "ocr", "level-refs.js"), lines.join("\n") + "\n");

  var covN = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.N[v] || []).length); }).join(" ");
  var covS = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.S[v] || []).length); }).join(" ");
  var covW = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.W[v] || []).length); }).join(" ");
  var covE = [1, 2, 3, 4, 5].map(function (v) { return v + ":" + ((refs.E[v] || []).length); }).join(" ");
  var kb = Math.round(fs.statSync(path.join(ROOT, "ocr", "level-refs.js")).size / 1024);
  console.log("harvested from " + used + " samples (holdout skipped: " + heldOut + ", localized skipped: " + localized + ") -> ocr/level-refs.js (" + kb + "KB)");
  console.log("coverage  N " + covN + "  |  S " + covS + "  |  W " + covW + "  |  E " + covE);
  console.log("name refs W: " + Object.keys(nrefs.W).map(function (n) { return n + ":" + nrefs.W[n].length; }).join(" "));
  console.log("name refs E: " + Object.keys(nrefs.E).map(function (n) { return n + ":" + nrefs.E[n].length; }).join(" "));
})().catch(function (e) { console.error(e); process.exit(1); });
