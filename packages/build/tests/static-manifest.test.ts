import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateManifest } from '../src/manifest';
import type { BuildConfig } from '../src/types';
import type { EntryProducts } from '../src/entry-products';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-static-manifest-')); roots.push(root);
  for (const file of ['home.hash.ir', 'style.hash.css', 'font.woff2', 'extra.hash.js']) writeFileSync(join(root, file), file);
  const config: BuildConfig = { outputDir: root, app: 'static-fixture', ssr: true,
    entryPoints: [{ entry: join(root, 'home.ts'), outfile: 'home.js' }, { entry: join(root, 'extra.ts'), outfile: 'extra.js', ssr: false }],
    routes: { '/': { js: ['home'], css: ['style'] } } };
  const products: EntryProducts = new Map([['home.js', {
    page: 'home', mode: 'ssr', sourceEntry: join(root, 'home.ts'), browserEntry: join(root, 'home.ts'),
    irFile: join(root, 'home.ir'), irHash: 'unused-in-manifest', browserRequired: false, islands: [],
  }]]);
  const assets = { 'home.ir': 'home.hash.ir', 'style.css': 'style.hash.css', 'extra.js': 'extra.hash.js' };
  return { config, products, assets };
}
it('retains configured native ownership and CSS/fonts when its accepted browser entry is absent', () => {
  const { config, products, assets } = fixture();
  const { manifest } = generateManifest(config, assets, {}, new Set(), products);
  expect(manifest.routes['/']).toMatchObject({ mode: 'ssr', ir: 'home.hash.ir', js: [], css: ['style.hash.css'], fonts: ['font.woff2'] });
  expect(manifest.routes['/'].modulepreload).toBeUndefined();
  expect(manifest.aliases['home.js']).toBeUndefined();
  expect(manifest.assets['home.hash.ir'].integrity).toMatch(/^sha384-/);
});
it.each(['extra-script', 'server-inlined'] as const)('refuses a contradictory static %s instead of claiming zero JS', kind => {
  const { config, products, assets } = fixture();
  if (kind === 'extra-script') config.routes['/'].js.push('extra');
  else config.serverInlined = ['home.js'];
  expect(() => generateManifest(config, assets, {}, new Set(), products)).toThrow('BUILD-611');
});
it('does not infer static or Browser mode when native product metadata is missing', () => {
  const { config, assets } = fixture();
  expect(() => generateManifest(config, assets)).toThrow('BUILD-817');
});
it('an entry classified static still needs its actual native output', () => {
  const { config, products, assets } = fixture();
  delete (assets as Record<string, string>)['home.ir'];
  expect(() => generateManifest(config, assets, {}, new Set(), products)).toThrow('compiled module is missing');
});
it('refuses multiple configured SSR owners even when one is the primary route entry', () => {
  const { config, products, assets } = fixture();
  config.entryPoints[1].ssr = true; config.routes['/'].js.push('extra');
  const live = new Map(products);
  live.set('home.js', { ...live.get('home.js')!, browserRequired: true } as any);
  expect(() => generateManifest(config, assets, {}, new Set(), live)).toThrow('native entry outside its primary owner');
});
it('does not run a secondary native-only product as an extra script on a Browser route', () => {
  const { config, products, assets } = fixture();
  config.routes['/'].js = ['extra', 'home'];
  expect(() => generateManifest(config, assets, {}, new Set(), products)).toThrow('BUILD-611');
});
