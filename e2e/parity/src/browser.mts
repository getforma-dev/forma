/**
 * The browser side: one Chromium (Firefox and WebKit by flag, per DR-9's release gate), the
 * server's HTML served as a page under a strict CSP with Trusted Types enforced, and core's own
 * render of the same state built in the same Document. Both trees come back canonical.
 *
 * Nothing listens on a port: every URL under http://parity.invalid/ is fulfilled by
 * `page.route`, as core's state-roundtrip spec does. The page component is bundled in-process with
 * esbuild, `formajs` and `@getforma/core` resolved to the one served core module so both sides of
 * the page share one runtime instance.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium, firefox, webkit, type Browser } from '@playwright/test';
import * as esbuild from 'esbuild';
import type { CanonNode } from './compare.mts';
import { canonicalizeDom } from './dom-canon.mts';
import type { Json, Schema } from './generate.mts';
import { REPO } from './server.mts';

export type Engine = 'chromium' | 'firefox' | 'webkit';

export interface PageComponent {
  /** Repository-relative path of the file exporting the page function. */
  readonly file: string;
  readonly exportName: string;
  /** `none`: called with no argument; otherwise the state object is the one argument. */
  readonly props: 'none' | 'named' | 'destructured';
}

export interface BrowserRender {
  readonly served: CanonNode;
  readonly twin: CanonNode;
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

const ORIGIN = 'http://parity.invalid';
/**
 * Scripts as strict as an application's (no inline script, Trusted Types enforced, so a harness
 * that needed an HTML sink would fail rather than hide it); images and inline style attributes as
 * forma-server's own policy allows them (`crates/forma-server/src/csp.rs`), so authored content
 * renders without a policy error that is not a parity case.
 */
export const PAGE_POLICY = "default-src 'none'; script-src 'self'; img-src 'self' data:; style-src-attr 'unsafe-inline'; " +
  "require-trusted-types-for 'script'; trusted-types forma; base-uri 'none'";
const CORE_DIST = resolve(REPO, 'packages/core/dist/forma.esm.js');

/** The page component as one ESM bundle importing core from `/core.mjs`. */
export async function bundlePage(component: PageComponent): Promise<string> {
  const file = resolve(REPO, component.file);
  const result = await esbuild.build({
    stdin: { contents: `export { ${component.exportName} as Page } from ${JSON.stringify(file)};`, resolveDir: dirname(file), loader: 'ts' },
    bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022', logLevel: 'silent',
    jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment',
    plugins: [{
      name: 'forma-core',
      setup(build) {
        build.onResolve({ filter: /^(formajs|@getforma\/core)$/ }, () => ({ path: '/core.mjs', external: true }));
      },
    }],
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error(`bundling ${component.file} produced no output`);
  return out.text;
}

/** Revive dates (epoch milliseconds on the wire) into `Date` by the schema, as core's decoder does. Runs in the page. */
function reviveByType(value: unknown, type: { kind: string; element?: unknown; inner?: unknown; object?: number }, schema: Schema): unknown {
  if (value === null || value === undefined) return value;
  switch (type.kind) {
    case 'date': return new Date(value as number);
    case 'optional': return reviveByType(value, type.inner as typeof type, schema);
    case 'array': return (value as unknown[]).map(item => reviveByType(item, type.element as typeof type, schema));
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const field of schema[type.object as number] ?? []) {
        const inner = (value as Record<string, unknown>)[field.name];
        if (inner !== undefined) out[field.name] = reviveByType(inner, field.type as typeof type, schema);
      }
      return out;
    }
    default: return value;
  }
}

function bootScript(component: PageComponent): string {
  return `
import { mount } from '/core.mjs';
import { Page } from '/page.mjs';
const canonicalizeDom = ${canonicalizeDom.toString()};
const reviveByType = ${reviveByType.toString()};
try {
  const input = JSON.parse(document.querySelector('script[data-parity-input]').textContent);
  const served = canonicalizeDom(document.getElementById('__served'));
  const props = reviveByType(input.state, { kind: 'object', object: 0 }, input.schema);
  const twinHost = document.getElementById('__twin');
  mount(() => ${component.props === 'none' ? 'Page()' : 'Page(props)'}, twinHost);
  const twin = canonicalizeDom(twinHost);
  window.__parityResult = { served, twin };
} catch (error) {
  window.__parityError = String(error && error.stack || error);
}
`;
}

export async function launch(engine: Engine): Promise<Browser> {
  const type = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
  return type.launch({ headless: true });
}

export interface RenderInBrowserOptions {
  readonly browser: Browser;
  readonly component: PageComponent;
  readonly bundle: string;
  /** The walker's body HTML and head state block for this state. */
  readonly html: string;
  readonly state: string;
  readonly props: Json;
  readonly schema: Schema;
}

export async function renderInBrowser(options: RenderInBrowserOptions): Promise<BrowserRender> {
  const page = await options.browser.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const input = JSON.stringify({ state: options.props, schema: options.schema }).replace(/</g, '\\u003c');
  const document = `<!doctype html><html><head><meta charset="utf-8">` +
    `<script type="application/json" data-island-state>${options.state}</script>` +
    `<script type="application/json" data-parity-input>${input}</script>` +
    `<script type="module" src="/boot.mjs"></script></head>` +
    `<body><div id="__served">${options.html}</div><div id="__twin"></div></body></html>`;
  try {
    await page.route(`${ORIGIN}/**`, route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/parity.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': PAGE_POLICY }, body: document });
      if (path === '/core.mjs') return route.fulfill({ contentType: 'text/javascript', body: readFileSync(CORE_DIST, 'utf8') });
      if (path === '/page.mjs') return route.fulfill({ contentType: 'text/javascript', body: options.bundle });
      if (path === '/boot.mjs') return route.fulfill({ contentType: 'text/javascript', body: bootScript(options.component) });
      // Authored resources (an <img src>) get an empty answer: a 404 would log a console error that is not a parity case.
      return route.fulfill({ status: 204, body: '' });
    });
    await page.goto(`${ORIGIN}/parity.html`);
    await page.waitForFunction(() => (window as unknown as { __parityResult?: unknown; __parityError?: unknown }).__parityResult !== undefined
      || (window as unknown as { __parityError?: unknown }).__parityError !== undefined, undefined, { timeout: 30_000 });
    const result = await page.evaluate(() => {
      const w = window as unknown as { __parityResult?: { served: CanonNode; twin: CanonNode }; __parityError?: string };
      return { result: w.__parityResult ?? null, error: w.__parityError ?? null };
    });
    if (!result.result) throw new Error(`the page did not render both sides: ${result.error ?? 'no result'}${pageErrors.length ? `; page errors: ${pageErrors.join('; ')}` : ''}`);
    return { served: result.result.served, twin: result.result.twin, pageErrors, consoleErrors };
  } finally {
    await page.close();
  }
}
