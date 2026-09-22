/**
 * bracelet-vs-gpd.js — how good a bracelet a support keeps rolling for, at
 * every budget on the slider, with a real rolled bracelet to show for it.
 *
 *   node tools/bracelet-vs-gpd.js [samples]
 *
 * THE STRATEGY. Unlike the rung ladder, this prices the OTHER way a bracelet
 * gets made: you buy random unrolled bracelets off the market and keep the
 * best one, so the stat pair is whatever it lands on. A budget buys rolls
 * until the next roll's expected gain costs more per 1% than the budget
 * allows, and E[best of n] over the score distribution says where that ends.
 *
 * Both halves must price the SAME roll: an earlier cut priced a chosen pair
 * while scoring random-stat rolls, and the audit caught rolls 16-18 costing
 * 131k each against a stopping rule comparing 63k.
 *
 * SCORED BY THE CALCULATOR (2026-09-16), like both rung ladders since
 * ba4c708. Everything runs through jointScore with the support profile and
 * the anchors braceletScore reports, so one bracelet cannot grade two ways
 * across this project. What changed when it moved over:
 *
 *   - The local model's span ran 2.5% wide, shading scores about two points.
 *   - Examples dropped their main-stat line. On a support bracelet that line
 *     is worth 0.317 D, a third of a good special, so the lines a card SHOWS
 *     could not account for the rank printed beside them. Examples are now
 *     fully displayable AND exact-verified: the calculator is asked to grade
 *     the shown lines, and the bracelet is only used if its band matches.
 *
 * Writes data/bracelet-vs-gpd.json.
 */
"use strict";
var fs = require("fs");
var D = require("../../loa-bracelet-calc/data/bracelet-data.js");
var BC = require("../../loa-bracelet-calc/model/bracelet.js");
var S = require("../../loa-bracelet-calc/subrank.js");
var P = require("../model/bracelet-price.js");

var M = parseInt(process.argv[2], 10) || 400000;
var PARTY = 3;
var SUP = BC.normalizeProfile({ role: "support" });

var LINE_NAMES = JSON.parse(fs.readFileSync("data/bracelet-lines.json", "utf8"));
function nameOf(id) {
  var f = LINE_NAMES[id];
  return (f && f.med) ? f.med : ("f" + id);
}

// ---- anchors, straight off the calculator -----------------------------------
var probe = S.braceletScore({ grade: "ancient", lines: [],
  traits: { spec: 61, swift: 61 }, profile: SUP });
var floorD = probe.floor, span = probe.perfect - probe.floor;

// ---- the roll ---------------------------------------------------------------
// Line worth depends on the traits it rides with, but the KEEP policy only
// needs a ranking, so it runs off one reference pair. The final score of
// every bracelet is exact, with its own stats.
var TIERS = ["low", "mid", "high"];
var REF = { spec: 90, swift: 90 };
var refBase = BC.jointScore([], REF, "ancient", SUP);
var VAL = {}, WEIGHT = {};
D.SPECIALS.forEach(function (sp) {
  VAL[sp.id] = TIERS.map(function (t) {
    try {
      return BC.jointScore([{ cat: "special", family: sp.id, tier: t }], REF, "ancient", SUP) - refBase;
    } catch (e) { return 0; }
  });
  WEIGHT[sp.id] = TIERS.map(function (t) { return sp.granted[t]; });
});
var refBasicMin = BC.jointScore([{ cat: "basic", family: "mainStat", value: 9600 }], REF, "ancient", SUP) - refBase;
var refBasicMax = BC.jointScore([{ cat: "basic", family: "mainStat", value: 16000 }], REF, "ancient", SUP) - refBase;

var BASIC_BANDS = [[10, 9600, 10240], [16, 10241, 10880], [16, 10881, 11520], [16, 11521, 12160],
  [10, 12161, 12800], [10, 12801, 13440], [10, 13441, 14080], [4, 14081, 14720],
  [4, 14721, 15360], [4, 15361, 16000]];
// the market's stat bands, 61-120; used for the roll AND for the roll's price
var BANDS = [[10, 61, 66], [16, 67, 72], [16, 73, 78], [16, 79, 84], [10, 85, 90],
  [10, 91, 96], [10, 97, 102], [4, 103, 108], [4, 109, 114], [4, 115, 120]];

