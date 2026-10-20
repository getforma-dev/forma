// What each fixture page does once its islands run, and the checks that are about a page's other
// branches rather than its adoption. One file, two judges: apps.spec.ts runs it against servers built
// from the working tree, and P17 (scripts/release-fixture-apps.mjs) against servers built from the
// packed set. `expect` is Playwright's, which works on any Playwright `page`, in or out of its runner.
import { expect } from '@playwright/test';

/**
 * Every listed tile counts: one press adds one to the count the server sent (7 stays 7 until it
 * is pressed; 1001 likewise), and the switch shows its marker.
 */
export function tileBehaviour(ids) {
  return {
    interact: async (page) => {
      const before = await Promise.all(ids.map(async (id) => Number(await page.locator(`[data-tile="${id}"] .tile-count`).textContent())));
      for (const id of ids) await page.locator(`[data-tile="${id}"] .tile-more`).click();
      for (const [index, id] of ids.entries()) await expect(page.locator(`[data-tile="${id}"] .tile-count`)).toHaveText(String(before[index] + 1));
      await page.locator(`[data-tile="${ids[0]}"] .tile-switch`).click();
      await expect(page.locator(`[data-tile="${ids[0]}"] .tile-on`)).toBeVisible();
      return `${ids.length} tiles counted`;
    },
  };
}

