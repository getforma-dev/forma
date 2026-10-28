import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, type Engine } from '../src/browser.mts';
import { check, prepare, readCorpus, statesFor, type CorpusEntry } from '../src/suite.mts';
import { renderTyped, REPO } from '../src/server.mts';
import { BOOT_FILE, synthesizeManifest } from '../src/manifest.mts';
import { CORE_URL, ENTRY_CORE_URL, ENTRY_CORE_SOURCE } from '../src/bundle.mts';
import type { Json } from '../src/generate.mts';

const engine = (process.env.FORMA_PARITY_BROWSER ?? 'chromium') as Engine;
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const entry = readCorpus(1).find(item => item.name === 'composition-canvas')!;
const fixtureStates = JSON.parse(readFileSync(join(REPO, entry.statesFile!), 'utf8')) as Json[];
const results: unknown[] = [];
function retain(value: unknown) {
  results.push(value);
  if (process.env.FORMA_CANVAS_REPORT) writeFileSync(process.env.FORMA_CANVAS_REPORT, `${JSON.stringify(results, null, 2)}\n`);
}

test('explicit resolved canvas states run completely and refuse an invalid selection', () => {
  const described = { schema: [[]], islands: [], slots: [], keys: [] };
  const selected = statesFor(described, entry, { seed: 'canvas', states: 1 });
  assert.deepEqual(selected.states, fixtureStates, 'a small generated-state count must not drop declared cases');
  assert.deepEqual(selected.indices, [0, 1, 2, 3]);
  assert.deepEqual(statesFor(described, entry, { seed: 'canvas', states: 100, indices: [2] }).states, [fixtureStates[2]]);
  assert.throws(() => statesFor(described, entry, { seed: 'canvas', states: 100, indices: [4] }), /outside its 4 explicit states/);
});

test(`${engine}: composition-canvas parity and zero-write adoption over every resolved state`, async () => {
  const plan = await prepare(entry, { seed: 'canvas', states: 100 });
  assert.equal(plan.failure, undefined);
  assert.deepEqual(plan.diagnostics, []);
  const browser = await launch(engine);
  try {
    const reports = await check([plan], { seed: 'canvas', states: 100, browser }, { prepare: 0, launch: 0, server: 0, browser: 0 });
    retain({ engine, kind: 'parity', reports });
    for (const kind of ['P1', 'P2']) {
      const cases = reports.filter(report => report.check === kind);
      assert.equal(cases.length, fixtureStates.length);
      for (const report of cases) {
        assert.equal(report.verdict, 'equal', JSON.stringify({ module: report.module, index: report.index, check: report.check, first: report.first, error: report.error }));
        assert.equal(report.serverPath, 'typed');
        if (kind === 'P2') assert.deepEqual(report.activation, { hosts: 1, activated: 1 });
      }
    }
    const altered = await check([{ ...plan, indices: [0], states: [fixtureStates[0]!] }], {
      seed: 'canvas', states: 1, browser,
      alterServerHtml: html => html.replace('data-selected data-forma-island=', 'data-selected="seeded-defect" data-forma-island='),
    }, { prepare: 0, launch: 0, server: 0, browser: 0 });
    retain({ engine, kind: 'seeded-wrong-attribute', reports: altered });
    assert.equal(altered.find(report => report.check === 'P1')!.verdict, 'different');
    assert.notEqual(altered.find(report => report.check === 'P2')!.verdict, 'equal');
  } finally { await browser.close(); }
});

const boot = `
const root = document.querySelector('[data-forma-ssr]');
const allNodes = () => { const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL); const out = [root]; while (walker.nextNode()) out.push(walker.currentNode); return out; };
const nodes = allNodes();
const records = [];
const observer = new MutationObserver(batch => records.push(...batch));
observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
const errors = [];
document.addEventListener('forma:error', event => errors.push(event.detail));
await import('/entry.mjs');
await (await import('${ENTRY_CORE_URL}')).waitForActivation();
await new Promise(resolve => setTimeout(resolve, 0));
records.push(...observer.takeRecords());
const initialWrites = records.length;
const rootIdentity = document.querySelector('[data-forma-ssr]') === root;
const after = allNodes();
const identities = nodes.length === after.length && nodes.every((node, index) => after[index] === node);
root.setAttribute('data-observer-control', 'seen');
const controlled = observer.takeRecords().some(record => record.attributeName === 'data-observer-control');
observer.disconnect();
root.removeAttribute('data-observer-control');
window.__canvas = { initialWrites, rootIdentity, identities, controlled, errors, nodes,
  activated: [...root.querySelectorAll('[data-forma-island]')].filter(host => typeof host.__formaDispose === 'function').length };
`;

