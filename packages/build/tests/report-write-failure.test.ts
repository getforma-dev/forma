/**
 * The JSON report is written to a temporary file and renamed over its path
 * (FORMA-245). When the rename fails the temporary file must not be left
 * beside the report. The rename is made to fail here because, with a regular
 * file or nothing at the path, no real filesystem state makes it fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: () => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    },
  };
});

import { writeDiagnosticsJson } from '../src/diagnostics';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'forma-build-report-fail-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('writeDiagnosticsJson when the rename fails', () => {
  it('rethrows and removes its temporary file, leaving an existing report as it was', () => {
    const report = join(root, 'diagnostics.json');
    writeFileSync(report, 'old report');
    expect(() => writeDiagnosticsJson(report, true, [])).toThrow(/EPERM/);
    expect(readdirSync(root)).toEqual(['diagnostics.json']);
  });

  it('leaves no temporary file when there was no report yet', () => {
    expect(() => writeDiagnosticsJson(join(root, 'diagnostics.json'), true, [])).toThrow(/EPERM/);
    expect(readdirSync(root)).toEqual([]);
  });
});
