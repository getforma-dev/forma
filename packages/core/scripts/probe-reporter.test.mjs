/** Real Vitest processes distinguish assertion failures from harness failures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { cleanProbeBaseline, classifyProbe } from './probe-results.mjs';
import ProbeReporter from './probe-reporter.mjs';

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

/**
 * The reporter pairs a hook's start and end by count, not by order. Vitest
 * reports each update batch from the worker without waiting for the previous
 * one, so a hook's end that opens one batch can reach the reporter before its
 * start that closed the batch before it.
 */
function incompleteHooks(calls) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-probe-hooks-'));
  const previous = process.env.FORMA_PROBE_REPORT;
  try {
    process.env.FORMA_PROBE_REPORT = join(dir, 'report.json');
    const reporter = new ProbeReporter();
    for (const [kind, id, name] of calls) reporter[kind === 'start' ? 'onHookStart' : 'onHookEnd']({ name, entity: { id } });
    reporter.onTestRunEnd([], [], 'passed');
    return JSON.parse(readFileSync(process.env.FORMA_PROBE_REPORT, 'utf8')).incompleteHooks;
  } finally {
    if (previous === undefined) delete process.env.FORMA_PROBE_REPORT; else process.env.FORMA_PROBE_REPORT = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
test('a hook whose end is reported before its start is complete', () => {
  assert.deepEqual(incompleteHooks([['start', 't1', 'beforeEach'], ['end', 't1', 'afterEach'], ['end', 't1', 'beforeEach'], ['start', 't1', 'afterEach']]), []);
});
test('a hook that starts and never ends is incomplete, whatever else is reordered', () => {
  assert.deepEqual(incompleteHooks([['start', 't1', 'afterEach']]), ['t1:afterEach']);
  assert.deepEqual(incompleteHooks([['end', 't1', 'afterEach'], ['start', 't1', 'afterEach'], ['start', 't2', 'afterEach'], ['start', 't3', 'beforeEach'], ['end', 't3', 'beforeEach']]), ['t2:afterEach']);
});
test('a key that starts twice needs two ends, in either order', () => {
  assert.deepEqual(incompleteHooks([['start', 's', 'beforeAll'], ['start', 's', 'beforeAll'], ['end', 's', 'beforeAll']]), ['s:beforeAll']);
  assert.deepEqual(incompleteHooks([['end', 's', 'beforeAll'], ['start', 's', 'beforeAll'], ['start', 's', 'beforeAll'], ['end', 's', 'beforeAll']]), []);
  // An end with no start is not an open hook.
  assert.deepEqual(incompleteHooks([['end', 's', 'afterAll']]), []);
});

/** Run the actual campaign CLI, not a simulation of its continuation branch. */
function runCampaign(firstReplacement, body = '', timeout = 5000) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-probe-campaign-'));
  const original = 'export const mode = 0;\n';
  try {
    symlinkSync(modules, join(dir, 'node_modules'), 'junction');
    mkdirSync(join(dir, 'probes'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(dir, 'vitest.config.mjs'), "export default {test:{environment:'node',include:['*.test.mjs']}};\n");
    writeFileSync(join(dir, 'subject.mjs'), original);
    writeFileSync(join(dir, 'case.test.mjs'), `import {test,expect} from 'vitest';
import {existsSync,writeFileSync} from 'node:fs';
import {mode} from './subject.mjs';
test('mutation behavior', async()=>{
  ${body}
  if(mode===1) throw new TypeError('missing body value');
  expect(mode).toBe(0);
}, ${timeout});\n`);
    writeFileSync(join(dir, 'probes/corpus.json'), JSON.stringify([
      { id: 'first', file: 'subject.mjs', find: original.trim(), replace: firstReplacement, equivalent: 'must not exempt an unqualified failure' },
      { id: 'next', file: 'subject.mjs', find: original.trim(), replace: 'export const mode = 2;' },
    ]));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-probes.mjs', import.meta.url)), '--floor=85'], {
      cwd: dir, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, output); assert.equal(result.signal, null, output);
    assert.equal(result.status, 1, 'an unqualified campaign must remain failed: ' + output);
    assert.equal(readFileSync(join(dir, 'subject.mjs'), 'utf8'), original, 'actual mutation source restored');
    const results = JSON.parse(readFileSync(join(dir, 'probes/results.json'), 'utf8'));
    return { results, output, recovery: results[0].recovery ? JSON.parse(readFileSync(results[0].recovery.evidence, 'utf8')) : null };
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

test('actual campaign continues after clean recovery but remains failed despite a later assertion kill', () => {
  const { results, recovery, output } = runCampaign('export const mode = 1;');
  assert.deepEqual(results.map(row => row.status), ['UNQUALIFIED', 'CAUGHT'], output);
  assert.equal(results[0].killedBy, null); assert.equal(results[0].recovery.passed, true);
  assert.equal(recovery.reason, 'passed');
  assert.equal(results[1].failedAssertions, 1);
  assert.match(results[1].killedBy, /mutation behavior/);
  assert.match(output, /mutation campaign is unqualified/);
});
test('actual campaign stops on a collection error without trying recovery or the next mutant', () => {
  const { results, output } = runCampaign('export const mode = ;');
  assert.deepEqual(results.map(row => row.status), ['UNQUALIFIED'], output);
  assert.equal(results[0].recovery, undefined);
});
test('actual campaign stops on a completed test timeout without trying the next mutant', () => {
  const { results, output } = runCampaign('export const mode = 1;', "if(mode===1) await new Promise(()=>{});", 50);
  assert.deepEqual(results.map(row => row.status), ['UNQUALIFIED'], output);
  assert.equal(results[0].recovery, undefined);
});
test('actual campaign requires a clean recovery baseline before running a later mutant', () => {
  const { results, recovery, output } = runCampaign('export const mode = 1;', `
  if(mode===1) writeFileSync('dirty-state', 'persisted');
  if(mode===0) expect(existsSync('dirty-state')).toBe(false);`);
  assert.deepEqual(results.map(row => row.status), ['UNQUALIFIED'], output);
  assert.equal(results[0].recovery.passed, false);
  assert.match(results[0].recovery.error, /clean baseline/);
  assert.notEqual(recovery.reason, 'passed');
});
