/**
 * build-bracelet-lines.js — the exact wording table for bracelet hovers.
 *
 * The sentences are the in-game English as maxroll's bracelet guide prints
 * them (T4 Ancient, maxroll.gg/lost-ark/resources/bracelet-system-guide),
 * with every low/mid/high spread collapsed to ONE tier's value per variant:
 * a legendary roll reads "+3%", never "+2/2.5/3%". Family ids and the chip
 * names line up with the bracelet calculator's SPECIALS table, which the
 * row generators already emit.
 */
"use strict";
var fs = require("fs");

// exact maxroll sentences, spreads intact — collapsed per tier below
var WORDING = {
  1: "Attack and Movement Speed +4/5/6%.",
  2: "Damage to Challenge or lower foes +4/5/6%.",
  3: "Damage received from Challenge or lower foes -6/8/10%.",
  4: "Physical Defense +5,000/6,000/7,000.",
  5: "Magic Defense +5,000/6,000/7,000.",
  6: "Max HP +11,200/14,000/16,800.",
  7: "Combat HP Recovery +100/130/160.",
  8: "Natural Resource Recovery +8/10/12%.",
  9: "Movement Skill & Stand-up Skill Cooldown -8/10/12%.",
  10: "When hit by an attack, gain Push Immunity for 80/70/60s. This effect disappears after being hit once (80/70/60s cooldown).",
  11: "Crit Rate +3.4/4.2/5%. On successful Crit Hit, Damage +1.5%.",
  12: "Critical Hit Damage +6.8/8.4/10%. On successful Crit Hit, Damage +1.5%.",
  13: "Damage +2/2.5/3%. Damage against Staggered foes +4/4.5/5%.",
  14: "Additional Damage +2.5/3/3.5%. Damage against Demon & Arch-Demon enemies +2.5%.",
  15: "Damage +4.5/5/5.5%, but Skill Cooldown +2%.",
  16: "On successful hit, enemy defense -1.8/2.1/2.5%. This effect can only be applied once per party. Attack Power buff efficiency +2/2.5/3%.",
  17: "On successful hit, enemy crit resistance -1.8/2.1/2.5%. This effect can only be applied once per party. Attack Power buff efficiency +2/2.5/3%.",
  18: "Upon granting allies a Shield, HP Regen, or Incoming Damage Reduction effect, they gain Damage +0.9/1.1/1.3%. Attack Power buff efficiency +2/2.5/3%.",
  19: "On successful hit, enemy critical hit resistance -3.6/4.2/4.8%. This effect can only be applied once per party. Attack Power buff efficiency +2/2.5/3%.",
  20: "On successful hit, Weapon Power +1,160/1,320/1,480 and Attack and Movement Speed +1% every 1s (max 6 stacks, 10s duration).",
  21: "Weapon Power +7,200/8,100/9,000. When your HP is above 50%, on successful hit Weapon Power +2,000/2,200/2,400 for 5s.",
  22: "Weapon Power +6,900/7,800/8,700. On successful hit, Weapon Power +130/140/150 every 30s (max 30 stacks, 120s duration).",
  23: "Damage +2/2.5/3%.",
  24: "Additional Damage +3/3.5/4%.",
  25: "Back Attack Damage +2.5/3/3.5%.",
  26: "Front Attack Damage +2.5/3/3.5%.",
  27: "Non-Directional Attack Damage +2.5/3/3.5% (does not apply to Awakening skills).",
  28: "HP Recovery and Shield effects' efficiency on party members +2.5/3/3.5%.",
  29: "Attack Power buff efficiency +4/5/6%.",
  30: "Identity buff efficiency on party members +6/7.5/9%.",
  31: "Crit Rate +3.4/4.2/5%.",
  32: "Critical Hit Damage +6.8/8.4/10%.",
  33: "Weapon Power +7,200/8,100/9,000."
};

// chip names: longer than the old two-word shorts, still one-row friendly
var MED = {
  1: "atk+move spd", 2: "dmg to lower", 3: "less dmg taken", 4: "phys def",
  5: "magic def", 6: "max hp", 7: "hp regen", 8: "resource regen",
  9: "move cooldown", 10: "push immunity", 11: "crit rate+", 12: "crit dmg+",
  13: "dmg+stagger", 14: "add dmg+demon", 15: "dmg, +cd", 16: "def shred",
  17: "crit shred", 18: "shield dmg+", 19: "cdmg shred", 20: "wp x6 stack",
  21: "wp hp>50%", 22: "wp x30 stack", 23: "damage", 24: "add damage",
  25: "back atk", 26: "front atk", 27: "non-directional", 28: "heal+shield eff",
  29: "ally atk buff", 30: "identity buff", 31: "crit rate", 32: "crit dmg",
  33: "weapon power"
};

// collapse every "a/b/c" spread to the k-th value (0 blue, 1 epic, 2 LEG)
var SPREAD = /(\d[\d,]*(?:\.\d+)?)\/(\d[\d,]*(?:\.\d+)?)\/(\d[\d,]*(?:\.\d+)?)/g;
function atTier(sentence, k) {
  return sentence.replace(SPREAD, function (_, a, b, c) { return [a, b, c][k]; });
}

var out = {};
Object.keys(WORDING).forEach(function (id) {
  out[id] = {
    med: MED[id] || "",
    tiers: { blue: atTier(WORDING[id], 0), epic: atTier(WORDING[id], 1), LEG: atTier(WORDING[id], 2) }
  };
});

fs.writeFileSync("data/bracelet-lines.json", JSON.stringify(out, null, 1));
console.log(Object.keys(out).length + " families -> data/bracelet-lines.json");
[17, 22, 29].forEach(function (id) {
  console.log("  " + id + " LEG: " + out[id].tiers.LEG);
});
