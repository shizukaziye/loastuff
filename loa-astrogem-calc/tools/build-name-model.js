#!/usr/bin/env node
/* tools/build-name-model.js — train ocr/name-model.js from the labelled corpus.
 *
 * WHAT THIS IS. The sibling of tools/build-level-model.js, for the two effect
 * NAMES. The engine reads each name once, from the wheel's white caption, and
 * grades that read with hand-written lexical rules; every other channel it holds
 * is used only as a rescue after the lexicon has already failed. This tool turns
 * the corpus into TRAINING data instead: for each slot (W/E) and each channel it
 * measures the smoothed conditional
 *
 *     P(observation | true name)
 *
 * so the engine can score whole (effect1, effect2) HYPOTHESES against one board.
 * The vocabulary is closed and tiny — model/astrogem.js EFFECT_POOLS gives exactly
 * four legal names per base cost and the two slots hold different ones — so a name
 * read is a 12-way choice under a known constraint, not open-ended OCR.
 *
 * THE CHANNELS (all recorded by OCR_NAME_EVID=1 in ocr/structural-engine.js):
 *   synRaw / synGrad  the patch synthesis' complete per-class ranking, z-normed
 *                     cosine on the name band and on its gradient. Independent of
 *                     the text channel: pixels, not tokens.
 *   lex               the graded lexical evidence per candidate (regex 1.0, fuzzy
 *                     token 0.55, line-count nudges) — the engine's own reader.
 *   lines             the measured white-text line count. Ally Damage Enh., Ally
 *                     Attack Enh. and Additional Damage render on two lines.
 *   read              the name the engine committed, bucketed by its confidence.
 *
 * NOT a channel: the outcome strip's caption votes. They exist only after the strip
 * has been read, and the strip reads its own target THROUGH the committed names
 * (captionTarget), so consuming them would mean deciding the names after the tiles
 * that depend on them. Measured before it was dropped and worth 0 either way: 879 of
 * 894 slots with the channel and 879 without, and 5-fold CV inside the training split
 * 706 vs 705 of 752. The round-9 caption verifier still uses the votes, unchanged.
 *
 * TRAINING DISCIPLINE. The djb2(stem)%5==0 holdout (~20%) is excluded from every
 * table and from the weight fit, exactly as tools/build-level-refs.js excludes it
 * from the reference harvest (so the synthesis' own exemplars never saw a holdout
 * board either), and the report prints holdout separately. Structural choices were
 * made by 5-fold cross-validation INSIDE the training split — see --cv.
 *
 * No new dependencies: sharp + tesseract.js, the same pair tools/eval-ocr.js uses.
 *
 * Usage:
 *   node tools/build-name-model.js --cache=/tmp/nevid.jsonl   # train from a cache
 *   node tools/build-name-model.js --dry                      # report, write nothing
 *   node tools/build-name-model.js --cv                       # 5-fold CV inside train
 */
"use strict";
process.env.OCR_NAME_EVID = "1";   // must be set BEFORE the engine module loads

var fs = require("fs"), path = require("path");
var ROOT = path.resolve(__dirname, "..");
var A = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) A[m[1]] = m[2] === undefined ? "1" : m[2];
});
var DIR = path.resolve(ROOT, A.dir || "samples");
var OUT = path.resolve(ROOT, A.out || "ocr/name-model.js");
var ALPHA = parseFloat(A.alpha || "1");
var SIDES = ["W", "E"];
var NAMES = ["Additional Damage", "Attack Power", "Brand Power", "Ally Damage Enh.", "Boss Damage", "Ally Attack Enh."];
var NIX = {}; NAMES.forEach(function (n, i) { NIX[n] = i; });
var NN = NAMES.length;

function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }
function isHoldout(stem) { return djb2(stem) % 5 === 0; }

// ---------------------------------------------------------------- observations
function poolOf(cost) {
  var P = { 8: ["Additional Damage", "Attack Power", "Brand Power", "Ally Damage Enh."],
            9: ["Boss Damage", "Attack Power", "Ally Damage Enh.", "Ally Attack Enh."],
            10: ["Boss Damage", "Additional Damage", "Brand Power", "Ally Attack Enh."] };
  return P[cost] || null;
}

