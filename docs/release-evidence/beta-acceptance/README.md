# Recovered beta acceptance evidence

**Not a beta acceptance pass. The public decoder's 12 ms gate still fails.**
This record retains the first failures and subsequent explained measurements.
It does not change a performance bound or mark FORMA-103/104/105/184 complete.

The isolated branch starts at combined PR #92 commit
`eac901e2c076b7c405b721bdd314284274f1caa2`. Commands used Node 24.22.0,
Cargo build jobs 3, Vitest workers 2 and Playwright workers 2. Performance
measurements held the team's exclusive test/build lane. Product/hash manifests
refer to the preserved `work/FORMA-beta-acceptance/tmp/` artifacts; generated
JavaScript and native binaries are not duplicated in this evidence directory.
`SHA256.json` authenticates the copied raw records byte-for-byte.

## Public decoder: failed requirement

The producer invokes the packed public `activateIslands(registry)` and ends at
the first instruction of the registered component. Compiler-bound registration
is outside the measured interval; state decoding/projection remains inside.
Each shape uses a fresh document, strict Trusted Types, Chromium at 4x CPU,
five warmups and forty measured samples. Both shapes are exactly 1 MiB encoded:
an ASCII string and an array of 20,000 multibyte strings. Every measured sample
must be at most 12 ms. The report records all samples before applying the gate,
plus actual over-limit and truncated-input refusals, output hashes, zero-write
controls and exact compiler/runtime artifact hashes. The dedicated compiler
regeneration control runs only after package build.

The initial ASCII-only array run is preserved as historical producer evidence;
it does **not** satisfy the multibyte-array requirement. All following required
multibyte trials failed. Values below are array median / p95 / maximum in ms;
raw records retain both shapes, every warmup/sample and outlier.

| Trial | Before | After | Disposition |
| --- | --- | --- | --- |
| First required multibyte trial | 12.3 / 13.6 / 15.2 | — | Failed original acceptance measurement |
| Primitive leaf projection | 12.1 / 13.6 / 14.0 | 11.0 / 12.4 / 19.7 | Semantics reviewed; gate failed |
| Private output preallocation | 11.6 / 12.8 / 18.7 | 11.2 / 12.2 / 17.8 | Semantics reviewed; gate failed |
| UTF-8 counter experiment | 11.2 / 12.3 / 17.8 | 13.2 / 14.8 / 20.3 | Rejected; all forty candidate array samples exceeded 12 ms |

The UTF-8 experiment's full-loop and ASCII-scan microdiagnostics are explicitly
**not** public decoder acceptance. Their raw outliers remain intact. The public
trial contradicted the microdiagnostic's allocation hypothesis. Commit
`d945f062` restores production `island-state.ts` byte-for-byte to reviewed
`e3d04502`; the thirteen Unicode/boundary correctness controls are retained.
No identical acceptance retry or further decoder optimization is claimed.

## Functional evidence recovered

- FORMA-103: the actual public typed Rust PageHandle accepts exactly 1 MiB of
  escaped state, round-trips it, refuses one additional byte with RENDER-502 and
  the actual route/component, and recovers the original bytes. The finite test
  passed; it does not close the failed decoder performance requirement.
- FORMA-104: the compiled seven-input fixture passed all 42 three-engine cases,
  covering browser normalization, early edits, selection/focus, untouched
  adoption, subsequent updates and a functioning mutation observer. The
  healthy-sibling control asserts the current FORMA_E_MOUNT_SSR refusal and
  zero page-component calls before separately testing island refusal/activation.
  Its corrected three-engine replay passed. The actual typed conditional
  element fixture passed, including disposal of retired listeners.
- FORMA-105: 62 compiler identity/wire/product checks and 111 core
  state/identity/public-export controls passed. This does not substitute for
  final integrated packed qualification.
- FORMA-184: five internal parity-helper controls passed against actual native
  and browser output, including caller ownership and altered-attribute control.
  The helper remains internal.
- Attribute aliases: the original typed conditional fixture exposed the
  className/native discrepancy. Exact className/htmlFor/tabIndex normalization
  and compiler duplicate-name refusal were independently reviewed. Six actual
  alias/conditional cases passed across three browsers after coherent local
  compiler/build resolution. Original source and changed IR identities are
  archived separately in `docs/archive/attribute-alias-transition/`.

The full package gate at experimental commit `a9f202fd` passed 1,581 compiler
and 3,306 core tests, source typechecks, all 42 core artifact guards and all five
package size caps. That result is recorded at its actual source; it is not a
claim that a later changed head has run the entire gate. Final focused/full
qualification and CI are recorded separately when completed.

## First foreign-attribute failure

`first-svg-case/` preserves the original actual typed source, build/runner,
raw three-engine observations and the original 21-file product manifest.
Native SVG `TabIndex` and `data-Foo` become `tabindex` and `data-foo` during HTML
parsing, then both islands refuse with FORMA_E_HYDRATE_VALUE and have no live
listener. The explicit Browser route preserves the source spellings and both
update from 1 to 2. The canonical tabIndex/className/viewBox sibling works in
both modes. There were no page exceptions or CSP reports. This is a confirmed
compiler-admission defect; its corrective qualification is separate from this
immutable first failure.

## Corrected foreign attribute qualification

Reviewed source `e9118e8c323befd94e8bd3537b7baa5f684024e3` passed the actual
17-case typed native/Browser build and all twelve alias/conditional/foreign
browser cases across Chromium, Firefox and WebKit (6.4 seconds, two workers).
The canonical SVG/MathML/XLink fixture retains native nodes without writes,
updates later, preserves actual attribute namespaces, and records no errors or
CSP reports in either mode. The MathML annotation-to-SVG dispatcher case is
covered with a declared XML encoding. The original failing source now refuses
BUILD-610 through both the candidate compiler and build pipeline; its explicit
Browser counterpart remains live in all three engines. An initial auxiliary
runner lacked its local core package link; that resolution failure is retained
separately from the successful correctly linked control.

The non-ASCII name control rendered successfully with the unsafe name omitted
by the existing native ASCII filter (`<svg>`). It was **not** a coded whole-page
refusal, and the new lexical proof does not widen the filter. The mock compiler
spelling near miss must not be used as evidence that native non-ASCII names are
admitted.

`corrected-foreign/qualified-products.json` records 48 actual source/product
file hashes. The restored runtime is byte-identical to the last public decoder
encoder baseline (`f59711d6…`); the compiler correction does not change that
failed performance result. Restored-encoder focused tests passed 101/101,
source typechecking and all five package caps passed. Original compiler
before/after failures, the independent review's annotation special-case
controls, and their corrected results remain in this directory.

The final corrected compiler suite passed **1,684/1,684** tests across 70 files
(13.58 seconds). Source through e911 was independently approved before the
actual product qualification. The subsequent test-comment correction accurately
names native filtering/omission and changes no executable behavior.

PR #93 separately consumes the decoder producer and primitive-array leaf
optimization authored in this branch. The two drafts deliberately retain their
own evidence. Integration must reconcile those overlapping changes before
qualifying a coherent packed candidate; this record does not imply that #93's
startup/performance acceptance or this decoder gate has passed.
