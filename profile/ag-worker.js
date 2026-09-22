/**
 * ag-worker.js — the profile page's astrogem arithmetic, off the main thread.
 *
 * Every number comes from the astrogem calculator's own files, imported below
 * at the pins its index.html uses: model/astrogem.js (the scoring) and
 * loadout-econ.js (the grader's default DPS/Support axis). Nothing here
 * re-derives a formula. What is written out here is only which model calls to
 * make, copied from the two pages that make them:
 *
 *   loa-astrogem-calc/leaderboard.js  validGemsOf, valueToGrade, the board's two
 *       axes, its filters and its sort -> the board quality and the board rank.
 *   loa-astrogem-calc/grader.js  gGrade / gRank / gRel and the core grouping ->
 *       each gem's grade, letter and % damage, the per-core figures, the plain
 *       average grade and the "Total % dmg" (gridDamage) the grader shows.
 *
 * THE GRID BREAKDOWN is the model's own gridDamage called on the same gems with
 * everything but one part set to zero: one effect family's levels, or every
 * core's points. The model adds those parts up in its total (a sum of
 * 100·ln terms), so the parts sum to the total exactly, and no formula is copied.
 *
 * WHY A WORKER. The board is the ?list=1&fmt=2 snapshot: ~2.5 MB gzipped, 12 MB
 * of JSON, ~24,000 characters, all of which have to be scored to know one rank.
 * That costs ~0.3 s of CPU, which would freeze the page. It is reduced here to a
 * per-region INDEX (each board's names in board order and each board's sort
 * key), kept 30 minutes in memory and in the Cache API; the board itself
 * rebuilds at most every 30 minutes.
 *
 * Messages in:  {id, type:"score", gems, cls}
 *               {id, type:"rank", region, name, cls, cur:{dmg,pdmg,supportMain}, maxAgeMs, offline}
 *               offline:true (a prerendered page) answers from memory or the Cache
 *               API only and never downloads; with nothing cached it fails with
 *               {deferred:true} and the page asks again once it is shown.
 * Messages out: {id, ok, result|error}
 *               {type:"index-updated", region}  after a background refresh
 */
"use strict";

importScripts("/loa-astrogem-calc/model/astrogem.js?v=62", "/loa-astrogem-calc/loadout-econ.js?v=8");

var A = self.Astrogem;
var ECON = self.LoadoutEcon || null;
var LIST_URL = "https://astrogem-bible.shizukaziye.workers.dev/?list=1&fmt=2";
var CACHE_NAME = "loseii-profile-v1";
var INDEX_TTL_MS = 30 * 60 * 1000;
var INDEX_V = 1;
var REGIONS = ["NA", "EU"];     // the regions the profile serves; the board's KR chip is not one of them

// ---- copied from loa-astrogem-calc/leaderboard.js --------------------------

var SUPPORT_CLASSES = { "Bard": 1, "Paladin": 1, "Artist": 1, "Valkyrie": 1 };
function isSupportClass(c) { return !!(c && c.cls && SUPPORT_CLASSES[c.cls]); }
var SUBRANK_ORDINAL = { "F-": 0, "F": 1, "F+": 2, "D-": 3, "D": 4, "D+": 5, "C-": 6, "C": 7, "C+": 8,
  "B-": 9, "B": 10, "B+": 11, "A-": 12, "A": 13, "A+": 14, "S-": 15, "S": 16, "S+": 17 };
function supRank(g) { return A.supportRankFromGrade ? A.supportRankFromGrade(g) : A.rankFromGrade(g); }
function isSupportMain(c) {
  if (c.avg == null || c.savg == null) return false;
  return SUBRANK_ORDINAL[supRank(c.savg)] - SUBRANK_ORDINAL[A.rankFromGrade(c.avg)] >= 2;
}
function validGemsOf(gems) {
  var out = [];
  for (var i = 0; i < gems.length; i++) if (A.validateConfig(gems[i]).valid) out.push(gems[i]);
  return out;
}
function valueToGrade(v, zero, anchor) {
  if (zero == null || anchor == null) return null;
  var g = 100 * (v - zero) / (anchor - zero);
  return Math.round(Math.max(0, Math.min(110, g)) * 10) / 10;
}
var V2_SLOT = { 1: "Order Sun", 2: "Order Moon", 3: "Order Star", 4: "Chaos Sun", 5: "Chaos Moon", 6: "Chaos Star" };

