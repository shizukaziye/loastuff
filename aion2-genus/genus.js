/* Aion 2 Genus Insight: what a press costs, what each slot can roll, and which rolls to lock.
   Pure functions, no DOM. Damage values come from the Damage Math model (A2), passed in by the caller.

   One board is nine slots. A press (Analyze) re-rolls every unlocked slot. After a press you may stop (every line on
   the board stays), or lock some of the lines you see and press again. The solver finds the choice that maximises
   (price x damage gained) - crystals spent, where price is the crystals you are willing to pay for +1% damage. */
(function (root) {
  'use strict';

  /* ---- the game's numbers (Global client, Insight 10) ---- */
  const ODDS = { heroic: 0.05, unique: 0.15 };            // per slot, per press; lower grades are counted as worth nothing
  const LOCK_EXTRA = [0, 8, 16, 36, 76, 156, 236, 316, 396]; // extra Soul Crystals by slots locked
  const KINA_PER_CRYSTAL = 250;
  const pressCost = (locks) => (locks >= 9 ? 1e12 : 4 * (9 - locks) + LOCK_EXTRA[locks]);

  /* h = Heroic range, u = Unique range. uRead: the Unique range is printed in a guide; otherwise it is the
     printed minimum doubled, the pattern every printed range follows. grp: 'pool' lines add into one Damage Boost
     sum and 'crit' lines stop at the crit cap, so both are priced on the amount the whole plan expects. */
  const L = (name, unit, h, u, grp, uRead) => ({ name, unit, h, u, grp: grp || 'other', uRead: !!uRead });
  const LINES = {
    pveDb:    L('PvE Damage Boost', '%', [2, 4], [1.5, 3], 'pool', true),
    genusDb:  L('Genus Damage Boost', '%', [2.4, 4.8], [2, 4], 'pool', true),
    db:       L('Damage Boost', '%', [1.5, 3], [1, 2], 'pool', true),
    dbl:      L('Double Chance', '%', [1.5, 3], [1, 2], '', true),
    wdb:      L('Weapon Damage Boost', '%', [1.5, 3], [1, 2], '', true),
    critDb:   L('Critical Damage Boost', '%', [1.5, 3], [1, 2], '', true),
    frontDb:  L('Front Attack Damage Boost', '%', [1.5, 3], [1, 2], '', true),
    backDb:   L('Back Attack Damage Boost', '%', [1.5, 3], [1, 2], '', true),
    multiHit: L('Multi-hit Chance', '%', [1.5, 3], [1, 2], '', true),
    perfect:  L('Perfect Chance', '%', [1.5, 3], [1, 2], '', true),
    pveAtk:   L('PvE Attack', '', [10, 20], [6, 12]),
    bossAtk:  L('Boss Attack', '', [10, 20], [6, 12]),
    atkBonus: L('Attack Bonus', '', [8, 16], [6, 12], '', true),
    maxAtk:   L('Max Attack', '', [10, 20], [8, 16]),
    frontAtk: L('Front Attack', '', [10, 20], [6, 12]),
    backAtk:  L('Back Attack', '', [10, 20], [6, 12]),
    critAtk:  L('Critical Attack', '', [10, 20], [6, 12]),
    pen:      L('Penetration', '', [100, 200], [75, 150]),
    critHit:  L('Critical Hit', '', [15, 30], [10, 20], 'crit'),
    frontCrit: L('Front Attack Critical Hit', '', [20, 40], [15, 30], 'crit'),
    backCrit: L('Back Attack Critical Hit', '', [20, 40], [15, 30], 'crit'),
    acc:      L('Accuracy Bonus', '', [20, 40], [15, 30]),
    pveAcc:   L('PvE Accuracy', '', [25, 50], [15, 30]),
    psdb:     L('Power Shard Damage Bonus', '', [8, 16], [6, 12])
  };

  /* Pools: size is every line the slot can roll at Unique or Heroic; lines are the ones that can add damage. */
  const FLAT4 = ['critHit', 'acc', 'atkBonus'];
  const S15 = { size: 10, lines: ['pveAtk', 'bossAtk', 'atkBonus', 'maxAtk', 'frontAtk', 'backAtk', 'critAtk', 'pen'] };
  const S369 = { size: 10, lines: ['critHit', 'frontCrit', 'backCrit', 'acc', 'pveAcc', 'psdb'] };
  const S28 = { size: 12, lines: [] };
  const S7M = { size: 14, lines: ['critHit', 'acc'] }, S7S = { size: 12, lines: ['critHit', 'acc'] };
  const BOARDS = {
    cogni:   { name: 'Cogni', s4: { size: 14, lines: ['pveDb', 'genusDb', 'db', 'critDb'].concat(FLAT4) }, s7: S7M },
    fera:    { name: 'Fera', s4: { size: 14, lines: ['pveDb', 'genusDb', 'db', 'wdb'].concat(FLAT4) }, s7: S7M },
    natura:  { name: 'Natura', s4: { size: 14, lines: ['pveDb', 'genusDb', 'multiHit', 'perfect'].concat(FLAT4) }, s7: S7M },
    varian:  { name: 'Varian', s4: { size: 14, lines: ['pveDb', 'genusDb', 'frontDb', 'backDb'].concat(FLAT4) }, s7: S7M },
    special: { name: 'Special', s4: { size: 12, lines: ['dbl', 'db', 'critDb', 'frontDb', 'backDb'].concat(FLAT4) }, s7: S7S }
  };
  const BOARD_KEYS = ['cogni', 'fera', 'natura', 'varian', 'special'];
  const SLOT_CLASS = [null, 's15', 's28', 's369', 's4', 's15', 's369', 's7', 's28', 's369']; // by slot number 1..9
  const CLASSES = ['s15', 's369', 's4', 's7'], CLASS_N = [2, 3, 1, 1], STRIDE = [16, 4, 2, 1], NS = 48;
  const CLASS_SLOTS = { s15: 'Slots 1 and 5', s369: 'Slots 3, 6 and 9', s4: 'Slot 4', s7: 'Slot 7', s28: 'Slots 2 and 8' };
  const poolOf = (board, cls) => (cls === 's15' ? S15 : cls === 's369' ? S369 : cls === 's28' ? S28 : BOARDS[board][cls]);
  const lineName = (id, board) => (id === 'genusDb' ? BOARDS[board].name + ' Damage Boost' : LINES[id].name);

  /* ---- what each line is worth on a sheet, in % damage (100 x ln, so values add) ----
     Most lines are priced by the unit. Critical Hit and the Damage Boost sum are curves: each point makes the next worth
     less, and Critical Hit is worth nothing past the cap. critAt(x) and poolAt(x) give the gain from x of each. */
  function valuer(A2, inputs, opts) {
    const o = Object.assign({ front: 50, back: 50, bossGenus: 'cogni', accPer100: 0 }, opts);
    const s = A2.toState(inputs), p = A2.toParams(inputs);
    const lg = (st) => 100 * Math.log(Math.max(1e-9, A2.dmg(st, p)));
    const add = (st, stat, x) => A2.applyDeltas(st, p, [{ stat, amount: x }]);
    const per = (st, stat, step) => (lg(add(st, stat, step)) - lg(st)) / step;
    const at = (share) => Object.assign({}, s, { up: A2.clamp(share / 100, 0, 1) });
    const l0 = lg(s);
    const critAt = (x) => (x > 0 ? Math.max(0, lg(add(s, 'critHit', x)) - l0) : 0);
    const poolAt = (x) => (x > 0 ? Math.max(0, lg(add(s, 'db', x)) - l0) : 0);
    const accU = Math.max(0, Number(o.accPer100) || 0) / 100;
    const lin = {
      dbl: per(s, 'dbl', 1), wdb: per(s, 'wdb', 1), critDb: per(s, 'critDmg', 1),
      frontDb: per(at(o.front), 'posDb', 1), backDb: per(at(o.back), 'posDb', 1),
      multiHit: per(s, 'multiHit', 1), perfect: per(s, 'perfect', 1),
      pveAtk: per(s, 'flatPve', 10), bossAtk: per(s, 'flatPve', 10), atkBonus: per(s, 'atkBonus', 10), maxAtk: per(s, 'maxAtk', 10),
      frontAtk: per(at(o.front), 'flatPos', 10), backAtk: per(at(o.back), 'flatPos', 10), critAtk: per(s, 'flatCrit', 10),
      pen: per(s, 'pen', 100), acc: accU, pveAcc: accU,
      psdb: s.sh > 0 ? (lg(Object.assign({}, s, { sh: s.sh + 0.0016 })) - l0) / 16 : 0
    };
    for (const k in lin) if (!(lin[k] > 1e-9)) lin[k] = 0;
    return {
      lin, critAt, poolAt,
      critMarg: (x) => Math.max(0, critAt(x + 1) - critAt(x)), poolMarg: (x) => Math.max(0, (poolAt(x + 0.1) - poolAt(x)) / 0.1),
      // Critical Hit still missing before the crit cap, and the crit rate now, on the sheet as entered
      critHead: p.ccPer100 > 0 ? Math.max(0, (p.cap - s.cc) * 10000 / p.ccPer100) : 0, critRate: A2.clamp(s.cc, 0, p.cap), critCap: p.cap,
      bossGenus: o.bossGenus, front: A2.clamp(o.front / 100, 0, 1), back: A2.clamp(o.back / 100, 0, 1)
    };
  }
  /* unit values for the solver: uc = what a point of Critical Hit is priced at, up = a point of the Damage Boost sum */
  function units(val, uc, up) {
    const u = Object.assign({}, val.lin, { critHit: uc, frontCrit: uc * val.front, backCrit: uc * val.back, pveDb: up, db: up, genusDb: up });
    return { u, bossGenus: val.bossGenus, front: val.front, back: val.back };
  }
  const units0 = (val) => units(val, val.critMarg(0), val.poolMarg(0));
  /* a line's unit value on one board: a genus line only counts on its own board, against that genus */
  const unitOn = (uv, board, id) => (id === 'genusDb' && uv.bossGenus !== board ? 0 : uv.u[id] || 0);
  /* effective Critical Hit points a crit-group roll adds (positional crit counts by its share of hits) */
  const critPts = (uv, id, roll) => (id === 'frontCrit' ? uv.front : id === 'backCrit' ? uv.back : 1) * roll;

  /* ---- a slot's outcomes as atoms: probability p, value v in crystals (price x %), its crit and pool parts ---- */
  function classAtoms(pool, unit, lam, q) {
    const out = [];
    q = q || 8;
    for (const id of pool.lines) {
      const u = unit(id); if (!(u > 0)) continue;
      const ln = LINES[id];
      for (const g of ['heroic', 'unique']) {
        const r = g === 'heroic' ? ln.h : ln.u, P = ODDS[g] / pool.size / q;
        for (let i = 0; i < q; i++) {
          const v = lam * u * (r[0] + (r[1] - r[0]) * (i + 0.5) / q);
          out.push({ p: P, v, vc: ln.grp === 'crit' ? v : 0, vp: ln.grp === 'pool' ? v : 0 });
        }
      }
    }
    return out;
  }
  function coarsen(atoms, m) {
    if (atoms.length <= m) return atoms;
    let lo = Infinity, hi = -Infinity;
    for (const a of atoms) { if (a.v < lo) lo = a.v; if (a.v > hi) hi = a.v; }
    const w = (hi - lo) / m || 1, bins = [];
    for (const a of atoms) {
      const b = Math.min(m - 1, Math.floor((a.v - lo) / w));
      const t = bins[b] || (bins[b] = { p: 0, v: 0, vc: 0, vp: 0 });
      t.p += a.p; t.v += a.p * a.v; t.vc += a.p * a.vc; t.vp += a.p * a.vp;
    }
    return bins.filter(Boolean).map((t) => ({ p: t.p, v: t.v / t.p, vc: t.vc / t.p, vp: t.vp / t.p }));
  }

  /* every way a press can land with 1..kmax useful lines; the rest of the probability is "nothing useful" */
  const GRID = [0, 0, 10, 4, 2];
  function enumerate(slots, grids, pnz, cb) {
    const n = slots.length; let z = 1;
    const open = [0, 0, 0, 0];
    for (const c of slots) { z *= 1 - pnz[c]; open[c]++; }
    const cs = [], at = [], pos = [];
    // Slots of one class are alike, so only the first j of a class are ever picked and the result counts C(open, j) times.
    function pick(start, k, depth, prob) {
      if (depth === k) {
        let mult = 1, run = 1;
        for (let d = 0; d < k; d++) { run = d > 0 && cs[d] === cs[d - 1] ? run + 1 : 1; mult *= (open[cs[d]] - run + 1) / run; }
        cb(prob * mult, cs, at, k); return;
      }
      for (let i = start; i <= n - (k - depth); i++) {
        if (i > 0 && slots[i] === slots[i - 1] && !(depth > 0 && pos[depth - 1] === i - 1)) continue;
        const c = slots[i], g = grids[k][c], inv = 1 / (1 - pnz[c]);
        cs[depth] = c; pos[depth] = i;
        for (let j = 0; j < g.length; j++) { at[depth] = g[j]; pick(i + 1, k, depth + 1, prob * g[j].p * inv); }
      }
    }
    for (let k = 1; k <= Math.min(4, n); k++) pick(0, k, 0, z);
  }
  const lk = (idx) => [idx >> 4, (idx >> 2) & 3, (idx >> 1) & 1, idx & 1];
  const validState = (idx) => (idx >> 4) <= 2;
  function openSlots(idx) {
    const c = lk(idx), out = [];
    for (let k = 0; k < 4; k++) for (let i = c[k]; i < CLASS_N[k]; i++) out.push(k);
    return out;
  }
  const lockCount = (idx) => { const c = lk(idx); return c[0] + c[1] + c[2] + c[3]; };
  /* best choice for one landed press: returns the value and sets pick.mask (0 = stop and keep everything) */
  const pick = { mask: 0, stop: 0 };
  function bestOf(idx, W, cs, at, k) {
    let stop = 0;
    for (let i = 0; i < k; i++) stop += at[i].v;
    let best = stop, bm = 0;
    for (let m = 1; m < (1 << k); m++) {
      let sum = 0, j = idx;
      for (let i = 0; i < k; i++) if (m & (1 << i)) { sum += at[i].v; j += STRIDE[cs[i]]; }
      const v = sum + W[j];
      if (v > best + 1e-12) { best = v; bm = m; }
    }
    pick.mask = bm; pick.stop = stop;
    return best;
  }

  /* ---- solve one board. fine[c] = atoms of class c; dead = slots 2 and 8 already locked on lines that add no damage.
     W[state] = what one more press is worth from that state (crystals); at or below zero means stop. ---- */
  function solveBoard(fine, dead) {
    dead = dead || 0;
    const pnz = fine.map((a) => a.reduce((t, x) => t + x.p, 0));
    const grids = [null, fine, fine.map((a) => coarsen(a, GRID[2])), fine.map((a) => coarsen(a, GRID[3])), fine.map((a) => coarsen(a, GRID[4]))];
    const W = new Float64Array(NS);
    const op = [], oy = [];
    for (let idx = NS - 1; idx >= 0; idx--) {
      if (!validState(idx)) continue;
      const slots = openSlots(idx), c = pressCost(lockCount(idx) + dead);
      if (!slots.length) { W[idx] = -c; continue; }
      op.length = 0; oy.length = 0;
      enumerate(slots, grids, pnz, (prob, cs, at, k) => { op.push(prob); oy.push(bestOf(idx, W, cs, at, k)); });
      // w = -c + E[max(Y, w)], Y = 0 on the presses that land nothing. Policy iteration on the set {Y > w}.
      let sum = 0, pr = 0;
      for (let i = 0; i < op.length; i++) { sum += op[i] * oy[i]; pr += op[i]; }
      let w = sum - c;
      if (w > 0) {
        w = (sum - c) / pr;
        for (let it = 0; it < 60; it++) {
          let s2 = 0, p2 = 0;
          for (let i = 0; i < op.length; i++) if (oy[i] > w) { s2 += op[i] * oy[i]; p2 += op[i]; }
          const nw = (s2 - c) / p2;
          if (Math.abs(nw - w) < 1e-9) { w = nw; break; }
          w = nw;
        }
      }
      W[idx] = w;
    }
    return { W, fine, grids, pnz, dead };
  }

  /* ---- follow the policy forward from a state: expected crystals, presses and value (total, crit part, pool part) ---- */
  function forward(sol, start, keep) {
    const reach = new Float64Array(NS), W = sol.W;
    reach[start] = 1;
    const out = { cost: 0, presses: 0, v: 0, vc: 0, vp: 0, visits: [], chain: keep ? {} : null };
    for (let idx = 0; idx < NS; idx++) {
      const r = reach[idx];
      if (!validState(idx) || !(r > 0) || !(W[idx] > 0)) continue;
      const slots = openSlots(idx), c = pressCost(lockCount(idx) + sol.dead), w = W[idx];
      let pL = 0, v = 0, vc = 0, vp = 0;
      const tr = new Float64Array(NS);
      const ch = keep ? { cum: [], next: [], val: [] } : null;
      enumerate(slots, sol.grids, sol.pnz, (prob, cs, at, k) => {
        const y = bestOf(idx, W, cs, at, k);
        if (!(y > w)) return;
        pL += prob;
        const m = pick.mask;
        let j = idx, gv = 0;
        for (let i = 0; i < k; i++) if (!m || (m & (1 << i))) { gv += at[i].v; vc += prob * at[i].vc; vp += prob * at[i].vp; if (m) j += STRIDE[cs[i]]; }
        v += prob * gv;
        if (m) tr[j] += prob;
        if (ch) { ch.cum.push(pL); ch.next.push(m ? j : -1); ch.val.push(gv); }
      });
      if (!(pL > 0)) continue;
      out.cost += r * c / pL; out.presses += r / pL;
      out.v += r * v / pL; out.vc += r * vc / pL; out.vp += r * vp / pL;
      out.visits.push({ idx, weight: r / pL });
      for (let j = idx + 1; j < NS; j++) if (tr[j] > 0) reach[j] += r * tr[j] / pL;
      if (ch) { ch.pL = pL; ch.c = c; out.chain[idx] = ch; }
    }
    return out;
  }

  /* seeded runs of the same policy, for the spread of the bill */
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function simulate(chain, start, rand) {
    let idx = start, cost = 0;
    for (;;) {
      const ch = chain[idx]; if (!ch) return cost;
      cost += ch.c * (1 + Math.floor(Math.log(1 - rand()) / Math.log(1 - ch.pL)));
      const x = rand() * ch.pL; let lo = 0, hi = ch.cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ch.cum[mid] < x) lo = mid + 1; else hi = mid; }
      if (ch.next[lo] < 0) return cost;
      idx = ch.next[lo];
    }
  }

  /* minimum value (crystals) a lone line in class k must have to be locked from this state; done = it ends the board */
  function threshold(W, idx, k) {
    const nx = W[idx + STRIDE[k]];
    return { min: Math.max(0, W[idx]) - Math.max(0, nx), ends: !(nx > 0) };
  }

  /* ---- a board as the player has it: slots[1..9] = { line, val, locked } (line '' = nothing useful) ---- */
  const blankBoard = () => { const b = [null]; for (let i = 1; i <= 9; i++) b.push({ line: '', val: 0, locked: false }); return b; };
  function boardState(slots) {
    const c = [0, 0, 0, 0]; let dead = 0;
    for (let i = 1; i <= 9; i++) if (slots[i] && slots[i].locked) { const k = CLASSES.indexOf(SLOT_CLASS[i]); if (k < 0) dead++; else c[k]++; }
    return { idx: c[0] * 16 + c[1] * 4 + c[2] * 2 + c[3], dead };
  }

  /* ---- the whole plan: five boards, each from where it stands, at one price ----
     Critical Hit and Damage Boost lines are priced at what the last point of each is worth once the plan is done
     (the slope of the curve there). Past the crit cap that slope is zero, so the search below finds the crit price
     at which the plan lands on the cap and no further. */
  function plan(A2, inputs, opts, lam, boards, cfg) {
    cfg = Object.assign({ start: null, spread: 0, maxIt: 9 }, cfg);
    boards = boards || {};
    const val = cfg.val || valuer(A2, inputs, opts), u0 = units0(val);
    const useful = (b, i, x) => x && LINES[x.line] && poolOf(b, SLOT_CLASS[i]).lines.indexOf(x.line) >= 0 && unitOn(u0, b, x.line) > 0;
    // what is locked, and what is on the boards at all
    let critCur = 0, poolCur = 0, otherCur = 0, critNow = 0, poolNow = 0, otherNow = 0;
    for (const b of BOARD_KEYS) {
      const sl = boards[b]; if (!sl) continue;
      for (let i = 1; i <= 9; i++) {
        const x = sl[i]; if (!useful(b, i, x)) continue;
        const r = +x.val || 0, g = LINES[x.line].grp;
        const c = g === 'crit' ? critPts(u0, x.line, r) : 0, pl = g === 'pool' ? r : 0, ot = g === 'other' ? unitOn(u0, b, x.line) * r : 0;
        critNow += c; poolNow += pl; otherNow += ot;
        if (x.locked) { critCur += c; poolCur += pl; otherCur += ot; }
      }
    }

    function evalAt(uc, up, keep) {
      const uv = units(val, uc, up), per = {}; let cost = 0, presses = 0, critAdd = 0, poolAdd = 0, otherAdd = 0;
      for (const b of BOARD_KEYS) {
        const sl = boards[b] || blankBoard(), st = boardState(sl);
        const unit = (id) => unitOn(uv, b, id);
        const fine = CLASSES.map((cl) => classAtoms(poolOf(b, cl), unit, lam));
        const sol = solveBoard(fine, st.dead);
        const vis = []; let locked = 0;
        for (let i = 1; i <= 9; i++) {
          const x = sl[i], k = CLASSES.indexOf(SLOT_CLASS[i]), v = useful(b, i, x) ? unit(x.line) * (+x.val || 0) : 0;
          if (x && x.locked) locked += v; else if (k >= 0 && useful(b, i, x)) vis.push({ slot: i, k, v: lam * v, line: x.line, roll: +x.val || 0 });
        }
        // the choice now: stop and keep it all, or lock some of what shows and press
        let stop = 0; for (const x of vis) stop += x.v;
        let best = stop, bm = -1;                       // -1 = stop
        for (let m = 0; m < (1 << vis.length); m++) {
          let sum = 0, j = st.idx;
          for (let i = 0; i < vis.length; i++) if (m & (1 << i)) { sum += vis[i].v; j += STRIDE[vis[i].k]; }
          const v = sum + sol.W[j];
          if (v > best + 1e-9) { best = v; bm = m; }
        }
        let next = st.idx, kc = 0, kp = 0, ko = 0; const lockNow = [];
        for (let i = 0; i < vis.length; i++) if (bm < 0 || (bm & (1 << i))) {
          const x = vis[i], g = LINES[x.line].grp;
          if (bm >= 0) { next += STRIDE[x.k]; lockNow.push(x.slot); }
          if (g === 'crit') kc += critPts(uv, x.line, x.roll); else if (g === 'pool') kp += x.roll; else ko += x.v / lam;
        }
        const fw = bm < 0 ? { cost: 0, presses: 0, v: 0, vc: 0, vp: 0, visits: [], chain: null } : forward(sol, next, keep && cfg.spread > 0);
        const thr = [];
        if (bm >= 0) for (let k = 0; k < 4; k++) if (lk(next)[k] < CLASS_N[k]) thr.push(Object.assign({ k, cls: CLASSES[k] }, threshold(sol.W, next, k)));
        // would a blank board on a spare preset beat carrying on with this one?
        const started = st.idx !== 0 || st.dead > 0 || vis.length > 0;
        const fresh = started && (st.dead === 0 ? sol : solveBoard(fine, 0)).W[0] > lam * locked + best + 1e-6;
        const c = kc + (uc > 0 ? fw.vc / lam / uc : 0), pl = kp + (up > 0 ? fw.vp / lam / up : 0), ot = ko + (fw.v - fw.vc - fw.vp) / lam;
        per[b] = { sol, state: st, next, press: bm >= 0, lockNow, thr, cost: fw.cost, presses: fw.presses, fw, unit, fresh, crit: c, pool: pl, other: ot };
        cost += fw.cost; presses += fw.presses; critAdd += c; poolAdd += pl; otherAdd += ot;
      }
      return { uv, per, cost, presses, critAdd, poolAdd, otherAdd };
    }

    const top = val.critMarg(critCur), tol = Math.max(1e-7, top * 0.012), room = Math.max(0, val.critHead - critCur);
    let up = cfg.start ? cfg.start.up : val.poolMarg(poolCur), uc = 0, r = null, iters = 0;
    const run = (u) => { const x = evalAt(u, up, false); iters++; x.uc = u; x.up = up; up = val.poolMarg(poolCur + x.poolAdd); return x; };
    if (!(room > 0) || !(top > 0)) r = run(0);
    else {
      const ucCap = val.critMarg(critCur + Math.max(0, room - 1));      // what the last point before the cap is worth
      let lo = { u: 0, f: -room }, hi = null, u = cfg.start && cfg.start.uc > 0 ? Math.min(cfg.start.uc, ucCap) : ucCap, free = false;
      for (let it = 0; it < cfg.maxIt; it++) {
        r = run(u);
        const f = r.critAdd - room;
        if (Math.abs(f) <= 0.012 * room) break;
        if (f > 0) hi = { u, f }; else { lo = { u, f }; if (u >= ucCap - 1e-12) { free = true; break; } }
        if (!hi) u = Math.min(ucCap, u * 1.6);
        else { const w = hi.u - lo.u; u = Math.min(hi.u - 0.1 * w, Math.max(lo.u + 0.1 * w, lo.u - lo.f * w / (hi.f - lo.f))); if (w <= 1e-4 * ucCap) break; }
      }
      // the cap is out of reach at this price: settle on the slope where the plan ends
      if (free) for (let it = 0; it < 4; it++) {
        const want = Math.min(top, val.critMarg(critCur + r.critAdd));
        if (Math.abs(want - r.uc) <= tol || r.critAdd > room) break;
        r = run(want);
      }
    }
    if (Math.abs(up - r.up) > 0.012 * (r.up || 1)) r = run(r.uc);
    uc = r.uc; up = r.up;
    if (cfg.spread > 0) r = evalAt(uc, up, true);
    // true damage: the curves for Critical Hit and Damage Boost, the unit prices for the rest
    const critGain = val.critAt(critCur + r.critAdd) - val.critAt(critCur), poolGain = val.poolAt(poolCur + r.poolAdd) - val.poolAt(poolCur);
    const rc = r.critAdd > 0 ? critGain / r.critAdd : 0, rp = r.poolAdd > 0 ? poolGain / r.poolAdd : 0;
    for (const b of BOARD_KEYS) { const pb = r.per[b]; pb.gain = pb.other + pb.crit * rc + pb.pool * rp; }
    const locked = otherCur + val.critAt(critCur) + val.poolAt(poolCur), gain = r.otherAdd + critGain + poolGain;
    const res = { lam, val, uv: r.uv, per: r.per, cost: r.cost, presses: r.presses, kina: r.cost * KINA_PER_CRYSTAL,
      locked, now: otherNow + val.critAt(critNow) + val.poolAt(poolNow), gain, total: locked + gain,
      critCur, poolCur, critAdd: r.critAdd, poolAdd: r.poolAdd, uc, up, iters, next: { uc, up } };
    if (cfg.spread > 0) {
      const rand = rng(20261122), runs = [];
      for (let n = 0; n < cfg.spread; n++) { let t = 0; for (const b of BOARD_KEYS) { const pb = res.per[b]; if (pb.press && pb.fw.chain) t += simulate(pb.fw.chain, pb.next, rand); } runs.push(t); }
      runs.sort((x, y) => x - y);
      res.spread = { lo: runs[Math.floor(runs.length * 0.1)], hi: runs[Math.floor(runs.length * 0.9)] };
    }
    return res;
  }

  /* the plan at a ladder of prices; each rung starts from the one before */
  const LADDER = [500, 1000, 2000, 3500, 6000, 10000, 15000, 22000, 32000, 46000, 66000, 95000, 140000, 210000, 320000, 500000];
  function sweep(A2, inputs, opts, boards, lams) {
    const pts = [], val = valuer(A2, inputs, opts); let start = null;
    for (const lam of lams || LADDER) {
      const r = plan(A2, inputs, opts, lam, boards, { start, val });
      start = r.next;
      pts.push({ lam, cost: r.cost, total: r.total, gain: r.gain, locked: r.locked, iters: r.iters });
    }
    return pts;
  }
  /* the price whose plan spends about this many crystals */
  function priceFor(pts, budget) {
    if (!(budget > pts[0].cost)) return pts[0].lam;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (budget <= b.cost) { const t = (Math.log(budget) - Math.log(Math.max(1, a.cost))) / (Math.log(b.cost) - Math.log(Math.max(1, a.cost)) || 1); return Math.exp(Math.log(a.lam) + t * (Math.log(b.lam) - Math.log(a.lam))); }
    }
    return pts[pts.length - 1].lam;
  }

  /* a set of boards with the best line at its top roll in every slot */
  function perfect(A2, inputs, opts) {
    const val = valuer(A2, inputs, opts);
    function pickAt(uc, up) {
      const uv = units(val, uc, up); let other = 0, crit = 0, pool = 0; const picks = {};
      for (const b of BOARD_KEYS) {
        picks[b] = [null];
        for (let i = 1; i <= 9; i++) {
          let best = null;
          for (const id of poolOf(b, SLOT_CLASS[i]).lines) { const v = unitOn(uv, b, id) * LINES[id].h[1]; if (v > 0 && (!best || v > best.v)) best = { line: id, roll: LINES[id].h[1], v }; }
          picks[b].push(best);
          if (!best) continue;
          const g = LINES[best.line].grp;
          if (g === 'crit') crit += critPts(uv, best.line, best.roll); else if (g === 'pool') pool += best.roll; else other += best.v;
        }
      }
      return { picks, crit, pool, total: other + val.critAt(crit) + val.poolAt(pool) };
    }
    let best = null;
    const top = val.critMarg(0);
    for (let i = 0; i <= 12; i++) {           // try a spread of crit prices and keep the best set
      let r = pickAt(top * i / 12, val.poolMarg(0));
      r = pickAt(top * i / 12, val.poolMarg(r.pool));
      if (!best || r.total > best.total) best = r;
    }
    return best;
  }

  const api = { ODDS, LOCK_EXTRA, KINA_PER_CRYSTAL, pressCost, LINES, BOARDS, BOARD_KEYS, SLOT_CLASS, CLASSES, CLASS_N, CLASS_SLOTS, STRIDE, NS,
    poolOf, lineName, valuer, units, units0, unitOn, critPts, classAtoms, coarsen, solveBoard, forward, threshold, lk, lockCount, openSlots, validState,
    blankBoard, boardState, plan, sweep, LADDER, priceFor, perfect, rng, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.A2G = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
