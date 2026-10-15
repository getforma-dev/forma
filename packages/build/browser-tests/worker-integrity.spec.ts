import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { build } from '../dist/index.js';
import { verifyWorkerIntegrity, verifyWorkerLifecycle, WORKER_INTEGRITY_CHECKS, WORKER_LIFECYCLE_CHECKS } from './helpers/worker-integrity.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test.setTimeout(120_000);

test('real build authenticates entry and dynamic chunk bytes in browser CacheStorage and on the network', async ({browser}, testInfo) => {
  const workDir = mkdtempSync(join(tmpdir(), 'forma-integrity-browser-'));
  try {
    const result = await verifyWorkerIntegrity({build, browser, workDir});
    expect(result.results.map(r => r.name)).toEqual(WORKER_INTEGRITY_CHECKS);
    await testInfo.attach('worker-integrity.json', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  } finally { rmSync(workDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50}); }
});

test('real builds retain waiting lifecycle and the actual Rust retirement response removes only owned caches', async ({browser}, testInfo) => {
  const workDir = mkdtempSync(join(tmpdir(), 'forma-lifecycle-browser-'));
  try {
    const retiringWorkerSource = execFileSync('cargo', ['run', '--quiet', '--locked', '-p', 'forma-server', '--example', 'retiring_worker_source', '--', 'ledger'], {cwd: resolve(root), encoding: 'utf8', timeout: 90_000});
    const result = await verifyWorkerLifecycle({build, browser, workDir, retiringWorkerSource});
    expect(result.results.map(r => r.name)).toEqual(WORKER_LIFECYCLE_CHECKS);
    await testInfo.attach('worker-lifecycle.json', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  } finally { rmSync(workDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50}); }
});
