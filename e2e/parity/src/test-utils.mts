/** Forma-internal test utilities (FORMA-184, Q11). Never part of a published package. */
import type { Browser } from '@playwright/test';
import { launch, type Engine } from './browser.mts';
import type { Report } from './compare.mts';
import type { Json } from './generate.mts';
import { check, prepare, readCorpus, type CorpusEntry, type Timings } from './suite.mts';

export interface RenderOptions {
  readonly engine?: Engine;
  /** Caller-owned browsers stay open; a browser created by the helper is always closed. */
  readonly browser?: Browser;
  /** Seeded defect seam: change native HTML before the browser parses it. */
  readonly alterServerHtml?: (html: string) => string;
}

/**
 * Render a compiled component at the exact supplied state, through the native typed renderer
 * and core in Chromium (or the requested engine). A component is its corpus name or source
 * descriptor: the Rust side needs the compiled entry, not an already executed JS function.
 *
 * The P1 report contains both canonical trees, native HTML and the first difference. A refused
 * state or failed compile/render is reported, never compared as an empty successful tree.
 * No generated state or expected-divergent exemption replaces the caller's input.
 */
export async function renderBoth(
  component: string | CorpusEntry,
  state: Json,
  options: RenderOptions = {},
): Promise<Report> {
  const entry = typeof component === 'string'
    ? readCorpus().find(candidate => candidate.name === component)
    : component;
  if (!entry) throw new Error(`corpus.json has no module ${component}`);
  const planOptions = { seed: 'explicit-state', states: 1, indices: [0] };
  const prepared = await prepare(entry, planOptions);
  const plan = { ...prepared, indices: [0], states: [state] };
  const browser = options.browser ?? await launch(options.engine ?? 'chromium');
  const timings: Timings = { prepare: 0, launch: 0, server: 0, browser: 0 };
  try {
    const reports = await check([plan], {
      ...planOptions, browser,
      ...(options.alterServerHtml ? { alterServerHtml: options.alterServerHtml } : {}),
    }, timings);
    const report = reports.find(result => result.check === 'P1');
    if (!report) throw new Error(`${entry.name}: no P1 report`);
    return report;
  } finally {
    if (!options.browser) await browser.close();
  }
}
