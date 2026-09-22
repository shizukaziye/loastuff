/**
 * bracelet.js — roll a T4 support bracelet and score it.
 *
 * Structure, per Shizu: a support bracelet arrives with **Specialization and
 * Swiftness already on it** and **three granted effect slots**. The two stats
 * are fixed at drop; the three slots are what you reroll — 4 rolls plus 3
 * ticket rolls, seven attempts, each rerolling every unlocked slot as a set
 * while locked lines stay.
 *
 * Stat rolls use **Stove's banded table**, Ancient 61-120, each stat drawn
 * independently. The top three bands are 4% apiece, so a high pair is rare:
 * 115+ on both is about 1 roll in 625.
 *
 * Because both combat-trait places are already filled, a granted slot can only
 * be a basic effect or a special one. The disclosure renormalises over excluded
 * effects, so the category split becomes basic 53.85% / special 46.15%.
 *
 * Granted special weights (Stove, via loa-bracelet-calc/docs/research):
 *   families 1-10   4.2 / 2.1 / 0.7 per tier
 *   families 11-22  0.5 / 0.25 / 0.08333
 *   families 23-33  1.0909 / 0.5455 / 0.1818
 * A family never appears twice, and at most two basics.
 *
 * Scoring is party damage for a support in house log units (100*ln(mult)).
 * Per-line values come from docs/research/bracelet.md, held fixed so a tier
 * list does not move with the owner's gear. Specialization and Swiftness score
 * the same, per Shizu.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Bracelet = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STAT_MIN = 61, STAT_MAX = 120;
  var GRANTED_SLOTS = 3;
  var ATTEMPTS = 7;
  var TRAIT_PER_POINT = 0.004978;    // per point of spec, and of swiftness
                                     // (span average at the current reference
                                     // character; the calculator's own support
                                     // traitDamage gives 0.004977 at 110)
  var BASIC_MIN = 0.176, BASIC_MAX = 0.292;   // Str/Dex/Int line, ancient band ends
  var BASIC_LO = 9600, BASIC_HI = 16000;

  var BASIC_BANDS = [
    [10, 9600, 10240], [16, 10241, 10880], [16, 10881, 11520], [16, 11521, 12160],
    [10, 12161, 12800], [10, 12801, 13440], [10, 13441, 14080], [4, 14081, 14720],
    [4, 14721, 15360], [4, 15361, 16000]
  ];

  /** Ancient tier values, low / mid / high. Absent means worth nothing. */
  var SUPPORT_LINE = {
    16: [1.274, 1.517, 1.812],   // enemy defence shred + ally AP rider
    17: [1.599, 1.894, 2.257],   // enemy crit resist + ally AP rider
    18: [0.908, 1.120, 1.331],   // shielded-target damage + ally AP rider
    19: [1.599, 1.894, 2.189],   // enemy crit damage resist + ally AP rider
    20: [0.429, 0.487, 0.546],   // stacking weapon power, six stacks
    21: [0.565, 0.632, 0.699],   // weapon power, rider up
    22: [0.662, 0.735, 0.807],   // weapon power, thirty stacks
    29: [0.738, 0.921, 1.105],   // ally attack power buff effect
    30: [0.795, 0.993, 1.190],   // ally damage buff effect
    33: [0.444, 0.498, 0.553]    // weapon power
  };

  function grantedWeight(family) {
    if (family <= 10) return [4.2, 2.1, 0.7];
    if (family <= 22) return [0.5, 0.25, 0.08333];
    return [1.0909, 0.5455, 0.1818];
  }

  function pick(rand, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = rand() * total;
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }

  /**
   * Stove's banded trait roll, Ancient 61-120. The top three bands are 4% each,
   * so 103+ on one stat is 12% and on both about 1.4%.
   */
  var TRAIT_BANDS = [
    [10, 61, 66], [16, 67, 72], [16, 73, 78], [16, 79, 84], [10, 85, 90],
    [10, 91, 96], [10, 97, 102], [4, 103, 108], [4, 109, 114], [4, 115, 120]
  ];
  function rollStat(rand) {
    var b = TRAIT_BANDS[pick(rand, TRAIT_BANDS.map(function (x) { return x[0]; }))];
    return b[1] + Math.floor(rand() * (b[2] - b[1] + 1));
  }

  function bandValue(rand, bands) {
    var b = bands[pick(rand, bands.map(function (x) { return x[0]; }))];
    return b[1] + Math.floor(rand() * (b[2] - b[1] + 1));
  }

  /**
   * One granted slot. `used` carries what the bracelet already holds so a
   * family never repeats and basics stay capped at two.
   */
  function drawSlot(rand, used) {
    used = used || { families: {}, basics: 0 };
    var cats = [], w = [];
    if (used.basics < 2) { cats.push("basic"); w.push(35); }
    cats.push("special"); w.push(30);
    if (cats[pick(rand, w)] === "basic") {
      used.basics += 1;
      if (rand() < 0.5) return { value: 0, label: "", basic: true };   // vitality
      var v = bandValue(rand, BASIC_BANDS);
      return {
        value: BASIC_MIN + (BASIC_MAX - BASIC_MIN) * ((v - BASIC_LO) / (BASIC_HI - BASIC_LO)),
        label: "mainstat", basic: true
      };
    }
    var pool = [], weights = [];
    for (var f = 1; f <= 33; f++) {
      if (used.families[f]) continue;
      var ws = grantedWeight(f);
      for (var tier = 0; tier < 3; tier++) { pool.push([f, tier]); weights.push(ws[tier]); }
    }
    if (!pool.length) return { value: 0, label: "" };
    var hit = pool[pick(rand, weights)];
    used.families[hit[0]] = true;
    var line = SUPPORT_LINE[hit[0]];
    if (!line) return { value: 0, label: "", family: hit[0] };
    return {
      value: line[hit[1]],
      label: "f" + hit[0] + ["blue", "epic", "LEG"][hit[1]],
      family: hit[0]
    };
  }

  /** What one slot is worth with n attempts left: V(n) = E[max(X, V(n-1))]. */
  function lockThresholds(rand, attempts, samples) {
    var draws = [], i;
    for (i = 0; i < (samples || 200000); i++) draws.push(drawSlot(rand, null).value);
    var v = [0];
    for (var n = 1; n <= attempts; n++) {
      var sum = 0;
      for (i = 0; i < draws.length; i++) sum += Math.max(draws[i], v[n - 1]);
      v.push(sum / draws.length);
    }
    return v;
  }

  /** A finished bracelet. Stats are fixed at drop; the three slots reroll. */
  function rollBracelet(rand, attempts, thresholds) {
    attempts = attempts || ATTEMPTS;
    var spec = rollStat(rand), swift = rollStat(rand);
    var held = [], i;
    for (var attempt = attempts; attempt >= 1; attempt--) {
      var used = { families: {}, basics: 0 };
      for (i = 0; i < held.length; i++) {
        if (held[i].family) used.families[held[i].family] = true;
        if (held[i].basic) used.basics += 1;
      }
      for (i = held.length; i < GRANTED_SLOTS; i++) held.push(drawSlot(rand, used));
      if (attempt === 1) break;
      held.sort(function (a, b) { return b.value - a.value; });
      var floor = thresholds[Math.min(attempt - 1, thresholds.length - 1)];
      held = held.filter(function (x) { return x.value >= floor; });
    }
    var lines = 0;
    for (i = 0; i < held.length; i++) lines += held[i].value;
    return {
      spec: spec, swift: swift, held: held,
      statDamage: (spec + swift) * TRAIT_PER_POINT,
      lineDamage: lines,
      damage: (spec + swift) * TRAIT_PER_POINT + lines
    };
  }

  /** The best bracelet the roll can physically produce. */
  function perfect() {
    return 2 * STAT_MAX * TRAIT_PER_POINT +
      SUPPORT_LINE[17][2] + SUPPORT_LINE[19][2] + SUPPORT_LINE[16][2];
  }

  /**
   * The score, shaped exactly like the bracelet calculator's DPS score
   * (subrank.js) so the two axes are read the same way:
   *
   *   score = 100 * (total - floor) / (anchor - floor)
   *   floor  = both combat traits at 40
   *   anchor = the three best distinct families at epic, traits at 110
   *
   * Not clamped: the anchor is beatable, and clearing it is what S+ means.
   */
  // Floor at 61/61 — the worst stats an Ancient bracelet can DROP with, per
  // the bracelet calculator's TRAIT_FLOOR (subrank.js). At the old 40/40 the
  // worst possible bracelet scored 3.5, so the bottom bands held nothing.
  var REFERENCE_STAT = 110, FLOOR_STAT = 61;
  function floor() { return 2 * FLOOR_STAT * TRAIT_PER_POINT; }
  function anchor() {
    return 2 * REFERENCE_STAT * TRAIT_PER_POINT +
      SUPPORT_LINE[17][1] + SUPPORT_LINE[19][1] + SUPPORT_LINE[16][1];
  }
  function score(damage) { return 100 * (damage - floor()) / (anchor() - floor()); }

  /**
   * The support ladder — TAKEN FROM THE BRACELET CALCULATOR, subrank.js
   * SUPPORT_LADDER, which is the authority on what a letter means. Shizu ruled
   * the bottom half on 2026-08-14 ("set B- to 40 and have C+ be 35, C 30,
   * C- 25, D+ 20, D 15, D- 10, F+ 5, F 0") and it shipped there the same
   * night. S+ through B are unchanged; everything below moved up and F- holds
   * whatever scores under 0 against the 61/61 floor.
   */
  var LADDER = [
    ["S+", 100], ["S", 90], ["S-", 82.5],
    ["A+", 75], ["A", 67.5], ["A-", 60],
    ["B+", 52.5], ["B", 45], ["B-", 40],
    ["C+", 35], ["C", 30], ["C-", 25],
    ["D+", 20], ["D", 15], ["D-", 10],
    ["F+", 5], ["F", 0], ["F-", -Infinity]
  ];
  function rank(score) {
    for (var i = 0; i < LADDER.length; i++) if (score >= LADDER[i][1]) return LADDER[i][0];
    return "F-";
  }

  return {
    STAT_MIN: STAT_MIN, STAT_MAX: STAT_MAX, GRANTED_SLOTS: GRANTED_SLOTS,
    ATTEMPTS: ATTEMPTS, TRAIT_PER_POINT: TRAIT_PER_POINT, SUPPORT_LINE: SUPPORT_LINE,
    rollStat: rollStat, drawSlot: drawSlot, lockThresholds: lockThresholds,
    rollBracelet: rollBracelet, perfect: perfect,
    REFERENCE_STAT: REFERENCE_STAT, floor: floor, anchor: anchor,
    score: score, LADDER: LADDER, rank: rank
  };
});
