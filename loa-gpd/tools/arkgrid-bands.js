/**
 * arkgrid-bands.js — what a whole ark grid is worth at each grade band.
 *
 *   node tools/arkgrid-bands.js support|dps
 *
 * The grid is SIX cores of four gems — twenty-four gems, forty-eight effect
 * lines, so a side node can reach 120 and the three of them share 240 levels.
 * Earlier rows here were built on twelve gems, half a grid.
 *
 * Two passes. First we draw twenty-four gems at random from each band's pool
 * and read off where the side nodes and the core points land.
 *
 * The draw is uniform on purpose, and the three nodes still come out uneven.
 * That is not noise: the grade rewards ally attack enhancement about three
 * times as hard as ally damage enhancement, so gems carrying ally attack are
 * the ones that grade well and a band's pool is full of them. Letting the draw
 * pick its favourites would be cheating — the band price buys gems at a grade,
 * not gems with a chosen pair of lines. The second pass fits a line
 * through the bands the chart uses and rebuilds one exact grid per band from
 * it. That strips the sampling wobble without flattening the range, which
 * matters because the chart needs gold per damage to climb as you go up the
 * ladder — a wobble there makes the planner skip rungs.
 *
 *
 * Damage is always the astrogem calculator's own gridDamage, never a formula
 * copied out of it.
 */
"use strict";
var A = require("../../loastuff/loa-astrogem-calc/model/astrogem.js");
var AXIS = (process.argv[2] || "support").toLowerCase();

var POOL = {
  8:  ["Additional Damage", "Attack Power", "Brand Power", "Ally Damage Enh."],
  9:  ["Boss Damage", "Attack Power", "Ally Damage Enh.", "Ally Attack Enh."],
  10: ["Boss Damage", "Additional Damage", "Brand Power", "Ally Attack Enh."]
};
var NODES = AXIS === "support"
  ? ["Ally Attack Enh.", "Brand Power", "Ally Damage Enh."]
  : ["Attack Power", "Boss Damage", "Additional Damage"];
var SHORT = { "Ally Attack Enh.": "ally atk", "Brand Power": "brand",
  "Ally Damage Enh.": "ally dmg", "Attack Power": "atk power",
  "Boss Damage": "boss dmg", "Additional Damage": "add dmg" };

var bounds = AXIS === "support" ? A.supportValueBounds() : A.valueBounds();
var anchor = AXIS === "support" ? A.supportValueAnchor() : A.valueAnchor();
var valueOf = AXIS === "support" ? A.supportValue : A.gemValue;
function grade(c) { return 100 * (valueOf(c) - bounds.min) / (anchor - bounds.min); }

var ALL = [];
[8, 9, 10].forEach(function (bc) {
  var p = POOL[bc];
  for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++)
    for (var wp = 1; wp <= 5; wp++) for (var o = 1; o <= 5; o++)
      for (var l1 = 1; l1 <= 5; l1++) for (var l2 = 1; l2 <= 5; l2++)
        ALL.push({ baseCost: bc, gemType: "order", willpowerLevel: wp, orderLevel: o,
          effect1: p[i], effect1Level: l1, effect2: p[j], effect2Level: l2 });
});
ALL.forEach(function (c) { c._g = grade(c); });

var LADDER = AXIS === "support" ? A.SUPPORT_RANK_LADDER : A.RANK_LADDER;

