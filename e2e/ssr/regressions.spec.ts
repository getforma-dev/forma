/**
 * SSR regression fixtures across the whole stack (FORMA-001, stage 0).
 *
 * Each case in e2e/ssr/cases/ is compiled by THIS repo's compiler and build
 * package, rendered by forma's Rust walker through the public typed Pages API,
 * and adopted in Chromium by the FormaJS checkout under test (e2e/ssr/build.sh;
 * served by e2e/ssr/serve.mjs with each page's own CSP). The tests read the
 * parsed DOM, live control values and FormData before JavaScript, after
 * activation and after interaction.
 *
 * The defects the Forma Stack audit verification reproduced (runs 1, 2, 3 and
 * 7; the v2 decision brief, DR-5 and DR-7) are written as the behaviour v2
 * requires, each naming the ticket whose fix flips it. Such a test first
 * asserts its case's preconditions normally (the page is server-rendered, the
 * elements exist, the server's value is there), then calls `test.fail()` just
 * before the defect assertion. So a broken harness fails the test for real
 * (a precondition fails before the marker); only the named defect is an
 * expected failure; and when the fix lands, the unexpected pass turns CI red
 * until that one line is removed. FORMA-002 and FORMA-003 have flipped theirs
 * (each now says "Fixed by"); generic-state is now delivered by FORMA-103.
 *
 * Since 3.0.0 (FORMA-105, DR-6) a server-rendered page activates only its
 * islands: the compiler selects the page through the entry's standalone
 * `mount()` and removes it from the route's browser product, and a page with
 * no island loads no JavaScript at all. So each case's interactive subtree is
 * an island, seeded from declared props, and `root-fragment` is a static
 * page. Phase 1 (`/<case>/csr`) is the same entry built as an explicit
 * Browser route (`ssr: false`), which keeps the mount and renders the page
 * whole from an empty #app.
 *
 * The table "every case is server-rendered and activates" adds the shared
 * controls (the walker's HTML; island activation, or no script at all for a
 * static page; the Phase 1 mount; no console errors), and the file refuses to
 * run unless the server on the SSR port serves THIS clone's site.
 */
import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { SSR_ORIGIN as ORIGIN } from './origin';

/**
 * Every case under e2e/ssr/cases/, and what its server-rendered page does
 * once its module runs: an `island` page activates its islands; a `static`
 * page has none and loads no script (DR-6).
 */
const CASES = {
  'generic-state': 'island',
  'mixed-entry': 'island',
  namespaces: 'island',
  'root-fragment': 'static',
  'textarea-child': 'island',
  'textarea-value': 'island',
  title: 'island',
  select: 'island',
  'edited-controls': 'island',
  'ledger-arrival': 'island',
  'keyed-moves': 'island',
  'keyed-indexed': 'island',
  'browser-only': 'island',
} as const;
type CaseName = keyof typeof CASES;

/** How long an assertion after activation may wait. Effects are synchronous. */
const SETTLE = { timeout: 2_000 };

test.use({ baseURL: ORIGIN });

// Playwright refuses existing listeners; independently verify the served
// site belongs to this clone and this build.
test.beforeAll(async () => {
  const answer = await fetch(`${ORIGIN}/__site`).then((r) => r.json() as Promise<{ site: string; built: boolean }>);
  expect(answer.site, `the server on ${ORIGIN} serves another clone's site; stop it or set FORMA_SSR_E2E_PORT`)
    .toBe(join(realpathSync(__dirname), 'out', 'site'));
  expect(answer.built, 'the SSR site is not built; run e2e/ssr/build.sh (npm run test:e2e does)').toBe(true);
});

/**
 * Collect page errors and console errors (CSP violations are console errors).
 * A failed request to /api/ is not one: the fixture server has no API, and the
 * ledger-arrival case calls it to reach its offline state on purpose.
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (new URL(message.location().url || ORIGIN).pathname.startsWith('/api/')) return;
    errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/**
 * The page as the HTML parser built it from the server's response, with
 * JavaScript disabled: what a user sees, and what a form submits, before the
 * module runs.
 */
async function openWithoutJs(browser: Browser, path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: ORIGIN, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(path);
  return { page, close: () => context.close() };
}

