#!/usr/bin/env node
/**
 * tools/optimize-images.mjs — re-runnable image upkeep.   `npm run optimize-images`
 *
 * 1. Runs svgo 4 (`npx --yes svgo@4`, nothing to install) in place on SVG_DIRS and prints bytes
 *    before/after. This file is also the svgo config (the default export): preset-default, which
 *    in svgo 4 already keeps viewBox, with mergePaths turned off so every path stays its own
 *    element. Re-running on optimized files changes nothing.
 * 2. Lists every PNG/JPG over 200 KB, skipping data/ and samples/ folders at any depth, plus
 *    node_modules/, dist/ and dot-folders (.git, .claude worktrees, caches). It only reports.
 *
 * Replacing an existing image with different bytes? Give the new file a new name: images carry no
 * ?v= pin, so browsers and the edge can hold the old bytes under the old name.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export default {
  multipass: true,
  plugins: [{ name: "preset-default", params: { overrides: { mergePaths: false } } }],
};

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(HERE), "..");
const SVG_DIRS = ["shared/class-icons"];
const BIG = 200 * 1024;
const SKIP = new Set(["node_modules", "dist", "data", "samples"]);

const svgSizes = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".svg"))
    .reduce((m, f) => ((m[f] = statSync(join(ROOT, dir, f)).size), m), {});

function optimizeSvgs() {
  let ok = true;
  for (const dir of SVG_DIRS) {
    const before = svgSizes(dir);
    const r = spawnSync("npx", ["--yes", "svgo@4", "--config", relative(ROOT, HERE), "--quiet", "-f", dir], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32", // npx is npx.cmd there
    });
    if (r.status !== 0) {
      console.error(`svgo failed on ${dir} (exit ${r.status})`);
      ok = false;
      continue;
    }
    const after = svgSizes(dir);
    let b = 0, a = 0;
    for (const f of Object.keys(before)) {
      b += before[f];
      a += after[f];
      if (after[f] !== before[f]) console.log(`  ${f}: ${before[f]} -> ${after[f]} B`);
    }
    const pct = b ? ((100 * (b - a)) / b).toFixed(1) : "0.0";
    console.log(`${dir}: ${Object.keys(before).length} SVGs, ${b} -> ${a} B (-${pct}%)`);
  }
  return ok;
}

function listBigRasters(dir = ROOT, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || SKIP.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) listBigRasters(p, out);
    else if (ent.isFile() && [".png", ".jpg", ".jpeg"].includes(extname(ent.name).toLowerCase())) {
      const size = statSync(p).size;
      if (size > BIG) out.push([relative(ROOT, p).replaceAll("\\", "/"), size]);
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ok = optimizeSvgs();
  const big = listBigRasters().sort((x, y) => y[1] - x[1]);
  console.log(big.length ? `\nPNG/JPG over ${BIG / 1024} KB:` : `\nNo PNG/JPG over ${BIG / 1024} KB.`);
  for (const [f, s] of big) console.log(`  ${(s / 1024).toFixed(0).padStart(6)} KB  ${f}`);
  process.exit(ok ? 0 : 1);
}
