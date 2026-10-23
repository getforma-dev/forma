import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Browser } from '@playwright/test';
import { CLI_TIMEOUT_MS, inTmpDir, withEngine } from './helpers';

// FORMA-252: the failure evidence the scaffold suite adds around its process-backed steps. These
// never skip (the packed lanes refuse a skipped case); platform-specific halves return early.

// The fake engines below must not add timing rows to a real scaffold report.
const reportDir = process.env.FORMA_SCAFFOLD_REPORT_DIR;
beforeAll(() => { delete process.env.FORMA_SCAFFOLD_REPORT_DIR; });
afterAll(() => { if (reportDir !== undefined) process.env.FORMA_SCAFFOLD_REPORT_DIR = reportDir; });

function fakeBrowser(closed: string[]): Browser {
  return { version: () => '1.2.3', close: async () => { closed.push('closed'); } } as unknown as Browser;
}

describe('engine failure evidence', () => {
  it('names the engine, its version, the timings and the attached page timeline, keeping the error', async () => {
    const closed: string[] = [];
    const failure = Object.assign(new Error('page.goto: Timeout 15000ms exceeded.'), { name: 'TimeoutError' });
    Object.defineProperty(failure, 'formaTimeline', { value: ['+3ms goto http://127.0.0.1:1 (waitUntil commit, timeout 15000 ms)', '+9ms request GET document http://127.0.0.1:1/'] });
    const rejection = withEngine('firefox', { launch: async () => fakeBrowser(closed) }, async () => { throw failure; });
    await expect(rejection).rejects.toBe(failure);
    expect(failure.name).toBe('TimeoutError');
    expect(failure.message).toMatch(/^page\.goto: Timeout 15000ms exceeded\.\n\[browser\] firefox 1\.2\.3: launched in \d+ ms; the check failed \d+ ms after launch\n\[browser\] page timeline \(ms after the page opened\):\n\+3ms goto http:\/\/127\.0\.0\.1:1 \(waitUntil commit, timeout 15000 ms\)\n\+9ms request GET document http:\/\/127\.0\.0\.1:1\/$/);
    expect(closed).toEqual(['closed']);
  });

  it('says when no timeline came with the failure, and when the engine never launched', async () => {
    const closed: string[] = [];
    await expect(withEngine('webkit', { launch: async () => fakeBrowser(closed) }, async () => { throw new Error('boom'); }))
      .rejects.toThrow(/^boom\n\[browser\] webkit 1\.2\.3: launched in \d+ ms; the check failed \d+ ms after launch\n\[browser\] no page timeline attached$/);
    expect(closed).toEqual(['closed']);
    await expect(withEngine('chromium', { launch: async () => { throw new Error('executable missing'); } }, async () => 'unreached'))
      .rejects.toThrow(/^executable missing\n\[browser\] chromium failed to launch after \d+ ms$/);
  });

  it('returns the check result and closes the browser on success', async () => {
    const closed: string[] = [];
    await expect(withEngine('chromium', { launch: async () => fakeBrowser(closed) }, async (browser) => browser.version())).resolves.toBe('1.2.3');
    expect(closed).toEqual(['closed']);
  });
});

describe('temp directory cleanup', () => {
  it('removes the directory after the body and returns its result', () => {
    let seen = '';
    expect(inTmpDir('forma-diagnostics-', (dir) => { seen = dir; fs.writeFileSync(path.join(dir, 'file'), 'x'); return 7; })).toBe(7);
    expect(fs.existsSync(seen)).toBe(false);
  });

  it("keeps the body's own failure and removes the directory", () => {
    let seen = '';
    const failure = new Error('scaffold CLI: Error: spawnSync node ETIMEDOUT');
    expect(() => inTmpDir('forma-diagnostics-', (dir) => { seen = dir; throw failure; })).toThrow(failure);
    expect(failure.message).toBe('scaffold CLI: Error: spawnSync node ETIMEDOUT');
    expect(fs.existsSync(seen)).toBe(false);
  });

  it('a failed removal is added to the body failure instead of replacing it', () => {
    // POSIX only: a read-only parent refuses the delete. Windows ignores directory modes, and root ignores both.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    let seen = '';
    const failure = new Error('the real failure');
    try {
      expect(() => inTmpDir('forma-diagnostics-', (dir) => {
        seen = dir;
        fs.mkdirSync(path.join(dir, 'locked')); fs.writeFileSync(path.join(dir, 'locked', 'file'), 'x');
        fs.chmodSync(path.join(dir, 'locked'), 0o500);
        throw failure;
      })).toThrow(failure);
      expect(failure.message).toMatch(/^the real failure\n\[cleanup\] removing .+ also failed: Error: E[A-Z]+/);
    } finally {
      fs.chmodSync(path.join(seen, 'locked'), 0o700);
      fs.rmSync(seen, { recursive: true, force: true });
    }
  });

  it('keeps the CLI child budget the FORMA-252 evidence supports', () => {
    expect(CLI_TIMEOUT_MS).toBe(25_000);
  });
});
