// Cross-language102 fixture: emit the actual declared source for native typed bind/render.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateRealIr } from '../dist/index.js';
for (const [app, name] of [['app', 'home'], ['empty-app', 'empty'], ['empty-typed-app', 'empty-typed']]) {
  const entry = fileURLToPath(new URL(`../tests/fixtures/props-contract/${app}.ts`, import.meta.url));
  const output = fileURLToPath(new URL(`../../../crates/forma-server/tests/fixtures/props-contract/${name}.ir`, import.meta.url));
  const emitted = generateRealIr(entry);
  if (!emitted) throw new Error(`declared props fixture ${name} degraded to placeholder`);
  if (process.argv.includes('--check')) {
    if (!Buffer.from(emitted.binary).equals(readFileSync(output))) throw new Error(`declared props fixture ${name} differs; inspect the semantic change before regenerating`);
  } else writeFileSync(output, emitted.binary);
}
