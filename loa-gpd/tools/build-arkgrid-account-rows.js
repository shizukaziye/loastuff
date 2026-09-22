/**
 * build-arkgrid-account-rows.js — chart rows for the ark grid, account-priced.
 *
 *   node tools/build-arkgrid-account-rows.js
 *
 * Shizu's ruling: the ark grid is priced by the ACCOUNT model. The band ladder
 * — every slot clearing one grade — overpays 2.4x to 3.9x for the same damage
 * and now lives in docs/research as the uniformity-cost reference only.
 *
 * The account simulator stops once per budget point, so its trace is eight
 * (gold, damage, grid) states per rarity. Rows are the segments between them:
 *
 *   gold    what the next stretch of cutting costs
 *   damage  what it adds, per dealer
 *   to      the gems' average band where the stretch ends
 *
 * Two folds keep the ladder walkable. Duplicate stops (the monotone carry can
 * hold a budget at the previous state) are dropped. And neighbouring segments
 * are pooled until gold-per-damage rises monotonically — the stops come from
 * independently stopped accounts, so raw segment marginals are noisy in a way
 * a prefix-walking planner cannot survive.
 *
 * Every row carries the grid standing at its end — nodes, cores, mean and
 * weakest grade — plus the marginal gems and weeks, so the card and both
 * tooltips describe the same simulated grid the price belongs to.
 */
"use strict";
var fs = require("fs");
var A = require("C:/Users/Shizu/loastuff/loa-astrogem-calc/model/astrogem.js");
var AXIS = process.argv.indexOf("--axis=dps") >= 0 ? "dps" : "support";
var LADDER = AXIS === "dps" ? A.RANK_LADDER : A.SUPPORT_RANK_LADDER;
var PREFIX = AXIS === "dps" ? "dps-" : "";

// The displayed loadout is idealized to Shizu's display rules (2026-08-16):
// node values snap to multiples of five, and the six cores use exactly two
// numbers in the shape x/x/y/x/x/y with y on the two Star cores. The snap
// stays as close to the simulated account as rounding allows; grades, gold
// and damage remain the account's own. perCore arrives in CORE_SEQ order
// (order Moon/Sun/Star, chaos Moon/STAR/Sun — Stars at 2 and 4) and is
// emitted per half as Moon/Sun/Star so the pattern lands on the Stars.
function snapCores(p) {
  if (!p || p.length !== 6) return p;
  var x = Math.round((p[0] + p[1] + p[3] + p[5]) / 4);
  var y = Math.round((p[2] + p[4]) / 2);
  x = Math.max(0, Math.min(20, x)); y = Math.max(0, Math.min(20, y));
  return [x, x, y, x, x, y];
}
function snapNodes(nodes) {
  if (!nodes) return nodes;
  // SUPPORT: one number for all three buff nodes, a multiple of five, nearest
  // the account's average — Shizu wants the displayed loadout perfectly even,
  // and on that axis the three really are interchangeable.
  //
  // DPS: they are NOT. A DPS account spreads its levels unevenly by design
  // (atk 39 / add dmg 46 / boss 22 is a real 100M stop), and averaging them
  // printed 35/35/35 on every tier from 250k to 100M — the card looked frozen
  // while the account underneath was moving. Round each node on its own
  // instead, so the shape survives (2026-09-21).
  if (AXIS === "dps") {
    return nodes.map(function (n) { return [n[0], 5 * Math.round(n[1] / 5)]; });
  }
  var mean = nodes.reduce(function (s, n) { return s + n[1]; }, 0) / nodes.length;
  var v = 5 * Math.round(mean / 5);
  return nodes.map(function (n) { return [n[0], v]; });
}

