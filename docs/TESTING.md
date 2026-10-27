# Testing policy — the whole Forma stack

**Status:** normative for the unified `getforma-dev/forma` workspace. The
examples retain their historical source names; current paths are under
`packages/`, `crates/` and `e2e/`.

**Where it came from:** every rule below is derived from a defect one of these
suites actually shipped — none of it is generic advice. The evidence is a
mutation-probe audit run on 2026-08-05 (42 hand-rolled probes plus a Stryker
run against `formajs`; 32 binary probes against `@getforma/compiler`, replayed
through the real Rust FMIR consumer). The audit itself, with the per-file
findings and the remediation plan it produced, is retained in [the historical audit](../packages/core/docs/TEST-SUITE-AUDIT.md).

**Why it is worth reading before you write a test.** At audit time the
`formajs` suite detected 69% of injected defects overall, 43% on
security-relevant code, and 17% on the SSR renderer — the one component whose
output goes straight into a browser. About 41 tests passed with the feature
they were named for deleted from production code. A test that cannot fail is
not merely useless: it converts a reviewer's suspicion into confidence at
exactly the moment they were deciding whether to look harder.

Examples below are quoted from the repos and are prefixed with the repo they
live in.

---

## The eight rules

### P1 — Assert the guarantee, not the mechanism

A spy count, a throw, or a markup shape is evidence *about* the implementation.
The guarantee is what the user observes. Pin the observation; leave the
mechanism free to change.

**Cost:** deleting the loop in `createSwitch` that scoops rendered nodes back
into the cached fragment — so the third visit to a branch renders *nothing* —
survived the entire suite. The cache test watches a counter and never re-reads
the DOM.

```ts
// BAD — formajs: src/dom/__tests__/switch.test.ts
setTab('b'); setTab('a');
expect(renderCount).toBe(1);   // the cache can return an EMPTY branch and pass

// GOOD — same file, "renders matching branch"
expect(getContent(container)).toBe('Home');
setTab('about');   expect(getContent(container)).toBe('About');
```

**Rule:** every `toHaveBeenCalled*` / `toThrow` / `not.toThrow` is followed, in
the same test, by an assertion on rendered output, a returned value, or
observable state. A bare `not.toThrow()` is not a test.

### P2 — Test constructs in COMBINATION, and on every sibling path

The rule that would have prevented the most bugs. Two individually correct
constructs can be jointly wrong, and a guarantee asserted on one path is not
asserted on its sibling.

**Cost:** 7 of the 25 real code defects found this week, including the only
non-documentation Critical. `formajs` has four renderers that must uphold the
same guarantees — client `src/dom/element.ts`,
hydration adoption `src/dom/hydrate.ts`, and the HTML runtime's `data-*`
binder — and URL-scheme blocking was asserted on exactly one of them, so
`h('a', { href: 'javascript:alert(1)' })` emitted the attribute verbatim with a
green suite. The same shape was live in the compiler: slot-name uniqueness was
asserted only inside the `list:` / `show:` describes, so a page with two
dynamic attributes of the same key minted duplicate slot names, the real Rust
consumer of the time (`forma-ir` 0.1.x, which kept the last; 0.2.0 keeps the
first, see ARCHITECTURE.md §3.2) collapsed them, and all 239 compiler tests
stayed green.

```ts
// GOOD — one vector table, run against ALL sinks
describe.each([
  ['ssr',       (p) => renderToString(sh('a', p))],
  ['h',         (p) => h('a', p).outerHTML],
  ['adopt',     (p) => adoptAndSerialize('a', p)],
  ['data-bind', (p) => mountBindAndSerialize('a', p)],
])('url scheme guard: %s', (_name, render) => {
  it.each(DANGEROUS_URLS)('%s is not emitted', (url) => {
    expect(render({ href: url, id: 'ok' })).not.toMatch(/script:/i);
    expect(render({ href: url, id: 'ok' })).toContain('id="ok"');  // see P3
  });
});
```

**Rule:** when N code paths must uphold one guarantee, the assertion lives in
**one shared table** parameterised over the paths — never copied into one
path's file. A new sink, renderer or branch joins the table or the PR is
rejected. A feature is not covered until at least one fixture combines two
constructs (list + dynamic attribute, island + island, show + dynamic text).

### P3 — Two-sided assertions: absence AND presence

