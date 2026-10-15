import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from './helpers/named-build';
import { watching } from './helpers/watch';

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture(source: string, extension = 'ts') {
  const root = mkdtempSync(join(tmpdir(), 'forma-no-server-functions-')); scratch.push(root);
  const entry = join(root, `app.${extension}`), outputDir = join(root, 'dist');
  writeFileSync(entry, source); mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'last-good.txt'), 'previous build');
  return { root, entry, outputDir, config: { entryPoints: [{ entry, outfile: 'app.js' }], outputDir, routes: { '/': { js: ['app'], css: [] } } } };
}
describe.each([false, true])('server functions removed (codeSplitting=%s)', codeSplitting => {
  it.each([
    '"use server"; export const secret = "private";',
    'export async function action() { "use server"; return "private"; }',
    "export const action = async () => { 'use server'; return 'private'; };",
  ])('BUILD-808 rejects a directive before replacing the last good output: %s', async source => {
    const f = fixture(source);
    await expect(build({ ...f.config, codeSplitting, strict: false })).rejects.toThrow(/BUILD-808.*Rust route/s);
    expect(readFileSync(join(f.outputDir, 'last-good.txt'), 'utf8')).toBe('previous build');
  });
  it('BUILD-808 rejects a directive in an imported module', async () => {
    const f = fixture('export { action } from "./action";');
    writeFileSync(join(f.root, 'action.ts'), 'export async function action() { "use server"; return "private"; }');
    await expect(build({ ...f.config, codeSplitting })).rejects.toThrow(/BUILD-808.*Rust route/s);
    expect(readFileSync(join(f.outputDir, 'last-good.txt'), 'utf8')).toBe('previous build');
  });
  it.each([
    ['ts', '// "use server" is removed\nexport const message = "use server";'],
    ['ts', 'export const message = <string>"use server";'],
    ['ts', '// "use server" is removed\nexport const message = <string>"ordinary";'],
    ['cts', 'export const message = "use server" as string;'],
    ['mts', 'export const message = "use server" as string;'],
    ['tsx', 'export const message = <div>use server</div>;'],
    ['jsx', 'export const message = <div>use server</div>;'],
  ])('allows comments, ordinary strings and matching parser syntax in .%s: %s', async (extension, source) => {
    const f = fixture(source, extension);
    const result = await build({ ...f.config, codeSplitting });
    expect(Object.keys(result.manifest).sort()).toEqual(['aliases', 'app', 'assets', 'build', 'routes', 'version', 'writer']);
    expect(readFileSync(join(f.outputDir, result.manifest.aliases['app.js']), 'utf8')).toContain(source.includes('ordinary') ? 'ordinary' : 'use server');
  });
  it('rejects the initial watch build without deleting last good output', async () => {
    const f = fixture('"use server"; export const secret = "private";');
    await expect(build({ ...f.config, codeSplitting, watch: true })).rejects.toThrow(/BUILD-808/);
    expect(readFileSync(join(f.outputDir, 'last-good.txt'), 'utf8')).toBe('previous build');
  });
  it('rejects a watch edit without shipping its server code and recovers on the next edit', async () => {
    const f = fixture('export const label = "public-before";');
    await watching({ ...f.config, codeSplitting }, async ({ manifest, output }) => {
      await vi.waitFor(() => {
        expect(manifest().build).toBe('dev');
        expect(readFileSync(join(f.outputDir, 'app.js'), 'utf8')).toContain('public-before');
      }, { timeout: 10_000 });
      const bundle = join(f.outputDir, 'app.js');
      const before = readFileSync(bundle, 'utf8');
      expect(before).toContain('public-before');
      writeFileSync(f.entry, '"use server"; export const label = "private-after";');
      await vi.waitFor(() => expect(output()).toContain('BUILD-808'), { timeout: 10_000 });
      // esbuild may remove the old output on an error; it must not publish private code.
      if (existsSync(bundle)) expect(readFileSync(bundle, 'utf8')).toBe(before);
      writeFileSync(f.entry, 'export const label = "public-recovered";');
      await vi.waitFor(() => expect(readFileSync(bundle, 'utf8')).toContain('public-recovered'), { timeout: 10_000 });
      expect(readFileSync(bundle, 'utf8')).not.toContain('private-after');
    });
  }, 30_000);
  it('rejects a separate SSR entry and reports the exact source location', async () => {
    const f = fixture('export const label = "browser";');
    const server = join(f.root, 'page.ts');
    writeFileSync(server, 'export function Page() {\n  "use server";\n  return "private";\n}');
    const report = join(f.root, 'diagnostics.json');
    await expect(build({ ...f.config, codeSplitting, ssr: true,
      ssrEntryPoints: { app: server }, diagnosticsJson: report,
    })).rejects.toThrow(/BUILD-808/);
    const json = JSON.parse(readFileSync(report, 'utf8'));
    expect(json.diagnostics).toEqual([expect.objectContaining({
      code: 'BUILD-808', severity: 'error', file: realpathSync(server), line: 2, column: 3,
    })]);
    expect(readFileSync(join(f.outputDir, 'last-good.txt'), 'utf8')).toBe('previous build');
  });

});
