/**
 * vambrace.js — what a vambrace level costs, and what it carries.
 *
 * The vambrace (October 2026) is a seventh piece of gear: the first clear of
 * Belgardin's second gate hands every 1750+ character an Epic one at +0, and
 * it hones to +25 on one table. It has no item level and counts toward none.
 *
 * WHAT IT CARRIES. Two blocks, added (data/vambrace.json, from the game tables):
 *
 *   base     10,500 main stat and 3,500 weapon power, the same on every grade
 *   level    a five-level cycle: weapon power, main stat, weapon power, main
 *            stat, then flat basic attack power at +5, +10, +15, +20 and +25
 *
 * and one thing more per grade: a limit break at +10, +15 and +20 turns the
 * piece Legendary, Relic and Ancient, and each adds 1% basic attack power — the
 * same stat a damage gem and the ability stone give (BASE_DAMAGE_RATE), so it
 * joins that pool. A limit break costs raid drops and no gold: 200 Spectral
 * Shade or 100 Deathly Hand at +10, 240 or 120 at +15, 150 Deathly Hand at +20.
 *
 * WHERE THE LIMIT BREAK SITS ON THE LADDER. On the step that reaches it: +9 →
 * +10 carries the Legendary break's 1%, +14 → +15 the Relic one's, +19 → +20
 * the Ancient one's. That step's gold is what unlocks the break, and nothing
 * else can. So a level here means the level with its break done.
 *
 * WHAT A LEVEL COSTS. The honing rule the weapon and the armour follow
 * (model/honing.js): a tap lands at base + fail bonus + breath, artisan energy
 * guarantees one once the rates spent reach 215%. Two differences. A vambrace
 * takes Lava's Breath AND Glacier's Breath, each with its own count, and a
 * full load of both doubles the base rate. And each level has a growth cost in
 * shards, paid once before the first tap (`growShards`).
 *
 * No DOM. Loads in the browser and in node. It prices a step through
 * model/honing.js, which it looks up when a step is priced rather than when
 * this file loads: lookup.js fetches the model files side by side, in no order.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(function () { return require("./honing.js"); });
  else root.Vambrace = factory(function () { return root.Honing; });
})(typeof self !== "undefined" ? self : this, function (honing) {
  "use strict";

  /** Wearing none. */
  var NONE = { ms: 0, wp: 0, apFlat: 0, apPct: 0, grade: null, level: null };

  /** The grade a vambrace at this level is, its limit break done. */
  function gradeAt(data, level) {
    var g = data.grades[0];
    data.grades.forEach(function (x) { if (level >= x.from) g = x; });
    return g;
  }

  /**
   * What a vambrace at `level` adds over wearing none:
   *
   *   ms      main stat, raw (it takes the main-stat percentages with it)
   *   wp      weapon power, raw (it takes the weapon-power percentages)
   *   apFlat  basic attack power, added to the square root before any percentage
   *   apPct   basic attack power %, as a fraction, into the gems' and stone's pool
   *
   * `grade` names the grade when it is not the level's own: a piece that has
   * reached +10 with its limit break still to do is statsAt(data, 10, "epic").
   */
  function statsAt(data, level, grade) {
    var row = data.stats[String(level)], g = gradeAt(data, level);
    if (grade) data.grades.forEach(function (x) { if (x.grade === grade) g = x; });
    return { ms: data.base.mainStat + row.mainStat, wp: data.base.weaponPower + row.weaponPower,
             apFlat: row.basicAttack, apPct: g.basicAttackRate / 1e4, grade: g.grade, level: level };
  }

  /** The limit break done on reaching `level`, or null. */
  function limitBreakAt(data, level) {
    var lb = data.limitBreak[String(level)];
    if (!lb) return null;
    return { at: level, to: lb.to, cost: lb.cost, or: lb.or || null,
             apPct: (gradeAt(data, level).basicAttackRate - gradeAt(data, level - 1).basicAttackRate) / 1e4 };
  }

  /** One step, from `level - 1` to `level`. */
  function step(data, level, prices, enabled) {
    var recipe = data.recipe[String(level)];
    var solved = honing().solveLevel(recipe, prices, enabled);
    var a = statsAt(data, level - 1), b = statsAt(data, level);
    return {
      from: level - 1,
      to: level,
      gold: solved.gold,
      taps: solved.taps,
      juice: solved.juice,
      parts: solved.parts,
      baseRate: recipe.success / 100,
      before: a,
      after: b,
      gain: { ms: b.ms - a.ms, wp: b.wp - a.wp, apFlat: b.apFlat - a.apFlat, apPct: b.apPct - a.apPct },
      limitBreak: limitBreakAt(data, level),
    };
  }

  /** Every step from `from + 1` up to `to`, in order. */
  function ladder(data, prices, enabled, from, to) {
    var out = [];
    for (var lv = from + 1; lv <= to; lv++) out.push(step(data, lv, prices, enabled));
    return out;
  }

  return {
    NONE: NONE,
    gradeAt: gradeAt,
    statsAt: statsAt,
    limitBreakAt: limitBreakAt,
    step: step,
    ladder: ladder,
  };
});
