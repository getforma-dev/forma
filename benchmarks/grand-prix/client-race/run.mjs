// Event 9: keyed-table DOM race in headless Chrome.
// Usage: node run.mjs [--cars vanilla,react,...] [--runs 5] [--warmups 2] [--out ../results/raw/dom]
//                     [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
// Every requested car must have a built index.html; missing cars and browser errors fail the run.
import puppeteer from 'puppeteer-core';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appsDir, rawDir, parseArgs, builtCars, serveDist } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), {
  runs: '5', warmups: '2', out: path.join(rawDir, 'dom'),
  chrome: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const RUNS = +args.runs, WARM = +args.warmups;
const { have, missing } = builtCars(args.cars);
if (missing.length || !have.length) throw new Error('requested client cars missing built output: ' + missing.join(', '));

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
  window.__raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__state = () => {
    const trs = [...document.querySelectorAll('tbody tr')];
    const danger = trs.filter((t) => t.classList.contains('danger'));
    return {
      rows: trs.length,
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
    await new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
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
const chromeVersion = await browser.version();

try {
for (const car of have) {
  const server = await serveDist(path.join(appsDir, car, 'dist'));
  let page;
  const errors = [], result = {};
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
      for (const p of op.prep) await page.evaluate((s) => window.__prep(s), prepSel[p]);
      const before = op.before ? await page.evaluate(() => window.__state()) : null;
      const ms = await page.evaluate((s) => window.__measure(s), op.click);
      if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${car} ${op.name}: invalid timing ${ms}`);
      const state = await page.evaluate(() => window.__state());
      if (!op.check(state, before)) throw new Error(`${car} ${op.name}: result check failed (rows=${state.rows})`);
      if (i >= WARM) runs.push(ms);
    }
    result[op.name] = { runs, ...stats(runs) };
    console.log(`${car.padEnd(8)} ${op.name.padEnd(12)} ${result[op.name].mean.toFixed(1)} ms +- ${result[op.name].sd.toFixed(1)}`);
  }
  const geomean = Math.exp(ops.reduce((a, o) => a + Math.log(result[o.name].mean), 0) / ops.length);
  console.log(`${car.padEnd(8)} geometric mean ${geomean.toFixed(2)} ms${errors.length ? '  PAGE ERRORS: ' + errors.length : ''}`);
  await writeFile(path.join(args.out, `${car}.json`), JSON.stringify({
    event: 9, car, measuredAt: new Date().toISOString(), runs: RUNS, warmups: WARM, geomeanMs: geomean,
    ops: result, pageErrors: errors, verified: errors.length === 0,
    machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, loadavg: os.loadavg(), chrome: chromeVersion, node: process.version },
  }, null, 2) + '\n');
  if (errors.length) throw new Error(`${car}: browser errors invalidate the race: ${errors.join('; ')}`);
  } catch (error) {
    await writeFile(path.join(args.out, `${car}.failed.json`), JSON.stringify({
      event: 9, car, measuredAt: new Date().toISOString(), verified: false, error: String(error),
      ops: result, pageErrors: errors, chrome: chromeVersion,
    }, null, 2) + '\n');
    throw error;
  } finally {
    await page?.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
} finally { await browser.close(); }
