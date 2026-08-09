/**
 * cut-engine.js — the shared "cut one epic astrogem under the advisor's policy"
 * rollout, extracted verbatim from tools/upgrade-cost-study.js (2026-08-06) so the
 * account study can reuse it. EPIC-only (9 turns, 3 rerolls).
 *
 * Decision semantics mirror dp.js topLevelAdvice (see upgrade-cost-study.js header):
 * fresh-gem Complete == dismantle for 0; reroll/Complete gated until processed once;
 * advisor-style Reset (ranked when Complete would win or on the last turn, once per
 * gem, same-pair assumption); tie-break order Process, Reroll, Complete, Reset.
 *
 * Exports: mulberry32, fnv1a, drawOutcomes, decide, cutOneGem, procCostAt, EPIC.
 */
"use strict";

var A = require("../../model/astrogem.js");
var N = require("../../model/nested.js");
var DP = require("../../model/dp.js");

var EPIC = A.RARITY.epic; // { maxTurns: 9, maxRerolls: 3 }

// ---------------- seeded PRNG (mulberry32) ----------------
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------------- outcome draw (nested.generateOutcomes with injected PRNG) ----------------
function drawOutcomes(cfg, cm, turnsLeft, rand) {
  var op = A.outcomeProbabilities({ config: cfg, processCostMultiplier: cm, turnsRemaining: turnsLeft });
  var pool = op.possibilities.map(function (p) { return { type: p.type, change: p.change, prob: p.prob }; });
  var sel = [];
  while (sel.length < 4 && pool.length > 0) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].prob;
    var r = rand() * total, idx = -1, cum = 0;
    for (i = 0; i < pool.length; i++) { cum += pool[i].prob; if (r <= cum) { idx = i; break; } }
    if (idx < 0) idx = pool.length - 1;
    sel.push(toAdvisorOutcome(pool[idx]));
    pool.splice(idx, 1);
  }
  while (sel.length < 4) sel.push({ type: "do_nothing" });
  return sel;
}
function toAdvisorOutcome(p) {
  var t = p.type;
  if (t === "willpower" || t === "order" || t === "effect1" || t === "effect2") {
    return { type: p.change > 0 ? "raise_effect" : "lower_effect", target: t, amount: Math.abs(p.change) };
  }
  if (t === "change_effect1" || t === "change_effect2") {
    return { type: "change_side_option", target: t === "change_effect1" ? "effect1" : "effect2" };
  }
  if (t === "cost") return { type: "change_gold_cost", change: p.change };
  if (t === "reroll") return { type: "reroll_increase", change: p.change };
  return { type: "do_nothing" };
}

function clampCm(cm) { return Math.max(-100, Math.min(100, cm)); }
function clampR(r) { return r < 0 ? 0 : r; }
function procCostAt(cm) { return Math.max(0, Math.round(A.COSTS.processBase * (1 + cm / 100))); }

// ---------------- the advisor-mirror decision ----------------
// Returns "process" | "reroll" | "complete" | "reset".
function decide(solver, cfg, t, r, cm, outcomes, resetUsed) {
  var maxTurns = solver.maxTurns;
  var fresh = (t === maxTurns);

  // COMPLETE: dismantle (0) on a fresh gem, keep (gemValue) otherwise.
  var complete = fresh ? 0 : solver.gemValue(cfg);

  // PROCESS from the actual 4 outcomes.
  var process = -Infinity;
  if (t >= 1 && outcomes && outcomes.length > 0) {
    var pc = solver.procCost(cm);
    var sum = 0, cnt = 0;
    for (var i = 0; i < outcomes.length; i++) {
      var brs = DP.outcomeBranchesActual(cfg, outcomes[i]);
      var bv = 0, bw = 0;
      for (var k = 0; k < brs.length; k++) {
        var b = brs[k];
        var w = b.w != null ? b.w : 1 / brs.length;
        bv += w * solver.W(b.config, t - 1, clampR(r + b.dRerolls), clampCm(cm + b.dCm));
        bw += w;
      }
      if (bw > 0) bv /= bw;
      sum += bv; cnt++;
    }
    if (cnt > 0) process = -pc + sum / cnt;
  }

  // REROLL: gated until processed once.
  var reroll = -Infinity;
  if (r >= 1 && t >= 1 && !fresh) {
    reroll = -(r === 1 ? A.COSTS.finalReroll : 0) + solver.W(cfg, t, r - 1, cm);
  }

  // RESET: advisor rule — ranked on the last turn or when Complete would win.
  var reset = -Infinity;
  if (!resetUsed && !fresh) {
    var completeWouldWin = complete >= process && complete >= reroll;
    if (t === 1 || completeWouldWin) {
      var freshCfg = {
        baseCost: cfg.baseCost, gemType: cfg.gemType,
        willpowerLevel: 1, orderLevel: 1,
        effect1: cfg.effect1, effect1Level: 1,
        effect2: cfg.effect2, effect2Level: 1
      };
      reset = -A.COSTS.reset + solver.W(freshCfg, maxTurns, EPIC.maxRerolls, 0);
    }
  }

  // argmax with the advisor's tie-break order (stable sort order: P, R, C, Reset).
  var act = "process", best = process;
  if (reroll > best) { act = "reroll"; best = reroll; }
  if (complete > best) { act = "complete"; best = complete; }
  if (reset > best) { act = "reset"; best = reset; }
  if (!isFinite(best)) act = "complete";
  return act;
}

