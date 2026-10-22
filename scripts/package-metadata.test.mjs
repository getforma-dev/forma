// FORMA-235. Maintained-source package metadata: bug reports and repository links
// identify the canonical monorepo, and published consumer `engines` floors stay
// separate from the workspace's development (`devEngines`) toolchain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeLines } from './toolchain-matrix.mjs';

const root = resolve(import.meta.dirname, '..');
const json = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const published = ['core', 'compiler', 'build', 'create-app'];
const canonical = 'https://github.com/getforma-dev/forma';

test('published packages identify the canonical monorepo for source and bug reports', () => {
  for (const name of published) {
    const pkg = json(`packages/${name}/package.json`);
    assert.deepEqual(pkg.repository, { type: 'git', url: `git+${canonical}.git`, directory: `packages/${name}` }, `${name}: repository`);
    if (pkg.bugs !== undefined) assert.equal(pkg.bugs.url, `${canonical}/issues`, `${name}: bugs.url`);
    const links = JSON.stringify([pkg.repository, pkg.bugs, pkg.homepage]);
    assert.doesNotMatch(links, /formajs|forma-tools/i, `${name}: archived repository named in package links`);
  }
  assert.equal(json('packages/core/package.json').bugs.url, `${canonical}/issues`, 'core keeps an explicit bug-report URL');
  assert.equal(json('package.json').bugs, undefined, 'the private workspace has no separate bug tracker');
});

test('consumer engines floors track the oldest supported line, not the development pin', () => {
  const pin = readFileSync(resolve(root, '.node-version'), 'utf8').trim();
  const pinMajor = Number(pin.split('.')[0]);
  const oldest = Math.min(...nodeLines());
  assert(oldest < pinMajor, 'the consumer floor must stay below the maintenance pin line');
  for (const name of published) {
    assert.equal(json(`packages/${name}/package.json`).engines.node, `>=${oldest}`, `${name}: consumer engines floor`);
  }
});

test('development guidance agrees with the pinned workspace toolchain', () => {
  const pin = readFileSync(resolve(root, '.node-version'), 'utf8').trim();
  const range = `>=${pin} <${Number(pin.split('.')[0]) + 1}`;
  assert.equal(json('package.json').engines.node, range, 'workspace engines');
  assert.deepEqual(json('packages/core/package.json').devEngines, { runtime: { name: 'node', version: range, onFail: 'warn' } });
  for (const name of published.filter((n) => n !== 'core')) assert.equal(json(`packages/${name}/package.json`).devEngines, undefined, `${name}: no stray devEngines`);
});
