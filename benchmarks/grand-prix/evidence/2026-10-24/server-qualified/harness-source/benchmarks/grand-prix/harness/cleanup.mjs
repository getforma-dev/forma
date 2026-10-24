import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('results', { recursive: true });
const id = process.env.GP_RUN_ID;
assert(/^[a-z0-9-]+$/.test(id ?? ''), 'cleanup requires this run\'s GP_RUN_ID');
const dry = process.argv.includes('--dry-run');
const docker = args => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const ids = args => docker(args).split(/\s+/).filter(Boolean);
const label = `gp264run=${id}`;
const cleanup = { id, before: execFileSync('df', ['-k', '.'], { encoding: 'utf8' }), actions: [], dry };
function remove(args) {
  cleanup.actions.push(args);
  console.log(JSON.stringify(['docker', ...args]));
  if (!dry) docker(args);
}
for (const [query, command] of [
  [['ps', '-aq'], ['rm', '-f']],
  [['network', 'ls', '-q'], ['network', 'rm']],
  [['volume', 'ls', '-q'], ['volume', 'rm']],
  [['image', 'ls', '-q'], ['image', 'rm']],
]) {
  const owned = [...new Set(ids([...query, '--filter', `label=${label}`]))];
  if (owned.length) remove([...command, ...owned]);
}
// The driver writes this manifest only after successfully creating its unique
// builder. No prefix-based deletion or global image/cache pruning is allowed.
const manifest = resolve('results', `${id}-ownership.json`);
if (existsSync(manifest)) {
  const owned = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(owned.id, id);
  assert.equal(owned.builder, `gp264-${id}`);
  if (owned.builderCreated) {
    remove(['buildx', 'rm', owned.builder]);
    if (!dry) { owned.builderCreated = false; writeFileSync(manifest, JSON.stringify(owned)); }
  }
}
cleanup.after = execFileSync('df', ['-k', '.'], { encoding: 'utf8' });
if (!dry) writeFileSync(resolve('results', `${id}-cleanup.json`), JSON.stringify(cleanup, null, 2) + '\n');
