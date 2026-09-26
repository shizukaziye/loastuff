/**
 * tools/check-cross-pins.mjs — when one tool's file changes, did every OTHER
 * tool that pins it with ?v= bump its pin?
 *
 *   node tools/check-cross-pins.mjs [base-ref]
 *
 * WHY THIS EXISTS. The loseii.com zone caches .js for four hours, so every
 * script load carries a ?v= pin. Each tool's own checker (loa-bracelet-calc's
 * check-cache-versions.mjs, loa-astrogem-calc's lint-pins.js) only sees pins
 * inside its own folder. But tools load each other's files: profile/profile.js
 * pins /loa-bracelet-calc/model/bracelet.js and /loa-gpd/lookup.js, the hub and three
 * tools pin /shared/bible-oauth.js, loa-gpd/lookup.js pins the bracelet
 * model through BC_BASE + BC_FILES + BC_PIN, the bracelet advisor pins
 * loa-gpd/model/bracelet-price.js. Change one of those files without touching
 * the loading side and returning browsers run the old copy for four hours.
 * This checker is the whole-repo pass for exactly that.
 *
 * HOW. Every tracked (or new, unignored) .html/.js outside node_modules/,
 * samples/, data/ is scanned for `path?v=N` references (and the
 * *_BASE/*_FILES/*_PIN triple). A reference is cross-tool when the file it
 * resolves to lives under a different top-level folder than the file naming it
 * (the repo root counts as its own folder). For each one whose target changed
 * between the base ref and the working tree, the pin in the referencing file at
 * the base ref is compared with the pin now: same pin = MISS.
 *
 * The base ref, first match wins: the argument; the PR base
 * (GITHUB_BASE_REF -> merge-base with origin/<it>); CROSS_PINS_BEFORE (a
 * push's `before` sha); the merge-base with origin/main; HEAD~1. As in
 * check-cache-versions.mjs, the diff runs against the working tree, so staged
 * and unstaged edits count too.
 *
 * Exit 0 when every changed cross-tool target had its pins bumped, 1 on any
 * MISS, 2 when git cannot answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  // stderr dropped: on Windows git warns about CRLF for every file it touches
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024 });
}
function tryGit(args) { try { return git(args).trim(); } catch (e) { return null; } }
const isSha = s => !!s && !/^0+$/.test(s) && tryGit(["cat-file", "-e", s + "^{commit}"]) !== null;

// ---- the base ref ------------------------------------------------------------
function pickBase() {
  if (process.argv[2]) return { ref: process.argv[2], why: "argument" };
  const pr = process.env.GITHUB_BASE_REF;
  if (pr) {
    const mb = tryGit(["merge-base", "HEAD", "origin/" + pr]);
    if (mb) return { ref: mb, why: "merge-base with origin/" + pr };
  }
  const before = process.env.CROSS_PINS_BEFORE;
  if (isSha(before)) return { ref: before, why: "push before" };
  const mb = tryGit(["merge-base", "HEAD", "origin/main"]);
  if (mb) return { ref: mb, why: "merge-base with origin/main" };
  if (isSha("HEAD~1")) return { ref: "HEAD~1", why: "previous commit" };
  return null;
}
const base = pickBase();
if (!base || tryGit(["rev-parse", "--verify", base.ref + "^{commit}"]) === null) {
  console.error("cannot find a base commit to compare against — is this a git checkout with history?");
  process.exit(2);
}

// ---- which files to scan -------------------------------------------------------
const SKIP = /(^|\/)(node_modules|samples|data|\.claude|\.git)\//;
const files = git(["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n")
  .map(s => s.trim()).filter(f => f && /\.(html|js|mjs)$/.test(f) && !SKIP.test(f) && existsSync(join(root, f)));
const known = new Set(git(["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").map(s => s.trim()));
const exists = p => known.has(p) || existsSync(join(root, p));

const toolOf = p => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "");

/** resolve a reference written in `src` to a repo path, or null */
function resolve(src, ref) {
  ref = ref.replace(/^https?:\/\/(www\.)?loseii\.com/, "");
  const tries = [];
  if (ref.startsWith("/")) tries.push(ref.slice(1));
  else {
    tries.push(posix.join(posix.dirname(src), ref));               // relative to the file
    if (!src.endsWith(".html")) tries.push(posix.join(toolOf(src), ref)); // a script: relative to its page
    tries.push(posix.normalize(ref));                              // written root-relative without the slash
  }
  for (const t of tries) {
    const n = posix.normalize(t);
    if (!n.startsWith("..") && exists(n)) return n;
  }
  return null;
}

