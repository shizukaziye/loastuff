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
 *       axes -> the board quality (the rank comes from the Worker, below).
 *   loa-astrogem-calc/grader.js  gGrade / gRank / gRel and the core grouping ->
 *       each gem's grade, letter and % damage, the per-core figures, the plain
 *       average grade and the "Total % dmg" (gridDamage) the grader shows.
 *
 * THE GRID BREAKDOWN is the model's own gridDamage called on the same gems with
 * everything but one part set to zero: one effect family's levels, or every
 * core's points. The model adds those parts up in its total (a sum of
 * 100·ln terms), so the parts sum to the total exactly, and no formula is copied.
 *
 * THE RANK comes from the Worker's slim board index, GET /board-slim?region=
 * (~270 KB gzipped per region, where the whole ?list=1 snapshot this worker
 * used to score itself was 2.6 MB): each row's name, class and the two boards'
 * sort keys, already scored by the Worker with the same model calls. This
 * worker only sorts it into the two boards, per region, and keeps that 30
 * minutes in memory and in the Cache API; the board rebuilds at most every 30
 * minutes. It still runs off the main thread: the grid table (job 1) and a
 * 600 KB parse are no work for the page's own thread.
 *
 * Messages in:  {id, type:"score", gems, cls}
 *               {id, type:"rank", region, name, cls, cur:{dmg,pdmg,supportMain}, maxAgeMs, offline}
 *               -> {region, builtAt, fetchedAt, source, stale, timings, dps, sup}, each board
 *               {rank, count, estimated, key, cls:{name, rank, count}|null} or null
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
var SLIM_URL = "https://astrogem-bible.shizukaziye.workers.dev/board-slim?region=";
var CACHE_NAME = "loseii-profile-v1";
var INDEX_TTL_MS = 30 * 60 * 1000;
var INDEX_V = 2;       // 2: built from /board-slim, with each row's class
var REGIONS = ["NA", "EU"];     // the regions the profile serves; the board's KR chip is not one of them

// ---- copied from loa-astrogem-calc/leaderboard.js --------------------------

var SUPPORT_CLASSES = { "Bard": 1, "Paladin": 1, "Artist": 1, "Valkyrie": 1 };
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
 * One region's /board-slim answer -> its two boards, each as parallel arrays
 * of lower-cased names, sort keys and class indexes. The contract (§9b of
 * loa-astrogem-calc/docs/how-the-queue-and-drain-work.md): the DPS board is the
 * rows with a dps key that are not support mains, the Support board the rows
 * with a sup key, each stable-sorted by its key, highest first. The rows come
 * in snapshot order, which is the board's tie-break (~250 exact ties per
 * region), and Array.prototype.sort is stable, so the order is the board's.
 */
function buildIndex(data, fetchedAt) {
  var rows = data.rows || [], dps = [], sup = [], i;
  for (i = 0; i < rows.length; i++) {
    var a = rows[i];
    if (!a) continue;
    var c = { n: String(a[0] || "").toLowerCase(), c: typeof a[1] === "number" ? a[1] : -1,
      d: typeof a[2] === "number" ? a[2] : null, s: typeof a[3] === "number" ? a[3] : null };
    if (c.d != null && !a[4]) dps.push(c);
    if (c.s != null) sup.push(c);
  }
  dps.sort(function (x, y) { return y.d - x.d; });
  sup.sort(function (x, y) { return y.s - x.s; });
  function cols(list, key) {
    return { n: list.map(function (c) { return c.n; }), v: list.map(function (c) { return c[key]; }),
      c: list.map(function (c) { return c.c; }) };
  }
  return {
    v: INDEX_V, region: data.region, builtAt: data.builtAt || 0, fetchedAt: fetchedAt,
    classes: Array.isArray(data.classes) ? data.classes : [],
    dps: cols(dps, "d"), sup: cols(sup, "s")
  };
}
function readableSlim(d, region) {
  return !!(d && d.v === 1 && d.region === region && Array.isArray(d.rows) && d.rows.length);
}

var mem = {};           // region -> index
var inflight = {};      // region -> the one download in progress, shared by every caller
var lastFetchMs = {};   // region -> timings of its last download, for the page's perf readout

function cacheKey(region) { return new Request("/profile/__cache/ag-slim-" + region); }
function cacheOpen() {
  try { return self.caches ? self.caches.open(CACHE_NAME) : Promise.resolve(null); }
  catch (e) { return Promise.resolve(null); }
}
/** The saved /board-slim answer for a region, rebuilt into its index. */
function readCached(region) {
  return cacheOpen().then(function (c) {
    return c ? c.match(cacheKey(region)) : null;
  }).then(function (resp) {
    if (!resp) return null;
    var at = Number(resp.headers.get("X-Fetched-At")) || 0;
    return resp.json().then(function (data) { return readableSlim(data, region) ? buildIndex(data, at) : null; });
  }).catch(function () { return null; });
}
function writeCached(region, txt, at) {
  return cacheOpen().then(function (c) {
    if (!c) return;
    // the full-board index this worker kept until 2026-09-25; it is never read again
    c.delete(new Request("/profile/__cache/ag-index-" + region)).catch(function () {});
    return c.put(cacheKey(region), new Response(txt, { headers: { "Content-Type": "application/json", "X-Fetched-At": String(at) } }));
  }).catch(function () {});
}

