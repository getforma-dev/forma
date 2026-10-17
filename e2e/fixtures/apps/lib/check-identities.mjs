// Pure identities shared by actual fixture controls and release evidence validation.
import { readApps } from './build-apps.mjs';
export const EXTRA_NAMES = {
  "ledger": [
    "/household: a failed load names the attempt, keeps the snapshot, and Retry recovers"
  ],
  "fauth": [
    "/t/quote/login: a tenant named with script and markup renders as text and runs nothing",
    "/t/unknown/login: an unknown tenant is a 404, not a page",
    "/t/lockbox/login: an invite-only tenant offers no provider button and no sign-up switch"
  ],
  "ksx": [
    "/check?state=empty: with no controller the empty section replaces the chips, and the roster is empty",
    "/check: the roster and the chips are the nested payload read through paths and rows"
  ],
  "bench": []
};
export function fixtureCheckIds(project) {
  const ids = [];
  for (const [name, app] of Object.entries(readApps(project).apps)) {
    for (const [route, page] of Object.entries(app.routes)) {
      ids.push(`fixture:${name}:${route}`);
      for (const variant of page.variants ?? []) ids.push(`fixture:${name}:${route} (${variant.name})`);
    }
    for (const extra of EXTRA_NAMES[name] ?? []) ids.push(`extra:${name}: ${extra}`);
  }
  return [...ids, 'template:minimal:adoption', 'template:minimal:static', 'template:dashboard:interaction'];
}
