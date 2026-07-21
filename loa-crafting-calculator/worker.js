// CORS proxy for the Lost Ark market price API used by the calculator.
//
// WHY: the upstream market API (the same one loa-buddy.pages.dev uses) only
// returns Access-Control-Allow-Origin for loa-buddy's own domain, so a browser
// page hosted anywhere else can't read its responses. This worker calls the API
// server-side (where CORS doesn't apply) and re-serves it with open CORS.
//
// DEPLOY (free, ~3 min):
//   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker
//   2. Replace the default code with this file, click Deploy
//   3. Copy the worker URL and append /v1/prices/latest, e.g.
//        https://loa-proxy.<you>.workers.dev/v1/prices/latest
//      ...then paste that into the calculator's "Proxy URL" field.
//
// The calculator POSTs {region_slug, item_slugs:[...]} and expects back
// [{item_slug, price, timestamp}, ...] — exactly what the upstream returns.

const UPSTREAM = "https://marketdata-api.yrzhao1068589.workers.dev/v1/prices/latest";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST")
      return new Response("POST {region_slug, item_slugs} only", { status: 405, headers: CORS });
    try {
      const body = await req.text();
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
