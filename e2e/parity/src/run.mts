/**
 * The parity suite over the corpus (FORMA-183): every module of `corpus.json` at its states,
 * P1 and, for pages with islands, P2; the expected divergences applied; the totals, the structural
 * classes the stop rule counts, and the wall time by phase.
 *
 *   node e2e/parity/src/run.mts [--seed forma-183] [--states 10] [--module name ...]
 *                               [--engine chromium|firefox|webkit] [--low-level] [--report file.jsonl]
 *
 * Exit status: 0 when every report is equal or expected-divergent and every expected divergence
 * still occurs; 1 otherwise (an unexpected difference, refusal or error, or an unexpected pass).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { launch, type Engine } from './browser.mts';
import { STRUCTURAL_KINDS, structuralClass, summarize, type Report } from './compare.mts';
import { applyExpected, readExpected, type ExpectedEntry } from './expected.mts';
import { parityRender } from './server.mts';
import { check, prepare, readCorpus, type ModulePlan, type Timings } from './suite.mts';

export interface SuiteResult {
  readonly reports: readonly Report[];
  readonly unexpectedPasses: readonly ExpectedEntry[];
  readonly timings: Timings & { total: number };
  readonly modules: number;
  readonly states: number;
}

export interface SuiteOptions {
  readonly seed: string;
  readonly states: number;
  readonly modules?: readonly string[];
  readonly engine: Engine;
  readonly lowLevel?: boolean;
  readonly expected?: readonly ExpectedEntry[];
}

export async function runSuite(options: SuiteOptions): Promise<SuiteResult> {
  const started = performance.now();
  const timings: Timings = { prepare: 0, launch: 0, server: 0, browser: 0 };
  const corpus = readCorpus().filter(entry => !options.modules?.length || options.modules.includes(entry.name));
  if (options.modules?.length && corpus.length !== options.modules.length) {
    throw new Error(`corpus.json has no module ${options.modules.filter(name => !corpus.some(entry => entry.name === name)).join(', ')}`);
  }
  let phase = performance.now();
  parityRender();
  const plans: ModulePlan[] = [];
  for (const entry of corpus) plans.push(await prepare(entry, { seed: options.seed, states: options.states, ...(options.lowLevel ? { lowLevel: true } : {}) }));
  timings.prepare = performance.now() - phase;
  phase = performance.now();
  const browser = await launch(options.engine);
  timings.launch = performance.now() - phase;
  let reports: Report[];
  try {
    reports = await check(plans, { seed: options.seed, states: options.states, browser, ...(options.lowLevel ? { lowLevel: true } : {}) }, timings);
  } finally {
    await browser.close();
  }
  const applied = applyExpected(reports, options.expected ?? readExpected());
  return {
    reports: applied.reports,
    unexpectedPasses: applied.unexpectedPasses,
    timings: { ...timings, total: performance.now() - started },
    modules: plans.length,
    states: plans.reduce((sum, plan) => sum + plan.indices.length, 0),
  };
}

/** The structural classes (PLAN T1's stop rule) over every P1 difference, expected or not. */
export function structuralClasses(reports: readonly Report[]): string[] {
  const classes = new Set<string>();
  for (const report of reports) {
    if (report.check !== 'P1') continue;
    for (const difference of report.differences) if (STRUCTURAL_KINDS.has(difference.kind)) classes.add(structuralClass(report.module, difference));
  }
  return [...classes].sort();
}

export function totals(reports: readonly Report[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const report of reports) {
    const check = (out[report.check] ??= { equal: 0, different: 0, 'expected-divergent': 0, 'server-refused': 0, error: 0 });
    check[report.verdict] = (check[report.verdict] ?? 0) + 1;
  }
  return out;
}

export function passed(result: SuiteResult): boolean {
  return result.unexpectedPasses.length === 0 && result.reports.every(report => report.verdict === 'equal' || report.verdict === 'expected-divergent');
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function summaryText(result: SuiteResult): string {
  const lines: string[] = [];
  for (const report of result.reports) {
    if (report.verdict === 'equal') continue;
    lines.push(`${summarize(report)}${report.expected ? ` [${report.expected.ticket}]` : ''}`);
  }
  for (const entry of result.unexpectedPasses) {
    lines.push(`UNEXPECTED PASS ${entry.check} ${entry.module}#${entry.index} ${entry.kind}${entry.path ? ` at ${entry.path}` : ''} [${entry.ticket}]: the divergence is gone; remove the entry`);
  }
  const counts = totals(result.reports);
  lines.push('');
  lines.push(`parity: ${result.modules} modules, ${result.states} states`);
  for (const [check, verdicts] of Object.entries(counts)) {
    lines.push(`  ${check}: ${Object.entries(verdicts).map(([verdict, n]) => `${verdict} ${n}`).join(', ')}`);
  }
  const classes = structuralClasses(result.reports);
  lines.push(`structural classes: ${classes.length}${classes.length ? ` (${classes.join('; ')})` : ''}`);
  lines.push(`wall time ${seconds(result.timings.total)} (prepare ${seconds(result.timings.prepare)}, browser launch ${seconds(result.timings.launch)}, server ${seconds(result.timings.server)}, browser ${seconds(result.timings.browser)})`);
  lines.push(passed(result) ? 'parity: PASS (every difference is expected and every expected difference occurred)' : 'parity: FAIL');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: 'forma-183' },
      states: { type: 'string', default: '10' },
      module: { type: 'string', multiple: true },
      engine: { type: 'string', default: 'chromium' },
      'low-level': { type: 'boolean', default: false },
      report: { type: 'string' },
    },
  });
  const engine = values.engine as Engine;
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`unknown engine ${engine}`);
  const states = Number(values.states);
  if (!Number.isInteger(states) || states < 1) throw new Error(`--states must be a positive integer, got ${values.states}`);
  const result = await runSuite({ seed: values.seed!, states, engine, ...(values.module ? { modules: values.module } : {}), lowLevel: values['low-level']! });
  process.stdout.write(`${summaryText(result)}\n`);
  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true });
    const summary = {
      summary: true, seed: values.seed, engine, modules: result.modules, states: result.states, totals: totals(result.reports),
      structuralClasses: structuralClasses(result.reports), unexpectedPasses: result.unexpectedPasses,
      timingsMs: Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, Math.round(v)])), passed: passed(result),
    };
    writeFileSync(values.report, [...result.reports.map(report => JSON.stringify(report)), JSON.stringify(summary)].join('\n') + '\n');
    process.stdout.write(`report: ${values.report}\n`);
  }
  return passed(result) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, error => { process.stderr.write(`parity: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 2; });
}
