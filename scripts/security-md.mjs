#!/usr/bin/env node
// Each input pairs an authenticated local DS12 with its GitHub Release metadata.
// This generator never fetches a registry, publishes, or chooses a release date.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { readRecordedSet, publishedRelease, supportRecord, renderSecurity, assertPublishedHistory } from './release-support.mjs';

try {
  const { values } = parseArgs({ options: { history: { type: 'string' }, template: { type: 'string' }, out: { type: 'string' }, check: { type: 'boolean', default: false } } });
  assert(values.history && values.template && values.out, 'usage: security-md.mjs --history history.json --template SECURITY.md --out SECURITY.md [--check]');
  const historyPath = resolve(values.history);
  const input = JSON.parse(readFileSync(historyPath, 'utf8'));
  assert.equal(input.schema, 1, 'unsupported support-history schema');
  assert(Array.isArray(input.releases) && input.releases.length > 0, 'support generation requires published release evidence');
  const releases = input.releases.map(item => {
    assert.equal(typeof item.record, 'string');
    assert.equal(typeof item.metadata, 'string');
    const record = readRecordedSet(readFileSync(resolve(dirname(historyPath), item.record)), item.sha256);
    const metadata = JSON.parse(readFileSync(resolve(dirname(historyPath), item.metadata), 'utf8'));
    return publishedRelease(record, metadata);
  });
  assert.equal(typeof input.inventory, 'string', 'history must name the complete GitHub release inventory');
  assertPublishedHistory(releases, JSON.parse(readFileSync(resolve(dirname(historyPath), input.inventory), 'utf8')));
  const result = renderSecurity(readFileSync(resolve(values.template), 'utf8'), supportRecord(releases));
  if (values.check) assert.equal(readFileSync(resolve(values.out), 'utf8'), result, 'SECURITY.md support lines differ from the release record');
  else writeFileSync(resolve(values.out), result);
} catch (error) { console.error(`security-md: ${error.message}`); process.exitCode = 1; }
