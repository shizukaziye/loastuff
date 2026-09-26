/**
 * tools.js — THE list of Loseii tools. Edit a tool's name, address or blurb here first.
 *
 *   window.LOSEII_TOOLS = { groups: [ { label, items: [ item, … ] }, … ] }
 *
 *   item = {
 *     name:    the tool's one name, everywhere (nav, hub card, page <title>)
 *     url:     its absolute address
 *     kind:    "profiles" | "calculator" | "market" | "community" | "recap" | "analyzer" | "planner"
 *     blurb:   one line on what it does (README, future cards)
 *     keyword: the word(s) the hub's meta description must name it by
 *     live:    true = counts toward the hub's "N live tools" pill
 *   }
 *
 * The groups are the nav's groups, in the nav's order. The LOA ON 2026 Summer page is a
 * recap of a showcase, not a tool: it is listed (the nav and the hub link it) but has
 * live:false, so the pill does not count it.
 *
 * Other copies that must agree, all checked by `npm run check` (tools/check-tools.mjs):
 *   nav.js           its inline GROUPS (name + url). `node tools/check-tools.mjs --write`
 *                    rewrites that block from this file.
 *   index.html       one hub card per item (h3 = name, href = url), the pill's count,
 *                    and the meta description (every live item's keyword)
 *   each tool page   <title> contains the name and ends in " — Loseii"
 *                    (for tools on www.loseii.com with their own page)
 */
(function (root) {
  "use strict";
  root.LOSEII_TOOLS = {
    groups: [
      {
        label: "Lost Ark",
        items: [
          { name: "Character Profiles", url: "https://www.loseii.com/#find", kind: "profiles", keyword: "profiles",
            blurb: "Any NA or EU character: bracelet and astrogem grades and board ranks, one click into either calculator.", live: true },
          { name: "Accessory Value Calculator", url: "https://www.loseii.com/lost-ark-accessories/", kind: "calculator", keyword: "accessory",
            blurb: "Score any accessory by its real % damage gain and see what it is worth.", live: true },
          { name: "Astrogem Calculator", url: "https://www.loseii.com/loa-astrogem-calc/", kind: "calculator", keyword: "astrogem",
            blurb: "Cut / fuse / throw pipeline tables, a screenshot advisor, a grader and a leaderboard.", live: true },
          { name: "Bracelet Calculator", url: "https://www.loseii.com/loa-bracelet-calc/", kind: "calculator", keyword: "bracelet",
            blurb: "Score any T4 bracelet in % damage and get the exact lock-and-reroll play.", live: true },
          { name: "Stronghold Crafting Profit", url: "https://www.loseii.com/loa-crafting-calculator/", kind: "market", keyword: "crafting",
            blurb: "Every stronghold craft ranked by net gold, gold/hour and ROI from live prices.", live: true },
          { name: "Deal Finder", url: "https://www.loseii.com/loa-deal-finder/", kind: "market", keyword: "deal finder",
            blurb: "Market items ranked by how far they sit below a robust 14-day fair price.", live: true },
          { name: "GPD Chart", url: "https://www.loseii.com/loa-gpd/", kind: "calculator", keyword: "GPD",
            blurb: "Every progression system priced per 1% damage on one scale, support and DPS.", live: true },
          { name: "Hell Key Calculator", url: "https://www.loseii.com/loa-hell-key-calc/", kind: "calculator", keyword: "hell key",
            blurb: "Gold value of Paradise Hell keys: the middle jump, the altar, a season of keys.", live: true },
          { name: "LOA ON Bingo", url: "https://loa-on-bingo.shizukaziye.workers.dev/", kind: "community", keyword: "bingo",
            blurb: "Live multiplayer watch-party bingo for LOA ON broadcasts.", live: true },
          { name: "LOA ON 2026 Summer", url: "https://www.loseii.com/loa-on-2026-summer/", kind: "recap", keyword: "",
            blurb: "A recap of the announcements from the LOA ON 2026 Summer showcase.", live: false }
        ]
      },
      {
        label: "League of Legends",
        items: [
          { name: "Champion Pool Coverage", url: "https://shizukaziye.github.io/lol-pool-coverage/", kind: "analyzer", keyword: "champion pool",
            blurb: "Your champion pool against the live meta: best adds, cuts and blind picks.", live: true }
        ]
      },
      {
        label: "Finance",
        items: [
          { name: "FIRE Calculator", url: "https://shizukaziye.github.io/fire-calculator/", kind: "planner", keyword: "FIRE",
            blurb: "Financial independence planner: fixed-return, historical and Monte-Carlo modes.", live: true }
        ]
      }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
