// Cloudflare Worker: CORS proxy for Yahoo Finance chart API only.
// Usage from the page:  https://YOUR-NAME.workers.dev/?url=<encoded yahoo url>
export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    const u = new URL(request.url).searchParams.get('url');
    if (!u) return new Response('missing url', { status: 400, headers: cors });
    let t;
    try { t = new URL(u); } catch (e) { return new Response('bad url', { status: 400, headers: cors }); }
    if (!['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(t.hostname))
      return new Response('forbidden', { status: 403, headers: cors });
    const r = await fetch(t.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