/** Keyed by `<application> <route>`: {hold, interact}, as lib/verify-page.mjs takes them. */
export const BEHAVIOURS = {
  'ledger /household': {
    // The island fetches the workspace at activation: held until adoption is judged.
    hold: ['/api/status'],
    interact: async (page) => {
      await expect(page.locator('#arrival-status')).toHaveText('Loaded.');
      await expect(page.locator('#arrival-retry')).toHaveCount(0);
      return 'status moved to ready';
    },
  },
  'fauth /t/:slug/login': {
    interact: async (page) => {
      await page.locator('#oauth-google').click();
      await expect(page.locator('#oauth-chosen')).toHaveText('Continuing with Google');
      // Sign up: the name field and the other button appear, the sign-in only controls go.
      await page.locator('#lc-toggle').click();
      await expect(page.locator('#auth-subtitle')).toHaveText('Create your account');
      await expect(page.locator('#lc-name')).toBeVisible();
      await expect(page.locator('#lc-submit-up')).toHaveText('Create account');
      await expect(page.locator('#lc-submit-in')).toHaveCount(0);
      await expect(page.locator('#lc-forgot')).toHaveCount(0);
      await page.locator('#lc-toggle').click();
      await expect(page.locator('#lc-submit-in')).toBeVisible();
      await expect(page.locator('#lc-forgot')).toBeVisible();
      // A visitor's own fields are the island's: typing, revealing, submitting empty.
      await page.locator('#lc-password').fill('hunter2');
      await page.locator('#lc-reveal').click();
      await expect(page.locator('#lc-password')).toHaveAttribute('type', 'text');
      await page.locator('#lc-submit-in').click();
      await expect(page.locator('#auth-failure')).toHaveText('Enter your email address.');
      return 'oauth, mode toggle, reveal and failure';
    },
  },
  'fauth /platform/onboarding': {
    interact: async (page) => {
      await page.locator('#ob-workspace').fill('Rivera Labs');
      await expect(page.locator('#ob-echo')).toHaveText('Rivera Labs');
      await expect(page.locator('#ob-google')).toBeVisible();
      await expect(page.locator('#ob-github')).toHaveCount(0);
      await page.locator('#ob-submit').click();
      await expect(page.locator('#ob-pressed')).toBeVisible();
      return 'workspace form';
    },
  },
  'fauth /platform/benchmark': {
    interact: async (page) => {
      await page.locator('#bm-query').fill('timeout');
      await expect(page.locator('#bm-summary')).toHaveText('Showing 3 results for "timeout", by score.');
      await page.locator('#bm-failures').click();
      await expect(page.locator('#bm-filtered')).toBeVisible();
      await expect(page.locator('#bm-failures')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#bm-table')).toHaveClass(/failures-only/);
      await page.locator('#bm-failures').click();
      await page.locator('#bm-table tbody tr').evaluateAll(rows => { globalThis.__fixtureRows = rows; });
      await page.locator('#bm-reverse').click();
      await expect(page.locator('#bm-table tbody tr').first()).toHaveAttribute('data-row', '3');
      expect(await page.locator('#bm-table tbody tr').evaluateAll(rows => rows.map(row => row.getAttribute('data-row')))).toEqual(['3', '2', '1']);
      expect(await page.locator('#bm-table tbody tr').evaluateAll(rows => rows.every((row, index) => row === globalThis.__fixtureRows[2 - index]))).toBe(true);
      await page.locator('#bm-reverse').click();
      await expect(page.locator('#bm-table tbody tr').first()).toHaveAttribute('data-row', '1');
      return 'filter bar, toolbar and keyed row reorder';
    },
  },
  // Each variant reaches the islands that have something to do on it.
  'fauth /t/:slug/login (invite-only tenant)': {
    interact: async (page) => {
      await page.locator('#lc-password').fill('hunter2');
      await page.locator('#lc-reveal').click();
      await expect(page.locator('#lc-password')).toHaveAttribute('type', 'text');
      await page.locator('#lc-submit-in').click();
      await expect(page.locator('#auth-failure')).toHaveText('Enter your email address.');
      return 'reveal and failure';
    },
  },
  'fauth /t/:slug/login (invite link on an invite-only tenant, starting in register mode)': {
    interact: async (page) => {
      await page.locator('#lc-toggle').click();
      await expect(page.locator('#auth-subtitle')).toHaveText('Sign in to your account');
      await expect(page.locator('#lc-submit-in')).toBeVisible();
      return 'mode toggle';
    },
  },
  'fauth /platform/benchmark (no results)': {
    interact: async (page) => {
      await page.locator('#bm-query').fill('abc');
      await expect(page.locator('#bm-summary')).toHaveText('Showing 0 results for "abc", by name.');
      await page.locator('#bm-failures').click();
      await expect(page.locator('#bm-filtered')).toBeVisible();
      return 'filter bar and toolbar';
    },
  },
  'ksx /check (no controller)': {
    interact: async (page) => {
      await page.locator('#count-frame').click();
      await expect(page.locator('#frames-seen')).toHaveText('1002');
      await page.keyboard.press('g');
      await expect(page.locator('#echo-last')).toHaveText('Last key: G');
      return 'frame counter and key echo';
    },
  },
  'bench /pages/300': tileBehaviour([0]),
  'bench /pages/1500': tileBehaviour([0, 9]),
  'bench /pages/10000': tileBehaviour([0, 4]),
  'bench /pages/15000': tileBehaviour([0, 49]),
  'bench /pages/20000': tileBehaviour([0, 4]),
  'bench /pages/islands-100': tileBehaviour(Array.from({ length: 100 }, (_, index) => index)),
  'ksx /check': {
    interact: async (page) => {
      await page.locator('#count-frame').click();
      await expect(page.locator('#frames-seen')).toHaveText('1002');
      await expect(page.locator('#quiet-line')).toHaveCount(0);
      await expect(page.locator('#feed-line')).toHaveText('Frames arriving.');
      // One key lights every chip it drives, on every slot at once (the screen's point).
      await page.keyboard.press('g');
      await expect(page.locator('.chip.lit')).toHaveCount(2);
      await expect(page.locator('#echo-last')).toHaveText('Last key: G');
      await expect(page.locator('#echo-count')).toHaveText('Chips lit: 2');
      await page.keyboard.press('w');
      await expect(page.locator('.chip.lit')).toHaveCount(1);
      await page.locator('#chips li').evaluateAll(chips => { globalThis.__fixtureChips = chips; });
      await page.locator('#echo-reverse').click();
      await expect(page.locator('#chips li').first()).toHaveAttribute('data-chip', '6');
      expect(await page.locator('#chips li').evaluateAll(chips => chips.every((chip, index) => chip === globalThis.__fixtureChips[5 - index]))).toBe(true);
      // The same adopted chip nodes still participate in the keyboard listener after moving.
      await page.keyboard.press('g');
      await expect(page.locator('.chip.lit')).toHaveCount(2);
      return 'frame counter, live echo and keyed chip reorder';
    },
  },
};

const open = async (browser, origin, path, options = {}) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(new URL(path, origin).href);
  return { context, page };
};

/**
 * Checks about a page's other branches or about what the handler does not trust, per application:
 * `{name, run({browser, origin, request})}`. Each opens its own context and closes it.
 */
