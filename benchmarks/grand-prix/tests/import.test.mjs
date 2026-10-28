import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { importEvidence } from '../src/import-evidence.mjs';
import { verify } from '../src/session.mjs';
function fixture(t){const r=fs.mkdtempSync(path.join(os.tmpdir(),'gp-import-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));fs.mkdirSync(path.join(r,'evidence'));return r;}
function archive(root,name,member){execFileSync('python3',['-c','import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z: z.writestr(sys.argv[2],"{}")',path.join(root,'evidence',name),member]);}
test('import retains exact archive, labels history and refuses duplicate runs',t=>{
  const r=fixture(t);archive(r,'run.zip','raw/signals/forma.json');
  const out=importEvidence(r,'evidence/run.zip','old-run');
  assert.equal(verify(out.directory).ok,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out.directory,'manifest.json'))).quality,'historical-import');
  assert.deepEqual(fs.readFileSync(path.join(r,'evidence/run.zip')),fs.readFileSync(path.join(out.directory,'original.zip')));
  assert.throws(()=>importEvidence(r,'evidence/run.zip','old-run'),/exists/);
});
test('zip traversal is rejected before writing any archive member',t=>{
  const r=fixture(t);archive(r,'bad.zip','../../escaped');
  assert.throws(()=>importEvidence(r,'evidence/bad.zip','bad-run'));
  assert.ok(!fs.existsSync(path.join(r,'runs/escaped')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(r,'runs/bad-run/manifest.json'))).status,'failed');
  assert.ok(!fs.existsSync(path.join(r,'.grandprix/active.json')));
});
