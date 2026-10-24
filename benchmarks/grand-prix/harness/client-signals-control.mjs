import assert from 'node:assert/strict';
import { parseCpuList } from './resource-profile.mjs';

export const SIGNAL_CONTROL = 'alien-signals-3.1.2';
export const SIGNAL_RUNS = 5;
export const SIGNAL_WARMUPS = 2;
const enginePath = 'node_modules/@getforma/core/node_modules/alien-signals';
const benches = ['signal create', 'signal read', 'write with one effect', 'computed cache hit',
  'chain of 100', 'diamond (500 middles)', 'fan-out to 100 effects', 'effect create and dispose', 'batch of 100 writes'];

// This adapter imports the nested dependency directly. Refuse a stale adapter or a
// changed candidate dependency instead of treating a different engine as the control.
export function describeSignalControl(lock, corePackage, adapterSha256) {
  const engine = lock.packages?.[enginePath];
  assert.equal(engine?.version, '3.1.2', 'version control requires the locked nested engine');
  assert.equal(lock.packages?.['node_modules/@getforma/core']?.dependencies?.['alien-signals'], engine.version);
  assert.equal(corePackage.dependencies?.['alien-signals'], engine.version, 'candidate must use the exact control engine');
  assert.match(engine.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.match(adapterSha256, /^[a-f0-9]{64}$/);
  return { car: SIGNAL_CONTROL, scored: false, engineVersion: engine.version,
    enginePath, integrity: engine.integrity, adapterSha256 };
}

export function validateSignalControl(result, control, resourceProfile, campaign) {
  assert.equal(result.car, control.car);
  assert.equal(result.library, 'alien-signals');
  assert.equal(result.version, control.engineVersion);
  assert.equal(result.event, 11);
  assert.equal(result.runs, SIGNAL_RUNS);
  assert.equal(result.warmups, SIGNAL_WARMUPS);
  assert.equal(result.correct, true);
  assert.equal(result.sink, true);
  assert.equal(result.checks.length, 14);
  assert(result.checks.every(check => check.ok === true));
  assert.deepEqual(Object.keys(result.benches), benches);
  for (const bench of Object.values(result.benches)) {
    assert.equal(bench.runs.length, SIGNAL_RUNS);
    assert(bench.runs.every(value => Number.isFinite(value) && value > 0));
  }
  assert.deepEqual(result.resourceProfile, resourceProfile);
  assert.deepEqual(result.campaign, campaign);
  if (resourceProfile.signals.cpuset) {
    assert.deepEqual(result.processAffinity, parseCpuList(resourceProfile.signals.cpuset));
    assert.deepEqual(result.runnerProcessAffinity, result.processAffinity);
  }
  assert(result.machine.platform.startsWith('linux/'));
  const [quota, period] = result.machine.cgroupCpuMax.split(' ').map(Number);
  assert(quota > 0 && period > 0);
  assert.equal(quota / period, 1);
  return result;
}
