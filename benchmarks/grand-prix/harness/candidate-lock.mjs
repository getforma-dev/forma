import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const formaNames = ['forma-ir', 'forma-ir-derive', 'forma-server'];
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
function records(text, section = 'package') {
  return text.split(/(?=^\[\[)/m).filter(block => block.startsWith(`[[${section}]]\n`)).map(block => {
    const field = key => new RegExp('^' + key + ' = "([^"]+)"', 'm').exec(block)?.[1];
    return { name: field('name'), version: field('version'), source: field('source'), checksum: field('checksum') };
  });
}
export function registryRecords(text) {
  return records(text).filter(p => p.source && !formaNames.includes(p.name));
}
const sorted = records => records.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function checkCandidateLock(before, after, codecs = [], { version, metadata } = {}) {
  assert(typeof version === 'string' && exactVersion.test(version), 'exact candidate version required');
  const selected = records(after).filter(p => formaNames.includes(p.name));
  assert.equal(selected.length, formaNames.length, 'candidate must resolve exactly three Forma crates');
  assert(!records(after, 'patch.unused').some(p => formaNames.includes(p.name)), 'unused Forma candidate patch');
  for (const name of formaNames) {
    assert.deepEqual(selected.filter(p => p.name === name), [{ name, version, source: undefined, checksum: undefined }],
      `${name}: candidate must resolve the selected local version, not a registry crate`);
  }
  assert(Array.isArray(metadata?.packages) && Array.isArray(metadata?.resolve?.nodes), 'candidate cargo metadata required');
  const root = metadata.packages.find(p => p.id === metadata.resolve.root);
  assert.equal(root?.manifest_path, '/app/Cargo.toml', 'candidate metadata must describe the benchmark consumer');
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  assert.equal(nodes.size, metadata.resolve.nodes.length, 'duplicate metadata resolve node');
  const reached = new Set(), visit = [metadata.resolve.root];
  while (visit.length) {
    const id = visit.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    const node = nodes.get(id);
    assert(node && Array.isArray(node.dependencies), 'incomplete candidate resolved graph');
    visit.push(...node.dependencies);
  }
  for (const name of formaNames) {
    const packages = metadata.packages.filter(p => p.name === name);
    assert.equal(packages.length, 1, `${name}: one candidate metadata package required`);
    const pkg = packages[0];
    assert.equal(pkg.version, version, `${name}: metadata version differs`);
    assert.equal(pkg.source, null, `${name}: metadata must resolve a local candidate`);
    assert.equal(pkg.manifest_path, `/candidate/crates/${name}/Cargo.toml`, `${name}: wrong candidate path`);
    assert(reached.has(pkg.id), `${name}: candidate is not in the consumer graph`);
  }
  const original = registryRecords(before), current = registryRecords(after);
  // Existing packages are immutable. Only the explicitly reviewed codec
  // records may be added, with exact registry version and checksum retained.
  const additions = codecs.filter(codec => !original.some(pkg => pkg.name === codec.name && pkg.version === codec.version));
  assert.deepEqual(sorted(current), sorted([...original, ...additions]), 'candidate changed the reviewed external dependency graph');
  const otherLocal = text => records(text).filter(p => !p.source && !formaNames.includes(p.name));
  assert.deepEqual(sorted(otherLocal(after)), sorted(otherLocal(before)), 'candidate added an unreviewed local dependency');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const codecs = process.argv.includes('--compression')
    ? JSON.parse(readFileSync('compression-codecs.json', 'utf8')).packages : [];
  const candidate = JSON.parse(readFileSync('candidate-source.json', 'utf8'));
  checkCandidateLock(readFileSync('Cargo.registry.lock', 'utf8'), readFileSync('Cargo.lock', 'utf8'), codecs,
    { version: candidate.version, metadata: JSON.parse(readFileSync('candidate-metadata.json', 'utf8')) });
}
