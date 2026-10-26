import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
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
    if (mode === 'ok') { success(r); assert.equal((calls.match(/npm audit --omit=dev/g) || []).length, 4); assert.match(calls, /deny --locked .*fetch db/); assert.match(calls, /deny --locked .*check advisories/); }
    else { assert.notEqual(r.status, 0); if (mode === 'rust-unreachable') assert.doesNotMatch(calls, /check advisories/); if (mode.startsWith('npm-')) assert.doesNotMatch(calls, /cargo/); }
  });
}

// Exercise the real shell with controlled external tools, including a failure
// visible only in the newly shipped starter (root/two old starter audits pass).
const advisoryFixture = (t, version, { native = true } = {}) => {
  const dir = scratch(t), bin = join(dir, 'bin'), log = join(dir, 'calls');
  mkdirSync(bin); mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'packages/core'), { recursive: true });
  for (const name of ['check-advisories.sh', 'release-package-inventory.mjs', 'template-lock-seeds.mjs']) copyFileSync(join(root, 'scripts', name), join(dir, 'scripts', name));
  writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({ version }));
  for (const name of ['minimal', 'dashboard', ...(native ? ['native-router'] : [])]) mkdirSync(join(dir, 'packages/create-app/templates', name, 'admin'), { recursive: true });
  script(join(bin, 'npm'), 'echo "npm $PWD $*" >> "$PROBE_LOG"\nif [[ "$PWD" == */native-router/admin && "$PROBE_MODE" != ok ]]; then echo "$PROBE_MODE in native-router" >&2; exit 1; fi');
  script(join(bin, 'cargo'), 'echo "cargo $*" >> "$PROBE_LOG"');
  return { dir, log, env: { PATH: `${bin}:${process.env.PATH}`, PROBE_LOG: log, PROBE_MODE: 'ok' } };
};
for (const mode of ['ok', 'npm-advisory', 'npm-unreachable']) test(`SR4: native-router-only advisory boundary ${mode}`, t => {
  const f = advisoryFixture(t, '3.2.0-rc.1');
  const r = run('bash', [join(f.dir, 'scripts/check-advisories.sh')], f.dir, { ...f.env, PROBE_MODE: mode });
  const calls = readFileSync(f.log, 'utf8').trim().split('\n');
  assert.equal(calls.filter(line => line.startsWith('npm ')).length, 4);
  assert.match(calls[3], /native-router\/admin audit --omit=dev$/);
  if (mode === 'ok') { success(r); assert.equal(calls.filter(line => line.startsWith('cargo ')).length, 2); }
  else { assert.notEqual(r.status, 0); assert.equal(calls.filter(line => line.startsWith('cargo ')).length, 0); }
});
test('SR4: historical release inventory keeps two starters and current inventory refuses a missing native starter', t => {
  const old = advisoryFixture(t, '3.1.0', { native: false });
  success(run('bash', [join(old.dir, 'scripts/check-advisories.sh')], old.dir, old.env));
  assert.equal((readFileSync(old.log, 'utf8').match(/npm .*audit --omit=dev/g) || []).length, 3);
  const current = advisoryFixture(t, '3.2.0', { native: false });
  const r = run('bash', [join(current.dir, 'scripts/check-advisories.sh')], current.dir, current.env);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /native-router/);
  assert.doesNotMatch(readFileSync(current.log, 'utf8'), /cargo/);
});
test('SR4: unpacked crate manifest mode audits only that locked Rust graph', t => {
  const f = advisoryFixture(t, '3.2.0-rc.1');
  const manifest = join(f.dir, 'packed-crate/Cargo.toml');
  success(run('bash', [join(f.dir, 'scripts/check-advisories.sh'), manifest], f.dir, f.env));
  const calls = readFileSync(f.log, 'utf8'); assert.doesNotMatch(calls, /npm/);
  assert.ok(calls.includes(`cargo deny --locked --manifest-path ${manifest} fetch db`));
  assert.ok(calls.includes(`cargo deny --locked --manifest-path ${manifest} check advisories`));
});

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

