/* Aion 2 Genus Boards: everything on screen. The maths lives in genus.js (A2G) and Damage Math's model.js (A2). */
(function () {
  'use strict';
  const A = window.A2, Z = window.A2P, G = window.A2G, LINES = G.LINES;
  const KEY = 'aion2-genus-v1', MATH_KEY = 'aion2-damage-math-v3', DEFAULT = 'paroxysmal';
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
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  /* ---------- formatting ---------- */
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const fmtN = (x) => nf0.format(Math.round(x));
  const trim = (v, d = 2) => String(Number(Number(v).toFixed(d)));
  const round3 = (x) => { if (!(x > 0)) return 0; const m = Math.pow(10, Math.max(0, Math.floor(Math.log10(x)) - 2)); return Math.round(x / m) * m; };
  const fmtC = (x) => fmtN(round3(x));
  function fmtK(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return trim(n / 1e9, 2) + 'B';
    if (a >= 1e6) return trim(n / 1e6, 1) + 'M';
    if (a >= 1e4) return trim(n / 1e3, 0) + 'K';
    return fmtN(n);
  }
  const fmtG = (x) => '+' + x.toFixed(x < 0.995 ? 2 : 1) + '%';
  function fmtWeeks(w) {
    if (!isFinite(w)) return 'no income set';
    if (w < 0.15) return 'now';
    if (w < 1) return 'under a week';
    if (w < 9.5) return trim(w, 1) + ' weeks';
    return Math.round(w) + ' weeks';
  }
  const rollText = (id, x) => (LINES[id].unit === '%' ? trim(x, 2) + '%' : String(Math.round(x)));

  /* ---------- sheets ---------- */
  const SKILL_CRIT = { paroxysmal: 300, shizukaziye: 300 }; // Marking Shot, not in the built-in Ranger sheets
  function mathSheet() {
    try { const d = JSON.parse(localStorage.getItem(MATH_KEY) || 'null'); return d && d.inputs && typeof d.inputs === 'object' ? Object.assign({}, Z.MODEL_DEFAULTS, d.inputs) : null; } catch (e) { return null; }
  }
  function sheetValues(key) {
    if (key === 'mine') { const m = mathSheet(); if (m) return m; }
    return (Z.PRESETS[key] || Z.PRESETS[DEFAULT]).values;
  }
  function fightDefaults(key) {
    const v = sheetValues(key);
    return { critBuff: key in SKILL_CRIT ? SKILL_CRIT[key] : num(v.critBuff), critRes: num(v.critRes), bossGenus: 'cogni',
      stance: G.OPTS.stance, frontRate: G.OPTS.frontRate, backRate: G.OPTS.backRate, acc: G.OPTS.acc, block: G.OPTS.block, capWeight: G.OPTS.capWeight };
  }

  /* ---------- state ---------- */
  function defaults() {
    const b = { v: 2, sheet: DEFAULT, budget: 100000, weekly: 6500, fight: fightDefaults(DEFAULT), boards: {}, lockBoard: 'cogni' };
    for (const k of G.BOARD_KEYS) b.boards[k] = G.blankBoard();
    return b;
  }
  function merge(d) {
    const b = defaults();
    if (!d || (d.v !== 1 && d.v !== 2)) return b;   // v1 had other names for the fight's fields: they fall back to the defaults
    if (d.sheet === 'mine' ? !!mathSheet() : (Z.PRESETS[d.sheet] && d.sheet !== 'kr')) b.sheet = d.sheet;
    b.fight = fightDefaults(b.sheet);
    if (d.fight && typeof d.fight === 'object') for (const k in b.fight) {
      if (k === 'bossGenus') { if (['cogni', 'fera', 'natura', 'varian', 'none'].indexOf(d.fight[k]) >= 0) b.fight[k] = d.fight[k]; }
      else if (k === 'stance') { if (d.fight[k] === 'front' || d.fight[k] === 'back') b.fight[k] = d.fight[k]; }
      else if (isFinite(Number(d.fight[k])) && Number(d.fight[k]) >= 0) b.fight[k] = Number(d.fight[k]);
    }
    if (isFinite(Number(d.budget)) && Number(d.budget) >= 0) b.budget = Number(d.budget);
    if (isFinite(Number(d.weekly)) && Number(d.weekly) >= 0) b.weekly = Number(d.weekly);
    if (G.BOARDS[d.lockBoard]) b.lockBoard = d.lockBoard;
    if (d.boards && typeof d.boards === 'object') for (const k of G.BOARD_KEYS) {
      const src = d.boards[k]; if (!Array.isArray(src)) continue;
      for (let i = 1; i <= 9; i++) {
        const x = src[i]; if (!x) continue;
        const ok = LINES[x.line] && G.poolOf(k, G.SLOT_CLASS[i]).lines.indexOf(x.line) >= 0;
        b.boards[k][i] = { line: ok ? x.line : '', val: ok ? Math.max(0, num(x.val)) : 0, locked: !!x.locked };
      }
    }
    return b;
  }
  let st = defaults();
  let C = null; // last computed context
  let saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage can be unavailable */ } }, 400); }

  /* ---------- compute: a ladder of prices (slow, in slices), then the plan at the budget's price ---------- */
  let job = 0, runT = 0, sweepKey = '', sweepPts = null;
  function ctx() {
    const f = st.fight;
    return {
      inputs: Object.assign({}, sheetValues(st.sheet), { critBuff: f.critBuff, critRes: f.critRes }),
      opts: { stance: f.stance, frontRate: f.frontRate, backRate: f.backRate, bossGenus: f.bossGenus, acc: f.acc, block: f.block, capWeight: f.capWeight }
    };
  }
  function schedule() { save(); document.body.classList.add('busy'); clearTimeout(runT); runT = setTimeout(run, 160); }
  function run() {
    const id = ++job, c = ctx(), key = JSON.stringify([c.inputs, c.opts, st.boards]);
    const finish = () => {
      if (id !== job) return;
      const pts = sweepPts, b = Math.max(0, st.budget);
      const lam = b < pts[0].cost ? Math.max(5, pts[0].lam * b / Math.max(1, pts[0].cost)) : G.priceFor(pts, b);
      const plan = G.plan(A, c.inputs, c.opts, lam, st.boards, { spread: 600 });
      C = { inputs: c.inputs, opts: c.opts, pts, lam, plan, perf: G.perfect(A, c.inputs, c.opts) };
      document.body.classList.remove('busy');
      render();
    };
    if (key === sweepKey && sweepPts) { finish(); return; }
    const pts = [], val = G.valuer(A, c.inputs, c.opts); let from = null, i = 0;
    (function step() {
      if (id !== job) return;
      const r = G.plan(A, c.inputs, c.opts, G.LADDER[i], st.boards, { start: from, val });
      from = r.next;
      // keep the ladder rising: a rung may not cost or gain less than the one below it
      const prev = pts[pts.length - 1];
      pts.push({ lam: G.LADDER[i], cost: prev ? Math.max(prev.cost, r.cost) : r.cost, total: prev ? Math.max(prev.total, r.total) : r.total, locked: r.locked });
      if (++i < G.LADDER.length) setTimeout(step, 0); else { sweepKey = key; sweepPts = pts; finish(); }
    })();
  }
  /* total damage a budget buys, read off the ladder */
  function totalAt(pts, budget) {
    if (budget <= 0) return pts[0].locked;
    if (budget <= pts[0].cost) return pts[0].locked + (pts[0].total - pts[0].locked) * budget / Math.max(1, pts[0].cost);
    for (let i = 1; i < pts.length; i++) if (budget <= pts[i].cost) {
      const a = pts[i - 1], b = pts[i], t = (budget - a.cost) / (b.cost - a.cost || 1);
      return a.total + t * (b.total - a.total);
    }
    return pts[pts.length - 1].total;
  }

  /* ---------- render ---------- */
  function render() {
    if (!C) return;
    renderHero(); renderTiles(); renderCurve(); renderBudgetTbl(); renderLocks(); renderVerdicts(); renderLines(); renderDerived();
  }
  const started = () => G.BOARD_KEYS.some((b) => st.boards[b].some((x) => x && (x.locked || x.line)));
  const weeksFor = (cost) => (st.weekly > 0 ? cost / st.weekly : Infinity);

  function renderHero() {
    const p = C.plan, share = p.total / C.perf.total;
    $('heroK').textContent = 'With ' + fmtN(st.budget) + (started() ? ' more' : '') + ' Soul Crystals';
    clear($('heroV')).append(h('b', null, fmtG(p.total)), ' damage, ', h('b', null, Math.round(share * 100) + '%'), ' of a perfect set of boards');
    const today = p.val.w < 1 ? fmtG(p.real) + ' in today\u2019s fight, with Critical Hit and Accuracy at full. ' : '';
    $('heroS').textContent = today + (p.cost < 1 ? 'Nothing left worth a press at this budget.'
      : 'About ' + fmtWeeks(weeksFor(p.cost)) + ' at ' + fmtN(st.weekly) + ' crystals a week, and ' + fmtK(p.kina) + ' Kinah.');
  }
  function tile(k, v, s) { return h('div', { class: 'tile' }, h('p', { class: 'k', text: k }), h('p', { class: 'v', text: v }), h('p', { class: 's', text: s })); }
  function renderTiles() {
    const p = C.plan, share = p.total / C.perf.total;
    clear($('tiles')).append(
      tile(p.val.w < 1 ? 'Damage, counted' : 'Damage from Genus', fmtG(p.total), (p.val.w < 1 ? 'Critical Hit and Accuracy at ' + Math.round(p.val.w * 100) + '%. ' : '') + (p.now > 0.005 ? fmtG(p.now) + ' on the boards now' : 'From blank boards')),
      tile('Of a perfect set', Math.round(share * 100) + '%', 'perfect is ' + fmtG(C.perf.total)),
      tile('Soul Crystals', fmtC(p.cost), p.spread && p.cost > 0 ? '4 runs in 5 land between ' + fmtC(p.spread.lo) + ' and ' + fmtC(p.spread.hi) : 'nothing left to spend'),
      tile('Kinah', fmtK(p.kina), '250 for each crystal'),
      tile('Time', fmtWeeks(weeksFor(p.cost)), 'at ' + fmtN(st.weekly) + ' crystals a week'),
      tile('Damage today', fmtG(p.real), 'every line at full, on this sheet')
    );
    $('planNote').textContent = 'Your luck moves the bill, not the rules: follow the lock table and stop when a board\'s card says so. This plan pays up to ' + fmtC(C.lam) + ' crystals for its last and dearest 1% of damage.';
  }

  function renderCurve() {
    const svg = clear($('curve')), W = 720, H = 300, m = { l: 46, r: 18, t: 16, b: 40 };
    const pts = C.pts, perf = C.perf.total, p = C.plan;
    const xmax = Math.max(300000, Math.ceil(Math.max(st.budget, p.cost) * 1.4 / 50000) * 50000);
    const X = (c) => m.l + (W - m.l - m.r) * Math.min(1, c / xmax), Y = (s) => H - m.b - (H - m.t - m.b) * Math.min(1, Math.max(0, s));
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      svg.append(sv('line', { class: s ? 'grid' : 'axis', x1: m.l, x2: W - m.r, y1: Y(s), y2: Y(s) }));
      svg.append(sv('text', { class: 'ax-t', x: m.l - 8, y: Y(s) + 4, 'text-anchor': 'end' }, Math.round(s * 100) + '%'));
    }
    const step = xmax <= 300000 ? 50000 : xmax <= 600000 ? 100000 : xmax <= 1500000 ? 250000 : 500000;
    for (let c = 0; c <= xmax + 1; c += step) svg.append(sv('text', { class: 'ax-t', x: X(c), y: H - m.b + 16, 'text-anchor': 'middle' }, c ? fmtK(c) : '0'));
    svg.append(sv('text', { class: 'ax-title', x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, 'Soul Crystals spent on all five boards'));
    let d = 'M' + X(0).toFixed(1) + ' ' + Y(pts[0].locked / perf).toFixed(1);
    const N = 90;
    for (let i = 1; i <= N; i++) { const c = xmax * i / N; d += ' L' + X(c).toFixed(1) + ' ' + Y(totalAt(pts, c) / perf).toFixed(1); }
    svg.append(sv('path', { class: 'line', d }));
    const px = X(p.cost), py = Y(p.total / perf);
    svg.append(sv('line', { class: 'guide', x1: px, x2: px, y1: py, y2: Y(0) }));
    svg.append(sv('circle', { class: 'dot', cx: px, cy: py, r: 6 }));
    const right = px < W - 190;
    svg.append(sv('text', { class: 'mark', x: px + (right ? 12 : -12), y: py + 18, 'text-anchor': right ? 'start' : 'end' }, fmtC(p.cost) + ' crystals, ' + Math.round(p.total / perf * 100) + '%'));
    svg.setAttribute('aria-label', 'Share of a perfect set of boards by Soul Crystals spent. Your budget of ' + fmtC(p.cost) + ' reaches ' + Math.round(p.total / perf * 100) + ' percent.');
  }
  function renderBudgetTbl() {
    const tb = clear($('budgetTbl').tBodies[0]), perf = C.perf.total;
    const rows = [10000, 25000, 50000, 100000, 175000, 330000, 600000];
    let mine = st.budget > 0 && rows.indexOf(st.budget) < 0 ? st.budget : null;
    const all = (mine ? rows.concat([mine]) : rows).sort((a, b) => a - b);
    for (const b of all) {
      const t = b === st.budget ? C.plan.total : totalAt(C.pts, b), capped = b > C.pts[C.pts.length - 1].cost && b !== st.budget;
      tb.append(h('tr', { class: b === st.budget ? 'best' : null },
        h('td', null, fmtN(b) + (b === st.budget ? ' (yours)' : '')),
        h('td', { class: 'r' }, fmtG(t) + (capped ? ' or more' : '')),
        h('td', { class: 'r' }, Math.round(t / perf * 100) + '%'),
        h('td', { class: 'r' }, fmtK(b * G.KINA_PER_CRYSTAL)),
        h('td', { class: 'r' }, fmtWeeks(weeksFor(b)))));
    }
  }

  /* lowest roll worth a lock: value in crystals -> a roll of this line, and how to show it */
  function lockCell(minV, id, u) {
    if (!(u > 0)) return { cls: 'no', text: '—' };
    const ln = LINES[id]; let roll = minV / (C.lam * u);
    if (roll > ln.h[1] + 1e-9) return { cls: 'no', text: '—' };
    if (roll <= ln.u[0] + 1e-9) return { cls: 'any', text: 'any' };
    if (roll > ln.u[1] && roll < ln.h[0]) roll = ln.h[0];
    const isPct = ln.unit === '%', shown = isPct ? Math.ceil(roll * 20 - 1e-6) / 20 : Math.ceil(roll - 1e-6);
    return { cls: shown > ln.u[1] ? 'h' : 'u', text: isPct ? trim(shown, 2) + '%' : String(shown) };
  }
  const linesOf = (b, cls, unit) => G.poolOf(b, cls).lines.filter((id) => unit(id) > 0).sort((x, y) => unit(y) * LINES[y].h[1] - unit(x) * LINES[x].h[1]);

  function renderLocks() {
    const tabs = clear($('lockTabs'));
    for (const b of G.BOARD_KEYS) tabs.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': b === st.lockBoard ? 'true' : 'false', onclick: () => { st.lockBoard = b; save(); renderLocks(); } }, G.BOARDS[b].name));
    const b = st.lockBoard, pb = C.plan.per[b], W = pb.sol.W, tbl = $('lockTbl'), head = clear(tbl.tHead), body = clear(tbl.tBodies[0]);
    // average the thresholds over the states the plan passes through, by slots locked
    const acc = {};
    for (const vz of pb.fw.visits) {
      const n = G.lockCount(vz.idx) + pb.state.dead, c = G.lk(vz.idx);
      for (let k = 0; k < 4; k++) if (c[k] < G.CLASS_N[k]) {
        const a = acc[n + ':' + k] || (acc[n + ':' + k] = { s: 0, w: 0 });
        a.s += vz.weight * G.threshold(W, vz.idx, k).min; a.w += vz.weight;
      }
    }
    const counts = []; for (let n = 0; n <= 8; n++) if ([0, 1, 2, 3].some((k) => acc[n + ':' + k])) counts.push(n);
    for (const n of counts) for (let k = 0; k < 4; k++) {
      if (acc[n + ':' + k]) continue;
      const a = { s: 0, w: 0 };
      for (let idx = 0; idx < G.NS; idx++) if (G.validState(idx) && G.lockCount(idx) + pb.state.dead === n && G.lk(idx)[k] < G.CLASS_N[k] && W[idx] > 0) { a.s += G.threshold(W, idx, k).min; a.w += 1; }
      if (a.w) acc[n + ':' + k] = a;
    }
    if (!counts.length) { body.append(h('tr', null, h('td', { class: 'dim' }, pb.press ? 'Nothing left to roll for on this board.' : 'This board is finished at your budget: no press is worth its cost.'))); return; }
    head.append(h('tr', null, h('th', null, 'Slot'), h('th', null, 'Line'), counts.map((n) => h('th', { class: 'r' }, n === 0 ? 'No locks' : n + (n === 1 ? ' lock' : ' locks')))));
    for (let k = 0; k < 4; k++) {
      const cls = G.CLASSES[k]; let first = true;
      for (const id of linesOf(b, cls, pb.unit).slice(0, 6)) {
        const cells = counts.map((n) => { const a = acc[n + ':' + k]; return a ? lockCell(a.s / a.w, id, pb.unit(id)) : { cls: 'na', text: '' }; });
        if (!cells.some((c) => c.cls === 'h' || c.cls === 'u' || c.cls === 'any')) continue;   // never worth a lock: leave the row out
        body.append(h('tr', { class: first ? 'slot-first' : null }, h('td', { class: 'slot' }, first ? G.CLASS_SLOTS[cls] : ''), h('td', null, G.lineName(id, b)),
          cells.map((c) => h('td', { class: 'r ' + c.cls }, c.text))));
        first = false;
      }
    }
  }

  function renderLines() {
    // Critical Hit, Accuracy and Damage Boost: the average worth of a point over the stretch this plan adds
    const p = C.plan, v = p.val, avg = (curve, from, more, least) => { const d = Math.max(least, more); return (curve(from + d) - curve(from)) / d; };
    const uv = G.units(v, v.w * avg(v.critAt, p.cur.crit, p.critAdd, 1), v.w * avg(v.accAt, p.cur.acc, p.accAdd, 1), avg(v.poolAt, p.cur.pool, p.poolAdd, 0.1), p.end.crit);
    const tb = clear($('lineTbl').tBodies[0]);
    let max = 0; const rows = [];
    const push = (slot, b, cls) => {
      const unit = (id) => G.unitOn(uv, b, id), pool = G.poolOf(b, cls);
      linesOf(b, cls, unit).forEach((id, i) => { const v = unit(id) * LINES[id].h[1]; if (v < 0.03) return; max = Math.max(max, v); rows.push({ slot, first: i === 0, name: G.lineName(id, b), top: rollText(id, LINES[id].h[1]), v, p: 0.2 / pool.size }); });
    };
    for (const b of G.BOARD_KEYS) push('Slot 4, ' + G.BOARDS[b].name, b, 's4');
    push('Slots 3, 6 and 9', 'cogni', 's369'); push('Slots 1 and 5', 'cogni', 's15'); push('Slot 7', 'cogni', 's7');
    let last = '';
    for (const r of rows) {
      tb.append(h('tr', { class: r.slot !== last ? 'slot-first' : null },
        h('td', { class: 'slot' }, r.slot !== last ? r.slot : ''), h('td', null, r.name), h('td', { class: 'r' }, r.top),
        h('td', { class: 'mini-cell' }, h('span', { class: 'mini', style: 'width:' + Math.max(2, Math.round(r.v / max * 110)) + 'px' }), h('span', { class: 'num' }, fmtG(r.v))),
        h('td', { class: 'r' }, (r.p * 100).toFixed(2) + '%')));
      last = r.slot;
    }
  }

  function renderDerived() {
    const p = C.plan, v = p.val, head = v.critHead, n = clear($('derived'));
    const have = num(C.inputs.critRating) + num(C.inputs.critBuff);
    if (C.inputs.critMode === 'manual') n.append('This sheet has its crit rate typed in: ', h('b', null, Math.round(v.critRate * 100) + '%'), '. ');
    else n.append('Critical Hit ', h('b', null, fmtN(have)), ' against ', h('b', null, fmtN(num(C.inputs.critRes))), ' resist: you crit ', h('b', null, Math.round(v.critRate * 100) + '%'), ' of hits. ');
    if (head <= 0) n.append('That is the cap, so crit lines are worth nothing here. ');
    else n.append('The ' + Math.round(v.critCap * 100) + '% cap is ', h('b', null, fmtN(head)), ' away; this plan ends with about ', h('b', null, fmtN(p.end.crit)), ' from Genus. ');
    if (v.accHead <= 0) n.append('Your Accuracy is past the boss\u2019s Block, so Accuracy lines are worth nothing here.');
    else n.append('Accuracy is ', h('b', null, fmtN(v.accHead)), ' short: ', h('b', null, Math.round(v.parryNow * 100) + '%'), ' of your hits from the front or side are parried. This plan ends with about ', h('b', null, fmtN(p.end.acc)), ' from Genus.');
    n.append(' Check both numbers in game: they decide most of the plan.');
  }

  /* ---------- board cards ---------- */
  const cards = {};
  function buildBoards() {
    const host = clear($('boardCards'));
    for (const b of G.BOARD_KEYS) {
      const rows = [];
      const slotsEl = h('div', { class: 'slots' });
      for (let i = 1; i <= 9; i++) {
        const cls = G.SLOT_CLASS[i], pool = G.poolOf(b, cls), sl = st.boards[b][i];
        const sel = h('select', { 'aria-label': G.BOARDS[b].name + ' slot ' + i + ' line' }, h('option', { value: '' }, cls === 's28' ? 'Defensive line' : 'Nothing useful'),
          pool.lines.map((id) => h('option', { value: id }, G.lineName(id, b))));
        const val = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', 'aria-label': G.BOARDS[b].name + ' slot ' + i + ' value' });
        const lock = h('input', { type: 'checkbox' });
        const row = h('div', { class: 'slot' }, h('span', { class: 'sn' }, i), sel, val, h('label', null, lock, 'Locked'));
        if (cls === 's28') sel.disabled = true;
        sel.addEventListener('change', () => { sl.line = sel.value; if (sl.line && !(sl.val > 0)) sl.val = LINES[sl.line].u[1]; if (!sl.line) sl.val = 0; syncRow(); schedule(); });
        val.addEventListener('input', () => { sl.val = Math.max(0, num(val.value)); schedule(); });
        lock.addEventListener('change', () => { sl.locked = lock.checked; syncRow(); schedule(); });
        function syncRow() { sel.value = sl.line; val.disabled = !sl.line; val.value = sl.line ? String(sl.val) : ''; lock.checked = sl.locked; row.classList.toggle('locked', sl.locked); }
        syncRow(); rows.push(syncRow); slotsEl.append(row);
      }
      const verdict = h('div', { class: 'verdict' });
      const card = h('div', { class: 'bcard' },
        h('div', { class: 'bcard-top' }, h('h3', null, G.BOARDS[b].name),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { const fresh = G.blankBoard(); for (let i = 1; i <= 9; i++) Object.assign(st.boards[b][i], fresh[i]); rows.forEach((f) => f()); schedule(); } }, 'Clear')),
        slotsEl, verdict);
      cards[b] = { verdict };
      host.append(card);
    }
  }
  const slotList = (a) => (a.length === 1 ? 'slot ' + a[0] : 'slots ' + a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  function renderVerdicts() {
    for (const b of G.BOARD_KEYS) {
      const pb = C.plan.per[b], v = clear(cards[b].verdict), sl = st.boards[b];
      const blank = !sl.some((x) => x && (x.locked || x.line)), showing = sl.some((x, i) => i && x && !x.locked && x.line);
      v.className = 'verdict' + (pb.press ? '' : ' done');
      if (!pb.press) {
        v.append(h('p', { class: 'do' }, blank ? 'Not worth a press at this budget.' : 'Stop here and keep the board.'));
        v.append(h('p', null, blank ? 'Raise the budget to bring this board into the plan.' : 'One more press costs ' + fmtN(G.pressCost(G.lockCount(pb.state.idx) + pb.state.dead)) + ' crystals and is not likely to pay for itself.'));
      } else {
        v.append(h('p', { class: 'do' }, pb.lockNow.length ? 'Lock ' + slotList(pb.lockNow) + ', then press.' : showing ? 'Press. Nothing showing is worth a lock.' : blank ? 'Press with nothing locked.' : 'Keep pressing.'));
        v.append(h('p', null, 'About ' + fmtC(pb.cost) + ' crystals left on this board, for ' + fmtG(pb.gain) + ' more damage.'));
        const items = [];
        for (const t of pb.thr) {
          const parts = [];
          for (const id of linesOf(b, t.cls, pb.unit).slice(0, 4)) { const c = lockCell(t.min, id, pb.unit(id)); if (c.cls !== 'no') parts.push([G.lineName(id, b) + ' ', h('b', null, c.text === 'any' ? 'any roll' : c.text + ' or more')]); }
          if (parts.length) items.push(h('li', null, G.CLASS_SLOTS[t.cls] + ': ', parts.map((x, i) => [i ? ', ' : '', x])));
        }
        if (items.length) v.append(h('p', null, 'On the next presses, lock:'), h('ul', null, items));
      }
      if (pb.fresh) v.append(h('p', null, 'A blank board on a spare preset would beat this one from here. The locks you hold make each press dear.'));
    }
  }

  /* ---------- rail ---------- */
  const FIELDS = ['critBuff', 'critRes', 'acc', 'block', 'capWeight', 'frontRate', 'backRate'], PCT = ['capWeight', 'frontRate', 'backRate'];
  function syncRail() {
    $('sheet').value = st.sheet;
    $('f-budget').value = st.budget; $('f-weekly').value = st.weekly;
    for (const k of FIELDS) $('f-' + k).value = st.fight[k];
    $('f-bossGenus').value = st.fight.bossGenus; $('f-stance').value = st.fight.stance;
    const pz = Z.PRESETS[st.sheet];
    $('sheetNote').textContent = st.sheet === 'mine' ? 'The sheet you saved in Damage Math, as it stands now.' : pz && pz.note ? 'A built-in sheet from Damage Math. Edit it there, then pick "My Damage Math sheet" here.' : '';
  }
  function buildRail() {
    const sel = $('sheet');
    if (mathSheet()) sel.append(h('option', { value: 'mine' }, 'My Damage Math sheet'));
    for (const k in Z.PRESETS) if (k !== 'kr') sel.append(h('option', { value: k }, Z.PRESETS[k].label));
    sel.addEventListener('change', () => { st.sheet = sel.value; st.fight = fightDefaults(st.sheet); syncRail(); schedule(); });
    $('f-budget').addEventListener('input', (e) => { st.budget = Math.max(0, num(e.target.value)); schedule(); });
    $('f-weekly').addEventListener('input', (e) => { st.weekly = Math.max(0, num(e.target.value)); schedule(); });
    for (const k of FIELDS) $('f-' + k).addEventListener('input', (e) => { let x = Math.max(0, num(e.target.value)); if (PCT.indexOf(k) >= 0) x = Math.min(100, x); st.fight[k] = x; schedule(); });
    $('f-bossGenus').addEventListener('change', (e) => { st.fight.bossGenus = e.target.value; schedule(); });
    $('f-stance').addEventListener('change', (e) => { st.fight.stance = e.target.value; schedule(); });
    for (const btn of document.querySelectorAll('[data-weekly]')) btn.addEventListener('click', () => { st.weekly = num(btn.getAttribute('data-weekly')); $('f-weekly').value = st.weekly; schedule(); });
    syncRail();
  }

  function start() {
    let loaded = null;
    try { loaded = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { loaded = null; }
    st = merge(loaded);
    buildRail(); buildBoards(); schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
