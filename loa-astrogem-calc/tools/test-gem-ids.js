#!/usr/bin/env node
/**
 * tools/test-gem-ids.js — guard the lostark.bible gem-id -> (baseCost, gemType) rule.
 *
 * The rule "baseCost = 8 + (id[5] % 3), gemType = id[3]" was read off 24 gems of one
 * character in 2025 and held for a year. On 2026-09-16 a second id family appeared —
 * 40621173/74/75/76, fixed 5/5/5/5 gems — which that rule calls 9-cost chaos. They are
 * 8-cost (173/74 order, 175/76 chaos), so the grid rejected them with
 * 'Effect 2 "Additional Damage" is not available for 9 cost gems' and showed a "?".
 *
 * So there are now three layers, and this file tests all three:
 *   1. GEM_ID_OVERRIDES  — the known-wrong ids, with what they really are.
 *   2. the id digits     — still right for every 674xxxxx gem.
 *   3. costFromEffects   — a last check against the effect pools, which repairs a cost
 *                          the id got wrong and warns when it does.
 *
 * The same three live in TWO files that must never drift: worker/astrogem-bible.js (the
 * Worker) and bible-import.js (the bookmarklet / paste path). This runs the assertions
 * against BOTH: the client file is require()d, and the Worker's helper block is sliced
 * out of the source and evaluated, so a fix applied to only one side fails here.
 *
 *   node tools/test-gem-ids.js
 */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
var ROOT = path.resolve(__dirname, "..");

// ---- load the two implementations -------------------------------------------------

// The Worker is an ES module with imports, so lift out just the helper block. The slice
// runs from the id-format regex to the end of repairStoredGem().
function loadWorkerHelpers() {
  var src = fs.readFileSync(path.join(ROOT, "worker", "astrogem-bible.js"), "utf8");
  var from = src.indexOf("const GEM_ID_674");
  var mark = src.indexOf("function repairStoredGem");
  if (from === -1 || mark === -1) throw new Error("worker/astrogem-bible.js: helper block not found");
  var to = src.indexOf("\n}", mark);
  if (to === -1) throw new Error("worker/astrogem-bible.js: repairStoredGem has no end");
  var block = src.slice(from, to + 2);
  var ctx = { module: {}, console: console };
  vm.createContext(ctx);
  vm.runInContext(block + "\nthis.api = { costFromGemId: costFromGemId, typeFromGemId: typeFromGemId," +
    " costFromEffects: costFromEffects, poolHolds: poolHolds, gemIdentity: gemIdentity," +
    " repairStoredGem: repairStoredGem, GEM_ID_OVERRIDES: GEM_ID_OVERRIDES };", ctx);
  return ctx.api;
}

// The client file is a plain IIFE that exports { parse }. Its helpers are private, so
// reach them the same way: slice, evaluate, compare.
function loadClientHelpers() {
  var src = fs.readFileSync(path.join(ROOT, "bible-import.js"), "utf8");
  var from = src.indexOf("const GEM_ID_674");
  var mark = src.indexOf("function gemIdentity");
  if (from === -1 || mark === -1) throw new Error("bible-import.js: helper block not found");
  var to = src.indexOf("\n  }", mark);
  if (to === -1) throw new Error("bible-import.js: gemIdentity has no end");
  var block = src.slice(from, to + 4);
  var ctx = { console: console };
  vm.createContext(ctx);
  vm.runInContext(block + "\nthis.api = { costFromGemId: costFromGemId, typeFromGemId: typeFromGemId," +
    " costFromEffects: costFromEffects, poolHolds: poolHolds, gemIdentity: gemIdentity," +
    " GEM_ID_OVERRIDES: GEM_ID_OVERRIDES };", ctx);
  return ctx.api;
}

var W = loadWorkerHelpers();
var C = loadClientHelpers();
var BibleImport = require(path.join(ROOT, "bible-import.js"));

// ---- the cases ---------------------------------------------------------------------

