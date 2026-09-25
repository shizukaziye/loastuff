/* ============================================================
   loseii-chrome-cache — keeps the shared chrome un-cached.
   ------------------------------------------------------------
   Problem: the loseii.com zone rewrites Cache-Control on .js to
   max-age=14400, so nav.js / social-bar.js edits took up to 4 h
   to reach browsers even though _headers says no-cache. Wrangler
   here has no zone-settings scope, but it can route a worker.

   This worker sits on four routes (wrangler.toml):
       www.loseii.com/nav.js*
       www.loseii.com/social-bar.js*
       www.loseii.com/loa-gpd/prices.js*
       www.loseii.com/loa-hell-key-calc/prices.js*
   and proxies the Pages origin, forcing Cache-Control: no-cache.
   Worker responses are not rewritten by the zone, so browsers
   revalidate every load — the "edit once, live everywhere"
   behavior the shared chrome was built on. The two prices.js
   files are here because CI rewrites them every 6 h with no pin
   bump; _headers says no-cache for them too, but on this zone
   only a worker makes that stick.

   The trailing * matters: a route pattern is matched against the
   whole URL, query string included, so "…/nav.js" alone missed
   "nav.js?cb=123", which then got the zone's 4 h rule.

   Revalidation: the browser's If-None-Match / If-Modified-Since
   go on to the origin and a 304 comes straight back (still
   no-cache), so an unchanged file costs a header round trip, not
   a full download.

   Deploy: npx wrangler deploy -c chrome-cache-worker/wrangler.toml
   ============================================================ */

const ORIGIN = "https://loastuff.pages.dev";
const CONDITIONAL = ["If-None-Match", "If-Modified-Since"];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const fwd = { "Accept-Encoding": "gzip" };
    for (const h of CONDITIONAL) {
      const v = request.headers.get(h);
      if (v) fwd[h] = v;
    }
    const upstream = await fetch(ORIGIN + url.pathname, { headers: fwd });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-cache");
    // A 304 has no body, and new Response() throws on a 304 given one.
    return new Response(upstream.status === 304 ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
