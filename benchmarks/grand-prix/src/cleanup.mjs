// Pit crew: compact regenerable run workspaces while retaining evidence and source.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const validId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id);
const hash = value => createHash('sha256').update(value).digest('hex');
const freeBytes = directory => { const stat = statfsSync(directory); return stat.bavail * stat.bsize; };
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const safeDirectory = (root, relative) => {
  assert(typeof relative === 'string' && relative && !path.isAbsolute(relative), 'relative owned path required');
  const parts = relative.split(/[\\/]/);
  assert(parts.every(part => part && part !== '.' && part !== '..'), 'unsafe cleanup path');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    assert(!stat.isSymbolicLink(), `cleanup refuses a linked path: ${relative}`);
  }
  assert(realpathSync(current).startsWith(root + path.sep), 'cleanup path leaves project');
  return current;
};
function activeState(root) {
  const directory = path.join(root, '.grandprix');
  if (existsSync(directory)) assert(!lstatSync(directory).isSymbolicLink(), 'state directory must not be a symlink');
  const file = path.join(directory, 'active.json');
  if (!existsSync(file)) return null;
  // A stale or malformed lock is retained for explicit recovery, never guessed away.
  const stat = lstatSync(file);
  assert(!stat.isSymbolicLink(), 'active lock must not be a symlink');
  try { return { ...json(file), blocked: true }; }
  catch { return { blocked: true, error: 'unreadable active lock' }; }
}
function inventory(directory) {
  let bytes = 0; const records = [];
  function walk(file, relative) {
    const stat = lstatSync(file);
    records.push([relative, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs]);
    // rmSync removes internal symlink entries themselves; never traverse their target.
    if (stat.isDirectory()) for (const entry of readdirSync(file).sort()) walk(path.join(file, entry), relative + '/' + entry);
    else bytes += stat.size;
  }
  walk(directory, '.');
  return { bytes, fingerprint: hash(JSON.stringify(records)) };
}
const defaultDocker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
function ownership(root, runId) {
  const relative = `runs/${runId}/artifacts/${runId}-ownership.json`;
  if (!existsSync(path.join(root, relative))) return null;
  const file = safeDirectory(root, relative), record = json(file);
  assert.equal(record.id, runId, 'Docker ownership run differs');
  assert.equal(record.builder, `gp264-${runId}`, 'Docker ownership builder differs');
  assert.equal(typeof record.builderCreated, 'boolean', 'builder ownership missing');
  return { relative, record, fingerprint: hash(readFileSync(file)) };
}
function dockerCandidates(root, runId, docker) {
  const owner = ownership(root, runId);
  assert(owner, 'Docker cleanup requires the run ownership receipt');
  const out = [], label = `gp264run=${runId}`;
  for (const [kind, query, inspect] of [
    ['container', ['ps', '-aq', '--no-trunc'], ['container', 'inspect']],
    ['network', ['network', 'ls', '-q', '--no-trunc'], ['network', 'inspect']],
    ['volume', ['volume', 'ls', '-q'], ['volume', 'inspect']],
    ['image', ['image', 'ls', '-q', '--no-trunc'], ['image', 'inspect']],
  ]) {
    const ids = [...new Set(docker([...query, '--filter', `label=${label}`]).split(/\s+/).filter(Boolean))].sort();
    for (const id of ids) {
      assert(/^[a-zA-Z0-9_.:-]+$/.test(id), 'invalid Docker resource identity');
      const value = JSON.parse(docker([...inspect, id]))[0];
      const labels = kind === 'container' || kind === 'image' ? value.Config?.Labels : value.Labels;
      assert.equal(labels?.gp264run, runId, 'Docker resource ownership differs');
      // A foreign explicit brand label is never interpreted as ours.
      assert(!labels.grandprix || labels.grandprix === 'forma-264', 'foreign Grand Prix resource');
      out.push({ kind, id, labels });
    }
  }
  if (owner.record.builderCreated) out.push({ kind: 'builder', id: owner.record.builder, ownership: owner.fingerprint });
  return { owner, resources: out };
}
function candidates(artifacts, includeDependencies) {
  const found = [];
  const generated = new Set(['dist', 'target', '.next', '.astro', '.vite', '.cache']);
  if (includeDependencies) generated.add('node_modules');
  function walk(directory, relative = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      // Raw data, retained diagnostics, source/lock files and reports are never candidates.
      if (entry.name === 'raw' || entry.name === 'evidence' || entry.name === 'report') continue;
      const workspace = /(?:^|\/)(?:[^/]+-contexts|contexts|client-race|signals-race|candidate)(?:\/|$)/.test(rel);
      if (workspace && (generated.has(entry.name) || /(?:^|\/)(?:[^/]+-contexts|contexts)\/react-router\/build$/.test(rel))) { found.push(rel); continue; }
      walk(path.join(directory, entry.name), rel);
    }
  }
  walk(artifacts);
  return found;
}
export async function planCleanup(root, { runId, includeDependencies = false, includeDocker = false, docker = defaultDocker } = {}) {
  root = realpathSync(root);
  assert(validId(runId), 'cleanup requires an exact run ID');
  assert.equal(typeof includeDependencies, 'boolean'); assert.equal(typeof includeDocker, 'boolean');
  const run = safeDirectory(root, `runs/${runId}`);
  const manifestFile = safeDirectory(root, `runs/${runId}/manifest.json`);
  const manifest = json(manifestFile);
  assert.equal(manifest.runId ?? manifest.id, runId, 'run manifest identity differs');
  const active = activeState(root), blocked = [];
  if (active) blocked.push('An active or unresolved run lock exists. Finish or recover that run before cleanup.');
  if (['running', 'pending'].includes(manifest.status)) blocked.push('Run manifest is not finished.');
  const plan = { schemaVersion: 1, root, runId, createdAt: new Date().toISOString(),
    options: { includeDependencies, includeDocker }, manifestSha256: hash(readFileSync(manifestFile)), active, blocked, files: [], docker: [] };
  const relative = `runs/${runId}/artifacts`;
  if (existsSync(path.join(run, 'artifacts'))) {
    const artifacts = safeDirectory(root, relative);
    for (const entry of candidates(artifacts, includeDependencies)) {
      const target = safeDirectory(root, `${relative}/${entry}`);
      plan.files.push({ path: `${relative}/${entry}`, ...inventory(target), reason: 'Regenerable build/dependency output; raw evidence and source are retained.' });
    }
  }
  if (includeDocker) {
    try { const result = dockerCandidates(root, runId, docker); plan.docker = result.resources; plan.ownershipSha256 = result.owner.fingerprint; }
    catch (error) { blocked.push(error.message); }
  }
  plan.reclaimableBytes = plan.files.reduce((sum, file) => sum + file.bytes, 0);
  return plan;
}
export async function applyCleanup(root, plan, { docker = defaultDocker } = {}) {
  root = realpathSync(root);
  assert.equal(plan.schemaVersion, 1); assert.equal(plan.root, root, 'cleanup belongs to another project');
  assert.equal(plan.blocked.length, 0, plan.blocked.join(' '));
  const fresh = await planCleanup(root, { runId: plan.runId, ...plan.options, docker });
  assert.equal(fresh.blocked.length, 0, fresh.blocked.join(' '));
  for (const key of ['manifestSha256', 'files', 'docker', 'ownershipSha256']) assert.deepEqual(fresh[key], plan[key], 'cleanup plan is stale; inspect a fresh plan');
  const state = path.join(root, '.grandprix'); mkdirSync(state, { recursive: true });
  safeDirectory(root, '.grandprix');
  const lockPath = path.join(state, 'active.json');
  const token = randomUUID();
  const receipts = path.join(root, 'runs', plan.runId, 'cleanup');
  mkdirSync(receipts, { recursive: true });
  safeDirectory(root, `runs/${plan.runId}/cleanup`);
  const receiptPath = path.join(receipts, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  const receipt = { schemaVersion: 1, runId: plan.runId, at: new Date().toISOString(), host: os.platform(), freeBytesBefore: freeBytes(root), plannedBytes: plan.reclaimableBytes, actions: [], completed: false };
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, runId: plan.runId, hostname: os.hostname(), operation: 'cleanup', token, startedAt: new Date().toISOString() }), { flag: 'wx' });
  try {
    save();
    for (const item of plan.files) {
      const target = safeDirectory(root, item.path);
      assert.deepEqual(inventory(target), { bytes: item.bytes, fingerprint: item.fingerprint }, 'cleanup target changed');
      rmSync(target, { recursive: true });
      receipt.actions.push({ type: 'directory', path: item.path, bytes: item.bytes }); save();
    }
    for (const item of plan.docker) {
      const command = item.kind === 'container' ? ['container', 'rm', '-f', item.id]
        : item.kind === 'builder' ? ['buildx', 'rm', item.id] : [item.kind, 'rm', item.id];
      docker(command); receipt.actions.push({ type: 'docker', ...item }); save();
      if (item.kind === 'builder') {
        const owner = ownership(root, plan.runId);
        owner.record.builderCreated = false;
        writeFileSync(path.join(root, owner.relative), JSON.stringify(owner.record, null, 2) + '\n');
      }
    }
    receipt.completed = true;
  } catch (error) { receipt.error = error.message; throw error; }
  finally {
    receipt.finishedAt = new Date().toISOString(); receipt.freeBytesAfter = freeBytes(root);
    try { save(); } finally { if (existsSync(lockPath) && json(lockPath).token === token) rmSync(lockPath); }
  }
  return { ...receipt, receiptPath };
}
