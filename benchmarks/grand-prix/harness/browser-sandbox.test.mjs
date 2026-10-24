import assert from 'node:assert/strict';
import test from 'node:test';
import { sandboxProfile } from './browser-sandbox.mjs';

test('profile grants userns to one exact browser path without a wildcard', () => {
  const profile = sandboxProfile('/home/runner/work/_temp/chrome/linux-156/chrome');
  assert.match(profile.path, /^\/etc\/apparmor\.d\/forma-grand-prix-[a-f0-9]{24}$/);
  assert.match(profile.text, /\/home\/runner\/work\/_temp\/chrome\/linux-156\/chrome flags=\(unconfined\)/);
  assert.match(profile.text, /\n  userns,\n/);
  assert(!profile.text.includes('*'));
  assert.deepEqual(profile, sandboxProfile('/home/runner/work/_temp/chrome/linux-156/chrome'));
  assert.notEqual(profile.path, sandboxProfile('/other/chrome').path);
});
for (const path of ['relative/chrome', '/tmp/*/chrome', '/tmp/{a,b}/chrome', '/tmp/../chrome', '/tmp/chrome\nuserns,', '/tmp/"chrome', '/tmp/@{HOME}/chrome']) {
  test(`rejects AppArmor interpolation or noncanonical path ${JSON.stringify(path)}`, () => assert.throws(() => sandboxProfile(path)));
}
