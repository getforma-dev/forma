// The suite end to end over real corpus modules: the typed server path, the server's own document
// in Chromium, the production browser entry's activation (P2), core's render (P1), the expected
// list. Seeded server changes stand in for walker regressions, as in render-both.test.mts.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from '@playwright/test';
import { renderBothReports } from '../src/render-both.mts';
import { passed, runSuite, structuralClasses, summaryText } from '../src/run.mts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const both = (index: number, alterServerHtml?: (html: string) => string, lowLevel = false) =>
  renderBothReports({ module: 'nested-islands', index, seed: 'forma-183', engine: 'chromium', browser, lowLevel, ...(alterServerHtml ? { alterServerHtml } : {}) });

test('the suite over two modules: P1 and P2 at generated states of an island page, P1 of a static page, the verdict', async () => {
  // Modules that agree by design, so this harness test does not move with a finding's fix; the
  // expected list's own behaviour is tested in expected.test.mts and by the next test.
  const result = await runSuite({ seed: 'forma-183', states: 3, modules: ['nested-islands', 'create-show'], engine: 'chromium', expected: [] });
  assert.equal(result.modules, 2);
  assert.equal(result.states, 4, 'three generated states for the declared page, the one source state of the other');
  const p1 = result.reports.filter(report => report.check === 'P1');
  const p2 = result.reports.filter(report => report.check === 'P2');
  assert.deepEqual(p1.map(report => `${report.module}#${report.index} ${report.verdict}`),
    ['create-show#0 equal', 'nested-islands#0 equal', 'nested-islands#1 equal', 'nested-islands#2 equal'], 'corpus order, then state order');
  assert.deepEqual(p2.map(report => `${report.module}#${report.index}`), ['nested-islands#0', 'nested-islands#1', 'nested-islands#2']);
  for (const report of p2) {
    assert.equal(report.verdict, 'equal', JSON.stringify(report.differences));
    assert.deepEqual(report.activation, { hosts: 3, activated: 3 });
  }
  assert.deepEqual(p1.slice(1).map(report => report.state), [
    { panelClass: '', badgeTitle: '' }, { panelClass: 'a', badgeTitle: 'a' },
    { panelClass: 'abcdefghijklmnopqrstuvwxyz'.repeat(79).slice(0, 2048), badgeTitle: 'abcdefghijklmnopqrstuvwxyz'.repeat(79).slice(0, 2048) },
  ], 'the first three string edges, in order');
  assert.ok(result.reports.every(report => report.serverPath === 'typed'));
  assert.deepEqual(structuralClasses(result.reports), []);
  assert.ok(passed(result));
  const text = summaryText(result);
  assert.match(text, /parity: 2 modules, 4 states/);
  assert.match(text, /P1: equal 4, different 0/);
  assert.match(text, /P2: equal 3, different 0/);
  assert.match(text, /structural classes: 0/);
  assert.match(text, /wall time \d+\.\ds \(prepare/);
  assert.match(text, /parity: PASS/);
});

test('an expected divergence that no longer occurs fails the run as an unexpected pass', async () => {
  const gone = { module: 'create-show', index: 0, check: 'P1' as const, kind: 'text' as const, ticket: 'FORMA-182', note: 'a divergence a fix has since removed' };
  const result = await runSuite({ seed: 'forma-183', states: 1, modules: ['create-show'], engine: 'chromium', expected: [gone] });
  assert.equal(result.reports[0]!.verdict, 'equal');
  assert.deepEqual(result.unexpectedPasses, [gone]);
  assert.equal(passed(result), false);
  assert.match(summaryText(result), /UNEXPECTED PASS P1 create-show#0 text \[FORMA-182\]: the divergence is gone; remove the entry/);
});

test('P2: a server text changed inside an island is refused by adoption: the status write, forma:error with its code, the console error', async () => {
  const [p1, p2] = await both(3, html => html.replace('<!--f:t1-->beta<!--/f:t1-->', '<!--f:t1-->gamma<!--/f:t1-->'));
  assert.equal(p1!.verdict, 'different');
  assert.equal(p2!.check, 'P2');
  assert.equal(p2!.verdict, 'different');
  assert.deepEqual(p2!.first, { kind: 'mutation', path: 'root > main[node 1] > div[node 2] > span[node 3][data-forma-status]', server: 'pending', client: 'error' });
  assert.ok(p2!.differences.some(d => d.kind === 'activation-error' && /forma:error .*"code":"FORMA_E_HYDRATE_VALUE"/.test(d.client ?? '')), JSON.stringify(p2!.differences));
  assert.ok(p2!.differences.some(d => d.kind === 'activation-error' && /\[forma\] FORMA_E_HYDRATE_VALUE \(island "InnerBadge"/.test(d.client ?? '')));
  assert.deepEqual(p2!.activation, { hosts: 3, activated: 2 });
});

test('P2: an island whose digest is not the compiled one is refused, not adopted', async () => {
  const [p1, p2] = await both(3, html => html.replace('data-forma-h="b601bd7955f69501" title', 'data-forma-h="0000000000000000" title'));
  assert.equal(p1!.verdict, 'equal', 'the digest is transport: P1 does not see it');
  assert.equal(p2!.verdict, 'different');
  assert.ok(p2!.differences.some(d => d.kind === 'activation-error' && /FORMA_E_ISLAND_IDENTITY/.test(d.client ?? '')), JSON.stringify(p2!.differences));
});

test('the low-level path (the walker alone, the harness document) renders the same state and agrees on P1 and P2', async () => {
  const [p1, p2] = await both(3, undefined, true);
  assert.equal(p1!.serverPath, 'low-level');
  assert.equal(p1!.verdict, 'equal');
  assert.equal(p2!.verdict, 'equal');
  assert.deepEqual(p2!.activation, { hosts: 3, activated: 3 });
});
