/**
 * gems.js — what a level of skill gems is worth to a support.
 *
 * A gem level moves three things at once, and the third is the one people miss:
 *
 *   1. the gem's own buff value — ally attack power, serenade and brand each
 *      gain a point per level
 *   2. base attack power, 1.2 points a level (9.8% at level 9, 11% at level 10),
 *      which feeds the ally attack-power buff through the support's own atk
 *   3. cooldown reduction, 2 points a level across the set — and because
 *      cooldowns must be held constant, cheaper cooldowns from gems free up
 *      swiftness, which converts into specialization
 *
 * The third one, per Shizu: 699 swiftness is 15% cooldown reduction and it is
 * linear, so 1,400 swiftness is 30%. Swiftness and gem cooldowns multiply, so
 * dropping a gem level from 24% to 22% forces swiftness up from 1,400 to about
 * 1,484 to hold the same cooldowns — and the 84 points come out of spec, which
 * is real damage through the identity bracket.
 *
 * Gold: one level-8 gem is 420,000g and each level is three of the one below, so
 * upgrading a gem already at level n costs two more of level n.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Gems = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    count: 11,                 // gems on a support
    totalCombatStat: 2500,     // swiftness + specialization, held constant
    swiftAtTen: 1400,          // the level-10 build
    cdrPerSwift: 15 / 699,     // percent of cooldown per point of swiftness
    gemCdrAtTen: 0.24,         // cooldown reduction from a full level-10 set
    cdrPerGemLevel: 0.02,
    buffPerGemLevel: 1.0,      // points of ally atk / ally dmg / brand per level
    apPerGemLevel: 0.012,      // base attack power per level
    goldAtEight: 420000,
    ratio: 3                   // three of a level make one of the next
  };

  function gemGold(level, o) {
    o = o || DEFAULTS;
    return o.goldAtEight * Math.pow(o.ratio, level - 8);
  }
  /** Gold to take a whole set from `level` to `level + 1`. */
  function upgradeGold(level, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    return o.count * (o.ratio - 1) * gemGold(level, o);
  }

  /** Swiftness needed at this gem level to hold the level-10 cooldowns. */
  function swiftFor(level, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    var target = (1 - o.swiftAtTen * o.cdrPerSwift / 100) * (1 - o.gemCdrAtTen);
    var gemCdr = o.gemCdrAtTen - (10 - level) * o.cdrPerGemLevel;
    var factor = target / (1 - gemCdr);
    return (1 - factor) * 100 / o.cdrPerSwift;
  }

  /**
   * The profile shift from the level-10 build. Feed `support` into
   * Support.DEFAULTS and `gear` into Gear.stats.
   */
  var REFERENCE_LEVEL = 9;    // what the tool's defaults describe

  function profile(level, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    var down = REFERENCE_LEVEL - level;
    return {
      support: {
        allyAtkEnh: -down * o.buffPerGemLevel,
        allyDmg: -down * o.buffPerGemLevel,
        brandPower: -down * o.buffPerGemLevel,
        spec: swiftFor(REFERENCE_LEVEL, o) - swiftFor(level, o)
      },
      gear: { gemApPct: -down * o.apPerGemLevel },
      swift: swiftFor(level, o)
    };
  }

  return {
    DEFAULTS: DEFAULTS, REFERENCE_LEVEL: REFERENCE_LEVEL, gemGold: gemGold, upgradeGold: upgradeGold,
    swiftFor: swiftFor, profile: profile
  };
});
