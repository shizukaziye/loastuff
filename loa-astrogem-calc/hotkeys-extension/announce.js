// Content script: tell the advisor page the extension is installed and which
// keys are CURRENTLY bound (the user may have rebound them at
// chrome://extensions/shortcuts — we report the live bindings, not defaults).
// A plain web page cannot detect an extension any other way, so the channel is
// a data attribute on <html> plus an event the page listens for.
(function () {
  function announce(keys) {
    try {
      document.documentElement.dataset.astrogemHotkeys = JSON.stringify(keys || {});
      document.documentElement.dispatchEvent(new CustomEvent("astrogem-hotkeys"));
    } catch (e) {}
  }
  try {
    chrome.runtime.sendMessage({ t: "keys" }, function (resp) {
      if (chrome.runtime.lastError || !resp) { announce({}); return; }
      announce(resp);
    });
  } catch (e) { announce({}); }
})();