// Every discretization lives here so the trainer and ocr/structural-engine.js can
// be checked against each other by eye. Change one, change the other.
function synObs(map) {
  if (!map) return { top: -1, mb: 0 };
  var ranked = NAMES.map(function (n, i) { return { i: i, s: map[n] }; })
    .filter(function (x) { return x.s != null; })
    .sort(function (a, b) { return b.s - a.s; });
  if (!ranked.length) return { top: -1, mb: 0 };
  var mar = ranked.length > 1 ? ranked[0].s - ranked[1].s : 1;
  return { top: ranked[0].i, mb: mar >= 0.05 ? 1 : 0 };
}
// WORD HITS — the same observation the lexicon takes, but per candidate and
// without the lexicon's ordering. Each name is just its own words ("Atk. Power" is
// what the wheel actually renders, so `attack` carries `atk` as an alias); count how
// many of them a fuzzy token match finds in the read text. This is what separates
// "firand power" (brand 1 edit + power exact = 2 of Brand Power's words, 1 of Attack
// Power's) from the graded lexicon, which scored that read 0.7/0.7 and had to guess.
var NAME_WORDS = {
  "Additional Damage": [["additional"], ["damage"]],
  "Attack Power": [["attack", "atk"], ["power"]],
  "Brand Power": [["brand"], ["power"]],
  "Ally Damage Enh.": [["ally"], ["damage"], ["enh"]],
  "Boss Damage": [["boss"], ["damage"]],
  "Ally Attack Enh.": [["ally"], ["attack", "atk"], ["enh"]]
};
function ed1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function wordHits(text, name) {
  var toks = String(text || "").split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });
  var slots = NAME_WORDS[name] || [];
  var hits = 0;
  slots.forEach(function (alts) {
    for (var i = 0; i < toks.length; i++) {
      for (var j = 0; j < alts.length; j++) {
        var w = alts[j];
        // 3-letter words ("atk", "enh") must match exactly: one edit inside three
        // characters is most of the word, and the junk tokens are three letters long
        if (toks[i] === w || (w.length >= 4 && toks[i].length >= 4 && ed1(toks[i], w))) { hits++; return; }
      }
    }
  });
  return Math.min(3, hits);
}
// The lexical evidence is per CANDIDATE, not a ranking: bucket its value.
function lexBucket(v) {
  if (v == null) return 0;
  if (v >= 1.0) return 4;
  if (v >= 0.8) return 3;
  if (v >= 0.6) return 2;
  return 1;
}
function lineObs(l) { return l === 1 ? 1 : l === 2 ? 2 : 0; }
function readBucket(c) { return c >= 0.8 ? 2 : c >= 0.6 ? 1 : 0; }

// Everything the solve is allowed to look at is the state at the moment it runs —
// which is right after the engine's own name commits and BEFORE the outcome strip is
// read. `pre`/`preConf`/`preCostConf` are that snapshot; `snap`/`snapConf` are the
// end of the parse and are only used to score what the engine finally shipped.
function prep(r) {
  var preCost = r.preCostConf > 0 ? r.baseCost : null;
  var o = { name: r.name, holdout: r.holdout, truth: r.truth, cost: preCost,
            costConf: r.preCostConf || 0, pool: poolOf(preCost), slots: [] };
  SIDES.forEach(function (side, i) {
    var s = r[side];
    o.slots.push({
      raw: synObs(s.raw), grad: synObs(s.grad),
      lex: NAMES.map(function (n) { return lexBucket(s.ev ? s.ev[n] : null); }),
      wh: NAMES.map(function (n) { return wordHits(s.text, n); }),
      lines: lineObs(s.lines),
      read: r.pre[i] ? NIX[r.pre[i]] : -1,
      readB: readBucket(r.preConf[i] || 0),
      readConf: r.preConf[i] || 0
    });
  });
  o.pre = r.pre.slice(); o.preConf = r.preConf.slice();
  o.got = r.snap.slice();
  o.gotConf = r.snapConf.slice();
  return o;
}

// ---------------------------------------------------------------- calibration
function mat(rows, cols, a) { var m = []; for (var i = 0; i < rows; i++) { var rr = []; for (var j = 0; j < cols; j++) rr.push(a); m.push(rr); } return m; }
function normRows(m) {
  return m.map(function (row) {
    var t = row.reduce(function (a, x) { return a + x; }, 0);
    return row.map(function (x) { return Math.round(Math.log(x / t) * 1000) / 1000; });
  });
}
function normVec(v) {
  var t = v.reduce(function (a, x) { return a + x; }, 0);
  return v.map(function (x) { return Math.round(Math.log(x / t) * 1000) / 1000; });
}

