import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';

const original = readFileSync(new URL('../../../docs/archive/FORMA-108-csp-example/original-index.html', import.meta.url));
const current = readFileSync(new URL('../examples/csp/index.html', import.meta.url));
const owner = readFileSync(new URL('../examples/csp/mount.js', import.meta.url));
const runtime = readFileSync(new URL('../dist/forma-runtime-csp.js', import.meta.url));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const policy = "default-src 'self'; script-src 'self'; style-src 'self';";
let server: Server;
let origin: string;

test.beforeAll(async () => {
  // Serve the real example and current built hardened bytes, with the same
  // relative URLs users load. The historical page stays a negative control.
  const routes = new Map<string, [string, Buffer]>([
    ['/examples/csp/index.html', ['text/html', current]],
    ['/examples/csp/original.html', ['text/html', original]],
    ['/examples/csp/mount.js', ['text/javascript', owner]],
    ['/dist/forma-runtime-csp.js', ['text/javascript', runtime]],
    ['/examples/csp/blocked.html', ['text/html', Buffer.from(current.toString().replace('</body>', '<script>window.inlineExecuted = true</script></body>'))]],
  ]);
  server = createServer((request, response) => {
    const resource = routes.get(new URL(request.url!, 'http://localhost').pathname);
    if (!resource) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': resource[0], 'cache-control': 'no-store' });
    response.end(resource[1]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('example server has no TCP address');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function loadExample(page: Page, filename: string): Promise<void> {
  const downloaded = page.waitForResponse(response => response.url() === `${origin}/dist/forma-runtime-csp.js`);
  await page.goto(`${origin}/examples/csp/${filename}`);
  expect(hash(await (await downloaded).body())).toBe(hash(runtime));
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', policy);
}

test('the shipped CSP example explicitly owns its counter, filter and DOM handler', async ({ page }) => {
  const errors: string[] = [];
  const violations: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (/content[- ]security[- ]policy|refused to (execute|evaluate|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspEvents: string[] }).cspEvents = seen;
    document.addEventListener('securitypolicyviolation', event => seen.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  const events = () => page.evaluate(() => (window as unknown as { cspEvents: string[] }).cspEvents);

  // The unmodified original really loads these bytes but owns no mount.
  await loadExample(page, 'original.html');
  await expect(page.locator('p[data-text="{count}"]')).toHaveText('');
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await expect(page.locator('p[data-text="{count}"]')).toHaveText('');
  await page.getByPlaceholder('Search fruits...').fill('apple');
  await expect(page.locator('ul li')).toHaveText(['{item}']);
  await page.getByRole('button', { name: 'Toggle a class on myself' }).click();
  await expect(page.getByRole('button', { name: 'Toggle a class on myself' })).not.toHaveClass('active');
  expect(await events()).toEqual([]);

  await loadExample(page, 'index.html');
  await expect(page.locator('script[src]')).toHaveCount(2);
  expect(await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))))
    .toEqual(['../../dist/forma-runtime-csp.js', './mount.js']);
  const count = page.locator('#csp-example > p').first();
  await expect(count).toHaveText('0');
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await expect(count).toHaveText('1');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(count).toHaveText('0');
  const matches = page.locator('p[data-computed]');
  await expect(matches).toHaveText('Found 5 results');
  await expect(page.locator('ul li')).toHaveText(['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries']);
  await page.getByPlaceholder('Search fruits...').fill('apple');
  await expect(matches).toHaveText('Found 1 results');
  await expect(page.locator('ul li')).toHaveText(['Apples']);
  await page.getByPlaceholder('Search fruits...').fill('zzz');
  await expect(matches).toHaveText('Found 0 results');
  await expect(page.locator('ul li')).toHaveCount(0);
  await page.getByPlaceholder('Search fruits...').fill('');
  await expect(matches).toHaveText('Found 5 results');
  await expect(page.locator('ul li')).toHaveCount(5);
  const toggle = page.getByRole('button', { name: 'Toggle a class on myself' });
  await toggle.click();
  await expect(toggle).toHaveClass('active');
  await toggle.click();
  await expect(toggle).not.toHaveClass('active');
  expect(await page.evaluate(() => (window as unknown as { FormaRuntime: { getDiagnostics(): unknown[] } }).FormaRuntime.getDiagnostics())).toEqual([]);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
  expect(await events()).toEqual([]);

  // Demonstrate that the unchanged policy and observers actually reject an
  // inline script, after preserving zero-error assertions for both examples.
  await loadExample(page, 'blocked.html');
  expect(await page.evaluate(() => (window as unknown as { inlineExecuted?: true }).inlineExecuted)).toBeUndefined();
  await expect.poll(events).toContainEqual(expect.stringMatching(/^script-src(-elem)? inline$/));
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
