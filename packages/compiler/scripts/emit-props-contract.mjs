// Cross-language102 fixture: emit the actual declared source for native typed bind/render.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateRealIr } from '../dist/index.js';
import { assertCurrentFmir, packageWriter } from '../../../scripts/fmir-corpus.mjs';
const fixtureRoot = new URL('../../../crates/forma-server/tests/fixtures/props-contract/', import.meta.url);
const manifestFile = new URL('manifest.json', fixtureRoot);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const check = process.argv.includes('--check');
const writer = packageWriter(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
for (const [app, name] of [['app', 'home'], ['empty-app', 'empty'], ['empty-typed-app', 'empty-typed']]) {
  const entry = fileURLToPath(new URL(`../tests/fixtures/props-contract/${app}.ts`, import.meta.url));
  const output = fileURLToPath(new URL(`${name}.ir`, fixtureRoot));
  const emitted = generateRealIr(entry);
  if (!emitted) throw new Error(`declared props fixture ${name} degraded to placeholder`);
  const integrity = `sha384-${createHash('sha384').update(emitted.binary).digest('base64')}`;
  if (check) {
    // The fixtures keep the writer that froze them; only the header's writer and CRC may differ.
    const frozen = readFileSync(output);
    try { assertCurrentFmir({ name, bytes: emitted.binary, frozenBytes: frozen, expectedVersion: writer }); }
    catch (error) { throw new Error(`declared props fixture ${name} differs; inspect the semantic change before regenerating: ${error.message}`); }
    if (manifest.assets[`${name}.ir`].integrity !== `sha384-${createHash('sha384').update(frozen).digest('base64')}`) throw new Error(`declared props fixture ${name} integrity differs`);
  } else {
    writeFileSync(output, emitted.binary);
    manifest.assets[`${name}.ir`].integrity = integrity;
  }
}
if (!check) writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
