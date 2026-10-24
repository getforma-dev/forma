import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectedIslandUrl } from './islands-linux.mjs';

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
