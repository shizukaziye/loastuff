/**
 * bible-import.js — the CHARACTER panel: pull a bracelet off a character the same
 * way the astrogem calculator's Grader pulls a gem loadout.
 *
 * This is a PORT of loa-astrogem-calc/grader.js's pull experience, kept as close
 * to it as the subject allows. What came over, function for function:
 *
 *   tabMarkup()          -> panelMarkup()      the mode pills, the pull row, the
 *                                              status line, the free-tier note and
 *                                              the saved-character grid
 *   renderAuth()         -> renderAuth()       sign in / load my characters / sign out,
 *                                              riding at the END of the mode row
 *   renderFavRow()       -> renderFavRow()     one row per saved character: ★ to
 *                                              unsave, class icon, name, region badge
 *   runPull()            -> runPull()          the four branches: unavailable ·
 *                                              data · queued · error
 *   startQueueWatch()    -> startQueueWatch()  the three mechanisms — a 1s local
 *                                              countdown at the drain rate, a 30s
 *                                              server re-sync, and a /wait long poll
 *   showQueued() / showRefreshBanner()         the queued panel, and the thin bar that
 *                                              rides ABOVE a cached bracelet instead
 *                                              of blanking it
 *   fillFieldRank()      -> fieldRank()        the board's own letter, 0-100 and
 *                                              place: "#57 of 1,299 on EU · top 4.4%
 *                                              · #6 of 40 Deathblades", read off
 *                                              the live board (see "the board")
 *   loadRosters() / favoriteRoster()           sign-in -> roster -> Favorites.add each
 *   setPullStatus() / syncSourceUI() / setFreeStatus()
 *   maybeAutoRepullForCp -> maybeAutoRepullForProfile()
 *
 * WHAT IS DIFFERENT, AND WHY
 *   - Astrogem's second mode is a live gem form ("Custom input"). Ours is "Manual
 *     entry", which is a pointer at the bracelet panel below — the bracelet form
 *     already exists and is the tool's main surface, so duplicating it would be
 *     two editors for one bracelet.
 *   - Astrogem's Raid/Chaos preset pills grade two gem sets. We have the same axis
 *     for real — a lostark.bible character page carries one loadout per tab, each
 *     with its OWN bracelet, and 9 of the 30 seeded characters wear different ones
 *     — so the loadout pills take that slot, with the same segmented-pill look.
 *   - Astrogem blanks its result pane for the "queued" panel. Ours never blanks the
 *     calculator: the queued panel and the refresh bar both live in their own host
 *     above the character banner.
 *   - THE WORKER IS NOT DEPLOYED (WORKER_URL is ""). The whole pull path is built
 *     and waits on one string. Until then the 30 characters baked into
 *     data/leaderboard-seed.json load instantly, by chip or by name, so the panel
 *     is useful today.
 *
 * WHAT IT TALKS TO
 *   window.BibleOAuth      bible-oauth.js — PKCE sign-in, GET /api/oauth/rosters
 *   window.Bracelet        model/bracelet.js — decodeBibleBracelet(stats) and the
 *                          canonical-default scorer behind the board figure
 *   window.Favorites       favorites.js — the saved-character spine
 *   window.BraceletApp     app.js — applyImport(patch), the one hook into the UI
 *   WORKER_URL             worker/bracelet.js — the only thing allowed to touch a
 *                          lostark.bible character page, and only with the token
 *   data/leaderboard-seed.json — the baked board, used as a free instant cache
 *
 * NETWORK RULE, ABSOLUTE. The browser NEVER fetches a lostark.bible character page.
 * The only direct calls to that host are BibleOAuth's /oauth/* and /api/oauth/* with
 * the Bearer header. Raid statistics are never touched.
 *
 * SIGNING IN IS OPTIONAL, SINCE 2026-08-11. Anyone can type a name and get a
 * bracelet; the Worker fetches the page with the visitor's own token when there is
 * one and with its own secret when there is not. Signing in still buys two real
 * things — "Load my characters" fills the saved grid in one click, and the pull is
 * attributed to the human who asked for it rather than to Shizu's secret — so the
 * button stays. It must never be a WALL: no branch here may refuse a lookup for
 * want of a sign-in. Why that is the policy, and what would reverse it, is in
 * worker/bracelet.js's header and docs/design/ARCHITECTURE.md §0.3.
 *
 * THE SHAPE PROBLEM (still true for the roster payload). /api/oauth/rosters is an
 * INDEX — name, class, ilvl, lastUpdate, with region on the ROSTER — so nothing here
 * keys off a field name it has not seen. `findCharacters` and `findBracelet` walk
 * whatever JSON arrives looking for shapes rather than paths, and
 * `BraceletImport.dumpShape()` prints the real key paths. See
 * docs/research/oauth-rosters-shape.md.
 *
 * TWO SCORES, AND THEY DIFFER. Everything called a board figure here is the bracelet
 * on the CANONICAL DEFAULT profile, Bracelet.normalizeProfile({}) — the only number
 * the leaderboard ever ranks on. The calculator below scores the same bracelet on the
 * user's own settings. Both are on screen and the copy says which is which; an
 * imported profile must never be allowed to move a leaderboard number.
 */
