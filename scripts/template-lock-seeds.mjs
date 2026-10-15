// Source-only lock seeds. Shipped archives are sealed from actual candidate bytes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEED_MARKER = 'packages/create-app/template-lock-seeds.json';
export const SEED_TEMPLATES = ['minimal', 'dashboard'];
const NPM = ['@getforma/core', '@getforma/compiler', '@getforma/build'];
const CARGO = ['forma-ir', 'forma-ir-derive', 'forma-server'];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:dev|(?:alpha|beta|rc)\.(?:0|[1-9]\d*)))?$/;
const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const scalar = (text, name) => new RegExp(`^${name} = "([^"\\r\\n]+)"\\r?$`, 'm').exec(text)?.[1];
const blocks = text => text.split(/(?=^\[\[package\]\]\r?$)/m);
function version(value) { assert(VERSION.test(value) && Number(value.split('.')[0]) >= 3, 'seed needs a coordinated 3.x-or-later source version'); }
function internalNpm(name) { return name?.startsWith('@getforma/'); }
function npmName(path) { return /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path)?.[1]; }
function exactRequirements(manifest, v) {
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const [name, req] of Object.entries(manifest[kind] ?? {})) {
    if (internalNpm(name)) assert(NPM.includes(name) && req === `=${v}`, `source seed has unknown or mixed internal requirement ${name}@${req}`);
  }
}
const peerWindow = v => `^${v.split('.')[0]}.${v.split('.')[1]}.0${v.includes('-') ? ` || =${v}` : ''}`;
export function validateSeedFiles(files, v, label = 'template') {
  version(v);
  const manifest = JSON.parse(files.get('admin/package.json'));
  const lock = JSON.parse(files.get('admin/package-lock.json'));
  assert.equal(lock.lockfileVersion, 3, `${label}: expected npm lock3`);
  assert(lock.packages?.[''], `${label}: missing npm root`);
  exactRequirements(manifest, v); exactRequirements(lock.packages[''], v);
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) assert.deepEqual(lock.packages[''][kind], manifest[kind], `${label}: npm root ${kind} differs`);
  const present = new Set();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = npmName(path);
    assert(name && !entry.link, `${label}: unexpected source seed entry ${path}`);
    exactRequirements(entry, v);
    for (const [peer, range] of Object.entries(entry.peerDependencies ?? {})) if (internalNpm(peer)) {
      assert(NPM.includes(peer) && range === peerWindow(v), `${label}: unknown or mixed internal peer ${peer}@${range}`);
    }
    if (internalNpm(name)) {
      assert(NPM.includes(name) && !present.has(name), `${label}: unknown or duplicate internal npm package ${name}`);
      present.add(name);
      assert.equal(entry.version, v, `${label}: mixed internal npm version ${name}`);
      assert.equal(entry.resolved, `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${v}.tgz`, `${label}: unexpected internal source ${name}`);
      assert(!Object.hasOwn(entry, 'integrity'), `${label}: source seed must not pretend to authenticate ${name}`);
    } else if (entry.inBundle === true) {
      const parent = lock.packages[path.slice(0, path.lastIndexOf('/node_modules/'))];
      assert(parent?.bundleDependencies?.includes(name), `${label}: unproven bundled npm entry ${path}`);
      assert(/^https:\/\/registry\.npmjs\.org\//.test(parent.resolved ?? '') && /^sha512-[A-Za-z0-9+/]{86}==$/.test(parent.integrity ?? ''), `${label}: bundled parent lacks its registry checksum`);
      assert(!entry.resolved && !entry.integrity, `${label}: bundled package has conflicting registry identity`);
    } else {
      assert(/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? ''), `${label}: external npm source is not the registry: ${path}`);
      assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''), `${label}: external npm checksum missing or invalid: ${path}`);
    }
  }
  const declared = new Set(['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(kind => Object.keys(manifest[kind] ?? {}).filter(internalNpm)));
  assert(declared.has('@getforma/core') && declared.has('@getforma/build'), `${label}: source seed needs core and build`);
  assert.deepEqual([...present].sort(), [...declared].sort(), `${label}: source seed omits or adds an internal npm package`);
  const cargo = files.get('Cargo.toml'), text = files.get('Cargo.lock');
  const records = blocks(text).slice(1).map(raw => ({ raw, name: scalar(raw, 'name'), version: scalar(raw, 'version'), source: scalar(raw, 'source'), checksum: scalar(raw, 'checksum') }));
  assert(/^version = [34]\r?$/m.test(blocks(text)[0]), `${label}: expected Cargo lock3/4`);
  assert.equal(new Set(records.map(p => JSON.stringify([p.name,p.version,p.source]))).size, records.length, `${label}: duplicate Cargo identity`);
  const internal = new Set(); let roots = 0;
  for (const p of records) {
    assert(p.name && p.version, `${label}: malformed Cargo record`);
    for (const field of ['name', 'version', 'source', 'checksum']) assert.equal([...p.raw.matchAll(new RegExp(`^${field}\\s*=`, 'gm'))].length, p[field] === undefined ? 0 : 1, `${label}: duplicate or unsupported Cargo ${field}`);
    if (p.name.startsWith('forma-')) {
      assert(CARGO.includes(p.name) && !internal.has(p.name), `${label}: unknown or duplicate internal crate ${p.name}`); internal.add(p.name);
      assert.equal(p.version, v, `${label}: mixed internal crate version ${p.name}`);
      assert.equal(p.source, REGISTRY, `${label}: unexpected internal crate source`);
      assert(!/^checksum\s*=/m.test(p.raw), `${label}: source seed must not pretend to authenticate ${p.name}`);
    } else if (!p.source) {
      roots++;
      assert(['{{PROJECT_NAME}}', '{{project-name}}'].includes(p.name) && p.name === scalar(cargo, 'name'), `${label}: unexpected local Cargo package`);
      assert.equal(p.version, scalar(cargo, 'version'), `${label}: Cargo root version differs`);
      assert.equal(p.checksum, undefined, `${label}: local root has a checksum`);
    } else {
      assert.equal(p.source, REGISTRY, `${label}: external crate source is not the registry`);
      assert(/^[a-f0-9]{64}$/.test(p.checksum ?? ''), `${label}: external crate checksum missing: ${p.name}`);
    }
    for (const [, ref] of p.raw.matchAll(/^\s+"([^"\r\n]+)",\r?$/gm)) {
      const [name, ver] = ref.split(' ');
      assert.equal(records.filter(r => r.name === name && (!ver || r.version === ver)).length, 1, `${label}: missing or ambiguous Cargo edge ${ref}`);
    }
  }
  assert.equal(roots, 1, `${label}: expected one Cargo root`);
  assert.deepEqual([...internal].sort(), [...CARGO].sort(), `${label}: source seed omits an internal crate`);
  assert.deepEqual([...cargo.matchAll(/^\[([^\]\r\n]+)\]\r?$/gm)].map(m => m[1]), ['package', 'dependencies'], `${label}: unsupported seed manifest sections`);
  const declarations = [...cargo.split('[dependencies]')[1].matchAll(/^([\w-]+)\s*=\s*(.+)\r?$/gm)];
  const root = records.find(p => !p.source);
  const rootEdges = [...root.raw.matchAll(/^\s+"([^"\r\n]+)",\r?$/gm)].map(m => m[1].split(' ')[0]).sort();
  assert.deepEqual(declarations.map(m => m[1]).sort(), rootEdges, `${label}: Cargo manifest and seed root dependencies differ`);
  for (const [, name, value] of declarations) assert(!/\b(?:package|path|git)\s*=/.test(value), `${label}: unsupported source override for ${name}`);
  for (const [, name, value] of cargo.matchAll(/^(forma-[\w-]+)\s*=\s*(.+)\r?$/gm)) assert(CARGO.includes(name) && value.trim() === `"=${v}"`, `${label}: unknown or mixed Cargo requirement ${name}@${value}`);
  return files;
}
export function readTemplateSeeds(root, expectedVersion) {
  version(expectedVersion);
  const marker = JSON.parse(read(root, SEED_MARKER));
  assert.deepEqual(marker, { schema: 1, version: expectedVersion, templates: SEED_TEMPLATES }, 'source template seed identity/version differs');
  assert.equal(JSON.parse(read(root, 'packages/create-app/package.json')).version, expectedVersion, 'source template seed differs from create-app version');
  return new Map(SEED_TEMPLATES.map(template => {
    const prefix = `packages/create-app/templates/${template}`;
    const files = new Map(['Cargo.toml', 'Cargo.lock', 'admin/package.json', 'admin/package-lock.json'].map(path => [path, read(root, `${prefix}/${path}`)]));
    return [template, validateSeedFiles(files, expectedVersion, template)];
  }));
}
export function prepareTemplateSeeds(root, oldVersion, nextVersion) {
  version(nextVersion);
  const output = new Map([[SEED_MARKER, JSON.stringify({schema: 1, version: nextVersion, templates: SEED_TEMPLATES}, null, 2) + '\n']]);
  for (const [template, files] of readTemplateSeeds(root, oldVersion)) {
    const manifest = JSON.parse(files.get('admin/package.json')), lock = JSON.parse(files.get('admin/package-lock.json'));
    for (const p of [manifest, lock.packages['']]) for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const name of Object.keys(p[kind] ?? {})) if (NPM.includes(name)) p[kind][name] = `=${nextVersion}`;
    for (const [path, entry] of Object.entries(lock.packages)) if (NPM.includes(npmName(path))) {
      const name = npmName(path); entry.version = nextVersion; entry.resolved = `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${nextVersion}.tgz`;
      // Keep the package's internal metadata consistent with the coordinated set.
      for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const name of Object.keys(entry[kind] ?? {})) if (NPM.includes(name)) entry[kind][name] = kind === 'peerDependencies' ? peerWindow(nextVersion) : `=${nextVersion}`;
    }
    files.set('admin/package.json', JSON.stringify(manifest,null,2)+'\n'); files.set('admin/package-lock.json', JSON.stringify(lock,null,2)+'\n');
    files.set('Cargo.toml', files.get('Cargo.toml').replace(/^(forma-(?:ir|ir-derive|server) = ")[^"]+"/gm, `$1=${nextVersion}"`));
    files.set('Cargo.lock', blocks(files.get('Cargo.lock')).map(raw => CARGO.includes(scalar(raw,'name')) ? raw.replace(/^version = "[^"]+"/m, `version = "${nextVersion}"`) : raw).join('').replace(/"(forma-(?:ir|ir-derive|server)) ([^" ]+)([^"]*)"/g, (_,name,prior,suffix) => { assert.equal(prior,oldVersion,'mixed internal Cargo edge version'); return `"${name} ${nextVersion}${suffix}"`; }));
    validateSeedFiles(files,nextVersion,template);
    for (const [path,text] of files) output.set(`packages/create-app/templates/${template}/${path}`,text);
  }
  return output;
}
