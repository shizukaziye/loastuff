/**
 * class-icon.js — which of the 29 class glyphs in /shared/class-icons/ belongs to a class.
 *
 *   window.classIconFile(className) -> "Guardianknight" (the file's base name) or null
 *   window.classIconUrl(className)   -> "/shared/class-icons/Guardianknight.svg" or null
 *
 * Matching ignores case, spaces and punctuation, so "Guardian Knight", "guardianknight"
 * and "Guardian-Knight" all find Guardianknight.svg. A class with no file gets null, never
 * a wrong icon or a broken image: the list is spelled out because we know exactly which 29
 * exist. The SVGs use fill="currentColor"; tint them with CSS.
 *
 * The folder and this file are shared by the astrogem and bracelet tools (until 2026-09-25
 * each carried its own copy of the icons). _redirects still serves the icons at the two
 * old addresses, loa-astrogem-calc/assets/class-icons/ and loa-bracelet-calc/assets/class-icons/,
 * for code that has not moved yet (bracelet app.js and bible-import.js, profile/profile.js).
 */
(function (root) {
  "use strict";
  var DIR = "/shared/class-icons/";
  var NAMES = ("Aeromancer Arcanist Artillerist Artist Bard Berserker Breaker Deadeye Deathblade " +
    "Destroyer Glaivier Guardianknight Gunlancer Gunslinger Machinist Paladin Reaper Scrapper " +
    "Shadowhunter Sharpshooter Slayer Sorceress Souleater Soulfist Striker Summoner Valkyrie " +
    "Wardancer Wildsoul").split(" ");
  var BY_KEY = {};
  for (var i = 0; i < NAMES.length; i++) BY_KEY[NAMES[i].toLowerCase()] = NAMES[i];

  function classIconFile(className) {
    if (!className) return null;
    return BY_KEY[String(className).replace(/[^A-Za-z]/g, "").toLowerCase()] || null;
  }
  function classIconUrl(className) {
    var f = classIconFile(className);
    return f ? DIR + f + ".svg" : null;
  }

  root.classIconFile = classIconFile;
  root.classIconUrl = classIconUrl;
})(typeof window !== "undefined" ? window : this);
