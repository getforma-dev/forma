import { defineConfig, type Options } from 'tsup';
import {
  DEV_DEFINE,
  DEV_OUT_DIR,
  FORMA_ALIAS,
  FRAME_DEFINE,
  PROD_DEFINE,
} from './scripts/build-defines.mjs';

const formaAlias = { ...FORMA_ALIAS };

/**
 * Every production artifact is built with `__FORMA_DEV_BUILD__` replaced by
 * the literal `false` (PROD_DEFINE), which is what makes `__DEV__` a build-time
 * constant instead of a runtime NODE_ENV read. The development twins at the end
 * of this file replace it with `true` (DEV_DEFINE) instead; see
 * `developmentTwin`.
 *
 * There is no longer an eval-posture define: the `new Function` fallback was
 * deleted from the source, so no build has one to switch on and the "hardened"
 * artifacts differ from the standard ones only in name and bundling strategy.
 * They are kept because they are documented CDN URLs and exports-map targets.
 *
 * Verified by: src/reactive/__tests__/dev-flag.test.ts > "resolves __DEV__ at build time and drops the NODE_ENV fallback"
 * Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
 */
function defines() {
  return { ...PROD_DEFINE };
}

/**
 * Syntax-level minification ONLY (`minifyWhitespace`/`minifyIdentifiers` stay
 * off, so output keeps its line structure and real identifier names — minified
 * single-line files trigger false-positive "obfuscated code" flags in supply
 * chain scanners such as Socket.dev and Snyk).
 *
 * This is what makes the build-time dev flag real rather than decorative:
 * with syntax minification on, esbuild folds each `typeof __FORMA_DEV_BUILD__
 * …` guard to its literal while parsing and deletes the branch it guards.
 * Without it the guard survives into the shipped bytes, unreachable but paid
 * for. The guard sits at every warning site (FORMA-021 C1): esbuild never
 * inlines a `const` into its use sites, so an imported or module-level
 * `__DEV__` folds only where tsup's Rollup pass runs, which the standard
 * runtime IIFE has none of. See src/reactive/dev.ts.
 *
 * Verified by: src/__tests__/build-artifacts.test.ts > "the allowlist interpreter is actually in the bundle"
 * Verified by: src/__tests__/dev-fold-build.test.ts > "the production code-split entries carry no development warning text, and the development twin carries every one"
 */
function applyEsbuildOptions(options: { alias?: Record<string, string>; pure?: string[]; minifySyntax?: boolean }, pure?: string[]) {
  options.alias = formaAlias;
  options.minifySyntax = true;
  if (pure) options.pure = pure;
}

// createEffect is NOT pure — it registers reactive subscriptions as side effects
const PURE_FACTORIES = ['createSignal', 'createComputed', 'createStore', 'createBus'];

