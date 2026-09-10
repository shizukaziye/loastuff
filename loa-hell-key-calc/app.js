// app.js — DOM edges only: readParams() reads fields into P, renderX() writes results.
"use strict";
const $ = id => document.getElementById(id);
const gold = v => { const x = Math.round(v); if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + "M"; if (Math.abs(x) >= 1e4) return (x / 1e3).toFixed(1) + "k"; return x.toLocaleString(); };
const gfull = v => Math.round(v).toLocaleString();
const pct = p => (p * 100).toFixed(1) + "%";
const sgn = v => (v >= 0 ? "+" : "") + gold(v);

const KEYS = [
  { id: "hell1750", nw: "nw1750", label: "1750 Hell Key" },
  { id: "hell1730", nw: "nw1730", label: "1730 Hell Key" },
];
// unit-value rows: id -> label, and which baked price seeds the default
const UNIT_SPEC = [
  { id: "red",     label: "Crystallized destruction stone (each)", price: "destiny-crystallized-destruction-stone" },
  { id: "blue",    label: "Crystallized guardian stone (each)",    price: "destiny-crystallized-guardian-stone" },
  { id: "shards",  label: "Destiny shard (each)",                  price: "destiny-shard-pouch-l" },
  { id: "fusions", label: "Superior Abidos fusion material",       price: "superior-abidos-fusion-material" },
  { id: "leap",    label: "Great Destiny leapstone",               price: "great-destiny-leapstone" },
  { id: "juice",   label: "Breath set (1 Lava + 3 Glacier)",       price: "juice" },
  { id: "gold",    label: "Bound gold (per 1 gold)" },
  { id: "taps",    label: "Special honing tap (Transferred Leapstone)" },
  { id: "brace",   label: "Ancient bracelet (each)" },
  { id: "karma",   label: "Processed Destiny Stone (each)" },
  { id: "astroU",  label: "Uncommon astrogem (selection)" },
  { id: "astroR",  label: "Rare astrogem (selection)" },
  { id: "astroE",  label: "Epic astrogem (selection)" },
  { id: "elysian", label: "Elysian attempt +1 ticket" },
  { id: "kits",    label: "Ability stone kit (Soaring Stone Engraving Setting Kit)" },
  { id: "books",   label: "Relic engraving book (random) — Netherworld" },
  { id: "cards",   label: "Legendary card pack — Netherworld" },
  { id: "gems",    label: "Lv. 8 gem, bound — Netherworld" },
];
const CAT_LABEL = {
  stones: "Destruction / guardian stones", juice: "Breath sets", fusions: "Fusions", leap: "Leapstones",
  gold: "Gold", taps: "Special honing taps", brace: "Bracelets", karma: "Processed Destiny Stones",
  astroU: "Uncommon astrogems", astroR: "Rare astrogems", astroE: "Epic astrogems", elysian: "Elysian tickets",
  kits: "Ability stone kits", books: "Relic engraving books", cards: "Card packs", gems: "Lv. 8 gems",
  b_shards: "Shards (guaranteed chest)", b_red: "Destruction stones (guaranteed)", b_blue: "Guardian stones (guaranteed)",
  b_leap: "Leapstones (guaranteed)", bonusGold: "Same-jump bonus gold",
};
// how a category's expected quantity converts to gold (mirrors catValue)
function qtyGold(cat, q, U) {
  switch (cat) {
    case "stones": return Math.max(q * U.red, 3 * q * U.blue);
    case "juice": return q * U.juice; case "fusions": return q * U.fusions; case "leap": return q * U.leap;
    case "gold": return q * U.gold; case "taps": return q * U.taps; case "brace": return q * U.brace;
    case "karma": return q * U.karma; case "astroU": return q * U.astroU; case "astroR": return q * U.astroR;
    case "astroE": return q * U.astroE; case "elysian": return q * U.elysian; case "kits": return q * U.kits;
    case "books": return q * U.books; case "cards": return q * U.cards; case "gems": return q * U.gems;
    case "b_shards": return q * U.shards; case "b_red": return q * U.red; case "b_blue": return q * U.blue;
    case "b_leap": return q * U.leap; case "bonusGold": return q * U.gold;
  }
  return 0;
}

