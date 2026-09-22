/**
 * gear.js — the support's weapon power, main stat and base attack power.
 *
 * Assembled the way bebkok's support buff calculator does it (sheet
 * 1le-LqVr9l4dXxBDlPaSMNpf6tDVfvfsFE_QRIAmVONE, tab "Sup buff calc v3.81",
 * cells DN20..DP29). Flat sources are summed first and the percentage pool
 * multiplies the lot, so a flat weapon-power line is amplified by every
 * weapon-power percent you own:
 *
 *   total WP  = (weapon piece + accessory flats + ark grid core + feast
 *                + bracelet line) * (1 + earrings% + karma% + ark grid core%)
 *   total MS  = (five armour pieces + accessories + roster + level + food)
 *                * (1 + skin% + stronghold%)
 *   basic AP  = sqrt(total WP * total MS / 6) * (1 + AP%)
 *
 * Percentages are one additive pool, which is why the tenth karma level is
 * worth slightly less than the first: the same 0.1 point lands on a bigger
 * denominator.
 *
 * Per-piece gear stats come from data/honing-t4upper.json, whose `itemLevel`
 * curve reproduces bebkok's Serca gear table exactly.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Gear = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    // ---- weapon power, flat ----
    accessoryWpFlat: 1920,     // two earrings, high Weapon Power+ at 960 each
    arkGridWpFlat: 5200,       // Chaos Star Core: Weapon, Ancient at 20 points
    feastWpFlat: 2400,         // Feast
    braceletWpFlat: 0,

    // ---- weapon power, percent (one additive pool) ----
    earringWpPct: 0.06,        // two high Weapon Power % lines
    arkGridWpPct: 0.0369,      // the same core's percent thresholds, summed
    karmaWpPct: 0.021,         // Karmic Enlightenment, 0.1% per level

    // ---- main stat ----
    accessoryMainStat: 71429,   // five accessories at max main stat
    rosterMainStat: 2085,
    levelMainStat: 477,
    foodMainStat: 12000,       // mana food / Azena blessing
    skinMsPct: 0.08,
    strongholdMsPct: 0.01,

    // ---- attack power percent, on top of the square root ----
    stoneApPct: 0.015,         // ability stone, once two engraving levels total 5+
    gemApPct: 0.098,           // eleven level-9 gems; level 10 is 0.110
    adrenalineApPct: 0.09,     // Adrenaline level 7

    useQualityBlock: false,    // see docs/METHODOLOGY.md — open question
  };

  function pieceStat(curve, level, useQualityBlock) {
    var row = curve[level];
    return row.base + (useQualityBlock ? row.extra : 0);
  }

  /** Support stats with armour at `armorLevel` and the weapon at `weaponLevel`. */
  function stats(data, opts, armorLevel, weaponLevel) {
    var o = Object.assign({}, DEFAULTS, opts || {});

    var wpFlat = pieceStat(data.weapon.weaponPower, weaponLevel, o.useQualityBlock) +
      o.accessoryWpFlat + o.arkGridWpFlat + o.feastWpFlat + o.braceletWpFlat;
    var wpPct = o.earringWpPct + o.arkGridWpPct + o.karmaWpPct;

    var msFlat = o.accessoryMainStat + o.rosterMainStat + o.levelMainStat + o.foodMainStat;
    data.armor.slots.forEach(function (slot) {
      msFlat += pieceStat(data.armor.mainStat[slot], armorLevel, o.useQualityBlock);
    });
    var msPct = o.skinMsPct + o.strongholdMsPct;

    return {
      wp: wpFlat * (1 + wpPct),
      ms: msFlat * (1 + msPct),
      apPct: o.stoneApPct + o.gemApPct + o.adrenalineApPct,
    };
  }

  return { DEFAULTS: DEFAULTS, stats: stats, pieceStat: pieceStat };
});
