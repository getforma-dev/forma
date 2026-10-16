# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: skew.spec.ts >> a real navigation timeout retains bounded drill context in its emitted stack
- Location: e2e/skew/skew.spec.ts:17:5

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "
Skew drill diagnostics: "
Received string:    "P17: page.goto: Timeout 10000ms exceeded.
Call log:
  - navigating to \"http://127.0.0.1:55055/\", waiting until \"commit\"·
    at inert (/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/skew/run-drill.mjs:90:16)
    at runSkewDrill (/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/skew/run-drill.mjs:148:31)
    at /Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/skew/skew.spec.ts:43:9"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { readFileSync } from 'node:fs';
  3  | import { resolve } from 'node:path';
  4  | import { runSkewDrill, SKEW_DRILL_CHECKS } from './run-drill.mjs';
  5  | 
  6  | test('real native rolling deployment, rollback, retention and skew guard', async ({ browser }, info) => {
  7  |   test.setTimeout(120_000);
  8  |   const cwd = resolve(__dirname, '../..');
  9  |   const binary = resolve(cwd, 'e2e/target/debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  10 |   const deployments = JSON.parse(readFileSync(resolve(__dirname, 'out/deployments.json'), 'utf8'));
  11 |   const report = await runSkewDrill({ browser, binary, cwd, deployments });
  12 |   expect(report.checks).toEqual(SKEW_DRILL_CHECKS);
  13 |   await info.attach('skew-drill', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  14 | });
  15 | 
  16 | 
  17 | test('a real navigation timeout retains bounded drill context in its emitted stack', async ({ browser }, info) => {
  18 |   test.setTimeout(120_000);
  19 |   const cwd = resolve(__dirname, '../..');
  20 |   const binary = resolve(cwd, 'e2e/target/debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  21 |   const deployments = JSON.parse(readFileSync(resolve(__dirname, 'out/deployments.json'), 'utf8'));
  22 |   let blocked = 0;
  23 |   const failingBrowser = {
  24 |     async newContext(options: Parameters<typeof browser.newContext>[0]) {
  25 |       const context = await browser.newContext(options);
  26 |       await context.route('**/*', async route => {
  27 |         if (route.request().resourceType() !== 'document') { await route.continue(); return; }
  28 |         const response = await route.fetch();
  29 |         const body = await response.body();
  30 |         if (body.includes(Buffer.from('data-forma-build="injected-S"'))) {
  31 |           blocked++;
  32 |           // Keep the actual navigation pending until the unchanged drill timeout;
  33 |           // its finally block must close this context and the owned native server.
  34 |           await new Promise<void>(done => context.once('close', () => done()));
  35 |           return;
  36 |         }
  37 |         await route.fulfill({ response, body });
  38 |       });
  39 |       return context;
  40 |     },
  41 |   };
  42 |   let failure: Error | undefined;
  43 |   try { await runSkewDrill({ browser: failingBrowser, binary, cwd, deployments }); }
  44 |   catch (error) { failure = error as Error; }
  45 |   expect(blocked).toBe(1);
  46 |   expect(failure?.name).toBe('TimeoutError');
  47 |   const emitted = `P17: ${failure?.stack}`; // The actual release CLI prints stack, not message.
  48 |   await info.attach('forced-skew-timeout', { body: emitted, contentType: 'text/plain' });
  49 |   expect(emitted).toContain('page.goto: Timeout 10000ms exceeded');
  50 |   const marker = '\nSkew drill diagnostics: ';
> 51 |   expect(emitted).toContain(marker);
     |                   ^ Error: expect(received).toContain(expected) // indexOf
  52 |   const detail = JSON.parse(emitted.slice(emitted.indexOf(marker) + marker.length));
  53 |   expect(detail.completedChecks).toEqual(SKEW_DRILL_CHECKS.slice(0, 7));
  54 |   expect(detail.lastRequests.length).toBeLessThanOrEqual(15);
  55 |   expect(detail.lastRequests.some((request: { pathname: string; instance: string; status: number }) => request.pathname === '/' && request.instance === 'S' && request.status === 200)).toBe(true);
  56 |   expect(detail.pages).toHaveLength(4);
  57 |   expect(detail.pages.map((page: { navigations: number }) => page.navigations)).toEqual([1, 1, 1, 0]);
  58 |   for (const page of detail.pages) {
  59 |     expect(page.events).toEqual([]);
  60 |     expect(page.errors).toEqual([]);
  61 |   }
  62 | });
  63 | 
```