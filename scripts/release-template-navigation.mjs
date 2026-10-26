// Exercise the actual packed starter and public router; no injected registry or
// synthetic owner adapters. Shared by source scaffold and packed P17 gates.
import assert from 'node:assert/strict';
import { awaitPageModules } from './release-module-completion.mjs';

export async function verifyNativeRouterTemplate(browser, origin, manifest, { timeout = 15_000 } = {}) {
  const routes = ['/_layout', '/', '/about'];
  assert.deepEqual(routes.map(route => manifest.routes[route]?.navigation?.owner), ['shell', 'home', 'about']);
  for (const route of routes) {
    assert.equal(manifest.routes[route].navigation.group, 'main');
    assert.equal(manifest.routes[route].mode, 'ssr');
    assert.equal(manifest.routes[route].js.length, 1);
    assert.deepEqual(manifest.routes[route].js, manifest.routes['/'].js);
  }
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [], scripts = [], navigationResponses = [];
  let violations;
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  page.on('response', response => {
    if (response.headers()['content-type']?.startsWith('application/vnd.forma.navigation+json')) navigationResponses.push(response.status());
  });
  await page.addInitScript(() => {
    globalThis.__navigationViolations = [];
    document.addEventListener('securitypolicyviolation', event => globalThis.__navigationViolations.push(event.effectiveDirective));
  });
  try {
    const response = await page.goto(origin);
    assert.equal(response.status(), 200);
    const headers = await response.allHeaders();
    assert.equal(headers['cache-control'], 'no-store');
    assert.match(headers['content-security-policy'], /require-trusted-types-for 'script'/);
    await awaitPageModules(page, manifest.routes['/'].js.map(file => new URL(`/_assets/${file}`, origin).href), timeout);
    assert.equal(await page.locator('#home-count').textContent(), '7');
    await page.locator('#layout-increment').click();
    await page.waitForFunction(() => document.querySelector('#layout-count')?.textContent === '1');
    await page.locator('#home-increment').click();
    await page.locator('#layout-note').fill('retained layout');
    await page.evaluate(() => { globalThis.__layoutNode = document.querySelector('#layout-count'); globalThis.__leafNode = document.querySelector('main'); });
    const loadedScripts = [...scripts];
    await page.locator('nav a[href="/about"]').click();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'About');
    assert.equal(new URL(page.url()).pathname, '/about');
    assert.equal(await page.evaluate(() => globalThis.__layoutNode === document.querySelector('#layout-count')), true, 'layout was replaced or document reloaded');
    assert.equal(await page.locator('#layout-count').textContent(), '1');
    assert.equal(await page.locator('#layout-note').inputValue(), 'retained layout');
    assert.equal(await page.evaluate(() => globalThis.__leafNode.isConnected), false, 'old leaf remains connected');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Home');
    assert.equal(await page.locator('#home-count').textContent(), '7', 'removed home owner did not reset');
    assert.equal(await page.evaluate(() => globalThis.__layoutNode === document.querySelector('#layout-count')), true);
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'About');
    assert.equal(await page.locator('#layout-count').textContent(), '1');
    assert.deepEqual(scripts, loadedScripts, 'navigation fetched executable code');
    assert.equal(navigationResponses.length, 3, 'click/back/forward must use typed responses');
    assert.deepEqual(navigationResponses, [200, 200, 200]);
    violations = await page.evaluate(() => globalThis.__navigationViolations);
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  const plain = await browser.newContext({ javaScriptEnabled: false }), nojs = await plain.newPage();
  try {
    await nojs.goto(new URL('/about', origin).href);
    assert.equal(await nojs.locator('h1').textContent(), 'About');
    await nojs.locator('nav a[href="/"]').click();
    assert.equal(await nojs.locator('h1').textContent(), 'Home');
    assert.equal(await nojs.locator('#home-count').textContent(), '7');
  } finally { await plain.close(); }
  return validateNativeRouterTemplateProof({ typedNavigations: navigationResponses.length, navigationResponses, scripts: scripts.length,
    persistentLayout: true, removedLeafReset: true, noNewScripts: true, noJavaScript: true, errors, violations });
}

/** Validate retained outcomes independently when authenticating burn-in files. */
export function validateNativeRouterTemplateProof(proof) {
  assert.equal(proof?.typedNavigations, 3, 'native starter must complete link/back/forward');
  assert.deepEqual(proof.navigationResponses, [200, 200, 200], 'native starter typed responses differ');
  assert(Number.isSafeInteger(proof.scripts) && proof.scripts > 0, 'native starter bootstrap was not observed');
  for (const name of ['persistentLayout', 'removedLeafReset', 'noNewScripts', 'noJavaScript'])
    assert.equal(proof[name], true, `native starter ${name} failed`);
  assert.deepEqual(proof.errors, [], 'native starter browser errors');
  assert.deepEqual(proof.violations, [], 'native starter policy violations');
  return proof;
}
