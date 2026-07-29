#!/usr/bin/env node
/* tools/build-level-model.js — train ocr/level-model.js from the labelled corpus.
 *
 * WHAT THIS IS. Every other reader in this engine is a hand-derived rule mined
 * against the corpus and then scored on it. This one is the opposite: the corpus
 * is TRAINING data. For each level node the engine already produces several
 * observations — the template pass's argmax, the synthesis consult's raw and
 * gradient argmaxes (each with a decisiveness margin), the ladder's own committed
 * read with its source and confidence, and at S the diamond's luminance hint. This
 * tool measures, per node and per observation, the smoothed confusion table
 *
 *     P(observation | true level)
 *
 * so the engine can score whole 4-tuple HYPOTHESES — the assignment of four values
 * to the four positions — against one board instead of reading four nodes
 * independently and reconciling afterwards. That framing is the point: a swap and a
 * compensating pair are only wrong JOINTLY (each node alone looks plausible), so no
 * per-node channel can see them, and six of them were ruled out by measurement in
 * rounds 4-9. The header points total enters as a term in the hypothesis score, not
 * as a post-hoc check.
 *
 * TRAINING DISCIPLINE. The djb2(stem)%5==0 holdout (~20% of boards) is excluded
 * from calibration and from the weight fit, exactly as tools/build-level-refs.js
 * excludes it from the reference harvest, and the report prints holdout separately.
 * With 472 boards overfitting is the default outcome; the holdout number is the
 * only one worth believing.
 *
 * No new dependencies: sharp + tesseract.js, the same pair tools/eval-ocr.js uses.
 *
 * Usage:
 *   node tools/build-level-model.js                     # parse corpus, train, write
 *   node tools/build-level-model.js --cache=/tmp/e.json # cache the parse (slow part)
 *   node tools/build-level-model.js --dry                # report only, write nothing
 *   node tools/build-level-model.js --dir=samples --alpha=2 --out=ocr/level-model.js
 */
"use strict";
process.env.OCR_LEVEL_EVID = "1";   // must be set BEFORE the engine module loads

var fs = require("fs"), path = require("path");
var ROOT = path.resolve(__dirname, "..");
var A = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) A[m[1]] = m[2] === undefined ? "1" : m[2];
});
var DIR = path.resolve(ROOT, A.dir || "samples");
var OUT = path.resolve(ROOT, A.out || "ocr/level-model.js");
var ALPHA = parseFloat(A.alpha || "2");
var NK = ["N", "W", "E", "S"];
var LF = ["willpowerLevel", "effect1Level", "effect2Level", "orderLevel"];

function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
function isHoldout(stem) { return djb2(stem) % 5 === 0; }

// ---------------------------------------------------------------- observations
function argmax5(a) { var b = 0; for (var i = 1; i < 5; i++) if (a[i] > a[b]) b = i; return b + 1; }
function margin5(a) { var s = a.slice().sort(function (x, y) { return y - x; }); return s[0] - s[1]; }
function perClass(map) {
  if (!map) return null;
  var a = [0, 0, 0, 0, 0], any = false;
  for (var v = 1; v <= 5; v++) { if (map[v] != null) { a[v - 1] = map[v]; any = true; } else a[v - 1] = -1; }
  return any ? a : null;
}
function obsFromEvid(e) {
  var obs = [];
  for (var i = 0; i < 4; i++) {
    var sy = (e.synth && e.synth[NK[i]]) || {};
    var pr = perClass(sy.perRaw), pg = perClass(sy.perGrad), tv = e.vecs[i];
    obs.push({
      rawTop: pr ? argmax5(pr) : null, rawM: pr ? margin5(pr) : 0,
      gradTop: pg ? argmax5(pg) : null, gradM: pg ? margin5(pg) : 0,
      tmTop: tv ? argmax5(tv) : null,
      read: e.indep[i].v, readC: e.indep[i].c, src: e.src[i] || "none"
    });
  }
  // `got` is the PRE-joint per-node solve, so the report always measures what
  // this stage adds even when a trained model is already live in the tree.
  return { obs: obs, pts: e.pts, ptsSoft: !!e.ptsSoft, sHint: e.sHint, got: (e.preJoint || e.levels).slice() };
}