// ---- the fluid frontier -----------------------------------------------------
// One smooth convex gold(damage) curve per rarity, fit to every tier stop at
// once. Each tier is a frontier point (its accounts' mean damage and gold),
// and the stop rule pins the slope there to the tier's own budget. Rungs are
// then read off this single curve at each band's damage, so marginal rates
// STRICTLY increase — A- prices below A by construction, and no rung is a
// difference of medians from two different account populations (which is
// what inverted the B+/A-/A stretch and forced rate pooling).
function fluidFrontier(tiers) {
  var pts = tiers.filter(function (r) { return r.reachable !== false; })
    .sort(function (a, b) { return a.gpd - b.gpd; });
  if (pts.length < 4) return null;
  // segment rates between consecutive stops, isotonic (PAVA, damage-weighted)
  var segs = [];
  for (var i = 1; i < pts.length; i++) {
    var dD = pts[i].damage - pts[i - 1].damage, dG = pts[i].gold - pts[i - 1].gold;
    if (dD <= 1e-9) continue;
    segs.push({ d0: pts[i - 1].damage, d1: pts[i].damage, w: dD, rate: dG / dD });
  }
  var blocks = [];
  segs.forEach(function (s) {
    blocks.push({ w: s.w, rate: s.rate, d0: s.d0, d1: s.d1 });
    while (blocks.length > 1) {
      var a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      if (b.rate >= a.rate) break;
      blocks.splice(blocks.length - 2, 2, { w: a.w + b.w, d0: a.d0, d1: b.d1,
        rate: (a.rate * a.w + b.rate * b.w) / (a.w + b.w) });
    }
  });
  // strictly increasing marginal: log-interpolate the block rates through
  // their midpoints, so plateaus become gentle slopes instead of ties
  var mids = blocks.map(function (b) { return { d: (b.d0 + b.d1) / 2, r: Math.log(b.rate) }; });
  function rateAt(d) {
    if (d <= mids[0].d) {
      var s0 = mids.length > 1 ? (mids[1].r - mids[0].r) / (mids[1].d - mids[0].d) : 0;
      return Math.exp(mids[0].r + s0 * (d - mids[0].d));
    }
    for (var i = 1; i < mids.length; i++) {
      if (d <= mids[i].d) {
        var f = (d - mids[i - 1].d) / (mids[i].d - mids[i - 1].d);
        return Math.exp(mids[i - 1].r + f * (mids[i].r - mids[i - 1].r));
      }
    }
    var n = mids.length;
    var sN = n > 1 ? (mids[n - 1].r - mids[n - 2].r) / (mids[n - 1].d - mids[n - 2].d) : 0;
    return Math.exp(mids[n - 1].r + sN * (d - mids[n - 1].d));
  }
  // integrate the smoothed marginal from the first stop to get gold(damage)
  var base = { d: pts[0].damage, g: pts[0].gold };
  function goldAt(d) {
    if (d <= base.d) return base.g;
    var steps = 200, h = (d - base.d) / steps, g = base.g;
    for (var i = 0; i < steps; i++) {
      var x0 = base.d + i * h, x1 = x0 + h;
      g += (rateAt(x0) + rateAt(x1)) / 2 * h;
    }
    return g;
  }
  // damage at a mean-grade cut: tier means rise with damage, same-population
  var mcurve = pts.map(function (p) { return { m: p.mean, d: p.damage }; })
    .sort(function (a, b) { return a.m - b.m; });
  function damageAtMean(cut) {
    if (cut <= mcurve[0].m) return null;                 // below the frontier's base
    for (var i = 1; i < mcurve.length; i++) {
      if (mcurve[i].m >= cut) {
        var f = (cut - mcurve[i - 1].m) / (mcurve[i].m - mcurve[i - 1].m);
        return mcurve[i - 1].d + f * (mcurve[i].d - mcurve[i - 1].d);
      }
    }
    return null;                                         // above coverage
  }
  return { rateAt: rateAt, goldAt: goldAt, damageAtMean: damageAtMean,
    baseDamage: base.d, baseGold: base.g, baseMean: mcurve[0].m };
}

