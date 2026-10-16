# Value-rule qualification

This internal lane compares the real Rust FMIR writer, fresh `h()` DOM and
strict owned adoption for the seven value rules in `docs/parity-rules.md`.
It also verifies that adoption retains every node and writes no DOM changes.
A deliberate native-output mismatch must be caught, and every case's own
MutationObserver must detect a deliberate control write after adoption. A
paired liveness control then updates a real signal: adopted text and an
attribute must update on the retained native nodes. The same check with
adoption disabled must fail, so unchanged native HTML alone cannot satisfy
the adoption gate.

Run from the repository root with Node 24, the Rust toolchain, npm dependencies
and Playwright browsers installed:

```sh
npm run build -w packages/core
CARGO_BUILD_JOBS=3 node e2e/value-rules/run.mjs --count 1000
CARGO_BUILD_JOBS=3 node e2e/value-rules/metadata.mjs
```

`--count` is the number of **admitted DOM comparisons per rule**, up to one
million. `--seed` defaults to `1820300`, `--batch` to `1000` (maximum `10000`),
`--engine` to `chromium` (`firefox` and `webkit` are also supported), and
`--output` to `e2e/value-rules/out/result.json`. The native executable is built
in release mode and processes bounded newline-framed batches in one persistent
process. Requests and responses are capped, one request is in flight, each
batch has a 30-second deadline, and EOF is used only to close the worker.
Real-process tests cover multiple requests before EOF, a silent worker and
malformed output. The browser is reused, each
case gets a fresh subtree, and both reactive roots are disposed per case.
No per-input browser launch or compiler invocation is involved.

One `(seed, rule, index)` always generates the same input, independently of
batch shape. Reports record the input digest, source commit, dirty state,
Node/engine, native and core artifact hashes, exact counts and elapsed time.
Failure records contain the complete typed input, seed, index, native output
and observations; preserve a disagreement as a shared regression before
changing production. Inputs are never automatically accepted as new goldens.
A rerun removes its earlier generated success/failure report before starting.

## Domains

- Rule 1 generates per-value strings including CR, CRLF, NUL, escapes,
  combining/astral characters and literal U+200B. The comparison removes a
  native empty-range placeholder only when its exact marker and original
  empty value identify it; authored U+200B remains significant.
- Rule 2 generates finite binary64 values from random bits and formatting
  boundaries, retaining decimal lexemes for exact Rust/JS parsing. The first
  pilot discovered the shortest-decimal tie at bits `c2eeb5cf467752d4`; its
  original replay is committed under the shared `parity/regressions` folder.
  The native formatter now uses [Ryū-js](https://github.com/boa-dev/ryu-js),
  which implements the ECMAScript decimal tie choice. Version 1.0.3 is pinned,
  supports Rust 1.71 and uses the existing allowed Apache-2.0 license option.
- Rule 3 retains exact i64/u64 origins as decimal strings through the real
  `PageProps` encoder. Unsafe origins must return `RENDER-401`. They are counted
  separately and **do not reduce the requested admitted comparison count**.
- Rule 4 retains exact signed nanosecond origins, constructs real `SystemTime`
  values and uses the real declared-props date encoder. Its wire value is
  checked against an independent BigInt truncation and the browser's Date
  range; refused origins must return `RENDER-403`, counted separately.
- Rule 5 exercises null/undefined with randomized surrounding values and
  attributes; native null is the corresponding absent wire value.
- Rule 6 exercises both booleans on ordinary/ARIA and HTML boolean attributes,
  with the admitted explicit `String(flag)` text form. Rule 7 exercises both
  boolean branches through real native `SHOW_IF` and client `createShow`.
  The campaign runs the actual compiler's date, bare-boolean-text and
  condition-typing tests first (including their accepted near misses), and
  saves their log and digest. It does not claim that unsupported source forms
  were admitted or that a million compiler subprocesses ran.

`metadata.mjs` produces complete native SSR and browser-shell documents from
the shared rule-1 vectors, then parses them in Chromium, Firefox and WebKit (`--engine chromium` selects
one engine for the per-merge lane).
The native tests additionally check opaque configuration JSON, nonce/CSP/SRI,
raw URL refusals and exact completed-document byte budgets. The frozen
namespace fixture is shared by the native reader, client unit suite and
`packages/core/e2e/adoption.spec.ts`; its intentional script reference still
requires client construction refusal. Namespace stacks and dynamic SVG-title
admission remain explicit 3.1 work under L-57.

## CI shape and timing

The first repaired pilot compared 68,872 admitted values and checked 1,128
origin refusals (70,000 generated inputs) in 9.622 seconds on the release Mac,
Node 24.22.0, Chromium, seed 1820300, batches of 1,000. This projected more
than sixteen minutes for seven million inputs before the strengthened
one-million-admitted count. The full campaign therefore uses the ticket's
explicit nightly fallback; the per-merge sample compares 1,000 admitted
values per rule. Exact final qualification counts/time belong in the result
artifact and the release record, rather than treating this projection as a
completed run. Full generated coverage is Chromium; finite metadata and
value/namespace vectors retain the three-engine gates.

The first full attempt on `6e834ffe` stopped after more than 650,000 successful
rule-1 comparisons when a per-batch native subprocess waited indefinitely for
stdin EOF. Its partial report remains `passed:false`; a process sample and
logs are preserved in the release work evidence. Independent review also
required the explicit adoption-liveness/no-op controls above. This partial
attempt is not a full qualification; the final harness requires a new run.
