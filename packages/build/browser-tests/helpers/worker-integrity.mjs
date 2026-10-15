import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';

export const WORKER_INTEGRITY_CHECKS = [
  'installation does not fetch lazy assets or claim the registering page',
  'altered cached entry refetches and never executes',
  'dynamic chunk without a script tag is verified before execution',
  'altered network chunk is refused and never cached or executed',
  'verified cache works offline and altered cache fails offline',
  'gzip and brotli delivery hash decoded bytes',
];
export const WORKER_LIFECYCLE_CHECKS = [
  'old tabs keep their worker and cache while an upgrade waits',
  'alternating deployment instances preserve the old cache',
  'closing old tabs activates the next build without touching other apps',
  'rollback then upgrade follows the same waiting boundary',
  'actual retiring worker deletes only owned and v1 caches then unregisters',
  'retired application fetches assets from the network afterward',
];

async function until(read, predicate, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < end);
  throw new Error(`${label}; last observation: ${JSON.stringify(value)}`);
}

async function deployment(build, directory, app, label) {
  mkdirSync(directory, {recursive: true});
  const entry = join(directory, 'app.ts');
  writeFileSync(join(directory, 'later.ts'), `export const label = ${JSON.stringify(`lazy ${label}`)};`);
  writeFileSync(join(directory, 'style.css'), 'main { color: rgb(0, 128, 0); }');
  writeFileSync(entry, `import './style.css';
    document.querySelector('main').textContent = ${JSON.stringify(`build ${label}`)};
    window.__workerAppLoaded = ${JSON.stringify(label)};
    document.querySelector('button').onclick = async () => {
      try { document.querySelector('#lazy').textContent = (await import('./later')).label; }
      catch { document.querySelector('#lazy').textContent = 'refused'; }
    };`);
  const outputDir = join(directory, 'dist');
  const {manifest} = await build({app, codeSplitting: true, entryPoints: [{entry, outfile: 'app.js'}], routes: {'/': {js: ['app'], css: []}}, outputDir});
  const entryFile = manifest.routes['/'].js[0];
  const lazyFile = Object.keys(manifest.assets).find(name => name.startsWith('chunk.') && name.endsWith('.js'));
  assert.ok(lazyFile, 'the real build must emit a dynamic chunk');
  return {label, manifest, outputDir, entryFile, lazyFile, worker: readFileSync(join(outputDir, 'sw.js'), 'utf8'), cache: `forma:${app}:${manifest.build.slice(0, 12)}`};
}

