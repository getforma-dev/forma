// Node server shared by every *-node car. GP_WORKERS (default 1) above 1 forks that many
// node:cluster workers; at 1 the process serves directly.
import cluster from 'node:cluster';
import http from 'node:http';
import { renderPage } from './render.mjs';
import { parseRows } from './rows.mjs';

const WORKERS = Number(process.env.GP_WORKERS || 1);

function serve() {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (url.pathname === '/ssr') {
      const n = parseRows(url.search);
      if (!n) { res.writeHead(400); return res.end('rows must be 10, 100 or 1000'); }
      const html = await renderPage(n);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
      return res.end(html);
    }
    res.writeHead(404);
    res.end('not found');
  }).listen(3000, '0.0.0.0');
}

if (WORKERS > 1 && cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', () => cluster.fork());
} else {
  serve();
}
