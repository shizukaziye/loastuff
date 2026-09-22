/**
 * karma.js — what a karma level costs.
 *
 * Each attempt costs gold (900 on the current patch) plus a Destiny Stone, and
 * lands at a base rate that collapses as the level rises: 20% at 21 down to
 * 0.25% at 29. Every failure banks karma energy; at 100% the next attempt is
 * guaranteed, and success empties the bar. Unlike gear honing's artisan energy,
 * the gain per failure is a flat tabulated number, not a share of the success
 * rate — see docs/research/karma.md.
 *
 * So a level is a truncated geometric draw: at most F + 1 attempts, where
 * F = ceil(100% / energyPerFail) failures fill the bar.
 *
 *     E[attempts] = (1 - (1 - p)^M) / p,   M = F + 1
 *
 * Only Karmic Enlightenment reaches a support's party contribution, through
 * Weapon Power %, which raises the support's own attack power and therefore the
 * ally attack-power buff it hands out. Karmic Evolution (Max HP) and Karmic Leap
 * (Ultimate Awakening Damage) give a support's party nothing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Karma = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ENLIGHTENMENT = "20000";
  var EVOLUTION = "10000";
  var LEAP = "30000";

  /** Expected attempts for one level, honouring the energy bar. */
  function expectedAttempts(successRate, energyPerFail) {
    var p = successRate / 10000;
    if (p >= 1) return 1;
    if (p <= 0) return energyPerFail > 0 ? Math.ceil(10000 / energyPerFail) + 1 : Infinity;
    var cap = energyPerFail > 0 ? Math.ceil(10000 / energyPerFail) + 1 : Infinity;
    if (!isFinite(cap)) return 1 / p;
    return (1 - Math.pow(1 - p, cap)) / p;
  }

  /**
   * One step, from `level` to `level + 1`.
   * `prices.stone` is gold per Destiny Stone — 0 by default, since anyone at
   * this end of the game is sitting on a pile of them.
   */
  function step(data, boardId, level, prices) {
    var board = data[boardId];
    var here = board.levels[String(level)];
    var next = board.levels[String(level + 1)];
    if (!here || !next) return null;
    var attempts = expectedAttempts(here.successRate, here.energyPerFail);
    var stoneCost = 0;
    for (var id in here.mats) stoneCost += ((prices && prices[id]) || 0) * here.mats[id];
    var stat = next.stats[0];
    return {
      board: boardId,
      from: level,
      to: level + 1,
      rate: here.successRate / 100,
      attempts: attempts,
      gold: attempts * (here.gold + stoneCost),
      stat: stat.stat,
      // percent values in the game tables are 0.01% units
      gain: (stat.value - here.stats[0].value) / 100,
      total: stat.value / 100,
    };
  }

  function ladder(data, boardId, prices, from, to) {
    var out = [];
    for (var lv = from; lv < to; lv++) {
      var s = step(data, boardId, lv, prices);
      if (s) out.push(s);
    }
    return out;
  }

  return {
    ENLIGHTENMENT: ENLIGHTENMENT,
    EVOLUTION: EVOLUTION,
    LEAP: LEAP,
    expectedAttempts: expectedAttempts,
    step: step,
    ladder: ladder,
  };
});
