/**
 * verify-loseii-score.js — keeps the Loseii Score honest (model/loseii-score.js).
 *
 *   node tools/verify-loseii-score.js            check
 *   node tools/verify-loseii-score.js --capture  re-derive data/loseii-panel.json and the REFS
 *
 * What it checks:
 *
 *   1. THE PANEL. Every calibration member's readings in data/loseii-panel.json
 *      are derived again from its stored lostark.bible records
 *      (tools/fixtures/loseii-panel.json) through lookup.js — the path every
 *      page runs — and must match the file. A drift means a model or a table
 *      moved under the panel; --capture re-derives it.
 *   2. THE SCALE. calibrate() on those readings gives the file's K, and the
 *      panel's weighted median of score / in-game CP is 1 (within 0.001).
 *   3. THE CASES in tools/loseii-score-refs.json (the reference build, a weak
 *      1700, a whale, a mid support, real pulled records) reproduce their
 *      captured scores and per-system D.
 *   4. INVARIANTS: an upgrade on any ladder never lowers the score; a missing
 *      system is listed as unscored and moves nothing.
 *   5. THE PYTHON TWIN (model/loseii_score.py) recomputes the scale and every
 *      case from the same tables and readings, and re-derives the DPS tables
 *      from the data files itself; it must agree.
 *
 * Runs on node with no network: the four chart models, the bracelet
 * calculator's scorer and the astrogem model are required from the monorepo.
 */
"use strict";
var fs = require("fs"), path = require("path"), cp = require("child_process");
var G = path.dirname(__dirname) + path.sep, R = path.dirname(path.dirname(__dirname)) + path.sep;
var CAPTURE = process.argv.indexOf("--capture") >= 0;
var REFS_FILE = path.join(__dirname, "loseii-score-refs.json");
var PANEL_FILE = path.join(G, "data", "loseii-panel.json");
var FIXTURE = path.join(__dirname, "fixtures", "loseii-panel.json");

// ---- the lookup, in node ---------------------------------------------------
var L = require(G + "lookup.js");
var S = require(G + "model/loseii-score.js");
L.use({ Support: require(G + "model/support.js"), Gear: require(G + "model/gear.js"),
        Honing: require(G + "model/honing.js"), Karma: require(G + "model/karma.js"), LoseiiScore: S,
        Astrogem: require(R + "loa-astrogem-calc/model/astrogem.js"),
        Bracelet: require(R + "loa-bracelet-calc/model/bracelet.js"),
        Subrank: require(R + "loa-bracelet-calc/subrank.js") });
function readJson(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }
var got = {};
L.DATA_FILES.forEach(function (f) {
  var file = path.join(G, "data", f);
  got[f] = fs.existsSync(file) ? readJson(file) : null;
});
var DATA = L.data();
L.absorb(DATA, got);
DATA.accLattice = { support: readJson(G + "data/accessory-scores.json"), dps: readJson(G + "data/accessory-configs-dps.json") };
DATA.accGold = { support: readJson(G + "data/accessory-configs.json"), dps: DATA.accLattice.dps };
DATA.accIndex = {}; DATA.accFam = {}; DATA.accGoldIndex = {};

var fails = 0;
function check(label, ok, detail) {
  if (!ok) fails++;
  console.log((ok ? "  ok  " : "  FAIL") + " " + label + (detail ? "   " + detail : ""));
}
function near(a, b, tol) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol; }
function sameDeep(a, b, tol) {
  if (typeof a === "number" && typeof b === "number") return near(a, b, tol);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; }).sort();
  var kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; }).sort();
  if (ka.join() !== kb.join()) return false;
  return ka.every(function (k) { return sameDeep(a[k], b[k], tol); });
}
function clean(x) { return JSON.parse(JSON.stringify(x)); }
var AXES = ["dps", "support"];
var T = {}, REF = {};

// ---- 1. the panel ------------------------------------------------------------
function readingsOf(m) {
  var pos = L.place({ record: m.record, astro: m.astro, axis: m.axis, now: m.record.pulledAt });
  var rd = clean(pos.readings);
  delete rd.honingNote;
  return rd;
}
console.log("panel — readings re-derived from tools/fixtures/loseii-panel.json");
var FX = readJson(FIXTURE);
var PANEL = CAPTURE ? { v: 1 } : readJson(PANEL_FILE);
AXES.forEach(function (axis) {
  var src = FX.members.filter(function (m) { return m.axis === axis; });
  if (CAPTURE) {
    PANEL[axis] = { members: src.map(function (m) {
      return { name: m.name, "class": m["class"], ilvl: m.ilvl, band: m.band, weight: m.weight, cp: m.cp,
               cpSource: m.cpSource, readings: readingsOf(m) };
    }) };
  }
  var mine = PANEL[axis].members, bad = [];
  src.forEach(function (m, i) {
    if (!mine[i] || mine[i].name !== m.name || !sameDeep(readingsOf(m), mine[i].readings, 1e-9)) bad.push(m.name);
  });
  check(axis + ": " + src.length + " members' readings match data/loseii-panel.json", !bad.length && mine.length === src.length,
        bad.length ? bad.slice(0, 5).join(", ") : "");
});

