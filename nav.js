/* ============================================================
   loseii.com — shared top navigation bar
   ------------------------------------------------------------
   Add to ANY page with ONE line, ideally before </body>:

       <script src="https://www.loseii.com/nav.js" defer></script>

   Renders a fixed top bar (Loseii wordmark + a grouped "Tools"
   dropdown) so every tool — whether it's served from loseii.com
   or from GitHub Pages — feels like one site.

   To add / rename / move a tool, edit the GROUPS array below.
   Every page that loads this file updates automatically.
   ============================================================ */
(function () {
  "use strict";

  if (window.__loseiiNav) return;
  window.__loseiiNav = true;

  var HOME = "https://www.loseii.com/";

  /* ---- The only thing you'll ever edit --------------------- */
  var GROUPS = [
    {
      label: "Lost Ark",
      items: [
        { name: "DPS Tier List",        url: "https://www.loseii.com/loa-tierlist/" },
        { name: "Accessory Calculator", url: "https://www.loseii.com/lost-ark-accessories/" },
        { name: "Astrogem Calculator",  url: "https://www.loseii.com/astrogem-calculator/" },
        { name: "Crafting Profit",      url: "https://www.loseii.com/loa-crafting-calculator/" },
        { name: "Deal Finder",          url: "https://www.loseii.com/loa-deal-finder/" },
        { name: "LOA ON Bingo",         url: "https://loa-on-bingo.shizukaziye.workers.dev/" },
        { name: "LOA ON 2026 Summer",   url: "https://www.loseii.com/loa-on-2026-summer/" }
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
  /* ---------------------------------------------------------- */

  // Normalise a URL to host + path (no trailing slash) for match.
  function keyOf(u) {
    try {
      var a = document.createElement("a");
      a.href = u;
      return (a.host + a.pathname).replace(/\/+$/, "");
    } catch (e) { return u; }
  }
  var here = keyOf(location.href);

  var host = document.createElement("div");
  host.setAttribute("data-loseii-nav", "");
  var root = host.attachShadow({ mode: "open" });

  var groupsHTML = GROUPS.map(function (g) {
    var links = g.items.map(function (it) {
      var active = keyOf(it.url) === here ? " active" : "";
      return '<a class="item' + active + '" href="' + it.url + '">' + it.name + "</a>";
    }).join("");
    return '<div class="group"><div class="ghead">' + g.label + "</div>" + links + "</div>";
  }).join("");

  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
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
      "background:linear-gradient(180deg,#fff 0%,#f4d79a 55%,#e8b75c 100%);" +
      "-webkit-background-clip:text;background-clip:text;color:transparent;" +
    "}" +
    ".gem{width:18px;height:18px;flex-shrink:0}" +
    ".menu-btn{" +
      "display:inline-flex;align-items:center;gap:7px;cursor:pointer;" +
      "height:38px;padding:0 14px;border-radius:999px;" +
      "background:#14171e;border:1px solid #262b36;color:#e7e9ee;" +
      "font-size:14px;font-weight:600;font-family:inherit;" +
      "transition:background .15s ease,border-color .15s ease;" +
    "}" +
    ".menu-btn:hover{background:#1a1e27;border-color:#3a4150}" +
    ".menu-btn:focus-visible{outline:2px solid #e8b75c;outline-offset:2px}" +
    ".caret{transition:transform .18s ease}" +
    ".menu-btn[aria-expanded='true'] .caret{transform:rotate(180deg)}" +
    ".panel{" +
      "position:fixed;top:60px;right:12px;z-index:2147482000;" +
      "width:min(280px,calc(100vw - 24px));max-height:calc(100vh - 74px);overflow:auto;" +
      "background:#111420;border:1px solid #262b36;border-radius:14px;" +
      "box-shadow:0 18px 46px -16px rgba(0,0,0,.8);padding:8px;" +
      "opacity:0;transform:translateY(-8px);pointer-events:none;" +
      "transition:opacity .16s ease,transform .16s ease;" +
    "}" +
    ".panel.open{opacity:1;transform:translateY(0);pointer-events:auto}" +
    ".group{padding:6px 4px}" +
    ".group + .group{border-top:1px solid #20242e;margin-top:2px}" +
    ".ghead{" +
      "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
      "color:#e8b75c;padding:4px 10px 6px;" +
    "}" +
    ".item{" +
      "display:block;text-decoration:none;color:#cdd2dc;" +
      "font-size:14px;padding:8px 10px;border-radius:8px;" +
      "transition:background .13s ease,color .13s ease;" +
    "}" +
    ".item:hover{background:#1a1e27;color:#fff}" +
    ".item.active{color:#e8b75c;background:#191d27}" +
    "@media (prefers-reduced-motion:reduce){.caret,.panel{transition:none}}" +
    "</style>" +
    '<nav class="bar" part="bar">' +
      '<a class="brand" href="' + HOME + '">' +
        "<svg class='gem' viewBox='0 0 32 32' aria-hidden='true'><path d='M16 3 29 12 16 29 3 12z' fill='#e8b75c'/><path d='M3 12h26M16 3v26' stroke='#fff3d6' stroke-opacity='.5' stroke-width='.8'/></svg>" +
        "Loseii" +
      "</a>" +
      '<button class="menu-btn" aria-haspopup="true" aria-expanded="false" aria-controls="loseii-nav-panel">' +
        "Tools" +
        "<svg class='caret' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>" +
      "</button>" +
    "</nav>" +
    '<div class="panel" id="loseii-nav-panel" role="menu">' + groupsHTML + "</div>";

  function mount() {
    document.body.appendChild(host);

    // Push page content down so the fixed bar never covers it.
    var b = document.body;
    if (!b.hasAttribute("data-loseii-nav-offset")) {
      var cur = parseFloat(getComputedStyle(b).paddingTop) || 0;
      b.style.paddingTop = (cur + 54) + "px";
      b.setAttribute("data-loseii-nav-offset", "");
    }

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
    // Close on outside click or Escape.
    document.addEventListener("click", function () { setOpen(false); });
    root.addEventListener("click", function (e) { e.stopPropagation(); });
    panel.addEventListener("click", function (e) {
      if (e.target.closest(".item")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
