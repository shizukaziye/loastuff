// model.js — Hell key EV model. PURE: params in, numbers out, no DOM.
// Mirrored line-for-line by verify.py; keep names and constants in sync.
"use strict";

const GRADES = [
  { id: "common",    name: "Common",    desc: 3 },
  { id: "uncommon",  name: "Uncommon",  desc: 4 },
  { id: "rare",      name: "Rare",      desc: 5 },
  { id: "epic",      name: "Epic",      desc: 6 },
  { id: "legendary", name: "Legendary", desc: 7 },
  { id: "relic",     name: "Relic",     desc: 8 },
  { id: "ancient",   name: "Ancient",   desc: 9 },
];
const MAXD = 10;                     // Ancient (9) + one Descent+1 altar
const NBANDS = 11;                   // 0-9 ... 90-99, 100
const ALTAR_FLOORS = {
  hell:  [11, 22, 33, 44, 55, 66, 77, 88, 99],
  flame: [22, 44, 66, 88],           // flame key dies on odd floors
  frost: [11, 33, 55, 77, 99],       // frost key dies on even floors (100 exempt)
};
const ALTAR_EFFECTS = ["desc", "chest", "wealth", "rocket"];

// ---- Mechanics defaults (every one is an input on the page) ----
const MECH_DEFAULTS = {
  midUp: 0.63,                       // middle jump: chance of the big descent
  midUpMin: 16, midUpMax: 20,        // big descent range (uniform)
  midDownMin: 1, midDownMax: 5,      // ascent range (uniform)
  bonusGold: 30000, bonusStreak: 3,  // same jump distance N times in a row
  natAbundant: 0.10, abundantMult: 10,
  altarW: { desc: 20, chest: 40, wealth: 20, rocket: 20 },
  tr: { d2: 0.15, d1: 0.15, u1: 0.15, u2: 0.15, flame: 0.20, frost: 0.20 },
  chestsShown: 3,
};

// ---- Helpers ----
function bandOf(f) { return f >= 100 ? 10 : Math.floor(f / 10); }
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return Math.round(r);
}
// Chests are drawn uniformly without replacement from N categories; you take
// the best of k. P(the j-th best of N is the best shown) = C(N-1-j, k-1)/C(N,k).
function bestOfK(items, k) {           // items: [{cat, val}] -> {ev, picks:{cat:p}}
  const N = items.length, kk = Math.min(k, N);
  const sorted = items.slice().sort((a, b) => b.val - a.val);
  const tot = comb(N, kk), picks = {};
  let ev = 0;
  for (let j = 0; j < N; j++) {
    const p = comb(N - 1 - j, kk - 1) / tot;
    picks[sorted[j].cat] = p;
    ev += p * sorted[j].val;
  }
  return { ev, picks };
}

// Gold value of one chest category at a band, given a profile of unit values.
function catValue(cat, qty, U) {
  switch (cat) {
    case "stones":  return Math.max(qty * U.red, 3 * qty * U.blue); // selection chest: qty destruction OR 3·qty guardian
    case "juice":   return qty * U.juice;      // qty lava + 3·qty glacier = qty "sets"
    case "fusions": return qty * U.fusions;
    case "leap":    return qty * U.leap;
    case "gold":    return qty * U.gold;
    case "taps":    return qty * U.taps;
    case "brace":   return qty * U.brace;
    case "karma":   return qty * U.karma;
    case "astro":   return qty[0] * U.astroU + qty[1] * U.astroR + qty[2] * U.astroE;   // tiers: uncommon | rare | epic
    case "elysian": return qty * U.elysian;
    case "kits":    return qty * U.kits;
    case "books":   return qty * U.books;
    case "cards":   return qty * U.cards;
    case "gems":    return qty * U.gems;
  }
  return 0;
}
function baseValue(rw, U) {
  return (rw.b_shards || 0) * U.shards + (rw.b_red || 0) * U.red +
         (rw.b_blue || 0) * U.blue + (rw.b_leap || 0) * U.leap;
}

// Per-band values for one key + one profile. chest[k][b] = EV of best-of-k,
// picks[k][b] = pick probabilities, base[b] = guaranteed chest value.
function bandValues(key, U, mech) {
  const chest = { 3: [], 4: [] }, picks = { 3: [], 4: [] }, base = [], cats = [];
  const k1 = mech.chestsShown, k2 = mech.chestsShown + 1;
  key.bands.forEach((band, b) => {
    const items = key.chest_cats.filter(c => band.rewards[c] !== undefined)
      .map(c => ({ cat: c, val: catValue(c, band.rewards[c], U) }));
    cats.push(items);
    for (const k of [k1, k2]) {
      const r = bestOfK(items, k);
      chest[k === k1 ? 3 : 4][b] = r.ev; picks[k === k1 ? 3 : 4][b] = r.picks;
    }
    base[b] = baseValue(band.rewards, U);
  });
  return { chest, picks, base, cats };
}

