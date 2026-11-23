const A2 = require('./model.js');
const { PRESETS } = require('./presets.js');

const f = (x, d = 3) => (x * 100).toFixed(d) + '%';
let fails = 0;
function check(label, got, lo, hi) {
  const ok = got >= lo && got <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${f(got).padStart(9)}   published ${f(lo, 2)}–${f(hi, 2)}`);
}

// ---------- 1. KR endgame reference: reproduce the published per-stat figures ----------
{
  const i = PRESETS.kr.values;
  const s = A2.toState(i), p = A2.toParams(i);
  const P = A2.parts(s, p);
  console.log('KR reference: Peff', P.Peff.toFixed(0), 'sE', P.sE.toFixed(3), 'pool', P.pool.toFixed(2), 'dEff', P.dEff.toFixed(2), 'q', P.q.toFixed(2), 'M', P.M.toFixed(2));
  const g = (stat, amt) => A2.gain1(s, p, stat, amt);
  check('+1% Double Chance', g('dbl', 1), 0.0060, 0.0065);
  check('+1% Back/Front Damage Boost (75% uptime)', g('posDb', 1), 0.0057, 0.0065);
  check('+1% Weapon Damage Boost', g('wdb', 1), 0.0050, 0.0055);
  check('+1% Critical Damage Boost', g('critDmg', 1), 0.0040, 0.0045);
  check('+1% Damage Boost', g('db', 1), 0.0030, 0.0036);
  check('+10 Attack', g('atk', 10), 0.0016, 0.0018);
  check('+10 Max Attack', g('maxAtk', 10), 0.00125, 0.0014);
  check('+10 Attack Bonus', g('atkBonus', 10), 0.0009, 0.0011);
  check('+1% Perfect', g('perfect', 1), 0.0007, 0.0010);
  // power shard: 5% listed -> ~4.65% measured (relative to no shard)
  const i0 = Object.assign({}, i, { shard: 0 }), i5 = Object.assign({}, i, { shard: 5 }), i10 = Object.assign({}, i, { shard: 10 });
  const d0 = A2.dmg(A2.toState(i0), A2.toParams(i0));
  check('Power Shard 5% vs none', A2.dmg(A2.toState(i5), A2.toParams(i5)) / d0 - 1, 0.0455, 0.0475);
  check('Superior shard 10% vs none (8.9 published)', A2.dmg(A2.toState(i10), A2.toParams(i10)) / d0 - 1, 0.085, 0.095);
  check('+1% Multi-hit, chained model at 38%', g('multiHit', 1), 0.0030, 0.0036);
}

// ---------- 2. closed forms agree with the finite-difference engine ----------
{
  const i = PRESETS.paroxysmal.values;
  const s = A2.toState(i), p = A2.toParams(i), P = A2.parts(s, p);
  const near = (label, a, b) => { const ok = Math.abs(a - b) < 1e-9; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} closed form: ${label.padEnd(30)} ${f(a, 4)} vs ${f(b, 4)}`); };
  near('Double', A2.gain1(s, p, 'dbl', 1), 0.01 / P.dblMult);
  near('Damage Boost pool', A2.gain1(s, p, 'db', 1), 0.01 / P.pool);
  near('Weapon Damage Boost', A2.gain1(s, p, 'wdb', 1), 0.01 / (1 + P.wEff) * (P.E * (1 + s.I) * p.k * 1) / (P.e / (P.critF * P.posF)) * 1);
  near('Crit Damage', A2.gain1(s, p, 'critDmg', 1), 0.01 * P.q / P.critF);
  near('Attack Increase', A2.gain1(s, p, 'atkInc', 1), 0.01 / (1 + s.I) * P.sT);
  near('Combat Speed', A2.gain1(s, p, 'combatSpeed', 1), 0.01 * p.csEff / (1 + s.cs));
  near('Multi-hit', A2.gain1(s, p, 'multiHit', 1), 0.01 * p.mhElig * p.mhBonus / P.MH);
  console.log('Paroxysmal:', JSON.stringify(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]))));
  for (const k of Object.keys(A2.STATS)) console.log('  ', A2.STATS[k].name.padEnd(32), '+' + A2.STATS[k].step, f(A2.gain1(s, p, k, A2.STATS[k].step)));
}

