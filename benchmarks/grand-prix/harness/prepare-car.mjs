import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

export const BASELINE_SOURCE = '3d9de62d0709e8158cadd62be387ff1481ca9e66';

export function prepareCars(root, directory, { baseline = false, formaRef } = {}) {
  if (formaRef) assert(/^[a-f0-9]{40}$/.test(formaRef), 'Forma candidate requires an exact commit SHA');
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
    writeFileSync(join(car, 'check-candidate-lock.mjs'), String.raw`import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const records = file => readFileSync(file,'utf8').split(/(?=^\[\[package\]\])/m).slice(1).map(block => {
  const field = key => new RegExp('^'+key+' = "([^"]+)"','m').exec(block)?.[1];
  return {name:field('name'),version:field('version'),source:field('source'),checksum:field('checksum')};
}).filter(p => p.source && !['forma-ir','forma-ir-derive','forma-server'].includes(p.name)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
assert.deepEqual(records('Cargo.lock'),records('Cargo.registry.lock'),'candidate changed an external dependency');
`);
    docker = docker.replace(anchor, [
      'COPY candidate /candidate',
      'COPY candidate-patch.toml check-candidate-lock.mjs ./',
      'RUN cp Cargo.lock Cargo.registry.lock && cat candidate-patch.toml >> Cargo.toml && cargo update --offline -p forma-ir -p forma-ir-derive -p forma-server && node check-candidate-lock.mjs',
      anchor,
    ].join('\n'));
    writeFileSync(dockerfile, docker);
    writeFileSync(join(car, 'source-commit.txt'), formaRef + '\n');
  }
  return directory;
}
