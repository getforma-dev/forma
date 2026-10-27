// R17 prototype only: immutable, disjoint whole-file partitions. No test bodies,
// hooks, profiles, timeouts, samples, expected failures or assertions change.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const manifestPath = fileURLToPath(new URL('./check-core-partition.json', import.meta.url));
export const PROTOTYPE_FILES = ['scripts/check-core-partition.json', 'scripts/check-core-partition.mjs',
  'scripts/check-scheduler-workload.json', 'scripts/check-scheduler-prototype.sh',
  'scripts/check-scheduler-lanes.sh', 'scripts/check-scheduler-pair.mjs',
  'scripts/check-scheduler.test.mjs', 'scripts/check-scheduler-owned.test.mjs'];
const digest = value => createHash('sha256').update(value).digest('hex');
export function validatePrototypeSource(root = ROOT) {
  const source = JSON.parse(readFileSync(resolve(root, 'scripts/check-core-partition.json'))).source;
  assert.equal(source, '0cf47cdd6b487543f488f60695f74553282bbe9c');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  // This prototype admits only its eight new harness files over the reviewed
  // source. A new workspace test/helper is a new resource audit, not implicit
  // permission to run an undiscovered browser/Cargo writer in a concurrent lane.
  const changed = git(['diff', '--name-only', '-z', source, '--']);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
  assert.deepEqual([...new Set([...changed, ...untracked])].filter(path => !PROTOTYPE_FILES.includes(path)), [],
    'review source/resource drift before using the scheduler prototype');
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), `partition discovery refuses symlink ${path}`);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
export function validatePartition(root = ROOT, inventory = JSON.parse(readFileSync(manifestPath))) {
  assert.equal(inventory.schema, 1);
  for (const row of inventory.configuration ?? [])
    assert.equal(digest(readFileSync(resolve(root, row.file))), row.sha256, `review changed configuration: ${row.file}`);
  // Core has no explicit Playwright testMatch: mirror its locked default,
  // including newly added .test/.spec JS/TS, CJS/MJS and JSX/TSX variants.
  for (const [kind, directory, pattern] of [['unit', 'src', /\.test\.tsx?$/], ['browser', 'e2e', /\.(?:test|spec)\.[cm]?[jt]sx?$/]]) {
    const core = resolve(root, 'packages/core');
    const files = walk(resolve(core, directory)).filter(path => pattern.test(path)).map(path => relative(core, path).replaceAll('\\', '/')).sort();
    const rows = inventory.groups[kind];
    assert(rows.length > 0, `${kind} inventory empty`);
    assert.deepEqual(rows.map(row => row.file).sort(), files, `${kind} partition must cover every original file exactly once`);
    for (const row of rows) {
      assert(['overlap', 'exclusive'].includes(row.phase), `unknown phase for ${row.file}`);
      assert.equal(digest(readFileSync(resolve(core, row.file))), row.sha256, `review changed file before admission: ${row.file}`);
    }
    assert(rows.some(row => row.phase === 'overlap') && rows.some(row => row.phase === 'exclusive'));
  }
  const required = {
    unit: ['src/dom/__tests__/list-lis.test.ts', 'src/expr/__tests__/native-cost.test.ts'],
    browser: ['e2e/expr-cost.spec.ts', 'e2e/sr33.spec.ts', 'e2e/state-roundtrip.spec.ts'],
  };
  for (const [kind, files] of Object.entries(required)) for (const file of files)
    assert.equal(inventory.groups[kind].find(row => row.file === file)?.phase, 'exclusive', `${file} must remain exclusive`);
  return inventory;
}

export function partitionCommand(kind, phase, root = ROOT, inventory = validatePartition(root), output) {
  assert(['unit', 'browser'].includes(kind) && ['overlap', 'exclusive'].includes(phase));
  const files = inventory.groups[kind].filter(row => row.phase === phase).map(row => row.file);
  assert(files.length > 0);
  if (kind === 'unit') {
    // Vitest's file filters are path substrings. Prove that these literal full
    // relative filenames select exactly this partition, not similar filenames.
    assert.deepEqual(inventory.groups.unit.filter(row => files.some(file => row.file.includes(file))).map(row => row.file).sort(), [...files].sort());
    return { command: 'npm', args: ['test', '-w', 'packages/core', '--', ...files], cwd: root, files };
  }
  assert(output && output !== resolve(root, 'packages/core/test-results'), 'use a distinct retained output for each core partition');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Playwright uses regex file filters. Anchored full paths include whole files;
  // no title grep, skip, test body rewrite or shared output-directory deletion.
  return { command: 'npx', args: ['playwright', 'test', '--project=chromium', '--workers=2', '--output', output,
    ...files.map(file => `^${escape(resolve(root, 'packages/core', file))}$`)], cwd: resolve(root, 'packages/core'), files };
}

export function partitionCommands(kind, phase, root = ROOT, inventory = validatePartition(root), output) {
  const grouped = partitionCommand(kind, phase, root, inventory, output);
  if (phase === 'overlap') return [grouped];
  // Exclusive means exclusive from each other as well as both joined lanes.
  // Preserve each complete file, hooks and worker ceiling; never overlap a
  // timing/heap file with the state-roundtrip Cargo producer or another file.
  return grouped.files.map((file, index) => ({ ...grouped, files: [file],
    args: kind === 'unit' ? [...grouped.args.slice(0, 4), file]
      : [...grouped.args.slice(0, 5), resolve(output, String(index + 1)), grouped.args[6 + index]],
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validatePrototypeSource();
  const [kind, phase, output] = process.argv.slice(2);
  const inventory = validatePartition();
  if (kind === '--verify') {
    console.log(JSON.stringify({ unit: inventory.groups.unit.length, browser: inventory.groups.browser.length, unchangedBodies: true }));
  } else {
    const items = partitionCommands(kind, phase, ROOT, inventory, output && resolve(output));
    for (const item of items) {
      console.log(`core ${kind}/${phase}: ${item.files.length} complete files (${item.files.join(', ')})`);
      const child = spawnSync(item.command, item.args, { cwd: item.cwd, stdio: 'inherit', shell: process.platform === 'win32' });
      if (child.error) throw child.error;
      assert.equal(child.signal, null, `core partition terminated by ${child.signal}`);
      if (child.status !== 0) { process.exitCode = child.status ?? 1; break; }
    }
  }
}
