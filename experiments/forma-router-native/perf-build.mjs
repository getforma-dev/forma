// Separate candidate/control artifacts; never replace the fixed size fixture.
import { build } from '../../packages/build/dist/index.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),owners=['shell','a','b'];
for(const document of [false,true]) {
  const result=await build({app:'forma-router-native',ssr:true,
    entryPoints:owners.map(owner=>({entry:resolve(here,`app/${owner}.tsx`),outfile:`${owner}.js`})),
    routes:Object.fromEntries(owners.map(owner=>[owner==='shell'?'/native/_shell':`/native/${owner}`,{js:[owner],css:['fixture'],fonts:[]}])),
    cssEntries:[{input:[resolve(here,'app/fixture.css')],outfile:'fixture.css'}],
    navigationGroups:[{id:'native',owners,client:resolve(here,document?'bench-document-client.ts':'bench-client.ts')}],
    outputDir:resolve(here,document?'dist-perf-document':'dist-perf'),
  });
  console.log(JSON.stringify({control:document,manifest:result.manifest,sizes:result.sizes},null,2));
}
