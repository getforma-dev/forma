import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const readWorkflow = name => JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e',
  'v=YAML.load(STDIN.read); v["on"]=v.delete(true) if v.key?(true); puts JSON.generate(v)'],
{ input: readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url)), encoding: 'utf8' }));
const actual = readWorkflow('registry-reconcile.yml');

function validate(workflow) {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(workflow.on.schedule.length, 1);
  assert.equal(workflow.on.schedule[0].cron, '43 8 * * 1');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(workflow.jobs), ['reconcile']);
  const job = workflow.jobs.reconcile;
  assert.equal(job['timeout-minutes'], 20);
  assert(!job.if && !job['continue-on-error'] && !job.permissions && !job.env);
  const steps = job.steps;
  assert(steps.every(s => !s['continue-on-error'] && (!s.uses || /@[a-f0-9]{40}$/.test(s.uses))));
  const checkout = steps.find(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
  const run = steps.filter(s => s.run?.startsWith('node scripts/registry-reconcile.mjs'));
  assert.equal(run.length, 1);
  assert(!run[0].if);
  assert.equal(run[0].run, 'node scripts/registry-reconcile.mjs --policy scripts/registry-reconcile-policy.json --output "$RUNNER_TEMP/registry-reconcile/report.json"');
  assert.deepEqual(run[0].env, { GH_TOKEN: '${{ github.token }}' });
  const upload = steps.filter(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.length, 1);
  assert.equal(upload[0].if, 'always()');
  assert.equal(upload[0].with['if-no-files-found'], 'error');
  assert.equal(upload[0].with.path, '${{ runner.temp }}/registry-reconcile/');
  assert.equal(upload[0].with['retention-days'], 30);
  assert(steps.some(s => s.if === 'always()' && s.run?.includes('External alert delivery remains deferred under L-60')));
}

test('scheduled reconciliation is bounded, read-only, fail-closed and preserves failure reports', () => validate(actual));
test('permission escalation, skip, failure masking and failure-evidence loss are rejected', () => {
  for (const mutate of [
    w => { w.permissions.contents = 'write'; },
    w => { w.permissions['id-token'] = 'write'; },
    w => { w.jobs.reconcile['continue-on-error'] = true; },
    w => { w.jobs.reconcile.steps.find(s => s.env?.GH_TOKEN).if = 'false'; },
    w => { w.jobs.reconcile.steps.find(s => s.env?.GH_TOKEN).run += ' || true'; },
    w => { w.jobs.reconcile.steps.find(s => s.with?.name === 'registry-reconciliation').if = 'success()'; },
    w => { w.jobs.reconcile.steps.find(s => s.uses?.startsWith('actions/checkout@')).with['persist-credentials'] = true; },
  ]) {
    const changed = structuredClone(actual); mutate(changed);
    assert.throws(() => validate(changed));
  }
});
test('ordinary PR CI runs the offline discrepancy and workflow controls', () => {
  const ci = readWorkflow('ci.yml');
  const step = ci.jobs['release-workflow'].steps.find(s => s.name === 'Registry reconciliation failures and read-only workflow controls');
  assert(step && !step.if && !step['continue-on-error']);
  assert.equal(step.run, 'node --test --test-concurrency=2 scripts/registry-reconcile.test.mjs scripts/registry-reconcile-workflow.test.mjs scripts/release-publication-recovery.test.mjs');
});
