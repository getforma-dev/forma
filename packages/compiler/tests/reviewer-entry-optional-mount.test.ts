import { afterEach, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { formaSsrPlugin } from '../src/esbuild-ssr-plugin';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const stub: Plugin = { name: 'review-core', setup(builder) {
  builder.onResolve({ filter: /^@getforma\/core$/ }, () => ({ path: 'core', namespace: 'review' }));
  builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({ loader: 'js', contents:
    'export const h=(...args)=>args; export const mount=()=>{throw Error("unexpected core mount")}; export const activateIslands=()=>{}; export const __islandRegistration=(f)=>f;' }));
} };
async function compile(extra: string) {
  const root = mkdtempSync(join(tmpdir(), 'forma-review-optional-mount-')); roots.push(root);
  const entry = join(root, 'app.ts');
  writeFileSync(join(root, 'page.ts'), 'import {h} from "@getforma/core"; export function Badge(){return h("b",null,"island")}; export function Page(){return h("main",null,Badge())};');
  writeFileSync(entry, 'import {mount,activateIslands} from "@getforma/core"; import {Page,Badge} from "./page"; activateIslands({Badge}); mount(Page,"#app");\n'+extra);
  return build({ entryPoints: [entry], bundle: true, format: 'iife', write: false, outdir: join(root, 'dist'), logLevel: 'silent',
    plugins: [stub, formaSsrPlugin({ page: 'app', outDir: join(root, 'dist'), entryPoint: entry })] });
}

it.each(['core?.mount(Page,"#other")', 'core?.["mount"](Page,"#other")'])('refuses an additional optional namespace core mount: %s', async expression => {
  await expect(compile('import * as core from "@getforma/core"; '+expression+';')).rejects.toThrow('BUILD-611');
});

it('preserves an unrelated optional user mount beside the retired core mount', async () => {
  const result = await compile('const user={mount(){globalThis.calls++}}; user?.mount();');
  const state = { calls: 0 };
  runInNewContext(result.outputFiles!.find(file => file.path.endsWith('.js'))!.text, { globalThis: state });
  expect(state.calls).toBe(1);
});
