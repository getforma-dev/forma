import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,cp,rm,readdir,realpath,symlink} from 'node:fs/promises';
import {dirname,join,resolve,delimiter,relative,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [repoArg,archiveArg,recordHash,commit,workArg]=process.argv.slice(2);
assert(repoArg&&archiveArg&&recordHash&&commit&&workArg,'usage: node PROOF SOURCE ARCHIVES RECORD_SHA256 COMMIT FRESH_OUTPUT');
const repo=await realpath(resolve(repoArg)),archive=await realpath(resolve(archiveArg)),requestedWork=resolve(workArg);
const {validateCandidate,prepareCandidate}=await import(pathToFileURL(join(repo,'scripts/candidate-scaffold.mjs')));
const {stageNpmLock,assertInstalledTemplateCandidates}=await import(pathToFileURL(join(repo,'scripts/release-set.mjs')));
const {auditCandidateSignatures}=await import(pathToFileURL(join(repo,'scripts/audit-release-signatures.mjs')));
const {spawnProofProcess,stopProofProcess}=await import(pathToFileURL(join(repo,'scripts/router-proof-process.mjs')));
const set=validateCandidate(archive,recordHash,commit),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(requestedWork);const work=await realpath(requestedWork),clone=join(work,'checkout'),consumer=join(work,'consumer');
const receipt={startedAt:new Date().toISOString(),node:process.version,scope:'Authoritative packed DS11 native owner integration receipt using the unchanged source fixture. The inner browser receipt retains its original source-integration label; this outer receipt authenticates the executed packed products. No publication, physical-device or manual accessibility claim.',commit,recordHash,packages:set.packages,runner:{path:fileURLToPath(import.meta.url),sha256:hash(await readFile(fileURLToPath(import.meta.url)))},commands:[],status:'running'};
const children=[];let interrupted=false;
const env={...process.env,PATH:dirname(process.execPath)+delimiter+process.env.PATH,CARGO_BUILD_JOBS:'3',CARGO_TARGET_DIR:join(work,'target')};
process.env.PATH=env.PATH;process.env.CARGO_BUILD_JOBS='3';process.env.CARGO_TARGET_DIR=env.CARGO_TARGET_DIR;
const save=()=>writeFile(join(work,'packed-native.json'),JSON.stringify(receipt,null,2)+'\n');
function owned(command,args,label,cwd=clone,extra={}){
  if(interrupted)throw Error('Packed proof interrupted');receipt.commands.push({command,args,cwd});
  const handle=spawnProofProcess(command,args,{cwd,env:{...env,...extra}});children.push(handle);
  const stream=createWriteStream(join(work,label),{flags:'wx'});let output='';
  for(const pipe of [handle.child.stdout,handle.child.stderr])pipe.on('data',bytes=>{stream.write(bytes);output+=bytes;});
  handle.child.on('close',()=>stream.end());return {...handle,output:()=>output};
}
async function run(command,args,label,cwd,extra){const handle=owned(command,args,label,cwd,extra);const result=await handle.closed;if(result.error||result.code!==0)throw Error(`${command} failed: ${result.error??result.code??result.signal}\n${handle.output().slice(-3000)}`);return handle.output();}
function interrupt(){interrupted=true;void Promise.allSettled(children.map(handle=>stopProofProcess(handle)));}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
async function inventory(root){const values={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(entry.isFile())values[relative(root,path)]=hash(await readFile(path));else throw Error(`Unexpected tool symlink ${path}`);}}await walk(root);return values;}
try{
  await run('git',['clone','--shared','--no-checkout',repo,clone],'clone.log',work);
  await run('git',['checkout','--detach',commit],'checkout.log');
  receipt.cloneHead=(await run('git',['rev-parse','HEAD'],'head.log')).trim();assert.equal(receipt.cloneHead,commit);
  // The public candidate preparation authenticates/installs the packed CLI and
  // its shipped native-router lock, preserving the exact external dependency graph.
  const prepared=prepareCandidate(archive,recordHash,commit,join(work,'candidate'));
  receipt.preparation=JSON.parse(await readFile(join(work,'candidate/preparation.json')));
  const admin=join(dirname(dirname(prepared.cli)),'templates/native-router/admin');
  const staged=stageNpmLock(JSON.parse(await readFile(join(admin,'package.json'))),JSON.parse(await readFile(join(admin,'package-lock.json'))),set.packages,archive,true);
  await mkdir(consumer);await writeFile(join(consumer,'package.json'),JSON.stringify(staged.manifest,null,2)+'\n');await writeFile(join(consumer,'package-lock.json'),JSON.stringify(staged.lock,null,2)+'\n');
  const lockHash=hash(await readFile(join(consumer,'package-lock.json')));
  await run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],'consumer-install.log',consumer);
  assert.equal(hash(await readFile(join(consumer,'package-lock.json'))),lockHash,'npm lock must remain unchanged');
  receipt.installed=assertInstalledTemplateCandidates(consumer,set.packages);
  receipt.signatures=auditCandidateSignatures(consumer,set.packages,archive);
  receipt.consumerLockSha256=lockHash;
  const directoryLink=process.platform==='win32'?'junction':'dir';
  await symlink(join(consumer,'node_modules'),join(clone,'node_modules'),directoryLink);
  await symlink(join(consumer,'node_modules/@getforma/build/dist'),join(clone,'packages/build/dist'),directoryLink);
  const resolved=JSON.parse(await run(process.execPath,['--input-type=module','--eval',"console.log(JSON.stringify(Object.fromEntries(['core','router','compiler','build'].map(name=>[name,import.meta.resolve('@getforma/'+name)]))))"],'npm-resolutions.log'));
  receipt.npmResolutions={};
  for(const name of ['core','router','compiler','build']){
    const path=await realpath(fileURLToPath(resolved[name]));assert(path.startsWith(join(consumer,'node_modules/@getforma',name)+sep),`Packed resolution escaped: ${path}`);assert(!path.startsWith(repo+sep));receipt.npmResolutions[name]=path;
  }
  assert.equal(await realpath(join(clone,'packages/build/dist/index.js')),await realpath(join(consumer,'node_modules/@getforma/build/dist/index.js')));
  receipt.npmProductFiles={};
  for(const name of ['core','router','compiler','build']){const root=join(consumer,'node_modules/@getforma',name);receipt.npmProductFiles[name]={manifest:hash(await readFile(join(root,'package.json'))),dist:await inventory(join(root,'dist'))};}
  receipt.crateFiles={};
  for(const item of set.packages.filter(item=>item.registry==='crates')){
    const target=join(clone,item.path);await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
    await run('tar',['-xzf',join(archive,item.file),'-C',target,'--strip-components=1'],`extract-${item.name}.log`);
    assert.equal(JSON.parse(await readFile(join(target,'.cargo_vcs_info.json'))).git.sha1,commit);
    receipt.crateFiles[item.name]=await inventory(target);
  }
  // Test instrumentation only: exact already verified third-party Playwright
  // files are copied, never linked to original workspace product packages.
  const sourceLock=JSON.parse(await readFile(join(clone,'package-lock.json')));receipt.testTooling={};
  for(const name of ['playwright','playwright-core']){
    const source=join(repo,'node_modules',name),target=join(consumer,'node_modules',name),entry=sourceLock.packages[`node_modules/${name}`];
    assert(entry?.integrity&&entry.resolved.startsWith('https://'));assert.equal(JSON.parse(await readFile(join(source,'package.json'))).version,entry.version);
    const before=await inventory(source);await cp(source,target,{recursive:true});assert.deepEqual(await inventory(target),before);receipt.testTooling[name]={lock:entry,files:before,realpath:await realpath(target)};
  }
  const fixture=join(clone,'experiments/forma-router-native');
  const immutableFiles=['build.mjs','browser.mjs','client.ts','client-next.ts','server/Cargo.toml','server/Cargo.lock','server/src/main.rs',...(await readdir(join(fixture,'app'))).map(name=>'app/'+name)];
  receipt.fixtureSources={};for(const name of immutableFiles){const original=execFileSync('git',['show',`${commit}:experiments/forma-router-native/${name}`],{cwd:repo});assert.deepEqual(await readFile(join(fixture,name)),original,`${name} differs from authored fixture`);receipt.fixtureSources[name]=hash(original);}
  await run(process.execPath,[join(fixture,'build.mjs')],'fixture-build.log');
  const metadata=JSON.parse(await run('cargo',['metadata','--format-version','1','--locked','--manifest-path',join(fixture,'server/Cargo.toml')],'cargo-metadata.log'));
  receipt.cargoResolutions={};
  for(const name of ['forma-ir','forma-ir-derive','forma-server']){const matches=metadata.packages.filter(item=>item.name===name);assert.equal(matches.length,1,`Exactly one packed ${name} must resolve`);const item=matches[0];assert(!item.source);const path=await realpath(item.manifest_path);assert.equal(path,join(clone,'crates',name,'Cargo.toml'));receipt.cargoResolutions[name]={manifest:path,version:item.version,source:item.source};}
  await run('cargo',['build','--locked','--manifest-path',join(fixture,'server/Cargo.toml')],'server-build.log');
  const binary=join(work,`target/debug/forma-router-native-fixture${process.platform==='win32'?'.exe':''}`);receipt.serverBinarySha256=hash(await readFile(binary));
  const server=owned(binary,[],'server.log',clone,{PORT:'0',FORMA_NATIVE_DIST:join(fixture,'dist')});
  const origin=await new Promise((resolveOrigin,reject)=>{const timer=setTimeout(()=>reject(Error('Packed server readiness deadline')),15000);server.child.once('exit',()=>{clearTimeout(timer);reject(Error('Packed server exited before readiness'));});server.child.stdout.on('data',()=>{const match=server.output().match(/^http:\/\/127\.0\.0\.1:\d+$/m);if(match){clearTimeout(timer);resolveOrigin(match[0]);}});});
  receipt.origin=origin;await save();
  await run(process.execPath,[join(fixture,'browser.mjs'),origin,join(work,'browser.json')],'browser.log',clone,{NATIVE_ENGINES:'chromium,firefox,webkit',NATIVE_CASE:'',NATIVE_SERVER_BINARY:binary});
  const proof=JSON.parse(await readFile(join(work,'browser.json')));assert.equal(proof.status,'passed');assert.equal(proof.results.length,90);assert.equal(proof.sourceChangedDuringRun,false);assert.equal(proof.artifactsChangedDuringRun,false);receipt.browserSummary={passed:proof.results.length,status:proof.status,artifacts:proof.artifacts,browsers:proof.browsers,sourceDrift:proof.sourceChangedDuringRun,artifactDrift:proof.artifactsChangedDuringRun};
  for(const [name,digest] of Object.entries(receipt.fixtureSources))assert.equal(hash(await readFile(join(fixture,name))),digest,'Authored fixture changed');
  for(const item of set.packages.filter(item=>item.registry==='crates'))assert.deepEqual(await inventory(join(clone,item.path)),receipt.crateFiles[item.name],'Packed crate files changed');
  for(const [name,files] of Object.entries(receipt.npmProductFiles)){const root=join(consumer,'node_modules/@getforma',name);assert.equal(hash(await readFile(join(root,'package.json'))),files.manifest);assert.deepEqual(await inventory(join(root,'dist')),files.dist,'Installed packed runtime changed');}
  validateCandidate(archive,recordHash,commit);receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=String(error.stack??error);console.error(receipt.error);process.exitCode=1;}
finally{
  const cleanup=await Promise.allSettled(children.map(handle=>stopProofProcess(handle)));receipt.cleanup=cleanup.map(item=>item.status==='fulfilled'?item.value:{error:String(item.reason)});receipt.ownedProcessesStopped=cleanup.every(item=>item.status==='fulfilled'&&item.value.closed);if(!receipt.ownedProcessesStopped||interrupted){receipt.status='failed';process.exitCode=1;}
  receipt.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:receipt.status,work,ownedProcessesStopped:receipt.ownedProcessesStopped}));
}