var ADD = "Additional Damage", ATK = "Attack Power", BOSS = "Boss Damage";
var ALLYD = "Ally Damage Enh.", BRAND = "Brand Power", ALLYA = "Ally Attack Enh.";

// Real ids pulled off live lostark.bible character pages (2026-09-16), with the cost and
// type the site itself draws. The 674 rows are the 18 distinct ids seen across a 1,060-gem
// sample; the 4062117x rows are the new family, each confirmed by icon elimination (the
// one use_13_2NN icon left over after accounting for every 674 gem on the page).
var CASES = [
  // id,        effect1, effect2, expected cost, expected type, id rule alone was right?
  ["67401024", ADD,   BRAND, 8,  "order", true],
  ["67401025", ADD,   ATK,   8,  "order", true],
  ["67401026", ADD,   ALLYD, 8,  "order", true],
  ["67401124", ALLYD, BOSS,  9,  "order", true],
  ["67401125", ATK,   BOSS,  9,  "order", true],
  ["67401126", ATK,   BOSS,  9,  "order", true],
  ["67401224", ADD,   BOSS,  10, "order", true],
  ["67401225", ALLYA, BRAND, 10, "order", true],
  ["67401226", ADD,   BOSS,  10, "order", true],
  ["67411324", ADD,   BRAND, 8,  "chaos", true],
  ["67411325", ADD,   ATK,   8,  "chaos", true],
  ["67411326", ALLYD, BRAND, 8,  "chaos", true],
  ["67411424", ATK,   BOSS,  9,  "chaos", true],
  ["67411425", ALLYD, BOSS,  9,  "chaos", true],
  ["67411426", ALLYA, ALLYD, 9,  "chaos", true],
  ["67411524", ALLYA, BRAND, 10, "chaos", true],
  ["67411525", BOSS,  BRAND, 10, "chaos", true],
  ["67411526", ALLYA, BOSS,  10, "chaos", true],
  // the failing family — the id rule says 9-cost chaos for all four
  ["40621173", ATK,   ADD,   8,  "order", false],
  ["40621174", BRAND, ALLYD, 8,  "order", false],
  ["40621175", ATK,   ADD,   8,  "chaos", false],
  ["40621176", BRAND, ALLYD, 8,  "chaos", false]
];

