// Record the actual compiler/native/browser products used by N3's indexed rows test.
// Run after build.sh; the full HTML includes its per-render nonce, so this is evidence of a run,
// not a promise that every later page render has the same HTML hash.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpFmir, generateRealIr } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const source = join(here, 'cases/keyed-indexed');
const dist = join(here, 'out/build/keyed-indexed');
const site = join(here, 'out/site/keyed-indexed');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const ir = readFileSync(join(dist, manifest.routes['/'].ir));
const emitted = generateRealIr(join(source, 'app.tsx'));
assert(emitted, 'the current source did not emit a native module');
assert.deepEqual(ir, Buffer.from(emitted.binary), 'served native module differs from current compiler emission');
const html = readFileSync(join(site, 'index.html'), 'utf8');
const profile = process.env.FORMA_SSR_PROFILE ?? 'debug';
assert(['debug', 'release'].includes(profile), 'unknown native renderer profile');
const headers = JSON.parse(readFileSync(join(site, 'index.headers.json'), 'utf8'));
assert.match(headers['content-security-policy'], /(?:^|; )require-trusted-types-for 'script'(?:;|$)/, 'the native product must enforce Trusted Types');
if ('content-security-policy-report-only' in headers) {
  // The integrated fixture configures a real receiver in both profiles. An
  // endpoint-less debug policy is still invalid product qualification.
  assert.match(headers['content-security-policy-report-only'], /(?:^|; )report-uri \/__csp-reports(?:;|$)/, 'report-only policy must use the fixture receiver');
}
const found = [...html.matchAll(/<script\b[^>]*\bdata-island-state\b[^>]*>([^<]*)<\/script>/g)];
assert.equal(found.length, 1, 'expected one real native state block');
const state = JSON.parse(found[0][1]);
const counts = JSON.parse(readFileSync(join(source, 'slots.json'), 'utf8'));
const expected = ['small', 'large'].map(name => ({ name, rows: Array.from({ length: counts[name] }, (_, index) => ({ id: `row-${index}`, label: `Label ${index}` })) }));
assert.deepEqual(state.i.map(each => each.p), expected);
assert.equal(emitted.islands.length, 2);
for (const instance of state.i) assert.equal(instance.h, emitted.islands[0].contract.digest);
const size = JSON.parse(readFileSync(join(dist, 'size-report.json'), 'utf8'));
for (const route of size.routes) {
  assert.equal(route.over, false, route.route + ': route budget');
  assert.deepEqual(route.exceeded, []);
  assert(route.forma.gzip > 0 && route.forma.gzip <= route.ceilings.forma);
  assert(route.javascript.gzip <= route.ceilings.javascript);
}
const dump = Buffer.from(dumpFmir(ir));
const stateBytes = Buffer.from(found[0][1]);
const servedAssets = [manifest.routes['/'].ir, ...manifest.routes['/'].js].map(name => {
  const path = join(here, 'out/site/_assets', name);
  assert.deepEqual(readFileSync(path), readFileSync(join(dist, name)), `served asset ${name} differs from the build product`);
  return path;
});
const products = [
  ...['app.tsx', 'page.tsx', 'slots.json'].map(name => join(source, name)),
  join(here, 'render/src/main.rs'), join(here, 'build.sh'), join(here, 'indexed-products.spec.ts'), join(here, '../target', profile, 'forma-e2e-render'),
  ...['compiler', 'build', 'core'].map(name => join(root, 'packages', name, 'dist/index.js')),
  join(dist, 'manifest.json'), join(dist, 'size-report.json'), join(dist, manifest.routes['/'].ir),
  ...manifest.routes['/'].js.map(name => join(dist, name)), ...servedAssets,
  join(site, 'index.html'), join(site, 'index.headers.json'),
];
const files = Object.fromEntries(products.map(path => {
  const bytes = readFileSync(path);
  return [relative(root, path), { bytes: bytes.length, sha256: sha(bytes) }];
}));
const report = {
  schema: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  nativeProfile: profile,
  nativeHeaders: headers,
  files,
  nativeDump: { bytes: dump.length, sha256: sha(dump) },
  nativeState: { bytes: stateBytes.length, sha256: sha(stateBytes), rows: expected.map(instance => ({ name: instance.name, count: instance.rows.length, first: instance.rows[0], last: instance.rows.at(-1) })) },
  routeBudgets: size,
  registration: emitted.islands.find(each => each.name === 'IndexedRows').contract,
};
writeFileSync(join(here, 'out/indexed-products.dump'), dump);
writeFileSync(join(here, 'out/indexed-products-evidence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`indexed products: ${products.length} file hashes, native dump/state hashes, current IR and registration verified`);
