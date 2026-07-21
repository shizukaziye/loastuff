// LOA DPS tier lists — rDPS per point of Combat Power, tiered as % of #1.
// Data flows: lostark.bible (LOA Logs) -> Cloudflare worker (24h KV cache) -> here.
(() => {
  'use strict';
  const C = window.LOA_CONFIG;
  const ICONS = window.CLASS_ICONS || {};
  const $ = sel => document.querySelector(sel);
  const fmt = n => n.toLocaleString('en-US');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const sessionCache = new Map(); // combo key -> resolved {rows, fetchedAt, patch, stale}

  // ---------- routing ----------
  const parseRoute = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [r, g, d] = parts;
    const raid = C.raids.find(x => x.slug === r) || null;
    const gate = raid && (raid.gates.find(x => x.slug === g) || raid.gates[0]);
    const diff = raid && (raid.difficulties.find(x => x.slug === d) || raid.difficulties[raid.difficulties.length - 1]);
    if (raid) return { raid, gate, diff };
    const [dr, dg, dd] = C.defaultRoute.split('/');
    const raid2 = C.raids.find(x => x.slug === dr);
    return {
      raid: raid2,
      gate: raid2.gates.find(x => x.slug === dg) || raid2.gates[0],
      diff: raid2.difficulties.find(x => x.slug === dd) || raid2.difficulties[0],
    };
  };
  const routeHash = (raid, gate, diff) => `#/${raid.slug}/${gate.slug}/${diff.slug}`;

  // ---------- data ----------
  const patchName = api => (C.patches.find(p => p.api === api) || {}).name || api;

  async function fetchCombo(raid, gate, diff) {
    const override = C.patchOverride[`${raid.slug}|${diff.slug}`];
    const newestFirst = C.patches.map(p => p.api).reverse();
    const tryPatches = override ? [override] : newestFirst.slice(0, 3); // walk back max 2 patches
    const boss = (C.bossRemap[gate.boss] || {})[diff.name] || gate.boss;
    const key = `${raid.slug}|${gate.slug}|${diff.slug}`;
    if (sessionCache.has(key)) return sessionCache.get(key);

    let last = null;
    for (const patch of tryPatches) {
      const url = `${C.workerUrl}/stats?boss=${encodeURIComponent(boss)}&difficulty=${encodeURIComponent(diff.name)}&patch=${encodeURIComponent(patch)}&type=rdps`;
      const res = await fetch(url);
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { msg = (await res.json()).error || msg; } catch { /* keep */ }
        throw new Error(msg);
      }
      last = await res.json();
      last.patch = patch;
      if (last.rows && last.rows.length) break;
    }
    const out = last || { rows: [], patch: tryPatches[0], fetchedAt: Date.now() };
    sessionCache.set(key, out);
    return out;
  }

  // ---------- methodology ----------
  function computeRanking(rows) {
    const dpsRows = rows.filter(r => !C.excludeClasses.includes(r.cls) && !C.supportSpecs.includes(r.spec));
    const avgs = dpsRows.map(r => r.avg).sort((a, b) => a - b);
    const median = avgs.length ? avgs[Math.floor(avgs.length / 2)] : 0;
    const clean = dpsRows.filter(r => r.avg <= median * C.supportOutlierFactor);
    const byClass = new Map();
    for (const r of clean) {
      if (!byClass.has(r.cls)) byClass.set(r.cls, []);
      byClass.get(r.cls).push(r);
    }
    const entries = [];
    for (const [cls, specs] of byClass) {
      specs.sort((a, b) => b.avg - a.avg);
      const excludedSupport = rows.some(r => r.cls === cls && C.supportSpecs.includes(r.spec));
      entries.push({ cls, best: specs[0], alt: specs[1] || null, excludedSupport });
    }
    entries.sort((a, b) => b.best.avg - a.best.avg);
    const top = entries.length ? entries[0].best.avg : 0;
    for (const e of entries) {
      e.pct = top ? e.best.avg / top * 100 : 0;
      e.tier = C.tiers.find(t => e.pct >= t.pct) || C.tiers[C.tiers.length - 1];
    }
    return { entries, top };
  }

  // ---------- rendering ----------
  const displayName = cls => C.displayNames[cls] || cls;

  function renderRails(route) {
    $('#raid-rail').innerHTML = C.raids.map(r => {
      const cur = r === route.raid;
      const dead = !r.cpData;
      return `<button class="rtab${cur ? ' cur' : ''}${dead ? ' dead' : ''}" data-raid="${r.slug}"
        title="${dead ? esc(r.name + ' stopped accepting stats in ' + r.stopped + ', before Combat-Power data collection began') : esc(r.category)}">${esc(r.name)}</button>`;
    }).join('');
    $('#sub-rail').innerHTML =
      `<div class="railgroup"><span class="raillabel">Gate</span>${route.raid.gates.map(g =>
        `<button class="stab${g === route.gate ? ' cur' : ''}" data-gate="${g.slug}">${esc(g.short)}</button>`).join('')}</div>` +
      `<div class="railgroup"><span class="raillabel">Difficulty</span>${route.raid.difficulties.map(d =>
        `<button class="stab${d === route.diff ? ' cur' : ''}" data-diff="${d.slug}">${esc(d.name)}</button>`).join('')}</div>`;
  }

  function stripSVG(entries, top) {
    if (!entries.length) return '';
    const values = entries.map(e => e.best.avg);
    const lo = Math.min(Math.min(...values) * 0.995, top * 0.795);
    const hi = top * 1.008;
    const X0 = 30, X1 = 970;
    const X = v => X0 + (v - lo) / (hi - lo) * (X1 - X0);

    // dots with lane stagger
    const asc = entries.slice().sort((a, b) => a.best.avg - b.best.avg);
    const laneLastX = [-1e9, -1e9, -1e9];
    let dots = '';
    for (const e of asc) {
      const x = X(e.best.avg);
      let lane = laneLastX.findIndex(lx => x - lx >= 13);
      if (lane === -1) lane = 2;
      laneLastX[lane] = x;
      dots += `<circle cx="${x.toFixed(1)}" cy="${106 - lane * 14}" r="5" fill="${e.tier.hue}" stroke="var(--bg)" stroke-width="2"><title>${esc(displayName(e.cls))} — ${esc(e.best.spec)} · ${fmt(e.best.avg)} (${e.pct.toFixed(1)}%)</title></circle>`;
    }

    // threshold cuts + region letters (the methodology, drawn to scale)
    let cuts = '', letters = '';
    const cutXs = [];
    const bands = C.tiers.map((t, i) => ({
      t,
      upper: i === 0 ? hi : top * C.tiers[i - 1].pct / 100,
      lower: t.pct ? top * t.pct / 100 : lo,
    }));
    for (const b of bands) {
      if (b.t.pct && b.lower > lo && b.lower < hi) {
        const x = X(b.lower);
        cutXs.push(x);
        cuts += `<line x1="${x.toFixed(1)}" y1="68" x2="${x.toFixed(1)}" y2="124" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 4" opacity=".55"/>`;
        cuts += `<text x="${x.toFixed(1)}" y="140" text-anchor="middle" class="ax">${b.t.pct}%</text>`;
      }
      const l = Math.max(b.lower, lo), u = Math.min(b.upper, hi);
      if (u > l && (u - l) / (hi - lo) > 0.03) {
        letters += `<text x="${((X(l) + X(u)) / 2).toFixed(1)}" y="46" text-anchor="middle" class="regionletter" fill="${b.t.hue}">${b.t.key}</text>`;
      }
    }

    // axis + endpoint labels (ticks yield to nearby cut labels)
    let axis = `<line x1="${X0}" y1="118" x2="${X1}" y2="118" stroke="var(--line)" stroke-width="1"/>`;
    const span = hi - lo;
    const step = span > 24000 ? 8000 : span > 12000 ? 4000 : 2000;
    for (let tv = Math.ceil(lo / step) * step; tv < hi; tv += step) {
      const x = X(tv);
      axis += `<line x1="${x.toFixed(1)}" y1="118" x2="${x.toFixed(1)}" y2="123" stroke="var(--line)" stroke-width="1"/>`;
      if (cutXs.every(cx => Math.abs(cx - x) > 20)) {
        axis += `<text x="${x.toFixed(1)}" y="136" text-anchor="middle" class="ax">${(tv / 1000)}K</text>`;
      }
    }
    const first = entries[0], lastE = entries[entries.length - 1];
    axis += `<text x="${X1 - 2}" y="64" text-anchor="end" class="endlabel">${esc(first.best.spec)}&#8202;&#183;&#8202;${fmt(first.best.avg)}</text>`;
    axis += `<text x="40" y="64" text-anchor="start" class="endlabel">${esc(lastE.best.spec)}&#8202;&#183;&#8202;${fmt(lastE.best.avg)}</text>`;
    axis += `<text x="${X0}" y="154" text-anchor="start" class="cap">avg rDPS per point of Combat Power &#8594;</text>`;
    axis += `<text x="${X1}" y="154" text-anchor="end" class="cap">axis starts at ${(lo / 1000).toFixed(0)}K &#183; cuts are % of #1</text>`;
    return `<svg viewBox="0 0 1000 162" role="img" aria-label="All classes by best engraving with tier thresholds">${axis}${cuts}${letters}${dots}</svg>`;
  }

  function cardHTML(e, rank) {
    const b = e.best;
    const small = b.count < C.smallSample ? '&#8224;' : '';
    const altBit = e.alt ? `Other engraving: ${e.alt.spec} ${fmt(e.alt.avg)} (n ${fmt(e.alt.count)})`
      : e.excludedSupport ? 'Other engraving is a support spec (excluded)' : 'Single ranked engraving';
    const tip = `${displayName(e.cls)} — ${b.spec}: ${fmt(b.avg)} rDPS/CP, n ${fmt(b.count)}. ${altBit}.`;
    return `<article class="card" title="${esc(tip)}">
      <div class="cardtop"><span class="rank">${String(rank).padStart(2, '0')}</span><span class="icon">${ICONS[e.cls] || ''}</span></div>
      <h3 class="cls">${esc(displayName(e.cls))}</h3>
      <p class="spec">${esc(b.spec)}</p>
      <p class="val">${fmt(b.avg)}<span class="valmeta">${e.pct.toFixed(1)} vs #1&#8202;&#183;&#8202;n ${fmt(b.count)}${small}</span></p>
    </article>`;
  }

  function renderResult(route, data) {
    const { entries: ranked } = computeRanking(data.rows);
    const totalN = ranked.reduce((s, e) => s + e.best.count, 0);
    const asOf = data.fetchedAt ? new Date(data.fetchedAt) : null;
    const asOfStr = asOf ? asOf.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

    $('#combo-title').innerHTML = `${esc(route.raid.name)} ${esc(route.gate.short)} &#8212; <span class="nm">${esc(route.diff.name)}</span>`;
    $('#meta').innerHTML = [
      `source lostark.bible / LOA Logs`,
      `rDPS &#183; patch ${esc(patchName(data.patch))}`,
      `n ${fmt(totalN)} across ${ranked.length} classes`,
      `data as of ${asOfStr}${data.stale ? ' &#183; stale' : ''}`,
    ].map(s => `<span>${s}</span>`).join('');

    if (!ranked.length) {
      $('#content').innerHTML = `<div class="empty">No Combat-Power data for this combination on recent patches.</div>`;
      return;
    }

    let rank = 0;
    const rows = C.tiers.map(t => {
      const tierEntries = ranked.filter(e => e.tier.key === t.key);
      const cards = tierEntries.map(e => cardHTML(e, ++rank)).join('');
      return `<section class="tier">
        <div class="chip${t.glow ? ' chip-z' : ''}" style="--tier:${t.hue}"><span>${t.key}</span></div>
        <div class="cards">${cards || `<div class="tierempty">no class in the ${t.key === 'F' ? '&lt;80%' : '&#8805;' + t.pct + '%'} band</div>`}</div>
      </section>`;
    }).join('');

    $('#content').innerHTML = `
      <section class="strip">
        <div class="striphead">
          <h2>The spread</h2>
          <p>Every class at its best engraving &#8212; dashed cuts are the tier thresholds (% of #1).</p>
        </div>
        ${stripSVG(ranked, ranked[0].best.avg)}
      </section>
      ${rows}`;
  }

  function renderDead(route) {
    $('#combo-title').innerHTML = `${esc(route.raid.name)} ${esc(route.gate.short)} &#8212; <span class="nm">${esc(route.diff.name)}</span>`;
    $('#meta').innerHTML = `<span>retired ${esc(route.raid.stopped)}</span>`;
    $('#content').innerHTML = `<div class="empty"><b>${esc(route.raid.name)}</b> stopped accepting stats in ${esc(route.raid.stopped)} &#8212;
      before lostark.bible began collecting Combat-Power data (July 2025 patch onward, active raids only).
      No relative-performance chart exists for it.</div>`;
  }

  async function show(route) {
    renderRails(route);
    document.title = `${route.raid.name} ${route.gate.short} ${route.diff.name} — LOA DPS Tier List`;
    if (!route.raid.cpData) { renderDead(route); return; }
    $('#combo-title').innerHTML = `${esc(route.raid.name)} ${esc(route.gate.short)} &#8212; <span class="nm">${esc(route.diff.name)}</span>`;
    $('#meta').innerHTML = '<span>loading&#8230;</span>';
    $('#content').innerHTML = `<div class="empty pulse">Summoning the data&#8230;</div>`;
    try {
      const data = await fetchCombo(route.raid, route.gate, route.diff);
      renderResult(route, data);
    } catch (e) {
      $('#meta').innerHTML = '';
      $('#content').innerHTML = `<div class="empty">Could not reach the stats worker (${esc(String(e.message || e))}).
        <button id="retry" class="stab" style="margin-left:10px">Retry</button></div>`;
      const btn = $('#retry');
      if (btn) btn.addEventListener('click', () => show(parseRoute()));
    }
  }

  // ---------- wiring ----------
  document.addEventListener('click', ev => {
    const raidBtn = ev.target.closest('[data-raid]');
    const gateBtn = ev.target.closest('[data-gate]');
    const diffBtn = ev.target.closest('[data-diff]');
    const cur = parseRoute();
    if (raidBtn) {
      const raid = C.raids.find(r => r.slug === raidBtn.dataset.raid);
      location.hash = routeHash(raid, raid.gates[0], raid.difficulties[raid.difficulties.length - 1]);
    } else if (gateBtn) {
      location.hash = routeHash(cur.raid, cur.raid.gates.find(g => g.slug === gateBtn.dataset.gate), cur.diff);
    } else if (diffBtn) {
      location.hash = routeHash(cur.raid, cur.gate, cur.raid.difficulties.find(d => d.slug === diffBtn.dataset.diff));
    }
  });
  window.addEventListener('hashchange', () => show(parseRoute()));
  show(parseRoute());
})();
