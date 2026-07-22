/**
 * bible-oauth.js — "Sign in with lostark.bible" (OAuth 2.0 Authorization Code + PKCE).
 *
 * Replaces the scraping path for character data. lostark.bible asked us to stop pulling
 * pages and move to their opt-in OAuth flow (https://lostark.bible/help/oauth-api), so a
 * user now signs in and grants us read access to THEIR OWN linked rosters. We never see
 * anyone else's characters — that is the whole point of the change.
 *
 * PUBLIC client: no client secret lives here (there is nowhere safe to put one in a static
 * site), so PKCE is mandatory. The access token is opaque, valid 90 days, and only carries
 * the scopes below. No refresh token exists — when it expires we send the user back through
 * /oauth/authorize, which auto-approves silently while the grant is still active.
 *
 * Browser-only. Attaches window.BibleOAuth:
 *   configured()            -> bool (CLIENT_ID filled in?)
 *   signedIn()              -> bool
 *   login(scopes?)          -> redirects to the consent screen (never returns)
 *   handleRedirect()        -> Promise<{ok, error?}|null>  — call once at load
 *   logout()                -> Promise (revokes the token, then forgets it)
 *   user() / rosters()      -> Promise<json> (throws {status} on failure)
 *   onChange(fn)            -> subscribe to sign-in/sign-out
 */
(function (root) {
  "use strict";

  // Registered on lostark.bible as "Loseii Astrogem Calculator" (2026-07-22). Both are PUBLIC
  // clients, so there is no secret to hide and PKCE carries the whole flow. Running off
  // localhost picks the dev client, so testing never touches production grants — each client
  // has its own redirect-URI list, and they must match the address bar exactly (no wildcards,
  // trailing slash included): prod https://www.loseii.com/loa-astrogem-calc/, dev also needs
  // http://localhost:8080/ (the port `npm run serve` uses).
  const CLIENT_PROD = "22zuv73nnkcgczoxitokvo2q6u";
  const CLIENT_DEV = "onwc5iva725mxhak2dxq3ikjti";
  const CLIENT_ID = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? CLIENT_DEV : CLIENT_PROD;

  const BASE = "https://lostark.bible";
  // `logs` earns its place: it is the only endpoint carrying combatPower, which the Advisor
  // needs for its gold-per-damage tier and which bookmarklet-imported records don't have.
  const SCOPES = "identify rosters logs";
  const STORE_KEY = "ag_bible_oauth";   // localStorage: the token
  const PEND_KEY = "ag_bible_pkce";     // sessionStorage: verifier + state, one round trip

  const listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // The redirect URI must match a registered one EXACTLY, so derive it from the page we're
  // on (origin + path, no query/hash) rather than hardcoding one that breaks on localhost.
  function redirectUri() {
    return location.origin + location.pathname;
  }

  // ---- token storage ----
  function read() {
    let t = null;
    try { t = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) {}
    if (!t || !t.access_token) return null;
    if (t.expires_at && Date.now() >= t.expires_at) { forget(); return null; }
    return t;
  }
  function write(tok) {
    const rec = {
      access_token: tok.access_token,
      scope: tok.scope || SCOPES,
      // Expire a day early so we re-authorize before a call fails mid-flow.
      expires_at: Date.now() + Math.max(0, (tok.expires_in || 0) - 86400) * 1000
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rec)); } catch (e) {}
    emit();
  }
  function forget() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    emit();
  }

  // ---- PKCE ----
  function b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(bytes) {
    const a = new Uint8Array(bytes);
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
    const verifier = randomString(64);
    const state = randomString(16);
    return challenge(verifier).then(function (chal) {
      sessionStorage.setItem(PEND_KEY, JSON.stringify({ v: verifier, s: state, r: redirectUri() }));
      const q = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: scopes || SCOPES,
        state: state,
        code_challenge: chal,
        code_challenge_method: "S256"
      });
      location.href = BASE + "/oauth/authorize?" + q.toString();
    });
  }

  // ---- step 2: swap the code for a token ----
  // Returns null when this load isn't a redirect back from the consent screen.
  function handleRedirect() {
    const qs = new URLSearchParams(location.search);
    const code = qs.get("code");
    const err = qs.get("error");
    if (!code && !err) return Promise.resolve(null);

    let pend = null;
    try { pend = JSON.parse(sessionStorage.getItem(PEND_KEY) || "null"); } catch (e) {}
    sessionStorage.removeItem(PEND_KEY);
    scrubUrl();

    if (err) return Promise.resolve({ ok: false, error: err });
    // A code arriving without our stashed state is either a stale tab or a forged callback.
    if (!pend || !pend.v || pend.s !== qs.get("state")) {
      return Promise.resolve({ ok: false, error: "state_mismatch" });
    }

    const body = new URLSearchParams({
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
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
  }

  // Drop code/state/error from the address bar so a reload doesn't replay a spent code.
  function scrubUrl() {
    const qs = new URLSearchParams(location.search);
    ["code", "state", "error", "error_description"].forEach(function (k) { qs.delete(k); });
    const rest = qs.toString();
    try {
      history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
    } catch (e) {}
  }

  // ---- step 3: call the API ----
  function api(path) {
    const tok = read();
    if (!tok) return Promise.reject({ status: 401, error: "not_signed_in" });
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
  }

  function logout() {
    const tok = read();
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
  // is never an error worth surfacing.
  const cpCache = {};
  function combatPower(region, name) {
    const reg = String(region || "").toUpperCase();
    if (!read() || (reg !== "NA" && reg !== "CE")) return Promise.resolve(null);
    const key = reg + "|" + String(name).toLowerCase();
    if (key in cpCache) return Promise.resolve(cpCache[key]);
    return api("/api/oauth/logs/" + encodeURIComponent(name) + "?region=" + reg)
      .then(function (logs) {
        // Logs come back newest-first; take the first entry that reports a combat power.
        let cp = null;
        (Array.isArray(logs) ? logs : []).some(function (e) {
          if (e && e.combatPower != null) { cp = e.combatPower; return true; }
          return false;
        });
        cpCache[key] = cp;
        return cp;
      })
      .catch(function () { cpCache[key] = null; return null; });
  }

  root.BibleOAuth = {
    configured: function () { return !!CLIENT_ID; },
    signedIn: function () { return !!read(); },
    scopes: function () { const t = read(); return t ? t.scope : ""; },
    login: login,
    logout: logout,
    handleRedirect: handleRedirect,
    user: function () { return api("/api/oauth/user"); },
    rosters: function () { return api("/api/oauth/rosters"); },
    combatPower: combatPower,
    onChange: function (fn) { listeners.push(fn); }
  };
})(window);
