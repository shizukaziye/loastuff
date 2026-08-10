/* banner.js — temporary site-wide notice for the 2026-08-09 roster-bound regrade.
 * Injected above the tab panes so every tab (Grader, Pipeline, Advisor,
 * Leaderboard) shows it. Dismiss sticks per browser via localStorage.
 * Remove this file (and its index.html tag) once the notice has run its course. */
(function () {
  "use strict";
  var KEY = "astrogem-banner-ksteep-2026-08-09";
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
      '<b>Grading was refit on Aug 9 for roster-bound gems</b> &mdash; grades and letter cuts have changed. ' +
      '<details><summary>What changed?</summary><div class="ab-body">' +
      'Astrogems are roster-bound, so the model now assumes you keep and fuse everything instead of selling. ' +
      'We simulated 174,000 accounts (~21M gems) cutting, equipping, and fusing spares the way the game ' +
      'actually plays &mdash; 112k DPS accounts and 62k joint Order+Chaos support accounts &mdash; then fit ' +
      'grades to match which gems win a grid slot. On both axes, willpower cost is now a flat credit or tax ' +
      'per cost: 3 and 4 get a bonus, 5 is neutral, 6&ndash;9 are taxed harder and harder. On both axes this ' +
      'scheme called the correct winner in every head-to-head ladder test we ran. DPS Order/Chaos is priced ' +
      'at its exact in-game damage (never fitted) and centered at level 4 &mdash; order 4 adds nothing, 5 adds, ' +
      '1&ndash;3 subtract. Perfect DPS 8/9/10-costs grade 96.7 / 100.1 / 101.6; perfect support gems grade ' +
      '96.3 / 98.8 / 102.5 on their own fitted scale (support order weight comes from its own study). One ' +
      'ladder serves both axes: <b>S+ at 95</b>, then ' +
      'the familiar 5-point steps (90, 85, 80, &hellip;) &mdash; every perfect gem on either axis is S+. ' +
      'Baselines, EV tables and the leaderboard are re-baked, so numbers have shifted.' +
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
