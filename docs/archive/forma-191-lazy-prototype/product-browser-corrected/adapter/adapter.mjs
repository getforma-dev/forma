// External qualification adapter. Never imported by Forma's production/release CLI.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {closeSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export const PARTIAL=Object.freeze({kind:'native-client-continuation',partialQualification:true,p17Passed:false,performanceAccepted:false,missingRequiredPhases:['decoder','mobile']});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=file=>sha(readFileSync(file));
const json=file=>JSON.parse(readFileSync(file,'utf8'));
const message=error=>String(error?.message??error);
export const inside=(parent,path)=>{const rel=relative(parent,path);return rel===''||(!rel.startsWith(`..${sep}`)&&rel!=='..'&&!isAbsolute(rel));};
export function durable(file,value){const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}

export function parseOptions(args){
 const names=['source','expected-source','packages','expected-ds11','target','output'];const options={};
 assert.equal(args.length,names.length*2,'six explicit identity/path arguments required');
 for(let i=0;i<args.length;i+=2){const key=args[i].slice(2);assert(args[i].startsWith('--')&&names.includes(key)&&!(key in options),'unknown/duplicate option');assert(args[i+1]&&!args[i+1].startsWith('--'),'missing option value');options[key]=args[i+1];}
 assert.match(options['expected-source'],/^[a-f0-9]{40}$/);assert.match(options['expected-ds11'],/^[a-f0-9]{64}$/);
 for(const key of ['source','packages','output'])assert(isAbsolute(options[key]),`${key} must be absolute`);
 options.source=realpathSync(options.source);options.packages=realpathSync(options.packages);options.output=join(realpathSync(dirname(options.output)),basename(options.output));
 assert(!inside(options.source,options.output)&&!inside(options.packages,options.output),'evidence must be outside source and input packages');
 return options;
}

export function assertSet(set,options,digest){
 assert.equal(set.schema,1);assert.equal(set.commit,options['expected-source']);
 assert.equal(set.contracts?.performance,'measured-v1');assert.equal(set.contracts?.fixtureApps,'declared-v1');
 const expected=[['crates','forma-ir','crates/forma-ir'],['crates','forma-ir-derive','crates/forma-ir-derive'],['crates','forma-server','crates/forma-server'],['npm','@getforma/core','packages/core'],['npm','@getforma/compiler','packages/compiler'],['npm','@getforma/build','packages/build'],['npm','@getforma/create-app','packages/create-app']];
 assert.deepEqual(set.packages.map(p=>[p.registry,p.name,p.path]).sort(),expected.sort(),'exact seven package identities required');
 assert.equal(new Set(set.packages.map(p=>p.version)).size,1);assert.equal(new Set(set.packages.map(p=>p.file)).size,7);
 for(const p of set.packages){assert.match(p.file,/^[A-Za-z0-9_@+][A-Za-z0-9._@+-]*$/);assert.match(p.sha256,/^[a-f0-9]{64}$/);assert.equal(digest(join(options.packages,p.file)),p.sha256,`${p.name}: packed bytes differ`);}
}

// Tested independently with finite fake producers. A child or integrity error is fatal;
// only a completed report's validator failure may leave the next phase eligible.
export async function executePhases(d){
 const outcomes={};
 try{
  const baseline=await d.baseline();await d.record('baseline',baseline);
  await d.stage();await d.build();
  for(const phase of ['native','client']){
   await d.healthy();
   const raw=await d.produce(phase); // producer checkpoint/report precedes validation
   await d.healthy();
   try{await d.validate(phase,raw,baseline);outcomes[phase]={validated:true};}
   catch(error){outcomes[phase]={validated:false,error:message(error)};}
   await d.record(`${phase}-validation`,outcomes[phase]);
  }
  const metadata=await d.metadata(); // all digest/metadata I/O must precede completion
  await d.healthy();
  const result={...PARTIAL,attemptEnded:true,launcherCleanupRequired:true,source:metadata.source,outcomes,metadata};
  await d.complete(result);return result;
 }catch(error){await d.failure({ ...PARTIAL,attemptEnded:false,outcomes,error:message(error)});throw error;}
 finally{await d.cleanup();}
}

