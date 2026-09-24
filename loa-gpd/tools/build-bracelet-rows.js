/**
 * build-bracelet-rows.js — the bracelet ladder rows, from the model, at last.
 *
 *   node tools/build-bracelet-rows.js [rollsPerPair]
 *
 * The bracelet rows in data/rows.json were assembled by hand and the audit
 * showed what that costs: odds that disagreed with the model, materials that
 * did not sum to their own totals, and example bracelets for the bottom rungs
 * that actually rank C. This regenerates every bracelet artefact from one
 * simulation so they cannot drift apart again.
 *
 * THE STRATEGY BEING PRICED, per Shizu's original spec: you buy an UNROLLED
 * bracelet — its Spec and Swiftness are visible on the market — and roll its
 * three granted slots. So the odds of reaching a rung are conditioned on the
 * pair you bought, and each rung picks the even pair that minimises expected
 * cost, market price plus twenty pheons per attempt over the hit rate. A
 * whale chasing S+ buys 110/110 bases not because they are cheap but because
 * no lesser pair can clear the anchor at all.
 *
 * The first cut of this tool priced the pair and took odds from the full
 * random-stat population — the same mismatch the audit flagged in
 * bracelet-vs-gpd — and quoted twenty-six billion gold for S+. Conditioning
 * is what makes the top of the ladder cost what a player actually pays.
 *
 * Per rung:
 *   pair        argmin over {60..110 even} of allIn(pair)/P(cut | pair),
 *               held monotone so a higher rung never buys a cheaper base
 *   odds        1 in N rolled bracelets of THAT pair reaches the cut
 *   gold        marginal: this rung's expected total minus the rung below's
 *   damage      (cut - cut below) x span / 100
 *   totalDamage floor + cut x span / 100, the whole bracelet per dealer
 *   example     the pair's stats with really-rolled lines just above the cut
 *
 * Writes: bracelet rows in data/rows.json (other series untouched),
 * data/bracelet-hits.json, data/bracelet-cost.json.
 */
"use strict";
var fs = require("fs");
var D = require("../../loa-bracelet-calc/data/bracelet-data.js");
var BC = require("../../loa-bracelet-calc/model/bracelet.js");
var S = require("../../loa-bracelet-calc/subrank.js");
var P = require("../model/bracelet-price.js");

var K = parseInt(process.argv[2], 10) || 400000;    // rolls per pair
var PAIRS = [60, 70, 80, 90, 100, 110, 120];

// THE SCORER IS THE CALCULATOR'S OWN, as it already is on the DPS side
// (commit ba4c708). Two faults came out of the audit on 2026-09-16:
//
//   1. The examples dropped their main-stat line. On a support bracelet that
//      line is worth 0.317 D — a third of a good special — so re-scoring the
//      lines a card SHOWS landed a whole band under the rung's letter. The
//      rung itself was right; the picture under it was missing a line.
//   2. The local model's span ran 2.5% wide (5.793 against the authority's
//      5.647), which shaded every score about two points low.
//
// So: price through jointScore with the SUPPORT profile, read floor and
// perfect off braceletScore once, band on the authority's support cuts, and
// only keep an example a card can draw in full.
var SUP = BC.normalizeProfile({ role: "support" });
var LADDER = S.bandsFor("support").map(function (b) { return [b.key, b.min]; });

// Chip names come from data/bracelet-lines.json — the generated file the
// PAGE itself renders from. Two hand-kept maps used to live here and in the
// DPS builder, and they had drifted: family 28 is "party shield / heal
// effects", not "dmg to low", and 31/32 are the crit lines, not the shield
// ones. One source, no drift.
var LINE_NAMES = JSON.parse(fs.readFileSync("data/bracelet-lines.json", "utf8"));
function nameOf(id) {
  var f = LINE_NAMES[id];
  return (f && f.med) ? f.med : ("f" + id);
}

// ---- authority anchors + per-pair marginal tables ---------------------------
// The support pair is spec/swift. Line values are jointScore marginals AT the
// pair being bought: the joint pool prices a line against the traits it rides
// on, so one table per pair is the honest way to do it.
function traitsOf(p) { return { spec: p, swift: p }; }
var anchorsProbe = S.braceletScore({ grade: "ancient", lines: [],
  traits: traitsOf(61), profile: SUP });
