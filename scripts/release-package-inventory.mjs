// Source inventory and immutable published inventories are different contracts.
// Router first participates in the next minor release; 3.0/3.1 records keep
// their authenticated seven-package set. A feature dry pack explicitly names
// its eight-package source inventory before versions are prepared.
import assert from 'node:assert/strict';
export const NPM_PACKAGES = Object.freeze(['core', 'compiler', 'build', 'router', 'create-app']);
export const CRATE_PACKAGES = Object.freeze(['forma-ir', 'forma-ir-derive', 'forma-server']);
export const ROUTER_PACKAGE_SET = 'forma-router-v1';
export function npmPackagesForVersion(version) {
  assert(typeof version === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:dev|(?:alpha|beta|rc)\.[1-9]\d*))?$/.test(version), 'package inventory needs a coordinated version');
  const [major, minor] = version.split('.').map(Number);
  assert(major >= 3, 'package inventory predates unified releases');
  return major > 3 || minor >= 2 ? [...NPM_PACKAGES] : NPM_PACKAGES.filter(name => name !== 'router');
}
export function packageIdentitiesForVersion(version) {
  return [...CRATE_PACKAGES.map(name => `crates:${name}`), ...npmPackagesForVersion(version).map(name => `npm:@getforma/${name}`)].sort();
}
export function candidateNpmPackages(set) {
  if (set.packageSet === undefined) return npmPackagesForVersion(set.packages?.[0]?.version);
  assert.equal(set.packageSet, ROUTER_PACKAGE_SET, 'unsupported candidate package inventory');
  return [...NPM_PACKAGES];
}
