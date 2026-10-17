/** A real context/rebuild drives the watch publisher, with one injected final
 * manifest failure. Manual rebuilds make the acceptance boundary deterministic. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const control = vi.hoisted(() => ({
  contexts: [] as import('esbuild').BuildContext[],
  failManifest: false,
}));
vi.mock('esbuild', async importOriginal => {
  const actual = await importOriginal<typeof import('esbuild')>();
  return { ...actual, context: async (options: import('esbuild').BuildOptions) => {
    const context = await actual.context(options); control.contexts.push(context);
    return { ...context, watch: async () => { await context.rebuild(); } };
  } };
});
vi.mock('../src/output', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/output')>();
  return { ...actual, publishOutputFiles: (files: readonly import('../src/output').OutputWrite[], complete?: () => readonly import('../src/output').OutputWrite[]) =>
    actual.publishOutputFiles(files, () => {
      const writes = complete?.() ?? [];
      if (control.failManifest && writes.some(file => file.path.endsWith('manifest.json'))) {
        control.failManifest = false;
        throw new Error('fixed manifest publication failure');
      }
      return writes;
    }),
  };
});
import { build } from './helpers/named-build';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(control.contexts.splice(0).map(context => context.dispose()));
  control.failManifest = false; vi.restoreAllMocks();
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
const component = `import {h} from '@getforma/core';export function Badge(p:{label:string}){return h('b',null,p.label);}`;
for (const codeSplitting of [false, true]) it(`rolls back candidate files and classification when final manifest publication fails (split=${codeSplitting})`, async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = mkdtempSync(join(tmpdir(), 'forma-static-rollback-')); roots.push(root);
  const core = join(root, 'node_modules/@getforma/core'); mkdirSync(core, { recursive: true });
  writeFileSync(join(core, 'package.json'), '{"name":"@getforma/core","version":"3.0.0-dev","type":"module","exports":"./index.js"}');
  writeFileSync(join(core, 'index.js'), 'export const h=(...x)=>x;export const mount=f=>f();export const activateIslands=x=>x;export const __islandRegistration=(f,m)=>f;');
  const page = join(root, 'page.ts');
  writeFileSync(page, component+`export function Page(){return h('main',null,Badge({label:'before'}));}`);
  const entry = join(root, 'app.ts');
  writeFileSync(entry, `import {mount,activateIslands} from '@getforma/core';import {Page,Badge} from './page';activateIslands({Badge});mount(()=>Page(),'#app');`);
  const outputDir = join(root, 'dist');
  await build({ entryPoints: [{ entry, outfile: 'app.js' }], routes: { '/': { js: ['app'], css: [] } }, outputDir, ssr: true, watch: true, codeSplitting });
  const snapshot = () => new Map(readdirSync(outputDir).map(file => [file, readFileSync(join(outputDir, file))]));
  const accepted = snapshot();
  expect(JSON.parse(accepted.get('manifest.json')!.toString()).routes['/'].js).toHaveLength(1);
  control.failManifest = true;
  writeFileSync(page, component+`export function Page(){return h('main',null,'after-static');}`);
  await control.contexts[0].rebuild();
  expect(error.mock.calls.flat().join(' ')).toContain('fixed manifest publication failure');
  expect(snapshot()).toEqual(accepted);
  // The same successful candidate can be retried after the failed publication.
  // A prematurely committed static map would lose the old island generation.
  await control.contexts[0].rebuild();
  const final = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
  expect(final.routes['/']).toMatchObject({ mode: 'ssr', js: [] });
  expect(final.routes['/'].ir).toBeDefined(); expect(final.routes['/'].modulepreload).toBeUndefined();
  for (const [file, bytes] of accepted) if (file !== 'manifest.json') expect(readFileSync(join(outputDir, file))).toEqual(bytes);
});
