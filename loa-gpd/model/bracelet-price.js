/**
 * bracelet-price.js — what an unrolled bracelet costs.
 *
 * Fitted to Shizu's market listings. An unrolled bracelet's price is a pure
 * function of its two combat traits, because every one of them carries the same
 * expected value from its seven rolls.
 *
 *     log price = -3.8106 + 0.07605 * higher stat + 0.06019 * lower stat
 *
 * rms log error 0.336 over 20 listings, against 0.348 for a sum-only fit and
 * 0.537 for a Pareto integral over the stat-pair scarcity curve.
 *
 * The higher stat carries the bigger coefficient, so at a fixed total a
 * lopsided bracelet costs MORE than a balanced one — 120/80 is 25,118 where
 * 100/100 is 18,291. That makes the balanced pair the cheapest route to any
 * stat total, which is why the recommendations come out even.
 *
 * A bracelet also costs 20 pheons on top, and pheons are the floor: at 850 blue
 * crystals per 100 pheons and 25,000g per 95 crystals, that is 44,737g before
 * any gold changes hands.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BraceletPrice = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var A = -3.8106, B_HI = 0.07605, B_LO = 0.06019;
  var PHEON_GOLD = (850 / 100) * (25000 / 95);
  var PHEONS_PER_BRACELET = 20;

  function listed(a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.exp(A + B_HI * hi + B_LO * lo);
  }
  function allIn(a, b) { return listed(a, b) + PHEONS_PER_BRACELET * PHEON_GOLD; }

  return {
    A: A, B_HI: B_HI, B_LO: B_LO,
    PHEON_GOLD: PHEON_GOLD, PHEONS_PER_BRACELET: PHEONS_PER_BRACELET,
    listed: listed, allIn: allIn
  };
});
