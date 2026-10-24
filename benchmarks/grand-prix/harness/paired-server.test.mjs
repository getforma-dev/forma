import assert from 'node:assert/strict';
import test from 'node:test';
import { trialPlan } from './paired-server.mjs';

test('published baseline precedes unique exact candidates with separate ownership', () => {
  assert.deepEqual(trialPlan('ci-123', ['a'.repeat(40), 'b'.repeat(40)]), [
    { ref: 'published', id: 'ci-123-0' }, { ref: 'a'.repeat(40), id: 'ci-123-1' }, { ref: 'b'.repeat(40), id: 'ci-123-2' },
  ]);
});
test('ambiguous refs, duplicate candidates and unsafe ownership IDs are refused', () => {
  for (const refs of [[], ['main'], ['a'.repeat(40), 'a'.repeat(40)], ['a'.repeat(39)], Array.from({ length: 5 }, (_, i) => String(i).repeat(40))]) {
    assert.throws(() => trialPlan('ci-123', refs));
  }
  assert.throws(() => trialPlan('../other', ['a'.repeat(40)]));
});
