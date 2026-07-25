# Astrogem Bible Worker (Grader "pull from lostark.bible")

A Cloudflare Worker that powers the **Grader** tab's *"Pull from lostark.bible"*
mode and the **Leaderboard**. It fetches a character page **server-side with a
browser User-Agent** (the sites return `403` to default fetchers but `200` for a
browser UA) — from [lostark.bible](https://lostark.bible) for NA/EU regions, or
from [lopec.kr](https://lopec.kr) for KR — extracts the embedded gem data
(`arkGridCores` hydration on lostark.bible; the spec-point payload on lopec.kr),
and returns every equipped astrogem as JSON:

```json
{
  "region": "NA",
  "name": "Paroxysmal",
  "gems": [
    {
      "slot": "Order Sun", "baseCost": 8, "gemType": "order",
      "willpowerLevel": 5, "orderLevel": 5,
      "effect1": "Additional Damage", "effect1Level": 5,
      "effect2": "Attack Power", "effect2Level": 5
    }
    // ... one per equipped gem (4 per core, up to 6 cores)
  ],
  "warnings": []
}
```

No Anthropic / external paid API — but it is **not** a plain stateless fetcher
anymore, and it **does** carry secrets. It has:

- a **KV namespace binding `CHARS`** — every fetched character is cached ~7 days,
  a gzipped snapshot feeds the Leaderboard, and the lookup **queue**
  (premium/free lanes), feedback notes, and drain state live here too;
- a **KV namespace binding `OAUTH`** — sign-in sessions + the drain's stored
  probe token;
- **four secrets** (`wrangler secret put <NAME> --config wrangler.bible.toml`):
  `BIBLE_TOKEN` (the Bearer token for lostark.bible page fetches),
  `BIBLE_CLIENT_ID` / `BIBLE_CLIENT_SECRET` (the OAuth app behind `/oauth/*`),
  and `ADMIN_TOKEN` (the admin credential — see **Admin auth** below);
- a **cron trigger** (`* * * * *`) that drains the queue every minute (with a
  monthly-budget guard, a fail-streak circuit breaker, and run/off/probe modes)
  and rebuilds the leaderboard snapshot at most every ~30 min;
- **five rate-limit bindings** (`HARD_CAP`, `LOOKUP_THROTTLE`, `LB_THROTTLE`,
  `GLOBAL_GATE`, `ENQUEUE_GATE`) on the public endpoints.

The full plumbing — queue lanes, drain modes, kick fetch, breaker, every KV key
and constant — is documented in
[`../docs/how-the-queue-and-drain-work.md`](../docs/how-the-queue-and-drain-work.md).

- Files: [`astrogem-bible.js`](./astrogem-bible.js),
  [`wrangler.bible.toml`](./wrangler.bible.toml) (the KV + ratelimit + cron
  config lives here).
- This is **separate** from the Workers-AI vision Worker
  (`astrogem-vision.js` / `wrangler.toml`); they deploy independently.

## Deploy

```bash
cd worker
npx wrangler deploy --config wrangler.bible.toml
```

Wrangler prints a URL like `https://astrogem-bible.<your-subdomain>.workers.dev`.

## Enable it in the app (the one manual step)

Open [`../grader.js`](../grader.js) and set the `WORKER_URL` constant near the top
to that URL:

```js
var WORKER_URL = "https://astrogem-bible.<your-subdomain>.workers.dev";
```

Reload the Grader tab. The *"Pull from lostark.bible"* mode becomes usable (it is
shown but the button is disabled while `WORKER_URL` is empty). **Custom input** mode
works with no setup at all.

## API

Public endpoints:

| Method | Path | Query / body | Response |
|--------|------|--------------|----------|
| `GET`  | `/`  | `?region=NA&name=Paroxysmal` | `{ region, name, gems:[...], warnings:[...] }` (KV-cached ~7 days; add `&refresh=1` to bypass the cache, `&queue=1` to enqueue on a miss, `&pos=1` for queue position). A cache miss without a sign-in token returns `401 { needSignIn }`. |
| `GET`  | `/`  | `?region=&name=&wait=1&since=<ms>` | Long-poll: `{ done:true, …gems }` once cached newer than `since`, `{ done:false, notFound, error }` if dropped, else `{ done:false }`. Answers at once when the character isn't pending at all. |
| `GET`  | `/`  | `?list=1` (`&fmt=2` compact) | `{ characters:[...] }` — the leaderboard snapshot (gzip) |
| `GET`  | `/`  | `?status=1` | `{ paused, mode, message }` drain status |
| `POST` | `/`  | `?submit=1` + JSON `{ region, name, src }` | Bookmarklet import → cache + leaderboard. Throttled ~1/5s and capped 40/day per IP. |
| `POST` | `/`  | `?feedback=1` + JSON `{ type, message, contact, hp }` | Store a feedback note (throttled; ~90-day TTL) |
| `GET`  | `/oauth/start`, `/oauth/callback` | — | lostark.bible sign-in (PKCE); browser navigations |
| `GET/POST` | `/oauth/me`, `/oauth/logout` | `?s=<session>` | session check / sign-out |
| `GET`  | `/`  | (none) | `{ ok, service, usage }` (health check) |
| `OPTIONS` | `/` | — | CORS preflight (204) |

Admin endpoints — every one requires the `ADMIN_TOKEN` secret as an
**`X-Admin-Token` request header** (never a URL param); mutations are **POST**:

| Method | Path | Query | Does |
|--------|------|-------|------|
| `GET`  | `/` | `?metrics=1` | dashboard payload (`queue-admin.html` polls this) |
| `GET`  | `/` | `?feedback=1` | list the newest ≤200 notes (`{ items, count, total, unread }`) |
| `GET`  | `/` | `?dequeue=1&list=1` | list the raw queue keys |
| `POST` | `/` | `?control=1&mode=&rate=` | set drain mode (`run`/`off`/`probe`) and/or rate (1–30) |
| `POST` | `/` | `?dequeue=1&match=`/`&all=1` | evict queue items |
| `POST` | `/` | `?feedback=1&read=`/`&del=` | mark a note read / delete it |
| `POST` | `/oauth/probe-token` | (Bearer token in `Authorization`) | arm the drain/probe credential (admin + roster check) |

Error responses: `{ error, ... }` with `400` (missing params), `401` (sign-in
needed), `403` (admin token missing/wrong), `404` (character not found), `405`
(an old GET admin call — the error names the POST + header replacement), `422`
(no Ark Grid data on the page), `429` (throttled), or `502` (upstream fetch
error). The endpoint / KV-key / constant reference lives in the queue doc (§9–§11).

## How the gem data is decoded

The page embeds an `arkGridCores` array (one entry per core; each core has 4 gems).
Each gem looks like:

```
{ id:67401026, idx:0, costReduc:5, corePoints:5, opts:[{id:2002,level:5},{id:2001,level:5}] }
```

- `costReduc` → **willpower level**, `corePoints` → **order level**, `opts` → the two
  side effects `{id, level}`.
- **Effect id → name** (verified against the page's rendered per-stat *"Lv. NN"*
  totals — the sum of each stat's levels across all gems matched exactly):

  | id | effect | id | effect |
  |----|--------|----|--------|
  | 2001 | Attack Power | 2011 | Ally Damage Enh. |
  | 2002 | Additional Damage | 2012 | Brand Power |
  | 2003 | Boss Damage | 2013 | Ally Attack Enh. |

- **Cost + type from the gem `id`** (format `674 [type] 1 [shape] 2 [variant]`):
  - `gemType = id[3]`: `0` = order, `1` = chaos (agrees with the core's `base`:
    `10001–10003` Order Sun/Moon/Star, `10004–10006` Chaos Sun/Moon/Star).
  - `baseCost = 8 + (id[5] % 3)`: order shapes `0/1/2` and chaos shapes `3/4/5` both
    map `→ 8/9/10`. Cross-checked on all 24 Paroxysmal gems: every gem's two `opts`
    fall inside exactly the cost's effect pool (0 mismatches).

## CORS / security

CORS is an **exact-match Origin allowlist** (`ALLOW_ORIGINS` in the source): the
site origins plus `lostark.bible` / `www.lostark.bible` — the bookmarklet POSTs
`?submit=1` from those pages, and its preflight needs the echoed Origin. Requests
with no Origin (curl, the cron) run without CORS headers; CORS only binds browsers.

Admin auth is the `ADMIN_TOKEN` Worker secret, sent as an `X-Admin-Token` header.
It replaced the old `?k=<gate hash>` check, which shipped to every browser in
`gate.js` and so gated nothing. Fail-closed: with the secret unset, no request is
admin. Treat it as a real credential — send it only as a header, never in a URL.