// FORMA-117: every SHA-pinned third-party action ends with `# v<major>.<minor>.<patch>`
// (a Dependabot bump keeps a matching comment current with the SHA; FORMA-256 requires
// all three parts). release.yml is included even though check-supply-chain.rb leaves its pin
// shape to check-release-workflow.rb.
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
  ['a zero patch version', `      - uses: actions/checkout@${PIN} # v10.0.0`],
  ['a step that names itself first', `      - name: Checkout\n        uses: actions/checkout@${PIN} # v4.2.2`],
  ['a quoted action', `      - uses: "actions/checkout@${PIN}" # v4.2.2`],
  ['extra spaces before the comment', `      - uses: actions/checkout@${PIN}    # v4.2.2`],
  ['a local action, which has no SHA to explain', '      - uses: ./.github/actions/local'],
  ['the branch-published toolchain action pinned from master', `      - uses: dtolnay/rust-toolchain@${PIN} # master\n        with:\n          toolchain: stable`],
  ['an anchor that nothing aliases', `      - &checkout\n        uses: actions/checkout@${PIN} # v4.2.2`],
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
  // FORMA-251: a rebuilt `stable` branch drops its old commits, which upstream warns
  // can be garbage-collected; pins come from master's history instead.
  ['stable on the branch-published toolchain action', `      - uses: dtolnay/rust-toolchain@${PIN} # stable`, /found: # stable\)$/],
  ['no comment on the branch-published toolchain action', `      - uses: dtolnay/rust-toolchain@${PIN}`, /found: none\)$/],
]) test(`version comment lint rejects ${name}`, (t) => {
  const r = lint(commentFixture(t, 'extra.yml', steps(body)));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /extra\.yml:\d+: build: [\w.\/-]+@[a-f0-9]{40} needs a trailing/);
  assert.match(r.stderr.trim(), found); assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /major or minor line/);
});

