/**
 * ocr/gemlist-engine.js — reads the Ark Grid "Astrogem" LIST panel.
 *
 * This is a SECOND, much smaller reader, unrelated to ocr/structural-engine.js
 * (which reads the single-gem PROCESSING window). Here the input is a whole
 * game screenshot; the target is the scrollable list on the middle right of the
 * Ark Grid screen, up to 9 astrogems at a time, each row shaped like:
 *
 *     [gem icon]   5  (*)  |  Ally Damage Enh. Lv. 1
 *                  4  (P)  |  Brand Power Lv. 1        [Unequip]
 *
 * The willpower number sits on line 1 next to the gold willpower icon, the
 * order/chaos points on line 2 next to the gold (P) disc, and each line carries
 * one effect name (white) followed by its level (gold "Lv. N").
 *
 * WHY THIS IS ENOUGH TO GRADE: model/astrogem.js scores a gem from its
 * WILLPOWER COST, its order/chaos points and its two effect lines — the base
 * cost (8/9/10) never enters gemValue. This panel shows every one of those, so
 * a row reads straight into a grade. The base cost is only recovered for the
 * label (from the effect PAIR, which is unique to one pool most of the time).
 *
 * ============================== HOW IT WORKS ==============================
 *
 * 1. MASKS. Two per-pixel masks over the whole screenshot: `gold` (hue 32-62,
 *    saturated and bright — the game's UI gold) and `white` (bright, unsaturated
 *    — every effect name).
 *
 * 2. ANCHOR. The nine gold (P) discs are the only place on the screen where a
 *    small, bright-gold, ~equally-tall blob repeats down a single column at a
 *    constant pitch. We slide a narrow window across x, collect gold row-runs
 *    inside it, and keep the window whose runs best fit an arithmetic
 *    progression. That yields, WITHOUT assuming any resolution:
 *      iconCx  — the x of the icon column
 *      pitch   — the row pitch in pixels (the UI scale)
 *      rows    — the y of each row's LINE 2
 *    The willpower icon on line 1 is a hollow outline: it has too few gold
 *    pixels per scanline to pass the run threshold, which is exactly why the
 *    (P) discs come out clean and alone.
 *
 * 3. GEOMETRY. Everything after this is expressed in PITCH UNITS relative to
 *    (iconCx, rowY) — see GEO below — so the reader is resolution-free.
 *
 * 4. FIELDS. Per line: the digit box left of the icon, then the text band to the
 *    right of the divider. In the text band the level is GOLD and the effect
 *    name is WHITE, so the first gold run splits them; anything right of the
 *    level (the "Unequip" button) is ignored.
 *
 * 5. MATCHING. Each field is cut to a canonical patch (names scaled by pitch,
 *    digits scaled to a fixed height) and matched by normalized correlation
 *    against the templates in ocr/gemlist-refs.js, harvested from labelled
 *    screenshots by tools/build-gemlist-refs.js. Every field reports a margin
 *    (best minus runner-up); a thin margin sets a flag so the UI can ask the
 *    user to check that cell instead of quietly grading a wrong gem.
 *
 * No dependencies, no network, no Tesseract. Browser: attaches
 * window.GemListEngine. Node: module.exports (tools/eval-gemlist.js).
 * ==========================================================================
 */