async function fixture(build, browser, workDir, app, labels) {
  assert.match(app, /^[a-z0-9][a-z0-9-]{0,62}$/);
  mkdirSync(workDir, {recursive: true});
  const directory = mkdtempSync(join(workDir, 'worker-browser-'));
  const deployments = {};
  for (const label of labels) deployments[label] = await deployment(build, join(directory, label), app, label);
  const state = {deployed: labels[0], alternate: false, swHits: 0, retiring: undefined, encoding: 'identity', poisoned: new Map(), hits: new Map()};
  const assets = new Map();
  for (const item of Object.values(deployments)) for (const file of Object.keys(item.manifest.assets)) {
    assets.set('/_assets/' + file.split('/').map(encodeURIComponent).join('/'), {file, bytes: readFileSync(join(item.outputDir, file))});
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    state.hits.set(path, (state.hits.get(path) ?? 0) + 1);
    if (path === '/sw.js') {
      const selected = state.alternate ? labels[state.swHits++ % labels.length] : state.deployed;
      response.writeHead(200, {'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache'});
      response.end(state.retiring ?? deployments[selected].worker);
    } else if (assets.has(path)) {
      const asset = assets.get(path);
      let bytes = state.poisoned.get(path) ?? asset.bytes;
      const encoding = state.encoding;
      if (encoding === 'gzip') bytes = gzipSync(bytes);
      if (encoding === 'br') bytes = brotliCompressSync(bytes);
      response.writeHead(200, {'Content-Type': asset.file.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'public, max-age=31536000, immutable', ...(encoding !== 'identity' ? {'Content-Encoding': encoding} : {})});
      response.end(bytes);
    } else if (path === '/seed') {
      response.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'});
      response.end('<!doctype html><title>cache setup</title>');
    } else {
      const item = deployments[state.deployed];
      const script = '/_assets/' + item.entryFile;
      const integrity = item.manifest.assets[item.entryFile].integrity;
      response.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'});
      response.end(`<!doctype html><main></main><button>Open lazy module</button><output id="lazy"></output><script type="module" src="${script}" integrity="${integrity}" crossorigin="anonymous"></script>${state.retiring ? '' : '<script>navigator.serviceWorker.register("/sw.js");</script>'}`);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({serviceWorkers: 'allow'});
  return {directory, deployments, state, origin, context, close: async () => {
    try { await context.close(); } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }};
}

async function pageState(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {registered: !!registration, waiting: !!registration?.waiting, controlled: !!navigator.serviceWorker.controller, caches: (await caches.keys()).sort(), text: document.querySelector('main')?.textContent, lazy: document.querySelector('#lazy')?.textContent, poisoned: window.__workerPoisoned === true};
  });
}
async function navigate(context, origin) { const page = await context.newPage(); await page.goto(origin); return page; }
async function controlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await pageState(page)).controlled) await page.reload();
  await until(() => pageState(page), s => s.controlled && s.text?.startsWith('build '), 'controlled application never loaded');
}
async function poisonCache(page, cache, url) {
  await page.evaluate(async ({cache, url}) => {
    await (await caches.open(cache)).put(url, new Response('globalThis.__workerPoisoned = true; export const label = "altered";', {headers: {'Content-Type': 'text/javascript', 'Cache-Control': 'public, immutable'}}));
  }, {cache, url});
}
async function clearHttpCache(context, page) {
  const cdp = await context.newCDPSession(page);
  try { await cdp.send('Network.clearBrowserCache'); } finally { await cdp.detach(); }
}
async function removeCacheEntry(page, cache, url) {
  await page.evaluate(async ({cache, url}) => (await caches.open(cache)).delete(url), {cache, url});
}
async function fetchText(page, url) {
  return page.evaluate(url => fetch(url, {cache: 'no-cache'}).then(r => r.text()), url);
}

