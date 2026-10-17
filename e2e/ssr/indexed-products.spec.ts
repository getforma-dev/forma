import { expect, test, type ConsoleMessage, type Page, type Route } from '@playwright/test';
import { dirname, join } from 'node:path';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { SSR_ORIGIN } from './origin';
import { measureIndexedPublicSet } from './indexed-timing';
import { createIndexedProgressWriter } from './indexed-progress.mjs';

test.use({ baseURL: SSR_ORIGIN });
test.setTimeout(60_000);
test.beforeAll(async () => {
  const state = await fetch(`${SSR_ORIGIN}/__site`).then(response => response.json());
  expect(state.site).toBe(join(realpathSync(__dirname), 'out', 'site'));
  expect(state.built).toBe(true);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__indexedPolicyViolations)).toEqual([]);
  const received = await fetch(`${SSR_ORIGIN}/__csp-reports`).then(response => response.json());
  expect(received.reports.filter((report: { document: string }) => report.document === '/keyed-indexed/')).toEqual([]);
});
async function observe(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    (window as any).__indexedErrors = [];
    (window as any).__indexedPolicyViolations = [];
    document.addEventListener('forma:error', event => (window as any).__indexedErrors.push((event as CustomEvent).detail));
    document.addEventListener('securitypolicyviolation', event => (window as any).__indexedPolicyViolations.push({ directive: event.effectiveDirective, disposition: event.disposition }));
  });
  return errors;
}
async function arm(page: Page) {
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => (window as any).__indexedErrors)).toEqual([]);
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('[data-arm]').forEach(button => button.click()));
  expect(await page.evaluate(() => Object.keys((window as any).__indexed))).toEqual(['small', 'large']);
}

test('indexed products: typed rows adopt without writes; set touches only one row and retains focus, selection and listeners', async ({ page }) => {
  const errors = await observe(page), held: Route[] = [];
  let holding = true;
  await page.route('**/_assets/*.js', route => { if (holding) held.push(route); else void route.continue(); });
  await page.goto('/keyed-indexed/', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.readyState !== 'loading');
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const before = await page.evaluate(() => {
    const native = JSON.parse(document.querySelector('script[data-island-state]')!.textContent!);
    const small = [...document.querySelectorAll('#small li')], large = [...document.querySelectorAll('#large li')];
    const input = small[0]!.querySelector('input')!; input.focus(); input.setSelectionRange(1, 4, 'backward');
    const records: MutationRecord[] = [], observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(document.querySelector('main')!, { subtree: true, childList: true, characterData: true, attributes: true });
    (window as any).__indexedProof = { small, large, input, records, observer, native: native.i[0].p.rows };
    return { counts: [small.length, large.length], props: native.i.map((entry: any) => [entry.p.name, entry.p.rows.length, entry.p.rows[0], entry.p.rows.at(-1)]), keys: [small[0]!.getAttribute('data-forma-key'), large.at(-1)!.getAttribute('data-forma-key')] };
  });
  expect(before).toEqual({ counts: [200, 2000], props: [
    ['small', 200, { id: 'row-0', label: 'Label 0' }, { id: 'row-199', label: 'Label 199' }],
    ['large', 2000, { id: 'row-0', label: 'Label 0' }, { id: 'row-1999', label: 'Label 1999' }],
  ], keys: ['row-0', 'row-1999'] });
  holding = false; for (const route of held.splice(0)) await route.continue();
  await arm(page);
  const adopted = await page.evaluate(() => {
    const proof = (window as any).__indexedProof; proof.records.push(...proof.observer.takeRecords());
    const result = { writes: proof.records.length, focused: document.activeElement === proof.input, selection: [proof.input.selectionStart, proof.input.selectionEnd, proof.input.selectionDirection], retained: ['small', 'large'].every(name => [...document.querySelectorAll(`#${name} li`)].every((node, i) => node === proof[name][i])) };
    proof.records.length = 0; return result;
  });
  expect(adopted).toEqual({ writes: 0, focused: true, selection: [1, 4, 'backward'], retained: true });
  const updated = await page.evaluate(() => {
    const proof = (window as any).__indexedProof;
    proof.next = { id: 'row-0', label: 'Replacement' };
    (window as any).__indexed.small.set('row-0', proof.next);
    proof.records.push(...proof.observer.takeRecords());
    const result = { writes: proof.records.length, types: proof.records.map((record: MutationRecord) => record.type).sort(), onlySelected: proof.records.every((record: MutationRecord) => proof.small[0].contains(record.target)), labels: [proof.small[0].querySelector('b').textContent, proof.large[0].querySelector('b').textContent], focused: document.activeElement === proof.input, selection: [proof.input.selectionStart, proof.input.selectionEnd, proof.input.selectionDirection], retained: ['small', 'large'].every(name => [...document.querySelectorAll(`#${name} li`)].every((node, i) => node === proof[name][i])) };
    proof.records.length = 0; return result;
  });
  expect(updated).toEqual({ writes: 2, types: ['attributes', 'characterData'], onlySelected: true, labels: ['Replacement', 'Label 0'], focused: true, selection: [1, 4, 'backward'], retained: true });
  await page.evaluate(() => (window as any).__indexedProof.small[0].querySelector('button').click());
  await expect(page.locator('#small [data-clicked]')).toHaveText('Replacement');
  await page.keyboard.insertText('Z');
  await expect(page.locator('#small [data-edited]')).toHaveText('row-0:eZ me');
  const invalid = await page.evaluate(() => {
    const proof = (window as any).__indexedProof, rows = (window as any).__indexed.small;
    const before = document.querySelector('#small')!.innerHTML, messages: string[] = [];
    for (const operation of [() => rows.set('missing', { id: 'missing', label: 'bad' }), () => rows.set('row-0', { id: 'changed', label: 'bad' }), () => rows.replace([{ id: 'row-1', label: 'bad' }, { id: 'row-1', label: 'duplicate' }])]) {
      try { operation(); } catch (error) { messages.push(String(error)); }
    }
    return { refusals: messages.length, unchanged: document.querySelector('#small')!.innerHTML === before };
  });
  expect(invalid).toEqual({ refusals: 3, unchanged: true });
  const moved = await page.evaluate(() => {
    const proof = (window as any).__indexedProof; proof.records.length = 0; proof.observer.takeRecords();
    (window as any).__indexed.small.replace([...proof.native.slice(1), proof.next]);
    proof.records.push(...proof.observer.takeRecords());
    const touched = proof.records.flatMap((record: MutationRecord) => [...record.addedNodes, ...record.removedNodes]);
    return { first: document.querySelector('#small li')!.getAttribute('data-forma-key'), retained: document.querySelector('#small li:last-child') === proof.small[0], writes: proof.records.length, onlyMoved: touched.length === 2 && touched.every((node: Node) => node === proof.small[0]), focused: document.activeElement === proof.input, selection: [proof.input.selectionStart, proof.input.selectionEnd] };
  });
  expect(moved).toEqual({ first: 'row-1', retained: true, writes: 2, onlyMoved: true, focused: true, selection: [2, 2] });
  const disposed = await page.evaluate(() => {
    const proof = (window as any).__indexedProof;
    (window as any).__indexed.small.replace(proof.native.slice(1));
    document.querySelector<HTMLButtonElement>('#small li button')!.click();
    const output = document.querySelector('#small [data-clicked]')!.textContent;
    proof.small[0].querySelector('button').click(); proof.observer.disconnect();
    return { disconnected: !proof.small[0].isConnected, listenerDisposed: document.querySelector('#small [data-clicked]')!.textContent === output, neighborRows: document.querySelectorAll('#large li').length };
  });
  expect(disposed).toEqual({ disconnected: true, listenerDisposed: true, neighborRows: 2000 });
  expect(errors).toEqual([]); expect(await page.evaluate(() => (window as any).__indexedErrors)).toEqual([]);
});

