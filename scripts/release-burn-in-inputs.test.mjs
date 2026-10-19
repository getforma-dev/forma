import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { boundedResponse, namedAsset, verifyAssetBytes, verifyRegistryArchive, verifyRun, releaseReader, API } from './release-burn-in-inputs.mjs';
const bytes = Buffer.from('actual original archive'), sha = createHash('sha256').update(bytes).digest('hex');
const asset = {name:'release-record.json',url:'https://api.github.com/repos/getforma-dev/forma/releases/assets/123',digest:`sha256:${sha}`,size:bytes.length};
test('release asset identity and actual bytes both authenticate',()=>{
 assert.equal(namedAsset({assets:[asset]},asset.name),asset);assert.equal(verifyAssetBytes(asset,bytes),bytes);
 for(const patch of [{digest:'sha256:bad'},{size:0},{url:'https://example.com/123'}])assert.throws(()=>namedAsset({assets:[{...asset,...patch}]},asset.name));
 assert.throws(()=>namedAsset({assets:[asset,asset]},asset.name));assert.throws(()=>verifyAssetBytes(asset,Buffer.from('wrong')));
});
test('registry and DS12 checksums must independently agree with original archive',()=>{
 const item={registry:'npm',name:'@getforma/core',version:'3.0.0-rc.1',sha256:sha};
 const published={...item,metadata:{dist:{integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}}};
 assert.equal(verifyRegistryArchive(item,published,bytes).bytes,bytes.length);
 assert.throws(()=>verifyRegistryArchive(item,{...published,metadata:{dist:{integrity:'sha512-wrong'}}},bytes));
 assert.throws(()=>verifyRegistryArchive({...item,sha256:'a'.repeat(64)},published,bytes));
 const crate={...item,registry:'crates',name:'forma-ir'};assert.equal(verifyRegistryArchive(crate,{...crate,metadata:{version:{checksum:sha}}},bytes).bytes,bytes.length);
});
test('hosted attestation refuses other source/tag/event/workflow/unsuccessful run',()=>{
 const expected={commit:'a'.repeat(40),tag:'v3.0.0-rc.1',workflow:'.github/workflows/rc-burn-in.yml',event:'workflow_dispatch'};
 const row={repository:{full_name:'getforma-dev/forma'},head_sha:expected.commit,head_branch:expected.tag,path:expected.workflow,event:expected.event,status:'completed',conclusion:'success',id:1,run_attempt:1};
 verifyRun(row,expected);
 for(const patch of [{head_sha:'b'.repeat(40)},{head_branch:'main'},{path:'.github/workflows/ci.yml'},{event:'pull_request'},{conclusion:'failure'},{status:'in_progress'},{run_attempt:0}])assert.throws(()=>verifyRun({...row,...patch},expected));
});
test('streamed download refuses oversized declared or actual response and HTTP failure',async()=>{
 assert.deepEqual(await boundedResponse(new Response(bytes),bytes.length),bytes);
 await assert.rejects(()=>boundedResponse(new Response(bytes),bytes.length-1));
 await assert.rejects(()=>boundedResponse(new Response(bytes,{headers:{'content-length':'999'}}),100));
 await assert.rejects(()=>boundedResponse(new Response('no',{status:404}),100));
});

// The larger reviewed transport limit applies only to DS12, not every asset.
test('DS12 has an explicit transport allowance while other release metadata stays bounded', async () => {
 const { RELEASE_RECORD_MAX_BYTES } = await import('./release-record-limits.mjs');
 const large = {...asset, size: 9*1024*1024};
 assert.throws(()=>namedAsset({assets:[large]},large.name));
 assert.equal(namedAsset({assets:[large]},large.name,RELEASE_RECORD_MAX_BYTES),large);
 assert.throws(()=>namedAsset({assets:[{...large,size:RELEASE_RECORD_MAX_BYTES+1}]},large.name,RELEASE_RECORD_MAX_BYTES));
});

