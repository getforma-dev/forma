import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDependabotPolicy, validateDependabotPolicy } from './dependabot-policy.mjs';

const files = ['docs/archive/old/package.json', 'docs/archive/old/packages/core/package.json'];
const policy = () => ({ version: 2, updates: [{
  'package-ecosystem': 'npm',
  directories: ['/docs/archive/old', '/docs/archive/old/packages/core'],
  schedule: { interval: 'weekly' },
  'open-pull-requests-limit': 0,
  ignore: [{ 'dependency-name': '*' }],
}] });

test('current tracked archives are covered by the real configuration', () => {
  assert.deepEqual(checkDependabotPolicy(), []);
});

test('new archive manifests require explicit coverage', () => {
  assert.deepEqual(validateDependabotPolicy(policy(), [...files, 'docs/archive/new/package.json']),
    ['Missing archive update policy: /docs/archive/new']);
});

test('recursive globs and active wildcard ignores are rejected', () => {
  for (const path of ['/docs/archive/**', '/', '/packages/core', '/docs/archive/old/../../../packages/core']) {
    const config = policy();
    config.updates[0].directories.push(path);
    assert.match(validateDependabotPolicy(config, files).join('\n'), /exact tracked archive manifest directory/);
  }
});

test('a second npm block cannot ignore active dependencies', () => {
  const config = policy();
  config.updates.push({ 'package-ecosystem': 'npm', directory: '/', ignore: [{ 'dependency-name': '*' }] });
  assert.match(validateDependabotPolicy(config, files).join('\n'), /exact tracked archive manifest directory: \//);
});

test('archive rules retain security and version PR suppression', () => {
  for (const mutate of [
    rule => { delete rule.ignore; },
    rule => { rule.ignore[0].versions = ['1.x']; },
    rule => { rule.ignore[0]['update-types'] = ['version-update:semver-major']; },
    rule => { rule['open-pull-requests-limit'] = 1; },
    rule => { rule['target-branch'] = 'maintenance'; },
  ]) {
    const config = policy();
    mutate(config.updates[0]);
    assert.notDeepEqual(validateDependabotPolicy(config, files), []);
  }
});

test('normal active dependency updates remain allowed', () => {
  const config = policy();
  config.updates.push({ 'package-ecosystem': 'npm', directory: '/', schedule: { interval: 'weekly' } });
  assert.deepEqual(validateDependabotPolicy(config, files), []);
});
