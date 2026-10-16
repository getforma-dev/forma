#!/usr/bin/env node
// Bounded FORMA-108 proof for changed actual mutations. The full corpus still
// runs through run-probes.mjs; retired APIs never count as current kills.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tiered = 'src/__tests__/runtime-tiered-mount.test.ts';
const explicit = 'src/__tests__/runtime-explicit-mount.test.ts';
export const controls = [
  ['tiered/el-unbound', tiered, "$el.closest('body') reaches nothing without dom", /confined/],
  ['tiered/event-unbound', tiered, "an element reached through $event or $refs carries the mount's bound", /event confined/],
  ['tiered/refs-unbound', tiered, "an element reached through $event or $refs carries the mount's bound", /refs confined/],
  ['tiered/child-scope-drops-mount', tiered, "an element reached through $event or $refs carries the mount's bound", /event confined/],
  ['tiered/fetch-denial-sent', tiered, 'with explicit empty grants a generated tree binds neither data-fetch nor $el.click()', /deeply equal \[\]/],
  ['tiered/non-2xx-as-data', tiered, 'a 404 with a JSON body lands in the error: target, not the data target', /HTTP 404/],
  ['tiered/fetch-timeout-ignored', tiered, "a fetch grant's timeout shortens the abort", /false to be true/],
  ['tiered/refetch-shared-registry', tiered, '$refetch reaches only the fetches of its own mount', /deeply equal/],
  ['tiered/denial-silenced', tiered, 'a mount takes its diagnostics switch from its call, not the page', /FORMA_E_GRANT_DOM/],
  ['frame-link/refusal-silenced', tiered, 'an unreviewed mount renders no <link>: each is removed before the markup reaches the document', /FORMA_E_UNREVIEWED_LINK/],
  ['tiered/report-fetch-unrecorded', tiered, 'the development report lists exactly the grants a fixture widget used', /deeply equal/],
  ['explicit/default-dom', explicit, 'omitted grants confine DOM and refuse fetch and activation', /confined/],
  ['explicit/default-navigate', explicit, 'omitted grants confine DOM and refuse fetch and activation', /not be called/],
  ['explicit/detached-scope-kept', explicit, 'unmount disposes an owned scope that was', /to be '1'/],
  ['explicit/ancestry-disposal', explicit, 'unmount disposes an owned scope that was', /to be '1'/],
  ['explicit/refusal-without-mount', explicit, 'attributes identical unreviewed refusals to each mount independently', /deeply equal/],
  ['explicit/manual-warning', explicit, 'warns once about the obsolete manual switch and names the replacement mount call', /length of 1/],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assertions = report => report.testResults.flatMap(result => result.assertionResults);
export function assertIntendedKill(report, control) {
  const [, , title, signature] = control;
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0, 'runtime suite error is not a mutation kill');
  const failed = assertions(report).filter(row => row.status === 'failed');
  assert(failed.length > 0, 'mutant survived');
  for (const row of failed) {
    assert(row.fullName.includes(title), `unrelated failing test: ${row.fullName}`);
    assert(row.failureMessages.length > 0);
    for (const failure of row.failureMessages) {
      assert.match(failure, /AssertionError/, 'non-assertion failure is not a mutation kill');
      assert.doesNotMatch(failure, /(?:TypeError|ReferenceError|SyntaxError):/, 'runtime exception is not a mutation kill');
      assert.match(failure, signature, 'expected assertion signature absent');
    }
  }
  return failed.map(row => ({ name: row.fullName, messages: row.failureMessages }));
}

export function qualifyRuntimeMigration(output) {
  mkdirSync(output, { recursive: true });
  const corpusBytes = readFileSync(join(core, 'probes/corpus.json'));
  const corpus = JSON.parse(corpusBytes);
  const git = args => {
    const result = spawnSync('git', args, { cwd: core, encoding: 'utf8' });
    assert.equal(result.status, 0); return result.stdout.trim();
  };
  const report = { schema: 1, passed: false, sourceCommit: git(['rev-parse', 'HEAD']), sourceClean: git(['status', '--porcelain', '--untracked-files=no']) === '', node: process.version,
    corpusSha256: sha(corpusBytes), harnessSha256: sha(readFileSync(fileURLToPath(import.meta.url))), sources: {}, controls: [] };
  const destination = join(output, 'runtime-migration.json');
  const save = () => writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  const originals = new Map();
  for (const [id] of controls) {
    const probe = corpus.find(row => row.id === id); assert(probe, `missing ${id}`);
    const path = join(core, probe.file); if (!originals.has(path)) originals.set(path, readFileSync(path));
    report.sources[probe.file] = sha(originals.get(path));
  }
  const run = (label, files, titles) => {
    const path = join(output, label + '.json');
    const result = spawnSync(process.execPath, [join(core, 'node_modules/vitest/vitest.mjs'), 'run', ...files,
      '--maxWorkers=2', '--reporter=json', `--outputFile=${path}`, '--testNamePattern', titles.map(quote).join('|')],
    { cwd: core, encoding: 'utf8', timeout: 60_000 });
    writeFileSync(join(output, label + '.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`);
    if (result.error) throw result.error;
    assert(result.status === 0 || result.status === 1, 'abnormal test process exit');
    const bytes = readFileSync(path), proof = JSON.parse(bytes);
    assert.equal(proof.numRuntimeErrorTestSuites ?? 0, 0);
    return { exit: result.status, sha256: sha(bytes), proof };
  };
  const allFiles = [...new Set(controls.map(row => row[1]))], allTitles = [...new Set(controls.map(row => row[2]))];
  const green = label => {
    const result = run(label, allFiles, allTitles);
    assert.equal(result.exit, 0, `${label} test process failed`); assert.equal(result.proof.numFailedTests, 0);
    for (const title of allTitles) assert(assertions(result.proof).some(row => row.status === 'passed' && row.fullName.includes(title)), `${label}: control did not execute: ${title}`);
    return { exit: result.exit, sha256: result.sha256, passed: result.proof.numPassedTests };
  };
  const start = performance.now();
  try {
    report.before = green('before'); save();
    for (const control of controls) {
      const [id, file, title] = control, probe = corpus.find(row => row.id === id), path = join(core, probe.file);
      const original = originals.get(path), source = original.toString();
      assert.equal(source.split(probe.find).length - 1, 1, `${id}: mutation must match exactly once`);
      const changed = source.replace(probe.find, probe.replace); assert.notEqual(changed, source);
      const row = { id, source: probe.file, beforeSha256: sha(original), mutantSha256: sha(changed), passed: false }; report.controls.push(row); save();
      writeFileSync(path, changed);
      try {
        const result = run(id.replaceAll('/', '-'), [file], [title]);
        assert.equal(result.exit, 1, `${id}: mutant survived`);
        row.killedBy = assertIntendedKill(result.proof, control); row.sha256 = result.sha256; row.passed = true;
      } finally { writeFileSync(path, original); save(); }
    }
    report.corrected = green('corrected');
    for (const [path, original] of originals) assert.deepEqual(readFileSync(path), original, 'source was not restored');
    report.passed = true;
  } catch (error) { report.error = error.stack; throw error; }
  finally { for (const [path, original] of originals) writeFileSync(path, original); report.elapsedMs = performance.now() - start; save(); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv.slice(2).find(value => value.startsWith('--out-dir='));
  const output = resolve(arg ? arg.slice('--out-dir='.length) : join(core, 'probes/explicit-runtime'));
  const report = qualifyRuntimeMigration(output);
  console.log(JSON.stringify({ passed: report.passed, controls: report.controls.length, elapsedMs: report.elapsedMs, output }));
}
