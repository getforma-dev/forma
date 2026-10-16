import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packedCargoGraph, run, digest } from './release-set.mjs';
import { mergeRecordedCargoLock } from './release-cargo-lock.mjs';

const registry = 'registry+https://github.com/rust-lang/crates.io-index';
const checksum = letter => letter.repeat(64);
function block(name, version, dependencies = [], letter = 'a', source = registry) {
  return `[[package]]\nname = "${name}"\nversion = "${version}"\n${source ? `source = "${source}"\nchecksum = "${checksum(letter)}"\n` : ''}${dependencies.length ? `dependencies = [\n${dependencies.map(dep => ` "${dep}",\n`).join('')}]\n` : ''}\n`;
}
const lock = (...blocks) => 'version = 4\n\n' + blocks.join('');
const candidates = ['forma-ir', 'forma-ir-derive'].map((name, i) => ({ registry: 'crates', name, version: '3.0.0-dev', sha256: checksum(i ? 'e' : 'd') }));
const dependency = (name, kind = null, req = '*') => ({ name, kind, req, optional: false });
function fixture() {
  const oldSyn = block('syn', '3.0.9', [], 'b');
  const oldUser = block('existing-macro', '1.0.0', ['syn'], 'c');
  const original = lock(block('app', '0.1.0', ['forma-ir', 'existing-macro'], 'a', null), block('forma-ir', '0.2.2'), oldSyn, oldUser);
  const recorded = {
    lock: lock(block('forma-ir', '3.0.0-dev', ['forma-ir-derive', 'forma-ir'], 'a', null), block('forma-ir-derive', '3.0.0-dev', ['syn'], 'a', null), block('syn', '2.0.119', ['unicode-ident'], 'f'), block('unicode-ident', '1.0.24', [], '1')),
    packages: [
      { name: 'forma-ir', version: '3.0.0-dev', dependencies: [dependency('forma-ir-derive'), dependency('forma-ir', 'dev')] },
      { name: 'forma-ir-derive', version: '3.0.0-dev', dependencies: [dependency('syn')] },
    ],
  };
  return { original, recorded, oldSyn, oldUser };
}

test('recorded Cargo runtime closure adds derive and a second exact external version without changing old resolutions', () => {
  const { original, recorded, oldSyn, oldUser } = fixture();
  const staged = mergeRecordedCargoLock(original, candidates, recorded);
  assert(staged.includes(oldSyn), 'old external package metadata and checksum remain byte-identical');
  assert(staged.includes(oldUser.replace(' "syn",', ' "syn 3.0.9",')), 'only ambiguous old edge spelling changes; its target stays the old version');
  assert(staged.includes('name = "forma-ir-derive"\nversion = "3.0.0-dev"\nsource = "' + registry + '"\nchecksum = "' + checksum('e')));
  assert(staged.includes('dependencies = [\n "syn 2.0.119",\n]'), 'candidate derive pins the recorded new version');
  assert(staged.includes(block('unicode-ident', '1.0.24', [], '1')));
  const ir = staged.split(/(?=\[\[package\]\])/).find(x => /^name = "forma-ir"$/m.test(x));
  assert.match(ir, /dependencies = \[\n "forma-ir-derive",\n\]/);
  assert(!ir.includes(' "forma-ir",'), 'dev-only self edge is excluded using packed metadata');
  assert.equal(mergeRecordedCargoLock(staged, candidates, recorded), staged, 'staging is deterministic and idempotent');
});