// ---------------------------------------------------------------- corpus parse
async function collect() {
  if (A.cache && fs.existsSync(path.resolve(A.cache))) {
    console.log("reading cached observations from " + A.cache);
    return JSON.parse(fs.readFileSync(path.resolve(A.cache), "utf8"));
  }
  var engineApi = require(path.join(ROOT, "ocr", "engine.js"));
  var structural = require(path.join(ROOT, "ocr", "structural-engine.js"));
  var sharp = require(path.join(ROOT, "node_modules", "sharp"));
  var Tesseract = require(path.join(ROOT, "node_modules", "tesseract.js"));
  var workerP = null;
  function getWorker() {
    if (!workerP) workerP = Tesseract.createWorker("eng", 1, { logger: function () {}, cachePath: ROOT });
    return workerP;
  }
  var q = Promise.resolve();
  function nodeOcr(raster, opts) {
    q = q.then(async function () {
      var w = await getWorker();
      await w.setParameters({
        tessedit_pageseg_mode: String((opts && opts.psm) || 6),
        tessedit_char_whitelist: (opts && opts.whitelist) || "", user_defined_dpi: "150"
      }).catch(function () {});
      var png = await sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length),
        { raw: { width: raster.width, height: raster.height, channels: 4 } }).png().toBuffer();
      var res = await w.recognize(png);
      return { text: (res.data && res.data.text) || "", conf: ((res.data && res.data.confidence) || 40) / 100 };
    });
    return q;
  }
  var files = fs.readdirSync(DIR);
  var imgs = files.filter(function (f) { return /\.(png|jpg|jpeg|webp)$/i.test(f); });
  var recs = [], n = 0;
  for (var i = 0; i < imgs.length; i++) {
    var stem = imgs[i].replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (files.indexOf(stem + ".json") === -1) continue;
    var truthRaw;
    try { truthRaw = JSON.parse(fs.readFileSync(path.join(DIR, stem + ".json"), "utf8")); } catch (e) { continue; }
    if (truthRaw._unusable) continue;
    var skip = {}; ((truthRaw._mask && truthRaw._mask.skip) || []).forEach(function (f) { skip[f] = true; });
    var truthCfg = engineApi.constraintSnap(truthRaw).config;
    var truth = LF.map(function (k) { return skip[k] ? null : truthCfg[k]; });
    if (truth.some(function (t) { return !(t >= 1 && t <= 5); })) continue;   // masked or unlabelled
    try {
      var dec = await sharp(path.join(DIR, imgs[i])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      var raster = { width: dec.info.width, height: dec.info.height,
        data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length) };
      var raw = await structural.parseStructural(raster, nodeOcr);
      var e = raw._debug && raw._debug.lvEvid;
      if (!e) continue;
      var o = obsFromEvid(e);
      o.name = stem; o.truth = truth; o.holdout = isHoldout(stem);
      recs.push(o);
    } catch (err) { console.error("  parse failed " + stem + ": " + (err && err.message)); }
    if (++n % 25 === 0) console.log("  parsed " + n + "…");
  }
  try { var w2 = await getWorker(); await w2.terminate(); } catch (e) {}
  if (A.cache) fs.writeFileSync(path.resolve(A.cache), JSON.stringify(recs));
  return recs;
}

// ---------------------------------------------------------------- calibration
// Every table is a 5-row (true level 1..5) by 6-column (observed 1..5, or "none")
// smoothed conditional, stored as natural logs.
function newCM() { var m = []; for (var i = 0; i < 5; i++) m.push([ALPHA, ALPHA, ALPHA, ALPHA, ALPHA, ALPHA]); return m; }
function normCM(m) {
  return m.map(function (row) {
    var t = row.reduce(function (a, x) { return a + x; }, 0);
    return row.map(function (x) { return Math.round(Math.log(x / t) * 1000) / 1000; });
  });
}
function readKey(o) { return o.src + "|" + (o.readC >= 0.75 ? "hi" : o.readC >= 0.5 ? "md" : "lo"); }
// A channel's decisiveness splits its table in two: a flat ranking and a decisive
// one are different observations about the same node, and pooling them throws the
// distinction away (measured: the W raw channel's argmax is near-useless when flat
// and informative when decisive).
function mBucket(m) { return m >= 0.05 ? 1 : 0; }

