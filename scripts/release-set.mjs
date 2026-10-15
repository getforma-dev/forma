#!/usr/bin/env node
// Release preparation uses only Node's standard library. No command here publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NPM = ['core', 'compiler', 'build', 'create-app'];
export const CRATES = ['forma-ir', 'forma-ir-derive', 'forma-server'];
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:dev|(?:alpha|beta|rc)\.(?:0|[1-9]\d*)))?$/;
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
export const digest = (path, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(readFileSync(path)).digest(encoding);
export function run(command, args, cwd = ROOT, options = {}) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024, ...options });
}
export function setVersions(root = ROOT) {
  const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1'], root));
  return [
    ...CRATES.map(name => {
      const p = metadata.packages.find(p => p.name === name);
      assert(p, `missing crate ${name}`);
      return { registry: 'crates', name, version: p.version, path: `crates/${name}` };
    }),
    ...NPM.map(name => {
      const p = json(join(root, `packages/${name}/package.json`));
      return { registry: 'npm', name: p.name, version: p.version, path: `packages/${name}` };
    }),
  ];
}
export function assertReleaseSet(packages, tag) {
  const version = tag?.replace(/^v/, '');
  assert(tag?.startsWith('v') && SEMVER.test(version) && !version.endsWith('-dev'), 'release requires vX.Y.Z[-alpha.N|-beta.N|-rc.N]');
  assert(Number(version.split('.')[0]) >= 3, 'the unified workflow first publishes 3.0.0');
  assert.equal(packages.length, 7);
  for (const p of packages) assert.equal(p.version, version, `${p.name}: manifest disagrees with ${tag}`);
  return version;
}
function internal(name) { return name.startsWith('@getforma/') || CRATES.includes(name); }
function updateRequirements(p, version) {
  for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(p[kind] ?? {})) if (internal(name)) p[kind][name] = `=${version}`;
  }
}
export function versionFiles(root, version) {
  assert(SEMVER.test(version) && Number(version.split('.')[0]) >= 3, 'expected a 3.x-or-later release version or X.Y.Z-dev');
  const files = new Map();
  const read = p => readFileSync(join(root, p), 'utf8');
  let cargo = read('Cargo.toml');
  assert(/\[workspace.package\]\s*\nversion = "[^"]+"/.test(cargo));
  cargo = cargo.replace(/(\[workspace.package\]\s*\nversion = ")[^"]+"/, `$1${version}"`);
  files.set('Cargo.toml', cargo);
  for (const name of CRATES) {
    const path = `crates/${name}/Cargo.toml`;
    let text = read(path);
    text = text.replace(/^(version = ")[^"]+"/m, `$1${version}"`);
    text = text.replace(/^(forma-(?:ir|ir-derive|server)\s*=\s*\{[^\n]*?version\s*=\s*")[^"]+"/gm, `$1=${version}"`);
    files.set(path, text);
  }
  for (const name of NPM) {
    const path = `packages/${name}/package.json`, p = JSON.parse(read(path));
    p.version = version;
    updateRequirements(p, version);
    p.repository = { type: 'git', url: 'https://github.com/getforma-dev/forma.git', directory: `packages/${name}` };
    files.set(path, JSON.stringify(p, null, 2) + '\n');
  }
  const lock = JSON.parse(read('package-lock.json'));
  for (const [path, p] of Object.entries(lock.packages)) {
    if (NPM.some(name => path === `packages/${name}`)) p.version = version;
    updateRequirements(p, version);
  }
  files.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  for (const path of ['Cargo.lock', 'e2e/Cargo.lock']) {
    let text = read(path);
    text = text.replace(/(\[\[package\]\]\nname = "forma-(?:ir|ir-derive|server)"\nversion = ")[^"]+"/g, `$1${version}"`);
    files.set(path, text);
  }
  // Milestone template work belongs to FORMA-144; development alignment leaves A2 pins intact.
  for (const template of version.endsWith('-dev') ? [] : ['minimal', 'dashboard']) {
    const prefix = `packages/create-app/templates/${template}`;
    const p = JSON.parse(read(`${prefix}/admin/package.json`));
    updateRequirements(p, version);
    files.set(`${prefix}/admin/package.json`, JSON.stringify(p, null, 2) + '\n');
    files.set(`${prefix}/Cargo.toml`, read(`${prefix}/Cargo.toml`).replace(/^(forma-(?:ir|ir-derive|server) = ")[^"]+"/gm, `$1=${version}"`));
  }
  return files;
}

// Preserve every third-party resolution. Only candidate package versions, dependency metadata,
// URLs and checksums change; npm ci will refuse a stale third-party graph.
export function stageNpmLock(manifest, lock, packages, artifactDir, local = false) {
  lock = structuredClone(lock); manifest = structuredClone(manifest);
  for (const candidate of packages.filter(p => p.registry === 'npm')) {
    const key = `node_modules/${candidate.name}`;
    if (!lock.packages[key]) continue;
    const file = join(artifactDir, candidate.file);
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (manifest[kind]?.[candidate.name]) manifest[kind][candidate.name] = local ? `file:${file}` : `=${candidate.version}`;
    }
    const entry = lock.packages[key];
    entry.version = candidate.version;
    const short = candidate.name.split('/').at(-1);
    entry.resolved = local ? `file:${file}` : `https://registry.npmjs.org/${candidate.name}/-/${short}-${candidate.version}.tgz`;
    entry.integrity = `sha512-${digest(file, 'sha512', 'base64')}`;
    delete entry.link;
    const packed = JSON.parse(run('tar', ['-xOf', file, 'package/package.json']));
    for (const kind of ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'engines', 'bin']) {
      if (packed[kind]) entry[kind] = packed[kind]; else delete entry[kind];
    }
  }
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (manifest[kind]) lock.packages[''][kind] = manifest[kind];
  }
  return { manifest, lock };
}
export function stageCargoLock(text, packages, local = false) {
  return text.split(/(?=\[\[package\]\])/).map(block => {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const candidate = packages.find(p => p.registry === 'crates' && p.name === name);
    if (!candidate) return block;
    block = block.replace(/^version = "[^"]+"/m, `version = "${candidate.version}"`);
    if (local) return block.replace(/^source = .*\n/gm, '').replace(/^checksum = .*\n/gm, '');
    assert(/^checksum = /m.test(block), `template lock is missing checksum for ${name}`);
    return block.replace(/^checksum = "[^"]+"/m, `checksum = "${candidate.sha256}"`);
  }).join('');
}
export function stageTemplates(root, packages, out) {
  const originals = new Map();
  const stagedFiles = new Map();
  // Compute every replacement before touching the tree, so a malformed second template
  // cannot leave the first template staged when packing fails.
  for (const template of ['minimal', 'dashboard']) {
    const dir = join(root, 'packages/create-app/templates', template);
    for (const name of ['admin/package.json', 'admin/package-lock.json', 'Cargo.lock']) originals.set(join(dir, name), readFileSync(join(dir, name)));
    const staged = stageNpmLock(json(join(dir, 'admin/package.json')), json(join(dir, 'admin/package-lock.json')), packages, out);
    stagedFiles.set(join(dir, 'admin/package.json'), JSON.stringify(staged.manifest, null, 2) + '\n');
    stagedFiles.set(join(dir, 'admin/package-lock.json'), JSON.stringify(staged.lock, null, 2) + '\n');
    stagedFiles.set(join(dir, 'Cargo.lock'), stageCargoLock(readFileSync(join(dir, 'Cargo.lock'), 'utf8'), packages));
  }
  try { for (const [path, bytes] of stagedFiles) writeFileSync(path, bytes); }
  catch (error) { for (const [path, bytes] of originals) writeFileSync(path, bytes); throw error; }
  return originals;
}
export function recordPackages(packages, out) {
  return packages.map(p => {
    const file = p.registry === 'crates' ? `${p.name}-${p.version}.crate` : `${p.name.replace('@', '').replace('/', '-')}-${p.version}.tgz`;
    assert(existsSync(join(out, file)), `missing packed ${file}`);
    return { ...p, file, sha256: digest(join(out, file)) };
  });
}
export function pack(out, dryRun = false) {
  mkdirSync(out, { recursive: true });
  const packages = setVersions();
  if (!dryRun) {
    assertReleaseSet(packages, process.env.GITHUB_REF_NAME);
    assert.equal(run('git', ['diff', '--name-only', 'HEAD']).trim(), '', 'live pack needs clean tagged source');
  }
  const policy = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
  assert(/FMIR is a \*\*trusted input\*\*/.test(policy) && /Only run IR produced by a compiler you trust/.test(policy), 'SR41: SECURITY.md must state the trusted compiler boundary (SA4)');
  const lockBefore = digest(join(ROOT, 'Cargo.lock'));
  run('cargo', ['package', '--workspace', '--no-verify', '--locked', ...(dryRun ? ['--allow-dirty'] : [])]);
  assert.equal(digest(join(ROOT, 'Cargo.lock')), lockBefore, 'cargo packaging changed committed lock');
  for (const p of packages.filter(p => p.registry === 'crates')) copyFileSync(join(ROOT, 'target/package', `${p.name}-${p.version}.crate`), join(out, `${p.name}-${p.version}.crate`));
  copyFileSync(join(ROOT, 'Cargo.lock'), join(out, 'Cargo.lock'));
  for (const name of NPM.slice(0, 3)) run('npm', ['pack', '--ignore-scripts', '--pack-destination', out], join(ROOT, 'packages', name));
  const preliminary = recordPackages(packages.filter(p => p.name !== '@getforma/create-app'), out);
  const originals = stageTemplates(ROOT, preliminary, out);
  try { run('npm', ['pack', '--ignore-scripts', '--pack-destination', out], join(ROOT, 'packages/create-app')); }
  finally { for (const [path, bytes] of originals) writeFileSync(path, bytes); }
  const cli = packages.find(p => p.name === '@getforma/create-app');
  const packedPaths = run('tar', ['-tzf', join(out, `getforma-create-app-${cli.version}.tgz`)]);
  for (const template of ['minimal', 'dashboard']) assert(packedPaths.includes(`package/templates/${template}/admin/_npmrc`), `${template}: packed install policy missing`);
  const recorded = recordPackages(packages, out);
  const contracts = json(join(ROOT, 'scripts/release-contracts.json'));
  save(join(out, 'release-set.json'), {
    schema: 1, dryRun, tag: dryRun ? 'A2-dry-run' : process.env.GITHUB_REF_NAME,
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    run: process.env.GITHUB_RUN_ID ?? null, toolchain: run('rustc', ['--version']).trim(),
    node: process.version, npm: run('npm', ['--version']).trim(), contracts, packages: recorded,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [cmd, arg, option] = process.argv.slice(2);
    if (cmd === 'version') {
      const files = versionFiles(ROOT, arg);
      for (const [path, text] of files) writeFileSync(join(ROOT, path), text);
      console.log(`Set seven packages to ${arg}. Review locks and template ranges, test, then commit; no tag was created.`);
    } else if (cmd === 'check') {
      console.log(assertReleaseSet(setVersions(), arg));
    } else if (cmd === 'pack') {
      assert(arg, 'pack requires an output directory');
      pack(resolve(arg), option === '--dry-run');
    } else throw Error('usage: release-set.mjs version VERSION | check TAG | pack DIRECTORY [--dry-run]');
  } catch (error) { console.error(`release-set: ${error.message}`); process.exitCode = 1; }
}
