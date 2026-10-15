// The suite end to end over real corpus modules: the typed server path, the server's own document
// in Chromium, the production browser entry's activation (P2), core's render (P1), the expected
// list. Seeded server changes stand in for walker regressions, as in render-both.test.mts.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from '@playwright/test';
import { renderBothReports } from '../src/render-both.mts';
import { passed, runSuite, serverPaths, structuralClasses, summaryText, type SuiteResult } from '../src/run.mts';
import { check, fallbackReport, prepare, readCorpus, type ModulePlan } from '../src/suite.mts';
import { makeReport } from '../src/compare.mts';

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
  const long = 'abcdefghijklmnopqrstuvwxyz'.repeat(79).slice(0, 2048);
  assert.deepEqual(p1.slice(1).map(report => report.state), [
    { panelClass: '', badgeTitle: 'a' }, { panelClass: 'a', badgeTitle: long }, { panelClass: long, badgeTitle: '</script>' },
  ], 'the first string edges in order, the second field one step on');
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

/** Rewrite the three island hosts' triggers in document order (outer panel, nested badge, page badge). */
const triggers = (plan: readonly string[]) => (html: string) => {
  let i = 0;
  return html.replace(/data-forma-hydrate="load"/g, () => plan[i++] ?? 'data-forma-hydrate="load"');
};

test('P2 drives deferred triggers: hosts rewritten to interaction, idle and visible all activate, and activation writes nothing', async () => {
  const [, p2] = await both(0, triggers(['data-forma-hydrate="interaction"', 'data-forma-hydrate="idle"', 'data-forma-hydrate="visible"']));
  assert.equal(p2!.verdict, 'equal', `${p2!.error ?? ''} ${JSON.stringify(p2!.differences)}`);
  assert.deepEqual(p2!.activation, { hosts: 3, activated: 3 });
});

test('P2 requires every host activated: 2 of 3 and 1 of 3 are errors naming the hosts that never activated', async () => {
  const hidden = 'data-forma-hydrate="visible" hidden';
  const [, two] = await both(0, triggers(['data-forma-hydrate="load"', 'data-forma-hydrate="load"', hidden]));
  assert.equal(two!.verdict, 'error');
  assert.deepEqual(two!.activation, { hosts: 3, activated: 2 });
  assert.equal(two!.error, '2 of 3 island hosts activated; never activated: InnerBadge at root > main[node 1] > span[node 6] (visible)');
  const [, one] = await both(0, triggers(['data-forma-hydrate="load"', hidden, hidden]));
  assert.equal(one!.verdict, 'error');
  assert.deepEqual(one!.activation, { hosts: 3, activated: 1 });
  assert.match(one!.error ?? '', /^1 of 3 island hosts activated; never activated: InnerBadge at root > main\[node 1\] > div\[node 2\] > span\[node 3\] \(visible\); InnerBadge at/);
});

const nestedPlan = async (states: number): Promise<ModulePlan> =>
  prepare(readCorpus().find(entry => entry.name === 'nested-islands')!, { seed: 'forma-183', states });
const timings = () => ({ prepare: 0, launch: 0, server: 0, browser: 0 });
const result = (reports: SuiteResult['reports']): SuiteResult => ({ reports, unexpectedPasses: [], timings: { ...timings(), total: 0 }, modules: 1, states: reports.length });

test('the positive control runs on P2\'s own observer: an observer watching a detached element fails the run', async () => {
  const reports = await check([await nestedPlan(1)], { seed: 'forma-183', states: 1, browser, observeDetached: true }, timings());
  const p2 = reports.find(report => report.check === 'P2')!;
  assert.equal(p2.verdict, 'error');
  assert.equal(p2.error, "P2's observer did not record the control's attributes, childList, characterData write: its zero records cannot be trusted");
  assert.equal(passed(result(reports)), false);
  const honest = await check([await nestedPlan(1)], { seed: 'forma-183', states: 1, browser }, timings());
  assert.equal(honest.find(report => report.check === 'P2')!.verdict, 'equal', 'the same state passes on the served root');
});

test('a state whose boot never finishes is that state\'s error, and the run goes on to the next state', async () => {
  let calls = 0;
  const firstWithoutBoot = (html: string) => (calls++ === 0 ? html.replace(/<script type="module"[^>]*parity-boot\.js[^>]*><\/script>/, '') : html);
  const reports = await check([await nestedPlan(2)], { seed: 'forma-183', states: 2, browser, bootTimeout: 1500, alterServerHtml: firstWithoutBoot }, timings());
  const at = (index: number, kind: string) => reports.find(report => report.index === index && report.check === kind)!;
  assert.equal(at(0, 'P1').verdict, 'error');
  assert.match(at(0, 'P1').error ?? '', /^boot: the boot did not finish in 1500 ms/);
  assert.equal(at(0, 'P2').verdict, 'error');
  assert.equal(at(1, 'P1').verdict, 'equal');
  assert.equal(at(1, 'P2').verdict, 'equal');
  assert.equal(passed(result(reports)), false);
});

test('a typed-path refusal the corpus does not declare fails the run, and the summary names the walker-only modules', async () => {
  const plan = await nestedPlan(1);
  const refusal = { code: 'BIND-101', route: '/', path: 'badgeTitle', message: 'TypeScript declares "badgeTitle", but Rust has no such field' };
  const served = { path: 'low-level' as const, bind: [refusal], documents: [] };
  const report = fallbackReport(plan, served, { seed: 'forma-183', states: 1 })!;
  assert.equal(report.verdict, 'server-refused');
  assert.equal(report.refusal!.code, 'BIND-101');
  assert.match(report.refusal!.message ?? '', /typed path refused the module \(BIND-101 at badgeTitle\).*does not declare serverPath: "low-level"/);
  assert.equal(passed(result([report])), false);
  assert.equal(fallbackReport({ ...plan, entry: { ...plan.entry, serverPath: 'low-level' } }, served, { seed: 's', states: 1 }), null, 'declared: no failure');
  assert.equal(fallbackReport(plan, served, { seed: 's', states: 1, lowLevel: true }), null, 'forced by --low-level: no failure');
  assert.equal(fallbackReport(plan, { path: 'typed', bind: [], documents: [] }, { seed: 's', states: 1 }), null);
  const typedReport = makeReport({ module: 'create-show', seed: 's', index: 0, check: 'P1', serverPath: 'typed' }, null);
  assert.deepEqual(serverPaths([report, typedReport]), { typed: ['create-show'], lowLevel: [{ module: 'nested-islands', codes: ['BIND-101'] }] });
  assert.match(summaryText(result([report, typedReport])), /server paths: typed 1 modules, walker-only 1 \(nested-islands: BIND-101\)/);
});
