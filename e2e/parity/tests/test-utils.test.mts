import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from '@playwright/test';
import { renderBoth } from '../src/test-utils.mts';
import { readCorpus } from '../src/suite.mts';
import { summarize } from '../src/compare.mts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const state = { panelClass: 'explicit <&> state', badgeTitle: 'FORMA-184 Ω' };

test('the component and exact supplied state produce equal native/core trees', async () => {
  const report = await renderBoth('nested-islands', state, { browser });
  assert.equal(report.verdict, 'equal', summarize(report));
  assert.equal(report.serverPath, 'typed');
  assert.deepEqual(report.state, state);
  assert.ok(report.server.tree && report.client.tree);
  assert.deepEqual(report.server.tree, report.client.tree);
  assert.match(report.server.html!, /class="explicit &lt;&amp;&gt; state"/);
  assert.match(report.server.html!, /title="FORMA-184 Ω"/);
  assert.ok(browser.isConnected(), 'the caller still owns its browser');
});

test('a source descriptor works without adding a named corpus entry', async () => {
  const entry = readCorpus().find(candidate => candidate.name === 'nested-islands')!;
  const report = await renderBoth({ ...entry, name: 'explicit-component' }, state, { browser });
  assert.equal(report.module, 'explicit-component');
  assert.equal(report.verdict, 'equal', summarize(report));
  assert.deepEqual(report.state, state);
});

test('a seeded native value error names the component, state and changed attribute', async () => {
  const report = await renderBoth('nested-islands', state, {
    browser,
    alterServerHtml: html => html.replace('title="FORMA-184 Ω"', 'title="wrong"'),
  });
  assert.equal(report.verdict, 'different');
  assert.equal(report.module, 'nested-islands');
  assert.deepEqual(report.state, state);
  assert.equal(report.count, 1);
  assert.equal(report.first?.kind, 'attribute-value');
  assert.match(report.first?.path ?? '', /\[title\]$/);
  assert.equal(report.first?.server, 'wrong');
  assert.equal(report.first?.client, state.badgeTitle);
});

test('invalid explicit state is a native refusal, never an empty successful comparison', async () => {
  const report = await renderBoth('nested-islands', { panelClass: 7, badgeTitle: 'title' }, { browser });
  assert.equal(report.verdict, 'server-refused');
  assert.ok(report.refusal?.code);
  assert.equal(report.server.tree, null);
});

test('unknown components fail by name before any browser is launched', async () => {
  await assert.rejects(renderBoth('missing-component', {}), /no module missing-component/);
});
