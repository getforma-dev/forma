// Historical Git-object controls run only in the full-history release-helper lane.
// Common source-inventory tests must also work in default shallow checkouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, versionFiles, json, run } from './release-set.mjs';
import { CRATE_PACKAGES, npmPackagesForVersion } from './release-package-inventory.mjs';
import { LEGACY_SEED_TEMPLATES, SEED_MARKER } from './template-lock-seeds.mjs';

function archivedLegacySource(t) {
  const root = mkdtempSync(join(tmpdir(), 'forma-legacy-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revision = '12320f4340d87cbb96575b5bb3b7eab42121d477'; // published v3.0.0-rc.5
  const paths = ['Cargo.toml', 'Cargo.lock', 'e2e/Cargo.lock', 'fuzz/Cargo.lock', 'package-lock.json', SEED_MARKER,
    ...CRATE_PACKAGES.map(name => `crates/${name}/Cargo.toml`),
    ...npmPackagesForVersion('3.0.0').map(name => `packages/${name}/package.json`),
    ...LEGACY_SEED_TEMPLATES.flatMap(name => ['Cargo.toml', 'Cargo.lock', 'admin/package.json', 'admin/package-lock.json'].map(file => `packages/create-app/templates/${name}/${file}`))];
  for (const path of paths) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), run('git', ['show', `${revision}:${path}`], ROOT)); }
  return root;
}
test('explicit legacy preparation reproduces the actual archived four-npm/two-template RC inventory', t => {
  const root = archivedLegacySource(t), files = versionFiles(root, '3.0.0', { legacyInventory: true });
  assert(!files.has('packages/router/package.json'));
  assert.deepEqual(JSON.parse(files.get(SEED_MARKER)), { schema: 1, version: '3.0.0', templates: LEGACY_SEED_TEMPLATES });
  assert(![...files.keys()].some(path => path.includes('/native-router/')));
  assert.equal(JSON.parse(files.get('packages/core/package.json')).version, '3.0.0');
  assert.throws(() => versionFiles(root, '3.0.0'), /packages[/\\]router[/\\]package.json/, 'default source preparation must not infer inventory from missing files');
  assert.throws(() => versionFiles(root, '3.2.0', { legacyInventory: true }), /legacy source inventory/);
  assert.throws(() => versionFiles(root, '3.2.0'), /packages[/\\]router[/\\]package.json/);
});
test('legacy inventory refuses mixed archived workspace declarations and unknown seed markers', t => {
  const root = archivedLegacySource(t), lock = json(join(root, 'package-lock.json'));
  lock.packages[''].workspaces.push('packages/router'); writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => versionFiles(root, '3.0.0', { legacyInventory: true }), /archived workspace declaration/);
  lock.packages[''].workspaces.pop(); writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  const marker = json(join(root, SEED_MARKER)); marker.templates.push('unknown'); writeFileSync(join(root, SEED_MARKER), JSON.stringify(marker));
  assert.throws(() => versionFiles(root, '3.0.0', { legacyInventory: true }), /source template seed identity/);
});