// ---- 2. the scale --------------------------------------------------------------
// The reference's lattice and grid damage and Master's damage, live from the
// libraries; the file carries the same figures so pages never wait on them.
console.log("scale — the captured reference and Master, then calibrate() on the panel");
AXES.forEach(function (axis) {
  var live = L.scoreReferenceLive(DATA, axis);
  var sc = L.statC(axis), t1 = L.apT1(axis);
  if (CAPTURE) {
    PANEL[axis].reference = live;
    if (axis === "dps") PANEL[axis].masterD = L.masterD();
    PANEL[axis].msC = sc.msC; PANEL[axis].wpC = sc.wpC; PANEL[axis].apT1 = t1;
  }
  DATA.loseiiPanel = PANEL; DATA._scoreT = {}; DATA._scoreC = {};
  check(axis + " stats beside the gear (" + sc.msC + " main stat, " + sc.wpC + " weapon power) match the file",
        near(sc.msC, PANEL[axis].msC, 1e-9) && near(sc.wpC, PANEL[axis].wpC, 1e-9));
  check(axis + " one tier-1 evolution level " + t1.toFixed(4) + " matches the file", near(t1, PANEL[axis].apT1, 1e-9));
  check(axis + " reference (accessory lattice points, 60/60/60 grid) matches the file",
        sameDeep(live, PANEL[axis].reference, 1e-9));
  if (axis === "dps") check("Master's damage " + L.masterD().toFixed(4) + " matches the file",
        near(L.masterD(), PANEL.dps.masterD, 1e-9));
  T[axis] = L.scoreTables(DATA, axis);
  REF[axis] = L.scoreReference(DATA, axis);
});
// ---- 2b. the fixed partner ----------------------------------------------------
// A dealer carries a fixed dummy support buff on its attack power; the model
// holds it frozen, and it must still be what the two models give.
console.log("fixed partner — the dummy support buff on a dealer's attack power");
var dummyLive = L.dummySupportAp();
check("the frozen dummy support buff ×" + S.DUMMY_SUPPORT_AP + " matches the support model's reference pair (×" +
      dummyLive.toFixed(5) + ")", near(dummyLive, S.DUMMY_SUPPORT_AP, 5e-5));

var CAL = {};
AXES.forEach(function (axis) {
  var c = CAL[axis] = S.calibrate(T[axis], axis, PANEL[axis].members, REF[axis]);
  if (CAPTURE) { PANEL[axis].K = c.K; PANEL[axis].braceletRef = c.braceletRef; }
  check(axis + " K = " + c.K.toFixed(2) + " matches the file", near(c.K, PANEL[axis].K, 1e-6));
  var med = S.wmedian(c.members.map(function (m) { return { v: c.K * m.mult / m.cp, w: m.weight }; }));
  check(axis + " the panel's weighted median score / CP is 1", near(med, 1, 1e-3), "(" + med.toFixed(4) + ")");
});
if (CAPTURE) {
  PANEL.note = "The Loseii Score's calibration panel (model/loseii-score.js calibrate). Real NA characters with the " +
    "in-game Combat Power their own lostark.bible pull carried, weighted so each item-level band counts as its " +
    "share of the NA bracelet board. K is the weighted median of CP / damage multiplier, so the median NA " +
    "character scores its own CP. `readings` are what lookup.js derives from the records in " +
    "tools/fixtures/loseii-panel.json; tools/verify-loseii-score.js fails if the live path derives anything else.";
  PANEL.target = 1;
  PANEL.captured = new Date().toISOString().slice(0, 10);
  var ordered = { note: PANEL.note, v: 1, target: 1, captured: PANEL.captured, dps: PANEL.dps, support: PANEL.support };
  fs.writeFileSync(PANEL_FILE, JSON.stringify(ordered) + "\n");
  PANEL = ordered;
}
function run(axis, readings, why) {
  return S.score({ axis: axis, tables: T[axis], calib: CAL[axis], readings: readings, why: why || {},
                   reference: REF[axis] });
}

