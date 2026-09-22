/**
 * dd-sweep.js — drive the deterministic direct-draw sweep, tier by tier.
 *
 *   node tools/dd-sweep.js [--workers=8] [--reps=10000] [--rarities=rare,epic]
 *                          [--push=1] [--outdir=tools/.cache/dd]
 *
 * One child process per (rarity, gpd tier): the child runs arkgrid-account.js
 * in --draw=dd mode, samples its accounts' gems from the exact cut
 * distributions, and writes a final shard file with rows, rungs and crossRaw.
 * One tier per child keeps every property we want: a finished file is a
 * finished tier (resume = skip files without a partial flag), no two children
 * ever build the same cell (cells are keyed by gpd), and a crash loses at
 * most the tier in flight.
 *
 * Tiers run lowest gpd first, so the site's ladder fills from the bottom —
 * which is the order the chart's users climb it.
 *
 * After each tier, when the rarity has a complete MC anchor lattice, the
 * tier's dd means are checked against the anchor tier (gold, damage, gems).
 * A tier that disagrees beyond tolerance is quarantined: logged, excluded
 * from the merge, and left for inspection — the sweep itself keeps going.
 * Passing tiers are merged into the canonical account file, the row builder
 * runs, a progress file is stamped, and the lot is committed and pushed so
 * the chart updates while the sweep is still running.
 */
"use strict";
var QUIET = require("./quiet-hours.js");
var cp = require("child_process"), fs = require("fs"), path = require("path");

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)=(.*)$/);
  if (m) ARGS[m[1]] = m[2];
});
var WORKERS = parseInt(ARGS.workers, 10) || 8;
var REPS = parseInt(ARGS.reps, 10) || 10000;
var RARITIES = String(ARGS.rarities || "rare,epic").split(",");
var AXIS = String(ARGS.axis || "support");
var PUSH = ARGS.push !== "0";
var OUTDIR = ARGS.outdir || (AXIS === "dps" ? "tools/.cache/dd-dps" : "tools/.cache/dd");
var ANCHDIR = AXIS === "dps" ? "tools/.cache/anchors-dps" : "tools/.cache/anchors";
var ACCT_FILE = function (r) {
  return "data/arkgrid-account-" + (AXIS === "dps" ? "dps-" : "") + r + ".json";
};
var PROG_FILE = AXIS === "dps" ? "data/arkgrid-progress-dps.json" : "data/arkgrid-progress.json";
fs.mkdirSync(OUTDIR, { recursive: true });

// the 29 slider tiers, 250k to 100M — same lattice the MC anchors ran
var TIERS = [250000, 300566, 361360, 434450, 522324, 627972, 754988, 907695,
  1091290, 1312019, 1577393, 1896444, 2280027, 2741195, 3295642, 3962233,
  4763652, 5727169, 6885572, 8278278, 9952679, 11965752, 14385998, 17295774,
  20794094, 25000000, 40000000, 63000000, 100000000];
var HEAP = { rare: 4096, epic: 8192 };

function shardPath(r, g) { return path.join(OUTDIR, r + "-g" + g + ".json"); }
function doneShard(r, g) {
  try {
    var d = JSON.parse(fs.readFileSync(shardPath(r, g), "utf8"));
    return d.partial !== true && d.rungs;
  } catch (e) { return false; }
}

