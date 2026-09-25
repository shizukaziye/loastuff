/**
 * lookup.js — where one character stands on every GPD ladder.
 *
 * The GPD chart's character lookup, on its own. It takes a lostark.bible pull
 * (the bracelet-bible /character answer, plus the astrogem-bible answer when
 * there is one), an axis and the plan's switches, and returns each system's
 * current rung, the next rung, the gold per 1% of that step, and the cheapest
 * of them. The chart builds every row and every placement through this file,
 * so a page that calls it gets the chart's own numbers:
 *
 *   <script src="/loa-gpd/lookup.js?v=4"></script>
 *   GpdLookup.ready().then(function (status) {
 *     var p = GpdLookup.place({ record: braceletAnswer, astro: astrogemAnswer });
 *     // p.cheapest, p.list, p.labels ...
 *   });
 *
 * ready() fetches everything place() needs and nothing else: the four model
 * files and the baked tables beside this file (/loa-gpd/model, /loa-gpd/data,
 * with the pins the chart uses), the astrogem model and the bracelet
 * calculator's scorer, and the baked market prices (prices.js) when the page
 * has not loaded them. A host page loads nothing first.
 *
 * Every function below takes the state it reads. A "context" is an object
 * shaped like the chart's own state (the chart passes that object itself):
 *
 *   axis        "support" | "dps"
 *   accFilter   { flat: [...], stat: [...], sidegrades: bool }   the switches above the plan
 *   prices      { materialId: gold per ONE unit }  the material panel
 *   enabled     { materialId: bool, shards: bool } unticked = already bound
 *   gem8Price   the level-8 gem's auction price
 *   honing, karma, rows, dpsDamage, arkgridRows, arkgridRowsDps,
 *   accLattice, accGold                        the baked tables (absorb, loadLattice)
 *   accIndex, accFam, accGoldIndex             caches this file keeps on it
 *
 * Nothing here reads the host page's state. The globals it does read are the
 * model libraries it loads itself (Support, Gear, Honing, Karma, Astrogem,
 * Bracelet, Subrank; use() can hand them in), the clock (place() and
 * positions() also take `now`), and, in the loaders only, document and fetch.
 *
 * Cache law: the zone keeps .js for 4 hours, so any edit here bumps this
 * file's ?v= in loa-gpd/index.html AND in every other page that loads it. The
 * model pins below must match index.html's script tags (tools/verify.js).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GpdLookup = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  // ---- where the files live ----------------------------------------------
  // Beside this file: the chart at /loa-gpd/ and a profile at /NA/Name ask for
  // the same absolute URLs, so they share one cache entry. The version is the
  // ?v= pin this file was loaded with, read off its own tag, never typed twice.
  var SELF = (function () {
    try { var s = root.document && root.document.currentScript; return s && s.src || ""; }
    catch (e) { return ""; }
  })();
  var BASE = SELF ? SELF.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") : "/loa-gpd/";
  var VERSION = (SELF.match(/[?&]v=([^&#]*)/) || [])[1] || null;
  // file -> the global it defines; the pins are index.html's
  var MODELS = [["model/support.js?v=20260922a", "Support"], ["model/gear.js?v=20260922a", "Gear"],
                ["model/honing.js?v=20260922a", "Honing"], ["model/karma.js?v=20260922a", "Karma"]];
  // The astrogem calculator's model, at the pin loa-astrogem-calc/index.html
  // uses: the same URL is one cached copy for the calculator, the chart and this
  // file. It MUST follow the astrogem pin (and the chart's tag in index.html).
  var ASTROGEM_JS = "https://www.loseii.com/loa-astrogem-calc/model/astrogem.js?v=62";
  // the bracelet calculator lives on loseii too; its github.io address is a
  // redirect stub since 2026-09-22 and serves no scripts
  var BC_BASE = "https://www.loseii.com/loa-bracelet-calc/";
  var BC_PIN = "20260922b";
  // Four files in order: the model reads BraceletData and BraceletGearData at
  // load, so a parallel fetch would race. ~53KB gzipped, and only on a lookup.
  var BC_FILES = [["data/bracelet-data.js", "BraceletData"], ["data/gear-data.js", "BraceletGearData"],
                  ["model/bracelet.js", "Bracelet"], ["subrank.js", "Subrank"]];
  // the baked tables the rows are built from, under data/
  var DATA_FILES = ["honing-t4upper.json", "karma.json", "rows.json", "rows-dps.json",
                    "arkgrid-rows-epic.json", "arkgrid-rows-rare.json",
                    "arkgrid-rows-dps-epic.json", "arkgrid-rows-dps-rare.json"];

  var LIBS = {};
  function lib(name) { return LIBS[name] || root[name]; }
  /** Hand the model libraries in where there is no window (node). */
  function use(libs) { for (var k in libs) LIBS[k] = libs[k]; return api; }

  // ---- the systems ---------------------------------------------------------
  var SERIES = {
    armor:    { label: "Honing — armour", color: "#6ad4ff", base: "+11", spend: "last" },
    weapon:   { label: "Honing — weapon", color: "#ffb86b", base: "+11", spend: "last" },
    gems:     { label: "Skill gems",      color: "#f2a2c0", base: "level 7", spend: "last" },
    karma:    { label: "Karma — Enlightenment", color: "#c78cff", base: "lv 21", spend: "last" },
    neck:     { label: "Necklace",        color: "#6ee7a8", base: "growth shop piece" },
    ring:     { label: "Ring",            color: "#4fd1a5", base: "growth shop piece" },
    earring:  { label: "Earring",         color: "#3ab795", base: "growth shop piece" },
    bracelet: { label: "Bracelet",        color: "#ff7f7f", base: "F" },
    // the DPS axis still runs the single baked ark grid row until its own cost
    // runs exist; support splits into the two raw-gem supplies
    arkgrid:  { label: "Ark grid",        color: "#e8b75c", base: "ungraded" },
    arkgridEpic: { label: "Ark grid — cutting epics", color: "#b06fe0", base: "ungraded" },
    arkgridRare: { label: "Ark grid — cutting rares", color: "#4f9be0", base: "ungraded" },
    stone:    { label: "Ability stone",   color: "#97a0b4", base: "7-7" }
  };
  var RARITY_OF = { arkgridEpic: "epic", arkgridRare: "rare" };
  // what a card's "yours" line says for a system the pull could not grade
  var NOT_READ = "not in the lookup data";

  // ---- the material panel's defaults -------------------------------------
  // In the market's own units — the grid shows "/100" where the board sells in
  // hundreds. The live NA East prices in prices.js (window.GPD_PRICES, gold per
  // ONE unit, re-baked every 6 hours by fetch_prices.py) win; MAT_PRICE is the
  // hand-set fallback for a material the feed did not price. Guardian (blue)
  // stones fall back to 300 a hundred, not 30 (Shizu, 2026-08-26). Order is
  // data.materials' order and stays that way.
  var MAT_PRICE = { "6861013": 125, "66102007": 1800, "66102107": 300,
                    "66110226": 25, "66111131": 300, "66111132": 150 };
  // short names, and only the small shard bag stands for all three pouches
  var MAT_NAME = { "66130141": "Shards", "6861013": "Fusions", "66102007": "Red Stones",
                   "66102107": "Blue Stones", "66110226": "Leapstones",
                   "66111131": "Lava's", "66111132": "Glacier's" };
  // the market feed's name for each material prices.js carries
  var MAT_SLUG = { "6861013": "superior-abidos-fusion-material",
                   "66102007": "destiny-crystallized-destruction-stone",
                   "66102107": "destiny-crystallized-guardian-stone",
                   "66110226": "great-destiny-leapstone",
                   "66111131": "lavas-breath", "66111132": "glaciers-breath" };
  // the level-8 gem is an auction-house item, not a market-board one, so no
  // feed prices it: every gem step reprices from this (baked at 420k)
  var GEM8_PRICE = 420000;
  var ACC_FLAT_OPTS = ["no", "low", "mid", "high"];
  var ACC_STAT_OPTS = ["min", "low", "mid", "high", "max"];
  var ACC_FILTER = { flat: ["no"], stat: ["high"], sidegrades: true };

  /** prices.js's answer: { date, region, perUnit: { slug: gold per ONE unit } }
   *  or null when the page has not loaded it (or it failed). */
  function feed() {
    var p = root.GPD_PRICES;
    return p && typeof p === "object" && p.perUnit && typeof p.perUnit === "object" ? p : null;
  }
  /** Where the default prices came from: { date, region } of the live feed,
   *  or null when every default is the hand-set one. */
  function priceInfo() {
    var p = feed();
    if (!p) return null;
    for (var id in MAT_SLUG) if (p.perUnit[MAT_SLUG[id]] > 0) return { date: p.date || null, region: p.region || null };
    return null;
  }
  /** A material's default in market units: the feed's price times the unit,
   *  whole gold (a hundred blue stones at 2.8 each is 280), else MAT_PRICE. */
  function matPrice(m) {
    var p = feed(), v = p && MAT_SLUG[m.id] ? +p.perUnit[MAT_SLUG[m.id]] : NaN;
    if (v > 0 && isFinite(v)) return Math.max(1, Math.round(v * (m.unit || 1)));
    return MAT_PRICE[m.id] || 0;
  }
  /** The materials the panel lists, in data order, with default prices in
   *  market units. A material it does not list is free and unticked. */
  function materials(honing) {
    return (honing && honing.materials || []).filter(function (m) { return MAT_NAME[m.id]; })
      .map(function (m) {
        return { id: m.id, name: MAT_NAME[m.id], fullName: m.name, kind: m.kind, unit: m.unit,
                 price: matPrice(m), on: m.kind !== "shard_pouch" };
      });
  }
  /** The chart's switches and prices before anyone touches them. */
  function defaults(honing) {
    var prices = {}, enabled = {};
    (honing && honing.materials || []).forEach(function (m) { prices[m.id] = 0; enabled[m.id] = false; });
    materials(honing).forEach(function (m) {
      prices[m.id] = m.price / m.unit;
      enabled[m.id] = m.on;
      if (m.kind === "shard_pouch") enabled.shards = false;
    });
    return { accFilter: { flat: ACC_FILTER.flat.slice(), stat: ACC_FILTER.stat.slice(),
                          sidegrades: ACC_FILTER.sidegrades },
             prices: prices, enabled: enabled, gem8Price: GEM8_PRICE };
  }

  // ---- formatting ----------------------------------------------------------
  /** Gold per 1% for a row. A rung the calculator nets to nothing sits under
   *  the market floor: you pay the pheons and the listing floor, not a price
   *  the model can name, so it is never shown as "0". */
  function fmtGpd(g, suffix) {
    if (g === 0) return "pheons only";
    return fmtGold(g) + (suffix || "");
  }
  function fmtGold(g) {
    if (!isFinite(g)) return "—";
    if (g >= 1e9) return (g / 1e9).toFixed(2) + "B";
    if (g >= 1e6) return (g / 1e6).toFixed(2) + "M";
    if (g >= 1e3) return Math.round(g / 1e3) + "k";
    return Math.round(g).toString();
  }
  // A support's buff lands on all three dealers, and the gold axis counts all
  // three: gold per damage stays gold / (per-dealer damage x 3), so the slider
  // means what it has always meant.
  function party(axis) { return axis === "support" ? 3 : 1; }

  // ---- the ark grid tables -------------------------------------------------
  // The ark grid recompute ships tier by tier: a series goes live on its own
  // the moment its rows file carries direct-draw data (draw: "dd"). No flag to
  // flip; the data is the switch.
  function arkSrc(ctx, r) {
    return ctx.axis === "dps" ? (ctx.arkgridRowsDps || {})[r] : ctx.arkgridRows[r];
  }
  function arkLive(ctx, r) {
    var s = arkSrc(ctx, r);
    return !!(s && s.draw === "dd" && s.rows && s.rows.length);
  }

  // ---- accessories: one chain per slot, live from the lattice -----------
  // The accessory calculator's lattice prices every configuration of a slot
  // (primary tiers x flat line x main-stat quintile) by its damage. The chart
  // keeps only the families the switches tick and builds the chain a buyer
  // walks as the budget rises: from the GROWTH SHOP piece everyone starts
  // with (Shizu, 2026-09-22 — the better primary at high plus two low flat
  // lines, at the bottom main-stat quintile; the calculator's own first
  // baseline), each rung is the ticked piece that costs least per 1% FROM
  // THE RUNG BEFORE IT — the lower convex hull of (gold, damage). A piece
  // that is better and cheaper than something on the chain would have been
  // picked first, so no rung is dominated, and each step is dearer per 1%
  // than the last, which is what "taken in order under the slider" needs.
  // The plain cost frontier the old baked rows followed kept cheap-but-tiny
  // steps a buyer never takes, and they stalled the ladder until the slider
  // passed them. A market piece the calculator nets to nothing that still
  // beats the shop piece is the first rung, at the pheons only.
  var ACC_KINDS = ["neck", "earring", "ring"];
  var ACC_SHOP_FLAT = "low", ACC_SHOP_MS = "min";
  /** The growth-shop piece as a point on this slot's lattice. The support
   *  lattice carries one flat (Weapon Power+; Attack Power+ is worth nothing
   *  to a support), so it is a lattice point. The DPS lattice keeps atk and
   *  wpn flats apart, so the two-flat piece is assembled from three points:
   *  each flat's gain over the bare piece, added in log space. */
  function accShopBase(axis, byKey, nprim) {
    var prim = ["high"].concat(new Array(nprim - 1).fill(null));
    var label = "high" + (nprim > 1 ? "/—" : "") + " · low atk & wpn flats · " + ACC_SHOP_MS + " stat";
    var bare = byKey[lkCfgKey(prim, null, ACC_SHOP_MS)];
    if (axis === "support") {
      var p = byKey[lkCfgKey(prim, ACC_SHOP_FLAT, ACC_SHOP_MS)];
      return p ? { prim: prim, flat: ACC_SHOP_FLAT, ms: ACC_SHOP_MS, D: p.D, gold: 0, label: label, shop: true } : null;
    }
    var atk = byKey[lkCfgKey(prim, "atk-" + ACC_SHOP_FLAT, ACC_SHOP_MS)];
    var wpn = byKey[lkCfgKey(prim, "wpn-" + ACC_SHOP_FLAT, ACC_SHOP_MS)];
    if (!bare || !atk || !wpn) return null;
    return { prim: prim, flat: "atk-" + ACC_SHOP_FLAT, ms: ACC_SHOP_MS,
             D: bare.D + (atk.D - bare.D) + (wpn.D - bare.D), gold: 0, label: label, shop: true };
  }
  function accFilterKey(f) {
    return f.flat.join(",") + "/" + f.stat.join(",") + (f.sidegrades === false ? "/strict" : "");
  }
  /** "atk-high" and "wpn-high" are both the high level; null is "no". */
  function accFlatLevel(flat) { return flat ? flat.replace(/^(atk|wpn)-/, "") : "no"; }
  function accAllowed(f, p) {
    return f.flat.indexOf(accFlatLevel(p.flat)) >= 0 && f.stat.indexOf(p.ms) >= 0;
  }
  // NO SIDEGRADES (PrinceOfZamunda, 2026-09-24; Shizu: "I'll add a toggle"):
  // with the switch off, a step must raise a primary line and lower none —
  // nobody sells a mid/high to buy a high/mid, and nobody rebuys a high/mid
  // for its main stat. Once both primaries are high there is no line left to
  // raise, so a better main stat or flat is the step. With it on (the
  // default) any dearer, better piece is a step: sell the old one, buy the
  // next, the gold is the difference.
  var TIER_RANK = { low: 1, mid: 2, high: 3 };
  function tierRank(t) { return t ? TIER_RANK[t] || 0 : 0; }
  function allHigh(p) { return p.prim.every(function (t) { return t === "high"; }); }
  function accStepsUp(from, to) {
    var up = false;
    for (var i = 0; i < to.prim.length; i++) {
      var a = tierRank(from.prim[i]), b = tierRank(to.prim[i]);
      if (b < a) return false;
      if (b > a) up = true;
    }
    return up || (allHigh(from) && allHigh(to));
  }
  function accChain(ctx, axis, kind) {
    var f = ctx.accFilter;
    ctx.accFam = ctx.accFam || {};
    var ck = axis + ":" + kind + ":" + accFilterKey(f);
    if (ctx.accFam[ck]) return ctx.accFam[ck];
    var lat = ctx.accLattice && ctx.accLattice[axis];
    var list = lat && lat[kind], goldIdx = list && lkAccGoldIndex(ctx, axis, kind);
    if (!list || !goldIdx) return null;            // the lattice has not landed; do not cache
    var byKey = {};
    var pts = list.map(function (c) {
      var prim = c.prim || [], flat = c.flat || null;
      var p = { prim: prim, flat: flat, ms: c.ms, D: c.D,
                gold: goldIdx[lkCfgKey(prim, flat, c.ms)] || 0,
                label: lkCfgLabel({ prim: prim, flat: flat, ms: c.ms }) };
      byKey[lkCfgKey(prim, flat, c.ms)] = p;
      return p;
    });
    if (!f.flat.length || !f.stat.length) return (ctx.accFam[ck] = { base: null, rungs: [], off: true });
    var fam = pts.filter(function (p) { return accAllowed(f, p); });
    // the base is the growth-shop piece, whatever the switches say: it is
    // what you wear before the first purchase. A ticked family with nothing
    // better than it has no rungs, which is the honest answer.
    var base = accShopBase(axis, byKey, pts[0].prim.length);
    if (!base) pts.forEach(function (p) { if (!base || p.D < base.D) base = p; });
    var rungs = [], cur = base;
    for (;;) {
      var best = null, bestSlope = Infinity;
      fam.forEach(function (p) {
        // a piece the calculator nets to nothing (gold 0) may still beat the
        // rung before it; it is allowed in at a zero slope
        if (p.D <= cur.D || p.gold < cur.gold) return;
        if (f.sidegrades === false && !accStepsUp(cur, p)) return;
        var slope = (p.gold - cur.gold) / (p.D - cur.D);
        // equal slopes: take the further piece, the nearer one is the same buy
        if (slope < bestSlope - 1e-9 || (Math.abs(slope - bestSlope) <= 1e-9 && p.D > best.D)) {
          best = p; bestSlope = slope;
        }
      });
      if (!best) break;
      rungs.push(best); cur = best;
    }
    return (ctx.accFam[ck] = { base: base, rungs: rungs, off: false });
  }
  function accNoun(kind) { return kind === "neck" ? "necklace" : kind; }
  function accPrimWords(axis, kind, cfg) {
    if (axis === "support" && kind === "earring")
      return cfg.prim[0] ? "a " + cfg.prim[0] + " Weapon Power % line" : "no Weapon Power % line";
    return cfg.prim.map(function (t) { return t || "—"; }).join("/") + " primaries";
  }
  function accFlatWords(axis, flat, long) {
    if (!flat) return long ? "no flat line" : "no flat";
    var lvl = accFlatLevel(flat);
    var stat = flat.indexOf("atk-") === 0 ? "Attack Power+" : "Weapon Power+";
    if (long) return "a " + lvl + " " + stat + " line";
    return (axis === "dps" ? (flat.indexOf("atk-") === 0 ? "atk " : "wpn ") : "") + lvl + " flat";
  }
  /** The chart's accessory rows for this axis, in chain order. */
  function accessoryRows(ctx, axis) {
    var out = [];
    ACC_KINDS.forEach(function (kind) {
      var ch = accChain(ctx, axis, kind);
      if (!ch || !ch.rungs.length) return;
      var prev = ch.base;
      ch.rungs.forEach(function (r) {
        out.push({
          series: kind, label: r.label, to: r.label, from: prev.label,
          gold: Math.round(r.gold - prev.gold), damage: r.D - prev.D, total: Math.round(r.gold),
          buy: (kind === "earring" ? "an " : "a ") + accNoun(kind) + ": " + accPrimWords(axis, kind, r) +
               ", " + accFlatWords(axis, r.flat, true) + ", " + r.ms + " main stat",
          odds: r.gold > 0
            ? "priced by the accessory calculator" + (axis === "dps" ? " on the DPS market" : "") +
              ", which values an accessory strictly by its damage; the rung is the ticked piece that " +
              "costs least per 1% from the rung before it"
            : "the accessory calculator nets this piece to nothing after the pheon tax — it sits under " +
              "the market floor, so it costs the pheons and the listing floor only, and it still beats " +
              (prev.shop ? "the growth shop piece" : "the rung before it"),
          minimum: accPrimWords(axis, kind, r) + ", " + accFlatWords(axis, r.flat, false) + ", " +
                   r.ms + " main stat"
        });
        prev = r;
      });
    });
    return out;
  }

  // ---- the rows --------------------------------------------------------
  /** Every priced step on the context's axis, in the chart's order, each with
   *  its gold per 1% (`gpd`). The chart's ROWS. */
  function steps(ctx) {
    var Support = lib("Support"), Gear = lib("Gear"), Honing = lib("Honing"), Karma = lib("Karma");
    var d = ctx.honing, P = Support.DEFAULTS, out = [];
    var baked = ctx.rows[ctx.axis] || [];
    var dpsDmg = ctx.axis === "dps" ? ctx.dpsDamage : null;
    if (d && ctx.karma) {
      var names = {};
      d.materials.forEach(function (m) { names[m.id] = m.name; });

      ["armor", "weapon"].forEach(function (track) {
        var pieces = track === "armor" ? 5 : 1;
        Honing.ladder(d, track, ctx.prices, ctx.enabled, 11, 25).forEach(function (s) {
          var before = Gear.stats(d, {}, s.from, s.from);
          var after = track === "armor" ? Gear.stats(d, {}, s.to, s.from)
                                        : Gear.stats(d, {}, s.from, s.to);
          var recipe = d[track].recipe[String(s.to)], mats = [];
          for (var id in recipe.mats) {
            if (ctx.enabled[id] === false) continue;
            var n = recipe.mats[id] * s.taps * pieces;
            mats.push([names[id], Math.round(n), n * (ctx.prices[id] || 0)]);
          }
          if (s.juice) {
            var j = s.juice * s.taps * pieces;
            mats.push([names[recipe.juice.id], Math.round(j), j * (ctx.prices[recipe.juice.id] || 0)]);
          }
          mats.push(["honing fee", "", recipe.gold * s.taps * pieces]);
          out.push({
            series: track, label: "+" + s.from + " → +" + s.to,
            from: "+" + s.from, to: "+" + s.to,
            note: (1675 + 5 * s.to) + " ilvl",
            gold: s.gold,
            damage: dpsDmg ? (dpsDmg.honing[track][String(s.to)] || 0)
                           : Support.delta(P, { gear: before }, { gear: after }),
            mats: mats,
            buy: (pieces > 1 ? "all five armour pieces" : "the weapon") + " to +" + s.to,
            odds: "base rate " + s.baseRate.toFixed(2) + "%, plus a tenth of base each failure, free once " +
                  "the rates spent reach 215%. " + s.taps.toFixed(1) + " taps expected" +
                  (pieces > 1 ? " per piece" : "") + ", " +
                  (s.juice ? s.juice + " breaths a tap" : "no breath — it costs more than the taps it saves"),
            minimum: pieces > 1
              ? "all five pieces at +" + s.to + ", " + Math.round(s.gain.base).toLocaleString() + " main stat"
              : "the weapon at +" + s.to + ", " + Math.round(s.gain.base).toLocaleString() + " weapon power"
          });
        });
      });

      Karma.ladder(ctx.karma, Karma.ENLIGHTENMENT, {}, 21, 30).forEach(function (s) {
        var b = Gear.stats(d, { karmaWpPct: (s.total - s.gain) / 100 }, 25, 25);
        var a = Gear.stats(d, { karmaWpPct: s.total / 100 }, 25, 25);
        out.push({
          series: "karma", label: "lv " + s.from + " → " + s.to,
          from: "lv " + s.from, to: "lv " + s.to,
          gold: s.gold,
          damage: dpsDmg ? (dpsDmg.karma[String(s.to)] || 0) : Support.delta(P, { gear: b }, { gear: a }),
          mats: [["900g a try", s.attempts.toFixed(1) + " tries", s.gold],
                 ["Destiny Stones", Math.ceil(s.attempts), 0]],
          buy: "nothing but gold — 900g and a Destiny Stone a try",
          odds: s.rate.toFixed(2) + "% a try; every failure banks karma energy and the bar guarantees the " +
                "attempt at 100%, so " + s.attempts.toFixed(1) + " tries on average",
          minimum: "Karmic Enlightenment " + s.to + ", " + s.total.toFixed(2) + "% weapon power"
        });
      });
    }
    baked.forEach(function (r) {
      if (dpsDmg && (r.series === "armor" || r.series === "weapon" || r.series === "karma")) return;
      // no baked ark grid rows on either axis while the recompute runs
      if (r.series === "arkgrid") return;
      // accessories are computed live from the lattice (accessoryRows)
      if (ACC_KINDS.indexOf(r.series) >= 0) return;
      var c = Object.assign({}, r);
      // gem steps reprice from the editable level-8 gem price (baked at 420k)
      if (r.series === "gems") {
        var f = ctx.gem8Price / 420000;
        c.gold = r.gold * f;
        if (r.total != null) c.total = r.total * f;
      }
      out.push(c);
    });
    accessoryRows(ctx, ctx.axis).forEach(function (r) { out.push(r); });
    // The ark grid is priced by the ACCOUNT model, per Shizu: rows are the
    // stretches of a simulated account's build, so the price, the damage, the
    // example and the pill all describe one grid. The band ladder lives on in
    // docs/research as the uniformity-cost reference only.
    ["arkgridEpic", "arkgridRare"].forEach(function (key) {
      if (!arkLive(ctx, RARITY_OF[key])) return;
      var src = arkSrc(ctx, RARITY_OF[key]);
      src.rows.forEach(function (r) {
        out.push(Object.assign({ series: key, label: r.from + " → " + r.to,
          cutsPerWeek: src.cutsPerWeek, rarity: src.rarity }, r));
      });
    });
    var k = party(ctx.axis);
    out.forEach(function (r) {
      // rows inside a pooled ark-grid stretch share the stretch's rate, so
      // the ladder unlocks in order and no grade letter ever vanishes
      r.gpd = r.poolD > 0 ? r.poolG / (r.poolD * k)
            : r.damage > 0 ? r.gold / (r.damage * k) : Infinity;
    });
    return out;
  }

  // ---- reading the pull ---------------------------------------------------
  // TWO sources, because neither one carries a whole character:
  //
  //   astrogem Worker    accessory grinding lines, ark-grid gems, skill-gem
  //                      levels. Sign-in walled.
  //   bracelet Worker    the RAW bracelet payload, per-slot main stat,
  //                      per-piece honing, karma, stone. No sign-in.
  //
  // Nothing here guesses. A system the pull cannot read says so, with the
  // reason — an unread system must never look like a graded one.
  //
  // THE BRACELET IS SCORED BY THE BRACELET CALCULATOR'S OWN SCORER, loaded from
  // that tool at lookup time. It used to be placed by the sum of its two combat
  // traits against each rung's EXAMPLE stat pair, which is not a threshold: a
  // 115/83 bracelet with three good lines failed every DPS rung (all of them
  // show 100/100 or better) and read "worse than C+" while the calculator had
  // it at A-. Reading the letter off subrank.braceletScore is the same call the
  // DPS ladder here was built from (commit ba4c708), so the two cannot disagree.
  //
  // line tier tables from the accessory calculator (values in %, bible sends x100)
  var LK_RAW = {
    "Outgoing Damage %": [0.55, 1.20, 2.00], "Additional Damage %": [0.95, 1.60, 2.60],
    "Attack Power %": [0.40, 0.95, 1.55], "Weapon Attack Power %": [0.80, 1.80, 3.00],
    "Crit Rate %": [0.40, 0.95, 1.55], "Crit Damage %": [1.10, 2.40, 4.00],
    "Stigma %": [2.15, 4.8, 8], "Gauge Gain %": [1.6, 3.6, 6],
    "Ally Dmg Buff %": [2, 4.5, 7.5], "Ally Atk Buff %": [1.35, 3, 5]
  };
  // the two flat rolls, same tables the accessory calculator prices them on
  var LK_FLAT = { "Attack Power+": [80, 195, 390], "Weapon Attack Power+": [195, 480, 960] };
  // main stat is a continuous roll; the ladder is cut at the quintile marks
  var LK_MS_RANGE = { neck: [15178, 17857], earring: [11806, 13889], ring: [10962, 12897] };
  var LK_MS_LABS = ["min", "low", "mid", "high", "max"];
  var LK_PRIMARY = {
    support: { neck: ["Stigma %", "Gauge Gain %"], earring: ["Weapon Attack Power %"],
               ring: ["Ally Dmg Buff %", "Ally Atk Buff %"] },
    dps: { neck: ["Outgoing Damage %", "Additional Damage %"],
           earring: ["Attack Power %", "Weapon Attack Power %"],
           ring: ["Crit Damage %", "Crit Rate %"] }
  };
  var LK_SLOTS = { neck: ["neck"], earring: ["ear1", "ear2"], ring: ["finger1", "finger2"] };
  var LK_SLOT_NAME = { neck: "necklace", ear1: "earring 1", ear2: "earring 2",
                       finger1: "ring 1", finger2: "ring 2" };
  var LK_BANDS = ["F-","F","F+","D-","D","D+","C-","C","C+","B-","B","B+","A-","A","A+","S-","S","S+"];
  // support classes that CAN play support; the gem set decides whether they do
  var LK_SUPPORT_CLASSES = { Bard: 1, Paladin: 1, Artist: 1, Valkyrie: 1 };
  var LK_SUPPORT_EFFECTS = { "Ally Attack Enh.": 1, "Brand Power": 1, "Ally Damage Enh.": 1 };
  var LK_DPS_EFFECTS = { "Attack Power": 1, "Additional Damage": 1, "Boss Damage": 1 };

  // ---- reading a piece -------------------------------------------------
  function lkTier(name, valueX100) {
    var t = LK_RAW[name];
    if (!t || valueX100 == null) return null;
    var v = valueX100 / 100, best = 0, bd = 1e9;
    for (var i = 0; i < 3; i++) { var d = Math.abs(v - t[i]); if (d < bd) { bd = d; best = i; } }
    return best;                         // 0 low, 1 mid, 2 high
  }
  function lkFlatTier(name, valueX100) {
    var t = LK_FLAT[name];
    if (!t || valueX100 == null) return null;
    var v = valueX100, best = 0, bd = 1e9;
    for (var i = 0; i < 3; i++) { var d = Math.abs(v - t[i]); if (d < bd) { bd = d; best = i; } }
    return ["low", "mid", "high"][best];
  }
  function lkMsTier(kind, value) {
    var r = LK_MS_RANGE[kind];
    if (!r || !(value > 0)) return null;
    var i = Math.round(4 * (value - r[0]) / (r[1] - r[0]));
    return LK_MS_LABS[Math.max(0, Math.min(4, i))];
  }
  function lkLine(piece, name) {
    var hit = null;
    (piece && piece.lines || []).forEach(function (l) { if (l.name === name && hit == null) hit = l; });
    return hit;
  }
  function lkCfgKey(prim, flat, ms) {
    return prim.map(function (t) { return t || "-"; }).join("|") + "/" + (flat || "-") + "/" + ms;
  }
  function lkAccIndex(ctx, axis, kind) {
    ctx.accIndex = ctx.accIndex || {};
    var ck = axis + ":" + kind;
    if (ctx.accIndex[ck]) return ctx.accIndex[ck];
    var lat = ctx.accLattice && ctx.accLattice[axis];
    var list = lat && lat[kind];
    if (!list) return null;
    var idx = {};
    list.forEach(function (c) { idx[lkCfgKey(c.prim || [], c.flat, c.ms)] = c.D; });
    ctx.accIndex[ck] = idx;
    return idx;
  }
  /** A pulled accessory as a ladder configuration, with its damage. */
  function lkAccConfig(ctx, piece, kind, axis, mainStat) {
    var idx = lkAccIndex(ctx, axis, kind);
    if (!idx || !piece) return null;
    if (!(mainStat > 0)) mainStat = null;
    var prims = LK_PRIMARY[axis][kind] || [];
    var used = {};
    var prim = prims.map(function (name) {
      var l = lkLine(piece, name);
      if (!l) return null;
      used[name] = 1;
      var t = lkTier(name, l.value);
      return t == null ? null : ["low", "mid", "high"][t];
    });
    var ms = lkMsTier(kind, mainStat) || "mid";       // unread main stat sits mid; the row says so
    // The flat roll. Support prices only Weapon Attack Power+; the DPS lattice
    // keeps atk and wpn apart, and a piece can carry both, so take whichever the
    // lattice scores higher rather than whichever came first in the payload.
    var cands = [null];
    Object.keys(LK_FLAT).forEach(function (name) {
      var l = lkLine(piece, name);
      if (!l) return;
      var t = lkFlatTier(name, l.value);
      if (!t) return;
      if (axis === "support") { if (name === "Weapon Attack Power+") cands.push(t); }
      else cands.push((name === "Attack Power+" ? "atk-" : "wpn-") + t);
    });
    var flat = null, bestD = -Infinity;
    cands.forEach(function (f) {
      var D = idx[lkCfgKey(prim, f, ms)];
      if (D != null && D > bestD) { bestD = D; flat = f; }
    });
    if (bestD === -Infinity) return null;
    if (flat) used[flat.indexOf("atk-") === 0 ? "Attack Power+" : "Weapon Attack Power+"] = 1;
    var extras = [];
    (piece.lines || []).forEach(function (l) { if (!used[l.name]) extras.push(l.name); });
    return { prim: prim, flat: flat, ms: ms, msVal: mainStat, D: bestD,
             gold: lkAccGold(ctx, axis, kind, prim, flat, ms),
             extras: extras, msRead: mainStat != null };
  }
  function lkAccGoldIndex(ctx, axis, kind) {
    ctx.accGoldIndex = ctx.accGoldIndex || {};
    var ck = axis + ":" + kind;
    if (ctx.accGoldIndex[ck]) return ctx.accGoldIndex[ck];
    var src = ctx.accGold && ctx.accGold[axis];
    var list = src && src[kind];
    if (!list) return null;
    var idx = {};
    list.forEach(function (c) { idx[lkCfgKey(c.prim || [], c.flat, c.ms)] = c.gold || 0; });
    ctx.accGoldIndex[ck] = idx;
    return idx;
  }
  function lkAccGold(ctx, axis, kind, prim, flat, ms) {
    var idx = lkAccGoldIndex(ctx, axis, kind);
    var g = idx && idx[lkCfgKey(prim, flat, ms)];
    return g || 0;
  }

  /**
   * THE RUNGS THE GEAR LIST SHOWS are the chart's own accessory chain for the
   * families ticked above the plan (accChain): base first, then the rungs.
   * A piece the chart would not price — a flat line while "no" is the only
   * flat ticked, say — still gets placed: its damage and its market price
   * come from the full lattice, and the next step is priced from it.
   */
  function lkFamily(ctx, axis, kind) {
    var ch = accChain(ctx, axis, kind);
    return ch && ch.base && ch.rungs.length ? [ch.base].concat(ch.rungs) : null;
  }
  /** A step between two points on that ladder, priced like any other row. */
  function lkAccStep(from, to, axis) {
    if (!from || !to) return null;
    var dmg = to.D - from.D, gold = Math.max(0, to.gold - (from.gold || 0));
    return { to: to.label, label: to.label, gold: gold, damage: dmg,
             gpd: dmg > 0 ? gold / (dmg * party(axis)) : Infinity,
             // the market prices the rung under the piece worn: the step costs
             // nothing beyond selling one and buying the other
             underPrice: to.gold <= (from.gold || 0) };
  }
  /**
   * Where a real piece sits on that ladder — INCLUDING ITSELF as a rung. The
   * next step is priced from the piece the character actually wears, not from
   * the rung below it, so a good piece is not charged twice. Of the rungs
   * above, the next buy is the one that costs least per 1% FROM THIS PIECE:
   * on the chain that is the rung straight above; off it — a dear flat roll
   * the switches exclude — it can be a rung further up.
   */
  function lkAccPlace(ctx, axis, kind, cfg) {
    var fam = lkFamily(ctx, axis, kind);
    if (!fam || !cfg) return null;
    var below = null, belowAt = -1, i;
    for (i = 0; i < fam.length; i++) {
      if (fam[i].D <= cfg.D) { below = fam[i]; belowAt = i; } else break;
    }
    var mineRung = { prim: cfg.prim, flat: cfg.flat, ms: cfg.ms, D: cfg.D,
                     gold: cfg.gold || 0, label: lkCfgLabel(cfg) };
    var next = null;
    for (i = belowAt + 1; i < fam.length; i++) {
      if (ctx.accFilter.sidegrades === false && !accStepsUp(mineRung, fam[i])) continue;
      var st = lkAccStep(mineRung, fam[i], axis);
      if (st && (!next || st.gpd < next.gpd)) next = st;
    }
    return {
      base: fam[0],
      underBase: belowAt <= 0,
      // YOUR PIECE IS A RUNG. Both steps are measured against it: the one that
      // reached it, from the ladder rung underneath, and the one out of it. So
      // a good piece is neither charged twice nor credited to a rung you never
      // bought.
      last: belowAt >= 0 && cfg.D > below.D ? lkAccStep(below, mineRung, axis) : null,
      next: next
    };
  }

  /** How a piece reads on screen: "high/low · mid wpn flat · high stat". */
  function lkCfgLabel(cfg) {
    var head = cfg.prim.map(function (t) { return t || "—"; }).join("/");
    var flat = cfg.flat
      ? cfg.flat.replace("atk-", "atk ").replace("wpn-", "wpn ") + " flat"
      : "no flat";
    return head + " · " + flat + " · " + cfg.ms + " stat";
  }

  // ---- the bracelet ----------------------------------------------------
  // decodeWithGradeCheck, ported from the bracelet calculator's bible-import.js:
  // the decoder guesses Relic or Ancient off the value tables and the two tables
  // overlap, so the trait cap (a fact about the item) and then the granted-slot
  // count (a guess about the player) settle it.
  var LK_TRAIT_CAP = { relic: 100, ancient: 120 };
  function lkSlotChoices(grade) { return grade === "relic" ? [1, 2] : [2, 3]; }
  function lkCapBroken(dec, grade) {
    for (var i = 0; i < dec.lines.length; i++) {
      var l = dec.lines[i];
      if (l.cat === "trait" && l.value > LK_TRAIT_CAP[grade]) return true;
    }
    return false;
  }
  function lkDecodeBracelet(stats) {
    var B = lib("Bracelet");
    var dec = B.decodeBibleBracelet(stats), i;
    if (lkCapBroken(dec, dec.grade)) {
      var forced = dec.grade === "relic" ? "ancient" : "relic";
      var fdec = B.decodeBibleBracelet(stats, { grade: forced });
      if (!lkCapBroken(fdec, forced)) return fdec;
    }
    var granted = 0;
    for (i = 0; i < dec.lines.length; i++) if (!dec.lines[i].fixed) granted++;
    if (lkSlotChoices(dec.grade).indexOf(granted) >= 0) return dec;
    var other = dec.grade === "relic" ? "ancient" : "relic";
    if (lkSlotChoices(other).indexOf(granted) < 0) return dec;
    var alt = B.decodeBibleBracelet(stats, { grade: other });
    return lkCapBroken(alt, other) ? dec : alt;
  }
  var _supProfile = null;
  function lkSupportProfile() {
    if (!_supProfile && lib("Bracelet")) _supProfile = lib("Bracelet").normalizeProfile({ role: "support" });
    return _supProfile;
  }
  var LK_TIER_WORD = { low: "blue", mid: "epic", high: "LEG" };
  function lkBraceletGrade(stats, axis) {
    var B = lib("Bracelet"), S = lib("Subrank");
    if (!B || !S || !stats || !stats.length) return null;
    var dec, r;
    try {
      dec = lkDecodeBracelet(stats);
      var traits = {}, lines = [];
      dec.lines.forEach(function (l) {
        if (l.cat === "trait") traits[l.family === "swiftness" ? "swift" : l.family] = l.value;
        else lines.push(l);
      });
      r = S.braceletScore({ lines: lines, traits: traits, grade: dec.grade,
                            profile: axis === "support" ? lkSupportProfile() : null });
      var names = Object.keys(traits);
      return {
        grade: dec.grade, band: r.band.key, score: r.score, damagePct: r.damagePct,
        total: r.total,        // the chart's additive damage scale, for the from-here gain
        traits: names.map(function (k) { return { stat: k, v: traits[k] }; }),
        lines: lines.map(function (l) {
          // a basic (Str/Dex/Int) line has no family id, so it carries its own
          // wording; the chart's chip reads the id first and the name after
          return l.cat === "basic"
            ? { id: null, name: "main stat", tier: "", cat: "basic", value: l.value }
            : { id: l.family, tier: LK_TIER_WORD[l.tier] || l.tier, cat: l.cat, value: l.value };
        }),
        unknown: (dec.unknown || []).length
      };
    } catch (e) { return null; }
  }

  // ---- the rest of the pull --------------------------------------------
  function lkGridBand(gems, axis) {
    var A = lib("Astrogem");
    if (!A || !gems || !gems.length) return null;
    var gs = [], sup = axis === "support";
    gems.forEach(function (g) {
      try {
        if (A.validateConfig && !A.validateConfig(g).valid) return;
        var gr = sup && A.supportGrade ? A.supportGrade(g) : A.grade(g);
        if (isFinite(gr)) gs.push(gr);
      } catch (e) {}
    });
    if (!gs.length) return null;
    var mean = gs.reduce(function (a, b) { return a + b; }, 0) / gs.length;
    var rank = sup && A.supportRankFromGrade ? A.supportRankFromGrade(mean) : A.rankFromGrade(mean);
    return { mean: mean, band: rank, n: gs.length };
  }
  /** The grid band on the axis being shown, graded once per axis. */
  function lkGrid(c, axis) {
    if (!c) return null;
    c._grid = c._grid || {};
    // never cache a null: astrogem.js is a deferred cross-origin script on the
    // chart, and a grade taken before it arrives would pin "did not parse"
    if (c._grid[axis] == null) c._grid[axis] = lkGridBand(c.gems, axis);
    return c._grid[axis];
  }
  // approximate +levels from item level: the honing rows' own formula is
  // ilvl = 1675 + 5*level (uniform), so the fully-owned level is its floor
  function lkHoning(ilvl) {
    if (!ilvl) return null;
    return Math.max(11, Math.min(25, Math.floor((ilvl - 1675) / 5)));
  }
  /** support iff a support class AND a support-dominant gem set (astrogem's rule) */
  function lkRoleOf(cls, gems) {
    if (!cls || !LK_SUPPORT_CLASSES[cls]) return "dps";
    var sup = 0, dps = 0;
    (gems || []).forEach(function (x) {
      [["effect1", "effect1Level"], ["effect2", "effect2Level"]].forEach(function (p) {
        var name = x[p[0]], lv = x[p[1]] || 0;
        if (LK_SUPPORT_EFFECTS[name]) sup += lv;
        else if (LK_DPS_EFFECTS[name]) dps += lv;
      });
    });
    return (sup > 0 && sup >= dps * 2) ? "support" : "dps";
  }
  /** The last rung you already own: the highest index the test still passes.
   *  Scans the whole ladder rather than stopping at the first miss — the
   *  accessory chains carry one non-monotone step apiece. */
  function lkOwnedIndex(rows, ownedTest) {
    var idx = -1;
    for (var i = 0; i < rows.length; i++) if (ownedTest(rows[i])) idx = i;
    return idx;
  }
  var LK_DAY = 86400000;
  function lkDays(ts, now) { return ts ? Math.floor(((now == null ? Date.now() : now) - ts) / LK_DAY) : null; }
  /** " · read from a pull 15 days old", or nothing while it is recent. */
  function lkAgeNote(c, key, now) {
    var st = c && c.stamp && c.stamp[key];
    var days = st && lkDays(st.ts, now);
    return days != null && days >= 2 ? " · read from a pull " + days + " days old" : "";
  }

  // ---- where the character sits on every ladder ------------------------
  // One pass, shared by the chart's "yours" lines, its gear list and place().
  // Every entry carries what was READ, where that PUTS you, and why not when
  // not. `rows` is steps(ctx) for the same context.
  function lkPositions(ctx, c, rows, now) {
    if (!c) return null;
    var axis = ctx.axis;
    if (now == null) now = Date.now();
    var out = { yours: {}, next: {}, list: [] };
    Object.keys(SERIES).forEach(function (key) {
      var mine = rows.filter(function (r) { return r.series === key; });
      var e = { key: key, label: SERIES[key].label, owned: -1, seen: null,
                place: null, detail: null, why: null };
      if (!mine.length) {
        // the chart carries no rungs for this series on this axis, so there is
        // nothing to place against — it is not a hole in the pull
        out.yours[key] = { owned: -1, label: null }; return;
      }
      if (key === "armor" || key === "weapon") {
        var hn = key === "armor" ? c.honeArmor : c.honeWeapon;
        if (hn != null) {
          e.owned = lkOwnedIndex(mine, function (r) {
            return parseInt(String(r.to || "").replace(/[^0-9]/g, ""), 10) <= hn;
          });
          e.seen = "+" + hn;
          e.detail = (c.honeExact
            ? (key === "armor" ? "the lowest of your five armour pieces" : "read off the weapon")
            : "estimated from " + (c.ilvl || "?") + " ilvl — the pull is older than the honing parser")
            + lkAgeNote(c, "honing", now);
          e.place = "+" + hn;
        } else e.why = "no honing in the pull";
      } else if (key === "karma") {
        if (c.karma != null) {
          e.owned = lkOwnedIndex(mine, function (r) {
            return (parseInt(String(r.to || "").replace(/[^0-9]/g, ""), 10) || 99) <= c.karma;
          });
          e.seen = "Enlightenment " + c.karma;
          e.place = "lv " + c.karma;
          e.detail = lkAgeNote(c, "karma", now).replace(/^ · /, "") || null;
        } else e.why = "no karma in the pull";
      } else if (key === "stone") {
        if (c.stone) {
          var md = c.stone.split("-").map(Number);
          e.owned = lkOwnedIndex(mine, function (r) {
            var rd = String(r.to || "").match(/(\d+)-(\d+)/);
            return rd && (+rd[1] < md[0] || (+rd[1] === md[0] && +rd[2] <= md[1]));
          });
          e.seen = c.stone;
          e.place = c.stone;
          var sbits = [];
          if (c.stoneGuess) sbits.push("the bracelet pull lists all three engravings' nodes " +
            "without saying which is the malus, so this is the top two of three");
          var sage = lkAgeNote(c, "stone", now).replace(/^ · /, "");
          if (sage) sbits.push(sage);
          e.detail = sbits.join("; ") || null;
        } else e.why = "no ability stone in the pull";
      } else if (key === "bracelet") {
        var br = c.braceletRaw ? lkBraceletGrade(c.braceletRaw, axis) : null;
        if (br) {
          var bi = LK_BANDS.indexOf(br.band);
          e.owned = lkOwnedIndex(mine, function (r) {
            var ri = LK_BANDS.indexOf(String(r.to || "").trim());
            return ri >= 0 && ri <= bi;
          });
          e.seen = br.traits.map(function (t) { return t.stat + " " + t.v; }).join(" / ") +
                   " · " + br.lines.length + (br.lines.length === 1 ? " line" : " lines");
          e.place = br.band;
          e.detail = "score " + br.score.toFixed(1) + " on the bracelet calculator's own ladder, " +
                     br.damagePct.toFixed(2) + "% damage" +
                     "";
          e.lines = br.lines;
          e.bracelet = br;
          // A rolled-out bracelet cannot be improved in place, so the next band
          // is a fresh rolling campaign priced FROM SCRATCH — the rung's total,
          // not the ladder's band-to-band step — and its gain is measured from
          // THIS bracelet's damage, not from the band mean it belongs to. The
          // steps are right for a planner starting with nothing; a holder of a
          // C+ still needs the full 1-in-7 to see a B- (tikky, 2026-09-24: the
          // list said 162k for +0.75%; from a rolled-out C+ it is 412k).
          var nx = mine[e.owned + 1];
          if (nx && nx.total != null && nx.totalDamage != null && br.total != null) {
            var gain = nx.totalDamage - br.total;
            e.braceletNext = Object.assign({}, nx, {
              gold: nx.total, damage: gain, fromScratch: true,
              gpd: gain > 0 ? nx.total / (gain * party(axis)) : Infinity });
          }
        } else {
          if (c.braceletStats) e.seen = c.braceletStats.join("/") + " combat traits";
          e.why = c.braceletRaw
            ? "the bracelet calculator's scorer did not load, so the lines cannot be read"
            : (c.bcNote || "no bracelet in the pull");
        }
      } else if (key === "gems") {
        if (c.minGem != null) {
          e.owned = lkOwnedIndex(mine, function (r) {
            return (parseInt(String(r.to || "").replace(/[^0-9]/g, ""), 10) || 99) <= c.minGem;
          });
          e.seen = "lowest of " + c.gemCount + " is level " + c.minGem;
          e.place = "level " + c.minGem;
          e.detail = "the ladder levels every gem, so it is priced off the lowest one";
        } else e.why = "no skill gems in the pull";
      } else if (key === "neck" || key === "ring" || key === "earring") {
        var pieces = lkAccPieces(ctx, c, key, axis);
        if (pieces && pieces.length) {
          var weakest = pieces[0];
          pieces.forEach(function (p) { if (p.cfg && (!weakest.cfg || p.cfg.D < weakest.cfg.D)) weakest = p; });
          var place = weakest.cfg ? lkAccPlace(ctx, axis, key, weakest.cfg) : null;
          if (place) {
            e.seen = lkCfgLabel(weakest.cfg);
            e.place = lkCfgLabel(weakest.cfg);
            e.pieces = pieces;
            e.owned = place.underBase ? -1 : 0;
            e.accLast = place.last;
            e.accNext = place.next;
            var bits = [];
            if (pieces.length > 1) bits.push("the weaker of your " + pieces.length + " (" + weakest.name + ")");
            if (!weakest.cfg.msRead) bits.push("main stat not in the pull, taken as mid");
            if (weakest.cfg.extras.length) bits.push(weakest.cfg.extras.join(", ") + " not priced by the ladder");
            e.detail = bits.join("; ") || null;
            e.ownRung = true;
          } else e.why = "the accessory damage table did not load";
        } else e.why = c.noAstro ? "the accessory lines come with the astrogem pull, and there is none"
          : "no " + (key === "neck" ? "necklace" : key) + " in the pull";
      } else if (RARITY_OF[key]) {
        var grid = lkGrid(c, axis);
        if (grid && grid.band) {
          var gi = LK_BANDS.indexOf(grid.band);
          e.owned = lkOwnedIndex(mine, function (r) {
            var ri = LK_BANDS.indexOf(String(r.to || "").trim());
            return ri >= 0 && ri <= gi;
          });
          e.seen = grid.band + " (mean of " + grid.n + " cut gems)";
          e.place = grid.band;
        } else e.why = c.noAstro ? "the ark grid gems come with the astrogem pull, and there is none"
          : "the ark grid gems did not parse";
      }
      var graded = e.seen != null && !e.why;
      out.yours[key] = { owned: e.owned, label: graded ? (e.place || e.seen) : null };
      // the rung you are standing on — the step that bought your current
      // position — so the list can show what the last 1% cost beside the next
      if (graded) {
        if (e.accNext !== undefined) { e.last = e.accLast; e.next = e.accNext; }
        else {
          if (e.owned >= 0) e.last = mine[e.owned];
          e.next = e.braceletNext || mine[e.owned + 1] || null;
        }
      }
      if (graded && e.next && isFinite(e.next.gpd) && e.next.gpd != null && e.next.gpd <= 25e6) {
        out.next[key] = e.next;
      }
      out.list.push(e);
    });
    var bestKey = null;
    Object.keys(out.next).forEach(function (k) {
      if (!bestKey || out.next[k].gpd < out.next[bestKey].gpd) bestKey = k;
    });
    out.bestKey = bestKey;
    // what the chart prints: each card's "yours" line (a card per system in
    // the list), and the buy its banner names
    out.labels = {};
    out.list.forEach(function (e) {
      var y = out.yours[e.key];
      out.labels[e.key] = y.label != null ? y.label : NOT_READ;
    });
    var n = bestKey ? out.next[bestKey] : null;
    out.cheapest = n ? {
      system: bestKey, label: SERIES[bestKey].label,
      from: out.yours[bestKey].label, to: n.to || "",
      goldPer1Pct: n.gpd, gold: n.gold, damage: n.damage,
      text: SERIES[bestKey].label + " → " + (n.to || ""),
      price: fmtGpd(n.gpd, "/1%")
    } : null;
    return out;
  }
  /** Every piece in a slot kind, read as a configuration. */
  function lkAccPieces(ctx, c, kind, axis) {
    if (!c || !c.acc) return null;
    var out = [];
    (LK_SLOTS[kind] || []).forEach(function (slot) {
      var piece = c.acc[slot];
      if (!piece) return;
      out.push({ slot: slot, name: LK_SLOT_NAME[slot] || slot, lines: piece.lines || [],
                 cfg: lkAccConfig(ctx, piece, kind, axis, c.mainStat && c.mainStat[slot]) });
    });
    return out;
  }

  // ---- the lookup record ---------------------------------------------------
  /** A parsed character, as opposed to a queue notice or an error. Gems used to
   *  be the sentinel, which threw away every record whose ark grid was empty. */
  function lkHasRecord(d) {
    return !!(d && d.name && !d.needSignIn && !d.error &&
      (Array.isArray(d.gems) || Array.isArray(d.accessories) || Array.isArray(d.classicGemLevels)));
  }
  /**
   * The astrogem Worker's half, as the record the lookup reads. `current` is
   * the record already on screen: the same character keeps the bracelet half
   * it had, and a field the older bracelet pull supplied survives a re-pull
   * that could not read it. Returns a new record; `role` is the class's axis.
   */
  function lkReadAstro(d, current) {
    var accs = d.accessories || [];
    var bySlot = {};
    accs.forEach(function (a) { if (a && a.slot) bySlot[a.slot] = a; });
    var gems = (d.classicGemLevels || []).filter(function (x) { return x != null; });
    var eq = d.equipment || null;
    var armExact = !!(eq && eq.armorMin != null), wpnExact = !!(eq && eq.weapon != null);
    var same = current && current.name === d.name && current.region === d.region;
    var prev = same ? current : null;
    var c = {
      name: d.name, ilvl: d.itemLevel ? Math.round(d.itemLevel) : null, cls: d.class,
      minGem: gems.length ? Math.min.apply(null, gems) : null,
      gemCount: gems.length,
      acc: bySlot,
      gems: d.gems || null,
      // exact per-piece honing when the record carries it; ilvl approximation
      // only for records pulled before the parser learned equipment. Tested per
      // FIELD, not on the equipment object: a partial record would otherwise
      // claim an exact reading it does not have.
      honeArmor: armExact ? eq.armorMin : lkHoning(d.itemLevel),
      honeWeapon: wpnExact ? eq.weapon : lkHoning(d.itemLevel),
      honeExact: armExact && wpnExact,
      karma: d.karma ? d.karma.enlightenment : null,
      stone: d.stone ? d.stone.a + "-" + d.stone.b : null,
      region: d.region || null,
      // WHICH PULL each reading came from, and when. Two workers cache
      // independently, so the older one must never quietly overwrite the newer:
      // a 15-day-old bracelet record was reporting White at +19/+20 armour and
      // weapon over a fresher astrogem pull. A stamp is laid ONLY where a value
      // actually came back — stamping a null would lock out the other pull,
      // which does have it.
      stamp: {},
      // the two combat traits alone, kept only so an unscoreable bracelet can
      // still show what came back
      braceletStats: d.bracelet && Array.isArray(d.bracelet.stats) &&
        typeof d.bracelet.stats[0] === "number" ? d.bracelet.stats : null,
      // should this worker ever start forwarding the bible's own stat array,
      // it is the same shape the bracelet worker sends and scores the same way
      braceletRaw: (d.bracelet && Array.isArray(d.bracelet.stats) &&
        d.bracelet.stats[0] && typeof d.bracelet.stats[0] === "object"
        ? d.bracelet.stats : null) || (prev ? prev.braceletRaw : null),
      mainStat: prev ? prev.mainStat : null,
      bcNote: prev ? prev.bcNote : null,
      pulledAt: d.pulledAt || null
    };
    var st = c.stamp, ts = d.pulledAt || null;
    if (c.honeArmor != null || c.honeWeapon != null) {
      st.honing = { src: "astrogem", ts: ts, exact: armExact && wpnExact };
    }
    if (c.karma != null) st.karma = { src: "astrogem", ts: ts };
    if (c.stone) st.stone = { src: "astrogem", ts: ts };
    // a field the older bracelet pull already supplied survives a re-pull that
    // could not read it — losing it would be a step backwards, not a refresh
    if (prev) {
      ["karma", "stone"].forEach(function (k) {
        if (c[k] == null && prev[k] != null && prev.stamp && prev.stamp[k]) {
          c[k] = prev[k];
          st[k] = prev.stamp[k];
        }
      });
    }
    // the class decides the axis
    c.role = lkRoleOf(d.class, d.gems);
    return c;
  }
  /**
   * The bracelet Worker's half: the raw bracelet, per-slot main stat, and the
   * honing, karma and stone where they are fresher. Fills `c` in place.
   * Returns false when there was nothing to fill (no record, or an answer
   * older than the one already applied), true otherwise.
   */
  function lkReadBracelet(c, d) {
    if (!c) return false;
    var stats = d && d.bracelet && d.bracelet.stats;
    // an older bracelet answer still in flight must not replace a newer one
    if (d && d.pulledAt && c.bcPulledAt && d.pulledAt < c.bcPulledAt) return false;
    if (Array.isArray(stats) && stats.length) {
      c.braceletRaw = stats;
      c.bcNote = null;
      var raw = d.profile && d.profile.raw;
      var by = raw && raw.accessoryBySlot;
      if (by) {
        c.mainStat = {};
        Object.keys(by).forEach(function (s) { if (by[s] && by[s].mainStat) c.mainStat[s] = by[s].mainStat; });
      }
      // The bracelet page also reads honing, karma and the stone. Take them only
      // when THIS record is at least as fresh as the astrogem one, and only for
      // a field the astrogem pull did not read exactly — an older cache must not
      // undo a newer pull. The date rides along either way.
      var pr = d.profile || {};
      var ts = d.pulledAt || 0;
      c.bcPulledAt = d.pulledAt || null;
      c.bcStale = !!d.stale;
      // what lostark.bible ITSELF last saw. A re-pull cannot beat this date, so
      // it is the honest ceiling on how fresh any of this can be.
      var lo = (d.loadouts || [])[d.chosenLoadout] || (d.loadouts || [])[0];
      c.bcSeenAt = lo && lo.lastUpdated ? lo.lastUpdated : null;
      var fresher = function (field, exact) {
        var st = c.stamp && c.stamp[field];
        if (!st || st.ts == null) return true;        // nothing there to lose
        if (exact && !st.exact) return true;          // a per-piece reading beats an
                                                      // ilvl estimate at any age
        return ts >= st.ts;                           // otherwise the newer record wins
      };
      if (pr.honing && fresher("honing", true)) {
        var arm = ["head", "chest", "pants", "gloves", "shoulder"]
          .map(function (k) { return pr.honing[k]; })
          .filter(function (v) { return v != null; });
        if (arm.length === 5 && pr.honing.weapon != null) {
          c.honeArmor = Math.min.apply(null, arm);
          c.honeWeapon = pr.honing.weapon;
          c.honeExact = true;
          c.stamp.honing = { src: "bracelet", ts: ts, exact: true };
        }
      }
      if (raw && raw.karma && raw.karma.enlightenment != null && fresher("karma")) {
        c.karma = raw.karma.enlightenment;
        c.stamp.karma = { src: "bracelet", ts: ts };
      }
      // THE STONE, CAREFULLY. raw.stoneNodes is every engraving's node count,
      // the malus included, already sorted high-to-low by the worker — so the
      // top two are NOT reliably the two combat engravings. A 9/6 stone whose
      // malus sits at 7 reads [9,7,6] and would show as "9-7", marking a rung
      // owned that the character should be buying. So the astrogem worker's
      // own {a,b} split always wins, and a three-node array is only used when
      // there is nothing else, and says that it is a guess.
      if (raw && Array.isArray(raw.stoneNodes) && raw.stoneNodes.length >= 2 && !c.stone) {
        var sn = raw.stoneNodes.slice().sort(function (a, b) { return b - a; });
        c.stone = sn[0] + "-" + sn[1];
        c.stoneGuess = sn.length > 2;
        c.stamp.stone = { src: "bracelet", ts: ts };
      }
    } else {
      c.bcNote = d && d.queued
        ? "queued at the bracelet worker — run the lookup again in a minute"
        : (d && d.message) || "the bracelet worker had nothing for this character";
    }
    return true;
  }
  /** With no astrogem answer the bracelet record names the character; its
   *  own gem levels stand in for the astrogem pull's. Accessory lines and ark
   *  grid gems exist only in the astrogem pull, and say so. */
  function lkReadRecordAlone(b) {
    var pr = b.profile || {};
    var c = lkReadAstro({ name: b.name, region: b.region, "class": b["class"], itemLevel: b.itemLevel,
                          classicGemLevels: Array.isArray(pr.gemLevels) ? pr.gemLevels : null,
                          pulledAt: b.pulledAt }, null);
    for (var k in c.stamp) c.stamp[k].src = "bracelet";
    c.noAstro = true;
    return c;
  }

  // ---- loading -------------------------------------------------------------
  // no-cache: revalidate every load. Without it the browser's heuristic cache
  // served day-old rows after a deploy — the page and its data must not drift.
  function grab(u) {
    return fetch(u, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = root.document.createElement("script");
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error(src)); };
      root.document.head.appendChild(s);
    });
  }
  /** A library global: there already, or fetched once. A failure is forgotten
   *  so the next call tries again. */
  var _need = {};
  function need(name, src) {
    if (lib(name)) return Promise.resolve(true);
    if (_need[name]) return _need[name];
    _need[name] = loadScript(src)
      .then(function () { return !!lib(name); }, function () { return false; })
      .then(function (ok) { if (!ok) delete _need[name]; return ok; });
    return _need[name];
  }
  /** Support, Gear, Honing and Karma, from beside this file. */
  function loadModels() {
    return Promise.all(MODELS.map(function (f) { return need(f[1], BASE + f[0]); }))
      .then(function (ok) { return ok.every(Boolean); });
  }
  function loadAstrogem() { return need("Astrogem", ASTROGEM_JS); }
  /** prices.js from beside this file, unless the page loaded it already. It is
   *  a nicety: a failure resolves too, and the defaults fall back to MAT_PRICE.
   *  Unpinned on purpose: the 6-hour refresh rewrites it without a pin bump. */
  var _prices = null;
  function loadPrices() {
    if (feed() || !root.document) return Promise.resolve(!!feed());
    if (!_prices) _prices = loadScript(BASE + "prices.js")
      .then(function () { return !!feed(); }, function () { _prices = null; return false; });
    return _prices;
  }

  // ---- the bracelet calculator's model, fetched when a character is ----------
  // subrank.js keeps the Bracelet it finds when it runs, so a copy that ran
  // before the model scores nothing: the profile page loads one early for its
  // board letters. Asking it for the default anchors (the first thing a score
  // asks for, cached after) is the test that it can score.
  function lkScorerWorks() {
    var S = lib("Subrank");
    if (!lib("Bracelet") || !S) return false;
    try { S.anchorsFor("ancient"); return true; } catch (e) { return false; }
  }
  var _bcModel = null;
  function lkLoadBraceletModel() {
    if (lkScorerWorks()) return Promise.resolve(true);
    if (_bcModel) return _bcModel;
    var fetched = false;
    _bcModel = BC_FILES.reduce(function (chain, f) {
      return chain.then(function () {
        // each file reads the ones before it as it runs, so once one is
        // fetched, every file after it runs again
        if (!fetched && lib(f[1])) return null;      // already there; do not re-run it
        fetched = true;
        return new Promise(function (res, rej) {
          var el2 = root.document.createElement("script");
          el2.src = BC_BASE + f[0] + "?v=" + BC_PIN;
          el2.onload = function () { res(); };
          el2.onerror = function () { rej(new Error(f[0])); };
          root.document.head.appendChild(el2);
        });
      });
    }, Promise.resolve())
      .then(function () { return lkScorerWorks(); })
      .catch(function () { return false; })
      // A network hiccup must not cost the whole session: forget a failed load
      // so the next lookup, or Re-pull, tries again.
      .then(function (ok) { if (!ok) _bcModel = null; return ok; });
    return _bcModel;
  }

  // The accessory damage lattice — every (primary pair, flat roll, main-stat
  // quintile) with its damage. Both the ladder rungs and the character's own
  // pieces are placed through it, which is the only way the two are comparable.
  // Damage and gold live in different files on the support axis: -scores
  // carries D with its gold column zeroed, -configs carries the market price.
  // The DPS file carries both. Every rung price is a delta over these.
  var _accLattice = null;
  /** Fetch the lattice once and lay it on a context (the module's own when
   *  none is given). Resolves to the context's lattice, or null. */
  function lkLoadLattice(ctx) {
    ctx = ctx || DATA;
    if (!_accLattice) {
      _accLattice = Promise.all([grab(BASE + "data/accessory-scores.json"),
                                 grab(BASE + "data/accessory-configs.json"),
                                 grab(BASE + "data/accessory-configs-dps.json")])
        .then(function (a) {
          if (!a[0] || !a[1] || !a[2]) { _accLattice = null; return null; }
          return a;
        }).catch(function () { _accLattice = null; return null; });
    }
    return _accLattice.then(function (a) {
      if (!a) return null;
      if (!ctx.accLattice || ctx.accLattice.support !== a[0]) {
        ctx.accLattice = { support: a[0], dps: a[2] };
        ctx.accGold = { support: a[1], dps: a[2] };
        ctx.accIndex = {}; ctx.accFam = {};
      }
      return ctx.accLattice;
    });
  }
  /** Lay the baked tables on a context. `got` maps each DATA_FILES name to its
   *  parsed file, null where the fetch failed. */
  function absorb(ctx, got) {
    var dps = got["rows-dps.json"];
    ctx.arkgridRowsDps = { epic: got["arkgrid-rows-dps-epic.json"], rare: got["arkgrid-rows-dps-rare.json"] };
    ctx.arkgridRows = ctx.arkgridRows || {};
    ctx.arkgridRows.epic = got["arkgrid-rows-epic.json"];
    ctx.arkgridRows.rare = got["arkgrid-rows-rare.json"];
    ctx.honing = got["honing-t4upper.json"]; ctx.karma = got["karma.json"];
    ctx.rows = ctx.rows || {};
    ctx.rows.support = got["rows.json"] ? got["rows.json"].rows : [];
    ctx.rows.dps = dps ? dps.rows : null;
    ctx.dpsDamage = dps && dps.honingDamage
      ? { honing: dps.honingDamage, karma: dps.karmaDamage } : null;
    return ctx;
  }

  // The module's own tables, for place(). The chart keeps its own on its state.
  var DATA = { honing: null, karma: null, rows: { support: null, dps: null }, arkgridRows: {},
               accLattice: null, accIndex: {}, accFam: {}, accGoldIndex: {} };
  var _data = null;
  function loadData() {
    if (_data) return _data;
    var prices = loadPrices();               // never holds the tables up or fails them
    _data = Promise.all(DATA_FILES.map(function (f) { return grab(BASE + "data/" + f); })
                          .concat([lkLoadLattice(DATA), prices]))
      .then(function (all) {
        var got = {};
        DATA_FILES.forEach(function (f, i) { got[f] = all[i]; });
        absorb(DATA, got);
        var ok = all.slice(0, DATA_FILES.length + 1).every(Boolean);
        if (!ok) _data = null;               // a table that failed is fetched again next time
        return ok;
      });
    return _data;
  }

  /**
   * Everything place() needs, fetched once. Resolves (never rejects) to
   * { ok, models, data, astrogem, bracelet }: ok means place() can run; a
   * false astrogem or bracelet means those two systems will say they could
   * not be read. Anything that failed is fetched again on the next call.
   */
  var _ready = null;
  function ready() {
    if (_ready) return _ready;
    _ready = Promise.all([loadModels(), loadData(), loadAstrogem(), lkLoadBraceletModel()])
      .then(function (a) {
        var st = { ok: !!(a[0] && a[1]), models: a[0], data: a[1], astrogem: a[2], bracelet: a[3] };
        if (!(a[0] && a[1] && a[2] && a[3])) _ready = null;
        return st;
      });
    return _ready;
  }

  // ---- the one call --------------------------------------------------------
  function unwrap(j) { return j && j.data && typeof j.data === "object" ? j.data : j; }
  /**
   * Where one character stands, as the chart's lookup shows it.
   *
   *   input.record    the bracelet-bible /character answer (or null)
   *   input.astro     the astrogem-bible answer (or null)
   *   input.axis      "support" | "dps"; omitted, the class's own axis
   *                   (support iff a support class with a support gem set)
   *   input.switches  { flat, stat, sidegrades, prices, enabled, gem8Price },
   *                   each optional: flat/stat replace the ticked accessory
   *                   families (default no flat line, high main stat);
   *                   sidegrades false lets no accessory step lower a
   *                   primary line (default true);
   *                   prices (gold per ONE unit) and enabled merge over the
   *                   material panel's defaults
   *   input.now       the clock, for "read from a pull N days old"
   *
   * With both answers this is the chart's lookup, number for number. With the
   * bracelet record alone, its own gem levels stand in for the astrogem
   * pull's, and the accessories and the ark grid say they need that pull; the
   * class's axis cannot see the ark grid gems then, so a support class grades
   * as DPS unless `axis` says otherwise. With the astrogem answer alone, the
   * bracelet reads "no bracelet in the pull" and main stats sit at mid, as on
   * the chart before the bracelet half lands.
   *
   * Returns null until ready() has landed the tables, or with no usable pull.
   * Otherwise the chart's positions: { yours, next, list, bestKey } exactly as
   * the chart computes them, plus labels (each system's "yours" text),
   * cheapest ({ system, label, from, to, goldPer1Pct, gold, damage, text,
   * price } or null when nothing under 25M per 1% is left), axis and role.
   */
  function place(input) {
    input = input || {};
    var astro = unwrap(input.astro), record = unwrap(input.record);
    if (!lkHasRecord(astro)) astro = null;
    if (!(record && typeof record === "object")) record = null;
    if (!astro && !(record && record.name)) return null;
    if (!DATA.honing || !DATA.karma || !lib("Support") || !lib("Gear") || !lib("Honing") || !lib("Karma")) return null;
    var c = astro ? lkReadAstro(astro, null) : lkReadRecordAlone(record);
    if (record) lkReadBracelet(c, record);
    var sw = input.switches || {}, d0 = defaults(DATA.honing);
    var ctx = {};
    for (var k in DATA) ctx[k] = DATA[k];            // the tables and their caches, shared
    ctx.axis = input.axis === "support" || input.axis === "dps" ? input.axis : c.role;
    ctx.accFilter = { flat: Array.isArray(sw.flat) ? sw.flat.slice() : d0.accFilter.flat,
                      stat: Array.isArray(sw.stat) ? sw.stat.slice() : d0.accFilter.stat,
                      sidegrades: sw.sidegrades === false ? false : d0.accFilter.sidegrades };
    ctx.prices = d0.prices; ctx.enabled = d0.enabled;
    var id;
    for (id in sw.prices || {}) ctx.prices[id] = +sw.prices[id] || 0;
    for (id in sw.enabled || {}) ctx.enabled[id] = !!sw.enabled[id];
    ctx.gem8Price = sw.gem8Price != null && isFinite(sw.gem8Price) ? +sw.gem8Price : d0.gem8Price;
    var pos = lkPositions(ctx, c, steps(ctx), input.now);
    pos.axis = ctx.axis;
    pos.role = c.role;
    return pos;
  }

  var api = {
    version: VERSION,
    // loading
    ready: ready, loadData: loadData, loadModels: loadModels, loadAstrogem: loadAstrogem,
    loadPrices: loadPrices, priceInfo: priceInfo,
    loadBraceletScorer: lkLoadBraceletModel, loadLattice: lkLoadLattice,
    absorb: absorb, grab: grab, use: use, data: function () { return DATA; },
    // the one call
    place: place,
    // the pieces the chart puts together itself
    steps: steps, positions: lkPositions, readAstro: lkReadAstro, readBracelet: lkReadBracelet,
    hasRecord: lkHasRecord, roleOf: lkRoleOf, defaults: defaults, materials: materials,
    arkSrc: arkSrc, arkLive: arkLive, accFilterKey: accFilterKey, cfgLabel: lkCfgLabel,
    party: party, days: lkDays, fmtGold: fmtGold, fmtGpd: fmtGpd,
    // the tables of names
    SERIES: SERIES, RARITY_OF: RARITY_OF, NOT_READ: NOT_READ, ACC_FLAT_OPTS: ACC_FLAT_OPTS,
    ACC_STAT_OPTS: ACC_STAT_OPTS, DATA_FILES: DATA_FILES, MODELS: MODELS, BC_BASE: BC_BASE,
    BC_PIN: BC_PIN, ASTROGEM_JS: ASTROGEM_JS, MAT_SLUG: MAT_SLUG
  };
  return api;
});