// ---- 3. the cases --------------------------------------------------------------
var KINDS = { neck: ["neck"], earring: ["ear1", "ear2"], ring: ["finger1", "finger2"] };
function accD(axis, kind, c) {
  var key = function (p, f, m) { return (p || []).map(function (t) { return t || "-"; }).join("|") + "/" + (f || "-") + "/" + m; };
  var want = key(c.prim, c.flat, c.ms), hit = null;
  DATA.accLattice[axis][kind].forEach(function (x) { if (key(x.prim, x.flat, x.ms) === want) hit = x; });
  return hit ? hit.D : null;
}
function accSet(axis, cfgs) {
  var out = {};
  Object.keys(KINDS).forEach(function (kind) {
    KINDS[kind].forEach(function (slot) { out[slot] = { D: accD(axis, kind, cfgs[kind]), label: L.cfgLabel(cfgs[kind]) }; });
  });
  return out;
}
function rowTotal(axis, band) {
  var hit = null;
  (DATA.rows[axis] || []).forEach(function (r) { if (r.series === "bracelet" && String(r.to).trim() === band) hit = r.totalDamage; });
  return hit;
}
function all(v) { return { head: v, shoulders: v, torso: v, legs: v, hands: v }; }
function gems(v) { var o = []; for (var i = 0; i < 11; i++) o.push(v); return o; }
function buildCases() {
  var out = [];
  AXES.forEach(function (axis) {
    out.push({ name: axis + " reference character", axis: axis,
      readings: clean(S.referenceReadings({ acc: REF[axis].acc, grid: REF[axis].grid, bracelet: CAL[axis].braceletRef })) });
  });
  out.push({ name: "dps weak build: +15 armour, +16 weapon, karma 15, level-7 gems, 7-6 stone, a C bracelet, " +
    "mid/low accessories at low main stat, 30/30/30 grid with 17-point cores", axis: "dps", readings: clean({
      armor: { pieces: all(15) }, weapon: 16, karma: 15, gems: gems(7), stone: "7-6",
      bracelet: { D: rowTotal("dps", "C+") - 1.5, label: "C" },
      acc: accSet("dps", { neck: { prim: ["mid", "low"], flat: null, ms: "low" },
                           earring: { prim: ["mid", "low"], flat: null, ms: "low" },
                           ring: { prim: ["mid", "low"], flat: null, ms: "low" } }),
      grid: { D: L.synthGridD("dps", [30, 30, 30], [17, 17, 17, 17, 17, 17]), label: "30/30/30, cores 17" },
      master: false }) });
  out.push({ name: "dps whale: +25 everywhere, karma 30, level-10 gems, 10-8 stone, S+ bracelet, high/high " +
    "atk-high max accessories, 80/80/80 grid at 20, Master", axis: "dps", readings: clean({
      armor: { pieces: all(25) }, weapon: 25, karma: 30, gems: gems(10), stone: "10-8",
      bracelet: { D: rowTotal("dps", "S+"), label: "S+" },
      acc: accSet("dps", { neck: { prim: ["high", "high"], flat: "atk-high", ms: "max" },
                           earring: { prim: ["high", "high"], flat: "atk-high", ms: "max" },
                           ring: { prim: ["high", "high"], flat: "atk-high", ms: "max" } }),
      grid: { D: L.synthGridD("dps", [80, 80, 80], [20, 20, 20, 20, 20, 20]), label: "80/80/80, cores 20" },
      master: true }) });
  out.push({ name: "support mid: +20 armour, +22 weapon, karma 25, level-9 gems, 9-7, a B bracelet, " +
    "high/mid accessories at mid main stat, 40/40/40 grid with 17-point cores", axis: "support", readings: clean({
      armor: { pieces: all(20) }, weapon: 22, karma: 25, gems: gems(9), stone: "9-7",
      bracelet: { D: rowTotal("support", "B"), label: "B" },
      acc: accSet("support", { neck: { prim: ["high", "mid"], flat: null, ms: "mid" },
                               earring: { prim: ["high"], flat: null, ms: "mid" },
                               ring: { prim: ["high", "mid"], flat: null, ms: "mid" } }),
      grid: { D: L.synthGridD("support", [40, 40, 40], [17, 17, 17, 17, 17, 17]), label: "40/40/40, cores 17" } }) });
  // real pulls: a whale with both halves, and a bracelet pull alone
  FX.members.filter(function (m) { return m.name === "Paroxysmal"; }).forEach(function (m) {
    out.push({ name: "Paroxysmal (NA), both pulls, in-game CP " + m.cp, axis: "dps", readings: readingsOf(m) });
  });
  // a 1700 character on the lower (1590) gear set, advanced honing 20
  FX.members.filter(function (m) { return m.name === "Torchidesu"; }).forEach(function (m) {
    out.push({ name: "Torchidesu (NA), 1700 on the 1590 set, in-game CP " + m.cp, axis: "dps", readings: readingsOf(m),
               wantTracks: "lower" });
  });
  var fx = path.join(__dirname, "fixtures", "loseii-shizukaziye-br.json");
  var pos = L.place({ record: readJson(fx), axis: "dps" });
  out.push({ name: "Shizukaziye (NA), bracelet pull only", axis: "dps", readings: clean(pos.readings),
             why: clean(pos.readingsWhy), wantUnscored: ["neck", "earring", "ring", "grid"] });
  return out;
}
var cases = CAPTURE ? buildCases() : readJson(REFS_FILE).cases;
console.log("cases — the captured scores");
cases.forEach(function (c) {
  var r = run(c.axis, c.readings, c.why);
  if (CAPTURE) {
    c.want = { score: r.score, D: r.D, parts: {}, unscored: r.unscored.filter(function (u) { return !u.always; })
      .map(function (u) { return u.system; }) };
    r.parts.forEach(function (p) { c.want.parts[p.system] = p.D; });
  }
  check(c.name + " → " + (r.score == null ? "no score" : Math.round(r.score)),
        near(r.score, c.want.score, 1e-6) && Object.keys(c.want.parts).every(function (k) {
          var p = r.parts.filter(function (x) { return x.system === k; })[0];
          return p && near(p.D, c.want.parts[k], 1e-9);
        }));
  if (c.wantUnscored) check("  lists " + c.wantUnscored.join(", ") + " as unscored", c.wantUnscored.every(function (k) {
    return r.unscored.some(function (u) { return u.system === k; });
  }));
});

