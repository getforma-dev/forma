import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createCspReports } from '../e2e/ssr/csp-reports.mjs';

test('report receiver bounds input/count and retains only normalized cursor evidence', async () => {
  const reports = createCspReports({ maxBytes: 1024, maxReports: 2 });
  const server = createServer((req, res) => { void reports.handle(req, res, new URL(req.url, 'http://localhost')); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, type = 'application/csp-report') => fetch(origin, { method: 'POST', headers: { 'content-type': type }, body });
  const body = JSON.stringify({ 'csp-report': { 'document-uri': 'http://localhost/generic-state/?secret=never-store#fragment', 'effective-directive': 'img-src', disposition: 'enforce', 'script-sample': 'do not retain', 'blocked-uri': 'https://invalid.example/secret' } });
  try {
    assert.equal((await post('{}', 'text/plain')).status, 415);
    assert.equal((await post('x'.repeat(1025))).status, 413);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('{}')).status, 400);
    assert.equal((await post(body)).status, 204);
    assert.deepEqual(await fetch(origin).then(r => r.json()), { cursor: 1, reports: [{ document: '/generic-state/', directive: 'img-src', disposition: 'enforce' }] });
    assert.equal((await post(body)).status, 204);
    assert.equal((await post(body)).status, 429);
    assert.deepEqual(await fetch(`${origin}/?after=1`).then(r => r.json()), { cursor: 2, reports: [{ document: '/generic-state/', directive: 'img-src', disposition: 'enforce' }] });
    assert.equal((await fetch(`${origin}/?after=3`)).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
