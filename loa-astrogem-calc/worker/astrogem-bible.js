/**
 * astrogem-bible.js — Cloudflare Worker that fetches a character page from
 * lostark.bible (server-side, with a browser User-Agent so it returns 200 instead
 * of the 403 that default fetchers get), extracts the embedded `arkGridCores`
 * hydration data, and returns each equipped astrogem in the shape the Grader tab
 * expects:
 *
 *   { region, name, source, gems: [ {
 *       slot, baseCost, gemType, willpowerLevel, orderLevel,
 *       effect1, effect1Level, effect2, effect2Level
 *   }, ... ] }
 *
 * No Anthropic / external paid API — but it is NOT a plain stateless fetcher
 * anymore, and it DOES carry secrets (BIBLE_TOKEN, BIBLE_CLIENT_ID/SECRET, and
 * ADMIN_TOKEN — the admin credential, sent as an X-Admin-Token header; see
 * adminOk()). It carries the KV lookup QUEUE (premium/free lanes) + every-minute
 * cron drain (budget guard, fail-streak circuit breaker, run/off/probe modes),
 * the dirty-gated leaderboard snapshot rebuild, five edge rate-limit bindings,
 * and the KR source (lopec.kr) alongside lostark.bible. Full plumbing:
 * ../docs/how-the-queue-and-drain-work.md; ops summary: README-bible.md. The
 * owner deploys and pastes the URL into grader.js/leaderboard.js/loadout-econ.js
 * (WORKER_URL).
 *
 * Primary endpoints (full list incl. queue/admin in the queue doc):
 *   GET /?region=NA&name=Paroxysmal  -> { region, name, gems:[...], pulledAt, cached }
 *                                       (KV-cached 7d; add &refresh=1 to force fresh)
 *   GET /?list=1                     -> { characters:[{region,name,gems,pulledAt}, ...] }
 *   GET /                            -> health JSON { ok, service }
 *   OPTIONS /                        -> CORS preflight
 *
 * KV (binding CHARS, see wrangler.bible.toml): each pulled character is stored under
 * key "region:name" (lowercased) as { region, name, gems, pulledAt, ... }; ?list=1
 * serves the cron-built gzipped snapshot of them (lb:snapshot:gz / :gz2). If the
 * CHARS binding is absent the Worker still works — it just fetches fresh every
 * time (cached:false) and ?list=1 returns an empty list.
 *
 * --- The two reverse-engineered maps (derived by cross-referencing arkGridCores
 *     with the RENDERED gem display for NA/Paroxysmal; see worker/README-bible.md) ---
 *
 * 1. EFFECT ID -> NAME. Each gem's `opts` carry a numeric stat id. Verified against
 *    the page's rendered per-stat "Lv. NN" totals (the sum of that stat's levels
 *    across every gem) — the computed opt-id level totals matched the rendered
 *    labels exactly (2001=49 Atk, 2002=50 AddDmg, 2003=43 Boss, 2011=16 AllyDmg,
 *    2012=2 Brand, 2013=7 AllyAtk):
 *      2001 Attack Power | 2002 Additional Damage | 2003 Boss Damage
 *      2011 Ally Damage Enh. | 2012 Brand Power | 2013 Ally Attack Enh.
 *
 * 2. GEM -> baseCost (8/9/10) + gemType (order/chaos), both from the gem `id`
 *    (format 674 [type] 1 [shape] 2 [variant]):
 *      gemType = id[3]: '0' => order, '1' => chaos  (agrees with the core's
 *                base: 10001-10003 = Order Sun/Moon/Star, 10004-10006 = Chaos).
 *      baseCost = 8 + (id[5] % 3): order shapes 0/1/2 and chaos shapes 3/4/5 both
 *                map 0->8, 1->9, 2->10. Validated on all 24 Paroxysmal gems: every
 *                gem's two opts fall inside exactly the cost's effect pool (0
 *                mismatches), an independent cross-check of the cost rule.
 *
 *    willpowerLevel = gem.costReduc, orderLevel = gem.corePoints, the two side
 *    effects = gem.opts (each {id, level}). costReduc/corePoints are confirmed in
 *    1..5; opts levels in 1..5.
 */

// The REAL scoring model, bundled in at deploy time (wrangler/esbuild resolves the CJS
// branch of its UMD wrapper). Used only by the weekly repull sweep to rank the board the
// same way leaderboard.js does — never re-implement scoring here, import it.
import AG from "../model/astrogem.js";

// Exact-match CORS allowlist (was "*"). The site origins come first; the two lostark.bible
// origins must stay listed because the "+ add to leaderboard" bookmarklet POSTs ?submit=1
// FROM a lostark.bible character page (its JSON body forces a preflight, and the preflight
// dies without an echoed Origin). Requests with no Origin (curl, the cron) are server-to-
// server — CORS only constrains browsers — so they proceed with no CORS headers at all.
const ALLOW_ORIGINS = [
  "https://www.loseii.com",
  "https://loseii.com",
  "https://loastuff.pages.dev",
  "https://shizukaziye.github.io",   // the GPD chart's character lookup (2026-08-19)
  "https://lostark.bible",
  "https://www.lostark.bible"
];
// Local dev servers too (any port — the repo is served from a handful of them). Only the
// PUBLIC endpoints benefit: admin needs the X-Admin-Token header whatever the origin, and
// everything a localhost page could read here is already public.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
function originAllowed(origin) {
  return ALLOW_ORIGINS.indexOf(origin) !== -1 || LOCAL_ORIGIN.test(origin);
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 1. effect id -> name (see header).
const EFFECT_ID_TO_NAME = {
  2001: "Attack Power",
  2002: "Additional Damage",
  2003: "Boss Damage",
  2011: "Ally Damage Enh.",
  2012: "Brand Power",
  2013: "Ally Attack Enh."
};

// Core base id -> human slot label (matches the rendered "Order Sun" etc.).
const SLOT_LABEL = {
  10001: "Order Sun",
  10002: "Order Moon",
  10003: "Order Star",
  10004: "Chaos Sun",
  10005: "Chaos Moon",
  10006: "Chaos Star"
};

// 2. derive cost + type from the gem id (see header).
function costFromGemId(idStr) {
  const shape = parseInt(idStr[5], 10);
  if (!Number.isFinite(shape)) return null;
  return 8 + (shape % 3); // 0/3->8, 1/4->9, 2/5->10
}
function typeFromGemId(idStr) {
  return idStr[3] === "0" ? "order" : "chaos";
}

// CORS headers for one request's Origin: exact allowlist match -> echo it (+ Vary: Origin,
// so a shared cache never serves one origin's grant to another); anything else -> none.
// Applied ONCE, in the exported fetch(), to whatever response the router returns — every
// response here is Worker-constructed, so its headers are mutable in place.
function corsHeaders(origin) {
  if (!origin || !originAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    "Access-Control-Max-Age": "86400"
  };
}
function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders || {})
  });
}

// Pull the astrogem cores out of the page. A page can carry several
// `arkGridCores:[ ... ]` arrays — lostark.bible stores one per loadout
// (classification "most_recent_raid" / "most_recent_chaos_dungeon"), and the chaos
// loadout is frequently empty. We parse every array (each is a JS object literal with
// unquoted keys, so we quote the keys before JSON.parse), then prefer the RAID
// loadout's, falling back to whichever array actually has gems. Returns an array or null.
function extractArkGridCores(html) {
  const marker = "arkGridCores:[";
  const occ = [];
  let from = 0;
  while (true) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    // Scan from the opening '[' keeping bracket depth so nested arrays don't fool us.
    const start = at + "arkGridCores:".length;
    let depth = 0, end = -1;
    for (let k = start; k < html.length; k++) {
      const c = html[k];
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end === -1) break;
    const literal = html.slice(start, end);
    // Quote bare identifier keys: {id:..,base:..} -> {"id":..,"base":..}
    const jsonish = literal.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    let parsed = null;
    try { parsed = JSON.parse(jsonish); } catch (e) { parsed = null; }
    if (parsed) occ.push({ at: at, cores: parsed });
    from = end;
  }
  if (!occ.length) return { raid: null, chaos: null };

  function gemCount(cores) {
    let n = 0;
    if (Array.isArray(cores)) {
      for (const core of cores) n += (core && Array.isArray(core.gems)) ? core.gems.length : 0;
    }
    return n;
  }

  // The first arkGridCores right after a given loadout classification, if it has gems.
  function afterClass(cls) {
    const at = html.indexOf('classification:"' + cls + '"');
    if (at === -1) return null;
    const o = occ.find(function (x) { return x.at > at; });
    return (o && gemCount(o.cores) > 0) ? o.cores : null;
  }
  let raid = afterClass("most_recent_raid");
  const chaos = afterClass("most_recent_chaos_dungeon");
  // Raid fallback: the array with the most gems, so a non-standard layout still grades.
  if (!raid) {
    let best = occ[0];
    for (const o of occ) { if (gemCount(o.cores) > gemCount(best.cores)) best = o; }
    raid = (gemCount(best.cores) > 0) ? best.cores : null;
  }
  return { raid: raid, chaos: chaos };
}

// Map one raw gem (from arkGridCores) + its core to the Grader config shape.
// Returns { gem, warnings:[...] } — warnings note any unknown id / out-of-range
// level so the client can surface them rather than silently dropping a gem.
function mapGem(rawGem, core) {
  const warnings = [];
  const idStr = String(rawGem.id);
  const baseCost = costFromGemId(idStr);
  const gemType = typeFromGemId(idStr);
  if (baseCost == null) warnings.push("could not derive cost from gem id " + idStr);

  const opts = Array.isArray(rawGem.opts) ? rawGem.opts : [];
  function nameOf(o) {
    const n = EFFECT_ID_TO_NAME[o && o.id];
    if (!n) warnings.push("unknown effect id " + (o && o.id) + " on gem " + idStr);
    return n || ("Effect#" + (o && o.id));
  }
  const e1 = opts[0] || {}, e2 = opts[1] || {};

  return {
    gem: {
      slot: SLOT_LABEL[core.base] || ("Core " + core.base),
      coreBase: core.base,
      gemId: idStr,
      idx: rawGem.idx,
      baseCost: baseCost,
      gemType: gemType,
      willpowerLevel: rawGem.costReduc,
      orderLevel: rawGem.corePoints,
      effect1: nameOf(e1),
      effect1Level: e1.level,
      effect2: nameOf(e2),
      effect2Level: e2.level
    },
    warnings: warnings
  };
}

// Map a whole arkGridCores array (one preset) to the Grader gem-config list.
function coresToGems(cores) {
  const gems = [], warnings = [];
  for (const core of cores) {
    const rawGems = Array.isArray(core.gems) ? core.gems : [];
    for (const rg of rawGems) {
      const m = mapGem(rg, core);
      gems.push(m.gem);
      for (const w of m.warnings) warnings.push(w);
    }
  }
  return { gems: gems, warnings: warnings };
}

// ---- KV cache config + helpers ----
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a cached character is "fresh" for 7 days.
const INDEX_KEY = "__index__";               // LEGACY key, never written anymore — kept only so isCharKey() can skip an old stored one.
const SNAPSHOT_KEY = "lb:snapshot";          // LEGACY plain-JSON snapshot key (deleted on rebuild; never read anymore).
const SNAPSHOT_GZ_KEY = "lb:snapshot:gz";    // LEGACY v1 gzip key — serve-only fallback until the first post-fix rebuild
                                             // deletes it. NEVER read for mutation and never written: its ~93MB expansion
                                             // at ~19k characters OOM'd the 128MB isolate on every cron tick (Aug 16-17
                                             // board freeze). v2 below is the only stored format now.
                                             // (historical: the whole leaderboard list, stored GZIPPED. The plain JSON hit ~26.1MB at ~5k
                                             // characters — 65KB under KV's 25MiB value cap (writes were days from silently
                                             // failing and freezing the board). Gzip is ~1MB (≈25x headroom) and ?list=1
                                             // serves the bytes as-is (Content-Encoding: gzip) — no 26MB parse+stringify per request.)
const SNAPSHOT_GZ2_KEY = "lb:snapshot:gz2";  // THE snapshot: compact format v2, gzipped. Gems as 9-slot tuples with
                                             // table-indexed names — ~10x less JSON than v1 (~9MB vs ~93MB uncompressed).
                                             // Served to every ?list=1 (fmt ignored); the rebuild reads and writes ONLY this.
const DIRTY_PREFIX = "lb:dirty:";            // #3: per-character "changed since last snapshot" marker — the cron merges only these instead of re-reading every character.
const SNAPSHOT_DIRTY_TTL_S = 7 * 24 * 3600;  // a dirty marker self-expires after 7 days (safety net; the rebuild normally clears it).
const LASTWRITE_KEY = "lb:lastwrite";        // ms timestamp of the most recent REAL lostark.bible pull (drain, probe, kick, or direct lookup). Bookmarklet imports do NOT bump it — the admin reads this as "last successful bible pull", so a user-supplied import must not masquerade as one.
const BUILTAT_KEY = "lb:builtat";            // ms timestamp the snapshot was last rebuilt by the cron.
const QP = "q:p:";                           // premium lookup-queue key prefix (region+name ride in KV metadata).
const QF = "q:f:";                           // free lookup-queue key prefix.
const DRAIN_PER_RUN = 10;                     // DEFAULT chars cached per cron run (= per minute); admin-configurable at runtime via the queue-admin Controls (drain:config.drainPerMin). Time-budgeted below so it never overruns the 60s cron; monthly guard caps the total.
const MONTHLY_CHAR_BUDGET = 300000;          // hard cap on characters cached per calendar month (~2 writes each ≈ 66% of the 1M/mo write budget → no overage, ever).
const USAGE_KEY = "usage:drained";           // {month:"YYYY-MM", count} — characters cached this month (the budget guard).
const DRAIN_DELAY_MS = 3000;                 // pause between lostark.bible fetches (~1 req / 3s) — gentle enough to avoid upstream rate-limiting/timeouts, which cost more than they cache.
const DRAIN_BUDGET_MS = 50000;               // stop a drain run after ~50s no matter the count, so it never overruns the 60s cron (margin for the snapshot rebuild + no overlapping runs).
const PAUSE_FAIL_LIMIT = 5;                   // consecutive fetch failures that PAUSE the whole queue (circuit-breaker): the streak is re-queued at the FRONT, new lookups get the "unavailable" notice, and the drain backs off to a single probe every PAUSE_PROBE_MS until one succeeds.
const PAUSE_PROBE_MS = 5 * 60 * 1000;        // fallback probe interval (old pause states that predate the adaptive backoff).
const PAUSE_PROBE_FIRST_MS = 60 * 1000;      // ADAPTIVE backoff: first probe ~1 min after pausing (catch a quick recovery),
const PAUSE_PROBE_MAX_MS = 30 * 60 * 1000;   // then ×2 per failed probe, capped at 30 min — a long outage costs very few probes.
const NOTFOUND_PREFIX = "nf:";               // short-lived "no such character" marker: a typo'd/deleted name isn't re-fetched in a loop.
const DRAIN_LOCK_KEY = "drain:lock";         // serialize active drains (cron + enqueue-kicks) so two never overlap + double-fetch lostark.bible; auto-expires (crash safety).
const NOTFOUND_TTL_S = 60 * 60;              // remember not-found for 1 hour (self-corrects if it was a transient 404).
const Q_ORDER_KEY = "q:order";               // #1: cron-maintained ordered queue snapshot — lets position/metrics/probe skip the 2 KV list()s.
const Q_ORDER_TTL_MS = 90 * 1000;            // trust the snapshot for 90s (rewritten each active drain minute); older -> re-list for correctness.
const Q_ORDER_IDLE_TTL_MS = 10 * 60 * 1000;  // an EMPTY snapshot short-circuits the whole cron drain for up to 10 min (enqueues invalidate it), so an idle queue costs ~1 read/min instead of writes+lists.
const DRAIN_CONFIG_KEY = "drain:config";      // admin drain state: { mode:"run"|"off"|"probe", drainPerMin, lastProbe?, interval? }. mode!="run" gates enqueues + drives the "lookups temporarily unavailable" notice. Set via ?control (owner-only).
const DRAIN_MODES = ["run", "off", "probe"]; // run = draining; off = frozen (no upstream requests); probe = paused but periodically probing lostark.bible to auto-resume on recovery.
const UNAVAILABLE_MSG = "Character lookups are temporarily unavailable";
const MAX_FETCH_ATTEMPTS = 5;                // after this many failed fetches a queued character is DROPPED, so a permanently-broken entry (e.g. some KR names) can't sit at the head retrying forever and starving everyone behind it.
const QUEUE_TTL_S = 7 * 24 * 60 * 60;        // a queued request expires after 7 days if never drained.
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60 * 1000; // rebuild the leaderboard snapshot at most every ~30 min (the read-heavy part).
// ---- Admin auth ----------------------------------------------------------------------------
// Every admin surface (?metrics, ?control, ?dequeue, ?feedback review, /oauth/probe-token)
// requires the ADMIN_TOKEN Worker secret, sent as an `X-Admin-Token` request header:
//     wrangler secret put ADMIN_TOKEN --config wrangler.bible.toml
// This replaced the old ?k=<gate hash> check. That hash is the SAME value gate.js ships to
// every browser, so it gated nothing — anyone reading the page source could freeze lookups,
// purge the queue, or read feedback (incl. contact PII). Clients still send ?k= on public
// lookups; it is ignored (it always was — no public path ever checked it).
// Rules: FAIL CLOSED (secret unset -> nobody is admin), constant-time compare, and the token
// rides only in a header — never a URL, so it can't leak via logs or Referer.
function adminOk(request, env) {
  const secret = (env && env.ADMIN_TOKEN) || "";
  if (!secret) return false;                              // fail closed: no secret, no admin
  const given = request.headers.get("X-Admin-Token") || "";
  const enc = new TextEncoder();
  const a = enc.encode(given), b = enc.encode(secret);
  if (a.byteLength !== b.byteLength) return false;        // explicit pre-check: timingSafeEqual needs equal lengths
  try {
    if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === "function") {
      return crypto.subtle.timingSafeEqual(a, b);         // Workers-native constant-time compare
    }
  } catch (e) { /* fall through to the XOR loop */ }
  let diff = 0;                                           // fallback: XOR-accumulate every byte, no early exit
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---- lostark.bible OAuth (Authorization Code + PKCE) ---------------------------------------
// lostark.bible gates character pages behind `Authorization: Bearer <token>`. Tokens come from
// THEIR OAuth: a user signs in with lostark.bible, grants this app the `identify` scope, and we
// use that user's access token to fetch pages on their behalf — so every upstream request is
// attributable to a consenting human instead of an anonymous scraper.
//
// TOKEN EXPOSURE — the honest version (2026-07-25). The SHIPPED flow is bible-oauth.js's
// client-side PKCE: the BROWSER exchanges the code itself, keeps the RAW uwo_ access token in
// localStorage, and sends it to this Worker as an Authorization: Bearer header per lookup. So
// any XSS on the calculator page can read that token — keep the page dependency-free and
// treat the token as browser-exposed. The SESSION flow below (/oauth/start -> /oauth/callback
// mints an opaque s:<sid>; the raw token stays server-side in KV and sessionToken() swaps the
// sid per request) avoids that exposure and is fully implemented — but the frontend has NOT
// adopted it yet. It is available, not in use.
// Sessions live in their OWN KV namespace (OAUTH) — never CHARS, because the leaderboard's
// from-scratch rebuild does a bare prefix-less list() there and would treat a session key as
// a character record.
const OAUTH_AUTHORIZE   = "https://lostark.bible/oauth/authorize";
const OAUTH_TOKEN_URL   = "https://lostark.bible/oauth/token";
const OAUTH_REVOKE_URL  = "https://lostark.bible/oauth/revoke";
const OAUTH_SCOPE       = "identify";                  // minimum that yields a valid bearer token
const OAUTH_REDIRECT    = "https://astrogem-bible.shizukaziye.workers.dev/oauth/callback";
const OAUTH_STATE_TTL_S = 600;                         // their auth code expires in 10 minutes
const OAUTH_SESSION_TTL_S = 90 * 24 * 60 * 60;         // access token: 90 days, no refresh token
const OAUTH_ST   = "st:";                              // OAUTH KV: state -> { v: verifier, ret }
const OAUTH_SESS = "s:";                               // OAUTH KV: session id -> { t: access token }
// Allowed post-login return targets. Exact prefix match, no wildcards — an open redirect here
// would leak the session id in the fragment to any site an attacker names.
const OAUTH_RETURN_ALLOW = [
  "https://shizukaziye.github.io/astrogem-calculator/",
  "https://www.loseii.com/loa-astrogem-calc/"
];

