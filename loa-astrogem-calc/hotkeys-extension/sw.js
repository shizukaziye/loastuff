// Global-hotkey bridge for the Astrogem Advisor.
//
// "global": true commands fire even while another app (the game) has focus —
// Chrome registers them with the OS, so Lost Ark never sees the keystroke.
// On each press we find the advisor tab and click the SAME buttons the mouse
// would: #av-read (Read screen now) / #av-go (Get advice). Their existing
// guards ride along free — a disabled button's click() is a no-op, so a solve
// can't be double-launched from the keyboard any more than from the mouse.
//
// Feedback is the extension's toolbar badge: ✓ fired, ⏳ busy, ✗ can't
// (no advisor tab / not sharing yet). Screen sharing itself can't be STARTED
// from here — getDisplayMedia needs a click in the focused tab — so the once-
// per-session "Share game screen" click stays manual; everything after doesn't.

// Runs INSIDE the page (world MAIN) so it can use the page's own selectTab().
function trigger(action) {
  try { if (typeof selectTab === "function") selectTab("advisor"); } catch (e) {}
  var b = document.getElementById(action === "read" ? "av-read" : "av-go");
  if (!b) return "loading";                       // advisor stack still lazy-loading — press again
  if (b.style.display === "none") return "not-sharing";
  if (b.disabled) return "busy";
  b.click();
  return "ok";
}

var BADGE = { ok: "✓", busy: "⏳", loading: "…", "not-sharing": "✗", "no-tab": "✗" };

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || "#444" });
  chrome.action.setBadgeText({ text: text });
  setTimeout(function () { chrome.action.setBadgeText({ text: "" }); }, 2000);
}

chrome.commands.onCommand.addListener(function (command) {
  var action = command === "read-screen" ? "read" : "advice";
  chrome.tabs.query({
    url: ["https://www.loseii.com/loa-astrogem-calc/*", "http://localhost:8732/loa-astrogem-calc/*"]
  }, function (tabs) {
    if (!tabs || !tabs.length) { badge(BADGE["no-tab"], "#c33"); return; }
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: "MAIN",
      func: trigger,
      args: [action]
    }).then(function (res) {
      var r = (res && res[0] && res[0].result) || "ok";
      badge(BADGE[r] || "✓", r === "ok" ? "#2c7" : r === "busy" ? "#a80" : "#c33");
    }).catch(function () { badge("✗", "#c33"); });
  });
});