function calibrate(set) {
  var C = { raw: {}, grad: {}, tm: {}, read: {}, pool: {}, hint: newCM() };
  NK.forEach(function (k) { C.raw[k] = [newCM(), newCM()]; C.grad[k] = [newCM(), newCM()]; C.tm[k] = newCM(); C.read[k] = {}; C.pool[k] = newCM(); });
  set.forEach(function (b) {
    for (var i = 0; i < 4; i++) {
      var k = NK[i], t = b.truth[i] - 1, o = b.obs[i];
      if (o.rawTop) C.raw[k][mBucket(o.rawM)][t][o.rawTop - 1]++;
      if (o.gradTop) C.grad[k][mBucket(o.gradM)][t][o.gradTop - 1]++;
      C.tm[k][t][o.tmTop ? o.tmTop - 1 : 5]++;
      var rk = readKey(o);
      if (!C.read[k][rk]) C.read[k][rk] = newCM();
      C.read[k][rk][t][o.read ? o.read - 1 : 5]++;
      C.pool[k][t][o.read ? o.read - 1 : 5]++;
      if (i === 3) C.hint[t][b.sHint ? b.sHint - 1 : 5]++;
    }
  });
  var M = { raw: {}, grad: {}, tm: {}, read: {}, pool: {}, hint: normCM(C.hint) };
  NK.forEach(function (k) {
    M.raw[k] = [normCM(C.raw[k][0]), normCM(C.raw[k][1])];
    M.grad[k] = [normCM(C.grad[k][0]), normCM(C.grad[k][1])];
    M.tm[k] = normCM(C.tm[k]);
    M.pool[k] = normCM(C.pool[k]);
    M.read[k] = {}; Object.keys(C.read[k]).forEach(function (rk) { M.read[k][rk] = normCM(C.read[k][rk]); });
  });
  var pc = [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]];
  set.forEach(function (b) { for (var i = 0; i < 4; i++) pc[i][b.truth[i] - 1]++; });
  M.prior = pc.map(function (r) {
    var t = r.reduce(function (a, x) { return a + x; }, 0);
    return r.map(function (x) { return Math.round(Math.log(x / t) * 1000) / 1000; });
  });
  // How often the header total actually equals the true sum, split by whether the
  // engine called the read soft. This is what lets the sum be EVIDENCE rather than
  // a constraint: a header that disagrees with an otherwise-strong tuple loses.
  var hh = [1, 1], ss = [1, 1];
  set.forEach(function (b) {
    if (b.pts == null) return;
    var sum = b.truth.reduce(function (a, x) { return a + x; }, 0);
    (b.ptsSoft ? ss : hh)[b.pts === sum ? 1 : 0]++;
  });
  M.ptsHard = Math.round(hh[1] / (hh[0] + hh[1]) * 10000) / 10000;
  M.ptsSoft = Math.round(ss[1] / (ss[0] + ss[1]) * 10000) / 10000;
  return M;
}

