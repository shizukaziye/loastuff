#!/usr/bin/env node
/**
 * tools/check-html.mjs — a static smoke test for every page on the site.
 *
 *   node tools/check-html.mjs
 *
 * The tool folders have their own checkers, but the hub, the profile page, the deal
 * finder and the 404 page had none. This one reads every *.html under the repo
 * (skipping node_modules, samples, data, dist, .claude, worker) with a small tolerant
 * tokenizer (comments and the bodies of <script>, <style>, <template> and <textarea>
 * are blanked first, so tags inside JS strings do not count) and reports file:line for:
 *
 *   MISSING   a <script src>, <link href> or <img src> with a relative or root-relative
 *             path that is neither a file in the repo nor a _redirects source.
 *             (?v= and # are stripped; http(s), data: and templated URLs are ignored.)
 *   PIN       a same-site script under /shared/, /loa-*\/ or /profile/ with no ?v= pin.
 *             The zone caches .js for four hours, so an unpinned file cannot be updated.
 *             nav.js, social-bar.js and prices.js are served no-cache and need none.
 *   DUP-ID    an id used twice in one document.
 *   LABEL     a <label for="x"> with no element id="x" in the document.
 *   HEAD      no <title>, no <meta name="viewport">, or no lang on <html>. Developer
 *             benches in DEV_BENCHES (opened on a desktop, never linked) skip the viewport.
 *   CHROME    a site page (index.html or 404.html that is not a redirect stub) that does
 *             not load https://www.loseii.com/nav.js and then
 *             https://www.loseii.com/social-bar.js, both defer, in that order.
 *   BLOCKING  (warning only) a script with src and no defer/async/type=module that has
 *             page markup after it, so it holds up the first paint.
 *
 * Existence is judged against the files git knows (tracked, or new and not ignored),
 * so a clean CI checkout and a local run agree. Exit 0 when there are no errors
 * (warnings allowed), 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "samples", "data", "dist", ".claude", "worker", ".git", ".wrangler", ".cache"]);
const SITE = /^https?:\/\/(?:www\.)?loseii\.com(?=\/|$)/i;
const NAV = "https://www.loseii.com/nav.js";
const SOCIAL = "https://www.loseii.com/social-bar.js";
const NO_PIN_OK = new Set(["nav.js", "social-bar.js", "prices.js"]);
const PINNED_DIRS = /^\/(shared|loa-[^/]+|profile)\//;
// Pages for the developer, not for visitors: no phone ever opens them, so no viewport.
const DEV_BENCHES = new Set(["loa-bracelet-calc/ocr/fixture.html"]);
const rel = (p) => relative(ROOT, p).split(sep).join("/");

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out); }
    else if (e.name.endsWith(".html")) out.push(join(dir, e.name));
  }
  return out;
}

// ---- what exists ----------------------------------------------------------------
let known = null;
try {
  known = new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 })
    .split("\n").map((s) => s.trim()).filter(Boolean));
} catch (e) { /* not a git checkout: the disk decides */ }
const isFile = (p) => {
  if (known && !known.has(p)) return false;
  try { return statSync(join(ROOT, p)).isFile(); } catch (e) { return false; }
};
// _redirects sources count as served paths (e.g. /loa-bracelet-calc/tip.js -> /shared/tip.js)
const redirects = [];
if (existsSync(join(ROOT, "_redirects"))) {
  for (const line of readFileSync(join(ROOT, "_redirects"), "utf8").split(/\r?\n/)) {
    const src = line.trim().split(/\s+/)[0];
    if (!src || src.startsWith("#")) continue;
    const esc = src.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:\w+/g, "[^/]+");
    redirects.push(new RegExp("^" + esc + "$"));
  }
}
/** does the site path (no leading slash, no query) serve something? */
function served(p) {
  if (p === "" || p.endsWith("/")) return isFile(p + "index.html") || redirects.some((r) => r.test("/" + p));
  return isFile(p) || isFile(p + "/index.html") || redirects.some((r) => r.test("/" + p));
}

// ---- a tolerant tokenizer ---------------------------------------------------------
const blank = (s) => s.replace(/[^\r\n]/g, " ");
function scrub(html) {
  return html.replace(/<!--[\s\S]*?(?:-->|$)|(<(script|style|template|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/\2\s*>|$)/gi,
    (m, open, tag, body, close) => (open ? open + blank(body) + close : blank(m)));
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function tokenize(text) {
  const tags = [];
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = TAG.exec(text)) !== null) {
    const attrs = {};
    const A = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = A.exec(m[3])) !== null) {
      const k = a[1].toLowerCase();
      if (!(k in attrs)) attrs[k] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    }
    tags.push({ close: !!m[1], name: m[2].toLowerCase(), attrs, pos: m.index });
  }
  return tags;
}