/** Same functional controls for repository browser tests and exact packed P17. */
export async function verifyWorkerIntegrity({build, browser, workDir, app = 'ledger'}) {
  const f = await fixture(build, browser, workDir, app, ['A']);
  const item = f.deployments.A;
  const entry = '/_assets/' + item.entryFile;
  const lazy = '/_assets/' + item.lazyFile;
  const results = [];
  const passed = (name, details = {}) => results.push({name, passed: true, ...details});
  try {
    const page = await navigate(f.context, f.origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    assert.equal((await pageState(page)).controlled, false);
    assert.equal(f.state.hits.get(lazy) ?? 0, 0);
    passed(WORKER_INTEGRITY_CHECKS[0]);
    await controlled(page);
    await until(() => page.evaluate(async ({cache, entry}) => !!await (await caches.open(cache)).match(entry), {cache: item.cache, entry}), Boolean, 'entry never entered its authenticated cache');
    await clearHttpCache(f.context, page);
    await poisonCache(page, item.cache, entry);
    const beforeEntry = f.state.hits.get(entry) ?? 0;
    await page.reload();
    await until(() => pageState(page), s => s.text === 'build A', 'good entry did not replace poisoned cache');
    assert.equal((await pageState(page)).poisoned, false);
    assert.ok((f.state.hits.get(entry) ?? 0) > beforeEntry);
    passed(WORKER_INTEGRITY_CHECKS[1]);

    await poisonCache(page, item.cache, lazy);
    const beforeLazy = f.state.hits.get(lazy) ?? 0;
    await page.click('button');
    await until(() => pageState(page), s => s.lazy === 'lazy A', 'dynamic chunk was not recovered');
    assert.equal((await pageState(page)).poisoned, false);
    assert.equal(await page.locator(`script[src="${lazy}"]`).count(), 0);
    assert.ok((f.state.hits.get(lazy) ?? 0) > beforeLazy);
    passed(WORKER_INTEGRITY_CHECKS[2]);

    await clearHttpCache(f.context, page);
    await removeCacheEntry(page, item.cache, lazy);
    f.state.poisoned.set(lazy, Buffer.from('globalThis.__workerPoisoned = true; export const label = "altered";'));
    await page.reload(); await page.click('button');
    await until(() => pageState(page), s => s.lazy === 'refused', 'bad network chunk was not refused');
    assert.equal((await pageState(page)).poisoned, false);
    assert.equal(await page.evaluate(async ({cache, lazy}) => !!await (await caches.open(cache)).match(lazy), {cache: item.cache, lazy}), false);
    f.state.poisoned.delete(lazy);
    passed(WORKER_INTEGRITY_CHECKS[3]);

    const expected = readFileSync(join(item.outputDir, item.entryFile), 'utf8');
    await f.context.setOffline(true);
    assert.equal(await fetchText(page, entry), expected);
    await poisonCache(page, item.cache, entry);
    await assert.rejects(fetchText(page, entry));
    await f.context.setOffline(false);
    assert.equal(await fetchText(page, entry), expected);
    passed(WORKER_INTEGRITY_CHECKS[4]);

    const encodings = [];
    for (const encoding of ['gzip', 'br']) {
      await removeCacheEntry(page, item.cache, entry); f.state.encoding = encoding;
      const observed = await page.evaluate(async url => { const r = await fetch(url, {cache: 'no-cache'}); return {text: await r.text(), encoding: r.headers.get('Content-Encoding')}; }, entry);
      assert.equal(observed.text, expected); assert.equal(observed.encoding, encoding); encodings.push(encoding);
    }
    passed(WORKER_INTEGRITY_CHECKS[5], {encodings});
    assert.deepEqual(results.map(r => r.name), WORKER_INTEGRITY_CHECKS);
    return {passed: true, app, results, build: item.manifest.build, entry, lazy, directory: f.directory};
  } finally { await f.close(); }
}

/** SR28 replay. The caller supplies bytes emitted by the real Rust off-worker
 * response, including the same app name used for these generated builds. */
export async function verifyWorkerLifecycle({build, browser, workDir, app = 'ledger', retiringWorkerSource}) {
  assert.equal(typeof retiringWorkerSource, 'string', 'actual Rust retiring worker bytes are required');
  assert.ok(retiringWorkerSource.length > 0, 'retirement may not be skipped');
  const f = await fixture(build, browser, workDir, app, ['A', 'B']);
  const {A, B} = f.deployments;
  const unrelated = 'unrelated-app', other = `forma:${app}-other:0123456789ab`, v1 = 'forma-0123456789ab-on-demand-v1';
  const kept = [other, unrelated].sort();
  const results = [];
  const passed = (name, details = {}) => results.push({name, passed: true, ...details});
  const update = page => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  const wait = page => until(() => pageState(page), s => s.waiting, 'next worker never entered waiting');
  async function fresh(label) {
    for (const page of f.context.pages()) await page.close();
    const page = await navigate(f.context, f.origin);
    await until(async () => {
      const state = await pageState(page);
      if (!state.controlled || state.waiting || !state.caches.includes(f.deployments[label].cache)) await page.reload();
      return pageState(page);
    }, s => !s.waiting && s.controlled && s.caches.includes(f.deployments[label].cache), `build ${label} never activated after old tabs closed`);
    assert.deepEqual((await pageState(page)).caches, [...kept, f.deployments[label].cache].sort());
    assert.equal((await pageState(page)).text, `build ${label}`);
    return page;
  }
  async function cachedA(page) {
    // This avoids mistaking the browser HTTP cache for the worker's CacheStorage.
    await clearHttpCache(f.context, page);
    const url = '/_assets/' + A.entryFile, before = f.state.hits.get(url) ?? 0;
    assert.equal(await fetchText(page, url), readFileSync(join(A.outputDir, A.entryFile), 'utf8'));
    assert.equal(f.state.hits.get(url) ?? 0, before, 'the old asset must come from its authenticated cache');
  }
  try {
    const seed = await f.context.newPage(); await seed.goto(f.origin + '/seed');
    await seed.evaluate(async names => { for (const name of names) await (await caches.open(name)).put('/seed', new Response('seed')); }, [...kept, v1]);
    const tab1 = await navigate(f.context, f.origin); await controlled(tab1);
    await until(() => pageState(tab1), s => s.caches.includes(A.cache), 'A cache missing');
    assert.deepEqual((await pageState(tab1)).caches, [...kept, A.cache].sort());
    const tab2 = await navigate(f.context, f.origin); assert.equal((await pageState(tab2)).controlled, true);
    f.state.deployed = 'B'; await update(tab1); await wait(tab1);
    await tab2.reload(); await tab1.reload();
    assert.equal((await pageState(tab1)).waiting, true);
    assert.deepEqual((await pageState(tab1)).caches, [...kept, A.cache].sort());
    await cachedA(tab2);
    passed(WORKER_LIFECYCLE_CHECKS[0]);

    f.state.alternate = true;
    for (let i = 0; i < 6; i++) { await update(tab1); await new Promise(resolve => setTimeout(resolve, 150)); }
    f.state.alternate = false;
    assert.deepEqual((await pageState(tab1)).caches, [...kept, A.cache].sort());
    await cachedA(tab2);
    passed(WORKER_LIFECYCLE_CHECKS[1], {updateChecks: 6});
    await update(tab1); await wait(tab1);
    let tab = await fresh('B');
    passed(WORKER_LIFECYCLE_CHECKS[2]);

    f.state.deployed = 'A'; await update(tab); await wait(tab);
    assert.ok((await pageState(tab)).caches.includes(B.cache));
    tab = await fresh('A');
    f.state.deployed = 'B'; await update(tab); await wait(tab);
    assert.ok((await pageState(tab)).caches.includes(A.cache));
    tab = await fresh('B');
    passed(WORKER_LIFECYCLE_CHECKS[3]);

    const entry = '/_assets/' + B.entryFile;
    await poisonCache(tab, B.cache, entry);
    await tab.evaluate(async name => (await caches.open(name)).put('/seed', new Response('old')), v1);
    f.state.retiring = retiringWorkerSource;
    await update(tab);
    await until(() => pageState(tab), s => !s.registered && s.caches.every(name => !name.startsWith(`forma:${app}:`) && name !== v1), 'actual retiring worker did not delete owned caches and unregister');
    assert.deepEqual((await pageState(tab)).caches, kept);
    passed(WORKER_LIFECYCLE_CHECKS[4], {caches: kept});

    await tab.reload();
    const before = f.state.hits.get(entry) ?? 0;
    const bytes = await tab.evaluate(url => fetch(url, {cache: 'no-store'}).then(r => r.text()), entry);
    assert.equal(bytes, readFileSync(join(B.outputDir, B.entryFile), 'utf8'));
    assert.ok((f.state.hits.get(entry) ?? 0) > before);
    assert.equal((await pageState(tab)).controlled, false);
    assert.equal((await pageState(tab)).poisoned, false);
    assert.deepEqual((await pageState(tab)).caches, kept);
    passed(WORKER_LIFECYCLE_CHECKS[5]);
    assert.deepEqual(results.map(r => r.name), WORKER_LIFECYCLE_CHECKS);
    return {passed: true, app, results, builds: {A: A.manifest.build, B: B.manifest.build}, directory: f.directory};
  } finally { await f.close(); }
}
