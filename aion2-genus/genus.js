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
     sum, 'crit' lines stop at the crit cap and 'acc' lines stop once the boss no longer parries, so all three are
     priced on the amount the whole plan expects. */
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
    acc:      L('Accuracy Bonus', '', [20, 40], [15, 30], 'acc'),
    pveAcc:   L('PvE Accuracy', '', [25, 50], [15, 30], 'acc'),
    psdb:     L('Power Shard Damage Bonus', '', [8, 16], [6, 12])
  };

  /* Pools: size is every line the slot can roll at Unique or Heroic; lines are the ones that can add damage. */
  const FLAT4 = ['critHit', 'acc', 'atkBonus'];
  /* Slots 1 and 5 also roll PvE Attack, Boss Attack, Front Attack, Back Attack and Critical Attack. They are left out
     on purpose (LEFT_OUT): the solver never locks them and the page never offers them. All five are added after
     Attack Increase and only count under a condition; the one Global test has Boss Attack at half of Attack per
     point, less than the formula gives it. The README has the sources. */
  const LEFT_OUT = ['pveAtk', 'bossAtk', 'frontAtk', 'backAtk', 'critAtk'];
  const S15 = { size: 10, lines: ['maxAtk', 'atkBonus', 'pen'] };
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
     Most lines are priced by the unit. Three are curves, because each point makes the next worth less and two of
     them stop dead at a cap: critAt(x) for Critical Hit (nothing past the crit cap), accAt(x) for Accuracy (nothing
     once the boss stops parrying) and poolAt(x) for the Damage Boost sum.

     opts: stance 'front' or 'back' (the side you fight from), frontRate and backRate (the share of hits you land from
     that side when you play for it; the other side gets the rest), bossGenus, acc (Accuracy in the fight), block (the
     Accuracy at which this boss stops parrying), parryPer100 and parryLoss, capWeight (how much of a capped stat's
     damage to count: Critical Hit and Accuracy are worth nothing once gear takes you past the cap). */
  const OPTS = { stance: 'front', frontRate: 85, backRate: 70, bossGenus: 'cogni', acc: 1000, block: 1200, parryPer100: 6.7, parryLoss: 50, parryCap: 80, capWeight: 50 };
  function valuer(A2, inputs, opts) {
    const o = Object.assign({}, OPTS, opts);
    const s = A2.toState(inputs), p = A2.toParams(inputs);
    const lg = (st) => 100 * Math.log(Math.max(1e-9, A2.dmg(st, p)));
    const add = (st, stat, x) => A2.applyDeltas(st, p, [{ stat, amount: x }]);
    const per = (st, stat, step) => (lg(add(st, stat, step)) - lg(st)) / step;
    const F = A2.clamp(o.frontRate / 100, 0, 1), B = A2.clamp(o.backRate / 100, 0, 1);
    const front = o.stance === 'back' ? 1 - B : F, back = o.stance === 'back' ? B : 1 - F;
    const at = (share) => Object.assign({}, s, { up: share });
    const l0 = lg(s);
    const critAt = (x) => (x > 0 ? Math.max(0, lg(add(s, 'critHit', x)) - l0) : 0);
    const poolAt = (x) => (x > 0 ? Math.max(0, lg(add(s, 'db', x)) - l0) : 0);
    // Accuracy: a hit from the front or side is parried with chance parryPer100 for each 100 Accuracy you are short of
    // the boss's Block, and a parried hit loses parryLoss of its damage. Hits from behind are never parried.
    const short0 = Math.max(0, (Number(o.block) || 0) - (Number(o.acc) || 0)), open = 1 - back;
    const parry = (short) => Math.min(o.parryCap / 100, Math.max(0, short) * o.parryPer100 / 10000);
    const landed = (short) => 1 - open * parry(short) * o.parryLoss / 100;
    const accAt = (x) => (x > 0 ? 100 * Math.log(landed(short0 - x) / landed(short0)) : 0);
    const lin = {
      dbl: per(s, 'dbl', 1), wdb: per(s, 'wdb', 1), critDb: per(s, 'critDmg', 1),
      frontDb: per(at(front), 'posDb', 1), backDb: per(at(back), 'posDb', 1),
      multiHit: per(s, 'multiHit', 1), perfect: per(s, 'perfect', 1),
      pveAtk: per(s, 'flatPve', 10), bossAtk: per(s, 'flatPve', 10), atkBonus: per(s, 'atkBonus', 10), maxAtk: per(s, 'maxAtk', 10),
      frontAtk: per(at(front), 'flatPos', 10), backAtk: per(at(back), 'flatPos', 10), critAtk: per(s, 'flatCrit', 10),
      pen: per(s, 'pen', 100),
      psdb: s.sh > 0 ? (lg(Object.assign({}, s, { sh: s.sh + 0.0016 })) - l0) / 16 : 0
    };
    for (const k in lin) if (!(lin[k] > 1e-9)) lin[k] = 0;
    // Critical Damage Boost and Critical Attack pay out on crits only, so they are worth what the crit rate at the END
    // of the plan makes them worth, not today's rate.
    const critLines = (critPts) => { const t = critPts > 0 ? add(s, 'critHit', critPts) : s; return { critDb: Math.max(0, per(t, 'critDmg', 1)), critAtk: Math.max(0, per(t, 'flatCrit', 10)) }; };
    return {
      lin, critAt, poolAt, accAt, critLines, w: A2.clamp(o.capWeight / 100, 0, 1),
      critMarg: (x) => Math.max(0, critAt(x + 1) - critAt(x)), accMarg: (x) => Math.max(0, accAt(x + 1) - accAt(x)),
      poolMarg: (x) => Math.max(0, (poolAt(x + 0.1) - poolAt(x)) / 0.1),
      // what is still missing before each cap, and where the sheet stands now
      critHead: p.ccPer100 > 0 ? Math.max(0, (p.cap - s.cc) * 10000 / p.ccPer100) : 0, critRate: A2.clamp(s.cc, 0, p.cap), critCap: p.cap,
      accHead: short0, parryNow: parry(short0), parryOpen: open,
      bossGenus: o.bossGenus, front, back, stance: o.stance === 'back' ? 'back' : 'front'
    };
  }
  /* unit values for the solver: uc, ua and up are what a point of Critical Hit, of Accuracy and of the Damage Boost
     sum are priced at; critPts is the Critical Hit the plan expects to end with (for the crit-only lines) */
  function units(val, uc, ua, up, critPts) {
    const u = Object.assign({}, val.lin, critPts == null ? null : val.critLines(critPts),
      { critHit: uc, frontCrit: uc * val.front, backCrit: uc * val.back, acc: ua, pveAcc: ua, pveDb: up, db: up, genusDb: up });
    return { u, bossGenus: val.bossGenus, front: val.front, back: val.back };
  }
  /* every line at full worth for its first point on the sheet as it stands */
  const units0 = (val) => units(val, val.critMarg(0), val.accMarg(0), val.poolMarg(0), null);
  /* a line's unit value on one board: a genus line only counts on its own board, against that genus */
  const unitOn = (uv, board, id) => (id === 'genusDb' && uv.bossGenus !== board ? 0 : uv.u[id] || 0);
  /* effective Critical Hit points a crit-group roll adds (positional crit counts by its share of hits) */
  const critPts = (uv, id, roll) => (id === 'frontCrit' ? uv.front : id === 'backCrit' ? uv.back : 1) * roll;

  /* ---- a slot's outcomes as atoms: probability p, value v in crystals (price x %), its crit and pool parts ---- */
  function classAtoms(pool, unit, lam, q) {
    const out = [];
    q = q || 5;
    for (const id of pool.lines) {
      const u = unit(id); if (!(u > 0)) continue;
      const ln = LINES[id];
      for (const g of ['heroic', 'unique']) {
        const r = g === 'heroic' ? ln.h : ln.u, P = ODDS[g] / pool.size / q;
        for (let i = 0; i < q; i++) {
          const v = lam * u * (r[0] + (r[1] - r[0]) * (i + 0.5) / q);
          out.push({ p: P, v, vc: ln.grp === 'crit' ? v : 0, va: ln.grp === 'acc' ? v : 0, vp: ln.grp === 'pool' ? v : 0 });
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
      const t = bins[b] || (bins[b] = { p: 0, v: 0, vc: 0, va: 0, vp: 0 });
      t.p += a.p; t.v += a.p * a.v; t.vc += a.p * a.vc; t.va += a.p * (a.va || 0); t.vp += a.p * a.vp;
    }
    return bins.filter(Boolean).map((t) => ({ p: t.p, v: t.v / t.p, vc: t.vc / t.p, va: t.va / t.p, vp: t.vp / t.p }));
  }

  /* every way a press can land with 1..kmax useful lines; the rest of the probability is "nothing useful" */
  const GRID = [0, 0, 7, 3, 2];
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
    const out = { cost: 0, presses: 0, v: 0, vc: 0, va: 0, vp: 0, visits: [], chain: keep ? {} : null };
    for (let idx = 0; idx < NS; idx++) {
      const r = reach[idx];
      if (!validState(idx) || !(r > 0) || !(W[idx] > 0)) continue;
      const slots = openSlots(idx), c = pressCost(lockCount(idx) + sol.dead), w = W[idx];
      let pL = 0, v = 0, vc = 0, va = 0, vp = 0;
      const tr = new Float64Array(NS);
      const ch = keep ? { cum: [], next: [], val: [] } : null;
      enumerate(slots, sol.grids, sol.pnz, (prob, cs, at, k) => {
        const y = bestOf(idx, W, cs, at, k);
        if (!(y > w)) return;
        pL += prob;
        const m = pick.mask;
        let j = idx, gv = 0;
        for (let i = 0; i < k; i++) if (!m || (m & (1 << i))) { gv += at[i].v; vc += prob * at[i].vc; va += prob * (at[i].va || 0); vp += prob * at[i].vp; if (m) j += STRIDE[cs[i]]; }
        v += prob * gv;
        if (m) tr[j] += prob;
        if (ch) { ch.cum.push(pL); ch.next.push(m ? j : -1); ch.val.push(gv); }
      });
      if (!(pL > 0)) continue;
      out.cost += r * c / pL; out.presses += r / pL;
      out.v += r * v / pL; out.vc += r * vc / pL; out.va += r * va / pL; out.vp += r * vp / pL;
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
     Critical Hit, Accuracy and Damage Boost lines are priced at what the last point of each is worth once the plan is
     done (the slope of its curve there). Past a cap that slope is zero, so the search below finds, for Critical Hit
     and then for Accuracy, the price at which the plan lands on the cap and no further.
     Critical Hit and Accuracy count at val.w of their damage (capWeight): `total` is that counted damage, `real` is
     the damage on the sheet as it stands today with both at full. */
  function plan(A2, inputs, opts, lam, boards, cfg) {
    cfg = Object.assign({ start: null, spread: 0, maxIt: 12 }, cfg);
    boards = boards || {};
    const val = cfg.val || valuer(A2, inputs, opts), u0 = units0(val), w = val.w;
    const useful = (b, i, x) => !!x && !!LINES[x.line] && poolOf(b, SLOT_CLASS[i]).lines.indexOf(x.line) >= 0 && !(x.line === 'genusDb' && val.bossGenus !== b);
    const zero = () => ({ crit: 0, acc: 0, pool: 0, other: 0 });
    const put = (t, uv, b, line, roll) => { const g = LINES[line].grp; if (g === 'crit') t.crit += critPts(uv, line, roll); else if (g === 'acc') t.acc += roll; else if (g === 'pool') t.pool += roll; else t.other += unitOn(uv, b, line) * roll; };
    // what is locked, and what is on the boards at all (crit-only lines priced at the crit they sit on now)
    const cur = zero(), now = zero();
    let critSeen = 0;
    for (const b of BOARD_KEYS) { const sl = boards[b]; if (!sl) continue; for (let i = 1; i <= 9; i++) { const x = sl[i]; if (useful(b, i, x) && LINES[x.line].grp === 'crit') critSeen += critPts(u0, x.line, +x.val || 0); } }
    const uNow = units(val, 0, 0, 0, critSeen);
    for (const b of BOARD_KEYS) {
      const sl = boards[b]; if (!sl) continue;
      for (let i = 1; i <= 9; i++) { const x = sl[i]; if (!useful(b, i, x)) continue; put(now, uNow, b, x.line, +x.val || 0); if (x.locked) put(cur, uNow, b, x.line, +x.val || 0); }
    }

    function evalAt(pr, keep) {
      const uv = units(val, pr.uc, pr.ua, pr.up, pr.critLvl), per = {}, addT = zero(); let cost = 0, presses = 0;
      for (const b of BOARD_KEYS) {
        const sl = boards[b] || blankBoard(), st = boardState(sl);
        const unit = (id) => unitOn(uv, b, id);
        const fine = CLASSES.map((cl) => classAtoms(poolOf(b, cl), unit, lam));
        const sol = solveBoard(fine, st.dead);
        const vis = []; let locked = 0;
        for (let i = 1; i <= 9; i++) {
          const x = sl[i], k = CLASSES.indexOf(SLOT_CLASS[i]), v = useful(b, i, x) ? unit(x.line) * (+x.val || 0) : 0;
          if (x && x.locked) locked += v; else if (k >= 0 && v > 0) vis.push({ slot: i, k, v: lam * v, line: x.line, roll: +x.val || 0 });
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
        let next = st.idx; const lockNow = [], t = zero();
        for (let i = 0; i < vis.length; i++) if (bm < 0 || (bm & (1 << i))) {
          const x = vis[i];
          if (bm >= 0) { next += STRIDE[x.k]; lockNow.push(x.slot); }
          put(t, uv, b, x.line, x.roll);
        }
        const fw = bm < 0 ? { cost: 0, presses: 0, v: 0, vc: 0, va: 0, vp: 0, visits: [], chain: null } : forward(sol, next, keep && cfg.spread > 0);
        const thr = [];
        if (bm >= 0) for (let k = 0; k < 4; k++) if (lk(next)[k] < CLASS_N[k]) thr.push(Object.assign({ k, cls: CLASSES[k] }, threshold(sol.W, next, k)));
        // would a blank board on a spare preset beat carrying on with this one?
        const started = st.idx !== 0 || st.dead > 0 || vis.length > 0;
        const fresh = started && (st.dead === 0 ? sol : solveBoard(fine, 0)).W[0] > lam * locked + best + 1e-6;
        if (pr.uc > 0) t.crit += fw.vc / lam / pr.uc;
        if (pr.ua > 0) t.acc += fw.va / lam / pr.ua;
        if (pr.up > 0) t.pool += fw.vp / lam / pr.up;
        t.other += (fw.v - fw.vc - fw.va - fw.vp) / lam;
        per[b] = { sol, state: st, next, press: bm >= 0, lockNow, thr, cost: fw.cost, presses: fw.presses, fw, unit, fresh, add: t };
        cost += fw.cost; presses += fw.presses;
        addT.crit += t.crit; addT.acc += t.acc; addT.pool += t.pool; addT.other += t.other;
      }
      return { uv, per, cost, presses, add: addT, critAdd: addT.crit, accAdd: addT.acc, poolAdd: addT.pool, pr: Object.assign({}, pr) };
    }

    const critRoom = Math.max(0, val.critHead - cur.crit), accRoom = Math.max(0, val.accHead - cur.acc);
    const cm = (x) => w * val.critMarg(x), am = (x) => w * val.accMarg(x);
    const pr = { uc: 0, ua: 0, up: cfg.start ? cfg.start.up : val.poolMarg(cur.pool), critLvl: cur.crit + (cfg.start ? cfg.start.critAdd : critRoom * 0.9) };
    let iters = 0;
    const run = () => { const x = evalAt(pr, false); iters++; pr.up = val.poolMarg(cur.pool + x.poolAdd); pr.critLvl = cur.crit + Math.min(x.critAdd, critRoom); return x; };
    /* find the price of one capped stat: where the plan lands on its cap, or, if the cap is out of reach, the slope where it ends */
    function settle(key, addKey, have, room, marg, guess) {
      const top = marg(have), tol = Math.max(1e-7, top * 0.02);
      if (!(room > 0) || !(top > 0)) { pr[key] = 0; return run(); }
      const cap = marg(have + Math.max(0, room - 1));
      let lo = { u: 0, f: -room }, hi = null, u = guess > 0 ? Math.min(guess, cap) : cap, free = false, r = null;
      for (let it = 0; it < 7; it++) {
        pr[key] = u; r = run();
        const f = r[addKey] - room;
        if (Math.abs(f) <= 0.025 * room) break;
        if (f > 0) hi = { u, f }; else { lo = { u, f }; if (u >= cap - 1e-12) { free = true; break; } }
        if (!hi) u = Math.min(cap, u * 1.6);
        else { const d = hi.u - lo.u; u = Math.min(hi.u - 0.1 * d, Math.max(lo.u + 0.1 * d, lo.u - lo.f * d / (hi.f - lo.f))); if (d <= 1e-4 * cap) break; }
      }
      if (free) for (let it = 0; it < 4; it++) {
        const want = Math.min(top, marg(have + r[addKey]));
        if (Math.abs(want - pr[key]) <= tol || r[addKey] > room) break;
        pr[key] = want; r = run();
      }
      return r;
    }
    const landed = (r, addKey, have, room, marg, key) => {
      if (!(room > 0)) return true;
      const got = r[addKey];
      if (Math.abs(got - room) <= 0.04 * room) return true;      // on the cap
      if (got > room) return false;                               // past it
      return Math.abs(Math.min(marg(have), marg(have + got)) - r.pr[key]) <= 0.04 * marg(have);   // short of it, priced at the slope there
    };
    pr.ua = accRoom > 0 ? (cfg.start ? cfg.start.ua : am(cur.acc + Math.max(0, accRoom - 1))) : 0;
    let r = settle('uc', 'critAdd', cur.crit, critRoom, cm, cfg.start ? cfg.start.uc : 0);
    for (let round = 0; round < 3; round++) {
      if (accRoom > 0) r = settle('ua', 'accAdd', cur.acc, accRoom, am, pr.ua);
      if (landed(r, 'critAdd', cur.crit, critRoom, cm, 'uc')) break;
      r = settle('uc', 'critAdd', cur.crit, critRoom, cm, pr.uc);
      if (!(accRoom > 0) || landed(r, 'accAdd', cur.acc, accRoom, am, 'ua')) break;
    }
    if (Math.abs(pr.up - r.pr.up) > 0.012 * (r.pr.up || 1)) r = run();
    const fin = r.pr;
    if (cfg.spread > 0) r = evalAt(fin, true);
    // damage: the curves for the three curved stats, the unit prices for the rest
    const a = r.add;
    const cG = val.critAt(cur.crit + a.crit) - val.critAt(cur.crit), aG = val.accAt(cur.acc + a.acc) - val.accAt(cur.acc), pG = val.poolAt(cur.pool + a.pool) - val.poolAt(cur.pool);
    const rc = a.crit > 0 ? cG / a.crit : 0, ra = a.acc > 0 ? aG / a.acc : 0, rp = a.pool > 0 ? pG / a.pool : 0;
    for (const b of BOARD_KEYS) { const pb = r.per[b], t = pb.add; pb.gain = t.other + t.pool * rp + w * (t.crit * rc + t.acc * ra); }
    const worth = (t, k) => t.other + val.poolAt(t.pool) + k * (val.critAt(t.crit) + val.accAt(t.acc));
    const end = { crit: cur.crit + a.crit, acc: cur.acc + a.acc, pool: cur.pool + a.pool, other: cur.other + a.other };
    const res = { lam, val, uv: r.uv, per: r.per, cost: r.cost, presses: r.presses, kina: r.cost * KINA_PER_CRYSTAL,
      locked: worth(cur, w), now: worth(now, w), total: worth(end, w), real: worth(end, 1), realNow: worth(now, 1),
      cur, add: a, end, critAdd: a.crit, accAdd: a.acc, poolAdd: a.pool, critRoom, accRoom, prices: fin, iters,
      next: { uc: fin.uc, ua: fin.ua, up: fin.up, critAdd: Math.min(a.crit, critRoom) } };
    res.gain = res.total - res.locked;
    if (cfg.spread > 0) {
      const rand = rng(20261122), runs = [];
      for (let n = 0; n < cfg.spread; n++) { let t = 0; for (const b of BOARD_KEYS) { const pb = res.per[b]; if (pb.press && pb.fw.chain) t += simulate(pb.fw.chain, pb.next, rand); } runs.push(t); }
      runs.sort((x, y) => x - y);
      res.spread = { lo: runs[Math.floor(runs.length * 0.1)], hi: runs[Math.floor(runs.length * 0.9)] };
    }
    return res;
  }

  /* the plan at a ladder of prices; each rung starts from the one before */
  const LADDER = [500, 1500, 3500, 7000, 12000, 19000, 29000, 44000, 66000, 100000, 160000, 260000, 420000];
  function sweep(A2, inputs, opts, boards, lams) {
    const pts = [], val = valuer(A2, inputs, opts); let start = null;
    for (const lam of lams || LADDER) {
      const r = plan(A2, inputs, opts, lam, boards, { start, val });
      start = r.next;
      pts.push({ lam, cost: r.cost, total: r.total, real: r.real, gain: r.gain, locked: r.locked, iters: r.iters });
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

  /* a set of boards with the best line at its top roll in every slot, by counted damage. Slots are filled one at a
     time against the curves and revisited, so Critical Hit and Accuracy stop at their caps. */
  function perfect(A2, inputs, opts) {
    const val = valuer(A2, inputs, opts), w = val.w, t = { crit: 0, acc: 0, pool: 0, other: 0 };
    const uv = units(val, 0, 0, 0, val.critHead);              // crit-only lines at the cap's crit rate
    const worth = (x, k) => x.other + val.poolAt(x.pool) + k * (val.critAt(x.crit) + val.accAt(x.acc));
    const move = (b, pk, sign) => { if (!pk) return; const g = LINES[pk.line].grp; if (g === 'crit') t.crit += sign * critPts(uv, pk.line, pk.roll); else if (g === 'acc') t.acc += sign * pk.roll; else if (g === 'pool') t.pool += sign * pk.roll; else t.other += sign * unitOn(uv, b, pk.line) * pk.roll; };
    const picks = {};
    for (const b of BOARD_KEYS) picks[b] = [null, null, null, null, null, null, null, null, null, null];
    for (let pass = 0; pass < 4; pass++) for (const b of BOARD_KEYS) for (let i = 1; i <= 9; i++) {
      move(b, picks[b][i], -1);
      const base = worth(t, w); let best = null, bv = 1e-9;
      for (const id of poolOf(b, SLOT_CLASS[i]).lines) {
        if (id === 'genusDb' && val.bossGenus !== b) continue;
        const pk = { line: id, roll: LINES[id].h[1] };
        move(b, pk, 1); const v = worth(t, w) - base; move(b, pk, -1);
        if (v > bv) { bv = v; best = pk; }
      }
      picks[b][i] = best; move(b, best, 1);
    }
    return { picks, amounts: t, total: worth(t, w), real: worth(t, 1) };
  }

  const api = { ODDS, LOCK_EXTRA, KINA_PER_CRYSTAL, pressCost, LINES, BOARDS, BOARD_KEYS, SLOT_CLASS, CLASSES, CLASS_N, CLASS_SLOTS, STRIDE, NS,
    poolOf, lineName, OPTS, LEFT_OUT, valuer, units, units0, unitOn, critPts, classAtoms, coarsen, solveBoard, forward, threshold, lk, lockCount, openSlots, validState,
    blankBoard, boardState, plan, sweep, LADDER, priceFor, perfect, rng, simulate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.A2G = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