// ---- the checks -------------------------------------------------------------------
const errors = [], warnings = [];
const pages = walk(ROOT, []).map(rel).sort();
for (const file of pages) {
  const raw = readFileSync(join(ROOT, file), "utf8");
  const text = scrub(raw);
  const starts = [0];
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const err = (pos, rule, msg) => errors.push({ file, line: lineOf(pos), rule, msg });
  const warn = (pos, rule, msg) => warnings.push({ file, line: lineOf(pos), rule, msg });
  const tags = tokenize(text);
  const open = tags.filter((t) => !t.close);
  const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  const isStub = open.some((t) => t.name === "meta" && /^refresh$/i.test(t.attrs["http-equiv"] || ""));
  const isSitePage = /(^|\/)(index|404)\.html$/.test(file) && !isStub;

  /** the site path a URL written on this page loads, or null when it is off-site */
  function sitePath(url) {
    url = url.trim();
    if (SITE.test(url)) url = url.replace(SITE, "") || "/";
    else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return null;
    if (!url || url.startsWith("#") || /[{}$`]/.test(url)) return null;
    const path = url.replace(/[?#].*$/, "");
    const p = path.startsWith("/") ? posix.normalize(path) : posix.normalize("/" + base + path);
    return { path: p, query: url.slice(path.length) };
  }

  // HEAD: title, viewport, lang
  const html = open.find((t) => t.name === "html");
  if (!html) err(0, "HEAD", "no <html> element");
  else if (!(html.attrs.lang || "").trim()) err(html.pos, "HEAD", "<html> has no lang attribute");
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text);
  if (!title || !decode(title[1]).trim()) err(title ? title.index : 0, "HEAD", "no <title> (or an empty one)");
  if (!DEV_BENCHES.has(file) && !open.some((t) => t.name === "meta" && (t.attrs.name || "").toLowerCase() === "viewport" && (t.attrs.content || "").trim())) {
    err(title ? title.index : 0, "HEAD", 'no <meta name="viewport">');
  }

  // MISSING + PIN
  for (const t of open) {
    const attr = t.name === "script" || t.name === "img" ? "src" : t.name === "link" ? "href" : null;
    if (!attr || t.attrs[attr] === undefined) continue;
    const url = t.attrs[attr];
    const sp = sitePath(url);
    if (!sp) continue;
    const isRelative = !SITE.test(url.trim());
    if (isRelative && sp.path.startsWith("/..")) { err(t.pos, "MISSING", `<${t.name} ${attr}="${url}"> points above the site root`); continue; }
    if (isRelative && !served(decodeURI(sp.path.slice(1)))) err(t.pos, "MISSING", `<${t.name} ${attr}="${url}">: ${sp.path} is not in the repo`);
    if (t.name === "script" && PINNED_DIRS.test(sp.path) && !/[?&]v=/.test(sp.query)
        && !NO_PIN_OK.has(posix.basename(sp.path))) {
      err(t.pos, "PIN", `<script src="${url}"> has no ?v= pin (the zone caches .js for four hours)`);
    }
  }

  // DUP-ID + LABEL
  const ids = new Map();
  for (const t of open) {
    const id = t.attrs.id;
    if (id === undefined) continue;
    if (ids.has(id)) err(t.pos, "DUP-ID", `id="${id}" is used again (first at line ${lineOf(ids.get(id))})`);
    else ids.set(id, t.pos);
  }
  for (const t of open) {
    if (t.name === "label" && t.attrs.for !== undefined && !ids.has(t.attrs.for)) {
      err(t.pos, "LABEL", `<label for="${t.attrs.for}"> has no element with that id`);
    }
  }

  // CHROME + BLOCKING, site pages only
  if (isSitePage) {
    const scripts = open.filter((t) => t.name === "script" && t.attrs.src !== undefined);
    const find = (u) => scripts.findIndex((t) => t.attrs.src.trim().replace(/[?#].*$/, "") === u);
    const bodyEnd = tags.find((t) => t.close && t.name === "body");
    const at = bodyEnd ? bodyEnd.pos : raw.length;
    const n = find(NAV), s = find(SOCIAL);
    if (n < 0) err(at, "CHROME", `does not load ${NAV}`);
    if (s < 0) err(at, "CHROME", `does not load ${SOCIAL}`);
    if (n >= 0 && s >= 0 && s < n) err(scripts[s].pos, "CHROME", "social-bar.js loads before nav.js");
    for (const i of [n, s]) if (i >= 0 && !("defer" in scripts[i].attrs)) err(scripts[i].pos, "CHROME", `${scripts[i].attrs.src} is not defer`);

    const bodyEndPos = bodyEnd ? bodyEnd.pos : Infinity;
    const QUIET = ["script", "noscript", "link", "style", "template", "meta", "title", "body", "head"];
    for (const t of scripts) {
      if ("defer" in t.attrs || "async" in t.attrs || (t.attrs.type || "").toLowerCase() === "module") continue;
      const after = open.find((x) => x.pos > t.pos && x.pos < bodyEndPos && !QUIET.includes(x.name));
      if (after) warn(t.pos, "BLOCKING", `<script src="${t.attrs.src}"> has no defer/async and page markup follows it (<${after.name}> at line ${lineOf(after.pos)})`);
    }
  }
}

const byPlace = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
for (const w of warnings.sort(byPlace)) console.log(`  warn   ${w.file}:${w.line}  ${w.rule}  ${w.msg}`);
for (const e of errors.sort(byPlace)) console.log(`  ERROR  ${e.file}:${e.line}  ${e.rule}  ${e.msg}`);
console.log(`check-html: ${pages.length} pages, ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
