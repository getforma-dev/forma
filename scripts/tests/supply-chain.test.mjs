import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
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

// FORMA-117: every SHA-pinned third-party action ends with `# v<major>.<minor>.<patch>`
// (Dependabot keeps that comment current with the SHA; FORMA-256 requires all three
// parts). release.yml is included even though check-supply-chain.rb leaves its pin
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
// such as v4 moves to each new release), not the release the SHA is. Dependabot writes
// the most specific tag at the new SHA, so its bumps carry three parts (merged PR #34
// rewrote `# v4` to `# v7.0.1`).
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
// A step that installs or runs cargo-deny or fetches advisory data, read from its
// `uses`, `with` and `run`. Swatinem/rust-cache counts: its default `cache-bin: true`
// restores ~/.cargo/bin, which is where a warm run's cargo-deny comes from.
const advisoryWork = (step) => /^Swatinem\/rust-cache@/.test(step.uses ?? '')
  || /cargo[ -]deny|check-advisories|\b(?:npm|cargo)[ -]audit\b|advisory-db|rustsec/i.test([step.uses, JSON.stringify(step.with ?? {}), step.run].join('\n'));
const checkDenyOrder = (workflow) => {
  const steps = workflow.jobs?.deny?.steps ?? [];
  const named = steps.flatMap((step, index) => (step.name === SUPPLY_CHAIN_STEP ? [index] : []));
  assert.equal(named.length, 1, `the deny job has ${named.length} "${SUPPLY_CHAIN_STEP}" steps`);
  const [at] = named, lint = steps[at];
  assert.ok(lint.if === undefined && lint['continue-on-error'] === undefined, 'the supply-chain step is conditional or may fail');
  assert.match(lint.run ?? '', /^ruby scripts\/check-supply-chain\.rb$/m);
  assert.match(lint.run ?? '', /^node --test scripts\/tests\/supply-chain\.test\.mjs$/m);
  const node = steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(node >= 0 && node < at, `the supply-chain step (${at}) runs before setup-node (${node}) selects Node`);
  assert.ok(steps.some(step => /\bcargo install cargo-deny\b/.test(step.run ?? '')) && steps.some(step => /check-advisories\.sh/.test(step.run ?? '')),
    'the deny job no longer installs cargo-deny or fetches advisories; update this check');
  const first = steps.findIndex(advisoryWork);
  assert.ok(at < first, `the supply-chain step (${at}) runs after step ${first} (${steps[first]?.name ?? steps[first]?.uses}), which installs or runs cargo-deny or fetches advisories`);
};

test('the deny job runs the supply-chain lint and its tests before anything installs or runs cargo-deny or fetches advisories', () => {
  checkDenyOrder(ciWorkflow());
});

test('the deny-job order check rejects the lint moved after cargo-deny work, ahead of setup-node, made optional, or preceded by advisory work', () => {
  const ci = ciWorkflow(), steps = ci.jobs.deny.steps, from = steps.findIndex(step => step.name === SUPPLY_CHAIN_STEP);
  const others = steps.filter((_, index) => index !== from);
  const node = others.findIndex(step => step.uses?.startsWith('actions/setup-node@')), first = others.findIndex(advisoryWork);
  const withSteps = (list) => { const copy = structuredClone(ci); copy.jobs.deny.steps = list; return copy; };
  // Every position: allowed only after setup-node and before the first cargo-deny/advisory step.
  assert.ok(node >= 0 && first > node, `setup-node at ${node}, first cargo-deny/advisory step at ${first}`);
  let rejected = 0;
  for (let to = 0; to <= others.length; to += 1) {
    const moved = withSteps([...others.slice(0, to), steps[from], ...others.slice(to)]);
    if (to > node && to <= first) assert.doesNotThrow(() => checkDenyOrder(moved), `position ${to}`);
    else { assert.throws(() => checkDenyOrder(moved), `position ${to}`); rejected += 1; }
  }
  assert.ok(rejected >= 3, `rejected only ${rejected} positions`);
  const lint = steps[from], before = (step) => withSteps([...steps.slice(0, from), step, ...steps.slice(from)]);
  const sha = 'a'.repeat(40);
  for (const [name, mutated] of [
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