// ---- The run DP ----
// State: floor f (0..100), descents left d (0..MAXD), streak s (0 = none, else
// last jump 1..20 x count 1..3), chest+1 c, wealth w, rocket r, descent+1 used u,
// lives l (netherworld only). Layer index by d; within a layer u=1 states are
// solved before u=0 (a Descent+1 altar keeps d and sets u=1).
const NS = 61, NF = 101;
const FLAGS = 32;                    // c,w,r,u,l bits
function sIdx(last, cnt) { return last === 0 ? 0 : 1 + (last - 1) * 3 + (cnt - 1); }
function sLast(s) { return s === 0 ? 0 : 1 + Math.floor((s - 1) / 3); }
function sCnt(s) { return s === 0 ? 0 : 1 + ((s - 1) % 3); }
function stIdx(f, s, c, w, r, u, l) { return ((f * NS + s) * FLAGS) + (c | (w << 1) | (r << 2) | (u << 3) | (l << 4)); }
const LAYER = NF * NS * FLAGS;

function runDP(key, bv, U, mech, element) {
  const nether = element !== "hell";
  const deadly = element === "flame" ? (f => f < 100 && (f % 2 === 1))
               : element === "frost" ? (f => f < 100 && (f % 2 === 0)) : (() => false);
  const altarAt = new Uint8Array(NF);
  ALTAR_FLOORS[element].forEach(f => altarAt[f] = 1);
  const abFactor = 1 + mech.natAbundant * (mech.abundantMult - 1);
  const bonus = mech.bonusGold * U.gold;
  // terminal value: chest pick + guaranteed chest (netherworld has none)
  function term(f, c, w) {
    const b = bandOf(f);
    const ch = c ? bv.chest[4][b] : bv.chest[3][b];
    const bs = nether ? 0 : bv.base[b] * (w ? mech.abundantMult : abFactor);
    return ch + bs;
  }
  const V = new Float64Array((MAXD + 1) * LAYER);
  const POL = new Uint8Array((MAXD + 1) * LAYER);   // 0 normal, 1 middle, 2 stop
  // altar effect pairs (ordered draw without replacement, weight-proportional)
  const W = ALTAR_EFFECTS.map(e => mech.altarW[e]);
  const wsum = W.reduce((a, b) => a + b, 0);
  const pairs = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j && W[i] > 0 && W[j] > 0)
    pairs.push([i, j, (W[i] / wsum) * (W[j] / (wsum - W[i]))]);

  // value of arriving at floor f2 with d2 descents left and flags, after altar
  function arrive(f2, d2, s2, c, w, r, u, l) {
    if (f2 >= 100 || d2 === 0) return term(f2, c, w);
    if (!altarAt[f2]) return V[d2 * LAYER + stIdx(f2, s2, c, w, r, u, l)];
    // altar: two effects offered, take the better
    const vals = [
      u ? V[d2 * LAYER + stIdx(f2, s2, c, w, r, u, l)] : V[(d2 + 1) * LAYER + stIdx(f2, s2, c, w, r, 1, l)],
      V[d2 * LAYER + stIdx(f2, s2, 1, w, r, u, l)],
      V[d2 * LAYER + stIdx(f2, s2, c, 1, r, u, l)],
      V[d2 * LAYER + stIdx(f2, s2, c, w, 1, u, l)],
    ];
    if (pairs.length === 0) {          // one or zero effects have weight: no choice to make
      const k = W.findIndex(x => x > 0);
      return k < 0 ? V[d2 * LAYER + stIdx(f2, s2, c, w, r, u, l)] : vals[k];
    }
    let ev = 0;
    for (const [i, j, p] of pairs) ev += p * Math.max(vals[i], vals[j]);
    return ev;
  }
  // land after a descent of j floors (j>0) from f; returns reward + value
  function land(f, j, d2, s, c, w, r, u, l) {
    const f2 = Math.min(100, f + j);
    let s2, rew = 0;
    if (s !== 0 && sLast(s) === j) {
      const cnt = Math.min(3, sCnt(s) + 1);
      s2 = sIdx(j, cnt);
      if (cnt >= mech.bonusStreak) rew = bonus;
    } else s2 = sIdx(j, 1);
    if (nether && deadly(f2)) {
      if (l === 0) return 0;         // dead, nothing collected
      l = 0;
    }
    return rew + arrive(f2, d2, s2, c, w, r, u, l);
  }
  function ascend(f, k, d2, c, w, r, u, l) {
    const f2 = Math.max(0, f - k);
    if (nether && deadly(f2)) {
      if (l === 0) return 0;
      l = 0;
    }
    return arrive(f2, d2, 0, c, w, r, u, l);
  }
  const upN = mech.midUpMax - mech.midUpMin + 1, dnN = mech.midDownMax - mech.midDownMin + 1;

  for (let d = 0; d <= MAXD; d++) {
    for (let u = 1; u >= 0; u--) for (let l = 0; l < 2; l++) {
      if (!nether && l === 0) continue;
      for (let f = 0; f < NF; f++) for (let s = 0; s < NS; s++)
        for (let c = 0; c < 2; c++) for (let w = 0; w < 2; w++) for (let r = 0; r < 2; r++) {
          const idx = d * LAYER + stIdx(f, s, c, w, r, u, l);
          if (d === 0 || f >= 100) { V[idx] = term(f, c, w); POL[idx] = 2; continue; }
          // normal jump (rocket forces 16..20 and is consumed)
          let vn = 0;
          const jmin = r ? 16 : 1, jmax = 20, jn = jmax - jmin + 1;
          for (let j = jmin; j <= jmax; j++) vn += land(f, j, d - 1, s, c, w, 0, u, l) / jn;
          let best = vn, pol = 0;
          if (f >= 10 && f % 10 === 0) {
            let vm = 0;
            for (let j = mech.midUpMin; j <= mech.midUpMax; j++) vm += mech.midUp * land(f, j, d - 1, s, c, w, r, u, l) / upN;
            for (let k = mech.midDownMin; k <= mech.midDownMax; k++) vm += (1 - mech.midUp) * ascend(f, k, d - 1, c, w, r, u, l) / dnN;
            if (vm > best) { best = vm; pol = 1; }
          }
          if (nether) { const vs = term(f, c, w); if (vs >= best) { best = vs; pol = 2; } }
          V[idx] = best; POL[idx] = pol;
        }
    }
  }
  const start = d => V[d * LAYER + stIdx(0, 0, 0, 0, 0, 0, 1)];   // l=1 always at the start (hell ignores lives)
  return { V, POL, start, term, arrive, key, bv, mech, element, nether, pairs, deadly, altarAt, abFactor, bonus };
}

