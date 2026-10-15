/**
 * renderBoth, Forma-internal (FORMA-183 first slice; Q11's default, D9): one module at one
 * generated state through the real walker and through core in a real browser, and the P1 report.
 * FORMA-184 owns the public `renderBoth(component, state)` form; this is the harness's CLI.
 *
 *   node e2e/parity/src/render-both.mts --module nested-islands [--state 3] [--seed forma-183]
 *                                       [--engine chromium|firefox|webkit] [--json] [--emit-vector <file>]
 *
 * Exit status: 0 equal, 1 different, 2 the server refused the state or the harness failed.
 *
 * The first slice renders the server side through the low-level path (slot JSON by slot name;
 * the typed path through `Pages::bind` is FORMA-183's second slice) and checks P1 only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser } from '@playwright/test';
import { bundlePage, launch, renderInBrowser, type Engine, type PageComponent } from './browser.mts';
import { compareTrees, makeReport, stripTransport, summarize, type CanonNode, type Report } from './compare.mts';
import { generate, type Json } from './generate.mts';
import { describeModule, renderStates, REPO } from './server.mts';

export interface CorpusEntry {
  readonly name: string;
  /** Repository-relative `.ir` of the module. */
  readonly ir: string;
  readonly page: PageComponent;
  /** `page`: the whole page is the comparison root; `islands`: the same, with islands inside. */
  readonly kind: 'page' | 'islands';
  readonly note?: string;
}

export function readCorpus(): readonly CorpusEntry[] {
  const file = new URL('../corpus.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { modules: CorpusEntry[] };
  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) throw new Error(`${file.pathname}: no modules`);
  return parsed.modules;
}

export interface RenderBothOptions {
  readonly module: string;
  readonly index: number;
  readonly seed: string;
  readonly engine: Engine;
  /** A browser to reuse across calls; without one, renderBoth launches its own and closes it. */
  readonly browser?: Browser;
  /**
   * Test seam, never set by the CLI: rewrites the walker's HTML before the browser parses it,
   * standing in for a seeded walker change (the ticket's acceptance test: a walker change that
   * alters one attribute's text fails P1 naming the fixture, the state and the node).
   */
  readonly alterServerHtml?: (html: string) => string;
}

/** The low-level path's state: object 0's fields by name, which is how the walker's slot table names declared roots. */
function slotJson(state: Json): Json {
  return state;
}

export async function renderBoth(options: RenderBothOptions): Promise<Report> {
  const corpus = readCorpus();
  const entry = corpus.find(module => module.name === options.module);
  if (!entry) throw new Error(`corpus.json has no module ${options.module}; modules: ${corpus.map(module => module.name).join(', ')}`);
  const ir = resolve(REPO, entry.ir);
  const described = describeModule(ir);
  const state = generate(described.schema, options.seed, options.index, { module: entry.name });
  const base = { module: entry.name, seed: options.seed, index: options.index, check: 'P1' as const, serverPath: 'low-level' as const, state };
  const [rendered] = renderStates(ir, [slotJson(state)]);
  if (!rendered) throw new Error('parity_render returned no entry');
  if ('error' in rendered) {
    return makeReport({ ...base, verdict: 'server-refused', refusal: { code: 'WALK', message: rendered.error, path: rendered.componentPath?.join(' > ') } }, null);
  }
  const html = options.alterServerHtml ? options.alterServerHtml(rendered.html) : rendered.html;
  const browser = options.browser ?? await launch(options.engine);
  try {
    const bundle = await bundlePage(entry.page);
    const both = await renderInBrowser({ browser, component: entry.page, bundle, html, state: rendered.state, props: state, schema: described.schema });
    // The two containers are the harness's own; the page's nodes are their children, compared
    // under one neutral root so paths read `page > section:nth-child(1) > …`.
    const asPage = (tree: CanonNode): CanonNode => (tree.kind === 'element' ? { ...tree, tag: 'page', attrs: {} } : tree);
    const server = stripTransport(asPage(both.served), 'page');
    const client = stripTransport(asPage(both.twin), 'page');
    const comparison = compareTrees(server.tree, client.tree);
    const report = makeReport({ ...base, server: { tree: server.tree, html, keys: server.keys }, client: { tree: client.tree } }, comparison);
    if (both.pageErrors.length || both.consoleErrors.length) {
      return { ...report, verdict: 'error', error: `page errors: ${[...both.pageErrors, ...both.consoleErrors].join('; ')}` };
    }
    return report;
  } finally {
    if (!options.browser) await browser.close();
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      module: { type: 'string' },
      state: { type: 'string', default: '0' },
      seed: { type: 'string', default: 'forma-183' },
      engine: { type: 'string', default: 'chromium' },
      json: { type: 'boolean', default: false },
      'emit-vector': { type: 'string' },
    },
  });
  if (!values.module) {
    process.stderr.write(`usage: render-both --module <name> [--state n] [--seed s] [--engine chromium|firefox|webkit] [--json] [--emit-vector file]\nmodules: ${readCorpus().map(m => m.name).join(', ')}\n`);
    return 2;
  }
  const engine = values.engine as Engine;
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`unknown engine ${engine}`);
  const started = performance.now();
  const index = Number(values.state);
  if (!Number.isInteger(index) || index < 0) throw new Error(`--state must be a non-negative integer, got ${values.state}`);
  const report = await renderBoth({ module: values.module, index, seed: values.seed!, engine });
  const elapsed = Math.round(performance.now() - started);
  process.stdout.write(`${summarize(report)} [${elapsed} ms]\n`);
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (values['emit-vector']) {
    writeFileSync(values['emit-vector'], `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`vector written to ${values['emit-vector']}\n`);
  }
  return report.verdict === 'equal' ? 0 : report.verdict === 'different' ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`render-both: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 2; });
}
