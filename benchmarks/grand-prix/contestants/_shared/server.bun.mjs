// Bun server shared by every *-bun car. GP_WORKERS above 1 starts that many processes, each a
// Bun.serve with reusePort, so the kernel spreads connections across them.
import { renderPage } from './render.mjs';
import { parseRows } from './rows.mjs';

const WORKERS = Number(process.env.GP_WORKERS || 1);

function serve() {
  Bun.serve({
    port: 3000,
    hostname: '0.0.0.0',
    reusePort: true,
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
  });
}

if (WORKERS > 1 && !process.env.GP_CHILD) {
  const kids = new Set();
  const spawn = () => {
    const k = Bun.spawn([process.execPath, Bun.main], { env: { ...process.env, GP_CHILD: '1' }, stdout: 'inherit', stderr: 'inherit' });
    kids.add(k);
    k.exited.then(() => { kids.delete(k); if (!stopping) spawn(); });
  };
  let stopping = false;
  for (let i = 0; i < WORKERS; i++) spawn();
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { stopping = true; for (const k of kids) k.kill(); process.exit(0); });
  }
} else {
  serve();
}
