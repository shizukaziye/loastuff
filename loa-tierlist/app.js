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

  // Rich hover popovers, astrogem-pipeline style: card markup carries only a data-tip id;
  // content lives in this registry (rebuilt per render) and one floating element on <body>
  // shows it immediately on hover/focus — no title-attribute delay.
  let TIPS = {};
  let TIP_SEQ = 0;

  // ---------- routing ----------
  const parseRoute = () => {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [r, g, d, m] = parts;
    const mode = (m === 'all' || m === 'secondary') ? 'all' : 'primary'; // 'secondary' is a legacy alias
    const raid = C.raids.find(x => x.slug === r) || null;
    const gate = raid && (raid.gates.find(x => x.slug === g) || raid.gates[0]);
    const diff = raid && (raid.difficulties.find(x => x.slug === d) || raid.difficulties[raid.difficulties.length - 1]);
    if (raid) return { raid, gate, diff, mode };
    const [dr, dg, dd] = C.defaultRoute.split('/');
    const raid2 = C.raids.find(x => x.slug === dr);
    return {
      raid: raid2,
      gate: raid2.gates.find(x => x.slug === dg) || raid2.gates[0],
      diff: raid2.difficulties.find(x => x.slug === dd) || raid2.difficulties[0],
      mode,
    };
  };
  const routeHash = (raid, gate, diff, mode) =>
    `#/${raid.slug}/${gate.slug}/${diff.slug}${mode === 'all' ? '/all' : ''}`;

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
  // mode 'primary': one entry per class, at its strongest engraving.
  // mode 'all': one entry per DPS engraving — strong and weak builds ranked together.
  // The top reference is the same in both modes (the global best spec), so a given
  // engraving's % of #1 — and therefore its band — is mode-independent.
  const bandOf = pct => C.tiers.find(t => pct >= t.pct) || C.tiers[C.tiers.length - 1];

  function computeRanking(rows, mode = 'primary') {
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
      if (mode === 'all') {
        specs.forEach((s, i) => entries.push({ cls, best: s, alt: specs[1 - i] || null, excludedSupport }));
      } else {
        entries.push({ cls, best: specs[0], alt: specs[1] || null, excludedSupport });
      }
    }
    entries.sort((a, b) => b.best.avg - a.best.avg);
    const top = entries.length ? entries[0].best.avg : 0;
    for (const e of entries) {
      e.pct = top ? e.best.avg / top * 100 : 0;
      e.tier = bandOf(e.pct);
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
      `<div class="railgroup"><span class="raillabel">Engraving</span>` +
        `<button class="stab${route.mode === 'primary' ? ' cur' : ''}" data-mode="primary">Strongest only</button>` +
        `<button class="stab${route.mode === 'all' ? ' cur' : ''}" data-mode="all">All engravings</button></div>` +
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

    // dots with lane stagger (more lanes when the list is dense, e.g. all-engravings mode)
    const asc = entries.slice().sort((a, b) => a.best.avg - b.best.avg);
    const laneCount = entries.length > 35 ? 5 : 3;
    const laneDy = laneCount > 3 ? 12 : 14;
    const laneLastX = Array(laneCount).fill(-1e9);
    let dots = '';
    for (const e of asc) {
      const x = X(e.best.avg);
      let lane = laneLastX.findIndex(lx => x - lx >= 13);
      if (lane === -1) lane = laneCount - 1;
      laneLastX[lane] = x;
      dots += `<circle${e.tier.key === 'S' ? ' class="rb"' : ''} cx="${x.toFixed(1)}" cy="${106 - lane * laneDy}" r="5" fill="${e.tier.hue}" stroke="var(--bg)" stroke-width="2"><title>${esc(displayName(e.cls))} — ${esc(e.best.spec)} · ${fmt(e.best.avg)} (${e.pct.toFixed(1)}%)</title></circle>`;
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
        letters += `<text x="${((X(l) + X(u)) / 2).toFixed(1)}" y="46" text-anchor="middle" class="regionletter${b.t.key === 'S' ? ' rb' : ''}" fill="${b.t.hue}">${b.t.key}</text>`;
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

  function buildTip(e, idx, ranked, top, mode = 'primary') {
    const b = e.best;
    const pill = `<span class="tp-pill${e.tier.key === 'S' ? ' rb' : ''}" style="background:${e.tier.hue}">${e.tier.key}</span>`;
    let html = `<div class="tp-head">${esc(displayName(e.cls))} ${pill}<span class="tp-rank">#${String(idx + 1).padStart(2, '0')} of ${ranked.length}</span></div>`;

    // both engravings, side by side (▸ marks the one this card is ranked by);
    // every row carries its own tier pill — an engraving's band is mode-independent.
    const specRow = (s, best) => {
      const share = e.alt ? (s.count / (e.best.count + e.alt.count) * 100).toFixed(0) : '100';
      const sPct = s.avg / top * 100;
      const band = bandOf(sPct);
      const note = !best && s.avg > b.avg ? '<span class="tp-dim"> &#183; stronger</span>' : '';
      return `<tr class="${best ? 'tp-best' : ''}"><td class="tp-spec">${best ? '&#9656; ' : ''}${esc(s.spec)}${note}</td>` +
        `<td class="tp-tierc"><span class="tp-tier${band.key === 'S' ? ' rb' : ''}" style="background:${band.hue}">${band.key}</span></td>` +
        `<td class="tp-num">${fmt(s.avg)}</td><td class="tp-num">${sPct.toFixed(1)}%</td>` +
        `<td class="tp-num">${fmt(s.count)}</td><td class="tp-num">${share}%</td></tr>`;
    };
    html += `<table class="tp-tbl"><thead><tr><th>Engraving</th><th>Tier</th><th>rDPS/CP</th><th>vs #1</th><th>n</th><th>share</th></tr></thead><tbody>`;
    html += specRow(b, true);
    if (e.alt) html += specRow(e.alt, false);
    html += `</tbody></table>`;
    if (!e.alt && e.excludedSupport) html += `<div class="tp-dim">Other engraving is a support spec &#8212; excluded from ranking.</div>`;

    // band position
    const ti = C.tiers.indexOf(e.tier);
    const above = ti > 0 ? C.tiers[ti - 1] : null;
    const bandLabel = e.tier.key === 'F' ? 'F &#183; &lt;80%' : `${e.tier.key} &#183; &#8805;${e.tier.pct}%`;
    let kv = `<span class="tp-k">vs #1</span><span class="tp-v">${e.pct.toFixed(1)}%` +
      (idx ? `<span class="tp-dim"> &#183; &#8722;${fmt(top - b.avg)}</span>` : '') + `</span>`;
    kv += `<span class="tp-k">band</span><span class="tp-v">${bandLabel}</span>`;
    if (e.tier.key === 'F') {
      kv += `<span class="tp-k">to D cut</span><span class="tp-v">${(80 - e.pct).toFixed(1)}% below</span>`;
    } else {
      kv += `<span class="tp-k">cushion</span><span class="tp-v">+${(e.pct - e.tier.pct).toFixed(1)}% above the ${e.tier.key} cut</span>`;
      if (above) kv += `<span class="tp-k">next band</span><span class="tp-v">${(above.pct - e.pct).toFixed(1)}% short of ${above.key}</span>`;
    }
    html += `<div class="tp-sec"><div class="tp-sec-h">Band position</div><div class="tp-grid">${kv}</div></div>`;

    // neighbours in the ranking
    const up = idx > 0 ? ranked[idx - 1] : null;
    const dn = idx < ranked.length - 1 ? ranked[idx + 1] : null;
    let nb = `<span class="tp-k">above</span><span class="tp-v">${up
      ? `#${String(idx).padStart(2, '0')} ${esc(displayName(up.cls))}<span class="tp-dim"> ${esc(up.best.spec)} &#183; +${fmt(up.best.avg - b.avg)} ahead</span>`
      : 'top of the list'}</span>`;
    nb += `<span class="tp-k">below</span><span class="tp-v">${dn
      ? `#${String(idx + 2).padStart(2, '0')} ${esc(displayName(dn.cls))}<span class="tp-dim"> ${esc(dn.best.spec)} &#183; ${fmt(b.avg - dn.best.avg)} behind</span>`
      : 'bottom of the list'}</span>`;
    html += `<div class="tp-sec"><div class="tp-sec-h">Neighbours</div><div class="tp-grid">${nb}</div></div>`;

    if (b.count < C.smallSample) html += `<div class="tp-warn">&#8224; small sample &#8212; only ${fmt(b.count)} logs; read loosely.</div>`;
    return html;
  }

  function cardHTML(e, rank, tipId) {
    const b = e.best;
    const small = b.count < C.smallSample ? '&#8224;' : '';
    const label = `${displayName(e.cls)} — ${b.spec}: ${fmt(b.avg)} rDPS per Combat Power, ${e.pct.toFixed(1)}% of first place, tier ${e.tier.key}, n ${fmt(b.count)}`;
    return `<article class="card" data-tip="${tipId}" tabindex="0" aria-label="${esc(label)}">
      <div class="cardtop"><span class="rank">${String(rank).padStart(2, '0')}</span><span class="icon">${ICONS[e.cls] || ''}</span></div>
      <h3 class="cls">${esc(displayName(e.cls))}</h3>
      <p class="spec">${esc(b.spec)}</p>
      <p class="val">${fmt(b.avg)}<span class="valmeta">${e.pct.toFixed(1)} vs #1&#8202;&#183;&#8202;n ${fmt(b.count)}${small}</span></p>
    </article>`;
  }

  function renderResult(route, data) {
    const mode = route.mode;
    const { entries: ranked } = computeRanking(data.rows, mode);
    const totalN = ranked.reduce((s, e) => s + e.best.count, 0);
    const asOf = data.fetchedAt ? new Date(data.fetchedAt) : null;
    const asOfStr = asOf ? asOf.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

    $('#combo-title').innerHTML = `${esc(route.raid.name)} ${esc(route.gate.short)} &#8212; <span class="nm">${esc(route.diff.name)}</span>` +
      (mode === 'all' ? ` <span class="h1mode">&#183; all engravings</span>` : '');
    const lede = $('#mode-lede');
    if (lede) lede.textContent = mode === 'all'
      ? 'Every DPS engraving ranked separately — strong and weak builds in one list.'
      : 'Every class enters at the stronger of its two engravings.';
    $('#meta').innerHTML = [
      `source lostark.bible / LOA Logs`,
      `rDPS &#183; patch ${esc(patchName(data.patch))}`,
      mode === 'all' ? `all engravings` : null,
      `n ${fmt(totalN)} across ${ranked.length} ${mode === 'all' ? 'builds' : 'classes'}`,
      `data as of ${asOfStr}${data.stale ? ' &#183; stale' : ''}`,
    ].filter(Boolean).map(s => `<span>${s}</span>`).join('');

    if (!ranked.length) {
      $('#content').innerHTML = `<div class="empty">No Combat-Power data for this combination on recent patches.</div>`;
      return;
    }

    TIPS = {}; TIP_SEQ = 0; hidePop(); // rebuild the hover registry for this render
    const top = ranked[0].best.avg;
    let rank = 0;
    const rows = C.tiers.map(t => {
      const tierEntries = ranked.filter(e => e.tier.key === t.key);
      const cards = tierEntries.map(e => {
        const tipId = 't' + (TIP_SEQ++);
        TIPS[tipId] = buildTip(e, ranked.indexOf(e), ranked, top, mode);
        return cardHTML(e, ++rank, tipId);
      }).join('');
      return `<section class="tier">
        <div class="chip${t.glow ? ' chip-z' : ''}${t.key === 'S' ? ' chip-s' : ''}" style="--tier:${t.hue}"><span>${t.key}</span></div>
        <div class="cards">${cards || `<div class="tierempty">nothing in the ${t.key === 'F' ? '&lt;80%' : '&#8805;' + t.pct + '%'} band</div>`}</div>
      </section>`;
    }).join('');

    $('#content').innerHTML = `
      <section class="strip">
        <div class="striphead">
          <h2>The spread</h2>
          <p>${mode === 'all' ? 'Every DPS engraving' : 'Every class at its best engraving'} &#8212; dashed cuts are the tier thresholds (% of #1).</p>
        </div>
        ${stripSVG(ranked, top)}
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
    document.title = `${route.raid.name} ${route.gate.short} ${route.diff.name}${route.mode === 'all' ? ' (all engravings)' : ''} — LOA DPS Tier List`;
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

  // ---------- hover popover (immediate; astrogem wireTips pattern) ----------
  function popEl() {
    let el = document.getElementById('tl-pop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tl-pop';
      el.className = 'tl-pop';
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    return el;
  }
  function hidePop() { const el = document.getElementById('tl-pop'); if (el) el.style.display = 'none'; }
  function positionPop(el, card) {
    const r = card.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const pad = 10, gap = 8;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = r.right + gap;                                  // prefer right of the card
    if (left + pw > vw - pad) left = r.left - gap - pw;        // flip left if it would clip
    if (left < pad) left = Math.max(pad, Math.min(vw - pw - pad, r.left)); // last resort: clamp
    let topY = r.top;
    if (topY + ph > vh - pad) topY = vh - ph - pad;
    if (topY < pad) topY = pad;
    el.style.left = (left + window.pageXOffset) + 'px';
    el.style.top = (topY + window.pageYOffset) + 'px';
  }
  (function wirePop() {
    const el = popEl();
    let hideT = null, cur = null;
    const show = card => {
      const id = card.getAttribute('data-tip');
      if (!id || !TIPS[id]) return;
      if (hideT) { clearTimeout(hideT); hideT = null; }
      cur = card;
      el.innerHTML = TIPS[id];
      el.style.display = 'block';
      el.style.visibility = 'hidden';   // measure, then place
      positionPop(el, card);
      el.style.visibility = 'visible';
    };
    const hide = () => { cur = null; hideT = setTimeout(() => { el.style.display = 'none'; }, 60); };
    document.addEventListener('mouseover', e => {
      const card = e.target.closest && e.target.closest('.card[data-tip]');
      if (card && card !== cur) show(card);
    });
    document.addEventListener('mouseout', e => {
      const to = e.relatedTarget;
      if (to && el.contains(to)) return;                        // moving into the popover
      const card = e.target.closest && e.target.closest('.card[data-tip]');
      if (card && to && card.contains(to)) return;              // still inside the same card
      if (card) hide();
    });
    document.addEventListener('focusin', e => {
      const card = e.target.closest && e.target.closest('.card[data-tip]');
      if (card) show(card);
    });
    document.addEventListener('focusout', e => {
      const card = e.target.closest && e.target.closest('.card[data-tip]');
      if (card) hide();
    });
    el.addEventListener('mouseenter', () => { if (hideT) { clearTimeout(hideT); hideT = null; } });
    el.addEventListener('mouseleave', () => hide());
    window.addEventListener('hashchange', hidePop);
  })();

  // ---------- wiring ----------
  document.addEventListener('click', ev => {
    const raidBtn = ev.target.closest('[data-raid]');
    const gateBtn = ev.target.closest('[data-gate]');
    const diffBtn = ev.target.closest('[data-diff]');
    const modeBtn = ev.target.closest('[data-mode]');
    const cur = parseRoute();
    if (raidBtn) {
      const raid = C.raids.find(r => r.slug === raidBtn.dataset.raid);
      location.hash = routeHash(raid, raid.gates[0], raid.difficulties[raid.difficulties.length - 1], cur.mode);
    } else if (gateBtn) {
      location.hash = routeHash(cur.raid, cur.raid.gates.find(g => g.slug === gateBtn.dataset.gate), cur.diff, cur.mode);
    } else if (diffBtn) {
      location.hash = routeHash(cur.raid, cur.gate, cur.raid.difficulties.find(d => d.slug === diffBtn.dataset.diff), cur.mode);
    } else if (modeBtn) {
      location.hash = routeHash(cur.raid, cur.gate, cur.diff, modeBtn.dataset.mode);
    }
  });
  window.addEventListener('hashchange', () => show(parseRoute()));
  show(parseRoute());
})();