var fails = [];
function check(name, got, want) {
  if (got !== want) fails.push(name + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

// 1. every real id resolves to the cost and type lostark.bible draws, in BOTH files.
CASES.forEach(function (c) {
  var id = c[0], e1 = c[1], e2 = c[2], cost = c[3], type = c[4], idRuleOk = c[5];
  [["worker", W], ["client", C]].forEach(function (pair) {
    var who = pair[0], api = pair[1];
    var r = api.gemIdentity(id, e1, e2);
    check(who + " " + id + " cost", r.baseCost, cost);
    check(who + " " + id + " type", r.gemType, type);
    // The digit rule on its own: right for 674, wrong for the new family.
    check(who + " " + id + " id-rule-alone", api.costFromGemId(id) === cost, idRuleOk);
  });
});

// 2. the six effect pairs that pin a cost on their own, and the three that do not.
[[ADD, ATK, 8], [BRAND, ALLYD, 8], [BOSS, ATK, 9], [ALLYD, ALLYA, 9],
 [BOSS, ADD, 10], [BRAND, ALLYA, 10],
 [ATK, ALLYD, null], [ADD, BRAND, null], [BOSS, ALLYA, null]].forEach(function (p) {
  check("worker costFromEffects " + p[0] + "+" + p[1], W.costFromEffects(p[0], p[1]), p[2]);
  check("client costFromEffects " + p[0] + "+" + p[1], C.costFromEffects(p[0], p[1]), p[2]);
  // order of the two effects must not matter
  check("worker costFromEffects (swapped) " + p[1] + "+" + p[0], W.costFromEffects(p[1], p[0]), p[2]);
});

// 3. a repair must be warned about; a clean 674 gem must stay quiet.
var noisy = W.gemIdentity("40621173", ATK, ADD);
if (!noisy.warnings.length) fails.push("worker 40621173: a corrected cost raised no warning");
var quiet = W.gemIdentity("67401025", ADD, ATK);
if (quiet.warnings.length) fails.push("worker 67401025: a clean gem warned: " + quiet.warnings.join("; "));

// 4. an id in NO table and outside the 674 format still lands on the right cost via the
//    pools, and says out loud that it did not recognise the id.
var future = W.gemIdentity("99999199", BOSS, ADD);
check("worker unknown-id cost", future.baseCost, 10);
if (!future.warnings.length) fails.push("worker 99999199: unknown id format raised no warning");
// ...and when the pair fits two pools there is nothing to repair with, so the id stands.
var stuck = W.gemIdentity("40621171", BOSS, ALLYA);   // id rule -> 9, pair fits 9 and 10
check("worker ambiguous-pair cost", stuck.baseCost, 9);

// 5. repairStoredGem fixes a record cached under the old rule, and leaves a good one alone.
var stale = { gemId: "40621173", baseCost: 9, gemType: "chaos", effect1: ATK, effect2: ADD };
check("repairStoredGem changed", W.repairStoredGem(stale), true);
check("repairStoredGem cost", stale.baseCost, 8);
check("repairStoredGem type", stale.gemType, "order");
check("repairStoredGem is idempotent", W.repairStoredGem(stale), false);
var fine = { gemId: "67401025", baseCost: 8, gemType: "order", effect1: ADD, effect2: ATK };
check("repairStoredGem leaves a good gem alone", W.repairStoredGem(fine), false);

// 6. end to end through BibleImport.parse, on a page slice in lostark.bible's own shape:
//    one core holding the failing gem plus three ordinary ones.
var page = 'classification:"most_recent_raid",arkGridCores:[{id:673001226,base:10002,gems:[' +
  '{id:40621173,idx:0,costReduc:5,corePoints:5,opts:[{id:2001,level:5},{id:2002,level:5}]},' +
  '{id:67401025,idx:1,costReduc:5,corePoints:4,opts:[{id:2002,level:4},{id:2001,level:4}]},' +
  '{id:67401126,idx:2,costReduc:4,corePoints:5,opts:[{id:2001,level:5},{id:2003,level:5}]},' +
  '{id:67401226,idx:3,costReduc:5,corePoints:5,opts:[{id:2002,level:5},{id:2003,level:5}]}]}]';
var parsed = BibleImport.parse(page, { region: "NA", name: "Testcase" });
if (!parsed) fails.push("BibleImport.parse returned null on the sample page");
else {
  check("parse gem count", parsed.gems.length, 4);
  check("parse failing gem cost", parsed.gems[0].baseCost, 8);
  check("parse failing gem type", parsed.gems[0].gemType, "order");
  check("parse failing gem slot", parsed.gems[0].slot, "Order Moon");
  check("parse ordinary 8-cost", parsed.gems[1].baseCost, 8);
  check("parse ordinary 9-cost", parsed.gems[2].baseCost, 9);
  check("parse ordinary 10-cost", parsed.gems[3].baseCost, 10);
  // and every gem now passes the model's own check — the bug was that gem 0 did not.
  var A = require(path.join(ROOT, "model", "astrogem.js"));
  parsed.gems.forEach(function (g, i) {
    var v = A.validateConfig(g);
    if (!v.valid) fails.push("parse gem " + i + " still invalid: " + v.error);
  });
}

// ---- report ------------------------------------------------------------------------

if (fails.length) {
  console.error("FAIL (" + fails.length + ")");
  fails.forEach(function (f) { console.error("  " + f); });
  process.exit(1);
}
console.log("ok — " + CASES.length + " real gem ids, both files agree, and the sample page grades clean");
