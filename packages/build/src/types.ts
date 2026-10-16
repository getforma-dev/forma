/**
 * @getforma/build — Type definitions
 *
 * Configuration and result types for the Forma build pipeline.
 */

import type { RouteSize, SizeReport } from './route-size.js';

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface BuildEntry {
  /** Entry point file path */
  entry: string;
  /** Output file path (relative to outputDir) */
  outfile: string;
  /** Disable SSR for this entry in an otherwise SSR-enabled application. */
  ssr?: boolean;
}

export interface CssEntry {
  /** Glob or array of CSS files to concatenate */
  input: string | string[];
  /** Output file path (relative to outputDir) */
  outfile: string;
  /** If true, run @tailwindcss/cli on the first input file */
  tailwind?: boolean;
}

export interface RouteMapping {
  /** Configured entry base names. The first selects the native owner before
   * static SSR removes its browser output; additional entries must be Browser. */
  js: string[];
  /** Base names (without extension) of CSS files for this route */
  css: string[];
  /** Font file names for this route (optional, defaults to all fonts in outputDir) */
  fonts?: string[];
  /**
   * Declare the route a canvas (N2, FORMA-190): a page that hosts many modules
   * and is JavaScript-heavy by design. The size report holds all of its
   * JavaScript to 365 KiB gzip -9 instead of the 75 KiB of other pages; Forma's
   * own code stays under N2's 28,000 B either way. It raises nothing for a
   * route without JavaScript. A heavy page that is not a canvas is trimmed or
   * split, not declared.
   */
  canvas?: boolean;
}

