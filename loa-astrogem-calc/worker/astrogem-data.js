/**
 * worker/astrogem-data.js — the Advisor's parse-collection endpoint.
 *
 * A record ships only when the user presses Get advice MANUALLY (auto-advice runs
 * after every parse but does not store — 2026-07-17): the image, the parser's
 * reading (with per-field confidences), and the state the user actually ran —
 * their corrections are ground-truth labels, though fallible ones: cross-check
 * against the stored image before promoting (a live correction once contradicted
 * its own screenshot's points checksum). tools/pull-collected.js downloads new
 * records for labeling review.
 *
 * Storage: ONE KV value per record, image embedded as a webp data-URL (KV values
 * cap at 25MB; a bounded webp capture is ~150-700KB). R2 was abandoned for KV
 * (dashboard-enable friction, code 10042); revisit only if volume demands it.
 *
 * Auth. READING (/list, /obj) requires the ADMIN_TOKEN Worker secret as an
 * `X-Admin-Token` header (adminOk below: fail-closed, constant-time). It used to
 * check ?k=<gate hash> and call that "genuinely password-gated" — it wasn't: the
 * hash ships to every browser in gate.js, so anyone could enumerate and download
 * every collected screenshot. /collect takes NO token at all now (clients still
 * send the old ?k=; it's ignored): collection must never be blocked by the lock
 * (Shizu 2026-07-18: "only the AI-powered parsing should be password locked"),
 * and the real quota protection is DAILY_WRITE_CAP below — KV free tier allows
 * 1k writes/day and a record is one write.
 *   POST /collect      body: JSON { image, parse, final, changed, meta } -> { ok, id }
 *   GET  /list?cursor= -> { keys: [...], cursor }        (admin)
 *   GET  /obj?key=     -> the stored record JSON          (admin)
 *   POST /admin/accuracy?n=150 -> per-field reader misread rates over the newest
 *                         n (<=300) records                (admin; see handleAccuracy)
 * Records (col/…) expire after 30 days (RECORD_TTL_S).
 *   GET  /health       -> ok (open)
 *
 * Deploy:  npx wrangler deploy -c wrangler-data.toml
 * Secret:  wrangler secret put ADMIN_TOKEN -c wrangler-data.toml
 */
"use strict";

// The allowlist lives in cors.js, shared with the bible and verify workers.
import { corsHeaders } from "./cors.js";
// MEASURED 2026-07-19: bodies ≥6MB kill the free-tier isolate mid-read — Cloudflare
// then serves an HTML 500 WITHOUT CORS headers, which browsers mask as a bare
// "network error" (exactly how a night of Shizu's records died: a pre-crop client
// shipping 5-9MB full frames). ≤5MB parses fine. Gate BELOW the kill line so
// oversize is a visible CORS'd 413 the client can react to, never a silent death.
const MAX_BODY = 5 * 1024 * 1024;
const DAILY_WRITE_CAP = 300;   // records/day — far above real use, far below the 1k KV free tier
const RECORD_TTL_S = 30 * 24 * 3600;   // col/ records expire after 30 days (pull-collected.js fetches them within days)
const ACCURACY_DEFAULT_N = 150;        // /admin/accuracy sample size: default ...
const ACCURACY_MAX_N = 300;            // ... and cap (one KV read per record, bodies up to 5MB each)

// The fields the Advisor diffs (advisor.js diffParseVsFinal) — the same `changed[].field`
// names tools/triage-collected.js tallies.
const ACC_CONFIG_FIELDS = ["baseCost", "gemType", "willpowerLevel", "orderLevel", "effect1", "effect1Level", "effect2", "effect2Level"];
const ACC_STATE_FIELDS = ["currentTurn", "maxTurns", "rerollsRemaining", "processCostMultiplier"];
const ACC_FIELDS = ACC_CONFIG_FIELDS.map(function (k) { return "config." + k; })
  .concat(ACC_STATE_FIELDS.map(function (k) { return "state." + k; }))
  .concat(["outcomes.0", "outcomes.1", "outcomes.2", "outcomes.3"]);
