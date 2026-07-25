/* ============================================================
   loseii-chrome-cache — keeps the shared chrome un-cached.
   ------------------------------------------------------------
   Problem: the loseii.com zone rewrites Cache-Control on .js to
   max-age=14400, so nav.js / social-bar.js edits took up to 4 h
   to reach browsers even though _headers says no-cache. Wrangler
   here has no zone-settings scope, but it can route a worker.

   This worker sits on exactly two routes:
       www.loseii.com/nav.js
       www.loseii.com/social-bar.js
   and proxies the Pages origin, forcing Cache-Control: no-cache.
   Worker responses are not rewritten by the zone, so browsers
   revalidate every load — the "edit once, live everywhere"
   behavior the shared chrome was built on.

   Deploy: npx wrangler deploy -c chrome-cache-worker/wrangler.toml
   ============================================================ */

const ORIGIN = "https://loastuff.pages.dev";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = await fetch(ORIGIN + url.pathname, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-cache");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
