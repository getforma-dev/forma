/** The archived pre-value-rules sources (docs/archive/2026-10-15-pre-value-rules) stay
 *  executable refusal evidence: each form FORMA-182's rules 6 and 7 migrated now refuses with
 *  its code. */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {generateRealIr} from '../src/esbuild-ssr-plugin';

const ARCHIVE = resolve(__dirname, '../../../docs/archive/2026-10-15-pre-value-rules');
const manifest = JSON.parse(readFileSync(join(ARCHIVE, 'manifest.json'), 'utf8')) as {sha256: Record<string, {bytes: number; sha256: string}>};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}); vi.restoreAllMocks(); });
function scratch(): string { const dir = mkdtempSync(join(tmpdir(), 'forma-value-rules-archive-')); dirs.push(dir); return dir; }
function archived(name: string): string {
  const bytes = readFileSync(join(ARCHIVE, 'sources', name));
  expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(manifest.sha256[`sources/${name}`]!.sha256);
  return bytes.toString('utf8');
}

describe('archived pre-value-rules sources', () => {
  it('the declared page ending with a bare boolean prop child refuses with BUILD-614 at that child', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'app.ts'), archived('declared-page.app.ts'));
    writeFileSync(join(dir, 'page.ts'), archived('props-bindings-declared-boolean-child.page.ts'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => generateRealIr(join(dir, 'app.ts'))).toThrow(/^BUILD-614 .*page\.ts:2:\d+: declared boolean ok is a boolean in text/);
  });
  it('the inline-mount entry reading a boolean signal as text refuses with BUILD-614 at that read', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'app.ts'), archived('ssr-emission-inline-mount-boolean-child.app.ts'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => generateRealIr(join(dir, 'app.ts'))).toThrow(/^BUILD-614 .*app\.ts:6:\d+: signal open\(\) is a boolean in text/);
  });
  it('keeps every archived original byte-exact under its manifest', () => {
    const names = Object.keys(manifest.sha256).sort();
    expect(names.length).toBe(3);
    for (const name of names) {
      const bytes = readFileSync(join(ARCHIVE, name));
      expect(bytes.length, name).toBe(manifest.sha256[name]!.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(manifest.sha256[name]!.sha256);
    }
  });
});