["epic", "rare"].forEach(function (rarity) {
  var acct;
  try {
    acct = JSON.parse(fs.readFileSync("data/arkgrid-account-" + PREFIX + rarity + ".json", "utf8"));
  } catch (e) {
    // the other rarity's sweep may simply not have published yet
    console.log(rarity + ": no account file yet, skipping");
    return;
  }

  // Grade rungs when the sim recorded them — one stop per band the accounts
  // passed through, so the ladder shows every letter (Shizu: "seems like
  // you're missing every other grade"). Budget stops remain the fallback.
  var fluid = fluidFrontier(acct.rows || []);
  var raw;
  if (fluid) {
    // rungs read off the fluid frontier: gold at each band's damage, display
    // fields from the nearest tier account (same population, no median mixing)
    var LAD = LADDER.slice().reverse();
    var tiersAsc = (acct.rows || []).filter(function (r) { return r.reachable !== false; })
      .sort(function (a, b) { return a.damage - b.damage; });
    var dispAt = function (d) {
      var best = tiersAsc[0];
      tiersAsc.forEach(function (t) { if (Math.abs(t.damage - d) < Math.abs(best.damage - d)) best = t; });
      return best;
    };
    var gemsAt = function (d) {
      if (d <= tiersAsc[0].damage) return tiersAsc[0].gems;
      for (var i = 1; i < tiersAsc.length; i++) {
        if (tiersAsc[i].damage >= d) {
          var f = (d - tiersAsc[i - 1].damage) / (tiersAsc[i].damage - tiersAsc[i - 1].damage);
          return Math.round(tiersAsc[i - 1].gems + f * (tiersAsc[i].gems - tiersAsc[i - 1].gems));
        }
      }
      return tiersAsc[tiersAsc.length - 1].gems;
    };
    var letterOf = function (g) {
      var L = LADDER;
      for (var i = 0; i < L.length; i++) if (g >= L[i][1] - 1e-9) return L[i][0];
      return "F-";
    };
    // Band positions on the frontier: the entry (the frontier's floor, its
    // true band) then one point per band above it, up to coverage.
    var bands = [], entry = null;
    LAD.forEach(function (row) {
      var cut = row[1] === -Infinity ? 0 : row[1];
      if (cut <= fluid.baseMean) {
        if (!entry) {
          var e0 = dispAt(fluid.baseDamage);
          entry = { d: fluid.baseDamage, gold: fluid.goldAt(fluid.baseDamage),
            mean: e0.mean, meanBand: letterOf(e0.mean), disp: e0 };
        }
        return;
      }
      var d = fluid.damageAtMean(cut);
      if (d == null) return;                           // above current coverage
      bands.push({ d: d, cut: cut, meanBand: row[0], disp: dispAt(d) });
    });
    // Shizu's ladder law (2026-08-18): the gap between consecutive rung
    // rates must also grow — the ladder accelerates. A geometric rate
    // ladder rate(k) = entryRate * b^k satisfies it from the entry row on,
    // and b is solved so the ladder's total gold equals the frontier's
    // measured climb, so the smoothing never invents or loses gold.
    raw = [];
    if (entry) {
      raw.push({ gold: Math.round(entry.gold), damage: Number(entry.d.toFixed(4)),
        gems: gemsAt(entry.d), mean: entry.mean, meanBand: entry.meanBand,
        weakest: entry.disp.weakest, band: entry.disp.band, cores: entry.disp.cores,
        perCore: snapCores(entry.disp.perCore), nodes: snapNodes(entry.disp.nodes) });
    }
    if (entry && bands.length) {
      var r0 = entry.gold / entry.d;
      var spans = [], prevD = entry.d;
      bands.forEach(function (bd) { spans.push(bd.d - prevD); prevD = bd.d; });
      var target = fluid.goldAt(bands[bands.length - 1].d) - entry.gold;
      var ladderGold = function (b) {
        var s = 0;
        for (var k = 0; k < spans.length; k++) s += r0 * Math.pow(b, k + 1) * spans[k];
        return s;
      };
      var lo = 1.0001, hi = 20;
      for (var it = 0; it < 80; it++) {
        var mid = (lo + hi) / 2;
        if (ladderGold(mid) < target) lo = mid; else hi = mid;
      }
      var b = (lo + hi) / 2, cum = entry.gold;
      bands.forEach(function (bd, k) {
        cum += r0 * Math.pow(b, k + 1) * spans[k];
        raw.push({ gold: Math.round(cum), damage: Number(bd.d.toFixed(4)),
          gems: gemsAt(bd.d), mean: bd.cut, meanBand: bd.meanBand,
          weakest: bd.disp.weakest, band: bd.disp.band, cores: bd.disp.cores,
          perCore: snapCores(bd.disp.perCore), nodes: snapNodes(bd.disp.nodes) });
      });
    }
  } else raw = acct.rungs && acct.rungs.length ? acct.rungs.map(function (r) {
    return { gold: r.gold, damage: r.damage, gems: r.gems,
      mean: r.mean, meanBand: r.band, weakest: r.weakest,
      band: r.weakBand || r.band, cores: r.cores,
      perCore: snapCores(r.perCore), nodes: snapNodes(r.nodes) };
  }) : acct.rows;

  // drop unreachable and duplicate stops
  var stops = [];
  raw.forEach(function (r) {
    if (r.reachable === false) return;
    var last = stops[stops.length - 1];
    if (last && r.gold === last.gold && r.damage === last.damage) return;
    stops.push(r);
  });

  // Segments: entry first, then stop-to-stop marginals. The BASE only advances
  // when damage does: budgets run separate advisor streams, so a later stop can
  // be marginally cheaper than an earlier one, and measuring from the skipped
  // stop would mint a negative-gold row. A skipped stop's spend rolls into the
  // next real segment instead.
  var segs = [], base = { gold: 0, damage: 0, gems: 0 };
  stops.forEach(function (st) {
    var dG = st.gold - base.gold, dD = st.damage - base.damage;
    if (dD <= 1e-9) return;                      // hold the base, fold the spend
    segs.push({ gold: Math.max(0, dG), damage: dD, end: st });
    base = st;
  });

  // Pool RATES only (pair-adjacent-violators), never the rows: every grade
  // letter keeps its own row — Shizu has caught vanishing grades twice —
  // and the members of a pooled stretch share the stretch's unlock rate
  // (poolG/poolD), so the ladder's price stays monotone and the letters
  // inside a stretch unlock together, in order.
  var groups = [];
  segs.forEach(function (s) {
    groups.push({ gold: s.gold, damage: s.damage, members: [s] });
    while (groups.length > 1) {
      var a = groups[groups.length - 2], b = groups[groups.length - 1];
      if (b.gold / b.damage >= a.gold / a.damage) break;
      groups.splice(groups.length - 2, 2, { gold: a.gold + b.gold,
        damage: a.damage + b.damage, members: a.members.concat(b.members) });
    }
  });

  var rows = [], cumG = 0, cumD = 0, prevBand = "ungraded", prevGems = 0;
  groups.forEach(function (g) {
    g.members.forEach(function (s) {
      var e = s.end;
      cumG += s.gold; cumD += s.damage;
      var dGems = Math.max(0, e.gems - prevGems);
      rows.push({
        from: prevBand, to: e.meanBand,
        note: "mean " + e.mean.toFixed(0),
        gold: Math.round(s.gold),
        damage: Number(s.damage.toFixed(5)),
        poolG: Math.round(g.gold),
        poolD: Number(g.damage.toFixed(5)),
        total: Math.round(cumG),
        totalDamage: Number(cumD.toFixed(4)),
        gems: dGems,
        weeks: dGems / acct.cutsPerWeek,
        grid: { cores: e.cores, coresPer: e.perCore, nodes: e.nodes },
        meanGrade: e.mean, weakest: e.weakest, weakBand: e.band,
        minimum: "all 24 slots filled, gems averaging " + e.meanBand,
        buy: rarity + " astrogems at " + acct.turns + " turns and " + acct.rerolls +
          " rerolls, duds fused, advisor tracking your weakest slot"
      });
      prevBand = e.meanBand; prevGems = e.gems;
    });
  });

  var out = {
    axis: AXIS, rarity: rarity, model: "account",
    draw: acct.draw || "mc",
    // highest budget tier actually simulated — the page marks anything the
    // slider asks for beyond this as still filling in
    maxGpd: (acct.rows || []).reduce(function (m, r) { return Math.max(m, r.gpd || 0); }, 0),
    slots: acct.slots, cutsPerWeek: acct.cutsPerWeek,
    turns: acct.turns, rerolls: acct.rerolls, n: acct.n, sig: acct.sig,
    note: "Priced by the account simulator: cut with the advisor at your " +
      "weakest slot's grade and your budget, socket what beats the pack, " +
      "willpower-legal cores only. Gold covers cutting and fusing; the raw " +
      "astrogem is free. The band ladder (docs/research/ark-grid.md) is the " +
      "uniformity-cost reference, not the price.",
    rows: rows,
    // one simulated account per budget tier — the card's example tracks the
    // slider through these (the bracelet rule: the example follows the
    // budget, not just the band), while the rows above stay the rung steps
    tiers: (acct.rows || []).filter(function (r) { return r.reachable !== false; })
      .map(function (r) {
        return { gpd: r.gpd, gold: r.gold, gems: r.gems, weeks: r.weeks,
          damage: r.damage, mean: r.mean, meanBand: r.meanBand,
          weakest: r.weakest, weakBand: r.band, cores: r.cores,
          capped: !!r.capped, perCore: snapCores(r.perCore), nodes: snapNodes(r.nodes) };
      })
  };
  fs.writeFileSync("data/arkgrid-rows-" + PREFIX + rarity + ".json", JSON.stringify(out, null, 1));

  console.log(rarity + " — " + rows.length + " rows");
  rows.forEach(function (r) {
    console.log("  " + (r.from + " -> " + r.to).padEnd(20) +
      ("(" + r.note + ")").padEnd(10) +
      Math.round(r.gold / 1000).toLocaleString().padStart(7) + "k" +
      (r.damage.toFixed(3) + "%").padStart(9) +
      ("gpd " + Math.round(r.gold / (r.damage * 3) / 1000).toLocaleString() + "k").padStart(12) +
      String(r.gems).padStart(6) + " gems" + r.weeks.toFixed(0).padStart(4) + "w");
  });
});
console.log("wrote data/arkgrid-rows-" + PREFIX + "{epic,rare}.json");
