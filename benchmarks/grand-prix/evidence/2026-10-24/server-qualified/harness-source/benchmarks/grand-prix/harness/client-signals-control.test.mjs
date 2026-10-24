import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeSignalControl, validateSignalControl, SIGNAL_CONTROL } from './client-signals-control.mjs';
import { profileConfiguration } from './resource-profile.mjs';
import { BENCHES } from '../signals-race/benchmarks.mjs';
import { CARS } from '../signals-race/cars.mjs';

const lock = () => JSON.parse(readFileSync(new URL('../signals-race/package-lock.json', import.meta.url), 'utf8'));
const corePackage = { dependencies: { 'alien-signals': '3.1.2' } };
const descriptor = () => describeSignalControl(lock(), corePackage, 'a'.repeat(64));
const profile = profileConfiguration({ name: 'gha-4-v1', platform: 'linux', githubActions: true,
  availableCpus: 4, affinity: [0, 1, 2, 3] });
const campaign = { schema: 1, id: '01234567-89ab-4def-8123-456789abcdef', createdAt: '2026-10-24T12:00:00.000Z',
  kind: 'github-actions', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: 'c'.repeat(64),
  github: { runId: '123', runAttempt: '1', job: 'client', repository: 'getforma-dev/forma' } };
const result = () => ({ car: SIGNAL_CONTROL, library: 'alien-signals', version: '3.1.2', event: 11, runs: 5, warmups: 2,
  correct: true, sink: true, checks: Array.from({ length: 14 }, () => ({ ok: true })),
  benches: Object.fromEntries(BENCHES.map(({ name }) => [name, { runs: [1, 2, 3, 4, 5] }])),
  resourceProfile: structuredClone(profile), campaign: structuredClone(campaign),
  processAffinity: [0], runnerProcessAffinity: [0], machine: { platform: 'linux/x64', cgroupCpuMax: '100000 100000' } });

test('control binds the candidate to its exact nested locked dependency, separately from five scored cars', () => {
  const control = descriptor();
  assert.equal(control.engineVersion, '3.1.2');
  assert.equal(control.integrity, lock().packages[control.enginePath].integrity);
  assert.equal(control.scored, false);
  assert.deepEqual(CARS, ['forma', 'alien-signals', 'solid', 'preact-signals', 'vue-reactivity']);
  assert(!CARS.includes(control.car));
  assert.notEqual(lock().packages['node_modules/alien-signals'].version, control.engineVersion);
  assert.equal(validateSignalControl(result(), control, profile, campaign).version, '3.1.2');
});

for (const [name, edit] of [
  ['missing nested engine', l => { delete l.packages['node_modules/@getforma/core/node_modules/alien-signals']; }],
  ['changed nested engine', l => { l.packages['node_modules/@getforma/core/node_modules/alien-signals'].version = '3.2.1'; }],
  ['changed Forma dependency', l => { l.packages['node_modules/@getforma/core'].dependencies['alien-signals'] = '^3.1.2'; }],
  ['missing integrity', l => { delete l.packages['node_modules/@getforma/core/node_modules/alien-signals'].integrity; }],
]) test(`control rejects ${name}`, () => { const l = lock(); edit(l); assert.throws(() => describeSignalControl(l, corePackage, 'a'.repeat(64))); });
test('control rejects changed candidate and absent adapter provenance', () => {
  assert.throws(() => describeSignalControl(lock(), { dependencies: { 'alien-signals': '3.2.1' } }, 'a'.repeat(64)));
  assert.throws(() => describeSignalControl(lock(), corePackage, ''));
});

for (const [name, edit] of [
  ['scored adapter', r => { r.car = 'alien-signals'; }], ['wrong version', r => { r.version = '3.2.1'; }],
  ['wrong event', r => { r.event = 10; }], ['one run', r => { r.runs = 1; }], ['one warmup', r => { r.warmups = 1; }],
  ['failed correctness', r => { r.correct = false; }], ['missing sink', r => { r.sink = false; }],
  ['missing check', r => { r.checks.pop(); }], ['failed check', r => { r.checks[0].ok = false; }],
  ['missing benchmark', r => { delete r.benches['signal create']; }],
  ['missing sample', r => { r.benches['signal create'].runs.pop(); }],
  ['nonfinite sample', r => { r.benches['signal create'].runs[0] = Infinity; }],
  ['different profile', r => { r.resourceProfile.signals.cpuset = '1'; }],
  ['different host', r => { r.campaign.hostSha256 = 'd'.repeat(64); }],
  ['different campaign', r => { r.campaign.id = '11234567-89ab-4def-8123-456789abcdef'; }],
  ['different worker affinity', r => { r.processAffinity = [1]; }],
  ['different runner affinity', r => { r.runnerProcessAffinity = [1]; }],
  ['different platform', r => { r.machine.platform = 'darwin/arm64'; }],
  ['wrong CPU quota', r => { r.machine.cgroupCpuMax = '200000 100000'; }],
]) test(`control rejects result with ${name}`, () => { const r = result(); edit(r); assert.throws(() => validateSignalControl(r, descriptor(), profile, campaign)); });
