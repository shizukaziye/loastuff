#!/usr/bin/env node
/**
 * tools/check-tools.mjs — does every copy of the tool list agree with shared/tools.js?
 *
 *   node tools/check-tools.mjs            check (exit 1 on any disagreement)
 *   node tools/check-tools.mjs --write    rewrite nav.js's inline list from tools.js, then check
 *
 * shared/tools.js is the one list of Loseii tools. Four other places repeat parts of it,
 * and before this check they had drifted apart (two names for the accessory and crafting
 * tools, two addresses for the profiles, a pill that counted a recap as a tool):
 *
 *   nav.js        the GROUPS block between TOOLS:BEGIN and TOOLS:END — same groups, same
 *                 order, same name and url per item. --write regenerates it.
 *   index.html    one hub card per item (h3 = name, href = url, in any order), the
 *                 "N live tools" pill = the number of items with live:true, and the meta
 *                 description names every live item by its `keyword`.
 *   tool pages    every item on www.loseii.com with a page of its own has a <title> that
 *                 contains its name and ends in " — Loseii".
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.loseii.com";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const problems = [];

// ---- tools.js ----
const sandbox = { window: {} };
vm.runInNewContext(read("shared/tools.js"), sandbox, { filename: "shared/tools.js" });
const TOOLS = sandbox.window.LOSEII_TOOLS;
if (!TOOLS || !Array.isArray(TOOLS.groups)) {
  console.error("shared/tools.js: window.LOSEII_TOOLS.groups is missing");
  process.exit(1);
}
const items = TOOLS.groups.flatMap((g) => g.items);
const KINDS = new Set(["profiles", "calculator", "market", "community", "recap", "analyzer", "planner"]);
for (const it of items) {
  for (const f of ["name", "url", "kind", "blurb"]) {
    if (typeof it[f] !== "string" || !it[f]) problems.push(`tools.js: "${it.name}" has no ${f}`);
  }
  if (typeof it.live !== "boolean") problems.push(`tools.js: "${it.name}" needs live: true or false`);
  if (it.kind && !KINDS.has(it.kind)) problems.push(`tools.js: "${it.name}" has unknown kind "${it.kind}"`);
  if (it.live && !it.keyword) problems.push(`tools.js: live item "${it.name}" needs a keyword for the meta description`);
}

/** Site addresses compare as paths: "https://www.loseii.com/x/" and "/x/" are one link. */
function norm(u) {
  u = String(u).trim();
  if (u.startsWith(SITE + "/")) u = u.slice(SITE.length);
  return u;
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// ---- nav.js ----
const NAV_RE = /(\/\* TOOLS:BEGIN[^\n]*\*\/\r?\n)([\s\S]*?)(\r?\n[ \t]*\/\* TOOLS:END \*\/)/;

function navBlock(eol) {
  const q = (s) => JSON.stringify(s);
  const groups = TOOLS.groups.map((g) => {
    const rows = g.items.map((it) => `        { name: ${q(it.name)}, url: ${q(it.url)} }`).join("," + eol);
    return `    {${eol}      label: ${q(g.label)},${eol}      items: [${eol}${rows}${eol}      ]${eol}    }`;
  }).join("," + eol);
  return `  var GROUPS = [${eol}${groups}${eol}  ];`;
}

let nav = read("nav.js");
if (process.argv.includes("--write")) {
  const eol = nav.includes("\r\n") ? "\r\n" : "\n";
  if (!NAV_RE.test(nav)) { console.error("nav.js: TOOLS:BEGIN / TOOLS:END markers not found"); process.exit(1); }
  const next = nav.replace(NAV_RE, (m, a, b, c) => a + navBlock(eol) + c);
  if (next !== nav) { writeFileSync(join(ROOT, "nav.js"), next); nav = next; console.log("nav.js: tool list rewritten from shared/tools.js"); }
  else console.log("nav.js: tool list already matches");
}
{
  const m = nav.match(NAV_RE);
  if (!m) problems.push("nav.js: TOOLS:BEGIN / TOOLS:END markers not found");
  else {
    const box = {};
    try { vm.runInNewContext(m[2] + "\nthis.__g = GROUPS;", box); } catch (e) { problems.push("nav.js: the tool block does not parse: " + e.message); }
    const G = box.__g || [];
    const want = TOOLS.groups;
    if (G.length !== want.length) problems.push(`nav.js: ${G.length} groups, tools.js has ${want.length}`);
    want.forEach((g, gi) => {
      const ng = G[gi];
      if (!ng) return;
      if (ng.label !== g.label) problems.push(`nav.js: group ${gi + 1} is "${ng.label}", tools.js says "${g.label}"`);
      const n = Math.max(ng.items.length, g.items.length);
      for (let i = 0; i < n; i++) {
        const a = ng.items[i], b = g.items[i];
        if (!a || !b) { problems.push(`nav.js: "${g.label}" has ${ng.items.length} items, tools.js has ${g.items.length}`); break; }
        if (a.name !== b.name || a.url !== b.url) {
          problems.push(`nav.js: "${g.label}" item ${i + 1} is ${a.name} <${a.url}>, tools.js says ${b.name} <${b.url}>`);
        }
      }
    });
  }
}

// ---- index.html: cards, pill, meta description ----
const hub = read("index.html");
{
  const cards = [];
  const re = /<a class="card[^"]*" href="([^"]+)"[\s\S]*?<h3>([\s\S]*?)<\/h3>/g;
  let m;
  while ((m = re.exec(hub)) !== null) cards.push({ url: norm(m[1]), name: decode(m[2]) });
  const byUrl = new Map(cards.map((c) => [c.url, c]));
  for (const it of items) {
    const c = byUrl.get(norm(it.url));
    if (!c) { problems.push(`index.html: no hub card links to ${it.url} (${it.name})`); continue; }
    if (c.name !== it.name) problems.push(`index.html: the card for ${it.url} says "${c.name}", tools.js says "${it.name}"`);
  }
  const known = new Set(items.map((it) => norm(it.url)));
  for (const c of cards) if (!known.has(c.url)) problems.push(`index.html: card "${c.name}" <${c.url}> is not in tools.js`);

  const live = items.filter((it) => it.live).length;
  const pill = hub.match(/(\d+)\s+live tools/);
  if (!pill) problems.push('index.html: the "N live tools" pill is missing');
  else if (Number(pill[1]) !== live) problems.push(`index.html: the pill says ${pill[1]} live tools, tools.js has ${live}`);

  const desc = hub.match(/<meta name="description" content="([^"]*)"/);
  if (!desc) problems.push("index.html: no meta description");
  else {
    const d = decode(desc[1]).toLowerCase();
    for (const it of items) {
      if (it.live && it.keyword && !d.includes(it.keyword.toLowerCase())) {
        problems.push(`index.html: the meta description does not name ${it.name} ("${it.keyword}")`);
      }
    }
  }
}

// ---- each tool page's <title> ----
for (const it of items) {
  if (!it.url.startsWith(SITE + "/") || it.url.includes("#")) continue;   // off-site, or a spot on the hub
  const page = norm(it.url).replace(/^\//, "").replace(/\/?$/, "/") + "index.html";
  if (!existsSync(join(ROOT, page))) { problems.push(`${page}: missing (tools.js lists ${it.url})`); continue; }
  const t = read(page).match(/<title>([\s\S]*?)<\/title>/);
  const title = t ? decode(t[1]) : "";
  if (!title.endsWith(" — Loseii")) problems.push(`${page}: <title> "${title}" should end in " — Loseii"`);
  if (!title.includes(it.name)) problems.push(`${page}: <title> "${title}" should contain "${it.name}"`);
}

if (problems.length) {
  console.error("check-tools: " + problems.length + " problem(s)\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`check-tools: ok (${items.length} items, ${items.filter((i) => i.live).length} live; nav.js, index.html and ${items.filter((i) => i.url.startsWith(SITE + "/") && !i.url.includes("#")).length} page titles agree with shared/tools.js)`);
