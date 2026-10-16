// Parse actual complete native metadata documents, produced by both writer paths.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
const selected = process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'all';
assert(['all', 'chromium', 'firefox', 'webkit'].includes(selected));
const out = resolve(root, 'e2e/value-rules/out'); mkdirSync(out, { recursive: true });
const result = spawnSync('cargo', ['test', '--locked', '-p', 'forma-server', '--lib', 'metadata_'], {
  cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, CARGO_BUILD_JOBS: '3', FORMA_METADATA_OUTPUT: resolve(out, 'metadata-documents.json') },
});
assert.equal(result.status, 0, result.stdout + result.stderr);
const documents = JSON.parse(readFileSync(resolve(out, 'metadata-documents.json'), 'utf8'));
assert(documents.length > 0 && documents.some(row => row.path === 'try_render') && documents.some(row => row.path === 'render_browser_shell'));
const results = [];
for (const [engine, type] of Object.entries({ chromium, firefox, webkit })) {
  if (selected !== 'all' && selected !== engine) continue;
  const browser = await type.launch({ headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  let current;
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: current.document }) : route.abort());
  try {
    for (current of documents) {
      await page.goto('http://metadata.invalid/');
      const actual = await page.evaluate(() => {
        const link = document.querySelector('link[rel="alternate"]');
        return { title: document.querySelector('title').textContent, body: document.body.getAttribute('class'), type: link.getAttribute('type'), sizes: link.getAttribute('sizes'), href: link.getAttribute('href') };
      });
      assert.deepEqual(actual, { title: current.expected, body: current.expected, type: current.expected, sizes: current.expected, href: '/metadata?one=1&two=2' }, `${engine}/${current.path}/${current.id}`);
    }
    results.push({ engine, documents: documents.length, passed: true });
    console.log(`${engine}: ${documents.length} actual SSR/shell metadata documents pass`);
  } finally { await browser.close(); }
}
writeFileSync(resolve(out, 'metadata-result.json'), JSON.stringify({ node: process.version, results }, null, 2) + '\n');