// ---------------- one full gem under the policy (resets included) ----------------
function cutOneGem(solver, pairCfg, rand, allowReset) {
  var cfg = {
    baseCost: pairCfg.baseCost, gemType: pairCfg.gemType,
    willpowerLevel: 1, orderLevel: 1,
    effect1: pairCfg.effect1, effect1Level: 1,
    effect2: pairCfg.effect2, effect2Level: 1
  };
  var t = solver.maxTurns, r = EPIC.maxRerolls, cm = 0;
  var spent = 0, spentProcess = 0, spentReroll = 0, spentReset = 0;
  var processes = 0, rerollsUsed = 0, resets = 0, resetUsed = !allowReset;

  while (t > 0) {
    var outcomes = drawOutcomes(cfg, cm, t, rand);
    var act = decide(solver, cfg, t, r, cm, outcomes, resetUsed);

    if (act === "complete") break;

    if (act === "reset") {
      spent += A.COSTS.reset; spentReset += A.COSTS.reset;
      resets++; resetUsed = true;
      cfg = {
        baseCost: cfg.baseCost, gemType: cfg.gemType,
        willpowerLevel: 1, orderLevel: 1,
        effect1: cfg.effect1, effect1Level: 1,
        effect2: cfg.effect2, effect2Level: 1
      };
      t = solver.maxTurns; r = EPIC.maxRerolls; cm = 0;
      continue;
    }

    if (act === "reroll") {
      var rc = (r === 1 ? A.COSTS.finalReroll : 0);
      spent += rc; spentReroll += rc;
      r--; rerollsUsed++;
      continue;
    }

    // PROCESS: pay the current cost, then apply a uniform-random one of the 4.
    var pcNow = procCostAt(cm);
    spent += pcNow; spentProcess += pcNow;
    var pick = outcomes[Math.floor(rand() * outcomes.length)];
    var resolved = pick;
    if (pick.type === "change_side_option") {
      var pool = A.EFFECT_POOLS[cfg.baseCost] || [];
      var cur = [cfg.effect1, cfg.effect2];
      var cand = pool.filter(function (e) { return cur.indexOf(e) === -1; });
      if (cand.length > 0) {
        resolved = { type: "change_side_option", target: pick.target, newEffect: cand[Math.floor(rand() * cand.length)] };
      }
    }
    cfg = N.applyOutcome(cfg, resolved);
    if (pick.type === "change_gold_cost") cm = clampCm(cm + (pick.change || 0));
    else if (pick.type === "reroll_increase") r += pick.change || 1;
    processes++; t--;
  }

  return { cfg: cfg, spent: spent, spentProcess: spentProcess, spentReroll: spentReroll, spentReset: spentReset,
    processes: processes, rerollsUsed: rerollsUsed, resets: resets };
}

module.exports = {
  EPIC: EPIC,
  mulberry32: mulberry32,
  fnv1a: fnv1a,
  drawOutcomes: drawOutcomes,
  toAdvisorOutcome: toAdvisorOutcome,
  clampCm: clampCm,
  clampR: clampR,
  procCostAt: procCostAt,
  decide: decide,
  cutOneGem: cutOneGem
};
