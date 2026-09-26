/**
 * tip.js — one instant, styled tooltip for any [data-gloss] element (abbreviations etc.).
 * Replaces the native title= tooltip's hover delay. A single floating #gm-tip node is
 * positioned on hover via delegated events, so it works across tabs and inside scroll
 * containers without being clipped. Touch screens have no hover, so a TAP toggles the
 * same tooltip (tapping elsewhere hides) — deliberately no title= fallback, which would
 * double-tooltip on desktop. Distinct from the pipeline's data-tip / .pl-pop popup.
 *
 * KEYBOARD (v2, 2026-09-25). A [data-gloss] element that cannot take focus gets
 * tabindex="0" (also when a page renders it later), unless it sits inside a link, button
 * or summary, which would nest one tab stop in another. Focus shows the tip; blur or
 * Escape hides it. The tip has role="tooltip", and the element it is showing for points at
 * it through aria-describedby while it shows — one tip node serves every element, so a
 * standing reference would read out the wrong text.
 *
 * One copy for the site, in /shared/ (the astrogem and bracelet tools each carried one
 * until 2026-09-25). Load it as /shared/tip.js?v=N and bump every loader's pin together.
 * _redirects still serves it at /loa-bracelet-calc/tip.js for the profile page, which
 * loads it there; drop that rule once profile/index.html points here.
 */
(function () {
  "use strict";
  var TIP_ID = "gm-tip";
  var tip = null, cur = null;   // cur = the element the tooltip is currently shown for
  var lastTouch = 0;            // a tap also fires synthetic mouseover/mouseout/click — suppress them
  function node() {
    if (!tip) { tip = document.createElement("div"); tip.id = TIP_ID; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    return tip;
  }
  // Add (on) or drop the tip's id from el's aria-describedby, keeping any other ids.
  function describe(el, on) {
    var ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (x) { return x && x !== TIP_ID; });
    if (on) ids.push(TIP_ID);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  }
  function show(el) {
    var txt = el.getAttribute("data-gloss");
    if (!txt) return;
    if (cur && cur !== el) describe(cur, false);
    var t = node();
    t.textContent = txt;                       // visibility:hidden still lays out, so we can measure
    t.style.left = "0px";                      // reset BEFORE measuring — parked at the previous spot,
    t.style.top = "0px";                       // the viewport edge would clamp the shrink-to-fit width
    var r = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
    var top = r.top - tr.height - 8;
    if (top < 4) top = r.bottom + 8;           // flip below if it would clip the top
    var left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
    t.style.top = top + "px";
    t.style.left = left + "px";
    t.classList.add("on");
    cur = el;
    describe(el, true);
  }
  function hide() {
    if (tip) tip.classList.remove("on");
    if (cur) describe(cur, false);
    cur = null;
  }
  function glossed(target) { return target && target.closest ? target.closest("[data-gloss]") : null; }
  function touched() { return Date.now() - lastTouch < 700; }
  document.addEventListener("mouseover", function (e) { if (touched()) return; var el = glossed(e.target); if (el) show(el); });
  document.addEventListener("mouseout", function (e) { if (touched()) return; var el = glossed(e.target); if (el) hide(); });
  // Touch: tap a [data-gloss] to show its tooltip, tap it again — or anywhere else — to
  // hide. lastTouch keeps the tap's synthetic mouse/click events from undoing the toggle.
  document.addEventListener("touchend", function (e) {
    lastTouch = Date.now();
    var el = glossed(e.target);
    if (el && el !== cur) show(el); else hide();
  });
  document.addEventListener("click", function () { if (!touched()) hide(); }, true);
  // Scrolling moves the element away from the tip: hide it, unless the element has keyboard
  // focus (tabbing to it can scroll it into view), in which case the tip follows it.
  window.addEventListener("scroll", function () {
    if (cur && cur === document.activeElement) show(cur); else hide();
  }, true);

  // ---- keyboard ----
  document.addEventListener("focusin", function (e) { var el = glossed(e.target); if (el) show(el); });
  document.addEventListener("focusout", function (e) { var el = glossed(e.target); if (el && el === cur) hide(); });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "Esc") && cur) hide();
  });

  // Natively focusable elements keep their own tab order; everything else joins it.
  function focusable(el) {
    var t = el.tagName;
    if (t === "A" || t === "AREA") return el.hasAttribute("href");
    return /^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/.test(t) || el.isContentEditable;
  }
  function arm() {
    var list = document.querySelectorAll("[data-gloss]:not([tabindex])");
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (focusable(el)) continue;
      if (el.parentElement && el.parentElement.closest("a[href],button,summary")) continue;
      el.setAttribute("tabindex", "0");
    }
  }
  // Pages render most glossed elements after load (tabs, tables, results), so re-arm after
  // DOM changes, batched.
  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; arm(); }, 60);   // not rAF: it never fires in a background tab
  }
  function start() {
    try {
      arm();
      if (window.MutationObserver) {
        new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gloss"] });
      }
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
