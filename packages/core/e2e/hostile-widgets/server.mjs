import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function startServer(runtimePath, otherOrigin = '', requests = []) {
  const runtime = await readFile(runtimePath);
  const nonce = randomBytes(24).toString('base64');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic'; connect-src 'self' ${otherOrigin}; img-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; require-trusted-types-for 'script'; trusted-types forma forma-runtime`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (requests.length >= 10_000) { res.writeHead(507).end('request log full'); return; }
    // Count every HTTP request except the two exact harness resource loads.
    // A request to an unexpected path must not disappear into a silent404.
    const harnessResource = req.method === 'GET' && (url.pathname === '/' && req.headers['sec-fetch-dest'] === 'document' || url.pathname === '/runtime.js' && req.headers['sec-fetch-dest'] === 'script');
    if (!harnessResource) requests.push({ method: req.method, path: url.pathname + url.search, cookie: req.headers.cookie ?? '', origin: `http://${req.headers.host}` });
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/attack/')) {
      req.resume();
      if (url.pathname === '/api/widget/redirect') { res.writeHead(302, { location: '/api/admin/redirected' }).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/runtime.js') { res.writeHead(200, { 'content-type': 'text/javascript' }).end(runtime); return; }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, 'cache-control': 'no-store', 'set-cookie': 'hostile_fixture=secret; SameSite=Strict; Path=/' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Hostile widget qualification</title></head><body><section id="outside" data-secret="secret-1290300"><span id="outside-secret">secret-1290300</span><div id="root"></div></section><section data-forma-state='{"n":1}'><p id="unowned-served" data-text="{n}">raw</p></section><script nonce="${nonce}" src="/runtime.js"></script></body></html>`);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, policy, requests, runtimeSha256: createHash('sha256').update(runtime).digest('hex'), close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