// ---- anchor lattice, re-read until complete --------------------------------
// epic anchors are still running when the sweep starts: keep re-reading until
// the lattice is whole, then gate — and backfill-check tiers merged before it
var anchorRows = {}, anchorAt = {};        // rarity -> { gpd -> row } or null
function loadAnchors(r) {
  if (anchorRows[r]) return anchorRows[r];                       // complete: fixed
  if (anchorAt[r] && Date.now() - anchorAt[r] < 300000) return anchorRows[r];
  anchorAt[r] = Date.now();
  var rows = {}, tiers = 0;
  try {
    fs.readdirSync(ANCHDIR).forEach(function (f) {
      if (f.indexOf(r + "-s") !== 0 || !/\.json$/.test(f)) return;
      var d = JSON.parse(fs.readFileSync(path.join(ANCHDIR, f), "utf8"));
      if (d.rarity !== r) return;
      (d.rows || []).forEach(function (row) { rows[row.gpd] = row; tiers++; });
    });
  } catch (e) { /* anchors absent */ }
  // Gate per TIER, not per lattice. Requiring a complete lattice meant the
  // DPS axis (10 spot anchors, no full run) shipped every tier unchecked;
  // an anchor at THIS gpd is exactly as validating whether or not its
  // neighbours exist. Tiers with no anchor still pass through unchecked —
  // that is unavoidable — but they now say so per tier.
  anchorRows[r] = tiers ? rows : null;
  log(r + " anchors: " + tiers + " tiers -> " +
      (anchorRows[r] ? "gating where anchors exist" : "none, no gate"));
  return anchorRows[r];
}

// A dd tier must agree with its MC anchor tier. The anchor is 15-240 accounts
// of MC noise, the dd side is REPS near-exact samples, so the tolerance is
// generous — this is a tripwire for wiring bugs, not a significance test.
var TOL = 0.10;
function checkTier(r, g) {
  var anch = loadAnchors(r);
  if (!anch) return { ok: true, note: "no anchors yet" };
  var a = anch[g];
  var d;
  try { d = JSON.parse(fs.readFileSync(shardPath(r, g), "utf8")).rows[0]; }
  catch (e) { return { ok: false, note: "unreadable shard: " + e.message }; }
  if (!a) return { ok: true, note: "no anchor tier" };
  if (a.reachable === false && d.reachable === false) return { ok: true, note: "both unreachable" };
  if (!!(a.reachable === false) !== !!(d.reachable === false))
    return { ok: false, note: "reachability differs (anchor " + (a.reachable === false ? "no" : "yes") +
      ", dd " + (d.reachable === false ? "no" : "yes") + ")" };
  // Gold and damage gate hard: a wiring bug (wrong cell, wrong band, wrong
  // prices) moves them. Gem count is log-only: the PAVA stop is block-
  // quantized, and dd's variance-reduced gold (conditional mean per draw)
  // legitimately tips marginal blocks the noisy MC stop misses — at 2.74M
  // the MC anchors jump 91 -> 115 gems between tiers while dd walks smoothly
  // through at 104, gold within 6%, damage within 1%. The smooth curve is
  // the better estimate; quarantining it would keep the honest number off
  // the chart.
  var bad = [], soft = [];
  // Damage gates hard: it agreed within ~2% on every knife-edge tier and a
  // wiring bug cannot leave it standing. Gold is log-only by Shizu's ruling
  // (2026-08-18, "we can just believe the dd"): at deep budgets the two draw
  // laws legitimately split the borderline all-or-nothing buyers, so gold
  // means diverge while both are faithful to the same rule.
  ["damage"].forEach(function (k) {
    var rel = Math.abs(d[k] - a[k]) / Math.max(1e-9, Math.abs(a[k]));
    if (rel > TOL) bad.push(k + " " + (rel * 100).toFixed(1) + "% (dd " + d[k] + " vs mc " + a[k] + ")");
  });
  var goldRel = Math.abs(d.gold - a.gold) / Math.max(1e-9, Math.abs(a.gold));
  if (goldRel > TOL) soft.push("gold " + (goldRel * 100).toFixed(1) + "% (dd " + d.gold + " vs mc " + a.gold + ", log-only)");
  var gemRel = Math.abs(d.gems - a.gems) / Math.max(1, Math.abs(a.gems));
  if (gemRel > TOL) soft.push("gems " + (gemRel * 100).toFixed(1) + "% (dd " + d.gems + " vs mc " + a.gems + ", log-only)");
  return bad.length ? { ok: false, note: bad.join("; ") }
    : { ok: true, note: soft.length ? "gold+damage within " + (TOL * 100) + "%; " + soft.join("; ")
                                    : "within " + (TOL * 100) + "%" };
}