// Forward pass under the optimal policy: distribution over terminal (band, c, w),
// expected bonus payouts, and P(die with nothing) — for expected quantities.
function forward(dp, d0) {
  const { V, POL, mech, nether, pairs, deadly, altarAt } = dp;
  const dist = new Map();            // stateIdx -> prob (current layer)
  const out = { term: [], bonusHits: 0, death: 0, ev: 0 };
  for (let b = 0; b < NBANDS; b++) out.term.push([[0, 0], [0, 0]]);   // [c][w]
  dist.set(d0 * LAYER + stIdx(0, 0, 0, 0, 0, 0, 1), 1);
  function terminal(p, f, c, w) { out.term[bandOf(f)][c][w] += p; out.ev += p * dp.term(f, c, w); }
  function arriveP(p, f2, d2, s2, c, w, r, u, l, next) {
    if (f2 >= 100 || d2 === 0) return terminal(p, f2, c, w);
    if (!altarAt[f2]) { const i = d2 * LAYER + stIdx(f2, s2, c, w, r, u, l); next.set(i, (next.get(i) || 0) + p); return; }
    const opts = [
      u ? [d2, stIdx(f2, s2, c, w, r, u, l)] : [d2 + 1, stIdx(f2, s2, c, w, r, 1, l)],
      [d2, stIdx(f2, s2, 1, w, r, u, l)], [d2, stIdx(f2, s2, c, 1, r, u, l)], [d2, stIdx(f2, s2, c, w, 1, u, l)]];
    if (pairs.length === 0) {
      const W = ALTAR_EFFECTS.map(e => mech.altarW[e]), k = W.findIndex(x => x > 0);
      const o = k < 0 ? [d2, stIdx(f2, s2, c, w, r, u, l)] : opts[k];
      const idx = o[0] * LAYER + o[1]; next.set(idx, (next.get(idx) || 0) + p); return;
    }
    for (const [i, j, pp] of pairs) {
      const a = opts[i][0] * LAYER + opts[i][1], b = opts[j][0] * LAYER + opts[j][1];
      const pick = V[a] >= V[b] ? a : b;
      next.set(pick, (next.get(pick) || 0) + p * pp);
    }
  }
  function landP(p, f, j, d2, s, c, w, r, u, l, next) {
    const f2 = Math.min(100, f + j);
    let s2;
    if (s !== 0 && sLast(s) === j) {
      const cnt = Math.min(3, sCnt(s) + 1); s2 = sIdx(j, cnt);
      if (cnt >= mech.bonusStreak) { out.bonusHits += p; out.ev += p * dp.bonus; }
    } else s2 = sIdx(j, 1);
    if (nether && deadly(f2)) { if (l === 0) { out.death += p; return; } l = 0; }
    arriveP(p, f2, d2, s2, c, w, r, u, l, next);
  }
  function ascendP(p, f, k, d2, c, w, r, u, l, next) {
    const f2 = Math.max(0, f - k);
    if (nether && deadly(f2)) { if (l === 0) { out.death += p; return; } l = 0; }
    arriveP(p, f2, d2, 0, c, w, r, u, l, next);
  }
  const upN = mech.midUpMax - mech.midUpMin + 1, dnN = mech.midDownMax - mech.midDownMin + 1;
  // process layers from high d to low; Descent+1 can push mass up one layer, so
  // loop until the map is empty, always taking the highest d present.
  let cur = dist;
  while (cur.size) {
    const next = new Map();
    // find max d in cur
    let dmax = -1; for (const i of cur.keys()) dmax = Math.max(dmax, Math.floor(i / LAYER));
    for (const [i, p] of cur) {
      const d = Math.floor(i / LAYER);
      if (d !== dmax) { next.set(i, (next.get(i) || 0) + p); continue; }
      const rem = i - d * LAYER, f = Math.floor(rem / (NS * FLAGS)), s = Math.floor(rem / FLAGS) % NS, fl = rem % FLAGS;
      const c = fl & 1, w = (fl >> 1) & 1, r = (fl >> 2) & 1, u = (fl >> 3) & 1, l = (fl >> 4) & 1;
      const pol = POL[i];
      if (pol === 2) { terminal(p, f, c, w); continue; }
      if (pol === 0) {
        const jmin = r ? 16 : 1, jn = 20 - jmin + 1;
        for (let j = jmin; j <= 20; j++) landP(p / jn, f, j, d - 1, s, c, w, 0, u, l, next);
      } else {
        for (let j = mech.midUpMin; j <= mech.midUpMax; j++) landP(p * mech.midUp / upN, f, j, d - 1, s, c, w, r, u, l, next);
        for (let k = mech.midDownMin; k <= mech.midDownMax; k++) ascendP(p * (1 - mech.midUp) / dnN, f, k, d - 1, c, w, r, u, l, next);
      }
    }
    cur = next;
  }
  return out;
}