var floorD = anchorsProbe.floor, span = anchorsProbe.perfect - anchorsProbe.floor;

var TIERS = ["low", "mid", "high"];
var TABLES = {};
PAIRS.forEach(function (p) {
  var tr = traitsOf(p);
  var base = BC.jointScore([], tr, "ancient", SUP);
  var VAL = {}, WEIGHT = {};
  D.SPECIALS.forEach(function (sp) {
    VAL[sp.id] = TIERS.map(function (t) {
      try {
        return BC.jointScore([{ cat: "special", family: sp.id, tier: t }], tr, "ancient", SUP) - base;
      } catch (e) { return 0; }
    });
    WEIGHT[sp.id] = TIERS.map(function (t) { return sp.granted[t]; });
  });
  var bMin = BC.jointScore([{ cat: "basic", family: "mainStat", value: 9600 }], tr, "ancient", SUP) - base;
  var bMax = BC.jointScore([{ cat: "basic", family: "mainStat", value: 16000 }], tr, "ancient", SUP) - base;
  TABLES[p] = { base: base, VAL: VAL, WEIGHT: WEIGHT, basicMin: bMin, basicSpan: bMax - bMin };
});

var BASIC_BANDS = [[10, 9600, 10240], [16, 10241, 10880], [16, 10881, 11520], [16, 11521, 12160],
  [10, 12161, 12800], [10, 12801, 13440], [10, 13441, 14080], [4, 14081, 14720],
  [4, 14721, 15360], [4, 15361, 16000]];

