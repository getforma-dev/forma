import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { archiveContestants, CARS, inspectedIslandUrl } from './islands-linux.mjs';
import { profileConfiguration } from './resource-profile.mjs';

const expected = { runId: 'island-control', imageId: 'sha256:' + 'a'.repeat(64) };
function container() {
  return { State: { Running: true }, Image: expected.imageId,
    Config: { Labels: { grandprix: 'forma-264', gp264run: expected.runId } },
    HostConfig: { NanoCpus: 1e9, Memory: 1073741824 },
    NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '32768' }] } } };
}
test('URL comes from the inspected owned container binding', () => {
  assert.equal(inspectedIslandUrl(container(), expected), 'http://127.0.0.1:32768');
});
for (const [name, mutate] of [
  ['stopped server', c => { c.State.Running = false; }],
  ['foreign round', c => { c.Config.Labels.grandprix = 'forma-254'; }],
  ['foreign run', c => { c.Config.Labels.gp264run = 'another-run'; }],
  ['another image', c => { c.Image = 'sha256:' + 'b'.repeat(64); }],
  ['unbounded CPUs', c => { c.HostConfig.NanoCpus = 0; }],
  ['unbounded memory', c => { c.HostConfig.Memory = 0; }],
  ['missing port', c => { delete c.NetworkSettings.Ports['3000/tcp']; }],
  ['external interface', c => { c.NetworkSettings.Ports['3000/tcp'][0].HostIp = '0.0.0.0'; }],
  ['multiple bindings', c => { c.NetworkSettings.Ports['3000/tcp'].push({ HostIp: '127.0.0.1', HostPort: '32769' }); }],
  ['invalid port', c => { c.NetworkSettings.Ports['3000/tcp'][0].HostPort = '70000'; }],
]) test(`${name} cannot qualify an island URL`, () => {
  const c = container(); mutate(c); assert.throws(() => inspectedIslandUrl(c, expected));
});
test('truncated image identity cannot qualify the matching container', () => {
  const c = container(); c.Image = 'sha256:abc';
  assert.throws(() => inspectedIslandUrl(c, { ...expected, imageId: c.Image }));
});
test('the GHA4 URL also requires the actual declared server affinity', () => {
  const resourceProfile = profileConfiguration({ name: 'gha-4-v1', availableCpus: 4, affinity: [2,4,7,9], githubActions: true });
  const c = container(); c.HostConfig.CpusetCpus = '2';
  assert.equal(inspectedIslandUrl(c, { ...expected, resourceProfile }), 'http://127.0.0.1:32768');
  c.HostConfig.CpusetCpus = '4';
  assert.throws(() => inspectedIslandUrl(c, { ...expected, resourceProfile }));
});

test('a committed subtree archive contains every contestant even when the driver lives below the repository root', () => {
  const work = mkdtempSync(join(os.tmpdir(), 'forma-264-island-archive-'));
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const contexts = join(work, 'contexts');
    archiveContestants(contexts, commit);
    for (const car of CARS) assert(existsSync(join(contexts, car, 'Dockerfile')), `${car} missing from archive`);
    assert(existsSync(join(contexts, 'forma', 'Cargo.lock')));
    assert(existsSync(join(contexts, 'next', 'package-lock.json')));
  } finally { rmSync(work, { recursive: true, force: true }); }
});