function calibrate(set) {
  var C = { raw: {}, grad: {}, lines: {}, lex: {}, wh: {}, read: {}, prior: {} };
  SIDES.forEach(function (k) {
    C.raw[k] = [mat(NN, NN + 1, ALPHA), mat(NN, NN + 1, ALPHA)];
    C.grad[k] = [mat(NN, NN + 1, ALPHA), mat(NN, NN + 1, ALPHA)];
    C.lines[k] = mat(NN, 3, ALPHA);
    // lex: [isTrue][bucket] per side — a per-candidate likelihood ratio, which is
    // far denser than a 6x6 confusion (every candidate of every slot is a sample).
    C.lex[k] = [mat(1, 5, ALPHA)[0], mat(1, 5, ALPHA)[0]];
    C.wh[k] = [mat(1, 4, ALPHA)[0], mat(1, 4, ALPHA)[0]];
    C.read[k] = [mat(NN, NN + 1, ALPHA), mat(NN, NN + 1, ALPHA), mat(NN, NN + 1, ALPHA)];
    C.prior[k] = mat(1, NN, ALPHA)[0];
  });
  set.forEach(function (b) {
    for (var i = 0; i < 2; i++) {
      var t = b.truth[i]; if (!t) continue;
      var ti = NIX[t], k = SIDES[i], s = b.slots[i];
      C.raw[k][s.raw.mb][ti][s.raw.top < 0 ? NN : s.raw.top]++;
      C.grad[k][s.grad.mb][ti][s.grad.top < 0 ? NN : s.grad.top]++;
      C.lines[k][ti][s.lines]++;
      C.read[k][s.readB][ti][s.read < 0 ? NN : s.read]++;
      C.prior[k][ti]++;
      for (var c = 0; c < NN; c++) { C.lex[k][c === ti ? 1 : 0][s.lex[c]]++; C.wh[k][c === ti ? 1 : 0][s.wh[c]]++; }
    }
  });
  var M = { raw: {}, grad: {}, lines: {}, lex: {}, wh: {}, read: {}, prior: {} };
  SIDES.forEach(function (k) {
    M.raw[k] = [normRows(C.raw[k][0]), normRows(C.raw[k][1])];
    M.grad[k] = [normRows(C.grad[k][0]), normRows(C.grad[k][1])];
    M.lines[k] = normRows(C.lines[k]);
    M.lex[k] = [normVec(C.lex[k][0]), normVec(C.lex[k][1])];
    M.wh[k] = [normVec(C.wh[k][0]), normVec(C.wh[k][1])];
    M.read[k] = [normRows(C.read[k][0]), normRows(C.read[k][1]), normRows(C.read[k][2])];
    M.prior[k] = normVec(C.prior[k]);
  });
  return M;
}

