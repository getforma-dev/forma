// NEVER MERGE. Four fixed original-spec invocations; no collector or oracle copy.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const baseline = '93d3d9370b2b67ceed21c8f80d41566dbe6dca86';
export const candidate = '03ffd92891924f0421b663bfc42d355c87214d0d';
export const order = ['A1', 'B1', 'B2', 'A2'];

export function invocation(slot, sources, output) {
  assert(order.includes(slot));
  assert(isAbsolute(output));
  const variant = slot[0], cwd = sources[variant];
  assert(isAbsolute(cwd));
  const directory = join(output, slot);
  return {
    command: process.execPath, cwd, directory,
    args: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/ssr/indexed-products.config.ts',
      '--project=chromium', '--workers=1', '--retries=0', '--reporter=list,json',
      '--grep', 'indexed products: complete public set', '--output', join(directory, 'artifacts')],
    env: { ...process.env, FORMA_SSR_E2E_PORT: variant === 'A' ? '3458' : '3459', DEBUG: 'pw:browser',
      PLAYWRIGHT_JSON_OUTPUT_FILE: join(directory, 'playwright.json') },
  };
}

export async function runComparison(sources, output) {
  assert(isAbsolute(output));
  mkdirSync(output); // Fresh evidence only; do not replace a prior attempt.
  const rows = order.map(slot => ({ slot, state: 'pending' }));
  const save = () => writeFileSync(join(output, 'slots.json'), JSON.stringify(rows, null, 2) + '\n');
  save();
  for (const row of rows) {
    const call = invocation(row.slot, sources, output);
    mkdirSync(call.directory);
    Object.assign(row, { state: 'running', startedAt: new Date().toISOString(), cwd: call.cwd,
      command: [call.command, ...call.args], port: call.env.FORMA_SSR_E2E_PORT,
      reporter: call.env.PLAYWRIGHT_JSON_OUTPUT_FILE });
    save(); console.log(`ABBA ${row.slot} BEGIN ${JSON.stringify(row.command)} cwd=${row.cwd}`);
    const outcome = await new Promise(resolve => {
      let error;
      const child = spawn(call.command, call.args, { cwd: call.cwd, env: call.env, stdio: 'inherit' });
      child.once('error', cause => { error = String(cause); });
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal, ...(error ? { error } : {}) }));
    });
    Object.assign(row, outcome, { state: 'finished', endedAt: new Date().toISOString() });
    save(); console.log(`ABBA ${row.slot} END ${JSON.stringify(outcome)}`);
    // A failure is evidence, never a reason to skip or replace a later slot.
  }
  return rows.every(row => row.exitCode === 0 && row.signal === null && !row.error) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 5, 'usage: node indexed-primitive-comparison.mjs <baseline> <candidate> <fresh-output>');
  const sources = { A: realpathSync(process.argv[2]), B: realpathSync(process.argv[3]) };
  for (const [variant, expected] of [['A', baseline], ['B', candidate]]) {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sources[variant], encoding: 'utf8' }).trim(), expected);
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sources[variant], encoding: 'utf8' }).trim(), '');
  }
  process.exitCode = await runComparison(sources, process.argv[4]);
}
