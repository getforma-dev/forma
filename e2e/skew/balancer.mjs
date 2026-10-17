import assert from 'node:assert/strict';
import { createServer, request as upstreamRequest } from 'node:http';

/** A real HTTP proxy: only deliberate root-identity faults may change response bytes. */
export async function createBalancer(origins) {
  const state = { deployed: 'A', choose: undefined, fault: undefined, log: [] };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://balancer').pathname;
    const instance = state.choose?.({ pathname, request }) ?? state.deployed;
    assert.ok(origins[instance], `unknown deployment ${instance}`);
    const upstream = upstreamRequest(new URL(request.url, origins[instance]), {
      method: request.method, headers: { ...request.headers, host: new URL(origins[instance]).host, 'accept-encoding': 'identity' },
    }, incoming => {
      const chunks = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('end', () => {
        let body = Buffer.concat(chunks);
        const headers = { ...incoming.headers };
        if (headers['content-type']?.includes('text/html') && state.fault) {
          const html = body.toString('utf8');
          assert.match(html, /<div id="app"[^>]* data-forma-build="[^"]*"/);
          body = Buffer.from(html.replace(/(<div id="app"[^>]*?) data-forma-build="[^"]*"/, (_, root) =>
            state.fault === 'absent' ? root : `${root} data-forma-build="injected-${instance}"`));
          delete headers['content-length'];
        }
        state.log.push({ url: request.url, pathname, instance, status: incoming.statusCode, cacheControl: headers['cache-control'] ?? null });
        response.writeHead(incoming.statusCode, headers); response.end(body);
      });
      incoming.on('error', error => response.destroy(error));
    });
    upstream.on('error', error => { response.writeHead(502); response.end(String(error)); });
    request.pipe(upstream);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: async () => {
    server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
