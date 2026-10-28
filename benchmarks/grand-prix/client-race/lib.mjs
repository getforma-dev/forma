import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const appsDir = path.join(here, 'apps');
export const rawDir = path.join(process.env.GP_RESULTS_DIR || path.join(here, '..', 'results'), 'raw');
export const ALL_CARS = ['forma', 'vanilla', 'react', 'preact', 'solid', 'svelte', 'vue'];

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

export function builtCars(requested) {
  const list = requested ? requested.split(',') : ALL_CARS;
  if (!list.length || new Set(list).size !== list.length || list.some(car => !ALL_CARS.includes(car))) throw new Error('Unknown or duplicate client car');
  const have = list.filter((c) => existsSync(path.join(appsDir, c, 'dist', 'index.html')));
  const missing = list.filter((c) => !have.includes(c));
  return { have, missing };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.map': 'application/json' };

export function serveDist(root) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, path.normalize(p));
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('out');
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)); });
}
