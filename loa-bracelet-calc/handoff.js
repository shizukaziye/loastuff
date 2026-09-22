/**
 * handoff.js — carries a user's saved data over from the OLD address, once.
 *
 * The tool used to live at https://shizukaziye.github.io/loa-bracelet-calc/ and
 * now lives at https://www.loseii.com/loa-bracelet-calc/. Everything the app
 * saves — the character + bracelet state and its roll history, the favorites,
 * the lostark.bible sign-in token — sits in localStorage, and localStorage
 * belongs to one origin. The new address cannot read a byte of it. So we ask
 * the old address for it.
 *
 * How: a hidden iframe on the OLD origin (handoff.html, which ships in that
 * repo's stub) reads its own localStorage and posts it back. Both ends name the
 * other's origin explicitly and check the origin on arrival; nothing else is
 * answered and nothing else is believed.
 *
 * What it costs a user with nothing to fetch (or whose adblocker eats the
 * iframe, or who arrives while GitHub Pages is down): at most five hidden
 * iframe loads, ever. A reply — even an empty one — sets the done-flag and the
 * question is never asked again.
 *
 * Runs FIRST, before the app boots: a successful import reloads the page once
 * so every module hydrates from the imported state instead of from defaults.
 * The done-flag is set BEFORE that reload, so the second load skips the whole
 * thing and there is no loop.
 *
 * NEVER CLOBBERS — and the rule needs care, because "does this origin already
 * have the key?" cannot be asked of the live store. profile.js writes its whole
 * state blob within milliseconds of boot, and the old side's answer lands after
 * that. Asked live, that fresh defaults blob looks like data the user owns, and
 * the one key carrying the settings, the bracelet and the roll history would be
 * skipped on every visitor. So the question is asked of what this origin held
 * BEFORE the app booted:
 *   - nothing there now                        -> import
 *   - it was there when the page opened, and
 *     the page had opened before we ever ran   -> the user's; leave it
 *   - it appeared after we took the snapshot   -> the app's own boot write; import over it
 *   - it appeared during an EARLIER attempt    -> import only while it is still
 *     (one that timed out)                        byte-for-byte what the app
 *                                                 wrote; once the user changes
 *                                                 it, it is theirs.
 *
 * Storage keys this module owns (none of them app data, none of them imported):
 *   bc_handoff_done   "1" once the old side has answered. The permanent stop.
 *   bc_handoff_tries  count of silent failures, capped at MAX_TRIES.
 *   bc_handoff_note   set just before the reload, consumed by the next load to
 *                     show the one-line note.
 *   bc_handoff_pre    the pre-boot picture above. Dropped once the handoff ends.
 */
