import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';
import { digest, run, save } from './release-set.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'forma-signature-test-'));
  const packages = [], entries = {};
  for (const [name, extra] of [
    ['@getforma/compiler', { dependencies: { external: '=1.0.0' } }],
    ['@getforma/build', { peerDependencies: { '@getforma/compiler': '=3.0.0-dev' }, devDependencies: { external: '=1.0.0' } }],
  ]) {
    const manifest = { name, version: '3.0.0-dev', ...extra };
    const source = join(dir, name.split('/')[1]); mkdirSync(join(source, 'package'), { recursive: true });
    save(join(source, 'package/package.json'), manifest);
    const file = `${name.split('/')[1]}.tgz`;
    run('tar', ['-czf', join(dir, file), '-C', source, 'package']);
    packages.push({ registry: 'npm', name, version: manifest.version, file, sha256: digest(join(dir, file)) });
    const path = `node_modules/${name}`;
    mkdirSync(join(dir, path), { recursive: true }); save(join(dir, path, 'package.json'), manifest);
    entries[path] = { version: manifest.version, resolved: `file:${join(dir, file)}`, integrity: `sha512-${digest(join(dir, file), 'sha512', 'base64')}`, ...extra };
  }
  mkdirSync(join(dir, 'node_modules/external'), { recursive: true });
  save(join(dir, 'node_modules/external/package.json'), { name: 'external', version: '1.0.0' });
  entries['node_modules/external'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/external/-/external-1.0.0.tgz', integrity: 'sha512-external-fixture' };
  const manifest = { name: 'signature-fixture', version: '1.0.0', dependencies: { '@getforma/build': `file:${join(dir, 'build.tgz')}`, '@getforma/compiler': `file:${join(dir, 'compiler.tgz')}` } };
  save(join(dir, 'package.json'), manifest);
  save(join(dir, 'package-lock.json'), { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': manifest, ...entries } });
  return { dir, packages };
}

test('an unpublished exact peer edge remains local while every external edge is audited', () => {
  const { dir, packages } = fixture();
  try {
    let audits = 0;
    const execute = (command, args, cwd, options) => {
      if (command !== 'npm' || args[0] !== 'audit') return run(command, args, cwd, options);
      audits++;
      for (const type of ['dev', 'optional', 'peer']) assert(args.includes(`--include=${type}`));
      const local = JSON.parse(run('npm', ['query', '.workspace', '--json'], cwd));
      assert.deepEqual(local.map(p => p.name).sort(), ['@getforma/build', '@getforma/compiler']);
      assert.equal(local.find(p => p.name === '@getforma/build').peerDependencies['@getforma/compiler'], '=3.0.0-dev');
      assert.equal(local.find(p => p.name === '@getforma/build').devDependencies, undefined, 'inactive installed dev edges must not become workspace edges');
      const external = JSON.parse(run('npm', ['query', '[name="external"]', '--json'], cwd));
      assert.equal(external.length, 1);
      assert.equal(external[0].from.length, 1, 'the compiler-to-external edge must remain present');
      return JSON.stringify({ invalid: [], missing: [] });
    };
    const result = auditCandidateSignatures(dir, packages, dir, { execute });
    assert.equal(audits, 1);
    assert.equal(result.localCandidates.length, 2);
    assert.deepEqual(result.registryDependencies.map(p => [p.name, p.version, p.location, p.integrity]), [['external', '1.0.0', 'node_modules/external', 'sha512-external-fixture']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('external signature errors, missing signatures and unreadable responses remain failures', () => {
  const { dir, packages } = fixture();
  try {
    for (const response of [{ invalid: [{ code: 'EINTEGRITYSIGNATURE', name: 'external' }], missing: [] }, { invalid: [], missing: [{ name: 'external' }] }, {}]) {
      const execute = (command, args, cwd, options) => command === 'npm' && args[0] === 'audit' ? JSON.stringify(response) : run(command, args, cwd, options);
      assert.throws(() => auditCandidateSignatures(dir, packages, dir, { execute }), /registry signature|unreadable npm/);
    }
    const failure = new Error('registry unavailable');
    const execute = (command, args, cwd, options) => { if (command === 'npm' && args[0] === 'audit') throw failure; return run(command, args, cwd, options); };
    assert.throws(() => auditCandidateSignatures(dir, packages, dir, { execute }), error => error === failure);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unauthenticated candidate is refused before signature exclusions', () => {
  const { dir, packages } = fixture();
  try {
    writeFileSync(join(dir, 'compiler.tgz'), 'wrong bytes');
    assert.throws(() => auditCandidateSignatures(dir, packages, dir), /wrong DS11 bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