// Mirror of advisor.js diffParseVsFinal, for records stored without a `changed` list.
function diffParseVsFinal(parsed, fin) {
  const changed = [];
  const pc = (parsed && parsed.config) || {}, fc = fin.config || {};
  ACC_CONFIG_FIELDS.forEach(function (k) { if (String(pc[k]) !== String(fc[k])) changed.push({ field: "config." + k }); });
  const ps = (parsed && parsed.state) || {};
  ACC_STATE_FIELDS.forEach(function (k) { if (String(ps[k]) !== String(fin[k])) changed.push({ field: "state." + k }); });
  const po = (parsed && parsed.outcomes) || [], fo = fin.outcomes || [];
  for (let i = 0; i < 4; i++) {
    if (JSON.stringify(po[i] || null) !== JSON.stringify(fo[i] || null)) changed.push({ field: "outcomes." + i });
  }
  return changed;
}
// Mirror of tools/triage-collected.js classify(): only clean / fix / turnfix records describe
// the SAME board the parser read. A "progression" record's final state is a LATER board (the
// user played on), so its differences are not misreads and it is left out of the rates.
function classifyRecord(rec) {
  const par = rec.parse || {}, fin = rec.final || {};
  const ps = par.state || {};
  const changed = rec.changed || [];
  if (!fin.config || !fin.outcomes) return "malformed";
  if (changed.length === 0) return "clean";
  if ((fin.history || []).length > 0) return "progression";
  if (ps.currentTurn != null && fin.currentTurn != null && fin.currentTurn !== ps.currentTurn) {
    const goldMoved = (fin.totalGoldSpent || 0) !== (ps.totalGoldSpent || 0);
    const outcomesChanged = changed.filter(function (c) { return /^outcomes\./.test(c.field); }).length;
    if (goldMoved || outcomesChanged >= 3) return "progression";
    return "turnfix";
  }
  if ((fin.totalGoldSpent || 0) !== (ps.totalGoldSpent || 0)) return "progression";
  return "fix";
}
async function sha1Hex(s) {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).slice(0, 8).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
// POST /admin/accuracy?n=150 — per-field misread rates over the newest N col/ records.
// Memory stays bounded: keys are listed (small), then records are read and scored ONE AT A
// TIME and dropped — only counters and image hashes survive the loop.
// Dedupe: the Advisor may ship several records for one screenshot (a re-click after a
// correction ships again), so only the NEWEST record per image counts — that is the user's
// final word on that screen.
async function handleAccuracy(req, env, u) {
  let n = parseInt(u.searchParams.get("n") || "", 10);
  if (!Number.isFinite(n) || n < 1) n = ACCURACY_DEFAULT_N;
  n = Math.min(n, ACCURACY_MAX_N);
  // col/<YYYY-MM-DD>/<ms base36>-<rand>: list order is chronological, so the newest N are the
  // tail of a full listing (names only; 1000 per page).
  let tail = [], cursor, pages = 0;
  do {
    const res = await env.COLLECT.list({ prefix: "col/", cursor: cursor, limit: 1000 });
    for (const k of res.keys) tail.push(k.name);
    if (tail.length > n) tail = tail.slice(-n);
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor && ++pages < 100);
  tail.reverse();                                  // newest first, so dedupe keeps the newest
  const miss = {}; ACC_FIELDS.forEach(function (f) { miss[f] = 0; });
  const classes = { clean: 0, fix: 0, turnfix: 0, progression: 0, malformed: 0, unreadable: 0 };
  const seen = new Set();
  let samples = 0, dupes = 0, from = null, to = null;
  for (const key of tail) {
    let rec = null;
    try { rec = await env.COLLECT.get(key, "json"); } catch (e) { rec = null; }
    if (!rec || typeof rec !== "object") { classes.unreadable++; continue; }
    if (typeof rec.image === "string" && rec.image.length) {
      const h = await sha1Hex(rec.image);
      rec.image = null;
      if (seen.has(h)) { dupes++; continue; }
      seen.add(h);
    }
    if (!Array.isArray(rec.changed) && rec.final && rec.final.config) rec.changed = diffParseVsFinal(rec.parse, rec.final);
    const cls = classifyRecord(rec);
    classes[cls]++;
    if (rec.ts) { if (!to || rec.ts > to) to = rec.ts; if (!from || rec.ts < from) from = rec.ts; }
    if (cls !== "clean" && cls !== "fix" && cls !== "turnfix") continue;
    samples++;
    const hit = {};
    (rec.changed || []).forEach(function (c) { if (c && miss[c.field] != null && !hit[c.field]) { hit[c.field] = 1; miss[c.field]++; } });
  }
  return json({
    ok: true,
    requested: n, read: tail.length, samples: samples, duplicates: dupes, classes: classes,
    from: from, to: to,
    fields: ACC_FIELDS.map(function (f) {
      return { field: f, samples: samples, misreads: miss[f], rate: samples ? miss[f] / samples : null };
    })
  }, 200, req);
}

