#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { worker, finalize } from './release-burn-in.mjs';
import { RC_TAG, RC_COMMIT } from './release-soak-context-v2.mjs';
const [mode, payload, attempt, third, fourth, ...extra] = process.argv.slice(2);
assert(extra.length === 0 && payload && attempt && third);
if (mode === 'worker') {
  assert.equal(fourth, undefined);
  await worker({ tag: RC_TAG, commit: RC_COMMIT, payloadRoot: resolve(payload), attempt: resolve(attempt), work: resolve(third) });
} else {
  assert.equal(mode, 'finalize'); assert(fourth);
  await finalize({ payloadRoot: resolve(payload), attempt: resolve(attempt), ownership: resolve(third), work: resolve(fourth) });
}
