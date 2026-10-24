// Usage: node _smoke.mjs http://127.0.0.1:PORT   -> prints one line per check, exit 1 on failure.
import { expected } from '../shared/dataset.mjs';
const base = process.argv[2];
let bad = 0;
const h = await fetch(base + '/health');
const ht = await h.text();
const hok = h.status === 200 && ht === 'ok';
console.log(`health: ${hok ? 'PASS' : 'FAIL'} (${h.status} ${JSON.stringify(ht)})`);
if (!hok) bad++;
for (const n of [100, 1000]) {
  const r = await fetch(`${base}/ssr?rows=${n}`);
  const body = await r.text();
  const e = expected(n);
  const rc = body.split('<tr data-id=').length - 1;
  const missing = e.mustContain.filter((s) => !body.includes(s));
  const ok = r.status === 200 && rc === n && missing.length === 0 && body.startsWith('<!doctype html>');
  if (!ok) bad++;
  console.log(`rows=${n}: ${ok ? 'PASS' : 'FAIL'} status=${r.status} rowcount=${rc} missing=${JSON.stringify(missing)} bytes=${body.length}`);
}
process.exit(bad ? 1 : 0);
