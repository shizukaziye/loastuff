# How the lookup queue, drain & rate control work

This is the **operations / infrastructure** doc for the Grader's "pull a character from
lostark.bible" feature. (The other docs in this folder cover the *math*; this one covers the
*plumbing* — the queue, the drain, the circuit breaker, the admin page, and every rate-limit layer.)

Everything here lives in the **`astrogem-bible`** Cloudflare Worker (`worker/astrogem-bible.js`,
deployed with `wrangler deploy -c wrangler.bible.toml`), the **admin page**
(`queue-admin.html`), and the **grader client** (`grader.js`).

---

## 1. Why any of this exists

lostark.bible is the source of a character's equipped astrogems, but we can't hit it freely:

- It **rate-limits and IP-blocks** aggressive callers (rotating 401/403/418/429/451 codes).
- It has **no CORS**, so the browser can't fetch it directly — a server (the Worker) must.
- We're on **Cloudflare's free tier**: ~1M KV writes/month. Each cached character is ~2 writes,
  so unbounded fetching would blow the quota.

So the design is **cache-once, serve-many, fetch-politely**:

1. A character is fetched from lostark.bible **at most once per 7 days** and stored in KV.
2. Everyone else reads the **cache** (a free KV read) — no upstream hit.
3. New characters go into a **queue** that a **drain** empties at a deliberately gentle,
   admin-controlled pace, with a **circuit breaker** that backs off the instant lostark.bible
   pushes back.
4. Several **edge rate-limit layers** stop abuse before any KV work happens.

---

## 2. The big picture

```
 Browser (grader.js)                   astrogem-bible Worker                      lostark.bible
 ───────────────────                   ─────────────────────                      ─────────────
  Grade a character
   │  GET ?region=&name=&queue=1&pos=1
   ▼
                              cached & fresh? ──yes──► return gems (free KV read)
                                   │ no (MISS)
                                   ▼
                              enqueueChar: put q:f key      ──► KICK: kickFetch() ──► GET page
                                   │  return {queued}                  │ (direct, no list)  │
   ◄───────────────────────────────                                   ▼                    ▼
  show "in queue" + start watch                                  cache the gems  ◄── parse arkGridCores
   │  GET ?wait=1 (long-poll, 25s)                                     │
   ▼                                                                   │
                              hold until cached ───────────────────────┘
   ◄── {done:true, gems}
  render loadout  (≈2s end-to-end)

  Every minute (cron):  drainQueue()  → drains the backlog, paced   → rebuildSnapshotIfChanged()
  Admin (queue-admin):  ?metrics / ?control                         (leaderboard snapshot)
```

There is a second, unrelated Worker (`astrogem-data`, `wrangler-data.toml`) that stores the
Advisor's parse-collection records in KV — it has nothing to do with the queue and isn't covered
here. (A third, the old `astrogem-vision` OCR worker, was removed 2026-07-18.)

---

## 3. The lookup queue

### Two lanes — one vestigial

Queued characters are just KV keys; the region+name ride in the key's **metadata** (so listing the
queue needs no extra reads). The **value** holds the requester's sign-in token (`{ t }`), which the
drain uses to fetch on their behalf:

| Prefix | Lane | Who lands here |
|---|---|---|
| `q:p:` | **Premium** (drained first) | **nobody, anymore** — `enqueueChar` only ever writes the free lane. The lane is vestigial: any legacy `q:p:` keys still drain first, and nothing new joins them. |
| `q:f:` | **Free** | everyone |

Each queue key expires after `QUEUE_TTL_S` (**7 days**) if never drained.

### How a character enters the queue

A lookup is `GET ?region=NA&name=Foo&queue=1&pos=1`:

