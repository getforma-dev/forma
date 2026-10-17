import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withOwnedServer } from '../../../scripts/owned-server.mjs';
import { runRefusingServer, withServer } from './helpers';

vi.mock('../../../scripts/owned-server.mjs', () => ({ withOwnedServer: vi.fn(async () => 'visited') }));

let project: string;
const filename = process.platform === 'win32' ? 'fixture.exe' : 'fixture';
function executable(target: string, profile: 'debug' | 'release') {
  const file = path.join(target, profile, filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'profile-selection fixture; execution is mocked');
  return file;
}
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-server-profile-'));
  vi.stubEnv('CARGO_TARGET_DIR', undefined);
  vi.mocked(withOwnedServer).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('scaffold server build profile', () => {
  it('keeps existing observations and refusal checks on debug by default', async () => {
    const debug = executable(path.join(project, 'target'), 'debug');
    executable(path.join(project, 'target'), 'release');
    await withServer(project, 'fixture', () => undefined);
    await runRefusingServer(project, 'fixture');
    expect(vi.mocked(withOwnedServer).mock.calls.map(call => call[0])).toEqual([debug, debug]);
    expect(vi.mocked(withOwnedServer).mock.calls[1][4]).toMatchObject({ refusal: true });
  });

  it('selects the explicit release binary rather than an existing debug binary', async () => {
    executable(path.join(project, 'target'), 'debug');
    const release = executable(path.join(project, 'target'), 'release');
    await withServer(project, 'fixture', () => undefined, { profile: 'release' });
    expect(vi.mocked(withOwnedServer).mock.calls[0][0]).toBe(release);
  });

  it('honors an explicit shared target directory for release observations', async () => {
    const target = path.join(project, 'shared-target');
    vi.stubEnv('CARGO_TARGET_DIR', target);
    const release = executable(target, 'release');
    await withServer(project, 'fixture', () => undefined, { profile: 'release' });
    expect(vi.mocked(withOwnedServer).mock.calls[0][0]).toBe(release);
  });

  it('refuses a missing release binary instead of falling back to debug', async () => {
    executable(path.join(project, 'target'), 'debug');
    await expect(withServer(project, 'fixture', () => undefined, { profile: 'release' })).rejects.toThrow(
      `server binary missing: ${path.join(project, 'target', 'release', filename)}`,
    );
    expect(withOwnedServer).not.toHaveBeenCalled();
  });
});