// The model's two anchors per axis are constants; read them once.
var DPS_ZERO = A.valueBounds().min, DPS_ANCHOR = A.valueAnchor();
var SUP_ZERO = A.supportValueBounds().min, SUP_ANCHOR = A.supportValueAnchor();

/** Both axes for one gem list, exactly as the board's avgGradeOf / totalDmgOf pair. */
function axes(valid, wantSupport) {
  var n = valid.length;
  var out = {
    avg: valueToGrade(Math.exp(A.gridQuality(valid, "dps") / n), DPS_ZERO, DPS_ANCHOR),
    dmg: A.gridDamage(valid, "dps"),
    savg: null,
    pdmg: null
  };
  if (wantSupport) {
    out.savg = valueToGrade(Math.exp(A.gridQuality(valid, "support") / n), SUP_ZERO, SUP_ANCHOR);
    out.pdmg = A.gridDamage(valid, "support");
  }
  return out;
}

// ---- copied from loa-astrogem-calc/grader.js --------------------------------

/** grader.js gGrade / gRank on one axis. */
function gemGrade(cfg, axis) { return axis === "support" && A.supportGrade ? A.supportGrade(cfg) : A.grade(cfg); }
function gemLetter(cfg, axis) { return axis === "support" && A.supportRank ? A.supportRank(cfg) : A.gemRank(cfg); }
function avgLetter(g, axis) { return axis === "support" ? supRank(g) : A.rankFromGrade(g); }
/**
 * grader.js gRel: a gem's % damage ABOVE the neutral baseline gem (order 4.25,
 * no effects). DPS: gemDamage minus orderScore(4.25). Support: supportDamage at
 * the gem's own core's order value, minus 4.25 points of it.
 */
function gemRel(cfg, axis) {
  if (axis === "support") {
    var ov = A.supportOrderValueForCore ? A.supportOrderValueForCore(A.coreKeyOf ? A.coreKeyOf(cfg) : cfg.coreBase) : null;
    if (A.supportDamage && ov != null) return A.supportDamage(cfg, ov) - 4.25 * ov;
    return A.supportRelValue(cfg);
  }
  if (A.gemDamage && A.orderScore) return A.gemDamage(cfg) - A.orderScore(4.25);
  return A.relDamage(cfg);
}
/** grader.js offRole: an effect this axis scores at zero while the other axis does not. */
function offRole(name, axis) {
  var sup = A.supportEffectScore(name, 1) > 0, dps = A.effectScore(name, 1) > 0;
  return axis === "support" ? (dps && !sup) : sup;
}
/** grader.js gemsByCoreHtml: cores keyed by slot, typed by the majority of their gems. */
function coreKey(g) { return g.slot || ("Core " + (g.coreBase || "?")); }
function coreTypeOf(list) {
  var o = 0, c = 0;
  list.forEach(function (x) { if (x.gemType === "order") o++; else if (x.gemType === "chaos") c++; });
  if (o === c) return /chaos/i.test(list[0] && list[0].slot || "") ? "chaos" : "order";
  return o >= c ? "order" : "chaos";
}
/** The grader's default axis for a loadout: support iff a support class with support-heavy gems. */
function defaultAxis(gems, cls) {
  if (!(A.supportGrade) || !ECON || !ECON.defaultModeFor) return "dps";
  return ECON.defaultModeFor({ "class": cls, gems: gems }) === "support" ? "support" : "dps";
}

// ---- the grid breakdown ------------------------------------------------------

