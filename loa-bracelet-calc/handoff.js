/**
 * handoff.js — brings a user's saved data over from the tool's old address, once.
 *
 * The tool used to live at https://shizukaziye.github.io/loa-bracelet-calc/ and
 * now lives at https://www.loseii.com/loa-bracelet-calc/. The character and
 * bracelet state, the favorites and the lostark.bible sign-in all sit in
 * localStorage, which belongs to one origin. This origin cannot read a byte of
 * the old one's.
 *
 * WHY THERE IS NO IFRAME HERE. The obvious trick — frame the old origin and ask
 * it over postMessage — is dead. Chrome 115+, Firefox and Safari partition
 * storage for a framed third-party site: the frame gets an empty bucket keyed to
 * the top-level site, so the old page sees nothing and answers with nothing. It
 * fails silently and looks like success. The only place the old origin's data
 * can be read is a FIRST-PARTY visit to it.
 *
 * So the user goes there, briefly:
 *
 *   1. This page (no done-flag, before the sunset date) checks that the old
 *      address is reachable, then hands the whole tab to
 *      <OLD>/handoff.html?return=<this url>.
 *   2. That page is now first-party. It reads its own six keys and sends the tab
 *      straight back here with the data in the URL FRAGMENT — never the query: a
 *      fragment is not sent to any server and never appears in a Referer.
 *   3. We import, strip the fragment, and show one quiet line.
 *
 * ONE BOUNCE PER BROWSER, EVER. The done-flag is set before we leave, so a trip
 * that comes back empty-handed — old address down, stub broken, user hit stop —
 * still counts. Nobody can loop. If the old address cannot be reached at all we
 * do not leave the page: a browser error screen is a worse outcome than a
 * missing import, so the attempt is counted (five, then never again) and
 * nothing is shown.
 *
 * NEVER CLOBBERS. The import runs on the return leg, at the top of the body,
 * before a single app script has parsed — so the store still holds exactly what
 * the user had, and a key that is present is the user's own work, not a default
 * profile.js wrote a moment ago. That is why this file is the FIRST script in
 * the body, and why it needs no snapshot bookkeeping: a key is written only when
 * this origin does not have it.
 *
 * The deck's "Used the old address?" link forces the same round trip by hand,
 * with one difference: it overwrites. It is for anyone the automatic bounce
 * could not help — someone who opened the new site before this file existed, or
 * whose profile was already here and rightly left alone.
 *
 * Keys that travel (this tool's own, nothing else):
 *   loa-bracelet-calc.v1  profile.js — character + bracelet state, incl. roll history
 *   bc_favs               favorites.js — saved characters
 *   bc_bible_oauth        bible-oauth.js — the lostark.bible token (stays signed in)
 *   bc_bi_last            bible-import.js — last {region, name} imported
 *   bc_lb_regions         leaderboard.js — region filter
 *   bc_lb_class           leaderboard.js — class filter
 *
 * Keys this module owns:
 *   bc_handoff2_done   the bounce has been spent. The permanent stop.
 *   bc_handoff2_tries  old address unreachable, counted; five and we stop.
 *   bc_handoff2_force  timestamp of a forced trip, read on the way back.
 * The v1 names (bc_handoff_*) belong to the iframe version and are ignored —
 * anyone who loaded the site while that shipped carries a done-flag that means
 * nothing. They are cleared when this version settles.
 */
