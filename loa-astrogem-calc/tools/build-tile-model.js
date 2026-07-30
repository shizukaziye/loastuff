#!/usr/bin/env node
/* tools/build-tile-model.js — train ocr/tile-model.js from the labelled corpus.
 *
 * WHAT THIS IS. The third of the trained observation tables, after
 * tools/build-level-model.js (round 10) and tools/build-name-model.js (round 14),
 * and applied to the field those two rounds left standing: the four OUTCOME TILES.
 *
 * WHY A TILE IS THE BEST FIT OF THE THREE. Its vocabulary is not merely closed, it
 * is ENUMERATED BY THE GAME: model/astrogem.js OUTCOME_RATES lists exactly 27 keys,
 * gives each a base probability, and says which of them the current levels/turns
 * exclude. Over the 1828 scored tiles in the corpus exactly ONE label falls outside
 * the legal set. So a tile is a ~20-way choice with a known prior, and the engine's
 * hand-written ladder decides it in three separate passes (target, kind, amount)
 * that never see each other's evidence.
 *
 * THE CHANNELS (all recorded per tile under `out._debug.tileEvid`). Each
 * one is scored against every candidate, so the comparison between candidates is a
 * like-for-like likelihood and not a count of terms:
 *
 *   TARGET   hue     the icon patch's hue, as the nearest of the board's OWN four
 *                    node hues plus a margin bucket (grey is its own observation)
 *            face    the round-13 relocated icon face: walk the median patch for
 *                    the most saturated diamond, take its nearest node
 *            capt    the caption re-lexed for a target word ("Efficiency",
 *                    "Points", or one of the two committed effect names)
 *   KIND     line    which locate rung found the amount line — chartreuse (raise
 *                    1258/1259), red (lower 182/182), deep, relaxed, none, or the
 *                    branch never ran
 *            arrow   the ▲/▼ blob solidity test
 *            capk    the caption re-lexed for a kind word, by priority
 *            grey    the dim-grey dilated pass' three predicates (C/M/R), which are
 *                    77/77, 39/39 and 72/72 pure where they fire
 *            ink     white-ink count in the caption band (the change-tile channel)
 *   AMOUNT   tm      the template digit + its confidence tier
 *            ocrA    the prefix-anchored OCR digit off the located line
 *            capV    the caption's own "Lv. N" digit
 *            bare    the last bare digit of the line OCR
 *            syG/syR both synthesis rankings, gradient and raw, with a margin bucket
 *   SIGN     plus / capSign   for the two cost tiles
 *   REROLL   rrDigit          for the two reroll tiles
 *   ENGINE   engK/engT/engA   the incumbent's committed kind/target/amount, bucketed
 *                    by its own confidence — this makes the model a REFINEMENT of
 *                    the shipped reader rather than a replacement for it
 *
 * TRAINING DISCIPLINE. The djb2(stem)%5==0 holdout (~20%) is excluded from every
 * table and from the weight fit, and reported separately. Structural choices were
 * made by 5-fold cross-validation INSIDE the training split (--cv).
 *
 * WHAT THE MODEL IS FOR, honestly. Its raw accuracy is a WASH against the ladder:
 * 5-fold CV inside the training split gives 1446/1500 against the engine's 1447.
 * What it adds is a CALIBRATED corroboration signal — a margin that ranks the
 * ladder's own reads — and that is what the round is worth: the engine's flagged
 * tiles are 90% right and it cannot tell which 90%.
 *
 * The evidence cache is JSONL, one record per board, each carrying `tiles` (the
 * engine's `_debug.tileEvid`), the labels, and the committed config/state with
 * confidences. tools/collect-tile-evid.js builds it.
 *
 * Usage:
 *   node tools/build-tile-model.js --cache=/tmp/tevid.jsonl     # train from a cache
 *   node tools/build-tile-model.js --cache=... --dry            # report, write nothing
 *   node tools/build-tile-model.js --cache=... --cv             # 5-fold CV in train
 */
"use strict";

var fs = require("fs"), path = require("path");
var ROOT = path.resolve(__dirname, "..");
var A = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) A[m[1]] = m[2] === undefined ? "1" : m[2];
});
var OUT = path.resolve(ROOT, A.out || "ocr/tile-model.js");
var ALPHA = parseFloat(A.alpha || "1");

function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }

