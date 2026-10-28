import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageUpdate, applyUpdate, checkUpdates } from '../src/updates.mjs';
import { writeJSON, readJSON } from '../src/session.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-update-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = 'signals-race/package.json', lock = 'signals-race/package-lock.json';
  writeJSON(path.join(root, manifest), { name: 'test-control', private: true, dependencies: { 'test-engine': '1.0.0' } });
  writeJSON(path.join(root, lock), { name: 'test-control', lockfileVersion: 3, packages: {
    '': { dependencies: { 'test-engine': '1.0.0' } }, 'node_modules/test-engine': { version: '1.0.0', integrity: 'sha512-old-control' },
  } });
  const originals = Object.fromEntries([manifest, lock].map(relative => [relative, fs.readFileSync(path.join(root, relative))]));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
assert.deepEqual(process.argv.slice(2),['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
const root=path.resolve(process.cwd(),'../../..');
const active=JSON.parse(fs.readFileSync(path.join(root,'.grandprix/active.json')));
assert.equal(active.operation,'update');
const pkg=JSON.parse(fs.readFileSync('package.json'));
const lock=JSON.parse(fs.readFileSync('package-lock.json'));
lock.packages[''].dependencies['test-engine']=pkg.dependencies['test-engine'];
lock.packages['node_modules/test-engine'].version=pkg.dependencies['test-engine'];
lock.packages['node_modules/test-engine'].integrity='sha512-new-control';
fs.writeFileSync('package-lock.json',JSON.stringify(lock));
console.log('Synthetic resolver control; no network or package installation.');
`);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  const beforePath = process.env.PATH; process.env.PATH = bin + path.delimiter + beforePath;
  t.after(() => { process.env.PATH = beforePath; });
  return { root, manifest, lock, originals };
}
test('exact dependency update stages separately, preserves baseline bytes and applies with an audit receipt', t => {
  const f = fixture(t), staged = stageUpdate(f.root, 'test-engine', '2.0.0');
  assert.equal(staged.status, 'staged'); assert.equal(staged.changes.length, 2);
  assert(!fs.existsSync(path.join(f.root, '.grandprix/active.json')));
  for (const [relative, original] of Object.entries(f.originals)) {
    assert.deepEqual(fs.readFileSync(path.join(f.root, relative)), original);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'updates', staged.id, 'before', relative)), original);
  }
  const result = applyUpdate(f.root, staged.id);
  assert.equal(result.status, 'applied-unqualified');
  assert.equal(readJSON(path.join(f.root, f.manifest)).dependencies['test-engine'], '2.0.0');
  assert.equal(readJSON(path.join(f.root, f.lock)).packages['node_modules/test-engine'].version, '2.0.0');
  assert.deepEqual(readJSON(path.join(f.root, 'config/updates', `${staged.id}.json`)), result);
  assert(fs.existsSync(path.join(f.root, 'updates', staged.id, 'apply-intent.json')));
  assert(!fs.existsSync(path.join(f.root, '.grandprix/active.json')));
  assert.throws(() => applyUpdate(f.root, staged.id), /not staged/);
});
test('receipt write failure rolls back both source files and staged status; retry remains possible', t => {
  const f = fixture(t), staged = stageUpdate(f.root, 'test-engine', '2.0.0');
  const audit = path.join(f.root, 'config/updates', `${staged.id}.json`);
  const write = fs.writeFileSync; let injected = false;
  fs.writeFileSync = function(file, ...args) {
    if (String(file) === audit && !injected) { injected = true; throw new Error('injected audit write failure'); }
    return write.call(this, file, ...args);
  };
  try { assert.throws(() => applyUpdate(f.root, staged.id), /injected audit/); }
  finally { fs.writeFileSync = write; }
  assert(injected);
  for (const [relative, original] of Object.entries(f.originals)) assert.deepEqual(fs.readFileSync(path.join(f.root, relative)), original);
  assert.equal(readJSON(path.join(f.root, 'updates', staged.id, 'update.json')).status, 'staged');
  assert(!fs.existsSync(audit)); assert(!fs.existsSync(path.join(f.root, '.grandprix/active.json')));
  assert.equal(applyUpdate(f.root, staged.id).status, 'applied-unqualified');
});
test('an unavailable registry is reported as unknown instead of an available update', async t => {
  const f = fixture(t), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('deliberate registry failure'); };
  try {
    const result = await checkUpdates(f.root);
    assert.equal(result.dependencies.length, 1); assert.equal(result.dependencies[0].updateAvailable, null);
    assert.equal(result.dependencies[0].latest, null); assert.match(result.packages[0].error, /deliberate registry/);
  } finally { globalThis.fetch = originalFetch; }
});
