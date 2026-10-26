// Isolated archive-consumer wrapper. The reviewed authored measurement is unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
assert.equal(process.env.FORMA_PACKED_SIZE_QUIET_RELEASE, '1', 'wait for the explicit quiet-window release');
const [sourceArg, qualificationArg, outputArg] = process.argv.slice(2);
assert(sourceArg && qualificationArg && outputArg, 'usage: node run-packed-size.mjs SOURCE_REPO QUALIFICATION_ROOT OUTPUT');
const source = resolve(sourceArg), qualification = resolve(qualificationArg), output = resolve(outputArg);
assert(!existsSync(output), 'preserve previous measurement attempts'); mkdirSync(output, { recursive:true });
const view = join(output, 'view'), candidate = join(qualification, 'candidate');
const original = join(qualification, 'packed-native-final'), consumer = join(original, 'consumer');
const proofFile = join(original, 'packed-native.json'), recordFile = join(candidate, 'release-set.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = file => sha(readFileSync(file));
const json = file => JSON.parse(readFileSync(file));
const log = [];
const command = (cmd, args, cwd = output) => {
 log.push({cmd,args,cwd}); return execFileSync(cmd,args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120_000});
};
const walk = root => {
 const files = {};
 const visit = (dir, prefix='') => { for (const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
  const name = prefix+entry.name, path = join(dir,entry.name);
  if (entry.isDirectory()) visit(path,`${name}/`);
  else if(entry.isSymbolicLink()){ const target=realpathSync(path);assert(target.startsWith(realpathSync(consumer)+sep),`dependency link escapes isolated consumer: ${path}`);files[name]={symlink:readlinkSync(path),realpath:target,sha256:digest(target)}; }
  else { assert(entry.isFile(), `unexpected product ${path}`); files[name]=digest(path); }
 } }; visit(root); return files;
};
const receipt = {schema:'forma-301-packed-size-v1',startedAt:new Date().toISOString(),node:process.version,passed:false,
 scope:'Authoritative paired N3 measurement over authenticated installed DS11 JavaScript archives. All eight archive identities are checked; only core/router/compiler/build execute in this size campaign. Authored fixture, build, measurement and fixed limits are unchanged. This is not another whole-P17 or publication result.',
 staging:'A separate sparse Git view at the sealed commit maps packages/{core,router,compiler,build} and node_modules to the authenticated isolated consumer. The view is intentionally dirty; its untracked staging marker and product symlinks are recorded. The original packed proof and its outputs remain untouched.',commands:log};
