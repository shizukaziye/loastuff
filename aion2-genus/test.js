/* node test.js — checks the Genus solver against published figures, its own bookkeeping and a play-through of the real rolls. */
const A2 = require('../aion2-damage-math/model.js');
const { PRESETS } = require('../aion2-damage-math/presets.js');
const G = require('./genus.js');

let fails = 0;
function check(label, got, lo, hi, d = 0) {
  const ok = got >= lo && got <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(58)} ${got.toFixed(d).padStart(11)}   want ${lo.toFixed(d)} to ${hi.toFixed(d)}`);
}

// ---------- 1. press costs read in the client ----------
check('press, nothing locked', G.pressCost(0), 36, 36);
check('press, 4 locked', G.pressCost(4), 96, 96);
check('press, 5 locked', G.pressCost(5), 172, 172);
check('press, 7 locked', G.pressCost(7), 324, 324);

// ---------- 2. Raid Relay's finished-board table: four chosen lines (slots 4, 1, 5, 7), any value ----------
function chosen(p15, p4, p7) {
  const BIG = 1e9, one = (p) => [{ p, v: BIG, vc: 0, vp: 0 }];
  const sol = G.solveBoard([one(p15), [], one(p4), one(p7)], 0);
  return G.forward(sol, 0).cost;
}
check('four chosen Heroic lines, monster board (RR 25,500)', chosen(0.05 / 10, 0.05 / 14, 0.05 / 14), 25000, 25800);
check('four chosen Unique or better (RR 6,300)', chosen(0.2 / 10, 0.2 / 14, 0.2 / 14), 6150, 6450);
check('Special board is about 2,400 cheaper (RR)', chosen(0.05 / 10, 0.05 / 14, 0.05 / 14) - chosen(0.05 / 10, 0.05 / 12, 0.05 / 12), 2000, 2800);

// ---------- 3. line values on Paroxysmal's sheet against Ludra, with Marking Shot's 300 Critical Hit ----------
const inputs = Object.assign({}, PRESETS.paroxysmal.values, { critBuff: 300 });
const opts = { front: 50, back: 50, bossGenus: 'cogni', accPer100: 0 };
const val = G.valuer(A2, inputs, opts), uv = G.units0(val);
check('Double Chance 3%', uv.u.dbl * 3, 2.5, 2.9, 2);
check('PvE Damage Boost 4%', uv.u.pveDb * 4, 2.4, 2.9, 2);
check('Critical Hit 30, first line', uv.u.critHit * 30, 2.3, 2.9, 2);
check('Damage Boost 3%', uv.u.db * 3, 1.8, 2.2, 2);
check('Critical Damage Boost 3%', uv.u.critDb * 3, 0.1, 1.1, 2);
check('PvE Attack 20', uv.u.pveAtk * 20, 0.30, 0.42, 3);
check('Attack Bonus 16', uv.u.atkBonus * 16, 0.28, 0.42, 3);
check('Max Attack 20', uv.u.maxAtk * 20, 0.28, 0.42, 3);
check('Critical Hit to the cap', val.critHead, 425, 427);
check('past the cap a point of Critical Hit is worth nothing', val.critMarg(430), 0, 0, 4);

// ---------- 4. the solver's books balance: price x gain - cost = the value it reports ----------
const LAM = 20000;
function board(b, lam, uvx) {
  const unit = (id) => G.unitOn(uvx, b, id);
  return G.solveBoard(G.CLASSES.map((cl) => G.classAtoms(G.poolOf(b, cl), unit, lam)), 0);
}
for (const b of ['cogni', 'special']) {
  const sol = board(b, LAM, uv), fw = G.forward(sol, 0);
  check(`${b}: value - cost against W, relative gap x1e6`, Math.abs(fw.v - fw.cost - sol.W[0]) / sol.W[0] * 1e6, 0, 1, 3);
}

// ---------- 5. play the real rolls with the solver's rules: the bill and the gain match what it expects ----------
function play(b, lam, uvx, runs, seed) {
  const sol = board(b, lam, uvx), W = sol.W, rand = G.rng(seed), unit = (id) => G.unitOn(uvx, b, id);
  let cost = 0, val = 0;
  for (let n = 0; n < runs; n++) {
    let idx = 0;
    for (;;) {
      if (!(W[idx] > 0)) break;
      cost += G.pressCost(G.lockCount(idx));
      const open = G.openSlots(idx), cs = [], vs = [];
      for (const k of open) {
        const pool = G.poolOf(b, G.CLASSES[k]), g = rand(), grade = g < 0.05 ? 'h' : g < 0.2 ? 'u' : null;
        if (!grade) continue;
        const id = pool.lines[Math.floor(rand() * pool.size)];
        if (!id || !(unit(id) > 0)) continue;
        const r = G.LINES[id][grade];
        cs.push(k); vs.push(lam * unit(id) * (r[0] + (r[1] - r[0]) * rand()));
      }
      let stop = 0; for (const v of vs) stop += v;
      let best = Math.max(stop, W[idx]), bm = stop >= W[idx] ? -1 : 0;
      for (let m = 1; m < (1 << vs.length); m++) {
        let sum = 0, j = idx;
        for (let i = 0; i < vs.length; i++) if (m & (1 << i)) { sum += vs[i]; j += G.STRIDE[cs[i]]; }
        if (sum + W[j] > best) { best = sum + W[j]; bm = m; }
      }
      if (bm === 0) continue;
      if (bm < 0) { val += stop; break; }
      for (let i = 0; i < vs.length; i++) if (bm & (1 << i)) { val += vs[i]; idx += G.STRIDE[cs[i]]; }
    }
  }
  return { cost: cost / runs, val: val / runs, sol };
}
for (const [b, seed] of [['cogni', 7], ['special', 11]]) {
  const r = play(b, LAM, uv, 4000, seed), fw = G.forward(r.sol, 0);
  check(`${b}: played bill / expected bill`, r.cost / fw.cost, 0.93, 1.07, 3);
  check(`${b}: played gain / expected gain`, r.val / fw.v, 0.95, 1.05, 3);
  check(`${b}: played net / solver value`, (r.val - r.cost) / r.sol.W[0], 0.95, 1.05, 3);
}

// ---------- 6. the whole plan ----------
const t0 = Date.now(), pts = G.sweep(A2, inputs, opts, null, G.LADDER), tSweep = Date.now() - t0;
let mono = 1;
for (let i = 1; i < pts.length; i++) if (!(pts[i].cost >= pts[i - 1].cost * 0.98 && pts[i].total >= pts[i - 1].total - 0.15)) mono = 0;
check('a higher price never buys less', mono, 1, 1);
const perf = G.perfect(A2, inputs, opts);
const lam100 = G.priceFor(pts, 100000), p100 = G.plan(A2, inputs, opts, lam100, null, { spread: 400 });
check('the 100,000 plan spends about 100,000', p100.cost, 90000, 110000);
check('the 100,000 plan: share of a perfect set, %', p100.total / perf.total * 100, 60, 95, 1);
check('the plan stops at the crit cap', p100.critAdd, 300, val.critHead * 1.06);
check('spread brackets the mean', (p100.spread.lo < p100.cost && p100.spread.hi > p100.cost) ? 1 : 0, 1, 1);
// the same plan from a cold start and from a neighbour's prices must agree
const cold = G.plan(A2, inputs, opts, 15000, null, {}), warm = G.plan(A2, inputs, opts, 15000, null, { start: { uc: cold.uc * 0.5, up: cold.up * 1.2 } });
check('cold and warm starts agree on damage, %', Math.abs(cold.total - warm.total), 0, 0.2, 3);
check('cold and warm starts agree on the bill, ratio', warm.cost / cold.cost, 0.97, 1.03, 3);
// a board that is already good should be left alone at a low price, and worked on at a high one
const mine = {}; for (const b of G.BOARD_KEYS) mine[b] = G.blankBoard();
Object.assign(mine.cogni[4], { line: 'pveDb', val: 3.6, locked: true }); Object.assign(mine.cogni[3], { line: 'critHit', val: 26, locked: true });
Object.assign(mine.cogni[6], { line: 'critHit', val: 12, locked: false });
const lowP = G.plan(A2, inputs, opts, 300, mine, {}), highP = G.plan(A2, inputs, opts, 30000, mine, {});
check('low price: stop on the started board', lowP.per.cogni.press ? 1 : 0, 0, 0);
check('high price: keep pressing it', highP.per.cogni.press ? 1 : 0, 1, 1);
check('locked lines count as damage held', highP.locked, 3.5, 5.5, 2);
console.log(`\nsweep ${tSweep} ms, solves per rung ${pts.map((p) => p.iters).join(' ')}`);
console.log(`perfect set +${perf.total.toFixed(1)}%   100k plan +${p100.total.toFixed(1)}% at ${Math.round(lam100)} crystals per 1%, 80% of runs ${Math.round(p100.spread.lo)} to ${Math.round(p100.spread.hi)}, crit added ${p100.critAdd.toFixed(0)} of ${val.critHead.toFixed(0)}`);
for (const p of pts) console.log(`  price ${String(p.lam).padStart(6)}  crystals ${String(Math.round(p.cost)).padStart(8)}  +${p.total.toFixed(2)}%  ${(p.total / perf.total * 100).toFixed(1)}% of perfect`);

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