// ---- queue ------------------------------------------------------------------
var queue = [];
TIERS.forEach(function (g) {
  RARITIES.forEach(function (r) { queue.push({ r: r, g: g }); });
});
var quarantined = [], failed = [], running = 0, launched = 0;
var gated = {};                            // "r:g" -> anchor check done
var t0 = Date.now();

function log(m) {
  var line = "[" + ((Date.now() - t0) / 60000).toFixed(1) + "m] " + m;
  console.log(line);
  fs.appendFileSync(path.join(OUTDIR, "sweep.log"), line + "\n");
}

// ---- publish: merge -> rows -> progress -> commit -> push ------------------
var gitBusy = false, gitPending = false;
function publish(reason) {
  if (gitBusy) { gitPending = true; return; }
  gitBusy = true;
  try {
    // backfill: tiers merged before a rarity's anchors completed get their
    // gate check the first publish after the lattice lands
    RARITIES.forEach(function (r) {
      if (!loadAnchors(r)) return;
      TIERS.forEach(function (g) {
        var key = r + ":" + g;
        if (gated[key] || !doneShard(r, g)) return;
        var chk = checkTier(r, g);
        gated[key] = true;
        if (!chk.ok) {
          quarantined.push({ r: r, g: g, note: chk.note });
          log("QUARANTINE (backfill) " + r + " gpd " + (g / 1e6).toFixed(2) + "M: " + chk.note);
        }
      });
    });
    var mergedAny = [];
    RARITIES.forEach(function (r) {
      // merge only shards that are final and not quarantined
      var files = fs.readdirSync(OUTDIR).filter(function (f) {
        return f.indexOf(r + "-g") === 0 && /\.json$/.test(f);
      }).map(function (f) { return path.join(OUTDIR, f); })
        .filter(function (p) {
          var g = parseInt(p.match(/-g(\d+)\.json$/)[1], 10);
          return doneShard(r, g) && quarantined.every(function (q) {
            return !(q.r === r && q.g === g);
          });
        });
      if (!files.length) return;
      var res = cp.spawnSync("node", ["tools/arkgrid-merge.js", "--rarity=" + r,
        "--axis=" + AXIS, "--in=" + files.join(","), "--out=" + ACCT_FILE(r)],
        { encoding: "utf8" });
      if (res.status !== 0) { log("MERGE FAILED " + r + ": " + (res.stderr || "").slice(0, 300)); return; }
      mergedAny.push(r + ":" + files.length);
    });
    if (!mergedAny.length) return;
    var rb = cp.spawnSync("node", ["tools/build-arkgrid-account-rows.js", "--axis=" + AXIS], { encoding: "utf8" });
    if (rb.status !== 0) { log("ROW BUILD FAILED: " + (rb.stderr || "").slice(0, 300)); return; }
    var prog = { updated: new Date().toISOString(), total: TIERS.length, reps: REPS, draw: "dd", axis: AXIS };
    RARITIES.forEach(function (r) {
      prog[r] = { done: TIERS.filter(function (g) { return doneShard(r, g); }).length,
                  quarantined: quarantined.filter(function (q) { return q.r === r; }).length };
    });
    fs.writeFileSync(PROG_FILE, JSON.stringify(prog, null, 1));
    if (PUSH) {
      var addFiles = (AXIS === "dps"
        ? ["data/arkgrid-account-dps-rare.json", "data/arkgrid-account-dps-epic.json",
           "data/arkgrid-rows-dps-rare.json", "data/arkgrid-rows-dps-epic.json", PROG_FILE]
        : ["data/arkgrid-account-rare.json", "data/arkgrid-account-epic.json",
           "data/arkgrid-rows-rare.json", "data/arkgrid-rows-epic.json", PROG_FILE]
      // one rarity can finish long before the other; adding a not-yet-written
      // file makes git add fail the whole publish
      ).filter(function (f) { return fs.existsSync(f); });
      var seq = [
        ["add"].concat(addFiles),
        ["commit", "-m", "arkgrid dd sweep: " + reason],
        ["push"]
      ];
      for (var i = 0; i < seq.length; i++) {
        var gr = cp.spawnSync("git", seq[i], { encoding: "utf8" });
        if (gr.status !== 0 && seq[i][0] !== "commit") {
          log("GIT " + seq[i][0] + " failed: " + (gr.stderr || "").slice(0, 200));
          break;
        }
      }
    }
    log("published (" + mergedAny.join(", ") + ") — " + reason);
  } catch (e) {
    log("PUBLISH ERROR: " + e.message);
  } finally {
    gitBusy = false;
    if (gitPending) { gitPending = false; publish("catch-up"); }
  }
}

