import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectBundle, staticImports } from '../client-race/bundle-graph.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t, entries) {
  const folder = mkdtempSync(path.join(tmpdir(), 'gp-bundle-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const dist = path.join(folder, 'dist'); mkdirSync(dist);
  for (const [name, source] of Object.entries(entries)) {
    const file = path.join(dist, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, source);
  }
  return { folder, dist };
}
test('module parser includes static imports/re-exports, ignores dynamic imports and does not execute source', () => {
  assert.deepEqual(staticImports(`/* import "https://false.example/a.js" */
    const message = 'import "./not-real.js"';
    throw new Error('MUST NOT EXECUTE');
    import './one.js'; export { x } from '/two.js'; import('./excluded-lazy.js');
  `), ['./one.js', '/two.js']);
  assert.throws(() => staticImports('export {'), /Cannot parse/);
});
test('complete local graph counts inline imports, preload, cyclic and repeated references once', async t => {
  const f = fixture(t, {
    'index.html': '<script type="module" src="./main.js"></script><link href="/dep.js" rel="modulepreload"><script type="module">import "./inline-dep.js";</script><script type="application/json">{"data":1}</script>',
    'main.js': 'import { value } from "./dep.js"; export const result=value; import("./intentionally-not-present.js");',
    'dep.js': 'import "./main.js"; export const value=1;',
    'inline-dep.js': 'export const inline=true;',
  });
  const graph = await collectBundle(f.dist);
  assert.deepEqual(graph.files.map(x => x.file).sort(), ['dep.js', 'inline-dep.js', 'main.js']);
  assert.deepEqual(graph.inlineSources, ['import "./inline-dep.js";']);
  for (const entry of graph.files) assert.deepEqual(entry.bytes, readFileSync(path.join(f.dist, entry.file)));
});
test('missing entry and imported scripts, empty workloads, invalid JS and unsupported sources fail closed', async t => {
  const cases = [
    { 'index.html': '<script src="missing.js"></script>' },
    { 'index.html': '<script type="module" src="main.js"></script>', 'main.js': 'import "./missing.js";' },
    { 'index.html': '<script type="module" src="main.js"></script>', 'main.js': 'export * from "https://remote.example/module.js";' },
    { 'index.html': '<script src="//remote.example/app.js"></script>' },
    { 'index.html': '<script src="data:text/javascript,alert(1)"></script>' },
    { 'index.html': '<script type="module" src="main.js"></script>', 'main.js': 'import "unknown-package";' },
    { 'index.html': '<script type="module">import "./missing.js";</script>' },
    { 'index.html': '<script type="application/json">{"data":1}</script>' },
    { 'index.html': '<script type="module" src="main.js"></script>', 'main.js': 'export {' },
    { 'index.html': '<script src="main.js?alternate"></script>', 'main.js': 'export {}' },
    { 'index.html': '<script type="importmap">{}</script><script src="main.js"></script>', 'main.js': 'export {}' },
  ];
  for (const entries of cases) { const f = fixture(t, entries); await assert.rejects(collectBundle(f.dist)); }
});
test('lexical escapes, encoded escapes and symlinks cannot read outside dist', async t => {
  for (const reference of ['../outside.js', '%2e%2e/outside.js', '/../../outside.js']) {
    const f = fixture(t, { 'index.html': `<script src="${reference}"></script>` });
    writeFileSync(path.join(f.folder, 'outside.js'), 'export const secret=1;');
    await assert.rejects(collectBundle(f.dist), /escapes dist/);
  }
  const f = fixture(t, { 'index.html': '<script src="linked.js"></script>' });
  writeFileSync(path.join(f.folder, 'outside.js'), 'export const secret=1;');
  symlinkSync(path.join(f.folder, 'outside.js'), path.join(f.dist, 'linked.js'));
  await assert.rejects(collectBundle(f.dist), /symlink escapes dist/);
});
test('bundle command retains failed evidence and refuses replacing it', t => {
  const f = fixture(t, { 'index.html': '<script src="missing.js"></script>' });
  const client = path.join(f.folder, 'client-race'), harness = path.join(f.folder, 'harness');
  mkdirSync(client); mkdirSync(harness);
  for (const file of ['bundle.mjs', 'bundle-graph.mjs', 'lib.mjs']) copyFileSync(path.join(root, 'client-race', file), path.join(client, file));
  for (const file of ['campaign.mjs', 'resource-profile.mjs']) copyFileSync(path.join(root, 'harness', file), path.join(harness, file));
  mkdirSync(path.join(client, 'apps/forma/dist'), { recursive: true });
  copyFileSync(path.join(f.dist, 'index.html'), path.join(client, 'apps/forma/dist/index.html'));
  const out = path.join(f.folder, 'results'), env = { ...process.env }; delete env.GP_CAMPAIGN_FILE;
  const run = () => spawnSync(process.execPath, [path.join(client, 'bundle.mjs'), '--cars', 'forma', '--out', out], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(run().status, 1);
  const raw = readFileSync(path.join(out, 'forma.json'), 'utf8'), record = JSON.parse(raw);
  assert.equal(record.verified, false); assert.equal(record.status, 'failed'); assert.equal(record.bytes, undefined);
  assert.match(record.error, /missing\.js/);
  assert.match(run().stderr, /Refusing to overwrite/);
  assert.equal(readFileSync(path.join(out, 'forma.json'), 'utf8'), raw);
});
