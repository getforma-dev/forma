/**
 * Forma Compiler - Coded build diagnostics (FORMA-119; DR-1, L-3, N12)
 *
 * Every construct the compiler cannot represent in a server-rendered module is
 * reported here, with a stable code, the file, the line and the column, one
 * line of why and one of fix. The catalogue below is the single list of codes;
 * `packages/compiler/docs/subset.md` documents each one, and a test keeps the two equal.
 *
 * Codes are numbered by family (L-3). BUILD-303, BUILD-408, BUILD-504, BUILD-706 and BUILD-708
 * are retired and reserved after the declared-state migration. Current
 * nonfatal build notes are explicitly marked with strict=false.
 *
 * Codes are numbered by family (L-3):
 *
 *   BUILD-1xx  an unsupported native subtree
 *   BUILD-2xx  an attribute or prop dropped or left empty
 *   BUILD-3xx  an unresolved text, conditional or list expression
 *   BUILD-4xx  a component the compiler does not inline
 *   BUILD-5xx  a signal the compiler cannot name
 *   BUILD-6xx  the page module and its closed native contract
 *   BUILD-7xx  a construct adoption does not handle; `browserOnly()` is the way out
 *   BUILD-8xx  the build package (reported by @getforma/build, catalogued here)
 *   BUILD-9xx  the compiler's own deprecated entry points (logged when called)
 *
 * A code never changes meaning. A new construct gets a new code; a retired one
 * stays reserved.
 *
 * What a report does, in order:
 *
 * 1. It prints a source-located reason diagnostic with its stable code. Native
 *    expressions that cannot form a declared contract also throw BUILD-610,
 *    independent of strict mode; historical warning-only behavior is archived.
 * 2. It hands the diagnostic, with its location, to the collector the caller
 *    opened with {@link collectDiagnostics}, if any. The SSR plugin opens one
 *    per page; `@getforma/build` gathers them all, writes them as JSON on
 *    request, and always fails publication when any error remains.
 *
 * Verified by: packages/compiler/tests/diagnostics-conformance.test.ts
 */

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export interface DiagnosticEntry {
  /** The stable code, `BUILD-<family><nn>`. */
  code: string;
  /** What the code names, in a few words. */
  title: string;
  /** One line: what happens to the page. */
  why: string;
  /** One line: what to write instead. */
  fix: string;
  /**
   * Whether this is a publication error. False only for explicitly nonfatal build notes.
   */
  strict: boolean;
}

const BROWSER_ONLY_WAY_OUT =
  'or declare the component with browserOnly() (`const X = browserOnly(Impl)` from @getforma/core) and register it in activateIslands, so it renders in the browser alone';

function entry(code: string, title: string, why: string, fix: string, strict = true): DiagnosticEntry {
  return { code, title, why, fix, strict };
}

/**
 * Every code the compiler and the build can report, by family. The order is
 * the documentation's order.
 */
