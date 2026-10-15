import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './release-set.mjs';
import { requireAssetIntegrity, verifyPackedIntegrityTests } from './verify-release-set.mjs';
const integrity = `sha384-${'A'.repeat(64)}`;
const manifest = { assets: { 'app.js': { integrity }, 'style.css': { integrity }, 'chunk.js': { integrity } }, routes: { '/': { js: ['app.js'], css: ['style.css'] } } };
const resources = [
  { tag: 'LINK', rel: 'stylesheet', url: '/_assets/style.css', integrity, crossorigin: 'anonymous' },
  { tag: 'LINK', rel: 'modulepreload', url: '/_assets/app.js', integrity, crossorigin: 'anonymous', nonce: 'fixture' },
  { tag: 'LINK', rel: 'modulepreload', url: '/_assets/chunk.js', integrity, crossorigin: 'anonymous', nonce: 'fixture' },
  { tag: 'SCRIPT', rel: null, url: '/_assets/app.js', integrity, crossorigin: 'anonymous', nonce: 'fixture' },
];
test('packed resource observations require exact digests and preserved nonce/crossorigin', () => {
  assert.deepEqual(requireAssetIntegrity(resources, manifest), resources);
  for (const [field,value,reason] of [['integrity',null,/integrity/],['nonce','',/nonce/],['crossorigin',null,/crossorigin/],['url','/_assets/unknown.js',/manifest/]]) {
    const bad = structuredClone(resources); bad[3][field] = value;
    assert.throws(() => requireAssetIntegrity(bad,manifest),reason);
  }
  assert.throws(() => requireAssetIntegrity(resources.slice(1),manifest),/missing or duplicated/);
  assert.throws(() => requireAssetIntegrity([...resources,resources[3]],manifest),/duplicated/);
  assert.throws(() => requireAssetIntegrity([...resources,resources[2]],manifest),/duplicated/);
});
const names = ['both_public_document_paths_write_exact_integrity_and_keep_nonces','every_asset_requires_full_canonical_integrity_before_startup','constructed_browser_manifests_and_stale_preload_tables_refuse_unchecked_tags'];
function fixture(change, check) {
  const dir = mkdtempSync(join(tmpdir(),'forma-packed-integrity-'));
  try {
    mkdirSync(join(dir,'tests'));
    writeFileSync(join(dir,'Cargo.toml'),'[package]\nname="forma-packed-integrity"\nversion="0.0.0"\nedition="2021"\n[workspace]\n');
    writeFileSync(join(dir,'tests/asset_integrity.rs'),change(names.map(name=>`#[test] fn ${name}() {}`).join('\n')));
    const manifest = join(dir,'Cargo.toml');
    run('cargo',['generate-lockfile','--offline','--manifest-path',manifest],dir);
    check(manifest);
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
test('packed native integrity checks execute and refuse missing or skipped coverage', () => {
  fixture(source=>source,verifyPackedIntegrityTests);
  fixture(()=>'',manifest=>assert.throws(()=>verifyPackedIntegrityTests(manifest),/missing/));
  fixture(source=>source.replace('#[test]','#[test] #[ignore]'),manifest=>assert.throws(()=>verifyPackedIntegrityTests(manifest),/did not execute/));
});
