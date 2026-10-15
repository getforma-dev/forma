/** The archived pre-keyed-rows sources (docs/archive/2026-10-15-pre-keyed-rows) stay
 *  executable refusal evidence: each form FORMA-181 migrated now refuses with its code. */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {createIslandRegistry} from '../src/island-registry';

const ARCHIVE = resolve(__dirname, '../../../docs/archive/2026-10-15-pre-keyed-rows');
const manifest = JSON.parse(readFileSync(join(ARCHIVE, 'manifest.json'), 'utf8')) as {sha256: Record<string, {bytes: number; sha256: string}>};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}); vi.restoreAllMocks(); });
function scratch(): string { const dir = mkdtempSync(join(tmpdir(), 'forma-keyed-archive-')); dirs.push(dir); return dir; }
function archived(name: string): string {
  const bytes = readFileSync(join(ARCHIVE, 'sources', name));
  expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(manifest.sha256[`sources/${name}`]!.sha256);
  return bytes.toString('utf8');
}

describe('archived pre-keyed-rows sources', () => {
  it.each(['row-root-conditional', 'direct-row-conditional'])('%s: the island row whose root is a conditional refuses with BUILD-613 at its list', name => {
    const dir = scratch(), entry = join(dir, 'entry.tsx');
    writeFileSync(entry, archived(`adoption-conditional-${name}.tsx`));
    expect(() => createIslandRegistry(entry).entries()[0]!.island.analyze()).toThrow(/^BUILD-613 .*entry\.tsx:2:\d+: LIST row must have exactly one stable owned Element/);
  });
  it.each(['local-aggregates', 'aggregate-fallback'])('%s: the island list keyed by the row itself refuses with BUILD-612 at its list', name => {
    const dir = scratch();
    writeFileSync(join(dir, 'app.ts'), archived('island-emission.app.ts'));
    writeFileSync(join(dir, 'page.ts'), archived(`island-emission-${name}.page.ts`));
    writeFileSync(join(dir, 'island.ts'), archived(`island-emission-${name}.island.ts`));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => generateRealIr(join(dir, 'app.ts'))).toThrow(/^BUILD-612 .*island\.ts:1:\d+: LIST key cannot be the row itself/);
  });
  it('the declared page list keyed by the row itself refuses with BUILD-612 before its string source is examined', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'app.ts'), `import { mount } from '@getforma/core'; import { Page } from './page'; mount(() => Page(), '#app');`);
    writeFileSync(join(dir, 'page.ts'), archived('props-bindings-scalar-key.ts'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => generateRealIr(join(dir, 'app.ts'))).toThrow(/^BUILD-612 .*page\.ts:2:\d+: LIST key cannot be the row itself/);
  });
  it('keeps every archived original byte-exact under its manifest', () => {
    const names = Object.keys(manifest.sha256).sort();
    expect(names.length).toBe(31);
    for (const name of names) {
      const bytes = readFileSync(join(ARCHIVE, name));
      expect(bytes.length, name).toBe(manifest.sha256[name]!.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(manifest.sha256[name]!.sha256);
    }
  });
  it('records a before and after hash for every regenerated native and corpus file, and only those', () => {
    const ledger = JSON.parse(readFileSync(join(ARCHIVE, 'ledger.json'), 'utf8')) as {files: Record<string, {archived?: string; before: {bytes: number; sha256: string}; after: {bytes: number; sha256: string}; change: string}>};
    const root = resolve(__dirname, '../../..');
    const changed = Object.entries(ledger.files).filter(([, entry]) => entry.before.sha256 !== entry.after.sha256).map(([path]) => path).sort();
    // Nine compiler outputs gain section 6 (four native island-emitter fixtures, the
    // list-same-source corpus case, the three frozen declared-props server fixtures), plus the
    // declared-props SRI manifest that emit-props-contract.mjs rewrites for them.
    expect(changed).toEqual([
      'crates/forma-ir/tests/fixtures/island-emitter/aggregate-fallback.ir',
      'crates/forma-ir/tests/fixtures/island-emitter/local-aggregates.ir',
      'crates/forma-ir/tests/fixtures/island-emitter/local-inputs.ir',
      'crates/forma-ir/tests/fixtures/island-emitter/rows.ir',
      'crates/forma-ir/tests/fixtures/js-emitter/list-same-source.dump',
      'crates/forma-ir/tests/fixtures/js-emitter/list-same-source.ir',
      'crates/forma-server/tests/fixtures/props-contract/empty-typed.ir',
      'crates/forma-server/tests/fixtures/props-contract/empty.ir',
      'crates/forma-server/tests/fixtures/props-contract/home.ir',
      'crates/forma-server/tests/fixtures/props-contract/manifest.json',
    ]);
    for (const [path, entry] of Object.entries(ledger.files)) {
      const live = readFileSync(join(root, path));
      expect(createHash('sha256').update(live).digest('hex'), path).toBe(entry.after.sha256);
      const archivedPath = entry.archived ?? path.replace('crates/forma-ir/tests/fixtures/', '');
      expect(manifest.sha256[archivedPath]!.sha256, path).toBe(entry.before.sha256);
      expect(manifest.sha256[archivedPath]!.bytes, path).toBe(entry.before.bytes);
    }
  });
});
