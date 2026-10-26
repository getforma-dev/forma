import { cases, profiles } from '../packages/core/e2e/hostile-widgets/catalogue.mjs';
import { capabilityCases } from '../packages/core/e2e/hostile-widgets/capabilities.mjs';
import { fixtureCheckIds as legacyFixtureCheckIds } from '../e2e/fixtures/apps/lib/check-identities.mjs';
import { npmPackagesForVersion } from './release-package-inventory.mjs';
export const NATIVE_TEMPLATE_ENGINES = ['chromium', 'firefox', 'webkit'];
export const nativeTemplateCheckIds = version => npmPackagesForVersion(version).includes('router')
  ? NATIVE_TEMPLATE_ENGINES.map(engine => `template:native-router:${engine}:navigation`) : [];
export const dashboardRouterCheckIds = version => npmPackagesForVersion(version).includes('router')
  ? ['template:dashboard:router'] : [];
// The version comes from the authenticated RC, never the producer's case list.
// Keep the historical default for archived 3.0/3.1 raw-evidence callers.
export function fixtureCheckIds(project, version = '3.1.0') {
  return [...legacyFixtureCheckIds(project), ...nativeTemplateCheckIds(version), ...dashboardRouterCheckIds(version)];
}
export const hostileIds = () => [
  ...cases().map(item => `case:${item.id}`),
  ...capabilityCases.flatMap(item => profiles.map(profile => `capability:${item.id}/${profile}`)),
  ...profiles.flatMap(profile => ['no-auto', 'omitted-compiled', 'omitted-reviewed'].map(id => `explicit:${id}/${profile}`)),
  ...profiles.map(profile => `observer:${profile}`),
];