(function (root) {
  "use strict";

  // ---- geometry, in ROW-PITCH units relative to (iconCx, line centre y) ----
  // Measured on native 3834x1797 captures (pitch 104.75 px); every constant is a
  // ratio, so the same numbers hold at any UI scale.
  var GEO = {
    lineDy: 0.4582,        // line 1 centre -> line 2 centre (the (P) disc row)
    digitX0: -0.53, digitX1: -0.24,   // willpower / points digit box
    digitY0: -0.17, digitY1: 0.19,
    textX0: 0.50, textX1: 3.40,       // effect name + "Lv. N" band
    textY0: -0.21, textY1: 0.23,
    // The gem picture, measured from the LINE-2 centre: it straddles both lines,
    // so it sits mostly above. Kept to the sphere's core — the row's gold
    // gradient starts just outside it and would swamp the hue vote.
    iconX0: -1.45, iconX1: -0.85,     // (order = pink, chaos = blue)
    iconY0: -0.62, iconY1: 0.16,
    // The "Unequip" button, present only on an equipped gem. It is centred on the
    // ROW (0.229 pitch above the line-2 centre), not on either text line.
    btnX0: 3.62, btnX1: 4.68,
    btnY0: -0.40, btnY1: -0.02
  };

  // Canonical patch sizes. Names keep their aspect (scaled by pitch, so width
  // carries information); digits are height-normalized, which makes them immune
  // to a slightly-off pitch estimate.
  var NAME_SCALE = 60;   // pitch -> 60 canonical px
  var NAME_W = 132, NAME_H = 27;
  var DIGIT_H = 20, DIGIT_W = 18;

  var EFFECT_NAMES = [
    "Attack Power", "Additional Damage", "Boss Damage",
    "Brand Power", "Ally Damage Enh.", "Ally Attack Enh."
  ];

  // ------------------------------------------------------------------ masks
  // img: { width, height, data } — RGBA, the ImageData shape.
  function buildMasks(img) {
    var W = img.width, H = img.height, d = img.data, n = W * H;
    var gold = new Uint8Array(n), white = new Uint8Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      var s = mx > 0 ? (mx - mn) / mx : 0;
      if (mx > 0.70 && s < 0.30) white[i] = 1;
      if (mx > 0.50 && s > 0.50) {
        var dd = mx - mn, h;
        if (dd <= 0) h = 0;
        else if (mx === r) h = (((g - b) / dd) % 6 + 6) % 6;
        else if (mx === g) h = (b - r) / dd + 2;
        else h = (r - g) / dd + 4;
        h *= 60;
        if (h > 32 && h < 62) gold[i] = 1;
      }
    }
    return { W: W, H: H, gold: gold, white: white, data: d };
  }

  // Per-row prefix sums of a mask, so a window count is two lookups.
  function prefixRows(mask, W, H) {
    var ps = new Int32Array((W + 1) * H);
    for (var y = 0; y < H; y++) {
      var ro = y * W, po = y * (W + 1), acc = 0;
      ps[po] = 0;
      for (var x = 0; x < W; x++) { acc += mask[ro + x]; ps[po + x + 1] = acc; }
    }
    return ps;
  }
  function winCount(ps, W, y, x0, x1) {
    var po = y * (W + 1);
    return ps[po + x1] - ps[po + x0];
  }

  // ------------------------------------------------------------------ anchor
  // Gold row-runs inside the x window [x0,x1), keeping only blob-like ones.
  function runsIn(ps, W, H, x0, x1, minCount, minH) {
    var out = [], st = -1, tot = 0;
    function push(a, b, n) {
      var h = b - a;
      if (h >= minH && h <= minH * 12) out.push({ y: (a + b) / 2, h: h, n: n });
    }
    for (var y = 0; y < H; y++) {
      var c = winCount(ps, W, y, x0, x1);
      if (c >= minCount) { if (st < 0) { st = y; tot = 0; } tot += c; }
      else if (st >= 0) { push(st, y, tot); st = -1; }
    }
    if (st >= 0) push(st, H, tot);
    return out;
  }

  // Largest set of run centres sitting on one arithmetic progression.
  function bestProgression(runs) {
    if (runs.length < 3) return null;
    var best = null;
    for (var i = 0; i < runs.length; i++) {
      for (var j = i + 1; j < runs.length; j++) {
        var p = runs[j].y - runs[i].y;
        if (p < 24 || p > 400) continue;
        var tol = Math.max(2.5, p * 0.10);
        // collect every run that lands on runs[i].y + k*p
        var hits = [], k;
        for (var m = 0; m < runs.length; m++) {
          var off = (runs[m].y - runs[i].y) / p;
          k = Math.round(off);
          if (Math.abs(off - k) * p <= tol) hits.push({ k: k, run: runs[m] });
        }
        // one run per slot (nearest wins)
        var slot = {};
        for (var q = 0; q < hits.length; q++) {
          var kk = hits[q].k, cur = slot[kk];
          var dist = Math.abs(runs[i].y + kk * p - hits[q].run.y);
          if (!cur || dist < cur.d) slot[kk] = { d: dist, run: hits[q].run };
        }
        var keys = Object.keys(slot).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length < 3) continue;
        // must be CONTIGUOUS — the panel never skips a row
        var runLen = 1, bestLen = 1, bestStart = 0;
        for (var t = 1; t < keys.length; t++) {
          if (keys[t] === keys[t - 1] + 1) { runLen++; if (runLen > bestLen) { bestLen = runLen; bestStart = t - runLen + 1; } }
          else runLen = 1;
        }
        if (bestLen < 3) continue;
        var seq = keys.slice(bestStart, bestStart + bestLen).map(function (kx) { return slot[kx].run; });
        var score = bestLen * 1000 + seq.reduce(function (a, r) { return a + r.n; }, 0) / 100;
        if (!best || score > best.score) {
          // refit the pitch by least squares over the kept rows
          var y0 = seq[0].y, y1 = seq[seq.length - 1].y;
          best = { score: score, pitch: (y1 - y0) / (bestLen - 1), rows: seq };
        }
      }
    }
    return best;
  }

  // How many of a candidate's rows actually carry effect text to their right?
  // The screen has other evenly-spaced gold things on it — the right-hand icon
  // bar in particular — and a bare periodicity test happily locks onto them.
  // A gem row is followed by a name in white; an icon bar is followed by
  // nothing. This is the check that tells them apart.
  function textRows(m, psW, prog, cx) {
    var p = prog.pitch, n = 0;
    var x0 = Math.round(cx + GEO.textX0 * p), x1 = Math.round(cx + GEO.textX1 * p);
    if (x0 >= m.W || x1 <= 0) return 0;
    x0 = Math.max(0, x0); x1 = Math.min(m.W, x1);
    if (x1 - x0 < 4) return 0;
    for (var i = 0; i < prog.rows.length; i++) {
      var c = 0, yTop = Math.round(prog.rows[i].y + GEO.textY0 * p), yBot = Math.round(prog.rows[i].y + GEO.textY1 * p);
      for (var y = Math.max(0, yTop); y < Math.min(m.H, yBot); y++) c += winCount(psW, m.W, y, x0, x1);
      if (c > 0.9 * p) n++;   // an effect name lays down far more ink than this
    }
    return n;
  }

  // One full x-sweep at fixed window / thresholds; returns the best progression
  // that survives the text check.
  function sweep(m, ps, psW, win, minCount, minH) {
    var best = null;
    for (var x = 0; x + win <= m.W; x += 3) {
      var runs = runsIn(ps, m.W, m.H, x, x + win, minCount, minH);
      if (runs.length < 3) continue;
      var prog = bestProgression(runs);
      if (!prog) continue;
      if (best && prog.score <= best.score) continue;
      if (textRows(m, psW, prog, x + win / 2) < Math.max(3, Math.ceil(0.6 * prog.rows.length))) continue;
      best = prog; best.x = x; best.win = win;
    }
    return best;
  }

  // How alike are the anchors? Gold pixels in a fixed box around each one,
  // returned as min / median. ~1 for a real panel (nine identical discs), well
  // under 0.5 for the half-pitch alias (discs alternating with hollow icons).
  function uniformity(m, prog) {
    var p = prog.pitch, cx = prog.x + (prog.win || 34) / 2, counts = [];
    var rx = Math.max(3, Math.round(0.17 * p)), ry = Math.max(3, Math.round(0.13 * p));
    for (var i = 0; i < prog.rows.length; i++) {
      var yc = Math.round(prog.rows[i].y), n = 0;
      for (var y = Math.max(0, yc - ry); y < Math.min(m.H, yc + ry); y++)
        for (var x = Math.max(0, cx - rx); x < Math.min(m.W, cx + rx); x++)
          if (m.gold[y * m.W + x]) n++;
      counts.push(n);
    }
    if (!counts.length) return 0;
    var sorted = counts.slice().sort(function (a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)];
    return med > 0 ? sorted[0] / med : 0;
  }

  // Finding the panel is a two-stage job because every threshold that separates
  // the two gold glyphs is a FRACTION of the (unknown) UI scale.
  //
  //   Line 1 carries the willpower icon: a hollow square outline, ~2 gold px per
  //   scanline. Line 2 carries the points disc, whose gold "P" is ~9. A window of
  //   ~0.3 pitch and a floor of ~0.045 pitch per scanline keeps the disc and drops
  //   the outline, so the panel reads as ONE run per row.
  //
  //   Get that floor wrong and the outline's inner diamond survives as a short
  //   run — which turns every row into two and halves the apparent pitch. So:
  //   stage 1 sweeps with loose absolute thresholds just to get a pitch in the
  //   right ballpark, then stage 2 re-sweeps with thresholds derived from it,
  //   testing BOTH that pitch and twice it (the two-lines-per-row alias).
  function findPanel(m) {
    var ps = prefixRows(m.gold, m.W, m.H);
    var psW = prefixRows(m.white, m.W, m.H);
    var coarse = null, floors = [6, 4, 3, 2];
    for (var fi = 0; fi < floors.length; fi++) {
      var c = sweep(m, ps, psW, 34, floors[fi], 3);
      if (c && (!coarse || c.score > coarse.score)) coarse = c;
      if (coarse && coarse.rows.length >= 5) break;
    }
    if (!coarse) return null;

    var cands = [];
    [coarse.pitch, coarse.pitch * 2].forEach(function (hyp) {
      if (hyp < 18 || hyp > 500) return;
      var b = sweep(m, ps, psW,
        Math.max(12, Math.min(44, Math.round(0.32 * hyp))),
        Math.max(2, Math.round(0.045 * hyp)),
        Math.max(3, Math.round(0.11 * hyp)));
      if (b) cands.push(b);
    });
    cands.push(coarse);
    // Reject the alias: every anchor of a REAL panel is the same glyph (the
    // points disc), so their gold densities barely differ. A series that
    // alternates disc / willpower-outline gives itself away as a lean row.
    var clean = cands.filter(function (c) { return uniformity(m, c) >= 0.5; });
    var pool = clean.length ? clean : cands;
    var best = pool[0];
    for (var i = 1; i < pool.length; i++) if (pool[i].score > best.score) best = pool[i];
    var win = Math.max(12, Math.min(44, Math.round(0.32 * best.pitch)));
    // Refine the icon x: centroid of gold inside the matched runs.
    var sx = 0, sn = 0;
    for (var i = 0; i < best.rows.length; i++) {
      var r = best.rows[i];
      for (var y = Math.round(r.y - r.h / 2); y <= Math.round(r.y + r.h / 2); y++) {
        if (y < 0 || y >= m.H) continue;
        for (var xx = Math.max(0, best.x - 12); xx < Math.min(m.W, best.x + win + 12); xx++) {
          if (m.gold[y * m.W + xx]) { sx += xx; sn++; }
        }
      }
    }
    if (!sn) return null;
    return {
      iconCx: sx / sn,
      pitch: best.pitch,
      rowsY: best.rows.map(function (r) { return r.y; })   // line-2 centres
    };
  }

  // -------------------------------------------------------------- patch cuts
  // Box-filter a binary mask region down to (dw x dh) floats in 0..1.
  function resample(mask, W, H, x0, y0, w, h, dw, dh) {
    var out = new Float32Array(dw * dh);
    for (var j = 0; j < dh; j++) {
      var sy0 = y0 + h * j / dh, sy1 = y0 + h * (j + 1) / dh;
      var iy0 = Math.floor(sy0), iy1 = Math.max(iy0 + 1, Math.ceil(sy1));
      for (var i = 0; i < dw; i++) {
        var sx0 = x0 + w * i / dw, sx1 = x0 + w * (i + 1) / dw;
        var ix0 = Math.floor(sx0), ix1 = Math.max(ix0 + 1, Math.ceil(sx1));
        var acc = 0, cnt = 0;
        for (var y = iy0; y < iy1; y++) {
          if (y < 0 || y >= H) { cnt++; continue; }
          for (var x = ix0; x < ix1; x++) {
            cnt++;
            if (x >= 0 && x < W && mask[y * W + x]) acc++;
          }
        }
        out[j * dw + i] = cnt ? acc / cnt : 0;
      }
    }
    return out;
  }

  // Column runs of (maskA | maskB) inside a band, merged when the gap is small.
  function bandRuns(m, useGold, useWhite, x0, x1, y0, y1, mergeGap) {
    var W = m.W, H = m.H, runs = [], st = -1;
    for (var x = x0; x < x1; x++) {
      var hit = 0;
      for (var y = y0; y < y1; y++) {
        if (y < 0 || y >= H || x < 0 || x >= W) continue;
        var i = y * W + x;
        if ((useGold && m.gold[i]) || (useWhite && m.white[i])) { hit = 1; break; }
      }
      if (hit) { if (st < 0) st = x; }
      else if (st >= 0) { runs.push([st, x]); st = -1; }
    }
    if (st >= 0) runs.push([st, x1]);
    var out = [];
    for (var k = 0; k < runs.length; k++) {
      if (out.length && runs[k][0] - out[out.length - 1][1] <= mergeGap) out[out.length - 1][1] = runs[k][1];
      else out.push([runs[k][0], runs[k][1]]);
    }
    return out;
  }

  // Tight bbox of a mask inside a box (or null when empty).
  function bbox(mask, W, H, x0, y0, x1, y1) {
    var mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
    for (var y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (var x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        if (mask[y * W + x]) {
          if (x < mnx) mnx = x; if (x > mxx) mxx = x;
          if (y < mny) mny = y; if (y > mxy) mxy = y;
        }
      }
    }
    if (mxx < 0) return null;
    return { x0: mnx, y0: mny, x1: mxx + 1, y1: mxy + 1 };
  }

  // A digit patch: bbox-crop, scale to DIGIT_H tall keeping aspect, centre it.
  function digitPatch(m, mask, x0, y0, x1, y1) {
    var bb = bbox(mask, m.W, m.H, x0, y0, x1, y1);
    if (!bb) return null;
    var bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
    if (bh < 4 || bw < 2) return null;
    var dw = Math.max(1, Math.min(DIGIT_W, Math.round(bw * DIGIT_H / bh)));
    var small = resample(mask, m.W, m.H, bb.x0, bb.y0, bw, bh, dw, DIGIT_H);
    var out = new Float32Array(DIGIT_W * DIGIT_H);
    var off = Math.floor((DIGIT_W - dw) / 2);
    for (var j = 0; j < DIGIT_H; j++)
      for (var i = 0; i < dw; i++) out[j * DIGIT_W + off + i] = small[j * dw + i];
    return { patch: out, box: bb };
  }

  // Rescue for the willpower / points digit. The global `white` mask wants an
  // unsaturated pixel, and on an EQUIPPED row — whose background is bright
  // orange — a small digit is mostly antialiased edge that has taken on the
  // tint, so the mask can come back empty. Re-threshold inside the digit box
  // alone: keep what is bright RELATIVE TO THAT BOX and still far less
  // saturated than the background it sits on.
  function digitPatchLocal(m, x0, y0, x1, y1) {
    var bw = x1 - x0, bh = y1 - y0;
    if (bw < 3 || bh < 4) return null;
    var lum = [], sat = [], i;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        if (y < 0 || y >= m.H || x < 0 || x >= m.W) { lum.push(0); sat.push(1); continue; }
        var p = (y * m.W + x) * 4;
        var r = m.data[p] / 255, g = m.data[p + 1] / 255, b = m.data[p + 2] / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        lum.push(mx);
        sat.push(mx > 0 ? (mx - mn) / mx : 1);
      }
    }
    var sortedL = lum.slice().sort(function (a, b) { return a - b; });
    var sortedS = sat.slice().sort(function (a, b) { return a - b; });
    var hi = sortedL[Math.floor(sortedL.length * 0.95)];
    var lo = sortedL[Math.floor(sortedL.length * 0.40)];
    if (hi - lo < 0.12) return null;                    // nothing stands out — no digit here
    var lumCut = (hi + lo) / 2;
    var satCut = Math.min(0.55, sortedS[Math.floor(sortedS.length * 0.25)] + 0.18);
    var mask = new Uint8Array(bw * bh), on = 0;
    for (i = 0; i < mask.length; i++) {
      if (lum[i] >= lumCut && sat[i] <= satCut) { mask[i] = 1; on++; }
    }
    if (on < 4) return null;
    var bb = bbox(mask, bw, bh, 0, 0, bw, bh);
    if (!bb) return null;
    var w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
    if (h < 4 || w < 2 || h > bh - 1) return null;      // full-height blob = background, not a glyph
    var dw = Math.max(1, Math.min(DIGIT_W, Math.round(w * DIGIT_H / h)));
    var small = resample(mask, bw, bh, bb.x0, bb.y0, w, h, dw, DIGIT_H);
    var out = new Float32Array(DIGIT_W * DIGIT_H);
    var off = Math.floor((DIGIT_W - dw) / 2);
    for (var j = 0; j < DIGIT_H; j++)
      for (i = 0; i < dw; i++) out[j * DIGIT_W + off + i] = small[j * dw + i];
    return { patch: out };
  }

  // A name patch: pitch-scaled (so width matters), left-aligned on the first
  // white column, vertically fixed to the line band.
  function namePatch(m, pitch, nx0, ty0, nx1, ty1) {
    var k = NAME_SCALE / pitch;
    var w = nx1 - nx0, h = ty1 - ty0;
    var dw = Math.max(1, Math.min(NAME_W, Math.round(w * k)));
    var small = resample(m.white, m.W, m.H, nx0, ty0, w, h, dw, NAME_H);
    var out = new Float32Array(NAME_W * NAME_H);
    for (var j = 0; j < NAME_H; j++)
      for (var i = 0; i < dw; i++) out[j * NAME_W + i] = small[j * dw + i];
    return out;
  }

  // ------------------------------------------------------------- correlation
  function ncc(a, b) {
    var n = a.length, sa = 0, sb = 0;
    for (var i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    var ma = sa / n, mb = sb / n, num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) {
      var u = a[i] - ma, v = b[i] - mb;
      num += u * v; da += u * u; db += v * v;
    }
    if (da <= 0 || db <= 0) return 0;
    return num / Math.sqrt(da * db);
  }
  // Best template, with the margin to the runner-up.
  function classify(patch, templates) {
    var bestK = null, best = -2, second = -2;
    for (var k in templates) {
      if (!Object.prototype.hasOwnProperty.call(templates, k)) continue;
      var s = ncc(patch, templates[k]);
      if (s > best) { second = best; best = s; bestK = k; }
      else if (s > second) second = s;
    }
    return { value: bestK, score: best, margin: best - Math.max(second, -1) };
  }

  // ------------------------------------------------------------------ colour
  // Order gems are pink, chaos gems are blue — vote on the gem picture's hue.
  // Gold (hue 25-70) is the row's own background and is deliberately not counted;
  // measured on the corpus a chaos sphere polls ~93% blue, an order one ~95% pink.
  function gemTypeAt(m, px, py, pitch) {
    var x0 = Math.round(px + GEO.iconX0 * pitch), x1 = Math.round(px + GEO.iconX1 * pitch);
    var y0 = Math.round(py + GEO.iconY0 * pitch), y1 = Math.round(py + GEO.iconY1 * pitch);
    var pink = 0, blue = 0;
    for (var y = Math.max(0, y0); y < Math.min(m.H, y1); y += 2) {
      for (var x = Math.max(0, x0); x < Math.min(m.W, x1); x += 2) {
        var p = (y * m.W + x) * 4;
        var r = m.data[p] / 255, g = m.data[p + 1] / 255, b = m.data[p + 2] / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 0.25) continue;
        var s = (mx - mn) / mx;
        if (s < 0.25) continue;
        var dd = mx - mn, h;
        if (mx === r) h = (((g - b) / dd) % 6 + 6) % 6;
        else if (mx === g) h = (b - r) / dd + 2;
        else h = (r - g) / dd + 4;
        h *= 60;
        if (h >= 300 || h < 25) pink++;
        else if (h >= 170 && h < 265) blue++;
      }
    }
    if (pink + blue < 40) return { type: null, conf: 0 };
    var f = pink / (pink + blue);
    if (f > 0.70) return { type: "order", conf: f };
    if (f < 0.30) return { type: "chaos", conf: 1 - f };
    return { type: null, conf: 0.5 };
  }

  // The "Unequip" button: a flat, pale, unsaturated slab right of the text.
  function equippedAt(m, px, py, pitch) {
    var x0 = Math.round(px + GEO.btnX0 * pitch), x1 = Math.round(px + GEO.btnX1 * pitch);
    var y0 = Math.round(py + GEO.btnY0 * pitch), y1 = Math.round(py + GEO.btnY1 * pitch);
    if (x1 > m.W || y0 < 0 || y1 > m.H) return null;   // cropped away — say nothing
    var hit = 0, tot = 0;
    for (var y = y0; y < y1; y += 2) {
      for (var x = x0; x < x1; x += 2) {
        var p = (y * m.W + x) * 4;
        var r = m.data[p] / 255, g = m.data[p + 1] / 255, b = m.data[p + 2] / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var s = mx > 0 ? (mx - mn) / mx : 0;
        tot++;
        // The button's slate fill measures ~rgb(63,77,90); the empty panel behind
        // an unequipped row is near-black, so the two never come close.
        if (mx > 0.30 && mx < 0.85 && s < 0.30) hit++;
      }
    }
    return tot > 0 && hit / tot > 0.20;
  }

  // ------------------------------------------------------------------- rows
  // Cut every field of one line and return the raw patches (no matching yet),
  // so the refs builder and the reader share exactly one geometry path.
  function cutLine(m, panel, rowY, line) {
    var p = panel.pitch, cx = panel.iconCx;
    var ly = line === 1 ? rowY - GEO.lineDy * p : rowY;
    var dx0 = Math.round(cx + GEO.digitX0 * p), dx1 = Math.round(cx + GEO.digitX1 * p);
    var dy0 = Math.round(ly + GEO.digitY0 * p), dy1 = Math.round(ly + GEO.digitY1 * p);
    var dp = digitPatch(m, m.white, dx0, dy0, dx1, dy1) || digitPatchLocal(m, dx0, dy0, dx1, dy1);
    var digit = dp;

    var tx0 = Math.round(cx + GEO.textX0 * p), tx1 = Math.round(cx + GEO.textX1 * p);
    var ty0 = Math.round(ly + GEO.textY0 * p), ty1 = Math.round(ly + GEO.textY1 * p);

    // The level is gold ("Lv." then the digit); the name is every white column
    // to its left. Split "Lv." from its digit at the WIDEST gap in the gold run
    // — the space before the number. A fixed gap threshold works at 4K and
    // fails at 1080p, where "Lv." and the digit merge into one blob.
    var goldRuns = bandRuns(m, true, false, tx0, tx1, ty0, ty1, Math.max(1, Math.round(0.02 * p)));
    var lvlPatch = null, gStart = tx1;
    if (goldRuns.length) {
      gStart = goldRuns[0][0];
      var cut = -1, widest = 0;
      for (var gi = 1; gi < goldRuns.length; gi++) {
        var gap = goldRuns[gi][0] - goldRuns[gi - 1][1];
        if (gap >= widest) { widest = gap; cut = gi; }
      }
      if (cut > 0 && widest >= 0.035 * p) {
        var a = goldRuns[cut][0], b = goldRuns[goldRuns.length - 1][1];
        if (b - a <= 0.30 * p) lvlPatch = digitPatch(m, m.gold, a - 2, ty0, b + 2, ty1);
      }
    }
    var whiteGroups = bandRuns(m, false, true, tx0, Math.max(tx0 + 1, gStart - 2), ty0, ty1, Math.round(0.16 * p));
    var name = null;
    if (whiteGroups.length) {
      var nx0 = whiteGroups[0][0], nx1 = whiteGroups[whiteGroups.length - 1][1];
      if (nx1 - nx0 > 0.4 * p) name = namePatch(m, p, nx0, ty0, nx1, ty1);
    }
    return {
      digit: digit ? digit.patch : null,
      level: lvlPatch ? lvlPatch.patch : null,
      name: name,
      ly: ly
    };
  }

  // The templates come in bands, one per capture size (see gemlist-refs.js);
  // pick the band whose harvest pitch is closest to this screenshot's, in log
  // space so 70-vs-105 and 105-vs-158 count as the same distance.
  function pickBand(refs, pitch) {
    if (!refs.bands || !refs.bands.length) return refs;   // single-band refs
    var best = refs.bands[0], bd = Infinity;
    for (var i = 0; i < refs.bands.length; i++) {
      var d = Math.abs(Math.log(pitch / refs.bands[i].pitch));
      if (d < bd) { bd = d; best = refs.bands[i]; }
    }
    return best;
  }

  // Row pitch is the reader's resolution yardstick. Measured on the corpus by
  // downscaling the 4K captures and scoring every field against the labels:
  //
  //   pitch 105  100% of fields, no wrong digit anywhere
  //   pitch  79   99%, worst wrong-digit margin 0.07 (well under the flag bar)
  //   pitch  70   98%, one wrong digit sneaks to margin 0.13
  //   pitch  58   84%, wrong digits reach margin 0.17 — indistinguishable
  //   pitch  35   31% — noise
  //
  // So the reader refuses below 62 rather than guess, and calls anything under
  // 90 "small" so the UI can tell the user to look twice.
  var MIN_PITCH = 62;
  var COMFY_PITCH = 90;

  // Flag bars, also read off that sweep. Names separate cleanly (every wrong
  // name in the whole sweep scored a margin under 0.035, while 99% of right
  // ones cleared 0.052), digits far less so — which is why the cost also gets
  // the structural cross-check below.
  var NAME_MIN_SCORE = 0.35, NAME_MIN_MARGIN = 0.045;
  var DIGIT_MIN_SCORE = 0.45, DIGIT_MIN_MARGIN = 0.10;

  // -------------------------------------------------------------- public API
  // parse(img, opts) -> { ok, panel, rows: [...], error }
  //   opts.refs   overrides the global ocr/gemlist-refs.js tables (the eval
  //               harness uses this to test a held-out fold).
  //   opts.pools  model/astrogem.js EFFECT_POOLS. PASS IT — it turns on the
  //               cost/effect-pair cross-check that catches misread digits the
  //               match margin alone lets through. Deliberately injected rather
  //               than copied in here, so the game's pools live in exactly one
  //               place and can't drift.
  function parse(img, opts) {
    opts = opts || {};
    var refs = opts.refs || root.GemListRefs || (typeof module !== "undefined" && module.exports && module.exports._refs);
    var pools = opts.pools || (root.Astrogem && root.Astrogem.EFFECT_POOLS) || null;
    var m = buildMasks(img);
    var panel = findPanel(m);
    if (!panel) return { ok: false, error: "Couldn't find the astrogem list on this screenshot. Capture the Ark Grid screen with the Astrogem tab open, so the list of gems on the right is visible." };
    if (!refs) return { ok: false, error: "gemlist-refs.js is missing.", panel: panel };
    if (panel.pitch < MIN_PITCH) {
      return { ok: false, panel: panel, error: "This screenshot is too small to read — the gem rows are only " +
        Math.round(panel.pitch) + " pixels apart, and the numbers blur into each other below about " + MIN_PITCH +
        ". Use the original capture rather than a resized or re-uploaded copy." };
    }
    var band = pickBand(refs, panel.pitch);
    var out = [], warned = 0;
    for (var i = 0; i < panel.rowsY.length; i++) {
      var rowY = panel.rowsY[i];
      var L1 = cutLine(m, panel, rowY, 1), L2 = cutLine(m, panel, rowY, 2);
      var flags = [];
      function num(patch, what, lo, hi) {
        if (!patch) { flags.push(what); return { v: null, margin: 0 }; }
        var c = classify(patch, band.digits);
        var v = parseInt(c.value, 10);
        if (!(v >= lo && v <= hi) || c.score < DIGIT_MIN_SCORE || c.margin < DIGIT_MIN_MARGIN) flags.push(what);
        return { v: (v >= lo && v <= hi) ? v : null, margin: c.margin, score: c.score };
      }
      function nm(patch, what) {
        if (!patch) { flags.push(what); return { v: null, margin: 0 }; }
        var c = classify(patch, band.names);
        if (c.score < NAME_MIN_SCORE || c.margin < NAME_MIN_MARGIN) flags.push(what);
        return { v: c.value, margin: c.margin, score: c.score };
      }
      var cost = num(L1.digit, "cost", 1, 9);
      var pts = num(L2.digit, "pts", 1, 5);
      var e1 = nm(L1.name, "e1"), l1 = num(L1.level, "l1", 1, 5);
      var e2 = nm(L2.name, "e2"), l2 = num(L2.level, "l2", 1, 5);
      var gt = gemTypeAt(m, panel.iconCx, rowY, panel.pitch);
      if (!gt.type) flags.push("type");
      if (e1.v && e2.v && e1.v === e2.v) { flags.push("e1"); flags.push("e2"); }
      // Structural cross-check on the willpower cost. The effect PAIR fixes which
      // base cost pool(s) the gem can be from, and a base cost only ever yields
      // willpower costs base-5 .. base-1. A cost outside that is a misread the
      // margin alone did not catch — the digits are the reader's weakest field.
      // Only trusted when BOTH names came through unflagged: an upstream mistake
      // must not be allowed to condemn a correct digit.
      if (pools && cost.v != null && e1.v && e2.v &&
          flags.indexOf("e1") < 0 && flags.indexOf("e2") < 0) {
        var lo = 99, hi = 0, anyPool = false;
        [8, 9, 10].forEach(function (bc) {
          var pool = pools[bc];
          if (!pool || pool.indexOf(e1.v) < 0 || pool.indexOf(e2.v) < 0) return;
          anyPool = true;
          if (bc - 5 < lo) lo = bc - 5;
          if (bc - 1 > hi) hi = bc - 1;
        });
        if (anyPool && (cost.v < lo || cost.v > hi) && flags.indexOf("cost") < 0) flags.push("cost");
      }
      if (flags.length) warned++;
      out.push({
        index: i,
        cost: cost.v, points: pts.v,
        effect1: e1.v, effect1Level: l1.v,
        effect2: e2.v, effect2Level: l2.v,
        gemType: gt.type,
        equipped: equippedAt(m, panel.iconCx, rowY, panel.pitch),
        flags: flags,
        conf: { cost: cost.margin, pts: pts.margin, e1: e1.margin, l1: l1.margin, e2: e2.margin, l2: l2.margin }
      });
    }
    // If most of what came back is doubtful, the anchor almost certainly latched
    // onto something that only LOOKS like the gem list (the game screen has other
    // evenly-spaced gold columns). Handing back nine rows of guesses would be
    // worse than admitting it: say so and let the user try another capture.
    var doubtful = 0;
    for (var d = 0; d < out.length; d++) doubtful += out[d].flags.length;
    if (out.length && doubtful > 0.6 * out.length * 6) {
      return { ok: false, panel: panel, error: "Found something list-shaped on this screenshot but couldn't read it — almost every field came back doubtful. Capture the Ark Grid screen full-size with the Astrogem tab open, and don't resize the image afterwards." };
    }
    return {
      ok: true, panel: panel, rows: out, flagged: warned, band: band.pitch,
      small: panel.pitch < COMFY_PITCH ? Math.round(panel.pitch) : 0
    };
  }

  var API = {
    parse: parse,
    EFFECT_NAMES: EFFECT_NAMES,
    GEO: GEO,
    NAME_W: NAME_W, NAME_H: NAME_H, NAME_SCALE: NAME_SCALE,
    DIGIT_W: DIGIT_W, DIGIT_H: DIGIT_H,
    // internals — the refs builder and the eval harness reuse these so there is
    // exactly one copy of the geometry.
    _buildMasks: buildMasks, _findPanel: findPanel, _cutLine: cutLine, _classify: classify, _ncc: ncc
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.GemListEngine = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
