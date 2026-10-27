#!/usr/bin/env node
// Fetch one immutable published baseline, authenticate it, then measure the
// actual fixed consumer using current built products. No publication or version edits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandInvocation } from './portable-command.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(repo, 'test-results/router-size', `${Date.now()}-${process.pid}`));
assert(!existsSync(output), 'preserve prior paired size qualification evidence');
mkdirSync(output, {recursive:true});
const baseline = JSON.parse(readFileSync(join(repo, 'scripts/router-size-baseline.json'), 'utf8'));
const receipt = {schema:1, startedAt:new Date().toISOString(), baseline, scope:'Source consumer qualification; not whole P17 or publication.', passed:false};
const save = (name, value) => writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
try {
  assert.equal(baseline.schema, 1);
  assert.equal(baseline.name, '@getforma/core');
  assert.equal(baseline.version, '3.1.0');
  const downloads = join(output, 'baseline'); mkdirSync(downloads);
  const invocation = commandInvocation('npm', ['pack', `${baseline.name}@${baseline.version}`, '--ignore-scripts', '--json', '--pack-destination', downloads]);
  const packed = spawnSync(invocation.command, invocation.args, {cwd:repo, encoding:'utf8', timeout:120_000, maxBuffer:4*1024*1024});
  save('baseline-pack.log', `${packed.stdout ?? ''}\n${packed.stderr ?? ''}`);
  assert.equal(packed.error, undefined, 'published baseline download failed');
  assert.equal(packed.status, 0, 'published baseline download failed');
  const rows = JSON.parse(packed.stdout);
  assert.equal(rows.length, 1); const metadata = rows[0];
  assert.equal(metadata.name, baseline.name); assert.equal(metadata.version, baseline.version);
  assert.equal(metadata.filename, 'getforma-core-3.1.0.tgz');
  assert.equal(metadata.integrity, baseline.integrity, 'registry baseline differs from its reviewed integrity');
  const archive = join(downloads, metadata.filename), bytes = readFileSync(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), baseline.archiveSha256, 'published baseline archive hash changed');
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, baseline.integrity);
  save('baseline-pack.json', rows);
  const measured = spawnSync(process.execPath, [join(repo, 'experiments/forma-router-native/measure-size.mjs'), archive, join(output, 'baseline-pack.json'), join(output, 'size.json')], {cwd:repo, encoding:'utf8', timeout:120_000, maxBuffer:16*1024*1024});
  save('measurement.log', `${measured.stdout ?? ''}\n${measured.stderr ?? ''}`);
  assert.equal(measured.error, undefined, 'paired consumer measurement failed');
  assert.equal(measured.status, 0, 'paired consumer measurement or fixed size limits failed');
  const evidence = JSON.parse(readFileSync(join(output, 'size.json'), 'utf8'));
  assert.equal(evidence.verdict.passed, true);
  receipt.verdict = evidence.verdict; receipt.passed = true;
} catch (error) {
  receipt.error = String(error.stack ?? error); process.exitCode = 1;
  console.error(receipt.error);
} finally {
  receipt.finishedAt = new Date().toISOString(); save('qualification.json', receipt);
  console.log(JSON.stringify({output, passed:receipt.passed, verdict:receipt.verdict}));
}
