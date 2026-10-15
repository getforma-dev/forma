#!/usr/bin/env node
// Release preparation uses only Node's standard library. No command here publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename, posix } from 'node:path';
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
export function compatibilityPeer(version) {
  assert(SEMVER.test(version), 'peer range requires a supported package version');
  const [major, minor] = version.split('.');
  const stable = `^${major}.${minor}.0`;
  // npm excludes prereleases from ordinary carets: opt into this coordinated
  // prerelease only, without admitting a future minor's prerelease.
  return version.includes('-') ? `${stable} || =${version}` : stable;
}
function updateRequirements(p, version, owner = p.name) {
  for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(p[kind] ?? {})) if (internal(name)) p[kind][name] = `=${version}`;
  }
  const peer = owner === '@getforma/compiler' ? '@getforma/core' : owner === '@getforma/build' ? '@getforma/compiler' : null;
  if (peer) p.peerDependencies = { ...p.peerDependencies, [peer]: compatibilityPeer(version) };
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
    p.repository = { type: 'git', url: 'git+https://github.com/getforma-dev/forma.git', directory: `packages/${name}` };
    files.set(path, JSON.stringify(p, null, 2) + '\n');
  }
  const lock = JSON.parse(read('package-lock.json'));
  for (const [path, p] of Object.entries(lock.packages)) {
    if (NPM.some(name => path === `packages/${name}`)) p.version = version;
    const member = NPM.find(name => path === `packages/${name}`);
    updateRequirements(p, version, member ? `@getforma/${member}` : p.name);
  }
  files.set('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  for (const path of ['Cargo.lock', 'e2e/Cargo.lock', 'fuzz/Cargo.lock']) {
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

const dependencyKinds = ['dependencies', 'devDependencies', 'optionalDependencies'];
const packedMetadata = ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'engines', 'bin'];
function npmUrl(p) { return `https://registry.npmjs.org/${p.name}/-/${p.name.split('/').at(-1)}-${p.version}.tgz`; }
export function assertNpmTemplateLock(manifest, lock, packages, artifactDir) {
  assert(lock.packages?.[''], 'template npm lock is missing its root');
  for (const kind of dependencyKinds) {
    assert.deepEqual(lock.packages[''][kind], manifest[kind], `template npm lock root ${kind} disagrees with manifest`);
    for (const [name, requirement] of Object.entries(manifest[kind] ?? {})) {
      if (!name.startsWith('@getforma/')) continue;
      const candidate = packages.find(p => p.registry === 'npm' && p.name === name);
      assert(candidate, `template has no release candidate for ${name}`);
      assert(['', '=', '^', '~'].some(prefix => requirement === `${prefix}${candidate.version}`), `${name}: template requirement disagrees with candidate`);
      assert(lock.packages[`node_modules/${name}`], `${name}: missing template lock entry`);
    }
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = /(?:^|\/)node_modules\/(@getforma\/[^/]+)$/.exec(key)?.[1];
    if (!name) continue;
    const candidate = packages.find(p => p.registry === 'npm' && p.name === name);
    assert(candidate, `template has no release candidate for ${name}`);
    const file = join(artifactDir, candidate.file);
    assert.equal(entry.version, candidate.version, `${name}: shipped template lock version`);
    assert.equal(entry.resolved, npmUrl(candidate), `${name}: shipped template lock registry URL`);
    assert.equal(entry.integrity, `sha512-${digest(file, 'sha512', 'base64')}`, `${name}: shipped template lock integrity`);
    assert(!entry.link, `${name}: shipped template lock must use a registry archive`);
    const packed = JSON.parse(run('tar', ['-xOf', file, 'package/package.json']));
    assert.equal(packed.name, name); assert.equal(packed.version, candidate.version);
    for (const kind of packedMetadata) assert.deepEqual(entry[kind], packed[kind], `${name}: shipped template lock ${kind}`);
  }
}
export function assertCargoCandidateLock(text, packages, rootName) {
  for (const block of text.split(/(?=\[\[package\]\])/)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    if (!CRATES.includes(name)) continue;
    const candidate = packages.find(p => p.registry === 'crates' && p.name === name);
    assert(candidate, `Cargo lock has no release candidate for ${name}`);
    assert.equal(/^version = "([^"]+)"/m.exec(block)?.[1], candidate.version, `${name}: shipped Cargo lock version`);
    // A packaged crate's own root is a local package; every other candidate is registry-pinned.
    if (name === rootName && !/^source = /m.test(block)) {
      assert(!/^checksum = /m.test(block), `${name}: local root has an unexpected checksum`);
      continue;
    }
    assert.equal(/^source = "([^"]+)"/m.exec(block)?.[1], 'registry+https://github.com/rust-lang/crates.io-index', `${name}: shipped Cargo lock source`);
    assert.equal(/^checksum = "([^"]+)"/m.exec(block)?.[1], candidate.sha256, `${name}: shipped Cargo lock checksum`);
  }
}

