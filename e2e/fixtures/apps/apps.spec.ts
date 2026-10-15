/**
 * The fixture applications (FORMA-188; DR-34, L-54): consumer-shaped pages written new
 * in this repository, built in strict mode and served by forma-server through a
 * `#[derive(PageProps)]` handler bound at start.
 *
 * build.sh builds every application with the working tree's @getforma/build and compiles
 * one Rust binary per application (this crate, a member of the e2e workspace). This file
 * starts each binary, announces nothing it does not own, and checks the three criteria of
 * M3's exit on the pages: the server's values reach the browser before any script and
 * stay (the audit's "7 stays 7, 1001 stays 1001, the arrival island keeps its values");
 * strict adoption writes nothing; and the islands then work. P17 runs the same
 * `lib/verify-page.mjs` against the packed set (scripts/release-fixture-apps.mjs).
 *
 * Ports: each binary takes FORMA_PORT; this file gives it FORMA_FIXTURE_PORT_BASE + its
 * index when that is set (several clones may run the lane at once), else any free port.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const HERE = __dirname;
const OUT = join(HERE, 'out');
const TARGET = process.env.CARGO_TARGET_DIR ?? resolve(HERE, '../../target');
const EXE = process.platform === 'win32' ? '.exe' : '';
const PORT_BASE = Number(process.env.FORMA_FIXTURE_PORT_BASE || 0);
if (!Number.isInteger(PORT_BASE) || PORT_BASE < 0 || PORT_BASE > 65500) throw new Error('invalid FORMA_FIXTURE_PORT_BASE');

interface Expectation {
  state?: Record<string, unknown>;
  statePrefix?: Record<string, unknown[]>;
  serverValues?: { selector: string; text: string }[];
}
interface Variant extends Expectation { name: string; path: string }
interface PageEntry extends Expectation {
  page: string;
  path?: string;
  entry: string;
  kind: string;
  islands: string[];
  shape?: { consumer: string; targetNodes: number | null; islands: number };
  variants?: Variant[];
}
interface AppEntry { css: string; routes: Record<string, PageEntry> }
const INDEX = JSON.parse(readFileSync(join(HERE, 'apps.json'), 'utf8')) as { apps: Record<string, AppEntry> };
const APPS = Object.keys(INDEX.apps);

interface Running { origin: string; stop: () => Promise<void>; output: () => string }

async function start(name: string): Promise<Running> {
  const binary = join(TARGET, 'debug', `fixture-${name}${EXE}`);
  expect(existsSync(binary) && existsSync(join(OUT, name, 'dist', 'manifest.json')), `fixture ${name} is not built; run e2e/fixtures/apps/build.sh (npm run test:e2e does)`).toBe(true);
  const port = PORT_BASE ? PORT_BASE + APPS.indexOf(name) : 0;
  const child: ChildProcess = spawn(binary, [], { env: { ...process.env, FORMA_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (bytes) => { output += bytes; });
  child.stderr?.on('data', (bytes) => { output += bytes; });
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  const clean = () => output.replace(/\x1b\[[0-9;]*m/g, '');
  const deadline = Date.now() + 20_000;
  let origin = '';
  while (Date.now() < deadline) {
    const match = /^FORMA_LISTENING (http:\/\/127\.0\.0\.1:\d+)\r?$/m.exec(clean());
    if (match) { origin = match[1]; break; }
    if (child.exitCode !== null) throw new Error(`fixture ${name} exited before listening (${child.exitCode}): ${clean()}`);
    await new Promise((done) => setTimeout(done, 50));
  }
  if (!origin) { child.kill('SIGTERM'); throw new Error(`fixture ${name} never reported its address: ${clean()}`); }
  return {
    origin,
    output: clean,
    stop: async () => { if (child.exitCode === null) child.kill('SIGTERM'); await closed; },
  };
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const verifier = () => import(pathToFileURL(join(HERE, 'lib', 'verify-page.mjs')).href);

/** Every listed tile counts: one press adds one to the count the server sent (7 stays 7 until it is pressed; 1001 likewise). */
function tileBehaviour(ids: number[]): Behaviour {
  return {
    interact: async (page) => {
      const before = await Promise.all(ids.map(async (id) => Number(await page.locator(`[data-tile="${id}"] .tile-count`).textContent())));
      for (const id of ids) await page.locator(`[data-tile="${id}"] .tile-more`).click();
      for (const [index, id] of ids.entries()) await expect(page.locator(`[data-tile="${id}"] .tile-count`)).toHaveText(String(before[index] + 1));
      // The switch shows and hides its marker without touching the count.
      await page.locator(`[data-tile="${ids[0]}"] .tile-switch`).click();
      await expect(page.locator(`[data-tile="${ids[0]}"] .tile-on`)).toBeVisible();
      return `${ids.length} tiles counted`;
    },
  };
}

