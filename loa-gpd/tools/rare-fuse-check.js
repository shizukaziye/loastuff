/**
 * rare-fuse-check.js — is it better to fuse rares or to cut them?
 *
 *   node tools/rare-fuse-check.js [n]
 *
 * Shizu asked whether fusing all the rares beats cutting them. Fusion in this
 * model works on the TIER of a cut gem, not on raw rarity: three legendaries
 * return 99% legendary, and only a relic or ancient input moves the odds. So
 * the two paths to a usable gem are
 *
 *   cut it   — spend turns and hope the level sum lands 16 or over
 *   fuse it  — three gems in, one out, 500g, and if all three are legendary
 *              (which every uncut gem is, level sum 4) it is 1% for a relic
 *
 * This measures both on the same stream.
 */
"use strict";
var REPO = "C:/Users/Shizu/loastuff/loa-astrogem-calc";
var A = require(REPO + "/model/astrogem.js");
var N = parseInt(process.argv[2], 10) || 40000;

// snapshot the budgets first: retargeting writes THROUGH A.RARITY.epic, so
// reading A.RARITY.epic afterwards gives back whatever it was last set to
var BUDGETS = { rare: { t: A.RARITY.rare.maxTurns, r: A.RARITY.rare.maxRerolls },
                epic: { t: A.RARITY.epic.maxTurns, r: A.RARITY.epic.maxRerolls } };

var RESULTS = {};
["rare", "epic"].forEach(function (rarity) {
  // retarget the engine's budget, then load it fresh
  A.RARITY.epic.maxTurns = BUDGETS[rarity].t;
  A.RARITY.epic.maxRerolls = BUDGETS[rarity].r;
  delete require.cache[require.resolve(REPO + "/tools/lib/cut-engine.js")];
  var Engine = require(REPO + "/tools/lib/cut-engine.js");
  var DP = require(REPO + "/model/dp.js");

  var solver = {};
  [8, 9, 10].forEach(function (c) {
    solver[c] = new DP.Solver(A.supportGradeToScore(80), 2500000, false,
      { axis: "support", maxTurns: A.RARITY[rarity].maxTurns });
  });
  var rand = Engine.mulberry32(Engine.fnv1a("fusecheck:" + rarity));
  var pools = A.EFFECT_POOLS;
  var relicPlus = 0, processed = 0, gold = 0;
  for (var i = 0; i < N; i++) {
    var cost = rand() < 0.6 ? 8 : (rand() < 0.75 ? 9 : 10);
    var p = pools[cost];
    var a = Math.floor(rand() * p.length), b = Math.floor(rand() * (p.length - 1));
    if (b >= a) b++;
    var res = Engine.cutOneGem(solver[cost],
      { baseCost: cost, gemType: "order", effect1: p[a], effect2: p[b] }, rand, true);
    gold += res.spent;
    if (res.processes > 0) {
      processed++;
      if (A.levelSum(res.cfg) >= 16) relicPlus++;
    }
  }
  RESULTS[rarity] = { relicPlus: relicPlus / N, processed: processed / N, goldPer: gold / N };
});

var fuse3L = A.fusionOutputDist(["legendary", "legendary", "legendary"]);
console.log("Per raw gem, cutting it:\n");
console.log("  rarity | processed at all | reaches relic+ (sum 16+) | gold spent");
["rare", "epic"].forEach(function (r) {
  var x = RESULTS[r];
  console.log("  " + r.padEnd(6) + " | " + (100 * x.processed).toFixed(1).padStart(15) + "% | " +
    (100 * x.relicPlus).toFixed(2).padStart(23) + "% | " + Math.round(x.goldPer).toLocaleString());
});

console.log("\nFusing three UNCUT gems instead — every uncut gem is level sum 4, so legendary:");
console.log("  legendary " + (100 * fuse3L.legendary).toFixed(0) + "%   relic " +
  (100 * fuse3L.relic).toFixed(0) + "%   ancient " + (100 * fuse3L.ancient).toFixed(0) + "%");
console.log("  so three rares and 500g buy a " + (100 * fuse3L.relic).toFixed(0) +
  "% shot at relic, against " + (100 * RESULTS.rare.relicPlus).toFixed(2) +
  "% for cutting one.");
var perRelicFuse = 3 / fuse3L.relic, perRelicCut = 1 / RESULTS.rare.relicPlus;
console.log("\n  gems per relic, fusing uncut : " + Math.round(perRelicFuse).toLocaleString());
console.log("  gems per relic, cutting      : " + perRelicCut.toFixed(1));
console.log("  fusing costs " + (perRelicFuse / perRelicCut).toFixed(0) + "x the gems, and buys a" +
  " gem with no chosen effect pair.");
