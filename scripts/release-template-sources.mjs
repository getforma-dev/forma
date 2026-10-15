import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, run, digest } from './release-set.mjs';

const prefix = 'packages/create-app/templates/';
const staged = new Set(['Cargo.toml', 'Cargo.lock', 'admin/package.json', 'admin/package-lock.json']);
const historical = ['minimal/src/main.rs', 'dashboard/src/main.rs', 'minimal/admin/src/home/app.tsx'];
function retained(path) { return !staged.has(path.split('/').slice(1).join('/')); }
function files(root, base = '') {
  return readdirSync(join(root, base)).flatMap(name => {
    const path = base ? `${base}/${name}` : name, stat = lstatSync(join(root, path));
    assert(!stat.isSymbolicLink(), `packed template contains a symlink: ${path}`);
    return stat.isDirectory() ? files(root, path) : [path];
  });
}
/** Dependencies are staged/validated separately; every other source is exact. */
export function verifyPackedTemplateSources(cli, commit, capability, root = ROOT) {
  assert(/^[a-f0-9]{40}$/.test(commit), 'source record must name an exact commit');
  assert(['declared-v1', 'islands-v1'].includes(capability), 'unknown source template capability');
  const expected = capability === 'declared-v1' ? historical : run('git', ['ls-tree', '-r', '--name-only', commit, '--', prefix], root)
    .trim().split('\n').filter(Boolean).map(path => path.slice(prefix.length)).filter(retained).sort();
  assert(expected.length >= historical.length, 'template source inventory is incomplete');
  if (capability === 'islands-v1') {
    assert(expected.includes('minimal/admin/src/about/app.tsx'), 'islands template source lacks the static route');
    assert.deepEqual(files(join(cli, 'templates')).filter(retained).sort(), expected, 'packed template source inventory differs from the source commit');
  }
  const observations = expected.map(relative => {
    const original = run('git', ['show', `${commit}:${prefix}${relative}`], root, {encoding:'buffer'});
    const path = join(cli, 'templates', relative);
    assert.deepEqual(readFileSync(path), original, `${relative}: packed source differs`);
    return {path:relative,sha256:digest(path),bytes:original.length};
  });
  assert(!existsSync(join(cli, 'template-lock-seeds.json')), 'source-only seed identity leaked into the package');
  return {capability,files:observations};
}