const command=(cmd,args,cwd,options={})=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','inherit'],maxBuffer:64*1024*1024,...options});
export function campaignCommand({phase,source,project,targetDir,journal,env,node=process.execPath,platform=process.platform}){
 assert(['native','client'].includes(phase),'only native/client continuation phases allowed');
 const path=join(journal,`${phase}-report.json`);
 return phase==='native'
  ?{file:join(targetDir,'release',`fixture-measure${platform==='win32'?'.exe':''}`),args:[join(project,'out/bench/dist'),path],cwd:project,options:{stdio:'inherit',timeout:1200000,env:{...env,FORMA_PERFORMANCE_EVIDENCE:journal}}}
  :{file:node,args:[join(source,'e2e/performance/client/run.mjs'),'--browser','all'],cwd:source,options:{stdio:'inherit',timeout:600000,env:{...env,FORMA_BENCH_CORE:join(project,'node_modules/@getforma/core'),FORMA_BENCH_OUTPUT:path,FORMA_PERFORMANCE_EVIDENCE:journal}}};
}
function inventory(root){
 const rows=[];const walk=dir=>{for(const name of readdirSync(dir).sort()){const file=join(dir,name),stat=lstatSync(file);assert(!stat.isSymbolicLink(),`inventory cannot follow symlink: ${relative(root,file)}`);if(stat.isDirectory())walk(file);else{assert(stat.isFile());rows.push({file:relative(root,file),bytes:stat.size,sha256:hash(file)});}}};walk(root);return rows;
}
const SOURCES=['scripts/release-fixture-apps.mjs','scripts/release-performance.mjs','scripts/release-performance-contract.mjs','scripts/release-performance-baseline.mjs','scripts/release-performance-spec.mjs','scripts/release-performance-journal.mjs','e2e/performance/client/run.mjs','e2e/fixtures/apps/src/bin/measure.rs','e2e/fixtures/apps/src/performance_evidence.rs'];

