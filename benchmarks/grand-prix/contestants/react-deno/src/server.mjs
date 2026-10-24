import { islandHtml, islandJavaScript } from './island-route.mjs';
// Deno server shared by every *-deno car, run with `deno serve` (add --parallel for workers).
import { renderPage } from './render.mjs';
import { parseRows } from './rows.mjs';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/favicon.ico') return new Response(null, {status:204});
    if (url.pathname === '/island' || url.pathname === '/island-client.js') {
      const script = url.pathname.endsWith('.js');
      return new Response(await (script ? islandJavaScript() : islandHtml()), {headers:{'content-type':script ? 'text/javascript' : 'text/html; charset=utf-8'}});
    }
    if (url.pathname === '/ssr') {
      const n = parseRows(url.search);
      if (!n) return new Response('rows must be 10, 100 or 1000', { status: 400 });
      return new Response(await renderPage(n), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('not found', { status: 404 });
  },
};