- **Cached** (any age) → return the stored gems immediately (a free KV read). If it's **stale**
  (>7 days) the response just carries `stale:true` — we do **not** auto-refresh stale data (gem
  grids rarely change; re-fetching every old character isn't worth the upstream load). The user can
  press **Re-pull** (`&refresh=1`) on demand.
- **Already queued** → don't re-add; confirm it's still queued and (with `&pos=1`) return its live
  position/ETA. This path does **not** re-kick: the drain fetches the item with the token stored at
  enqueue time, not the poller's.
- **Miss, signed in** → `enqueueChar()`: write the queue key (with the requester's token in the
  value), fire the **kick**, return `{queued:true}`.
- **Miss, signed out** → `401 { needSignIn }`. A fresh pull scrapes lostark.bible on the caller's
  behalf, so it needs the caller's own token. Signed-out visitors still get cached characters and
  the leaderboard.

`enqueueChar` refuses up front if: the drain mode isn't `run` (→ "temporarily unavailable"), the
character is in the **not-found** set (§3 below), the global **enqueue gate** is tripped, or the
**monthly budget** is spent.

### Ordering, position & ETA — the `q:order` snapshot

`listQueueOrder()` lists both lanes and sorts **premium-first, then oldest-first**. Listing is two
KV `list()`s, so the cron writes the result to a single `q:order` snapshot key. Position lookups,
metrics, and probes read that snapshot (one cheap read), only re-listing if it's older than
`Q_ORDER_TTL_MS` (**90s**). ETA is reported as roughly `position / rate` minutes.

> ⚠️ **KV `list()` is eventually consistent.** A *just-written* queue key may not appear in an
> immediate `list()` for a few seconds. This bit us hard (see §5) and is why position can briefly
> report a new character "at the tail" until the next poll corrects it.

### Not-found markers (`nf:`) — the anti-loop guard

When a fetch is dropped with a **4xx** (a `404` = no such character, or a **`422`** = the page loads
but has **no Ark Grid astrogems** to grade), the Worker writes a short-lived `nf:<key>` marker
holding the **reason string**, TTL `NOTFOUND_TTL_S` (**1 hour**).

This fixes a real **infinite-requeue loop**: before, a 422 character was dropped by the drain but
*not* remembered, so the page re-enqueued it forever and the user sat on "in the queue" permanently.
Now `enqueueChar` and the `?wait` long-poll both check `nf:` and return `{notFound, error:<reason>}`,
and the grader ends the watch with the real message instead of spinning. (Self-corrects after an
hour in case the 404 was transient.)

---

## 4. The drain

### The cron

`crons = ["* * * * *"]` — the `scheduled()` handler runs **every minute** and does two things:

```js
await drainQueue(env);              // cache a few queued characters (paced, breaker-aware)
await rebuildSnapshotIfChanged(env); // refresh the leaderboard snapshot (self-throttled ~30 min)
```

### Drain modes (`drain:config`)

All drain state is one KV key, `drain:config` = `{ mode, drainPerMin, lastProbe?, interval? }`, read
via `getDrainConfig()` (default `{ run, 10 }`) and set only via the owner `?control` endpoint:

| Mode | Behavior | Upstream traffic |
|---|---|---|
| **`run`** | Drain at `drainPerMin` characters/minute (the normal path). | Yes, paced |
| **`off`** | Frozen. Does nothing. Manual resume only. | **Zero** |
| **`probe`** | Paused, but periodically probes the **canary** (NA/Paroxysmal) with the stored service token; **auto-resumes** (→`run`) the moment a probe succeeds. | One probe per backoff tick |

While not in `run`, new lookups get a "Character lookups are temporarily unavailable" notice
(`?status=1` reports `paused:true`).

### The rate & pacing — "one character at a time"

`drainPerMin` is the rate (default **10**, clamped **1–30**). The delay *between* fetches is derived
from it:

```js
delayMs = Math.round(60000 / drainPerMin)   // 15/min ⇒ one fetch every 4s; 10/min ⇒ every 6s
```

So the drain processes **one character at a time, evenly spaced**, rather than in a burst. A run is
also time-capped at `DRAIN_BUDGET_MS` (**50s**) so it can never overrun the 60s cron (and the
effective rate tops out ~16/run regardless of a high setting).

### The kick — why a fresh grade is now ~2s, not ~60s

Waiting for the next cron tick made a fresh grade feel slow (up to 60s). So an enqueue **kicks** the
fetch immediately via `ctx.waitUntil(...)`.

> **The bug, and the lesson.** The kick originally called `drainQueue`, which `list()`s the queue to
> find work. But the character you *just* enqueued wasn't visible to that immediate `list()` yet
> (eventual consistency, §3), so the kick drained a stale/empty list, **missed the new character**,
> and fell back to the cron. The "kick" existed but did nothing for the one character that mattered.

The fix is **`kickFetch(env, region, name, userToken)`**: it fetches and caches **that specific
character directly — no `list()`** — so it's immune to list lag. It's mode-gated (`run` only),
mirrors the drain's `ok → cache` / `4xx → drop + remember` branches, and leaves block/transient
errors queued for the cron (which owns the breaker). It fires **only from `enqueueChar`**, with
the enqueuer's own token. The already-queued lookup path does **not** re-kick — a poller's token
must not be spent on someone else's request; a character a kick missed waits for the cron drain.

**Measured end-to-end:** a freshly-cleared character caches in **1.7–2.0s**, and the grader's
`?wait` long-poll returns `{done}` in ~1.8s → loadout viewable in **~2s**.

Because a sub-2s drain clears the character from the live queue *before* `list()` consistency catches
up, `kickFetch` also writes a `drain:log` entry tagged `kick:true` — so the admin's drain history
reliably shows it (labeled **`kick`**) even when the live queue list never got the chance to.

### The drain lock

`drain:lock` (a KV key, **60s** TTL, auto-expiring for crash safety) serializes the **cron and
`?control`-resume** `drainQueue` runs so two never overlap and double-fetch. (`kickFetch` is a single
direct fetch and doesn't take the lock.)

> History: the TTL used to be 55s — **below KV's 60s minimum** — so every lock write threw into a
> silent catch and the lock never engaged. It is 60s now, and a failed lock write is logged instead
> of swallowed (the drain still proceeds: availability over mutual exclusion).

### Per-character outcomes (inside a drain run)

| Result | Action |
|---|---|
| **OK** | Cache the gems (`pulledAt = now`), mark dirty for the leaderboard, delete the queue key. |
| **4xx** (our 404/422) | Drop + write the `nf:` marker with the reason. |
| **Upstream 4xx** (a block: 401/403/418/429/451 behind our 502) | **Trip the breaker** → `probe`, re-queue this run's items at the front. |
| **5xx / network / timeout** | Skip (leave queued), increment its attempt count; after `MAX_FETCH_ATTEMPTS` (**5**) drop it so one broken name can't block the head of the queue. |

### Write budget

`MONTHLY_CHAR_BUDGET` = **300,000** characters/month (~2 writes each ≈ 66% of the 1M/mo free write
budget — no overage, ever). `usage:drained` = `{month, count}` tracks it; the drain and `enqueueChar`
both stop accepting new work once it's hit (cached reads and the leaderboard keep working).

---

## 5. The circuit breaker

The drain protects both us and lostark.bible from a bad situation:

- **A block** (any 4xx *from lostark.bible*, behind our 502) trips immediately — it won't fix itself
  on retry.
- **A failure streak** of `PAUSE_FAIL_LIMIT` (**5**) consecutive transient failures also trips.

Tripping sets `mode = probe` and re-queues the affected characters at the **front**. Recovery is an
**adaptive backoff**: first probe ~`PAUSE_PROBE_FIRST_MS` (**60s**) after tripping, then **×2 per
failed probe**, capped at `PAUSE_PROBE_MAX_MS` (**30 min**) — so a long outage costs only a handful
of probes. The first probe that succeeds flips the mode back to `run` and the drain resumes. The
owner can always force `run`/`off`/`probe` from the admin page.

(Historically this tripped to a hard `off`; a single 429 froze the whole queue until noticed. It now
trips to `probe` so it self-heals.)

---

## 6. The edge rate-limit layers

Five Cloudflare rate-limit bindings (configured in `wrangler.bible.toml`) gate requests **before any
KV work** — a blocked request touches no KV:

| Binding | Limit | Key | Purpose |
|---|---|---|---|
| `HARD_CAP` | 60 / 60s | per IP | Absolute backstop on **every** request — stops scripted abuse. |
| `LOOKUP_THROTTLE` | 2 / 10s (~1/5s) | per IP | Paces **new-character** lookups. Also reused (distinct keys) for `?submit=1` uploads and `?feedback=1` notes. Cached reads bypass it entirely. |
| `LB_THROTTLE` | 3 / 60s | per IP | Stops leaderboard spam-refresh. |
| `GLOBAL_GATE` | 1000 / 60s | site-wide | Overload gate → "degraded": **new lookups and enqueues pause for everyone equally — no bypass, password or not.** Cached reads keep working. Auto-recovers. |
| `ENQUEUE_GATE` | 10 / 60s | site-wide | Caps **new** characters queued site-wide to match the drain rate, so the backlog (and monthly writes) can't grow faster than we empty it. |

On top of the edge limits, `?submit=1` also carries a KV-backed **daily cap** (`impc:<ip>:<day>`,
40 uploads/day per IP) so one IP can't flood the cache with fabricated loadouts.

The password grants nothing here anymore: no rate, no priority (the premium lane is vestigial,
§3), no degraded-mode bypass.

---

## 7. The admin page (`queue-admin.html`)

A private dashboard that polls `?metrics=1` (with the admin header, see **Auth**) every
**2 seconds**. Panels:

- **Controls** — `Run` (green) / `Off` (red) / `Probe` (amber) buttons (live-highlighted to the
  current mode) plus a **drain-rate** input (1–30). Each POSTs via `?control` and the mode is
  reflected immediately. The current mode and rate are shown at all times.
- **Errors** — recent failed/dropped fetches with their reason and upstream status.
- **Drain history (last hour)** — one row per drain run: time, ✓ cached / ✗ failed / ⊝ dropped
  counts, the **stop reason** (`full` — completed batch, the common case; `time`, `budget`,
  `blocked`, `probe` — probe still down, `paused` — fail-streak breaker tripped, `resumed`, or
  **`kick`**; `ok` shows when no stop reason was recorded), the duration, and the cached names.
  Kicks (sub-2s single-character drains) show here labeled `kick`.
- **Queue** — the live backlog in drain order (premium first), with each entry's wait time.
- **Feedback** — the newest ≤200 notes (the header says "showing 200 of N" when trimmed), with
  mark-read / delete buttons (POSTs).
- **Import bookmarklet** — the (deliberately non-public) one-click importer install, kept here rather
  than on the public grader.

**Auth.** Every admin call carries the **`ADMIN_TOKEN` Worker secret** as an **`X-Admin-Token`
request header**. The old scheme compared `?k=` to a hash baked into the source — the same hash
`gate.js` ships to every browser, so anyone could pass it; it gated nothing. The new rules:

- **Fail-closed** — while the secret is unset, no request is admin.
- **Header, never URL** — a URL param lands in access logs and Referer headers; a header doesn't.
- **Mutations are POST** — `?control`, `?dequeue` evictions, feedback read/delete. A GET can then
  never change state, so a drive-by `<img>` tag can't freeze lookups or purge the queue. Old GET
  admin calls get a `405` whose error names the replacement.
- The page stores the token in `localStorage` and forgets it on any `403` (wrong/rotated token).

**Treat `ADMIN_TOKEN` as a real credential.** Set it with
`wrangler secret put ADMIN_TOKEN --config wrangler.bible.toml`, rotate it there if it leaks, and
never paste it anywhere but the admin page's token box.

---

## 8. The grader side (`grader.js`)

When a lookup returns `{queued}`, the grader shows the "in queue" message and starts a **watch** with
three parts:

1. **`paint`** — a 1s local countdown/animation (free, no requests).
2. **`doSync`** — every **30s**, re-fetch `&pos=1` to refresh the position/ETA (and catch a drop).
3. **`waitLoop`** — a **`?wait=1` long-poll**: the Worker holds the connection up to **25s**,
   checking every **1.5s**, and returns the **instant** the character is cached (`{done:true}` with
   the gems) or dropped (`{notFound, error}`). On a 25s timeout it returns `{done:false}` and the
   client simply reconnects. This is what makes the refresh feel instant instead of waiting out the
   30s poll.

Shared `finishWatch` (render the loadout) and `endWatch(msg)` (stop with a message, e.g. the
not-found reason) tear the watch down from whichever path fires first.

---

## 9. Endpoint reference (`astrogem-bible`)

"Admin" = requires the `ADMIN_TOKEN` secret as an **`X-Admin-Token` header** (fail-closed;
mutations are POST-only — an old GET admin call gets a `405` naming the fix).

| Method | Endpoint | Who | Returns / does |
|---|---|---|---|
| GET | `?region=&name=` | public | Cached gems (legacy/synchronous path). |
| GET | `?region=&name=&queue=1[&pos=1]` | public | Cached gems, **or** `{queued, tier, position?}`; enqueues + kicks on a miss (signed-in only — a signed-out miss gets `401 {needSignIn}`). |
| GET | `…&refresh=1` | public | Bypass the cache and re-pull (re-enqueue; signed-in only). |
| GET | `?wait=1&region=&name=&since=<ms>` | public | Long-poll: `{done:true, …gems}` when cached newer than `since`, `{done:false, notFound, error}` if dropped, else `{done:false}` after ~25s. Pre-checks that the lookup is actually pending (cached / `nf:` / queued) and answers at once when it isn't — the hold-and-poll no longer runs for arbitrary names. |
| GET | `?status=1` | public | `{paused, mode, message}` (30s browser cache) — drives the "unavailable" banner; the message now tracks the mode. |
| GET | `?list=1[&fmt=2]` | public (throttled) | The whole leaderboard snapshot (gzip). |
| POST | `?submit=1` | public (throttled + 40/day/IP) | Bookmarklet import: JSON `{region, name, src}` → cache + leaderboard. `CE` normalizes to `EU`. |
| POST | `?feedback=1` | public (throttled) | Store a feedback note (JSON body; ~90-day TTL). |
| GET | `/oauth/start`, `/oauth/callback` | public | lostark.bible sign-in (Authorization Code + PKCE). |
| GET/POST | `/oauth/me`, `/oauth/logout` | public | Session check / sign-out (`?s=<session>`). |
| GET | `?metrics=1` | **admin** | `{mode, drain:{perMin,delayMs}, queue:{premium,free,total,list}, usage, lastWriteMs, drainLog, hasProbeToken, paused}`. |
| GET | `?feedback=1` | **admin** | Newest ≤200 notes: `{items, count, total, unread}`. |
| GET | `?dequeue=1&list=1` | **admin** | The raw queue keys. |
| POST | `?control=1&mode=&rate=` | **admin** | Set mode (`run`/`off`/`probe`) and/or rate (1–30). Resuming fires an immediate drain. |
| POST | `?dequeue=1&match=`/`&all=1` | **admin** | Evict queue items (substring match, or everything). |
| POST | `?feedback=1&read=`/`&del=` | **admin** | Mark a note read / delete it. |
| POST | `/oauth/probe-token` | **admin** | Arm the drain/probe credential (`Authorization: Bearer` + a server-side roster check that the token owns the canary). Admin-gated so no stranger with a same-name character can seize it. |

---

## 10. KV key reference (namespace `CHARS`)

| Key / prefix | Holds |
|---|---|
| `<region:name>` (lowercased) | A cached character: `{ gems[], itemLevel, class, pulledAt, … }`. |
| `q:p:` / `q:f:` | Premium (vestigial) / free queue entries. Region+name ride in **metadata**; the **value** holds the requester's sign-in token (`{ t }`), which the drain fetches with and which every requeue must preserve. TTL 7d. |
| `q:order` | Ordered queue snapshot (drain order), trusted 90s. |
| `drain:config` | `{ mode, drainPerMin, lastProbe?, interval? }` — the drain state. |
| `drain:lock` | Serialize-drains lock (TTL 60s — KV's minimum; 55 used to make the write throw). |
| `drain:log` | Rolling ~1h drain history (≤240 entries) for the admin. |
| `nf:<key>` | "Not found / no Ark Grid" marker + reason (TTL 1h). |
| `usage:drained` | `{ month, count }` — characters cached this month (budget guard). |
| `impc:<ip>:<YYYYMMDD>` | Per-IP daily `?submit=1` upload counter (cap 40; TTL 2d). |
| `fb:<ts>-<rand>` | A feedback note `{ ts, type, message, contact, ua, read }` (TTL ~90d). |
| `lb:lastwrite` / `lb:builtat` | Timestamps: last character write / last snapshot rebuild. |
| `lb:snapshot:gz` | The prebuilt leaderboard list, stored **gzipped** (`?list=1` serves the bytes as-is with `Content-Encoding: gzip`). The plain-JSON predecessor (`lb:snapshot`) outgrew KV's 25MiB value cap at ~5k characters and its writes silently failed — gzip is ~1.2MB (~25× headroom). |
| `lb:snapshot:gz2` | The same list in the compact v2 tuple format (`?list=1&fmt=2`) — ~10× less JSON for the browser. Rebuilt together with `:gz`. |
| `lb:rebuild:cursor` / `lb:rebuild:acc:gz` | From-scratch rebuild state: the list cursor + the gzipped partial character list. Present only while a chunked first build is in flight (≤750 record reads per cron tick, so the build fits the ~1k-subrequest budget); cleared when it finishes. |
| `lb:dirty:<key>` | Per-character "changed since last snapshot" marker (incremental rebuild). |

---

## 11. Tunable constants (`worker/astrogem-bible.js`)

| Constant | Value | Meaning |
|---|---|---|
| `CACHE_TTL_MS` | 7 days | How long a cached character counts as "fresh". |
| `DRAIN_PER_RUN` | 10 | **Default** drain rate (per minute); overridable at runtime, clamped 1–30. |
| `DRAIN_BUDGET_MS` | 50,000 | Max wall-clock for one drain run (< the 60s cron). |
| `MONTHLY_CHAR_BUDGET` | 300,000 | Hard cap on characters cached per calendar month. |
| `PAUSE_FAIL_LIMIT` | 5 | Consecutive failures that trip the breaker. |
| `PAUSE_PROBE_FIRST_MS` | 60,000 | First probe delay after tripping. |
| `PAUSE_PROBE_MAX_MS` | 1,800,000 | Backoff cap (30 min). |
| `NOTFOUND_TTL_S` | 3,600 | How long a `nf:` marker is remembered (1h). |
| `QUEUE_TTL_S` | 604,800 | Queue-entry expiry (7 days). |
| `MAX_FETCH_ATTEMPTS` | 5 | Transient-failure retries before a queued entry is dropped. |
| `Q_ORDER_TTL_MS` | 90,000 | How long the `q:order` snapshot is trusted. |
| drain lock TTL | 60s | (inline) auto-expiry of `drain:lock` — KV's minimum TTL. |
| `IMPORT_DAILY_CAP` | 40 | Per-IP `?submit=1` uploads per day. |
| `FB_TTL_S` / `FB_LIST_MAX` | 90d / 200 | Feedback note lifetime / newest notes the admin list reads. |
| `REBUILD_KEYS_PER_RUN` | 750 | Record reads per cron tick during a chunked from-scratch rebuild. |
| `?wait` hold / check | 25s / 1.5s | Long-poll duration / poll interval (after the is-it-pending pre-check). |
| admin poll | 2s | (in `queue-admin.html`) metrics refresh cadence. |

> Note: `DRAIN_DELAY_MS` (a legacy fixed 3s) is **superseded** by the rate-derived
> `delayMs = 60000 / drainPerMin` and is no longer used by the drain.

---

## 12. Operational playbook

- **lostark.bible is throwing errors / I see blocks.** It self-heals: the breaker drops to `probe`
  and auto-resumes on recovery. If you want to be explicit, set **Probe** (or **Off** to stop all
  upstream traffic). Set **Run** to force an immediate resume.
- **A character is stuck "in the queue".** Check the admin **Errors**/history. A `422` means that
  character has no Ark Grid astrogems to grade — it's now dropped + remembered (`nf:`), and the
  grader shows that reason instead of spinning.
- **I want to drain faster/slower.** Change the **rate** in Controls (1–30). Remember it's *one every
  `60/rate` seconds*, and the per-run time budget caps the practical ceiling around 16/run.
- **"I don't see the character in the queue."** With the kick, a single character usually caches in
  ~2s and shows in **Drain history** as `kick` rather than lingering in the waiting list. A backlog
  (multiple at once) will show in the live **Queue**, draining one every `60/rate` seconds.
- **The admin token stopped working.** Someone rotated `ADMIN_TOKEN`
  (`wrangler secret put ADMIN_TOKEN --config wrangler.bible.toml`), or it was never set — the check
  fails closed. Enter the current secret in the admin page; a 403 clears the stored one.
- **The leaderboard is empty after a snapshot loss.** The first build now runs chunked across cron
  ticks (~750 records/minute); a ~5.5k-character rebuild finishes in ~8 minutes on its own.

---

*Last updated 2026-07-25. Source of truth is always `worker/astrogem-bible.js`,
`queue-admin.html`, and `grader.js` — if this doc and the code disagree, the code wins.*