(function () {
  "use strict";

  var DONE_KEY = "bc_handoff_done";
  var TRIES_KEY = "bc_handoff_tries";
  var NOTE_KEY = "bc_handoff_note";
  var PRE_KEY = "bc_handoff_pre";
  var OWN_KEYS = [DONE_KEY, TRIES_KEY, NOTE_KEY, PRE_KEY];

  var MAX_TRIES = 5;      // silent failures allowed before we stop asking forever
  var WAIT_MS = 4000;     // how long the old side gets to answer

  var NOTE_TEXT = "Brought your saved profiles and favorites over from the old address.";

  // The app's own keys, imported FIRST. The old origin is shizukaziye.github.io,
  // which is ONE origin for every project hosted there, so a reply can carry
  // other tools' keys too. Writing ours first means a store that runs out of
  // room loses someone else's leftovers, never this tool's data.
  //   loa-bracelet-calc.v1  profile.js — character + bracelet state, incl. roll history
  //   bc_favs               favorites.js — saved characters
  //   bc_bible_oauth        bible-oauth.js — the lostark.bible token (stays signed in)
  //   bc_bi_last            bible-import.js — last {region, name} imported
  //   bc_lb_regions         leaderboard.js — region filter
  //   bc_lb_class           leaderboard.js — class filter
  var PRIORITY = [
    "loa-bracelet-calc.v1",
    "bc_favs",
    "bc_bible_oauth",
    "bc_bi_last",
    "bc_lb_regions",
    "bc_lb_class"
  ];

  // Where the old data lives. On localhost the old side is a second static
  // server on 8081 (npx http-server the old repo's stub/ directory).
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var OLD = LOCAL
    ? { origin: "http://localhost:8081", url: "http://localhost:8081/handoff.html" }
    : { origin: "https://shizukaziye.github.io", url: "https://shizukaziye.github.io/loa-bracelet-calc/handoff.html" };

  // ---- localStorage I/O (a blocked or full store must never throw past here) ----
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // A store we cannot write to cannot hold the done-flag or the counter, and a
  // handoff we cannot remember would run on every single page load. Don't start.
  function writable() {
    try {
      localStorage.setItem(PRE_KEY + ":probe", "1");
      localStorage.removeItem(PRE_KEY + ":probe");
      return true;
    } catch (e) { return false; }
  }

  function inList(list, s) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i] === s) return true;
    return false;
  }

  /** Every key this origin holds right now, ours excluded. */
  function currentKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k === null || inList(OWN_KEYS, k)) continue;
        out.push(k);
      }
    } catch (e) {}
    return out;
  }

  /** Cheap value stamp: length plus a 32-bit rolling hash. Only ever compared. */
  function stamp(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return s.length + ":" + h;
  }

  // ---- the note, shown on the load AFTER a successful import ----
  function showNote() {
    function mount() {
      var host = document.querySelector(".wrap") || document.body;
      if (!host || document.getElementById("bc-handoff-note")) return;
      var bar = document.createElement("div");
      bar.id = "bc-handoff-note";
      bar.setAttribute("role", "status");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
        "background:var(--panel2,#1b2030);border:1px solid var(--border,#2a3142);border-radius:8px;" +
        "padding:8px 12px;margin:0 0 14px;font-size:12.5px;color:var(--dim,#97a0b4)";
      var txt = document.createElement("span");
      txt.textContent = NOTE_TEXT;
      var x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", "Dismiss");
      x.style.cssText = "background:none;border:none;color:inherit;font:inherit;font-size:16px;" +
        "line-height:1;padding:0 2px;cursor:pointer";
      x.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
      bar.appendChild(txt);
      bar.appendChild(x);
      host.insertBefore(bar, host.firstChild);
    }
    // This module runs from the body, below .wrap, so the host is normally there
    // already; the listener is the fallback for any other load order.
    if (document.querySelector(".wrap") || document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, false);
  }

  // A note left by the previous load is shown whatever the guards below decide —
  // by then the import has already happened.
  if (lsGet(NOTE_KEY)) { lsDel(NOTE_KEY); showNote(); }

  // ---- guards ----

  // Served from the loastuff mirror on shizukaziye.github.io? Then the "old"
  // origin IS this origin, the storage is already shared, and there is nothing
  // to move. Flag it done so no later visit tries.
  if (OLD.origin === location.origin) { lsSet(DONE_KEY, "1"); return; }

  if (lsGet(DONE_KEY)) return;

  var tries = parseInt(lsGet(TRIES_KEY) || "0", 10);
  if (!(tries >= 0)) tries = 0;                 // NaN from a hand-edited store
  if (tries >= MAX_TRIES) return;

  if (!writable()) return;

  // ---- the pre-boot picture (see NEVER CLOBBERS above) ----
  // Taken now, which is before any app script has run: this module is the first
  // script in the body. Kept across a failed attempt, because after one the live
  // store is no longer innocent.
  var pre = null;
  try { pre = JSON.parse(lsGet(PRE_KEY) || "null"); } catch (e) {}
  var firstRun = !pre || !pre.k;
  if (firstRun) {
    pre = { k: currentKeys(), f: {} };
    lsSet(PRE_KEY, JSON.stringify(pre));
  }

  /** May the old origin's value for this key be written here? */
  function mayWrite(k) {
    var cur = lsGet(k);
    if (cur === null) return true;               // nothing here to protect
    if (inList(pre.k, k)) return false;          // the user had it before we ever ran
    var fp = pre.f ? pre.f[k] : null;
    if (typeof fp === "string") return stamp(cur) === fp;  // still exactly what the app wrote
    return firstRun;                             // appeared during THIS load's boot
  }

  // ---- the ask ----

  var frame = document.createElement("iframe");
  var settled = false;
  var timer = 0;

  function cleanup() {
    try { window.removeEventListener("message", onMessage, false); } catch (e) {}
    if (timer) { clearTimeout(timer); timer = 0; }
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  }

  /** Write what the old origin sent. Returns how many keys actually landed. */
  function importAll(data) {
    var n = 0, seen = {}, order = [], i, k;
    for (i = 0; i < PRIORITY.length; i++) {
      k = PRIORITY[i];
      if (Object.prototype.hasOwnProperty.call(data, k) && !seen["k:" + k]) {
        order.push(k); seen["k:" + k] = 1;
      }
    }
    for (k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k) && !seen["k:" + k]) {
        order.push(k); seen["k:" + k] = 1;
      }
    }
    for (i = 0; i < order.length; i++) {
      k = order[i];
      if (k === "__proto__") continue;              // never a real app key; assigning it is a trap
      if (inList(OWN_KEYS, k)) continue;            // this module's bookkeeping never rides along
      var v = data[k];
      if (typeof v !== "string") continue;          // localStorage holds strings and nothing else
      if (!mayWrite(k)) continue;                   // never clobber what the user has done here
      if (lsSet(k, v)) n++;                         // a full store costs one key, not the rest
    }
    return n;
  }

  function onMessage(ev) {
    if (settled) return;
    if (ev.origin !== OLD.origin) return;                        // exact match or nothing
    if (!frame || ev.source !== frame.contentWindow) return;     // and from OUR iframe
    var msg = ev.data;
    if (!msg || typeof msg !== "object" || msg.type !== "bc-handoff") return;
    var data = msg.data;
    if (!data || typeof data !== "object") return;

    settled = true;
    var n = importAll(data);
    // Set the flag BEFORE the reload. An empty reply counts as an answer too:
    // there is nothing over there, so stop asking.
    lsSet(DONE_KEY, "1");
    lsDel(PRE_KEY);
    if (n > 0) lsSet(NOTE_KEY, "1");
    cleanup();
    if (n > 0) { try { location.reload(); } catch (e) {} }
  }

  window.addEventListener("message", onMessage, false);

  timer = setTimeout(function () {
    if (settled) return;
    settled = true;
    tries = tries + 1;
    lsSet(TRIES_KEY, String(tries));   // one of the five; nothing else happens
    if (firstRun) {
      // Stamp what the app itself wrote during this load. A later attempt may
      // still write over these, but only while they are byte-for-byte what was
      // written here — the moment the user changes one, it is theirs.
      var ks = currentKeys(), i, v;
      for (i = 0; i < ks.length; i++) {
        if (inList(pre.k, ks[i])) continue;
        v = lsGet(ks[i]);
        if (typeof v === "string") pre.f[ks[i]] = stamp(v);
      }
      lsSet(PRE_KEY, JSON.stringify(pre));
    }
    if (tries >= MAX_TRIES) lsDel(PRE_KEY);   // nothing will read it again
    cleanup();
  }, WAIT_MS);

  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:0;height:0;border:0;opacity:0";
  frame.onload = function () {
    if (settled) return;
    try { frame.contentWindow.postMessage({ type: "bc-handoff-request" }, OLD.origin); } catch (e) {}
  };
  frame.src = OLD.url;
  (document.body || document.documentElement).appendChild(frame);
})();
