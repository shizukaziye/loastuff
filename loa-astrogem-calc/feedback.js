/**
 * feedback.js — the "Feedback" tab. A small form that POSTs to the astrogem-bible
 * Worker (?feedback=1), which stores each note in KV under an "fb:" prefix. The owner
 * reviews and clears them from queue-admin.html. Loaded lazily on first tab activation
 * (see LAZY_TABS in index.html); renders once into #tab-feedback.
 *
 * No model dependency, no auth — anyone can leave a note. The Worker trims and length-
 * caps everything, drops honeypot hits, and leans on its HARD_CAP per-IP rate limit.
 */
(function () {
  "use strict";
  var WORKER = "https://astrogem-bible.shizukaziye.workers.dev";
  var TYPES = ["Bug report", "Idea / request", "Praise", "Other"];
  var MSG_MAX = 2000, CONTACT_MAX = 80;
  var rendered = false;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function render() {
    var pane = document.getElementById("tab-feedback");
    if (!pane || rendered) return;
    rendered = true;
    var inputCss = "background:var(--panel2);color:var(--text);border:1px solid var(--border);" +
      "border-radius:6px;padding:7px 9px;font-size:13px;font-family:inherit;width:100%;box-sizing:border-box";
    pane.innerHTML =
      '<div class="panel" style="max-width:620px">' +
      '  <h2>Leave feedback</h2>' +
      '  <p style="color:var(--dim);font-size:13px;margin:0 0 14px;line-height:1.5">' +
      '    Found a bug, want a feature, or just have a thought on the calculator? Drop it here. ' +
      '    Contact is optional — leave it if you want a reply.</p>' +
      '  <div class="fld" style="margin-bottom:10px">' +
      '    <label style="display:block;font-size:12px;color:var(--dim);margin-bottom:4px">Type</label>' +
      '    <select id="fb-type">' + TYPES.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join("") + '</select>' +
      '  </div>' +
      '  <div style="margin-bottom:10px">' +
      '    <label style="display:block;font-size:12px;color:var(--dim);margin-bottom:4px">Your feedback</label>' +
      '    <textarea id="fb-msg" rows="6" maxlength="' + MSG_MAX + '" placeholder="What\'s on your mind?" style="' + inputCss + ';resize:vertical"></textarea>' +
      '    <div style="text-align:right;font-size:11px;color:var(--dim);margin-top:3px"><span id="fb-count">0</span> / ' + MSG_MAX + '</div>' +
      '  </div>' +
      '  <div class="fld" style="margin-bottom:14px">' +
      '    <label style="display:block;font-size:12px;color:var(--dim);margin-bottom:4px">Name or Discord <span style="opacity:.7">(optional)</span></label>' +
      '    <input id="fb-contact" type="text" maxlength="' + CONTACT_MAX + '" placeholder="optional" autocomplete="off">' +
      '  </div>' +
      // honeypot: off-screen, blank for humans; a filled value = a bot, silently dropped.
      '  <input id="fb-website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" ' +
      '         style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' +
      '  <div style="display:flex;align-items:center;gap:12px">' +
      '    <button class="primary" id="fb-send">Send feedback</button>' +
      '    <span id="fb-status" style="font-size:13px"></span>' +
      '  </div>' +
      '</div>';

    var msg = document.getElementById("fb-msg");
    var count = document.getElementById("fb-count");
    msg.addEventListener("input", function () { count.textContent = msg.value.length; });
    document.getElementById("fb-send").addEventListener("click", submit);
  }

  function submit() {
    var btn = document.getElementById("fb-send");
    var status = document.getElementById("fb-status");
    var message = document.getElementById("fb-msg").value.trim();
    if (!message) {
      status.style.color = "var(--high)";
      status.textContent = "Please write something first.";
      return;
    }
    var payload = {
      type: document.getElementById("fb-type").value,
      message: message,
      contact: document.getElementById("fb-contact").value.trim(),
      hp: document.getElementById("fb-website").value  // honeypot
    };
    btn.disabled = true;
    status.style.color = "var(--dim)";
    status.textContent = "Sending…";
    fetch(WORKER + "/?feedback=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function () {
      var pane = document.getElementById("tab-feedback");
      pane.querySelector(".panel").innerHTML =
        '<h2>Thanks</h2>' +
        '<p style="color:var(--text);font-size:14px;line-height:1.5;margin:0 0 14px">' +
        'Your feedback was sent. Appreciate it.</p>' +
        '<button class="primary" id="fb-again">Send another</button>';
      document.getElementById("fb-again").addEventListener("click", function () {
        rendered = false;
        render();
      });
    }).catch(function () {
      btn.disabled = false;
      status.style.color = "var(--high)";
      status.textContent = "Couldn't send — please try again in a moment.";
    });
  }

  document.addEventListener("tabselected", function (e) {
    if (e && e.detail && e.detail.tab === "feedback") render();
  });
  // If the page loads directly on the feedback tab (deep link), render once ready.
  if (document.readyState !== "loading") {
    var p = document.getElementById("tab-feedback");
    if (p && p.classList.contains("active")) render();
  }
})();
