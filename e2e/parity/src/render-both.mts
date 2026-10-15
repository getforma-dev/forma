/**
 * renderBoth, Forma-internal (FORMA-183; Q11's default, D9): one corpus module at one state
 * through the server and through core in a real browser, by the same pipeline as the suite
 * (`suite.mts`), and its reports: P1 and, for a page with islands, P2. FORMA-184 owns the public
 * `renderBoth(component, state)` form; this is the harness's CLI.
 *
 *   node e2e/parity/src/render-both.mts --module nested-islands [--state 3] [--seed forma-183]
 *                                       [--engine chromium|firefox|webkit] [--low-level]
 *                                       [--json] [--emit-vector <file>]
 *
 * Exit status: 0 equal, 1 different, 2 the server refused the state or the harness failed.
 * Expected divergences are not applied here: renderBoth shows what the state does.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser } from '@playwright/test';
import { launch, type Engine } from './browser.mts';
import type { PageComponent } from './bundle.mts';
import { summarize, type Report } from './compare.mts';
import { check, prepare, readCorpus, type Timings } from './suite.mts';

export { readCorpus, type CorpusEntry } from './suite.mts';

export interface RenderBothOptions {
  readonly module: string;
  readonly index: number;
  readonly seed: string;
  readonly engine: Engine;
  /** Force the low-level walker path instead of the typed one. */
  readonly lowLevel?: boolean;
  /** A browser to reuse across calls; without one, renderBoth launches its own and closes it. */
  readonly browser?: Browser;
  /**
   * Test seam, never set by the CLI: rewrites the server's document before the browser parses it,
   * standing in for a seeded walker change (the ticket's acceptance test: a walker change that
   * alters one attribute's text fails P1 naming the fixture, the state and the node).
   */
  readonly alterServerHtml?: (html: string) => string;
  /**
   * Test seam, never set by the CLI: the twin's page source in place of the corpus entry's, over
   * the same module (F1's error-verdict test renders the archived original page, whose list
   * source core cannot call).
   */
  readonly page?: PageComponent;
}

/** Every report of one module at one state: P1, then P2 when the page has islands. */
export async function renderBothReports(options: RenderBothOptions): Promise<Report[]> {
  const corpus = readCorpus();
  const entry = corpus.find(module => module.name === options.module);
  if (!entry) throw new Error(`corpus.json has no module ${options.module}; modules: ${corpus.map(module => module.name).join(', ')}`);
  const plan = await prepare(options.page ? { ...entry, page: options.page } : entry, { seed: options.seed, states: options.index + 1, indices: [options.index] });
  if (!plan.indices.length) throw new Error(`${entry.name} declares no page props: its one state is 0`);
  const browser = options.browser ?? await launch(options.engine);
  const timings: Timings = { prepare: 0, launch: 0, server: 0, browser: 0 };
  try {
    return await check([plan], {
      seed: options.seed, states: options.index + 1, indices: [options.index], browser,
      ...(options.lowLevel ? { lowLevel: true } : {}),
      ...(options.alterServerHtml ? { alterServerHtml: options.alterServerHtml } : {}),
    }, timings);
  } finally {
    if (!options.browser) await browser.close();
  }
}

/** The P1 report of one module at one state. */
export async function renderBoth(options: RenderBothOptions): Promise<Report> {
  const reports = await renderBothReports(options);
  const p1 = reports.find(report => report.check === 'P1');
  if (!p1) throw new Error(`${options.module}#${options.index}: no P1 report`);
  return p1;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      module: { type: 'string' },
      state: { type: 'string', default: '0' },
      seed: { type: 'string', default: 'forma-183' },
      engine: { type: 'string', default: 'chromium' },
      'low-level': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'emit-vector': { type: 'string' },
    },
  });
  if (!values.module) {
    process.stderr.write(`usage: render-both --module <name> [--state n] [--seed s] [--engine chromium|firefox|webkit] [--low-level] [--json] [--emit-vector file]\nmodules: ${readCorpus().map(m => m.name).join(', ')}\n`);
    return 2;
  }
  const engine = values.engine as Engine;
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`unknown engine ${engine}`);
  const index = Number(values.state);
  if (!Number.isInteger(index) || index < 0) throw new Error(`--state must be a non-negative integer, got ${values.state}`);
  const started = performance.now();
  const reports = await renderBothReports({ module: values.module, index, seed: values.seed!, engine, lowLevel: values['low-level']! });
  const elapsed = Math.round(performance.now() - started);
  for (const report of reports) process.stdout.write(`${summarize(report)} (${report.serverPath ?? 'no'} server path) [${elapsed} ms]\n`);
  if (values.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  if (values['emit-vector']) {
    writeFileSync(values['emit-vector'], `${JSON.stringify(reports, null, 2)}\n`);
    process.stdout.write(`vector written to ${values['emit-vector']}\n`);
  }
  if (reports.every(report => report.verdict === 'equal')) return 0;
  return reports.some(report => report.verdict === 'error' || report.verdict === 'server-refused') ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`render-both: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 2; });
}
