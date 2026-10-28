import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_SOURCE, candidateVersion, pinCandidateManifest, prepareCars } from './prepare-car.mjs';

const manifest = '[dependencies]\nforma-ir = "^3.0.0"\nforma-server = "^3.0.0"\naxum = "0.8"\n';
for (const version of ['3.0.0', '3.1.0-rc.3', '3.1.0']) test('pins exact selected ' + version + ' including compression', () => {
  assert.equal(candidateVersion('[workspace]\nresolver = "2"\n[workspace.package]\nversion = "' + version + '"\n[workspace.dependencies]\n'), version);
  for (const compression of [false, true]) {
    const pinned = pinCandidateManifest(manifest, version, compression);
    assert(pinned.includes('forma-ir = "=' + version + '"'));
    assert(pinned.includes(compression ? 'forma-server = { version = "=' + version + '", features = ["compression"] }' : 'forma-server = "=' + version + '"'));
    assert(pinned.includes('axum = "0.8"'));
  }
});
test('missing, ambiguous and injectable version/consumer anchors fail closed', () => {
  for (const workspace of ['', '[workspace.package]\n', '[workspace.package]\nversion = "3.0.0"\nversion = "3.1.0"\n', '[workspace.package]\nversion = "3.0.0; command"\n']) assert.throws(() => candidateVersion(workspace));
  assert.throws(() => pinCandidateManifest(manifest.replace('forma-ir = "^3.0.0"\n', ''), '3.1.0-rc.3'));
  assert.throws(() => pinCandidateManifest(manifest, '3.1.0-rc.3"\nx = "bad'));
});
test('actual frozen-car context fetches registry dependencies first then selects and proves candidate paths', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const original = execFileSync('git', ['show', BASELINE_SOURCE + ':benchmarks/grand-prix/contestants/forma/Cargo.toml'], { cwd: root, encoding: 'utf8' });
  const scratch = mkdtempSync(join(tmpdir(), 'forma-candidate-context-'));
  try {
    for (const compression of [false, true]) {
      const dir = prepareCars(root, join(scratch, String(compression)), { baseline: true, formaRef: ref, compression });
      const car = join(dir, 'forma'), read = name => readFileSync(join(car, name), 'utf8');
      const source = JSON.parse(read('candidate-source.json'));
      assert.equal(source.commit, ref);
      assert.equal(source.version, candidateVersion(read('candidate/Cargo.toml')));
      assert.equal(read('Cargo.registry.toml'), original);
      assert.equal(read('Cargo.toml'), pinCandidateManifest(original, source.version, compression));
      const docker = read('Dockerfile');
      assert(docker.indexOf('COPY Cargo.registry.toml Cargo.toml') < docker.indexOf('cargo fetch --locked'));
      assert(docker.indexOf('COPY candidate /candidate') < docker.indexOf('COPY Cargo.toml ./'));
      assert(docker.includes('cargo metadata --locked --offline --format-version 1 > candidate-metadata.json'));
      assert(docker.indexOf('candidate-metadata.json') < docker.indexOf('node check-candidate-lock.mjs'));
      assert(docker.includes('candidate-source.json'));
      assert.equal(docker.includes('cargo update --offline'), !compression);
      if (compression) assert(docker.includes('node check-candidate-lock.mjs --compression'));
      for (const name of ['forma-ir', 'forma-ir-derive', 'forma-server'])
        assert(read('candidate-patch.toml').includes(name + ' = { path = "/candidate/crates/' + name + '" }'));
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('candidate binding proof survives image cleanup and all server lanes qualify refusals', () => {
  const driver = readFileSync(new URL('./linux-run.mjs', import.meta.url), 'utf8');
  assert(driver.includes("['Cargo.lock', 'candidate-source.json', 'candidate-metadata.json']"));
  assert(driver.includes('`${id}-forma-${file}`'));
  for (const name of ['grand-prix.yml', 'grand-prix-paired.yml', 'grand-prix-compression.yml']) {
    const workflow = readFileSync(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8');
    const applicationSuite = workflow.includes('npm test --prefix benchmarks/grand-prix');
    if (applicationSuite) {
      const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
      assert(scripts.test.includes('node --test') && scripts.test.includes('harness/*.test.mjs'), 'application suite must include every harness refusal control');
    } else {
      assert(workflow.includes('harness/candidate-lock.test.mjs'));
      assert(workflow.includes('harness/prepare-car.test.mjs'));
    }
    assert(workflow.includes('benchmarks/grand-prix/results/*.json'));
    assert(workflow.includes('benchmarks/grand-prix/results/*.lock'));
  }
});

