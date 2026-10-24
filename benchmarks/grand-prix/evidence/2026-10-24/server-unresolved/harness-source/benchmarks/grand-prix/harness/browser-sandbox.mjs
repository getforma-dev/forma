// Permit user namespaces for only the authenticated benchmark browser path.
// https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = '# Owned by Forma Grand Prix browser setup.\n';
export function sandboxProfile(executable) {
  assert(/^\/[A-Za-z0-9_./-]+$/.test(executable) && resolve(executable) === executable,
    'browser path must be absolute and contain no AppArmor pattern syntax');
  const name = `forma-grand-prix-${createHash('sha256').update(executable).digest('hex').slice(0, 24)}`;
  return { path: `/etc/apparmor.d/${name}`, text: `${marker}abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} ${executable} flags=(unconfined) {\n  userns,\n}\n` };
}
export function installSandboxProfile(executable) {
  assert.equal(process.platform, 'linux');
  const restriction = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';
  if (!existsSync(restriction) || readFileSync(restriction, 'utf8').trim() !== '1') return null;
  assert.equal(process.getuid(), 0, 'install the browser profile with sudo');
  const profile = sandboxProfile(executable);
  writeFileSync(profile.path, profile.text, { flag: 'wx', mode: 0o644 });
  try { execFileSync('apparmor_parser', ['-r', profile.path], { stdio: 'inherit' }); }
  catch (error) { unlinkSync(profile.path); throw error; }
  return profile.path;
}
export function removeSandboxProfile(path) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0, 'remove the browser profile with sudo');
  assert(/^\/etc\/apparmor\.d\/forma-grand-prix-[a-f0-9]{24}$/.test(path), 'not a benchmark profile');
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.uid === 0 && readFileSync(path, 'utf8').startsWith(marker), 'profile ownership changed');
  execFileSync('apparmor_parser', ['-R', path], { stdio: 'inherit' });
  unlinkSync(path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--remove');
  removeSandboxProfile(process.argv[3]);
}
