// Setup only: compile consumers against original published archives, never repack them.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateNpmPackages, CRATE_PACKAGES } from './release-package-inventory.mjs';
import { ROOT, digest, json, packedRuntimeLock, run, save, assertInstalledTemplateCandidates } from './release-set.mjs';
import { stageCandidateProject, validateCandidate } from './candidate-scaffold.mjs';
import { verifyPackedTemplateSources } from './release-template-sources.mjs';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';
import { stageFixtureProject, pruneCargoLock } from './release-fixture-apps.mjs';
import { preparePackedSkew } from './release-skew-drill.mjs';
import { FUZZ_TARGETS } from './release-burn-in-report.mjs';
import { templatesForPackages } from './template-lock-seeds.mjs';

// Candidate scaffolding needs a descriptor beside its archives. A published RC
// starts with the versioned authenticated registry archives, whereas a dry pack already
// supplies its original DS11 descriptor. Never replace the latter's exact bytes.
export function scaffoldDescriptor({ set, archives }) {
  const path = join(archives, 'release-set.json');
  const fields = ['schema', 'packageSet', 'dryRun', 'tag', 'commit', 'contracts', 'packages'];
  const view = Object.fromEntries(fields.filter(key => key in set).map(key => [key, set[key]]));
  const existing = existsSync(path);
  if (!existing) writeFileSync(path, JSON.stringify(view, null, 2) + '\n', { flag: 'wx' });
  const sha256 = digest(path);
  const descriptor = validateCandidate(archives, sha256, set.commit);
  const actualView = Object.fromEntries(fields.filter(key => key in descriptor).map(key => [key, descriptor[key]]));
  assert.deepEqual(actualView, view, 'staging descriptor differs from authenticated set');
  return { path, sha256, kind: existing ? 'existing-original-descriptor' : 'derived-authenticated-staging-view' };
}