// ---------------------------------------------------------------- the solver
// Kept byte-identical in shape to jointLevelSolve() in ocr/structural-engine.js —
// change the two together or the trained tables stop describing the reader.
function solve(M, W, b) {
  var L = [], i, v;
  for (i = 0; i < 4; i++) {
    var k = NK[i], o = b.obs[i], acc = [0, 0, 0, 0, 0];
    for (v = 0; v < 5; v++) {
      var s = W.wPrior * M.prior[i][v];
      if (o.rawTop) s += W.wRaw * M.raw[k][mBucket(o.rawM)][v][o.rawTop - 1];
      if (o.gradTop) s += W.wGrad * M.grad[k][mBucket(o.gradM)][v][o.gradTop - 1];
      s += W.wTm * M.tm[k][v][o.tmTop ? o.tmTop - 1 : 5];
      var rm = M.read[k][readKey(o)] || M.pool[k];
      s += W.wRead * rm[v][o.read ? o.read - 1 : 5];
      if (i === 3) s += W.wHint * M.hint[v][b.sHint ? b.sHint - 1 : 5];
      acc[v] = s;
    }
    L.push(acc);
  }
  var hit = null, miss = null;
  if (b.pts != null) {
    var rel = Math.min(0.9995, Math.max(0.05, b.ptsSoft ? M.ptsSoft : M.ptsHard));
    hit = W.wPts * Math.log(rel); miss = W.wPts * Math.log((1 - rel) / 16);
  }
  var best = null, bestS = -Infinity, a, c, d, e2, s2;
  var alt = [[-1e18, -1e18, -1e18, -1e18, -1e18], [-1e18, -1e18, -1e18, -1e18, -1e18],
             [-1e18, -1e18, -1e18, -1e18, -1e18], [-1e18, -1e18, -1e18, -1e18, -1e18]];
  for (a = 1; a <= 5; a++) for (c = 1; c <= 5; c++) for (d = 1; d <= 5; d++) for (e2 = 1; e2 <= 5; e2++) {
    s2 = L[0][a - 1] + L[1][c - 1] + L[2][d - 1] + L[3][e2 - 1];
    if (hit != null) s2 += ((a + c + d + e2) === b.pts) ? hit : miss;
    if (s2 > bestS) { bestS = s2; best = [a, c, d, e2]; }
    if (s2 > alt[0][a - 1]) alt[0][a - 1] = s2;
    if (s2 > alt[1][c - 1]) alt[1][c - 1] = s2;
    if (s2 > alt[2][d - 1]) alt[2][d - 1] = s2;
    if (s2 > alt[3][e2 - 1]) alt[3][e2 - 1] = s2;
  }
  var margin = [0, 0, 0, 0];
  for (i = 0; i < 4; i++) {
    var mx = -1e18;
    for (v = 1; v <= 5; v++) if (v !== best[i] && alt[i][v - 1] > mx) mx = alt[i][v - 1];
    margin[i] = bestS - mx;
  }
  return { v: best, margin: margin };
}

function score(M, W, set) {
  var ok = 0, board = 0, per = [0, 0, 0, 0];
  set.forEach(function (b) {
    var r = solve(M, W, b); b._j = r; var all = true;
    for (var i = 0; i < 4; i++) { if (r.v[i] === b.truth[i]) { ok++; per[i]++; } else all = false; }
    if (all) board++;
  });
  return { ok: ok, tot: set.length * 4, board: board, n: set.length, per: per };
}
function scoreIncumbent(set) {
  var ok = 0, board = 0, per = [0, 0, 0, 0];
  set.forEach(function (b) {
    var all = true;
    for (var i = 0; i < 4; i++) { if (b.got[i] === b.truth[i]) { ok++; per[i]++; } else all = false; }
    if (all) board++;
  });
  return { ok: ok, tot: set.length * 4, board: board, n: set.length, per: per };
}

