import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planCleanup, applyCleanup } from '../src/cleanup.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text = 'evidence') => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file; };
  put('runs/run-1/manifest.json', JSON.stringify({ runId: 'run-1', status: 'complete' }));
  const workspace = 'runs/run-1/artifacts/run-1-client/published/client-race';
  const bundle = put(`${workspace}/apps/forma/dist/main.js`, 'generated');
  const dependency = put(`${workspace}/node_modules/core/index.js`, 'installed');
  const source = put(`${workspace}/apps/forma/src/main.jsx`);
  const lock = put(`${workspace}/package-lock.json`);
  const raw = put('runs/run-1/artifacts/run-1-client/published/raw/dom/forma.json');
  const report = put('runs/run-1/report.html');
  return { root, put, bundle, dependency, source, lock, raw, report };
}
test('plan is read-only and apply preserves source, locks, raw observations and reports', async t => {
  const f = fixture(t), plan = await planCleanup(f.root, { runId: 'run-1' });
  assert.equal(plan.files.length, 1); assert(existsSync(f.bundle));
  const result = await applyCleanup(f.root, plan);
  assert(result.completed); assert(!existsSync(f.bundle)); assert(existsSync(result.receiptPath));
  for (const name of ['dependency', 'source', 'lock', 'raw', 'report']) assert(existsSync(f[name]), name);
  assert(!existsSync(path.join(f.root, '.grandprix/active.json')));
});
test('dependency deletion is explicit and does not follow internal dependency symlinks', async t => {
  const f = fixture(t);
  const external = f.put('external/keep.txt');
  symlinkSync(path.dirname(external), path.join(path.dirname(f.dependency), 'linked'));
  const plan = await planCleanup(f.root, { runId: 'run-1', includeDependencies: true });
  assert.equal(plan.files.length, 2); await applyCleanup(f.root, plan);
  assert(!existsSync(f.dependency)); assert(existsSync(external));
});
test('active or stale lock blocks cleanup and is never silently removed', async t => {
  const f = fixture(t); f.put('.grandprix/active.json', JSON.stringify({ pid: 999999999, runId: 'other' }));
  const plan = await planCleanup(f.root, { runId: 'run-1' });
  assert(plan.blocked.length); await assert.rejects(applyCleanup(f.root, plan), /active|unresolved/);
  assert(existsSync(f.bundle));
});
test('run traversal, linked ancestors and forged paths fail closed', async t => {
  const f = fixture(t);
  await assert.rejects(planCleanup(f.root, { runId: '../other' }), /run ID/);
  const plan = await planCleanup(f.root, { runId: 'run-1' });
  plan.files[0].path = 'runs/run-1/../../external';
  await assert.rejects(applyCleanup(f.root, plan), /stale/);
  symlinkSync(path.join(f.root, 'runs/run-1'), path.join(f.root, 'runs/run-2'));
  await assert.rejects(planCleanup(f.root, { runId: 'run-2' }), /linked/);
});
test('a changed tree requires a new plan', async t => {
  const f = fixture(t), plan = await planCleanup(f.root, { runId: 'run-1' });
  writeFileSync(f.bundle, 'changed after review');
  await assert.rejects(applyCleanup(f.root, plan), /stale/); assert(existsSync(f.bundle));
});
test('Docker cleanup requires exact ownership and never prunes globally', async t => {
  const f = fixture(t); f.put('runs/run-1/artifacts/run-1-ownership.json', JSON.stringify({ id: 'run-1', builder: 'gp264-run-1', builderCreated: false }));
  const calls = [], docker = args => {
    calls.push(args);
    if (args.includes('inspect')) return JSON.stringify([{ Config: { Labels: { gp264run: 'run-1', grandprix: 'forma-264' } } }]);
    if (args[0] === 'ps') { assert(args.includes('label=gp264run=run-1')); return 'abc123'; }
    return '';
  };
  const plan = await planCleanup(f.root, { runId: 'run-1', includeDocker: true, docker });
  assert.equal(plan.docker.length, 1); assert.equal(plan.blocked.length, 0);
  await applyCleanup(f.root, plan, { docker });
  assert(calls.some(args => args.join(' ') === 'container rm -f abc123'));
  assert(!calls.some(args => args.includes('prune')));
});
test('foreign Docker ownership is refused before mutations', async t => {
  const f = fixture(t); f.put('runs/run-1/artifacts/run-1-ownership.json', JSON.stringify({ id: 'other', builder: 'gp264-run-1', builderCreated: true }));
  const plan = await planCleanup(f.root, { runId: 'run-1', includeDocker: true, docker: () => { throw Error('must not query'); } });
  assert(plan.blocked.some(s => s.includes('ownership'))); await assert.rejects(applyCleanup(f.root, plan));
});
test('server raw and campaign paths follow GP_RESULTS_DIR without invoking Docker', () => {
  const library = new URL('../harness/lib.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(library)}); console.log(JSON.stringify({results:m.RESULTS,raw:m.RAW}));`], {
    env: { ...process.env, GP_RESULTS_DIR: '/tmp/gp-result-path', GP_RAW_DIR: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { results: '/tmp/gp-result-path', raw: '/tmp/gp-result-path/raw' });
});
test('a linked receipt folder is refused without leaving a lock or writing outside the run', async t => {
  const f = fixture(t), target = path.join(f.root, 'external-receipts'); mkdirSync(target);
  symlinkSync(target, path.join(f.root, 'runs/run-1/cleanup'));
  const plan = await planCleanup(f.root, { runId: 'run-1' });
  await assert.rejects(applyCleanup(f.root, plan), /linked/);
  assert(!existsSync(path.join(f.root, '.grandprix/active.json'))); assert(existsSync(f.bundle));
});
test('React Router production build is eligible but package source named build is preserved', async t => {
  const f = fixture(t);
  const output = f.put('runs/run-1/artifacts/run-1-contexts/react-router/build/server.js');
  const source = f.put('runs/run-1/artifacts/run-1-client/published/candidate/packages/build/src/index.ts');
  const plan = await planCleanup(f.root, { runId: 'run-1' }); await applyCleanup(f.root, plan);
  assert(!existsSync(output)); assert(existsSync(source));
});
