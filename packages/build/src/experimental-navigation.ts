/** FORMA-301 feasibility builder. Source-only and deliberately not exported by
 * @getforma/build. This proves a checked registration group; it is not the
 * supported build configuration or a release qualification shortcut. */
import * as esbuild from 'esbuild';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { formaSsrPlugin, getSsrEntryProducts, COMPILER_WRITER_VERSION } from '@getforma/compiler';
import { computeIdentity, identityBanner } from './identity.js';
import { BUILD_WRITER_VERSION, requireCompatibleCompiler } from './compatibility.js';
import { entryProducts } from './entry-products.js';
import { generateManifest } from './manifest.js';
import { duplicateCoreDiagnostic } from './core-instances.js';
import { createStagingDirectory, replaceDirectory } from './output.js';
import type { AssetManifest, BuildConfig } from './types.js';

export interface ExperimentalNavigationGroup {
  app: string;
  group: string;
  routes: readonly { path: string; page: string; entry: string }[];
  client: string;
  coreEntry: string;
  outputDir: string;
}

export async function buildExperimentalNavigationGroup(input: ExperimentalNavigationGroup): Promise<AssetManifest> {
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.app)||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.group))throw new Error('BUILD-611 invalid experimental navigation app/group');
  if(input.routes.length<2||input.routes.length>32)throw new Error('BUILD-611 proof navigation group needs 2 to 32 declared native routes');
  if(new Set(input.routes.map(r=>r.path)).size!==input.routes.length||new Set(input.routes.map(r=>r.page)).size!==input.routes.length)throw new Error('BUILD-611 duplicate navigation route or owner');
  for(const route of input.routes)if(!route.path.startsWith('/')||route.path.startsWith('//')||/[?#]/.test(route.path)||!/^[a-z][a-z0-9-]*$/.test(route.page))throw new Error('BUILD-611 invalid proof route/owner');
  requireCompatibleCompiler(COMPILER_WRITER_VERSION);
  const outputDir=resolve(input.outputDir),stage=createStagingDirectory(outputDir);
  const config:BuildConfig={app:input.app,ssr:true,outputDir:stage,
    entryPoints:input.routes.map(r=>({entry:resolve(r.entry),outfile:`${r.page}.js`})),
    routes:Object.fromEntries(input.routes.map(r=>[r.path,{js:[r.page],css:[]}]))};
  const bootstrap='proof-group.js';
  const source=input.routes.map((r,i)=>`import { __formaNavigationRegistry as r${i} } from ${JSON.stringify(resolve(r.entry))};`).join('\n')+
    `\nimport { startProof } from ${JSON.stringify(resolve(input.client))};\n`+
    `const registrations = Object.freeze(Object.assign(Object.create(null), ${input.routes.map((_,i)=>`r${i}`).join(', ')}));\n`+
    `startProof({ registrations, app: ${JSON.stringify(input.app)}, group: ${JSON.stringify(input.group)}, build: __FORMA_BUILD__ });\n`;
  const compile=async(identity?:string)=> {
    const result=await esbuild.build({stdin:{contents:source,resolveDir:dirname(resolve(input.client)),sourcefile:'forma-router-proof-group.ts',loader:'ts'},
      outfile:join(stage,bootstrap),bundle:true,splitting:false,format:'esm',platform:'browser',target:'es2022',
      write:false,metafile:true,minify:true,jsx:'transform',jsxFactory:'h',jsxFragment:'Fragment',
      alias:{'@getforma/core':resolve(input.coreEntry)},
      define:{__FORMA_BUILD__:JSON.stringify(identity??'dev'),'process.env.NODE_ENV':'"production"'},
      ...(identity?{banner:{js:identityBanner(identity)}}:{}),
      plugins:input.routes.map(r=>formaSsrPlugin({page:r.page,outDir:stage,entryPoint:resolve(r.entry),experimentalRegistrationOnly:true})),
    });
    if(!result.metafile||!result.outputFiles)throw new Error('BUILD-611 missing experimental output graph');
    const js=result.outputFiles.filter(f=>f.path.endsWith('.js'));
    if(js.length!==1||Object.values(result.metafile.outputs).some(o=>o.imports.length>0))throw new Error('BUILD-611 navigation group must be one fully bundled executable artifact');
    const duplicate=duplicateCoreDiagnostic([result.metafile]);if(duplicate)throw new Error(`${duplicate.code}: ${duplicate.message}`);
    const products=entryProducts(config,config.entryPoints,result,getSsrEntryProducts);
    const names=new Set<string>();
    for(const product of products.values()) {
      if(product.mode!=='ssr'||!product.browserRequired)throw new Error('BUILD-611 proof group requires actual native island products');
      for(const island of product.islands) {
        if(island.mode!=='ssr')throw new Error('BUILD-611 navigation proof does not qualify browserOnly replacement islands');
        if(names.has(island.name))throw new Error(`BUILD-611 proof group has duplicate island registration ${island.name}; shared declaration deduplication is not yet qualified`);
        names.add(island.name);
      }
    }
    return {result,products};
  };
  try {
    const first=await compile();
    const build=computeIdentity({writers:[{name:'@getforma/build',version:BUILD_WRITER_VERSION},{name:'@getforma/compiler',version:COMPILER_WRITER_VERSION}],
      files:first.result.outputFiles!.map(f=>({name:basename(f.path),bytes:f.contents}))});
    const final=await compile(build);
    mkdirSync(stage,{recursive:true});
    const assets:Record<string,string>={};
    let bootstrapFile='';
    for(const file of final.result.outputFiles!) {
      const logical=basename(file.path),dot=logical.lastIndexOf('.'),hash=createHash('sha256').update(file.contents).digest('hex').slice(0,12);
      const hashed=`${logical.slice(0,dot)}.${hash}${logical.slice(dot)}`;
      writeFileSync(join(stage,hashed),file.contents);assets[logical]=hashed;
      if(logical===bootstrap) {
        bootstrapFile=hashed;
        writeFileSync(join(stage,`${hashed}.gz`),gzipSync(file.contents,{level:9}));
        writeFileSync(join(stage,`${hashed}.br`),brotliCompressSync(file.contents));
      }
    }
    for(const route of input.routes)assets[`${route.page}.js`]=bootstrapFile;
    const {manifest}=generateManifest(config,assets,{},new Set(Object.values(assets)),final.products,build);
    writeFileSync(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    // Outside the runtime manifest: provenance and an explicit experimental
    // scope receipt, never a second source of contract/hash authority.
    writeFileSync(join(stage,'experimental-navigation.json'),JSON.stringify({version:1,status:'feasibility-only',group:input.group,app:input.app,build,
      routes:input.routes.map(r=>({path:r.path,page:r.page})),bootstrap:bootstrapFile,codeSplitting:false,
      products:getSsrEntryProducts(final.result),metafile:final.result.metafile},null,2)+'\n');
    replaceDirectory(stage,outputDir);
    return manifest;
  } catch(error) {rmSync(stage,{recursive:true,force:true});throw error;}
}
