import { readCampaign } from '../harness/campaign.mjs';
// Event 9: keyed-table DOM race in headless Chrome.
// Usage: node run.mjs [--cars vanilla,react,...] [--runs 5] [--warmups 2] [--out ../results/raw/dom]
//                     [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
// Every requested car must have a built index.html; missing cars and browser errors fail the run.
import puppeteer from 'puppeteer-core';
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appsDir, rawDir, parseArgs, builtCars, serveDist } from './lib.mjs';
import { validateProfile, verifyRoleAffinity } from '../harness/resource-profile.mjs';
import { measuredDuration, operationGeomean } from './timing.mjs';
import { createModel, checkState } from './assertions.mjs';

const args = parseArgs(process.argv.slice(2), {
  runs: '5', warmups: '2', out: path.join(rawDir, 'dom'),
  chrome: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const RUNS = +args.runs, WARM = +args.warmups;
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 1000 || !Number.isInteger(WARM) || WARM < 0 || WARM > 1000) throw new Error('runs must be 1–1000 and warmups 0–1000');
const resourceProfile = args['resource-profile'] ? validateProfile(JSON.parse(readFileSync(args['resource-profile'], 'utf8'))) : null;
const campaign = args.campaign ? readCampaign(args.campaign) : process.env.GP_CAMPAIGN_FILE ? readCampaign() : null;
if (resourceProfile?.qualified && !campaign) throw new Error('qualified run requires a campaign identity');
const processAffinity = resourceProfile ? verifyRoleAffinity(resourceProfile, 'browser') : null;
if (resourceProfile?.qualified && (RUNS !== 5 || WARM !== 2)) throw new Error('qualified DOM race requires five runs and two warmups');
const { have, missing } = builtCars(args.cars);
if (missing.length || !have.length) throw new Error('requested client cars missing built output: ' + missing.join(', '));
for (const car of have) for (const suffix of ['.json', '.failed.json']) {
  if (existsSync(path.join(args.out, car + suffix))) throw new Error('Refusing to overwrite retained DOM result: ' + car);
}

// Each op: prep (untimed) puts the page in the state it needs; click is what is timed; check verifies the result.
const ops = [
  { name: 'create1000', prep: ['clear'], click: '#run', check: (s) => s.rows === 1000 && s.firstId > 0 },
  { name: 'replace1000', prep: ['run'], click: '#run', check: (s) => s.rows === 1000 },
  { name: 'update10th', prep: ['clear', 'run'], click: '#update', check: (s) => s.rows === 1000 && s.labels.every((l, i) => l.endsWith(' !!!') === (i % 10 === 0)) },
  { name: 'select', prep: ['clear', 'run'], click: 'tbody tr:nth-child(3) a.lbl', check: (s) => s.danger === 1 && s.dangerIndex === 2 },
  { name: 'swap', prep: ['clear', 'run'], click: '#swaprows', before: 'ids', check: (s, b) => s.ids[1] === b.ids[998] && s.ids[998] === b.ids[1] && s.rows === 1000 },
  { name: 'remove', prep: ['clear', 'run'], click: 'tbody tr:nth-child(3) a.remove', before: 'ids', check: (s, b) => s.rows === 999 && s.ids[2] === b.ids[3] },
  { name: 'create10000', prep: ['clear'], click: '#runlots', check: (s) => s.rows === 10000 },
  { name: 'append1000', prep: ['clear', 'run'], click: '#add', check: (s) => s.rows === 2000 },
  { name: 'clear', prep: ['clear', 'run'], click: '#clear', check: (s) => s.rows === 0 },
];

const pageFns = () => {
  let previous = new Map();
  window.__remember = () => { previous = new Map([...document.querySelectorAll('tbody tr')].map(tr => [tr.querySelector('td.col-id').textContent, tr])); };
  window.__raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__state = () => {
    const trs = [...document.querySelectorAll('tbody tr')];
    const danger = trs.filter((t) => t.classList.contains('danger'));
    return {
      rows: trs.length,
      selected: danger.map(tr => tr.querySelector('td.col-id').textContent),
      keyed: trs.every(tr => { const id = tr.querySelector('td.col-id').textContent; return !previous.has(id) || previous.get(id) === tr; }),
      ids: trs.map((t) => t.querySelector('td.col-id').textContent),
      labels: trs.map((t) => t.querySelector('a.lbl').textContent),
      firstId: trs.length ? +trs[0].querySelector('td.col-id').textContent : 0,
      danger: danger.length,
      dangerIndex: danger.length ? trs.indexOf(danger[0]) : -1,
    };
  };
  window.__measure = async (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('no element ' + sel);
    // Script, style and layout, without frame pacing: from the click to a forced layout after one
    // task boundary (all microtasks drained, a MessageChannel task after the framework's own).
    const t0 = performance.now();
    el.click();
    await new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); r(); }; ch.port2.postMessage(0); });
    void document.body.offsetHeight;
    return performance.now() - t0;
  };
  window.__prep = async (sel) => { document.querySelector(sel).click(); await window.__raf2(); await new Promise((r) => setTimeout(r, 30)); };
};

