/**
 * app.js — the Calculator tab.
 *
 * Layout (astrogem-grader house style: the control deck, then results):
 *   DECK       the character + bracelet controls. NOT built here any more —
 *              profile.js owns them, and this file mounts them (see below).
 *   PROFILE    the imported character's header: ★, class icon, name, cache pill
 *              and chips. Hidden until a character is imported.
 *   BRACELET   one row per granted slot — family picker (grouped and priced),
 *              tier, and a value box for the basic-stat families. All rows empty
 *              means an unrolled bracelet, which is the default.
 *   RESULTS    the headline cards and the per-line breakdown. WHAT TO DO about
 *              the bracelet — the lock advice, the spread, the keep-or-replace
 *              cut — is the Advisor tab's, and so is the code that draws it.
 *
 * THE STATE IS NOT HERE (since 2026-08-11). window.Profile owns it, persists it
 * and renders the control deck; this file holds the LIVE state object it returns,
 * mounts the deck into the Calculator pane, and re-solves whenever Profile says
 * something moved. The Tier List mounts the same deck, which is the whole point of
 * the split: one slider, every tab.
 *
 * THE MATH IS NOT HERE either. Every number comes from window.Bracelet
 * (model/bracelet.js), which this file only ever reads:
 *   Bracelet.solve({grade, profile, fixedLines, grantedLines, slots, rollsLeft, …})
 *   Bracelet.lineDamage / lineInfo / damagePercent / deriveBaseline / attackPower
 *
 * WHY A WORKER. A three-slot, seven-roll solve is ~48,000 states and ~3 s. Run
 * on the main thread it freezes the page on every keystroke, so solve() lives in
 * solver-worker.js: one request in flight, later requests queued and collapsed,
 * stale answers dropped by id, results cached by a canonical state key. Input
 * changes are debounced ~300 ms. That worker is SHARED — the Advisor rides this
 * file's solver through window.BraceletApp, because advise() answers off the one
 * DP context the worker is holding. Gold never enters the key: worth is a sum
 * over the distribution the solve returns, recomputed here for free.
 *
 * THE COMPARISON FOUNDATION, for the tabs that hold one bracelet against
 * another (window.BraceletApp):
 *   baseline  the bracelet you already wear. profile.js stores the snapshot and
 *             keeps econ.baseline on it; this file copies the Grader's bracelet
 *             in, sets a character's worn bracelet the moment it is imported,
 *             and grades it on the same ladder as the Current score card.
 *   compare   one read of a solved cdf against a baseline score: the odds of
 *             finishing at or above it, and where the finishes land either side.
 *   strip     the p10-p90 outcome strip, with the baseline and the bracelet as
 *             it stands marked on it — one renderer for every tab.
 *   solver    solve() prices ANY bracelet through the same worker, in its own
 *             queue lane, so a sweep of them cannot evict the Advisor's context
 *             or cancel the Calculator's solve.
 * The Calculator itself only grades what is loaded; the one trace of the
 * comparison on it is the Economy's baseline row.
 *
 * EVERY WAY IN IS HERE. A bracelet reaches the Grader three ways, and all three
 * live on this tab since the Advisor stopped loading bracelets: the import panel
 * (bible-import.js), the character search beside it (char-picker.js), and the
 * screenshot reader under them (advisor-capture.js, joined by advisor-glue.js
 * through window.BraceletAdvisor — see "the screenshot reader").
 */
