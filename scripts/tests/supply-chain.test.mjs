import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from 'node:fs';
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
  writeFileSync(join(dir, '.github/workflows/ci.yml'), `jobs:\n  test:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v1.2.3\n      - run: npm ci --ignore-scripts\n      - run: cargo test --locked\n`);
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

// FORMA-117: every SHA-pinned third-party action ends with `# v<major>[.<minor>[.<patch>]]`
// (Dependabot keeps that comment current with the SHA). release.yml is included even
// though check-supply-chain.rb leaves its pin shape to check-release-workflow.rb.
const PIN = '11d5960a326750d5838078e36cf38b85af677262';
const lint = (dir) => run('ruby', [join(root, 'scripts/check-supply-chain.rb'), dir], root);
const steps = (body) => `jobs:\n  build:\n    steps:\n${body}\n`;
const commentFixture = (t, name, yaml) => {
  const dir = scratch(t); policyFixture(dir);
  writeFileSync(join(dir, '.github/workflows', name), yaml);
  return dir;
};
for (const [name, body] of [
  ['a patch version', `      - uses: actions/checkout@${PIN} # v4.2.2`],
  ['a minor version', `      - uses: actions/checkout@${PIN} # v4.2`],
  ['a major version', `      - uses: actions/checkout@${PIN} # v4`],
  ['a step that names itself first', `      - name: Checkout\n        uses: actions/checkout@${PIN} # v4.2.2`],
  ['a quoted action', `      - uses: "actions/checkout@${PIN}" # v4.2.2`],
  ['extra spaces before the comment', `      - uses: actions/checkout@${PIN}    # v4.2.2`],
  ['a local action, which has no SHA to explain', '      - uses: ./.github/actions/local'],
  ['the branch-published toolchain action pinned from stable', `      - uses: dtolnay/rust-toolchain@${PIN} # stable`],
  ['the branch-published toolchain action pinned from master', `      - uses: dtolnay/rust-toolchain@${PIN} # master`],
  ['uses text inside a run script', `      - run: |\n          uses: actions/checkout@${PIN}`],
  ['a commented-out step', `      # - uses: actions/checkout@${PIN}\n      - run: echo ok`],
]) test(`version comment lint accepts ${name}`, (t) => success(lint(commentFixture(t, 'extra.yml', steps(body)))));

test('version comment lint accepts a local reusable workflow job and requires a comment on a remote one', (t) => {
  const local = commentFixture(t, 'extra.yml', 'jobs:\n  call:\n    uses: ./.github/workflows/other.yml\n');
  success(lint(local));
  const remote = commentFixture(t, 'extra.yml', `jobs:\n  call:\n    uses: org/repo/.github/workflows/x.yml@${PIN}\n`);
  const r = lint(remote); assert.notEqual(r.status, 0); assert.match(r.stderr, /extra\.yml:3: call: org\/repo\/\.github\/workflows\/x\.yml@[a-f0-9]{40} needs a trailing/);
  success(lint(commentFixture(t, 'extra.yml', `jobs:\n  call:\n    uses: org/repo/.github/workflows/x.yml@${PIN} # v1.0.0\n`)));
});