// ------------------------------------------------------------------ vocabulary
// The 27 legal keys, straight out of model/astrogem.js OUTCOME_RATES, with the
// exclusion rules re-expressed as plain data so the browser engine needs no new
// dependency: `lvl` names the level this key reads, `lvlMax`/`lvlMin` bound it,
// `turns` demands turnsRemaining >= 2, `cm` bounds processCostMultiplier.
var TARGETS = ["willpower", "order", "effect1", "effect2"];
var RAISE_BASE = [11.65, 4.40, 1.75, 0.45];
var KEYS = [];
TARGETS.forEach(function (t) {
  for (var n = 1; n <= 4; n++) KEYS.push({ k: "raise_effect:" + t + ":" + n, base: RAISE_BASE[n - 1], lvl: t, lvlMax: 5 - n });
  KEYS.push({ k: "lower_effect:" + t + ":1", base: 3.00, lvl: t, lvlMin: 2 });
});
KEYS.push({ k: "change:effect1", base: 3.25 });
KEYS.push({ k: "change:effect2", base: 3.25 });
KEYS.push({ k: "cost:+", base: 1.75, turns: 1, cmMax: 99 });
KEYS.push({ k: "cost:-", base: 1.75, turns: 1, cmMin: -99 });
KEYS.push({ k: "do_nothing", base: 1.75 });
KEYS.push({ k: "reroll:1", base: 2.50, turns: 1 });
KEYS.push({ k: "reroll:2", base: 0.75, turns: 1 });
var KIX = {}; KEYS.forEach(function (e, i) { KIX[e.k] = i; });
var NK = KEYS.length;

var KINDS = ["raise", "lower", "change", "cost", "reroll", "nothing"];
var TCLS = ["willpower", "order", "effect1", "effect2", "none"];
var ACLS = ["r1", "r2", "r3", "r4", "lower", "other"];
var SCLS = ["cost+", "cost-", "other"];
var RCLS = ["rr1", "rr2", "other"];

function kindOf(k) {
  if (k.indexOf("raise_effect") === 0) return 0;
  if (k.indexOf("lower_effect") === 0) return 1;
  if (k.indexOf("change:") === 0) return 2;
  if (k.indexOf("cost:") === 0) return 3;
  if (k.indexOf("reroll:") === 0) return 4;
  return 5;
}
function targetOf(k) {
  var p = k.split(":");
  if (p[0] === "raise_effect" || p[0] === "lower_effect" || p[0] === "change") return TCLS.indexOf(p[1]);
  return 4;
}
function amtClsOf(k) {
  if (k.indexOf("raise_effect") === 0) return parseInt(k.split(":")[2], 10) - 1;
  if (k.indexOf("lower_effect") === 0) return 4;
  return 5;
}
function signClsOf(k) { return k === "cost:+" ? 0 : k === "cost:-" ? 1 : 2; }
function rrClsOf(k) { return k === "reroll:1" ? 0 : k === "reroll:2" ? 1 : 2; }
// precomputed class vectors, one row per key
var KCLS = KEYS.map(function (e) {
  return { kind: kindOf(e.k), tgt: targetOf(e.k), amt: amtClsOf(e.k), sgn: signClsOf(e.k), rr: rrClsOf(e.k) };
});

// ------------------------------------------------------------------ legality
// A key is legal unless a CONFIDENT field excludes it. Round 14's discipline: an
// enumeration can never reach a truth its own constraint excluded, so a constraint
// that rests on a doubtful read must not be applied at all.
function legalMask(ctx) {
  var out = [];
  for (var i = 0; i < NK; i++) {
    var e = KEYS[i], ok = true;
    if (e.lvl) {
      var lk = e.lvl === "willpower" ? "willpowerLevel" : e.lvl === "order" ? "orderLevel"
        : e.lvl === "effect1" ? "effect1Level" : "effect2Level";
      var lv = ctx.cfg[lk], lc = ctx.cfgConf[lk] || 0;
      if (lv != null && lc >= 0.8) {
        if (e.lvlMax != null && lv > e.lvlMax) ok = false;
        if (e.lvlMin != null && lv < e.lvlMin) ok = false;
      }
    }
    if (e.turns != null && ctx.turnsOk && ctx.turnsRemaining <= 1) ok = false;
    if (e.cmMax != null && ctx.cmOk && ctx.costMult >= 100) ok = false;
    if (e.cmMin != null && ctx.cmOk && ctx.costMult <= -100) ok = false;
    out.push(ok);
  }
  return out;
}
function ratePrior(ctx) {
  var mask = legalMask(ctx), sum = 0, i;
  for (i = 0; i < NK; i++) if (mask[i]) sum += KEYS[i].base;
  var out = [];
  for (i = 0; i < NK; i++) out.push(mask[i] && sum > 0 ? Math.log(KEYS[i].base / sum) : null);
  return out;
}