// ---------------------------------------------------------------- the solver
// Kept in the same shape as jointNameSolve() in ocr/structural-engine.js — change
// the two together or the trained tables stop describing the reader.
function solve(M, W, b, pool) {
  if (!pool || pool.length < 2) return null;
  var per = [];   // per slot, per name index: the independent log-score
  for (var i = 0; i < 2; i++) {
    var k = SIDES[i], s = b.slots[i], acc = [];
    for (var v = 0; v < NN; v++) {
      var sc = W.wPrior * M.prior[k][v];
      sc += W.wRaw * M.raw[k][s.raw.mb][v][s.raw.top < 0 ? NN : s.raw.top];
      sc += W.wGrad * M.grad[k][s.grad.mb][v][s.grad.top < 0 ? NN : s.grad.top];
      sc += W.wLines * M.lines[k][v][s.lines];
      sc += W.wRead * M.read[k][s.readB][v][s.read < 0 ? NN : s.read];
      // the per-candidate lexical term is a likelihood RATIO: only the difference
      // between "this candidate is the true one" and "it is not" carries signal
      sc += W.wLex * (M.lex[k][1][s.lex[v]] - M.lex[k][0][s.lex[v]]);
      sc += W.wWh * (M.wh[k][1][s.wh[v]] - M.wh[k][0][s.wh[v]]);
      acc.push(sc);
    }
    per.push(acc);
  }
  var best = null, bestS = -Infinity, second = -Infinity;
  var altA = [], altB = [], q;
  for (q = 0; q < NN; q++) { altA.push(-1e18); altB.push(-1e18); }
  for (var ai = 0; ai < pool.length; ai++) {
    for (var bi = 0; bi < pool.length; bi++) {
      if (ai === bi) continue;
      var a = NIX[pool[ai]], b2 = NIX[pool[bi]];
      if (a == null || b2 == null) continue;
      var s2 = per[0][a] + per[1][b2];
      if (s2 > bestS) { second = bestS; bestS = s2; best = [a, b2]; }
      else if (s2 > second) second = s2;
      if (s2 > altA[a]) altA[a] = s2;
      if (s2 > altB[b2]) altB[b2] = s2;
    }
  }
  if (!best) return null;
  function marg(alt, chosen) {
    var mx = -1e18;
    for (var v = 0; v < NN; v++) if (v !== chosen && alt[v] > mx) mx = alt[v];
    return bestS - mx;
  }
  return { v: [NAMES[best[0]], NAMES[best[1]]], margin: [marg(altA, best[0]), marg(altB, best[1])], pairMargin: bestS - second };
}

function score(M, W, set) {
  var ok = 0, tot = 0, board = 0, nb = 0, iok = 0;
  set.forEach(function (b) {
    var r = solve(M, W, b, b.pool || poolOf(b.cost));
    b._j = r;
    if (!r) return;
    var all = true, any = false;
    for (var i = 0; i < 2; i++) {
      if (!b.truth[i]) continue;
      any = true; tot++;
      if (r.v[i] === b.truth[i]) ok++; else all = false;
      if (b.got[i] === b.truth[i]) iok++;
    }
    if (any) { nb++; if (all) board++; }
  });
  return { ok: ok, tot: tot, board: board, nb: nb, iok: iok };
}

// ---------------------------------------------------------------- corpus parse
async function collect() {
  if (A.cache && fs.existsSync(path.resolve(A.cache))) {
    console.log("reading cached observations from " + A.cache);
    return fs.readFileSync(path.resolve(A.cache), "utf8").split("\n").filter(Boolean).map(JSON.parse);
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
  var imgs = files.filter(function (f) { return /\.(png|jpg|jpeg|webp)$/i.test(f); }).sort();
  var recs = [], n = 0;
  for (var i = 0; i < imgs.length; i++) {
    var stem = imgs[i].replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (files.indexOf(stem + ".json") === -1) continue;
    var truthRaw;
    try { truthRaw = JSON.parse(fs.readFileSync(path.join(DIR, stem + ".json"), "utf8")); } catch (e) { continue; }
    if (truthRaw._unusable) continue;
    var skip = {}; ((truthRaw._mask && truthRaw._mask.skip) || []).forEach(function (f) { skip[f] = true; });
    var tcfg = engineApi.constraintSnap(truthRaw).config;
    try {
      var dec = await sharp(path.join(DIR, imgs[i])).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      var raster = { width: dec.info.width, height: dec.info.height,
        data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length) };
      var raw = await structural.parseStructural(raster, nodeOcr);
      var e = raw._debug && raw._debug.nmEvid;
      if (!e) continue;
      var snapped = engineApi.constraintSnap(raw);
      e.name = stem; e.holdout = isHoldout(stem);
      e.truth = [skip.effect1 ? null : (tcfg.effect1 || null), skip.effect2 ? null : (tcfg.effect2 || null)];
      e.truthCost = skip.baseCost ? null : (tcfg.baseCost || null);
      e.snap = [snapped.config.effect1 || null, snapped.config.effect2 || null];
      e.snapConf = [snapped.confidence.config.effect1 || 0, snapped.confidence.config.effect2 || 0];
      e.snapCost = snapped.config.baseCost;
      recs.push(e);
    } catch (err) { console.error("  parse failed " + stem + ": " + (err && err.message)); }
    if (++n % 25 === 0) console.log("  parsed " + n + "…");
  }
  try { var w2 = await getWorker(); await w2.terminate(); } catch (e) {}
  if (A.cache) fs.writeFileSync(path.resolve(A.cache), recs.map(function (r) { return JSON.stringify(r); }).join("\n") + "\n");
  return recs;
}

