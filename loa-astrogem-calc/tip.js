/**
 * tip.js — one instant, styled tooltip for any [data-gloss] element (abbreviations etc.).
 * Replaces the native title= tooltip's hover delay. A single floating #gm-tip node is
 * positioned on hover via delegated events, so it works across tabs and inside scroll
 * containers without being clipped. Distinct from the pipeline's data-tip / .pl-pop popup.
 */
(function () {
  "use strict";
  var tip = null;
  function node() {
    if (!tip) { tip = document.createElement("div"); tip.id = "gm-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    return tip;
  }
  function show(el) {
    var txt = el.getAttribute("data-gloss");
    if (!txt) return;
    var t = node();
    t.textContent = txt;                       // visibility:hidden still lays out, so we can measure
    var r = el.getBoundingClientRect(), tr = t.getBoundingClientRect();
    var top = r.top - tr.height - 8;
    if (top < 4) top = r.bottom + 8;           // flip below if it would clip the top
    var left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
    t.style.top = top + "px";
    t.style.left = left + "px";
    t.classList.add("on");
  }
  function hide() { if (tip) tip.classList.remove("on"); }
  document.addEventListener("mouseover", function (e) { var el = e.target.closest ? e.target.closest("[data-gloss]") : null; if (el) show(el); });
  document.addEventListener("mouseout", function (e) { var el = e.target.closest ? e.target.closest("[data-gloss]") : null; if (el) hide(); });
  document.addEventListener("click", hide, true);
  window.addEventListener("scroll", hide, true);
})();