// Expected quantities per category for one run (from the forward pass).
function expectedQty(dp, fw) {
  const { key, bv, mech, nether } = dp;
  const q = {};
  const add = (cat, v) => { q[cat] = (q[cat] || 0) + v; };
  fw.term.forEach((byC, b) => {
    const rw = key.bands[b].rewards;
    for (let c = 0; c < 2; c++) for (let w = 0; w < 2; w++) {
      const p = byC[c][w]; if (!p) continue;
      const picks = bv.picks[c ? 4 : 3][b];
      for (const cat of Object.keys(picks)) {
        const qty = rw[cat];
        if (cat === "astro") { add("astroU", p * picks[cat] * qty[0]); add("astroR", p * picks[cat] * qty[1]); add("astroE", p * picks[cat] * qty[2]); }
        else add(cat, p * picks[cat] * qty);
      }
      if (!nether) {
        const m = w ? mech.abundantMult : dp.abFactor;
        add("b_shards", p * m * (rw.b_shards || 0)); add("b_red", p * m * (rw.b_red || 0));
        add("b_blue", p * m * (rw.b_blue || 0)); add("b_leap", p * m * (rw.b_leap || 0));
      }
    }
  });
  add("bonusGold", fw.bonusHits * mech.bonusGold);
  return q;
}

