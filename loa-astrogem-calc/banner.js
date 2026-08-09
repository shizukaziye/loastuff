/* banner.js — temporary site-wide notice for the 2026-08-09 grading reweight.
 * Injected above the tab panes so every tab (Grader, Pipeline, Advisor,
 * Leaderboard) shows it. Dismiss sticks per browser via localStorage.
 * Remove this file (and its index.html tag) once the notice has run its course. */
(function () {
  "use strict";
  var KEY = "astrogem-banner-reweight-2026-08-09";
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}

  function inject() {
    var tabs = document.querySelector(".tabbar") || document.querySelector(".tabs");
    if (!tabs || document.getElementById("astro-banner")) return;
    var el = document.createElement("div");
    el.id = "astro-banner";
    el.innerHTML =
      '<style>' +
      '#astro-banner{margin:10px 0;padding:9px 30px 9px 14px;border:1px solid #7e5cc0;border-radius:10px;' +
      'background:linear-gradient(90deg,rgba(126,92,192,.16),rgba(59,127,208,.12));font-size:13px;line-height:1.5;position:relative}' +
      '#astro-banner b{color:var(--text,#fff)}' +
      '#astro-banner .ab-x{position:absolute;top:6px;right:10px;cursor:pointer;border:0;background:none;' +
      'color:inherit;font-size:15px;opacity:.7}#astro-banner .ab-x:hover{opacity:1}' +
      '#astro-banner details{display:inline}' +
      '#astro-banner summary{display:inline;cursor:pointer;color:#a98ae0;text-decoration:underline;font-size:12px}' +
      '#astro-banner .ab-body{margin-top:6px;opacity:.9}' +
      '</style>' +
      '<button class="ab-x" title="Dismiss" aria-label="Dismiss">&times;</button>' +
      '<b>Gem grading was reweighted on Aug 9</b> &mdash; grades and letter cuts have changed. ' +
      '<details><summary>What changed?</summary><div class="ab-body">' +
      'Willpower cost is now priced by per-cost curves fitted on simulated accounts packed into optimal grids ' +
      '(45,000+ DPS and 30,000 support accounts, iterated to a stable equilibrium): costs 3&ndash;6 are all ' +
      'viable, 7 is taxed, 8 heavy, 9 worthless. Order value is roughly unchanged for DPS and higher for ' +
      'supports. Perfect gems no longer tie at 100 &mdash; the perfect Ark Grid layout <i>averages</i> 100, so ' +
      'perfect 8/9/10-costs grade 95.3 / 98.5 / 103.1 (support: 96.9 / 101.0 / 101.1), and every perfect gem ' +
      'keeps the rainbow badge. Letter cuts are the familiar 5-point steps with S+ at 95.3, so all perfects ' +
      'stay S+. Support gems now use their own fitted curve (steeper than the DPS one) from a dedicated ' +
      'support study. Baselines, EV tables and the leaderboard are re-baked, so numbers have shifted.' +
      '</div></details>';
    tabs.parentNode.insertBefore(el, tabs.nextSibling);
    el.querySelector(".ab-x").addEventListener("click", function () {
      try { localStorage.setItem(KEY, "1"); } catch (e) {}
      el.remove();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
