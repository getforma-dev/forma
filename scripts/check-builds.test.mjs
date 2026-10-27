import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo = fileURLToPath(new URL('../', import.meta.url));
const coreScripts = JSON.parse(readFileSync(join(repo, 'packages/core/package.json'))).scripts;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma check builds ')));
  try {
    const core = join(root, 'packages/core'), bin = join(root, 'bin');
    for (const path of [bin, join(root, 'scripts'), join(root, 'e2e/fixtures'), join(core, 'scripts'), join(core, 'e2e/fixtures'), join(core, 'dist')]) mkdirSync(path, {recursive: true});
    for (const path of ['scripts/check-builds.sh', 'e2e/sync-fixtures.sh', 'scripts/check-core-browser.sh']) copyFileSync(join(repo, path), join(root, path));
    writeFileSync(join(core, 'dist/formajs-runtime.global.js'), 'stale');
    const log = join(root, 'commands.jsonl');
    const common = `const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(process.env.COMMAND_LOG,JSON.stringify({command:path.basename(process.argv[1]),args,cwd:process.cwd()})+'\\n');`;
    writeFileSync(join(bin, 'npm'), `#!${process.execPath}\n${common}
      require('node:assert/strict').deepEqual(args,['run','build']);
      if(process.env.FAIL_BUILD){console.error('controlled build refusal');process.exit(19);}
      fs.mkdirSync('dist',{recursive:true});
      if(!process.env.OMIT_OUTPUT)fs.writeFileSync('dist/formajs-runtime.global.js','fresh');
      fs.writeFileSync('dist/forma.esm.js','export const answer=42;');
    `, {mode: 0o755});
    writeFileSync(join(bin, 'npx'), `#!${process.execPath}\n${common}
      require('node:assert/strict').equal(fs.readFileSync('e2e/fixtures/formajs-runtime.global.js','utf8'),'fresh');
      process.exit(Number(process.env.PLAYWRIGHT_EXIT ?? 0));
    `, {mode: 0o755});
    const env = {...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, COMMAND_LOG: log};
    const shell = (source, extra = {}, cwd = root) => spawnSync('bash', ['-euc', source], {cwd, env: {...env, ...extra}, encoding: 'utf8', timeout: 10_000});
    const commands = () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    run({root, core, shell, commands});
  } finally { rmSync(root, {recursive: true, force: true}); }
}

const setup = 'source scripts/check-builds.sh\n';
const build = 'forma_check_build_package packages/core dist/formajs-runtime.global.js';

test('only a successful build in this shell authorizes reuse, including sourced subshells', () => fixture(({root, core, shell, commands}) => {
  const first = shell(`${setup}${build}\n(${build})\n${build}`,
    {_forma_check_built_packages: core, FORMA_SKIP_BUILD: '1'});
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(commands().length, 1);
  assert.equal(readFileSync(join(core, 'dist/formajs-runtime.global.js'), 'utf8'), 'fresh');
  const second = shell(`${setup}${build}`);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(commands().length, 2, 'another invocation must rebuild despite existing dist');
  assert.ok(commands().every(row => row.cwd === core));
}));

test('an npm failure inside a conditional retains its status and cannot mark the package built', () => fixture(({shell, commands}) => {
  const result = shell(`${setup}export FAIL_BUILD=1
    if ${build}; then exit 90; else status=$?; fi
    test "$status" = 19
    unset FAIL_BUILD
    ${build}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /controlled build refusal/);
  assert.equal(commands().length, 2);
}));

test('a successful command with missing output cannot authorize reuse', () => fixture(({core, shell, commands}) => {
  rmSync(join(core, 'dist/formajs-runtime.global.js'));
  const result = shell(`${setup}export OMIT_OUTPUT=1
    if ${build}; then exit 90; else test "$?" = 1; fi
    unset OMIT_OUTPUT
    ${build}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /current check build output missing/);
  assert.equal(commands().length, 2);
}));

test('a removed current output fails rather than accepting stale state or rebuilding silently', () => fixture(({shell, commands}) => {
  const result = shell(`${setup}${build}\nrm packages/core/dist/formajs-runtime.global.js\n${build}\necho UNREACHED`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /current check build output missing/);
  assert.doesNotMatch(result.stdout, /UNREACHED/);
  assert.equal(commands().length, 1);
}));

test('standalone core npm scripts still build, copy the fresh runtime and preserve engine arguments', () => fixture(({core, shell, commands}) => {
  for (const [script, args] of [['test:e2e', ['--project=chromium']], ['test:e2e:engines', []]]) {
    const extra = '--project=webkit --workers=2';
    const result = shell(`${coreScripts[script]} ${extra}`, {}, core);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(commands().at(-1).args, ['playwright', 'test', ...args, '--project=webkit', '--workers=2']);
  }
  assert.equal(commands().filter(row => row.command === 'npm').length, 2);
}));

test('sourced core runner reuses only the parent build and isolates cwd while preserving test failure', () => fixture(({root, core, shell, commands}) => {
  const result = shell(`${setup}${build}
    (source scripts/check-core-browser.sh --project=chromium --workers=2)
    test "$PWD" = ${quote(root)}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(commands().filter(row => row.command === 'npm').length, 1);
  assert.deepEqual(commands().at(-1), {command: 'npx', args: ['playwright', 'test', '--project=chromium', '--workers=2'], cwd: core});
  const failed = shell(`${setup}${build}\n(source scripts/check-core-browser.sh --project=chromium)\necho UNREACHED`, {PLAYWRIGHT_EXIT: '23'});
  assert.equal(failed.status, 23, failed.stdout + failed.stderr);
  assert.doesNotMatch(failed.stdout, /UNREACHED/);
}));

test('standalone core build failure cannot copy a stale runtime or reach Playwright', () => fixture(({core, shell, commands}) => {
  const result = shell(coreScripts['test:e2e'], {FAIL_BUILD: '1'}, core);
  assert.equal(result.status, 19, result.stdout + result.stderr);
  assert.equal(commands().length, 1);
  assert.throws(() => readFileSync(join(core, 'e2e/fixtures/formajs-runtime.global.js')));
}));

test('fixture sync retains full build failure output for standalone and sourced external core paths', () => fixture(({root, core, shell, commands}) => {
  for (const prefix of ['', setup]) {
    const result = shell(`${prefix}(source e2e/sync-fixtures.sh)`, {FAIL_BUILD: '1', FORMAJS_DIR: core});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Error: FormaJS build failed/);
    assert.match(result.stderr, /controlled build refusal/);
  }
  assert.equal(commands().length, 2);
  assert.throws(() => readFileSync(join(root, 'e2e/fixtures/formajs-runtime.global.js')));
}));