`not.toContain('javascript:')` is satisfied by a renderer that emits no
attributes at all.

**Cost:** a probe that made `renderToBufferHydrated` drop *every* prop survived
the whole suite, including all four "blocks …" tests.

```ts
// BAD
expect(renderToString(sh('img', { src: 'javascript:alert(1)' }))).not.toContain('javascript:');

// GOOD — dangerous gone AND benign intact, exact output
expect(renderToString(sh('a', { href: 'javascript:alert(1)', id: 'ok', title: 'safe' })))
  .toBe('<a id="ok" title="safe">…</a>');
```

**Rule:** every "we block X" test renders X alongside a benign sibling and
asserts both halves. Prefer exact-output `toBe` over fragment `toContain` for
anything that produces markup.

### P4 — Depth floors

A single transition cannot observe a cache that poisons on the second, and a
3-item list cannot reach a 32-item algorithm.

**Cost:** 691 of 1003 audited test bodies (68.9%) drove zero state transitions;
42 (4.2%) drove three or more. The entire LIS keyed-move algorithm in
`formajs: src/dom/list.ts` — the performance core of a no-virtual-DOM library —
executed zero times in the suite, and four separate mutations of it survived.

Floors, non-negotiable for new tests:

- **State machines** (show / switch / portal / hydrate branches): **≥ 3
  transitions**, asserting the invariant after *every* transition.
- **Lists**: ≥ 2 items for every behaviour, and ≥ 40 items for every algorithm
  branch (`SMALL_LIST_THRESHOLD` is 32 — exercise both sides, ideally by
  parameterising the threshold).
- **Islands**: ≥ 2 instances on the page; cross-island isolation is invisible
  with one.
- **Recursive parsers / strippers**: a fixture at depth ≥ 10 000. A recursive
  walk that is fine at depth 2 throws `RangeError` at 30 000.
- **Branch fixtures must be distinguishable.** A ternary whose two branches
  encode to the same byte length cannot detect a swap of the two length fields
  (a real compiler probe that survived every test *and* the byte-exact
  snapshot); a `createShow` whose branches both render the text "Truthy" cannot
  detect a mislabelled cached fragment.

### P5 — Adversarial input is mandatory for anything parsing untrusted data

If a function accepts JSON, a URL, an attribute value, an HTML string or an RPC
body, its test file **must** carry hostile fixtures. "Happy path plus a
malformed string" is not adversarial.

**Cost:** `setState(JSON.parse('{"__proto__":{"isAdmin":true}}'))` forged
`state.isAdmin === true`; swapping `setText` to `innerHTML` turned a function
documented "safe for user-controlled strings" into an XSS sink on a file
reporting **100% line coverage**; deleting `.replace(/</g,'&lt;')` from
`escapeHtml` shipped a live `<script>` with every test green.

Two corollaries that catch the misses:

- **Negative space counts.** Every blocklist needs an allow-list test.
  `DANGEROUS_SCHEME_RE` is anchored with `^`; removing the anchor makes it a
  substring match and no test notices, because every case feeds a URL that
  *should* be blocked. `https://example.com/guides/javascript` must be asserted
  to pass.
- **Allowlists are tested for completeness, not contents.** `URL_ATTRS` has
  seven entries and only `href` and `src` were exercised, so deleting
  `'action'`, `'poster'` or `'background'` was invisible. Use
  `describe.each(URL_ATTRS)`, never hand-picked members.

### P6 — A test must be able to fail

If deleting the feature does not turn the test red, it is not a test.

**Cost:** two `formajs` files named for hardening controls that `SECURITY.md`
cites — `runtime-blocklist.test.ts` (10 tests) and `runtime-parsestate.test.ts`
(8 tests) — were entirely in this class. The first imported nothing from
production code and re-implemented the function it claimed to test; the second
never called `parseState` at all, and all 8 tests passed with it throwing
unconditionally. Both files were deleted in the remediation pass — do not go
looking for them, and do not write their replacement.

Three more shapes that cannot fail, treated the same way:

- **No `expect()` in the body.** Three hydration tests called `adoptNode(...)`
  under a `// Should not throw` comment and asserted nothing; one of them
  *stated* the expected outcome in a trailing comment without asserting it.
