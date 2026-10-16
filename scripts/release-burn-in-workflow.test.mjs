import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './release-set.mjs';
const actual = JSON.parse(execFileSync('ruby',['-rjson','-ryaml','-e','v=YAML.load(STDIN.read); v["on"]=v.delete(true) if v.key?(true); puts JSON.generate(v)'],{input:readFileSync(join(ROOT,'.github/workflows/rc-burn-in.yml')),encoding:'utf8'}));
function validate(workflow) {
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
 assert.deepEqual(workflow.permissions,{contents:'read',actions:'read'});assert.equal(workflow.concurrency['cancel-in-progress'],false);
 assert.deepEqual(Object.keys(workflow.jobs),['burn-in']);const job=workflow.jobs['burn-in'];
 assert.equal(job['timeout-minutes'],180);assert.equal(job['runs-on'],'ubuntu-latest');assert.equal(job.env.CARGO_BUILD_JOBS,'3');assert(!job.if);
 const steps=job.steps;assert(steps.every(step=>!step.uses||/^[^@]+@[a-f0-9]{40}$/.test(step.uses)));
 const setup=steps.filter(step=>step.uses?.startsWith('actions/setup-node@'));assert.equal(setup.length,1);assert.equal(setup[0].with['node-version-file'],'.node-version');
 const checkout=steps.filter(step=>step.uses?.startsWith('actions/checkout@'));assert.equal(checkout.length,1);assert.equal(checkout[0].with['fetch-depth'],0);assert.equal(checkout[0].with['persist-credentials'],false);
 for(const name of ['Require immutable RC dispatch and actual Linux ownership controls','Continuous packed RC workloads','Authenticate results and cleanup before recording success']){const found=steps.filter(step=>step.name===name);assert.equal(found.length,1);assert(!found[0].if);assert(!found[0]['continue-on-error']);}
 const run=steps.find(step=>step.name==='Continuous packed RC workloads');assert.equal(run.run.trim(),'python3 scripts/release-owned-linux.py "$RUNNER_TEMP/burn-in-owned" 9900 -- node scripts/release-burn-in.mjs worker "$RC_TAG" "$GITHUB_SHA" "$RUNNER_TEMP/burn-in-evidence" "$RUNNER_TEMP/burn-in-work"');
 const retain=steps.filter(step=>step.uses?.startsWith('actions/upload-artifact@'));assert.equal(retain.length,2);assert(retain.every(step=>step.if==='always()'&&step.with['if-no-files-found']==='error'));
 assert.deepEqual(retain.map(step=>step.with.name),['rc-burn-in','rc-burn-in-ownership']);
}
test('actual hosted burn-in is read-only, immutable, bounded, supervised and retains failure evidence',()=>validate(actual));
test('skip, unsupervised command, permissions and retention mutations fail',()=>{
 for(const mutate of [w=>w.permissions['id-token']='write',w=>w.jobs['burn-in'].steps.find(s=>s.name==='Continuous packed RC workloads').if='false',w=>w.jobs['burn-in'].steps.find(s=>s.name==='Continuous packed RC workloads').run='true',w=>w.jobs['burn-in'].steps.find(s=>s.with?.name==='rc-burn-in').if='success()',w=>w.jobs['burn-in']['timeout-minutes']=30]){const changed=structuredClone(actual);mutate(changed);assert.throws(()=>validate(changed));}
});
