# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: csp-example.spec.ts >> the shipped CSP example explicitly owns its counter, filter and DOM handler
- Location: e2e/csp-example.spec.ts:49:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#csp-example > p').first()
Expected: "0"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('#csp-example > p').first()
    14 × locator resolved to <p data-text="{count}"></p>
       - unexpected value ""

```

```yaml
- heading "CSP-Safe Counter" [level=1]
- paragraph
- button "Increment"
- button "Reset"
- heading "…and a filter, with an arrow function" [level=2]
- textbox "Search fruits..."
- paragraph
- list:
  - listitem: "{item}"
- heading "…and a handler whose whole body is a method call" [level=2]
- button "Toggle a class on myself"
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import { readFileSync } from 'node:fs';
  3   | import { createServer, type Server } from 'node:http';
  4   | import { createHash } from 'node:crypto';
  5   | 
  6   | const original = readFileSync(new URL('../../../docs/archive/FORMA-108-csp-example/original-index.html', import.meta.url));
  7   | const current = readFileSync(new URL('../examples/csp/index.html', import.meta.url));
  8   | const owner = readFileSync(new URL('../examples/csp/mount.js', import.meta.url));
  9   | const runtime = readFileSync(new URL('../dist/forma-runtime-csp.js', import.meta.url));
  10  | const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  11  | const policy = "default-src 'self'; script-src 'self'; style-src 'self';";
  12  | let server: Server;
  13  | let origin: string;
  14  | 
  15  | test.beforeAll(async () => {
  16  |   // Serve the real example and current built hardened bytes, with the same
  17  |   // relative URLs users load. The historical page stays a negative control.
  18  |   const routes = new Map<string, [string, Buffer]>([
  19  |     ['/examples/csp/index.html', ['text/html', current]],
  20  |     ['/examples/csp/original.html', ['text/html', original]],
  21  |     ['/examples/csp/mount.js', ['text/javascript', owner]],
  22  |     ['/dist/forma-runtime-csp.js', ['text/javascript', runtime]],
  23  |     ['/examples/csp/blocked.html', ['text/html', Buffer.from(current.toString().replace('</body>', '<script>window.inlineExecuted = true</script></body>'))]],
  24  |   ]);
  25  |   server = createServer((request, response) => {
  26  |     const resource = routes.get(new URL(request.url!, 'http://localhost').pathname);
  27  |     if (!resource) { response.writeHead(404); response.end(); return; }
  28  |     response.writeHead(200, { 'content-type': resource[0], 'cache-control': 'no-store' });
  29  |     response.end(resource[1]);
  30  |   });
  31  |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  32  |   const address = server.address();
  33  |   if (!address || typeof address === 'string') throw new Error('example server has no TCP address');
  34  |   origin = `http://127.0.0.1:${address.port}`;
  35  | });
  36  | 
  37  | test.afterAll(async () => {
  38  |   server.closeAllConnections();
  39  |   await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  40  | });
  41  | 
  42  | async function loadExample(page: Page, filename: string): Promise<void> {
  43  |   const downloaded = page.waitForResponse(response => response.url() === `${origin}/dist/forma-runtime-csp.js`);
  44  |   await page.goto(`${origin}/examples/csp/${filename}`);
  45  |   expect(hash(await (await downloaded).body())).toBe(hash(runtime));
  46  |   await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', policy);
  47  | }
  48  | 
  49  | test('the shipped CSP example explicitly owns its counter, filter and DOM handler', async ({ page }) => {
  50  |   const errors: string[] = [];
  51  |   const violations: string[] = [];
  52  |   page.on('pageerror', error => errors.push(String(error)));
  53  |   page.on('console', message => {
  54  |     if (/content[- ]security[- ]policy|refused to (execute|evaluate|load|apply)/i.test(message.text())) violations.push(message.text());
  55  |   });
  56  |   await page.addInitScript(() => {
  57  |     const seen: string[] = [];
  58  |     (window as unknown as { cspEvents: string[] }).cspEvents = seen;
  59  |     document.addEventListener('securitypolicyviolation', event => seen.push(`${event.effectiveDirective} ${event.blockedURI}`));
  60  |   });
  61  |   const events = () => page.evaluate(() => (window as unknown as { cspEvents: string[] }).cspEvents);
  62  | 
  63  |   // The unmodified original really loads these bytes but owns no mount.
  64  |   await loadExample(page, 'original.html');
  65  |   await expect(page.locator('p[data-text="{count}"]')).toHaveText('');
  66  |   await page.getByRole('button', { name: 'Increment', exact: true }).click();
  67  |   await expect(page.locator('p[data-text="{count}"]')).toHaveText('');
  68  |   await page.getByPlaceholder('Search fruits...').fill('apple');
  69  |   await expect(page.locator('ul li')).toHaveText(['{item}']);
  70  |   await page.getByRole('button', { name: 'Toggle a class on myself' }).click();
  71  |   await expect(page.getByRole('button', { name: 'Toggle a class on myself' })).not.toHaveClass('active');
  72  |   expect(await events()).toEqual([]);
  73  | 
  74  |   await loadExample(page, 'index.html');
  75  |   await expect(page.locator('script[src]')).toHaveCount(2);
  76  |   expect(await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))))
  77  |     .toEqual(['../../dist/forma-runtime-csp.js', './mount.js']);
  78  |   const count = page.locator('#csp-example > p').first();
