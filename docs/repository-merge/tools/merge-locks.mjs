#!/usr/bin/env node
// Build the merged repository's root package-lock.json from the three incoming
// lockfiles, without resolving anything anew (FORMA-113).
//
//   node merge-locks.mjs <root package.json> <forma-tools lock> <formajs lock> <create-forma-app lock>
//
// forma-tools' lock is already a workspace lock whose root is the new root:
// its `node_modules/*` entries stay hoisted at the root and its two workspace
// entries (`packages/compiler`, `packages/build`) stay where they are. formajs'
// and create-forma-app's trees are NOT hoisted: every entry of theirs moves
// under `packages/core/node_modules/` and `packages/create-app/node_modules/`,
// so each package keeps exactly the dependency versions its A2 release was
// built with, and the two workspace link entries are added. Pure function of
// its inputs: the same locks give the same output, byte for byte.
import { readFileSync } from 'node:fs';

const [rootPkgPath, toolsLockPath, coreLockPath, createLockPath] = process.argv.slice(2);
if (!createLockPath) {
  console.error('usage: merge-locks.mjs <root package.json> <forma-tools lock> <formajs lock> <create-forma-app lock>');
  process.exit(2);
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const rootPkg = read(rootPkgPath);
const tools = read(toolsLockPath);
const nested = [
  ['packages/core', '@getforma/core', read(coreLockPath)],
  ['packages/create-app', '@getforma/create-app', read(createLockPath)],
];

for (const [name, lock] of [['forma-tools', tools], ['formajs', nested[0][2]], ['create-forma-app', nested[1][2]]]) {
  if (lock.lockfileVersion !== 3) throw new Error(`${name}: lockfileVersion ${lock.lockfileVersion}, expected 3`);
}

const packages = {};
// The root entry mirrors package.json, as npm writes it.
const root = { name: rootPkg.name };
if (rootPkg.version) root.version = rootPkg.version;
root.workspaces = rootPkg.workspaces;
if (rootPkg.dependencies) root.dependencies = rootPkg.dependencies;
if (rootPkg.devDependencies) root.devDependencies = rootPkg.devDependencies;
if (rootPkg.engines) root.engines = rootPkg.engines;
packages[''] = root;

for (const [key, entry] of Object.entries(tools.packages)) {
  if (key === '') continue;
  packages[key] = entry;
}

for (const [dir, pkgName, lock] of nested) {
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') {
      if (entry.name !== pkgName) throw new Error(`${dir}: lock root is ${entry.name}, expected ${pkgName}`);
      // A workspace entry carries the package's own manifest fields; the
      // `workspaces` field, if any, belongs to a root only.
      const { workspaces, ...rest } = entry;
      packages[dir] = rest;
      continue;
    }
    if (!key.startsWith('node_modules/')) throw new Error(`${dir}: unexpected lock key ${key}`);
    packages[`${dir}/${key}`] = entry;
  }
  packages[`node_modules/${pkgName}`] = { resolved: dir, link: true };
}

const sorted = {};
sorted[''] = packages[''];
for (const key of Object.keys(packages).filter((k) => k !== '').sort((a, b) => a.localeCompare(b, 'en'))) {
  sorted[key] = packages[key];
}

const out = {
  name: rootPkg.name,
  lockfileVersion: 3,
  requires: true,
  packages: sorted,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
