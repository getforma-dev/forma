/** The archived pre-attribute-values corpus outputs (docs/archive/2026-10-15-pre-attribute-values)
 *  stay byte-exact, and the ledger names every live corpus file FORMA-182's F2/F3 regenerated,
 *  with its before (archived) and after (live) hash. */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';

const ARCHIVE = resolve(__dirname, '../../../docs/archive/2026-10-15-pre-attribute-values');
const ROOT = resolve(__dirname, '../../..');
type Hash = {bytes: number; sha256: string};
const manifest = JSON.parse(readFileSync(join(ARCHIVE, 'manifest.json'), 'utf8')) as {sha256: Record<string, Hash>};
const ledger = JSON.parse(readFileSync(join(ARCHIVE, 'ledger.json'), 'utf8')) as {files: Record<string, {archived: string; before: Hash; after: Hash; change: string}>};
const hash = (path: string): Hash => { const bytes = readFileSync(path); return {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}; };

describe('archived pre-attribute-values corpus outputs', () => {
  it('keeps every archived original byte-exact under its manifest', () => {
    expect(Object.keys(manifest.sha256).sort()).toEqual([
      'js-emitter/dynamic-attrs.dump', 'js-emitter/dynamic-attrs.html', 'js-emitter/dynamic-attrs.ir',
      'js-emitter/jsx-page.html', 'js-emitter/sub-component-scopes.html',
    ]);
    for (const [name, expected] of Object.entries(manifest.sha256)) expect(hash(join(ARCHIVE, name)), name).toEqual(expected);
  });
  it('records a before and after hash for every regenerated corpus file, each changed', () => {
    for (const [live, entry] of Object.entries(ledger.files)) {
      expect(hash(join(ROOT, live)), live).toEqual(entry.after);
      expect(manifest.sha256[entry.archived], live).toEqual(entry.before);
      expect(entry.before.sha256, live).not.toBe(entry.after.sha256);
    }
    expect(Object.keys(ledger.files).length).toBe(Object.keys(manifest.sha256).length);
  });
});

it('keeps the boolean-attribute review originals byte-exact', () => {
  const folder = resolve(ROOT, 'docs/archive/2026-10-15-boolean-attribute-review');
  const original = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { files: Record<string, Hash> };
  expect(Object.keys(original.files).sort()).toEqual(['value-rule-6-attributes.test.ts', 'walker.rs']);
  for (const [name, expected] of Object.entries(original.files)) {
    expect(hash(join(folder, name)), name).toEqual({ bytes: expected.bytes, sha256: expected.sha256 });
  }
});
