// Cross-language102 fixture: emit the actual declared source for native typed bind/render.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateRealIr } from '../dist/index.js';
const entry = fileURLToPath(new URL('../tests/fixtures/props-contract/app.ts', import.meta.url));
const output = fileURLToPath(new URL('../../../crates/forma-server/tests/fixtures/props-contract/home.ir', import.meta.url));
const emitted = generateRealIr(entry);
if (!emitted) throw new Error('declared props fixture degraded to placeholder');
if (process.argv.includes('--check')) {
  if (!Buffer.from(emitted.binary).equals(readFileSync(output))) throw new Error('declared props fixture differs; inspect the semantic change before regenerating');
} else writeFileSync(output, emitted.binary);