// An unknown Origin gets no Access-Control-Allow-Origin (it used to get www.loseii.com's).
function cors(req) {
  return corsHeaders(req, { headers: "Content-Type, X-Admin-Token" });
}
// Admin auth for the read routes: the ADMIN_TOKEN Worker secret as an X-Admin-Token header.
// Fail-closed (secret unset -> nobody is admin), constant-time compare, header-only (a token
// in a URL lands in logs and Referer headers). Same helper style as astrogem-bible.js.
function adminOk(req, env) {
  const secret = (env && env.ADMIN_TOKEN) || "";
  if (!secret) return false;                              // fail closed: no secret, no admin
  const given = req.headers.get("X-Admin-Token") || "";
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
function json(obj, status, req) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors(req))
  });
}

// Every FAILED /collect attempt is journaled to KV (err:<day>/<ts>, 7-day TTL,
// ≤40 writes/day) with status + size + UA + origin. Debugging doctrine: a
// browser masks the interesting failures (CORS-hidden rejects, stale clients'
// oversize sends) — the journal sees every attempt that REACHED Cloudflare, so
// "no col/ record AND no err/ entry" proves the request never left the user's
// machine (extension/DNS block), while an err/ entry names the reject reason.
async function logErr(env, req, status, detail) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ecKey = "ec:" + day;
    const ec = parseInt((await env.COLLECT.get(ecKey)) || "0", 10);
    if (ec >= 40) return;
    await env.COLLECT.put("err:" + day + "/" + Date.now().toString(36), JSON.stringify({
      status: status, detail: String(detail).slice(0, 120),
      ua: (req.headers.get("User-Agent") || "").slice(0, 90),
      origin: req.headers.get("Origin") || "", len: req.headers.get("Content-Length") || ""
    }), { expirationTtl: 7 * 24 * 3600 });
    await env.COLLECT.put(ecKey, String(ec + 1), { expirationTtl: 2 * 24 * 3600 });
  } catch (e) {}
}

// The whole handler runs behind this catch: an uncaught throw would otherwise
// surface as a Cloudflare error page with NO CORS headers, which the browser
// reports as a plain "network error" — indistinguishable from being offline.
// (A hard resource kill still can't be caught; MAX_BODY is what prevents those.)
export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) {
      await logErr(env, req, 500, "uncaught: " + String(e && e.message || e));
      return json({ error: "worker error: " + String(e && e.message || e).slice(0, 140) }, 500, req);
    }
  }
};