// ---- 4. invariants --------------------------------------------------------------
console.log("invariants");
var base = clean(cases.filter(function (c) { return /weak build/.test(c.name); })[0].readings);
var s0 = run("dps", base).score;
[["armour +1 on every piece", function (x) { Object.keys(x.armor.pieces).forEach(function (k) { x.armor.pieces[k]++; }); }],
 ["weapon +1", function (x) { x.weapon++; }], ["karma +1", function (x) { x.karma++; }],
 ["one gem +1", function (x) { x.gems[0]++; }], ["stone to 9-7", function (x) { x.stone = "9-7"; }],
 ["Master", function (x) { x.master = true; }],
 ["a better bracelet", function (x) { x.bracelet.D += 1; }]].forEach(function (t) {
  var x = clean(base); t[1](x);
  check(t[0] + " raises the score", run("dps", x).score > s0);
});
var noGrid = clean(base); delete noGrid.grid;
var rg = run("dps", noGrid);
check("a missing grid is unscored, not zero", rg.unscored.some(function (u) { return u.system === "grid"; }) &&
      !rg.parts.some(function (p) { return p.system === "grid"; }));
check("the stone test matches the chart's (10-6 owns 9-7, 9-6 does not)",
      S.stoneOwns("9-7", "10-6") && !S.stoneOwns("9-7", "9-6"));
// the two gear sets: a piece at 1700 on the 1590 set carries less than the
// same piece at 1730 on the 1675 set, and the score says so
var low = clean(base); low.armor.tracks = { head: "lower", shoulders: "lower", torso: "lower", legs: "lower", hands: "lower" };
low.armor.pieces = { head: 18, shoulders: 18, torso: 18, legs: 18, hands: 18 };
low.armor.adv = { head: 20, shoulders: 20, torso: 20, legs: 20, hands: 20 };
var up = clean(low); up.armor.pieces = { head: 11, shoulders: 11, torso: 11, legs: 11, hands: 11 }; delete up.armor.tracks;
check("armour +18 / advanced 20 on the 1590 set (ilvl 1700) scores under +11 on the 1675 set (ilvl 1730)",
      run("dps", low).score < run("dps", up).score);
var low2 = clean(low); low2.armor.adv = { head: 40, shoulders: 40, torso: 40, legs: 40, hands: 40 };
check("advanced honing on the 1590 set raises the score", run("dps", low2).score > run("dps", low).score);
var g6 = clean(base); g6.gems = g6.gems.map(function () { return 6; });
check("level-6 gems score under level-7 ones (no floor clamp)", run("dps", g6).score < s0);
var t1 = clean(base); t1.evolution = 20;
check("20 evolution points score under 140", run("dps", t1).score < s0);
cases.filter(function (c) { return c.wantTracks; }).forEach(function (c) {
  var tr = c.readings.armor && c.readings.armor.tracks || {};
  check(c.name.split(",")[0] + ": every armour piece read on the " + c.wantTracks + " set",
        Object.keys(tr).length === 5 && Object.keys(tr).every(function (k) { return tr[k] === c.wantTracks; }) &&
        c.readings.weaponTrack === c.wantTracks);
});
// no support in a dealer's score: its item level, any support field and the
// support model's own numbers move nothing
var supBase = clean(cases.filter(function (c) { return /support mid/.test(c.name); })[0].readings);
function withIlvl(r, il) { var x = clean(r); x.ilvl = il; return x; }
check("a dealer's score does not depend on its item level (no band-matched support)",
      near(run("dps", withIlvl(base, 1700)).score, run("dps", withIlvl(base, 1800)).score, 1e-9));
