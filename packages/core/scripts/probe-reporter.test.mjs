/** Real Vitest processes distinguish assertion failures from harness failures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { cleanProbeBaseline, classifyProbe } from './probe-results.mjs';

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const modules = dirname(dirname(require.resolve('vitest/package.json')));
const reporter = fileURLToPath(new URL('./probe-reporter.mjs', import.meta.url));
const source = "import {test,expect,beforeEach} from 'vitest';\n";
function runFixture(initial, changed, check, files = ['case.test.mjs']) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-probe-result-'));
  try {
    symlinkSync(modules, join(dir, 'node_modules'), 'junction');
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(dir, 'vitest.config.mjs'), "export default {test:{environment:'node',include:['*.test.mjs']}};\n");
    const run = (label, body) => {
      for (const file of files) writeFileSync(join(dir, file), source + body);
      const output = join(dir, `${label}.json`);
      const result = spawnSync(process.execPath, [vitest, 'run', '--config', join(dir, 'vitest.config.mjs'), '--maxWorkers=1', '--maxConcurrency=1', '--bail=1', '--reporter', reporter], {
        cwd: dir, encoding: 'utf8', timeout: 25000, env: { ...process.env, FORMA_PROBE_REPORT: output },
      });
      return { text: existsSync(output) ? readFileSync(output, 'utf8') : '', processResult: { status: result.status, signal: result.signal, error: result.error?.message ?? null }, output: `${result.stdout}${result.stderr}` };
    };
    const before = run('before', initial), baseline = cleanProbeBaseline(before.text, before.processResult);
    const mutant = run('mutant', changed); check(mutant, baseline);
    const restored = run('restored', initial);
    assert.equal(classifyProbe(restored.text, restored.processResult, baseline).caught, false, restored.output);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
const pass = "test('actual assertion',()=>expect(1).toBe(1));";
test('real executed assertion is caught; passing and restored executions are clean', () => {
  runFixture(pass, "test('actual assertion',()=>expect(1).toBe(2));", (run, baseline) => {
    const result = classifyProbe(run.text, run.processResult, baseline);
    assert.equal(result.caught, true); assert.match(result.killedBy, /actual assertion/);
    const report = JSON.parse(run.text);
    assert.equal(report.reason, 'interrupted');
    assert.deepEqual(report.cancellations, ['test-failure']);
  });
});
test('a real pre-existing assertion failure aborts before any mutant', () => {
  let reachedMutant = false;
  assert.throws(() => runFixture("test('actual assertion',()=>expect(1).toBe(2));", pass, () => { reachedMutant = true; }), /clean baseline/);
  assert.equal(reachedMutant, false);
});
test('serial bail completes its assertion with multiple modules and concurrent tests', () => {
  const cases = expected => ['first', 'second'].map(name =>
    `test.concurrent('${name}',async()=>{await new Promise(r=>setTimeout(r,20));expect(1).toBe(${expected});});`).join('\n');
  runFixture(cases(1), cases(2), (run, baseline) => {
    assert.equal(baseline.filter(test => test.state === 'passed').length, 4);
    const result = classifyProbe(run.text, run.processResult, baseline);
    assert.equal(result.caught, true, run.output);
    assert.equal(result.failedAssertions, 1);
    const report = JSON.parse(run.text);
    assert.deepEqual(report.cancellations, ['test-failure']);
    const failed = report.modules.flatMap(module => module.tests).filter(test => test.state === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].started, true); assert.equal(failed[0].finished, true);
  }, ['case.test.mjs', 'other.test.mjs']);
});
for (const [name, body] of [
  ['parse error', "test('actual assertion',()=>{ const broken=; });"],
  ['collection assertion', "expect(1).toBe(2);" + pass],
  ['beforeEach assertion', "beforeEach(()=>expect(1).toBe(2));" + pass],
  ['plain body Error', "test('actual assertion',()=>{throw new Error('expected denied');});"],
  ['test timeout', "test('actual assertion',()=>new Promise(()=>{}),20);"],
  ['unhandled rejection beside passing assertion', "test('actual assertion',async()=>{Promise.reject(new Error('outside assertion'));await new Promise(r=>setTimeout(r,30));expect(1).toBe(1);});"],
]) test(`real ${name} cannot count as a kill`, () => {
  runFixture(pass, body, (run, baseline) => {
    assert.notEqual(run.processResult.status, 0, run.output);
    assert.throws(() => classifyProbe(run.text, run.processResult, baseline));
  });
});
