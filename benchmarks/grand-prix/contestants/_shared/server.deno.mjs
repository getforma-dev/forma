// Deno server shared by every *-deno car, run with `deno serve` (add --parallel for workers).
import { renderPage } from './render.mjs';
import { parseRows } from './rows.mjs';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/ssr') {
      const n = parseRows(url.search);
      if (!n) return new Response('rows must be 10, 100 or 1000', { status: 400 });
      return new Response(await renderPage(n), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('not found', { status: 404 });
  },
};
