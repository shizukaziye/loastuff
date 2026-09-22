/**
 * The same bracelet experiment on either axis, one reference character.
 *   node tools/bracelet-axis.js support|dps [count]
 *
 * Structure (identical on both axes, per Shizu):
 *   - two combat traits fixed at drop, Stove's banded roll, Ancient 61-120
 *     (support: spec + swiftness, priced the same; DPS: crit + spec)
 *   - three granted slots, rerolled over seven attempts (4 rolls + 3 tickets),
 *     each attempt rerolling every unlocked slot as a set
 *   - locking decided per slot: hold a line that beats what the slot is worth
 *     with the attempts remaining, V(n) = E[max(X, V(n-1))]
 *   - no duplicate families, at most two basic effects
 *   - because both trait places are filled, a slot is basic 53.85% / special
 *     46.15% after Stove's renormalisation
 *
 * Reference character: ilvl 1785, level-9 gems, high/high accessories, 9-7
 * stone, Adrenaline 7, karma 21, ark grid 60/60/60 side nodes with Ancient
 * cores at 20 points (attack core on DPS, weapon core on support), 90% crit /
 * 280% crit damage, three damage dealers.
 *
 * Scoring uses the bracelet calculator's own shape (subrank.js):
 *   score = 100 * (total - floor) / (anchor - floor)
 *   floor  = both traits at 40
 *   anchor = the three best distinct families at mid tier, traits at 110
 *
 * The ark grid ORDER cores do not appear here on purpose: they are character
 * context, not bracelet content, so they cancel in every comparison.
 */
"use strict";
var SUP = require("../model/bracelet.js");
var DPS = require("../../loa-bracelet-calc/model/bracelet.js");

var AXIS = (process.argv[2] || "support").toLowerCase();
var N = Number(process.argv[3] || 1000000);
// each axis has its own cuts, placed so a letter means the same RARITY on both
var LADDER_DPS = [["S+",100.1],["S",95],["S-",90],["A+",85],["A",80],["A-",75],
  ["B+",70],["B",65],["B-",60],["C+",55],["C",50],["C-",45],["D+",40],["D",35],
  ["D-",30],["F+",20],["F",10],["F-",-Infinity]];
var LADDER_SUP = [["S+",100],["S",90],["S-",82.5],["A+",75],["A",67.5],["A-",60],
  ["B+",52.5],["B",45],["B-",40],["C+",35],["C",30],["C-",25],["D+",20],
  ["D",15],["D-",10],["F+",5],["F",0],["F-",-Infinity]];

// reference character on the DPS side
var PROF = DPS.normalizeProfile({
  wpPct: 0.081,        // 6% earrings + 2.1% karma at level 21
  baseApPct: 0.2948,   // accessories, Ancient attack core, node 60, gems, stone, Adrenaline
  flatAP: 3600,        // Ancient attack core
  flatWP: 0            // attack core, no weapon-power accessory rolls
});

// ---- per-axis line values --------------------------------------------------
var value = [], famOf = [], labelOf = [], cum = [], total = 0;
var tiers = ["low", "mid", "high"];
for (var f = 1; f <= 33; f++) {
  var w = f <= 10 ? [4.2, 2.1, 0.7] : f <= 22 ? [0.5, 0.25, 0.08333] : [1.0909, 0.5455, 0.1818];
  for (var t = 0; t < 3; t++) {
    var v = AXIS === "dps"
      ? DPS.lineDamage({ cat: "special", family: f, tier: tiers[t] }, "ancient", PROF)
      : (SUP.SUPPORT_LINE[f] ? SUP.SUPPORT_LINE[f][t] : 0);
    value.push(v); famOf.push(f);
    labelOf.push(v > 0.0001 ? "f" + f + ["blue", "epic", "LEG"][t] : "");
    total += w[t]; cum.push(total);
  }
}

