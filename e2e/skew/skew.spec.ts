import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSkewDrill, SKEW_DRILL_CHECKS } from './run-drill.mjs';

test('real native rolling deployment, rollback, retention and skew guard', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const cwd = resolve(__dirname, '../..');
  const binary = resolve(cwd, 'e2e/target/debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  const deployments = JSON.parse(readFileSync(resolve(__dirname, 'out/deployments.json'), 'utf8'));
  const report = await runSkewDrill({ browser, binary, cwd, deployments });
  expect(report.checks).toEqual(SKEW_DRILL_CHECKS);
  await info.attach('skew-drill', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});


test('a real navigation timeout retains bounded drill context in its emitted stack', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const cwd = resolve(__dirname, '../..');
  const binary = resolve(cwd, 'e2e/target/debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  const deployments = JSON.parse(readFileSync(resolve(__dirname, 'out/deployments.json'), 'utf8'));
  let blocked = 0;
  const failingBrowser = {
    async newContext(options: Parameters<typeof browser.newContext>[0]) {
      const context = await browser.newContext(options);
      await context.route('**/*', async route => {
        if (route.request().resourceType() !== 'document') { await route.continue(); return; }
        const response = await route.fetch();
        const body = await response.body();
        if (body.includes(Buffer.from('data-forma-build="injected-S"'))) {
          blocked++;
          // Keep the actual navigation pending until the unchanged drill timeout;
          // its finally block must close this context and the owned native server.
          await new Promise<void>(done => context.once('close', () => done()));
          return;
        }
        await route.fulfill({ response, body });
      });
      return context;
    },
  };
  let failure: Error | undefined;
  try { await runSkewDrill({ browser: failingBrowser, binary, cwd, deployments }); }
  catch (error) { failure = error as Error; }
  expect(blocked).toBe(1);
  expect(failure?.name).toBe('TimeoutError');
  const emitted = `P17: ${failure?.stack}`; // The actual release CLI prints stack, not message.
  await info.attach('forced-skew-timeout', { body: emitted, contentType: 'text/plain' });
  expect(emitted).toContain('page.goto: Timeout 10000ms exceeded');
  const marker = '\nSkew drill diagnostics: ';
  expect(emitted).toContain(marker);
  const detail = JSON.parse(emitted.slice(emitted.indexOf(marker) + marker.length));
  expect(detail.completedChecks).toEqual(SKEW_DRILL_CHECKS.slice(0, 7));
  expect(detail.lastRequests.length).toBeLessThanOrEqual(15);
  expect(detail.lastRequests.some((request: { pathname: string; instance: string; status: number }) => request.pathname === '/' && request.instance === 'S' && request.status === 200)).toBe(true);
  expect(detail.pages).toHaveLength(4);
  expect(detail.pages.map((page: { navigations: number }) => page.navigations)).toEqual([1, 1, 1, 0]);
  for (const page of detail.pages) {
    expect(page.events).toEqual([]);
    expect(page.errors).toEqual([]);
  }
});