function m32(s){var a=s>>>0;return function(){a=(a+0x6D2B79F5)|0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
var rand = m32(20260814);

function pick(weights) {
  var total = 0, i;
  for (i = 0; i < weights.length; i++) total += weights[i];
  var r = rand() * total;
  for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}
function bandRoll(bands) {
  var b = bands[pick(bands.map(function (x) { return x[0]; }))];
  return b[1] + Math.floor(rand() * (b[2] - b[1] + 1));
}

/** One granted slot. Basics keep their RAW stat so the score can be exact. */
function drawSlot(used) {
  if (used.basics < 2 && rand() * 65 < 35) {
    used.basics++;
    if (rand() < 0.5) return { value: 0, fam: 0, tier: -1, raw: 0 };   // vitality
    var v = bandRoll(BASIC_BANDS);
    return { value: refBasicMin + (refBasicMax - refBasicMin) * ((v - 9600) / 6400),
             fam: 0, tier: -1, raw: v };
  }
  var pool = [], w = [];
  D.SPECIALS.forEach(function (sp) {
    if (used.fams[sp.id]) return;
    for (var t = 0; t < 3; t++) { pool.push([sp.id, t]); w.push(WEIGHT[sp.id][t]); }
  });
  var h = pool[pick(w)];
  used.fams[h[0]] = true;
  return { value: VAL[h[0]][h[1]], fam: h[0], tier: h[1], raw: 0 };
}

function lockThresholds() {
  var draws = [];
  for (var i = 0; i < 200000; i++) draws.push(drawSlot({ basics: 0, fams: {} }).value);
  var TH = [0];
  for (var n = 1; n <= 7; n++) {
    var sum = 0;
    for (var j = 0; j < draws.length; j++) sum += Math.max(draws[j], TH[n - 1]);
    TH.push(sum / draws.length);
  }
  return TH;
}
var TH = lockThresholds();

function rollLines() {
  var held = [], i;
  for (var attempt = 7; attempt >= 1; attempt--) {
    var used = { basics: 0, fams: {} };
    for (i = 0; i < held.length; i++) {
      if (held[i].fam) used.fams[held[i].fam] = true;
      if (held[i].tier === -1) used.basics++;
    }
    for (i = held.length; i < 3; i++) held.push(drawSlot(used));
    if (attempt === 1) break;
    held.sort(function (a, b) { return b.value - a.value; });
    var fl = TH[Math.min(attempt - 1, TH.length - 1)];
    held = held.filter(function (x) { return x.value >= fl; });
  }
  return held;
}

var TIER_NAME = ["low", "mid", "high"];
function linesFor(held) {
  return held.filter(function (x) { return x.fam && x.tier >= 0; })
    .map(function (x) { return { cat: "special", family: x.fam, tier: TIER_NAME[x.tier] }; });
}
function chipsOf(held) {
  return held.filter(function (x) { return x.fam && x.tier >= 0; })
    .map(function (x) { return { name: nameOf(x.fam), id: x.fam,
      tier: x.tier === 2 ? "LEG" : x.tier === 1 ? "epic" : "blue" }; });
}

// ---- sample the score distribution, keeping real bracelets per score bin -----
var BIN = 0.25, MAXS = 140;
var nbin = Math.ceil(MAXS / BIN);
var count = new Float64Array(nbin), cand = new Array(nbin);
// score is affine in damage, so a bin's damage is its centre mapped back
var damages = new Float64Array(nbin);
for (var db = 0; db < nbin; db++) damages[db] = floorD + (db + 0.5) * BIN * span / 100;

for (var i = 0; i < M; i++) {
  var spec = bandRoll(BANDS), swift = bandRoll(BANDS);
  var held = rollLines();
  var traits = { spec: spec, swift: swift };
  var lines = linesFor(held);
  var basic = held.filter(function (x) { return x.tier === -1 && x.raw > 0; })[0];
  var scored = lines.slice();
  if (basic) scored.push({ cat: "basic", family: "mainStat", value: basic.raw });
  var total = BC.jointScore(scored, traits, "ancient", SUP);
  var sc = 100 * (total - floorD) / span;
  var b = Math.max(0, Math.min(nbin - 1, Math.floor(sc / BIN)));
  count[b]++;
  // only a bracelet a card can draw IN FULL is a candidate picture
  if (!basic) {
    if (!cand[b]) cand[b] = [];
    if (cand[b].length < 60) {
      cand[b].push({ spec: spec, swift: swift, lines: lines, chips: chipsOf(held), score: sc });
    }
  }
}

// A score can be reached by good stats or by good lines, so the first bracelet
// into a bin is not a fair picture of it. Take the one whose stat total sits in
// the middle, which reads as the typical bracelet at that score — then ask the
// calculator to confirm it grades where the bin says.
var rep = cand.map(function (list, bi) {
  if (!list || !list.length) return null;
  var sorted = list.slice().sort(function (x, y) {
    return (x.spec + x.swift) - (y.spec + y.swift);
  });
  var want = S.of((bi + 0.5) * BIN, "support").key;
  for (var off = 0; off < sorted.length; off++) {
    var m = (sorted.length >> 1) + (off % 2 ? -((off + 1) >> 1) : ((off + 1) >> 1));
    if (m < 0 || m >= sorted.length) continue;
    var c = sorted[m];
    var band = S.braceletScore({ grade: "ancient", lines: c.lines,
      traits: { spec: c.spec, swift: c.swift }, profile: SUP }).band.key;
    if (band === want) return c;
  }
  return null;
});

// cumulative distribution
var cdf = new Float64Array(nbin), acc = 0;
for (i = 0; i < nbin; i++) { acc += count[i] / M; cdf[i] = acc; }

/** E[best of n] on the score scale, and the matching damage. */
function bestOf(n) {
  var prev = 0, es = 0, ed = 0;
  for (var k = 0; k < nbin; k++) {
    if (!count[k]) continue;
    var p = Math.pow(cdf[k], n) - prev;
    prev = Math.pow(cdf[k], n);
    es += (k + 0.5) * BIN * p;
    ed += damages[k] * p;
  }
  return { score: es, damage: ed };
}

// ---- what a roll costs ------------------------------------------------------
// The exact expectation of the market fit over Stove's banded stat pair — one
// constant, because the rolls being averaged are random-stat rolls.
var ROLL_COST = (function () {
  var e = 0, w = 0;
  BANDS.forEach(function (a) {
    BANDS.forEach(function (b) {
      for (var x = a[1]; x <= a[2]; x++) for (var y = b[1]; y <= b[2]; y++) {
        var pw = (a[0] / (a[2] - a[1] + 1)) * (b[0] / (b[2] - b[1] + 1));
        e += pw * P.allIn(x, y); w += pw;
      }
    });
  });
  return e / w;
})();

// ---- walk the budget --------------------------------------------------------
var GPDS = [];
for (var g = 250000; g <= 25000000; g *= Math.pow(100, 1 / 24)) GPDS.push(Math.round(g));

var out = GPDS.map(function (gpd) {
  var n = 1, cur = bestOf(1);
  for (var guard = 0; guard < 20000; guard++) {
    var nxt = bestOf(n + 1);
    var gain = nxt.damage - cur.damage;
    if (gain <= 1e-9) break;
    if (ROLL_COST / (gain * PARTY) > gpd) break;
    n++; cur = nxt;
  }
  // the real bracelet nearest E[best of n]
  var bi = Math.max(0, Math.min(nbin - 1, Math.round(cur.score / BIN)));
  var found = null;
  for (var d = 0; d < nbin && !found; d++) {
    if (rep[bi - d]) found = rep[bi - d];
    else if (rep[bi + d]) found = rep[bi + d];
  }
  return { gpd: gpd, rolls: n, score: Number(cur.score.toFixed(2)),
    damage: Number(cur.damage.toFixed(4)), rank: S.of(cur.score, "support").key,
    gold: Math.round(n * ROLL_COST),
    example: found ? { stats: found.spec + "/" + found.swift, lines: found.chips,
                       score: Number(found.score.toFixed(1)) } : null };
});

console.log(M.toLocaleString() + " samples   floor " + floorD.toFixed(4) +
  "   perfect " + probe.perfect.toFixed(4) + "   span " + span.toFixed(4) + "\n");
console.log("gpd".padStart(9) + "rolls".padStart(8) + "rank".padStart(6) +
  "score".padStart(8) + "damage".padStart(9) + "  example");
out.forEach(function (r) {
  console.log(((r.gpd / 1e6).toFixed(2) + "M").padStart(9) + String(r.rolls).padStart(8) +
    r.rank.padStart(6) + r.score.toFixed(1).padStart(8) + r.damage.toFixed(3).padStart(9) +
    "  " + (r.example ? r.example.stats + "  " + r.example.lines.map(function (l) {
      return l.name + " " + l.tier; }).join(", ") : "-"));
});
fs.writeFileSync("data/bracelet-vs-gpd.json",
  JSON.stringify({ samples: M, party: PARTY, rows: out }, null, 1));
console.log("\nwrote data/bracelet-vs-gpd.json");
