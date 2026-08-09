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
      '#astro-banner{margin:10px 0;padding:10px 14px;border:1px solid #7e5cc0;border-radius:10px;' +
      'background:linear-gradient(90deg,rgba(126,92,192,.16),rgba(59,127,208,.12));font-size:13px;line-height:1.5;position:relative}' +
      '#astro-banner b{color:var(--text,#fff)}' +
      '#astro-banner .ab-x{position:absolute;top:6px;right:10px;cursor:pointer;border:0;background:none;' +
      'color:inherit;font-size:15px;opacity:.7}#astro-banner .ab-x:hover{opacity:1}' +
      '</style>' +
      '<button class="ab-x" title="Dismiss" aria-label="Dismiss">&times;</button>' +
      '<b>Grading reweighted (Aug 9).</b> Willpower cost now carries a per-cost percentage toll fitted on ' +
      '15,000 simulated accounts packed into optimal grids (costs 3&ndash;6 all viable, 7 taxed, 8 heavy, 9 worthless); ' +
      'order value is unchanged. Perfect gems no longer tie at 100: the perfect Ark Grid layout <i>averages</i> 100, ' +
      'so a perfect 8/9/10-cost grades 93 / 97.8 / 104.6, and every perfect gem keeps the rainbow badge. Letter cuts ' +
      'are the familiar 5-point steps with S+ at 93, so all perfects stay S+ (still the top ~0.3% of gems). ' +
      'Support gems currently use the same toll curve carried over from the DPS fit (a support-native study is ' +
      'in progress and will replace it). ' +
      'Baselines, EV tables and the leaderboard are re-baked on the new scale, so numbers have shifted from last week.';
    tabs.parentNode.insertBefore(el, tabs.nextSibling);
    el.querySelector(".ab-x").addEventListener("click", function () {
      try { localStorage.setItem(KEY, "1"); } catch (e) {}
      el.remove();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