// ---- trait pricing ---------------------------------------------------------
// support: spec and swiftness, flat per point. DPS: crit + spec through the
// calculator's own traitDamage, tabulated over 61-120 x 61-120.
var traitTable = null, traitPerPoint = 0;
if (AXIS === "dps") {
  traitTable = [];
  for (var a = 61; a <= 120; a++) {
    var row = [];
    for (var b = 61; b <= 120; b++) row.push(DPS.traitDamage({ crit: a, spec: b }, PROF));
    traitTable.push(row);
  }
} else {
  traitPerPoint = SUP.TRAIT_PER_POINT;
}
function traitDamage(t1, t2) {
  return traitTable ? traitTable[t1 - 61][t2 - 61] : (t1 + t2) * traitPerPoint;
}

// ---- anchor and floor ------------------------------------------------------
var mids = [];
for (var f2 = 1; f2 <= 33; f2++) mids.push(value[(f2 - 1) * 3 + 1]);
mids.sort(function (x, y) { return y - x; });
// floor at 61/61 — the worst stats an Ancient bracelet can drop with
var FLOOR = traitTable ? DPS.traitDamage({ crit: 61, spec: 61 }, PROF) : 122 * traitPerPoint;
var ANCHOR = mids[0] + mids[1] + mids[2] + traitDamage(110, 110);
var SPAN = ANCHOR - FLOOR;

// ---- draw tables -----------------------------------------------------------
var LOOKUP = new Int32Array(200000);
for (var i = 0, k = 0; i < LOOKUP.length; i++) {
  var x = (i + 0.5) / LOOKUP.length * total;
  while (k < cum.length - 1 && cum[k] < x) k++;
  LOOKUP[i] = k;
}
var TRAIT_CUM = [10,26,42,58,68,78,88,92,96,100];
var TRAIT_LO = [61,67,73,79,85,91,97,103,109,115];
var BASIC_CUM = [10,26,42,58,68,78,88,92,96,100];
var BASIC_LO = [9600,10241,10881,11521,12161,12801,13441,14081,14721,15361];
var BASIC_HI = [10240,10880,11520,12160,12800,13440,14080,14720,15360,16000];
var basicMin, basicSpan;
if (AXIS === "dps") {
  basicMin = DPS.lineDamage({ cat: "basic", family: "mainStat", value: 9600 }, "ancient", PROF);
  basicSpan = DPS.lineDamage({ cat: "basic", family: "mainStat", value: 16000 }, "ancient", PROF) - basicMin;
} else { basicMin = 0.176; basicSpan = 0.116; }

