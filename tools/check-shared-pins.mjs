#!/usr/bin/env node
/**
 * tools/check-shared-pins.mjs — do the pins on /shared/ files agree, and did a changed
 * shared file get a new one?
 *
 *   node tools/check-shared-pins.mjs [ref]
 *
 * ref defaults to the merge-base with the PR base (GITHUB_BASE_REF) or origin/main,
 * else HEAD. The diff runs against the working tree, so uncommitted edits count.
 *
 * The loseii.com zone caches .js for four hours whatever _headers says, so a file's
 * `?v=` pin is the only thing that makes a returning browser fetch a new copy. A file in
 * /shared/ is loaded by several pages, each with its own tag, and the tool folders'
 * checkers (astrogem lint-pins, bracelet check-cache-versions) see only their own folder.
 * This one sees them all:
 *
 *   SPLIT    two pages load the same /shared/ file at different pins: two cache entries,
 *            and the pages run different copies.
 *   MISSING  a pin names a /shared/ file that does not exist.
 *   NAV      nav.js's OAUTH_V (the pin it lazy-loads bible-oauth.js with) differs from
 *            the pages' pin for that file.
 *   MISS     a /shared/ file differs from `ref` but its pin did not move.
 *
 * Exit 0 when consistent, 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function refDefault() {
  // As check-cross-pins.mjs: the PR base, else the merge-base with origin/main, else HEAD.
  const base = process.env.GITHUB_BASE_REF ? "origin/" + process.env.GITHUB_BASE_REF : "origin/main";
  try {
    return execFileSync("git", ["merge-base", "HEAD", base], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "HEAD";
  } catch (e) { return "HEAD"; }
}
const REF = process.argv[2] || refDefault();
const SKIP = new Set(["node_modules", ".git", ".wrangler", "dist", "docs", "data", "samples", "worker", ".cache", ".claude"]);
const PIN = /\/shared\/([A-Za-z0-9_.-]+\.(?:js|css))\?v=([A-Za-z0-9]+)/g;
const rel = (p) => relative(ROOT, p).split(sep).join("/");
const problems = [];

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), out); }
    else if (/\.(html|js|mjs|css)$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

/** file -> Map(pin -> [where, …]) over the given {path: text} set. */
function pins(texts) {
  const by = new Map();
  for (const [where, text] of Object.entries(texts)) {
    let m;
    PIN.lastIndex = 0;
    while ((m = PIN.exec(text)) !== null) {
      if (!by.has(m[1])) by.set(m[1], new Map());
      const v = by.get(m[1]);
      if (!v.has(m[2])) v.set(m[2], []);
      v.get(m[2]).push(where);
    }
  }
  return by;
}

const texts = {};
for (const f of walk(ROOT, [])) {
  const r = rel(f);
  if (r.startsWith("shared/") || r.startsWith("tools/")) continue;   // the files themselves, and this checker
  texts[r] = readFileSync(f, "utf8");
}
const now = pins(texts);

for (const [file, vs] of now) {
  if (!existsSync(join(ROOT, "shared", file))) problems.push(`MISSING  /shared/${file} is pinned but does not exist`);
  if (vs.size > 1) {
    problems.push(`SPLIT    /shared/${file} is loaded at ` +
      [...vs].map(([v, w]) => `v=${v} (${w.join(", ")})`).join(" and "));
  }
}

// nav.js lazy-loads bible-oauth.js with its own constant.
{
  const nav = texts["nav.js"] || "";
  const m = nav.match(/var\s+OAUTH_V\s*=\s*"([^"]+)"/);
  const page = now.get("bible-oauth.js");
  if (!m) problems.push("NAV      nav.js: OAUTH_V not found");
  else if (page) for (const v of page.keys()) {
    if (v !== m[1]) problems.push(`NAV      nav.js OAUTH_V is "${m[1]}" but pages load /shared/bible-oauth.js?v=${v}`);
  }
}

// A changed shared file must carry a new pin.
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
let changed = [];
try {
  changed = git(["diff", "--name-only", REF, "--", "shared/"]).split(/\r?\n/).filter(Boolean)
    .concat(git(["ls-files", "--others", "--exclude-standard", "--", "shared/"]).split(/\r?\n/).filter(Boolean));
} catch (e) { console.warn("check-shared-pins: no git answer, skipping the MISS check"); }
if (changed.length) {
  const old = {};
  for (const r of Object.keys(texts)) {
    try { old[r] = git(["show", REF + ":" + r]); } catch (e) { /* new at this ref */ }
  }
  const was = pins(old);
  for (const path of new Set(changed)) {
    const file = path.replace(/^shared\//, "");
    if (!/\.(js|css)$/.test(file) || !now.has(file)) continue;
    const before = was.get(file);
    if (!before) continue;                       // first pinned since REF: nothing to compare
    for (const v of now.get(file).keys()) {
      if (before.has(v)) problems.push(`MISS     /shared/${file} changed since ${REF} but is still loaded at v=${v}: bump every loader's pin`);
    }
  }
}

if (problems.length) {
  console.error("check-shared-pins: " + problems.length + " problem(s)\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("check-shared-pins: ok (" + [...now].map(([f, v]) => f + "@v" + [...v.keys()][0]).join(", ") + ")");
