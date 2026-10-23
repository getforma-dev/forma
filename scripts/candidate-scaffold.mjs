#!/usr/bin/env node
// The candidate gate consumes DS11 bytes. It never resolves unpublished Forma versions.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, NPM, CRATES, SEMVER, json, save, digest, run, pack, packedRuntimeLock, stageNpmLock, stageCargoLock, assertNpmTemplateLock, assertCargoCandidateLock } from './release-set.mjs';
import { verifyPackedTemplateSources } from './release-template-sources.mjs';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';
import { requireN8Observations } from './n8-size-start.mjs';

const sourceFiles = ['minimal', 'dashboard'].flatMap(template => ['src/main.rs', 'Cargo.toml', 'Cargo.lock', 'admin/package.json', 'admin/package-lock.json'].map(file => `packages/create-app/templates/${template}/${file}`));
export function templateHashes(root = ROOT) { return Object.fromEntries(sourceFiles.map(file => [file, digest(join(root, file))])); }

export function validateCandidate(dir, expectedHash, expectedCommit) {
  assert(/^[a-f0-9]{64}$/.test(expectedHash ?? ''), 'expected DS11 record SHA-256 is required');
  assert(/^[a-f0-9]{40}$/.test(expectedCommit ?? ''), 'expected source commit is required');
  assert.equal(digest(join(dir, 'release-set.json')), expectedHash, 'DS11 record digest differs from producer output');
  const set = json(join(dir, 'release-set.json'));
  assert.equal(set.schema, 1); assert.equal(set.commit, expectedCommit, 'DS11 source is not this checkout');
  assert(['declared-v1', 'islands-v1'].includes(set.contracts?.sourceTemplates), 'candidate must carry a supported source template contract');
  if (set.contracts.sourceTemplates === 'islands-v1') assert.equal(set.contracts.stateBlock, 'declared-v1', 'islands candidate requires declared state');
  const expected = [...CRATES.map(name => ({name, registry:'crates', path:`crates/${name}`})), ...NPM.map(name => ({name:`@getforma/${name}`, registry:'npm', path:`packages/${name}`}))];
  assert(Array.isArray(set.packages)); assert.equal(set.packages.length, expected.length);
  const version = set.packages[0].version; assert(SEMVER.test(version) && Number(version.split('.')[0]) >= 3);
  for (const identity of expected) {
    const matches = set.packages.filter(p => p.name === identity.name); assert.equal(matches.length, 1, `${identity.name}: DS11 identity must be unique`);
    const p = matches[0]; assert.equal(p.registry, identity.registry); assert.equal(p.path, identity.path); assert.equal(p.version, version);
    const filename = `${p.name.replace('@', '').replace('/', '-')}-${version}.${p.registry === 'npm' ? 'tgz' : 'crate'}`;
    assert.equal(p.file, filename, `${p.name}: unexpected archive filename`);
    assert(/^[a-f0-9]{64}$/.test(p.sha256)); assert.equal(digest(join(dir, p.file)), p.sha256, `${p.name}: archive digest differs`);
  }
  return set;
}

function unpack(file, dest) {
  const names = run('tar', ['-tzf', file]).trim().split(/\r?\n/);
  assert(names.every(name => name && !/^[\\/]|^[a-z]:/i.test(name) && !name.replaceAll('\\','/').split('/').includes('..')), 'unsafe archive path');
  mkdirSync(dest, {recursive:true}); run('tar', ['-xzf', file, '-C', dest, '--strip-components=1']);
}