export const EXTRAS = {
  ledger: [
    {
      name: '/household: a failed load names the attempt, keeps the snapshot, and Retry recovers',
      async run({ browser, origin }) {
        const context = await browser.newContext();
        try {
          const tab = await context.newPage();
          let calls = 0;
          await tab.route('**/api/status', async (route) => {
            calls += 1;
            if (calls === 1) await route.fulfill({ status: 503, body: 'down' });
            else await route.continue();
          });
          await tab.goto(new URL('/household', origin).href);
          await expect(tab.locator('#arrival-status')).toHaveText('Loading failed (attempt 1). Showing the opening snapshot.');
          await expect(tab.locator('#arrival-cash')).toHaveText('$12,345.67');
          await tab.locator('#arrival-retry').click();
          await expect(tab.locator('#arrival-status')).toHaveText('Loaded.');
          await expect(tab.locator('#arrival-retry')).toHaveCount(0);
          expect(calls).toBe(2);
        } finally { await context.close(); }
      },
    },
  ],
  fauth: [
    {
      name: '/t/acme/login: a delayed logo reserves its final space before image decode',
      async run({ browser, origin }) {
        const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 412, height: 823 } });
        try {
          const tab = await context.newPage();
          let logoRequest;
          await tab.route('**/fixture/logo.svg', (route) => { logoRequest = route; });
          await tab.goto(new URL('/t/acme/login', origin).href, { waitUntil: 'domcontentloaded' });
          await expect.poll(() => Boolean(logoRequest)).toBe(true);
          // DOMContentLoaded does not wait for CSS when page scripts are disabled.
          await expect.poll(() => tab.locator('link[rel="stylesheet"]').evaluateAll(
            (links) => links.length > 0 && links.every((link) => link.sheet?.cssRules.length > 0),
          )).toBe(true);
          const logo = tab.locator('#tenant-logo');
          await expect(logo).toHaveJSProperty('naturalWidth', 0);
          const geometry = () => tab.evaluate(() => {
            const box = document.querySelector('#tenant-logo').getBoundingClientRect();
            return { width: box.width, height: box.height, nextTop: document.querySelector('#tenant-name').getBoundingClientRect().top };
          });
          const reserved = await geometry();
          expect({ width: reserved.width, height: reserved.height }).toEqual({ width: 24, height: 24 });
          await logoRequest.continue();
          await logo.evaluate((image) => image.decode());
          await expect(logo).toHaveJSProperty('naturalWidth', 24);
          await expect(logo).toHaveJSProperty('naturalHeight', 24);
          expect(await geometry()).toEqual(reserved);
        } finally { await context.close(); }
      },
    },
    {
      name: '/t/quote/login: a tenant named with script and markup renders as text and runs nothing',
      async run({ browser, origin }) {
        const context = await browser.newContext();
        try {
          const tab = await context.newPage();
          const errors = [];
          tab.on('pageerror', (error) => errors.push(error.message));
          await tab.addInitScript(() => {
            globalThis.__violations = [];
            document.addEventListener('securitypolicyviolation', (event) => globalThis.__violations.push(event.effectiveDirective));
          });
          await tab.goto(new URL('/t/quote/login', origin).href);
          await expect(tab.locator('#tenant-name')).toHaveText('";alert(1);//</script><b>bold</b>');
          expect(await tab.locator('#tenant-name b').count()).toBe(0);
          expect(await tab.locator('title').textContent()).toContain('";alert(1);//');
          // The page still works after the hostile name: the document was not cut short.
          await tab.locator('#lc-toggle').click();
          await expect(tab.locator('#auth-subtitle')).toHaveText('Create your account');
          expect(errors).toEqual([]);
          expect(await tab.evaluate(() => globalThis.__violations)).toEqual([]);
        } finally { await context.close(); }
      },
    },
    {
      name: '/t/unknown/login: an unknown tenant is a 404, not a page',
      async run({ origin }) {
        const response = await fetch(new URL('/t/unknown/login', origin).href);
        expect(response.status).toBe(404);
      },
    },
    {
      name: '/t/lockbox/login: an invite-only tenant offers no provider button and no sign-up switch',
      async run({ browser, origin }) {
        const { context, page } = await open(browser, origin, '/t/lockbox/login');
        try {
          await expect(page.locator('#tenant-logo')).toHaveCount(0);
          await expect(page.locator('#oauth-google')).toHaveCount(0);
          await expect(page.locator('#oauth-github')).toHaveCount(0);
          await expect(page.locator('#lc-toggle')).toHaveCount(0);
          await expect(page.locator('#invite-notice')).toBeVisible();
        } finally { await context.close(); }
      },
    },
  ],
  ksx: [
    {
      name: '/check?state=empty: with no controller the empty section replaces the chips, and the roster is empty',
      async run({ browser, origin }) {
        const { context, page } = await open(browser, origin, '/check?state=empty', { javaScriptEnabled: false });
        try {
          await expect(page.locator('#empty h2')).toHaveText('No device configured');
          await expect(page.locator('#chips')).toHaveCount(0);
          await expect(page.locator('#roster li')).toHaveCount(0);
        } finally { await context.close(); }
      },
    },
    {
      name: '/check: the roster and the chips are the nested payload read through paths and rows',
      async run({ browser, origin }) {
        const { context, page } = await open(browser, origin, '/check', { javaScriptEnabled: false });
        try {
          await expect(page.locator('#roster li')).toHaveCount(2);
          await expect(page.locator('#roster li').nth(1)).toContainText('DualSense');
          await expect(page.locator('#chips li')).toHaveCount(6);
          await expect(page.locator('.chip[data-control="dpad.up"]')).toHaveAttribute('data-keys', 'W ArrowUp');
        } finally { await context.close(); }
      },
    },
  ],
  bench: [],
};
