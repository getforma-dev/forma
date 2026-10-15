// npm classifies signature eligibility by dependency edge specs, not resolved tarballs.
// Preserve the installed dependency graph in an audit-only workspace projection so
// unpublished DS11 candidates are local while every registry dependency is audited.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, json, run, save } from './release-set.mjs';

function inventory(project, execute) {
  return JSON.parse(execute('npm', ['query', '*', '--json'], project));
}

export function auditCandidateSignatures(project, packages, artifactDir, { execute = run } = {}) {
  const manifest = json(join(project, 'package.json'));
  assert(!manifest.workspaces, 'signature projection requires a standalone installed project');
  const lock = json(join(project, 'package-lock.json'));
  const lockHash = digest(join(project, 'package-lock.json'));
  const candidates = new Map(packages.filter(p => p.registry === 'npm').map(p => [p.name, p]));
  const nodes = inventory(project, execute).filter(p => p.location);
  const localCandidates = [], registryDependencies = [];
  const manifests = new Map();
  for (const node of nodes) {
    const path = node.location;
    assert(path.startsWith('node_modules/') && !path.split('/').includes('..'), `unexpected installed location: ${path}`);
    const installed = readFileSync(join(project, path, 'package.json'));
    manifests.set(path, installed);
    const entry = lock.packages[path];
    assert(entry, `${path}: installed package is absent from the committed lock`);
    assert.equal(node.version, entry.version, `${path}: installed version differs from its lock`);
    const candidate = candidates.get(node.name);
    if (candidate) {
      assert.equal(path, `node_modules/${node.name}`, 'nested candidate requires an explicit projection adapter');
      const file = join(artifactDir, candidate.file);
      assert.equal(digest(file), candidate.sha256, `${node.name}: wrong DS11 bytes`);
      assert.equal(node.version, candidate.version, `${node.name}: installed candidate version`);
      assert.equal(entry.resolved, `file:${file}`, `${node.name}: candidate must come from DS11`);
      assert.equal(entry.integrity, `sha512-${digest(file, 'sha512', 'base64')}`, `${node.name}: candidate lock integrity`);
      assert.deepEqual(JSON.parse(installed), JSON.parse(execute('tar', ['-xOf', file, 'package/package.json'])), `${node.name}: installed manifest differs from DS11`);
      localCandidates.push({ name: node.name, version: node.version, location: path, file: candidate.file, sha256: candidate.sha256 });
    } else {
      assert(/^https?:\/\//.test(entry.resolved ?? '') && entry.integrity, `${path}: external dependency must have a registry URL and integrity`);
      registryDependencies.push({ name: node.name, version: node.version, location: path, resolved: entry.resolved, integrity: entry.integrity });
    }
  }
  const projection = mkdtempSync(join(tmpdir(), 'forma-signature-audit-'));
  try {
    cpSync(join(project, 'node_modules'), join(projection, 'node_modules'), { recursive: true });
    // Force npm to inspect this projection rather than reuse the original hidden tree cache.
    rmSync(join(projection, 'node_modules/.package-lock.json'), { force: true });
    if (existsSync(join(project, '.npmrc'))) cpSync(join(project, '.npmrc'), join(projection, '.npmrc'));
    const moves = localCandidates.map((candidate, i) => ({ from: candidate.location, to: `workspaces/candidate-${i}` }));
    mkdirSync(join(projection, 'workspaces'));
    for (const move of moves) {
      renameSync(join(projection, move.from), join(projection, move.to));
      // npm ignores a dependency's devDependencies after installation, but enables
      // them for a workspace. Remove only that inactive metadata in the audit copy
      // so the projection cannot invent extra external edges or versions.
      const workspaceManifest = json(join(projection, move.to, 'package.json'));
      delete workspaceManifest.devDependencies;
      save(join(projection, move.to, 'package.json'), workspaceManifest);
      symlinkSync(join(projection, move.to), join(projection, move.from), 'junction');
    }
    save(join(projection, 'package.json'), { ...manifest, workspaces: moves.map(move => move.to) });
    const normalize = path => {
      const move = moves.find(move => path === move.to || path.startsWith(`${move.to}/`));
      return move ? move.from + path.slice(move.to.length) : path;
    };
    const projected = inventory(projection, execute).filter(p => p.location);
    const workspaces = JSON.parse(execute('npm', ['query', '.workspace', '--json'], projection));
    assert.deepEqual(workspaces.map(p => p.name).sort(), localCandidates.map(p => p.name).sort(), 'only authenticated candidates may be npm workspaces');
    const graph = list => list.filter(p => !candidates.has(p.name)).map(p => ({
      name: p.name, version: p.version, location: normalize(p.location),
      from: p.from.map(normalize).sort(), to: p.to.map(normalize).sort(),
    })).sort((a, b) => a.location.localeCompare(b.location));
    assert.deepEqual(graph(projected), graph(nodes), 'signature projection changed the external inventory or dependency edges');
    for (const node of projected) {
      const original = manifests.get(normalize(node.location));
      assert(original, `${node.location}: projection introduced an unrecorded package`);
      if (candidates.has(node.name)) {
        const expected = JSON.parse(original); delete expected.devDependencies;
        assert.deepEqual(json(join(projection, node.location, 'package.json')), expected, 'signature projection changed candidate runtime metadata');
      } else {
        assert.deepEqual(readFileSync(join(projection, node.location, 'package.json')), original, 'signature projection changed an external manifest');
      }
    }
    if (registryDependencies.length) {
      // Audit every installed edge even if the caller's NODE_ENV/npm omit config
      // normally suppresses development, optional or peer dependencies.
      const result = JSON.parse(execute('npm', ['audit', 'signatures', '--json', '--include=dev', '--include=optional', '--include=peer'], projection));
      assert(Array.isArray(result.invalid) && Array.isArray(result.missing), 'unreadable npm signature audit result');
      assert.equal(result.invalid.length, 0, 'invalid registry signature or attestation');
      assert.equal(result.missing.length, 0, 'missing registry signature');
    }
    return { localCandidates, registryDependencies };
  } finally {
    rmSync(projection, { recursive: true, force: true });
    assert.equal(digest(join(project, 'package-lock.json')), lockHash, 'signature audit changed the candidate lock');
    for (const [path, original] of manifests) assert.deepEqual(readFileSync(join(project, path, 'package.json')), original, 'signature audit changed the candidate installation');
  }
}