test('record-only retry retains the earlier successful verify proof but never accepts a failed verify', async () => {
 const { downloadRunEvidence, API } = await import('./release-burn-in-inputs.mjs');
 const commit='a'.repeat(40),tag='v3.0.0-rc.1';
 const run={repository:{full_name:'getforma-dev/forma'},head_sha:commit,head_branch:tag,path:'.github/workflows/release.yml',event:'push',status:'completed',conclusion:'success',id:42,run_attempt:2};
 const producer={...run,run_attempt:1,conclusion:'failure'};
 const jobs={total_count:1,jobs:[{name:'verify',conclusion:'success',steps:[{name:'P17 packed corpus and both templates',conclusion:'success'}]}]};
 const args={runId:42,runAttempt:1,name:'release-p17',manifestSha256:'b'.repeat(64),destination:'/never-created',commit,tag,workflow:run.path,event:'push',requiredJob:'verify',requiredStep:'P17 packed corpus and both templates'};
 async function attempt({latest=run,prior=producer,rows=jobs,...patch}={}) {
   let reachedArtifact=false;
   const get=async url=>{
     if(url===`${API}/actions/runs/42`)return latest;
     if(url===`${API}/actions/runs/42/attempts/1`)return prior;
     if(url===`${API}/actions/runs/42/attempts/1/jobs?per_page=100`)return rows;
     if(url===`${API}/actions/runs/42/artifacts?per_page=100`){reachedArtifact=true;throw Error('authenticated producer reached artifact');}
     throw Error('unexpected API read');
   };
   await assert.rejects(downloadRunEvidence({...args,...patch,get}));
   return reachedArtifact;
 }
 assert.equal(await attempt(),true);
 assert.equal(await attempt({latest:{...run,conclusion:'failure'}}),false);
 assert.equal(await attempt({latest:{...run,run_attempt:1}}),false);
 assert.equal(await attempt({prior:{...producer,head_sha:'c'.repeat(40)}}),false);
 assert.equal(await attempt({rows:{...jobs,jobs:[{...jobs.jobs[0],conclusion:'failure'}]}}),false);
 assert.equal(await attempt({rows:{...jobs,jobs:[{...jobs.jobs[0],steps:[{...jobs.jobs[0].steps[0],conclusion:'failure'}]}]}}),false);
 // The permission is specific to P17. A failed exact burn-in attempt refuses.
 assert.equal(await attempt({name:'rc-burn-in',workflow:'.github/workflows/rc-burn-in.yml',event:'workflow_dispatch',requiredJob:'burn-in',requiredStep:'Continuous packed RC workloads',prior:{...producer,path:'.github/workflows/rc-burn-in.yml',event:'workflow_dispatch'}}),false);
});


test('Actions artifact downloads negotiate JSON redirects while release assets negotiate binary', async () => {
 const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
 const { tmpdir } = await import('node:os');
 const { join } = await import('node:path');
 const directory = mkdtempSync(join(tmpdir(), 'forma-artifact-media-'));
 const archive = `${API}/actions/artifacts/123/zip`, release = `${API}/releases/assets/456`;
 const get = releaseReader({ token: 'test-read-token', fetchImpl: async (url, options) => {
   assert.equal(options.headers.Authorization, 'Bearer test-read-token');
   const required = url === archive ? 'application/vnd.github+json' : 'application/octet-stream';
   if (options.headers.Accept !== required) return new Response('Unsupported Accept header', { status: 415 });
   return new Response(bytes);
 } });
 try {
   const destination = join(directory, 'artifact.zip');
   const downloaded = await get(archive, { binary: true, destination, limit: bytes.length });
   assert.deepEqual(downloaded, { bytes: bytes.length, sha256: sha });
   assert.deepEqual(readFileSync(destination), bytes);
   assert.deepEqual(await get(release, { binary: true, limit: bytes.length }), bytes);
 } finally { rmSync(directory, { recursive: true, force: true }); }
});
