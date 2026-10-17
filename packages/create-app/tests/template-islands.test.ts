import { afterEach, describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { collectDiagnostics, formaSsrPlugin, generateRealIr, getSsrEntryProducts } from '../../compiler/src/index';
import { getSlots } from '../../compiler/tests/helpers/fmir';
import { mkTmpDir, rmrf, runCli } from './helpers';

const roots: string[] = [];
// These bundled entry bodies have no exports. Run their awaited observation
// runtime to completion; actual native ESM loading is covered by packed P17.
async function observeEntry(code: string, state: object): Promise<void> {
  await runInNewContext(`(async () => {\n${code}\n})()`, { globalThis: state });
}
afterEach(() => roots.splice(0).forEach(rmrf));
function scaffold() {
  const root = mkTmpDir('forma-template-islands-'); roots.push(root);
  const result = runCli(['island-page', '--template', 'minimal'], root);
  expect(result.status, result.stderr).toBe(0);
  return join(root, 'island-page/admin');
}
const runtime: Plugin = { name: 'template-runtime-observation', setup(b) {
  b.onResolve({ filter: /^@getforma\/core$/ }, () => ({ path: 'core', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
    export function h(tag, props, ...children) { return typeof tag === 'function' ? tag(props) : {tag, props, children}; }
    export const Fragment = 'fragment';
    export function mount(component) { globalThis.mounts++; if (!globalThis.registry) globalThis.mountedBeforeReady = true; globalThis.page = component(); }
    export function createSignal(value) { globalThis.seeds.push(value); return [() => value, next => value = next]; }
    export function __adoptionSignal(_site, tuple) { return tuple; }
    export function activateIslands(registry) { return Promise.resolve().then(() => { globalThis.registry = registry; }); }
    export function __islandRegistration(component, metadata) { const call = props => component(props); call.metadata = metadata; return call; }
  ` }));
} };

// The observation runtime verifies the actual transformed source contract. Real
// DOM adoption, headers and zero-network acceptance use packed consumers later.
// Each case launches and stages the CLI; Windows observed 7.977s against the
// former 5s default. Keep a finite process-backed budget, with all oracles intact.
describe('minimal declared island source', () => {
  it('scaffolds a declared Counter and a separate truly static native page', () => {
    const admin = scaffold();
    const home = collectDiagnostics(() => generateRealIr(join(admin, 'src/home/app.tsx')));
    expect(home.diagnostics).toEqual([]); expect(home.result).not.toBeNull();
    expect(home.result!.islands.map(island => island.name)).toEqual(['Counter']);
    expect(getSlots(home.result!.binary).filter(slot => slot.source === 0).map(slot => [slot.name, slot.typeHint])).toEqual([['count', 3]]);
    const about = collectDiagnostics(() => generateRealIr(join(admin, 'src/about/app.tsx')));
    expect(about.diagnostics).toEqual([]); expect(about.result).not.toBeNull();
    expect(about.result!.islands).toEqual([]); expect(getSlots(about.result!.binary)).toEqual([]);
    expect(Buffer.from(about.result!.binary).toString()).toContain('About this app');
  }, 60_000);

  it('pairs actual Counter metadata with its native module and never mounts the native page in JavaScript', async () => {
    const admin = scaffold(), entry = join(admin, 'src/home/app.tsx'), outDir = join(admin, 'dist');
    const native = generateRealIr(entry)!;
    const result = await build({ entryPoints: [entry], outdir: outDir, write: false, bundle: true, format: 'esm',
      jsxFactory: 'h', jsxFragment: 'Fragment', plugins: [runtime, formaSsrPlugin({ page: 'home', outDir, entryPoint: entry })] });
    expect(result.outputFiles!.find(file => file.path.endsWith('.ir'))!.contents).toEqual(native.binary);
    const state: any = { mounts: 0, seeds: [] }; await observeEntry(result.outputFiles!.find(file => file.path.endsWith('.js'))!.text, state);
    expect(state.mounts).toBe(0); expect(state.seeds).toEqual([]); expect(Object.keys(state.registry)).toEqual(['Counter']);
    const contract = native.islands[0]!.contract!;
    expect(state.registry.Counter.metadata).toEqual({ h: contract.digest, schema: contract.schema, mode: 0 });
    state.registry.Counter({ count: 7 }); expect(state.seeds).toEqual([7]);
    expect(getSsrEntryProducts(result)[0]).toMatchObject({ page: 'home', browserRequired: true, islands: [{ name: 'Counter', mode: 'ssr' }] });
  }, 60_000);

  it('classifies the actual About source as static and removes its native selector', async () => {
    const admin = scaffold(), entry = join(admin, 'src/about/app.tsx'), outDir = join(admin, 'dist');
    const result = await build({ entryPoints: [entry], outdir: outDir, write: false, bundle: true, format: 'esm',
      jsxFactory: 'h', plugins: [runtime, formaSsrPlugin({ page: 'about', outDir, entryPoint: entry })] });
    expect(getSsrEntryProducts(result)[0]).toMatchObject({ page: 'about', browserRequired: false, islands: [] });
    expect(result.outputFiles!.find(file => file.path.endsWith('.ir'))!.contents).toEqual(generateRealIr(entry)!.binary);
    const state: any = { mounts: 0, seeds: [] }; await observeEntry(result.outputFiles!.find(file => file.path.endsWith('.js'))!.text, state);
    expect(state.mounts).toBe(0); expect(state.seeds).toEqual([]); expect(state.registry).toBeUndefined();
  }, 60_000);

  it('retains ordinary explicit Browser mounting with its separate zero default', async () => {
    const admin = scaffold(), entry = join(admin, 'src/home/app.tsx');
    const result = await build({ entryPoints: [entry], write: false, bundle: true, format: 'esm', jsxFactory: 'h', jsxFragment: 'Fragment', plugins: [runtime] });
    const state: any = { mounts: 0, seeds: [] }; await observeEntry(result.outputFiles![0]!.text, state);
    expect(state.mounts).toBe(1); expect(state.seeds).toEqual([0]); expect(state.page.tag).toBe('main');
    expect(state.mountedBeforeReady).toBeUndefined(); expect(Object.keys(state.registry)).toEqual(['Counter']);
  }, 60_000);
});