// FORMA-256: a one- or two-part comment names a major or minor line (a floating tag
// such as v4 moves to each new release), not the release the SHA is. A Dependabot bump
// writes the new SHA's most specific tag into a comment that names a version tagged at
// the old SHA, so its bumps carry three parts (merged PR #34 rewrote `# v4` to `# v7.0.1`).
for (const [name, yaml, line, found] of [
  ['a major version', steps(`      - uses: actions/checkout@${PIN} # v4`), 4, /found: # v4\)$/],
  ['a minor version', steps(`      - uses: actions/checkout@${PIN} # v4.2`), 4, /found: # v4\.2\)$/],
  ['a major version on a remote reusable workflow job', `jobs:\n  build:\n    uses: org/repo/.github/workflows/x.yml@${PIN} # v1\n`, 3, /found: # v1\)$/],
]) test(`version comment lint rejects ${name}, saying why`, (t) => {
  const r = lint(commentFixture(t, 'extra.yml', yaml));
  assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n'); assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], new RegExp(`extra\\.yml:${line}: build: [\\w.\\/-]+@[a-f0-9]{40} needs a trailing \`# v<major>\\.<minor>\\.<patch>\` comment naming its release`));
  assert.match(lines[0], /a one- or two-part version names a major or minor line, not the release/);
  assert.match(lines[0], found);
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
  const dir = commentFixture(t, 'extra.yml', `jobs:\n  one:\n    steps:\n      - uses: actions/checkout@${PIN}\n      - uses: actions/setup-node@${PIN} # v4.1.0\n  two:\n    steps:\n      - uses: actions/cache@${PIN}\n`);
  const r = lint(dir); assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n'); assert.equal(lines.length, 2, r.stderr);
  assert.match(lines[0], /extra\.yml:4: one: actions\/checkout@/); assert.match(lines[1], /extra\.yml:8: two: actions\/cache@/);
});

// FORMA-251: the comment check reads `uses:` where it is written and does not follow
// YAML aliases or merge keys, while the 40-hex check resolves them (Psych 3) or raises
// on an alias (Psych 4.0.1+). Every construct that could carry an uncommented pin past
// the comment check is therefore rejected, on one line, with no Ruby backtrace.
const ANCHORED = `x-steps:\n  checkout: &checkout\n    uses: actions/checkout@${PIN}\n  pin: &pin actions/checkout@${PIN}\n`;
for (const [name, file, yaml, line, what] of [
  ['a step that is an alias', 'extra.yml', `${ANCHORED}${steps('      - *checkout')}`, 8, /YAML alias `\*checkout`/],
  ['a merge key with an alias', 'extra.yml', `${ANCHORED}${steps('      - <<: *checkout\n        with: {}')}`, 8, /YAML alias `\*checkout`/],
  ['a uses value that is an alias', 'extra.yml', `${ANCHORED}${steps('      - uses: *pin')}`, 8, /YAML alias `\*pin`/],
  ['a merge key with an inline mapping', 'extra.yml', steps(`      - <<: {uses: actions/checkout@${PIN}}`), 4, /YAML merge key `<<`/],
  ['an alias in release.yml, which the 40-hex pass skips', 'release.yml', `${ANCHORED}${steps('      - *checkout')}`, 8, /YAML alias `\*checkout`/],
  ['a job that is an alias', 'extra.yml', `x-job: &job\n  steps:\n    - uses: actions/checkout@${PIN} # v4.2.2\njobs:\n  build: *job\n`, 5, /YAML alias `\*job`/],
  ['an alias to an unpinned action, reported once', 'extra.yml', `x-steps:\n  checkout: &checkout\n    uses: actions/checkout@v4\n${steps('      - *checkout')}`, 7, /YAML alias `\*checkout`/],
]) test(`version comment lint rejects ${name}`, (t) => {
  const r = lint(commentFixture(t, file, yaml));
  assert.notEqual(r.status, 0);
  const lines = r.stderr.trim().split('\n'); assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], new RegExp(`${file.replace('.', '\\.')}:${line}: `)); assert.match(lines[0], what);
  assert.match(lines[0], /do not follow aliases or merge keys$/);
});

// FORMA-251: a workflow saved with CRLF line endings is read the same way.
test('version comment lint reads CRLF workflows like LF ones', (t) => {
  const crlf = (text) => text.replace(/\n/g, '\r\n');
  success(lint(commentFixture(t, 'extra.yml', crlf(steps(`      - uses: actions/checkout@${PIN} # v4.2.2\n      - run: echo ok`)))));
  success(lint(commentFixture(t, 'extra.yml', crlf(steps(`      - uses: dtolnay/rust-toolchain@${PIN} # master   `)))));
  for (const [body, line, found] of [
    [`      - uses: actions/checkout@${PIN}\n      - run: echo ok`, 4, /found: none\)$/],
    [`      - name: Checkout\n        uses: actions/checkout@${PIN} # main`, 5, /found: # main\)$/],
  ]) {
    const r = lint(commentFixture(t, 'extra.yml', crlf(steps(body))));
    assert.notEqual(r.status, 0);
    const lines = r.stderr.trim().split('\n'); assert.equal(lines.length, 1, r.stderr);
    assert.doesNotMatch(lines[0], /\r/); assert.match(lines[0], new RegExp(`extra\\.yml:${line}: build: `)); assert.match(lines[0], found);
  }
});

// The live workflows: an independent reading of the text, then a mutation of every file.
const liveWorkflows = () => {
  const folder = join(root, '.github/workflows');
  return readdirSync(folder).filter(name => /\.ya?ml$/.test(name)).sort().map(name => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
};
const pinLine = /^\s*(?:-\s+)?uses:\s+(\S+)@([a-f0-9]{40})(.*)$/;

// An independent, offline reading of the pins: each needs its three-part comment, only the
// branch-published toolchain action may say `# master`, and (FORMA-251) the mapping
// is one-to-one per action: a SHA carries one comment and a comment names one SHA,
// so a comment cannot outlive a partial pin move or a partial Dependabot bump.
const pinErrors = (workflows) => {
  const errors = [], commentOf = new Map(), shaOf = new Map(); let pins = 0;
  for (const { name, text } of workflows) text.split(/\r?\n/).forEach((line, index) => {
    const m = pinLine.exec(line); if (!m) return;
    pins += 1; const [, action, sha, rest] = m, here = `${name}:${index + 1}`;
    const comment = /^\s+(# (?:v\d+\.\d+\.\d+|master))\s*$/.exec(rest)?.[1];
    if (!comment) return errors.push(`${here}: ${action}@${sha} has no three-part version comment`);
    if (comment === '# master' && action !== 'dtolnay/rust-toolchain') errors.push(`${here}: only the branch-published toolchain action may name a branch`);
    const pin = `${action}@${sha}`, named = `${action} ${comment}`;
    if ((commentOf.get(pin) ?? comment) !== comment) errors.push(`${here}: ${pin} carries two comments: ${commentOf.get(pin)} and ${comment}`);
    if ((shaOf.get(named) ?? sha) !== sha) errors.push(`${here}: ${named} names two SHAs: ${shaOf.get(named)} and ${sha}`);
    if (!commentOf.has(pin)) commentOf.set(pin, comment);
    if (!shaOf.has(named)) shaOf.set(named, sha);
  });
  return { pins, errors };
};

test('every SHA-pinned action in the live workflows carries its release comment, one comment per SHA and one SHA per comment', () => {
  const { pins, errors } = pinErrors(liveWorkflows());
  assert.deepEqual(errors, []);
  assert.ok(pins >= 50, `read only ${pins} pins`);
  success(lint(root));
});

test('the offline pin reading catches a second SHA under one comment and a second comment on one SHA', () => {
  const other = 'a'.repeat(40), file = (...lines) => [{ name: 'x.yml', text: `${lines.join('\r\n')}\r\n` }];
  assert.deepEqual(pinErrors(file(`      - uses: actions/checkout@${PIN} # v4.2.2`, `      - uses: actions/checkout@${PIN} # v4.2.2`, `      - uses: actions/cache@${other} # v4.2.2`)).errors, []);
  for (const [lines, error] of [
    [[`      - uses: actions/checkout@${PIN} # v4.2.2`, `      - uses: actions/checkout@${other} # v4.2.2`], /^x\.yml:2: actions\/checkout # v4\.2\.2 names two SHAs/],
    [[`      - uses: actions/checkout@${PIN} # v4.2.2`, `        uses: actions/checkout@${PIN} # v4.2.3`], /^x\.yml:2: actions\/checkout@[a-f0-9]{40} carries two comments/],
    [[`      - uses: dtolnay/rust-toolchain@${PIN} # master`, `      - uses: dtolnay/rust-toolchain@${other} # master`], /^x\.yml:2: dtolnay\/rust-toolchain # master names two SHAs/],
    [[`      - uses: actions/checkout@${PIN} # master`], /^x\.yml:1: only the branch-published toolchain action/],
    [[`      - uses: dtolnay/rust-toolchain@${PIN} # stable`], /^x\.yml:1: dtolnay\/rust-toolchain@[a-f0-9]{40} has no three-part version comment/],
    [[`      - uses: actions/checkout@${PIN} # v4`], /^x\.yml:1: actions\/checkout@[a-f0-9]{40} has no three-part version comment/],
    [[`      - uses: actions/checkout@${PIN} # v4.2`], /^x\.yml:1: actions\/checkout@[a-f0-9]{40} has no three-part version comment/],
  ]) {
    const { errors } = pinErrors(file(...lines));
    assert.equal(errors.length, 1, errors.join('\n')); assert.match(errors[0], error);
  }
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

// FORMA-251 moved the supply-chain lint ahead of cargo-deny in ci.yml's deny job, so an
// advisory-source outage cannot hide a lint failure; FORMA-256 pins that order. The
// workflow is parsed the way the other workflow tests parse theirs.
const ciWorkflow = () => JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e', 'puts JSON.generate(YAML.load(STDIN.read))'],
  { input: readFileSync(join(root, '.github/workflows/ci.yml')), encoding: 'utf8' }));
const SUPPLY_CHAIN_STEP = 'Supply-chain regression tests';
// A step the lint must precede, read from its `uses`, `with` and `run`: one that
// installs or runs cargo-deny or fetches advisory data, or installs the Rust
// toolchain. Swatinem/rust-cache counts: its default `cache-bin: true` restores
// ~/.cargo/bin, which is where a warm run's cargo-deny comes from. So does
// dtolnay/rust-toolchain: a rustup outage, or a broken or garbage-collected pin,
// would end the job before the lint reports.
const mustFollowLint = (step) => /^(?:Swatinem\/rust-cache|dtolnay\/rust-toolchain)@/.test(step.uses ?? '')
  || /cargo[ -]deny|check-advisories|\b(?:npm|cargo)[ -]audit\b|advisory-db|rustsec/i.test([step.uses, JSON.stringify(step.with ?? {}), step.run].join('\n'));
const checkDenyOrder = (workflow) => {
  const job = workflow.jobs?.deny, steps = job?.steps ?? [];
  assert.ok(job?.if === undefined && job?.['continue-on-error'] === undefined, 'the deny job is conditional or may fail');
  const named = steps.flatMap((step, index) => (step.name === SUPPLY_CHAIN_STEP ? [index] : []));
  assert.equal(named.length, 1, `the deny job has ${named.length} "${SUPPLY_CHAIN_STEP}" steps`);
  const [at] = named, lint = steps[at];
  assert.ok(lint.if === undefined && lint['continue-on-error'] === undefined, 'the supply-chain step is conditional or may fail');
  // The default shell runs with -e, so a lint failure stops the step before the tests
  // run; a `shell: bash {0}` (no -e) would let passing tests hide it.
  assert.ok(lint.shell === undefined && job.defaults?.run?.shell === undefined && workflow.defaults?.run?.shell === undefined,
    'the supply-chain step does not run in the default shell');
  assert.match(lint.run ?? '', /^ruby scripts\/check-supply-chain\.rb$/m);
  assert.match(lint.run ?? '', /^node --test scripts\/tests\/supply-chain\.test\.mjs$/m);
  const node = steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(node >= 0 && node < at, `the supply-chain step (${at}) runs before setup-node (${node}) selects Node`);
  assert.ok(steps.some(step => /\bcargo install cargo-deny\b/.test(step.run ?? '')) && steps.some(step => /check-advisories\.sh/.test(step.run ?? '')),
    'the deny job no longer installs cargo-deny or fetches advisories; update this check');
  const first = steps.findIndex(mustFollowLint);
  assert.ok(at < first, `the supply-chain step (${at}) runs after step ${first} (${steps[first]?.name ?? steps[first]?.uses}), which installs the Rust toolchain, installs or runs cargo-deny, or fetches advisories`);
};

test('the deny job runs the supply-chain lint and its tests before the Rust toolchain, cargo-deny or an advisory fetch', () => {
  checkDenyOrder(ciWorkflow());
});

test('the deny-job order check rejects the lint moved after Rust, cargo-deny or advisory work, ahead of setup-node, made optional, or run without -e', () => {
  const ci = ciWorkflow(), steps = ci.jobs.deny.steps, from = steps.findIndex(step => step.name === SUPPLY_CHAIN_STEP);
  const others = steps.filter((_, index) => index !== from);
  const node = others.findIndex(step => step.uses?.startsWith('actions/setup-node@')), first = others.findIndex(mustFollowLint);
  const withSteps = (list) => { const copy = structuredClone(ci); copy.jobs.deny.steps = list; return copy; };
  // Every position: allowed only after setup-node and before the first step the lint must precede.
  assert.ok(node >= 0 && first > node, `setup-node at ${node}, first step the lint must precede at ${first}`);
  let rejected = 0;
  for (let to = 0; to <= others.length; to += 1) {
    const moved = withSteps([...others.slice(0, to), steps[from], ...others.slice(to)]);
    if (to > node && to <= first) assert.doesNotThrow(() => checkDenyOrder(moved), `position ${to}`);
    else { assert.throws(() => checkDenyOrder(moved), `position ${to}`); rejected += 1; }
  }
  assert.ok(rejected >= 3, `rejected only ${rejected} positions`);
  const lint = steps[from], before = (step) => withSteps([...steps.slice(0, from), step, ...steps.slice(from)]);
  // The window need not be adjacent: a harmless step between setup-node and the lint is allowed.
  assert.doesNotThrow(() => checkDenyOrder(before({ name: 'Show Node', run: 'node --version' })));
  const sha = 'a'.repeat(40);
  const setDeny = (edit) => { const copy = structuredClone(ci); edit(copy.jobs.deny, copy); return copy; };
  for (const [name, mutated] of [
    ['the toolchain step before it', before({ uses: `dtolnay/rust-toolchain@${sha}`, with: { toolchain: 'stable' } })],
    ['a shell without -e on the lint', withSteps(steps.map(step => (step === lint ? { ...step, shell: 'bash {0}' } : step)))],
    ['a deny-job default shell', setDeny(job => { job.defaults = { run: { shell: 'bash {0}' } }; })],
    ['a workflow default shell', setDeny((_, workflow) => { workflow.defaults = { run: { shell: 'bash {0}' } }; })],
    ['continue-on-error on the deny job', setDeny(job => { job['continue-on-error'] = true; })],
    ['an if on the deny job', setDeny(job => { job.if = "github.event_name == 'push'"; })],
    ['a cargo deny fetch before it', before({ run: 'cargo deny --locked fetch db' })],
    ['the advisory script before it', before({ run: 'bash scripts/check-advisories.sh' })],
    ['an npm audit before it', before({ run: 'npm audit --omit=dev' })],
    ['the cargo-deny action before it', before({ uses: `EmbarkStudios/cargo-deny-action@${sha}` })],
    ['an installer action given cargo-deny before it', before({ uses: `taiki-e/install-action@${sha}`, with: { tool: 'cargo-deny' } })],
    ['the cache that restores cargo-deny before it', before({ uses: `Swatinem/rust-cache@${sha}` })],
    ['an if on the lint', withSteps(steps.map(step => (step === lint ? { ...step, if: "github.event_name == 'push'" } : step)))],
    ['continue-on-error on the lint', withSteps(steps.map(step => (step === lint ? { ...step, 'continue-on-error': true } : step)))],
    ['the lint without its tests', withSteps(steps.map(step => (step === lint ? { ...step, run: 'ruby scripts/check-supply-chain.rb\n' } : step)))],
    ['the tests without the lint', withSteps(steps.map(step => (step === lint ? { ...step, run: 'node --test scripts/tests/supply-chain.test.mjs\n' } : step)))],
    ['the step renamed', withSteps(steps.map(step => (step === lint ? { ...step, name: 'Supply chain' } : step)))],
    ['the step removed', withSteps(others)],
    ['the step twice', withSteps([...steps, lint])],
  ]) assert.throws(() => checkDenyOrder(mutated), name);
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

// D14-3.2-004: these are consumer workflows, with no access to Forma's
// monorepo scripts/config. Build-time JavaScript dependencies are audited too.
const starterNames = ['minimal', 'dashboard', 'native-router'];
const starterWorkflowPath = name => join(root, 'packages/create-app/templates', name, '.github/workflows/build.yml');
const starterWorkflow = name => JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e', 'puts JSON.generate(YAML.load(STDIN.read))'],
  { input: readFileSync(starterWorkflowPath(name)), encoding: 'utf8' }));
const starterNpmCommands = [
  'npm ci --ignore-scripts --include=dev --include=optional --include=peer',
  'npm audit signatures --include=dev --include=optional --include=peer',
  'npm audit --include=dev --include=optional --include=peer',
];
const starterRustCommands = [
  'cargo install cargo-deny --version 0.20.2 --locked',
  'cargo deny --locked --manifest-path Cargo.toml fetch db',
  'cargo deny --locked --manifest-path Cargo.toml check advisories',
];
const commandLines = step => (step.run ?? '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const checkStarterSecurity = (workflow, name) => {
  const job = workflow.jobs?.release, steps = job?.steps ?? [];
  assert.ok(job && job.if === undefined && job['continue-on-error'] === undefined, 'consumer build must be unconditional and required');
  assert.ok(workflow.defaults === undefined && job.defaults === undefined, 'consumer shell/working-directory defaults changed');
  const runSteps = steps.filter(step => step.run !== undefined);
  assert.equal(runSteps.length, 4, 'consumer security/build steps changed');
  const [npm, rust, frontend, binary] = runSteps;
  for (const step of runSteps) assert.ok(step.if === undefined && step['continue-on-error'] === undefined, 'consumer gate may be skipped or fail');
  for (const step of [npm, rust]) {
    // GitHub's explicit bash shell uses --noprofile --norc -e -o pipefail.
    assert.equal(step.shell, 'bash', 'security commands require fail-fast bash');
    assert.equal(step.env, undefined, 'security command environment override');
  }
  assert.equal(npm['working-directory'], 'admin');
  assert.equal(rust['working-directory'], undefined, 'Rust gate must use the generated project root');
  assert.deepEqual(commandLines(npm), starterNpmCommands, 'npm install/signature/full advisory gate changed');
  assert.deepEqual(commandLines(rust), starterRustCommands, 'pinned live Rust advisory gate changed');
  assert.deepEqual(commandLines(frontend), [name === 'dashboard' ? 'npm run build' : 'npm run build:ssr']);
  assert.equal(frontend['working-directory'], 'admin');
  assert.deepEqual(commandLines(binary), ['cargo build --release --locked --timings']);
  assert.equal(binary['working-directory'], undefined);
  const node = steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
  const toolchain = steps.findIndex(step => step.uses?.startsWith('dtolnay/rust-toolchain@'));
  assert.ok(node >= 0 && node < steps.indexOf(npm));
  assert.ok(toolchain >= 0 && toolchain < steps.indexOf(rust));
};
for (const name of starterNames) {
  test(`SR2/SR4 consumer ${name}: required signatures and live advisories precede both builds`, () => {
    checkStarterSecurity(starterWorkflow(name), name);
  });
  test(`SR2/SR4 consumer ${name}: removing or bypassing any dependency gate is refused`, () => {
    const original = starterWorkflow(name);
    const mutations = [
      ['optional job', (_, job) => { job['continue-on-error'] = true; }],
      ['conditional job', (_, job) => { job.if = 'false'; }],
      ['shell default', (_, job) => { job.defaults = { run: { shell: 'bash {0}' } }; }],
      ['optional audit', steps => { steps[0]['continue-on-error'] = true; }],
      ['conditional audit', steps => { steps[1].if = 'false'; }],
      ['non-failing shell', steps => { steps[0].shell = 'bash {0}'; }],
      ['offline environment', steps => { steps[0].env = { npm_config_offline: 'true' }; }],
      ['external Rust config directory', steps => { steps[1]['working-directory'] = '../../..'; }],
      ['build before verification', (steps, job) => { const at = job.steps.indexOf(steps[0]); job.steps.splice(at, 0, job.steps.splice(job.steps.indexOf(steps[2]), 1)[0]); }],
    ];
    for (const command of [...starterNpmCommands, ...starterRustCommands]) {
      const at = command.startsWith('npm') ? 0 : 1;
      mutations.push([`missing ${command}`, steps => { steps[at].run = commandLines(steps[at]).filter(line => line !== command).join('\n'); }]);
      mutations.push([`masked ${command}`, steps => { steps[at].run = steps[at].run.replace(command, `${command} || true`); }]);
    }
    for (const [before, after] of [
      ['--include=dev', '--omit=dev'], ['--ignore-scripts', ''], ['audit signatures', 'audit'],
      ['0.20.2', 'latest'], ['fetch db', 'fetch db --offline'], ['check advisories', 'check advisories --allow vulnerabilities'],
    ]) mutations.push([`${before} weakened`, steps => { for (const step of steps.slice(0, 2)) step.run = step.run.replace(before, after); }]);
    for (const [label, change] of mutations) {
      const copy = structuredClone(original), job = copy.jobs.release;
      change(job.steps.filter(step => step.run !== undefined), job);
      assert.throws(() => checkStarterSecurity(copy, name), label);
    }
  });
  test(`SR2/SR4 consumer ${name}: actual shell commands stop on install, signature, advisory or network failure`, t => {
    const dir = scratch(t), bin = join(dir, 'bin'), admin = join(dir, 'admin');
    mkdirSync(bin); mkdirSync(admin);
    for (const tool of ['npm', 'cargo']) script(join(bin, tool), `command='${tool} '"$*"\necho "$command" >> "$PROBE_LOG"\nif [[ "$command" == "$PROBE_FAIL" ]]; then echo "$PROBE_DIAGNOSTIC" >&2; exit 23; fi`);
    const workflow = starterWorkflow(name); checkStarterSecurity(workflow, name);
    const steps = workflow.jobs.release.steps.filter(step => step.run !== undefined);
    const expected = [...starterNpmCommands, ...starterRustCommands, ...commandLines(steps[2]), ...commandLines(steps[3])];
    const modes = [
      ['success', '', ''],
      ['npm install failure', expected[0], 'lockfile unavailable'],
      ['signature failure', expected[1], 'invalid package signature'],
      ['npm advisory', expected[2], 'known build dependency vulnerability'],
      ['npm outage', expected[2], 'ECONNREFUSED advisory service'],
      ['cargo-deny install failure', expected[3], 'tool download failed'],
      ['RustSec fetch outage with an existing cache', expected[4], 'advisory database fetch failed'],
      ['Rust advisory', expected[5], 'known RustSec vulnerability'],
      ['Rust database read failure', expected[5], 'advisory database unreadable'],
    ];
    for (const [label, fail, diagnostic] of modes) {
      const log = join(dir, `calls-${modes.findIndex(mode => mode[0] === label)}`);
      let result;
      for (const step of steps) {
        result = run('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], step['working-directory'] === 'admin' ? admin : dir,
          { PATH: `${bin}:${process.env.PATH}`, PROBE_LOG: log, PROBE_FAIL: fail, PROBE_DIAGNOSTIC: diagnostic });
        if (result.status !== 0) break;
      }
      const calls = readFileSync(log, 'utf8').trim().split('\n');
      if (!fail) { success(result); assert.deepEqual(calls, expected); }
      else { assert.equal(result.status, 23, label); assert.ok(result.stderr.includes(diagnostic)); assert.deepEqual(calls, expected.slice(0, expected.indexOf(fail) + 1), label); }
    }
  });
}

test('SR2/SR4: npm ships the exact verified consumer workflow bytes for all three starters', t => {
  const dir = scratch(t);
  const result = run('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', dir], join(root, 'packages/create-app'));
  success(result);
  const archive = JSON.parse(result.stdout)[0].filename;
  for (const name of starterNames) {
    const bytes = execFileSync('tar', ['-xOf', join(dir, archive), `package/templates/${name}/.github/workflows/build.yml`]);
    assert.deepEqual(bytes, readFileSync(starterWorkflowPath(name)), name);
  }
});
