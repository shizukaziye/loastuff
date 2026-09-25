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
 *   gold per 1% the GPD chart's own lookup, loa-gpd/lookup.js: GpdLookup.place()
 *               on the two answers above, on the role the astrogem section
 *               graded (the chart's rule), default switches. Loaded after the
 *               bracelet and astrogem overviews have painted; the third rank tile
 *               is its cheapest step.
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
  var AG_WORKER = "/profile/ag-worker.js?v=2";
  // The bracelet calculator's own model, for a character the board does not hold
  // yet. subrank.js is loaded again AFTER the model: it captures window.Bracelet
  // when it runs, and the copy index.html loaded ran before the model existed.
  var BR_MODEL = ["/loa-bracelet-calc/data/gear-data.js?v=4",
    "/loa-bracelet-calc/model/bracelet.js?v=14",
    "/loa-bracelet-calc/subrank.js?v=9"];
  var ICONS = "/loa-bracelet-calc/assets/class-icons/";
  // The GPD chart's lookup. It is heavy (its models, eight tables and the
  // accessory lattice), so it loads after the bracelet and astrogem cards have
  // painted. lookup.js fetches all of that itself; the two scripts it would also
  // fetch from www, this page loads first from the tools' own pins (loadGpd).
  var GPD_LIB = "/loa-gpd/lookup.js?v=4";
  var AG_MODEL_JS = "/loa-astrogem-calc/model/astrogem.js?v=62";   // the grader's pin; the astrogem worker has it cached

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
  var RECENT_MAX = 12, CHAR_KEEP = 40, RECORD_KEEP = 20, VIEW_V = 3;   // 3: bracelet lines carry their raw form and traits their family

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

  // ------------------------------------------------------------------ tooltip text
  // House rule (loa-bracelet-calc/docs/design/copy-rules.md): the figure states,
  // the tooltip explains, in one or two plain sentences. Every sentence below is
  // built from the same data the figure comes from, so it cannot drift from it.

  /** ' data-gloss="…"' for an element, or nothing for an empty text. */
  function gl(text) { return text ? ' data-gloss="' + esc(text) + '"' : ""; }
  function setGloss(id, text) {
    var el = $(id);
    if (!el) return;
    if (text) el.setAttribute("data-gloss", text); else el.removeAttribute("data-gloss");
  }
  function trimNum(x) { return String(Math.round(x * 10) / 10); }
  /** Where a ladder's letters start, best first: "S+ from 100.1, S from 95, A from 80, … F below 30". */
  // The main cuts, plus the letter the reader holds, so its own band is named.
  function ladderWords(cuts, letter) {
    var show = { "S+": 1, "S": 1, "A": 1, "B": 1, "C": 1, "D": 1 }, parts = [], dLow = null;
    if (letter && letter.charAt(0) !== "F") show[letter] = 1;   // F's band is the "F below" clause
    (cuts || []).forEach(function (c) {
      if (show[c[0]]) parts.push(c[0] + " from " + trimNum(c[1]));
      if (c[0] === "D-") dLow = c[1];
    });
    if (dLow != null) parts.push("F below " + trimNum(dLow));
    return parts.join(", ");
  }
  /** The bracelet board's cuts for a role, read from subrank.js. */
  function brCuts(axis) {
    var SR = window.Subrank;
    if (!SR || !SR.bandsFor) return [];
    return SR.bandsFor(axis === "support" ? "support" : "dps")
      .filter(function (b) { return isFinite(b.min); })
      .map(function (b) { return [b.key, b.min]; });
  }
  /** A combat trait's roll band on this grade, from the official table. */
  function traitBand(grade) {
    var D = window.BraceletData, b = D && D.TRAITS && D.TRAITS.bands, g = grade === "relic" ? "relic" : "ancient";
    if (!b || !b.length) return null;
    return [b[0][g][0], b[b.length - 1][g][1]];
  }
  /** "2 or 3": how many rerollable lines this grade grants, from the official table. */
  function grantedWords(grade) {
    var D = window.BraceletData, c = D && D.LINE_COUNTS && D.LINE_COUNTS.granted && D.LINE_COUNTS.granted[grade === "relic" ? "relic" : "ancient"];
    return c ? Object.keys(c).join(" or ") : "";
  }
  /** A family's label with its placeholders filled: "Crit Rate +4.2%; on crit, damage +1.5%". */
  function fillLabel(label, vals) {
    return String(label).replace(/([+−-]?)\s*\b([AXB])(%|s)?(?=[\s;,)]|$)/g, function (m, sign, letter, unit) {
      var v = vals[letter === "B" ? 1 : 0];
      if (v == null) return m;
      return (/^\s/.test(m) ? " " : "") + (sign || "") + commas(String(v)) + (unit || "");
    });
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
      var ms = line.family === "mainStat";
      return { name: ms ? "Str / Dex / Int" : "Vitality", value: "+" + nf(line.value), fixed: !!line.fixed,
        full: ms ? "A main-stat line: real damage, but a small share of what an effect line gives." :
          "A vitality line. The model scores it at zero damage.",
        valueGloss: "+" + nf(line.value) + (ms ? " strength, dexterity or intelligence." : " vitality.") };
    }
    if (line.cat === "trait") {
      return { name: (TRAIT_LABEL[line.family] || "Combat trait") + " (trait line)", value: "+" + nf(line.value), fixed: !!line.fixed,
        full: "A combat trait in a rerollable slot. The model scores it at zero: only the two traits the bracelet came with count.",
        valueGloss: "+" + nf(line.value) + " " + (TRAIT_LABEL[line.family] || "trait") + " points, scored at zero." };
    }
    var fam = (D && D.SPECIAL_BY_ID) ? (D.SPECIAL_BY_ID[line.family] || D.SPECIAL_BY_KEY[line.family]) : null;
    if (!fam) return { name: "Unmapped effect", value: "", unk: true, fixed: !!line.fixed,
      full: "This line uses a stat index the model does not map yet, so it scores zero." };
    var byTier = fam.values[grade] || {}, vals = byTier[line.tier] || [];
    var steps = TIERS.map(function (t) { return TIER_WORD[t] + " " + famValues(fam.label, byTier[t] || []); }).join(", ");
    return {
      name: famName(fam.label), full: fam.label + ".", tier: line.tier, fixed: !!line.fixed,
      value: famValues(fam.label, vals),
      tierGloss: "The rarity this line rolled at. On " + (grade === "relic" ? "a Relic" : "an Ancient") +
        " bracelet this family gives " + steps + ".",
      valueGloss: fillLabel(fam.label, vals) + "."
    };
  }

  /** Which loadout the board ranks, in words, plus the record's loadout for its roll counts. */
  function loadoutInfo(lo, rec) {
    var los = (rec && rec.loadouts) || [];
    if (lo && lo.items && lo.items[lo.best]) {
      return { label: lo.items[lo.best].label,
        note: lo.distinct + " different bracelets across " + lo.items.length + " loadouts; the board ranks the best one." };
    }
    if (los.length >= 2) return { label: "All loadouts", note: "Every lostark.bible loadout on the record wears this bracelet." };
    if (los.length === 1) return { label: los[0].label || loadoutLabel(los[0].classification),
      note: "The only lostark.bible loadout on the record." };
    return { label: "—", note: "The record names no loadout." };
  }
  function rollsOf(rec, label) {
    if (!rec) return null;
    var br = rec.bracelet, los = rec.loadouts || [];
    for (var i = 0; i < los.length; i++) if (los[i] && los[i].label === label && los[i].bracelet) { br = los[i].bracelet; break; }
    if (!br || (br.numRerolls == null && br.numTicketRerolls == null)) return null;
    // lostark.bible's two counts are the rolls USED against a fresh bracelet's 4
    // and 3 (loa-bracelet-calc/docs/research/mechanics-bible-leaderboard.md), so
    // 4 and 3 is a bracelet with nothing left. This page summed them as rolls
    // left until 2026-09-25.
    var base = br.numRerolls || 0, ticket = br.numTicketRerolls || 0;
    return { base: base, ticket: ticket, left: Math.max(0, 4 - base) + Math.max(0, 3 - ticket) };
  }
  /** A board row, or scoreRecord()'s copy of one -> the bracelet overview. */
  function brPart(x, rec, onBoard) {
    var axis = x.role === "support" ? "support" : "dps";
    var reading = axis === "support" ? x.sup : x.dps;
    var lo = loadoutInfo(x.lo, rec);
    var band = traitBand(x.grade), aGrade = x.grade === "relic" ? "a Relic" : "an Ancient";
    var traits = x.traits.map(function (t) {
      return { family: t.family, label: TRAIT_LABEL[t.family] || t.family || "Trait", short: TRAIT_SHORT[t.family] || t.family || "Trait", value: t.value };
    });
    return {
      st: "ok", onBoard: onBoard, grade: x.grade, axis: axis, pct: reading ? reading.pct : null,
      lines: x.lines.map(function (l) { var v = lineView(l, x.grade); v.raw = l; return v; }),
      traits: traits,
      loItems: (x.lo && x.lo.items) ? x.lo.items : null,
      traitsGloss: traits.length ? traits.map(function (t) { return t.label + " " + nf(t.value); }).join(" and ") +
        ": the combat traits the bracelet came with." +
        (band ? " On " + aGrade + " bracelet each rolls " + band[0] + " to " + band[1] + ", and higher is better." : "") : "",
      gradeGloss: "The bracelet's grade. " + (x.grade === "relic" ? "A Relic" : "An Ancient") + " bracelet rolls combat traits from " +
        (band ? band[0] + " to " + band[1] : "its band") + " and grants " + grantedWords(x.grade) + " lines to reroll.",
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
    var loName = lo ? (lo.label || loadoutLabel(lo.classification)) : "chosen";
    var missing = "lostark.bible did not report this for the loadout.";
    function row(label, value, gloss) {
      var none = value == null || value === "";
      rows.push([label, none ? "—" : value, none ? missing : gloss]);
    }

    var ilvl = isNum(pr.itemLevel) ? pr.itemLevel : rec.itemLevel;
    row("Item level", isNum(ilvl) ? nf(Math.floor(ilvl * 100) / 100, 2) : null,
      "Item level of the " + loName + " loadout on lostark.bible.");
    row("Combat power", isNum(pr.combatPower) ? nf(pr.combatPower, 2) : null,
      "lostark.bible's combat power for this loadout" +
      (raw.combatPowerSource ? " (its " + raw.combatPowerSource.replace(/([A-Z])/g, " $1").toLowerCase() + ")." : "."));
    row("Main stat", isNum(raw.mainStatTotal) ? nf(raw.mainStatTotal) : null,
      "Strength, dexterity or intelligence in total." +
      (isNum(pr.accessoryMainStat) ? " The five accessories carry " + nf(pr.accessoryMainStat) + " of it." : ""));
    row("Weapon power", isNum(raw.weaponPowerTotal) ? nf(raw.weaponPowerTotal) : null,
      "Total weapon power, as lostark.bible reports it for this loadout.");
    row("Base attack power", isNum(raw.baseAttackPower) ? nf(raw.baseAttackPower) : null,
      "Attack power before the gem and stone bonus." +
      (isNum(pr.apPct) ? " Gems and the ability stone add " + fx(pr.apPct, 1) + "% on top." : ""));

    var gemTxt = null, gemGloss = "";
    if (Array.isArray(pr.gemLevels) && pr.gemLevels.length) {
      var byLv = {};
      pr.gemLevels.forEach(function (lv) { byLv[lv] = (byLv[lv] || 0) + 1; });
      var parts = [];
      Object.keys(byLv).sort(function (a, b) { return b - a; }).forEach(function (lv) { parts.push(byLv[lv] + " × lv" + lv); });
      gemTxt = parts.join(", ");
      gemGloss = "Skill gem levels. With the ability stone they add " + (isNum(pr.apPct) ? fx(pr.apPct, 1) + "%" : "their share of") +
        " attack power; higher levels add more.";
    } else if (raw.gemsAssumed) {
      gemTxt = "not readable";
      gemGloss = "The page carries no readable gems, so the calculator assumes " + raw.gemsAssumed + ".";
    }
    row("Gems", gemTxt, gemGloss);
    row("Ability stone", Array.isArray(raw.stoneNodes) && raw.stoneNodes.length ? raw.stoneNodes.join(" / ") : null,
      "The stone's engraving nodes, highest first, the malus included." +
      (pr.stone97 != null ? (pr.stone97 ? " The two combat engravings total 5 or more, which adds 1.5% attack power." :
        " The two combat engravings total less than 5, so the stone adds no attack power.") : ""));

    var km = raw.karma || {};
    row("Karma", km.evolution != null ? [km.evolution, km.enlightenment, km.leap].join(" / ") : null,
      km.evolution != null ? "Evolution " + km.evolution + " · Enlightenment " + km.enlightenment + " · Leap " + km.leap +
        (isNum(pr.karmaWp) ? ". Enlightenment gives +" + fx(pr.karmaWp, 1) + "% weapon power." : ".") : "");
    var ap = pr.apPoints || {};
    row("Ark passive", ap.evolution != null ? [ap.evolution, ap.enlightenment, ap.leap].join(" / ") : null,
      ap.evolution != null ? "Evolution " + ap.evolution + " · Enlightenment " + ap.enlightenment + " · Leap " + ap.leap +
        " points." + (pr.master != null ? (pr.master ? " The Master node is on." : " No Master node.") : "") : "");

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
    row("Honing", honTxt, "Weapon / armour honing. " + honGloss.join(" · ") + ".");

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
      Array.isArray(cores) && cores.length ? "The Ark Grid's cores and each one's points: " +
        cores.map(function (c) { return c.points; }).join(", ") + ". The astrogem section below grades their gems." : "");

    return { st: "ok", loadout: lo ? loName : "", rows: rows };
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
  function agAxis(res) { return res.axis === "support" ? "support" : "dps"; }
  function agPart(res, rec) {
    if (!res.gems) return { st: "none", msg: "No astrogems on this character." };
    if (!res.valid) return { st: "none", msg: "None of the " + res.gems + " gems could be read." };
    // The axis the Grader opens this character on (LoadoutEcon.defaultModeFor):
    // Support for a support class whose gems carry mostly support effects.
    var axis = agAxis(res), a = axis === "support" ? res.sup : res.dps;
    return {
      st: "ok", axis: axis, quality: a.quality, letter: a.letter, bg: a.bg, fg: a.fg, dmg: a.dmg,
      gems: res.gems, valid: res.valid, cores: res.cores, order: res.order, chaos: res.chaos, tiers: res.tiers,
      pulledAt: isNum(rec.pulledAt) ? rec.pulledAt : null, stale: !!rec.stale, supportMain: !!res.supportMain,
      dps: res.dps, sup: res.supportClass ? res.sup : null,
      table: res.table, ladders: res.ladders, tierBounds: res.tierBounds
    };
  }

  // ------------------------------------------------------------------ the character model

  var PARTS = ["head", "br", "brRank", "ag", "agRank", "stats"];
  // What is saved and restored. The GPD part is not in PARTS: it loads after the
  // cards, and "complete" keeps timing the six parts it always has.
  var KEPT = PARTS.concat(["gpd"]);

  function emptyModel(region, name) {
    var m = { v: VIEW_V, region: region, name: name };
    KEPT.forEach(function (k) { m[k] = { st: "loading" }; });
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
    KEPT.forEach(function (k) {
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
    // The GPD overview reads both records, so it starts once both of theirs have painted.
    if (!ctx.gpdArmed && ctx.fresh.br && ctx.fresh.ag) { ctx.gpdArmed = true; queueGpd(ctx); }
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
    var sub, regionHtml = '<span' + gl(REGION_GLOSS[ctx.region] || ctx.region) + ">" + ctx.region + "</span>";
    if (h.st === "ok") {
      var bits = [regionHtml];
      if (isNum(h.ilvl)) bits.push('<span' + gl("Item level on lostark.bible, as the owner last synced it.") + ">" +
        nf(Math.floor(h.ilvl * 100) / 100, 2) + "</span>");
      if (h.cls) bits.push('<span' + gl(isSupportCls(h.cls) ?
        "A support class: the bracelet and astrogem boards can read it as a support." :
        "A damage-dealer class: the boards read it as a damage dealer.") + ">" + esc(CLASS_LABEL[h.cls] || h.cls) + "</span>");
      sub = bits.join(" · ");
    } else if (h.st === "loading") {
      sub = regionHtml + ' · <span class="sk" style="width:11em"></span>';
    } else {
      sub = regionHtml;
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
      html = '<span' + gl("Read from lostark.bible on " + new Date(h.pulledAt).toLocaleString() + "." +
        (stale ? " Over a week old: Update reads it again." : " The page can lag the game by whatever the owner has not synced.")) +
        (stale ? ' class="lp-old"' : "") + ">Pulled " + ageLabel(h.pulledAt) + "</span>";
    } else if (h.st === "loading") {
      html = SKEL["lp-pulled"];
    } else {
      html = '<span' + gl("There is no bracelet record for this character yet.") + ">Not pulled</span>";
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
    btn.setAttribute("data-gloss", busy
      ? "Waiting for lostark.bible: the bracelet service reads one character page at a time, so a queue can form."
      : wait > 0
        ? "Pulled " + ageLabel(h.pulledAt) + ". Update opens " + inLabel(wait) + ", five minutes after the last pull, so repeat clicks do not use up lookups."
        : "Reads this character's bracelet record again from lostark.bible. Astrogems are pulled from the Astrogem Calculator.");
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

  /** The bracelet board's reading, in words and glosses, for the tile and the overview's headline. */
  function brBits(ctx) {
    var r = ctx.model.brRank;
    if (!r || r.st !== "ok") return null;
    var sup = r.axis === "support", board = sup ? "Support" : "DPS", relic = ctx.model.br && ctx.model.br.grade === "relic";
    return {
      sup: sup, board: board,
      badgeGloss: r.key + " on the " + (sup ? "support ladder, cut so each letter is as rare as on the damage-dealer one: " :
        "damage-dealer ladder, which bands the 0–100 grade: ") + ladderWords(brCuts(r.axis), r.key) + "." +
        (r.perfect ? " The rainbow marks the best bracelet the game can roll." : ""),
      scoreGloss: "The whole bracelet on a 0–100 scale: 0 is the worst drop the game gives, and 100 is the three best effect families at Epic with both traits at " +
        (relic ? "92" : "110") + ". Better lines or traits raise it, and it can pass 100.",
      pctGloss: sup ? "What one damage dealer next to this support gains from the bracelet. The Support board ranks on this." :
        "What the whole bracelet adds to damage on the calculator's default character. The board ranks on this.",
      // Two sentences at most: where the place comes from, then the other board.
      rankGloss: !r.rank ? "The board did not answer, so this pull has no place yet." :
        (r.stale ? (r.estimated ? "Where this pull would place on" : "Place on") + " the " + r.region + " " + board +
            " board's copy from " + ageLabel(r.builtAt) + ", since the board did not answer."
          : r.estimated ? "Where this pull would place: the board, rebuilt every 10 minutes, has not picked it up yet."
          : "Place on the " + r.region + " " + board + " board, which ranks by " + (sup ? "what one damage dealer gains." : "damage %.")) +
        (r.other ? " Also #" + nf(r.other.rank) + " of " + nf(r.other.count) + " on the " + (r.other.axis === "support" ? "Support" : "DPS") +
          " board, " + r.other.key + (isNum(r.other.pct) ? " at " + fx(r.other.pct, 2) + "%" : "") + "." : ""),
      topGloss: r.rank ? "#" + nf(r.rank) + " divided by " + nf(r.count) + ": the share of the board at or above this bracelet." : "",
      score: isNum(r.score) ? fx(r.score, 1) : "—",
      pct: (isNum(r.pct) ? fx(r.pct, 2) + "%" : "—") + (sup ? " per dealer" : " damage"),
      rankTxt: r.rank ? (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region : "Rank unavailable",
      sub2: r.rank ? topPct(r.rank, r.count) + " · " + board + " board" : board + " board"
    };
  }
  function brTileHtml(ctx) {
    var r = ctx.model.brRank;
    if (!r || r.st === "loading") return SKEL["lp-tile-br-body"];
    if (r.st !== "ok") return '<div class="lp-tmsg">' + esc(r.msg || "No bracelet rank.") + "</div>";
    var b = brBits(ctx);
    return badgeHtml(r.key, r.bg, r.fg, r.cls, b.badgeGloss, true) +
      '<div class="lp-tnum"><div class="lp-tscore"' + gl(b.scoreGloss) + ">" + b.score + "</div>" +
      '<div class="lp-tsub"' + gl(b.pctGloss) + ">" + b.pct + "</div></div>" +
      '<div class="lp-trank"><div class="lp-trk"' + gl(b.rankGloss) + ">" + b.rankTxt + "</div>" +
      '<div class="lp-tsub"' + gl(b.topGloss) + ">" + esc(b.sub2) + "</div></div>";
  }
  /** The bracelet overview's headline: letter · grade · damage · place. */
  function brFigHtml(ctx) {
    var r = ctx.model.brRank;
    if (!r || r.st === "loading") return SKEL["lp-br-fig"];
    if (r.st !== "ok") return '<span class="lp-fx lp-dim">' + esc(r.msg || "No bracelet rank.") + "</span>";
    var b = brBits(ctx);
    return badgeHtml(r.key, r.bg, r.fg, r.cls, b.badgeGloss, false) +
      '<span class="lp-fx"><span' + gl(b.scoreGloss) + ">" + b.score + '</span> · <span' + gl(b.pctGloss) + ">" + b.pct +
      '</span> · <span' + gl(b.rankGloss) + ">" + b.rankTxt + "</span></span>";
  }
  function agTileHtml(ctx) {
    var a = ctx.model.ag, r = ctx.model.agRank;
    if (!a || a.st === "loading") return SKEL["lp-tile-ag-body"];
    if (a.st !== "ok") return '<div class="lp-tmsg">' + esc(a.msg || "No astrogem data.") + "</div>";
    var sup = a.axis === "support";
    var badgeGloss = agBadgeGloss(a);
    var rankBlock;
    if (!r || r.st === "loading") {
      rankBlock = '<div class="lp-trk"><span class="sk" style="width:7.5em"></span></div><div class="lp-tsub"><span class="sk" style="width:6em"></span></div>';
    } else if (r.st !== "ok") {
      rankBlock = '<div class="lp-trk lp-dim"' + gl("The astrogem board could not be read just now.") + ">Rank unavailable</div>" +
        '<div class="lp-tsub">' + esc(r.msg || "") + "</div>";
    } else {
      var rb = r.axis === "support" ? "Support" : "DPS";
      rankBlock = '<div class="lp-trk"' + gl(agRankGloss(r)) + ">" + (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region + "</div>" +
        '<div class="lp-tsub"' + gl("#" + nf(r.rank) + " divided by " + nf(r.count) + ": the share of the board at or above this grid.") + ">" +
        topPct(r.rank, r.count) + " · " + rb + " board</div>";
    }
    return badgeHtml(a.letter, a.bg, a.fg, "", badgeGloss, true) +
      '<div class="lp-tnum"><div class="lp-tscore"' + gl(agQualityGloss()) + ">" + fx(a.quality, 1) + "</div>" +
      '<div class="lp-tsub"' + gl(agDmgGloss(sup)) + ">" + fx(a.dmg, 2) + "%" + (sup ? " party dmg" : " grid dmg") + "</div></div>" +
      '<div class="lp-trank">' + rankBlock + "</div>";
  }
  function agBadgeGloss(a) {
    var sup = a.axis === "support";
    return a.letter + " on the astrogem " + (sup ? "support" : "damage-dealer") + " ladder: " +
      ladderWords(a.ladders && a.ladders[sup ? "support" : "dps"], a.letter) + ".";
  }
  /** The astrogem overview's headline: letter · quality · grid damage · place. */
  function agFigHtml(ctx) {
    var a = ctx.model.ag, r = ctx.model.agRank;
    if (!a || a.st === "loading") return SKEL["lp-ag-fig"];
    if (a.st !== "ok") return '<span class="lp-fx lp-dim">' + esc(a.msg || "No astrogem data.") + "</span>";
    var sup = a.axis === "support", place;
    if (!r || r.st === "loading") place = '<span class="sk" style="width:7.5em"></span>';
    else if (r.st !== "ok") place = '<span class="lp-dim"' + gl("The astrogem board could not be read just now.") + ">rank unavailable</span>";
    else place = "<span" + gl(agRankGloss(r)) + ">" + (r.estimated ? "≈ #" : "#") + nf(r.rank) + " of " + nf(r.count) + " " + r.region + "</span>";
    return badgeHtml(a.letter, a.bg, a.fg, "", agBadgeGloss(a), false) +
      '<span class="lp-fx"><span' + gl(agQualityGloss()) + ">" + fx(a.quality, 1) + " quality</span> · <span" + gl(agDmgGloss(sup)) + ">" +
      fx(a.dmg, 2) + "%" + (sup ? " party dmg" : " grid dmg") + "</span> · " + place + "</span>";
  }
  // The quality sentence, then a second one: the ladder when the caller has it,
  // else the fact that a gem's core does not move it. Two sentences, never three.
  function agQualityGloss(second) {
    return "The astrogem leaderboard's quality: a geometric mean of the gems' values on the grade scale, where a perfect Ark Grid layout averages 100. " +
      (second || "Moving a gem to another core does not change it.");
  }
  function agDmgGloss(sup) {
    return sup ? "The party-damage buff this grid gives one ally. The Support board ranks on this." :
      "What the whole grid adds over no grid. The DPS board ranks on this.";
  }
  function agRankGloss(r) {
    var rb = r.axis === "support" ? "Support" : "DPS";
    return (r.estimated ? "Where this grid would place: the board, rebuilt at most every 30 minutes, does not hold it yet."
        : "Place on the " + r.region + " " + rb + " board (built " + ageLabel(r.builtAt) + "), which ranks by " + (r.axis === "support" ? "party damage." : "total grid damage.")) +
      (r.other ? " Also #" + nf(r.other.rank) + " of " + nf(r.other.count) + " on the " + (r.other.axis === "support" ? "Support" : "DPS") + " board." : "");
  }
  function renderStrip(ctx) {
    setHtml("lp-tile-br-body", brTileHtml(ctx));
    setHtml("lp-tile-ag-body", agTileHtml(ctx));
    var br = ctx.model.brRank, ag = ctx.model.ag;
    var brOk = br && br.st === "ok", agOk = ag && ag.st === "ok";
    setText("lp-tile-br-axis", brOk ? (br.axis === "support" ? "Support" : "DPS") : "");
    setGloss("lp-tile-br-axis", brOk ? (br.axis === "support"
      ? "Read as a support. The Support board ranks Bard, Paladin, Artist and Valkyrie by what one damage dealer gains from the bracelet."
      : "Read as a damage dealer. The DPS board ranks characters by what the bracelet adds to their own damage.") : "");
    setHtml("lp-tile-gpd-body", gpdTileHtml(ctx));
    var gp = ctx.model.gpd, gpOk = gp && gp.st === "ok";
    setText("lp-tile-gpd-axis", gpOk ? (gp.axis === "support" ? "Support" : "DPS") : "");
    setGloss("lp-tile-gpd-axis", gpOk ? gpdAxisWords(gp.axis) : "");
    setText("lp-tile-ag-axis", agOk ? (ag.axis === "support" ? "Support" : "DPS") : "");
    setGloss("lp-tile-ag-axis", agOk ? (ag.axis === "support"
      ? "Graded as a support, the way the Grader opens this character: a support class whose gems carry mostly support effects."
      : "Graded as a damage dealer, the way the Grader opens this character.") : "");
    // the overviews' headlines read the same parts as the tiles
    setHtml("lp-br-fig", brFigHtml(ctx));
    setHtml("lp-ag-fig", agFigHtml(ctx));
    setHtml("lp-gpd-fig", gpdFigHtml(ctx));
  }

  /**
   * Per-line and per-trait damage from the calculator's model, priced on the
   * board's default character (the same bare profile the calculator's "Line by
   * line" table uses). null until the model has loaded: the overview paints
   * without the column first and fills it in when the scripts land, so a
   * character the board already knows is never held back by them.
   */
  function brDetail(b) {
    var Br = window.Bracelet;
    if (!Br || !Br.lineDamage || !Br.traitDamage || !Br.damagePercent || !window.Subrank) return null;
    // A copy saved before the lines carried their raw form cannot be priced; it
    // goes without the column until the network answer replaces it.
    for (var j = 0; j < b.lines.length; j++) if (!b.lines[j].raw && !b.lines[j].unk) return null;
    for (j = 0; j < b.traits.length; j++) if (!b.traits[j].family) return null;
    var prof = profiles()[b.axis === "support" ? "support" : "dps"];
    var linesD = 0, perLine = [], i;
    for (i = 0; i < b.lines.length; i++) {
      var raw = b.lines[i].raw, d = 0;
      if (raw && !b.lines[i].unk && raw.cat !== "trait") { try { d = Br.lineDamage(raw, b.grade, prof) || 0; } catch (e) { d = 0; } }
      perLine.push(d);
      linesD += d;
    }
    var perTrait = [], traitsD = 0;
    for (i = 0; i < b.traits.length; i++) {
      var one = {}, td = 0;
      one[b.traits[i].family === "swiftness" ? "swift" : b.traits[i].family] = b.traits[i].value;
      try { td = Br.traitDamage(one, prof) || 0; } catch (e) { td = 0; }
      perTrait.push(td);
      traitsD += td;
    }
    var total = linesD + traitsD;
    return { perLine: perLine, perTrait: perTrait, linesPct: Br.damagePercent(linesD), traitsPct: Br.damagePercent(traitsD),
      total: total, pct: function (d) { return Br.damagePercent(d); },
      share: function (d) { return total > 1e-9 ? Math.round(d / total * 100) : null; } };
  }
  function signPct(x) { return (x >= 0 ? "+" : "\u2212") + fx(Math.abs(x), 2) + "%"; }

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
    var sup = b.axis === "support";
    var det = brDetail(b);
    if (!det && !ctx.brDetailAsked) {
      // The model is not here yet: paint now, fill the damage column when it lands.
      ctx.brDetailAsked = true;
      loadBraceletModel().then(function () { if (isLive(ctx) && ctx.model.br === b) renderBracelet(ctx); }, function () {});
    }
    var h = '<div class="lp-lines' + (det ? " has-dmg" : "") + '">';
    b.lines.forEach(function (l, i) {
      var nameGloss = (l.full || "") + (l.fixed ? " This line is locked." : "");
      var tier = l.tier ? '<span class="lp-tier" style="color:' + TIER_COLOR[l.tier] + '"' + gl(l.tierGloss) + ">" + TIER_WORD[l.tier] + "</span>"
        : '<span class="lp-tier"></span>';
      var dmg = "";
      if (det) {
        var d = det.perLine[i], sh = det.share(d);
        var why = d > 1e-9
          ? signPct(det.pct(d)) + " damage on the calculator\u2019s default character" + (sh != null ? ", " + sh + "% of what this bracelet adds" : "") +
            ". Lines multiply rather than add, so the column comes to a shade over the total."
          : "This line adds no damage the model can price" + (l.raw && l.raw.cat === "trait" ? ": a combat trait in a rerollable slot scores zero." :
            l.raw && l.raw.family === "vitality" ? ": vitality is survivability." : ".");
        dmg = '<span class="lp-ldmg' + (d > 1e-9 ? "" : " z") + '"' + gl(why) + ">" + (d > 1e-9 ? signPct(det.pct(d)) : "0%") + "</span>";
      }
      h += '<div class="lp-line' + (l.unk ? " unk" : "") + '">' +
        '<span class="lp-lname"' + gl(nameGloss) + ">" + esc(l.name) +
        (l.fixed ? ' <span class="lp-lock" aria-label="locked">&#128274;</span>' : "") + "</span>" +
        tier + '<span class="lp-lval"' + gl(l.valueGloss) + ">" + esc(l.value) + "</span>" + dmg + "</div>";
    });
    if (!b.lines.length) h += '<div class="lp-line"><span class="lp-lname lp-dim">No effect lines</span><span></span><span></span></div>';
    h += "</div>";

    // The four categories, each with its figure and the detail under it.
    var traits = b.traits.length ? b.traits.map(function (t) { return esc(t.short || t.label) + " " + nf(t.value); }).join(" \u00b7 ") : "\u2014";
    var traitSub = "";
    if (b.traits.length && det) {
      traitSub = b.traits.map(function (t, i) { return esc(t.short || t.label) + " " + signPct(det.pct(det.perTrait[i])); }).join(" \u00b7 ");
    } else if (b.traits.length) {
      var band = traitBand(b.grade);
      traitSub = band ? "each rolls " + band[0] + "\u2013" + band[1] + " on " + (b.grade === "relic" ? "Relic" : "Ancient") : "";
    }
    var dmgSub = det ? "lines " + signPct(det.linesPct) + " \u00b7 traits " + signPct(det.traitsPct) : "";
    var dmgGloss = (sup ? "What one damage dealer next to this support gains from the bracelet, on the default support. The Support board ranks on it." :
      "What the whole bracelet adds to damage on the calculator's default character. The board ranks on it.") +
      (det ? " Under it, the effect lines and the combat traits priced on their own; together they multiply, and crit pools across them, so the pair comes in near the total rather than on it." : "");
    var rolls = b.rolls ? String(b.rolls.left) : "\u2014";
    var rollSub = b.rolls ? b.rolls.base + " of 4 regular \u00b7 " + b.rolls.ticket + " of 3 ticket used" : "not reported";
    var loSub = "";
    if (b.loItems && b.loItems.length > 1) {
      loSub = b.loItems.map(function (it) { return esc(it.label) + " " + (isNum(it.pct) ? fx(it.pct, 2) + "%" : "\u2014"); }).join(" \u00b7 ");
    } else if (b.loadoutNote) {
      loSub = b.loadoutNote.replace(/^The only lostark\.bible loadout on the record\.?$/, "the only loadout on the record")
        .replace(/^Every lostark\.bible loadout on the record wears this bracelet\.?$/, "every loadout wears this bracelet")
        .replace(/^The record names no loadout\.?$/, "no loadout named");
    }
    function kv(gloss, k, v, sub, strong) {
      return "<div" + gl(gloss) + '><span class="k">' + k + '</span><span class="v' + (strong ? " lp-strong" : "") + '">' + v + "</span>" +
        '<span class="s">' + (sub || "") + "</span></div>";
    }
    h += '<div class="lp-kv">' +
      kv(b.traitsGloss || "The record lists no combat traits for this bracelet.", "Combat traits", traits, traitSub) +
      kv(dmgGloss, sup ? "Per dealer" : "Damage", isNum(b.pct) ? fx(b.pct, 2) + "%" : "\u2014", dmgSub, true) +
      kv(b.rolls ? b.rolls.base + " of 4 regular and " + b.rolls.ticket + " of 3 ticket rerolls used, as lostark.bible reports them, so " + b.rolls.left + " left. The calculator reads them the same way."
        : "lostark.bible does not report the rerolls for this bracelet.", "Rolls left", rolls, rollSub) +
      kv(b.loadoutNote || "", "Loadout", esc(b.loadout || "\u2014"), loSub) +
      "</div>";
    if (b.unmapped) h += '<div class="lp-warn">' + b.unmapped + " line" + (b.unmapped === 1 ? " uses" : "s use") + " a stat index the model does not map yet.</div>";
    setHtml("lp-br-body", h);
    setHtml("lp-br-grade", '<span class="lp-grade ' + b.grade + '"' + gl(b.gradeGloss) + ">" + (b.grade === "relic" ? "Relic" : "Ancient") + "</span>");
  }

  function renderAstro(ctx) {
    var a = ctx.model.ag, card = $("lp-ov-ag");
    var sup = !!(a && a.st === "ok" && a.axis === "support");
    if (card) { card.classList.toggle("axis-support", sup); card.classList.toggle("axis-dps", !sup); }
    if (!a || a.st === "loading") { setHtml("lp-ag-body", SKEL["lp-ag-body"]); setText("lp-ag-src", ""); setGloss("lp-ag-src", ""); return; }
    if (a.st !== "ok" || !a.table) {
      setHtml("lp-ag-body", '<div class="lp-cmsg' + (a.st === "error" ? " err" : "") + '">' + esc(a.msg || "No astrogem data.") + "</div>");
      setText("lp-ag-src", "");
      setGloss("lp-ag-src", "");
      return;
    }
    var t = a.table, axisWord = sup ? "support" : "damage-dealer";
    setText("lp-ag-src", "Raid loadout · " + (sup ? "Support" : "DPS") + " axis");
    setGloss("lp-ag-src", "The raid preset's gems, graded on the " + axisWord + " axis: the preset and axis the Grader opens this character on.");
    var bounds = a.tierBounds || {};
    function tierName(k) { return k === "ancient" ? "Ancient" : k === "relic" ? "Relic" : "Legendary"; }
    function tierGloss(k) {
      var b = bounds[k];
      return tierName(k) + ": the gem's four levels (willpower, points and both effects) add up to " + (b ? b.min + " to " + b.max : "this band") + ".";
    }
    // Order and Chaos, as the Grader heads its two sections
    function sec(type) {
      var sc = t.sections && t.sections[type], word = type === "chaos" ? "Chaos" : "Order";
      if (!sc) return '<div class="lp-sec"><span class="ctype">' + word + '</span><span class="lp-sx lp-dim">no ' + word + " cores</span></div>";
      return '<div class="lp-sec"' + gl("All " + word + " cores together, as the Grader heads them: " + sc.cores + " cores, " + sc.gems + " gems and " + sc.pts +
          " points. The gems' own figures add up to " + fx(sc.rel, 2) + "%, and the points past 17 add " + fx(sc.orderDmg, 2) + "% to the grid total.") + ">" +
        '<span class="ctype">' + word + '</span><span class="lp-sx"><b class="ax">' + fx(sc.rel, 2) + "% dmg</b> · " + sc.pts + " points · " +
        sc.gems + " gems · " + sc.cores + " cores</span></div>";
    }
    var h = '<div class="lp-agsec">' + sec("order") + sec("chaos") + "</div>" +
      '<div class="lp-agfoot"><div class="lp-agtiers">' + ["ancient", "relic", "legendary"].map(function (k) {
        return '<span class="lp-tchip ' + k + '"' + gl(tierGloss(k)) + "><b>" + (a.tiers[k] || 0) + "</b> " + tierName(k) + "</span>";
      }).join("") + "</div>" +
      '<div class="lp-agmeta"><span' + gl("The Grader's average: the plain mean of the gem grades, on the " + axisWord +
        " axis. It sits a little apart from Quality, which averages the gems' values another way.") + ">Avg grade <b>" + fx(t.avgGrade, 1) + "</b> " + esc(t.avgRank) + "</span>" +
      '<span class="lp-sep"> · </span><span' + gl(a.order + " Order and " + a.chaos + " Chaos gems in " + a.cores + " cores, from the raid loadout." +
        (a.valid < a.gems ? " " + (a.gems - a.valid) + " could not be read and are left out." : "")) + ">" + a.gems + " gems</span>" +
      '<span class="lp-sep"> · </span><span' + gl("When the astrogem service last read this character from lostark.bible." +
        (a.stale ? " Over a week old: the Astrogem Calculator pulls it again." : "")) + ">pulled " + (a.pulledAt ? ageLabel(a.pulledAt) : "—") + "</span></div></div>";
    setHtml("lp-ag-body", h);
  }

  /** One line under the bracelet: the raid loadout's figures the calculators start from. */
  var ASSUME = [["Item level", "ilvl"], ["Weapon power", "weapon power"], ["Main stat", "main stat"],
    ["Crit", "crit"], ["Specialization", "spec"], ["Swiftness", "swift"]];
  function renderStats(ctx) {
    var s = ctx.model.stats;
    if (!s || s.st === "loading") { setHtml("lp-stats-line", SKEL["lp-stats-line"]); return; }
    if (s.st !== "ok") { setHtml("lp-stats-line", '<span class="lp-dim">' + esc(s.msg || "No stats.") + "</span>"); return; }
    var byLabel = {}, parts = [];
    s.rows.forEach(function (r) { byLabel[r[0]] = r; });
    ASSUME.forEach(function (w) {
      var r = byLabel[w[0]];
      if (r && r[1] !== "—") parts.push("<span" + gl(r[2]) + "><b>" + esc(r[1]) + "</b> " + w[1] + "</span>");
    });
    var sep = '<span class="lp-sep">·</span>';
    setHtml("lp-stats-line", (parts.length ? parts.join(sep) : '<span class="lp-dim">lostark.bible reported none of these.</span>') +
      (s.loadout ? sep + '<span class="lp-dim"' + gl("The lostark.bible loadout these figures come from: the one the bracelet calculator opens on.") + ">" +
        esc(s.loadout) + " loadout</span>" : ""));
  }

  // ------------------------------------------------------------------ gold per 1% damage (the GPD chart's lookup)

  // What each ladder is, in the chart's own terms (loa-gpd/README.md).
  var GPD_SYSTEM = {
    armor: "All five armour pieces honed together on the T4 Upper normal track, +11 to +25.",
    weapon: "The weapon honed on its own on the T4 Upper normal track, +11 to +25.",
    gems: "Levelling the whole skill gem set, one level at a time; your lowest gem sets the rung.",
    karma: "Karmic Enlightenment, from level 21 to 30.",
    neck: "Necklaces from the accessory calculator's price lattice, from the growth shop piece up.",
    ring: "Rings from the accessory calculator's price lattice, from the growth shop piece up; the weaker of your two sets the rung.",
    earring: "Earrings from the accessory calculator's price lattice, from the growth shop piece up; the weaker of your two sets the rung.",
    bracelet: "The bracelet calculator's F to S+ ladder, priced by rolling bracelets until one reads the letter.",
    arkgridEpic: "The ark grid filled from epic astrogems, priced along a simulated account's build.",
    arkgridRare: "The ark grid filled from rare astrogems, priced along a simulated account's build.",
    stone: "Faceting Ancient ability stones, from 7-7 up to 9-7."
  };
  // What would move a step's price (the ark grid and the accessories say it in their own sentence).
  var GPD_MOVER = {
    armor: "Material prices move it; the chart uses its defaults, with shards taken as bound.",
    weapon: "Material prices move it; the chart uses its defaults, with shards taken as bound.",
    gems: "The level-8 gem's price moves it; the chart takes 420k.",
    karma: "It is 900 gold a try with the Destiny Stones taken as owned, so no market price moves it.",
    bracelet: "Bracelet and pheon prices move it, and so do the odds of rolling this letter.",
    stone: "Stone and pheon prices move it.",
    acc: "Accessory prices move it, and so do the chart's switches: only pieces with no flat line and a high main stat count here."
  };
  var GPD_ACC = { neck: "necklace", ring: "ring", earring: "earring" };
  var GPD_HEAD = "";   // the table's header row, glosses and all, read off the skeleton at boot

  function gpdCap(t) { t = String(t || ""); return t.charAt(0).toUpperCase() + t.slice(1); }
  function gpdPct(x) { return isNum(x) ? (Math.abs(x) < 0.1 ? fx(x, 3) : fx(x, 2)) + "%" : "?"; }
  function gpdAxisWords(axis) {
    return axis === "support"
      ? "Graded on the support ladders: damage is what the support hands the party, and gold per 1% counts all three dealers."
      : "Graded on the DPS ladders: damage is the character's own.";
  }
  /** "high/low · wpn high flat · low stat", in words. */
  function gpdAccWords(k, label) {
    var p = String(label || "").split(" · ");
    if (p.length !== 3) return "The next " + GPD_ACC[k] + " to buy: " + label + ".";
    var prims = p[0].indexOf("/") >= 0 ? "primary lines at " + p[0] : "a primary line at " + p[0];
    var f = p[1], m, flat;
    if (f === "no flat") flat = "no flat line";
    else if ((m = f.match(/^(atk|wpn) (\w+) flat$/))) flat = "a " + m[2] + " " + (m[1] === "atk" ? "Attack Power+" : "Weapon Power+") + " line";
    else if ((m = f.match(/^(\w+) flat$/))) flat = "a " + m[1] + " Weapon Power+ line";
    else flat = f;
    return "The next " + GPD_ACC[k] + " to buy: " + prims + ", " + flat + ", " + p[2].replace(/ stat$/, " main stat") + ".";
  }
  /** What the rung you stand on is, as the lookup read it. */
  function gpdYoursGloss(r) {
    if (r.why) return gpdCap(r.why) + ".";
    return "Read from the pull: " + r.seen + (r.detail ? " — " + r.detail : "") + "." +
      (r.under ? " That is under the ladder's first rung, so the next step is its first." : "");
  }
  /** What the next rung means. */
  function gpdNextGloss(r) {
    var n = r.next;
    if (!n) return "Nothing left on this ladder: no rung above yours.";
    if (GPD_ACC[r.k]) return gpdAccWords(r.k, n.to);
    if (r.k === "bracelet" && n.min) return n.to + " takes at least " + n.min + ".";
    return (n.min ? gpdCap(n.min) : n.to) + (n.note ? " (" + n.note + ")" : "") + ".";
  }
  /** How the step is priced, and what would move it. */
  function gpdPriceGloss(r, axis) {
    var n = r.next;
    if (!n) return "No rung above yours, so nothing to price.";
    var on = axis === "support" ? " on each of three dealers" : "";
    if (n.gpd == null) return "This step adds no damage on these ladders, so it has no price per 1%.";
    if (n.pd != null) return n.poolTxt + " gold of cutting and fusing buys " + gpdPct(n.pd) + " more damage" + on +
      " over this stretch of a simulated account's build, and every rung in it shares that rate. The raw astrogems count as free.";
    if (GPD_ACC[r.k]) {
      if (n.gpd === 0) return "The new " + GPD_ACC[r.k] + " sells for no more than yours is worth, so the swap costs only the pheons and the listing floor.";
      return n.goldTxt + " gold, the new " + GPD_ACC[r.k] + "'s price less what yours is worth, buys " + gpdPct(n.dmg) +
        " more damage" + on + ". " + GPD_MOVER.acc;
    }
    if (n.gpd === 0) return "It sits under the market floor, so it costs only the pheons and the listing floor.";
    return n.goldTxt + " gold buys " + gpdPct(n.dmg) + " more damage" + on + (n.buy ? ": " + n.buy : "") + "." +
      (GPD_MOVER[r.k] ? " " + GPD_MOVER[r.k] : "");
  }
  function gpdRow(g, key) {
    for (var i = 0; i < g.rows.length; i++) if (g.rows[i].k === key) return g.rows[i];
    return null;
  }

  /** The role this page already knows: the astrogem section's axis (the chart's
   *  own rule, a support class with a support gem set), else the class alone. */
  function gpdAxis(ctx) {
    var a = ctx.model.ag;
    if (a && a.st === "ok" && (a.axis === "support" || a.axis === "dps")) return a.axis;
    var cls = (ctx.brRec && ctx.brRec["class"]) || (ctx.agRec && ctx.agRec["class"]) || "";
    return isSupportCls(cls) ? "support" : "dps";
  }

  /** GpdLookup.place()'s answer, cut down to what the overview and the tile draw
   *  (it is saved with the rest of the character), cheapest next step first. */
  function gpdPart(pos, L, axis) {
    var rows = pos.list.map(function (e, i) {
      var graded = e.seen != null && !e.why, S = L.SERIES && L.SERIES[e.key];
      var r = { k: e.key, label: e.label, color: (S && S.color) || "", i: i,
        yours: (pos.labels && pos.labels[e.key]) || L.NOT_READ,
        seen: graded ? String(e.seen) : null, detail: graded ? (e.detail || null) : null,
        why: graded ? null : (e.why || "not in the pull"), under: graded && e.owned < 0 && !e.ownRung, next: null };
      var n = graded ? e.next : null;
      if (n) {
        var pooled = n.poolD > 0 && isNum(n.poolG);
        r.next = { to: String(n.to || n.label || ""), min: n.minimum || null, note: n.note || null, buy: n.buy || null,
          gpd: isNum(n.gpd) ? n.gpd : null, dmg: isNum(n.damage) ? n.damage : null,
          price: L.fmtGpd(n.gpd), goldTxt: L.fmtGold(n.gold),
          pd: pooled ? n.poolD : null, poolTxt: pooled ? L.fmtGold(n.poolG) : null };
      }
      return r;
    });
    // the chart's gear-list order: priced steps cheapest first, then ladders with
    // nothing left, then the systems the pull could not read
    function band(r) { return r.why ? 3 : !r.next ? 2 : r.next.gpd == null ? 1 : 0; }
    rows.sort(function (a, b) {
      return (band(a) - band(b)) || (band(a) === 0 ? a.next.gpd - b.next.gpd : 0) || (a.i - b.i);
    });
    var low = null;
    rows.forEach(function (r) {
      if (r.next && r.next.gpd != null && (!low || r.next.gpd < low.next.gpd)) low = r;
      delete r.i;
    });
    return { st: "ok", axis: axis, role: pos.role || null, best: pos.bestKey || null,
      low: !pos.bestKey && low ? low.k : null,
      cheap: pos.cheapest ? { text: pos.cheapest.text, price: pos.cheapest.price } : null, rows: rows };
  }

  var gpdLib = null;   // one load per page: { L: GpdLookup, st: ready()'s answer }
  function loadAstrogemModel() { return window.Astrogem ? Promise.resolve() : loadScripts([AG_MODEL_JS]); }
  function loadGpd() {
    if (gpdLib) return gpdLib;
    var lib = (window.GpdLookup ? Promise.resolve() : loadScripts([GPD_LIB])).then(function () {
      var L = window.GpdLookup;
      if (!L || !L.ready || !L.place) throw new Error("lookup.js did not load");
      // the bulk (the chart's four models and its tables) starts at once
      try { L.loadModels(); L.loadData(); } catch (e) {}
      return L;
    });
    // lookup.js would fetch the bracelet scorer and the astrogem model from www.
    // These are the same files at the tools' own pins (the astrogem worker has
    // already fetched its copy), and taking the scorer from here keeps subrank.js
    // from being run a second time under another address.
    var mine = Promise.all([loadBraceletModel().then(null, function () {}), loadAstrogemModel().then(null, function () {})]);
    var p = Promise.all([lib, mine]).then(function (a) {
      return a[0].ready().then(function (st) { return { L: a[0], st: st }; });
    });
    gpdLib = p;
    // anything that failed is asked for again next time; ready() refetches only that
    p.then(function (g) { if (!(g.st.ok && g.st.astrogem && g.st.bracelet) && gpdLib === p) gpdLib = null; },
      function () { if (gpdLib === p) gpdLib = null; });
    return p;
  }
  /** Place the character straight after the paint that put the overviews up. Not
   *  requestIdleCallback: the skeletons' shimmer keeps the page from ever idling,
   *  so it would wait out its whole timeout. A hidden tab paints no frames, hence
   *  the timer beside the frame. */
  function queueGpd(ctx) {
    if (!ctx.gpdArmed || ctx.gpdQueued || !isLive(ctx)) return;
    ctx.gpdQueued = true;
    var done = false;
    var go = function () { if (done) return; done = true; ctx.gpdQueued = false; runGpd(ctx); };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(go, 0); });
    setTimeout(go, 250);
  }
  function runGpd(ctx) {
    if (!isLive(ctx)) return;
    var nav = perfNav, t0 = pnow();
    mark("gpd-start");
    loadGpd().then(function (g) {
      if (!isLive(ctx)) return;
      var loadMs = pnow() - t0;
      mark("gpd-ready");
      if (!g.st.ok) { gpdFailed(ctx, "The GPD chart's tables did not load. Reload the page to try again."); return; }
      var axis = gpdAxis(ctx), pos = null, c0 = pnow();
      try { pos = g.L.place({ record: ctx.brRec, astro: ctx.agRec, axis: axis }); }
      catch (e) { gpdFailed(ctx, "The GPD lookup could not read this character."); return; }
      var computeMs = pnow() - c0;
      ctx.model.gpd = pos ? gpdPart(pos, g.L, axis)
        : { st: "none", msg: "No lostark.bible pull to place on the GPD ladders yet." };
      renderGpd(ctx);
      renderStrip(ctx);
      mark("gpd");
      if (nav) (nav.gpd = nav.gpd || []).push({ loadMs: Math.round(loadMs), computeMs: Math.round(computeMs * 10) / 10 });
      persist(ctx);
    }, function () {
      if (!isLive(ctx)) return;
      gpdFailed(ctx, "The GPD chart did not load. Reload the page to try again.");
    });
  }
  function gpdFailed(ctx, msg) {
    if (ctx.model.gpd && ctx.model.gpd.st === "ok") return;   // keep the saved copy
    ctx.model.gpd = { st: "error", msg: msg };
    renderGpd(ctx);
    renderStrip(ctx);
  }

  function gpdTileHtml(ctx) {
    var g = ctx.model.gpd;
    if (!g || g.st === "loading") return SKEL["lp-tile-gpd-body"];
    if (g.st !== "ok") return '<div class="lp-tmsg">' + esc(g.msg || "No GPD reading.") + "</div>";
    var per = "per 1% " + (g.axis === "support" ? "party " : "") + "dmg";
    var best = g.best ? gpdRow(g, g.best) : null;
    if (best && best.next) {
      var n = best.next;
      return '<div class="lp-tnum"' + gl(gpdPriceGloss(best, g.axis)) + '><div class="lp-tscore' + (n.price.length > 6 ? " lp-tsm" : "") + '">' +
          esc(n.price) + '</div><div class="lp-tsub">' + per + "</div></div>" +
        '<div class="lp-gstep"><div class="lp-gtext"' + gl(gpdNextGloss(best)) + '><span class="lp-gdot" style="background:' + esc(best.color) + '"></span>' +
          esc(best.label + " → " + n.to) + "</div>" +
        '<div class="lp-tsub"' + gl(gpdYoursGloss(best)) + ">yours: " + esc(best.yours) + "</div></div>";
    }
    var low = g.low ? gpdRow(g, g.low) : null;
    if (!low || !low.next) {
      return '<div class="lp-tnum"' + gl("No ladder the lookup can read has a next step, so there is nothing to price.") +
          '><div class="lp-tscore lp-dim">—</div><div class="lp-tsub">' + per + "</div></div>" +
        '<div class="lp-gstep"><div class="lp-gtext"' + gl("No ladder the lookup can read has a rung above this character's.") + ">Nothing left to buy</div>" +
        '<div class="lp-tsub">every read ladder is at its top</div></div>';
    }
    return '<div class="lp-tnum"' + gl(gpdPriceGloss(low, g.axis)) + '><div class="lp-tscore lp-dim' + (low.next.price.length > 6 ? " lp-tsm" : "") + '">' +
        esc(low.next.price) + '</div><div class="lp-tsub">' + per + "</div></div>" +
      '<div class="lp-gstep"><div class="lp-gtext"' + gl("Every next step left costs more than 25M per 1% damage, so the chart names no pick.") + ">Nothing under 25M/1%</div>" +
      '<div class="lp-tsub"' + gl(gpdNextGloss(low)) + ">cheapest left: " + esc(low.label + " → " + low.next.to) + "</div></div>";
  }

  /** The gold-per-1% overview's headline: the pick and its price. */
  function gpdFigHtml(ctx) {
    var g = ctx.model.gpd;
    if (!g || g.st === "loading") return SKEL["lp-gpd-fig"];
    if (g.st !== "ok") return '<span class="lp-fx lp-dim">' + esc(g.msg || "No GPD reading.") + "</span>";
    var best = g.best ? gpdRow(g, g.best) : null;
    if (best && best.next) {
      return '<span class="lp-gdot" style="background:' + esc(best.color) + '"></span><span class="lp-fx"><span' + gl(gpdNextGloss(best)) + ">" +
        esc(best.label + " → " + best.next.to) + "</span> at <span" + gl(gpdPriceGloss(best, g.axis)) + ">" + esc(best.next.price) + "/1%</span></span>";
    }
    var low = g.low ? gpdRow(g, g.low) : null;
    return '<span class="lp-fx"><span' + gl("Every next step left costs more than 25M per 1% damage, so the chart names no pick.") + ">Nothing under 25M/1%</span>" +
      (low && low.next ? " · <span" + gl(gpdPriceGloss(low, g.axis)) + ">cheapest left: " + esc(low.label + " → " + low.next.to + " at " + low.next.price + "/1%") + "</span>" : "") +
      "</span>";
  }
  function renderGpd(ctx) {
    var g = ctx.model.gpd;
    if (!g || g.st === "loading") { setHtml("lp-gpd-body", SKEL["lp-gpd-body"]); setText("lp-gpd-src", ""); setGloss("lp-gpd-src", ""); return; }
    if (g.st !== "ok") {
      setHtml("lp-gpd-body", '<div class="lp-cmsg' + (g.st === "error" ? " err" : "") + '">' + esc(g.msg || "No GPD reading.") + "</div>");
      setText("lp-gpd-src", "");
      setGloss("lp-gpd-src", "");
      return;
    }
    // the rows are cheapest first already (gpdPart): the pick, then the next two
    var priced = g.rows.filter(function (r) { return !r.why && r.next && r.next.gpd != null; }).slice(0, 3);
    var h = "";
    priced.forEach(function (r) {
      var n = r.next, best = r.k === g.best;
      h += "<tr" + (best ? ' class="lp-gbest"' : "") + ">" +
        "<td" + gl(GPD_SYSTEM[r.k] || r.label) + '><span class="lp-gdot" style="background:' + esc(r.color) + '"></span>' + esc(r.label) + "</td>" +
        "<td" + gl(gpdYoursGloss(r)) + '><span class="lp-gcut">' + esc(r.yours) + "</span></td>" +
        "<td" + gl(gpdNextGloss(r)) + '><span class="lp-gcut"><b>' + esc(n.to) + "</b></span></td>" +
        '<td class="r"' + gl(gpdPriceGloss(r, g.axis)) + ">" + (best ? '<span class="lp-gtag">cheapest</span>' : "") + "<b>" + esc(n.price) + "</b></td></tr>";
    });
    if (priced.length < 3) {
      var top = 0, unread = 0, bits = [];
      g.rows.forEach(function (r) { if (r.why) unread++; else if (!r.next || r.next.gpd == null) top++; });
      if (top) bits.push(top + (top === 1 ? " ladder is" : " ladders are") + " at the top rung");
      if (unread) bits.push(unread + (unread === 1 ? " is" : " are") + " not in the pull");
      h += '<tr class="lp-gnote"><td colspan="4"' + gl("The GPD chart's gear list shows every ladder, with what the pull reads on each.") + ">" +
        (priced.length ? "Nothing else to price" : "Nothing to price") + (bits.length ? ": " + bits.join("; ") : "") + ".</td></tr>";
    }
    setHtml("lp-gpd-body", '<div class="lp-tw lp-gpdwrap lp-gpd3"><table class="gr-ptab lp-gpdtab">' + GPD_HEAD + "<tbody>" + h + "</tbody></table></div>");
    setText("lp-gpd-src", g.axis === "support" ? "Support ladders" : "DPS ladders");
    setGloss("lp-gpd-src", gpdAxisWords(g.axis));
  }

  function renderLinks(ctx) {
    var c = cParam(ctx.region, ctx.name);
    var set = function (id, href) { var el = $(id); if (el) el.setAttribute("href", href); };
    set("lp-open-br", "/loa-bracelet-calc/?" + c);
    set("lp-open-adv", "/loa-bracelet-calc/advisor?" + c);
    set("lp-open-ag", "/loa-astrogem-calc/grader?" + c);
    set("lp-open-gpd", "/loa-gpd/?" + c);
    set("lp-go-gpd", "/loa-gpd/?" + c);
    // each overview is a way into its calculator, character loaded
    set("lp-ovt-br", "/loa-bracelet-calc/?" + c);
    set("lp-ovgo-br", "/loa-bracelet-calc/?" + c);
    set("lp-ovt-ag", "/loa-astrogem-calc/grader?" + c);
    set("lp-ovgo-ag", "/loa-astrogem-calc/grader?" + c);
    set("lp-ovt-gpd", "/loa-gpd/?" + c);
    set("lp-ovgo-gpd", "/loa-gpd/?" + c);
  }

  // ------------------------------------------------------------------ the overviews (the tiles are their tabs)

  // One overview on show under the tiles. The choice is a class on <html>
  // (lp-v-<view>), set before first paint by index.html's head script from the
  // hash, else the last choice this browser made, else the bracelet. A switch
  // moves that class and the tiles' aria-selected, saves the choice and writes
  // the hash with replaceState; nothing is drawn again, and every overview keeps
  // updating while hidden.
  var VIEWS = ["bracelet", "astrogems", "gpd"];
  var VIEW_TILE = { bracelet: "lp-tile-br", astrogems: "lp-tile-ag", gpd: "lp-tile-gpd" };
  var VIEW_PANEL = { bracelet: "lp-ov-br", astrogems: "lp-ov-ag", gpd: "lp-ov-gpd" };
  var K_VIEW = "lp_view";
  var view = null;
  function isView(v) { return Object.prototype.hasOwnProperty.call(VIEW_TILE, v); }
  function hashView() { var v = (location.hash || "").slice(1); return isView(v) ? v : null; }
  /** Show overview `v`. `save` false: do not remember it as this browser's choice. */
  function setView(v, save) {
    if (!isView(v)) v = "bracelet";
    var d = document.documentElement;
    if (v !== view || !d.classList.contains("lp-v-" + v)) {
      VIEWS.forEach(function (x) { if (x !== v) d.classList.remove("lp-v-" + x); });
      d.classList.add("lp-v-" + v);
      view = v;
      VIEWS.forEach(function (x) {
        var t = $(VIEW_TILE[x]);
        if (!t) return;
        t.setAttribute("aria-selected", x === v ? "true" : "false");
        t.tabIndex = x === v ? 0 : -1;
      });
    }
    if (save !== false) whenShown(function () { lsSet(K_VIEW, v); });
    syncHash();
  }
  /** The address names the overview on show: replaceState, so a switch is not a history step. */
  function syncHash() {
    if (!cur || !view) return;
    whenShown(function () {
      if (!cur || location.hash === "#" + view) return;
      try { history.replaceState(history.state, "", location.pathname + location.search + "#" + view); } catch (e) {}
    });
  }
  function wireOverviews() {
    var strip = $("lp-strip");
    if (strip) {
      strip.addEventListener("click", function (e) {
        var t = e.target.closest ? e.target.closest(".lp-tile") : null;
        if (!t || e.target.closest("a")) return;
        setView(t.getAttribute("data-view"));
      });
      // arrows move along the tabs and show each one (the switch is instant); Enter and Space show the focused one
      strip.addEventListener("keydown", function (e) {
        if (!e.target.closest || e.target.closest("a")) return;   // a tile's own link keeps its keys
        var t = e.target.closest(".lp-tile");
        if (!t) return;
        var i = VIEWS.indexOf(t.getAttribute("data-view")), n = -1, k = e.key;
        if (k === "Enter" || k === " " || k === "Spacebar") { e.preventDefault(); setView(VIEWS[i]); return; }
        if (k === "ArrowRight" || k === "ArrowDown") n = (i + 1) % VIEWS.length;
        else if (k === "ArrowLeft" || k === "ArrowUp") n = (i + VIEWS.length - 1) % VIEWS.length;
        else if (k === "Home") n = 0;
        else if (k === "End") n = VIEWS.length - 1;
        if (n < 0) return;
        e.preventDefault();
        setView(VIEWS[n]);
        var nt = $(VIEW_TILE[VIEWS[n]]);
        if (nt) nt.focus();
      });
      // "Leaderboard →" and "GPD chart →" go where they point without switching the overview
      [].forEach.call(strip.querySelectorAll(".lp-tile a"), function (a) {
        a.addEventListener("click", function (e) { e.stopPropagation(); });
      });
    }
    // An overview is a way into its calculator: its title and body are links, and
    // a click on the card around them follows the same link.
    VIEWS.forEach(function (v) {
      var sec = $(VIEW_PANEL[v]);
      if (!sec) return;
      sec.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0 || !e.target.closest || e.target.closest("a, button")) return;
        var go = sec.querySelector("a.lp-ovgo");
        if (!go || !go.href) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(go.href, "_blank");
        else go.click();
      });
    });
  }

  function renderAll(ctx) {
    renderHead(ctx);
    renderStrip(ctx);
    renderBracelet(ctx);
    renderAstro(ctx);
    renderStats(ctx);
    renderGpd(ctx);
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
      try { history.replaceState(history.state, "", charPath(ctx.region, ctx.name) + location.search + location.hash); } catch (e) {}
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
    queueGpd(ctx);   // a no-op until the first placement has been asked for
  }

  /**
   * The bracelet overview and its rank: the board's row when the board holds this
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
      queueGpd(ctx);
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
      var place = sup ? res.sup : res.dps, other = sup ? res.dps : res.sup, used = sup ? "support" : "dps";
      // Not on the board of its own axis (a support main is dropped from DPS): show the other one.
      if (!place && other) { place = other; other = null; used = sup ? "dps" : "support"; }
      if (!place) {
        ctx.model.agRank = { st: "none", msg: "Not on the board" };
      } else {
        ctx.model.agRank = { st: "ok", axis: used, rank: place.rank, count: place.count, estimated: place.estimated,
          region: res.region, builtAt: res.builtAt, stale: res.stale,
          other: (other && !other.estimated) ? { axis: used === "support" ? "dps" : "support", rank: other.rank, count: other.count } : null };
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
      watch: null, updating: false, brDone: false, progress: null, scoreToken: null, fresh: {},
      gpdArmed: false, gpdQueued: false
    };
    cur = ctx;
    document.title = name + " (" + region + ") — Loseii";
    if ($("lp-region")) $("lp-region").value = region;
    if ($("lp-q") && document.activeElement !== $("lp-q")) $("lp-q").value = "";

    var saved = restore(ctx.key);
    if (saved) {
      KEPT.forEach(function (k) {
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
    // the overview: the address's, else the one on show; a hash that named it is remembered
    var hv = hashView();
    setView(hv || view, !!hv && kind !== "load");
  }

  function go(region, name) {
    var path = charPath(region, name);
    if (cur && location.pathname === path) return;
    try { history.pushState({ lp: 1 }, "", path + (view ? "#" + view : "")); } catch (e) { location.href = path; return; }
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
    ["lp-icon", "lp-pulled", "lp-tile-br-body", "lp-tile-ag-body", "lp-tile-gpd-body", "lp-br-body", "lp-ag-body",
      "lp-stats-line", "lp-gpd-body", "lp-br-fig", "lp-ag-fig", "lp-gpd-fig"].forEach(capture);
    var gth = $("lp-gpd-body") && $("lp-gpd-body").querySelector("thead");
    GPD_HEAD = gth ? gth.outerHTML : "";
    // the overview the head script picked; a hash that named it is remembered too
    var hv = hashView();
    setView(hv || (isView(lsGet(K_VIEW)) ? lsGet(K_VIEW) : "bracelet"), !!hv);
    wireOverviews();

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
      var a = e.target.closest ? e.target.closest("a.lp-cta, a.lp-cta2, a.lp-ovt, a.lp-ovgo") : null;
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

    window.addEventListener("popstate", function () {
      // Back/Forward over a hash-only step (an overview) stays on this character
      var r = parsePath(location.pathname);
      if (cur && r.kind === "char" && r.region === cur.region && nkey(r.name) === nkey(cur.name)) {
        var hv2 = hashView();
        if (hv2) setView(hv2); else syncHash();
        return;
      }
      route("pop");
    });
    window.addEventListener("hashchange", function () {
      if (!cur) return;
      var hv3 = hashView();
      if (hv3) setView(hv3); else syncHash();
    });
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
