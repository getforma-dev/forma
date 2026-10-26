// Local fixed-consumer qualification. Requires an authenticated npm-pack receipt
// and its unchanged published3.1 core archive; this is not a whole-P17 pass.
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';
import {build} from '../../packages/build/dist/index.js';
import {navigationSizeVerdict} from '../../scripts/navigation-size-contract.mjs';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const [archiveArg,receiptArg,outputArg]=process.argv.slice(2);assert(archiveArg&&receiptArg&&outputArg,'usage: node measure-size.mjs CORE_3.1_TGZ NPM_PACK_JSON OUTPUT_JSON');
const archive=resolve(archiveArg),receipt=JSON.parse(readFileSync(receiptArg))[0],output=resolve(outputArg);
assert(!existsSync(output),'preserve prior measurement evidence');assert.equal(receipt.name,'@getforma/core');assert.equal(receipt.version,'3.1.0');
const archiveBytes=readFileSync(archive),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(`sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`,receipt.integrity,'published-core archive differs from npm-pack receipt');
const scratch=mkdtempSync(join(tmpdir(),'forma-router-size-'));
function products(){const files=[join(here,'client.ts'),...readdirSync(join(here,'app')).map(file=>join(here,'app',file))];for(const member of ['core','router','compiler','build']){const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.js'))files.push(file);}};walk(join(repo,'packages',member,'dist'));}return Object.fromEntries(files.sort().map(file=>[file.slice(repo.length+1),sha256(readFileSync(file))]));}
function asset(file,path){const bytes=readFileSync(path),gzip=gzipSync(bytes,{level:9});assert.equal(gzip.readUInt32LE(4),0);return {file,sha256:sha256(bytes),raw:bytes.length,gzip:gzip.length,brotli:brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length};}
function inventory(dist,manifest){const routes=Object.fromEntries(Object.entries(manifest.routes).map(([route,row])=>[route,[...new Set([...row.js,...row.modulepreload??[],...(row.js.length?['sw.js']:[])])].map(file=>asset(file,join(dist,file)))]));const all=new Map(Object.values(routes).flat().map(row=>[row.file,row]));return {routes,assets:[...all.values()],gzip:[...all.values()].reduce((sum,row)=>sum+row.gzip,0)};}
async function plain(label,core){const root=join(scratch,label);mkdirSync(join(root,'node_modules/@getforma'),{recursive:true});cpSync(join(here,'app'),join(root,'app'),{recursive:true});symlinkSync(core,join(root,'node_modules/@getforma/core'),'dir');const result=await build({app:'forma-router-native',ssr:true,entryPoints:['a','b'].map(name=>({entry:join(root,`app/plain-${name}.tsx`),outfile:`plain-${name}.js`})),routes:Object.fromEntries(['a','b'].map(name=>[`/native/${name}`,{js:[`plain-${name}`],css:[],fonts:[]}])),outputDir:join(root,'dist')});return {...inventory(join(root,'dist'),result.manifest),manifest:result.manifest,sizes:result.sizes};}
try{
 const sourceProducts=products();
 execFileSync(process.execPath,[join(here,'build.mjs')],{cwd:repo,stdio:'pipe'});
 const previous=join(scratch,'published-core');mkdirSync(previous);execFileSync('tar',['-xzf',archive,'-C',previous,'--strip-components=1']);
 const require=createRequire(join(repo,'packages/core/package.json'));let signals=dirname(require.resolve('alien-signals'));
 while(!existsSync(join(signals,'package.json')))signals=dirname(signals);
 assert.equal(JSON.parse(readFileSync(join(signals,'package.json'))).version,JSON.parse(readFileSync(join(previous,'package.json'))).dependencies['alien-signals']);
 mkdirSync(join(previous,'node_modules'));symlinkSync(signals,join(previous,'node_modules/alien-signals'),'dir');
 const old=await plain('previous',previous),current=await plain('current',join(repo,'packages/core'));
 const group=inventory(join(here,'dist'),JSON.parse(readFileSync(join(here,'dist/manifest.json'))));
 const sums=value=>Object.fromEntries(Object.entries(value.routes).map(([route,assets])=>[route,assets.reduce((sum,row)=>sum+row.gzip,0)]));
 const verdict=navigationSizeVerdict({previousPlain:sums(old),currentPlain:sums(current),group:group.gzip});
 assert.deepEqual(products(),sourceProducts,'candidate products changed during paired measurement');
 const evidence={sourceProducts,contract:'forma-301-size-v1',wholeP17:false,recordedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim().length>0,toolchain:{node:process.version,compiler:JSON.parse(readFileSync(join(repo,'packages/compiler/package.json'))).version,build:JSON.parse(readFileSync(join(repo,'packages/build/package.json'))).version},baseline:{name:receipt.name,version:receipt.version,integrity:receipt.integrity,archiveSha256:sha256(archiveBytes)},previousPlain:old,currentPlain:current,group,unionDifferenceGzip:group.gzip-old.gzip,verdict};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,verdict},null,2));if(!verdict.passed)process.exitCode=1;
}finally{rmSync(scratch,{recursive:true,force:true});}
