// Packed-template observations. The browser runs the actual served candidate;
// these helpers neither replace source nor synthesize an activation registry.
import assert from 'node:assert/strict';

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
async function observe(context, timeout = 15_000) {
  const page = await context.newPage(), errors = [], requests = [], workers = [];
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
  context.on('serviceworker', worker => workers.push(worker.url()));
  await page.addInitScript(() => {
    globalThis.__formaTemplateViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      globalThis.__formaTemplateViolations.push({ directive: event.effectiveDirective, disposition: event.disposition, uri: event.blockedURI });
    });
  });
  return { page, errors, requests, workers };
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
    await page.route(entry, async route => { requested = true; await held; await route.continue(); });
    const response = await page.goto(origin, { waitUntil: 'commit' });
    const csp = await policy(response);
    // A module waits for parsing. Interactive means the parser finished while
    // the intercepted module is still unable to execute (DOMContentLoaded waits).
    await page.waitForFunction(() => document.readyState !== 'loading');
    assert(requested, 'actual minimal module was not requested before observation');
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
    release();
    await settle(page);
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
  } finally { release(); await context.close(); }
}

/** A fresh context must obtain static markup and CSS without executing code. */
export async function verifyStaticTemplate(browser, origin, manifest, route = '/about') {
  const owner = manifest.routes[route];
  assert.equal(owner?.mode, 'ssr'); assert.deepEqual(owner.js, []);
  assert(owner.ir, 'static route lost its native module'); assert(owner.css.length > 0, 'static route lost its stylesheet');
  assert.equal(owner.modulepreload?.length ?? 0, 0, 'static route advertises module preload');
  const context = await browser.newContext(), observed = await observe(context), { page } = observed;
  try {
    const response = await page.goto(new URL(route, origin).href, { waitUntil: 'networkidle' });
    const csp = await policy(response); await settle(page);
    assert.equal(await page.locator('h1').textContent(), 'About this app');
    assert.equal(await page.locator('link[rel="stylesheet"]').count(), owner.css.length);
    assert.equal(await page.locator('script[src],script:not([type="application/json"]),link[rel="modulepreload"]').count(), 0, 'static route contains executable or preloaded code');
    const blocks = page.locator('script[data-island-state][type="application/json"]');
    assert.equal(await blocks.count(), 1, 'static route must retain its one inert state envelope');
    assert.deepEqual(JSON.parse(await blocks.textContent()), { v: 1, s: [], i: [] });
    const code = observed.requests.filter(request => ['script', 'worker', 'sharedworker', 'serviceworker'].includes(request.type));
    assert.deepEqual(code, [], 'static navigation requested executable code');
    assert.deepEqual(observed.workers, [], 'static navigation registered a worker');
    const violations = await noErrors(observed);
    return { route, requests: observed.requests, workers: observed.workers, executableScripts: 0, modulepreloads: 0,
      errors: observed.errors, violations, servedPolicy: csp };
  } finally { await context.close(); }
}
