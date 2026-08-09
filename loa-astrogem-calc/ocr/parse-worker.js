/**
 * ocr/parse-worker.js — the structural parse, OFF the main thread.
 *
 * The parse is seconds of tight pixel loops + OCR; on the main thread it froze
 * the whole site (Shizu 2026-07-19: "I don't want the whole website to freeze").
 * This classic Web Worker loads the same engine stack and runs parseStructural +
 * constraintSnap here, with its own Tesseract instance fed ImageData (no DOM).
 *
 * Protocol (structural-engine.js is the only client):
 *   -> { type:"init", urls:[...] }         importScripts the engine stack; the
 *                                          client sends its own cache-busted URLs
 *                                          so worker and page never version-skew
 *   <- { type:"ready" } | { type:"init-error", error }
 *   -> { type:"parse", id, width, height, buf }   buf: transferred RGBA buffer
 *   <- { type:"result", id, result } | { type:"result", id, error }
 *
 * Any failure here disables the offload client-side and the parse falls back to
 * the inline path — behavior-identical, just blocking.
 */
"use strict";

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.type === "init") {
    try {
      importScripts.apply(null, msg.urls);
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "init-error", error: String(e && e.message || e) });
    }
    return;
  }
  // keepwarm (2026-08-09): a live screen share means the user is MID-SESSION and
  // the next Read screen now is imminent — the idle teardown below exists for
  // after sessions, not during them. A >5min gap inside a session (gem banking,
  // a boss pull) used to cost the next press the ~2s re-warm. While on, teardown
  // is skipped and the pool re-boots immediately (so a share started after a
  // teardown pays the warm-up during the picker click, not on the first press).
  if (msg.type === "keepwarm") {
    _keepWarm = !!msg.on;
    _lastUse = Date.now();
    if (_keepWarm) _pool.forEach(function (slot) { slotWorker(slot); });
    return;
  }
  if (msg.type === "parse") {
    var raster = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.buf) };
    parseJob(msg.id, raster);
  }
};

// Worker-side Tesseract POOL (2 instances): the engine's reads dominated wall
// time and were serialized on one instance. Two instances let independent reads
// (the engine issues level nodes and outcome cells concurrently) overlap, and
// each instance CACHES its last parameters — identical-param calls skip the
// setParameters round-trip entirely. Same self-healing rules as the main
// thread's browserOcr; recognize() gets ImageData directly (no canvas here).
var POOL_N = 2;
var _pool = [];   // [{p: workerPromise|null, q: tailPromise, params: lastParamsKey, busy: int}]
for (var pi = 0; pi < POOL_N; pi++) _pool.push({ p: null, q: Promise.resolve(), params: "", busy: 0 });

// CONTAINMENT (2026-08-09): Tesseract leaks recognize() failures as floating-
// promise uncaught errors in this worker. Unhandled, they bubble to the page's
// Worker.onerror, which reads "the offload is broken", disables it for the
// session, and pins every later parse to the MAIN THREAD — the exact freeze
// this worker exists to prevent. Every real failure is already handled per
// call (the self-healing pool below); the noise must die here. Real init
// failures still surface through the init-error message, not onerror.
self.addEventListener("error", function (e) { e.preventDefault(); });
self.addEventListener("unhandledrejection", function (e) { e.preventDefault(); });

// INPUT ENCODING (2026-08-09, the "why is Read screen now suddenly slow" bug):
// a Chrome update broke Tesseract 5's ImageData input path inside workers —
// EVERY recognize(ImageData) rejects "Error attempting to read image" (repro:
// plain 400x100 white ImageData fails on tesseract 5.0.5 AND 5.1.1, while the
// same pixels as PNG bytes read fine). Each rejection also killed that pool
// instance, so parses paid a fresh ~1-2s createWorker per OCR call, read the
// whole board on templates/synthesis alone, and the leaked error then disabled
// the offload (see above) — compounding into 10-25s main-thread parses.
// Encoding each micro-crop to PNG bytes (~1-3ms on an OffscreenCanvas, which
// is exactly what the Node eval harness feeds Tesseract) restores the input
// path Tesseract decodes everywhere.
function rasterPng(raster) {
  var idata = new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height);
  if (typeof OffscreenCanvas === "undefined") return Promise.resolve(idata);   // old-browser fallback: previous behavior
  var oc = new OffscreenCanvas(raster.width, raster.height);
  oc.getContext("2d").putImageData(idata, 0, 0);
  return oc.convertToBlob({ type: "image/png" }).then(function (b) { return b.arrayBuffer(); })
    .then(function (ab) { return new Uint8Array(ab); });
}