// ---- defaults ----
const PU = PRICES.perUnit;
// Defaults are the author's own valuations (2026-09-10); the market price is
// shown beside each field for reference, not used blindly (bound mats are worth
// less than tradeable ones).
const DEFAULTS = {
  U: {
    red: 18, blue: 3, shards: 0, fusions: 125, leap: 25, juice: 900,
    gold: 1, taps: 400, brace: 0, karma: 275, astroU: 0, astroR: 0, astroE: 15000, elysian: 10000,
    kits: 0, books: 0, cards: 0, gems: 0,
  },
  mech: JSON.parse(JSON.stringify(MECH_DEFAULTS)),
  plan: { weeks: 21, rare: 2, epic: 1.5, legendary: 0, sRare: 0, sEpic: 0, sLegendary: 0 },
};

// ---- state ----
let P = null, curKey = "hell1750", curTab = "summary", inputsCollapsed = false;
const DP = new Map();                 // cache: `${kid}|${el}|${JSON(U)}|${JSON(mech)}` -> dp
let R = null;                         // results of the last recalc

function buildUnitTable() {
  let h = "<table class='utab'><tr><th>Item</th><th class='num'>Gold value</th></tr>";
  for (const u of UNIT_SPEC) {
    const src = u.price && u.price !== "juice" ? `<div class='src'>market: ${PU[u.price]}</div>` : u.price === "juice" ? `<div class='src'>market: ${(PU["lavas-breath"] + 3 * PU["glaciers-breath"]).toFixed(0)}</div>` : "";
    h += `<tr><td class='lbl'>${u.label}${src}</td><td class='num'><input id='u_${u.id}' type='number' step='any'></td></tr>`;
  }
  $("unitTable").innerHTML = h + "</table>";
  $("priceNote").textContent = `Defaults are my valuations. Grey = NA East market, robust 14-day price, ${PRICES.date}.`;
}
function setDefaultsToInputs() {
  for (const u of UNIT_SPEC) $("u_" + u.id).value = DEFAULTS.U[u.id];
  const m = DEFAULTS.mech;
  $("m_midUp").value = m.midUp * 100; $("m_midUpMin").value = m.midUpMin; $("m_midUpMax").value = m.midUpMax;
  $("m_midDownMin").value = m.midDownMin; $("m_midDownMax").value = m.midDownMax;
  $("m_bonusGold").value = m.bonusGold; $("m_bonusStreak").value = m.bonusStreak; $("m_chestsShown").value = m.chestsShown;
  $("m_natAbundant").value = m.natAbundant * 100; $("m_abundantMult").value = m.abundantMult;
  for (const e of ["desc", "chest", "wealth", "rocket"]) $("m_w_" + e).value = m.altarW[e];
  for (const t of ["d2", "d1", "u1", "u2", "flame", "frost"]) $("m_t_" + t).value = m.tr[t] * 100;
  for (const k of Object.keys(DEFAULTS.plan)) $("pl_" + k).value = DEFAULTS.plan[k];
}
function resetDefaults() { setDefaultsToInputs(); }
const num = (id, lo = -1e12) => Math.max(lo, +$(id).value || 0);
function readParams() {
  const U = {}; for (const u of UNIT_SPEC) U[u.id] = num("u_" + u.id);
  const mech = {
    midUp: Math.min(1, num("m_midUp", 0) / 100),
    midUpMin: Math.round(num("m_midUpMin", 1)), midUpMax: Math.round(num("m_midUpMax", 1)),
    midDownMin: Math.round(num("m_midDownMin", 0)), midDownMax: Math.round(num("m_midDownMax", 0)),
    bonusGold: num("m_bonusGold", 0), bonusStreak: Math.max(2, Math.min(3, Math.round(num("m_bonusStreak", 2)))),
    natAbundant: Math.min(1, num("m_natAbundant", 0) / 100), abundantMult: num("m_abundantMult", 1),
    altarW: { desc: num("m_w_desc", 0), chest: num("m_w_chest", 0), wealth: num("m_w_wealth", 0), rocket: num("m_w_rocket", 0) },
    tr: { d2: num("m_t_d2", 0) / 100, d1: num("m_t_d1", 0) / 100, u1: num("m_t_u1", 0) / 100, u2: num("m_t_u2", 0) / 100, flame: num("m_t_flame", 0) / 100, frost: num("m_t_frost", 0) / 100 },
    chestsShown: Math.max(1, Math.min(4, Math.round(num("m_chestsShown", 1)))),
  };
  if (mech.midUpMax < mech.midUpMin) mech.midUpMax = mech.midUpMin;
  if (mech.midDownMax < mech.midDownMin) mech.midDownMax = mech.midDownMin;
  mech.midUpMax = Math.min(20, mech.midUpMax); mech.midDownMax = Math.min(20, mech.midDownMax);
  const plan = {}; for (const k of Object.keys(DEFAULTS.plan)) plan[k] = num("pl_" + k, 0);
  P = { U, mech, plan };
  const tsum = Object.values(mech.tr).reduce((a, b) => a + b, 0);
  $("status").textContent = Math.abs(tsum - 1) > 1e-6 ? `transmutation outcomes sum to ${(tsum * 100).toFixed(0)}%, not 100%` : "";
}

