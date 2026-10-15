import { afterEach, describe, expect, it } from 'vitest';
import { build, context, type BuildResult, type Plugin } from 'esbuild';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { formaSsrPlugin } from '../src/esbuild-ssr-plugin';
import { getSsrEntryProducts } from '../src/ssr-product';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const core: Plugin = { name: 'test-core', setup(b) {
  b.onResolve({ filter: /^@getforma\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
  b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export function h(){}; export function mount(){}; export function activateIslands(){}; export function createShow(){}; export function __islandRegistration(x){return x}', loader: 'js' }));
} };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-product-'))); roots.push(root);
  const entry = join(root, 'app.ts'), outdir = join(root, 'dist');
  writeFileSync(entry, 'import {h,mount} from "@getforma/core"; function Page(){return h("main",null,"static")}; mount(Page,"#app");');
  return { root, entry, outdir };
}
const options = (f: ReturnType<typeof fixture>, plugins: Plugin[] = []) => ({
  entryPoints: [f.entry], outdir: f.outdir, bundle: true, write: false, logLevel: 'silent' as const,
  plugins: [core, formaSsrPlugin({ page: 'app', outDir: f.outdir, entryPoint: f.entry }), ...plugins],
});

describe('exact-result SSR product transport', () => {
  it('reads the exact final result and terminal publisher object; freezes nested metadata', async () => {
    const f = fixture(); let observed: BuildResult | undefined;
    const result = await build(options(f, [{ name: 'terminal-publisher', setup(b) { b.onEnd(r => { observed = r; }); } }]));
    expect(result).toBe(observed);
    const products = getSsrEntryProducts(result), record = products[0]!;
    expect(record).toEqual({ page: 'app', mode: 'ssr', sourceEntry: f.entry, browserEntry: f.entry,
      irFile: join(f.outdir, 'app.ir'), irHash: createHash('sha256').update(result.outputFiles!.find(f => f.path.endsWith('.ir'))!.contents).digest('hex'),
      browserRequired: false, islands: [] });
    expect(Object.isFrozen(products)).toBe(true); expect(Object.isFrozen(record)).toBe(true); expect(Object.isFrozen(record.islands)).toBe(true);
    expect(getSsrEntryProducts(result)[0]).toBe(record);
    expect(getSsrEntryProducts({ errors: [], warnings: [] })).toEqual([]);
  });

  it('rejects metadata after a later onEnd error and preserves the last accepted rebuild record', async () => {
    const f = fixture(); let reject = false, observed: BuildResult | undefined;
    const ctx = await context(options(f, [{ name: 'later-validator', setup(b) {
      b.onEnd(r => { observed = r; return reject ? { errors: [{ text: 'later refusal' }] } : {}; });
    } }]));
    try {
      const first = await ctx.rebuild(), accepted = getSsrEntryProducts(first)[0]!;
      reject = true; await expect(ctx.rebuild()).rejects.toThrow('later refusal');
      expect(() => getSsrEntryProducts(observed!)).toThrow('failed esbuild result');
      expect(getSsrEntryProducts(first)[0]).toBe(accepted);
      reject = false; const recovered = await ctx.rebuild();
      expect(getSsrEntryProducts(recovered)[0]).toEqual(accepted);
      expect(getSsrEntryProducts(recovered)[0]).not.toBe(accepted);
    } finally { await ctx.dispose(); }
  });

  it('keeps conditional islands browser-required and isolates accepted records across static/island/refused cycles', async () => {
    const f = fixture();
    const staticSource = 'import {h,mount,activateIslands} from "@getforma/core"; function Unused(p:{label:string}){return h("b",null,p.label)}; function Page(){return h("main",null,"static")}; activateIslands({Unused}); mount(Page,"#app");';
    const islandSource = 'import {h,mount,activateIslands,createShow} from "@getforma/core"; function Badge(p:{label:string}){return h("b",null,p.label)}; function Page(p:{show:boolean}){return h("main",null,createShow(()=>p.show,()=>Badge({label:"shown"})))}; activateIslands({Badge}); mount(Page,"#app");';
    writeFileSync(f.entry, staticSource);
    const ctx = await context(options(f));
    try {
      const initial = getSsrEntryProducts(await ctx.rebuild())[0]!;
      expect(initial.browserRequired).toBe(false); expect(initial.islands).toEqual([]);
      writeFileSync(f.entry, islandSource);
      const island = getSsrEntryProducts(await ctx.rebuild())[0]!;
      expect(island.browserRequired).toBe(true); expect(island.islands).toEqual([{name:'Badge',mode:'ssr'}]);
      expect(Object.isFrozen(island.islands[0])).toBe(true);
      expect(() => { (island.islands[0] as {name:string}).name = 'forged'; }).toThrow();
      writeFileSync(f.entry, islandSource.replace('label:"shown"', 'label:missing()'));
      await expect(ctx.rebuild()).rejects.toThrow('BUILD-610');
      expect(island.islands[0]!.name).toBe('Badge'); expect(initial.browserRequired).toBe(false);
      writeFileSync(f.entry, staticSource);
      const recovered = getSsrEntryProducts(await ctx.rebuild())[0]!;
      expect(recovered).toEqual(initial); expect(recovered).not.toBe(initial);
    } finally { await ctx.dispose(); }
  });

  it('authenticates the exact IR object, path and bytes before metadata consumption', async () => {
    const f = fixture(), result = await build(options(f));
    const ir = result.outputFiles!.find(f => f.path.endsWith('.ir'))!, index = result.outputFiles!.indexOf(ir), bytes = ir.contents.slice();
    ir.contents[0] ^= 1;
    expect(() => getSsrEntryProducts(result)).toThrow('IR identity changed');
    ir.contents = bytes; result.outputFiles![index] = { ...ir };
    expect(() => getSsrEntryProducts(result)).toThrow('IR identity changed');
    result.outputFiles![index] = ir; expect(getSsrEntryProducts(result)).toHaveLength(1);
    result.outputFiles!.push({ ...ir }); expect(() => getSsrEntryProducts(result)).toThrow('IR identity changed');
  });

  it('collects distinct native records once in a split result and rejects missing native compilation', async () => {
    const f = fixture(), other = join(f.root, 'other.ts');
    writeFileSync(other, 'import {h,mount} from "@getforma/core"; function Other(){return h("p",null,"other")}; mount(Other,"#app");');
    const result = await build({ ...options(f), entryPoints: [f.entry, other], splitting: true, format: 'esm',
      plugins: [core, ...[f.entry, other].map((entry, i) => formaSsrPlugin({ page: i ? 'other' : 'app', outDir: f.outdir, entryPoint: entry }))] });
    expect(getSsrEntryProducts(result).map(p => p.page)).toEqual(['app', 'other']);
    writeFileSync(f.entry, 'export const noNativeRoot = true;');
    await expect(build(options(f))).rejects.toThrow('requires a successful native product');
  });
});
