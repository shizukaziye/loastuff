/**
 * gemlist.js — the Grader tab's THIRD input mode: "From screenshot".
 *
 * Drop a screenshot of the in-game Ark Grid screen (Astrogem tab) and every gem
 * in the list on the right — up to 9 at a time — is read, graded and listed.
 * Drop several screenshots to cover a whole collection; rows that repeat because
 * the list was scrolled are merged.
 *
 * Split of work:
 *   ocr/gemlist-engine.js  reads the panel  (pixels -> cost / points / effects)
 *   ocr/gemlist-refs.js    the glyph templates it matches against
 *   this file              the drop zone, the editable table, and the grading
 *
 * Both OCR files are LAZY — they only load the first time this mode is opened,
 * from the pinned list index.html publishes as window.LAZY_GEMLIST (one place
 * for the ?v= pins, so they can't drift apart).
 *
 * NOTHING here reads a gem the user can't correct. Every field the engine is
 * unsure about is flagged; a flagged row opens in its editor with the doubtful
 * cells marked, and any row can be edited by hand. Grades recompute on change.
 *
 * Grading calls model/astrogem.js directly (grade / supportGrade / gemRank /
 * levelSum / classifyTier) — the same core the rest of the app uses. The base
 * cost is inferred from the effect PAIR plus the willpower cost, and when two
 * pools both fit it is shown as "8/9" — the grade is identical either way,
 * because gemValue never reads the base cost.
 */