function b64url(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomId(n) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}
// Only allow returning to a known frontend; anything else falls back to the first allowed page.
function safeReturn(ret) {
  const r = String(ret || "");
  for (const ok of OAUTH_RETURN_ALLOW) { if (r.indexOf(ok) === 0) return r; }
  return OAUTH_RETURN_ALLOW[0];
}
function redirectTo(url) { return new Response(null, { status: 302, headers: { Location: url } }); }

// Resolve the caller's lostark.bible access token from their ?s= session id. Returns "" when the
// caller isn't signed in (the drain and anonymous requests) — callers fall back to BIBLE_TOKEN.
async function sessionToken(env, u) {
  const sid = u.searchParams.get("s") || "";
  if (!sid || !env.OAUTH) return "";
  let rec = null;
  try { rec = await env.OAUTH.get(OAUTH_SESS + sid, "json"); } catch (e) { rec = null; }
  return (rec && rec.t) || "";
}

// ---- Service (probe/drain) token -----------------------------------------------------------
// The background drain and the recovery probe have no user driving them, so they carry no user
// token. Instead we keep ONE stored token: the token of the account that owns the canary character
// (Paroxysmal, see CANARY). Because that account owns Paroxysmal, its token can always fetch that
// page — making the probe a reliable "is lostark.bible reachable with a valid token again?" check.
// Stored in the OAUTH namespace (never CHARS — a bare list() there feeds the PUBLIC leaderboard,
// so a token in a character record would leak). It is never returned in any response.
const PROBE_TOKEN_KEY = "probe:token";   // OAUTH KV: { token, at, verified }

async function getServiceToken(env) {
  if (!env || !env.OAUTH) return "";
  try { const r = await env.OAUTH.get(PROBE_TOKEN_KEY, "json"); return (r && r.token) || ""; } catch (e) { return ""; }
}

// POST /oauth/probe-token  (Authorization: Bearer <uwo_...>) — a signed-in user offers their token
// as the drain/probe credential. We only STORE it if its roster includes the canary character, so
// the stored token can always fetch the canary. The token itself never leaves the Worker after this.
async function storeProbeToken(env, request) {
  if (!env.OAUTH) return json({ error: "not configured (no OAUTH binding)" }, 503);
  const authz = request.headers.get("Authorization") || "";
  const tok = authz.indexOf("Bearer ") === 0 ? authz.slice(7).trim() : "";
  if (!tok) return json({ error: "Authorization: Bearer <token> required" }, 400);

  // Verify server-side that this token owns the canary. The OAuth API is CORS-enabled and separate
  // from the (possibly blocked) character page, so this can succeed even while scraping is blocked.
  let owns = null, apiStatus = 0;
  try {
    const r = await fetch("https://lostark.bible/api/oauth/rosters", { headers: { "Authorization": "Bearer " + tok, "Accept": "application/json" } });
    apiStatus = r.status;
    if (r.ok) {
      const j = await r.json();
      owns = false;
      const wantName = CANARY.name.toLowerCase(), wantRegion = CANARY.region.toUpperCase();
      for (const ro of (j && j.rosters) || []) {
        const roRegion = String((ro && ro.region) || "").toUpperCase();
        for (const c of (ro && ro.characters) || []) {
          const cRegion = String((c && c.region) || roRegion).toUpperCase();
          if (cRegion === wantRegion && String(c && c.name).toLowerCase() === wantName) owns = true;
        }
      }
    }
  } catch (e) { apiStatus = 0; }

  if (owns === false) {
    return json({ stored: false, owns: false, reason: "this account's roster doesn't include " + CANARY.name }, 200);
  }
  if (owns !== true) {
    // API unreachable/failed — don't overwrite a good token with an unverified one.
    return json({ stored: false, owns: null, apiStatus: apiStatus, reason: "couldn't verify roster (API " + apiStatus + ")" }, 200);
  }
  try { await env.OAUTH.put(PROBE_TOKEN_KEY, JSON.stringify({ token: tok, at: Date.now(), verified: true })); }
  catch (e) { return json({ error: "store failed" }, 503); }
  return json({ stored: true, owns: true }, 200);
}

// key = "region:name" lowercased (e.g. "na:paroxysmal").
function charKey(region, name) {
  return (region + ":" + name).toLowerCase();
}

// Normalize a character's DISPLAY name: for Roman/Latin-script names, capitalize the
// first letter and lowercase the rest ("subsz"->"Subsz", "PAROXYSMAL"->"Paroxysmal").
// Korean (Hangul) names are left untouched ("마스터Asia" stays as-is). LA names are
// single tokens (no spaces). NOTE: this only affects the display name; charKey() still
// lowercases "region:name" so the KV cache key stays case-insensitive and lookups hit.
function normalizeName(name){ if(!name) return name; if(/[가-힣㄰-㆏]/.test(name)) return name; return name.charAt(0).toUpperCase()+name.slice(1).toLowerCase(); }

// Read + JSON.parse a KV value, tolerating missing/corrupt entries.
async function kvGetJson(env, key) {
  if (!env || !env.CHARS) return null;
  try {
    const raw = await env.CHARS.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// (No indexAdd anymore: handleList enumerates keys via KV list(), which is race-free.
// The old read-modify-write on "__index__" could lose an add when two pulls ran
// concurrently, so a character would grade fine yet never appear in ?list=1.)

// --- KR (lopec.kr) support --------------------------------------------------
// lopec.kr is a Next.js app whose RSC payload carries clean gem objects:
//   {icon:"…/use_13_2NN.png", requiredWillpower, orderChaosPoint, effects:[{name,level}]}
// icon 202/203/204 = order c8/c9/c10, 205/206/207 = chaos c8/c9/c10; requiredWillpower
// IS the willpower cost, so willpowerLevel = baseCost − requiredWillpower.
const KR_EFFECT = {
  "추가 피해": "Additional Damage",
  "공격력": "Attack Power",
  "보스 피해": "Boss Damage",
  "아군 공격 강화": "Ally Attack Enh.",
  "아군 피해 강화": "Ally Damage Enh.",
  "낙인력": "Brand Power"
};
const KR_SLOT = { order: ["Order Sun", "Order Moon", "Order Star"], chaos: ["Chaos Sun", "Chaos Moon", "Chaos Star"] };
// lopec core-name prefix -> the SAME core id lostark.bible uses (SLOT_LABEL keys), so KR
// gems carry a real coreBase and the model's per-core grid math groups them correctly.
const KR_CORE_ID = {
  "질서의 해": 10001, "질서의 달": 10002, "질서의 별": 10003,
  "혼돈의 해": 10004, "혼돈의 달": 10005, "혼돈의 별": 10006
};

function parseLopecGems(html) {
  const u = html.replace(/\\"/g, '"'); // unescape the RSC JSON strings
  const gemRe = /use_13_(\d+)\.png","requiredWillpower":(\d+),"orderChaosPoint":(\d+),"effects":\[(.*?)\]\}/g;
  const effRe = /\{"name":"([^"]*)","level":(\d+)/g;
  const gems = [], warnings = [];

  function pushGem(m, coreBase, slot) {
    const icon = parseInt(m[1], 10), rel = icon - 202;
    if (rel < 0 || rel > 5) { warnings.push("unexpected gem icon " + icon); return; }
    const baseCost = 8 + (rel % 3);
    const gemType = rel < 3 ? "order" : "chaos";
    const effs = [];
    let e;
    effRe.lastIndex = 0;
    while ((e = effRe.exec(m[4])) !== null) {
      const en = KR_EFFECT[e[1]];
      if (!en) warnings.push("unknown KR effect '" + e[1] + "'");
      effs.push({ name: en || ("Effect:" + e[1]), level: parseInt(e[2], 10) });
    }
    const e1 = effs[0] || {}, e2 = effs[1] || {};
    gems.push({
      slot: slot, coreBase: coreBase,
      baseCost: baseCost, gemType: gemType,
      willpowerLevel: baseCost - parseInt(m[2], 10),
      orderLevel: parseInt(m[3], 10),
      effect1: e1.name, effect1Level: e1.level,
      effect2: e2.name, effect2Level: e2.level
    });
  }

  // The RSC carries the REAL core structure: six objects, each
  //   "name":"질서의 해 코어 : <core option>", … ,"gem":[ {icon,…}, … ]
  // Parse per-core so every gem gets its true coreBase (10001-10006) — the flat scan this
  // replaces guessed cores positionally (every 4 gems) and left coreBase null, which
  // collapsed all KR gems into one bucket in the grid totals and inflated KR damage.
  const coreRe = /"name":"(질서의 해|질서의 달|질서의 별|혼돈의 해|혼돈의 달|혼돈의 별)[^"]*"/g;
  const sections = [];
  let cm;
  while ((cm = coreRe.exec(u)) !== null) sections.push({ name: cm[1], at: cm.index });
  for (let s = 0; s < sections.length; s++) {
    const to = (s + 1 < sections.length) ? sections[s + 1].at : u.length;
    const gemAt = u.indexOf('"gem":[', sections[s].at);
    if (gemAt === -1 || gemAt >= to) continue;          // core with no gem array
    let depth = 0, end = -1;
    for (let k = gemAt + 6; k < to; k++) {               // bracket-scan the gem array
      const c = u[k];
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end === -1) continue;
    const coreBase = KR_CORE_ID[sections[s].name];
    const seg = u.slice(gemAt, end);
    gemRe.lastIndex = 0;
    let m;
    while ((m = gemRe.exec(seg)) !== null) pushGem(m, coreBase, SLOT_LABEL[coreBase]);
  }

  // Fallback (lopec layout change: no core headers matched): the old flat scan with
  // positional slot labels and no coreBase — the model still groups these by slot label.
  if (!gems.length) {
    const counts = { order: 0, chaos: 0 };
    let m;
    gemRe.lastIndex = 0;
    while ((m = gemRe.exec(u)) !== null) {
      const icon = parseInt(m[1], 10), rel = icon - 202;
      const gemType = (rel >= 0 && rel < 3) ? "order" : "chaos";
      const slot = KR_SLOT[gemType][Math.floor(counts[gemType] / 4)] || (gemType + " gem");
      counts[gemType]++;
      pushGem(m, null, slot);
    }
    if (gems.length) warnings.push("lopec core headers not found — cores assigned positionally");
  }
  return { gems: gems, warnings: warnings };
}

// Known advanced classes — lostark.bible renders the English class name as a profile badge.
const CLASS_NAMES = ["Berserker","Destroyer","Gunlancer","Paladin","Slayer","Valkyrie","Arcanist","Summoner","Bard","Sorceress","Wardancer","Scrapper","Soulfist","Glaivier","Striker","Breaker","Deathblade","Shadowhunter","Reaper","Souleater","Sharpshooter","Deadeye","Artillerist","Machinist","Gunslinger","Aeromancer","Wildsoul","Artist","Guardianknight"];

// lopec.kr exposes the class only as its Korean name in the RSC ("class":"버서커").
// Map each Korean advanced-class name to the English name (the same keys the static
// app's class-icon files use). Anchored on user-confirmed: 버서커/환수사/아르카나.
const KR_CLASS = {
  "버서커": "Berserker", "디스트로이어": "Destroyer", "워로드": "Gunlancer", "홀리나이트": "Paladin", "슬레이어": "Slayer", "발키리": "Valkyrie",
  "아르카나": "Arcanist", "서머너": "Summoner", "바드": "Bard", "소서리스": "Sorceress",
  "배틀마스터": "Wardancer", "인파이터": "Scrapper", "기공사": "Soulfist", "창술사": "Glaivier", "스트라이커": "Striker", "브레이커": "Breaker",
  "블레이드": "Deathblade", "데모닉": "Shadowhunter", "리퍼": "Reaper", "소울이터": "Souleater",
  "헌터": "Sharpshooter", "데빌헌터": "Deadeye", "블래스터": "Artillerist", "스카우터": "Machinist", "건슬링어": "Gunslinger",
  "도화가": "Artist", "기상술사": "Aeromancer", "환수사": "Wildsoul",
  "가디언나이트": "Guardianknight" // new class (KR 2025-12-10); icon = Guardianknight.svg
};

// Item level + class from the page. lostark.bible: ilvl in the SvelteKit blob + the class
// as a profile badge. lopec.kr: per-piece "itemLevel" averaged (~= character level) + the
// class from the RSC "class" field (a Korean name) mapped to English via KR_CLASS.
function parseMeta(html, isKR) {
  let itemLevel = null, klass = null;
  if (isKR) {
    const u = html.replace(/\\"/g, '"'); // lopec.kr RSC escapes its quotes
    const lvls = []; const re = /"itemLevel":\s*(\d+)/g; let m;
    while ((m = re.exec(u)) !== null) lvls.push(parseInt(m[1], 10));
    if (lvls.length) itemLevel = Math.round(lvls.reduce((a, b) => a + b, 0) / lvls.length);
    // class: the first RSC "class":"<value>" whose value is a known Korean class name
    // (skips CSS "className"/"firstClass"/"secondClass" — different keys).
    const re2 = /"class":"([^"]+)"/g; let cm;
    while ((cm = re2.exec(u)) !== null) { if (KR_CLASS[cm[1]]) { klass = KR_CLASS[cm[1]]; break; } }
  } else {
    const im = html.match(/ilvl:(\d+)/);
    if (im) itemLevel = parseInt(im[1], 10);
    const re = /bg-neutral-900 px-2 py-1 text-sm">([^<]+)<\/p>/g; let m;
    while ((m = re.exec(html)) !== null) {
      if (CLASS_NAMES.indexOf(m[1]) !== -1) { klass = m[1]; break; }
    }
  }
  return { itemLevel: itemLevel, klass: klass };
}