export function prepareCandidate(dir, expectedHash, expectedCommit, work) {
  dir = resolve(dir); work = resolve(work);
  const set = validateCandidate(dir, expectedHash, expectedCommit);
  assert(!existsSync(work), 'candidate work directory must be fresh'); mkdirSync(work, {recursive:true});
  const cli = join(work, 'packed cli');
  for (const p of set.packages) {
    if (p.name === '@getforma/create-app') unpack(join(dir, p.file), cli);
    if (p.registry !== 'crates') continue;
    const dest = join(work, p.path); unpack(join(dir, p.file), dest);
    assert.equal(json(join(dest, '.cargo_vcs_info.json')).git.sha1, expectedCommit, `${p.name}: packaged VCS differs`);
    assertCargoCandidateLock(readFileSync(join(dest, 'Cargo.lock'), 'utf8'), set.packages, p.name);
    // Isolate the normalized archive from any enclosing workspace. Dependencies are
    // substituted only in the consuming scaffold's patch table, below.
    appendFileSync(join(dest, 'Cargo.toml'), '\n[workspace]\n');
  }
  assert(!existsSync(join(cli, 'template-lock-seeds.json')), 'source seed identity must not ship');
  const sourceEquality = verifyPackedTemplateSources(cli, expectedCommit, set.contracts.sourceTemplates);
  for (const template of ['minimal', 'dashboard']) {
    const project = join(cli, 'templates', template), admin = join(project, 'admin');
    assertNpmTemplateLock(json(join(admin, 'package.json')), json(join(admin, 'package-lock.json')), set.packages, dir);
    assertCargoCandidateLock(readFileSync(join(project, 'Cargo.lock'), 'utf8'), set.packages);
  }
  const runtime = packedRuntimeLock(json(join(cli, 'package.json')), json(join(ROOT, 'package-lock.json')), 'packages/create-app');
  save(join(cli, 'package.json'), runtime.manifest); save(join(cli, 'package-lock.json'), runtime.lock);
  const before = digest(join(cli, 'package-lock.json'));
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cli, {stdio:'inherit'});
  assert.equal(digest(join(cli, 'package-lock.json')), before, 'packed CLI lock changed during installation');
  const signatures = auditCandidateSignatures(cli, set.packages, dir);
  const context = {schema:1, dir, recordSha256:expectedHash, commit:expectedCommit, work, cli:join(cli,'dist/index.js'), target:join(work,'target')};
  save(join(work, 'context.json'), context);
  save(join(work, 'preparation.json'), {schema:1, passed:true, commit:expectedCommit, recordSha256:expectedHash, packages:set.packages, sourceEquality, signatures});
  return context;
}

// Called after the actual packed CLI finishes. No new files are added to a scaffold;
// its graph and external hashes remain the sealed package's, with only Forma local.
export function stageCandidateProject(contextPath, project) {
  const context = json(contextPath), set = validateCandidate(context.dir, context.recordSha256, context.commit);
  const admin = join(project, 'admin'), manifestPath = join(project, 'Cargo.toml'), lockPath = join(project, 'Cargo.lock');
  const manifest = readFileSync(manifestPath, 'utf8');
  assert(!/^\[(?:workspace|patch\.)/m.test(manifest), 'scaffold already has a workspace or patch override');
  const npm = stageNpmLock(json(join(admin,'package.json')), json(join(admin,'package-lock.json')), set.packages, context.dir, true);
  const lock = stageCargoLock(readFileSync(lockPath,'utf8'), set.packages, true);
  const patches = CRATES.map(name => `${name} = { path = ${JSON.stringify(join(context.work,'crates',name))} }`).join('\n');
  save(join(admin,'package.json'), npm.manifest); save(join(admin,'package-lock.json'), npm.lock);
  writeFileSync(lockPath, lock); writeFileSync(manifestPath, `${manifest}\n[workspace]\n\n[patch.crates-io]\n${patches}\n`);
}

// Keep the complete legacy heavy suite load-bearing. New cases are additive.
export const REQUIRED_HEAVY = [
  ...['minimal','dashboard'].flatMap(t => [
    `${t}: npm ci, frontend build, cargo check --locked`,
    `${t}: no locked crate needs a newer Rust than the template declares`,
    `${t}: a user's own cargo update keeps every crate within the template's rust-version`,
    `${t}: every page answers no-store with a fresh nonce per fetch, and registers no service worker`,
  ]),
  'minimal: build:ssr emits real IR, not a placeholder',
  'minimal: a corrupt module stops the server before it binds, and a failed render answers 500, with neither its error nor a shell',
  'minimal: build:ssr is strict: a construct the server cannot render fails the build, naming its code, file and line',
  'dashboard: serves each page as its browser shell, by declaration (ssr: false)',
  'minimal scaffolded as tracing, a crate in its own graph: cargo --locked accepts the lockfile and plain cargo leaves it',
  'dashboard scaffolded as serde, a crate in its own graph: cargo --locked accepts the lockfile and plain cargo leaves it',
  'minimal: build:ssr reads ssrEntryPoints by page name',
  'cargo new accepts every project name the scaffolder accepts, and refuses every name it says cargo refuses',
  'minimal: declared count reaches SSR and invalid bindings refuse before listening',
  'minimal: packed native island adopts without writes and static route requests no code in all engines',
  'dashboard: chart tooltip keeps API values as text under enforced policy in all engines',
];
export function requireHeavyResults(report) {
  assert.equal(report.success, true, 'scaffold suite failed');
  const cases = report.testResults.flatMap(file => file.assertionResults);
  assert(cases.length && cases.every(test => test.status === 'passed'), 'scaffold suite contains a skipped or failed test');
  for (const name of REQUIRED_HEAVY) {
    const found = cases.filter(test => test.title === name && test.ancestorTitles.includes('scaffolded projects build (FORMA_SCAFFOLD_E2E=1)'));
    assert.equal(found.length, 1, `required heavy case did not run exactly once: ${name}`);
    assert.equal(found[0].status, 'passed', `required heavy case failed: ${name}`);
  }
  return {total:cases.length, heavy:REQUIRED_HEAVY.length, required:REQUIRED_HEAVY};
}

function readObservations(context) {
  const observations = join(context.work,'observations.jsonl');
  return existsSync(observations) ? readFileSync(observations,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)) : [];
}

