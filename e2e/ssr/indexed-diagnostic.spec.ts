// NEVER MERGE. Fixed three-arm evidence collection; timings grant no acceptance.
import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { SSR_ORIGIN } from './origin';
import { measureIndexedDiagnostic } from './indexed-diagnostic';
import { createIndexedProgressWriter } from './indexed-progress.mjs';
import { completeDiagnosticTrace } from './indexed-diagnostic-trace.mjs';

const arms = ['small-large', 'small-small', 'large-large'] as const;
for (const arm of arms) test(`diagnostic only: ${arm}`, async ({ page, browser }, info) => {
  const directory = info.outputPath('raw'); mkdirSync(directory, { recursive: true });
  const save = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n');
  const faults: string[] = [], errors: string[] = [];
  const record = { kind: 'diagnostic-only', arm, state: 'started', faults, errors,
    source: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    profile: { headless: true, viewport: { width: 1280, height: 720 }, cpuThrottle: 1, retries: 0 },
  };
  save('result.json', record);
  const writeProgress = createIndexedProgressWriter(join(directory, 'indexed-progress.jsonl'));
  const error = (text: string) => { if (errors.length < 128) errors.push(text); else if (!faults.includes('error evidence overflow')) faults.push('error evidence overflow'); };
  page.on('pageerror', event => error(event.message));
  page.on('console', message => {
    if (message.type() === 'error') error(message.text());
    try { writeProgress(message.text()); } catch (cause) { if (faults.length < 128) faults.push(String(cause)); }
  });
  await page.addInitScript(() => {
    const state = (window as any).__indexedDiagnostic = { errors: [], policy: [], overflow: false };
    const keep = (rows: unknown[], value: unknown) => { if (rows.length < 128) rows.push(value); else state.overflow = true; };
    document.addEventListener('forma:error', event => keep(state.errors, (event as CustomEvent).detail));
    document.addEventListener('securitypolicyviolation', event => keep(state.policy, { directive: event.effectiveDirective, disposition: event.disposition }));
  });
  const session = await browser.newBrowserCDPSession();
  let tracing = false;
  try {
    save('browser.json', { version: await session.send('Browser.getVersion'), commandLine: await session.send('Browser.getBrowserCommandLine'), traceCategories: await session.send('Tracing.getCategories') });
    const site = await fetch(SSR_ORIGIN + '/__site', { signal: AbortSignal.timeout(5000) }).then(response => response.json());
    save('site.json', site);
    assert.equal(site.site, join(realpathSync(__dirname), 'out', 'site')); assert.equal(site.built, true);
    await session.send('Tracing.start', { transferMode: 'ReturnAsStream', categories: 'toplevel,devtools.timeline,v8,v8.execute,disabled-by-default-v8.gc,blink.user_timing' }); tracing = true;
    const response = await page.goto(SSR_ORIGIN + '/keyed-indexed/');
    save('navigation.json', { status: response?.status(), url: response?.url(), headers: await response?.allHeaders() });
    assert.equal(response?.status(), 200);
    await page.waitForLoadState('load');
    await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('[data-arm]').forEach(button => button.click()));
    assert.deepEqual(await page.evaluate(() => Object.keys((window as any).__indexed)), ['small', 'large']);
    assert.equal(await page.evaluate(() => (window as any).__indexed.small === (window as any).__indexed.large), false);
    const report = await page.evaluate(measureIndexedDiagnostic, arm);
    save('indexed-public-set.json', report); // Original complete rows before any check.
    const progress = readFileSync(join(directory, 'indexed-progress.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(progress.find(row => row.phase === 'diagnostic-alias'), { phase: 'diagnostic-alias', arm, sameOwner: arm !== 'small-large' });
    assert.equal(progress.at(-1)?.phase, 'complete');
    for (const [phase, values] of [['paired-row', report.samples], ['noop-row', report.noOp]] as const) {
      const rows = progress.filter(row => row.phase === phase);
      assert.deepEqual(rows.map(row => row.round), Array.from({ length: 101 }, (_, i) => i));
      for (const slot of ['small', 'large'] as const) assert.deepEqual(rows.map(row => row[slot]), values[slot]);
    }
    assert.equal(report.clock.resolved, true); assert.equal(report.rounds, 101);
    assert.deepEqual(report.rows, [200, 2000]); assert.deepEqual(report.labels, ['Timing B', 'Timing B']);
    for (const slot of ['small', 'large'] as const) {
      assert.equal(report.samples[slot].length, 101); assert.equal(report.noOp[slot].length, 101);
      assert(report.samples[slot].every(value => Number.isFinite(value) && value > 0));
    }
    save('descriptive-comparison.json', { kind: 'diagnostic-only', medianRatio: report.summary.large.median / report.summary.small.median,
      p95Ratio: report.summary.large.p95 / report.summary.small.p95, maximumSingle: report.maximumSingle,
      satisfiesOriginalNumericComparisons: report.maximumSingle < 16 && report.summary.large.p95 < 16
        && report.summary.large.median <= report.summary.small.median * 1.1 && report.summary.large.p95 <= report.summary.small.p95 * 1.1 });
  } catch (cause) { faults.push(String(cause)); }
  finally {
    try {
      const observed = await page.evaluate(() => (window as any).__indexedDiagnostic); save('observed-errors.json', observed);
      assert(observed && !observed.overflow); assert.deepEqual(observed.errors, []); assert.deepEqual(observed.policy, []);
      const reports = await fetch(SSR_ORIGIN + '/__csp-reports', { signal: AbortSignal.timeout(5000) }).then(response => response.json());
      save('csp-reports.json', reports); assert.deepEqual(reports.reports.filter((row: { document: string }) => row.document === '/keyed-indexed/'), []);
    } catch (cause) { faults.push(String(cause)); }
    if (tracing) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let fd: number | undefined, stream: string | undefined, bytes = 0;
      let completion: { stream?: string; dataLossOccurred?: boolean } | undefined;
      try {
        const complete = new Promise<{ stream?: string; dataLossOccurred?: boolean }>((resolve, reject) => {
          session.once('Tracing.tracingComplete', resolve);
          timer = setTimeout(() => reject(new Error('trace completion deadline')), 15_000);
        });
        void complete.catch(() => {}); // The original promise is still awaited; avoid an early unhandled rejection.
        await session.send('Tracing.end'); completion = await complete; clearTimeout(timer);
        save('trace-completion.json', completion); // Full original payload before any validation.
        stream = completion.stream;
        assert(stream, 'missing original trace stream');
        fd = openSync(join(directory, 'trace.json'), 'wx');
        const deadline = Date.now() + 15_000;
        for (;;) {
          assert(Date.now() < deadline, 'trace read deadline');
          const part = await session.send('IO.read', { handle: stream, size: 1024 * 1024 });
          const data = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
          assert(bytes + data.length <= 256 * 1024 * 1024, 'trace evidence cap exceeded');
          writeFileSync(fd, data); bytes += data.length;
          if (part.eof) break;
        }
        save('trace-receipt.json', completeDiagnosticTrace(completion, bytes));
      } catch (cause) { faults.push(String(cause)); save('trace-receipt.json', { complete: false, bytes, dataLossOccurred: completion?.dataLossOccurred ?? null, error: String(cause) }); }
      finally {
        clearTimeout(timer); if (fd !== undefined) closeSync(fd);
        if (stream) await session.send('IO.close', { handle: stream }).catch(cause => faults.push(String(cause)));
      }
    }
    await session.detach().catch(cause => faults.push(String(cause)));
    if (errors.length) faults.push('browser errors observed');
    record.state = faults.length ? 'incomplete-or-invalid' : 'collection-complete'; save('result.json', record);
  }
  assert.deepEqual(faults, [], 'diagnostic collection/correctness failure; not a timing acceptance decision');
});
