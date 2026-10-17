import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loggedChild, saveExclusive } from './release-burn-in.mjs';

test('actual failed child retains its original bytes and never returns success',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'burn-in-child-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const log=join(dir,'failure.log');
 await assert.rejects(loggedChild(process.execPath,['-e','process.stdout.write("preserved original failure");process.exit(7)'],{cwd:dir,log,timeout:1000}),/workload process failed/);
 assert.equal(readFileSync(log,'utf8'),'preserved original failure');
 await assert.rejects(loggedChild(process.execPath,['-e','process.exit(0)'],{cwd:dir,log,timeout:1000}),/EEXIST/);
});
test('exclusive fsynced logical records cannot overwrite or exceed the explicit bound',t=>{
 const dir=mkdtempSync(join(tmpdir(),'burn-in-record-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'report.json'),hash=saveExclusive(file,{original:true});assert.match(hash,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(readFileSync(file)),{original:true});
 assert.throws(()=>saveExclusive(file,{original:false}),/EEXIST/);
 assert.throws(()=>saveExclusive(join(dir,'oversize.json'),{data:'x'.repeat(16*1024*1024)}),/logical report exceeds limit/);
});