// ---- combat power / accessories / classic gems (Grader gpd auto-default) ----------
// Reverse-engineered from the same SvelteKit blob as arkGridCores, anchored against the
// RENDERED pages of NA/Paroxysmal (all-high accessories, lv10 gems), NA/Millie (all-mid
// accessory rolls — every value landed exactly on the lost-ark-accessories tier tables),
// NA/Sadnass (lv7/9 gems) and NA/Esfera (Outgoing Damage +1.2% = mid).
//
// Accessory grinding lines live in the tier4_accessory stats[] with base:false.
//   type:2  -> index identifies the line, value is the roll ×100 (155 = 1.55%):
const ACC_LINE_NAME = {
  27: "Max HP+", 28: "HP Recovery+", 34: "Max MP+",
  46: "Stigma %", 49: "Attack Power %", 50: "Additional Damage %",
  74: "Crit Rate %", 76: "Crit Damage %", 106: "Debuff Duration %",
  124: "Attack Power+", 151: "Weapon Attack Power+", 152: "Weapon Attack Power %"
};
//   type:4  -> Outgoing Damage % as a buff id: index 62100000X, X = 0-based tier
//              (0 low 0.55 / 1 mid 1.20 / 2 high 2.00); value is always 0, so the
//              roll is synthesized from the tier digit (same ×100 scale).
const OUTGOING_BY_TIER = [55, 120, 200];
//   type:29 -> Gauge Gain % as a buff id: index 600X, X = 0-based tier (anchored on
//              NA/Esfera 6000 = low neck and NA/Limerent 6002 = high on an all-high
//              support neck); value is always 0, synthesized like Outgoing.
const GAUGE_BY_TIER = [160, 360, 600];
//   other buff-style types (value ×100 like type:2):
const BUFF_TYPE_NAME = { 51: "Healing %", 54: "Ally Atk Buff %", 59: "Ally Dmg Buff %" };

// The page's HEADLINE (top-left) Combat Power is estimatedMaxCombatPower — the
// estimated RAID loadout. The plain combatPower field is only the last-seen equipped
// snapshot and can sit far below it when the character was last seen in a stripped or
// chaos build (NA/Kayamix renders ≈5466.3 while plain combatPower says 2284.76).
// Characters without an estimate (e.g. NA/Millie) fall back to the plain field; the
// [^A-Za-z] guard keeps the fallback from matching inside max/estimatedMaxCombatPower.
function parseCombatPower(html) {
  let m = html.match(/estimatedMaxCombatPower:\{id:\d+,score:([\d.]+)\}/);
  if (!m) m = html.match(/[^A-Za-z]combatPower:\{id:\d+,score:([\d.]+)\}/);
  return m ? parseFloat(m[1]) : null;
}

// The five tier4 accessories (neck/ear1/ear2/finger1/finger2) with their grinding
// lines as { name, value } (value ×100). The blob repeats the equipment block per
// loadout (raid first, then chaos); first occurrence per slot wins (= the raid set).
function parseAccessories(html) {
  const out = [], seen = {};
  const re = /slot:"(neck|ear1|ear2|finger1|finger2)",data:\{type:"tier4_accessory",stats:\[(.*?)\]\}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = 1;
    const lines = [];
    const sre = /\{type:(\d+),index:(\d+),base:false,id:\d+,value:(\d+)\}/g;
    let sm;
    while ((sm = sre.exec(m[2])) !== null) {
      const type = +sm[1], index = +sm[2], value = +sm[3];
      if (type === 2) lines.push({ name: ACC_LINE_NAME[index] || ("line#" + index), value: value });
      else if (type === 4) lines.push({ name: "Outgoing Damage %", value: OUTGOING_BY_TIER[index % 10] != null ? OUTGOING_BY_TIER[index % 10] : null });
      else if (type === 29) lines.push({ name: "Gauge Gain %", value: GAUGE_BY_TIER[index % 10] != null ? GAUGE_BY_TIER[index % 10] : null });
      else lines.push({ name: BUFF_TYPE_NAME[type] || ("line?t" + type), value: value || null });
    }
    out.push({ slot: m[1], lines: lines });
  }
  return out.length ? out : null;
}

