/**
 * The pipeline `run.mts` (the corpus) and `render-both.mts` (one module, one state) share:
 *
 * 1. prepare: compile the module's entry through the compiler's SSR plugin (the production browser
 *    entry, and the `.ir`, which must be the committed module the server renders, or for a harness
 *    fixture is the module served), bundle the twin, describe the module, generate its states;
 * 2. serve: every module and state through the application's path in one `parity_render typed`
 *    process (the low-level walker path only where the typed path refuses, which fails the run
 *    unless corpus.json declares `serverPath: "low-level"` for the module);
 * 3. browse: each state's document in one browser; P1, for pages with islands P2, and for a module
 *    that names a setter P3 (the activated page moved to the next state, against that state's
 *    fresh server render). A module without a setter reports P3 `no-setter`, once.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { BOOT_SOURCE } from './boot.mts';
import { lowLevelDocument, LOW_LEVEL_POLICY, ParityPage, type PageRun, type ServedDocument } from './browser.mts';
import { bundleEntry, bundlePage, type PageComponent, type Transition } from './bundle.mts';
import { compareTrees, makeReport, stripTransport, type CanonNode, type Difference, type Report } from './compare.mts';
import { generate, type Json } from './generate.mts';
import { materialize, readEmitterCases } from './island-emitter.mts';
import { BOOT_FILE, synthesizeManifest } from './manifest.mts';
import { describeModule, renderStates, renderTyped, REPO, type Described, type Refusal, type TypedRender } from './server.mts';

export interface CorpusEntry {
  readonly name: string;
  /** Repository-relative `.ir` the server renders; absent for a harness fixture, whose compiled module is served. */
  readonly ir?: string;
  /** The module's app entry: repository-relative, or absolute for a rebuilt family case. */
  readonly entry: string;
  readonly page: PageComponent;
  /** `page`: no island; `islands`: activation runs (P2). */
  readonly kind: 'page' | 'islands';
  /** The ratchet step the module joined the corpus at. */
  readonly step: number;
  /** P3: the module-exported setter that moves the activated islands to a next state's props. */
  readonly transition?: Transition;
  /**
   * Declares that the typed path refuses this module and the walker alone renders it. Without the
   * declaration, a typed-path refusal or fallback fails the run (a module the production loader or
   * `compare_schema` rejects is a finding for any application serving it).
   */
  readonly serverPath?: 'low-level';
  readonly note?: string;
}

interface CorpusFile {
  readonly corpus: string;
  readonly modules: readonly (Omit<CorpusEntry, 'entry' | 'step'> & { readonly entry?: string; readonly step?: number })[];
  readonly families?: readonly { readonly family: 'island-emitter'; readonly step: number; readonly source: string; readonly ir: string; readonly exclude?: Readonly<Record<string, string>> }[];
}

/** The corpus up to and including `step` (all of it by default), in corpus.json's order, families last. */
export function readCorpus(step = Number.POSITIVE_INFINITY): readonly CorpusEntry[] {
  const file = new URL('../corpus.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as CorpusFile;
  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) throw new Error(`${file.pathname}: no modules`);
  const out: CorpusEntry[] = [];
  for (const module of parsed.modules) {
    const moduleStep = module.step ?? 0;
    if (moduleStep > step) continue;
    let entry = module.entry;
    if (!entry) {
      entry = ['app.ts', 'app.tsx'].map(name => `${parsed.corpus}/${module.name}/${name}`).find(path => existsSync(resolve(REPO, path)));
      if (!entry) throw new Error(`${file.pathname}: ${module.name} has no entry and no ${parsed.corpus}/${module.name}/app.ts`);
    }
    out.push({ ...module, entry, step: moduleStep });
  }
  for (const family of parsed.families ?? []) {
    if (family.step > step) continue;
    const cases = readEmitterCases(resolve(REPO, family.source), resolve(REPO, family.ir));
    for (const excluded of Object.keys(family.exclude ?? {})) {
      if (!cases.some(item => item.name === excluded)) throw new Error(`${file.pathname}: ${family.family} excludes ${excluded}, which it does not have`);
    }
    for (const item of cases) {
      if (family.exclude?.[item.name]) continue;
      const dir = materialize(item);
      const pageFile = Object.keys(item.files).find(name => name.startsWith('page.'))!;
      out.push({
        name: item.name, step: family.step, ir: `${family.ir}/${item.name}.ir`, entry: join(dir, 'app.ts'), kind: 'islands',
        page: { file: join(dir, pageFile), exportName: 'Page', props: 'named' },
        note: `${family.family}: rebuilt from ${family.source}`,
      });
    }
  }
  return out;
}