export const DIAGNOSTIC_CATALOGUE: readonly DiagnosticEntry[] = Object.freeze([
  // ── 1xx: subtrees left to the browser (rule 11) ──────────────────────────
  entry('BUILD-101', 'Unrecognised call in the tree',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Write the subtree as h() calls, a component in a relative file, createShow or createList, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-102', 'Unrecognised child expression',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Wrap a reactive child in a function (`() => …`), use createShow for a conditional and createList for rows, or fold the value into a module-level const.'),
  entry('BUILD-103', 'Dynamic tag',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Use a literal tag name, or a component the compiler can follow.'),
  entry('BUILD-104', 'Spread child that does not unroll',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Unroll a module-level const array of object literals, or render runtime rows with createList(source, keyFn, (row) => h(…)).'),
  entry('BUILD-105', 'Spread over a table that is not static',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Declare the table as a literal `const` of object literals in the module it is imported from, with no nested declaration of the same name, or use createList.'),
  entry('BUILD-106', 'createShow branch the compiler cannot follow',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Write the branch inline as `() => h(…)`.'),
  entry('BUILD-107', 'createList the compiler cannot walk',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Write `createList(source, keyFn, (row) => h(…))` with the map function inline and the row parameter named, reading `row.field`.'),

  // ── 2xx: attributes and props ────────────────────────────────────────────
  entry('BUILD-201', 'Props passed as something other than an object literal',
    'The attributes have no explicit native representation, so the build refuses publication.',
    "Pass the attributes as an object literal on the h('tag', { … }) call."),
  entry('BUILD-202', 'Spread props',
    'Spread attributes have no proved native representation, so the build refuses publication.',
    'List the attributes explicitly on the h() call.'),
  entry('BUILD-203', 'Prop key the compiler cannot name',
    'The native attribute key is not proved, so publication is refused instead of dropping it.',
    'Use a plain identifier or string key.'),
  entry('BUILD-204', 'Method-valued prop',
    'An object method (`{ title() { … } }`) has no native binding form, so publication is refused.',
    'Write it as an arrow property (`title: () => …`) for a reactive binding.'),
  entry('BUILD-205', 'dangerouslySetInnerHTML',
    'Raw markup has no admitted native tree contract, so publication is refused.',
    `Render the content as h() children, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-206', 'Reactive attribute the compiler cannot evaluate',
    'The reactive attribute has no supported native value, so the build refuses the page instead of publishing HTML with an omitted attribute.',
    `Pass the computed value as its own declared prop, initialize the signals it reads with literal defaults, or fold the value into a module-level const, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-207', 'Attribute value the compiler cannot evaluate',
    'The attribute has no supported native value, so the build refuses the page instead of publishing HTML with an omitted attribute.',
    `Pass the computed value as its own declared prop, inline a literal or module-level const, ${BROWSER_ONLY_WAY_OUT}.`),

  // ── 3xx: text and conditionals ───────────────────────────────────────────
  entry('BUILD-301', 'Text the compiler cannot evaluate',
    'This unresolved dynamic text expression has no closed native value and ends the build with BUILD-610.',
    'Initialize the signals it reads with literal defaults so the server can render them.'),
  entry('BUILD-302', 'Conditional the compiler cannot evaluate',
    'The conditional has no proved native value. Publishing its default ELSE branch could differ from the browser, so publication is refused.',
    'Initialize the signals the condition reads with literal defaults.'),

  // ── 4xx: components ──────────────────────────────────────────────────────
  entry('BUILD-401', 'Component imported from a package',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Compile the component's source in the application (a relative import), ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-402', 'Component the compiler cannot find',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Import the component from a relative path, or declare it in the calling file.'),
  entry('BUILD-403', 'Composition past the inlining limit of 3',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Flatten the chain so the component sits at depth 3 or less, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-404', 'Recursive component',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Render the recursion with createList over data, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-405', 'Component passed a prop the compiler cannot evaluate',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Pass literal values (strings, numbers, booleans, null) as props.'),
  entry('BUILD-406', 'Component the compiler cannot follow',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Return the h() tree directly from the component (an expression body or a top-level `return h(…)`).'),
  entry('BUILD-407', 'Children passed to a component',
    "The compiler cannot place a component's children in the native tree, so publication is refused.",
    'Pass the content as props, or render it inside the component.'),

  // ── 5xx: signals ─────────────────────────────────────────────────────────
  entry('BUILD-501', 'Signal default the compiler cannot evaluate',
    "The signal has no closed native default, so publication is refused instead of inventing an empty binding.",
    'Initialize it with a string, number, boolean or null literal, or a module-level string const.'),
  entry('BUILD-502', 'Signal declared twice in one scope',
    'Duplicate declarations cannot establish one unambiguous native default, so publication is refused.',
    'Declare the signal once.'),
  entry('BUILD-503', 'Signal name taken by another scope',
    "The signal name conflicts across scopes and cannot establish one native binding, so publication is refused.",
    'Give the scopes distinct signal names, or declare the signal once and import it.'),

  // ── 6xx: the page module ─────────────────────────────────────────────────
  entry('BUILD-601', 'No mount() call in the entry',
    'The compiler cannot find the page, so no native product is emitted and the build refuses publication.',
    "Call mount(() => …, '#app') or activateIslands({ … }) at the top level of the SSR entry, or declare the route `ssr: false`."),
  entry('BUILD-602', 'Page component the compiler cannot resolve',
    'The page component named in mount() cannot be found or read, so no native product is emitted and the build refuses publication.',
    'Import the page component from a relative path that exports it as a function.'),
  entry('BUILD-603', 'Page root that is not an h() call',
    'The page returns no native tree the compiler can follow, so no native product is emitted and the build refuses publication.',
    'Return the page tree as h() calls (or JSX).'),
  entry('BUILD-604', 'Literal past 65,535 bytes',
    "FMIR's string table and slot defaults hold at most 65,535 bytes per entry, so this page cannot be encoded and the build refuses publication.",
    'Load content that long at run time (a handler-filled slot or a fetch), or split it into smaller literals.'),
  entry('BUILD-605', 'Module const past 65,535 bytes',
    'A module-level const that folds to more than 65,535 bytes is not folded, so every use of it is reported where it is read.',
    'Keep folded constants under 65,535 bytes, or load the content at run time.'),
  entry('BUILD-606', 'Module emission failed',
    'The compiler failed while emitting the page and cannot produce a native module. Publication is refused; no placeholder module is substituted.',
    'Report it with the message; until it is fixed, declare the route `ssr: false`.'),
  entry('BUILD-610', 'Invalid declared page props',
    'The declared data or expression cannot be represented by the closed native contract; publication is refused.',
    'Declare supported typed props and pass computed values as their own props from the handler, use a closed literal-default signal, or move the component behind a registered browserOnly() boundary.'),

  entry('BUILD-611', 'Unsupported islands-only entry or static route',
    'The selected native entry cannot be rewritten without discarding used results or effects, or its static route mapping requests executable assets; the build fails even without strict mode.',
    'Use one standalone imported core mount selecting the native page, keep activation outside it, and use an activation-only browser entry when the browser root differs. Static routes must have no extra script entry or module preload.'),
  entry('BUILD-612', 'List key that is not a property path of its row',
    'The list has no provable key path (a computed value, an index, a call, the row itself, a foreign or reassigned binding, or no original core createList site), so the module cannot carry its rows\' identity in the key-path section; the build fails even without strict mode.',
    'Key the list with a property path of its own row parameter, `(row) => row.id` or `(row) => row.user.id` (the string-literal member `row[\'id\']` is admitted), with the key callback inline.'),
  entry('BUILD-613', 'List row without one stable owned root',
    'The row callback does not return exactly one stable Element (text, nothing, several roots, a conditional or control-flow root, or an authored `data-forma-key`), so the row identity has no root to live on; the build fails even without strict mode.',
    'Return one Element per row, `(row) => h(\'li\', …)` or `<li>…</li>` (a Fragment around exactly one Element, or a registered child rendering one, is admitted); put conditionals inside that root and leave `data-forma-key` to the compiler.'),
  entry('BUILD-614', 'Boolean in text',
    'A boolean-typed value is read into a text position (a declared boolean prop, a signal whose default is a boolean, a closed boolean, or an expression that can only be a boolean): the browser writes nothing for a boolean child whatever its value while the server would write "true" or "false" (value rule 6, docs/parity-rules.md); the build fails even without strict mode.',
    'Write `String(flag)` for the word (a non-optional declared boolean or a boolean signal), or render content with createShow or a ternary; `cond && \'text\'`, whose boolean result stands for nothing, stays valid.'),
  entry('BUILD-615', 'Condition that is not boolean-typed',
    'A createShow condition or a ternary test reads a value the compiler can prove is not a boolean (a number, a string, null, an object, or a declared, closed or signal value of such a type): the server would pick the branch by ECMAScript truthiness, which a page reading `count` or `name` only imitates (value rule 7, docs/parity-rules.md); the build fails even without strict mode.',
    'Compare explicitly so the condition is a boolean: `() => count() > 0`, `() => name() !== \'\'`, `() => item() !== null`, or `!!x` when truthiness is what is meant.'),

  entry('BUILD-616', 'List source that is not a function',
    'Core calls a list\'s source to read its rows, and this one is provably not a function (a literal, a binding to one, a provably immutable data-valued getter result, or a field its parameter type declares as data), so the page would fail in the browser with `items is not a function`; the build fails even without strict mode.',
    'Pass the getter itself or a function returning the rows: `createList(rows, …)` with `const [rows] = createSignal([...])`, `createList(() => p.rows, …)`; callable sources also need a declared array prop or a closed literal-default signal for native rows (BUILD-610).'),

  entry('BUILD-617', 'Registered option island outside its select value owner',
    'The native select value overrides option defaults across an independently registered SSR island, but that child receives no authenticated parent selection value; its own declared inputs cannot prove the selected state.',
    'Keep the option or optgroup helper unregistered inside the owning select island, or move the island boundary to the owning select or an outer element. A whole route may explicitly use ssr:false.'),

  entry('BUILD-618', 'HTML nesting outside the finite native subset',
    'The authored tree contains a listed parser-repaired nesting or interactive-content conflict, so parsed native HTML cannot preserve the authored ownership.',
    'Use explicit sibling elements, keep phrasing content inside p, place options inside select, and give interactive content and each labelled control their own valid host.'),
  entry('BUILD-619', 'Document title inside a component',
    'An HTML title emitted inside the component does not own the page document title.',
    'Pass the page title to the server render call; an SVG title remains component content.'),
  entry('BUILD-620', 'Dynamic child in executable text content',
    'A dynamic or reactive style child enters a CSS context that ordinary HTML escaping cannot make safe.',
    'Keep authored literal style text static; pass changing data through ordinary text, declared attributes, or the dedicated style APIs.'),
  entry('BUILD-621', 'SSR island without one stable owned Element',
    'The registered SSR component has text, empty, multiple, conditional/control-flow, async/generator, unresolved, or separately registered roots, so it cannot claim one stable Element containing its own ranges.',
    'Return one authored Element, directly or through an ordinary synchronous resolved helper or a transparent one-Element Fragment; put conditionals, lists and child islands inside that host.'),

  entry('BUILD-622', 'Indexed rows without matching eager native validation',
    'An indexed factory validates its initial keys eagerly, but a deferred, conditional, unused or unproved LIST cannot perform the same native validation. Optional or derived initial arrays, effectful key callbacks, eager handle or initial-data mutations and unknown escapes also lack a matching native contract.',
    'Use an original core createKeyedRows(requiredArray, row => row.id) with a required declared array or closed literal array, and an unconditional createList(rows, item => h(…)) in the same component return. Read item fields through item(); keep key callbacks as pure own-row property paths. Keep declared initial arrays and their ancestors unmodified and unescaped during construction. Mutate or expose them or the handle only in proved deferred intrinsic event callbacks, including immutable local handler aliases.'),

  entry('BUILD-623', 'Script element outside the bundle contract',
    'Core h() refuses script elements in every namespace and spelling; emitting one natively would bypass that bundle-only contract.',
    'Load executable code through the page bundle. Native component script elements, including literal, external and inert-type forms, are not supported.'),
  entry('BUILD-624', 'Raw srcdoc outside the native data contract',
    'Native props and FMIR string attributes cannot prove the reviewed trustedHtml brand required by core srcdoc; escaping a string does not establish that trust.',
    'Use a safe iframe src or an explicit Browser-mode trustedHtml sink. Literal null and false remain omitted attributes; other supported absence forms retain their existing behavior.'),

  // ── 7xx: constructs adoption does not handle (FORMA-016) ─────────────────
  entry('BUILD-701', 'Plain array child (`.map()` without createList)',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Render rows with createList(source, keyFn, (row) => h(…)), unroll a module-level const with ...CONST.map(…), ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-702', 'createErrorBoundary in a server-rendered component',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Move the boundary out of the server-rendered tree, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-703', 'createSwitch in a server-rendered component',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Use createShow for each case, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-704', 'createPortal in a server-rendered component',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Create the portal from an effect after activation, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-705', 'createSuspense in a server-rendered component',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    `Render the loaded state from server data, ${BROWSER_ONLY_WAY_OUT}.`),
  entry('BUILD-707', 'browserOnly() called inside the tree',
    "This unsupported native construct is reported at its source and ends the build with BUILD-610; no fallback island body is emitted.",
    'Declare `const X = browserOnly(Impl)` at the top level of a module, render `<X …/>`, and register X in activateIslands.'),

  // ── 8xx: the build package ───────────────────────────────────────────────
  entry('BUILD-801', 'SSR build without @getforma/compiler',
    'The build was asked for server-rendered modules but cannot load @getforma/compiler, so it stops before writing output.',
    'Install @getforma/compiler (a peer dependency of @getforma/build), or turn `ssr` off.'),
  // The preview frame's runtime (FORMA-175): `previewFrame: true` copies
  // the frame runtime of the core the bundles import as the manifest's
  // forma-runtime.js, which forma-server's PreviewFrame::load inlines by its
  // hash (FRAME-101 to FRAME-103). The build fails on each, strict mode or not.
  entry('BUILD-805', 'Preview frame runtime missing from @getforma/core',
    "`previewFrame` is on, and the @getforma/core the bundles import has no dist/formajs-frame.global.js (it ships from core 2.1.0), or no core is found: there is no runtime to copy, and forma-server would refuse to start the frame (FRAME-101).",
    'Install @getforma/core 2.1.0 or later where the bundles import it from, or turn `previewFrame` off.'),
  entry('BUILD-806', 'Preview frame runtime that cannot be inlined',
    "Core's dist/formajs-frame.global.js is empty, not UTF-8, or contains `</script`, `<!--`, a carriage return or a NUL: it is inlined as it is into the frame's `<script>` and allowed by its hash, so it would end early or not match its hash, and forma-server would refuse it (FRAME-103).",
    'Reinstall @getforma/core and leave the file as published: no editor, formatter, patch or CRLF checkout may rewrite it.'),
  entry('BUILD-807', 'Bundles that import more than one @getforma/core',
    "`previewFrame` is on, and the bundles import more than one @getforma/core, whose frame runtimes differ (entries from packages with their own cores, or a library bundling its own): the frame runs one runtime, so the build would have to pick the core it renders previews with, and the page could mount the module with another.",
    'Make every entry import one @getforma/core (one version in the workspace, `npm dedupe`, a library taking core as a peer dependency), or turn `previewFrame` off.'),
  entry('BUILD-808', 'Server functions were removed',
    'Forma builds browser code; a server function body must never ship as a browser implementation.',
    'Move server-side work to an authenticated Rust route and call that route from the browser.'),
  entry('BUILD-809', 'Package or renderer compatibility cannot be satisfied',
    'The installed compiler or resolved forma-server does not accept this writer, or the nearest Cargo.lock cannot establish one unambiguous renderer version.',
    'Use one compatible package set, upgrade the renderer first within its major, and fix the nearest Cargo.lock before rebuilding.'),
  // The raw-entry lint, forma-raw-lint (FORMA-126, SR8): reported by @getforma/build's
  // bin, never in a build's report. RAW_LINT_CATALOGUE in packages/build/src/raw-lint.ts
  // holds the same entries (packages/build/tests/raw-lint.test.ts keeps them equal).
  entry('BUILD-810', 'Raw entry not on the allowlist (forma-raw-lint)',
    "The source uses one of INV1's and INV2's exits (raw HTML, a typed raw home or a Trusted Types relaxation), and the allowlist names no owner and end date for it (SR8).",
    'Write it without the exit (render through a component, or the typed form the message names), or add an entry to forma-raw-allowlist.json with its path, line or symbol, exit, owner, until and reason.'),
  entry('BUILD-811', 'Allowlist entry past its end date (forma-raw-lint)',
    "The entry's until date has passed: the raw entry it lists was due to go, and its owner has neither removed nor renewed it.",
    'Remove the raw entry and its allowlist entry, or, with its owner, set a new until and say why in reason.'),
  entry('BUILD-812', 'Allowlist file the lint cannot use (forma-raw-lint)',
    'The allowlist cannot be read, is not version 1, or has an entry without a path, a known exit, one of line or symbol, an owner, a real until date at most a year after the run, or a reason; the lint does not guess what it meant.',
    'Correct the file: the message names the entry and the field.'),
  entry('BUILD-813', 'Allowlist entry that lists fewer uses than it says (forma-raw-lint; note)',
    'It matches fewer raw entries than its count, or none, so the inventory overstates and leaves room for unreviewed uses: one was removed, or moved to another line or symbol. A note: the run does not fail on it.',
    'Lower its count to the uses it lists, remove it if it lists none, or point its line or symbol at where the raw entry now is.',
    false),
  entry('BUILD-814', 'Source file the lint cannot read (forma-raw-lint)',
    'The file could not be read or parsed, so the raw entries in it cannot be counted; the lint fails rather than pass a file it did not see.',
    'Fix the syntax error the message names, or leave the file out with --exclude if it is not source.'),

  entry('BUILD-815', 'Application identity is missing or invalid',
    'Manifest 2 requires a named application. No explicit valid app or already-valid nearest Cargo package name was supplied.',
    'Set app to the same 1–63 character lowercase letter/digit/hyphen name passed to ServiceWorker::for_app.'),
  entry('BUILD-816', 'The build contains multiple physical copies of core',
    'Each physical copy has independent reactive state and Trusted Types initialization, even when the versions and runtime bytes match.',
    'Deduplicate core, declare it as a library peer, and make every entry resolve one physical package.',
    false),
  entry('BUILD-817', 'Manifest references an asset the build did not emit',
    'A declared SSR route has no compiled module, or a manifest reference has no corresponding output asset.',
    'Fix the compilation or route configuration before serving this build; a browser route must be explicitly declared.'),

  entry('BUILD-818', 'Worker metadata cannot authenticate an asset',
    'A protected immutable JS/CSS/WASM filename or its full canonical SHA-384 digest is invalid.',
    'Generate the worker from the completed manifest after final asset bytes are written; do not substitute a filename hash or abbreviated digest.'),
  entry('BUILD-819', "A route is over its size ceiling",
    "What the route loads cold is over the ceiling of its class (decision brief L-59, DR-35; gzip -9, 1 KB = 1,000 B, 1 KiB = 1,024 B): @getforma/core and alien-signals as bundled carry more than 28,000 B on a route with any JavaScript, all of the route's JavaScript (its scripts and the service worker it registers) is over 75 KiB, or over 365 KiB for a route declared `canvas: true`, or a route with no interactive region lists any script. Or a file the manifest names for the route was written by no bundling pass, so its Forma code cannot be attributed. The build fails before writing its output.",
    "Trim what the route imports from @getforma/core or ships of its own, split the route, or declare a page that hosts many modules a canvas; the ceilings are policy, not an option. The report above the failure shows each route's class, Forma code and JavaScript beside the ceilings."),
  entry('BUILD-820', 'The previous release for retention is not usable',
    "previousDist names something that is not the previous release's dist/: a path that does not exist or is not a directory, one with no readable manifest.json, another application's dist, a watch build's, one whose asset names are not flat file names, or a directory that is, holds or sits inside outputDir (which the build replaces whole).",
    "Pass the directory of the release that is live, kept apart from outputDir, or leave previousDist out for a first deploy. A dist built by an earlier schema retains nothing and says so; that is not this error."),
  entry('BUILD-821', 'A retained asset cannot be vouched for',
    "A file the previous manifest lists is missing from the previous dist, is not a regular file, or its bytes no longer match the SHA-384 the manifest recorded; or this build emitted a file of the same name with other bytes. The build will not copy bytes it cannot vouch for into a release browsers execute, and it fails before writing any output.",
    "Keep the whole release artifact unaltered, as the build wrote it, and pass that directory. If the previous dist was damaged, restore it from the artifact store, or build this release as a security release (security: true) to retain nothing."),
  entry('BUILD-822', 'FORMA_SECURITY_RELEASE is not a value the build understands',
    "The environment variable that marks a release as a security release (nothing is retained from the previous release) holds a value other than 1, true, 0, false or empty. Reading an unknown value as unmarked would retain a revoked build's assets in the release that exists to remove them, so the build refuses it.",
    "Set FORMA_SECURITY_RELEASE=1 (or true) for a release that fixes a vulnerability, or unset it."),


  entry('BUILD-823', 'Preview frame runtime that cannot be minified',
    "`previewFrame` is on, and esbuild cannot minify dist/formajs-frame.global.js of the @getforma/core the bundles import: a production build writes the frame's runtime minified (its bytes are on every preview document), so the file must be JavaScript esbuild can parse for ES2022.",
    'Reinstall @getforma/core and leave the file as published: no editor, formatter or patch may rewrite it.'),

  // ── 9xx: the compiler's own deprecated entry points ──────────────────────
]);

const BY_CODE: ReadonlyMap<string, DiagnosticEntry> = new Map(
  DIAGNOSTIC_CATALOGUE.map((e) => [e.code, e]),
);

/** The catalogue entry for a code. Throws on a code the catalogue lacks. */
export function diagnosticEntry(code: string): DiagnosticEntry {
  const found = BY_CODE.get(code);
  if (!found) throw new Error(`unknown diagnostic code ${code}`);
  return found;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** One link of a composition chain, from the page down (BUILD-403). */
export interface DiagnosticChainLink {
  /** The component's name where it is called (the page root first). */
  component: string;
  /** The file the call is in (for the root: the page component's file). */
  file: string;
  line: number;
  column: number;
}

/** One report, as a build gathers it. */
export interface Diagnostic {
  /** The stable code, e.g. `BUILD-101`. */
  code: string;
  /** The file to edit, as the compiler read it (absolute in a real build). */
  file: string;
  /** 1-based line in that file, as authored (JSX mapped back); 0 when unknown. */
  line: number;
  /** 1-based column; 0 when unknown. */
  column: number;
  /** The specific report: the construct, what happens, and its fix. */
  message: string;
  /** The catalogue's why for the code. */
  why: string;
  /** The catalogue's fix for the code. */
  fix: string;
  /** Whether `--strict` fails the build on it (false only for notes). */
  strict: boolean;
  /** BUILD-403: the composition chain, from the page down to the component refused. */
  chain?: DiagnosticChainLink[];
}

/** A Babel-style location: 1-based line, 0-based column. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Anything carrying a Babel `loc`. */
export interface Locatable {
  loc?: { start: SourcePosition } | null;
}

export interface ReportInput {
  code: string;
  /** The file the position is in. Empty when the caller has none (unit tests). */
  file: string;
  /** The node the report is about; its position is in `file`'s compiled text. */
  node?: Locatable | null;
  /** A position to use instead of a node's (1-based line, 0-based column). */
  position?: SourcePosition;
  /** The node/position already refers to original TypeScript, before JSX lowering. */
  original?: boolean;
  /**
   * The printed text after `IR: <code> `, given where to say it happened:
   * `file:line:column`, or `file` alone when the position is unknown.
   */
  text: (where: string) => string;
  chain?: DiagnosticChainLink[];
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

const collectors: Diagnostic[][] = [];

/**
 * Run `fn` and return what it returns together with every diagnostic reported
 * while it ran. Synchronous only: the compiler's walk is, and a module-level
 * stack is what lets the signal pass, the analyzer and the walker report into
 * one list without threading a sink through every signature. A report goes to
 * every open collection, so a nested one sees its own part and the outer one
 * sees everything.
 *
 * Reports still print their line as at compiler 0.3.6; collecting adds to it.
 */
export function collectDiagnostics<T>(fn: () => T): { result: T; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  collectors.push(diagnostics);
  try {
    return { result: fn(), diagnostics };
  } finally {
    collectors.pop();
  }
}

/**
 * Report one diagnostic: print its line, and add it to the open collector.
 * Returns it, located.
 */
export function reportDiagnostic(input: ReportInput): Diagnostic {
  // Never throw from a report: it runs inside the walk, where a throw would
  // change what is emitted. A test keeps every code in the source catalogued.
  const entryForCode = BY_CODE.get(input.code) ?? { why: '', fix: '', strict: true };
  const start = input.position ?? input.node?.loc?.start;
  const located = input.file && start ? (input.original ? { line: start.line, column: start.column + 1 } : originalPosition(input.file, start)) : null;
  const where = !input.file
    ? ''
    : located
      ? `${input.file}:${located.line}:${located.column}`
      : input.file;
  const message = input.text(where);

  // One line, as before, so a gate counting or matching these lines is
  // unaffected: the code after `IR:`, the position after the file.
  console.warn(`   IR: ${input.code} ${message}`);

  const diagnostic: Diagnostic = {
    code: input.code,
    file: input.file,
    line: located?.line ?? 0,
    column: located?.column ?? 0,
    message,
    why: entryForCode.why,
    fix: entryForCode.fix,
    strict: entryForCode.strict,
    ...(input.chain ? { chain: input.chain } : {}),
  };
  for (const collected of collectors) collected.push(diagnostic);
  return diagnostic;
}

/**
 * Make a diagnostic from a code and an already-located position, without
 * printing it: for a caller that prints its own line (`@getforma/build`).
 */
export function makeDiagnostic(
  code: string,
  file: string,
  line: number,
  column: number,
  message: string,
): Diagnostic {
  const e = diagnosticEntry(code);
  return { code, file, line, column, message, why: e.why, fix: e.fix, strict: e.strict };
}

/**
 * One diagnostic as a block of text for a failing `--strict` build:
 * `file:line:column  CODE  message`, then its why and fix.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file
    ? d.line > 0 ? `${d.file}:${d.line}:${d.column}` : d.file
    : '(no file)';
  return `${where}  ${d.code}  ${d.message}\n    why: ${d.why}\n    fix: ${d.fix}`;
}

// ---------------------------------------------------------------------------
// Positions in .tsx and .jsx files
// ---------------------------------------------------------------------------
//
// The walker reads a .tsx or .jsx file after esbuild has turned its JSX into
// h() calls, and esbuild reprints the whole file, so a node's line in that text
// is not the line the author wrote. The transform's source map takes it back.
// The map is kept per file as text and decoded only when a report needs it,
// so a build with no diagnostics pays for the map's generation alone.

interface StoredMap {
  mappings: string;
  decoded?: Array<Array<[number, number, number]>>;
}

const sourceMaps = new Map<string, StoredMap>();

/**
 * Remember the source map of `file`'s compiled text, so positions in that text
 * are reported where the author wrote them. A file read without a transform
 * forgets any earlier map.
 */
export function registerSourceMap(file: string, map: string | null | undefined): void {
  if (!map) {
    sourceMaps.delete(file);
    return;
  }
  try {
    const parsed = JSON.parse(map) as { mappings?: unknown };
    if (typeof parsed.mappings === 'string') {
      sourceMaps.set(file, { mappings: parsed.mappings });
      return;
    }
  } catch {
    // An unreadable map only costs exact positions.
  }
  sourceMaps.delete(file);
}

/**
 * The authored position (1-based line and column) of a position in `file`'s
 * compiled text (1-based line, 0-based column).
 * Verified by: packages/compiler/tests/diagnostics-conformance.test.ts > "maps a position in a .tsx file back to the line the author wrote"
 */
export function originalPosition(file: string, pos: SourcePosition): { line: number; column: number } {
  const stored = sourceMaps.get(file);
  if (!stored) return { line: pos.line, column: pos.column + 1 };
  stored.decoded ??= decodeMappings(stored.mappings);
  const segments = stored.decoded[pos.line - 1];
  if (!segments || segments.length === 0) return { line: pos.line, column: pos.column + 1 };
  // The last segment starting at or before the column; else the line's first.
  let best = segments[0]!;
  for (const segment of segments) {
    if (segment[0] > pos.column) break;
    best = segment;
  }
  return { line: best[1] + 1, column: best[2] + 1 };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Map<string, number>([...BASE64].map((c, i) => [c, i]));

/**
 * Decode a source map's `mappings` (version 3, base64 VLQ) into, per generated
 * line, `[generatedColumn, sourceLine, sourceColumn]` segments, all 0-based.
 * The transform maps one file to itself, so the source index is not kept.
 */
function decodeMappings(mappings: string): Array<Array<[number, number, number]>> {
  const lines: Array<Array<[number, number, number]>> = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const lineText of mappings.split(';')) {
    const segments: Array<[number, number, number]> = [];
    let generatedColumn = 0;
    for (const segmentText of lineText.split(',')) {
      if (!segmentText) continue;
      const fields = decodeVlq(segmentText);
      generatedColumn += fields[0] ?? 0;
      if (fields.length < 4) continue;
      sourceLine += fields[2]!;
      sourceColumn += fields[3]!;
      segments.push([generatedColumn, sourceLine, sourceColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) return values;
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
    value = 0;
    shift = 0;
  }
  return values;
}
