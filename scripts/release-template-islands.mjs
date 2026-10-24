// Packed-template observations. The browser runs the actual served candidate;
// these helpers neither replace source nor synthesize an activation registry.
import assert from 'node:assert/strict';
import {awaitPageModules} from './release-module-completion.mjs';

function policy(response) {
  assert(response, 'template navigation has no response');
  assert.equal(response.status(), 200, 'template page did not render');
  return response.allHeaders().then(headers => {
    assert.equal(headers['cache-control'], 'no-store', 'template response is cacheable');
    const csp = headers['content-security-policy'] ?? '';
    assert.match(csp, /(?:^|;)\s*require-trusted-types-for\s+'script'(?:;|$)/);
    assert.match(csp, /(?:^|;)\s*trusted-types\s+forma\s+forma-runtime(?:;|$)/);
    return csp;
  });
}
// A bounded page timeline (FORMA-252): navigation, network and error events in milliseconds from
// page creation. A failing observation carries it as `error.formaTimeline`; the message is left
// as it is, so callers that match messages are unaffected. It tells a navigation that never left
// the browser from a request the server never answered.
function pageTimeline(page) {
  const started = performance.now(), timeline = [];
  // `entry` may be a function, so callers build text only when a timeline is kept; a note never throws.
  const note = entry => {
    if (timeline.length >= 150) return;
    let text;
    try { text = typeof entry === 'function' ? entry() : entry; } catch (error) { text = `(note failed: ${error?.message ?? error})`; }
    timeline.push(`+${Math.round(performance.now() - started)}ms ${String(text).slice(0, 300)}`);
  };
  page.on('request', request => note(`request ${request.method()} ${request.resourceType()} ${request.url()}`));
  page.on('response', response => note(`response ${response.status()} ${response.url()}`));
  page.on('requestfailed', request => note(`requestfailed ${request.failure()?.errorText ?? ''} ${request.url()}`));
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) note(`navigated ${frame.url()}`); });
  page.on('domcontentloaded', () => note('domcontentloaded'));
  page.on('load', () => note('load'));
  page.on('crash', () => note('page crashed'));
  return { timeline, note };
}
function withTimeline(error, observed) {
  if (error !== null && typeof error === 'object' && !Object.hasOwn(error, 'formaTimeline')) {
    Object.defineProperty(error, 'formaTimeline', { value: [...observed.timeline], enumerable: false, configurable: true });
  }
  return error;
}
async function observe(context, timeout = 15_000) {
  const page = await context.newPage(), errors = [], requests = [], workers = [];
  const { timeline, note } = pageTimeline(page);
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => { errors.push(error.message); note(`pageerror ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); note(`console error ${message.text()}`); } });
  page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
  context.on('serviceworker', worker => workers.push(worker.url()));
  await page.addInitScript(() => {
    globalThis.__formaTemplateViolations = [];
    // Keep parser-time executable inventory too: an inline script must not hide
    // an early write by removing itself before the held entry is released.
    const seen = new Set();
    const record = node => {
      if (node.nodeType !== 1) return;
      if (node.matches('script')) seen.add(node);
      for (const script of node.querySelectorAll('script')) seen.add(script);
    };
    const inventory = new MutationObserver(records => {
      for (const change of records) for (const node of change.addedNodes) record(node);
    });
    inventory.observe(document, {subtree:true,childList:true});
    globalThis.__formaTemplateScriptInventory = {seen,inventory,record};
    document.addEventListener('securitypolicyviolation', event => {
      globalThis.__formaTemplateViolations.push({ directive: event.effectiveDirective, disposition: event.disposition, uri: event.blockedURI });
    });
  });
  return { page, errors, requests, workers, timeline, note };
}
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => queueMicrotask(resolve))));
}
async function noErrors(observed) {
  const violations = await observed.page.evaluate(() => globalThis.__formaTemplateViolations);
  assert.deepEqual(violations, [], 'template produced a CSP violation');
  assert.deepEqual(observed.errors, [], 'template produced a browser error');
  return violations;
}

async function requireExecutableInventory(page, entryURL = null) {
  await page.evaluate(expected => {
    const inventory = globalThis.__formaTemplateScriptInventory;
    for (const change of inventory.inventory.takeRecords()) for (const node of change.addedNodes) inventory.record(node);
    inventory.inventory.disconnect();
    const executable = script => script.type !== 'application/json';
    const current = [...document.querySelectorAll('script')].filter(executable);
    const observed = [...inventory.seen].filter(executable);
    if (expected === null) {
      if (current.length || observed.length) throw new Error('static executable inventory is not empty');
    } else if (current.length !== 1 || observed.length !== 1 || current[0] !== observed[0]
      || current[0].type !== 'module' || current[0].src !== expected || current[0].textContent.trim()) {
      throw new Error('executable inventory is not exactly the held manifest module');
    }
  }, entryURL);
}

/** Hold the actual entry before execution, then observe the complete adoption. */
export async function verifyMinimalIsland(browser, origin, manifest, expectedCount = 7, { timeout = 15_000 } = {}) {
  assert.equal(manifest.routes['/']?.mode, 'ssr');
  assert.equal(manifest.routes['/'].js.length, 1, 'minimal must publish its actual island entry');
  const entry = new URL(`/_assets/${manifest.routes['/'].js[0]}`, origin).href;
  const context = await browser.newContext(), observed = await observe(context, timeout), { page } = observed;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let requested = false;
  try {
    await page.route(entry, async route => { requested = true; observed.note('module entry held'); await held; await route.continue(); });
    observed.note(`goto ${origin} (waitUntil commit, timeout ${timeout} ms)`);
    const response = await page.goto(origin, { waitUntil: 'commit' });
    observed.note(`goto committed ${response?.status()}`);
    const csp = await policy(response);
    // A module waits for parsing. Interactive means the parser finished while
    // the intercepted module is still unable to execute (DOMContentLoaded waits).
    await page.waitForFunction(() => document.readyState !== 'loading');
    assert(requested, 'actual minimal module was not requested before observation');
    assert.deepEqual(observed.requests.filter(request => request.type === 'script').map(request => request.url), [entry], 'an additional executable script was requested before observation');
    await requireExecutableInventory(page, entry);
    const before = await page.evaluate(count => {
      const host = document.querySelector('[data-forma-island][data-forma-component="Counter"]');
      const blocks = document.querySelectorAll('script[data-island-state]');
      if (!host || blocks.length !== 1) throw new Error('missing original Counter host/state');
      const state = JSON.parse(blocks[0].textContent);
      const occurrence = host.getAttribute('data-forma-state');
      if (!/^(0|[1-9][0-9]*)$/.test(occurrence ?? '')) throw new Error('invalid original Counter occurrence');
      const index = Number(occurrence);
      const entry = state.i[index];
      if (!entry || entry.p.count !== count) throw new Error('handler value is missing from original Counter state');
      const text = host.querySelector('.count span')?.textContent;
      if (text !== String(count)) throw new Error('handler value is missing from original Counter HTML');
      const nodes = [...document.querySelectorAll('*')];
      const records = [];
      const observer = new MutationObserver(batch => records.push(...batch));
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      globalThis.__formaTemplateAdoption = { nodes, host, observer, records };
      return { count: entry.p.count, hash: entry.h, nodes: nodes.length };
    }, expectedCount);
    release(); observed.note('module entry released');
    await awaitPageModules(page, [entry], timeout);
    const adoption = await page.evaluate(() => {
      const check = globalThis.__formaTemplateAdoption;
      check.records.push(...check.observer.takeRecords()); check.observer.disconnect();
      const nodes = [...document.querySelectorAll('*')];
      return {
        mutations: check.records.map(record => ({ type: record.type, attribute: record.attributeName, target: record.target.nodeName })),
        sameNodes: check.nodes.length === nodes.length && check.nodes.every((node, index) => node === nodes[index]),
        sameHost: check.host === document.querySelector('[data-forma-island][data-forma-component="Counter"]'),
        count: check.host.querySelector('.count span')?.textContent,
      };
    });
    assert.deepEqual(adoption.mutations, [], 'successful Counter adoption wrote to the DOM');
    assert.equal(adoption.sameNodes, true, 'Counter activation replaced original page nodes');
    assert.equal(adoption.sameHost, true, 'Counter activation replaced its original host');
    assert.equal(adoption.count, String(expectedCount), 'Counter activation lost the handler value');
    // This also proves activation really happened: an inert or missing listener
    // cannot satisfy the three distinct updates after the zero-write observation.
    for (const [button, count] of [['Increment', expectedCount + 1], ['Reset', 0], ['Increment', 1]]) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await page.waitForFunction(value => document.querySelector('.count span')?.textContent === String(value), count);
    }
    const violations = await noErrors(observed);
    assert.deepEqual(observed.workers, [], 'minimal template registered a worker');
    return { before, adoption, transitions: [expectedCount, expectedCount + 1, 0, 1], servedPolicy: csp,
      errors: observed.errors, violations, workers: observed.workers };
  } catch (error) { throw withTimeline(error, observed); }
  finally { release(); await context.close(); }
}

/** A fresh context must obtain static markup and CSS without executing code. */
export async function verifyStaticTemplate(browser, origin, manifest, route = '/about', { staticHtml = 'plain-v1' } = {}) {
  assert(['plain-v1', 'legacy-v1'].includes(staticHtml), 'unknown static HTML contract');
  const owner = manifest.routes[route];
  assert.equal(owner?.mode, 'ssr'); assert.deepEqual(owner.js, []);
  assert(owner.ir, 'static route lost its native module'); assert(owner.css.length > 0, 'static route lost its stylesheet');
  assert.equal(owner.modulepreload?.length ?? 0, 0, 'static route advertises module preload');
  const context = await browser.newContext(), observed = await observe(context), { page } = observed;
  try {
    observed.note(`goto ${new URL(route, origin).href} (waitUntil networkidle)`);
    const response = await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle' });
    const csp = await policy(response); await settle(page);
    await requireExecutableInventory(page);
    assert.equal(await page.locator('h1').textContent(), 'About this app');
    assert.equal(await page.locator('link[rel="stylesheet"]').count(), owner.css.length);
    assert.equal(await page.locator('script[src],script:not([type="application/json"]),link[rel="modulepreload"]').count(), 0, 'static route contains executable or preloaded code');
    const blocks = page.locator('script[data-island-state][type="application/json"]');
    // The authenticated release-set chooses the wire shape. Published 3.0
    // retains its empty envelope; current candidates must omit all vocabulary.
    const blockCount = await blocks.count();
    assert.equal(blockCount, staticHtml === 'plain-v1' ? 0 : 1, `${staticHtml}: unexpected static state envelope count`);
    if (staticHtml === 'legacy-v1') {
      assert.deepEqual(JSON.parse(await blocks.textContent()), { v: 1, s: [], i: [] });
    } else {
      assert.equal(await page.locator('[data-forma-ssr], [data-forma-build], [data-forma-key], [data-forma-island]').count(), 0, 'plain static route carries adoption attributes');
      assert.equal(await page.evaluate(() => {
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
        for (let comment; (comment = walker.nextNode());) if (/^\/?f:[tsli]\d+$/.test(comment.data)) return true;
        return false;
      }), false, 'plain static route carries adoption comments');
    }
    const code = observed.requests.filter(request => ['script', 'worker', 'sharedworker', 'serviceworker'].includes(request.type));
    assert.deepEqual(code, [], 'static navigation requested executable code');
    assert.deepEqual(observed.workers, [], 'static navigation registered a worker');
    const violations = await noErrors(observed);
    return { route, requests: observed.requests, workers: observed.workers, executableScripts: 0, modulepreloads: 0,
      errors: observed.errors, violations, servedPolicy: csp };
  } catch (error) { throw withTimeline(error, observed); }
  finally { await context.close(); }
}

/** The same Browser-template positive interaction used by P17 and RC stress. */
export async function interactDashboard(page, { violationKey = '__formaTemplateViolations', note = () => {} } = {}) {
  const collectViolations = async () => {
    // Native CSP events are queued. Read the caller's navigation-time collector
    // before reload replaces the document and its init-script-owned array.
    const violations = await page.evaluate(key => new Promise(resolve => setTimeout(() => resolve(globalThis[key]), 100)), violationKey);
    assert(Array.isArray(violations), 'dashboard CSP collector was not installed before navigation');
    assert.deepEqual(violations, [], 'dashboard interaction produced a CSP violation');
    return violations;
  };
  const endpoint = '**/api/request-volume';
  const original = await page.request.get(new URL('/api/request-volume', page.url()).href);
  assert.equal(original.status(), 200);
  const points = await original.json();
  assert(points.length >= 2, 'dashboard chart needs its actual request-volume points');
  const hover = async (point, last = false) => {
    const chart = page.locator('svg[viewBox="0 0 600 200"]');
    note(() => `hover ${last ? 'last' : 'first'} point ${String(JSON.stringify(point?.hour)).slice(0, 60)}: waiting for the chart`);
    await chart.waitFor({ state: 'visible' });
    note('chart visible; measuring its box');
    const box = await chart.boundingBox(); assert(box);
    note('chart measured; hovering');
    await chart.hover({ position: { x: box.width * (last ? 560 : 40) / 600, y: box.height / 2 } });
    const tooltip = chart.locator('..').locator('div.pointer-events-none');
    await tooltip.waitFor({ state: 'visible' });
    note('tooltip visible');
    await tooltip.getByText(point.hour, { exact: true }).waitFor();
    const values = await tooltip.locator('span.font-mono').allTextContents();
    // Match the browser's locale rather than the Node host's locale.
    const expected = await page.evaluate(p => [p.success.toLocaleString(), p.error.toLocaleString()], point);
    assert.deepEqual(values, expected, 'dashboard hover values differ');
    assert.equal(await tooltip.locator('img, script, [data-forma-tooltip-probe]').count(), 0, 'tooltip parsed API text as markup');
    await page.mouse.move(0, 0);
    await tooltip.waitFor({ state: 'hidden' });
    return { hour: point.hour, values, hiddenOnLeave: true };
  };
  const normal = [await hover(points[0]), await hover(points.at(-1), true)];
  const normalViolations = await collectViolations();
  const hostile = { hour: '<img data-forma-tooltip-probe src="/__forma_tooltip_probe__" onerror="globalThis.__formaTooltipExecuted=true">', success: 1234, error: 7 };
  let intercepted = 0;
  const handler = async route => { intercepted++; await route.fulfill({ json: [hostile, { hour: 'safe second point', success: 42, error: 2 }] }); };
  await page.route(endpoint, handler);
  let hostileObservation;
  try {
    note('reload with the hostile chart payload');
    await policy(await page.reload({ waitUntil: 'networkidle' }));
    hostileObservation = await hover(hostile);
    assert.equal(intercepted, 1, 'hostile chart payload did not reach the real API consumer exactly once');
    assert.equal(await page.evaluate(() => globalThis.__formaTooltipExecuted), undefined, 'tooltip executed API text');
  } finally { await page.unroute(endpoint, handler); }
  await page.getByRole('button', { name: /^Deployments(?:\s|$)/ }).click();
  await page.locator('h1').filter({ hasText: 'Deployments' }).waitFor();
  const hostileViolations = await collectViolations();
  return { normal, hostile: hostileObservation, apiTextStayedText: true,
    violations: { normal: normalViolations, hostile: hostileViolations } };
}
export async function verifyDashboardTemplate(browser, origin) {
  const context = await browser.newContext(), observed = await observe(context);
  try {
    observed.note(`goto ${origin} (waitUntil networkidle, timeout 20000 ms)`);
    const csp = await policy(await observed.page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 }));
    const tooltip = await interactDashboard(observed.page, { note: observed.note });
    assert.equal(await observed.page.locator('[data-forma-status="pending"], [data-forma-status="hydrating"], [data-forma-status="error"]').count(), 0, 'dashboard did not activate');
    await settle(observed.page); await noErrors(observed);
    return { interacted: true, tooltip, csp, pageErrors: observed.errors, violations: [] };
  } catch (error) { throw withTimeline(error, observed); }
  finally { await context.close(); }
}
