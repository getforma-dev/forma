// Untimed check of already-frozen browser fixtures, before the unchanged timing collector.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [race, chrome, profileFile, out] = process.argv.slice(2);
import puppeteer from 'puppeteer-core';
const { serveDist } = await import(pathToFileURL(path.join(race, 'lib.mjs')));
const { verifyRoleAffinity } = await import(pathToFileURL(path.join(race, '../harness/resource-profile.mjs')));
const profile = JSON.parse(await readFile(profileFile, 'utf8'));
const report = { kind: 'untimed-frozen-CSR-controls', results: [], passed: false };
let browser;
try {
  report.processAffinity = verifyRoleAffinity(profile, 'browser');
  browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  report.browserAffinity = verifyRoleAffinity(profile, 'browser', await readFile(`/proc/${browser.process().pid}/status`, 'utf8'));
  report.browser = await browser.version();
  for (const [car, key] of [['contract-control', '__contractChecks'], ['ownership-supplement', '__ownershipSupplement']]) {
    const server = await serveDist(path.join(race, 'apps', car, 'dist'));
    let page; const record = { car, errors: [] }; report.results.push(record);
    try {
      page = await browser.newPage();
      page.on('pageerror', e => record.errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') record.errors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
      await page.waitForFunction(k => Array.isArray(window[k]) || window[k]?.done, { timeout: 5000 }, key);
      record.result = await page.evaluate(k => window[k], key);
      const checks = Array.isArray(record.result) ? record.result : record.result.scenarios.flatMap(s => s.checks);
      assert.equal(checks.length, car === 'contract-control' ? 7 : 34);
      assert(checks.every(c => c.ok)); assert.deepEqual(record.errors, []);
      if (!Array.isArray(record.result)) assert.equal(record.result.passed, true);
    } finally { await page?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
  }
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { await browser?.close(); await writeFile(out, JSON.stringify(report, null, 2) + '\n'); }
