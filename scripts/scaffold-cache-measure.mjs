// FORMA-262: cold and restored-cache builds run on separate hosted runners.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { preparePublished } from './published-scaffold.mjs';

// Measure an immutable, authenticated release: source templates are intentionally
// unsealed lock seeds until packaging. Packing correctness has its own CI lane.
const baselineVersion = '3.0.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, template, phase] = process.argv.slice(2);
assert(['minimal', 'dashboard'].includes(template), 'unknown template');
const project = resolve(root, '..', `cache-${template}`);
function run(program, args, cwd, capture = false) {
  const started = performance.now();
  const result = spawnSync(program, args, { cwd, encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit', maxBuffer: 32 * 1024 * 1024,
    timeout: 15 * 60 * 1000 });
  if (result.status !== 0) throw new Error(`${program} failed: ${result.error ?? result.stderr ?? result.status}`);
  return { ms: performance.now() - started, stdout: result.stdout };
}
if (command === 'prepare') {
  assert(!existsSync(project), 'measurement directory must be fresh');
  const context = await preparePublished(resolve(root, '..', `cache-cli-${template}`), fetch, baselineVersion);
  run(process.execPath, [context.cli, `cache-${template}`, '--template', template], dirname(root));
} else {
  assert.equal(command, 'build');
  assert(['cold', 'warm'].includes(phase), 'unknown phase');
  if (phase === 'warm') {
    assert.equal(process.env.FORMA_CACHE_HIT, 'true', 'warm measurement needs an exact restored cache');
    const file = resolve(project, 'admin/src', template === 'minimal' ? 'home/app.tsx' : 'app.tsx');
    const before = readFileSync(file, 'utf8');
    const marker = template === 'minimal' ? 'Rust server, TypeScript frontend' : 'Infrastructure Overview';
    assert(before.includes(marker), 'page-edit anchor missing');
    writeFileSync(file, before.replace(marker, `${marker} (cache measurement)`));
  }
  run('npm', ['ci'], resolve(project, 'admin'));
  const frontend = run('npm', ['run', template === 'minimal' ? 'build:ssr' : 'build'], resolve(project, 'admin'));
  const cargo = run('cargo', ['build', '--release', '--locked', '--message-format=json', '--timings'], project, true);
  const artifacts = cargo.stdout.trim().split('\n').map(line => JSON.parse(line))
    .filter(message => message.reason === 'compiler-artifact');
  const rebuilt = artifacts.filter(message => !message.fresh);
  const dependencies = rebuilt.filter(message => !message.package_id.startsWith('path+'));
  assert(rebuilt.some(message => message.package_id.startsWith('path+')), 'the page build must recompile the application');
  if (phase === 'warm') assert.equal(dependencies.length, 0, 'restored cache unexpectedly recompiled dependencies');
  else assert(dependencies.length > 0, 'cold control must compile dependencies');
  const report = { template, phase, baselineVersion, commit: process.env.GITHUB_SHA,
    run: process.env.GITHUB_RUN_ID, cacheHit: process.env.FORMA_CACHE_HIT,
    frontendMs: frontend.ms, releaseMs: cargo.ms,
    rebuilt: rebuilt.map(message => message.package_id),
    dependencyRebuilds: dependencies.length };
  writeFileSync(resolve(root, `scaffold-cache-${template}-${phase}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
