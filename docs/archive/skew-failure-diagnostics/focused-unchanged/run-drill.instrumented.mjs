import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBalancer } from 'file:///Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/skew/balancer.mjs';

export const SKEW_DRILL_CHECKS = [
  'typed native page adopts its own bundle and remains interactive',
  'rolling instances refuse a missing lazy panel and the application retries it',
  'one-old tab loads byte-identical retained immutable assets',
  'rollback keeps old tabs honest and serves a consistent fresh page',
  'identical re-upgrade serves the same failed panel without reloading the tab',
  'third release retains exactly one generation',
  'security release serves no revoked retained assets',
  'mismatched native page reloads once then stays inert',
  'blocked storage and cancellation keep mismatched pages inert without reloading',
  'missing page identity permits ordinary activation',
  'explicit Browser mount obeys the same skew boundary',
];

async function until(read, predicate, label, timeout = 10_000) {
  const end = Date.now() + timeout; let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
export async function startNative(binary, cwd) {
  const child = spawn(binary, [], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '', closed = false;
  const ended = new Promise(resolve => child.once('close', () => { closed = true; resolve(); }));
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  child.on('error', error => { errors += String(error); });
  const close = async () => { if (!closed) child.kill('SIGTERM'); await ended; };
  try {
    await until(() => ({ output, errors, closed }), value => {
      if (value.closed) throw new Error(`native drill exited before listening: ${value.errors}`);
      return value.output.includes('\n');
    }, 'native deployments did not listen');
    const origins = JSON.parse(output.slice(0, output.indexOf('\n')));
    assert.deepEqual(Object.keys(origins).sort(), ['A', 'B', 'B2', 'C', 'S'].sort());
    return { origins, close };
  } catch (error) { await close(); throw error; }
}

/** One shared assertion path for repository Playwright and all three packed-set browsers. */
export async function runSkewDrill({ browser, binary, cwd, deployments }) {
  const native = await startNative(binary, cwd);
  const proxy = await createBalancer(native.origins);
  const { state, origin } = proxy;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(10_000);
  const checks = [], events = new Map(), navigation = new Map(), errors = new Map();
  const mark = index => checks.push(SKEW_DRILL_CHECKS[index]);
  async function newPage(mode = 'normal') {
    const page = await context.newPage(); events.set(page, []); navigation.set(page, 0);
    errors.set(page, []);
    page.on('pageerror', error => errors.get(page).push(error.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url().startsWith(origin)) navigation.set(page, navigation.get(page) + 1); });
    page.on('console', message => { if (message.text().startsWith('SKEW_EVENT ')) events.get(page).push(JSON.parse(message.text().slice(11))); });
    await page.addInitScript(mode => {
      if (mode === 'blocked') Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked by drill'); } });
      document.addEventListener('forma:skew', event => {
        if (mode === 'cancel') event.preventDefault();
        console.log('SKEW_EVENT ' + JSON.stringify(event.detail));
      });
    }, mode);
    return page;
  }
  const text = (page, selector) => page.locator(selector).textContent();
  async function active(page, label, path = '/') {
    await page.goto(origin + path);
    await page.waitForFunction(() => document.querySelector('#increment'));
    assert.equal(await page.locator('#counter').getAttribute('data-source'), label);
    assert.equal(await text(page, '#server-label'), path === '/csr' ? 'browser' : label);
    assert.equal(await text(page, '#count'), path === '/csr' ? '0' : '7');
    await page.click('#increment');
    await until(() => text(page, '#count'), value => value === (path === '/csr' ? '1' : '8'), 'counter did not update');
    assert.equal(await page.locator('[data-forma-status="error"], [data-forma-status="skew"]').count(), 0);
    assert.deepEqual(events.get(page), []);
  }
  async function panel(page, index, expected) {
    await page.click(`#panel-${index}`);
    await until(() => text(page, '#panel'), value => value === expected, 'lazy panel result');
  }
  async function inert(mode, path, reload) {
    const page = await newPage(mode);
    const before = state.log.length;
    // The tripwire can deliberately reload before Firefox's first load event.
    // Commit the initial navigation, then observe the actual events and Documents.
    await page.goto(origin + path, { waitUntil: 'commit' });
    await until(() => events.get(page), value => value.length === (reload ? 2 : 1), 'skew event count');
    await page.waitForTimeout(300);
    assert.equal(navigation.get(page), reload ? 2 : 1, 'unexpected navigation loop');
    const details = events.get(page);
    for (const event of details) {
      assert.equal(event.page, 'injected-S'); assert.equal(event.bundle, deployments.S.manifest.build);
    }
    assert.equal(details[0].reload, mode === 'blocked' ? false : true);
    if (reload) assert.equal(details[1].reload, false);
    if (path === '/') {
      assert.equal(await page.locator('[data-forma-status="skew"]').count(), 1);
      assert.equal(await text(page, '#count'), '7');
      await page.click('#increment'); assert.equal(await text(page, '#count'), '7');
      assert.equal(await page.locator('[data-forma-status="active"]').count(), 0);
    } else assert.equal(await page.locator('#app').innerHTML(), '');
    assert.equal(state.log.slice(before).filter(row => row.pathname === path).length, reload ? 2 : 1);
    // A third real Document must still be refused without another automatic reload.
    if (reload) {
      await page.reload({ waitUntil: 'commit' }); await until(() => events.get(page).length, value => value === 3, 'third Document event');
      await page.waitForTimeout(200); assert.equal(navigation.get(page), 3); assert.equal(events.get(page)[2].reload, false);
    }
    await page.close();
  }
  try {
    const first = await newPage(); await active(first, 'A'); await panel(first, 1, 'A:panel-1'); mark(0);
    state.deployed = 'B';
    const second = await newPage(); await active(second, 'B');
    const bPanel2 = '/_assets/' + deployments.B.manifest.aliases['panel-2.js'];
    state.choose = ({ pathname }) => pathname === bPanel2 ? 'A' : 'B';
    await panel(second, 2, 'retry:2');
    assert.ok(state.log.some(row => row.pathname === bPanel2 && row.instance === 'A' && row.status === 404));
    state.choose = undefined; await panel(second, 2, 'B:panel-2'); mark(1);

    await panel(first, 2, 'A:panel-2');
    const aPanel2 = deployments.A.manifest.aliases['panel-2.js'];
    assert.equal(deployments.B.manifest.assets[aPanel2].retained, true);
    const retained = await fetch(origin + '/_assets/' + aPanel2);
    assert.equal(retained.status, 200); assert.match(retained.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await retained.arrayBuffer()), readFileSync(join(deployments.A.dist, aPanel2))); mark(2);

    state.deployed = 'A'; await panel(second, 3, 'retry:3');
    const third = await newPage(); await active(third, 'A'); mark(3);
    state.deployed = 'B2';
    assert.deepEqual(deployments.B2.tree, deployments.B.tree);
    await panel(second, 3, 'B:panel-3'); assert.equal(navigation.get(second), 1); mark(4);

    state.deployed = 'C'; await panel(first, 4, 'retry:4'); await panel(second, 4, 'B:panel-4');
    const aPanel4 = deployments.A.manifest.aliases['panel-4.js'], bPanel4 = deployments.B.manifest.aliases['panel-4.js'];
    assert.equal(deployments.C.manifest.assets[aPanel4], undefined);
    assert.equal(deployments.C.manifest.assets[bPanel4].retained, true);
    assert.ok(state.log.some(row => row.pathname === '/_assets/' + aPanel4 && row.instance === 'C' && row.status === 404)); mark(5);

    state.deployed = 'S'; await panel(second, 5, 'retry:5');
    assert.deepEqual(Object.values(deployments.S.manifest.assets).filter(asset => asset.retained), []);
    const revoked = await fetch(origin + '/_assets/' + deployments.B.manifest.aliases['panel-5.js']); assert.equal(revoked.status, 404);
    for (const page of [first, second, third]) { assert.deepEqual(events.get(page), []); assert.equal(navigation.get(page), 1); }
    mark(6);
    state.fault = 'mismatch'; await inert('normal', '/', true); mark(7);
    await inert('blocked', '/', false); await inert('cancel', '/', false); mark(8);
    state.fault = 'absent'; const older = await newPage(); await active(older, 'S'); mark(9);
    state.fault = undefined; const browserPage = await newPage(); await active(browserPage, 'S', '/csr');
    state.fault = 'mismatch'; await inert('normal', '/csr', true); await inert('blocked', '/csr', false); await inert('cancel', '/csr', false); mark(10);
    assert.deepEqual(checks, SKEW_DRILL_CHECKS);
    for (const failures of errors.values()) assert.deepEqual(failures, [], 'unexpected page error during the drill');
    return { checks, builds: Object.fromEntries(Object.entries(deployments).map(([name, item]) => [name, item.manifest.build])), requests: state.log };
  } catch (error) {
    writeFileSync(process.env.FORMA_SKEW_DIAGNOSTIC, JSON.stringify({ checks, requests: state.log, pages: [...events].map(([page, detail]) => ({ url: page.url(), events: detail, navigations: navigation.get(page), errors: errors.get(page) })) }, null, 2));
    error.message += `\nCompleted drill checks: ${JSON.stringify(checks)}\nLast requests: ${JSON.stringify(state.log.slice(-15))}`;
    throw error;
  } finally {
    // A browser timeout must not prevent termination of the owned native server.
    await Promise.allSettled([context.close(), proxy.close(), native.close()]);
  }
}
