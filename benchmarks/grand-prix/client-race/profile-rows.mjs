// Optional attribution after the scored races. Profiling never supplies timing acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { appsDir, parseArgs, serveDist } from './lib.mjs';
import { validateProfile, verifyRoleAffinity } from '../harness/resource-profile.mjs';
import { readCampaign } from '../harness/campaign.mjs';

const args = parseArgs(process.argv.slice(2), {});
assert(['forma', 'vanilla'].includes(args.car), 'profile one fixed table implementation');
assert(/^[a-f0-9]{64}$/.test(args['chrome-sha256'] ?? ''), 'locked browser digest required');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(sha(args.chrome), args['chrome-sha256']);
const profile = validateProfile(JSON.parse(readFileSync(args['resource-profile'], 'utf8')));
const campaign = readCampaign(args.campaign);
const affinity = verifyRoleAffinity(profile, 'browser');
const out = resolve(args.out);
mkdirSync(out); // A repeated run must never overwrite an earlier profile.
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const manifest = dir => walk(dir).map(file => ({ path: relative(dir, file), sha256: sha(file), bytes: readFileSync(file).length }));
const report = { diagnostic: true, acceptance: false, car: args.car, source: args.source,
  profile, campaign, affinity, node: process.version, chromeSha256: args['chrome-sha256'],
  samplingIntervalUs: 100, warmups: 3, captures: 10, cases: [], completed: false };
let browser, server, page;
try {
  // Hidden source maps must leave every served HTML/JS/CSS byte identical.
  // This is an attribution build of the same input, never a different race car.
  const mappedDist = join(out, 'mapped-dist');
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', `apps/${args.car}`,
    '--config', `apps/${args.car}/vite.config.js`, '--sourcemap', 'hidden', '--outDir', mappedDist],
  { stdio: 'inherit' });
  report.originalBuild = manifest(join(appsDir, args.car, 'dist'));
  report.mappedBuild = manifest(mappedDist);
  const served = files => files.filter(file => ['.html', '.js', '.css'].includes(extname(file.path)));
  assert.deepEqual(served(report.mappedBuild), served(report.originalBuild), 'source maps changed served bytes');
  save('metadata.json', report);
  browser = await puppeteer.launch({ executablePath: args.chrome, headless: true, protocolTimeout: 60_000,
    args: ['--window-size=1280,800', '--no-first-run', '--disable-extensions',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    defaultViewport: { width: 1280, height: 800 } });
  report.browserAffinity = verifyRoleAffinity(profile, 'browser', readFileSync(`/proc/${browser.process().pid}/status`, 'utf8'));
  report.chrome = await browser.version();
  server = await serveDist(mappedDist);
  page = await browser.newPage();
  report.pageErrors = [];
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForSelector('#run');
  const client = await page.createCDPSession();
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 100 });
  for (const [name, selector, rows] of [['create1000', '#run', 1000], ['create10000', '#runlots', 10000]]) {
    for (let i = 0; i < report.warmups; i++) await page.evaluate(selector => {
      document.querySelector('#clear').click(); document.querySelector(selector).click(); void document.body.offsetHeight;
    }, selector);
    await page.tracing.start({ path: join(out, name + '.trace.json'),
      categories: ['devtools.timeline', 'v8', 'blink.user_timing', 'disabled-by-default-v8.cpu_profiler'] });
    const result = { name, rows, durations: [], profiles: [] };
    try {
      for (let i = 0; i < report.captures; i++) {
        await page.evaluate(() => { document.querySelector('#clear').click(); void document.body.offsetHeight; });
        await client.send('Profiler.start');
        try {
          result.durations.push(await page.evaluate(async ({ selector, name, i }) => {
            const mark = name + '-' + i;
            performance.mark(mark + '-start'); const start = performance.now();
            document.querySelector(selector).click();
            await new Promise(resolve => {
              const channel = new MessageChannel();
              channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
              channel.port2.postMessage(0);
            });
            void document.body.offsetHeight; performance.mark(mark + '-end');
            return performance.now() - start;
          }, { selector, name, i }));
        } finally { result.profiles.push((await client.send('Profiler.stop')).profile); }
        assert.equal(await page.evaluate(() => document.querySelectorAll('tbody tr').length), rows);
      }
      report.cases.push({ name, rows, captures: result.profiles.length });
    } finally {
      try { await page.tracing.stop(); }
      finally { save(name + '.json', result); }
    }
  }
  assert.deepEqual(report.pageErrors, []);
  report.completed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  try { if (page) await page.close(); }
  finally {
    try { if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
    finally { try { if (browser) await browser.close(); } finally { save('metadata.json', report); } }
  }
}
