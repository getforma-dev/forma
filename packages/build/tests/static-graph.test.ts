import { afterEach, expect, it } from 'vitest';
import type { Metafile } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitGraph } from '../src/split-graph';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-static-graph-')); roots.push(root);
  const entries = ['static', 'live', 'browser'].map(name => {
    const entry = join(root, `${name}.ts`); writeFileSync(entry, 'export {}');
    return { entry, outfile: `${name}.js` };
  });
  const out = join(root, 'dist');
  const output = (file: string, imports: [string, string][] = [], entryPoint?: string) => [join(out, file), {
    bytes: 10, inputs: {}, exports: [], ...(entryPoint ? { entryPoint } : {}),
    imports: imports.map(([path, kind]) => ({ path: join(out, path), kind })),
  }];
  const meta = { inputs: {}, outputs: Object.fromEntries([
    output('static.A.js', [['static-only.js', 'import-statement'], ['shared.js', 'import-statement']], entries[0].entry),
    output('live.B.js', [['shared.js', 'import-statement'], ['lazy.js', 'dynamic-import']], entries[1].entry),
    output('browser.C.js', [], entries[2].entry),
    output('static-only.js'), output('shared.js'), output('lazy.js'),
    output('static.A.css', [['font.woff2', 'url-token']]), output('font.woff2'),
  ]) } as Metafile;
  return { entries, out, meta };
}
it('keeps the active static/dynamic JS closure and every CSS-only resource while dropping static-exclusive JS', () => {
  const { entries, out, meta } = fixture();
  const graph = splitGraph(meta, entries, out, new Set(['live.js', 'browser.js']));
  expect([...graph.files].sort()).toEqual(['browser.C.js', 'font.woff2', 'lazy.js', 'live.B.js', 'shared.js', 'static.A.css']);
  expect(graph.assets['static.js']).toBeUndefined();
  expect(graph.assets['live.js']).toBe('live.B.js');
  expect(graph.staticDependencies['live.B.js']).toEqual(['shared.js']);
  expect(graph.staticDependencies['static.A.js']).toBeUndefined();
});
it('a wholly static graph retains CSS/font output and no JS candidate', () => {
  const { entries, out, meta } = fixture();
  const graph = splitGraph(meta, entries, out, new Set());
  expect([...graph.files].sort()).toEqual(['font.woff2', 'static.A.css']);
});
it('still requires every configured entry output before classifying it as removed', () => {
  const { entries, out, meta } = fixture();
  delete meta.outputs[join(out, 'static.A.js')];
  expect(() => splitGraph(meta, entries, out, new Set(['live.js', 'browser.js']))).toThrow('missing entry static.js');
});