// Grade index helpers and the transmutation gamble.
function gradeIdx(id) { return GRADES.findIndex(g => g.id === id); }
function clampGrade(i) { return Math.max(0, Math.min(GRADES.length - 1, i)); }
// evHell(i), evFlame(i), evFrost(i): EV by grade index. Returns the EV of feeding
// a grade-i key to the altar, plus the breakdown.
function transmuteEV(i, evHell, evFlame, evFrost, tr) {
  const parts = [
    { what: GRADES[clampGrade(i - 2)].name + " Hell key", p: tr.d2, v: evHell(clampGrade(i - 2)) },
    { what: GRADES[clampGrade(i - 1)].name + " Hell key", p: tr.d1, v: evHell(clampGrade(i - 1)) },
    { what: GRADES[clampGrade(i + 1)].name + " Hell key", p: tr.u1, v: evHell(clampGrade(i + 1)) },
    { what: GRADES[clampGrade(i + 2)].name + " Hell key", p: tr.u2, v: evHell(clampGrade(i + 2)) },
    { what: GRADES[i].name + " Flame key", p: tr.flame, v: evFlame(i) },
    { what: GRADES[i].name + " Frost key", p: tr.frost, v: evFrost(i) },
  ];
  return { ev: parts.reduce((a, x) => a + x.p * x.v, 0), parts };
}

// Jump policy grid for the page: floors 10..90 x descents 1..MAXD-1, given a
// streak state s (0 = fresh, else sIdx(last jump, count)), no altar flags.
// gain = EV(middle) - EV(normal).
function policyGrid(dp, s = 0) {
  const { V, mech } = dp;
  const l = 1;
  const rows = [];
  const upN = mech.midUpMax - mech.midUpMin + 1, dnN = mech.midDownMax - mech.midDownMin + 1;
  for (let f = 10; f <= 90; f += 10) {
    const row = { floor: f, cells: [] };
    for (let d = 1; d <= MAXD - 1; d++) {
      let vn = 0; for (let j = 1; j <= 20; j++) vn += landV(dp, f, j, d - 1, s, 0, 0, 0, 0, l) / 20;
      let vm = 0;
      for (let j = mech.midUpMin; j <= mech.midUpMax; j++) vm += mech.midUp * landV(dp, f, j, d - 1, s, 0, 0, 0, 0, l) / upN;
      for (let k = mech.midDownMin; k <= mech.midDownMax; k++) vm += (1 - mech.midUp) * ascendV(dp, f, k, d - 1, 0, 0, 0, 0, l) / dnN;
      row.cells.push({ d, normal: vn, middle: vm, take: vm > vn });
    }
    rows.push(row);
  }
  return rows;
}
// public re-implementations of land/ascend using a finished dp (for the grid)
function landV(dp, f, j, d2, s, c, w, r, u, l) {
  const f2 = Math.min(100, f + j);
  let s2, rew = 0;
  if (s !== 0 && sLast(s) === j) { const cnt = Math.min(3, sCnt(s) + 1); s2 = sIdx(j, cnt); if (cnt >= dp.mech.bonusStreak) rew = dp.bonus; }
  else s2 = sIdx(j, 1);
  if (dp.nether && dp.deadly(f2)) { if (l === 0) return 0; l = 0; }
  return rew + dp.arrive(f2, d2, s2, c, w, r, u, l);
}
function ascendV(dp, f, k, d2, c, w, r, u, l) {
  const f2 = Math.max(0, f - k);
  if (dp.nether && dp.deadly(f2)) { if (l === 0) return 0; l = 0; }
  return dp.arrive(f2, d2, 0, c, w, r, u, l);
}

// Netherworld stop/continue grid: for each floor and descents left (fresh
// state, one life), does the policy stop, and the EV of each.
function stopGrid(dp) {
  const { V, POL } = dp;
  const rows = [];
  for (let f = 0; f < 100; f++) {
    const row = { floor: f, cells: [] };
    for (let d = 1; d <= MAXD - 1; d++) {
      for (const l of [1, 0]) {
        const i = d * LAYER + stIdx(f, 0, 0, 0, 0, 0, l);
        row.cells.push({ d, l, stop: POL[i] === 2, v: V[i], stopV: dp.term(f, 0, 0) });
      }
    }
    rows.push(row);
  }
  return rows;
}

if (typeof module !== "undefined") module.exports = { GRADES, MAXD, MECH_DEFAULTS, bandOf, comb, bestOfK, catValue, baseValue, bandValues, runDP, forward, expectedQty, transmuteEV, policyGrid, stopGrid, gradeIdx, sIdx, stIdx, LAYER };
