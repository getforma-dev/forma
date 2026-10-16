import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watching } from './helpers/watch';
import type { BuildConfig } from '../src/types';

// Keep the real build/compiler/esbuild pipeline. The wrapper only makes the
// normally brief gap before the third initial context deterministic.
vi.mock('./helpers/runner', async () => {
  const { build } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { writeFileSync } = await import('node:fs');
  return { bundleBuildRunner: async (outfile: string) => {
    const esbuildUrl = pathToFileURL(createRequire(import.meta.url).resolve('esbuild')).href;
    const wrapper = outfile + '.esbuild.mjs';
    writeFileSync(wrapper, `
      import * as actual from ${JSON.stringify(esbuildUrl)};
      export * from ${JSON.stringify(esbuildUrl)};
      import {existsSync,writeFileSync} from 'node:fs';
      import {join} from 'node:path';
      export async function context(options) {
        if (options.entryPoints.length === 1 && options.entryPoints[0].out === 'third') {
          writeFileSync(join(options.outdir, '..', 'third-blocked'), 'blocked');
          const until = Date.now() + 10000;
          while (!existsSync(join(options.outdir, '..', 'release-third'))) {
            if (Date.now() > until) throw new Error('third context barrier was not released');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        return actual.context(options);
      }
    `);
    await build({
      entryPoints: [fileURLToPath(new URL('../src/build.ts', import.meta.url))],
      outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
      banner: { js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);" },
      plugins: [{ name: 'watch-readiness-control', setup(builder) {
        builder.onResolve({filter:/^esbuild$/},()=>({path:pathToFileURL(wrapper).href,external:true}));
        builder.onResolve({filter:/^@getforma\/compiler$/},()=>({path:fileURLToPath(new URL('../../compiler/src/index.ts',import.meta.url))}));
      }}],
    });
  }};
});

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, {recursive:true,force:true,maxRetries:10,retryDelay:50})));
const initials = (output: string) => (output.match(/\[watch\] build finished, watching for changes/g) ?? []).length;
for (const codeSplitting of [false, true]) {
  it(`waits for every actual initial watch context before allowing edits (split=${codeSplitting})`, async () => {
    const root=mkdtempSync(join(tmpdir(),'forma-watch-ready-')); roots.push(root);
    const src=join(root,'src'),dist=join(root,'dist');mkdirSync(src);
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    const names=['first','second','third'];
    for(const name of names)writeFileSync(join(src,name+'.ts'),`globalThis.${name}='before';`);
    const config: BuildConfig={outputDir:dist,ssr:false,codeSplitting,
      entryPoints:names.map(name=>({entry:join(src,name+'.ts'),outfile:name+'.js',ssr:false})),
      routes:Object.fromEntries(names.map(name=>['/'+name,{js:[name],css:[]}]))};
    await watching(config,async watcher=>{
      const ready=watcher.ready();
      if(!codeSplitting){
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await vi.waitFor(()=>{
            expect(readFileSync(join(root,'third-blocked'),'utf8')).toBe('blocked');
            expect(initials(watcher.output())).toBe(2);
          },{timeout:10000});
          const result=await Promise.race([ready.then(()=>'ready'),new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('blocked'),150);})]);
          expect(result,'third real context is still unregistered').toBe('blocked');
        } finally {
          clearTimeout(timer);
          writeFileSync(join(root,'release-third'),'release');
        }
      }
      await ready;
      expect(initials(watcher.output())).toBe(codeSplitting?1:3);
      await vi.waitFor(()=>expect(watcher.manifest().routes['/first'].js).toHaveLength(1));
      await watcher.change(()=>writeFileSync(join(src,'first.ts'),"globalThis.first='after';"));
      await vi.waitFor(()=>{
        const file=watcher.manifest().routes['/first'].js[0];
        expect(readFileSync(join(dist,file),'utf8')).toContain('"after"');
      },{timeout:10000});
    });
  },20000);
}
