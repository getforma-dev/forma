# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: data-fetch.spec.ts >> a data-fetch to a stalled endpoint aborts at 30 s into its error: target
- Location: e2e/data-fetch.spec.ts:19:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#busy')
Expected: "true"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('#busy')
    14 × locator resolved to <p id="busy" data-text="{busy}"></p>
       - unexpected value ""

```

```yaml
- paragraph
- paragraph
- paragraph
- paragraph
```

# Test source

```ts
  1  | import { test, expect, type Page } from '@playwright/test';
  2  | 
  3  | // data-fetch's timeout in a real browser (FORMA-132, decision brief L-46).
  4  | // The page's clock is Playwright's, paused before the page loads, so the 30
  5  | // seconds start when the runtime binds and pass only when the test says; the
  6  | // endpoint is a route that never answers. Each engine rejects an aborted fetch
  7  | // its own way (WebKit ignores the abort's reason), which is why this runs in
  8  | // all three.
  9  | 
  10 | async function serve(page: Page, body: string): Promise<void> {
  11 |   await page.route('**/fetch-timeout.html', (route) => route.fulfill({
  12 |     contentType: 'text/html',
  13 |     body: `<!doctype html><html><head><meta charset="utf-8"><title>data-fetch</title></head><body>${body}` +
  14 |       '<script src="/formajs-runtime.global.js"></script></body></html>',
  15 |   }));
  16 |   await page.goto('/fetch-timeout.html');
  17 | }
  18 | 
  19 | test('a data-fetch to a stalled endpoint aborts at 30 s into its error: target', async ({ page }) => {
  20 |   await page.clock.install({ time: 0 });
  21 |   await page.clock.pauseAt(1_000);
  22 |   let requests = 0;
  23 |   // Never fulfilled: the server does not answer.
  24 |   await page.route('**/api/stalled', () => { requests++; });
  25 |   await page.route('**/api/answers', (route) => route.fulfill({ contentType: 'application/json', body: '"loaded"' }));
  26 |   await serve(page,
  27 |     '<div data-forma-state=\'{}\'>' +
  28 |     '<div data-fetch="GET /api/stalled → items |loading:busy |error:failed"></div>' +
  29 |     '<p id="busy" data-text="{busy}"></p><p id="failed" data-text="{failed}"></p>' +
  30 |     '</div>' +
  31 |     '<div data-forma-state=\'{}\'>' +
  32 |     '<div data-fetch="GET /api/answers → items |loading:busy |error:failed"></div>' +
  33 |     '<p id="items2" data-text="{items}"></p><p id="failed2" data-text="{failed}"></p>' +
  34 |     '</div>');
  35 | 
> 36 |   await expect(page.locator('#busy')).toHaveText('true');
     |                                       ^ Error: expect(locator).toHaveText(expected) failed
  37 |   await expect(page.locator('#items2')).toHaveText('loaded');
  38 |   await page.clock.fastForward(29_000);
  39 |   await expect(page.locator('#busy')).toHaveText('true');
  40 |   await expect(page.locator('#failed')).toHaveText('');
  41 | 
  42 |   await page.clock.fastForward(1_000);
  43 |   await expect(page.locator('#failed')).toHaveText('data-fetch timed out after 30000 ms');
  44 |   await expect(page.locator('#busy')).toHaveText('false');
  45 |   // The request that was answered is untouched by its own timer.
  46 |   await page.clock.fastForward(60_000);
  47 |   await expect(page.locator('#items2')).toHaveText('loaded');
  48 |   await expect(page.locator('#failed2')).toHaveText('');
  49 |   expect(requests).toBe(1);
  50 | });
  51 | 
```