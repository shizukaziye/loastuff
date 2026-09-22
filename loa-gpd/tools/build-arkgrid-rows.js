/**
 * build-arkgrid-rows.js — turn the cost grid into ark grid chart rows.
 *
 *   node tools/build-arkgrid-rows.js
 *
 * Reads data/band-grid-{rare,epic}.json (gold and gems per gem, swept over the
 * band you are standing on and the gold per damage you are paying) and
 * data/arkgrid-bands-support.json (what a whole grid at each band is worth),
 * and writes data/arkgrid-support-{rare,epic}.json for the page.
 *
 * The step cost is NOT the difference between two bands' prices any more.
 * Standing on B and wanting B+, you cut with a B advisor until a B+ lands, and
 * you need one for every slot — so the step is
 *
 *     24 x goldPerHit(baseline = B, band = B+, gpd)
 *
 * Rows carry a cell per gpd point; the page picks the cell for wherever the
 * slider is. Gold, gems and weeks all move with it, because the advisor you
 * would really be running moves with it.
 *
 * Weeks come from the astrogem calculator's own throughput constants
 * (tools/collect-stats.js): 24 grid slots, and a weekly cut budget of 26 rare
 * or 9 epic. They cover cutting and fusing only — a raw astrogem is assumed
 * free here, which is the single biggest caveat on the whole row.
 */
"use strict";
var fs = require("fs");

var SLOTS = 24;
var CUTS_PER_WEEK = { uncommon: 70, rare: 26, epic: 9 };

var bands = JSON.parse(fs.readFileSync("data/arkgrid-bands-support.json", "utf8"));
var dmgAt = {};
bands.forEach(function (b) { dmgAt[b.rank] = b; });

// Node levels run almost straight in the grade over the bands the chart uses,
// so one line per node lets the page place an example at ANY grade — which is
// what makes the grid example move inside a band as the budget rises.
function fitLine(pts) {
  var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    sx += pts[i][0]; sy += pts[i][1];
    sxx += pts[i][0] * pts[i][0]; sxy += pts[i][0] * pts[i][1];
  }
  var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope: b, intercept: (sy - b * sx) / n };
}
var used = bands.filter(function (b) { return b.cut >= 60; });
var nodeFit = used[0].nodes.map(function (nd, i) {
  return { name: nd[0],
           fit: fitLine(used.map(function (b) { return [b.cut, b.nodes[i][1]]; })) };
});
var coreFit = fitLine(used.map(function (b) { return [b.cut, b.cores]; }));

["rare", "epic"].forEach(function (rarity) {
  var path = "data/band-grid-" + rarity + ".json";
  if (!fs.existsSync(path)) { console.error("missing " + path + " — skipped"); return; }
  var grid = JSON.parse(fs.readFileSync(path, "utf8"));

  var rows = [], prevDmg = 0;
  grid.steps.forEach(function (st) {
    var band = dmgAt[st.to];
    if (!band) { console.error("no band damage for " + st.to); return; }
    var damage = band.damage - prevDmg;
    prevDmg = band.damage;
    var cells = st.cells.map(function (c) {
      // No hit in the whole run means the advisor at that budget never produced
      // a gem of this grade, not that it is cheap. Say so rather than divide by
      // zero. A handful of hits is a number with no precision behind it, so it
      // is marked thin and the page can hedge it.
      if (!c.hits) return { gpd: c.gpd, reachable: false };
      var gems = c.gemsPerHit * SLOTS;
      var cell = {
        gpd: c.gpd, reachable: true,
        gold: Math.round(c.goldPerHit * SLOTS),
        gems: Math.round(gems),
        weeks: gems / CUTS_PER_WEEK[rarity],
        hits: c.hits,
        thin: c.hits < 30
      };
      if (c.meanGrade != null) {
        cell.meanGrade = Number(c.meanGrade.toFixed(2));
        cell.nodes = nodeFit.map(function (nf) {
          return [nf.name, Math.max(0, Math.min(120,
            Math.round(nf.fit.slope * c.meanGrade + nf.fit.intercept)))];
        });
        cell.cores = Math.max(0, Math.min(20,
          Math.round(coreFit.slope * c.meanGrade + coreFit.intercept)));
      }
      return cell;
    });
    rows.push({
      from: st.from, to: st.to, band: st.band, baseline: st.baseline,
      damage: Number(damage.toFixed(5)),
      totalDamage: Number(band.damage.toFixed(4)),
      cores: band.cores, nodes: band.nodes,
      cells: cells
    });
  });

  var out = "data/arkgrid-support-" + rarity + ".json";
  fs.writeFileSync(out, JSON.stringify({
    axis: "support", rarity: rarity, slots: SLOTS,
    cutsPerWeek: CUTS_PER_WEEK[rarity],
    turns: grid.turns, rerolls: grid.rerolls, n: grid.n, sig: grid.sig,
    gpds: grid.gpds, nodeFit: nodeFit, coreFit: coreFit,
    note: "Gold covers cutting and fusing only. Acquiring the raw astrogem is " +
          "assumed free, so read the gem count and the weeks alongside the gold.",
    rows: rows
  }, null, 1));

  console.log("\n" + rarity + " — " + grid.turns + " turns, " + grid.rerolls +
    " rerolls, " + CUTS_PER_WEEK[rarity] + " cuts a week");
  console.log("step".padEnd(15) + "damage".padStart(9) +
    grid.gpds.map(function (g) { return ((g / 1e6).toFixed(2) + "M").padStart(12); }).join(""));
  rows.forEach(function (r) {
    console.log((r.from + " -> " + r.to).padEnd(15) + (r.damage.toFixed(3) + "%").padStart(9) +
      r.cells.map(function (c) {
        return (isFinite(c.gold) ? Math.round(c.gold / 1000) + "k" : "-").padStart(12);
      }).join(""));
  });
  console.log("weeks to fill all 24 slots");
  rows.forEach(function (r) {
    console.log((r.from + " -> " + r.to).padEnd(24) +
      r.cells.map(function (c) {
        return (isFinite(c.weeks) ? c.weeks.toFixed(0) : "-").padStart(12);
      }).join(""));
  });
  console.log("wrote " + out);
});
