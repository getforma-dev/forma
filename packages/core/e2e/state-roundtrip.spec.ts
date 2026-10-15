import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ordinary deterministic acceptance, not generated/random inputs: the actual
// compiler fixture is rendered by the production Rust walker, then decoded and
// activated by the built browser artifact in a fresh Document for every case.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });
test.setTimeout(120_000);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const registration = JSON.parse(readFileSync(new URL('../../../crates/forma-ir/tests/fixtures/island-emitter/roundtrip.registration.json', import.meta.url), 'utf8'));
interface Case { index: number; expected: Record<string, unknown>; state: string; body: string }
let cases: Case[];
test.beforeAll(() => {
  cases = JSON.parse(execFileSync('cargo', ['run', '--quiet', '--locked', '-p', 'forma-ir', '--example', 'island_state_roundtrip'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60_000,
  }));
  expect(cases).toHaveLength(100);
});

test('100 fixed native values preserve all eight declared kinds through real browser activation', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/state-core.mjs', route => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)), contentType: 'text/javascript',
  }));
  await page.route('**/state-boot.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
    import { __islandRegistration, activateIslands, createSignal, createEffect, h } from '/state-core.mjs';
    const violations = [];
    document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
    let calls = 0;
    let observed;
    const effects = [];
    const Badge = __islandRegistration(props => {
      calls++;
      const [value] = createSignal(props.value);
      createEffect(() => effects.push(value()));
      observed = { ...props, date: props.date.getTime() };
      window.__roundtrip = { observed, dateIsDate: props.date instanceof Date, calls, effects, violations,
        keys: Object.keys(props).sort(), nestedKeys: Object.keys(props.nested).sort(),
        hostCount: document.querySelectorAll('[data-forma-island]').length };
      return h('p', null, props.label, props.value);
    }, ${JSON.stringify(registration)});
    activateIslands({ Badge });
    window.__roundtripDone = true;
  ` }));
  let current: Case;
  const policy = "default-src 'none'; img-src 'self'; script-src 'self'; require-trusted-types-for 'script'; trusted-types forma; base-uri 'none'";
  await page.route('**/state-roundtrip.html?*', route => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': policy },
    body: `<!doctype html><html><head><meta charset="utf-8"><script type="application/json" data-island-state>${current.state}</script><script type="module" src="/state-boot.mjs"></script></head><body>${current.body}</body></html>`,
  }));
  for (current of cases) {
    expect(current.state, `native case ${current.index}`).not.toContain('<');
    expect(current.state).not.toContain('SENTINEL');
    const response = await page.goto(`/state-roundtrip.html?case=${current.index}`);
    expect(response?.headers()['content-security-policy']).toBe(policy);
    await page.waitForFunction(() => (window as any).__roundtripDone === true);
    const actual = await page.evaluate(() => (window as any).__roundtrip);
    expect(actual, `activation case ${current.index}`).toBeDefined();
    const expectedNumber = current.expected.value === 0 ? 0 : current.expected.value;
    const expected = { ...current.expected, value: expectedNumber,
      list: (current.expected.list as unknown[]).map(value => value === 0 ? 0 : value) };
    expect(actual.observed, `native/browser case ${current.index}`).toEqual(expected);
    expect(actual.dateIsDate).toBe(true);
    expect(actual.calls).toBe(1);
    // Serialize9 intentionally canonicalizes -0 to 0; every other IEEE value
    // must be identical, including 2^53-1, 2^53, max finite and subnormal.
    expect(actual.effects).toEqual([expectedNumber]);
    expect(actual.nestedKeys).toEqual(['active']);
    expect(actual.keys).not.toContain('secret');
    expect(actual.hostCount).toBe(1);
    expect(actual.violations).toEqual([]);
    await expect(page.locator('head script[data-island-state]')).toHaveCount(1);
    await expect(page.locator('[data-forma-island]')).toHaveAttribute('data-forma-status', 'pending');
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
