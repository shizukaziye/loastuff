#!/usr/bin/env node
/**
 * tools/build-dist.mjs — an optional minified copy of the site, in dist/.
 *
 *   npm run build              build dist/, then check it
 *   npm run check-dist         check an existing dist/ only
 *
 * The site needs no build: Cloudflare Pages serves the repo as it stands. This
 * script is for the day Pages is switched to build command `npm run build`,
 * output directory `dist` (README, "Minified deploy").
 *
 * WHAT IT DOES. Copies every file Pages would serve into dist/, byte for byte,
 * except .js and .css, which lose their comments and spare whitespace. Nothing
 * is renamed: no mangling, no bundling, no hashed file names. Every path and
 * every `?v=` pin in the HTML still names the same file, so the cache law
 * (bump a file's pin when you edit it) works exactly as it does today.
 *
 *   .js   terser, compress off, mangle off; licence comments (/*! and @license)
 *         kept. A file that will not parse as a script is tried as an ES module,
 *         and one that parses as neither is copied untouched, with a warning.
 *   .css  csso, restructure off (rules keep their order), comments dropped.
 *   HTML and everything else are copied as is.
 *
 * WHAT IT LEAVES OUT: Worker source (worker/ folders and chrome-cache-worker/,
 * which wrangler deploys on its own), node_modules, the OCR sample corpus
 * (samples/), the 4 GB sweep cache (data/cells, .cache), docs/ folders (except the files pages link to, KEEP
 * below), dot-folders (.git, .github, .claude, .wrangler), dist/ itself, and
 * this repo's own build files (root tools/, package.json, package-lock.json).
 *
 * THE CHECK. Every .js in dist/ must still parse: `new Function(source)`, the
 * same test as `node -e "new Function(...)"`. A file that is an ES module (new
 * Function rejects import/export) must parse as a module instead. Any failure
 * exits 1, so a broken build never deploys.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, relative, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { minify as cssMinify } from "csso";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");

// Folder names left out wherever they appear.
const SKIP_DIRS = new Set(["node_modules", "worker", "samples", ".cache", "docs", "dist", "__pycache__"]);
// Paths (from the repo root, forward slashes) left out.
const SKIP_PATHS = new Set(["tools", "package.json", "package-lock.json", "dist", "chrome-cache-worker"]);
// Files inside a skipped folder that a page links to, so they ship anyway.
const KEEP = new Set(["loa-gpd/docs/METHODOLOGY.md"]);

const rel = (p) => relative(ROOT, p).split(sep).join("/");

function skipped(p, isDir) {
  const r = rel(p);
  const name = r.slice(r.lastIndexOf("/") + 1);
  if (name.startsWith(".")) return true;                  // .git, .github, .claude, .wrangler, .gitignore …
  if (SKIP_PATHS.has(r)) return true;
  if (isDir && SKIP_DIRS.has(name)) return true;
  if (isDir && /(^|\/)data\/cells$/.test(r)) return true;
  return false;
}

/** Every file to ship, as absolute paths. */
function collect(dir, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!skipped(p, true)) collect(p, out);
    } else if (ent.isFile() && !skipped(p, false)) {
      out.push(p);
    }
  }
  return out;
}

async function minifyJs(src) {
  const opts = { compress: false, mangle: false, format: { comments: "some" } };
  for (const module of [false, true]) {
    try {
      const r = await minify(src, { ...opts, module });
      if (typeof r.code === "string") return r.code;
    } catch (e) { /* try the next way, then give up */ }
  }
  return null;
}

/** Does this source parse? A script by new Function, else an ES module by terser. */
async function parses(src) {
  const body = src.replace(/^#![^\n]*/, "");               // a node shebang is not JS
  try { new Function(body); return "script"; } catch (e) { /* maybe a module */ }
  try {
    await minify(body, { compress: false, mangle: false, module: true });
    return "module";
  } catch (e) { return null; }
}

async function check() {
  if (!existsSync(OUT)) { console.error("no dist/ to check — run npm run build"); process.exit(2); }
  const files = collect(OUT, []).filter((f) => f.endsWith(".js"));
  let bad = 0, modules = 0;
  for (const f of files) {
    const how = await parses(readFileSync(f, "utf8"));
    if (!how) { bad++; console.error("DOES NOT PARSE  dist/" + relative(OUT, f).split(sep).join("/")); }
    else if (how === "module") modules++;
  }
  console.log(`check: ${files.length} .js files in dist/, ${files.length - bad} parse` +
    (modules ? ` (${modules} as ES modules)` : "") + (bad ? `, ${bad} FAIL` : ""));
  if (bad) process.exit(1);
}

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  const files = collect(ROOT, []);
  for (const k of KEEP) if (existsSync(join(ROOT, k))) files.push(join(ROOT, k));

  const t = { js: [0, 0, 0], css: [0, 0, 0], other: 0 };   // [files, bytes in, bytes out]
  const kept = [];
  for (const f of files) {
    const r = rel(f);
    const dest = join(OUT, r);
    mkdirSync(dirname(dest), { recursive: true });
    const ext = extname(f).toLowerCase();
    if (ext === ".js" || ext === ".css") {
      const src = readFileSync(f, "utf8");
      let out = ext === ".js" ? await minifyJs(src) : cssMinify(src, { restructure: false, comments: false }).css;
      if (out == null) { kept.push(r); out = src; }
      if (out.length > src.length) out = src;               // never ship a bigger file
      writeFileSync(dest, out);
      const s = t[ext.slice(1)];
      s[0]++; s[1] += Buffer.byteLength(src); s[2] += Buffer.byteLength(out);
    } else {
      copyFileSync(f, dest);
      t.other++;
    }
  }
  const kb = (n) => (n / 1024).toFixed(0) + " KB";
  console.log(`dist/: ${t.js[0]} .js ${kb(t.js[1])} -> ${kb(t.js[2])}, ` +
    `${t.css[0]} .css ${kb(t.css[1])} -> ${kb(t.css[2])}, ${t.other} other files copied`);
  for (const r of kept) console.warn("WARNING: copied unminified (did not parse): " + r);
}

if (!process.argv.includes("--check-only")) await build();
await check();