// Build a standalone runtime lock using only the packed manifest's dependency edges.
// npm ci validates their ranges and archive integrity without running lifecycle scripts.
// The installation lives outside the checkout so undeclared imports cannot find source deps.
export function packedRuntimeLock(packed, sourceLock, sourcePath) {
  assert.equal(sourceLock.lockfileVersion, 3, 'packed runtime requires a v3 recorded lock');
  const manifest = structuredClone(packed);
  delete manifest.devDependencies; delete manifest.workspaces;
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: { '': { name: manifest.name, version: manifest.version } } };
  for (const kind of ['dependencies', 'optionalDependencies', 'engines']) if (manifest[kind]) lock.packages[''][kind] = manifest[kind];
  const locate = (from, name) => {
    for (let at = from; ; at = posix.dirname(at)) {
      if (posix.basename(at) !== 'node_modules') {
        const key = posix.join(at === '.' ? '' : at, 'node_modules', name);
        if (sourceLock.packages[key]) return key;
      }
      if (!at || at === '.') return;
    }
  };
  const visit = (metadata, from, dest, ancestors = []) => {
    const dependencies = { ...metadata.peerDependencies, ...metadata.dependencies, ...metadata.optionalDependencies };
    for (const name of Object.keys(dependencies)) {
      assert(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name), `invalid runtime dependency ${name}`);
      const optional = Object.hasOwn(metadata.optionalDependencies ?? {}, name) || (metadata.peerDependenciesMeta?.[name]?.optional && !Object.hasOwn(metadata.dependencies ?? {}, name));
      const key = locate(from, name);
      if (!key && optional) continue;
      assert(key, `${name}: packed runtime dependency is absent from the recorded lock`);
      if (ancestors.some(a => a.key === key && a.name === name)) continue;
      const entry = structuredClone(sourceLock.packages[key]);
      assert(!entry.link && entry.version && entry.resolved && entry.integrity, `${name}: packed runtime requires an integrity-pinned archive`);
      for (const flag of ['dev', 'devOptional', 'peer', 'optional']) delete entry[flag];
      if (optional) entry.optional = true;
      const target = posix.join(dest, 'node_modules', name);
      lock.packages[target] = entry;
      visit(entry, key, target, [...ancestors, { key, name }]);
    }
  };
  visit(manifest, sourcePath, '');
  return { manifest, lock };
}

// Preserve every third-party resolution. Only candidate package versions, dependency metadata,
// URLs and checksums change; npm ci will refuse a stale third-party graph.
export function stageNpmLock(manifest, lock, packages, artifactDir, local = false) {
  if (local) assertNpmTemplateLock(manifest, lock, packages, artifactDir);
  lock = structuredClone(lock); manifest = structuredClone(manifest);
  for (const candidate of packages.filter(p => p.registry === 'npm')) {
    const key = `node_modules/${candidate.name}`;
    if (!lock.packages[key]) continue;
    const file = join(artifactDir, candidate.file);
    for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (manifest[kind]?.[candidate.name]) manifest[kind][candidate.name] = local ? `file:${file}` : `=${candidate.version}`;
    }
    const entry = lock.packages[key];
    entry.resolved = local ? `file:${file}` : npmUrl(candidate);
    if (local) continue; // The shipped version, integrity and graph were validated, not repaired.
    entry.version = candidate.version;
    entry.integrity = `sha512-${digest(file, 'sha512', 'base64')}`;
    delete entry.link;
    const packed = JSON.parse(run('tar', ['-xOf', file, 'package/package.json']));
    for (const kind of packedMetadata) {
      if (packed[kind]) entry[kind] = packed[kind]; else delete entry[kind];
    }
  }
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (manifest[kind]) lock.packages[''][kind] = manifest[kind];
  }
  return { manifest, lock };
}
export function stageCargoLock(text, packages, local = false, rootName) {
  if (local) assertCargoCandidateLock(text, packages, rootName);
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
    schema: 1, dryRun, tag: dryRun ? `${contracts.stage}-dry-run` : process.env.GITHUB_REF_NAME,
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
