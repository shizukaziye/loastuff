/**
 * favorites.js — the site's one "saved characters" store (window.Favorites).
 *
 * ONE LIST FOR THE WHOLE SITE (2026-09-25). The astrogem and bracelet calculators each
 * kept their own copy of this file and their own list (`astrogem_favs`, `bc_favs`), so a
 * star in one tool never showed in the other. Now every page loads this copy from
 * /shared/favorites.js?v=N and reads one key, `loseii_favs`: the astrogem Grader,
 * Advisor and Leaderboard, the bracelet tool's tabs, and the hub's "Yours" chips. Load it
 * BEFORE the modules that call window.Favorites at init time.
 *
 * Persistence: localStorage `loseii_favs` = JSON.stringify(list), where `list` is an
 * array of { region, name } (region upper-cased, CE healed to EU; name as entered). The
 * list is unlimited. Identity (has / add dedupe / remove / toggle): same region and same
 * name, both compared case-insensitive and trimmed.
 *
 * THE ONE-TIME MIGRATION. When `loseii_favs` is absent, the two old lists are unioned
 * into it (astrogem first, then bracelet; duplicates by region + lower-case name keep the
 * first), and `astrogem_favs` is deleted. Before localStorage, astrogem kept the list in
 * a same-name cookie (it hit the ~4KB header cap at ~60 characters); a browser that still
 * has only the cookie gets it imported here, then the cookie is deleted.
 *
 * THE bc_favs MIRROR (until profile/profile.js reads `loseii_favs`). The profile page
 * reads and toggles `bc_favs` itself, so every write here also writes the same list to
 * `bc_favs`. When `bc_favs` no longer matches, the profile page (or another old writer)
 * changed it, and the two are reconciled at load and on the `storage` event:
 *   - it differs by at most one removal: take it as it is (a profile-page toggle);
 *   - otherwise: add what it has that we lack, remove nothing (an old tab that knew only
 *     half the list must not wipe the other half).
 * Once profile.js reads `loseii_favs`, delete MIRROR and reconcile().
 *
 * THE INBOX. handoff.js (the bracelet tool's one-time carry-over from its old address)
 * drops the old address's list in `loseii_favs_inbox`; it is unioned in at load, then
 * deleted.
 *
 * Public API (window.Favorites):
 *   list()                  -> [{region, name}, ...]  (a fresh copy)
 *   has(region, name)       -> bool
 *   add(region, name)       -> bool  (false only if already present or blank name)
 *   remove(region, name)    -> bool  (true if something was removed)
 *   toggle(region, name)    -> bool  (the NEW state: true = now favorited)
 *   onChange(cb)            -> unsubscribe fn; cb runs after every change, including a
 *                              change made in another tab
 *
 * node-safe: without `document` / `localStorage` the store is in-memory only.
 */