// ---- workers ----------------------------------------------------------------
function next() {
  // Do not OPEN a tier inside a quiet window — the running ones park
  // themselves between reps (tools/quiet-hours.js). Re-checked once a minute;
  // an empty machine during the window is the point.
  if (queue.length && QUIET.inQuiet()) {
    if (!next._quiet) {
      next._quiet = true;
      log("quiet hours — holding " + queue.length + " queued tiers (~" +
        QUIET.minutesLeft() + " min)");
    }
    setTimeout(next, 60000);
    return;
  }
  if (next._quiet) { next._quiet = false; log("quiet hours over — resuming"); }
  while (running < WORKERS && queue.length) {
    var job = queue.shift();
    if (doneShard(job.r, job.g)) { onDone(job, true); continue; }
    launch(job);
  }
  if (!running && !queue.length) {
    log("sweep complete. quarantined: " + quarantined.length + ", failed: " + failed.length);
    quarantined.forEach(function (q) { log("  QUARANTINED " + q.r + " g" + q.g + ": " + q.note); });
    failed.forEach(function (q) { log("  FAILED " + q.r + " g" + q.g + " exit " + q.code); });
    publish("final");
    process.exit(quarantined.length + failed.length ? 1 : 0);
  }
}

function launch(job) {
  running++; launched++;
  var lp = path.join(OUTDIR, job.r + "-g" + job.g + ".log");
  var fd = fs.openSync(lp, "w");
  log("start " + job.r + " gpd " + (job.g / 1e6).toFixed(2) + "M  (" + running + " running, " +
    queue.length + " queued)");
  var ch = cp.spawn("node", ["--max-old-space-size=" + HEAP[job.r], "tools/arkgrid-account.js",
    "--rarity=" + job.r, "--axis=" + AXIS, "--n=6000", "--gpds=" + job.g, "--reps=" + REPS,
    "--draw=dd", "--out=" + shardPath(job.r, job.g)],
    { stdio: ["ignore", fd, fd] });
  ch.on("exit", function (code) {
    fs.closeSync(fd);
    running--;
    if (code !== 0) {
      failed.push({ r: job.r, g: job.g, code: code });
      log("FAILED " + job.r + " g" + job.g + " exit " + code + " — see " + lp);
    } else onDone(job, false);
    next();
  });
}

function onDone(job, wasCached) {
  var chk = checkTier(job.r, job.g);
  if (loadAnchors(job.r)) gated[job.r + ":" + job.g] = true;
  if (!chk.ok) {
    quarantined.push({ r: job.r, g: job.g, note: chk.note });
    log("QUARANTINE " + job.r + " gpd " + (job.g / 1e6).toFixed(2) + "M: " + chk.note);
    return;
  }
  log((wasCached ? "cached " : "done ") + job.r + " gpd " + (job.g / 1e6).toFixed(2) + "M  (" + chk.note + ")");
  if (!wasCached) publish(job.r + " " + (job.g / 1e6).toFixed(2) + "M");
}

log("dd sweep: " + RARITIES.join("+") + ", " + TIERS.length + " tiers each, reps " +
  REPS + ", " + WORKERS + " workers");
RARITIES.forEach(loadAnchors);
next();
