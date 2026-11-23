/**
 * build-vambrace-dps.js — the DPS chart's vambrace damage, from its parts.
 *
 *   node tools/build-vambrace-dps.js          rewrite `vambraceDamage` in data/rows-dps.json
 *   node tools/build-vambrace-dps.js --check  exit 1 if the file differs from what this computes
 *
 * The page cannot work this out itself: a dealer's attack power is the
 * bracelet calculator's model, which the chart loads only for a lookup. So it
 * is baked here, the way `honingDamage` is, and the page reads it
 * (lookup.js steps()). The support axis needs no bake: gear.js and support.js
 * price a vambrace live.
 *
 * THE CHARACTER is the DPS axis's reference (docs/research/dps-axis.md): the
 * bracelet model's default build — ilvl 1785, armour +21 with gloves +23, the
 * weapon +25 — with the axis's four overrides. Only the vambrace moves.
 *
 * THE FORMULA. A vambrace's main stat and weapon power go in raw and take the
 * percentage buckets with them, as the bracelet model's attackPower() takes any
 * raw stat. Its flat basic attack power is added to the square root, inside the
 * attack-power percentage, and a limit break's 1% joins that percentage:
 *
 *   AP = (sqrt(MS × WP / 6) + flat) × (1 + baseApPct + break%) + flatAP
 *
 * `base` is the Epic +0 piece against wearing none: it costs nothing, so it is
 * no row, but a character who has it deals that much more (the Loseii Score
 * counts it). `steps[N]` is +N-1 → +N, each with its limit break done, so
 * steps[10] carries the Legendary break. `breaks[N]` is that break on its own,
 * at +N: what a character who has reached +N and not done it yet is short.
 * Damage is 100·ln(ratio), the chart's scale.
 */
"use strict";
var fs = require("fs"), path = require("path");
var G = path.dirname(__dirname) + path.sep, R = path.dirname(path.dirname(__dirname)) + path.sep;
var FILE = G + "data/rows-dps.json";

// docs/research/dps-axis.md, "The reference character"
var OVERRIDES = { wpPct: 0.081, baseApPct: 0.2948, flatAP: 3600, flatWP: 0 };

function compute() {
  var B = require(R + "loa-bracelet-calc/model/bracelet.js");
  var V = require(G + "model/vambrace.js");
  var data = JSON.parse(fs.readFileSync(G + "data/vambrace.json", "utf8"));
  var P = Object.assign({}, B.normalizeProfile({}), OVERRIDES);
  function attack(v) {
    var p = Object.assign({}, P, { baseApPct: P.baseApPct + v.apPct });
    return B.attackPower(p, v.ms, v.wp) + v.apFlat * (1 + p.baseApPct);
  }
  function D(a, b) { return Math.round(100 * Math.log(attack(b) / attack(a)) * 1e5) / 1e5; }
  var out = { base: D(V.NONE, V.statsAt(data, 0)), steps: {}, breaks: {} };
  for (var lv = 1; lv <= data.maxLevel; lv++) out.steps[String(lv)] = D(V.statsAt(data, lv - 1), V.statsAt(data, lv));
  Object.keys(data.limitBreak).forEach(function (cap) {
    out.breaks[cap] = D(V.statsAt(data, +cap, V.gradeAt(data, +cap - 1).grade), V.statsAt(data, +cap));
  });
  return { damage: out, attackNone: attack(V.NONE), attackMax: attack(V.statsAt(data, data.maxLevel)) };
}

if (require.main === module) {
  var got = compute();
  var data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (process.argv.indexOf("--check") >= 0) {
    var same = JSON.stringify(data.vambraceDamage) === JSON.stringify(got.damage);
    console.log(same ? "vambrace damage matches its parts"
      : "vambrace damage differs from its parts — run node tools/build-vambrace-dps.js");
    process.exit(same ? 0 : 1);
  }
  var out = {};
  Object.keys(data).forEach(function (k) {
    if (k !== "vambraceDamage") out[k] = data[k];
  });
  out.vambraceDamage = got.damage;
  fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
  var total = got.damage.base;
  Object.keys(got.damage.steps).forEach(function (k) { total += got.damage.steps[k]; });
  console.log("attack power " + Math.round(got.attackNone) + " with no vambrace, " + Math.round(got.attackMax) + " at +25");
  console.log("the +0 piece " + got.damage.base + "%, +1 to +25 " + (total - got.damage.base).toFixed(3) + "%, in all " +
    total.toFixed(3) + "% (x" + Math.exp(total / 100).toFixed(4) + ")");
}

module.exports = { compute: compute, OVERRIDES: OVERRIDES };
