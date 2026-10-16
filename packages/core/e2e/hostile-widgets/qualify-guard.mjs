#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const options = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--(runtime|out-dir)=(.+)$/.exec(arg);
  assert(match && !options.has(match[1]), `invalid or duplicate argument ${arg}`);
  options.set(match[1], match[2]);
}
const runtime = resolve(options.get('runtime') ?? resolve(here, '../../dist/formajs-runtime.global.js'));
const source = await readFile(runtime, 'utf8');
// Remove only the actual emitted selector-grant refusal in a scratch copy of
// the production artifact. No framework source or independent observer changes.
const anchor = '      if (!bound.dom)\n        throw exprError("FORMA_E_GRANT_DOM", `${host.label}.${method}() reads past the element (no dom grant)`, at);';
assert.equal(source.split(anchor).length, 2, 'guard mutation anchor must match exactly once');
const mutant = source.replace(anchor, '      // FORMA-129: removed selector grant refusal for qualification.');
const temporary = await mkdtemp(join(tmpdir(), 'forma-widget-guard-'));
const mutantPath = join(temporary, 'runtime.js');
await writeFile(mutantPath, mutant);
const out = resolve(options.get('out-dir') ?? join(here, 'out')); await mkdir(out, { recursive: true });
const summary = { schema: 1, passed: false, originalSha256: createHash('sha256').update(source).digest('hex'), mutantSha256: createHash('sha256').update(mutant).digest('hex'), removedSource: anchor, runs: [] };
try {
  for (const mode of ['before', 'mutant', 'corrected']) {
    const reportPath = join(out, `guard-${mode}.json`);
    const child = spawnSync(process.execPath, [join(here, 'run.mjs'), '--only=selector', `--runtime=${mode === 'mutant' ? mutantPath : runtime}`, `--out=${reportPath}`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 262_144 });
    if (child.error || child.signal) throw child.error ?? new Error(`guard probe terminated by ${child.signal}`);
    const bytes = await readFile(reportPath), report = JSON.parse(bytes);
    summary.runs.push({ mode, exit: child.status, sha256: createHash('sha256').update(bytes).digest('hex'), report: `guard-${mode}.json` });
    if (mode === 'mutant') {
      assert.equal(child.status, 1); assert.equal(report.passed, false);
      assert.match(report.error, /unauthorized outside-root read/);
      assert.ok(report.lastObservation.outsideReads > 0, 'mutation must reach real read observer');
      assert.equal(report.current.profile, 'none');
    } else { assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(report.passed, true); assert.equal(report.capabilities.length, 3); }
  }
  assert.equal(createHash('sha256').update(await readFile(runtime)).digest('hex'), summary.originalSha256, 'original runtime must remain byte-exact');
  summary.passed = true;
} catch (error) { summary.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  await writeFile(join(out, 'guard-qualification.json'), JSON.stringify(summary, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
  process.stdout.write(JSON.stringify(summary) + '\n');
}
