// Expected divergence as data: every difference must be explained for a report to be expected,
// and every entry must still be explained by the run, or the run fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReport, type Difference, type Report } from '../src/compare.mts';
import { applyExpected, readExpected, type ExpectedEntry } from '../src/expected.mts';

const different = (module: string, index: number, differences: Difference[], check: 'P1' | 'P2' = 'P1'): Report =>
  makeReport({ module, seed: 's', index, check }, { differences, first: differences[0] ?? null, count: differences.length, structural: 0, holderAmbiguous: 0 });
const keyed: Difference = { kind: 'key', path: 'page > ul:nth-child(1) > li:nth-child(1)', server: undefined, client: '7' };
const valueText: Difference = { kind: 'attribute-value', path: 'page > span:nth-child(1)[data-live]', server: '', client: 'true' };
const entry = (over: Partial<ExpectedEntry>): ExpectedEntry => ({ module: 'm', index: '*', check: 'P1', kind: 'key', ticket: 'FORMA-181', note: 'keys land with B', ...over });

test('a report all of whose differences are matched is expected-divergent, naming the ticket', () => {
  const { reports, unexpectedPasses } = applyExpected([different('m', 3, [keyed])], [entry({})]);
  assert.equal(reports[0]!.verdict, 'expected-divergent');
  assert.deepEqual(reports[0]!.expected, { ticket: 'FORMA-181', note: 'keys land with B' });
  assert.deepEqual(unexpectedPasses, []);
});

test('one unmatched difference keeps the report different', () => {
  const { reports } = applyExpected([different('m', 3, [keyed, valueText])], [entry({})]);
  assert.equal(reports[0]!.verdict, 'different');
});

test('index, check, path and the value pattern all narrow a match', () => {
  const report = different('m', 3, [valueText]);
  const base = { kind: 'attribute-value' as const, ticket: 'finding F2' };
  assert.equal(applyExpected([report], [entry({ ...base, index: 3 })]).reports[0]!.verdict, 'expected-divergent');
  assert.equal(applyExpected([report], [entry({ ...base, index: 4 })]).reports[0]!.verdict, 'different', 'another state');
  assert.equal(applyExpected([report], [entry({ ...base, check: 'P2' })]).reports[0]!.verdict, 'different', 'another check');
  assert.equal(applyExpected([report], [entry({ ...base, path: valueText.path })]).reports[0]!.verdict, 'expected-divergent');
  assert.equal(applyExpected([report], [entry({ ...base, path: 'page > b:nth-child(1)[data-live]' })]).reports[0]!.verdict, 'different', 'another path');
  assert.equal(applyExpected([report], [entry({ ...base, match: '^ → true$' })]).reports[0]!.verdict, 'expected-divergent');
  assert.equal(applyExpected([report], [entry({ ...base, match: '^ → false$' })]).reports[0]!.verdict, 'different', 'another value');
});

test('an error entry matches an error report by its message, and nothing else', () => {
  const failed = makeReport({ module: 'm', seed: 's', index: 0, check: 'P1', verdict: 'error', error: "core's render threw: TypeError: items is not a function" }, null);
  assert.equal(applyExpected([failed], [entry({ kind: 'error', match: 'items is not a function' })]).reports[0]!.verdict, 'expected-divergent');
  assert.equal(applyExpected([failed], [entry({ kind: 'error', match: 'something else' })]).reports[0]!.verdict, 'error');
  assert.equal(applyExpected([different('m', 0, [keyed])], [entry({ kind: 'error' })]).reports[0]!.verdict, 'different', 'an error entry never explains a difference');
});

test('an entry the run covers that matches nothing is an unexpected pass; one for a module the run did not cover is not', () => {
  const equal = makeReport({ module: 'm', seed: 's', index: 0, check: 'P1' }, { differences: [], first: null, count: 0, structural: 0, holderAmbiguous: 0 });
  const gone = entry({});
  const elsewhere = entry({ module: 'other' });
  const { reports, unexpectedPasses } = applyExpected([equal], [gone, elsewhere]);
  assert.equal(reports[0]!.verdict, 'equal');
  assert.deepEqual(unexpectedPasses, [gone]);
});

test('the committed list parses, and each entry names a ticket or a finding and says why', () => {
  const entries = readExpected();
  for (const item of entries) {
    assert.match(item.ticket, /^(FORMA-\d+|finding F\d+)/, JSON.stringify(item));
    assert.ok(item.note.length > 20, `${item.module}: the note says why`);
    if (item.match) new RegExp(item.match, 'u');
  }
});