(function () {
  var Su = require(G + "model/support.js"), keep = JSON.parse(JSON.stringify(Su.DEFAULTS));
  var before = run("dps", base).score;
  ["brandPower", "allyAtkEnh", "allyDmg", "allyDmgT", "spec"].forEach(function (k) { Su.DEFAULTS[k] *= 1.5; });
  Su.DEFAULTS.upAp = 50; Su.DEFAULTS.upBrand = 50; Su.DEFAULTS.upSeren = 20;
  DATA._scoreT = {}; DATA._scoreC = {};
  var T2 = L.scoreTables(DATA, "dps"), C2 = S.calibrate(T2, "dps", PANEL.dps.members, REF.dps);
  var after = S.score({ axis: "dps", tables: T2, calib: C2, readings: base, reference: REF.dps }).score;
  Object.keys(keep).forEach(function (k) { Su.DEFAULTS[k] = keep[k]; });
  DATA._scoreT = {}; DATA._scoreC = {};
  check("a dealer's score is independent of every support field (support.js buffs and uptimes x1.5 / halved)",
        near(before, after, 1e-9));
})();
// one fixed dealer for a support: no dealer's item level reaches its score
check("a support's score does not depend on its item level",
      near(run("support", withIlvl(supBase, 1700)).score, run("support", withIlvl(supBase, 1800)).score, 1e-9));
(function () {
  var moved = PANEL.dps.members.map(function (m) {
    return Object.assign({}, m, { ilvl: m.ilvl - 60, band: "1640-1660", readings: withIlvl(m.readings, m.ilvl - 60) });
  });
  var C2 = S.calibrate(T.support, "support", PANEL.support.members, REF.support);
  S.calibrate(T.dps, "dps", moved, REF.dps);
  check("a support's score is independent of every dealer's item-level band",
        near(C2.K, CAL.support.K, 1e-9) &&
        near(S.score({ axis: "support", tables: T.support, calib: C2, readings: supBase, reference: REF.support }).score,
             run("support", supBase).score, 1e-9));
})();
var refCase = cases.filter(function (c) { return c.name === "dps reference character"; })[0];
check("the reference character's multiplier is exactly 1", near(run("dps", refCase.readings).mult, 1, 1e-12));
check("the reference character scores exactly K, the fixed support buff included",
      near(run("dps", refCase.readings).score, CAL.dps.K, 1e-9) &&
      run("dps", refCase.readings).parts.some(function (p) { return p.system === "partner" && Math.abs(p.D) < 1e-12; }));
var refSupCase = cases.filter(function (c) { return c.name === "support reference character"; })[0];
check("the support reference scores exactly K on the fixed dealer",
      near(run("support", refSupCase.readings).score, CAL.support.K, 1e-9));

if (CAPTURE) {
  fs.writeFileSync(REFS_FILE, JSON.stringify({
    note: "Captured by tools/verify-loseii-score.js --capture from the JS model; the Python twin " +
      "(model/loseii_score.py) must reproduce the scale and every case from these tables and readings.",
    version: S.VERSION, tables: T, reference: REF,
    panel: { dps: PANEL.dps, support: PANEL.support }, cases: cases }, null, 1) + "\n");
  console.log("\nwrote tools/loseii-score-refs.json and data/loseii-panel.json");
}

// ---- 5. the Python twin ------------------------------------------------------------
console.log("python twin");
var py = cp.spawnSync(process.platform === "win32" ? "python" : "python3",
  [path.join(G, "model", "loseii_score.py"), "verify", REFS_FILE], { encoding: "utf8" });
if (py.error) check("python ran", false, String(py.error));
else {
  process.stdout.write(py.stdout.split(/\r?\n/).map(function (l) { return l ? "    " + l : l; }).join("\n"));
  check("python twin agrees", py.status === 0, py.stderr ? py.stderr.trim().slice(-400) : "");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall checks pass");
process.exit(fails ? 1 : 0);
