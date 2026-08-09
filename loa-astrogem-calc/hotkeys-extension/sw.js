// Global-hotkey bridge for the Astrogem Advisor.
//
// "global": true commands fire even while another app (the game) has focus —
// Chrome registers them with the OS, so Lost Ark never sees the keystroke.
// On each press we find the advisor tab and click the SAME buttons the mouse
// would: #av-read (Read screen now) / #av-go (Get advice). Their existing
// guards ride along free — a disabled button's click() is a no-op, so a solve
// can't be double-launched from the keyboard any more than from the mouse.
//
// Feedback lands in TWO places: a toast INSIDE the advisor page (visible on a
// second monitor whether or not the toolbar icon is pinned) and the extension
// badge (✓ / ⏳ / ✗). Screen sharing itself can't be STARTED from here —
// getDisplayMedia needs a click in the focused tab — so the once-per-session
// "Share game screen" click stays manual; everything after doesn't.

// Runs INSIDE the page (world MAIN) so it can use the page's own selectTab().
function trigger(action) {
  try { if (typeof selectTab === "function") selectTab("advisor"); } catch (e) {}
  var b = document.getElementById(action === "read" ? "av-read" : "av-go");
  var r;
  if (!b) r = "loading";                          // advisor stack still lazy-loading — press again
  else if (b.style.display === "none") r = "not-sharing";
  else if (b.disabled) r = "busy";
  else { b.click(); r = "ok"; }

  // In-page toast: unmissable on the monitor the tab lives on.
  try {
    var MSG = {
      ok: (action === "read" ? "⌨ 📷 Reading screen…" : "⌨ Getting advice…"),
      busy: "⌨ Busy — a solve is already running",
      loading: "⌨ Advisor loading — press again",
      "not-sharing": "⌨ Not sharing — click 🖥 Share game screen once first"
    };
    var t = document.getElementById("av-hotkey-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "av-hotkey-toast";
      t.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;" +
        "padding:10px 22px;border-radius:10px;font:700 18px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.5);" +
        "pointer-events:none;transition:opacity .3s";
      document.body.appendChild(t);
    }
    t.textContent = MSG[r] || r;
    t.style.background = r === "ok" ? "#1d3a26" : r === "busy" ? "#3a331d" : "#3a1d1d";
    t.style.color = r === "ok" ? "#8ce99a" : r === "busy" ? "#ffd43b" : "#ffa8a8";
    t.style.opacity = "1";
    clearTimeout(t._hkT);
    t._hkT = setTimeout(function () { t.style.opacity = "0"; }, 1800);
  } catch (e) {}
  return r;
}

// The content script (announce.js) asks for the CURRENT bindings so the page
// can label its buttons with the real keys, rebinds included.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.t !== "keys") return;
  chrome.commands.getAll(function (cmds) {
    var out = {};
    (cmds || []).forEach(function (c) {
      if (c.name === "read-screen") out.read = c.shortcut || "";
      if (c.name === "get-advice") out.advice = c.shortcut || "";
    });
    sendResponse(out);
  });
  return true;   // sendResponse is async
});

var BADGE = { ok: "✓", busy: "⏳", loading: "…", "not-sharing": "✗", "no-tab": "✗" };

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || "#444" });
  chrome.action.setBadgeText({ text: text });
  setTimeout(function () { chrome.action.setBadgeText({ text: "" }); }, 2000);
}

// Match ONLY the app page (the directory root) — /loa-astrogem-calc/* also
// matched queue-admin, and whichever tab enumerated first got the click; the
// admin page has no advisor buttons, so the hotkey looked dead. Inject into
// every match (belt: a stray second app tab still works) and badge the best.
var APP_URLS = [
  "https://www.loseii.com/loa-astrogem-calc/",
  "https://loseii.com/loa-astrogem-calc/",
  "http://localhost:8732/loa-astrogem-calc/"
];
var RANK = { ok: 0, busy: 1, "not-sharing": 2, loading: 3 };

chrome.commands.onCommand.addListener(function (command) {
  var action = command === "read-screen" ? "read" : "advice";
  chrome.tabs.query({ url: APP_URLS }, function (tabs) {
    if (!tabs || !tabs.length) { badge(BADGE["no-tab"], "#c33"); return; }
    Promise.all(tabs.map(function (tab) {
      return chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: trigger,
        args: [action]
      }).then(function (res) { return (res && res[0] && res[0].result) || "ok"; },
              function () { return null; });
    })).then(function (results) {
      var best = results.filter(Boolean).sort(function (a, b) { return (RANK[a] ?? 9) - (RANK[b] ?? 9); })[0];
      if (!best) { badge("✗", "#c33"); return; }
      badge(BADGE[best] || "✓", best === "ok" ? "#2c7" : best === "busy" ? "#a80" : "#c33");
    });
  });
});