/** [{target, v}] for every pinned reference in `text` (a file at path `src`) */
function refsIn(src, text) {
  const out = [];
  const re = /((?:https?:\/\/(?:www\.)?loseii\.com)?\/?[A-Za-z0-9_.\/-]*[A-Za-z0-9_-]\.(?:js|mjs|json|css))\?v=([A-Za-z0-9_.-]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = resolve(src, m[1]);
    if (target) out.push({ target, v: m[2] });
  }
  // constructed pins: var X_BASE = "https://www.loseii.com/dir/"; var X_PIN = "v"; var X_FILES = [...]
  const bases = /var\s+(\w+)_BASE\s*=\s*"https?:\/\/(?:www\.)?loseii\.com\/([^"]*)"/g;
  while ((m = bases.exec(text)) !== null) {
    const pin = new RegExp("var\\s+" + m[1] + "_PIN\\s*=\\s*\"([^\"]+)\"").exec(text);
    const list = new RegExp("var\\s+" + m[1] + "_FILES\\s*=\\s*\\[([\\s\\S]*?)\\];").exec(text);
    if (!pin || !list) continue;
    const names = [...list[1].matchAll(/"([^"]+\.(?:js|json|css))"/g)].map(x => x[1]);
    for (const nm of names) {
      const target = resolve(src, "/" + m[2] + nm);
      if (target) out.push({ target, v: pin[1] });
    }
  }
  return out;
}

const changed = new Set((tryGit(["diff", "--name-only", base.ref]) || "").split("\n").map(s => s.trim()).filter(Boolean));
// new files are "changed" too, but nothing can have pinned them at the base
const oldCache = new Map();
function oldRefs(src) {
  if (!oldCache.has(src)) {
    const text = tryGit(["show", base.ref + ":" + src]);
    const map = new Map();
    if (text !== null) for (const r of refsIn(src, text)) {
      if (!map.has(r.target)) map.set(r.target, []);
      map.get(r.target).push(r.v);
    }
    oldCache.set(src, text === null ? null : map);
  }
  return oldCache.get(src);
}

const misses = [], bumped = [], fresh = [], byTarget = new Map();
let crossCount = 0;
for (const src of files) {
  const refs = refsIn(src, readFileSync(join(root, src), "utf8"));
  for (const r of refs) {
    if (toolOf(r.target) === toolOf(src)) continue;               // same tool: its own checker's job
    crossCount++;
    if (!byTarget.has(r.target)) byTarget.set(r.target, new Map());
    byTarget.get(r.target).set(src, r.v);
    if (!changed.has(r.target)) continue;
    const old = oldRefs(src);
    const was = old && old.get(r.target);
    if (!was) { fresh.push({ src, ...r }); continue; }
    if (was.includes(r.v)) misses.push({ src, ...r });
    else bumped.push({ src, ...r, from: was.join("/") });
  }
}

console.log(`cross-tool pins: ${crossCount} references to ${byTarget.size} files; base ${base.ref.slice(0, 12)} (${base.why}); ${changed.size} files changed`);
for (const b of bumped) console.log(`  ok    ${b.target}  v${b.from} -> v${b.v}  [${b.src}]`);
for (const f of fresh) console.log(`  new   ${f.target}  v${f.v}  [${f.src}] (not pinned there at the base)`);
for (const m of misses) console.log(`  MISS  ${m.target}  changed but still v${m.v}  [${m.src}]`);
// informational: two tools pinning one file at different versions load two cached copies
for (const [target, srcs] of byTarget) {
  const vs = new Set(srcs.values());
  if (vs.size > 1) console.log(`  note  ${target} is pinned at ${[...srcs].map(([s, v]) => "v" + v + " by " + s).join(", ")}`);
}

if (misses.length) {
  console.log("\nA MISS means returning browsers keep the old copy of another tool's file for four hours." +
    "\nBump the ?v= where named (and in every other file that pins the same target).");
  process.exit(1);
}
console.log("\nevery changed cross-tool file had its pins bumped");
