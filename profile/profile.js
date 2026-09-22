/**
 * profile.js — loseii character profiles, served at /<REGION>/<Name>.
 *
 * One static page (profile/index.html) serves every character: _redirects
 * rewrites /NA/*, /EU/* and /CE/* (and their lower-case spellings) to /profile/,
 * and this file reads the region and the name back out of the address. EU is the
 * spelling the page settles on; CE (lostark.bible's) is accepted and replaced.
 *
 * WHERE EVERY NUMBER COMES FROM — nothing on this page is scored its own way.
 *   header      bracelet-bible GET /character: class, item level, pulledAt.
 *   bracelet    the bracelet board, GET /list: the row carries the Worker's
 *               finished numbers (damage %, the 0-100 grade, the decoded lines),
 *               and the letter is subrank.js's ladder — the same row, letter and
 *               order the bracelet leaderboard draws. Rank = place on the
 *               region's board; a support class is read on whichever board the
 *               Worker's better-letter rule picked (row slot 6).
 *               A character the board does not hold yet (a new pull, a fresh
 *               Update) is scored HERE with the calculator's own model files and
 *               a port of the Worker's snapshotEntry(), and its place is marked
 *               estimated until the board rebuilds (every 10 minutes at most).
 *   astrogems   astrogem-bible GET /?region&name for the gems; quality, letter,
 *               total damage and the board rank come from ag-worker.js, which
 *               runs the astrogem calculator's own model/astrogem.js exactly as
 *               loa-astrogem-calc/leaderboard.js does.
 *   stats       the record's `profile` block for the raid loadout — the block
 *               the bracelet calculator imports into its deck.
 *
 * SPEED (docs/design/PROFILE-GAMEPLAN.md §2)
 *   - the skeleton is static HTML at its final size, painted before any script;
 *   - the last copy of each character lives in localStorage (lp_char:REGION|Name)
 *     and is painted before any request, then every part revalidates;
 *   - the record, the gems and the bracelet board are requested together; the
 *     bracelet board is kept 10 minutes in the Cache API, the 2.5 MB astrogem
 *     board 30 minutes (in ag-worker.js);
 *   - moving between characters is pushState + render, and Back works.
 *   performance marks: every milestone is `lp:<name>`; window.__lpPerf() returns
 *   them per navigation, with layout shift and first paint.
 *
 * HAND-OFF TO THE TOOLS. Whenever a bracelet record arrives from the network it
 * is also written to localStorage `loseii.profile.record:<REGION>|<Name>` as
 * {record, savedAt}, with the astrogem service's answer for the same character
 * at record.astrogem, so a tool opened with ?c=REGION:Name can boot from it
 * without a Worker trip. REGION there is NA or EU, as in the ?c= links.
 *
 * PRERENDER-SAFE. index.html's speculation rules let the browser build this page
 * before it is shown. While document.prerendering is true the page only reads
 * and draws: the queue=1 lookup (which can enqueue a pull), /wait, the board
 * download and every storage write wait for `prerenderingchange`.
 *
 * BACK/FORWARD CACHE. No unload handlers; on pagehide every request in flight is
 * dropped (Chrome will not keep a page with an open fetch, and /wait holds one
 * for 25 s), and a page restored from the cache reloads its parts from the
 * copies it already has. pageshow.persisted is logged in window.__lpPerf().
 *
 * Plain ES5 syntax, no build, no framework.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------------ config

  var BR_API = "https://bracelet-bible.shizukaziye.workers.dev";
  var AG_API = "https://astrogem-bible.shizukaziye.workers.dev";
  var AG_WORKER = "/profile/ag-worker.js?v=1";
  // The bracelet calculator's own model, for a character the board does not hold
  // yet. subrank.js is loaded again AFTER the model: it captures window.Bracelet
  // when it runs, and the copy index.html loaded ran before the model existed.
  var BR_MODEL = ["/loa-bracelet-calc/data/gear-data.js?v=4",
    "/loa-bracelet-calc/model/bracelet.js?v=14",
    "/loa-bracelet-calc/subrank.js?v=9"];
  var ICONS = "/loa-bracelet-calc/assets/class-icons/";

  var REGIONS = ["NA", "EU"];
  var REGION_GLOSS = { NA: "North America", EU: "Europe Central (lostark.bible calls it CE)" };
  var UPDATE_COOLDOWN_MS = 5 * 60 * 1000;
  var BOARD_TTL_MS = 10 * 60 * 1000;          // the bracelet board rebuilds at most every 10 minutes
  var AG_INDEX_TTL_MS = 30 * 60 * 1000;       // the astrogem board, every 30
  var BOARD_WAIT_MS = 2500;                   // a record waits this long for the board, then scores here
  var WATCH_MAX_MS = 10 * 60 * 1000;
  var STALE_MS = 7 * 24 * 3600 * 1000;        // the Worker calls a record stale past a week
  var CACHE_NAME = "loseii-profile-v1";

  var K_RECENT = "lp_recent";
  var K_FAVS = "bc_favs";                     // the bracelet tool's favourites, same shape
  var K_CHAR = "lp_char:";
  var K_RECORD = "loseii.profile.record:";
  var RECENT_MAX = 12, CHAR_KEEP = 40, RECORD_KEEP = 20, VIEW_V = 1;

  // Browsers without speculation rules get a plain prefetch of a tool on hover.
  var SPEC_RULES = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules"));

  var TIER_WORD = { low: "Heroic", mid: "Epic", high: "Legendary" };     // app.js's words
  var TIER_COLOR = { low: "#5aa9e6", mid: "#c78cff", high: "#ffb86b" };  // app.js's colours
  var TRAIT_LABEL = { crit: "Crit", spec: "Specialization", swiftness: "Swiftness", swift: "Swiftness",
    domination: "Domination", endurance: "Endurance", expertise: "Expertise" };
  // The short forms the calculator's own keys use; the full names ride in the tooltip.
  var TRAIT_SHORT = { crit: "Crit", spec: "Spec", swiftness: "Swift", swift: "Swift",
    domination: "Dom", endurance: "End", expertise: "Exp" };
  var CLASS_ICONS = ("Aeromancer Arcanist Artillerist Artist Bard Berserker Breaker Deadeye Deathblade " +
    "Destroyer Glaivier Guardianknight Gunlancer Gunslinger Machinist Paladin Reaper Scrapper " +
    "Shadowhunter Sharpshooter Slayer Sorceress Souleater Soulfist Striker Summoner Valkyrie " +
    "Wardancer Wildsoul").split(" ");
  var CLASS_ICON_BY_KEY = {};
  for (var ci = 0; ci < CLASS_ICONS.length; ci++) CLASS_ICON_BY_KEY[CLASS_ICONS[ci].toLowerCase()] = CLASS_ICONS[ci];
  var CLASS_LABEL = { Guardianknight: "Guardian Knight" };
  var SUPPORT_KEYS = { bard: 1, paladin: 1, artist: 1, valkyrie: 1 };   // the Worker's SUPPORT_CLASSES
  var AG_ORD = { "F-": 0, "F": 1, "F+": 2, "D-": 3, "D": 4, "D+": 5, "C-": 6, "C": 7, "C+": 8,
    "B-": 9, "B": 10, "B+": 11, "A-": 12, "A": 13, "A+": 14, "S-": 15, "S": 16, "S+": 17 };
  var LOADOUT_LABELS = { most_recent_raid: "Raid", most_recent_chaos_dungeon: "Chaos", raid_merged: "Est. Raid" };
  var LOADOUT_PREF = { most_recent_raid: 0, raid_merged: 1, most_recent_chaos_dungeon: 3 };  // the calculator opens on the raid tab

  // ------------------------------------------------------------------ small helpers

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function now() { return Date.now(); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function fx(n, d) { return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function commas(s) {
    var p = String(s).split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function nf(n, d) { return isNum(n) ? commas(d ? fx(n, d) : String(Math.round(n))) : "—"; }
  function r2(x) { return isNum(x) ? Math.round(x * 1e2) / 1e2 : null; }
  function r3(x) { return isNum(x) ? Math.round(x * 1e3) / 1e3 : null; }
  function extend(a, b) { for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; return a; }

  /** Compact age, the tools' wording. */
  function ageLabel(t) {
    if (!t) return "";
    var mins = Math.floor(Math.max(0, now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }
  function inLabel(ms) {
    var mins = Math.ceil(ms / 60000);
    return mins <= 1 ? "in a minute" : "in " + mins + "m";
  }
  function topPct(rank, count) {
    if (!rank || !count) return "";
    var p = 100 * rank / count;
    return "top " + (p < 10 ? (Math.ceil(p * 10) / 10).toFixed(1) : String(Math.ceil(p))) + "%";
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsJson(k) { var s = lsGet(k); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }

  /** Keep the newest `keep` entries under a prefix; each value carries savedAt. */
  function prune(prefix, keep) {
    try {
      var items = [], i;
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) {
          var t = 0;
          try { t = JSON.parse(localStorage.getItem(k)).savedAt || 0; } catch (e) {}
          items.push([k, t]);
        }
      }
      if (items.length <= keep) return;
      items.sort(function (a, b) { return b[1] - a[1]; });
      for (i = keep; i < items.length; i++) localStorage.removeItem(items[i][0]);
    } catch (e) {}
  }
  var pruneTimer = null;
  function pruneSoon() {
    if (pruneTimer) return;
    pruneTimer = setTimeout(function () { pruneTimer = null; prune(K_CHAR, CHAR_KEEP); prune(K_RECORD, RECORD_KEEP); }, 4000);
  }

  // ------------------------------------------------------------------ performance

  var PERF = { loads: [], cls: 0, fcp: null, pageshows: [], prerendered: false, activationStart: null };
  var perfNav = null;
  function pnow() { return (window.performance && performance.now) ? performance.now() : 0; }
  function perfStart(kind, path) {
    perfNav = { kind: kind, path: path, t0: kind === "load" ? 0 : Math.round(pnow()), marks: {} };
    PERF.loads.push(perfNav);
  }
  /** First occurrence of each milestone per navigation, in ms since that navigation began. */
  function mark(name) {
    if (!perfNav) return;
    if (!(name in perfNav.marks)) perfNav.marks[name] = Math.round(pnow() - perfNav.t0);
    try { if (perfNav.kind === "load") performance.mark("lp:" + name); } catch (e) {}
  }
  window.__lpPerf = function () { return JSON.parse(JSON.stringify(PERF)); };
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { if (!e.hadRecentInput) PERF.cls = Math.round((PERF.cls + e.value) * 1e4) / 1e4; });
    }).observe({ type: "layout-shift", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { if (e.name === "first-contentful-paint") PERF.fcp = Math.round(e.startTime); });
    }).observe({ type: "paint", buffered: true });
  } catch (e) {}

  // ------------------------------------------------------------------ prerender

  function prerendering() { return document.prerendering === true; }
  var onShown = [];
  /** Run now, or once a prerendered page is actually shown. */
  function whenShown(fn) { if (!prerendering()) fn(); else onShown.push(fn); }
  if (prerendering()) PERF.prerendered = true;
  document.addEventListener("prerenderingchange", function () {
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.activationStart != null) PERF.activationStart = Math.round(nav.activationStart);
    } catch (e) {}
    var q = onShown;
    onShown = [];
    q.forEach(function (fn) { try { fn(); } catch (e) {} });
  });

  // ------------------------------------------------------------------ region, name, address

  function normRegion(r) {
    var s = String(r == null ? "" : r).trim().toUpperCase();
    if (s === "NA" || s === "NAE" || s === "NAW" || s === "US") return "NA";
    if (s === "EU" || s === "CE" || s === "EUC") return "EU";
    return "";
  }
  /** bracelet-bible spells EU Central the way lostark.bible does. */
  function bibleRegion(r) { return normRegion(r) === "EU" ? "CE" : "NA"; }
  /** The Worker's own display rule: Roman-script names in Title case, Hangul untouched. */
  function normalizeName(name) {
    name = String(name == null ? "" : name).replace(/\s+/g, " ").trim();
    if (!name || /[가-힣㄰-㆏]/.test(name)) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  function charPath(region, name) { return "/" + region + "/" + encodeURIComponent(name); }
  function cParam(region, name) { return "c=" + region + ":" + encodeURIComponent(name); }

  function parsePath(path) {
    var m = /^\/([^\/]+)(?:\/([^\/]*))?/.exec(path || "");
    if (!m || m[1].toLowerCase() === "profile") return { kind: "find" };
    var region = normRegion(m[1]);
    var raw = m[2] || "", name = raw;
    try { name = decodeURIComponent(raw); } catch (e) {}
    name = normalizeName(name);
    if (!region) return { kind: "find", note: "region", bad: m[1] };
    if (!name) return { kind: "find", region: region, note: "noname" };
    if (name.length > 40 || /[\/\\<>"?#%]/.test(name)) return { kind: "find", region: region, note: "badname" };
    return { kind: "char", region: region, name: name };
  }

  // ------------------------------------------------------------------ favourites (bc_favs) and recents

  /** favorites.js parseList: [{region, name}], CE healed to EU, case-insensitive de-dupe. */
  function favList() {
    var raw = lsJson(K_FAVS), out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i];
      if (!it || it.name == null) continue;
      var region = String(it.region == null ? "" : it.region).toUpperCase();
      if (region === "CE") region = "EU";
      if (favIndex(out, region, it.name) === -1) out.push({ region: region, name: String(it.name) });
    }
    return out;
  }
  function nkey(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function favIndex(list, region, name) {
    for (var i = 0; i < list.length; i++) {
      if (nkey(list[i].region) === nkey(region) && nkey(list[i].name) === nkey(name)) return i;
    }
    return -1;
  }
  function favHas(region, name) { return favIndex(favList(), region, name) !== -1; }
  function favToggle(region, name) {
    var list = favList(), i = favIndex(list, region, name);
    if (i === -1) list.push({ region: String(region).toUpperCase(), name: String(name) });
    else list.splice(i, 1);
    lsSet(K_FAVS, JSON.stringify(list));
    return i === -1;
  }
  function recentList() {
    var raw = lsJson(K_RECENT);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) { return r && normRegion(r.region) && r.name; });
  }
  function addRecent(region, name) {
    var list = recentList().filter(function (r) { return !(normRegion(r.region) === region && nkey(r.name) === nkey(name)); });
    list.unshift({ region: region, name: name, t: now() });
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    lsSet(K_RECENT, JSON.stringify(list));
  }
  /** A name that turned out not to exist leaves the recents row. */
  function dropRecent(region, name) {
    whenShown(function () {
      var list = recentList().filter(function (r) { return !(normRegion(r.region) === region && nkey(r.name) === nkey(name)); });
      lsSet(K_RECENT, JSON.stringify(list));
      renderQuick();
    });
  }

  // ------------------------------------------------------------------ network

  var gen = 0;          // bumps on every navigation; anything from an older one is dropped
  var cur = null;       // the character on screen

  function isLive(ctx) { return !!ctx && ctx === cur && ctx.gen === gen; }

  /** GET -> {ok, status, data}. Aborted when the reader moves to another character. */
  function getJson(url, ctx) {
    var ctl = null, opts = {};
    try { ctl = new AbortController(); opts.signal = ctl.signal; } catch (e) {}
    if (ctl && ctx) ctx.aborts.push(ctl);
    return fetch(url, opts).then(function (resp) {
      return resp.text().then(function (txt) {
        var data = null;
        try { data = JSON.parse(txt); } catch (e) {}
        return { ok: resp.ok, status: resp.status, data: data };
      });
    });
  }
  function fetchCharacter(ctx, refresh) {
    return getJson(BR_API + "/character?region=" + bibleRegion(ctx.region) + "&name=" +
      encodeURIComponent(ctx.name) + "&queue=1&pos=1" + (refresh ? "&refresh=1" : ""), ctx);
  }
  function hasBracelet(d) {
    return !!(d && d.bracelet && Array.isArray(d.bracelet.stats) && d.bracelet.stats.length);
  }

  function cacheOpen() {
    try { return window.caches ? window.caches.open(CACHE_NAME) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  function cacheReq(name) { return new Request("/profile/__cache/" + name); }

  /** Load classic scripts in order; resolves when the last one has run. */
  function loadScripts(list) {
    return list.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = src;
          s.onload = function () { resolve(); };
          s.onerror = function () { reject(new Error("could not load " + src)); };
          document.body.appendChild(s);
        });
      });
    }, Promise.resolve());
  }

  // ------------------------------------------------------------------ the bracelet board (GET /list)

  var CATS = ["special", "basic", "trait"], TIERS = ["low", "mid", "high"];
  var BASIC_FAMS = ["mainStat", "vitality"], TRAIT_FAMS = ["crit", "spec", "swiftness"];

  function unlines(flat) {
    var out = [];
    flat = flat || [];
    for (var i = 0; i + 3 < flat.length; i += 4) {
      var cat = CATS[flat[i]] || "special";
      var line = { cat: cat, fixed: !!flat[i + 3], tier: null, value: null, family: null };
      if (cat === "special") { line.family = flat[i + 1]; line.tier = TIERS[flat[i + 2]] || null; }
      else { line.family = (cat === "basic" ? BASIC_FAMS : TRAIT_FAMS)[flat[i + 1]] || null; line.value = flat[i + 2]; }
      out.push(line);
    }
    return out;
  }
  function untraits(flat) {
    var out = [];
    flat = flat || [];
    for (var i = 0; i + 1 < flat.length; i += 2) out.push({ family: TRAIT_FAMS[flat[i]] || null, value: flat[i + 1] });
    return out;
  }
  function pctKey(reading) { return reading && reading.pct != null ? reading.pct : -Infinity; }
  function srOf(score, axis) {
    var SR = window.Subrank;
    return (SR && isNum(score)) ? SR.of(score, axis === "support" ? "support" : "dps") : null;
  }
  /** leaderboard.js isSupportMain: support reading two or more subranks above the dealer one. */
  function brSupportMain(r) {
    if (!r.sup || !r.dps || r.sup.score == null || r.dps.score == null) return false;
    var d = srOf(r.dps.score, "dps"), s = srOf(r.sup.score, "support");
    return !!(d && s && d.i - s.i >= 2);
  }

  /**
   * The v3 payload -> rows plus each region's two boards, in the board's order.
   * leaderboard.js fromSnapshot() + rebuild(), with the region chips set to one
   * region and no class filter: DPS = every row with a dealer reading minus
   * support mains, Support = the four support classes; each sorted by its own
   * damage % with a stable sort over payload order.
   */
  function buildBoard(data, fetchedAt, source) {
    var classes = data.classes || [], labels = data.labels || [];
    var rows = [], byKey = {}, chars = data.characters || [], i, j;
    for (i = 0; i < chars.length; i++) {
      var a = chars[i], read = a[7] || [], alt = a[8], lo = a[12];
      var won = { pct: isNum(read[0]) ? read[0] : null, score: isNum(read[1]) ? read[1] : null, isPerfect: !!read[2] };
      var lost = (alt && isNum(alt[0])) ? { pct: alt[0], score: isNum(alt[1]) ? alt[1] : null, isPerfect: false } : null;
      var supWon = a[6] === 1;
      var row = {
        ord: i,   // payload order: the board's tie-break
        region: normRegion(a[0]), name: a[1], n: String(a[1] || "").toLowerCase(),
        cls: (a[3] != null && a[3] >= 0) ? (classes[a[3]] || null) : null,
        ilvl: isNum(a[2]) ? a[2] : null, pulledAt: isNum(a[4]) ? a[4] : null,
        grade: a[5] === 1 ? "relic" : "ancient", role: supWon ? "support" : "dps",
        dps: supWon ? lost : won, sup: supWon ? won : lost,
        traits: untraits(a[9]), lines: unlines(a[10]), unmapped: a[11] || 0, lo: null
      };
      if (lo && lo.length === 3) {
        row.lo = { distinct: lo[0] || 1, best: lo[1] || 0, items: [] };
        for (j = 0; j + 1 < lo[2].length; j += 2) {
          row.lo.items.push({ label: (lo[2][j] >= 0 && labels[lo[2][j]]) || ("Loadout " + (row.lo.items.length + 1)),
            pct: isNum(lo[2][j + 1]) ? lo[2][j + 1] : null });
        }
      }
      rows.push(row);
      if (row.region) byKey[row.region + "|" + row.n] = row;
    }
    var lists = {};
    REGIONS.forEach(function (R) {
      var inR = rows.filter(function (r) { return r.region === R; });
      var dps = inR.filter(function (r) { return !!r.dps && !brSupportMain(r); });
      dps.sort(function (x, y) { return pctKey(y.dps) - pctKey(x.dps); });
      var sup = inR.filter(function (r) { return !!r.sup; });
      sup.sort(function (x, y) { return pctKey(y.sup) - pctKey(x.sup); });
      lists[R] = { dps: dps, support: sup };
    });
    return { byKey: byKey, lists: lists, builtAt: data.builtAt || 0, fetchedAt: fetchedAt, source: source, stale: false };
  }
  function readableBoard(d) { return !!(d && d.v === 3 && Array.isArray(d.characters) && d.characters.length); }

  var board = null, boardInflight = null, boardCtl = null;

  /**
   * The board: memory, then the Cache API, then the Worker; an old copy beats none.
   * cacheOnly (a prerendered page): any saved copy, whatever its age, and never
   * the network. With nothing saved it fails {deferred:true}.
   */
  function getBoard(opts) {
    opts = opts || {};
    if (board && now() - board.fetchedAt < BOARD_TTL_MS) return Promise.resolve(board);
    if (opts.cacheOnly && board) return Promise.resolve(board);
    if (boardInflight && !opts.cacheOnly) return boardInflight;
    var cached = null;
    var p = cacheOpen().then(function (c) {
      return c ? c.match(cacheReq("br-board")) : null;
    }).then(function (resp) {
      if (!resp) return null;
      var at = Number(resp.headers.get("X-Fetched-At")) || 0;
      return resp.json().then(function (data) { return { data: data, at: at }; });
    }).catch(function () { return null; }).then(function (hit) {
      cached = hit;
      if (hit && readableBoard(hit.data) && (opts.cacheOnly || now() - hit.at < BOARD_TTL_MS)) {
        board = buildBoard(hit.data, hit.at, "cache");
        return board;
      }
      if (opts.cacheOnly) { var d = new Error("deferred"); d.deferred = true; throw d; }
      var fo = {};
      try { boardCtl = new AbortController(); fo.signal = boardCtl.signal; } catch (e) { boardCtl = null; }
      return fetch(BR_API + "/list", fo).then(function (resp) {
        return resp.text().then(function (txt) {
          var data = null;
          try { data = JSON.parse(txt); } catch (e) {}
          if (resp.ok && readableBoard(data)) {
            var at = now();
            cacheOpen().then(function (c) {
              if (c) return c.put(cacheReq("br-board"), new Response(txt, { headers: { "Content-Type": "application/json", "X-Fetched-At": String(at) } }));
            }).catch(function () {});
            board = buildBoard(data, at, "network");
            return board;
          }
          var err = new Error((data && (data.message || data.error)) || ("The bracelet board answered " + resp.status + "."));
          err.rateLimited = !!(data && data.rateLimited);
          throw err;
        });
      }).catch(function (err) {
        if (err && err.name === "AbortError") throw err;
        if (board) { board.stale = true; return board; }
        if (cached && readableBoard(cached.data)) {
          board = buildBoard(cached.data, cached.at, "cache");
          board.stale = true;
          return board;
        }
        throw err;
      });
    });
    if (!opts.cacheOnly) {
      boardInflight = p;
      p.then(function () { boardInflight = null; boardCtl = null; }, function () { boardInflight = null; boardCtl = null; });
    }
    return p;
  }

  // ------------------------------------------------------------------ the bracelet model (off-board only)

  var modelPromise = null;
  function loadBraceletModel() {
    if (!modelPromise) {
      modelPromise = loadScripts(BR_MODEL).then(function () {
        if (!window.Bracelet || !window.Subrank || !window.Subrank.braceletScore) throw new Error("model missing");
      });
      modelPromise.then(null, function () { modelPromise = null; });
    }
    return modelPromise;
  }

  // Ported from worker/bracelet.js — decodeWithGradeCheck, boardScore and
  // snapshotEntry — so a character the board has not reached yet gets the very
  // numbers the board will give it. Same model files, same arithmetic.
  var TRAIT_TO_APP = { crit: "crit", spec: "spec", swiftness: "swift" };
  var TRAIT_CAP = { relic: 100, ancient: 120 };
  var PROFILES = null;
  function profiles() {
    if (!PROFILES) PROFILES = { dps: window.Bracelet.normalizeProfile({}), support: window.Bracelet.normalizeProfile({ role: "support" }) };
    return PROFILES;
  }
  function slotChoices(grade) { return grade === "relic" ? [1, 2] : [2, 3]; }
  function traitsBreakCap(dec, grade) {
    for (var i = 0; i < dec.lines.length; i++) if (dec.lines[i].cat === "trait" && dec.lines[i].value > TRAIT_CAP[grade]) return true;
    return false;
  }
  function unplaced(dec) {
    var n = 0;
    for (var i = 0; i < dec.lines.length; i++) {
      var l = dec.lines[i];
      if (l.cat === "special" && (!l.tier || l.unmatchedValue)) n++;
    }
    return n;
  }
  function decodeWithGradeCheck(stats) {
    var Br = window.Bracelet, i;
    var dec = Br.decodeBibleBracelet(stats);
    if (traitsBreakCap(dec, dec.grade)) {
      var forced = dec.grade === "relic" ? "ancient" : "relic";
      var fdec = Br.decodeBibleBracelet(stats, { grade: forced });
      if (!traitsBreakCap(fdec, forced)) return fdec;
    }
    var granted = 0;
    for (i = 0; i < dec.lines.length; i++) if (!dec.lines[i].fixed) granted++;
    if (slotChoices(dec.grade).indexOf(granted) >= 0) return dec;
    var other = dec.grade === "relic" ? "ancient" : "relic";
    if (slotChoices(other).indexOf(granted) < 0) return dec;
    var alt = Br.decodeBibleBracelet(stats, { grade: other });
    if (traitsBreakCap(alt, other)) return dec;
    if (unplaced(alt) > unplaced(dec)) return dec;
    return alt;
  }
  function boardScore(stats, role) {
    if (!Array.isArray(stats) || !stats.length) return null;
    var Br = window.Bracelet, SR = window.Subrank, P = profiles();
    var sup = role === "support", prof = sup ? P.support : P.dps;
    var dec = decodeWithGradeCheck(stats);
    var traits = { crit: 0, spec: 0, swift: 0 }, lines = [], traitLines = [];
    for (var i = 0; i < dec.lines.length; i++) {
      var l = dec.lines[i], key = TRAIT_TO_APP[l.family];
      if (l.cat === "trait" && key) { traits[key] = l.value; traitLines.push(l); continue; }
      lines.push(l);
    }
    var g = SR.braceletScore({ lines: lines, traits: traits, grade: dec.grade, profile: sup ? P.support : null });
    return {
      grade: dec.grade, traitLines: traitLines, lines: lines,
      pct: Br.damagePercent(Br.jointScore(lines, traits, dec.grade, prof)),
      unmapped: (dec.unknown || []).length, score: g.score, isPerfect: !!g.isPerfect
    };
  }
  function packSig(stats) {
    var p = [];
    for (var i = 0; i < (stats || []).length; i++) {
      var s = stats[i];
      p.push(s.type == null ? 0 : s.type, s.index == null ? 0 : s.index, s.value == null ? 0 : s.value, s.fixed ? 1 : 0);
    }
    return JSON.stringify(p);
  }
  function loadoutLabel(c) {
    if (LOADOUT_LABELS[c]) return LOADOUT_LABELS[c];
    return String(c || "Loadout").replace(/^most_recent_/, "").replace(/_/g, " ")
      .replace(/\b\w/g, function (x) { return x.toUpperCase(); });
  }
  function isSupportCls(cls) { return !!SUPPORT_KEYS[String(cls == null ? "" : cls).replace(/[^A-Za-z]/g, "").toLowerCase()]; }

  /** snapshotEntry() for one /character answer -> the same shape a board row decodes to. */
  function scoreRecord(d) {
    var SR = window.Subrank, i;
    var recStats = d.bracelet && d.bracelet.stats;
    if (!Array.isArray(recStats) || !recStats.length) return null;
    var los = (d.loadouts || []).filter(function (l) { return l && l.bracelet && Array.isArray(l.bracelet.stats) && l.bracelet.stats.length; });
    var sigs = los.map(function (l) { return packSig(l.bracelet.stats); });
    var distinct = {};
    sigs.forEach(function (s) { distinct[s] = 1; });
    var nDistinct = Object.keys(distinct).length;
    var multi = los.length >= 2 && nDistinct >= 2;
    var chosen = sigs.indexOf(packSig(recStats));
    if (chosen < 0) chosen = (isNum(d.chosenLoadout) && d.chosenLoadout >= 0 && d.chosenLoadout < los.length) ? d.chosenLoadout : 0;
    var cand = multi ? los.map(function (l, k) {
      return { label: l.label || loadoutLabel(l.classification) || ("Loadout " + (k + 1)), stats: l.bracelet.stats };
    }) : [{ label: "Bracelet", stats: recStats }];
    if (!multi) chosen = 0;
    var best = -Infinity, bestI = -1;
    for (i = 0; i < cand.length; i++) {
      var s = null;
      try { s = boardScore(cand[i].stats, "dps"); } catch (e) { s = null; }
      cand[i].s = s;
      var p = (s && isFinite(s.pct)) ? s.pct : null;
      cand[i].pct = p;
      if (p != null && (p > best + 1e-9 || (Math.abs(p - best) < 1e-9 && i === chosen))) { best = p; bestI = i; }
    }
    var b = cand[bestI >= 0 ? bestI : chosen];
    if (!b || !b.s) return null;
    var sup = null;
    if (isSupportCls(d["class"])) { try { sup = boardScore(b.stats, "support"); } catch (e) { sup = null; } }
    var supWins = !!sup && SR.of(sup.score, "support").i < SR.of(b.s.score, "dps").i;
    function reading(x, won) { return x ? { pct: r2(x.pct), score: r3(x.score), isPerfect: won ? !!x.isPerfect : false } : null; }
    return {
      grade: b.s.grade, role: supWins ? "support" : "dps",
      dps: reading(b.s, !supWins), sup: reading(sup, supWins),
      traits: b.s.traitLines.map(function (l) { return { family: l.family, value: l.value }; }),
      lines: b.s.lines.map(function (l) {
        return { cat: l.cat, family: l.family, tier: l.tier || null, value: l.cat === "special" ? null : l.value, fixed: !!l.fixed };
      }),
      unmapped: b.s.unmapped,
      lo: multi ? { distinct: nDistinct, best: bestI >= 0 ? bestI : chosen,
        items: cand.map(function (c) { return { label: c.label, pct: r2(c.pct) }; }) } : null
    };
  }

  // ------------------------------------------------------------------ bracelet: parts

  /** "Crit Damage +X%" -> "Crit Damage"; the numbers go in their own column. */
  function famName(label) {
    return String(label).replace(/\(1\/party\)/g, "")
      .replace(/\s*[+−-]\s*[AXB]%?(?=[\s;,)]|$)/g, "")
      .replace(/\s+[AXB]s(?=[\s;,)]|$)/g, "")
      .replace(/\(\s*CD\s*\)/g, "")
      .replace(/\s+([;,])/g, "$1").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim()
      .replace(/[;,:]$/, "");
  }
  /** The tier's values, signed and with their unit, in label order: "+8.4%", "−2.1% / +2.5%". */
  function famValues(label, vals) {
    var re = /([+−-]?)\s*\b([AXB])(%|s)?(?=[\s;,)]|$)/g, m, seen = {}, out = [];
    while ((m = re.exec(label))) {
      var letter = m[2];
      if (seen[letter]) continue;
      seen[letter] = 1;
      var v = vals[letter === "B" ? 1 : 0];
      if (v == null) continue;
      out.push((m[1] || "") + commas(String(v)) + (m[3] || ""));
    }
    return out.join(" / ");
  }
  function lineView(line, grade) {
    var D = window.BraceletData;
    if (line.cat === "basic") {
      return { name: line.family === "mainStat" ? "Str / Dex / Int" : "Vitality", value: "+" + nf(line.value), fixed: !!line.fixed };
    }
    if (line.cat === "trait") {
      return { name: (TRAIT_LABEL[line.family] || "Combat trait") + " (trait line)", value: "+" + nf(line.value), fixed: !!line.fixed };
    }
    var fam = (D && D.SPECIAL_BY_ID) ? (D.SPECIAL_BY_ID[line.family] || D.SPECIAL_BY_KEY[line.family]) : null;
    if (!fam) return { name: "Unmapped effect", value: "", unk: true, fixed: !!line.fixed };
    var vals = (fam.values[grade] && fam.values[grade][line.tier]) || [];
    return { name: famName(fam.label), full: fam.label, tier: line.tier, value: famValues(fam.label, vals), fixed: !!line.fixed };
  }

  /** Which loadout the board ranks, in words, plus the record's loadout for its roll counts. */
  function loadoutInfo(lo, rec) {
    var los = (rec && rec.loadouts) || [];
    if (lo && lo.items && lo.items[lo.best]) {
      return { label: lo.items[lo.best].label,
        note: lo.distinct + " different bracelets across " + lo.items.length + " loadouts; the board ranks the best one." };
    }
    if (los.length >= 2) return { label: "All loadouts", note: "Every lostark.bible loadout wears this bracelet." };
    if (los.length === 1) return { label: los[0].label || loadoutLabel(los[0].classification), note: "" };
    return { label: "—", note: "" };
  }
  function rollsOf(rec, label) {
    if (!rec) return null;
    var br = rec.bracelet, los = rec.loadouts || [];
    for (var i = 0; i < los.length; i++) if (los[i] && los[i].label === label && los[i].bracelet) { br = los[i].bracelet; break; }
    if (!br || (br.numRerolls == null && br.numTicketRerolls == null)) return null;
    return { base: br.numRerolls || 0, ticket: br.numTicketRerolls || 0 };
  }
  /** A board row, or scoreRecord()'s copy of one -> the bracelet card. */
  function brPart(x, rec, onBoard) {
    var axis = x.role === "support" ? "support" : "dps";
    var reading = axis === "support" ? x.sup : x.dps;
    var lo = loadoutInfo(x.lo, rec);
    return {
      st: "ok", onBoard: onBoard, grade: x.grade, axis: axis, pct: reading ? reading.pct : null,
      lines: x.lines.map(function (l) { return lineView(l, x.grade); }),
      traits: x.traits.map(function (t) {
        return { label: TRAIT_LABEL[t.family] || t.family || "Trait", short: TRAIT_SHORT[t.family] || t.family || "Trait", value: t.value };
      }),
      unmapped: x.unmapped || 0, loadout: lo.label, loadoutNote: lo.note, rolls: rollsOf(rec, lo.label)
    };
  }
  function badgeFor(score, axis, perfect) {
    var band = srOf(score, axis), SR = window.Subrank;
    if (!band) return { key: "?", bg: "#4f5666", fg: "#ffffff", cls: "" };
    var col = SR.colorOf(band.key, !!perfect);
    return { key: band.key, bg: col.bg, fg: col.fg, cls: col.cls || "" };
  }
  /** The row's place on its board, and on the other board when it is on that one too. */
  function brRankOnBoard(B, region, row) {
    var axis = row.role === "support" ? "support" : "dps";
    var lists = B.lists[region] || { dps: [], support: [] };
    var list = lists[axis], i = list.indexOf(row);
    var reading = axis === "support" ? row.sup : row.dps;
    var oAxis = axis === "support" ? "dps" : "support", oList = lists[oAxis], oi = oList.indexOf(row);
    var oRead = oAxis === "support" ? row.sup : row.dps;
    return extend(badgeFor(reading && reading.score, axis, reading && reading.isPerfect), {
      st: i >= 0 ? "ok" : "none", msg: i >= 0 ? "" : "Not on the board",
      axis: axis, score: reading ? reading.score : null, pct: reading ? reading.pct : null,
      rank: i + 1, count: list.length, region: region, estimated: false,
      other: (oi >= 0 && oRead) ? { axis: oAxis, rank: oi + 1, count: oList.length,
        key: (srOf(oRead.score, oAxis) || { key: "?" }).key, pct: oRead.pct } : null,
      builtAt: B.builtAt, stale: !!B.stale
    });
  }
  /**
   * Where a freshly scored bracelet would land: every other row on its board,
   * plus it. Ties go the board's way: the rebuild replaces an existing row in
   * place and appends a new one, and the stable sort keeps payload order, so a
   * tie ahead of the old row's place (or any tie, for a character new to the
   * board) sorts in front.
   */
  function brRankEstimate(B, region, name, x) {
    var axis = x.role === "support" ? "support" : "dps";
    var reading = axis === "support" ? x.sup : x.dps;
    var out = extend(badgeFor(reading && reading.score, axis, reading && reading.isPerfect), {
      st: "ok", axis: axis, score: reading ? reading.score : null, pct: reading ? reading.pct : null,
      rank: null, count: null, region: region, estimated: true, other: null,
      builtAt: B ? B.builtAt : 0, stale: !!(B && B.stale)
    });
    if (!B || !reading || reading.pct == null) return out;
    var list = (B.lists[region] || {})[axis] || [], n = String(name).toLowerCase(), better = 0, count = 0;
    var own = B.byKey[region + "|" + n] || null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].n === n) continue;
      count++;
      var v = pctKey(axis === "support" ? list[i].sup : list[i].dps);
      if (v > reading.pct || (v === reading.pct && (!own || list[i].ord < own.ord))) better++;
    }
    out.rank = better + 1;
    out.count = count + 1;
    return out;
  }

  // ------------------------------------------------------------------ header + stats from the record

  function classIconFile(cls) {
    return cls ? (CLASS_ICON_BY_KEY[String(cls).replace(/[^A-Za-z]/g, "").toLowerCase()] || null) : null;
  }
  function headFrom(rec, src) {
    return { st: "ok", cls: rec["class"] || null, ilvl: isNum(rec.itemLevel) ? rec.itemLevel : null,
      pulledAt: src === "bracelet" && isNum(rec.pulledAt) ? rec.pulledAt : null, src: src };
  }
  function raidLoadout(rec) {
    var los = rec.loadouts || [], bi = -1, br = 99;
    for (var i = 0; i < los.length; i++) {
      if (!los[i] || !los[i].profile) continue;
      var r = LOADOUT_PREF[los[i].classification];
      if (r === undefined) r = 2;
      if (r < br) { br = r; bi = i; }
    }
    return bi >= 0 ? los[bi] : null;
  }
  function statsPart(rec) {
    var lo = raidLoadout(rec), pr = (lo && lo.profile) || rec.profile;
    if (!pr) return { st: "none", msg: "This record carries no character stats. Update pulls them." };
    var raw = pr.raw || {}, rows = [], k;
    function row(label, value, gloss) { rows.push([label, value == null || value === "" ? "—" : value, gloss || ""]); }

    var ilvl = isNum(pr.itemLevel) ? pr.itemLevel : rec.itemLevel;
    row("Item level", isNum(ilvl) ? nf(Math.floor(ilvl * 100) / 100, 2) : null);
    row("Combat power", isNum(pr.combatPower) ? nf(pr.combatPower, 2) : null,
      raw.combatPowerSource ? "As lostark.bible reports it (" + raw.combatPowerSource.replace(/([A-Z])/g, " $1").toLowerCase() + ")." : "");
    row("Main stat", isNum(raw.mainStatTotal) ? nf(raw.mainStatTotal) : null,
      isNum(pr.accessoryMainStat) ? "The five accessories carry " + nf(pr.accessoryMainStat) + " of it." : "");
    row("Weapon power", isNum(raw.weaponPowerTotal) ? nf(raw.weaponPowerTotal) : null);
    row("Base attack power", isNum(raw.baseAttackPower) ? nf(raw.baseAttackPower) : null,
      isNum(pr.apPct) ? "Gems and the ability stone add " + fx(pr.apPct, 1) + "% attack power on top." : "");

    var gemTxt = null, gemGloss = "";
    if (Array.isArray(pr.gemLevels) && pr.gemLevels.length) {
      var byLv = {};
      pr.gemLevels.forEach(function (lv) { byLv[lv] = (byLv[lv] || 0) + 1; });
      var parts = [];
      Object.keys(byLv).sort(function (a, b) { return b - a; }).forEach(function (lv) { parts.push(byLv[lv] + " × lv" + lv); });
      gemTxt = parts.join(", ");
      gemGloss = isNum(pr.apPct) ? "Attack power from gems and stone: +" + fx(pr.apPct, 1) + "%." : "";
    } else if (raw.gemsAssumed) {
      gemTxt = "not readable";
      gemGloss = "The page carries no readable gems; the calculator assumes " + raw.gemsAssumed + ".";
    }
    row("Gems", gemTxt, gemGloss);
    row("Ability stone", Array.isArray(raw.stoneNodes) && raw.stoneNodes.length ? raw.stoneNodes.join(" / ") : null,
      pr.stone97 != null ? (pr.stone97 ? "Its engraving levels total 5 or more: +1.5% attack power." : "Its engraving levels fall short of 5.") : "");

    var km = raw.karma || {};
    row("Karma", km.evolution != null ? [km.evolution, km.enlightenment, km.leap].join(" / ") : null,
      km.evolution != null ? "Evolution " + km.evolution + " · Enlightenment " + km.enlightenment + " · Leap " + km.leap +
        (isNum(pr.karmaWp) ? ". Enlightenment gives +" + fx(pr.karmaWp, 1) + "% weapon power." : ".") : "");
    var ap = pr.apPoints || {};
    row("Ark passive", ap.evolution != null ? [ap.evolution, ap.enlightenment, ap.leap].join(" / ") : null,
      ap.evolution != null ? "Evolution " + ap.evolution + " · Enlightenment " + ap.enlightenment + " · Leap " + ap.leap +
        " points." + (pr.master != null ? (pr.master ? " Master node on." : " No Master node.") : "") : "");

    var hon = pr.honing || {}, pieces = ["weapon", "head", "shoulder", "chest", "pants", "gloves"], armor = [];
    for (k = 1; k < pieces.length; k++) if (isNum(hon[pieces[k]])) armor.push(hon[pieces[k]]);
    var honTxt = null;
    if (isNum(hon.weapon) || armor.length) {
      var lowA = Math.min.apply(null, armor), highA = Math.max.apply(null, armor);
      // weapon / armor; the gloss names every piece
      honTxt = (isNum(hon.weapon) ? "+" + hon.weapon : "—") + " / " +
        (armor.length ? "+" + (lowA === highA ? lowA : lowA + "–" + highA) : "—");
    }
    var adv = pr.advancedHoning || {}, honGloss = [];
    pieces.forEach(function (p) {
      if (isNum(hon[p])) honGloss.push(p.charAt(0).toUpperCase() + p.slice(1) + " +" + hon[p] + (isNum(adv[p]) ? " (advanced " + adv[p] + ")" : ""));
    });
    row("Honing", honTxt, honGloss.join(" · "));

    var acc = [];
    if (isNum(pr.neckAddDmg)) acc.push("+" + pr.neckAddDmg + "%");
    if (isNum(pr.earring1Wp) || isNum(pr.earring2Wp)) acc.push("+" + (pr.earring1Wp || 0) + "% / +" + (pr.earring2Wp || 0) + "%");
    var accGloss = [];
    if (isNum(pr.neckAddDmg)) accGloss.push("Necklace additional damage +" + pr.neckAddDmg + "%");
    if (isNum(pr.earring1Wp) || isNum(pr.earring2Wp)) accGloss.push("earrings weapon power +" + (pr.earring1Wp || 0) + "% and +" + (pr.earring2Wp || 0) + "%");
    if (isNum(pr.accessoryFlatAP) || isNum(pr.accessoryFlatWP)) accGloss.push("flat " + nf(pr.accessoryFlatAP || 0) + " attack power and " + nf(pr.accessoryFlatWP || 0) + " weapon power");
    if (isNum(pr.accessoryMainStat)) accGloss.push(nf(pr.accessoryMainStat) + " main stat");
    row("Accessories", acc.length ? acc.join(" · ") : null, accGloss.length ? accGloss.join("; ") + "." : "");

    var cores = raw.arkGridCores;
    row("Ark grid", Array.isArray(cores) && cores.length ? cores.length + " cores" : null,
      Array.isArray(cores) && cores.length ? "Core points: " + cores.map(function (c) { return c.points; }).join(", ") + "." : "");

    return { st: "ok", loadout: lo ? (lo.label || loadoutLabel(lo.classification)) : "", rows: rows };
  }

  // ------------------------------------------------------------------ astrogem worker

  var agw = null, agSeq = 0, agPending = {};
  function agWorker() {
    if (agw) return agw;
    try { agw = new Worker(AG_WORKER); } catch (e) { agw = null; return null; }
    agw.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === "index-updated") {
        if (cur && cur.region === m.region && cur.model.ag.st === "ok") rankAstro(cur);
        return;
      }
      var p = agPending[m.id];
      if (!p) return;
      delete agPending[m.id];
      if (m.ok) p.resolve(m.result); else p.reject(m.error || {});
    };
    agw.onerror = function () {
      for (var id in agPending) if (Object.prototype.hasOwnProperty.call(agPending, id)) agPending[id].reject({ message: "The astrogem model did not load." });
      agPending = {};
      agw = null;
    };
    return agw;
  }
  function agCall(msg) {
    return new Promise(function (resolve, reject) {
      var w = agWorker();
      if (!w) { reject({ message: "This browser cannot run the astrogem model here." }); return; }
      msg.id = ++agSeq;
      agPending[msg.id] = { resolve: resolve, reject: reject };
      w.postMessage(msg);
    });
  }
  /** A support class sits on the board whose letter is better; the DPS one on a tie. */
  function agAxis(res) {
    if (!res.supportClass || !res.sup) return "dps";
    if (res.supportMain) return "support";
    return AG_ORD[res.sup.letter] > AG_ORD[res.dps.letter] ? "support" : "dps";
  }
  function agPart(res, rec) {
    if (!res.gems) return { st: "none", msg: "No astrogems on this character." };
    if (!res.valid) return { st: "none", msg: "None of the " + res.gems + " gems could be read." };
    var axis = agAxis(res), a = axis === "support" ? res.sup : res.dps;
    return {
      st: "ok", axis: axis, quality: a.quality, letter: a.letter, bg: a.bg, fg: a.fg, dmg: a.dmg,
      gems: res.gems, valid: res.valid, cores: res.cores, order: res.order, chaos: res.chaos, tiers: res.tiers,
      pulledAt: isNum(rec.pulledAt) ? rec.pulledAt : null, stale: !!rec.stale, supportMain: !!res.supportMain,
      dps: res.dps, sup: res.supportClass ? res.sup : null
    };
  }

  // ------------------------------------------------------------------ the character model

  var PARTS = ["head", "br", "brRank", "ag", "agRank", "stats"];

  function emptyModel(region, name) {
    var m = { v: VIEW_V, region: region, name: name };
    PARTS.forEach(function (k) { m[k] = { st: "loading" }; });
    return m;
  }
  /** Only settled parts are kept; a part that was loading or failing starts over. */
  function persist(ctx) {
    if (!isLive(ctx)) return;
    if (prerendering()) {
      if (!ctx.persistQueued) { ctx.persistQueued = true; whenShown(function () { ctx.persistQueued = false; persist(ctx); }); }
      return;
    }
    var out = { v: VIEW_V, region: ctx.region, name: ctx.name };
    PARTS.forEach(function (k) {
      var p = ctx.model[k];
      if (p && (p.st === "ok" || p.st === "none")) out[k] = p;
    });
    lsSet(K_CHAR + ctx.key, JSON.stringify({ v: VIEW_V, savedAt: now(), model: out }));
    pruneSoon();
  }
  /** A part has its answer from the network for this visit; all six -> "complete". */
  function settle(ctx, keys) {
    if (!isLive(ctx)) return;
    keys.forEach(function (k) { ctx.fresh[k] = true; });
    for (var i = 0; i < PARTS.length; i++) if (!ctx.fresh[PARTS[i]]) return;
    mark("complete");
  }
  function restore(key) {
    var v = lsJson(K_CHAR + key);
    return (v && v.v === VIEW_V && v.model) ? v : null;
  }
  /**
   * The tools' fast path: {record: <the bracelet record>, savedAt}, with the
   * astrogem answer for the same character at record.astrogem. Written once a
   * bracelet record has arrived from the network, and again when the gems land,
   * so the astrogem tool never has to fetch what this page already has.
   */
  function stashForTools(ctx) {
    if (!ctx.brRec || ctx.stashQueued) return;
    ctx.stashQueued = true;
    whenShown(function () {
      setTimeout(function () {
        ctx.stashQueued = false;
        if (!isLive(ctx) || !ctx.brRec) return;
        var rec = extend({}, ctx.brRec);
        if (ctx.agRec) rec.astrogem = ctx.agRec;
        lsSet(K_RECORD + ctx.key, JSON.stringify({ record: rec, savedAt: now() }));
        pruneSoon();
      }, 0);
    });
  }

  // ------------------------------------------------------------------ rendering

  var SKEL = {};   // each part's static skeleton markup, captured at boot

  function badgeHtml(key, bg, fg, cls, gloss, big) {
    return '<span class="lp-badge' + (big ? " big" : "") + (cls ? " " + esc(cls) : "") + '" style="background:' + esc(bg) +
      ";color:" + esc(fg) + '"' + (gloss ? ' data-gloss="' + esc(gloss) + '"' : "") + ">" + esc(key) + "</span>";
  }
  function setHtml(id, html) { var el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; }
  function setText(id, txt) { var el = $(id); if (el && el.textContent !== txt) el.textContent = txt; }

  function renderHead(ctx) {
    var m = ctx.model, h = m.head;
    setText("lp-name", ctx.name);
    var file = h.st === "ok" ? classIconFile(h.cls) : null;
    setHtml("lp-icon", h.st === "loading" ? SKEL["lp-icon"] :
      (file ? '<img src="' + ICONS + encodeURIComponent(file) + '.svg" width="38" height="38" alt="' + esc(h.cls || "") +
        '" onerror="this.style.display=\'none\'">' : ""));
    var sub;
    if (h.st === "ok") {
      var bits = ['<span data-gloss="' + esc(REGION_GLOSS[ctx.region] || ctx.region) + '">' + ctx.region + "</span>"];
      if (isNum(h.ilvl)) bits.push(nf(Math.floor(h.ilvl * 100) / 100, 2));
      if (h.cls) bits.push(esc(CLASS_LABEL[h.cls] || h.cls));
      sub = bits.join(" · ");
    } else if (h.st === "loading") {
      sub = ctx.region + ' · <span class="sk" style="width:11em"></span>';
    } else {
      sub = ctx.region;
    }
    setHtml("lp-sub", sub);
    renderPulled(ctx);
    renderUpdate(ctx);
    renderFav(ctx);
  }
  function renderPulled(ctx) {
    var h = ctx.model.head, html;
    if (h.st === "ok" && h.pulledAt) {
      var stale = now() - h.pulledAt >= STALE_MS;
      html = '<span data-gloss="' + esc("Read from lostark.bible " + new Date(h.pulledAt).toLocaleString() +
        (stale ? ". Over a week old: Update reads it again." : ".")) + '"' + (stale ? ' class="lp-old"' : "") + ">Pulled " + ageLabel(h.pulledAt) + "</span>";
    } else if (h.st === "loading") {
      html = SKEL["lp-pulled"];
    } else {
      html = "Not pulled";
    }
    setHtml("lp-pulled", html);
  }
  function renderUpdate(ctx) {
    var btn = $("lp-update");
    if (!btn) return;
    var h = ctx.model.head, busy = !!(ctx.watch || ctx.updating);
    var wait = (h.st === "ok" && h.pulledAt) ? UPDATE_COOLDOWN_MS - (now() - h.pulledAt) : 0;
    // Not before the first answer: until then a saved copy is on screen, and a
    // refresh measured against it could take the old record for the new one.
    btn.disabled = busy || !ctx.brDone || wait > 0;
    var label = busy ? (ctx.watch && !ctx.watch.update ? "Pulling…" : "Updating…") :
      (wait > 0 ? "Update " + inLabel(wait) : "Update");
    if (btn.textContent !== label) btn.textContent = label;
  }
  function renderFav(ctx) {
    var btn = $("lp-fav");
    if (!btn) return;
    var on = favHas(ctx.region, ctx.name);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = on ? "★ Favorited" : "☆ Favorite";
    if (btn.textContent !== label) btn.textContent = label;
  }
  function setProgress(ctx, text, kind) {
    ctx.progress = { text: text || "", kind: kind || "" };
    var el = $("lp-progress");
    if (!el) return;
    el.className = "lp-progress" + (kind ? " " + kind : "");
    el.textContent = text || "";
    el.title = text || "";
  }

  function brTileHtml(ctx) {
    var r = ctx.model.brRank;
    if (!r || r.st === "loading") return SKEL["lp-tile-br-body"];
    if (r.st !== "ok") return '<div class="lp-tmsg">' + esc(r.msg || "No bracelet rank.") + "</div>";
    var sup = r.axis === "support";
    var gloss = "Bracelet grade " + (isNum(r.score) ? fx(r.score, 1) : "—") + " out of 100, " + (sup ? "on the support ladder" : "on the damage-dealer ladder") +
      ": the bracelet leaderboard's own number and letter." + (r.estimated ? " Scored here; the board has not picked up this pull yet." : "");
    var rankTxt = r.rank ? (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region : "Rank unavailable";
    var sub2 = r.rank ? topPct(r.rank, r.count) + " · " + (sup ? "Support" : "DPS") + " board" : (sup ? "Support" : "DPS") + " board";
    var other = r.other ? "Also #" + nf(r.other.rank) + " of " + nf(r.other.count) + " on the " + (r.other.axis === "support" ? "Support" : "DPS") +
      " board, " + r.other.key + (isNum(r.other.pct) ? " at " + fx(r.other.pct, 2) + "%" : "") + "." : "";
    return badgeHtml(r.key, r.bg, r.fg, r.cls, gloss, true) +
      '<div class="lp-tnum"><div class="lp-tscore">' + (isNum(r.score) ? fx(r.score, 1) : "—") + "</div>" +
      '<div class="lp-tsub">' + (isNum(r.pct) ? fx(r.pct, 2) + "%" : "—") + (sup ? " per dealer" : " damage") + "</div></div>" +
      '<div class="lp-trank"' + (other || r.stale ? ' data-gloss="' + esc((other + (r.stale ? " Board copy from " + ageLabel(r.builtAt) + "; the board did not answer." : "")).trim()) + '"' : "") + ">" +
      '<div class="lp-trk">' + rankTxt + "</div>" +
      '<div class="lp-tsub">' + esc(sub2) + "</div></div>";
  }
  function agTileHtml(ctx) {
    var a = ctx.model.ag, r = ctx.model.agRank;
    if (!a || a.st === "loading") return SKEL["lp-tile-ag-body"];
    if (a.st !== "ok") return '<div class="lp-tmsg">' + esc(a.msg || "No astrogem data.") + "</div>";
    var sup = a.axis === "support";
    var gloss = "Quality " + fx(a.quality, 1) + ": the astrogem leaderboard's own grade and letter" + (sup ? ", read as a support." : ".");
    var rankBlock;
    if (!r || r.st === "loading") {
      rankBlock = '<div class="lp-trk"><span class="sk" style="width:7.5em"></span></div><div class="lp-tsub"><span class="sk" style="width:6em"></span></div>';
    } else if (r.st !== "ok") {
      rankBlock = '<div class="lp-trk lp-dim">Rank unavailable</div><div class="lp-tsub">' + esc(r.msg || "") + "</div>";
    } else {
      rankBlock = '<div class="lp-trk">' + (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region + "</div>" +
        '<div class="lp-tsub">' + topPct(r.rank, r.count) + " · " + (sup ? "Support" : "DPS") + " board</div>";
    }
    var rankGloss = r && r.st === "ok" ? ((r.other ? "Also #" + nf(r.other.rank) + " of " + nf(r.other.count) + " on the " +
      (r.other.axis === "support" ? "Support" : "DPS") + " board. " : "") +
      "Board built " + ageLabel(r.builtAt) + (r.estimated ? "; this character is not on it yet, so the place is estimated." : ".")) : "";
    return badgeHtml(a.letter, a.bg, a.fg, "", gloss, true) +
      '<div class="lp-tnum"><div class="lp-tscore">' + fx(a.quality, 1) + "</div>" +
      '<div class="lp-tsub">' + fx(a.dmg, 2) + "%" + (sup ? " party dmg" : " grid dmg") + "</div></div>" +
      '<div class="lp-trank"' + (rankGloss ? ' data-gloss="' + esc(rankGloss) + '"' : "") + ">" + rankBlock + "</div>";
  }
  function renderStrip(ctx) {
    setHtml("lp-tile-br-body", brTileHtml(ctx));
    setHtml("lp-tile-ag-body", agTileHtml(ctx));
    var br = ctx.model.brRank, ag = ctx.model.ag;
    setText("lp-tile-br-axis", br && br.st === "ok" ? (br.axis === "support" ? "Support" : "DPS") : "");
    setText("lp-tile-ag-axis", ag && ag.st === "ok" ? (ag.axis === "support" ? "Support" : "DPS") : "");
  }

  function renderBracelet(ctx) {
    var b = ctx.model.br;
    if (!b || b.st === "loading") {
      setHtml("lp-br-body", SKEL["lp-br-body"]);
      setHtml("lp-br-grade", "");
      return;
    }
    if (b.st !== "ok") {
      setHtml("lp-br-body", '<div class="lp-cmsg' + (b.st === "error" ? " err" : "") + '">' + esc(b.msg || "No bracelet.") + "</div>");
      setHtml("lp-br-grade", "");
      return;
    }
    var h = '<div class="lp-lines">';
    b.lines.forEach(function (l) {
      var tier = l.tier ? '<span class="lp-tier" style="color:' + TIER_COLOR[l.tier] + '">' + TIER_WORD[l.tier] + "</span>" : '<span class="lp-tier"></span>';
      h += '<div class="lp-line' + (l.unk ? " unk" : "") + '">' +
        '<span class="lp-lname"' + (l.full || l.fixed || l.unk ? ' data-gloss="' + esc((l.full ? l.full + "." : "") +
          (l.unk ? "This line uses a stat index the model does not map yet, so it scores zero." : "") + (l.fixed ? " Locked." : "")) + '"' : "") + ">" +
        esc(l.name) + (l.fixed ? ' <span class="lp-lock" aria-label="locked">&#128274;</span>' : "") + "</span>" +
        tier + '<span class="lp-lval">' + esc(l.value) + "</span></div>";
    });
    if (!b.lines.length) h += '<div class="lp-line"><span class="lp-lname lp-dim">No effect lines</span><span></span><span></span></div>';
    h += "</div>";
    var traits = b.traits.length ? b.traits.map(function (t) { return esc(t.short || t.label) + " " + nf(t.value); }).join(" · ") : "—";
    var traitsGloss = b.traits.map(function (t) { return t.label + " " + nf(t.value); }).join(" · ");
    var rolls = b.rolls ? String(b.rolls.base + b.rolls.ticket) : "—";
    var sup = b.axis === "support";
    h += '<div class="lp-kv">' +
      '<div><span class="k">Combat traits</span><span class="v"' + (traitsGloss ? ' data-gloss="' + esc(traitsGloss) + '"' : "") + ">" + traits + "</span></div>" +
      '<div><span class="k">' + (sup ? "Per dealer" : "Damage") + '</span><span class="v lp-strong"' +
        ' data-gloss="' + esc(sup ? "What one damage dealer next to this support gains from the bracelet, on the default support." :
          "What the whole bracelet is worth in % damage on the calculator's default character. The board ranks on it.") + '">' +
        (isNum(b.pct) ? fx(b.pct, 2) + "%" : "—") + "</span></div>" +
      '<div><span class="k">Rolls left</span><span class="v"' + (b.rolls ? ' data-gloss="' + esc(b.rolls.base + " regular + " + b.rolls.ticket +
        " ticket, as lostark.bible reports them. The calculator reads them the same way.") + '"' : "") + ">" + rolls + "</span></div>" +
      '<div><span class="k">Loadout</span><span class="v"' + (b.loadoutNote ? ' data-gloss="' + esc(b.loadoutNote) + '"' : "") + ">" +
        esc(b.loadout || "—") + "</span></div>" +
      "</div>";
    if (b.unmapped) h += '<div class="lp-warn">' + b.unmapped + " line" + (b.unmapped === 1 ? " uses" : "s use") + " a stat index the model does not map yet.</div>";
    setHtml("lp-br-body", h);
    setHtml("lp-br-grade", '<span class="lp-grade ' + b.grade + '">' + (b.grade === "relic" ? "Relic" : "Ancient") + "</span>");
  }

  function renderAstro(ctx) {
    var a = ctx.model.ag, r = ctx.model.agRank;
    if (!a || a.st === "loading") { setHtml("lp-ag-body", SKEL["lp-ag-body"]); return; }
    if (a.st !== "ok") {
      setHtml("lp-ag-body", '<div class="lp-cmsg' + (a.st === "error" ? " err" : "") + '">' + esc(a.msg || "No astrogem data.") + "</div>");
      return;
    }
    var sup = a.axis === "support";
    var rankTxt = !r || r.st === "loading" ? '<span class="sk" style="width:8em"></span>' :
      (r.st === "ok" ? (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region : '<span class="lp-dim">' + esc(r.msg || "unavailable") + "</span>");
    var h = '<div class="lp-agtop">' + badgeHtml(a.letter, a.bg, a.fg, "", "", false) +
      '<span class="lp-agq"><b>' + fx(a.quality, 1) + '</b> quality</span>' +
      '<span class="lp-agd" data-gloss="' + esc(sup ? "The party-damage buff this grid gives, per ally: the Support board ranks on it." :
        "Total % damage the grid adds over no grid: the DPS board ranks on it.") + '">' + fx(a.dmg, 2) + "%" + (sup ? " party" : " damage") + "</span></div>";
    h += '<div class="lp-tiers">' +
      '<span class="lp-tchip ancient"><b>' + a.tiers.ancient + "</b> Ancient</span>" +
      '<span class="lp-tchip relic"><b>' + a.tiers.relic + "</b> Relic</span>" +
      '<span class="lp-tchip legendary"><b>' + a.tiers.legendary + "</b> Legendary</span></div>";
    h += '<div class="lp-kv">' +
      '<div><span class="k">Gems</span><span class="v"' + (a.valid < a.gems ? ' data-gloss="' + esc((a.gems - a.valid) + " could not be read and are left out of the grade.") + '"' : "") + ">" +
        a.gems + " in " + a.cores + " cores</span></div>" +
      '<div><span class="k">Order / Chaos</span><span class="v">' + a.order + " / " + a.chaos + "</span></div>" +
      '<div><span class="k">Board</span><span class="v">' + rankTxt + "</span></div>" +
      '<div><span class="k">Pulled</span><span class="v"' + (a.stale ? ' data-gloss="Over a week old. The Astrogem Calculator pulls it again."' : "") + ">" +
        (a.pulledAt ? ageLabel(a.pulledAt) : "—") + "</span></div>" +
      "</div>";
    setHtml("lp-ag-body", h);
  }

  function renderStats(ctx) {
    var s = ctx.model.stats;
    if (!s || s.st === "loading") { setHtml("lp-stats-body", SKEL["lp-stats-body"]); setText("lp-stats-src", ""); return; }
    if (s.st !== "ok") {
      setHtml("lp-stats-body", '<div class="lp-cmsg' + (s.st === "error" ? " err" : "") + '">' + esc(s.msg || "No stats.") + "</div>");
      setText("lp-stats-src", "");
      return;
    }
    var h = "";
    s.rows.forEach(function (r) {
      h += '<div class="lp-stat"><span class="k">' + esc(r[0]) + '</span><span class="v"' +
        (r[2] ? ' data-gloss="' + esc(r[2]) + '"' : "") + ">" + esc(r[1]) + "</span></div>";
    });
    setHtml("lp-stats-body", h);
    setText("lp-stats-src", s.loadout ? s.loadout + " loadout" : "");
  }

  function renderLinks(ctx) {
    var c = cParam(ctx.region, ctx.name);
    var set = function (id, href) { var el = $(id); if (el) el.setAttribute("href", href); };
    set("lp-open-br", "/loa-bracelet-calc/?" + c);
    set("lp-open-adv", "/loa-bracelet-calc/advisor?" + c);
    set("lp-open-ag", "/loa-astrogem-calc/grader?" + c);
  }

  function renderAll(ctx) {
    renderHead(ctx);
    renderStrip(ctx);
    renderBracelet(ctx);
    renderAstro(ctx);
    renderStats(ctx);
    renderLinks(ctx);
    if (ctx.progress) setProgress(ctx, ctx.progress.text, ctx.progress.kind);
  }

  function renderQuick() {
    var el = $("lp-quick");
    if (!el) return;
    var favs = favList().filter(function (f) { return REGIONS.indexOf(normRegion(f.region)) >= 0; });
    var seen = {}, h = "";
    function chip(region, name, fav) {
      region = normRegion(region);
      var k = region + "|" + nkey(name);
      if (seen[k]) return;
      seen[k] = 1;
      var here = cur && cur.region === region && nkey(cur.name) === nkey(name);
      h += '<a class="lp-chip' + (fav ? " fav" : "") + (here ? " here" : "") + '" href="' + esc(charPath(region, normalizeName(name))) + '">' +
        (fav ? '<span class="lp-star">&#9733;</span>' : "") + '<span class="lp-creg">' + region + "</span>" + esc(normalizeName(name)) + "</a>";
    }
    favs.forEach(function (f) { chip(f.region, f.name, true); });
    recentList().forEach(function (r) { chip(r.region, r.name, false); });
    el.innerHTML = h || '<span class="lp-qempty">Favorites and recent searches show here.</span>';
  }

  // ------------------------------------------------------------------ loading one character

  function loadBracelet(ctx) {
    fetchCharacter(ctx, false).then(function (r) {
      if (!isLive(ctx)) return;
      var d = r.data || {};
      mark("record");
      ctx.brDone = true;
      if (hasBracelet(d)) onRecord(ctx, d, true);
      if (d.queued) { startWatch(ctx, d, hasBracelet(d) ? (d.pulledAt || 0) : 0, false); return; }
      if (!hasBracelet(d)) braceletFailed(ctx, r, null);
    }, function (err) {
      if (!isLive(ctx) || (err && err.name === "AbortError")) return;
      ctx.brDone = true;
      braceletFailed(ctx, null, err);
    });
  }

  /** A failure of the record itself. A cached copy stays on screen with a warning. */
  function braceletFailed(ctx, r, err) {
    var d = (r && r.data) || {};
    var notFound = !!(r && (r.status === 404 || d.notFound || d.error === "no_such_character"));
    var msg;
    if (notFound) msg = d.message || ("No character called " + ctx.name + " on " + ctx.region + ".");
    else if (d.unavailable) msg = d.message || "Character lookups are paused right now. Characters already pulled still load.";
    else if (d.rateLimited || d.monthlyBudget) msg = d.message || "Too many lookups at once. Try again in a minute.";
    else if (r) msg = d.message || d.error || ("The bracelet service answered " + r.status + ".");
    else msg = "The bracelet service did not answer.";
    var m = ctx.model;
    if (notFound) {
      m.head = { st: "none" };
      m.br = { st: "none", msg: msg };
      m.brRank = { st: "none", msg: "Not found" };
      m.stats = { st: "none", msg: "No record to read stats from." };
      setProgress(ctx, "Not found", "err");
      dropRecent(ctx.region, ctx.name);
      if (m.ag.st === "ok") m.head = headFrom(ctx.agRec || {}, "astrogem");
    } else if (m.br.st === "ok" || m.head.st === "ok") {
      setProgress(ctx, "Showing the saved copy: " + msg, "err");
    } else {
      m.head = ctx.agRec ? headFrom(ctx.agRec, "astrogem") : { st: "none" };
      m.br = { st: "error", msg: msg };
      m.brRank = { st: "error", msg: "No bracelet record" };
      m.stats = { st: "error", msg: msg };
      setProgress(ctx, "Bracelet record unavailable", "err");
    }
    renderAll(ctx);
    if (notFound) persist(ctx);
    settle(ctx, ["head", "br", "brRank", "stats"]);
  }

  function onRecord(ctx, d, fresh) {
    ctx.brRec = d;
    if (d.name && d.name !== ctx.name && nkey(d.name) === nkey(ctx.name)) {
      // The Worker's own spelling wins; move the address and the saved copy with it.
      ctx.name = d.name;
      ctx.key = ctx.region + "|" + ctx.name;
      try { history.replaceState(history.state, "", charPath(ctx.region, ctx.name) + location.search); } catch (e) {}
    }
    if (fresh) stashForTools(ctx);
    ctx.model.head = headFrom(d, "bracelet");
    ctx.model.stats = statsPart(d);
    renderHead(ctx);
    renderStats(ctx);
    mark("head");
    settle(ctx, ["head", "stats"]);
    deriveBracelet(ctx);
    persist(ctx);
  }

  /**
   * The bracelet card and its rank: the board's row when the board holds this
   * pull, otherwise the calculator's model scores the record right here.
   */
  function deriveBracelet(ctx) {
    var d = ctx.brRec;
    if (!d) return;
    var B = ctx.board;
    if (!B && !ctx.boardErr && !ctx.boardSlow) return;   // the board is on its way
    var row = B ? B.byKey[ctx.region + "|" + ctx.name.toLowerCase()] : null;
    if (row && isNum(d.pulledAt) && isNum(row.pulledAt) && d.pulledAt > row.pulledAt + 1000) row = null;  // the board holds an older pull
    if (row) {
      ctx.scoreToken = null;
      ctx.model.br = brPart(row, d, true);
      ctx.model.brRank = brRankOnBoard(B, ctx.region, row);
      renderBracelet(ctx);
      renderStrip(ctx);
      persist(ctx);
      mark("bracelet");
      settle(ctx, ["br", "brRank"]);
      return;
    }
    var token = ctx.scoreToken = {};
    loadBraceletModel().then(function () {
      if (!isLive(ctx) || ctx.scoreToken !== token) return;
      var x = scoreRecord(d);
      if (!x) {
        ctx.model.br = { st: "none", msg: "This record carries no bracelet." };
        ctx.model.brRank = { st: "none", msg: "No bracelet" };
      } else {
        ctx.model.br = brPart(x, d, false);
        ctx.model.brRank = brRankEstimate(ctx.board, ctx.region, ctx.name, x);
      }
      renderBracelet(ctx);
      renderStrip(ctx);
      persist(ctx);
      mark("bracelet");
      settle(ctx, ["br", "brRank"]);
    }, function () {
      if (!isLive(ctx) || ctx.scoreToken !== token) return;
      ctx.model.br = { st: "error", msg: "The bracelet model did not load, so this pull cannot be scored yet." };
      ctx.model.brRank = { st: "error", msg: "Unavailable" };
      renderBracelet(ctx);
      renderStrip(ctx);
      settle(ctx, ["br", "brRank"]);
    });
  }

  function loadBoard(ctx) {
    var pre = prerendering();
    getBoard({ cacheOnly: pre }).then(function (B) {
      if (!isLive(ctx)) return;
      ctx.board = B;
      mark("board");
      deriveBracelet(ctx);
    }, function (err) {
      if (!isLive(ctx) || (err && (err.deferred || err.name === "AbortError"))) return;
      ctx.boardErr = err || true;
      deriveBracelet(ctx);
    });
    if (pre) {
      // Once shown, the network may be asked (memory answers at once if still fresh).
      whenShown(function () { if (isLive(ctx)) loadBoard(ctx); });
      return;
    }
    // A record that lands long before the board is not held back by it.
    ctx.timers.push(setTimeout(function () {
      if (isLive(ctx) && !ctx.board && !ctx.boardErr) { ctx.boardSlow = true; deriveBracelet(ctx); }
    }, BOARD_WAIT_MS));
  }

  function loadAstro(ctx) {
    // In a prerender this is a plain read — no queue=1, which can enqueue a
    // pull and is a side effect. A miss (or an error) met in a prerender is
    // retried, with the queue, once the page is shown.
    var pre = prerendering();
    getJson(AG_API + "/?region=" + ctx.region + "&name=" + encodeURIComponent(ctx.name) + (pre ? "" : "&queue=1"), ctx).then(function (r) {
      if (!isLive(ctx)) return;
      var d = r.data || {};
      mark("gems");
      if (Array.isArray(d.gems)) {
        ctx.agRec = d;
        stashForTools(ctx);
        if (ctx.model.head.st !== "ok" && ctx.brDone && !ctx.brRec) { ctx.model.head = headFrom(d, "astrogem"); renderHead(ctx); }
        scoreAstro(ctx, d);
        return;
      }
      if (pre) { whenShown(function () { if (isLive(ctx)) loadAstro(ctx); }); return; }
      var msg, st = "none";
      if (r.status === 401 || d.needSignIn) msg = "Not pulled yet. The Astrogem Calculator pulls it after a lostark.bible sign-in.";
      else if (d.queued) msg = "Queued in the astrogem service. It shows here once pulled.";
      else if (r.status === 404 || d.notFound) msg = "No astrogem record for this character.";
      else if (d.rateLimited) { msg = d.error || d.message || "The astrogem service is busy. Try again in a minute."; st = "error"; }
      else { msg = d.error || d.message || ("The astrogem service answered " + r.status + "."); st = "error"; }
      settle(ctx, ["ag", "agRank"]);
      if (st === "error" && ctx.model.ag.st === "ok") return;   // keep the saved copy
      ctx.model.ag = { st: st, msg: msg };
      ctx.model.agRank = { st: st, msg: "No gems" };
      renderAstro(ctx);
      renderStrip(ctx);
      if (st === "none") persist(ctx);
    }, function (err) {
      if (!isLive(ctx) || (err && err.name === "AbortError")) return;
      if (pre) { whenShown(function () { if (isLive(ctx)) loadAstro(ctx); }); return; }
      settle(ctx, ["ag", "agRank"]);
      if (ctx.model.ag.st === "ok") return;
      ctx.model.ag = { st: "error", msg: "The astrogem service did not answer." };
      ctx.model.agRank = { st: "error", msg: "Unavailable" };
      renderAstro(ctx);
      renderStrip(ctx);
    });
  }
  function scoreAstro(ctx, d) {
    agCall({ type: "score", gems: d.gems, cls: d["class"] }).then(function (res) {
      if (!isLive(ctx)) return;
      ctx.model.ag = agPart(res, d);
      renderAstro(ctx);
      renderStrip(ctx);
      persist(ctx);
      mark("astrogem");
      settle(ctx, ["ag"]);
      if (ctx.model.ag.st === "ok") rankAstro(ctx);
      else { ctx.model.agRank = { st: "none", msg: "No gems" }; renderStrip(ctx); settle(ctx, ["agRank"]); }
    }, function (err) {
      if (!isLive(ctx)) return;
      if (err && err.suspended) { if (!ctx.suspended) scoreAstro(ctx, d); return; }
      ctx.model.ag = { st: "error", msg: (err && err.message) || "The astrogem model did not load." };
      ctx.model.agRank = { st: "error", msg: "Unavailable" };
      renderAstro(ctx);
      renderStrip(ctx);
      settle(ctx, ["ag", "agRank"]);
    });
  }
  function rankAstro(ctx) {
    var a = ctx.model.ag;
    agCall({ type: "rank", region: ctx.region, name: ctx.name, cls: ctx.agRec ? ctx.agRec["class"] : null,
      cur: { dmg: a.dps && a.dps.dmg, pdmg: a.sup && a.sup.dmg, supportMain: a.supportMain }, maxAgeMs: AG_INDEX_TTL_MS,
      offline: prerendering()
    }).then(function (res) {
      if (!isLive(ctx)) return;
      var sup = ctx.model.ag.axis === "support";
      var place = sup ? res.sup : res.dps, other = sup ? res.dps : res.sup;
      if (!place) {
        ctx.model.agRank = { st: "none", msg: "Not on the board" };
      } else {
        ctx.model.agRank = { st: "ok", axis: sup ? "support" : "dps", rank: place.rank, count: place.count, estimated: place.estimated,
          region: res.region, builtAt: res.builtAt, stale: res.stale,
          other: (other && !other.estimated) ? { axis: sup ? "dps" : "support", rank: other.rank, count: other.count } : null };
      }
      if (perfNav && res.timings) perfNav.agBoard = res.timings;
      if (perfNav) perfNav.agBoardSource = res.source;
      renderAstro(ctx);
      renderStrip(ctx);
      persist(ctx);
      mark("ag-rank");
      settle(ctx, ["agRank"]);
    }, function (err) {
      if (!isLive(ctx)) return;
      if (err && err.suspended) { if (!ctx.suspended) rankAstro(ctx); return; }
      if (err && err.deferred) { whenShown(function () { if (isLive(ctx)) rankAstro(ctx); }); return; }
      settle(ctx, ["agRank"]);
      if (ctx.model.agRank.st === "ok") return;
      ctx.model.agRank = { st: "error", msg: err && err.rateLimited ? "board busy, try later" : "board unavailable" };
      renderAstro(ctx);
      renderStrip(ctx);
    });
  }

  // ------------------------------------------------------------------ the queue watch (bible-import.js, ported)

  function startWatch(ctx, first, since, isUpdate) {
    stopWatch(ctx);
    var w = { since: since || 0, update: !!isUpdate, pos: first.position > 0 ? first.position : null,
      total: first.total || null, perMin: first.drainPerMin || 6, syncAt: now(), started: now() };
    ctx.watch = w;
    renderUpdate(ctx);
    function alive() { return isLive(ctx) && ctx.watch === w; }
    function line() {
      var head = w.update ? "Updating from lostark.bible" : "Pulling from lostark.bible";
      if (w.pos == null) return head + "…";
      var p = Math.max(1, w.pos - Math.floor((now() - w.syncAt) / 1000 / (60 / w.perMin)));
      var secs = Math.ceil(p / w.perMin * 60);
      return head + " · " + (p <= 1 ? "next up" : "#" + p + " of " + Math.max(w.total || p, p)) +
        " · ~" + (secs < 60 ? Math.max(1, secs) + "s" : Math.ceil(secs / 60) + "m");
    }
    function paint() { if (alive()) setProgress(ctx, line(), "busy"); }
    function finish(d) {
      stopWatch(ctx);
      setProgress(ctx, "", "");
      onRecord(ctx, d, true);
      renderUpdate(ctx);
      mark("pulled");
    }
    function end(msg, notFound) {
      stopWatch(ctx);
      renderUpdate(ctx);
      if (!ctx.brRec) {
        ctx.model.head = ctx.agRec ? headFrom(ctx.agRec, "astrogem") : { st: "none" };
        ctx.model.br = { st: notFound ? "none" : "error", msg: msg };
        ctx.model.brRank = { st: "none", msg: notFound ? "Not found" : "No record" };
        ctx.model.stats = { st: "none", msg: notFound ? "No record to read stats from." : msg };
        renderAll(ctx);
      }
      setProgress(ctx, notFound ? "Not found" : msg, "err");
      if (notFound) dropRecent(ctx.region, ctx.name);
      settle(ctx, ["head", "br", "brRank", "stats"]);
    }
    function doSync() {
      if (!alive()) return;
      if (now() - w.started > WATCH_MAX_MS) { end("Still queued. Check back in a few minutes.", false); return; }
      fetchCharacter(ctx, false).then(function (r) {
        if (!alive()) return;
        var d = r.data || {};
        if (hasBracelet(d) && (d.pulledAt || 0) > w.since) { finish(d); return; }
        if (d.queued && d.position > 0) {
          w.pos = d.position; w.total = d.total || w.total;
          if (d.drainPerMin) w.perMin = d.drainPerMin;
          w.syncAt = now();
        } else if (!d.queued && !hasBracelet(d) && (!r.ok || d.error)) {
          end(d.message || d.error || "The lookup ended.", r.status === 404 || !!d.notFound);
          return;
        }
        paint();
        w.sync = setTimeout(doSync, 30000);
      }, function () { if (alive()) w.sync = setTimeout(doSync, 30000); });
    }
    function waitLoop() {
      if (!alive()) return;
      getJson(BR_API + "/wait?region=" + bibleRegion(ctx.region) + "&name=" + encodeURIComponent(ctx.name) + "&since=" + w.since, ctx).then(function (r) {
        if (!alive()) return;
        var d = r.data || {};
        if (d.done && hasBracelet(d)) finish(d);
        else if (d.notFound) end(d.message || d.error || "No such character.", true);
        else waitLoop();
      }, function () { if (alive()) w.retry = setTimeout(waitLoop, 3000); });
    }
    w.tick = setInterval(paint, 1000);
    paint();
    w.sync = setTimeout(doSync, 30000);
    waitLoop();
  }
  function stopWatch(ctx) {
    var w = ctx && ctx.watch;
    if (!w) return;
    clearInterval(w.tick);
    clearTimeout(w.sync);
    clearTimeout(w.retry);
    ctx.watch = null;
  }

  function doUpdate() {
    var ctx = cur;
    if (!ctx || ctx.watch || ctx.updating) return;
    ctx.updating = true;
    renderUpdate(ctx);
    setProgress(ctx, "Asking lostark.bible…", "busy");
    fetchCharacter(ctx, true).then(function (r) {
      if (!isLive(ctx)) return;
      ctx.updating = false;
      var d = r.data || {};
      if (d.queued) { startWatch(ctx, d, ctx.brRec ? (ctx.brRec.pulledAt || 0) : 0, true); return; }
      if (hasBracelet(d) && (!ctx.brRec || (d.pulledAt || 0) > (ctx.brRec.pulledAt || 0))) {
        setProgress(ctx, "", "");
        onRecord(ctx, d, true);
        renderUpdate(ctx);
        return;
      }
      renderUpdate(ctx);
      if (r.status === 404 || d.notFound) { braceletFailed(ctx, r, null); return; }
      setProgress(ctx, d.message || d.error || ("Update failed (" + r.status + ")."), "err");
    }, function (err) {
      if (!isLive(ctx) || (err && err.name === "AbortError")) return;
      ctx.updating = false;
      renderUpdate(ctx);
      setProgress(ctx, "Update failed: the bracelet service did not answer.", "err");
    });
  }

  // ------------------------------------------------------------------ navigation

  function teardown() {
    var ctx = cur;
    if (!ctx) return;
    stopWatch(ctx);
    ctx.aborts.forEach(function (c) { try { c.abort(); } catch (e) {} });
    ctx.timers.forEach(function (t) { clearTimeout(t); });
    cur = null;
  }

  function setMode(char) {
    var d = document.documentElement;
    d.classList.toggle("lp-char", !!char);
    d.classList.toggle("lp-find", !char);
  }

  var NOTES = {
    region: function (r) { return "“" + r.bad + "” is not a region the boards track. Pick NA or EU."; },
    noname: function () { return "Type a character name."; },
    badname: function () { return "That is not a character name."; }
  };
  function showFind(r) {
    setMode(false);
    document.title = "Character profiles — Loseii";
    var note = r.note && NOTES[r.note] ? NOTES[r.note](r) : "";
    var el = $("lp-note");
    if (el) { el.textContent = note; el.style.display = note ? "" : "none"; }
    if (r.region && $("lp-region")) $("lp-region").value = r.region;
    renderQuick();
    mark("find");
  }

  function openChar(region, name) {
    setMode(true);
    var el = $("lp-note");
    if (el) el.style.display = "none";
    var ctx = {
      gen: gen, region: region, name: name, key: region + "|" + name,
      model: emptyModel(region, name), aborts: [], timers: [],
      brRec: null, agRec: null, board: null, boardErr: null, boardSlow: false,
      watch: null, updating: false, brDone: false, progress: null, scoreToken: null, fresh: {}
    };
    cur = ctx;
    document.title = name + " (" + region + ") — Loseii";
    if ($("lp-region")) $("lp-region").value = region;
    if ($("lp-q") && document.activeElement !== $("lp-q")) $("lp-q").value = "";

    var saved = restore(ctx.key);
    if (saved) {
      PARTS.forEach(function (k) {
        var p = saved.model[k];
        if (p && (p.st === "ok" || p.st === "none")) ctx.model[k] = p;
      });
    }
    // Warm the worker now: it loads the astrogem model while the requests run.
    agWorker();
    renderAll(ctx);
    mark(saved ? "cache-paint" : "skeleton");

    renderQuick();
    whenShown(function () {
      if (!isLive(ctx)) return;
      addRecent(region, name);
      renderQuick();
      loadBracelet(ctx);   // queue=1 can enqueue a pull: never from a prerender
    });
    loadAstro(ctx);        // a read: astrogem-bible never queues a signed-out lookup
    loadBoard(ctx);
  }

  function route(kind) {
    teardown();
    gen++;
    perfStart(kind, location.pathname);
    var r = parsePath(location.pathname), fromQuery = false;
    if (r.kind === "find" && !r.note) {
      // /profile/?region=NA&name=X: the hub's search form, sent without script.
      var q = null;
      try { q = new URLSearchParams(location.search); } catch (e) {}
      if (q && q.get("name")) {
        r = parsePath("/" + (normRegion(q.get("region")) || "NA") + "/" + encodeURIComponent(q.get("name")));
        fromQuery = true;
      }
    }
    if (r.kind !== "char") { showFind(r); return; }
    var canon = charPath(r.region, r.name);
    if (location.pathname !== canon) {
      whenShown(function () {
        try { history.replaceState(history.state, "", canon + (fromQuery ? "" : location.search) + location.hash); } catch (e) {}
      });
    }
    openChar(r.region, r.name);
  }

  function go(region, name) {
    var path = charPath(region, name);
    if (cur && location.pathname === path) return;
    try { history.pushState({ lp: 1 }, "", path); } catch (e) { location.href = path; return; }
    window.scrollTo(0, 0);
    route("nav");
  }

  // ------------------------------------------------------------------ back/forward cache

  function suspend() {
    var ctx = cur;
    if (boardCtl) { try { boardCtl.abort(); } catch (e) {} }
    if (agw) {
      // The worker goes too: mid-download it is a request in flight, and idle it
      // holds nothing the Cache API does not. The next question starts a new one.
      try { agw.terminate(); } catch (e) {}
      agw = null;
      var p = agPending;
      agPending = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) p[k].reject({ suspended: true });
    }
    if (!ctx) return;
    ctx.suspended = true;
    ctx.updating = false;   // an Update in flight is dropped too; the record read on return picks up its queue
    stopWatch(ctx);
    ctx.aborts.forEach(function (c) { try { c.abort(); } catch (e) {} });
    ctx.aborts = [];
  }
  function resume() {
    var ctx = cur;
    if (!ctx || !ctx.suspended) return;
    ctx.suspended = false;
    renderPulled(ctx);
    renderUpdate(ctx);
    // Each of these is a read that answers from what is already cached; the
    // record read restarts the queue watch by itself if a pull is still queued.
    loadBracelet(ctx);
    loadAstro(ctx);
    loadBoard(ctx);
  }

  // ------------------------------------------------------------------ boot

  function capture(id) { var el = $(id); SKEL[id] = el ? el.innerHTML : ""; }

  function boot() {
    ["lp-icon", "lp-pulled", "lp-tile-br-body", "lp-tile-ag-body", "lp-br-body", "lp-ag-body", "lp-stats-body"].forEach(capture);

    var form = $("lp-search"), q = $("lp-q");
    var submit = function () {
      var region = normRegion($("lp-region").value) || "NA";
      var name = normalizeName(q.value);
      if (!name || name.length > 40 || /[\/\\<>"?#%]/.test(name)) { q.focus(); return; }
      q.value = "";
      q.blur();
      go(region, name);
    };
    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    // Enter is handled here as well as by the form: it keeps an IME's Enter (which
    // confirms a composition) from searching, and does not rely on the browser's
    // implicit submission.
    if (q) q.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); }
    });

    // In-app links (the chips) move without a reload; anything with a modifier opens as usual.
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest("a.lp-chip") : null;
      if (!a) return;
      var r = parsePath(a.getAttribute("href"));
      if (r.kind !== "char") return;
      e.preventDefault();
      go(r.region, r.name);
    });

    var upd = $("lp-update");
    if (upd) upd.addEventListener("click", doUpdate);
    var fav = $("lp-fav");
    if (fav) fav.addEventListener("click", function () {
      if (!cur) return;
      favToggle(cur.region, cur.name);
      renderFav(cur);
      renderQuick();
    });
    var share = $("lp-share");
    if (share) share.addEventListener("click", function () {
      if (!cur) return;
      var url = location.origin + charPath(cur.region, cur.name);
      var done = function (ok) {
        share.textContent = ok ? "Link copied" : "Copy failed";
        setTimeout(function () { share.textContent = "Share"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(legacyCopy(url)); });
      } else done(legacyCopy(url));
    });

    // No speculation rules (Firefox, Safari): fetch a tool page once, on first hover.
    var prefetched = {};
    var hoverPrefetch = function (e) {
      if (SPEC_RULES) return;
      var a = e.target.closest ? e.target.closest("a.lp-cta, a.lp-cta2") : null;
      if (!a || !a.href || prefetched[a.href]) return;
      prefetched[a.href] = 1;
      var l = document.createElement("link");
      l.rel = "prefetch";
      l.href = a.href;
      document.head.appendChild(l);
    };
    document.addEventListener("mouseover", hoverPrefetch);
    document.addEventListener("focusin", hoverPrefetch);
    document.addEventListener("touchstart", hoverPrefetch, { passive: true });

    // Back/forward cache: leave nothing in flight, pick up where it was on return.
    window.addEventListener("pagehide", function () { suspend(); });
    window.addEventListener("pageshow", function (e) {
      PERF.pageshows.push({ persisted: !!e.persisted, t: Math.round(pnow()) });
      if (e.persisted) resume();
    });

    window.addEventListener("popstate", function () { route("pop"); });
    window.addEventListener("storage", function (e) {
      if (e.key === K_FAVS || e.key === K_RECENT) { if (cur) renderFav(cur); renderQuick(); }
    });
    setInterval(function () { if (cur) { renderPulled(cur); renderUpdate(cur); } }, 20000);

    route("load");
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
