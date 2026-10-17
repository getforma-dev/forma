import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { invocation, order, runComparison } from './indexed-primitive-comparison.mjs';

test('actual child invocations preserve ABBA, exact original arguments, ports and absolute reporter/output paths', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-abba-')));
  try {
    const sources = { A: join(root, 'baseline'), B: join(root, 'candidate') }, output = join(root, 'observations');
    for (const cwd of Object.values(sources)) {
      mkdirSync(join(cwd, 'node_modules/@playwright/test'), { recursive: true });
      writeFileSync(join(cwd, 'node_modules/@playwright/test/cli.js'), `
        const fs = require('node:fs'), path = require('node:path');
        const lock = path.join(path.dirname(process.cwd()), 'one-active-child.lock');
        const fd = fs.openSync(lock, 'wx'); // Overlapping invocations fail the real child.
        setTimeout(() => {
          fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
            cwd:process.cwd(), args:process.argv.slice(2), port:process.env.FORMA_SSR_E2E_PORT, debug:process.env.DEBUG
          }));
          fs.closeSync(fd); fs.unlinkSync(lock);
        }, 10);
      `);
    }
    assert.equal(await runComparison(sources, output), 0);
    const rows = JSON.parse(readFileSync(join(output, 'slots.json')));
    assert.deepEqual(rows.map(row => row.slot), ['A1', 'B1', 'B2', 'A2']);
    for (const row of rows) {
      const actual = JSON.parse(readFileSync(row.reporter));
      assert.equal(row.state, 'finished'); assert.equal(row.exitCode, 0); assert.equal(row.signal, null);
      assert.equal(actual.cwd, sources[row.slot[0]]); assert.equal(actual.port, row.slot[0] === 'A' ? '3458' : '3459');
      assert.equal(actual.debug, 'pw:browser');
      assert.deepEqual(actual.args, ['test', '--config', 'e2e/ssr/indexed-products.config.ts', '--project=chromium',
        '--workers=1', '--retries=0', '--reporter=list,json', '--grep', 'indexed products: complete public set',
        '--output', join(output, row.slot, 'artifacts')]);
      assert.equal(row.reporter, join(output, row.slot, 'playwright.json'));
    }
    await assert.rejects(runComparison(sources, output), /EEXIST/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const failed of ['A1', 'B1']) test(`a real ${failed} exit 7 is retained, all later slots execute, and final status fails`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forma-abba-failure-')));
  try {
    const sources = { A: join(root, 'baseline'), B: join(root, 'candidate') }, output = join(root, 'observations');
    for (const cwd of Object.values(sources)) {
      mkdirSync(join(cwd, 'node_modules/@playwright/test'), { recursive: true });
      writeFileSync(join(cwd, 'node_modules/@playwright/test/cli.js'), `
        const fs = require('node:fs'), path = require('node:path');
        const slot = path.basename(path.dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE));
        fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({slot}));
        process.exitCode = slot === ${JSON.stringify(failed)} ? 7 : 0;
      `);
    }
    assert.equal(await runComparison(sources, output), 1);
    const rows = JSON.parse(readFileSync(join(output, 'slots.json')));
    assert.deepEqual(rows.map(row => row.slot), order);
    assert.deepEqual(rows.map(row => row.exitCode), order.map(slot => slot === failed ? 7 : 0));
    assert(rows.every(row => row.state === 'finished'));
    assert.deepEqual(rows.map(row => JSON.parse(readFileSync(row.reporter)).slot), order);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relative evidence paths and unplanned slots refuse before invocation', () => {
  assert.throws(() => invocation('A3', { A: '/a', B: '/b' }, '/out'));
  assert.throws(() => invocation('A1', { A: '/a', B: '/b' }, 'relative'));
});
