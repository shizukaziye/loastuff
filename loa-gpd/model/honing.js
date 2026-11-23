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
 * The weapon takes Lava's Breath and the armour Glacier's (`recipe.juice`). A
 * vambrace takes both at once (`recipe.juices`, model/vambrace.js), each with
 * its own count and the cap on their sum; a count is filled from the cheaper
 * breath first.
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

  /** The breaths a recipe takes: one kind on the weapon and the armour, both
   *  on a vambrace. */
  function juicesOf(recipe) {
    return recipe.juices || (recipe.juice ? [recipe.juice] : []);
  }
  /** The most breaths a tap can take: every kind the player buys, at its limit.
   *  An unticked breath is not used at all. */
  function juiceCap(recipe, enabled) {
    var cap = 0;
    juicesOf(recipe).forEach(function (j) { if (enabled[j.id] !== false) cap += j.max; });
    return cap;
  }
  /**
   * `count` breaths a tap, shared out over the kinds the recipe takes: the
   * cheapest per point of success first, each up to its own limit. With one
   * kind that is the count itself. Returns { boost, gold, parts }: the success
   * they add (0.01% units, capped at juiceMax), what they cost, and how many
   * of each ([{ id, n }]).
   */
  function breaths(recipe, prices, enabled, count) {
    var kinds = juicesOf(recipe).filter(function (j) { return enabled[j.id] !== false; })
      .map(function (j) { return { id: j.id, rate: j.rate, max: j.max, price: prices[j.id] || 0 }; });
    if (kinds.length > 1) kinds.sort(function (a, b) { return a.price / a.rate - b.price / b.rate; });
    var left = count > 0 ? count : 0, boost = 0, gold = 0, parts = [];
    kinds.forEach(function (k) {
      var n = Math.min(left, k.max);
      if (n <= 0) return;
      left -= n; boost += n * k.rate; gold += n * k.price;
      parts.push({ id: k.id, n: n });
    });
    return { boost: Math.min(boost, recipe.juiceMax), gold: gold, parts: parts };
  }

  /** Gold for one tap, given prices and which materials the player pays for. */
  function tapCost(recipe, prices, enabled, juiceCount) {
    var gold = recipe.gold;
    for (var id in recipe.mats) {
      if (enabled[id] === false) continue;
      gold += (prices[id] || 0) * recipe.mats[id];
    }
    if (enabled.shards !== false) gold += (prices.shard || 0) * recipe.shards;
    if (juiceCount > 0) gold += breaths(recipe, prices, enabled, juiceCount).gold;
    return gold;
  }
  /** Gold for the level's own growth, paid once before the first tap: the
   *  gear XP a recipe carries as `growShards` (the vambrace's does). */
  function growCost(recipe, prices, enabled) {
    if (enabled.shards === false) return 0;
    return (prices.shard || 0) * (recipe.growShards || 0);
  }

  /**
   * Expected gold to clear one level at a fixed breath count.
   * Returns { gold, taps } — taps is the expected number of attempts.
   */
  function expectedAt(recipe, prices, enabled, juiceCount) {
    var boost = juiceCount > 0 ? breaths(recipe, prices, enabled, juiceCount).boost : 0;
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

  /** Cheapest breath count for one level: { gold, taps, juice, parts }, where
   *  `juice` is the breaths a tap in all and `parts` how many of each kind. */
  function solveLevel(recipe, prices, enabled) {
    var best = null;
    var cap = juiceCap(recipe, enabled);
    for (var k = 0; k <= cap; k++) {
      var r = expectedAt(recipe, prices, enabled, k);
      if (!best || r.gold < best.gold) best = { gold: r.gold, taps: r.taps, juice: k };
    }
    best.parts = best.juice > 0 ? breaths(recipe, prices, enabled, best.juice).parts : [];
    best.gold += growCost(recipe, prices, enabled);
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
    juicesOf: juicesOf,
    breaths: breaths,
    tapCost: tapCost,
    growCost: growCost,
    expectedAt: expectedAt,
    solveLevel: solveLevel,
    step: step,
    ladder: ladder,
  };
});
