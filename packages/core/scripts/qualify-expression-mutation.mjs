#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fuzz/expressions/out');
await mkdir(out, { recursive: true });
const summary = { schema: 1, seed: 1290300, cases: 100_000, passed: false, runs: [] };
try {
  for (const mode of ['before', 'mutant', 'corrected']) {
    const path = join(out, `mutation-${mode}.json`);
    const args = [join(root, 'scripts/fuzz-expressions.mjs'), '--seed=1290300', '--cases=100000', `--out=${path}`];
    if (mode === 'mutant') args.push('--mutation=remove-array-from');
    const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 150_000, maxBuffer: 262_144 });
    if (child.error || child.signal) throw child.error ?? new Error(`campaign terminated by ${child.signal}`);
    const bytes = await readFile(path);
    const report = JSON.parse(bytes);
    summary.runs.push({ mode, status: child.status, report: `mutation-${mode}.json`, sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: report.sourceSha256, workerSha256: report.workerSha256 });
    if (mode === 'mutant') {
      assert.equal(child.status, 1, 'removed charge must fail the unchanged campaign');
      assert.equal(report.passed, false);
      assert.equal(report.status, 'failed');
      assert.equal(report.mutation?.name, 'remove-array-from');
      assert.equal(report.failure?.input.operation, 'Array.from');
      assert.match(report.error, /cost undercharge for Array\.from: actual 0, independent floor/);
      assert.ok(report.failure.input.minimumCost > 0);
      assert.ok(report.failure.input.state.shape.length > 0 && report.failure.input.state.shape.length <= 64);
      assert.notEqual(report.mutation.beforeSha256, report.mutation.afterSha256);
      summary.failure = { index: report.failure.index, input: report.failure.input, error: report.error };
    } else {
      assert.equal(child.status, 0, child.stderr);
      assert.equal(report.passed, true);
      assert.equal(report.report.completed, 100_000);
      assert.deepEqual(report.preflight, { admittedNativeCalls: 1, refusedNativeCalls: 0, code: 'FORMA_E_BUDGET' });
    }
  }
  assert.equal(summary.runs[0].sourceSha256, summary.runs[1].sourceSha256);
  assert.equal(summary.runs[0].sourceSha256, summary.runs[2].sourceSha256);
  assert.equal(summary.runs[0].workerSha256, summary.runs[2].workerSha256);
  assert.notEqual(summary.runs[0].workerSha256, summary.runs[1].workerSha256);
  summary.passed = true;
} catch (error) {
  summary.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(out, 'mutation-qualification.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
}
