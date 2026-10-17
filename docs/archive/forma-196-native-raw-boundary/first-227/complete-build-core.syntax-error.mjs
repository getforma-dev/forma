import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const out=dirname(fileURLToPath(import.meta.url)),repo='/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma';
const json=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const provenance=JSON.parse(readFileSync(join(out,'provenance.json')));
if(provenance.head!=='227115703ba4fc6919ee89acfbeeb124a5de44bc'||!provenance.hashes.every(x=>hash(join(repo,x.path))===x.sha256))throw Error('original artifacts differ');
const {build}=await import(pathToFileURL(join(repo,'packages/build/dist/index.js')));
const results=[];
for(const prior of JSON.parse(readFileSync(join(out,'results.json')))){
 const dir=join(out,'cases',prior.id),row={id:prior.id,sourceHashes:['app.ts','page.ts'].map(p=>({path:p,sha256:hash(join(dir,'src',p))}))};
 const logs=[],orig={log:console.log,warn:console.warn,error:console.error};
 for(const key of Object.keys(orig))console[key]=(...args)=>logs.push({level:key,text:args.map(String).join(' ')});
 try{
  const config={app:'raw-boundary-probe',outputDir:join(dir,'build-with-app'),ssr:true,codeSplitting:false,entryPoints:[{entry:join(dir,'src/app.ts'),outfile:'home.js'}],routes:{'/':{js:['home'],css:[]}};
  json(join(dir,'corrected-build-config.json'),config);
  const built=await build(config);row.build={accepted:true,manifest:built.manifest,diagnostics:built.diagnostics};
  const request=JSON.parse(readFileSync(join(dir,'native-request.json')));
  request.modules[0].manifest=built.manifest;
  request.modules[0].files=Object.fromEntries(Object.keys(built.manifest.assets).map(p=>[p,join(dir,'build-with-app',p)]));
  json(join(dir,'build-native-request.json'),request);
  const r=spawnSync(join(repo,'target/debug/examples/parity_render'),['typed'],{input:JSON.stringify(request),encoding:'utf8',timeout:25_000,maxBuffer:8*1024*1024});
  row.native={status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message};
 }catch(error){row.build={accepted:false,error:error.stack??String(error)};}
 finally{Object.assign(console,orig);json(join(dir,'build-with-app-log.json'),logs);}
 results.push(row);json(join(out,'build-corrected-results.json'),results);console.log(prior.id,row.build.accepted,row.build.error?.split('\n')[0]??'');
}
const {Window}=await import(pathToFileURL(join(repo,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
const keys=Object.getOwnPropertyNames(window).filter(k=>/^(HTML|SVG|Node|Element|Document|Text$|Comment$|MutationObserver$|CustomEvent$)/.test(k));
for(const key of keys)globalThis[key]=window[key];globalThis.window=window;globalThis.document=window.document;
const core=await import(pathToFileURL(join(repo,'packages/core/dist/index.js'))),payload='<p data-probe="raw">nested markup</p>';
const cases=[['srcdoc-static',()=>core.h('iframe',{srcdoc:payload})],['srcdoc-mixed-case',()=>core.h('iframe',{SrCdOc:payload})],['script-html',()=>core.h('script',null,'x')],['script-html-case',()=>core.h('SCRIPT',null,'x')],['script-svg',()=>core.svg(()=>core.h('script',null,'x'))],['safe-iframe',()=>core.h('iframe',{title:'safe',src:'/frame'})],['literal-style',()=>core.h('style',null,'p{color:navy}')],['srcdoc-null',()=>core.h('iframe',{srcdoc:null})],['srcdoc-false',()=>core.h('iframe',{srcdoc:false})],['typed-srcdoc',()=>core.h('iframe',{srcdoc:core.trustedHtml(payload)})]];
const guards=[];for(const[id,operation]of cases){try{const element=operation();guards.push({id,accepted:true,html:element.outerHTML});}catch(error){guards.push({id,accepted:false,error:error.stack??String(error)});}}
json(join(out,'core-corrected-guards.json'),{globals:keys,cases:guards});window.happyDOM.cancelAsync();
json(join(out,'corrected-setup-provenance.json'),{source:provenance.head,node:process.version,scriptHash:hash(fileURLToPath(import.meta.url)),finished:new Date().toISOString(),sameArtifacts:provenance.hashes.every(x=>hash(join(repo,x.path))===x.sha256),changes:'Only build config app and complete DOM globals; prior outputs preserved; same cases/source/products. No new compiler/native rerun except actual build products.'});
