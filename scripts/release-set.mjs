#!/usr/bin/env node
// Release preparation uses only Node's standard library. No command here publishes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join, basename, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mergeRecordedCargoLock } from './release-cargo-lock.mjs';
import { commandInvocation } from './portable-command.mjs';
import { SEED_MARKER, readTemplateSeeds, prepareTemplateSeeds } from './template-lock-seeds.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NPM = ['core', 'compiler', 'build', 'create-app'];
export const CRATES = ['forma-ir', 'forma-ir-derive', 'forma-server'];
// Pre-release counters start at 1: the first alpha is -alpha.1, never -alpha.0.
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:dev|(?:alpha|beta|rc)\.[1-9]\d*))?$/;
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
export const digest = (path, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(readFileSync(path)).digest(encoding);
export function run(command, args, cwd = ROOT, options = {}) {
  const invocation = commandInvocation(command, args);
  return execFileSync(invocation.command, invocation.args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024, ...options });
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

// A tag names its milestone: -alpha.N, -beta.N, -rc.N or the final. A -dev version has none.
export const MILESTONES = ['alpha', 'beta', 'rc', 'final'];
export function milestoneOf(version) {
  assert(SEMVER.test(version), `${version}: not a release version`);
  if (version.endsWith('-dev')) return null;
  return /-(alpha|beta|rc)\./.exec(version)?.[1] ?? 'final';
}
// Which tickets gate which milestone is the contract file's statement, not a switch. A
// milestone inherits every earlier milestone's gates; it may publish only when all of
// them are done. The later milestones' open gates are reported, never enforced early.
export function releaseMilestone(contracts, version) {
  const name = milestoneOf(version);
  assert(name, `${version} is a development version; no milestone publishes it`);
  assert(contracts?.milestones && typeof contracts.milestones === 'object' && !Array.isArray(contracts.milestones), 'contract file names no milestones');
  assert(!('liveReleaseReady' in contracts) && !('pending' in contracts), 'contract file may not carry a global publish switch beside its milestones');
  // The gates are written for one release: a later version's pre-release cannot pass them.
  assert(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(contracts.version ?? ''), 'contract file names no release version');
  const base = version.split('-')[0];
  assert.equal(base, contracts.version, `the contract gates ${contracts.version}, not ${base}; write the next release's contract first`);
  const order = MILESTONES.indexOf(name);
  const blocking = [], later = {}, seen = new Set();
  MILESTONES.forEach((milestone, i) => {
    const entry = contracts.milestones[milestone];
    assert(entry?.gates && typeof entry.gates === 'object' && !Array.isArray(entry.gates) && Object.keys(entry.gates).length, `contract names no gates for ${milestone}`);
    assert(/^M\d$/.test(entry.plan ?? ''), `${milestone}: contract names no plan milestone`);
    for (const [ticket, gate] of Object.entries(entry.gates)) {
      assert(/^FORMA-\d{3}(?: [A-Za-z0-9()./-]+)*$/.test(ticket), `${milestone}: ${ticket} is not a ticket gate`);
      assert(!seen.has(ticket), `${ticket}: gates more than one milestone`);
      seen.add(ticket);
      assert(['done', 'pending'].includes(gate?.status) && typeof gate.scope === 'string' && gate.scope.trim(), `${milestone}: ${ticket} needs a done/pending status and a scope`);
      if (gate.status !== 'pending') continue;
      if (i <= order) blocking.push(`${ticket} (${milestone}): ${gate.scope}`);
      else (later[milestone] ??= []).push(`${ticket}: ${gate.scope}`);
    }
  });
  return { name, plan: contracts.milestones[name].plan, version, ready: blocking.length === 0, blocking, later };
}
export function assertMilestoneReady(contracts, version) {
  const milestone = releaseMilestone(contracts, version);
  assert(milestone.ready, `${milestone.name} (${milestone.plan}) still waits for: ${milestone.blocking.join('; ')}; nothing may publish`);
  return milestone;
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
  // Source seeds never invent the hash of an archive containing this commit.
  const previous = JSON.parse(read('packages/create-app/package.json')).version;
  for (const [path, text] of prepareTemplateSeeds(root, previous, version)) files.set(path, text);
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

// Preserve existing third-party resolutions. New candidate dependencies receive an isolated
// closure copied from the committed workspace lock, never a fresh registry resolution.
// npm ci validates the resulting ranges and bytes; P17's local substitution cannot repair it.
export function stageNpmLock(manifest, lock, packages, artifactDir, local = false, sourceLock) {
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
    if (sourceLock) {
      // Candidate peers are supplied by the seven-package release set. External
      // edges resolve through the exact workspace graph, including transitive peers.
      const external = structuredClone(packed);
      for (const kind of [...dependencyKinds, 'peerDependencies', 'peerDependenciesMeta']) {
        if (external[kind]) external[kind] = Object.fromEntries(Object.entries(external[kind]).filter(([name]) => !internal(name)));
      }
      const member = NPM.find(name => `@getforma/${name}` === candidate.name);
      assert(member, `unrecognized npm release member ${candidate.name}`);
      const closure = packedRuntimeLock(external, sourceLock, `packages/${member}`).lock;
      for (const [path, dependency] of Object.entries(closure.packages)) {
        if (!path) continue;
        const target = `${key}/${path}`;
        if (lock.packages[target]) {
          // Preserve an existing nested resolution too; reject a conflict rather
          // than silently replacing a previously reviewed third-party archive.
          for (const field of ['version', 'resolved', 'integrity']) assert.equal(lock.packages[target][field], dependency[field], `${target}: existing external resolution conflicts with recorded candidate closure`);
        } else lock.packages[target] = dependency;
      }
    }
  }
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (manifest[kind]) lock.packages[''][kind] = manifest[kind];
  }
  return { manifest, lock };
}
export function stageCargoLock(text, packages, local = false, rootName, recorded) {
  if (!local && recorded) return mergeRecordedCargoLock(text, packages, recorded);
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
export function packedCargoGraph(root, packages, out) {
  const scratch = mkdtempSync(join(tmpdir(), 'forma-packed-cargo-'));
  try {
    const metadata = [];
    for (const p of packages.filter(p => p.registry === 'crates')) {
      const file = join(out, p.file);
      assert.equal(digest(file), p.sha256, `${p.name}: packed archive checksum changed`);
      run('tar', ['-xzf', file, '-C', scratch]);
      const dir = join(scratch, `${p.name}-${p.version}`);
      const lock = join(dir, 'Cargo.lock');
      const before = existsSync(lock) ? readFileSync(lock) : null;
      // --no-deps reads the normalized packed manifest without resolving an
      // unpublished dependency. --locked --offline prevent repairs/network.
      const graph = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked', '--offline', '--manifest-path', join(dir, 'Cargo.toml')], scratch));
      assert.equal(graph.resolve, null, 'packed manifest inspection resolved dependencies');
      assert.equal(graph.packages.length, 1);
      assert.equal(graph.packages[0].name, p.name); assert.equal(graph.packages[0].version, p.version);
      assert.deepEqual(existsSync(lock) ? readFileSync(lock) : null, before, 'packed metadata inspection changed its lock');
      metadata.push(graph.packages[0]);
    }
    return { lock: readFileSync(join(root, 'Cargo.lock'), 'utf8'), packages: metadata };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
export function withStagedTemplates(root, packages, out, callback) {
  const originals = stageTemplates(root, packages, out);
  try { return callback(); }
  finally { for (const [path, bytes] of originals) writeFileSync(path, bytes); }
}
export function stageTemplates(root, packages, out) {
  const originals = new Map();
  const stagedFiles = new Map();
  if (existsSync(join(root, 'packages/create-app/package.json'))) assert(existsSync(join(root, SEED_MARKER)), 'source templates require their explicit lock-seed identity');
  if (existsSync(join(root, SEED_MARKER))) {
    const expected = json(join(root, 'packages/create-app/package.json')).version;
    const known = [...CRATES, ...NPM.slice(0,3).map(name => `@getforma/${name}`)].sort();
    assert.deepEqual(packages.map(p => p.name).sort(), known, 'source seeds require all six runtime candidates');
    for (const p of packages) {
      assert.equal(p.version, expected, `${p.name}: mixed source seed/candidate version`);
      assert.equal(p.registry, CRATES.includes(p.name) ? 'crates' : 'npm', `${p.name}: unexpected candidate registry`);
    }
    readTemplateSeeds(root, expected); // Validate both templates before writes or archive inspection.
    assert(existsSync(join(root, 'Cargo.lock')), 'source seeds require the committed candidate Cargo graph');
  } else {
    // Low-level historical fixtures may be already sealed. A recorded Cargo
    // graph must never turn an unidentified missing hash into a source seed.
    for (const template of ['minimal', 'dashboard']) {
      const dir = join(root, 'packages/create-app/templates', template);
      for (const [path, entry] of Object.entries(json(join(dir, 'admin/package-lock.json')).packages)) {
        if (/^node_modules\/@getforma\/(core|compiler|build)$/.test(path)) assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''), 'unidentified template: missing checksum for internal npm package');
      }
      for (const block of readFileSync(join(dir, 'Cargo.lock'), 'utf8').split(/(?=^\[\[package\]\])/m)) {
        if (/^name = "forma-(ir|ir-derive|server)"\r?$/m.test(block)) assert(/^checksum = "[a-f0-9]{64}"\r?$/m.test(block), 'unidentified template: missing checksum for internal crate');
      }
    }
  }
  const cargoGraph = existsSync(join(root, 'Cargo.lock')) ? packedCargoGraph(root, packages, out) : undefined;
  // Compute every replacement before touching the tree, so a malformed second template
  // cannot leave the first template staged when packing fails.
  for (const template of ['minimal', 'dashboard']) {
    const dir = join(root, 'packages/create-app/templates', template);
    for (const name of ['admin/package.json', 'admin/package-lock.json', 'Cargo.toml', 'Cargo.lock']) originals.set(join(dir, name), readFileSync(join(dir, name)));
    const source = join(dir, 'src/main.rs');
    if (existsSync(source)) originals.set(source, readFileSync(source));
    const staged = stageNpmLock(json(join(dir, 'admin/package.json')), json(join(dir, 'admin/package-lock.json')), packages, out, false, existsSync(join(root, 'package-lock.json')) ? json(join(root, 'package-lock.json')) : undefined);
    stagedFiles.set(join(dir, 'admin/package.json'), JSON.stringify(staged.manifest, null, 2) + '\n');
    stagedFiles.set(join(dir, 'admin/package-lock.json'), JSON.stringify(staged.lock, null, 2) + '\n');
    const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf8').replace(/^(forma-(?:ir|ir-derive|server) = ")[^"]+"/gm, (line, prefix) => {
      const name = prefix.split(' ')[0];
      const candidate = packages.find(p => p.registry === 'crates' && p.name === name);
      assert(candidate, `template has no release candidate for ${name}`);
      return `${prefix}=${candidate.version}"`;
    });
    stagedFiles.set(join(dir, 'Cargo.toml'), cargo);
    stagedFiles.set(join(dir, 'Cargo.lock'), stageCargoLock(readFileSync(join(dir, 'Cargo.lock'), 'utf8'), packages, false, undefined, cargoGraph));
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
// Cargo's local packaging registry can retain an old checksum when the same
// unpublished version is repacked after source edits. Each attempt owns a fresh
// target; never clear or trust a shared build/package target.
export function packCargoWorkspace(root, packages, out, { dryRun = false, offline = false } = {}) {
  const target = mkdtempSync(join(tmpdir(), 'forma-release-package-'));
  const lockBefore = digest(join(root, 'Cargo.lock'));
  try {
    run('cargo', ['package', '--workspace', '--no-verify', '--locked', '--target-dir', target,
      ...(dryRun ? ['--allow-dirty'] : []), ...(offline ? ['--offline'] : [])], root);
    assert.equal(digest(join(root, 'Cargo.lock')), lockBefore, 'cargo packaging changed committed lock');
    for (const p of packages.filter(p => p.registry === 'crates')) {
      const file = `${p.name}-${p.version}.crate`;
      copyFileSync(join(target, 'package', file), join(out, file));
    }
  } finally { rmSync(target, { recursive: true, force: true }); }
}

export function pack(out, dryRun = false) {
  mkdirSync(out, { recursive: true });
  const packages = setVersions();
  const contracts = json(join(ROOT, 'scripts/release-contracts.json'));
  let milestone = null;
  if (!dryRun) {
    const version = assertReleaseSet(packages, process.env.GITHUB_REF_NAME);
    // Fail before packing: a tag for a milestone whose gates are open packs nothing.
    milestone = assertMilestoneReady(contracts, version);
    assert.equal(run('git', ['diff', '--name-only', 'HEAD']).trim(), '', 'live pack needs clean tagged source');
  } else if (milestoneOf(packages[0].version)) {
    // A dry run over release-versioned manifests records the milestone it would need, unenforced.
    milestone = releaseMilestone(contracts, packages[0].version);
  }
  const policy = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
  assert(/FMIR is a \*\*trusted input\*\*/.test(policy) && /Only run IR produced by a compiler you trust/.test(policy), 'SR41: SECURITY.md must state the trusted compiler boundary (SA4)');
  packCargoWorkspace(ROOT, packages, out, { dryRun });
  copyFileSync(join(ROOT, 'Cargo.lock'), join(out, 'Cargo.lock'));
  for (const name of NPM.slice(0, 3)) run('npm', ['pack', '--ignore-scripts', '--pack-destination', out], join(ROOT, 'packages', name));
  const preliminary = recordPackages(packages.filter(p => p.name !== '@getforma/create-app'), out);
  withStagedTemplates(ROOT, preliminary, out, () => run('npm', ['pack', '--ignore-scripts', '--pack-destination', out], join(ROOT, 'packages/create-app')));
  const cli = packages.find(p => p.name === '@getforma/create-app');
  const packedPaths = run('tar', ['-tzf', join(out, `getforma-create-app-${cli.version}.tgz`)]);
  for (const template of ['minimal', 'dashboard']) assert(packedPaths.includes(`package/templates/${template}/admin/_npmrc`), `${template}: packed install policy missing`);
  const recorded = recordPackages(packages, out);
  save(join(out, 'release-set.json'), {
    schema: 1, dryRun, tag: dryRun ? `${contracts.stage}-dry-run` : process.env.GITHUB_REF_NAME,
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    run: process.env.GITHUB_RUN_ID ?? null, toolchain: run('rustc', ['--version']).trim(),
    node: process.version, npm: run('npm', ['--version']).trim(), contracts, milestone, packages: recorded,
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
