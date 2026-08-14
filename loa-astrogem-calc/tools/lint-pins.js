#!/usr/bin/env node
/**
 * tools/lint-pins.js — catch version pins that must agree but are edited separately.
 *
 * Two files in this app carry their OWN version number and compare it against the
 * cache-buster index.html requests. When only one side is bumped the mismatch cannot
 * be caught locally — the eval gate passes, the browser check passes, and the bug
 * only appears once deployed. It shipped exactly that way: advisor.js reported v76
 * while index.html asked for v77, so every up-to-date tab told the user it was stale
 * and that a hard reload would fix it, which it could not.
 *
 * A comment saying "MUST match" is not a check. This is.
 */
"use strict";
var fs = require("fs"), path = require("path");
var ROOT = path.resolve(__dirname, "..");
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var problems = [];

// file -> the constant inside it that must equal its own ?v= in index.html
var SELF_REPORTING = {
  "advisor.js": /var\s+CLIENT_V\s*=\s*(\d+)/,
  "model/dp-worker.js": null   // pins its imports instead; checked below
};

Object.keys(SELF_REPORTING).forEach(function (file) {
  var re = SELF_REPORTING[file];
  if (!re) return;
  var pin = html.match(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\?v=(\\d+)"));
  if (!pin) { problems.push(file + ": no ?v= pin found in index.html"); return; }
  var src = fs.readFileSync(path.join(ROOT, file), "utf8");
  var self = src.match(re);
  if (!self) { problems.push(file + ": self-version constant not found"); return; }
  if (self[1] !== pin[1]) {
    problems.push(file + ": self-reports v" + self[1] + " but index.html pins v" + pin[1] +
      " — a deployed tab would call itself stale");
  }
});

// dp-worker importScripts must match the model pins index.html uses
var dpw = fs.readFileSync(path.join(ROOT, "model/dp-worker.js"), "utf8");
["astrogem.js", "nested.js", "dp.js"].forEach(function (m) {
  var inWorker = dpw.match(new RegExp(m.replace(".", "\\.") + "\\?v=(\\d+)"));
  var inHtml = html.match(new RegExp("model/" + m.replace(".", "\\.") + "\\?v=(\\d+)"));
  if (inWorker && inHtml && inWorker[1] !== inHtml[1]) {
    problems.push("model/dp-worker.js imports " + m + "?v=" + inWorker[1] +
      " but index.html pins v" + inHtml[1] + " — the worker would run a stale model");
  }
});

// The Grader's screenshot mode injects its OCR files at runtime. gemlist.js reads
// the pinned list out of index.html (window.LAZY_GEMLIST) rather than carrying its
// own copy, so there is nothing to cross-check — but if the array goes missing the
// mode silently falls back to UNPINNED urls, which the loseii zone then caches for
// four hours. Check the array exists and names files that are actually there.
var lazy = html.match(/var\s+LAZY_GEMLIST\s*=\s*\[([^\]]*)\]/);
if (!lazy) {
  problems.push("index.html: LAZY_GEMLIST is missing — gemlist.js would load its OCR files unpinned");
} else {
  var files = lazy[1].match(/"([^"]+)"/g) || [];
  if (!files.length) problems.push("index.html: LAZY_GEMLIST is empty");
  files.forEach(function (q) {
    var rel = q.replace(/"/g, "");
    if (!/\?v=\d+/.test(rel)) problems.push("index.html: LAZY_GEMLIST entry " + rel + " has no ?v= pin");
    if (!fs.existsSync(path.join(ROOT, rel.split("?")[0]))) problems.push("index.html: LAZY_GEMLIST names a missing file: " + rel);
  });
}

// grader.js's "Custom input" mode mounts advisor-window.js and looks its pinned
// url up inside LAZY_TABS.advisor rather than carrying a second copy of the pin.
// If that entry is ever renamed or dropped, the Grader silently falls back to an
// UNPINNED url and the two tabs can end up running different builds of the same
// component. Check the entry it looks for is really there.
var adv = html.match(/advisor:\s*\[([\s\S]*?)\]/);
if (!adv) {
  problems.push("index.html: LAZY_TABS.advisor not found — grader.js could not find advisor-window.js's pin");
} else if (!/"advisor-window\.js\?v=\d+"/.test(adv[1])) {
  problems.push("index.html: LAZY_TABS.advisor has no pinned advisor-window.js — the Grader's custom mode would load it unpinned");
}

problems.forEach(function (p) { console.log("ERROR " + p); });
console.log("lint-pins: " + problems.length + " problem(s)");
process.exit(problems.length ? 1 : 0);
