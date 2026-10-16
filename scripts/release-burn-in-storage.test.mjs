import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, openSync, closeSync, ftruncateSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evidenceBytes, evidenceRoom, writeEvidence, MAX_EVIDENCE_BYTES } from './release-burn-in-storage.mjs';

test('compressed and extracted evidence share one bound; future round reservations refuse before writes', t => {
 const root=mkdtempSync(join(tmpdir(),'burn-in-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'nested'));
 const archive=join(root,'artifact.zip'), fd=openSync(archive,'wx');
 try { ftruncateSync(fd,MAX_EVIDENCE_BYTES-4); } finally {closeSync(fd);}
 assert.equal(evidenceRoom(root),4);
 writeEvidence(root,join(root,'nested/member'),'data');
 assert.equal(readFileSync(join(root,'nested/member'),'utf8'),'data');
 assert.equal(evidenceBytes(root),MAX_EVIDENCE_BYTES);
 assert.throws(()=>writeEvidence(root,join(root,'oversize'),'x'),/insufficient bounded room/);
 assert.throws(()=>evidenceRoom(root,1),/insufficient bounded room/);
 assert.throws(()=>writeEvidence(root,join(root,'../outside'),'x'),/outside owned root/);
});