// IDLE TEARDOWN: two live Tesseract instances hold ~160MB of wasm heap — real
// money on a gaming machine. After 5 minutes without a parse the instances are
// terminated and rebuilt lazily on the next call (a ~2s re-warm, paid only by
// the first parse after a long break).
var IDLE_MS = 5 * 60 * 1000;
var _lastUse = Date.now();
var _keepWarm = false;   // held true while a screen share is live (keepwarm msg)
setInterval(function () {
  if (_keepWarm) return;
  if (Date.now() - _lastUse < IDLE_MS) return;
  _pool.forEach(function (slot) {
    if (slot.p && !slot.busy) {
      slot.p.then(function (w) { try { w.terminate(); } catch (e) {} }).catch(function () {});
      slot.p = null; slot.params = "";
    }
  });
}, 60 * 1000);
function slotWorker(slot) {
  if (!slot.p) {
    slot.p = self.Tesseract.createWorker("eng", 1, { logger: function () {} });
    slot.p.catch(function () { slot.p = null; slot.params = ""; });
  }
  return slot.p;
}
function wOcr(raster, opts) {
  _lastUse = Date.now();
  var psm = String((opts && opts.psm) || 6);
  var wl = (opts && opts.whitelist) || "";
  var key = psm + "|" + wl;
  // prefer an idle slot already configured with these params, then any idle
  // slot, then the least-busy — parameter affinity minimizes setParameters swaps
  var slot = null, si;
  for (si = 0; si < _pool.length; si++) if (!_pool[si].busy && _pool[si].params === key) { slot = _pool[si]; break; }
  if (!slot) for (si = 0; si < _pool.length; si++) if (!_pool[si].busy) { slot = _pool[si]; break; }
  if (!slot) { slot = _pool[0]; for (si = 1; si < _pool.length; si++) if (_pool[si].busy < slot.busy) slot = _pool[si]; }
  slot.busy++;
  var call = slot.q.catch(function () {}).then(function () {
    return slotWorker(slot).then(function (w) {
      var setP = slot.params === key ? Promise.resolve() : w.setParameters({
        tessedit_pageseg_mode: psm, user_defined_dpi: "150", tessedit_char_whitelist: wl
      }).then(function () { slot.params = key; }).catch(function () { slot.params = ""; });
      return setP.then(function () {
        return rasterPng(raster);
      }).then(function (png) {
        return w.recognize(png);
      }).then(function (res) {
        return { text: (res && res.data && res.data.text) || "", conf: ((res && res.data && res.data.confidence) || 40) / 100 };
      });
    }).catch(function () {
      slot.p = null; slot.params = "";   // dead instance — retry fresh next call
      return { text: "", conf: 0, failed: true };
    });
  }).then(function (r) { slot.busy--; return r; }, function (e) { slot.busy--; throw e; });
  slot.q = call;
  return call;
}

function parseJob(id, raster) {
  Promise.resolve().then(function () {
    return self.OcrStructuralEngine.parseStructural(raster, wOcr);
  }).then(function (raw) {
    var snapped = self.OcrEngineAPI.constraintSnap(raw);
    snapped.confidence = raw.confidence ? snapped.confidence : undefined;
    if (raw.ocrDegraded) snapped.ocrDegraded = true;
    if (raw._srcPanel) snapped._srcPanel = raw._srcPanel;
    self.postMessage({ type: "result", id: id, result: snapped });
  }).catch(function (e) {
    self.postMessage({ type: "result", id: id, error: String(e && e.message || e) });
  });
}
