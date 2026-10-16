import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expressionProbeFloor } from './expression-probe-floor.mjs';

const corpus = Array.from({ length: 20 }, (_, id) => ({ id: `expr/${id}`, file: 'src/expr/interp.ts' }));
const results = count => corpus.map((probe, i) => ({ ...probe, status: i < count ? 'CAUGHT' : 'SURVIVED', killedBy: i < count ? 'actual assertion test' : null }));
test('other component kills cannot hide an expression survivor below its floor', () => {
  const unrelated = Array.from({ length: 100 }, (_, id) => ({ id: `dom/${id}`, file: 'src/dom/element.ts', status: 'CAUGHT', killedBy: 'DOM test' }));
  assert.equal(expressionProbeFloor([...corpus, ...unrelated], [...results(16), ...unrelated], 85).passed, false);
  assert.equal(expressionProbeFloor(corpus, results(17), 85).passed, true);
});
test('missing, stale, duplicated and unobserved process failures never count as expression kills', () => {
  assert.throws(() => expressionProbeFloor(corpus, results(20).slice(1), 85), /missing/);
  assert.throws(() => expressionProbeFloor(corpus, [...results(20), results(20)[0]], 85), /duplicate/);
  for (const bad of [{ status: 'ANCHOR_STALE' }, { status: 'CAUGHT', killedBy: null }, { status: 'EQUIVALENT', equivalent: 'invented' }]) {
    const data = results(20); data[0] = { ...data[0], ...bad };
    assert.throws(() => expressionProbeFloor(corpus, data, 85), /unqualified/);
  }
});
