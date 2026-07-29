/**
 * ocr/structural-engine.js — the FREE-tier screenshot parser ("structural").
 *
 * Philosophy (measured, not guessed — see samples/README.md): Tesseract reads the
 * plain-background footer at ~100% and fails on everything painted over the nebula
 * art; but the art regions are rigidly structured and COLOR-CODED. So this engine
 * reads STRUCTURE first and uses OCR only where it is strong:
 *
 *   panel + wheel      ocr/layout.js — the red-over-gold diamond signature, refined
 *                      to true centers; every sample point derives from the anchors.
 *   outcome targets    icon hue, SELF-CALIBRATED against the same image's own W/E
 *                      diamond colors (no global effect→hue table needed).
 *   outcome direction  green-▲ / red-▼ pixel clusters (color, not glyph — the "▲
 *                      reads as A" failure mode disappears).
 *   outcome kind/amt   micro-OCR of the caption band through a white/gold chroma
 *                      mask at 3-4× upscale, keyword lexicon + digit whitelist.
 *   wheel levels       gold-chroma mask + digit whitelist, cross-checked against
 *                      the "N Astrogem Points" level sum (a free checksum).
 *   gem name/rarity    name-band OCR → GEM_NAME_COST suffix (tesseract-engine's
 *                      table) + Order/Chaos keyword; rarity from Process (x/N).
 *   footer             plain-background OCR: Process (x/N), Processing Cost, and
 *                      the ROI-scoped free-reroll pill (emitted as
 *                      rerollsShownFree/-Denom per the constraintSnap contract).
 *
 * The core (parseStructural) is environment-agnostic: it consumes a raw RGBA raster
 * and an injected async `ocrFn(raster, {whitelist, psm}) -> {text, conf}` so the
 * browser (canvas + CDN Tesseract) and Node (sharp + tesseract.js, via
 * tools/eval-ocr.js) run the IDENTICAL decision logic.
 *
 * Emits the full per-field confidence map (see ocr/engine.js constraintSnap).
 */