// Per-piece honing from the equipment slots (raid loadout = first occurrence
// per slot). armorMin is the next tap target; weaponAdv rides for display.
function parseEquipmentHoning(html) {
  const re = /slot:"(weapon|head|upper_body|lower_body|hand|shoulder)",data:\{type:"equipment",stats:\[.*?\],honing:(\d+)(?:,advancedHoning:(\d+))?/g;
  const seen = {}; let m;
  while ((m = re.exec(html)) !== null) {
    if (seen[m[1]] == null) seen[m[1]] = { honing: +m[2], adv: m[3] != null ? +m[3] : null };
  }
  const armor = ["head", "upper_body", "lower_body", "hand", "shoulder"]
    .map(sl => seen[sl]).filter(Boolean);
  if (!armor.length && !seen.weapon) return null;
  return {
    weapon: seen.weapon ? seen.weapon.honing : null,
    weaponAdv: seen.weapon ? seen.weapon.adv : null,
    armorMin: armor.length ? Math.min.apply(null, armor.map(a => a.honing)) : null,
    armor: armor.map(a => a.honing)
  };
}

// karma:{evolution,enlightenment,leap} — enlightenment is the level the GPD
// chart's karma ladder prices (21-30).
function parseKarma(html) {
  const m = html.match(/karma:\{evolution:(\d+),enlightenment:(\d+),leap:(\d+)\}/);
  return m ? { evolution: +m[1], enlightenment: +m[2], leap: +m[3] } : null;
}

// ability stone: three engravings [offense, offense, malus] with node counts.
function parseStone(html) {
  const m = html.match(/slot:"ability_stone",data:\{engravings:\[\{id:\d+,nodes:(\d+)\},\{id:\d+,nodes:(\d+)\},\{id:\d+,nodes:(\d+)\}\]/);
  if (!m) return null;
  return { a: Math.max(+m[1], +m[2]), b: Math.min(+m[1], +m[2]), malus: +m[3] };
}

// bracelet: fixed type-2 entries are the two stats; fixed:false rows the lines.
function parseBracelet(html) {
  const i = html.indexOf('slot:"bracelet"');
  if (i < 0) return null;
  const end = html.indexOf('slot:"', i + 10);
  const seg = html.slice(i, end > 0 ? end : i + 1500);
  const re = /\{type:(\d+),index:(\d+),id:\d+,value:(\d+),fixed:(true|false)\}/g;
  const stats = [], lines = []; let m;
  while ((m = re.exec(seg)) !== null) {
    if (m[4] === "true" && m[1] === "2") stats.push(+m[3]);
    else if (m[4] === "false") lines.push({ type: +m[1], index: +m[2], value: +m[3] });
  }
  if (!stats.length && !lines.length) return null;
  return { stats: stats, lines: lines };
}

// Classic (skill) gem levels from the equipment `gems:[{slot,id,effects}]` array.
// The gem id's level digits are unreliable across families (event gems break them), so
// the level comes from the primary effect value first — linear tables confirmed on
// levels 6/7/9/10 across three characters:
//   type 27 (damage %):        value = (4 + 2·level)·100   -> lv = (v/100 − 4)/2
//   type 5/34 (the other kind): value = (4 + 4·level)·100  -> lv = (v/100 − 4)/4
// Utility gems with NO such effect (e.g. NA/Limerent's slot-8 aura gem, all effects
// value 1000) fall back to the id digits, which ARE reliable for the standard
// 650[3|4]xLLy families (65041071 = lv7, 65032090 = lv9, 65031100 = lv10 — anchored on
// NA/Sadnass + rendered labels). A gem neither path can read yields null (the client
// requires a fully parsed set before using gem levels for anything). Picks the largest
// gems array in the page (the raid loadout; the chaos copy can miss slots).
function parseClassicGemLevels(html) {
  let best = null, from = 0;
  while (true) {
    const at = html.indexOf("gems:[{", from);
    if (at === -1) break;
    from = at + 1;
    const start = at + "gems:".length;
    let depth = 0, end = -1;
    for (let k = start; k < html.length; k++) {
      const c = html[k];
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end === -1) continue;
    const lit = html.slice(start, end);
    if (lit.indexOf("effects") === -1) continue;
    let arr = null;
    try { arr = JSON.parse(lit.replace(/([{,[])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')); } catch (e) { arr = null; }
    if (!Array.isArray(arr) || !arr.length || arr[0].id == null) continue;
    if (!best || arr.length > best.length) best = arr;
  }
  if (!best) return null;
  return best.map(function (g) {
    const effs = Array.isArray(g.effects) ? g.effects : [];
    for (const e of effs) {
      if (!e || e.value == null) continue;
      let lv = null;
      if (e.type === 27) lv = (e.value / 100 - 4) / 2;
      else if (e.type === 5 || e.type === 34) lv = (e.value / 100 - 4) / 4;
      else continue;
      if (isFinite(lv) && Math.abs(lv - Math.round(lv)) < 1e-9 && lv >= 1 && lv <= 10) return Math.round(lv);
      return null;
    }
    // No level-bearing effect (utility gem): id-digit fallback for the standard families.
    const m = String(g.id).match(/^650[34]\d(\d\d)\d$/);
    if (m) {
      const lv = parseInt(m[1], 10);
      if (lv >= 1 && lv <= 10) return lv;
    }
    return null;
  });
}

// Fetch a character page (lostark.bible, or lopec.kr when region is KR) and parse it
// into the stored gem shape. Returns { ok:true, data } or { ok:false, status, body }.
async function fetchCharacterData(env, region, name, userToken) {
  const isKR = String(region).toUpperCase() === "KR";
  // lostark.bible uses "CE" for EU Central; map our single "EU" option to it.
  const bibleRegion = String(region).toUpperCase() === "EU" ? "CE" : region;
  const url = isKR
    ? "https://lopec.kr/character/specPoint/" + encodeURIComponent(name)
    : "https://lostark.bible/character/" + encodeURIComponent(bibleRegion) + "/" + encodeURIComponent(name);
  const site = isKR ? "lopec.kr" : "lostark.bible";

  const headers = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": isKR ? "ko-KR,ko;q=0.9" : "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": isKR ? "https://lopec.kr/" : "https://lostark.bible/",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": "\"Google Chrome\";v=\"124\", \"Chromium\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\""
  };

  // lostark.bible granted this Worker access on the condition that every character-page
  // request carries `Authorization: Bearer <token>` (their owners, 2026-07-22). The token
  // lives ONLY as a Worker secret (BIBLE_TOKEN) — never in source, since this repo is public.
  // Sent to lostark.bible ONLY: lopec.kr is an unrelated site and must never receive it.
  // Which token: the one the caller passed — the requester's own for a user pull, the
  // requester's stored token for a drained queue item, or the Paroxysmal service token for
  // the recovery probe. When the caller passed NONE, the next line falls back to the shared
  // BIBLE_TOKEN secret (if set) — that fallback serves old queue items stored without a
  // token and an unarmed probe. USER pulls can't ride it: the router 401s a signed-out
  // lookup (needSignIn) before any fetch happens.
  if (!isKR) {
    const bibleToken = userToken || (env && env.BIBLE_TOKEN) || "";
    if (bibleToken) headers["Authorization"] = "Bearer " + bibleToken;
  }

  let resp;
  try {
    resp = await fetch(url, {
      headers: headers,
      // Follow SvelteKit redirects (region casing etc.).
      redirect: "follow"
    });
  } catch (e) {
    return { ok: false, status: 502, body: { error: "Upstream fetch failed: " + (e && e.message || e), url: url } };
  }

  if (resp.status === 404) {
    return { ok: false, status: 404, body: { error: "Character not found on " + site + ".", region: region, name: name, url: url, upstreamStatus: 404 } };
  }
  if (!resp.ok) {
    // 401/403 from lostark.bible almost always means the Bearer token is missing or stale —
    // say so, otherwise the fail-streak just trips the breaker into probe and reads as a block.
    const authIssue = !isKR && (resp.status === 401 || resp.status === 403);
    const hint = authIssue
      ? " Check the BIBLE_TOKEN Worker secret (wrangler secret put BIBLE_TOKEN)." +
        ((env && env.BIBLE_TOKEN) ? "" : " No BIBLE_TOKEN is currently set.")
      : "";
    return { ok: false, status: 502, body: { error: site + " returned HTTP " + resp.status + "." + hint, region: region, name: name, url: url, upstreamStatus: resp.status, authIssue: authIssue || undefined } };
  }

  const html = await resp.text();

  let gems, warnings, coreCount, chaosGems = null;
  if (isKR) {
    const parsed = parseLopecGems(html);
    gems = parsed.gems; warnings = parsed.warnings; coreCount = 6;
    if (!gems.length) {
      return { ok: false, status: 422, body: {
        error: "Could not find Ark Grid gems on the lopec.kr page (no astrogems set, or the site layout changed).",
        region: region, name: name, url: url
      } };
    }
  } else {
    const presets = extractArkGridCores(html);
    if (!presets.raid) {
      return { ok: false, status: 422, body: {
        error: "Could not find arkGridCores data on the page (the character may have no Ark Grid set, or the site layout changed).",
        region: region, name: name, url: url
      } };
    }
    const raidRes = coresToGems(presets.raid);
    gems = raidRes.gems; warnings = raidRes.warnings; coreCount = presets.raid.length;
    // Chaos-dungeon preset (a separate Ark Grid loadout), if the character has one.
    if (presets.chaos) chaosGems = coresToGems(presets.chaos).gems;
  }

  const meta = parseMeta(html, isKR);
  // Economy signals for the Grader's gpd auto-default (lostark.bible only — the lopec.kr
  // RSC has no combat power / accessory / classic-gem data we parse). Null when absent.
  const combatPower = isKR ? null : parseCombatPower(html);
  const accessories = isKR ? null : parseAccessories(html);
  const classicGemLevels = isKR ? null : parseClassicGemLevels(html);
  const equipment = isKR ? null : parseEquipmentHoning(html);
  const karma = isKR ? null : parseKarma(html);
  const stone = isKR ? null : parseStone(html);
  const bracelet = isKR ? null : parseBracelet(html);
  return { ok: true, data: {
    region: region,
    combatPower: combatPower,
    accessories: accessories,
    classicGemLevels: classicGemLevels,
    equipment: equipment,
    karma: karma,
    stone: stone,
    bracelet: bracelet,
    // Normalize the DISPLAY name (Roman-script -> Title-case; Korean left as-is). This
    // record flows into both the KV value and the JSON response, and ?list=1 echoes it,
    // so the leaderboard shows normalized names. The KV cache KEY is unaffected — it
    // comes from charKey(region, name) on the ORIGINAL requested name, which lowercases.
    name: normalizeName(name),
    source: site,
    url: url,
    itemLevel: meta.itemLevel,
    class: meta.klass,
    coreCount: coreCount,
    gemCount: gems.length,
    gems: gems,
    chaosGems: chaosGems,
    warnings: warnings
  } };
}

// GET /?region=&name= — cache-aware single-character pull.
//   - cache hit (key present, pulledAt < 7d, no &refresh=1) -> return stored JSON, cached:true.
//   - else fetch fresh, store { region, name, gems, pulledAt, ... }, index the key, cached:false.
//   - &refresh=1 bypasses the cache read (force fresh + re-store).
//   - no env.CHARS -> fetch fresh every time, no caching (cached:false, no pulledAt write).
async function handleCharacter(env, region, name, refresh, extra, userToken) {
  const key = charKey(region, name);
  extra = extra || {};

  let stale = null;
  if (env && env.CHARS) {
    const cached = await kvGetJson(env, key);
    if (cached && typeof cached.pulledAt === "number") {
      if (!refresh && (Date.now() - cached.pulledAt) < CACHE_TTL_MS) {
        return json(Object.assign({}, cached, { cached: true }, extra), 200);
      }
      stale = cached;   // >7d old (or refresh=1): try fresh, keep this as the fallback
    }
  }

  const res = await fetchCharacterData(env, region, name, userToken);
  if (!res.ok) {
    // SERVE-STALE-ON-ERROR (2026-07-21): lostark.bible rate-limits Cloudflare
    // egress IPs (429 to the worker while the same request gets 200 from a
    // residential IP) — an old record beats an error page every time. Clients
    // can caveat the display via stale/staleDays.
    if (stale) return json(Object.assign({}, stale, {
      cached: true, stale: true,
      staleDays: Math.round((Date.now() - stale.pulledAt) / 86400000),
      staleReason: (res.body && res.body.error) || ("HTTP " + res.status)
    }, extra), 200);
    return json(Object.assign({}, res.body, extra), res.status);
  }

  const record = Object.assign({}, res.data, { pulledAt: Date.now() });
  if (env && env.CHARS) {
    try {
      await env.CHARS.put(key, JSON.stringify(record));
      await markDirty(env, key);                              // #3: queue this char for the incremental snapshot
      // Bump the leaderboard "last write" stamp (informational for the dashboard).
      await env.CHARS.put(LASTWRITE_KEY, String(Date.now()));
    } catch (e) {
      // Storage failure is non-fatal: still return the freshly fetched data.
    }
  }
  return json(Object.assign({}, record, { cached: false }, extra), 200);
}

// #3: mark a character changed so the next snapshot rebuild merges JUST it (not all ~4000 records).
function markDirty(env, ck) { return env.CHARS.put(DIRTY_PREFIX + ck, "1", { expirationTtl: SNAPSHOT_DIRTY_TTL_S }).catch(function () {}); }

// Is this KV key an actual character record ("region:name")? Skip control/queue/marker keys —
// especially q:* queue items, whose VALUE holds the requester's token (must never be read into
// the public list).
function isCharKey(n) {
  return !(n === INDEX_KEY || n.indexOf("q:") === 0 || n.indexOf("drain:") === 0 ||
           n.indexOf("usage:") === 0 || n.indexOf("nf:") === 0 || n.indexOf("lb:") === 0 ||
           n.indexOf("fb:") === 0 || n.indexOf("impc:") === 0);
}

// From-scratch rebuild of the leaderboard list, CHUNKED across cron ticks. The naive version
// (list everything + one KV get per character, in one go) blows the ~1,000-subrequest budget of
// a single invocation at ~5.5k stored characters — it died mid-flight every tick and left the
// leaderboard PERMANENTLY empty whenever the snapshot had to be built from nothing. Now each
// tick reads ≤ REBUILD_KEYS_PER_RUN records, parks the partial list (gzipped) + the list cursor
// in KV, and resumes on the next tick; the finishing tick returns the full list (and the caller
// writes the real snapshot). Only the FIRST build pays this — later builds are incremental.
const REBUILD_CURSOR_KEY = "lb:rebuild:cursor"; // { c: <kv list cursor> } — present while a rebuild is in flight
const REBUILD_ACC_KEY = "lb:rebuild:acc:gz";    // the characters accumulated so far, gzipped
const REBUILD_KEYS_PER_RUN = 750;               // record reads per tick — headroom under the ~1k budget even sharing the invocation with a drain

// One chunk of the from-scratch rebuild. Returns null while unfinished (progress parked in KV),
// else the complete character list (parked state cleared).
async function buildCharacterListChunk(env) {
  let acc = [], cursor;
  const st = await kvGetJson(env, REBUILD_CURSOR_KEY);
  if (st) {
    cursor = st.c || undefined;
    try {
      const gz = await env.CHARS.get(REBUILD_ACC_KEY, "arrayBuffer");
      acc = (gz && gz.byteLength) ? await gunzipToJson(gz) : [];
      if (!Array.isArray(acc)) { acc = []; cursor = undefined; }
    } catch (e) { acc = []; cursor = undefined; }          // corrupt/missing accumulator -> restart clean
  }
  const res = await env.CHARS.list({ cursor: cursor, limit: REBUILD_KEYS_PER_RUN });
  const names = [];
  for (const k of res.keys) { if (isCharKey(k.name)) names.push(k.name); }
  // Read this page's records CONCURRENTLY (≤ REBUILD_KEYS_PER_RUN gets); Promise.all collapses latency.
  const records = await Promise.all(names.map(function (k) { return kvGetJson(env, k); }));
  for (const c of records) {
    if (c && Array.isArray(c.gems)) {
      acc.push({ region: c.region, name: c.name, gems: c.gems, pulledAt: c.pulledAt, itemLevel: c.itemLevel, class: c.class });
    }
  }
  if (!res.list_complete) {
    // More pages left: park progress and let the next cron tick continue.
    await env.CHARS.put(REBUILD_ACC_KEY, await gzipString(JSON.stringify(acc)));
    await env.CHARS.put(REBUILD_CURSOR_KEY, JSON.stringify({ c: res.cursor }));
    return null;
  }
  // Done. Dedupe by region:name, newest wins — an import-triggered rebuild call can step the
  // machine concurrently with the cron and re-append a page; cheap insurance against double rows.
  const byId = {};
  for (const c of acc) {
    const id = (c.region + ":" + c.name).toLowerCase();
    if (!byId[id] || (c.pulledAt || 0) >= (byId[id].pulledAt || 0)) byId[id] = c;
  }
  const characters = Object.keys(byId).map(function (id) { return byId[id]; });
  try { await env.CHARS.delete(REBUILD_CURSOR_KEY); } catch (e) {}
  try { await env.CHARS.delete(REBUILD_ACC_KEY); } catch (e) {}
  return characters;
}

// ---- Feedback (?feedback=1) ----
// Public POST stores a note under "fb:<ts>-<rand>" in the CHARS KV. The rebuild skips the
// fb: prefix (and these records carry no gems[], so the leaderboard ignores them
// regardless). Admin (X-Admin-Token): GET lists, POST &read=/&del= mutates. Everything is
// trimmed + length-capped; a filled honeypot field is accepted-and-dropped silently.
// Notes self-expire after ~90 days (they can hold contact PII — it must not sit forever).
const FB_PREFIX = "fb:";
const FB_MSG_MAX = 2000, FB_CONTACT_MAX = 80, FB_TYPE_MAX = 40;
const FB_TTL_S = 90 * 24 * 3600;   // feedback record lifetime
const FB_LIST_MAX = 200;           // newest notes the admin list reads per request (caps KV gets)

async function handleFeedbackSubmit(env, request, ip) {
  // Own throttle (fb-scoped key in the shared per-IP namespace): before this, feedback POSTs
  // were the one write path with no rate limit beyond HARD_CAP.
  if (env.LOOKUP_THROTTLE) {
    const t = await env.LOOKUP_THROTTLE.limit({ key: "fb:" + ip });
    if (!t.success) return json({ error: "One feedback note every few seconds — please wait a moment.", rateLimited: true, retryAfterMs: 5000, throttled: true }, 429);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON." }, 400); }
  if (body && String(body.hp || "").trim()) return json({ ok: true });   // honeypot: a bot filled it — drop
  const message = String((body && body.message) || "").trim().slice(0, FB_MSG_MAX);
  if (!message) return json({ error: "Message is required." }, 400);
  if (!env || !env.CHARS) return json({ error: "Feedback storage not configured." }, 503);
  const rec = {
    ts: Date.now(),
    type: String((body && body.type) || "Other").trim().slice(0, FB_TYPE_MAX),
    message: message,
    contact: String((body && body.contact) || "").trim().slice(0, FB_CONTACT_MAX),
    ua: (request.headers.get("User-Agent") || "").slice(0, 160),
    read: false
  };
  const key = FB_PREFIX + rec.ts + "-" + Math.random().toString(36).slice(2, 8);
  try { await env.CHARS.put(key, JSON.stringify(rec), { expirationTtl: FB_TTL_S }); }
  catch (e) { return json({ error: "Could not save." }, 500); }
  return json({ ok: true });
}

// Admin feedback MUTATIONS (POST + X-Admin-Token; the router checks the header first).
//   POST ?feedback=1&read=<id>  -> mark that note read
//   POST ?feedback=1&del=<id>   -> delete that note
async function handleFeedbackAdminMutate(env, u) {
  if (!env || !env.CHARS) return json({ error: "Not configured." }, 503);
  const del = u.searchParams.get("del");
  if (del) { try { await env.CHARS.delete(FB_PREFIX + del.replace(/^fb:/, "")); } catch (e) {} return json({ ok: true }); }
  const read = u.searchParams.get("read");
  if (read) {
    const k = FB_PREFIX + read.replace(/^fb:/, "");
    // Re-putting refreshes the TTL — acceptable: a note the admin touched may live another 90d.
    try { const r = await env.CHARS.get(k, "json"); if (r) { r.read = true; await env.CHARS.put(k, JSON.stringify(r), { expirationTtl: FB_TTL_S }); } } catch (e) {}
    return json({ ok: true });
  }
  return json({ error: "pass read=<id> or del=<id>" }, 400);
}

// Admin feedback LIST (GET + X-Admin-Token; the router checks the header first).
//   ?feedback=1 -> { items:[{id,ts,type,message,contact,ua,read}], count, total, unread }
// Reads only the NEWEST FB_LIST_MAX notes: the key embeds Date.now() ms, so the lexicographic
// list order IS chronological and the tail of the key list is the newest. This caps the
// Promise.all at ≤200 gets (an unbounded read-all was on a path to the ~1k-op limit); `total`
// reports how many exist so the UI can say "showing 200 of N". `unread` counts the returned
// window only.
async function handleFeedbackAdmin(env, u) {
  if (!env || !env.CHARS) return json({ error: "Not configured." }, 503);
  const keys = [];
  let cursor;
  do {
    const res = await env.CHARS.list({ prefix: FB_PREFIX, cursor: cursor, limit: 1000 });
    for (const k of res.keys) keys.push(k.name);
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  const newest = keys.slice(-FB_LIST_MAX);       // oldest-first list -> the tail is the newest
  const recs = await Promise.all(newest.map(function (k) {
    return kvGetJson(env, k).then(function (r) { return r ? Object.assign({ id: k.slice(FB_PREFIX.length) }, r) : null; });
  }));
  const items = recs.filter(Boolean).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return json({ ok: true, items: items, count: items.length, total: keys.length, unread: items.filter(function (x) { return !x.read; }).length });
}

// ---- snapshot format v2 (compact) ----
// v1 stores every gem as a ~12-key object; at ~5.8k characters that's 30MB+ of JSON the
// browser parses on every board open. v2 packs each gem into a 9-slot tuple with
// table-indexed strings (~10x less JSON) and is SELF-DESCRIBING: the class/effect tables
// ride in the payload, so client and worker can never drift.
//   { v:2, builtAt, classes:[...], effects:[...], characters:[
//       [region, name, itemLevel, classIdx, pulledAt, [ [core,cost,type,wp,order,e1,e1v,e2,e2v], ... ]], ... ] }
//   core: 1-6 = coreBase-10000 (Order Sun..Chaos Star), 0 = unknown; type: 0=order 1=chaos;
//   e1/e2: 1-based index into effects[], 0 = none; classIdx: -1 = none. gemId/idx (debug-only)
//   are dropped — the grader pulls full records per character, only the board uses this.
const CORE_ID_BY_LABEL = {};
for (const _cid in SLOT_LABEL) CORE_ID_BY_LABEL[SLOT_LABEL[_cid]] = parseInt(_cid, 10);
// Interning closures over EXISTING class/effect tables (mutated in place as new names
// appear) — the incremental rebuild seeds these from the stored snapshot's own tables so
// merged rows index into them consistently.
function v2Tables(classes, effects) {
  const classIdx = {}, effectIdx = {};
  for (let i = 0; i < classes.length; i++) classIdx[classes[i]] = i;
  for (let i = 0; i < effects.length; i++) effectIdx[effects[i]] = i + 1;
  return {
    ci: function (n) { if (!n) return -1; if (classIdx[n] == null) { classIdx[n] = classes.length; classes.push(n); } return classIdx[n]; },
    ei: function (n) { if (!n) return 0; if (effectIdx[n] == null) { effectIdx[n] = effects.length + 1; effects.push(n); } return effectIdx[n]; }
  };
}
function encodeCharRowV2(c, ci, ei) {
  const gems = (c.gems || []).map(function (g) {
    let core = 0;
    if (g.coreBase != null && SLOT_LABEL[g.coreBase]) core = g.coreBase - 10000;
    else if (g.slot != null && CORE_ID_BY_LABEL[g.slot]) core = CORE_ID_BY_LABEL[g.slot] - 10000;
    return [core, g.baseCost == null ? null : g.baseCost, g.gemType === "chaos" ? 1 : 0,
      g.willpowerLevel == null ? null : g.willpowerLevel, g.orderLevel == null ? null : g.orderLevel,
      ei(g.effect1), g.effect1Level == null ? null : g.effect1Level,
      ei(g.effect2), g.effect2Level == null ? null : g.effect2Level];
  });
  return [c.region, c.name, c.itemLevel == null ? null : c.itemLevel, ci(c.class), c.pulledAt || 0, gems];
}
function encodeSnapshotV2(builtAt, characters) {
  const classes = [], effects = [];
  const t = v2Tables(classes, effects);
  const chars = characters.map(function (c) { return encodeCharRowV2(c, t.ci, t.ei); });
  return { v: 2, builtAt: builtAt, classes: classes, effects: effects, characters: chars };
}

// gzip helpers for the snapshot (Workers-native CompressionStream — no library).
async function gzipString(s) {
  const cs = new CompressionStream("gzip");
  return new Response(new Response(s).body.pipeThrough(cs)).arrayBuffer();
}
async function gunzipToJson(buf) {
  const ds = new DecompressionStream("gzip");
  return new Response(new Response(buf).body.pipeThrough(ds)).json();
}
// Read the stored V2 snapshot for MUTATION (the incremental rebuild). v2 ONLY, by design:
// materializing the legacy v1 object (~93MB of JSON at ~19k characters) is exactly what
// blew the isolate's 128MB limit and froze the board for 2 days (every cron tick died
// exceededMemory) — it must never be read again. No v2 stored -> null -> chunked first build.
async function readSnapshotV2(env) {
  try {
    const gz = await env.CHARS.get(SNAPSHOT_GZ2_KEY, "arrayBuffer");
    if (gz && gz.byteLength) return await gunzipToJson(gz);
  } catch (e) {}
  return null;
}

// GET /?list=1 — leaderboard list. Serves the STORED GZIP BYTES as-is in a single read
// (Content-Encoding: gzip; the edge transparently decompresses for non-gzip clients), so a
// request costs one KV read and zero JSON work. NEVER rebuilds on demand: the snapshot is
// maintained server-side by the cron (rebuildSnapshotIfChanged). Empty until the first build.
async function handleList(env, acceptEncoding, fmt) {
  if (!env || !env.CHARS) return json({ characters: [] }, 200);
  try {
    // v2 (compact tuples) is the ONLY stored format now — `fmt` is accepted but ignored.
    // (v1 grew to ~93MB uncompressed and OOM'd the rebuild; every live client requests
    // fmt=2 and its decoder branches on the payload's `v` field.) The legacy gz key is a
    // read fallback only until the first post-fix rebuild deletes it.
    const gz = (await env.CHARS.get(SNAPSHOT_GZ2_KEY, "arrayBuffer"))
      || await env.CHARS.get(SNAPSHOT_GZ_KEY, "arrayBuffer");
    if (gz && gz.byteLength) {
      if (!/gzip/i.test(acceptEncoding || "")) {
        // rare non-gzip client (plain curl, odd scripts): decompress for them — the edge does NOT.
        return new Response(new Response(gz).body.pipeThrough(new DecompressionStream("gzip")), {
          status: 200,
          headers: { "Content-Type": "application/json" }   // CORS stamped on by the fetch() wrapper
        });
      }
      return new Response(gz, {
        status: 200,
        encodeBody: "manual", // body is ALREADY gzip — without this the runtime re-encodes it (double-gzip) to honor the header
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }   // CORS stamped on by the fetch() wrapper
      });
    }
  } catch (e) {}
  const snap = await kvGetJson(env, SNAPSHOT_KEY); // legacy fallback until the first gz rebuild
  const characters = (snap && Array.isArray(snap.characters)) ? snap.characters : [];
  return json({ characters: characters, builtAt: (snap && snap.builtAt) || 0 }, 200);
}

// Cron entry: refresh the leaderboard snapshot INCREMENTALLY. The dirty markers (lb:dirty:<key>,
// written whenever a character is cached) are the change log — list them (one list), read ONLY those
// records, and upsert them into the existing snapshot, instead of re-reading all ~4000 characters.
// The FIRST build (no snapshot yet) still does a full read. Throttled to ~every 30 min. Markers added
// mid-build keep their marker (only the ones we listed are cleared), so nothing is lost.
async function rebuildSnapshotIfChanged(env, minIntervalMs) {
  if (!env || !env.CHARS) return;
  // Throttle FIRST (one cheap read): inside the window the outcome is "return" whether or not
  // anything is dirty, so don't pay the dirty-prefix list() every minute (~43k lists/mo saved).
  // The cron uses the default ~30-min window; an import passes a short one so a contributed
  // character shows on the leaderboard within seconds instead of waiting up to half an hour.
  const interval = (typeof minIntervalMs === "number") ? minIntervalMs : SNAPSHOT_MIN_INTERVAL_MS;
  const builtAt = parseInt((await env.CHARS.get(BUILTAT_KEY)) || "0", 10);
  if (builtAt > 0 && (Date.now() - builtAt) < interval) return;
  let dirty;
  try { dirty = await env.CHARS.list({ prefix: DIRTY_PREFIX }); } catch (e) { return; }
  if (builtAt > 0 && !dirty.keys.length) return;                                // nothing changed since the last build
  const startedAt = Date.now();
  const snap = await readSnapshotV2(env);
  let payload, fromScratch = false;
  if (snap && Array.isArray(snap.characters) && snap.characters.length) {
    // INCREMENTAL, in TUPLE SPACE: upsert the changed characters as encoded v2 rows,
    // never expanding the snapshot into full per-gem objects (at ~19k characters that
    // object graph rivals the isolate's 128MB limit — the tuple form stays ~10x smaller).
    // The interning tables are seeded from the stored snapshot so old rows keep their indices.
    const classes = snap.classes || [], effects = snap.effects || [];
    const t = v2Tables(classes, effects);
    const rows = snap.characters;
    const idx = {};
    for (let i = 0; i < rows.length; i++) idx[(rows[i][0] + ":" + rows[i][1]).toLowerCase()] = i;
    const charKeys = dirty.keys.map(function (k) { return k.name.slice(DIRTY_PREFIX.length); });
    const recs = await Promise.all(charKeys.map(function (ck) { return kvGetJson(env, ck); }));
    for (const c of recs) {
      if (c && Array.isArray(c.gems)) {
        const row = encodeCharRowV2(c, t.ci, t.ei);
        const id = (c.region + ":" + c.name).toLowerCase();
        if (idx[id] != null) rows[idx[id]] = row; else { idx[id] = rows.length; rows.push(row); }
      }
    }
    payload = { v: 2, builtAt: startedAt, classes: classes, effects: effects, characters: rows };
  } else {
    // First build: CHUNKED across cron ticks (#8) — null means "progress parked, resume next tick".
    fromScratch = true;
    const characters = await buildCharacterListChunk(env);
    if (!characters) return;
    if (!characters.length) return;
    payload = encodeSnapshotV2(startedAt, characters);
  }
  const gz2Bytes = await gzipString(JSON.stringify(payload));
  await env.CHARS.put(SNAPSHOT_GZ2_KEY, gz2Bytes);
  try { await env.CHARS.delete(SNAPSHOT_GZ_KEY); } catch (e) {} // drop the v1 blob for good (its ~93MB expansion is what OOM'd the rebuild)
  try { await env.CHARS.delete(SNAPSHOT_KEY); } catch (e) {}    // pre-gz plain copy, if any pre-migration deploy still has one
  await env.CHARS.put(BUILTAT_KEY, String(startedAt));
  // clear ONLY the markers we listed (any written mid-build keep theirs -> picked up next rebuild).
  // A finished FROM-SCRATCH build keeps ALL markers: it spanned several ticks, so a character
  // re-cached mid-build may hold newer data than the page we read — the next incremental pass
  // upserts (then clears) them.
  if (!fromScratch) await Promise.all(dirty.keys.map(function (k) { return env.CHARS.delete(k.name).catch(function () {}); }));
}

// Rolling per-drain history (~last hour) for the admin dashboard: every cron drain appends one
// entry (what it cached / dropped / failed + why it stopped, with upstream status + message per
// error) so the owner can watch drain activity and diagnose upstream issues without reading logs.
const DRAIN_LOG_KEY = "drain:log";
const DRAIN_LOG_MAX_MS = 60 * 60 * 1000;     // keep ~1 hour of entries
async function appendDrainLog(env, run) {
  try {
    const log = (await kvGetJson(env, DRAIN_LOG_KEY)) || [];
    log.push(run);
    const cut = Date.now() - DRAIN_LOG_MAX_MS;
    const kept = log.filter(function (e) { return e && e.t >= cut; }).slice(-240); // 1h window + hard cap
    await env.CHARS.put(DRAIN_LOG_KEY, JSON.stringify(kept));
  } catch (e) {}
}

// ==================== the weekly top-rank repull sweep ====================
// Keeps the top of the leaderboard fresh without anyone pressing Re-pull. Owner-approved
// design (2026-08-17):
//   - TARGETS  : top 1000 overall (total dmg%, the board's ranking key) + top 100 of every
//                class (the four support classes ranked by their party-buff axis, matching
//                the board's Support view) — deduped, ~2.9k characters at 29 classes
//                (measured 2026-08-17), so a full sweep is ~2 days at 1/min.
//   - PRIORITY : min(overall rank, 10 x class rank), ascending — overall #1 and each class's
//                #1 lead, and the class quota's tail (#100) aligns with overall #1000.
//   - PACE     : at most ONE upstream fetch per cron minute, and only while the drain mode
//                is "run" (probe/off pauses the sweep exactly like it pauses lookups).
//   - STALENESS: an entry is fetched only if its record is >7d old (CACHE_TTL_MS) AT FETCH
//                TIME — fresh entries (user re-pulled meanwhile) are skipped for free.
//   - AUTH     : the armed probe/service token (the owner's own sign-in, /oauth/probe-token).
//                Upstream 401/403 with it pauses ONLY the sweep (never the breaker); a real
//                site block (429/418/451) trips the breaker to probe exactly like the drain.
//   - The plan rebuilds once a week from the snapshot; fetches count against the monthly
//     budget and show in the admin drain history tagged `repull`.
const REPULL_PLAN_KEY = "rp:plan";           // JSON [[region, name], ...] in priority order
const REPULL_STATE_KEY = "rp:state";         // { builtAt, planLen, cursor, fetched, skipped, dropped, headAtt, failStreak, backoffUntil, lastAt, lastResult }
const REPULL_WEEK_MS = 7 * 24 * 3600 * 1000; // plan rebuild cadence
const REPULL_TOP_OVERALL = 1000;             // overall board depth
const REPULL_TOP_CLASS = 100;                // per-class depth
const REPULL_SKIP_CAP = 25;                  // fresh-entry skips per tick (each is a KV read)
const REPULL_MAX_HEAD_ATTEMPTS = 5;          // transient retries before an entry is given up (mirrors MAX_FETCH_ATTEMPTS)
const REPULL_BACKOFF_FIRST_MS = 5 * 60 * 1000;   // transient-failure backoff: 5 min, doubling
const REPULL_BACKOFF_MAX_MS = 6 * 3600 * 1000;   // ... capped at 6h (also the hard pause on a rejected token)
const REPULL_SUPPORT_CLASSES = { "Bard": 1, "Paladin": 1, "Artist": 1, "Valkyrie": 1 }; // keep in sync with leaderboard.js

// Decode one v2 snapshot row's gems back to model-shaped objects (inverse of encodeCharRowV2,
// same field set the board's client decoder builds — enough for AG.gridDamage).
function repullDecodeGems(payload, row) {
  const effects = payload.effects || [];
  function eff(i) { return (typeof i === "number" && i > 0) ? (effects[i - 1] || null) : null; }
  return (row[5] || []).map(function (g) {
    return {
      coreBase: g[0] ? 10000 + g[0] : null, baseCost: g[1], gemType: g[2] ? "chaos" : "order",
      willpowerLevel: g[3], orderLevel: g[4],
      effect1: eff(g[5]), effect1Level: g[6], effect2: eff(g[7]), effect2Level: g[8]
    };
  });
}

// Build the week's ranked plan from the stored snapshot. Runs on its own cron tick (no
// fetch that minute). Scoring stays transient per character — decode, score, discard —
// so the full object graph never accumulates (same memory discipline as the rebuild).
async function buildRepullPlan(env) {
  const snap = await readSnapshotV2(env);
  if (!snap || !Array.isArray(snap.characters) || !snap.characters.length) return false;
  const classes = snap.classes || [];
  const scored = [];
  for (let i = 0; i < snap.characters.length; i++) {
    const r = snap.characters[i];
    const gems = repullDecodeGems(snap, r);
    if (!gems.length) continue;
    const cls = (r[3] != null && r[3] >= 0) ? classes[r[3]] : null;
    let dps = 0, clsMetric = 0;
    try {
      dps = AG.gridDamage(gems, "dps") || 0;
      clsMetric = (cls && REPULL_SUPPORT_CLASSES[cls]) ? (AG.gridDamage(gems, "support") || 0) : dps;
    } catch (e) { continue; }
    scored.push({ region: r[0], name: r[1], cls: cls, dps: dps, cm: clsMetric, pri: Infinity });
  }
  scored.sort(function (a, b) { return b.dps - a.dps; });
  for (let i = 0; i < scored.length && i < REPULL_TOP_OVERALL; i++) scored[i].pri = i + 1;
  const byClass = {};
  // "null"/"undefined" are real strings in a few imported records — junk classes get no quota.
  for (let i = 0; i < scored.length; i++) { const s = scored[i]; if (s.cls && s.cls !== "null" && s.cls !== "undefined") (byClass[s.cls] = byClass[s.cls] || []).push(s); }
  for (const cls in byClass) {
    const list = byClass[cls].sort(function (a, b) { return b.cm - a.cm; });
    for (let i = 0; i < list.length && i < REPULL_TOP_CLASS; i++) list[i].pri = Math.min(list[i].pri, (i + 1) * 10);
  }
  const picked = scored.filter(function (s) { return s.pri !== Infinity; })
    .sort(function (a, b) { return a.pri - b.pri || b.dps - a.dps; })
    .map(function (s) { return [s.region, s.name]; });
  if (!picked.length) return false;
  await env.CHARS.put(REPULL_PLAN_KEY, JSON.stringify(picked));
  await env.CHARS.put(REPULL_STATE_KEY, JSON.stringify({
    builtAt: Date.now(), planLen: picked.length, cursor: 0,
    fetched: 0, skipped: 0, dropped: 0, headAtt: 0, failStreak: 0, backoffUntil: 0,
    lastAt: Date.now(), lastResult: "plan built (" + picked.length + " targets)"
  }));
  return true;
}

// One cron tick of the sweep: skip fresh entries (bounded), then do AT MOST one upstream
// fetch. Outcome branches mirror the drain's (ok / our-4xx / auth / block / transient).
async function runRepullTick(env, deadlineMs) {
  if (!env || !env.CHARS) return;
  try {
    const cfg = await getDrainConfig(env);
    if (cfg.mode !== "run") return;                       // breaker/probe/off pauses the sweep too
    const now = Date.now();
    const st = await kvGetJson(env, REPULL_STATE_KEY);
    if (!st || ((st.cursor | 0) >= (st.planLen | 0) && now - (st.builtAt || 0) >= REPULL_WEEK_MS)) {
      await buildRepullPlan(env);                         // build tick — the sweep starts next minute
      return;
    }
    if ((st.cursor | 0) >= (st.planLen | 0)) return;      // sweep done; wait out the week
    if (st.backoffUntil && now < st.backoffUntil) return;
    const token = await getServiceToken(env);
    if (!token) {
      st.lastAt = now; st.lastResult = "paused: no service token armed (POST /oauth/probe-token)";
      st.backoffUntil = now + REPULL_BACKOFF_MAX_MS;      // don't re-log this every minute
      await env.CHARS.put(REPULL_STATE_KEY, JSON.stringify(st));
      return;
    }
    const usage = await kvGetJson(env, USAGE_KEY);        // same monthly budget the drain honors
    if (usage && usage.month === new Date().toISOString().slice(0, 7) && (usage.count | 0) >= MONTHLY_CHAR_BUDGET) return;
    const plan = await kvGetJson(env, REPULL_PLAN_KEY);
    if (!Array.isArray(plan) || !plan.length) {           // plan lost (KV wipe): finish the cycle, rebuild next week-tick
      st.cursor = st.planLen; await env.CHARS.put(REPULL_STATE_KEY, JSON.stringify(st));
      return;
    }
    let skips = 0;
    while ((st.cursor | 0) < plan.length && skips < REPULL_SKIP_CAP && Date.now() < deadlineMs) {
      const target = plan[st.cursor], region = target[0], name = target[1];
      const key = charKey(region, name);
      const rec = await kvGetJson(env, key);
      if (rec && rec.pulledAt && Date.now() - rec.pulledAt < CACHE_TTL_MS) {
        st.cursor++; st.skipped++; st.headAtt = 0; skips++; continue;  // fresh (<7d): the rule — skip, no fetch
      }
      const t0 = Date.now();
      let res = null;
      try { res = await fetchCharacterData(env, region, name, token); } catch (e) { res = null; }
      const upstream = (res && res.body && res.body.upstreamStatus) || null;
      if (res && res.ok) {
        await env.CHARS.put(key, JSON.stringify(Object.assign({}, res.data, { pulledAt: Date.now() })));
        await markDirty(env, key);
        await env.CHARS.put(LASTWRITE_KEY, String(Date.now()));
        const m = new Date().toISOString().slice(0, 7);
        const u2 = await kvGetJson(env, USAGE_KEY);
        await env.CHARS.put(USAGE_KEY, JSON.stringify({ month: m, count: (u2 && u2.month === m ? (u2.count | 0) : 0) + 1 }), { expirationTtl: 40 * 24 * 3600 });
        await appendDrainLog(env, { t: Date.now(), cached: [region + ":" + name], dropped: [], failed: [], stop: null, repull: true, ms: Date.now() - t0 });
        st.cursor++; st.fetched++; st.headAtt = 0; st.failStreak = 0; st.backoffUntil = 0;
        st.lastResult = "cached " + region + ":" + name;
      } else if (res && res.status >= 400 && res.status < 500) {
        // our 404/422: renamed/deleted or no Ark Grid anymore — skip it for this sweep
        // (no nf: marker — that would block a legit user lookup of a maybe-transient miss for an hour)
        st.cursor++; st.dropped++; st.headAtt = 0;
        st.lastResult = "dropped " + region + ":" + name + " (HTTP " + res.status + ")";
      } else if (upstream === 401 || upstream === 403) {
        // the SERVICE token expired/revoked (mirrors the drain's per-item auth branch): pause
        // ONLY the sweep and say so — never trip the breaker, user lookups are unaffected.
        st.backoffUntil = now + REPULL_BACKOFF_MAX_MS;
        st.lastResult = "paused: service token rejected (upstream " + upstream + ") — re-arm via /oauth/probe-token";
      } else if (upstream >= 400 && upstream < 500) {
        // genuine site block (429/418/451): hand off to the breaker exactly like the drain;
        // probe auto-recovers, and the mode gate above keeps the sweep paused meanwhile.
        await setDrainConfig(env, { mode: "probe", drainPerMin: cfg.drainPerMin, lastProbe: Date.now(), interval: PAUSE_PROBE_FIRST_MS });
        st.lastResult = "blocked (upstream " + upstream + ") — breaker tripped to probe";
      } else {
        // transient 5xx/network/timeout: retry the same entry next tick with doubling backoff;
        // give the entry up after REPULL_MAX_HEAD_ATTEMPTS so one broken name can't stall the sweep.
        st.headAtt = (st.headAtt | 0) + 1; st.failStreak = (st.failStreak | 0) + 1;
        st.backoffUntil = now + Math.min(REPULL_BACKOFF_FIRST_MS * Math.pow(2, Math.max(0, st.failStreak - 1)), REPULL_BACKOFF_MAX_MS);
        if (st.headAtt >= REPULL_MAX_HEAD_ATTEMPTS) { st.cursor++; st.dropped++; st.headAtt = 0; }
        st.lastResult = "transient failure on " + region + ":" + name + " (att " + st.headAtt + ")";
      }
      break;                                              // at most ONE upstream fetch per tick, whatever the outcome
    }
    st.lastAt = Date.now();
    await env.CHARS.put(REPULL_STATE_KEY, JSON.stringify(st));
  } catch (e) {}
}

// Re-queue characters at the FRONT of the free queue (oldest ts=1, attempts reset) so a paused
// queue resumes by retrying exactly the lookups that failed, first. Dedupes by region:name.
async function requeueFront(env, items) {
  const seen = {};
  for (const it of (items || [])) {
    if (!it || !it.region || !it.name) continue;
    const k = QF + charKey(it.region, it.name);
    if (seen[k]) continue; seen[k] = 1;
    // Preserve the requester's stored token across the requeue (read the existing value) — otherwise
    // the item would come back tokenless and get dropped on the next drain as a 401.
    let tok = "";
    try { const v = await env.CHARS.get(k, "json"); tok = (v && v.t) || ""; } catch (e) {}
    try { await env.CHARS.put(k, JSON.stringify({ t: tok }), { metadata: { region: it.region, name: it.name, ts: 1 }, expirationTtl: QUEUE_TTL_S }); } catch (e) {}
  }
}

// PAUSE probe: try the OLDEST queued character once (or a canary if the queue is empty) to see if
// lostark.bible is back. UP = a 200 (cache it) or a 404 (it responded — just no such character);
// DOWN = a 502 (incl. the 401 IP block) / 5xx / network error.
const CANARY = { region: "NA", name: "Paroxysmal" };
// Admin drain config (mode + per-minute rate + probe backoff state). Defaults to running at the
// default rate when unset, so a fresh/empty KV simply drains normally.
async function getDrainConfig(env) {
  let c = null;
  try { c = await kvGetJson(env, DRAIN_CONFIG_KEY); } catch (e) {}
  c = c || {};
  const mode = DRAIN_MODES.indexOf(c.mode) !== -1 ? c.mode : "run";
  let rate = parseInt(c.drainPerMin, 10);
  if (!Number.isFinite(rate) || rate < 1) rate = DRAIN_PER_RUN;
  if (rate > 30) rate = 30;                       // (the time budget caps the effective rate ~16/run anyway)
  return { mode: mode, drainPerMin: rate, lastProbe: c.lastProbe || 0, interval: c.interval || PAUSE_PROBE_FIRST_MS };
}
function setDrainConfig(env, cfg) { return env.CHARS.put(DRAIN_CONFIG_KEY, JSON.stringify(cfg)).catch(function () {}); }
async function probeOldest(env) {
  // Probe the CANARY (Paroxysmal, NA) using the stored owner token. Paroxysmal is on that account's
  // roster, so a valid token can ALWAYS fetch its page — a reliable "is lostark.bible reachable with
  // our credentials again?" check, independent of what's queued (and of whatever roster scoping the
  // page fetch turns out to have). With no stored token yet, this fetch just 401/429s and we stay down.
  const md = CANARY;
  const svc = await getServiceToken(env);
  let res = null;
  try { res = await fetchCharacterData(env, md.region, md.name, svc); } catch (e) { res = null; }
  if (res && res.ok) {
    // Keep the canary's record fresh while we're here.
    try { await env.CHARS.put(charKey(md.region, md.name), JSON.stringify(Object.assign({}, res.data, { pulledAt: Date.now() }))); await markDirty(env, charKey(md.region, md.name)); } catch (e) {}
    return { up: true, cached: true, name: md.region + ":" + md.name };
  }
  if (res && res.status === 404) return { up: true, cached: false, name: md.region + ":" + md.name };
  return { up: false, result: "down", entry: { region: md.region, name: md.name, status: res ? res.status : 0, upstream: (res && res.body && res.body.upstreamStatus) || null, msg: (res && res.body && res.body.error) || "network/timeout", hasToken: !!svc } };
}

// Cron drain: cache up to DRAIN_PER_RUN queued characters per run, PREMIUM queue first then FREE,
// paced ~DRAIN_DELAY_MS apart so we never trip lostark.bible. region+name ride in the key metadata,
// so listing needs no per-key read. A transient upstream error (5xx / upstream 429) stops the run
// and leaves the item queued for next time; a 4xx (not found) drops it. Bumps LASTWRITE so the
// throttled snapshot rebuild picks the new characters up.
async function drainQueue(env) {
  if (!env || !env.CHARS) return;
  // Monthly budget guard: once MONTHLY_CHAR_BUDGET characters are cached this calendar month,
  // pause draining so KV writes can never approach the paid limit (no overage, ever).
  const month = new Date().toISOString().slice(0, 7);
  const usage = await kvGetJson(env, USAGE_KEY);
  let used = (usage && usage.month === month) ? (usage.count | 0) : 0;
  const t0 = Date.now();
  const run = { t: t0, cached: [], dropped: [], failed: [], stop: null }; // per-drain history entry

  // Admin drain MODE (set via ?control on the queue-admin page):
  //   "off"   -> frozen: do nothing, ZERO lostark.bible requests (manual resume).
  //   "probe" -> paused but probe the oldest queued char on a backoff; auto-resume (mode->run) on recovery.
  //   "run"   -> drain normally at cfg.drainPerMin (the active path below).
  const cfg = await getDrainConfig(env);
  if (cfg.mode === "off") return;
  if (cfg.mode === "probe") {
    if (Date.now() - (cfg.lastProbe || 0) < (cfg.interval || PAUSE_PROBE_FIRST_MS)) return; // not time to probe yet
    const probe = await probeOldest(env);
    run.ms = Date.now() - t0;
    if (probe.up) {
      await setDrainConfig(env, { mode: "run", drainPerMin: cfg.drainPerMin });   // RECOVERED -> resume draining
      run.stop = "resumed";
      if (probe.cached && probe.name) {
        run.cached.push(probe.name);
        try { await env.CHARS.put(LASTWRITE_KEY, String(Date.now())); } catch (e) {}
        try { const u = await kvGetJson(env, USAGE_KEY); const c = (u && u.month === month ? (u.count | 0) : 0) + 1; await env.CHARS.put(USAGE_KEY, JSON.stringify({ month: month, count: c }), { expirationTtl: 40 * 24 * 3600 }); } catch (e) {}
      }
    } else {
      await setDrainConfig(env, { mode: "probe", drainPerMin: cfg.drainPerMin, lastProbe: Date.now(), interval: Math.min((cfg.interval || PAUSE_PROBE_FIRST_MS) * 2, PAUSE_PROBE_MAX_MS) }); // still down -> back off ×2
      run.stop = "probe";
      if (probe.entry) run.failed.push(probe.entry);
    }
    await appendDrainLog(env, run);
    return;
  }

  if (used >= MONTHLY_CHAR_BUDGET) { run.stop = "budget"; run.ms = 0; await appendDrainLog(env, run); return; }
  // IDLE SHORT-CIRCUIT: a recently-confirmed-EMPTY q:order snapshot means nothing to drain — return
  // after ONE read instead of paying the lock write + 2 list()s + snapshot write every idle minute
  // (~130k writes+deletes and ~86k lists per month at rest). Trusted for Q_ORDER_IDLE_TTL_MS; a fresh
  // enqueue DELETES q:order (see enqueueChar) so a new character defeats this immediately.
  try {
    const snap0 = await kvGetJson(env, Q_ORDER_KEY);
    if (snap0 && Array.isArray(snap0.items) && !snap0.items.length && Date.now() - (snap0.ts || 0) < Q_ORDER_IDLE_TTL_MS) return;
  } catch (e) {}
  // serialize active drains (the cron + control-resumes) so two never overlap and double-fetch lostark.bible.
  try { if (await env.CHARS.get(DRAIN_LOCK_KEY)) return; } catch (e) {}
  // TTL 60, not 55: KV's MINIMUM expirationTtl is 60 — the old 55 made every lock put throw
  // straight into a silent catch, so the lock NEVER engaged and drains could overlap. And a
  // failed put must be SEEN, not swallowed: log it (the drain keeps going — availability over
  // mutual exclusion, same as before).
  try { await env.CHARS.put(DRAIN_LOCK_KEY, "1", { expirationTtl: 60 }); }
  catch (e) { console.log("[drain] lock write failed (drains may overlap): " + (e && e.message || e)); }
  const perRun = cfg.drainPerMin;                 // admin-set rate (chars per cron run = per minute)
  const delayMs = Math.round(60000 / perRun);     // pace ONE fetch per (60/rate)s — e.g. 15/min => one every 4s (one character at a time)
  let processed = 0, cached = 0, failed = 0, consecFail = 0, stop = false;
  // #1: list BOTH queues ONCE, up front, in drain order — then write the q:order snapshot at the end
  // so position / metrics / probe reads can skip listing entirely (they read q:order instead).
  const items = await listQueueOrder(env);     // [{k,r,n,t,a,p}] premium-first, oldest-ts first
  const removed = new Set();                    // queue keys cached or dropped this run (gone from the snapshot)
  for (const it of items) {
    if (processed >= perRun || Date.now() - t0 > DRAIN_BUDGET_MS) { run.stop = processed >= perRun ? "full" : "time"; stop = true; break; }
    if (!it.r || !it.n) { try { await env.CHARS.delete(it.k); } catch (e) {} removed.add(it.k); continue; } // malformed -> drop
    // Fetch with the token the requester stored when they enqueued (read from the item's value).
    let itemTok = "";
    try { const qv = await env.CHARS.get(it.k, "json"); itemTok = (qv && qv.t) || ""; } catch (e) {}
    let res = null;
    try { res = await fetchCharacterData(env, it.r, it.n, itemTok); } catch (e) { res = null; } // ONE fetch — no blind retry (gentler on lostark.bible; a real outage trips the breaker below)
    const upstream = (res && res.body && res.body.upstreamStatus) || null; // the real lostark.bible status behind our 502
    if (res && res.ok) {
      consecFail = 0;
      const record = Object.assign({}, res.data, { pulledAt: Date.now() });
      try { await env.CHARS.put(charKey(it.r, it.n), JSON.stringify(record)); await markDirty(env, charKey(it.r, it.n)); await env.CHARS.delete(it.k); cached++; removed.add(it.k); run.cached.push(it.r + ":" + it.n); } catch (e) {}
    } else if (res && res.status >= 400 && res.status < 500) {
      // ANY 4xx -> drop AND remember it (short TTL) so the page can't re-enqueue + re-fetch the same
      // dead name forever: 404 = no such character, 422 = the page has no Ark Grid astrogems to grade.
      // Store the reason so enqueueChar / the wait long-poll can tell the user WHY (instead of spinning).
      consecFail = 0;
      try { await env.CHARS.delete(it.k); } catch (e) {} removed.add(it.k);
      try { await env.CHARS.put(NOTFOUND_PREFIX + charKey(it.r, it.n), String((res.body && res.body.error) || ("HTTP " + res.status)).slice(0, 300), { expirationTtl: NOTFOUND_TTL_S }); } catch (e) {}
      run.dropped.push({ region: it.r, name: it.n, status: res.status, msg: (res.body && res.body.error) || "dropped" });
    } else if (upstream === 401 || upstream === 403) {
      // AUTH failure for THIS item only: the token the requester stored has expired or been revoked.
      // That's not a site-wide block — DROP this item and keep draining (do NOT trip the breaker).
      consecFail = 0;
      try { await env.CHARS.delete(it.k); } catch (e) {} removed.add(it.k);
      run.dropped.push({ region: it.r, name: it.n, status: res ? res.status : 0, upstream: upstream, msg: "auth — sign-in token expired/revoked" });
    } else if (upstream >= 400 && upstream < 500) {
      // a site BLOCK: a 4xx refusal that hits everyone (429 rate-limit, 418/451 anti-bot). It won't fix
      // itself on retry, so PAUSE to probe immediately instead of burning the fail streak. Re-queue at front.
      run.failed.push({ region: it.r, name: it.n, status: res ? res.status : 0, upstream: upstream, msg: (res.body && res.body.error) || "blocked", att: 1 });
      await requeueFront(env, run.failed);
      await setDrainConfig(env, { mode: "probe", drainPerMin: cfg.drainPerMin, lastProbe: Date.now(), interval: PAUSE_PROBE_FIRST_MS }); // breaker -> PROBE: auto-recovers when lostark.bible is back (admin can force Run/Off)
      run.stop = "blocked"; stop = true; break;
    } else {
      // transient 5xx / network / timeout: SKIP this character (leave it queued) so one bad or slow
      // character can't head-of-line-block the queue. Count attempts so a PERMANENTLY broken entry
      // (e.g. some KR names) is eventually DROPPED instead of retried forever at the head.
      failed++;
      const att = (it.a | 0) + 1;
      run.failed.push({ region: it.r, name: it.n, status: res ? res.status : 0, upstream: upstream, msg: (res && res.body && res.body.error) || "network/timeout", att: att });
      console.log("[drain-fail] " + it.r + ":" + it.n + " status=" + (res ? res.status : "throw") + " att=" + att);
      try {
        if (att >= MAX_FETCH_ATTEMPTS) { await env.CHARS.delete(it.k); removed.add(it.k); }                 // give up — drop it
        // Preserve ts (keep FIFO place) AND the requester's stored token (mirror requeueFront) —
        // rewriting the value to "" lost the token, so the retry fetched unauthenticated, 401'd,
        // and was dropped as "auth expired" even though the requester's token was fine.
        else await env.CHARS.put(it.k, JSON.stringify({ t: itemTok }), { metadata: { region: it.r, name: it.n, ts: it.t, attempts: att }, expirationTtl: QUEUE_TTL_S });
      } catch (e) {}
      if (++consecFail >= PAUSE_FAIL_LIMIT) {
        // circuit-breaker -> PROBE: re-queue this run's failures at the FRONT (attempts reset; the
        // upstream being down isn't the character's fault), then auto-recover via probes. Admin can force Run/Off.
        await requeueFront(env, run.failed);
        await setDrainConfig(env, { mode: "probe", drainPerMin: cfg.drainPerMin, lastProbe: Date.now(), interval: PAUSE_PROBE_FIRST_MS });
        run.stop = "paused"; stop = true; break;
      }
    }
    processed++;
    if (processed < perRun) await new Promise(function (r) { setTimeout(r, delayMs); });
  }
  // #1: refresh the q:order snapshot = items still queued after this run (drain order preserved), so
  // queueStatus / metrics / probe read it instead of listing. (Skipped while paused — early return above.)
  try { await env.CHARS.put(Q_ORDER_KEY, JSON.stringify({ ts: Date.now(), items: items.filter(function (it) { return !removed.has(it.k); }) })); } catch (e) {}
  run.ms = Date.now() - t0;
  // #4: skip logging a do-nothing run (idle / empty queue) — keep drain:log (and its KV write) for
  // runs that actually cached, failed, or dropped something. Liveness is still visible via backlog.
  if (run.cached.length || run.failed.length || run.dropped.length) await appendDrainLog(env, run);
  if (processed > 0 || failed > 0) console.log("[drain] processed=" + processed + " cached=" + cached + " failed=" + failed + (stop ? " (backed off)" : ""));
  if (cached > 0) {
    try { await env.CHARS.put(LASTWRITE_KEY, String(Date.now())); } catch (e) {}
    try { await env.CHARS.put(USAGE_KEY, JSON.stringify({ month: month, count: used + cached }), { expirationTtl: 40 * 24 * 3600 }); } catch (e) {}
  }
  try { await env.CHARS.delete(DRAIN_LOCK_KEY); } catch (e) {}  // release the serialize lock for the next drain/kick
}

// #1: the ordered queue (premium first, then free; each oldest-ts first) as [{k,r,n,t,a,p}].
// listQueueOrder lists both queues fresh; readQueueOrder prefers the cron-maintained q:order
// snapshot (one cheap read) and only re-lists when it's missing or stale — so callers stay
// correct while skipping the two KV list()s in the common (fresh-snapshot) case.
async function listQueueOrder(env) {
  let p = [], f = [];
  try { p = (await env.CHARS.list({ prefix: QP })).keys; } catch (e) {}
  try { f = (await env.CHARS.list({ prefix: QF })).keys; } catch (e) {}
  const map = function (keys, premium) {
    return keys.slice().sort(function (a, b) { return ((a.metadata && a.metadata.ts) || 0) - ((b.metadata && b.metadata.ts) || 0); })
      .map(function (k) { const m = k.metadata || {}; return { k: k.name, r: m.region || "", n: m.name || "", t: m.ts || 0, a: m.attempts || 0, p: premium }; });
  };
  return map(p, true).concat(map(f, false));
}
async function readQueueOrder(env) {
  try { const s = await kvGetJson(env, Q_ORDER_KEY); if (s && Array.isArray(s.items) && Date.now() - (s.ts || 0) < Q_ORDER_TTL_MS) return s.items; } catch (e) {}
  return listQueueOrder(env);
}

// Where a queued character sits in the drain order + the total queued + a rough ETA
// (~DRAIN_PER_RUN cached per minute). Reads the q:order snapshot (no list() when it's fresh). A
// just-enqueued key may not be in the snapshot yet -> reported at the tail, which the next poll corrects.
async function queueStatus(env, region, name, tier) {
  const fullKey = (tier === "premium" ? QP : QF) + charKey(region, name);
  const items = await readQueueOrder(env);                  // premium-first, then free
  const idx = items.findIndex(function (it) { return it.k === fullKey; });
  const position = (idx >= 0 ? idx : items.length) + 1;     // not-yet-listed -> tail (next poll corrects)
  const total = Math.max(items.length, position);
  const dpm = (await getDrainConfig(env)).drainPerMin;     // ETA uses the admin-set rate
  return { position: position, total: total, etaMinutes: Math.ceil(position / dpm), drainPerMin: dpm };
}

// A "queued" JSON response carrying the live queue status (position / total / ETA). Used both
// when a character is freshly queued AND when it's ALREADY queued (so a re-lookup never double-
// adds — it just reports where you are).
async function queuedResponse(env, region, name, tier, extra, wantPos) {
  // Position/total/ETA cost two KV list()s — compute them only when the client asks (&pos=1: the
  // initial lookup + manual refresh). The 8s auto-poll omits &pos, so it pays only the cheap get()s
  // and the client keeps showing the position from its first response.
  const st = wantPos ? await queueStatus(env, region, name, tier) : null;
  return json(Object.assign({ queued: true, tier: tier, region: region, name: normalizeName(name) }, st || {}, extra || {}), 200);
}

// Fast-path KICK: fetch + cache ONE specific just-queued character directly — NO list(), so it dodges
// KV list() eventual-consistency (the just-written queue key isn't visible to an immediate list, which
// made the old drainQueue-kick silently process a stale list and miss the new char). The cron drainQueue
// still does the full, paced, breaker-aware drain. Mirrors the drain's per-char ok/4xx branches; leaves
// block/transient queued for the cron (which owns the circuit-breaker).
async function kickFetch(env, region, name, userToken) {
  if (!env || !env.CHARS) return;
  try { const cfg = await getDrainConfig(env); if (cfg.mode !== "run") return; } catch (e) { return; } // off/probe -> don't touch lostark.bible
  const key = charKey(region, name);
  const t0 = Date.now();
  let res = null;
  try { res = await fetchCharacterData(env, region, name, userToken); } catch (e) { res = null; }
  if (res && res.ok) {
    try {
      await env.CHARS.put(key, JSON.stringify(Object.assign({}, res.data, { pulledAt: Date.now() })));
      await markDirty(env, key);
      await env.CHARS.delete(QF + key); await env.CHARS.delete(QP + key);
      await env.CHARS.put(LASTWRITE_KEY, String(Date.now()));
      const m = new Date().toISOString().slice(0, 7);
      const u = await kvGetJson(env, USAGE_KEY);
      await env.CHARS.put(USAGE_KEY, JSON.stringify({ month: m, count: (u && u.month === m ? (u.count | 0) : 0) + 1 }), { expirationTtl: 40 * 24 * 3600 });
      await appendDrainLog(env, { t: Date.now(), cached: [region + ":" + name], dropped: [], failed: [], stop: null, kick: true, ms: Date.now() - t0 }); // so the admin SEES it: a sub-2s kick drains before the live queue list() catches up
    } catch (e) {}
  } else if (res && res.status >= 400 && res.status < 500) {       // OUR 4xx = not-found(404)/no-Ark-Grid(422): drop + remember WHY
    try {
      await env.CHARS.delete(QF + key); await env.CHARS.delete(QP + key);
      await env.CHARS.put(NOTFOUND_PREFIX + key, String((res.body && res.body.error) || ("HTTP " + res.status)).slice(0, 300), { expirationTtl: NOTFOUND_TTL_S });
      await appendDrainLog(env, { t: Date.now(), cached: [], dropped: [{ region: region, name: name, status: res.status, msg: (res.body && res.body.error) || "dropped" }], failed: [], stop: null, kick: true, ms: Date.now() - t0 });
    } catch (e) {}
  }
  // block (our 502 / upstream 4xx) or transient (5xx/network/timeout): leave it queued for the cron drain.
}

// Add a not-yet-cached character to the premium/free queue, gated by a GLOBAL enqueue rate so the
// queue can't be filled faster than the drain empties it (keeps monthly writes bounded). region+name
// stored as KV metadata (the drain reads them from list() without an extra get).
async function enqueueChar(env, region, name, premium, wantPos, ctx, userToken) {
  if (env.CHARS) {                                   // one round-trip: drain mode + known-missing (recent 404)?
    const [cfg, miss] = await Promise.all([
      getDrainConfig(env),
      env.CHARS.get(NOTFOUND_PREFIX + charKey(region, name))
    ]);
    if (cfg.mode !== "run") return json({ unavailable: true, error: UNAVAILABLE_MSG }, 503);       // off/probe -> "lookups temporarily unavailable" notice
    if (miss) return json({ error: (typeof miss === "string" && miss.length > 3) ? miss : "We couldn't find that character on lostark.bible — double-check the name and region.", notFound: true }, 404); // #6: known-missing/unparseable -> don't re-queue, and say WHY
  }
  if (env.ENQUEUE_GATE) {
    const g = await env.ENQUEUE_GATE.limit({ key: "enqueue" });
    if (!g.success) return json({ error: "The lookup queue is busy right now — please try again in a moment.", queueBusy: true, rateLimited: true, retryAfterMs: 30000 }, 429);
  }
  if (env.CHARS) {
    const usage = await kvGetJson(env, USAGE_KEY); // monthly budget guard: stop accepting new characters once the cap is hit
    if (usage && usage.month === new Date().toISOString().slice(0, 7) && (usage.count | 0) >= MONTHLY_CHAR_BUDGET) {
      return json({ error: "We've reached this month's character-caching budget — new lookups resume next month. Cached characters and the leaderboard still work normally.", monthlyBudget: true }, 503);
    }
    // Store the requester's token in the queue item's VALUE (not metadata — metadata is read during
    // list()/snapshot ops and must stay token-free). The drain fetches this item with this token, and
    // deletes the item once cached, so the token is held only while the request is pending.
    try { await env.CHARS.put((premium ? QP : QF) + charKey(region, name), JSON.stringify({ t: userToken || "" }), { metadata: { region: region, name: name, ts: Date.now() }, expirationTtl: QUEUE_TTL_S }); } catch (e) {}
    try { await env.CHARS.delete(Q_ORDER_KEY); } catch (e) {} // invalidate the queue snapshot: defeats the cron's empty-queue short-circuit AND stops position reads trusting a stale (pre-this-enqueue) order
    if (ctx && ctx.waitUntil) ctx.waitUntil(kickFetch(env, region, name, userToken)); // KICK: fetch+cache THIS char now, directly (no list() -> immune to KV list lag). The cron drainQueue does the full paced drain.
    return queuedResponse(env, region, name, premium ? "premium" : "free", { justQueued: true }, wantPos);
  }
  return json({ queued: true, justQueued: true, tier: premium ? "premium" : "free", region: region, name: normalizeName(name) }, 200);
}

// POST /?submit=1 — accept a loadout the bookmarklet scraped from the user's OWN browser on a
// lostark.bible character page and write it straight to the cache (source:"import"), so it shows in
// the Grader (cached) and the Leaderboard with ZERO Worker->lostark.bible traffic. We re-parse the
// submitted arkGridCores blob with the SAME parser the drain uses and reject anything without real
// gems. Per-IP throttled (on top of HARD_CAP) + a per-IP DAILY cap. Writes are live — validated but
// not moderated. ACCEPTED residual risk: anyone can overwrite any cached character (up to
// IMPORT_DAILY_CAP a day per IP) with data of their choosing, INCLUDING bible-pulled records — we
// deliberately do NOT block those overwrites, because the bookmarklet is the legitimate refresh
// path for them while lookups are paused. The re-parse keeps fakes shaped like real gem data, and
// the board is crowd-visible, so garbage gets noticed and re-pulled over.
const IMPORT_CAP_PREFIX = "impc:";   // impc:<ip>:<YYYYMMDD> -> uploads accepted today (TTL 2d)
const IMPORT_DAILY_CAP = 40;         // per-IP uploads/day — plenty for a roster, useless for flooding
async function handleSubmit(env, request, ip, ctx) {
  if (!env || !env.CHARS) return json({ error: "Cache not configured." }, 503);
  // One upload per ~5s per IP (shares the lookup throttle namespace but a distinct key).
  if (env.LOOKUP_THROTTLE) {
    const t = await env.LOOKUP_THROTTLE.limit({ key: "submit:" + ip });
    if (!t.success) return json({ error: "One upload every few seconds — please wait a moment.", rateLimited: true, retryAfterMs: 5000, throttled: true }, 429);
  }
  // #5: per-IP daily cap. The 1/5s throttle alone still let one IP write ~17k fabricated
  // records a day. Read the counter here, bump it only after a successful store (a
  // read-then-increment race can overshoot by a request or two — fine, the cap is a budget,
  // not an exact quota).
  const impDay = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const impKey = IMPORT_CAP_PREFIX + ip + ":" + impDay;
  let impUsed = 0;
  try { impUsed = parseInt((await env.CHARS.get(impKey)) || "0", 10) || 0; } catch (e) {}
  if (impUsed >= IMPORT_DAILY_CAP) {
    return json({ error: "Daily upload limit reached (" + IMPORT_DAILY_CAP + "/day) — it resets at UTC midnight.", rateLimited: true, importCap: true }, 429);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON: { region, name, src }." }, 400); }
  let region = String((body && body.region) || "").trim();
  if (region.toUpperCase() === "CE") region = "EU"; // lostark.bible URLs say CE for EU Central; normalize so imports join the eu: cache/leaderboard instead of splitting (also heals old bookmarklets in the wild)
  const name = String((body && body.name) || "").trim();
  const src = String((body && body.src) || "");
  if (!region || !name) return json({ error: "region and name are required." }, 400);
  if (region.length > 8 || name.length > 40) return json({ error: "region or name too long." }, 400);
  if (src.length > 300000) return json({ error: "Upload too large." }, 413);
  if (src.indexOf("arkGridCores:[") === -1) {
    return json({ error: "No Ark Grid data in the upload — click the bookmarklet while on a lostark.bible character page." }, 422);
  }

  // Same non-KR parse path as fetchCharacterData: arkGridCores -> gems, plus item level + class.
  const presets = extractArkGridCores(src);
  if (!presets.raid) return json({ error: "Could not read Ark Grid gems from the upload (none set, or an unexpected page)." }, 422);
  const raidRes = coresToGems(presets.raid);
  const gems = raidRes.gems;
  if (!gems || !gems.length) return json({ error: "No astrogems found in the upload." }, 422);
  const chaosGems = presets.chaos ? coresToGems(presets.chaos).gems : null;
  const meta = parseMeta(src, false);

  const key = charKey(region, name);
  const record = {
    region: region,
    name: normalizeName(name),
    source: "import",
    itemLevel: meta.itemLevel,
    class: meta.klass,
    coreCount: presets.raid.length,
    gemCount: gems.length,
    gems: gems,
    chaosGems: chaosGems,
    warnings: raidRes.warnings,
    pulledAt: Date.now()
  };
  try {
    await env.CHARS.put(key, JSON.stringify(record));
    await markDirty(env, key);                                   // enter the leaderboard snapshot on the next rebuild
    // NOTE: do NOT bump LASTWRITE_KEY here. That stamp is the admin's "last real lostark.bible
    // pull" signal — an import is user-supplied, not a Worker fetch from lostark.bible, so counting
    // it there would make a fake/non-scraped character look like a successful drain.
    await env.CHARS.delete(NOTFOUND_PREFIX + key).catch(function () {}); // a previously-"not found" name is now known
    await env.CHARS.delete(QF + key).catch(function () {});             // clear any pending scrape for it
    await env.CHARS.delete(QP + key).catch(function () {});
  } catch (e) {
    return json({ error: "Failed to save the upload." }, 500);
  }
  // Count this accepted upload against the daily cap (only after the store landed).
  try { await env.CHARS.put(impKey, String(impUsed + 1), { expirationTtl: 2 * 24 * 3600 }); } catch (e) {}
  // Get the contributed character onto the leaderboard sooner than the cron's 30-min rebuild, but
  // don't re-gzip the whole snapshot on every import: coalesce to at most one rebuild per 10 min.
  // Fire-and-forget — adds no latency to the response. (Cron's 30-min pass is the backstop.)
  if (ctx && ctx.waitUntil) ctx.waitUntil(rebuildSnapshotIfChanged(env, 10 * 60 * 1000));
  return json(Object.assign({}, record, { cached: false, imported: true }), 200);
}

// GET /oauth/start?ret=<frontend url> — kick off Authorization Code + PKCE at lostark.bible.
async function oauthStart(env, u) {
  if (!env.BIBLE_CLIENT_ID || !env.OAUTH) {
    return json({ error: "Sign-in isn't configured on this Worker yet (missing BIBLE_CLIENT_ID or the OAUTH binding)." }, 503);
  }
  const ret = safeReturn(u.searchParams.get("ret"));
  const state = randomId(24);
  const verifier = randomId(48);
  let challenge;
  try { challenge = await pkceChallenge(verifier); } catch (e) { return json({ error: "Could not start sign-in." }, 500); }
  try {
    await env.OAUTH.put(OAUTH_ST + state, JSON.stringify({ v: verifier, ret: ret }), { expirationTtl: OAUTH_STATE_TTL_S });
  } catch (e) { return json({ error: "Could not start sign-in (storage)." }, 503); }

  const a = new URL(OAUTH_AUTHORIZE);
  a.searchParams.set("client_id", env.BIBLE_CLIENT_ID);
  a.searchParams.set("redirect_uri", OAUTH_REDIRECT);
  a.searchParams.set("response_type", "code");
  a.searchParams.set("scope", OAUTH_SCOPE);
  a.searchParams.set("state", state);
  a.searchParams.set("code_challenge", challenge);
  a.searchParams.set("code_challenge_method", "S256");
  return redirectTo(a.toString());
}

// GET /oauth/callback?code=&state= — exchange the code, mint a session, bounce back to the app.
// Every failure path still redirects home with #ags_error=... so the user never lands on raw JSON.
async function oauthCallback(env, u) {
  const state = u.searchParams.get("state") || "";
  const code = u.searchParams.get("code") || "";
  const oerr = u.searchParams.get("error") || "";

  let pend = null;
  if (state && env.OAUTH) { try { pend = await env.OAUTH.get(OAUTH_ST + state, "json"); } catch (e) { pend = null; } }
  const ret = safeReturn(pend && pend.ret);
  // State is single-use — burn it regardless of what happens next (replay protection).
  if (state && env.OAUTH) { try { await env.OAUTH.delete(OAUTH_ST + state); } catch (e) {} }

  if (oerr) return redirectTo(ret + "#ags_error=" + encodeURIComponent(oerr));
  if (!pend) return redirectTo(ret + "#ags_error=expired");          // unknown/replayed/timed-out state
  if (!code) return redirectTo(ret + "#ags_error=no_code");
  if (!env.BIBLE_CLIENT_ID || !env.BIBLE_CLIENT_SECRET) return redirectTo(ret + "#ags_error=not_configured");

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", OAUTH_REDIRECT);
  form.set("client_id", env.BIBLE_CLIENT_ID);
  form.set("code_verifier", pend.v);

  let tok = null, status = 0;
  try {
    const r = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Confidential client: Basic takes precedence over a body secret, so the secret never
        // rides in the form body.
        "Authorization": "Basic " + btoa(env.BIBLE_CLIENT_ID + ":" + env.BIBLE_CLIENT_SECRET),
        "Accept": "application/json"
      },
      body: form.toString()
    });
    status = r.status;
    tok = await r.json();
  } catch (e) { return redirectTo(ret + "#ags_error=token_exchange_failed"); }
  if (!tok || !tok.access_token) {
    return redirectTo(ret + "#ags_error=" + encodeURIComponent((tok && tok.error) || ("http_" + status)));
  }

  const sid = randomId(24);
  const ttl = Math.min(OAUTH_SESSION_TTL_S, Math.max(60, parseInt(tok.expires_in, 10) || OAUTH_SESSION_TTL_S));
  try {
    await env.OAUTH.put(OAUTH_SESS + sid, JSON.stringify({ t: tok.access_token, at: Date.now() }), { expirationTtl: ttl });
  } catch (e) { return redirectTo(ret + "#ags_error=session_store_failed"); }

  // The session id rides in the URL FRAGMENT: fragments aren't sent to servers, so it stays out
  // of access logs and Referer headers. The page reads it, stores it, and strips it from the URL.
  return redirectTo(ret + "#ags_session=" + encodeURIComponent(sid));
}

// GET /oauth/me?s=<session> — is this session still signed in?
async function oauthMe(env, u) {
  const t = await sessionToken(env, u);
  return json({ loggedIn: !!t, scope: OAUTH_SCOPE }, 200);
}

// GET|POST /oauth/logout?s=<session> — drop our session and best-effort revoke upstream.
async function oauthLogout(env, u) {
  const sid = u.searchParams.get("s") || "";
  if (!sid || !env.OAUTH) return json({ ok: true }, 200);
  let rec = null;
  try { rec = await env.OAUTH.get(OAUTH_SESS + sid, "json"); } catch (e) {}
  try { await env.OAUTH.delete(OAUTH_SESS + sid); } catch (e) {}
  if (rec && rec.t && env.BIBLE_CLIENT_ID && env.BIBLE_CLIENT_SECRET) {
    const form = new URLSearchParams();
    form.set("token", rec.t);
    try {
      await fetch(OAUTH_REVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(env.BIBLE_CLIENT_ID + ":" + env.BIBLE_CLIENT_SECRET)
        },
        body: form.toString()
      });
    } catch (e) {}   // RFC 7009 always 200s; a failure here just leaves the token to expire
  }
  return json({ ok: true }, 200);
}

export default {
  async fetch(request, env, ctx) {
    // The router below builds plain responses; CORS is stamped on HERE, once, from the caller's
    // Origin (allowlist echo + Vary — see corsHeaders). One place to reason about, no way for a
    // route to forget it.
    const resp = await handleFetch(request, env, ctx);
    const cors = corsHeaders(request.headers.get("Origin") || "");
    for (const h in cors) resp.headers.set(h, cors[h]);
    return resp;
  },

  async scheduled(controller, env, ctx) {
    // Every minute: drain a few queued characters (paced), then refresh the leaderboard snapshot
    // if it's due (rebuildSnapshotIfChanged self-throttles to ~every 30 min so reads stay low),
    // then advance the weekly repull sweep by at most one fetch — skipped entirely when the
    // drain/snapshot work already ate the minute (the 50s deadline mirrors DRAIN_BUDGET_MS).
    const t0 = Date.now();
    await drainQueue(env);
    await rebuildSnapshotIfChanged(env);
    if (Date.now() - t0 < 45000) await runRepullTick(env, t0 + 50000);
  }
};

async function handleFetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const u = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

    // Hard backstop on EVERY request (per IP) to stop scripted abuse before any work — an edge
    // rate-limit binding, no KV touched on a blocked hit.
    if (env.HARD_CAP) {
      const h = await env.HARD_CAP.limit({ key: ip });
      if (!h.success) return json({ error: "Too many requests — please slow down.", rateLimited: true, retryAfterMs: 60000, hardCap: true }, 429);
    }

    // Public POST /?submit=1 — the bookmarklet uploads a loadout the USER scraped in their own
    // browser on a lostark.bible character page (no Worker->lostark.bible request at all). This is
    // the crowdsourced, scrape-free path into the cache + leaderboard.
    if (request.method === "POST" && u.searchParams.get("submit") === "1") {
      return handleSubmit(env, request, ip, ctx);
    }
    // lostark.bible sign-in (Authorization Code + PKCE). Before the GET-only guard so logout can
    // be POSTed. /start and /callback are browser navigations; /me and /logout are page fetches.
    if (u.pathname === "/oauth/start")    return oauthStart(env, u);
    if (u.pathname === "/oauth/callback") return oauthCallback(env, u);
    if (u.pathname === "/oauth/me")       return oauthMe(env, u);
    if (u.pathname === "/oauth/logout")   return oauthLogout(env, u);
    if (u.pathname === "/oauth/probe-token") {
      // ADMIN + roster check. The roster check alone was claimable: any lostark.bible user who
      // made a same-name character on another NA server could pass it, seize the canary
      // credential, and brick auto-resume. Now only the admin can arm the probe.
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      return storeProbeToken(env, request);
    }

    // Feedback POST: the public submit, or (with &read=/&del= + the admin header) an admin
    // mutation. Mutations are POST so a drive-by GET (<img src=…>) can never delete a note.
    if (u.searchParams.get("feedback") === "1" && request.method === "POST") {
      if (u.searchParams.get("del") || u.searchParams.get("read")) {
        if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
        return handleFeedbackAdminMutate(env, u);
      }
      return handleFeedbackSubmit(env, request, ip);
    }

    // Admin MUTATIONS — POST-only + X-Admin-Token. GETs with side effects were a drive-by risk
    // (any <img> tag could freeze lookups or purge the queue while CORS was "*").
    // POST /?control=1&mode=&rate= — set the drain mode (run/off/probe) and/or rate (1-30).
    if (u.searchParams.get("control") === "1" && request.method === "POST") {
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      const cur = await getDrainConfig(env);
      const next = { mode: cur.mode, drainPerMin: cur.drainPerMin };
      const mode = u.searchParams.get("mode");
      let modeChanged = false;
      if (mode && DRAIN_MODES.indexOf(mode) !== -1) {
        next.mode = mode; modeChanged = true;
        if (mode === "probe") { next.lastProbe = 0; next.interval = PAUSE_PROBE_FIRST_MS; } // probe immediately, then back off
      }
      const rate = parseInt(u.searchParams.get("rate"), 10);
      if (Number.isFinite(rate) && rate >= 1 && rate <= 30) next.drainPerMin = rate;
      await setDrainConfig(env, next);
      // Resume/probe RIGHT NOW instead of waiting for the next cron tick — e.g. "Run" -> immediate drain.
      if (modeChanged && next.mode !== "off" && ctx && ctx.waitUntil) { try { ctx.waitUntil(drainQueue(env)); } catch (e) {} }
      return json({ ok: true, config: next }, 200);
    }
    // POST /?dequeue=1&match=<key substring>|&all=1 — evict stuck/orphaned queue items and
    // invalidate the order snapshot so the next drain re-lists. Matches on a KEY SUBSTRING —
    // encoding-proof, since some old items have a mojibake name whose key can't be rebuilt from
    // a clean one. (GET ?dequeue=1&list=1 lists without touching anything.)
    if (u.searchParams.get("dequeue") === "1" && request.method === "POST") {
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      const all = u.searchParams.get("all") === "1";
      const match = (u.searchParams.get("match") || "").toLowerCase();
      if (!all && !match) return json({ error: "pass match=<key substring> or all=1 (list via GET ?dequeue=1&list=1)" }, 400);
      const removed = [];
      for (const pfx of [QF, QP]) {
        let cursor;
        do {
          const res = await env.CHARS.list({ prefix: pfx, cursor: cursor });
          for (const k of res.keys) {
            if (all || (match && k.name.toLowerCase().indexOf(match) !== -1)) {
              try { await env.CHARS.delete(k.name); removed.push(k.name); } catch (e) {}
            }
          }
          cursor = res.list_complete ? null : res.cursor;
        } while (cursor);
      }
      try { await env.CHARS.delete(Q_ORDER_KEY); } catch (e) {}
      return json({ ok: true, removed: removed, count: removed.length });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed (use GET ?region=&name=, or POST ?submit=1)." }, 405);
    }

    // GLOBAL overload gate: one shared counter across ALL requests (fixed key, not the IP). When the
    // site-wide rate trips ~1000/min we enter "degraded" mode and pause NEW work for everyone equally
    // (no bypass). period max 60s, so it's a rolling per-minute proxy that auto-recovers.
    let degraded = false;
    if (env.GLOBAL_GATE) {
      const g = await env.GLOBAL_GATE.limit({ key: "global" });
      degraded = !g.success;
    }
    const busyMsg = "The site is very busy right now — please try again shortly.";

    // Public status (no token): is the lookup queue PAUSED (lostark.bible unreachable)? Drives the
    // grader's "lookups temporarily unavailable" notice.
    if (u.searchParams.get("status") === "1") {
      const cfg = env.CHARS ? await getDrainConfig(env) : { mode: "run" };
      // SHORT browser cache: keeps the banner fresh (~30s, in line with the queue re-sync cadence) for
      // active users, while deduping rapid focus re-checks. paused = the drain isn't in "run" mode.
      // The message tracks the mode — it used to say "unavailable" even while running.
      return json({ ok: true, paused: cfg.mode !== "run", mode: cfg.mode, message: cfg.mode !== "run" ? UNAVAILABLE_MSG : "Character lookups are running." }, 200, { "Cache-Control": "public, max-age=30" });
    }

    // Admin queue LIST (GET + X-Admin-Token): see the raw queue keys. Lists at the EDGE
    // (wrangler's KV CLI can't list this namespace). The old GET mutations (&all/&match) moved
    // to POST — tell the caller so instead of quietly 403ing.
    if (u.searchParams.get("dequeue") === "1") {
      if (u.searchParams.get("all") === "1" || u.searchParams.get("match")) {
        return json({ error: "Dequeue mutations moved: POST /?dequeue=1&match=|&all=1 with the X-Admin-Token header (?k= no longer grants admin)." }, 405);
      }
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      if (u.searchParams.get("list") !== "1") return json({ error: "pass list=1 (mutations are POST match=/all=1)" }, 400);
      const seen = [];
      for (const pfx of [QF, QP]) {
        let cursor;
        do {
          const res = await env.CHARS.list({ prefix: pfx, cursor: cursor });
          for (const k of res.keys) {
            const md = k.metadata || {};
            seen.push({ key: k.name, region: md.region, name: md.name, ts: md.ts });
          }
          cursor = res.list_complete ? null : res.cursor;
        } while (cursor);
      }
      return json({ ok: true, queue: seen, count: seen.length });
    }

    // Admin feedback review LIST (GET + X-Admin-Token). Mutations (read/del) moved to POST.
    if (u.searchParams.get("feedback") === "1") {
      if (u.searchParams.get("del") || u.searchParams.get("read")) {
        return json({ error: "Feedback read/delete moved: POST /?feedback=1&read=|&del= with the X-Admin-Token header (?k= no longer grants admin)." }, 405);
      }
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      return handleFeedbackAdmin(env, u);
    }

    // Drain control is a mutation: POST-only now (see the POST router above).
    if (u.searchParams.get("control") === "1") {
      return json({ error: "Control moved: POST /?control=1&mode=&rate= with the X-Admin-Token header (?k= no longer grants admin)." }, 405);
    }

    // Leaderboard — open to everyone, throttled vs spam-refresh; paused for all while degraded.
    if (u.searchParams.get("list") === "1") {
      if (degraded) return json({ error: busyMsg, rateLimited: true, degraded: true }, 429);
      if (env.LB_THROTTLE) {
        const l = await env.LB_THROTTLE.limit({ key: ip });
        if (!l.success) return json({ error: "The leaderboard refreshes about every 10 minutes — please wait a moment.", rateLimited: true, retryAfterMs: 20000, lbThrottle: true }, 429);
      }
      return handleList(env, request.headers.get("Accept-Encoding"), u.searchParams.get("fmt"));
    }

    // Admin QUEUE METRICS (GET + X-Admin-Token): backlog counts, the queued list in drain order
    // (PREMIUM first, then FREE), drain config + monthly usage. Light — two queue list()s + a few
    // small get()s, NO big snapshot read — so the private dashboard can poll it often.
    if (u.searchParams.get("metrics") === "1") {
      if (!adminOk(request, env)) return json({ error: "Forbidden — admin token required (X-Admin-Token header)." }, 403);
      // Lists the LIVE queue fresh (listQueueOrder — it does NOT read the q:order snapshot:
      // one admin viewer, and fresh beats cached so new enqueues show immediately) + the small
      // state keys, all independent -> one parallel round-trip.
      const [items, usage0, lw, dlog, cfg, repullSt] = await Promise.all([
        listQueueOrder(env).catch(function () { return []; }), // admin: always the LIVE queue (1 owner; fresh > cached so new enqueues show immediately)
        kvGetJson(env, USAGE_KEY).catch(function () { return null; }),
        env.CHARS.get(LASTWRITE_KEY).catch(function () { return null; }),
        kvGetJson(env, DRAIN_LOG_KEY).catch(function () { return null; }),
        getDrainConfig(env).catch(function () { return { mode: "run", drainPerMin: DRAIN_PER_RUN }; }),
        kvGetJson(env, REPULL_STATE_KEY).catch(function () { return null; })
      ]);
      const usage = usage0 || {}, lastWrite = parseInt(lw, 10) || 0;
      const drainLog = Array.isArray(dlog) ? dlog : [];
      const now = Date.now();
      const premiumCount = items.filter(function (it) { return it.p; }).length;
      const freeCount = items.length - premiumCount;
      const list = items.slice(0, 500).map(function (it) { return { region: it.r, name: it.n, tier: it.p ? "premium" : "free", waitedS: it.t > 1e12 ? Math.round((now - it.t) / 1000) : null }; }); // ts<=1e12 = a front-sentinel (e.g. requeued ts=1), not a real wait
      return json({
        ok: true, nowMs: Date.now(),
        drain: { perRun: cfg.drainPerMin, delayMs: Math.round(60000 / cfg.drainPerMin), perMin: cfg.drainPerMin },
        mode: cfg.mode,
        queue: { premium: premiumCount, free: freeCount, total: items.length, list: list },
        usage: { month: usage.month || "", count: (usage.count | 0), budget: MONTHLY_CHAR_BUDGET },
        lastWriteMs: lastWrite,
        drainLog: drainLog,
        hasProbeToken: !!(await getServiceToken(env)),   // is the drain/probe armed with an owner token?
        repull: repullSt || null,                        // the weekly top-rank sweep's live state (null until the first plan build)
        paused: cfg.mode !== "run"
      }, 200);
    }

    const region = (u.searchParams.get("region") || "").trim();
    const name = (u.searchParams.get("name") || "").trim();
    const refresh = u.searchParams.get("refresh") === "1";

    if (!region && !name) {
      return json({ ok: true, service: "astrogem-bible", usage: "GET /?region=NA&name=CharacterName (add &refresh=1 to bypass cache, ?list=1 to list all)" });
    }
    if (!region || !name) {
      return json({ error: "Both ?region= and ?name= are required (e.g. ?region=NA&name=Paroxysmal)." }, 400);
    }
    const key = charKey(region, name);

    // Long-poll "wait" endpoint: hold the connection (~25s) and return the MOMENT the drain re-caches
    // this character newer than &since — a real "refresh done" signal, no client polling. Returns
    // {done:false} on timeout so the client simply reconnects. Drives the grader's refresh banner.
    if (u.searchParams.get("wait") === "1" && env.CHARS) {
      const sinceMs = parseInt(u.searchParams.get("since"), 10) || 0;
      const doneJson = function (rec) { return json(Object.assign({}, rec, { cached: true, done: true }), 200); };
      const notFoundJson = function (miss) { return json({ done: false, notFound: true, error: (miss.length > 3 ? miss : "We couldn't find that character on lostark.bible.") }, 200); };
      const isDone = function (rec) { return rec && Array.isArray(rec.gems) && (rec.pulledAt || 0) > sinceMs; };
      // #7 read-amp guard: this used to hold + poll (~34 KV reads) for ANY name, queued or not —
      // an unauthenticated read amplifier. Pre-check ONCE (one parallel round) that the lookup is
      // actually pending — cached record, nf: marker, or queue membership — before paying the loop.
      const [rec0, miss0, qp0, qf0] = await Promise.all([
        kvGetJson(env, key),
        env.CHARS.get(NOTFOUND_PREFIX + key),
        env.CHARS.get(QP + key),
        env.CHARS.get(QF + key)
      ]);
      if (isDone(rec0)) return doneJson(rec0);
      if (miss0) return notFoundJson(miss0);
      if (qp0 === null && qf0 === null) {
        // Not queued, nothing cached-newer. One short grace re-check first: a just-kicked fetch
        // deletes its queue key a beat before the fresh record is readable here. The ~2s pause
        // also paces the client's reconnect loop (it retries instantly on {done:false}) to a
        // rate the HARD_CAP never has to see.
        await new Promise(function (r) { setTimeout(r, 2000); });
        const [rec1, qp1, qf1] = await Promise.all([kvGetJson(env, key), env.CHARS.get(QP + key), env.CHARS.get(QF + key)]);
        if (isDone(rec1)) return doneJson(rec1);
        if (qp1 === null && qf1 === null) return json({ done: false }, 200);   // truly not pending -> answer now, don't hold 25s
      }
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        await new Promise(function (r) { setTimeout(r, 1500); });   // the pre-check above covered t=0
        const rec = await kvGetJson(env, key);
        if (isDone(rec)) return doneJson(rec);
        const miss = await env.CHARS.get(NOTFOUND_PREFIX + key);   // dropped (404/422...) while waiting -> stop + report why
        if (miss) return notFoundJson(miss);
      }
      return json({ done: false }, 200);
    }

    const wantQueue = u.searchParams.get("queue") === "1";
    const wantPos = u.searchParams.get("pos") === "1"; // position/ETA cost 2 KV lists; the lookup + periodic re-syncs set &pos=1, the local countdown between them is free.

    // CACHED (any age): return the stored gems immediately (free — just a KV read). For &queue
    // clients it's ALSO queue-aware so the page can show the cached grades AND a live refresh
    // banner: if the character is already queued, OR its data is stale (>7d) and we now auto-enqueue
    // a refresh, the response carries {queued, tier, stale, position?}. refresh=1 bypasses all this.
    if (!refresh && env.CHARS) {
      const cached = await kvGetJson(env, key);
      if (cached && Array.isArray(cached.gems) && typeof cached.pulledAt === "number") {
        const fresh = (Date.now() - cached.pulledAt) < CACHE_TTL_MS;
        if (!wantQueue) {
          if (fresh) return json(Object.assign({}, cached, { cached: true }), 200); // legacy client: fresh only
        } else {
          const [inQP, inQF] = await Promise.all([env.CHARS.get(QP + key), env.CHARS.get(QF + key)]); // one round-trip, not two
          const tier = (inQP !== null) ? "premium" : (inQF !== null ? "free" : null);
          // #8: do NOT auto-enqueue a refresh for stale (>7d) data — just flag it `stale` and let the
          // user hit Re-pull (refresh=1) on demand. Gem grids rarely change, so constantly re-fetching
          // every old character in the background isn't worth the lostark.bible load.
          const out = Object.assign({}, cached, { cached: true, stale: !fresh });
          if (tier) { out.queued = true; out.tier = tier; if (wantPos) Object.assign(out, await queueStatus(env, region, name, tier)); }
          return json(out, 200);
        }
      }
    }

    // MISS (uncached). New clients (&queue=1) get QUEUED (cached later by the drain); old clients
    // keep the legacy synchronous fetch so nothing breaks mid-migration.

    // The requesting user's OWN lostark.bible token, from their login session — sent as an
    // Authorization: Bearer header (loseii) or resolved from a ?s= Worker session. A new pull is
    // fetched on behalf of THIS user, using THIS token; there is no shared fallback for user pulls
    // (the Paroxysmal service token is only for the recovery probe). Empty = not signed in.
    const _authz = request.headers.get("Authorization") || "";
    const _headerTok = _authz.indexOf("Bearer ") === 0 ? _authz.slice(7).trim() : "";
    const userTok = (await sessionToken(env, u)) || _headerTok;

    // Already in the queue? Don't re-add — confirm it's still queued (cheap get) and, only when the
    // client asked (&pos=1), its live position/total/ETA. This is also the poll path the client hits
    // while it waits for the drain, kept list()-free so a waiting tab is nearly free to serve.
    if (wantQueue && env.CHARS) {
      const qp = (await env.CHARS.get(QP + key)) !== null;
      const qf = !qp && (await env.CHARS.get(QF + key)) !== null;
      if (qp || qf) {
        // Already queued (possibly by someone else). Don't kick with the poller's token — the drain
        // fetches this item with the token stored when it was enqueued. Just report queue status.
        if (qp) return queuedResponse(env, region, name, "premium", { alreadyQueued: true }, wantPos); // legacy premium entries still drain first; nothing new is added here
        return queuedResponse(env, region, name, "free", { alreadyQueued: true }, wantPos);
      }
    }

    // Rate-limit the fetch/enqueue: one new-character lookup per ~5s per IP, the same for everyone.
    // Cached lookups already returned above with no limit; the ENQUEUE_GATE + monthly budget guard
    // bound total fill site-wide. During overload (degraded) new work pauses for everyone equally.
    if (degraded) return json({ error: busyMsg, rateLimited: true, degraded: true }, 429);
    if (env.LOOKUP_THROTTLE) {
      const t = await env.LOOKUP_THROTTLE.limit({ key: ip });
      if (!t.success) return json({ error: "One new-character lookup every 5 seconds — please wait a moment (cached characters are unlimited).", rateLimited: true, retryAfterMs: 5000, throttled: true }, 429);
    }
    // A NEW pull scrapes lostark.bible on the caller's behalf, so it needs THEIR token. Signed-out
    // visitors can read cache + the leaderboard (handled above) but can't pull — send them to sign in.
    if (!userTok) return json({ needSignIn: true, error: "Sign in with lostark.bible to look up a character." }, 401);
    if (wantQueue) return enqueueChar(env, region, name, false, wantPos, ctx, userTok);
    return handleCharacter(env, region, name, refresh, { nextMs: 5000 }, userTok);
}
