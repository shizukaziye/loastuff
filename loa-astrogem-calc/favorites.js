/**
 * favorites.js — a tiny localStorage-backed "saved characters" store, shared by the
 * Grader and Leaderboard tabs. Loaded BEFORE grader.js / leaderboard.js so both
 * can call window.Favorites at init time.
 *
 * Persistence: one localStorage key, name `astrogem_favs`, whose value is
 *   JSON.stringify(list)
 * where `list` is an array of { region, name } (region upper-cased, name kept as
 * the user entered it). The list is UNLIMITED — there is no cap.
 *
 * localStorage replaced a same-name cookie (2026-07-25): the cookie hit the ~4KB
 * header cap at ~60 characters (favoriteRoster saves whole rosters at once) and
 * silently dropped writes past it — and it rode along on every request. On first
 * load, if the localStorage key is absent and the old cookie exists, the cookie is
 * imported once and then deleted.
 *
 * Identity match (has / add dedupe / remove / toggle): same region
 * (case-insensitive) AND same name (case-insensitive, trimmed).
 *
 * Public API (window.Favorites):
 *   list()                  -> [{region, name}, ...]  (a fresh copy)
 *   has(region, name)       -> bool
 *   add(region, name)       -> bool  (false only if already present or blank name)
 *   remove(region, name)    -> bool  (true if something was removed)
 *   toggle(region, name)    -> bool  (the NEW state: true = now favorited)
 *   onChange(cb)            -> unsubscribe fn; cb runs after every change
 *
 * node-safe: when there's no `document` / `localStorage` (e.g. Node import for a
 * sanity check) the store falls back to in-memory only. It's a browser module in
 * practice.
 */
(function () {
  "use strict";

  var KEY = "astrogem_favs";     // localStorage key (same name the old cookie used)
  var COOKIE = "astrogem_favs";  // the pre-2026-07-25 cookie — imported once, then deleted

  var hasDoc = (typeof document !== "undefined");

  // ---- localStorage I/O (try-wrapped: a blocked/absent store degrades to in-memory) ----
  function readStore() {
    try {
      return (typeof localStorage !== "undefined") ? localStorage.getItem(KEY) : null;
    } catch (e) { return null; }
  }
  function writeStore(list) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {}
  }

  // ---- legacy cookie I/O (read + delete only — never written anymore) ----
  function readCookie() {
    if (!hasDoc) return "";
    var all = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < all.length; i++) {
      var eq = all[i].indexOf("=");
      var k = eq < 0 ? all[i] : all[i].slice(0, eq);
      if (k === COOKIE) return eq < 0 ? "" : all[i].slice(eq + 1);
    }
    return "";
  }
  function deleteCookie() {
    if (!hasDoc) return;
    document.cookie = COOKIE + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
  }

  // Parse a raw JSON list into a clean list of {region, name}. Tolerates malformed
  // input and stray entries (same shape the cookie stored).
  function parseList(raw) {
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var it = parsed[i];
      if (!it || it.name == null) continue;
      var region = String(it.region == null ? "" : it.region).toUpperCase();
      var name = String(it.name);
      // skip dupes that may have crept into a hand-edited store
      if (indexOf(out, region, name) === -1) out.push({ region: region, name: name });
    }
    return out;
  }

  // Hydrate: localStorage first; if the key is absent, import the old cookie once
  // (its value was encodeURIComponent'd for cookie transport) and delete it.
  function loadList() {
    var raw = readStore();
    if (raw != null) return parseList(raw);
    var ck = readCookie();
    if (!ck) return [];
    var decoded = ck;
    try { decoded = decodeURIComponent(ck); } catch (e) {}
    var list = parseList(decoded);
    writeStore(list);
    deleteCookie();
    return list;
  }

  // ---- identity (region case-insensitive; name case-insensitive + trimmed) ----
  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function indexOf(arr, region, name) {
    var r = norm(region), n = norm(name);
    for (var i = 0; i < arr.length; i++) {
      if (norm(arr[i].region) === r && norm(arr[i].name) === n) return i;
    }
    return -1;
  }

  // The single in-memory copy, hydrated from the store on load.
  var items = loadList();

  // ---- change notification ----
  var listeners = [];
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad subscriber must not break others */ }
    }
  }

  // ---- public API ----
  var Favorites = {
    list: function () {
      // hand back a defensive copy so callers can't mutate internal state
      return items.map(function (it) { return { region: it.region, name: it.name }; });
    },
    has: function (region, name) {
      return indexOf(items, region, name) !== -1;
    },
    add: function (region, name) {
      if (name == null || norm(name) === "") return false;
      if (indexOf(items, region, name) !== -1) return false; // dup
      items.push({ region: String(region == null ? "" : region).toUpperCase(), name: String(name) });
      writeStore(items);
      notify();
      return true;
    },
    remove: function (region, name) {
      var i = indexOf(items, region, name);
      if (i === -1) return false;
      items.splice(i, 1);
      writeStore(items);
      notify();
      return true;
    },
    toggle: function (region, name) {
      if (indexOf(items, region, name) !== -1) {
        this.remove(region, name);
        return false; // now not favorited
      }
      return this.add(region, name); // true once added (only fails on dup/blank)
    },
    onChange: function (cb) {
      if (typeof cb !== "function") return function () {};
      listeners.push(cb);
      return function () {
        var i = listeners.indexOf(cb);
        if (i !== -1) listeners.splice(i, 1);
      };
    }
    // (count/isFull/MAX removed 2026-07-18 — vestiges of a capped era, no callers.)
  };

  if (typeof window !== "undefined") window.Favorites = Favorites;
  // node-safe export for an isolated require() (not used in the browser).
  if (typeof module !== "undefined" && module.exports) module.exports = Favorites;
})();