(function () {
  "use strict";

  var B = window.Bracelet, DATA = window.BraceletData, P = window.Profile;
  if (!B || !DATA || !P) return;                 // model or spine failed to load; leave the shell alone

  var S = P.get();                               // the LIVE state object — never re-assigned
  var TIERS = DATA.TIERS;                        // ["low","mid","high"]
  var PARTY_IDS = { 16: 1, 17: 1, 18: 1, 19: 1 };
  var DEBOUNCE_MS = 300;

  // ------------------------------------------------------------------
  // small helpers
  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function fx(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }
  function gold(g) {
    var a = Math.abs(g);
    if (a >= 1e6) return (g / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return Math.round(g / 1e3) + "k";
    return String(Math.round(g));
  }
  // D (log-space score) -> the exact combined damage percentage.
  function pct(D) { return B.damagePercent(D); }

  // ------------------------------------------------------------------
  // THE TWO FORMATTERS. One rule per kind of number, on every tab.
  //
  // Damage percentages read to two decimals and odds to one — in every card,
  // chip, sentence and table cell either file draws. They used to be formatted
  // at the call site, so the same figure came out "17%" in a card and "17.4%"
  // in the table under it, and one odds column mixed 17.4 / 12.5 / 9.60 while
  // the expected-final column ran to three decimals (Shizu, 2026-08-15).
  // advisor.js reaches these through BraceletApp.fmt, so there is one copy.
  // ------------------------------------------------------------------

  /** A damage percentage. Always two decimals. */
  function fmtDmg(v) { return fx(num(v, 0), 2) + "%"; }
  /** The same, signed — for a difference between two of them. */
  function signPct(d) { return (d >= 0 ? "+" : "") + fmtDmg(d); }
  /**
   * Odds, from a probability in 0..1. Always one decimal, with a floor and a
   * cap so a real chance never prints as "0%" and a real doubt never prints as
   * "100%". Exactly zero and exactly one keep their own words: those are
   * certainties, not roundings, and "under 0.1%" for something that cannot
   * happen would be the same lie in the other direction.
   */
  function fmtOdds(p) {
    var v = clamp(num(p, 0), 0, 1) * 100;
    if (v <= 0) return "0%";
    if (v < 0.1) return "under 0.1%";
    if (v >= 100) return "100%";
    if (v > 99.9) return "over 99.9%";
    return fx(v, 1) + "%";
  }

  // ------------------------------------------------------------------
  // ONE TIER VOCABULARY: Heroic / Epic / Legendary.
  //
  // low / mid / high are the internal keys and stay that way — they are in the
  // state, the official tables and the solver's atom keys. These three words are
  // the only ones the user ever sees for them. "Rare" sat here for low until
  // 2026-08-15 and was simply wrong: the picker offered "Rare · +6.8%" for a
  // rarity the game calls Heroic, beside a "Legendary · +9,000" that was right.
  // advisor.js prints the same three words through BraceletApp.tierWord.
  // ------------------------------------------------------------------
  var TIER_WORD = { low: "Heroic", mid: "Epic", high: "Legendary" };
  function tierWord(t) { return TIER_WORD[t] || String(t); }

  // Gold always converts the EXACT damage percentage, never the log-space score,
  // so the arithmetic on screen matches the percentages printed beside it.
  function gpd() { return num(S.econ.gpd, 0); }

  /**
   * WHAT A BRACELET IS WORTH, in gold. The model's own definition, applied to the
   * distribution the solver just returned:
   *
   *     E[ max(0, final% - baseline%) ] x gold per 1%
   *
   * You are paid only by the outcomes that BEAT the bracelet you would wear
   * instead, weighted by how often they happen and by how far they clear it. So
   * the figure is never negative: a bracelet you would not equip is worth
   * nothing, not a debt.
   *
   * It used to be (expectedFinal - baseline) x gold — a difference of means,
   * which goes negative the moment the baseline outruns the bracelet, and which
   * compared a LOG-SPACE score against a damage percentage, mixing units on top
   * (Shizu, 2026-08-11). Both halves of that are gone.
   *
   * Why the arithmetic is here and not read off res.valueGold: the solve is run
   * with goldPer1Pct 0 and baselinePct 0 on purpose (see solveState), because
   * keeping gold out of the cache key is what lets the gold slider drag without
   * a three-second re-solve. The worker's own valueGold is therefore always 0.
   * The distribution is the expensive part; this is the cheap sum over it.
   *
   * The cdf arrives THINNED to ~400 rungs, so each rung stands for the whole
   * interval below it — take that interval's MIDPOINT rather than its top end,
   * or the answer prices several percent high.
   *
   * `shiftD` moves every outcome by a constant log-space offset: how the
   * unrolled card reprices one solved distribution at a different combat-trait
   * total.
   *
   * ONE IMPLEMENTATION, and this is it (Shizu, 2026-08-15). The Advisor used to
   * carry a second reading of the same formula for its per-lock rows — same
   * intent, different treatment of the interval the bar lands inside — and the
   * two disagreed on screen: 868k in the card over 876k in the row beneath it,
   * 17% against 17.4%. The per-mask rows now call this through
   * BraceletApp.worth.fromCdf with their own cdf, so a disagreement is not
   * something the code can express any more.
   *
   * Returns, for the distribution and the bar it is given:
   *   gold  E[max(0, final% - bar)] x gold per 1%
   *   p     P(final% > bar)
   *   mean  E[final% | final% > bar] — where it lands in the runs that clear it
   * or null when there is no distribution to read.
   */
  function worthFromCdf(cdf, baselinePct, shiftD) {
    if (!cdf || !cdf.length) return null;
    var base = num(baselinePct, 0), off = num(shiftD, 0);
    var acc = 0, p = 0, prev = 0, prevS = null, i, m, s, over;
    for (i = 0; i < cdf.length; i++) {
      m = cdf[i].cum - prev;
      prev = cdf[i].cum;
      s = prevS === null ? cdf[i].score : (prevS + cdf[i].score) / 2;
      if (m <= 0) { prevS = cdf[i].score; continue; }
      over = pct(s + off) - base;
      if (over > 0) {
        acc += m * over; p += m;
      } else if (prevS !== null && pct(cdf[i].score + off) > base) {
        // THE STRADDLING RUNG. A thinned rung can carry most of the mass across
        // an interval the baseline lands inside — one live bracelet had 75% of
        // everything in a 0.097-point rung — and taking the interval whole or
        // not at all made a one-hundredth nudge of the baseline swing the odds
        // by seventy-five points. Split it instead: mass is uniform across the
        // interval, so the share above the bar is the share of the interval
        // above the bar, and it lands at the midpoint of the cleared part.
        var lo = pct(prevS + off), hi = pct(cdf[i].score + off);
        var share = (hi - base) / (hi - lo);
        if (share > 0 && share < 1) {
          var mid = (base + hi) / 2 - base;
          acc += m * share * mid; p += m * share;
        }
      }
      prevS = cdf[i].score;
    }
    // acc is the EXCESS over the bar, weighted by mass, so the conditional mean
    // is the bar plus the average excess of the runs that clear it.
    return { gold: acc * gpd(), p: p, mean: p > 0 ? base + acc / p : 0 };
  }

  /**
   * The same worth for a whole solve: its final-score distribution, against the
   * baseline the user has set. A thin wrapper, deliberately — every other caller
   * (the per-lock rows) hands in its own cdf and its own bar.
   */
  function worthOf(res, shift) {
    if (!res || !res.finalScore) return null;
    return worthFromCdf(res.finalScore.cdf, num(S.econ.baseline, 0), shift);
  }

  /**
   * The odds half of a worth figure, as a FIGURE — the second number of the
   * pair, not a sentence about it (docs/design/copy-rules.md, rules 1 and 5).
   * The baseline it is measured against is on the control that sets it and in
   * the gloss beside this figure, so the figure does not repeat it.
   *
   * SILENT AT A ZERO BASELINE. That is the shipped default, so every first-time
   * visitor was told that "very nearly all of the outcomes clear your 0.00%
   * baseline" — a proportion of a comparison against nothing.
   *
   * The "worth nothing" case keeps its sentence: a gold figure of zero with no
   * explanation is the one state the cards cannot say for themselves (rule 4).
   */
  function worthNote(w) {
    if (!w || num(S.econ.baseline, 0) <= 0) return "";
    if (w.p <= 0) return "Nothing it can roll beats your " + fmtDmg(num(S.econ.baseline, 0)) + " baseline.";
    return fmtOdds(w.p) + " of outcomes";
  }
  /** The meaning, in the tooltip where meaning belongs. */
  function worthGloss(w) {
    if (!w) return "What this bracelet is worth over the one you would wear instead. It needs a solve first.";
    return "What this bracelet is worth over the one you would wear instead: how far the outcomes that beat your " +
      fmtDmg(num(S.econ.baseline, 0)) + " baseline clear it, averaged over how often they land, at " +
      gold(gpd()) + " gold per 1%. Never negative — a bracelet you would not equip is worth nothing, not a debt.";
  }

  // ------------------------------------------------------------------
  // HOLDING ONE BRACELET AGAINST ANOTHER — BraceletApp.compare
  //
  // A solve returns where the bracelet finishes as a cdf of log-space scores.
  // Held against a baseline score, that one curve answers the whole
  // comparison: how often the finish is at least as good, and where it lands
  // on either side. Every figure comes back in DAMAGE PERCENT, converted from
  // the scores as it is read, so it can sit beside the percentages the rest of
  // the tool prints.
  // ------------------------------------------------------------------

  // The worker hands the distribution over THINNED to 160 rungs (the model's
  // distToCdf). A distribution with no more outcomes than that arrives whole,
  // and the thinner never returns fewer than 160 once it has merged anything —
  // so a cdf SHORTER than 160 is exact: every rung is one outcome.
  var THIN_RUNGS = 160;
  // Two scores this close are one score: the model's own tolerance (pImprove).
  var TIE_D = 1e-9;

  // Every solve that passes through this file leaves its exact quantiles here,
  // keyed by its cdf, so a caller that hands compare.fromCdf just
  // res.finalScore.cdf still gets them (see cdfCurve). Weak, so a dropped solve
  // takes its entry with it.
  var CDF_QUANTS = typeof WeakMap === "function" ? new WeakMap() : null;
  function noteQuantiles(res) {
    var f = res && res.finalScore;
    if (CDF_QUANTS && f && f.cdf && f.quantiles) CDF_QUANTS.set(f.cdf, f.quantiles);
  }

  /**
   * A thinned cdf as a CURVE: F(x), P(final <= x), through every point the
   * thinning kept exact, bent the way the mass actually lies between them.
   *
   * WHAT THE THINNER KEEPS. Each kept rung is a real outcome, and its `cum` is
   * exact: F at that score is known. Between two kept rungs, every outcome
   * merged into the upper one is somewhere in the gap — and in a heavy rung
   * near the bottom of the curve, 25 to 40% of all the mass over a gap a point
   * wide, most of it bunched toward the top. Taken as spread evenly across the
   * gap, a bar landing in such a rung read 88% where the truth was 97%.
   *
   * TWO THINGS NARROW IT. The solve's own QUANTILES (p10 … p90) are exact
   * outcomes read off the whole distribution, and they tend to fall inside
   * exactly those heavy rungs — so each becomes one more known point of F
   * (at the largest level that lands on that score: F there is at least that).
   * And a MONOTONE CUBIC (Fritsch–Carlson) through all the known points lets
   * the steepness on either side of a gap shape the curve inside it, instead
   * of drawing each gap as a straight line. On 1,320 random bars over 33
   * solved bracelets, against the whole distribution: even spreading missed
   * P(final >= bar) by 0.77 points on average and 24 at worst; this, by 0.31
   * and 6.4. The worst misses left are bars in the very lowest rungs, where
   * no quantile falls.
   *
   * The first rung is one outcome: the thinner keeps the lowest score as it
   * is. Returns {xs, ys, h, m0, m1, p0} — knots, F at each, the gaps, each
   * gap's slope at its two ends, and the mass on the first outcome — or null
   * for a cdf that arrived whole.
   */
  function cdfCurve(cdf, quant, off) {
    if (!cdf || cdf.length < THIN_RUNGS) return null;
    var xs = [], ys = [], kept = [], anchored = false, i, j, k, q, lv, s, n;
    for (i = 0; i < cdf.length; i++) { xs.push(cdf[i].score + off); ys.push(cdf[i].cum); kept.push(1); }
    if (quant) {
      // Ascending, so a later level landing on the same score as an anchor just
      // made raises it: F at that score is at least the largest level there.
      q = [[quant.p10, 0.10], [quant.p25, 0.25], [quant.p50, 0.50], [quant.p75, 0.75], [quant.p90, 0.90]];
      for (k = 0; k < q.length; k++) {
        s = num(q[k][0], NaN) + off; lv = q[k][1];
        if (!isFinite(s)) continue;
        for (j = 0; j < xs.length && xs[j] < s - TIE_D; j++) {}
        if (j === 0 || j >= xs.length) continue;
        if (Math.abs(xs[j] - s) <= TIE_D) {
          if (!kept[j] && ys[j] < lv) ys[j] = Math.min(lv, ys[j + 1]);
          continue;                            // a kept rung's F is exact already
        }
        xs.splice(j, 0, s);
        ys.splice(j, 0, clamp(lv, ys[j - 1], ys[j]));
        kept.splice(j, 0, 0);
        anchored = true;
      }
    }
    n = xs.length;
    var h = [], d = [], ms = new Array(n), m0 = [], m1 = [];
    for (i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
    if (!anchored) {
      // No quantile landed inside a gap: straight segments. The cubic earns its
      // keep only with the anchors — without them it read worse than a straight
      // line on the same 1,320 bars (0.88 points against 0.77).
      for (i = 0; i < n - 1; i++) { m0.push(d[i]); m1.push(d[i]); }
      return { xs: xs, ys: ys, m0: m0, m1: m1, h: h, p0: cdf[0].cum };
    }
    for (i = 1; i < n - 1; i++) {
      if (!(d[i - 1] > 0) || !(d[i] > 0)) { ms[i] = 0; continue; }
      var w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      ms[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
    ms[0] = curveEnd(h[0], h[1], d[0], d[1]);
    ms[n - 1] = curveEnd(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
    for (i = 0; i < n - 1; i++) { m0.push(ms[i]); m1.push(ms[i + 1]); }
    return { xs: xs, ys: ys, m0: m0, m1: m1, h: h, p0: cdf[0].cum };
  }
  /** Fritsch–Carlson's end slope: three-point, held to the curve's own direction. */
  function curveEnd(h0, h1, d0, d1) {
    if (h1 === undefined || d1 === undefined) return d0;
    var s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (!(s * d0 > 0)) return 0;
    if (d0 * d1 <= 0 && Math.abs(s) > Math.abs(3 * d0)) return 3 * d0;
    return s;
  }
  /** On segment k at fraction t: F there, and the integral of F from the segment's start. */
  function curveAt(c, k, t) {
    var h = c.h[k], y0 = c.ys[k], y1 = c.ys[k + 1], m0 = c.m0[k] * h, m1 = c.m1[k] * h;
    var t2 = t * t, t3 = t2 * t, t4 = t3 * t;
    return {
      F: (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1,
      I: h * ((t4 / 2 - t3 + t) * y0 + (t4 / 4 - 2 * t3 / 3 + t2 / 2) * m0 + (-t4 / 2 + t3) * y1 + (t4 / 4 - t3 / 3) * m1)
    };
  }

  /**
   * One pass over a cdf, split at a bar given as a score (D). Returns the mass
   * at or above the bar and the mass below it, each with its mass-weighted sum
   * of final damage %: {pUp, sUp, pDn, sDn, bar}, bar in %. Null with no cdf.
   *
   * A cdf that arrived whole is read exactly, outcome by outcome. A thinned one
   * is read off its curve (cdfCurve): the mass of a stretch is the rise of F
   * across it, and it lands at the stretch's own mean, from the integral of F —
   * never at a rung's top, never at the middle of a gap.
   *
   * AT OR ABOVE, never strictly above. Finishing level with the bar counts as
   * beating it, which is what makes a bracelet held against itself read 100%:
   * you can always keep what you hold. The first rung is exact either way, and
   * that is where a bracelet's own score sits — no roll ends below it.
   *
   * `shiftD` moves every outcome by a constant, as it does in worthFromCdf.
   */
  function cdfSplit(cdf, barD, shiftD, quant) {
    if (!cdf || !cdf.length) return null;
    var off = num(shiftD, 0), bD = num(barD, 0), bar = pct(bD);
    var pUp = 0, sUp = 0, pDn = 0, sDn = 0, i, m, prev = 0;
    var c = cdfCurve(cdf, quant, off);
    if (!c) {
      for (i = 0; i < cdf.length; i++) {
        m = cdf[i].cum - prev;
        prev = cdf[i].cum;
        if (!(m > 0)) continue;
        if (cdf[i].score + off >= bD - TIE_D) { pUp += m; sUp += m * pct(cdf[i].score + off); }
        else { pDn += m; sDn += m * pct(cdf[i].score + off); }
      }
      return { pUp: pUp, sUp: sUp, pDn: pDn, sDn: sDn, bar: bar };
    }
    // The first outcome, exact.
    if (c.xs[0] >= bD - TIE_D) { pUp += c.p0; sUp += c.p0 * pct(c.xs[0]); }
    else { pDn += c.p0; sDn += c.p0 * pct(c.xs[0]); }
    // Every stretch of the curve after it: whole, or cut at the bar.
    function add(up, a, fa, ia, b, fb, ib) {
      var mm = fb - fa;
      if (!(mm > 0)) return;
      // E[x] over the stretch = (b F(b) - a F(a) - integral of F) / mass
      var ex = (b * fb - a * fa - (ib - ia)) / mm;
      ex = clamp(ex, a, b);
      if (up) { pUp += mm; sUp += mm * pct(ex); } else { pDn += mm; sDn += mm * pct(ex); }
    }
    for (i = 0; i < c.xs.length - 1; i++) {
      var a = c.xs[i], b = c.xs[i + 1], fa = c.ys[i], fb = c.ys[i + 1], ib = curveAt(c, i, 1).I;
      if (a >= bD - TIE_D) add(true, a, fa, 0, b, fb, ib);
      else if (b < bD - TIE_D) add(false, a, fa, 0, b, fb, ib);
      else {
        var cut = curveAt(c, i, (bD - a) / (b - a)), fc = clamp(cut.F, fa, fb);
        add(false, a, fa, 0, bD, fc, cut.I);
        add(true, bD, fc, cut.I, b, fb, ib);
      }
    }
    return { pUp: pUp, sUp: sUp, pDn: pDn, sDn: sDn, bar: bar };
  }

  /**
   * compare.fromCdf(cdf, baselineD[, shiftD]) — a solved bracelet's finish
   * against a baseline score (D), in damage %. `cdf` is res.finalScore.cdf,
   * or res.finalScore itself; either way the solve's quantiles tighten the
   * reading (cdfCurve), and a cdf solved through this file has them already.
   *
   *   pBeat           P(final >= baseline)
   *   mean            E[final %] over the whole cdf
   *   meanIfBeat      E[final % | final >= baseline]; null when nothing gets there
   *   meanIfNot       E[final % | final <  baseline]; null when everything does
   *   expectedGain    mean - baseline %: signed, the average finish against yours
   *   gainIfBeat      meanIfBeat - baseline %, or null
   *   shortfallIfNot  baseline % - meanIfNot, or null
   *   excess          E[max(0, final % - baseline %)]: the per-1% figure Worth prices
   *   basePct         the baseline, in %
   * or null with no cdf. pBeat x meanIfBeat + (1 - pBeat) x meanIfNot = mean.
   *
   * `mean` is the cdf's own reading. The headline expected final is
   * pct(res.expectedFinal), the solver's exact mean score converted, and the two
   * can sit a few hundredths apart: an average of percentages is not the
   * percentage of an average score, and a thinned rung carries the rest.
   */
  function compareFromCdf(cdf, baselineD, shiftD) {
    var quant = null;
    if (cdf && !Array.isArray(cdf) && cdf.cdf) { quant = cdf.quantiles || null; cdf = cdf.cdf; }
    else if (cdf && CDF_QUANTS) quant = CDF_QUANTS.get(cdf) || null;
    var r = cdfSplit(cdf, baselineD, shiftD, quant);
    if (!r) return null;
    var tot = r.pUp + r.pDn;
    if (!(tot > 0)) return null;
    var mean = (r.sUp + r.sDn) / tot;
    var mb = r.pUp > 0 ? r.sUp / r.pUp : null, mn = r.pDn > 0 ? r.sDn / r.pDn : null;
    return {
      pBeat: r.pUp / tot,
      mean: mean,
      meanIfBeat: mb,
      meanIfNot: mn,
      expectedGain: mean - r.bar,
      gainIfBeat: mb === null ? null : mb - r.bar,
      shortfallIfNot: mn === null ? null : r.bar - mn,
      excess: Math.max(0, (r.sUp - r.pUp * r.bar) / tot),
      basePct: r.bar
    };
  }

  // ------------------------------------------------------------------
  // THE OUTCOME STRIP — where a solved bracelet finishes, drawn to scale
  //
  // BraceletApp.strip: the Advisor's quantile strip, moved here so every tab
  // draws it one way. Whisker p10 to p90, box the middle half, blue line the
  // median; two optional marks on the same scale — the bracelet as it stands
  // (the orange line the Advisor has always drawn) and the baseline bracelet
  // (a dashed line in the text colour).
  //
  // THE LABELS SIT UNDER THE VALUES THEY NAME. They were once a flex row spread
  // with space-between, so "p10" sat hard left and "p90" hard right whatever
  // the numbers were — and when four of the five quantiles are one score, the
  // ordinary case for a bracelet that mostly stands pat, the row read as five
  // separate outcomes (Shizu, 2026-08-15). Each label carries its own fraction
  // of the scale; strip.layout() places and merges them once the browser has
  // sized them, and runs again on a resize.
  // ------------------------------------------------------------------

  // NOT ".bc-strip". advisor-capture.js injects a .bc-strip of its own — the
  // "Parsed, 3 fields need a look" banner, display:none until it has news — and
  // with the reader on this tab now, sharing the name hid every outcome strip.
  var STRIP_CSS =
    ".bc-qstrip{position:relative;height:34px;margin:12px 0 4px}" +
    ".bc-qstrip .track{position:absolute;left:0;right:0;top:13px;height:8px;border-radius:4px;background:var(--panel2);border:1px solid var(--border)}" +
    ".bc-qstrip .whisk{position:absolute;top:16px;height:2px;background:var(--border)}" +
    ".bc-qstrip .box{position:absolute;top:9px;height:16px;border-radius:4px;background:rgba(102,199,255,.22);border:1px solid var(--accent)}" +
    ".bc-qstrip .med{position:absolute;top:5px;width:2px;height:24px;background:var(--accent)}" +
    ".bc-qstrip .cur{position:absolute;top:2px;width:2px;height:30px;background:var(--high)}" +
    ".bc-qstrip .base{position:absolute;top:0;width:0;height:34px;border-left:2px dashed var(--text)}" +
    ".bc-qlab{position:relative;height:16px;font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}" +
    ".bc-qmk{position:absolute;top:0;white-space:nowrap;line-height:1.45}" +
    "@media(max-width:420px){.bc-qlab{font-size:10px}}";

  /** The strip's sheet, once, class-scoped: the strip is drawn in whichever pane asks. */
  function ensureStripCss() {
    if ($("bc-strip-css")) return;
    var st = document.createElement("style");
    st.id = "bc-strip-css";
    st.appendChild(document.createTextNode(STRIP_CSS));
    (document.head || document.documentElement).appendChild(st);
  }

  /** The label row's tooltip, naming only the marks the strip carries. */
  function stripGloss(hasCur, hasBase) {
    return "The spread of where this bracelet finishes, over every way the remaining rolls can land under the best play. " +
      "Each label sits under its own mark on the strip above. p10 means one bracelet in ten ends below this; p90, one in ten ends above. " +
      "The blue box is the middle half, the blue line the median" +
      (hasCur ? ", the orange line where you are today" : "") +
      (hasBase ? ", the dashed line your baseline bracelet" : "") +
      ". Two labels join up when they land on the same score.";
  }

  /**
   * strip.html(o) -> the strip and its label row, as HTML. Call strip.layout()
   * on whatever holds it once it is in the page.
   *
   *   o.q          the solve's finalScore.quantiles {p10, p25, p50, p75, p90}, in D
   *   o.cur        optional D: the bracelet as it stands — the orange line
   *   o.base       optional D: the baseline bracelet — the dashed line
   *   o.baseLabel  optional word for a label under the dashed line ("yours"),
   *                placed and merged like the quantile labels; none by default
   *   o.curGloss / o.baseGloss / o.gloss
   *                optional tooltips for the two marks and the label row
   *
   * Every mark is kept on the scale: the ends stretch to take in the two lines
   * as well as p10 and p90. With {q, cur} alone this draws exactly what the
   * Advisor's own strip drew.
   */
  /** A mark's D from the options, or null when it is not there. */
  function stripMarkD(v) { return (v != null && isFinite(v)) ? Number(v) : null; }

  /**
   * The strip's scale, from the options html() takes: {lo, hi, span} in damage
   * %. The ends take in p10, p90 and whichever of the two lines is drawn, with
   * 12% of the width (0.3 points at least) spare at each end.
   */
  function stripRange(o) {
    var q = o.q, cur = stripMarkD(o.cur), base = stripMarkD(o.base);
    var lo = pct(q.p10), hi = pct(q.p90);
    if (cur !== null) { lo = Math.min(lo, pct(cur)); hi = Math.max(hi, pct(cur)); }
    if (base !== null) { lo = Math.min(lo, pct(base)); hi = Math.max(hi, pct(base)); }
    var pad = Math.max(0.3, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    var span = hi - lo || 1;
    return { lo: lo, hi: lo + span, span: span };
  }

  function stripHtml(o) {
    o = o || {};
    var q = o.q;
    if (!q) return "";
    ensureStripCss();
    var cur = stripMarkD(o.cur), base = stripMarkD(o.base);
    var rg = stripRange(o), lo = rg.lo, span = rg.span;
    function x(v) { return ((pct(v) - lo) / span * 100).toFixed(2) + "%"; }
    function w(a, b) { return ((pct(b) - pct(a)) / span * 100).toFixed(2) + "%"; }
    var marks = [["p10", pct(q.p10)], ["p25", pct(q.p25)], ["median", pct(q.p50)], ["p75", pct(q.p75)], ["p90", pct(q.p90)]];
    if (base !== null && o.baseLabel) {
      marks.push([String(o.baseLabel), pct(base)]);
      marks.sort(function (a, b) { return a[1] - b[1]; });           // stable: a tie keeps the quantile first
    }
    return '<div class="bc-qstrip" data-lo="' + lo + '" data-span="' + span + '">' +
      '<div class="track"></div>' +
      '<div class="whisk" style="left:' + x(q.p10) + ";width:" + w(q.p10, q.p90) + '"></div>' +
      '<div class="box" style="left:' + x(q.p25) + ";width:" + w(q.p25, q.p75) + '"></div>' +
      '<div class="med" style="left:' + x(q.p50) + '"></div>' +
      (base !== null ? '<div class="base" style="left:' + x(base) + '" data-gloss="' +
        esc(o.baseGloss || "Your baseline bracelet: " + fmtDmg(pct(base)) + ".") + '"></div>' : "") +
      (cur !== null ? '<div class="cur" style="left:' + x(cur) + '" data-gloss="' +
        esc(o.curGloss || "Where the bracelet sits right now.") + '"></div>' : "") +
      "</div>" +
      '<div class="bc-qlab" data-lo="' + lo + '" data-span="' + span + '" data-marks="' + esc(JSON.stringify(marks)) +
      '" data-gloss="' + esc(o.gloss || stripGloss(cur !== null, base !== null)) + '">' +
      stripLabels(marks, lo, span) + "</div>";
  }

  /**
   * The labels as HTML: grouped by EQUAL VALUE only, each parked at its own x.
   * Everything measured — labels that merely collide — is stripLayout()'s.
   */
  function stripLabels(marks, lo, span) {
    var groups = [], i, g;
    for (i = 0; i < marks.length; i++) {
      g = groups.length ? groups[groups.length - 1] : null;
      if (g && fmtDmg(g.hi) === fmtDmg(marks[i][1])) { g.keys.push(marks[i][0]); g.hi = marks[i][1]; }
      else groups.push({ keys: [marks[i][0]], lo: marks[i][1], hi: marks[i][1] });
    }
    var h = "";
    for (i = 0; i < groups.length; i++) h += stripMark(groups[i], lo, span);
    return h;
  }

  /**
   * One label: the names it covers, then the score they land on. Three or more
   * names run first…last, so a merged label never spells out half a phone's
   * width; the value is a range whenever the ends differ at the precision they
   * are printed to, so a merge never claims two scores are one.
   */
  function stripMark(g, lo, span) {
    var mid = (g.lo + g.hi) / 2;
    var fr = clamp((mid - lo) / span, 0, 1);
    var names = g.keys.length > 2 ? (g.keys[0] + "…" + g.keys[g.keys.length - 1]) : g.keys.join("·");
    var txt = names + " " + (fmtDmg(g.lo) === fmtDmg(g.hi) ? fmtDmg(g.hi) : fx(g.lo, 2) + "–" + fmtDmg(g.hi));
    return '<span class="bc-qmk" data-fr="' + fr.toFixed(4) + '" style="left:' + (fr * 100).toFixed(2) + '%">' +
      esc(txt) + "</span>";
  }

  /**
   * strip.layout([root]) — anchor every strip label inside `root` (an element
   * or a selector; the whole page by default) to its own value, and merge the
   * ones that collide. Run it after the strip is in the page: how wide a label
   * is and how wide the strip is are answers only the browser has. A strip in
   * a hidden pane has no width and is left until it has one.
   */
  function stripLayout(root) {
    var scope = typeof root === "string" ? document.querySelector(root) : (root || document);
    if (!scope || !scope.querySelectorAll) return;
    var boxes = scope.querySelectorAll(".bc-qlab"), b;
    for (b = 0; b < boxes.length; b++) stripLayoutOne(boxes[b]);
  }

  function stripLayoutOne(box) {
    var W = box.clientWidth, marks, lo, span;
    if (!W) return;
    try { marks = JSON.parse(box.getAttribute("data-marks") || "[]"); } catch (e) { return; }
    lo = num(box.getAttribute("data-lo"), 0); span = num(box.getAttribute("data-span"), 1);
    if (!marks.length || !(span > 0)) return;

    var groups = [], i;
    for (i = 0; i < marks.length; i++) groups.push({ keys: [marks[i][0]], lo: marks[i][1], hi: marks[i][1] });

    // Merge until nothing overlaps. Each pass writes the labels, measures them
    // where they would sit, and folds the first collision; a handful of marks,
    // so it settles in a few passes.
    var guard = 0;
    while (guard++ < 8) {
      var h = "", j;
      for (j = 0; j < groups.length; j++) h += stripMark(groups[j], lo, span);
      box.innerHTML = h;
      var els = box.getElementsByClassName("bc-qmk"), hit = -1, prevRight = -1e9;
      for (j = 0; j < els.length; j++) {
        var w = els[j].offsetWidth;
        var c = clamp(num(els[j].getAttribute("data-fr"), 0) * W, w / 2, Math.max(w / 2, W - w / 2));
        els[j].style.left = (c - w / 2) + "px";
        if (c - w / 2 < prevRight + 6) hit = j;                 // 6px is the least gap that still reads as two labels
        prevRight = c + w / 2;
        if (hit >= 0) break;
      }
      if (hit < 1) return;
      groups[hit - 1].keys = groups[hit - 1].keys.concat(groups[hit].keys);
      groups[hit - 1].hi = groups[hit].hi;
      groups.splice(hit, 1);
    }
  }

  /**
   * strip.scale(target) — the strip's value-to-position mapping, so a tab can
   * read a pointer against it without knowing how the strip is drawn.
   *
   *   scale(opts)     the options html() takes -> {lo, hi, span, fracOf, pctOf}
   *   scale(element)  a drawn strip, or anything holding one -> the same, plus
   *                   {el, left, width, xOf, pctAt}, measured off the page at
   *                   the moment of the call; null when it holds no strip
   *
   *   fracOf(pct)     0..1 across the track        pctOf(frac)     its inverse
   *   xOf(pct)        a client x, in pixels        pctAt(clientX)  the % under it
   *
   * Percentages are damage %, the strip's own unit. Measure again after a
   * resize or a scroll: the element form reads the box where it stands.
   */
  function stripScale(target) {
    var r, el = null;
    if (target && target.nodeType === 1) {
      el = (target.classList && target.classList.contains("bc-qstrip")) ? target : target.querySelector(".bc-qstrip");
      if (!el) return null;
      var lo = num(el.getAttribute("data-lo"), NaN), span = num(el.getAttribute("data-span"), NaN);
      if (!isFinite(lo) || !(span > 0)) return null;
      r = { lo: lo, hi: lo + span, span: span };
    } else {
      if (!target || !target.q) return null;
      r = stripRange(target);
    }
    r.fracOf = function (p) { return (num(p, r.lo) - r.lo) / r.span; };
    r.pctOf = function (f) { return r.lo + num(f, 0) * r.span; };
    if (el) {
      var box = el.getBoundingClientRect();
      r.el = el; r.left = box.left; r.width = box.width;
      r.xOf = function (p) { return r.left + r.fracOf(p) * r.width; };
      r.pctAt = function (x) { return r.width > 0 ? r.pctOf(clamp((num(x, r.left) - r.left) / r.width, 0, 1)) : r.lo; };
    }
    return r;
  }

  // A resize moves every strip's width under labels placed in pixels.
  var stripResizeT = null;
  window.addEventListener("resize", function () {
    if (stripResizeT) clearTimeout(stripResizeT);
    stripResizeT = setTimeout(function () { stripResizeT = null; stripLayout(document); }, 150);
  });

  // ------------------------------------------------------------------
  // the shared state, in this file's terms
  //
  // Everything below reads S (window.Profile's live object) and the handful of
  // derived numbers Profile exposes. Nothing here writes a control's value: the
  // deck does that and tells us through onChange. What this file DOES own is the
  // bracelet's own lines — the granted rows and the fixed rows — because they are
  // the Calculator's subject, not the character's. The padlocks, the rolled set
  // and the history are the Advisor's; this file only ever clears S.locks, when
  // the bracelet they were chosen for stops existing.
  // ------------------------------------------------------------------

  function traitValues() { return P.traitValues(); }
  function traitBand() { return P.traitBand(); }

  // ---- the one profile ----
  //
  // There is no default-vs-character toggle any more (Shizu, 2026-08-12). The
  // deck starts at the canonical defaults and holds whatever the user has made
  // of them; P.profile() is the single answer, and every tab asks it.
  function buildProfile() { return P.profile(); }
  function famGrades(grade) { return P.famGrades(grade); }
  function letterOf(val, grade) { return P.letterOf(val, grade); }
  var TRAIT_KEYS = P.TRAIT_KEYS, TRAIT_LABELS = P.TRAIT_LABELS;
  // The tooltip on each of the bracelet's two fixed combat-trait rows. It stays
  // here because the rows do: they are bracelet lines, not character settings.
  var TRAIT_GLOSS = {
    crit: "The Crit trait line your bracelet came with, in trait points. It converts exactly — 25 percentage points of crit rate per 699 trait points — and then runs through your skills' own crit numbers, so it is worth nothing to a build already at 100% crit.",
    spec: "The Specialization trait line your bracelet came with, in trait points. It scores at the Spec weight you set in the Traits block: value × weight ÷ 100.",
    swift: "The Swiftness trait line your bracelet came with, in trait points. It scores at the Swiftness weight you set in the Traits block: value × weight ÷ 100."
  };
  var GRADE_COLOR = P.GRADE_COLOR;
  var JUNK = P.JUNK;                             // the granted picker's one zero-damage option
  function save() { P.save(); }


  // ------------------------------------------------------------------
  // rows <-> model lines
  // ------------------------------------------------------------------

  function msBands() { return DATA.BASIC.bands; }
  function msRange(grade, fam) {
    var b = msBands();
    return [b[0][grade][fam][0], b[b.length - 1][grade][fam][1]];
  }
  function defaultBasicValue(grade, fam) {
    return Math.round(B.basicBandExpected(fam, grade));
  }

  function rowToLine(r, grade, junkFam) {
    if (!r || !r.fam || r.fam === "none") return null;
    if (r.fam === JUNK) {
      // "Junk Line" is one option standing in for every zero-damage family (see
      // junkFamPool). It still needs A family to be a legal line, so the caller
      // hands us a stand-in — a different one per slot, so two junk slots never
      // read as a duplicate roll.
      var jf = junkFam || junkFamPool(grade)[0];
      return { cat: "special", family: jf, tier: "low", junk: true };
    }
    if (r.fam.indexOf("basic:") === 0) {
      var fam = r.fam.slice(6);
      var v = (r.value === null || r.value === undefined || r.value === "") ? defaultBasicValue(grade, fam) : num(r.value, defaultBasicValue(grade, fam));
      var rg = msRange(grade, fam);
      return { cat: "basic", family: fam, value: clamp(v, rg[0], rg[1]) };
    }
    if (r.fam.indexOf("trait:") === 0) return { cat: "trait", family: r.fam.slice(6) };
    return { cat: "special", family: Number(r.fam.slice(3)), tier: r.tier || "mid" };
  }

  function linesOf(rows, grade, reps) {
    var out = [], i, l;
    reps = reps || [];
    for (i = 0; i < rows.length; i++) { l = rowToLine(rows[i], grade, reps[i]); if (l) out.push(l); }
    return out;
  }

  function familyIdOf(line) {
    if (line.cat === "basic") return "basic:" + line.family;
    if (line.cat === "trait") return "trait:" + line.family;
    return "special:" + line.family;
  }

  /**
   * The solver's own label for a line — the "state atom key". Lines that score
   * nothing all collapse into one interchangeable atom per category, which is
   * exactly how the solver keeps its alphabet small; the roll advisor reports
   * locks by these keys, so this is how a lock maps back to a slot on screen.
   */
  function stateKeyOf(line, grade, profile) {
    var d = B.lineDamage(line, grade, profile);
    if (Math.abs(d) <= 1e-12) return "junk:" + line.cat;
    if (line.cat === "basic") {
      var bands = msBands();
      for (var b = 0; b < bands.length; b++) {
        var rg = bands[b][grade][line.family];
        if (line.value >= rg[0] && line.value <= rg[1]) return "basic:" + line.family + ":b" + b;
      }
      return "basic:" + line.family + ":b0";
    }
    if (line.cat === "trait") return "trait:" + line.family;
    return "special:" + line.family + ":" + line.tier;
  }

  /** Duplicate families and the per-category caps are both illegal in game. */
  function validateSet(lines) {
    var seen = {}, cnt = { basic: 0, trait: 0, special: 0 }, i;
    for (i = 0; i < lines.length; i++) {
      var f = familyIdOf(lines[i]);
      if (seen[f]) return "two lines share the same effect — a bracelet cannot roll a duplicate.";
      seen[f] = 1;
      cnt[lines[i].cat]++;
    }
    if (cnt.basic > DATA.CAPS.basic) return "more than " + DATA.CAPS.basic + " basic-stat lines.";
    if (cnt.trait > DATA.CAPS.trait) return "more than " + DATA.CAPS.trait + " combat-trait lines.";
    if (cnt.special > DATA.CAPS.special) return "more than " + DATA.CAPS.special + " special effects.";
    return null;
  }

  // Fixed rows keep the full family list, so they never carry a junk sentinel.
  function fixedLines() { return linesOf(S.fixedRows, S.grade); }
  function grantedLines() { return linesOf(S.rows, S.grade, junkReps()); }
  function isPartial() { var n = grantedLines().length; return n > 0 && n < S.slots; }

  // ------------------------------------------------------------------
  // family picker: grouped, priced, coloured
  // ------------------------------------------------------------------

  function famGroupOf(fam) {
    if (PARTY_IDS[fam.id]) return "Party";
    var wp = false, only = true, i;
    for (i = 0; i < fam.comp.length; i++) {
      var k = fam.comp[i].k;
      if (k === "weaponPower") wp = true;
      else if (k !== "atkMoveSpeed") only = false;
    }
    return (wp && only) ? "Weapon Power" : null;      // null = decide by the family grade
  }

  // ---- the granted-slot picker ----
  //
  // The FAMILY box names the family and nothing else, prefixed by a letter
  // grade. Roll values belong to the TIER box: they are a property of the tier,
  // not of the family, and showing them twice confused the picker. The letters
  // come from the canonical default profile (Bracelet.familyGrades), so they
  // label the family rather than the current build and never shuffle mid-edit.

  // The letters, their palette and the JUNK sentinel live in profile.js, so the
  // Tier List and this picker can never disagree about a family's grade.
  // The WORDS for low / mid / high are TIER_WORD's, at the top of this file;
  // what is left here is the colour each rarity is painted in.
  var TIER_COLOR = { low: "#5aa9e6", mid: "#c78cff", high: "#ffb86b" };

  // ---- "Junk Line": every F family under one option ----
  //
  // Fifteen of the families a granted slot can roll score exactly nothing —
  // Vitality, all six combat traits and thirteen of the specials — and the
  // model already treats them as one interchangeable atom. Listing them
  // separately was fifteen rows of noise, so the granted picker shows a single
  // "Junk Line" entry (Shizu, 2026-08-11). The FIXED-line editor keeps the full
  // list: see the note on junkFamPool.

  /**
   * The stand-in families a "Junk Line" pick resolves to, lightest listed
   * weight first. They are all specials, deliberately:
   *
   *   - Which one we pick cannot change a granted slot's answer. A junk line is
   *     never locked (the solver's allowLockJunk is off), so it is always
   *     rerolled away and never enters buildPool's present-family set or its
   *     per-category count. Solving the same bracelet with a junk trait, with
   *     Vitality and with a junk special returns bit-identical numbers.
   *   - The category still has to be plausible for the CAP check in
   *     validateSet, which a granted set does run. Specials cap at five, so
   *     three junk slots plus two fixed lines always fit; traits cap at TWO, so
   *     resolving junk to a trait would make three junk slots illegal.
   *   - All thirteen score zero for every profile, not just the default one, so
   *     "Junk Line" really is worth nothing to whoever is looking at it.
   *
   * This is exactly why the collapse stops at the granted slots. A FIXED line
   * never rerolls, so it DOES sit in the pool's present set and its category
   * count for good, and there the category matters a great deal: two fixed
   * combat traits close the whole 35% trait share of the pool, which a fixed
   * junk special does not (expected final 5.94% against 4.49%). The Advanced
   * fixed-line editor therefore still lists every family by name.
   *
   * NOT CACHED. Which families score nothing depends on the ROLE as much as on
   * the grade, and a cache keyed on the grade alone handed a support the damage
   * dealer's stand-ins: a row labelled "Junk Line — no damage at all" scored
   * +0.25% and +0.67% (Shizu, 2026-08-14). It is a sort over thirty families off
   * letters profile.js already caches, so there was nothing here worth keeping.
   */
  function junkFamPool(grade) {
    var fg = famGrades(grade), sum = DATA.GRANTED_LISTED_SUM, list = [], k, id, fam, w, t;
    for (k in fg.special) if (Object.prototype.hasOwnProperty.call(fg.special, k)) {
      if (fg.special[k].letter !== "F") continue;
      id = Number(k); fam = DATA.SPECIAL_BY_ID[id];
      if (!fam) continue;
      w = 0;
      for (t = 0; t < DATA.TIERS.length; t++) w += fam.granted[DATA.TIERS[t]] / sum;
      list.push({ id: id, w: w });
    }
    list.sort(function (a, b) { return a.w - b.w || a.id - b.id; });
    var out = [];
    for (k = 0; k < list.length; k++) out.push(list[k].id);
    return out;
  }

  /**
   * One stand-in per granted slot, index-aligned, skipping every family already
   * named on the bracelet — two lines of the same family would otherwise trip the
   * duplicate check in validateSet.
   *
   * The GRANTED rows count too, not just the fixed ones. They hold their real
   * family now even when it is worth nothing to the role being scored (see
   * familyOptions), so a support who typed families 29 and 30 and pressed DPS has
   * two rows naming the very families the damage dealer's junk pool hands out —
   * and the panel used to answer "two lines share the same effect" about a
   * duplicate the user never picked.
   */
  function junkReps() {
    var pool = junkFamPool(S.grade), used = {}, i, out = [];
    markSpecials(S.fixedRows, used);
    markSpecials(S.rows, used);
    for (i = 0; i < pool.length && out.length < S.slots; i++) if (!used[pool[i]]) out.push(pool[i]);
    while (out.length < S.slots) out.push(pool[out.length] || pool[0]);
    return out;
  }

  /** Every special family id these rows name, as a set. */
  function markSpecials(rows, used) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.fam && r.fam.indexOf("sp:") === 0) used[Number(r.fam.slice(3))] = 1;
    }
  }

  /**
   * The official labels carry placeholders (+A%, +X, +B%) that say nothing
   * until the tier is known, and an ally-buff rider a damage dealer can ignore.
   * Strip both and you are left with the family's name.
   */
  function cleanFamLabel(fam) {
    var s = fam.label
      .replace(/;\s*ally[^;]*$/i, "")
      .replace(/\(1\/party\)/g, "")
      .replace(/[+−-]\s*[AXB]%?/g, "")
      .replace(/\s+([;,])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/[;,]$/, "");
    return s;
  }

  /**
   * The tier's actual roll, formatted: percentages as %, stats as a count.
   *
   * The two-value families join TIGHT — "+9,000/+2,400", not "+9,000 / +2,400".
   * This text is the closed rarity box's whole line, and the spaced version is
   * eight pixels wider than the box it has to fit in.
   */
  function tierValueText(fam, grade, tier) {
    var vals = fam.values[grade][tier], parts = [], i, j, c;
    for (i = 0; i < vals.length; i++) {
      c = null;
      for (j = 0; j < fam.comp.length; j++) if (fam.comp[j].from === i) { c = fam.comp[j]; break; }
      var flat = c && (c.k === "weaponPower" || c.k === "mainStat");
      parts.push("+" + (flat ? nf(vals[i]) : vals[i] + "%"));
    }
    return parts.join("/");
  }

  /**
   * Every family a slot can hold, grouped, letter-graded and sorted.
   *
   * collapseJunk (granted slots only) drops every F-graded family, whichever
   * group it landed in, and puts one "Junk Line" in their place.
   *
   * `held` is the family the row is actually showing, and the collapse must
   * never swallow it. Which families grade F depends on the ROLE — 28, 29 and 30
   * are dead to a damage dealer and worth up to 0.90% to a support, and every
   * crit line is the other way round — so a support who typed those three and
   * then pressed DPS would find three slots holding a family the picker no
   * longer lists. The state keeps the real family (profile.js collapses stored
   * rows once, on load, and only for families dead to BOTH roles); this puts it
   * back on screen, greyed, beside the reason it is worth nothing.
   */
  function familyOptions(grade, collapseJunk, held) {
    var fg = famGrades(grade);
    var G = { Damage: [], Party: [], "Weapon Power": [], Stats: [], Junk: [] };
    var i, g;

    G.Stats.push({ val: "basic:mainStat", text: "Str / Dex / Int", letter: fg.basic.mainStat.letter, avg: fg.basic.mainStat.avg });
    G.Stats.push({ val: "basic:vitality", text: "Vitality", letter: fg.basic.vitality.letter, avg: 0 });
    for (i = 0; i < DATA.TRAITS.families.length; i++) {
      var tk = DATA.TRAITS.families[i].key;
      G.Stats.push({ val: "trait:" + tk, text: DATA.TRAITS.families[i].label + " (combat trait)", letter: fg.trait[tk].letter, avg: 0 });
    }
    for (i = 0; i < DATA.SPECIALS.length; i++) {
      var fam = DATA.SPECIALS[i], e = fg.special[fam.id];
      g = famGroupOf(fam);
      if (!g) g = e.avg > 1e-9 ? "Damage" : "Junk";
      G[g].push({ val: "sp:" + fam.id, text: cleanFamLabel(fam), letter: e.letter, avg: e.avg });
    }

    var order = ["Damage", "Party", "Weapon Power", "Stats", "Junk"], j;
    if (collapseJunk) {
      // The held family's own entry, taken before the collapse throws it away —
      // so its name is the one the list would have shown, not a second spelling.
      var heldOpt = null;
      if (held && held !== "none" && held !== JUNK) {
        for (i = 0; i < order.length && !heldOpt; i++) {
          for (j = 0; j < G[order[i]].length; j++) if (G[order[i]][j].val === held) { heldOpt = G[order[i]][j]; break; }
        }
      }
      for (i = 0; i < order.length; i++) {
        var keep = [];
        for (j = 0; j < G[order[i]].length; j++) if (G[order[i]][j].letter !== "F") keep.push(G[order[i]][j]);
        G[order[i]] = keep;
      }
      G.Junk = [{ val: JUNK, text: "Junk Line — no damage at all", letter: "F", avg: 0 }];
      if (heldOpt && heldOpt.letter === "F") {
        G.Junk.push({ val: heldOpt.val, letter: "F", avg: 0,
          text: heldOpt.text + " — worth nothing to " + (P.role() === "support" ? "a support" : "a damage dealer") });
      }
    }

    var groups = [];
    for (i = 0; i < order.length; i++) {
      G[order[i]].sort(function (a, b) { return b.avg - a.avg; });
      groups.push({ label: order[i], items: G[order[i]] });
    }
    return groups;
  }

  function pickerHtml(id, groups, selected, grade) {
    // Most labels fit now; only the longest are clipped, and the full name of
    // the family currently in the slot leads the tooltip — nothing is lost.
    var full = "", i, j;
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < groups[i].items.length; j++) if (groups[i].items[j].val === selected) full = groups[i].items[j].text;
    }
    var gloss = (full ? full + " — " : "") +
      "the effect family this slot holds. The letter is the family's own grade, F to S: how good its AVERAGE roll is next to the best family in the game, always measured on the default character so the letters mean the same thing to everyone. What a particular roll is worth is the rarity box beside it.";
    // A native select cannot colour its closed text per option, so paint the
    // control itself from the selected family's grade — same trick the rarity
    // box beside it already uses. handleRowEvent repaints it on every change.
    var letter = letterOf(selected, grade || S.grade);
    var shut = letter ? GRADE_COLOR[letter] : "var(--text)";
    var h = '<select id="' + id + '" class="bc-fam" style="color:' + shut + ';font-weight:700" title="' +
      esc(full) + '" data-gloss="' + esc(gloss) + '">';
    h += '<option value="none" style="color:var(--dim);font-weight:400"' + (selected === "none" ? " selected" : "") + ">&mdash; empty &mdash;</option>";
    for (i = 0; i < groups.length; i++) {
      if (!groups[i].items.length) continue;
      h += '<optgroup label="' + esc(groups[i].label) + '">';
      for (j = 0; j < groups[i].items.length; j++) {
        var it = groups[i].items[j];
        h += '<option value="' + esc(it.val) + '" style="color:' + GRADE_COLOR[it.letter] + '" title="' + esc(it.text) + '"' +
          (selected === it.val ? " selected" : "") + ">" +
          esc(it.letter + " · " + it.text) + "</option>";
      }
      h += "</optgroup>";
    }
    return h + "</select>";
  }

  /** The tier box: the three rarities, each showing what it actually rolls. */
  function tierHtml(id, fam, grade, selected) {
    var order = ["high", "mid", "low"], h = "", i, t;
    for (i = 0; i < order.length; i++) {
      t = order[i];
      h += '<option value="' + t + '" style="color:' + TIER_COLOR[t] + '"' +
        (selected === t ? " selected" : "") + ">" +
        esc(tierWord(t) + " · " + tierValueText(fam, grade, t)) + "</option>";
    }
    var cur = TIER_COLOR[selected] || "var(--text)";
    return '<select id="' + id + '" style="color:' + cur + ';font-weight:700" data-gloss="' +
      "The rarity this line rolled at, and what it is worth. Legendary is the family's best roll, Epic the middle one, Heroic the weakest; the numbers are the actual values for the family on the left." +
      '">' + h + "</select>";
  }

  // ------------------------------------------------------------------
  // per-line explanations (the data-gloss text on the breakdown table)
  // ------------------------------------------------------------------

  function nf(v) { return Math.round(v).toLocaleString("en-US"); }

  function explainLine(line, grade, profile) {
    if (!line) return "";
    if (line.junk) {
      return "A line that does nothing for damage — Vitality, a combat trait, a defensive or party-only effect. " +
        "Fifteen families land here and they are all worth the same to a damage score: nothing. The solver never " +
        "locks one, so a junk slot is always a slot you reroll.";
    }
    if (line.cat === "trait") {
      return "Combat traits (Crit, Specialization, …) feed class mechanics this model does not read, so they score 0% damage. Their in-game value is real; it just is not comparable in % damage.";
    }
    if (line.cat === "basic" && line.family === "vitality") {
      return "Vitality is pure survivability: 0% damage for a DPS score.";
    }
    if (line.cat === "basic") {
      var ap0 = B.attackPower(profile, 0, 0), ap1 = B.attackPower(profile, line.value, 0);
      return "Main stat +" + nf(line.value) + " joins the RAW pool, so the ×" + fx(1 + profile.msPct, 3) +
        " main-stat bucket amplifies it just like gear does. Attack power = √(mainStat·weaponPower/6)·" +
        fx(1 + profile.baseApPct, 3) + " + " + nf(profile.flatAP) + " goes " + nf(ap0) + " → " + nf(ap1) +
        ", a ×" + fx(ap1 / ap0, 5) + " on damage.";
    }
    var fam = DATA.SPECIAL_BY_ID[line.family];
    if (!fam) return "";
    var vals = fam.values[grade][line.tier], parts = [], i;
    for (i = 0; i < fam.comp.length; i++) {
      var c = fam.comp[i];
      var x = (c.v !== undefined) ? c.v : vals[c.from];
      var scaled = c.scaleKey ? x * profile[c.scaleKey] : x;
      parts.push(explainComponent(c, x, scaled, profile, fam));
    }
    var txt = fam.label + " at " + tierWord(line.tier) + ": " + parts.join("  ");
    if (PARTY_IDS[fam.id]) {
      txt += "  Party lines are counted as your own gain plus " + profile.allyDpsCount +
        " × an ally's gain, each ally assumed to deal the same damage as you before the line, at 90% crit / 280% crit damage.";
    }
    return txt;
  }

  function explainComponent(c, x, scaled, profile, fam) {
    var pool, cf0, cf1;
    switch (c.k) {
      case "none":
        return "no damage component — 0%.";
      case "weaponPower":
        var ap0 = B.attackPower(profile, 0, 0), ap1 = B.attackPower(profile, 0, scaled);
        return "+" + nf(x) + " weapon power" + (c.scaleKey ? " × " + profile[c.scaleKey] + " (" + c.scaleKey + ") = +" + nf(scaled) : "") +
          " → attack power " + nf(ap0) + " → " + nf(ap1) + " (×" + fx(ap1 / ap0, 5) + ").";
      case "mainStat":
        return "+" + nf(scaled) + " main stat, amplified by the ×" + fx(1 + profile.msPct, 3) + " bucket.";
      case "critRate":
        cf0 = B.critFactor(profile, 0, 0); cf1 = B.critFactor(profile, x / 100, 0);
        return "crit rate +" + x + " pp (uncapped — overflow pays its substitution value): expected crit factor " + fx(cf0, 4) + " → " + fx(cf1, 4) + ".";
      case "critDamage":
        cf0 = B.critFactor(profile, 0, 0); cf1 = B.critFactor(profile, 0, x / 100);
        return "crit damage +" + x + " pp: crit factor " + fx(cf0, 4) + " → " + fx(cf1, 4) + ".";
      case "onCritDamage":
        return "on a crit, damage +" + x + "% — this is crit-HIT damage, so the crit branch becomes 1 + cr·(cd·" + fx(1 + x / 100, 3) + " − 1), not additional damage.";
      case "addDamage":
        pool = B.addDamagePool(profile);
        return "additional damage pool " + fx(pool * 100, 2) + "% → " + fx((pool + x / 100) * 100, 2) +
          "%, a ×" + fx((1 + pool + x / 100) / (1 + pool), 5) + " (the pool is additive with itself, then multiplies once).";
      case "outgoing":
        return "outgoing damage +" + x + "% is its own multiplicative bucket, undiluted: ×" + fx(1 + x / 100, 4) + ".";
      case "outgoingCdPenalty":
        return "damage +" + x + "% but cooldowns +" + (c.cdPct || 0) + "%. Burst play pays no penalty (×" + fx(1 + x / 100, 4) +
          "), sustained play divides by " + fx(1 + (c.cdPct || 0) / 100, 3) + "; the score is the " +
          fx(profile.cooldownPenaltyWeight, 2) + " / " + fx(1 - profile.cooldownPenaltyWeight, 2) + " mean of the two.";
      case "staggered":
        return "+" + x + "% while the boss is staggered × your " + fx(profile.staggeredShare * 100, 1) + "% stagger share = ×" +
          fx(1 + profile.staggeredShare * x / 100, 5) + ".";
      case "demon":
        return "+" + x + "% demon damage, diluted by the " + fx(profile.demonBase * 100, 1) +
          "% you already carry and scaled by your " + fx(profile.demonShare * 100, 0) + "% demon-boss share.";
      case "backAttack":
        return "+" + x + "% back attack × your " + fx(profile.backAttackShare * 100, 0) + "% back-attack share.";
      case "frontAttack":
        return "+" + x + "% front attack × your " + fx(profile.frontAttackShare * 100, 0) + "% front-attack share.";
      case "nonDirectional":
        return "+" + x + "% non-directional × your " + fx(profile.nonDirectionalShare * 100, 0) + "% non-directional share.";
      case "atkMoveSpeed":
        return "attack & move speed +" + scaled + "% — not converted to damage in v1, so 0%.";
      case "defShred":
        var g = B.defShredGain(profile, x);
        return "enemy defense −" + x + "%: with " + fx(profile.enemyBaseDR * 100, 0) +
          "% base damage reduction that is ×" + fx(g, 5) + " for everyone hitting the boss.";
      case "critResistShred":
        cf0 = B.allyCritFactor(profile, 0, 0); cf1 = B.allyCritFactor(profile, x / 100, 0);
        return "enemy crit resist −" + x + " pp reads as +" + x + " pp crit rate for the whole party; an ally's crit factor " +
          fx(cf0, 4) + " → " + fx(cf1, 4) + ".";
      case "critDmgResistShred":
        cf0 = B.allyCritFactor(profile, 0, 0); cf1 = B.allyCritFactor(profile, 0, x / 100);
        return "enemy crit-damage resist −" + x + " pp reads as +" + x + " pp crit damage party-wide; an ally's crit factor " +
          fx(cf0, 4) + " → " + fx(cf1, 4) + ".";
      case "shieldedDamage":
        return "+" + x + "% while the target is shielded × " + fx(profile.shieldUptime * 100, 0) + "% shield uptime = +" +
          fx(profile.shieldUptime * x, 2) + "% each, for you and every ally.";
      case "allyApBuff":
        return "ally attack-power buff +" + x + "% scales a buff only supports give, so it scores 0 for a DPS.";
      case "allyDamageBuff":
        return "ally damage buff +" + x + "% is support-only: 0 for a DPS.";
      case "partyShieldHeal":
        return "party shield / heal +" + x + "% is support-only: 0 for a DPS.";
    }
    return "";
  }

  // ------------------------------------------------------------------
  // worker plumbing
  // ------------------------------------------------------------------

  var worker = null, reqSeq = 0, inflight = null;
  // ONE WAITING REQUEST PER LANE, and a newer request replaces only its own
  // lane's. The lanes are the three kinds of solve that share this one worker:
  //   main   the Grader's bracelet — this tab's and the Advisor's; "advise" too
  //   fresh  the same bracelet unrolled, for the unrolled card
  //   side   solver.solve(), any bracelet a tab asks about
  // With one queue, the unrolled card's solve could cancel the Advisor's, and a
  // sweep of side solves would cancel both. The main lane goes first.
  var LANES = ["main", "fresh", "side"];
  var queued = { main: null, fresh: null, side: null };
  var cache = {}, cacheOrder = [], CACHE_MAX = 40;
  // Side solves keep a cache of their own, so a sweep of them cannot push the
  // Grader's bracelet out of the one above. Lookups read both.
  var sideCache = {}, sideOrder = [], SIDE_MAX = 60;
  var lastSolve = null, lastSolveKey = null;     // the current bracelet
  var freshSolve = null, freshSolveKey = null;   // the same bracelet unrolled — "what an empty one is worth"
  // Which state the WORKER's stored context belongs to. A cache hit answers the
  // display without touching the worker, so this can lag behind lastSolveKey —
  // and advise() needs the real thing.
  var workerCtxKey = null;
  var busy = 0;

  /**
   * The solve cache's key. THE WHOLE PROFILE, not a list of its fields.
   *
   * A hand-kept list is a list somebody has to remember to extend, and every
   * omission is the same bug: a setting moves, the table under it moves, and the
   * hero cards go on quoting a solve of the old one. Role, the support block and
   * supportHasEffects were all missing until 2026-08-14, and
   * atkMoveSpeedDamagePerPct outlived that fix — drag Attack speed from 1 to 3
   * and the breakdown ran to +17.35% while every card stayed at +14.60%.
   *
   * The object is safe to stringify: it comes from normalizeProfile, which
   * deep-copies the model's DEFAULT_PROFILE and writes over it, so the key order
   * is that constant's order every time whatever the caller passed.
   *
   * GOLD IS STILL NOT IN HERE, because gold is not on the profile — the rate and
   * the baseline live on S.econ and never reach normalizeProfile. That is what
   * lets the gold slider drag without a three-second re-solve.
   */
  function profileSig(profile) {
    return JSON.stringify(profile);
  }

  // Gold is deliberately NOT in the key, and the solve is sent goldPer1Pct 0 and
  // baselinePct 0 for the same reason: worth is a sum over the distribution the
  // solve returns (worthOf), so the gold slider and the baseline both redraw the
  // number without re-solving. A solve is three seconds; the sum is microseconds.
  //
  // A SOLVE SPEC is everything a solve reads: {grade, slots, rolls, fixed,
  // granted, traits, profile}. The Grader's bracelet is one spec (editorSpec);
  // solver.solve() builds others (specOf). One key for both, so a side solve of
  // the very bracelet in the Grader is a cache hit, not a second solve.
  function keyFor(sp) {
    return JSON.stringify([sp.grade, sp.slots, sp.rolls, sp.fixed, sp.granted, sp.traits]) + "|" + profileSig(sp.profile);
  }
  function editorSpec(profile, granted, rolls) {
    return { grade: S.grade, slots: S.slots, rolls: rolls, fixed: fixedLines(), granted: granted,
      traits: traitValues(), profile: profile };
  }
  function keyOf(profile, granted, rolls) {
    return keyFor(editorSpec(profile, granted, rolls));
  }

  function ensureWorker() {
    if (worker) return worker;
    try {
      worker = new Worker("solver-worker.js?v=13");
    } catch (e) {
      worker = null;
      return null;
    }
    worker.onmessage = function (e) {
      var m = e.data || {};
      var job = inflight;
      inflight = null;
      if (job && job.id === m.id) {
        if (m.ok) job.resolve(m.res);
        else job.reject(new Error(m.error || "solver failed"));
      }
      pump();
    };
    worker.onerror = function (e) {
      var job = inflight; inflight = null;
      if (job) job.reject(new Error("worker error: " + (e.message || "unknown")));
      pump();
    };
    return worker;
  }

  /**
   * One request in flight. A newer request replaces whatever is waiting IN ITS
   * OWN LANE, so a burst of keystrokes costs one solve, not ten.
   *
   *   o.lane     "main" (the default), "fresh" or "side" — see LANES
   *   o.key      a solve's cache key. The SAME solve already running, or already
   *              waiting in this lane, is the answer this caller wants, so it
   *              gets that request's promise instead of a second three-second
   *              solve. An import used to pay twice: the load and the economy
   *              seed each asked for the bracelet while the first solve ran.
   *   o.keepCtx  false when the worker need not keep this solve's context. A
   *              request that keeps it can answer one that does not; never the
   *              other way round, or advise() would read the wrong bracelet.
   */
  function send(cmd, payload, o) {
    o = o || {};
    var lane = queued.hasOwnProperty(o.lane) ? o.lane : "main";
    var keep = o.keepCtx !== false;
    var w = ensureWorker();
    if (!w) return Promise.reject(new Error("Web Workers are unavailable in this browser."));
    if (o.key) {
      var same = sameJob(o.key, lane, keep);
      if (same) return same.promise;
    }
    var job = { id: ++reqSeq, cmd: cmd, payload: payload, lane: lane, key: o.key || null, keepCtx: keep };
    job.promise = new Promise(function (resolve, reject) { job.resolve = resolve; job.reject = reject; });
    // Only one request waits per lane: a newer one replaces it. The replaced
    // job MUST be rejected or its caller would hang and the busy indicator
    // would never clear.
    if (queued[lane]) queued[lane].reject(new Error("superseded"));
    queued[lane] = job;
    pump();
    return job.promise;
  }
  /**
   * A request for the same solve that this caller can share: the one running
   * (whichever lane sent it — it can no longer be replaced), or the one waiting
   * in the caller's own lane (replaced only by what would replace the caller's).
   */
  function sameJob(key, lane, needCtx) {
    function fits(j) { return !!j && j.key === key && (j.keepCtx || !needCtx); }
    if (fits(inflight)) return inflight;
    return fits(queued[lane]) ? queued[lane] : null;
  }
  function pump() {
    if (inflight || !worker) return;
    for (var i = 0; i < LANES.length; i++) {
      var j = queued[LANES[i]];
      if (!j) continue;
      queued[LANES[i]] = null;
      inflight = j;
      worker.postMessage({ id: j.id, cmd: j.cmd, payload: j.payload });
      return;
    }
  }
  /** Drop the request waiting in one lane. Its caller hears "superseded". */
  function cancelLane(lane) {
    var j = queued[lane];
    if (!j) return false;
    queued[lane] = null;
    j.reject(new Error("superseded"));
    return true;
  }

  function cacheGet(k) { return cache[k] || sideCache[k]; }
  function cachePut(k, v, side) {
    var c = side ? sideCache : cache, order = side ? sideOrder : cacheOrder, max = side ? SIDE_MAX : CACHE_MAX;
    if (!c[k]) {
      order.push(k);
      while (order.length > max) delete c[order.shift()];
    }
    c[k] = v;
  }

  function setBusy(on) {
    busy += on ? 1 : -1;
    if (busy < 0) busy = 0;
    var el = $("bc-busy");
    if (el) el.className = busy ? "bc-busy on" : "bc-busy";
  }

  /**
   * o.keepCtx  false for the side solve that prices an unrolled bracelet, so it
   *            cannot evict the context advise() reads.
   * o.force    skip the cache — used when the display is cached but the worker
   *            is holding some other bracelet's context.
   * o.lane     which queue lane; by default "main", or "fresh" when keepCtx is off.
   */
  function solveState(profile, granted, rolls, o) {
    return solveSpec(editorSpec(profile, granted, rolls), o);
  }

  /** Any spec, through the cache, the lanes and the worker. -> Promise({key, res, cached}) */
  function solveSpec(sp, o) {
    o = o || {};
    var keep = o.keepCtx !== false, lane = o.lane || (keep ? "main" : "fresh");
    var side = lane === "side";
    var k = keyFor(sp);
    var hit = cacheGet(k);
    if (hit && !o.force) return Promise.resolve({ key: k, res: hit, cached: true });
    // The busy dot is the Grader's: a tab's side solves carry their own signs.
    if (!side) setBusy(true);
    return send("solve", {
      grade: sp.grade, profile: sp.profile, fixedLines: sp.fixed, grantedLines: sp.granted,
      traitValues: sp.traits,
      slots: sp.slots, rollsLeft: sp.rolls, goldPer1Pct: 0, baselinePct: 0,
      ctxKey: k, keepCtx: keep
    }, { lane: lane, key: k, keepCtx: keep }).then(function (res) {
      if (!side) setBusy(false);
      noteQuantiles(res);
      cachePut(k, res, side);
      if (keep) workerCtxKey = k;
      return { key: k, res: res, cached: false };
    }, function (err) {
      if (!side) setBusy(false);
      throw err;
    });
  }

  // ---- solver.solve(): any bracelet, not just the Grader's ----

  /**
   * solver.solve(spec) -> Promise(res): a bracelet described from outside the
   * Grader, solved on the live profile through the same worker. For the
   * Advisor's simulator, which asks at every slider position:
   *
   *   spec = { grade: "ancient" | "relic",           default: the Grader's
   *            slots: 1-3, legal for the grade,       default: the Grader's
   *            traits: {crit, spec, swift} points,    or the Grader's {on, v} shape
   *            lines: [granted lines],                model lines or picker rows;
   *                                                   null, {} and "none" are empty
   *            fixed: [fixed lines],                  default none
   *            rollsLeft: 0-20,                       default 7 unrolled, else the Grader's
   *            unrolled: true }                       ignore the lines: a sealed bracelet
   *
   * CHEAP TO REPEAT: a spec already solved is a cache hit, and one already
   * running or waiting is shared rather than solved twice. CANCELLABLE: it rides
   * its own lane, one request waiting at a time, so the position the slider
   * has left is dropped the moment a newer one arrives — its promise rejects
   * with Error("superseded"), which a caller should catch and ignore. A solve
   * already running cannot be stopped; its answer is cached and waits for the
   * next ask.
   *
   * It NEVER keeps its context in the worker (keepCtx off), so it cannot evict
   * the one advise() reads, and it never touches the Grader's own results.
   * Anything the solver would refuse — half the slots filled, a duplicate
   * family, more lines than slots — rejects with a sentence saying so.
   *
   * The result is the worker's trimmed solve: finalScore.cdf (160 rungs) and
   * finalScore.quantiles in log-space D, expectedFinal, currentScore, and the
   * rest. It may be a cached object shared with other callers: read it, never
   * write to it.
   */
  function solveAny(spec) {
    var sp;
    try { sp = specOf(spec); } catch (e) { return Promise.reject(e); }
    return solveSpec(sp, { keepCtx: false, lane: "side" }).then(function (out) { return out.res; });
  }

  /** A spec from outside, in the solver's own terms, or a thrown Error saying what is wrong with it. */
  function specOf(spec) {
    spec = spec || {};
    var grade = (spec.grade === "relic" || spec.grade === "ancient") ? spec.grade : S.grade;
    var legal = grade === "relic" ? [1, 2] : [2, 3];
    var slots = Math.round(num(spec.slots, legal.indexOf(S.slots) >= 0 ? S.slots : legal[legal.length - 1]));
    if (legal.indexOf(slots) < 0) {
      throw new Error("A" + (grade === "relic" ? " Relic" : "n Ancient") + " bracelet has " + legal.join(" or ") +
        " granted slots, not " + slots + ".");
    }
    var unrolled = !!spec.unrolled;
    var rolls = clamp(Math.round(num(spec.rollsLeft, unrolled ? S.rollsTotal : S.rollsLeft)), 0, 20);
    var traits = spec.traits ? traitMapOf(spec.traits) : traitValues();
    var fixed = specLines(spec.fixed, grade, false, []);
    var granted = unrolled ? [] : specLines(spec.lines, grade, true, fixed);
    if (granted.length > slots) throw new Error(granted.length + " lines for " + slots + " granted slots.");
    if (granted.length && granted.length < slots) {
      throw new Error("Fill every granted slot, or leave them all empty for an unrolled bracelet.");
    }
    var bad = validateSet(fixed.concat(granted));
    if (bad) throw new Error("This bracelet cannot exist: " + bad);
    return { grade: grade, slots: slots, rolls: rolls, fixed: fixed, granted: granted, traits: traits, profile: buildProfile() };
  }

  /** Trait points in traitValues()'s own shape and key order, from points or {on, v}. */
  function traitMapOf(t) {
    var out = {}, i, k, v;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      v = t[k];
      if (v === undefined && k === "swift") v = t.swiftness;
      if (v && typeof v === "object") v = v.on ? v.v : 0;
      out[k] = Math.max(0, num(v, 0));
    }
    return out;
  }

  /**
   * Lines from outside, in the shapes grantedLines() makes, so an identical
   * bracelet has an identical cache key. Model lines ({cat, …}) and picker rows
   * ({fam, …}) are both read; empties are dropped. A "Junk Line" — {junk: true}
   * or the row "junk" — gets a stand-in family the way the Grader's does:
   * worth nothing on the live role, and not a family the other lines already
   * name.
   */
  function specLines(list, grade, granted, others) {
    if (!list || !list.length) return [];
    var out = [], junkAt = [], used = {}, all, reps = [], pool, i, x, l;
    for (i = 0; i < list.length; i++) {
      x = list[i];
      if (!x || typeof x !== "object") continue;
      if (x.fam !== undefined ? x.fam === JUNK : !!x.junk) {
        // Fixed lines never reroll, so they are never junk: drop it there.
        if (granted) { junkAt.push(out.length); out.push(null); }
        continue;
      }
      if (x.fam !== undefined) l = (x.fam && x.fam !== "none") ? rowToLine(x, grade) : null;
      else l = modelLine(x, grade);
      if (l) out.push(l);
    }
    if (!junkAt.length) return out;
    // Index-aligned stand-ins, exactly as junkReps() hands them to the Grader's
    // rows, so the same bracelet keys the same whichever door it came in by.
    all = out.concat(others);
    for (i = 0; i < all.length; i++) if (all[i] && all[i].cat === "special") used[Number(all[i].family)] = 1;
    pool = junkFamPool(grade);
    for (i = 0; i < pool.length && reps.length < out.length; i++) if (!used[pool[i]]) reps.push(pool[i]);
    while (reps.length < out.length) reps.push(pool[reps.length] || pool[0]);
    for (i = 0; i < junkAt.length; i++) out[junkAt[i]] = { cat: "special", family: reps[junkAt[i]], tier: "low", junk: true };
    return out;
  }

  /** A model line checked into rowToLine's own shape, or null. */
  function modelLine(x, grade) {
    if (x.cat === "basic") {
      if (x.family !== "mainStat" && x.family !== "vitality") return null;
      var rg = msRange(grade, x.family);
      var v = num(x.value, defaultBasicValue(grade, x.family));
      return { cat: "basic", family: x.family, value: clamp(v, rg[0], rg[1]) };
    }
    if (x.cat === "trait") {
      var tk = B.traitFamilyKey(String(x.family));
      return tk ? { cat: "trait", family: tk } : null;
    }
    if (x.cat === "special") {
      var fam = DATA.SPECIAL_BY_ID[Number(x.family)];
      if (!fam || TIERS.indexOf(x.tier) < 0) return null;
      return { cat: "special", family: fam.id, tier: x.tier };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // recompute
  // ------------------------------------------------------------------

  var debounceTimer = null, computeSeq = 0;

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recompute, DEBOUNCE_MS);
  }

  function recompute() {
    debounceTimer = null;
    var mine = ++computeSeq;
    var profile = buildProfile();
    var granted = grantedLines();
    var err = validateSet(fixedLines().concat(granted));

    if (isPartial() || err) {
      lastSolve = null; lastSolveKey = null;
      renderResults(profile, err);
      return;
    }

    var rolls = S.rollsLeft;
    // DIM WHAT IS ABOUT TO BE REPLACED. A solve is a second or three, and until
    // it lands every figure on screen answers a question the user has stopped
    // asking — so a role flip looked like it did nothing at all. Here rather
    // than in schedule(): this runs when the debounce has already fired, so a
    // drag never flickers, and only when the key really moved, so dragging the
    // gold slider (which is not in the key) never dims anything.
    if (keyOf(profile, granted, rolls) !== lastSolveKey) markStale(true);
    solveState(profile, granted, rolls).then(function (out) {
      if (mine !== computeSeq) return;                       // a newer edit already landed
      lastSolve = out.res; lastSolveKey = out.key;
      renderResults(profile, null);
      // The character banner reads its three figures off lastSolve, and it was
      // painted before the solve existed — so without this it kept showing the
      // placeholder dashes for ever.
      renderCharHeader();
      // "What an empty one is worth" — same character, same slots, no lines, full rolls.
      return solveState(profile, [], S.rollsTotal, { keepCtx: false }).then(function (f) {
        if (mine !== computeSeq) return;
        freshSolve = f.res; freshSolveKey = f.key;
        renderResults(profile, null);
      });
    }).catch(function (e) {
      if (mine !== computeSeq) return;
      if (e && e.message === "superseded") return;
      lastSolve = null;
      renderResults(profile, e && e.message ? e.message : "solve failed");
    });
  }

  // ------------------------------------------------------------------
  // markup
  //
  // The deck's own builders (fldNum / slider / segmented / toggle and the chip
  // machinery) went to profile.js with the controls they draw. What stays here is
  // the bracelet's markup, which the deck never touches.
  // ------------------------------------------------------------------

  function styleBlock() {
    return "<style>" +
      // Scoped to the Calculator pane. The DECK's stylesheet is not here any
      // more: profile.js injects it, class-scoped, because the deck moves
      // between tabs and a pane-id prefix would strip its own styling.
      // ---- the imported character's header ----
      "#tab-calculator .bc-prof{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 4px}" +
      // An <img> cannot inherit the SVG's fill=currentColor, so flatten the
      // glyph to black and invert it to the theme's off-white.
      "#tab-calculator .bc-prof .bc-classicon{width:46px;height:46px;object-fit:contain;flex:0 0 auto;filter:brightness(0) invert(.82);opacity:.92}" +
      "#tab-calculator .bc-prof .bc-id{display:flex;flex-direction:column;gap:3px;min-width:0}" +
      "#tab-calculator .bc-prof .bc-name{font-size:30px;font-weight:800;letter-spacing:-.015em;line-height:1.05;color:var(--text)}" +
      "#tab-calculator .bc-prof .bc-name a{color:inherit;text-decoration:none;border-bottom:1px dotted transparent;transition:border-color .12s,color .12s}" +
      "#tab-calculator .bc-prof .bc-name a:hover{color:var(--accent);border-bottom-color:var(--accent)}" +
      "#tab-calculator .bc-prof .bc-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12.5px;color:var(--dim)}" +
      "#tab-calculator .bc-prof .bc-meta .bc-chip{display:inline-flex;align-items:baseline;gap:5px;background:var(--panel);border:1px solid var(--border);border-radius:99px;padding:2px 10px;font-weight:600}" +
      "#tab-calculator .bc-prof .bc-meta .bc-chip b{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}" +
      "#tab-calculator .bc-star{background:none;border:none;cursor:pointer;font-size:24px;line-height:1;padding:0 2px;color:var(--none);font-family:inherit;vertical-align:middle;transition:color .12s,transform .08s}" +
      "#tab-calculator .bc-star:hover{transform:scale(1.12)}" +
      "#tab-calculator .bc-star.on{color:var(--high)}" +
      "#tab-calculator .bc-cache{display:inline-block;margin-left:10px;font-size:10px;font-weight:700;letter-spacing:.02em;color:var(--dim);background:var(--panel2);border:1px solid var(--border);border-radius:99px;padding:2px 9px;vertical-align:middle}" +
      "#tab-calculator .bc-cache.fresh{color:var(--good)}" +
      // The banner reloads its own character on click — everything the panel does
      // for a saved chip, for the character already on screen.
      "#tab-calculator .bc-profwrap{cursor:pointer}" +
      "#tab-calculator .bc-profwrap:hover .bc-name a{color:var(--accent)}" +
      // ---- the three headline stats, astrogem's .gr-sum ----
      "#tab-calculator .bc-sum{display:flex;gap:20px;flex-wrap:wrap;align-items:center;margin-top:10px}" +
      // A figure that belongs to a profile we have just switched away from.
      "#tab-calculator .bc-stale{opacity:.38;transition:opacity .12s}" +
      "#tab-calculator .bc-sum .stat{display:flex;flex-direction:column}" +
      "#tab-calculator .bc-sum .stat .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}" +
      "#tab-calculator .bc-sum .stat .v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}" +
      "#tab-calculator .bc-sum .stat .v.acc{color:var(--accent)}" +
      "#tab-calculator .bc-sum .stat .v.gold{color:var(--high)}" +
      "#tab-calculator .bc-rankbadge{display:inline-block;padding:2px 10px;border-radius:99px;font-weight:800;" +
        "font-size:18px;line-height:1.4;color:#fff}" +
      "#tab-calculator .bc-fieldrank{margin-top:6px;font-size:12px;opacity:.75;min-height:15px}" +
      // Read on the left, press on the right (Shizu's mock-up). The cluster keeps
      // its natural width and the identity block takes the rest; under 900px the
      // two stack, because three pill pairs and a name will not share a phone.
      // One column: the banner reads, it no longer presses. The two buttons are
      // on the character board and the bracelet's three settings are in the
      // Grader, so nothing is parked to the right of the name any more.
      "#tab-calculator .bc-hdrgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}" +
      "#tab-calculator .bc-hdrleft{min-width:0}" +
      // THE TRAIT ROWS TAKE THE WHOLE PANEL WIDTH. They used to share it with
      // the granted-slot count in a two-column .bc-traitgrid, and in the
      // Advisor's left column that left them 261px to draw a row that cannot be
      // narrower than 326px — so the row overflowed and the slot pills sat on
      // top of CRIT's active toggle (Shizu, 2026-08-15). The count is up in the
      // top cluster with Role and Grade now, where it belongs.
      // The character / default settings toggle is styled by profile.js, with the
      // rest of the control row it sits in: the Tier List draws the same row, and
      // a "#tab-calculator …" prefix here would have left that copy unstyled.
      // ---- the bracelet panel ----
      ".bc-hdrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}" +
      // An illegal-but-scored state (three combat traits, or fewer than two):
      // the house note, flagged with the bad colour. A warning, not a block.
      ".note.bc-illegal{color:var(--bad);border-left:2px solid var(--bad);padding-left:9px;margin-top:8px}" +
      // ---- the bracelet's two fixed combat traits ---------------------
      // .bc-sl itself is the deck's row shape (profile.js); these are the
      // overrides that make a trait row typed instead of slid.
      //
      // NOT "#tab-calculator …" any more, and that prefix was the whole of
      // Shizu's "the advisor combat traits is ugly" (2026-08-15). The panel is
      // ONE live element that MOVES between this tab and the Advisor (see
      // mountBraceletPanel), so a pane-id prefix dressed the rows here and left
      // them bare over there: the deck's plain .bc-sl grid took the row, the
      // number box stretched to 269px wearing the browser's own white
      // background, and "active" was clipped into a 52px column. Class-scoped,
      // exactly the way profile.js scopes the deck's own sheet, for exactly the
      // same reason. Same for the illegal-state note above.
      //
      // FLEX, not the deck's three-column grid. The per-line worth chip is hung
      // on the row by advisor.js — this file does not build it, and advisor.js
      // is lazy, so on a visit that never opens the Advisor it is not there at
      // all. A fourth grid column would hold a 62px hole open on every one of
      // those visits; a flex row simply closes up. min-height matches the
      // granted-slot rows below so the panel reads as one table.
      // flex-wrap, though the row is meant to hold one line: every cell on it is
      // `flex:0 0 <fixed>` and cannot shrink, so in a box narrower than the
      // 326px they add up to the row used to OVERFLOW its container and print
      // over whatever sat to its right. Wrapping is the honest failure.
      ".bc-sl.bc-trrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-height:44px;margin-bottom:8px}" +
      ".bc-trrow .lb{flex:0 0 74px}" +
      ".bc-trrow input[type=number]{flex:0 0 92px;background:var(--panel2);color:var(--text);border:1px solid var(--border);" +
        "border-radius:6px;padding:5px 7px;font:inherit;font-size:13px;font-variant-numeric:tabular-nums}" +
      ".bc-trrow input[type=number]:focus{outline:1px solid var(--accent)}" +
      ".bc-trrow input:disabled{opacity:.45;cursor:not-allowed}" +
      // What that one line is worth, beside the box it is typed into. Dim and
      // tabular so the three read down as a column rather than as three labels.
      ".bc-trrow .bc-trw{flex:0 0 62px;order:3;text-align:right;font-size:11.5px;font-weight:700;" +
        "color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".bc-trrow .bc-trw.off{opacity:.5}" +
      ".bc-tract{flex:0 0 74px;order:4;padding:4px 8px;font-size:11px;text-align:center}" +
      "@media(max-width:640px){.bc-sl.bc-trrow{gap:6px}.bc-trrow .lb{flex:0 0 62px}" +
        ".bc-trrow input[type=number]{flex:0 0 78px}.bc-trrow .bc-trw{flex:0 0 52px}.bc-tract{flex:0 0 66px}}" +
      // ---- headline cards ----
      "#tab-calculator .bc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px}" +
      "#tab-calculator .bc-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}" +
      "#tab-calculator .bc-card .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);font-weight:700}" +
      "#tab-calculator .bc-card .v{font-size:25px;font-weight:800;letter-spacing:-.02em;margin-top:5px;line-height:1.1}" +
      "#tab-calculator .bc-card .s{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.45}" +
      ".bc-grade{display:inline-block;min-width:26px;text-align:center;padding:1px 7px;border-radius:6px;font-weight:800;font-size:12px;letter-spacing:.02em;line-height:1.5;vertical-align:1px;cursor:help;text-decoration:none}" +
      ".bc-grade.sm{font-size:11px;padding:0 6px}" +
      "#tab-calculator .bc-card .s .bc-gradeof{color:var(--dim)}" +
      "#tab-calculator .bc-card.hero{border-color:var(--accent)}" +
      "#tab-calculator .bc-card .v.gold{color:var(--high)}" +
      "#tab-calculator .bc-card .v.acc{color:var(--accent)}" +
      // ---- the unrolled card's combat-trait pricing ----
      // It carries a control, so it takes two columns where there is room and
      // keeps the slider on its own line under the sentence.
      "#tab-calculator .bc-unrolled{grid-column:span 2}" +
      "@media(max-width:640px){#tab-calculator .bc-unrolled{grid-column:auto}}" +
      "#tab-calculator .bc-ttrow{display:flex;align-items:center;gap:9px;margin-top:9px}" +
      "#tab-calculator .bc-ttrow label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);" +
        "font-weight:700;white-space:nowrap}" +
      "#tab-calculator .bc-ttrow input[type=range]{flex:1 1 auto;min-width:0;accent-color:var(--accent)}" +
      "#tab-calculator .bc-ttrow .chip{flex:0 0 auto;min-width:34px;text-align:right;font-variant-numeric:tabular-nums;" +
        "font-weight:700;font-size:12.5px;color:var(--text)}" +
      "#tab-calculator .bc-ttrefs{margin-top:6px;font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}" +
      "#tab-calculator .bc-ttrefs b{color:var(--text);font-weight:700}" +
      "#tab-calculator .bc-ttrefs .sep{opacity:.5;margin:0 2px}" +
      // The quantile strip, the lock pills, the cut grid and the verdict box went
      // to advisor.js with the panels they dress, under its own av- names. This
      // tab keeps what a bracelet IS: the cards, the breakdown and its warnings.
      "#tab-calculator .bc-tabwrap{overflow-x:auto}" +
      // tr:last-child kills the border on the last row of BOTH sections, so the
      // Total row would float free of the table without this.
      "#tab-calculator tfoot td{border-top:1px solid var(--border)}" +
      "#tab-calculator .bc-warn{color:var(--bad);font-size:12.5px;margin:8px 0}" +
      // ---- the ways in: import panel, character search, screenshot reader ----
      // The search sits beside the import panel where there is room and under it
      // where there is not. minmax(0,…) on both tracks, never a bare 1fr: the
      // import panel holds a row of inputs that must not push the page sideways.
      "#tab-calculator .bc-loadrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,330px);gap:0 12px;align-items:start}" +
      "@media(max-width:900px){#tab-calculator .bc-loadrow{grid-template-columns:minmax(0,1fr)}}" +
      // The search is char-picker.js's, and CharPicker.mount() owns the host's
      // class list, so its frame is set by id.
      "#bc-who{border:1px solid var(--border);border-radius:10px;background:var(--panel);padding:11px 12px;min-width:0;margin:0 0 12px}" +
      "#bc-who .cp-note:empty{display:none}" +
      "#tab-calculator .bc-intakepanel{margin:0 0 12px}" +
      "#tab-calculator .bc-intakepanel .bc-hdrow{margin-bottom:8px}" +
      "#tab-calculator .bc-intakezone{border:2px dashed var(--border);border-radius:10px;padding:12px;text-align:center;" +
        "color:var(--dim);background:var(--panel2);font-size:12.5px;line-height:1.9;transition:border-color .15s,background .15s}" +
      "#tab-calculator .bc-intakezone.drag{border-color:var(--accent);background:rgba(102,199,255,.08);color:var(--text)}" +
      "#tab-calculator .bc-intakezone b{color:var(--text)}" +
      "#tab-calculator .bc-intakestatus{font-size:12px;color:var(--dim);margin-top:6px;min-height:16px}" +
      "#tab-calculator .bc-intakestatus.working{color:var(--accent)}" +
      "#tab-calculator .bc-intakestatus.err{color:var(--bad)}" +
      // The reader's own "N fields need a look, tap the highlighted ones" banner
      // points at highlights this tab does not draw; the list under the reader
      // says the same thing field by field, with a button on each.
      "#bc-intake .bc-strip{display:none!important}" +
      "#tab-calculator .bc-parsed{margin-top:10px;border:1px solid var(--border);border-radius:9px;background:var(--panel2);padding:10px 12px}" +
      "#tab-calculator .bc-parsed .bc-pline{display:flex;gap:9px;align-items:baseline;padding:4px 0;font-size:12.5px;border-bottom:1px solid var(--border)}" +
      "#tab-calculator .bc-parsed .bc-pline:last-of-type{border-bottom:none}" +
      "#tab-calculator .bc-parsed .k{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);min-width:62px}" +
      "#tab-calculator .bc-unconf{color:var(--accent);border-bottom:1px dashed var(--accent)}" +
      "#tab-calculator .bc-okbtn{background:none;border:1px solid var(--border);border-radius:99px;color:var(--dim);" +
        "font:inherit;font-size:10.5px;font-weight:700;padding:1px 9px;cursor:pointer;margin-left:auto}" +
      "#tab-calculator .bc-okbtn:hover{color:var(--text);border-color:var(--accent)}" +
      "</style>";
  }

  /**
   * The hosts, top to bottom, in the order the astrogem grader stacks them:
   *
   *   #bc-import          the character panel — mode pills, the pull row, the
   *                       saved-character grid (bible-import.js fills it)
   *   #bc-refresh-banner  the queue: a thin bar over a cached bracelet, or the
   *                       queued panel. Its own host so the calculator under it
   *                       is never blanked
   *   #bc-loadouts        the Raid / Chaos / Est. Raid pills, where astrogem has
   *                       its preset pills
   *   #bc-charhdr         the character banner: ★, class icon, name, cache pill,
   *                       chips, the three headline stats, the field rank and the
   *                       character's two buttons
   *   #bc-deckhost        the control deck (profile.js builds and owns it)
   *
   * The banner sits ABOVE the deck on purpose: it is who the deck is describing.
   * Every host is empty until something fills it.
   */
  function hostsMarkup() {
    // The ways in first: the import panel with the character search beside it,
    // the screenshot reader under both. Then who was loaded, then the deck.
    return '<div class="bc-loadrow"><div id="bc-import"></div><div id="bc-who"></div></div>' +
      intakeMarkup() +
      '<div id="bc-refresh-banner"></div>' +
      '<div id="bc-loadouts"></div><div id="bc-charhdr"></div><div id="bc-deckhost"></div>';
  }

  /**
   * The Grader — everything that describes the bracelet being scored.
   *
   * #bc-tophost holds role, grade and rolls left, #bc-slotshost the granted-slot
   * count. Those controls used to be adopted into the CHARACTER BANNER's control
   * cluster, which was a mistake with two teeth in it: the banner is rebuilt by
   * renderCharHeader, so moving the rolls slider destroyed the slider under the
   * hand — and with no character loaded the banner is not drawn at all, so the
   * controls vanished from the page entirely. They belong beside the lines they
   * describe (Shizu, 2026-08-11: "move that to the grader so it only interacts
   * with the grader"), and nothing ever rewrites this panel's markup.
   *
   * THE TWO HOSTS SIT IN ONE CLUSTER. Both hold a LIVE element profile.js
   * parents in, so this file must never innerHTML either of them; the cluster
   * around them lays their contents out as one row (profile.js, .bc-topcluster)
   * — Role, Grade, Granted slots, with the rolls track on its own line beneath.
   */
  function braceletMarkup() {
    return '' +
      '<div class="panel" id="bc-braceletpanel">' +
      '  <div class="bc-hdrow"><h2 style="margin:0">Bracelet</h2>' +
      '    <button class="mbtn" id="bc-clear" type="button">Mark as unrolled</button></div>' +
      '  <div class="bc-topcluster">' +
      '    <div id="bc-tophost"></div>' +
      '    <div id="bc-slotshost"></div>' +
      '  </div>' +
      '  <div class="bc-sub" id="bc-slotnote"></div>' +
      // THE TRAIT ROWS GET THE WHOLE WIDTH. The granted-slot count sat beside
      // them from 2026-08-12 on the argument that the two say the same kind of
      // thing — but a trait row is 326px of cells that cannot shrink, and in the
      // Advisor's left column the box holding it is 261px, so it overflowed and
      // printed under the slot pills. The count is in the cluster above now.
      '  <div class="subh"><span id="bc-trhd">Combat traits</span></div>' +
      '  <div id="bc-traits"></div>' +
      '  <div class="subh"><span data-gloss="The lines the bracelet rolled. Leave every slot empty to score it as unrolled.">Granted slots</span></div>' +
      '  <div id="bc-slots"></div>' +
      '  <div id="bc-fixed"></div>' +
      // THE ECONOMY IS HERE, not on the character board (Shizu, 2026-08-12). The
      // gold rate and the baseline are not settings anybody chose — they arrive
      // with whoever was loaded, and they are the one pair a user reaches for
      // WHILE reading the results directly below. Behind the deck's fold, which
      // now shuts on every tab switch, they were neither visible nor findable.
      '  <div class="subh"><span id="bc-econhd" data-gloss="What a percent of damage is worth to you, and the bracelet you would wear instead. Both arrive with a character the moment you load one, and neither is touched by Reset to Default.">Economy</span></div>' +
      '  <div id="bc-econhost"></div>' +
      '</div>';
  }

  /**
   * The methodology block: LAST element in the pane, collapsed, one per tab —
   * the shape the Tier List set and docs/design/copy-rules.md now fixes. Every
   * explanation this tab used to carry inline lives here in full.
   *
   * STATIC on purpose. It is built once, at mount, so a live figure quoted here
   * would go stale the moment the deck moved. It quotes the model, not the
   * solve.
   *
   * It answers "what am I looking at" for the figures on THIS screen. Where the
   * baseline comes from, how each bucket is scored and what the model leaves out
   * are the Method tab's job, and the last line hands over to it.
   */
  function methodHtml() {
    return '<details class="method">' +
      "<summary>How the numbers on this tab are worked out</summary>" +

      "<p><b>Lines multiply, so they are scored in logs.</b> Two lines worth 10% each give 21%, not 20%. " +
      "Each line is scored <code>D = 100 &middot; ln(multiplier)</code>, which turns multiplying into adding: " +
      "line scores sum, and D reads as roughly the percentage gain. The bracelet total converts back once, " +
      "<code>(e^(&Sigma;D/100) &minus; 1) &times; 100</code> &mdash; which is why the Total row lands a shade " +
      "under the sum of the column above it. Hover any figure in that table for the arithmetic behind it.</p>" +

      "<p><b>Current score</b> is what the bracelet on screen is worth against no bracelet at all: both fixed " +
      "combat traits and every effect line, on the character in the deck above. It moves when you change a " +
      "setting, because a line's worth depends on what you already carry &mdash; crit rate is worth nothing to " +
      "a build already at 100%.</p>" +

      "<p><b>Expected final</b> is where the bracelet lands after the remaining rolls, played perfectly. Rolls " +
      "cost silver, not gold, so the tool treats them as free; rolling then always beats stopping, and there is " +
      "no stop-or-carry-on question left to answer. Every outcome of every roll is enumerated and the recursion " +
      "solved backwards from the last roll &mdash; no simulation, so the figure is the model's exact " +
      "expectation. It is an average over every way the rolls can land, not a promise: half of all bracelets " +
      "finish below the median. The Advisor tab draws the whole spread.</p>" +

      "<p><b>Worth</b> is <code>E[max(0, final% &minus; baseline%)] &times; gold per 1%</code>. You are paid " +
      "only by the outcomes that beat the bracelet you would wear instead, weighted by how often they land and " +
      "by how far they clear it. So it is never negative: a bracelet you would not equip is worth nothing, not " +
      "a debt. Both inputs are yours &mdash; the gold rate and the baseline are the <b>Economy</b> pair at the " +
      "foot of the Grader panel. An import sets the rate from the character's combat power and makes the " +
      "bracelet they wear the baseline, scored the way the solver scores its own outcomes and scored again " +
      "whenever the deck or the role moves; <b>Clear</b> puts the baseline back to a slider at 0.</p>" +

      "<p><b>LOCK and REROLL</b> beside a slot come from the solver's best set of locks. A lock is worth buying only " +
      "when the line it holds is scarcer than what a fresh draw would hand you, so the badge does not say this " +
      "line is good &mdash; it says keeping it beats rerolling it, over every roll you have left. One attempt " +
      "rerolls every unlocked slot at once, which is why the advice comes as a set and not slot by slot.</p>" +

      "<p><b>The unrolled price</b> answers what a sealed bracelet is worth to a buyer. The two combat traits " +
      "never reroll, so they are the one part of the bracelet a buyer cannot change: 120/120 and 80/80 at the " +
      "same asking price are two different items. Those traits are a constant the solver adds outside the " +
      "search, so the slider reprices one solve instead of starting another &mdash; which is why it moves under " +
      "the hand.</p>" +

      "<p><b>Where the character comes from.</b> A pulled bracelet is read off a public lostark.bible character " +
      "page and cached, so it shows what that roster last synced there, which can be days behind what the " +
      "player is wearing. Nothing on that page touches your own settings until you press Import Character " +
      "Stats.</p>" +

      "<p>Where the baseline itself comes from, how each damage bucket is scored, which tables the numbers were " +
      "transcribed from and what the model leaves out: the <b>Method</b> tab.</p>" +
      "</details>";
  }

  function tabMarkup() {
    return styleBlock() + hostsMarkup() + '<div id="bc-brhome">' + braceletMarkup() + '</div>' +
      '<section id="bc-results"></section>' + methodHtml();
  }

  // ------------------------------------------------------------------
  // what is left of "input rendering"
  //
  // The control deck's renderers (top row, gear, kit, fight, trait weights,
  // skills, economy, the Advanced fold) all moved to profile.js on 2026-08-11.
  // What stays is the bracelet: its read-out line, its two fixed combat traits,
  // and its granted / fixed rows.
  // ------------------------------------------------------------------

  /**
   * ONE COMBAT-TRAIT LINE, in damage percent, on the profile every tab scores
   * on. The Advisor's per-row chip prints exactly this figure — through the
   * export, not a second copy of it.
   */
  function traitOnePct(k, profile) {
    var v = traitValues()[k];
    if (!v) return 0;
    var one = {};
    one[k] = v;
    return pct(B.traitDamage(one, profile || buildProfile()));
  }

  /**
   * THE FIXED-TRAIT TOTAL the panel's read-out line prints.
   *
   * It is the SUM OF THE PER-LINE FIGURES, unrounded, rounded once at the end —
   * so the line is exactly what the chips beside the trait rows add up to. It
   * used to convert the combined log-space score instead, which is a shade
   * larger (lines multiply), and the line said "+4.80%" over chips reading
   * +2.83% and +1.92% (Shizu, 2026-08-15).
   *
   * The LINE IS THE AUTHORITATIVE TOTAL: it rounds the sum, the chips round
   * each, so the two can differ only by the rounding of the parts and never by
   * a whole hundredth of a point that has no visible source.
   */
  function traitTotalPct(profile) {
    var p = profile || buildProfile(), s = 0, i;
    for (i = 0; i < TRAIT_KEYS.length; i++) s += traitOnePct(TRAIT_KEYS[i], p);
    return s;
  }

  // The live read-out under the bracelet header. Split out so a slider drag can
  // refresh it without rebuilding the fields under the cursor.
  function updateBasicsNote() {
    var note = $("bc-slotnote");
    if (!note) return;
    var base = P.baseStats(), p = buildProfile();
    // Item level to ONE decimal. The second one is noise on a figure that is
    // read at a glance against a number the game shows whole.
    var msg = S.useOverride
      ? "Main stat " + nf(base.mainStatRaw) + " raw · weapon power " + nf(base.weaponPowerRaw) + " raw"
      : "Item level " + fx(P.ilvl(), 1) + " · main stat " + nf(base.mainStatRaw) + " raw · weapon power " + nf(base.weaponPowerRaw) + " raw";
    msg += " · attack power " + nf(B.attackPower(p, 0, 0)) + " · additional damage pool " + fx(B.addDamagePool(p) * 100, 2) + "%";
    msg += " · fixed traits " + signPct(traitTotalPct(p));
    note.textContent = msg + ".";
    // The per-line chips are the same kind of live read-out, and the line above
    // is their sum, so they repaint together.
    paintTraitChips(p);
  }

  /**
   * What one trait line is worth, beside the box it is typed into: the figure
   * the read-out line sums for "fixed traits", through the same traitOnePct, so
   * the chips always add up to it.
   */
  function traitChip(k, profile) {
    var v = traitValues()[k];
    if (!v) return { cls: "bc-trw off", txt: "—", gloss: "Switched off, so this line adds nothing to any score on the page." };
    var d = traitOnePct(k, profile);
    return { cls: "bc-trw", txt: signPct(d),
      gloss: v + " " + TRAIT_LABELS[k] + " is worth " + signPct(d) + " on the character being scored. " +
        "The chips add up to the fixed-traits figure above." };
  }
  function traitChipHtml(k, profile) {
    var c = traitChip(k, profile);
    return '<span class="' + c.cls + '" id="bc-trw-' + k + '" data-gloss="' + esc(c.gloss) + '">' + esc(c.txt) + "</span>";
  }
  /** Repaint the chips where they stand: a keystroke must not rebuild the row it is typed into. */
  function paintTraitChips(profile) {
    var p = profile || buildProfile(), i, k, el, c;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      el = $("bc-trw-" + k);
      if (!el) continue;
      c = traitChip(k, p);
      el.className = c.cls;
      el.textContent = c.txt;
      el.setAttribute("data-gloss", c.gloss);
    }
  }

  // ---- the bracelet's two fixed combat traits ----

  function renderTraits() {
    var box = $("bc-traits");
    if (!box) return;
    var band = traitBand(), h = "", i, k, t;
    var hd = $("bc-trhd");
    if (hd) hd.setAttribute("data-gloss", "The two lines every bracelet arrives with, " + band[0] + "–" + band[1] +
      " points each on " + gradeLabel() + ". They never reroll, so they are a constant on every score below.");
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      t = S.traits[k];
      // Typed, not slid: these are numbers read straight off the bracelet.
      h += '<div class="bc-sl bc-trrow">' +
        '<span class="lb" data-gloss="' + esc(TRAIT_GLOSS[k]) + '">' + esc(TRAIT_LABELS[k]) + "</span>" +
        '<input id="bc-tr-' + k + '" type="number" data-tr="' + k + '"' +
          ' min="' + band[0] + '" max="' + band[1] + '" step="1" value="' + esc(t.v) + '"' +
          (t.on ? "" : " disabled") + ">" +
        '<button type="button" class="mbtn bc-tgl bc-tract" data-tron="' + k + '" aria-pressed="' + (t.on ? "true" : "false") + '"' +
          ' data-gloss="' + (t.on
            ? "Switch off if your bracelet does not carry this line."
            : "Switch on if your bracelet carries this line.") + '">' +
          (t.on ? "active" : "off") + "</button>" +
        // The chip rides third on the row (CSS order), between the box and the switch.
        traitChipHtml(k) +
        "</div>";
    }
    // The "two combat traits, 61-120, never reroll" note is gone (Shizu,
    // 2026-08-12). The three rows already show two switched on and the bands
    // clamp the inputs, so the sentence was describing what the control does.
    // The illegal-state warnings below still speak up, because those say
    // something the controls do not.
    // Nothing is switched off behind the user's back; the panel just says when
    // the set on screen could not exist in game. The score counts it either way.
    var n = P.traitOnCount();
    if (n > 2) {
      h += '<div class="note bc-illegal">Three combat traits are active. A real bracelet only ever carries two, ' +
        "so this bracelet cannot exist in game &mdash; every score below still counts all three exactly as entered.</div>";
    } else if (n < 2) {
      h += '<div class="note bc-illegal">' + (n === 1 ? "Only one combat trait is active" : "No combat trait is active") +
        ". Every bracelet carries two, so this one is short a line &mdash; the score counts only what is on.</div>";
    }
    box.innerHTML = h;
  }

  /**
   * Redraw everything on screen that is NOT a deck control. Called after any
   * change Profile announces, and after this file rewrites the rows itself.
   */
  function renderBracelet() {
    renderTraits();
    renderSlots();
    renderFixedRows();
    updateBasicsNote();
    renderCharHeader();          // its grade and rolls-left chips read the same state
  }

  function rowMarkup(idx, row, prefix, label) {
    var grade = S.grade;
    var isBasic = row.fam.indexOf("basic:") === 0;
    var isSpecial = row.fam.indexOf("sp:") === 0;
    var famKey = isBasic ? row.fam.slice(6) : "mainStat";
    var msValue = (row.value === null || row.value === undefined || row.value === "") ? defaultBasicValue(grade, famKey) : num(row.value, defaultBasicValue(grade, famKey));
    // Granted rows fold the F families into one "Junk Line"; the
    // Advanced fixed-line editor ("bc-f") keeps every family by name, because a
    // fixed line's category is load-bearing for the pool (see junkFamPool). The
    // family this row holds is passed in so the fold can never hide it.
    var groups = familyOptions(grade, prefix !== "bc-f", row.fam);
    var rg = msRange(grade, famKey);

    // FAMILY FIRST, and it takes every pixel the row does not need for the rest.
    // The rarity box led the row until 2026-08-15, on the argument that the eye
    // should read the short box first — but it is the FAMILY that is being
    // chosen, and in the Advisor's narrow left column the fixed rarity box left
    // the family 124px to say "On-hit enemy Crit DMG Resist −4.8%; ally AP buff
    // +3%" in. It read "C · W…". The rarity box is fixed and second now (see
    // .bc-slot in profile.js's sheet); the family cell is what stretches.
    //
    // The advice, on the row it applies to. The lock table says the same thing
    // in aggregate, but a LOCK/REROLL badge beside the line you are looking at
    // is what people actually read (Shizu, 2026-08-12).
    // A LOCKED ROW IS GREEN, all of it — badge, family, rarity (Shizu,
    // 2026-08-15). The class rides on the row rather than on the badge so the
    // whole line reads as the thing being kept; paintSlotAdvice re-toggles it
    // when the solve lands, and the Advisor prints the same green on its own
    // lock rows.
    var adv = prefix === "bc-r" ? slotAdvice(idx) : null;
    var h = '<div class="bc-slot' + (isLock(adv) ? " bc-locked" : "") + '">' +
      '<div class="sn" id="' + prefix + "-sn-" + idx + '">' + esc(label) +
      advBadge(adv) +
      "</div>";
    h += '<div class="fld bc-famcell">' + pickerHtml(prefix + "-fam-" + idx, groups, row.fam, grade) + "</div>";
    // An empty cell collapses (`:empty` in the sheet), so a row with no rarity
    // box and no value box gives the whole of that room to the family.
    if (isSpecial) {
      var fam = DATA.SPECIAL_BY_ID[Number(row.fam.slice(3))];
      h += '<div class="fld bc-tiercell">' + (fam ? tierHtml(prefix + "-tier-" + idx, fam, grade, row.tier || "mid") : "") + "</div>";
    } else {
      h += '<div class="bc-tiercell"></div>';
    }
    if (isBasic) {
      h += '<div class="fld bc-valcell"><input type="number" id="' + prefix + "-val-" + idx + '" step="1" min="' + rg[0] + '" max="' + rg[1] +
        '" value="' + msValue + '" data-gloss="The number this stat line actually rolled. The official bands run ' +
        rg[0] + "–" + rg[1] + ' on ' + (grade === "relic" ? "Relic" : "Ancient") + '."></div>';
    } else {
      h += '<div class="bc-valcell"></div>';
    }
    return h + "</div>";
  }

  /**
   * LOCK or REROLL for one granted slot, from the solver's best lock set.
   *
   * ONE VERB FOR ONE ACT (Shizu, 2026-08-15). The badges said KEEP and ROLL,
   * the table beside them said lock and reroll, and the padlock in game is a
   * lock — three names for two decisions. KEEP is spoken for: it is the other
   * half of the keep-or-replace flow, which is a different question entirely.
   *
   * Null when there is nothing to advise: no solve yet, no rolls left, or an
   * empty slot. Silence beats a confident badge on a bracelet the solver has
   * not looked at.
   */
  function slotAdvice(idx) {
    if (!lastSolve || !S.rollsLeft) return null;
    var row = S.rows[idx];
    if (!row || !row.fam || row.fam === "none") return null;
    if (!lastSolve.bestLockMask) return null;
    var flags = locksFromKeys(lastSolve.bestLockMask.lockedKeys, grantedLines(), S.grade, buildProfile());
    if (!flags || flags.length <= idx) return null;
    return flags[idx]
      ? { txt: "LOCK", cls: "keep", tip: "Lock this slot before your next roll." }
      : { txt: "REROLL", cls: "roll", tip: "Leave this one unlocked — one attempt rerolls every unlocked slot together." };
  }

  /** The badge itself, or "" for a slot with nothing to advise. */
  function advBadge(adv) {
    if (!adv) return "";
    return ' <span class="bc-adv ' + adv.cls + '" data-gloss="' + esc(adv.tip) + '">' + adv.txt + "</span>";
  }

  /** Does this advice say LOCK? The one test the green row is painted from. */
  function isLock(adv) { return !!(adv && adv.cls === "keep"); }

  /**
   * The badges, repainted in place.
   *
   * renderSlots draws them, but it runs when the BRACELET changes and the solve
   * that decides them lands a second or three later — so drawn once and never
   * again they simply never appeared. This rewrites the label cell alone, so the
   * pickers under the cursor are not rebuilt, and it is honest in every state:
   * with no solve, no rolls or an empty slot, slotAdvice returns null and the
   * badge comes off.
   */
  function paintSlotAdvice() {
    for (var i = 0; i < S.slots; i++) {
      var el = $("bc-r-sn-" + i);
      if (!el) continue;
      var adv = slotAdvice(i);
      el.innerHTML = esc("Slot " + (i + 1)) + advBadge(adv);
      // The green row, repainted with the badge that decides it — a row left
      // green after the solver stopped recommending the lock is a lie.
      var row = el.parentNode;
      if (row && row.classList) row.classList.toggle("bc-locked", isLock(adv));
    }
  }

  function renderSlots() {
    var h = "", i;
    for (i = 0; i < S.slots; i++) h += rowMarkup(i, S.rows[i], "bc-r", "Slot " + (i + 1));
    $("bc-slots").innerHTML = h;
  }

  function renderFixedRows() {
    var box = $("bc-fixedrows");
    if (!box) return;
    var h = "", i;
    for (i = 0; i < S.fixedRows.length; i++) h += rowMarkup(i, S.fixedRows[i], "bc-f", "Fixed " + (i + 1));
    if (!S.fixedRows.length) h = '<div class="note">No fixed lines set.</div>';
    box.innerHTML = h;
  }

  // ------------------------------------------------------------------
  // results
  // ------------------------------------------------------------------

  function lineLabel(line, grade) {
    if (!line) return "—";
    if (line.junk) return "Junk Line";                  // the stand-in family is an implementation detail
    if (line.cat === "basic") return (line.family === "mainStat" ? "Str / Dex / Int +" : "Vitality +") + nf(line.value);
    if (line.cat === "trait") {
      var t = null, i;
      for (i = 0; i < DATA.TRAITS.families.length; i++) if (DATA.TRAITS.families[i].key === line.family) t = DATA.TRAITS.families[i];
      return (t ? t.label : line.family) + " (combat trait)";
    }
    var fam = DATA.SPECIAL_BY_ID[line.family];
    if (!fam) return "unknown";
    var vals = fam.values[grade][line.tier];
    return fam.label + " · " + tierWord(line.tier) + " (" + vals.join(" / ") + ")";
  }

  /**
   * The advisor reports locks as solver atom keys. Walk them back onto the slots
   * on screen: greedy match, because two slots CAN hold the same key only when
   * they are both junk, and junk is never locked.
   */
  function locksFromKeys(keys, lines, grade, profile) {
    var out = [], used = {}, i, j;
    for (i = 0; i < lines.length; i++) out.push(false);
    for (i = 0; i < keys.length; i++) {
      for (j = 0; j < lines.length; j++) {
        if (used[j]) continue;
        if (stateKeyOf(lines[j], grade, profile) === keys[i]) { used[j] = 1; out[j] = true; break; }
      }
    }
    return out;
  }

  /**
   * The letter and 0-100 score the leaderboard and the profiles put on this
   * same bracelet — one ladder everywhere (Shizu, 2026-09-24: "we should show
   * the grade on the calculator"). Null for an unrolled bracelet: its lines
   * are not rolled yet, so a grade would be the traits alone, which misleads.
   */
  function gradeOf(res, profile) {
    if (!res || res.unrolled) return null;
    return gradeOfSet(S.grade, grantedLines(), traitValues(), profile);
  }
  /**
   * The same ladder for ANY bracelet: its effect lines (granted and fixed, never
   * the two traits), its trait points, its grade. The baseline bracelet is
   * graded through here, so a character's worn bracelet carries the letter the
   * Current score card gives the same bracelet.
   */
  function gradeOfSet(grade, lines, traits, profile) {
    var SR = window.Subrank;
    if (!SR) return null;
    try {
      var g = SR.braceletScore({ grade: grade, lines: lines, traits: traits, profile: profile });
      var col = SR.colorOf(g.band.key, g.isPerfect);
      var sup = profile && profile.role === "support";
      return {
        key: g.band.key, score: g.score, bg: col.bg, fg: col.fg,
        gloss: "Grade " + fx(g.score, 1) + " out of 100, subrank " + g.band.key + " — the ladder the leaderboard and " +
          "the profiles use. 0 is the worst real bracelet: both traits at the bottom of the band and three lines " +
          "worth nothing. 100 is both traits at 110 with the three best distinct families at Epic. Read on the " +
          (sup ? "support ladder, cut to the same rarities as the damage dealer's." : "damage dealer's ladder.")
      };
    } catch (e) { return null; }
  }
  function gradeBadge(gr, small) {
    return '<span class="bc-grade' + (small ? " sm" : "") + '" style="background:' + gr.bg + ';color:' + gr.fg +
      '" data-gloss="' + esc(gr.gloss) + '">' + esc(gr.key) + "</span>";
  }
  function gradeLineHtml(gr) {
    if (!gr) return "";
    return '<div class="s">' + gradeBadge(gr, false) + " " + fx(gr.score, 1) +
      '<span class="bc-gradeof" data-gloss="' + esc(gr.gloss) + '"> of 100</span></div>';
  }

  function cardsHtml(res, profile) {
    var curPct = pct(res.currentScore), finPct = pct(res.expectedFinal);
    var gr = gradeOf(res, profile);
    var w = worthOf(res, 0);
    var h = '<div class="bc-cards">';
    // Current score is the hero card: it is what the bracelet IS. Expected final
    // is a projection, and leading with a projection made people read it as the
    // number they already had (Shizu, 2026-08-12).
    //
    // Each card is a label, a number and a unit. What the number MEANS rides in
    // the label's gloss; the working is in the method block at the foot of the
    // tab (docs/design/copy-rules.md). A sub-line that only restates its own
    // tooltip is cut, and cut with its element rather than emptied — a hole in
    // the layout where a sentence used to be is worse than either (rule 6).
    h += '<div class="bc-card hero"><div class="k" data-gloss="What the bracelet on screen is worth in damage over no bracelet at all: every effect line and both combat traits, combined.">Current score</div><div class="v acc">' + fx(curPct, 2) +
      "%</div>" + gradeLineHtml(gr) + "</div>";
    h += '<div class="bc-card"><div class="k" data-gloss="The average score this bracelet finishes at once the remaining rolls are played perfectly. Rolls are free, so rolling always beats stopping. An average, not a promise.">Expected final</div><div class="v">' + fx(finPct, 2) +
      '%</div><div class="s">' + (S.rollsLeft ? "after " + S.rollsLeft + " roll" + (S.rollsLeft === 1 ? "" : "s") : "no rolls left") + "</div></div>";
    var wn = worthNote(w);
    h += '<div class="bc-card"><div class="k" data-gloss="' + esc(worthGloss(w)) + '">Worth</div>' +
      '<div class="v gold">' + (w ? gold(w.gold) : "—") + "</div>" +
      (wn ? '<div class="s">' + esc(wn) + "</div>" : "") + "</div>";
    if (freshSolve) h += unrolledCardHtml();
    return h + "</div>";
  }

  // ------------------------------------------------------------------
  // pricing an unrolled bracelet by its combat traits
  //
  // The two combat traits are the one part of a bracelet a buyer CANNOT change:
  // they never reroll. So 120/120 and 80/80 are two very different things at the
  // same asking price, and the card used to quote both the same number — the
  // question the whole tool exists to answer, answered wrong (Shizu, 2026-08-11;
  // docs/design/ui-overhaul.md).
  //
  // Repricing is free. traitDamage is a CONSTANT offset the solver adds outside
  // the DP (model/bracelet.js: "a constant on every reachable state"), so every
  // outcome in the solved distribution simply shifts by the difference between
  // the trait pair you are pricing and the one that was solved. No re-solve, no
  // worker round trip, and the slider stays live under the hand.
  // ------------------------------------------------------------------

  // null means "follow the bracelet's own traits"; a number is the user's pick,
  // PER LINE.
  //
  // It held the TOTAL until 2026-08-14, which made the pair on the card depend on
  // how many trait lines happened to be switched on: park the slider at 90/90,
  // switch a third trait on, and 180 points had three lines to cover, so the card
  // rescaled itself to 61/61/61 under the user's hand. What the control shows is
  // what it stores now, and the count is only ever multiplied back in where a
  // total is genuinely wanted.
  var traitEachUI = null;

  /** How many trait lines the slider's value covers. Never zero: an empty bracelet still prices as a pair. */
  function traitLineCount() { return P.traitOnCount() || 2; }
  /** What the bracelet on screen carries, per line — its own lines averaged. */
  function traitEachNow() {
    var v = traitValues(), s = 0, n = 0, i, k;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      if (S.traits[k] && S.traits[k].on) { s += num(v[k], 0); n++; }
    }
    return n ? s / n : 0;
  }
  /** The per-line value being priced, always inside the grade's own band. */
  function traitEachValue() {
    var band = traitBand();
    return clamp(Math.round(traitEachUI === null ? traitEachNow() : traitEachUI), band[0], band[1]);
  }

  /**
   * The trait pair the slider is pricing: EVERY ACTIVE LINE AT THE SAME VALUE.
   *
   * The slider used to hold a total and spread it over the lines in whatever
   * ratio they were already in, so it could price 120/60 as readily as 90/90.
   * It no longer can, because a lopsided pair is never what you want to buy
   * (Shizu, 2026-08-14). The gold-per-damage work fitted the auction house's own
   * listings and found that at a FIXED TOTAL, lopsided costs more: 120/80 asks
   * 25,118 where 100/100 asks 18,291. The balanced pair is the cheapest way to
   * buy any given total, so an even pair is the only one worth pricing.
   *
   * The value is still clamped to the grade's band — a bracelet the game cannot
   * produce must not be priced as if it could.
   */
  function traitsEven(each) {
    var out = { crit: 0, spec: 0, swift: 0 }, band = traitBand(), v = clamp(num(each, 0), band[0], band[1]), i, k;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      if (S.traits[k] && S.traits[k].on) out[k] = v;
    }
    return out;
  }

  /** The bracelet's OWN traits, lopsided or not — what the card shows before you touch the slider. */
  function traitsAsWorn() {
    var out = { crit: 0, spec: 0, swift: 0 }, i, k;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      if (S.traits[k] && S.traits[k].on) out[k] = num(S.traits[k].v, 0);
    }
    return out;
  }

  /**
   * What to price. `worn` asks for the bracelet's own pair, lopsided or not —
   * true only for the headline figure while the slider has not been touched.
   * Every other caller passes a per-line value and gets an even pair.
   */
  function traitsPriced(each, worn) {
    return worn ? traitsAsWorn() : traitsEven(each);
  }

  /**
   * What a sealed bracelet with this combat-trait total is worth, in gold —
   * worthOf() over the UNROLLED solve, shifted to the trait pair being priced.
   *
   * The traits are a constant the solver adds outside the DP, so every outcome in
   * the solved distribution simply moves by the difference between the pair on
   * the slider and the pair that was solved. No re-solve, no worker round trip.
   *
   * This function used to carry the truncated expectation itself, including the
   * thinned-cdf midpoint correction — the one honest worth in the file while the
   * headline figures ran a difference of means. Both now go through worthOf,
   * which is where that arithmetic and its reasoning live.
   */
  // APPROXIMATION under the 0.4.x joint pool: shifting a solved distribution by
  // a trait-damage DELTA treats traits as additive, which they no longer exactly
  // are — the pooled crit factor bends near the 100% cap. The error is zero for
  // Spec/Swift-weighted pairs and only bites when the priced pair pushes crit to
  // saturation, where it reads slightly high. Re-solving per slider step is the
  // exact answer at ~3s a step; not worth it for a preview figure.
  function unrolledWorthAt(each, worn) {
    if (!freshSolve) return null;
    var prof = buildProfile();
    var shift = B.traitDamage(traitsPriced(each, worn), prof) - num(freshSolve.traitDamage, 0);
    var w = worthOf(freshSolve, shift);          // the same truncated expectation every worth uses
    return w ? w.gold : null;
  }

  /**
   * Three even pairs down from the cap, twenty points a line apart, so the shape
   * of the curve reads at a glance. Returned as PER-LINE values: 120, 100, 80.
   */
  function traitRefPoints() {
    var band = traitBand(), out = [], v, i;
    for (i = 0; i < 3; i++) {
      v = band[1] - i * 20;
      if (v < band[0]) break;
      out.push(v);
    }
    return out;
  }

  function unrolledCardHtml() {
    var each = traitEachValue();
    var w = unrolledWorthAt(each, traitEachUI === null);
    var refs = traitRefPoints(), rh = "", i;
    for (i = 0; i < refs.length; i++) {
      var rw = unrolledWorthAt(refs[i]);
      rh += (i ? ' <span class="sep">·</span> ' : "") + '<b>' + traitPairLabel(refs[i]) + "</b> " +
        (rw == null ? "—" : gold(rw));
    }
    var band = traitBand();
    return '<div class="bc-card bc-unrolled">' +
      '<div class="k" data-gloss="What a sealed bracelet of this grade and slot count is worth before anyone opens it. The two combat traits never reroll, so they are the part a buyer cannot change — slide to price a different pair.">Unrolled, ' +
      S.slots + " slots</div>" +
      '<div class="v gold" id="bc-tt-val">' + (w == null ? "—" : gold(w)) + "</div>" +
      '<div class="s" id="bc-tt-say">' + unrolledSayHtml(each) + "</div>" +
      '<div class="bc-ttrow">' +
      '<label for="bc-tt" data-gloss="The fixed combat traits, both at the same value. ' +
      (S.grade === "relic" ? "Relic" : "Ancient") + " lines run " + band[0] + "&ndash;" + band[1] +
      ' points each. Only even pairs are priced: at the same total a lopsided pair costs MORE on the auction house — 120/80 asks about 25,100 gold where 100/100 asks 18,300 — so the even pair is always the cheaper way to buy a given total.">Combat traits, each</label>' +
      '<input id="bc-tt" type="range" min="' + band[0] + '" max="' + band[1] + '" step="1" value="' + each + '">' +
      '<span class="chip" id="bc-tt-chip">' + traitPairLabel(each) + "</span></div>" +
      '<div class="bc-ttrefs" id="bc-tt-refs" data-gloss="The same price at three lower pairs, so the shape of the curve reads without dragging.">' + rh + "</div>" +
      "</div>";
  }

  /** "90 / 90" for the active line count, or just "90" if only one is on. */
  function traitPairLabel(each) {
    var n = traitLineCount(), out = [], i;
    for (i = 0; i < n; i++) out.push(each);
    return out.join(" / ");
  }

  /**
   * The sub-line under the price. Grade, slots and rolls are all on controls
   * overhead, so the card does not repeat them: what it shows is WHICH trait
   * lines are being priced, which the slider's bare number does not — and, when
   * it is following the bracelet rather than the slider, that provenance.
   */
  function unrolledSayHtml(each) {
    var tv = traitsPriced(each, traitEachUI === null), parts = [], i, k;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      if (tv[k] > 0) parts.push(TRAIT_LABELS[k] + " " + Math.round(tv[k]));
    }
    return esc(parts.length ? parts.join(" / ") : "no combat traits") +
      (traitEachUI === null ? " · as on this bracelet" : "");
  }

  /** Slider moved: repaint the three numbers, never the card under the cursor. */
  function paintTraitTotal() {
    var each = traitEachValue(), w = unrolledWorthAt(each, traitEachUI === null);
    var c = $("bc-tt-chip"); if (c) c.textContent = traitPairLabel(each);
    var v = $("bc-tt-val"); if (v) v.textContent = (w == null ? "—" : gold(w));
    var s = $("bc-tt-say"); if (s) s.innerHTML = unrolledSayHtml(each);
  }

  /** One row per active combat trait, with the arithmetic in its tooltip. */
  function traitRows(profile) {
    var tv = traitValues(), out = [], i, k, one;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      if (!tv[k]) continue;
      one = {};
      one[k] = tv[k];
      var d = B.traitDamage(one, profile), why;
      if (k === "crit") {
        var pp = tv[k] * B.TRAIT_CRIT_PP_PER_POINT;
        why = tv[k] + " Crit converts at 25 points of crit rate per 699 trait points = +" + fx(pp, 2) +
          " pp crit rate, worth " + signPct(pct(d)) + " once your skills' crit rate and crit damage are applied.";
      } else {
        why = tv[k] + " " + TRAIT_LABELS[k] + " at " + fx(num(k === "spec" ? S.fight.wSpec : S.fight.wSwift, 0), 1) +
          "% per 100 points = " + fx(d, 2) + " points of damage.";
      }
      out.push({ label: TRAIT_LABELS[k] + " " + tv[k], damage: d, why: why });
    }
    return out;
  }

  function breakdownHtml(profile, lines, res) {
    var all = fixedLines().concat(lines);
    var traits = traitRows(profile);
    if (!all.length && !traits.length) return "";
    var h = '<div class="panel"><h2 style="margin-top:0">Line by line</h2><div class="bc-tabwrap"><table>' +
      '<thead><tr><th>Slot</th><th>Line</th><th class="num">Damage</th><th class="num">Share</th></tr></thead><tbody>';
    var total = 0, i, ds = [];
    for (i = 0; i < traits.length; i++) total += traits[i].damage;
    for (i = 0; i < all.length; i++) { var d = B.lineDamage(all[i], S.grade, profile); ds.push(d); total += d; }
    function shareCell(x) { return '<td class="num">' + (total > 1e-9 ? fx(x / total * 100, 0) + "%" : "—") + "</td>"; }
    for (i = 0; i < traits.length; i++) {
      h += "<tr><td>Trait " + (i + 1) + "</td><td>" + esc(traits[i].label) + "</td>" +
        '<td class="num"><span data-gloss="' + esc(traits[i].why) + '">' + signPct(pct(traits[i].damage)) + "</span></td>" +
        shareCell(traits[i].damage) + "</tr>";
    }
    var nFixed = fixedLines().length;
    for (i = 0; i < all.length; i++) {
      var lbl = i < nFixed ? "Fixed " + (i + 1) : "Slot " + (i - nFixed + 1);
      h += "<tr><td>" + lbl + "</td><td>" + esc(lineLabel(all[i], S.grade)) + '</td>' +
        '<td class="num"><span data-gloss="' + esc(explainLine(all[i], S.grade, profile)) + '">' + signPct(pct(ds[i])) + "</span></td>" +
        shareCell(ds[i]) + "</tr>";
    }
    h += "</tbody>";
    // The total is a ROW, not a paragraph under the table. Why it comes in under
    // the column sum is a tooltip; the arithmetic is in the method block.
    h += '<tfoot><tr><td colspan="2"><span data-gloss="Lines multiply, they do not add. Each is scored D = 100·ln(multiplier) and the total converts back once, (e^(ΣD/100) − 1) × 100 — so it lands a shade under the sum of the column above.">Total</span></td>' +
      '<td class="num"><b>' + signPct(pct(total)) + "</b></td>" + shareCell(total) + "</tr></tfoot>";
    h += "</table></div></div>";
    return h;
  }

  function renderResults(profile, err) {
    var box = $("bc-results");
    if (!box) return;
    paintSlotAdvice();         // the solve this paint is reporting is what decides them
    // Whatever this paint puts up is current — a fresh answer, a warning or the
    // "Solving…" placeholder. Every one of them is the tool's answer to the
    // question being asked now, so nothing is left dimmed.
    markStale(false);
    if (err) {
      box.innerHTML = '<div class="panel"><div class="bc-warn">' + esc(err) + "</div></div>";
      return;
    }
    if (isPartial()) {
      box.innerHTML = '<div class="panel"><div class="bc-warn">Fill every granted slot, or leave them all empty for an unrolled bracelet — a half-filled bracelet is not a state the game can be in.</div></div>';
      return;
    }
    if (!lastSolve) {
      box.innerHTML = '<div class="panel"><div class="note">Solving…</div></div>';
      return;
    }
    var lines = grantedLines();
    // The roll ADVICE and the cut flow are advisor.js's, and so is the code that
    // draws them — this file's stranded copies went on 2026-08-14. The Calculator
    // keeps what a bracelet IS: its lines, its score, its worth and the breakdown.
    box.innerHTML = cardsHtml(lastSolve, profile) +
      breakdownHtml(profile, lines, lastSolve);
    paintCharStats();          // the banner's headline stats read the same solve
  }

  /**
   * Dim every figure that is about to be replaced.
   *
   * A solve is a second or three, and until it lands the numbers on screen were
   * computed on a profile the user has already left — so a change looked like it
   * did nothing at all (Shizu, 2026-08-11: the old settings toggle "does nothing
   * visible"). It did: it just said so three seconds later, in numbers that often
   * move only in the second decimal. Dimming them is the tool admitting they are
   * stale. recompute() turns it on whenever the solve key has moved, and every
   * paint turns it off.
   */
  function markStale(on) {
    var els = [document.querySelector("#bc-charhdr .bc-sum"), $("bc-results")], i, e;
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (!e) continue;
      e.className = String(e.className).replace(/\s*\bbc-stale\b/g, "") + (on ? " bc-stale" : "");
    }
  }

  /**
   * Refresh the two LIVE figures in the character banner in place. In place,
   * because a full renderCharHeader would rebuild the rank badge and the field
   * rank too, and those are async — the banner would blink on every solve.
   */
  function paintCharStats() {
    if (!lastSolve) return;
    var p = $("bc-sum-pct");
    if (p) {
      var gr = gradeOf(lastSolve, buildProfile());
      p.innerHTML = (gr ? gradeBadge(gr, true) + " " : "") + fx(pct(lastSolve.currentScore), 2) + "%";
    }
    paintWorthStat(lastSolve);
  }

  function gradeLabel() { return S.grade === "relic" ? "Relic" : "Ancient"; }

  /**
   * The banner's two BRACELET chips, refreshed where they stand. The controls
   * behind them are in the Grader, and a full renderCharHeader on every step of
   * the rolls slider used to destroy the element being dragged.
   */
  function paintCharChips() {
    var g = $("bc-chip-grade");
    if (g) g.textContent = gradeLabel();
    var r = $("bc-chip-rolls");
    if (r) r.innerHTML = "rolls left <b>" + S.rollsLeft + "</b>";
  }

  /**
   * The banner's WORTH figure and the tooltip that says what it means. The number
   * alone is only half the story — the other half is how often this bracelet ever
   * clears the baseline — and the banner has no room for a second line, so the
   * odds ride in the gloss on the label. The card on the Calculator says it in
   * prose, where there is room.
   */
  function paintWorthStat(res) {
    var el = $("bc-sum-worth");
    if (!el) return;
    var w = res ? worthOf(res, 0) : null;
    el.textContent = w ? gold(w.gold) : "—";
    var k = $("bc-sum-worthk");
    if (k) k.setAttribute("data-gloss", worthGloss(w));
  }

  // ------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------

  /** Rebuild markup, then put the cursor back on the element it was on. */
  function keepFocus(fn) {
    var a = document.activeElement, id = (a && a.id) ? a.id : null;
    fn();
    if (id) { var el = $(id); if (el && el.focus) el.focus(); }
  }
  /**
   * Picking a family has to redraw its row — that is where the tier dropdown and
   * the value box appear. Only a half-typed NUMBER is worth protecting: rebuild
   * that and the keystroke is lost.
   */
  function redrawSlots() {
    var a = document.activeElement, box = $("bc-slots");
    if (box && a && box.contains(a) && a.tagName === "INPUT") return;
    keepFocus(renderSlots);
  }
  /**
   * The cheap live parts, refreshed on every edit: the read-out line under the
   * bracelet header and the priced pickers. The deck redraws itself.
   */
  function redrawLive() {
    updateBasicsNote();
    redrawSlots();
  }

  /** A segmented/toggle press solves at once — no debounce to sit through. */
  function solveNow() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    recompute();
  }

  /**
   * Profile said something moved. The deck has already redrawn itself and
   * persisted; this is the Calculator catching up.
   *
   *   d.shape      grade / slots / the override moved, or a whole state was set:
   *                the bracelet's own rows and trait band change with it
   *   d.reset      the state went back to defaults, so every cached solve is for
   *                a bracelet that no longer exists
   *   d.immediate  a press rather than a drag — solve now instead of debouncing
   */
  function onProfileChange(d) {
    d = d || {};
    // Either Reset ends the page's way back to the profile the visitor came
    // from (index.html, LoseiiBack).
    if (d.reset && window.LoseiiBack) window.LoseiiBack.clear();
    if (d.reset) {
      cache = {}; cacheOrder = []; sideCache = {}; sideOrder = [];
      freshSolve = null; lastSolve = null; freshSolveKey = null; lastSolveKey = null; workerCtxKey = null;
    }
    if (d.shape || d.reset) {
      // Grade moves the trait band, so a value picked under the old one is not a
      // legal one any more: go back to following the bracelet's own traits.
      traitEachUI = null;
      keepFocus(renderBracelet);
    } else {
      redrawLive();
      // Two of the Grader's settings also READ OUT in the banner's chips. Repaint
      // those two chips only: renderCharHeader rebuilds the banner wholesale, and
      // this path runs on every step of a drag.
      if (d.path === "rollsLeft" || d.path === "grade") paintCharChips();
    }
    // "Import Character Stats" just rewrote the left column: every number on
    // screen is on a different profile now, so the banner's figures and the
    // priced pickers both have to follow. The dimming is recompute's, below —
    // an import is `immediate`, so the solve is scheduled in the same tick.
    if (d.imported) { renderCharHeader(); redrawLive(); }
    if (d.immediate) solveNow(); else schedule();
  }

  // Granted and fixed rows share one delegated handler, keyed by the id prefix
  // the row was rendered with. There was a third prefix, bc-n, for the cut
  // flow's rolled rows; the cut lives on the Advisor tab now and draws its own
  // rows as av-n-*, so the pattern below deliberately does not match an n.
  function rowsFor(prefix) {
    return prefix === "bc-f" ? S.fixedRows : S.rows;
  }

  function handleRowEvent(el) {
    var id = el.id || "";
    var m = /^(bc-[rf])-(fam|tier|val)-(\d+)$/.exec(id);
    if (!m) return false;
    var rows = rowsFor(m[1]), i = Number(m[3]), row = rows[i];
    if (!row) return false;
    if (m[2] === "fam") {
      row.fam = el.value;
      if (row.fam === JUNK) row.value = null;               // a junk line has no number and no rarity
      if (row.fam.indexOf("basic:") === 0 && (row.value === null || row.value === undefined || row.value === "")) {
        row.value = defaultBasicValue(S.grade, row.fam.slice(6));
      }
      // Repaint the closed control at once: every caller re-renders the row
      // afterwards, but not before the browser has painted the new selection.
      var lt = letterOf(row.fam, S.grade);
      el.style.color = lt ? GRADE_COLOR[lt] : "var(--text)";
      // A different bracelet: the Advisor's padlocks were chosen for the old one.
      if (m[1] === "bc-r") S.locks = null;
    } else if (m[2] === "tier") {
      row.tier = el.value;
    } else {
      row.value = num(el.value, row.value);
    }
    return true;
  }

  function bindBody() {
    // The document, not the pane: the Advanced fold's fixed-line rows are drawn
    // by this file but live inside the deck, and the deck can be re-parented
    // into another tab at any moment. Every branch below is gated on an id or a
    // data- attribute only this file emits, so a wider net costs nothing.
    var root = document;
    root.addEventListener("change", function (e) {
      if (!handleRowEvent(e.target)) return;
      save();
      if ((e.target.id || "").slice(0, 4) === "bc-f") keepFocus(renderFixedRows);
      else redrawSlots();
      schedule();
      announceBracelet();
    });
    root.addEventListener("input", function (e) {
      var id = e.target.id || "", tr;
      if (/^bc-[rf]-val-\d+$/.test(id)) { handleRowEvent(e.target); save(); schedule(); announceBracelet(); return; }
      // The unrolled card's combat-trait slider. It changes NOTHING in the state
      // and needs no solve — it reprices the distribution already in hand — so
      // it repaints three numbers and stops there.
      if (id === "bc-tt") {
        // The control is PER LINE and so is the state, so switching a trait on
        // or off cannot move the pair the user picked.
        var tb = traitBand();
        traitEachUI = clamp(Math.round(num(e.target.value, tb[1])), tb[0], tb[1]);
        paintTraitTotal();
        return;
      }
      if ((tr = e.target.getAttribute && e.target.getAttribute("data-tr"))) {
        // Clamp what the MODEL sees to the official band, but leave the box
        // alone while it is being typed in.
        var bd = traitBand();
        S.traits[tr].v = clamp(Math.round(num(e.target.value, S.traits[tr].v)), bd[0], bd[1]);
        save(); updateBasicsNote(); schedule();
      }
    });
    root.addEventListener("focusout", function (e) {
      if (e.target.getAttribute && e.target.getAttribute("data-tr")) renderTraits();
    });
    root.addEventListener("click", function (e) {
      var t = e.target, tron;
      if ((tron = t.getAttribute && t.getAttribute("data-tron"))) {
        // A plain on/off toggle. Turning a third one on is allowed — the panel
        // warns that the bracelet is illegal instead of silently dropping one.
        S.traits[tron].on = !S.traits[tron].on;
        save(); renderTraits(); updateBasicsNote(); solveNow();
        return;
      }
      // The Economy's baseline row (profile.js draws it; the editor's lines
      // are this file's, so the two presses land here).
      if (t.id === "bc-base-set") { setBaselineFromEditor(); return; }
      if (t.id === "bc-base-clear") { P.baseline.clear(); return; }
      if (t.id === "bc-clear") {
        // A blank bracelet: the Advisor's padlocks and its half-typed roll both
        // described the one being cleared.
        S.rows = []; P.fit(); S.locks = null; S.rolled = null;
        save(); redrawSlots(); recompute();
        announceBracelet();
      }
    });
  }

  // ------------------------------------------------------------------
  // the imported character's header
  //
  // Astrogem's loadout header, with our chips. It appears the moment a character
  // is imported and stays hidden otherwise — an empty header is worse than none.
  // ------------------------------------------------------------------

  /** "2d ago" for a timestamp, the same ladder astrogem uses. */
  function ageLabel(ts) {
    if (!ts) return "";
    var mins = Math.floor((Date.now() - Number(ts)) / 60000);
    if (!isFinite(mins) || mins < 0) return "";
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }

  /** Cached / fresh / imported, in one pill beside the name. */
  function cacheNoteHtml(c) {
    if (!c) return "";
    var age = ageLabel(c.pulledAt), txt;
    if (c.source === "import" || c.cached == null) txt = "Imported" + (age ? " " + esc(age) : "");
    else if (c.cached) txt = "Cached &middot; pulled " + esc(age || "recently");
    else txt = "Freshly pulled";
    return ' <span class="bc-cache' + (c.cached === false ? " fresh" : "") + '">' + txt + "</span>";
  }

  /** The character's page on lostark.bible. EU is CE there, as their URLs have it. */
  function bibleUrl(region, name) {
    var r = String(region || "").toUpperCase();
    if (r === "EU" || r === "CE") return "https://lostark.bible/character/CE/" + encodeURIComponent(name || "");
    return "https://lostark.bible/character/" + encodeURIComponent(r || "NA") + "/" + encodeURIComponent(name || "");
  }

  /**
   * The class glyph, from assets/class-icons/<Class>.svg — the same 29 files the
   * astrogem calculator ships. The list is spelled out because a class we have no
   * file for must get NO icon rather than a wrong one or a broken image: we know
   * exactly which 29 exist, so there is no reason to ask the server and find out.
   * Matching ignores case and spacing, so "Guardian Knight" finds Guardianknight.
   * onerror still hides a file that fails to load for any other reason.
   */
  var CLASS_ICONS = ("Aeromancer Arcanist Artillerist Artist Bard Berserker Breaker Deadeye Deathblade " +
    "Destroyer Glaivier Guardianknight Gunlancer Gunslinger Machinist Paladin Reaper Scrapper " +
    "Shadowhunter Sharpshooter Slayer Sorceress Souleater Soulfist Striker Summoner Valkyrie " +
    "Wardancer Wildsoul").split(" ");
  var CLASS_ICON_BY_KEY = (function () {
    var m = {}, i;
    for (i = 0; i < CLASS_ICONS.length; i++) m[CLASS_ICONS[i].toLowerCase()] = CLASS_ICONS[i];
    return m;
  })();
  function classIconFile(className) {
    if (!className) return null;
    return CLASS_ICON_BY_KEY[String(className).replace(/[^A-Za-z]/g, "").toLowerCase()] || null;
  }
  function classIconHtml(className) {
    var file = classIconFile(className);
    if (!file) return "";
    return '<img class="bc-classicon" src="assets/class-icons/' + encodeURIComponent(file) +
      '.svg" alt="" aria-hidden="true" loading="lazy" onerror="this.style.display=\'none\'">';
  }

  function paintStar(btn, region, name) {
    var F = window.Favorites, on = F ? F.has(region, name) : false;
    btn.className = "bc-star" + (on ? " on" : "");
    btn.innerHTML = on ? "&#9733;" : "&#9734;";              // ★ / ☆
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "Remove from saved characters" : "Save this character";
  }

  /** The small "Profile →" link to a character's loseii profile (index.html, LoseiiBack), or "". */
  function profileLink(c) {
    var LB = window.LoseiiBack;
    return LB && LB.link ? LB.link(c.region, c.name) : "";
  }

  /**
   * The character banner — astrogem's loadout header, with our subject.
   *
   *   ★ · class icon · 30px name linking to lostark.bible · cache pill
   *   chips: region · class · ilvl · bracelet grade · rolls left
   *   three headline stats: BRACELET % · RANK · WORTH
   *   the field rank ("Top 11% of Reapers (#3 of 24) · #9 of 30 tracked")
   *   the character's two buttons — Import Character Stats, Reset to Default
   *
   * The whole block is clickable and reloads its own character, so the banner and
   * a saved chip do exactly the same thing. The ★, the name link and the buttons
   * stop that click, because each of them means something else.
   *
   * BRACELET % and WORTH come from the live solve, so they follow the deck. RANK
   * and the field line come from the character's DEFAULT-profile score against
   * the board — the board's number against the board's numbers, or the
   * comparison would be ranking gear.
   */
  function renderCharHeader() {
    var box = $("bc-charhdr");
    if (!box) return;
    var c = S.char;
    if (!c || !c.name) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "";
    // The page's "Back to <Name>'s profile" bar (index.html, LoseiiBack) stands only
    // while the banner holds the character the visitor came from.
    if (window.LoseiiBack) window.LoseiiBack.held(c.region, c.name);

    // The grade and rolls-left chips READ the bracelet; the controls that set it
    // are in the Grader. The duplication is deliberate — and paintCharChips keeps
    // these two current in place, because rebuilding the whole banner on every
    // tick of a slider is what used to tear that slider apart.
    var chips = "";
    if (c.region) chips += '<span class="bc-chip">' + esc(c.region) + "</span>";
    if (c["class"]) chips += '<span class="bc-chip">' + esc(c["class"]) + "</span>";
    if (c.itemLevel != null) chips += '<span class="bc-chip">ilvl <b>' + esc(Number(c.itemLevel).toLocaleString("en-US")) + "</b></span>";
    chips += '<span class="bc-chip" id="bc-chip-grade">' + gradeLabel() + "</span>";
    chips += '<span class="bc-chip" id="bc-chip-rolls">rolls left <b>' + S.rollsLeft + "</b></span>";

    // The live figures. Before the first solve lands they read "—" rather than a
    // stale number from the bracelet that was on screen a moment ago. Worth is
    // written by paintWorthStat below, which owns its tooltip too.
    var curTxt = lastSolve ? fx(pct(lastSolve.currentScore), 2) + "%" : "—";

    // THE BANNER IS ALL READING NOW. "Import Character Stats" and "Reset to
    // Default" moved onto the character board's own header row, where the deck
    // they act on is (Shizu, 2026-08-12), and the bracelet's grade / slots /
    // rolls have been in the Grader since 2026-08-11 — so the right-hand control
    // cluster this banner used to carry has nothing left to hold and is gone.
    // The Advisor and the Tier List still borrow the bracelet's controls into
    // their own cluster, because neither has a Grader to put them in.
    box.innerHTML = '<div class="panel">' +
      '<div class="bc-hdrgrid">' +
      '<div class="bc-hdrleft">' +
      '<div class="bc-prof bc-profwrap" id="bc-profwrap" title="Load ' + esc(c.name) + ' again — bracelet and character settings">' +
      '<button type="button" class="bc-star" id="bc-fav-star"></button>' +
      classIconHtml(c["class"]) +
      '<div class="bc-id">' +
      '<div class="bc-name"><a href="' + bibleUrl(c.region, c.name) + '" target="_blank" rel="noopener">' +
      esc(c.name) + "</a>" + cacheNoteHtml(c) + "</div>" +
      '<div class="bc-meta">' + chips + profileLink(c) + "</div>" +
      "</div></div>" +
      '<div class="bc-sum">' +
      '<div class="stat"><span class="k">Bracelet %</span><span class="v acc" id="bc-sum-pct">' + curTxt + "</span></div>" +
      '<div class="stat"><span class="k" data-gloss="A letter for the whole bracelet on the same ladder the model grades families with: its share of the best bracelet on the board. S is 90% of the best or better, A 70%, B 50%, C 30%, D 10%. Scored on the canonical default profile, like the board itself.">Rank</span>' +
        '<span class="v" id="bc-sum-rank">—</span></div>' +
      '<div class="stat"><span class="k" id="bc-sum-worthk">Worth</span>' +
        '<span class="v gold" id="bc-sum-worth">—</span></div>' +
      "</div>" +
      '<div class="bc-fieldrank" id="bc-fieldrank"></div>' +
      "</div>" +
      "</div>" +
      "</div>";

    paintWorthStat(lastSolve);

    var star = $("bc-fav-star");
    if (star) {
      if (!window.Favorites) { star.style.display = "none"; }
      else {
        paintStar(star, c.region, c.name);
        star.onclick = function (e) {                          // onclick, not addEventListener:
          if (e && e.stopPropagation) e.stopPropagation();     // this node is rebuilt constantly
          window.Favorites.toggle(c.region, c.name);
          paintStar(star, c.region, c.name);
        };
      }
    }

    // Clicking the banner loads this character again — the same path a saved chip
    // takes, so the bracelet AND the character settings both come back.
    var wrap = $("bc-profwrap");
    if (wrap) {
      wrap.onclick = function (e) {
        var t = e && e.target;
        if (t && t.closest && (t.closest("a") || t.closest("button"))) return;
        var imp = window.BraceletImport;
        if (imp && imp.loadCharacter) imp.loadCharacter(c.region, c.name);
      };
    }

    // The cluster carries the character's two buttons. NOT the bracelet's three
    // settings: withTop false leaves those in the Grader, where nothing rebuilds
    // them.

    fillFieldRank(c);
  }

  /**
   * The rank badge and the field-rank line, both off the baked board. Async: the
   * board is one fetch, session-cached. A late answer is dropped if a different
   * character has taken the banner in the meantime.
   */
  function fillFieldRank(c) {
    var imp = window.BraceletImport;
    if (!imp || !imp.fieldRank || c.defaultPct == null) return;
    imp.fieldRank(c, function (r) {
      var cur = S.char;
      if (!cur || cur.name !== c.name || cur.region !== c.region) return;   // superseded
      var el = $("bc-fieldrank");
      if (el) el.textContent = r.text;
      var rk = $("bc-sum-rank");
      if (rk) {
        rk.innerHTML = '<span class="bc-rankbadge" style="background:' +
          (GRADE_COLOR[r.letter] || GRADE_COLOR.F) + '">' + esc(r.letter) + "</span>";
        rk.title = "Worth " + fx(c.defaultPct, 2) + "% on the canonical default profile — " +
          Math.round(r.share * 100) + "% of the best bracelet on the board.";
      }
    });
  }

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  function init() {
    var pane = $("tab-calculator");
    if (!pane || pane.getAttribute("data-init")) return;
    pane.setAttribute("data-init", "1");
    pane.innerHTML = tabMarkup();
    P.mount($("bc-deckhost"));            // the deck: built, bound and persisted by profile.js
    P.onAdvancedRender(function () { renderFixedRows(); });
    renderBracelet();
    bindBody();
    mountPicker();
    bindIntake();
    P.onChange(onProfileChange);
    renderResults(buildProfile(), null);
    recompute();
  }

  // The control deck moves between tabs (see profile.js), so the Calculator
  // claims it back whenever it is the tab on screen. P.mount also claims the
  // bracelet's three settings back into the Grader, in case another tab borrowed
  // them while it held the cluster.
  /**
   * THE BRACELET PANEL IS ONE ELEMENT THAT MOVES, exactly like the character
   * deck. The Advisor needs full manual editing — lines, traits, padlocks, the
   * granted-slot controls, "Mark as unrolled" — and duplicating the panel would
   * mean duplicated ids and two states to keep honest. Every handler the panel
   * relies on is delegated to document.body (bindBody), so the LIVE node keeps
   * working wherever it is parented. The Advisor claims it on activation;
   * the Calculator claims it back here.
   */
  function mountBraceletPanel(hostId) {
    var panel = $("bc-braceletpanel"), host = $(hostId);
    if (panel && host && panel.parentNode !== host) host.appendChild(panel);
    // THE PANEL'S OWN CONTROLS COME WITH IT. Grade, rolls left, the granted-slot
    // count and the economy are three live elements profile.js parks in this
    // panel's hosts, and it decides where they belong from what is on screen —
    // which is only true once the panel has arrived. Claiming the deck happens
    // first in both tabs, so without this the three were judged against the pane
    // the panel was LEAVING: they stayed behind in the tab the user had just
    // left, and the Calculator came back from the Advisor with an empty Grader
    // header and no Economy at all.
    if (panel && host && typeof P.adoptPanel === "function") P.adoptPanel();
  }

  /**
   * ROW EDITS DO NOT GO THROUGH PROFILE, so the Advisor cannot hear them the way
   * it hears a deck change. While the panel lived on the Calculator only, that
   * never mattered — you could not edit rows while the Advisor was on screen.
   * Now you can, so every bracelet edit announces itself and the active Advisor
   * re-solves.
   */
  function announceBracelet() {
    try { document.dispatchEvent(new CustomEvent("braceletedited")); } catch (e) {}
  }

  /**
   * The one hook bible-import.js uses — and the screenshot reader, through
   * applyParsed. It takes a patch already in this file's own shape — grade,
   * slots, rolls left, the two combat traits, the granted rows and any fixed
   * rows — and everything after that is the ordinary redraw an edit would
   * trigger. Keys the patch leaves out keep their current value, so an import
   * never disturbs the character or economy settings.
   *
   * `patch.character` is optional: {name, region, class, itemLevel, source,
   * pulledAt, cached, profile}. When it is there the banner appears, and the
   * bracelet becomes the baseline under that name. A screenshot carries none,
   * so it changes neither. What the page said about the character's GEAR rides
   * on that object and is applied only when the user asks for it —
   * profile.js's importCharacterStats() is the one path, and it runs on a press.
   */
  function applyImport(patch) {
    if (!patch) return false;
    var keys = ["grade", "slots", "rollsLeft", "traits", "traitOrder", "rows", "fixedRows"], i;
    var next = {};
    for (i = 0; i < keys.length; i++) {
      if (patch[keys[i]] !== undefined) next[keys[i]] = patch[keys[i]];
    }
    next.rolled = null;                          // a new bracelet voids the cut in progress
    // The padlocks the character is actually wearing, if the import found any.
    // lostark.bible's `fixed` flag is that padlock, not a drop-fixed line.
    if (patch.lockedIdx && patch.lockedIdx.length && next.rows) {
      var lk = [], li;
      for (li = 0; li < next.rows.length; li++) lk.push(patch.lockedIdx.indexOf(li) >= 0);
      next.locks = lk;
    } else {
      next.locks = null;
    }
    // The banner and the cards read lastSolve. It belongs to the bracelet being
    // replaced, so drop it: "—" for a moment beats the previous character's score.
    lastSolve = null; lastSolveKey = null; freshSolve = null; freshSolveKey = null;
    if (patch.character) next.char = patch.character;
    P.set(next);                                 // merges, persists, re-renders the deck, notifies
    // THE WORN BRACELET BECOMES THE BASELINE, under the character's name.
    // What someone is wearing is the bracelet any other has to beat, and the
    // Grader, holding the same bracelet, starts level with it. A bracelet the
    // game could not hold leaves the baseline as it was.
    if (patch.character && patch.character.name) {
      var worn = editorSnapshot(String(patch.character.name), "import");
      if (worn) P.baseline.set(worn);
    }
    // THE LEFT COLUMN IS NOT TOUCHED. An import used to fill the deck with the
    // character's own gear the moment they loaded, which meant the number on
    // screen was not the number the board shows them and nobody could tell
    // which they were reading. The settings stay ours until the user presses
    // "Import Character Stats" (Shizu, 2026-08-12); everything that button
    // needs is on patch.character, which P.set has just stored.
    renderCharHeader();
    return true;
  }

  // ------------------------------------------------------------------
  // THE CHARACTER SEARCH — char-picker.js, beside the import panel
  //
  // Type-ahead over the board and the ★ strip. It loads nothing itself: a pick
  // goes through BraceletImport.loadCharacter, the import panel's own path, so
  // it fills the Grader and sets the baseline exactly as a pull does.
  // ------------------------------------------------------------------

  function mountPicker() {
    var host = $("bc-who");
    if (!host) return;
    if (!window.CharPicker || typeof window.CharPicker.mount !== "function") {
      host.innerHTML = '<div class="note">Character search did not load. The panel beside it still looks a character up.</div>';
      return;
    }
    window.CharPicker.mount(host, { title: "Find a character", emptyText: "No character loaded." });
  }

  // ------------------------------------------------------------------
  // THE SCREENSHOT READER — under the import panel
  //
  // advisor-capture.js reads a bracelet off a screenshot or a shared game
  // screen and draws its own drop zone, share buttons and status line;
  // advisor-glue.js mounts it into a host and joins it to window.BraceletAdvisor,
  // the seam the Advisor tab used to provide. The Advisor no longer loads a
  // bracelet — this tab does — so the host and the seam are here, and a read
  // lands in the Grader through applyImport, the import's own path.
  //
  // LOADED ON FIRST USE. Mounting the reader starts its OCR worker, which
  // fetches Tesseract from a CDN: megabytes, on the tab everyone opens first,
  // for people who may never paste a screenshot. So the host starts as a
  // one-line drop zone, and the reader loads the moment it is wanted — a
  // pointer over the panel, a file dropped, pasted or chosen, or its button. A
  // file that arrives first waits for it. The two scripts load at the stamps
  // index.html gives them (LAZY_TABS), so the page keeps one version authority.
  //
  // THE SHARE FLOW IS THE READER'S OWN. getDisplayMedia needs a real click, so
  // nothing here chains a share onto a script load: the reader draws its own
  // "Share game screen" button, and that press starts the share.
  // ------------------------------------------------------------------

  var LOW_CONF = 0.75;             // below this a parsed field wants a human look (the Advisor's own cut)
  var intake = { state: "idle", capture: null, pending: null, report: null, confirmed: {} };

  function intakeMarkup() {
    return '<div class="panel bc-intakepanel" id="bc-intakewrap">' +
      '<div class="bc-hdrow"><h2 style="margin:0" data-gloss="Reads the lines off a screenshot of the bracelet&#39;s tooltip and puts them in the Grader below. Check any field it marks before you trust the score.">Screenshot</h2>' +
      '<button type="button" class="mbtn" id="bc-intake-file">Choose a screenshot</button></div>' +
      '<div id="bc-intake">' +
      '<div class="bc-intakezone" id="bc-intakezone"><b>Drop or paste</b> a bracelet screenshot here, or ' +
      '<button type="button" class="mbtn bc-mini" id="bc-intake-go">open the reader</button> to read your game screen.</div>' +
      '<div class="bc-intakestatus" id="bc-intakestatus" role="status"></div>' +
      "</div>" +
      '<div id="bc-parsed"></div>' +
      "</div>";
  }

  /** The reader's own status line once it is mounted; the placeholder's before. */
  function intakeStatus(text, kind) {
    var host = $("bc-intake"), el = host ? host.querySelector(".bc-status") : null, base = "bc-status";
    if (!el) { el = $("bc-intakestatus"); base = "bc-intakestatus"; }
    if (!el) return;
    el.className = base + (kind ? " " + kind : "");
    el.textContent = text || "";
  }

  /** The two scripts, at the stamps index.html lists them under; bare names only if it lists them nowhere. */
  function readerUrls() {
    var want = ["advisor-capture.js", "advisor-glue.js"], lazy = window.LAZY_TABS || {}, out = [], i, k, j, hit;
    for (i = 0; i < want.length; i++) {
      hit = null;
      for (k in lazy) if (Object.prototype.hasOwnProperty.call(lazy, k) && lazy[k] && lazy[k].length) {
        for (j = 0; j < lazy[k].length; j++) if (String(lazy[k][j]).split("?")[0] === want[i]) hit = lazy[k][j];
      }
      out.push(hit || want[i]);
    }
    return out;
  }
  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.body.appendChild(s);
    });
  }

  /**
   * Load and mount the reader, once; hand it `file` when it is ready. The glue
   * joins the moment its script runs, because the seam is on window by then.
   * A failed load says so and can be tried again.
   */
  function engageIntake(file) {
    if (file) intake.pending = file;
    if (intake.state === "ready") { flushIntake(); return; }
    if (intake.state === "loading") return;
    intake.state = "loading";
    window.BraceletAdvisor = INTAKE_SEAM;
    intakeStatus("Loading the reader…", "working");
    var urls = readerUrls(), chain = Promise.resolve(true);
    if (!window.BraceletCapture) chain = chain.then(function () { return loadScript(urls[0]); });
    if (!window.BraceletAdvisorGlue) chain = chain.then(function () { return loadScript(urls[1]); });
    chain.then(function () {
      var G = window.BraceletAdvisorGlue;
      if (!intake.capture && G && typeof G.join === "function") G.join();
      if (intake.capture) { intake.state = "ready"; flushIntake(); return; }
      intake.state = "idle";
      intakeStatus("The screenshot reader did not load. Type the lines into the Grader below, or try again.", "err");
    });
  }

  /** A file that came in before the reader: exactly what a drop on its own zone does, preview and all. */
  function flushIntake() {
    var f = intake.pending, cap = intake.capture;
    intake.pending = null;
    if (!f || !cap) return;
    var host = $("bc-intake"), zone = host ? host.querySelector(".bc-drop") : null;
    try {
      if (zone && typeof DataTransfer === "function" && typeof DragEvent === "function") {
        var dt = new DataTransfer();
        dt.items.add(f);
        zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        return;
      }
    } catch (e) { /* a browser that will not build the event takes the plain parse */ }
    if (cap.onFiles) cap.onFiles([f]);
  }

  /** The image in a paste, or null. */
  function pastedImage(e) {
    var items = e.clipboardData && e.clipboardData.items, i, f;
    if (!items) return null;
    for (i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image") === 0 && (f = items[i].getAsFile())) return f;
    }
    return null;
  }

  var intakeFileInput = null;
  function chooseScreenshot() {
    if (!intakeFileInput) {
      intakeFileInput = document.createElement("input");
      intakeFileInput.type = "file";
      intakeFileInput.accept = "image/*";
      intakeFileInput.style.display = "none";
      intakeFileInput.addEventListener("change", function () {
        var f = intakeFileInput.files && intakeFileInput.files[0];
        intakeFileInput.value = "";
        if (f) engageIntake(f);
      });
      document.body.appendChild(intakeFileInput);
    }
    intakeFileInput.click();
  }

  /** A label and a value for one parsed field, for the list under the reader. */
  function fieldReport(path, patch) {
    var m = /^rows\.(\d+)\.(fam|tier|value)$/.exec(path), g = patch.grade || S.grade, i;
    if (m && patch.rows && patch.rows[Number(m[1])]) {
      i = Number(m[1]);
      var line = rowToLine(patch.rows[i], g, junkReps()[i]);
      return { label: "Slot " + (i + 1), text: line ? lineLabel(line, g) : "empty" };
    }
    // A padlock the reader saw, or did not, in a slot's gutter.
    m = /^rows\.(\d+)\.locked$/.exec(path);
    if (m) {
      i = Number(m[1]);
      return { label: "Slot " + (i + 1) + " lock", text: (patch.lockedIdx && patch.lockedIdx.indexOf(i) >= 0) ? "locked" : "not locked" };
    }
    if (path === "grade") return { label: "Grade", text: patch.grade === "relic" ? "Relic" : "Ancient" };
    if (path === "slots") return { label: "Slots", text: String(patch.slots) };
    if (path === "rollsLeft") return { label: "Rolls left", text: String(patch.rollsLeft) };
    if (path.indexOf("traits.") === 0) {
      var k = path.split(".")[1], t = patch.traits && patch.traits[k];
      return { label: TRAIT_LABELS[k] || k, text: t ? (t.on ? String(t.v) : "off") : "—" };
    }
    return { label: path, text: "read" };
  }

  function unconfirmedCount() {
    var f = intake.report, n = 0, i;
    if (!f) return 0;
    for (i = 0; i < f.length; i++) if (f[i].conf < LOW_CONF && !intake.confirmed[f[i].path]) n++;
    return n;
  }

  /**
   * The seam's one call: a parsed bracelet into the Grader. Everything the read
   * leaves out keeps its value, as an import's does, and the character and the
   * baseline stay as they were — a screenshot says whose bracelet it is to no one.
   */
  function applyParsed(parsed, conf) {
    if (!parsed) return { ok: false, error: "Nothing to apply.", unconfirmed: 0 };
    if (parsed.target === "rolled") {
      return { ok: false, error: "This page has no rolled set to fill. The reader fills the Grader.", unconfirmed: 0 };
    }
    var patch = {}, keys = ["grade", "slots", "rollsLeft", "traits", "traitOrder", "rows", "fixedRows", "lockedIdx"], i;
    for (i = 0; i < keys.length; i++) if (parsed[keys[i]] !== undefined) patch[keys[i]] = parsed[keys[i]];
    applyImport(patch);
    announceBracelet();
    var fields = [], path, low = 0, c, r;
    conf = conf || {};
    intake.confirmed = {};
    for (path in conf) if (Object.prototype.hasOwnProperty.call(conf, path)) {
      c = num(conf[path], 1);
      r = fieldReport(path, parsed);
      fields.push({ path: path, label: r.label, text: r.text, conf: c });
      if (c < LOW_CONF) low++;
    }
    fields.sort(function (a, b) { return a.conf - b.conf; });
    intake.report = fields.length ? fields : null;
    renderParsed();
    return { ok: true, unconfirmed: low };
  }

  /** What the reader made of it: every field it reported, the doubtful ones marked. */
  function renderParsed() {
    var box = $("bc-parsed");
    if (!box) return;
    var f = intake.report, i;
    if (!f || !f.length) { box.innerHTML = ""; return; }
    var open = unconfirmedCount();
    var h = '<div class="bc-parsed"><div class="subh" style="margin-top:0">What the reader made of it</div>';
    for (i = 0; i < f.length; i++) {
      var low = f[i].conf < LOW_CONF && !intake.confirmed[f[i].path];
      h += '<div class="bc-pline"><span class="k">' + esc(f[i].label) + "</span>" +
        '<span class="' + (low ? "bc-unconf" : "") + '"' +
        (low ? ' data-gloss="The reader is only ' + Math.round(f[i].conf * 100) + '% sure of this one. Check it against the game, then mark it right."' : "") +
        ">" + esc(f[i].text) + "</span>" +
        (low ? '<button type="button" class="bc-okbtn" data-bcok="' + esc(f[i].path) + '">looks right</button>' : "") +
        "</div>";
    }
    h += '<div class="note">' + (open
      ? "<b>" + open + (open === 1 ? " field needs" : " fields need") + " a look</b> — the marked ones. Fix anything wrong in the Grader below."
      : "Every field read cleanly.") + "</div></div>";
    box.innerHTML = h;
  }

  /**
   * window.BraceletAdvisor — the capture seam, the shape advisor-glue.js has
   * always joined against. Set on first use (engageIntake), so the reader never
   * mounts before somebody wants it.
   */
  var INTAKE_SEAM = {
    /** The glue announces the reader: {onFiles, onPaste, readScreen, controller}. */
    registerCapture: function (api) { intake.capture = api || null; return true; },
    /** The one call that hands a parsed bracelet over. */
    applyParsed: applyParsed,
    setStatus: intakeStatus,
    // The reader draws its own preview and holds its own buttons while it works.
    setBusy: function () {},
    setPreview: function () {},
    /** How many parsed fields still want a human look. */
    unconfirmed: unconfirmedCount,
    /** Re-solve and repaint, for anything that changed the state directly. */
    refresh: function () { solveNow(); }
  };

  function calcActive() { var p = $("tab-calculator"); return !!(p && p.classList.contains("active")); }

  function bindIntake() {
    var wrap = $("bc-intakewrap");
    if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      var t = e.target, ok;
      if (t.id === "bc-intake-go") { engageIntake(); return; }
      if (t.id === "bc-intake-file") { chooseScreenshot(); return; }
      if ((ok = t.getAttribute && t.getAttribute("data-bcok"))) { intake.confirmed[ok] = 1; renderParsed(); }
    });
    // A pointer over the panel is intent enough to fetch the reader, so it is
    // usually there before the click that wants it.
    wrap.addEventListener("pointerenter", function () { if (intake.state === "idle") engageIntake(); });
    // Until the reader is mounted, the placeholder takes the drop itself.
    wrap.addEventListener("dragover", function (e) {
      var z = $("bc-intakezone");
      if (!z || !z.contains(e.target)) return;
      e.preventDefault();
      z.classList.add("drag");
    });
    wrap.addEventListener("dragleave", function (e) {
      var z = $("bc-intakezone");
      if (z && z.contains(e.target)) z.classList.remove("drag");
    });
    wrap.addEventListener("drop", function (e) {
      var z = $("bc-intakezone");
      if (!z || !z.contains(e.target)) return;
      e.preventDefault();
      z.classList.remove("drag");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) engageIntake(f);
    });
    // Paste is a document event, taken only while this tab is on screen and
    // only until the reader is mounted: from then on its own handler has it.
    document.addEventListener("paste", function (e) {
      if (intake.state === "ready" || !calcActive()) return;
      var f = pastedImage(e);
      if (!f) return;
      e.preventDefault();
      engageIntake(f);
    });
  }

  // ------------------------------------------------------------------
  // THE BASELINE BRACELET, as the tabs see it — BraceletApp.baseline
  //
  // profile.js keeps the snapshot, persists it, and keeps econ.baseline on it
  // (Profile.baseline). What needs this file's vocabulary is here: copying the
  // Grader's bracelet in, setting a character's worn bracelet the moment it is
  // imported, and grading it on the Current score card's own ladder.
  // ------------------------------------------------------------------

  /**
   * The bracelet in the Grader as a snapshot, or null when the game could not
   * hold it — half the granted slots filled, or two lines of one family. The
   * Grader already says which, in its own words.
   */
  function editorSnapshot(label, source) {
    var granted = grantedLines(), fixed = fixedLines();
    if (isPartial() || validateSet(fixed.concat(granted))) return null;
    return { grade: S.grade, traits: traitValues(), lines: granted, fixed: fixed, label: label, source: source };
  }

  /** "Set from the editor": the Grader's bracelet becomes the baseline. -> baseline.get(), or null */
  function setBaselineFromEditor(label) {
    var snap = editorSnapshot(label ? String(label) : "Your bracelet", "editor");
    return (snap && P.baseline.set(snap)) ? baselineView() : null;
  }

  /**
   * baseline.get() -> null, or the snapshot with its readings on the LIVE
   * profile:
   *
   *   grade, traits, lines, fixed, label, source, setAt   the snapshot (copies)
   *   name      "Paroxysmal’s bracelet", or the label as given
   *   D         its score in the solver's own currency — the bar to hold a
   *             solved cdf against (compare.fromCdf) and the dashed line on
   *             the strip
   *   pct       damagePercent(D): the Economy's baseline figure, exactly
   *   gradeKey, score, bg, fg
   *             the letter, the 0-100 and the badge colours from the ladder
   *             the Current score card uses — for the worn bracelet left in
   *             the Grader, the card's own badge
   *   role      "dps" or "support": which axis all of that is read on
   */
  function baselineView() {
    var b = P.baseline.get();
    if (!b) return null;
    var prof = buildProfile(), out = JSON.parse(JSON.stringify(b)), i, eff = [];
    var D = P.baseline.scoreD(b, prof);
    for (i = 0; i < b.lines.length; i++) if (!b.lines[i].junk) eff.push(b.lines[i]);
    var gr = gradeOfSet(b.grade, b.fixed.concat(eff), b.traits, prof);
    out.name = P.baseline.name();
    out.D = D;
    out.pct = pct(D);
    out.gradeKey = gr ? gr.key : null;
    out.score = gr ? gr.score : null;
    out.bg = gr ? gr.bg : null;
    out.fg = gr ? gr.fg : null;
    out.role = prof.role;
    return out;
  }

  document.addEventListener("tabselected", function (e) {
    if (!e || !e.detail || e.detail.tab !== "calculator") return;
    var host = $("bc-deckhost");
    if (host) P.mount(host);
    mountBraceletPanel("bc-brhome");
  });

  /** What this tab hands the others. */
  window.BraceletApp = {
    /** bible-import.js's hook, and the screenshot reader's — see applyImport. */
    applyImport: applyImport,
    /** Show a character's header without touching the bracelet. */
    setCharacter: function (c) {
      P.setCharacter(c);
      renderCharHeader();
      // The picker's "clear" drops the character, and the way back to its profile.
      if (!c && window.LoseiiBack) window.LoseiiBack.clear();
    },

    /**
     * The shared solver, for advisor.js.
     *
     * One worker and ONE DP context. advise() answers off the context the worker
     * is currently holding, so a second worker would not merely double a
     * three-second solve — it would judge the cut against a different bracelet.
     */
    /**
     * The worth arithmetic, so the Advisor cannot quote a different number for
     * the same bracelet. It is NOT res.valueGold: solveState sends
     * goldPer1Pct: 0 to keep gold out of the solve cache key (that is what lets
     * the gold slider drag without a three-second re-solve), so the worker's
     * own figure is identically zero. This applies the model's definition —
     * E[max(0, final% - baseline%)] x gpd — to the returned distribution.
     *
     * `fromCdf` is the core, and the Advisor's per-lock rows ride it with their
     * own distribution and their own bar. `of` is the wrapper for a whole solve
     * against the user's baseline. There is no second implementation left.
     */
    worth: { of: worthOf, fromCdf: worthFromCdf, odds: fmtOdds, note: worthNote, gloss: worthGloss },
    /**
     * THE BASELINE BRACELET — the one you already wear.
     *   get()            null, or the snapshot with D, pct and its grade (baselineView)
     *   set(snapshot)    {grade, traits, lines, fixed?, label?} -> get(), or null if unusable
     *   setFromEditor()  the Grader's bracelet -> get(), or null if the Grader's is half-filled
     *   clear()          forget it; econ.baseline goes back to 0, a manual slider again
     *   onChange(fn)     fn(get()) after the snapshot, its score or its role moved;
     *                    returns an unsubscribe function
     * econ.baseline is kept equal to get().pct while one is set, so everything that
     * reads the economy — worth, its notes, the Advisor's lock table — follows it.
     */
    baseline: {
      get: baselineView,
      set: function (snap) { return P.baseline.set(snap) ? baselineView() : null; },
      setFromEditor: setBaselineFromEditor,
      clear: function () { return P.baseline.clear(); },
      onChange: function (fn) {
        if (typeof fn !== "function") return function () {};
        return P.baseline.onChange(function () { fn(baselineView()); });
      }
    },
    /** compare.fromCdf(cdf, baselineD[, shiftD]) — see compareFromCdf. */
    compare: { fromCdf: compareFromCdf },
    /** strip.html(o), strip.layout(root) and strip.scale(target) — see stripHtml and stripScale. */
    strip: { html: stripHtml, layout: stripLayout, scale: stripScale },
    /** The two shared formatters: damage percentages 2dp, odds 1dp. */
    fmt: { dmg: fmtDmg, signDmg: signPct, odds: fmtOdds, gold: gold },
    /** Heroic / Epic / Legendary, from the one map. */
    tierWord: tierWord,
    /**
     * The combat-trait figures, so the Advisor's per-row chips and this file's
     * read-out line are the same arithmetic: `one` per line, `total` their
     * unrounded sum.
     */
    traits: {
      one: function (k) { return traitOnePct(k); },
      total: function () { return traitTotalPct(); }
    },
    mountBracelet: mountBraceletPanel,

    solver: {
      solveState: solveState,                        // (profile, granted, rolls, opts) -> Promise
      send: send,                                    // (cmd, payload[, {lane, key, keepCtx}]) -> Promise; "advise" rides this
      ctxKey: function () { return workerCtxKey; },  // whose DP the worker holds
      solve: solveAny,                               // (spec) -> Promise(res): any bracelet, own lane — see solveAny
      cancel: function () { return cancelLane("side"); }   // drop the side solve still waiting, if any
    },

    /**
     * The two economy defaults, once the whole import has landed.
     *
     * Called LAST by bible-import.js, after the bracelet has landed, because the
     * baseline is that bracelet's own score:
     *
     *   gold per 1%   from the character's combat power, on the astrogem
     *                 calculator's own ladder — the same rate a gem is priced at
     *   baseline %    the score of the bracelet this character is ALREADY
     *                 wearing, on the deck as it stands
     *
     * With that baseline, "worth" stops meaning "against no bracelet at all" and
     * starts meaning "what upgrading from what they wear would be worth" — for an
     * unrolled bracelet, the option value of rolling into something better.
     *
     * Both are one-shot per character and both stay editable: profile.js keeps
     * the character key each was seeded for and never seeds twice.
     */
    seedEcon: function (c) {
      if (!c) return false;
      var cur = null;
      try {
        // The bracelet as imported, under the profile it is being scored on, in
        // the solver's own currency — the figure the Current score card shows
        // for it, traits and all (profile.js, baselineScoreD). With a baseline
        // bracelet set, which an import does first, profile.js only marks the
        // key: econ.baseline already follows that bracelet.
        var snap = editorSnapshot("", "set");
        cur = snap ? pct(P.baseline.scoreD(snap)) : null;
      } catch (e) { cur = null; }
      return P.seedEcon({
        key: P.charKey(c),
        combatPower: (c.profile && c.profile.combatPower != null) ? c.profile.combatPower : null,
        currentPct: (cur != null && isFinite(cur)) ? cur : null
      });
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