> 79  |   await expect(count).toHaveText('0');
      |                       ^ Error: expect(locator).toHaveText(expected) failed
  80  |   await page.getByRole('button', { name: 'Increment', exact: true }).click();
  81  |   await expect(count).toHaveText('1');
  82  |   await page.getByRole('button', { name: 'Reset', exact: true }).click();
  83  |   await expect(count).toHaveText('0');
  84  |   const matches = page.locator('p[data-computed]');
  85  |   await expect(matches).toHaveText('Found 5 results');
  86  |   await expect(page.locator('ul li')).toHaveText(['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries']);
  87  |   await page.getByPlaceholder('Search fruits...').fill('apple');
  88  |   await expect(matches).toHaveText('Found 1 results');
  89  |   await expect(page.locator('ul li')).toHaveText(['Apples']);
  90  |   await page.getByPlaceholder('Search fruits...').fill('zzz');
  91  |   await expect(matches).toHaveText('Found 0 results');
  92  |   await expect(page.locator('ul li')).toHaveCount(0);
  93  |   await page.getByPlaceholder('Search fruits...').fill('');
  94  |   await expect(matches).toHaveText('Found 5 results');
  95  |   await expect(page.locator('ul li')).toHaveCount(5);
  96  |   const toggle = page.getByRole('button', { name: 'Toggle a class on myself' });
  97  |   await toggle.click();
  98  |   await expect(toggle).toHaveClass('active');
  99  |   await toggle.click();
  100 |   await expect(toggle).not.toHaveClass('active');
  101 |   expect(await page.evaluate(() => (window as unknown as { FormaRuntime: { getDiagnostics(): unknown[] } }).FormaRuntime.getDiagnostics())).toEqual([]);
  102 |   expect(errors).toEqual([]);
  103 |   expect(violations).toEqual([]);
  104 |   expect(await events()).toEqual([]);
  105 | 
  106 |   // Demonstrate that the unchanged policy and observers actually reject an
  107 |   // inline script, after preserving zero-error assertions for both examples.
  108 |   await loadExample(page, 'blocked.html');
  109 |   expect(await page.evaluate(() => (window as unknown as { inlineExecuted?: true }).inlineExecuted)).toBeUndefined();
  110 |   await expect.poll(events).toContainEqual(expect.stringMatching(/^script-src(-elem)? inline$/));
  111 |   await expect.poll(() => violations.length).toBeGreaterThan(0);
  112 |   expect(errors).toEqual([]);
  113 | });
  114 | 
```