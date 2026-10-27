// Real public build pipeline; never fabricate or patch the generated manifest/IR.
import { build } from '../../packages/build/dist/index.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const owners = ['shell', 'a', 'b'];
for (const next of [false, true]) {
const result = await build({
  app: 'forma-router-native', ssr: true,
  entryPoints: owners.map(owner => ({ entry: resolve(here, `app/${owner}.tsx`), outfile: `${owner}.js` })),
  routes: Object.fromEntries(owners.map(owner => [owner === 'shell' ? '/native/_shell' : `/native/${owner}`, { js: [owner], css: ['fixture'], fonts: [] }])),
  cssEntries: [{ input: [resolve(here, 'app/fixture.css')], outfile: 'fixture.css' }],
  navigationGroups: [{ id: 'native', owners, client: resolve(here, next ? 'client-next.ts' : 'client.ts') }],
  outputDir: resolve(here, next ? 'dist-next' : 'dist'),
});
console.log(JSON.stringify(result, null, 2));

}
