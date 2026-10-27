// Concurrency admission, never a test-selection or skip mechanism. Unknown
// initial inputs use the entire serial plan; drift after work starts is fatal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT, validatePartition } from './check-core-partition.mjs';

export const inputsFile = 'scripts/check-scheduler-inputs.json';
export const planFile = 'scripts/check-scheduler-workload.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (root, path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sourceOverrideKeys = ['FORMA_LIST_KEY_EVIDENCE', 'FORMA_LIST_KEY_CORE_BUNDLE', 'CARGO_TARGET_DIR',
  'FORMAJS_DIR', 'FORMA_DIR', 'FORMA_SCAFFOLD_CLI', 'FORMA_SCAFFOLD_CONTEXT', 'FORMA_SCAFFOLD_TEMPLATES',
  'FORMA_SCAFFOLD_REPORT_DIR', 'FORMA_EMITTER_PROBE_DIR', 'FORMA_TEST_BROWSER_CHANNEL'];
const preloadKeys = ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'LD_PRELOAD'];
export const fallbackContext = (platform = process.platform, env = process.env, cpus = availableParallelism()) => ({
  platform, availableParallelism: cpus, FORMA_SCAFFOLD_E2E: env.FORMA_SCAFFOLD_E2E === '1',
  // Record presence only, never caller paths or runtime-preload contents.
  ...Object.fromEntries(sourceOverrideKeys.map(key => [key, env[key] !== undefined])),
  ...Object.fromEntries(preloadKeys.map(key => [key, Boolean(env[key])])),
});

export function validatePlan(root = ROOT, plan = json(root, planFile)) {
  assert.equal(plan.schema, 2);
  const stages = plan.stages.map(row => row.id);
  assert(stages.length && new Set(stages).size === stages.length);
  assert.deepEqual(plan.serial, stages, 'serial order must retain the authoritative stage order');
  const catalogue = readFileSync(resolve(root, 'scripts/check-stages.sh'), 'utf8');
  const defined = [...catalogue.matchAll(/^    ([a-z0-9-]+)\)$/gm)].map(row => row[1]);
  assert.equal(new Set(defined).size, defined.length);
  const concurrent = [...plan.beforeFork, ...plan.a, ...plan.b, ...plan.afterJoin];
  assert.equal(new Set(concurrent).size, concurrent.length, 'a stage cannot execute in two phases');
  const expanded = stages.flatMap(id => plan.replacements[id] ?? [id]);
  assert.deepEqual([...concurrent].sort(), [...expanded, ...plan.additional].sort(), 'all work must occur exactly once');
  for (const id of [...stages, ...concurrent]) assert(defined.includes(id), `undefined stage ${id}`);
  assert.deepEqual(plan.resources, { a: { browserWorkers: 0, cargoPools: 0 }, b: { browserWorkers: 2, cargoPools: 0 } });
  for (const id of ['s15-cargo', 's25-worker', 's25-prepare']) assert(plan.beforeFork.includes(id));
  assert.deepEqual(plan.afterJoin.slice(0, 2), ['s12-exclusive', 's25-core-exclusive']);
  assert.deepEqual(plan.afterJoin.slice(-5), ['s26', 's28', 's29', 's30', 's31']);
  return plan;
}

function safePath(path) {
  assert(typeof path === 'string' && path && !isAbsolute(path) && !path.split('/').includes('..'), `invalid reviewed path ${path}`);
}

export function knownSetupCache(path, root, tracked = new Set()) {
  return !tracked.has(path)
    && /^scripts\/__pycache__\/prefer-ubuntu-archive\.cpython-3\d{1,2}\.pyc$/.test(path)
    && lstatSync(resolve(root, 'scripts/__pycache__')).isDirectory()
    && lstatSync(resolve(root, path)).isFile();
}

