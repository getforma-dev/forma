import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, stageTemplateSource, withStagedTemplates } from './release-set.mjs';

const candidate = [{ registry: 'crates', name: 'forma-server', version: '3.0.0-dev', sha256: 'a'.repeat(64) }];
function source(template) { return readFileSync(join(ROOT, 'packages/create-app/templates', template, 'src/main.rs'), 'utf8'); }

test('the candidate source adapter stages finalized typed APIs; A2 source remains byte-identical', () => {
  for (const template of ['minimal', 'dashboard']) {
    const original = source(template);
    assert.equal(stageTemplateSource(original, '0.2.2'), original);
    const staged = stageTemplateSource(original, '3.0.0-dev');
    assert.equal(staged, readFileSync(join(ROOT, 'scripts/fixtures/candidate-templates', `${template}.rs`), 'utf8'));
    assert(staged.includes('pages.finalize()'));
    assert(staged.indexOf('pages.finalize()') < staged.indexOf('tokio::net::TcpListener::bind'));
    assert(!/\b(?:try_render|load_ir_modules_strict|RenderMode|SlotData)\b/.test(staged));
    assert(staged.includes('config_json: None,'));
    for (const bad of [original.replace('config_script: None,', 'config_script: Some("unexpected"),'), original + '\n config_script: None,\n', original.replace('config_script: None,', '')]) {
      assert.throws(() => stageTemplateSource(bad, '3.0.0-dev'), /exact reviewed A2 source digest/);
    }
    assert.throws(() => stageTemplateSource(original, '3.1.0-dev'), /only for candidate 3.0.x/);
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
    assert.throws(() => withStagedTemplates(root, candidate, root, () => { packed = true; }), /exact reviewed A2 source digest/);
    assert.equal(packed, false);
    for (const [path, bytes] of before) assert.deepEqual(readFileSync(path), bytes, path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