/** What each page does once its island runs, and which of its requests wait for activation (lib/verify-page.mjs). */
type Behaviour = { hold?: string[]; interact?: (page: Page) => Promise<unknown> };
const BEHAVIOURS: Record<string, Behaviour> = {
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
      return 'filter bar and toolbar';
    },
  },
  'bench /pages/300': tileBehaviour([0]),
  'bench /pages/1500': tileBehaviour([0, 9]),
  'bench /pages/10000': tileBehaviour([0, 4]),
  'bench /pages/15000': tileBehaviour([0, 49]),
  'bench /pages/20000': tileBehaviour([0, 4]),
  'bench /pages/islands-100': tileBehaviour(Array.from({ length: 100 }, (_, index) => index)),
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
      return 'frame counter and live echo';
    },
  },
};

for (const name of APPS) {
  const app = INDEX.apps[name];
  test.describe(`fixture application ${name}`, () => {
    test.describe.configure({ mode: 'serial' });
    let server: Running;
    test.beforeAll(async () => { server = await start(name); });
    test.afterAll(async () => { await server?.stop(); });

    test('builds in strict mode with nothing above a note, one native module per route, and one script per route with islands', () => {
      const report = readJson(join(OUT, name, 'report.json'));
      expect(report.notes.filter((each: { severity: string }) => each.severity !== 'note')).toEqual([]);
      const manifest = readJson(join(OUT, name, 'dist', 'manifest.json'));
      for (const [route, page] of Object.entries(app.routes)) {
        expect(manifest.routes[route].mode, route).toBe('ssr');
        expect(manifest.routes[route].ir, route).toBeTruthy();
        expect(manifest.routes[route].js.length, route).toBe(page.islands.length ? 1 : 0);
      }
    });

    for (const [route, page] of Object.entries(app.routes)) {
      const cases: { label: string; path: string; expectation: Expectation; behaviour: Behaviour }[] = [
        { label: route, path: page.path ?? route, expectation: page, behaviour: BEHAVIOURS[`${name} ${route}`] ?? {} },
        ...(page.variants ?? []).map((variant) => ({ label: `${route} (${variant.name})`, path: variant.path, expectation: variant, behaviour: BEHAVIOURS[`${name} ${route} (${variant.name})`] ?? {} })),
      ];
      for (const { label, path, expectation, behaviour } of cases) {
        test(`${label}: the server's values are in the HTML with JavaScript off, and the state envelope is the handler's values`, async ({ browser }) => {
          const context = await browser.newContext({ javaScriptEnabled: false });
          try {
            const tab = await context.newPage();
            const response = await tab.goto(new URL(path, server.origin).href);
            expect(response?.status()).toBe(200);
            for (const { selector, text } of expectation.serverValues ?? []) expect(await tab.locator(selector).first().textContent(), selector).toBe(text);
            const envelope = JSON.parse((await tab.locator('script[data-island-state]').textContent()) ?? '');
            expect(envelope.v).toBe(1);
            expect(envelope.i.length).toBe(page.islands.length);
          } finally { await context.close(); }
        });

        test(`${label}: adoption writes nothing, every island keeps its server values, and then the islands work`, async ({ browser }) => {
          const { verifyIslandPage } = await verifier();
          const manifest = readJson(join(OUT, name, 'dist', 'manifest.json'));
          const states = expectation.state ?? {};
          const hosts: Record<string, number> = {};
          for (const island of page.islands) hosts[island] = (hosts[island] ?? 0) + 1;
          const result = await verifyIslandPage(browser, server.origin, route, manifest, {
            path,
            expected: {
              serverValues: expectation.serverValues ?? [],
              state: expectation.state ? Object.fromEntries(Object.entries(states).map(([component, each]) => [component, [each]])) : undefined,
              statePrefix: expectation.statePrefix,
              hosts,
            },
            hold: behaviour.hold ?? [],
            interact: behaviour.interact,
          });
          expect(result.mutations).toBe(0);
          expect(result.interacted, 'the page defines no behaviour that proves activation').toBeTruthy();
        });
      }
    }
  });
}

