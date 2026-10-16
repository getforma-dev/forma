/**
 * The fixture applications (FORMA-188; DR-34, L-54): consumer-shaped pages written fresh
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
import { stripVTControlCharacters } from 'node:util';
import { expect, test, type Browser, type Page } from '@playwright/test';

const HERE = __dirname;
const OUT = join(HERE, 'out');
const TARGET = process.env.CARGO_TARGET_DIR ?? resolve(HERE, '../../target');
const PROFILE = process.env.FORMA_FIXTURE_PROFILE ?? 'debug';
if (PROFILE !== 'debug' && PROFILE !== 'release') throw new Error('invalid FORMA_FIXTURE_PROFILE');
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
  const binary = join(TARGET, PROFILE, `fixture-${name}${EXE}`);
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

/** The extra checks' titles, read from lib/behaviours.mjs so the runner can name them before it imports the module. */
const EXTRA_TITLES: Record<string, string[]> = (() => {
  const source = readFileSync(join(HERE, 'lib', 'behaviours.mjs'), 'utf8');
  const titles: Record<string, string[]> = {};
  let current = '';
  for (const line of source.split('\n')) {
    const application = /^  (\w+): \[/.exec(line);
    if (application) { current = application[1]; titles[current] = []; continue; }
    const name = /^      name: '(.*)',$/.exec(line);
    if (name && current) titles[current].push(name[1]);
  }
  return titles;
})();

type Behaviour = { hold?: string[]; interact?: (page: Page) => Promise<unknown> };
/** What each page does once its island runs, and the checks about its other branches (lib/behaviours.mjs, shared with P17). */
const behaviours = () => import(pathToFileURL(join(HERE, 'lib', 'behaviours.mjs')).href) as Promise<{
  BEHAVIOURS: Record<string, Behaviour>;
  EXTRAS: Record<string, { name: string; run: (context: { browser: Browser; origin: string }) => Promise<void> }[]>;
}>;

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
      const cases: { label: string; path: string; expectation: Expectation; main: boolean }[] = [
        { label: route, path: page.path ?? route, expectation: page, main: true },
        ...(page.variants ?? []).map((variant) => ({ label: `${route} (${variant.name})`, path: variant.path, expectation: variant, main: false })),
      ];
      for (const { label, path, expectation, main } of cases) {
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
          const behaviour: Behaviour = (await behaviours()).BEHAVIOURS[main ? `${name} ${route}` : `${name} ${label}`] ?? {};
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

for (const name of APPS) {
  // The checks about a page's other branches and what its handler does not trust (lib/behaviours.mjs).
  test.describe(`fixture application ${name}: other branches`, () => {
    let server: Running;
    test.beforeAll(async () => { server = await start(name); });
    test.afterAll(async () => { await server?.stop(); });
    test('every extra check in lib/behaviours.mjs is run by name', async () => {
      const { EXTRAS } = await behaviours();
      expect([...(EXTRA_TITLES[name] ?? [])].sort()).toEqual((EXTRAS[name] ?? []).map((each) => each.name).sort());
    });
    // Test titles are fixed at collection time, so the extras are named in the index and run by name.
    for (const title of EXTRA_TITLES[name] ?? []) {
      test(title, async ({ browser }) => {
        const { EXTRAS } = await behaviours();
        const extra = EXTRAS[name].find((each) => each.name === title);
        expect(extra, `lib/behaviours.mjs has no extra check named ${title}`).toBeTruthy();
        await extra!.run({ browser, origin: server.origin });
      });
    }
  });
}

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
    const { BEHAVIOURS } = await behaviours();
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
    const message = stripVTControlCharacters(failure?.message ?? '');
    expect(message).toContain('toHaveText');
    expect(message).toContain('#frames-seen');
    expect(message).toContain('1002');
  });
});

test.describe('fixture type refusals and accepted N2 shapes', () => {
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

  test('an island holding a client-side list builds inside the emitted size policy (L-58)', async () => {
    const { buildPositive } = await import(pathToFileURL(join(HERE, 'lib', 'build-apps.mjs')).href);
    const { build } = await import(pathToFileURL(join(HERE, 'node_modules', '@getforma', 'build', 'dist', 'index.js')).href);
    const { sizeReport } = await buildPositive({ build, outRoot: OUT, name: 'list-island' });
    expect(sizeReport.version).toBe(1);
    expect(sizeReport.routes).toHaveLength(1);
    const [route] = sizeReport.routes;
    expect(route.route).toBe('/');
    expect(route.class).toBe('islands');
    expect(route.canvas).toBe(false);
    expect(route.ceilings.forma).toBe(sizeReport.ceilings.forma);
    expect(route.ceilings.javascript).toBe(sizeReport.ceilings.page);
    expect(route.forma.gzip).toBeGreaterThan(0);
    expect(route.forma.gzip).toBeLessThanOrEqual(route.ceilings.forma);
    expect(route.javascript.gzip).toBeGreaterThan(0);
    expect(route.javascript.gzip).toBeLessThanOrEqual(route.ceilings.javascript);
    expect(route.exceeded).toEqual([]);
    expect(route.over).toBe(false);
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
