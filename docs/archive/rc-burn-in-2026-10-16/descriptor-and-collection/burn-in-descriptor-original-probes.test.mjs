import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldDescriptor } from './release-burn-in-stage.mjs';
import { digest } from './release-set.mjs';
function fixture(t, dryRun) {
 const archives=mkdtempSync(join(tmpdir(),'burn-in-descriptor-'));t.after(()=>rmSync(archives,{recursive:true,force:true}));
 const version='3.0.0-rc.1',commit='a'.repeat(40);
 const packages=[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name,path:`crates/${name}`})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`,path:`packages/${name}`}))].map(item=>{
  const file=`${item.name.replace('@','').replace('/','-')}-${version}.${item.registry==='npm'?'tgz':'crate'}`;
  writeFileSync(join(archives,file),`original ${item.name}`);return {...item,version,file,sha256:digest(join(archives,file))};
 });
 const set={schema:1,dryRun,tag:dryRun?'candidate-dry-run':'v3.0.0-rc.1',commit,contracts:{sourceTemplates:'islands-v1',stateBlock:'declared-v1'},packages};
 return {set,archives};
}
test('published RC shape creates a clearly derived descriptor from authenticated fields, without fabricating original DS11',t=>{
 const f=fixture(t,false);f.set.measurements={originalDs12:'retained separately'};
 assert(!existsSync(join(f.archives,'release-set.json')));
 const proof=scaffoldDescriptor(f);assert.equal(proof.kind,'derived-authenticated-staging-view');
 assert.equal(digest(proof.path),proof.sha256);
 const derived=JSON.parse(readFileSync(proof.path));const {measurements,...expected}=f.set;
 assert.deepEqual(derived,expected);assert.equal(f.set.measurements.originalDs12,'retained separately');
});
test('dry-pack descriptor keeps its exact noncanonical bytes and mismatched views refuse without overwrite',t=>{
 const f=fixture(t,true),path=join(f.archives,'release-set.json'),bytes=JSON.stringify(f.set)+'  \n';writeFileSync(path,bytes);
 assert.equal(scaffoldDescriptor(f).kind,'existing-original-descriptor');assert.equal(readFileSync(path,'utf8'),bytes);
 const changed=structuredClone(f);changed.set.tag='other-dry-run';
 assert.throws(()=>scaffoldDescriptor(changed),/descriptor differs/);assert.equal(readFileSync(path,'utf8'),bytes);
 writeFileSync(join(f.archives,f.set.packages[0].file),'tampered');
 assert.throws(()=>scaffoldDescriptor(f),/archive digest differs/);assert.equal(readFileSync(path,'utf8'),bytes);
});
