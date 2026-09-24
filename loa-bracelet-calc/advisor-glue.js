/**
 * advisor-glue.js — joins the screenshot reader to the tab that hosts it.
 *
 * The two halves were built to different seams and neither is wrong:
 *
 *   the host tab       waits to be told about a reader —
 *                      BraceletAdvisor.registerCapture({onFiles, onPaste, readScreen})
 *                      and takes a bracelet through applyParsed(patch, conf).
 *   advisor-capture.js is a self-contained controller —
 *                      BraceletCapture.mount(hostEl, {onParsed, onStatus}).
 *
 * Rather than rewrite either, this adapts one to the other. It is the whole
 * integration: no parsing, no UI, no state.
 *
 * THE HOST IS THE CALCULATOR NOW (2026-09-24). The Advisor stopped loading
 * bracelets, and with it went the seam and the zone this used to mount into;
 * app.js holds both now — window.BraceletAdvisor, and #bc-intake under the
 * import panel. The Advisor's old ids are still looked for, last, so a page
 * that has them keeps working.
 *
 * IT JOINS WHEN THE HOST ASKS. app.js puts the seam on window only when someone
 * reaches for the reader (a pointer over its panel, a file, its button),
 * because mounting starts the OCR worker and that fetches Tesseract. Until
 * then join() finds no seam and does nothing; that is the design, not a fault.
 * app.js calls join() itself the moment the seam is up.
 *
 * LOADED TWICE, JOINED ONCE. index.html's Advisor tab may still list this file,
 * and the Calculator loads it on first use, so it can run twice in one page. A
 * second copy that finds the first one joined stands down rather than mounting
 * a second reader into the same box.
 */
(function () {
  "use strict";

  var prior = window.BraceletAdvisorGlue;
  if (prior && typeof prior.joined === "function" && prior.joined()) return;

  var joined = false;

  function hostEl() {
    return document.getElementById("bc-intake") ||
      document.getElementById("av-readbtns") || document.getElementById("av-drop");
  }

  function join() {
    if (joined) return true;
    var A = window.BraceletAdvisor, C = window.BraceletCapture;
    if (!A || !C || typeof A.registerCapture !== "function" || typeof C.mount !== "function") return false;

    // The reader wants a box of its own and draws everything inside it — its
    // tip, its drop zone, the share buttons and its status line. The host must
    // not redraw that box afterwards: the share flow starts on the reader's own
    // "Share game screen" press, and a box drawn over lost that button.
    var host = hostEl();
    if (!host) return false;

    var ctl = C.mount(host, {
      threshold: 0.8,
      version: "1",
      onStatus: function (text, kind) { A.setStatus(text, kind); },
      onParsed: function (result) {
        if (!result || !result.patch) { A.setStatus("Nothing readable in that image.", "err"); return; }
        var out = A.applyParsed(result.patch, result.confidence || {});
        if (out && out.ok === false) { A.setStatus(out.error || "That parse could not be applied.", "err"); return; }
        var n = out && out.unconfirmed ? out.unconfirmed : 0;
        A.setStatus(n ? ("Read — " + n + " field" + (n === 1 ? "" : "s") + " need a look.") : "Read.", n ? "" : "ok");
      }
    });
    if (!ctl) return false;

    A.registerCapture({
      onFiles: function (files) { return ctl.parseImage(files && files[0]); },
      onPaste: function (blob) { return ctl.parseImage(blob); },
      // Omitted when the browser cannot share a screen. It reads one frame of a
      // share already running; starting one is the reader's own button.
      readScreen: (typeof ctl.readScreenNow === "function" && navigator.mediaDevices &&
                   navigator.mediaDevices.getDisplayMedia)
        ? function () { return ctl.readScreenNow(); }
        : null,
      /** The mounted controller itself, for a host that needs more than the three above. */
      controller: ctl
    });

    joined = true;
    return true;
  }

  // The host may not be ready when this runs: try now, when a tab that can host
  // the reader comes on screen, and when the page has finished parsing. Each is
  // one cheap check; nothing polls.
  if (!join()) {
    document.addEventListener("tabselected", function (e) {
      var t = e && e.detail && e.detail.tab;
      if (t === "calculator" || t === "advisor") join();
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", join);
  }

  window.BraceletAdvisorGlue = { join: join, joined: function () { return joined; } };
})();