test.describe('fixture application ledger: a failing workspace', () => {
  let server: Running;
  test.beforeAll(async () => { server = await start('ledger'); });
  test.afterAll(async () => { await server?.stop(); });

  test('/household: a failed load names the attempt, keeps the snapshot, and Retry recovers', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const tab = await context.newPage();
      let calls = 0;
      await tab.route('**/api/status', async (route) => {
        calls += 1;
        if (calls === 1) await route.fulfill({ status: 503, body: 'down' });
        else await route.continue();
      });
      await tab.goto(new URL('/household', server.origin).href);
      await expect(tab.locator('#arrival-status')).toHaveText('Loading failed (attempt 1). Showing the opening snapshot.');
      await expect(tab.locator('#arrival-cash')).toHaveText('$12,345.67');
      await tab.locator('#arrival-retry').click();
      await expect(tab.locator('#arrival-status')).toHaveText('Loaded.');
      await expect(tab.locator('#arrival-retry')).toHaveCount(0);
      expect(calls).toBe(2);
    } finally { await context.close(); }
  });
});

test.describe('fixture application fauth: the tenant is data, never markup', () => {
  let server: Running;
  test.beforeAll(async () => { server = await start('fauth'); });
  test.afterAll(async () => { await server?.stop(); });

  test('/t/quote/login: a tenant named with script and markup renders as text and runs nothing', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const tab = await context.newPage();
      const errors: string[] = [];
      tab.on('pageerror', (error) => errors.push(error.message));
      await tab.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => (globalThis as { __v?: string[] }).__v = [...((globalThis as { __v?: string[] }).__v ?? []), e.effectiveDirective]));
      await tab.goto(new URL('/t/quote/login', server.origin).href);
      await expect(tab.locator('#tenant-name')).toHaveText('";alert(1);//</script><b>bold</b>');
      expect(await tab.locator('#tenant-name b').count()).toBe(0);
      expect(await tab.locator('title').textContent()).toContain('";alert(1);//');
      // The page still works after the hostile name: the document was not cut short.
      await tab.locator('#lc-toggle').click();
      await expect(tab.locator('#auth-subtitle')).toHaveText('Create your account');
      expect(errors).toEqual([]);
      expect(await tab.evaluate(() => (globalThis as { __v?: string[] }).__v ?? [])).toEqual([]);
    } finally { await context.close(); }
  });

  test('/t/unknown/login: an unknown tenant is a 404, not a page', async ({ request }) => {
    const response = await request.get(new URL('/t/unknown/login', server.origin).href);
    expect(response.status()).toBe(404);
  });

  test('/t/lockbox/login: an invite-only tenant offers no provider button and no sign-up switch', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const tab = await context.newPage();
      await tab.goto(new URL('/t/lockbox/login', server.origin).href);
      await expect(tab.locator('#oauth-google')).toHaveCount(0);
      await expect(tab.locator('#oauth-github')).toHaveCount(0);
      await expect(tab.locator('#lc-toggle')).toHaveCount(0);
      await expect(tab.locator('#invite-notice')).toBeVisible();
    } finally { await context.close(); }
  });
});

