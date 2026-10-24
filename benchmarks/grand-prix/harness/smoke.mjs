#!/usr/bin/env node
// node harness/smoke.mjs <car> [--no-write]   exit 0 = pass
import { smokeCar, installTrap, writeRaw, configureResources } from './lib.mjs';
configureResources();
installTrap();
const car = process.argv[2];
if (!car) { console.error('usage: node harness/smoke.mjs <car> [--no-write]'); process.exit(2); }
const rec = await smokeCar(car);
for (const c of rec.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(8)} ${c.detail}`);
console.log(`${rec.pass ? 'SMOKE PASS' : 'SMOKE FAIL'} ${car}` + (rec.image?.sizeBytes ? `  image ${(rec.image.sizeBytes / 1e6).toFixed(1)} MB` : '') + (rec.readyMs != null ? `  ready after ${rec.readyMs} ms` : ''));
if (!process.argv.includes('--no-write')) writeRaw('smoke', car, rec);
process.exit(rec.pass ? 0 : 1);
