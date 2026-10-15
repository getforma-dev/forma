// Cross-language102 fixture: emit the actual declared source for native typed bind/render.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateRealIr } from '../dist/index.js';
const fixtureRoot = new URL('../../../crates/forma-server/tests/fixtures/props-contract/', import.meta.url);
const manifestFile = new URL('manifest.json', fixtureRoot);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const check = process.argv.includes('--check');
for (const [app, name] of [['app', 'home'], ['empty-app', 'empty'], ['empty-typed-app', 'empty-typed']]) {
  const entry = fileURLToPath(new URL(`../tests/fixtures/props-contract/${app}.ts`, import.meta.url));
  const output = fileURLToPath(new URL(`${name}.ir`, fixtureRoot));
  const emitted = generateRealIr(entry);
  if (!emitted) throw new Error(`declared props fixture ${name} degraded to placeholder`);
  const integrity = `sha384-${createHash('sha384').update(emitted.binary).digest('base64')}`;
  if (check) {
    if (!Buffer.from(emitted.binary).equals(readFileSync(output))) throw new Error(`declared props fixture ${name} differs; inspect the semantic change before regenerating`);
    if (manifest.assets[`${name}.ir`].integrity !== integrity) throw new Error(`declared props fixture ${name} integrity differs`);
  } else {
    writeFileSync(output, emitted.binary);
    manifest.assets[`${name}.ir`].integrity = integrity;
  }
}
if (!check) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