// ---------------------------------------------------------------- main
var PIN = {};
(A.wzero || "").split(",").filter(Boolean).forEach(function (k) { PIN[k] = 0; });
function fitWeights(M, set, W0) {
  var W = W0 || { wRaw: 1, wGrad: 1, wLines: 1, wLex: 1, wWh: 1, wRead: 1, wPrior: 1 };
  Object.keys(PIN).forEach(function (k) { W[k] = PIN[k]; });
  var BOUND = { wRaw: [0, 3], wGrad: [0, 3], wLines: [0, 3], wLex: [0, 3], wWh: [0, 4], wRead: [0, 4], wPrior: [0, 3] };
  Object.keys(PIN).forEach(function (k) { BOUND[k] = [0, 0]; });
  var cur = score(M, W, set).ok;
  for (var it = 0; it < (A.nofit ? 0 : 60); it++) {
    var improved = false;
    Object.keys(W).forEach(function (k) {
      var base = W[k];
      [-0.4, -0.2, -0.1, 0.1, 0.2, 0.4].forEach(function (dd) {
        var c = Math.max(BOUND[k][0], Math.min(BOUND[k][1], Math.round((base + dd) * 100) / 100));
        if (c === base) return;
        W[k] = c; var s = score(M, W, set).ok;
        if (s > cur) { cur = s; base = c; improved = true; } else W[k] = base;
      });
      W[k] = base;
    });
    if (!improved) break;
  }
  return W;
}