/**
 * Download one region's slim index. `cache: "no-cache"` makes the browser
 * revalidate its HTTP-cache copy with the ETag the Worker sent (a bodiless 304
 * when the board has not rebuilt) rather than trust max-age: this worker has
 * already decided its own copy is too old. The browser adds If-None-Match
 * itself; the page may not (the Worker's CORS allowlist has no such header, so
 * setting it here would cost a preflight that fails).
 */
function download(region) {
  if (inflight[region]) return inflight[region];
  var t0 = Date.now(), tf = 0, tp = 0;
  var p = fetch(SLIM_URL + region, { cache: "no-cache" }).then(function (resp) {
    return resp.text().then(function (txt) {
      tf = Date.now();
      var data = null;
      try { data = JSON.parse(txt); } catch (e) {}
      if (!resp.ok || !readableSlim(data, region)) {
        var err = new Error((data && (data.error || data.message)) || ("The astrogem board answered " + resp.status + "."));
        err.rateLimited = !!(data && data.rateLimited) || resp.status === 429;
        throw err;
      }
      tp = Date.now();
      var at = Date.now(), idx = buildIndex(data, at);
      lastFetchMs[region] = { fetch: tf - t0, parse: tp - tf, score: Date.now() - tp, chars: txt.length, rows: data.rows.length };
      mem[region] = idx;
      writeCached(region, txt, at);
      return idx;
    });
  });
  inflight[region] = p;
  p.then(function () { inflight[region] = null; }, function () { inflight[region] = null; });
  return p;
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
    download(region).then(function () { self.postMessage({ type: "index-updated", region: region }); }, function () {});
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
    return download(region).then(function (idx) {
      return { idx: idx, source: "network", stale: false };
    });
  });
}

/** A class name as a key: "Guardian Knight" and "Guardianknight" are one class. */
function classKey(s) { return String(s == null ? "" : s).replace(/[^A-Za-z]/g, "").toLowerCase(); }
function classIndexOf(idx, cls) {
  var k = classKey(cls);
  if (!k) return -1;
  for (var i = 0; i < idx.classes.length; i++) if (classKey(idx.classes[i]) === k) return i;
  return -1;
}

/**
 * One board, one name: its place in board order, or where its value would land.
 * cls: the character's place among the rows of its own class on the same board
 * {name, rank, count}, or null when there is no class to go by.
 */
function place(idx, board, nameLower, mine, clsIdx) {
  var i = board.n.indexOf(nameLower), k, ci, cRank = 0, cCount = 0;
  if (i >= 0) {
    ci = board.c[i];
    if (ci >= 0) {
      for (k = 0; k < board.c.length; k++) if (board.c[k] === ci) { cCount++; if (k <= i) cRank++; }
    }
    return { rank: i + 1, count: board.n.length, estimated: false, key: board.v[i],
      cls: ci >= 0 ? { name: idx.classes[ci] || null, rank: cRank, count: cCount } : null };
  }
  if (typeof mine !== "number" || !isFinite(mine)) return null;
  // Not on the board yet: every row keeps its place and this one goes in behind
  // the rows strictly above it. (The rebuild appends a new character, so on the
  // board it would lose an exact tie; its key is computed here in the browser
  // and the board's on the Worker, which can differ in the last bit, so an
  // exact tie cannot be told apart here and this one takes the better place.)
  var better = 0;
  ci = typeof clsIdx === "number" ? clsIdx : -1;
  for (k = 0; k < board.v.length; k++) {
    var up = board.v[k] != null && board.v[k] > mine;
    if (up) better++;
    if (ci >= 0 && board.c[k] === ci) { cCount++; if (up) cRank++; }
  }
  return { rank: better + 1, count: board.n.length + 1, estimated: true, key: mine,
    cls: ci >= 0 ? { name: idx.classes[ci] || null, rank: cRank + 1, count: cCount + 1 } : null };
}

function rankOne(m) {
  var region = REGIONS.indexOf(m.region) >= 0 ? m.region : "NA";
  var nameLower = String(m.name || "").toLowerCase();
  return getIndex(region, m.maxAgeMs, !!m.offline).then(function (got) {
    var idx = got.idx, cur = m.cur || {}, ci = classIndexOf(idx, m.cls);
    return {
      region: region, builtAt: idx.builtAt, fetchedAt: idx.fetchedAt, source: got.source, stale: got.stale,
      timings: got.source === "network" ? (lastFetchMs[region] || null) : null,
      // A support main is not on the DPS board, so it gets no estimated place there either.
      dps: cur.supportMain && idx.dps.n.indexOf(nameLower) < 0 ? null : place(idx, idx.dps, nameLower, cur.dmg, ci),
      sup: SUPPORT_CLASSES[m.cls] ? place(idx, idx.sup, nameLower, cur.pdmg, ci) : null
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