// ---------- 3. second tester (161% DB, dummy vs boss): tolerance model ----------
{
  // 1/(1+1.61-t): dummy 0.40% -> t≈0.11 ; boss 0.53% -> t≈0.72
  const tD = 1 + 1.61 - 1 / 0.40, tB = 1 + 1.61 - 1 / 0.53;
  console.log('implied tolerance, second tester: dummy', tD.toFixed(3), 'boss', tB.toFixed(3));
}

// ---------- 4. manastones ----------
{
  const i = PRESETS.paroxysmal.values;
  const s = A2.toState(i), p = A2.toParams(i);
  const o = A2.stoneOutcomes(s, p, 'superior');
  const tot = o.reduce((a, x) => a + x.prob, 0);
  console.log('superior outcomes prob total', tot.toFixed(4));
  const wdb1 = o.find(x => x.stat === 'wdb' && x.value === 1);
  check('P(Weapon Damage Boost +1%) per engrave = 0.075%', wdb1.prob, 0.00075 - 1e-9, 0.00075 + 1e-9);
  const r = A2.stoneRules(o, 7000, 400000);
  for (const x of r.rules) console.log('  rule ≥', f(x.threshold, 4), `(${x.worst.label} +${x.worst.value})`, 'P', f(x.pAcc, 3), 'engraves', x.engraves.toFixed(1), 'E[gain]', f(x.eGain, 4), 'kinah', Math.round(x.kinah), 'per1%', Math.round(x.kinahPerPct), 'net', Math.round(x.net));
  console.log('  best:', r.best && r.best.worst.label, r.best && r.best.worst.value);
  // brute-force the optimal stopping value to confirm the reservation rule is optimal
  let V = 0; for (let it = 0; it < 20000; it++) { V = -7000 + o.reduce((a, x) => a + x.prob * Math.max(x.gain * 100 * 400000, V), 0); }
  const ok = r.best ? Math.abs(V - r.best.net) < 1 : V <= 0; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} value iteration`, Math.round(V), 'vs best rule net', r.best && Math.round(r.best.net));
}


// ---------- 5. rotation split and the crit threshold ----------
{
  const i = PRESETS.paroxysmal.values, s = A2.toState(i), p = A2.toParams(i), P = A2.parts(s, p);
  const near = (label, a, b, tol = 1e-9) => { const ok = Math.abs(a - b) < tol; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${f(a, 4)} vs ${f(b, 4)}`); };
  const F = (1 - s.cdr) / (1 - s.cdr - 0.01) - 1;
  near('cooldown +1 pt = (1 - eps) x extra casts', A2.gain1(s, p, 'cooldown', 1), (1 - p.csEff) * F);
  near('speed share + cooldown share = 1', A2.gain1(s, p, 'combatSpeed', 1) * (1 + s.cs) / 0.01 + A2.gain1(s, p, 'cooldown', 1) / F, 1);
  near('unbuffed crit rate on Ludra is zero', P.c, 0);
  const i2 = Object.assign({}, i, { critBuff: 300 });
  near('with +300 from buffs: (974 + 300 - 1200) / 10', A2.parts(A2.toState(i2), A2.toParams(i2)).c, 0.074);
  near("3 Wisdom alone = 0.3 / (100 + Double - the target's Double Resist)", A2.gain1(s, p, 'wisdom', 3), 0.003 / P.dblMult);
}

