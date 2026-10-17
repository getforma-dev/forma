import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,symlinkSync,readdirSync,lstatSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const out=dirname(fileURLToPath(import.meta.url));
const repo='/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma';
const expected='227115703ba4fc6919ee89acfbeeb124a5de44bc';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const json=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const run=(bin,args,options={})=>{const r=spawnSync(bin,args,{encoding:'utf8',timeout:25_000,maxBuffer:8*1024*1024,...options});return {status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message};};
const head=run('git',['rev-parse','HEAD'],{cwd:repo}).stdout.trim();
if(head!==expected||run('git',['status','--porcelain'],{cwd:repo}).stdout)throw new Error('source must be exact clean 227');
const paths=['packages/core/dist/index.js','packages/compiler/dist/index.js','packages/build/dist/index.js','packages/build/dist/raw-lint-cli.js','target/debug/examples/parity_render','package-lock.json','Cargo.lock','packages/compiler/src/html-context.ts','packages/compiler/src/ir-walk.ts','packages/compiler/src/island-bindings.ts','packages/core/src/dom/trusted-html.ts','packages/core/src/dom/element.ts','crates/forma-ir/src/walker.rs','crates/forma-server/examples/parity_render.rs','docs/TRUSTED-TYPES.md'];
const provenance={head,node:process.version,started:new Date().toISOString(),hashes:paths.map(path=>({path,sha256:hash(join(repo,path))})),scriptHash:hash(fileURLToPath(import.meta.url)),scope:'finite original compiler/build/native/core/raw-lint boundary reproduction; no browser or performance qualification'};
json(join(out,'provenance.json'),provenance);
const {generateRealIr,collectDiagnostics}=await import(pathToFileURL(join(repo,'packages/compiler/dist/index.js')));
const {build}=await import(pathToFileURL(join(repo,'packages/build/dist/index.js')));
const payload='<p data-probe="raw">nested markup</p>';
const cases=[
 {id:'srcdoc-static',expr:`h('iframe',{srcdoc:${JSON.stringify(payload)}})`},
 {id:'srcdoc-declared',props:'p:{markup:string}',arg:`{markup:${JSON.stringify(payload)}}`,state:{markup:payload},expr:`h('iframe',{srcdoc:p.markup})`},
 {id:'srcdoc-mixed-case',expr:`h('iframe',{'SrCdOc':${JSON.stringify(payload)}})`},
 {id:'script-html',expr:`h('script',null,'globalThis.__FORMA_RAW_PROBE__ = 1')`},
 {id:'script-html-case',expr:`h('SCRIPT',null,'globalThis.__FORMA_RAW_PROBE__ = 1')`},
 {id:'script-svg',expr:`h('svg',null,h('script',null,'globalThis.__FORMA_RAW_PROBE__ = 1'))`},
 {id:'safe-iframe',expr:`h('iframe',{title:'safe',src:'/frame'})`},
 {id:'literal-style',expr:`h('style',null,'p{color:navy}')`},
 {id:'srcdoc-null',expr:`h('iframe',{srcdoc:null})`},
 {id:'srcdoc-false',expr:`h('iframe',{srcdoc:false})`},
 {id:'typed-srcdoc',imports:',trustedHtml',expr:`h('iframe',{srcdoc:trustedHtml(${JSON.stringify(payload)})})`},
];
const native=join(repo,'target/debug/examples/parity_render');
const result=[];
for(const c of cases){
 const dir=join(out,'cases',c.id);mkdirSync(join(dir,'src'),{recursive:true});mkdirSync(join(dir,'node_modules/@getforma'),{recursive:true});
 for(const pkg of ['core','compiler','build'])symlinkSync(join(repo,'packages',pkg),join(dir,'node_modules/@getforma',pkg));
 writeFileSync(join(dir,'package.json'),'{"type":"module"}\n');
 const page=`import {h${c.imports??''}} from '@getforma/core';\nexport function Page(${c.props??''}) {return h('main',null,${c.expr});}\n`;
 writeFileSync(join(dir,'src/page.ts'),page);
 writeFileSync(join(dir,'src/app.ts'),`import {mount} from '@getforma/core'; import {Page} from './page'; mount(()=>Page(${c.arg??''}),'#app');\n`);
 const entry=join(dir,'src/app.ts'), row={id:c.id};
 try{
  const compiled=collectDiagnostics(()=>generateRealIr(entry));
  if(!compiled.result)throw new Error('null compiler product');
  const ir=join(dir,'direct.ir');writeFileSync(ir,compiled.result.binary);
  row.compiler={accepted:true,diagnostics:compiled.diagnostics,sha256:hash(ir)};
  const described=run(native,['describe',ir]);json(join(dir,'native-describe.json'),described);
  const boot=join(dir,'probe.js');writeFileSync(boot,'/* finite native boundary probe */\n');
  const integrity=p=>'sha384-'+createHash('sha384').update(readFileSync(p)).digest('base64');
  const manifest={version:2,writer:'3.0.0',app:'raw-boundary-probe',build:'probe',aliases:{'direct.ir':'direct.ir'},assets:{'direct.ir':{immutable:false,integrity:integrity(ir)},'probe.js':{immutable:false,integrity:integrity(boot)}},routes:{'/':{mode:'ssr',ir:'direct.ir',js:['probe.js'],css:[],fonts:[],modulepreload:[],total_size_br:0,budget_warn_threshold:0}}};
  const request={modules:[{name:c.id,route:'/',manifest,files:{'direct.ir':ir,'probe.js':boot},states:[c.state??{}]}]};
  json(join(dir,'native-request.json'),request);
  row.native=run(native,['typed'],{input:JSON.stringify(request)});json(join(dir,'native-result.json'),row.native);
 }catch(error){row.compiler={accepted:false,error:error.stack??String(error)};}
 const logs=[];const orig={log:console.log,warn:console.warn,error:console.error};
 for(const key of Object.keys(orig))console[key]=(...args)=>logs.push({level:key,text:args.map(String).join(' ')});
 try{const built=await build({outputDir:join(dir,'dist'),ssr:true,codeSplitting:false,entryPoints:[{entry,outfile:'home.js'}],routes:{'/':{js:['home'],css:[]}}});row.build={accepted:true,manifest:built.manifest,diagnostics:built.diagnostics};}
 catch(error){row.build={accepted:false,error:error.stack??String(error)};}
 finally{Object.assign(console,orig);json(join(dir,'build-log.json'),logs);}
 row.rawLint=run(process.execPath,[join(repo,'packages/build/dist/raw-lint-cli.js'),'--json','src'],{cwd:dir});
 json(join(dir,'result.json'),row);result.push(row);json(join(out,'results.json'),result);
 console.log(c.id,JSON.stringify({compiler:row.compiler.accepted,nativeStatus:row.native?.status,build:row.build.accepted,rawLint:row.rawLint.status}));
}
// Actual built core library guard under a DOM model, separate from native/browser acceptance.
const {Window}=await import(pathToFileURL(join(repo,'node_modules/happy-dom/lib/index.js')));
const window=new Window({url:'http://localhost/'});
for(const key of ['window','document','Node','Element','HTMLElement','SVGElement','HTMLIFrameElement','DocumentFragment','Text','Comment','MutationObserver','CustomEvent'])globalThis[key]=key==='window'?window:key==='document'?window.document:window[key];
const core=await import(pathToFileURL(join(repo,'packages/core/dist/index.js')));
const coreCases=[
 ['srcdoc-static',()=>core.h('iframe',{srcdoc:payload})],
 ['srcdoc-mixed-case',()=>core.h('iframe',{SrCdOc:payload})],
 ['script-html',()=>core.h('script',null,'x')],
 ['script-html-case',()=>core.h('SCRIPT',null,'x')],
 ['script-svg',()=>core.svg(()=>core.h('script',null,'x'))],
 ['safe-iframe',()=>core.h('iframe',{title:'safe',src:'/frame'})],
 ['literal-style',()=>core.h('style',null,'p{color:navy}')],
 ['srcdoc-null',()=>core.h('iframe',{srcdoc:null})],
 ['srcdoc-false',()=>core.h('iframe',{srcdoc:false})],
 ['typed-srcdoc',()=>core.h('iframe',{srcdoc:core.trustedHtml(payload)})],
];
const guards=[];
for(const [id,operation]of coreCases){try{const element=operation();guards.push({id,accepted:true,html:element.outerHTML});}catch(error){guards.push({id,accepted:false,error:error.stack??String(error)});}}
json(join(out,'core-guards.json'),guards);window.happyDOM.cancelAsync();
provenance.finished=new Date().toISOString();provenance.cleanAfter=run('git',['status','--porcelain'],{cwd:repo}).stdout==='';provenance.hashesUnchanged=provenance.hashes.every(x=>hash(join(repo,x.path))===x.sha256);json(join(out,'provenance.json'),provenance);
