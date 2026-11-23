/* Aion 2 damage model — community-tested formula (kanonxo / Aion Research Lab,
   TW Bahamut tests, Grobs' Global-client mapping). Pure functions, no DOM. */
(function (root) {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const pct = (x) => (Number(x) || 0) / 100;
  const num = (x) => Number(x) || 0;

  /* ---- inputs (as typed, percentages as whole numbers) -> canonical state ---- */
  function toState(i) {
    const I = pct(i.atkInc);
    // Everything Attack Increase multiplies but Weapon Damage Boost does not: the Attack Bonus line of the stat window
    // (Daevanion, wings, titles) plus the Attack a character has with no gear on (level, class, collections).
    const AB = num(i.atkBonus) + num(i.baseAtk);
    // The Attack stat in the character window = (Pure Attack + Attack Bonus + base Attack) x (1 + Attack Increase), with the
    // weapon at the middle of its range. Weapon Damage Boost, the Power Shard and PvE, Boss or positional Attack are not in it.
    // Korean and Taiwanese tests: removing Weapon Damage Boost leaves the stat unchanged, and +5 Max Attack moves it by 2.5 x (1 + I).
    const R = Math.max(0, num(i.rangeW));
    const P = Math.max(0, num(i.sheetAtk) / (1 + I) - AB);
    const Pmax = P + R / 2;
    return {
      // Power Shard: 5% or 10% on Pure Attack, plus Power Shard Damage Bonus at 100 points = 1% (Grobs' mapping)
      P, Pmax, R, pf: pct(i.perfect), w: pct(i.wdb), sh: pct(i.shard) > 0 ? pct(i.shard) + num(i.psdb) / 10000 : 0,
      AB, I,
      fAlways: num(i.flatPve), fPos: num(i.flatPos), fCrit: num(i.flatCrit),
      db: pct(i.db), pve: pct(i.pveDb), boss: pct(i.bossDb),
      // crit rate: a measured value, or (Critical Hit + buffs - target resist) at ccPer100 percent per 100 points.
      // It may sit below zero, which means no crits until the rating passes the resist.
      cc: i.critMode === 'manual' ? pct(i.critChance) : (num(i.critRating) + num(i.critBuff) - num(i.critRes)) * num(i.ccPer100) / 10000, cd: pct(i.critDmg),
      dbl: pct(i.dbl), fb: pct(i.posDb), up: pct(i.uptime),
      mh: pct(i.multiHit), cs: pct(i.combatSpeed), pen: num(i.pen), cdr: pct(i.cdr)
    };
  }

  function toParams(i) {
    return {
      tol: pct(i.tol), dblRes: pct(i.dblRes), cdTol: pct(i.cdTol), wTol: pct(i.wTol), def: num(i.def),
      k: num(i.skillCoef) || 1, S: num(i.skillFlat),
      g: clamp(pct(i.gCrit), 0, 1), cap: clamp(pct(i.critCap), 0, 1), ccPer100: num(i.ccPer100),
      pDb: pct(i.partyDb), pDbl: pct(i.partyDbl), pCd: pct(i.partyCd),
      dblModel: i.dblModel === 'mul' ? 'mul' : 'sub',
      mhBase: pct(i.mhBase), mhBonus: pct(i.mhBonus), mhElig: clamp(pct(i.mhElig), 0, 1),
      mhPos: i.mhPos === 'in' ? 'in' : 'out',
      mhModel: i.mhModel === 'chain' ? 'chain' : 'flat',
      pfHidden: pct(i.pfHidden),
      csEff: clamp(pct(i.csEff), 0, 1), csRef: pct(i.combatSpeed), cdRef: pct(i.cdr),
      deityPer: num(i.deityPer) || 0.1,
      critBase: num(i.critRating) / (1 + pct(i.critInc))
    };
  }

  /* expected extra damage from chained Multi-hit at chance m: m(1-m)t1 + m^2(1-m)t2 + m^3(1-m)t3 + m^4 t4 */
  const MH_TIERS = [0.11, 0.25, 0.43, 0.67];
  function mhChain(m) {
    let e = 0;
    for (let n = 1; n <= 4; n++) e += Math.pow(m, n) * (n < 4 ? 1 - m : 1) * MH_TIERS[n - 1];
    return e;
  }

  /* ---- every intermediate quantity, for the worked formula ---- */
  function parts(s, p) {
    const pf = clamp(s.pf, 0, 1);
    const Peff = (s.P + pf * s.R / 2) * (1 + pf * p.pfHidden);
    // Multi-hit. 'flat': one proc at (hidden base + sheet chance) adds a fixed bonus. 'chain': each extra hit rolls the sheet
    // chance again, up to four, and n extra hits add MH_TIERS[n - 1] in total (the figures Korea's aion2tool uses for dungeons).
    const chain = p.mhModel === 'chain';
    const mhP = clamp((chain ? 0 : p.mhBase) + s.mh, 0, 1);
    const mhAvg = chain ? mhChain(mhP) : mhP * p.mhBonus;
    const MH = 1 + p.mhElig * mhAvg;
    const wEff = Math.max(-1, s.w - p.wTol);
    let E = Peff * (1 + wEff) * (1 + s.sh);
    if (p.mhPos === 'in') E *= MH;
    const T = E + s.AB;
    const A0 = T * (1 + s.I) + s.fAlways;
    const D = 0.1 * Math.max(0, p.def - s.pen);
    const hit = (A) => Math.max(0, A * p.k + p.S - D);
    const c = clamp(s.cc, 0, p.cap);
    const q = p.g + (1 - p.g) * c;
    const M = Math.max(1, 1.5 + s.cd + p.pCd - p.cdTol);
    const u = clamp(s.up, 0, 1);
    let e = 0;
    const states = [[(1 - q) * (1 - u), 0, 0], [(1 - q) * u, 0, 1], [q * (1 - u), 1, 0], [q * u, 1, 1]];
    for (const [pr, cr, po] of states) {
      if (pr <= 0) continue;
      // Front, Back and Critical Attack are flat damage added after the skill multiplier (Aion 2 Maps on Global;
      // Korean and Taiwanese tests place Back and Critical Attack the same way)
      const flat = (po ? s.fPos : 0) + (cr ? s.fCrit : 0);
      e += pr * Math.max(0, A0 * p.k + p.S - D + flat) * (cr ? M : 1) * (po ? 1 + s.fb : 1);
    }
    const baseHit = hit(A0);
    const pool = Math.max(0.05, 1 + s.db + s.pve + s.boss + p.pDb - p.tol);
    const dRaw = s.dbl + p.pDbl;
    const dEff = clamp(p.dblModel === 'mul' ? dRaw * (1 - p.dblRes) : dRaw - p.dblRes, 0, 1);
    const dblMult = 1 + dEff;
    const speed = 1 + s.cs;
    // Rotation. Combat Speed shortens every cast and the freed time goes to fillers; cooldown reduction adds casts of
    // cooldown skills and takes that time back from fillers. With eps = filler damage share / filler time share,
    // a relative cast speed-up is worth eps of itself and a relative cooldown speed-up is worth 1 - eps.
    const cdr = clamp(s.cdr, 0, 0.6), cdr0 = clamp(p.cdRef, 0, 0.6);
    const rot = 1 + p.csEff * ((1 + s.cs) / (1 + p.csRef) - 1) + (1 - p.csEff) * ((1 - cdr0) / (1 - cdr) - 1);
    const speedRel = rot;
    const critF = 1 + q * (M - 1);
    const posF = 1 + s.fb * u;
    let total = e * pool * dblMult * rot;
    if (p.mhPos === 'out') total *= MH;
    // share of the (non-conditional) hit that comes from boosted equipment attack / from inside Attack Increase
    const sE = baseHit > 0 ? (E * (1 + s.I) * p.k) / baseHit : 0;
    const sT = baseHit > 0 ? (T * (1 + s.I) * p.k) / baseHit : 0;
    return { Peff, pf, mhP, mhAvg, MH, wEff, E, T, A0, D, baseHit, c, q, M, u, e, pool, dRaw, dEff, dblMult,
      speed, speedRel, cdr, rot, critF, posF, total, sE, sT };
  }

  const dmg = (s, p) => parts(s, p).total;

  /* ---- stats: how one unit of each changes the canonical state ---- */
  const critPts = (p, rating) => rating * p.ccPer100 / 100 / 100; // rating -> crit-chance fraction
  const STATS = {
    atk:      { name: 'Attack', unit: '', step: 10, grp: 'attack', apply: (s, x) => { s.P += x; } },
    maxAtk:   { name: 'Max Attack', unit: '', step: 10, grp: 'attack', apply: (s, x) => { s.R += x; s.P += x / 2; } },
    atkBonus: { name: 'Attack Bonus', unit: '', step: 10, grp: 'attack', apply: (s, x) => { s.AB += x; } },
    atkInc:   { name: 'Attack Increase', unit: '%', step: 1, grp: 'attack', apply: (s, x) => { s.I += x / 100; } },
    wdb:      { name: 'Weapon Damage Boost', unit: '%', step: 1, grp: 'attack', apply: (s, x) => { s.w += x / 100; } },
    flatPve:  { name: 'PvE / Boss Attack', unit: '', step: 10, grp: 'attack', apply: (s, x) => { s.fAlways += x; } },
    flatPos:  { name: 'Back / Front Attack', unit: '', step: 10, grp: 'position', apply: (s, x) => { s.fPos += x; } },
    flatCrit: { name: 'Critical Attack', unit: '', step: 10, grp: 'crit', apply: (s, x) => { s.fCrit += x; } },
    db:       { name: 'Damage Boost (any of the pool)', unit: '%', step: 1, grp: 'pool', apply: (s, x) => { s.db += x / 100; } },
    critDmg:  { name: 'Critical Damage Boost', unit: '%', step: 1, grp: 'crit', apply: (s, x) => { s.cd += x / 100; } },
    critHit:  { name: 'Critical Hit', unit: '', step: 10, grp: 'crit', apply: (s, x, p) => { s.cc += critPts(p, x); } },
    dbl:      { name: 'Double Chance', unit: '%', step: 1, grp: 'double', apply: (s, x) => { s.dbl += x / 100; } },
    posDb:    { name: 'Back / Front Damage Boost', unit: '%', step: 1, grp: 'position', apply: (s, x) => { s.fb += x / 100; } },
    perfect:  { name: 'Perfect Chance', unit: '%', step: 1, grp: 'attack', apply: (s, x) => { s.pf += x / 100; } },
    multiHit: { name: 'Multi-hit Chance', unit: '%', step: 1, grp: 'multi', apply: (s, x) => { s.mh += x / 100; } },
    combatSpeed: { name: 'Combat Speed', unit: '%', step: 1, grp: 'speed', apply: (s, x) => { s.cs += x / 100; } },
    cooldown: { name: 'Cooldown Reduction', unit: '%', step: 1, grp: 'speed', apply: (s, x) => { s.cdr += x / 100; } },
    pen:      { name: 'Penetration', unit: '', step: 100, grp: 'defense', apply: (s, x) => { s.pen += x; } },
    // attribute and deity points (Global client: 0.1% per point)
    might:    { name: 'Might', unit: ' pt', step: 1, grp: 'points', apply: (s, x) => { s.I += x * 0.001; } },
    precision:{ name: 'Precision', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.cc += critPts(p, x * 0.001 * p.critBase); } },
    destruction: { name: 'Destruction [Zikel]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.I += x * p.deityPer / 100; } },
    death:    { name: 'Death [Triniel]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.cc += critPts(p, x * p.deityPer / 100 * p.critBase); } },
    wisdom:   { name: 'Wisdom [Lumiel]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.dbl += x * p.deityPer / 100; } },
    time:     { name: 'Time [Siel]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.cs += x * p.deityPer / 100; } },
    justice:  { name: 'Justice [Nezekan]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.pf += x * p.deityPer / 100; } },
    illusion: { name: 'Illusion [Kaisinel]', unit: ' pt', step: 1, grp: 'points', apply: (s, x, p) => { s.cdr += x * p.deityPer / 100; } }
  };

  function applyDeltas(s, p, deltas) {
    const t = Object.assign({}, s);
    for (const d of deltas) { const st = STATS[d.stat]; if (st && d.amount) st.apply(t, Number(d.amount), p); }
    return t;
  }

  /* relative damage gain of a set of stat changes, as a fraction (0.01 = +1%) */
  function gain(s, p, deltas, base) {
    const b = base == null ? dmg(s, p) : base;
    if (!(b > 0)) return 0;
    return dmg(applyDeltas(s, p, deltas), p) / b - 1;
  }
  const gain1 = (s, p, stat, amount, base) => gain(s, p, [{ stat, amount }], base);

  /* ---- manastones (Global client odds) ---- */
  const TIERS3 = [0.50, 0.35, 0.15];
  const STONES = {
    superior: { name: 'Superior', tiers: TIERS3, lines: [
      { stat: 'atk', label: 'Attack', chance: 0.10, values: [3, 5, 10] },
      { stat: 'critHit', label: 'Critical Hit', chance: 0.10, values: [7, 10, 15] },
      { stat: 'db', label: 'Damage Boost', chance: 0.005, values: [0.1, 0.3, 1] },
      { stat: 'wdb', label: 'Weapon Damage Boost', chance: 0.005, values: [0.1, 0.3, 1] },
      { stat: 'critDmg', label: 'Critical Damage Boost', chance: 0.005, values: [0.1, 0.3, 1] },
      { stat: 'posDb', label: 'Back / Front Damage Boost', chance: 0.005, values: [0.1, 0.3, 1] }
    ] },
    intermediate: { name: 'Intermediate', tiers: TIERS3, lines: [
      { stat: 'atk', label: 'Attack', chance: 0.10, values: [2, 4, 8] },
      { stat: 'critHit', label: 'Critical Hit', chance: 0.10, values: [6, 9, 13] }
    ] },
    lesser: { name: 'Lesser', tiers: [0.70, 0.30], lines: [
      { stat: 'atk', label: 'Attack', chance: 0.10, values: [1, 3] },
      { stat: 'critHit', label: 'Critical Hit', chance: 0.10, values: [5, 7] }
    ] }
  };

  /* every outcome of one engrave: {label, value, prob, gain}; the rest of the pool is worth 0 */
  function stoneOutcomes(s, p, kind) {
    const st = STONES[kind]; const base = dmg(s, p); const out = []; let used = 0;
    for (const ln of st.lines) ln.values.forEach((v, t) => {
      const prob = ln.chance * st.tiers[t]; used += prob;
      out.push({ label: ln.label, stat: ln.stat, value: v, unit: STATS[ln.stat].unit, prob, gain: gain1(s, p, ln.stat, v, base) });
    });
    out.push({ label: 'Any non-damage line', stat: null, value: 0, unit: '', prob: Math.max(0, 1 - used), gain: 0 });
    return out;
  }

  /* threshold ("keep rolling until the line is worth at least this") rules.
     cost: Kinah per engrave; lambda: Kinah you would pay for +1% damage. */
  function stoneRules(outcomes, cost, lambda, minProb) {
    const levels = [...new Set(outcomes.filter(o => o.gain > 1e-12 && o.prob >= (minProb || 0)).map(o => o.gain))].sort((a, b) => b - a);
    const rules = levels.map(th => {
      const acc = outcomes.filter(o => o.gain >= th - 1e-15);
      const pAcc = acc.reduce((a, o) => a + o.prob, 0);
      const eGain = acc.reduce((a, o) => a + o.prob * o.gain, 0) / pAcc;
      const engraves = 1 / pAcc;
      const kinah = engraves * cost;
      const worst = acc.reduce((m, o) => (o.gain < m.gain ? o : m), acc[0]);
      return { threshold: th, worst, pAcc, eGain, engraves, kinah,
        kinahPerPct: eGain > 0 ? kinah / (eGain * 100) : Infinity,
        net: eGain * 100 * lambda - kinah };
    });
    let best = null;
    for (const r of rules) if (!best || r.net > best.net) best = r;
    return { rules, best: best && best.net > 0 ? best : null };
  }

  const api = { clamp, MH_TIERS, mhChain, toState, toParams, parts, dmg, STATS, applyDeltas, gain, gain1, STONES, stoneOutcomes, stoneRules };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.A2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
