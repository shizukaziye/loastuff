/**
 * worker/cors.js — the ONE CORS allowlist for the three astrogem workers
 * (astrogem-bible, astrogem-data, astrogem-verify). Each worker imports it and wrangler
 * bundles the import into each deploy, so a change here ships only when all three are
 * redeployed (a git push deploys none of them).
 *
 * Allowed origins:
 *   https://www.loseii.com, https://loseii.com    the site (apex redirects to www)
 *   https://shizukaziye.github.io                  old standalone tabs + the GPD lookup
 *   https://loastuff.pages.dev                     the Pages origin
 *   https://<branch>.loastuff.pages.dev            branch and commit previews
 *   http://localhost[:port], http://127.0.0.1[:port]   local dev on any port
 *                                                  (8080, 8788, 8790-8799 today)
 * Any other Origin gets NO Access-Control-Allow-Origin — never a stand-in origin — so the
 * browser blocks the read. Requests with no Origin (curl, cron, server-to-server) get no
 * grant either: CORS only binds browsers, and auth never rests on it (admin routes still
 * need the X-Admin-Token header whatever the origin).
 */

const SITE_ORIGINS = [
  "https://www.loseii.com",
  "https://loseii.com",
  "https://shizukaziye.github.io",
  "https://loastuff.pages.dev"
];
// An Origin is scheme://host[:port] with no path; browsers send it lower-case.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.loastuff\.pages\.dev$/;

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && origin !== "" &&
    (SITE_ORIGINS.indexOf(origin) !== -1 || LOCAL_ORIGIN.test(origin) || PREVIEW_ORIGIN.test(origin));
}

/**
 * The CORS headers for one request. `extra` holds the worker's own settings:
 *   headers  Access-Control-Allow-Headers   (default "Content-Type")
 *   methods  Access-Control-Allow-Methods   (default "GET, POST, OPTIONS")
 *   expose   Access-Control-Expose-Headers  (sent only when set, e.g. "ETag")
 *   origins  exact origins this ONE worker grants on top of the shared list
 *            (astrogem-bible: the lostark.bible bookmarklet's two origins)
 * An allowed Origin is echoed back. Anything else gets only `Vary: Origin`, which every
 * answer carries so no cache hands one origin's grant (or refusal) to another.
 */
export function corsHeaders(request, extra) {
  const x = extra || {};
  const origin = request.headers.get("Origin") || "";
  const ok = isAllowedOrigin(origin) ||
    (origin !== "" && Array.isArray(x.origins) && x.origins.indexOf(origin) !== -1);
  if (!ok) return { "Vary": "Origin" };
  const h = {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": x.methods || "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": x.headers || "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  if (x.expose) h["Access-Control-Expose-Headers"] = x.expose;
  return h;
}