- **True by construction.** `expect(forma.somethingNeverExported).toBeUndefined()`
  passes with any typo and can only fail if someone *adds* the export, while
  silently dropping a real export goes unnoticed.
  `expect(Object.keys(forma).sort()).toEqual(EXPECTED)` catches both directions.
- **Reading a mock's own configuration back.** Asserting that the value your
  spy was told to return is the value you got tests the spy.

### P7 — No self-skipping tests, ever

A test that returns early and reports green is a lie told once per CI run.

**Cost:** the two tests carrying the only end-to-end assertions on a real
compiler-emitted binary resolved their fixture to a path five levels above the
repo that does not exist. 28 `expect()` calls — 53% of that file's assertions —
had never executed, and CI was green.

```ts
// BAD
if (!fs.existsSync(irPath)) { console.warn('Skipping: …'); return; }  // reports PASSED

// GOOD — fixture is in-repo and unconditional…
const bin = walkHTree(loadFixture('ternary-asymmetric.tsx'));
// …or its absence is a hard failure
expect(fs.existsSync(irPath)).toBe(true);
```

**Rule:** no `existsSync` guard, no `it.skip`, no environment sniffing that
returns early. Fixtures live in the repo. A check that genuinely needs a build
artifact is a separate CI job that fails loudly when the artifact is missing —
which is how `create-forma-app`'s scaffold E2E is wired (`FORMA_SCAFFOLD_E2E=1`,
run as its own CI job and again before `npm publish`), rather than a silent
skip inside the unit suite.

### P8 — Mock almost nothing; never mock the thing under test

Legitimate to mock: browser APIs the test DOM does not implement
(`ResizeObserver`, `IntersectionObserver`), the network boundary, the clock,
and cross-process boundaries. Even then, assert the *effect*, not the mock's
arguments.

Never mock the module under test, the parser under test, the escaper under
test, or the loader under test. If a function is private and that pushes you
toward simulating it, **export it** — both functions that got a fake test in
this audit were private.

```ts
// BAD
expect(FakeIO).toHaveBeenCalledWith(expect.anything(), { rootMargin: '200px' });

// GOOD — same fake, real guarantee
fakeObserver.fire([{ isIntersecting: true, target: islandEl }]);
expect(islandEl.dataset.formaStatus).toBe('active');
expect(islandEl.textContent).toBe('hydrated content');
```

**Corollary — test the shipped configuration.** The audit found the suite
running a build variant that ships to nobody: the bundler defined five
`__FORMA_UNSAFE_EVAL_MODE__` values, the test config defined none, and every
eval-touching test called `setUnsafeEval(false)` in `beforeEach` — normalising
away the exact variable the headline security claim was about. That is how a
shipped default of *unsafe-eval enabled* coexisted with four documents claiming
the opposite. Fixtures may not neutralise the value under test; at least one
test must observe the boot-time default with no setter called.

---

## The comment-citation contract

Security-relevant code in this stack carries citations in this exact form:

```rust
// in forma
// Verified by: crates/forma-ir/tests/list_scaling.rs > "list_walk_allocations_are_linear_in_row_count"
```

```ts
// in formajs
// Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops exactly what the SSR renderer drops, so hydration cannot re-add it"
```

The path is relative to the repo the comment lives in; the quoted string is the
test name exactly as it is declared. (Both examples above are real citations in
their own repos — quoted here across a repo boundary, which is why each carries
a `// in <repo>` line.) The convention is load-bearing, and therefore
dangerous.

**A citation is honest only if the cited test would actually fail when the
asserted property breaks.** Nothing else counts — not "the test is in the right
file", not "the test name matches the property", and emphatically not "the line
is covered". A file in this repo group reported 100% statements / branches /
functions / lines while its `setText` could be swapped to `innerHTML` with the
suite green.

**How to check one — the mutation probe. This is the whole contract:**

1. Break the cited property in production code with the smallest possible edit
   (delete the guard, invert the condition, drop the escape, return early).
2. Run **only the cited test**.
3. It must fail. If it passes, the citation is false: delete it or fix the
   test, in the same PR.
4. Revert, confirm the working tree is clean, confirm the suite is green again.

About 90 seconds per citation. It is a review step, not a project.

Rules for citations:

- Cite a test **name**, never a line number. Line numbers rot within a week.
- One citation, one property. `Verified by: X` on a five-property function is
  unverifiable by construction.
