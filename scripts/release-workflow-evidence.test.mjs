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
  ['publisher ignores failed needs', 'J3', doc => { doc.jobs['publish-crates'].if = "always() && startsWith(github.ref, 'refs/tags/v')"; }],
  ['publisher drops verify dependency', 'J2', doc => { doc.jobs['publish-npm'].needs = doc.jobs['publish-npm'].needs.filter(name => name !== 'verify'); }],
];

for (const [name, rule, mutate] of mutations) {
  test(`release evidence refuses ${name}`, () => {
    const changed = structuredClone(workflow); mutate(changed);
    const result = lint(changed);
    assert.equal(result.status, 1, `${name}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, new RegExp(`(?:^|\n)${rule} `), 'the intended policy must reject the mutation');
  });
}
