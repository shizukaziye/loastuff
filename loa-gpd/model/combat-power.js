/**
 * combat-power.js — estimate the in-game Combat Power of the build the chart
 * assembles at a slider position. Support axis only for now.
 *
 * OUR OWN FORMULA (Shizu's directive, 2026-08-20), Limerent as baseline:
 *
 *   CP(gear, v) = base.score x hone x gemFactor(level) x small(gear) x prog(v)
 *
 *   hone       sqrt(WP x MS) ratio vs the baseline gear — the game's own
 *              attack-power shape
 *   gemFactor  per-gem product on the curve MEASURED on Limerent's live
 *              set swap (3,781.18 with 6s -> 6,354.88 with 10s = x1.68066)
 *   small      battle stats, ark grid cores/nodes, karma — sub-2% nudges,
 *              damped by a fitted constant; weights are assumptions until
 *              someone measures a clean swap
 *   prog(v)    everything progression carries that gear inputs do not:
 *              skill depth (tripods, runes, skill levels) and late account
 *              systems. Fitted to a 26-character leaderboard sample plus
 *              three named whales; 1.0 at each baseline's own budget notch
 *
 * Every constant traces to a live in-game reading, a public crawl, or is
 * labeled an assumption. lostark.bible's battlePoint parts are used ONLY as
 * calibration readings (score, gear, gem levels) — their type taxonomy is
 * that site's fiction (it still lists categories for systems the game
 * removed) and plays no role here.
  */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CombatPower = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- the anchors ---------------------------------------------------------
  // DPS: Paroxysmal, raid loadout, 2026-08-19. score 7,895.29; the profile
  // shows the score raw (as it does for every character — the crawl simply
  // caught Paroxysmal in the raid skill state, so no correction is needed). Grid-gem rates fit exactly per effect: Attack Power 3.32,
  // Additional Damage 5.833, Boss Damage 8.327 bp/level; cores carry 16 bp
  // per point, so the swap uses the point delta and the grade bases cancel.
  var ANCHOR_DPS = {
    score: 7895.29,
    profileCp: 7895.29,
    baseAttack: { value: 621542.15, weaponPower: 263613, mainStat: 805775 },
    battleStatTotal: 2592,   // crit+spec+swift -> 3 bp/pt on DPS
    statBp: 3,
    karmaRank: 6,
    // full level 10s, confirmed by Shizu 2026-08-19 -> 704 bp per gem at 10.
    // No second measured level on the DPS curve yet; levels below 10 assume
    // 70.4 bp per level (the support curve came out near-linear, 129.9/lvl
    // against a 125 naive, so linear is a fair stand-in until measured).
    gems: { perGem: 704, count: 11, level: 10 },
    sumBp: 56261,            // every part except base attack/health (record)
    sumBpNonGem: 48517,      // sumBp minus the 11 gem rows (7,744)
    // prog(v), fitted like the support curve (leaderboard sample: typical
    // 1760 DPS run ~0.835 of Paroxysmal's skill state; 1773 full-10s reads
    // 0.95). Mild 1.03 cap for the 1800+ whales the sample trend points at.
    progCurve: [[0, 0.835], [87, 1], [100, 1.03]],
    notch: 87,               // the baseline's budget position (deep whale)
    arkgrid: {
      corePointsTotal: 115,  // 18+18+20+20+20+19
      coreRate: 16,
      nodeRates: { atk: 3.32, add: 5.833, boss: 8.327 },
      nodeLevels: { atk: 50, add: 60, boss: 55 }
    }
  };
  // Support: Limerent, raid loadout, 2026-08-17.
  var ANCHOR = {
    score: 3205.08,          // combatPower {id:2} on the CRAWLED loadout, 6s
    // Live readings on the raid loadout (Shizu, 2026-08-20): 3,781.18 with
    // 6s and 6,354.88 with 10s. The crawl had caught a weaker skill preset
    // (3,205.08); its PARTS remain valid — the skill block is not a part.
    // raidScore anchors the estimate; the profile header shows this number
    // raw (no support display convention — that lore came from comparing
    // two different presets).
    raidScore: 3781.18,      // raid loadout, 6s, live 2026-08-20
    // the parts this estimator swaps, as (1 + bp/1e4) multipliers
    baseAttack: { value: 235903.86, weaponPower: 267033, mainStat: 738326 },
    battleStatTotal: 2466,   // crit+spec+swift -> 4 bp/pt
    karmaRank: 6,            // 360 bp
    // measured game curve, two points: 750 bp at level 6 (crawled rows) and
    // 1,269.6 at level 10 (solved from the live x1.68066 set swap: eleventh
    // root x1.04833 per gem). Levels between ride the line (129.9 bp/level).
    gems: { count: 11, level: 6, bpAt: function (L) { return 750 + 129.9 * (L - 6); } },
    sumBp: 61142,            // every part except base attack/health (record)
    sumBpNonGem: 52892,      // sumBp minus the 11 gem rows (8,250)
    // prog(v): skill depth plus the late account systems, as one fitted
    // multiplier vs the baseline's own state. Floor and interior from the
    // 26-character leaderboard sample (typical 1750s supports run ~0.885 of
    // Limerent's skill state); the cap reproduces Zanilia's measured
    // 8,342.85 (three named whales sit +7-9% in skill and carry ~+7,500 bp
    // of late systems the chart does not price — folded together here).
    progCurve: [[0, 0.885], [47, 1], [100, 1.2213]],
    notch: 47,               // the baseline's budget position (~2.2M/1%)
    arkgrid: {
      // six cores: ancient, points from the pull; 16 bp/pt + base 480
      corePoints: [18, 18, 17, 20, 20, 18],
      coreBase: 480, coreRate: 16,
      nodeLevels: 138        // ally atk 22 + brand 53 + ally dmg 63 -> 5 bp/lvl
    }
  };

  function mult(bp) { return 1 + bp / 1e4; }

  // piecewise-linear progression multiplier at budget notch v (0..100)
  function progAt(curve, v) {
    if (v <= curve[0][0]) return curve[0][1];
    for (var i = 1; i < curve.length; i++) {
      if (v <= curve[i][0]) {
        var f = (v - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]);
        return curve[i - 1][1] + f * (curve[i][1] - curve[i - 1][1]);
      }
    }
    return curve[curve.length - 1][1];
  }

  function coreBp(points) { return ANCHOR.arkgrid.coreBase + ANCHOR.arkgrid.coreRate * points; }

  function arkgridBp(corePoints, nodeLevels) {
    var bp = 0;
    (corePoints || []).forEach(function (p) { bp += coreBp(p); });
    return { cores: bp, gems: 5 * (nodeLevels || 0) };
  }

  function estimateDps(s) {
    var A2 = ANCHOR_DPS, parts = {}, dBp = 0;
    var aBase = Math.sqrt(A2.baseAttack.weaponPower * A2.baseAttack.mainStat);
    var sBase = Math.sqrt((s.weaponPower || A2.baseAttack.weaponPower) *
                          (s.mainStat || A2.baseAttack.mainStat));
    parts.baseAttack = sBase / aBase;

    parts.battleStatsBp = A2.statBp * ((s.battleStatTotal || A2.battleStatTotal) - A2.battleStatTotal);
    dBp += parts.battleStatsBp;

    // gems compound per part: each of the 11 gems is its own factor
    var gl = s.gemLevel || A2.gems.level;
    var bpSet = A2.gems.perGem * gl / A2.gems.level;
    parts.gemFactor = Math.pow((1 + bpSet / 1e4) / (1 + A2.gems.perGem / 1e4), A2.gems.count);

    parts.arkgridBp = 0;
    if (s.corePoints && s.corePoints.length === 6) {
      var pts = s.corePoints.reduce(function (a, b) { return a + b; }, 0);
      parts.arkgridBp += A2.arkgrid.coreRate * (pts - A2.arkgrid.corePointsTotal);
    }
    var nl = s.nodeLevels || null;
    if (nl != null) {
      var R = A2.arkgrid.nodeRates, L = A2.arkgrid.nodeLevels;
      var prs = typeof nl === "number"
        ? [["atk", nl / 3], ["add", nl / 3], ["boss", nl / 3]]
        : [["atk", nl.atk || 0], ["add", nl.add || 0], ["boss", nl.boss || 0]];
      prs.forEach(function (pr) {
        parts.arkgridBp += R[pr[0]] * (pr[1] - L[pr[0]]);
      });
    }
    dBp += parts.arkgridBp;

    parts.prog = progAt(A2.progCurve, s.notch != null ? s.notch : A2.notch);

    var score = A2.score * parts.baseAttack * parts.gemFactor * parts.prog *
      (1 + (A2.sumBpNonGem + dBp) / 1e4) / (1 + A2.sumBpNonGem / 1e4);
    return { score: score, profileCp: score, parts: parts, dBp: dBp };
  }

  /**
   * settings = {
   *   weaponPower, mainStat,          // from the gear model at the plan's honing
   *   battleStatTotal,                // support stat line, e.g. 94+68 spec/swift + base
   *   karmaRank,                      // 1..6
   *   gemLevel,                       // the plan's skill-gem level (7..10)
   *   corePoints: [..6],  nodeLevels  // the ark grid tier account's display
   * }
   * Returns { score, profileCp, parts: {...} } — parts carry each swap's
   * ratio so the tooltip can show what moved.
   */
  function estimate(s) {
    var parts = {}, dBp = 0;

    var aBase = Math.sqrt(ANCHOR.baseAttack.weaponPower * ANCHOR.baseAttack.mainStat);
    var sBase = Math.sqrt((s.weaponPower || ANCHOR.baseAttack.weaponPower) *
                          (s.mainStat || ANCHOR.baseAttack.mainStat));
    parts.baseAttack = sBase / aBase;

    parts.battleStatsBp = 4 * ((s.battleStatTotal || ANCHOR.battleStatTotal) - ANCHOR.battleStatTotal);
    dBp += parts.battleStatsBp;

    parts.karmaBp = 60 * ((s.karmaRank || ANCHOR.karmaRank) - ANCHOR.karmaRank);
    dBp += parts.karmaBp;

    // gems compound per part along the measured curve (750@6 -> 1,269.6@10);
    // by construction gemFactor(10) = 1.68066, the live set-swap ratio
    var gl = s.gemLevel || ANCHOR.gems.level;
    parts.gemFactor = Math.pow(
      (1 + ANCHOR.gems.bpAt(gl) / 1e4) / (1 + ANCHOR.gems.bpAt(ANCHOR.gems.level) / 1e4),
      ANCHOR.gems.count);

    var aCores = ANCHOR.arkgrid.corePoints, sCores = s.corePoints || aCores;
    parts.arkgridBp = 0;
    for (var ci = 0; ci < 6; ci++) {
      parts.arkgridBp += coreBp(sCores[ci] != null ? sCores[ci] : aCores[ci]) - coreBp(aCores[ci]);
    }
    var aNl = ANCHOR.arkgrid.nodeLevels, sNl = s.nodeLevels != null ? s.nodeLevels : aNl;
    parts.arkgridBp += 5 * (sNl - aNl);
    dBp += parts.arkgridBp;

    parts.prog = progAt(ANCHOR.progCurve, s.notch != null ? s.notch : ANCHOR.notch);

    var score = ANCHOR.raidScore * parts.baseAttack * parts.gemFactor * parts.prog *
      (1 + (ANCHOR.sumBpNonGem + dBp) / 1e4) / (1 + ANCHOR.sumBpNonGem / 1e4);
    return { score: score, profileCp: score, parts: parts, dBp: dBp };
  }

  return { ANCHOR: ANCHOR, ANCHOR_DPS: ANCHOR_DPS, estimate: estimate,
    estimateDps: estimateDps, coreBp: coreBp };
});