- For a table (`it.each`), cite the table and the row's parameter:
  `> "url scheme guard: h > javascript:alert(1) is not emitted"`.
- A comment asserting a defence the code does not provide is the same defect
  class as a false citation. Two `untrack()` wrappers in `formajs` carried
  prominent comments claiming they stopped a parent effect from disposing
  children; `createRoot` already clears the active subscriber, so both were
  verified no-ops. Delete the code and the comment, or keep it and add the test
  that pins the contract.
- **A citation pointing at a test that cannot fail is strictly worse than no
  citation.** No comment leaves a reader appropriately suspicious.

---

## The reviewer's checklist

Eight blocking questions. If the answer to any of them is wrong, the PR does
not merge.

1. Does every `toHaveBeenCalled*` / `toThrow` in this diff have an
   observable-outcome assertion after it?
2. Does this guarantee exist on a sibling path (SSR / `h()` / hydrate /
   `data-bind`; parser / walker)? If so, is the assertion in the shared
   table rather than one path's file?
3. Does the "we block X" test also assert that a benign sibling survives?
4. Depth floors met — state machine ≥ 3 transitions, list ≥ 2 items *and* a
   ≥ 40-item case, islands ≥ 2 instances, recursive parser ≥ 10 000 deep?
5. Are the fixture's branches and values **distinguishable** — could a swap of
   two of them still pass?
6. Does this parse untrusted input? Then where are the hostile keys, the
   allow-list (negative-space) cases, and the completeness test over the
   allowlist?
7. **Did you break the feature and watch this test go red?** State the mutation
   in the PR description, one line: `Probe: deleted the isDangerousUrl call in
   renderAttr → 5 tests failed.`
8. Any `existsSync` guard, `it.skip`, or test with no `expect()`? Any new
   `vi.mock` of a first-party module? Justify or remove.

Plus: a `Verified by:` comment requires the probe from item 7 **against that
specific test**, or it does not go in.

---

## Enforcement — what runs today, and what is proposed

Current source is [the integrated check](../scripts/check.sh),
[CI](../.github/workflows/ci.yml), [engine checks](../.github/workflows/e2e-engines.yml),
[native security probes](../.github/workflows/security-probes.yml) and
[nightly probes](../.github/workflows/nightly-probes.yml). Historical audit
percentages above are not current coverage or mutation results.

`npm run check` uses one [stage catalogue](../scripts/check-stages.sh). On Linux,
an explicitly reviewed [resource inventory](../scripts/check-scheduler-inputs.json)
first admits independent npm installation/auditing/builds and one Cargo lane
with three build jobs. The Cargo lane runs formatting, clippy, the old-renderer
compatibility control and documentation generation. Both producers, logs and
owned descendants must join before the workspace/server runtime test suites.
A fresh one-use receipt binds that invocation's source and complete output bytes
before its parent shell can reuse the five successful npm builds. It cannot
authorize a later invocation or provide an exported build-skip flag.

The later two lanes contain Node/unit work and browser work with at most two
workers. Core correctness files use isolated threads with the original worker
count; timing/heap files keep their original pool and run individually after
the join. The hostile matrix has at most two active profiles, each with its own
context, origins and request journal; cases within each profile remain sequential.
No Cargo work overlaps these two lanes. Their complete logs and owned cleanup
must join before later work starts. Source inputs are sealed across both phases;
shared built products are also sealed across the later test phase.

Closed package/repository config discovery includes new local config helpers;
external ancestor tsup/TypeScript configuration refuses overlap. Caller-selected
fixture roots, scaffold executables/context/templates/report paths, emitter paths and browser
channels also use complete serial because they change reviewed inputs or writers.
Node module/preload, Bash startup and Linux preload overrides also refuse overlap;
admission records their presence, not their values.
New or changed tests, helpers, configuration or dependencies do not silently join
an overlapping lane. Before work begins, unreviewed inputs produce a visible
reason and select the **complete serial schedule**. Mac and the existing heavy
scaffold, list-key evidence and custom Cargo-target contexts also stay serial.
Linux with fewer than four available CPUs stays serial to preserve its original
browser-worker default.
Update the resource and complete-file classification only after reviewing its
process/resource effects; normal check never refreshes these hashes. The live release-gate
record and narrative documents outside execution-fixture roots do not assign
resources and are outside admission; their exact tracked bytes remain in the
per-run seal. Package versions and locks remain exact reviewed inputs. The
manifest contains complete RC4 and prospective 3.2.0 snapshots: one coordinated
version selects the whole snapshot, never independent hashes per file. Only the
27 precomputed `release-set.versionFiles` paths differ; mixed graphs, unknown
versions or any other changed input select full serial. This prepares the
version-only final transition without changing the scheduler after its soak. A changed
input, failed command, lost log or incomplete cleanup after work starts fails
that invocation instead of retrying it serially.