export interface BuildConfig {
  /** JavaScript entry points to build */
  entryPoints: BuildEntry[];
  /** Route-to-asset mapping for manifest generation */
  routes: Record<string, RouteMapping>;
  /** CSS entries to generate (tailwind and/or concatenation) */
  cssEntries?: CssEntry[];
  /** Output directory for all built assets */
  outputDir: string;
  /** 3.x migration bridge for 'formajs'; warns once per build() with importing files. Prefer '@getforma/core'. */
  formaAlias?: string;
  /** Bundle one shared ESM graph, preserving import() as separately loaded chunks. */
  codeSplitting?: boolean;
  /** Production worker policy; defaults to on-demand. Only requested, manifest-listed
   * immutable code/style/WASM assets with verified bytes enter its cache. */
  serviceWorker?: 'on-demand';
  /** Application/worker ID: 1–63 lowercase letters, digits or hyphens, starting
   * with a letter or digit. If omitted, a valid nearest Cargo package name is
   * used. Otherwise supply it explicitly; it is always written to manifest2. */
  app?: string;
  /**
   * Copy `@getforma/core`'s preview-frame runtime into the output, for
   * forma-server's preview frame (`PageResponse::frame`, FORMA-125; FORMA-175).
   * Off by default, where the output is what it was.
   *
   * On, the build copies `dist/formajs-frame.global.js` (core 2.1.0 and later;
   * never core's `dist/forma-runtime.js`, the CDN alias of the auto-mounting
   * runtime) from the core the bundles import, byte for byte, as
   * `forma-runtime.<hash>.js`, and names it in the manifest under
   * `aliases["forma-runtime.js"]`, where `PreviewFrame::load` reads it at start
   * and allows it by its SHA-256 hash. Which core: before anything is
   * written, each entry is bundled in memory with the bundles' own esbuild
   * options (so `formaAlias`, resolved from the working directory, and
   * tsconfig `paths` lead where they lead the bundles), and every file it
   * loads is mapped to its package; when the bundles import none, the core
   * installed where the build runs. Watch mode writes it unhashed as
   * `forma-runtime.js`, named the same way in the dev manifest. It is
   * inlined, never fetched: no compressed copies, and no place in the
   * worker's lists. A core without it fails the build with BUILD-805, a
   * runtime forma-server would refuse to inline (empty, not UTF-8,
   * `</script`, `<!--`, a carriage return or a NUL) with BUILD-806, and
   * bundles that import cores whose runtimes differ with BUILD-807, before
   * anything is written.
   */
  previewFrame?: boolean;
  /** Directory containing .woff2 font files to copy */
  fontDir?: string;
  /** Enable SSR IR emission */
  ssr?: boolean;
  /** SSR entry points for IR emission (page name -> entry path) */
  ssrEntryPoints?: Record<string, string>;
  /** Enable watch mode */
  watch?: boolean;
  /** Budget threshold in bytes (Brotli-compressed), default 200_000 */
  budgetThreshold?: number;
  /** Files that should keep unhashed copies (e.g. for server-inlined assets).
   * A zero-JS SSR owner cannot request executable server inlining. */
  serverInlined?: string[];
  /** Legacy compatibility option. SSR publication always requires the 3.0
   * server-renderable subset. False and FORMA_STRICT=0 cannot downgrade errors.
   * Every page is checked; watch retains its previous good product on failure. */
  strict?: boolean;
  /**
   * Also write every SSR diagnostic as JSON to this path (relative to the
   * working directory), whether or not the build fails: the machine-readable
   * report an agent can act on (N12). It must be outside `outputDir`, which
   * the build replaces whole and serves.
   */
  diagnosticsJson?: string;
  /**
   * The previous release's `dist/`, which the application's pipeline keeps as a
   * release artifact (FORMA-186, DR-29, L-25). The build copies that release's
   * own hashed assets into the new `dist/`, listed in the manifest `retained`
   * and `immutable`, so a tab opened before a deploy still loads its chunks
   * from the one `dist/` the application embeds. One generation: what the
   * previous release itself retained is not copied again. A directory other
   * than `outputDir`, which the build replaces whole. Leave it out for a first
   * deploy, or when no release is live. The previous dist is trusted like the source: the check below catches a damaged or
   * altered file, not someone who can also rewrite its manifest. Every copied file is checked against
   * the SHA-384 the previous manifest recorded (`BUILD-821`); a path that is
   * not a usable previous release fails the build (`BUILD-820`). Ignored in
   * watch mode.
   */
  previousDist?: string;
  /**
   * Mark this release as one that fixes a vulnerability (L-16, SR45): nothing is
   * retained from `previousDist`, so no earlier build's asset is served and a
   * revoked build's tabs meet 404s for their lazy chunks. The application's
   * deploy pipeline must mark every such release, a Forma security upgrade
   * included. `FORMA_SECURITY_RELEASE=1` (or `true`, any case) in the environment marks it too; any
   * value other than 1, true, 0, false or empty fails the build (`BUILD-822`); and a
   * `false` here does not unmark it.
   */
  security?: boolean;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface RouteManifest {
  mode: 'ssr' | 'browser';
  js: string[];
  /** Static ESM dependencies only; dynamic import() chunks are intentionally excluded. */
  modulepreload?: string[];
  css: string[];
  fonts: string[];
  total_size_br: number;
  budget_warn_threshold: number;
  ir?: string;
}

export interface AssetMetadata {
  /** The build guarantees this exact filename is immutable, independent of its spelling. */
  immutable: boolean;
  /** Full SHA-384 of the final uncompressed file, used by SRI and the worker. */
  integrity: string;
  /** A file of the previous release kept for tabs still open on it (FORMA-186, L-25). */
  retained?: boolean;
}

export interface AssetManifest {
  version: 2;
  writer: string;
  app: string;
  /**
   * The deployment identity (FORMA-186, DR-29): 16 lowercase hexadecimal
   * characters computed from the build's own outputs and the writers'
   * versions before anything is named, compiled into every JavaScript bundle
   * (`__FORMA_BUILD__`, which core compares with the page's
   * `data-forma-build`), and the same for identical inputs however often they
   * are built, from any directory when built from the project root (esbuild
   * hashes input paths relative to its working directory). `dev` in watch mode.
   */
  build: string;
  aliases: Record<string, string>;
  assets: Record<string, AssetMetadata>;
  routes: Record<string, RouteManifest>;
}

/** One link of a composition chain, from the page down (BUILD-403). */
export interface BuildDiagnosticChainLink {
  component: string;
  file: string;
  line: number;
  column: number;
}

/**
 * One coded SSR diagnostic (FORMA-119). The catalogue, one entry per code
 * with its fix, is `packages/compiler/docs/subset.md`.
 */
export interface BuildDiagnostic {
  /** The stable code, e.g. `BUILD-101`. */
  code: string;
  /** Unsupported SSR constructs are always `error`; `note` never fails a build. */
  severity: 'error' | 'warning' | 'note';
  /** The page (entry outfile without `.js`) whose module reported it. */
  page: string;
  /** The file to edit; empty for a build-level diagnostic. */
  file: string;
  /** 1-based line and column in `file`, as authored; 0 when unknown. */
  line: number;
  column: number;
  /** The specific report: the construct, what happens, and its fix. */
  message: string;
  /** The catalogue's why and fix for the code. */
  why: string;
  fix: string;
  /** BUILD-403: the composition chain from the page down. */
  chain?: BuildDiagnosticChainLink[];
}

export interface BuildResult {
  manifest: AssetManifest;
  buildHash: string;
  warnings: string[];
  /** Every coded SSR diagnostic the build reported, page by page. */
  diagnostics: BuildDiagnostic[];
  /**
   * The size report's routes (FORMA-021, FORMA-190): per route, its class, what
   * it loads cold in raw, gzip -9 and Brotli bytes, Forma's code
   * (`@getforma/core` and `alien-signals` as bundled) beside the application's,
   * the service worker it registers, and its ceilings. A production build fails
   * with `BUILD-819` before writing its output when a route is over one:
   * Forma's code over N2's `FORMA_CODE_CEILING_GZIP` (28,000 B; decision brief
   * L-59), all of its JavaScript over its class's (none for a route without an
   * interactive region, 75 KiB, 365 KiB for a canvas). Empty in watch mode,
   * whose unminified bytes are not what a route ships. The same objects as
   * `sizeReport.routes`.
   */
  sizes: RouteSize[];
  /**
   * The one report (FORMA-190): `sizes` with the service worker, the preview
   * frame's runtime when `previewFrame` is on (the frame document row), and the
   * build's times by phase. A production build prints it and writes it, without
   * the times (so the output stays the same bytes for the same sources), as
   * `size-report.json` beside `manifest.json`. No routes in watch mode.
   */
  sizeReport: SizeReport;
}