(function () {
  "use strict";

  var KEY = "loseii_favs";
  var MIRROR = "bc_favs";                 // TODO: drop once profile/profile.js reads KEY
  var OLD_AG = "astrogem_favs";           // the astrogem list (and, before 2026-07-25, its cookie)
  var INBOX = "loseii_favs_inbox";        // handoff.js's delivery from the old address

  var hasDoc = (typeof document !== "undefined");
  var hasLS = false;
  try { hasLS = (typeof localStorage !== "undefined") && !!localStorage; } catch (e) {}

  // ---- localStorage I/O (a blocked or absent store degrades to in-memory) ----
  function lsGet(k) { if (!hasLS) return null; try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { if (!hasLS) return; try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { if (!hasLS) return; try { localStorage.removeItem(k); } catch (e) {} }

  // ---- the old astrogem cookie (read + delete only) ----
  function readCookie() {
    if (!hasDoc) return "";
    var all = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < all.length; i++) {
      var eq = all[i].indexOf("=");
      var k = eq < 0 ? all[i] : all[i].slice(0, eq);
      if (k === OLD_AG) return eq < 0 ? "" : all[i].slice(eq + 1);
    }
    return "";
  }
  function deleteCookie() {
    if (!hasDoc) return;
    document.cookie = OLD_AG + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
  }

  // ---- identity ----
  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function indexOf(arr, region, name) {
    var r = norm(region), n = norm(name);
    for (var i = 0; i < arr.length; i++) {
      if (norm(arr[i].region) === r && norm(arr[i].name) === n) return i;
    }
    return -1;
  }

  // Parse a raw JSON list into a clean list of {region, name}. Tolerates malformed input,
  // stray entries and duplicates (a hand-edited store, or one an older build wrote).
  function parseList(raw) {
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var it = parsed[i];
      if (!it || it.name == null || norm(it.name) === "") continue;
      var region = String(it.region == null ? "" : it.region).toUpperCase();
      if (region === "CE") region = "EU"; // bible's code for EU Central; the site says EU
      var name = String(it.name);
      if (indexOf(out, region, name) === -1) out.push({ region: region, name: name });
    }
    return out;
  }
  function union(a, b) {
    var out = a.slice();
    for (var i = 0; i < b.length; i++) {
      if (indexOf(out, b[i].region, b[i].name) === -1) out.push(b[i]);
    }
    return out;
  }
  function missingFrom(a, b) {   // entries of a that b lacks
    return a.filter(function (it) { return indexOf(b, it.region, it.name) === -1; });
  }
  function ser(list) { return JSON.stringify(list); }

  // Fold a changed mirror into `list` (see the header).
  function reconcile(list, mirrorRaw) {
    if (mirrorRaw == null || mirrorRaw === ser(list)) return list;
    var m = parseList(mirrorRaw);
    return missingFrom(list, m).length <= 1 ? m : union(list, m);
  }

  function write(list) {
    var s = ser(list);
    lsSet(KEY, s);
    lsSet(MIRROR, s);
  }

  // Hydrate, migrating once, and write back only when something changed.
  function load() {
    var raw = lsGet(KEY), list;
    if (raw == null) {
      var ag = lsGet(OLD_AG);
      if (ag == null) {
        var ck = readCookie();
        if (ck) { try { ag = decodeURIComponent(ck); } catch (e) { ag = ck; } }
      }
      list = union(parseList(ag), parseList(lsGet(MIRROR)));
    } else {
      list = reconcile(parseList(raw), lsGet(MIRROR));
      // An astrogem tab left open from before the merge can still write its old key.
      var late = lsGet(OLD_AG);
      if (late) list = union(list, parseList(late));
    }
    var inbox = lsGet(INBOX);
    if (inbox) list = union(list, parseList(inbox));

    return list;
  }
  function whenShown(fn) {
    if (hasDoc && document.prerendering) document.addEventListener("prerenderingchange", fn, { once: true });
    else fn();
  }

  var items = load();

  // Store what load() settled on. A PRERENDER IS NOT A VISIT: Chrome may build this page
  // on hover and throw it away, so the migration's writes wait until it is really shown.
  whenShown(function () {
    var s = ser(items);
    if (hasLS && (lsGet(KEY) !== s || lsGet(MIRROR) !== s)) write(items);
    lsDel(OLD_AG);
    lsDel(INBOX);
    if (readCookie()) deleteCookie();
  });

  // ---- change notification ----
  var listeners = [];
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad subscriber must not break others */ }
    }
  }

  // Another tab changed the list: follow it. KEY carries a full list from this file;
  // MIRROR is the profile page's toggle, which is reconciled and written back.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", function (e) {
      if (e.key === KEY) {
        if (e.newValue == null) return;
        var next = parseList(e.newValue);
        if (ser(next) === ser(items)) return;
        items = next;
        notify();
      } else if (e.key === MIRROR) {
        if (e.newValue == null || e.newValue === ser(items)) return;
        items = reconcile(items, e.newValue);
        write(items);
        notify();
      }
    });
  }

  // ---- public API ----
  var Favorites = {
    list: function () {
      return items.map(function (it) { return { region: it.region, name: it.name }; });
    },
    has: function (region, name) {
      return indexOf(items, region, name) !== -1;
    },
    add: function (region, name) {
      if (name == null || norm(name) === "") return false;
      if (indexOf(items, region, name) !== -1) return false;
      var r = String(region == null ? "" : region).toUpperCase();
      if (r === "CE") r = "EU";
      items.push({ region: r, name: String(name) });
      write(items);
      notify();
      return true;
    },
    remove: function (region, name) {
      var i = indexOf(items, region, name);
      if (i === -1) return false;
      items.splice(i, 1);
      write(items);
      notify();
      return true;
    },
    toggle: function (region, name) {
      if (indexOf(items, region, name) !== -1) {
        this.remove(region, name);
        return false;
      }
      return this.add(region, name);
    },
    onChange: function (cb) {
      if (typeof cb !== "function") return function () {};
      listeners.push(cb);
      return function () {
        var i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      };
    }
  };

  if (typeof window !== "undefined") window.Favorites = Favorites;
  if (typeof module !== "undefined" && module.exports) module.exports = Favorites;
})();