export function runCandidate(context, reportPath) {
  const rawReport = join(context.work, 'vitest.json');
  const require = createRequire(join(ROOT,'packages/create-app/package.json'));
  const runner = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const result = spawnSync(process.execPath, [runner,'run','--reporter=default','--reporter=json',`--outputFile.json=${rawReport}`], {
    cwd:join(ROOT,'packages/create-app'), stdio:'inherit', windowsHide:true,
    env:{...process.env, FORMA_SCAFFOLD_E2E:'1', FORMA_SCAFFOLD_CONTEXT:context.mode === 'published' ? '' : join(context.work,'context.json'), FORMA_SCAFFOLD_CLI:context.cli, FORMA_SCAFFOLD_REPORT_DIR:context.work, CARGO_TARGET_DIR:context.target, CARGO_INCREMENTAL:'0'},
  });
  const report = {schema:1, passed:false, mode:context.mode ?? 'candidate', commit:context.commit, recordSha256:context.recordSha256, platform:process.platform};
  try {
    assert.equal(result.error, undefined); assert.equal(result.status, 0, 'scaffold suite command failed');
    report.cases = requireHeavyResults(json(rawReport));
    // N8 (FORMA-164): on Linux both templates' size and start figures are in the report and inside the ceilings.
    requireN8Observations(readObservations(context), process.platform);
    report.passed = true;
  } finally {
    report.observations = readObservations(context);
    save(reportPath, report);
  }
  return report;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pack') {
    const out = resolve(args[0]);
    assert.equal(run('git',['diff','--name-only','HEAD']).trim(), '', 'candidate pack requires a committed source');
    const before = templateHashes(); let success = false;
    try {pack(out, true); success = true;}
    finally {
      const after = templateHashes(); save(join(out,'template-restoration.json'),{schema:1,success,before,after});
      assert.deepEqual(after,before,'real candidate pack did not restore all ten template source files');
    }
    const hash = digest(join(out,'release-set.json'));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`record-sha256=${hash}\n`);
    console.log(`DS11 record SHA-256: ${hash}`);
  } else if (command === 'prepare') {
    const context = prepareCandidate(...args); console.log(join(context.work,'context.json'));
  } else if (command === 'run') {
    const [dir, hash, commit, work, report] = args;
    runCandidate(prepareCandidate(dir,hash,commit,work),resolve(report));
  } else if (command === 'project') stageCandidateProject(resolve(args[0]),resolve(args[1]));
  else if (command === 'audit') {
    const context = json(args[0]), set = validateCandidate(context.dir,context.recordSha256,context.commit);
    console.log(JSON.stringify(auditCandidateSignatures(resolve(args[1]),set.packages,context.dir)));
  } else throw Error('usage: candidate-scaffold.mjs pack OUT | prepare DIR HASH COMMIT WORK | run DIR HASH COMMIT WORK REPORT | project CONTEXT PROJECT | audit CONTEXT ADMIN');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error);process.exitCode=1;});