test('indexed products: complete public set in 2000 rows stays within a frame and within 10% of 200 rows', async ({ page }, info) => {
  // A default 1ms clock requests 512ms batches: 202 edit batches alone are
  // about 103s at calibration speed, before power-of-two overshoot and no-ops.
  // This bounds collection only; the 10% and 16ms operation limits stay below.
  test.setTimeout(300_000);
  const progressPath = info.outputPath('indexed-progress.jsonl');
  mkdirSync(dirname(progressPath), { recursive: true });
  const writeProgress = createIndexedProgressWriter(progressPath);
  let progressError: unknown;
  const receiveProgress = (message: ConsoleMessage) => {
    if (progressError) return;
    try { writeProgress(message.text()); } catch (error) { progressError = error; }
  };
  page.on('console', receiveProgress);
  let errors: string[] = [];
  let report: Awaited<ReturnType<typeof measureIndexedPublicSet>>;
  try {
    errors = await observe(page);
    await page.goto('/keyed-indexed/'); await arm(page);
    report = await page.evaluate(measureIndexedPublicSet);
  } finally {
    page.off('console', receiveProgress);
    if (progressError) writeFileSync(info.outputPath('indexed-progress-error.txt'), String(progressError));
    await info.attach('indexed-progress.jsonl', { path: progressPath, contentType: 'application/x-ndjson' });
  }
  const evidence = info.outputPath('indexed-public-set.json');
  mkdirSync(dirname(evidence), { recursive: true });
  writeFileSync(evidence, JSON.stringify({ ...report, machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length }, engine: info.project.name }, null, 2) + '\n');
  await info.attach('indexed-public-set.json', { path: evidence, contentType: 'application/json' });
  if (progressError) throw progressError;
  expect(report.clock.resolved, 'clock resolution is insufficient at the bounded maximum batch; no timing acceptance is possible').toBe(true);
  expect(report.rounds).toBe(101);
  expect(report.rows).toEqual([200, 2000]); expect(report.labels).toEqual(['Timing B', 'Timing B']);
  expect(report.summary.small.median).toBeGreaterThan(0);
  expect(report.maximumSingle).toBeLessThan(16); expect(report.summary.large.p95).toBeLessThan(16);
  expect(report.summary.large.median).toBeLessThanOrEqual(report.summary.small.median * 1.1);
  expect(report.summary.large.p95).toBeLessThanOrEqual(report.summary.small.p95 * 1.1);
  expect(errors).toEqual([]); expect(await page.evaluate(() => (window as any).__indexedErrors)).toEqual([]);
});

test('indexed products: a corrupted owned hole refuses its island while the neighboring indexed owner stays live', async ({ page }) => {
  const errors = await observe(page); await page.goto('/keyed-indexed/'); await arm(page);
  const result = await page.evaluate(() => {
    const target = [...document.querySelector('#large li b')!.childNodes].find(node => node.nodeType === 3)! as Text;
    target.data = 'external';
    (window as any).__indexed.large.set('row-0', { id: 'row-0', label: 'must not write' });
    (window as any).__indexed.small.set('row-0', { id: 'row-0', label: 'neighbor live' });
    return { retained: target.data, neighbor: document.querySelector('#small li b')!.textContent, failed: document.querySelector('#large')!.getAttribute('data-forma-status'), errors: (window as any).__indexedErrors.length };
  });
  expect(result).toEqual({ retained: 'external', neighbor: 'neighbor live', failed: 'error', errors: 1 });
  expect(errors).toEqual(['[forma] FORMA_E_HYDRATE_STRUCTURE (island "IndexedRows", id=1)']);
});
