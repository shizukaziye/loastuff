/**
 * bible-oauth.js — "Sign in with lostark.bible" (OAuth 2.0 Authorization Code + PKCE).
 *
 * ONE SESSION FOR THE WHOLE SITE (2026-09-25). This file ships as three byte-identical
 * copies — loa-astrogem-calc/, loa-bracelet-calc/ and loa-gpd/ — and the hub page loads the
 * astrogem copy. Every page on www.loseii.com is one origin, so they all share one
 * localStorage; the only thing that ever kept their sign-ins apart was each copy keeping
 * its own storage key and scope set. Now they share both: sign in on any page and every
 * page is signed in; sign out anywhere and every page is signed out. Open tabs follow along
 * through the `storage` event. Keep the three copies identical (diff them before shipping)
 * and bump each tool's ?v= pin when this file changes.
 *
 * lostark.bible asked us to stop pulling their pages, so character data comes through their
 * opt-in OAuth flow (https://lostark.bible/help/oauth-api): a user signs in and grants US
 * read access to THEIR OWN linked rosters. We never see anyone else's characters, and the
 * raid statistics endpoints stay untouched.
 *
 * PUBLIC client: no secret lives here (a static site has nowhere to hide one), so PKCE
 * carries the whole flow. The token is opaque, valid 90 days, and holds only the scopes
 * below. There is NO refresh token — when it dies we send the user back through
 * /oauth/authorize, which auto-approves while the grant is still alive.
 *
 * Browser-only. Attaches window.BibleOAuth:
 *   configured()            -> bool (CLIENT_ID filled in?)
 *   signedIn()              -> bool
 *   scopes() / hasScope(s)  -> the token's scope string / does it carry scope s
 *   expiresAt()             -> ms epoch the stored token is dropped at (0 when signed out)
 *   login(scopes?)          -> redirects to the consent screen (never returns)
 *   handleRedirect()        -> Promise<{ok, error?}|null>  — call once at load
 *   logout()                -> Promise (revokes the token, then forgets it)
 *   user() / rosters()      -> Promise<json> (throws {status} on failure)
 *   api(path)               -> Promise<json> for any /api/oauth/* path
 *   accessToken()           -> raw token, for handing to OUR OWN Workers
 *   combatPower(region, n)  -> Promise<number|null> from the user's own logs (needs `logs`)
 *   rundown(region, n)      -> Promise<report> — every field the grant can see (Grader)
 *   scrubUrl()              -> drop code/state from the address bar
 *   onChange(fn)            -> subscribe to sign-in/sign-out (this tab and others)
 */