// ------------------------------------------------------------------ observations
// Every discretization lives here so the trainer and ocr/structural-engine.js can be
// checked against each other by eye. Change one, change the other — and the harness
// cross-checks them on every tile (see --verify in the round log).
var CAP_WILLPOWER = /wil+\s*po|[il]lpo|efficien|fficien|ficienc|iciency|icienc|volunta/;
var CAP_POINTS = /[o0]rd\w*\s*[,.]?\s*[pf]|cha[o0]?s|ca[o0]s|xaoc|punt|p[o0][il1]?[nmr][tf]|f[o0][il1][nmr]|[o0]unt[cs]|[o0]rder|rder|qrder|sdor/;
var EFFECT_LEX = [
  ["Ally Damage Enh.", /a[li1|]{2}y\s*dam|ally\s*dam|damage\s*enh|dmg\s*enh|aly\s*dam/],
  ["Ally Attack Enh.", /a[li1|]{2}y\s*at|ally\s*at|attack\s*enh|atk\s*enh/],
  ["Additional Damage", /additional|addit/],
  ["Boss Damage", /boss/],
  ["Brand Power", /brand|srand|bramd/],
  ["Attack Power", /(atk|attack)\D{0,4}(pow|ower)/]
];
function captObs(cap, e1, e2) {
  var t = String(cap || "");
  var hits = [];
  if (CAP_WILLPOWER.test(t)) hits.push(0);
  if (CAP_POINTS.test(t)) hits.push(1);
  var nm = null;
  for (var li = 0; li < EFFECT_LEX.length; li++) { if (EFFECT_LEX[li][1].test(t)) { nm = EFFECT_LEX[li][0]; break; } }
  if (nm && e1 && nm === e1) hits.push(2);
  else if (nm && e2 && nm === e2) hits.push(3);
  if (!hits.length) return 0;
  if (hits.length > 1) return 5;      // two lexicons arguing = its own observation
  return 1 + hits[0];
}
// ---- RULED OUT, kept reproducible (round 15) ----
// WORD HITS on the caption, the round-14 channel applied to the tile's TARGET.
// `captObs` is the engine's own strict lexicon and it stays silent on 257 of the
// flagged tiles — including captions a reader can plainly resolve ("aaditiona
// damage", "cpacg poin:", "g paints"). Counting fuzzily-matched WORDS instead of
// firing a regex gives the same channel a graded answer, and as an EXTRA witness
// clause (shipped model unchanged) it would lift 459 tiles instead of 411, still
// 0 wrong, with the safety bar untouched at 5.56.
// It was DECLINED on the significance, not on the count. The population it draws
// from — flagged, solve agrees, margin ≥ 9, strict witness silent — is 198 tiles
// and 5.1% wrong; the fuzzy witness picks 48 of them and gets 0 wrong, which under
// the null that it carries no information has P = 0.083. That is round 13's
// declined 27-of-27 in a bigger coat. As a MODEL channel it is worth nothing at
// all: it displaces `capt` (fitted weight 0) and leaves accuracy flat, 1464/1500
// train and 363/380 holdout against 1463 and 363.
// Re-measure with: whObs() + a witness clause that accepts its target.
var TARGET_WORDS = {
  willpower: [["willpower", "wilpower"], ["efficiency", "efficiencia", "eficiencia"], ["voluntad"]],
  order: [["order", "orden"], ["points", "puntos", "paints", "poin", "point"], ["chaos", "caos"]]
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
function hitCount(toks, slots) {
  var hits = 0;
  slots.forEach(function (alts) {
    for (var i = 0; i < toks.length; i++) for (var j = 0; j < alts.length; j++) {
      var w = alts[j];
      if (toks[i] === w || (w.length >= 5 && toks[i].length >= 5 && ed1(toks[i], w))) { hits++; return; }
    }
  });
  return hits;
}
function nameSlots(nm) {
  var W = { "Additional Damage": [["additional"], ["damage"]], "Attack Power": [["attack", "atk"], ["power"]],
            "Brand Power": [["brand"], ["power"]], "Ally Damage Enh.": [["ally"], ["damage"], ["enh"]],
            "Boss Damage": [["boss"], ["damage"]], "Ally Attack Enh.": [["ally"], ["attack", "atk"], ["enh"]] };
  return W[nm] || null;
}
// observation: which target wins the word count, and by how clear a margin
function whObs(cap, e1, e2) {
  var toks = String(cap || "").split(/[^a-z]+/).filter(function (t) { return t.length >= 3; });
  if (!toks.length) return 0;
  var sc = [hitCount(toks, TARGET_WORDS.willpower), hitCount(toks, TARGET_WORDS.order),
            nameSlots(e1) ? hitCount(toks, nameSlots(e1)) : 0, nameSlots(e2) ? hitCount(toks, nameSlots(e2)) : 0];
  var b = -1, b1 = 0, b2 = 0;
  for (var i = 0; i < 4; i++) { if (sc[i] > b1) { b2 = b1; b1 = sc[i]; b = i; } else if (sc[i] > b2) b2 = sc[i]; }
  if (b < 0 || b1 === 0) return 0;
  return 1 + b * 2 + (b1 - b2 >= 1 ? 1 : 0);
}
function hueObs(te) {
  if (!te || !te.nd) return 13;
  if (te.icls === "grey") return 0;
  var best = -1, d1 = 1e9, d2 = 1e9;
  for (var i = 0; i < 4; i++) {
    var d = te.nd[TARGETS[i]];
    if (d == null) continue;
    if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
  }
  if (best < 0) return 13;
  var mb = (d2 - d1) >= 40 ? 2 : (d2 - d1) >= 15 ? 1 : 0;
  return 1 + best * 3 + mb;
}
function faceObs(te) {
  if (!te || !te.fT) return 0;
  var i = TARGETS.indexOf(te.fT);
  if (i < 0) return 0;
  var sure = (te.fd1 <= 20 && (te.fd2 - te.fd1) >= 25) ? 1 : 0;
  return 1 + i * 2 + sure;
}
var LINEV = { "n/a": 0, "none": 1, "chartreuse": 2, "chartreuse-deep": 3, "red": 4, "relaxed": 5 };
function lineObs(te) { return te && te.line != null ? (LINEV[te.line] != null ? LINEV[te.line] : 0) : 0; }
function arrowObs(te) {
  if (!te || !te.aUp) return 0;
  if (te.upSolid && te.downSolid) return 4;
  if (te.upSolid) return 2;
  if (te.downSolid) return 3;
  return 1;
}
// Priority order matters and is the engine's own: a caption that says "maintained"
// is not a cost tile even when a stray '100' survives in it.
function capkObs(cap, gTxt) {
  var t = String(cap || "") + " " + String(gTxt || "");
  if (/maintain|tained|state/.test(t)) return 1;
  if (/1\s*[o0]\s*[o0]|[cjg]ost|[cjg]os\b/.test(t)) return 2;
  if (/time|view|item|other/.test(t)) return 3;
  if (/chang|crang|cang|charz|cmarg|camb\s*ado|erect\s*cra/.test(t)) return 4;
  if (/[a-z(%]{0,3}v[.,]{0,2}\s*[1-4]/.test(t)) return 5;
  if (/\+\s*[1-4]/.test(t)) return 6;
  return 0;
}
function greyObs(te) {
  if (!te || te.gTxt == null) return 0;
  return 1 + (te.costish ? 1 : 0) + (te.maintainish ? 2 : 0) + (te.rerollish ? 4 : 0);
}
function inkObs(te) {
  if (!te || te.whInk == null) return 0;
  return te.whInk < 8 ? 1 : te.whInk < 40 ? 2 : 3;
}
function dObs(v) { return v == null ? 0 : (v >= 1 && v <= 4 ? v : 0); }
function tmObs(te) {
  if (!te || te.tm == null) return 0;
  var v = dObs(te.tm); if (!v) return 0;
  return v + ((te.tmConf != null && te.tmConf >= 0.9) ? 4 : 0);
}
function syGObs(te) {
  if (!te || !te.sy || te.sy.g == null) return 0;
  var v = dObs(te.sy.g); if (!v) return 0;
  var gm = te.sy.gm == null ? 0 : te.sy.gm;
  var b = gm >= 0.10 ? 2 : gm >= 0.03 ? 1 : 0;
  return v + b * 4;
}
function syRObs(te) { return te && te.sy ? dObs(te.sy.r) : 0; }
function plusObs(te) { return !te || te.plusSeen == null ? 0 : (te.plusSeen ? 2 : 1); }
function capSignObs(te) {
  var t = String((te && te.cap) || "") + " " + String((te && te.gTxt) || "");
  var minus = /[-−]\s*1\s*[o0]\s*[o0]|[-−]\s*100/.test(t);
  var plus = /\+\s*1\s*[o0]\s*[o0]|\+\s*100/.test(t);
  if (minus && !plus) return 2;
  if (plus && !minus) return 1;
  return 0;
}
function rrObs(te) {
  var t = String((te && te.cap) || "") + " " + String((te && te.gTxt) || "");
  var m = t.match(/\+\s*([12])/);
  return m ? parseInt(m[1], 10) : 0;
}
function confB(c) { return c >= 0.8 ? 2 : c >= 0.6 ? 1 : 0; }

// The engine's own committed read, as three observations.
function engObs(gotKey) {
  if (!gotKey) return { k: 6, t: 5, a: 6 };
  return { k: kindOf(gotKey), t: targetOf(gotKey), a: amtClsOf(gotKey) };
}

// One tile, reduced to the integers the tables are indexed by.
function prepTile(te, gotKey, gotConf, cfg) {
  var e = engObs(gotKey);
  return {
    hue: hueObs(te), face: faceObs(te), capt: captObs(te && te.cap, cfg.effect1, cfg.effect2),
    line: lineObs(te), arrow: arrowObs(te), capk: capkObs(te && te.cap, te && te.gTxt),
    grey: greyObs(te), ink: inkObs(te),
    tm: tmObs(te), ocrA: dObs(te && te.ocrAmt), capV: dObs(te && te.capV),
    bare: dObs(te && te.bare), syG: syGObs(te), syR: syRObs(te),
    plus: plusObs(te), capSign: capSignObs(te), rr: rrObs(te),
    eK: e.k, eT: e.t, eA: e.a, eB: confB(gotConf == null ? 1 : gotConf), eConf: gotConf == null ? 1 : gotConf
  };
}

// ------------------------------------------------------------------ the tables
// Channel spec: [name, class-list, number of observation values, bucketed-by-engine-conf?]
var CH = [
  ["hue", TCLS.length, 14, "tgt"], ["face", TCLS.length, 9, "tgt"], ["capt", TCLS.length, 6, "tgt"],
  ["line", KINDS.length, 6, "kind"], ["arrow", KINDS.length, 5, "kind"], ["capk", KINDS.length, 7, "kind"],
  ["grey", KINDS.length, 9, "kind"], ["ink", KINDS.length, 4, "kind"],
  ["tm", ACLS.length, 9, "amt"], ["ocrA", ACLS.length, 5, "amt"], ["capV", ACLS.length, 5, "amt"],
  ["bare", ACLS.length, 5, "amt"], ["syG", ACLS.length, 13, "amt"], ["syR", ACLS.length, 5, "amt"],
  ["plus", SCLS.length, 3, "sgn"], ["capSign", SCLS.length, 3, "sgn"], ["rr", RCLS.length, 3, "rr"]
];
var ECH = [["eK", KINDS.length, 7, "kind"], ["eT", TCLS.length, 6, "tgt"], ["eA", ACLS.length, 7, "amt"]];

function mat(rows, cols, a) { var m = []; for (var i = 0; i < rows; i++) { var r = []; for (var j = 0; j < cols; j++) r.push(a); m.push(r); } return m; }
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
  var C = {}, i;
  CH.forEach(function (c) { C[c[0]] = mat(c[1], c[2], ALPHA); });
  ECH.forEach(function (c) { C[c[0]] = [mat(c[1], c[2], ALPHA), mat(c[1], c[2], ALPHA), mat(c[1], c[2], ALPHA)]; });
  C.kindPrior = mat(1, KINDS.length, ALPHA)[0];
  set.forEach(function (b) {
    for (i = 0; i < b.tiles.length; i++) {
      var truth = b.truth[i]; if (truth == null || KIX[truth] == null) continue;
      var cls = KCLS[KIX[truth]], o = b.tiles[i];
      var pick = { tgt: cls.tgt, kind: cls.kind, amt: cls.amt, sgn: cls.sgn, rr: cls.rr };
      CH.forEach(function (c) { C[c[0]][pick[c[3]]][o[c[0]]]++; });
      ECH.forEach(function (c) { C[c[0]][o.eB][pick[c[3]]][o[c[0]]]++; });
      C.kindPrior[cls.kind]++;
    }
  });
  var M = {};
  CH.forEach(function (c) { M[c[0]] = normRows(C[c[0]]); });
  ECH.forEach(function (c) { M[c[0]] = [normRows(C[c[0]][0]), normRows(C[c[0]][1]), normRows(C[c[0]][2])]; });
  M.kindPrior = normVec(C.kindPrior);
  return M;
}

// ------------------------------------------------------------------ the solver
// Kept in the same shape as tileSolve() in ocr/structural-engine.js — change the
// two together or the trained tables stop describing the reader.
function perTileScores(M, W, board) {
  var prior = board.prior, out = [];
  for (var i = 0; i < board.tiles.length; i++) {
    var o = board.tiles[i], acc = new Array(NK);
    for (var k = 0; k < NK; k++) {
      if (prior[k] == null) { acc[k] = null; continue; }
      var cls = KCLS[k];
      var pick = { tgt: cls.tgt, kind: cls.kind, amt: cls.amt, sgn: cls.sgn, rr: cls.rr };
      var sc = W.wPrior * prior[k] + W.wKindPrior * M.kindPrior[cls.kind];
      sc += W.wHue * M.hue[cls.tgt][o.hue] + W.wFace * M.face[cls.tgt][o.face] + W.wCapt * M.capt[cls.tgt][o.capt];
      sc += W.wLine * M.line[cls.kind][o.line] + W.wArrow * M.arrow[cls.kind][o.arrow] +
            W.wCapk * M.capk[cls.kind][o.capk] + W.wGrey * M.grey[cls.kind][o.grey] + W.wInk * M.ink[cls.kind][o.ink];
      sc += W.wTm * M.tm[cls.amt][o.tm] + W.wOcrA * M.ocrA[cls.amt][o.ocrA] + W.wCapV * M.capV[cls.amt][o.capV] +
            W.wBare * M.bare[cls.amt][o.bare] + W.wSyG * M.syG[cls.amt][o.syG] + W.wSyR * M.syR[cls.amt][o.syR];
      sc += W.wSgn * (M.plus[cls.sgn][o.plus] + M.capSign[cls.sgn][o.capSign]) + W.wRr * M.rr[cls.rr][o.rr];
      sc += W.wEngK * M.eK[o.eB][cls.kind][o.eK] + W.wEngT * M.eT[o.eB][cls.tgt][o.eT] + W.wEngA * M.eA[o.eB][cls.amt][o.eA];
      acc[k] = sc;
      void pick;
    }
    out.push(acc);
  }
  return out;
}

// Joint over the four tiles. The only coupling is a DUPLICATE penalty: 3 of the 457
// scored boards repeat a key, so repetition is rare but real and must be priced, not
// forbidden. Enumerate the top TOPK candidates per tile (the rest cannot win a slot
// once the penalty is at most one term).
var TOPK = 8;
function jointSolve(M, W, board) {
  var per = perTileScores(M, W, board);
  var n = per.length;
  var cand = [];
  for (var i = 0; i < n; i++) {
    var lst = [];
    for (var k = 0; k < NK; k++) if (per[i][k] != null) lst.push({ k: k, s: per[i][k] });
    lst.sort(function (a, b) { return b.s - a.s; });
    cand.push(lst.slice(0, TOPK));
  }
  var best = null, bestS = -Infinity;
  var alt = [];   // alt[i][k] = best joint score with tile i pinned to k
  for (i = 0; i < n; i++) { alt.push({}); }
  var idx = new Array(n).fill(0);
  function rec(i, acc, chosen) {
    if (i === n) {
      var dup = 0, seen = {};
      for (var q = 0; q < n; q++) { if (seen[chosen[q]]) dup++; seen[chosen[q]] = 1; }
      var s = acc + W.wDup * dup;
      if (s > bestS) { bestS = s; best = chosen.slice(); }
      for (q = 0; q < n; q++) { var a = alt[q], c = chosen[q]; if (a[c] == null || s > a[c]) a[c] = s; }
      return;
    }
    for (var j = 0; j < cand[i].length; j++) { chosen[i] = cand[i][j].k; rec(i + 1, acc + cand[i][j].s, chosen); }
  }
  if (cand.some(function (c) { return !c.length; })) return null;
  rec(0, 0, new Array(n));
  void idx;
  if (!best) return null;
  void alt;
  // PER-ASPECT MARGINS. The whole-key margin is min over every rival key, so on a
  // tile whose amount is certain but whose target is not it is small for a reason
  // that has nothing to do with the amount. The engine's caps are per-aspect too —
  // the 0.78 synth cap is about amount QUALITY, the sign cap about DIRECTION, the
  // capOverride/faceDissent caps about TARGET — so a cap may only be waived by the
  // margin of the aspect it doubts. Margins are taken over EVERY legal key at this
  // tile with the other three held at the joint best (the duplicate term is the only
  // coupling and it is re-priced per alternative), never over the truncated
  // candidate list, so a margin can never be inflated by a candidate that was
  // dropped before the enumeration.
  var margins = [], mT = [], mK = [], mA = [], mS = [];
  for (i = 0; i < n; i++) {
    var bi2 = best[i], bc = KCLS[bi2];
    var dupOf = function (kk) {
      var d = 0, seen = {};
      for (var q = 0; q < n; q++) { var v2 = q === i ? kk : best[q]; if (seen[v2]) d++; seen[v2] = 1; }
      return d;
    };
    var base = per[i][bi2] == null ? 0 : per[i][bi2];
    var bDup = W.wDup * dupOf(bi2);
    var mx = -Infinity, xT = -Infinity, xK = -Infinity, xA = -Infinity, xS = -Infinity;
    for (var kn = 0; kn < NK; kn++) {
      if (kn === bi2 || per[i][kn] == null) continue;
      var v = per[i][kn] + W.wDup * dupOf(kn), c2 = KCLS[kn];
      if (v > mx) mx = v;
      if (c2.tgt !== bc.tgt && v > xT) xT = v;
      if (c2.kind !== bc.kind && v > xK) xK = v;
      if (c2.amt !== bc.amt && v > xA) xA = v;
      if ((c2.sgn !== bc.sgn || c2.rr !== bc.rr) && v > xS) xS = v;
    }
    var ref = base + bDup;
    var m = function (x) { return x === -Infinity ? 99 : Math.round((ref - x) * 1000) / 1000; };
    margins.push(m(mx)); mT.push(m(xT)); mK.push(m(xK)); mA.push(m(xA)); mS.push(m(xS));
  }
  return { keys: best.map(function (k) { return KEYS[k].k; }), idx: best, margins: margins,
           mT: mT, mK: mK, mA: mA, mS: mS, score: bestS };
}

// ------------------------------------------------------------------ data prep
function keyOfOutcome(o) {
  if (!o) return null;
  if (o.type === "raise_effect" || o.type === "lower_effect") return o.type + ":" + o.target + ":" + o.amount;
  if (o.type === "change_side_option") return "change:" + o.target;
  if (o.type === "change_gold_cost") return "cost:" + (o.change > 0 ? "+" : "-");
  if (o.type === "reroll_increase") return "reroll:" + o.change;
  return "do_nothing";
}
function prepBoard(r) {
  var turnsOk = (r.stateConf && (r.stateConf.currentTurn || 0) >= 0.8);
  var turnsRemaining = (r.state.maxTurns || 0) - (r.state.currentTurn || 1) + 1;
  var ctx = {
    cfg: r.cfg || {}, cfgConf: r.cfgConf || {},
    turnsOk: turnsOk, turnsRemaining: turnsRemaining,
    cmOk: (r.stateConf && (r.stateConf.processCostMultiplier || 0) >= 0.8), costMult: r.state.processCostMultiplier || 0
  };
  // The engine channel and the A/B baseline are the LADDER's own read — `tileEvid[i].o`,
  // recorded inside readOutcomeCell and therefore before the trained solve can touch
  // it. Taking it from the snapped output instead would make the trainer read its own
  // overrides back as evidence the moment the cache is re-collected. (Measured on the
  // round-14 cache, where nothing overrides: the two agree on all 1888 tiles.)
  var tiles = [], got = [], gotConf = [];
  for (var i = 0; i < 4; i++) {
    var te = (r.tiles || [])[i];
    var k = te && te.o ? keyOfOutcome(JSON.parse(te.o)) : r.gotKeys[i];
    var c = te && te.conf != null ? te.conf : r.gotConf[i];
    got.push(k); gotConf.push(c);
    tiles.push(prepTile(te, k, c, r.cfg || {}));
  }
  return {
    name: r.name, holdout: r.holdout, skip: r.skipOutcomes,
    truth: r.skipOutcomes ? [null, null, null, null] : r.truthKeys,
    got: got, gotConf: gotConf, shipped: r.gotKeys, shippedConf: r.gotConf,
    tiles: tiles, prior: ratePrior(ctx), ctx: ctx
  };
}

// ------------------------------------------------------------------ weight fit
var W0 = { wPrior: 1, wKindPrior: 0.5, wHue: 1, wFace: 1, wCapt: 1, wLine: 1, wArrow: 1, wCapk: 1,
           wGrey: 1, wInk: 1, wTm: 1, wOcrA: 1, wCapV: 1, wBare: 1, wSyG: 1, wSyR: 1,
           wSgn: 1, wRr: 1, wEngK: 1, wEngT: 1, wEngA: 1, wDup: -1.5 };
var WKEYS = Object.keys(W0);

function scoreSet(M, W, set) {
  var ok = 0, tot = 0, marg = 0;
  set.forEach(function (b) {
    if (b.skip) return;
    var s = jointSolve(M, W, b);
    if (!s) return;
    for (var i = 0; i < 4; i++) {
      if (b.truth[i] == null) continue;
      tot++;
      if (s.keys[i] === b.truth[i]) { ok++; marg += Math.min(s.margins[i], 20); }
      else marg -= Math.min(s.margins[i], 20);
    }
  });
  return { ok: ok, tot: tot, obj: ok + marg / 5000 };
}

function fitWeights(M, set, base) {
  var W = Object.assign({}, base || W0);
  var cur = scoreSet(M, W, set);
  var grid = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
  var dupGrid = [0, -0.5, -1, -1.5, -2.5, -4, -6];
  for (var pass = 0; pass < 3; pass++) {
    var moved = false;
    WKEYS.forEach(function (k) {
      var vals = k === "wDup" ? dupGrid : grid;
      var bestV = W[k], bestS = cur;
      vals.forEach(function (v) {
        if (v === W[k]) return;
        var W2 = Object.assign({}, W); W2[k] = v;
        var s = scoreSet(M, W2, set);
        if (s.obj > bestS.obj) { bestS = s; bestV = v; }
      });
      if (bestV !== W[k]) { W[k] = bestV; cur = bestS; moved = true; }
    });
    if (!moved) break;
  }
  return { W: W, fit: cur };
}

module.exports = { KEYS: KEYS, KIX: KIX, prepBoard: prepBoard, prepTile: prepTile, calibrate: calibrate,
                   jointSolve: jointSolve, perTileScores: perTileScores, fitWeights: fitWeights,
                   ratePrior: ratePrior, legalMask: legalMask, KCLS: KCLS, CH: CH, ECH: ECH, W0: W0, whObs: whObs };

// ------------------------------------------------------------------ main
if (require.main !== module) return;
var cachePath = A.cache || path.join(require("os").tmpdir(), "tevid.jsonl");
if (!fs.existsSync(cachePath)) { console.error("no evidence cache at " + cachePath + " — run tools/collect-tile-evid.js first"); process.exit(1); }
var raw = fs.readFileSync(cachePath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
var boards = raw.map(prepBoard);
var train = boards.filter(function (b) { return !b.holdout && !b.skip; });
var hold = boards.filter(function (b) { return b.holdout && !b.skip; });
console.log("boards " + boards.length + "  train " + train.length + "  holdout " + hold.length);

function report(M, W, set, label) {
  var ok = 0, tot = 0, engOk = 0, fixed = 0, broke = 0;
  var bands = {};
  set.forEach(function (b) {
    var s = jointSolve(M, W, b);
    for (var i = 0; i < 4; i++) {
      var t = b.truth[i]; if (t == null) continue;
      tot++;
      var m = s ? s.keys[i] : null;
      if (m === t) ok++;
      if (b.got[i] === t) engOk++;
      if (m === t && b.got[i] !== t) fixed++;
      if (m !== t && b.got[i] === t) broke++;
      if (s) {
        var mb = Math.min(20, Math.floor(s.margins[i]));
        var kb = mb < 1 ? "<1" : mb < 2 ? "1-2" : mb < 4 ? "2-4" : mb < 8 ? "4-8" : mb < 14 ? "8-14" : ">=14";
        bands[kb] = bands[kb] || { n: 0, ok: 0 };
        bands[kb].n++; if (m === t) bands[kb].ok++;
      }
    }
  });
  console.log("  " + label.padEnd(12) + " model " + ok + "/" + tot + " (" + (100 * ok / tot).toFixed(1) + "%)   engine " +
    engOk + "/" + tot + " (" + (100 * engOk / tot).toFixed(1) + "%)   fixes " + fixed + "  breaks " + broke);
  console.log("      margin bands: " + ["<1", "1-2", "2-4", "4-8", "8-14", ">=14"].map(function (k) {
    return k + " " + (bands[k] ? bands[k].ok + "/" + bands[k].n : "0/0");
  }).join(" · "));
  return { ok: ok, tot: tot, engOk: engOk, fixed: fixed, broke: broke };
}

var M = calibrate(train);
var fit = fitWeights(M, train);
console.log("weights " + JSON.stringify(fit.W));
report(M, fit.W, train, "TRAIN");
report(M, fit.W, hold, "HOLDOUT");

if (A.cv) {
  // 5-fold inside the training split — structural choices are made here, never on
  // the holdout, and never on the training fit alone.
  var folds = [[], [], [], [], []];
  train.forEach(function (b, i) { folds[djb2(b.name) % 5 === 0 ? 0 : (i % 5)].push(b); });
  var cok = 0, ctot = 0, ceng = 0;
  for (var f = 0; f < 5; f++) {
    var tr = [], te = [];
    train.forEach(function (b, i) { (i % 5 === f ? te : tr).push(b); });
    var Mf = calibrate(tr), Wf = fitWeights(Mf, tr).W;
    te.forEach(function (b) {
      var s = jointSolve(Mf, Wf, b);
      for (var i = 0; i < 4; i++) {
        var t = b.truth[i]; if (t == null) continue;
        ctot++; if (s && s.keys[i] === t) cok++; if (b.got[i] === t) ceng++;
      }
    });
  }
  console.log("  5-fold CV inside train: model " + cok + "/" + ctot + "   engine " + ceng + "/" + ctot);
}

if (!A.dry) {
  var nTiles = train.reduce(function (a, b) { return a + b.truth.filter(function (x) { return x != null; }).length; }, 0);
  var body = "// GENERATED by tools/build-tile-model.js — do not edit by hand.\n" +
    "// Calibrated observation tables for the JOINT outcome-TILE solve: for each channel,\n" +
    "// log P(observation | class), smoothed (alpha=" + ALPHA + ") and estimated on the " + train.length + "\n" +
    "// non-holdout boards of the corpus (djb2(stem)%5==0 excluded, as in\n" +
    "// tools/build-level-refs.js) — " + nTiles + " tiles. `keys` is model/astrogem.js\n" +
    "// OUTCOME_RATES re-expressed as data: the base rate of every legal outcome and the\n" +
    "// level/turn/cost bound that excludes it, which is where the state prior and the\n" +
    "// legality mask come from.\n" +
    "// REGENERATING THIS FILE CHANGES WHAT THE ENGINE READS — re-run the full eval and\n" +
    "// A/B it against the shipped build before keeping the result.\n" +
    "(function (root) {\n  \"use strict\";\n  var X = { TILE_MODEL: " + JSON.stringify({ keys: KEYS, M: M, w: fit.W, topk: TOPK }) + " };\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = X;\n  else root.OcrTileModel = X;\n" +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(OUT, body);
  console.log("wrote " + OUT + " (" + (body.length / 1024).toFixed(1) + " KB)");
}