/**
 * Load the Phase 2 page with its module held until parsing is done, so the
 * server's DOM can be read and edited before any FormaJS code runs.
 * `activate()` releases the module and waits for the case's activation signal.
 */
async function openHeld(page: Page, name: CaseName): Promise<{ activate: () => Promise<void> }> {
  const held: Route[] = [];
  let holding = true;
  await recordIslandErrors(page);
  await page.route('**/_assets/*.js', (route) => {
    if (holding) held.push(route);
    else void route.continue();
  });
  await page.goto(`/${name}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.readyState !== 'loading');
  await expect.poll(() => held.length, { message: 'the page module is held before it runs' }).toBeGreaterThan(0);
  return {
    async activate() {
      holding = false;
      for (const route of held.splice(0)) await route.continue();
      await waitForActivation(page, name);
    },
  };
}

/**
 * Record every `forma:error` event the page dispatches, from before its module
 * runs. Must be installed before navigation.
 */
async function recordIslandErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const errors: unknown[] = [];
    (window as any).__formaErrors = errors;
    document.addEventListener('forma:error', (event) => errors.push((event as CustomEvent).detail));
  });
}

/**
 * Since FORMA-104's strict activation a successful island makes zero initial
 * DOM writes: `data-forma-status` stays "pending" (packages/core/docs/ISLANDS.md,
 * "Strict activation"). A failed adoption writes "error" and dispatches one
 * bubbling `forma:error`; a state preflight refusal writes nothing and logs a
 * console error (watchErrors sees it). So "activated" is: the page's module
 * has run (the load event follows a deferred module), every host is still
 * there, none reports an error, and no `forma:error` was dispatched. Each
 * behaviour test then checks that the island is live.
 */
async function waitForActivation(page: Page, name: CaseName): Promise<void> {
  if (CASES[name] !== 'island') throw new Error(`${name} is a static page: nothing activates`);
  await page.waitForLoadState('load');
  expect(await page.locator('[data-forma-island]').count(), 'the island hosts are on the page').toBeGreaterThan(0);
  await expect(page.locator('[data-forma-island][data-forma-status="error"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__formaErrors), 'no forma:error event').toEqual([]);
}

/** The Phase 2 page, loaded and activated. */
async function openActivated(page: Page, name: CaseName): Promise<void> {
  await recordIslandErrors(page);
  await page.goto(`/${name}/`);
  await waitForActivation(page, name);
}

/**
 * The Phase 2 page of a case with no island: the server's HTML stays as
 * parsed, and the page references no script at all (DR-6: a server-rendered
 * page with no island loads zero bytes of JavaScript).
 */
async function openStatic(page: Page, name: CaseName): Promise<void> {
  if (CASES[name] !== 'static') throw new Error(`${name} has islands: it is not a static page`);
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto(`/${name}/`);
  await expectServerRendered(page);
  expect(await page.locator('script[src], link[rel="modulepreload"]').count(), 'the page references no script').toBe(0);
  expect(scripts, 'the page loaded no script').toEqual([]);
}

/** The same entry built as an explicit Browser route (Phase 1), mounted. */
async function openClientRendered(page: Page, name: CaseName): Promise<void> {
  await page.goto(`/${name}/csr`);
  await page.waitForFunction(() => (document.getElementById('app')?.childElementCount ?? 0) > 0);
}

/** What submitting the form would send for one field. */
function submitted(page: Page, field: string): Promise<string[]> {
  return page.evaluate((name) => {
    const form = document.querySelector('form');
    if (!form) throw new Error('no form on the page');
    return new FormData(form).getAll(name).map(String);
  }, field);
}

/** A Phase 2 page as parsed: #app carries data-forma-ssr. */
async function expectServerRendered(page: Page): Promise<void> {
  await expect(page.locator('#app'), 'a Phase 2 page').toHaveAttribute('data-forma-ssr', '');
}

/** A select's live state: its value and selected index. */
function selectState(page: Page, selector: string): Promise<{ value: string; index: number }> {
  return page.locator(selector).evaluate((el: HTMLSelectElement) => ({ value: el.value, index: el.selectedIndex }));
}

// ── The harness control: every expected-fail below depends on it ──────────

test.describe('every case is server-rendered and activates', () => {
  test('the table covers every case directory', () => {
    const dirs = readdirSync(join(__dirname, 'cases'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(CASES).sort()).toEqual(dirs);
  });

  // "Activates" here means the module ran, no host is in `error` and no
  // `forma:error` was dispatched (a static page has none and loads no
  // script). Strict SSR activation writes no status on success (`active` is
  // written only on the browserOnly path), so a module that loads and does
  // nothing passes this row; only the behaviour tests below catch that.
  for (const name of Object.keys(CASES) as CaseName[]) {
    test(`${name}: walker HTML present, Phase 2 ${CASES[name] === 'island' ? 'activates' : 'is static'}, Phase 1 mounts, no errors`, async ({ browser, page }) => {
      const noJs = await openWithoutJs(browser, `/${name}/`);
      await expectServerRendered(noJs.page);
      const serverHtml = await noJs.page.locator('#app').innerHTML();
      await noJs.close();
      expect(serverHtml.trim().length, 'the walker rendered content into #app').toBeGreaterThan(0);

      const errors = watchErrors(page);
      if (CASES[name] === 'island') await openActivated(page, name);
      else await openStatic(page, name);
      await openClientRendered(page, name);
      expect(errors).toEqual([]);
    });
  }
});

// ── Generic state through a declared island (audit verification: v1 run 1) ──────

test.describe('generic-state', () => {
  test('generic-state: the walker renders the server value 7 before JavaScript', async ({ browser, page }) => {
    const noJs = await openWithoutJs(browser, '/generic-state/');
    await expect(noJs.page.locator('#count')).toHaveText('7');
    await noJs.close();

    const held = await openHeld(page, 'generic-state');
    await expect(page.locator('#count')).toHaveText('7');
    await held.activate();
  });

  test('generic-state: the server value 7 survives activation and remains writable', async ({ page }) => {
    const held = await openHeld(page, 'generic-state');
    await expect(page.locator('#count')).toHaveText('7');
    await held.activate();

    // FORMA-103 supplies the declared count before the original signal runs.
    // No wrapper reads attributes or seeds values by local variable name.
    await expect(page.locator('#count')).toHaveText('7', SETTLE);
    await page.click('#increment');
    await expect(page.locator('#count')).toHaveText('8', SETTLE);
  });
});

// ── Root JSX Fragment (audit verification run 1) ──────────────────────────

test.describe('root-fragment', () => {
  test('root-fragment: client-rendered, the button updates the text', async ({ page }) => {
    await openClientRendered(page, 'root-fragment');
    await expect(page.locator('#note')).toHaveText('hello');
    await page.click('#go');
    await expect(page.locator('#note')).toHaveText('bye', SETTLE);
  });

  test('root-fragment: server-rendered, a page with no island is static: the walker\'s HTML, no script, the button inert', async ({ page }) => {
    // Before 3.0.0 this page was adopted whole by mount(), and FORMA-003
    // (DR-7 a) made a Fragment root adopt as the range of its children. Since
    // FORMA-105 (DR-6) mount() does not adopt a server-marked root: a page
    // declares what is live as islands, and one with none ships no script.
    await openStatic(page, 'root-fragment');
    await expect(page.locator('#note')).toHaveText('hello');
    await page.click('#go');
    await expect(page.locator('#note')).toHaveText('hello');
    await expectServerRendered(page);
  });
});

// ── textarea: RCDATA (audit verification run 2) ───────────────────────────

test.describe('textarea-child', () => {
  test('textarea-child: before JavaScript the value and FormData are "hello"', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/textarea-child/');
    await expectServerRendered(noJs.page);
    const value = await noJs.page.locator('form#f textarea#ta').inputValue();
    const sent = await submitted(noJs.page, 'ta');
    await noJs.close();
    expect(value, "the server's value is in the textarea").toContain('hello');

    // Fixed by FORMA-002 (DR-7 b): no f: markers inside RCDATA parents.
    // Before it, the value, and what the form submitted, was
    // `<!--f:t0-->hello<!--/f:t0-->`.
    expect({ value, submitted: sent }).toEqual({ value: 'hello', submitted: ['hello'] });
  });

  test('textarea-child: after activation the value follows the signal', async ({ page }) => {
    await openActivated(page, 'textarea-child');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
    expect(await submitted(page, 'ta')).toEqual(['updated']);
  });

  test('textarea-child: client-rendered, the value follows the signal', async ({ page }) => {
    await openClientRendered(page, 'textarea-child');
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });
});

test.describe('textarea-value', () => {
  test('textarea-value: before JavaScript the value and FormData are "hello"', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/textarea-value/');
    await expectServerRendered(noJs.page);
    const value = await noJs.page.locator('form#f textarea#ta').inputValue();
    const sent = await submitted(noJs.page, 'ta');
    await noJs.close();

    // Fixed by FORMA-002 (DR-7 c): a textarea's value binding is written as its
    // text. Before it, the server wrote value="hello", which a textarea
    // ignores, so it was empty and submitted "".
    expect({ value, submitted: sent }).toEqual({ value: 'hello', submitted: ['hello'] });
  });

  test('textarea-value: after activation the value follows the signal', async ({ page }) => {
    await openActivated(page, 'textarea-value');
    await expect(page.locator('form#f textarea#ta')).toHaveCount(1);
    await expect(page.locator('#update')).toBeVisible();

    // Fixed by FORMA-003: `value` is written as the live property (042e353's
    // writer, kept for writes after activation). Before it, only the
    // attribute was written, which a textarea ignores.
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });

  test('textarea-value: client-rendered, the value follows the signal', async ({ page }) => {
    await openClientRendered(page, 'textarea-value');
    await expect(page.locator('form#f textarea#ta')).toHaveCount(1);
    await expect(page.locator('#update')).toBeVisible();

    // Fixed by FORMA-003, as above, on the client-rendered path.
    await expect(page.locator('#ta')).toHaveValue('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#ta')).toHaveValue('updated', SETTLE);
  });
});

// FORMA-139: document metadata is owned by the server renderer. The original
// body title and its assertions remain authenticated in the migration archive.
test.describe('title', () => {
  test('title: the server owns one head title before JavaScript', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/title/');
    await expectServerRendered(noJs.page);
    await expect(noJs.page.locator('head > title')).toHaveCount(1);
    await expect(noJs.page.locator('body title')).toHaveCount(0);
    await expect(noJs.page.locator('#heading')).toHaveText('hello');
    expect(await noJs.page.title()).toBe('Server-owned fixture title');
    await noJs.close();
  });

  test('title: an adopted heading updates without changing server metadata', async ({ page }) => {
    await openActivated(page, 'title');
    await expect(page.locator('#heading')).toHaveText('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#heading')).toHaveText('updated', SETTLE);
    await expect(page.locator('head > title')).toHaveCount(1);
    await expect(page.locator('body title')).toHaveCount(0);
    expect(await page.title()).toBe('Server-owned fixture title');
  });

  test('title: the Browser shell owns the same metadata while its heading updates', async ({ page }) => {
    await openClientRendered(page, 'title');
    await expect(page.locator('#heading')).toHaveText('hello', SETTLE);
    await page.click('#update');
    await expect(page.locator('#heading')).toHaveText('updated', SETTLE);
    await expect(page.locator('head > title')).toHaveCount(1);
    await expect(page.locator('body title')).toHaveCount(0);
    expect(await page.title()).toBe('Server-owned fixture title');
  });
});

// ── select bound to a later option (audit verification run 3) ─────────────

test.describe('select', () => {
  test('select: before JavaScript "b" is selected and submitted', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/select/');
    await expectServerRendered(noJs.page);
    await expect(noJs.page.locator('form#f select#choice option')).toHaveText(['A', 'B', 'C']);
    const state = await selectState(noJs.page, '#choice');
    const sent = await submitted(noJs.page, 'choice');
    await noJs.close();

    // Fixed by FORMA-002 (DR-7 c): `selected` is written on the matching
    // option. Before it, the server wrote value="b" on the select, which HTML
    // ignores, so the first option was selected and submitted.
    expect({ ...state, submitted: sent }).toEqual({ value: 'b', index: 1, submitted: ['b'] });
  });

  test('select: after activation "b" is selected, and an update selects "c"', async ({ page }) => {
    await openActivated(page, 'select');
    await expect(page.locator('form#f select#choice option')).toHaveText(['A', 'B', 'C']);
    await expect(page.locator('#pick-c')).toBeVisible();

    // Fixed by FORMA-003: a select's value is written as the live property
    // after its options exist (042e353's writer). Before it, only the
    // attribute was written, and the first option stayed selected.
    expect(await selectState(page, '#choice')).toEqual({ value: 'b', index: 1 });
    await page.click('#pick-c');
    await expect(page.locator('#choice')).toHaveValue('c', SETTLE);
    expect(await submitted(page, 'choice')).toEqual(['c']);
  });

  test('select: client-rendered, "b" is selected, and an update selects "c"', async ({ page }) => {
    await openClientRendered(page, 'select');
    await expect(page.locator('form#f select#choice option')).toHaveText(['A', 'B', 'C']);
    await expect(page.locator('#pick-c')).toBeVisible();

    // Fixed by FORMA-003, as above, on the client-rendered path.
    expect(await selectState(page, '#choice')).toEqual({ value: 'b', index: 1 });
    await page.click('#pick-c');
    await expect(page.locator('#choice')).toHaveValue('c', SETTLE);
  });
});

// ── Controls edited before activation (DR-5) ──────────────────────────────
//
// These pass on FormaJS main, which writes only attributes at adoption, and a
// user-edited control ignores attribute writes. They fail with the checkpoint
// commit 042e353, whose live-property writer assigns the client's value at
// adoption. FORMA-003 keeps that writer for later writes and must keep these
// green.

test.describe('edited-controls', () => {
  test('edited-controls: text typed before activation survives it, with focus', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const input = page.locator('#name');
    await expect(input).toHaveValue('server');
    await input.click();
    await input.press('End');
    await input.pressSequentially(' typed');
    await expect(input).toHaveValue('server typed');

    await held.activate();
    await expect(input).toHaveValue('server typed', SETTLE);
    await expect(page.locator('#echo-name'), 'the island is live and its signal was seeded from the edit').toHaveText('server typed', SETTLE);
    await expect(input).toBeFocused();
    expect(await submitted(page, 'name')).toEqual(['server typed']);
  });

  test('edited-controls: a checkbox ticked before activation stays ticked', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const box = page.locator('#agreed');
    await expect(box).not.toBeChecked();
    await box.check();

    await held.activate();
    await expect(box).toBeChecked(SETTLE);
    await expect(page.locator('#echo-agreed'), 'the island is live and its signal was seeded from the edit').toHaveText('yes', SETTLE);
    expect(await submitted(page, 'agreed')).toEqual(['on']);
  });

  test('edited-controls: an option picked before activation stays picked', async ({ page }) => {
    const held = await openHeld(page, 'edited-controls');
    const select = page.locator('#size');
    await expect(select).toHaveValue('s');
    await select.selectOption('l');

    await held.activate();
    await expect(select).toHaveValue('l', SETTLE);
    await expect(page.locator('#echo-size'), 'the island is live and its signal was seeded from the edit').toHaveText('l', SETTLE);
    expect(await submitted(page, 'size')).toEqual(['l']);
  });
});

// ── Ledger's arrival pattern: the positive fixture (audit verification run 7)

test.describe('ledger-arrival', () => {
  test('ledger-arrival: the walker renders the seeded snapshot before JavaScript', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/ledger-arrival/');
    const island = noJs.page.locator('[data-forma-component="Arrival"]');
    await expect(island).toHaveAttribute('data-forma-status', 'pending');
    await expect(noJs.page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(noJs.page.locator('#arrival-cash')).toHaveText('$123.45');
    await expect(noJs.page.locator('#arrival-status')).toHaveText('pending');
    await expect(noJs.page.locator('#arrival-retry')).toHaveCount(0);
    await noJs.close();
  });

  test('ledger-arrival: declared state keeps the server values through activation, and Retry runs', async ({ page }) => {
    const errors = watchErrors(page);
    const held = await openHeld(page, 'ledger-arrival');
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await held.activate();

    // The server's values, not the signals' literal defaults ('Household', '$0.00').
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(page.locator('#arrival-cash')).toHaveText('$123.45');

    // The workspace cannot load (the fixture server has no API): the snapshot
    // stays, the status says so, and Retry appears.
    const status = page.locator('#arrival-status');
    await expect(status).toHaveText('The workspace could not load (attempt 1). This snapshot is not live.', SETTLE);
    await expect(page.locator('#arrival-title')).toHaveText('Fixture Household');
    await expect(page.locator('#arrival-cash')).toHaveText('$123.45');

    await page.click('#arrival-retry');
    await expect(status).toHaveText('The workspace could not load (attempt 2). This snapshot is not live.', SETTLE);
    await expect(page.locator('#arrival-retry')).toBeVisible();

    expect(errors).toEqual([]);
  });
});

// ── browserOnly(): the browser-only marker (FORMA-119; DR-1, L-1) ──────────

test.describe('browser-only', () => {
  test('browser-only: the server renders the empty host with its declared props, and the rest of the page', async ({ browser }) => {
    const noJs = await openWithoutJs(browser, '/browser-only/');
    await expect(noJs.page.locator('#report-title')).toHaveText('Quarterly report');
    await expect(noJs.page.locator('#report-summary')).toHaveText('Revenue rose in every region.');
    const host = noJs.page.locator('[data-forma-component="Chart"]');
    await expect(host).toHaveAttribute('data-forma-status', 'pending');
    await expect(host).not.toHaveAttribute('data-forma-props');
    await expect(host).toHaveAttribute('data-forma-state', '0');
    const block = noJs.page.locator('head > script[type="application/json"][data-island-state]');
    await expect(block).toHaveCount(1);
    const state = JSON.parse((await block.textContent())!);
    expect(state).toEqual({ v: 1, s: [], i: [{ h: await host.getAttribute('data-forma-h'), p: { title: 'Sales', points: 3 } }] });
    expect(state.i[0].h).toMatch(/^[0-9a-f]{16}$/);
    expect(await host.evaluate((el) => el.childNodes.length), 'the host is empty').toBe(0);
    await expect(noJs.page.locator('#chart')).toHaveCount(0);
    await noJs.close();
  });

  test('browser-only: the browser renders the component in the host, from its props, and it works', async ({ page }) => {
    const errors = watchErrors(page);
    const held = await openHeld(page, 'browser-only');
    await expect(page.locator('#chart')).toHaveCount(0);
    await held.activate();

    await expect(page.locator('#chart-caption')).toHaveText('Sales: 3 points');
    await expect(page.locator('#chart')).toHaveAttribute('data-forma-component', 'Chart');
    await page.click('#chart-add');
    await expect(page.locator('#chart-caption')).toHaveText('Sales: 4 points', SETTLE);
    // The server-rendered rest of the page is untouched.
    await expect(page.locator('#report-title')).toHaveText('Quarterly report');
    expect(errors).toEqual([]);
  });

  test('browser-only: client-rendered, the component renders as any component does', async ({ page }) => {
    await openClientRendered(page, 'browser-only');
    await expect(page.locator('#chart-caption')).toHaveText('Sales: 3 points');
    await expect(page.locator('#report-title')).toHaveText('Quarterly report');
  });
});

// A same-source SSR/Browser pair must keep fresh mount semantics while the SSR
// product still adopts real local/shared islands and shares core with an add-on.
test.describe('mixed-entry',()=>{
 for(const mode of ['ssr','browser'] as const)test(`mixed-entry: ${mode} local and shared Show/List remain live`,async({page})=>{
  const errors=watchErrors(page);
  if(mode==='ssr'){
   const held=await openHeld(page,'mixed-entry');
   await expect(page.locator('#mixed-rows > li')).toHaveText(['A','B']);
   await page.evaluate(()=>{(window as any).mixedHeld=[document.querySelector('#mixed-local'),document.querySelector('#mixed-panel'),...document.querySelectorAll('#mixed-rows > li')];});
   await held.activate();
   expect(await page.evaluate(()=>{const old=(window as any).mixedHeld;return old.every((node:Node,index:number)=>node===[document.querySelector('#mixed-local'),document.querySelector('#mixed-panel'),...document.querySelectorAll('#mixed-rows > li')][index]);})).toBe(true);
   expect(await page.evaluate(()=>{const a=(window as any).mixedEntryIdentity,b=(window as any).mixedAddonIdentity;return a.core===b.core&&a.shared===b.shared;})).toBe(true);
   await expect(page.locator('#mixed-addon-count')).toHaveText('10');await page.click('#mixed-addon-count');await expect(page.locator('#mixed-addon-count')).toHaveText('11');
  }else await openClientRendered(page,'mixed-entry');
  await expect(page.locator('#mixed-local')).toHaveText('0');await page.click('#mixed-local');await expect(page.locator('#mixed-local')).toHaveText('1');
  await expect(page.locator('#mixed-open')).toHaveText('open');await page.click('#mixed-toggle');await expect(page.locator('#mixed-closed')).toHaveText('closed');
  await expect(page.locator('#mixed-rows > li')).toHaveText(['A','B']);
  await page.evaluate(()=>{(window as any).mixedRows=[...document.querySelectorAll('#mixed-rows > li')];});
  await page.click('#mixed-reorder');await expect(page.locator('#mixed-rows > li')).toHaveText(['B','A']);
  expect(await page.evaluate(()=>{const old=(window as any).mixedRows,rows=[...document.querySelectorAll('#mixed-rows > li')];return rows[0]===old[1]&&rows[1]===old[0];})).toBe(true);
  expect(errors).toEqual([]);
 });
});

// FORMA-181 D: unlike the low-level core seam, these bytes come from the current compiler,
// typed Rust Pages handler and full browser entry. No registration or state is hand-authored.
test('keyed-moves: typed server rows adopt with zero writes and a focused row moves without losing its listeners', async ({ page }) => {
  const errors = watchErrors(page);
  const held = await openHeld(page, 'keyed-moves');
  const before = await page.evaluate(() => {
    const host = document.querySelector('#keyed-rows')!;
    const rows = [...host.querySelectorAll('li')];
    const input = rows[0]!.querySelector('input')!;
    input.focus(); input.setSelectionRange(1, 4, 'backward');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    Object.assign(window as any, { keyedProduct: { rows, input, records, observer } });
    const state = JSON.parse(document.querySelector('script[data-island-state]')!.textContent!);
    return { keys: rows.map(row => row.getAttribute('data-forma-key')), values: rows.map(row => row.querySelector('input')!.value), state: state.i.map((entry: any) => entry.p) };
  });
  expect(before).toEqual({ keys: ['alpha', 'beta', 'gamma'], values: ['Alpha', 'Beta', 'Gamma'], state: [{ rows: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }, { id: 'gamma', label: 'Gamma' }] }] });
  await held.activate();
  const adopted = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    const state = (window as any).keyedProduct;
    state.records.push(...state.observer.takeRecords());
    const records = state.records.length; state.records.length = 0;
    return { records, focused: document.activeElement === state.input, selection: [state.input.selectionStart, state.input.selectionEnd, state.input.selectionDirection], retained: [...document.querySelectorAll('#keyed-rows li')].every((node, i) => node === state.rows[i]) };
  });
  expect(adopted).toEqual({ records: 0, focused: true, selection: [1, 4, 'backward'], retained: true });
  await page.keyboard.press('F2');
  const moved = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    const state = (window as any).keyedProduct;
    state.records.push(...state.observer.takeRecords()); state.observer.disconnect();
    const touched = state.records.flatMap((record: MutationRecord) => [...record.addedNodes, ...record.removedNodes]);
    return { order: [...document.querySelectorAll('#keyed-rows li')].map(row => state.rows.indexOf(row)), records: state.records.length, touched: touched.length, onlyMovedRow: touched.every((node: Node) => node === state.rows[0]), focused: document.activeElement === state.input, selection: [state.input.selectionStart, state.input.selectionEnd, state.input.selectionDirection] };
  });
  expect(moved).toEqual({ order: [1, 2, 0], records: 2, touched: 2, onlyMovedRow: true, focused: true, selection: [1, 4, 'backward'] });
  await page.keyboard.insertText('Z');
  await expect(page.locator('#keyed-edit')).toHaveText('alpha:AZa');
  await page.locator('#keyed-rows li').last().locator('button').click();
  await expect(page.locator('#keyed-click')).toHaveText('alpha');
  expect(errors).toEqual([]);
});
