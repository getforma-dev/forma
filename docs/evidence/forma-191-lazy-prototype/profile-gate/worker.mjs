import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,symlink,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {supervisedWorker} from '/Users/victorvillacis/dev/Forma/work/codex-release-lead/performance-continuation/run.mjs';
const root='/Users/victorvillacis/dev/Forma/work/FORMA-191-lazy-prototype/forma';
const output=resolve(root,'../tmp/product-release-profile');
const head='fe2ba420a6e7e382eb8b18a6c96d3e6be76a9efa';
const productHead='24a6c0b0157baa434524ffc8431041ebb1b3854b';
const env={...process.env,PATH:'/Users/victorvillacis/.nvm/versions/node/v24.22.0/bin:'+process.env.PATH,CARGO_BUILD_JOBS:'3',PLAYWRIGHT_SKIP_BROWSER_GC:'1',FORMA_STATIC_E2E_PORT:'35627',FORMA_SSR_E2E_PORT:'35628',FORMA_TEST_PORT:'35629'};
for(const key of ['CARGO_TARGET_DIR','FORMAJS_DIR','FORMA_DIR','FORMA_TEST_BROWSER_CHANNEL','FORMA_FIXTURE_PORT_BASE'])delete env[key];
const require=createRequire(join(root,'package.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n');
const results=[];
async function command(name,args,expectedCode=0){
 const entry={name,args,expectedCode,cwd:root,startedAt:new Date().toISOString()};results.push(entry);
 const log=createWriteStream(join(output,name+'.log'),{flags:'wx'});
 console.log('START',name,JSON.stringify(args));
 const child=spawn(args[0],args.slice(1),{cwd:root,env:{...env,PLAYWRIGHT_JSON_OUTPUT_NAME:join(output,name+'.json')},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{log.write(bytes);process.stdout.write(bytes);});
 const status=await new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
 await new Promise(resolve=>log.end(resolve));Object.assign(entry,status,{finishedAt:new Date().toISOString()});await save('commands.json',results);
 console.log('END',name,JSON.stringify(status));return status.code===expectedCode;
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
 assert.equal(prior.head,productHead);assert.deepEqual(source,prior.source);
 const changed=execFileSync('git',['diff','--name-only',productHead,head],{cwd:root,encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(changed,['e2e/fixtures/apps/README.md','e2e/fixtures/apps/apps.spec.ts']);
 await save('fixture-selector-source.json',{head,productHead,onlyChangedPaths:changed,files:await inventory(changed),priorFiniteScope:'dc43901d and 24a6c0b; no new-head finite replay claim'});
 const core=JSON.parse(await readFile(join(original,'core-artifacts.json'),'utf8'));
 assert.deepEqual(await inventory(['packages/core/dist']),core);
 const typed=JSON.parse(await readFile(join(original,'typed-products.json'),'utf8'));
 assert.deepEqual(await inventory(['packages/compiler/dist','packages/build/dist','e2e/ssr/out','e2e/fixtures/apps/out/fauth']),typed);
 await save('retained-products-proof.json',{original,sourceUnchanged:true,coreFiles:core.length,typedFiles:typed.length,coreManifestSha256:hash(await readFile(join(original,'core-artifacts.json'))),typedManifestSha256:hash(await readFile(join(original,'typed-products.json'))),nativeBinary:await inventory(['e2e/target/debug/fixture-fauth'])});
 const originalBrowser=resolve(root,'../tmp/product-browser-cjs');
 const retained=JSON.parse(await readFile(join(originalBrowser,'retained-products-proof.json'),'utf8'));
 assert.deepEqual(await inventory(['e2e/target/debug/fixture-fauth']),retained.nativeBinary);
 env.FORMA_FIXTURE_PROFILE='invalid';
 if(!await command('invalid-profile-collection',['npx','playwright','test','--config','../root-three-engine-cjs.config.ts','e2e/fixtures/apps/apps.spec.ts','--grep','fixture application fauth','--workers=2','--list','--reporter=list'],1))return 2;
 assert((await readFile(join(output,'invalid-profile-collection.log'),'utf8')).includes('invalid FORMA_FIXTURE_PROFILE'));
 delete env.FORMA_FIXTURE_PROFILE;
 if(!await command('debug-headers',['node',resolve(root,'../profile-gate/capture-headers.mjs'),'debug',join(output,'debug-response')]))return 2;
 if(!await command('release-fauth-native',['cargo','build','--quiet','--locked','--release','--manifest-path','e2e/fixtures/apps/Cargo.toml','--bin','fixture-fauth']))return 2;
 if(!await command('release-headers',['node',resolve(root,'../profile-gate/capture-headers.mjs'),'release',join(output,'release-response')]))return 2;
 const debug=JSON.parse(await readFile(join(output,'debug-response.json'),'utf8'));
 const release=JSON.parse(await readFile(join(output,'release-response.json'),'utf8'));
 const normalize=policy=>policy.replace(/'nonce-[A-Za-z0-9+/_=-]+'/g,"'nonce-<per-response>'");
 assert.equal(normalize(debug.headers['content-security-policy']),normalize(release.headers['content-security-policy']));
 assert.equal(debug.headers['content-security-policy-report-only'],"require-trusted-types-for 'script'; trusted-types forma forma-runtime");
 assert.equal(release.headers['content-security-policy-report-only'],undefined);
 await save('header-comparison.json',{debugBinary:debug.binarySha256,releaseBinary:release.binarySha256,enforcedPolicyEqualAfterNonceNormalization:true,enforcedPolicy:normalize(debug.headers['content-security-policy']),debugReportOnly:debug.headers['content-security-policy-report-only'],releaseReportOnly:null});
 assert.deepEqual(await inventory(['packages/core/dist']),core);
 assert.deepEqual(await inventory(['packages/compiler/dist','packages/build/dist','e2e/ssr/out','e2e/fixtures/apps/out/fauth']),typed);
 env.FORMA_FIXTURE_PROFILE='release';
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
 await save('summary.json',{head,productHead,sourceUnchanged:true,allCommandsPassed:true,commands:results.length,finishedAt:new Date().toISOString(),performanceMeasured:false});return 0;
});
