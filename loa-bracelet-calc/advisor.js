/**
 * advisor.js — the Advisor tab: a simulator for a bracelet you might roll.
 *
 * The Calculator grades the bracelet you hold. This tab asks what a DIFFERENT
 * one would do for you (docs/design/GAMEPLAN.md, rulings of 2026-09-24:
 * "Advisor = the simulator"). Shizu's brief: pull up the current bracelet, then
 * slide a bracelet from 60/60 to 120/120 and from 0 to 7 rolls, and show what it
 * is worth, the odds it beats yours and how high it can go. The tab this one
 * replaced was "pretty hard to use", so simplicity is the requirement: two
 * brackets — yours, and the one you might roll — and one answer.
 *
 *   YOUR BRACELET  BraceletApp.baseline.get(): grade, score, damage %, lines,
 *                  traits and whose it is — or, with no bracelet set, the
 *                  Calculator's hand-set Baseline %. A character picker above
 *                  it, and an editor in place: grade, both traits, the granted
 *                  lines, every change written through baseline.set().
 *   A BRACELET YOU MIGHT ROLL
 *                  one combat-trait slider (both lines at one value, the
 *                  baseline's two kinds), rolls left 0-7, grade, slot count and
 *                  the granted slots: "not rolled yet" (an unrolled solve, the
 *                  default) or "rolled — these lines", where an empty slot is a
 *                  junk line. Picking any family switches to "rolled".
 *   WHAT YOU'D GET the odds it beats yours, what it is worth paying, where it
 *                  finishes if it does and if it does not, and where it can land:
 *                  the spread, a pointer readout of P(final >= here) and the odds
 *                  of each grade. Live as the sliders move.
 *   LOCK ADVICE    the rolling flow this tab used to lead with — best locks, the
 *                  lock table, keep or replace — collapsed under one <details>
 *                  and run against the simulated bracelet. It opens only for a
 *                  rolled bracelet with a roll left, the one state it answers.
 *   METHOD         how the numbers are worked out; collapsed, last.
 *
 * THE SIMULATOR'S STATE IS ITS OWN. Traits, rolls, grade, slots, mode, lines and
 * the cut flow's padlocks, roll and history live under LS_KEY, not in
 * profile.js: the bracelet being simulated is not the bracelet being graded, and
 * editing one must never move the other. What IS shared is the character —
 * every figure is scored on P.profile(), the one profile every tab reads — and
 * the gold rate on S.econ.
 *
 * THE CONTRACT WITH app.js (window.BraceletApp). This file computes nothing
 * app.js already owns, so no figure here can drift from the Calculator's:
 *   baseline.get() / .onChange(fn)   the bracelet to beat, or null
 *   compare.fromCdf(cdf, D)          P(beat), the conditional means, the gain
 *   worth.fromCdf(cdf, pct, 0)       the one worth formula
 *   strip.html(o) / .layout(root)    the p10-p90 strip with the baseline marked
 *   solver.solve(spec)               any bracelet, on its own lane of the ONE
 *                                    shared worker, through its cache
 *   solver.send(cmd, payload, o)     keep or replace: the simulated bracelet's
 *                                    context into the worker, then "advise"
 *   fmt / tierWord                   the house formatters and tier words
 *
 * NOTHING OF THE CALCULATOR'S IS MOUNTED HERE ANY MORE. The Advisor used to
 * borrow the character deck and the grader panel and move them in and out on
 * every tab switch; the Calculator owns both now and neither moves. The
 * screenshot intake went with them: it filled the Calculator's bracelet, and
 * this tab no longer edits that bracelet.
 */