function m32(s){var a=s>>>0;return function(){a=(a+0x6D2B79F5)|0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
var rand = m32(20260815);

function pick(weights) {
  var total = 0, i;
  for (i = 0; i < weights.length; i++) total += weights[i];
  var r = rand() * total;
  for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

/** One granted slot: basic 35 / special 30 with both trait places filled. */
function drawSlot(used, T) {
  var canBasic = used.basics < 2;
  if (canBasic && rand() * 65 < 35) {
    used.basics++;
    if (rand() < 0.5) return { value: 0, fam: 0, tier: -1 };          // vitality
    var b = BASIC_BANDS[pick(BASIC_BANDS.map(function (x) { return x[0]; }))];
    var v = b[1] + Math.floor(rand() * (b[2] - b[1] + 1));
    return { value: T.basicMin + T.basicSpan * ((v - 9600) / 6400), fam: 0, tier: -1 };
  }
  var pool = [], w = [];
  D.SPECIALS.forEach(function (sp) {
    if (used.fams[sp.id]) return;
    for (var t = 0; t < 3; t++) { pool.push([sp.id, t]); w.push(T.WEIGHT[sp.id][t]); }
  });
  var hitp = pool[pick(w)];
  used.fams[hitp[0]] = true;
  return { value: T.VAL[hitp[0]][hitp[1]], fam: hitp[0], tier: hitp[1] };
}

/** lock thresholds V(n) = E[max(X, V(n-1))] over the slot distribution */
function lockThresholds(T) {
  var draws = [];
  for (var i0 = 0; i0 < 200000; i0++) draws.push(drawSlot({ basics: 0, fams: {} }, T).value);
  var TH = [0];
  for (var n0 = 1; n0 <= 7; n0++) {
    var sum = 0;
    for (var j0 = 0; j0 < draws.length; j0++) sum += Math.max(draws[j0], TH[n0 - 1]);
    TH.push(sum / draws.length);
  }
  return TH;
}

/** The granted-slot game with the stats already fixed. */
function rollLines(T, TH) {
  var held = [], i;
  for (var attempt = 7; attempt >= 1; attempt--) {
    var used = { basics: 0, fams: {} };
    for (i = 0; i < held.length; i++) {
      if (held[i].fam) used.fams[held[i].fam] = true;
      if (held[i].tier === -1) used.basics++;
    }
    for (i = held.length; i < 3; i++) held.push(drawSlot(used, T));
    if (attempt === 1) break;
    held.sort(function (a, b) { return b.value - a.value; });
    var fl = TH[Math.min(attempt - 1, TH.length - 1)];
    held = held.filter(function (x) { return x.value >= fl; });
  }
  return held;
}

var EXACT_PROFILE = SUP;

// An example is only accepted if the calculator's OWN scorer puts it in the
// rung's band. The per-pair tables sum line marginals independently, but
// jointScore pools them, so a bracelet that sums just over a cut can land
// just under it — which is exactly how a B+ example once verified as B. This
// makes the builder self-checking: what a card draws is guaranteed to grade
// as the letter above it. A second, wider pass keeps a fallback for bands too
// rare to catch near their cut (support S+ came out blank without it).
var TIER_NAME = ["low", "mid", "high"];
function exactBand(held, p) {
  var lines = held.filter(function (x) { return x.fam && x.tier >= 0; })
    .map(function (x) { return { cat: "special", family: x.fam, tier: TIER_NAME[x.tier] }; });
  return S.braceletScore({ grade: "ancient", lines: lines, traits: traitsOf(p),
    profile: EXACT_PROFILE }).band.key;
}
function chipsOf(held) {
  return held.filter(function (x) { return x.fam && x.tier >= 0; })
    .map(function (x) { return { name: nameOf(x.fam), id: x.fam,
      tier: x.tier === 2 ? "LEG" : x.tier === 1 ? "epic" : "blue" }; });
}

// ---- one population per pair ------------------------------------------------
var ASC = LADDER.slice().reverse();
var cuts = ASC.map(function (r) { return r[1] === -Infinity || r[1] == null ? 0 : r[1]; });
var hit = {}, ex = {}, exAny = {}, winSum = {}, winN = {};
PAIRS.forEach(function (p) {
  hit[p] = new Float64Array(ASC.length);
  winSum[p] = new Float64Array(ASC.length);
  winN[p] = new Float64Array(ASC.length);
  ex[p] = new Array(ASC.length);
  exAny[p] = new Array(ASC.length);
  var T = TABLES[p], TH = lockThresholds(T);
  for (var i = 0; i < K; i++) {
    var held = rollLines(T, TH), lines = 0, j;
    for (j = 0; j < held.length; j++) lines += held[j].value;
    var total = T.base + lines;
    var sc = 100 * (total - floorD) / span;
    var band = 0;
    for (var k = 0; k < ASC.length; k++) {
      if (sc < cuts[k] && k !== 0) continue;
      hit[p][k]++;
      band = k;
      // fully displayable (a value-carrying main-stat line earns score the
      // card cannot show) AND exact-verified against the calculator
      var hiddenBasic = held.some(function (x) { return x.tier === -1 && x.value > 0; });
      if (!ex[p][k] && !hiddenBasic && (sc < cuts[k] + 0.8 || k === 0)) {
        if (exactBand(held, p) === ASC[k][0]) ex[p][k] = chipsOf(held);
      }
    }
    // fallback for bands too rare to catch near their cut: any fully
    // displayable bracelet the calculator grades into this band
    if (!exAny[p][band] && !held.some(function (x) { return x.tier === -1 && x.value > 0; })) {
      if (exactBand(held, p) === ASC[band][0]) exAny[p][band] = chipsOf(held);
    }
    winSum[p][band] += total; winN[p][band]++;
  }
});

// ---- pick each rung's pair, monotone ---------------------------------------
var minPair = 60;
var rungs = ASC.map(function (r, k) {
  var best = null;
  PAIRS.forEach(function (p) {
    if (p < minPair || !hit[p][k]) return;
    var eCost = P.allIn(p, p, "support") * K / hit[p][k];
    if (!best || eCost < best.eCost) best = { pair: p, eCost: eCost, n: K / hit[p][k] };
  });
  if (best) minPair = best.pair;
  return { rank: r[0], cut: cuts[k], best: best };
});

// ---- the rows ---------------------------------------------------------------
var doc = JSON.parse(fs.readFileSync("data/rows.json", "utf8"));
var kept = doc.rows.filter(function (r) { return r.series !== "bracelet"; });
// The chain starts at F, not F-: every character owns SOME bracelet, so the
// chart prices climbing the ladder, not owning one at all. The F rung's cost
// seeds the running total so the first step's marginal is honest.
var rows = [], hits = {}, costs = {}, prevCut = 0, prevRank = "F";
var prevDmg = floorD;
var prevGold = rungs[1] && rungs[1].best ? Math.round(rungs[1].best.eCost) : 0;

for (var k2 = 2; k2 < rungs.length; k2++) {
  var r = rungs[k2];
  if (!r.best) break;
  var p = r.best.pair, n = r.best.n;
  var total = Math.round(r.best.eCost);
  var gold = Math.max(1, total - prevGold);
  var nDisp = Math.max(1, Math.round(n));
  var lines = ex[p][k2] || exAny[p][k2] || [];
  var lineTxt = lines.map(function (l) { return l.name + " " + l.tier; }).join(", ");
  hits[r.rank] = { stats: p + "/" + p, lines: lines };
  costs[r.rank] = { bracelets: nDisp, gold: total, pair: p + "/" + p };
  var bandDmg = winN[p][k2] ? winSum[p][k2] / winN[p][k2] : (floorD + r.cut * span / 100);
  rows.push({
    series: "bracelet",
    label: prevRank + " → " + r.rank,
    from: prevRank, to: r.rank,
    gold: gold,
    damage: Number(Math.max(0.0001, bandDmg - prevDmg).toFixed(5)),
    total: total,
    hit: { stats: p + "/" + p, lines: lines },
    minimum: p + "/" + p + " with " + (lineTxt || "no scoring line"),
    mats: [
      ["cut " + p + "/" + p + " bracelets", nDisp, n * P.listed(p, p, "support")],
      ["pheons", 20 * nDisp, n * P.PHEONS_PER_BRACELET * P.PHEON_GOLD]
    ],
    buy: p + "/" + p + " unrolled bracelets, about " +
      Math.round(P.listed(p, p, "support")).toLocaleString() + " each",
    odds: "1 in " + nDisp.toLocaleString() + " rolled " + p + "/" + p +
      " bracelets reaches " + r.rank,
    totalDamage: Number(bandDmg.toFixed(4))
  });
  prevGold = total; prevCut = r.cut; prevRank = r.rank; prevDmg = bandDmg;
}

// Shizu (2026-08-18): the ladder starts at C+ — fold the pocket-change
// steps below it into one entry row that carries their gold.
var folded = [], accG = 0, accD = 0, entered = false;
rows.forEach(function (r) {
  if (entered) { folded.push(r); return; }
  accG += r.gold; accD += r.damage;
  if (r.to === "C+") {
    entered = true;
    folded.push(Object.assign({}, r, { from: "F", gold: accG,
      damage: Number(accD.toFixed(5)) }));
  }
});
rows = entered ? folded : rows;
doc.rows = kept.concat(rows);
fs.writeFileSync("data/rows.json", JSON.stringify(doc, null, 1));
fs.writeFileSync("data/bracelet-hits.json", JSON.stringify(hits, null, 1));
fs.writeFileSync("data/bracelet-cost.json", JSON.stringify(costs, null, 1));

console.log(K.toLocaleString() + " rolls per pair   floor " + floorD.toFixed(4) +
  "   perfect " + anchorsProbe.perfect.toFixed(4) + "   span " + span.toFixed(4) + "\n");
console.log("rung".padEnd(10) + "pair".padStart(8) + "odds 1 in".padStart(11) +
  "step gold".padStart(12) + "total".padStart(13) + "damage".padStart(9) + "  lines");
rows.forEach(function (r) {
  console.log(r.label.padEnd(10) + r.hit.stats.padStart(8) +
    String(r.mats[0][1]).padStart(11) + Math.round(r.gold).toLocaleString().padStart(12) +
    Math.round(r.total).toLocaleString().padStart(13) + r.damage.toFixed(3).padStart(9) +
    "  " + r.hit.lines.map(function (l) { return l.name + " " + l.tier; }).join(", "));
});
console.log("\nwrote data/rows.json (bracelet series), bracelet-hits.json, bracelet-cost.json");
