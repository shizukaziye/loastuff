/**
 * banner.js — the temporary "scoring reweighted" notice (2026-08), shown above
 * the tab panes on every tab until dismissed (localStorage). Remove this file
 * and its index.html tag when the notice has run its course.
 */
(function () {
  "use strict";
  var KEY = "astrogem_wp_reweight_2026_08_dismissed";
  try { if (localStorage.getItem(KEY) === "1") return; } catch (e) {}

  var wrap = document.querySelector(".wrap");
  var tabbar = document.getElementById("tabbar");
  if (!wrap || !tabbar) return;

  var el = document.createElement("div");
  el.id = "wp-reweight-banner";
  el.innerHTML =
    '<style>' +
    '#wp-reweight-banner{margin:10px 0 14px;padding:12px 16px;border:1px solid #7e5cc0;border-radius:10px;' +
    'background:linear-gradient(180deg,rgba(126,92,192,.14),rgba(126,92,192,.05));font-size:13.5px;line-height:1.55;position:relative}' +
    '#wp-reweight-banner h3{margin:0 0 6px;font-size:14px;color:#c9a2ff}' +
    '#wp-reweight-banner p{margin:0 0 8px}' +
    '#wp-reweight-banner p:last-of-type{margin-bottom:0}' +
    '#wp-reweight-banner .wprw-x{position:absolute;top:8px;right:10px;background:none;border:none;color:inherit;' +
    'opacity:.65;font-size:16px;cursor:pointer;padding:4px}' +
    '#wp-reweight-banner .wprw-x:hover{opacity:1}' +
    '#wp-reweight-banner details{margin-top:6px}' +
    '#wp-reweight-banner summary{cursor:pointer;opacity:.85}' +
    '#wp-reweight-banner a{color:#c9a2ff}' +
    '</style>' +
    '<button class="wprw-x" title="Dismiss" aria-label="Dismiss">&#10005;</button>' +
    '<h3>Why grades changed (Aug 2026)</h3>' +
    '<p>When I built the original grading system, I made every perfect astrogem score a perfect 100. ' +
    'That kept the scale pretty, but it broke the math underneath: a perfect 10-cost is simply worth much ' +
    'more than a perfect 8-cost, and a scale that denies that gives worse advice. I&rsquo;ve reweighted grading ' +
    'to track what a packed Ark Grid actually uses &mdash; willpower and order points now count for less, ' +
    'damage lines for more.</p>' +
    '<details><summary>What exactly changed</summary>' +
    '<p style="margin-top:8px">The new scale stays as close to the old one as I could make it. 100.0 is the ' +
    'average gem of a perfect Ark Grid (3 perfect 8-costs, 3 perfect 9-costs, 6 perfect 10-costs &mdash; exactly ' +
    'what the willpower budget allows). Only 10-costs can score above 100 now: a perfect 10-cost reads 106.0, ' +
    'a perfect 9-cost 97.7, a perfect 8-cost 90.2. Every perfect astrogem keeps the rainbow badge, and the ' +
    'letter ranks moved down 5 points (S-tier now starts at 75, with S at 82.5 and S+ at 90), so a perfect ' +
    '8-cost is still S+. Baselines and advice shift with the new grades; raw damage numbers do not.</p>' +
    '</details>';

  tabbar.parentNode.insertBefore(el, tabbar.nextSibling);
  el.querySelector(".wprw-x").addEventListener("click", function () {
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
    el.remove();
  });
})();