/** The same gems with every effect level but `keep`'s set to zero, and the order points kept or zeroed. */
function only(gems, keep, keepOrder) {
  return gems.map(function (g) {
    return {
      slot: g.slot, coreBase: g.coreBase, baseCost: g.baseCost, gemType: g.gemType,
      willpowerLevel: g.willpowerLevel, orderLevel: keepOrder ? g.orderLevel : 0,
      effect1: g.effect1, effect1Level: (keep && g.effect1 === keep) ? g.effect1Level : 0,
      effect2: g.effect2, effect2Level: (keep && g.effect2 === keep) ? g.effect2Level : 0
    };
  });
}
var DPS_FAMILIES = ["Attack Power", "Additional Damage", "Boss Damage"];
var SUP_FAMILIES = ["Ally Attack Enh.", "Ally Damage Enh.", "Brand Power"];

/** Where each letter starts on an axis, read off the model's own letter function. */
var LADDERS = {};
function ladder(axis) {
  if (LADDERS[axis]) return LADDERS[axis];
  var fn = axis === "support" ? supRank : A.rankFromGrade, out = [], prev = null;
  for (var t = 0; t <= 1100; t++) {
    var g = t / 10, k = fn(g);
    if (k !== prev) { out.push([k, g]); prev = k; }
  }
  return (LADDERS[axis] = out.reverse());   // best first
}

// ---- job 1: one character ---------------------------------------------------