test('new runtime records use Cargo order and preserve original package bytes', () => {
  const { recorded } = fixture();
  recorded.lock = recorded.lock.replace(' "forma-ir-derive",', ' "forma-ir-derive",\n "ryu-js",') + block('ryu-js', '1.0.3', [], '2');
  recorded.packages[0].dependencies.push(dependency('ryu-js', null, '=1.0.3'));
  const oldRyu = block('ryu', '1.0.23', [], '3');
  const tail = block('zmij', '1.0.21', [], '4');
  const original = lock(block('app', '0.1.0', ['forma-ir', 'ryu', 'zmij'], 'a', null), block('forma-ir', '0.2.2'), oldRyu, tail);
  const staged = mergeRecordedCargoLock(original, candidates, recorded);
  const names = [...staged.matchAll(/^name = "([^"]+)"$/gm)].map(match => match[1]);
  assert.deepEqual(names, ['app', 'forma-ir', 'forma-ir-derive', 'ryu', 'ryu-js', 'syn', 'unicode-ident', 'zmij']);
  assert(staged.includes(oldRyu)); assert(staged.includes(tail));
  assert.equal(mergeRecordedCargoLock(staged, candidates, recorded), staged);
});

test('Cargo identity order uses numeric versions, prereleases, build identifiers and source ties', () => {
  const { recorded } = fixture();
  const versions = ['1.9.0', '1.10.0-alpha', '1.10.0-alpha.2', '1.10.0-alpha.11', '1.10.0-rc.1', '1.10.0', '1.10.0+0', '1.10.0+00', '1.10.0+1', '1.10.0+01', '1.10.0+2', '1.10.0+10', '1.10.0+x', '2.0.119', '3.0.9'];
  const original = lock(block('app', '0.1.0', ['forma-ir'], 'a', null), block('forma-ir', '0.2.2'), ...versions.filter(version => version !== '2.0.119').map(version => block('syn', version, [], 'b')));
  const staged = mergeRecordedCargoLock(original, candidates, recorded);
  const records = staged.split(/(?=^\[\[package\]\])/m).filter(raw => /^name = "syn"$/m.test(raw));
  assert.deepEqual(records.map(raw => /^version = "([^"]+)"$/m.exec(raw)[1]), versions, 'inserted 2.0.119 precedes 3.0.9 while numeric and prerelease ordering is retained');
  const alternative = 'registry+https://example.invalid/alternative';
  const ties = lock(block('app', '0.1.0', ['forma-ir'], 'a', null), block('forma-ir', '0.2.2'), block('syn', '2.0.119', [], 'b', null), block('syn', '2.0.119', [], 'b', alternative));
  const tied = mergeRecordedCargoLock(ties, candidates, recorded).split(/(?=^\[\[package\]\])/m).filter(raw => /^name = "syn"$/m.test(raw));
  assert.deepEqual(tied.map(raw => /^source = "([^"]+)"$/m.exec(raw)?.[1] ?? null), [null, alternative, registry]);
});

test('Cargo closure refuses an already ambiguous original reference instead of guessing its old target', () => {
  const { original, recorded } = fixture();
  assert.throws(() => mergeRecordedCargoLock(original + block('syn', '1.0.0'), candidates, recorded), /template existing-macro: missing or ambiguous dependency syn/);
});

test('Cargo closure distinguishes same name/version from a different source and qualifies new references', () => {
  const { recorded } = fixture();
  const alternative = 'registry+https://example.invalid/alternative';
  const original = lock(block('app', '0.1.0', ['forma-ir', 'existing-macro'], 'a', null), block('forma-ir', '0.2.2'), block('syn', '2.0.119', [], 'b', alternative), block('existing-macro', '1.0.0', ['syn'], 'c'));
  const staged = mergeRecordedCargoLock(original, candidates, recorded);
  assert(staged.includes(` "syn 2.0.119 (${alternative})",`));
  assert(staged.includes(` "syn 2.0.119 (${registry})",`));
  assert(staged.includes(block('syn', '2.0.119', [], 'b', alternative)));
});

