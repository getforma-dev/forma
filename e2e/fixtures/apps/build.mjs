#!/usr/bin/env node
// Build the fixture applications from this working tree: node build.mjs [app ...]
// Output: out/<app>/dist (the embedded assets), out/<app>/report.json (sizes, notes, time).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '@getforma/build';
import { buildApps } from './lib/build-apps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2);
try {
  await buildApps({ build, outRoot: join(here, 'out'), names: names.length ? names : undefined, log: line => console.log(line) });
} catch (error) {
  console.error(`fixture apps: ${error.message}`);
  process.exitCode = 1;
}
