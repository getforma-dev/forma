import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parsed = spawnSync('ruby', ['-ryaml', '-rjson', '-e',
  "d = YAML.safe_load(File.read(ARGV[0]), aliases: false); d['on'] = d.delete(true) if d.key?(true); puts JSON.generate(d)",
  join(root, '.github/workflows/release.yml')], { encoding: 'utf8' });
assert.equal(parsed.status, 0, parsed.stderr);
const workflow = JSON.parse(parsed.stdout);
const upload = doc => doc.jobs.verify.steps.find(step => step.with?.name === 'release-p17');
const p17 = doc => doc.jobs.verify.steps.find(step => step.name === 'P17 packed corpus and both templates');
const record = doc => doc.jobs.verify.steps.find(step => step.id === 'record');
const evidenceCheck = doc => doc.jobs.record.steps.find(step => step.name === 'Verify P17 evidence');

function lint(doc) {
  const directory = mkdtempSync(join(tmpdir(), 'forma-release-evidence-'));
  try {
    mkdirSync(join(directory, '.github/workflows'), { recursive: true });
    mkdirSync(join(directory, 'scripts'));
    // JSON is a YAML subset. The real validator parses each mutated document.
    writeFileSync(join(directory, '.github/workflows/release.yml'), JSON.stringify(doc));
    for (const name of ['check-release-workflow.rb', 'release-contracts.json']) {
      copyFileSync(join(root, 'scripts', name), join(directory, 'scripts', name));
    }
    return spawnSync('ruby', ['scripts/check-release-workflow.rb'], { cwd: directory, encoding: 'utf8' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('packed verification can overlap engines while every release writer requires both successful gates', () => {
  assert.deepEqual(workflow.jobs.verify.needs, ['check', 'pack']);
  for (const name of ['publish-crates', 'publish-npm', 'record']) {
    for (const prerequisite of ['engines', 'verify']) {
      assert(workflow.jobs[name].needs.includes(prerequisite), `${name} must directly require ${prerequisite}`);
    }
    assert.equal(workflow.jobs[name]['continue-on-error'], undefined);
    assert.equal(workflow.jobs[name].if, name === 'record' ? undefined : "startsWith(github.ref, 'refs/tags/v')");
  }
});

test('actual release workflow retains failed P17 bytes without changing publish success dependencies', () => {
  assert.equal(upload(workflow).if, 'always()', 'failed P17 must retain its actual diagnostic directory');
  assert.equal(p17(workflow)['continue-on-error'], undefined);
  assert.equal(record(workflow).if, undefined, 'success proof must remain success-only');
  assert.equal(workflow.jobs.verify['continue-on-error'], undefined);
  for (const name of ['publish-crates', 'publish-npm']) {
    assert(workflow.jobs[name].needs.includes('verify'));
    assert.equal(workflow.jobs[name].if, "startsWith(github.ref, 'refs/tags/v')");
  }
  const result = lint(workflow);
  assert.equal(result.status, 0, result.stderr);
});

const mutations = [
  ['missing RC/final qualification', 'K9', doc => { doc.jobs.check.steps = doc.jobs.check.steps.filter(step => step.run !== 'node scripts/check-release-qualification.mjs'); }],
  ['qualification with a different token source', 'K9', doc => { doc.jobs.check.steps.find(step => step.run === 'node scripts/check-release-qualification.mjs').env.GH_TOKEN = '${{ secrets.PAT }}'; }],
  ['shallow RC qualification checkout', 'K9', doc => { delete doc.jobs.check.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth']; }],
  ['shallow DS12 audit checkout', 'K9', doc => { doc.jobs.record.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'] = 1; }],
  ['DS12 loses P17 artifact identity', 'K9', doc => { delete doc.jobs.record.steps.find(step => step.run?.startsWith('node scripts/release-record.mjs')).env.P17_MANIFEST_SHA256; }],
  ['DS12 records the DS11 hash as P17', 'K9', doc => { doc.jobs.record.steps.find(step => step.run?.startsWith('node scripts/release-record.mjs')).env.P17_MANIFEST_SHA256 = '${{ needs.pack.outputs.record-sha256 }}'; }],
  ['DS12 points to its own attempt instead of the P17 producer', 'K9', doc => { doc.jobs.record.steps.find(step => step.run?.startsWith('node scripts/release-record.mjs')).env.P17_RUN_ATTEMPT = '${{ github.run_attempt }}'; }],
  ['missing failure retention', 'K7', doc => { delete upload(doc).if; }],
  ['failure-only upload loses successful proof', 'K7', doc => { upload(doc).if = 'failure()'; }],
  ['different evidence path', 'K7', doc => { upload(doc).with.path = '${{ runner.temp }}/release/'; }],
  ['different artifact name', 'K7', doc => { upload(doc).with.name = 'some-other-artifact'; }],
  ['missing-file warning', 'K7', doc => { upload(doc).with['if-no-files-found'] = 'warn'; }],
  ['unpinned evidence action', 'K7', doc => { upload(doc).uses = 'actions/upload-artifact@main'; }],
  ['upload before P17', 'K7', doc => { const steps = doc.jobs.verify.steps; const step = upload(doc); steps.splice(steps.indexOf(step), 1); steps.unshift(step); }],
  ['duplicate evidence upload', 'K7', doc => { doc.jobs.verify.steps.push(structuredClone(upload(doc))); }],
  ['ignored P17 failure', 'E1', doc => { p17(doc)['continue-on-error'] = true; }],
  ['ignored verify failure', 'E1', doc => { doc.jobs.verify['continue-on-error'] = true; }],
  ['success record runs after failure', 'E1', doc => { record(doc).if = 'always()'; }],
  ['P17 condition skips verification', 'E1', doc => { p17(doc).if = 'false'; }],
  ['P17 shell swallows failure', 'K7', doc => { p17(doc).run = p17(doc).run.trimEnd() + ' || true\n'; }],
  ['record replaces proof hash', 'K7', doc => { record(doc).run = 'echo "report-sha256=forged" >> "$GITHUB_OUTPUT"\n'; }],
  ['success recorder falls back to flat DS11 tool', 'K7', doc => { record(doc).run = record(doc).run.replace('node scripts/release-evidence.mjs', 'bash scripts/release-artifacts.sh'); }],
  ['record job loses nested evidence verification', 'K8', doc => { doc.jobs.record.steps = doc.jobs.record.steps.filter(step => step !== evidenceCheck(doc)); }],
  ['record job trusts a different digest', 'K8', doc => { evidenceCheck(doc).env.RECORD_SHA256 = '${{ needs.pack.outputs.record-sha256 }}'; }],
  ['record job verifies a different path', 'K8', doc => { evidenceCheck(doc).run = evidenceCheck(doc).run.replace('/p17', '/other'); }],
  ['record job verifies after writing DS12', 'K8', doc => { const steps = doc.jobs.record.steps; const step = evidenceCheck(doc); steps.splice(steps.indexOf(step), 1); steps.push(step); }],
  ['record job downloads evidence elsewhere', 'K8', doc => { doc.jobs.record.steps.find(step => step.with?.name === 'release-p17').with.path = '${{ runner.temp }}/other'; }],
  ['record job falls back to flat verification', 'K8', doc => { evidenceCheck(doc).run = evidenceCheck(doc).run.replace('node scripts/release-evidence.mjs', 'bash scripts/release-artifacts.sh'); }],
  ['publisher ignores failed needs', 'J3', doc => { doc.jobs['publish-crates'].if = "always() && startsWith(github.ref, 'refs/tags/v')"; }],
  ['P17 drops packed-set dependency', 'J2', doc => { doc.jobs.verify.needs = doc.jobs.verify.needs.filter(name => name !== 'pack'); }],
];

for (const job of ['publish-crates', 'publish-npm', 'record']) {
  for (const prerequisite of ['engines', 'verify']) {
    mutations.push([`${job} drops ${prerequisite} dependency`, 'J2', doc => {
      doc.jobs[job].needs = doc.jobs[job].needs.filter(name => name !== prerequisite);
    }]);
  }
}

for (const [name, rule, mutate] of mutations) {
  test(`release evidence refuses ${name}`, () => {
    const changed = structuredClone(workflow); mutate(changed);
    const result = lint(changed);
    assert.equal(result.status, 1, `${name}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(`(?:^|\n)${rule} `), 'the intended policy must reject the mutation');
  });
}
