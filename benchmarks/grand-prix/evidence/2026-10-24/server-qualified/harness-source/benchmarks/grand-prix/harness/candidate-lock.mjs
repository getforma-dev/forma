import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function registryRecords(text) {
  return text.split(/(?=^\[\[package\]\])/m).slice(1).map(block => {
    const field = key => new RegExp('^' + key + ' = "([^"]+)"', 'm').exec(block)?.[1];
    return { name: field('name'), version: field('version'), source: field('source'), checksum: field('checksum') };
  }).filter(p => p.source && !['forma-ir', 'forma-ir-derive', 'forma-server'].includes(p.name));
}
const sorted = records => records.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function checkCandidateLock(before, after, codecs = []) {
  const original = registryRecords(before), current = registryRecords(after);
  // Existing packages are immutable. Only the explicitly reviewed codec
  // records may be added, with exact registry version and checksum retained.
  const additions = codecs.filter(codec => !original.some(pkg => pkg.name === codec.name && pkg.version === codec.version));
  assert.deepEqual(sorted(current), sorted([...original, ...additions]), 'candidate changed the reviewed external dependency graph');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const codecs = process.argv.includes('--compression')
    ? JSON.parse(readFileSync('compression-codecs.json', 'utf8')).packages : [];
  checkCandidateLock(readFileSync('Cargo.registry.lock', 'utf8'), readFileSync('Cargo.lock', 'utf8'), codecs);
}