const stats = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
};
const prepSel = { clear: '#clear', run: '#run' };

await mkdir(args.out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: args.chrome, headless: true, protocolTimeout: 60_000,
  args: ['--window-size=1280,800', '--no-first-run', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  defaultViewport: { width: 1280, height: 800 },
});
let browserProcessAffinity = null, chromeVersion;

try {
browserProcessAffinity = resourceProfile ? verifyRoleAffinity(resourceProfile, 'browser', readFileSync(`/proc/${browser.process().pid}/status`, 'utf8')) : null;
chromeVersion = await browser.version();
for (const car of have) {
  const server = await serveDist(path.join(appsDir, car, 'dist'));
  let page;
  const errors = [], result = {}, model = createModel();
  try {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(pageFns);
  await page.waitForSelector('#run');
  for (const op of ops) {
    const runs = [];
    result[op.name] = { runs };
    for (let i = 0; i < WARM + RUNS; i++) {
      for (const p of op.prep) { await page.evaluate((s) => window.__prep(s), prepSel[p]); model.apply(p); }
      await page.evaluate(() => window.__remember());
      const preparation = checkState(await page.evaluate(() => window.__state()), model.expected());
      if (preparation.length) throw new Error(`${car} ${op.name} preparation: ${preparation.join('; ')}`);
      const before = op.before ? await page.evaluate(() => window.__state()) : null;
      const ms = await page.evaluate((s) => window.__measure(s), op.click);
      measuredDuration(ms, `${car} ${op.name}`);
      model.apply(op.name === 'select' ? 'select' : op.name === 'remove' ? 'remove' : op.click.slice(1));
      const state = await page.evaluate(() => window.__state());
      const problems = checkState(state, model.expected());
      if (problems.length) throw new Error(`${car} ${op.name}: ${problems.join('; ')}`);
      if (errors.length) throw new Error(`${car}: browser errors: ${errors.join('; ')}`);
      if (!op.check(state, before)) throw new Error(`${car} ${op.name}: result check failed (rows=${state.rows})`);
      if (i >= WARM) runs.push(ms);
    }
    result[op.name] = { runs, ...stats(runs) };
    console.log(`${car.padEnd(8)} ${op.name.padEnd(12)} ${result[op.name].mean.toFixed(1)} ms +- ${result[op.name].sd.toFixed(1)}`);
  }
  const geomean = operationGeomean(ops.map(o => result[o.name].mean));
  console.log(`${car.padEnd(8)} geometric mean ${geomean.toFixed(2)} ms${errors.length ? '  PAGE ERRORS: ' + errors.length : ''}`);
  await writeFile(path.join(args.out, `${car}.json`), JSON.stringify({
    event: 9, car, measuredAt: new Date().toISOString(), runs: RUNS, warmups: WARM, geomeanMs: geomean, resourceProfile, campaign, processAffinity, browserProcessAffinity,
    ops: result, pageErrors: errors, verified: errors.length === 0, correctnessVersion: 'full-state-keyed-v1', executionOrder: have,
    machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, loadavg: os.loadavg(), chrome: chromeVersion, node: process.version },
  }, null, 2) + '\n', { flag: 'wx' });
  if (errors.length) throw new Error(`${car}: browser errors invalidate the race: ${errors.join('; ')}`);
  } catch (error) {
    await writeFile(path.join(args.out, `${car}.failed.json`), JSON.stringify({
      event: 9, car, measuredAt: new Date().toISOString(), verified: false, error: String(error), resourceProfile, campaign, processAffinity, browserProcessAffinity,
      ops: result, pageErrors: errors, chrome: chromeVersion,
    }, null, 2) + '\n', { flag: 'wx' });
    throw error;
  } finally {
    await page?.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
} finally { await browser.close(); }