(function () {
  "use strict";

  var DONE = "bc_handoff2_done";
  var TRIES = "bc_handoff2_tries";
  var FORCE = "bc_handoff2_force";
  var V1_KEYS = ["bc_handoff_done", "bc_handoff_tries", "bc_handoff_pre", "bc_handoff_note"];

  var KEYS = [
    "loa-bracelet-calc.v1",
    "bc_favs",
    "bc_bible_oauth",
    "bc_bi_last",
    "bc_lb_regions",
    "bc_lb_class"
  ];

  var MAX_TRIES = 5;                    // unreachable old address: five goes, then never
  var PROBE_MS = 3000;                  // how long the reachability check may take
  var FORCE_MS = 10 * 60 * 1000;        // a forced trip older than this was abandoned
  var SUNSET = Date.UTC(2027, 0, 1);    // after 2026-12-31 the bounce never runs again
  var TAG = "#bchandoff=";

  var NOTE_OK = "Brought your saved profiles and favorites over from the old address.";
  var NOTE_DEAD = "The old address did not answer — try again later.";
  var NOTE_NONE = "The old address had nothing saved.";
  var CONFIRM = "This replaces the profile, favorites and roll history on this site " +
    "with the copy saved at the old address.";

  // Locally the old side is served on 127.0.0.1:8081 while this runs on
  // localhost:8080 — a DIFFERENT site, which is the point: same-port localhost
  // testing hides the very partitioning this design exists for.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var OLD = LOCAL
    ? { origin: "http://127.0.0.1:8081", handoff: "http://127.0.0.1:8081/handoff.html" }
    : { origin: "https://shizukaziye.github.io", handoff: "https://shizukaziye.github.io/loa-bracelet-calc/handoff.html" };

  // ---- localStorage (a blocked or full store must never throw past here) ----
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function writable() {
    try {
      localStorage.setItem(DONE + ":probe", "1");
      localStorage.removeItem(DONE + ":probe");
      return true;
    } catch (e) { return false; }
  }

  function dropV1() { for (var i = 0; i < V1_KEYS.length; i++) lsDel(V1_KEYS[i]); }

  // ---- the payload ----
  function fromB64url(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = "", i;
    for (i = 0; i < bin.length; i++) out += "%" + ("0" + bin.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(out);
  }

  /** The payload this load came back with, or null on an ordinary visit. */
  function fragment() {
    var h = location.hash || "";
    return h.indexOf(TAG) === 0 ? h.slice(TAG.length) : null;
  }

  // ---- the note ----
  function showNote(text) {
    var old = document.getElementById("bc-handoff-note");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    function mount() {
      var host = document.querySelector(".wrap") || document.body;
      if (!host) return;
      var bar = document.createElement("div");
      bar.id = "bc-handoff-note";
      bar.setAttribute("role", "status");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
        "background:var(--panel2,#1b2030);border:1px solid var(--border,#2a3142);border-radius:8px;" +
        "padding:8px 12px;margin:0 0 14px;font-size:12.5px;color:var(--dim,#97a0b4)";
      var txt = document.createElement("span");
      txt.textContent = text;
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
    if (document.querySelector(".wrap") || document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, false);
  }

  // ---- importing ----
  /** Write what came back. Returns how many keys landed. */
  function write(d, force) {
    var n = 0, i, k, v;
    for (i = 0; i < KEYS.length; i++) {
      k = KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      v = d[k];
      if (typeof v !== "string") continue;
      if (!force && lsGet(k) !== null) continue;   // never clobber; see the header
      if (lsSet(k, v)) n++;                        // a full store costs one key, not the rest
    }
    return n;
  }

  /** Was a forced trip in flight? Reads it once and clears it. */
  function forcePending() {
    var t = parseInt(lsGet(FORCE) || "0", 10);
    if (!t) return false;
    lsDel(FORCE);
    return (Date.now() - t) < FORCE_MS;   // anything older was abandoned; say nothing
  }

  /** The way back: import, tidy the address bar, say one line. */
  function returnLeg(raw) {
    var got = null;
    try { got = JSON.parse(fromB64url(raw)); } catch (e) {}
    var forced = forcePending();

    lsSet(DONE, "1");                     // the trip happened; it never happens again
    dropV1();

    // Put the user's own hash back and take ours out of the address bar.
    var hash = (got && typeof got.h === "string" && got.h.charAt(0) === "#" && got.h.indexOf(TAG) !== 0)
      ? got.h : "";
    try { history.replaceState(null, "", location.pathname + location.search + hash); } catch (e) {}

    if (!got || !got.d || typeof got.d !== "object") {   // came back broken
      if (forced) showNote(NOTE_DEAD);
      return;
    }
    var n = write(got.d, forced);
    if (n > 0) showNote(NOTE_OK);
    else if (forced) showNote(NOTE_NONE);
  }

  // ---- going there ----
  function miss(force) {
    if (force) { lsDel(FORCE); showNote(NOTE_DEAD); return; }
    var n = parseInt(lsGet(TRIES) || "0", 10);
    if (!(n >= 0)) n = 0;
    lsSet(TRIES, String(n + 1));          // silent: the user is told nothing
  }

  /**
   * Hand the tab to the old address for one round trip — but only after a
   * no-cors fetch says it is there. Sending someone to a dead host would put a
   * browser error page in front of them, which is worse than not importing.
   */
  function bounce(force) {
    var target = OLD.handoff + "?return=" + encodeURIComponent(location.href);
    if (typeof fetch !== "function") { miss(force); return; }   // no probe, no trip
    var spent = false, timer;
    function go() {
      if (spent) return;
      spent = true; clearTimeout(timer);
      if (!force) lsSet(DONE, "1");       // spend the one bounce BEFORE leaving
      try { location.replace(target); } catch (e) { miss(force); }
    }
    function fail() {
      if (spent) return;
      spent = true; clearTimeout(timer);
      miss(force);
    }
    timer = setTimeout(fail, PROBE_MS);
    try { fetch(OLD.handoff, { mode: "no-cors", cache: "no-store" }).then(go, fail); }
    catch (e) { fail(); }
  }

  // ---- the manual link in the profile deck (profile.js draws it) ----
  // Registered whatever the guards below decide, so it still works once the
  // automatic bounce has been spent.
  document.addEventListener("click", function (e) {
    var t = e.target, btn;
    if (!t || !t.closest) return;
    btn = t.closest("[data-bchandoff]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (OLD.origin === location.origin) { showNote(NOTE_NONE); return; }  // the mirror shares the store
    if (!window.confirm(CONFIRM)) return;
    if (!writable()) { showNote(NOTE_DEAD); return; }
    lsSet(FORCE, String(Date.now()));
    bounce(true);
  }, false);

  // ---- what this load is ----
  var frag = fragment();
  if (frag !== null) { returnLeg(frag); return; }

  // A forced trip that never came back: the tab was closed, or the old address
  // answered with something we could not read.
  if (forcePending()) { showNote(NOTE_DEAD); return; }

  if (window.top !== window) return;                    // framed: never move somebody's frame
  if (OLD.origin === location.origin) { lsSet(DONE, "1"); dropV1(); return; }  // the github.io mirror
  if (lsGet(DONE)) return;
  if (Date.now() > SUNSET) return;

  var tries = parseInt(lsGet(TRIES) || "0", 10);
  if (!(tries >= 0)) tries = 0;
  if (tries >= MAX_TRIES) return;
  if (!writable()) return;

  bounce(false);
})();
