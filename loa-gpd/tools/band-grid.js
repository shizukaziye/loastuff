/**
 * band-grid.js — the ark grid cost ladder, priced with a matched advisor.
 *
 *   node tools/band-grid.js --rarity=rare --n=250000 --out=data/band-grid-rare.json
 *
 * Shizu's correction: pricing a step must use the advisor you would actually
 * be running at that point. If you are standing on B and cutting for B+, the
 * cut policy's baseline is B, not a fixed 80 — and its gold-per-damage is the
 * gpd you are checking, not a fixed 2.5M.
 *
 * So the cost of a step is a function of three things, and this sweeps all of
 * them: the band you are standing on, the gpd you are willing to pay, and the
 * rarity of the raw gem you feed the cutter.
 *
 * The chart's slider and the astrogem `gpd` argument are the same unit today —
 * the model multiplies by SUPPORT_GPD_MULTIPLIER internally, so its argument is
 * gold per 1% of a three-dealer party's damage, which is exactly what the
 * slider reads. If the chart drops that x3, divide the slider by three before
 * looking a row up here.
 */
"use strict";
var BC = require("./band-cost.js");
var A = BC.A;

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) ARGS[m[1]] = m[2] === undefined ? true : m[2];
});
var N = parseInt(ARGS.n, 10) || 100000;

// the ladder, and the baseline you stand on to climb each rung
var BANDS = [60, 63.3, 66.7, 70, 73.3, 76.7, 80, 83.3, 86.7, 90, 93.3, 94.6];
var STEPS = [{ from: "ungraded", bl: 0, to: BC.letterOf(BANDS[0]), band: BANDS[0] }];
for (var i = 1; i < BANDS.length; i++) {
  STEPS.push({ from: BC.letterOf(BANDS[i - 1]), bl: BANDS[i - 1],
               to: BC.letterOf(BANDS[i]), band: BANDS[i] });
}

// gpd points across the chart's slider range, a shade over one octave apart
var GPDS = [250000, 500000, 1000000, 2000000, 4000000, 8000000, 16000000, 25000000];

var out = [];
var t0 = process.hrtime.bigint();
STEPS.forEach(function (st, si) {
  var cells = GPDS.map(function (gpd) {
    var r = BC.policy(st.bl, gpd, [st.band], N).rows[0];
    // meanGrade is what makes the example granular: at a bigger budget the
    // advisor pushes each gem further, so the gems that clear a band sit higher
    // inside it, and the grid you end up wearing is better than the band floor.
    return { gpd: gpd, goldPerHit: r.goldPerHit, se: r.goldSE,
             gemsPerHit: r.gemsPerHit, hits: r.succ, fusedShare: r.fusedShare,
             meanGrade: r.meanGrade, meanDamage: r.meanDamage };
  });
  out.push({ from: st.from, to: st.to, band: st.band, baseline: st.bl, cells: cells });
  var secs = Number(process.hrtime.bigint() - t0) / 1e9;
  console.error("  " + (si + 1) + "/" + STEPS.length + "  " + st.from + " -> " + st.to +
    "   " + secs.toFixed(0) + "s");
});

console.log("# " + BC.RARITY + " — " + BC.BUDGET.maxTurns + " turns, " +
  BC.BUDGET.maxRerolls + " rerolls   N=" + N + " per cell   MODEL_SIG=" + A.MODEL_SIG);
console.log("step".padEnd(16) + GPDS.map(function (g) {
  return ((g / 1e6).toFixed(2) + "M").padStart(11);
}).join(""));
out.forEach(function (r) {
  console.log((r.from + " -> " + r.to).padEnd(16) + r.cells.map(function (c) {
    return (isFinite(c.goldPerHit) ? Math.round(c.goldPerHit).toLocaleString() : "-").padStart(11);
  }).join(""));
});
console.log("\ngems drawn per hit");
console.log("step".padEnd(16) + GPDS.map(function (g) {
  return ((g / 1e6).toFixed(2) + "M").padStart(11);
}).join(""));
out.forEach(function (r) {
  console.log((r.from + " -> " + r.to).padEnd(16) + r.cells.map(function (c) {
    return (isFinite(c.gemsPerHit) ? c.gemsPerHit.toFixed(1) : "-").padStart(11);
  }).join(""));
});

if (ARGS.out) {
  require("fs").writeFileSync(ARGS.out, JSON.stringify({
    rarity: BC.RARITY, turns: BC.BUDGET.maxTurns, rerolls: BC.BUDGET.maxRerolls,
    n: N, gpds: GPDS, sig: A.MODEL_SIG, steps: out
  }, null, 1));
  console.error("wrote " + ARGS.out);
}
