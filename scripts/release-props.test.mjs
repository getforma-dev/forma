import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './release-set.mjs';
import { verifyPackedPropsFixtures, verifyPackedPropsTests } from './verify-release-set.mjs';

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
    tests += '\nmod reload { #[test] fn reload_keeps_last_good_files_and_rechecks_new_schema_with_matching_asset_snapshot() {} }';
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
test('packed declared fixture comparison refuses stale bytes and placeholder fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-props-bytes-'));
  try {
    mkdirSync(join(dir, 'tests/fixtures/props-contract'), { recursive: true });
    for (const name of ['home', 'empty', 'empty-typed']) writeFileSync(join(dir, 'tests/fixtures/props-contract', `${name}.ir`), Buffer.from([1, 2]));
    verifyPackedPropsFixtures({ generateRealIr: () => ({ binary: new Uint8Array([1, 2]) }) }, dir);
    assert.throws(() => verifyPackedPropsFixtures({ generateRealIr: () => ({ binary: new Uint8Array([2, 1]) }) }, dir), /differ from packed/);
    assert.throws(() => verifyPackedPropsFixtures({ generateRealIr: () => null }, dir), /fell back to placeholder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
