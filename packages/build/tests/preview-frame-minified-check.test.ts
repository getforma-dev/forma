/**
 * The check on the minified bytes (FORMA-190). A production build writes the
 * preview frame's runtime as an esbuild transform of core's file, and
 * forma-server refuses what it cannot inline (FRAME-103) whoever wrote it, so
 * the build checks the bytes it is about to write as it checks core's file.
 * esbuild escapes `</script` and `<!--` in its output, so with the real
 * transform nothing reaches this check; this file replaces the transform with
 * one that returns what a minifier must never return, to show the build stops
 * there, with its code, before anything is written.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('esbuild', async (importOriginal) => ({
  ...(await importOriginal<typeof import('esbuild')>()),
  transform: async () => ({ code: 'window.__formaFrame = "</SCRIPT>";\n', map: '', warnings: [], mangleCache: undefined, legalComments: undefined }),
}));

const { build } = await import('./helpers/named-build');

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('previewFrame: the minified runtime is checked for what forma-server refuses (FORMA-190)', () => {
  it('BUILD-806: bytes the build would write that hold </script fail the build, before anything is written', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forma-frame-minified-'));
    temporary.push(root);
    const core = join(root, 'node_modules', '@getforma', 'core');
    mkdirSync(join(core, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"application","private":true}');
    writeFileSync(join(core, 'package.json'), JSON.stringify({ name: '@getforma/core', version: '2.1.0', type: 'module', exports: { '.': './dist/index.js' } }));
    writeFileSync(join(core, 'dist', 'index.js'), 'export const coreId = "CORE";\n');
    writeFileSync(join(core, 'dist', 'formajs-frame.global.js'), 'window.__formaFrame = "fine";\n');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), "import { coreId } from '@getforma/core';\nexport const page = coreId;\n");

    const dist = join(root, 'dist');
    const error = await build({
      entryPoints: [{ entry: join(root, 'src', 'app.ts'), outfile: 'app.js' }],
      routes: { '/': { js: ['app'], css: [] } },
      outputDir: dist,
      previewFrame: true,
    }).then(() => undefined, (e: unknown) => e as Error & { diagnostics?: Array<{ code: string }> });
    expect(error?.message).toMatch(/^@getforma\/build: BUILD-806 /);
    expect(error?.message).toContain('the minified copy of @getforma/core 2.1.0');
    expect(error?.message).toContain('the fault is the minifier');
    expect(error?.diagnostics?.[0]).toMatchObject({ file: '', line: 0, column: 0 });
    expect(error?.message).toContain('contains "</script"');
    expect(error?.diagnostics?.map((d) => d.code)).toEqual(['BUILD-806']);
    expect(existsSync(dist)).toBe(false);
  });
});
