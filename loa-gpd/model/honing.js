/**
 * honing.js — what one honing level costs, and what it buys.
 *
 * Track: T4 Upper (1675) normal honing, levels +1 to +25. Two rows on the
 * chart: all five armour pieces moving together, and the weapon on its own.
 *
 * Rates in the game data are 0.01% units (5000 = 50.00%). A tap succeeds at
 *
 *     p = base + min(fails * failBonus, failMax) + juice
 *
 * where juice is the breath count times its rate, capped at juiceMax. Every
 * failure also banks artisan energy: once the success rates you have already
 * spent add up to the artisan threshold (215.00%), the next tap is free of
 * chance and lands.
 *
 * "Average scenario, optimal" means the expected gold under the cheapest
 * constant breath count for that level — the tool solves for it rather than
 * assuming full juice, because on armour the breath often costs more than the
 * taps it saves.
 *
 * No dependencies; loads in the browser and in node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Honing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ARMOR_PIECES = 5;

  /** Gold for one tap, given prices and which materials the player pays for. */
  function tapCost(recipe, prices, enabled, juiceCount) {
    var gold = recipe.gold;
    for (var id in recipe.mats) {
      if (enabled[id] === false) continue;
      gold += (prices[id] || 0) * recipe.mats[id];
    }
    if (enabled.shards !== false) gold += (prices.shard || 0) * recipe.shards;
    if (juiceCount > 0 && enabled[recipe.juice.id] !== false) {
      gold += (prices[recipe.juice.id] || 0) * juiceCount;
    }
    return gold;
  }

  /**
   * Expected gold to clear one level at a fixed breath count.
   * Returns { gold, taps } — taps is the expected number of attempts.
   */
  function expectedAt(recipe, prices, enabled, juiceCount) {
    var boost = Math.min(juiceCount * recipe.juice.rate, recipe.juiceMax);
    var cost = tapCost(recipe, prices, enabled, juiceCount);
    var artisan = 0, pReach = 1, gold = 0, taps = 0, fails = 0;
    while (pReach > 1e-12 && fails < 600) {
      var p = (recipe.success + Math.min(fails * recipe.failBonus, recipe.failMax) + boost) / 10000;
      if (artisan >= recipe.artisanThreshold) p = 1;
      gold += pReach * cost;
      taps += pReach;
      artisan += p * 10000;
      pReach *= 1 - p;
      fails += 1;
    }
    return { gold: gold, taps: taps };
  }

  /** Cheapest breath count for one level. */
  function solveLevel(recipe, prices, enabled) {
    var best = null;
    var cap = enabled[recipe.juice.id] === false ? 0 : recipe.juice.max;
    for (var k = 0; k <= cap; k++) {
      var r = expectedAt(recipe, prices, enabled, k);
      if (!best || r.gold < best.gold) best = { gold: r.gold, taps: r.taps, juice: k };
    }
    return best;
  }

  /**
   * One chart step: taking a track from `level - 1` to `level`.
   * track is "weapon" or "armor"; armour costs five pieces and gains five
   * pieces' worth of main stat.
   */
  function step(data, track, level, prices, enabled) {
    var pieces = track === "armor" ? ARMOR_PIECES : 1;
    var recipe = data[track].recipe[String(level)];
    var solved = solveLevel(recipe, prices, enabled);
    return {
      track: track,
      from: level - 1,
      to: level,
      gold: solved.gold * pieces,
      goldPerPiece: solved.gold,
      taps: solved.taps,
      juice: solved.juice,
      baseRate: recipe.success / 100,
      gain: gain(data, track, level),
    };
  }

  /**
   * Stat gained by that step. `base` is the ilvl curve, which matches bebkok's
   * Serca sheet and the bracelet calculator's baseline; `extra` is the second
   * per-level block maxroll's tooltip adds on top (open question — see
   * docs/METHODOLOGY.md).
   */
  function gain(data, track, level) {
    if (track === "weapon") {
      var c = data.weapon.weaponPower;
      return {
        stat: "weaponPower",
        base: c[level].base - c[level - 1].base,
        extra: c[level].extra - c[level - 1].extra,
      };
    }
    var base = 0, extra = 0;
    data.armor.slots.forEach(function (slot) {
      var s = data.armor.mainStat[slot];
      base += s[level].base - s[level - 1].base;
      extra += s[level].extra - s[level - 1].extra;
    });
    return { stat: "mainStat", base: base, extra: extra };
  }

  /** Every step from `from + 1` up to `to`, in order. */
  function ladder(data, track, prices, enabled, from, to) {
    var out = [];
    for (var lv = from + 1; lv <= to; lv++) out.push(step(data, track, lv, prices, enabled));
    return out;
  }

  return {
    ARMOR_PIECES: ARMOR_PIECES,
    tapCost: tapCost,
    expectedAt: expectedAt,
    solveLevel: solveLevel,
    step: step,
    ladder: ladder,
  };
});