// ---------- 6. the Attack stat in the character window ----------
{
  const near = (label, a, b, tol) => { const ok = Math.abs(a - b) <= tol; if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(58)} ${a.toFixed(1)} vs ${b}`); };
  // Inven (Korea), gear on / gear off method: window 6,000 at 75% Attack Increase, 500 with gear off at 20%
  const N = 500 / 1.2;
  const kr = Object.assign({}, PRESETS.kr.values, { sheetAtk: 6000, atkInc: 75, atkBonus: N, baseAtk: 0, wdb: 30, shard: 0, psdb: 0, flatPve: 0, perfect: 0, rangeW: 0 });
  const s = A2.toState(kr), P = A2.parts(s, A2.toParams(kr));
  near('Inven example: gear Attack', s.P, 3012, 0.5);
  near('Inven example: real Attack with 30% Weapon Damage Boost', P.A0, 7582, 1.5);
  // the window does not move with Weapon Damage Boost
  const s2 = A2.toState(Object.assign({}, kr, { wdb: 0 }));
  near('Pure Attack read from the window is the same at 0% boost', s2.P, s.P, 1e-9);
  // Inven (Korea), weapon swap: +25.5 average weapon Attack, closet 21.2%, Attack Increase 101.4% -> window 9,721 to 9,784
  near('Korean weapon swap: window moves by 25.5 x 1.212 x 2.014', 25.5 * 1.212 * 2.014, 63, 1.5);
  // Bahamut (Taiwan): staff (232-319) x 1.035 closet + 125 + 4, Attack Increase 21.2% with it and 18.1% without, 1,340 without
  near('Taiwanese rebuild of the window with the staff on', 1340 * 1.212 / 1.181 + ((232 + 319) / 2 * 1.035 + 125 + 4) * 1.212, 1877.1, 0.1);
  // Bu (Global): gear 1,848.5 + bonus 239 + base 237 at 17.1%
  const bu = A2.toState(PRESETS.bu.values);
  near('Bu: Pure Attack from the 2,722 in her window', bu.P, 1848.5, 0.1);
  for (const k of ['sorc', 'paroxysmal']) { const v = PRESETS[k].values, st = A2.toState(v); console.log('     ', k, 'window', v.sheetAtk, '-> Pure', st.P.toFixed(1)); }
}

// ---------- Global reference: reproduce Aion 2 Maps' measured per-stat figures for one Ranger ----------
// Tier 4 Transcendence and Conquest [Hard] bosses, Global build of 2026-10-28. Critical Hit is left out: the published
// figure mixes skills at the cap with skills below it, which one crit rate cannot stand for.
{
  const g = PRESETS.global.values;
  const tier4 = g, hard = Object.assign({}, g, { tol: 62.5, def: 9450, dblRes: 5, uptime: 72 });
  const rows = [
    ['+1% Double Chance', 'dbl', 1, 0.78, 0.83], ['+1% Front Attack Damage Boost', 'posDb', 1, 0.76, 0.72], ['+1% Attack Increase', 'atkInc', 1, 0.62, 0.64],
    ['+1% Weapon Damage Boost', 'wdb', 1, 0.54, 0.56], ['+1% Damage Boost', 'db', 1, 0.51, 0.55], ['+1% Critical Damage Boost', 'critDmg', 1, 0.34, 0.34],
    ['+10 Attack', 'atk', 10, 0.27, 0.27], ['+10 Boss Attack', 'flatPve', 10, 0.13, 0.14], ['+100 Penetration', 'pen', 100, 0.17, 0.18],
    ['+1% Multi-hit Chance', 'multiHit', 1, 0.12, 0.11], ['+1% Perfect Chance', 'perfect', 1, 0.08, 0.08]
  ];
  console.log('\nGlobal reference (Aion 2 Maps, one Ranger at about 225,000 Combat Power)');
  for (const [label, stat, step, m4, mh] of rows) {
    const tol = stat === 'multiHit' ? 0.15 : 0.09;     // the published figures carry two digits, so about 4% of rounding alone
    for (const [name, inp, m] of [['tier 4', tier4, m4], ['Conquest Hard', hard, mh]]) {
      const got = A2.gain1(A2.toState(inp), A2.toParams(inp), stat, step);
      check(`${label}, ${name}`, got, m / 100 * (1 - tol), m / 100 * (1 + tol));
    }
  }
  // the question that started this: 10 Boss Attack is worth half of 10 Attack on this sheet, as measured
  const s = A2.toState(tier4), p = A2.toParams(tier4);
  const ratio = A2.gain1(s, p, 'flatPve', 10) / A2.gain1(s, p, 'atk', 10);
  const ok = ratio > 0.43 && ratio < 0.55; if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} Boss Attack against Attack, per point                ${ratio.toFixed(3)}   measured 0.48 to 0.52`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
