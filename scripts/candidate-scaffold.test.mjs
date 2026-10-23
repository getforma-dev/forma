import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_HEAVY, requireHeavyResults, validateCandidate, judgeCandidate } from './candidate-scaffold.mjs';
import { evaluateN8, n8Name, N8_TEMPLATES } from './n8-size-start.mjs';
import { digest, save, CRATES, NPM } from './release-set.mjs';

test('candidate authentication refuses changed record, changed archive, other source and mixed identity before extraction', () => {
  const dir = mkdtempSync(join(tmpdir(),'forma candidate auth ')), commit='a'.repeat(40), version='3.0.0-dev';
  try {
    const packages = [...CRATES.map(name=>({name,registry:'crates',path:`crates/${name}`})),...NPM.map(name=>({name:`@getforma/${name}`,registry:'npm',path:`packages/${name}`}))].map(p=>{
      const file=`${p.name.replace('@','').replace('/','-')}-${version}.${p.registry==='npm'?'tgz':'crate'}`;
      writeFileSync(join(dir,file),p.name); return {...p,version,file,sha256:digest(join(dir,file))};
    });
    const set={schema:1,commit,contracts:{sourceTemplates:'declared-v1'},packages}, record=join(dir,'release-set.json');
    save(record,set); const hash=digest(record);
    assert.deepEqual(validateCandidate(dir,hash,commit),set);
    save(record,{...set,contracts:{sourceTemplates:'islands-v1',stateBlock:'declared-v1'}});
    assert.equal(validateCandidate(dir,digest(record),commit).contracts.sourceTemplates,'islands-v1');
    save(record,{...set,contracts:{sourceTemplates:'islands-v1',stateBlock:null}});
    assert.throws(()=>validateCandidate(dir,digest(record),commit),/declared state/);
    save(record,{...set,contracts:{sourceTemplates:'unknown-v99'}});
    assert.throws(()=>validateCandidate(dir,digest(record),commit),/supported source/);
    save(record,set);
    assert.throws(()=>validateCandidate(dir,'0'.repeat(64),commit),/record digest/);
    assert.throws(()=>validateCandidate(dir,hash,'b'.repeat(40)),/source/);
    writeFileSync(join(dir,packages[0].file),'changed');
    assert.throws(()=>validateCandidate(dir,hash,commit),/archive digest/);
    writeFileSync(join(dir,packages[0].file),packages[0].name);
    for (const patch of [{version:'3.0.1-dev'}, {name:'unexpected'}, {path:'../outside'}, {file:'../outside.crate'}]) {
      save(record,{...set,packages:set.packages.map((p,i)=>i===2?{...p,...patch}:p)});
      assert.throws(()=>validateCandidate(dir,digest(record),commit));
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('candidate gate refuses omitted, skipped and failed existing heavy cases even if the process reports success', () => {
  const cases=REQUIRED_HEAVY.map(title=>({title,status:'passed',ancestorTitles:['scaffolded projects build (FORMA_SCAFFOLD_E2E=1)']}));
  const report=assertionResults=>({success:true,testResults:[{assertionResults}]});
  assert.equal(requireHeavyResults(report(cases)).heavy,19);
  for(const status of ['pending','skipped','failed']) assert.throws(()=>requireHeavyResults(report(cases.map((p,i)=>i? p:{...p,status}))));
  assert.throws(()=>requireHeavyResults(report(cases.slice(1))),/did not run/);
  assert.throws(()=>requireHeavyResults(report([...cases,cases[0]])),/exactly once/);
  assert.throws(()=>requireHeavyResults({...report(cases),success:false}),/suite failed/);
});

test('the report verdict holds N8 on Linux: a missing template, an over-ceiling row and a forged flag are refused; other platforms are not gated', () => {
  const cases=REQUIRED_HEAVY.map(title=>({title,status:'passed',ancestorTitles:['scaffolded projects build (FORMA_SCAFFOLD_E2E=1)']}));
  const raw={success:true,testResults:[{assertionResults:cases}]};
  const samples=(value)=>Array.from({length:15},()=>value);
  const row=(template,patch={})=>({name:n8Name(template),...evaluateN8({template,formaBytes:5_000_000,baselineBytes:2_000_000,formaStartMs:samples(12),baselineStartMs:samples(9),...patch})});
  const report=(platform,observations)=>({platform,observations});
  const good=N8_TEMPLATES.map(template=>row(template));
  assert.equal(judgeCandidate(report('linux',good),raw).passed,true);
  assert.throws(()=>judgeCandidate(report('linux',[]),raw),/N8 minimal: .*found 0/);
  assert.throws(()=>judgeCandidate(report('linux',good.slice(1)),raw),/N8 minimal: .*found 0/);
  assert.throws(()=>judgeCandidate(report('linux',[row('minimal',{formaBytes:9_000_000}),good[1]]),raw),/size: Forma adds 7,000,000 bytes/);
  assert.throws(()=>judgeCandidate(report('linux',[{...row('minimal',{formaStartMs:samples(300)}),passed:true,startOk:true},good[1]]),raw),/start: Forma adds/);
  const refused=report('linux',[]); assert.throws(()=>judgeCandidate(refused,raw)); assert.equal(refused.passed,undefined);
  for(const platform of ['win32','darwin']) assert.equal(judgeCandidate(report(platform,[]),raw).passed,true);
  // The heavy cases still decide first.
  assert.throws(()=>judgeCandidate(report('linux',good),{...raw,success:false}),/suite failed/);
});
