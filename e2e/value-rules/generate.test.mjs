import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, admission } from './generate.mjs';

test('seed/rule/index reproduce exactly independent of batching and change with seed', () => {
  for (let rule = 1; rule <= 7; rule++) {
    const direct = Array.from({ length: 31 }, (_, index) => generate(1820300, rule, index));
    const batches = [0, 7, 14, 21, 28].flatMap(offset => Array.from({ length: Math.min(7, 31 - offset) }, (_, i) => generate(1820300, rule, offset + i)));
    assert.deepEqual(batches, direct);
    assert.notDeepEqual(direct, Array.from({ length: 31 }, (_, index) => generate(1820301, rule, index)));
    assert(direct.every((value, index) => value.rule === rule && value.index === index));
  }
});
test('exact integer and nanosecond domains retain boundary refusals before number conversion', () => {
  assert.equal(admission({ rule: 3, value: '9007199254740991' }), null);
  assert.equal(admission({ rule: 3, value: '9007199254740992' }), 'RENDER-401');
  assert.equal(admission({ rule: 3, value: '18446744073709551615' }), 'RENDER-401');
  assert.equal(admission({ rule: 4, value: '-8640000000000000000000' }), null);
  assert.equal(admission({ rule: 4, value: '8640000000000001000000' }), 'RENDER-403');
});
test('the qualification seed exercises admitted/refused origins and both finite polarities', () => {
  for (const rule of [3, 4]) {
    const cases = Array.from({ length: 1000 }, (_, index) => generate(1820300, rule, index));
    assert(cases.some(value => admission(value)));
    assert(cases.some(value => !admission(value)));
  }
  for (const rule of [6, 7]) assert.deepEqual(new Set(Array.from({ length: 100 }, (_, index) => generate(1820300, rule, index).value)), new Set([false, true]));
  assert.deepEqual(new Set(Array.from({ length: 100 }, (_, index) => generate(1820300, 5, index).value)), new Set(['null', 'undefined']));
});
