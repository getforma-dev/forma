import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setupInputs, seedReplay, finishSetup } from './release-burn-in-setup.mjs';
import { digest } from './release-set.mjs';
import { FUZZ_TARGETS } from './release-burn-in-report.mjs';
const save=(path,value)=>writeFileSync(path,JSON.stringify(value));
function candidate(t) {
 const dir=mkdtempSync(join(tmpdir(),'burn-in-setup-input-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=join(dir,'source'),directory=join(dir,'archives');mkdirSync(root);mkdirSync(directory);
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','--quiet');git('config','user.name','Finite control');git('config','user.email','finite@example.invalid');
 writeFileSync(join(root,'source.js'),'exact source\n');git('add','.');git('commit','--quiet','-m','source');
 const commit=git('rev-parse','HEAD'),version='3.0.0-dev';
 const packages=[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name,path:`crates/${name}`})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`,path:`packages/${name}`}))].map(p=>{
   const file=`${p.name.replace('@','').replace('/','-')}-${version}.${p.registry==='npm'?'tgz':'crate'}`;
   writeFileSync(join(directory,file),`synthetic archive ${p.name}`);
   return {...p,version,file,sha256:digest(join(directory,file))};
 });
 const set={schema:1,dryRun:true,tag:'integration-dry-run',commit,contracts:{sourceTemplates:'islands-v1',stateBlock:'declared-v1'},packages};
 save(join(directory,'release-set.json'),set);
 const args={directory,recordSha256:digest(join(directory,'release-set.json')),commit,root};
 return {args,set,root,directory};
}
test('setup requires exact current dry-pack source and seven original archive hashes',t=>{
 const f=candidate(t);assert.equal(setupInputs(f.args).packages.length,7);
 assert.throws(()=>setupInputs({...f.args,commit:'a'.repeat(40)}),/source differs/);
 assert.throws(()=>setupInputs({...f.args,recordSha256:'b'.repeat(64)}),/digest differs/);
 save(join(f.directory,'release-set.json'),{...f.set,dryRun:false});
 assert.throws(()=>setupInputs({...f.args,recordSha256:digest(join(f.directory,'release-set.json'))}),/dry-pack/);
 save(join(f.directory,'release-set.json'),f.set);
 writeFileSync(join(f.directory,f.set.packages[0].file),'changed archive');
 assert.throws(()=>setupInputs(f.args),/archive digest differs/);
});
test('1000 completed seed inputs may take zero seconds and always earn zero soak credit',()=>{
 assert.deepEqual(seedReplay('Done 1000 runs in 0 second(s)\n'),{inputs:1000,seconds:0,activeNanoseconds:'0'});
 for(const text of ['#1000 progress','Done 999 runs in 1 second(s)','Done 1000 runs in 31 second(s)','Done 1000 runs in 0 second(s)\nDone 1000 runs in 0 second(s)'])assert.throws(()=>seedReplay(text));
});
function completed(t) {
 const dir=mkdtempSync(join(tmpdir(),'burn-in-setup-final-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const evidence=join(dir,'evidence'),ownership=join(dir,'ownership'),work=join(dir,'work');for(const path of [evidence,ownership,work])mkdirSync(path);
 const seeds=FUZZ_TARGETS.map(target=>{const log=join(evidence,`${target}.log`);writeFileSync(log,'Done 1000 runs in 0 second(s)\n');return {target,inputs:1000,seconds:0,activeNanoseconds:'0',logSha256:digest(log)};});
 const report={contract:'rc-burn-in-setup-v1',rehearsal:true,rcAuthenticated:false,activeNanoseconds:'0',burnInPassed:false,releaseAccepted:false,setupPassed:true,faults:[],work,seeds};
 const proof={complete:true,exitCode:0,faults:[],cleanup:{complete:true,remainingOwnedPids:[],failures:[]}};
 save(join(evidence,'setup.json'),report);save(join(ownership,'supervisor.json'),proof);
 return {evidence,ownership,work,report,proof};
}
test('setup completion requires raw seed records and completed ownership, and never claims RC acceptance',t=>{
 const f=completed(t);finishSetup(f);assert.equal(existsSync(f.work),false);
 const report=JSON.parse(readFileSync(join(f.evidence,'complete.json')));assert.equal(report.complete,true);assert.equal(report.burnInPassed,false);assert.equal(report.rcAuthenticated,false);assert.equal(report.activeNanoseconds,'0');
 for(const mutate of [f=>{f.proof.cleanup.complete=false;save(join(f.ownership,'supervisor.json'),f.proof);},f=>writeFileSync(join(f.evidence,'parse_raw.log'),'same length tampered evidence'),f=>{f.report.seeds.pop();save(join(f.evidence,'setup.json'),f.report);}]){
   const bad=completed(t);mutate(bad);assert.throws(()=>finishSetup(bad));assert.equal(existsSync(bad.work),true);assert.equal(existsSync(join(bad.evidence,'complete.json')),false);
 }
});
