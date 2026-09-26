/* ============================================================
   loseii.com — shared top navigation bar
   ------------------------------------------------------------
   Add to ANY page with ONE line, ideally before </body>:

       <script src="https://www.loseii.com/nav.js" defer></script>

   Renders a fixed top bar (Loseii wordmark, the lostark.bible
   sign-in control and a grouped "Tools" dropdown) so every tool —
   whether it's served from loseii.com or from GitHub Pages —
   feels like one site.

   THE TOOL LIST lives in /shared/tools.js. The GROUPS block below
   is a copy of it (name + url), kept so the nav never depends on a
   second file loading. Edit tools.js, then run
   `node tools/check-tools.mjs --write` at the repo root to rewrite
   the block; `npm run check` fails while the two disagree. A page
   that has loaded tools.js itself gets its list from there.

   SIGN-IN. On www.loseii.com (and its previews and localhost) the
   bar carries the site's one "Sign in with lostark.bible" control.
   It needs window.BibleOAuth: a page that loaded
   /shared/bible-oauth.js already has it, and every other page gets
   it loaded here, once. The control only calls login()/logout();
   handling the trip back from the consent screen (handleRedirect)
   stays with each page.
   ============================================================ */
(function () {
  "use strict";

  if (window.__loseiiNav) return;
  window.__loseiiNav = true;

  var HOME = "https://www.loseii.com/";

  // The ?v= pin of /shared/bible-oauth.js. MUST equal the pin every page uses for that
  // file (the hub, astrogem, bracelet, GPD); `npm run check` compares them. nav.js itself
  // is served no-cache, so a change here reaches every page at once.
  var OAUTH_V = "1";
  var OAUTH_SRC = "/shared/bible-oauth.js?v=" + OAUTH_V;

  /* TOOLS:BEGIN — generated from /shared/tools.js by tools/check-tools.mjs --write */
  var GROUPS = [
    {
      label: "Lost Ark",
      items: [
        { name: "Character Profiles", url: "https://www.loseii.com/#find" },
        { name: "Accessory Value Calculator", url: "https://www.loseii.com/lost-ark-accessories/" },
        { name: "Astrogem Calculator", url: "https://www.loseii.com/loa-astrogem-calc/" },
        { name: "Bracelet Calculator", url: "https://www.loseii.com/loa-bracelet-calc/" },
        { name: "Stronghold Crafting Profit", url: "https://www.loseii.com/loa-crafting-calculator/" },
        { name: "Deal Finder", url: "https://www.loseii.com/loa-deal-finder/" },
        { name: "GPD Chart", url: "https://www.loseii.com/loa-gpd/" },
        { name: "Hell Key Calculator", url: "https://www.loseii.com/loa-hell-key-calc/" },
        { name: "LOA ON Bingo", url: "https://loa-on-bingo.shizukaziye.workers.dev/" },
        { name: "LOA ON 2026 Summer", url: "https://www.loseii.com/loa-on-2026-summer/" }
      ]
    },
    {
      label: "League of Legends",
      items: [
        { name: "Champion Pool Coverage", url: "https://shizukaziye.github.io/lol-pool-coverage/" }
      ]
    },
    {
      label: "Finance",
      items: [
        { name: "FIRE Calculator", url: "https://shizukaziye.github.io/fire-calculator/" }
      ]
    }
  ];
  /* TOOLS:END */
  try {
    var T = window.LOSEII_TOOLS;
    if (T && T.groups && T.groups.length) GROUPS = T.groups;
  } catch (e) {}

  // Normalise a URL to host + path (no trailing slash) for match.
  function keyOf(u) {
    try {
      var a = document.createElement("a");
      a.href = u;
      return (a.host + a.pathname).replace(/\/+$/, "");
    } catch (e) { return u; }
  }
  var here = keyOf(location.href);

  // Is this page the item's tool? A tool owns its whole folder, so a tab path such as
  // /loa-bracelet-calc/advisor still marks the Bracelet Calculator. An item at a site root
  // matches that root only; otherwise a home entry would light up on every page of its host.
  // An item with a #hash (Character Profiles, /#find) is a spot on another page, never "here".
  function isHere(url) {
    if (url.indexOf("#") !== -1) return false;
    var k = keyOf(url);
    return k === here || (k.indexOf("/") !== -1 && here.indexOf(k + "/") === 0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Sign-in belongs to the site's own origin: the session lives in its localStorage, and
  // lostark.bible only sends users back to its registered addresses. Pages on other hosts
  // (the github.io tools) get no control.
  var ON_SITE = /(^|\.)loseii\.com$|(^|\.)loastuff\.pages\.dev$|^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  var host = document.createElement("div");
  host.setAttribute("data-loseii-nav", "");
  var root = host.attachShadow({ mode: "open" });

  var groupsHTML = GROUPS.map(function (g) {
    var links = g.items.map(function (it) {
      // .active paints this page's tool; aria-current says the same to a screen reader.
      var on = isHere(it.url);
      return '<a class="item' + (on ? " active" : "") + '" href="' + esc(it.url) + '"' +
        (on ? ' aria-current="page"' : "") + ">" + esc(it.name) + "</a>";
    }).join("");
    return '<div class="group"><div class="ghead">' + esc(g.label) + "</div>" + links + "</div>";
  }).join("");

  var GOLD = "var(--lx-gold,#e8b75c)";
  root.innerHTML =
    "<style>" +
    ":host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
    "*{box-sizing:border-box}" +
    ".bar{" +
      "position:fixed;top:0;left:0;right:0;z-index:2147482000;" +
      "height:54px;display:flex;align-items:center;justify-content:space-between;" +
      "padding:0 16px;gap:12px;" +
      "background:rgba(12,14,18,.82);backdrop-filter:blur(12px);" +
      "-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #20242e;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
    "}" +
    ".brand{" +
      "display:inline-flex;align-items:center;gap:9px;text-decoration:none;" +
      "font-size:20px;font-weight:800;letter-spacing:-.02em;" +
      "background:linear-gradient(180deg,#fff 0%,var(--lx-gold-light,#f4d79a) 55%," + GOLD + " 100%);" +
      "-webkit-background-clip:text;background-clip:text;color:transparent;" +
    "}" +
    ".gem{width:18px;height:18px;flex-shrink:0}" +
    ".right{display:flex;align-items:center;gap:8px;min-width:0}" +
    ".menu-btn,.auth{" +
      "display:inline-flex;align-items:center;gap:7px;cursor:pointer;" +
      "height:38px;padding:0 14px;border-radius:var(--lx-radius-pill,999px);" +
      "background:var(--lx-hub-surface,#14171e);border:1px solid var(--lx-hub-border,#262b36);color:var(--lx-text,#e7e9ee);" +
      "font-size:14px;font-weight:600;font-family:inherit;white-space:nowrap;" +
      "transition:background .15s ease,border-color .15s ease,color .15s ease;" +
    "}" +
    ".menu-btn:hover,.auth:hover{background:var(--lx-hub-surface-2,#1a1e27);border-color:#3a4150}" +
    ".menu-btn:focus-visible,.auth:focus-visible{outline:2px solid " + GOLD + ";outline-offset:2px}" +
    ".auth{font-weight:500;color:#cdd2dc;font-size:13px}" +
    ".auth[hidden]{display:none}" +
    ".auth[disabled]{opacity:.6;cursor:default}" +
    ".auth .who{color:" + GOLD + ";font-weight:600}" +
    ".auth .short{display:none}" +
    "@media (max-width:560px){.auth{padding:0 11px}.auth .long{display:none}.auth .short{display:inline}}" +
    ".caret{transition:transform .18s ease}" +
    ".menu-btn[aria-expanded='true'] .caret{transform:rotate(180deg)}" +
    ".panel{" +
      "position:fixed;top:60px;right:12px;z-index:2147482000;" +
      "width:min(280px,calc(100vw - 24px));max-height:calc(100vh - 74px);overflow:auto;" +
      "background:#111420;border:1px solid var(--lx-hub-border,#262b36);border-radius:var(--lx-radius,14px);" +
      "box-shadow:0 18px 46px -16px rgba(0,0,0,.8);padding:8px;" +
      "opacity:0;transform:translateY(-8px);pointer-events:none;visibility:hidden;" +
      "transition:opacity .16s ease,transform .16s ease,visibility .16s;" +
    "}" +
    ".panel.open{opacity:1;transform:translateY(0);pointer-events:auto;visibility:visible}" +
    ".group{padding:6px 4px}" +
    ".group + .group{border-top:1px solid #20242e;margin-top:2px}" +
    ".ghead{" +
      "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
      "color:" + GOLD + ";padding:4px 10px 6px;" +
    "}" +
    ".item{" +
      "display:block;text-decoration:none;color:#cdd2dc;" +
      "font-size:14px;padding:8px 10px;border-radius:var(--lx-radius-sm,8px);" +
      "transition:background .13s ease,color .13s ease;" +
    "}" +
    ".item:hover{background:var(--lx-hub-surface-2,#1a1e27);color:#fff}" +
    ".item:focus-visible{outline:2px solid " + GOLD + ";outline-offset:-2px}" +
    ".item.active{color:" + GOLD + ";background:#191d27}" +
    "@media (prefers-reduced-motion:reduce){.caret,.panel{transition:none}}" +
    "</style>" +
    '<nav class="bar" part="bar" aria-label="Loseii">' +
      '<a class="brand" href="' + HOME + '">' +
        "<svg class='gem' viewBox='0 0 32 32' aria-hidden='true'><path d='M16 3 29 12 16 29 3 12z' fill='#e8b75c'/><path d='M3 12h26M16 3v26' stroke='#fff3d6' stroke-opacity='.5' stroke-width='.8'/></svg>" +
        "Loseii" +
      "</a>" +
      '<div class="right">' +
        '<button class="auth" type="button" hidden></button>' +
        '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="loseii-nav-panel">' +
          "Tools" +
          "<svg class='caret' aria-hidden='true' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>" +
        "</button>" +
      "</div>" +
    "</nav>" +
    '<div class="panel" id="loseii-nav-panel">' + groupsHTML + "</div>";

  // ---- the lostark.bible sign-in control ----
  // Resolves with window.BibleOAuth, loading /shared/bible-oauth.js at most once per page.
  function withOAuth(cb) {
    if (window.BibleOAuth) { cb(window.BibleOAuth); return; }
    var tag = document.querySelector('script[src*="/shared/bible-oauth.js"]');
    if (!tag) {
      tag = document.createElement("script");
      tag.src = OAUTH_SRC;
      tag.async = true;
      document.head.appendChild(tag);
    }
    tag.addEventListener("load", function () { if (window.BibleOAuth) cb(window.BibleOAuth); });
  }

  function mountAuth(O) {
    var btn = root.querySelector(".auth");
    if (!btn || !O || !O.configured || !O.configured()) return;
    function paint() {
      btn.disabled = false;
      btn.hidden = false;
      if (O.signedIn()) {
        btn.innerHTML = '<span class="who">Signed in</span> · Sign out';
        btn.setAttribute("aria-label", "Signed in to lostark.bible \u2014 sign out");
        btn.title = "Signed in to lostark.bible on every Loseii page. Click to sign out.";
      } else {
        btn.innerHTML = '<span class="long">Sign in with lostark.bible</span><span class="short">Sign in</span>';
        btn.setAttribute("aria-label", "Sign in with lostark.bible");
        btn.title = "One sign-in for every Loseii tool: it reads your own linked roster, nobody else's.";
      }
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      btn.disabled = true;
      if (O.signedIn()) {
        O.logout().then(paint, paint);
      } else {
        try { O.login(); } catch (err) { paint(); }
      }
    });
    // onChange fires for this tab's sign-in and sign-out and, through the storage event,
    // for every other tab's.
    if (O.onChange) O.onChange(paint);
    paint();
  }

  function mount() {
    document.body.appendChild(host);

    // Push page content down so the fixed bar never covers it.
    var b = document.body;
    if (!b.hasAttribute("data-loseii-nav-offset")) {
      var cur = parseFloat(getComputedStyle(b).paddingTop) || 0;
      b.style.paddingTop = (cur + 54) + "px";
      b.setAttribute("data-loseii-nav-offset", "");
    }
    // Pages with their own sticky panels use this to sit below the bar
    // (styles say top:var(--loseii-nav-offset,0px), so no-nav pages get 0).
    document.documentElement.style.setProperty("--loseii-nav-offset", "54px");

    var btn = root.querySelector(".menu-btn");
    var panel = root.querySelector(".panel");

    function setOpen(open) {
      panel.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(!panel.classList.contains("open"));
    });
    // The Tools button is a disclosure (aria-expanded + aria-controls), not a menu: the
    // panel is a plain list of links. It closes on an outside click, on Escape (focus goes
    // back to the button) and when keyboard focus leaves the bar and panel for the page.
    document.addEventListener("click", function () { setOpen(false); });
    root.addEventListener("focusout", function (e) {
      var to = e.relatedTarget;
      if (to && !root.contains(to)) setOpen(false);
    });
    root.addEventListener("click", function (e) { e.stopPropagation(); });
    panel.addEventListener("click", function (e) {
      if (e.target.closest(".item")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && panel.classList.contains("open")) {
        setOpen(false);
        btn.focus();
      }
    });

    if (ON_SITE) {
      try { withOAuth(mountAuth); } catch (e) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