(function (root) {
  "use strict";
  var IS_NODE = typeof module !== "undefined" && module.exports;
  var L = IS_NODE ? require("./layout.js") : root.OcrLayout;
  var ENGINE_API = IS_NODE ? require("./engine.js") : (root.OcrEngineAPI || root);
  var TESS = IS_NODE ? require("./tesseract-engine.js") : (root.OcrTesseractEngine || root);
  var GLYPHS_POOLED = null, GLYPH_BANDS = null;
  try {
    var _gl = IS_NODE ? require("./glyphs.js") : root.OcrGlyphs;
    if (_gl) { GLYPHS_POOLED = _gl.GLYPH_ATLAS; GLYPH_BANDS = _gl.GLYPH_BANDS || null; }
  } catch (e) {}
  // Per-resolution-band atlas pick: ×2-upscaled captures render bilinear-fattened
  // strokes whose averaged silhouettes differ from native ones (measured: a
  // pooled-native '+' template outscored a true ×2 serif-'1' in the points
  // header, killing the level checksum). The band overlays the pooled atlas so
  // classes a band lacks still match. Cached per band — the merge is tiny.
  // Calibration hook (off in production): OCR_CELL_EVID=1 makes the outcome-cell
  // reader attach the raw per-cell evidence it decided on, so a scratch harness can
  // score candidate decision rules offline against the labels.
  var COLLECT_EVID = (typeof process !== "undefined" && process.env && process.env.OCR_CELL_EVID === "1");
  var _atlasCache = {};
  function pickGlyphAtlas(scaleF) {
    if (!GLYPHS_POOLED) return null;
    if (!GLYPH_BANDS) return GLYPHS_POOLED;
    var band = scaleF >= 3 ? "u3" : scaleF >= 2 ? "u2" : "n";
    if (_atlasCache[band]) return _atlasCache[band];
    var over = GLYPH_BANDS[band] || {};
    var merged = {}, k;
    for (k in GLYPHS_POOLED) if (GLYPHS_POOLED.hasOwnProperty(k)) merged[k] = GLYPHS_POOLED[k];
    for (k in over) if (over.hasOwnProperty(k)) merged[k] = over[k];
    _atlasCache[band] = merged;
    return merged;
  }
  var LREFS = null, NREFS = null;
  try {
    var _lr = IS_NODE ? require("./level-refs.js") : root.OcrLevelRefs;
    if (_lr) { LREFS = _lr.LEVEL_REFS; NREFS = _lr.NAME_REFS; }
  } catch (e) {}
  // blurred-variant caches for the synthesis rescues — MODULE scope: building
  // them costs ~400 blur+normalize passes and they depend only on the baked
  // refs, so one build serves every parse (they used to be rebuilt inside
  // every parseStructural call)
  var _synthTVCache = null, _nsynthTVCache = null, _amtTVCache = null;

  var GEM_NAME_COST = (TESS && TESS.GEM_NAME_COST) || {
    stability: 8, corrosion: 8, solidity: 9, distortion: 9, immutability: 10, destruction: 10,
    collapse: 10
  };
  function normText(s) {
    if (TESS && typeof TESS.normalizeOcrText === "function") return TESS.normalizeOcrText(s);
    return String(s || "");
  }

  // ---------------------------------------------------------------------------
  // the core parse
  // ---------------------------------------------------------------------------
  function upscale(raster, factor) {
    // nearest-neighbor upscale (crisp glyph edges beat smooth for masked OCR)
    var f = Math.max(1, Math.round(factor));
    if (f === 1) return raster;
    var w = raster.width * f, h = raster.height * f;
    var out = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y++) {
      var sy = (y / f) | 0;
      for (var x = 0; x < w; x++) {
        var si = ((sy * raster.width) + ((x / f) | 0)) * 4, di = (y * w + x) * 4;
        out[di] = raster.data[si]; out[di + 1] = raster.data[si + 1];
        out[di + 2] = raster.data[si + 2]; out[di + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  function rectAround(p, halfW, halfH) { return { x: p.x - halfW, y: p.y - halfH, w: halfW * 2, h: halfH * 2 }; }

  // 1px dilation of the dark (text) pixels in a black-on-white mask — reconnects
  // strokes that antialiasing broke on downscaled captures before micro-OCR retries.
  function dilateDark(img) {
    var w = img.width, h = img.height, src = img.data;
    var out = new Uint8ClampedArray(src.length);
    out.set(src);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (src[i] < 128) continue;
        var dark = false;
        for (var dy = -1; dy <= 1 && !dark; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (src[(ny * w + nx) * 4] < 128) { dark = true; break; }
          }
        }
        if (dark) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; }
      }
    }
    return { width: w, height: h, data: out };
  }

  // hue distance on the circle
  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // Glyph-box hygiene: segmentGlyphs output minus dust and off-height fragments
  // (0.55–1.7 × the median height). One definition — the same recipe used to be
  // hand-rolled at every template site. (tools/build-glyphs.js keeps a 1.6 upper
  // bound; unifying it changes the harvested atlas, parked with the atlas
  // recalibration — see docs/how-the-advisor-works.md §6.)
  function segmentDigitBoxes(mask) {
    var boxes = L.segmentGlyphs(mask, { minColPx: 1, gapCols: 1 });
    var hs = boxes.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
    var medH = hs.length ? hs[hs.length >> 1] : 0;
    return boxes.filter(function (b) { return b.h >= medH * 0.55 && b.h <= medH * 1.7 && b.w >= 2; });
  }

  async function parseStructural(raster, ocrFn) {
    var confidence = { config: {}, state: {}, outcomes: [0, 0, 0, 0] };
    var out = { config: {}, state: {}, outcomes: [], rarity: null, confidence: confidence };
    var ocrFails = 0;   // dead-OCR calls (worker never loaded / crashed mid-parse)

    // phase timing (lands in _debug.timing) — the optimization loop's ruler:
    // tmark(name) charges the elapsed time since the previous mark to `name`;
    // OCR wall-time is also accumulated separately (it overlaps the phases)
    var _tPrev = Date.now(), _timing = {}, _ocrMs = 0;
    function tmark(name) { var n = Date.now(); _timing[name] = (_timing[name] || 0) + (n - _tPrev); _tPrev = n; }
    var _ocrInner = ocrFn;
    ocrFn = function (r, o) {
      var t0 = Date.now();
      return _ocrInner(r, o).then(function (res) { _ocrMs += Date.now() - t0; return res; });
    };

    var found = L.panelOrWhole(raster);
    if (!found) {
      // not a Processing screenshot (or unrecognizable) — return an empty parse; the
      // snap will default everything at confidence 0 and the UI highlights it all.
      out.outcomes = [];
      out._debug = { panel: null };
      return out;
    }
    // Four-landmark wheel fit BEFORE anything else: the coarse two-blob anchors can
    // come in with the gap squeezed 15-20% (glow-biased centroids), which mis-scales
    // the normalization AND every anchor-relative region. fitWheel cross-validates
    // two independent rulers (red↔gold vertical vs W↔E horizontal) and keeps the
    // originals when they disagree.
    if (found.anchors && L.fitWheel) {
      found.anchors = L.fitWheel(raster, found.anchors);
    }

    // ---- resolution normalization ----
    // The red→gold wheel distance is the game-UI ruler: it scales 1:1 with however
    // the capture was rendered (720p crop, 1440p, 4K, windowed). Crop to the panel
    // (bounds memory on huge frames), then resample so that distance equals the
    // canonical gap every read below was calibrated at. Any resolution in, ONE
    // effective resolution internally.
    var CANON_GAP = 246;
    var g0 = found.anchors
      ? (found.anchors.gold.y - found.anchors.red.y)
      : found.rect.h * L.SIG.GAP_RATIO;
    var fRaw = CANON_GAP / Math.max(8, g0);
    // snap to coarse steps: fractional factors (e.g. 1.99) interpolate EVERY row and
    // blur thin glyphs below the chroma-mask thresholds; integer factors copy rows.
    // Oversized captures barely need downscaling (bigger glyphs read fine — the
    // resample exists to bound compute on 4K+), so the no-resample zone is wide.
    var scaleF = fRaw <= 0.65 ? 0.5 : fRaw <= 1.25 ? 1 : Math.min(3, Math.round(fRaw));
    {
      // crop with a margin so edge regions (reroll pill, footer buttons) survive.
      // The BOTTOM margin is deliberately larger: on several live shots the panel
      // rect detected short and the symmetric 6% cropped the Process button half
      // out of the raster — every footer vote then failed and the turn defaulted
      // to 1. Nothing below the button matters except chat, which the pair regex
      // and the {5,7,9} gate ignore.
      var mg = 0.06, mgBot = 0.16;
      // the panel's rect in ORIGINAL-image coordinates, exposed for the AI
      // verifier's crop (the raster below is cropped+rescaled and useless for it)
      out._srcPanel = {
        x: Math.max(0, Math.round(found.rect.x - found.rect.w * mg)),
        y: Math.max(0, Math.round(found.rect.y - found.rect.h * mg)),
        w: Math.round(found.rect.w * (1 + 2 * mg)),
        h: Math.round(found.rect.h * (1 + mg + mgBot))
      };
      var cr = {
        x: found.rect.x - found.rect.w * mg, y: found.rect.y - found.rect.h * mg,
        w: found.rect.w * (1 + 2 * mg), h: found.rect.h * (1 + mg + mgBot)
      };
      // L.crop rounds+clamps the origin — mirror it so coordinate shifts stay exact
      var ox = Math.max(0, Math.round(cr.x)), oy = Math.max(0, Math.round(cr.y));
      raster = L.crop(raster, cr);
      var sh2 = function (p) { return { x: (p.x - ox) * scaleF, y: (p.y - oy) * scaleF }; };
      if (Math.abs(scaleF - 1) > 0.04) raster = L.upscaleBilinear(raster, scaleF);
      else scaleF = 1;
      found = {
        rect: {
          x: (found.rect.x - ox) * scaleF, y: (found.rect.y - oy) * scaleF,
          w: found.rect.w * scaleF, h: found.rect.h * scaleF
        },
        method: found.method + (scaleF !== 1 ? "+norm" + scaleF.toFixed(2) : ""),
        score: found.score,
        anchors: found.anchors ? { red: sh2(found.anchors.red), gold: sh2(found.anchors.gold) } : null
      };
    }
    var panel = found.rect;
    var geo = found.anchors ? L.wheelGeometry(found.anchors) : null;
    var panelConf = found.score;
    // band-specific glyph templates for THIS capture's normalization factor
    // (function-scoped: every closure below reads this local, not the pooled set)
    var GLYPHS = pickGlyphAtlas(scaleF);
    out._debug = { panel: found, norm: { ox: out._srcPanel.x, oy: out._srcPanel.y, scaleF: scaleF } };
    tmark("normalize");

    function roiCrop(key) { return L.crop(raster, L.roiRect(panel, key)); }
    async function ocrText(sub, opts) {
      try {
        var r = await ocrFn(sub, opts || {});
        if (r && r.failed) ocrFails++;   // resolved-but-dead OCR backend
        return { text: r.text || "", conf: r.conf != null ? r.conf : 0.5 };
      } catch (e) { ocrFails++; return { text: "", conf: 0 }; }
    }
    // masked micro-OCR: crop → chroma mask → upscale → OCR
    async function maskedOcr(rect, pred, opts) {
      var sub = L.crop(raster, rect);
      var masked = L.chromaMask(sub, pred);
      var scale = Math.max(2, Math.min(4, Math.round(120 / Math.max(1, sub.height))));
      var r = await ocrText(upscale(masked, scale), opts);
      if (out._debug) {
        (out._debug.reads = out._debug.reads || []).push({
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
          wl: (opts && opts.whitelist) || "", psm: (opts && opts.psm) || 6,
          text: String(r.text || "").replace(/\n/g, "\\n").slice(0, 70), conf: Math.round(r.conf * 100) / 100
        });
      }
      return r;
    }
    // Dilated micro-OCR: (pre-cropped) sub → chroma mask → 1px dilate (reconnects
    // strokes that antialiasing broke) → nearest upscale → OCR. THE standard
    // dim-text rescue recipe — one definition, six call sites. `scale` is a fixed
    // factor or "auto" (targets ~160px height, capped by `maxAuto`).
    async function dilatedOcr(sub, pred, opts) {
      var sc = opts.scale === "auto"
        ? Math.max(2, Math.min(opts.maxAuto || 4, Math.round(160 / Math.max(1, sub.height))))
        : opts.scale;
      return ocrText(upscale(dilateDark(L.chromaMask(sub, pred)), sc), { whitelist: opts.whitelist, psm: opts.psm });
    }
    function whiteOrGold(r, g, b) { return L.isWhiteText(r, g, b) || L.isGoldText(r, g, b); }
    // caption cells mix white names, chartreuse amounts, and gold ("Points +1") text
    function captionText(r, g, b) { return L.isWhiteText(r, g, b) || L.isGoldText(r, g, b) || L.isAmountText(r, g, b); }

    // ---- wheel geometry FIRST: every text region derives from the anchors ----
    // Panel-fraction ROIs died on the 2026-07-16 corpus (different crop framings drift
    // them off-target); the wheel anchors are the only invariant. cx/redY/goldY + gap
    // place everything: gem name at redY−1.39·gap, points at −1.10·gap, the footer
    // block from goldY+1.15·gap down (measured on the dev corpus, verified on the
    // low-res corpus).
    var nodes = geo ? geo : {
      nodeN: L.roiPoint(panel, "nodeN"), nodeW: L.roiPoint(panel, "nodeW"),
      nodeE: L.roiPoint(panel, "nodeE"), nodeS: L.roiPoint(panel, "nodeS"),
      gap: panel.h * L.SIG.GAP_RATIO
    };
    var gap = nodes.gap;
    var cx = nodes.nodeN.x, redY = nodes.nodeN.y, goldY = nodes.nodeS.y;
    function bandRect(cy, halfHGap, halfWGap) {
      return { x: cx - halfWGap * gap, y: cy - halfHGap * gap, w: halfWGap * 2 * gap, h: halfHGap * 2 * gap };
    }
    // Template read: segment a rect through `pred` and match every glyph box against
    // the harvested atlas (ocr/glyphs.js — pictures of the game's own font). No OCR:
    // pixel comparison with an honest margin-based confidence. Returns labeled boxes
    // left-to-right, or null when no atlas is loaded.
    function templateGlyphs(rect, pred) {
      if (!GLYPHS) return null;
      var sub = L.crop(raster, rect);
      var mask = L.chromaMask(sub, pred);
      var boxes = segmentDigitBoxes(mask);
      var items = boxes.map(function (b) {
        var m = L.matchGlyph(mask, b, GLYPHS);
        return { box: b, ch: m ? m.ch : null, score: m ? m.score : 0, margin: m ? m.margin : 0 };
      });
      items.mask = mask;   // for closed-world rematches against a restricted atlas
      return items;
    }
    // digit-only subset of the atlas (closed-world rematch when a box is known to be
    // a digit by POSITION — e.g. the boxes before "Astrogem" in the points header)
    var DIGIT_ATLAS = null;
    if (GLYPHS) {
      DIGIT_ATLAS = {};
      Object.keys(GLYPHS).forEach(function (k) { if (/^[0-9]$/.test(k)) DIGIT_ATLAS[k] = GLYPHS[k]; });
    }
    // Closed-world digit match scored by INK IoU (intersection/union of on-pixels).
    // bitmapSim's mean-abs-diff is dominated by the empty background, so every sparse
    // glyph scores ~0.7 and a narrow '1' ties a wide '7'; IoU only counts ink, so a
    // width mismatch collapses the score. Used where a box is a digit BY POSITION.
    function iouDigit(mask, box, allowed) {
      var bm = L.glyphBitmap(mask, box), scored = [];
      Object.keys(DIGIT_ATLAS).forEach(function (k) {
        if (allowed && allowed.indexOf(k) === -1) return;
        var t = DIGIT_ATLAS[k], inter = 0, uni = 0;
        for (var i = 0; i < bm.length; i++) {
          var a = bm[i] >= 0.5, b = t[i] >= 0.4;
          if (a && b) inter++;
          if (a || b) uni++;
        }
        scored.push({ ch: k, score: uni ? inter / uni : 0 });
      });
      scored.sort(function (p, q) { return q.score - p.score; });
      var best = scored[0];
      if (best) { best.margin = best.score - (scored[1] ? scored[1].score : 0); best.top3 = scored.slice(0, 3).map(function (s) { return s.ch + ":" + s.score.toFixed(2); }).join(","); }
      return best;
    }
    // Best confidently-matched GOLD digit (g1..g5) in a line. BEST-of, not last-of:
    // a gold frame sliver trailing the line segments as its own box and matches "4"
    // (diagonals do) — the true digit outscores it.
    // Fraction of mask ON-pixels inside a glyph box (chromaMask: 0 = text pixel).
    function maskFill(mask, box) {
      if (!mask || !box || !box.w || !box.h) return 0;
      var on = 0;
      for (var yy = box.y; yy < box.y + box.h; yy++)
        for (var xx = box.x; xx < box.x + box.w; xx++)
          if (mask.data[(yy * mask.width + xx) * 4] === 0) on++;
      return on / (box.w * box.h);
    }
    function lastGoldDigit(rect, pred, maxVal) {
      var tl = templateGlyphs(rect, pred);
      if (!tl) return null;
      var best = null;
      for (var i = 0; i < tl.length; i++) {
        var t = tl[i];
        if (t.ch && /^[1-5]$/.test(t.ch) && t.score >= 0.78 && t.margin >= 0.03) {
          var v = parseInt(t.ch, 10);
          if (maxVal && v > maxVal) continue;
          // SOLIDITY VETO (2026-07-21, level4.webp): at collect-crop blur the
          // ▲/▼ bleeds into the amount mask (arrow hue 75-145 overlaps
          // chartreuse 55-95) and a solid triangle template-matches '4'.
          // Digits are STROKES (fill ≲0.40 of their own wide box); a solid
          // wide blob is an arrow, whatever glyph it matched. Narrow '1'
          // boxes are exempt — a bar legitimately fills its shrink-wrapped box.
          if (t.box.w >= t.box.h * 0.55 && maskFill(tl.mask, t.box) > 0.45) continue;
          if (!best || t.score >= best.score) best = { score: t.score, margin: t.margin, v: v };
        }
      }
      if (!best) return null;
      return { value: best.v, conf: (best.score >= 0.86 && best.margin >= 0.06) ? 0.95 : 0.85 };
    }

    // Self-locate a text line in a zone, then return a padded OCR rect. Fixed offsets
    // from the (noisy) anchors proved brittle across capture variants — line-locating
    // inside a generous zone is the pattern that made the wheel levels robust.
    function locateLine(zone, pred, opts) {
      var line = L.findMaskedTextLine(raster, zone, pred, opts);
      if (!line) return null;
      var grow = Math.round(line.h * 0.45);
      return { x: line.x - grow, y: line.y - grow, w: line.w + grow * 2, h: line.h + grow * 2, _line: line };
    }
    function lineOpts(minWGap, maxWGap, centerTolGap) {
      return {
        maxRowFill: 0.6, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.24),
        // a high row threshold: sparkle/glow rows (~10px) must not bridge separate
        // elements (gem icon ↔ name line) into one over-tall rejected band
        minRowPx: Math.max(4, Math.round(gap * 0.10)), rejectFill: 0.45,
        accept: function (r) {
          var c = r.x + r.w / 2;
          return Math.abs(c - cx) <= gap * centerTolGap && r.w >= gap * minWGap && r.w <= gap * maxWGap;
        }
      };
    }

    // The FIND mask for dim button/footer text — shared by the footer phase, the
    // pill, and the cost reads, so it lives OUTSIDE the async footer wrapper.
    var dimBtnWhite = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.3 && c.v > 0.6; };
    // The Charge WORD, degradation-tolerant: dim 'h' reads as 'r'/'n' ("Crarge" —
    // measured live, the whole "rerolls default to fresh-3" class) and the 'C' can
    // drop. c + ≤2 letters + "arg" + e/a covers the family INCLUDING the Spanish
    // client's "Carga" (measured live); the pill ROI has no other word-bearing
    // text, so the loose net stays safe.
    var CHARGE_RX = /c[a-z+.−-]{0,2}arg[ea]|harge|harga|chorge/i;   // the dim 'h' also reads as +/-
    // ---- Charge button FACE colour (round 6, 2026-07-29) ----
    // The gold/grey decision used to be one-sided: "is there a solid gold CLUSTER
    // anywhere in (a generously grown) pill rect", counted in pixels with a density
    // guard. Both halves of that broke on unseen boards and produced this campaign's
    // first silent errors, in BOTH directions:
    //   · the count+density test needs h30-55 s>.45 **v>.5**, and a real gold button
    //     renders at meanV 0.45 on a dim capture — 5% of the rect passed, 355px
    //     against a 451px bar, so a plainly amber button was called grey (mrxvkvlc);
    //   · the "grown" re-measure reaches 0.55·gap DOWN, where the gold CURRENCY COIN
    //     icons live. A coin is small but perfectly compact, so it sails through
    //     count≥0.008·gap² at density 0.81 — two grey buttons called gold
    //     (mryrst7q, ms2kf8ya). Both cost a model reroll, silently.
    // Replaced by a TWO-CLASS measurement of the same pixels: the word sits on a
    // face that is either amber or neutral-grey, so measure both FRACTIONS and let
    // them argue. A fraction cannot be fooled by a compact foreign blob (the coins
    // are 0.9% of the grown rect), and dropping the v floor to 0.14 keeps the dim
    // renderings. Measured over all 177 corpus boards that reach this branch:
    // amber ∈ [0.43, 0.97] on every gold button, ∈ [0, 0.07] on every grey one —
    // one gap, no overlap, so the 0.25 bar sits in open space.
    function chargeFace(rect) {
      var img = L.crop(raster, rect);
      var n = img.width * img.height, amber = 0, neutral = 0;
      for (var i = 0; i < n; i++) {
        var c = L.hsv(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
        // amber: the button face, hue-wide and dim-tolerant (a live gold face
        // measured h 30-45 s 0.76 v 0.45 — the old v>0.5 floor missed most of it)
        if (c.h >= 18 && c.h < 62 && c.s >= 0.30 && c.v >= 0.14) amber++;
        // neutral: the SPENT button's grey face. Required for a decisive "grey"
        // so that a rect which drifted off the button entirely (dark navy panel,
        // s≈0.5) cannot be read as a grey button by mere absence of amber.
        else if (c.s < 0.22 && c.v >= 0.10) neutral++;
      }
      return { amber: amber / n, neutral: neutral / n };
    }
    var CHARGE_AMBER = 0.25;    // ≥ ⇒ gold face   (corpus min on a true gold: 0.43)
    var CHARGE_NOAMBER = 0.12;  // ≤ ⇒ no amber    (corpus max on a true grey: 0.07)
    var CHARGE_NEUTRAL = 0.25;  // grey face must FILL the rect (corpus min: 0.51)

    // ---- footer: Process (x/N) — anchored tight button first, block fallback ----
    // Wrapped as a CONCURRENT phase (launched here, awaited before outcomes): its
    // OCR chain overlaps the pill and gem-name reads across the worker pool. All
    // its state is local; it writes only its own out/confidence fields.
    // OCR confusions to survive (all observed): "(" reads as a glued "1" ("(4/7)" →
    // "14/7"), "/" reads as ":" or "." — so capture the SINGLE digit adjacent to the
    // separator and accept the separator class loosely. N can only be 5/7/9.
    var footerP = (async function footerPhase() {
    function parseProcPair(text) {
      // take the LAST valid pair — the Process button is the bottom-most row
      var re = /(\d)\s*[:\/l|.]\s*(\d)\s*[\)\]]?/g, m, best = null;
      var t = normText(text);
      while ((m = re.exec(t))) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a >= 0 && a <= 9 && (b === 5 || b === 7 || b === 9) && a <= b) best = { a: a, b: b };
      }
      return best;
    }
    // Two independent reads, then a vote: A = the LOCATED Process-button line (its
    // distance below the gold node wobbles ~2.2-2.5·gap with crop padding — locate,
    // don't fix), B = the whole footer down to the panel bottom (position-free
    // rescue). Agree → high conf; disagree → A wins but flagged.
    // The FIND mask is looser than the read mask: upscaled glyphs keep only a sparse
    // bright skeleton (5-17 px/row at ×2), so v>0.6 + a low row threshold or no band
    // ever forms (this was every "turn read at 0.70" flag). (dimBtnWhite is defined
    // above the phase wrapper — it is shared with the pill and cost reads.)
    // DESCENDING locate: the zone's topmost white band is sometimes NOT the button —
    // on shots where the wheel gap measures a few % small, the Balance row slips into
    // the zone top, gets located, OCRs to garbage, and the turn silently defaulted
    // to 1. If a located band yields no valid (x/N) pair, descend below it and retry.
    var btnZone = { x: cx + gap * 0.2, y: goldY + gap * 1.95, w: gap * 2.15, h: gap * 0.75 };
    var btnRect = locateLine(btnZone, dimBtnWhite, {
      maxRowFill: 0.75, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.24),
      minRowPx: Math.max(4, Math.round(gap * 0.04)),
      accept: function (r) { return r.w >= gap * 0.5; }
    });
    var procRead = await maskedOcr(
      btnRect || { x: cx + gap * 0.2, y: goldY + gap * 2.13, w: gap * 2.15, h: gap * 0.3 },
      dimBtnWhite, { psm: 7 });
    var pairA = parseProcPair(procRead.text);
    // vote T: template-match the located line — the last two confident digits are
    // (x, N); "Process" letters are distractor classes and can't leak in
    var pairT = null;
    if (btnRect) {
      var tg = templateGlyphs(btnRect, dimBtnWhite);
      if (out._debug) out._debug.pairTG = tg ? tg.map(function (t) {
        return (t.ch || "?") + ":" + t.score.toFixed(2) + "/" + t.margin.toFixed(2) + "(" + t.box.w + "x" + t.box.h + ")";
      }).join(" ") : "null";
      if (tg) {
        // Anchor on the '/' and take its IMMEDIATE NEIGHBOURS (the proven pill
        // pattern): the old last-two-confident-digits rule was fooled twice over
        // on one live frame — the true '1' is narrow and matches the '+' template
        // (so it never entered the run) while a word-height "Process" letter faked
        // a '5' at exactly the 0.80 floor. The slash can't be faked by either, and
        // the narrow-box-is-'1' aspect rule recovers the digit the atlas can't.
        var si2 = -1;
        for (var sk2 = 0; sk2 < tg.length; sk2++) { if (tg[sk2].ch === "/" && tg[sk2].score >= 0.8) si2 = sk2; }
        if (si2 >= 1 && si2 + 1 < tg.length) {
          var aB = tg[si2 - 1], bB = tg[si2 + 1];
          // INK-IoU CROSS-CHECK on the x digit (round 2): bitmapSim's background-
          // dominated score let a ×2-tier '3' match '8'@0.8+ and the pairT-alone
          // rung shipped the wrong turn at 0.88 — silent. IoU counts only ink, so
          // the closed-loop lookalikes separate; a decisive IoU dissent refuses
          // the digit (the pair then falls to the OCR voters, flagged).
          // CLOSED VOCABULARY on the N digit (round 8): N can only be 5, 7 or 9, so
          // the open-atlas 0.80 floor is the wrong test for it. `c-mrxn60s5` renders
          // "Process (3/9)" perfectly and the template run reads it perfectly —
          // 3@0.85, /@0.94, 9@0.76 — and the 0.80 floor threw the '9' away, dropping
          // the whole pair to the button-OCR voter, which read 2/9 and shipped turn 8
          // at 0.85: SILENT. Below the floor the digit may still commit if the
          // INK-IoU restricted to {5,7,9} independently picks the same class with a
          // clear margin. Two different scorings of the same ink (background-weighted
          // bitmapSim and ink-only IoU) agreeing inside a 3-way vocabulary is the same
          // standard the rest of this engine commits on.
          function pairDigit(tB, allowed) {
            if (tB.box.w / Math.max(1, tB.box.h) < 0.45) return 1;   // the only narrow digit
            if (!(tB.ch && /^\d$/.test(tB.ch))) return null;
            if (DIGIT_ATLAS && tg.mask) {
              var im = iouDigit(tg.mask, tB.box);
              if (im && im.ch !== tB.ch && im.margin >= 0.08) return null;
            }
            if (tB.score >= 0.8) return parseInt(tB.ch, 10);
            if (allowed && tB.score >= 0.70 && DIGIT_ATLAS && tg.mask) {
              var iv = iouDigit(tg.mask, tB.box, allowed);
              if (out._debug) out._debug.pairVocab = tB.ch + "@" + tB.score.toFixed(2) +
                " iou " + (iv ? iv.top3 + " m" + iv.margin.toFixed(2) : "null");
              if (iv && iv.ch === tB.ch && iv.margin >= 0.08) return parseInt(tB.ch, 10);
            }
            return null;
          }
          var a3 = pairDigit(aB);
          var b3 = pairDigit(bB, ["5", "7", "9"]);
          if (a3 != null && b3 != null && (b3 === 5 || b3 === 7 || b3 === 9) && a3 >= 1 && a3 <= b3) pairT = { a: a3, b: b3 };
        }
      }
    }
    function pairEq(p, q) { return p && q && p.a === q.a && p.b === q.b; }
    var pair = null, pairConf = 0;
    // template ∧ button-OCR agreement settles the pair WITHOUT the footer block
    if (pairT && pairEq(pairT, pairA)) { pair = pairT; pairConf = 0.96; }
    var footTop = goldY + gap * 1.13;
    var footText = "", footBlockRan = false;
    async function readFootBlock() {
      if (footBlockRan) return;
      footBlockRan = true;
      var footRead = await maskedOcr(
        { x: cx - gap * 2.35, y: footTop, w: gap * 4.7, h: Math.max(gap * 0.6, panel.y + panel.h - footTop - 2) },
        L.isWhiteText, { psm: 6 });
      footText = normText(footRead.text);
    }
    if (!pair) {
      // the block read is the corroborating voter only when the cheap votes
      // disagree — it is the single LARGEST OCR call of the parse and on most
      // clean captures pure redundancy (skip measured safe by the full gate)
      await readFootBlock();
      var pairB = parseProcPair(footText);
      if (pairT && pairEq(pairT, pairB)) { pair = pairT; pairConf = 0.96; }
      else if (pairEq(pairA, pairB)) { pair = pairA; pairConf = 0.95; }
      else if (pairT) { pair = pairT; pairConf = 0.88; }
      else if (pairA && pairB) { pair = pairA; pairConf = 0.6; }
      else if (pairA) { pair = pairA; pairConf = 0.85; }
      else if (pairB) { pair = pairB; pairConf = 0.7; }
    }
    if (!pair) {
      // LAST-RESORT rescue: on several live shots the located band was the Balance
      // row (the wheel gap measured a few % small) AND the psm6 footer block was
      // cut short by a short-detected panel bottom — every vote failed and the turn
      // silently defaulted to 1. Read a button-focused band that ignores the panel
      // bottom entirely; take the FIRST valid pair (the band starts at the button
      // row, so chat lines below cannot override) at capped confidence.
      var rescueTop = goldY + gap * 2.2;
      var rescueRead = await maskedOcr(
        { x: cx + gap * 0.2, y: rescueTop, w: gap * 2.15, h: Math.max(gap * 0.55, raster.height - rescueTop - 2) },
        dimBtnWhite, { psm: 6 });
      var rm2 = /(\d)\s*[:\/l|.]\s*(\d)\s*[\)\]]?/.exec(normText(rescueRead.text));
      if (rm2) {
        var ra = parseInt(rm2[1], 10), rb = parseInt(rm2[2], 10);
        if ((rb === 5 || rb === 7 || rb === 9) && ra >= 1 && ra <= rb) { pair = { a: ra, b: rb }; pairConf = 0.75; }
      }
    }
    var turnsRemaining = pair ? pair.a : null, maxT = pair ? pair.b : null;
    out.rarity = maxT === 5 ? "uncommon" : maxT === 7 ? "rare" : maxT === 9 ? "epic" : null;
    out.state.maxTurns = maxT;
    out.state.turnsRemaining = turnsRemaining;
    confidence.state.rarity = maxT != null ? pairConf : 0;
    confidence.state.currentTurn = turnsRemaining != null ? pairConf : 0;

    // Processing Cost: when the footer block was SKIPPED, the no-OCR template
    // read goes first (its {450,900,1800} whitelist is the guard); the block's
    // word-anchored regexes remain the primary when the block ran anyway, and
    // the block is only fetched here if the template missed.
    var cval = null;
    var costConf = 0.9;
    var _costTplTried = false;
    // ---- COIN-ANCHORED COST READ (round 7) ----------------------------------
    // The old template rescue below is anchored by a fixed offset: `costZone` runs
    // goldY+1.13..1.63·gap, and the cost row's own text centre was MEASURED across
    // all 385 corpus boards at goldY+1.61·gap (p2 1.50, p98 1.75) — the zone's
    // BOTTOM EDGE cuts the row in half. Hence the residual: 5 boards located
    // nothing, 7 located the outcome-strip band above through the untraced
    // top-edge fallback, 7 reached the ZERO rung and were refused by an iouDigit
    // of 0.63-0.66 on a plainly legible '0'.
    //
    // The game draws its own anchor: a GOLD COIN after the number, and a second
    // identical coin one row below on the Balance line. A vertical PAIR of equal
    // coins is present on 379 of 385 boards (the 6 without are 4 label-masked, one
    // whose panel crop loses the Balance row, and one client that renders the
    // currency SILVER). Pair geometry, measured: pitch 0.24-0.37·gap, top coin
    // 1.79-2.81·gap right of cx and 1.30-2.44·gap below goldY — far wider drift
    // than any fixed offset survives, which is exactly why the offset failed.
    //
    // What the strip left of the coin is read FOR is the DIGIT COUNT, not the
    // digits: the cost is right-aligned and can only be 0, 900 or 1,800, so
    // 1 glyph ⇒ 0, 3 ⇒ 900, 4 (the narrow '1' + comma + 800) ⇒ 1,800. Counting
    // survives the per-glyph classification noise that sinks the value read —
    // iouDigit calls the same '0' anywhere from 0.41 to 1.00 across capture
    // scales. Two independent colour predicates must agree (white text, and a
    // white-or-amber one for the boards where the number carries the game's gold
    // "changed" glow); disagreement means a fragmented segmentation and refuses.
    // Measured over the corpus: 369 read, 369 right, 0 wrong, 11 refused.
    function costCoinRead() {
      if (cval != null || !GLYPHS) return;
      var pz = { x: Math.max(0, cx + gap * 0.3), y: Math.max(0, goldY + gap * 0.50),
                 w: gap * 3.2, h: gap * 2.5 };
      pz.w = Math.min(pz.w, raster.width - pz.x - 1);
      pz.h = Math.min(pz.h, raster.height - pz.y - 1);
      if (pz.w < gap * 0.5 || pz.h < gap * 0.5) return;
      var psub = L.crop(raster, pz), PW = psub.width, PH = psub.height, PD = psub.data;
      var minN = Math.max(12, Math.round(gap * gap * 0.004));
      // COIN pigment: the currency icon is a saturated gold disc. Deliberately
      // wider than isGoldText (s>0.45) — a dim capture drops the coin to s≈0.42.
      // The SILVER pass is a fallback for the one client that renders the currency
      // neutral; it is far less specific than gold, so it runs only when the gold
      // pass finds no PAIR, and the pair/squareness/density guards are what carry
      // it (on the one corpus board where a neutral pass runs and must refuse, the
      // candidates are 23×33 text blobs and the squareness guard rejects them).
      function coinPairFor(pf) {
        var seen = new Uint8Array(PW * PH), coins = [];
        for (var q = 0; q < PW * PH; q++) {
          if (seen[q] || !pf(q * 4)) { seen[q] = 1; continue; }
          var stack = [q], n = 0, x0 = PW, x1 = -1, y0 = PH, y1 = -1;
          seen[q] = 1;
          while (stack.length) {
            var pI = stack.pop(), px = pI % PW, py = (pI / PW) | 0;
            n++;
            if (px < x0) x0 = px; if (px > x1) x1 = px;
            if (py < y0) y0 = py; if (py > y1) y1 = py;
            if (px > 0 && !seen[pI - 1]) { seen[pI - 1] = 1; if (pf((pI - 1) * 4)) stack.push(pI - 1); }
            if (px < PW - 1 && !seen[pI + 1]) { seen[pI + 1] = 1; if (pf((pI + 1) * 4)) stack.push(pI + 1); }
            if (py > 0 && !seen[pI - PW]) { seen[pI - PW] = 1; if (pf((pI - PW) * 4)) stack.push(pI - PW); }
            if (py < PH - 1 && !seen[pI + PW]) { seen[pI + PW] = 1; if (pf((pI + PW) * 4)) stack.push(pI + PW); }
          }
          var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
          if (n < minN) continue;
          // a coin is round and SOLID: the game's gold text, frames and diamond
          // faces all fail one of width, squareness or density
          if (n / (bw * bh) >= 0.55 && bw >= gap * 0.07 && bw <= gap * 0.22 &&
              Math.abs(bw - bh) <= Math.max(3, bw * 0.35)) coins.push({ x: x0, y: y0, w: bw, h: bh });
        }
        coins.sort(function (a, b) { return a.y - b.y; });
        for (var ci = 0; ci < coins.length; ci++) {
          for (var cj = 0; cj < coins.length; cj++) {
            if (ci === cj) continue;
            var ca = coins[ci], cb = coins[cj], dyc = (cb.y + cb.h / 2) - (ca.y + ca.h / 2);
            if (Math.abs((ca.x + ca.w / 2) - (cb.x + cb.w / 2)) <= gap * 0.05 &&
                dyc >= gap * 0.18 && dyc <= gap * 0.38 &&
                Math.abs(ca.w - cb.w) <= gap * 0.03) return { top: ca, n: coins.length };
          }
        }
        return { top: null, n: coins.length };
      }
      var pick = coinPairFor(function (i) {
        var c = L.hsv(PD[i], PD[i + 1], PD[i + 2]);
        return c.h >= 28 && c.h < 62 && c.s > 0.40 && c.v > 0.35;
      });
      var silver = false;
      if (!pick.top) {
        pick = coinPairFor(function (i) {
          var c = L.hsv(PD[i], PD[i + 1], PD[i + 2]);
          return c.s < 0.30 && c.v > 0.55;
        });
        silver = true;
      }
      var top = pick.top;
      if (out._debug) out._debug.costCoin = { n: pick.n, silver: silver, top: top ? [Math.round(pz.x + top.x), Math.round(pz.y + top.y + top.h / 2)] : null };
      if (!top) return;
      var acx = pz.x + top.x, acy = pz.y + top.y + top.h / 2;
      var strip = { x: Math.max(0, acx - gap * 1.25), y: Math.max(0, acy - gap * 0.15),
                    w: gap * 1.21, h: gap * 0.30 };
      // the amber pass: a cost the last outcome CHANGED renders over a gold glow,
      // and the white predicate then loses every digit but the leading '1'
      function whiteOrAmber(r, g, b) {
        var c = L.hsv(r, g, b);
        return (c.s < 0.35 && c.v > 0.55) || (c.h >= 28 && c.h < 65 && c.s > 0.25 && c.v > 0.60);
      }
      function countRun(pred) {
        var tg = templateGlyphs(strip, pred);
        if (!tg || !tg.length) return null;
        var hs = tg.map(function (t) { return t.box.h; }).sort(function (a, b) { return a - b; });
        var med = hs[hs.length >> 1];
        var s0 = tg.length - 1;
        // the thousands comma sits ~0.9 median-heights from the '1', the label a
        // full 1.8+ away: 1.5 separates them (measured, and 2.0 swallows the label)
        while (s0 > 0 && (tg[s0].box.x - (tg[s0 - 1].box.x + tg[s0 - 1].box.w)) < med * 1.5) s0--;
        return { n: tg.length - s0, leftX: tg[s0].box.x, med: med };
      }
      var rW = countRun(dimBtnWhite), rA = countRun(whiteOrAmber);
      function valOf(r) { return r ? (r.n === 1 ? 0 : r.n === 3 ? 900 : r.n === 4 ? 1800 : null) : null; }
      var vW = valOf(rW), vA = valOf(rA);
      if (out._debug) out._debug.costRun = (rW ? rW.n + "@" + rW.leftX : "-") + "/" + (rA ? rA.n + "@" + rA.leftX : "-") +
        " => " + vW + "|" + vA;
      if (vW == null || vW !== vA) return;
      // a number clipped by the strip's own left edge would under-count: refuse it
      // (never observed on the corpus — the widest read, "1,800", leaves 0.5·gap
      // of clearance — but the failure is silent-shaped, so it is guarded)
      if (rW.leftX <= 1) return;
      cval = vW;
      costConf = 0.85;
    }
    costCoinRead();
    function costTemplateRead() {
      if (_costTplTried || cval != null) return;
      _costTplTried = true;
      // TEMPLATE rescue: the footer psm6 block reads garbage on many low-res shots
      // (measured: the cost went unread on 40/56 — the single biggest false-alarm
      // class, every one a wasted "confirm me"). The cost ROW is structurally easy:
      // locate the "Processing Cost   <number>" line, take the TRAILING box run
      // after the last wide gap (right-aligned number; the coin icon is saturated
      // and masked out), template-read the digits, accept only {450, 900, 1800}.
      // NOTE: the "Processing Cost" LABEL is blue-grey and fails the white mask —
      // on many shots the masked row is JUST the right-aligned number (~3 glyphs),
      // so the accept is narrow and the {450,900,1800} whitelist is the real guard.
      var costZone = { x: cx - gap * 2.3, y: goldY + gap * 1.13, w: gap * 4.6, h: gap * 0.5 };
      var costTrace = out._debug ? [] : null;
      var costLn = locateLine(
        costZone,
        dimBtnWhite,
        { maxRowFill: 0.75, minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.2),
          minRowPx: Math.max(3, Math.round(gap * 0.03)), accept: function (r) { return r.w >= gap * 0.22; },
          trace: costTrace });
      if (out._debug) {
        out._debug.costZone = [Math.round(costZone.x), Math.round(costZone.y), Math.round(costZone.w), Math.round(costZone.h)];
        out._debug.costGap = Math.round(gap);
        out._debug.costTrace = costTrace.slice(0, 8).map(function (t) { return JSON.stringify(t); }).join(" ");
        out._debug.costLn = costLn ? { x: Math.round(costLn.x), y: Math.round(costLn.y), w: Math.round(costLn.w), h: Math.round(costLn.h) } : null;
      }
      if (costLn) {
        var tgC2 = templateGlyphs(costLn, dimBtnWhite);
        if (out._debug) out._debug.costTG = tgC2 ? tgC2.map(function (t) { return (t.ch || "?") + ":" + t.score.toFixed(2) + "@" + t.box.x; }).join(" ") : "null";
        if (tgC2 && tgC2.length >= 3) {
          var chs2 = tgC2.map(function (t) { return t.box.h; }).sort(function (a, b) { return a - b; });
          var cmedH2 = chs2[chs2.length >> 1];
          var runStart2 = tgC2.length - 1;
          while (runStart2 > 0 && (tgC2[runStart2].box.x - (tgC2[runStart2 - 1].box.x + tgC2[runStart2 - 1].box.w)) < cmedH2 * 1.5) runStart2--;
          var run2 = tgC2.slice(runStart2);
          // the number is right-aligned: either a trailing run after a wide gap
          // (label survived the mask) or the whole masked line sits right of center
          var wholeLineIsRun = runStart2 === 0 && tgC2.length <= 5 && costLn.x > cx;
          if ((runStart2 > 0 || wholeLineIsRun) && run2.length >= 3 && run2.length <= 5) {
            var digs2 = "";
            for (var ri2 = 0; ri2 < run2.length; ri2++) {
              var rb2 = run2[ri2];
              if (rb2.box.w <= 4 && rb2.box.h <= cmedH2 * 0.4) continue;   // the thousands comma
              var dm2 = iouDigit(tgC2.mask, rb2.box);
              if (!dm2 || dm2.score < 0.3) { digs2 = null; break; }
              digs2 += dm2.ch;
            }
            if (digs2) {
              var cv2 = parseInt(digs2, 10);
              if (cv2 === 450 || cv2 === 900 || cv2 === 1800) { cval = cv2; costConf = 0.85; }
            }
          } else if (runStart2 > 0 && run2.length === 1) {
            // ZERO rung — "Processing Cost 0" is REAL (the -100% outcome landed;
            // two live frames 2026-07-19, iou 0.96 on both). A lone trailing
            // glyph after the wide gap IS the right-aligned value, and 0 is the
            // only 1-digit cost, so demand a STRONG '0' on a round-ish box.
            // (A mask-eaten "900" leaving only its last digit would need the two
            // left digits — same font, same brightness, adjacent — to vanish
            // alone; not a real failure mode outside occlusion, which kills the
            // label boxes this branch requires via runStart2 > 0.)
            var zb = run2[0].box;
            var zd = iouDigit(tgC2.mask, zb);
            if (out._debug) out._debug.costZero = zd ? zd.ch + ":" + zd.score.toFixed(2) : "null";
            if (zd && zd.ch === "0" && zd.score >= 0.7 &&
                zb.h >= cmedH2 * 0.6 && zb.w >= zb.h * 0.45 && zb.w <= zb.h * 1.15) {
              cval = 0; costConf = 0.85;
            }
          }
        }
      }
    }
    if (!footBlockRan) costTemplateRead();   // skip path: the no-OCR read goes first
    if (cval == null) {
      await readFootBlock();
      var costM = footText.match(/cost\D{0,12}?([\d.,]{3,7})/i);
      if (costM) {
        var cv = parseInt(costM[1].replace(/[.,]/g, ""), 10);
        if (cv >= 100 && cv <= 9999) cval = cv;
      }
      if (cval == null) {
        // "1,800" OCRs with the comma as '.', ',' or a bare SPACE ("1 800" — live miss)
        var tokM = footText.match(/(^|\D)(450|900|1[.,\s]?800)(\D|$)/);
        if (tokM) cval = parseInt(tokM[2].replace(/[.,\s]/g, ""), 10);
      }
      if (cval == null) costTemplateRead();
      if (cval == null) {
        // psm6 text zero: the LABEL survives OCR only fuzzily ("Pools nog Jost 0"
        // — live), so anchor on the 'ost' stem then a LONE 0. The non-digit gap
        // cannot skip a leading digit, so 450/900/1,800 (and caption "+100%")
        // can never satisfy this.
        var zM = footText.match(/ost[^\d\n]{0,8}0(?!\d)/i);
        if (zM) { cval = 0; costConf = 0.75; }
      }
    }
    if (cval != null) { out.state.processCost = cval; confidence.state.processCostMultiplier = costConf; }
    if (out.state.processCost == null) confidence.state.processCostMultiplier = 0.3;
    if (out._debug) out._debug.costRead = { footText: footBlockRan ? footText.slice(0, 90) : "(block skipped)", cval: cval };
    })();   // footerPhase — awaited before the outcomes section

    tmark("footerLaunch");
    // ---- reroll pill (ROI-scoped: the "Reset (1/1)" trap can't reach here) ----
    // The pill's full state machine (Shizu, 2026-07-17):
    //   "2/2" greyed  = turn 1 (nothing spent; the DIM text defeated the old white
    //                   mask — this was "rerolls never parse")
    //   "n/m" bright  = free rerolls remaining
    //   gold Charge   = free spent, PAID reroll purchasable  -> model 1
    //   grey Charge   = paid reroll ALSO spent               -> model 0
    var pillRect = geo
      ? rectAround(geo.rerollPill, geo.gap * 0.42, geo.gap * 0.14)
      : L.roiRect(panel, "rerollPill");
    // LINE-LOCATE FIRST (round 2): on drifted framings the anchor-derived rect
    // clips the pill at its corner — and a HALF-CUT "1/2" does not read empty,
    // it reads "2/2" (measured on two live boards: one phantom reroll, and the
    // relocation rescue below never fired because the plain read "succeeded").
    // Locating the text line in the right/down-grown zone up front centers
    // every later read (OCR, template, Charge) on the real pill; well-placed
    // rects locate to themselves and nothing changes.
    {
      var pz0 = { x: pillRect.x, y: pillRect.y, w: pillRect.w + gap * 0.30, h: pillRect.h + gap * 0.24 };
      // BRIGHT-text predicate: the button FACE peaks at v≈0.45-0.55 (measured),
      // so a lower floor floods the mask with the face and the row scan never
      // bands — locate the white "n/m" text itself (dim-state pills keep their
      // existing dilated rescues downstream).
      var pl0Opts = {
        rejectFill: 0.5, maxRowFill: 0.75, minRowPx: 2,
        minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.18),
        accept: function (r) { return r.w >= gap * 0.12 && r.w <= gap * 0.75; }
      };
      var pl0 = L.findMaskedTextLine(raster, pz0, dimBtnWhite, pl0Opts);
      if (!pl0) {
        // chat text leaking into the zone's LEFT edge stretches the band past
        // the width cap (measured: a stray white 's' on the pill row) — retry
        // with the left third cut off; the pill hugs the zone's right side
        var pz1 = { x: pz0.x + gap * 0.35, y: pz0.y, w: pz0.w - gap * 0.35, h: pz0.h };
        pl0 = L.findMaskedTextLine(raster, pz1, dimBtnWhite, pl0Opts);
      }
      if (pl0) {
        var pg0 = Math.round(pl0.h * 0.5);
        pillRect = { x: pl0.x - pg0, y: pl0.y - pg0, w: pl0.w + pg0 * 2, h: pl0.h + pg0 * 2 };
      }
    }
    var pillRead = await maskedOcr(pillRect, dimBtnWhite, { whitelist: "0123456789/", psm: 7 });
    var pillM = pillRead.text.match(/(\d)\s*\/\s*(\d)/);
    // template view of the pill, with the ASPECT rule: '1' is the only narrow digit,
    // and its serif flag makes dim OCR read it as '2' (three live "1/2" pills parsed
    // as 2/2 — one model reroll too many). The box shape is the tiebreaker.
    var tPair = null;
    {
      var tgR = templateGlyphs(pillRect, dimBtnWhite);
      if (tgR) {
        // Anchor on the SLASH and take the POSITIONALLY adjacent boxes. The old
        // rule ("exactly 3 score≥0.75 digit/slash glyphs") had a poisoning hole:
        // the ⟳ icon can template-match a digit (live 5d800868: icon→'3'@0.75+)
        // while the true serif-'1' scores UNDER the filter — the survivors
        // [icon,'/', '2'] then satisfied exactly-3 and "3/2" outvoted a correct
        // OCR "1/2" in arbitration. Adjacency is structural: the numerator is
        // the box immediately left of the '/', and the icon sits a full icon-
        // width further out, so it can never be picked — however it classifies.
        var slashI = -1;
        for (var gi = 0; gi < tgR.length; gi++) if (tgR[gi].ch === "/" && tgR[gi].score >= 0.7) slashI = gi;
        if (slashI > 0 && slashI < tgR.length - 1) {
          var nb = tgR[slashI - 1], db2 = tgR[slashI + 1];
          var gapL = tgR[slashI].box.x - (nb.box.x + nb.box.w);
          var gapR = db2.box.x - (tgR[slashI].box.x + tgR[slashI].box.w);
          var hRef = Math.max(nb.box.h, db2.box.h, tgR[slashI].box.h);
          if (gapL <= hRef * 1.2 && gapR <= hRef * 1.2) {
            // aspect rule FIRST and score-free: '1' is the only narrow digit and
            // its serif flag both misclassifies and UNDER-SCORES at dim tiers
            var rn = nb.box.w / Math.max(1, nb.box.h) < 0.45 ? 1
              : (/^\d$/.test(nb.ch || "") && nb.score >= 0.7 ? parseInt(nb.ch, 10) : null);
            var rd = db2.box.w / Math.max(1, db2.box.h) < 0.45 ? 1
              : (/^\d$/.test(db2.ch || "") && db2.score >= 0.7 ? parseInt(db2.ch, 10) : null);
            if (rn != null && rd != null && rn <= 9 && (rd === 1 || rd === 2)) tPair = { n: rn, d: rd };   // stacked counters (3/2…) legal
          }
        }
      }
    }
    if (pillM) {
      var pa = parseInt(pillM[1], 10), pb = parseInt(pillM[2], 10);
      // rerolls STACK past the denominator (reroll_increase outcomes): 3/2, 5/2…
      // are legal — only the denominator is rarity-bounded (1 or 2)
      if (pa <= 9 && (pb === 1 || pb === 2)) {
        if (tPair && (tPair.n !== pa || tPair.d !== pb)) {
          // disagree → the aspect-checked template wins, flagged for a look
          out.state.rerollsShownFree = tPair.n;
          out.state.rerollsShownDenom = tPair.d;
          confidence.state.rerollsRemaining = 0.75;
        } else {
          out.state.rerollsShownFree = pa;
          out.state.rerollsShownDenom = pb;
          confidence.state.rerollsRemaining = tPair ? 0.92 : 0.9;
        }
      }
    }
    if (out.state.rerollsShownFree == null && tPair) {
      out.state.rerollsShownFree = tPair.n;
      out.state.rerollsShownDenom = tPair.d;
      confidence.state.rerollsRemaining = 0.85;
    }
    if (out.state.rerollsShownFree == null) {
      // CHARGE DETECTION runs BEFORE the dim digit rescue (ORDER MATTERS — live
      // bug 2026-07-18): the rescue OCRs with a digits-only whitelist, which forces
      // Tesseract to TRANSLITERATE a crisp grey "Charge" into digits; at native
      // resolution that hallucinated a two-digit pill and this branch never ran.
      // Confirm the WORD (any brightness), then the BUTTON COLOR decides —
      // gold = paid reroll purchasable (1), grey = paid spent (0).
      var pillCrop = L.crop(raster, pillRect);
      var face = chargeFace(pillRect);
      var chRead = await maskedOcr(pillRect, dimBtnWhite, { psm: 7 });
      var chWord = CHARGE_RX.test(normText(chRead.text));
      if (!chWord && face.amber < CHARGE_AMBER) {
        // the DISABLED (all-spent) Charge renders dimmer than the standard mask
        // floor — retry the word at a low floor with dilation
        var chDimPred = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.4 && c.v > 0.32; };
        var chRead2 = await dilatedOcr(pillCrop, chDimPred, { scale: 3, psm: 7 });
        chWord = CHARGE_RX.test(normText(chRead2.text));
      }
      if (face.amber >= CHARGE_AMBER) {
        out.state.rerollsChargeSeen = true;                       // amber face is decisive
        confidence.state.rerollsRemaining = 0.85;
      } else if (chWord) {
        // Word confirmed, no amber in THIS rect. Re-measure GROWN toward the panel
        // edge before calling it grey — the historical failure is a framing whose
        // anchor-derived rect clips the button (the face then sits up to ~0.45·gap
        // below). The grown rect also reaches the currency coins, which is why this
        // reads a FRACTION: a coin is 0.9% of it and cannot carry the 0.25 bar.
        var grown = chargeFace({
          x: pillRect.x - gap * 0.15, y: pillRect.y - gap * 0.10,
          w: pillRect.w + gap * 0.45, h: pillRect.h + gap * 0.55
        });
        if (grown.amber >= CHARGE_AMBER) {
          out.state.rerollsChargeSeen = true;
          confidence.state.rerollsRemaining = 0.85;
        } else {
          out.state.rerollsChargeSpent = true;                    // grey Charge
          // Decisive only when the rect holds a grey FACE and no amber at all.
          // An in-between reading (partial amber, or a rect that drifted off the
          // button so neither class fills it) still commits — grey is the better
          // guess once the word is confirmed and no amber was found anywhere —
          // but it commits BELOW the flag line so the user is asked to look.
          var decisive = face.amber <= CHARGE_NOAMBER &&
            Math.max(face.neutral, grown.neutral) >= CHARGE_NEUTRAL;
          confidence.state.rerollsRemaining = decisive ? 0.85 : 0.7;
        }
        if (out._debug) out._debug.pillGrown = Math.round(grown.amber * 100) / 100;
      }
      if (out._debug) out._debug.pill = {
        rect: [Math.round(pillRect.x), Math.round(pillRect.y), Math.round(pillRect.w), Math.round(pillRect.h)],
        gap: Math.round(gap * 10) / 10,
        a: Math.round(face.amber * 100) / 100, ne: Math.round(face.neutral * 100) / 100,
        txt: String(chRead.text || "").replace(/\n/g, "|").slice(0, 40), word: chWord,
        dec: out.state.rerollsChargeSeen ? "gold" : (out.state.rerollsChargeSpent ? "grey" : "none")
      };
    }
    if (out.state.rerollsShownFree == null && !out.state.rerollsChargeSeen && !out.state.rerollsChargeSpent) {
      // dim-pill rescue: on dark captures BOTH the plain OCR and the template view
      // come up empty and the snap then DEFAULTS by rarity (three live "1/2" pills
      // became 2/2 → one phantom reroll). Same medicine as the grey captions:
      // dilate + ×3 upscale before OCR. Capped conf — a rescue read stays checkable.
      // (Runs strictly AFTER Charge detection; see the ordering note above.)
      var pillSub = L.crop(raster, pillRect);
      // the pill text can render DIMMER than the standard mask floor (v≈0.55 grey on
      // a dark pill — verified by eye on a live "1 / 2"): use a lower threshold here
      var pillDim = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.35 && c.v > 0.45; };
      var pillR2 = await dilatedOcr(pillSub, pillDim, { scale: 3, whitelist: "0123456789/", psm: 7 });
      var pillM2 = pillR2.text.match(/(\d)\s*\/\s*(\d)/);
      if (!pillM2) {
        // the thin '/' vanishes before the digits do: exactly two digits ⇒ n,d
        var bare = (pillR2.text || "").replace(/\D/g, "");
        if (bare.length === 2 && (bare[1] === "1" || bare[1] === "2")) pillM2 = [null, bare[0], bare[1]];
      }
      if (pillM2) {
        var pa2 = parseInt(pillM2[1], 10), pb2 = parseInt(pillM2[2], 10);
        if (pa2 <= 9 && (pb2 === 1 || pb2 === 2)) {
          out.state.rerollsShownFree = pa2;
          out.state.rerollsShownDenom = pb2;
          confidence.state.rerollsRemaining = 0.75;
        }
      }
    }
    if (out.state.rerollsShownFree == null && !out.state.rerollsChargeSeen && !out.state.rerollsChargeSpent) {
      // PILL RELOCATION rescue (2026-07-19 "2.3%" audit): on some capture framings
      // the anchor-derived pill center sits high-left and the button CLIPS the
      // rect corner — every mask rung then OCRs a truncated line (225202/225159:
      // a plainly visible "1/2" read empty and the snap defaulted to fresh-3).
      // Self-locate the text line in a zone grown toward the panel edge (right/
      // down only — the outcome captions at the left stay out), the idiom every
      // other read uses. The located line is WORD-CHECKED before any digit
      // whitelist touches it (the 2026-07-18 lesson: a digits whitelist
      // transliterates "Charge"), and the commit requires a real slash pair.
      var pzone = { x: pillRect.x, y: pillRect.y, w: pillRect.w + gap * 0.30, h: pillRect.h + gap * 0.24 };
      var pDim2 = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.35 && c.v > 0.45; };
      var pline = L.findMaskedTextLine(raster, pzone, pDim2, {
        rejectFill: 0.5, maxRowFill: 0.75, minRowPx: 2,
        minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.18),
        accept: function (r) { return r.w >= gap * 0.12 && r.w <= gap * 0.75; }
      });
      if (pline) {
        var pgrow = Math.round(pline.h * 0.5);
        var prect2 = { x: pline.x - pgrow, y: pline.y - pgrow, w: pline.w + pgrow * 2, h: pline.h + pgrow * 2 };
        var pChk = await maskedOcr(prect2, pDim2, { psm: 7 });   // unwhitelisted first
        if (!CHARGE_RX.test(normText(pChk.text))) {
          var pReM = pChk.text.match(/(\d)\s*\/\s*(\d)/);
          if (!pReM) {
            var pRe = await dilatedOcr(L.crop(raster, prect2), pDim2, { scale: 3, whitelist: "0123456789/", psm: 7 });
            pReM = pRe.text.match(/(\d)\s*\/\s*(\d)/);
          }
          if (pReM) {
            var pa3 = parseInt(pReM[1], 10), pb3 = parseInt(pReM[2], 10);
            if (pa3 <= 9 && (pb3 === 1 || pb3 === 2)) {
              out.state.rerollsShownFree = pa3;
              out.state.rerollsShownDenom = pb3;
              confidence.state.rerollsRemaining = 0.75;   // rescue read — stays checkable
            }
          }
        }
      }
    }
    if (out.state.rerollsShownFree == null && !out.state.rerollsChargeSeen && !out.state.rerollsChargeSpent) {
      // same clipping, Charge case: the ⟳ icon is absent on Charge pills, so
      // relocation can't fire — retry the WORD on a modestly expanded rect
      // (right/down toward the panel edge only; the gold outcome icons stay
      // outside, so recomputing the gold-face fraction here is safe).
      var chRectW = { x: pillRect.x - gap * 0.15, y: pillRect.y - gap * 0.10, w: pillRect.w + gap * 0.40, h: pillRect.h + gap * 0.24 };
      var chSubW = L.crop(raster, chRectW);
      var chDimPredW = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.4 && c.v > 0.32; };
      var chReadW = await dilatedOcr(chSubW, chDimPredW, { scale: 3, psm: 7 });
      if (out._debug) out._debug.chReadW = String(chReadW.text || "").replace(/\n/g, "|").slice(0, 40);
      if (CHARGE_RX.test(normText(chReadW.text))) {
        // color check on a DEEPER rect than the word read: the gold face can sit
        // below the text rect on drifted framings (live: word hit, face missed).
        // Same FRACTION metric as the primary decision — a compact coin cannot
        // carry it — and a lower bar, since this rect is known to be off-centre.
        var faceW = chargeFace({ x: chRectW.x, y: chRectW.y, w: chRectW.w, h: chRectW.h + gap * 0.30 });
        if (faceW.amber >= 0.18) out.state.rerollsChargeSeen = true;   // gold face
        else out.state.rerollsChargeSpent = true;                    // grey
        confidence.state.rerollsRemaining = 0.7;   // clipped-geometry read — flagged
      }
    }
    if (out.state.rerollsShownFree == null && !out.state.rerollsChargeSeen && !out.state.rerollsChargeSpent) {
      confidence.state.rerollsRemaining = 0.25;
    }

    tmark("pill");
    // ---- reset pill ("Reset (x/1)": x ∈ {0,1}) ----
    // Plain grey text on a dim button, not the reroll pill's colored-diamond icon,
    // so it needs none of that pill's Charge/dim-state machinery: one masked read
    // plus a dilated rescue for low-contrast captures is enough. x is the ONLY
    // free variable (denominator is always 1), so false reads are cheap to reject
    // with a tight regex. Feeds dp.js's Reset gating (model/dp.js topLevelAdvice):
    // resetsRemaining===0 means the reset was already spent and must not be
    // recommended; unparsed (undefined) keeps the historical "assume unused"
    // default so callers that don't read this field are unaffected.
    // Measured 2026-07-20 on both real "already used" samples: the button's grey
    // text tops out at v≈0.5-0.6, under dimBtnWhite's v>0.6 floor, so the plain
    // read misses it on both — same shape as the reroll pill's dim states. Try the
    // tight/bright predicate first anyway (cheap, and may catch a brighter
    // available "(1/1)" state no sample has shown yet), then fall back to a wider
    // dim predicate through the dilated rescue. The ROI itself was tightened to
    // exclude the ornate border glow directly above the button — at the original
    // (taller) crop that glow's highlight streaks passed the dim predicate as
    // false-positive glyphs and broke PSM-7's single-line read entirely.
    var resetRect = geo && geo.resetPill
      ? rectAround(geo.resetPill, gap * 0.85, gap * 0.11)
      : L.roiRect(panel, "resetPill");
    var resetRead = await maskedOcr(resetRect, dimBtnWhite, { whitelist: "Reset()01/ ", psm: 7 });
    var resetM = normText(resetRead.text).match(/reset\D{0,4}([01])\s*[:\/l|.]\s*1\b/i);
    if (!resetM) {
      var resetDimPred = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.4 && c.v > 0.30; };
      var resetSub = L.crop(raster, resetRect);
      var resetR2 = await dilatedOcr(resetSub, resetDimPred, { scale: 3, whitelist: "Reset()01/ ", psm: 7 });
      resetM = normText(resetR2.text).match(/reset\D{0,4}([01])\s*[:\/l|.]\s*1\b/i);
    }
    if (resetM) {
      out.state.resetsRemaining = parseInt(resetM[1], 10);
      confidence.state.resetsRemaining = 0.85;
    }
    // UNREAD stays ABSENT — no low-confidence entry. The advisor window ingests
    // confidence.state keys GENERICALLY into its unconfirmed set, and this field
    // has no rendered control: a 0.2 here made every miss inflate "N fields to
    // double-check" with an entry the user could never see, click, or clear
    // (caught reviewing the PR merge). Absent = the pre-PR contract: dp assumes
    // the reset unused, nothing flags.
    tmark("resetPill");
    // ---- gem name → gemType + baseCost (suffix table) ----
    // Fixed band primary (best measured); if it produces neither the type keyword nor
    // a suffix, retry on a LOCATED line — the name is the only long SATURATED text
    // above the wheel (the gem icon is saturated too but half as wide).
    var namePred = function (r, g, b) { var c = L.hsv(r, g, b); return c.v > 0.45 && c.s > 0.15; };
    var nameRead = await maskedOcr(bandRect(redY - gap * 1.39, 0.17, 1.95), namePred, { psm: 7 });
    if (!/chaos|order/i.test(nameRead.text)) {
      var isNameText = function (r, g, b) { var c = L.hsv(r, g, b); return c.s > 0.28 && c.v > 0.5; };
      var nameZone = { x: cx - gap * 2.0, y: redY - gap * 1.80, w: gap * 4.0, h: gap * 0.85 };
      var nameRect = locateLine(nameZone, isNameText, lineOpts(0.95, 3.4, 0.6));
      if (nameRect) {
        var nameRead2 = await maskedOcr(nameRect, namePred, { psm: 7 });
        if (/chaos|order/i.test(nameRead2.text)) nameRead = nameRead2;
      }
    }
    var nameText = normText(nameRead.text).toLowerCase();
    // The 6 gem names are (type × cost) JOINT: the suffix alone pins BOTH ("Corrosion"
    // is always a chaos-8, "Solidity" always an order-9). The old code read the two
    // independently, so a title whose "Chaos" word was eaten but whose suffix survived
    // still defaulted the type (order→chaos was the #2 production gemType confusion),
    // and vice versa. Score all 6 names jointly: suffix grams + the type keyword.
    var GEM_TITLES = [
      // alt spellings: the ES client's names, gram-scored alongside the English
      // (measured live: "astrogema del aos: distosion" — a Spanish Distortion)
      { sfx: "corrosion", type: "chaos" }, { sfx: "stability", type: "order", alt: ["estabilidad"] },
      { sfx: "distortion", type: "chaos", alt: ["distorsion"] }, { sfx: "solidity", type: "order", alt: ["solidez"] },
      { sfx: "destruction", type: "chaos", alt: ["destruccion"] }, { sfx: "immutability", type: "order", alt: ["inmutabilidad"] },
      // 2026-07-29: "Collapse" (chaos, cost 10) — absent from the vocabulary until
      // now, so a gem carrying it had neither a cost nor a type the title could
      // give. It is ≥6 edits from every other suffix (nearest: solidity 6), so it
      // cannot reach the ≤2 or the d=3-with-margin rung on anything but itself, and
      // the minimum pairwise distance among the suffixes stays 4.
      { sfx: "collapse", type: "chaos" }
    ];
    var kwType = /chaos|caos|xaoc/.test(nameText) ? "chaos" : (/order|orden/.test(nameText) ? "order" : null);
    var titleLetters = nameText.replace(/[^a-z]/g, "");
    // 5-gram coverage + prefix bonus (the discriminative START of the word), the
    // proven anti-"immutaBILITY-contains-staBILITY" scorer, now per (type,cost) name.
    function gramScoreOne(sfx) {
      if (nameText.indexOf(sfx) !== -1) return 1.3;   // verbatim hit outranks any gram tally
      var hits = 0, total = 0;
      for (var k = 0; k + 5 <= sfx.length; k++) {
        total++;
        if (titleLetters.indexOf(sfx.slice(k, k + 5)) !== -1) hits++;
      }
      var score = total ? hits / total : 0;
      if (titleLetters.indexOf(sfx.slice(0, 5)) !== -1) score += 0.25;   // prefix bonus
      return score;
    }
    // EDIT-DISTANCE rung (round 3): a mangled-but-whole suffix defeats the
    // 5-gram scorer completely — live "distartjon" (distortion, 2 subs) and
    // "soliinty" (solidity) both scored 0.00 and lost to array order. The six
    // suffixes sit far apart (measured pairwise minimum 4: stability↔solidity,
    // stability↔immutability, distortion↔destruction), so distance ≤2 on a
    // long token identifies uniquely. Levenshtein, abandoned past maxD.
    function editDist(a, b, maxD) {
      if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
      var prev = [], cur = [], i, j;
      for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        cur[0] = i;
        var rowMin = i;
        for (j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
          if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > maxD) return maxD + 1;
        var tmp = prev; prev = cur; cur = tmp;
      }
      return Math.min(prev[b.length], maxD + 1);
    }
    var titleToks = nameText.split(/[^a-z]+/).filter(function (tk) { return tk.length >= 6; });
    // best token distance per gem suffix, its own spelling and localized alts
    function edTable() {
      var best = {};
      GEM_TITLES.forEach(function (t) {
        var d = 6;
        [t.sfx].concat(t.alt || []).forEach(function (s) {
          if (s.length < 8) return;   // long class words only — short fragments stay out
          for (var ti = 0; ti < titleToks.length; ti++) {
            // maxD 5, not 3: the d=3 rung below tests the MARGIN to the
            // runner-up, and a cap at 4 flattens every rival to the same 4 and
            // erases exactly the margin being measured
            var dd = editDist(titleToks[ti], s, 5);
            if (dd < d) d = dd;
          }
        });
        best[t.sfx] = d;
      });
      return best;
    }
    function computeTitleScores() {
      // DISTANCE-3 rung: at d=3 the triangle inequality alone leaves a rival as
      // close as 1 away, so a bare threshold is unsafe — but a 2-distance
      // MARGIN over the runner-up is decisive, and the whole rung is priced at
      // 0.45, inside the 0.38-0.5 SOFT band, so it can only ever commit a
      // FLAGGED value. Live case: "stabnigy" (stability 3, solidity 5,
      // immutability 7) — the read the gram scorer and the ≤2 rung both miss.
      // The ever-present decoy token "astrogem" sits ≥7 from every suffix.
      var edT = edTable();
      var ds = GEM_TITLES.map(function (t) { return edT[t.sfx]; }).sort(function (a, b) { return a - b; });
      var edBest = ds[0], edSecond = ds[1];
      return GEM_TITLES.map(function (t) {
        var d = edT[t.sfx];
        var edS = d <= 1 ? 0.9 : d === 2 ? 0.6
          : (d === 3 && d === edBest && edSecond - d >= 2) ? 0.45 : 0;
        var s = Math.max(gramScoreOne(t.sfx), edS);
        (t.alt || []).forEach(function (a) { s = Math.max(s, gramScoreOne(a)); });
        t.sfxScore = s;
        // the type keyword is corroborating, not deciding: the suffix still wins a
        // conflict (a mangled "Order" can gram-match nothing, never the wrong word)
        if (kwType) s += (kwType === t.type) ? 0.2 : -0.2;
        return { t: t, score: s };
      }).sort(function (a, b) { return b.score - a.score; });
    }
    var titleScores = computeTitleScores();
    // TITLE RESCUE rung (round 3): the generic namePred (v>0.45, s>0.15) keeps
    // so much starfield and nebula that Tesseract returns empty/garbage on a
    // PERFECTLY legible band (pixel-verified: "Order Astrogem: Solidity"
    // plainly visible, OCR text ""). A hue-tight mask isolates the title —
    // but the title ink is RARITY-coloured, not one colour. Measured over the
    // whole corpus by widest-located-line: magenta(epic) 174, cyan(rare) 89,
    // orange(legendary/relic) 31, blue-violet 7, gold 3 — a magenta-only mask
    // was blind on 120 boards. Locate the line under EACH family (mask + row
    // scan, no OCR), then OCR the best few. Runs only when the primary reads
    // identified NO suffix (score under the 0.38 soft bar) — empty text, star
    // junk and kw-only fragments all land here — and whatever it reads must
    // out-SCORE what the primary got, so a rescue can only ever improve the
    // identification.
    if (titleScores[0].t.sfxScore < 0.38) {
      // SNAPSHOT the primary's score as a NUMBER before anything rescores:
      // t.sfxScore lives on the shared GEM_TITLES objects and every recompute
      // overwrites it, so a later read of titleScores[0].t.sfxScore compares
      // the rescue against ITSELF. Measured: whenever the primary's garbage
      // text happened to rank the same suffix first (the array-order tie, i.e.
      // most garbage reads) the guard silently refused a perfect rescue — two
      // pixel-verified boards read "Order Astrogem: Stability" and kept the
      // default cost anyway.
      var keepText = nameText, keepLetters = titleLetters, keepToks = titleToks, keepKw = kwType;
      var keepVal = titleScores[0].t.sfxScore + (kwType ? 0.2 : 0);
      function letterLen(s2) { return s2.replace(/[^a-z]/g, "").length; }
      // install a candidate text, score it, put the old one back
      function scoreCandidateText(tx) {
        nameText = tx;
        titleLetters = tx.replace(/[^a-z]/g, "");
        titleToks = tx.split(/[^a-z]+/).filter(function (tk) { return tk.length >= 6; });
        kwType = /chaos|caos|xaoc/.test(tx) ? "chaos" : (/order|orden/.test(tx) ? "order" : null);
        var sc = computeTitleScores();
        var v = sc[0].t.sfxScore + (kwType ? 0.2 : 0);
        nameText = keepText; titleLetters = keepLetters; titleToks = keepToks; kwType = keepKw;
        return v;
      }
      // magenta(epic) · cyan(rare) · orange(legendary/relic) · blue-violet · gold,
      // in the corpus-frequency order round 3 measured — plus GREEN for UNCOMMON
      // gems (2026-07-29: a pixel-verified "Processed Order Astrogem: Stability"
      // renders its title in green ink, and every mask above is blind on it).
      var TITLE_HUES = [[275, 345], [165, 212], [8, 30], [240, 275], [30, 62], [80, 150]];
      var titleZone = { x: cx - gap * 2.0, y: redY - gap * 1.80, w: gap * 4.0, h: gap * 0.85 };
      var titleOpts = lineOpts(0.95, 3.4, 0.6);
      var tCands = [];
      TITLE_HUES.forEach(function (hw, hi) {
        var pred = function (r, g, b) {
          var c = L.hsv(r, g, b);
          return c.h >= hw[0] && c.h <= hw[1] && c.s > 0.28 && c.v > 0.45;
        };
        var rct = locateLine(titleZone, pred, titleOpts);
        if (rct) tCands.push({ rect: rct, pred: pred, w: rct._line.w, ord: hi });
      });
      if (out._debug) out._debug.titleCands = tCands.map(function (c2) { return Math.round(c2.w / gap * 100) / 100; }).join(",");
      // TWO passes over the families that located ink. Pass 1 reads the FIXED
      // band under each family's mask, in corpus-frequency order — the band
      // read needs no successful locate, and locating is the fragile half: on
      // two boards the magenta locate came back only the FOURTH-widest line
      // (ornament streaks in other hue families out-width the title) while the
      // magenta FIXED band read "Chaos Astrogem: Distortion" cleanly. Pass 2
      // reads the located rect for the widest three, which is what saves the
      // boards whose title sits off the fixed row. psm 7 first, then RAW-LINE
      // psm 13 when 7 comes back short: psm 7 runs Tesseract's line-layout
      // heuristics and on these narrow masked crops they reject the line
      // outright (three boards whose mask renders a flawless "Order Astrogem:
      // Solidity" gave "" at every scale under psm 7 and the correct string
      // under psm 13). All of it is paid only on boards the primary read
      // already failed, and the loop stops the moment a read is both
      // keyword-bearing and hard-commit grade.
      var titleFixed = bandRect(redY - gap * 1.39, 0.2, 1.95);
      var tries = [];
      tCands.forEach(function (c2) { tries.push({ rect: titleFixed, pred: c2.pred, ord: c2.ord }); });
      tries.sort(function (a, b) { return a.ord - b.ord; });
      tCands.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 3)
        .forEach(function (c2) { tries.push({ rect: c2.rect, pred: c2.pred }); });
      var bestTxt = null, bestVal = keepVal, done = false;
      for (var tci = 0; tci < tries.length && !done; tci++) {
        var tRead = await maskedOcr(tries[tci].rect, tries[tci].pred, { psm: 7 });
        var tTxt = normText(tRead.text).toLowerCase();
        if (letterLen(tTxt) < 8) {
          var tRead13 = await maskedOcr(tries[tci].rect, tries[tci].pred, { psm: 13 });
          var tTxt13 = normText(tRead13.text).toLowerCase();
          if (letterLen(tTxt13) > letterLen(tTxt)) tTxt = tTxt13;
        }
        if (out._debug) (out._debug.titleTry = out._debug.titleTry || []).push(tTxt.slice(0, 40));
        if (letterLen(tTxt) < 8) continue;
        var tVal = scoreCandidateText(tTxt);
        if (tVal > bestVal) { bestVal = tVal; bestTxt = tTxt; }
        if (bestTxt && bestVal >= 0.7) done = true;   // kw + hard-commit suffix
      }
      if (bestTxt) {
        nameText = bestTxt;
        titleLetters = nameText.replace(/[^a-z]/g, "");
        titleToks = nameText.split(/[^a-z]+/).filter(function (tk) { return tk.length >= 6; });
        kwType = /chaos|caos|xaoc/.test(nameText) ? "chaos" : (/order|orden/.test(nameText) ? "order" : null);
        if (out._debug) out._debug.titleRescue = bestTxt.slice(0, 48);
      }
      // recompute either way: scoreCandidateText left t.sfxScore describing
      // whatever text it looked at last
      titleScores = computeTitleScores();
    }
    var titleBest = titleScores[0], titleSecond = titleScores[1];
    var suffixHit = null, suffixAmbig = false;
    if (titleBest.t.sfxScore >= 0.38) {
      suffixHit = titleBest.t.sfx;
      // ambiguity on the COST only: the runner-up that matters is the best title
      // with a DIFFERENT cost (same-cost other-type ties are harmless here).
      // The 0.38-0.5 band is a SOFT commit (heavy degradation / localized
      // spellings land there): always ambiguous-grade confidence, and only
      // with a real margin over the cost rival.
      var rivalCost = null;
      for (var ts = 1; ts < titleScores.length; ts++) {
        if (GEM_NAME_COST[titleScores[ts].t.sfx] !== GEM_NAME_COST[suffixHit]) { rivalCost = titleScores[ts]; break; }
      }
      suffixAmbig = rivalCost != null && (titleBest.score - rivalCost.score) < 0.15;
      if (titleBest.t.sfxScore < 0.5) {
        if (suffixAmbig) suffixHit = null;
        else suffixAmbig = true;
      }
    }
    // gemType: keyword when present (the proven 0.9 signal); else the suffix's type —
    // a real suffix identification implies the type at the same evidence level.
    out.config.gemType = kwType || (suffixHit ? (titleBest.t.type) : null);
    confidence.config.gemType = kwType ? 0.9 : (suffixHit ? (suffixAmbig ? 0.6 : 0.8) : 0);
    if (suffixHit) { out.config.baseCost = GEM_NAME_COST[suffixHit]; confidence.config.baseCost = suffixAmbig ? 0.6 : 0.85; }
    else confidence.config.baseCost = 0;
    if (out._debug) out._debug.title = { text: nameText.slice(0, 48), kw: kwType, best: titleBest.t.sfx + "@" + titleBest.score.toFixed(2), second: titleSecond.t.sfx + "@" + titleSecond.score.toFixed(2) };

    tmark("gemName");
    // ---- wheel levels (gold digits) + effect hue references ----
    var patchHalf = Math.max(4, gap * 0.06);
    function nodeColor(p) { return L.medianPatch(raster, p.x, p.y, patchHalf); }
    var colW = nodeColor(nodes.nodeW), colE = nodeColor(nodes.nodeE);
    var hueW = L.hsv(colW[0], colW[1], colW[2]).h, hueE = L.hsv(colE[0], colE[1], colE[2]).h;

    // Level text sits INSIDE each diamond (name line(s) then the level line, all
    // centered on the node): W/E render "Lv. N", N and S render a bare gold digit.
    // Instead of committing a single digit per node, we produce a SCORE VECTOR over
    // {1..5} (template similarity to the game's own glyph art) and let the joint
    // constraint solve below pick the assignment. `dilate` retries reconnect strokes
    // that antialiasing broke on downscaled captures.
    // A box is a DIGIT candidate only if its best match over the FULL atlas is a
    // gold digit (g1-5) — otherwise the "L"/"v" of "Lv." spuriously matches g5 and we
    // read the wrong box. Returns the g1-5 score vector + whether it's really a digit.
    // Gold level digits are the SAME glyph shapes as the white footer digits once
    // chroma-masked (color-independent silhouettes), so both match ONE digit template
    // set '0'-'9'. (The separate gold 'g1-g5' templates were a harvest artifact —
    // they'd grabbed the diamond ▲ tip, identical across values, so 1/2/3/4 scored
    // flat and couldn't discriminate.)
    function digitScoreVec(mask, box) {
      var bm = L.glyphBitmap(mask, box), vec = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, top = 0;
      for (var v = 1; v <= 5; v++) {
        var t = GLYPHS && GLYPHS["" + v];
        var s = t ? L.bitmapSim(bm, t) : 0;
        vec[v] = s; if (s > top) top = s;
      }
      var full = GLYPHS ? L.matchGlyph(mask, box, GLYPHS) : null;
      var isDigit = full && /^[1-5]$/.test(full.ch);
      return { vec: vec, top: top, isDigit: isDigit, full: full };
    }
    // ---- ANALYSIS-BY-SYNTHESIS level rescue (2026-07-19) ----
    // The method that finally read the degraded-tier digits classically: pristine
    // 32×32 reference patches (ocr/level-refs.js, native-tier harvest) are BLURRED
    // to candidate degradations and correlated against the observed patch over a
    // sub-pixel alignment grid. Scored two independent ways (raw luminance +
    // gradient magnitude); a value commits ONLY when both scorings rank the same
    // digit first with a real gradient margin — on the measured corpus that gate
    // shipped 8 correct commits and refused every wrong one. Fires only when the
    // template AND OCR ladders both came back empty, so clean frames never pay.
    var SYNTH_PS = 32, SYNTH_PATCH_GAP = 0.13;
    // CENTER WINDOW (round 3): both correlation channels weight the patch
    // center. Post-alignment the DIGIT is central and the face ART is
    // peripheral — several W:2 refs carry the green face's bright diagonal
    // rays in their corners, and on ray-art boards a digit-free streak patch
    // grad-correlated 0.70+ with them at light blur (the confident-wrong
    // W=2-for-1 family: the background, not the digit, was doing the
    // matching). Gaussian σ=9px with a 0.25 floor (σ=12/0.4 was tried and lost the discrimination — refw re-committed its wrong '2'; the no-checksum refusal fallout is handled at the solve's fallback instead): the periphery still
    // whispers (offset serifs, the '2' base bar) but can no longer outvote
    // the digit. GRADIENT CHANNEL ONLY, refs and observations identically;
    // magnitudes are windowed AFTER differentiation so the window itself
    // contributes no fake edges. The RAW channel stays unwindowed — measured:
    // windowed dense luminance at heavy blur collapses every class into the
    // same central blob (an N raw flipped 1→4 on a true-1 board), while the
    // sparse edge map only sheds its peripheral art.
    var _synthWin = (function () {
      var w = new Float32Array(SYNTH_PS * SYNTH_PS), c = (SYNTH_PS - 1) / 2, s2 = 2 * 9 * 9;
      for (var y = 0; y < SYNTH_PS; y++) for (var x = 0; x < SYNTH_PS; x++) {
        var r2 = (x - c) * (x - c) + (y - c) * (y - c);
        w[y * SYNTH_PS + x] = 0.25 + 0.75 * Math.exp(-r2 / s2);
      }
      return w;
    })();
    function _synthWinMul(p2) {
      var out = new Float32Array(p2.length);
      for (var i = 0; i < p2.length; i++) out[i] = p2[i] * _synthWin[i];
      return out;
    }
    function _synthZnorm(p2) {
      var out = new Float32Array(p2.length), mean = 0, i;
      for (i = 0; i < p2.length; i++) mean += p2[i];
      mean /= p2.length;
      var va = 0;
      for (i = 0; i < p2.length; i++) { out[i] = p2[i] - mean; va += out[i] * out[i]; }
      var sd = Math.sqrt(va / p2.length) || 1;
      for (i = 0; i < out.length; i++) out[i] /= sd;
      return out;
    }
    function _synthGradMag(p2) {
      var PSZ = SYNTH_PS, g = new Float32Array(PSZ * PSZ);
      for (var y = 1; y < PSZ - 1; y++) for (var x = 1; x < PSZ - 1; x++) {
        var dx = p2[y * PSZ + x + 1] - p2[y * PSZ + x - 1], dy = p2[(y + 1) * PSZ + x] - p2[(y - 1) * PSZ + x];
        g[y * PSZ + x] = Math.sqrt(dx * dx + dy * dy);
      }
      return g;
    }
    function _synthGrad(p2) { return _synthZnorm(_synthWinMul(_synthGradMag(p2))); }
    // unwindowed gradient — the AMOUNT synth's channel: the window measurably
    // flipped amount reads (an agreeing-wrong '1' for a '+3', and a clean '3'
    // margin collapsed to 0.001) while the LEVEL consults measurably need it;
    // outcome-cell backgrounds are not diamond face art, so the two contexts
    // get their own calibrations.
    function _synthGradPlain(p2) { return _synthZnorm(_synthGradMag(p2)); }
    function _synthBlur(p2, sigma) {
      var PSZ = SYNTH_PS;
      var r = Math.max(1, Math.ceil(sigma * 2.5)), k = [], ks = 0, i;
      for (i = -r; i <= r; i++) { var v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
      for (i = 0; i < k.length; i++) k[i] /= ks;
      var tmp = new Float32Array(PSZ * PSZ), out = new Float32Array(PSZ * PSZ), x, y, s, j;
      for (y = 0; y < PSZ; y++) for (x = 0; x < PSZ; x++) {
        s = 0;
        for (j = -r; j <= r; j++) s += p2[y * PSZ + Math.max(0, Math.min(PSZ - 1, x + j))] * k[j + r];
        tmp[y * PSZ + x] = s;
      }
      for (y = 0; y < PSZ; y++) for (x = 0; x < PSZ; x++) {
        s = 0;
        for (j = -r; j <= r; j++) s += tmp[Math.max(0, Math.min(PSZ - 1, y + j)) * PSZ + x] * k[j + r];
        out[y * PSZ + x] = s;
      }
      return out;
    }
    function _synthCos(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; }
    function _synthPatch(cx, cy) {
      var PSZ = SYNTH_PS, side = SYNTH_PATCH_GAP * gap, out = new Float32Array(PSZ * PSZ);
      var W2 = raster.width, H2 = raster.height, d = raster.data;
      for (var py = 0; py < PSZ; py++) for (var px = 0; px < PSZ; px++) {
        var sx = cx - side / 2 + (px + 0.5) * side / PSZ, sy = cy - side / 2 + (py + 0.5) * side / PSZ;
        var x0 = Math.max(0, Math.min(W2 - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(H2 - 1, Math.floor(sy)));
        var x1 = Math.min(W2 - 1, x0 + 1), y1 = Math.min(H2 - 1, y0 + 1);
        var fx = sx - x0, fy = sy - y0;
        function lumAt(xx, yy) { var ii = (yy * W2 + xx) * 4; return 0.299 * d[ii] + 0.587 * d[ii + 1] + 0.114 * d[ii + 2]; }
        out[py * PSZ + px] = lumAt(x0, y0) * (1 - fx) * (1 - fy) + lumAt(x1, y0) * fx * (1 - fy) +
                             lumAt(x0, y1) * (1 - fx) * fy + lumAt(x1, y1) * fx * fy;
      }
      return out;
    }
    function _synthVariants() {
      // Variant sets are TIER-SELECTED (round 2): the parse knows its own
      // normalization factor, and domain proximity was the measured round-1
      // stratification lesson — so a native parse correlates against sharp
      // refs at light blurs and a ×2/×3 parse against small-monitor refs at
      // heavy blurs, instead of every parse paying for (and being confused
      // by) the full cross-product. This also cut the consult's compute ~2×;
      // with the enumeration now consulting every free node, that matters in
      // the browser too. Cache keyed per band at module scope.
      var band = scaleF >= 3 ? "u3" : scaleF >= 2 ? "u2" : "n";
      if (!LREFS) return null;
      if (_synthTVCache && _synthTVCache[band]) return _synthTVCache[band];
      // Per-NODE budgets: W/E consults run on a TIGHT line-anchored grid (cheap)
      // and measurably lose accuracy when their pools are leaned (effect1Level
      // dropped 82→75 on the lean sets), so they keep the full exemplar/sigma
      // spread. N/S consults run WIDE fallback grids (the expensive path), so
      // they get tier-matched refs at four sigmas — domain proximity was the
      // round-1 stratification lesson, applied at match time.
      var SIG_FULL = [0.6, 1.0, 1.5, 2.1, 2.8, 3.6];
      var SIG_LEAN = band === "n" ? [0.6, 1.0, 1.5, 2.1] : band === "u2" ? [1.0, 1.5, 2.1, 2.8] : [1.5, 2.1, 2.8, 3.6];
      var G0_PREF = band === "n"
        ? function (g) { return g >= 160; }
        : band === "u2"
          ? function (g) { return g < 180; }
          : function (g) { return g < 150; };
      var _synthTV = {};
      // per-node reference pools ONLY: pooling W↔E was tried (same font, and
      // doubling exemplars is tempting) and produced the one agreeing-wrong
      // commit ever measured (share-W read 2 for a 1) — the face-gradient
      // difference matters more than exemplar count
      ["N", "S", "W", "E"].forEach(function (k) {
        var lean = k === "N" || k === "S";
        var sigmas = lean ? SIG_LEAN : SIG_FULL;
        _synthTV[k] = {};
        Object.keys(LREFS[k] || {}).forEach(function (cls) {
          var all = LREFS[k][cls] || [];
          var pref = all;
          if (lean) {
            pref = all.filter(function (r) { return G0_PREF(r.g0); });
            if (pref.length < 2) pref = all;   // starved class: take everything
            pref = pref.slice(0, 4);
          }
          var arr = _synthTV[k][cls] = [];
          pref.forEach(function (ref) {
            var base = new Float32Array(ref.q);
            sigmas.forEach(function (sg) {
              var b = _synthBlur(base, sg);
              arr.push({ raw: _synthZnorm(b), grad: _synthGrad(b) });
            });
          });
        });
      });
      _synthTVCache = _synthTVCache || {};
      _synthTVCache[band] = _synthTV;
      return _synthTV;
    }
    // Memoized per parse: the same node consults from up to three rungs (no-line
    // rescue, template cross-check, OCR arbitration) plus the enumeration votes
    // below — the scan grid is the engine's most expensive classical read, and
    // it is deterministic for a given raster, so one run serves them all.
    // CONTRACT (round 2): returns null only when no refs/scores exist at all;
    // otherwise ALWAYS an object { value, conf, gm, gradTop, rawTop, agree } —
    // value stays null on a refused commit (channels disagree / margin under
    // the gate), but the channel tops remain visible so the joint solve can use
    // a refused consult as tie-break EVIDENCE (the synthAmountDigit precedent:
    // gradient is the transferable channel).
    var _synthMemo = {};
    function synthLevelRescue(kind, p) {
      if (_synthMemo[kind] !== undefined) return _synthMemo[kind];
      return (_synthMemo[kind] = _synthLevelRescueRaw(kind, p));
    }
    function _synthLevelRescueRaw(kind, p) {
      var dbgS = out._debug ? ((out._debug.synth = out._debug.synth || {})) : null;
      var tv = _synthVariants();
      if (!tv || !tv[kind] || !Object.keys(tv[kind]).length) { if (dbgS) dbgS[kind] = "no-refs"; return null; }
      var cx, cy, wideScan = false, altCenter = null;
      if (kind === "N" || kind === "S") {
        // INK LOCATE (round 2): the bare digit's offset below the anchor varies
        // per board (+0.03 gap measured on a 2-line "Willpower Efficiency"
        // board vs the +0.175 typical) — a fixed offset made the observed patch
        // miss the digit entirely and the correlation then ran on face texture
        // (the confident N='4'-for-'1' family). The digit is the only VIVID
        // gold blob in its search window; its centroid anchors the patch. BUT
        // fiery red faces pollute the mask enough to drift the centroid off the
        // digit (measured: a previously-committing N=3 refused), so BOTH
        // centers are scanned — the located one and the fixed offset — and the
        // per-class maxima merge across the union; correlation decides which
        // anchor was real. The SAME locator harvests refs in
        // tools/build-level-refs.js — change the two together or not at all.
        cx = p.x; cy = p.y + gap * 0.175;
        var bdPred = kind === "S"
          ? function (r2, g2, b2) { var c2 = L.hsv(r2, g2, b2); return c2.h >= 42 && c2.h <= 64 && c2.s > 0.72 && c2.v > 0.7; }
          : function (r2, g2, b2) { var c2 = L.hsv(r2, g2, b2); return c2.h >= 35 && c2.h <= 65 && c2.s > 0.5 && c2.v > 0.6; };
        var bdRect = { x: p.x - gap * 0.28, y: p.y - gap * 0.05, w: gap * 0.56, h: gap * 0.37 };
        var bdSt = L.colorClusterStats(L.crop(raster, bdRect), bdPred);
        if (bdSt.count >= gap * gap * 0.0006 && bdSt.count <= gap * gap * 0.02 && bdSt.density >= 0.15) {
          var lcx = Math.max(0, Math.round(bdRect.x)) + bdSt.cx;
          var lcy = Math.max(0, Math.round(bdRect.y)) + bdSt.cy;
          if (Math.hypot(lcx - cx, lcy - cy) > gap * 0.02) altCenter = { x: lcx, y: lcy };
          else { cx = lcx; cy = lcy; }
        } else {
          // NO ink locate at all: the refs are digit-CENTERED now, and a
          // fixed-offset observation can sit a whole digit-height off them
          // (the round-2 N/S collapse: willpower 87→78 with tight scans) —
          // widen the grid so the correlation can find the alignment itself.
          wideScan = true;
        }
      }
      else {
        // W/E: anchor on the BELOW-CENTER Lv line (the caption band above is a trap)
        var lbox = { x: p.x - gap * 0.5, y: p.y - gap * 0.02, w: gap * 1.0, h: gap * 0.38 };
        var lopts = {
          rejectFill: 0.22, maxRowFill: 0.6,
          minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.22), minRowPx: 3,
          accept: function (r) { return Math.abs(r.x + r.w / 2 - p.x) <= gap * 0.28 && r.w >= gap * 0.03 && r.w <= gap * 0.85; }
        };
        var lline = L.findMaskedTextLine(raster, lbox, L.isGoldText, lopts);
        if (!lline) lline = L.findMaskedTextLine(raster, lbox, L.isGoldText, Object.assign({}, lopts, { minRowPx: 1 }));
        if (!lline) {
          var lrelax = function (r2, g2, b2) { var c2 = L.hsv(r2, g2, b2); return c2.h >= 28 && c2.h <= 72 && c2.s > 0.28 && c2.v > 0.42; };
          lline = L.findMaskedTextLine(raster, lbox, lrelax, Object.assign({}, lopts, { minRowPx: 1 }));
        }
        if (lline && lline.w >= gap * 0.18) {
          cx = lline.x + lline.w - gap * 0.05; cy = lline.y + lline.h / 2;
        } else if (lline && lline.w >= gap * 0.07) {
          // FRAGMENT line (round 3): the mask kept the "Lv." prefix but the
          // digit eroded out — the lo-tier NORM, not an edge case (measured:
          // 114 of 604 W/E line locates come back 0.12-0.13 gap wide, the
          // prefix's exact width). The digit sits just right of the fragment,
          // so anchor a MODERATE scan there. The fragment can also be garbage
          // (t8-E once anchored off a glow blob), so the old wide center runs
          // as a SECOND candidate — the per-center decisiveness sort picks the
          // anchor that found real structure.
          cx = lline.x + lline.w + gap * 0.02; cy = lline.y + lline.h / 2;
          altCenter = { x: p.x + gap * 0.125, y: p.y + gap * 0.17, xs: 0.145, ys: 0.12 };
          wideScan = true;
        } else {
          // NO locatable line at all: position becomes a fitted parameter.
          // Center at +0.125 with reach 0.145 (round 3, was 0.16±0.11): the
          // "Lv. N" TEXT is node-centered, so a narrow digit ('1') pulls the
          // whole line left and the digit lands near node-center x — measured
          // -0.148 gap from the old center, OUTSIDE its reach. The old scan
          // geometrically could not see a '1', and class-2 refs won on face
          // texture instead (the 2-for-1 ×16 family). New reach [-0.02,+0.27]
          // covers both the '1' zone and the wide-digit zone.
          cx = p.x + gap * 0.125; cy = p.y + gap * 0.17; wideScan = true;
        }
      }
      var isBare = kind === "N" || kind === "S";
      // bare-node wide scans reach UP to +0.03 gap (2-line-name boards render
      // the digit right under the name, far above the +0.175 fixed offset).
      // W/E wide default 0.145 matches the no-line center above; a FRAGMENT
      // primary center scans tighter (its xs/ys override) — the digit sits
      // within ~0.08 gap of the fragment's right edge when the fragment is real.
      var xspan = wideScan ? (isBare ? 0.06 : (altCenter && !isBare ? 0.08 : 0.145)) : (kind === "W" || kind === "E") ? 0.07 : 0.03;
      var yspan = wideScan ? (isBare ? 0.15 : (altCenter && !isBare ? 0.05 : 0.12)) : 0.03;
      var dy, dx, cls, i;
      // Each candidate center is scored SEPARATELY (a union of maxima mixes one
      // center's face-texture matches into the other's digit evidence — measured:
      // raw voted '1' off center A while grad voted '4' off center B and a real
      // '3' drowned). The center whose ranking is more DECISIVE (larger gradient
      // margin) wins; the commit gate then runs on that center's scores alone.
      // A center may carry its own spans (xs/ys — the W/E fragment second
      // center scans the full wide region while the primary hugs the fragment).
      var centers = [{ x: cx, y: cy }];
      if (altCenter) centers.push(altCenter);
      // BARE-node wide scans step at 2× pitch: the refs are BLURRED variants,
      // so the correlation peak is broad and half-pitch sampling finds it —
      // full pitch made the (very common) bare-node fallback ~4× the whole
      // parse's compute. W/E wide scans are rare (line-missing boards only)
      // and keep full pitch.
      var step = wideScan && isBare ? 0.015 : 0.0075;
      var scored = centers.map(function (ctr) {
        // TIGHT scans evaluate both channels at every position (the proven
        // round-1 behavior). WIDE scans (the expensive N/S fallback) go
        // two-phase: gradient-only over the grid (the transferable channel
        // does the position search), then raw at each class's grad-best
        // position — the channels then discuss the same alignment hypothesis
        // and the scan's compute halves.
        var pr = {}, pg = {}, bestPos = {};
        var xs = ctr.xs != null ? ctr.xs : xspan, ys = ctr.ys != null ? ctr.ys : yspan;
        for (dy = -ys; dy <= ys + 0.0001; dy += step) {
          for (dx = -xs; dx <= xs + 0.0001; dx += step) {
            var op = _synthPatch(ctr.x + dx * gap, ctr.y + dy * gap);
            var ograd = _synthGrad(op);
            var oraw = wideScan ? null : _synthZnorm(op);
            for (cls in tv[kind]) {
              var arr = tv[kind][cls];
              for (i = 0; i < arr.length; i++) {
                var sg = _synthCos(ograd, arr[i].grad);
                if (!(cls in pg) || sg > pg[cls]) { pg[cls] = sg; bestPos[cls] = { dx: dx, dy: dy }; }
                if (oraw) {
                  var sr = _synthCos(oraw, arr[i].raw);
                  if (!(cls in pr) || sr > pr[cls]) pr[cls] = sr;
                }
              }
            }
          }
        }
        if (wideScan) {
          for (cls in tv[kind]) {
            var bp = bestPos[cls];
            if (!bp) { pr[cls] = -1; continue; }
            var op2 = _synthPatch(ctr.x + bp.dx * gap, ctr.y + bp.dy * gap);
            var oraw2 = _synthZnorm(op2);
            var arr2 = tv[kind][cls], best2 = -Infinity;
            for (i = 0; i < arr2.length; i++) {
              var sr2 = _synthCos(oraw2, arr2[i].raw);
              if (sr2 > best2) best2 = sr2;
            }
            pr[cls] = best2;
          }
        }
        var gs = Object.keys(pg).map(function (v) { return pg[v]; }).sort(function (a, b) { return b - a; });
        return { perRaw: pr, perGrad: pg, gm: gs.length > 1 ? gs[0] - gs[1] : 0 };
      });
      scored.sort(function (a, b) { return b.gm - a.gm; });
      var perRaw = scored[0].perRaw, perGrad = scored[0].perGrad;
      function rank(per) {
        return Object.keys(per).map(function (v) { return { v: parseInt(v, 10), s: per[v] }; })
          .sort(function (a, b) { return b.s - a.s; });
      }
      var ra = rank(perRaw), rg = rank(perGrad);
      if (!ra.length || !rg.length) { if (dbgS) dbgS[kind] = "no-scores"; return null; }
      var gm = rg.length > 1 ? rg[0].s - rg[1].s : 1;
      if (dbgS) dbgS[kind] = "raw " + ra[0].v + "@" + ra[0].s.toFixed(3) + " grad " + rg[0].v + "@" + rg[0].s.toFixed(3) + " gm " + gm.toFixed(3);
      // COMMIT GATE: both scorings agree on the winner, gradient margin above a
      // NODE-SPECIFIC noise floor: S needs 0.015 (its gold-on-gold correlations
      // run tighter spreads — a clean capture's S once agree-wronged at exactly
      // 0.010), the others 0.01 (t6-E's correct fill sits at 0.012). Callers
      // that OVERRIDE an existing read demand ≥ 0.03 via the returned gm.
      // rawScore/gradScore = each channel's PEAK correlation, not just its
      // winner: the no-checksum fallback arbitrates dissenting channels by
      // which one actually locked onto something (see there).
      var res = { value: null, conf: 0.55, gm: gm, gradTop: rg[0].v, rawTop: ra[0].v,
        rawScore: ra[0].s, gradScore: rg[0].s, agree: ra[0].v === rg[0].v };
      if (res.agree && gm >= (kind === "S" ? 0.015 : 0.01)) res.value = ra[0].v;
      // RULED OUT (round 4) — a W/E "dissent + ink-geometry corroboration" commit.
      // The idea: when raw and gradient disagree decisively (gm ≥ 0.10) at W/E, the
      // raw scan is correlating on the COLOURED DIAMOND FACE (four boards read
      // "raw 4 / grad 1" at gm 0.17-0.24 with a labelled 1), so let a second,
      // differently-derived witness break it — the ink ASPECT of the last column
      // run on the "Lv. N" line, which comes from segmentation rather than
      // correlation. Offline on the corpus it looked strong (w/h < 0.42 at W caught
      // 92% of true 1s at 17% misfire). Inside the engine it collapses: the line
      // the synth actually locates yields a usable last run on only 210 of 545 W/E
      // consults, and against the labels it splits W narrow 46:14 / wide 21:38 and
      // E narrow 15:4 / **wide 54:18** — the wide side is mostly 1s, i.e. the
      // measurement is not finding the digit. Wired up it fired 7 times, 4 right
      // and 3 wrong, for effect1Level 25 → 26 misses. The geometry channel is not
      // decisive at this mask quality; a swap verifier needs different evidence.
      return res;
    }

    // ANALYSIS-BY-SYNTHESIS for outcome AMOUNT digits (2026-07-21, Shizu's
    // replicated "green diamond Lv.4" report): the collect-tier crop blurs the
    // chartreuse "Lv. N ▲"/"+N ▲" line past the template+OCR ladder — the same
    // degradation class the wheel levels hit (v75), same cure. The amount lines
    // use the SAME glyph art as the W/E "Lv. N" node lines, so their ref patches
    // transfer: pool W+E exemplars per class (1-4 — the legal amount range),
    // scan the line's right half (the digit sits just left of the arrow), and
    // commit ONLY on raw+gradient ranking agreement with margin. Greyscale
    // patches make it color-blind — chartreuse raises and red lowers both read.
    function _amtVariants() {
      // W/E refs pooled per class 1-4 at the full sigma spread, UNWINDOWED
      // both channels (see _synthGradPlain) — the amount synth's round-2
      // behavior, kept independent of the level consults' center window.
      if (!LREFS) return null;
      var band = scaleF >= 3 ? "u3" : scaleF >= 2 ? "u2" : "n";
      if (_amtTVCache && _amtTVCache[band]) return _amtTVCache[band];
      var SIG_FULL = [0.6, 1.0, 1.5, 2.1, 2.8, 3.6];
      var pool = {}, kk, cls;
      for (kk = 0; kk < 2; kk++) {
        var t = LREFS[kk === 0 ? "W" : "E"] || {};
        for (cls in t) {
          var v = parseInt(cls, 10);
          if (!(v >= 1 && v <= 4)) continue;
          var arr = pool[cls] = pool[cls] || [];
          (t[cls] || []).forEach(function (ref) {
            var base = new Float32Array(ref.q);
            SIG_FULL.forEach(function (sg) {
              var b = _synthBlur(base, sg);
              arr.push({ raw: _synthZnorm(b), grad: _synthGradPlain(b) });
            });
          });
        }
      }
      _amtTVCache = _amtTVCache || {};
      _amtTVCache[band] = pool;
      return pool;
    }
    // The ▲/▼ blob at an amount line's right end, located by its OWN colour
    // centroid. EVERY reader that looks at the line has to clip here:
    //   - the synthesis scan — an arrow patch poisons the class argmax
    //     (mJLklhw: a clean '4' ranked '2' when the scan covered the arrow);
    //   - the amount OCR crop — tesseract reads a solid triangle as a digit
    //     ("Lv. 3 ▲" comes back 'vv 3 4' and the last-bare-digit rule takes
    //     the 4; "+1 ▲" came back "+ 4"), which is round 4's AMOUNT(1→4)
    //     family and most of the 3→1 family;
    //   - the template pass — the SOLIDITY VETO exists only because a solid
    //     triangle template-matches '4'.
    // The located line INCLUDES the arrow on some tiers and EXCLUDES it on
    // others (level4 vs mJLklhw — assumed geometry burned once already), so
    // the clip anchors on the arrow's MEASURED centroid, not the line end.
    // Memoized per line: three readers ask about the same line.
    var _arrowMemo = {};
    function arrowEnd(amtLine) {
      var key = Math.round(amtLine.x) + "," + Math.round(amtLine.y) + "," + Math.round(amtLine.w) + "," + Math.round(amtLine.h);
      if (_arrowMemo[key]) return _arrowMemo[key];
      var endBox = { x: amtLine.x + amtLine.w - gap * 0.18, y: amtLine.y - amtLine.h * 0.5, w: gap * 0.30, h: amtLine.h * 2 };
      var endCrop = L.crop(raster, endBox);
      var eUp = L.colorClusterStats(endCrop, function (r2, g2, b2) { var c2 = L.hsv(r2, g2, b2); return c2.h >= 75 && c2.h < 145 && c2.s > 0.35 && c2.v > 0.45; });
      var eDn = L.colorClusterStats(endCrop, function (r2, g2, b2) { var c2 = L.hsv(r2, g2, b2); return (c2.h < 20 || c2.h >= 345) && c2.s > 0.45 && c2.v > 0.4; });
      var arrow = (eUp.count >= 8 && eUp.density > 0.25) ? eUp : (eDn.count >= 8 && eDn.density > 0.25) ? eDn : null;
      var x1 = amtLine.x + amtLine.w - gap * 0.05;
      if (arrow) x1 = Math.min(x1, endBox.x + arrow.cx - gap * 0.09);
      return (_arrowMemo[key] = { x1: x1, arrow: arrow, up: eUp, down: eDn, box: endBox });
    }
    function synthAmountDigit(amtLine) {
      var pool = _amtVariants(), cls;
      if (!pool || !Object.keys(pool).length) return null;
      var cy = amtLine.y + amtLine.h / 2;
      var x1 = arrowEnd(amtLine).x1;
      var x0 = Math.max(amtLine.x, x1 - gap * 0.24);
      var perRaw = {}, perGrad = {}, i;
      for (var cxs = x0; cxs <= x1; cxs += gap * 0.0075) {
        for (var dy = -0.03; dy <= 0.0301; dy += 0.0075) {
          var op = _synthPatch(cxs, cy + dy * gap);
          var oraw = _synthZnorm(op), ograd = _synthGradPlain(op);
          for (cls in pool) {
            var arr = pool[cls];
            for (i = 0; i < arr.length; i++) {
              var sr = _synthCos(oraw, arr[i].raw);
              if (!(cls in perRaw) || sr > perRaw[cls]) perRaw[cls] = sr;
              var sg = _synthCos(ograd, arr[i].grad);
              if (!(cls in perGrad) || sg > perGrad[cls]) perGrad[cls] = sg;
            }
          }
        }
      }
      function rankAm(per) {
        return Object.keys(per).map(function (v2) { return { v: parseInt(v2, 10), s: per[v2] }; })
          .sort(function (a, b) { return b.s - a.s; });
      }
      var ra = rankAm(perRaw), rg = rankAm(perGrad);
      if (!ra.length || !rg.length) return null;
      var gm = rg.length > 1 ? rg[0].s - rg[1].s : 1;
      if (out._debug) (out._debug.amtSynthDet = out._debug.amtSynthDet || []).push({
        line: { x: Math.round(amtLine.x), y: Math.round(amtLine.y), w: Math.round(amtLine.w), h: Math.round(amtLine.h) },
        arrowCx: arrowEnd(amtLine).arrow ? Math.round(arrowEnd(amtLine).box.x + arrowEnd(amtLine).arrow.cx) : null,
        span: [Math.round(x0), Math.round(x1)],
        raw: ra.slice(0, 2).map(function (r3) { return r3.v + "@" + r3.s.toFixed(3); }).join(" "),
        grad: rg.slice(0, 2).map(function (r3) { return r3.v + "@" + r3.s.toFixed(3); }).join(" "),
        gm: Math.round(gm * 1000) / 1000
      });
      // Always report the gradient-top (the transferable channel) even on refusal —
      // the bare-digit rung accepts a weak OCR digit only when it AGREES with it.
      var res = { value: null, gm: gm, gradOnly: false, gradTop: rg[0].v, rawTop: ra[0].v,
        gradScore: rg[0].s, rawScore: ra[0].s, agree: ra[0].v === rg[0].v };
      if (ra[0].v !== rg[0].v) {
        // The refs are node-harvested; over an OUTCOME CELL's background the raw
        // channel votes low-frequency background, not glyph (level4: raw said '1'
        // while grad said the true '2' at gm 0.12). Gradient is the transferable
        // channel — commit on grad ALONE only at a 3× margin (asymmetric trust).
        if (gm >= 0.03) { res.value = rg[0].v; res.gradOnly = true; }
        return res;
      }
      // Both channels agreeing still needs a margin: at 0.01 the amount synth
      // committed a '4' on a true '1' at gm 0.017 (c-mrw50ekq). 0.03 is the same
      // 3× bar the gradient-only branch above uses. Measured: +1 tile, −0 tiles.
      if (gm >= 0.03) res.value = ra[0].v;
      return res;
    }

    // ---- name-band synthesis (same method, 6-class, wide patches) ----
    var NPW = 48, NPH = 16;
    function _nZnorm(p2) {
      var out = new Float32Array(p2.length), mean = 0, i;
      for (i = 0; i < p2.length; i++) mean += p2[i];
      mean /= p2.length;
      var va = 0;
      for (i = 0; i < p2.length; i++) { out[i] = p2[i] - mean; va += out[i] * out[i]; }
      var sd = Math.sqrt(va / p2.length) || 1;
      for (i = 0; i < out.length; i++) out[i] /= sd;
      return out;
    }
    function _nGrad(p2) {
      var g = new Float32Array(NPW * NPH);
      for (var y = 1; y < NPH - 1; y++) for (var x = 1; x < NPW - 1; x++) {
        var dx = p2[y * NPW + x + 1] - p2[y * NPW + x - 1], dy = p2[(y + 1) * NPW + x] - p2[(y - 1) * NPW + x];
        g[y * NPW + x] = Math.sqrt(dx * dx + dy * dy);
      }
      return _nZnorm(g);
    }
    function _nBlur(p2, sigma) {
      var r = Math.max(1, Math.ceil(sigma * 2.5)), k = [], ks = 0, i;
      for (i = -r; i <= r; i++) { var v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
      for (i = 0; i < k.length; i++) k[i] /= ks;
      var tmp = new Float32Array(NPW * NPH), out = new Float32Array(NPW * NPH), x, y, s, j;
      for (y = 0; y < NPH; y++) for (x = 0; x < NPW; x++) {
        s = 0;
        for (j = -r; j <= r; j++) s += p2[y * NPW + Math.max(0, Math.min(NPW - 1, x + j))] * k[j + r];
        tmp[y * NPW + x] = s;
      }
      for (y = 0; y < NPH; y++) for (x = 0; x < NPW; x++) {
        s = 0;
        for (j = -r; j <= r; j++) s += tmp[Math.max(0, Math.min(NPH - 1, y + j)) * NPW + x] * k[j + r];
        out[y * NPW + x] = s;
      }
      return out;
    }
    function _nPatch(cx, cy) {
      var out = new Float32Array(NPW * NPH);
      var bw = gap * 1.06, bh = gap * 0.34;
      var W2 = raster.width, H2 = raster.height, d = raster.data;
      function lumAt(xx, yy) { var ii = (yy * W2 + xx) * 4; return 0.299 * d[ii] + 0.587 * d[ii + 1] + 0.114 * d[ii + 2]; }
      for (var py = 0; py < NPH; py++) for (var px = 0; px < NPW; px++) {
        var sx = cx - bw / 2 + (px + 0.5) * bw / NPW, sy = cy - bh / 2 + (py + 0.5) * bh / NPH;
        var x0 = Math.max(0, Math.min(W2 - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(H2 - 1, Math.floor(sy)));
        var x1 = Math.min(W2 - 1, x0 + 1), y1 = Math.min(H2 - 1, y0 + 1);
        var fx = sx - x0, fy = sy - y0;
        out[py * NPW + px] = lumAt(x0, y0) * (1 - fx) * (1 - fy) + lumAt(x1, y0) * fx * (1 - fy) +
                             lumAt(x0, y1) * (1 - fx) * fy + lumAt(x1, y1) * fx * fy;
      }
      return out;
    }
    function _nsynthVariants() {
      if (_nsynthTVCache || !NREFS) return _nsynthTVCache;
      var SIGMAS = [0.5, 0.9, 1.4, 2.0];
      var _nsynthTV = { W: {}, E: {} };
      ["W", "E"].forEach(function (k) {
        var other = k === "W" ? "E" : "W";
        var names = {};
        Object.keys(NREFS[k] || {}).forEach(function (n) { names[n] = NREFS[k][n]; });
        // other-side fill ONLY for classes this side has never seen (name bands
        // are big white text — cross-side transfer is safe for absent classes,
        // and same-side refs stay primary; digit-pooling's lesson respected)
        Object.keys(NREFS[other] || {}).forEach(function (n) { if (!names[n]) names[n] = NREFS[other][n]; });
        Object.keys(names).forEach(function (n) {
          var arr = [];
          names[n].forEach(function (ref) {
            var base = new Float32Array(ref.q);
            SIGMAS.forEach(function (sg) {
              var b = _nBlur(base, sg);
              arr.push({ raw: _nZnorm(b), grad: _nGrad(b) });
            });
          });
          _nsynthTV[k][n] = arr;
        });
      });
      _nsynthTVCache = _nsynthTV;
      return _nsynthTVCache;
    }
    // Classify the name band against reference patches; candidates constrained to
    // `allowed` (the cost pool) minus `avoid`. Same dual-scoring agreement gate.
    function synthNameRescue(kind, p, allowed, avoid) {
      var tv = _nsynthVariants();
      if (!tv || !tv[kind]) return null;
      var cands = Object.keys(tv[kind]).filter(function (n) {
        if (avoid && n === avoid) return false;
        if (allowed && allowed.indexOf(n) === -1) return false;
        return true;
      });
      if (cands.length < 2) return null;   // a 1-candidate "choice" proves nothing
      var cx = p.x, cy = p.y - gap * 0.16;
      var perRaw = {}, perGrad = {}, dy, dx, i;
      for (dy = -0.03; dy <= 0.0301; dy += 0.01) {
        for (dx = -0.03; dx <= 0.0301; dx += 0.01) {
          var op = _nPatch(cx + dx * gap, cy + dy * gap);
          var oraw = _nZnorm(op), ograd = _nGrad(op);
          for (i = 0; i < cands.length; i++) {
            var n = cands[i], arr = tv[kind][n];
            for (var j = 0; j < arr.length; j++) {
              var sr = 0, sg = 0, a = arr[j];
              for (var q2 = 0; q2 < oraw.length; q2++) { sr += oraw[q2] * a.raw[q2]; sg += ograd[q2] * a.grad[q2]; }
              sr /= oraw.length; sg /= oraw.length;
              if (!(n in perRaw) || sr > perRaw[n]) perRaw[n] = sr;
              if (!(n in perGrad) || sg > perGrad[n]) perGrad[n] = sg;
            }
          }
        }
      }
      function rank(per) {
        return Object.keys(per).map(function (n) { return { n: n, s: per[n] }; })
          .sort(function (a, b) { return b.s - a.s; });
      }
      var ra = rank(perRaw), rg = rank(perGrad);
      if (!ra.length || !rg.length) return null;
      var gmN = rg.length > 1 ? rg[0].s - rg[1].s : 1;
      if (out._debug) (out._debug.synthName = out._debug.synthName || {})[kind] =
        "raw " + ra[0].n + "@" + ra[0].s.toFixed(3) + " | grad " + rg[0].n + "@" + rg[0].s.toFixed(3) + " gm " + gmN.toFixed(3);
      if (ra[0].n !== rg[0].n) return null;
      if (gmN < 0.015) return null;
      return ra[0].n;
    }

    // Read one level node: return the committed digit (template if strong, else the
    // OCR ladder — "Lv. N" isolation is the hard case) AND the raw template score
    // vector (feeds the constraint enumeration for the weak/free nodes below).
    // hasLvPrefix (W/E): the digit is BY CONSTRUCTION the last box of the line and
    // sits right of the "Lv. " prefix — a live native frame (41d1b9bb) had the 'L'
    // erode to a 5px sliver that classified as '1' @0.91 while the true '2' eroded
    // into a '/', so the L committed at 0.95 and the checksum pushed the error into
    // the free S node: a SILENT coherent-wrong board. Structure beats scores here.
    async function readLevelFull(p, isGoldFace, hasLvPrefix, nodeKind) {
      var box = { x: p.x - gap * 0.5, y: p.y - gap * 0.35, w: gap * 1.0, h: gap * 0.72 };
      var pred = L.isGoldText;
      if (isGoldFace) {
        // tight, digit-centred box: the wide generic box mixes dark nebula corners
        // into the median, dragging the luminance threshold under the FACE level so
        // the whole diamond passes and the locate rejects (measured onFrac 0.31)
        box = { x: p.x - gap * 0.35, y: p.y - gap * 0.06, w: gap * 0.7, h: gap * 0.42 };
      }
      if (isGoldFace) {
        // GOLD-ON-GOLD (the S/order digit): the ink is VIVID pure yellow (s≈0.9)
        // while the face is muted brown-gold (s≈0.5) and its specular sheen washes
        // toward WHITE (s drops further) — saturation separates what luminance and
        // plain chroma could not. The white "Chaos/Order Points" label (s≈0) is out
        // by construction.
        pred = function (r, g, b) {
          var c = L.hsv(r, g, b);
          return c.h >= 42 && c.h <= 64 && c.s > 0.72 && c.v > 0.7;
        };
        if (out._debug) {
          var mT = L.chromaMask(L.crop(raster, box), pred), onN = 0;
          for (var mi = 0; mi < mT.data.length; mi += 4) if (mT.data[mi] < 128) onN++;
          out._debug.sMask = { onFrac: Math.round(onN / (mT.width * mT.height) * 1000) / 1000, boxW: mT.width, boxH: mT.height };
        }
      }
      var lineOptsLv = {
        rejectFill: 0.22, maxRowFill: 0.6,
        minH: Math.max(4, Math.round(gap * 0.05)), maxH: Math.round(gap * 0.22), minRowPx: 3,
        // A W/E "Lv. N" row spans ~0.27·gap of ink; anything ≥0.34 is a MERGED band
        // (the name line above bridged into it, or a neighbour's art), and the
        // rightmost digit box the template pass then picks is not the level digit.
        // Measured over the corpus: pins off a 0.22-0.34 line are right 236/236,
        // off a ≥0.34 line 4/8. Rejecting the merged band routes the node to the
        // no-line synth rescue, whose pins are right 133/139. The bare-digit N/S
        // nodes keep the loose cap — their line IS just the digit.
        accept: function (r) { var c = r.x + r.w / 2; return Math.abs(c - p.x) <= gap * 0.28 && r.w >= gap * 0.03 && r.w <= gap * (hasLvPrefix ? 0.34 : 0.85); }
      };
      var line = L.findMaskedTextLine(raster, box, pred, lineOptsLv);
      // erosion rescue (windowed native scale, gap≈202): the digit mask is clean but
      // its thinnest rows carry 1-2 pixels, under minRowPx — a live willpower '2'
      // located as NULL, leaving {N,S} both free and the enumeration tie-breaking
      // blind. Retry relaxed ONLY after the standard locate fails; not for the
      // gold-face S node, where a relaxed locate latches onto specular noise.
      if (!line && !isGoldFace) {
        // retry BELOW CENTER only: the digit/Lv line always sits there, and the
        // relaxed row threshold otherwise latches onto the caption band above
        // (measured -0.364 gap on the chat tier — it read caption garbage)
        var boxLow = { x: box.x, y: p.y - gap * 0.02, w: box.w, h: gap * 0.38 };
        line = L.findMaskedTextLine(raster, boxLow, pred, Object.assign({}, lineOptsLv, { minRowPx: 1 }));
      }
      if (out._debug && isGoldFace) out._debug.sLine = line ? { x: Math.round(line.x), y: Math.round(line.y), w: Math.round(line.w), h: Math.round(line.h) } : null;
      if (!line) {
        // no locatable line at all — the synthesis rescue is the only reader left
        // (it anchors itself: fixed offsets for bare digits, its own below-center
        // locate for W/E) and this no-line path is precisely where the degraded
        // tier lands
        if (LREFS && nodeKind) {
          var sr0 = synthLevelRescue(nodeKind, p);
          if (sr0 && sr0.value != null) return { value: sr0.value, conf: isGoldFace ? Math.min(sr0.conf, 0.5) : sr0.conf, vec: null, src: "synth" };
        }
        return { value: null, conf: 0, vec: null };
      }
      if (out._debug) (out._debug.lvLine = out._debug.lvLine || {})[nodeKind] = {
        w: Math.round(line.w / gap * 1000) / 1000, h: Math.round(line.h / gap * 1000) / 1000,
        dx: Math.round(((line.x + line.w / 2) - p.x) / gap * 1000) / 1000
      };
      var grow = Math.round(line.h * 0.5);
      var lineX = { x: line.x, y: line.y - grow, w: line.w, h: line.h + grow * 2 };

      // template pass: rightmost digit-classified box → value + score vector
      var vec = null, tmVal = null, tmConf = 0;
      if (GLYPHS) {
        var mask = L.chromaMask(L.crop(raster, lineX), pred);
        var boxes = segmentDigitBoxes(mask);
        var db = null, dbBox = null, lvDet = out._debug ? [] : null;
        if (lvDet) for (var li = 0; li < boxes.length; li++) {
          var svd = digitScoreVec(mask, boxes[li]);
          lvDet.push(Math.round(boxes[li].x) + "+" + Math.round(boxes[li].w) + "x" + Math.round(boxes[li].h) +
            (svd.full ? "=" + svd.full.ch + ":" + svd.full.score.toFixed(2) : "=?") + (svd.isDigit ? "*" : ""));
        }
        // Prefixed nodes ("Lv. N"): the digit lives RIGHT of the prefix — "Lv. "
        // owns the left ~60% of the line, so boxes there are letters no matter how
        // digit-like they score (the eroded-'L'→'1' silent). Commit = last
        // digit-classified box in the right zone; when none classifies, the
        // rightmost in-zone box still donates its score vector to the solver.
        // Bare-digit nodes (N/S) have no prefix to fake digits, keep the plain
        // last-digit-classified rule.
        for (var i = 0; i < boxes.length; i++) {
          var bx = boxes[i];
          if (hasLvPrefix && (bx.x + bx.w / 2) <= mask.width * 0.55) continue;
          var sv = digitScoreVec(mask, bx);
          if (sv.isDigit) { db = sv; dbBox = bx; }
          else if (hasLvPrefix && !db) db = { vec: sv.vec, top: sv.top, isDigit: false };   // vec-only candidate
        }
        if (lvDet) (out._debug.lvDetail = out._debug.lvDetail || []).push(
          { line: { x: Math.round(lineX.x), y: Math.round(lineX.y), w: Math.round(lineX.w), h: Math.round(lineX.h) }, boxes: lvDet.join(" ") });
        // NARROW-FRAGMENT re-mask (the absorber shape): at the windowed tiers the
        // digit's antialiased strokes BLEND with the face tint (gold-over-green
        // shifts hue to ~80) and isGoldText erodes the glyph to a sliver that
        // classifies '1' (live 2aa9a4b2: green "Lv. 3" → a 6x16 fragment →
        // '1'@0.82, SILENT). Re-mask with a blend-tolerant pred (h up to <100 —
        // true face greens stay out; ≥22 — face reds stay out) and re-take the
        // SAME glyph, matched by its right edge. Adoption needs a now-WIDE box
        // classifying at the full commit bars — and a wide box is IoU-vetoable
        // downstream, which the sliver never was. A true '1' stays narrow under
        // the relaxed mask too, so this cannot rewrite genuine ones; clean
        // frames produce full-width digits and never enter this branch.
        if (!isGoldFace && db && db.isDigit && dbBox && dbBox.w / Math.max(1, dbBox.h) < 0.45) {
          var lvPredRelaxed = function (r2, g2, b2) {
            var c2 = L.hsv(r2, g2, b2);
            return c2.h >= 22 && c2.h < 100 && c2.s > 0.35 && c2.v > 0.5;
          };
          var maskR = L.chromaMask(L.crop(raster, lineX), lvPredRelaxed);
          var boxesR = segmentDigitBoxes(maskR);
          var re = null, reBox = null;
          for (var rj = 0; rj < boxesR.length; rj++) {
            var bR = boxesR[rj];
            if (Math.abs((bR.x + bR.w) - (dbBox.x + dbBox.w)) > 4) continue;   // same glyph only
            if (bR.w / Math.max(1, bR.h) < 0.45) continue;                     // still a sliver — no gain
            var svR = digitScoreVec(maskR, bR);
            if (svR.isDigit) { re = svR; reBox = bR; }
          }
          if (re) {
            db = re; dbBox = reBox; mask = maskR;
            if (out._debug) (out._debug.lvRelax = out._debug.lvRelax || {})[nodeKind] =
              Math.round(reBox.w) + "x" + Math.round(reBox.h) + "=" + re.full.ch + ":" + re.full.score.toFixed(2);
          }
        }
        if (db) {
          vec = db.vec;
          var b1 = -1, b1v = null, b2 = -1;
          for (var v = 1; v <= 5; v++) { var s = db.vec[v]; if (s > b1) { b2 = b1; b1 = s; b1v = v; } else if (s > b2) b2 = s; }
          if (db.isDigit && dbBox && b1 >= 0.78 && (b1 - b2) >= 0.05) {
            // proven bitmapSim commit — but ink-IoU gets a VETO: sim's background-
            // dominated score let a live "Lv. 5" read as a confident 3 (which the
            // checksum then propagated into the unreadable S digit). If IoU clearly
            // prefers a DIFFERENT digit, do not commit — fall to OCR / the solve.
            var vetoed = false;
            if (DIGIT_ATLAS && dbBox.w / Math.max(1, dbBox.h) >= 0.45) {
              var im = iouDigit(mask, dbBox, ["1", "2", "3", "4", "5"]);
              if (im && im.ch !== String(b1v) && im.margin >= 0.08) vetoed = true;
            }
            if (!vetoed) {
              tmVal = b1v; tmConf = Math.min(0.95, 0.75 + (b1 - b2) * 2);
              // small-glyph commits (a 10x14 '2' matched '3' and shipped at
              // 0.88, silent) are the 1↔2↔3 low-res confusion zone — keep the
              // value, stay under the flag line until the checksum or a second
              // channel corroborates. Gate on TRUE CAPTURE pixels (normalized
              // height ÷ scale factor): native-tier digits run 17px+ and stay
              // exempt; a 14px capture glyph is mush whatever the wheel gap says.
              if (dbBox.h / Math.max(0.5, scaleF) < 16) tmConf = Math.min(tmConf, 0.78);
            }
          }
        }
      }
      if (tmVal != null) {
        // the luminance-read S digit is real evidence, but the face is hostile ground
        // — cap it so the checksum solve still arbitrates (and flags) disagreements.
        // Gold-face template reads also get a synthesis CROSS-CHECK: at degraded
        // tiers a noise blob can template-match a digit (t6: a junk '1' returned
        // here and blocked every later rung); a strong synth disagreement wins,
        // agreement or a refused gate keeps the template read.
        // NARROW boxes get the same cross-check on EVERY node: w/h < 0.45 is
        // exactly the shape the ink-IoU veto above must skip, and it is the
        // doppelgänger-absorber shape — a mask fragment of a wider digit
        // template-matches '1' (live 2aa9a4b2: green "Lv. 3" lost its left
        // half, the 6x16 sliver committed '1'@0.82 SILENTLY and the checksum
        // pushed the error into a synth-refuted S). Wide boxes → IoU veto;
        // narrow boxes → synthesis veto. No commit escapes both.
        // Cross-check triggers: the gold face (always), narrow slivers, and any
        // SMALL '1' commit — '1' is the absorber class (eroded strokes of every
        // digit collapse to a bar; the relaxed re-mask can hand it a WIDE box
        // that dodges the narrow rule), and a pinned wrong '1' poisons the
        // checksum's arithmetic far beyond its own field.
        // aspect-ANOMALOUS boxes need the cross-check in BOTH directions: tall
        // slivers (w/h < 0.45, the mask-fragment absorber) and FLAT bars
        // (w/h > 1.15 — no 1-5 glyph is wider than tall; bitmapSim resizes the
        // box into the template grid, so a 19×5 gold-ornament bar happily
        // "matched" a '2' at 0.79 and pinned W on a true-1 board).
        var narrowT = dbBox && (dbBox.w / Math.max(1, dbBox.h) < 0.45 || dbBox.w / Math.max(1, dbBox.h) > 1.15);
        var smallOne = tmVal === 1 && dbBox && dbBox.h / Math.max(0.5, scaleF) < 16;
        if (LREFS && nodeKind && (isGoldFace || narrowT || smallOne)) {
          var srT = synthLevelRescue(nodeKind, p);
          // OVERRIDE bar: replacing a committed template read needs gm ≥ 0.03
          // (a clean capture's correct '3' was once overridden by an
          // agreeing-wrong '5' at a sub-0.015 margin)
          if (srT && srT.value != null && srT.value !== tmVal && srT.gm >= 0.03) { tmVal = srT.value; tmConf = 0.5; }
          // a sliver/small-'1' whose cross-check REFUSED with a DISSENTING
          // gradient top is worse than uncorroborated — it is contradicted.
          // Un-commit it and fall through to the OCR ladder (vec stays for the
          // solver, whose synth votes carry the gradient evidence).
          else if (!isGoldFace && srT && srT.value == null && srT.gradTop != null && srT.gradTop !== tmVal) {
            tmVal = null;
          }
          // ...refused-without-dissent or weakly dissented stays uncorroborated
          // sliver evidence: keep the value, cap under the flag line (a 3px
          // '1'@0.95 with the synth raw-channel screaming '5' shipped silently
          // before this)
          else if (!isGoldFace && (!srT || srT.value !== tmVal)) tmConf = Math.min(tmConf, 0.75);
        }
        if (tmVal != null) return { value: tmVal, conf: isGoldFace ? Math.min(tmConf, 0.6) : tmConf, vec: vec, src: "tm" };
      }
      // OCR ladder (proven on "Lv. N"): plain → single-char → dilate
      var read = await maskedOcr(lineX, pred, { whitelist: "Lv.12345 ", psm: 7 });
      var m = read.text.match(/([1-5])\s*$/) || read.text.match(/([1-5])/);
      if (!m) { read = await maskedOcr(lineX, pred, { whitelist: "12345", psm: 10 }); m = read.text.match(/([1-5])/); }
      var usedDilate = false;
      if (!m) {
        read = await dilatedOcr(L.crop(raster, lineX), pred, { scale: "auto", maxAuto: 5, whitelist: "Lv.12345 ", psm: 7 });
        m = read.text.match(/([1-5])\s*$/) || read.text.match(/([1-5])/);
        usedDilate = m != null;   // a dilated-rung digit is the known hallucination shape
      }
      var conf = m ? Math.min(0.9, read.conf + 0.2) : 0;
      if (isGoldFace) conf = Math.min(conf, 0.45);
      // vec == null means the template channel saw NO digit-shaped box at all —
      // a confident OCR digit standing on that line is single-channel evidence
      // (live: a junk band OCR'd '4'@0.90 for a willpower 1, silent) — verify
      // it against the synth or cap it under the flag line.
      var vecless = m && conf >= 0.8 && !vec;
      if (LREFS && nodeKind && (!m || conf < 0.65 || usedDilate || vecless)) {
        // last rung: analysis-by-synthesis vs the pristine reference patches —
        // agreement-gated, modest conf; the checksum arbitrates from here (and
        // for S the value flows through the sHint channel, never pinned). It also
        // arbitrates a sub-0.65 OCR read: at that confidence the ladder is
        // guessing (dilated OCR hallucinates '1's on degraded masks and the junk
        // read was BLOCKING this rung), while the agreement gate measured
        // 8 correct commits / 0 wrong ones on the degraded corpus. AGREEMENT
        // keeps the OCR provenance (vec intact for the corroborator) with a lift;
        // only DISAGREEMENT replaces the read.
        var sr = synthLevelRescue(nodeKind, p);
        if (sr && sr.value != null) {
          var mVal = m ? parseInt(m[1], 10) : null;
          if (mVal != null && mVal === sr.value) {
            return { value: mVal, conf: Math.max(conf, isGoldFace ? 0.45 : 0.55), vec: vec, src: "ocr" };
          }
          // null-fill at the base gate; OVERRIDING a read value needs gm ≥ 0.03
          if (mVal == null || sr.gm >= 0.03) {
            return { value: sr.value, conf: isGoldFace ? Math.min(sr.conf, 0.5) : sr.conf, vec: vec, src: "synth" };
          }
        }
        // GUESSING-grade OCR digit whose consult REFUSED with a DISSENTING
        // gradient top: contradicted evidence must not PIN the node (mirror of
        // the sliver un-commit above). Two shapes qualify: a sub-0.4 read (a
        // pinned junk '3'@0.22 once drove the checksum infeasible and blocked
        // the enumeration that had the right answer) and a 0.4-0.65 read whose
        // dissenting gradient ranking is DECISIVE (gm ≥ 0.10 — two live W↔S
        // swaps rode a '1'@0.60 misread of "Lv. 4" into S while the consult's
        // gradient said 4 at gm 0.15). Unpinned, the solver still holds the
        // vec and the consult's own votes.
        else if (sr && sr.value == null && m && (conf < 0.4 || sr.gm >= 0.10) &&
                 sr.gradTop != null && sr.gradTop !== parseInt(m[1], 10)) {
          return { value: null, conf: 0, vec: vec, src: "ocr" };
        }
        // dilated-rung or vec-less digit with no synth corroboration (refused,
        // or a weak dissent): the value stands but never confidently —
        // Tesseract's conf on a dilated 1-glyph mask is noise (an eroded E-node
        // '2' read '1'@0.90 through this exact hole and shipped silently)
        if (usedDilate || vecless) conf = Math.min(conf, usedDilate ? 0.75 : 0.78);
      }
      return { value: m ? parseInt(m[1], 10) : null, conf: conf, vec: vec, src: "ocr" };
    }
    // the four node reads are data-independent — issue them CONCURRENTLY so the
    // OCR pool (parse-worker.js) can overlap them; with a single serialized OCR
    // backend (Node eval, inline fallback) the queue preserves old behavior
    var lvFull = await Promise.all([
      readLevelFull(nodes.nodeN, false, false, "N"),   // willpower (bare digit)
      readLevelFull(nodes.nodeW, false, true, "W"),    // effect1 ("Lv. N")
      readLevelFull(nodes.nodeE, false, true, "E"),    // effect2 ("Lv. N")
      readLevelFull(nodes.nodeS, true, false, "S")     // order (gold-on-gold bare digit)
    ]);
    // The S (order) luminance read is a HINT, never a pinned value: at low res the
    // gold-on-gold digit is marginal and a wrong pin corrupts the checksum's
    // arithmetic. The hint breaks enumeration ties (this is what un-swaps a live
    // "Atk Power 5 / Chaos Points 3" board) and corroborates-or-flags the solved S.
    tmark("levelReads");
    var sHint = lvFull[3].value;
    lvFull[3] = { value: null, conf: 0, vec: lvFull[3].vec };
    var scoreVecs = lvFull.map(function (r) { return r.vec; });
    if (out._debug) out._debug.levelReads = lvFull.map(function (r) { return r.value + "@" + r.conf.toFixed(2); }).concat("sHint=" + sHint);

    // ---- the points checksum ("N Astrogem Points" = level sum) ----
    // Only a digit sitting directly before "As(trogem)" counts — masked reads on dim
    // captures can mangle the digit while keeping "Points" ('5 re Paints' for
    // "6 Astrogem Points"), so a bare leading-digit grab is NOT trustworthy.
    function extractPts(text) {
      // "Astrogem" OCRs as Astroaem/Actroaem/Asroges… — accept A + s/c after the digit
      var m = normText(text).match(/(\d{1,2})\s*[Aa][sc]/);
      if (!m) return null;
      var v = parseInt(m[1], 10);
      return v >= 4 && v <= 20 ? v : null;
    }
    // LOCATE the header line; do not trust the fixed −1.10·gap offset. Measured on
    // the corpus: the fixed band lands between the gem title and the points line on
    // a whole class of captures — the crop then contains the rarity-coloured TITLE
    // and no digit at all, the checksum dies, and every free node falls back to a
    // blind default (the single largest level-miss class). White is the
    // discriminator: the title renders rarity-coloured (magenta/cyan/orange) while
    // the header is plain white, and findMaskedTextLine scans BOTTOM-UP, so a zone
    // spanning both returns the points line first either way.
    var ptsFixed = bandRect(redY - gap * 1.10, 0.13, 1.55);
    var ptsZone = bandRect(redY - gap * 1.02, 0.36, 1.55);
    // (RULED OUT 2026-07-29: a second, dimmer white predicate — s<0.36 v>0.42 —
    // for the 24 captures where the strict locate finds nothing. It located ZERO
    // extra headers and changed no board's pts; those frames have no white-ish
    // line in the zone at all, and most of them read the header fine from the
    // fixed rect anyway.)
    var ptsTrace = out._debug ? [] : null;
    function locatePts(pred) { return locateLine(ptsZone, pred, {
      trace: ptsTrace,
      maxRowFill: 0.6, minH: Math.max(4, Math.round(gap * 0.045)), maxH: Math.round(gap * 0.22),
      minRowPx: Math.max(3, Math.round(gap * 0.05)), rejectFill: 0.45,
      accept: function (r) {
        // the "Reset (1/1)" row lives just BELOW the header and is white too, so the
        // bottom-up scan meets it first: bound the drift (measured header centres sit
        // at −0.24..+0.16·gap of the old fixed centre, Reset at +0.26..+0.37) and the
        // width (a merged Reset+neighbour band comes back ≥2.0·gap wide). A rejected
        // candidate keeps findMaskedTextLine scanning upward, so the header still wins.
        var c = r.x + r.w / 2, dy = ((r.y + r.h / 2) - (redY - gap * 1.10)) / gap;
        var okv = Math.abs(c - cx) <= gap * 0.45 && r.w >= gap * 0.45 && r.w <= gap * 1.9 &&
          dy >= -0.34 && dy <= 0.20;
        if (ptsTrace) ptsTrace.push({ dy: Math.round(dy * 100) / 100, wG: Math.round(r.w / gap * 100) / 100,
          hG: Math.round(r.h / gap * 100) / 100, dx: Math.round((c - cx) / gap * 100) / 100, ok: okv });
        return okv;
      }
    }); }
    // (RULED OUT 2026-07-29 round 6: a BRIGHTER second predicate — s<0.3 v>0.78 —
    // when the strict locate returns null. It works as a LOCATE: 6 of the 40
    // checksum-less boards recover a header and all 6 checksums match the label sum.
    // It is still a net LOSS — whole-parse 246 → 245, willpowerLevel 95.6 → 95.3,
    // effect1Level 91.9 → 91.7. A board with no checksum is a board whose NODE reads
    // refuse: c-mrw5h45e pins N=3 against a labelled 5 with W/E/S all null@0.00, and
    // a correct pts=8 makes the enumeration push a compensating 3 into E — one wrong
    // field becomes two. The checksum is not the binding constraint on that
    // population; the per-node evidence is.)
    var ptsLoc = locatePts(dimBtnWhite), ptsPred = dimBtnWhite;
    var ptsRect = ptsLoc || ptsFixed;
    if (out._debug) { out._debug.ptsZone = [Math.round(ptsZone.x), Math.round(ptsZone.y), Math.round(ptsZone.w), Math.round(ptsZone.h)];
      out._debug.ptsTrace = ptsTrace; out._debug.ptsGap = Math.round(gap); }
    if (out._debug) out._debug.ptsLoc = ptsLoc
      ? { dy: Math.round(((ptsLoc.y + ptsLoc.h / 2) - (redY - gap * 1.10)) / gap * 1000) / 1000,
          w: Math.round(ptsLoc.w / gap * 100) / 100, h: Math.round(ptsLoc.h / gap * 100) / 100 }
      : null;
    var ptsSub = L.crop(raster, ptsRect);
    // template rung first: leading digit run before the first letter-matched box
    // ("Astrogem" letters are distractor classes)
    var ptsT = null;
    var tgP = templateGlyphs(ptsRect, ptsPred);
    if (out._debug) out._debug.ptsTG = tgP ? tgP.map(function (g) {
      return (g.ch || "?") + ":" + (g.score != null ? g.score.toFixed(2) : "-") + "/" + (g.margin != null ? g.margin.toFixed(2) : "-");
    }).join(" ") : "null";
    var ptsTSoft = false;
    if (tgP) {
      // (a) strict leading-digit run (the original rung — high bar, open world)
      var lead = "", pi = 0;
      for (; pi < tgP.length; pi++) {
        var tpg = tgP[pi];
        if (tpg.ch && /^\d$/.test(tpg.ch) && tpg.score >= 0.86 && tpg.margin >= 0.05) lead += tpg.ch;
        else break;
      }
      var nxt = tgP[pi];
      var nxtDigitish = nxt && nxt.ch && /^\d$/.test(nxt.ch) && nxt.score >= 0.8;
      if (!nxtDigitish && lead.length >= 1 && lead.length <= 2) {
        var pv = parseInt(lead, 10);
        if (pv >= 4 && pv <= 20) ptsT = pv;
      }
      // (b) ANCHORED positional read: if "Astrogem" is recognized (its 'A' + letter
      // tail), the 1-2 boxes BEFORE the 'A' are digits BY CONSTRUCTION — re-match
      // them against DIGITS ONLY (closed world: '+'/'g' lookalikes aren't candidates,
      // so the threshold can drop to what dim strokes actually score).
      if (ptsT == null && DIGIT_ATLAS && tgP.mask) {
        var aIdx = -1, genAnchor = false;
        for (var ai = 1; ai <= 3 && ai < tgP.length; ai++) {
          if (tgP[ai].ch === "A" && tgP[ai].score >= 0.8) { aIdx = ai; break; }
        }
        if (aIdx >= 1) {
          // verify the letter tail so a random 'A'-ish blob can't anchor: ≥2 of the
          // next 3 boxes must match a letter class decently
          var letterHits = 0;
          for (var li = aIdx + 1; li < Math.min(aIdx + 4, tgP.length); li++) {
            if (tgP[li].ch && /^[a-z]$/i.test(tgP[li].ch) && tgP[li].score >= 0.7) letterHits++;
          }
          if (letterHits < 2) aIdx = -1;
        }
        if (aIdx < 1) {
          // GENERALIZED anchor (2026-07-28 round 2): at the ×2 tier the 'A' box
          // itself misclassifies (measured live: 'A'→'o'@0.74 on a "15 Astrogem"
          // header, so the A-gate above never fires and the checksum dies with
          // it). The word doesn't need its first letter to prove itself: a RUN
          // of letter-classified boxes right after a 1-2 box lead IS "Astrogem"
          // — nothing else letter-shaped lives in this anchor-derived rect.
          // Three hits so a couple of stray blobs can't fake the word; the
          // closed-world digit floors, the sum-feasibility bounds and the
          // forced-soft authority below still guard the digits themselves.
          for (var ag = 1; ag <= 2 && ag < tgP.length; ag++) {
            // a confident DIGIT at ag is still part of the number ("15" — the
            // window would happily skip it and shear the tens digit off), so
            // the word can only start on a non-digit box
            if (tgP[ag].ch && /^\d$/.test(tgP[ag].ch) && tgP[ag].score >= 0.8) continue;
            var runHits = 0;
            for (var lg = ag; lg < Math.min(ag + 6, tgP.length); lg++) {
              if (tgP[lg].ch && /^[a-z]$/i.test(tgP[lg].ch) && tgP[lg].score >= 0.7) runHits++;
            }
            if (runHits >= 3) { aIdx = ag; genAnchor = true; break; }
          }
        }
        if (aIdx >= 1) {
          {
            // CONSTRAINT PROPAGATION: the committed level reads already bound the
            // points value (each unread node contributes 1..5), so match each digit
            // only against the values that keep the total FEASIBLE — a dim '0' no
            // longer loses to a lookalike '9' that would imply an impossible sum.
            var kSum = 0, nUnk = 0;
            for (var ki = 0; ki < 4; ki++) { if (lvFull[ki].value != null) kSum += lvFull[ki].value; else nUnk++; }
            // The S-hint participates in the BOUNDS (never pinned): on three live
            // misses the hint was right (1/4/4) while the header's second digit
            // matched a lookalike — hint-tightened bounds prune those candidates,
            // and a wrong hint only yields a wrong-but-SOFT pts the solve flags.
            if (sHint != null && nUnk > 0) { kSum += sHint; nUnk--; }
            var loP = Math.max(4, kSum + nUnk), hiP = Math.min(20, kSum + 5 * nUnk);
            var digs = "", minSc = 1, constrained = false;
            for (var di = 0; di < aIdx; di++) {
              var dbox = tgP[di].box, dch = null, dsc = 0;
              var allowed = null;
              if (aIdx === 2) {
                if (di === 0) allowed = ["1", "2"];   // two-digit pts is 10..20
                else {
                  allowed = [];
                  var tens = digs === "2" ? 20 : 10;
                  for (var dd = 0; dd <= 9; dd++) { if (tens + dd >= loP && tens + dd <= hiP) allowed.push(String(dd)); }
                }
              } else {
                allowed = [];
                for (var d1 = 4; d1 <= 9; d1++) { if (d1 >= loP && d1 <= hiP) allowed.push(String(d1)); }
              }
              if (!allowed.length) { digs = null; break; }
              if (allowed.length < (aIdx === 2 && di === 0 ? 2 : 6)) constrained = true;
              if (dbox.w / Math.max(1, dbox.h) < 0.45) {
                // the ONLY narrow digit is '1' — aspect alone identifies it (dim thin
                // strokes score weak IoU against the thick averaged templates)
                if (allowed.indexOf("1") === -1) { digs = null; break; }   // narrow but '1' infeasible → bail
                dch = "1"; dsc = 0.6;
              } else {
                var dm = iouDigit(tgP.mask, dbox, allowed);
                if (out._debug) (out._debug.ptsDig = out._debug.ptsDig || []).push(
                  (dm ? dm.top3 : "nomatch") + " w" + dbox.w + "h" + dbox.h + " [" + allowed.join("") + "]");
                // 0.36 floor: a 0.30-0.33 IoU is noise-level — committing it beat the
                // (better) run-OCR rescue to a WRONG value on two live '13' headers
                if (dm && dm.score >= 0.36) { dch = dm.ch; dsc = dm.score; }
              }
              if (!dch) { digs = null; break; }
              digs += dch; minSc = Math.min(minSc, dsc);
            }
            if (digs && digs.length >= 1 && digs.length <= 2) {
              var pv2 = parseInt(digs, 10);
              if (pv2 >= 4 && pv2 <= 20) {
                ptsT = pv2;
                // dim / constraint-assisted / letter-run-anchored reads keep
                // checksum authority CAPPED: solved levels stay in "confirm me"
                // territory, preserving 0-silent
                ptsTSoft = minSc < 0.5 || constrained || genAnchor;
              }
            } else if (aIdx >= 1) {
              // template couldn't resolve the digit run (a dim '3' matches nothing
              // well) — OCR the RUN CROP alone at high magnification; accept only a
              // bounds-consistent value, always soft
              var runX0 = tgP[0].box.x, runX1 = tgP[aIdx - 1].box.x + tgP[aIdx - 1].box.w;
              var runBox = { x: ptsRect.x + Math.max(0, runX0 - 3), y: ptsRect.y, w: (runX1 - runX0) + 6, h: ptsRect.h };
              var runSub = L.crop(raster, runBox);
              var runRead = await dilatedOcr(runSub, ptsPred, { scale: 4, whitelist: "0123456789", psm: 7 });
              var runM = (runRead.text || "").match(/(\d{1,2})/);
              if (runM) {
                var rv2 = parseInt(runM[1], 10);
                // (RULED OUT 2026-07-29: also accepting a bounds-DEFYING value here,
                // on the theory that the bounds come from pinned reads that may be
                // wrong. Full corpus: orderLevel 95.4 → 94.4, whole-parse 206 → 203.
                // The bounds are the better evidence.)
                if (rv2 >= Math.max(4, loP) && rv2 <= Math.min(20, hiP)) { ptsT = rv2; ptsTSoft = true; }
              }
            }
          }
        }
      }
    }
    function logPtsRead(tag, r) {
      if (out._debug) (out._debug.reads = out._debug.reads || []).push({
        rect: { x: Math.round(ptsRect.x), y: Math.round(ptsRect.y), w: Math.round(ptsRect.w), h: Math.round(ptsRect.h) },
        wl: tag, psm: 7, text: String(r.text || "").replace(/\n/g, "\\n").slice(0, 70),
        conf: Math.round(r.conf * 100) / 100
      });
    }
    // retry ladder, strict extraction at every rung: (t) template digits, (a) white
    // mask OCR, (b) + dilate (downscaled captures thin the strokes), (c) unmasked (dim
    // captures defeat the mask entirely; the digit-before-"As" regex filters the junk)
    var ptsRead = await maskedOcr(ptsRect, L.isWhiteText, { psm: 7 });
    var pts = ptsT != null ? ptsT : extractPts(ptsRead.text);
    if (pts == null) {
      var dRead = await dilatedOcr(ptsSub, L.isWhiteText, { scale: "auto", psm: 7 });
      logPtsRead("(dilated pts)", dRead);
      pts = extractPts(dRead.text);
    }
    if (pts == null) {
      var scale3 = Math.max(2, Math.min(4, Math.round(160 / Math.max(1, ptsSub.height))));
      var rawRead = await ocrText(upscale(ptsSub, scale3), { psm: 7 });
      logPtsRead("(unmasked pts)", rawRead);
      pts = extractPts(rawRead.text);
    }
    var ptsSoft = ptsT != null && ptsTSoft;   // dim anchored template read → capped authority
    if (pts == null) {
      // last resort on the (cleanest) masked text: digit + one word + "Points". This
      // accepted turn3's WRONG '5 re Points' once — hence it runs only after every
      // strict rung missed, and its checksum authority is capped (ptsSoft) so solved
      // levels stay in "confirm me" territory.
      var rm = normText(ptsRead.text).match(/^[^\dA-Za-z]*(\d{1,2})\s+\S{1,12}\s+[Pp]o?ints?\b/);
      if (rm) {
        var rv = parseInt(rm[1], 10);
        if (rv >= 4 && rv <= 20) { pts = rv; ptsSoft = true; }
      }
    }
    // TWO OR MORE synth commits mean the frame sits at the degraded tier where
    // the header read is junk-prone too (live: "18" on a 15-point board arrived
    // as a HARD read and bulldozed a correct gold hint) — demote pts to soft
    // authority there. One incidental synth consult on an otherwise-clean frame
    // is NOT the signature (requiring 2 keeps clean-frame confidences intact).
    var _synthCommits = lvFull.filter(function (r) { return r && r.src === "synth"; }).length;
    if (pts != null && !ptsSoft && _synthCommits >= 2) ptsSoft = true;

    // ---- JOINT LEVEL SOLVE ----
    // The 4 levels are 1-5 and SUM to the header points — a hard constraint that
    // couples the nodes. Pick the assignment maximizing total template score subject
    // to that sum; the unreadable gold-on-gold S digit is then forced by the other
    // three + points, not guessed. Each node's confidence = how much total score
    // you'd sacrifice to change JUST it (constraint-forced => near-certain; two
    // near-tied assignments => flagged). One solver, no special cases.
    function nodeScore(i, v) { return scoreVecs[i] ? (scoreVecs[i][v] || 0) : 0; }
    // FEASIBILITY GATE on the finished pts read (all rungs, not just the template
    // path): committed levels + the S-hint bound the possible total. Applied only
    // with ≥2 unknown nodes — there a wrong pts FORCES garbage assignments with no
    // way back (live: a blurred '15' OCR'd as '18' excluded the true levels
    // entirely); with 0-1 unknowns the existing mismatch machinery arbitrates.
    if (pts != null) {
      var kSumF = 0, nUnkF = 0;
      for (var kf = 0; kf < 4; kf++) { if (lvFull[kf].value != null) kSumF += lvFull[kf].value; else nUnkF++; }
      var hintF = (sHint != null && nUnkF > 0) ? 1 : 0;
      // a SOFT pts read doesn't get to lean on the hint: on the degraded tier a
      // junk header read (t6 live: "18", truth 15) slipped this gate via hint
      // credit and forced the free pair onto an infeasible sum
      if (ptsSoft ? nUnkF >= 2 : (nUnkF - hintF) >= 2) {
        var kAdj = kSumF + (hintF ? sHint : 0), uAdj = nUnkF - hintF;
        if (pts < Math.max(4, kAdj + uAdj) || pts > Math.min(20, kAdj + 5 * uAdj)) { pts = null; ptsSoft = false; }
      }
    }
    var indep = lvFull.map(function (r) { return { v: r.value, conf: r.conf }; });
    // PIN every committed read (template OR OCR, any confidence): the constraint must
    // NEVER override a value we actually read — it only FILLS truly-null nodes and
    // resolves a sum mismatch. (Overriding low-conf-but-correct reads was the
    // regression.) A committed read keeps its own confidence unless the checksum
    // confirms it. Free nodes (gold-on-gold S, unreadable blur) are the null ones.
    // (RULED OUT 2026-07-29, and this is the round-4 "a verifier must be able to
    // UN-PIN" idea measured directly: un-pinning a SYNTH-sourced W/E read whenever a
    // checksum exists, so the enumeration can question it instead of inheriting it as
    // a premise. Full corpus: 7 boards better, 5 worse — whole-parse 206 → 210 and
    // orderLevel 95.4 → 96.0, but effect2Level 96.0 → 95.0 and FA 6.2 → 6.3/shot, with
    // the headline flat at 96.9. The losses are boards where BOTH W and E are synth
    // reads: three free nodes and the enumeration wanders (c-mrwrevz3 went from a
    // perfect parse to three wrong levels). Gating on "≤2 free" kills the wins too —
    // nearly every case un-pins both. Net −1 field for no headline gain.)
    var pinned = indep.map(function (x) { return x.v != null; });
    var levels = [null, null, null, null], conf4 = [0, 0, 0, 0];
    var enumAssigned = [false, false, false, false];
    var freeIdx = [];
    for (var i = 0; i < 4; i++) { if (pinned[i]) { levels[i] = indep[i].v; conf4[i] = indep[i].conf; } else freeIdx.push(i); }

    if (pts != null) {
      var pinnedSum = 0; for (var pI = 0; pI < 4; pI++) if (pinned[pI]) pinnedSum += levels[pI];
      var remaining = pts - pinnedSum;
      if (freeIdx.length === 0) {
        if (remaining === 0) {
          // all four read AND they sum to points: mutually corroborated — but lift
          // proportionally (same coordinated-error risk as the 3-known solve: a
          // wrong pts offsetting one wrong level), so a near-guess stays flagged.
          // A sub-0.65 read may NOT cross the flag line on this lift alone: two
          // wrong low-evidence reads can compensate each other inside the sum
          // (measured round 2: W 5≠3 with E 2≠3 summed clean and E@0.60 lifted
          // to 0.85, silent).
          for (var bi = 0; bi < 4; bi++) {
            var lifted = Math.min(ptsSoft ? 0.85 : 0.92, indep[bi].conf + 0.25);
            if (indep[bi].conf < 0.65) lifted = Math.min(lifted, 0.79);
            conf4[bi] = Math.max(conf4[bi], lifted);
          }
        } else {
          // mismatch: one committed read (or points) is wrong — re-solve the
          // LEAST-confident read from the checksum, flag it
          var wi = indep.map(function (x, ii) { return { m: x.conf, ii: ii }; })
            .sort(function (p, q) { return p.m - q.m; })[0].ii;
          var fix = pts - (pinnedSum - levels[wi]);
          if (fix >= 1 && fix <= 5) { levels[wi] = fix; conf4[wi] = ptsSoft ? 0.6 : 0.75; }
          else conf4[wi] = 0.3;
        }
      } else if (freeIdx.length === 1) {
        // exactly one unknown: the constraint DETERMINES it (arithmetic, not a guess);
        // clean solve also confirms the 3 committed siblings
        var fi = freeIdx[0];
        if (remaining >= 1 && remaining <= 5) {
          levels[fi] = remaining;
          var minSib = Math.min.apply(null, [0, 1, 2, 3].filter(function (q) { return q !== fi; }).map(function (q) { return indep[q].conf; }));
          if (!ptsSoft) {
            // The checksum closing CORROBORATES the siblings — it is not proof. A
            // wrong pts plus one wrong level can cohere (seen live: pts '8'→'6'
            // with wp '3'→'1' promoted a 0.52 willpower read to confident). Lift
            // each sibling proportionally to its OWN evidence; sub-0.65 reads
            // may not cross the flag line on this lift (see the 4-known case).
            for (var sb = 0; sb < 4; sb++) if (sb !== fi) {
              var lift1 = Math.min(0.88, indep[sb].conf + 0.25);
              if (indep[sb].conf < 0.65) lift1 = Math.min(lift1, 0.79);
              conf4[sb] = Math.max(conf4[sb], lift1);
            }
            conf4[fi] = Math.min(0.85, 0.5 + minSib * 0.5);
          } else conf4[fi] = Math.min(0.65, 0.55 + minSib * 0.4);
          // S-hint arbitration (after the base assignment so it can't be clobbered):
          // the luminance read agreeing with the arithmetic solve is independent
          // corroboration; disagreement drops S into hard-flag territory
          if (fi === 3 && sHint != null) {
            conf4[3] = sHint === remaining ? Math.max(conf4[3], 0.85) : Math.min(conf4[3], 0.5);
            // ...and when the pts read is SOFT, a disagreeing hint WINS the value:
            // soft header reads at the degraded tier are junk-prone (t6 live read
            // "18" on a 15-point board and arithmetic wrote S=4 over a correct
            // hint of 1), while the hint channel is gated evidence
            if (ptsSoft && sHint !== remaining) { levels[3] = sHint; conf4[3] = 0.5; }
            else if (sHint !== remaining) {
              // FIRM pts disagreeing with the hint: the arithmetic blames S, but
              // the hint is gated evidence — the likelier culprit is a '1'-valued
              // W/E sibling (the ABSORBER class: eroded L→1, mask-fragment→1;
              // live 2aa9a4b2: a green "Lv. 3" fragment committed '1'@0.82 and
              // the checksum wrote S=3 over a gm-0.113 synth S=1). Test each such
              // sibling: does the SYNTHESIS prefer the value implied by S=hint?
              // Flip on the standard override bar; otherwise demote the sibling
              // below the flag line — the mismatch proves something here is
              // wrong, and a confident sibling is the one silent shape left.
              var flipped = false;
              for (var si = 1; si <= 2; si++) {
                if (flipped || !pinned[si] || levels[si] !== 1) continue;
                var vImp = remaining + 1 - sHint;   // sibling value if S = hint
                if (vImp >= 2 && vImp <= 5 && LREFS) {
                  var srF = synthLevelRescue(si === 1 ? "W" : "E", si === 1 ? nodes.nodeW : nodes.nodeE);
                  if (srF && srF.value === vImp && srF.gm >= 0.03) {
                    levels[si] = vImp; conf4[si] = 0.75;
                    levels[3] = sHint; conf4[3] = 0.85;
                    flipped = true;
                    continue;
                  }
                }
                conf4[si] = Math.min(conf4[si], 0.75);   // zero-silent guarantee
              }
            }
          }
        } else {
          // remaining out of 1..5: the checksum is INFEASIBLE, so one of the three
          // pinned reads (or pts) is wrong — not just the free node. Demote every
          // pinned sibling below the flag line too (a sliver-'1' at 0.90 rode this
          // branch out silently while only the free node got flagged).
          levels[fi] = indep[fi].v != null ? indep[fi].v : (fi === 3 && sHint != null ? sHint : 1);
          conf4[fi] = 0.3;
          for (var pd = 0; pd < 4; pd++) if (pinned[pd]) conf4[pd] = Math.min(conf4[pd], 0.75);
        }
      } else {
        // ≥2 unknowns: enumerate their assignments summing to `remaining`, pick the
        // max-template-score one; confidence from the assignment margin per node
        var vals = [1, 2, 3, 4, 5], combos = [];
        (function rec(k, acc, sum) {
          if (k === freeIdx.length) { if (sum === remaining) combos.push(acc.slice()); return; }
          for (var vi = 0; vi < 5; vi++) rec(k + 1, acc.concat(vals[vi]), sum + vals[vi]);
        })(0, [], 0);
        if (combos.length) {
          // PER-NODE PROVENANCE VOTES (round 2, the swap family): a free {W/E, S}
          // pair used to split on vec noise or plain generation order — and a
          // swapped pair sums the same, so the checksum can never catch it. Each
          // free node now brings its own independent witness into the scoring:
          // a REFUSED synth consult still carries channel rankings (memoized —
          // the consult is free here), and the gradient channel transfers across
          // degradation (the synthAmountDigit lesson). Weights stay under the S
          // luminance hint's 0.3 (gated pixel evidence outranks a refused
          // consult), and a committed-grade synth value outranks the hint.
          var synthVotes = {};
          if (LREFS) freeIdx.forEach(function (fi3) {
            var kindF = ["N", "W", "E", "S"][fi3];
            var pF = [nodes.nodeN, nodes.nodeW, nodes.nodeE, nodes.nodeS][fi3];
            var svr = synthLevelRescue(kindF, pF);
            if (svr) synthVotes[fi3] = svr;
          });
          combos.forEach(function (cm) {
            cm._s = 0;
            for (var q = 0; q < freeIdx.length; q++) {
              cm._s += nodeScore(freeIdx[q], cm[q]);
              // the S luminance hint breaks otherwise-blind ties: without it, a
              // free {effect, order} pair got split by generation order (the live
              // "Atk Power 5 / Chaos Points 3" board came out swapped)
              if (freeIdx[q] === 3 && sHint != null && cm[q] === sHint) cm._s += 0.3;
              var sv = synthVotes[freeIdx[q]];
              if (sv) {
                if (sv.gradTop === cm[q]) cm._s += 0.15 + (sv.rawTop === cm[q] ? 0.1 : 0);
                if (sv.value != null && sv.value === cm[q]) cm._s += 0.1;   // committed-grade consult
              }
            }
          });
          combos.sort(function (x, y) { return y._s - x._s; });
          var best = combos[0];
          // the enumeration's conclusions are only as good as its PREMISES (the
          // pinned reads + pts): a single feasible combo used to commit at 0.9
          // even when the pinned nodes were near-guesses — two wrong 0.55 pins
          // once forced (5,5) over a truth of (3,4), SILENTLY. Bound every
          // enumerated confidence by the weakest pinned premise.
          var minPin = 1;
          for (var pj = 0; pj < 4; pj++) if (pinned[pj]) minPin = Math.min(minPin, indep[pj].conf);
          var premiseCap = Math.min(0.9, 0.5 + minPin * 0.5);
          // ≥3 free nodes = a nearly-blind enumeration (pts + junk score vecs
          // only — live: a wrong S-hint steered a 4-free board to a coherent-
          // wrong orderLevel at 0.87): whatever the margins say, stay flagged
          if (freeIdx.length >= 3) premiseCap = Math.min(premiseCap, 0.78);
          for (var q2 = 0; q2 < freeIdx.length; q2++) {
            var fidx = freeIdx[q2];
            var alt = -Infinity;
            for (var r = 1; r < combos.length; r++) { if (combos[r][q2] !== best[q2]) { alt = combos[r]._s; break; } }
            levels[fidx] = best[q2];
            enumAssigned[fidx] = true;   // chosen BY the template vector — no self-corroboration
            if (alt === -Infinity) conf4[fidx] = premiseCap;
            else conf4[fidx] = Math.max(0.15, Math.min(premiseCap, 0.5 + (best._s - alt) * 3.0));
          }
        } else {
          // INFEASIBLE: no assignment of the free nodes can reach `remaining` —
          // proof that a pinned read or the pts is wrong. The free nodes take
          // their best independent evidence (S: the gated hint, not a blind 1)
          // and every pinned read drops below the flag line: the checksum just
          // impeached one of them and cannot say which.
          freeIdx.forEach(function (fi2) {
            if (fi2 === 3 && sHint != null) { levels[3] = sHint; conf4[3] = 0.5; return; }
            levels[fi2] = indep[fi2].v || 1; conf4[fi2] = 0.3;
          });
          for (var pk = 0; pk < 4; pk++) if (pinned[pk]) conf4[pk] = Math.min(conf4[pk], 0.75);
        }
      }
    }
    // no points (or unsolved free nodes): fall back to the committed per-node reads;
    // the S node takes its luminance hint instead of a blind default-to-1 (live
    // case: hint=4 correct, pts unreadable, S defaulted to 1)
    for (var f = 0; f < 4; f++) if (levels[f] == null) {
      if (f === 3 && sHint != null) { levels[3] = sHint; conf4[3] = 0.6; continue; }
      if (indep[f].v != null) {
        levels[f] = indep[f].v;
        // 0.78, not 0.85: with NO checksum the read has no corroborator, and a
        // junk-band '4'@0.90 for a willpower 1 shipped silently through the old cap
        conf4[f] = Math.min(0.78, indep[f].conf);
        continue;
      }
      // NULL node with NO checksum (round 3): a blind default-to-1 throws away
      // the refused consult's channel evidence — on the no-pts boards the
      // refused channels contain the truth far more often than '1' does.
      // Arbitrating the two dissenting channels by FIT QUALITY beats the
      // decisiveness rule ON THE BARE NODES: a channel whose best reference
      // only reaches 0.47 has found nothing while the other sits at 0.72, so
      // the higher PEAK says which one locked on. Full-corpus A/B: peak
      // everywhere gave willpower 94.0→94.7 and order 93.0→94.7 but
      // effect2Level 95.7→92.4, so it is scoped to N/S. The reason is the one
      // already documented for the absorber family — a W/E patch is a "Lv. N"
      // line inside a COLOURED diamond face, and its raw channel correlates on
      // face art, while N/S are bare digits where raw is real evidence. W/E
      // therefore keep the decisive-gradient rule. Peaks inside 0.01 express
      // no preference and fall through to decisiveness either way.
      // Deep-flagged at 0.4: a last-resort guess with evidence, not a read.
      var srD = LREFS ? synthLevelRescue(["N", "W", "E", "S"][f],
        [nodes.nodeN, nodes.nodeW, nodes.nodeE, nodes.nodeS][f]) : null;
      if (srD && (srD.gradTop != null || srD.rawTop != null)) {
        var bareF = f === 0 || f === 3;
        var useGrad = (bareF && srD.rawScore != null && srD.gradScore != null &&
                       Math.abs(srD.gradScore - srD.rawScore) >= 0.01)
          ? srD.gradScore > srD.rawScore
          : srD.gm >= 0.03;
        levels[f] = (useGrad && srD.gradTop != null) ? srD.gradTop
          : (srD.rawTop != null ? srD.rawTop : srD.gradTop);
        // ...EXCEPT the known W/E absorber standoff: raw prefers '2' over a
        // gradient '1'. The low-tier W:2 refs win the raw channel on true-1
        // boards structurally (the 2-for-1 family this round attacked) — in
        // that one pairing the windowed gradient is the trustworthy channel.
        if ((f === 1 || f === 2) && srD.rawTop === 2 && srD.gradTop === 1) levels[f] = 1;
        conf4[f] = 0.4;
      } else { levels[f] = 1; conf4[f] = 0; }
    }
    if (ptsSoft) conf4 = conf4.map(function (cv) { return Math.min(cv, 0.7); });
    // NO checksum at all: every level is a single-source read with nothing to
    // corroborate it — pinned or not, none may cross the flag line
    if (pts == null) conf4 = conf4.map(function (cv) { return Math.min(cv, 0.78); });

    // TWO-CHANNEL corroborator (false-alarm reduction — every flagged-but-correct
    // field is a wasted "confirm me" tap AND a wasted AI-verifier pull): lift a
    // mid-confidence level to 0.82 when the node's own template score vector
    // INDEPENDENTLY agrees with the final value. Independence rules: enumeration
    // picks are excluded (the enumeration chose BY the vector), template-committed
    // reads are excluded (their conf already IS the vector), and the S node is
    // excluded (its hint/vector are one channel, and hint agreement already boosts
    // to 0.85). What remains — OCR-committed reads and arithmetic solves — gets a
    // genuine second witness. A real margin is required so flat noise can't vote.
    for (var vc = 0; vc < 3; vc++) {
      if (ptsSoft) break;   // a soft checksum capped everything at 0.7 for a
                            // reason — the corroborator must not re-lift past it
      if (conf4[vc] < 0.5 || conf4[vc] >= 0.8) continue;
      if (enumAssigned[vc]) continue;
      // tm: conf already IS the vector. synth: its conf is deliberately capped
      // ≤0.55 and the "vec" on its line is often a letter-box score (an E-node
      // '(' vec corroborated a wrong synth 5 to 0.80, silent).
      if (lvFull[vc].value != null && (lvFull[vc].src === "tm" || lvFull[vc].src === "synth")) continue;
      // '1' at the upscaled tiers is the ABSORBER class — every eroded digit's
      // vec argmax collapses toward it, so a vec "agreeing" on 1 there is not
      // an independent witness (round 2: a wrong 1 rode this lift to 0.81,
      // silent). Ones stay flagged unless the checksum itself lifts them.
      if (levels[vc] === 1 && scaleF >= 2) continue;
      var vv = scoreVecs[vc];
      if (!vv) continue;
      var vb1 = -1, vb1v = null, vb2 = -1;
      for (var vd = 1; vd <= 5; vd++) { var vs = vv[vd]; if (vs > vb1) { vb2 = vb1; vb1 = vs; vb1v = vd; } else if (vs > vb2) vb2 = vs; }
      if (vb1v === levels[vc] && (vb1 - vb2) >= 0.03) conf4[vc] = 0.82;
    }

    out.config.willpowerLevel = levels[0]; confidence.config.willpowerLevel = conf4[0];
    out.config.effect1Level = levels[1]; confidence.config.effect1Level = conf4[1];
    out.config.effect2Level = levels[2]; confidence.config.effect2Level = conf4[2];
    out.config.orderLevel = levels[3]; confidence.config.orderLevel = conf4[3];
    if (out._debug) out._debug.pts = pts + (ptsSoft ? "(soft)" : "") + " levels=" + levels.join(",");
    if (out._debug) out._debug.lvl = [0, 1, 2, 3].map(function (q) {
      return ["N", "W", "E", "S"][q] + "=" + levels[q] + "@" + (conf4[q] || 0).toFixed(2) +
        (pinned[q] ? " pin(" + indep[q].v + "@" + indep[q].conf.toFixed(2) + ")" : enumAssigned[q] ? " enum" : " fill");
    }).join("  ");
    tmark("ptsAndSolve");

    // ---- effect NAMES: W/E caption OCR (white serif over art — masked) ----
    // Tall band: 2-line names ("Ally Damage / Enh.") start ~0.28·gap above center; the
    // level line begins ~+0.02·gap, so stop just above it. PSM 6: multi-line.
    // The mask is SLOT-AWARE: the diamond's bright specular highlight is near-white
    // but tinted toward the face hue (W is always green, E always blue) — excluding
    // white-ish pixels tinted toward the known face hue keeps the highlight out of
    // the text mask (this was most of the "Ally Damage" misreads).
    function effectNamePred(faceHue) {
      return function (r, g, b) {
        var c = L.hsv(r, g, b);
        if (!(c.v > 0.62 && c.s < 0.35)) return false;
        if (c.s > 0.12 && hueDist(c.h, faceHue) < 45) return false;   // tinted highlight
        return true;
      };
    }
    // relaxed variant for the last rescue rung: at small scales the antialiased
    // white text picks up the face tint, and the strict pred's highlight-exclusion
    // eats the TEXT itself (measured on the first flywheel record: strict mask 0.7%
    // ink → junk; this pred → a clean "Atk. Power"). Only ever used after the
    // strict rungs failed, so the highlight-pollution the strict pred exists to
    // prevent cannot regress clean frames.
    function effectNamePredRelaxed() {
      return function (r, g, b) { var c = L.hsv(r, g, b); return c.v > 0.5 && c.s < 0.45; };
    }
    async function readEffectName(p, faceHue, rung) {
      var rect = { x: p.x - gap * 0.55, y: p.y - gap * 0.34, w: gap * 1.1, h: gap * 0.36 };
      var read = rung === "relaxed"
        ? await dilatedOcr(L.crop(raster, rect), effectNamePredRelaxed(), { scale: "auto", maxAuto: 4, psm: 6 })
        : rung === "dilate"
          ? await dilatedOcr(L.crop(raster, rect), effectNamePred(faceHue), { scale: "auto", maxAuto: 4, psm: 6 })
          : await maskedOcr(rect, effectNamePred(faceHue), { psm: 6 });
      return { text: normText(read.text).toLowerCase().replace(/\n/g, " "), conf: read.conf };
    }
    // Most-specific patterns FIRST: "Enh." appears only in the two Ally effects, so an
    // occluded read like "Damage Enh." (a pet covering "Ally" — real case, 2026-07-16)
    // must hit Ally Damage Enh. before the generic /damage|attack/ effects get a shot.
    var EFFECT_LEX = [
      // "Ally" OCRs as Aliy/AIly/A11y — accept fuzzed leading tokens too
      ["Ally Damage Enh.", /a[li1|]{2}y\s*dam|ally\s*dam|damage\s*enh|dmg\s*enh/],
      ["Ally Attack Enh.", /a[li1|]{2}y\s*at|ally\s*at|attack\s*enh|atk\s*enh/],
      ["Additional Damage", /additional|addit/],
      ["Boss Damage", /boss/],
      ["Brand Power", /brand/],
      ["Attack Power", /atk|attack/]
    ];
    // Only effects legal for the gem's base cost are candidates (the cost-9 pool has no
    // Additional Damage/Brand Power — kills a whole class of misreads); `avoid` keeps
    // one slot's confident read from being duplicated into the other.
    var poolNames = (ENGINE_API.EFFECT_POOLS && ENGINE_API.EFFECT_POOLS[out.config.baseCost]) || null;
    function lexIn(t, pool, avoid) {
      for (var i = 0; i < EFFECT_LEX.length; i++) {
        var name = EFFECT_LEX[i][0];
        if (pool && pool.indexOf(name) === -1) continue;
        if (avoid && name === avoid) continue;
        if (EFFECT_LEX[i][1].test(t)) return name;
      }
      return null;
    }
    function lexEffect(t, avoid) { return lexIn(t, poolNames, avoid); }
    // Name-read rescue ladder (the FIRST live flywheel record, 2026-07-19: a
    // share-canvas frame OCR'd "Atk. Power" as "Abo Fo" — under the Tesseract
    // floor — so both names came back null and the snap filled pool-order
    // defaults that looked like a W/E swap). Same rescue pattern every other
    // read has: plain → dilated ×auto → relaxed-pred dilated. Later rungs run
    // only when the text still lexes to nothing, so clean frames cost zero
    // extra OCR calls.
    async function readNameLadder(p, faceHue) {
      var nm = await readEffectName(p, faceHue);
      if (!lexIn(nm.text, null, null)) nm = await readEffectName(p, faceHue, "dilate");
      if (!lexIn(nm.text, null, null)) nm = await readEffectName(p, faceHue, "relaxed");
      return nm;
    }
    var nmW = await readNameLadder(nodes.nodeW, hueW);
    var nmE = await readNameLadder(nodes.nodeE, hueE);
    if (out._debug) out._debug.nmTexts = { W: nmW.text.slice(0, 60), E: nmE.text.slice(0, 60) };

    var NAME_2LINE = { "Ally Damage Enh.": 1, "Ally Attack Enh.": 1, "Additional Damage": 1 };
    var FUZZY_KEYS = [
      ["damage", ["Boss Damage", "Ally Damage Enh.", "Additional Damage"]],
      ["attack", ["Attack Power", "Ally Attack Enh."]],
      ["power", ["Attack Power", "Brand Power"]],
      ["boss", ["Boss Damage"]],
      ["brand", ["Brand Power"]],
      ["additional", ["Additional Damage"]],
      ["ally", ["Ally Damage Enh.", "Ally Attack Enh."]],
      // ES client tokens (measured live: "dafio de jefe" / "dato aliado")
      ["jefe", ["Boss Damage"]],
      ["aliado", ["Ally Damage Enh.", "Ally Attack Enh."]],
      ["adicional", ["Additional Damage"]],
      ["ataque", ["Attack Power", "Ally Attack Enh."]],
      ["marca", ["Brand Power"]]
    ];
    function editDist1(a, b) {
      if (a === b) return true;
      if (Math.abs(a.length - b.length) > 1) return false;
      var i = 0, j = 0, edits = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
      }
      return edits + (a.length - i) + (b.length - j) <= 1;
    }
    function countNameLines(p) {
      var zone = { x: p.x - gap * 0.55, y: p.y - gap * 0.36, w: gap * 1.1, h: gap * 0.40 };
      var sub = L.crop(raster, zone);
      var mask = L.chromaMask(sub, L.isWhiteText);
      var rows = [], y, x;
      for (y = 0; y < mask.height; y++) {
        var on = 0;
        for (x = 0; x < mask.width; x++) if (mask.data[(y * mask.width + x) * 4] < 128) on++;
        rows.push(on);
      }
      var minPx = Math.max(2, Math.round(mask.width * 0.03));
      var bands = 0, run = 0, minRun = Math.max(3, Math.round(gap * 0.035));
      for (y = 0; y < rows.length; y++) {
        if (rows[y] >= minPx) run++;
        else { if (run >= minRun) bands++; run = 0; }
      }
      if (run >= minRun) bands++;
      return bands;
    }

    // ---- JOINT (cost, pool, name-assignment) SOLVE ----
    // The production confusions this replaces (the pairwise cross-check): a failed
    // title read left cost null, the snap defaulted 10, and pool-10 canonicalization
    // then DESTROYED two correctly-read support names (Ally Damage Enh.→Boss Damage,
    // Attack Power→Additional Damage — the two biggest name-confusion classes).
    // Grade every name's evidence per slot, score the best 2-name assignment inside
    // EACH cost's pool, add the title evidence, and pick the argmax — so a read name
    // can pull the cost rather than the (defaulted) cost erasing the name.
    // graded evidence: lex regex 1.0 · fuzzy token 0.55 · line-count ±(see below)
    function nameEvidence(t, p) {
      var ev = {};
      for (var li2 = 0; li2 < EFFECT_LEX.length; li2++) {
        if (EFFECT_LEX[li2][1].test(t)) { ev[EFFECT_LEX[li2][0]] = 1.0; break; }
      }
      // "Atk. Power" vs "Ally Attack Enh." share the attack stem; a bare attack-hit
      // with NO "power" tail is ambiguous between them (support gems made this the
      // top silent-name class: "wutoattack"/"aly attack" → Attack Power @0.82).
      if (ev["Attack Power"] && !/pow|ower|wer\b/.test(t)) {
        ev["Attack Power"] = 0.7;
        if (!(ev["Ally Attack Enh."] >= 0.65)) ev["Ally Attack Enh."] = 0.65;
      }
      var toks = t.split(/[^a-z]+/).filter(function (tk) { return tk.length >= 3; });
      FUZZY_KEYS.forEach(function (fk) {
        for (var ti = 0; ti < toks.length; ti++) {
          if (toks[ti].length >= 4 && editDist1(toks[ti], fk[0])) {
            fk[1].forEach(function (n) { if (!(ev[n] >= 0.55)) ev[n] = 0.55; });
            break;
          }
        }
      });
      if (Object.keys(ev).length) {
        // measured line count refines but must not overrule a full lex hit
        var lines = countNameLines(p);
        if (lines === 1 || lines === 2) {
          Object.keys(ev).forEach(function (n) {
            var match = (lines === 2) === !!NAME_2LINE[n];
            ev[n] += match ? 0.15 : (ev[n] >= 1.0 ? -0.1 : -0.3);
          });
        }
      }
      return ev;
    }
    var evW = nameEvidence(nmW.text, nodes.nodeW);
    var evE = nameEvidence(nmE.text, nodes.nodeE);
    function bestAssign(cost) {
      var pool = (ENGINE_API.EFFECT_POOLS && ENGINE_API.EFFECT_POOLS[cost]) || [];
      var best = { score: 0, a: null, b: null, aEv: 0, bEv: 0 };
      for (var ai = 0; ai < pool.length; ai++) {
        for (var bi = 0; bi < pool.length; bi++) {
          if (ai === bi) continue;
          var sa = evW[pool[ai]] || 0, sb = evE[pool[bi]] || 0;
          if (sa + sb > best.score) best = { score: sa + sb, a: pool[ai], b: pool[bi], aEv: sa, bEv: sb };
        }
      }
      return best;
    }
    var COSTS3 = [8, 9, 10];
    var asg = {};
    COSTS3.forEach(function (c) { asg[c] = bestAssign(c); });
    var titleCost = out.config.baseCost;
    {
      // title evidence per cost, usable even under the 0.5 commit bar (a partial
      // gram score still separates an 8-vs-9 tie the names alone can't)
      var sfxByCost = {};
      GEM_TITLES.forEach(function (t) {
        var c2 = GEM_NAME_COST[t.sfx];
        sfxByCost[c2] = Math.max(sfxByCost[c2] || 0, t.sfxScore || 0);
      });
      // tie preference [8, 10, 9] as an epsilon bias: fuzzy evidence smears tie
      // all three pools mostly on SUPPORT gems, and those are cost-8-heavy
      // (preferring 10 was tried — it re-broke 10 formerly-right costs to win 1);
      // 8 over 9 is the measured production skew on support-pair ties
      var TIE_EPS = { 8: 0.002, 10: 0.001, 9: 0 };
      var rankedC = COSTS3.map(function (c) {
        return { c: c, s: asg[c].score + Math.min(1.0, sfxByCost[c] || 0) * 0.6 + (titleCost === c ? 0.6 : 0) + TIE_EPS[c] };
      }).sort(function (a, b) { return b.s - a.s; });
      var winC = rankedC[0].c;
      if (out._debug) out._debug.jointCost = rankedC.map(function (r) { return r.c + ":" + r.s.toFixed(2) + "(nm" + asg[r.c].score.toFixed(2) + ")"; }).join(" ") + " title=" + titleCost;
      if (titleCost != null && winC !== titleCost) {
        // the title stands unless its own pool is CLEARLY beaten on name evidence
        // (the proven unique-pair override, generalized to graded scores)
        if (asg[winC].score - asg[titleCost].score >= 0.5) {
          out.config.baseCost = winC;
          confidence.config.baseCost = Math.min(confidence.config.baseCost, 0.75);   // below the flag threshold
        }
      } else if (titleCost == null && asg[winC].score >= 0.7) {
        // no title, but at least one decently-read name (a lone fuzzy token with
        // line-count agreement clears 0.7): emit the best pool-consistent cost
        // LOW — flagged for confirmation, but the read names survive the snap
        // (leaving null meant "default 10", which erased them)
        var margin2 = rankedC[0].s - rankedC[1].s;
        out.config.baseCost = winC;
        confidence.config.baseCost = margin2 >= 0.4 ? 0.7 : 0.5;
      }
      if (out.config.baseCost !== titleCost) {
        poolNames = (ENGINE_API.EFFECT_POOLS && ENGINE_API.EFFECT_POOLS[out.config.baseCost]) || null;
      }
    }
    // name commits from the winning assignment (evidence-graded confidence):
    //   ≥1.0 lex-grade hit → the proven 0.82 pool floor;
    //   0.55-1.0 fuzzy / ambiguity-downgraded → 0.75 cap, always flagged — and
    //   ONLY with a real (0.1) margin over the slot's best pool alternative:
    //   a fuzzy family-tie ("aly damage" → AddDmg = AllyDmg) used to commit by
    //   pool order and preempt the synth rescue that resolves such ties right.
    function slotMargin(ev, chosen) {
      var alt = 0;
      (poolNames || []).forEach(function (n) { if (n !== chosen && (ev[n] || 0) > alt) alt = ev[n] || 0; });
      return (ev[chosen] || 0) - alt;
    }
    // a slot is FAMILY-AMBIGUOUS when two pool names hold sub-lex evidence within
    // 0.1 of each other ("aly attack" fits Attack Power AND Ally Attack Enh.) —
    // then no commit from ANY path may reach the unflagged zone: the plain
    // lexEffect fallback used to re-commit the refused name at the 0.82 floor.
    function slotAmbiguous(ev, chosen, chosenEv) {
      return chosen != null && chosenEv >= 0.55 && chosenEv < 0.85 && slotMargin(ev, chosen) < 0.1;
    }
    // ambiguous-slot ARBITRATION: the tied family members go to the patch synth
    // (pixels, not tokens — it tells "Atk. Power" from the 2-line "Ally Attack
    // Enh." where the mangled text cannot); its answer commits flagged at 0.6.
    function tiedCands(ev, chosenEv) {
      return Object.keys(ev).filter(function (n) {
        return (poolNames || []).indexOf(n) !== -1 && ev[n] >= chosenEv - 0.1;
      });
    }
    var asgWin = asg[out.config.baseCost] || { a: null, b: null, aEv: 0, bEv: 0 };
    var ambW = slotAmbiguous(evW, asgWin.a, asgWin.aEv), ambE = slotAmbiguous(evE, asgWin.b, asgWin.bEv);
    if (asgWin.a && asgWin.aEv >= 0.55 && (asgWin.aEv >= 0.85 || !ambW)) {
      out.config.effect1 = asgWin.a;
      confidence.config.effect1 = asgWin.aEv >= 1.0
        ? Math.max(0.82, Math.min(0.92, nmW.conf + 0.3))
        : Math.min(0.75, 0.45 + asgWin.aEv * 0.3);
    } else {
      var synW = (ambW && NREFS) ? synthNameRescue("W", nodes.nodeW, tiedCands(evW, asgWin.aEv), null) : null;
      out.config.effect1 = synW || lexEffect(nmW.text, null);
      confidence.config.effect1 = out.config.effect1
        ? (synW ? 0.6 : Math.min(ambW ? 0.75 : 1, Math.max(poolNames ? 0.82 : 0, Math.min(0.92, nmW.conf + 0.3)))) : 0;
    }
    if (asgWin.b && asgWin.bEv >= 0.55 && asgWin.b !== out.config.effect1 &&
        (asgWin.bEv >= 0.85 || !ambE)) {
      out.config.effect2 = asgWin.b;
      confidence.config.effect2 = asgWin.bEv >= 1.0
        ? Math.max(0.82, Math.min(0.92, nmE.conf + 0.3))
        : Math.min(0.75, 0.45 + asgWin.bEv * 0.3);
    } else {
      var synE = (ambE && NREFS) ? synthNameRescue("E", nodes.nodeE, tiedCands(evE, asgWin.bEv), out.config.effect1) : null;
      out.config.effect2 = synE || lexEffect(nmE.text, out.config.effect1);
      confidence.config.effect2 = out.config.effect2
        ? (synE ? 0.6 : Math.min(ambE ? 0.75 : 1, Math.max(poolNames ? 0.82 : 0, Math.min(0.92, nmE.conf + 0.3)))) : 0;
    }
    // name rescue ladder when the lexicon got nothing (rare1: a 2-line
    // "Ally Damage Enh." OCR'd as 'jamage and the lexicon rightly refused).
    // Rung 1 — STRUCTURE: fuzzy keyword (edit distance 1 on tokens) × measured
    // LINE COUNT × the cost pool. Each name has a fixed render: 2-line names are
    // Ally Damage Enh. / Ally Attack Enh. / Additional Damage; the rest are
    // 1-line. When exactly ONE pool candidate survives, that's a unique
    // structural identification ("jamage" ×2 lines in pool 9 ⇒ Ally Damage
    // Enh., the only 2-line damage-name there). Rung 2 — patch synthesis.
    // Both commit FLAGGED at 0.6, never the 0.82 pool floor. (NAME_2LINE,
    // FUZZY_KEYS, editDist1, countNameLines are declared above — the joint
    // cost solve shares them.)
    function structuralName(nmText, p, allowed, avoid) {
      var toks = nmText.split(/[^a-z]+/).filter(function (t) { return t.length >= 4; });
      var hits = {};
      FUZZY_KEYS.forEach(function (fk) {
        var kw = fk[0];
        for (var ti = 0; ti < toks.length; ti++) {
          if (editDist1(toks[ti], kw)) { fk[1].forEach(function (n) { hits[n] = 1; }); break; }
        }
      });
      var cands = Object.keys(hits).filter(function (n) {
        if (avoid && n === avoid) return false;
        if (allowed && allowed.indexOf(n) === -1) return false;
        return true;
      });
      if (!cands.length) return null;
      if (cands.length > 1) {
        var lines = countNameLines(p);
        if (lines === 1 || lines === 2) {
          cands = cands.filter(function (n) { return (lines === 2) === !!NAME_2LINE[n]; });
        }
      }
      return cands.length === 1 ? cands[0] : null;
    }
    if (!out.config.effect1) {
      // AVOID the slot already committed (round 7). This rescue runs AFTER
      // effect2's commit, and it used to pass avoid=null — so it could hand
      // effect1 the very name effect2 had just taken. The snap then force-
      // distinguished them by bumping effect2 off its own correct read into
      // pool order: measured on `c-ms0e14l1-23vfq5`, where W reads "aoss damage"
      // and E "aaditional", and both slots shipped Additional Damage.
      var rnW = structuralName(nmW.text, nodes.nodeW, poolNames, out.config.effect2) ||
        (NREFS ? synthNameRescue("W", nodes.nodeW, poolNames, out.config.effect2) : null);
      if (rnW) { out.config.effect1 = rnW; confidence.config.effect1 = 0.6; }
    }
    if (!out.config.effect2) {
      var rnE = structuralName(nmE.text, nodes.nodeE, poolNames, out.config.effect1) ||
        (NREFS ? synthNameRescue("E", nodes.nodeE, poolNames, out.config.effect1) : null);
      if (rnE) { out.config.effect2 = rnE; confidence.config.effect2 = 0.6; }
    }

    // ---- pool backstop: a NULL cost is not evidence, a read NAME is (round 7) ----
    // When the title read fails, baseCost stays null and the snap defaults it to 10 —
    // and pool 10 then ERASES every committed name it does not contain. The late
    // rescue rungs above run with poolNames === null (nothing to restrict against),
    // so they legitimately emit cost-8/9 names that the default then destroys.
    // Measured on the 385-pair corpus: 5 boards lose 6 correctly-read names this way,
    // and on 3 of them the name PAIR pins the cost outright (Boss Damage ∧ Ally
    // Damage Enh. is pool 9 alone; Ally Damage Enh. ∧ Brand Power is pool 8 alone).
    // Fires only when the default pool CONTRADICTS the names, so boards whose true
    // cost is 10 are untouched; commits at 0.4, always flagged.
    if (out.config.baseCost == null) {
      var POOLS3 = ENGINE_API.EFFECT_POOLS || {};
      var haveNm = [out.config.effect1, out.config.effect2].filter(Boolean);
      var fitsPool = function (c) {
        var p = POOLS3[c] || [];
        return haveNm.every(function (n) { return p.indexOf(n) !== -1; });
      };
      if (haveNm.length && !fitsPool(10)) {
        // the joint solve's own tie order (8 > 10 > 9): fuzzy support-gem evidence
        // smears across pools and the production skew is cost-8-heavy
        var fitC = [8, 10, 9].filter(fitsPool);
        if (fitC.length) {
          out.config.baseCost = fitC[0];
          confidence.config.baseCost = 0.4;
          if (out._debug) out._debug.poolBackstop = haveNm.join("+") + "->" + fitC[0];
        }
      }
    }

    tmark("effectNames");
    await footerP;   // join the concurrent footer phase before the final section
    // ---- the 4 outcomes ----
    var iconXs = geo ? geo.outIconXs : L.ROI.outIconXs.map(function (fx) { return panel.x + fx * panel.w; });
    var iconY = geo ? geo.outIconY : panel.y + L.ROI.outIconY * panel.h;
    var _typeVotes = { chaos: 0, order: 0 };   // gold-cell caption votes (gemType backstop)
    // ---- the caption NAMES its own target (round 4) ----
    // Every tile writes its target above the amount: "Willpower Efficiency",
    // "Order/Chaos Points", or the side effect's own name. The cell reader used to
    // decide targets from the icon's median hue ALONE, and that patch drifts: a dim
    // willpower diamond lands at h=20-32 (the gold class) or in the violet class on
    // washed captures, and 13 boards render it so dark (v<0.31) that it reads grey
    // and the whole tile came out `do_nothing`. The caption comes from the TEXT
    // mask, so it fails independently of the face colour. Measured over the corpus:
    // decisive on 632 of 1200 cells and agreeing with the label on 629 — and it
    // never once fired on a truly grey (cost/reroll/maintained) tile.
    // "Efficiency"/"Eficiencia" is unique to willpower, "Points/Puntos/Очки" to the
    // order axis, and neither shares a stem with any effect name.
    var CAP_WILLPOWER = /wil+\s*po|[il]lpo|efficien|fficien|ficienc|iciency|icienc|volunta/;
    var CAP_POINTS = /[o0]rd\w*\s*[,.]?\s*[pf]|cha[o0]?s|ca[o0]s|xaoc|punt|p[o0][il1]?[nmr][tf]|f[o0][il1][nmr]|[o0]unt[cs]|[o0]rder|rder|qrder|sdor/;
    // The effect rung reuses EFFECT_LEX in ITS order, first match wins — that is
    // what keeps "atk. power" out of Ally Attack Enh. and "ally attack enh." out of
    // Attack Power. A bare "power" is deliberately NOT evidence: it is the stem
    // "Brand Power" and "Attack Power" share, and reading it as either was the only
    // wrong answer this channel gave ("srang povier", "bramd power").
    function captionTarget(t) {
      var hits = [];
      if (CAP_WILLPOWER.test(t)) hits.push("willpower");
      if (CAP_POINTS.test(t)) hits.push("order");
      var nm = null;
      for (var li = 0; li < EFFECT_LEX.length; li++) { if (EFFECT_LEX[li][1].test(t)) { nm = EFFECT_LEX[li][0]; break; } }
      if (nm && out.config.effect1 && nm === out.config.effect1) hits.push("effect1");
      else if (nm && out.config.effect2 && nm === out.config.effect2) hits.push("effect2");
      // two lexicons firing at once is garbage text arguing with itself — refuse
      return hits.length === 1 ? hits[0] : null;
    }
    // the four cells are data-independent — read them CONCURRENTLY (the OCR pool
    // overlaps them; serialized backends preserve old order via their queues);
    // every write below is oi-indexed, so completion order cannot matter
    var _evExtra = {};
    function cellEvid(oi, icls, ihue, target, amtLine, redLine, capRect, cap, o, oconf) {
      var capCrop = L.crop(raster, capRect);
      var evUp = L.colorClusterStats(capCrop, function (rr, gg, bb) { var c = L.hsv(rr, gg, bb); return c.h >= 75 && c.h < 145 && c.s > 0.35 && c.v > 0.45; });
      var evAm = L.colorClusterStats(capCrop, L.isAmountText);
      var evWh = L.colorClusterStats(capCrop, L.isWhiteText);
      (out._debug.cellEvid = out._debug.cellEvid || [])[oi] = {
        icls: icls, ihue: Math.round(ihue), target: target,
        dW: Math.round(hueDist(ihue, hueW)), dE: Math.round(hueDist(ihue, hueE)),
        amt: !!amtLine, red: !!redLine,
        up: { n: evUp.count, d: Math.round(evUp.density * 100) / 100 },
        am: { n: evAm.count, d: Math.round(evAm.density * 100) / 100 },
        wh: { n: evWh.count, d: Math.round(evWh.density * 100) / 100 },
        gap2: Math.round(gap * gap), cap: cap.replace(/\n/g, "|").slice(0, 60),
        o: JSON.stringify(o), conf: Math.round(oconf * 100) / 100, x: _evExtra[oi] || null
      };
    }
    async function readOutcomeCell(oi) {
      var icol = L.medianPatch(raster, iconXs[oi], iconY, patchHalf);
      var icls = L.hueClass(icol[0], icol[1], icol[2]);
      var ihue = L.hsv(icol[0], icol[1], icol[2]).h;

      // caption band under/around the icon
      var capRect = { x: iconXs[oi] - gap * 0.44, y: iconY - gap * 0.16, w: gap * 0.88, h: gap * 0.52 };
      var capRead = await maskedOcr(capRect, captionText, { psm: 6 });
      var cap = normText(capRead.text).toLowerCase();
      if (out._debug) (out._debug.caps = out._debug.caps || [])[oi] = icls + "· '" + cap.replace(/\n/g, "|").slice(0, 45) + "'";

      var o = null, oconf = 0;
      var target = null;
      if (icls === "red") target = "willpower";
      else if (icls === "gold") {
        target = "order";
        // free gemType evidence: the gold cell's caption names the axis
        // ("Chaos Points" / "Order Points") — reaped after the cells complete
        // for the title-unreadable frames (order→chaos was 7 of 240 live)
        if (/cha[ocs]|haos|ch[eé]o\s*po|caos|xaoc/.test(cap)) _typeVotes.chaos++;
        else if (/order|orde[rn]?\s*po|o.der\s*po|rder/.test(cap)) _typeVotes.order++;
      }
      else if (icls !== "grey") {
        // self-calibrated: match against this image's own W/E diamond hues
        var dW = hueDist(ihue, hueW), dE = hueDist(ihue, hueE);
        target = dW <= dE ? "effect1" : "effect2";
        if (Math.abs(dW - dE) < 12) oconf -= 0.35;   // near-tie: same-family effects
      }
      // the caption's own name outranks the icon patch (see captionTarget): it is a
      // different channel, and it is the only one that can speak at all on the dark
      // tiles the hue test calls grey. An override stays FLAGGED — the channel is
      // 99.5% right, not certain, and a wrong target must never look confident.
      var capT = captionTarget(cap);
      var capOverride = false;
      if (capT && capT !== target) { target = capT; capOverride = true; }

      // GREY cells are exactly two candidates: "Processing Cost ±100%" and
      // "Processing State Maintained" — both captions render DIM GREY, which the
      // white-text OCR half-misses (live: −100% cells read as +100% when the thin
      // '−' dropped, or as do_nothing when the caption missed entirely). Decide by
      // TEMPLATE: a '1','0','0' digit run under a grey mask = the cost cell, and
      // the sign is the box left of the run classified by SHAPE — the '−' bar is
      // short and wide, geometrically unlike '+'.
      // (…and a grey-looking cell whose caption NAMES a target is not one of those
      // two: it is a dark-rendered effect/willpower/order tile, so let it fall
      // through to the target ladder instead of the ±100%/maintained decision.)
      var greyCost = null;
      if (icls === "grey" && !capT) {
        var greyPred = function (r, g, b) { var c = L.hsv(r, g, b); return c.s < 0.32 && c.v > 0.42; };
        // dedicated dim-grey OCR: dilate + ×4 (the standard caption pass only gets ×2
        // and misses most of the grey text — 4 live −100% cells parsed as do_nothing)
        var gSub = L.crop(raster, capRect);
        var gRead2 = await dilatedOcr(gSub, greyPred, { scale: 3, psm: 6 });
        var gTxt = normText(gRead2.text).toLowerCase();
        // cost evidence: "100"-ish in either OCR, or a '0','0' template pair (round
        // dim glyphs match '0' well even when '1'/'−' merge away)
        var zeroPair = false;
        if (GLYPHS) {
          var tgC = templateGlyphs(capRect, greyPred);
          if (tgC) {
            for (var gi = 0; gi + 1 < tgC.length; gi++) {
              if (tgC[gi].ch === "0" && tgC[gi + 1].ch === "0" && tgC[gi].score >= 0.72 && tgC[gi + 1].score >= 0.72) zeroPair = true;
            }
          }
        }
        // "Cost" beheads to 'jos'/'gos' when the whole −100% line drops (live:
        // caption 'frosesz ng jos' — Processing + Cost fragments, no digits at all)
        var costish = /1\s*[o0]\s*[o0]|[cjg]ost|[cjg]os\b/.test(gTxt) || /1\s*[o0]\s*[o0]|[cjg]os\b/.test(cap) || zeroPair;
        var maintainish = /maintain|tained|state/.test(gTxt) || /maintain|state/.test(cap);
        // the third grey candidate: "View Other Items +N time(s)" — two live cells
        // read as do_nothing because only THIS dilated pass can see their captions
        var rerollish = /time|view|item|other/.test(gTxt) || /time|view|item|other/.test(cap);
        if (costish && !maintainish) {
          // SIGN: a '+' is fat and survives dim OCR; the thin '−' is what drops.
          // '+' anywhere ⇒ +100; cost-confirmed with no '+' ⇒ −100, kept flagged.
          var plusSeen = /\+/.test(gTxt) || /\+/.test(cap);
          greyCost = { neg: !plusSeen, conf: plusSeen ? 0.85 : 0.7 };
        } else if (rerollish && !maintainish) {
          var rrG = gTxt.match(/\+\s*([12])/) || cap.match(/\+\s*([12])/);
          o = { type: "reroll_increase", change: rrG ? parseInt(rrG[1], 10) : 1 };
          oconf += rrG ? 0.8 : 0.55;
        }
      }

      if (o) {
        // grey reroll decided above — confidence already accumulated
      } else if (greyCost) {
        o = { type: "change_gold_cost", change: greyCost.neg ? -100 : 100 };
        oconf += greyCost.conf;
      } else if (/maintain|state\s*maint/.test(cap)) {
        // "Processing State Maintained" — the literal do-nothing outcome
        o = { type: "do_nothing" };
        oconf += Math.min(0.9, capRead.conf + 0.3);
      } else if (/chang/.test(cap) && target && (target === "effect1" || target === "effect2")) {
        // "Effect Changed" OCRs as 'ectoct chango' etc. — /chang/ alone is safe here:
        // it's caption-scoped and gated on a colored side-effect icon
        o = { type: "change_side_option", target: target };
        oconf += Math.min(0.9, capRead.conf + 0.3);
      } else if (/time|view|other|item/.test(cap)) {
        var rrM = cap.match(/\+\s*([12])/);
        o = { type: "reroll_increase", change: rrM ? parseInt(rrM[1], 10) : 1 };
        oconf += rrM ? 0.9 : 0.6;
      } else if (/[cjg]ost|1\s*[o0]\s*[o0]\s*%|100/.test(cap)) {
        // cost captions are the ONLY ones containing "100"; the word itself OCRs as
        // Cost/Jost/Gost — the amount is the reliable signature. Checked BEFORE the
        // grey-icon fallback: "+100%" contains "+1" and used to be eaten as reroll+1.
        var neg = /-\s*10|−\s*10/.test(cap);
        o = { type: "change_gold_cost", change: neg ? -100 : 100 };
        oconf += 0.75;
      } else if (icls === "grey" && /\+\s*\d/.test(cap)) {
        var rrM2 = cap.match(/\+\s*([12])/);
        o = { type: "reroll_increase", change: rrM2 ? parseInt(rrM2[1], 10) : 1 };
        oconf += rrM2 ? 0.6 : 0.4;
      } else if (target) {
        // amount ("Lv. 2" / "+1") is the chartreuse line at the caption's bottom —
        // the name above it is white, so a chroma line-locate isolates it even over
        // the nebula art and the icon face behind the text.
        // Amount evidence ladder (2026-07-21, the level4/mJLklhw pair): rungs are
        // TIERED BY EVIDENCE QUALITY, and every weak rung has a second channel —
        //   tm   (template, solidity-vetoed)         → trusted outright
        //   ocr/cap (prefix-anchored regex)          → synth can override ONLY on
        //        full-agreement at 5× margin (the ▲ OCRs as a digit BEHIND a real
        //        '+' anchor: level4's "+1 ▲" read "+ 4")
        //   bare digit                               → accepted only when it agrees
        //        with the synth gradient-top (two weak channels)
        //   synth alone (agreement-gated)            → fills, conf-capped ≤0.78
        var amt = null, dirUp = false, dirDown = false;
        var amtSrc = null, bareCand = null, amtFromSynth = false;
        var capCx = iconXs[oi];
        // LOCATE LADDER (round 4). "No coloured line" now decides the tile's TYPE
        // (see the Effect-Changed rung below), so it has to mean "no line after a
        // real search", not "the strict locate declined". Strict first for both
        // colours, then one relaxed sweep — the same rescue shape every other read
        // in this engine has. A relaxed hit never reaches the unflagged zone.
        // CHARTREUSE ONLY: a loose RED sweep measured -2 tiles, all of them
        // raise→lower. Nothing else in a cell is chartreuse, but red is the
        // willpower face, the ▼ AND the ▲'s shadow, so a relaxed red hit sets
        // dirDown on tiles that are plainly raises. The strict red locate keeps
        // its rejectFill guard for exactly that reason.
        // THE AMOUNT LINE FALLS OUTSIDE capRect on two-line-caption tiles (measured
        // 2026-07-29 by eye on the direction misses): "Willpower / Efficiency" and
        // "Ally Damage / Enh." push the "+3 ▲" / "Lv. 2 ▲" row down past the
        // 0.52·gap crop, so the strict chartreuse locate finds nothing, the RED
        // sweep latches onto the willpower diamond's own face, and the tile becomes
        // a `lower`. Search a zone extended to 0.66·gap. The gold divider below the
        // strip cannot be mistaken for an amount: it is neither chartreuse nor red,
        // it fills its whole row (maxRowFill rejects it) and it spans far wider than
        // the 0.6·gap accept bound.
        var amtZone = { x: capRect.x, y: capRect.y, w: capRect.w, h: gap * 0.66 };
        function locateAmt(pred, loose, zone) {
          return L.findMaskedTextLine(raster, zone || capRect, pred, {
            maxRowFill: loose ? 0.85 : 0.7,
            rejectFill: pred === L.isRedAmountText ? 0.3 : undefined,
            minH: loose ? Math.max(3, Math.round(gap * 0.03)) : Math.max(4, Math.round(gap * 0.05)),
            maxH: Math.round(gap * (loose ? 0.24 : 0.2)), minRowPx: loose ? 1 : 3,
            // amount text is centered on the cell — skip icon tips / stray sparkles
            accept: function (r) {
              var cx = r.x + r.w / 2;
              return Math.abs(cx - capCx) <= gap * (loose ? 0.3 : 0.24) &&
                r.w >= gap * (loose ? 0.03 : 0.05) && r.w <= gap * (loose ? 0.7 : 0.6);
            }
          });
        }
        var amtLine = locateAmt(L.isAmountText, false);
        // THE EXTENDED CHARTREUSE ZONE OUTRANKS THE STRICT RED ONE (round 8). It used
        // to sit one rung below, so on a WILLPOWER cell whose amount row falls past
        // capRect the red locate ran first and always succeeded — red is that cell's
        // own diamond face. Measured over all 1880 corpus cells by label: a strict red
        // locate at a willpower cell fires on 47/49 true lowers AND 292/304 true
        // raises, i.e. it is 86% uninformative there, while the deep chartreuse locate
        // fires 301/304 vs 0/49. Reordering changes the located line on exactly 9 cells
        // corpus-wide and every one of them is a `raise_effect/willpower` — no lower,
        // no effect and no order cell moves. (Round 5's ruled-out experiment was a
        // different one: running the deep zone as the PRIMARY chartreuse locate, which
        // cost 5 tiles. This rung still only runs when the strict capRect locate found
        // nothing.)
        if (!amtLine) amtLine = locateAmt(L.isAmountText, false, amtZone);
        var redLine = amtLine ? null : locateAmt(L.isRedAmountText, false);
        var lineRelaxed = false;
        if (!amtLine && !redLine) {
          amtLine = locateAmt(L.isAmountText, true);
          lineRelaxed = !!amtLine;
        }
        if (amtLine) {
          var agrow = Math.round(amtLine.h * 0.5);
          var amtRectX = { x: amtLine.x, y: amtLine.y - agrow, w: amtLine.w, h: amtLine.h + agrow * 2 };
          // CLIP THE ARROW OUT OF THE READ (round 4). The located line usually
          // contains the ▲/▼, and tesseract reads a solid triangle as a digit —
          // 'Lv. 3 ▲' → 'vv 3 4', and the last-bare-digit rule then takes the 4.
          // The synthesis has clipped here since round 2; the OCR and template
          // passes were still reading the whole line. Only clip on a MEASURED
          // arrow (see arrowEnd) and only when a readable strip survives.
          var aClip = arrowEnd(amtLine);
          if (aClip.arrow && aClip.x1 - amtLine.x >= gap * 0.06) amtRectX.w = aClip.x1 - amtLine.x;
          // template match first (amounts use the same glyph art as the wheel
          // digits). Only the HIGH-tier commit (score≥0.86 with margin) skips
          // the synth consult — a 0.85-tier commit shipped a "+1 ▲" as +4
          // SILENTLY twice (round 2), so the weak tier stays consultable.
          var amTm = lastGoldDigit(amtRectX, L.isAmountText, 4);
          if (amTm) { amt = amTm.value; amtSrc = amTm.conf >= 0.9 ? "tm" : "tm-weak"; }
          if (amt == null) {
            var amtRead = await maskedOcr(amtRectX, L.isAmountText, { whitelist: "Lv.+12345 ", psm: 7 });
            // prefix-anchored — a bare digit here is a trap ('L' of a garbled
            // "Lv." OCRs as '1' at collect-crop blur); it becomes only a weak
            // CANDIDATE that must match the synth gradient-top to count
            var am = amtRead.text.match(/(?:lv\.?|\+)\s*([1-4])/i);
            if (am) { amt = parseInt(am[1], 10); amtSrc = "ocr"; }
            else {
              var bm = amtRead.text.match(/([1-4])(?![\s\S]*[1-4])/);   // last bare digit
              if (bm) bareCand = parseInt(bm[1], 10);
            }
            if (out._debug) (out._debug.amtOcr = out._debug.amtOcr || [])[oi] =
              "'" + amtRead.text.replace(/\n/g, "|").slice(0, 24) + "' -> " + (am ? am[1] : "null") + (bareCand != null ? " bare=" + bareCand : "");
          }
          // ▲/▼ sits at the line's right end; classify green-vs-red in that box only.
          // (Whole-cell clustering is hopeless: the outcome ICON — red willpower, green
          // attack — sits BEHIND the caption and swamps the counts.) The arrow is a
          // SOLID blob (density ≥~0.3 of its own bbox); icon-face bleed is diffuse.
          var arrowBox = { x: amtLine.x + amtLine.w - gap * 0.05, y: amtLine.y - agrow, w: gap * 0.25, h: amtLine.h + agrow * 2 };
          var arrowCrop = L.crop(raster, arrowBox);
          var aUp = L.colorClusterStats(arrowCrop, function (rr, gg, bb) {
            var c = L.hsv(rr, gg, bb); return c.h >= 75 && c.h < 145 && c.s > 0.35 && c.v > 0.45;
          });
          var aDown = L.colorClusterStats(arrowCrop, function (rr, gg, bb) {
            // ▼ renders dimmer than ▲ (v down to ~0.42 on blue/gold faces)
            var c = L.hsv(rr, gg, bb); return (c.h < 20 || c.h >= 345) && c.s > 0.45 && c.v > 0.4;
          });
          // arrows are SOLID triangles (density ≥~0.3 of their own bbox); nebula
          // sparkle and face-edge blends are diffuse — density-gate BOTH colors
          var upSolid = aUp.frac > 0.012 && aUp.count >= 8 && aUp.density > 0.25;
          var downSolid = aDown.frac > 0.012 && aDown.count >= 8 && aDown.density > 0.25;
          // the ICON FACE behind the caption shares a hue family with one arrow color:
          // evidence in the icon's own family is worthless (a red willpower face lands
          // compactly in the box and out-counts a real green ▲) — trust the other side
          // A LOCATED STRICT CHARTREUSE LINE ON A RED ICON IS ITSELF THE DIRECTION
          // (round 8). Round 4 established the rule for effect cells — "a located
          // chartreuse line is a raise 436/436 times" — and never extended it to
          // willpower, where it matters most: the willpower cell's face IS red, so the
          // ▼ predicate scores the face (measured on c-ms1n13pa: down 660 px at
          // density 0.63 against a real ▲ of 55 px) and the ▲ has to clear an absolute
          // frac bar it misses by a thousandth (0.011 vs the 0.012 gate). Fourteen
          // tiles corpus-wide read `lower willpower 1` on a plainly yellow "+3 ▲".
          // Re-measured over all 1880 cells by label: among willpower-target cells a
          // strict chartreuse locate fires on 291/304 raises and 0/49 lowers — a
          // willpower LOWER renders "−1" red on a red face and has no chartreuse ink
          // anywhere. Scoped to the STRICT locates (the relaxed sweep is the one that
          // can latch onto a stray fragment), so a relaxed line still needs the arrow.
          // Keyed on the resolved TARGET, not on `icls`: the guard exists because the
          // cell's own icon face poisons one arrow colour, and it is the target that
          // says which face this is. `icls` is only an estimate of it and it is wrong
          // on exactly this family — the willpower diamond reads "gold" on
          // c-mrtpk4nc-w4732c and c-mrugq62n-zqc9al, which dropped both boards into the
          // count-vs-count branch and lost it 76:80 and 152:632 to the red face.
          var ownRed = icls === "red" || target === "willpower";
          if (ownRed) { dirUp = upSolid || !lineRelaxed; dirDown = downSolid && !dirUp; }
          else if (icls === "green") { dirDown = downSolid; dirUp = upSolid && !downSolid; }
          else if (upSolid && downSolid) { dirUp = aUp.count >= aDown.count; dirDown = !dirUp; }
          else { dirUp = upSolid; dirDown = downSolid; }
          if (out._debug) (out._debug.arrows = out._debug.arrows || [])[oi] = {
            up: { count: aUp.count, frac: Math.round(aUp.frac * 1000) / 1000, density: Math.round(aUp.density * 100) / 100 },
            down: { count: aDown.count, frac: Math.round(aDown.frac * 1000) / 1000, density: Math.round(aDown.density * 100) / 100 }
          };
        }
        {
          // LOWER amounts render RED with a red ▼ — a red text line is itself the
          // direction signal. Red-on-red (a lower on the red willpower face) is
          // colorimetrically unreadable, like the gold S digit: rejectFill bails and
          // the willpower fallback below covers it. (The locate itself moved up into
          // the ladder; this block only READS what the ladder found.)
          if (redLine) {
            var rgrow = Math.round(redLine.h * 0.5);
            var redRectX = { x: redLine.x, y: redLine.y - rgrow, w: redLine.w, h: redLine.h + rgrow * 2 };
            // the red ▼ is INSIDE the red mask, so this crop needs the same
            // arrow clip as the chartreuse one above
            var rClip = arrowEnd(redLine);
            if (rClip.arrow && rClip.x1 - redLine.x >= gap * 0.06) redRectX.w = rClip.x1 - redLine.x;
            // template first: the red lower digits are the same glyph art as the gold
            // ones (the chroma mask makes them identical binary shapes); weak-tier
            // commits stay consultable (see the raise path)
            var redTm = lastGoldDigit(redRectX, L.isRedAmountText, 4);
            if (redTm) { amt = redTm.value; amtSrc = redTm.conf >= 0.9 ? "tm" : "tm-weak"; }
            if (amt == null) {
              var redRead = await maskedOcr(redRectX, L.isRedAmountText, { whitelist: "Lv.-12345 ", psm: 7 });
              // prefix-anchored; bare digits are weak candidates (see raise path)
              var rm2 = redRead.text.match(/(?:lv\.?|-|−)\s*([1-4])/i);
              if (rm2) { amt = parseInt(rm2[1], 10); amtSrc = "ocr"; }
              else {
                var rbm = redRead.text.match(/([1-4])(?![\s\S]*[1-4])/);
                if (rbm) bareCand = parseInt(rbm[1], 10);
              }
            }
            dirDown = true; dirUp = false;
          }
        }
        // ---- "Effect Changed" IS the tile with no coloured amount line ----
        // The /chang/ caption test misses 28 of 116 change tiles because the word
        // degrades past any regex — measured: "chanaod", "crangod", "cangoc",
        // "cmarged", "charzed", "erect crarsed", plus the ES client's "camb ado".
        // The signature is structural, not lexical: a change tile's second line is
        // WHITE like the name above it, while every raise renders a chartreuse
        // "Lv. N" and every lower a red one. The corpus is emphatic — among
        // effect-target cells, a located chartreuse line is a raise 436/436 times
        // and a located red line is a lower 55/55, while NEITHER line means change
        // 114 times against 21 everything-else. Defaulting that bucket to raise:1
        // (what it did) is the single largest outcome-miss class.
        // The bucket is 84% pure, not certain, so the commit is deliberately
        // FLAGGED; and a cell with no white ink at all is a blocked/blank tile, not
        // a change — three such cells are all this guard costs.
        if (!amtLine && !redLine && (target === "effect1" || target === "effect2")) {
          var whInk = L.colorClusterStats(L.crop(raster, capRect), L.isWhiteText);
          if (whInk.count >= 8) {
            out.outcomes[oi] = { type: "change_side_option", target: target };
            confidence.outcomes[oi] = Math.max(0, Math.min(0.95, (capOverride ? 0.55 : 0.62) * panelConf));
            if (COLLECT_EVID) cellEvid(oi, icls, ihue, target, amtLine, redLine, capRect, cap, out.outcomes[oi], 0.62);
            return;
          }
        }
        if (amt == null) {
          // prefix-anchored only — the caption's trailing garbage ends in stray
          // digits at collect-crop blur ("…1 7 4" from "+1 ▲" + sparkle)
          var amtM = cap.match(/(?:lv\.?\s*|\+\s*)([1-4])/);
          if (amtM) { amt = parseInt(amtM[1], 10); amtSrc = "cap"; }
        }
        // ---- synth consult (skipped only after a trusted template commit) ----
        var lnForSynth = amtLine || redLine;
        var amSy = (amtSrc !== "tm" && lnForSynth) ? synthAmountDigit(lnForSynth) : null;
        if (amSy && amt != null && amSy.value != null && amSy.value !== amt &&
            (amSy.gradOnly ? (amSy.gm >= (amtSrc === "tm-weak" ? 0.05 : 0.10) && amtSrc !== "tm") : amSy.gm >= 0.05)) {
          // an anchored-regex read can still be the ▲ wearing a legitimate anchor
          // (level4's "+1 ▲" OCR'd "+ 4") — a FULL-AGREE synth at 5× margin
          // outranks OCR/cap rungs. A GRADIENT-ONLY synth may now override too, at
          // double that bar (round 4): the transferable channel finding one class
          // 10× clear of the runner-up beats a 0.85-tier template or a caption
          // regex, and it is the only thing that catches the survivors of the
          // arrow-in-the-crop family. Measured on the full corpus: +4 tiles, −0.
          amt = amSy.value; amtFromSynth = true; amtSrc = "synth-override";
        }
        else if (amtSrc === "tm-weak" && amSy && amSy.value == null &&
                 amSy.gradTop != null && amSy.gradTop !== amt &&
                 amSy.gradTop !== 1 && amSy.gm >= 0.006) {
          // A 0.85-tier template that says '1' while a REFUSED consult's gradient
          // says something else is the absorber class showing up in the outcome
          // cells: eroded strokes template-match '1', which is also the modal
          // amount, so the two conspire. The asymmetry that makes this safe is
          // measured: on cells where the weak template fired at all (so there IS
          // ink), a dissenting non-1 gradient over the noise floor is right 3 of 3;
          // on cells where NOTHING read a digit the same rule is wrong 7 of 10, so
          // it stays scoped to the tm-weak configuration. Deep-flagged.
          amt = amSy.gradTop; amtFromSynth = true; amtSrc = "grad-contra";
        }
        if (amt == null && bareCand != null && amSy && amSy.gradTop === bareCand) {
          // two weak channels agreeing: a bare OCR digit + the synth gradient-top
          // (even below its commit gate) — either alone is a trap, together usable
          amt = bareCand; amtFromSynth = true; amtSrc = "bare+synth";
        }
        if (amt == null && amSy && amSy.value != null) {
          // synth alone (agreement-gated or grad-only at 3× margin) fills the null
          amt = amSy.value; amtFromSynth = true; amtSrc = "synth";
        }
        var amtWeak = false;
        if (amt == null && bareCand != null) {
          // LAST RUNG (round 4): every channel refused, so the alternative is a
          // blind default of 1 — and the corpus says the bare OCR digit beats that
          // 3 to 1. The rung used to demand agreement with the synth's gradient
          // top, from an era when the OCR crop still INCLUDED the ▲ and a bare
          // digit was as likely to be the arrow as the amount; the crop is clipped
          // now (see arrowEnd), which is what makes this safe enough to stand
          // alone. Deep-flagged: a guess with evidence, not a read.
          amt = bareCand; amtSrc = "bare"; amtWeak = true;
        }
        if (out._debug) (out._debug.amtSynth = out._debug.amtSynth || [])[oi] =
          (amSy ? (amSy.value != null ? "synth " + amSy.value : "refuse(top " + amSy.gradTop + ")") + "@gm" + amSy.gm.toFixed(3) + (amSy.gradOnly ? " gradOnly" : "") : "n/a") +
          " src=" + (amtSrc || "none");
        // a weak-tier template amount CONTRADICTED by the synth's (transferable)
        // gradient channel may keep its value but never its confidence.
        // BOTH FORMS OF DISSENT COUNT (round 8): the original test only fired when the
        // consult REFUSED (`value == null`) and its gradient top happened to differ —
        // so the WEAKER dissent was penalised and the STRONGER one, a consult that
        // actually committed a different value but missed the override bar
        // (gradOnly needs gm ≥ 0.10), sailed through at full confidence. That is
        // `c-ms167ipv-wwujgv`: tm-weak '4' against a committing synth '1' at gm 0.095,
        // shipped at 0.84 — SILENT, on a tile whose label is plainly '1' by eye.
        var amtContra = amtSrc === "tm-weak" && amSy && amSy.gradTop != null &&
          (amSy.value == null ? amSy.gradTop !== amt : amSy.value !== amt);
        var hadAmt = amt != null;
        if (COLLECT_EVID) _evExtra[oi] = {
          had: hadAmt, src: amtSrc, bare: bareCand, rel: lineRelaxed,
          sv: amSy ? amSy.value : null, sg: amSy ? amSy.gradTop : null, sr: amSy ? amSy.rawTop : null,
          sm: amSy ? Math.round(amSy.gm * 1000) / 1000 : null, go: amSy ? !!amSy.gradOnly : null
        };
        if (amt == null) amt = 1;
        // direction earns full confidence only with a STRONG signal: a located red
        // amount line, or an arrow blob of real size — a borderline arrow read stays
        // below the flag threshold (two silent lower→raise errors came from here)
        var strongDir = (redLine != null && dirDown) ||
          (dirUp && aUp && aUp.count >= 20) || (dirDown && aDown && aDown.count >= 20);
        if (!amtLine && !redLine && target === "willpower") {
          // red face + red text + red arrow: a willpower LOWER is invisible to every
          // color mask. But a willpower RAISE always shows a green ▲ (green-on-red
          // separates at any resolution) — so green anywhere in the cell decides.
          var wCrop = L.crop(raster, amtZone);
          var wUp = L.colorClusterStats(wCrop, function (rr, gg, bb) {
            var c = L.hsv(rr, gg, bb); return c.h >= 75 && c.h < 145 && c.s > 0.4 && c.v > 0.45;
          });
          if (wUp.frac > 0.006 && wUp.count >= 8) { dirUp = true; dirDown = false; }
          else { dirDown = true; dirUp = false; oconf -= 0.25; }
        }
        var type = dirDown && !dirUp ? "lower_effect" : "raise_effect";
        // a LOWER is always by 1 (OUTCOME_RATES has no −2/−3/−4 rung), so a lower
        // carrying a read amount ≥2 has two channels contradicting each other:
        // take the game's rule, keep the tile flagged.
        var amtImpossible = (type === "lower_effect" && amt >= 2);
        if (amtImpossible) amt = 1;
        o = { type: type, target: target, amount: amt };
        oconf += (hadAmt ? 0.55 : 0.25) + (strongDir ? 0.3 : (dirUp || dirDown) ? 0.15 : 0.05);
        // a synth-sourced amount NEVER reaches the unflagged zone — the rescue is
        // user/verifier-checkable, not silently authoritative (silent-error class)
        if (amtFromSynth) oconf = Math.min(oconf, 0.78);
        if (amtWeak) oconf = Math.min(oconf, 0.65);       // last-rung bare digit
        if (lineRelaxed) oconf = Math.min(oconf, 0.72);   // line found only by the loose sweep
        if (amtContra) oconf = Math.min(oconf, 0.72);   // contradicted weak template
        if (amtImpossible) oconf = Math.min(oconf, 0.7);  // lower-by-2+: rule-repaired
        // SAFETY: on order/points/willpower the direction arrow renders in the icon's
        // OWN hue family (a red raise ▲ on the gold order icon), so the color test is
        // unreliable there — a wrong direction must never be CONFIDENT. Require a clear
        // +/− sign to keep it unflagged; else cap below the UI threshold.
        if (target === "order" || target === "willpower") {
          var signSeen = /\+\s*[1-5]/.test(cap) || (/(?:^|\s)[-−]\s*[1-5]/.test(cap) && !/lv/i.test(cap));
          if (!signSeen) {
            // vivid-yellow sign read: these amounts render in the same saturated pure
            // yellow that unlocked the gold-on-gold S digit — a mask the caption's
            // white words and the icon face can't leak into. Sign + digit, directly.
            var vividPred = function (r, g, b) { var c = L.hsv(r, g, b); return c.h >= 38 && c.h <= 64 && c.s > 0.7 && c.v > 0.68; };
            // read the LOCATED line when there is one: the whole-cell crop drags in
            // the icon's own vivid rim and (once the zone reaches past the strip) the
            // gold divider, either of which the "+-−" whitelist happily reads as a
            // minus sign — a false LOWER on a raise tile.
            var vRect = amtLine
              ? { x: amtLine.x, y: amtLine.y - Math.round(amtLine.h * 0.4), w: amtLine.w, h: amtLine.h + Math.round(amtLine.h * 0.8) }
              : capRect;
            var vRead = await maskedOcr(vRect, vividPred, { whitelist: "+-−12345 ", psm: 7 });
            var vTxt = vRead.text || "";
            if (/\+\s*\d/.test(vTxt)) { o.type = "raise_effect"; signSeen = true; }
            else if (/[-−]\s*\d/.test(vTxt)) { o.type = "lower_effect"; signSeen = true; }
            if (signSeen) {
              var vAmt = vTxt.match(/([1-4])/);
              if (vAmt && !hadAmt) o.amount = parseInt(vAmt[1], 10);
            }
          }
          if (!signSeen) oconf = Math.min(oconf, 0.72);
        }
      } else {
        o = { type: "do_nothing" };
        oconf += 0.2;
      }
      // a target the caption OVERRODE stays under the flag line, whatever the rest
      // of the ladder concluded — one channel contradicting another is exactly the
      // shape the user should confirm
      if (capOverride) oconf = Math.min(oconf, 0.72);
      if (COLLECT_EVID) cellEvid(oi, icls, ihue, target, typeof amtLine !== "undefined" && amtLine, typeof redLine !== "undefined" && redLine, capRect, cap, o, oconf);
      out.outcomes[oi] = o;
      confidence.outcomes[oi] = Math.max(0, Math.min(0.95, oconf * panelConf));
    }
    await Promise.all([0, 1, 2, 3].map(readOutcomeCell));

    // ---- gemType backstops (title unreadable / weak) ----
    // 1) the gold outcome-caption votes collected above; 2) the S-node's own
    // "Chaos/Order Points" label — one extra OCR call, paid only when needed.
    if (out.config.gemType == null || (confidence.config.gemType || 0) < 0.8) {
      var tvC = _typeVotes.chaos > 0, tvO = _typeVotes.order > 0;
      if (tvC !== tvO) {
        var voteType = tvC ? "chaos" : "order";
        if (out.config.gemType == null || out.config.gemType === voteType) {
          out.config.gemType = voteType;
          confidence.config.gemType = Math.max(confidence.config.gemType || 0, 0.85);
        }
        // a vote CONTRADICTING a (weak) title read: leave the value, keep it flagged
      } else if (out.config.gemType == null) {
        var sLabelRect = { x: nodes.nodeS.x - gap * 0.5, y: nodes.nodeS.y - gap * 0.30, w: gap * 1.0, h: gap * 0.32 };
        var sLabel = await maskedOcr(sLabelRect, effectNamePredRelaxed(), { psm: 7 });
        var sTxt = normText(sLabel.text).toLowerCase();
        if (!/cha[ocs]|haos|caos|xaoc|has?\s*point|orde|rder/.test(sTxt)) {
          var sLabel2 = await dilatedOcr(L.crop(raster, sLabelRect), effectNamePredRelaxed(), { scale: "auto", maxAuto: 4, psm: 7 });
          sTxt = normText(sLabel2.text).toLowerCase();
        }
        // measured degradations: "Chace pointe", "has pointes", "onn xaoca" (RU),
        // "caos" (ES) — vs "Order/O-der points"
        if (/cha[ocs]|haos|ch[eé]o|caos|xaoc|has?\s*point/.test(sTxt)) { out.config.gemType = "chaos"; confidence.config.gemType = 0.8; }
        else if (/order|rder|o.der/.test(sTxt)) { out.config.gemType = "order"; confidence.config.gemType = 0.8; }
        if (out._debug) out._debug.sLabel = sTxt.slice(0, 40);
      }
    }

    // panel-quality attenuation on the art-region fields
    ["willpowerLevel", "orderLevel", "effect1Level", "effect2Level", "effect1", "effect2"].forEach(function (k) {
      confidence.config[k] = (confidence.config[k] || 0) * panelConf;
    });

    // ---- HONESTY GUARD: degraded OCR must never look confident ----
    // If the OCR backend died (worker failed to load, CDN blocked, crash), the
    // parse silently completes on color/template reads alone and the text-derived
    // fields become pool-plausible GUESSES. Measured in the wild: effect names
    // invented at conf ~0.8 in 1-second parses. Cap EVERYTHING at 0.5 so the whole
    // window flags "confirm me", and mark the parse so the UI can say why.
    if (ocrFails >= 3) {
      out.ocrDegraded = true;
      Object.keys(confidence.config).forEach(function (k) { confidence.config[k] = Math.min(confidence.config[k] || 0, 0.5); });
      Object.keys(confidence.state).forEach(function (k) { confidence.state[k] = Math.min(confidence.state[k] || 0, 0.5); });
      for (var ci = 0; ci < confidence.outcomes.length; ci++) confidence.outcomes[ci] = Math.min(confidence.outcomes[ci] || 0, 0.5);
    }
    tmark("outcomes");
    if (out._debug) {
      _timing.ocrTotal = Math.round(_ocrMs);
      out._debug.timing = _timing;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // browser engine class
  // ---------------------------------------------------------------------------
  function StructuralEngine() {}
  if (typeof ENGINE_API.BaseEngine === "function" || (ENGINE_API.OcrEngine)) {
    var Base = ENGINE_API.BaseEngine || ENGINE_API.OcrEngine;
    StructuralEngine.prototype = Object.create(Base.prototype);
    StructuralEngine.prototype.constructor = StructuralEngine;
  }
  StructuralEngine.prototype.name = "structural";
  StructuralEngine.prototype.label = "Structural (offline, default)";
  StructuralEngine.prototype.isAvailable = function () {
    // available when the background offload can run (it imports its OWN
    // Tesseract) — the main-thread CDN bundle is no longer loaded up front;
    // the inline fallback lazy-injects it on demand (see ensureTesseractCdn)
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    if (typeof Worker !== "undefined" && typeof ImageData !== "undefined") return true;
    return typeof window.Tesseract !== "undefined";
  };
  StructuralEngine.prototype.unavailableReason = function () { return "Needs a browser with Web Worker support (or the Tesseract CDN script)."; };

  // Lazy CDN injection for the INLINE FALLBACK only: with the offload healthy,
  // the ~4MB Tesseract bundle never loads (or parses) on the main thread at all.
  var _cdnP = null;
  function ensureTesseractCdn() {
    if (typeof window !== "undefined" && typeof window.Tesseract !== "undefined") return Promise.resolve(true);
    if (_cdnP) return _cdnP;
    _cdnP = new Promise(function (resolve) {
      try {
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        s.onload = function () { resolve(typeof window.Tesseract !== "undefined"); };
        s.onerror = function () { _cdnP = null; resolve(false); };
        document.head.appendChild(s);
      } catch (e) { _cdnP = null; resolve(false); }
    });
    return _cdnP;
  }

  var _workerP = null;
  function getWorker() {
    if (!_workerP) {
      _workerP = window.Tesseract.createWorker("eng", 1, { logger: function () {} });
      // a failed creation (CDN worker/wasm/traineddata blocked or flaky) must not
      // stick: null the cache so the NEXT call retries instead of failing forever
      _workerP.catch(function () { _workerP = null; });
    }
    return _workerP;
  }
  function rasterToCanvas(raster) {
    var c = document.createElement("canvas");
    c.width = raster.width; c.height = raster.height;
    var ctx = c.getContext("2d");
    var id = ctx.createImageData(raster.width, raster.height);
    id.data.set(raster.data);
    ctx.putImageData(id, 0, 0);
    return c;
  }
  var _ocrQueue = Promise.resolve();
  function browserOcr(raster, opts) {
    // Serialize on one worker; set per-call params (whitelist / psm).
    // RESILIENCE (this was a production bug): the queue must never carry a
    // rejection forward — one failed worker init used to poison every later OCR
    // call for the session, so parses "succeeded" in ~1s with pool-guessed effect
    // names at ~0.8 confidence. Now each call starts from a settled queue, a
    // failure resolves to {failed:true} (counted by the engine's honesty guard,
    // which caps ALL confidences at 0.5), and the dead worker is discarded so
    // the next parse retries from scratch.
    var call = _ocrQueue.catch(function () {}).then(function () {
      return getWorker().then(function (w) {
        var params = { tessedit_pageseg_mode: String(opts.psm || 6), user_defined_dpi: "150" };
        params.tessedit_char_whitelist = opts.whitelist || "";
        return w.setParameters(params).catch(function () {}).then(function () {
          return w.recognize(rasterToCanvas(raster));
        }).then(function (res) {
          return { text: (res && res.data && res.data.text) || "", conf: ((res && res.data && res.data.confidence) || 40) / 100 };
        });
      }).catch(function () {
        _workerP = null;   // worker is dead — force a fresh createWorker next time
        return { text: "", conf: 0, failed: true };
      });
    });
    _ocrQueue = call;
    return call;
  }

  // ---- background parse offload (2026-07-19: "don't freeze the website") ----
  // The parse runs in ocr/parse-worker.js when Workers are available; the main
  // thread only decodes the input to a raster (cheap) and transfers the buffer.
  // ANY offload failure disables it for the session and the inline path takes
  // over — identical behavior, just blocking.
  var _bg = null, _bgDisabled = false, _bgSeq = 0, _bgPending = {};
  // model/astrogem.js is NOT in LAZY_TABS.advisor — it loads EAGERLY in
  // index.html — so the LAZY_TABS harvest below can never supply its ?v= and
  // the parse worker used to importScripts a bare, cache-forever URL: the exact
  // version-skew hole the pins exist to close. This pin MUST match the eager
  // <script src="model/astrogem.js?v=…"> in index.html on EVERY deploy that
  // bumps astrogem.js (2026-07-25 map: astrogem 53; model/dp-worker.js pins the
  // same file for the same reason — keep all three in step).
  var MODEL_ASTROGEM_V = "53";
  function bgWorkerUrls() {
    var v = {};
    try {
      ((window.LAZY_TABS && window.LAZY_TABS.advisor) || []).forEach(function (u) {
        var m = String(u).match(/([^\/]+\.js)(\?v=\d+)?$/);
        if (m) v[m[1]] = m[2] || "";
      });
    } catch (e) {}
    // seed the pinned astrogem version; a future LAZY_TABS entry would win
    if (!v["astrogem.js"]) v["astrogem.js"] = "?v=" + MODEL_ASTROGEM_V;
    function f(name, dir) { return (dir || "") + name + (v[name] || ""); }
    return [
      "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
      f("astrogem.js", "../model/"), f("engine.js"), f("layout.js"), f("glyphs.js"),
      f("level-refs.js"), f("tesseract-engine.js"), f("structural-engine.js")
    ];
  }
  function getBgWorker() {
    if (_bgDisabled || typeof Worker === "undefined" || typeof ImageData === "undefined") {
      return Promise.resolve(null);
    }
    if (_bg) return _bg.readyP.then(function (ok) { return ok ? _bg : null; });
    var w;
    try { w = new Worker("ocr/parse-worker.js?v=1"); }
    catch (e) { _bgDisabled = true; return Promise.resolve(null); }
    var readyResolve;
    _bg = { w: w, readyP: new Promise(function (res) { readyResolve = res; }) };
    w.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === "ready") readyResolve(true);
      else if (m.type === "init-error") { _bgDisabled = true; readyResolve(false); }
      else if (m.type === "result" && _bgPending[m.id]) {
        var cb = _bgPending[m.id];
        delete _bgPending[m.id];
        cb(m);
      }
    };
    w.onerror = function () {
      _bgDisabled = true;
      try { readyResolve(false); } catch (e) {}
      Object.keys(_bgPending).forEach(function (id) { var cb = _bgPending[id]; delete _bgPending[id]; cb({ error: "worker crashed" }); });
    };
    w.postMessage({ type: "init", urls: bgWorkerUrls() });
    return _bg.readyP.then(function (ok) { return ok ? _bg : null; });
  }
  function bgParse(raster) {
    return getBgWorker().then(function (bg) {
      if (!bg) return null;
      return new Promise(function (resolve) {
        var id = ++_bgSeq;
        _bgPending[id] = function (m) { resolve(m.error ? null : m.result); };
        // TRANSFER the pixels (zero-copy) — the raster is dead to this thread
        // afterwards; the fallback path re-decodes from the original input
        bg.w.postMessage({ type: "parse", id: id, width: raster.width, height: raster.height, buf: raster.data.buffer }, [raster.data.buffer]);
      });
    });
  }

  StructuralEngine.prototype.parseScreenshot = function (input) {
    var self = this;
    function inline() {
      // the fallback needs the main-thread Tesseract — inject it now if the
      // page never loaded it (the offload path doesn't); a failed injection
      // still parses on templates/colors and the honesty guard flags the rest
      return ensureTesseractCdn().then(function () {
        return toRaster(input);
      }).then(function (raster) {
        return parseStructural(raster, browserOcr);
      }).then(function (raw) {
        var snapped = self.constraintSnap(raw);
        snapped.confidence = raw.confidence ? snapped.confidence : undefined;
        if (raw.ocrDegraded) snapped.ocrDegraded = true;
        if (raw._srcPanel) snapped._srcPanel = raw._srcPanel;   // for the AI verifier's crop
        return snapped;
      });
    }
    if (typeof window !== "undefined" && window.__agForceInline) return inline();   // debug hook
    return toRaster(input).then(function (raster) {
      return bgParse(raster).then(function (bgResult) {
        return bgResult || inline();
      });
    }).catch(function () { return inline(); });
  };
  function toRaster(input) {
    return new Promise(function (resolve, reject) {
      function fromImg(img) {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
        var ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var id = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ width: c.width, height: c.height, data: id.data });
      }
      if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
        if (input.complete) fromImg(input);
        else { input.onload = function () { fromImg(input); }; input.onerror = reject; }
      } else if (typeof HTMLCanvasElement !== "undefined" && input instanceof HTMLCanvasElement) {
        var ctx = input.getContext("2d");
        var id = ctx.getImageData(0, 0, input.width, input.height);
        resolve({ width: input.width, height: input.height, data: id.data });
      } else if (input && (input instanceof Blob)) {
        var url = URL.createObjectURL(input);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); fromImg(img); };
        img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      } else reject(new Error("Unsupported input type for the structural engine."));
    });
  }
  StructuralEngine.prototype.disposeWorker = function () {
    if (_workerP) {
      _workerP.then(function (w) { try { w.terminate(); } catch (e) {} }).catch(function () {});
      _workerP = null;
    }
  };
  // Warm-up at engine load (tab activation) so the FIRST parse doesn't pay the
  // startup: when the background offload is available, warm THAT (its
  // importScripts + Tesseract spin up off-thread) and leave the main-thread
  // Tesseract cold — it only exists as the inline fallback and spinning both
  // doubled memory and startup for nothing. No offload → old main-thread warm.
  if (typeof window !== "undefined") {
    try {
      if (typeof Worker !== "undefined" && typeof ImageData !== "undefined") getBgWorker();
      else if (typeof window.Tesseract !== "undefined") getWorker();
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // register + export
  // ---------------------------------------------------------------------------
  if (!IS_NODE && ENGINE_API.registerEngine) {
    ENGINE_API.registerEngine(new StructuralEngine());
  } else if (!IS_NODE && root.ocrRegisterEngine) {
    root.ocrRegisterEngine(new StructuralEngine());
  }

  var EXPORT = { parseStructural: parseStructural, StructuralEngine: StructuralEngine };
  if (IS_NODE) module.exports = EXPORT;
  else root.OcrStructuralEngine = EXPORT;
})(typeof globalThis !== "undefined" ? globalThis : this);
