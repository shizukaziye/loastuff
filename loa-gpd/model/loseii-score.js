/**
 * loseii-score.js — the Loseii Score: a character's damage, on the in-game
 * Combat Power scale.
 *
 *   score = K × exp( Σ_s (L_s(character) − L_s(reference)) / 100 )
 *
 * L_s is the house log-damage (D = 100·ln(multiplier), additive) of where the
 * character stands on system s, measured on the GPD chart's own ladders, and
 * the sum is the character's damage multiplier against the chart's reference
 * character. K puts that on the CP scale: calibrate() takes the weighted median
 * of CP / multiplier over a panel of real NA characters (data/loseii-panel.json),
 * so the median NA character scores its own in-game CP. The numbers read like
 * CP; the order and the gaps come from damage, not from the game's weighting.
 *
 * Why the CP scale: lopec.kr's 환산 점수 (the Korean community's "real" power)
 * multiplies base attack power through every damage system with class-neutral
 * weights and lands near in-game CP on purpose, so nobody has to learn a new
 * scale. This is the same idea on this site's damage model. (A single whale as
 * the anchor was tried first and left the middle item-level bands ~22% over
 * their CP; docs/METHODOLOGY.md has the comparison.)
 *
 * THE LADDERS ARE THE CHART'S. Every per-step damage below comes from the rows
 * the chart draws (lookup.js steps(): rows-dps.json honingDamage/karmaDamage and
 * baked rows on DPS, the support model's live rows on support), so the chart,
 * the lookup and the score cannot disagree. Where a system has an exact reading
 * the ladder only approximates, the reading wins:
 *
 *   honing     per armour piece, each piece a share of the five-piece step by
 *              its main-stat gain (data/honing-t4upper.json); the weapon alone
 *   karma      Enlightenment level; below 21 the 21→22 step is extended per
 *              level (the same +0.1% weapon power a level), and it says so
 *   gems       each gem an eleventh of the set's step; a level under the
 *              ladder's first rung (7) is priced at 7, and it says so
 *   stone      7-7 → 9-7, the game's own level rule (combined level 5)
 *   bracelet   the bracelet calculator's own score total (Subrank.braceletScore),
 *              the scale the bracelet rungs' totalDamage is on
 *   accessory  each piece's damage on the accessory lattice (flat line and main
 *              stat included), the scale the accessory rungs are cut from
 *   ark grid   Astrogem.gridDamage of the valid gems, the scale the ark grid
 *              rows are priced on
 *   Master     the bracelet model's +7% additional damage, DPS only
 *
 * A system the pull does not carry is NOT invented: it drops out of the sum
 * (the character is taken at the reference's level there) and is listed in
 * `unscored` with the reason, so a page can say what the number leaves out.
 *
 * Pure functions, no DOM. The Python twin is model/loseii_score.py, kept in
 * lockstep by tools/verify-loseii-score.js (REFS in tools/loseii-score-refs.json).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LoseiiScore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0";

  // The honing table's armour slots, and what each worker calls them.
  var ARMOR_SLOTS = ["head", "shoulders", "torso", "legs", "hands"];
  var SLOT_ALIAS = { head: "head", shoulder: "shoulders", shoulders: "shoulders", chest: "torso",
                     torso: "torso", upper_body: "torso", pants: "legs", legs: "legs", lower_body: "legs",
                     gloves: "hands", hands: "hands", hand: "hands" };
  var ACC_SLOTS = ["neck", "ear1", "ear2", "finger1", "finger2"];
  var ACC_KIND = { neck: "neck", ear1: "earring", ear2: "earring", finger1: "ring", finger2: "ring" };
  var GEM_SLOTS = 11;
  var HONE_MIN = 11, HONE_MAX = 25, KARMA_BASE = 21, KARMA_MAX = 30, GEM_MIN = 7, GEM_MAX = 10;

  // The systems, in the order a breakdown lists them.
  var SYSTEMS = [
    { key: "armor", label: "Honing — armour" },
    { key: "weapon", label: "Honing — weapon" },
    { key: "karma", label: "Karma — Enlightenment" },
    { key: "gems", label: "Skill gems" },
    { key: "stone", label: "Ability stone" },
    { key: "bracelet", label: "Bracelet" },
    { key: "neck", label: "Necklace" },
    { key: "earring", label: "Earrings" },
    { key: "ring", label: "Rings" },
    { key: "grid", label: "Ark grid" },
    { key: "arkPassive", label: "Ark passive — evolution tier 1" },
    { key: "master", label: "Ark passive — Master", axis: "dps" },
    { key: "partner", label: "Fixed partner" }
  ];

  // What no pull the lookup reads carries, or no model prices, so no build is
  // ever scored on it. Elixir and transcendence are not here: both left the
  // game in 2025 (docs/research/combat-power-model.md), so there is nothing to
  // score; the bracelet worker's page probe still looks for them and the
  // records never carry them.
  var ALWAYS_UNSCORED = {
    dps: [
      ["engravings", "Engravings", "the books and relic engravings are not in the pull; only the stone's 9-7 step is scored"],
      ["skills", "Runes, tripods and skill levels", "not in the pull"],
      ["arkPassive2", "Ark passive past tier-1 evolution and Master", "the pull carries each tree's points, not which tier 2-5 nodes they bought; enlightenment and leap are not priced"],
      ["cards", "Card sets", "not in the pull"],
      ["quality", "Weapon quality", "not in the pull; the model assumes a 100-quality weapon"]
    ],
    support: [
      ["engravings", "Engravings", "the books and relic engravings are not in the pull; only the stone's 9-7 step is scored"],
      ["skills", "Runes, tripods and skill levels", "not in the pull"],
      ["arkPassive2", "Ark passive past tier-1 evolution", "the pull carries each tree's points, not which tier 2-5 nodes they bought; enlightenment and leap are not priced"],
      ["cards", "Card sets", "not in the pull"],
      ["quality", "Weapon quality", "not in the pull"]
    ]
  };

  // The GPD chart's reference character (rows-dps.json `note`,
  // docs/research/reference-character.md): ilvl 1785 — weapon +25, gloves +23,
  // the rest +21 — level-9 gems, high/high accessories at max main stat with no
  // flat line, 9-7 stone, karma 21, ark grid 60/60/60 side nodes with every core
  // at 20 points. The spec names no bracelet, so the reference bracelet is the
  // calibration panel's median one (calibrate). It scores exactly K.
  var REFERENCE = {
    armor: { pieces: { head: 21, shoulders: 21, torso: 21, legs: 21, hands: 23 } },
    weapon: 25, karma: 21, gems: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9], stone: "9-7", master: false, evolution: 140,
    acc: {
      dps: { neck: { prim: ["high", "high"], flat: null, ms: "max" },
             earring: { prim: ["high", "high"], flat: null, ms: "max" },
             ring: { prim: ["high", "high"], flat: null, ms: "max" } },
      support: { neck: { prim: ["high", "high"], flat: null, ms: "max" },
                 earring: { prim: ["high"], flat: null, ms: "max" },
                 ring: { prim: ["high", "high"], flat: null, ms: "max" } }
    },
    grid: { nodes: 60, corePoints: 20 },
    note: "the GPD chart's reference character: ilvl 1785 (weapon +25, gloves +23, the rest +21), " +
          "level-9 gems, high/high accessories at max main stat with no flat line, 9-7 stone, karma 21, " +
          "ark grid 60/60/60 side nodes with every core at 20 points; the spec names no bracelet, so its " +
          "bracelet is the calibration panel's median"
  };

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function num(s) { var n = parseInt(String(s == null ? "" : s).replace(/[^0-9]/g, ""), 10); return isNaN(n) ? null : n; }

  // ---- the ladder tables ---------------------------------------------------
  /**
   * The per-step damage of every ladder, off the chart's own rows for one axis.
   *
   *   rows     lookup.js steps(ctx) — the chart's ROWS — for that axis
   *   honing   data/honing-t4upper.json (the upper, 1675 track: stats per +N)
   *   axis     "dps" | "support"
   *   extras   { masterD      Master's damage (DPS)
   *              lower        data/honing-t4lower.json (the 1590 track: stats per item level)
   *              msC, wpC     the axis's main stat and weapon power beside the gear pieces
   *              apT1         { perLevel } — one tier-1 evolution level's damage }
   *
   * HONING IS SCORED FROM STATS, NOT FROM +N. The chart's honing rows are the
   * upper track's steps, +11 to +25; each is a knot (the five pieces' main
   * stat plus msC, the ladder's damage there) and a character's honing is its
   * gear's real main stat and weapon power placed on that curve in log space —
   * exactly the ladder at a knot, the ladder's own damage per unit of log stat
   * between knots, and the first (last) step's rate beyond its ends. So a piece
   * on the lower track, or under +11, is priced at what it really carries.
   *
   * Returns plain numbers only, so the Python twin reads the same object.
   */
  function tables(rows, honing, axis, extras) {
    extras = extras || {};
    var t = { axis: axis, armor: {}, weapon: {}, karma: {}, gems: {}, stone: {},
              bracelet: { floor: null }, master: isNum(extras.masterD) ? extras.masterD : null,
              msC: isNum(extras.msC) ? extras.msC : 0, wpC: isNum(extras.wpC) ? extras.wpC : 0,
              apT1: extras.apT1 && isNum(extras.apT1.perLevel) ? { perLevel: extras.apT1.perLevel, levels: 40 } : null,
              upper: { ms: {}, wp: {} }, lower: { ms: {}, wp: {}, base: 1590, max: 1755 },
              armorKnots: [], weaponKnots: [] };
    (rows || []).forEach(function (r) {
      var to = num(r.to);
      if ((r.series === "armor" || r.series === "weapon") && to != null) t[r.series][String(to)] = r.damage;
      else if (r.series === "karma" && to != null) t.karma[String(to)] = r.damage;
      else if (r.series === "gems" && to != null) t.gems[String(to)] = r.damage;
      else if (r.series === "stone") t.stone[String(r.to).trim()] = r.damage;
      else if (r.series === "bracelet" && isNum(r.totalDamage) && t.bracelet.floor == null) {
        // the first rung's total less its step is the ladder's floor bracelet (F)
        t.bracelet.floor = r.totalDamage - r.damage;
      }
    });
    var ms = honing && honing.armor && honing.armor.mainStat, wp = honing && honing.weapon && honing.weapon.weaponPower;
    for (var k = 0; k <= HONE_MAX; k++) {
      ARMOR_SLOTS.forEach(function (sl) {
        (t.upper.ms[sl] = t.upper.ms[sl] || {})[String(k)] = ms && ms[sl] && ms[sl][k] ? ms[sl][k].base : null;
      });
      t.upper.wp[String(k)] = wp && wp[k] ? wp[k].base : null;
    }
    var lo = extras.lower;
    if (lo && lo.armor && lo.weapon) {
      t.lower.base = lo.baseIlvl; t.lower.max = lo.maxIlvl;
      for (var il = lo.baseIlvl; il <= lo.maxIlvl; il++) {
        ARMOR_SLOTS.forEach(function (sl) {
          (t.lower.ms[sl] = t.lower.ms[sl] || {})[String(il)] = lo.armor.mainStat[sl][il];
        });
        t.lower.wp[String(il)] = lo.weapon.weaponPower[il];
      }
    }
    // the knots: the upper track, every piece at +k, and the ladder's damage there
    var La = 0, Lw = 0;
    for (k = HONE_MIN; k <= HONE_MAX; k++) {
      if (k > HONE_MIN) { La += t.armor[String(k)] || 0; Lw += t.weapon[String(k)] || 0; }
      var A = 0;
      ARMOR_SLOTS.forEach(function (sl) { A += t.upper.ms[sl][String(k)] || 0; });
      t.armorKnots.push([A + t.msC, La]);
      t.weaponKnots.push([(t.upper.wp[String(k)] || 0) + t.wpC, Lw]);
    }
    return t;
  }

  // ---- where a reading sits on each ladder (absolute, from the floor) --------
  function sumTo(tab, from, to) {
    var s = 0;
    for (var k = from + 1; k <= to; k++) s += tab[String(k)] || 0;
    return s;
  }
  /** A stat total placed on a ladder's knots in log space: exact at a knot,
   *  the ladder's own rate between knots, the end steps' rates beyond. */
  function onKnots(knots, x) {
    var n = knots.length, i;
    if (!(x > 0) || n < 2) return null;
    if (x <= knots[0][0]) {
      return knots[0][1] + (knots[1][1] - knots[0][1]) * Math.log(x / knots[0][0]) / Math.log(knots[1][0] / knots[0][0]);
    }
    for (i = 1; i < n; i++) {
      if (x <= knots[i][0]) {
        return knots[i - 1][1] + (knots[i][1] - knots[i - 1][1]) *
          Math.log(x / knots[i - 1][0]) / Math.log(knots[i][0] / knots[i - 1][0]);
      }
    }
    return knots[n - 1][1] + (knots[n - 1][1] - knots[n - 2][1]) * Math.log(x / knots[n - 1][0]) /
      Math.log(knots[n - 1][0] / knots[n - 2][0]);
  }
  /** One gear piece's stat: the upper track by +N, the lower by item level
   *  (1590 + 5 × honing + advanced honing). null when the table lacks it. */
  function pieceStat(T, slot, level, track, adv) {
    if (track === "lower") {
      var il = Math.max(T.lower.base, Math.min(T.lower.max, T.lower.base + 5 * level + (adv || 0)));
      var tab = slot === "weapon" ? T.lower.wp : T.lower.ms[slot];
      return tab ? tab[String(il)] : null;
    }
    var k = Math.max(0, Math.min(HONE_MAX, level));
    return slot === "weapon" ? T.upper.wp[String(k)] : T.upper.ms[slot][String(k)];
  }
  function armorD(T, rd) {
    var A = 0, n = 0;
    if (rd.pieces) {
      ARMOR_SLOTS.forEach(function (sl) {
        var lv = rd.pieces[sl];
        if (!isNum(lv)) return;
        var v = pieceStat(T, sl, lv, rd.tracks && rd.tracks[sl], rd.adv && rd.adv[sl]);
        if (isNum(v)) { A += v; n++; }
      });
    }
    if (n !== ARMOR_SLOTS.length) {
      if (!isNum(rd.level)) return null;
      A = 0;
      ARMOR_SLOTS.forEach(function (sl) { A += pieceStat(T, sl, rd.level, "upper", 0) || 0; });
    }
    return { D: onKnots(T.armorKnots, A + T.msC), stat: A };
  }
  function weaponD(T, level, track, adv) {
    var W = pieceStat(T, "weapon", level, track, adv);
    return isNum(W) ? { D: onKnots(T.weaponKnots, W + T.wpC), stat: W } : null;
  }
  function karmaD(T, level) {
    var L = Math.min(KARMA_MAX, level);
    if (L >= KARMA_BASE) return { D: sumTo(T.karma, KARMA_BASE, L), clamped: L !== level };
    return { D: -(KARMA_BASE - L) * (T.karma[String(KARMA_BASE + 1)] || 0), extended: true };
  }
  function gemD(T, levels) {
    var D = 0, low = 0, missing = Math.max(0, GEM_SLOTS - levels.length);
    var first = T.gems[String(GEM_MIN + 1)] || 0;
    var take = levels.slice().sort(function (a, b) { return b - a; }).slice(0, GEM_SLOTS);
    take.forEach(function (lv) {
      var L = Math.min(GEM_MAX, lv);
      // under the ladder's first rung (7), the 7→8 step is extended per level
      if (L < GEM_MIN) { low++; D -= (GEM_MIN - L) * first / GEM_SLOTS; }
      else D += sumTo(T.gems, GEM_MIN, L) / GEM_SLOTS;
    });
    return { D: D, low: low, missing: missing };
  }
  /** The chart's stone test: a rung "a-b" is owned when the stone's first
   *  engraving beats a, or ties it with the second at least b. */
  function stoneOwns(rung, stone) {
    var rd = String(rung).match(/(\d+)-(\d+)/), md = String(stone).match(/(\d+)-(\d+)/);
    if (!rd || !md) return false;
    return +rd[1] < +md[1] || (+rd[1] === +md[1] && +rd[2] <= +md[2]);
  }
  function stoneD(T, stone) {
    var D = 0, owned = null;
    Object.keys(T.stone).forEach(function (r) {
      if (stoneOwns(r, stone)) { D += T.stone[r]; owned = r; }
    });
    return { D: D, rung: owned };
  }
  // ---- the fixed partner --------------------------------------------------
  // NO SUPPORT BUFFS ON A DEALER, ONE FIXED DEALER FOR A SUPPORT (Shizu,
  // 2026-09-26). A dealer is scored on its own damage: the DPS ladders come
  // from the bracelet model, which carries no brand, ally damage, ally attack
  // or uptime term. A support is scored on its buffs measured on one fixed
  // dealer, the chart's reference character — support.js DEFAULTS' dealer
  // (dpsWP 260,918, dpsMS 767,170) is exactly that character, the way lopec
  // measures every support on its standard dealer.
  //
  // THE ONE EXCEPTION is the attack-power term: a support's attack buff is a
  // flat add scaled off the support's own attack, so a dealer's attack power
  // is carried with a FIXED DUMMY SUPPORT BUFF, the reference support's attack
  // buff on the reference dealer as a multiple of that dealer's own attack
  // power (support.js's ap channel on the reference pair):
  //
  //   support attack   228,511  (gear.js at +21 armour, +25 weapon, 20.3% attack power)
  //   handed over      × 0.22 × (1 + 68.55% ally attack enhancement) = 84,733 base attack,
  //                    × 1.2948 (the dealer's attack-power pool) = 109,714 attack power
  //   dealer's own     182,651 base × 1.2948 + 3,600 flat = 240,097 attack power
  //   while up         (240,097 + 109,714) / 240,097 = ×1.4570
  //   at 95% uptime    1 + 0.95 × 0.4570 = ×1.4341
  //
  // A constant multiplier: it cancels in every ratio, so it moves no score and
  // K absorbs it. It is carried and named so the attack-power level the model
  // stands on is a raid's, not a solo dealer's. tools/verify-loseii-score.js
  // recomputes it from the two models and fails if they have moved.
  var DUMMY_SUPPORT_AP = 1.4341;
  function fixedPartner(axis) {
    if (axis === "dps") {
      return { L: 100 * Math.log(DUMMY_SUPPORT_AP),
        rung: "attack power incl. a fixed dummy support buff ×" + DUMMY_SUPPORT_AP.toFixed(2),
        note: "the reference support's attack buff on the reference dealer, the same for every dealer; " +
              "no brand, ally damage or other support buff is in a dealer's score" };
    }
    return { L: 0, rung: "a fixed dealer: the chart's reference character",
      note: "every support's buffs are measured on the same dealer (support.js DEFAULTS)" };
  }

  function trackWord(track, adv) {
    return track === "lower" ? " (1590 set" + (adv ? ", advanced " + adv : "") + ")" : "";
  }

  /**
   * Each system's absolute ladder damage for one reading, or null where the
   * reading is missing. Returns { key: { L, rung, note } }.
   */
  function levels(T, rd, axis) {
    var out = {}, x;
    rd = rd || {};
    if (rd.armor && (x = armorD(T, rd.armor)) && isNum(x.D)) {
      var p = rd.armor.pieces, vals = p ? ARMOR_SLOTS.map(function (s) { return p[s]; }).filter(isNum) : [];
      var tr = rd.armor.tracks || {}, nLow = ARMOR_SLOTS.filter(function (s) { return tr[s] === "lower"; }).length;
      var rung = vals.length === 5
        ? (Math.min.apply(null, vals) === Math.max.apply(null, vals) ? "+" + vals[0]
          : "+" + Math.min.apply(null, vals) + " to +" + Math.max.apply(null, vals))
        : "+" + rd.armor.level;
      if (nLow) rung += nLow === 5 ? " (1590 set)" : " (" + nLow + " of 5 on the 1590 set)";
      out.armor = { L: x.D, rung: rung,
        note: vals.length === 5 ? "the five pieces' real main stat (" + Math.round(x.stat).toLocaleString() + ") on the honing ladder"
          : "all five pieces taken at the lowest" };
    }
    if (isNum(rd.weapon) && (x = weaponD(T, rd.weapon, rd.weaponTrack, rd.weaponAdv)) && isNum(x.D)) {
      out.weapon = { L: x.D, rung: "+" + rd.weapon + trackWord(rd.weaponTrack, rd.weaponAdv),
        note: "the weapon's real weapon power (" + Math.round(x.stat).toLocaleString() + ") on the honing ladder" };
    }
    if (isNum(rd.karma)) {
      x = karmaD(T, rd.karma);
      out.karma = { L: x.D, rung: "lv " + rd.karma,
        note: x.extended ? "under 21 the 21→22 step is extended per level (the same +0.1% weapon power a level)" : null };
    }
    if (Array.isArray(rd.gems) && rd.gems.length) {
      x = gemD(T, rd.gems);
      var mn = Math.min.apply(null, rd.gems), mx = Math.max.apply(null, rd.gems);
      var bits = [];
      if (x.low) bits.push(x.low + " gem" + (x.low > 1 ? "s" : "") + " under level 7: the 7→8 step extended per level");
      if (x.missing) bits.push(x.missing + " of 11 missing, priced at level 7");
      out.gems = { L: x.D, rung: mn === mx ? "level " + mn + " ×" + rd.gems.length
        : "levels " + mn + "–" + mx + " (mean " + (rd.gems.reduce(function (a, b) { return a + b; }, 0) / rd.gems.length).toFixed(1) + ")",
        note: bits.join("; ") || "each gem an eleventh of the set's step" };
    }
    if (rd.stone) {
      x = stoneD(T, rd.stone);
      out.stone = { L: x.D, rung: rd.stone + (x.rung ? " (≥ " + x.rung + ")" : ""),
        note: x.rung ? null : "under 9-7: priced as the ladder's first rung, 7-7" };
    }
    if (rd.bracelet && isNum(rd.bracelet.D)) {
      out.bracelet = { L: rd.bracelet.D, rung: rd.bracelet.label || "", note: rd.bracelet.note || null };
    }
    if (rd.acc) {
      ["neck", "earring", "ring"].forEach(function (kind) {
        var slots = ACC_SLOTS.filter(function (s) { return ACC_KIND[s] === kind; });
        var have = slots.filter(function (s) { return rd.acc[s] && isNum(rd.acc[s].D); });
        if (!have.length) return;
        var L = 0, labels = [], notes = [];
        have.forEach(function (s) {
          L += rd.acc[s].D; labels.push(rd.acc[s].label || "");
          if (rd.acc[s].note) notes.push(rd.acc[s].note);
        });
        out[kind] = { L: L, rung: labels.join(" + "), note: notes.join("; ") || null,
                      slots: have, missing: slots.filter(function (s) { return have.indexOf(s) < 0; }) };
      });
    }
    if (rd.grid && isNum(rd.grid.D)) out.grid = { L: rd.grid.D, rung: rd.grid.label || "", note: rd.grid.note || null };
    if (isNum(rd.evolution) && T.apT1) {
      var lv1 = Math.max(0, Math.min(T.apT1.levels, rd.evolution));
      out.arkPassive = { L: lv1 * T.apT1.perLevel, rung: rd.evolution + " evolution points",
        note: "the first 40 points buy the tier-1 stat nodes, 50 combat stat a level" };
    }
    if (axis === "dps" && typeof rd.master === "boolean" && isNum(T.master)) {
      out.master = { L: rd.master ? T.master : 0, rung: rd.master ? "Master" : "no Master", note: null };
    }
    out.partner = fixedPartner(axis);
    return out;
  }

  /** Accessories compare piece by piece, so a missing earring is taken at
   *  the reference's piece, not dropped from the pair. */
  function accPart(kind, a, b) {
    var D = 0, slots = ACC_SLOTS.filter(function (s) { return ACC_KIND[s] === kind; });
    var used = [], missing = [];
    slots.forEach(function (s) {
      var x = a.acc && a.acc[s], y = b.acc && b.acc[s];
      if (x && isNum(x.D) && y && isNum(y.D)) { D += x.D - y.D; used.push(s); }
      else missing.push(s);
    });
    return { D: D, used: used, missing: missing };
  }

  // ---- the reference -------------------------------------------------------
  /**
   * The reference character as readings. Accessory, grid and bracelet damage
   * live on scales this file does not carry (the accessory lattice, the
   * astrogem model, the bracelet scorer), so the caller hands them in:
   * `extra` = { acc: {kind: D of one piece}, grid: D, bracelet: D }.
   */
  function referenceReadings(extra) {
    extra = extra || {};
    var acc = {};
    ACC_SLOTS.forEach(function (s) {
      var D = extra.acc && extra.acc[ACC_KIND[s]];
      if (isNum(D)) acc[s] = { D: D, label: "high/high, max main stat, no flat" };
    });
    return { armor: REFERENCE.armor, weapon: REFERENCE.weapon, karma: REFERENCE.karma,
             gems: REFERENCE.gems.slice(), stone: REFERENCE.stone, master: REFERENCE.master,
             evolution: REFERENCE.evolution, acc: acc,
             grid: isNum(extra.grid) ? { D: extra.grid, label: "60/60/60, cores at 20" } : null,
             bracelet: isNum(extra.bracelet) ? { D: extra.bracelet, label: "the calibration panel's median" } : null };
  }

  /** Every system's damage against the reference: { total, parts, unscored }. */
  function compare(T, axis, rd, ref, why) {
    why = why || {};
    var me = levels(T, rd || {}, axis), rf = levels(T, ref, axis);
    var parts = [], unscored = [], total = 0;
    SYSTEMS.forEach(function (s) {
      if (s.axis && s.axis !== axis) return;
      var m = me[s.key], r = rf[s.key];
      var label = s.key === "partner" ? (axis === "dps" ? "Attack power — fixed support buff" : "Dealer buffed — fixed") : s.label;
      if (!m || !r) {
        unscored.push({ system: s.key, label: label,
          why: (!m ? (why[s.key] || "not in the pull") : "no reference reading") + " — taken at the reference's level" });
        return;
      }
      var D = m.L - r.L;
      if (s.key === "neck" || s.key === "earring" || s.key === "ring") {
        var ap = accPart(s.key, rd, ref);
        D = ap.D;
        if (ap.missing.length) {
          var miss = ap.missing.map(function (x) { return x.replace("ear", "earring ").replace("finger", "ring "); });
          unscored.push({ system: s.key, label: s.label + " (" + miss.join(", ") + ")",
            why: (why[s.key] || "not in the pull") + " — taken at the reference's piece" });
        }
      }
      total += D;
      parts.push({ system: s.key, label: label, rung: m.rung, refRung: r.rung, D: D, mult: Math.exp(D / 100),
                   note: m.note || null });
    });
    return { total: total, parts: parts, unscored: unscored };
  }

  // ---- the scale -------------------------------------------------------------
  /** The weighted median of [{ v, w }]: the value at half the total weight. */
  function wmedian(xs) {
    var a = xs.filter(function (x) { return isNum(x.v) && x.w > 0; })
      .sort(function (p, q) { return p.v - q.v; });
    if (!a.length) return null;
    var tot = a.reduce(function (s, x) { return s + x.w; }, 0), run = 0;
    for (var i = 0; i < a.length; i++) {
      run += a[i].w;
      if (run >= tot / 2 - 1e-12) return a[i].v;
    }
    return a[a.length - 1].v;
  }
  /**
   * The scale K that puts the score on the in-game Combat Power scale.
   *
   * `panel` is data/loseii-panel.json's list for this axis: real NA
   * characters, each with the in-game CP its own pull carried and the readings
   * that pull gives, weighted so each item-level band counts as its share of
   * the NA board. Each member says "K should be CP / multiplier"; K is the
   * weighted median of those, so the median NA character scores its own CP.
   * The reference bracelet (the spec names none) is the panel's median
   * bracelet, taken first, so an unread bracelet sits at a typical one.
   *
   * Returns { K, braceletRef, n, members: [{ name, cp, mult, k }] }.
   */
  function calibrate(T, axis, panel, extra) {
    extra = extra || {};
    var list = (panel || []).filter(function (m) { return m && isNum(m.cp) && m.cp > 0 && m.readings; });
    var bref = wmedian(list.map(function (m) {
      return { v: m.readings.bracelet && m.readings.bracelet.D, w: m.weight || 1 };
    }));
    var ref = referenceReadings({ acc: extra.acc, grid: extra.grid, bracelet: bref });
    var members = list.map(function (m) {
      var c = compare(T, axis, m.readings, ref);
      var mult = Math.exp(c.total / 100);
      return { name: m.name, ilvl: m.ilvl, cp: m.cp, mult: mult, k: m.cp / mult, weight: m.weight || 1 };
    });
    var K = wmedian(members.map(function (x) { return { v: x.k, w: x.weight }; }));
    return { K: K, braceletRef: bref, n: members.length, members: members };
  }

  // ---- the score -----------------------------------------------------------
  /**
   * score({ axis, tables, readings, why, calib, reference })
   *
   *   tables     tables() for this axis
   *   readings   the character: { armor: {pieces|level}, weapon, karma, gems: [..],
   *              stone: "a-b", bracelet: {D,label}, acc: {slot: {D,label}},
   *              grid: {D,label}, master: bool }; anything missing is unscored
   *   why        { system: reason }  why a system is missing, for `unscored`
   *   calib      calibrate()'s answer for this axis ({ K, braceletRef, n })
   *   reference  { acc: {kind: D}, grid: D }  the reference's lattice and grid damage
   *
   * Returns { score, display, axis, mult, D, K, parts: [{ system, label, rung,
   * refRung, D, mult, note }], unscored: [{ system, label, why, always? }],
   * panel: { n }, refNote } — or { score: null, why } when nothing can be
   * scored. `mult` is the damage multiplier against the reference character.
   */
  function score(inp) {
    var axis = inp.axis === "support" ? "support" : "dps";
    var T = inp.tables, cal = inp.calib;
    if (!T || !cal || !isNum(cal.K)) return { score: null, axis: axis, why: "the score's tables or calibration did not load" };
    var ref = referenceReadings({ acc: inp.reference && inp.reference.acc, grid: inp.reference && inp.reference.grid,
                                  bracelet: cal.braceletRef });
    var c = compare(T, axis, inp.readings || {}, ref, inp.why);
    if (!c.parts.length) return { score: null, axis: axis, why: "nothing in the pull could be scored", unscored: c.unscored };
    ALWAYS_UNSCORED[axis].forEach(function (u) { c.unscored.push({ system: u[0], label: u[1], why: u[2], always: true }); });
    var s = cal.K * Math.exp(c.total / 100);
    return { score: s, display: Math.round(s), axis: axis, D: c.total, mult: Math.exp(c.total / 100), K: cal.K,
             parts: c.parts, unscored: c.unscored, panel: { n: cal.n },
             refNote: REFERENCE.note, version: VERSION };
  }

  // ---- adapters ------------------------------------------------------------
  /**
   * GpdLookup.place()'s answer -> score()'s input. place() lays the readings
   * on its answer (`readings`, `why`); this picks them up with the axis.
   */
  function fromLookup(placeAnswer, extras) {
    extras = extras || {};
    if (!placeAnswer) return null;
    return { axis: extras.axis || placeAnswer.axis, readings: placeAnswer.readings || {},
             why: placeAnswer.readingsWhy || {}, tables: extras.tables, calib: extras.calib,
             reference: extras.reference };
  }
  /**
   * The chart's plan at one budget -> readings. `plan` is the chart's planAt()
   * answer; `extras` = { accBase: {kind: D of the growth-shop piece},
   * gridD: the ark grid damage the plan holds, braceletFloor }. An accessory
   * rung is worn on both pieces of a pair: the second piece's step costs the
   * same per 1%, so it sits under the slider too.
   */
  function fromPlan(plan, extras) {
    extras = extras || {};
    function lvl(key, dflt) {
      var p = plan[key];
      return p && p.taken && p.last ? (num(p.last.to) != null ? num(p.last.to) : dflt) : dflt;
    }
    var a = lvl("armor", HONE_MIN);
    var rd = {
      armor: { pieces: { head: a, shoulders: a, torso: a, legs: a, hands: a } },
      weapon: lvl("weapon", HONE_MIN), karma: lvl("karma", KARMA_BASE),
      gems: [], stone: plan.stone && plan.stone.taken && plan.stone.last ? String(plan.stone.last.to).trim() : "7-7",
      master: false, evolution: 140, acc: {}
    };
    var g = lvl("gems", GEM_MIN);
    for (var i = 0; i < GEM_SLOTS; i++) rd.gems.push(g);
    var br = plan.bracelet;
    var bD = br && br.taken && br.last && isNum(br.last.totalDamage) ? br.last.totalDamage : extras.braceletFloor;
    if (isNum(bD)) rd.bracelet = { D: bD, label: br && br.taken && br.last ? String(br.last.to).trim() : "F" };
    ACC_SLOTS.forEach(function (s) {
      var kind = ACC_KIND[s], p = plan[kind], base = extras.accBase && extras.accBase[kind];
      if (!isNum(base)) return;
      rd.acc[s] = { D: base + (p ? p.damage : 0),
                    label: p && p.taken && p.last ? String(p.last.to).split(" · ")[0] : "growth shop piece" };
    });
    if (isNum(extras.gridD)) rd.grid = { D: extras.gridD, label: extras.gridLabel || "" };
    return rd;
  }

  /** "8,120" — the score as the game prints CP: whole numbers, grouped. */
  function fmt(s) {
    if (!isNum(s)) return "—";
    return Math.round(s).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  return {
    VERSION: VERSION, SYSTEMS: SYSTEMS, ALWAYS_UNSCORED: ALWAYS_UNSCORED, REFERENCE: REFERENCE,
    ARMOR_SLOTS: ARMOR_SLOTS, SLOT_ALIAS: SLOT_ALIAS, ACC_SLOTS: ACC_SLOTS, ACC_KIND: ACC_KIND,
    tables: tables, levels: levels, compare: compare, calibrate: calibrate, wmedian: wmedian,
    DUMMY_SUPPORT_AP: DUMMY_SUPPORT_AP, fixedPartner: fixedPartner,
    score: score, stoneOwns: stoneOwns, referenceReadings: referenceReadings,
    fromLookup: fromLookup, fromPlan: fromPlan, fmt: fmt
  };
});
