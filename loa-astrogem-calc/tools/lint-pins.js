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

problems.forEach(function (p) { console.log("ERROR " + p); });
console.log("lint-pins: " + problems.length + " problem(s)");
process.exit(problems.length ? 1 : 0);
