// renderBoth end to end: the real walker, core's dist in Chromium, the comparison. The two cases
// of the first slice's gate, and the ticket's acceptance test in harness form: a walker output
// with one attribute's text altered fails P1 naming the fixture, the state and the node.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from '@playwright/test';
import { summarize } from '../src/compare.mts';
import { readCorpus, renderBoth } from '../src/render-both.mts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const run = (module: string, index: number, alterServerHtml?: (html: string) => string) =>
  renderBoth({ module, index, seed: 'forma-183', engine: 'chromium', browser, ...(alterServerHtml ? { alterServerHtml } : {}) });

test('corpus.json names the fourteen js-emitter modules, each with an .ir and a page export', () => {
  const corpus = readCorpus();
  assert.equal(corpus.length, 14);
  assert.equal(new Set(corpus.map(entry => entry.name)).size, 14);
  for (const entry of corpus) {
    assert.match(entry.ir, new RegExp(`^crates/forma-ir/tests/fixtures/js-emitter/${entry.name}\\.ir$`));
    assert.match(entry.page.file, new RegExp(`^packages/compiler/tests/fixtures/ir-corpus/${entry.name}/`));
    assert.ok(['none', 'named', 'destructured'].includes(entry.page.props));
  }
  assert.deepEqual(corpus.filter(entry => entry.page.props !== 'none').map(entry => entry.name), ['nested-islands'], 'only nested-islands declares page props');
});

test('create-show#0: the walker and core agree on the source state', async () => {
  const report = await run('create-show', 0);
  assert.equal(report.verdict, 'equal', summarize(report));
  assert.equal(report.serverPath, 'low-level');
  assert.deepEqual(report.state, {});
  assert.ok(report.server.html && report.server.tree && report.client.tree);
  assert.equal(summarize(report), 'P1 create-show#0 equal');
});

test('nested-islands#3: a generated state (</script> in both declared strings) renders equal on both sides', async () => {
  const report = await run('nested-islands', 3);
  assert.deepEqual(report.state, { panelClass: '</script>', badgeTitle: '</script>' });
  assert.equal(report.verdict, 'equal', summarize(report));
  assert.ok(report.server.html?.includes('class="&lt;/script&gt;"'));
});

test('a walker output with one attribute\'s text altered fails P1 naming the fixture, the state and the node', async () => {
  const report = await run('nested-islands', 3, html => html.replace('title="&lt;/script&gt;"', 'title="&lt;/scripx&gt;"'));
  assert.equal(report.verdict, 'different');
  assert.equal(report.count, 1);
  assert.equal(report.structural, 0);
  assert.deepEqual(report.first, {
    kind: 'attribute-value',
    path: 'page > main:nth-child(1) > div:nth-child(1) > span:nth-child(2)[title]',
    server: '</scripx>',
    client: '</script>',
  });
  assert.equal(summarize(report),
    'P1 nested-islands#3 different: attribute-value at page > main:nth-child(1) > div:nth-child(1) > span:nth-child(2)[title] server="</scripx>" client="</script>" (1 difference, 0 structural)');
});

test('a walker output missing an element is a structural difference', async () => {
  const report = await run('nested-islands', 0, html => html.replace('<hr>', ''));
  assert.equal(report.verdict, 'different');
  assert.ok(report.structural > 0, summarize(report));
});