export async function prepareBurnIn({ authenticated, work, test }) {
  const { set, archives: dir } = authenticated;
  const version = set.packages[0].version;
  assert.equal(set.packages.length, CRATE_PACKAGES.length + candidateNpmPackages(set).length);
  assert(set.packages.every(item => item.version === version), 'staged package versions differ');
  const cratesDir = join(work, 'crates'), targetDir = join(work, 'target');
  mkdirSync(work); mkdirSync(join(work, 'tmp')); process.env.TMPDIR = join(work, 'tmp');
  const extracted = {};
  for (const p of set.packages) {
    const temp = join(work, `unpack-${p.name.split('/').at(-1)}`);
    run('python3', [join(ROOT, 'scripts/release-unpack.py'), 'tar', join(dir, p.file), temp, String(512 * 1024 * 1024)]);
    const root = p.registry === 'npm' ? 'package' : `${p.name}-${p.version}`;
    const dest = p.registry === 'npm' ? join(work, 'packages', p.name.split('/').at(-1)) : join(cratesDir, p.name);
    mkdirSync(join(dest, '..'), { recursive: true }); renameSync(join(temp, root), dest); rmSync(temp, { recursive: true }); extracted[p.name] = dest;
    if (p.registry === 'crates') assert.equal(json(join(dest, '.cargo_vcs_info.json')).git.sha1, set.commit);
    else { const manifest = json(join(dest, 'package.json')); assert.equal(manifest.name, p.name); assert.equal(manifest.version, p.version); }
  }
  const cli = extracted['@getforma/create-app']; assert(!existsSync(join(cli, 'template-lock-seeds.json')));
  const templateSources = verifyPackedTemplateSources(cli, set.commit, set.contracts.sourceTemplates);
  const runtime = packedRuntimeLock(json(join(cli, 'package.json')), json(join(ROOT, 'package-lock.json')), 'packages/create-app');
  save(join(cli, 'package.json'), runtime.manifest); save(join(cli, 'package-lock.json'), runtime.lock);
  const cliLock = digest(join(cli, 'package-lock.json'));
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cli, { stdio: 'inherit' });
  assert.equal(digest(join(cli, 'package-lock.json')), cliLock); const cliSignatures = auditCandidateSignatures(cli, set.packages, dir);
  // The existing scaffold stager authenticates DS11, then localizes only Forma.
  const descriptor = scaffoldDescriptor(authenticated);
  const contextPath = join(work, 'context.json'); save(contextPath, { dir, recordSha256: descriptor.sha256, commit: set.commit, work });
  const templates = {};
  for (const template of templatesForPackages(set.packages)) {
    const name = `burn-in-${template}`, project = join(work, name), admin = join(project, 'admin');
    run(process.execPath, [join(cli, 'dist/index.js'), name, '--template', template], work, { env: { ...process.env, NODE_PATH: '' } });
    stageCandidateProject(contextPath, project);
    const lock = digest(join(admin, 'package-lock.json'));
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], admin, { stdio: 'inherit' });
    assertInstalledTemplateCandidates(admin, set.packages);
    const signatures = auditCandidateSignatures(admin, set.packages, dir);
    run('npm', ['run', template === 'minimal' ? 'build:ssr' : 'build'], admin, { stdio: 'inherit' });
    assert.equal(digest(join(admin, 'package-lock.json')), lock);
    run('cargo', ['build', '--locked', '--release'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_BUILD_JOBS: '3', CARGO_INCREMENTAL: '0' } });
    templates[template] = { project, binary: join(targetDir, 'release', name), manifest: json(join(admin, 'dist/manifest.json')), npmLockSha256: lock, signatures };
  }
  const sourceReport = {};
  const fixtures = await stageFixtureProject({ set, dir, cratesDir, targetDir, test, report: sourceReport, profile: 'release' });
  const skew = await preparePackedSkew({ set, dir, scratch: work, test, profile: 'release' });
  const fuzz = join(work, 'fuzz'); mkdirSync(fuzz);
  for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'fuzz_targets', 'regressions', 'seed-corpus.py']) cpSync(join(ROOT, 'fuzz', name), join(fuzz, name), { recursive: true });
  const fuzzManifest = join(fuzz, 'Cargo.toml'), original = readFileSync(fuzzManifest, 'utf8');
  assert(original.includes('path = "../crates/forma-ir"')); // Exact extracted sibling, not a source rewrite.
  writeFileSync(fuzzManifest, `${original}\n[patch.crates-io]\nforma-ir-derive = { path = ${JSON.stringify(join(cratesDir, 'forma-ir-derive'))} }\n`);
  writeFileSync(join(fuzz, 'Cargo.lock'), pruneCargoLock(readFileSync(join(fuzz, 'Cargo.lock'), 'utf8'), 'forma-ir-fuzz', version));
  const fuzzLock = digest(join(fuzz, 'Cargo.lock'));
  const fuzzEnv = { ...process.env, RUSTUP_TOOLCHAIN: 'nightly-2026-10-01', CARGO_TARGET_DIR: join(fuzz, 'target'), CARGO_BUILD_JOBS: '3' };
  run('cargo', ['fetch', '--locked'], fuzz, { stdio: 'inherit', env: fuzzEnv });
  const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--format-version', '1'], fuzz, { env: fuzzEnv }));
  const ir = metadata.packages.filter(p => p.name === 'forma-ir'); assert.equal(ir.length, 1); assert.equal(ir[0].version, version);
  assert.equal(realpathSync(ir[0].manifest_path), realpathSync(join(cratesDir, 'forma-ir/Cargo.toml')));
  const derive = metadata.packages.filter(p => p.name === 'forma-ir-derive'); assert.equal(derive.length, 1); assert.equal(derive[0].version, version);
  assert.equal(realpathSync(derive[0].manifest_path), realpathSync(join(cratesDir, 'forma-ir-derive/Cargo.toml')));
  run('python3', ['seed-corpus.py'], fuzz, { stdio: 'inherit' });
  for (const target of FUZZ_TARGETS) run('cargo', ['fuzz', 'build', target, '--sanitizer', 'address', '--fuzz-dir', fuzz], fuzz, { stdio: 'inherit', env: { ...fuzzEnv, CARGO_NET_OFFLINE: 'true' } });
  assert.equal(digest(join(fuzz, 'Cargo.lock')), fuzzLock, 'fuzzer compilation changed locked dependencies');
  const triple = /^host: (.+)$/m.exec(run('rustc', ['-vV'], fuzz, { env: fuzzEnv }))?.[1]; assert(triple);
  const binaries = Object.fromEntries(FUZZ_TARGETS.map(name => [name, join(fuzz, 'target', triple, 'release', name)]));
  for (const path of Object.values(binaries)) assert(existsSync(path), `missing precompiled ASan target ${path}`);
  return { extracted, templates, fixtures, skew, fuzz, binaries, sourceReport, templateSources, cliSignatures, cliLock, fuzzLock, metadata, descriptor };
}