test.describe('fixture application ksx: the other branch of every condition', () => {
  let server: Running;
  test.beforeAll(async () => { server = await start('ksx'); });
  test.afterAll(async () => { await server?.stop(); });

  test('/check?state=empty: with no controller the empty section replaces the chips, and the roster is empty', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const tab = await context.newPage();
      await tab.goto(new URL('/check?state=empty', server.origin).href);
      await expect(tab.locator('#empty h2')).toHaveText('No device configured');
      await expect(tab.locator('#chips')).toHaveCount(0);
      await expect(tab.locator('#roster li')).toHaveCount(0);
    } finally { await context.close(); }
  });

  test('/check: the roster and the chips are the nested payload read through paths and rows', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const tab = await context.newPage();
      await tab.goto(new URL('/check', server.origin).href);
      await expect(tab.locator('#roster li')).toHaveCount(2);
      await expect(tab.locator('#roster li').nth(1)).toContainText('DualSense');
      await expect(tab.locator('#chips li')).toHaveCount(6);
      await expect(tab.locator('.chip[data-control="dpad.up"]')).toHaveAttribute('data-keys', 'W ArrowUp');
    } finally { await context.close(); }
  });
});

test.describe('activation is required, not assumed', () => {
  let server: Running;
  test.beforeAll(async () => { server = await start('ksx'); });
  test.afterAll(async () => { await server?.stop(); });
  const manifest = () => readJson(join(OUT, 'ksx', 'dist', 'manifest.json'));

  test('a page with no behaviour that proves activation is refused', async ({ browser }) => {
    const { verifyIslandPage } = await verifier();
    await expect(verifyIslandPage(browser, server.origin, '/check', manifest(), { path: '/check?state=empty' })).rejects.toThrow(/needs an interact behaviour/);
  });

  test('a variant whose islands never activate fails its behaviour (the reviewer\'s probe)', async ({ browser }) => {
    const { verifyIslandPage } = await verifier();
    const interact = BEHAVIOURS['ksx /check (no controller)'].interact;
    const page = INDEX.apps.ksx.routes['/check'];
    const variant = page.variants!.find(each => each.name === 'no controller')!;
    const expected = {
      serverValues: variant.serverValues,
      state: Object.fromEntries(Object.entries(variant.state!).map(([component, state]) => [component, [state]])),
      hosts: Object.fromEntries(page.islands.map(component => [component, 1])),
    };
    const options = { path: variant.path, expected, interact, timeout: 3000 };
    const active = await verifyIslandPage(browser, server.origin, '/check', manifest(), options);
    expect(active.interacted, 'the paired control must reach the live variant behaviour').toBeTruthy();
    // The held script is answered with an empty module: the hosts are in the HTML and nothing ran.
    let failure: Error | undefined;
    try {
      await verifyIslandPage(browser, server.origin, '/check', manifest(), { ...options, scriptBody: '' });
    } catch (error) { failure = error as Error; }
    expect(failure?.message).toContain('toHaveText');
    expect(failure?.message).toContain('#frames-seen');
    expect(failure?.message).toContain('1002');
  });
});