const yieldUI = () => new Promise(r => setTimeout(r, 0));
async function getDP(kid, el) {
  const U = P.U, key = REWARDS.keys[kid];
  const k = `${kid}|${el}|${JSON.stringify(U)}|${JSON.stringify(P.mech)}`;
  if (DP.has(k)) return DP.get(k);
  const bv = bandValues(key, U, P.mech);
  const dp = runDP(key, bv, U, P.mech, el);
  if (DP.size > 40) DP.clear();
  DP.set(k, dp);
  await yieldUI();
  return dp;
}
let running = false;
async function recalc() {
  if (running) return;
  running = true;
  try {
    readParams();
    const st = $("status");
    const order = KEYS.slice().sort(a => a.id === curKey ? -1 : 1);
    R = { hell: {}, nw: {} };
    for (const k of order) {
      st.textContent = `computing ${k.label} …`;
      R.hell[k.id] = await getDP(k.id, "hell");
      if (k.id === curKey) { renderSummary(); renderJump(); renderTables(); }
    }
    for (const k of order) for (const el of ["flame", "frost"]) {
      st.textContent = `computing ${k.label} Netherworld ${el} …`;
      R.nw[`${k.nw}|${el}`] = await getDP(k.nw, el);
    }
    st.textContent = "";
    renderAll();
  } finally { running = false; }
}
function renderAll() { renderSummary(); renderJump(); renderAltar(); renderPlan(); renderTables(); }
function setKey(k) { curKey = k; document.querySelectorAll("[data-k]").forEach(b => b.classList.toggle("active", b.dataset.k === k)); if (R) renderAll(); }
function setTab(t) { curTab = t; document.querySelectorAll("[data-t]").forEach(b => b.classList.toggle("active", b.dataset.t === t)); document.querySelectorAll(".tab").forEach(d => d.classList.toggle("active", d.id === "tab_" + t)); }
function toggleInputs() { inputsCollapsed = !inputsCollapsed; $("infields").style.display = inputsCollapsed ? "none" : ""; $("caret").innerHTML = inputsCollapsed ? "&#9656;" : "&#9662;"; }

const keyObj = () => KEYS.find(k => k.id === curKey);
const dpH = kid => R.hell[kid];
const dpN = (nw, el) => R.nw[`${nw}|${el}`];

