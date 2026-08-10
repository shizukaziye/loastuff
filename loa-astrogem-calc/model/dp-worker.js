/**
 * model/dp-worker.js — runs the exact Bellman DP (model/dp.js) off the main thread.
 *
 * Fixes #6: advisor.js used to call window.evaluateActionsDP(...) synchronously on
 * the main thread, inside a bare setTimeout(fn, 30) that only let the "Solving…"
 * status text paint before starting — not real chunking. A big solve (early turns
 * on an Epic gem: many reachable (config, t, r, cm) memo keys, each a
 * without-replacement combinatorial-Bernoulli expectation over the outcome pool)
 * could block input/rendering for its entire duration with no way to interact with
 * the page meanwhile.
 *
 * This worker loads the SAME model files the main thread does (astrogem.js sets
 * self.Astrogem, nested.js sets self.AstrogemNested, dp.js reads both off `self`
 * exactly as it reads them off `window` in the main thread — see dp.js's own
 * root.Astrogem / root.AstrogemNested fallback) and exposes exactly one message:
 *
 *   postMessage({ id, state, baseline, goldPerDamage, numRuns, options })
 *   -> postMessage({ ok: true, result, id }) | { ok: false, error, id }
 *
 * `id` is the caller's request tag, echoed back untouched. ONE worker serves every
 * solve, and requests can overlap (a paste mid-solve auto-runs a second solve), so
 * replies must be routed, not raced: each caller's listener resolves only the reply
 * carrying its own id (see advisor.js evaluateActionsDPAsync). Before the id, two
 * in-flight solves both resolved with whichever reply landed first and the second
 * real reply was dropped.
 *
 * `state`/`baseline`/`options` etc. are plain JSON — no functions, no DOM — so they
 * survive structured clone across the worker boundary untouched. onProgress is NOT
 * passed through: evaluateActionsDP only ever calls it once at the end anyway (see
 * its own comment — "the DP is deterministic", no per-node progress exists yet),
 * so there's nothing worth relaying mid-solve. The caller shows an indeterminate
 * "still solving" state instead of a fake linear progress bar while this is in
 * flight (see advisor.js's av-bar-indeterminate).
 *
 * Deploy note: the ?v= pins below MUST match index.html's for the same files —
 * model/astrogem.js (eager <script>) and model/nested.js / model/dp.js (the
 * advisor's LAZY_TABS) — every time one of those files changes; and advisor.js's
 * own `new Worker("model/dp-worker.js?v=N")` pin must bump every time THIS file
 * changes (advisor.js pins this worker itself at dp-worker.js?v=13).
 * As of 2026-08-10 the set is: astrogem.js?v=62, nested.js?v=54,
 * dp.js?v=59, and this file at dp-worker.js?v=13. Same convention index.html
 * already documents; a worker with a stale cached copy of the model would
 * silently diverge from the main thread's freshly-versioned one. Since
 * 2026-08-10 that divergence also fails LOUDLY at runtime: the main thread
 * sends its MODEL_SIG with every request and this worker refuses on mismatch
 * (the guard below) — the version bumps remain the first line of defense.
 */
importScripts("astrogem.js?v=62", "nested.js?v=54", "dp.js?v=59");

self.onmessage = function (e) {
  var m = e.data || {};
  try {
    // MODEL-SKEW GUARD (2026-08-10): the main thread sends its model signature;
    // if this worker's model disagrees (stale cache, edge poisoning, deploy
    // race), refuse to answer rather than compute with different physics.
    var mySig = (typeof Astrogem !== "undefined" && Astrogem.MODEL_SIG) || null;
    if (m.expectSig && mySig && m.expectSig !== mySig) {
      self.postMessage({ ok: false, error: "model-skew", workerSig: mySig, expectSig: m.expectSig, id: m.id });
      return;
    }
    var result = evaluateActionsDP(m.state, m.baseline, m.goldPerDamage, m.numRuns, null, m.options);
    self.postMessage({ ok: true, result: result, id: m.id });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err), id: m.id });
  }
};
