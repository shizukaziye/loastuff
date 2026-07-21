/**
 * advisor-setup.js — the Advisor's top "who / market" section.
 *
 *   1 · Character (optional): search the cached roster (LoadoutEcon.fieldSnapshot)
 *       or tap a favorite (window.Favorites) → the section auto-fills:
 *         - axis (DPS/Support) via LoadoutEcon.defaultModeFor
 *         - baseline rank via LoadoutEcon.blanketBaseline over the character's gems
 *         - gold-per-1%-damage via combat power (LoadoutEcon.cpToGpd) from a
 *           per-character fetch (instant for cached records)
 *   2 · Market assumptions: axis toggle · the 8 gpd tier chips · the S/A/B/C/D
 *       rank-ladder baseline with ◀ ▶ (replaces the old raw %-damage input).
 *
 * Everything stays manually overridable; with no character selected the defaults are
 * gpd 1.5M, baseline B+ (grade 65 — gradeToScore(65) ≈ 1.0103, matching the advisor's
 * historical 1.0 default), axis DPS.
 *
 * API (window.AdvisorSetup):
 *   init(hostEl, { onChange })   render + wire; onChange fires after every mutation
 *   getMarket() -> {
 *     axis: "dps"|"support", gpd, baselineIdx, baselineGrade, baselineRank,
 *     baselineScore,                    // (sg2s|g2s)(baselineGrade) — ready for the DP
 *     character: {region,name,class,combatPower}|null,
 *     provenance: { gpdAuto, gpdNote, baseNote, shift }
 *   }
 */
