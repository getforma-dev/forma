// Cargo-generated lock files only: preserve original records, resolve each edge
// before merging graphs, and never ask Cargo to choose a new dependency version.
import assert from 'node:assert/strict';

const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const identity = p => JSON.stringify([p.name, p.version, p.source ?? null]);
function scalar(block, key) { return new RegExp(`^${key} = "([^"\\r\\n]+)"\\r?$`, 'm').exec(block)?.[1]; }
function dependencyList(block) {
  const match = /^dependencies = \[\r?\n([\s\S]*?)^\]\r?$/m.exec(block);
  if (!match) { assert(!/^dependencies\s*=/m.test(block), 'unsupported Cargo lock dependency encoding'); return []; }
  return match[1].split(/\r?\n/).filter(line => line.trim()).map(line => {
    assert(/^\s*"[^"\r\n]+",\s*$/.test(line), 'unsupported Cargo lock dependency string');
    return JSON.parse(line.trim().slice(0, -1));
  });
}
function parse(text, label) {
  const [header, ...blocks] = text.split(/(?=^\[\[package\]\]\r?$)/m);
  assert(/^version = [34]\r?$/m.test(header), `${label}: expected Cargo lock format 3 or 4`);
  const records = blocks.map(raw => {
    assert(!/^\[(?!\[package\]\])/.test(raw.slice('[[package]]'.length)), `${label}: unsupported Cargo lock section`);
    const p = { raw, name: scalar(raw, 'name'), version: scalar(raw, 'version'), source: scalar(raw, 'source'), checksum: scalar(raw, 'checksum'), dependencies: dependencyList(raw) };
    assert(p.name && p.version, `${label}: malformed package record`);
    return p;
  });
  assert.equal(new Set(records.map(identity)).size, records.length, `${label}: duplicate package identity`);
  return { header, records };
}
function resolveEdge(ref, records, label) {
  const parts = /^(\S+)(?: ([^\s()]+))?(?: \(([^)]+)\))?$/.exec(ref);
  assert(parts, `${label}: unsupported dependency identity ${ref}`);
  const [, name, version, source] = parts;
  const matches = records.filter(p => p.name === name && (!version || p.version === version) && (!source || p.source === source));
  assert.equal(matches.length, 1, `${label}: missing or ambiguous dependency ${ref}`);
  return matches[0];
}
function reference(p, records) {
  const names = records.filter(x => x.name === p.name);
  if (names.length === 1) return p.name;
  const versions = names.filter(x => x.version === p.version);
  if (versions.length === 1) return `${p.name} ${p.version}`;
  assert(p.source, `ambiguous local source for ${p.name} ${p.version}`);
  return `${p.name} ${p.version} (${p.source})`;
}
// Cargo metadata normalizes the requirements used by this release set. Keep
// this matcher deliberately narrow: a future unsupported operator blocks staging
// until reviewed, rather than silently changing an application's old resolution.
function accepts(version, requirement) {
  assert(typeof requirement === 'string', 'packed Cargo dependency has no requirement');
  if (requirement.startsWith('=')) return version === requirement.slice(1).trim();
  const versionParts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!versionParts) return false; // prereleases require an explicit exact match
  if (requirement === '*') return true;
  const lower = /^\^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/.exec(requirement);
  assert(lower, `unsupported packed Cargo requirement ${requirement}`);
  const v = versionParts.slice(1).map(Number);
  const min = lower.slice(1).map(x => Number(x ?? 0));
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const upper = min[0] > 0 || lower[2] === undefined ? [min[0] + 1, 0, 0]
    : min[1] > 0 || lower[3] === undefined ? [0, min[1] + 1, 0] : [0, 0, min[2] + 1];
  return compare(v, min) >= 0 && compare(v, upper) < 0;
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Cargo orders package identities by name, Rust semver::Version (including its
// build-metadata tie-break), then source. Keep numeric components exact and use
// ASCII ordering, never locale collation. Empty source denotes a path package.
function compareVersion(a, b) {
  if (a === b) return 0;
  const parseVersion = value => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
    assert(match, `unsupported recorded Cargo version ${value}`);
    return match;
  };
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 1; i <= 3; i++) {
    const order = compare(BigInt(left[i]), BigInt(right[i]));
    if (order) return order;
  }
  function identifiers(a, b, prerelease) {
    if (a === b) return 0;
    if (!a || !b) return prerelease ? (a ? -1 : 1) : (a ? 1 : -1);
    const left = a.split('.'), right = b.split('.');
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const x = left[i], y = right[i];
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      const order = nx && ny ? compare(BigInt(x), BigInt(y)) || compare(x.length, y.length)
        : nx !== ny ? (nx ? -1 : 1) : compare(x, y);
      if (order) return order;
    }
    return compare(left.length, right.length);
  }
  return identifiers(left[4], right[4], true) || identifiers(left[5], right[5], false);
}
function comparePackage(a, b) {
  return compare(a.name, b.name) || compareVersion(a.version, b.version) || compare(a.source ?? '', b.source ?? '');
}
function writeDependencies(raw, refs) {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const replacement = refs.length ? `dependencies = [${newline}${refs.map(ref => ` ${JSON.stringify(ref)},${newline}`).join('')}]` : '';
  if (/^dependencies = \[/m.test(raw)) return raw.replace(/^dependencies = \[\r?\n[\s\S]*?^\]\r?$/m, replacement);
  if (!refs.length) return raw;
  return raw.trimEnd() + newline + replacement + newline + newline;
}

/**
 * Merge the candidate runtime closure from its reviewed lock, using packed
 * Cargo metadata to exclude dev-only roots/edges. Existing external records keep
 * all metadata and resolutions; only an edge's spelling may gain qualification
 * when an added version makes its original short name ambiguous.
 */
export function mergeRecordedCargoLock(text, packages, recorded) {
  const original = parse(text, 'template');
  const source = parse(recorded.lock, 'candidate');
  const candidates = new Map(packages.filter(p => p.registry === 'crates').map(p => [p.name, p]));
  const originalById = new Map(original.records.map(p => [identity(p), p]));
  // Resolve original edges before adding anything. A pre-existing ambiguity is
  // not evidence of which version the application had, and must fail closed.
  const oldEdges = new Map(original.records.map(p => [p, p.dependencies.map(ref => resolveEdge(ref, original.records, `template ${p.name}`))]));
  const selected = new Map();
  const edges = new Map();
  const candidateByName = new Map();
  function add(record) {
    const candidate = candidates.get(record.name);
    if (candidate) {
      if (candidateByName.has(record.name)) return candidateByName.get(record.name);
      const matches = source.records.filter(p => p.name === candidate.name && p.version === candidate.version && !p.source);
      assert.equal(matches.length, 1, `${candidate.name}: missing exact local candidate in recorded Cargo.lock`);
      const src = matches[0];
      const metadata = recorded.packages.find(p => p.name === candidate.name && p.version === candidate.version);
      assert(metadata, `${candidate.name}: missing packed Cargo metadata`);
      assert(/^[a-f0-9]{64}$/.test(candidate.sha256), `${candidate.name}: missing packed checksum`);
      const next = { ...src, source: REGISTRY, checksum: candidate.sha256 };
      // Workspace member records are local; the staged template consumes the
      // exact packed archive. Do not preserve an A2 candidate's stale edge list.
      next.raw = src.raw.replace(/^version = "[^"\r\n]+"\r?$/m,
        `version = "${candidate.version}"\nsource = "${REGISTRY}"\nchecksum = "${candidate.sha256}"`);
      candidateByName.set(record.name, next); selected.set(identity(next), next);
      const runtime = metadata.dependencies.filter(dep => dep.kind !== 'dev');
      const allowed = new Set(runtime.map(dep => dep.name));
      const dependencies = src.dependencies.map(ref => resolveEdge(ref, source.records, `candidate ${src.name}`)).filter(dep => allowed.has(dep.name));
      for (const dep of runtime.filter(dep => !dep.optional)) assert(dependencies.some(p => p.name === dep.name), `${src.name}: recorded lock omits packed runtime dependency ${dep.name}`);
      const previous = original.records.find(p => p.name === candidate.name);
      const previousEdges = previous ? oldEdges.get(previous) : [];
      edges.set(next, dependencies.map(dep => {
        if (candidates.has(dep.name)) return add(dep);
        const constraints = runtime.filter(item => item.name === dep.name);
        const retained = previousEdges.filter(old => old.name === dep.name
          && old.source === dep.source && constraints.every(item => accepts(old.version, item.req)));
        assert(retained.length <= 1, `${candidate.name}: ambiguous previous runtime edge ${dep.name}`);
        return add(retained[0] ?? dep);
      }));
      return next;
    }
    const key = identity(record);
    const old = originalById.get(key);
    if (old) {
      assert.equal(old.checksum, record.checksum, `${record.name}: checksum disagrees for the same recorded identity`);
      return old;
    }
    if (selected.has(key)) return selected.get(key);
    assert(record.source?.startsWith('registry+') && /^[a-f0-9]{64}$/.test(record.checksum ?? ''), `${record.name}: added runtime dependency is not a recorded checksum-pinned registry archive`);
    selected.set(key, record);
    edges.set(record, record.dependencies.map(ref => add(resolveEdge(ref, source.records, `candidate ${record.name}`))));
    return record;
  }
  for (const p of original.records) if (candidates.has(p.name)) add(p);
  const records = original.records.map(p => candidateByName.get(p.name) ?? p);
  const seen = new Set(records.map(identity));
  for (const p of selected.values()) if (!seen.has(identity(p))) { records.push(p); seen.add(identity(p)); }
  records.sort(comparePackage);
  const render = p => {
    const newEdges = edges.get(p);
    if (newEdges) return writeDependencies(p.raw, newEdges.map(dep => reference(dep, records)));
    const targets = oldEdges.get(p).map(dep => candidateByName.get(dep.name) ?? dep);
    const refs = p.dependencies.map((ref, index) => {
      const target = targets[index];
      try { if (identity(resolveEdge(ref, records, p.name)) === identity(target)) return ref; } catch { /* Qualify the original, already-proven target. */ }
      return reference(target, records);
    });
    return refs.every((ref, i) => ref === p.dependencies[i]) ? p.raw : writeDependencies(p.raw, refs);
  };
  return original.header + records.map(render).map((raw, index) => index < records.length - 1 && !raw.endsWith('\n\n') ? raw.trimEnd() + '\n\n' : raw).join('');
}
