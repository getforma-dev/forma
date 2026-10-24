import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCpuList, affinityFromStatus, profileConfiguration, validateProfile, validateEngineProfile, verifyRoleAffinity, validateContainerResources } from './resource-profile.mjs';

const gha = (extra = {}) => profileConfiguration({ name: 'gha-4-v1', platform: 'linux', githubActions: true,
  availableCpus: 4, affinity: [2, 4, 7, 9], ...extra });
test('Linux affinity uses actual IDs and expands gaps without assuming zero', () => {
  assert.deepEqual(parseCpuList('2,4-6,9'), [2, 4, 5, 6, 9]);
  assert.deepEqual(affinityFromStatus('Name:\tnode\nCpus_allowed_list:\t2,4,7,9\n'), [2, 4, 7, 9]);
});
test('malformed, overlapping, duplicate and unbounded CPU lists fail closed', () => {
  for (const text of ['', '0,,2', '1-0', '0-3,3', '2,1', '01', '-1', '1;echo', '1\n2', '0-65536', '0-4096', '1-2-3']) assert.throws(() => parseCpuList(text));
  for (const status of ['', 'Cpus_allowed_list:\t0-3\nCpus_allowed_list:\t0-3\n']) assert.throws(() => affinityFromStatus(status));
});
test('GHA4 allocates disjoint server/load CPUs and keeps original memory/build limits', () => {
  const profile = gha();
  assert.equal(profile.classA.cpuset, '2'); assert.equal(profile.classA.memory, '1g');
  assert.deepEqual(profile.classB, { cpus: '2', memory: '2g', workers: 2, cpuset: '2,4' });
  assert.deepEqual(profile.loadgen, { cpus: '2', cpuset: '7,9' });
  assert.deepEqual(profile.build, { cpus: '4', cpuset: '2,4,7,9' });
  assert.equal(profile.signals.cpuset, '2'); assert.equal(profile.signals.cpus, '1');
  assert.equal(profile.browser.cpuset, '4,7,9'); assert.equal(profile.qualified, true);
  validateProfile(profile);
});
test('GHA4 rejects a different host, affinity, resource count or unrecognized profile', () => {
  for (const edit of [{ platform: 'darwin' }, { githubActions: false }, { availableCpus: 2 },
    { availableCpus: 8, affinity: [0,1,2,3,4,5,6,7] }, { affinity: [0,1,2] },
    { affinity: [0,1,2,2] }, { name: 'gha-4' }, { diagnostic: 'false' }]) assert.throws(() => gha(edit));
});
test('the original native8 profile keeps its four CPU server and load generator', () => {
  const profile = profileConfiguration({ availableCpus: 8, affinity: [4,5,6,7,8,9,10,11] });
  assert.equal(profile.name, 'native-8-v1'); assert.equal(profile.classB.cpus, '4');
  assert.equal(profile.classB.cpuset, '4,5,6,7'); assert.equal(profile.loadgen.cpuset, '8,9,10,11');
  assert.equal(profile.browser.cpuset, null);
  assert.throws(() => profileConfiguration({ availableCpus: 4, affinity: [0,1,2,3] }));
});
test('old undersized diagnostic profiles stay unqualified and do not invent CPU isolation', () => {
  const profile = profileConfiguration({ diagnostic: true, availableCpus: 4, affinity: [0,1,2,3] });
  assert.equal(profile.name, 'native-8-v1'); assert.equal(profile.qualified, false);
  assert.equal(profile.classB.cpus, '4'); assert.equal(profile.classB.cpuset, null);
  assert.equal(profile.loadgen.cpuset, null); validateProfile(profile);
});
test('offline profile validation refuses relabelled or altered resource allocations', () => {
  for (const edit of [p => p.name = 'native-8-v1', p => p.classB.cpus = '4',
    p => p.loadgen.cpuset = p.classB.cpuset, p => p.browser.cpuset = p.classA.cpuset,
    p => p.qualified = false, p => p.selectedCpus = [0,1,2,3]]) {
    const profile = gha(); edit(profile); assert.throws(() => validateProfile(profile));
  }
});
test('engine validation rejects missing resources, remote Desktop or wrong CPU count', () => {
  const engine = { OSType: 'linux', OperatingSystem: 'Ubuntu 24.04', NCPU: 4 };
  validateEngineProfile(gha(), engine);
  for (const edit of [{ OSType: 'windows' }, { OperatingSystem: 'Docker Desktop' }, { NCPU: 8 }, { NCPU: 2 }, { NCPU: null }]) assert.throws(() => validateEngineProfile(gha(), { ...engine, ...edit }));
});
test('browser process and server container must actually have their declared disjoint affinity', () => {
  const profile = gha();
  assert.deepEqual(verifyRoleAffinity(profile, 'browser', 'Cpus_allowed_list:\t4,7,9\n'), [4,7,9]);
  assert.throws(() => verifyRoleAffinity(profile, 'browser', 'Cpus_allowed_list:\t2,4,7,9\n'));
  const container = { HostConfig: { NanoCpus: 1e9, Memory: 1024 ** 3, CpusetCpus: '2' } };
  validateContainerResources(container, profile.classA);
  for (const edit of [{ CpusetCpus: '' }, { CpusetCpus: '4' }, { NanoCpus: 2e9 }, { Memory: 2 * 1024 ** 3 }]) assert.throws(() => validateContainerResources({ HostConfig: { ...container.HostConfig, ...edit } }, profile.classA));
});
