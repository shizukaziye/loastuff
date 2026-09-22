/**
 * ag-worker.js — the profile page's astrogem arithmetic, off the main thread.
 *
 * Every number comes from the astrogem calculator's own model,
 * loa-astrogem-calc/model/astrogem.js, imported below at the pin that tool's
 * index.html uses. Nothing here re-derives a formula; the functions that turn a
 * gem list into a board row are copied from loa-astrogem-calc/leaderboard.js
 * line for line (validGemsOf, valueToGrade, the two axes, the board filters and
 * the sort), because a rank that disagreed with the board would be worse than
 * none.
 *
 * TWO JOBS
 *   score  one character's gems -> quality (the board's "Quality" 0-110), its
 *          letter, the grid's total damage, on both axes; plus how many gems
 *          sit at each in-game grade (Legendary / Relic / Ancient, from
 *          classifyTier(levelSum)).
 *   rank   where that character sits on the astrogem board of its region.
 *
 * WHY A WORKER. The board is the ?list=1&fmt=2 snapshot: ~2.5 MB gzipped, 12 MB
 * of JSON, ~24,000 characters, all of which have to be scored to know one rank.
 * Parsing and scoring it costs ~0.3 s of CPU, which would freeze the page. It is
 * reduced here to a per-region INDEX — each board's names in board order and
 * each board's sort key — and the index is kept for 30 minutes in memory and in
 * the Cache API, since the board itself rebuilds at most every 30 minutes. A
 * second profile inside that window pays nothing.
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

importScripts("/loa-astrogem-calc/model/astrogem.js?v=62");

var A = self.Astrogem;
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

// ---- job 1: one character ---------------------------------------------------

function coreKey(g) {
  if (g.coreBase != null) return g.coreBase;
  return g.slot != null ? g.slot : 0;
}

function scoreOne(gems, cls) {
  gems = Array.isArray(gems) ? gems : [];
  var valid = validGemsOf(gems);
  var tiers = { legendary: 0, relic: 0, ancient: 0 }, cores = {}, nCores = 0, order = 0, chaos = 0;
  for (var i = 0; i < gems.length; i++) {
    var g = gems[i];
    tiers[A.classifyTier(A.levelSum(g))]++;
    var k = coreKey(g);
    if (!cores[k]) { cores[k] = 1; nCores++; }
    if (g.gemType === "chaos") chaos++; else order++;
  }
  var res = { gems: gems.length, valid: valid.length, tiers: tiers, cores: nCores, order: order, chaos: chaos,
    dps: null, sup: null, supportClass: !!SUPPORT_CLASSES[cls], supportMain: false };
  if (!valid.length) return res;
  var ax = axes(valid, true);
  var dCol = A.gradeColor(ax.avg), sCol = A.gradeColor(ax.savg);
  res.dps = { quality: ax.avg, letter: A.rankFromGrade(ax.avg), dmg: ax.dmg, bg: dCol.bg, fg: dCol.fg };
  res.sup = { quality: ax.savg, letter: supRank(ax.savg), dmg: ax.pdmg, bg: sCol.bg, fg: sCol.fg };
  res.supportMain = !!(SUPPORT_CLASSES[cls] && isSupportMain({ avg: ax.avg, savg: ax.savg }));
  return res;
}

// ---- job 2: the board index --------------------------------------------------

/**
 * The snapshot -> {NA:index, EU:index}. The board's own order of operations:
 * decode every row, score both axes, then per board filter and sort. The sort
 * is Array.prototype.sort, stable, over rows in payload order — the board's
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
