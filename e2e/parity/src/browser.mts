/**
 * The browser side: one Chromium (Firefox and WebKit by flag, per DR-9's release gate) and one
 * page, a fresh Document per state. On the typed path the page is the server's own document with
 * the server's own headers (its nonce, `strict-dynamic` and Trusted Types policy), whose route
 * script is the harness boot (`boot.mts`); on the low-level path it is a minimal document around
 * the walker's body and state block, under a policy as strict for scripts.
 *
 * Nothing listens on a port: every URL under http://parity.invalid/ is fulfilled by `page.route`,
 * as core's state-roundtrip spec does. Core is `packages/core/dist/forma.esm.js`, served once at
 * `/_parity/core.mjs`, which every bundle imports.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { BOOT_SOURCE } from './boot.mts';
import { CORE_URL } from './bundle.mts';
import type { CanonNode } from './compare.mts';
import type { Json, Schema } from './generate.mts';
import { BOOT_FILE } from './manifest.mts';
import { REPO } from './server.mts';

export type Engine = 'chromium' | 'firefox' | 'webkit';

export const ORIGIN = 'http://parity.invalid';
const CORE_DIST = resolve(REPO, 'packages/core/dist/forma.esm.js');

/**
 * The low-level path's policy: scripts as strict as an application's (same-origin modules only,
 * Trusted Types enforced, so a harness that needed an HTML sink would fail rather than hide it);
 * images and inline style attributes as forma-server's own policy allows them
 * (`crates/forma-server/src/csp.rs`).
 */
export const LOW_LEVEL_POLICY = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; " +
  "style-src-attr 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types forma forma-runtime; base-uri 'none'";

/** The low-level path's document: the walker's state block and body, and the boot. */
export function lowLevelDocument(body: string, state: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<script type="application/json" data-island-state>${state}</script>` +
    `<script type="module" src="/_assets/${BOOT_FILE}"></script></head>` +
    `<body><div id="app" data-forma-ssr>${body}</div></body></html>`;
}

export interface ServedDocument {
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface StateInput {
  readonly module: string;
  readonly index: number;
  readonly state: Json;
  readonly schema: Schema;
  readonly props: 'none' | 'named' | 'destructured';
  /** Whether the module has a production browser entry (P2 runs only then). */
  readonly entry: boolean;
}

export interface MutationRecordData {
  readonly type: string;
  readonly path: string;
  readonly attribute: string | null;
  readonly oldValue: string | null;
  readonly value: string | null;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface P2Result {
  readonly records: readonly MutationRecordData[];
  /** `forma:error` details dispatched during activation. */
  readonly events: readonly string[];
  /** The positive control: records the observer saw for one deliberate write (must be 1). */
  readonly caught: number;
  readonly hosts: number;
  /** Hosts whose hydration ran and holds core's disposer afterwards. */
  readonly activated: number;
}

export interface Logged { readonly step: string; readonly text: string }

export interface PageRun {
  readonly served: CanonNode | null;
  readonly twin: CanonNode | null;
  readonly twinError: string | null;
  readonly p2: P2Result | null;
  readonly error: string | null;
  /** Console errors, uncaught errors and rejections, by the boot step they happened in. */
  readonly logged: readonly Logged[];
  readonly violations: readonly Logged[];
  readonly pageErrors: readonly string[];
}

export async function launch(engine: Engine): Promise<Browser> {
  const type = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
  return type.launch({ headless: true });
}

/** One page, reused for every state of every module; each state is a fresh Document. */
export class ParityPage {
  private page: Page | undefined;
  private document: ServedDocument = { html: '', headers: {} };
  private input = '';
  private entry: string | null = null;
  private twin = '';
  private readonly core = readFileSync(CORE_DIST, 'utf8');
  private pageErrors: string[] = [];

  private readonly browser: Browser;

  constructor(browser: Browser) {
    this.browser = browser;
  }

  private async open(): Promise<Page> {
    if (this.page) return this.page;
    const page = await this.browser.newPage();
    page.on('pageerror', error => this.pageErrors.push(error.message));
    await page.route(`${ORIGIN}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      const script = (body: string) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body });
      if (path === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { ...this.document.headers }, body: this.document.html });
      if (path === `/_assets/${BOOT_FILE}`) return script(BOOT_SOURCE);
      if (path === CORE_URL) return script(this.core);
      if (path === '/_parity/input.json') return route.fulfill({ contentType: 'application/json', body: this.input });
      if (path === '/_parity/entry.mjs' && this.entry !== null) return script(this.entry);
      if (path === '/_parity/twin.mjs') return script(this.twin);
      // Authored resources (an <img src>) get an empty answer: a 404 would log a console error that is not a parity case.
      return route.fulfill({ status: 204, body: '' });
    });
    this.page = page;
    return page;
  }

  /** Serve `document` for one state and collect what the boot recorded. */
  async run(document: ServedDocument, bundles: { readonly twin: string; readonly entry: string | null }, input: StateInput): Promise<PageRun> {
    const page = await this.open();
    this.document = document;
    this.twin = bundles.twin;
    this.entry = bundles.entry;
    this.input = JSON.stringify(input);
    this.pageErrors = [];
    await page.goto(`${ORIGIN}/?m=${encodeURIComponent(input.module)}&s=${input.index}`);
    await page.waitForFunction(() => (window as unknown as { __parityResult?: unknown }).__parityResult !== undefined, undefined, { timeout: 30_000 });
    const result = await page.evaluate(() => (window as unknown as { __parityResult: Omit<PageRun, 'pageErrors'> & { error?: string } }).__parityResult);
    return {
      served: result.served ?? null,
      twin: result.twin ?? null,
      twinError: result.twinError ?? null,
      p2: result.p2 ?? null,
      error: result.error ?? null,
      logged: result.logged ?? [],
      violations: result.violations ?? [],
      pageErrors: [...this.pageErrors],
    };
  }

  async close(): Promise<void> {
    await this.page?.close();
    this.page = undefined;
  }
}
