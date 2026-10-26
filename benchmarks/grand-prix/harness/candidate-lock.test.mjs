import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkCandidateLock } from './candidate-lock.mjs';

const original = readFileSync(new URL('../contestants/forma/Cargo.lock', import.meta.url), 'utf8');
const names = ['forma-ir', 'forma-ir-derive', 'forma-server'];
const version = '3.1.0-rc.3';
const packageBlocks = text => text.match(/^\[\[package\]\]\n[\s\S]*?(?=^\[\[|$(?![\s\S]))/gm) ?? [];
const selected = original.replace(/^\[\[package\]\]\n[\s\S]*?(?=^\[\[|$(?![\s\S]))/gm, block => {
  if (!names.some(name => block.includes('name = "' + name + '"\n'))) return block;
  return block.replace(/^version = "[^"]+"/m, 'version = "' + version + '"')
    .replace(/^source = .*\n/m, '').replace(/^checksum = .*\n/m, '');
});
const ids = Object.fromEntries(names.map(name => [name, 'path+file:///candidate/crates/' + name + '#' + version]));
const rootId = 'path+file:///app#grandprix-forma@0.1.0';
function metadata() {
  return { packages: [
    { name: 'grandprix-forma', version: '0.1.0', id: rootId, source: null, manifest_path: '/app/Cargo.toml' },
    ...names.map(name => ({ name, version, id: ids[name], source: null, manifest_path: '/candidate/crates/' + name + '/Cargo.toml' })),
  ], resolve: { root: rootId, nodes: [
    { id: rootId, dependencies: [ids['forma-ir'], ids['forma-server']] },
    { id: ids['forma-ir'], dependencies: [ids['forma-ir-derive']] },
    { id: ids['forma-ir-derive'], dependencies: [] },
    { id: ids['forma-server'], dependencies: [ids['forma-ir']] },
  ] } };
}
const check = (lock = selected, meta = metadata(), v = version) => checkCandidateLock(original, lock, [], { version: v, metadata: meta });

test('selected prerelease must be three resolved local crates in the consumer graph', () => check());
test('published registry crates plus unused prerelease patches reproduce the false green and must fail', () => {
  const unused = names.map(name => '\n[[patch.unused]]\nname = "' + name + '"\nversion = "' + version + '"\n').join('');
  assert.throws(() => check(original + unused), /Forma|candidate|patch/);
});
test('missing expected candidate identity is refused', () => assert.throws(() => checkCandidateLock(original, selected), /candidate|version|metadata/));
for (const [name, mutate] of [
  ['registry fallback', text => text.replace(packageBlocks(selected).find(b => b.includes('name = "forma-ir"\n')), packageBlocks(original).find(b => b.includes('name = "forma-ir"\n')))],
  ['wrong candidate version', text => text.replace('version = "' + version + '"', 'version = "3.1.0-rc.2"')],
  ['missing candidate crate', text => text.replace(packageBlocks(selected).find(b => b.includes('name = "forma-ir-derive"\n')), '')],
  ['duplicate candidate crate', text => text + packageBlocks(selected).find(b => b.includes('name = "forma-server"\n'))],
  ['unused candidate patch', text => text + '\n[[patch.unused]]\nname = "forma-server"\nversion = "' + version + '"\n'],
  ['extra local dependency', text => text + '\n[[package]]\nname = "unreviewed-local"\nversion = "1.0.0"\n'],
]) test('refuses ' + name, () => assert.throws(() => check(mutate(selected))));
for (const [name, mutate] of [
  ['wrong manifest path', m => { m.packages[1].manifest_path = '/other/crates/forma-ir/Cargo.toml'; }],
  ['registry source', m => { m.packages[1].source = 'registry+https://github.com/rust-lang/crates.io-index'; }],
  ['wrong metadata version', m => { m.packages[1].version = '3.0.0'; }],
  ['unreachable candidate', m => { m.resolve.nodes[1].dependencies = []; }],
  ['missing resolved candidate node', m => { m.resolve.nodes.pop(); }],
  ['duplicate candidate package', m => { m.packages.push({ ...m.packages[1] }); }],
  ['wrong consumer root', m => { m.resolve.root = ids['forma-server']; }],
]) test('metadata refuses ' + name, () => { const m = metadata(); mutate(m); assert.throws(() => check(selected, m)); });