// The manifest contains explicit closed roots and generated-output exclusions.
// Filesystem discovery includes ignored/untracked new helpers inside those roots.
// No runtime command writes or refreshes the reviewed manifest.
export function collectResourceInputs(root, manifest) {
  assert.equal(manifest.schema, 2);
  for (const path of [...manifest.roots, ...manifest.files, ...(manifest.immediateFiles ?? []), ...manifest.excludePaths, ...manifest.excludeTrees]) safePath(path);
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
  const excluded = path => path === inputsFile || manifest.excludePaths.includes(path)
    || manifest.excludeTrees.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  const rows = new Map();
  const visit = path => {
    if (excluded(path)) return;
    if (path.startsWith('scripts/__pycache__/')) {
      assert(knownSetupCache(path, root, tracked), `unreviewed setup-cache entry: ${path}`);
      return;
    }
    const stat = lstatSync(resolve(root, path));
    assert(!stat.isSymbolicLink(), `resource input symlink requires review: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(resolve(root, path)).sort()) {
        if (manifest.generatedDirectoryNames.includes(name)) continue;
        visit(`${path}/${name}`);
      }
    } else {
      assert(stat.isFile(), `unsupported resource input ${path}`);
      rows.set(path, { path, sha256: hash(readFileSync(resolve(root, path))) });
    }
  };
  for (const directory of manifest.immediateFiles ?? []) {
    for (const name of readdirSync(resolve(root, directory)).sort()) {
      const path = directory === '.' ? name : `${directory}/${name}`;
      const stat = lstatSync(resolve(root, path));
      // A new root/package config or local imported helper cannot hide behind
      // the finite list of filenames that happened to exist during review.
      if (!stat.isDirectory() || stat.isSymbolicLink()) visit(path);
    }
  }
  for (const path of [...manifest.roots, ...manifest.files]) visit(path);
  assert(rows.size > 0, 'empty resource review');
  return [...rows.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function validateResourceProfiles(manifest) {
  assert.equal(manifest.schema, 2);
  const profiles = Object.entries(manifest.profiles);
  assert(profiles.length > 0, 'no reviewed version profile');
  const allowed = new Set(manifest.versionFiles);
  assert.equal(allowed.size, manifest.versionFiles.length, 'duplicate version-transform input');
  for (const path of allowed) safePath(path);
  let baseline;
  for (const [version, inputs] of profiles) {
    assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), 'invalid profile version');
    assert(inputs.length > 0, 'empty reviewed profile');
    const paths = inputs.map(row => row.path);
    assert.equal(new Set(paths).size, paths.length, 'duplicate reviewed input');
    for (const row of inputs) { safePath(row.path); assert(/^[a-f0-9]{64}$/.test(row.sha256), 'invalid reviewed hash'); }
    assert(paths.includes('packages/core/package.json'), 'missing coordinated version selector');
    for (const path of allowed) assert(paths.includes(path), `version transform missing from full profile: ${path}`);
    if (!baseline) baseline = inputs;
    else {
      assert.deepEqual(paths, baseline.map(row => row.path), 'complete profile membership differs');
      for (let i = 0; i < inputs.length; i++)
        if (inputs[i].sha256 !== baseline[i].sha256)
          assert(allowed.has(inputs[i].path), `non-version input differs between profiles: ${inputs[i].path}`);
    }
  }
  return manifest;
}

export function resourceDrift(root = ROOT, manifest = json(root, inputsFile)) {
  validateResourceProfiles(manifest);
  const profileVersion = json(root, 'packages/core/package.json').version;
  const selected = manifest.profiles[profileVersion];
  assert(selected, `unreviewed coordinated version: ${profileVersion}`);
  const actual = collectResourceInputs(root, manifest);
  const expected = new Map(selected.map(row => [row.path, row.sha256]));
  const reasons = [];
  for (const row of actual) {
    if (!expected.has(row.path)) reasons.push(`unreviewed input: ${row.path}`);
    else if (expected.get(row.path) !== row.sha256) reasons.push(`changed input: ${row.path}`);
    expected.delete(row.path);
  }
  for (const path of expected.keys()) reasons.push(`missing input: ${path}`);
  return { reasons, inputs: actual, profileVersion };
}

export function ancestorConfigurationRefusals(root = ROOT) {
  const names = ['tsup.config.ts', 'tsup.config.cts', 'tsup.config.mts', 'tsup.config.js',
    'tsup.config.cjs', 'tsup.config.mjs', 'tsup.config.json', 'tsconfig.json'];
  const reasons = [];
  // tsup's locked config loader walks ancestors to the filesystem root. Such
  // inputs cannot be part of a portable repository snapshot: refuse overlap.
  for (let directory = dirname(realpathSync(root)); ; directory = dirname(directory)) {
    for (const name of names) if (existsSync(resolve(directory, name)))
      reasons.push(`unreviewed ancestor configuration: ${resolve(directory, name)}`);
    const pkg = resolve(directory, 'package.json');
    if (existsSync(pkg)) {
      try { if (Object.hasOwn(JSON.parse(readFileSync(pkg, 'utf8')), 'tsup')) reasons.push(`unreviewed ancestor tsup package configuration: ${pkg}`); }
      catch { reasons.push(`unreadable ancestor package configuration: ${pkg}`); }
    }
    if (dirname(directory) === directory) break;
  }
  return reasons;
}

export function decideSchedule(root = ROOT, context = fallbackContext()) {
  const plan = validatePlan(root);
  const reasons = [];
  if (context.platform !== 'linux') reasons.push('original non-Linux serial context');
  if (!Number.isInteger(context.availableParallelism) || context.availableParallelism < 4)
    reasons.push('complete serial on fewer than four available CPUs; preserve original browser-worker default');
  if (context.FORMA_SCAFFOLD_E2E === true) reasons.push('original heavy scaffold context');
  for (const key of [...sourceOverrideKeys, ...preloadKeys])
    if (context[key]) reasons.push(`original serial context: ${key}`);
  let inputs = [], manifestSha256 = null, profileVersion = null;
  if (!reasons.length) {
    try {
      manifestSha256 = hash(readFileSync(resolve(root, inputsFile)));
      reasons.push(...ancestorConfigurationRefusals(root));
      const drift = resourceDrift(root); inputs = drift.inputs; profileVersion = drift.profileVersion; reasons.push(...drift.reasons);
      validatePartition(root);
    } catch (error) { reasons.push(`resource admission refused: ${error.message}`); }
  }
  return { schema: 1, mode: reasons.length ? 'serial' : 'linux-overlap', reasons, context,
    manifestSha256, profileVersion, planSha256: hash(readFileSync(resolve(root, planFile))),
    inputSnapshotSha256: hash(JSON.stringify(inputs)), inputs, plan };
}

export function assertAdmissionUnchanged(directory, root = ROOT, context = fallbackContext()) {
  const original = json(directory, 'admission.json');
  const current = decideSchedule(root, context);
  assert.equal(original.mode, 'linux-overlap');
  assert.equal(current.mode, 'linux-overlap', `resource inputs changed after start: ${current.reasons.join('; ')}`);
  for (const key of ['manifestSha256', 'profileVersion', 'planSha256', 'inputSnapshotSha256'])
    assert.equal(current[key], original[key], `admission ${key} changed after start`);
  return original;
}

export function evidenceDirectory(root = ROOT, parent = process.env.RUNNER_TEMP || tmpdir()) {
  const physical = realpathSync(parent), inside = relative(realpathSync(root), physical);
  assert(inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside), 'scheduler evidence parent must be outside source');
  return mkdtempSync(resolve(physical, 'forma-r17-'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  if (command === '--plan') {
    assert(['serial', 'beforeFork', 'a', 'b', 'afterJoin'].includes(argument));
    console.log(validatePlan()[argument].join(' '));
  } else if (command === '--admit') {
    const decision = decideSchedule(), directory = evidenceDirectory();
    const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    Object.assign(decision, { recordedAt: new Date().toISOString(), sourceCommit: git(['rev-parse', 'HEAD']),
      sourceStatus: git(['status', '--short']), trackedDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: ROOT })) });
    writeFileSync(resolve(directory, 'admission.json'), JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
    console.log(directory);
  } else if (command === '--mode' || command === '--explain') {
    const decision = json(argument, 'admission.json');
    if (command === '--mode') { assert(['serial', 'linux-overlap'].includes(decision.mode)); console.log(decision.mode); }
    else for (const reason of decision.reasons) console.log(`R17 complete serial fallback: ${reason}`);
  } else if (command === '--complete') {
    const decision = json(argument, 'admission.json');
    writeFileSync(resolve(argument, 'complete.json'), JSON.stringify({ complete: true, finishedAt: new Date().toISOString(),
      mode: decision.mode, sourceCommit: decision.sourceCommit, admissionSha256: hash(readFileSync(resolve(argument, 'admission.json'))) }, null, 2) + '\n', { flag: 'wx' });
  } else throw Error('unknown scheduler admission command');
}