export async function worker(options,work){
 assert(!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'no publishing credential is allowed');
 assert.equal(process.env.TMPDIR,join(work,'tmp'),'owned TMPDIR must be set before worker start');
 for(const key of Object.keys(process.env))assert(!key.startsWith('CARGO_PROFILE_RELEASE_'),'ordinary release profile required');
 assert(!process.env.RUSTFLAGS&&!process.env.CARGO_ENCODED_RUSTFLAGS,'ordinary release compiler flags required');
 const {source,packages:dir,output}=options;
 const expected=options['expected-source'];const git=(...args)=>command('git',args,source).trim();
 const sourceCheck=()=>{assert.equal(git('rev-parse','HEAD'),expected);assert.equal(git('status','--porcelain'),'','source checkout must remain clean');};
 sourceCheck();
 const set=json(join(dir,'release-set.json'));
 const authenticate=()=>{
  command('bash',['scripts/release-artifacts.sh','verify',dir,options['expected-ds11']],source,{stdio:'inherit'});
  command('bash',['scripts/release-artifacts.sh','match',dir,join(source,'Cargo.lock')],source,{stdio:'inherit'});
  assertSet(set,options,hash);
 };
 authenticate();assert.equal(hash(join(dir,'SHA256SUMS')),options['expected-ds11']);
 assert.equal(process.version,set.node,'Node differs from packed toolchain');
 assert.equal(command('rustc',['--version'],source).trim(),set.toolchain,'Rust differs from packed toolchain');
 assert.equal(command('npm',['--version'],source).trim(),set.npm,'npm differs from packed toolchain');
 const lock=hash(join(source,'package-lock.json'));const producerHashes=Object.fromEntries(SOURCES.map(p=>[p,hash(join(source,p))]));
 const from=path=>import(pathToFileURL(join(source,path)).href);
 const [{stageFixtureProject,assertResolvesInside},{performanceTarget},{readPerformanceBaseline},{validateNative,validateComparison},journals,{machineProfile}]=await Promise.all([
  from('scripts/release-fixture-apps.mjs'),from('scripts/release-performance.mjs'),from('scripts/release-performance-baseline.mjs'),from('scripts/release-performance-contract.mjs'),from('scripts/release-performance-journal.mjs'),from('scripts/release-measurements.mjs')]);
 const target=performanceTarget(set,{FORMA_PERFORMANCE_TARGET_TAG:options.target});assert(target);
 const before=new Date().toISOString();
 const journal=journals.createPerformanceJournal(join(output,'evidence'),{...PARTIAL,contract:'measured-v1',commit:expected,ds11:options['expected-ds11'],targetTag:target.tag,rehearsal:target.rehearsal,before,producerHashes,toolingLockSha256:lock});
 durable(join(output,'journal-location.json'),{journal});
 const record=(kind,value)=>journals.writePerformanceRecord(journal,kind,value);
 const phaseEnv={...process.env,CARGO_BUILD_JOBS:'3',CARGO_INCREMENTAL:'0'};
 const targetDir=join(work,'target');const cratesDir=join(work,'crates');
 let staged,stagingReport={};const checks=[];
 const test=async(name,fn)=>{console.log(`Continuation staging: ${name}`);const started=Date.now();await fn();checks.push({name,passed:true,seconds:(Date.now()-started)/1000});};
 const executable=()=>join(targetDir,'release',`fixture-measure${process.platform==='win32'?'.exe':''}`);
 const snapshot=label=>durable(join(output,`host-${label}.json`),{at:new Date().toISOString(),idleClaim:false,ps:command('ps',['-eo','pid,ppid,%cpu,etime,comm'],source)});
 const sourceHashes=()=>{sourceCheck();assert.equal(hash(join(source,'package-lock.json')),lock);for(const [file,digest]of Object.entries(producerHashes))assert.equal(hash(join(source,file)),digest);};
 const result=await executePhases({
  baseline:()=>readPerformanceBaseline({currentTag:target.tag,before}),record,
  stage:async()=>{
   for(const p of set.packages.filter(p=>p.registry==='crates')){
    const dest=join(cratesDir,p.name);mkdirSync(dest,{recursive:true});const file=join(dir,p.file);
    const names=command('tar',['-tzf',file],source).trim().split('\n');assert(names.every(n=>!n.startsWith('/')&&!n.split('/').includes('..')),'unsafe archive path');
    command('tar',['-xzf',file,'-C',dest,'--strip-components=1'],source);
    const manifest=join(dest,'Cargo.toml');const original=readFileSync(manifest,'utf8');writeFileSync(manifest,original+'\n[workspace]\n');
    record(`crate-${p.name}-isolation`,{archiveSha256:p.sha256,originalManifestSha256:sha(original),isolatedManifestSha256:hash(manifest)});
   }
   staged=await stageFixtureProject({set,dir,cratesDir,targetDir,test,report:stagingReport});
   assert(inside(work,realpathSync(staged.project)),'staging escaped owned work root');
   const core=join(staged.project,'node_modules/@getforma/core');
   const resolution=assertResolvesInside(staged.project,{'@getforma/core':['alien-signals']});
   record('staging',{...stagingReport,checks,resolution,packedResolution:staged.resolution,signatures:staged.signatures,npmLockSha256:staged.npmLockSha256,cargoLockSha256:staged.cargoLockSha256});
   record('packed-core-inventory',inventory(core));
  },
  build:()=>{
   const cargoLock=join(staged.project,'Cargo.lock'),before=hash(cargoLock);
   command('cargo',['build','--release','--locked'],staged.project,{stdio:'inherit',timeout:600000,env:{...phaseEnv,CARGO_TARGET_DIR:targetDir}});
   assert.equal(hash(cargoLock),before);record('release-build',{cargoLockSha256:before,nativeExecutableSha256:hash(executable()),profile:'cargo build --release --locked; ordinary application release'});
   record('native-products',inventory(join(staged.project,'out/bench/dist')));
  },
  healthy:()=>journals.readPerformanceJournal(journal,journals.EVIDENCE_LIMITS,{verifyHashes:true}),
  produce:phase=>{
   sourceHashes();snapshot(`before-${phase}`);const path=join(journal,`${phase}-report.json`);
   const invocation=campaignCommand({phase,source,project:staged.project,targetDir,journal,env:phaseEnv});
   command(invocation.file,invocation.args,invocation.cwd,invocation.options);
   snapshot(`after-${phase}`);return json(path);
  },
  validate:(phase,raw,baseline)=>{
   if(phase==='native')return validateNative(raw,baseline);
   validateComparison(raw);assert.equal(raw.environment.git_commit,expected);assert.equal(raw.environment.git_dirty,false);
  },
  metadata:()=>{
   sourceHashes();authenticate();assert.equal(hash(join(dir,'SHA256SUMS')),options['expected-ds11']);
   assert.equal(hash(join(staged.project,'package-lock.json')),staged.npmLockSha256);assert.equal(hash(join(staged.project,'Cargo.lock')),staged.cargoLockSha256);
   return {source:expected,ds11:options['expected-ds11'],targetTag:target.tag,rehearsal:target.rehearsal,finishedAt:new Date().toISOString(),producerHashes,toolingLockSha256:lock,npmLockSha256:staged.npmLockSha256,cargoLockSha256:staged.cargoLockSha256,nativeExecutableSha256:hash(executable()),machine:{...machineProfile({rustc:set.toolchain,npm:set.npm}),profile:'independent packed native/client continuation; ordinary release; no decoder/mobile acceptance'}};
  },
  complete:value=>{
   // The durable summary is only a prepared result until the journal's marker exists.
   // There is no fallible metadata/file assembly after that marker.
   durable(join(output,'result.json'),{...value,journal,journalCompletionRequired:true});
   journals.completePerformanceJournal(journal,value);
  },
  failure:value=>durable(join(output,'failed-attempt.json'),{...value,journal}),
  cleanup:()=>{ /* Launcher owns cleanup, including staging failures before return. */ },
 });
 return Object.values(result.outcomes).every(x=>x.validated)?0:2;
}
