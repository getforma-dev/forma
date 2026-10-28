import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createModel, checkState } from '../client-race/assertions.mjs';
import { createDataGenerator } from '../client-race/shared/data.js';
import { builtCars } from '../client-race/lib.mjs';
import { count, rate, validateCars } from '../signals-race/validation.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('data sequences reset per car and remain deterministic across calls', () => {
  assert.deepEqual(createDataGenerator()(5), [
    { id: 1, label: 'helpful pink mouse' }, { id: 2, label: 'mushy yellow pony' },
    { id: 3, label: 'long purple mouse' }, { id: 4, label: 'elegant blue mouse' },
    { id: 5, label: 'unsightly green house' },
  ]); // Frozen labels verified against the original Round 1 generator.
  const one = createDataGenerator(), two = createDataGenerator();
  assert.deepEqual(one(2), two(2));
  assert.deepEqual(one(5), two(5));
  assert.equal(createDataGenerator()(1)[0].id, 1);
  assert.equal(one(1)[0].id, 8);
});
test('full-state verification rejects corruption missed by row-count checks', () => {
  const model = createModel(); model.apply('run');
  const state = { ...model.expected(), keyed: true };
  assert.deepEqual(checkState(state, model.expected()), []);
  const wrongLabel = { ...state, labels: [...state.labels] }; wrongLabel.labels[500] = 'incorrect';
  assert.match(checkState(wrongLabel, model.expected()).join(' '), /labels/);
  const wrongId = { ...state, ids: [...state.ids] }; wrongId.ids[500] = wrongId.ids[501];
  assert.match(checkState(wrongId, model.expected()).join(' '), /ids/);
  assert.match(checkState({ ...state, keyed: false }, model.expected()).join(' '), /identity/);
  assert.match(checkState({ ...state, selected: ['1'] }, model.expected()).join(' '), /selected/);
});
test('reference model preserves IDs through update/swap/append/remove and replaces them on run', () => {
  const model = createModel(); model.apply('run'); const before = model.expected();
  model.apply('update'); assert.equal(model.expected().labels[0], before.labels[0] + ' !!!');
  assert.equal(model.expected().labels[1], before.labels[1]);
  model.apply('swaprows'); assert.equal(model.expected().ids[1], before.ids[998]);
  model.apply('add'); assert.equal(model.expected().ids.length, 2000); assert.equal(model.expected().ids.at(-1), '2000');
  model.apply('select'); assert.deepEqual(model.expected().selected, ['3']);
  model.apply('remove'); assert.equal(model.expected().ids[2], '4'); assert.deepEqual(model.expected().selected, []);
  model.apply('run'); assert.equal(model.expected().ids[0], '2001');
  model.apply('clear'); assert.deepEqual(model.expected(), { ids: [], labels: [], selected: [] });
});
test('invalid counts, rates, duplicate and unknown adapters fail closed', () => {
  for (const value of ['-1', 'NaN', '1.5', 'Infinity', '', '1001']) assert.throws(() => count(value, 'runs', 1));
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => rate(1, value));
  assert.equal(rate(100, 10), 10000);
  assert.throws(() => validateCars(['forma', 'forma']));
  assert.throws(() => validateCars(['../worker']));
  assert.throws(() => builtCars('forma,forma'));
  assert.throws(() => builtCars('../../outside'));
});
function fixture(t, worker) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gp-measurement-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ['run.mjs', 'validation.mjs', 'cars.mjs']) copyFileSync(path.join(root, 'signals-race', file), path.join(dir, file));
  writeFileSync(path.join(dir, 'worker.mjs'), worker);
  const out = path.join(dir, 'raw'), env = { ...process.env };
  delete env.GP_CAMPAIGN_JSON; delete env.GP_RESOURCE_PROFILE;
  const run = (...extra) => spawnSync(process.execPath, [path.join(dir, 'run.mjs'), '--cars', 'forma', '--out', out, '--runs', '1', '--warmups', '0', ...extra], { encoding: 'utf8', env, timeout: 10000 });
  return { dir, out, run };
}
test('worker failure remains readable evidence and cannot be overwritten', t => {
  const f = fixture(t, 'console.error("synthetic failure"); process.exit(2);');
  assert.equal(f.run().status, 1);
  const before = readFileSync(path.join(f.out, 'forma.json'), 'utf8'), record = JSON.parse(before);
  assert.equal(record.correct, false); assert.equal(record.status, 'failed'); assert.match(record.error, /synthetic failure/);
  const second = f.run(); assert.equal(second.status, 1); assert.match(second.stderr, /overwrite/);
  assert.equal(readFileSync(path.join(f.out, 'forma.json'), 'utf8'), before);
});
test('a stuck worker is terminated and recorded as failure', t => {
  const f = fixture(t, 'setInterval(() => {}, 10000);');
  assert.equal(f.run('--timeout', '100').status, 1);
  const record = JSON.parse(readFileSync(path.join(f.out, 'forma.json'), 'utf8'));
  assert.equal(record.status, 'failed'); assert.match(record.error, /ETIMEDOUT/);
});