// ---------------------------------------------------------------- main
(async function () {
  var recs = await collect();
  var TRAIN = recs.filter(function (b) { return !b.holdout; });
  var HOLD = recs.filter(function (b) { return b.holdout; });
  console.log("corpus " + recs.length + " labelled boards — train " + TRAIN.length + ", holdout " + HOLD.length + " (djb2%5==0)");
  var M = calibrate(TRAIN);

  // Channel weights: one scalar per channel, fitted by coordinate ascent on the
  // TRAINING split only. Nine numbers against 1500 training node-labels — this is
  // deliberately the smallest fit that can express "this channel is worth less
  // than that one", not a model with capacity to memorize a board.
  var W = { wRaw: 1, wGrad: 1, wTm: 1, wRead: 1, wHint: 1, wPrior: 1, wPts: 1 };
  var BOUND = { wRaw: [0, 3], wGrad: [0, 3], wTm: [0, 3], wRead: [0, 3], wHint: [0, 3], wPrior: [0, 3], wPts: [0, 4] };
  var cur = score(M, W, TRAIN).ok;
  for (var it = 0; it < (A.nofit ? 0 : 60); it++) {
    var improved = false;
    Object.keys(W).forEach(function (k) {
      var base = W[k];
      [-0.4, -0.2, -0.1, 0.1, 0.2, 0.4].forEach(function (dd) {
        var c = Math.max(BOUND[k][0], Math.min(BOUND[k][1], Math.round((base + dd) * 100) / 100));
        if (c === base) return;
        W[k] = c; var s = score(M, W, TRAIN).ok;
        if (s > cur) { cur = s; base = c; improved = true; } else W[k] = base;
      });
      W[k] = base;
    });
    if (!improved) break;
  }
  M.w = W;

  function fmt(tag, set) {
    var j = score(M, W, set), i2 = scoreIncumbent(set);
    return "  " + tag.padEnd(8) + " joint " + j.ok + "/" + j.tot + " (" + (j.ok / j.tot * 100).toFixed(1) + "%) all-four " + j.board + "/" + j.n +
      "   incumbent " + i2.ok + " (" + (i2.ok / i2.tot * 100).toFixed(1) + "%) all-four " + i2.board +
      "   N/W/E/S joint " + j.per.join("/") + " vs " + i2.per.join("/");
  }
  console.log("\nnode-level accuracy (the solve in isolation; end-to-end is npm run eval-ocr):");
  console.log(fmt("TRAIN", TRAIN));
  console.log(fmt("HOLDOUT", HOLD));
  console.log(fmt("ALL", recs));
  console.log("  weights " + JSON.stringify(W) + "   ptsHard " + M.ptsHard + "  ptsSoft " + M.ptsSoft + "  alpha " + ALPHA);

  score(M, W, recs);
  var fx = 0, bk = 0, fxH = 0, bkH = 0, ov = 0;
  recs.forEach(function (b) {
    for (var i = 0; i < 4; i++) {
      if (b._j.v[i] === b.got[i]) continue;
      ov++;
      var jOk = b._j.v[i] === b.truth[i], iOk = b.got[i] === b.truth[i];
      if (jOk && !iOk) { fx++; if (b.holdout) fxH++; }
      if (!jOk && iOk) { bk++; if (b.holdout) bkH++; }
    }
  });
  console.log("  overrides " + ov + ": fixed " + fx + ", broken " + bk + ", both-wrong " + (ov - fx - bk) +
    "   [holdout fixed " + fxH + " broken " + bkH + "]");

  if (A.dry) { console.log("\n--dry: nothing written."); return; }
  var meta = { built: new Date().toISOString().slice(0, 10), boards: recs.length, train: TRAIN.length, alpha: ALPHA };
  var body = "// GENERATED by tools/build-level-model.js — do not edit by hand.\n" +
    "// Calibrated observation tables for the JOINT level solve: for each node and\n" +
    "// each channel, log P(observation | true level), smoothed (alpha=" + ALPHA + ") and\n" +
    "// estimated on the " + TRAIN.length + " non-holdout boards of the " + recs.length + "-board corpus\n" +
    "// (djb2(stem)%5==0 excluded, as in tools/build-level-refs.js). Rows are the true\n" +
    "// level 1..5; columns are the observed class 1..5 plus a trailing \"absent\".\n" +
    "// REGENERATING THIS FILE CHANGES WHAT THE ENGINE READS — re-run the full eval and\n" +
    "// A/B it against the shipped build before keeping the result.\n" +
    "(function (root) {\n  \"use strict\";\n" +
    "  var LEVEL_MODEL = " + JSON.stringify(M) + ";\n" +
    "  var META = " + JSON.stringify(meta) + ";\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = { LEVEL_MODEL: LEVEL_MODEL, LEVEL_MODEL_META: META };\n" +
    "  else root.OcrLevelModel = { LEVEL_MODEL: LEVEL_MODEL, LEVEL_MODEL_META: META };\n" +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(OUT, body);
  console.log("\nwrote " + path.relative(ROOT, OUT) + "  (" + (body.length / 1024).toFixed(1) + " KB)");
  console.log("!! This file is TRAINED DATA. It was fitted to the corpus as it stands today.");
  console.log("!! Re-run `npm run eval-gate` and A/B against the previous build before shipping it.");
})().catch(function (e) { console.error(e); process.exit(1); });
