import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const BASELINE_SOURCE = '3d9de62d0709e8158cadd62be387ff1481ca9e66';

export function candidateVersion(workspace) {
  const sections = workspace.split(/(?=^\[)/m).filter(section => section.startsWith('[workspace.package]\n'));
  assert.equal(sections.length, 1, 'candidate workspace package section drift');
  const versions = [...sections[0].matchAll(/^version = "([^"]+)"$/gm)];
  assert.equal(versions.length, 1, 'candidate workspace version missing or ambiguous');
  const version = versions[0][1];
  assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version), 'invalid candidate workspace version');
  return version;
}

export function pinCandidateManifest(manifest, version, compression = false) {
  // The initial registry fetch still uses the frozen manifest. Only the
  // subsequent candidate resolution opts into this exact version/prerelease.
  assert.equal(candidateVersion(`[workspace.package]\nversion = "${version}"\n`), version);
  for (const name of ['forma-ir', 'forma-server']) {
    const anchor = `${name} = "^3.0.0"`;
    assert.equal(manifest.split(anchor).length, 2, `${name}: candidate dependency anchor drift`);
    manifest = manifest.replace(anchor, name === 'forma-server' && compression
      ? `${name} = { version = "=${version}", features = ["compression"] }`
      : `${name} = "=${version}"`);
  }
  return manifest;
}

export function prepareCars(root, directory, { baseline = false, formaRef, compression = false } = {}) {
  if (formaRef) assert(/^[a-f0-9]{40}$/.test(formaRef), 'Forma candidate requires an exact commit SHA');
  assert(!compression || formaRef, 'compression experiment requires an exact candidate commit');
  if (!baseline && !formaRef) return resolve(root, 'contestants');
  mkdirSync(directory); // Must be a fresh run-owned directory.
  const source = baseline ? BASELINE_SOURCE : 'HEAD';
  const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
  const bytes = execFileSync('git', ['archive', `${source}:benchmarks/grand-prix/contestants`],
    { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: bytes });
  if (formaRef) {
    const car = join(directory, 'forma'), candidate = join(car, 'candidate');
    mkdirSync(candidate);
    const archive = execFileSync('git', ['archive', formaRef, 'Cargo.toml', 'Cargo.lock', 'crates'],
      { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', candidate], { input: archive });
    const version = candidateVersion(readFileSync(join(candidate, 'Cargo.toml'), 'utf8'));
    // Keep every external package at its original locked version. Cargo only
    // substitutes the three source crates from this recorded commit. The
    // normalized resulting lock is retained with the race evidence.
    const dockerfile = join(car, 'Dockerfile');
    let docker = readFileSync(dockerfile, 'utf8');
    const anchor = 'COPY admin/build.ts admin/tsconfig.json admin/';
    assert.equal(docker.split(anchor).length, 2, 'candidate Docker anchor drift');
    const names = ['forma-ir', 'forma-ir-derive', 'forma-server'];
    for (const name of names) {
      const manifest = readFileSync(join(candidate, 'crates', name, 'Cargo.toml'), 'utf8');
      const section = manifest.split(/(?=^\[)/m).find(section => section.startsWith('[package]\n'));
      const declared = section?.match(/^version = "([^"]+)"$/m)?.[1];
      assert(declared === version || (!declared && /^version\.workspace = true$/m.test(section ?? '')),
        `${name}: candidate crate must use the selected workspace version`);
    }
    const patch = '\n[patch.crates-io]\n' + names.map(name => `${name} = { path = "/candidate/crates/${name}" }`).join('\n') + '\n';
    writeFileSync(join(car, 'candidate-patch.toml'), patch);
    writeFileSync(join(car, 'candidate-source.json'), JSON.stringify({ commit: formaRef, version }) + '\n');
    copyFileSync(join(root, 'harness/candidate-lock.mjs'), join(car, 'check-candidate-lock.mjs'));
    const manifestPath = join(car, 'Cargo.toml'), registryManifest = readFileSync(manifestPath, 'utf8');
    writeFileSync(join(car, 'Cargo.registry.toml'), registryManifest);
    writeFileSync(manifestPath, pinCandidateManifest(registryManifest, version, compression));
    docker = docker.replace('COPY Cargo.toml Cargo.lock ./', 'COPY Cargo.lock ./\nCOPY Cargo.registry.toml Cargo.toml');
    const extraFiles = compression ? ' compression-codecs.json' : '';
    if (compression) {
      copyFileSync(join(root, 'harness/compression-codecs.json'), join(car, 'compression-codecs.json'));
      const main = join(car, 'src/main.rs'), source = readFileSync(main, 'utf8');
      const handler = 'async fn ssr(State(state): State<Arc<AppState>>, Query(q): Query<HashMap<String, String>>) -> Response {';
      assert.equal(source.split(handler).length, 2, 'compression handler anchor drift');
      const start = source.indexOf(handler), response = source.indexOf('Ok(page) => page.into_response(),', start);
      assert(response > start, 'compression response anchor drift');
      const opted = source.slice(0, response) + source.slice(response).replace('Ok(page) => page.into_response(),', 'Ok(page) => page.with_compression(&headers).into_response(),');
      writeFileSync(main, opted.replace(handler, handler.replace(') -> Response {', ', headers: axum::http::HeaderMap) -> Response {')));
      // The published crate predates this feature, so its initial fetch must
      // precede enabling it. The source patch then resolves only reviewed new
      // codecs before the timed --locked --offline compilation begins.
    }
    docker = docker.replace(anchor, [
      'COPY candidate /candidate',
      'COPY candidate-patch.toml candidate-source.json check-candidate-lock.mjs' + extraFiles + ' ./',
      'COPY Cargo.toml ./',
      "RUN mkdir -p src && echo 'fn main() {}' > src/main.rs && cp Cargo.lock Cargo.registry.lock && cat candidate-patch.toml >> Cargo.toml && cargo update " + (compression ? '' : '--offline ') + '-p forma-ir -p forma-ir-derive -p forma-server' + (compression ? ' && cargo fetch --locked' : '') + ' && cargo metadata --locked --offline --format-version 1 > candidate-metadata.json && node check-candidate-lock.mjs' + (compression ? ' --compression' : '') + ' && rm -rf src',
      anchor,
    ].join('\n'));
    writeFileSync(dockerfile, docker);
    writeFileSync(join(car, 'source-commit.txt'), formaRef + '\n');
  }
  return directory;
}
