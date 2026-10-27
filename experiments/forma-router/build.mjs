// Run after npm run build -w packages/compiler. This consumes compiler products
// and the source-only experimental builder; it never edits generated metadata.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const temp=resolve(here,'.builder');
await mkdir(temp,{recursive:true});
try {
  const module=resolve(temp,'experimental-navigation.mjs');
  await build({entryPoints:[resolve(root,'packages/build/src/experimental-navigation.ts')],outfile:module,bundle:true,platform:'node',format:'esm',packages:'external',target:'node22'});
  const {buildExperimentalNavigationGroup}=await import(module);
  const manifest=await buildExperimentalNavigationGroup({app:'forma-router-proof',group:'proof',
    routes:[{path:'/proof/a',page:'proof-a',entry:resolve(here,'admin/a.tsx')},{path:'/proof/b',page:'proof-b',entry:resolve(here,'admin/b.tsx')}],
    client:resolve(here,'client.ts'),coreEntry:resolve(root,'packages/core/src/index.ts'),outputDir:resolve(here,'dist')});
  console.log(JSON.stringify({app:manifest.app,build:manifest.build,routes:manifest.routes},null,2));
} finally {await rm(temp,{recursive:true,force:true});}
