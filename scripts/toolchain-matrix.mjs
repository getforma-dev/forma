#!/usr/bin/env node
// N8's dated support policy. CI consumes this output, not a second copied list.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function nodeLines(at = new Date()) {
  assert(at instanceof Date && Number.isFinite(at.getTime()), 'invalid toolchain policy date');
  return at.getTime() < Date.parse('2026-10-28T00:00:00Z') ? [22, 24] : [22, 24, 26];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--github-output'), 'usage: toolchain-matrix.mjs [--github-output]');
  const value = JSON.stringify(nodeLines());
  if (process.argv[2]) {
    assert(process.env.GITHUB_OUTPUT, 'missing GITHUB_OUTPUT');
    appendFileSync(process.env.GITHUB_OUTPUT, `node_versions=${value}\n`);
  } else console.log(value);
}