(async function () {
  var raw = await collect();
  var recs = raw.map(prep);
  var TRAIN = recs.filter(function (b) { return !b.holdout; });
  var HOLD = recs.filter(function (b) { return b.holdout; });
  console.log("corpus " + recs.length + " boards — train " + TRAIN.length + ", holdout " + HOLD.length + " (djb2%5==0)");

  if (A.cv) {
    // 5-fold cross-validation INSIDE the training split — this is where structural
    // choices get made, so the holdout stays untouched until the very end.
    var folds = [[], [], [], [], []];
    TRAIN.forEach(function (b) { folds[djb2(b.name + "cv") % 5].push(b); });
    var cok = 0, ctot = 0, ciok = 0;
    for (var f = 0; f < 5; f++) {
      var tr = [], te = folds[f];
      for (var g = 0; g < 5; g++) if (g !== f) tr = tr.concat(folds[g]);
      var Mf = calibrate(tr), Wf = fitWeights(Mf, tr);
      var sf = score(Mf, Wf, te);
      cok += sf.ok; ctot += sf.tot; ciok += sf.iok;
      console.log("  fold " + f + ": model " + sf.ok + "/" + sf.tot + " (" + (sf.ok / sf.tot * 100).toFixed(1) + "%)  incumbent " + sf.iok);
    }
    console.log("  CV total: model " + cok + "/" + ctot + " (" + (cok / ctot * 100).toFixed(1) + "%)  incumbent " + ciok + " (" + (ciok / ctot * 100).toFixed(1) + "%)");
    return;
  }

  var M = calibrate(TRAIN);
  var W = fitWeights(M, TRAIN);
  M.w = W;

  function fmt(tag, set) {
    var j = score(M, W, set);
    return "  " + tag.padEnd(8) + " model " + j.ok + "/" + j.tot + " (" + (j.ok / j.tot * 100).toFixed(1) + "%) both-names " + j.board + "/" + j.nb +
      "   incumbent " + j.iok + " (" + (j.iok / j.tot * 100).toFixed(1) + "%)";
  }
  console.log("\nname accuracy (the solve in isolation; end-to-end is npm run eval-ocr):");
  console.log(fmt("TRAIN", TRAIN));
  console.log(fmt("HOLDOUT", HOLD));
  console.log(fmt("ALL", recs));
  console.log("  weights " + JSON.stringify(W) + "  alpha " + ALPHA);

  // margin separation — the only number that decides whether anything can be LIFTED
  score(M, W, recs);
  var rightM = [], wrongM = [], ov = 0, fx = 0, bk = 0, fxH = 0, bkH = 0;
  recs.forEach(function (b) {
    if (!b._j) return;
    for (var i = 0; i < 2; i++) {
      if (!b.truth[i]) continue;
      var ok = b._j.v[i] === b.truth[i];
      (ok ? rightM : wrongM).push({ m: b._j.margin[i], name: b.name, i: i, got: b._j.v[i], want: b.truth[i],
        conf: b.gotConf[i], cc: b.costConf, holdout: b.holdout, ok: ok,
        pre: b.pre[i], preConf: b.preConf[i],
        inPool: (b.pool || poolOf(b.cost) || []).indexOf(b.truth[i]) !== -1 });
      if (b._j.v[i] !== b.got[i]) {
        ov++;
        if (ok) { fx++; if (b.holdout) fxH++; }
        else if (b.got[i] === b.truth[i]) { bk++; if (b.holdout) bkH++; }
      }
    }
  });
  console.log("  overrides " + ov + ": fixed " + fx + ", broken " + bk + ", both-wrong " + (ov - fx - bk) +
    "   [holdout fixed " + fxH + " broken " + bkH + "]");
  // The holdout's own margins are the only unbiased estimate of the lift bar's
  // safety on a board the tables never saw. Reported separately, always.
  var hR = [], hW = [];
  HOLD.forEach(function (b) {
    if (!b._j) return;
    for (var i = 0; i < 2; i++) {
      if (!b.truth[i]) continue;
      (b._j.v[i] === b.truth[i] ? hR : hW).push(b._j.margin[i]);
    }
  });
  hW.sort(function (a, b) { return b - a; });
  console.log("  HOLDOUT margins: " + hR.length + " right / " + hW.length + " wrong; worst-case wrong margin " +
    (hW.length ? hW[0].toFixed(2) : "n/a") + "  (next " + (hW.length > 1 ? hW[1].toFixed(2) : "-") + ")");
  [4, 6, 8, 10, 12, 15].forEach(function (bar) {
    console.log("    holdout bar " + String(bar).padStart(3) + ": " +
      hR.filter(function (x) { return x >= bar; }).length + " right, " +
      hW.filter(function (x) { return x >= bar; }).length + " wrong above it");
  });
  wrongM.sort(function (a, b) { return b.m - a.m; });
  console.log("\n  WRONG slots by margin (top 12) — the lift bar must clear the first:");
  wrongM.slice(0, 12).forEach(function (w) {
    console.log("    " + w.m.toFixed(2) + "  " + w.name + " #" + w.i + " got " + w.got + " want " + w.want +
      " (engine conf " + w.conf.toFixed(2) + ", cost conf " + w.cc.toFixed(2) + (w.inPool ? "" : ", TRUTH NOT IN POOL") + ")");
  });
  // A lift is only safe where the POOL is: the 12-way enumeration cannot reach a name
  // the committed cost excludes. Measured over the corpus, every one of the 20 slots
  // whose truth falls outside the committed pool sits on a board whose baseCost was
  // itself flagged — so gating the lift on a confident cost removes them all.
  var COSTBAR = 0.8;
  function bars(rs, ws, tag) {
    console.log("  " + tag);
    [2, 4, 6, 8, 10, 12, 14, 15, 16, 18, 20].forEach(function (bar) {
      var r = rs.filter(function (x) { return x.m >= bar; }).length;
      var w = ws.filter(function (x) { return x.m >= bar; }).length;
      var lift = rs.filter(function (x) { return x.m >= bar && x.conf < 0.8; }).length;
      console.log("    bar " + String(bar).padStart(3) + ": " + r + " right, " + w + " wrong above it" +
        "   (would LIFT " + lift + " currently-flagged correct slots)");
    });
    console.log("    max wrong margin " + (ws.length ? ws[0].m.toFixed(2) : "n/a"));
  }
  // Does the lift need the engine to AGREE? Split the cost-confident population by
  // whether the solve kept the engine's own read or replaced it.
  [8, 10, 12, 14, 16].forEach(function (bar) {
    var pop = rightM.concat(wrongM).filter(function (x) { return x.cc >= 0.8 && x.m >= bar; });
    var agree = pop.filter(function (x) { return x.pre === x.got; });
    var over = pop.filter(function (x) { return x.pre !== x.got; });
    console.log("  bar " + bar + " cost-confident: AGREE " + agree.filter(function (x) { return x.ok; }).length + "/" + agree.length +
      "  OVERRIDE " + over.filter(function (x) { return x.ok; }).length + "/" + over.length +
      "   (lift-if-agree " + agree.filter(function (x) { return x.ok && x.conf < 0.8; }).length +
      ", lift-if-override " + over.filter(function (x) { return x.ok && x.conf < 0.8; }).length + ")");
  });
  // Would the solve ever break a name the engine had already committed CONFIDENTLY?
  var preHi = rightM.concat(wrongM).filter(function (x) { return x.preConf >= 0.8; });
  console.log("  pre-solve confident reads (>=0.8): " + preHi.length + ", solve agrees on " +
    preHi.filter(function (x) { return x.pre === x.got; }).length + ", engine right on " +
    preHi.filter(function (x) { return x.pre === x.want; }).length + ", solve right on " + preHi.filter(function (x) { return x.ok; }).length);
  bars(rightM, wrongM, "ALL slots:");
  var rc = rightM.filter(function (x) { return x.cc >= COSTBAR; }), wc = wrongM.filter(function (x) { return x.cc >= COSTBAR; });
  bars(rc, wc, "COST-CONFIDENT slots only (baseCost conf >= " + COSTBAR + "; " + (rc.length + wc.length) + " of " + (rightM.length + wrongM.length) + "):");
  var rh = rc.filter(function (x) { return x.holdout; }), wh2 = wc.filter(function (x) { return x.holdout; });
  bars(rh, wh2, "COST-CONFIDENT HOLDOUT only (" + (rh.length + wh2.length) + " slots):");

  if (A.dumpslots) {
    // one line per slot: what the solve decided, how decisively, and what the engine
    // finally shipped — the input to any downstream rung measured against this reader.
    var out2 = [];
    recs.forEach(function (b) {
      for (var i = 0; i < 2; i++) {
        if (!b.truth[i]) continue;
        out2.push(JSON.stringify({ name: b.name, i: i, holdout: b.holdout, costConf: b.costConf,
          m: b._j ? Math.round(b._j.margin[i] * 100) / 100 : null, v: b._j ? b._j.v[i] : null,
          truth: b.truth[i], got: b.got[i], conf: b.gotConf[i] }));
      }
    });
    fs.writeFileSync(path.resolve(A.dumpslots), out2.join("\n") + "\n");
    console.log("wrote slot dump " + A.dumpslots + " (" + out2.length + " slots)");
  }
  if (A.dry) { console.log("\n--dry: nothing written."); return; }
  var meta = { built: new Date().toISOString().slice(0, 10), boards: recs.length, train: TRAIN.length, alpha: ALPHA };
  var body = "// GENERATED by tools/build-name-model.js — do not edit by hand.\n" +
    "// Calibrated observation tables for the JOINT effect-NAME solve: for each slot\n" +
    "// (W/E) and each channel, log P(observation | true name), smoothed (alpha=" + ALPHA + ")\n" +
    "// and estimated on the " + TRAIN.length + " non-holdout boards of the " + recs.length + "-board corpus\n" +
    "// (djb2(stem)%5==0 excluded, as in tools/build-level-refs.js). Rows are the true\n" +
    "// name's index in NAMES; columns are the observed class plus a trailing \"absent\".\n" +
    "// REGENERATING THIS FILE CHANGES WHAT THE ENGINE READS — re-run the full eval and\n" +
    "// A/B it against the shipped build before keeping the result.\n" +
    "(function (root) {\n  \"use strict\";\n" +
    "  var NAME_MODEL = " + JSON.stringify(M) + ";\n" +
    "  var NAME_MODEL_NAMES = " + JSON.stringify(NAMES) + ";\n" +
    "  var META = " + JSON.stringify(meta) + ";\n" +
    "  var X = { NAME_MODEL: NAME_MODEL, NAME_MODEL_NAMES: NAME_MODEL_NAMES, NAME_MODEL_META: META };\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = X;\n" +
    "  else root.OcrNameModel = X;\n" +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(OUT, body);
  console.log("\nwrote " + path.relative(ROOT, OUT) + "  (" + (body.length / 1024).toFixed(1) + " KB)");
  console.log("!! This file is TRAINED DATA. Re-run `npm run eval-gate` and A/B it before shipping.");
})().catch(function (e) { console.error(e); process.exit(1); });
