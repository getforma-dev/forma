// The served-page check shared by the source lane (apps.spec.ts) and P17
// (scripts/release-fixture-apps.mjs): the same file judges the working tree's servers and
// the packed set's. It takes a Playwright BrowserType's launched `browser`.
//
// Strict adoption (core ISLANDS.md, "Strict activation") makes no DOM write when it
// succeeds and leaves `data-forma-status="pending"`, so a page is not judged by that
// attribute. The check holds the island module before it runs, records what the server
// sent, releases the module, and requires that nothing changed (no mutation record, the
// same nodes), then drives the island and requires that it did change. An island that
// never activated cannot pass the second half; an adoption that rewrote the server's
// values cannot pass the first.
import assert from 'node:assert/strict';

/** The response policy every fixture page carries (DR-5/M20 enforced Trusted Types). */
export async function requirePolicy(response) {
  assert(response, 'navigation produced no response');
  assert.equal(response.status(), 200, 'the page did not render');
  const headers = await response.allHeaders();
  assert.equal(headers['cache-control'], 'no-store', 'the page response is cacheable');
  const csp = headers['content-security-policy'] ?? '';
  assert.match(csp, /(?:^|;)\s*require-trusted-types-for\s+'script'(?:;|$)/, 'Trusted Types are not required');
  assert.match(csp, /(?:^|;)\s*trusted-types\s+forma\s+forma-runtime(?:;|$)/, 'unexpected Trusted Types policies');
  return { csp, counts: headers['x-fixture-counts'] ?? null };
}

async function observe(context, timeout) {
  const page = await context.newPage(), errors = [], requests = [];
  page.setDefaultTimeout(timeout);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
  await page.addInitScript(() => {
    globalThis.__fixtureViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      globalThis.__fixtureViolations.push({ directive: event.effectiveDirective, disposition: event.disposition, uri: event.blockedURI });
    });
  });
  return { page, errors, requests };
}

/** The visible text of a node as the check compares it: comments are not text nodes' business. */
const textOf = (page, selector) => page.locator(selector).first().textContent();

/**
 * Hold the route's script(s), record what the server sent, release, require zero writes and
 * identical nodes, then run `interact`. Options:
 *   expected.serverValues  [{selector, text}]       exact textContent before and after adoption
 *   expected.state         {Component: [props...]}  the state envelope's occurrences, in order, per component
 *   expected.statePrefix   {Component: [props...]}  the same, for the first occurrences only (a page of a hundred)
 *   expected.hosts         {Component: count}       island hosts in the served HTML
 *   path                   the URL path to open when it is not the manifest route (a route pattern with a parameter)
 *   hold                   [urlSubstring]           requests the island makes at activation: they stay pending
 *                                                   until adoption is judged, and their arrival proves activation
 *   scriptBody             test only: answer the held scripts with this body, so no island can activate
 *   release                async (route) => void    how a held request is answered once released (default: continue)
 *   interact               async (page) => any      REQUIRED: behaviour that must change the DOM (activation proof)
 */
