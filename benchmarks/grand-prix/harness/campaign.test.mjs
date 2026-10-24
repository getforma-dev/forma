import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaign, readCampaign, validateCampaign } from './campaign.mjs';

const sample = () => ({ schema: 1, id: '01234567-89ab-4def-8123-456789abcdef', createdAt: '2026-10-24T12:00:00.000Z',
  kind: 'github-actions', hostSha256: 'a'.repeat(64), machineIdSha256: 'b'.repeat(64), runnerTrackingSha256: 'c'.repeat(64),
  github: { runId: '123', runAttempt: '1', job: 'comparison', repository: 'getforma-dev/forma' } });
test('campaign validation retains explicit job and hashed machine identity', () => assert.deepEqual(validateCampaign(sample()), sample()));
for (const [name, edit] of [
  ['missing runner', r => { r.runnerTrackingSha256 = null; }], ['raw host', r => { r.hostSha256 = 'host-name'; }],
  ['missing machine', r => { r.machineIdSha256 = null; }], ['missing attempt', r => { delete r.github.runAttempt; }],
  ['non-UUID identifier', r => { r.id = 'run123'; }], ['extra raw identifier', r => { r.machineId = 'private'; }],
]) test(`campaign rejects ${name}`, () => { const record = sample(); edit(record); assert.throws(() => validateCampaign(record)); });
test('new campaign is immutable and child drivers retain one identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-campaign-')), previous = process.env.GP_CAMPAIGN_FILE;
  delete process.env.GP_CAMPAIGN_FILE;
  try {
    const first = createCampaign(join(dir, 'first.json'));
    const second = createCampaign(join(dir, 'second.json'));
    assert.deepEqual(second, first); assert.deepEqual(readCampaign(), first);
    assert.equal(readFileSync(join(dir, 'first.json'), 'utf8'), readFileSync(join(dir, 'second.json'), 'utf8'));
    assert.throws(() => createCampaign(join(dir, 'first.json')));
    writeFileSync(join(dir, 'foreign.json'), JSON.stringify({ ...first, hostSha256: '0'.repeat(64) }));
    assert.throws(() => readCampaign(join(dir, 'foreign.json')), /different host/);
    delete process.env.GP_CAMPAIGN_FILE;
    assert.notEqual(createCampaign(join(dir, 'new.json')).id, first.id, 'fresh invocations must not share campaign IDs');
  } finally {
    if (previous === undefined) delete process.env.GP_CAMPAIGN_FILE; else process.env.GP_CAMPAIGN_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
