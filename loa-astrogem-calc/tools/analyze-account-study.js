/**
 * analyze-account-study.js — merge account-study shard JSONs and print the
 * report tables (markdown).
 *
 *   node tools/analyze-account-study.js <dir with account-T*.json>
 */
"use strict";
var fs = require("fs");
var path = require("path");

var dir = process.argv[2];
if (!dir) { console.error("usage: node tools/analyze-account-study.js <dir>"); process.exit(1); }

var files = fs.readdirSync(dir).filter(function (f) { return /^account-T\d-.*\.json$/.test(f); });
if (!files.length) { console.error("no account-T*.json in " + dir); process.exit(1); }

var tiers = {};
files.forEach(function (f) {
  var d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  var t = d.tier.name;
  if (!tiers[t]) tiers[t] = { tier: d.tier, rows: [] };
  tiers[t].rows = tiers[t].rows.concat(d.rows);
});

function mean(rows, fn) { var s = 0; rows.forEach(function (r) { s += fn(r); }); return s / rows.length; }
function pctile(rows, fn, q) {
  var a = rows.map(fn).sort(function (x, y) { return x - y; });
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}
function fmtG(x) {
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(0) + "k";
  return String(Math.round(x));
}

console.log("# Account study — results\n");

Object.keys(tiers).sort().forEach(function (tn) {
  var T = tiers[tn], rows = T.rows, t = T.tier;
  console.log("## " + tn + " — gpd " + fmtG(t.gpd) + ", baseline " + t.bl + ", collection " +
    (t.counts[8] + t.counts[9] + t.counts[10]) + " gems (" + t.counts[8] + "/" + t.counts[9] + "/" + t.counts[10] + ")  ·  " + rows.length + " accounts\n");

  // account state at the collection mark
  console.log("**Collection mark**: kept " + mean(rows, function (r) { return r.keptCount; }).toFixed(1) +
    " gems · base grid damage " + mean(rows, function (r) { return r.baseDmg; }).toFixed(3) +
    "% (p10 " + pctile(rows, function (r) { return r.baseDmg; }, 0.10).toFixed(2) +
    " / p90 " + pctile(rows, function (r) { return r.baseDmg; }, 0.90).toFixed(2) +
    ") · socketed above baseline " + mean(rows, function (r) { return r.aboveBaseline; }).toFixed(1) + "/12" +
    " · min socketed grade " + mean(rows, function (r) { return r.minSockGrade; }).toFixed(1) +
    " · collection gold " + fmtG(mean(rows, function (r) { return r.cutGold; })) + "\n");

  // socketed cost histogram + core bands
  var ch = {}, cb = { b17: 0, b14: 0, b10: 0, b9: 0 };
  rows.forEach(function (r) {
    Object.keys(r.sockCostHist).forEach(function (k) { ch[k] = (ch[k] || 0) + r.sockCostHist[k]; });
    Object.keys(cb).forEach(function (k) { cb[k] += r.coreBands[k]; });
  });
  var chTot = 0; Object.keys(ch).forEach(function (k) { chTot += ch[k]; });
  console.log("**Optimal roster effCost mix**: " + Object.keys(ch).sort(function (a, b) { return a - b; })
    .map(function (k) { return k + ": " + (100 * ch[k] / chTot).toFixed(1) + "%"; }).join(" · "));
  var cbTot = cb.b17 + cb.b14 + cb.b10 + cb.b9;
  console.log("**Core order bands**: 17+ " + (100 * cb.b17 / cbTot).toFixed(1) + "% · 14–16 " + (100 * cb.b14 / cbTot).toFixed(1) +
    "% · 10–13 " + (100 * cb.b10 / cbTot).toFixed(1) + "% · ≤9 " + (100 * cb.b9 / cbTot).toFixed(1) + "%\n");

  // roster analysis
  console.log("**Roster test (grade-greedy vs raw-optimal)**: damage " +
    mean(rows, function (r) { return r.greedyDmg; }).toFixed(3) + "% vs " +
    mean(rows, function (r) { return r.baseDmg; }).toFixed(3) + "% (loss " +
    mean(rows, function (r) { return r.baseDmg - r.greedyDmg; }).toFixed(3) + "%, " +
    (100 * mean(rows, function (r) { return (r.baseDmg - r.greedyDmg) / Math.max(1e-9, r.baseDmg); })).toFixed(1) +
    "% of the grid) · overlap " + mean(rows, function (r) { return r.rosterOverlap; }).toFixed(1) + "/12 · benched-but-higher-grade " +
    mean(rows, function (r) { return r.benchedBetter; }).toFixed(1) + " gems/account (" +
    (100 * mean(rows, function (r) { return r.benchedBetter ? r.benchedBetterLowCost / r.benchedBetter : 0; })).toFixed(0) +
    "% of them effCost ≤ 4)\n");

  // singles: 1,000 single-gem experiments per cost per account
  console.log("**Singles — cut ONE gem, full repack, 1,000 reps per cost** (damage in raw grid %):\n");
  console.log("| Cost | p(gain)/cut | gain given gain | EV per cut | p50 p(gain) | p10–p90 p(gain) | keep rate | mean gold/cut |");
  console.log("|---|---|---|---|---|---|---|---|");
  [8, 9, 10].forEach(function (cost) {
    var k = "c" + cost;
    var pg = function (r) { return r.singles[k].pGain; };
    var ev = function (r) { return r.singles[k].pGain * r.singles[k].condGain; };
    // pooled conditional gain: weight per-account condGain by its gain count (∝ pGain)
    var num = 0, den = 0;
    rows.forEach(function (r) { num += r.singles[k].pGain * r.singles[k].condGain; den += r.singles[k].pGain; });
    console.log("| " + k + " | " + (100 * mean(rows, pg)).toFixed(2) + "%" +
      " | " + (den > 0 ? (num / den).toFixed(4) : "—") + "%" +
      " | " + mean(rows, ev).toFixed(5) + "%" +
      " | " + (100 * pctile(rows, pg, 0.5)).toFixed(1) + "%" +
      " | " + (100 * pctile(rows, pg, 0.10)).toFixed(1) + "–" + (100 * pctile(rows, pg, 0.90)).toFixed(1) + "%" +
      " | " + (100 * mean(rows, function (r) { return r.singles[k].keptRate; })).toFixed(1) + "%" +
      " | " + fmtG(mean(rows, function (r) { return r.singles[k].goldPerCut; })) + " |");
  });

  // paired comparison: best cost per account, by per-cut EV and by p(gain)
  var winsEV = { c8: 0, c9: 0, c10: 0, tie: 0 }, winsP = { c8: 0, c9: 0, c10: 0, tie: 0 };
  rows.forEach(function (r) {
    function pick(w, f) {
      var a = f(r.singles.c8), b = f(r.singles.c9), c = f(r.singles.c10);
      var m = Math.max(a, b, c);
      if (m <= 1e-9) { w.tie++; return; }
      if (a === m) w.c8++; else if (b === m) w.c9++; else w.c10++;
    }
    pick(winsEV, function (s) { return s.pGain * s.condGain; });
    pick(winsP, function (s) { return s.pGain; });
  });
  function winLine(w) {
    return "c8 " + (100 * w.c8 / rows.length).toFixed(1) + "% · c9 " + (100 * w.c9 / rows.length).toFixed(1) +
      "% · c10 " + (100 * w.c10 / rows.length).toFixed(1) + "% · none " + (100 * w.tie / rows.length).toFixed(1) + "%";
  }
  console.log("\n**Best cost per account (paired)** — by EV/cut: " + winLine(winsEV) + " · by p(gain): " + winLine(winsP) + "\n");
});
