/**
 * support.js — how much party damage a support's gear is worth.
 *
 * Ported from the accessory calculator (loastuff/lost-ark-accessories), which
 * is the house model: a support is scored by what its buffs add to a damage
 * dealer, above a support wearing nothing.
 *
 *     Q = 100 * ln( ap * brand * identity )
 *
 * Three channels, each scaled by its uptime:
 *   ap        the ally attack-power buff — the support hands over
 *             0.22 * (1 + allyAtkEnh) of its own base attack power
 *   brand     10% damage, scaled by brand power
 *   identity  Serenade, Major Chord and the T-skill all raise the dealer's
 *             Additional Damage, so they share one bracket and are then
 *             diluted by the dealer's own base additional
 *
 * Only the ap channel touches the support's own gear, which is why honing and
 * karma reach the party at all. Keep the constants in step with the accessory
 * calculator — if that model moves, this one moves with it.
 *
 * Damage is multiplicative, so scores are logs and add up (loa-theorycraft).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Support = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Mirrors P in accessory_value.py / DEFAULTS in the accessory calculator.
  var DEFAULTS = {
    // the damage dealer we are buffing
    dpsWP: 260918,       // 241,367 weapon x (1 + 6% earrings + 2.1% karma)
    dpsMS: 767170,       // 703,826 raw x (1 + 8% skins + 1% stronghold)
    dpsAtkPct: 0.2948,   // accessories, ancient attack core, node 60, gems, stone, Adrenaline
    dpsFlatAtk: 3600,    // ancient attack core
    baseAdd: 0.3585,

    // the support's own buff bases, in percent
    brandPower: 45.00,   // level-9 gems; a gem level is worth a point
    allyAtkEnh: 68.55,   // level-9 gems
    allyDmg: 38.26,      // level-9 gems      // identity bracket: ark grid + gems
    allyDmgT: 9.26,      // the T-skill's own bracket
    spec: 1016,          // 1,484 swiftness holds the level-10 cooldowns at level 9
    classCoeff: 0.0005005722461,   // Bard: spec -> identity-buff efficiency

    // uptimes, in percent
    upBrand: 100,
    upAp: 95,
    upSeren: 70,
    upChord: 70,
    upTskill: 40,

    // three dealers in a party — the gold axis counts all of them
    partySize: 3,
  };

  var AP_BUFF_SHARE = 0.22;   // share of the support's base atk handed to an ally

  function baseAtk(wp, ms) {
    return Math.sqrt((wp * ms) / 6);
  }

  /**
   * The party-damage multiplier of a support with these stats and buff lines.
   * `gear` is { wp, ms } for the support; `lines` are extra buff percentages
   * from accessories, bracelet, ark grid and so on, as fractions.
   */
  function contribution(P, gear, lines) {
    lines = lines || {};
    var allyDmg = P.allyDmg / 100 + (lines.allyDmg || 0);
    var allyDmgT = P.allyDmgT / 100 + (lines.allyDmg || 0);
    var atkEnh = P.allyAtkEnh / 100 + (lines.allyAtkEnh || 0);
    var brandPower = P.brandPower / 100 + (lines.brand || 0);
    var specEff = P.spec * P.classCoeff;

    // bebkok's sheet puts an attack-power percentage on the support's own base
    // attack power (stone + gems), which scales the buff it hands out. The
    // accessory calculator leaves it out — see docs/METHODOLOGY.md.
    var supAtk = baseAtk(gear.wp, gear.ms) * (1 + (gear.apPct || 0));
    var dpsAtk = baseAtk(P.dpsWP, P.dpsMS);
    var mults = 1 + P.dpsAtkPct;
    var apMult =
      ((dpsAtk + supAtk * AP_BUFF_SHARE * (1 + atkEnh)) * mults + P.dpsFlatAtk) /
      (dpsAtk * mults + P.dpsFlatAtk);

    var ap = 1 + (P.upAp / 100) * (apMult - 1);
    var brand = 1 + (P.upBrand / 100) * (0.1 * (1 + brandPower));
    var seren = 0.15 * (1 + allyDmg) * (1 + specEff) * (1 + 0.5 * (lines.gaugeGain || 0));
    var chord = 0.02 * (1 + allyDmg) * (1 + specEff);
    var tsk = 0.1 * (1 + allyDmgT);
    var identity =
      1 +
      ((P.upSeren / 100) * seren + (P.upChord / 100) * chord + (P.upTskill / 100) * tsk) /
        (1 + P.baseAdd);

    return ap * brand * identity;
  }

  /** Damage a step adds, in percent of one dealer's damage. */
  function delta(P, before, after) {
    var a = contribution(P, before.gear, before.lines);
    var b = contribution(P, after.gear, after.lines);
    return 100 * Math.log(b / a);
  }

  /**
   * Gold per 1% damage for one step. The party multiplier is applied here, on
   * the gold axis, matching the astrogem calculator's SUPPORT_GPD_MULTIPLIER —
   * a support's 1% lands on every dealer in the party.
   */
  function goldPerDamage(P, gold, damagePct) {
    if (damagePct <= 0) return Infinity;
    return gold / (damagePct * P.partySize);
  }

  return {
    DEFAULTS: DEFAULTS,
    AP_BUFF_SHARE: AP_BUFF_SHARE,
    baseAtk: baseAtk,
    contribution: contribution,
    delta: delta,
    goldPerDamage: goldPerDamage,
  };
});
