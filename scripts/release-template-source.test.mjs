import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, stageTemplateSource, withStagedTemplates } from './release-set.mjs';

const candidate = [{ registry: 'crates', name: 'forma-server', version: '3.0.0-dev', sha256: 'a'.repeat(64) }];
function source(template) { return readFileSync(join(ROOT, 'packages/create-app/templates', template, 'src/main.rs'), 'utf8'); }

test('the candidate source adapter removes only the known unused field; A2 source remains byte-identical', () => {
  for (const template of ['minimal', 'dashboard']) {
    const original = source(template);
    assert.equal(stageTemplateSource(original, '0.2.2'), original);
    const staged = stageTemplateSource(original, '3.0.0-dev');
    assert.equal(staged, original.replace(/^\s+config_script: None,\r?\n/m, ''));
    assert(staged.includes('config_json: None,'));
    for (const bad of [original.replace('config_script: None,', 'config_script: Some("unexpected"),'), original + '\n config_script: None,\n', original.replace('config_script: None,', '')]) {
      assert.throws(() => stageTemplateSource(bad, '3.0.0-dev'), /exactly one known/);
    }
    assert.throws(() => stageTemplateSource(original, '4.0.0-dev'), /reviewed only for candidate 3.x/);
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-template-source-'));
  const before = new Map();
  for (const template of ['minimal', 'dashboard']) {
    const dir = join(root, 'packages/create-app/templates', template);
    mkdirSync(join(dir, 'admin'), { recursive: true }); mkdirSync(join(dir, 'src'));
    for (const [name, text] of [
      ['admin/package.json', '{}\n'], ['admin/package-lock.json', '{"packages":{"":{}}}\n'],
      ['Cargo.toml', '[dependencies]\nforma-server = "0.2.2"\n'],
      ['Cargo.lock', 'version = 4\n\n[[package]]\nname = "forma-server"\nversion = "0.2.2"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "old"\n'],
      ['src/main.rs', source(template)],
    ]) { const path = join(dir, name); writeFileSync(path, text); before.set(path, readFileSync(path)); }
  }
  return { root, before };
}

test('all ten template source/manifests/locks restore when candidate packing throws', () => {
  const { root, before } = fixture();
  try {
    assert.throws(() => withStagedTemplates(root, candidate, root, () => {
      for (const template of ['minimal', 'dashboard']) {
        const dir = join(root, 'packages/create-app/templates', template);
        assert(!readFileSync(join(dir, 'src/main.rs'), 'utf8').includes('config_script: None,'));
        assert(readFileSync(join(dir, 'Cargo.toml'), 'utf8').includes('=3.0.0-dev'));
      }
      throw new Error('controlled pack failure');
    }), /controlled pack failure/);
    for (const [path, bytes] of before) assert.deepEqual(readFileSync(path), bytes, path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unexpected source in the second template fails before either template changes', () => {
  const { root, before } = fixture();
  try {
    const broken = join(root, 'packages/create-app/templates/dashboard/src/main.rs');
    writeFileSync(broken, source('dashboard').replace('config_script: None,', 'config_script: Some("unexpected"),'));
    before.set(broken, readFileSync(broken));
    let packed = false;
    assert.throws(() => withStagedTemplates(root, candidate, root, () => { packed = true; }), /exactly one known/);
    assert.equal(packed, false);
    for (const [path, bytes] of before) assert.deepEqual(readFileSync(path), bytes, path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
