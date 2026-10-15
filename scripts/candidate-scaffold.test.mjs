import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_HEAVY, requireHeavyResults, validateCandidate } from './candidate-scaffold.mjs';
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
  assert.equal(requireHeavyResults(report(cases)).heavy,18);
  for(const status of ['pending','skipped','failed']) assert.throws(()=>requireHeavyResults(report(cases.map((p,i)=>i? p:{...p,status}))));
  assert.throws(()=>requireHeavyResults(report(cases.slice(1))),/did not run/);
  assert.throws(()=>requireHeavyResults(report([...cases,cases[0]])),/exactly once/);
  assert.throws(()=>requireHeavyResults({...report(cases),success:false}),/suite failed/);
});