test.describe('fixtures the closed type set and N2 refuse', () => {
  const negative = (INDEX as unknown as { negative: { name: string; entry: string; code: string; message: string; file?: string }[] }).negative;
  const buildOne = async (name: string) => {
    const { buildNegative } = await import(pathToFileURL(join(HERE, 'lib', 'build-apps.mjs')).href);
    const { build } = await import(pathToFileURL(join(HERE, 'node_modules', '@getforma', 'build', 'dist', 'index.js')).href);
    return buildNegative({ build, outRoot: OUT, name });
  };

  test('a props type outside the closed type set (the studio payload\'s Record of key lists) fails the build with BUILD-610, naming the file, line and column', async () => {
    const entry = negative.find((each) => each.name === 'record-bindings')!;
    const result = await buildOne(entry.name);
    expect(result.built, 'the build must refuse').toBe(false);
    const found = result.diagnostics.filter((each: { code: string }) => each.code === entry.code);
    expect(found.length, JSON.stringify(result.diagnostics)).toBeGreaterThan(0);
    for (const each of found) {
      expect(each.message).toContain(entry.message);
      expect(each.file.endsWith(entry.file!)).toBe(true);
      expect(each.line).toBeGreaterThan(0);
      expect(each.column).toBeGreaterThan(0);
    }
  });

  test('a condition the compiler would have to evaluate fails with BUILD-610 and the fix is a declared boolean', async () => {
    const entry = negative.find((each) => each.name === 'computed-condition')!;
    const result = await buildOne(entry.name);
    expect(result.built).toBe(false);
    expect(result.diagnostics.some((each: { code: string; message: string }) => each.code === entry.code && each.message.includes(entry.message))).toBe(true);
  });

  test('an island holding a client-side list is over N2 today (BUILD-819): the finding, until the ceiling or the list code changes', async () => {
    const entry = negative.find((each) => each.name === 'list-island')!;
    const result = await buildOne(entry.name);
    // If this fails because the build succeeded, N2 now admits a list island: delete this test and
    // put the list back into the ksx check chips island and the fauth results island (FORMA-188).
    expect(result.built, 'N2 now admits an island with a client-side list; flip this fixture').toBe(false);
    expect(result.message).toContain(entry.code);
    expect(result.message).toContain(entry.message);
    const bytes = Number(/loads ([\d,]+) B gzip -9 of Forma code/.exec(result.message)?.[1]?.replaceAll(',', ''));
    const ceiling = Number(/ceiling of ([\d,]+) B/.exec(result.message)?.[1]?.replaceAll(',', ''));
    expect(bytes).toBeGreaterThan(ceiling);
  });
});

test.describe('fixture application bench: the consumers\' heaviest pages', () => {
  const bench = INDEX.apps.bench;
  let server: Running;
  test.beforeAll(async () => { server = await start('bench'); });
  test.afterAll(async () => { await server?.stop(); });

  for (const [route, page] of Object.entries(bench?.routes ?? {})) {
    test(`${route} (${page.shape?.consumer}): the walker's node count is within 3% of the consumer's figure, with its islands and a state envelope under 1 MiB`, async ({ request }) => {
      const response = await request.get(new URL(route, server.origin).href);
      expect(response.status()).toBe(200);
      const counts = /nodes=(\d+); bytes=(\d+); list=(\d+)/.exec(response.headers()['x-fixture-counts'] ?? '');
      expect(counts, 'the server reports the walker\'s counts').toBeTruthy();
      const nodes = Number(counts![1]);
      const target = page.shape?.targetNodes;
      // Every page but the hundred-island one stands for a consumer's figure; a missing figure is a failure, not a skip.
      if (route !== '/pages/islands-100') expect(target, `${route} has no targetNodes`).toBeTruthy();
      if (target) expect(Math.abs(nodes - target) / target, `${nodes} nodes against ${target}`).toBeLessThan(0.03);
      const html = await response.text();
      expect(html.match(/data-forma-island="/g)?.length).toBe(page.shape?.islands);
      const envelope = /<script type="application\/json" data-island-state>([^<]*)<\/script>/.exec(html);
      expect(envelope, 'one inert state envelope').toBeTruthy();
      expect(envelope![1].length).toBeLessThan(1024 * 1024);
      expect(JSON.parse(envelope![1]).i.length).toBe(page.shape?.islands);
    });
  }
});
