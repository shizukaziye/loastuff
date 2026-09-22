/**
 * xcross-analyze.js — what the crossing definition does to the rung prices.
 *
 *   node tools/xcross-analyze.js <file.jsonl> [file2.jsonl ...]
 *
 * Reads the raw per-account crossing records written by --xcross and, per
 * budget and band, reports three prices for the same rung:
 *
 *   first      mean gold at the FIRST touch of the cut (what the chart uses)
 *   sustained  mean gold from the point the mean never dips below again
 *   median     50th percentile over ALL accounts, non-crossers counted as
 *              infinity — immune to survivor tilt while coverage > 50%
 *
 * Each with standard errors, plus the marginal gold-per-1% between adjacent
 * bands under first vs sustained. If the B window is a sampling artifact the
 * error bars will say so; if first-touch bias is flattening the curve, the
 * sustained column will widen it.
 */
"use strict";
var fs = require("fs");

var files = process.argv.slice(2);
if (!files.length) { console.error("need at least one .jsonl"); process.exit(1); }

var BANDS = ["C+", "B-", "B", "B+", "A-", "A"];
var PARTY = 3;

files.forEach(function (f) {
  var recs = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(function (l) { return JSON.parse(l); });
  var byGpd = {};
  recs.forEach(function (r) { (byGpd[r.gpd] = byGpd[r.gpd] || []).push(r); });
  Object.keys(byGpd).sort(function (a, b) { return a - b; }).forEach(function (g) {
    var rows = byGpd[g], N = rows.length;
    console.log("\n=== " + f + "  gpd " + (g / 1e6).toFixed(2) + "M  accounts " + N);
    console.log("band".padEnd(5) + "cov".padStart(6) + "first".padStart(12) + "+-se".padStart(8) +
      "sustained".padStart(12) + "+-se".padStart(8) + "median".padStart(12) +
      "dmg_f".padStart(9) + "dmg_s".padStart(9));
    var stats = {};
    BANDS.forEach(function (b) {
      var fg = [], sg = [], fd = [], sd = [], med = [];
      rows.forEach(function (r) {
        var x = r.bands[b];
        if (x) {
          fg.push(x.f[0]); fd.push(x.f[1]);
          if (x.s) { sg.push(x.s[0]); sd.push(x.s[1]); }
          med.push(x.f[0]);
        } else med.push(Infinity);
      });
      if (!fg.length) return;
      function mse(a) {
        var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
        var v = a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / Math.max(1, a.length - 1);
        return [m, Math.sqrt(v / a.length)];
      }
      med.sort(function (x, y) { return x - y; });
      var f1 = mse(fg), s1 = sg.length ? mse(sg) : [NaN, NaN];
      var f2 = mse(fd), s2 = sd.length ? mse(sd) : [NaN, NaN];
      stats[b] = { f: f1, s: s1, fd: f2[0], sd: s2[0], cov: fg.length / N,
                   median: med[Math.floor(N / 2)] };
      console.log(b.padEnd(5) + (100 * fg.length / N).toFixed(0).padStart(5) + "%" +
        (Math.round(f1[0] / 1000) + "k").padStart(12) + (Math.round(f1[1] / 1000) + "k").padStart(8) +
        (sg.length ? (Math.round(s1[0] / 1000) + "k") : "-").padStart(12) +
        (sg.length ? (Math.round(s1[1] / 1000) + "k") : "-").padStart(8) +
        (isFinite(stats[b].median) ? Math.round(stats[b].median / 1000) + "k" : "not 50%").padStart(12) +
        f2[0].toFixed(4).padStart(9) + (sd.length ? s2[0].toFixed(4) : NaN).toString().padStart(9));
    });
    console.log("\nmarginal gold per 1% (party) between bands:");
    for (var i = 1; i < BANDS.length; i++) {
      var a = stats[BANDS[i - 1]], b = stats[BANDS[i]];
      if (!a || !b) continue;
      function rate(x, y, dx, dy) {
        var dD = (dy - dx) * PARTY, dG = y - x;
        return dD > 1e-9 ? dG / dD : NaN;
      }
      var rf = rate(a.f[0], b.f[0], a.fd, b.fd);
      var rs = (isFinite(a.s[0]) && isFinite(b.s[0])) ? rate(a.s[0], b.s[0], a.sd, b.sd) : NaN;
      // error bar on the first-touch rate via independent SEs on both golds
      var se = Math.sqrt(a.f[1] * a.f[1] + b.f[1] * b.f[1]) / Math.max(1e-9, (b.fd - a.fd) * PARTY);
      console.log("  " + (BANDS[i - 1] + ">" + BANDS[i]).padEnd(7) +
        "first " + (isNaN(rf) ? "-" : Math.round(rf / 1000) + "k").padStart(8) +
        " +-" + (Math.round(se / 1000) + "k").padEnd(7) +
        "sustained " + (isNaN(rs) ? "-" : Math.round(rs / 1000) + "k").padStart(8));
    }
  });
});