export async function verifyIslandPage(browser, origin, route, manifest, options = {}) {
  const { expected = {}, hold = [], interact, release: answer, timeout = 15_000, path = route, scriptBody } = options;
  // Nothing else proves the island module ran: the hosts are in the server's HTML whether or not
  // anything activated. A page without a behaviour that only a live island can satisfy is refused.
  assert.equal(typeof interact, 'function', `${route}: verifyIslandPage needs an interact behaviour that proves activation`);
  const declared = manifest.routes[route];
  assert.equal(declared?.mode, 'ssr', `${route}: not a server-rendered route`);
  assert(declared.js.length >= 1, `${route}: no island script to hold`);
  const scripts = declared.js.map(file => new URL(`/_assets/${file}`, origin).href);
  const context = await browser.newContext(), observed = await observe(context, timeout), { page } = observed;
  let open, openRequests;
  const gate = new Promise(resolve => { open = resolve; });
  const requestGate = new Promise(resolve => { openRequests = resolve; });
  const requestedScripts = new Set();
  const holds = hold.map(match => {
    let arrived;
    const seen = new Promise(resolve => { arrived = resolve; });
    return { match, seen, arrived };
  });
  try {
    for (const url of scripts) await page.route(url, async routed => { requestedScripts.add(url); await gate; if (scriptBody === undefined) await routed.continue(); else await routed.fulfill({ status: 200, contentType: 'text/javascript', body: scriptBody }); });
    for (const each of holds) {
      await page.route(url => url.pathname.includes(each.match), async routed => {
        each.arrived();
        await requestGate;
        if (answer) await answer(routed); else await routed.continue();
      });
    }
    const response = await page.goto(new URL(path, origin).href, { waitUntil: 'commit' });
    const served = await requirePolicy(response);
    await page.waitForFunction(() => document.readyState !== 'loading');
    assert.deepEqual([...requestedScripts].sort(), [...scripts].sort(), `${route}: the held scripts were not all requested before observation`);
    assert.deepEqual(observed.requests.filter(r => r.type === 'script').map(r => r.url).sort(), [...scripts].sort(), `${route}: another script ran before observation`);

    const before = await page.evaluate(async ({ values, hosts }) => {
      const out = { values: [], hosts: {}, blocks: 0 };
      for (const { selector } of values) out.values.push(document.querySelector(selector)?.textContent ?? null);
      for (const host of document.querySelectorAll('[data-forma-island]')) {
        const name = host.getAttribute('data-forma-component');
        out.hosts[name] = (out.hosts[name] ?? 0) + 1;
      }
      const blocks = document.querySelectorAll('script[data-island-state][type="application/json"]');
      out.blocks = blocks.length;
      out.state = blocks.length === 1 ? JSON.parse(blocks[0].textContent) : null;
      const nodes = [...document.querySelectorAll('*')];
      const records = [];
      const observer = new MutationObserver(batch => records.push(...batch));
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      globalThis.__fixtureAdoption = { nodes, observer, records };
      out.nodes = nodes.length;
      return out;
    }, { values: expected.serverValues ?? [], hosts: expected.hosts ?? {} });

    (expected.serverValues ?? []).forEach(({ selector, text }, index) => assert.equal(before.values[index], text, `${route}: ${selector} before activation`));
    if (expected.hosts) assert.deepEqual(before.hosts, expected.hosts, `${route}: island hosts in the served HTML`);
    assert.equal(before.blocks, 1, `${route}: exactly one inert state envelope`);
    assert(expected.state || expected.statePrefix, `${route}: the page names neither a state nor a statePrefix to compare with the envelope; a missing oracle is a failure, not a skip`);
    {
      const byComponent = {};
      const components = [...(await page.evaluate(() => [...document.querySelectorAll('[data-forma-island]')].map(h => [h.getAttribute('data-forma-component'), Number(h.getAttribute('data-forma-state'))])))];
      for (const [component, occurrence] of components) (byComponent[component] ??= []).push(before.state.i[occurrence].p);
      if (expected.state) assert.deepEqual(byComponent, expected.state, `${route}: the state envelope differs from the handler's values`);
      for (const [component, head] of Object.entries(expected.statePrefix ?? {})) {
        assert.deepEqual((byComponent[component] ?? []).slice(0, head.length), head, `${route}: the first ${component} occurrences differ from the handler's values`);
      }
    }

    open();
    // Activation is proven by the island's own first request when it makes one; otherwise by
    // the network going quiet. Then a frame and a microtask, so every synchronous write has landed.
    if (holds.length) await Promise.all(holds.map(each => each.seen));
    else await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => queueMicrotask(resolve))));

    const adoption = await page.evaluate(() => {
      const check = globalThis.__fixtureAdoption;
      check.records.push(...check.observer.takeRecords());
      const nodes = [...document.querySelectorAll('*')];
      return {
        mutations: check.records.map(r => ({ type: r.type, attribute: r.attributeName, target: r.target.nodeName })),
        sameNodes: check.nodes.length === nodes.length && check.nodes.every((node, index) => node === nodes[index]),
      };
    });
    assert.deepEqual(adoption.mutations, [], `${route}: successful adoption wrote to the DOM`);
    assert.equal(adoption.sameNodes, true, `${route}: activation replaced original nodes`);
    for (const { selector, text } of expected.serverValues ?? []) assert.equal(await textOf(page, selector), text, `${route}: ${selector} after activation`);

    // The positive control: the same observer sees a deliberate write, so an empty record
    // list above means no write happened, not that the observer was never watching.
    const control = await page.evaluate(() => {
      const check = globalThis.__fixtureAdoption;
      document.body.setAttribute('data-fixture-control', '1');
      const seen = check.observer.takeRecords().length;
      document.body.removeAttribute('data-fixture-control');
      check.observer.takeRecords();
      return seen;
    });
    assert.equal(control, 1, `${route}: the mutation observer did not see a deliberate write`);

    // Now the activation-time requests may complete, and the page's own writes begin.
    await page.evaluate(() => globalThis.__fixtureAdoption.observer.disconnect());
    openRequests();
    const interacted = interact ? await interact(page) : undefined;
    assert.equal(await page.locator('[data-forma-status="error"]').count(), 0, `${route}: an island ended in error`);
    const violations = await page.evaluate(() => globalThis.__fixtureViolations);
    assert.deepEqual(violations, [], `${route}: CSP violation`);
    assert.deepEqual(observed.errors, [], `${route}: browser error`);
    return { route, served, hosts: before.hosts, nodes: before.nodes, mutations: adoption.mutations.length, interacted };
  } finally { open(); openRequests(); await context.close(); }
}