async function handle(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (u.pathname === "/health") return json({ ok: true }, 200, req);

    if (req.method === "POST" && u.pathname === "/collect") {
      // gate on the header FIRST (browsers always send it for string bodies),
      // then re-check the actual text — both run BEFORE the expensive parse
      const len = parseInt(req.headers.get("Content-Length") || "0", 10);
      if (len > MAX_BODY) { await logErr(env, req, 413, "content-length " + len); return json({ error: "too large (" + Math.round(len / 1e5) / 10 + "MB > 5MB)" }, 413, req); }
      let raw;
      try { raw = await req.text(); } catch (e) { await logErr(env, req, 400, "body read failed"); return json({ error: "body read failed" }, 400, req); }
      if (raw.length > MAX_BODY) { await logErr(env, req, 413, "raw length " + raw.length); return json({ error: "too large" }, 413, req); }
      let body;
      try { body = JSON.parse(raw); } catch (e) { await logErr(env, req, 400, "bad json"); return json({ error: "bad json" }, 400, req); }
      if (!body || typeof body !== "object") { await logErr(env, req, 400, "bad body"); return json({ error: "bad body" }, 400, req); }
      // a record without a real capture or a final state is useless for training —
      // reject it loudly so the client can tell the user (a silent 1×1-pixel test
      // record once sat in the store masquerading as data)
      if (typeof body.image !== "string" || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]{1000,}/.test(body.image)) {
        await logErr(env, req, 400, "image missing/stub");
        return json({ error: "image required (real capture, not a stub)" }, 400, req);
      }
      if (!body.final || typeof body.final !== "object" || !body.final.config) {
        await logErr(env, req, 400, "final state missing");
        return json({ error: "final state required" }, 400, req);
      }

      const now = new Date();
      const day = now.toISOString().slice(0, 10);

      // daily write cap — the collect token is public-in-source, so this counter
      // is what actually protects the KV write quota
      const dcKey = "dc:" + day;
      const dcCount = parseInt((await env.COLLECT.get(dcKey)) || "0", 10);
      if (dcCount >= DAILY_WRITE_CAP) {
        await logErr(env, req, 429, "daily cap");
        return json({ error: "daily collection cap reached (" + DAILY_WRITE_CAP + "/day) — resets at UTC midnight" }, 429, req);
      }

      const id = now.getTime().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const key = "col/" + day + "/" + id;
      const record = {
        id: id,
        ts: now.toISOString(),
        image: typeof body.image === "string" ? body.image : null,
        parse: body.parse || null,       // engine output incl. confidence map
        final: body.final || null,       // state at Get advice (user-corrected)
        changed: body.changed || null,   // precomputed diff (client convenience)
        meta: body.meta || null          // engine name, app version, source
      };
      // RECORD FIRST, counter after (a live record once vanished while the
      // counter incremented — the old order consumed cap on a failed write and
      // let the client believe the save landed); a caught failure reports 500
      // so the client's NOT-saved note is truthful and the record re-stages
      // 30-day expiry: records are up to 5MB and up to 300/day, and tools/pull-collected.js
      // copies them to disk within days — without a TTL the namespace only ever grew.
      try {
        await env.COLLECT.put(key, JSON.stringify(record), { expirationTtl: RECORD_TTL_S });
      } catch (e) {
        await logErr(env, req, 500, "storage write: " + String(e && e.message || e));
        return json({ error: "storage write failed: " + String(e && e.message || e).slice(0, 120) }, 500, req);
      }
      await env.COLLECT.put(dcKey, String(dcCount + 1), { expirationTtl: 2 * 24 * 3600 }).catch(function () {});
      return json({ ok: true, id: id }, 200, req);
    }

    // Read routes are ADMIN-ONLY: the records hold user screenshots.
    if (req.method === "GET" && u.pathname === "/list") {
      if (!adminOk(req, env)) return json({ error: "locked" }, 403, req);
      const cursor = u.searchParams.get("cursor") || undefined;
      const res = await env.COLLECT.list({ prefix: "col/", cursor: cursor, limit: 500 });
      return json({
        keys: res.keys.map(k => ({ key: k.name })),
        cursor: res.list_complete ? null : res.cursor
      }, 200, req);
    }

    if (req.method === "GET" && u.pathname === "/obj") {
      if (!adminOk(req, env)) return json({ error: "locked" }, 403, req);
      const key = u.searchParams.get("key") || "";
      if (!/^col\//.test(key)) return json({ error: "bad key" }, 400, req);
      const val = await env.COLLECT.get(key);
      if (val == null) return json({ error: "not found" }, 404, req);
      const h = cors(req);
      h["Content-Type"] = "application/json";
      return new Response(val, { status: 200, headers: h });
    }

    // Reader-accuracy panel (queue-admin.html). Admin, POST-only like the bible worker's admin
    // calls: a GET can never trigger ~300 KV reads from a drive-by <img> tag.
    if (u.pathname === "/admin/accuracy") {
      if (req.method !== "POST") return json({ error: "POST only (with the X-Admin-Token header)" }, 405, req);
      if (!adminOk(req, env)) return json({ error: "locked" }, 403, req);
      return handleAccuracy(req, env, u);
    }

    return json({ error: "no route" }, 404, req);
}