// `dist/` is emptied once, up front, by `node scripts/clean-dist.mjs` in the
// `build` script. No config sets `clean` — tsup runs these configs in PARALLEL,
// so a clean inside any one of them races the outputs of the others (it used to
// delete config 4's declaration files after they were written, leaving the
// build's result dependent on scheduler timing).
const PRODUCTION: Options[] = [
  // ESM + CJS + type declarations — tree-shakeable imports (production).
  // `alien-signals` stays EXTERNAL here on purpose: every Node/bundler consumer
  // must share a single copy of the reactive graph. The self-contained browser
  // build below is the one that inlines it.
  {
    entry: {
      index: 'src/index.ts',
      compiled: 'src/compiled.ts',
      runtime: 'src/runtime.ts',
      'tc39-compat': 'src/reactive/tc39-compat.ts',
      http: 'src/http/index.ts',
      storage: 'src/storage/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: true,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options, PURE_FACTORIES);
    },
  },
  // Self-contained browser ESM build — the artifact the README's
  // `<script type="module">` CDN recipe points at. `noExternal` inlines
  // alien-signals and `splitting: false` keeps it to a single file, so the
  // browser never has to resolve a bare specifier or a sibling chunk URL.
  //
  // Verified by: src/__tests__/build-artifacts.test.ts > "the browser ESM CDN artifact is self-contained"
  {
    entry: { 'forma.esm': 'src/index.ts' },
    format: ['esm'],
    noExternal: [/.*/],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    outDir: 'dist',
    treeshake: true,
    splitting: false,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options, PURE_FACTORIES);
    },
  },
  // IIFE runtime build — for <script src="formajs-runtime.global.js"> (HTML API)
  {
    entry: { 'formajs-runtime': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    target: 'es2022',
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // "Hardened" runtime. Historically this was the build with the `new Function`
  // fallback compiled out; the fallback is gone from the source, so it is now
  // the same runtime under a second, tree-shaken, non-code-split name. It stays
  // because `@getforma/core/runtime-hardened`, `@getforma/core/runtime-csp` and
  // two documented CDN URLs point at it.
  //
  // Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
  {
    entry: { 'runtime-hardened': 'src/runtime.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: false,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // Hardened IIFE. `treeshake` makes Rollup rewrite the IIFE wrapper into
  // `(function(exports){…})({})`, which publint correctly reads as CommonJS
  // served under an ESM `.js` extension — which is why this artifact is
  // reachable only by URL and not through the exports map. It is gated at
  // 40,500 B gzip by scripts/check-size.mjs.
  {
    entry: { 'formajs-runtime-hardened': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: false,
    treeshake: true,
    sourcemap: true,
    target: 'es2022',
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // The preview frame's runtime (FORMA-128, tier (c)): one classic script a
  // server writes inline into the frame document, under a policy that allows
  // it by its SHA-256 hash, so it is self-contained, carries no source map
  // comment, and is the same bytes from the same sources. Built with the frame
  // flag, so it never mounts the page's `data-forma-state` on load or watches
  // `body`: it binds only the module its host sends, in tier (c). No global.
  //
  // `treeshake` runs tsup's Rollup pass, as on the hardened IIFE (FORMA-275).
  // It drops what esbuild keeps but the frame never reaches: the teardown of
  // islands the frame never activates, the fetch-grant parser, and the
  // branches for the tiers, grants and options its one `mountMarkup` call
  // never passes. The wrapper becomes `(function (exports) {…})({})`, still
  // one classic script, and the exports object it fills is a fresh literal
  // nothing else can reach, so it still defines no global. It is gated at
  // 40,000 B gzip by scripts/check-size.mjs.
  //
  // Verified by: src/__tests__/runtime-frame.test.ts > "the frame runtime is one classic script a server can inline as it is"
  // Verified by: src/__tests__/runtime-frame.test.ts > "two builds of the frame runtime are byte-identical"
  {
    entry: { 'formajs-frame': 'src/runtime-frame.ts' },
    format: ['iife'],
    outDir: 'dist',
    minify: false,
    sourcemap: false,
    treeshake: true,
    target: 'es2022',
    define: { ...FRAME_DEFINE },
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
];

/**
 * The development build (FORMA-169): a twin of each config the `exports` map
 * reaches (the ones that emit declarations: the code-split ESM/CJS entries and
 * the hardened runtime), written to dist/dev/ with `__FORMA_DEV_BUILD__`
 * replaced by `true`. Same sources, same esbuild options, same entry names, so
 * the only difference between `dist/X` and `dist/dev/X` is that `__DEV__` is
 * true and the development warnings it guards are kept. Each subpath's
 * `development` condition points at the twin; the declarations are the
 * production build's, shared.
 *
 * The twins ship no source maps. Their code is what the maps would map to
 * anyway (syntax-minified only, real names, one statement a line), and maps
 * would add 2.7 MB to the unpacked package against 0.78 MB for the JavaScript.
 *
 * The twins are separate tsup configs, so the production configs above, and
 * every byte they write, are what they were before the twins existed.
 *
 * The CDN bundles (the IIFEs and forma.esm.js) have no twin: they are reached
 * by URL, not through `exports`, and `docs/STABILITY.md` says they are
 * production builds only.
 *
 * Verified by: src/__tests__/build-config.test.ts > "builds a development twin of every config the exports map reaches, differing only in the dev flag, the directory and the declarations"
 * Verified by: src/__tests__/development-build.test.ts > "every subpath resolves to production files without the condition and to their development twins with it"
 */
function developmentTwin(config: Options): Options {
  return {
    ...config,
    outDir: DEV_OUT_DIR,
    dts: false,
    sourcemap: false,
    define: { ...DEV_DEFINE },
  };
}

export default defineConfig([
  ...PRODUCTION,
  ...PRODUCTION.filter((config) => config.dts === true).map(developmentTwin),
]);
