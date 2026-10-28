import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, makePlan, parseOptions, acquire, writeJSON, sourceIdentity, seal, verify, safePath, seededOrder } from '../src/session.mjs';
import { executeRun } from '../src/cli.mjs';
import { applyUpdate, dependencyInventory } from '../src/updates.mjs';
function fixture(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gp-session-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('plan keeps exact current candidate, actual order and complete event selection',()=>{
  const p=makePlan(ROOT,{suite:'server','forma-ref':'current',events:'1,5-7'});
  assert.match(p.formaRef,/^[a-f0-9]{40}$/);assert.ok(p.command.includes(p.formaRef));
  assert.deepEqual(p.events,['sprint','fuel','grid','weight']);
  assert.deepEqual(p.cars,makePlan(ROOT,{suite:'server','forma-ref':'current',events:'1,5-7'}).cars);
  assert.notDeepEqual(seededOrder(['a','b','c','d'],1),seededOrder(['a','b','c','d'],2));
});
test('invalid CLI options, accidental host qualification and unsupported selectors fail closed',()=>{
  for(const o of [{suite:'signals'},{suite:'unknown'},{profile:'oops'},{cars:'forma,forma'},{events:'8-1'},{events:'0'},{seed:'NaN'},{baseline:'false'},{id:'../bad'},{_:['unplanned']},{suite:'client',cars:'forma'},{'forma-ref':'main'}])assert.throws(()=>makePlan(ROOT,o));
  assert.throws(()=>parseOptions(['--suite','server','--suite','client']));
});
test('locks never silently steal ownership or traverse a symlink',t=>{
  const root=fixture(t),release=acquire(root,'one');
  assert.throws(()=>acquire(root,'two'),/owns/);release();assert.ok(!fs.existsSync(path.join(root,'.grandprix/active.json')));
  const out=fixture(t);fs.symlinkSync(out,path.join(root,'runs'));assert.throws(()=>safePath(root,'runs/anything'),/Symlink/);
  assert.throws(()=>safePath(root,'../outside'),/escapes/);
});
test('source identity separates dependency updates from unchanged workload',t=>{
  const root=fixture(t);writeJSON(path.join(root,'signals-race/package.json'),{dependencies:{x:'1.0.0'}});
  fs.writeFileSync(path.join(root,'signals-race/run.mjs'),'original');const a=sourceIdentity(root);
  writeJSON(path.join(root,'signals-race/package.json'),{dependencies:{x:'2.0.0'}});const b=sourceIdentity(root);
  assert.equal(a.testHash,b.testHash);assert.notEqual(a.dependencyHash,b.dependencyHash);
  fs.writeFileSync(path.join(root,'signals-race/run.mjs'),'changed');assert.notEqual(b.testHash,sourceIdentity(root).testHash);
});
test('integrity detects changed, missing and newly added retained evidence',t=>{
  const root=fixture(t);writeJSON(path.join(root,'raw/signal.json'),{samples:[1,2,3]});seal(root);assert.equal(verify(root).ok,true);
  writeJSON(path.join(root,'raw/signal.json'),{samples:[1,2]});assert.equal(verify(root).ok,false);
  fs.unlinkSync(path.join(root,'raw/signal.json'));assert.equal(verify(root).ok,false);
  fs.writeFileSync(path.join(root,'extra.txt'),'added');assert.ok(verify(root).problems.some(p=>p.includes('unsealed')));
});
test('a full failed attempt retains log, manifest, report, integrity and releases lock',async t=>{
  const root=fixture(t);const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'config/laboratory.json')));
  cfg.minimumFreeBytes=0;writeJSON(path.join(root,'config/laboratory.json'),cfg);
  writeJSON(path.join(root,'signals-race/node_modules/@getforma/core/package.json'),{version:'test'});
  fs.writeFileSync(path.join(root,'signals-race/run.mjs'),"console.error('deliberate worker failure');process.exitCode=4;");
  const result=await executeRun(root,{suite:'signals',mode:'diagnostic',cars:'forma',id:'failure-control'});
  assert.equal(result.exitCode,4);assert.equal(result.manifest.status,'failed');assert.equal(result.manifest.quality,'diagnostic');
  assert.match(fs.readFileSync(path.join(result.dir,'run.log'),'utf8'),/deliberate worker failure/);
  assert.equal(verify(result.dir).ok,true);assert.ok(!fs.existsSync(path.join(root,'.grandprix/active.json')));
  assert.throws(()=>acquire(root,'../unsafe'));await assert.rejects(()=>executeRun(root,{suite:'signals',mode:'diagnostic',id:'failure-control'}),/already exists/);
});
test('staged updates reject drift and never modify a stale original',t=>{
  const root=fixture(t),relative='signals-race/package.json',id='update-12345678-1234-1234-1234-123456789012';
  writeJSON(path.join(root,relative),{dependencies:{foo:'1.0.0'}});writeJSON(path.join(root,'signals-race/package-lock.json'),{packages:{'node_modules/foo':{version:'1.0.0'}}});
  assert.equal(dependencyInventory(root)[0].resolved,'1.0.0');
  writeJSON(path.join(root,'updates',id,'update.json'),{id,status:'staged',changes:[{path:relative,beforeSha256:'wrong',afterSha256:'wrong'}]});
  writeJSON(path.join(root,'updates',id,relative),{dependencies:{foo:'2.0.0'}});
  assert.throws(()=>applyUpdate(root,id),/changed/);assert.equal(JSON.parse(fs.readFileSync(path.join(root,relative))).dependencies.foo,'1.0.0');
});
test('integrity covers nested driver logs and rejects added evidence symlinks',t=>{
  const root=fixture(t);writeJSON(path.join(root,'artifacts/logs/a.json'),{error:'retained'});seal(root);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root,'integrity.json'))).files['artifacts/logs/a.json']);
  fs.symlinkSync('/tmp',path.join(root,'linked'));assert.equal(verify(root).ok,false);assert.throws(()=>seal(root),/symlink/);
});
test('dangling symlink destination is refused before a file can be written outside the laboratory',t=>{
  const root=fixture(t);fs.symlinkSync(path.join(root,'missing-outside'),path.join(root,'runs'));
  assert.throws(()=>safePath(root,'runs/new/manifest.json'),/Symlink/);
});