function m32(s){var a=s>>>0;return function(){a=(a+0x6D2B79F5)|0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
var rand = m32(20260813);

function rollTrait() {
  var r = rand() * 100, i2 = 0;
  while (i2 < 9 && TRAIT_CUM[i2] < r) i2++;
  return TRAIT_LO[i2] + ((rand() * 6) | 0);
}

// lock thresholds for one slot
var draws = [];
for (i = 0; i < 200000; i++) {
  if (rand() * 65 < 35) draws.push(rand() < 0.5 ? 0 : basicMin + basicSpan * rand());
  else draws.push(value[LOOKUP[(rand() * 200000) | 0]]);
}
var TH = [0];
for (var n2 = 1; n2 <= 7; n2++) {
  var sum = 0;
  for (i = 0; i < draws.length; i++) sum += Math.max(draws[i], TH[n2 - 1]);
  TH.push(sum / draws.length);
}

// ---- the run ---------------------------------------------------------------
var hv = new Float64Array(3), hf = new Int32Array(3), hb = new Uint8Array(3), hl = [];
var BINS = 60000, BIN = 0.01, hist = new Float64Array(BINS), best = [], noLine = 0;
for (var n = 0; n < N; n++) {
  var t1 = rollTrait(), t2 = rollTrait(), held = 0;
  for (var attempt = 7; attempt >= 1; attempt--) {
    while (held < 3) {
      var basics = 0, j;
      for (j = 0; j < held; j++) if (hb[j]) basics++;
      if (basics < 2 && rand() * 65 < 35) {
        hb[held] = 1; hf[held] = 0;
        if (rand() < 0.5) { hv[held] = 0; hl[held] = ""; }
        else {
          var r2 = rand() * 100, bi = 0;
          while (bi < 9 && BASIC_CUM[bi] < r2) bi++;
          var bv = BASIC_LO[bi] + ((rand() * (BASIC_HI[bi] - BASIC_LO[bi] + 1)) | 0);
          hv[held] = basicMin + basicSpan * ((bv - 9600) / 6400); hl[held] = "mainstat";
        }
      } else {
        var idx, fam, tries = 0, dup;
        do {
          idx = LOOKUP[(rand() * 200000) | 0]; fam = famOf[idx]; dup = false;
          for (j = 0; j < held; j++) if (hf[j] === fam) { dup = true; break; }
        } while (dup && ++tries < 40);
        hb[held] = 0; hf[held] = fam; hv[held] = value[idx]; hl[held] = labelOf[idx];
      }
      held++;
    }
    if (attempt === 1) break;
    for (var p = 0; p < 3; p++) for (var q = p + 1; q < 3; q++) if (hv[q] > hv[p]) {
      var s1=hv[p];hv[p]=hv[q];hv[q]=s1; var s2=hf[p];hf[p]=hf[q];hf[q]=s2;
      var s3=hb[p];hb[p]=hb[q];hb[q]=s3; var s4=hl[p];hl[p]=hl[q];hl[q]=s4;
    }
    var lockFloor = TH[attempt - 1 < TH.length ? attempt - 1 : TH.length - 1];
    held = 0; while (held < 3 && hv[held] >= lockFloor) held++;
  }
  var lines = hv[0] + hv[1] + hv[2];
  if (lines < 0.0001) noLine++;
  var score = 100 * (traitDamage(t1, t2) + lines - FLOOR) / SPAN;
  var bin = (score / BIN) | 0; if (bin < 0) bin = 0;
  hist[bin < BINS ? bin : BINS - 1] += 1;
  if (score >= 95) {
    best.push({ s: score, t: t1 + "/" + t2,
      l: [hl[0], hl[1], hl[2]].filter(function (z) { return z && z !== "mainstat"; }).join(" + ") });
    if (best.length > 4000) { best.sort(function (u, w2) { return w2.s - u.s; }); best.length = 2000; }
  }
}

console.log(AXIS.toUpperCase() + " — " + N.toLocaleString() + " bracelets, traits " +
  (AXIS === "dps" ? "crit + spec" : "spec + swiftness"));
console.log("floor " + FLOOR.toFixed(3) + "   anchor(100) " + ANCHOR.toFixed(3) +
            "   no scoring line " + (100 * noLine / N).toFixed(3) + "%\n");
console.log("rank | opens | count        | share      | at or above");
var above = 0, rows = [];
var LADDER = AXIS === "dps" ? LADDER_DPS : LADDER_SUP;
for (var r3 = 0; r3 < LADDER.length; r3++) {
  var min = LADDER[r3][1], max = r3 > 0 ? LADDER[r3 - 1][1] : Infinity, c = 0;
  for (var z2 = Math.max(0, Math.ceil(min / BIN)); z2 < Math.min(BINS, Math.ceil(max / BIN)); z2++) c += hist[z2];
  above += c; rows.push([LADDER[r3][0], min, c, above]);
}
rows.forEach(function (row) {
  console.log(row[0].padEnd(4) + " | " + String(row[1] === -Infinity ? "  -" : row[1]).padStart(5) + " | " +
    String(row[2]).padStart(12) + " | " + (100 * row[2] / N).toFixed(4).padStart(9) + "% | " +
    (100 * row[3] / N).toFixed(5).padStart(10) + "%");
});
if (process.argv.indexOf("--dump") >= 0) {
  var fs = require("fs");
  fs.writeFileSync("tools/.cache/hist-" + AXIS + ".json",
    JSON.stringify({ axis: AXIS, n: N, bin: BIN, floor: FLOOR, anchor: ANCHOR,
      hist: Array.prototype.slice.call(hist) }));
  console.log("wrote tools/.cache/hist-" + AXIS + ".json");
}
best.sort(function (u, w3) { return w3.s - u.s; });
console.log("\nbest rolled:");
best.slice(0, 4).forEach(function (z) { console.log("  " + z.s.toFixed(1).padStart(6) + "  " + z.t.padStart(7) + "  " + z.l); });