test(`${engine}: real focus events retain nodes, label association and isolation through three transitions`, async () => {
  const sibling: CorpusEntry = {
    name: 'composition-two-canvases', step: 1, kind: 'islands',
    entry: 'packages/compiler/tests/fixtures/conformance/composition-canvas/two-canvases.tsx',
    page: { file: 'packages/compiler/tests/fixtures/conformance/composition-canvas/page.tsx', exportName: 'TwoCanvases', props: 'named' },
  };
  const plan = await prepare(sibling, { seed: 'canvas', states: 1 });
  assert.equal(plan.failure, undefined, plan.failure);
  const state = fixtureStates[0] as { cards: Json[] };
  // Secondary uses separate IDs, so HTML label associations remain unambiguous.
  const secondary = JSON.parse(JSON.stringify(state.cards).replaceAll('summary-', 'secondary-summary-').replaceAll('table-', 'secondary-table-').replaceAll('timeline-', 'secondary-timeline-').replaceAll('form-', 'secondary-form-'));
  const dir = mkdtempSync(join(tmpdir(), 'forma-canvas-browser-'));
  const browser = await launch(engine);
  try {
    const bootPath = join(dir, BOOT_FILE); writeFileSync(bootPath, boot);
    const manifest = synthesizeManifest({ app: sibling.name, irFile: 'home.ir', ir: readFileSync(plan.irPath), boot });
    const rendered = renderTyped([{ name: sibling.name, route: '/', manifest,
      files: { 'home.ir': plan.irPath, [BOOT_FILE]: bootPath }, states: [{ cards: state.cards, secondary }] }]);
    assert.deepEqual(rendered[0]!.bind, []);
    const response = rendered[0]!.renders[0]!;
    assert.ok('document' in response, JSON.stringify(response));
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('http://localhost/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: response.document, headers: { ...response.headers } });
      const scripts: Record<string, string> = {
        [`/_assets/${BOOT_FILE}`]: boot, '/entry.mjs': plan.script!, [ENTRY_CORE_URL]: ENTRY_CORE_SOURCE,
        [CORE_URL]: readFileSync(join(REPO, 'packages/core/dist/forma.esm.js'), 'utf8'),
      };
      if (path in scripts) return route.fulfill({ contentType: 'text/javascript', body: scripts[path] });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto('http://localhost/');
    await page.waitForFunction(() => (window as any).__canvas !== undefined);
    const initial = await page.evaluate(() => {
      const { nodes: _nodes, ...initial } = (window as any).__canvas;
      return { ...initial, labels: [...document.querySelectorAll('label')].map(label => !!label.control && label.control.id === label.htmlFor),
        states: document.querySelectorAll('[data-island-state]').length,
        svg: [...document.querySelectorAll('svg, svg rect, svg title')].every(rect => rect.namespaceURI === 'http://www.w3.org/2000/svg') };
    });
    retain({ engine, kind: 'interaction-initial', initial });
    assert.deepEqual({ ...initial, labels: initial.labels.every(Boolean) }, {
      initialWrites: 0, rootIdentity: true, identities: true, controlled: true, errors: [], activated: 2, labels: true, states: 1, svg: true,
    });
    assert.equal(initial.labels.length, 8);
    const canvases = page.locator('.canvas');
    for (const index of [0, 1, 2]) {
      await canvases.nth(0).locator('button[type="button"]').nth(index).click();
      assert.equal(await canvases.nth(0).getAttribute('data-selected'), ['summary-0', 'table-0', 'timeline-0'][index]);
      assert.equal(await canvases.nth(1).getAttribute('data-selected'), '');
      assert.equal(await page.evaluate(() => {
        const root = document.querySelector('[data-forma-ssr]')!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL), current: Node[] = [root];
        while (walker.nextNode()) current.push(walker.currentNode);
        const original = (window as any).__canvas.nodes as Node[];
        return original.length === current.length && original.every((node, i) => current[i] === node);
      }), true);
    }
    await canvases.nth(1).locator('button[type="button"]').first().click();
    assert.equal(await canvases.nth(1).getAttribute('data-selected'), 'secondary-summary-0');
    assert.equal(await canvases.nth(0).getAttribute('data-selected'), 'timeline-0');
    // WebKit reports the server's existing best-effort Trusted Types policy header
    // at document load, before the boot. Preserve and pin that exact compatibility
    // notice; every script error or additional console error still fails.
    const policyNotice = "The Content Security Policy 'require-trusted-types-for 'script'; trusted-types forma forma-runtime' was delivered in report-only mode, but does not specify a 'report-to'; the policy will have no effect. Please either add a 'report-to' directive, or deliver the policy via the 'Content-Security-Policy' header.";
    assert.deepEqual(errors, engine === 'webkit' ? [policyNotice] : []);
    retain({ engine, kind: 'interaction-final', first: 'timeline-0', second: 'secondary-summary-0', console: errors });
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
