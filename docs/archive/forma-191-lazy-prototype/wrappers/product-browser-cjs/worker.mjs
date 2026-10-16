import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,symlink,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {supervisedWorker} from '/Users/victorvillacis/dev/Forma/work/codex-release-lead/performance-continuation/run.mjs';
const root='/Users/victorvillacis/dev/Forma/work/FORMA-191-lazy-prototype/forma';
const output=resolve(root,'../tmp/product-browser-cjs');
const head='24a6c0b0157baa434524ffc8431041ebb1b3854b';
const env={...process.env,PATH:'/Users/victorvillacis/.nvm/versions/node/v24.22.0/bin:'+process.env.PATH,CARGO_BUILD_JOBS:'3',PLAYWRIGHT_SKIP_BROWSER_GC:'1',FORMA_STATIC_E2E_PORT:'35627',FORMA_SSR_E2E_PORT:'35628',FORMA_TEST_PORT:'35629'};
for(const key of ['CARGO_TARGET_DIR','FORMAJS_DIR','FORMA_DIR','FORMA_TEST_BROWSER_CHANNEL','FORMA_FIXTURE_PORT_BASE'])delete env[key];
const require=createRequire(join(root,'package.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
const results=[];
async function command(name,args){
 const entry={name,args,cwd:root,startedAt:new Date().toISOString()};results.push(entry);
 const log=createWriteStream(join(output,name+'.log'),{flags:'wx'});
 console.log('START',name,JSON.stringify(args));
 const child=spawn(args[0],args.slice(1),{cwd:root,env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:join(output,name+'.json')},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{log.write(bytes);process.stdout.write(bytes);});
 const status=await new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
 await new Promise(resolve=>log.end(resolve));Object.assign(entry,status,{finishedAt:new Date().toISOString()});await save('commands.json',results);
 console.log('END',name,JSON.stringify(status));return status.code===0;
}
async function inventory(paths){
 const files=[];
 async function walk(path){const s=await stat(path);if(s.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(path,name));}else if(s.isFile()){const bytes=await readFile(path);files.push({path:path.slice(root.length+1),bytes:bytes.length,sha256:hash(bytes)});}}
 for(const path of paths)await walk(join(root,path));return files;
}
process.exitCode=await supervisedWorker(async()=>{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),head);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
 assert.equal(process.version,'v24.22.0');
 const sourcePaths=['packages/core/src/dom/element.ts','packages/core/src/dom/__tests__/element-prototype-cache.test.ts','packages/core/e2e/core-regressions.spec.ts','packages/core/CHANGELOG.md','package-lock.json'];
 const source=await inventory(sourcePaths);
 const provenance={head,node:process.version,source,playwright:{test:require.resolve('@playwright/test/package.json'),runner:require.resolve('playwright/package.json'),version:require('playwright/package.json').version},environment:Object.fromEntries(['CARGO_BUILD_JOBS','PLAYWRIGHT_SKIP_BROWSER_GC','FORMA_STATIC_E2E_PORT','FORMA_SSR_E2E_PORT','FORMA_TEST_PORT'].map(k=>[k,env[k]])),coreWebServerCwd:'packages/core: installed runner/index.js defaults omitted cwd to configDir (line841)',startedAt:new Date().toISOString()};
 assert.equal(provenance.playwright.version,'1.64.1');await save('provenance.json',provenance);
 const original=resolve(root,'../tmp/product-gate-first');
 const prior=JSON.parse(await readFile(join(original,'provenance.json'),'utf8'));
 assert.equal(prior.head,head);assert.deepEqual(source,prior.source);
 const core=JSON.parse(await readFile(join(original,'core-artifacts.json'),'utf8'));
 assert.deepEqual(await inventory(['packages/core/dist']),core);
 const typed=JSON.parse(await readFile(join(original,'typed-products.json'),'utf8'));
 assert.deepEqual(await inventory(['packages/compiler/dist','packages/build/dist','e2e/ssr/out','e2e/fixtures/apps/out/fauth']),typed);
 await save('retained-products-proof.json',{original,sourceUnchanged:true,coreFiles:core.length,typedFiles:typed.length,coreManifestSha256:hash(await readFile(join(original,'core-artifacts.json'))),typedManifestSha256:hash(await readFile(join(original,'typed-products.json'))),nativeBinary:await inventory(['e2e/target/debug/fixture-fauth'])});
 const browserCommands=[
 ['fauth-three-engines',['npx','playwright','test','--config','../root-three-engine-cjs.config.ts','e2e/fixtures/apps/apps.spec.ts','--grep','fixture application fauth','--workers=2','--reporter=line,json','--output',join(output,'fauth-test-results')]],
 ['namespaces-three-engines',['npx','playwright','test','--config','../root-three-engine-cjs.config.ts','e2e/ssr/namespaces.spec.ts','--workers=2','--reporter=line,json','--output',join(output,'namespaces-test-results')]],
 ['conditional-three-engines',['npx','playwright','test','--config','e2e/ssr/beta-acceptance.config.ts','conditional-element.spec.ts','--workers=2','--reporter=line,json','--output',join(output,'conditional-test-results')]],
 ['core-three-engines',['npx','playwright','test','--config','packages/core/playwright.config.ts','core-regressions.spec.ts','--workers=2','--reporter=line,json','--output',join(output,'core-test-results')]],
 ];
 for(const [name,args] of browserCommands)if(!await command(name,args))return 2;
 const playwright=require('playwright'),versions=[];
 for(const name of ['chromium','firefox','webkit']){const browser=await playwright[name].launch({headless:true});try{versions.push({name,version:browser.version(),executablePath:playwright[name].executablePath()});}finally{await browser.close();}}
 await save('browser-versions.json',versions);
 assert.deepEqual(await inventory(sourcePaths),source);
 await save('summary.json',{head,sourceUnchanged:true,allCommandsPassed:true,commands:results.length,finishedAt:new Date().toISOString(),performanceMeasured:false});return 0;
});
