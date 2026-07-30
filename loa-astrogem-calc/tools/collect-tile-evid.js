#!/usr/bin/env node
/* tools/collect-tile-evid.js — build the evidence cache build-tile-model.js trains from.
 *
 * One JSONL record per board: the engine's own per-tile channel record
 * (`_debug.tileEvid`), the committed config/state with confidences, the shipped tile
 * keys and the labels. Forks N children, so a whole-corpus pass is ~2 minutes instead
 * of ~15. Nothing here decides anything — it is a parse loop with a writer.
 *
 *   node tools/collect-tile-evid.js [--jobs=10] [--out=/tmp/tevid.jsonl] [--dir=samples]
 */
"use strict";
var fs = require("fs"), path = require("path"), cp = require("child_process");
var ROOT = path.resolve(__dirname, "..");
var A = {};
process.argv.slice(2).forEach(function (a) { var m = a.match(/^--([a-z-]+)(?:=(.*))?$/); if (m) A[m[1]] = m[2] === undefined ? "1" : m[2]; });
var JOBS = parseInt(A.jobs || "10", 10);
var OUT = A.out || path.join(require("os").tmpdir(), "tevid.jsonl");
var DIR = path.resolve(ROOT, A.dir || "samples");

function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; }

function listStems() {
  var files = fs.readdirSync(DIR);
  var imgs = files.filter(function (f) { return /\.(png|jpg|jpeg|webp)$/i.test(f); });
  var out = [];
  imgs.forEach(function (f) {
    var stem = f.replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (files.indexOf(stem + ".json") === -1) return;
    var t; try { t = JSON.parse(fs.readFileSync(path.join(DIR, stem + ".json"), "utf8")); } catch (e) { return; }
    if (t._unusable) return;
    out.push({ stem: stem, img: f });
  });
  out.sort(function (a, b) { return a.stem < b.stem ? -1 : 1; });
  return out;
}

function outKey(o) {
  if (!o) return null;
  if (o.type === "raise_effect" || o.type === "lower_effect") return o.type + ":" + o.target + ":" + o.amount;
  if (o.type === "change_side_option") return "change:" + o.target;
  if (o.type === "change_gold_cost") return "cost:" + (o.change > 0 ? "+" : "-");
  if (o.type === "reroll_increase") return "reroll:" + o.change;
  return "do_nothing";
}

if (A.shard) {
  var parts = A.shard.split("/"), si = parseInt(parts[0], 10), sn = parseInt(parts[1], 10);
  var sharp = require(path.join(ROOT, "node_modules", "sharp"));
  var Tesseract = require(path.join(ROOT, "node_modules", "tesseract.js"));
  var structural = require(path.join(ROOT, "ocr", "structural-engine.js"));
  var engineApi = require(path.join(ROOT, "ocr", "engine.js"));
  var workerP = null;
  function getWorker() { if (!workerP) workerP = Tesseract.createWorker("eng", 1, { logger: function () {}, cachePath: ROOT }); return workerP; }
  var q = Promise.resolve();
  function nodeOcr(raster, opts) {
    q = q.then(async function () {
      var w = await getWorker();
      await w.setParameters({
        tessedit_pageseg_mode: String((opts && opts.psm) || 6),
        tessedit_char_whitelist: (opts && opts.whitelist) || "", user_defined_dpi: "150"
      }).catch(function () {});
      var png = await sharp(Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length),
        { raw: { width: raster.width, height: raster.height, channels: 4 } }).png().toBuffer();
      var res = await w.recognize(png);
      return { text: (res.data && res.data.text) || "", conf: ((res.data && res.data.confidence) || 40) / 100 };
    });
    return q;
  }
  (async function () {
    var all = listStems().filter(function (_, i) { return i % sn === si; });
    var fd = fs.openSync(OUT + "." + si, "w");
    for (var i = 0; i < all.length; i++) {
      var stem = all[i].stem;
      try {
        var truthRaw = JSON.parse(fs.readFileSync(path.join(DIR, stem + ".json"), "utf8"));
        var skip = {}; ((truthRaw._mask && truthRaw._mask.skip) || []).forEach(function (f) { skip[f] = true; });
        var snapT = engineApi.constraintSnap(truthRaw);
        var dec = await sharp(path.join(DIR, all[i].img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        var raster = { width: dec.info.width, height: dec.info.height,
          data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length) };
        var raw = await structural.parseStructural(raster, nodeOcr);
        var snapped = engineApi.constraintSnap(raw);
        var te = raw._debug && raw._debug.tileEvid;
        var rec = {
          name: stem, holdout: djb2(stem) % 5 === 0,
          skipOutcomes: !!skip.outcomes,
          truthCfg: snapT.config, truthState: truthRaw.state || {},
          truthKeys: (truthRaw.outcomes || []).map(outKey),
          cfg: snapped.config,
          cfgConf: (function () { var o = {}; Object.keys(snapped.confidence.config || {}).forEach(function (k) { o[k] = Math.round((snapped.confidence.config[k] || 0) * 1000) / 1000; }); return o; })(),
          state: { currentTurn: snapped.state && snapped.state.currentTurn, maxTurns: snapped.state && snapped.state.maxTurns,
                   rerollsRemaining: snapped.state && snapped.state.rerollsRemaining, processCostMultiplier: snapped.state && snapped.state.processCostMultiplier },
          stateConf: (function () { var o = {}; Object.keys((snapped.confidence.state) || {}).forEach(function (k) { o[k] = Math.round((snapped.confidence.state[k] || 0) * 1000) / 1000; }); return o; })(),
          gotKeys: (snapped.outcomes || []).map(outKey),
          gotConf: (snapped.confidence.outcomes || []).map(function (c) { return c == null ? 1 : Math.round(c * 1000) / 1000; }),
          tiles: te || null
        };
        fs.writeSync(fd, JSON.stringify(rec) + "\n");
      } catch (err) { process.stderr.write("FAIL " + stem + ": " + (err && err.message) + "\n"); }
      if ((i + 1) % 10 === 0) process.stderr.write("[" + si + "] " + (i + 1) + "/" + all.length + "\n");
    }
    fs.closeSync(fd);
    try { var w2 = await getWorker(); await w2.terminate(); } catch (e2) {}
  })().catch(function (e) { console.error(e); process.exit(1); });
} else {
  var stems = listStems();
  console.log("corpus " + stems.length + " boards, " + JOBS + " jobs");
  var t0 = Date.now(), done = 0;
  for (var i = 0; i < JOBS; i++) {
    (function (si) {
      var c = cp.spawn(process.execPath, [__filename, "--shard=" + si + "/" + JOBS, "--out=" + OUT, "--dir=" + DIR],
        { stdio: ["ignore", "inherit", "pipe"] , env: process.env });
      var last = "";
      c.stderr.on("data", function (d) { last = String(d).trim().split("\n").pop(); });
      c.on("exit", function (code) {
        console.log("shard " + si + " exit " + code + " (" + last + ")");
        if (++done === JOBS) {
          var outFd = fs.openSync(OUT, "w"), n = 0;
          for (var j = 0; j < JOBS; j++) {
            var f = OUT + "." + j;
            if (!fs.existsSync(f)) continue;
            var txt = fs.readFileSync(f, "utf8");
            n += txt.split("\n").filter(Boolean).length;
            fs.writeSync(outFd, txt);
            fs.unlinkSync(f);
          }
          fs.closeSync(outFd);
          console.log("wrote " + OUT + " — " + n + " records in " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
        }
      });
    })(i);
  }
}