// ---- renders ----
function renderSummary() {
  const k = keyObj(), dp = dpH(k.id);
  if (!dp) return;
  const g = id => dp.start(GRADES[gradeIdx(id)].desc);
  $("headline").innerHTML = `<div class='kv'>` +
    `<div>${k.label}</div>` +
    `<div>Rare<b>${gold(g("rare"))}</b></div><div>Epic<b>${gold(g("epic"))}</b></div><div>Legendary<b>${gold(g("legendary"))}</b></div>` +
    `<div>per descent (Rare)<b>${gold(g("rare") / 5)}</b></div></div>`;
  let h = "<table><tr><th>Grade</th><th class='num'>Descents</th>";
  for (const kk of KEYS) h += `<th class='num'>${kk.label}</th>`;
  h += "</tr>";
  for (const gr of GRADES) {
    h += `<tr><td>${gr.name}</td><td class='num'>${gr.desc}</td>`;
    for (const kk of KEYS) { const d = dpH(kk.id); h += `<td class='num'>${d ? gfull(d.start(gr.desc)) : "…"}</td>`; }
    h += "</tr>";
  }
  $("evTable").innerHTML = h + "</table>";
}

function streakState() {                // Jump-tab selectors -> streak index for policyGrid
  const cnt = +$("j_streak").value, last = +$("j_last").value;
  return cnt === 0 ? 0 : sIdx(last, cnt);
}
function renderJump() {
  const k = keyObj(), dp = dpH(k.id);
  if (!dp) return;
  const s = streakState(), grid = policyGrid(dp, s);
  let h = "<table class='pgrid'><tr><th>Floor \\ descents left</th>";
  for (let d = 1; d <= MAXD - 1; d++) h += `<th>${d}</th>`;
  h += "</tr>";
  for (const row of grid) {
    h += `<tr><th>${row.floor}</th>`;
    for (const c of row.cells) h += `<td class='${c.take ? "mid" : "norm"}' title='middle ${gfull(c.middle)} vs normal ${gfull(c.normal)}'>${c.take ? sgn(c.middle - c.normal) : sgn(c.middle - c.normal)}</td>`;
    h += "</tr>";
  }
  $("jumpGrid").innerHTML = h + "</table>";
  // plain-language rule: for each descents-left, lowest floor where middle is taken
  const rules = [];
  for (let d = 1; d <= MAXD - 1; d++) {
    const takes = grid.filter(r => r.cells[d - 1].take).map(r => r.floor);
    rules.push(`<b>${d}</b> left: ${takes.length ? takes.join(", ") : "never"}`);
  }
  const rare = 5, ep = 6, lg = 7;
  const cnt = +$("j_streak").value, last = +$("j_last").value;
  const pMid = last >= P.mech.midUpMin && last <= P.mech.midUpMax ? pct(P.mech.midUp / (P.mech.midUpMax - P.mech.midUpMin + 1)) : "0%";
  const streakNote = cnt === 0 ? "" : `<div class='dim' style='font-size:12px;margin-bottom:6px'>Streak: ${cnt} × ${last}. Another ${last} ${cnt + 1 >= P.mech.bonusStreak ? "pays " + gold(P.mech.bonusGold) : "sets up the bonus"}. Odds of a ${last}: normal 5%, middle ${pMid}.</div>`;
  $("jumpText").innerHTML = `<div style='margin-bottom:6px'>${k.label} · middle = ${pct(P.mech.midUp)} for ${P.mech.midUpMin}–${P.mech.midUpMax} down, ${pct(1 - P.mech.midUp)} for ${P.mech.midDownMin}–${P.mech.midDownMax} up · Rare ${rare} descents, Epic ${ep}, Legendary ${lg}</div>` +
    streakNote + `<div class='dim' style='font-size:12px'>${rules.join(" · ")}</div>`;
}