(function () {
  "use strict";

  var A = (typeof window !== "undefined" && window.Astrogem) || null;
  var EFFECTS = ["Attack Power", "Additional Damage", "Boss Damage",
                 "Brand Power", "Ally Damage Enh.", "Ally Attack Enh."];
  var SHORT = {
    "Attack Power": "Atk. Power", "Additional Damage": "Additional Damage",
    "Boss Damage": "Boss Damage", "Brand Power": "Brand Power",
    "Ally Damage Enh.": "Ally Damage Enh.", "Ally Attack Enh.": "Ally Attack Enh."
  };

  var gems = [];        // every row read so far, in the order the shots arrived
  var shots = [];       // { name, rows, id }
  var axis = "dps";     // "dps" | "support"
  var sortBy = "grade"; // "grade" | "order"
  var merge = true;     // fold rows that repeat across overlapping screenshots
  var editing = {};     // id -> true
  var nextId = 1;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function rankClass(r) { return "gr-" + String(r || "f").charAt(0).toLowerCase(); }

  // ------------------------------------------------------------ model glue
  // Which base cost(s) can produce this row? The effect pair picks the pool and
  // the willpower cost has to leave a legal willpower level (1-5).
  function baseCandidates(row) {
    var out = [];
    if (!A || !row.effect1 || !row.effect2 || !row.cost) return out;
    [8, 9, 10].forEach(function (bc) {
      var pool = A.EFFECT_POOLS[bc];
      if (pool.indexOf(row.effect1) < 0 || pool.indexOf(row.effect2) < 0) return;
      var wl = bc - row.cost;
      if (wl < 1 || wl > 5) return;
      out.push(bc);
    });
    return out;
  }
  function configOf(row) {
    var cands = baseCandidates(row);
    if (!cands.length) return null;
    if (!row.points || !row.effect1Level || !row.effect2Level) return null;
    if (row.effect1 === row.effect2) return null;
    var bc = cands[0];
    return {
      baseCost: bc, gemType: row.gemType || "order",
      willpowerLevel: bc - row.cost, orderLevel: row.points,
      effect1: row.effect1, effect1Level: row.effect1Level,
      effect2: row.effect2, effect2Level: row.effect2Level,
      _cands: cands
    };
  }
  function gradeOf(cfg) {
    if (!cfg) return null;
    return axis === "support" ? A.supportGrade(cfg) : A.grade(cfg);
  }
  function rankOf(g) {
    if (g == null) return null;
    return axis === "support" && A.supportRankFromGrade ? A.supportRankFromGrade(g) : A.rankFromGrade(g);
  }
  // Why a row can't be graded — said plainly, because this is the message the
  // user acts on.
  function whyInvalid(row) {
    if (!row.cost || !row.points || !row.effect1 || !row.effect2 || !row.effect1Level || !row.effect2Level)
      return "some fields are blank";
    if (row.effect1 === row.effect2) return "the two effects are the same";
    if (!baseCandidates(row).length)
      return "no 8/9/10-cost gem has both " + row.effect1 + " and " + row.effect2 + " at willpower cost " + row.cost;
    return "";
  }

  // ---------------------------------------------------------------- loading
  var engineState = 0;  // 0 = untouched, 1 = loading, 2 = ready, 3 = failed
  var engineWaiters = [];
  function ensureEngine(cb) {
    if (engineState === 2) return cb(null);
    if (engineState === 3) return cb("The screenshot reader failed to load. Reload the page and try again.");
    engineWaiters.push(cb);
    if (engineState === 1) return;
    engineState = 1;
    var list = (window.LAZY_GEMLIST || []).slice();
    if (!list.length) {
      // index.html didn't publish the pinned list — load unpinned rather than
      // break, but say so: an unpinned .js is cached hard by the zone for 4h.
      console.warn("gemlist: window.LAZY_GEMLIST missing — loading OCR files unpinned");
      list = ["ocr/gemlist-engine.js", "ocr/gemlist-refs.js"];
    }
    (function next(i) {
      if (i >= list.length) {
        engineState = (window.GemListEngine && window.GemListRefs) ? 2 : 3;
        var err = engineState === 2 ? null : "The screenshot reader failed to load. Reload the page and try again.";
        engineWaiters.splice(0).forEach(function (f) { f(err); });
        return;
      }
      var s = document.createElement("script");
      s.src = list[i];
      s.onload = function () { next(i + 1); };
      s.onerror = function () { next(list.length); };
      document.body.appendChild(s);
    })(0);
  }

  // ---------------------------------------------------------------- markup
  var STYLE = '' +
'<style>' +
'  #tab-grader .gl-drop{border:2px dashed var(--border);border-radius:12px;padding:26px 20px;text-align:center;background:var(--panel2);cursor:pointer;transition:border-color .12s,background .12s}' +
'  #tab-grader .gl-drop:hover,#tab-grader .gl-drop.over{border-color:var(--axis,var(--accent));background:rgba(127,127,127,.07)}' +
'  #tab-grader .gl-drop .gl-big{font-size:15px;font-weight:700;color:var(--text)}' +
'  #tab-grader .gl-drop .gl-sub{font-size:12px;color:var(--dim);margin-top:6px;line-height:1.6}' +
'  #tab-grader .gl-shots{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}' +
'  #tab-grader .gl-chip{display:inline-flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--border);border-radius:99px;padding:4px 6px 4px 12px;font-size:12px}' +
'  #tab-grader .gl-chip b{font-variant-numeric:tabular-nums;color:var(--axis,var(--accent))}' +
'  #tab-grader .gl-chip button{background:none;border:none;color:var(--dim);cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;font-family:inherit}' +
'  #tab-grader .gl-chip button:hover{color:var(--bad)}' +
'  #tab-grader .gl-opts{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--dim)}' +
'  #tab-grader .gl-opts label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}' +
'  #tab-grader .gl-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}' +
'  #tab-grader .gl-head h2{margin:0}' +
'  #tab-grader .gl-pills{display:inline-flex;border:1px solid var(--border);border-radius:99px;overflow:hidden;background:var(--panel2)}' +
'  #tab-grader .gl-pills button{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;color:var(--dim);padding:5px 14px}' +
'  #tab-grader .gl-pills button:not(:last-child){border-right:1px solid var(--border)}' +
'  #tab-grader .gl-pills button.active{background:var(--axis,var(--accent));color:#fff}' +
'  #tab-grader .gl-sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}' +
'  #tab-grader .gl-stat{border:1px solid var(--border);border-radius:10px;background:var(--panel2);padding:8px 14px;min-width:96px}' +
'  #tab-grader .gl-stat .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);font-weight:700}' +
'  #tab-grader .gl-stat .v{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}' +
'  #tab-grader .gl-stat .s{font-size:11px;color:var(--dim);margin-top:1px}' +
'  #tab-grader table.gl-tab{width:100%;border-collapse:collapse;font-size:13px}' +
'  #tab-grader table.gl-tab th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);font-weight:700;padding:0 8px 7px;border-bottom:1px solid var(--border);white-space:nowrap}' +
'  #tab-grader table.gl-tab td{padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:middle}' +
'  #tab-grader table.gl-tab tr:hover td{background:rgba(127,127,127,.05)}' +
'  #tab-grader table.gl-tab tr.gl-warn td{background:rgba(224,104,60,.09)}' +
'  #tab-grader table.gl-tab .num{font-variant-numeric:tabular-nums;white-space:nowrap}' +
'  #tab-grader table.gl-tab .gl-rk{font-weight:800;font-size:15px}' +
'  #tab-grader table.gl-tab .gl-gd{font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}' +
'  #tab-grader .gl-lv{color:#e8c15a;font-weight:700}' +
'  #tab-grader .gl-t-order{color:#e88ab4;font-weight:700}' +
'  #tab-grader .gl-t-chaos{color:#66c7ff;font-weight:700}' +
'  #tab-grader .gl-eq{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7ddb9a;border:1px solid rgba(125,219,154,.45);border-radius:99px;padding:1px 7px}' +
'  #tab-grader .gl-edit{background:none;border:1px solid var(--border);border-radius:6px;color:var(--dim);cursor:pointer;font-family:inherit;font-size:11px;padding:3px 8px}' +
'  #tab-grader .gl-edit:hover{color:var(--text);border-color:var(--axis,var(--accent))}' +
'  #tab-grader .gl-ed select{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 5px;font-family:inherit;font-size:12px}' +
'  #tab-grader .gl-ed select.bad{border-color:#e0683c;box-shadow:0 0 0 1px rgba(224,104,60,.35)}' +
'  #tab-grader .gl-bad{color:#e0683c;font-size:11.5px}' +
'  #tab-grader .gl-flagnote{font-size:12px;color:#e0683c;margin-bottom:10px;line-height:1.6}' +
'  #tab-grader .gl-fodder{margin-top:16px;padding:12px 15px;border:1px dashed var(--border);border-radius:10px;background:var(--panel2);font-size:12.5px;line-height:1.7;color:var(--dim)}' +
'  #tab-grader .gl-fodder b{color:var(--text)}' +
'  @media(max-width:760px){#tab-grader table.gl-tab .gl-hidesm{display:none}}' +
'</style>';

  function controlsMarkup() {
    return STYLE +
'<p class="note" style="margin-top:0">Open the <b>Ark Grid</b> screen in game with the <b>Astrogem</b> tab selected, take a screenshot of the whole screen, and drop it below. The list on the right holds <b>9 gems at a time</b> — scroll it and take another shot to cover the rest. Rows that appear on two screenshots are merged.</p>' +
'<div class="gl-drop" id="gl-drop">' +
'  <div class="gl-big">Drop screenshots here</div>' +
'  <div class="gl-sub">or paste with <b>Ctrl+V</b>, or click to choose files &middot; PNG or JPG, full screen, unscaled</div>' +
'  <input type="file" id="gl-file" accept="image/*" multiple style="display:none">' +
'</div>' +
'<div class="gl-shots" id="gl-shots"></div>' +
'<div class="gl-opts">' +
'  <label><input type="checkbox" id="gl-merge" checked> Merge rows that repeat across screenshots</label>' +
'  <button class="mbtn" id="gl-clear" type="button" style="display:none">Clear all</button>' +
'</div>' +
'<div class="gr-status" id="gl-status"></div>';
  }

  // ------------------------------------------------------------- the table
  function visibleGems() {
    if (!merge) return gems.slice();
    var seen = {}, out = [];
    gems.forEach(function (g) {
      var k = [g.gemType, g.cost, g.points, g.effect1, g.effect1Level, g.effect2, g.effect2Level].join("|");
      if (seen[k]) { seen[k].dupes++; return; }
      seen[k] = g; g.dupes = 0; out.push(g);
    });
    return out;
  }

  function opts(list, sel, w) {
    return list.map(function (o) {
      var v = (o && o.v !== undefined) ? o.v : o, t = (o && o.t !== undefined) ? o.t : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? " selected" : "") + ">" + esc(t) + "</option>";
    }).join("");
  }

  function editRowHtml(g, n) {
    var f = g.flags || [];
    function cls(k) { return f.indexOf(k) >= 0 ? ' class="bad"' : ""; }
    var lv = [1, 2, 3, 4, 5];
    // The grade rides along inside the editor: most flagged rows turn out to
    // have been read correctly, and the user shouldn't have to close the editor
    // to find that out.
    var cfg = configOf(g), grade = gradeOf(cfg), rank = rankOf(grade);
    return '<td colspan="10" class="gl-ed" data-id="' + g.id + '">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<span class="num" style="color:var(--dim);min-width:18px">' + n + "</span>" +
      '<select data-f="gemType"' + cls("type") + '>' + opts([{ v: "order", t: "Order" }, { v: "chaos", t: "Chaos" }], g.gemType) + '</select>' +
      '<span style="font-size:11px;color:var(--dim)">wp cost</span><select data-f="cost"' + cls("cost") + '>' + opts([1, 2, 3, 4, 5, 6, 7, 8, 9], g.cost) + '</select>' +
      '<span style="font-size:11px;color:var(--dim)">points</span><select data-f="points"' + cls("pts") + '>' + opts(lv, g.points) + '</select>' +
      '<select data-f="effect1"' + cls("e1") + '>' + opts(EFFECTS, g.effect1) + '</select>' +
      '<select data-f="effect1Level"' + cls("l1") + '>' + opts(lv, g.effect1Level) + '</select>' +
      '<select data-f="effect2"' + cls("e2") + '>' + opts(EFFECTS, g.effect2) + '</select>' +
      '<select data-f="effect2Level"' + cls("l2") + '>' + opts(lv, g.effect2Level) + '</select>' +
      (grade == null ? "" : '<span class="gl-rk ' + rankClass(rank) + '">' + esc(rank) +
        '</span> <span class="gl-gd">' + grade.toFixed(1) + "</span>") +
      '<button class="gl-edit" data-done="' + g.id + '" type="button">Done</button>' +
      '</div>' +
      (whyInvalid(g) ? '<div class="gl-bad" style="margin-top:6px">Can’t grade this row — ' + esc(whyInvalid(g)) + ".</div>" : "") +
      '</td>';
  }

  function viewRowHtml(g, n) {
    var cfg = configOf(g), grade = gradeOf(cfg), rank = rankOf(grade);
    var cands = cfg ? cfg._cands : [];
    var tier = cfg ? A.classifyTier(A.levelSum(cfg)) : null;
    var warn = (g.flags && g.flags.length) ? " gl-warn" : "";
    function line(name, lvl) {
      return esc(SHORT[name] || name || "—") + ' <span class="gl-lv">Lv. ' + (lvl || "?") + "</span>";
    }
    return '<td class="num" style="color:var(--dim)">' + n + "</td>" +
      '<td class="gl-t-' + esc(g.gemType || "order") + '">' + (g.gemType === "chaos" ? "Chaos" : "Order") + "</td>" +
      '<td class="num"><b>' + (g.cost == null ? "?" : g.cost) + "</b></td>" +
      '<td class="num">' + (g.points == null ? "?" : g.points) + "</td>" +
      "<td>" + line(g.effect1, g.effect1Level) + "</td>" +
      "<td>" + line(g.effect2, g.effect2Level) + "</td>" +
      '<td class="num gl-hidesm" style="color:var(--dim)">' + (cands.length ? cands.join("/") : "—") + "</td>" +
      '<td class="gl-hidesm" style="color:var(--dim);font-size:11.5px">' + (tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "—") +
        (cfg ? ' <span class="num">(' + A.levelSum(cfg) + ")</span>" : "") + "</td>" +
      "<td>" + (grade == null
        ? '<span class="gl-bad">' + esc(whyInvalid(g) || "unreadable") + "</span>"
        : '<span class="gl-rk ' + rankClass(rank) + '">' + esc(rank) + '</span> <span class="gl-gd">' + grade.toFixed(1) + "</span>") +
        (g.equipped ? ' <span class="gl-eq">equipped</span>' : "") + "</td>" +
      '<td style="text-align:right"><button class="gl-edit" data-edit="' + g.id + '" type="button">Edit</button></td>';
  }

  function summaryHtml(list) {
    var graded = list.map(function (g) { return gradeOf(configOf(g)); }).filter(function (x) { return x != null; });
    if (!graded.length) return "";
    var sum = graded.reduce(function (a, b) { return a + b; }, 0);
    var best = Math.max.apply(null, graded), worst = Math.min.apply(null, graded);
    function stat(k, v, s) {
      return '<div class="gl-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || "&nbsp;") + "</div></div>";
    }
    return '<div class="gl-sum">' +
      stat("Gems read", list.length, shots.length + " screenshot" + (shots.length === 1 ? "" : "s")) +
      stat("Average", (sum / graded.length).toFixed(1), esc(rankOf(sum / graded.length))) +
      stat("Best", best.toFixed(1), esc(rankOf(best))) +
      stat("Worst", worst.toFixed(1), esc(rankOf(worst))) +
      "</div>";
  }

  // The bottom of the pile, named — this is the list you actually act on.
  function fodderHtml(list) {
    var scored = list.map(function (g) { return { g: g, v: gradeOf(configOf(g)) }; })
      .filter(function (x) { return x.v != null; })
      .sort(function (a, b) { return a.v - b.v; });
    if (scored.length < 4) return "";
    var take = scored.filter(function (x) { return !x.g.equipped; }).slice(0, Math.min(6, Math.max(3, Math.floor(scored.length / 4))));
    if (!take.length) return "";
    return '<div class="gl-fodder"><b>Weakest ' + take.length + ' (fusion fodder first):</b> ' +
      take.map(function (x) {
        return '<b>' + x.v.toFixed(1) + "</b> " + (x.g.gemType === "chaos" ? "chaos" : "order") +
          " wp" + x.g.cost + " " + x.g.points + "P " + esc(SHORT[x.g.effect1] || "?") + " " + x.g.effect1Level +
          " / " + esc(SHORT[x.g.effect2] || "?") + " " + x.g.effect2Level;
      }).join(" &middot; ") +
      '<br>Three gems fuse into one. Feed the grid’s dead weight in first &mdash; and aim the result at a <b>9-cost</b> unless your grid is already strong.</div>';
  }

  function render() {
    var host = $("gr-result");
    if (!host) return;
    if (!gems.length) {
      host.innerHTML = '<div class="placeholder"><b>Grade a whole screen of gems</b>Drop a screenshot of the Ark Grid <i>Astrogem</i> tab above and every gem in the list gets read, graded and ranked.</div>';
      return;
    }
    var list = visibleGems();
    var flagged = list.filter(function (g) { return g.flags && g.flags.length; }).length;
    var merged = gems.length - list.length;
    var scored = list.map(function (g, i) { return { g: g, i: i, v: gradeOf(configOf(g)) }; });
    if (sortBy === "grade") scored.sort(function (a, b) {
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return b.v - a.v || a.i - b.i;
    });

    var rows = scored.map(function (x, n) {
      var g = x.g;
      return '<tr class="' + ((g.flags && g.flags.length) ? "gl-warn" : "") + '">' +
        (editing[g.id] ? editRowHtml(g, n + 1) : viewRowHtml(g, n + 1)) + "</tr>";
    }).join("");

    function pills(id, cur, list) {
      return '<span class="gl-pills" id="' + id + '">' + list.map(function (o) {
        return '<button type="button" data-v="' + o[0] + '"' + (cur === o[0] ? ' class="active"' : "") + ">" + o[1] + "</button>";
      }).join("") + "</span>";
    }

    host.innerHTML = '<div class="panel">' +
      '<div class="gl-head"><h2>Your astrogems</h2>' +
      (A && A.supportGrade ? pills("gl-axis", axis, [["dps", "DPS"], ["support", "Support"]]) : "") +
      pills("gl-sort", sortBy, [["grade", "By grade"], ["order", "As shown"]]) +
      "</div>" +
      summaryHtml(list) +
      (flagged ? '<div class="gl-flagnote">' + flagged + " row" + (flagged === 1 ? " was" : "s were") +
        " read with low confidence and " + (flagged === 1 ? "is" : "are") + " open for you to check — the doubtful boxes are outlined.</div>" : "") +
      (merged ? '<div class="note" style="margin:0 0 10px">' + merged + " repeated row" + (merged === 1 ? "" : "s") +
        " merged (overlapping screenshots). Untick <i>Merge rows</i> above if you really own duplicates.</div>" : "") +
      '<table class="gl-tab"><thead><tr>' +
      "<th>#</th><th>Type</th><th>WP</th><th>P</th><th>Effect 1</th><th>Effect 2</th>" +
      '<th class="gl-hidesm">Base</th><th class="gl-hidesm">Tier</th><th>' +
      (axis === "support" ? "Support grade" : "DPS grade") + "</th><th></th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>" +
      fodderHtml(list) +
      "</div>";
    wireResult();
  }

  function wireResult() {
    var host = $("gr-result");
    host.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { editing[+b.getAttribute("data-edit")] = true; render(); });
    });
    host.querySelectorAll("[data-done]").forEach(function (b) {
      b.addEventListener("click", function () { delete editing[+b.getAttribute("data-done")]; render(); });
    });
    host.querySelectorAll(".gl-ed select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var id = +sel.closest(".gl-ed").getAttribute("data-id");
        var g = gems.filter(function (x) { return x.id === id; })[0];
        if (!g) return;
        var f = sel.getAttribute("data-f");
        g[f] = (f === "gemType" || f === "effect1" || f === "effect2") ? sel.value : parseInt(sel.value, 10);
        // The user has spoken — drop the engine's doubt about that field.
        var map = { cost: "cost", points: "pts", effect1: "e1", effect1Level: "l1", effect2: "e2", effect2Level: "l2", gemType: "type" };
        g.flags = (g.flags || []).filter(function (x) { return x !== map[f]; });
        render();
      });
    });
    var ax = $("gl-axis");
    if (ax) ax.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { axis = b.getAttribute("data-v"); render(); });
    });
    var so = $("gl-sort");
    if (so) so.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { sortBy = b.getAttribute("data-v"); render(); });
    });
  }

  // ------------------------------------------------------------- ingestion
  function setStatus(msg, cls) {
    var el = $("gl-status");
    if (el) { el.textContent = msg || ""; el.className = "gr-status" + (cls ? " " + cls : ""); }
  }
  function renderChips() {
    var el = $("gl-shots");
    if (!el) return;
    el.innerHTML = shots.map(function (s) {
      return '<span class="gl-chip">' + esc(s.name) + ' &middot; <b>' + s.rows + "</b>&nbsp;gems" +
        '<button type="button" data-shot="' + s.id + '" title="Remove this screenshot">&times;</button></span>';
    }).join("");
    el.querySelectorAll("[data-shot]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = +b.getAttribute("data-shot");
        shots = shots.filter(function (s) { return s.id !== id; });
        gems = gems.filter(function (g) { return g.shotId !== id; });
        renderChips(); render();
        if ($("gl-clear")) $("gl-clear").style.display = shots.length ? "" : "none";
      });
    });
    if ($("gl-clear")) $("gl-clear").style.display = shots.length ? "" : "none";
  }

  function imageDataOf(bitmapOrImg, w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmapOrImg, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }

  function decode(file) {
    return new Promise(function (resolve, reject) {
      if (window.createImageBitmap) {
        createImageBitmap(file).then(function (bm) {
          try { resolve(imageDataOf(bm, bm.width, bm.height)); } catch (e) { reject(e); }
          if (bm.close) bm.close();
        }, reject);
        return;
      }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try { resolve(imageDataOf(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("could not decode the image")); };
      img.src = url;
    });
  }

  function addFiles(files) {
    var list = [].slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
    if (!list.length) { setStatus("That wasn't an image file.", "err"); return; }
    if (busy) return;
    busy = true;
    setStatus("Loading the screenshot reader…", "working");
    ensureEngine(function (err) {
      if (err) { busy = false; setStatus(err, "err"); return; }
      var added = 0, failed = [], firstError = "", smallest = 0;
      (function next(i) {
        if (i >= list.length) {
          busy = false;
          var msg = "Read " + added + " gem" + (added === 1 ? "" : "s") +
            " from " + (list.length - failed.length) + " screenshot" + (list.length - failed.length === 1 ? "" : "s") + ".";
          if (failed.length) msg = "Couldn't read " + failed.join(", ") + " — " + firstError + (added ? "  (" + msg + ")" : "");
          else if (smallest) msg += " These are small captures (rows " + smallest + " px apart) — worth checking the numbers.";
          setStatus(msg, failed.length ? "err" : "");
          renderChips(); render();
          return;
        }
        setStatus("Reading " + list[i].name + " (" + (i + 1) + " of " + list.length + ")…", "working");
        decode(list[i]).then(function (img) {
          // EFFECT_POOLS is handed to the reader rather than copied inside it —
          // it turns on the cost/effect-pair cross-check.
          var res = window.GemListEngine.parse(img, { pools: A ? A.EFFECT_POOLS : null });
          if (!res.ok) {
            failed.push(list[i].name);
            if (!firstError) firstError = res.error;
            setTimeout(function () { next(i + 1); }, 0);
            return;
          }
          if (res.small) smallest = smallest ? Math.min(smallest, res.small) : res.small;
          var shotId = nextId++;
          shots.push({ id: shotId, name: list[i].name, rows: res.rows.length });
          res.rows.forEach(function (r) {
            gems.push({
              id: nextId++, shotId: shotId,
              gemType: r.gemType || "order", cost: r.cost, points: r.points,
              effect1: r.effect1, effect1Level: r.effect1Level,
              effect2: r.effect2, effect2Level: r.effect2Level,
              equipped: r.equipped === true, flags: r.flags.slice()
            });
            added++;
          });
          // A flagged row opens straight into its editor — the point is that the
          // user sees the doubt, not that the table looks tidy. Unless MOST of
          // the shot came back doubtful, in which case a wall of dropdowns helps
          // nobody: leave them highlighted and let the user open what they want.
          var flagged = gems.filter(function (g) { return g.shotId === shotId && g.flags.length; });
          if (flagged.length <= Math.max(2, res.rows.length / 3))
            flagged.forEach(function (g) { editing[g.id] = true; });
          renderChips(); render();
          setTimeout(function () { next(i + 1); }, 0);
        }, function () {
          failed.push(list[i].name);
          setTimeout(function () { next(i + 1); }, 0);
        });
      })(0);
    });
  }

  // ------------------------------------------------------------------ init
  var built = false, active = false;
  function build() {
    if (built) return;
    var host = $("gr-body-shots");
    if (!host) return;
    host.innerHTML = controlsMarkup();
    built = true;

    var drop = $("gl-drop"), file = $("gl-file");
    drop.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () { addFiles(file.files); file.value = ""; });
    ["dragenter", "dragover"].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files) addFiles(ev.dataTransfer.files);
    });
    $("gl-merge").addEventListener("change", function () { merge = this.checked; render(); });
    $("gl-clear").addEventListener("click", function () {
      gems = []; shots = []; editing = {};
      renderChips(); render(); setStatus("");
    });
    // Ctrl+V anywhere, but only while this mode is the one on screen.
    document.addEventListener("paste", function (ev) {
      if (!active || !ev.clipboardData) return;
      var items = ev.clipboardData.files;
      if (items && items.length) { ev.preventDefault(); addFiles(items); }
    });
  }

  window.GemList = {
    // Called by grader.js when the "From screenshot" mode is selected / left.
    activate: function () { build(); active = true; render(); },
    deactivate: function () { active = false; }
  };
})();
