import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ROOT, run } from './release-set.mjs';
import { verifyPackedPropsFixtures, verifyPackedPropsTests } from './verify-release-set.mjs';
import { withStagedCorpus } from './fmir-corpus.mjs';

const cases = [
  'actual_compiler_module_binds_by_declared_names_and_renders_two_list_views',
  'every_request_checks_numeric_and_date_bounds_with_declared_paths',
  'bind_errors_stop_startup_before_listener_and_keep_both_source_positions',
  'unknown_browser_and_ambiguous_pages_refuse_binding',
  'no_parameter_and_typed_empty_pages_bind_without_handler_filling_local_lists',
];
function fixture(change, visit) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-props-'));
  try {
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'tests'));
    const manifest = join(dir, 'Cargo.toml');
    writeFileSync(manifest, '[package]\nname = "forma-release-props-fixture"\nversion = "0.0.0"\nedition = "2021"\n[workspace]\n');
    let tests = cases.map(name => `#[test] fn ${name}() { assert!(std::env::var_os("UPDATE_GOLDEN").is_none()); }`).join('\n');
    tests += '\nmod reload { #[test] fn reload_keeps_last_good_files_and_rechecks_new_schema_with_matching_asset_snapshot() {} #[test] fn rejected_or_missing_manifest_freezes_the_entire_pair_until_valid_recovery() {} }';
    writeFileSync(join(dir, 'src/lib.rs'), '');
    writeFileSync(join(dir, 'tests/typed_pages.rs'), change(tests));
    run('cargo', ['generate-lockfile', '--offline', '--manifest-path', manifest], dir);
    visit(manifest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('packed typed Pages executes every required check with immutable fixtures', () => {
  const previous = process.env.UPDATE_GOLDEN;
  process.env.UPDATE_GOLDEN = '1';
  try { fixture(source => source, verifyPackedPropsTests); }
  finally {
    if (previous === undefined) delete process.env.UPDATE_GOLDEN;
    else process.env.UPDATE_GOLDEN = previous;
  }
});
test('packed typed Pages refuses missing, ignored and failing semantic checks', () => {
  fixture(() => '', manifest => assert.throws(() => verifyPackedPropsTests(manifest), /packed props are missing/));
  fixture(source => source.replace('#[test]', '#[test] #[ignore]'), manifest => assert.throws(() => verifyPackedPropsTests(manifest), /packed props did not execute/));
  fixture(source => source.replace('assert!(std::env::var_os("UPDATE_GOLDEN").is_none());', 'panic!("broken binding");'), manifest => assert.throws(() => verifyPackedPropsTests(manifest), /Command failed/));
});
function restamp(bytes, version) {
  if (version) version.forEach((part, index) => bytes.writeUInt16LE(part, 8 + 2 * index));
  const crc = Number(execFileSync('python3', ['-c', 'import sys,zlib; b=sys.stdin.buffer.read(); print(zlib.crc32(b[:18]+b[22:]) & 0xffffffff)'], { input: bytes, encoding: 'utf8' }));
  bytes.writeUInt32LE(crc, 18);
  return bytes;
}
test('declared props preserve frozen bodies and stage actual current bytes with matching digests, restoring all files on failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-props-bytes-'));
  try {
    const directory = join(dir, 'tests/fixtures/props-contract');
    cpSync(join(ROOT, 'crates/forma-server/tests/fixtures/props-contract'), directory, { recursive: true });
    const files = ['home.ir', 'empty.ir', 'empty-typed.ir', 'manifest.json'];
    const original = Object.fromEntries(files.map(file => [file, readFileSync(join(directory, file))]));
    const fixtureFor = entry => basename(entry) === 'empty-app.ts' ? 'empty.ir' : basename(entry) === 'empty-typed-app.ts' ? 'empty-typed.ir' : 'home.ir';
    for (const version of [[3, 0, 0], [3, 1, 0]]) {
      const compiler = { generateRealIr: entry => ({ binary: restamp(Buffer.from(original[fixtureFor(entry)]), version) }) };
      const current = verifyPackedPropsFixtures(compiler, dir, version);
      for (const fails of [false, true]) {
        const verify = () => withStagedCorpus(current, () => {
          const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
          assert.equal(manifest.writer, version.join('.'));
          for (const file of files.filter(file => file.endsWith('.ir'))) {
            const bytes = readFileSync(join(directory, file));
            assert.deepEqual(bytes, restamp(Buffer.from(original[file]), version));
            assert.equal(manifest.assets[file].integrity, `sha384-${createHash('sha384').update(bytes).digest('base64')}`);
          }
          const historical = JSON.parse(original['manifest.json']);
          historical.writer = manifest.writer;
          for (const file of Object.keys(historical.assets)) historical.assets[file].integrity = manifest.assets[file].integrity;
          assert.deepEqual(manifest, historical, 'only writer and integrity may change');
          if (fails) throw Error('native refusal');
        });
        if (fails) assert.throws(verify, /native refusal/); else verify();
        for (const file of files) assert.deepEqual(readFileSync(join(directory, file)), original[file]);
      }
      for (const [change, message] of [
        [bytes => { bytes[bytes.length - 1] ^= 1; return restamp(bytes); }, /emitted bytes differ/],
        [bytes => restamp(bytes, [3, version[1] + 1, 0]), /writer does not match/],
        [bytes => { bytes[18] ^= 1; return bytes; }, /CRC/],
      ]) assert.throws(() => verifyPackedPropsFixtures({ generateRealIr: entry => ({ binary: change(compiler.generateRealIr(entry).binary) }) }, dir, version), message);
      assert.throws(() => verifyPackedPropsFixtures({ generateRealIr: () => null }, dir, version), /fell back to placeholder/);
    }
    const corrupt = JSON.parse(original['manifest.json']); corrupt.assets['home.ir'].integrity = 'sha384-' + 'A'.repeat(64);
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(corrupt));
    assert.throws(() => verifyPackedPropsFixtures({ generateRealIr: () => ({ binary: original['home.ir'] }) }, dir, [3, 0, 0]), /manifest integrity differs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recorded finalized rendering refuses a package with only interim typed checks', () => {
  fixture(source => source, manifest => assert.throws(
    () => verifyPackedPropsTests(manifest, { boundRender: true }), /missing finalization_refuses/,
  ));
});
