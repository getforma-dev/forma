import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compatibilityPeer } from './release-set.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function command(args, cwd) {
  return spawnSync(npm, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

test('real npm installs enforce the compatibility peers and narrow prerelease exception', { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'forma-install-window-'));
  const packs = new Map();
  function packed(member, version) {
    const key = `${member}-${version}`;
    if (packs.has(key)) return packs.get(key);
    const dir = join(root, key); mkdirSync(dir);
    const peer = member === 'compiler' ? '@getforma/core' : member === 'build' ? '@getforma/compiler' : undefined;
    const metadata = { name: `@getforma/${member}`, version, ...(peer ? {peerDependencies: {[peer]: compatibilityPeer(version)}} : {}),
      ...(member === 'build' ? {peerDependenciesMeta: {'@getforma/compiler': {optional: true}}} : {}) };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(metadata));
    const result = command(['pack', '--ignore-scripts', '--json', '--pack-destination', root], dir);
    assert.equal(result.status, 0, result.stderr);
    const file = join(root, JSON.parse(result.stdout)[0].filename);
    packs.set(key, file); return file;
  }
  try {
    const cases = [
      {core: '3.2.0', compiler: '3.2.0', ok: true},
      {core: '3.2.9', compiler: '3.2.0', ok: true},
      {core: '3.2.0', compiler: '3.1.0', ok: true},
      {core: '3.1.0', compiler: '3.2.0', ok: false},
      {core: '4.0.0', compiler: '3.2.0', ok: false},
      {core: '3.2.0-dev', compiler: '3.2.0-dev', ok: true},
      {core: '3.2.0-alpha.1', compiler: '3.2.0-alpha.1', ok: true},
      {core: '3.3.0-alpha.1', compiler: '3.2.0-alpha.1', ok: false},
      {core: '3.2.0', compiler: '3.1.0', build: '3.2.0', ok: true, optionalOverride: true},
      {build: '3.2.0', ok: true},
    ];
    for (const [index, row] of cases.entries()) {
      const dir = join(root, `consumer-${index}`); mkdirSync(dir);
      writeFileSync(join(dir, 'package.json'), '{"name":"window-consumer","version":"1.0.0","private":true}');
      const files = ['core', 'compiler', 'build'].filter(name => row[name]).map(name => packed(name, row[name]));
      const result = command(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--strict-peer-deps', ...files], dir);
      assert.equal(result.status === 0, row.ok, `${JSON.stringify(row)}\n${result.stderr}`);
      if (row.optionalOverride) {
        assert.match(result.stderr, /ERESOLVE overriding peer dependency/);
        assert.match(result.stderr, /peerOptional @getforma\/compiler/);
        // npm permits this optional conflict; the actual build guard must reject it.
      } else if (row.ok) {
        for (const name of ['core', 'compiler', 'build'].filter(name => row[name])) {
          assert.equal(JSON.parse(readFileSync(join(dir, 'node_modules', '@getforma', name, 'package.json'), 'utf8')).version, row[name]);
        }
      } else assert.match(result.stderr, /ERESOLVE/, 'must refuse the actual peer conflict, not a missing registry package');
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});
