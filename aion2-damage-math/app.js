(function () {
  'use strict';
  const A = window.A2, Z = window.A2P, STATS = A.STATS;
  const KEY = 'aion2-damage-math-v3';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const num = (x) => Number(x) || 0;

  /* ---------- tiny DOM helpers (text only, never innerHTML) ---------- */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; n.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return n;
  }
  function sv(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- formatting ---------- */
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const fmtN = (x) => nf0.format(x);
  const trim = (v, d = 2) => String(Number(Number(v).toFixed(d)));
  const fmtP = (x) => trim(x * 100) + '%';
  const fmtX = (x) => '×' + x.toFixed(3);
  const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt1 = (x) => nf1.format(x);
  const fmtM4 = (x) => '×' + x.toFixed(4);
  const fmtG4 = (g) => (g < 0 ? '−' : '+') + Math.abs(g * 100).toFixed(4) + '%';
  function fmtG(g) {
    const v = g * 100, a = Math.abs(v);
    if (a < 0.0005) return '0%';
    return (v < 0 ? '−' : '+') + a.toFixed(a < 0.0995 ? 3 : 2) + '%';
  }
  function fmtK(n) {
    if (!isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return trim(n / 1e9, 2) + 'B';
    if (a >= 1e6) return trim(n / 1e6, 2) + 'M';
    if (a >= 1e4) return trim(n / 1e3, 0) + 'K';
    return fmtN(n);
  }
  const SHORT = { db: 'Damage Boost', posDb: 'Back / Front Damage Boost', flatPve: 'PvE / Boss Attack', flatPos: 'Back / Front Attack' };
  const nameOf = (k) => SHORT[k] || STATS[k].name;
  const unitOf = (k) => STATS[k].unit.trim();
  const stepText = (k, x) => '+' + trim(x, 2) + (unitOf(k) === '%' ? '%' : '') + ' ' + nameOf(k);
  const chip = (cls, text) => h('span', { class: 'chip ' + cls }, h('i', { 'aria-hidden': 'true' }), text);

  /* ---------- state ---------- */
  /* the two-step ring transfer craft (Handicrafting, Global): Splendent White 86 -> Wise 94 -> Splendent Wise 102.
     One craft in four lands on 102 directly, so step 2 is paid 75% of the time. */
  const RING_RECIPE = {
    items: [
      ['ring', 'Artisan’s Splendent Sapphire Ring', 1, 0],
      ['aurs', 'Artisan’s Ultimate Refining Stone', 2, 1],
      ['edbs', 'Enhanced Durable Balaur Scale', 16, 8],
      ['mind', 'Wrathful Mind', 2, 0],
      ['will', 'Wrathful Will', 2, 0],
      ['ego', 'Wrathful Ego', 8, 3],
      ['sapph', 'Radiant Sapphire Gemstone', 5, 2],
      ['odyle', 'Radiant Odyle', 3, 2]
    ],
    miss: 0.75, fee: 1000000
  };
  /* Market lowest asks on Kinah Ledger, read Nov 16, 2026 (the site's snapshots of Nov 15 and 16) */
  const PRICE_SETS = {
    nezekan: { label: 'Nezekan (Elyos, NA East)', prices: { ring: 8450000, aurs: 240000, edbs: 30000, mind: 3400000, will: 1790000, ego: 4500000, sapph: 1150000, odyle: 1100000 } },
    azphel: { label: 'Azphel (Asmodian, NA East)', prices: { ring: 6800000, aurs: 140000, edbs: 110000, mind: 2450000, will: 3100000, ego: 5600000, sapph: 2000000, odyle: 999400 } }
  };
  const PRICE_DATE = 'Nov 16, 2026';
  /* what one ring gains going from item level 86 to 102 depends on its enhancement, so each built-in sheet names its own */
  const ringOf = (preset) => (Z.PRESETS[preset] && Z.PRESETS[preset].ring) || { atk: 33, enh: '+15 amplified to +17', server: 'nezekan' };
  /* one set of material prices serves every option that uses the recipe */
  function recipeCost(prices, stone) {
    let s1 = 0, s2 = 0;
    for (const [k, , q1, q2] of RING_RECIPE.items) { const u = Math.max(0, Number(prices[k]) || 0); s1 += q1 * u; s2 += q2 * u; }
    const exp = s1 + RING_RECIPE.miss * s2;
    return { s1, s2, exp, total: exp + (stone ? RING_RECIPE.fee : 0) };
  }
  function defaultCmp(preset) {
    const r = ringOf(preset), pr = PRICE_SETS[r.server].prices;
    return [
      { name: 'Epic Pantheon artwork: +3 Wisdom, +3 Illusion', note: 'Wisdom is 0.1% Double Chance a point. Illusion is 0.1% cooldown reduction a point, and what that is worth depends on the filler strength under Model choices. Cost is a 20M Market price.', cost: 20000000, deltas: [{ stat: 'wisdom', amount: 3 }, { stat: 'illusion', amount: 3 }] },
      { name: 'One ring from item level 86 to 102, with a Philosopher’s Stone Attack line', note: `Attack: ${r.atk} from the item level with the ring at ${r.enh} (17 unenhanced, 26 at +10, 31 at +15, 33 at +17, 34 at +18, 37 at +20), plus 24 for the middle of the extra line’s 19 to 29 roll. The two Philosopher’s Stones are bound drops and are not priced.`, cost: recipeCost(pr, true).total, recipe: { stone: true }, deltas: [{ stat: 'atk', amount: r.atk + 24 }] },
      { name: 'The same ring without the extra Attack line', note: `Only the ${r.atk} Attack from the item level, at the same expected crafting cost.`, cost: recipeCost(pr, false).total, recipe: { stone: false }, deltas: [{ stat: 'atk', amount: r.atk }] }
    ];
  }
  /* the built-in comparison for a sheet: its ring and its server's prices */
  function autoCmp(b, preset) {
    const key = Z.PRESETS[preset] ? preset : Z.DEFAULT, r = ringOf(key);
    b.cmp = defaultCmp(key); b.ringServer = r.server; b.ringPrices = Object.assign({}, PRICE_SETS[r.server].prices); b.cmpFor = key; b.cmpAuto = true;
  }
  function defaults() {
    const b = {
      v: 9, preset: Z.DEFAULT, inputs: Object.assign({}, Z.PRESETS[Z.DEFAULT].values),
      steps: {}, chart: null,
      bind: { resetCost: 300000, tier: '86' },
      stone: { kind: 'superior', price: 5000, fee: 2000, lambda: 400000 },
      solver: { a: '', b: '', x: '' }
    };
    autoCmp(b, Z.DEFAULT);
    return b;
  }
  function merge(d) {
    const b = defaults();
    if (!d || [3, 4, 5, 6, 7, 8, 9].indexOf(d.v) < 0) return b;
    const old = d.v < 5; // before v5: typed-in numbers are kept, anything else moves to the current default sheet and comparison
    b.preset = Z.PRESETS[d.preset] ? d.preset : 'custom';
    Object.assign(b.inputs, d.inputs || {});
    if (old && b.preset !== 'custom') b.preset = Z.DEFAULT;
    // v7 reads the window's Attack the way Korean and Taiwanese tests show it (no Weapon Damage Boost, middle of the weapon range)
    // and adds base Attack, so a save made on a built-in sheet before that reloads the sheet's current values
    // v9 moves the Global targets to measured boss tolerance and Defense and adds flat skill damage, so a save made on a
    // built-in sheet before that reloads the sheet's current values as well
    if (d.v < 9 && b.preset !== 'custom') b.inputs = Object.assign({}, Z.PRESETS[b.preset].values);
    b.steps = d.steps && typeof d.steps === 'object' ? d.steps : {};
    b.chart = Array.isArray(d.chart) ? d.chart.filter((k) => STATS[k]) : null;
    Object.assign(b.bind, d.bind || {}); Object.assign(b.stone, d.stone || {}); Object.assign(b.solver, d.solver || {});
    // The comparison. While nobody has edited it, it follows the sheet: its ring and its server's prices, rebuilt from this
    // version's numbers. Once edited it is kept as saved. Saves from before v8 keep any option the user added and get the
    // built-in ones in their current form (the ring is now priced from its recipe).
    const builtIn = defaultCmp(b.preset).map((o) => o.name);
    autoCmp(b, d.v >= 8 && Z.PRESETS[d.cmpFor] ? d.cmpFor : b.preset);
    const keep = Array.isArray(d.cmp) && (d.v >= 8 ? d.cmpAuto === false : (!old && !d.cmp.every((o) => o && builtIn.indexOf(o.name) >= 0)));
    if (keep) {
      const fresh = b.cmp;
      b.cmpAuto = false;
      b.cmp = d.cmp.filter((o) => o && Array.isArray(o.deltas)).map((o) => {
        const f = d.v < 8 ? fresh.find((x) => x.name === o.name) : null;
        if (f) return f;
        const out = { name: String(o.name || ''), note: o.note ? String(o.note) : '', cost: o.cost, deltas: o.deltas.filter((x) => x && STATS[x.stat]) };
        if (o.recipe && typeof o.recipe === 'object') out.recipe = { stone: !!o.recipe.stone };
        return out;
      });
      if (PRICE_SETS[d.ringServer]) b.ringServer = d.ringServer;
      if (d.ringPrices && typeof d.ringPrices === 'object') for (const k in b.ringPrices) { const v = Number(d.ringPrices[k]); if (d.ringPrices[k] !== '' && isFinite(v) && v >= 0) b.ringPrices[k] = v; }
    }
    return b;
  }
  let st = defaults();
  let C = null; // last computed context

  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage can be unavailable */ } }, 400); }
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  /* ---------- the input rail ---------- */
  const F = {
    sheetAtk: { label: 'Attack in your character window', hint: 'The game\u2019s own number. It includes Attack Increase. Weapon Damage Boost and the Power Shard are not in it, and the weapon counts at the middle of its range.' },
    atkInc: { label: 'Attack Increase', unit: '%', hint: 'Gear lines, plus 0.1% per point of Might and Destruction.' },
    atkBonus: { label: 'Attack Bonus', hint: 'Daevanion, wings and titles.' },
    baseAtk: { label: 'Base Attack', hint: 'Attack you keep with no gear on that is not Attack Bonus: level, class and collections. To measure it, take all gear off, read Attack, divide by (1 + Attack Increase with gear off) and subtract Attack Bonus. The 237 in the built-in sheets comes from one level-45 Cleric.' },
    wdb: { label: 'Weapon Damage Boost', unit: '%' },
    rangeW: { label: 'Weapon range, max \u2212 min', hint: 'From the weapon tooltip. A Perfect hit uses the top of the range, half of this above the average.' },
    perfect: { label: 'Perfect Chance', unit: '%' },
    shard: { label: 'Power Shard', type: 'select', opts: [['0', 'Off'], ['5', 'Regular, 5%'], ['10', 'Superior, 10%']] },
    psdb: { label: 'Power Shard Damage Bonus', hint: 'Points on your sheet. Counted as 100 points = 1% on top of the shard, the mapping Grobs uses.' },
    db: { label: 'Damage Boost', unit: '%' },
    pveDb: { label: 'PvE Damage Boost', unit: '%' },
    bossDb: { label: 'Boss Damage Boost', unit: '%' },
    dbl: { label: 'Double Chance', unit: '%' },
    posDb: { label: 'Back or Front Damage Boost', unit: '%' },
    uptime: { label: 'Hits landed from that side', unit: '%' },
    combatSpeed: { label: 'Combat Speed', unit: '%' },
    cdr: { label: 'Cooldown Reduction', unit: '%', hint: '0.1% per point of Illusion, plus Daevanion and gear.' },
    multiHit: { label: 'Multi-hit Chance', unit: '%' },
    critMode: { label: 'Crit rate comes from', type: 'select', opts: [['rating', 'Rating minus resist'], ['manual', 'A rate I measured']] },
    critRating: { label: 'Critical Hit on your sheet' },
    critBuff: { label: 'Critical Hit from buffs and food', hint: 'For a Ranger: Marking Shot’s Precision and Bow of Blessing. Added flat.' },
    critChance: { label: 'Crit rate, measured', unit: '%', hint: 'From a damage meter, on this target.' },
    critDmg: { label: 'Critical Damage Boost', unit: '%' },
    target: { label: 'Preset', type: 'select', opts: [['dummy', Z.TARGETS.dummy.label], ['boss', Z.TARGETS.boss.label], ['t4g', Z.TARGETS.t4g.label], ['hardg', Z.TARGETS.hardg.label], ['ludra', Z.TARGETS.ludra.label], ['t4', Z.TARGETS.t4.label], ['kr', Z.TARGETS.kr.label], ['custom', 'Custom']] },
    tol: { label: 'Damage Tolerance', unit: '%', hint: 'Measured on Global at 58 to 68% for tier 4 Transcendence and Conquest [Hard]. Ludra is unpublished and takes 65. The solver under The formula measures it.' },
    dblRes: { label: 'Double Resist', unit: '%' },
    cdTol: { label: 'Critical Damage Tolerance', unit: '%' },
    critRes: { label: 'Critical Hit Resist', hint: 'Ludra: about 1,200 by player reports. Unpublished for other bosses.' },
    flatPve: { label: 'PvE Attack + Boss Attack' },
    flatPos: { label: 'Back or Front Attack' },
    flatCrit: { label: 'Critical Attack' },
    skillCoef: { label: 'Average skill coefficient', step: 0.05, hint: 'Fitted with the flat damage below to one Global Ranger\u2019s measured table. Other classes will differ.' },
    skillFlat: { label: 'Skill flat damage per use' },
    def: { label: 'Target Defense' },
    pen: { label: 'Your Penetration' },
    wTol: { label: 'Target Weapon Damage Tolerance', unit: '%' },
    partyDb: { label: 'Party Damage Boost', unit: '%' },
    partyDbl: { label: 'Party Double Chance', unit: '%' },
    partyCd: { label: 'Party Critical Damage', unit: '%' },
    gCrit: { label: 'Damage that always crits', unit: '%', hint: 'Guaranteed-crit skills and stagger windows.' },
    critCap: { label: 'Crit rate cap', unit: '%', hint: '50 on Global. Korea\u2019s client states 80.' },
    ccPer100: { label: 'Crit rate per 100 Critical Hit', unit: '%', hint: '10 on Global, from Ludra reports. Korean tests fit 6.67.' },
    dblModel: { label: 'Double Resist works by', type: 'select', opts: [['sub', 'Subtracting from chance'], ['mul', 'Scaling the chance down']] },
    mhModel: { label: 'Multi-hit model', type: 'select', opts: [['flat', 'One proc, fixed bonus (Global parses)'], ['chain', 'Chained hits (Korean figures)']], hint: 'Chained: each extra hit rolls your chance again, up to four, for +11%, +25%, +43% and +67% in total.' },
    mhBase: { label: 'Hidden Multi-hit chance', unit: '%', hint: 'Datamined weapon base on Global.' },
    mhBonus: { label: 'Extra damage per Multi-hit proc', unit: '%', hint: 'Global fights measure about 0.1% damage per 1% Multi-hit, which fits 11%.' },
    mhElig: { label: 'Damage that can Multi-hit', unit: '%', hint: 'Procs, damage over time and skills that already multi-hit cannot.' },
    mhPos: { label: 'Multi-hit applies', type: 'select', opts: [['out', 'To the whole hit'], ['in', 'Inside the Attack chain']] },
    pfHidden: { label: 'Hidden Perfect bonus', unit: '%', hint: 'Extra Pure Attack on a Perfect hit, beyond the top of the range. Korean tests put a Perfect hit about 8% above an average one, which 7 here reproduces.' },
    csEff: { label: 'Filler strength', unit: '%', hint: 'Filler share of damage ÷ filler share of cast time, from a meter. Combat Speed is worth this share of its ceiling and cooldown reduction gets the rest. 50 is an estimate from the Ranger’s skill coefficients.' },
    critInc: { label: 'Critical Hit increase', unit: '%', hint: '0.1% per point of Precision and Death, plus gear lines.' },
    deityPer: { label: 'Deity stat per point', type: 'select', opts: [['0.1', '0.1% (Global, and Korea since Nov 11, 2026)'], ['0.2', '0.2% (Korea before that patch)']] }
  };
  const GROUPS = [
    { id: 'g-attack', title: 'Attack', open: true, fields: ['sheetAtk', 'atkInc', 'atkBonus', 'baseAtk', 'wdb', 'rangeW', 'perfect', 'shard', 'psdb'] },
    { id: 'g-mult', title: 'Multipliers', open: true, fields: ['db', 'pveDb', 'bossDb', 'dbl', 'posDb', 'uptime', 'combatSpeed', 'cdr', 'multiHit'] },
    { id: 'g-crit', title: 'Critical hits', open: true, fields: ['critMode', 'critRating', 'critBuff', 'critChance', 'critDmg'] },
    { id: 'g-target', title: 'Target', open: true, hint: 'Community estimates. Change them if you have measured better.', fields: ['target', 'tol', 'dblRes', 'cdTol', 'critRes'] },
    { id: 'g-flat', title: 'Conditional flat Attack', hint: 'Added after Attack Increase, so Weapon Damage Boost and Attack Increase never touch it.', fields: ['flatPve', 'flatPos', 'flatCrit'] },
    { id: 'g-skill', title: 'Skill and Defense', fields: ['skillCoef', 'skillFlat', 'def', 'pen', 'wTol'] },
    { id: 'g-party', title: 'Party buffs', fields: ['partyDb', 'partyDbl', 'partyCd'] },
    { id: 'g-model', title: 'Model choices', hint: 'The disputed parts of the formula. Defaults follow the Global client.', fields: ['gCrit', 'critCap', 'ccPer100', 'dblModel', 'mhModel', 'mhBase', 'mhBonus', 'mhElig', 'mhPos', 'pfHidden', 'csEff'] },
    { id: 'g-points', title: 'Point conversions', fields: ['critInc', 'deityPer'] }
  ];
  const TARGET_KEYS = ['tol', 'dblRes', 'cdTol', 'wTol', 'def', 'critRes'];

  function fieldRow(id) {
    const f = F[id], fid = 'f-' + id;
    let ctl;
    if (f.type === 'select') {
      ctl = h('select', { id: fid }, f.opts.map(([v, t]) => h('option', { value: v, text: t })));
      ctl.addEventListener('change', () => onField(id, ctl.value));
    } else {
      ctl = h('input', { id: fid, type: 'number', inputmode: 'decimal', step: f.step || 'any' });
      ctl.addEventListener('input', () => onField(id, ctl.value === '' ? '' : Number(ctl.value)));
    }
    return h('div', { class: 'fld', id: 'row-' + id }, h('label', { for: fid, text: f.label }),
      h('span', { class: 'inp' }, ctl, f.type === 'select' ? null : h('span', { class: 'u', text: f.unit || '' })),
      f.hint ? h('p', { class: 'hint', text: f.hint }) : null);
  }
  function buildRail() {
    const host = $('railGroups');
    for (const g of GROUPS) {
      const body = h('div', { class: 'grp-body' }, g.hint ? h('p', { class: 'grp-hint', text: g.hint }) : null, g.fields.map(fieldRow));
      if (g.id === 'g-attack') body.append(h('p', { class: 'derived', id: 'derivedAtk' }));
      if (g.id === 'g-crit') body.append(h('p', { class: 'derived', id: 'derivedCrit' }));
      const d = h('details', { class: 'grp', id: g.id }, h('summary', null, g.title), body);
      if (g.open) d.open = true;
      host.append(d);
    }
    $('preset').replaceChildren(...Object.keys(Z.PRESETS).map((k) => h('option', { value: k, text: Z.PRESETS[k].label })), h('option', { value: 'custom', text: 'Your numbers' }));
    $('preset').addEventListener('change', () => {
      const v = $('preset').value;
      if (Z.PRESETS[v]) { st.inputs = Object.assign({}, Z.PRESETS[v].values); st.preset = v; if (st.cmpAuto) { autoCmp(st, v); buildCmp(); } syncRail(); schedule(); }
    });
    $('resetAll').addEventListener('click', () => { st = defaults(); syncAll(); buildCmp(); schedule(); });
  }
  function syncRail() {
    for (const id in F) { const n = $('f-' + id); if (n) { const v = st.inputs[id]; n.value = v == null ? '' : String(v); } }
    $('preset').value = st.preset; syncNote();
  }
  function syncNote() { $('railNote').textContent = Z.PRESETS[st.preset] ? Z.PRESETS[st.preset].note : 'Your own numbers. They stay in this browser.'; }
  function onField(id, val) {
    st.inputs[id] = val;
    if (id === 'target') {
      const t = Z.TARGETS[val];
      if (t) for (const k of TARGET_KEYS) if (t[k] != null) { st.inputs[k] = t[k]; $('f-' + k).value = t[k]; }
    } else if (TARGET_KEYS.indexOf(id) >= 0) { st.inputs.target = 'custom'; $('f-target').value = 'custom'; }
    st.preset = 'custom'; $('preset').value = 'custom'; syncNote();
    schedule();
  }

  /* ---------- compute ---------- */
  function compute() {
    const i = st.inputs, s = A.toState(i), p = A.toParams(i), P = A.parts(s, p);
    return { i, s, p, P, base: P.total, g: (stat, amt) => A.gain1(s, p, stat, amt, P.total) };
  }

  /* ---------- tooltip ---------- */
  const tip = $('tip');
  function showTip(nodes, x, y) {
    tip.replaceChildren(...nodes); tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    let lx = x + 14, ly = y + 16;
    if (lx + r.width > window.innerWidth - 8) lx = Math.max(8, x - r.width - 14);
    if (ly + r.height > window.innerHeight - 8) ly = Math.max(8, y - r.height - 14);
    tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
  }
  function hideTip() { tip.classList.remove('on'); }

  /* ---------- 1. ranking ---------- */
  const RANK = ['db', 'dbl', 'wdb', 'atkInc', 'combatSpeed', 'cooldown', 'posDb', 'critDmg', 'critHit', 'multiHit', 'perfect', 'atk', 'maxAtk', 'atkBonus', 'flatPve', 'flatPos', 'flatCrit', 'pen'];
  const rk = {};
  function stepOf(k) { const v = st.steps[k]; if (v === '') return 0; return v == null || !isFinite(v) ? STATS[k].step : Number(v); }

  function why(k, c, step) {
    const { s, p, P } = c, x = trim(step, 2), share = (v) => trim(v * 100, 1) + '%';
    switch (k) {
      case 'atk': return `${x} ÷ ${fmtN(P.Peff)} Pure Attack × ${share(P.sE)} of the hit`;
      case 'maxAtk': return `Half raises the average and Perfect (${fmtP(P.pf)}) uses all of it, so it acts as +${trim(step * (1 + P.pf) / 2, 1)} Pure Attack`;
      case 'atkBonus': return `${x} ÷ ${fmtN(P.T)} Attack before Attack Increase × ${share(P.sT)} of the hit`;
      case 'atkInc': return `${x} pt ÷ ${(1 + s.I).toFixed(2)} × ${share(P.sT)} of the hit`;
      case 'wdb': return `${x} pt ÷ ${(1 + P.wEff).toFixed(2)} × ${share(P.sE)} of the hit`;
      case 'flatPve': return `${x} ÷ ${fmtN(P.A0)} total Attack. Weapon Damage Boost and Attack Increase never touch it`;
      case 'flatPos': return `${x} ÷ ${fmtN(P.A0)} total Attack, on the ${fmtP(P.u)} of hits from that side`;
      case 'flatCrit': return `${x} ÷ ${fmtN(P.A0)} total Attack, on crits only (${fmtP(P.q)} of hits at ×${P.M.toFixed(2)})`;
      case 'db': return `${x} pt ÷ ${P.pool.toFixed(2)} pool`;
      case 'critDmg': return `${x} pt × ${fmtP(P.q)} crit rate ÷ ${P.critF.toFixed(3)}`;
      case 'critHit': return s.cc < 0 ? `Your rating is ${fmtN(-s.cc * 10000 / p.ccPer100)} under the target's Critical Hit Resist, and crits only start above it` : P.c >= p.cap - 1e-9 ? `You are at the ${fmtP(p.cap)} crit cap, so more rating adds nothing`
        : `${x} rating = +${trim(step * p.ccPer100 / 100, 2)} pt crit rate. Each pt × ${((1 - p.g) * (P.M - 1)).toFixed(2)} ÷ ${P.critF.toFixed(3)}`;
      case 'dbl': return `${x} pt ÷ ${P.dblMult.toFixed(2)}`;
      case 'posDb': return `${x} pt × ${fmtP(P.u)} of hits ÷ ${P.posF.toFixed(2)}`;
      case 'perfect': return p.pfHidden > 0 ? `${x} pt × (half the weapon range, ${trim(s.R / 2, 1)}, plus a ${fmtP(p.pfHidden)} bonus on ${fmtN(s.P)} Pure Attack)` : `${x} pt × half the weapon range (${trim(s.R / 2, 1)}) ÷ ${fmtN(P.Peff)} Pure Attack`;
      case 'multiHit': return p.mhModel === 'chain' ? `At ${fmtP(P.mhP)} a chained Multi-hit adds ${fmtP(P.mhAvg)} on average, and the next point adds more than the last` : `${x} pt × ${fmtP(p.mhBonus * p.mhElig)} per proc ÷ ${P.MH.toFixed(3)}`;
      case 'combatSpeed': return `${x} pt × ${fmtP(p.csEff)} filler strength ÷ ${(1 + s.cs).toFixed(2)}`;
      case 'cooldown': return `${x} pt ÷ ${fmtP(1 - P.cdr)} of each cooldown left × ${fmtP(1 - p.csEff)}, the share Combat Speed cannot reach`;
      case 'pen': return p.def > s.pen ? `Removes ${trim(Math.min(step, p.def - s.pen) / 10, 1)} damage from each skill use, before the multipliers`
        : 'Worth nothing until the target has Defense left after your Penetration';
    }
    return '';
  }
  function rowChips(k, c) {
    const { s, p, P } = c, out = [];
    if (k === 'critHit') out.push(s.cc < 0 ? chip('info', fmtN(-s.cc * 10000 / p.ccPer100) + ' under the target resist') : P.c >= p.cap - 1e-9 ? chip('info', 'at the ' + fmtP(p.cap) + ' cap') : chip('estimate', 'player-reported conversion'));
    if (k === 'multiHit') out.push(p.mhModel === 'chain' ? chip('estimate', 'Korean figures') : chip('disputed', 'disputed'));
    if (k === 'combatSpeed' || k === 'cooldown') out.push(chip('model', 'rotation model'));
    if (k === 'perfect') out.push(chip('estimate', p.pfHidden > 0 ? 'with hidden bonus' : 'range only'));
    if (k === 'db') out.push(chip('estimate', p.tol > 0 ? fmtG(A.gain1(s, Object.assign({}, p, { tol: 0 }), 'db', stepOf('db'))) + ' if the target has no tolerance' : 'rides on target tolerance'));
    if (k === 'pen' && p.def <= s.pen) out.push(chip('info', 'needs target Defense'));
    if ((k === 'posDb' || k === 'flatPos') && P.u <= 0) out.push(chip('info', 'no hits from that side'));
    return out;
  }
  function tipRank(k) {
    const step = stepOf(k);
    return [h('p', { class: 't-h', text: stepText(k, step) }), h('div', { class: 't-v', text: fmtG(C.g(k, step)) + ' damage' }), h('p', { text: why(k, C, step) })];
  }
  function buildRank() {
    const list = $('rkList');
    for (const k of RANK) {
      const stp = h('input', { type: 'number', id: 'step-' + k, step: 'any', min: 0, 'aria-label': 'Step for ' + nameOf(k) });
      stp.addEventListener('input', () => { st.steps[k] = stp.value === '' ? '' : Number(stp.value); schedule(); });
      const fill = h('div', { class: 'rk-fill' }), bar = h('div', { class: 'rk-bar' }, fill);
      const chips = h('span', { class: 'chips' }), val = h('div', { class: 'rk-val' });
      const row = h('div', { class: 'rk-row' },
        h('div', { class: 'rk-name' }, h('span', { class: 'rk-label', text: STATS[k].name }), chips),
        h('label', { class: 'rk-step' }, '+', stp, h('span', { class: 'u', text: unitOf(k) === '%' ? '%' : '' })),
        bar, val);
      row.addEventListener('pointermove', (e) => showTip(tipRank(k), e.clientX, e.clientY));
      row.addEventListener('pointerleave', hideTip);
      row.addEventListener('focusin', () => { const r = bar.getBoundingClientRect(); showTip(tipRank(k), r.left, r.bottom - 6); });
      row.addEventListener('focusout', hideTip);
      list.append(row);
      rk[k] = { row, stp, fill, bar, chips, val };
    }
  }
  function niceScale(max) {
    const steps = [0.0005, 0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
    let stp = steps[steps.length - 1];
    for (const x of steps) if (max / x <= 5) { stp = x; break; }
    const n = Math.max(1, Math.ceil(max / stp - 1e-9));
    return { stp, n, top: n * stp };
  }
  function renderRank(c) {
    const rows = RANK.map((k) => ({ k, step: stepOf(k), g: c.g(k, stepOf(k)) })).sort((a, b) => b.g - a.g);
    const sc = niceScale(Math.max(1e-6, rows[0].g));
    const ticks = $('rkTicks'); ticks.replaceChildren();
    for (let t = 0; t <= sc.n; t++) ticks.append(h('span', { style: `left:${(t / sc.n * 100).toFixed(3)}%`, text: t === 0 ? '0' : '+' + trim(t * sc.stp * 100, 2) + '%' }));
    rows.forEach((r, idx) => {
      const o = rk[r.k];
      o.row.style.order = idx;
      o.fill.style.width = (Math.max(0, r.g) / sc.top * 100).toFixed(2) + '%';
      o.bar.style.backgroundSize = (100 / sc.n).toFixed(4) + '% 100%';
      o.val.textContent = fmtG(r.g);
      o.row.classList.toggle('zero', r.g < 5e-6);
      o.chips.replaceChildren(...rowChips(r.k, c));
    });
    const a = rows[0], b = rows[1];
    $('heroV').replaceChildren(stepText(a.k, a.step) + ' adds ', h('b', { text: fmtG(a.g) }), ' damage');
    $('heroS').textContent = `Next: ${stepText(b.k, b.step)} at ${fmtG(b.g)}.`;
  }

  /* ---------- 2. stacking chart ---------- */
  const CH = ['db', 'dbl', 'wdb', 'atkInc', 'critDmg', 'posDb', 'combatSpeed', 'multiHit']; // fixed slot per stat: colour follows the stat
  const XMAX = 30;
  let chartData = null, chartGeo = null, hoverT = null;
  const colorOf = (k) => `var(--series-${CH.indexOf(k) + 1})`;
  function curves(c) {
    const out = {};
    for (const k of CH) {
      const arr = [];
      for (let t = 0; t <= XMAX; t++) { const s2 = A.applyDeltas(c.s, c.p, [{ stat: k, amount: t }]); arr.push(A.gain1(s2, c.p, k, 1)); }
      out[k] = arr;
    }
    return out;
  }
  function visibleKeys() {
    if (st.chart && st.chart.length) return CH.filter((k) => st.chart.indexOf(k) >= 0);
    const top = CH.slice().sort((a, b) => chartData[b][0] - chartData[a][0]).slice(0, 4);
    return CH.filter((k) => top.indexOf(k) >= 0);
  }
  const lg = {};
  function buildLegend() {
    const host = $('legend');
    for (const k of CH) {
      const b = h('button', { class: 'lg', type: 'button', style: `--c:${colorOf(k)}` }, h('span', { class: 'key', 'aria-hidden': 'true' }), nameOf(k));
      b.addEventListener('click', () => {
        const vis = visibleKeys(), i = vis.indexOf(k);
        if (i >= 0) { if (vis.length === 1) return; vis.splice(i, 1); } else vis.push(k);
        st.chart = vis; drawChart(); save();
      });
      host.append(b); lg[k] = b;
    }
  }
  function tipChart(t) {
    const vis = visibleKeys().slice().sort((a, b) => chartData[b][t] - chartData[a][t]);
    return [h('p', { class: 't-h', text: t === 0 ? 'Next +1% on your sheet as it is' : `Next +1% after adding ${t} points of that stat` })]
      .concat(vis.map((k) => h('div', { class: 't-row', style: `--c:${colorOf(k)}` }, h('span', { class: 'key' }), h('b', { text: fmtG(chartData[k][t]) }), h('span', { class: 'n', text: nameOf(k) }))));
  }
  function drawChart() {
    const wrap = $('chartWrap');
    if (!chartData) return;
    const vis = visibleKeys();
    for (const k of CH) lg[k].setAttribute('aria-pressed', vis.indexOf(k) >= 0 ? 'true' : 'false');
    const W = Math.max(280, Math.floor(wrap.clientWidth || 640)), H = 300;
    const direct = W >= 600 && vis.length <= 4;
    const m = { t: 14, r: direct ? 236 : 16, b: 44, l: 48 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    let max = 0; for (const k of vis) for (const v of chartData[k]) if (v > max) max = v;
    const sc = niceScale(Math.max(max, 1e-4));
    const X = (t) => m.l + t / XMAX * pw, Y = (v) => m.t + ph - v / sc.top * ph;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: 0,
      'aria-label': 'Line chart of the value of the next one percent of each stat as more of it is added. The same numbers are in the table below. Use the left and right arrow keys to read values.' });
    for (let i = 0; i <= sc.n; i++) {
      const y = Y(i * sc.stp);
      svg.append(sv('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, stroke: i === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
      svg.append(sv('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'ax-t' }, (i === 0 ? '0' : '+' + trim(i * sc.stp * 100, 2)) + '%'));
    }
    for (let t = 0; t <= XMAX; t += 5) svg.append(sv('text', { x: X(t), y: m.t + ph + 18, 'text-anchor': 'middle', class: 'ax-t' }, '+' + t));
    svg.append(sv('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'ax-title' }, 'Points of the same stat already added to your sheet'));
    for (const k of vis) {
      const d = chartData[k].map((v, t) => (t ? 'L' : 'M') + X(t).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
      svg.append(sv('path', { d, fill: 'none', stroke: colorOf(k), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    const ends = vis.map((k) => ({ k, v: chartData[k][XMAX], y: Y(chartData[k][XMAX]) })).sort((a, b) => a.y - b.y);
    let lastY = -99;
    for (const e of ends) {
      svg.append(sv('circle', { cx: X(XMAX), cy: e.y, r: 4.5, fill: colorOf(e.k), stroke: 'var(--surface)', 'stroke-width': 2 }));
      if (direct && e.y - lastY >= 15) {
        const tx = sv('text', { x: X(XMAX) + 11, y: e.y + 4 });
        tx.append(sv('tspan', { class: 'end-v' }, fmtG(e.v)), sv('tspan', { class: 'end-n', dx: 6 }, nameOf(e.k)));
        svg.append(tx); lastY = e.y;
      }
    }
    const cross = sv('g', { 'pointer-events': 'none', visibility: 'hidden' });
    const cl = sv('line', { y1: m.t, y2: m.t + ph, stroke: 'var(--ink-2)', 'stroke-width': 1 });
    cross.append(cl);
    const dots = {};
    for (const k of vis) { dots[k] = sv('circle', { r: 4.5, fill: colorOf(k), stroke: 'var(--surface)', 'stroke-width': 2 }); cross.append(dots[k]); }
    svg.append(cross);
    function setHover(t, cx, cy) {
      hoverT = t;
      if (t == null) { cross.setAttribute('visibility', 'hidden'); hideTip(); return; }
      cross.setAttribute('visibility', 'visible');
      cl.setAttribute('x1', X(t)); cl.setAttribute('x2', X(t));
      for (const k of vis) { dots[k].setAttribute('cx', X(t)); dots[k].setAttribute('cy', Y(chartData[k][t])); }
      if (cx == null) { const r = svg.getBoundingClientRect(); cx = r.left + X(t) * (r.width / W); cy = r.top + m.t + 10; }
      showTip(tipChart(t), cx, cy);
    }
    const tAt = (e) => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); return A.clamp(Math.round((px - m.l) / pw * XMAX), 0, XMAX); };
    svg.addEventListener('pointermove', (e) => setHover(tAt(e), e.clientX, e.clientY));
    svg.addEventListener('pointerleave', () => setHover(null));
    svg.addEventListener('focus', () => setHover(hoverT == null ? 0 : hoverT));
    svg.addEventListener('blur', () => setHover(null));
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); setHover(A.clamp((hoverT == null ? 0 : hoverT) + (e.key === 'ArrowRight' ? 1 : -1), 0, XMAX));
    });
    wrap.replaceChildren(svg);
    chartGeo = { W };
  }
  function renderStack(c) {
    chartData = curves(c);
    drawChart();
    const rows = CH.map((k) => ({ k, d: chartData[k], t10: c.g(k, 10), t20: c.g(k, 20) })).sort((a, b) => b.d[0] - a.d[0]);
    $('stackBody').replaceChildren(...rows.map((r) => h('tr', null,
      h('td', null, h('span', { class: 'lg-key', style: `display:inline-block;width:14px;border-top:3px solid ${colorOf(r.k)};border-radius:2px;vertical-align:middle;margin-right:8px`, 'aria-hidden': 'true' }), nameOf(r.k)),
      h('td', { class: 'r strong', text: fmtG(r.d[0]) }), h('td', { class: 'r', text: fmtG(r.d[10]) }), h('td', { class: 'r', text: fmtG(r.d[20]) }),
      h('td', { class: 'r', text: fmtG(r.t10) }), h('td', { class: 'r', text: fmtG(r.t20) }))));
  }

  /* ---------- 3. formula with numbers ---------- */
  function renderFormula(c) {
    const { i, s, p, P } = c;
    $('derivedAtk').replaceChildren('Pure Attack ', h('b', { text: fmtN(s.P) }), `, the part Weapon Damage Boost multiplies. That is ${fmtN(num(i.sheetAtk))} \u00f7 ${trim(1 + s.I, 3)} \u2212 ${fmtN(num(i.atkBonus))} Attack Bonus` + (num(i.baseAtk) ? ` \u2212 ${fmtN(num(i.baseAtk))} base` : '') + `. Check in game: with the Revelation Amulet off, Attack should still read ${fmtN(num(i.sheetAtk))}.`);
    { const fm = p.mhModel !== 'chain'; $('row-mhBase').hidden = !fm; $('row-mhBonus').hidden = !fm; }
    { const dc = $('derivedCrit'), have = num(i.critRating) + num(i.critBuff), res = num(i.critRes), net = have - res, manual = i.critMode === 'manual';
      $('row-critChance').hidden = !manual; $('row-critRating').hidden = manual; $('row-critBuff').hidden = manual;
      if (manual) dc.replaceChildren('Crit rate ', h('b', { text: fmtP(P.c) }), ', the rate you measured. Critical Hit and the target\u2019s resist are ignored.');
      else if (net < 0) dc.replaceChildren('Crit rate on this target ', h('b', { text: fmtP(P.c) }), `. Your ${fmtN(have)} Critical Hit is ${fmtN(-net)} short of its ${fmtN(res)} resist, and crits only start above that.`);
      else dc.replaceChildren('Crit rate on this target ', h('b', { text: fmtP(P.c) }), `. ${fmtN(have)} \u2212 ${fmtN(res)} resist = ${fmtN(net)} points, at 1% per ${trim(100 / p.ccPer100, 2)}` + (P.c >= p.cap - 1e-9 ? `, held at the ${fmtP(p.cap)} cap.` : '.')); }
    const perfAdd = P.Peff - s.P;
    const rows = [
      ['Pure Attack', fmtN(P.Peff), `${fmtN(num(i.sheetAtk))} \u00f7 ${trim(1 + s.I, 3)} \u2212 ${fmtN(s.AB)} = ${fmtN(s.P)}` + (perfAdd >= 0.5 ? `, plus ${fmtN(perfAdd)} from Perfect` : ''), 'atk', 10, chip('tested', 'tested')],
      ['Weapon Damage Boost', fmtX(1 + P.wEff), `1 + ${fmtP(s.w)}` + (p.wTol ? ` − ${fmtP(p.wTol)} tolerance` : ''), 'wdb', 1, chip('tested', 'tested')],
      ['Power Shard', fmtX(1 + s.sh), s.sh > 0 ? `1 + ${trim(num(i.shard))}% + ${trim(num(i.psdb))} points ÷ 100` : 'Off', null, 0, chip('estimate', 'bonus mapping is an estimate')],
      ['Attack Increase', fmtX(1 + s.I), `1 + ${fmtP(s.I)}`, 'atkInc', 1, chip('tested', 'tested')],
      ['Damage Boost pool', fmtX(P.pool), `1 + ${fmtP(s.db)} + ${fmtP(s.pve)} + ${fmtP(s.boss)}` + (p.pDb ? ` + ${fmtP(p.pDb)} party` : '') + ` − ${fmtP(p.tol)} tolerance`, 'db', 1, chip('estimate', 'target estimate')],
      ['Crit', fmtX(P.critF), `1 + ${fmtP(P.q)} × (0.5 + ${fmtP(s.cd + p.pCd)} − ${fmtP(p.cdTol)})`, 'critDmg', 1, chip('tested', 'tested')],
      ['Double', fmtX(P.dblMult), p.dblModel === 'mul' ? `1 + ${fmtP(P.dRaw)} × (1 − ${fmtP(p.dblRes)})` : `1 + ${fmtP(P.dRaw)} − ${fmtP(p.dblRes)} resist`, 'dbl', 1, chip('tested', 'tested')],
      ['Position', fmtX(P.posF), `1 + ${fmtP(s.fb)} × ${fmtP(P.u)} of hits`, 'posDb', 1, chip('tested', 'tested')],
      ['Multi-hit', fmtX(P.MH), (p.mhModel === 'chain' ? `1 + ${fmtP(P.mhAvg)}, the average of +11%, +25%, +43% and +67% for 1 to 4 extra hits at ${fmtP(P.mhP)} each` : `1 + ${fmtP(P.mhP)} chance × ${fmtP(p.mhBonus)} per proc`) + (p.mhElig < 1 ? ` × ${fmtP(p.mhElig)} eligible` : ''), 'multiHit', 1, p.mhModel === 'chain' ? chip('estimate', 'Korean figures') : chip('disputed', 'disputed')],
      ['Combat Speed', fmtX(1 + s.cs), `1 + ${fmtP(s.cs)}`, 'combatSpeed', 1, chip('model', 'rotation model')],
      ['Cooldown', fmtP(1 - P.cdr), `1 − ${fmtP(P.cdr)}, the part of each cooldown left`, 'cooldown', 1, chip('model', 'rotation model')]
    ];
    $('bucketBody').replaceChildren(...rows.map(([name, now, built, k, step, status]) => h('tr', null,
      h('td', { class: 'strong nw', text: name }), h('td', { class: 'r', text: now }), h('td', { class: 'mono', text: built }),
      h('td', { class: 'why' }, k ? [h('span', { class: 'strong', text: stepText(k, step) + ': ' }), why(k, c, step)] : 'Set by the shard you load, not by gear lines'),
      h('td', { class: 'r strong', text: k ? fmtG(c.g(k, step)) : '—' }), h('td', null, status))));
    $('shareNote').textContent = `${trim(P.sE * 100, 1)}% of your hit passes through Weapon Damage Boost and ${trim(P.sT * 100, 1)}% through Attack Increase. Attack Bonus and base Attack skip Weapon Damage Boost. Flat PvE or Boss Attack and skill flat damage skip both.`;

    // tolerance solver
    const a = Number(st.solver.a), b = Number(st.solver.b), x = Number(st.solver.x) / 100;
    const out = $('solverOut'), btn = $('solverApply');
    solvedTol = null;
    if (a > 0 && b > 0 && x && Math.abs(b / a - 1) > 1e-9) {
      const sum = s.db + s.pve + s.boss + p.pDb, tol = 1 + sum - x / (b / a - 1);
      const sane = tol > -0.05 && tol < 1.5;
      out.replaceChildren('Implied Damage Tolerance: ', h('b', { text: trim(tol * 100, 1) + '%' }), sane ? `. Your pool is ${(x / (b / a - 1)).toFixed(3)} on this target.` : '. That is outside any plausible range, so check that only Damage Boost changed between the two hits.');
      if (sane) solvedTol = Number((tol * 100).toFixed(1));
    } else out.textContent = 'Enter two average hits and the Damage Boost you added between them.';
    btn.hidden = solvedTol == null;
  }
  let solvedTol = null;

  /* ---------- 4. soul binding ---------- */
  const O_WG = { resets: 8, p: 0.032 }, O_WGDB = { resets: 15, p: 0.016 }, O_24 = { resets: 10, p: 0.024 }, O_DBL = { resets: 25, p: 0.0096 };
  const BIND = [
    ['Weapon', [['combatSpeed', 10.63, 12.29, O_WG], ['wdb', 7.87, 9.12, O_WG], ['db', 5.95, 6.91, O_WGDB], ['might', 21, 31], ['multiHit', 7.87, 9.12], ['flatCrit', 79, 97], ['flatPos', 79, 97]]],
    ['Guard', [['combatSpeed', 8.26, 9.57, O_WG], ['wdb', 6.3, 7.32, O_WG], ['db', 4.76, 5.54, O_WGDB], ['might', 16, 25]]],
    ['Helmet', [['dbl', 1.75, 2.08, O_DBL], ['atkInc', 1.75, 2.08], ['atk', 18, 28]]],
    ['Shoulders', [['dbl', 1.4, 1.68, O_DBL], ['critDmg', 10.5, 12.15, O_24], ['atk', 14, 23]]],
    ['Chest', [['db', 5.35, 6.22, O_24], ['perfect', 4.72, 5.5], ['atk', 22, 32]]],
    ['Gloves', [['combatSpeed', 5.9, 6.86], ['perfect', 2.75, 3.23], ['atk', 12, 21]]],
    ['Pants', [['atkInc', 1.92, 2.28], ['perfect', 4.33, 5.05], ['atk', 20, 30]]],
    ['Cape', [['dbl', 1.4, 1.68, O_DBL], ['atkInc', 1.4, 1.68], ['atk', 14, 23]]],
    ['Boots', [['perfect', 3.54, 4.14], ['atk', 16, 25]]],
    ['Necklace', [['combatSpeed', 3.54, 4.14], ['might', 10, 19], ['precision', 10, 19], ['atk', 25, 36]]],
    ['Earrings', [['might', 8, 16], ['precision', 8, 16], ['atk', 22, 32]]],
    ['Ring', [['might', 6, 14, null, 6, 14], ['precision', 6, 14, null, 6, 14], ['atk', 17, 27, null, 19, 29], ['critHit', 27, 38, null, 29, 40]]],
    ['Bracelet', [['time', 9, 17], ['wisdom', 9, 17], ['destruction', 9, 17], ['death', 9, 17]]]
  ];
  function renderBind(c) {
    const cost = num(st.bind.resetCost);
    const f = st.bind.tier === '102' ? 1.055 : 1;
    const scl = (k, v) => unitOf(k) === '%' ? Math.round(v * f * 100) / 100 : Math.round(v * f);
    const groups = BIND.map(([slot, lines]) => ({ slot, lines: lines.map(([k, lo0, hi0, odds, lo2, hi2]) => { const t2 = st.bind.tier === '102' && lo2 != null; const lo = t2 ? lo2 : scl(k, lo0), hi = t2 ? hi2 : scl(k, hi0); return { k, lo, hi, odds, gLo: c.g(k, lo), gHi: c.g(k, hi), gMid: c.g(k, (lo + hi) / 2) }; }).sort((a, b) => b.gHi - a.gHi) }));
    let max = 1e-6; for (const g of groups) for (const l of g.lines) if (l.gHi > max) max = l.gHi;
    const body = $('bindBody'); body.replaceChildren();
    for (const g of groups) g.lines.forEach((l, idx) => {
      const u = unitOf(l.k) === '%' ? '%' : '';
      const kin = l.odds ? l.odds.resets * cost : null;
      body.append(h('tr', { class: idx === 0 ? 'slot-first' : null },
        h('td', { class: 'slot', text: idx === 0 ? g.slot : '' }),
        h('td', { class: 'nw' + (idx === 0 ? ' strong' : ''), text: nameOf(l.k) }),
        h('td', { class: 'r', text: `${trim(l.lo)}${u} to ${trim(l.hi)}${u}` }),
        h('td', { class: 'mini-cell' }, h('span', { class: 'mini', style: `width:${(Math.max(0, l.gHi) / max * 46).toFixed(1)}px`, 'aria-hidden': 'true' }), h('span', { class: 'num lo', text: fmtG(l.gLo) + ' to ' }), h('span', { class: 'num', style: idx === 0 ? 'font-weight:600' : null, text: fmtG(l.gHi) })),
        h('td', { class: 'r', text: l.odds ? String(l.odds.resets) : '—' }),
        h('td', { class: 'r', text: kin != null ? fmtK(kin) : '—' }),
        h('td', { class: 'r', text: kin != null && l.gMid > 0 ? fmtK(kin / (l.gMid * 100)) : '—' })));
    });
  }

  /* ---------- 5. manastones ---------- */
  function envelope(rules) {
    const L = [{ a: 0, b: 0, rule: null }].concat(rules.map((r) => ({ a: r.eGain * 100, b: r.kinah, rule: r }))).sort((x, y) => x.a - y.a || x.b - y.b);
    const xi = (l1, l2) => (l2.b - l1.b) / (l2.a - l1.a);
    const hull = [];
    for (const l of L) {
      if (hull.length && Math.abs(hull[hull.length - 1].a - l.a) < 1e-12) continue;
      while (hull.length >= 2 && xi(hull[hull.length - 2], l) <= xi(hull[hull.length - 2], hull[hull.length - 1])) hull.pop();
      if (hull.length === 1 && l.b <= hull[0].b) hull.pop();
      hull.push(l);
    }
    return hull.map((l, i) => ({ rule: l.rule, lo: i === 0 ? 0 : xi(hull[i - 1], l), hi: i === hull.length - 1 ? Infinity : xi(l, hull[i + 1]) }));
  }
  function keepText(outs, th) {
    const common = {}, tops = {}; let rare = false;
    for (const o of outs) {
      if (!o.stat) continue;
      tops[o.label] = Math.max(tops[o.label] || 0, o.value);
      if (o.gain <= 0 || o.gain < th - 1e-15) continue;
      if (o.prob >= 0.01) common[o.label] = Math.min(common[o.label] == null ? Infinity : common[o.label], o.value); else rare = true;
    }
    const parts = Object.keys(common).map((label) => `${label} ${trim(common[label])}${common[label] < tops[label] ? ' or better' : ''}`);
    if (rare) parts.push(`any boost line worth ${fmtG(th)} or more`);
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' or ' + parts[parts.length - 1] : parts.join('');
  }
  function renderStone(c) {
    const kind = A.STONES[st.stone.kind] ? st.stone.kind : 'superior';
    const cost = num(st.stone.price) + num(st.stone.fee), lam = num(st.stone.lambda);
    const outs = A.stoneOutcomes(c.s, c.p, kind);
    const dmgOuts = outs.filter((o) => o.stat).sort((a, b) => b.gain - a.gain);
    let max = 1e-6; for (const o of dmgOuts) if (o.gain > max) max = o.gain;
    $('stoneOutBody').replaceChildren(...dmgOuts.map((o) => h('tr', null,
      h('td', { text: o.label }), h('td', { class: 'r', text: '+' + trim(o.value) + (o.unit.trim() === '%' ? '%' : '') }),
      h('td', { class: 'r', text: trim(o.prob * 100, 3) + '%' }), h('td', { class: 'r', text: fmtN(1 / o.prob) }),
      h('td', { class: 'mini-cell' }, h('span', { class: 'mini', style: `width:${(Math.max(0, o.gain) / max * 84).toFixed(1)}px`, 'aria-hidden': 'true' }), h('span', { class: 'num', text: fmtG(o.gain) })))));
    const dead = outs.find((o) => !o.stat);
    $('stoneNote').textContent = `${trim(dead.prob * 100, 2)}% of engraves land a line with no damage value here: Defense, HP, MP, Accuracy, Evasion, Block or Critical Hit Resist. Odds are the Global client's, as read by MetaBot. Critical Hit is priced with the crit conversion in the rail and is worth nothing at the crit cap.`;
    const { rules } = A.stoneRules(outs, cost, lam, 0.01);
    const env = envelope(rules).filter((e) => e.rule);
    const body = $('stoneRuleBody'); body.replaceChildren();
    let active = null;
    for (const e of env) {
      const on = lam >= e.lo && lam < e.hi; if (on) active = e;
      body.append(h('tr', { class: on ? 'best' : null },
        h('td', { class: 'num', style: 'white-space:nowrap', text: isFinite(e.hi) ? `${fmtK(e.lo)} to ${fmtK(e.hi)}` : `${fmtK(e.lo)} and up` }),
        h('td', { text: keepText(outs, e.rule.threshold) }),
        h('td', { class: 'r', text: trim(e.rule.engraves, 1) }),
        h('td', { class: 'r', text: fmtK(e.rule.kinah) }), h('td', { class: 'r strong', text: fmtG(e.rule.eGain) })));
    }
    if (!env.length) body.append(h('tr', null, h('td', { colspan: 5, class: 'dim', text: 'No line in this stone adds damage on your sheet.' })));
    const sum = $('stoneSummary');
    if (active) sum.replaceChildren(`At ${fmtK(lam)} Kinah per +1% damage and ${fmtK(cost)} per engrave, keep rolling a slot until it shows `, h('b', { text: keepText(outs, active.rule.threshold) }), `. Expect about ${trim(active.rule.engraves, 1)} engraves and ${fmtK(active.rule.kinah)} Kinah per slot, for ${fmtG(active.rule.eGain)} damage on average.`);
    else if (env.length) sum.textContent = `At ${fmtK(lam)} Kinah per +1% damage, engraving costs more than it returns. It starts to pay once +1% is worth ${fmtK(env[0].lo)} Kinah to you.`;
    else sum.textContent = 'This stone has no damage line that helps your sheet.';
  }

  /* ---------- 6. points ---------- */
  function renderPoints(c) {
    const per = trim(c.p.deityPer, 2) + '%';
    const defs = [
      ['might', '+0.1% Attack Increase'], ['destruction', `+${per} Attack Increase`], ['wisdom', `+${per} Double Chance`], ['time', `+${per} Combat Speed`], ['illusion', `−${per} cooldown`],
      ['precision', '+0.1% of your Critical Hit rating, and the same for Accuracy'], ['death', `+${per} of your Critical Hit rating`], ['justice', `+${per} Perfect Chance`]
    ].map(([k, gives]) => ({ k, gives, g1: c.g(k, 1), g10: c.g(k, 10) })).sort((a, b) => b.g1 - a.g1);
    const max = Math.max(1e-7, defs[0].g1);
    $('ptsBody').replaceChildren(...defs.map((d) => h('tr', null,
      h('td', { class: 'strong', text: STATS[d.k].name }), h('td', { text: d.gives }),
      h('td', { class: 'mini-cell' }, h('span', { class: 'mini', style: `width:${(Math.max(0, d.g1) / max * 84).toFixed(1)}px`, 'aria-hidden': 'true' }), h('span', { class: 'num', text: fmtG(d.g1) })),
      h('td', { class: 'r', text: fmtG(d.g10) }))));
  }

  /* ---------- 7. compare ---------- */
  let cmpRefs = [];
  const statOptions = () => Object.keys(STATS).map((k) => h('option', { value: k, text: STATS[k].name + (unitOf(k) === '%' ? ' (%)' : unitOf(k) === 'pt' ? ' (points)' : '') }));

  /* every step of the formula that an option moves: [label, before, after, effect, sub-row?] */
  function mathRows(c, deltas) {
    const s0 = c.s, p = c.p, a = c.P;
    const s1 = A.applyDeltas(s0, p, deltas), b = A.parts(s1, p);
    const ne = (x, y) => Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    const rows = [];
    const add = (label, before, after, effect, sub) => rows.push({ label, before, after, effect: effect || '', sub: !!sub });
    const mv = (x0, x1, d) => (ne(x0, x1) ? `${trim(x0, d)} → ${trim(x1, d)}` : trim(x0, d));
    const signed = (x) => (x >= 0 ? '+' : '−') + trim(Math.abs(x), 1);
    if (ne(a.A0, b.A0)) {
      add('Pure Attack, the Attack on your gear', fmt1(s0.P), fmt1(s1.P), ne(s0.P, s1.P) ? signed(s1.P - s0.P) : '', true);
      if (ne(a.Peff, s0.P) || ne(b.Peff, s1.P)) {
        add(`Perfect hits averaged in: + ${mv(s0.pf * 100, s1.pf * 100, 2)}% of half the weapon range (${mv(s0.R / 2, s1.R / 2, 1)})` + (p.pfHidden > 0 ? `, then × ${mv(1 + s0.pf * p.pfHidden, 1 + s1.pf * p.pfHidden, 4)}` : ''), fmt1(a.Peff), fmt1(b.Peff), '', true);
      }
      add(`× ${mv(1 + a.wEff, 1 + b.wEff, 3)} Weapon Damage Boost × ${mv(1 + s0.sh, 1 + s1.sh, 4)} Power Shard` + (p.mhPos === 'in' ? ` × ${mv(a.MH, b.MH, 3)} Multi-hit` : ''), fmt1(a.E), fmt1(b.E), '', true);
      add(`+ ${mv(s0.AB, s1.AB, 0)} Attack Bonus and base Attack`, fmt1(a.T), fmt1(b.T), '', true);
      add(`× ${mv(1 + s0.I, 1 + s1.I, 3)} Attack Increase`, fmt1(a.T * (1 + s0.I)), fmt1(b.T * (1 + s1.I)), '', true);
      add(`+ ${mv(s0.fAlways, s1.fAlways, 0)} PvE and Boss Attack`, fmt1(a.A0), fmt1(b.A0), '', true);
    }
    if (ne(s0.fPos, s1.fPos)) add(`Back or Front Attack, on ${fmtP(a.u)} of hits`, fmt1(s0.fPos), fmt1(s1.fPos), '', true);
    if (ne(s0.fb, s1.fb)) add(`Back or Front Damage Boost, on ${fmtP(a.u)} of hits`, fmtP(s0.fb), fmtP(s1.fb), '', true);
    if (ne(a.q, b.q)) add('Crit rate', fmtP(a.q), fmtP(b.q), '', true);
    if (ne(s0.fCrit, s1.fCrit)) add('Critical Attack, on crits', fmt1(s0.fCrit), fmt1(s1.fCrit), '', true);
    if (ne(a.M, b.M)) add('Crit multiplier, 1.5 + Critical Damage Boost', fmtX(a.M), fmtX(b.M), '', true);
    if (ne(a.D, b.D)) add('Damage each hit loses to Defense', fmt1(a.D), fmt1(b.D), '', true);
    if (ne(a.e, b.e)) {
      // name only the terms that are in play on this sheet, so the row can be checked by hand
      const pos = [], parts = [];
      if (s0.fPos > 0 || s1.fPos > 0) pos.push(`+ ${mv(s0.fPos, s1.fPos, 0)} Attack`);
      if (s0.fb > 0 || s1.fb > 0) pos.push(`× ${mv(1 + s0.fb, 1 + s1.fb, 4)} damage`);
      if (a.u > 0 && pos.length) parts.push(`${pos.join(' and ')} from Back or Front on ${fmtP(a.u)} of hits`);
      if (a.q > 0 || b.q > 0) parts.push(`crits on ${mv(a.q * 100, b.q * 100, 2)}% of hits at ×${mv(a.M, b.M, 3)}` + (s0.fCrit > 0 || s1.fCrit > 0 ? ` with + ${mv(s0.fCrit, s1.fCrit, 0)} Critical Attack` : ''));
      if (a.D > 0 || b.D > 0) parts.push(`− ${mv(a.D, b.D, 1)} lost to Defense`);
      if (p.k !== 1 || p.S > 0) parts.push('the skill’s coefficient and flat damage');
      add('Average hit' + (parts.length ? ': ' + parts.join(', ') : ''), fmt1(a.e), fmt1(b.e), fmtG4(b.e / a.e - 1));
    }
    if (ne(a.pool, b.pool)) add('Damage Boost pool, 1 + every boost − target tolerance', fmtX(a.pool), fmtX(b.pool), fmtG4(b.pool / a.pool - 1));
    if (ne(a.dblMult, b.dblMult)) {
      add('Double Chance' + (p.dblRes > 0 ? ', after the target’s resist' : ''), fmtP(a.dEff), fmtP(b.dEff), '', true);
      add('Double, 1 + chance', fmtX(a.dblMult), fmtX(b.dblMult), fmtG4(b.dblMult / a.dblMult - 1));
    }
    if (ne(a.rot, b.rot)) {
      const cdCh = ne(a.cdr, b.cdr), csCh = ne(s0.cs, s1.cs);
      if (csCh) {
        add('Combat Speed', fmtP(s0.cs), fmtP(s1.cs), '', true);
        add(`Every cast is faster by (1 + ${fmtP(s1.cs)}) ÷ (1 + ${fmtP(s0.cs)}) − 1`, '', fmtG4((1 + s1.cs) / (1 + s0.cs) - 1), '', true);
      }
      if (cdCh) {
        add('Cooldown Reduction', fmtP(a.cdr), fmtP(b.cdr), '', true);
        add(`Cooldown skills come up more often by (1 − ${fmtP(a.cdr)}) ÷ (1 − ${fmtP(b.cdr)}) − 1`, '', fmtG4((1 - a.cdr) / (1 - b.cdr) - 1), '', true);
      }
      const lab = cdCh && csCh ? `Rotation: ${fmtP(p.csEff)} of the cast speed gain + ${fmtP(1 - p.csEff)} of the cooldown gain`
        : cdCh ? `Rotation: cooldown skills are ${fmtP(1 - p.csEff)} of damage, so ${fmtP(1 - p.csEff)} of that`
        : `Rotation: time saved goes to fillers, worth ${fmtP(p.csEff)} of an average second, so ${fmtP(p.csEff)} of that`;
      add(lab, '', '', fmtG4(b.rot / a.rot - 1));
    }
    if (p.mhPos === 'out' && ne(a.MH, b.MH)) {
      add('Multi-hit Chance', fmtP(a.mhP), fmtP(b.mhP), '', true);
      add('Multi-hit', fmtX(a.MH), fmtX(b.MH), fmtG4(b.MH / a.MH - 1));
    }
    return { rows, ratio: a.total > 0 ? b.total / a.total : 1 };
  }

  function buildCmp() {
    const host = $('cmpList'); host.replaceChildren(); cmpRefs = [];
    st.cmp.forEach((o, idx) => {
      const name = h('input', { type: 'text', id: `cmp-name-${idx}`, 'aria-label': 'Option name' }); name.value = o.name;
      const note = o.note ? h('p', { class: 'cmp-note', text: o.note }) : null;
      name.addEventListener('input', () => { st.cmpAuto = false; o.name = name.value; if (o.note) { o.note = ''; note.remove(); } schedule(); });
      const g = h('div', { class: 'g' }), kk = h('div', { class: 'k' });
      const lines = h('div', { class: 'cmp-lines' });
      o.deltas.forEach((d, j) => {
        const sel = h('select', { id: `cmp-${idx}-s${j}`, 'aria-label': 'Stat' }, statOptions()); sel.value = d.stat;
        const amt = h('input', { type: 'number', id: `cmp-${idx}-a${j}`, step: 'any', 'aria-label': 'Amount, negative to remove' }); amt.value = d.amount;
        sel.addEventListener('change', () => { st.cmpAuto = false; d.stat = sel.value; schedule(); });
        amt.addEventListener('input', () => { st.cmpAuto = false; d.amount = amt.value === '' ? '' : Number(amt.value); schedule(); });
        lines.append(h('div', { class: 'cmp-line' }, sel, amt,
          o.deltas.length > 1 ? h('button', { class: 'btn sm', type: 'button', text: 'Remove', onclick: () => { st.cmpAuto = false; o.deltas.splice(j, 1); buildCmp(); schedule(); } }) : null));
      });
      const foot = h('div', { class: 'cmp-foot' },
        h('button', { class: 'btn sm', type: 'button', text: 'Add a stat', onclick: () => { st.cmpAuto = false; o.deltas.push({ stat: 'atk', amount: 10 }); buildCmp(); schedule(); } }));
      let rc = null, recipeBox = null;
      if (o.recipe) {
        rc = { cells: {}, s1: h('td', { class: 'r' }), s2: h('td', { class: 'r' }), exp: h('td', { class: 'r', colspan: 2 }), total: h('td', { class: 'r', colspan: 2 }) };
        const body = h('tbody'), full = !cmpRefs.some((x) => x.rc);
        if (full) for (const [k, label, q1, q2] of RING_RECIPE.items) {
          const inp = h('input', { type: 'number', id: `cmp-${idx}-p-${k}`, min: 0, step: 'any', 'aria-label': `${label}, price each` }); inp.value = st.ringPrices[k];
          inp.addEventListener('input', () => { st.cmpAuto = false; st.ringPrices[k] = inp.value === '' ? 0 : Number(inp.value); schedule(); });
          const c1 = h('td', { class: 'r' }), c2 = h('td', { class: 'r' });
          rc.cells[k] = [c1, c2, q1, q2];
          body.append(h('tr', null, h('td', { text: label }), h('td', { class: 'r' }, inp), c1, c2));
        }
        body.append(h('tr', { class: 'sum' }, h('td', { colspan: 2, text: full ? 'Each step' : 'Each step, at the material prices in the option above' }), rc.s1, rc.s2));
        body.append(h('tr', { class: 'sum' }, h('td', { colspan: 2, text: 'Expected craft: step 1 + 75% × step 2. One craft in four lands on item level 102 and skips step 2.' }), rc.exp));
        if (o.recipe.stone) body.append(h('tr', { class: 'sum' }, h('td', { colspan: 2, text: 'With the 1M Philosopher’s Stone fee' }), rc.total));
        recipeBox = h('div', { class: 'cmp-block' },
          h('h3', { text: 'What it costs' }),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'cmp-tbl recipe' },
            h('thead', null, h('tr', null, h('th', { text: full ? 'Material' : 'Ring craft' }), h('th', { class: 'r', text: full ? 'Price each' : '' }), h('th', { class: 'r', text: 'Step 1: 86 to 94' }), h('th', { class: 'r', text: 'Step 2: 94 to 102' }))),
            body)),
          full ? (rc.src = h('p', { class: 'cmp-note' })) : null,
          h('p', { class: 'cmp-ctl' }, h('button', { class: 'btn sm', type: 'button', text: 'Use one flat cost instead', onclick: () => { st.cmpAuto = false; o.cost = Math.round(recipeCost(st.ringPrices, o.recipe.stone).total); delete o.recipe; buildCmp(); schedule(); } })));
      } else {
        const cost = h('input', { type: 'number', id: `cmp-cost-${idx}`, min: 0, step: 'any', placeholder: 'optional' }); cost.value = o.cost == null ? '' : o.cost;
        cost.addEventListener('input', () => { st.cmpAuto = false; o.cost = cost.value === '' ? '' : Number(cost.value); schedule(); });
        foot.append(h('label', { for: `cmp-cost-${idx}` }, 'Cost in Kinah', cost));
      }
      foot.append(h('button', { class: 'btn sm', type: 'button', text: 'Remove option', onclick: () => { st.cmpAuto = false; st.cmp.splice(idx, 1); buildCmp(); schedule(); } }));
      const mathBody = h('tbody');
      const mathBox = h('div', { class: 'cmp-block' },
        h('h3', { text: 'The math' }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'cmp-tbl' },
          h('thead', null, h('tr', null, h('th', { text: 'Step' }), h('th', { class: 'r', text: 'Before' }), h('th', { class: 'r', text: 'After' }), h('th', { class: 'r', text: 'Effect' }))),
          mathBody)));
      host.append(h('div', { class: 'cmp' },
        h('div', { class: 'cmp-top' }, name, h('div', { class: 'cmp-res' }, g, kk)),
        note, lines, foot, recipeBox, mathBox));
      cmpRefs.push({ o, g, kk, rc, mathBody });
    });
  }
  function renderCmp(c) {
    const res = [];
    for (const r of cmpRefs) {
      if (r.rc) {
        const k = recipeCost(st.ringPrices, r.o.recipe.stone);
        for (const key in r.rc.cells) {
          const [c1, c2, q1, q2] = r.rc.cells[key], u = Math.max(0, Number(st.ringPrices[key]) || 0);
          c1.textContent = q1 ? `${q1} × ${fmtK(u)} = ${fmtK(q1 * u)}` : '–';
          c2.textContent = q2 ? `${q2} × ${fmtK(u)} = ${fmtK(q2 * u)}` : '–';
        }
        r.rc.s1.textContent = fmtK(k.s1); r.rc.s2.textContent = fmtK(k.s2);
        r.rc.exp.textContent = `${fmtK(k.s1)} + 75% × ${fmtK(k.s2)} = ${fmtK(k.exp)}`;
        r.rc.total.textContent = `${fmtK(k.exp)} + 1M = ${fmtK(k.total)}`;
        r.o.cost = Math.round(k.total);
        if (r.rc.src) {
          const set = PRICE_SETS[st.ringServer], same = set && Object.keys(set.prices).every((key) => Number(st.ringPrices[key]) === set.prices[key]);
          r.rc.src.textContent = same ? `Prices are ${set.label} lowest asks on Kinah Ledger, read ${PRICE_DATE}. Type your own server’s over them.` : 'Prices as typed.';
        }
      }
      const m = mathRows(c, r.o.deltas.map((d) => ({ stat: d.stat, amount: Number(d.amount) || 0 })));
      const gain = m.ratio - 1;
      r.g.textContent = fmtG(gain) + ' damage';
      const cost = Number(r.o.cost);
      const per = cost > 0 && gain > 0 ? cost / (gain * 100) : null;
      r.kk.textContent = cost > 0 ? (gain > 0 ? fmtK(per) + ' Kinah per +1%' : 'no gain to price') : 'add a cost to price it';
      const trs = m.rows.map((x) => h('tr', { class: x.sub ? 'sub' : null }, h('td', { text: x.label }), h('td', { class: 'r', text: x.before }), h('td', { class: 'r', text: x.after }), h('td', { class: 'r', text: x.effect })));
      if (!m.rows.length) trs.push(h('tr', null, h('td', { colspan: 4, class: 'dim', text: 'Nothing in the formula moves.' })));
      const effects = m.rows.filter((x) => x.effect && !x.sub).length;
      trs.push(h('tr', { class: 'sum' }, h('td', { colspan: 3, text: effects > 1 ? 'Damage: the effects compounded, (1 + a) × (1 + b) − 1' : 'Damage' }), h('td', { class: 'r', text: fmtG4(gain) })));
      if (per != null) trs.push(h('tr', { class: 'sum' }, h('td', { colspan: 3, text: `Kinah per 1% damage: ${fmtN(cost)} ÷ ${(gain * 100).toFixed(4)}` }), h('td', { class: 'r', text: fmtK(per) })));
      r.mathBody.replaceChildren(...trs);
      res.push({ name: r.o.name || 'Unnamed option', gain, cost: cost > 0 ? cost : null, per });
    }
    // summary table
    const best = res.filter((r) => r.per != null).sort((x, y) => x.per - y.per)[0];
    $('cmpSumBody').replaceChildren(...res.map((r) => h('tr', { class: best && r === best && res.filter((x) => x.per != null).length > 1 ? 'best' : null },
      h('td', { class: 'strong', text: r.name }),
      h('td', { class: 'r', text: r.cost != null ? fmtN(r.cost) : '–' }),
      h('td', { class: 'r', text: fmtG4(r.gain) }),

      h('td', { class: 'r strong', text: r.per != null ? fmtK(r.per) : '–' }))));
    $('cmpSumWrap').hidden = !res.length;
    const i = c.i, lab = st.preset === 'custom' ? 'Your numbers' : Z.PRESETS[st.preset].label;
    $('cmpSheet').textContent = `Priced on ${lab}: Pure Attack ${fmtN(c.s.P)}, Attack Bonus and base Attack ${fmtN(c.s.AB)}, Weapon Damage Boost ${fmtP(c.s.w)}, Attack Increase ${fmtP(c.s.I)}, PvE and Boss Attack ${fmtN(c.s.fAlways)}, Double Chance ${fmtP(c.s.dbl)}, Cooldown Reduction ${fmtP(c.P.cdr)}, filler strength ${fmtP(c.p.csEff)}.`;
    const v = $('cmpVerdict'), byGain = res.slice().sort((a, b) => b.gain - a.gain);
    if (byGain.length < 2 || !(byGain[0].gain > 0)) { v.hidden = true; return; }
    v.hidden = false;
    const top = byGain[0], nxt = byGain[1], out = ['Biggest gain: ', h('b', { text: top.name }), `, ${fmtG(top.gain)}.`];
    if (nxt.gain > 0) out.push(` That is ${trim(top.gain / nxt.gain, 1)} times the next option (${fmtG(nxt.gain)}).`);
    const priced = res.filter((r) => r.per != null).sort((a, b) => a.per - b.per);
    if (priced.length >= 2) out.push(' Cheapest per 1%: ', h('b', { text: priced[0].name }), `, ${fmtK(priced[0].per)} Kinah.`);
    v.replaceChildren(...out);
  }

  /* ---------- wiring for the non-rail controls ---------- */
  function bindCtl(id, obj, key, isSelect) {
    const n = $(id);
    n.addEventListener(isSelect ? 'change' : 'input', () => { obj()[key] = isSelect ? n.value : (n.value === '' ? '' : Number(n.value)); schedule(); });
  }
  function syncAll() {
    syncRail();
    for (const k of RANK) rk[k].stp.value = st.steps[k] === '' ? '' : stepOf(k);
    $('bindReset').value = st.bind.resetCost; $('bindTier').value = st.bind.tier === '102' ? '102' : '86';
    $('stoneKind').value = st.stone.kind; $('stonePrice').value = st.stone.price; $('stoneFee').value = String(st.stone.fee); $('stoneLambda').value = st.stone.lambda;
    $('solverA').value = st.solver.a; $('solverB').value = st.solver.b; $('solverX').value = st.solver.x;
  }

  function render() {
    C = compute();
    renderRank(C); renderStack(C); renderFormula(C); renderBind(C); renderStone(C); renderPoints(C); renderCmp(C);
    save();
  }

  function start(data) {
    let loaded = null;
    if (data && [3, 4, 5, 6, 7, 8, 9].indexOf(data.v) >= 0) loaded = data;
    else { try { loaded = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { loaded = null; } }
    st = merge(loaded);
    buildRail(); buildRank(); buildLegend(); buildCmp();
    bindCtl('bindReset', () => st.bind, 'resetCost'); bindCtl('bindTier', () => st.bind, 'tier', true);
    bindCtl('stoneKind', () => st.stone, 'kind', true); bindCtl('stonePrice', () => st.stone, 'price');
    bindCtl('stoneFee', () => st.stone, 'fee', true); bindCtl('stoneLambda', () => st.stone, 'lambda');
    bindCtl('solverA', () => st.solver, 'a'); bindCtl('solverB', () => st.solver, 'b'); bindCtl('solverX', () => st.solver, 'x');
    $('solverApply').addEventListener('click', () => { if (solvedTol == null) return; st.inputs.tol = solvedTol; $('f-tol').value = solvedTol; onField('tol', solvedTol); });
    $('cmpAdd').addEventListener('click', () => { st.cmpAuto = false; st.cmp.push({ name: 'New option', cost: '', deltas: [{ stat: 'dbl', amount: 1 }] }); buildCmp(); schedule(); });
    syncAll();
    render();
    if (window.ResizeObserver) new ResizeObserver(() => { const w = Math.floor($('chartWrap').clientWidth); if (chartGeo && Math.abs(w - chartGeo.W) > 1) drawChart(); }).observe($('chartWrap'));
    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => st);
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