export interface PlanOptions {
  readonly seed: string;
  /** States for a module whose page declares props; a module without declared props has its one source state. */
  readonly states: number;
  /** Render only these state indices (renderBoth's one state). */
  readonly indices?: readonly number[];
  /** Force the low-level walker path. */
  readonly lowLevel?: boolean;
}

export interface ModulePlan {
  readonly entry: CorpusEntry;
  /** The module the server renders: the committed `.ir`, or the one compiled for a harness fixture. */
  readonly irPath: string;
  readonly described: Described;
  readonly indices: readonly number[];
  readonly states: readonly Json[];
  readonly twin: string;
  readonly script: string | null;
  /** The compiler's diagnostics for the module's page. */
  readonly diagnostics: readonly string[];
  /** Set when the module cannot be run at all (the pair is broken, a bundle failed). */
  readonly failure?: string;
}

/** The states a module is rendered at: generated where its page declares props, else its source state. */
export function statesFor(described: Described, entry: CorpusEntry, options: PlanOptions): { indices: number[]; states: Json[] } {
  const declared = (described.schema[0] ?? []).length > 0;
  const all = declared ? Array.from({ length: options.states }, (_, i) => i) : [0];
  const indices = options.indices ? options.indices.filter(i => declared || i === 0) : all;
  const keyPaths = described.keys.map(key => key.path);
  return { indices, states: indices.map(index => generate(described.schema, options.seed, index, { module: entry.name, keyPaths })) };
}

let compiledDir: string | undefined;
/** A harness fixture's compiled module, written to this process's scratch folder (removed at exit). */
function writeCompiled(name: string, ir: Uint8Array): string {
  if (!compiledDir) {
    compiledDir = mkdtempSync(join(tmpdir(), 'forma-parity-compiled-'));
    const made = compiledDir;
    process.once('exit', () => rmSync(made, { recursive: true, force: true }));
  }
  const path = join(compiledDir, `${name}.ir`);
  writeFileSync(path, ir);
  return path;
}

const NOTHING: Described = { schema: [[]], islands: [], slots: [], keys: [] };