Every run prints its fresh external `forma-r17-*` evidence directory. CI retains
admission/plan identities, both phases' complete worker logs and cleanup, the
consumed build receipt, hidden browser result files and native-success evidence
alongside the existing reports. A successful
local or single hosted run does not establish N7: its fresh 20-command campaign
must time this normal entrypoint and retain the admitted mode and every original
outcome, without mixing serial fallbacks or replacing failed observations.

| Gate | Current owner |
|---|---|
| Workspace builds, unit tests, core/router types and packaging | `npm run check` builds/tests all five npm source packages and the three Rust crates. Published 3.0/3.1 records retain their original four-npm-package scope. |
| Optional native navigation | The integrated native fixture runs Chromium and the pinned paired size gate; engine qualification repeats it in Firefox/WebKit. Packed P17 additionally runs the native-router starter against candidate archives. |
| Compiler/native FMIR contract and typed props | The integrated command regenerates the compiler corpus, checks the native fixtures and runs reader tests. |
| Native/browser parity and values | Blocking parity and generated value-rule checks run against actual compiler, native walker and browser products. |
| Size and native list-cost regressions | Core's import-graph size gates and native list-scaling tests remain distinct from application/browser performance. |
| Browser interaction and serial indexed-update timing | Integrated Chromium lanes; additional engine/parity jobs cover Firefox/WebKit under their workflow triggers. |
| Linux/Windows, Node compatibility, 32-bit, MSRV and release builds | Separate jobs in the same CI workflow, alongside the integrated command. |
| Scaffolder integration | Packed-candidate and published-CLI jobs run on Linux and Windows. Published checks require registry availability; candidate qualification is independent. |
| Expression and mutation controls | Integrated probe-anchor/expression checks, nightly core mutation campaign and path-triggered native security mutations. Each has its own asserted result and refusal rules. |

The core coverage command remains available to contributors; availability is not
proof that a coverage report or a threshold runs in every CI job. See the
[release summary](release/V3-AS-BUILT.md) for source-bound campaign results.

**Historical audit proposals** (not a statement of current implementation):

The list below preserves the original suggestions. The targeted mutation
workflows above now exist; a general diff-scoped mutation-coverage policy or
every proposed lint is not implied by them.

1. **No-assertion lint** — fail any `it()` body containing zero `expect(`.
2. **Self-skip lint** — fail on `existsSync(…) { … return }`, `it.skip`,
   `describe.skip`, and early `return` inside a test body.
3. **Production-import lint** — fail any file under `__tests__/` whose only
   import is the test framework. Five lines; highest value per line in this
   document.
4. **Tautology lint** — fail a test file where more than 70% of `expect()`
   calls share an identical assertion expression.
5. **Per-file coverage floors**, not per-repo: a 5.88% file is invisible in a
   repo-wide number.
6. **Diff-scoped mutation testing** per PR (break at 80% for changed files, 95%
   for security paths), with a full run nightly on a ratchet. The cheaper
   substitute, and the one that compounds: commit the hand-rolled probe corpus
   (42 `formajs` + 32 compiler probes, each already a single surgical edit) as
   `probes/*.patch` plus a runner that applies each patch, runs the scoped
   suite, asserts it fails, and reverts. Every probe written during a future
   bug investigation joins the corpus.

---

## Where to go next

- [`ARCHITECTURE-3.0.md`](ARCHITECTURE-3.0.md) — what the stack is and why it is shaped
  this way. Read this first if you are new.
- [`FMIR-FORMAT.md`](FMIR-FORMAT.md) — the binary layout and its stability
  contract, i.e. the thing the cross-implementation test is defending.
- [the historical test-suite audit](../packages/core/docs/TEST-SUITE-AUDIT.md) — the full audit: per-file findings, the
  probe results behind every number above, and the remediation plan recorded at that time.