(function (root) {
  "use strict";

  // lostark.bible allows ONE APP PER ACCOUNT, so every tool reuses the app registered as
  // "Loseii Astrogem Calculator" (2026-07-22). Both clients are PUBLIC — no secret — and each
  // carries its own exact redirect-URI list (no wildcards, trailing slash included):
  //   prod  https://www.loseii.com/  /loa-astrogem-calc/  /loa-bracelet-calc/  /loa-gpd/
  //   dev   http://localhost:8080/   (the port `npm run serve` uses)
  // Running off localhost picks the dev client, so testing never touches the production
  // grant.
  var CLIENT_PROD = "22zuv73nnkcgczoxitokvo2q6u";
  var CLIENT_DEV = "onwc5iva725mxhak2dxq3ikjti";
  var CLIENT_ID = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? CLIENT_DEV : CLIENT_PROD;

  var BASE = "https://lostark.bible";
  // One grant serves every tool, so it asks for the union of what they need. `logs` is
  // there for the astrogem Advisor: it is the only endpoint carrying combatPower. The
  // bracelet and GPD tools never read it, but a session signed in from their pages must
  // still work on the Advisor without a second consent screen.
  var SCOPES = "identify rosters logs";
  var STORE_KEY = "loseii_bible_oauth";   // localStorage: the token, shared by every page
  var PEND_KEY = "loseii_bible_pkce";     // sessionStorage: verifier + state, one round trip
  // The per-tool keys the copies used before the session was shared. A token found under
  // one of these is adopted once and the old key dropped, so nobody has to sign in again.
  var LEGACY_KEYS = ["ag_bible_oauth", "bc_bible_oauth"];

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // The redirect URI must match a registered one EXACTLY, trailing slash included. The
  // registered folders on www.loseii.com are the hub root and the three tool folders
  // (the hub root was added 2026-09-25); on localhost only http://localhost:8080/ is. A page
  // in a registered folder comes back to itself. Any other page (a tab path such as
  // /loa-astrogem-calc/pipeline is NOT registered) comes back through this script's own
  // folder and is then bounced home (see `back` below). Query and hash never travel.
  var REGISTERED = ["/", "/loa-astrogem-calc/", "/loa-bracelet-calc/", "/loa-gpd/"];
  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function pageFolder() { return location.origin + location.pathname.replace(/[^\/]*$/, ""); }
  function redirectUri() {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return location.origin + "/";
    var page = pageFolder();
    if (REGISTERED.indexOf(page.slice(location.origin.length)) >= 0) return page;
    var src = SELF_SRC.split(/[?#]/)[0];
    if (src.indexOf(location.origin + "/") === 0) return src.replace(/[^\/]*$/, "");
    return page;   // no script address: the page's folder
  }

  // A PRERENDER IS NOT A VISIT. Chrome may load this page in the background when a link to
  // it is pointed at (speculation rules) and throw it away unseen, so nothing here calls
  // lostark.bible, writes storage, or leaves for the consent screen until the page is
  // really shown.
  function whenShown() {
    if (!document.prerendering) return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener("prerenderingchange", function () { resolve(); }, { once: true });
    });
  }

  // ---- token storage ----
  function parse(raw) {
    var t = null;
    try { t = JSON.parse(raw || "null"); } catch (e) {}
    if (!t || !t.access_token) return null;
    if (t.expires_at && Date.now() >= t.expires_at) return null;
    return t;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // A token under one of the old per-tool keys. When both tools held one, the one that can
  // do more (carries `logs`), then the one that lives longer, wins.
  function legacy() {
    var best = null;
    LEGACY_KEYS.forEach(function (k) {
      var t = parse(lsGet(k));
      if (!t) return;
      if (!best) { best = t; return; }
      var bl = / logs\b/.test(" " + (best.scope || "")), tl = / logs\b/.test(" " + (t.scope || ""));
      if (tl !== bl ? tl : (t.expires_at || 0) > (best.expires_at || 0)) best = t;
    });
    return best;
  }
  function read() {
    var raw = lsGet(STORE_KEY);
    var t = parse(raw);
    if (t) return t;
    if (raw) { forget(); return null; }       // present but expired or unreadable
    t = legacy();
    if (t && !document.prerendering) {        // adopt it once; a prerender only reads
      try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (e) {}
      LEGACY_KEYS.forEach(lsDel);
    }
    return t;
  }
  function write(tok) {
    var rec = {
      access_token: tok.access_token,
      scope: tok.scope || SCOPES,
      // Expire a day early so we re-authorize before a call fails mid-flow.
      expires_at: Date.now() + Math.max(0, (tok.expires_in || 0) - 86400) * 1000
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rec)); } catch (e) {}
    LEGACY_KEYS.forEach(lsDel);
    emit();
  }
  function forget() {
    lsDel(STORE_KEY);
    LEGACY_KEYS.forEach(lsDel);
    emit();
  }
  function hasScope(s) {
    var t = read();
    return !!t && (" " + (t.scope || "") + " ").indexOf(" " + s + " ") >= 0;
  }

  // Another tab signed in or out: repaint here too. The event only fires in OTHER tabs of
  // the same origin, so this never double-fires the tab that made the change.
  try {
    window.addEventListener("storage", function (e) {
      if (e.key === null || e.key === STORE_KEY || LEGACY_KEYS.indexOf(e.key) >= 0) emit();
    });
  } catch (e) {}

  // ---- PKCE ----
  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(bytes) {
    var a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  function challenge(verifier) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
      .then(function (buf) { return b64url(new Uint8Array(buf)); });
  }

  // ---- step 1: send the user to the consent screen ----
  function login(scopes) {
    if (!CLIENT_ID) throw new Error("bible-oauth.js: CLIENT_ID is empty — register the app first.");
    return whenShown().then(function () {
      var verifier = randomString(64);
      var state = randomString(16);
      return challenge(verifier).then(function (chal) {
        var r = redirectUri();
        // A page outside the callback folder (the hub) comes back through the callback and
        // is then sent home; a tool page comes back to itself and stays.
        var back = (r === pageFolder()) ? "" : (location.pathname + location.search + location.hash);
        sessionStorage.setItem(PEND_KEY, JSON.stringify({ v: verifier, s: state, r: r, back: back }));
        var q = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: r,
          response_type: "code",
          scope: scopes || SCOPES,
          state: state,
          code_challenge: chal,
          code_challenge_method: "S256"
        });
        location.href = BASE + "/oauth/authorize?" + q.toString();
      });
    });
  }

  // ---- step 2: swap the code for a token ----
  // Returns null when this load isn't a redirect back from the consent screen.
  function handleRedirect() {
    var qs = new URLSearchParams(location.search);
    var code = qs.get("code");
    var err = qs.get("error");
    if (!code && !err) return Promise.resolve(null);

    var pend = null;
    try { pend = JSON.parse(sessionStorage.getItem(PEND_KEY) || "null"); } catch (e) {}
    sessionStorage.removeItem(PEND_KEY);
    scrubUrl();

    if (err) return Promise.resolve({ ok: false, error: err });
    // A code arriving without our stashed state is either a stale tab or a forged callback.
    if (!pend || !pend.v || pend.s !== qs.get("state")) {
      return Promise.resolve({ ok: false, error: "state_mismatch" });
    }

    var body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: pend.r,
      client_id: CLIENT_ID,
      code_verifier: pend.v
    });
    return fetch(BASE + "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).then(function (r) {
      return r.json().then(function (j) { return { r: r, j: j }; });
    }).then(function (o) {
      if (!o.r.ok || !o.j.access_token) return { ok: false, error: o.j.error || ("http_" + o.r.status) };
      write(o.j);
      // Signed in on behalf of another page of this site: go back there. Only a same-origin
      // path ever gets stored, and only a path is honoured, so this can't leave the site.
      if (pend.back && /^\/(?!\/)/.test(pend.back)) {
        location.replace(pend.back);
        return { ok: true, back: pend.back };
      }
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
  }

  // Drop code/state/error from the address bar so a reload can't replay a spent code.
  function scrubUrl() {
    var qs = new URLSearchParams(location.search);
    ["code", "state", "error", "error_description"].forEach(function (k) { qs.delete(k); });
    var rest = qs.toString();
    try {
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
    } catch (e) {}
  }

  // ---- step 3: call the API ----
  function api(path) {
    return whenShown().then(function () {
      var tok = read();
      if (!tok) throw { status: 401, error: "not_signed_in" };
      return fetch(BASE + path, { headers: { Authorization: "Bearer " + tok.access_token } })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.ok) return j;
            // 401 means the token is dead (expired, revoked, or the app was disabled) — drop it
            // so the UI falls back to the signed-out state instead of retrying forever.
            if (r.status === 401) forget();
            throw { status: r.status, error: j.error || ("http_" + r.status), description: j.error_description };
          });
        });
    });
  }

  function logout() {
    var tok = read();
    forget();
    if (!tok) return Promise.resolve();
    return fetch(BASE + "/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tok.access_token, client_id: CLIENT_ID }).toString()
    }).catch(function () { /* revoke is best-effort; we've already forgotten it locally */ });
  }

  // Combat power for one of the user's own characters, from their most recent encounter.
  // Resolves null for anything we can't answer (no grant, no `logs` scope, no public logs,
  // a non-NA/CE region) — callers treat it as "unknown" and fall back to manual, so a null
  // is never an error worth surfacing. A token adopted from the old bracelet key has no
  // `logs`; it answers null until the user signs in again.
  var cpCache = {};
  function combatPower(region, name) {
    var reg = String(region || "").toUpperCase();
    if (reg === "EU") reg = "CE"; // the site says EU; this API's code for EU Central is CE
    if (!hasScope("logs") || (reg !== "NA" && reg !== "CE")) return Promise.resolve(null);
    var key = reg + "|" + String(name).toLowerCase();
    if (key in cpCache) return Promise.resolve(cpCache[key]);
    return api("/api/oauth/logs/" + encodeURIComponent(name) + "?region=" + reg)
      .then(function (logs) {
        // Logs come back newest-first; take the first entry that reports a combat power.
        var cp = null;
        (Array.isArray(logs) ? logs : []).some(function (e) {
          if (e && e.combatPower != null) { cp = e.combatPower; return true; }
          return false;
        });
        cpCache[key] = cp;
        return cp;
      })
      .catch(function () { cpCache[key] = null; return null; });
  }

  // Everything this token can see about one character, plus the token's own terms.
  //
  // The point is the `gemFields` list. lostark.bible carries no astrogem / ark-grid data over
  // OAuth today, so we grade from bookmarklet imports instead; they have said they may expose
  // it here later. Rather than poll for that on a timer, we recompute it whenever the user
  // looks at one of their own characters — if a gem-shaped field ever appears, it shows up in
  // the rundown the next time they open that character.
  //
  // Matching must be narrow or this cries wolf forever. Two traps, both hit in testing:
  // "gearScore" ENDS in the letters c-o-r-e, and "gem"/"core" are too short to substring
  // safely. So: distinctive words may appear anywhere, but the bare ones have to be the
  // whole final segment of the key path.
  var GEM_ANYWHERE = /arkgrid|astrogem|corepoints|costreduc|willpower/i;
  var GEM_EXACT = /^(gems?|cores?|opts?)$/i;

  function isGemField(p) {
    var seg = String(p).split(".").pop().replace(/\[\]$/, "");
    return GEM_ANYWHERE.test(p) || GEM_EXACT.test(seg);
  }

  function keyPaths(v, prefix, out) {
    out = out || [];
    if (Array.isArray(v)) {
      if (v.length) keyPaths(v[0], prefix + "[]", out);
    } else if (v && typeof v === "object") {
      Object.keys(v).forEach(function (k) {
        var p = prefix ? prefix + "." + k : k;
        out.push(p);
        keyPaths(v[k], p, out);
      });
    }
    return out;
  }

  // Endpoints that do not exist today. If lostark.bible adds a gear/grid route, one of these
  // is the likely shape. They are CORS-enabled like the documented ones, so a fetch that
  // RESOLVES means the route now exists; a 404 has no CORS headers and rejects instead.
  var PROBES = [
    "/api/oauth/character/{n}?region={r}",
    "/api/oauth/gear/{n}?region={r}",
    "/api/oauth/arkgrid/{n}?region={r}",
    "/api/oauth/gems/{n}?region={r}",
    "/api/oauth/loadout/{n}?region={r}"
  ];

  function rundown(region, name) {
    var tok = read();
    if (!tok) return Promise.resolve(null);
    var reg = String(region || "").toUpperCase();
    if (reg === "EU") reg = "CE"; // the site says EU; this API's code for EU Central is CE
    var canLog = hasScope("logs") && (reg === "NA" || reg === "CE");
    var out = {
      scope: tok.scope,
      expiresAt: tok.expires_at,
      daysLeft: Math.max(0, Math.round((tok.expires_at - Date.now()) / 86400000)),
      fields: [],        // every distinct key path seen across every endpoint
      gemFields: [],
      liveProbes: [],
      raw: {}
    };
    var seen = {};
    function note(paths) {
      paths.forEach(function (p) { if (!seen[p]) { seen[p] = 1; out.fields.push(p); } });
    }

    function probe(tpl) {
      var u = tpl.replace("{n}", encodeURIComponent(name)).replace("{r}", reg);
      return api(u).then(
        function (body) { out.liveProbes.push(u); note(keyPaths(body, u.split("?")[0])); },
        function () { /* still absent — the expected answer */ }
      );
    }

    return Promise.all([
      api("/api/oauth/user").catch(function () { return null; }),
      api("/api/oauth/rosters").catch(function () { return null; }),
      canLog ? api("/api/oauth/logs/" + encodeURIComponent(name) + "?region=" + reg).catch(function () { return null; })
             : Promise.resolve(null)
    ].concat(PROBES.map(probe))).then(function (r) {
      var user = r[0], ros = r[1], logs = r[2];

      // Scan the WHOLE payloads, not just this character's slice — a gem field could arrive
      // on a sibling object, and a claim of "nothing here" has to cover everything returned.
      if (user) { out.raw.user = user; note(keyPaths(user, "user")); }
      if (ros) {
        note(keyPaths(ros, "rosters"));
        (ros.rosters || []).forEach(function (x) {
          (x.characters || []).forEach(function (c) {
            note(keyPaths(c, "rosters.characters[]"));
            if (String(c.name).toLowerCase() === String(name).toLowerCase()) {
              out.roster = c;
              out.world = x.world;
              out.raw.rosterCharacter = c;
            }
          });
        });
      }
      if (Array.isArray(logs)) {
        out.logCount = logs.length;
        // EVERY entry, not just the newest — a field present on one rare encounter counts.
        logs.forEach(function (e) { note(keyPaths(e, "logs[]")); });
        if (logs.length) { out.latestLog = logs[0]; out.raw.latestLog = logs[0]; }
      }

      out.fields.sort();
      out.gemFields = out.fields.filter(isGemField);
      return out;
    });
  }

  root.BibleOAuth = {
    configured: function () { return !!CLIENT_ID; },
    signedIn: function () { return !!read(); },
    scopes: function () { var t = read(); return t ? t.scope : ""; },
    hasScope: hasScope,
    expiresAt: function () { var t = read(); return t ? t.expires_at : 0; },
    login: login,
    logout: logout,
    handleRedirect: handleRedirect,
    scrubUrl: scrubUrl,
    // Raw access token, for handing to OUR OWN Workers (the astrogem drain/probe credential,
    // the bracelet fallback fetch). Only same-origin app code calls this; the token still
    // never goes to any third party.
    accessToken: function () { var t = read(); return t ? t.access_token : ""; },
    user: function () { return api("/api/oauth/user"); },
    rosters: function () { return api("/api/oauth/rosters"); },
    api: api,
    combatPower: combatPower,
    rundown: rundown,
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
