import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-alias-warning-')); roots.push(root);
  const core = join(root, 'core'); mkdirSync(core);
  writeFileSync(join(core, 'package.json'), JSON.stringify({ name: 'fixture-core', type: 'module', exports: { '.': './index.js', './extra': './extra.js' } }));
  writeFileSync(join(core, 'index.js'), 'export const value=7;');
  writeFileSync(join(core, 'extra.js'), 'export const extra=11;');
  return { root, core, entry: join(root, 'app.ts'), child: join(root, 'child.ts'), outputDir: join(root, 'dist') };
}

it.each([false, true])('warns once with every actual importer across both identity passes (split=%s)', async codeSplitting => {
  const f = fixture();
  writeFileSync(f.entry, "import {value} from 'formajs'; import {child} from './child'; export const result=value+child;");
  writeFileSync(f.child, "import {value} from 'formajs'; import {extra} from 'formajs/extra'; export const child=value+extra;");
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const result = await build({ entryPoints: [{ entry: f.entry, outfile: 'app.js' }, { entry: f.child, outfile: 'child.js' }], routes: {}, outputDir: f.outputDir, formaAlias: f.core, codeSplitting });
  const bridge = result.warnings.filter(line => line.includes('formaAlias is a 3.x migration bridge'));
  expect(bridge).toHaveLength(1);
  expect(bridge[0]).toContain('@getforma/core'); expect(bridge[0]).toContain(f.entry); expect(bridge[0]).toContain(f.child);
  expect(bridge[0]!.split(f.child)).toHaveLength(2);
  expect(warn.mock.calls.filter(args => String(args[0]).includes('formaAlias is a 3.x migration bridge'))).toHaveLength(1);
  expect(result.manifest.aliases['app.js']).toBeTruthy(); expect(result.manifest.aliases['child.js']).toBeTruthy();
});

it('is quiet without actual legacy imports, even if strings/comments name formajs', async () => {
  const f=fixture(); writeFileSync(f.entry, "// import 'formajs'\nexport const value='formajs';");
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const result=await build({ entryPoints:[{entry:f.entry,outfile:'app.js'}],routes:{},outputDir:f.outputDir,formaAlias:f.core });
  expect(result.warnings.some(line=>line.includes('formaAlias'))).toBe(false);
  expect(warn.mock.calls.some(args=>String(args[0]).includes('formaAlias'))).toBe(false);
});

it('does not make a missing bare package resolve when the alias is absent', async () => {
  const f=fixture(); writeFileSync(f.entry,"import {value} from 'formajs'; export const result=value;");
  await expect(build({entryPoints:[{entry:f.entry,outfile:'app.js'}],routes:{},outputDir:f.outputDir})).rejects.toThrow(/Could not resolve "formajs"/);
});

it('names erased TypeScript imports and re-exports as migration work too', async () => {
  const f=fixture();
  writeFileSync(f.entry,"import type {Value} from 'formajs'; export type {Other} from 'formajs/extra'; export type Local = import('formajs').Value; export const value=1;");
  const result=await build({entryPoints:[{entry:f.entry,outfile:'app.js'}],routes:{},outputDir:f.outputDir,formaAlias:f.core});
  expect(result.warnings.filter(line=>line.includes('formaAlias'))).toEqual([expect.stringContaining(f.entry)]);
});
