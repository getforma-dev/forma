#!/usr/bin/env node
// R17: keep the historical corpus, then render this version's actual emission.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, json, run } from './release-set.mjs';
import { assertCurrentCorpus, withStagedCorpus } from './fmir-corpus.mjs';
import { verifyPackedCorpus } from './verify-release-set.mjs';

const frozen = join(ROOT, 'crates/forma-ir/tests/fixtures/js-emitter');
const manifest = join(ROOT, 'crates/forma-ir/Cargo.toml');
const output = mkdtempSync(join(tmpdir(), 'forma-current-corpus-'));
try {
  verifyPackedCorpus(manifest, 3);
  run(process.execPath, ['packages/compiler/scripts/emit-corpus.mjs', output], ROOT, { stdio: 'inherit' });
  const cases = readdirSync(output).filter(name => name.endsWith('.ir')).sort();
  assert(cases.length >= 14, 'the conformance corpus shrank');
  const expectedVersion = json(join(ROOT, 'packages/compiler/package.json')).version.split('-')[0].split('.').map(Number);
  const files = [];
  for (const file of cases) {
    const name = file.slice(0, -3), bytes = readFileSync(join(output, file));
    const dump = readFileSync(join(output, `${name}.dump`), 'utf8');
    assertCurrentCorpus({ name, bytes, dump, expectedVersion,
      frozenBytes: readFileSync(join(frozen, file)), frozenDump: readFileSync(join(frozen, `${name}.dump`), 'utf8') });
    files.push({ path: join(frozen, file), bytes }, { path: join(frozen, `${name}.dump`), bytes: dump });
  }
  withStagedCorpus(files, () => verifyPackedCorpus(manifest, 3));
} finally { rmSync(output, { recursive: true, force: true }); }