export async function prepare(entry: CorpusEntry, options: PlanOptions): Promise<ModulePlan> {
  let script: string | null = null;
  let diagnostics: readonly string[] = [];
  let failure: string | undefined;
  let irPath = entry.ir ? resolve(REPO, entry.ir) : '';
  // A page esbuild cannot bundle is this module's error report, as every browser-side failure is.
  let twin = '';
  try {
    twin = await bundlePage(entry.page);
  } catch (error) {
    failure = `the page did not bundle: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`;
  }
  try {
    const product = await bundleEntry(entry.name, entry.entry, entry.transition);
    if (entry.ir) {
      if (Buffer.compare(Buffer.from(product.ir), readFileSync(irPath)) !== 0) {
        failure ??= `the compiler's .ir for ${entry.entry} is not ${entry.ir}: the browser entry and the served module are not a pair (run the FMIR contract step)`;
      }
    } else {
      irPath = writeCompiled(entry.name, product.ir);
    }
    script = product.js;
    diagnostics = product.diagnostics;
    if ((script !== null) !== (entry.kind === 'islands')) {
      failure ??= `corpus.json says ${entry.kind}, but the production entry ${script === null ? 'ships no script' : 'ships a script'}`;
    }
  } catch (error) {
    failure ??= `the production entry did not build: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!irPath) return { entry, irPath, described: NOTHING, indices: [0], states: [{}], twin, script, diagnostics, failure: failure ?? 'no module' };
  const described = describeModule(irPath);
  const { indices, states } = statesFor(described, entry, options);
  return { entry, irPath, described, indices, states, twin, script, diagnostics, ...(failure ? { failure } : {}) };
}

export interface Served {
  readonly path: 'typed' | 'low-level';
  /** The typed bind's refusals when the low-level path was used in its place. */
  readonly bind: readonly Refusal[];
  readonly documents: readonly (ServedDocument | { readonly refused: Refusal } | { readonly error: string })[];
}

/** Every module's states through the server, in one process for the typed path. */
export function serve(plans: readonly ModulePlan[], options: PlanOptions): Map<string, Served> {
  const out = new Map<string, Served>();
  const scratch = mkdtempSync(join(tmpdir(), 'forma-parity-'));
  try {
    const bootPath = join(scratch, BOOT_FILE);
    writeFileSync(bootPath, BOOT_SOURCE);
    const runnable = plans.filter(plan => !plan.failure);
    const typed = options.lowLevel ? [] : renderTyped(runnable.map(plan => {
      const irFile = `${plan.entry.name}.ir`;
      return {
        name: plan.entry.name, route: '/',
        manifest: synthesizeManifest({ app: plan.entry.name, irFile, ir: readFileSync(plan.irPath), boot: BOOT_SOURCE }),
        files: { [irFile]: plan.irPath, [BOOT_FILE]: bootPath },
        states: plan.states,
      };
    }));
    for (const plan of runnable) {
      const result = typed.find(module => module.name === plan.entry.name);
      if (result && result.bind.length === 0) {
        out.set(plan.entry.name, { path: 'typed', bind: [], documents: result.renders.map(fromTyped) });
        continue;
      }
      let low: ReturnType<typeof renderStates>;
      try {
        low = renderStates(plan.irPath, plan.states);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out.set(plan.entry.name, { path: 'low-level', bind: result?.bind ?? [], documents: plan.states.map(() => ({ error: message })) });
        continue;
      }
      out.set(plan.entry.name, {
        path: 'low-level', bind: result?.bind ?? [],
        documents: low.map(entry => ('error' in entry
          ? { error: `${entry.error}${entry.componentPath?.length ? ` in ${entry.componentPath.join(' > ')}` : ''}` }
          : { html: lowLevelDocument(entry.html, entry.state), headers: { 'content-security-policy': LOW_LEVEL_POLICY } })),
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return out;
}

function fromTyped(render: TypedRender): ServedDocument | { refused: Refusal } | { error: string } {
  if ('document' in render) return { html: render.document, headers: render.headers };
  if ('refused' in render) return { refused: render.refused };
  return { error: `${render.error.code}: ${render.error.message}` };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface ReportBase {
  readonly module: string;
  readonly seed: string;
  readonly index: number;
  readonly state: Json;
  readonly serverPath: 'typed' | 'low-level';
  readonly bind?: readonly Refusal[];
}

/** The harness's own containers are compared under one neutral root, so paths read `page > main:nth-child(1) > …`. */
const asPage = (tree: CanonNode): CanonNode => (tree.kind === 'element' ? { ...tree, tag: 'page', attrs: [] } : tree);

const headOf = (base: ReportBase, check: 'P1' | 'P2' | 'P3') =>
  ({ module: base.module, seed: base.seed, index: base.index, check, serverPath: base.serverPath, state: base.state, ...(base.bind ? { bind: base.bind } : {}) });

export function p1Report(base: ReportBase & { html?: string }, run: PageRun): Report {
  const head = headOf(base, 'P1');
  const fail = (error: string) => makeReport({ ...head, verdict: 'error', error, ...(base.html ? { server: { tree: null, html: base.html } } : {}) }, null);
  if (run.error) return fail(`boot: ${run.error.split('\n')[0]}`);
  if (!run.served) return fail('the served root was not serialized');
  if (run.twinError) return fail(`core's render threw: ${run.twinError.split('\n')[0]}`);
  if (!run.twin) return fail('core\'s render was not serialized');
  const problems = [
    ...run.logged.filter(entry => entry.step !== 'P2' && entry.step !== 'P3').map(entry => `${entry.step}: ${entry.text}`),
    ...run.violations.map(entry => `${entry.step}: policy violation ${entry.text}`),
    ...run.pageErrors.map(text => `page error: ${text}`),
  ];
  const server = stripTransport(asPage(run.served), 'server', 'page');
  const client = stripTransport(asPage(run.twin), 'client', 'page');
  const comparison = compareTrees(server.tree, client.tree);
  const report = makeReport({ ...head, server: { tree: server.tree, ...(base.html ? { html: base.html } : {}), keys: Object.fromEntries(server.keys) }, client: { tree: client.tree } }, comparison);
  return problems.length ? { ...report, verdict: 'error', error: problems.join('; ') } : report;
}

export function p2Report(base: ReportBase, run: PageRun): Report {
  const head = headOf(base, 'P2');
  if (run.error) return makeReport({ ...head, verdict: 'error', error: `boot: ${run.error.split('\n')[0]}` }, null);
  if (!run.p2) return makeReport({ ...head, verdict: 'error', error: 'activation did not run' }, null);
  const missed = Object.entries(run.p2.control).filter(([, seen]) => !seen).map(([kind]) => kind);
  if (missed.length) return makeReport({ ...head, verdict: 'error', error: `P2's observer did not record the control's ${missed.join(', ')} write: its zero records cannot be trusted` }, null);
  const differences: Difference[] = [
    ...run.p2.records.map(record => ({
      kind: 'mutation' as const,
      path: record.attribute ? `${record.path}[${record.attribute}]` : record.path,
      server: record.oldValue ?? (record.removed.length ? `removed ${record.removed.join(', ')}` : ''),
      client: record.value ?? (record.added.length ? `added ${record.added.join(', ')}` : ''),
    })),
    ...run.p2.events.map(detail => ({ kind: 'activation-error' as const, path: 'root', client: `forma:error ${detail}` })),
    ...run.logged.filter(entry => entry.step === 'P2').map(entry => ({ kind: 'activation-error' as const, path: 'root', client: entry.text })),
  ];
  const activation = { hosts: run.p2.hosts, activated: run.p2.activated };
  // Every host must activate (deferred triggers are driven in the page); a host that never did is
  // named, since zero records over it would prove nothing. A host whose adoption failed shows as
  // differences (its status write, its forma:error). A state whose page has no host (a list of
  // islands at length 0) has nothing to activate: equal, with the count saying so.
  if (differences.length === 0 && run.p2.inactive.length) {
    const named = run.p2.inactive.map(host => `${host.component ?? '?'} at ${host.path} (${host.trigger})`).join('; ');
    return makeReport({ ...head, verdict: 'error', activation, error: `${activation.activated} of ${activation.hosts} island hosts activated; never activated: ${named}` }, null);
  }
  return makeReport({ ...head, activation }, { differences, first: differences[0] ?? null, count: differences.length, structural: 0, holderAmbiguous: 0 });
}

/**
 * P3: the page activated at state `index`, moved by the module's setter to the next state, against
 * that next state's fresh server render. Both trees are the server's kind (the live one is the
 * adopted server DOM), so both are stripped as the server side: markers, activation attributes,
 * keys and holders.
 */
export function p3Report(base: ReportBase & { next: number }, run: PageRun, nextServed: CanonNode | null): Report {
  const head = { ...headOf(base, 'P3'), transition: { from: base.index, to: base.next } };
  if (run.error) return makeReport({ ...head, verdict: 'error', error: `boot: ${run.error.split('\n')[0]}` }, null);
  if (!run.p3) return makeReport({ ...head, verdict: 'error', error: 'the transition did not run' }, null);
  if ('error' in run.p3) return makeReport({ ...head, verdict: 'error', error: `the setter threw: ${run.p3.error.split('\n')[0]}` }, null);
  if (!nextServed) return makeReport({ ...head, verdict: 'error', error: `state ${base.next}'s server render was not served` }, null);
  const problems = run.logged.filter(entry => entry.step === 'P3').map(entry => `P3: ${entry.text}`);
  const server = stripTransport(asPage(nextServed), 'server', 'page');
  const live = stripTransport(asPage(run.p3.live), 'server', 'page');
  const report = makeReport({ ...head, server: { tree: server.tree }, client: { tree: live.tree } }, compareTrees(server.tree, live.tree));
  return problems.length ? { ...report, verdict: 'error', error: problems.join('; ') } : report;
}

export interface CheckOptions extends PlanOptions {
  readonly browser: Browser;
  /** Test seam (renderBoth): rewrites the served document before the browser parses it. */
  readonly alterServerHtml?: (html: string) => string;
  /** Test seam: P2's observer watches a detached element (the positive control must then fail). */
  readonly observeDetached?: boolean;
  /** How long one state's boot may take before that state is an error (default 30 s). */
  readonly bootTimeout?: number;
}

/**
 * A module the typed path refused and the walker alone rendered, without corpus.json declaring
 * `serverPath: "low-level"`: a `server-refused` report that fails the run, naming the codes.
 */
export function fallbackReport(plan: ModulePlan, server: Served, options: PlanOptions): Report | null {
  if (server.path !== 'low-level' || options.lowLevel || plan.entry.serverPath === 'low-level') return null;
  const codes = server.bind.map(refusal => `${refusal.code}${refusal.path ? ` at ${refusal.path}` : ''}`).join(', ') || 'no code';
  const first = server.bind[0];
  return makeReport({
    module: plan.entry.name, seed: options.seed, index: plan.indices[0] ?? 0, check: 'P1', verdict: 'server-refused', serverPath: 'low-level', bind: server.bind,
    refusal: { code: first?.code ?? 'TYPED', path: first?.path ?? '', message: `the typed path refused the module (${codes}) and the walker alone rendered it; corpus.json does not declare serverPath: "low-level"` },
  }, null);
}

export interface Timings { prepare: number; launch: number; server: number; browser: number }

/** Run P1, P2 and P3 over the plans; the reports in corpus and state order (a module's P3 after its states). */
export async function check(plans: readonly ModulePlan[], options: CheckOptions, timings: Timings): Promise<Report[]> {
  let started = performance.now();
  const served = serve(plans, options);
  timings.server += performance.now() - started;
  started = performance.now();
  const reports: Report[] = [];
  const page = new ParityPage(options.browser, options.bootTimeout);
  try {
    for (const plan of plans) {
      const name = plan.entry.name;
      if (plan.failure) {
        reports.push(makeReport({ module: name, seed: options.seed, index: plan.indices[0] ?? 0, check: 'P1', verdict: 'error', error: plan.failure }, null));
        continue;
      }
      const server = served.get(name)!;
      const fallback = fallbackReport(plan, server, options);
      if (fallback) reports.push(fallback);
      const transition = plan.entry.transition !== undefined && plan.script !== null;
      const count = plan.indices.length;
      const bases = plan.indices.map((index, k) => ({
        module: name, seed: options.seed, index, state: plan.states[k]!, serverPath: server.path, next: plan.indices[(k + 1) % count]!,
        ...(server.bind.length ? { bind: server.bind } : {}),
      }));
      const runs: (PageRun | null)[] = [];
      for (let k = 0; k < count; k++) {
        const { next: _next, ...base } = bases[k]!;
        const document = server.documents[k];
        if (!document || 'error' in document) {
          reports.push(makeReport({ ...base, check: 'P1', verdict: 'error', error: document ? `server: ${document.error}` : 'server: no entry' }, null));
          runs.push(null);
          continue;
        }
        if ('refused' in document) {
          reports.push(makeReport({ ...base, check: 'P1', verdict: 'server-refused', refusal: document.refused }, null));
          runs.push(null);
          continue;
        }
        const html = options.alterServerHtml ? options.alterServerHtml(document.html) : document.html;
        const run = await page.run({ html, headers: document.headers }, { twin: plan.twin, entry: plan.script }, {
          module: name, index: base.index, state: base.state, schema: plan.described.schema, props: plan.entry.page.props, entry: plan.script !== null,
          ...(transition ? { next: plan.states[(k + 1) % count]! } : {}),
          ...(options.observeDetached ? { observeDetached: true } : {}),
        });
        runs.push(run);
        const p1 = p1Report({ ...base, html }, run);
        reports.push(p1.verdict === 'equal' || !plan.diagnostics.length ? p1 : { ...p1, compiler: plan.diagnostics });
        if (plan.script !== null) reports.push(p2Report(base, run));
      }
      if (transition) {
        for (let k = 0; k < count; k++) {
          const run = runs[k];
          if (run) reports.push(p3Report(bases[k]!, run, runs[(k + 1) % count]?.served ?? null));
        }
      } else {
        reports.push(makeReport({ module: name, seed: options.seed, index: plan.indices[0] ?? 0, check: 'P3', verdict: 'no-setter', serverPath: server.path }, null));
      }
    }
  } finally {
    await page.close();
  }
  timings.browser += performance.now() - started;
  return reports;
}
