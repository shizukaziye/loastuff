// loa-tierlist-stats — CORS proxy + 24h KV cache for lostark.bible raid statistics.
//
// lostark.bible (LOA Logs data) exposes its charts through SvelteKit "remote function"
// endpoints:  /_app/remote/<hash>/combatPowerDPSSearch?payload=<base64url devalue>
// The <hash> is a build artifact that rotates on every site deploy and only exists as a
// literal inside the stats route's JS chunk, so this worker discovers it on demand
// (seeded with the last known value) and re-discovers whenever upstream starts 404ing.
//
// Endpoints:
//   GET /stats?boss=<name>&difficulty=<name>&patch=<api>&type=rdps
//     -> { rows: [{cls, spec, avg, count}], fetchedAt, patch, cached, stale? }
//   GET /  -> service info
//
// Caching: KV, 24 hours. Stale entries are kept and served (stale: true) if upstream fails.
// Every response — including every error — carries CORS headers; a throw that escapes
// without them shows up in the browser as a bare "network error" and is undebuggable.

const UPSTREAM = 'https://lostark.bible';
const SEED_HASH = '1ranzqj'; // last known remote hash (2026-07-20); auto-rediscovered on 404
const TTL_MS = 24 * 60 * 60 * 1000;
const TYPES = ['rdps', 'ndps', 'dps', 'udps'];
const UA = { 'User-Agent': 'loa-tierlist/1.0 (github.com/shizukaziye/loa-tierlist)' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });

const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function encodePayload(boss, difficulty, type, patch) {
  // devalue wire format: object values are indices into the top-level array
  const payload = [
    ['__skrao', 1],
    { boss: 2, difficulty: 3, dpsType: 4, patch: 5 },
    boss, difficulty, type, patch,
  ];
  return b64url(JSON.stringify(payload));
}

function decodeRows(outerText) {
  const outer = JSON.parse(outerText);
  if (outer.type !== 'result' || typeof outer.data !== 'string') {
    throw new Error('unexpected upstream shape: ' + outerText.slice(0, 120));
  }
  const arr = JSON.parse(outer.data);
  if (!Array.isArray(arr) || !Array.isArray(arr[1])) return [];
  return arr[1].map(ri => {
    const o = arr[ri];
    return { cls: arr[o.class], spec: arr[o.spec], avg: arr[o.avg], count: arr[o.count] };
  });
}

async function fetchUpstream(hash, boss, difficulty, type, patch) {
  const url = `${UPSTREAM}/_app/remote/${hash}/combatPowerDPSSearch?payload=${encodePayload(boss, difficulty, type, patch)}`;
  return fetch(url, { headers: UA });
}

// Discover the current remote hash: stats page HTML -> app entry JS -> node chunks,
// scanning for the literal next to the remote function name. The node index is cached
// so the next rotation checks the right chunk first.
async function discoverHash(env) {
  const html = await (await fetch(`${UPSTREAM}/stats/raids`, { headers: UA })).text();
  const appRef = (html.match(/_app\/immutable\/entry\/app\.[A-Za-z0-9_-]+\.js/) || [])[0];
  if (!appRef) throw new Error('discovery: app entry not found in HTML');
  const appJs = await (await fetch(`${UPSTREAM}/${appRef}`, { headers: UA })).text();
  const nodeRefs = [...new Set(appJs.match(/nodes\/\d+\.[A-Za-z0-9_-]+\.js/g) || [])];
  if (!nodeRefs.length) throw new Error('discovery: no node chunks in app entry');

  const prev = await env.STATS_KV.get('h:v1', 'json');
  const prevNum = prev && prev.num;
  const num = ref => parseInt(ref.match(/nodes\/(\d+)\./)[1], 10);
  nodeRefs.sort((a, b) => {
    const da = prevNum == null ? 0 : Math.abs(num(a) - prevNum);
    const db = prevNum == null ? 0 : Math.abs(num(b) - prevNum);
    return da - db || num(a) - num(b);
  });

  // Subrequest budget: HTML + app + up to 40 nodes stays under the 50/request cap.
  for (const ref of nodeRefs.slice(0, 40)) {
    let txt = '';
    try { txt = await (await fetch(`${UPSTREAM}/_app/immutable/${ref}`, { headers: UA })).text(); }
    catch { continue; }
    const m = txt.match(/([a-z0-9]{4,16})\/combatPowerDPSSearch/);
    if (m) {
      const found = { hash: m[1], num: num(ref), t: Date.now() };
      await env.STATS_KV.put('h:v1', JSON.stringify(found));
      return found.hash;
    }
  }
  throw new Error('discovery: hash not found in first 40 node chunks');
}

async function getHash(env) {
  const cached = await env.STATS_KV.get('h:v1', 'json');
  return (cached && cached.hash) || SEED_HASH;
}

async function handleStats(url, env) {
  const boss = (url.searchParams.get('boss') || '').trim();
  const difficulty = (url.searchParams.get('difficulty') || '').trim();
  const patch = (url.searchParams.get('patch') || '').trim();
  const type = (url.searchParams.get('type') || 'rdps').trim();
  if (!boss || !difficulty || !patch) return json({ error: 'boss, difficulty, patch are required' }, 400);
  if (boss.length > 80 || difficulty.length > 40 || patch.length > 20) return json({ error: 'parameter too long' }, 400);
  if (!TYPES.includes(type)) return json({ error: 'type must be one of ' + TYPES.join(', ') }, 400);

  const key = `s:v1:${boss}|${difficulty}|${patch}|${type}`;
  const cached = await env.STATS_KV.get(key, 'json');
  if (cached && Date.now() - cached.t < TTL_MS) {
    return json({ rows: cached.rows, fetchedAt: cached.t, patch, cached: true });
  }

  let upstreamErr = null;
  try {
    let res = await fetchUpstream(await getHash(env), boss, difficulty, type, patch);
    if (res.status === 404) {
      // hash rotated with a site deploy — rediscover and retry once
      const fresh = await discoverHash(env);
      res = await fetchUpstream(fresh, boss, difficulty, type, patch);
    }
    if (!res.ok) throw new Error('upstream HTTP ' + res.status);
    const rows = decodeRows(await res.text());
    const entry = { t: Date.now(), rows };
    await env.STATS_KV.put(key, JSON.stringify(entry));
    return json({ rows, fetchedAt: entry.t, patch, cached: false });
  } catch (e) {
    upstreamErr = String(e && e.message || e);
  }

  if (cached) {
    return json({ rows: cached.rows, fetchedAt: cached.t, patch, cached: true, stale: true, error: upstreamErr });
  }
  return json({ error: 'upstream fetch failed: ' + upstreamErr }, 502);
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
      const url = new URL(request.url);
      if (url.pathname === '/stats') return await handleStats(url, env);
      return json({
        ok: true,
        service: 'loa-tierlist-stats',
        usage: '/stats?boss=Corvus%20Tul%20Rak&difficulty=Nightmare&patch=jun26&type=rdps',
        cacheTtlHours: 24,
        source: 'lostark.bible (LOA Logs)',
      });
    } catch (e) {
      // nothing may escape without CORS headers
      return json({ error: 'worker error: ' + String(e && e.message || e) }, 500);
    }
  },
};