try {
 const record=json(recordFile), proof=json(proofFile);
 assert.equal(digest(recordFile),'96472d312b1075dd409b89596d597335832a5609893fd33f637b28dc153382a6');
 assert.equal(record.commit,'9d4aafee0c99cde4faff3f39a8fca2705e70a398'); assert.equal(proof.commit,record.commit);
 assert.equal(proof.recordHash,digest(recordFile)); assert.equal(proof.status,'passed'); assert.equal(proof.browserSummary.passed,90);
 receipt.sourceCommit=record.commit; receipt.releaseSet={path:recordFile,sha256:digest(recordFile)};
 receipt.originalPackedProof={path:proofFile,sha256:digest(proofFile)}; receipt.packages=record.packages;
 const checkArchives=()=>{ for(const p of record.packages) assert.equal(digest(join(candidate,p.file)),p.sha256,`archive changed: ${p.name}`); };
 checkArchives(); assert.equal(digest(join(consumer,'package-lock.json')),proof.consumerLockSha256);
 receipt.consumerLock={path:join(consumer,'package-lock.json'),sha256:proof.consumerLockSha256};
 // Compare every installed file with the bytes extracted from its sealed archive.
 const installed = {}, archiveFiles = {}, installedSnapshots = {};
 const consumerLock=json(join(consumer,'package-lock.json'));
 for (const member of ['core','router','compiler','build']) {
  const item=record.packages.find(p=>p.name===`@getforma/${member}`); assert(item);
  const installedRoot=realpathSync(join(consumer,'node_modules/@getforma',member));
  assert(installedRoot.startsWith(realpathSync(consumer)+sep));
  const extracted=join(output,'archive-products',member);mkdirSync(extracted,{recursive:true});
  command('tar',['-xzf',join(candidate,item.file),'-C',extracted,'--strip-components=1']);
  archiveFiles[member]=walk(extracted);installedSnapshots[member]=walk(installedRoot);
  const packaged=Object.fromEntries(Object.entries(installedSnapshots[member]).filter(([file])=>!file.startsWith('node_modules/')));
  assert.deepEqual(packaged,archiveFiles[member],`installed ${member} differs from archive`);
  const nestedDependencies={};
  for(const file of Object.keys(installedSnapshots[member]).filter(file=>file.startsWith('node_modules/')&&file.endsWith('/package.json'))){
   const packagePath=`node_modules/@getforma/${member}/${file.slice(0,-'/package.json'.length)}`;
   const lock=consumerLock.packages[packagePath],manifest=json(join(installedRoot,file));
   assert(lock?.integrity && lock.version===manifest.version,`nested dependency differs from authenticated consumer lock: ${packagePath}`);
   nestedDependencies[packagePath]={version:manifest.version,integrity:lock.integrity,manifestSha256:installedSnapshots[member][file]};
  }
  assert.equal(digest(join(installedRoot,'package.json')),proof.npmProductFiles[member].manifest);
  assert.deepEqual(walk(join(installedRoot,'dist')),proof.npmProductFiles[member].dist);
  installed[member]={realpath:installedRoot,archive:item.file,archiveSha256:item.sha256,files:archiveFiles[member],nestedDependencies,nestedInstalledFiles:Object.fromEntries(Object.entries(installedSnapshots[member]).filter(([file])=>file.startsWith('node_modules/')))};
 }
 receipt.installedProducts=installed;
 const fixture='experiments/forma-router-native';
 const appFiles=command('git',['ls-tree','-r','--name-only',record.commit,`${fixture}/app`],source).trim().split('\n');
 const authored=['package.json','package-lock.json','Cargo.toml','Cargo.lock',`${fixture}/measure-size.mjs`,`${fixture}/build.mjs`,`${fixture}/client.ts`,`${fixture}/client-next.ts`,...appFiles,'scripts/navigation-size-contract.mjs','scripts/router-size-baseline.json'];
 command('git',['clone','--shared','--no-checkout',source,view]);
 command('git',['sparse-checkout','init','--no-cone'],view);
 command('git',['sparse-checkout','set','--no-cone',...authored.map(file=>'/'+file)],view);
 command('git',['checkout','--detach',record.commit],view);
 const authoredHashes=Object.fromEntries(authored.map(file=>{
  const expected=sha(execFileSync('git',['show',`${record.commit}:${file}`],{cwd:source,maxBuffer:4*1024*1024}));
  assert.equal(digest(join(view,file)),expected,`authored measurement differs: ${file}`); return [file,expected];
 })); receipt.authoredInputs=authoredHashes;
 mkdirSync(join(view,'packages'));
 for (const [member,product] of Object.entries(installed)) symlinkSync(product.realpath,join(view,'packages',member),'dir');
 symlinkSync(join(consumer,'node_modules'),join(view,'node_modules'),'dir');
 writeFileSync(join(view,'PACKED-MEASUREMENT-VIEW.json'),JSON.stringify({scope:receipt.staging,sourceCommit:record.commit,installedProducts:Object.fromEntries(Object.entries(installed).map(([k,v])=>[k,v.realpath]))},null,2)+'\n');
 receipt.stagingStatus=command('git',['status','--porcelain'],view);assert(receipt.stagingStatus.includes('PACKED-MEASUREMENT-VIEW.json'));
 const specifiers=['@getforma/core','@getforma/core/navigation','@getforma/core/compiled','@getforma/router','@getforma/compiler','@getforma/build'];
 const resolutions=JSON.parse(command(process.execPath,['--input-type=module','--eval',`console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(specifiers)}.map(name=>[name,import.meta.resolve(name)]))))`],view));
 const coreSignal=JSON.parse(command(process.execPath,['--input-type=module','--eval',`import {createRequire} from 'node:module'; console.log(JSON.stringify(createRequire(import.meta.resolve('@getforma/core')).resolve('alien-signals')))`],view));
 resolutions['core dependency: alien-signals']=new URL('file://'+coreSignal).href;
 const buildEsbuild=JSON.parse(command(process.execPath,['--input-type=module','--eval',`import {createRequire} from 'node:module'; console.log(JSON.stringify(createRequire(import.meta.resolve('@getforma/build')).resolve('esbuild')))`],view));
 resolutions['build dependency: esbuild']=new URL('file://'+buildEsbuild).href;
 receipt.moduleResolutions=Object.fromEntries(Object.entries(resolutions).map(([name,url])=>{
  const path=realpathSync(fileURLToPath(url)); assert(path.startsWith(realpathSync(consumer)+sep),`workspace fallback: ${name}`); return [name,{path,sha256:digest(path)}];
 }));
 const baselineRoot=join(qualification,'successor-native-size');
 const baselineArchive=join(baselineRoot,'baseline/getforma-core-3.1.0.tgz'),baselineReceipt=join(baselineRoot,'baseline-pack.json');
 const pin=json(join(view,'scripts/router-size-baseline.json'));
 assert.equal(digest(baselineArchive),pin.archiveSha256); assert.equal(json(baselineReceipt)[0].integrity,pin.integrity);
 receipt.baseline={...pin,path:baselineArchive,packReceipt:baselineReceipt,packReceiptSha256:digest(baselineReceipt)};
 const originalArtifacts=Object.fromEntries(Object.keys(proof.browserSummary.artifacts).map(file=>[file,digest(join(original,'checkout',fixture,file))]));
 assert.deepEqual(originalArtifacts,proof.browserSummary.artifacts);
 const measured=join(output,'size.json');
 try { writeFileSync(join(output,'measurement.log'),command(process.execPath,[join(view,fixture,'measure-size.mjs'),baselineArchive,baselineReceipt,measured],view)); }
 catch(error) { writeFileSync(join(output,'measurement.log'),`${error.stdout??''}\n${error.stderr??''}`); throw error; }
 const evidence=json(measured);assert.equal(evidence.sourceCommit,record.commit);assert.equal(evidence.sourceDirty,true);assert.equal(evidence.verdict.passed,true);
 for (const [file,hash] of Object.entries(authoredHashes)) assert.equal(digest(join(view,file)),hash,`authored input changed: ${file}`);
 for (const [member,product] of Object.entries(installed)) assert.deepEqual(walk(product.realpath),installedSnapshots[member],`installed ${member} changed during measurement`);
 for (const [file,hash] of Object.entries(originalArtifacts)) assert.equal(digest(join(original,'checkout',fixture,file)),hash,`original proof output changed: ${file}`);
 for (const [name,product] of Object.entries(receipt.moduleResolutions)) assert.equal(digest(product.path),product.sha256,`loaded product changed: ${name}`);
 checkArchives(); assert.equal(digest(proofFile),receipt.originalPackedProof.sha256);assert.equal(digest(join(consumer,'package-lock.json')),receipt.consumerLock.sha256);
 for(const asset of evidence.group.assets) assert.equal(asset.sha256,proof.browserSummary.artifacts['dist/'+asset.file],`measured group asset differs from packed native proof: ${asset.file}`);
 receipt.groupAssetsMatchPackedProof=true;receipt.verdict=evidence.verdict;receipt.measurement={path:measured,sha256:digest(measured)};
 receipt.authoredInputsUnchanged=true;receipt.installedArchiveProductsUnchanged=true;receipt.originalProofAndOutputsUnchanged=true;receipt.allEightArchivesUnchanged=true;receipt.passed=true;
} catch(error) { receipt.error=String(error.stack??error);process.exitCode=1; }
finally { receipt.runner={path:fileURLToPath(import.meta.url),sha256:digest(fileURLToPath(import.meta.url))};receipt.finishedAt=new Date().toISOString();writeFileSync(join(output,'packed-size.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,passed:receipt.passed,verdict:receipt.verdict,error:receipt.error})); }