function renderAltar() {
  const k = keyObj(), dp = dpH(k.id);
  const fl = dpN(k.nw, "flame"), fr = dpN(k.nw, "frost");
  if (!dp || !fl || !fr) return;
  const evH = i => dp.start(GRADES[i].desc), evF = i => fl.start(GRADES[i].desc), evR = i => fr.start(GRADES[i].desc);
  let h = `<table><tr><th>Key fed</th><th class='num'>Run it: EV</th><th class='num'>Altar: EV</th><th class='num'>Gain</th><th>Verdict</th></tr>`;
  const detail = [];
  for (let i = 0; i < GRADES.length; i++) {
    const t = transmuteEV(i, evH, evF, evR, P.mech.tr), run = evH(i), d = t.ev - run;
    h += `<tr><td>${GRADES[i].name} (${GRADES[i].desc})</td><td class='num'>${gfull(run)}</td><td class='num'>${gfull(t.ev)}</td><td class='num ${d >= 0 ? "good" : "bad"}'>${sgn(d)} (${(d / run * 100).toFixed(1)}%)</td><td class='${d >= 0 ? "good" : "bad"}'>${d >= 0 ? "feed it" : "run it"}</td></tr>`;
    detail.push(`<details class='sub'><summary>${GRADES[i].name}: outcome breakdown</summary><table>` + t.parts.map(p => `<tr><td>${p.what}</td><td class='num'>${pct(p.p)}</td><td class='num'>${gfull(p.v)}</td><td class='num dim'>${gfull(p.p * p.v)}</td></tr>`).join("") + `</table></details>`);
  }
  $("altarTable").innerHTML = `<div class='dim' style='font-size:12px;margin-bottom:6px'>${k.label} · Crucible keys only, once each</div>` + h + "</table>" + detail.join("");
  let n = `<h3 style='margin-top:0'>Netherworld key EV (${k.label.replace(" Hell Key", "")})</h3><table><tr><th>Grade</th><th class='num'>Flame</th><th class='num'>Frost</th><th class='num'>vs Hell</th></tr>`;
  for (let i = 0; i < GRADES.length; i++) n += `<tr><td>${GRADES[i].name}</td><td class='num'>${gfull(evF(i))}</td><td class='num'>${gfull(evR(i))}</td><td class='num dim'>${gfull(evH(i))}</td></tr>`;
  $("nwTable").innerHTML = n + "</table>";
  // stop policy summary for flame/frost: which safe floors you keep going from
  const ranges = fs => {                 // [2,4,6,8,20,22] -> "2–8, 20–22" (safe floors step by 2)
    if (!fs.length) return "";
    const out = []; let a = fs[0], b = fs[0];
    for (let i = 1; i <= fs.length; i++) {
      if (i < fs.length && fs[i] - b <= 2) { b = fs[i]; continue; }
      out.push(a === b ? `${a}` : `${a}–${b}`); if (i < fs.length) { a = fs[i]; b = fs[i]; }
    }
    return out.join(", ");
  };
  let s = "<h3 style='margin-top:0'>When to stop (Netherworld)</h3><table><tr><th>Key</th><th>Revive</th><th>Keep going from floors</th></tr>";
  for (const [el, d] of [["Flame", fl], ["Frost", fr]]) {
    const sg = stopGrid(d);
    for (const gid of ["rare", "epic", "legendary"]) {
      const D = GRADES[gradeIdx(gid)].desc;
      for (const l of [1, 0]) {
        const parts = [];
        for (let dd = D; dd >= 1; dd--) {
          const fs = sg.filter(r => !d.deadly(r.floor) && r.cells.some(c => c.d === dd && c.l === l && !c.stop)).map(r => r.floor);
          const safeN = sg.filter(r => !d.deadly(r.floor)).length;
          parts.push(`<b>${dd}</b> left: ${fs.length === 0 ? "stop" : fs.length === safeN ? "always" : ranges(fs)}`);
        }
        s += `<tr><td>${el} ${GRADES[gradeIdx(gid)].name}</td><td>${l ? "unused" : "used"}</td><td class='dim' style='font-size:12px'>${parts.join(" · ")}</td></tr>`;
      }
    }
  }
  $("stopText").innerHTML = s + "</table>";
}

