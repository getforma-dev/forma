import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const BASELINE_SOURCE = '3d9de62d0709e8158cadd62be387ff1481ca9e66';

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
    // Keep every external package at its original locked version. Cargo only
    // substitutes the three source crates from this recorded commit. The
    // normalized resulting lock is retained with the race evidence.
    const dockerfile = join(car, 'Dockerfile');
    let docker = readFileSync(dockerfile, 'utf8');
    const anchor = 'COPY admin/build.ts admin/tsconfig.json admin/';
    assert.equal(docker.split(anchor).length, 2, 'candidate Docker anchor drift');
    const names = ['forma-ir', 'forma-ir-derive', 'forma-server'];
    const patch = '\n[patch.crates-io]\n' + names.map(name => `${name} = { path = "/candidate/crates/${name}" }`).join('\n') + '\n';
    writeFileSync(join(car, 'candidate-patch.toml'), patch);
    copyFileSync(join(root, 'harness/candidate-lock.mjs'), join(car, 'check-candidate-lock.mjs'));
    const extraFiles = compression ? ' compression-codecs.json' : '';
    if (compression) {
      copyFileSync(join(root, 'harness/compression-codecs.json'), join(car, 'compression-codecs.json'));
      const manifest = join(car, 'Cargo.toml'), text = readFileSync(manifest, 'utf8');
      assert.equal(text.split('forma-server = "^3.0.0"').length, 2, 'compression dependency anchor drift');
      writeFileSync(manifest, text.replace('forma-server = "^3.0.0"', 'forma-server = { version = "^3.0.0", features = ["compression"] }'));
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
      docker = docker.replace('COPY Cargo.toml Cargo.lock ./', 'COPY Cargo.lock ./\nCOPY Cargo.registry.toml Cargo.toml');
      writeFileSync(join(car, 'Cargo.registry.toml'), text);
    }
    docker = docker.replace(anchor, [
      'COPY candidate /candidate',
      'COPY candidate-patch.toml check-candidate-lock.mjs' + extraFiles + ' ./',
      ...(compression ? ['COPY Cargo.toml ./'] : []),
      "RUN mkdir -p src && echo 'fn main() {}' > src/main.rs && cp Cargo.lock Cargo.registry.lock && cat candidate-patch.toml >> Cargo.toml && cargo update " + (compression ? '' : '--offline ') + '-p forma-ir -p forma-ir-derive -p forma-server && node check-candidate-lock.mjs' + (compression ? ' --compression && cargo fetch --locked' : '') + ' && rm -rf src',
      anchor,
    ].join('\n'));
    writeFileSync(dockerfile, docker);
    writeFileSync(join(car, 'source-commit.txt'), formaRef + '\n');
  }
  return directory;
}
