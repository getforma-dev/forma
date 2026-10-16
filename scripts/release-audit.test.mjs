import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { auditInputManifest, bindAuditToRc, validateAuditReport, validateAuditEvidence } from './release-audit.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value));
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'forma-d14-'));
  const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
  git('init', '--quiet'); git('config', 'user.name', 'Finite control'); git('config', 'user.email', 'control@example.invalid');
  mkdirSync(join(root,'scripts')); mkdirSync(join(root,'docs','archive'),{recursive:true});
  writeFileSync(join(root,'runtime.js'),'export const original = true;\n');
  writeFileSync(join(root,'docs','archive','corpus.ir'),'actual immutable corpus');
  writeFileSync(join(root,'scripts','release-contracts.json'),JSON.stringify({milestones:{rc:{gates:{'FORMA-145 audit':{status:'pending',scope:'independent review'}}}}}));
  git('add','.');git('commit','--quiet','-m','frozen product');
  const commit=git('rev-parse','HEAD'),input=auditInputManifest(commit,root),inputBytes=bytes(input);
  const raw=['actual author session','actual different-model review','actual accepted review'];
  const evidence=bytes({contract:'d14-review-evidence-v1',entries:raw.map(content=>({content,sha256:hash(content)}))});
  const report={contract:'d14-whole-release-v1',reviewedCommit:commit,reviewedTree:input.tree,inputManifestSha256:hash(inputBytes),authorModel:{provider:'test',id:'author',sessionEvidenceSha256:hash(raw[0])},reviewerModel:{provider:'test',id:'reviewer',sessionEvidenceSha256:hash(raw[1])},reviewedAt:'2026-10-16T10:00:00Z',accepted:true,findings:[],blockingFindings:[],acceptanceEvidenceSha256:hash(raw[2])};
  const change=(path,value)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),value);git('add','.');git('commit','--quiet','-m','followup');return git('rev-parse','HEAD');};
  return {root,git,commit,input,inputBytes,report,evidence,change,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('real Git tree binds reviewed evidence/status followup without self-reference',()=>{
 const f=setup();try{
  validateAuditReport(f.report,f.input,f.inputBytes);validateAuditEvidence(f.report,f.evidence);
  const rc=f.change('scripts/release-contracts.json',JSON.stringify({milestones:{rc:{gates:{'FORMA-145 audit':{status:'done',scope:'independent review'}}}}}));
  const binding=bindAuditToRc({rcCommit:rc,reportBytes:bytes(f.report),inputBytes:f.inputBytes,root:f.root});
  assert.equal(binding.changes.length,1);assert.equal(binding.reviewedCommit,f.commit);assert.equal(binding.rcCommit,rc);
 }finally{f.close();}
});
test('production and archived executable-corpus edits cannot hide as evidence',()=>{
 for(const path of ['runtime.js','docs/archive/corpus.ir']){const f=setup();try{const rc=f.change(path,'changed');assert.throws(()=>bindAuditToRc({rcCommit:rc,reportBytes:bytes(f.report),inputBytes:f.inputBytes,root:f.root}),/production\/harness changed/);}finally{f.close();}}
});
test('invented input inventory and unrelated gate edits refuse',()=>{
 const f=setup();try{
  const input=structuredClone(f.input);input.entries.pop();const inputBytes=bytes(input),report={...f.report,inputManifestSha256:hash(inputBytes)};
  assert.throws(()=>bindAuditToRc({rcCommit:f.commit,reportBytes:bytes(report),inputBytes,root:f.root}),/actual Git objects/);
  const rc=f.change('scripts/release-contracts.json',JSON.stringify({milestones:{rc:{gates:{'FORMA-145 audit':{status:'done',scope:'changed'}}}}}));
  assert.throws(()=>bindAuditToRc({rcCommit:rc,reportBytes:bytes(f.report),inputBytes:f.inputBytes,root:f.root}),/non-audit gate/);
 }finally{f.close();}
});
test('missing real review bytes, same model, unaccepted review and blockers refuse',()=>{
 const f=setup();try{
  for(const edit of [r=>r.reviewerModel.id='author',r=>r.accepted=false,r=>r.blockingFindings=['D14-1'],r=>r.reviewedAt='2026-02-30T00:00:00Z']){const r=structuredClone(f.report);edit(r);assert.throws(()=>validateAuditReport(r,f.input,f.inputBytes));}
  assert.throws(()=>validateAuditEvidence(f.report,bytes({contract:'d14-review-evidence-v1',entries:[]})));
  const e=JSON.parse(f.evidence);e.entries[0].content='same hash claim, different actual bytes';assert.throws(()=>validateAuditEvidence(f.report,bytes(e)),/evidence changed/);
 }finally{f.close();}
});