function scoreOne(gems, cls) {
  gems = Array.isArray(gems) ? gems : [];
  var valid = validGemsOf(gems);
  var tiers = { legendary: 0, relic: 0, ancient: 0 }, seenCores = {}, nCores = 0, order = 0, chaos = 0, i;
  for (i = 0; i < gems.length; i++) {
    var g = gems[i];
    tiers[A.classifyTier(A.levelSum(g))]++;
    var k = A.coreKeyOf ? A.coreKeyOf(g) : (g.coreBase || g.slot);
    if (!seenCores[k]) { seenCores[k] = 1; nCores++; }
    if (g.gemType === "chaos") chaos++; else order++;
  }
  var res = { gems: gems.length, valid: valid.length, tiers: tiers, cores: nCores, order: order, chaos: chaos,
    dps: null, sup: null, supportClass: !!SUPPORT_CLASSES[cls], supportMain: false,
    axis: defaultAxis(gems, cls), table: null,
    tierBounds: A.TIER_BOUNDS, ladders: { dps: ladder("dps"), support: ladder("support") } };
  if (!valid.length) return res;

  // the board's quality, on both axes
  var ax = axes(valid, true);
  var dCol = A.gradeColor(ax.avg), sCol = A.gradeColor(ax.savg);
  res.dps = { quality: ax.avg, letter: A.rankFromGrade(ax.avg), dmg: ax.dmg, bg: dCol.bg, fg: dCol.fg };
  res.sup = { quality: ax.savg, letter: supRank(ax.savg), dmg: ax.pdmg, bg: sCol.bg, fg: sCol.fg };
  res.supportMain = !!(SUPPORT_CLASSES[cls] && isSupportMain({ avg: ax.avg, savg: ax.savg }));

  // the grader's view, on the grader's default axis
  var axis = res.axis, rows = [], sumGrade = 0;
  for (i = 0; i < gems.length; i++) {
    var c = gems[i], v = A.validateConfig(c);
    var row = {
      core: coreKey(c), type: c.gemType === "chaos" ? "chaos" : "order",
      cost: c.baseCost, wp: c.willpowerLevel, pts: c.orderLevel,
      e1: c.effect1, l1: c.effect1Level, e2: c.effect2, l2: c.effect2Level,
      off1: offRole(c.effect1, axis), off2: offRole(c.effect2, axis),
      sum: A.levelSum(c), tier: A.classifyTier(A.levelSum(c)),
      valid: !!v.valid, err: v.valid ? null : (v.error || "invalid")
    };
    if (v.valid) {
      var gg = gemGrade(c, axis), perfect = !!(A.isPerfectConfig && A.isPerfectConfig(c, axis));
      var col = A.gradeColor(gg, perfect);
      row.grade = gg; row.rank = gemLetter(c, axis); row.bg = col.bg; row.fg = col.fg; row.cls = col.cls || "";
      row.perfect = perfect; row.rel = gemRel(c, axis);
      sumGrade += gg;
    }
    rows.push(row);
  }
  // best first: grade, then % damage; unreadable gems last
  rows.sort(function (x, y) {
    if (x.valid !== y.valid) return x.valid ? -1 : 1;
    if (!x.valid) return 0;
    return (y.grade - x.grade) || (y.rel - x.rel);
  });

  // per core, in the grader's order: grouped by slot, order cores then chaos cores
  var groups = {}, keys = [];
  gems.forEach(function (x) { var key = coreKey(x); if (!groups[key]) { groups[key] = []; keys.push(key); } groups[key].push(x); });
  var cores = [], sections = { order: null, chaos: null };
  ["order", "chaos"].forEach(function (type) {
    var sec = { cores: 0, gems: 0, pts: 0, orderDmg: 0, rel: 0 };
    keys.forEach(function (key) {
      var list = groups[key];
      if (coreTypeOf(list) !== type) return;
      var ok = validGemsOf(list), pts = 0, rel = 0;
      ok.forEach(function (x) { pts += x.orderLevel || 0; rel += gemRel(x, axis); });
      var od = ok.length ? A.gridDamage(only(ok, null, true), axis) : 0;
      cores.push({ key: key, type: type, gems: list.length, pts: pts, orderDmg: od, rel: rel });
      sec.cores++; sec.gems += list.length; sec.pts += pts; sec.orderDmg += od; sec.rel += rel;
    });
    if (sec.cores) sections[type] = sec;
  });

  // the grid total and its parts
  var fams = axis === "support" ? SUP_FAMILIES : DPS_FAMILIES, parts = [], allPts = 0;
  fams.forEach(function (f) {
    var lv = 0;
    valid.forEach(function (x) {
      if (x.effect1 === f) lv += x.effect1Level || 0;
      if (x.effect2 === f) lv += x.effect2Level || 0;
    });
    parts.push({ name: f, levels: lv, dmg: A.gridDamage(only(valid, f, false), axis) });
  });
  valid.forEach(function (x) { allPts += x.orderLevel || 0; });
  var coresDmg = A.gridDamage(only(valid, null, true), axis);
  var avg = sumGrade / valid.length, avgCol = A.gradeColor(avg);
  res.table = {
    axis: axis, rows: rows, cores: cores, sections: sections,
    parts: parts, coresDmg: coresDmg, corePoints: allPts, total: A.gridDamage(valid, axis),
    avgGrade: avg, avgRank: avgLetter(avg, axis), avgBg: avgCol.bg, avgFg: avgCol.fg
  };
  return res;
}

// ---- job 2: the board index --------------------------------------------------

/**
 * The snapshot -> {NA:index, EU:index}. The board's own order of operations:
 * decode every row, score both axes, then per board filter and sort. The sort
 * is Array.prototype.sort, stable, over rows in payload order: the board's
 * exact tie-break (the snapshot holds ~250 exact ties per region).
 */
