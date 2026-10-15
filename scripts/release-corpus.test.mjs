import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './release-set.mjs';
import { verifyPackedCorpus } from './verify-release-set.mjs';

const cases = [
  'corpus_contains_every_expected_case', 'every_case_parses_as_fmir',
  'slot_names_are_pairwise_unique', 'slot_ids_are_pairwise_unique',
  'every_case_walks_to_html', 'every_island_entry_walks_as_a_fragment',
  'resolution_cases_ship_named_islands_over_named_slots',
  'corpus_exercises_multibyte_utf8', 'rendered_html_matches_golden',
  'canonical_dumps_match_the_typescript_emitter',
];
function fixture(fmir, change, visit) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-release-corpus-'));
  try {
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'tests'));
    const manifest = join(dir, 'Cargo.toml');
    writeFileSync(manifest, '[package]\nname = "forma-release-corpus-fixture"\nversion = "0.0.0"\nedition = "2021"\n[workspace]\n');
    let tests = cases.slice(0, fmir === 2 ? 9 : 10).map(name => `#[test] fn ${name}() {}`).join('\n');
    if (change) tests = change(tests);
    writeFileSync(join(dir, 'src/lib.rs'), fmir === 2 ? '' : `#[cfg(test)] mod js_emitter_contract {\n${tests}\n}`);
    if (fmir === 2) writeFileSync(join(dir, 'tests/js_emitter_contract.rs'), tests);
    run('cargo', ['generate-lockfile', '--offline', '--manifest-path', manifest], dir);
    visit(manifest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('packed corpus executes immutable A2 integration tests and private v3 unit tests', () => {
  for (const fmir of [2, 3]) fixture(fmir, null, manifest => verifyPackedCorpus(manifest, fmir));
});
test('packed corpus refuses an empty filter, missing fragment check or ignored semantic check', () => {
  fixture(3, () => '', manifest => assert.throws(() => verifyPackedCorpus(manifest, 3), /packed corpus is missing/));
  fixture(3, source => source.replace('every_island_entry_walks_as_a_fragment', 'unrelated'), manifest => {
    assert.throws(() => verifyPackedCorpus(manifest, 3), /missing js_emitter_contract::every_island_entry_walks_as_a_fragment/);
  });
  for (const fmir of [2, 3]) fixture(fmir, source => source.replace('#[test] fn rendered_html_matches_golden', '#[test] #[ignore] fn rendered_html_matches_golden'), manifest => {
    assert.throws(() => verifyPackedCorpus(manifest, fmir), /did not execute .*rendered_html_matches_golden/);
  });
});
test('packed corpus propagates a failing Rust semantic check', () => {
  fixture(3, source => source.replace('fn rendered_html_matches_golden() {}', 'fn rendered_html_matches_golden() { panic!("broken golden"); }'), manifest => {
    assert.throws(() => verifyPackedCorpus(manifest, 3), /Command failed/);
  });
});
