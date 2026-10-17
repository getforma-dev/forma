import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const { verifyPackedSecurity } = await import(pathToFileURL(join(root, 'scripts/release-security.mjs')));
const { run, digest } = await import(pathToFileURL(join(root, 'scripts/release-set.mjs')));
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const scratch = mkdtempSync(join(tmpdir(), 'forma108-packed-security-'));
const packed = JSON.parse(run('npm', ['pack', '-w', 'packages/core', '--ignore-scripts', '--json', '--pack-destination', scratch]));
if (packed.length !== 1) throw new Error('expected one actual packed core');
const archive = join(scratch, packed[0].filename), coreDir = join(scratch, 'packages/core');
mkdirSync(coreDir, { recursive: true });
run('tar', ['-xzf', archive, '--strip-components=1', '-C', coreDir]);
const set = { commit, packages: [{ registry: 'npm', name: '@getforma/core', version: packed[0].version, path: 'packages/core', sha256: digest(archive) }] };
const evidenceDir = join(root, '../tmp/packed-security-108-first');
mkdirSync(evidenceDir); // refuse reuse of any earlier proof directory
const result = {};
try {
  await verifyPackedSecurity({ set, scratch, evidenceDir, result, test: async (name, action) => { console.log(name); await action(); } });
} finally {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'security.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ commit, passed: result.passed, scratch, archive, evidenceDir, runtimeSha256: result.runtimeSha256, cases: result.hostile?.cases.length, controls: result.hostile?.capabilities.length, explicitControls: result.hostile?.explicitMount.length }));
}