function renderPlan() {
  const k = keyObj();
  const counts = { rare: P.plan.weeks * P.plan.rare + P.plan.sRare, epic: P.plan.weeks * P.plan.epic + P.plan.sEpic, legendary: P.plan.weeks * P.plan.legendary + P.plan.sLegendary };
  const dp = dpH(k.id); if (!dp) return;
  let tot = 0; const qty = {}, byGrade = [];
  for (const gid of ["rare", "epic", "legendary"]) {
    const n = counts[gid]; if (!n) continue;
    const D = GRADES[gradeIdx(gid)].desc, ev = dp.start(D);
    tot += n * ev; byGrade.push(`${GRADES[gradeIdx(gid)].name} ${n} × ${gold(ev)}`);
    const fw = forward(dp, D), q = expectedQty(dp, fw);
    for (const c of Object.keys(q)) qty[c] = (qty[c] || 0) + n * q[c];
  }
  $("planHead").innerHTML = `<div class='dim' style='font-size:12px;margin-bottom:8px'>${k.label} · ${P.plan.weeks} weeks · ${byGrade.join(" · ") || "no keys"}</div><div class='kv'><div>Total<b>${gold(tot)}</b></div></div>`;
  const cats = Object.keys(qty).filter(c => qty[c] > 1e-9);
  cats.sort((a, b) => qtyGold(b, qty[b], P.U) - qtyGold(a, qty[a], P.U));
  let h = `<table><tr><th>Reward</th><th class='num'>Expected qty</th><th class='num'>Gold</th></tr>`;
  for (const c of cats) h += `<tr><td>${CAT_LABEL[c] || c}</td><td class='num'>${qty[c].toLocaleString(undefined, { maximumFractionDigits: 1 })}</td><td class='num'>${gfull(qtyGold(c, qty[c], P.U))}</td></tr>`;
  h += `<tr><td><b>Total</b></td><td></td><td class='num'><b>${gfull(tot)}</b></td></tr>`;
  $("planTable").innerHTML = h + "</table>";
}

function renderTables() {
  const k = keyObj(), key = REWARDS.keys[k.id], nw = REWARDS.keys[k.nw];
  const fmt = (c, v) => c === "astro" ? v.map(x => +x.toFixed(2)).join("/") : v;
  function tbl(kk, title) {   // one table per key: chest categories, then the guaranteed chest
    const cats = kk.chest_cats.concat(kk.bands[0].rewards.b_shards !== undefined ? ["b_shards", "b_red", "b_blue", "b_leap"] : []);
    let h = `<h3>${title}</h3><table><tr><th>Band</th>` + cats.map(c => `<th class='num'>${c === "astro" ? "astro U/R/E" : (CAT_LABEL[c] || c)}</th>`).join("") + "</tr>";
    for (const b of kk.bands) h += `<tr><td>${b.range}</td>` + cats.map(c => `<td class='num'>${b.rewards[c] === undefined ? "—" : fmt(c, b.rewards[c])}</td>`).join("") + "</tr>";
    return h + "</table>";
  }
  $("rewardTable").innerHTML = tbl(key, key.label) + tbl(nw, nw.label) +
    `<div class='note'>Source: sekwahar's data-mined Season 4 tables via the Hell Reward Picker dump (${REWARDS.extracted_at.slice(0, 10)}). Stones = destruction count, or 3× as guardian.</div>`;
}

window.onload = function () {
  buildUnitTable(); setDefaultsToInputs(); toggleInputs();
  $("j_last").innerHTML = Array.from({ length: 20 }, (_, i) => `<option value='${i + 1}'${i + 1 === 20 ? " selected" : ""}>${i + 1}</option>`).join("");
  recalc();
};
