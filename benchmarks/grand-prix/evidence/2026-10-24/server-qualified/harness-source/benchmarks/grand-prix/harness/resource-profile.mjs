// Explicit, reproducible CPU allocations. Existing diagnostic evidence is never promoted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';

export function parseCpuList(text) {
  assert.equal(typeof text, 'string', 'CPU affinity must be a Linux CPU list');
  assert(text.length > 0 && text.length <= 65536, 'CPU affinity list is empty or too large');
  const cpus = [];
  for (const part of text.split(',')) {
    const match = /^(0|[1-9]\d*)(?:-(0|[1-9]\d*))?$/.exec(part);
    assert(match, 'invalid CPU affinity list');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    assert(Number.isSafeInteger(first) && Number.isSafeInteger(last) && last <= 65535 && first <= last, 'invalid CPU range');
    assert(first > (cpus.at(-1) ?? -1), 'CPU affinity must be sorted and non-overlapping');
    assert(cpus.length + last - first + 1 <= 4096, 'CPU affinity list is too large');
    for (let cpu = first; cpu <= last; cpu++) cpus.push(cpu);
  }
  return cpus;
}

export function affinityFromStatus(status) {
  const matches = [...status.matchAll(/^Cpus_allowed_list:\s*([^\r\n]+)$/gm)];
  assert.equal(matches.length, 1, 'missing or duplicate process CPU affinity');
  return parseCpuList(matches[0][1]);
}

// Pure so offline report validation uses the recorded host, never today's host.
export function profileConfiguration({ name = 'native-8-v1', diagnostic = false,
  platform = 'linux', githubActions = false, availableCpus, affinity } = {}) {
  assert(['native-8-v1', 'gha-4-v1'].includes(name), 'unknown resource profile');
  assert.equal(typeof diagnostic, 'boolean'); assert.equal(typeof githubActions, 'boolean');
  assert(Number.isSafeInteger(availableCpus) && availableCpus > 0, 'invalid available CPU count');
  assert(Array.isArray(affinity), 'recorded process affinity required');
  if (affinity.length) assert.deepEqual(parseCpuList(affinity.join(',')), affinity, 'invalid recorded affinity');
  if (platform === 'linux') assert(affinity.length >= availableCpus, 'process affinity has fewer CPUs than available parallelism');
  const gha = name === 'gha-4-v1', minimumCpus = gha ? 4 : 8;
  if (gha) {
    assert.equal(platform, 'linux', 'gha-4-v1 requires native Linux');
    assert.equal(githubActions, true, 'gha-4-v1 requires GitHub Actions');
    assert.equal(availableCpus, 4, 'gha-4-v1 requires exactly four available CPUs');
    assert.equal(affinity.length, 4, 'gha-4-v1 requires exactly four allowed CPUs');
  } else if (!diagnostic) {
    assert.equal(platform, 'linux', 'qualified native profile requires Linux');
    assert(availableCpus >= 8 && affinity.length >= 8, 'native-8-v1 requires eight available and allowed CPUs');
  }
  const selectedCpus = platform === 'linux' && availableCpus >= minimumCpus ? affinity.slice(0, minimumCpus) : [];
  const set = (start, end) => selectedCpus.length ? selectedCpus.slice(start, end).join(',') : null;
  const serverCpus = gha ? 2 : 4;
  return {
    name, diagnostic, qualified: !diagnostic, minimumCpus, platform, githubActions,
    availableCpus, affinity: [...affinity], selectedCpus,
    classA: { cpus: '1', memory: '1g', workers: 1, cpuset: set(0, 1) },
    classB: { cpus: String(serverCpus), memory: '2g', workers: serverCpus, cpuset: set(0, serverCpus) },
    loadgen: { cpus: String(serverCpus), cpuset: set(serverCpus, minimumCpus) },
    build: { cpus: '4', cpuset: set(0, 4) },
    signals: { cpus: '1', memory: '1g', cpuset: set(0, 1) },
    browser: { cpuset: gha ? set(1, 4) : null },
  };
}

export function validateProfile(record) {
  assert.deepEqual(record, profileConfiguration(record), 'resource profile differs from its declared allocation');
  return record;
}

export function verifyRoleAffinity(profile, role, status = readFileSync('/proc/self/status', 'utf8')) {
  validateProfile(profile);
  assert(['classA', 'classB', 'loadgen', 'build', 'signals', 'browser'].includes(role), 'unknown resource role');
  const actual = affinityFromStatus(status);
  if (profile[role].cpuset !== null) assert.deepEqual(actual, parseCpuList(profile[role].cpuset), `${role} process affinity differs`);
  return actual;
}

export function validateContainerResources(container, allocation) {
  assert.equal(container.HostConfig?.NanoCpus, Number(allocation.cpus) * 1e9, 'container CPU quota differs');
  if (allocation.memory) assert.equal(container.HostConfig?.Memory, Number(allocation.memory.replace(/g$/, '')) * 1024 ** 3, 'container memory quota differs');
  if (allocation.cpuset !== null) assert.deepEqual(parseCpuList(container.HostConfig?.CpusetCpus ?? ''), parseCpuList(allocation.cpuset), 'container CPU affinity differs');
  return container;
}

export function hostProfile({ name = process.env.GP_PROFILE ?? 'native-8-v1',
  diagnostic = process.env.GP_DIAGNOSTIC === 'true' } = {}) {
  return profileConfiguration({ name, diagnostic, platform: process.platform,
    githubActions: process.env.GITHUB_ACTIONS === 'true', availableCpus: os.availableParallelism(),
    affinity: process.platform === 'linux' ? affinityFromStatus(readFileSync('/proc/self/status', 'utf8')) : [] });
}

export function validateEngineProfile(profile, engine) {
  validateProfile(profile);
  assert.equal(engine.OSType, 'linux', 'Docker engine must run Linux containers');
  assert(!/docker desktop/i.test(engine.OperatingSystem ?? ''), 'Docker Desktop is not native Linux');
  assert(Number.isSafeInteger(engine.NCPU) && engine.NCPU > 0, 'Docker CPU count is missing');
  if (profile.name === 'gha-4-v1') assert.equal(engine.NCPU, 4, 'gha-4-v1 requires a four-CPU Docker engine');
  else if (!profile.diagnostic) assert(engine.NCPU >= profile.minimumCpus, 'Docker engine lacks the profile CPUs');
  return engine;
}