function buildIndexes(data, fetchedAt) {
  var classes = data.classes || [], effects = data.effects || [];
  function eff(i) { return (typeof i === "number" && i > 0) ? (effects[i - 1] || null) : null; }
  var byRegion = {}, r;
  for (r = 0; r < REGIONS.length; r++) byRegion[REGIONS[r]] = [];
  var rows = data.characters || [];
  for (var i = 0; i < rows.length; i++) {
    var a = rows[i];
    var list = byRegion[a[0]];
    if (!list) continue;                         // KR, a stray CE row the board shows under no chip, junk
    var cls = (a[3] != null && a[3] >= 0) ? classes[a[3]] : null;
    var t5 = a[5] || [], gems = [];
    for (var j = 0; j < t5.length; j++) {
      var t = t5[j], core = t[0] | 0;
      gems.push({
        slot: core ? V2_SLOT[core] : null, coreBase: core ? 10000 + core : null,
        baseCost: t[1], gemType: t[2] ? "chaos" : "order",
        willpowerLevel: t[3], orderLevel: t[4],
        effect1: eff(t[5]), effect1Level: t[6], effect2: eff(t[7]), effect2Level: t[8]
      });
    }
    var valid = validGemsOf(gems);
    var c = { n: String(a[1] || "").toLowerCase(), cls: cls, avg: null, dmg: null, savg: null, pdmg: null };
    // The support axis only matters for the four support classes: the DPS board
    // asks isSupportMain() of them alone, and the Support board holds no one else.
    if (valid.length) {
      var ax = axes(valid, !!SUPPORT_CLASSES[cls]);
      c.avg = ax.avg; c.dmg = ax.dmg; c.savg = ax.savg; c.pdmg = ax.pdmg;
    }
    list.push(c);
  }
  var out = {};
  for (r = 0; r < REGIONS.length; r++) {
    var reg = REGIONS[r], all = byRegion[reg];
    var dps = all.filter(function (c) {
      if (c.avg == null) return false;
      if (isSupportClass(c) && isSupportMain(c)) return false;
      return true;
    });
    dps.sort(function (x, y) { return (y.dmg == null ? -Infinity : y.dmg) - (x.dmg == null ? -Infinity : x.dmg); });
    var sup = all.filter(function (c) { return isSupportClass(c) && c.savg != null; });
    sup.sort(function (x, y) { return (y.pdmg == null ? -Infinity : y.pdmg) - (x.pdmg == null ? -Infinity : x.pdmg); });
    out[reg] = {
      v: INDEX_V, region: reg, builtAt: data.builtAt || 0, fetchedAt: fetchedAt,
      dps: { n: dps.map(function (c) { return c.n; }), v: dps.map(function (c) { return c.dmg; }) },
      sup: { n: sup.map(function (c) { return c.n; }), v: sup.map(function (c) { return c.pdmg; }) }
    };
  }
  return out;
}

var mem = {};           // region -> index
var inflight = null;    // the one download in progress, shared by every caller
var lastFetchMs = null; // timings of the last download, for the page's perf readout

function cacheKey(region) { return new Request("/profile/__cache/ag-index-" + region); }
function cacheOpen() {
  try { return self.caches ? self.caches.open(CACHE_NAME) : Promise.resolve(null); }
  catch (e) { return Promise.resolve(null); }
}
function readCached(region) {
  return cacheOpen().then(function (c) {
    return c ? c.match(cacheKey(region)) : null;
  }).then(function (resp) {
    return resp ? resp.json() : null;
  }).then(function (idx) {
    return (idx && idx.v === INDEX_V && idx.dps && idx.sup) ? idx : null;
  }).catch(function () { return null; });
}
function writeCached(idx) {
  return cacheOpen().then(function (c) {
    if (!c) return;
    return c.put(cacheKey(idx.region), new Response(JSON.stringify(idx), { headers: { "Content-Type": "application/json" } }));
  }).catch(function () {});
}

/** Download the snapshot and rebuild every region's index. One at a time. */
function download() {
  if (inflight) return inflight;
  var t0 = Date.now(), tf = 0, tp = 0;
  inflight = fetch(LIST_URL).then(function (resp) {
    return resp.text().then(function (txt) {
      tf = Date.now();
      var data = null;
      try { data = JSON.parse(txt); } catch (e) {}
      txt = null;
      if (!resp.ok || !data || !Array.isArray(data.characters) || !data.characters.length) {
        var err = new Error((data && data.error) || ("The astrogem board answered " + resp.status + "."));
        err.rateLimited = !!(data && data.rateLimited);
        throw err;
      }
      tp = Date.now();
      var idx = buildIndexes(data, Date.now());
      data = null;
      lastFetchMs = { fetch: tf - t0, parse: tp - tf, score: Date.now() - tp };
      for (var i = 0; i < REGIONS.length; i++) {
        mem[REGIONS[i]] = idx[REGIONS[i]];
        writeCached(idx[REGIONS[i]]);
      }
      return idx;
    });
  });
  inflight.then(function () { inflight = null; }, function () { inflight = null; });
  return inflight;
}

