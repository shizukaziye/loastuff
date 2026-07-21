/* ============================================================
   loseii.com — shared social & donation bar
   ------------------------------------------------------------
   Add to ANY page with ONE line, ideally before </body>:

       <script src="https://loseii.com/social-bar.js" defer></script>

   (Until loseii.com is pointed at the loastuff repo, you can use
    https://shizukaziye.github.io/loastuff/social-bar.js instead —
    it's the same file and will keep working afterward.)

   Everything below — links, colours, markup — lives here only.
   Change a link once, every page that loads this file updates.
   ============================================================ */
(function () {
  "use strict";

  // Guard against double-injection if the script is included twice.
  if (window.__loseiiBar) return;
  window.__loseiiBar = true;

  /* ---- The only things you'll ever edit ------------------- */
  var LINKS = {
    twitch:  "https://twitch.tv/shizukaziye",
    youtube: "https://www.youtube.com/@shizukaziye",
    kofi:    "https://ko-fi.com/shizukaziye"
  };
  /* --------------------------------------------------------- */

  var ICONS = {
    twitch:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4.3 3 3 6.5v12.2h4.2V21h2.3l2.2-2.3h3.4L21 14V3H4.3zm14.5 10.3-2.6 2.6h-3.4l-2.2 2.2v-2.2H7.9V4.7h10.9v8.6zM15.6 7v4.6h-1.5V7h1.5zm-4.1 0v4.6H10V7h1.5z"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M23 7.5a3 3 0 0 0-2.1-2.1C19 4.9 12 4.9 12 4.9s-7 0-8.9.5A3 3 0 0 0 1 7.5C.5 9.4.5 12 .5 12s0 2.6.5 4.5a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5A3 3 0 0 0 23 16.5c.5-1.9.5-4.5.5-4.5s0-2.6-.5-4.5zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z"/></svg>',
    kofi:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 4h13.5A4.5 4.5 0 0 1 22 8.5 4.5 4.5 0 0 1 17.5 13H17a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V5a1 1 0 0 1 1-1zm13 3v4h.5A2.5 2.5 0 0 0 20 8.5 2.5 2.5 0 0 0 17.5 6H17v1zM3 20h14v2H3v-2z"/></svg>'
  };

  var host = document.createElement("div");
  host.setAttribute("data-loseii-bar", "");
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.bar{' +
      'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));' +
      'transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;align-items:center;gap:6px;' +
      'padding:7px 8px;border-radius:999px;' +
      'background:rgba(16,19,25,.82);backdrop-filter:blur(10px);' +
      '-webkit-backdrop-filter:blur(10px);' +
      'border:1px solid #262b36;' +
      'box-shadow:0 10px 30px -10px rgba(0,0,0,.75);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'opacity:0;translate:0 12px;transition:opacity .4s ease,translate .4s ease;' +
    '}' +
    '.bar.in{opacity:1;translate:0 0}' +
    '.ico{' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:38px;height:38px;border-radius:999px;' +
      'color:#98a1b2;text-decoration:none;' +
      'transition:color .16s ease,background .16s ease,transform .16s ease;' +
    '}' +
    '.ico:hover{background:#1a1e27;transform:translateY(-2px)}' +
    '.ico.twitch:hover{color:#a970ff}' +
    '.ico.youtube:hover{color:#ff4d4d}' +
    '.ico:focus-visible{outline:2px solid #e8b75c;outline-offset:2px}' +
    '.sep{width:1px;height:22px;background:#262b36;margin:0 2px}' +
    '.kofi{' +
      'display:inline-flex;align-items:center;gap:7px;' +
      'height:38px;padding:0 15px 0 13px;border-radius:999px;' +
      'text-decoration:none;font-size:14px;font-weight:700;letter-spacing:-.01em;' +
      'color:#0c0e12;background:linear-gradient(180deg,#f4d79a,#e8b75c);' +
      'box-shadow:0 2px 0 #a9802a;' +
      'transition:transform .16s ease,filter .16s ease;white-space:nowrap;' +
    '}' +
    '.kofi:hover{transform:translateY(-2px);filter:brightness(1.06)}' +
    '.kofi:focus-visible{outline:2px solid #fff3d6;outline-offset:2px}' +
    '@media (max-width:420px){' +
      '.bar{gap:4px;padding:6px 7px}' +
      '.ico{width:34px;height:34px}' +
      '.kofi{height:34px;padding:0 13px 0 11px;font-size:13px}' +
    '}' +
    '@media (prefers-reduced-motion:reduce){' +
      '.bar,.ico,.kofi{transition:none}' +
      '.bar{opacity:1;translate:0 0}' +
    '}' +
    '</style>' +
    '<div class="bar" part="bar">' +
      '<a class="ico twitch" href="' + LINKS.twitch + '" target="_blank" rel="noopener" aria-label="Watch on Twitch">' + ICONS.twitch + '</a>' +
      '<a class="ico youtube" href="' + LINKS.youtube + '" target="_blank" rel="noopener" aria-label="Watch on YouTube">' + ICONS.youtube + '</a>' +
      '<span class="sep"></span>' +
      '<a class="kofi" href="' + LINKS.kofi + '" target="_blank" rel="noopener" aria-label="Support me on Ko-fi">' + ICONS.kofi + '<span>Support</span></a>' +
    '</div>';

  function mount() {
    document.body.appendChild(host);
    // next frame -> trigger the entrance transition
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var bar = root.querySelector(".bar");
        if (bar) bar.classList.add("in");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
