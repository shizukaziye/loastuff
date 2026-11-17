/* Presets: field id -> value as typed (percentages as whole numbers). */
(function (root) {
  'use strict';
  const MODEL_DEFAULTS = {
    skillCoef: 1, skillFlat: 0, gCrit: 0, critCap: 50, ccPer100: 10,
    partyDb: 0, partyDbl: 0, partyCd: 0, dblModel: 'sub',
    mhBase: 20, mhBonus: 15, mhElig: 100, mhPos: 'out',
    mhModel: 'flat', pfHidden: 7, csEff: 50, deityPer: 0.1, psdb: 0, baseAtk: 0,
    critMode: 'rating', critBuff: 0, critRes: 0, critChance: 0, cdr: 0
  };
  /* A key left out of a target (critRes on the Korean ones) is left as the user has it. */
  const TARGETS = {
    dummy: { label: 'Training dummy', tol: 10, dblRes: 0, cdTol: 0, wTol: 0, def: 0, critRes: 0 },
    boss:  { label: 'Early dungeon boss (placeholder)', tol: 30, dblRes: 0, cdTol: 0, wTol: 0, def: 0, critRes: 700 },
    ludra: { label: 'Ludra, Global', tol: 30, dblRes: 0, cdTol: 0, wTol: 0, def: 0, critRes: 1200 },
    t4:    { label: 'Transcendence 4 last boss (Korean test)', tol: 44, dblRes: 0, cdTol: 25, wTol: 15, def: 6373 },
    kr:    { label: 'KR endgame raid boss', tol: 50, dblRes: 30, cdTol: 25, wTol: 0, def: 0 }
  };
  const BOSS = { target: 'boss', tol: 30, dblRes: 0, cdTol: 0, wTol: 0, def: 0, critRes: 700 };
  const LUDRA = { target: 'ludra', tol: 30, dblRes: 0, cdTol: 0, wTol: 0, def: 0, critRes: 1200 };
  const SHUGO = 'Summed from what Shugo.GG showed on Nov 16, 2026: gear, soul binding, manastones, Daevanion, wings, titles and deity points';
  const MISSING = ' Pets, collections, skill buffs, food and party buffs are missing, so check Critical Hit against the game.';
  const RANGER_MISSING = ' Not included: Marking Shot’s Precision (+300 Critical Hit), Gale Arrow (+7% Combat Speed and PvE Damage Boost), pets, collections, food and party buffs. Check Critical Hit against the game.';
  /* Attack in the window = (Pure Attack at the middle of the weapon range + Attack Bonus + base Attack) x (1 + Attack Increase).
     Only Bu's is read in game. Her gear, bonus and increase explain 2,444 of the 2,722 shown, which leaves 237 before Attack
     Increase as base Attack (level, class, collections). The other sheets carry the same 237 and their Attack is predicted. */
  const BASE = 237;
  const PREDICTED = ' Attack is predicted, not read in game: the gear sum plus the 237 base Attack that Bu\u2019s in-game figure implies. Type your own number over it.';
  const PRESETS = {
    sorc: {
      label: 'Sorc, Sorcerer 3141',
      ring: { atk: 33, enh: '+15 amplified to +17', server: 'nezekan' },
      note: SHUGO + ', plus Robe of Flame 27 and Grace of Enhancement. The spellbook\u2019s tooltip did not load, so its Attack is the item\u2019s base figure and its lines and manastones are missing. Not included: Wish of Concentration, Element Enhancement, the pet, collections, food and party buffs. Check Critical Hit against the game.' + PREDICTED,
      values: Object.assign({}, MODEL_DEFAULTS, LUDRA, {
        // pure 2,240 = 2,141 gear (spellbook 436-484 +160 +39 at its 659 midpoint, guard 359, necklace 217, earrings 390, rings 344, bracelets 172) + 74 lines + 25 stones
        // bonus 239 = 135 Daevanion + 34 title + 70 wings; increase 14.9 = Might 76 + Destruction 73
        sheetAtk: 3121, atkInc: 14.9, atkBonus: 239, baseAtk: BASE, wdb: 16.6, rangeW: 48, perfect: 10.1, shard: 5, psdb: 52,
        flatPve: 204, flatPos: 67, flatCrit: 0, pen: 1020,
        // Double 4.5 Wisdom + 1.4 cloak + 5.4 Robe of Flame; PvE boost 13.5 + 27 Robe of Flame + 20 Grace of Enhancement
        // cooldown 6.3 Illusion + 3 Daevanion + 4 wings + 3.5 title
        db: 14, pveDb: 60.5, bossDb: 4, dbl: 11.3, posDb: 0, uptime: 50, combatSpeed: 22.5, cdr: 16.8, multiHit: 6.5,
        critRating: 925, critInc: 15.9, critDmg: 3.1
      })
    },
    bu: {
      label: 'Bu, Cleric 2848 (Attack read in game)',
      ring: { atk: 26, enh: '+10', server: 'azphel' },
      note: 'Attack is the in-game figure with the helmet\u2019s 22 Attack line removed. The rest is summed from what Shugo.GG showed on Nov 16, 2026. Gear (1,848.5 at the middle of the mace\u2019s range), Attack Bonus (239) and Attack Increase (17.1%) explain 2,444 of the 2,722, and the remaining 237 before Attack Increase is entered as base Attack. Critical Damage Boost from Earth\u2019s Grace is counted at its level-1 value.' + MISSING,
      values: Object.assign({}, MODEL_DEFAULTS, LUDRA, {
        // gear sum, top roll: 1,812 gear (mace 398+146+24) + 37 lines + 44 stones = 1,893; bonus 135 Daevanion + 34 title + 70 wings
        // increase 6.3 Might + 7.5 Destruction + 1.9 greaves + 1.4 cloak; Weapon Damage Boost 10 from the amulet only
        sheetAtk: 2722, atkInc: 17.1, atkBonus: 239, baseAtk: BASE, wdb: 10, rangeW: 89, perfect: 10.1, shard: 5, psdb: 43,
        flatPve: 258, flatPos: 0, flatCrit: 0, pen: 930,
        db: 17.8, pveDb: 13.5, bossDb: 2, dbl: 8.6, posDb: 0.3, uptime: 50, combatSpeed: 38.9, cdr: 15, multiHit: 21.9,
        critRating: 722, critInc: 8.9, critDmg: 24
      })
    },
    paroxysmal: {
      label: 'Paroxysmal, Ranger 3396',
      ring: { atk: 34, enh: '+15 amplified to +18', server: 'nezekan' },
      note: SHUGO + ', plus Focused Eye 25 and Hunter’s Resolve 20.' + RANGER_MISSING + PREDICTED,
      values: Object.assign({}, MODEL_DEFAULTS, LUDRA, {
        // pure 2,835.5 = 2,580 gear + 248 lines + 60 stones - half the bow's 407-512 range; bonus 135 Daevanion + 60 wings + 34 title
        sheetAtk: 3942, atkInc: 19.4, atkBonus: 229, baseAtk: BASE, wdb: 26.9, rangeW: 105, perfect: 13.3, shard: 5, psdb: 70,
        flatPve: 209, flatPos: 0, flatCrit: 0, pen: 1300,
        // Double 6.6 Wisdom + 5 Focused Eye; PvE boost 14.5 + 25 Focused Eye; crit damage 15.1 + 25 Hunter's Resolve
        db: 36.7, pveDb: 39.5, bossDb: 4, dbl: 11.6, posDb: 0.3, uptime: 50, combatSpeed: 48.9, cdr: 10.7, multiHit: 6.5,
        critRating: 974, critInc: 17.1, critDmg: 40.1
      })
    },
    shizukaziye: {
      label: 'Shizukaziye, Ranger 2222',
      ring: { atk: 26, enh: '+10', server: 'nezekan' },
      note: SHUGO + ', plus Focused Eye 16 and Hunter’s Resolve 16. The bow range is estimated from other bows.' + RANGER_MISSING + PREDICTED + ' The target’s tolerance and Critical Hit Resist are placeholders.',
      values: Object.assign({}, MODEL_DEFAULTS, BOSS, {
        sheetAtk: 2026, atkInc: 7.0, atkBonus: 163, baseAtk: BASE, wdb: 10, rangeW: 72, perfect: 11.5, shard: 5, psdb: 40,
        flatPve: 60, flatPos: 0, flatCrit: 0, pen: 900,
        db: 8.5, pveDb: 21.5, bossDb: 0, dbl: 5.9, posDb: 0, uptime: 50, combatSpeed: 14, cdr: 7.1, multiHit: 13.7,
        critRating: 750, critInc: 7.7, critDmg: 24
      })
    },
    limerent: {
      label: 'Limerent, Cleric 2610',
      ring: { atk: 26, enh: '+10', server: 'nezekan' },
      note: SHUGO + '. Cleric passives are not included and the mace range is estimated from bows.' + MISSING + PREDICTED + ' The target’s tolerance and Critical Hit Resist are placeholders.',
      values: Object.assign({}, MODEL_DEFAULTS, BOSS, {
        sheetAtk: 2318, atkInc: 10.5, atkBonus: 167, baseAtk: BASE, wdb: 10, rangeW: 66, perfect: 14.1, shard: 5, psdb: 40,
        flatPve: 60, flatPos: 0, flatCrit: 66, pen: 1500,
        db: 13.4, pveDb: 6, bossDb: 0, dbl: 2.3, posDb: 0, uptime: 50, combatSpeed: 14.7, cdr: 7.6, multiHit: 6.5,
        critRating: 543, critInc: 5.3, critDmg: 3
      })
    },
    indigo: {
      label: 'Indigo, Chanter 2424',
      ring: { atk: 26, enh: '+10', server: 'nezekan' },
      note: SHUGO + '. Chanter passives are not included. The necklace and gloves did not load, so the necklace Attack and the rod range are estimates.' + MISSING + PREDICTED + ' The target’s tolerance and Critical Hit Resist are placeholders.',
      values: Object.assign({}, MODEL_DEFAULTS, BOSS, {
        sheetAtk: 2172, atkInc: 7.7, atkBonus: 151, baseAtk: BASE, wdb: 10, rangeW: 100, perfect: 11.7, shard: 5, psdb: 46,
        flatPve: 60, flatPos: 0, flatCrit: 0, pen: 960,
        db: 3, pveDb: 5.5, bossDb: 0, dbl: 4.9, posDb: 0, uptime: 50, combatSpeed: 12.6, cdr: 5.5, multiHit: 14.4,
        critRating: 587, critInc: 9.5, critDmg: 3
      })
    },
    kr: {
      label: 'Reference: Korean endgame',
      note: 'A synthetic Korean Season 1 sheet, tuned so the model reproduces the published per-stat figures. Use it to check the model, not to plan gear.',
      values: Object.assign({}, MODEL_DEFAULTS, {
        sheetAtk: 10413, atkInc: 80, atkBonus: 500, baseAtk: 0, wdb: 77, rangeW: 128, perfect: 56, shard: 5, psdb: 0,
        flatPve: 600, flatPos: 0, flatCrit: 0, pen: 0,
        db: 130, pveDb: 60, bossDb: 40, dbl: 80, posDb: 30, uptime: 75, combatSpeed: 60, cdr: 0, multiHit: 38,
        critMode: 'manual', critChance: 80, critDmg: 90, critRating: 2500, critInc: 30,
        target: 'kr', tol: 50, dblRes: 30, cdTol: 25, wTol: 0, def: 0, critRes: 0,
        critCap: 80, ccPer100: 6.67, csEff: 100, partyDbl: 12, mhModel: 'chain', mhBase: 0, mhBonus: 12.5, pfHidden: 7, deityPer: 0.2
      })
    }
  };
  const api = { MODEL_DEFAULTS, TARGETS, PRESETS, DEFAULT: 'sorc' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.A2P = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