(function () {
  "use strict";

  var B = window.Bracelet, DATA = window.BraceletData, P = window.Profile;
  if (!B || !DATA || !P) return;                 // model or spine missing; leave the placeholder

  var PANE_ID = "tab-advisor";
  var LS_KEY = "loa-bracelet-advisor-sim";       // the simulator's own settings, never profile.js's
  var S = P.get();                               // the LIVE shared state — the gold rate is on it
  var PARTY_IDS = { 16: 1, 17: 1, 18: 1, 19: 1 };
  var DEBOUNCE_MS = 120;                         // live under the hand: one solve per pause
  var ROLLS_MAX = 7;                             // 4 base rolls + 3 tickets
  var EACH_DEFAULT = 100;
  // Shizu: "from 60/60 to 120/120". The bottom of the slider is 60 or the
  // grade's own floor, whichever is higher, and the top is the grade's own
  // ceiling: an Ancient line rolls 61-120 and a Relic one 41-100, and a bracelet
  // the game cannot produce must not be priced as if it could.
  var EACH_FLOOR = 60;
  var TRAIT_KEYS = P.TRAIT_KEYS;
  var TRAIT_SHORT = { crit: "Crit", spec: "Spec", swift: "Swift" };
  var GRADE_COLOR = P.GRADE_COLOR, JUNK = P.JUNK;

  // ------------------------------------------------------------------
  // small helpers (duplicated across the modules — there is no module system
  // here, and profile.js's header says the same about its copies)
  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function fx(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }
  function nf(v) { return Math.round(v).toLocaleString("en-US"); }
  function gold(g) {
    var a = Math.abs(g);
    if (a >= 1e6) return (g / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return Math.round(g / 1e3) + "k";
    return String(Math.round(g));
  }
  /** D (log-space score) -> the exact combined damage percentage. */
  function pct(D) { return B.damagePercent(D); }
  /** The inverse: a damage percentage back to the model's log-space score. */
  function dOf(p) { return 100 * Math.log(1 + p / 100); }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- the house formatters: app.js's, through BraceletApp.fmt ----
  //
  // Damage percentages read to two decimals and odds to one, on every tab. The
  // one-line fallbacks exist so a stale cached app.js degrades to the same rule
  // rather than throwing; they are not a second implementation.
  function FMT() { var A = window.BraceletApp; return (A && A.fmt) || null; }
  function dmg(v) { var f = FMT(); return f ? f.dmg(v) : fx(num(v, 0), 2) + "%"; }
  function signPct(d) { var f = FMT(); return f ? f.signDmg(d) : (d >= 0 ? "+" : "") + fx(d, 2) + "%"; }
  function odds(p) { var f = FMT(); return f ? f.odds(p) : fx(clamp(num(p, 0), 0, 1) * 100, 1) + "%"; }
  /** Heroic / Epic / Legendary — never "low", "mid", "high". */
  function tierWord(t) { var A = window.BraceletApp; return (A && A.tierWord) ? A.tierWord(t) : String(t); }
  /** A gold DIFFERENCE, signed. */
  function signGold(g) {
    if (!g) return "0";
    return (g >= 0 ? "+" : "−") + gold(Math.abs(g));
  }
  function gpd() { return num(S.econ.gpd, 0); }
  /** A gold DIFFERENCE between two continuation values, for the verdict. */
  function deltaGold(Da, Db) { return (pct(Da) - pct(Db)) * gpd(); }

  // ------------------------------------------------------------------
  // the contract with app.js
  // ------------------------------------------------------------------

  function App() { return window.BraceletApp || null; }

  /**
   * Which piece of the contract is missing from the page, or "". A cached
   * app.js can be a release behind a fresh advisor.js; the tab then says so
   * once instead of throwing on its first figure.
   */
  function contractGap() {
    var A = App(), miss = [];
    if (!A) return "app.js";
    if (!A.baseline || typeof A.baseline.get !== "function") miss.push("baseline");
    if (!A.compare || typeof A.compare.fromCdf !== "function") miss.push("compare");
    if (!A.strip || typeof A.strip.html !== "function") miss.push("strip");
    if (!A.worth || typeof A.worth.fromCdf !== "function") miss.push("worth");
    if (!A.solver || typeof A.solver.solve !== "function" || typeof A.solver.send !== "function") miss.push("solver");
    return miss.join(", ");
  }
  /** The bracelet to beat, or null: baseline.get() with its D, % and grade on the live profile. */
  function baselineNow() {
    var A = App();
    return (A && A.baseline && typeof A.baseline.get === "function") ? A.baseline.get() : null;
  }
  /**
   * THE BAR TO BEAT. The baseline bracelet when one is set; with none, the
   * Economy's hand-set Baseline %, which is what worth reads on every tab then
   * (GAMEPLAN.md, rulings of 2026-09-24: the manual slider exists exactly when
   * no baseline bracelet does). baseline.get() answers only for a bracelet, so
   * the hand-set figure is read here — or the Calculator would price worth
   * against it while this tab priced the same bracelet against nothing.
   * Returns baseline.get()'s object, or {manual, pct, D}, or null for 0%.
   */
  function barNow() {
    var b = baselineNow();
    if (b) return b;
    var p = num(S.econ.baseline, 0);
    return p > 0 ? { manual: true, pct: p, D: dOf(p) } : null;
  }
  /** P(final >= D) and the finish on either side of it, off one distribution. */
  function compareCdf(cdf, D) {
    var A = App();
    return (A && A.compare && typeof A.compare.fromCdf === "function") ? A.compare.fromCdf(cdf, D) : null;
  }
  /** app.js's one worth formula, for a distribution against a bar in damage %. */
  function worthCdf(cdf, barPct) {
    var A = App();
    return (A && A.worth && typeof A.worth.fromCdf === "function") ? A.worth.fromCdf(cdf, barPct, 0) : null;
  }
  function solverApi() { var A = App(); return (A && A.solver) || null; }

  // ------------------------------------------------------------------
  // the simulated bracelet — this tab's own state, under its own key
  // ------------------------------------------------------------------

  function blankRow() { return { fam: "none", tier: "mid", value: null }; }

  function simDefaults() {
    return {
      v: 1,
      each: EACH_DEFAULT,        // both combat traits, per line
      rolls: ROLLS_MAX,          // rerolls left
      grade: null,               // null = follow the baseline's grade, else Ancient
      slots: 3,
      slotsPref: 3,              // the count the reader chose; slots returns to it when the grade allows
      mode: "fresh",             // "fresh" = not rolled yet; "rolled" = these lines
      price: null,               // gold for one bracelet like this, as the reader entered it; null = none
      rows: [blankRow(), blankRow(), blankRow()],
      // the keep-or-replace flow's own state, against THIS bracelet
      locks: null,               // per-slot booleans; null = follow the solver's pick
      rolled: null,              // per-slot rows: what the roll gave you
      history: []
    };
  }

  /** A stored family value this build still knows, or "none". */
  function knownFam(f) {
    if (typeof f !== "string") return "none";
    if (f === "none" || f === JUNK || f === "basic:mainStat" || f === "basic:vitality") return f;
    if (f.indexOf("trait:") === 0) {
      for (var i = 0; i < DATA.TRAITS.families.length; i++) if ("trait:" + DATA.TRAITS.families[i].key === f) return f;
      return "none";
    }
    if (f.indexOf("sp:") === 0 && DATA.SPECIAL_BY_ID[Number(f.slice(3))]) return f;
    return "none";
  }
  function cleanRow(r) {
    r = r || {};
    return {
      fam: knownFam(r.fam),
      tier: (r.tier === "low" || r.tier === "high") ? r.tier : "mid",
      value: (r.value === null || r.value === undefined || r.value === "") ? null : num(r.value, null)
    };
  }
  function cleanRows(list) {
    var out = [], i;
    for (i = 0; i < list.length && i < 3; i++) out.push(cleanRow(list[i]));
    return out;
  }

  /** Rows, padlocks and the half-entered roll always match the slot count. */
  function fitSim(s) {
    while (s.rows.length < s.slots) s.rows.push(blankRow());
    if (s.rows.length > s.slots) s.rows.length = s.slots;
    if (s.locks && s.locks.length !== s.slots) s.locks = null;
    if (s.rolled && s.rolled.length !== s.slots) s.rolled = null;
  }

  function loadSim() {
    var d = simDefaults(), raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { raw = null; }
    if (raw && typeof raw === "object") {
      d.each = Math.round(num(raw.each, d.each));
      d.rolls = clamp(Math.round(num(raw.rolls, d.rolls)), 0, ROLLS_MAX);
      d.grade = (raw.grade === "ancient" || raw.grade === "relic") ? raw.grade : null;
      d.slots = (raw.slots === 1 || raw.slots === 2) ? raw.slots : 3;
      d.slotsPref = (raw.slotsPref === 1 || raw.slotsPref === 2 || raw.slotsPref === 3) ? raw.slotsPref : d.slots;
      d.mode = raw.mode === "rolled" ? "rolled" : "fresh";
      d.price = (typeof raw.price === "number" && isFinite(raw.price) && raw.price > 0) ? Math.round(raw.price) : null;
      if (raw.rows && raw.rows.length) d.rows = cleanRows(raw.rows);
      if (raw.locks && raw.locks.length) d.locks = raw.locks.map(function (x) { return !!x; });
      if (raw.rolled && raw.rolled.length) d.rolled = cleanRows(raw.rolled);
      if (raw.history && raw.history.length) d.history = raw.history.slice(-30);
    }
    fitSim(d);
    return d;
  }

  var SIM = loadSim();
  function saveSim() { try { localStorage.setItem(LS_KEY, JSON.stringify(SIM)); } catch (e) { /* private mode */ } }

  // ---- what the controls describe, in the model's terms ----

  function baseGrade() {
    var b = baselineNow();
    return (b && (b.grade === "ancient" || b.grade === "relic")) ? b.grade : null;
  }
  function simGrade() { return SIM.grade || baseGrade() || "ancient"; }
  function isRolled() { return SIM.mode === "rolled"; }

  /** The granted-slot counts a grade can have: Ancient 2 or 3, Relic 1 or 2 (app.js, specOf). */
  function legalSlots(grade) { return grade === "relic" ? [1, 2] : [2, 3]; }
  /**
   * Keep the slot count legal for the grade in force — which can move under the
   * controls when the grade follows your bracelet. The count is the one the
   * reader chose whenever the grade allows it, else the grade's larger one: a
   * trip through Relic, the simulator following an edit of your bracelet, must
   * not leave an Ancient bracelet at two slots for good.
   */
  function fitSlots() {
    var legal = legalSlots(simGrade());
    var want = legal.indexOf(SIM.slotsPref) >= 0 ? SIM.slotsPref : legal[legal.length - 1];
    if (SIM.slots === want) return;
    SIM.slots = want;
    fitSim(SIM);
    SIM.locks = null; SIM.rolled = null;
    saveSim();
  }

  /** The slider's range for a grade: [60 or the band floor, the band ceiling]. */
  function eachRange(grade) {
    var SR = window.Subrank;
    var lo = (SR && SR.TRAIT_FLOOR && SR.TRAIT_FLOOR[grade]) || (grade === "relic" ? 41 : 61);
    var hi = (SR && SR.TRAIT_CEILING && SR.TRAIT_CEILING[grade]) || (grade === "relic" ? 100 : 120);
    return [Math.max(EACH_FLOOR, lo), hi];
  }
  /**
   * The per-line trait value being simulated, inside the grade's range. The
   * stored value is left alone, so an Ancient 120 survives a trip through Relic.
   */
  function simEach() {
    var r = eachRange(simGrade());
    return clamp(Math.round(num(SIM.each, EACH_DEFAULT)), r[0], r[1]);
  }

  /** The pair a role runs with no bracelet to copy — subrank.js's own pair. */
  function rolePair() { return P.role() === "support" ? ["spec", "swift"] : ["crit", "spec"]; }
  /**
   * The two trait KINDS the simulated bracelet carries: your bracelet's own two
   * (crit+spec, crit+swift, spec+swift), or the role's pair when there is no
   * bracelet to copy. Only the value is the slider's.
   */
  function traitKinds() {
    var b = baselineNow(), t = b && b.traits, got = [], out = [], pair = rolePair(), i, k, v;
    if (t) {
      for (i = 0; i < TRAIT_KEYS.length; i++) {
        k = TRAIT_KEYS[i]; v = num(t[k], 0);
        if (v > 0) got.push({ k: k, v: v });
      }
    }
    // A third trait is an illegal bracelet the Calculator still scores; the two
    // strongest are the pair a real one would carry.
    if (got.length > 2) { got.sort(function (a, c) { return c.v - a.v; }); got.length = 2; }
    for (i = 0; i < got.length; i++) out.push(got[i].k);
    for (i = 0; i < pair.length && out.length < 2; i++) if (out.indexOf(pair[i]) < 0) out.push(pair[i]);
    out.sort(function (a, c) { return TRAIT_KEYS.indexOf(a) - TRAIT_KEYS.indexOf(c); });
    return out;
  }
  function simTraits() {
    var out = { crit: 0, spec: 0, swift: 0 }, k = traitKinds(), e = simEach(), i;
    for (i = 0; i < k.length; i++) out[k[i]] = e;
    return out;
  }
  function kindsLabel(kinds) {
    var out = [], i;
    for (i = 0; i < kinds.length; i++) out.push(TRAIT_SHORT[kinds[i]] || kinds[i]);
    return out.join(" / ");
  }

  // ------------------------------------------------------------------
  // rows <-> model lines
  // ------------------------------------------------------------------

  function msBands() { return DATA.BASIC.bands; }
  function msRange(grade, fam) {
    var b = msBands();
    return [b[0][grade][fam][0], b[b.length - 1][grade][fam][1]];
  }
  function defaultBasicValue(grade, fam) { return Math.round(B.basicBandExpected(fam, grade)); }

  function rowToLine(r, grade, junkFam) {
    if (!r || !r.fam || r.fam === "none") return null;
    if (r.fam === JUNK) {
      var jf = junkFam || junkFamPool(grade)[0];
      return { cat: "special", family: jf, tier: "low", junk: true };
    }
    if (r.fam.indexOf("basic:") === 0) {
      var fam = r.fam.slice(6);
      var v = (r.value === null || r.value === undefined || r.value === "") ? defaultBasicValue(grade, fam) : num(r.value, defaultBasicValue(grade, fam));
      var rg = msRange(grade, fam);
      return { cat: "basic", family: fam, value: clamp(v, rg[0], rg[1]) };
    }
    if (r.fam.indexOf("trait:") === 0) return { cat: "trait", family: r.fam.slice(6) };
    return { cat: "special", family: Number(r.fam.slice(3)), tier: r.tier || "mid" };
  }

  function familyIdOf(line) {
    if (line.cat === "basic") return "basic:" + line.family;
    if (line.cat === "trait") return "trait:" + line.family;
    return "special:" + line.family;
  }

  /**
   * The granted lines the solve reads. Not rolled yet: none — the lines are
   * unknown and the solve averages over every first draw. Rolled: one per slot,
   * and an EMPTY slot is a junk line (Shizu: "Empty = junk is fine to still
   * calculate").
   */
  function simLines() {
    if (!isRolled()) return [];
    var reps = junkReps(), grade = simGrade(), out = [], i, r;
    for (i = 0; i < SIM.slots; i++) {
      r = SIM.rows[i] || blankRow();
      out.push(rowToLine(r.fam === "none" ? { fam: JUNK } : r, grade, reps[i]));
    }
    return out;
  }

  /** The solver's own label for a line. Locks come back as these keys. */
  function stateKeyOf(line, grade, profile) {
    var d = B.lineDamage(line, grade, profile);
    if (Math.abs(d) <= 1e-12) return "junk:" + line.cat;
    if (line.cat === "basic") {
      var bands = msBands();
      for (var b = 0; b < bands.length; b++) {
        var rg = bands[b][grade][line.family];
        if (line.value >= rg[0] && line.value <= rg[1]) return "basic:" + line.family + ":b" + b;
      }
      return "basic:" + line.family + ":b0";
    }
    if (line.cat === "trait") return "trait:" + line.family;
    return "special:" + line.family + ":" + line.tier;
  }

  /** Duplicate families and the per-category caps are both illegal in game. */
  function validateSet(lines) {
    var seen = {}, cnt = { basic: 0, trait: 0, special: 0 }, i;
    for (i = 0; i < lines.length; i++) {
      var f = familyIdOf(lines[i]);
      if (seen[f]) return "Two slots hold the same effect — a bracelet cannot roll a duplicate.";
      seen[f] = 1;
      cnt[lines[i].cat]++;
    }
    if (cnt.basic > DATA.CAPS.basic) return "More than " + DATA.CAPS.basic + " basic-stat lines — a bracelet cannot roll that.";
    if (cnt.trait > DATA.CAPS.trait) return "More than " + DATA.CAPS.trait + " combat-trait lines — a bracelet cannot roll that.";
    if (cnt.special > DATA.CAPS.special) return "More than " + DATA.CAPS.special + " special effects — a bracelet cannot roll that.";
    return null;
  }

  // ---- the "Junk Line" stand-ins (see app.js's long note on junkFamPool) ----
  //
  // NOT CACHED BY GRADE. Which families score nothing depends on the ROLE as
  // much as on the grade; the copy this file used to carry cached on the grade
  // alone, the very bug app.js records from 2026-08-14. P.famGrades is already
  // cached per grade and role, and the sort over thirty families costs nothing.
  function junkFamPool(grade) {
    var fg = P.famGrades(grade), sum = DATA.GRANTED_LISTED_SUM, list = [], k, id, fam, w, t;
    for (k in fg.special) if (Object.prototype.hasOwnProperty.call(fg.special, k)) {
      if (fg.special[k].letter !== "F") continue;
      id = Number(k); fam = DATA.SPECIAL_BY_ID[id];
      if (!fam) continue;
      w = 0;
      for (t = 0; t < DATA.TIERS.length; t++) w += fam.granted[DATA.TIERS[t]] / sum;
      list.push({ id: id, w: w });
    }
    list.sort(function (a, b) { return a.w - b.w || a.id - b.id; });
    var out = [];
    for (k = 0; k < list.length; k++) out.push(list[k].id);
    return out;
  }

  /** One stand-in per slot, skipping every special family a slot already names. */
  function junkReps() {
    var pool = junkFamPool(simGrade()), used = {}, i, r, out = [], sets = [SIM.rows, SIM.rolled || []], s;
    for (s = 0; s < sets.length; s++) {
      for (i = 0; i < sets[s].length; i++) {
        r = sets[s][i];
        if (r && r.fam && r.fam.indexOf("sp:") === 0) used[Number(r.fam.slice(3))] = 1;
      }
    }
    for (i = 0; i < pool.length && out.length < SIM.slots; i++) if (!used[pool[i]]) out.push(pool[i]);
    while (out.length < SIM.slots) out.push(pool[out.length] || pool[0]);
    return out;
  }

  // ------------------------------------------------------------------
  // the family / rarity pickers
  //
  // A copy of app.js's granted-slot picker, deliberately: app.js does not
  // export it, and both read the same official tables and the same Profile
  // letters, so they cannot drift in what they MEAN — only in where they live.
  // Two uses here: the simulated bracelet's own slots (ids av-s-*) and the cut
  // flow's "what the roll gave you" (av-n-*). Never app.js's bc-*: app.js binds
  // its row handler on the DOCUMENT, so a shared prefix would have both files
  // writing one row on one change event.
  // ------------------------------------------------------------------

  // The colours only. The WORDS come from app.js's one map (tierWord above).
  var TIER_COLOR = { low: "#5aa9e6", mid: "#c78cff", high: "#ffb86b" };

  function famGroupOf(fam) {
    if (PARTY_IDS[fam.id]) return "Party";
    var wp = false, only = true, i;
    for (i = 0; i < fam.comp.length; i++) {
      var k = fam.comp[i].k;
      if (k === "weaponPower") wp = true;
      else if (k !== "atkMoveSpeed") only = false;
    }
    return (wp && only) ? "Weapon Power" : null;
  }

  function cleanFamLabel(fam) {
    return fam.label
      .replace(/;\s*ally[^;]*$/i, "")
      .replace(/\(1\/party\)/g, "")
      .replace(/[+−-]\s*[AXB]%?/g, "")
      .replace(/\s+([;,])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/[;,]$/, "");
  }

  /** app.js's, tight join and all: this text has to fit the same 208px box. */
  function tierValueText(fam, grade, tier) {
    var vals = fam.values[grade][tier], parts = [], i, j, c;
    for (i = 0; i < vals.length; i++) {
      c = null;
      for (j = 0; j < fam.comp.length; j++) if (fam.comp[j].from === i) { c = fam.comp[j]; break; }
      var flat = c && (c.k === "weaponPower" || c.k === "mainStat");
      parts.push("+" + (flat ? nf(vals[i]) : vals[i] + "%"));
    }
    return parts.join("/");
  }

  /**
   * Every family a slot can hold, grouped, letter-graded, the F families folded
   * into one "Junk Line". `held` is the family the row is showing, and the fold
   * must never swallow it: which families grade F depends on the role, so a
   * stored family can be worthless to the role in force (app.js, familyOptions).
   */
  function familyOptions(grade, held) {
    var fg = P.famGrades(grade);
    var G = { Damage: [], Party: [], "Weapon Power": [], Stats: [], Junk: [] };
    var i, j, g;

    G.Stats.push({ val: "basic:mainStat", text: "Str / Dex / Int", letter: fg.basic.mainStat.letter, avg: fg.basic.mainStat.avg });
    G.Stats.push({ val: "basic:vitality", text: "Vitality", letter: fg.basic.vitality.letter, avg: 0 });
    for (i = 0; i < DATA.TRAITS.families.length; i++) {
      var tk = DATA.TRAITS.families[i].key;
      G.Stats.push({ val: "trait:" + tk, text: DATA.TRAITS.families[i].label + " (combat trait)", letter: fg.trait[tk].letter, avg: 0 });
    }
    for (i = 0; i < DATA.SPECIALS.length; i++) {
      var fam = DATA.SPECIALS[i], e = fg.special[fam.id];
      g = famGroupOf(fam);
      if (!g) g = e.avg > 1e-9 ? "Damage" : "Junk";
      G[g].push({ val: "sp:" + fam.id, text: cleanFamLabel(fam), letter: e.letter, avg: e.avg });
    }

    var order = ["Damage", "Party", "Weapon Power", "Stats", "Junk"], heldOpt = null;
    if (held && held !== "none" && held !== JUNK) {
      for (i = 0; i < order.length && !heldOpt; i++) {
        for (j = 0; j < G[order[i]].length; j++) if (G[order[i]][j].val === held) { heldOpt = G[order[i]][j]; break; }
      }
    }
    for (i = 0; i < order.length; i++) {
      var keep = [];
      for (j = 0; j < G[order[i]].length; j++) if (G[order[i]][j].letter !== "F") keep.push(G[order[i]][j]);
      G[order[i]] = keep;
    }
    G.Junk = [{ val: JUNK, text: "Junk Line — no damage at all", letter: "F", avg: 0 }];
    if (heldOpt && heldOpt.letter === "F") {
      G.Junk.push({ val: heldOpt.val, letter: "F", avg: 0,
        text: heldOpt.text + " — worth nothing to " + (P.role() === "support" ? "a support" : "a damage dealer") });
    }

    var groups = [];
    for (i = 0; i < order.length; i++) {
      G[order[i]].sort(function (a, b) { return b.avg - a.avg; });
      groups.push({ label: order[i], items: G[order[i]] });
    }
    return groups;
  }

  /**
   * `empty` is the first option: { text, disabled }. The simulated slots offer
   * "— empty —" as a real choice (an empty slot is a junk line, or unknown when
   * the bracelet is not rolled yet); the cut flow's rows show a disabled PROMPT,
   * because the flow needs the line the roll actually gave before it can judge.
   */
  function pickerHtml(id, groups, selected, grade, empty) {
    var full = "", i, j;
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < groups[i].items.length; j++) if (groups[i].items[j].val === selected) full = groups[i].items[j].text;
    }
    var gloss = (full ? full + " — " : "") +
      "the effect family in this slot. The letter is the family's own grade, F to S: how good its average roll is next to the best family in the game.";
    var letter = P.letterOf(selected, grade);
    var shut = letter ? GRADE_COLOR[letter] : "var(--text)";
    var h = '<select id="' + id + '" class="bc-fam" style="color:' + shut + ';font-weight:700" title="' +
      esc(full) + '" data-gloss="' + esc(gloss) + '">';
    h += '<option value="none"' + (empty.disabled ? " disabled" : "") + ' style="color:var(--dim);font-weight:400"' +
      (selected === "none" ? " selected" : "") + ">" + esc(empty.text) + "</option>";
    for (i = 0; i < groups.length; i++) {
      if (!groups[i].items.length) continue;
      h += '<optgroup label="' + esc(groups[i].label) + '">';
      for (j = 0; j < groups[i].items.length; j++) {
        var it = groups[i].items[j];
        h += '<option value="' + esc(it.val) + '" style="color:' + GRADE_COLOR[it.letter] + '" title="' + esc(it.text) + '"' +
          (selected === it.val ? " selected" : "") + ">" + esc(it.letter + " · " + it.text) + "</option>";
      }
      h += "</optgroup>";
    }
    return h + "</select>";
  }

  function tierHtml(id, fam, grade, selected) {
    var order = ["high", "mid", "low"], h = "", i, t;
    for (i = 0; i < order.length; i++) {
      t = order[i];
      h += '<option value="' + t + '" style="color:' + TIER_COLOR[t] + '"' +
        (selected === t ? " selected" : "") + ">" + esc(tierWord(t) + " · " + tierValueText(fam, grade, t)) + "</option>";
    }
    var cur = TIER_COLOR[selected] || "var(--text)";
    return '<select id="' + id + '" style="color:' + cur + ';font-weight:700" data-gloss="' +
      "The rarity this line rolled at, and what it is worth. Legendary is the family's best roll, Epic the middle one, Heroic the weakest." +
      '">' + h + "</select>";
  }

  /**
   * One slot row, in profile.js's .bc-slot shape: the label cell, the family
   * (which stretches), then the rarity or the value box when the family has one.
   */
  function rowMarkup(prefix, idx, row, label, grade, empty) {
    var isBasic = row.fam.indexOf("basic:") === 0;
    var isSpecial = row.fam.indexOf("sp:") === 0;
    var famKey = isBasic ? row.fam.slice(6) : "mainStat";
    var msValue = (row.value === null || row.value === undefined || row.value === "") ? defaultBasicValue(grade, famKey) : num(row.value, defaultBasicValue(grade, famKey));
    var rg = msRange(grade, famKey);
    var h = '<div class="bc-slot"><div class="sn">' + label + "</div>";
    h += '<div class="fld bc-famcell">' + pickerHtml(prefix + "-fam-" + idx, familyOptions(grade, row.fam), row.fam, grade, empty) + "</div>";
    if (isSpecial) {
      var fam = DATA.SPECIAL_BY_ID[Number(row.fam.slice(3))];
      h += '<div class="fld bc-tiercell">' + (fam ? tierHtml(prefix + "-tier-" + idx, fam, grade, row.tier || "mid") : "") + "</div>";
    } else {
      h += '<div class="bc-tiercell"></div>';
    }
    if (isBasic) {
      h += '<div class="fld bc-valcell"><input type="number" id="' + prefix + "-val-" + idx + '" step="1" min="' + rg[0] + '" max="' + rg[1] +
        '" value="' + msValue + '" data-gloss="The number this stat line rolled. The official bands run ' +
        rg[0] + "–" + rg[1] + " on " + (grade === "relic" ? "Relic" : "Ancient") + '."></div>';
    } else {
      h += '<div class="bc-valcell"></div>';
    }
    return h + "</div>";
  }

  // ------------------------------------------------------------------
  // line labels
  // ------------------------------------------------------------------

  function traitFamLabel(key) {
    for (var i = 0; i < DATA.TRAITS.families.length; i++) if (DATA.TRAITS.families[i].key === key) return DATA.TRAITS.families[i].label;
    return key;
  }

  /** The whole of a line's name, tier word and all — for rows with room. */
  function fullLabel(line, grade) {
    if (!line) return "—";
    if (line.junk) return "Junk Line";
    if (line.cat === "basic") return (line.family === "mainStat" ? "Str / Dex / Int +" : "Vitality +") + nf(line.value);
    if (line.cat === "trait") return traitFamLabel(line.family) + " (combat trait)";
    var fam = DATA.SPECIAL_BY_ID[line.family];
    if (!fam) return "unknown";
    return cleanFamLabel(fam) + " · " + tierWord(line.tier);
  }

  /** A pill-sized name: cut at 40 characters, tier kept. */
  function shortLabel(line, grade) {
    if (!line) return "—";
    if (line.junk || line.cat !== "special") return fullLabel(line, grade);
    var fam = DATA.SPECIAL_BY_ID[line.family];
    if (!fam) return "unknown";
    var s = cleanFamLabel(fam);
    if (s.length > 40) s = s.slice(0, 38).replace(/[\s,;]+$/, "") + "…";
    return s + " · " + tierWord(line.tier);
  }

  /**
   * The solver reports locks as state atom keys. Walk them back onto the slots:
   * greedy, because two slots can share a key only when both are junk, and junk
   * is never locked.
   */
  function locksFromKeys(keys, lines, grade, profile) {
    var out = [], used = {}, i, j;
    for (i = 0; i < lines.length; i++) out.push(false);
    for (i = 0; i < keys.length; i++) {
      for (j = 0; j < lines.length; j++) {
        if (used[j]) continue;
        if (stateKeyOf(lines[j], grade, profile) === keys[i]) { used[j] = 1; out[j] = true; break; }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // the solve
  //
  // No worker is created here. app.js owns the one worker, its queue and its
  // cache, and BraceletApp.solver.solve is the way in: a second worker would
  // double a three-second solve and answer the cut flow off a different
  // context.
  //
  // LIVE, NEVER BLANK. Every control schedules a solve 120 ms after it stops
  // moving; while one is out, the figures from the last one stay on screen,
  // dimmed, so the cards never flash empty under the hand. A solve that lands
  // after a newer one was asked for is dropped by its sequence number.
  //
  // Every solve rides solver.solve()'s own lane, one request waiting, so a newer
  // position replaces the one the slider has left. Only while this tab is on
  // screen: a hidden tab that kept solving would spend the worker on figures
  // nobody can see.
  // ------------------------------------------------------------------

  var lastRes = null;        // the last solve that landed
  var lastOpts = null;       // what it was solved for — the lock advice reads THIS, not the controls
  var lastKey = null;
  var solving = false;       // a newer solve is on its way: what is on screen is dimmed
  var solveErr = null;       // the last solve failed, in words
  var simErr = null;         // the controls describe a bracelet the game cannot roll
  var seq = 0, timer = null, retries = 0;

  function solveOpts() {
    return {
      grade: simGrade(), slots: SIM.slots, traits: simTraits(), lines: simLines(),
      rollsLeft: SIM.rolls, unrolled: !isRolled()
    };
  }
  /** The profile is part of what was solved: a role flip is a different answer. */
  function keyOf(o) { return JSON.stringify(o) + "|" + JSON.stringify(P.profile()); }

  /** Drop this tab's solve still waiting in the lane, if any. Its caller hears "superseded". */
  function dropWaiting() {
    var api = solverApi();
    if (api && typeof api.cancel === "function") api.cancel();
  }

  function schedule(now) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (now) recompute(); else timer = setTimeout(recompute, DEBOUNCE_MS);
  }

  function recompute() {
    timer = null;
    if (!isActive()) return;              // a parked tab catches up on activation
    var mine = ++seq;                     // every pass takes a number, so no older solve can land over it
    if (contractGap()) { solving = false; paintOut(); paintRoll(); return; }
    fitSlots();
    var o = solveOpts();
    simErr = validateSet(o.lines);
    paintSimWarn();
    if (simErr) { solving = false; dropWaiting(); paintOut(); paintRoll(); return; }
    var key = keyOf(o);
    // Back on the bracelet already on screen: nothing to solve, and whatever is
    // still waiting in the lane is for a position the controls have left.
    if (lastRes && key === lastKey) { solving = false; dropWaiting(); paintOut(); paintRoll(); return; }
    solving = true;
    markStale();
    var p;
    try { p = solverApi().solve(o); } catch (e) { p = Promise.reject(e); }
    p.then(function (res) {
      if (mine !== seq) return;
      solving = false; solveErr = null; retries = 0;
      lastRes = res; lastOpts = o; lastKey = key;
      paintOut(); paintRoll();
    }, function (e) {
      if (mine !== seq) return;
      // A newer request took this lane's one waiting place. If it was ours, the
      // sequence check above has already dropped this answer; if it was anyone
      // else's, ask again — a card dimmed for ever is worse than a second request.
      if (e && e.message === "superseded" && retries < 3) {
        retries++;
        setTimeout(function () { if (mine === seq) recompute(); }, 60);
        return;
      }
      solving = false;
      solveErr = (e && e.message) || "solve failed";
      paintOut(); paintRoll();
    });
  }

  // ------------------------------------------------------------------
  // the grade ladder
  //
  // Subrank's 0-100 grade: score = 100·(D − floor)/(perfect − floor), with the
  // anchors for the simulated grade on the profile being scored. Those cost
  // ~165 lineDamage() calls, so the last one is kept.
  // ------------------------------------------------------------------

  var anchorMemo = { key: null, val: null };
  function anchors(grade) {
    var SR = window.Subrank;
    if (!SR || typeof SR.anchorsFor !== "function") return null;
    var prof = P.profile(), k = grade + "|" + JSON.stringify(prof);
    if (anchorMemo.key !== k) { anchorMemo.key = k; anchorMemo.val = SR.anchorsFor(grade, prof); }
    return anchorMemo.val;
  }
  /** The 0-100 grade of a log-space score, or null without the ladder. */
  function scoreOf(D, a) {
    var span = a.perfect - a.floor;
    if (!(span > 0)) return null;
    return Math.max(0, 100 * (D - a.floor) / span);
  }
  /** The ladder's cut back in log space: the D at which a grade opens. */
  function dAtScore(s, a) { return a.floor + s / 100 * (a.perfect - a.floor); }

  // ------------------------------------------------------------------
  // styles
  //
  // Injected from here, not added to styles.css: this tab owns its look, every
  // rule is scoped to the pane, and the shared sheet belongs to the shell. The
  // controls themselves are the house's — .bc-sl sliders, .bc-seg pills and
  // .bc-slot rows from profile.js's sheet — so they read like every other
  // control on the site. Dark only, like the rest of the tool.
  // ------------------------------------------------------------------

  function injectStyle() {
    if ($("av-style")) return;
    var css = "" +
      "#tab-advisor .av-sec{margin:0 0 12px}" +
      "#tab-advisor .panel.av-sec+.panel.av-sec{margin-top:0}" +
      "#tab-advisor .av-h{margin:0 0 10px}" +
      // ---- your bracelet ----
      "#tab-advisor .av-bhead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}" +
      "#tab-advisor .av-bpct{font-size:22px;font-weight:800;color:var(--accent);letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}" +
      "#tab-advisor .av-bscore{font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}" +
      "#tab-advisor .av-bscore b{color:var(--text)}" +
      "#tab-advisor .av-bname{font-size:13px;font-weight:700}" +
      "#tab-advisor .av-blines{display:flex;flex-wrap:wrap;gap:3px 16px;margin-top:8px;font-size:12px;color:var(--dim);line-height:1.5}" +
      "#tab-advisor .av-blines span{min-width:0;overflow-wrap:anywhere}" +
      "#tab-advisor .av-grade{display:inline-block;min-width:26px;text-align:center;padding:1px 7px;border-radius:6px;" +
        "font-weight:800;font-size:12px;letter-spacing:.02em;line-height:1.5;text-decoration:none}" +
      "#tab-advisor .av-none{margin:0;font-size:13px;color:var(--dim)}" +
      // ---- editing your bracelet: the simulator's controls, for a worn one ----
      "#tab-advisor #av-base-body{margin-top:10px}" +
      "#tab-advisor .av-bbtns{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}" +
      "#tab-advisor .av-bbtns .mbtn{padding:4px 12px;font-size:12px}" +
      "#tab-advisor .av-eform{margin-top:12px}" +
      "#tab-advisor .av-eform .bc-segrow{margin-bottom:12px}" +
      "#tab-advisor .av-etr{display:flex;flex-wrap:wrap;gap:8px 16px;min-width:0}" +
      "#tab-advisor .av-etp{display:inline-flex;align-items:center;gap:6px}" +
      "#tab-advisor .av-etp select,#tab-advisor .av-etp input{background:var(--panel2);color:var(--text);" +
        "border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-family:inherit;font-size:13px}" +
      "#tab-advisor .av-etp input{width:70px}" +
      "#tab-advisor .av-etp select:focus,#tab-advisor .av-etp input:focus{outline:1px solid var(--accent)}" +
      "#tab-advisor .av-elb{margin:0 0 6px}" +
      // ---- the bracelet you might roll ----
      // Two columns on a wide screen — the shape of the bracelet on the left,
      // its lines on the right — one under 1020px.
      "#tab-advisor .av-simgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:4px 28px;align-items:start}" +
      "@media(max-width:1020px){#tab-advisor .av-simgrid{grid-template-columns:minmax(0,1fr)}}" +
      // The value chip is wider than the deck's: it holds a pair, "100 / 100".
      "#tab-advisor .av-sim .bc-sl{grid-template-columns:96px minmax(0,1fr) 78px;margin-bottom:12px}" +
      "#tab-advisor .av-sim .bc-segrow{margin-bottom:12px}" +
      // The deck styles its pill labels only inside its own clusters; here they
      // take the slider rows' caption style so the controls read as one list.
      "#tab-advisor .av-sim .bc-segrow>.lb,#tab-advisor .av-eform .bc-segrow>.lb,#tab-advisor .av-elb .lb{font-size:10px;" +
        "text-transform:uppercase;letter-spacing:.04em;color:var(--dim);line-height:1.25}" +
      "#tab-advisor .av-pair{display:flex;flex-wrap:wrap;gap:0 22px}" +
      "#tab-advisor .av-pair>.bc-segrow{flex:1 1 190px;min-width:0}" +
      // The mode pills carry the longest words, so their label sits above them.
      "#tab-advisor .av-sim .bc-segrow.av-mode{grid-template-columns:minmax(0,1fr);gap:5px}" +
      "#tab-advisor .av-rows.off .bc-slot{opacity:.5}" +
      "#tab-advisor .bc-slot>*{min-width:0}" +
      "#tab-advisor .bc-slot select,#tab-advisor .bc-slot input{max-width:100%}" +
      "@media(max-width:640px){#tab-advisor .av-sim .bc-sl{grid-template-columns:84px minmax(0,1fr) 72px}}" +
      // ---- what you'd get ----
      "#tab-advisor .av-outhd{display:flex;align-items:center;gap:9px;margin:18px 0 10px}" +
      "#tab-advisor .av-outhd h2{margin:0}" +
      "#tab-advisor .av-busy{width:7px;height:7px;border-radius:50%;background:var(--accent);opacity:0;transition:opacity .15s}" +
      "#tab-advisor .av-busy.on{opacity:1}" +
      "@media (prefers-reduced-motion:no-preference){#tab-advisor .av-busy.on{animation:av-pulse 1s ease-in-out infinite}}" +
      "@keyframes av-pulse{0%,100%{opacity:.25}50%{opacity:1}}" +
      "#tab-advisor .av-prov{margin:-4px 0 10px;font-size:12px;color:var(--dim)}" +
      // The figures from the last solve stay up, dimmed, while the next one runs.
      "#tab-advisor .av-dim{opacity:.45;transition:opacity .12s}" +
      // FOUR CARDS, ONE ROW; two by two under 1020px; one under 560px. Fixed
      // counts, so no width can orphan a card on a row of its own.
      "#tab-advisor .av-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 12px}" +
      "@media(max-width:1020px){#tab-advisor .av-cards.six{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@media(max-width:560px){#tab-advisor .av-cards,#tab-advisor .av-cards.six{grid-template-columns:minmax(0,1fr)}}" +
      "#tab-advisor .av-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:0}" +
      "#tab-advisor .av-card .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);font-weight:700}" +
      "#tab-advisor .av-card .v{font-size:25px;font-weight:800;letter-spacing:-.02em;margin-top:5px;line-height:1.1;font-variant-numeric:tabular-nums}" +
      "#tab-advisor .av-card .s{font-size:11px;color:var(--dim);margin-top:5px;line-height:1.45}" +
      "#tab-advisor .av-card.hero{border-color:var(--accent)}" +
      "#tab-advisor .av-card .v.acc{color:var(--accent)}" +
      "#tab-advisor .av-card .v.gold{color:var(--high)}" +
      "#tab-advisor .av-card .v.good{color:var(--good)}" +
      "#tab-advisor .av-card .v.bad{color:var(--bad)}" +
      // "about 19 bracelets": the count carries the weight, the words sit back.
      "#tab-advisor .av-card .v .u{font-size:14px;font-weight:700;letter-spacing:0;color:var(--dim)}" +
      // Price vs worth is one line of words, not a figure.
      "#tab-advisor .av-card .v.line{font-size:15px;letter-spacing:0;line-height:1.35;margin-top:7px}" +
      // ---- the price per bracelet ----
      "#tab-advisor .av-pricebox{min-width:0}" +
      "#tab-advisor .av-pricebox input{width:100%;max-width:180px;background:var(--panel2);color:var(--text);" +
        "border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-family:inherit;font-size:13px;font-variant-numeric:tabular-nums}" +
      "#tab-advisor .av-pricebox input:focus{outline:1px solid var(--accent)}" +
      "#tab-advisor .av-pricebox input.bad{border-color:var(--bad)}" +
      "#tab-advisor .av-pricebox .av-warn{margin:5px 0 0;font-size:11.5px}" +
      // ---- where it can land ----
      // The readout rides above the strip, at the pointer; pan-y keeps a
      // vertical swipe scrolling the page while a sideways drag reads the curve.
      "#tab-advisor .av-stripwrap{position:relative;padding-top:24px;cursor:crosshair;touch-action:pan-y;" +
        "-webkit-user-select:none;user-select:none}" +
      "#tab-advisor .av-readout{position:absolute;top:0;left:0;white-space:nowrap;font-size:11px;line-height:1.5;" +
        "color:var(--text);background:#10131c;border:1px solid var(--border);border-radius:6px;padding:1px 7px;" +
        "pointer-events:none;display:none;font-variant-numeric:tabular-nums}" +
      "#tab-advisor .av-hair{position:absolute;top:22px;bottom:0;width:1px;background:var(--text);opacity:.55;pointer-events:none;display:none}" +
      "#tab-advisor .av-stripwrap.on .av-readout,#tab-advisor .av-stripwrap.on .av-hair{display:block}" +
      "#tab-advisor .av-godds{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:14px}" +
      "#tab-advisor .av-godds>.lb{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-right:2px}" +
      "#tab-advisor .av-go{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 3px;border:1px solid var(--border);" +
        "border-radius:99px;background:var(--panel2);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}" +
      "#tab-advisor .av-go.here{border-color:var(--accent)}" +
      // ---- lock advice ----
      "#tab-advisor details.av-roll{margin-top:12px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:0 16px}" +
      "#tab-advisor details.av-roll>summary{cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:.12em;" +
        "color:var(--accent);font-weight:700;padding:11px 0}" +
      "#tab-advisor details.av-roll[open]>summary{border-bottom:1px solid var(--border)}" +
      "#tab-advisor .av-rollbody{padding:4px 0 14px}" +
      "#tab-advisor .av-rolloff{margin-top:12px;border:1px dashed var(--border);border-radius:10px;padding:11px 16px;" +
        "font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);font-weight:700;text-decoration:none}" +
      "#tab-advisor .av-rsec+.av-rsec{border-top:1px solid var(--border);margin-top:14px;padding-top:2px}" +
      "#tab-advisor .av-rsec h2{margin:14px 0 10px}" +
      // ONE SLOT ROW, THREE SECTIONS: the best locks and the keep-or-replace
      // checkboxes are one bracelet seen twice, drawn with the grader row's own
      // height and rhythm (profile.js, .bc-slot). Locked is green everywhere.
      "#tab-advisor .av-slotrow{display:flex;align-items:center;gap:8px;min-height:44px;margin:0 0 8px;" +
        "padding:4px 8px;border:1px solid transparent;border-radius:9px;font-size:12.5px}" +
      "#tab-advisor .av-slotrow.on{border-color:var(--good);background:rgba(110,231,168,.07)}" +
      "#tab-advisor .av-slotrow>.sn{flex:0 0 100px;font-size:10px;color:var(--dim);text-transform:uppercase;" +
        "letter-spacing:.05em;line-height:1.5}" +
      "#tab-advisor .av-slotrow>.sn input{accent-color:var(--accent);margin:0 6px 0 0;vertical-align:middle}" +
      // flex BASIS 0, never auto: with auto a nowrap line's own width becomes the
      // row's minimum and the page scrolls sideways at 375px.
      "#tab-advisor .av-slotrow>.ln{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;" +
        "white-space:nowrap;line-height:1.45;text-decoration:none}" +
      "#tab-advisor .av-slotrow.on>.ln{color:var(--text)}" +
      "#tab-advisor .av-tabwrap{overflow-x:auto}" +
      // Up to twelve rows of six columns in a narrow box: fixed layout, the lock
      // cell ellipsises, and the table scrolls in its own wrapper, never the page.
      "#tab-advisor .av-lk table{font-size:12px;table-layout:fixed;min-width:430px}" +
      "#tab-advisor .av-lk th:first-child,#tab-advisor .av-lk td:first-child{width:34%}" +
      "@media(max-width:700px){#tab-advisor .av-lk th:first-child,#tab-advisor .av-lk td:first-child{width:26%}}" +
      "#tab-advisor .av-lk th,#tab-advisor .av-lk td{padding:5px 6px;vertical-align:top}" +
      "#tab-advisor .av-lk th{white-space:normal;line-height:1.25}" +
      "#tab-advisor .av-lk td.num{white-space:nowrap}" +
      "#tab-advisor .av-lk tr.rec td{color:var(--accent)}" +
      "#tab-advisor .av-lkl{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.5;text-decoration:none}" +
      "#tab-advisor .av-lkl>i{font-style:normal;font-weight:700;color:var(--dim);margin-right:6px}" +
      "#tab-advisor .av-lkl.none{color:var(--dim)}" +
      "#tab-advisor .av-mk{display:inline-block;margin-bottom:2px;padding:0 6px;border-radius:99px;font-size:9.5px;" +
        "font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.6;border:1px solid var(--accent);color:var(--accent)}" +
      "#tab-advisor .av-mk.odds{border-color:var(--high);color:var(--high)}" +
      // minmax(0,1fr), never a bare 1fr: a bare 1fr is minmax(AUTO,1fr), and a
      // <select> with a half-sentence option would push the page past a phone.
      "#tab-advisor .av-cutgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}" +
      "#tab-advisor .av-verdict{border-radius:10px;padding:13px 15px;margin-top:12px;border:1px solid var(--border);background:var(--panel2)}" +
      "#tab-advisor .av-verdict.keep{border-color:var(--good)}" +
      "#tab-advisor .av-verdict.replace{border-color:var(--high)}" +
      "#tab-advisor .av-verdict .hd{font-size:19px;font-weight:800;letter-spacing:-.01em}" +
      "#tab-advisor .av-verdict.keep .hd{color:var(--good)}" +
      "#tab-advisor .av-verdict.replace .hd{color:var(--high)}" +
      "#tab-advisor .av-verdict .bd{font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.55}" +
      "#tab-advisor .av-hist{list-style:none;margin:8px 0 0;padding:0;font-size:12.5px}" +
      "#tab-advisor .av-hist li{padding:6px 0;border-bottom:1px solid var(--border);line-height:1.5}" +
      "#tab-advisor .av-hist li:last-child{border-bottom:none}" +
      "#tab-advisor .av-warn{color:var(--bad);font-size:12.5px;margin:8px 0;line-height:1.55}" +
      "#tab-advisor .av-empty{border:1px dashed var(--border);border-radius:10px;background:var(--panel2);color:var(--dim);" +
        "font-size:13px;padding:18px 16px;line-height:1.6}" +
      "#tab-advisor .av-empty b{color:var(--text)}" +
      "@media(max-width:420px){#tab-advisor .av-card .v{font-size:21px}}";
    var st = document.createElement("style");
    st.id = "av-style";
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------------
  // 1. YOUR BRACELET
  // ------------------------------------------------------------------

  function badgeHtml(key, bg, fg, gloss) {
    return '<span class="av-grade" style="background:' + bg + ";color:" + fg + '"' +
      (gloss ? ' data-gloss="' + esc(gloss) + '"' : "") + ">" + esc(key) + "</span>";
  }

  function traitsText(t) {
    var out = [], i, k, v;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i]; v = num(t[k], 0);
      if (v > 0) out.push(TRAIT_SHORT[k] + " " + Math.round(v));
    }
    return out.join(" / ");
  }

  /** The head row both views share: the badge, the 0-100, the damage % and whose it is. */
  function baseHeadHtml(b) {
    var h = '<div class="av-bhead">';
    if (b.gradeKey && b.bg) h += badgeHtml(b.gradeKey, b.bg, b.fg || "#fff", "Its grade on the 0–100 ladder the Calculator and the leaderboard use.");
    if (okNum(b.score)) h += '<span class="av-bscore"><b>' + fx(b.score, 1) + "</b> of 100</span>";
    h += '<span class="av-bpct" data-gloss="What your bracelet adds in damage on the character the Calculator is scoring. Every figure below is measured against it.">' +
      dmg(b.pct) + "</span>";
    // An import is named for its character; a bracelet set by hand is only
    // "Your bracelet", which the heading already says.
    var who = b.source === "import" ? (b.name || b.label) : (b.label && b.label !== "Your bracelet" ? b.label : "");
    if (who) h += '<span class="av-bname">' + esc(who) + "</span>";
    return h + "</div>";
  }

  /**
   * The buttons under either view. Set from the Calculator and Clear are there
   * in both, as the brief asks; Clear only when there is a bracelet to forget —
   * the hand-set Baseline % is the Calculator's slider, not a bracelet.
   */
  function baseBtnsHtml(b) {
    var h = '<div id="av-b-btns"><div class="av-bbtns">';
    h += EDIT
      ? '<button type="button" class="mbtn" id="av-b-done">Done</button>'
      : '<button type="button" class="mbtn" id="av-b-edit" data-gloss="Change its grade, traits and lines by hand.">Edit</button>';
    h += '<button type="button" class="mbtn" id="av-b-set" data-gloss="Make the bracelet in the Calculator&#39;s grader your bracelet.">Set from the Calculator</button>';
    if (b && !b.manual) {
      h += '<button type="button" class="mbtn" id="av-b-clear" data-gloss="Forget this bracelet. Every figure goes back to comparing against no bracelet.">Clear</button>';
    }
    h += "</div>";
    // One box for the row and its message, so a repaint swaps both at once.
    return h + (baseMsg ? '<div class="av-warn">' + esc(baseMsg) + "</div>" : "") + "</div>";
  }

  /**
   * The summary: the head row, then its grade, traits and lines — what
   * baseline.get() reads on the live profile, so a Role press or any setting
   * on the Calculator moves it here too.
   */
  function baseHtml() {
    var b = barNow(), i;
    if (!b) return '<p class="av-none">Pick your character above, or press Edit to enter your bracelet.</p>' + baseBtnsHtml(null);
    if (b.manual) {
      return '<div class="av-bhead"><span class="av-bpct" data-gloss="The Baseline % set by hand in the Calculator&#39;s Economy. Every figure below is measured against it.">' +
        dmg(b.pct) + '</span><span class="av-bscore">set by hand on the Calculator</span></div>' + baseBtnsHtml(b);
    }
    var grade = b.grade === "relic" ? "relic" : "ancient", h = baseHeadHtml(b);
    var parts = [grade === "relic" ? "Relic" : "Ancient"], lines = (b.fixed || []).concat(b.lines || []);
    if (b.traits) { var tt = traitsText(b.traits); if (tt) parts.push(tt); }
    for (i = 0; i < lines.length; i++) parts.push(fullLabel(lines[i], grade));
    h += '<div class="av-blines">';
    for (i = 0; i < parts.length; i++) h += "<span>" + esc(parts[i]) + "</span>";
    return h + "</div>" + baseBtnsHtml(b);
  }

  // ------------------------------------------------------------------
  // 1b. EDITING YOUR BRACELET
  //
  // Shizu, 2026-09-24: "you should be able to edit 'your bracelet' as well."
  // The editor mirrors the simulator's controls for a bracelet AS WORN: grade,
  // the two combat traits — each its own kind and points, because a worn
  // bracelet is rarely an even pair — and the granted lines, an empty slot a
  // junk line. No rolls left: your bracelet is not rolling any more. No slot
  // count either: a junk line scores nothing, so an empty third row IS a
  // two-slot bracelet as far as any figure can tell.
  //
  // EVERY CHANGE WRITES THROUGH BraceletApp.baseline.set(). This file keeps no
  // copy of the baseline that could drift: app.js and profile.js re-score and
  // re-grade the snapshot, and baseline.onChange repaints the cards, the strip
  // and the lock table exactly as a character load does. The draft below only
  // holds what the controls show between writes — a number half typed, and the
  // third line a switch to Relic hides.
  //
  // OURS OR SOMEONE ELSE'S. set() notifies synchronously, so `writing` is true
  // for exactly as long as the change is ours: then only the readout above the
  // controls repaints, under the cursor. Anything else that moves the bracelet
  // — a character picked, Set from the Calculator, Clear — reloads the draft,
  // and a write still waiting on its debounce is dropped rather than landed on
  // top of the new bracelet. The picker's load wins.
  // ------------------------------------------------------------------

  var EDIT = null;           // null = the summary; else the editor's draft
  var editTimer = null;      // a write waiting while a number is typed
  var writing = false;       // inside our own baseline.set()
  var baseMsg = null;        // one refused "Set from the Calculator", in words
  var EDIT_DEBOUNCE = 250;

  /** The rows a grade shows: Ancient 3, Relic 2. */
  function maxSlots(grade) { var l = legalSlots(grade); return l[l.length - 1]; }
  /** A worn trait's own band: the game's, 61-120 Ancient and 41-100 Relic. */
  function traitBandOf(grade) {
    var SR = window.Subrank;
    return [(SR && SR.TRAIT_FLOOR && SR.TRAIT_FLOOR[grade]) || (grade === "relic" ? 41 : 61),
      (SR && SR.TRAIT_CEILING && SR.TRAIT_CEILING[grade]) || (grade === "relic" ? 100 : 120)];
  }

  /** What the snapshot says, in a way that ignores its readings: changes only when the bracelet does. */
  function sigOf(b) {
    return b ? JSON.stringify([b.grade, b.traits, b.lines, b.fixed, b.label, b.source, b.setAt]) : "none";
  }

  /** A model line back into the picker's own row. */
  function rowOfLine(l) {
    if (!l) return blankRow();
    if (l.junk) return { fam: JUNK, tier: "mid", value: null };
    if (l.cat === "basic") return { fam: knownFam("basic:" + l.family), tier: "mid", value: num(l.value, null) };
    if (l.cat === "trait") return { fam: knownFam("trait:" + l.family), tier: "mid", value: null };
    if (l.cat === "special") return { fam: knownFam("sp:" + l.family), tier: l.tier || "mid", value: null };
    return blankRow();
  }

  /**
   * The name an edited bracelet goes by. An import keeps its character's name
   * with the edit said out loud — the figures are no longer quite that
   * character's — and anything else keeps its label.
   */
  function editLabel(b) {
    if (!b) return "Your bracelet";
    if (b.source !== "import") return String(b.label || "Your bracelet");
    var n = String(b.name || b.label || "Your bracelet");
    return /, edited$/.test(n) ? n : n + ", edited";
  }

  /** The draft for a bracelet, or a fresh one — your role's pair at 100 — for none. */
  function draftOf(b) {
    var grade = (b && b.grade === "relic") ? "relic" : "ancient";
    var t = (b && b.traits) || {}, got = [], pair = rolePair(), rows = [], lines = (b && b.lines) || [], i, k, v;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i]; v = num(t[k], 0);
      if (v > 0) got.push({ k: k, v: v });
    }
    if (got.length > 2) { got.sort(function (x, y) { return y.v - x.v; }); got.length = 2; }
    for (i = 0; i < pair.length && got.length < 2; i++) {
      if (!(got.length && got[0].k === pair[i])) got.push({ k: pair[i], v: EACH_DEFAULT });
    }
    got.sort(function (x, y) { return TRAIT_KEYS.indexOf(x.k) - TRAIT_KEYS.indexOf(y.k); });
    for (i = 0; i < lines.length && rows.length < 3; i++) rows.push(rowOfLine(lines[i]));
    while (rows.length < 3) rows.push(blankRow());
    return {
      grade: grade,
      kinds: [got[0].k, got[1].k],
      vals: [Math.round(got[0].v), Math.round(got[1].v)],
      rows: rows,
      fixed: (b && b.fixed) ? deepCopy(b.fixed) : [],
      label: editLabel(b),
      src: sigOf(b),
      err: null
    };
  }

  /**
   * A trait value as the grade in force allows it. The draft keeps what was
   * typed, so a trip through Relic (41-100) and back leaves an Ancient 118 at
   * 118; only what is written and shown is held to the band.
   */
  function editVal(E, i) { var b = traitBandOf(E.grade); return clamp(E.vals[i], b[0], b[1]); }

  /** The draft as a snapshot for baseline.set(): the shape baseline.get() hands out. */
  function snapshotOf(E) {
    var traits = { crit: 0, spec: 0, swift: 0 }, lines = [], n = maxSlots(E.grade), i, r;
    traits[E.kinds[0]] = editVal(E, 0);
    traits[E.kinds[1]] = editVal(E, 1);
    for (i = 0; i < n; i++) {
      r = E.rows[i] || blankRow();
      // Empty, junk, or anything the line reader cannot place: a junk line.
      lines.push((!r.fam || r.fam === "none" || r.fam === JUNK) ? { junk: true } : (rowToLine(r, E.grade) || { junk: true }));
    }
    return { grade: E.grade, traits: traits, lines: lines, fixed: E.fixed, label: E.label, source: "edit" };
  }

  /** Write the draft through. A bracelet the game cannot hold is not written; the editor says why. */
  function writeBase() {
    if (editTimer) { clearTimeout(editTimer); editTimer = null; }
    var A = App();
    if (!EDIT || !A || !A.baseline || typeof A.baseline.set !== "function") return;
    var snap = snapshotOf(EDIT), real = (EDIT.fixed || []).slice(), i;
    for (i = 0; i < snap.lines.length; i++) if (!snap.lines[i].junk) real.push(snap.lines[i]);
    EDIT.err = validateSet(real);
    paintEditWarn();
    if (EDIT.err) return;
    writing = true;
    try { A.baseline.set(snap); } finally { writing = false; }
    EDIT.src = sigOf(baselineNow());
  }
  function writeSoon() {
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(writeBase, EDIT_DEBOUNCE);
  }

  function kindOptions(sel) {
    var h = "", i, k;
    for (i = 0; i < TRAIT_KEYS.length; i++) {
      k = TRAIT_KEYS[i];
      h += '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + esc(TRAIT_SHORT[k]) + "</option>";
    }
    return h;
  }

  function editHeadHtml(b) {
    return b ? baseHeadHtml(b) : '<div class="av-bhead"><span class="av-bscore">Not set yet: the first change sets it.</span></div>';
  }

  function editHtml() {
    var E = EDIT, g = E.grade, band = traitBandOf(g), b = baselineNow(), i;
    var h = '<div id="av-e-head">' + editHeadHtml(b) + "</div>";
    h += '<div class="av-simgrid av-eform" id="av-e-form"><div>';
    h += segHtml("Grade", "avegrade", [["ancient", "Ancient"], ["relic", "Relic"]], g,
      "It sets the values each line rolls and the trait range: 61–120 on Ancient, 41–100 on Relic.");
    h += '<div class="bc-segrow"><span class="lb" data-gloss="' +
      esc("The two combat traits it came with, each its own kind and points: " + band[0] + "–" + band[1] + " on " +
        (g === "relic" ? "Relic" : "Ancient") + ". They never reroll.") + '">Traits</span><div class="av-etr">';
    for (i = 0; i < 2; i++) {
      h += '<span class="av-etp"><select id="av-e-tk-' + i + '" aria-label="Trait ' + (i + 1) + '">' + kindOptions(E.kinds[i]) + "</select>" +
        '<input type="number" id="av-e-tv-' + i + '" min="' + band[0] + '" max="' + band[1] + '" step="1" value="' + editVal(E, i) +
        '" aria-label="Trait ' + (i + 1) + ' points"></span>';
    }
    h += "</div></div></div><div>";
    h += '<div class="av-elb"><span class="lb" data-gloss="The lines it rolled. An empty slot is a junk line.">Granted slots</span></div>';
    for (i = 0; i < maxSlots(g); i++) {
      h += rowMarkup("av-e", i, E.rows[i], "Slot " + (i + 1), g, { text: "— empty: a junk line —", disabled: false });
    }
    h += '<div id="av-e-warn">' + (E.err ? '<div class="av-warn">' + esc(E.err) + "</div>" : "") + "</div></div></div>";
    return h + baseBtnsHtml(b);
  }

  function paintEditWarn() {
    var el = $("av-e-warn");
    if (el) el.innerHTML = (EDIT && EDIT.err) ? '<div class="av-warn">' + esc(EDIT.err) + "</div>" : "";
  }

  // ------------------------------------------------------------------
  // 2. A BRACELET YOU MIGHT ROLL
  //
  // One row per control, the house's own controls. The slider paints its chip
  // on every step and asks for a solve when the hand stops; nothing under the
  // cursor is ever rebuilt mid-drag.
  // ------------------------------------------------------------------

  function segHtml(label, attr, options, cur, gloss, cls) {
    var h = "", i;
    for (i = 0; i < options.length; i++) {
      h += '<button type="button" data-' + attr + '="' + esc(options[i][0]) + '" aria-pressed="' +
        (String(options[i][0]) === String(cur) ? "true" : "false") + '">' + esc(options[i][1]) + "</button>";
    }
    return '<div class="bc-segrow' + (cls ? " " + cls : "") + '"><span class="lb"' +
      (gloss ? ' data-gloss="' + esc(gloss) + '"' : "") + ">" + esc(label) + "</span>" +
      '<div class="bc-seg" role="group" aria-label="' + esc(label) + '">' + h + "</div></div>";
  }

  function pairText(e) { return e + " / " + e; }

  // ---- the price per bracelet ----
  //
  // Shizu, 2026-09-24: "i want to see per bracelet cost." What a bracelet like
  // this one costs to buy is a market fact the tool cannot see, so the reader
  // types it: 500k, 1.2M, 900000 or 1,200,000. It changes no solve — only the
  // two cards that read it — so it repaints the cards and nothing else.

  var priceTimer = null, priceErr = false;

  /**
   * "500k", "1.2M", "900000", "1,200,000", "1,2M" -> gold. null for an empty
   * box (or 0: no price), NaN for anything that is not a price.
   */
  function parsePrice(t) {
    var x = String(t == null ? "" : t).trim().toLowerCase().replace(/[\s_]/g, "");
    if (!x) return null;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?[kmb]?$/.test(x)) x = x.replace(/,/g, "");    // 1,200,000: grouping
    else if (/^\d+,\d+[kmb]?$/.test(x)) x = x.replace(",", ".");               // 1,2m: a decimal comma
    var m = /^(\d+(?:\.\d*)?|\.\d+)([kmb]?)$/.exec(x);
    if (!m) return NaN;
    var v = parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1);
    return (isFinite(v) && v > 0) ? Math.round(v) : null;
  }

  /** The stored price as the box shows it: exact, never rounded — 500k, 1.2M, 1,234,567. */
  function priceText(v) {
    if (!(v > 0)) return "";
    if (v >= 1e6 && v % 1e4 === 0) return String(v / 1e6) + "M";
    if (v >= 1e3 && v % 1e3 === 0) return String(v / 1e3) + "k";
    return nf(v);
  }

  function priceHtml() {
    return '<div class="bc-segrow av-price"><label class="lb" for="av-price" data-gloss="What a bracelet like this one — these traits, not yet rolled or rolled as shown — costs to buy. The tool cannot know it, so you enter it.">Price per bracelet</label>' +
      '<div class="av-pricebox"><input id="av-price" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. 500k"' +
      (priceErr ? ' class="bad"' : "") + ' value="' + esc(priceText(SIM.price)) + '">' +
      '<div id="av-pricewarn">' + (priceErr ? '<div class="av-warn">Not a price: try 500k, 1.2M or 900000.</div>' : "") + "</div></div></div>";
  }

  function paintPriceErr() {
    var w = $("av-pricewarn"), el = $("av-price");
    if (w) w.innerHTML = priceErr ? '<div class="av-warn">Not a price: try 500k, 1.2M or 900000.</div>' : "";
    if (el) el.classList.toggle("bad", !!priceErr);
  }

  /**
   * Take what is in the box. `settle` is the commit — Enter or leaving the box:
   * the text is tidied to the stored figure, or, if it is no price at all, the
   * box says so and the last good price stands. While typing, a half-written
   * figure waits quietly.
   */
  function commitPrice(settle) {
    if (priceTimer) { clearTimeout(priceTimer); priceTimer = null; }
    var el = $("av-price");
    if (!el) return;
    var v = parsePrice(el.value);
    if (v !== v) {
      if (settle) { priceErr = true; paintPriceErr(); }
      return;
    }
    if (priceErr) { priceErr = false; paintPriceErr(); }
    if (v !== SIM.price) { SIM.price = v; saveSim(); paintOut(); }
    if (settle) el.value = priceText(SIM.price);
  }

  function simHtml() {
    fitSlots();
    var g = simGrade(), r = eachRange(g), e = simEach(), kinds = traitKinds(), b = baselineNow(), i;
    var slotOpts = [], legal = legalSlots(g);
    for (i = 0; i < legal.length; i++) slotOpts.push([legal[i], String(legal[i])]);
    var longNames = [];
    for (i = 0; i < kinds.length; i++) longNames.push((P.TRAIT_LABELS && P.TRAIT_LABELS[kinds[i]]) || kinds[i]);
    var h = '<h2 class="av-h">A bracelet you might roll</h2><div class="av-simgrid"><div>';
    h += '<div class="bc-sl"><label class="lb" for="av-each" data-gloss="' +
      esc("Its two combat traits, both at this value: " + longNames.join(" and ") + ", the pair " +
        (b ? "your bracelet carries" : "your role runs") + ". They never reroll.") + '">' + esc(kindsLabel(kinds)) + "</label>" +
      '<div class="tk"><input id="av-each" type="range" min="' + r[0] + '" max="' + r[1] + '" step="1" value="' + e + '"></div>' +
      '<span class="chip" id="av-each-chip">' + pairText(e) + "</span></div>";
    h += '<div class="bc-sl"><label class="lb" for="av-rolls" data-gloss="Rerolls it still has. Every figure assumes each one is played perfectly.">Rolls left</label>' +
      '<div class="tk"><input id="av-rolls" type="range" min="0" max="' + ROLLS_MAX + '" step="1" value="' + SIM.rolls + '"></div>' +
      '<span class="chip" id="av-rolls-chip">' + SIM.rolls + "</span></div>";
    h += '<div class="av-pair">' +
      segHtml("Grade", "avgrade", [["ancient", "Ancient"], ["relic", "Relic"]], g,
        "It sets the values each line rolls and how high the traits go: 120 on Ancient, 100 on Relic.") +
      segHtml("Slots", "avslots", slotOpts, SIM.slots, "How many granted effect slots it has: 2 or 3 on Ancient, 1 or 2 on Relic.") +
      "</div>";
    h += priceHtml();
    h += "</div><div>";
    h += segHtml("Granted slots", "avmode", [["fresh", "Not rolled yet"], ["rolled", "Rolled — these lines"]], SIM.mode,
      "Not rolled yet: its lines are still unknown. Rolled: the lines below, with an empty slot counted as a junk line.", "av-mode");
    h += '<div class="av-rows' + (isRolled() ? "" : " off") + '">';
    for (i = 0; i < SIM.slots; i++) {
      h += rowMarkup("av-s", i, SIM.rows[i], "Slot " + (i + 1), g,
        { text: isRolled() ? "— empty: a junk line —" : "— empty —", disabled: false });
    }
    h += '</div><div id="av-simwarn"></div></div></div>';
    return h;
  }

  // ------------------------------------------------------------------
  // 3. WHAT YOU'D GET
  // ------------------------------------------------------------------

  function cardHtml(k, gloss, v, vcls, s, hero) {
    return '<div class="av-card' + (hero ? " hero" : "") + '"><div class="k" data-gloss="' + esc(gloss) + '">' + esc(k) + "</div>" +
      '<div class="v' + (vcls ? " " + vcls : "") + '">' + v + "</div>" +
      (s ? '<div class="s">' + s + "</div>" : "") + "</div>";
  }

  function rollsSub(o) {
    var n = o ? o.rollsLeft : SIM.rolls;
    if (n) return "after " + n + " roll" + (n === 1 ? "" : "s");
    return (o ? o.unrolled : !isRolled()) ? "its first draw" : "no rolls left";
  }

  function okNum(v) { return typeof v === "number" && isFinite(v); }

  /** "about 19 bracelets": one decimal under 10, whole above; the count stands out. */
  function attemptsHtml(n, exact) {
    var t = n < 10 ? fx(n, 1) : nf(Math.round(n));
    if (t === "1.0") t = "1";
    return (exact ? "" : '<span class="u">about</span> ') + t + ' <span class="u">bracelet' + (t === "1" ? "" : "s") + "</span>";
  }

  /**
   * TO BEAT YOURS: how many bracelets like this one it takes, on average, before
   * one ends better than yours — 1 / P(beat), off the same P(beat) as the card
   * that prints the odds — and what they cost in all at the reader's price.
   */
  function toBeatCardHtml(c, always, price) {
    var k = "To beat yours";
    var tail = "Each attempt is a fresh bracelet at this price, rolled out fully and thrown away if it does not beat yours — " +
      "a geometric expectation; the median attempt count is about 0.69 × this.";
    if (!c) return cardHtml(k, "How many bracelets like this one you would go through before one ends better than yours. " + tail, "—", "", "", false);
    if (!(c.pBeat > 1e-9)) {
      return cardHtml(k, "How many bracelets like this one you would go through before one ends better than yours: none of them can.",
        "—", "", "none of them beats yours", false);
    }
    var n = 1 / c.pBeat, one = Math.round(n);
    var gloss = (one <= 1
      ? "Nearly every bracelet like this one ends better than yours. "
      : "About one in " + nf(one) + " bracelets like this one ends better than yours. ") + tail;
    var sub = price ? "about " + gold(price * n) + " at " + gold(price) + " each" : "enter a price";
    return cardHtml(k, gloss, attemptsHtml(n, always), "", sub, false);
  }

  /**
   * PRICE VS WORTH: the price the reader entered against Worth paying, in one
   * line. Worth paying already counts the odds, so the two compare directly.
   */
  function priceCardHtml(price, w, hasBar) {
    var k = "Price vs worth";
    var gloss = hasBar
      ? "Your price against Worth paying. Worth paying already counts the odds — how often it beats yours and by how far — " +
        "so a price above it loses gold on average, and a price below it gains."
      : "Your price against Worth paying: what it adds over wearing no bracelet. A price above it loses gold on average, " +
        "and a price below it gains.";
    if (!price) return cardHtml(k, gloss, "—", "", "enter a price", false);
    if (!w) return cardHtml(k, gloss, "—", "", "", false);
    var pg = gold(price), wg = gold(w.gold), line, cls;
    if (pg === wg) { line = "a fair price: " + pg + " for " + wg + " of value"; cls = "line"; }
    else if (price < w.gold) { line = "a bargain: " + pg + " for " + wg + " of value"; cls = "line good"; }
    else { line = "you\u2019d pay " + pg + " for what is worth " + wg + " to you"; cls = "line bad"; }
    return cardHtml(k, gloss, esc(line), cls, "", false);
  }

  /**
   * SIX CARDS OFF ONE DISTRIBUTION, in two rows: how it lands — the odds and
   * the finish on either side of your bracelet — then what it costs — worth
   * paying, the bracelets it takes to beat yours, and your price against its
   * worth. Three across, two by two under 1020px, one under 560px: fixed
   * counts, so no width can orphan a card on a row of its own.
   *
   * Against no bracelet the odds, both halves and the count would be
   * comparisons against nothing — every outcome "beats" 0% — so the row drops
   * to the three figures that still mean something (copy-rules §6).
   */
  function cardsHtml(res, b) {
    var cdf = res && res.finalScore && res.finalScore.cdf;
    var ef = res ? pct(res.expectedFinal) : null;
    var rate = "at " + gold(gpd()) + " per 1%";
    var price = SIM.price > 0 ? SIM.price : null;
    if (!b) {
      var w0 = cdf ? worthCdf(cdf, 0) : null;
      return '<div class="av-cards">' +
        cardHtml("Expected final", "Its average finish, with the remaining rolls played perfectly.",
          res ? dmg(ef) : "—", "acc", res ? rollsSub(lastOpts) : "", true) +
        cardHtml("Worth paying", "What it adds over wearing no bracelet, in gold: its average damage × your gold per 1% (" +
          gold(gpd()) + "). A fair price for you, not a market price.", w0 ? gold(w0.gold) : "—", "gold", rate, false) +
        priceCardHtml(price, w0, false) +
        "</div>";
    }
    var c = cdf ? compareCdf(cdf, b.D) : null;
    var w = cdf ? worthCdf(cdf, b.pct) : null;
    var never = c && !(c.pBeat > 1e-9), always = !!(c && !(c.pBeat < 1 - 1e-9));
    var ib = "—", ibs = "", inot = "—", inots = "";
    if (c) {
      if (never) ibs = "it never beats yours";
      else if (okNum(c.meanIfBeat)) { ib = dmg(c.meanIfBeat); ibs = signPct(c.meanIfBeat - b.pct) + " over yours"; }
      if (always) inots = "it always beats yours";
      else if (okNum(c.meanIfNot)) { inot = dmg(c.meanIfNot); inots = dmg(b.pct - c.meanIfNot) + " short of yours"; }
    }
    var h = '<div class="av-cards six">';
    // how it lands
    h += cardHtml("Beats your bracelet",
      "How often it finishes at or above your bracelet, over every way the remaining rolls can land, each played perfectly.",
      c ? odds(c.pBeat) : "—", "acc",
      (res ? "expected final " + dmg(ef) + " · " : "") + "yours " + dmg(b.pct), true);
    h += cardHtml("If it beats", "Its average finish across the outcomes that beat your bracelet, and how far past yours that is.",
      ib, "good", ibs, false);
    h += cardHtml("If it doesn\u2019t", "Its average finish across the outcomes that fall short of your bracelet, and how far below yours that is.",
      inot, "", inots, false);
    // what it costs
    h += cardHtml("Worth paying",
      "What it is worth to you in gold: the odds it beats yours × how far past yours those finishes land, on average × your gold per 1% (" +
        gold(gpd()) + "). A fair price for you, not a market price.",
      w ? gold(w.gold) : "—", "gold", rate, false);
    h += toBeatCardHtml(c, always, price);
    h += priceCardHtml(price, w, true);
    return h + "</div>";
  }

  /**
   * The whole strip's tooltip: what the distribution is, in plain words, naming
   * only the marks this strip carries.
   */
  function stripGloss(b, cur) {
    return "Every way it can finish. The box is the middle half of the outcomes (p25 to p75); " +
      "the whisker runs p10 to p90, so one in ten finishes below it and one in ten above. " +
      "The blue line is the median" + (b ? ", the dashed line your " + (b.manual ? "baseline" : "bracelet") : "") +
      (cur !== null ? ", the orange line what it holds now" : "") +
      ". All of it assumes the remaining rolls are played perfectly.";
  }

  function landHtml(res, b) {
    var h = '<div class="panel av-sec av-land"><h2 class="av-h">Where it can land</h2>';
    if (!res) return h + '<div class="av-stripwrap" style="min-height:58px"></div></div>';
    // What it holds now means something only once it has rolled.
    var cur = (lastOpts && !lastOpts.unrolled) ? res.currentScore : null, g = stripGloss(b, cur);
    h += '<div class="av-stripwrap" id="av-strip" data-gloss="' + esc(g) + '">' +
      App().strip.html({
        q: res.finalScore.quantiles,
        base: b ? b.D : null, baseLabel: b ? "yours" : null,
        baseGloss: b ? (b.manual ? "Your baseline: " : "Your bracelet: ") + dmg(b.pct) + "." : null,
        cur: cur, curGloss: cur !== null ? "What it holds now: " + dmg(pct(cur)) + "." : null,
        gloss: g
      }) +
      '<div class="av-hair" id="av-hair"></div><div class="av-readout" id="av-readout"></div></div>';
    h += gradeOddsHtml(res);
    return h + "</div>";
  }

  /**
   * ODDS BY GRADE: the chance the finished bracelet grades at each of four
   * letters or better — one under the expected final's own letter, that letter,
   * and two over it — on the same 0-100 ladder the Calculator shows.
   */
  function gradeOddsHtml(res) {
    var SR = window.Subrank, o = lastOpts, a = anchors(o ? o.grade : simGrade());
    if (!SR || !a || typeof SR.bandsFor !== "function" || !res.finalScore || !res.finalScore.cdf) return "";
    var role = P.role(), bands = SR.bandsFor(role), sE = scoreOf(res.expectedFinal, a);
    if (sE === null) return "";
    // The bottom band opens at -Infinity, so "or better" is certain there.
    var here = SR.of(sE, role).i, last = bands.length - 2, i, chips = "";
    var top = clamp(here - 2, 0, Math.max(0, last - 3));
    for (i = Math.min(last, top + 3); i >= top; i--) {
      var bd = bands[i], c = compareCdf(res.finalScore.cdf, dAtScore(bd.min, a)), p = c ? c.pBeat : 0;
      chips += '<span class="av-go' + (i === here ? " here" : "") + '"><span class="av-grade" style="background:' +
        bd.bg + ";color:" + bd.fg + '">' + esc(bd.key) + "</span>" + odds(p) + "</span>";
    }
    return '<div class="av-godds"><span class="lb" data-gloss="The chance it finishes at this grade or better. The outlined grade is where its expected final lands.">Grade or better</span>' +
      chips + "</div>";
  }

  function outHtml() {
    var res = lastRes, b = barNow();
    var h = '<div class="av-outhd"><h2>What you&rsquo;d get</h2><span class="av-busy' + (solving ? " on" : "") + '" id="av-busy"></span></div>';
    var gap = contractGap();
    if (gap) {
      return h + '<div class="av-empty"><b>This page is out of date.</b> Reload it to load the rest of the Advisor (missing: ' +
        esc(gap) + ").</div>";
    }
    if (!b) h += '<p class="av-prov">Against no bracelet.</p>';
    if (simErr) return h + '<div class="av-empty">No figures for a bracelet the game cannot roll.</div>';
    if (solveErr && !res) {
      return h + '<div class="av-empty"><b>The solve failed:</b> ' + esc(solveErr) + ". Move any control to try again.</div>";
    }
    h += '<div id="av-figs"' + (solving || !res ? ' class="av-dim"' : "") + ">";
    h += cardsHtml(res, b) + landHtml(res, b);
    if (solveErr) h += '<div class="av-warn">The last solve failed: ' + esc(solveErr) + ". Move any control to try again.</div>";
    return h + "</div>";
  }

  // ---- the pointer readout ----
  //
  // "at 12.34%: 41.2% of outcomes land here or higher", following the pointer
  // across the strip, read off the same distribution and the same compare the
  // cards use. A mouse reads on hover; a finger reads where it taps or drags
  // and the figure stays until the next tap elsewhere.

  /**
   * The strip's own scale: the box its marks are placed in, and the damage %
   * at each end. strip.html writes the scale on its label row (data-lo,
   * data-span) for strip.layout; the marks and the labels share it.
   */
  function stripScale(wrap) {
    // The strip's owner (app.js) exports its scale: {el, lo, hi, ...}. Reading
    // the DOM for it broke once already — the reader's own ".bc-strip" rule hid
    // the box — so the export is the only source.
    var A = App();
    if (!A || !A.strip || typeof A.strip.scale !== "function") return null;
    var sc = A.strip.scale(wrap);
    if (!sc || !sc.el || !isFinite(sc.lo) || !(sc.hi > sc.lo)) return null;
    return sc;
  }

  function bindStrip() {
    var wrap = $("av-strip"), res = lastRes;
    if (!wrap || !res || !res.finalScore) return;
    var cdf = res.finalScore.cdf, out = $("av-readout"), hair = $("av-hair"), down = false;
    function show(clientX) {
      var sc = stripScale(wrap);
      if (!sc || !out || !hair) return;
      var r = sc.el.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      if (!(r.width > 0)) return;
      var f = clamp((clientX - r.left) / r.width, 0, 1);
      var v = sc.lo + f * (sc.hi - sc.lo), c = compareCdf(cdf, dOf(v));
      if (!c) return;
      var p = c.pBeat;
      out.textContent = "at " + dmg(v) + ": " + odds(p) + " of outcomes land here or higher";
      wrap.classList.add("on");
      var x = r.left + f * r.width - wr.left, w = out.offsetWidth;
      out.style.left = clamp(x - w / 2, 0, Math.max(0, wr.width - w)) + "px";
      hair.style.left = x + "px";
    }
    function hide() { wrap.classList.remove("on"); }
    wrap.addEventListener("pointerdown", function (e) { down = true; show(e.clientX); });
    wrap.addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || down) show(e.clientX); });
    wrap.addEventListener("pointerup", function () { down = false; });
    wrap.addEventListener("pointercancel", function () { down = false; });
    wrap.addEventListener("pointerleave", function (e) { down = false; if (e.pointerType === "mouse") hide(); });
  }

  // A tap anywhere off the strip puts a touch readout away.
  document.addEventListener("pointerdown", function (e) {
    var wrap = $("av-strip");
    if (wrap && e.pointerType !== "mouse" && !wrap.contains(e.target)) wrap.classList.remove("on");
  });

  // ------------------------------------------------------------------
  // painting
  // ------------------------------------------------------------------

  /** Rebuild, then put the cursor back where it was. */
  function keepFocus(fn) {
    var a = document.activeElement, id = (a && a.id) ? a.id : null;
    fn();
    if (id) { var el = $(id); if (el && el.focus && el !== document.activeElement) el.focus(); }
  }

  /**
   * The panel body: the summary, or the editor. `full` false while editing
   * repaints only the readout and the buttons — the change was ours, and the
   * control under the cursor must survive it.
   */
  function paintBase(full) {
    var el = $("av-base-body");
    if (!el) return;
    if (EDIT && !full && $("av-e-form")) {
      var hd = $("av-e-head"), bt = $("av-b-btns"), b = baselineNow();
      if (hd) hd.innerHTML = editHeadHtml(b);
      if (bt) bt.outerHTML = baseBtnsHtml(b);
      return;
    }
    keepFocus(function () { el.innerHTML = EDIT ? editHtml() : baseHtml(); });
  }

  /**
   * The character picker, on this tab too (Shizu, 2026-09-24: "the advisor
   * should still have the character selector"). Picking a character loads it
   * through the same import path the Calculator uses, which sets the baseline;
   * baseline.onChange then repaints the panel above. Same shared state as the
   * Calculator's picker — two views of one picker.
   */
  function mountPicker() {
    var host = $("av-base-pick");
    if (!host || host.getAttribute("data-mounted")) return;
    if (!window.CharPicker || typeof window.CharPicker.mount !== "function") return;
    host.setAttribute("data-mounted", "1");
    window.CharPicker.mount(host, { layout: "row", title: "Pick a character", emptyText: "No character loaded." });
  }
  function paintSim() {
    var el = $("av-sim");
    if (!el) return;
    keepFocus(function () { el.innerHTML = simHtml(); });
    paintSimWarn();
  }
  function paintSimWarn() {
    var el = $("av-simwarn");
    if (el) el.innerHTML = simErr ? '<div class="av-warn">' + esc(simErr) + "</div>" : "";
  }
  function paintOut() {
    var el = $("av-out");
    if (!el) return;
    el.innerHTML = outHtml();
    var A = App(), wrap = $("av-strip");
    if (wrap && A && A.strip && typeof A.strip.layout === "function") A.strip.layout(wrap);
    bindStrip();
  }
  function paintRoll() {
    var el = $("av-rollbox");
    if (el) keepFocus(function () { el.innerHTML = rollHtml(); });
  }
  /** A solve is on its way: dim what is up, never blank it. */
  function markStale() {
    var f = $("av-figs"), bz = $("av-busy"), rb = document.querySelector("#av-rollbox .av-rollbody"), ck = $("av-check");
    if (f) f.classList.add("av-dim");
    if (bz) bz.classList.add("on");
    if (rb) rb.classList.add("av-dim");
    if (ck) ck.disabled = true;
  }
  function paintAll() { paintBase(true); paintSim(); paintOut(); paintRoll(); }

  // ------------------------------------------------------------------
  // 4. ROLLING THIS BRACELET — LOCK ADVICE
  //
  // The flow this tab used to lead with, unchanged in what it answers and now
  // run against the SIMULATED bracelet: which slots to lock before the next
  // roll, every lock set against your bracelet, and keep-or-replace for the
  // roll you just made. Collapsed, because most visits never need it, and open
  // only for a rolled bracelet with a roll left — the one state it can answer.
  //
  // Everything in here reads the solve that LANDED (lastRes, lastOpts), never
  // the controls: while a newer solve runs, the old advice stays up dimmed and
  // still describes the bracelet it was solved for, and "Check this roll" waits.
  // ------------------------------------------------------------------

  var rollOpen = false;               // the reader opened it; a repaint must not shut it
  var lastVerdict = null;
  function rollAvail() { return isRolled() && SIM.rolls >= 1; }

  /**
   * The bar every lock is measured against: the same bar the cards use (your
   * bracelet, or the hand-set Baseline %), or — with neither — what this
   * bracelet holds now, which is always a real question.
   */
  function lockBar(res) {
    var b = barNow();
    if (b) return { D: b.D, pct: b.pct, name: b.manual ? "your baseline" : "your bracelet", vsBase: true };
    return { D: res.currentScore, pct: pct(res.currentScore), name: "what it holds now", vsBase: false };
  }

  /** One slot, the grader row's shape: number, LOCK or REROLL, the line in full. */
  function slotRowHtml(idx, locked, line, extra, grade) {
    var badge = locked
      ? ' <span class="bc-adv keep" data-gloss="Lock this slot before your next roll.">LOCK</span>'
      : ' <span class="bc-adv roll" data-gloss="Leave this one unlocked — one attempt rerolls every unlocked slot together.">REROLL</span>';
    var name = esc(fullLabel(line, grade));
    return '<div class="av-slotrow' + (locked ? " on" : "") + '">' +
      '<div class="sn">' + (extra || "") + "Slot " + (idx + 1) + badge + "</div>" +
      '<div class="ln" data-gloss="' + name + '">' + name + "</div></div>";
  }

  function locksHtml(res, o) {
    var prof = P.profile(), best = res.maskEV[0], i;
    var flags = locksFromKeys(best.lockedKeys, o.lines, o.grade, prof);
    var h = '<div class="av-rsec"><h2>Best locks for the next roll</h2>';
    for (i = 0; i < o.lines.length; i++) h += slotRowHtml(i, !!flags[i], o.lines[i], "", o.grade);
    var second = res.maskEV.length > 1 ? res.maskEV[1] : null, bar = lockBar(res);
    var w0 = worthCdf(best.cdf, bar.pct), w1 = second ? worthCdf(second.cdf, bar.pct) : null;
    var d = (w0 && w1) ? w0.gold - w1.gold : null, say = "";
    if (d !== null) {
      say = Math.round(d) === 0
        ? ", worth the same as the next best lock"
        : ", worth " + gold(Math.abs(d)) + " gold " + (d > 0 ? "more" : "less") + " than the next best lock";
    }
    return h + '<p class="note">Expected final ' + dmg(pct(best.ev)) + esc(say) + ".</p></div>";
  }

  /** The locked lines of one lock set, slot number first. */
  function lockCell(m, o, prof) {
    if (!m.lockedKeys.length) return '<span class="av-lkl none">lock nothing</span>';
    var fl = locksFromKeys(m.lockedKeys, o.lines, o.grade, prof), h = "", i, lab;
    for (i = 0; i < fl.length; i++) {
      if (!fl[i]) continue;
      lab = shortLabel(o.lines[i], o.grade);
      h += '<span class="av-lkl" data-gloss="Slot ' + (i + 1) + ": " + esc(lab) + '"><i>' + (i + 1) + "</i>" + esc(lab) + "</span>";
    }
    return h;
  }

  /**
   * THE LOCK TABLE. Every row reads one distribution — maskEV[j].cdf, where the
   * bracelet finishes with those slots locked for the next roll and every roll
   * after it played perfectly — through the SAME two functions the cards use:
   * compare.fromCdf for the odds and where it lands if it beats, worth.fromCdf
   * for the gold. The pick's curve is the whole solve's own, so its row and the
   * cards above read the same figures to the last digit; with one reader each
   * they cannot drift apart.
   */
  function locksTableHtml(res, o) {
    var prof = P.profile(), bb = lockBar(res), bar = bb.pct, rows = [], best = -1, i, c, w;
    for (i = 0; i < res.maskEV.length; i++) {
      c = res.maskEV[i].cdf ? compareCdf(res.maskEV[i].cdf, bb.D) : null;
      w = res.maskEV[i].cdf ? worthCdf(res.maskEV[i].cdf, bar) : null;
      rows.push(c && w ? { c: c, w: w } : null);
      if (rows[i] && (best < 0 || rows[i].c.pBeat > rows[best].c.pBeat + 1e-12)) best = i;
    }
    var pickWorth = rows[0] ? rows[0].w.gold : null;
    var h = '<div class="av-rsec av-lk"><h2>' + (bb.vsBase ? "Locks against " + bb.name : "Locks against what it holds") + "</h2>";
    h += '<p class="note">' + (bb.vsBase
      ? "Every row against " + bb.name.replace(/^your /, "your " + dmg(bar) + " ") + ", at " + gold(gpd()) + " gold per 1%."
      : "Every row against the " + dmg(bar) + " it holds now, at " + gold(gpd()) + " gold per 1%.") + "</p>";
    h += '<div class="av-tabwrap"><table><thead><tr>' +
      '<th><span data-gloss="Which slots you lock before pressing reroll. Everything not listed rerolls together.">Lock</span></th>' +
      '<th class="num"><span data-gloss="The average finish with exactly these slots locked now and every later roll played perfectly.">Expected</span></th>' +
      '<th class="num"><span data-gloss="How often this lock finishes at or above ' + bb.name + ', over every way the remaining rolls can land.">Beats</span></th>' +
      '<th class="num"><span data-gloss="The average of the finishes that do beat ' + bb.name + ' — not of all of them.">If it beats</span></th>' +
      '<th class="num"><span data-gloss="The odds × how far those finishes clear ' + bb.name + ' × your gold per 1%. Never negative.">Worth</span></th>' +
      '<th class="num"><span data-gloss="This lock&#39;s worth next to the pick, the top row, in gold. Negative is what it gives up.">vs pick</span></th>' +
      "</tr></thead><tbody>";
    for (i = 0; i < res.maskEV.length; i++) {
      var m = res.maskEV[i], r = rows[i], mk = "", hit = r && r.c.pBeat > 1e-9 && okNum(r.c.meanIfBeat);
      if (i === 0) mk += '<b class="av-mk" data-gloss="The solver&#39;s pick: the highest expected finish of every legal set of locks.">pick</b> ';
      if (i === best && best !== 0) mk += '<b class="av-mk odds" data-gloss="The best odds of clearing the bar, which is not always the lock with the highest average.">odds</b> ';
      h += "<tr" + (i === 0 ? ' class="rec"' : "") + "><td>" + mk + lockCell(m, o, prof) +
        '</td><td class="num">' + dmg(pct(m.ev)) + "</td>" +
        (r
          ? '<td class="num">' + odds(r.c.pBeat) + '</td><td class="num">' + (hit ? dmg(r.c.meanIfBeat) : "—") +
            '</td><td class="num">' + gold(r.w.gold) + '</td><td class="num">' +
            (i === 0 || pickWorth === null ? "—" : signGold(r.w.gold - pickWorth)) + "</td>"
          // The model attaches a distribution to every lock set it returns. None
          // means the page runs an older model than the one on disk — say so.
          : '<td class="num" colspan="4">no distribution</td>') +
        "</tr>";
    }
    h += "</tbody></table></div>";
    if (best !== 0 && rows[best] && rows[0]) {
      h += '<p class="note">Best odds and best average are different locks here: the <b>odds</b> row clears ' +
        bb.name + " more often, the <b>pick</b> row has the higher average finish.</p>";
    }
    if (res.maskCount > res.maskEV.length) {
      var rest = res.maskCount - res.maskEV.length;
      h += '<p class="note">' + rest + (rest === 1 ? " weaker lock" : " weaker locks") + " not shown.</p>";
    }
    return h + "</div>";
  }

  // ---- keep or replace ----

  function cutLocks(res, o) {
    if (SIM.locks && SIM.locks.length === SIM.slots) return SIM.locks;
    if (res && o && res.bestLockMask) return locksFromKeys(res.bestLockMask.lockedKeys, o.lines, o.grade, P.profile());
    var out = [], i;
    for (i = 0; i < SIM.slots; i++) out.push(false);
    return out;
  }

  function ensureRolled() {
    if (!SIM.rolled || SIM.rolled.length !== SIM.slots) {
      SIM.rolled = [];
      for (var i = 0; i < SIM.slots; i++) SIM.rolled.push(blankRow());
    }
    return SIM.rolled;
  }

  /**
   * KEEP is the right word HERE and nowhere else on the tab: this is the one
   * question that is genuinely keep-or-replace — the old set against the new
   * one. The lock advice above is lock-or-reroll, and says so.
   */
  function cutHtml(res, o) {
    var locks = cutLocks(res, o), i, any = false;
    ensureRolled();
    var left = o.rollsLeft - 1;
    var h = '<div class="av-rsec" id="av-cut"><h2>I rolled — keep or replace?</h2>';
    h += '<p class="note">Tick what you locked, pick what the roll gave you, and the two sets are compared by what they are worth with ' +
      left + " roll" + (left === 1 ? "" : "s") + " still to come — not by which scores more today.</p>";
    h += '<div class="av-cutgrid"><div><div class="subh"><span data-gloss="Filled from the best locks above. Change them to what you actually locked in game.">Locked for this roll</span></div>';
    for (i = 0; i < SIM.slots; i++) {
      h += slotRowHtml(i, !!locks[i], o.lines[i], '<input type="checkbox" data-avlock="' + i + '"' + (locks[i] ? " checked" : "") + ">", o.grade);
    }
    h += '</div><div><div class="subh">What the roll gave you</div>';
    for (i = 0; i < SIM.slots; i++) {
      if (locks[i]) continue;
      any = true;
      h += rowMarkup("av-n", i, SIM.rolled[i], "Slot " + (i + 1), o.grade, { text: "— the line the roll gave —", disabled: true });
    }
    if (!any) h += '<div class="note">Every slot is locked — nothing would reroll.</div>';
    h += "</div></div>";
    h += '<div class="barrow"><button class="primary" id="av-check" type="button"' + (solving ? " disabled" : "") + ">Check this roll</button>" +
      '<button class="mbtn" id="av-undo" type="button"' + (SIM.history.length ? "" : " disabled") + ">Undo last</button></div>";
    if (lastVerdict) h += verdictHtml(lastVerdict);
    h += historyHtml();
    return h + "</div>";
  }

  function verdictHtml(v) {
    if (v.error) return '<div class="av-warn">' + esc(v.error) + "</div>";
    var take = v.verdict === "replace";
    var dGold = deltaGold(v.vNew, v.vKeep), dPct = pct(v.vNew) - pct(v.vKeep);
    // Two continuation values can be level at two decimals; say so rather than
    // print "+0.00%" beside a verdict and leave it looking arbitrary.
    var level = Math.abs(dPct) < 0.005;
    return '<div class="av-verdict ' + (take ? "replace" : "keep") + '">' +
      '<div class="hd">' + (take ? "TAKE THE NEW SET" : "KEEP WHAT YOU HAVE") + "</div>" +
      '<div class="bd">New set is worth ' + dmg(pct(v.vNew)) + " against " + dmg(pct(v.vKeep)) +
      " for the old one, both counting the " + v.rollsLeft + " roll" + (v.rollsLeft === 1 ? "" : "s") + " still to come. " +
      (level
        ? "The two are level to a hundredth of a point; " + signGold(dGold) + " gold separates them. "
        : "That is " + signPct(dPct) + ", or " + signGold(dGold) + " gold. ") +
      "On today&rsquo;s score alone it would be " + dmg(pct(v.scoreNew)) + " against " + dmg(pct(v.scoreKeep)) + ".</div>" +
      '<div class="barrow"><button class="' + (take ? "primary" : "mbtn") + '" id="av-apply-new" type="button">Apply — take the new set</button>' +
      '<button class="' + (take ? "mbtn" : "primary") + '" id="av-apply-keep" type="button">Apply — keep the old set</button></div>' +
      "</div>";
  }

  function historyHtml() {
    if (!SIM.history.length) return "";
    var h = '<div class="subh">This bracelet so far</div><ul class="av-hist">', i;
    for (i = SIM.history.length - 1; i >= 0; i--) {
      var e = SIM.history[i];
      h += "<li><b>" + (e.took ? "Replaced" : "Kept") + "</b> at " + e.rollsBefore + " rolls left · " +
        (e.locked.length ? "locked " + esc(e.locked.join(", ")) : "nothing locked") + " · rolled " +
        esc(e.rolledText) + " · " + signPct(e.deltaPct) + "</li>";
    }
    return h + "</ul>";
  }

  function rollHtml() {
    var title = "Rolling this bracelet — lock advice";
    if (!rollAvail()) {
      return '<div class="av-rolloff" data-gloss="Opens once the bracelet is set to Rolled — these lines, with at least one roll left.">' +
        esc(title) + "</div>";
    }
    var res = lastRes, o = lastOpts, body;
    // Stale advice is shown dimmed only while it still has this bracelet's
    // shape; a solve for another slot count would name slots that are not there.
    if (!res || !o || o.unrolled || o.rollsLeft < 1 || o.slots !== SIM.slots || !res.maskEV || !res.maskEV.length) {
      body = '<div class="av-empty">' + (solving ? "Solving…" : "Nothing solved yet.") + "</div>";
    } else {
      body = locksHtml(res, o) + locksTableHtml(res, o) + cutHtml(res, o);
    }
    return '<details class="av-roll" id="av-roll"' + (rollOpen ? " open" : "") + "><summary>" + esc(title) + "</summary>" +
      '<div class="av-rollbody' + (solving ? " av-dim" : "") + '">' + body + "</div></details>";
  }

  // ---- the cut flow's behaviour ----

  function rolledSet(locks, o) {
    var reps = junkReps(), out = [], i;
    for (i = 0; i < SIM.slots; i++) {
      // Same slot, same junk stand-in on both sides, so a locked junk slot and a
      // rolled one can never collide into a duplicate family.
      out.push(locks[i] ? o.lines[i] : rowToLine(SIM.rolled[i], o.grade, reps[i]));
    }
    return out;
  }

  /** The worker payload for the simulated bracelet, in solver-worker.js's own protocol. */
  function workerPayload(o, ctxKey) {
    return {
      grade: o.grade, profile: P.profile(), fixedLines: [], grantedLines: o.unrolled ? [] : o.lines,
      traitValues: o.traits, slots: o.slots, rollsLeft: o.rollsLeft, goldPer1Pct: 0, baselinePct: 0,
      ctxKey: ctxKey, keepCtx: true
    };
  }

  /**
   * advise() answers off the ONE context the worker holds, and the worker checks
   * the key it was solved under. solver.solve() never leaves its context behind
   * (app.js, solveAny: it must not evict the Grader's), so a miss is the normal
   * case here: solve this bracelet into the worker on the side lane WITH its
   * context, then ask again. The first ask can still hit — when the Grader holds
   * this very bracelet, the two share one key. A missing key is a miss, never a
   * pass: without one the worker would judge the roll against whatever bracelet
   * it happens to hold.
   */
  function isCtxMiss(e) { return !!(e && /context is stale|no solved context/i.test(e.message || "")); }

  function checkRoll() {
    var api = solverApi(), res = lastRes, o = lastOpts;
    if (!api || typeof api.send !== "function" || !res || !o || solving) return;
    // A control moved and its solve has not gone out yet: judge nothing against
    // the bracelet the controls have left. Ask for the new one now instead.
    if (keyOf(solveOpts()) !== lastKey) { schedule(true); return; }
    var locks = cutLocks(res, o), newSet = rolledSet(locks, o), i;
    for (i = 0; i < newSet.length; i++) {
      if (!newSet[i]) {
        lastVerdict = { error: "Slot " + (i + 1) + " of the new roll is still empty — pick the line it gave you." };
        paintRoll(); return;
      }
    }
    var bad = validateSet(newSet);
    if (bad) { lastVerdict = { error: "That roll is not legal: " + bad }; paintRoll(); return; }

    function ask(k) {
      return api.send("advise", { current: o.lines, rolled: newSet, rollsLeft: o.rollsLeft - 1, ctxKey: k });
    }
    function reload() {
      var k = res.ctxKey || keyOf(o);
      return api.send("solve", workerPayload(o, k), { lane: "side", key: k, keepCtx: true }).then(function () { return ask(k); });
    }
    setBusyVerdict(true);
    var first = res.ctxKey ? ask(res.ctxKey) : Promise.reject(new Error("no solved context"));
    first.then(null, function (e) {
      if (isCtxMiss(e)) return reload();
      throw e;
    }).then(function (v) {
      setBusyVerdict(false);
      if (v.verdict === "unknown") lastVerdict = { error: "The solver does not recognise one of those sets — check for a duplicate effect." };
      else { v.newSet = newSet; v.locks = locks; v.grade = o.grade; lastVerdict = v; }
      paintRoll();
    }, function (e) {
      setBusyVerdict(false);
      lastVerdict = { error: "Could not judge that roll: " + ((e && e.message) || "unknown error") + ". Press Check again." };
      paintRoll();
    });
  }

  function setBusyVerdict(on) {
    var b = $("av-check");
    if (!b) return;
    b.disabled = !!on;
    b.textContent = on ? "Checking…" : "Check this roll";
  }

  /** Move the simulated bracelet on one roll. The Calculator's bracelet is never touched. */
  function applyVerdict(take) {
    var v = lastVerdict;
    if (!v || v.error) return;
    var locks = v.locks, i, lockNames = [], rolledText = [];
    for (i = 0; i < locks.length; i++) if (locks[i]) lockNames.push("slot " + (i + 1));
    for (i = 0; i < SIM.slots; i++) if (!locks[i]) rolledText.push(shortLabel(v.newSet[i], v.grade));
    SIM.history.push({
      rollsBefore: SIM.rolls, locked: lockNames, rolledText: rolledText.join(" + "), took: !!take,
      deltaPct: pct(v.vNew) - pct(v.vKeep), prevRows: deepCopy(SIM.rows)
    });
    if (SIM.history.length > 30) SIM.history.shift();
    if (take) {
      var rows = [];
      for (i = 0; i < SIM.slots; i++) rows.push(locks[i] ? SIM.rows[i] : deepCopy(SIM.rolled[i]));
      SIM.rows = rows;
    }
    SIM.rolls = Math.max(0, SIM.rolls - 1);
    SIM.locks = null; SIM.rolled = null; lastVerdict = null;
    saveSim(); paintSim(); paintRoll(); schedule(true);
  }

  function undo() {
    var e = SIM.history.pop();
    if (!e) return;
    SIM.rows = cleanRows(e.prevRows); SIM.rolls = clamp(num(e.rollsBefore, SIM.rolls), 0, ROLLS_MAX); SIM.mode = "rolled";
    fitSim(SIM);
    SIM.locks = null; SIM.rolled = null; lastVerdict = null;
    saveSim(); paintSim(); paintRoll(); schedule(true);
  }

  // ------------------------------------------------------------------
  // 5. METHOD — static, last, collapsed (docs/design/copy-rules.md §3)
  // ------------------------------------------------------------------

  function methodHtml() {
    return '<details class="method">' +
      "<summary>How the numbers on this tab are worked out</summary>" +

      "<p><b>Two bracelets.</b> The top one is yours: the bracelet your character wears, set when you pick " +
      "them, from the Calculator&rsquo;s editor, or by hand with <b>Edit</b>, and scored on the Calculator&rsquo;s " +
      "settings. Edit takes its grade, its two combat traits (each its own kind and points) and its granted " +
      "lines, an empty slot counting as a junk line; every change becomes your bracelet at once, so every figure " +
      "on the tab follows it, and it is kept when you leave. With no bracelet set it is " +
      "the Baseline % you set by hand on the Calculator, and with neither, every figure is measured against no " +
      "bracelet at all. The one below is a bracelet you might roll or buy. Its two combat " +
      "traits sit at one value &mdash; the slider &mdash; and take the two kinds yours carries; with no bracelet " +
      "loaded, a damage dealer gets Crit and Specialization and a support Specialization and Swiftness. Rolls " +
      "left is how many rerolls it still has. Grade and slots set which lines it can roll and at what values.</p>" +

      "<p><b>Not rolled yet or rolled.</b> Not rolled yet means its granted lines are still unknown, so the " +
      "solver averages over every first draw the game can hand you, each followed by every reroll left. Rolled " +
      "means the slots hold the lines you picked, and an empty slot counts as a junk line &mdash; a line worth " +
      "nothing, which the solver always rerolls. With no rolls left, a rolled bracelet is simply what it holds " +
      "and an unrolled one is its first draw.</p>" +

      "<p><b>Every outcome is counted.</b> The solver works back from the last roll to find the best lock in " +
      "every state, then carries the odds forward through those choices, so each figure comes from the exact " +
      "spread of where the bracelet finishes under perfect play &mdash; no sampling. Rolls cost silver, not " +
      "gold, and this tool treats them as free, so rolling always beats stopping.</p>" +

      "<p><b>Beats your bracelet</b> is the share of that spread at or above your bracelet&rsquo;s score. " +
      "<b>If it beats</b> and <b>if it doesn&rsquo;t</b> average the finishes on each side of it. The spread is " +
      "carried in about 160 steps; where one step straddles your score, its share is split across it rather " +
      "than counted whole. <b>Expected final</b> is the solver&rsquo;s average score turned into damage, while " +
      "the two halves average the damage itself, so when every finish lands on one side, that side can read a " +
      "hundredth or two above the expected final.</p>" +

      "<p><b>Worth paying</b> is <code>E[max(0, final% &minus; yours%)] &times; gold per 1%</code>: the odds it " +
      "beats yours, times how far past yours those finishes land on average, times your gold rate. Only the " +
      "finishes that beat your bracelet pay, so it is never negative &mdash; a bracelet you would not wear is " +
      "worth nothing to you, not a debt. It is what the bracelet is worth to you at the gold rate set on the " +
      "Calculator, not what it sells for. With no bracelet of yours loaded, it is measured against none.</p>" +

      "<p><b>Price per bracelet</b> is yours to enter: what a bracelet like this one costs to buy, which the " +
      "tool cannot know. <b>To beat yours</b> is <code>1 &divide; P(beat)</code>: how many such bracelets you " +
      "would go through, on average, before one ends better than yours, each bought at your price, rolled out " +
      "fully and thrown away if it falls short. It is a geometric expectation, so it often takes fewer: the " +
      "median is about 0.69 &times; the average. The gold under it is your price &times; that count. " +
      "<b>Price vs worth</b> sets your price against Worth paying, which already counts the odds and how far " +
      "past yours it lands, so a price above it loses gold on average and a price below it gains.</p>" +

      "<p><b>Where it can land</b> draws the same spread: the box is the middle half (p25 to p75), the whisker " +
      "p10 to p90, the line in the box the median, and the orange line your bracelet. Point at the strip, or tap " +
      "it, to read the chance of finishing at that damage or higher. <b>Grade or better</b> reads the same " +
      "spread at the grade ladder&rsquo;s cuts: grade = 100 &times; (score &minus; floor) &divide; " +
      "(anchor &minus; floor), where the floor is both traits at the bottom of the band with three worthless " +
      "lines and the anchor both traits at 110 (92 on Relic) with the three best distinct families at Epic.</p>" +

      "<p><b>Lock advice</b> opens for a rolled bracelet with a roll left. The lock table ranks sets of locks, " +
      "not lines: one attempt rerolls every unlocked slot at once. Each row reads its own spread &mdash; this " +
      "bracelet with exactly those slots locked for the next roll and every later roll played perfectly " +
      "&mdash; against your bracelet, or against what this one holds when you have none. Keep or replace " +
      "compares <b>continuation values</b>, <code>V(set, rolls left)</code>: a weaker set can be worth more " +
      "because of what it clears out of the pool for the rolls that follow. Applying a verdict moves the " +
      "simulated bracelet on one roll; it never touches the Calculator&rsquo;s.</p>" +

      "<p><b>A support is scored on one damage dealer.</b> Every figure is what one dealer next to you gains, " +
      "the unit that compares with a dealer&rsquo;s own bracelet. Where the character comes from and how each " +
      "line is scored: the <b>Method</b> tab.</p>" +
      "</details>";
  }

  // ------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------

  /** A simulated slot changed. True when picking a family flipped the mode to rolled. */
  function simRowEvent(el) {
    var m = /^av-s-(fam|tier|val)-(\d+)$/.exec(el.id || "");
    if (!m) return false;
    var row = SIM.rows[Number(m[2])], flipped = false;
    if (!row) return false;
    if (m[1] === "fam") {
      row.fam = knownFam(el.value);
      if (row.fam === JUNK || row.fam === "none") row.value = null;
      if (row.fam.indexOf("basic:") === 0 && (row.value === null || row.value === undefined || row.value === "")) {
        row.value = defaultBasicValue(simGrade(), row.fam.slice(6));
      }
      // Picking any family says the bracelet has rolled.
      if (row.fam !== "none" && !isRolled()) { SIM.mode = "rolled"; flipped = true; }
    } else if (m[1] === "tier") {
      row.tier = el.value;
    } else {
      row.value = num(el.value, row.value);
    }
    return flipped;
  }

  /** A row of "what the roll gave you" changed. */
  function cutRowEvent(el) {
    var m = /^av-n-(fam|tier|val)-(\d+)$/.exec(el.id || "");
    if (!m) return;
    var row = ensureRolled()[Number(m[2])];
    if (!row) return;
    if (m[1] === "fam") {
      row.fam = knownFam(el.value);
      if (row.fam === JUNK) row.value = null;
      if (row.fam.indexOf("basic:") === 0 && (row.value === null || row.value === undefined || row.value === "")) {
        row.value = defaultBasicValue(lastOpts ? lastOpts.grade : simGrade(), row.fam.slice(6));
      }
    } else if (m[1] === "tier") {
      row.tier = el.value;
    } else {
      row.value = num(el.value, row.value);
    }
  }

  /** A row of your bracelet, in the editor, changed. */
  function editRowEvent(el) {
    var m = /^av-e-(fam|tier|val)-(\d+)$/.exec(el.id || "");
    if (!m || !EDIT) return;
    var row = EDIT.rows[Number(m[2])];
    if (!row) return;
    if (m[1] === "fam") {
      row.fam = knownFam(el.value);
      if (row.fam === JUNK || row.fam === "none") row.value = null;
      if (row.fam.indexOf("basic:") === 0 && (row.value === null || row.value === undefined || row.value === "")) {
        row.value = defaultBasicValue(EDIT.grade, row.fam.slice(6));
      }
    } else if (m[1] === "tier") {
      row.tier = el.value;
    } else {
      row.value = num(el.value, row.value);
    }
  }

  /** The bracelet itself changed shape: the padlocks and the half-entered roll were for the old one. */
  function voidCut() { SIM.locks = null; SIM.rolled = null; lastVerdict = null; }

  function bind(pane) {
    pane.addEventListener("input", function (e) {
      var t = e.target, id = t.id || "", c;
      // The price: take it once the hand stops, so "1.2" on its way to "1.2M"
      // is never priced.
      if (id === "av-price") { if (priceTimer) clearTimeout(priceTimer); priceTimer = setTimeout(function () { commitPrice(false); }, 300); return; }
      if (id === "av-each") {
        var r = eachRange(simGrade());
        SIM.each = clamp(Math.round(num(t.value, EACH_DEFAULT)), r[0], r[1]);
        if ((c = $("av-each-chip"))) c.textContent = pairText(SIM.each);
        lastVerdict = null; retries = 0; saveSim(); schedule();
        return;
      }
      if (id === "av-rolls") {
        var was = rollAvail();
        SIM.rolls = clamp(Math.round(num(t.value, ROLLS_MAX)), 0, ROLLS_MAX);
        if ((c = $("av-rolls-chip"))) c.textContent = String(SIM.rolls);
        lastVerdict = null; retries = 0; saveSim();
        if (was !== rollAvail()) paintRoll();
        schedule();
        return;
      }
      // A basic-stat value while it is being typed: solve, but redraw nothing.
      if (/^av-s-val-\d+$/.test(id)) { simRowEvent(t); voidCut(); saveSim(); schedule(); return; }
      // Your bracelet's numbers while they are typed: write once the hand
      // stops, and only a value the grade allows — "1" on the way to "100" is
      // not a trait anyone rolled.
      if (EDIT && /^av-e-tv-\d$/.test(id)) {
        var tb = traitBandOf(EDIT.grade), tv = parseFloat(t.value);
        if (isFinite(tv) && tv >= tb[0] && tv <= tb[1]) { EDIT.vals[Number(id.slice(-1))] = Math.round(tv); writeSoon(); }
        return;
      }
      if (EDIT && /^av-e-val-\d+$/.test(id)) { editRowEvent(t); writeSoon(); return; }
      if (/^av-n-val-\d+$/.test(id)) { cutRowEvent(t); lastVerdict = null; saveSim(); }
    });

    pane.addEventListener("change", function (e) {
      var t = e.target, id = t.id || "", lk;
      if (id === "av-price") { commitPrice(true); return; }
      if (/^av-s-(fam|tier|val)-\d+$/.test(id)) {
        var flipped = simRowEvent(t);
        voidCut(); saveSim(); retries = 0;
        // A family grows or drops its rarity and value boxes; a number box is
        // left alone so the keystroke in it survives.
        if (/-fam-/.test(id) || flipped) paintSim();
        paintRoll();
        schedule(true);
        return;
      }
      if (/^av-n-(fam|tier|val)-\d+$/.test(id)) { cutRowEvent(t); lastVerdict = null; saveSim(); paintRoll(); return; }
      if (EDIT && /^av-e-(fam|tier|val)-\d+$/.test(id)) {
        editRowEvent(t);
        writeBase();
        // A family grows or drops its rarity and value boxes.
        if (/-fam-/.test(id)) paintBase(true);
        return;
      }
      if (EDIT && /^av-e-tk-\d$/.test(id)) {
        // Two kinds, always two different ones: taking the other trait's kind
        // hands it this one's.
        var ti = Number(id.slice(-1)), to = 1 - ti;
        if (EDIT.kinds[to] === t.value) EDIT.kinds[to] = EDIT.kinds[ti];
        EDIT.kinds[ti] = t.value;
        writeBase();
        paintBase(true);
        return;
      }
      if (EDIT && /^av-e-tv-\d$/.test(id)) {
        var cb = traitBandOf(EDIT.grade), ci = Number(id.slice(-1));
        EDIT.vals[ci] = clamp(Math.round(num(t.value, EDIT.vals[ci])), cb[0], cb[1]);
        t.value = EDIT.vals[ci];
        writeBase();
        return;
      }
      if ((lk = t.getAttribute && t.getAttribute("data-avlock")) !== null && lk !== undefined && lk !== "") {
        var locks = cutLocks(lastRes, lastOpts).slice();
        locks[Number(lk)] = !!t.checked;
        SIM.locks = locks; lastVerdict = null; saveSim(); paintRoll();
      }
    });

    pane.addEventListener("click", function (e) {
      var t = e.target, v;
      if (!t || !t.getAttribute) return;
      if ((v = t.getAttribute("data-avgrade"))) {
        SIM.grade = v === "relic" ? "relic" : "ancient";     // a press pins the grade; it stops following yours
        fitSlots(); voidCut(); retries = 0; saveSim(); paintSim(); paintRoll(); schedule(true);
        return;
      }
      if ((v = t.getAttribute("data-avslots"))) {
        SIM.slots = SIM.slotsPref = Math.round(num(v, 3));
        fitSim(SIM); voidCut(); retries = 0; saveSim(); paintSim(); paintRoll(); schedule(true);
        return;
      }
      if ((v = t.getAttribute("data-avmode"))) {
        SIM.mode = v === "rolled" ? "rolled" : "fresh";
        voidCut(); retries = 0; saveSim(); paintSim(); paintRoll(); schedule(true);
        return;
      }
      if ((v = t.getAttribute("data-avegrade")) && EDIT) {
        EDIT.grade = v === "relic" ? "relic" : "ancient";
        writeBase();
        paintBase(true);
        return;
      }
      if (t.id === "av-b-edit") { baseMsg = null; EDIT = draftOf(baselineNow()); paintBase(true); return; }
      if (t.id === "av-b-done") { if (editTimer) writeBase(); baseMsg = null; EDIT = null; paintBase(true); return; }
      if (t.id === "av-b-set") {
        var A = App(), got = (A && A.baseline && typeof A.baseline.setFromEditor === "function") ? A.baseline.setFromEditor() : null;
        baseMsg = got ? null : "The Calculator's bracelet has only some of its slots filled, or two lines of one effect, so it cannot be yours yet.";
        if (!got) paintBase(true);
        return;
      }
      if (t.id === "av-b-clear") {
        var A2 = App();
        baseMsg = null;
        if (A2 && A2.baseline && typeof A2.baseline.clear === "function") A2.baseline.clear();
        return;
      }
      if (t.id === "av-check") { checkRoll(); return; }
      if (t.id === "av-apply-new") { applyVerdict(true); return; }
      if (t.id === "av-apply-keep") { applyVerdict(false); return; }
      if (t.id === "av-undo") { undo(); return; }
    });

    // Enter settles the price the way leaving the box does. A text box outside
    // a form fires no change event on Enter, so it is caught here.
    pane.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.id === "av-price") { e.preventDefault(); commitPrice(true); }
    });

    // toggle does not bubble; a capturing listener on the pane still hears it.
    pane.addEventListener("toggle", function (e) {
      if (e.target && e.target.id === "av-roll") rollOpen = !!e.target.open;
    }, true);
  }

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  function isActive() {
    var p = $(PANE_ID);
    return !!(p && p.classList.contains("active"));
  }

  /**
   * The character's settings or your bracelet moved. The letters, the junk
   * stand-ins, the trait kinds and the grade it follows can all move with them,
   * so the controls repaint too — but only on screen; a parked tab catches up
   * when it is opened.
   */
  function onOutsideChange(d) {
    d = d || {};
    if (d.reset) { lastRes = null; lastOpts = null; lastKey = null; lastVerdict = null; }
    var ours = writing;
    if (EDIT && !ours) {
      // Someone else moved your bracelet: the draft follows it, and a write
      // still waiting would put the old one back on top — drop it. Only when
      // the bracelet itself moved: a Role press re-reads the same one.
      var now = baselineNow();
      if (sigOf(now) !== EDIT.src) {
        if (editTimer) { clearTimeout(editTimer); editTimer = null; }
        EDIT = now ? draftOf(now) : null;
      }
    }
    if (!isActive()) return;
    paintBase(!ours); paintSim();
    schedule(true);
  }

  /** Build the tab once. True when this call built it (and has painted and asked for a solve). */
  function init() {
    var pane = $(PANE_ID);
    if (!pane || pane.getAttribute("data-init")) return false;
    pane.setAttribute("data-init", "1");
    injectStyle();
    pane.innerHTML =
      '<section class="panel av-sec" id="av-base"><h2 class="av-h">Your bracelet</h2>' +
        '<div id="av-base-pick"></div><div id="av-base-body"></div></section>' +
      '<section class="panel av-sec av-sim" id="av-sim"></section>' +
      '<div id="av-out"></div>' +
      '<div id="av-rollbox"></div>' +
      methodHtml();
    bind(pane);
    paintAll();
    mountPicker();
    P.onChange(onOutsideChange);
    var A = App();
    if (A && A.baseline && typeof A.baseline.onChange === "function") A.baseline.onChange(onOutsideChange);
    schedule(true);
    return true;
  }

  document.addEventListener("tabselected", function (e) {
    if (!e || !e.detail) return;
    if (e.detail.tab !== "advisor") { if (editTimer) writeBase(); return; }
    if (init()) return;
    paintAll();
    // Always ask on activation, not only when dirty: the baseline and the
    // profile can both move while this tab is parked, and an unchanged
    // bracelet is a cache hit anyway.
    schedule(true);
  });

  init();
})();