for (const [name, body, found] of [
  ['no comment', `      - uses: actions/checkout@${PIN}`, /found: none\)$/],
  ['a comment on the line above', `      # v4.2.2\n      - uses: actions/checkout@${PIN}`, /found: none\)$/],
  ['a comment on the line below', `      - uses: actions/checkout@${PIN}\n      # v4.2.2\n      - run: echo ok`, /found: none\)$/],
  ['a comment on another key of the step', `      - uses: actions/checkout@${PIN}\n        with: {} # v4.2.2`, /found: none\)$/],
  ['a branch name', `      - uses: actions/checkout@${PIN} # main`, /found: # main\)$/],
  ['stable on an action that publishes release tags', `      - uses: actions/checkout@${PIN} # stable`, /found: # stable\)$/],
  ['a version without the v', `      - uses: actions/checkout@${PIN} # 4.2.2`, /found: # 4\.2\.2\)$/],
  ['a capital V', `      - uses: actions/checkout@${PIN} # V4.2.2`, /found: # V4\.2\.2\)$/],
  ['no space after the hash', `      - uses: actions/checkout@${PIN} #v4.2.2`, /found: #v4\.2\.2\)$/],
  ['four version parts', `      - uses: actions/checkout@${PIN} # v4.2.2.1`, /found: # v4\.2\.2\.1\)$/],
  ['a wildcard version', `      - uses: actions/checkout@${PIN} # v4.x`, /found: # v4\.x\)$/],
  ['a bare v', `      - uses: actions/checkout@${PIN} # v`, /found: # v\)$/],
  ['words after the version', `      - uses: actions/checkout@${PIN} # v4.2.2 latest`, /found: # v4\.2\.2 latest\)$/],
  ['an empty comment', `      - uses: actions/checkout@${PIN} #`, /found: #\)$/],
  ['an unlisted branch on the branch-published toolchain action', `      - uses: dtolnay/rust-toolchain@${PIN} # nightly`, /found: # nightly\)$/],
  ['no comment on the branch-published toolchain action', `      - uses: dtolnay/rust-toolchain@${PIN}`, /found: none\)$/],
]) test(`version comment lint rejects ${name}`, (t) => {
  const r = lint(commentFixture(t, 'extra.yml', steps(body)));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /extra\.yml:\d+: build: [\w.\/-]+@[a-f0-9]{40} needs a trailing/);
  assert.match(r.stderr.trim(), found); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
});

for (const [name, body] of [
  ['a tag with a version comment', `      - uses: actions/checkout@v4 # v4.2.2`],
  ['a tag without one', `      - uses: actions/checkout@v4`],
  ['an abbreviated SHA with a version comment', `      - uses: actions/checkout@${PIN.slice(0, 7)} # v4.2.2`],
  ['an abbreviated SHA without one', `      - uses: actions/checkout@${PIN.slice(0, 7)}`],
]) test(`version comment lint leaves ${name} to the 40-hex pin check, which still rejects it once`, (t) => {
  const r = lint(commentFixture(t, 'extra.yml', steps(body)));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /action must be pinned by SHA/);
  assert.doesNotMatch(r.stderr, /needs a trailing/); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
});

test('version comment lint covers release.yml, which the 40-hex pin check leaves to check-release-workflow.rb', (t) => {
  success(lint(commentFixture(t, 'release.yml', steps(`      - uses: actions/checkout@${PIN} # v4.2.2`))));
  const r = lint(commentFixture(t, 'release.yml', steps(`      - uses: actions/checkout@${PIN}`)));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /release\.yml:4: build: actions\/checkout@[a-f0-9]{40} needs a trailing/);
});

test('version comment lint covers .yaml workflow files as well as .yml', (t) => {
  success(lint(commentFixture(t, 'extra.yaml', steps(`      - uses: actions/checkout@${PIN} # v4.2.2`))));
  const r = lint(commentFixture(t, 'extra.yaml', steps(`      - uses: actions/checkout@${PIN}`)));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /extra\.yaml:4: build: actions\/checkout@[a-f0-9]{40} needs a trailing/);
});

test('version comment lint reports every offending pin with its file, line and job', (t) => {
  const dir = commentFixture(t, 'extra.yml', `jobs:\n  one:\n    steps:\n      - uses: actions/checkout@${PIN}\n      - uses: actions/setup-node@${PIN} # v4\n  two:\n    steps:\n      - uses: actions/cache@${PIN}\n`);
  const r = lint(dir); assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n'); assert.equal(lines.length, 2, r.stderr);
  assert.match(lines[0], /extra\.yml:4: one: actions\/checkout@/); assert.match(lines[1], /extra\.yml:8: two: actions\/cache@/);
});

// The live workflows: an independent reading of the text, then a mutation of every file.
const liveWorkflows = () => {
  const folder = join(root, '.github/workflows');
  return readdirSync(folder).filter(name => /\.ya?ml$/.test(name)).sort().map(name => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
};
const pinLine = /^\s*(?:-\s+)?uses:\s+(\S+)@([a-f0-9]{40})(.*)$/;

test('every SHA-pinned action in the live workflows carries its release comment, one comment per SHA', () => {
  const comments = new Map(); let pins = 0;
  for (const { name, text } of liveWorkflows()) text.split('\n').forEach((line, index) => {
    const m = pinLine.exec(line); if (!m) return;
    pins += 1; const [, action, sha, rest] = m, here = `${name}:${index + 1}`;
    const comment = /^\s+(# (?:v\d+(?:\.\d+){0,2}|stable|master))\s*$/.exec(rest)?.[1];
    assert.ok(comment, `${here}: ${action}@${sha} has no version comment`);
    if (/^# (?:stable|master)$/.test(comment)) assert.equal(action, 'dtolnay/rust-toolchain', `${here}: only the branch-published toolchain action may name a branch`);
    const key = `${action}@${sha}`; assert.equal(comments.get(key) ?? comment, comment, `${here}: ${key} carries two different comments`);
    comments.set(key, comment);
  });
  assert.ok(pins >= 50, `read only ${pins} pins`);
  success(lint(root));
});

test('removing the comment from one pin of any live workflow is rejected, release.yml included', (t) => {
  const live = liveWorkflows();
  const withPins = live.filter(({ text }) => text.split('\n').some(line => pinLine.test(line)));
  assert.ok(withPins.some(({ name }) => name === 'release.yml') && withPins.some(({ name }) => name === 'ci.yml'));
  for (const { name, text } of withPins) {
    const dir = scratch(t); policyFixture(dir);
    for (const other of live) writeFileSync(join(dir, '.github/workflows', other.name), other.text);
    success(lint(dir));
    let stripped = false;
    const mutated = text.split('\n').map(line => (!stripped && pinLine.test(line) && /\s#\s/.test(line) ? (stripped = true, line.replace(/\s+#.*$/, '')) : line)).join('\n');
    assert.ok(stripped && mutated !== text, `${name} has no commented pin to strip`);
    writeFileSync(join(dir, '.github/workflows', name), mutated);
    const r = lint(dir);
    assert.notEqual(r.status, 0, name); assert.match(r.stderr, new RegExp(`${name.replace('.', '\\.')}:\\d+: `));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
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
