#!/usr/bin/env node
// Live use belongs to the founder on a machine where no agent runs (L-49).
// Default is a pure dry run. No credential is accepted or read by this script.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { readRecordedSet, recallPlan } from './release-support.mjs';
import { commandInvocation } from './portable-command.mjs';

try {
  const { values } = parseArgs({ options: {
    record: { type: 'string' }, sha256: { type: 'string' }, reason: { type: 'string' },
    execute: { type: 'boolean', default: false }, 'confirm-tag': { type: 'string' }, receipt: { type: 'string' },
  } });
  assert(values.record && values.sha256 && values.reason, 'usage: recall.mjs --record DS12.json --sha256 TRUSTED_HASH --reason MESSAGE [--execute --confirm-tag vX.Y.Z --receipt NEW_FILE]');
  const record = readRecordedSet(readFileSync(resolve(values.record)), values.sha256);
  const plan = recallPlan(record, values.reason);
  const result = { schema: 1, recordSha256: values.sha256, mode: values.execute ? 'founder-execution' : 'dry-run', ...plan, complete: false };
  if (!values.execute) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    assert(!process.env.CI, 'recall is an interactive founder operation, never a CI job');
    assert.equal(values['confirm-tag'], record.tag, 'confirm the exact release tag before executing');
    assert(values.receipt, 'live recall requires a new receipt path');
    const receipt = resolve(values.receipt);
    assert(!existsSync(receipt), 'refuse to overwrite a prior recall receipt');
    const save = () => writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n');
    writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    for (const action of result.actions) {
      if (action.registry === 'crates') { action.status = 'awaiting-founder-web-yank'; save(); continue; }
      action.status = 'started'; save();
      const invocation = commandInvocation(action.command, action.args);
      const child = spawnSync(invocation.command, invocation.args, { stdio: 'inherit', timeout: 180_000 });
      action.status = child.status === 0 && !child.error ? 'npm-deprecated' : 'failed'; save();
      assert.equal(action.status, 'npm-deprecated', `${action.name}: recall stopped; inspect the receipt and registry before resuming`);
    }
    console.log(`npm deprecations completed. The recall remains INCOMPLETE until the founder yanks all three exact crate versions through the URLs in ${receipt} and verifies all seven registry states.`);
    // A successful npm phase must never masquerade as a completed set recall.
    process.exitCode = 2;
  }
} catch (error) { console.error(`recall: ${error.message}`); process.exitCode = 1; }
