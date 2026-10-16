import { cases, profiles } from '../packages/core/e2e/hostile-widgets/catalogue.mjs';
import { capabilityCases } from '../packages/core/e2e/hostile-widgets/capabilities.mjs';
export { fixtureCheckIds } from '../e2e/fixtures/apps/lib/check-identities.mjs';
export const hostileIds = () => [
  ...cases().map(item => `case:${item.id}`),
  ...capabilityCases.flatMap(item => profiles.map(profile => `capability:${item.id}/${profile}`)),
  ...profiles.flatMap(profile => ['no-auto', 'omitted-compiled', 'omitted-reviewed'].map(id => `explicit:${id}/${profile}`)),
  ...profiles.map(profile => `observer:${profile}`),
];