test('Cargo closure rejects incomplete or inconsistent recorded runtime graphs', () => {
  const { original, recorded } = fixture();
  const absent = structuredClone(recorded); absent.lock = absent.lock.replace(block('unicode-ident', '1.0.24', [], '1'), '');
  assert.throws(() => mergeRecordedCargoLock(original, candidates, absent), /missing or ambiguous dependency unicode-ident/);
  const missingEdge = structuredClone(recorded); missingEdge.lock = missingEdge.lock.replace(' "forma-ir-derive",\n', '');
  assert.throws(() => mergeRecordedCargoLock(original, candidates, missingEdge), /omits packed runtime dependency forma-ir-derive/);
  const unpinned = structuredClone(recorded); unpinned.lock = unpinned.lock.replace(`checksum = "${checksum('1')}"\n`, '');
  assert.throws(() => mergeRecordedCargoLock(original, candidates, unpinned), /not a recorded checksum-pinned registry archive/);
  const sameIdentityWrongChecksum = original + block('unicode-ident', '1.0.24', [], '2');
  assert.throws(() => mergeRecordedCargoLock(sameIdentityWrongChecksum, candidates, recorded), /checksum disagrees/);
  const noMetadata = { ...recorded, packages: [] };
  assert.throws(() => mergeRecordedCargoLock(original, candidates, noMetadata), /missing packed Cargo metadata/);
});


test('unchanged packed runtime requirements retain the application external version instead of forcing a workspace downgrade', () => {
  const { recorded } = fixture();
  recorded.lock = recorded.lock.replace(' "forma-ir-derive",', ' "forma-ir-derive",\n "rust-embed",') + block('rust-embed', '8.11.0', [], '3');
  recorded.packages[0].dependencies.push(dependency('rust-embed', null, '^8'));
  const original = lock(block('app', '0.1.0', ['forma-ir', 'rust-embed'], 'a', null), block('forma-ir', '0.2.2', ['rust-embed']), block('rust-embed', '8.13.0', [], '4'));
  const staged = mergeRecordedCargoLock(original, candidates, recorded);
  assert(staged.includes(block('rust-embed', '8.13.0', [], '4')));
  assert(!staged.includes('8.11.0'), 'the candidate keeps the already-compatible application edge');
  const stricter = structuredClone(recorded); stricter.packages[0].dependencies.at(-1).req = '=8.11.0';
  assert(mergeRecordedCargoLock(original, candidates, stricter).includes('8.11.0'), 'an exact changed requirement adds its recorded version');
  const unsupported = structuredClone(recorded); unsupported.packages[0].dependencies.at(-1).req = '>=8';
  assert.throws(() => mergeRecordedCargoLock(original, candidates, unsupported), /unsupported packed Cargo requirement/);
});


test('packed Cargo metadata inspection is offline and locked even for an unpublished dependency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-cargo-closure-metadata-'));
  try {
    const member = join(dir, 'forma-ir-3.0.0-dev'); mkdirSync(join(member, 'src'), { recursive: true });
    writeFileSync(join(member, 'src/lib.rs'), '');
    writeFileSync(join(member, 'Cargo.toml'), '[package]\nname="forma-ir"\nversion="3.0.0-dev"\nedition="2021"\n[dependencies]\nforma-ir-derive="=99.99.99"\n');
    const source = lock(block('forma-ir', '3.0.0-dev', [], 'a', null));
    writeFileSync(join(dir, 'Cargo.lock'), source);
    const file = 'forma-ir-3.0.0-dev.crate';
    run('tar', ['-czf', join(dir, file), '-C', dir, 'forma-ir-3.0.0-dev']);
    const packages = [{ registry: 'crates', name: 'forma-ir', version: '3.0.0-dev', file, sha256: digest(join(dir, file)) }];
    const graph = packedCargoGraph(dir, packages, dir);
    assert.equal(graph.lock, source);
    assert.equal(graph.packages[0].dependencies[0].req, '=99.99.99');
    assert.equal(readFileSync(join(dir, 'Cargo.lock'), 'utf8'), source);
    assert(!existsSync(join(member, 'Cargo.lock')));
    assert.throws(() => packedCargoGraph(dir, [{ ...packages[0], sha256: '0'.repeat(64) }], dir), /packed archive checksum changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
