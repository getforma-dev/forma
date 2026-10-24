// A resource profile describes limits; this identity binds evidence to one VM/job.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateCampaign(record) {
  assert(record && typeof record === 'object' && !Array.isArray(record), 'campaign identity required');
  assert.deepEqual(Object.keys(record).sort(), ['schema', 'id', 'createdAt', 'kind', 'hostSha256', 'machineIdSha256', 'runnerTrackingSha256', 'github'].sort());
  assert.equal(record.schema, 1);
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.id ?? ''), 'campaign requires a UUIDv4');
  assert.equal(new Date(record.createdAt).toISOString(), record.createdAt, 'invalid campaign timestamp');
  assert(digest(record.hostSha256), 'host fingerprint required');
  assert(record.machineIdSha256 === null || digest(record.machineIdSha256));
  assert(record.runnerTrackingSha256 === null || digest(record.runnerTrackingSha256));
  assert(['github-actions', 'native'].includes(record.kind));
  if (record.kind === 'github-actions') {
    assert(digest(record.machineIdSha256) && digest(record.runnerTrackingSha256), 'GHA campaign requires actual machine and runner fingerprints');
    assert(record.github && typeof record.github === 'object' && !Array.isArray(record.github));
    assert.deepEqual(Object.keys(record.github).sort(), ['runId', 'runAttempt', 'job', 'repository'].sort());
    assert(Object.values(record.github).every(value => typeof value === 'string'), 'GitHub campaign fields must be strings');
    assert(/^[1-9]\d*$/.test(record.github.runId) && /^[1-9]\d*$/.test(record.github.runAttempt));
    assert(/^[A-Za-z_][A-Za-z0-9_-]*$/.test(record.github.job));
    assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.github.repository));
  } else {
    assert.equal(record.github, null); assert.equal(record.runnerTrackingSha256, null);
  }
  return record;
}

function currentHost() {
  // Never serialize the raw machine ID, hostname, or tracking environment value.
  const machine = process.platform === 'linux' ? readFileSync('/etc/machine-id', 'utf8').trim() : null;
  if (machine !== null) assert(/^[a-f0-9]{32}$/i.test(machine), 'Linux machine identity is unavailable');
  const gha = process.env.GITHUB_ACTIONS === 'true';
  const tracking = gha ? process.env.RUNNER_TRACKING_ID : null;
  if (gha) assert(process.platform === 'linux' && typeof tracking === 'string' && tracking.length > 0, 'GHA runner tracking identity is unavailable');
  const github = gha ? { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    job: process.env.GITHUB_JOB, repository: process.env.GITHUB_REPOSITORY } : null;
  return { kind: gha ? 'github-actions' : 'native',
    hostSha256: hash(JSON.stringify([process.platform, process.arch, os.hostname(), machine])),
    machineIdSha256: machine === null ? null : hash(machine),
    runnerTrackingSha256: tracking === null ? null : hash(tracking), github };
}

export function readCampaign(file = process.env.GP_CAMPAIGN_FILE) {
  assert(file, 'campaign file required');
  const record = validateCampaign(JSON.parse(readFileSync(resolve(file), 'utf8')));
  const host = currentHost();
  for (const key of Object.keys(host)) assert.deepEqual(record[key], host[key], 'campaign belongs to a different host or GitHub job: ' + key);
  return record;
}

// Each driver retains its own immutable copy. Paired children inherit one UUID.
export function createCampaign(file) {
  const destination = resolve(file);
  assert(!existsSync(destination), 'campaign output already exists');
  const record = process.env.GP_CAMPAIGN_FILE ? readCampaign()
    : validateCampaign({ schema: 1, id: randomUUID(), createdAt: new Date().toISOString(), ...currentHost() });
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
  process.env.GP_CAMPAIGN_FILE = destination;
  return record;
}
