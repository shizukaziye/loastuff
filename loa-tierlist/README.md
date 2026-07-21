# loa-tierlist

Lost Ark DPS tier lists for **every raid, gate, and difficulty** with Combat-Power-era data —
classes ranked by their strongest engraving's **average rDPS per point of Combat Power**.

**Live:** https://shizukaziye.github.io/loa-tierlist/

## Methodology

- Each class enters at the **stronger of its two engravings**; the hover panel shows both
  engravings with each one's own tier pill. An **Engraving: Strongest only / All engravings**
  toggle switches to ranking every DPS engraving as its own entry — strong and weak builds in
  one list. An engraving's band is the same in both views (% of the same #1).
- The metric is `avg rDPS ÷ Combat Power` per logged player — gear cancels out.
- Tiers are **fixed bands of the #1 class's value**:
  `S ≥98% · A ≥95% · B ≥90% · C ≥85% · D ≥80% · F <80%`. Empty tiers are information.
- Bard and Artist are excluded, as are support specs (Blessed Aura, Desperate Salvation,
  Full Bloom, Liberator, "Princess" Gunlancer) — support rDPS is buff attribution on a ~3.5×
  scale. A `2.2× median` outlier guard catches any future support spec automatically.
- Entries with `n < 300` are dagger-marked (small sample).

## Architecture

```
GitHub Pages (this repo, static)          Cloudflare Worker (worker/)
index.html + app.js + config.js  ──GET──▶ /stats?boss&difficulty&patch&type
icons.js (astrogem class glyphs)          KV cache, 24h TTL ──▶ lostark.bible
                                          (serves stale + refetches on miss)
```

- **Data source:** [lostark.bible](https://lostark.bible) (ex-uwuowo, LOA Logs data), via its
  SvelteKit remote endpoint `/_app/remote/<hash>/combatPowerDPSSearch`. The site sends no CORS
  headers, so the worker proxies it and caches each combo in KV for **24 hours** — a lookup
  older than that re-pulls from the source when you view it.
- **`<hash>` rotates on every lostark.bible deploy.** The worker auto-rediscovers it on 404
  (stats HTML → app entry JS → route chunks → literal next to `combatPowerDPSSearch`) and
  caches the result; `SEED_HASH` in `worker/stats-proxy.js` is only a first-boot hint.
- Boss identities that differ per difficulty (`Flash of Punishment` for Mordum G3 Hard,
  `Archdemon Kazeros` for Kazeros G2 Normal) are remapped in `config.js`.
- Raids retired before Combat-Power collection began (Behemoth, Aegir, Brelshaza, Mordum,
  Extreme Thaemine, Tarkal) have **no data upstream at all**; their tabs explain that instead
  of showing an empty chart.

## Deploying

Site: push to `main` — GitHub Pages serves the repo root. No build step.

Worker (separate, like every worker in this household):

```
cd worker
npx wrangler deploy
```

## When a new patch drops

1. Add it to `patches` in `config.js` (newest last) — the API name follows lostark.bible's
   convention (`jun26`, `mar26`, …; verify in the site's patch dropdown network calls).
2. Nothing else: the client always queries the newest patch first and walks back up to two
   patches when a combo has no data yet ("The First" pins to `mar26` via `patchOverride`).

## Regenerating icons

`node tools/gen-icons.js` (reads `../astrogem-calculator/assets/class-icons`).

---

Data: lostark.bible / [LOA Logs](https://github.com/snoww/loa-logs) — self-reported, not
representative of the whole playerbase. Not affiliated with Smilegate, AGS, or lostark.bible.
