import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBurnInReport, CONTRACT, MIN_ACTIVE_NS, FUZZ_TARGETS, ENGINES, SKEW_CHECKS, readFuzzCompletion} from './release-burn-in-report.mjs';
const H = 'a'.repeat(64), COMMIT = 'b'.repeat(40);
function fixture() {
  const ids = [['crates','forma-ir'],['crates','forma-ir-derive'],['crates','forma-server'],['npm','@getforma/core'],['npm','@getforma/compiler'],['npm','@getforma/build'],['npm','@getforma/create-app']];
  const expected = {rcTag:'v3.0.0-rc.1',sourceCommit:COMMIT,ds12Sha256:H,p17EvidenceSha256:H,d14EvidenceSha256:H,harnessSha256:H,packages:ids.map(([registry,name],i)=>({registry,name,version:'3.0.0-rc.1',file:`archive-${i}.tgz`,bytes:100+i,sha256:H})),hostileCaseIds:['native-call/control','confined-read/control'],fixtureCheckIds:['minimal/activation','dashboard/activation','Counter/update','indexed/set']};
  const taskIds=[...FUZZ_TARGETS.map(t=>`fuzz:${t}`),'hostile',...ENGINES.map(e=>`skew:${e}`),'fixtures'];
  let time=0n;
  const rounds=Array.from({length:15},(_,round)=>{
    const startedNs=String(time);
    const tasks=taskIds.map((id,index)=>{
      const startedNs=String(time);time+=60_000_000_000n;
      const task={id,startedNs,finishedNs:String(time),exitCode:0,complete:true,faults:[],reportSha256:H,activeNanoseconds:id.startsWith('fuzz:')?'60000000000':'0'};
      if(id.startsWith('fuzz:'))Object.assign(task,{executions:100,fuzzSeconds:60,seed:round*4+index,findings:0});
      else if(id==='hostile')Object.assign(task,{completeMatrix:true,caseIds:[...expected.hostileCaseIds]});
      else if(id.startsWith('skew:'))task.checks=[...SKEW_CHECKS];
      else task.checkIds=[...expected.fixtureCheckIds];
      return task;
    });
    const row={index:round+1,complete:true,startedNs,finishedNs:String(time),tasks};
    time+=10_000_000_000n; // A legitimate >5s orchestration boundary is not a new policy failure.
    return row;
  });
  const report={contract:CONTRACT,...structuredClone(expected),harnessCommit:COMMIT,complete:true,zeroFaults:true,faults:[],cleanup:{complete:true,remainingOwnedPids:[],failures:[]},rounds,startedNs:'0',finishedNs:rounds.at(-1).finishedNs,activeNanoseconds:String(MIN_ACTIVE_NS),orchestrationNanoseconds:String(15n*5n*60_000_000_000n+14n*10_000_000_000n)};
  delete report.hostileCaseIds;delete report.fixtureCheckIds;
  return {report,expected};
}
const refuses=edit=>{const {report,expected}=fixture();edit(report,expected);assert.throws(()=>validateBurnInReport(report,expected));};
test('exact hour of complete ordered workloads validates content only, never hosted attestation',()=>{
 const {report,expected}=fixture();const result=validateBurnInReport(report,expected);
 assert.equal(result.contentValid,true);assert.equal(result.activeNanoseconds,String(MIN_ACTIVE_NS));assert.equal(result.orchestrationNanoseconds,'4640000000000');assert.equal(result.hostedAttestationVerified,false);assert.equal(result.releaseAccepted,false);
});
test('3599 completed fuzz seconds refuse even with hours of other workloads',()=>refuses(r=>{const t=r.rounds.at(-1).tasks[0];t.fuzzSeconds=59;t.activeNanoseconds='59000000000';r.activeNanoseconds=String(MIN_ACTIVE_NS-1_000_000_000n);r.orchestrationNanoseconds=String(BigInt(r.orchestrationNanoseconds)+1_000_000_000n);}));
test('wall-clock padding and forged active total cannot replace actual work',()=>{
 refuses(r=>{r.rounds[0].tasks[0].finishedNs='1000000000';});
 refuses(r=>{r.activeNanoseconds=String(MIN_ACTIVE_NS+1n);});
});
test('RC source and all seven original archives must match independently supplied inputs',()=>{
 for(const edit of [r=>r.rcTag='v3.0.0',r=>r.sourceCommit='c'.repeat(40),r=>r.harnessCommit='c'.repeat(40),r=>r.packages.pop(),r=>r.packages[0]=structuredClone(r.packages[1]),r=>r.packages[0].sha256='c'.repeat(64),r=>r.packages[0].bytes++,r=>r.packages[0].file='../escape'])refuses(edit);
});
test('all prerequisite hashes and versioned contract are mandatory',()=>{
 refuses(r=>r.contract='forma-rc-burn-in-v2');
 for(const key of ['ds12Sha256','p17EvidenceSha256','d14EvidenceSha256','harnessSha256'])refuses(r=>delete r[key]);
});
test('rounds and workload schedules cannot be missing, duplicated or reordered',()=>{
 for(const edit of [r=>r.rounds=[],r=>r.rounds[1].index=3,r=>r.rounds[1].index=1,r=>r.rounds[0].tasks.pop(),r=>r.rounds[0].tasks.reverse(),r=>r.rounds[0].tasks[1]=structuredClone(r.rounds[0].tasks[0])])refuses(edit);
});
test('overlap, noninteger timestamps and falsely classified orchestration refuse',()=>{
 refuses(r=>r.rounds[0].tasks[1].startedNs='0');refuses(r=>r.startedNs=0);refuses(r=>r.orchestrationNanoseconds='0');refuses(r=>r.rounds[1].startedNs='0');
});
test('empty fuzz, reused seed, finding or child fault refuses',()=>{
 for(const edit of [t=>t.executions=0,t=>t.seed=-1,t=>t.findings=1,t=>t.exitCode=1,t=>t.complete=false,t=>t.faults.push('sanitizer')])refuses(r=>edit(r.rounds[0].tasks[0]));
 refuses(r=>r.rounds[1].tasks[0].seed=r.rounds[0].tasks[0].seed);
});
test('hostile matrix, all three engines and all eleven skew checks stay complete',()=>{
 refuses(r=>r.rounds[0].tasks[4].completeMatrix=false);refuses(r=>r.rounds[0].tasks[4].caseIds.pop());
 for(const index of [5,6,7])refuses(r=>r.rounds[0].tasks[index].checks.pop());
 refuses(r=>r.rounds[0].tasks[5].checks[1]=r.rounds[0].tasks[5].checks[0]);
});
test('required fixture checks cannot disappear or duplicate',()=>{
 refuses(r=>r.rounds[0].tasks[8].checkIds.pop());refuses(r=>r.rounds[0].tasks[8].checkIds.push(r.rounds[0].tasks[8].checkIds[0]));
});
test('incomplete campaign, pending cleanup, surviving PID or error never passes',()=>{
 for(const edit of [r=>r.complete=false,r=>r.zeroFaults=false,r=>r.faults.push('interrupted'),r=>r.cleanup.complete=false,r=>r.cleanup.remainingOwnedPids.push(42),r=>r.cleanup.failures.push('ownership unproved'),r=>r.rounds[1].complete=false])refuses(edit);
});

test('only one completed positive-input bounded libFuzzer summary earns time',()=>{
 assert.deepEqual(readFuzzCompletion('Done 1234 runs in 60 second(s)\n','60500000000'),{executions:1234,fuzzSeconds:60,activeNanoseconds:'60000000000',findings:0});
 for(const log of ['#1000 pulse', 'Done 0 runs in 60 second(s)', 'Done 100 runs in 0 second(s)', 'Done 100 runs in 121 second(s)', 'Done 1 runs in 60 second(s)\nDone 2 runs in 60 second(s)'])assert.throws(()=>readFuzzCompletion(log,'200000000000'));
 assert.throws(()=>readFuzzCompletion('Done 1234 runs in 60 second(s)','59999999999'));
});
test('non-fuzz work and unproved subprocess time cannot earn active credit',()=>{
 refuses(r=>r.rounds[0].tasks[4].activeNanoseconds='1');
 refuses(r=>r.rounds[0].tasks[0].fuzzSeconds=61);
});