(function (root) {
  "use strict";

  var OA = root.BibleOAuth;
  var B = root.Bracelet;
  var DATA = root.BraceletData;
  if (!OA || !B || !DATA) return;               // a dependency failed to load; leave the panel alone

  /**
   * The deployed bracelet-bible Worker (worker/bracelet.js), live 2026-08-11.
   *
   * Empty is still a supported state, not a bug: the seeded characters load
   * instantly by chip or by name, signing in and listing characters still works,
   * and a live pull lands on one honest sentence rather than a broken request.
   * So blanking this line is the whole kill switch.
   */
  var WORKER_URL = "https://bracelet-bible.shizukaziye.workers.dev";

  /** The baked board, used as a free instant cache. ?v= for the edge, as everywhere. */
  // The board seed split (2026-08-15): leaderboard-seed.json is now a slim
  // summary payload with no raw stats, so the instant-cache reads the full
  // per-character store instead.
  var SEED_URL = "data/characters.json?v=1";

  // One silent re-auth per page load. A dead token sends the user straight back
  // through /oauth/authorize, which auto-approves while the grant lives — but if
  // that comes back dead too, a second bounce would loop the browser forever.
  var REAUTH_FLAG = "bc_bible_reauth";
  var LAST_KEY = "bc_bi_last";      // localStorage: {region, name}, prefills next visit

  var MOUNT_ID = "bc-import";
  var REGIONS = ["NA", "EU"];
  // A fresh T4 bracelet's allowance: 4 rolls and 3 reconversion-ticket rolls
  // (docs/research/mechanics-bible-leaderboard.md). lostark.bible's numRerolls
  // and numTicketRerolls are the counts USED against it, so 4 and 3 is a
  // bracelet with nothing left — Paroxysmal's, 2026-09-25.
  var ROLLS_BASE = 4, ROLLS_TICKET = 3;
  /** Rolls left from the two used-counts; null when the record carries neither. */
  function rollsLeftOf(nr, nt) {
    var a = (typeof nr === "number" && isFinite(nr)) ? nr : null;
    var b = (typeof nt === "number" && isFinite(nt)) ? nt : null;
    if (a === null && b === null) return null;
    return Math.max(0, ROLLS_BASE - (a || 0)) + Math.max(0, ROLLS_TICKET - (b || 0));
  }

  var state = {
    mode: "pull",      // "pull" | "manual"
    busy: false,
    error: null,       // {kind, detail, who}
    user: null,
    chars: null,       // roster index: [{name, cls, ilvl, region, node}]
    raw: null,         // the last rosters payload, for dumpShape()
    picked: null,      // name of the character last imported
    note: null,        // a one-line result under the list
    // A character wears one bracelet PER LOADOUT on lostark.bible — a raid one,
    // a chaos-dungeon one, sometimes an estimated-raid one — and nine of the
    // thirty characters read so far wear a DIFFERENT bracelet in each. So the
    // panel offers them all instead of deciding for the user.
    loadouts: null,    // [{classification, label, stats, rollsLeft, pct, grade, isRendered}]
    loadoutIdx: 0,     // which one is in the calculator right now
    bestLoadout: 0,    // the highest, which is what the board ranks
    record: null       // the whole character record on screen
  };

  // ------------------------------------------------------------------
  // shape-blind walkers
  // ------------------------------------------------------------------

  function isObj(v) { return v && typeof v === "object"; }

  /** Depth-limited, cycle-guarded walk. fn(node, key, path) on every object. */
  function walk(root_, fn) {
    var seen = [], out = [];
    (function rec(node, path, depth) {
      if (!isObj(node) || depth > 8) return;
      if (seen.indexOf(node) >= 0) return;
      seen.push(node);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 400; i++) rec(node[i], path + "[]", depth + 1);
        return;
      }
      var r = fn(node, path);
      if (r) out.push(r);
      for (var k in node) if (Object.prototype.hasOwnProperty.call(node, k)) {
        rec(node[k], path ? path + "." + k : k, depth + 1);
      }
    })(root_, "", 0);
    return out;
  }

  /** Every distinct key path in a payload — what dumpShape() reports. */
  function keyPaths(v, prefix, out, depth) {
    out = out || []; depth = depth || 0;
    if (depth > 8) return out;
    if (Array.isArray(v)) {
      if (v.length) keyPaths(v[0], prefix + "[]", out, depth + 1);
    } else if (isObj(v)) {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
        var p = prefix ? prefix + "." + k : k;
        if (out.indexOf(p) < 0) out.push(p);
        keyPaths(v[k], p, out, depth + 1);
      }
    }
    return out;
  }

  /**
   * Does this array look like lostark.bible's bracelet `stats`? Every entry is
   * {type, index, value} with numeric type and index. Two entries minimum, so a
   * one-element coincidence somewhere else in the payload can't win.
   */
  function looksLikeStats(a) {
    if (!Array.isArray(a) || a.length < 2) return false;
    for (var i = 0; i < a.length; i++) {
      var e = a[i];
      if (!isObj(e) || typeof e.type !== "number" || typeof e.index !== "number") return false;
    }
    return true;
  }

  /**
   * Find the bracelet inside one character node. Three shapes, most explicit
   * first — the documented character-page payload is
   * {slot:"bracelet", data:{type:"bracelet", stats:[…], numRerolls, numTicketRerolls}}.
   */
  function findBracelet(node) {
    var hits = walk(node, function (n) {
      var slot = String(n.slot || "").toLowerCase();
      var type = String(n.type || "").toLowerCase();
      if (slot === "bracelet" && isObj(n.data) && looksLikeStats(n.data.stats)) return { d: n.data, sure: 3 };
      if (type === "bracelet" && looksLikeStats(n.stats)) return { d: n, sure: 2 };
      if ((slot === "bracelet" || type === "bracelet") && looksLikeStats(n.stats)) return { d: n, sure: 2 };
      if (looksLikeStats(n.stats) && n.numRerolls !== undefined) return { d: n, sure: 1 };
      return null;
    });
    hits.sort(function (a, b) { return b.sure - a.sure; });
    return hits.length ? hits[0].d : null;
  }

  function firstString(n, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = n[keys[i]];
      if (typeof v === "string" && v) return v;
      if (isObj(v) && typeof v.name === "string" && v.name) return v.name;
    }
    return "";
  }
  function firstNumber(n, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = n[keys[i]];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string" && /^[\d.,]+$/.test(v)) return parseFloat(v.replace(/,/g, ""));
    }
    return null;
  }

  /**
   * /api/oauth/rosters names classes with the game's internal codes
   * ("devil_hunter_female"), not the English name a player recognises. The first
   * nine rows were confirmed 2026-08-11 by joining the live payload against the
   * character pages — docs/research/oauth-rosters-shape.md has the table and the
   * working. The rest are astrogem's own CLASS_SLUG map, which follows the same
   * Korean-original naming and is UNVERIFIED; a code that is wrong shows the wrong
   * NAME, never a wrong icon, because the icon is looked up by file and a miss
   * renders nothing.
   *
   * An unknown code is title-cased, never dropped: "Devil Hunter Male" on screen
   * is a bug report, a blank is a shrug.
   */
  var CLASS_NAME = {
    // verified
    arcana: "Arcanist", berserker: "Berserker", blade: "Deathblade",
    devil_hunter_female: "Gunslinger", dragon_knight: "Guardianknight",
    alchemist: "Wildsoul", reaper: "Reaper", soul_eater: "Souleater", bard: "Bard",
    // unverified, from loa-astrogem-calc/grader.js CLASS_SLUG
    warrior: "Berserker", destroyer: "Destroyer", warlord: "Gunlancer", holyknight: "Paladin",
    berserker_female: "Slayer", valkyrie: "Valkyrie",
    battle_master: "Wardancer", infighter: "Scrapper", force_master: "Soulfist",
    lance_master: "Glaivier", battle_master_male: "Striker", infighter_male: "Breaker",
    devil_hunter: "Deadeye", devil_hunter_male: "Deadeye", blaster: "Artillerist",
    hawk_eye: "Sharpshooter", scouter: "Machinist",
    summoner: "Summoner", elemental_master: "Sorceress", demonic: "Shadowhunter",
    weather_artist: "Aeromancer", yinyangshi: "Artist"
  };
  function classLabel(code) {
    if (!code) return "";
    var k = String(code).toLowerCase();
    if (CLASS_NAME[k]) return CLASS_NAME[k];
    return k.split("_").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }

  var CLASS_KEYS = ["class", "className", "characterClassName", "job", "jobName", "classId"];
  var ILVL_KEYS = ["itemLevel", "ilvl", "itemMaxLevel", "gearScore", "level", "itemAvgLevel"];
  var REGION_KEYS = ["region", "world", "server", "serverName", "worldName"];
  var CONTAINER_KEYS = /^(characters|chars|members|roster|rosters)$/i;

  /**
   * A roster has a name too, and the bracelet of every character it holds sits
   * somewhere underneath it — so "carries a bracelet" alone would promote the
   * roster to a character. Anything holding a list of characters is a container.
   */
  function isContainer(n) {
    for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) {
      if (CONTAINER_KEYS.test(k) && Array.isArray(n[k]) && n[k].length && isObj(n[k][0])) return true;
    }
    return false;
  }

  /** Every character-looking object in the payload, deduped by name. */
  function findCharacters(payload) {
    var byName = {}, out = [];
    walk(payload, function (n, path) {
      if (typeof n.name !== "string" || !n.name) return null;
      if (isContainer(n)) return null;
      var cls = firstString(n, CLASS_KEYS);
      var ilvl = firstNumber(n, ILVL_KEYS);
      // A bare {name} is a roster label, a server, an owner — not a character.
      if (!cls && ilvl === null && !findBracelet(n)) return null;
      var key = n.name.toLowerCase();
      if (byName[key]) return null;
      byName[key] = 1;
      out.push({
        name: n.name,
        cls: cls,
        ilvl: ilvl,
        region: firstString(n, REGION_KEYS),
        path: path,
        node: n
      });
      return null;
    });
    return out;
  }

  // ------------------------------------------------------------------
  // decode -> the patch app.js applies
  // ------------------------------------------------------------------

  // decodeBibleBracelet names the Swiftness trait the way the official table
  // does; app.js's three trait rows call it "swift". Crit and Spec already agree.
  var TRAIT_TO_APP = { crit: "crit", spec: "spec", swiftness: "swift" };

  function slotChoices(grade) { return grade === "relic" ? [1, 2] : [2, 3]; }

  function rowFor(line) {
    if (line.cat === "basic") {
      return { fam: "basic:" + line.family, tier: "mid", value: line.value };
    }
    if (line.cat === "trait") {
      return { fam: "trait:" + line.family, tier: "mid", value: null };
    }
    if (line.cat === "special") {
      return { fam: "sp:" + line.family, tier: line.tier || "mid", value: null };
    }
    return null;
  }

  /**
   * Combat-trait caps: Relic 100, Ancient 120. A bracelet showing Crit +116 is
   * not Relic whatever else says otherwise — 63 brackets read off character
   * pages top out at 119 and none passes 120.
   */
  var TRAIT_CAP = { relic: 100, ancient: 120 };
  function traitsBreakCap(dec, grade) {
    for (var i = 0; i < dec.lines.length; i++) {
      var l = dec.lines[i];
      if (l.cat === "trait" && l.value > TRAIT_CAP[grade]) return true;
    }
    return false;
  }

  /**
   * The decoder guesses Relic or Ancient by matching special-effect values
   * against both tables, and the two tables overlap enough that it can land on
   * the wrong one. Two further witnesses settle it, strongest first:
   *
   *   1. the combat-trait cap above — a fact about the item;
   *   2. the granted-slot count (Ancient 2–3, Relic 1–2) — a guess about the
   *      player, because locking granted lines is allowed and four of the thirty
   *      seeded characters lock four of five, leaving one granted line that
   *      reads as Relic while they wear Crit +116.
   *
   * A grade change is a RE-DECODE, not a relabel: tiers have to come from the
   * right value table.
   */
  function decodeWithGradeCheck(stats) {
    var dec = B.decodeBibleBracelet(stats), i;

    // The cap is a hard fact about the item; the slot count is a guess about how
    // the player has been playing. The fact wins.
    if (traitsBreakCap(dec, dec.grade)) {
      var forced = dec.grade === "relic" ? "ancient" : "relic";
      var fdec = B.decodeBibleBracelet(stats, { grade: forced });
      if (!traitsBreakCap(fdec, forced)) return fdec;
    }

    var granted = 0;
    for (i = 0; i < dec.lines.length; i++) if (!dec.lines[i].fixed) granted++;
    if (slotChoices(dec.grade).indexOf(granted) >= 0) return dec;
    var other = dec.grade === "relic" ? "ancient" : "relic";
    if (slotChoices(other).indexOf(granted) < 0) return dec;   // fits neither; leave the guess alone
    var alt = B.decodeBibleBracelet(stats, { grade: other });
    if (traitsBreakCap(alt, other)) return dec;                // the slot count is the thing that is wrong
    // The slot count is the weakest witness: refuse the switch when the other
    // grade's table cannot place a line this one placed (Crit Damage +10% exists
    // on Ancient and not on Relic). The Worker's own decode has this guard, and
    // the loader has to agree with it or the board and the Grader read one
    // bracelet as two grades.
    if (unplaced(alt) > unplaced(dec)) return dec;
    return alt;
  }

  /** Lines a grade's value table could not place: no tier, or a value off the table. */
  function unplaced(dec) {
    var n = 0, i, l;
    for (i = 0; i < dec.lines.length; i++) {
      l = dec.lines[i];
      if (l.cat === "special" && (!l.tier || l.unmatchedValue)) n++;
    }
    return n;
  }

  /**
   * decodeBibleBracelet's lines -> the state patch app.js merges.
   * Fixed lines split two ways: a Crit / Spec / Swiftness trait is one of the two
   * combat traits the panel shows at the top, anything else is a fixed line in
   * the Advanced fold. Unlocked lines are the granted slots.
   */
  function buildPatch(data) {
    var dec = decodeWithGradeCheck(data.stats || []);
    var grade = dec.grade;
    var traits = { crit: { on: false, v: 120 }, spec: { on: false, v: 120 }, swift: { on: false, v: 120 } };
    var traitOrder = [], rows = [], fixedRows = [], locks = [], warn = [];
    var i, line, r;

    // EVERY combat-trait line is one of the two combat traits, whatever the
    // padlock says. `fixed` is bible's LOCK icon, not the drop's fixed/granted
    // split (see the note below) — Tikkyy's Spec 118 carried no padlock, so
    // this loop used to send it to a granted row and the panel invented a
    // default Spec 120 in its place (Shizu, 2026-09-24: "the spec is not in
    // the first 2 rolls"). The worker's scorer split on `cat` already; the
    // loader now does the same. A third trait line — one rolled into a
    // granted slot — stays a granted row, since only two places exist.
    for (i = 0; i < dec.lines.length; i++) {
      line = dec.lines[i];
      if (line.cat === "trait" && TRAIT_TO_APP[line.family] && traitOrder.length < 2 &&
          traitOrder.indexOf(TRAIT_TO_APP[line.family]) < 0) {
        var tk = TRAIT_TO_APP[line.family];
        traits[tk] = { on: true, v: Math.round(line.value) };
        traitOrder.push(tk);
        continue;
      }
      r = rowFor(line);
      if (!r) continue;
      if (line.unmatchedValue) warn.push("a special effect whose value matched no tier");
      // `fixed` on a lostark.bible line means LOCKED — the blue padlock the player
      // set before a reroll — NOT the drop's fixed lines. It is routinely true on
      // three or four lines, which no drop can produce. Sorting locked lines into
      // fixedRows put them outside the granted set and left real slots empty, so
      // the solver refused the bracelet as half-filled. Every non-trait line is a
      // granted line; the padlock becomes a LOCK, which is what it is.
      rows.push(r);
      if (line.fixed) locks.push(rows.length - 1);
    }

    // The panel always shows exactly two combat traits. A bracelet that reported
    // fewer keeps the defaults switched on so the score stays sane; app.js's own
    // fitTraits() would do it anyway, this just picks a sensible pair.
    while (traitOrder.length < 2) {
      var fill = traitOrder.indexOf("crit") < 0 ? "crit" : (traitOrder.indexOf("spec") < 0 ? "spec" : "swift");
      traits[fill].on = true;
      traitOrder.push(fill);
      warn.push("only " + (traitOrder.length - 1) + " combat trait came back, so the panel kept its own second one");
    }
    while (traitOrder.length > 2) { traits[traitOrder.shift()].on = false; }

    if (fixedRows.length > 2) { fixedRows.length = 2; warn.push("more than two fixed lines came back"); }

    var choices = slotChoices(grade);
    var slots = rows.length;
    if (choices.indexOf(slots) < 0) {
      slots = slots < choices[0] ? choices[0] : choices[choices.length - 1];
      // Padding up is harmless — an empty row IS an empty slot. Cutting down is
      // not, so do it here and say which lines went rather than letting app.js
      // trim the tail quietly.
      if (rows.length > slots) {
        warn.push("the bracelet reported " + rows.length + " granted lines, more than " +
          (grade === "relic" ? "Relic" : "Ancient") + " allows, so the last " +
          (rows.length - slots) + " went unread");
        rows.length = slots;
      }
    }

    var patch = {
      grade: grade,
      slots: slots,
      traits: traits,
      traitOrder: traitOrder,
      rows: rows,
      fixedRows: fixedRows,
      lockedIdx: locks
    };

    // ROLLS LEFT. A caller that knows it passes rollsLeft. Otherwise numRerolls
    // and numTicketRerolls are lostark.bible's own fields, and they count the
    // rolls USED, not the rolls left: 4 and 3 is a fully rolled bracelet. This
    // file read them the other way round until 2026-09-25, so every finished
    // bracelet arrived with 7 rolls (Shizu: "for paroxysmal im pretty sure there
    // are no rolls remaining").
    var rl = firstNumber(data, ["rollsLeft"]);
    if (rl === null) rl = rollsLeftOf(firstNumber(data, ["numRerolls"]), firstNumber(data, ["numTicketRerolls"]));
    if (rl !== null) patch.rollsLeft = Math.max(0, Math.min(20, Math.round(rl)));

    if (dec.unknown && dec.unknown.length) {
      warn.push(dec.unknown.length + " line" + (dec.unknown.length > 1 ? "s" : "") +
        " used an index the decoder does not map yet, so " +
        (dec.unknown.length > 1 ? "they were" : "it was") + " left out");
    }
    return { patch: patch, warn: warn, decoded: dec };
  }

  // ------------------------------------------------------------------
  // the board figure — the bracelet on the CANONICAL DEFAULT profile
  //
  // The Worker's boardScore(), step for step: every combat-trait line (on `cat`,
  // never on `fixed`) into the trait pair, every other line an effect line, and
  // the two scored in ONE pool — jointScore for the damage %, subrank's
  // braceletScore for the 0-100. It used to sum traitDamage and setDamage, the
  // pre-pooling arithmetic, which read a crit-heavy bracelet high: Tikkyy's
  // 12.24% here against 12.14% on the board, and a loadout marker that could
  // point at a different loadout than the board ranks. The duplication is
  // deliberate — the Worker bundles the model and this panel loads it — and the
  // MODEL is still the only place damage is scored.
  // ------------------------------------------------------------------

  var DEFAULT_PROFILE = B.normalizeProfile({});
  var SUPPORT_PROFILE = B.normalizeProfile({ role: "support" });

  /** The Worker's SUPPORT_CLASSES: the four read a second time, as supports. */
  var SUPPORT_CLASSES = { bard: 1, paladin: 1, artist: 1, valkyrie: 1 };
  function isSupportClass(cls) {
    return !!SUPPORT_CLASSES[String(cls == null ? "" : cls).replace(/[^A-Za-z]/g, "").toLowerCase()];
  }

  /**
   * One bracelet's board reading on one role: {role, grade, pct, score,
   * isPerfect}, or null. The support reading is scored on the support profile
   * and graded on the support ladder, exactly as the Worker reads it.
   */
  function boardReading(stats, role) {
    var SR = root.Subrank;
    if (!stats || !stats.length) return null;
    var dec, i, l, k;
    try { dec = decodeWithGradeCheck(stats); } catch (e) { return null; }
    var sup = role === "support", prof = sup ? SUPPORT_PROFILE : DEFAULT_PROFILE;
    var traits = { crit: 0, spec: 0, swift: 0 }, lines = [];
    for (i = 0; i < dec.lines.length; i++) {
      l = dec.lines[i];
      k = TRAIT_TO_APP[l.family];
      if (l.cat === "trait" && k) { traits[k] = l.value; continue; }
      lines.push(l);
    }
    var p = B.damagePercent(B.jointScore(lines, traits, dec.grade, prof));
    if (typeof p !== "number" || !isFinite(p)) return null;
    // null, not DEFAULT_PROFILE, is what hits subrank's anchor cache — the
    // Worker passes the same.
    var g = SR ? SR.braceletScore({ lines: lines, traits: traits, grade: dec.grade, profile: sup ? SUPPORT_PROFILE : null }) : null;
    return { role: sup ? "support" : "dps", grade: dec.grade, pct: p, score: g ? g.score : null,
      isPerfect: !!(g && g.isPerfect), unmapped: (dec.unknown || []).length };
  }

  /** The damage-dealer reading's figure, for the loadout pills and the ▲ marker. */
  function defaultScore(stats) {
    var r = boardReading(stats, "dps");
    return r ? { grade: r.grade, pct: r.pct, score: r.score, unmapped: r.unmapped } : null;
  }

  // ------------------------------------------------------------------
  // small helpers
  // ------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function nf(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fx(n, d) { return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function charKey(region, name) {
    return String(region || "").toUpperCase() + "|" + String(name || "").trim().toLowerCase();
  }

  /**
   * lostark.bible calls EU Central "CE". A roster payload might say anything —
   * "EU", a server name, or nothing at all — so map what we recognise and return
   * "" for the rest rather than guessing a region and fetching a stranger's page.
   */
  function bibleRegion(r) {
    var s = String(r || "").trim().toUpperCase();
    if (!s) return "";
    if (s === "NA" || s === "NAE" || s === "NAW" || s === "US" || s === "NORTH AMERICA") return "NA";
    if (s === "CE" || s === "EU" || s === "EUC" || s === "EUROPE" ||
        s === "CENTRAL EUROPE" || s === "EU CENTRAL") return "CE";
    return "";
  }
  /**
   * The region a PERSON reads, for the header chip and the Favorites key. Bible
   * calls central Europe CE in its URLs; every store here says EU, healed in one
   * place so a character cannot be favourited twice under two names.
   */
  function normRegion(r) {
    var s = bibleRegion(r);
    return s === "CE" ? "EU" : s;
  }

  /**
   * The class glyph, from the site's shared set (/shared/class-icon.js, loaded by
   * index.html): a class with no file gets NO icon rather than a wrong one.
   */
  function classIconHtml(cls) {
    var src = cls && window.classIconUrl ? window.classIconUrl(cls) : null;
    if (!src) return "";
    return '<img class="bi-classicon" src="' + src +
      '" alt="" aria-hidden="true" loading="lazy" onerror="this.style.display=\'none\'">';
  }

  /** Raw error text ("Failed to fetch", "http_502") means nothing to a player; say it plainly. */
  function plainError(e) {
    var m = String((e && (e.error || e.message)) || e || "");
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "the server could not be reached";
    var h = /^http_(\d+)$/.exec(m);
    if (h) return "the server answered with an error (" + h[1] + ")";
    return m || "no answer";
  }

  // ------------------------------------------------------------------
  // THE BOARD — every tracked character, read the way the leaderboard and the
  // profile read them
  //
  // GET {WORKER}/list: the v3 summary the Leaderboard tab and the profile page
  // both draw. One row per character with the Worker's finished numbers on the
  // CANONICAL default profile — damage % and the 0-100 grade, both readings for
  // a support class — decoded here exactly as leaderboard.js decodes it. It
  // feeds the character search (every tracked name, not the 59 baked ones), the
  // class icons on saved chips, and the banner's Board rank.
  //
  // KEPT, BECAUSE IT IS THROTTLED. The Worker allows three list fetches a
  // minute per IP and this panel asks at mount, so an answer is kept ten
  // minutes in memory and in localStorage, and asks that overlap share one
  // request. A throttle or an outage falls back to the last copy kept, however
  // old, and only then to the characters baked into this build
  // (data/characters.json), scored here the way the Worker scores a row.
  //
  // A LIVE ROW IS NOT A RECORD. It carries a bracelet's summary, not its stats,
  // so runPull still asks the Worker for the character itself; only the baked
  // copy, which does carry the stats, doubles as a load cache (seedHit).
  // ------------------------------------------------------------------

  var BOARD_TTL_MS = 10 * 60 * 1000;
  var BOARD_RETRY_MS = 60 * 1000;      // a board that fell back to the baked copy asks the Worker again after this
  var BOARD_KEY = "bc_board_v3";       // localStorage: {at, data} — the raw v3 payload
  var boardMem = null, boardLoad = null, boardFailAt = 0;

  /**
   * Can this copy answer without a request? A fresh live or kept copy can. So
   * can ANY copy for a minute after a fetch failed: a throttled Worker asked
   * again at once only stays throttled, and three asks a minute is its limit.
   */
  function boardUsable(b) {
    if (!b) return false;
    if (Date.now() - boardFailAt < BOARD_RETRY_MS) return true;
    return b.source !== "baked" && !b.stale && Date.now() - b.fetchedAt < BOARD_TTL_MS;
  }

  /**
   * board() -> Promise({list, byKey, lists, source, builtAt, fetchedAt, stale})
   *   list      every row: {region, name, class, itemLevel, pulledAt, grade, role,
   *             pct, score, isPerfect, dps, sup, source, ord, loadouts}
   *   byKey     "REGION|name" -> row (charKey; CE is EU)
   *   lists     {NA:{dps, support}, EU:{dps, support}} — each board in its order
   *   source    "live" (just fetched), "kept" (localStorage), "baked" (this build)
   *   stale     true when the copy is older than the Worker would have served
   * Never rejects: the baked board is the floor.
   */
  function board() {
    if (boardUsable(boardMem)) return Promise.resolve(boardMem);
    if (boardLoad) return boardLoad;
    var kept = readKeptBoard();
    if (kept && Date.now() - kept.at < BOARD_TTL_MS && (!boardMem || boardMem.fetchedAt < kept.at)) {
      boardMem = buildBoard(kept.data, kept.at, "kept");
      return Promise.resolve(boardMem);
    }
    boardLoad = fetchBoard().then(function (data) {
      var at = Date.now();
      keepBoard(data, at);
      boardMem = buildBoard(data, at, "live");
      return boardMem;
    }).catch(function () {
      // A throttle (429), an outage or no network. The last copy kept is a real
      // board a little behind; the baked one is older still, but it is a board.
      boardFailAt = Date.now();
      if (boardMem && boardMem.source !== "baked") { boardMem.stale = true; return boardMem; }
      if (kept) { boardMem = buildBoard(kept.data, kept.at, "kept"); boardMem.stale = true; return boardMem; }
      return bakedBoard().then(function (b) { boardMem = b; return b; });
    }).then(function (b) { boardLoad = null; return b; });
    return boardLoad;
  }

  /** The Worker's /list, or a rejection. Readable means v3 with at least one row. */
  function fetchBoard() {
    if (!WORKER_URL) return Promise.reject(new Error("no worker"));
    return fetch(WORKER_URL.replace(/\/+$/, "") + "/list").then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = JSON.parse(t); } catch (e) { d = null; }
        if (r.ok && boardReadable(d)) return d;
        throw new Error((d && (d.message || d.error)) || ("the board answered " + r.status));
      });
    });
  }
  function boardReadable(d) { return !!(d && d.v === 3 && Array.isArray(d.characters) && d.characters.length); }

  function readKeptBoard() {
    var raw = null, k = null;
    try { raw = localStorage.getItem(BOARD_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { k = JSON.parse(raw); } catch (e) { return null; }
    return (k && typeof k.at === "number" && boardReadable(k.data)) ? k : null;
  }
  function keepBoard(data, at) {
    // Half a megabyte of JSON. A full store costs the copy, never the board.
    try { localStorage.setItem(BOARD_KEY, JSON.stringify({ at: at, data: data })); } catch (e) { /* quota or private mode */ }
  }

  // leaderboard.js's decode tables — the v3 row's codes, in the Worker's order.
  var BOARD_CATS = ["special", "basic", "trait"], BOARD_TIERS = ["low", "mid", "high"];
  var BOARD_BASIC = ["mainStat", "vitality"], BOARD_TRAITS = ["crit", "spec", "swiftness"];

  /**
   * The v3 payload -> the board. leaderboard.js's fromSnapshot(), field for
   * field: [region, name, ilvl, classIdx, pulledAt, grade, role, [pct, score,
   * isPerfect], alt, traits, lines, unmapped, loadouts]. Slot 6 says which
   * reading the Worker's better-letter rule showed, slot 7 is that one and slot
   * 8 the other, so the two are filed by AXIS, as the leaderboard files them.
   */
  function buildBoard(data, at, source) {
    var classes = data.classes || [], rows = [], i, a;
    for (i = 0; i < data.characters.length; i++) {
      a = data.characters[i];
      var read = a[7] || [], alt = a[8];
      var won = { pct: typeof read[0] === "number" ? read[0] : null, score: typeof read[1] === "number" ? read[1] : null, isPerfect: !!read[2] };
      var lost = (alt && typeof alt[0] === "number") ? { pct: alt[0], score: typeof alt[1] === "number" ? alt[1] : null, isPerfect: false } : null;
      var supWon = a[6] === 1, shown = won;
      rows.push({
        region: normRegion(a[0]) || String(a[0] || ""),
        name: a[1],
        "class": (a[3] != null && a[3] >= 0) ? (classes[a[3]] || null) : null,
        itemLevel: typeof a[2] === "number" ? Math.round(a[2]) : null,
        pulledAt: typeof a[4] === "number" ? a[4] : null,
        grade: a[5] === 1 ? "relic" : "ancient",
        role: supWon ? "support" : "dps",
        dps: supWon ? lost : won,
        sup: supWon ? won : lost,
        pct: shown.pct, score: shown.score, isPerfect: shown.isPerfect,
        traits: boardTraits(a[9]), lines: boardLines(a[10]), unmapped: a[11] || 0,
        source: "board", ord: i,
        loadouts: null                  // a summary, not a record: runPull asks the Worker
      });
    }
    return indexBoard(rows, data.builtAt || 0, at, source);
  }
  function boardLines(flat) {
    var out = [], i, cat, line;
    flat = flat || [];
    for (i = 0; i + 3 < flat.length; i += 4) {
      cat = BOARD_CATS[flat[i]] || "special";
      line = { cat: cat, fixed: !!flat[i + 3], tier: null, value: null, family: null };
      if (cat === "special") { line.family = flat[i + 1]; line.tier = BOARD_TIERS[flat[i + 2]] || null; }
      else { line.family = (cat === "basic" ? BOARD_BASIC : BOARD_TRAITS)[flat[i + 1]] || null; line.value = flat[i + 2]; }
      out.push(line);
    }
    return out;
  }
  function boardTraits(flat) {
    var out = [], i;
    flat = flat || [];
    for (i = 0; i + 1 < flat.length; i += 2) out.push({ family: BOARD_TRAITS[flat[i]] || null, value: flat[i + 1] });
    return out;
  }

  /**
   * leaderboard.js isSupportMain(): a support class whose support reading lands
   * two or more subranks above its damage-dealer one leaves the DPS board.
   */
  function supportMain(r) {
    var SR = root.Subrank;
    if (!SR || !r.sup || !r.dps || r.sup.score == null || r.dps.score == null) return false;
    return SR.of(r.dps.score, "dps").i - SR.of(r.sup.score, "support").i >= 2;
  }

  /**
   * byKey, and each region's two boards in the leaderboard's order — rebuild()
   * with one region chip on and no class filter: DPS is every row with a dealer
   * reading less support mains, Support is the four support classes; each by
   * its own damage %, highest first, ties in payload order.
   */
  function indexBoard(rows, builtAt, at, source) {
    var byKey = {}, lists = {}, i, r, R;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      byKey[charKey(r.region, r.name)] = r;
      R = lists[r.region] || (lists[r.region] = { dps: [], support: [] });
      if (r.dps && !supportMain(r)) R.dps.push(r);
      if (r.sup) R.support.push(r);
    }
    function by(axis) {
      return function (x, y) {
        var a = x[axis] && x[axis].pct != null ? x[axis].pct : -Infinity;
        var b = y[axis] && y[axis].pct != null ? y[axis].pct : -Infinity;
        return (b - a) || (x.ord - y.ord);
      };
    }
    for (R in lists) if (Object.prototype.hasOwnProperty.call(lists, R)) {
      lists[R].dps.sort(by("dps"));
      lists[R].support.sort(by("sup"));
    }
    return { list: rows, byKey: byKey, lists: lists, source: source, builtAt: builtAt, fetchedAt: at, stale: false };
  }

  /**
   * The Worker's snapshotEntry() for a record in this file's own shape: every
   * loadout that wears a DIFFERENT bracelet is scored as a damage dealer and
   * the best one ranks (a tie keeps the loadout lostark.bible draws); a support
   * class is read again as a support, and the better-letter rule picks the
   * reading shown. Null when nothing decodes.
   */
  function boardEntryFromRecord(rec) {
    var SR = root.Subrank;
    if (!rec || !rec.loadouts || !SR) return null;
    var los = rec.loadouts.filter(function (l) { return l && l.stats && l.stats.length; }), i;
    if (!los.length) return null;
    var seen = {}, nDistinct = 0, chosen = 0;
    for (i = 0; i < los.length; i++) {
      var sg = statsSig(los[i].stats);
      if (!seen[sg]) { seen[sg] = 1; nDistinct++; }
      if (los[i].isRendered) chosen = i;
    }
    var cand = (los.length >= 2 && nDistinct >= 2) ? los : [los[chosen]];
    if (cand.length === 1) chosen = 0;
    var best = null, bestPct = -Infinity;
    for (i = 0; i < cand.length; i++) {
      var s = boardReading(cand[i].stats, "dps");
      if (!s) continue;
      if (s.pct > bestPct + 1e-9 || (Math.abs(s.pct - bestPct) < 1e-9 && i === chosen)) { best = { s: s, stats: cand[i].stats }; bestPct = s.pct; }
    }
    if (!best) return null;
    var dps = best.s, sup = isSupportClass(rec["class"]) ? boardReading(best.stats, "support") : null;
    var supWins = !!(sup && sup.score != null && dps.score != null &&
      SR.of(sup.score, "support").i < SR.of(dps.score, "dps").i);
    var shown = supWins ? sup : dps;
    function reading(x, won) {
      return x ? { pct: Math.round(x.pct * 100) / 100, score: x.score == null ? null : Math.round(x.score * 1000) / 1000,
        isPerfect: won ? !!x.isPerfect : false } : null;
    }
    var rd = reading(dps, !supWins), rs = reading(sup, supWins), rw = supWins ? rs : rd;
    return {
      region: rec.region, name: rec.name, "class": rec["class"] || null,
      itemLevel: rec.itemLevel, pulledAt: rec.pulledAt, grade: dps.grade,
      role: shown.role, dps: rd, sup: rs,
      pct: rw.pct, score: rw.score, isPerfect: rw.isPerfect
    };
  }

  /**
   * The baked board: data/characters.json's records, scored here as the Worker
   * scores a row. Only reached when no board came back from the Worker, and the
   * one board whose rows are also full records — so seedHit can load from it.
   */
  function bakedBoard() {
    return fetch(SEED_URL).then(function (r) {
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json();
    }).then(function (j) {
      // characters.json keeps its records under `characters` (keyed "<REGION>|<name>");
      // older copies were keyed at the top level or were {entries:[…]}. Accept all three.
      var raw = (j && j.entries) ? j.entries : [];
      var bag = (j && j.characters && typeof j.characters === "object") ? j.characters : j;
      if (!raw.length && bag && typeof bag === "object") {
        for (var k in bag) if (Object.prototype.hasOwnProperty.call(bag, k) && bag[k] && bag[k].name) raw.push(bag[k]);
      }
      var rows = [], i, rec, e;
      for (i = 0; i < raw.length; i++) {
        rec = fromSeedEntry(raw[i]);
        if (!rec) continue;
        e = boardEntryFromRecord(rec);
        if (!e) continue;
        rec.grade = e.grade; rec.role = e.role; rec.dps = e.dps; rec.sup = e.sup;
        rec.pct = e.pct; rec.score = e.score; rec.isPerfect = e.isPerfect;
        rec.ord = rows.length;
        rows.push(rec);
      }
      var stamp = Date.parse((j && j._scoredAt) || "") || 0;
      return indexBoard(rows, stamp, Date.now(), "baked");
    }).catch(function () { return indexBoard([], 0, Date.now(), "baked"); });
  }

  /**
   * The board every other caller of this file reads — the live one, kept, or
   * baked. Named for the file it used to read; {list, byKey} as it always was.
   */
  function seedIndex() { return board(); }

  /**
   * One seed row -> the internal record every render path reads. Scores every
   * loadout on the canonical default profile HERE rather than trusting the file's
   * stored number, for exactly the reason the leaderboard does: a model change
   * must show up without re-baking the seed.
   */
  function fromSeedEntry(e) {
    if (!e || !e.name) return null;
    var raw = (e.loadouts && e.loadouts.length) ? e.loadouts : [e];
    var los = raw.map(function (l, i) {
      // The baked file stores rolls LEFT under rollsRemaining (its used counts
      // sit under rerollsUsed); the internal record carries rolls left.
      var rolls = l.rollsRemaining || e.rollsRemaining || null;
      var stats = l.rawStats || e.rawStats || [];
      var s = defaultScore(stats);
      return {
        classification: l.classification || "loadout",
        label: l.label || ("Loadout " + (i + 1)),
        itemLevel: l.itemLevel != null ? Math.round(l.itemLevel) : (e.itemLevel != null ? Math.round(e.itemLevel) : null),
        isRendered: !!l.isRendered,
        stats: stats,
        rollsLeft: rolls ? ((rolls.base || 0) + (rolls.ticket || 0)) : null,
        pct: s ? s.pct : null,
        grade: s ? s.grade : (l.grade || e.grade || null),
        unmapped: s ? s.unmapped : 0,
        // ARCHITECTURE §1.1, exactly as fromWorkerRecord passes it: the left
        // column belongs to the LOADOUT, so a pill click refills the deck. The
        // seed now bakes the same block a live pull carries, read off the same
        // page by the same parser.
        profile: l.profile || e.profile || null
      };
    });
    var best = bestOf(los, e.chosenLoadout || 0);
    return {
      pick: raidPick(los, best),
      region: normRegion(e.region) || "NA",
      name: e.name,
      "class": e["class"] || null,
      itemLevel: e.itemLevel != null ? Math.round(e.itemLevel) : null,
      pulledAt: Date.parse(e.scoredAt || "") || null,
      source: "seed",
      cached: true,
      loadouts: los,
      best: best,
      pct: los[best] ? los[best].pct : null,
      // The chosen loadout's block, mirroring the record shape a live pull has.
      // An older seed file carries none and this stays null, which is what the
      // auto-re-pull below reads.
      profile: e.profile || (los[best] && los[best].profile) || null
    };
  }

  /** The highest-scoring loadout; the file's own index only breaks a tie. */
  function bestOf(los, chosen) {
    var best = -Infinity, bi = -1, i;
    for (i = 0; i < los.length; i++) {
      var p = los[i].pct;
      if (p == null) continue;
      if (p > best + 1e-9 || (Math.abs(p - best) < 1e-9 && i === chosen)) { best = p; bi = i; }
    }
    return bi >= 0 ? bi : (chosen || 0);
  }

  /**
   * WHICH LOADOUT THE CALCULATOR OPENS ON: the raid one, every time.
   *
   * A character page carries one loadout per bible tab, and the tab bible DRAWS
   * is whichever was updated last — so a character who ran a chaos dungeon after
   * their last raid opens on their chaos bracelet, chaos accessories and chaos
   * gems. That is not the build anybody wants graded (Shizu, 2026-08-11). Raid
   * first, then an estimated raid, then anything unrecognised, and chaos last.
   *
   * This is ONLY the pill the calculator starts on. What the BOARD ranks is
   * still bestOf() — the highest-scoring loadout — and the ▲ marker still points
   * at it, so the two never get confused for each other.
   */
  var LOADOUT_PREF = { most_recent_raid: 0, raid_merged: 1, most_recent_chaos_dungeon: 3 };
  function raidPick(los, fallback) {
    var bi = -1, br = 99, i, r;
    for (i = 0; i < los.length; i++) {
      if (!los[i] || !los[i].stats || !los[i].stats.length) continue;
      r = LOADOUT_PREF[los[i].classification];
      if (r === undefined) r = 2;                       // a tab we have no name for beats chaos
      if (r < br) { br = r; bi = i; }                   // first of the best rank wins
    }
    return bi >= 0 ? bi : (fallback || 0);
  }

  /** The Worker's /character answer -> the same internal record. */
  function fromWorkerRecord(d) {
    var raw = (d.loadouts && d.loadouts.length) ? d.loadouts : [{
      classification: "loadout", label: "Bracelet", itemLevel: d.itemLevel,
      isRendered: true, bracelet: d.bracelet, defaultScore: d.defaultScore
    }];
    var los = raw.map(function (l, i) {
      var br = (l && (l.bracelet || l)) || {};
      var stats = br.stats || [];
      var s = defaultScore(stats);
      return {
        classification: l.classification || "loadout",
        label: l.label || l.classification || ("Loadout " + (i + 1)),
        itemLevel: l.itemLevel != null ? Math.round(l.itemLevel) : null,
        isRendered: !!l.isRendered,
        stats: stats,
        // The Worker stores lostark.bible's used-counts; rolls left is derived.
        rollsLeft: rollsLeftOf(br.numRerolls, br.numTicketRerolls),
        pct: s ? s.pct : (l.defaultScore && typeof l.defaultScore.pct === "number" ? l.defaultScore.pct : null),
        grade: s ? s.grade : (l.defaultScore && l.defaultScore.grade) || null,
        unmapped: s ? s.unmapped : 0,
        // The left column belongs to the LOADOUT: a chaos tab can wear other
        // accessories and other gems than the raid tab, so switching pills has
        // to refill the deck, not just the bracelet. Falls back to the record's
        // own block for a Worker old enough to send only that one.
        profile: l.profile || d.profile || null
      };
    }).filter(function (l) { return l.stats && l.stats.length; });
    if (!los.length) return null;
    var best = bestOf(los, typeof d.chosenLoadout === "number" ? d.chosenLoadout : 0);
    return {
      pick: raidPick(los, best),
      region: normRegion(d.region) || "NA",
      name: d.name,
      "class": d["class"] || null,
      itemLevel: d.itemLevel != null ? Math.round(d.itemLevel) : null,
      pulledAt: d.pulledAt || Date.now(),
      source: "bible",
      cached: d.cached != null ? !!d.cached : null,
      stale: !!d.stale,
      staleHours: d.staleHours || 0,
      loadouts: los,
      best: best,
      pct: los[best] ? los[best].pct : null,
      // ARCHITECTURE §1.1: the record may carry the grader-profile block. Passed
      // straight through — app.js decides what of it the deck can honestly hold.
      profile: d.profile || null
    };
  }

  // ------------------------------------------------------------------
  // "where does this bracelet sit?" — the board's own answer
  // ------------------------------------------------------------------

  /** "top 4.4%": rank over count, rounded UP, so nobody is ever top 0% — the profile page's topPct(). */
  function topPct(rank, count) {
    if (!rank || !count) return "";
    var p = 100 * rank / count;
    return "top " + (p < 10 ? (Math.ceil(p * 10) / 10).toFixed(1) : String(Math.ceil(p))) + "%";
  }
  /** "Sorceress" + "s" reads "Sorceresss": classes ending in s, x or z take "es". */
  function classPlural(cls) { return /[sxz]$/i.test(cls) ? cls + "es" : cls + "s"; }
  /** "on EU", or "on EU's support board" for a support reading. */
  function boardWords(region, axis) { return "on " + region + (axis === "support" ? "’s support board" : ""); }

  /**
   * fieldRank(char, cb) — where the board puts this character, cb(r):
   *
   *   onBoard   true when the board holds the character's row; false when the
   *             letter is this file's estimate of the row the board will build
   *   axis      "dps" | "support" — the reading shown, the Worker's better-letter pick
   *   key, bg, fg, isPerfect, score, pct
   *             the subrank letter and its colours (subrank.js's of() and
   *             colorOf()), the 0-100 and the damage %, on the default profile
   *   rank, count, region, classRank, classCount, cls
   *             the place on the region's board for that axis; the class count
   *             includes the character. rank is an estimate when onBoard is false.
   *   text      the line under the banner's stats
   *   source, builtAt, stale   which board answered, and how old it is
   *
   * THE BOARD'S LETTER, NEVER A LETTER OF ITS OWN. This used to band the
   * character's share of the best bracelet on the baked 59 on a six-letter
   * ladder no other page used — so Tikkyy read "B" beside a C+ grade, and his
   * class place came out "#6 of 5" because the count left him out. The letter is
   * now the row's own 0-100 on subrank's ladder, the place is the row's place on
   * the board the leaderboard draws, and both are what his profile says.
   *
   * NOT ON THE BOARD YET — a character the board has not rebuilt with — is
   * scored here from the record just loaded, the way the Worker will score it,
   * and its place is marked as an estimate until the next rebuild (every ten
   * minutes at most).
   */
  function fieldRank(char, cb) {
    if (!char || !char.name || typeof cb !== "function") return;
    board().then(function (b) {
      var row = b.byKey[charKey(normRegion(char.region) || char.region, char.name)] || null;
      var r = row ? placeOnBoard(b, row) : null;
      if (!r) r = placeOffBoard(b, char);
      if (r) cb(r);
    }).catch(function () { /* the rank is a nicety; never break the panel over it */ });
  }

  /** The board's letter, colours and figures for one reading. */
  function readingBadge(reading, axis) {
    var SR = root.Subrank;
    if (!SR || !reading || reading.score == null) return null;
    var band = SR.of(reading.score, axis), col = SR.colorOf(band.key, !!reading.isPerfect);
    return { key: band.key, bg: col.bg, fg: col.fg, score: reading.score, pct: reading.pct, isPerfect: !!reading.isPerfect };
  }

  /** How old a board copy is, for a line that has to say so. */
  function boardAge(b) {
    if (b.source === "baked") return "the board baked into this build";
    if (!b.stale) return "";
    var mins = Math.max(1, Math.round((Date.now() - b.fetchedAt) / 60000));
    return "a board copy from " + (mins < 60 ? mins + "m" : Math.round(mins / 60) + "h") + " ago";
  }

  function placeOnBoard(b, row) {
    var axis = row.role === "support" ? "support" : "dps";
    var lists = b.lists[row.region] || { dps: [], support: [] };
    var list = lists[axis], i = list.indexOf(row);
    if (i < 0) { axis = axis === "support" ? "dps" : "support"; list = lists[axis]; i = list.indexOf(row); }
    var badge = readingBadge(axis === "support" ? row.sup : row.dps, axis);
    if (i < 0 || !badge) return null;
    var cls = row["class"], cr = 0, cn = 0, j;
    for (j = 0; j < list.length; j++) {
      if (!cls || list[j]["class"] !== cls) continue;
      cn++;
      if (j <= i) cr++;
    }
    var parts = ["#" + nf(i + 1) + " of " + nf(list.length) + " " + boardWords(row.region, axis), topPct(i + 1, list.length)];
    if (cls && cn) parts.push("#" + nf(cr) + " of " + nf(cn) + " " + classPlural(cls));
    var age = boardAge(b);
    if (age) parts.push(age);
    return extendObj(badge, {
      onBoard: true, axis: axis, rank: i + 1, count: list.length, region: row.region,
      classRank: cls ? cr : null, classCount: cls ? cn : null, cls: cls || null,
      text: parts.join(" · "), source: b.source, builtAt: b.builtAt, stale: !!b.stale
    });
  }

  /**
   * A character the board does not hold: the record just loaded, scored as the
   * Worker will score it, and placed among the rows already there — a tie goes
   * ahead of it, the way a rebuild appends a new row after the ones it keeps.
   */
  function placeOffBoard(b, char) {
    var rec = state.record;
    if (!rec || String(rec.name).toLowerCase() !== String(char.name).toLowerCase() ||
        (normRegion(rec.region) || rec.region) !== (normRegion(char.region) || char.region)) return null;
    var e = boardEntryFromRecord(rec);
    if (!e) return null;
    var axis = e.role === "support" ? "support" : "dps";
    var reading = axis === "support" ? e.sup : e.dps, badge = readingBadge(reading, axis);
    if (!badge) return null;
    var region = normRegion(rec.region) || rec.region;
    var list = (b.lists[region] || { dps: [], support: [] })[axis], better = 0, cn = 1, cAhead = 0, j, v;
    for (j = 0; j < list.length; j++) {
      v = list[j][axis === "support" ? "sup" : "dps"];
      var ahead = v && v.pct != null && v.pct >= reading.pct;
      if (ahead) better++;
      if (e["class"] && list[j]["class"] === e["class"]) { cn++; if (ahead) cAhead++; }
    }
    // With no board at all there is nothing to be placed among: say that, and
    // keep the letter, which needs no board.
    var parts = b.list.length
      ? ["Not on the board yet", "≈ #" + nf(better + 1) + " of " + nf(list.length + 1) + " " + boardWords(region, axis)]
      : ["The board could not be read, so there is no place to show"];
    var age = b.list.length ? boardAge(b) : "";
    if (age) parts.push(age);
    return extendObj(badge, {
      onBoard: false, axis: axis, rank: b.list.length ? better + 1 : null, count: b.list.length ? list.length + 1 : null, region: region,
      classRank: e["class"] && b.list.length ? cAhead + 1 : null, classCount: e["class"] && b.list.length ? cn : null, cls: e["class"] || null,
      text: parts.join(" · "), source: b.source, builtAt: b.builtAt, stale: !!b.stale
    });
  }

  function extendObj(a, b) {
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k];
    return a;
  }

  // ------------------------------------------------------------------
  // the Worker — the ONLY thing allowed near a lostark.bible character page
  // ------------------------------------------------------------------

  /**
   * Econ.fetchCharacter(region, name, {refresh}) — astrogem's loadout-econ.js
   * entry point, in our route shape:
   *
   *   GET {WORKER}/character?region=&name=&queue=1&pos=1[&refresh=1]
   *   Authorization: Bearer <BibleOAuth.accessToken()>
   *
   * `queue=1&pos=1` asks the Worker to answer with a queue position instead of
   * blocking when the character is not cached — the contract the queue watch below
   * is written to. Resolves { ok, status, data } whatever the status, because every
   * branch of runPull reads the body.
   */
  function fetchCharacter(region, name, opts) {
    var url = WORKER_URL.replace(/\/+$/, "") +
      "/character?region=" + encodeURIComponent(bibleRegion(region) || "NA") +
      "&name=" + encodeURIComponent(name) +
      "&queue=1&pos=1" +
      (opts && opts.refresh ? "&refresh=1" : "");
    var headers = {};
    var tok = OA.accessToken && OA.accessToken();
    if (tok) headers.Authorization = "Bearer " + tok;
    return fetch(url, { headers: headers }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        return { ok: resp.ok, status: resp.status, data: data || {} };
      });
    });
  }

  var Econ = {
    WORKER_URL: WORKER_URL,
    fetchCharacter: fetchCharacter,
    fieldRank: fieldRank,
    defaultScore: defaultScore,
    seed: seedIndex
  };

  /**
   * Worker error codes -> the message kinds msgHtml() knows how to word.
   *
   * `not_yours` no longer comes back from a lookup — nothing is refused for not
   * being yours any more. It survives here for POST /forget, which still proves
   * ownership before it deletes a row, and for any cached client talking to a
   * newer Worker.
   */
  function workerErrorKind(status, code) {
    if (code === "not_yours") return "notyours";
    if (code === "no_bracelet") return "nobracelet";
    if (code === "no_such_character") return "nopage";
    if (code === "busy" || code === "unavailable" || code === "monthly_budget") return "busy";
    if (code === "slow_down" || status === 429) return "slowdown";
    if (code === "not_signed_in" || code === "bad_token" || status === 401) return "expired";
    return "worker";
  }

  // ------------------------------------------------------------------
  // markup
  // ------------------------------------------------------------------

  function styleBlock() {
    return "<style>" +
      // The panel scrolls normally — styles.css makes .inputs sticky, and a frozen
      // bar over a page this tall is the complaint astrogem fixed the same way.
      "#bc-import .inputs{position:static;top:auto;z-index:auto;margin-bottom:12px}" +
      "#bc-import .bi-modes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;align-items:center}" +
      // the auth buttons ride at the far END of the mode row, so the mode toggles keep their group
      "#bc-import .bi-authbtns{display:flex;gap:8px;margin-left:auto}" +
      "@media(max-width:560px){#bc-import .bi-authbtns{margin-left:0}}" +
      "#bc-import .bi-modebody{margin-top:12px}" +
      "#bc-import button.primary{background:var(--accent);color:#06121f;border:none;border-radius:7px;" +
        "padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}" +
      "#bc-import button.primary:hover{filter:brightness(1.08)}" +
      "#bc-import button.primary:disabled,#bc-import .mbtn:disabled{opacity:.45;cursor:not-allowed}" +
      "#bc-import .bi-status{font-size:12px;color:var(--dim);min-height:16px}" +
      "#bc-import .bi-status.working{color:var(--accent)}" +
      "#bc-import .bi-status.err{color:var(--bad)}" +
      "#bc-import .bi-status.ok{color:var(--good)}" +
      // pull mode: controls LEFT, saved characters RIGHT
      "#bc-import .bi-pullgrid{display:grid;grid-template-columns:auto 1fr;gap:14px 32px;align-items:start}" +
      "@media(max-width:700px){#bc-import .bi-pullgrid{grid-template-columns:1fr}}" +
      "#bc-import .bi-pullleft,#bc-import .bi-pullright{min-width:0}" +
      "#bc-import .bi-pullctl{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:0 0 10px}" +
      "#bc-import .bi-pullctl .fld{margin:0}" +
      "#bc-import .bi-pullctl .fld-region{flex:0 0 auto;width:84px}" +
      "#bc-import .bi-pullctl .fld-name{flex:0 0 auto;width:200px}" +
      "@media(max-width:520px){#bc-import .bi-pullctl .fld-name{flex:1 1 160px;width:auto}}" +
      "#bc-import .bi-pullbtns{display:flex;gap:10px;flex-wrap:wrap;align-items:center}" +
      "#bc-import .bi-freenote{font-size:12px;color:var(--dim);margin-top:6px;line-height:1.5}" +
      // Empty in the healthy state now — it must not keep its margin.
      "#bc-import .bi-freenote:empty{display:none}" +
      "#bc-import .bi-freenote b{color:var(--text)}" +
      "#bc-import .bi-freenote .bi-cap{color:#e0683c;font-weight:600}" +
      "#bc-import .bi-msg{color:var(--dim);font-size:11.5px;margin-top:6px;max-width:74ch;line-height:1.55}" +
      "#bc-import .bi-msg.bad{color:var(--bad)}" +
      "#bc-import .bi-msg.good{color:var(--good)}" +
      "#bc-import .bi-who{color:var(--dim);font-size:11px}" +
      "#bc-import .bi-who b{color:var(--text);font-weight:700}" +
      // ---- saved-characters quick-pick ----
      "#bc-import .bi-favs{margin:0}" +
      "#bc-import .bi-favs .lab{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;" +
        "color:var(--dim);font-weight:700;margin:0 0 8px}" +
      "#bc-import .bi-favs .lab .lab-star{color:var(--high);margin-right:3px}" +
      "#bc-import .bi-favs .lab+.bi-favlist{margin-bottom:12px}" +
      "#bc-import .bi-favlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;"
      // three rows of chips, then scroll: 3*32px chip + 2*6px gap (measured)
      + "max-height:108px;overflow-y:auto;padding-right:4px}" +
      "#bc-import .bi-favlist.bi-board{max-height:186px;overflow-y:auto;padding-right:4px}" +
      "#bc-import .bi-favrow{display:flex;align-items:stretch;gap:5px}" +
      "#bc-import .bi-favrow .bi-favbtn{flex:1 1 auto;min-width:0}" +
      "#bc-import .bi-favbtn{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;" +
        "text-align:left;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:7px 12px;" +
        "font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--text);line-height:1.3;" +
        "transition:border-color .12s,background .12s,color .12s}" +
      "#bc-import .bi-favbtn:hover{border-color:var(--accent);background:var(--panel);color:var(--accent)}" +
      "#bc-import .bi-favbtn.on{border-color:var(--accent);color:var(--accent)}" +
      "#bc-import .bi-favbtn .nm{flex:0 1 auto;min-width:0;margin-right:auto;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap}" +
      "#bc-import .bi-favbtn .rg{font-size:9.5px;font-weight:700;color:var(--dim);text-transform:uppercase;" +
        "letter-spacing:.04em;flex:0 0 auto;transition:color .12s,opacity .12s}" +
      "#bc-import .bi-favbtn:hover .rg{color:var(--accent);opacity:.6}" +
      // an <img> cannot inherit the SVG's fill=currentColor, so flatten it and invert
      "#bc-import .bi-favbtn .bi-classicon{width:16px;height:16px;object-fit:contain;flex:0 0 auto;" +
        "margin-right:7px;filter:brightness(0) invert(1)}" +
      "#bc-import .bi-favstar{flex:0 0 auto;background:none;border:none;color:var(--high);cursor:pointer;" +
        "font-size:15px;line-height:1;padding:2px 5px;font-family:inherit;transition:transform .08s,color .12s}" +
      "#bc-import .bi-favstar:hover{transform:scale(1.15);color:#fff}" +
      "#bc-import .bi-favstar.off{color:var(--none)}" +
      "#bc-import .bi-favempty{display:block;font-size:11px;color:var(--dim);font-style:italic;margin:0 0 12px}" +
      // ---- the "lookups" notice: amber when paused, blue when a sign-in is what's missing ----
      "#bc-import .bi-unavail{--gu:#60a5fa;--gutext:#06172e;--gubg:rgba(96,165,250,0.11);--gubd:rgba(96,165,250,0.5);" +
        "margin:0 0 14px;padding:18px 20px;border-radius:14px;background:var(--gubg);border:1px solid var(--gubd)}" +
      "#bc-import .bi-unavail.amber{--gu:#e8b54a;--gutext:#1a1205;--gubg:rgba(232,181,74,0.13);--gubd:rgba(232,181,74,0.55)}" +
      "#bc-import .bi-unavail-hd{font-size:16px;font-weight:800;color:var(--gu);line-height:1.35;margin:0 0 8px}" +
      "#bc-import .bi-unavail-bd{font-size:13px;line-height:1.6;color:var(--text);margin:0}" +
      "#bc-import .bi-unavail-bd b{color:var(--gu)}" +
      "#bc-import .bi-unavail-steps{margin:10px 0 0;padding-left:20px;font-size:13px;line-height:1.7;color:var(--text)}" +
      "#bc-import .bi-unavail-steps b{color:var(--gu)}" +
      "#bc-import .bi-unavail-btn{margin-top:14px;padding:10px 18px;border-radius:10px;background:var(--gu);" +
        "color:var(--gutext);font-weight:800;font-size:14px;border:0;cursor:pointer;font-family:inherit}" +
      "#bc-import .bi-unavail-btn:hover{filter:brightness(1.08)}" +
      // ---- the queue: a thin bar over a cached bracelet, or its own panel ----
      "#bc-refresh-banner:empty{display:none}" +
      "#bc-refresh-banner .bi-refresh-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;" +
        "padding:9px 13px;border-radius:9px;background:rgba(127,127,127,0.10);border:1px solid var(--accent);font-size:13px}" +
      "#bc-refresh-banner .bi-refresh-bar b{color:var(--accent)}" +
      "#bc-refresh-banner .bi-rb-dim{color:var(--dim)}" +
      "#bc-refresh-banner .bi-rb-spin{display:inline-block;animation:bi-rb-spin 1.1s linear infinite}" +
      "@keyframes bi-rb-spin{to{transform:rotate(360deg)}}" +
      "#bc-refresh-banner .bi-queued{display:flex;align-items:center;gap:14px;padding:6px 2px}" +
      "#bc-refresh-banner .bi-queued-icon{font-size:30px;line-height:1}" +
      "#bc-refresh-banner .bi-queued-main{font-size:14px}" +
      "#bc-refresh-banner .bi-queued-pos{font-size:13px;font-weight:600;color:var(--accent);margin-top:5px}" +
      "#bc-refresh-banner .bi-queued-sub{font-size:12px;color:var(--dim);margin-top:4px}" +
      "#bc-refresh-banner #bi-queued-timer,#bc-refresh-banner #bi-rb-timer{color:var(--accent)}" +
      // ---- loadout pills: astrogem's preset-pill segmented control ----
      "#bc-loadouts:empty{display:none}" +
      "#bc-loadouts .bi-axis{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}" +
      "#bc-loadouts .bi-axis .lab{font-size:10px;text-transform:uppercase;letter-spacing:.07em;" +
        "color:var(--dim);font-weight:700}" +
      "#bc-loadouts .bi-axispills{display:inline-flex;gap:0;border:1px solid var(--border);border-radius:99px;" +
        "overflow:hidden;background:var(--panel2)}" +
      "#bc-loadouts .bi-axispill{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12.5px;" +
        "font-weight:700;color:var(--dim);padding:6px 16px;line-height:1.3;transition:background .12s,color .12s}" +
      "#bc-loadouts .bi-axispill:not(:last-child){border-right:1px solid var(--border)}" +
      "#bc-loadouts .bi-axispill:hover:not(.active){color:var(--text)}" +
      "#bc-loadouts .bi-axispill.active{background:var(--accent);color:#06121f}" +
      "#bc-loadouts .bi-axispill b{font-weight:800;font-variant-numeric:tabular-nums;margin-left:5px}" +
      "#bc-loadouts .bi-axispill i{font-style:normal;color:var(--good);margin-left:4px}" +
      "#bc-loadouts .bi-axispill.active i{color:#06121f}" +
      "#bc-loadouts .bi-axisnote{font-size:11px;color:var(--dim)}" +
      // A flex item, so an empty one still costs the row's gap.
      "#bc-loadouts .bi-axisnote:empty{display:none}" +
      "</style>";
  }

  function regionOptions(sel) {
    return REGIONS.map(function (r) {
      return '<option value="' + r + '"' + (r === sel ? " selected" : "") + ">" + r + "</option>";
    }).join("");
  }

  function panelMarkup(last) {
    return styleBlock() +
      '<div class="bi-unavail" id="bi-unavailable" style="display:none"></div>' +
      '<div class="inputs" id="bi-inputs">' +
      '  <div class="ihdr"><span data-gloss="Any character, no sign-in needed. Ones already on the board are free and instant; a new one is fetched at three a minute.">Character — pull a bracelet from lostark.bible</span></div>' +
      '  <div class="bi-modes">' +
      '    <button class="mbtn active" id="bi-mode-pull" type="button">Pull from lostark.bible</button>' +
      '    <button class="mbtn" id="bi-mode-manual" type="button">Manual entry</button>' +
      '    <span class="bi-authbtns" id="bi-authbtns"></span>' +
      '  </div>' +
      '  <div class="bi-modebody" id="bi-body-manual" style="display:none">' +
      '    <div class="note" style="margin-top:0"><span data-gloss="The two combat traits first, then one row per granted slot. Leave every slot empty to score it unrolled. Your character settings are not touched.">Nothing to pull — type the bracelet into the panel below.</span></div>' +
      '  </div>' +
      '  <div class="bi-modebody" id="bi-body-pull">' +
      '    <div class="bi-pullgrid">' +
      '      <div class="bi-pullleft">' +
      '        <div class="bi-pullctl">' +
      '          <div class="fld fld-region"><label for="bi-region">Region</label><select id="bi-region">' +
                   regionOptions((last && last.region) || "NA") + '</select></div>' +
      '          <div class="fld fld-name"><label for="bi-name">Character name</label>' +
      '            <input id="bi-name" type="text" placeholder="e.g. White" autocomplete="off" value="' +
                   esc((last && last.name) || "") + '"></div>' +
      '        </div>' +
      '        <div class="bi-pullbtns">' +
      '          <button class="primary" id="bi-pull-go" type="button">Grade bracelet</button>' +
      '          <button class="mbtn" id="bi-pull-refresh" type="button" style="display:none">Re-pull from lostark.bible</button>' +
      '        </div>' +
      '        <div class="barrow" style="margin-top:8px"><span class="bi-status" id="bi-pull-status"></span></div>' +
      '        <div class="bi-freenote" id="bi-free-note"></div>' +
      '        <div id="bi-msg-host"></div>' +
      '      </div>' +
      '      <div class="bi-pullright"><div class="bi-favs" id="bi-favs"></div></div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  /**
   * The mount. app.js provides `#bc-import` at the top of the Calculator pane; if a
   * stale build does not, make one there so the panel is never lost.
   */
  function mount() {
    var box = $(MOUNT_ID);
    if (box) return box;
    var pane = document.getElementById("tab-calculator");
    if (!pane || !pane.firstChild) return null;
    box = document.createElement("div");
    box.id = MOUNT_ID;
    pane.insertBefore(box, pane.firstChild);
    return box;
  }

  var built = false;

  /** Build the panel once; everything after that repaints a region of it. */
  function render() {
    var box = mount();
    if (!box) return;
    if (!built) {
      var last = null;
      try { last = JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (e) {}
      box.innerHTML = panelMarkup(last);
      built = true;
      bind();
      selectMode(state.mode);
      setFreeStatus();
    }
    renderAuth();
    renderFavRow();
    renderMsg();
  }

  /** Every failure gets its own sentence — never one shrug for all of them. */
  function msgHtml() {
    if (state.error) {
      var e = state.error, t;
      if (e.kind === "expired") {
        t = "Your lostark.bible pass ran out. Sending you back to sign in — it should come straight back without asking anything. " +
          "Lookups do not need it, so you can also carry on signed out.";
      } else if (e.kind === "reauth-failed") {
        t = "Signing back in did not take. Use the button above to start the sign-in again — lookups work signed out too.";
      } else if (e.kind === "noworker") {
        t = "Live lookups need our lostark.bible fetch service, which is not deployed for this build yet — " +
          "so " + esc(e.who || "that character") + " cannot be fetched. The characters listed on the right are baked " +
          "into this build and load instantly; pick any of them.";
      } else if (e.kind === "notyours") {
        // Only POST /forget can still produce this: deleting a row proves the row
        // is yours. A LOOKUP is never refused for this reason — see the header.
        t = "Taking " + esc(e.who || e.detail || "that character") + " off the board has to be done by its owner, " +
          "so it needs a sign-in that shows the character on your roster. Looking the character up needs nothing.";
      } else if (e.kind === "nopage") {
        t = "No character called " + esc(e.who || "that one") + " came back on that region. Check the spelling, " +
          "or try the other region. A character hidden on lostark.bible cannot be read either — and a brand-new " +
          "one may need visiting on lostark.bible once so their profile syncs.";
      } else if (e.kind === "slowdown") {
        t = "That is a lot of new characters at once, and you have hit the lookup limit — it resets in under a minute. " +
          "Characters already on the board are free and instant meanwhile. The limit is what keeps this tool a welcome " +
          "guest on lostark.bible.";
      } else if (e.kind === "busy") {
        t = (e.detail ? esc(e.detail) : "New lookups are paused for a moment while the queue catches up.") +
          " This is temporary — cached characters and the board still load.";
      } else if (e.kind === "worker") {
        t = "The import service could not be reached" + (e.detail ? " (" + esc(e.detail) + ")" : "") +
          ". Your bracelet is fine — try again in a minute, or pick a character on the right.";
      } else if (e.kind === "nobracelet") {
        t = "We can see " + esc(e.who || e.detail || "that character") + ", but there is no bracelet on them. " +
          "If they are wearing one, it may not have synced to lostark.bible yet — open the character there once, " +
          "then try again.";
      } else if (e.kind === "undecodable") {
        t = "A bracelet came back for " + esc(e.detail || "that character") + ", but none of its lines decoded. " +
          "That usually means a new stat index — worth reporting with the payload from BraceletImport.dumpShape().";
      } else {
        t = "lostark.bible answered with an error" + (e.detail ? " (" + esc(e.detail) + ")" : "") +
          ". Nothing is wrong with your bracelet — try Load my characters in a minute.";
      }
      return '<div class="bi-msg bad">' + t + "</div>";
    }
    if (state.note) {
      var g = state.noteGloss ? esc(state.noteGloss).split('"').join("&quot;") : "";
      return '<div class="bi-msg good">' + (g ? '<span data-gloss="' + g + '">' + esc(state.note) + "</span>" : esc(state.note)) + "</div>";
    }
    return "";
  }
  function renderMsg() {
    var host = $("bi-msg-host");
    if (host) host.innerHTML = msgHtml();
  }

  /**
   * The one sentence that tells the story of a pull: board hit, queue position,
   * no bracelet on the page, worker unreachable. It goes in #bi-pull-status AND
   * out to any subscriber, because the character picker shows the same sentence
   * in its own panel — and it was reading it back off this element with a
   * MutationObserver. Rewording it there would be a second load path written in
   * prose; watching a DOM node for it is a seam that breaks the moment this
   * markup moves. A listener list is neither.
   */
  var statusListeners = [];
  function setPullStatus(msg, kind) {
    var el = $("bi-pull-status");
    if (el) {
      el.textContent = msg || "";
      el.className = "bi-status" + (kind ? " " + kind : "");
    }
    for (var i = 0; i < statusListeners.length; i++) {
      try { statusListeners[i](msg || "", kind || ""); } catch (e) { /* a bad subscriber must not break a pull */ }
    }
  }

  /**
   * The line under the pull buttons. It now carries the DEGRADED states only —
   * the site too busy to take new lookups, or no fetch service deployed at all.
   * Both say something the controls cannot, so both stay on the page
   * (docs/design/copy-rules.md, rule 4).
   *
   * The healthy-state pitch — any character, no sign-in, cached ones free,
   * new ones three a minute — was ordinary explanation sitting on screen, so it
   * moved into the panel header's tooltip and this element renders empty.
   */
  function setFreeStatus(degraded) {
    var el = $("bi-free-note");
    if (!el) return;
    if (degraded) {
      el.innerHTML = '<span class="bi-cap">The site is very busy — new-character lookups are paused. ' +
        "Cached characters still work.</span>";
      return;
    }
    el.innerHTML = WORKER_URL ? "" :
      '<span class="bi-cap">Live lookups need the fetch service, which is not deployed yet. ' +
      "The characters on the right load instantly.</span>";
  }

  /**
   * Keep the Re-pull button's label and title honest about where a pull would go.
   * Both our regions read from lostark.bible, so this is one site today; it exists
   * because astrogem's does and because a KR-style second source would land here.
   */
  function syncSourceUI() {
    var btn = $("bi-pull-refresh");
    if (!btn) return;
    btn.textContent = "Re-pull from lostark.bible";
    btn.title = WORKER_URL
      ? "Force a fresh pull from lostark.bible"
      : "Needs the lostark.bible fetch service, which is not deployed yet";
  }

  // ------------------------------------------------------------------
  // saved characters — renderFavRow(), ported
  // ------------------------------------------------------------------

  var favClasses = {};        // charKey -> English class name, for the row icon
  var favClassFetch = false;  // the seed is read at most once for this

  function favClass(region, name) { return favClasses[charKey(region, name)] || null; }

  /**
   * Fill in the class of any saved character we do not know yet, from the baked
   * board. Runs at most once per session and only when something is missing.
   */
  function ensureFavClasses(favs) {
    if (favClassFetch) return;
    var unknown = favs.some(function (f) { return !favClass(f.region, f.name); });
    if (!unknown) return;
    favClassFetch = true;
    seedIndex().then(function (idx) {
      var before = JSON.stringify(favClasses), changed = false;
      (idx.list || []).forEach(function (e) {
        if (e["class"]) favClasses[charKey(e.region, e.name)] = e["class"];
      });
      changed = JSON.stringify(favClasses) !== before;
      if (changed) renderFavRow();
    }).catch(function () { /* no board — rows just show no icon */ });
  }

  function favRowHtml(f, i, saved, which) {
    return '<div class="bi-favrow" data-fi="' + i + '" data-set="' + which + '">' +
      '<button type="button" class="bi-favstar' + (saved ? "" : " off") + '" title="' +
        (saved ? "Unsave " : "Save ") + esc(f.name) + '" aria-label="' +
        (saved ? "Unsave " : "Save ") + esc(f.name) + '">' + (saved ? "&#9733;" : "&#9734;") + "</button>" +
      '<button type="button" class="bi-favbtn' + (state.picked === f.name ? " on" : "") +
        '" title="Load ' + esc(f.name) + " (" + esc(f.region) + ')">' +
      classIconHtml(favClass(f.region, f.name)) +
      '<span class="nm">' + esc(f.name) + "</span>" +
      '<span class="rg">' + esc(f.region) + "</span></button>" +
      "</div>";
  }

  /**
   * The saved-character grid: one row per favourite, a ★ that unsaves and a button
   * that LOADS. Below it, the characters baked into this build — the same rows, so
   * the panel is useful before anyone has signed in or saved anything.
   */
  var boardChars = null;
  function renderFavRow() {
    var host = $("bi-favs");
    if (!host) return;
    var F = root.Favorites;
    var favs = F ? F.list() : [];
    var h = '<span class="lab"><span class="lab-star">&#9733;</span> Saved characters</span>';
    if (favs.length) {
      h += '<div class="bi-favlist" data-set="fav">' + favs.map(function (f, i) {
        return favRowHtml(f, i, true, "fav");
      }).join("") + "</div>";
    } else {
      h += '<span class="bi-favempty">No saved characters yet — grade one and tap its ★.</span>';
    }
    if (boardChars && boardChars.length) {
      // The "On the board" list was removed (Shizu, 2026-08-11): the Leaderboard tab
      // already lists everyone, and 59 extra chips buried the saved characters. The
      // board index is still fetched — it feeds class icons and the field rank.
      boardRest = [];
    }
    host.innerHTML = h;
    ensureFavClasses(favs);
    bindFavRows(host, favs);
    if (!boardChars) {
      seedIndex().then(function (idx) {
        boardChars = (idx.list || []).map(function (e) {
          favClasses[charKey(e.region, e.name)] = e["class"] || favClasses[charKey(e.region, e.name)];
          return { region: e.region, name: e.name };
        });
        renderFavRow();
      }).catch(function () { boardChars = []; });
    }
  }
  var boardRest = [];

  function bindFavRows(host, favs) {
    var rows = host.querySelectorAll(".bi-favrow"), i;
    for (i = 0; i < rows.length; i++) {
      (function (rowEl) {
        var set = rowEl.getAttribute("data-set");
        var f = (set === "fav" ? favs : boardRest)[parseInt(rowEl.getAttribute("data-fi"), 10)];
        if (!f) return;
        rowEl.querySelector(".bi-favbtn").onclick = function () {
          loadCharacter(f.region, f.name);
        };
        rowEl.querySelector(".bi-favstar").onclick = function () {
          var F = root.Favorites;
          if (F) F.toggle(f.region, f.name);   // Favorites.onChange repaints this grid
        };
      })(rows[i]);
    }
  }

  // ------------------------------------------------------------------
  // the loadout pills — astrogem's preset toggle, with our two-bracelet axis
  // ------------------------------------------------------------------

  function renderLoadoutPills() {
    var host = $("bc-loadouts");
    if (!host) return;
    var los = state.loadouts;
    if (!los || los.length < 2) { host.innerHTML = ""; return; }
    var pills = los.map(function (l, i) {
      var p = l.pct == null ? "—" : fx(l.pct, 2) + "%";
      return '<button type="button" class="bi-axispill' + (i === state.loadoutIdx ? " active" : "") +
        '" data-ld="' + i + '" title="' + esc(pillTitle(l, i)) + '">' +
        esc(l.label || l.classification) + "<b>" + p + "</b>" +
        (i === state.bestLoadout ? '<i title="highest — the one the leaderboard ranks">&#9650;</i>' : "") +
        "</button>";
    }).join("");
    var cur = los[state.loadoutIdx] || los[0];
    // The pills already say which loadout is active and mark the highest, so
    // agreeing with the board is not worth a sentence. Disagreeing is: the score
    // on screen is then not the score the board ranks, and only a line can say
    // so (docs/design/copy-rules.md, rule 4).
    var note = state.loadoutIdx === state.bestLoadout ? "" :
      "Scoring the " + (cur.label || cur.classification) + " bracelet — the board ranks the highest, not this one";
    host.innerHTML = '<div class="bi-axis"><span class="lab">Loadout</span>' +
      '<span class="bi-axispills">' + pills + "</span>" +
      '<span class="bi-axisnote">' + esc(note) + "</span></div>";
    var btns = host.querySelectorAll(".bi-axispill"), i;
    for (i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () { pickLoadout(parseInt(b.getAttribute("data-ld"), 10)); };
      })(btns[i]);
    }
  }

  function pillTitle(l, i) {
    var bits = [];
    if (l.itemLevel) bits.push("item level " + l.itemLevel);
    if (l.isRendered) bits.push("the one lostark.bible's own page draws");
    if (i === state.bestLoadout) bits.push("highest — the figure the board ranks");
    return (l.classification || "loadout") + (bits.length ? " — " + bits.join("; ") : "");
  }

  /** Click a loadout pill: fill the calculator with that loadout's bracelet. */
  function pickLoadout(i) {
    if (!state.loadouts || !state.loadouts[i]) return;
    state.loadoutIdx = i;
    state.error = null;
    applyLoadout();
  }

  // ------------------------------------------------------------------
  // handing a bracelet to the calculator
  // ------------------------------------------------------------------

  /** How many DIFFERENT brackets sit behind the pills. Usually fewer than pills. */
  function distinctBracelets() {
    if (!state.loadouts) return 0;
    var seen = [], i, sig;
    for (i = 0; i < state.loadouts.length; i++) {
      sig = statsSig(state.loadouts[i].stats);
      if (seen.indexOf(sig) < 0) seen.push(sig);
    }
    return seen.length;
  }
  function statsSig(stats) {
    var out = [], i, s;
    for (i = 0; i < (stats || []).length; i++) {
      s = stats[i];
      out.push(s.type + ":" + s.index + ":" + s.value + ":" + (s.fixed ? 1 : 0));
    }
    return out.join("|");
  }

  /**
   * Decode the selected loadout and hand it to app.js. The character block carries
   * everything the banner draws AND everything the deck could honestly fill —
   * but filling it is the user's press, not this function's.
   */
  function applyLoadout() {
    var rec = state.record;
    if (!rec) return false;
    var l = rec.loadouts[state.loadoutIdx] || rec.loadouts[0];
    if (!l) return false;

    var built;
    try {
      built = buildPatch({ stats: l.stats, rollsLeft: l.rollsLeft });
    } catch (e) {
      state.error = { kind: "undecodable", detail: rec.name };
      renderMsg();
      return false;
    }
    if (!built.patch.rows.length && !built.patch.fixedRows.length && !built.decoded.lines.length) {
      state.error = { kind: "undecodable", detail: rec.name };
      renderMsg();
      return false;
    }

    var app = root.BraceletApp;
    if (!app || !app.applyImport) {
      state.error = { kind: "api", detail: "the calculator panel is not ready" };
      renderMsg();
      return false;
    }

    built.patch.character = {
      name: rec.name,
      region: rec.region,
      "class": rec["class"] || null,
      itemLevel: l.itemLevel != null ? l.itemLevel : rec.itemLevel,
      source: rec.source,
      cached: rec.cached,
      pulledAt: rec.pulledAt || Date.now(),
      // The loadout on screen on the canonical default profile, scored the
      // board's way (defaultScore). The banner's Board rank does NOT read it:
      // that is the board's own row, or fieldRank's estimate of one.
      defaultPct: l.pct,
      grade: l.grade,
      loadoutLabel: rec.loadouts.length > 1 ? (l.label || l.classification) : null,
      // ARCHITECTURE §1.1: THIS loadout's grader profile, falling back to the
      // record's. It is carried, not applied — profile.js reads it when the user
      // presses "Import Character Stats".
      profile: l.profile || rec.profile || null
    };
    app.applyImport(built.patch);

    // THE LEFT COLUMN IS NOT FILLED HERE. The six honing levels, the necklace,
    // both earrings, the gem level, the 9/7 stone and Master all ride on
    // built.patch.character.profile, and the deck takes them only when the user
    // presses "Import Character Stats" (Shizu, 2026-08-12). Loading someone
    // gives you their bracelet and their banner; the settings stay the
    // calculator's defaults, which is what the board ranks them on.
    var canImport = !!(root.Profile && root.Profile.canImportStats && root.Profile.canImportStats());

    // THE ECONOMY IS SEEDED ON LOAD, and deliberately NOT on "Import Character
    // Stats". Gold-per-1% comes off the character's combat power and the
    // baseline off the bracelet they already wear: neither is a setting the user
    // chose, both are context about the character now on screen, and both are
    // useless a moment later if you have to ask for them. So they arrive with
    // the character (Shizu, 2026-08-12 — this reverses the day's earlier move
    // onto the button). The left column is the opposite case and still waits for
    // the button. seedEcon keys per character and never seeds over an edit.
    if (app && typeof app.seedEcon === "function") {
      try { app.seedEcon(built.patch.character); } catch (e) { /* economy is optional */ }
    }

    state.picked = rec.name;
    state.error = null;
    renderLoadoutPills();
    renderFavRow();

    // ONE LINE. Shizu, 2026-09-22: "too much text — remove it all or reduce it
    // to one line." The line states the facts; the explanation (why defaults,
    // how to import their real stats, why the copy is cached) rides in the
    // line's tooltip. The loadout/score commentary went earlier (2026-08-11):
    // the pills and the banner already say it.
    var n = built.patch.rows.length;
    var parts = [
      rec.name + (built.patch.character.loadoutLabel ? " · " + built.patch.character.loadoutLabel : ""),
      built.patch.grade === "relic" ? "Relic" : "Ancient",
      n + " slot" + (n === 1 ? "" : "s")
    ];
    var gloss = [];
    if (canImport) {
      parts.push("calculator defaults");
      gloss.push("The board ranks everyone on the calculator's defaults. Press Import Character Stats on the " +
        "character board to use " + rec.name + "'s own honing, accessories, gems and karma; the gold rate " +
        "and the baseline are already theirs.");
    }
    if (rec.stale) {
      parts.push("cached copy, ~" + (rec.staleHours || 0) + "h old");
      gloss.push("lostark.bible could not be reached, so this is a copy from about " + (rec.staleHours || 0) + "h ago.");
    }
    if (l.unmapped) {
      parts.push(l.unmapped + " unmapped line" + (l.unmapped > 1 ? "s" : ""));
      gloss.push(l.unmapped + " line" + (l.unmapped > 1 ? "s use stat indices" : " uses a stat index") +
        " the model does not map yet, so " + (l.unmapped > 1 ? "they score" : "it scores") + " zero.");
    }
    state.note = parts.join(" · ");
    state.noteGloss = gloss.join(" ");
    renderMsg();
    return true;
  }

  /** Put a whole record on screen: pills, bracelet, banner, Re-pull button. */
  function showRecord(rec) {
    if (!rec || !rec.loadouts || !rec.loadouts.length) return false;
    state.record = rec;
    state.loadouts = rec.loadouts;
    state.bestLoadout = rec.best || 0;                       // what the board ranks: the ▲
    state.loadoutIdx = rec.pick != null ? rec.pick : (rec.best || 0);   // what we OPEN on: the raid tab
    var btn = $("bi-pull-refresh");
    if (btn) { btn.style.display = ""; syncSourceUI(); }
    renderLoadoutPills();
    return applyLoadout();
  }

  // ------------------------------------------------------------------
  // the pull — runPull(), ported branch for branch
  // ------------------------------------------------------------------

  var autoRepulled = {};   // charKey -> 1 once auto-re-pulled this session

  /** The one entry point everything else calls: a chip, the banner, the console. */
  function loadCharacter(region, name, opts) {
    if (!name) return;
    selectMode("pull");
    var r = normRegion(region) || "NA";
    if ($("bi-region") && REGIONS.indexOf(r) !== -1) $("bi-region").value = r;
    if ($("bi-name")) $("bi-name").value = name;
    runPull(!!(opts && opts.refresh));
  }

  /**
   * A /character answer already in hand, put on screen exactly as runPull() puts
   * the Worker's answer there, minus the fetch. This is how a ?c= link opens the
   * record the profile page left behind (index.html, bootCharacter). Returns
   * false when the answer holds no bracelet, so the caller can fall back to
   * loadCharacter() and a real lookup.
   */
  function loadRecord(d) {
    var rec = (d && d.bracelet && d.bracelet.stats && d.bracelet.stats.length) ? fromWorkerRecord(d) : null;
    if (!rec) return false;
    selectMode("pull");
    if ($("bi-region") && REGIONS.indexOf(rec.region) !== -1) $("bi-region").value = rec.region;
    if ($("bi-name")) $("bi-name").value = rec.name || "";
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ region: rec.region, name: rec.name })); } catch (e) {}
    state.error = null;
    stopPoll(); clearRefreshBanner();
    if (!showRecord(rec)) return false;
    if (!maybeAutoRepullForProfile(rec)) setPullStatus("", "");   // the loaded line below is the confirmation
    return true;
  }

  function runPull(refresh) {
    var region = normRegion($("bi-region") && $("bi-region").value) || "NA";
    var name = (($("bi-name") && $("bi-name").value) || "").trim();
    if (!name) { setPullStatus("Enter a character name.", "err"); return; }
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ region: region, name: name })); } catch (e) {}

    state.error = null;
    stopPoll(); clearRefreshBanner();

    // The board has to be in hand before any decision: it is the cache, and on a
    // cold start it is the only source there is. One fetch, session-cached.
    if (!seedCache) {
      setPullStatus("Loading the board…", "working");
      seedIndex().then(function (idx) { seedCache = idx; runPull(refresh); });
      return;
    }

    // The baked board is a real cache: instant, free, and it needs no sign-in. A
    // Re-pull deliberately skips it — that is what Re-pull means.
    if (!refresh) {
      var hit = seedHit(region, name);
      if (hit) { showSeed(hit); return; }
    }

    if (!WORKER_URL) {
      // The honest version of "not built yet". The board characters are right there.
      var baked = seedHit(region, name);
      if (baked) {
        showSeed(baked);
        setPullStatus("Showing the copy baked into this build — a live re-pull needs the fetch service, " +
          "which is not deployed yet.", "");
        return;
      }
      setPullStatus("", "");
      state.error = { kind: "noworker", who: name };
      renderMsg();
      return;
    }

    // Refreshing the character that is CURRENTLY shown? Keep its bracelet on screen
    // with a queue banner over it, instead of blanking it for the queued panel.
    var cur = state.record;
    var refreshingCached = !!(refresh && cur && cur.loadouts && cur.loadouts.length &&
      charKey(cur.region, cur.name) === charKey(region, name));

    setPullStatus((refresh ? "Re-pulling " : "Fetching ") + name + " (" + region + ")…", "working");
    setBusy(true);

    fetchCharacter(region, name, { refresh: refresh }).then(function (r) {
      var d = r.data || {};

      // 1) the Worker says lookups are off right now
      if (d.unavailable) {
        renderLookupPanel("paused");
        setPullStatus(d.message || d.error || "Lookups are temporarily unavailable.", "err");
        return;
      }
      // There is no sign-in branch here any more, on purpose. A signed-out visitor
      // types a name and gets a bracelet; the Worker carries the pull on its own
      // token. If a `needSignIn` ever reappears in an answer, that is a Worker
      // regression to fix there — do NOT re-add a wall here.

      // 2) data present — render it. A cached bracelet stays on screen whatever
      //    else the answer says; a queue banner layers on top.
      var rec = (d.bracelet && d.bracelet.stats && d.bracelet.stats.length) ? fromWorkerRecord(d) : null;
      var show = rec || (refreshingCached ? cur : null);
      var since = show ? (show.pulledAt || 0) : 0;
      if (show) showRecord(show);

      // 3) queued
      if (d.queued) {
        if (show) {
          setPullStatus((d.stale ? "Cached (stale) — refreshing " : "Cached — refreshing ") + name + "…", "");
          showRefreshBanner(name, d);
        } else {
          setPullStatus("Queued — fetching " + name + "…", "");
          showQueued(name, d);
        }
        startQueueWatch(region, name, since, !!show, d);
        return;
      }

      if (show) {
        if (!maybeAutoRepullForProfile(show)) {
          setPullStatus("", "");   // the loaded line below is the confirmation
        }
        return;
      }

      // 4) anything else is an error, and it gets its own sentence
      var msg = d.message || d.error || "The import service returned an error.";
      setPullStatus(msg, "err");
      state.error = { kind: workerErrorKind(r.status, d.error), detail: msg, who: name };
      renderMsg();
      if (d.degraded) setFreeStatus(true);
    }).catch(function (e) {
      setPullStatus("The lookup failed: " + plainError(e) + ".", "err");
      state.error = { kind: "worker", detail: plainError(e), who: name };
      renderMsg();
    }).then(function () { setBusy(false); });
  }

  function setBusy(on) {
    state.busy = !!on;
    var go = $("bi-pull-go"), rb = $("bi-pull-refresh");
    if (go) go.disabled = !!on;
    if (rb) rb.disabled = !!on;
  }

  var seedCache = null;
  /**
   * A board row that is also a full record — only the baked board's are. A
   * live row is a summary with no stats, so a lookup on it goes to the Worker.
   */
  function seedHit(region, name) {
    var e = seedCache ? seedCache.byKey[charKey(region, name)] : null;
    return (e && e.loadouts && e.loadouts.length) ? e : null;
  }
  function showSeed(rec) {
    if (!showRecord(rec)) return;
    setPullStatus("Loaded " + rec.name + " (" + rec.region + ") from the board baked into this build — " +
      "free and instant, no lookup used.", "ok");
  }

  /**
   * A cached record with no grader-profile block predates the Worker's profile
   * fields — re-pull it once, per character, per session, so the deck can fill
   * itself instead of asking the user to press Re-pull. A FRESH pull that still
   * lacks it is cached:false and can never re-trigger this, so there is no loop.
   * (astrogem's maybeAutoRepullForCp, in our terms.)
   */
  function maybeAutoRepullForProfile(rec) {
    if (!WORKER_URL) return false;
    if (!rec || rec.cached !== true || rec.profile) return false;
    if (rec.source !== "bible") return false;                   // the seed carries its own, baked from the same pages
    // No sign-in check: a re-pull works signed out now, and skipping it would
    // leave a signed-out visitor with an empty deck for no reason.
    var k = charKey(rec.region, rec.name);
    if (autoRepulled[k]) return false;
    autoRepulled[k] = 1;
    setPullStatus("Cached record has no character stats — re-pulling " + rec.name + "…", "working");
    setTimeout(function () { runPull(true); }, 0);              // deferred: let this chain finish
    return true;
  }

  // ------------------------------------------------------------------
  // the queue — startQueueWatch(), all three mechanisms
  // ------------------------------------------------------------------

  var pollTimer = null, paintTimer = null, watching = false;

  function stopPoll() {
    watching = false;                                     // also stops the long poll's reconnect loop
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (paintTimer) { clearInterval(paintTimer); paintTimer = null; }
  }

  function fmtEta(sec) {
    if (sec == null) return "";
    if (sec < 60) return "~" + Math.max(1, Math.round(sec)) + "s";
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return "~" + m + "m" + (s ? " " + s + "s" : "");
  }
  /** "Position 3 of 12 · ~50s" from {position, total, drainPerMin}. */
  function queueLine(d) {
    if (!d || !(d.position > 0)) return "";
    var perMin = d.drainPerMin || 6;
    var head = d.position <= 1 ? "Next up"
      : ("Position " + d.position + " of " + Math.max(d.total || d.position, d.position));
    return head + " · " + fmtEta(Math.ceil(d.position / perMin * 60));
  }

  function bannerHost() { return $("bc-refresh-banner"); }
  function clearRefreshBanner() { var b = bannerHost(); if (b) b.innerHTML = ""; }

  /** A refresh of a CACHED character: a thin bar ABOVE the bracelet still on screen. */
  function showRefreshBanner(name, d) {
    var b = bannerHost();
    if (!b) return;
    var ql = queueLine(d);
    b.innerHTML = '<div class="bi-refresh-bar"><span class="bi-rb-spin">&#128260;</span><span>' +
      "<b>Refreshing " + esc((d && d.name) || name) + "</b>" +
      (ql ? ' — <span id="bi-rb-pos">' + esc(ql) + "</span>" : "") +
      ' <span class="bi-rb-dim">· the cached bracelet is loaded below · ' +
      '<span id="bi-rb-timer">checking…</span></span></span></div>';
  }

  /**
   * Nothing cached: the queue panel. Astrogem replaces its whole result pane; ours
   * rides in its own host so the calculator underneath is never blanked.
   */
  function showQueued(name, d) {
    var b = bannerHost();
    if (!b) return;
    var disp = (d && d.name) || name;
    b.innerHTML = '<div class="panel"><div class="bi-queued">' +
      '<div class="bi-queued-icon">&#9203;</div>' +
      '<div class="bi-queued-main"><b>' + esc(disp) + "</b> is in the queue." +
      '<div class="bi-queued-pos" id="bi-queued-pos">' + esc(queueLine(d)) + "</div>" +
      '<div class="bi-queued-sub">Fetching it now — this updates on its own when it is ready. ' +
      '<span id="bi-queued-timer">checking…</span></div></div>' +
      "</div></div>";
  }

  /**
   * The watch, with all three mechanisms astrogem runs at once:
   *   1) a LOCAL position countdown, one step per 60/perMin seconds — the drain
   *      rate — so the number moves every second at no server cost;
   *   2) a server RE-SYNC every 30s WHILE QUEUED, which also detects completion;
   *   3) a /wait LONG POLL that returns the instant the drain re-caches the
   *      character, so the banner clears in seconds rather than on the 30s tick.
   * Completion is gated on pulledAt > since: a stale cache hit answers with the
   * same pulledAt until the drain re-fetches, and must not pass for the refresh.
   * Ten minutes and it gives up rather than polling forever.
   */
  function startQueueWatch(region, name, since, cachedRefresh, st) {
    stopPoll();
    watching = true;
    since = since || 0;
    var perMin = (st && st.drainPerMin) || 6;
    var pos = (st && st.position > 0) ? st.position : null;
    var total = (st && st.total) || null;
    var syncAt = Date.now();
    var started = Date.now(), MAX_MS = 10 * 60 * 1000;

    function tick(html) {
      var t = $(cachedRefresh ? "bi-rb-timer" : "bi-queued-timer");
      if (t) t.innerHTML = html;
    }
    function curPos() {
      if (pos == null) return null;
      return Math.max(1, pos - Math.floor((Date.now() - syncAt) / 1000 / (60 / perMin)));
    }
    function paint() {
      var p = curPos();
      var el = $(cachedRefresh ? "bi-rb-pos" : "bi-queued-pos");
      if (el) el.innerHTML = (p == null) ? "checking…" : esc(queueLine({ position: p, total: total, drainPerMin: perMin }));
    }
    paintTimer = setInterval(paint, 1000);                       // 1) the free local tick

    function scheduleSync() { pollTimer = setTimeout(doSync, 30000); }   // 2) flat 30s while queued
    function doSync() {
      if (Date.now() - started > MAX_MS) {
        stopPoll();
        tick(cachedRefresh ? "still refreshing — try again later." : "still queued — check back later, or search again.");
        return;
      }
      fetchCharacter(region, name).then(function (r) {
        var d = r.data || {};
        var has = !!(d.bracelet && d.bracelet.stats && d.bracelet.stats.length);
        if ((d.cached || has) && (d.pulledAt || 0) > since) { finishWatch(d); return; }
        if (d.queued && d.position > 0) {
          pos = d.position;
          total = d.total || total;
          if (d.drainPerMin) perMin = d.drainPerMin;
          syncAt = Date.now();
        } else if (!d.queued && !has && (!r.ok || d.error)) {
          endWatch(d.message || d.error);
          return;
        }
        paint();
        scheduleSync();
      }).catch(function () { scheduleSync(); /* transient — keep watching */ });
    }

    function finishWatch(d) {
      stopPoll(); clearRefreshBanner();
      var rec = fromWorkerRecord(d);
      if (!rec) { endWatch("The refresh came back with no bracelet."); return; }
      showRecord(rec);
      setPullStatus("", "");   // the loaded line below is the confirmation
    }
    function endWatch(msg) {
      stopPoll(); clearRefreshBanner();
      setPullStatus(msg || "Lookup ended.", "err");
      if (!cachedRefresh) {
        state.error = { kind: "worker", detail: msg || "the lookup ended", who: name };
        renderMsg();
      }
    }

    // 3) the long poll: the Worker answers the moment the drain re-caches this
    //    character, then we reconnect. A timeout is not a failure.
    function waitLoop() {
      if (!watching) return;
      var url = WORKER_URL.replace(/\/+$/, "") + "/wait?region=" +
        encodeURIComponent(bibleRegion(region) || "NA") +
        "&name=" + encodeURIComponent(name) + "&since=" + since;
      var headers = {};
      var tok = OA.accessToken && OA.accessToken();
      if (tok) headers.Authorization = "Bearer " + tok;
      fetch(url, { headers: headers }).then(function (r) { return r.json(); }).then(function (d) {
        if (!watching) return;
        if (d && d.done && d.bracelet) finishWatch(d);
        else if (d && d.notFound) endWatch(d.message || d.error);
        else waitLoop();
      }).catch(function () { if (watching) setTimeout(waitLoop, 3000); });
    }

    paint();
    scheduleSync();
    waitLoop();
  }

  // ------------------------------------------------------------------
  // the "how lookups work now" notice
  // ------------------------------------------------------------------

  /**
   * ONE state now:
   *   "paused" -> amber: the Worker says it cannot read character pages right now.
   *   anything else -> hidden.
   *
   * The second state, "back", used to say lookups run on a signed-in account's
   * behalf and offered a sign-in button. That was true of the old consent-gated
   * build and is not true now — a signed-out visitor gets a bracelet — so it is
   * gone rather than reworded, and no branch calls it. The sign-in button lives in
   * the mode row, where it is an offer and not a gate.
   */
  function renderLookupPanel(stateName) {
    var el = $("bi-unavailable");
    if (!el) return;
    if (stateName !== "paused") { el.style.display = "none"; return; }
    el.className = "bi-unavail amber";
    el.innerHTML =
      '<div class="bi-unavail-hd">&#9888;&#65039; Character lookups are temporarily unavailable</div>' +
      '<div class="bi-unavail-bd">lostark.bible is not answering our fetch service right now, so looking a ' +
      'character up by name will not work for the moment. <b>Characters already on the board still load ' +
      'instantly</b> — they are on the right — and you can always type a bracelet in by hand.</div>';
    el.style.display = "";
  }

  // ------------------------------------------------------------------
  // sign in / load my characters / sign out — renderAuth(), ported
  // ------------------------------------------------------------------

  function renderAuth() {
    var btns = $("bi-authbtns");
    if (!btns) return;
    if (!OA.configured()) {
      btns.innerHTML = '<span class="bi-who">Import is switched off: no lostark.bible app is configured for this build.</span>';
      return;
    }
    // Signing in and out is the site nav's one control (nav.js); this row only loads.
    if (!OA.signedIn()) {
      state.chars = null; state.user = null; state.raw = null;   // signed out in the nav or another tab
      btns.innerHTML = '<span class="bi-who">Sign in with lostark.bible at the top right of the page to import your roster.</span>';
      return;
    }
    var who = state.user && (state.user.username || state.user.name || state.user.globalName || state.user.id);
    btns.innerHTML =
      (who ? '<span class="bi-who">signed in as <b>' + esc(who) + "</b></span>" : "") +
      '<button class="mbtn" id="bi-auth-load" type="button"' + (state.busy ? " disabled" : "") + ">" +
        (state.busy ? "Loading…" : "Load my characters") + "</button>";
    $("bi-auth-load").onclick = function () { loadRosters(true); };
  }

  /**
   * Sign-in -> roster -> a Favorite per character. Favorites is the spine every tab
   * reads, so favouriting here is what gives the saved grid and the Leaderboard's ★
   * section their contents without any per-tab wiring.
   */
  function loadRosters(force) {
    if (!OA.signedIn()) { render(); return; }
    if (state.busy) return;
    if (state.chars && !force) { render(); return; }
    state.busy = true; state.error = null; state.note = null; state.noteGloss = null;
    setPullStatus("Loading your roster…", "working");
    renderAuth();

    Promise.all([
      OA.user().catch(function () { return null; }),
      OA.rosters(),
      seedIndex().catch(function () { return { list: [], byKey: {} }; })
    ]).then(function (r) {
      state.busy = false;
      state.user = r[0];
      state.raw = r[1];
      var idx = r[2] || { byKey: {} };
      var chars = flattenRosters(r[1]);
      state.chars = chars;
      // The roster's own class code covers anyone the board does not know yet.
      chars.forEach(function (c) {
        var k = charKey(c.region, c.name);
        if (!favClasses[k]) {
          var known = idx.byKey[k];
          if (known && known["class"]) favClasses[k] = known["class"];
          else if (CLASS_NAME[String(c.cls || "").toLowerCase()]) favClasses[k] = CLASS_NAME[String(c.cls).toLowerCase()];
        }
      });
      var added = favoriteRoster(chars);
      renderAuth();
      renderFavRow();
      var have = chars.filter(function (c) { return !!idx.byKey[charKey(c.region, c.name)]; }).length;
      setPullStatus(chars.length + " characters · " + have + " with a bracelet already on the board" +
        (added ? " · " + added + " added to saved characters" : ""), "ok");
    }).catch(function (e) {
      state.busy = false;
      var status = e && e.status;
      if (status === 401) {
        // The token is already forgotten by bible-oauth.js. Bounce once through
        // /oauth/authorize, which auto-approves while the grant is alive.
        if (!sessionStorage.getItem(REAUTH_FLAG)) {
          try { sessionStorage.setItem(REAUTH_FLAG, "1"); } catch (err) {}
          state.error = { kind: "expired" };
          render();
          OA.login();
          return;
        }
        state.error = { kind: "reauth-failed" };
      } else {
        state.error = { kind: "api", detail: plainError(e) };
      }
      setPullStatus("Couldn't load your roster.", "err");
      render();
    });
  }

  /** Save every roster character. Additive only; returns how many were new. */
  function favoriteRoster(chars) {
    var F = root.Favorites;
    if (!F) return 0;
    var n = 0;
    (chars || []).forEach(function (c) {
      if (!c.name || !c.region) return;
      if (F.has(c.region, c.name)) return;
      F.add(c.region, c.name);
      n++;
    });
    return n;
  }

  /**
   * Flatten the rosters payload into [{region, name, cls, itemLevel}]. Region sits
   * on the ROSTER, not the character (docs/research/oauth-rosters-shape.md), so it
   * has to be inherited downward — and lostark.bible's CE becomes our EU here, once,
   * or a saved favourite would come back under a region the select refuses.
   */
  function flattenRosters(j) {
    var rosters = Array.isArray(j) ? j : (j && (j.rosters || j.data)) || [];
    var out = [];
    (Array.isArray(rosters) ? rosters : []).forEach(function (ros) {
      var chars = (ros && (ros.characters || ros.chars)) || [];
      (Array.isArray(chars) ? chars : []).forEach(function (c) {
        if (!c) return;
        var reg = normRegion(c.region || ros.region || "") ||
          String(c.region || ros.region || "").toUpperCase();
        if (reg === "CE") reg = "EU";
        out.push({
          region: reg,
          name: c.name || c.characterName || "",
          cls: c["class"] || c.className || "",
          itemLevel: c.ilvl || c.itemLevel || null,
          raw: c
        });
      });
    });
    return out;
  }

  // ------------------------------------------------------------------
  // modes
  // ------------------------------------------------------------------

  function selectMode(mode) {
    mode = mode === "manual" ? "manual" : "pull";
    state.mode = mode;
    var p = $("bi-mode-pull"), m = $("bi-mode-manual");
    if (!p || !m) return;
    p.classList.toggle("active", mode === "pull");
    m.classList.toggle("active", mode === "manual");
    $("bi-body-pull").style.display = mode === "pull" ? "" : "none";
    $("bi-body-manual").style.display = mode === "manual" ? "" : "none";
    if (mode === "pull") { renderFavRow(); setFreeStatus(); }
  }

  function bind() {
    $("bi-mode-pull").onclick = function () { selectMode("pull"); };
    $("bi-mode-manual").onclick = function () { selectMode("manual"); };
    $("bi-pull-go").onclick = function () { runPull(false); };
    $("bi-pull-refresh").onclick = function () { runPull(true); };
    $("bi-name").onkeydown = function (e) { if (e.key === "Enter") runPull(false); };
    $("bi-region").onchange = syncSourceUI;
    syncSourceUI();
  }

  // ------------------------------------------------------------------
  // the probe helper
  // ------------------------------------------------------------------

  /**
   * BraceletImport.dumpShape() — what /api/oauth/rosters actually returns.
   * Prints every key path plus the first character node, and hands the payload
   * back so it can be copied. The answer belongs in
   * docs/research/oauth-rosters-shape.md; redact character and account names.
   */
  function dumpShape() {
    if (!state.raw) {
      if (!OA.signedIn()) { console.log("[bracelet] not signed in — click the button first."); return null; }
      console.log("[bracelet] no payload yet — fetching…");
      return OA.rosters().then(function (j) { state.raw = j; return dumpShape(); });
    }
    var paths = keyPaths(state.raw, "rosters");
    console.log("[bracelet] /api/oauth/rosters key paths (" + paths.length + "):\n" + paths.join("\n"));
    var chars = findCharacters(state.raw);
    console.log("[bracelet] character-shaped nodes:", chars.length,
      chars.map(function (c) { return c.name + " @ " + c.path; }));
    console.log("[bracelet] bracelet found on first character:", chars.length ? !!findBracelet(chars[0].node) : "n/a");
    console.log("[bracelet] raw payload:", state.raw);
    return state.raw;
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  function boot() {
    var box = mount();
    if (!box) return false;
    render();
    // Keep the saved grid honest when a star is toggled anywhere — here, on the
    // banner, or on the Leaderboard.
    if (root.Favorites) root.Favorites.onChange(function () { renderFavRow(); });
    OA.onChange(function () { renderAuth(); });
    // Warm the board so the first chip click and the first field rank are instant.
    seedIndex().then(function (idx) { seedCache = idx; renderFavRow(); });
    // A redirect back from the consent screen carries ?code=…; swap it for a
    // token, scrub the address bar, then load the roster straight away.
    OA.handleRedirect().then(function (r) {
      if (r && !r.ok) {
        state.error = r.error === "access_denied"
          ? { kind: "api", detail: "you turned the request down" }
          : { kind: "api", detail: r.error };
        render();
        return;
      }
      if (r && r.ok) { try { sessionStorage.removeItem(REAUTH_FLAG); } catch (e) {} }
      if (OA.signedIn()) loadRosters(true);
      else renderAuth();
    });
    return true;
  }

  // app.js builds the pane this mounts into, so wait for the host rather than
  // racing it: script order already puts app.js first, but a lazy load or a slow
  // parse must not lose the panel.
  function waitForPanel(tries) {
    if (boot()) return;
    if (tries <= 0) return;
    setTimeout(function () { waitForPanel(tries - 1); }, 60);
  }

  // Console shorthand for the probe. Signed in, `__probeRosters()` prints the
  // real shape of /api/oauth/rosters. See docs/research/oauth-rosters-shape.md.
  root.__probeRosters = dumpShape;

  root.BraceletEcon = Econ;

  root.BraceletImport = {
    dumpShape: dumpShape,
    findCharacters: findCharacters,
    findBracelet: findBracelet,
    buildPatch: buildPatch,
    /** Rolls left from lostark.bible's two used-counts (4 and 3 = none left); null when neither is known. */
    rollsLeft: rollsLeftOf,
    reload: function () { loadRosters(true); },
    raw: function () { return state.raw; },
    // The loadouts behind the pills, and a way to switch without clicking:
    //   BraceletImport.loadouts()
    //   BraceletImport.pickLoadout(1)
    loadouts: function () { return state.loadouts; },
    pickLoadout: pickLoadout,
    // The one load entry point — a chip, the character banner and the console all
    // come through here, so every path lands in identical state.
    loadCharacter: loadCharacter,
    // The same landing for a /character answer already in hand (a ?c= link that
    // found the profile page's copy). False when it holds no bracelet.
    loadRecord: loadRecord,
    /**
     * cb(message, kind) after every status line a pull writes; kind is "",
     * "working", "ok" or "err". Returns an unsubscribe. For anything that shows
     * the same sentence somewhere else — the character picker does — so nobody
     * has to watch the status element for it.
     */
    onStatus: function (cb) {
      if (typeof cb !== "function") return function () {};
      statusListeners.push(cb);
      return function () {
        var i = statusListeners.indexOf(cb);
        if (i !== -1) statusListeners.splice(i, 1);
      };
    },
    record: function () { return state.record; },
    // The board figure + where a bracelet sits on the board (app.js draws both).
    defaultScore: defaultScore,
    fieldRank: fieldRank,
    /** The board — live, kept 10 minutes, or baked — as {list, byKey, lists, source, …}. See board(). */
    board: board,
    seed: seedIndex,
    // Console handles for checking a fresh deploy without clicking:
    //   BraceletImport.workerUrl()
    //   BraceletImport.fetchCharacter("NA", "Paroxysmal").then(console.log)
    workerUrl: function () { return WORKER_URL; },
    fetchCharacter: fetchCharacter
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { waitForPanel(50); });
  } else {
    waitForPanel(50);
  }
})(window);
