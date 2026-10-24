import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const args = ['harness/linux-run.mjs'];
if (process.env.GP_CARS && process.env.GP_CARS !== 'all') args.push('--cars', process.env.GP_CARS);
const compression = process.env.GP_COMPRESSION === 'true';
args.push('--events', compression ? '1,3,4,5,7' : process.env.GP_EVENTS || '1,5-7');
if (compression) args.push('--compression');
if (process.env.GP_DIAGNOSTIC !== 'false') args.push('--diagnostic');
if (process.env.GP_BASELINE !== 'false') args.push('--baseline');
if (process.env.GP_FORMA_REF) {
  assert(/^[a-f0-9]{40}$/.test(process.env.GP_FORMA_REF));
  // Pull-request heads may not be in the checked-out branch's ancestry.
  const fetched = spawnSync('git', ['fetch', 'origin', process.env.GP_FORMA_REF], { stdio: 'inherit' });
  assert.equal(fetched.status, 0, 'could not fetch exact candidate source');
  args.push('--forma-ref', process.env.GP_FORMA_REF);
}
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
if (process.env.GP_CHECK_BUDGETS === 'true' && !compression) {
  const check = spawnSync(process.execPath, ['harness/budgets.mjs'], { stdio: 'inherit' });
  process.exit(check.status || (check.error ? 1 : 0));
}
