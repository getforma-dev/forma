// Strict public adoption: 1,000 server-rendered bindings, then one shared update.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const entry = resolve(option('--entry', new URL('../../dist/forma.esm.js', import.meta.url).pathname));
const rows = Number(option('--rows', '1000')), warm = Number(option('--warm', '5')), runs = Number(option('--runs', '15'));
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.route('http://forma-bench.test/**', route => route.fulfill({
    contentType: route.request().url().endsWith('/core.js') ? 'text/javascript' : 'text/html',
    body: route.request().url().endsWith('/core.js') ? readFileSync(entry, 'utf8') : '<!doctype html><html><body></body></html>',
  }));
  await page.goto('http://forma-bench.test/');
  await page.addScriptTag({type: 'module', content: 'import * as core from "/core.js"; window.core = core;'});
  await page.waitForFunction(() => !!window.core);
  const samples = await page.evaluate(({rows, warm, runs}) => {
    const {h, createSignal, createRoot, hydrateIsland, onError} = window.core;
    const errors = [], off = onError(error => errors.push(String(error))), samples = [];
    try {
      for (let round = 0; round < warm + runs; round++) {
        const host = document.createElement('div');
        host.innerHTML = '<section>' + Array.from({length: rows}, (_, i) => `<span><!--f:t${i}-->0<!--/f:t${i}--></span>`).join('') + '</section>';
        document.body.appendChild(host);
        const nodes = Array.from(host.querySelectorAll('span'), span => span.childNodes[1]);
        const [value, setValue] = createSignal(0);
        const observer = new MutationObserver(() => {});
        observer.observe(host, {attributes: true, childList: true, characterData: true, subtree: true});
        let stop;
        const start = performance.now();
        createRoot(dispose => {
          stop = dispose;
          hydrateIsland(() => h('section', null, ...Array.from({length: rows}, () => h('span', null, value))), host);
        });
        const adoptionMs = performance.now() - start;
        const writes = observer.takeRecords().length;
        if (writes || errors.length) throw new Error(`Adoption failed: ${writes} writes; ${errors}`);
        const update = performance.now(); setValue(1); const updateMs = performance.now() - update;
        if (nodes.some(node => node.data !== '1' || !node.isConnected)) throw new Error('Update failed or replaced a server node');
        stop(); setValue(2);
        if (nodes.some(node => node.data !== '1')) throw new Error('Bindings survived disposal');
        observer.disconnect(); host.remove();
        if (round >= warm) samples.push({adoptionMs, updateMs, writes});
      }
    } finally { off(); }
    return samples;
  }, {rows, warm, runs});
  const mean = key => samples.reduce((sum, row) => sum + row[key], 0) / samples.length;
  const median = key => samples.map(row => row[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  console.log(JSON.stringify({entry, browser: browser.version(), rows, warm, runs, samples, mean: {adoptionMs: mean('adoptionMs'), updateMs: mean('updateMs')}, median: {adoptionMs: median('adoptionMs'), updateMs: median('updateMs')}}, null, 2));
} finally { await browser.close(); }