function m32(s){var a=s>>>0;return function(){a=(a+0x6D2B79F5)|0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
var rand = m32(20260814);

/** Twenty-four gems drawn from a band, four to each of six cores. */
function sampleGrid(pool) {
  var node = [0, 0, 0], pts = 0, i, q;
  for (i = 0; i < 24; i++) {
    var c = pool[(rand() * pool.length) | 0];
    for (q = 0; q < NODES.length; q++) {
      var add = (c.effect1 === NODES[q] ? c.effect1Level : 0) +
                (c.effect2 === NODES[q] ? c.effect2Level : 0);
      node[q] = Math.min(120, node[q] + add);
    }
    pts += c.orderLevel;
  }
  return { node: node, cores: pts / 6 };
}

/**
 * One grid built to hit these node levels and core points exactly.
 *
 * Levels may be fractional. A real grid only holds whole levels, but rounding
 * each band to an integer makes the steps alternate five and six, and that
 * shows up as a wobble in gold per damage. Damage is linear in the level, so
 * the fraction is carried here and the rounding is left to the display.
 */
function buildGrid(levels, corePts) {
  var gems = [], lines = [], i;
  for (i = 0; i < NODES.length; i++) {
    var left = levels[i];
    while (left > 1e-9) { var l = Math.min(5, left); lines.push([NODES[i], l]); left -= l; }
  }
  while (lines.length < 48) lines.push(["__dead__", 1]);
  for (i = 0; i < 24; i++) {
    gems.push({ baseCost: 8, gemType: "order", coreBase: (i / 4) | 0,
      willpowerLevel: 5, orderLevel: corePts / 4,
      effect1: lines[i * 2][0], effect1Level: lines[i * 2][1],
      effect2: lines[i * 2 + 1][0], effect2Level: lines[i * 2 + 1][1] });
  }
  return gems;
}

// ---- pass one: where the nodes and cores actually land ---------------------
var REPS = 4000, obs = [];
LADDER.forEach(function (row) {
  var cut = row[1];
  var pool = ALL.filter(function (c) { return c._g >= cut && c._g < cut + 3.4; });
  if (pool.length < 3) return;
  var acc = [0, 0, 0], cores = 0, i;
  for (var r = 0; r < REPS; r++) {
    var g = sampleGrid(pool);
    for (i = 0; i < NODES.length; i++) acc[i] += g.node[i];
    cores += g.cores;
  }
  obs.push({ rank: row[0], cut: cut, cores: cores / REPS,
    levels: acc.map(function (v) { return v / REPS; }) });
});

// ---- pass two: straighten over the bands the chart uses --------------------
// Across C- and up the sampled levels sit almost exactly on a line in the
// grade; below that they flatten towards zero and would drag the fit down. So
// the line is fitted on C- upwards only. Two things fall out of fitting in the
// grade rather than in the rank: the level steps come out even, so gold per
// damage climbs with the gold instead of wobbling, and a narrow band like
// S to S+ gets the small step its narrow grade range earns.
function fit(pts) {
  var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    sx += pts[i][0]; sy += pts[i][1];
    sxx += pts[i][0] * pts[i][0]; sxy += pts[i][0] * pts[i][1];
  }
  var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope: b, intercept: (sy - b * sx) / n };
}
var used = obs.filter(function (o) { return o.cut >= 60; });
var fNode = NODES.map(function (n, i) {
  return fit(used.map(function (o) { return [o.cut, o.levels[i]]; }));
});
var fCores = fit(used.map(function (o) { return [o.cut, o.cores]; }));

var out = obs.map(function (o) {
  var lv = fNode.map(function (f) {
    return Math.max(0, Math.min(120, f.slope * o.cut + f.intercept));
  });
  var pts = Math.max(0, Math.min(20, fCores.slope * o.cut + fCores.intercept));
  return { rank: o.rank, cut: o.cut, cores: Math.round(pts),
    damage: A.gridDamage(buildGrid(lv, pts), AXIS),
    nodes: NODES.map(function (n, i) { return [SHORT[n], Math.round(lv[i])]; }) };
});

console.log(AXIS.toUpperCase() + " — 24 gems, 6 cores, " + REPS.toLocaleString() +
  " sampled grids per band\n");
console.log("rank | cut  | grid damage | step up | cores | side nodes");
out.forEach(function (o, i) {
  var step = i + 1 < out.length ? o.damage - out[i + 1].damage : o.damage;
  console.log(o.rank.padEnd(4) + " | " + String(o.cut).padStart(4) + " | " +
    o.damage.toFixed(3).padStart(10) + "% | " + step.toFixed(3).padStart(7) + " | " +
    String(o.cores).padStart(5) + " | " +
    o.nodes.map(function (n) { return n[0] + " " + n[1]; }).join(", "));
});
require("fs").writeFileSync("data/arkgrid-bands-" + AXIS + ".json", JSON.stringify(out, null, 1));
console.log("\nwrote data/arkgrid-bands-" + AXIS + ".json");