(function (root) {
  "use strict";

  var Econ = root.LoadoutEcon;
  var A = root.Astrogem || root;

  // ---- state (module-singleton: the advisor has one setup section) ----
  var host = null, onChangeCb = null;
  var axis = "dps";
  // Defaults (Shizu 2026-07-21): 1.5M gpd (= Econ.GPD_DEFAULT) and baseline A.
  // Combat-power auto-set on character pick still overrides; every choice now
  // PERSISTS (localStorage, see saveState/loadState) so it survives revisits.
  var DEFAULT_BASE_IDX = 7;        // GRADE_ROWS index 7 = grade 75 = "A"
  var gpd = Econ ? Econ.GPD_DEFAULT : 1500000;
  var gpdAuto = false;             // true while the chip was set from combat power
  var baseIdx = DEFAULT_BASE_IDX;  // GRADE_ROWS index
  var baseShift = 0;               // manual ◀ ▶ offset vs the character-derived index
  var charSel = null;              // { region, name, class, gems, combatPower?, itemLevel? }
  var charStatus = "";             // status note under the selected-character line
  var searchRows = null;           // decoded snapshot (lazy)
  var searchOpen = false;
  var debounceT = null;

  // ---- persistence ("don't make me reselect" — Shizu 2026-07-21) ----
  // localStorage, same mechanism as Favorites. The restored character is a
  // lightweight identity snapshot (no gems, no re-fetch): the saved axis/gpd/
  // baseline are the user's FINAL choices and must not be overwritten by a
  // fetch's auto-set on every page load. Picking a character fresh still runs
  // the full enrich flow.
  var STORE_KEY = "astrogem-advisor-setup";
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1, axis: axis, gpd: gpd, baseIdx: baseIdx,
        char: charSel ? {
          region: charSel.region, name: charSel.name, class: charSel.class || null,
          itemLevel: charSel.itemLevel != null ? charSel.itemLevel : null,
          combatPower: charSel.combatPower != null ? charSel.combatPower : null
        } : null
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!s || s.v !== 1) return;
      axis = (s.axis === "support" && supportAxisAvailable()) ? "support" : "dps";
      if (Econ.GPD_TIERS.indexOf(s.gpd) !== -1) gpd = s.gpd;
      if (s.char && s.char.name && s.char.region) {
        charSel = { region: s.char.region, name: s.char.name, class: s.char.class || null,
          itemLevel: s.char.itemLevel != null ? s.char.itemLevel : undefined,
          combatPower: s.char.combatPower != null ? s.char.combatPower : null,
          gems: [], _fetched: true };
      }
      var bi = parseInt(s.baseIdx, 10);
      // restored char carries no gems → applyBaseline runs in manual mode, so the
      // shift lands exactly on the saved index
      if (bi >= 0 && bi < Econ.GRADE_ROWS.length) baseShift = bi - DEFAULT_BASE_IDX;
    } catch (e) {}
  }

  function supportAxisAvailable() { return typeof root.supportGradeToScore === "function" || (A && typeof A.supportGradeToScore === "function"); }
  function g2s(grade) { return (A.gradeToScore || root.gradeToScore)(grade); }
  function sg2s(grade) { return (A.supportGradeToScore || root.supportGradeToScore)(grade); }
  function rankOf(grade) { return (A.rankFromGrade || root.rankFromGrade)(grade); }
  function rankColor(rank) { return (A.rankColor || root.Astrogem.rankColor)(rank); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function baselineGrade() { return Econ.GRADE_ROWS[baseIdx]; }
  function baselineScore() { return axis === "support" ? sg2s(baselineGrade()) : g2s(baselineGrade()); }

  // The character-derived baseline index (before the manual shift), or null.
  function charBaseIdx() {
    if (!charSel || !charSel.gems || !charSel.gems.length) return null;
    var b = Econ.blanketBaseline(charSel.gems, { axis: axis, shift: 0 });
    return b ? b.baseIdx : null;
  }
  function charBaseInfo() {
    if (!charSel || !charSel.gems || !charSel.gems.length) return null;
    return Econ.blanketBaseline(charSel.gems, { axis: axis, shift: 0 });
  }

  // Recompute baseIdx from the character (if any) + the manual shift.
  function applyBaseline() {
    var ci = charBaseIdx();
    var idx = (ci != null ? ci : DEFAULT_BASE_IDX) + baseShift;
    baseIdx = Math.max(0, Math.min(Econ.GRADE_ROWS.length - 1, idx));
  }

  // Jump the baseline to an absolute GRADE_ROWS index (arrows + the badge picker).
  function setBaseIdx(want) {
    var ci = charBaseIdx();
    baseShift += (want - baseIdx);
    if (ci == null) baseShift = want - DEFAULT_BASE_IDX;   // manual mode: absolute
    applyBaseline();
    render(); emit();
  }

  function emit() {
    saveState();   // every mutation persists — revisits restore the last setup
    if (onChangeCb) try { onChangeCb(getMarket()); } catch (e) {}
  }

  function getMarket() {
    var info = charBaseInfo();
    var baseNote;
    if (info) {
      baseNote = "one rank above your stronger 3rd-lowest gem (" +
        (info.srcType === "chaos" ? "Chaos " : "Order ") + info.srcRank + ")" +
        (baseShift ? " (" + (baseShift > 0 ? "+" : "") + baseShift + " rank)" : "");
    } else {
      baseNote = "default — pick a character to auto-set" +
        (baseShift ? " (" + (baseShift > 0 ? "+" : "") + baseShift + " rank)" : "");
    }
    return {
      axis: axis,
      gpd: gpd,
      baselineIdx: baseIdx,
      baselineGrade: baselineGrade(),
      baselineRank: rankOf(baselineGrade()),
      baselineScore: baselineScore(),
      character: charSel ? { region: charSel.region, name: charSel.name, class: charSel.class || null, combatPower: charSel.combatPower != null ? charSel.combatPower : null } : null,
      provenance: { gpdAuto: gpdAuto, gpdNote: gpdNoteText(), baseNote: baseNote, shift: baseShift }
    };
  }

  // ---- gpd provenance (same composition as the Grader's note) ----
  function gpdNoteText() {
    if (!charSel) return "";
    var parts = [];
    var cpG = Econ.cpToGpd(charSel.combatPower);
    if (cpG && gpdAuto) {
      parts.push("auto-set " + Econ.gpdLabel(cpG) + " from combat power " + Number(charSel.combatPower).toLocaleString("en-US"));
      var accG = Econ.accessoriesImpliedGpd(charSel.accessories, axis);
      if (accG && Math.abs(Econ.GPD_TIERS.indexOf(accG) - Econ.GPD_TIERS.indexOf(cpG)) >= 2) {
        parts.push("⚠ accessories look closer to " + Econ.gpdLabel(accG));
      }
      var floorG = Econ.gemsImpliedFloor(charSel.classicGemLevels);
      if (floorG && floorG > cpG) parts.push("⚠ gems suggest at least " + Econ.gpdLabel(floorG));
    } else if (charSel._fetched && charSel.combatPower == null) {
      parts.push("no combat power in this record — set the tier manually");
    }
    return parts.join(" · ");
  }

  // ---- character selection flow ----
  function selectCharacter(row) {
    charSel = { region: row.region, name: row.name, class: row.class || null, gems: row.gems || [] };
    charStatus = "";
    baseShift = 0;
    // Instant: axis + baseline from the snapshot gems.
    axis = supportAxisAvailable() ? Econ.defaultModeFor({ class: row.class, gems: row.gems }) : "dps";
    applyBaseline();
    render(); emit();
    // Async enrich: the per-character record (combat power etc.). Cached = instant.
    charStatus = "fetching record…";
    renderStatus();
    Econ.fetchCharacter(row.region, row.name).then(function (r) {
      if (!charSel || charSel.name !== row.name || charSel.region !== row.region) return; // superseded
      var d = (r && r.data) || {};
      charSel._fetched = true;
      if (Array.isArray(d.gems) && d.gems.length) {
        charSel.gems = d.gems;                                  // authoritative over the snapshot
        charSel.class = d.class || charSel.class;
        charSel.itemLevel = d.itemLevel;
        charSel.combatPower = d.combatPower != null ? d.combatPower : null;
        charSel.accessories = d.accessories || null;
        charSel.classicGemLevels = d.classicGemLevels || null;
        axis = supportAxisAvailable() ? Econ.defaultModeFor({ class: charSel.class, gems: charSel.gems }) : "dps";
        var cpG = Econ.cpToGpd(charSel.combatPower);
        if (cpG) { gpd = cpG; gpdAuto = true; }
        applyBaseline();
        charStatus = "";
      } else if (d.queued) {
        charStatus = "not cached yet — queued (position " + (d.position || "?") + "). Values stay manual until fetched.";
      } else {
        charStatus = (d.error ? String(d.error).slice(0, 90) : "no record — using manual values.");
      }
      render(); emit();
    }).catch(function () {
      if (!charSel) return;
      charSel._fetched = true;
      charStatus = "couldn't reach the worker — set the tier and baseline manually.";
      render(); emit();
    });
  }

  function clearCharacter() {
    charSel = null; charStatus = ""; baseShift = 0; gpdAuto = false;
    axis = "dps"; gpd = Econ.GPD_DEFAULT;
    applyBaseline();
    render(); emit();
  }

  // ---- markup ----
  function css() {
    return '<style>' +
      // Compact decision box (2026-07-21, Shizu round 3): CHARACTER row on top —
      // the always-visible typable search + favorite chips (no dropdown plate) —
      // then one market bar: axis chips · gold ◀ tier ▶ · base ◀ rank ▶, all
      // beside Consider Complete / Roster bound / Get advice.
      '#av-setup .avs-charline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
      '#av-setup .avs-bar{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap}' +
      '#av-setup .avs-searchwrap{position:relative;display:inline-flex}' +
      '#av-setup .avs-search{width:250px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px 26px 6px 10px;font:12.5px inherit}' +
      '#av-setup .avs-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:0;color:var(--dim);cursor:pointer;font-size:14px;padding:2px 5px}' +
      '#av-setup .avs-clear:hover{color:var(--text)}' +
      '#av-setup .avs-results{display:none;position:absolute;z-index:45;left:0;right:0;top:calc(100% + 4px);background:var(--panel2);border:1px solid var(--border);border-radius:8px;max-height:260px;overflow:auto;box-shadow:0 8px 22px rgba(0,0,0,.45)}' +
      '#av-setup .avs-selline{font-size:12.5px}' +
      '#av-setup .avs-selline .meta{color:var(--dim);font-size:11.5px}' +
      '#av-setup .avs-mini{padding:4px 9px;font-size:12px}' +
      '#av-setup .avs-microlab{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);font-weight:700}' +
      '#av-setup .avs-baseline{display:inline-flex;align-items:center;gap:5px}' +
      '#av-setup .avs-gpdval{font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}' +
      // the VALUES are clickable pickers too (arrows still step): a value button
      // opens a mini popover with every option laid out
      '#av-setup .avs-popwrap{position:relative;display:inline-flex}' +
      '#av-setup .avs-valbtn{background:none;border:0;padding:1px 3px;margin:0;cursor:pointer;font:inherit;color:inherit;display:inline-flex;align-items:center;border-radius:6px}' +
      '#av-setup .avs-valbtn:hover{background:rgba(102,199,255,.12)}' +
      '#av-setup .avs-minipop{position:absolute;z-index:45;left:50%;transform:translateX(-50%);top:calc(100% + 6px);background:var(--panel2);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.5);padding:8px;display:grid;gap:5px;width:max-content}' +
      '#av-setup .avs-rankopt{background:none;border:1px solid transparent;border-radius:8px;padding:3px;cursor:pointer}' +
      '#av-setup .avs-rankopt:hover{border-color:var(--border)}' +
      '#av-setup .avs-rankopt.on{border-color:var(--accent)}' +
      '#av-setup .avs-row{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--border);color:var(--text);padding:7px 10px;cursor:pointer;font:13px inherit}' +
      '#av-setup .avs-row:hover{background:rgba(102,199,255,.08)}' +
      '#av-setup .avs-row .rg{font-size:10px;font-weight:700;letter-spacing:.05em;background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:1px 5px;color:var(--dim)}' +
      '#av-setup .avs-row .cl{color:var(--dim);font-size:12px}' +
      '#av-setup .avs-row .il{margin-left:auto;color:var(--dim);font-size:11px;font-variant-numeric:tabular-nums}' +
      '#av-setup .avs-more{padding:6px 10px;color:var(--dim);font-size:11px}' +
      '#av-setup .avs-favs{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}' +
      '#av-setup .avs-favs:empty{display:none}' +
      '#av-setup .avs-fav{display:inline-flex;gap:6px;align-items:center;background:var(--panel2);border:1px solid var(--border);border-radius:99px;padding:4px 11px;color:var(--text);cursor:pointer;font:12px inherit}' +
      '#av-setup .avs-fav:hover{border-color:var(--accent)}' +
      '#av-setup .avs-fav .st{color:var(--high)}' +
      '#av-setup .avs-fav .rg{color:var(--dim);font-size:10px}' +
      '#av-setup .avs-status{color:var(--dim);font-size:12px;margin-top:3px;min-height:14px}' +
      '#av-setup .avs-status:empty{display:none}' +
      '#av-setup .avs-note{font-size:11px;color:var(--dim);margin:4px 0 0}' +
      '#av-setup .avs-note .warn{color:#e8b84a;font-weight:600}' +
      '#av-setup .rank-badge{display:inline-block;padding:1px 8px;border-radius:99px;font-weight:800;font-size:12.5px;font-variant-numeric:tabular-nums}' +
      '#av-setup .avs-arrow{background:var(--panel2);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;padding:2px 7px;font-size:11px}' +
      '#av-setup .avs-arrow:disabled{opacity:.35;cursor:default}' +
      '</style>';
  }

  function rankBadge(rank) {
    var c = rankColor(rank);
    return '<span class="rank-badge" style="background:' + c.bg + ';color:' + c.fg + '">' + esc(rank) + '</span>';
  }

  function render() {
    if (!host) return;
    var canSupport = supportAxisAvailable();
    var gpdIdx = Econ.GPD_TIERS.indexOf(gpd);
    if (gpdIdx === -1) gpdIdx = Econ.GPD_TIERS.indexOf(Econ.GPD_DEFAULT);
    var selLine = charSel
      ? '<span class="avs-selline">★ <b>' + esc(charSel.name) + '</b> <span class="meta">(' + esc(charSel.region) +
        (charSel.class ? " · " + esc(charSel.class) : "") +
        (charSel.itemLevel != null ? " · ilvl " + Number(charSel.itemLevel).toLocaleString() : "") +
        (charSel.combatPower != null ? " · CP " + Number(charSel.combatPower).toLocaleString("en-US") : "") + ')</span></span>'
      : "";
    var gnote = gpdNoteText();
    var m = getMarket();

    host.innerHTML = css() +
      '<div class="avs-charline">' +
      '  <span class="avs-searchwrap">' +
      '    <input id="avs-search" class="avs-search" type="search" placeholder="Search ' + (searchRows ? searchRows.length.toLocaleString() : "9,500+") + ' characters…" autocomplete="off">' +
      (charSel ? '<button type="button" id="avs-clear" class="avs-clear" title="Clear character">×</button>' : "") +
      '    <div id="avs-results" class="avs-results"></div>' +
      '  </span>' +
      '  <span id="avs-favs" class="avs-favs" style="margin-top:0"></span>' +
      selLine +
      '</div>' +
      '<div class="avs-bar">' +
      (canSupport
        ? '<button type="button" class="mbtn avs-mini avs-axis' + (axis === "dps" ? " active" : "") + '" data-axis="dps">DPS</button>' +
          '<button type="button" class="mbtn avs-mini avs-axis' + (axis === "support" ? " active" : "") + '" data-axis="support">Support</button>'
        : "") +
      '  <span class="avs-baseline" title="Gold per 1% damage tier' + (gpdAuto ? " — auto-set from combat power" : "") + '">' +
      '    <span class="avs-microlab">gold</span>' +
      '    <button type="button" id="avs-gpd-dn" class="avs-arrow"' + (gpdIdx <= 0 ? " disabled" : "") + '>&#9664;</button>' +
      '    <span class="avs-popwrap">' +
      '      <button type="button" id="avs-gpd-val" class="avs-valbtn" title="Click to pick a tier"><span class="avs-gpdval">' + Econ.gpdLabel(gpd) + '/1%</span></button>' +
      '      <div id="avs-gpd-pop" class="avs-minipop" style="display:none;grid-template-columns:repeat(4,auto)">' +
      Econ.GPD_TIERS.map(function (g) {
        return '<button type="button" class="mbtn avs-mini avs-gpd' + (g === gpd ? " active" : "") + '" data-gpd="' + g + '">' + Econ.gpdLabel(g) + '</button>';
      }).join("") +
      '      </div>' +
      '    </span>' +
      '    <button type="button" id="avs-gpd-up" class="avs-arrow"' + (gpdIdx >= Econ.GPD_TIERS.length - 1 ? " disabled" : "") + '>&#9654;</button>' +
      '  </span>' +
      '  <span class="avs-baseline" title="Baseline — ' + esc(m.provenance.baseNote) + '">' +
      '    <span class="avs-microlab">base</span>' +
      '    <button type="button" id="avs-base-dn" class="avs-arrow"' + (baseIdx <= 0 ? " disabled" : "") + '>&#9664;</button>' +
      '    <span class="avs-popwrap">' +
      '      <button type="button" id="avs-base-val" class="avs-valbtn" title="Click to pick a baseline rank">' + rankBadge(m.baselineRank) + '</button>' +
      '      <div id="avs-base-pop" class="avs-minipop" style="display:none;grid-template-columns:repeat(6,auto)">' +
      Econ.GRADE_ROWS.map(function (g, i) {
        return '<button type="button" class="avs-rankopt' + (i === baseIdx ? " on" : "") + '" data-bi="' + i + '">' + rankBadge(rankOf(g)) + '</button>';
      }).join("") +
      '      </div>' +
      '    </span>' +
      '    <button type="button" id="avs-base-up" class="avs-arrow"' + (baseIdx >= Econ.GRADE_ROWS.length - 1 ? " disabled" : "") + '>&#9654;</button>' +
      '  </span>' +
      '</div>' +
      (gnote ? '<div class="avs-note">' + gnote.replace(/⚠ [^·]+/g, function (w) { return '<span class="warn">' + esc(w.trim()) + '</span>'; }) + '</div>' : "") +
      '<div id="avs-status" class="avs-status">' + esc(charStatus) + '</div>';

    renderFavs();
    wire();
    searchOpen = false;   // results dropdown always rebuilds hidden
    gpdPopOpen = false; basePopOpen = false;   // value pickers likewise
  }

  function renderStatus() {
    var el = host && host.querySelector("#avs-status");
    if (el) el.textContent = charStatus;
  }

  function renderFavs() {
    var el = host.querySelector("#avs-favs");
    if (!el) return;
    var Favs = root.Favorites;
    var list = (Favs && Favs.list()) || [];
    if (!list.length) { el.innerHTML = ""; return; }
    el.innerHTML = list.map(function (f, i) {
      return '<button type="button" class="avs-fav" data-fi="' + i + '"><span class="st">★</span>' +
        '<span>' + esc(f.name) + '</span><span class="rg">' + esc(f.region) + '</span></button>';
    }).join("");
  }

  // ---- search ----
  function ensureRows() {
    if (searchRows || !Econ) return Promise.resolve(searchRows);
    return Econ.fieldSnapshot().then(function (rows) {
      searchRows = rows || [];
      var inp = host && host.querySelector("#avs-search");
      if (inp && searchRows.length) inp.placeholder = "Search " + searchRows.length.toLocaleString() + " graded characters…";
      if (inp && !searchRows.length) inp.placeholder = "Character list unavailable — favorites & manual entry still work";
      return searchRows;
    });
  }

  function runSearch(q) {
    var box = host.querySelector("#avs-results");
    if (!box) return;
    q = (q || "").trim().toLowerCase();
    if (!q || !searchRows || !searchRows.length) { box.style.display = "none"; searchOpen = false; return; }
    var hits = [];
    for (var i = 0; i < searchRows.length && hits.length < 200; i++) {
      var c = searchRows[i];
      if ((c.name || "").toLowerCase().indexOf(q) !== -1) hits.push(c);
    }
    var top = hits.slice(0, 12);
    box.innerHTML = top.map(function (c, i) {
      return '<button type="button" class="avs-row" data-ri="' + i + '">' +
        '<span>' + esc(c.name) + '</span><span class="rg">' + esc(c.region) + '</span>' +
        (c.class ? '<span class="cl">' + esc(c.class) + '</span>' : "") +
        '</button>';
    }).join("") + (hits.length > 12 ? '<div class="avs-more">…and ' + (hits.length - 12) + ' more — keep typing</div>' : "") +
      (top.length === 0 ? '<div class="avs-more">no matches</div>' : "");
    box.style.display = "block";
    searchOpen = true;
    box._hits = top;
  }

  // ---- mini-popovers on the gold/baseline VALUES (render rebuilds them closed) ----
  var gpdPopOpen = false, basePopOpen = false;
  function setGpdPop(open) { gpdPopOpen = open; var p = host && host.querySelector("#avs-gpd-pop"); if (p) p.style.display = open ? "" : "none"; }
  function setBasePop(open) { basePopOpen = open; var p = host && host.querySelector("#avs-base-pop"); if (p) p.style.display = open ? "" : "none"; }

  // ---- event wiring (onclick assignment on the persistent host — no stacking) ----
  function wire() {
    var inp = host.querySelector("#avs-search");
    if (inp) {
      inp.onfocus = function () { ensureRows(); };
      inp.oninput = function () {
        clearTimeout(debounceT);
        var v = inp.value;
        debounceT = setTimeout(function () { ensureRows().then(function () { runSearch(v); }); }, 200);
      };
    }
    host.onclick = function (ev) {
      var t = ev.target;
      // FIRST: any click outside a popover's own wrap closes it — checked before
      // the control branches, because several of them early-return (an
      // already-active chip) and would otherwise strand it open.
      if (searchOpen && !(t.closest && t.closest(".avs-searchwrap"))) {
        var rb = host.querySelector("#avs-results");
        if (rb) rb.style.display = "none";
        searchOpen = false;
      }
      if (gpdPopOpen && !(t.closest && (t.closest("#avs-gpd-val") || t.closest("#avs-gpd-pop")))) setGpdPop(false);
      if (basePopOpen && !(t.closest && (t.closest("#avs-base-val") || t.closest("#avs-base-pop")))) setBasePop(false);
      // the values toggle their pickers
      if (t.closest && t.closest("#avs-gpd-val")) { setGpdPop(!gpdPopOpen); return; }
      if (t.closest && t.closest("#avs-base-val")) { setBasePop(!basePopOpen); return; }
      // picker options
      if (t.classList && t.classList.contains("avs-gpd")) {
        gpd = parseInt(t.getAttribute("data-gpd"), 10);
        gpdAuto = false;                       // manual pick clears the auto flag
        render(); emit(); return;
      }
      var bopt = t.closest ? t.closest(".avs-rankopt") : null;
      if (bopt) { setBaseIdx(parseInt(bopt.getAttribute("data-bi"), 10)); return; }
      var row = t.closest ? t.closest(".avs-row") : null;
      if (row) {
        var box = host.querySelector("#avs-results");
        var hit = box && box._hits && box._hits[parseInt(row.getAttribute("data-ri"), 10)];
        if (hit) { box.style.display = "none"; searchOpen = false; selectCharacter(hit); }   // render() closes the pop
        return;
      }
      var fav = t.closest ? t.closest(".avs-fav") : null;
      if (fav) {
        var list = (root.Favorites && root.Favorites.list()) || [];
        var f = list[parseInt(fav.getAttribute("data-fi"), 10)];
        // Favorites may be absent from the snapshot — fetch-only selection still works.
        if (f) selectCharacter({ region: f.region, name: f.name, class: null, gems: [] });
        return;
      }
      if (t.id === "avs-clear") { clearCharacter(); return; }
      if (t.id === "avs-gpd-dn" || t.id === "avs-gpd-up") {
        var ti = Econ.GPD_TIERS.indexOf(gpd);
        if (ti === -1) ti = Econ.GPD_TIERS.indexOf(Econ.GPD_DEFAULT);
        ti = Math.max(0, Math.min(Econ.GPD_TIERS.length - 1, ti + (t.id === "avs-gpd-up" ? 1 : -1)));
        gpd = Econ.GPD_TIERS[ti];
        gpdAuto = false;                       // manual step clears the auto flag
        render(); emit(); return;
      }
      if (t.classList && t.classList.contains("avs-axis")) {
        var ax = t.getAttribute("data-axis");
        if (ax !== axis) { axis = ax === "support" ? "support" : "dps"; applyBaseline(); render(); emit(); }
        return;
      }
      if (t.id === "avs-base-dn" || t.id === "avs-base-up") {
        var d = t.id === "avs-base-up" ? 1 : -1;
        setBaseIdx(Math.max(0, Math.min(Econ.GRADE_ROWS.length - 1, baseIdx + d)));
        return;
      }
    };
  }

  // ---- public API ----
  var API = {
    init: function (hostEl, opts) {
      host = hostEl;
      onChangeCb = (opts && opts.onChange) || null;
      if (root.Favorites && root.Favorites.onChange) root.Favorites.onChange(function () { renderFavs(); });
      loadState();   // restore last visit's character + market choices
      applyBaseline();
      render();
      emit();
    },
    getMarket: getMarket
  };
  root.AdvisorSetup = API;
})(typeof window !== "undefined" ? window : this);
