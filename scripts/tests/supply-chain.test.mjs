import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const run = (command, args, cwd, env = {}) => spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
const scratch = (t) => { const p = mkdtempSync(join(tmpdir(), 'forma-supply-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
const success = (r) => assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
const script = (p, text) => writeFileSync(p, `#!/usr/bin/env bash\nset -eu\n${text}\n`, { mode: 0o755 });

test('SR30: a real packed dependency installs but its postinstall never runs, even when user config permits scripts', (t) => {
  const dir = scratch(t), dep = join(dir, 'dep'), app = join(dir, 'app');
  mkdirSync(dep); mkdirSync(app);
  const marker = join(dir, 'postinstall-ran');
  writeFileSync(join(dep, 'package.json'), JSON.stringify({ name: 'forma-install-hook-probe', version: '1.0.0', scripts: { postinstall: 'node hook.cjs' } }));
  writeFileSync(join(dep, 'hook.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe hook ran');`);
  success(run('npm', ['pack', '--ignore-scripts', '--offline', '--pack-destination', dir], dep));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'install-probe', version: '1.0.0', dependencies: { 'forma-install-hook-probe': 'file:../forma-install-hook-probe-1.0.0.tgz' } }));
  success(run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit'], app));
  const lock = readFileSync(join(app, 'package-lock.json'), 'utf8');
  success(run('bash', [join(root, 'scripts/install-deps.sh'), app], root, { npm_config_ignore_scripts: 'false', npm_config_dangerously_allow_all_scripts: 'true', npm_config_offline: 'true' }));
  assert.ok(existsSync(join(app, 'node_modules/forma-install-hook-probe/hook.cjs')));
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(join(app, 'package-lock.json'), 'utf8'), lock);
  // Negative control proves the marker detects the actual installed hook.
  success(run('node', ['node_modules/forma-install-hook-probe/hook.cjs'], app));
  assert.equal(readFileSync(marker, 'utf8'), 'unsafe hook ran');
});

test('locked installer refuses a project without its committed lock', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'package.json'), '{"name":"unlocked"}');
  const r = run('bash', [join(root, 'scripts/install-deps.sh'), dir], root);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /committed package-lock/);
});

for (const mode of ['ok', 'npm-advisory', 'npm-unreachable', 'rust-unreachable', 'rust-advisory']) {
  test(`SR4: advisory boundary ${mode}`, (t) => {
    const dir = scratch(t), log = join(dir, 'calls');
    // Substitute only external tool/network boundaries. Exercise the real gate.
    script(join(dir, 'npm'), `echo "npm $*" >> "$PROBE_LOG"\ncase "$PROBE_MODE" in npm-advisory) echo 'known vulnerability' >&2; exit 1;; npm-unreachable) echo 'ECONNREFUSED advisory source' >&2; exit 1;; esac`);
    script(join(dir, 'cargo'), `echo "cargo $*" >> "$PROBE_LOG"\nif [[ "$PROBE_MODE" == rust-unreachable && "$*" == *'fetch db'* ]]; then echo 'advisory fetch unavailable' >&2; exit 1; fi\nif [[ "$PROBE_MODE" == rust-advisory && "$*" == *'check advisories'* ]]; then echo 'RUSTSEC vulnerability' >&2; exit 1; fi`);
    const r = run('bash', [join(root, 'scripts/check-advisories.sh')], root, { PATH: `${dir}:${process.env.PATH}`, PROBE_LOG: log, PROBE_MODE: mode });
    const calls = readFileSync(log, 'utf8');
    if (mode === 'ok') { success(r); assert.equal((calls.match(/npm audit --omit=dev/g) || []).length, 3); assert.match(calls, /deny --locked .*fetch db/); assert.match(calls, /deny --locked .*check advisories/); }
    else { assert.notEqual(r.status, 0); if (mode === 'rust-unreachable') assert.doesNotMatch(calls, /check advisories/); if (mode.startsWith('npm-')) assert.doesNotMatch(calls, /cargo/); }
  });
}

const policyFixture = (dir) => {
  for (const folder of ['.github/workflows', 'packages/core', 'packages/create-app/templates/minimal/admin', 'packages/create-app/templates/dashboard/admin']) mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({ dependencies: { 'alien-signals': '3.1.2' } }));
  for (const folder of ['', 'packages/create-app/templates/minimal/admin', 'packages/create-app/templates/dashboard/admin']) writeFileSync(join(dir, folder, folder === '' ? '.npmrc' : '_npmrc'), 'ignore-scripts=true\n');
  writeFileSync(join(dir, '.github/workflows/ci.yml'), `jobs:\n  test:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n      - run: npm ci --ignore-scripts\n      - run: cargo test --locked\n`);
};
for (const [name, mutate] of [
  ['unpinned action', s => s.replace(/@[a-f0-9]{40}/, '@v4')],
  ['script-enabled npm ci', s => s.replace(' --ignore-scripts', '')],
  ['unlocked Cargo', s => s.replace(' --locked', '')],
  ['retired dispatch', s => `${s}      - run: echo core-release\n`],
]) test(`policy mutation rejects ${name}`, (t) => {
  const dir = scratch(t); policyFixture(dir);
  success(run('ruby', [join(root, 'scripts/check-supply-chain.rb'), dir], root));
  const path = join(dir, '.github/workflows/ci.yml'); writeFileSync(path, mutate(readFileSync(path, 'utf8')));
  assert.notEqual(run('ruby', [join(root, 'scripts/check-supply-chain.rb'), dir], root).status, 0);
});

test('published-crate polling bounds curl and sleep by one wall-clock deadline', (t) => {
  const dir = scratch(t), log = join(dir, 'calls'), now = join(dir, 'clock');
  writeFileSync(now, '0');
  script(join(dir, 'date'), 'cat "$PROBE_CLOCK"');
  script(join(dir, 'curl'), `echo "$*" >> "$PROBE_LOG"\nprevious=''\nfor arg in "$@"; do if [ "$previous" = --max-time ]; then seconds=$arg; fi; previous=$arg; done\necho "$(( $(cat "$PROBE_CLOCK") + seconds ))" > "$PROBE_CLOCK"\nexit 28`);
  script(join(dir, 'sleep'), 'echo "unexpected sleep" >> "$PROBE_LOG"; exit 1');
  const r = run('bash', [join(root, 'scripts/check-published-crate.sh'), 'forma-ir', '0.2.2', 'a'.repeat(64)], root, { PATH: `${dir}:${process.env.PATH}`, PROBE_CLOCK: now, PROBE_LOG: log, CHECK_TIMEOUT: '2', CHECK_ATTEMPTS: '30', CHECK_INTERVAL: '30' });
  success(r);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /--max-time 2 /); assert.equal(calls.trim().split('\n').length, 1); assert.doesNotMatch(calls, /sleep/);
  assert.match(r.stdout, /not visible yet/);
});