/**
 * The freshest index this worker can produce quickly.
 *   fresh (< maxAge) in memory or the Cache API  -> it, at once
 *   stale                                          -> it, at once, and a refresh behind it
 *   none                                           -> wait for the download
 */
function getIndex(region, maxAgeMs, offline) {
  var maxAge = typeof maxAgeMs === "number" ? maxAgeMs : INDEX_TTL_MS;
  function age(idx) { return Date.now() - (idx.fetchedAt || 0); }
  function refreshBehind() {
    if (offline) return;
    download().then(function () { self.postMessage({ type: "index-updated", region: region }); }, function () {});
  }
  var m = mem[region];
  if (m) {
    if (age(m) >= maxAge) refreshBehind();
    return Promise.resolve({ idx: m, source: "memory", stale: age(m) >= maxAge });
  }
  return readCached(region).then(function (c) {
    if (c) {
      mem[region] = c;
      if (age(c) >= maxAge) refreshBehind();
      return { idx: c, source: "cache", stale: age(c) >= maxAge };
    }
    if (offline) {
      var err = new Error("no cached board");
      err.deferred = true;
      throw err;
    }
    return download().then(function (all) {
      return { idx: all[region], source: "network", stale: false };
    });
  });
}

/** One board, one name: its place in board order, or where its value would land. */
function place(board, nameLower, mine) {
  var i = board.n.indexOf(nameLower);
  if (i >= 0) return { rank: i + 1, count: board.n.length, estimated: false, key: board.v[i] };
  if (typeof mine !== "number" || !isFinite(mine)) return null;
  var better = 0;
  for (var k = 0; k < board.v.length; k++) if (board.v[k] != null && board.v[k] > mine) better++;
  return { rank: better + 1, count: board.n.length + 1, estimated: true, key: mine };
}

function rankOne(m) {
  var region = REGIONS.indexOf(m.region) >= 0 ? m.region : "NA";
  var nameLower = String(m.name || "").toLowerCase();
  return getIndex(region, m.maxAgeMs, !!m.offline).then(function (got) {
    var idx = got.idx, cur = m.cur || {};
    return {
      region: region, builtAt: idx.builtAt, fetchedAt: idx.fetchedAt, source: got.source, stale: got.stale,
      timings: got.source === "network" ? lastFetchMs : null,
      // A support main is not on the DPS board, so it gets no estimated place there either.
      dps: cur.supportMain && idx.dps.n.indexOf(nameLower) < 0 ? null : place(idx.dps, nameLower, cur.dmg),
      sup: SUPPORT_CLASSES[m.cls] ? place(idx.sup, nameLower, cur.pdmg) : null
    };
  });
}

self.onmessage = function (e) {
  var m = e.data || {};
  var reply = function (ok, payload) {
    var msg = { id: m.id, ok: ok };
    if (ok) msg.result = payload; else msg.error = payload;
    self.postMessage(msg);
  };
  try {
    if (m.type === "score") { reply(true, scoreOne(m.gems, m.cls)); return; }
    if (m.type === "rank") {
      rankOne(m).then(function (r) { reply(true, r); }, function (err) {
        reply(false, { message: (err && err.message) || String(err), rateLimited: !!(err && err.rateLimited),
          deferred: !!(err && err.deferred) });
      });
      return;
    }
    reply(false, { message: "unknown message " + m.type });
  } catch (err) {
    reply(false, { message: (err && err.message) || String(err) });
  }
};
