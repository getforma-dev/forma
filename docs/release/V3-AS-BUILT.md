# Forma 3.0 — v3 as-built system design record

Recorded 2026-10-17 under founder L-66-QUOTA. This concise record describes **published beta.4 and the qualified e75eeaaa RC candidate**. It does not certify 3.0.0 final: no RC/final tag or final publication exists at this checkpoint. It preserves v1/v2 unchanged. Final publication, deferred verification and independent record acceptance must be appended when they actually occur.

## Implemented architecture

Forma consists of four coordinated npm packages (`@getforma/core`, `@getforma/compiler`, `@getforma/build`, `create-forma-app`) and three Rust crates (`forma-ir`, `forma-ir-derive`, `forma-server`). TypeScript authoring is compiled into a checked native-renderable subset and FMIR v3. Rust renders declared page data; the browser activates a literal registry of client islands and adopts compatible server DOM. Unsupported constructs produce coded compiler diagnostics or require an explicit client rendering boundary. Server functions, the WASM walker and Node rendering are removed from this release architecture.

Declared data and schema-bound state blocks link compiler output, native rendering and browser setup. JSON decoding retains pollution-key stripping and schema validation. Adoption preserves initial DOM, uses keyed list identity and coded mismatch handling, and owns reactive cleanup. Cooperative activation yields between batches of islands to keep the main thread responsive; it does not preempt an arbitrarily expensive individual island. The former startup exception is superseded by measured yielding behavior in the accepted campaigns.

The native response boundary carries HTML and its headers together. Contextual escaping, constrained expression evaluation, CSP, Trusted Types, digest verification, worker integrity and deployment identity checks cover distinct trust boundaries. Stale or incompatible deployment state becomes inert or reloads according to the tested skew protocol. Prior asset retention supports checked upgrades. These controls and their finite hostile/mutation corpora do not establish universal security or consumer production behavior.

Minimal and dashboard scaffolds, three internal fixture applications, parity cases and packed installation tests exercise the same published package set. Release publication uses GitHub Actions OIDC trusted publishing, coordinated versions and immutable tags. No personal publishing tokens or application migrations are part of this work.

## Exact qualified state

| Item | Evidence and result |
|---|---|
| Published beta.4 | Main `be8beb7d0a9291944f29881d8eb63712a68bd922`; Release 39046246527; all seven registry archives verified against the packed artifacts. |
| beta.4 packed verification | 61/61 checks; 1165.054 s; all 40 mobile traces and 40 independent observer lists contain zero long tasks. |
| RC packed candidate | `e75eeaaa35c98370146c4df81e7a0a4e6bec89ad`; run 39049587766; 61/61 in 1224.085 s; all 40 mobile traces/observers clear; ownership cleanup complete. |
| Decoder on RC | Demanding 1 MiB tree p95 20.9 ms, max 23.8 ms; ASCII p95 9.2 ms. Section 8.3's raw JSON.parse estimate is not an end-to-end security-decoder ceiling. |
| Route budgets | Counter SSR 26,208 gzip bytes; indexed SSR 28,046 bytes, below the approved 28,100-byte ceiling. These are separate routes. |
| Indexed update / suite timing | Run 39043878960 on e75: 20/20 complete runs pass; command p95 570.93 s, max 573.99 s. Mean complete-update cost uses all 101 samples per size, keeps 10% scaling and sampled 16 ms guards. |
| Mutation campaign | Run 39004991447 on source 0967: 249 killed + three predeclared equivalents, zero survivors; reviewed unchanged-input applicability, not a rerun on the latest docs/helper composition. |
| SR14 probes | Run 39043883979: six clean/mutant/restored triples passed. |
| Latest source composition | `72179d43587ffb5f837d4d3282ba95df3ce63bf4`: reviewed DAG overlap, bounded inventory visibility, six helper tests, evidence closure and P17/outer-clock documentation correction. Independent source approval and 319/319 local helpers; fresh combined timing, CI acceptance and whole-release sign-off pending. |

The overlap permits packed verification to run alongside engine checks; publication still depends on both. The visibility repair adds bounded retries only after an acknowledged release write when its inventory entry is absent. Transport, malformed history and identity errors still fail. Neither fix is claimed to have improved measured release duration yet. Actual beta.4 outer elapsed 2461.377 s missed the 1800 s target even though its distinct P17 clock passed. One record-only retry completed beta publication; original failed evidence remains preserved.

## Decisions, limits and deferred verification

- L-60 defers the separate agent identity, new founder-only protection rollout and external alert service. Existing review, CI, tag and trusted publishing controls remain.
- L-61 separates the descriptive raw-parse estimate from measured complete decoding with security invariants. Recorded p95 is source/environment-specific, not a universal physical guarantee.
- L-67 adopts per-run mean complete indexed-update cost prospectively. Raw tails stay recorded; intermittent relative spikes may pass. Historical failed runs are not relabeled.
- Existing L-66 concerns trace attribution. **L-66-QUOTA (2026-10-17)** is a separately named founder directive to pause now and defer work; it does not overwrite attribution history.
- Founder now defers L-62's full 3600-second active zero-fault burn-in to Thursday as post-release verification. Credited time is **zero**. Current release validators still enforce the previous pre-final evidence chain; implementing the policy transition remains work, not a passed gate.
- L-65 final clean-room acceptance of the composed docs/helper tree is deferred. Interim review found a clock-documentation issue corrected in source; no final audit acceptance is asserted.
- FORMA-207 remains unresolved: the original 99.342 ms Chrome Reading Mode task did not recur in bounded captures or later campaigns. Nonrecurrence does not prove its cause or universal safety. Monitor paused.
- FORMA-192, FORMA-147 and Appendix E external consumer migrations remain outside scope. Field device behavior, application operational results and future six-month support delivery are not established by these lab tests.

## Handoff and halt

The authoritative operational checklist is [Tickets/THURSDAY-BACKLOG.md](https://github.com/getforma-dev/forma/blob/forma-3-rc1-preparation/Tickets/THURSDAY-BACKLOG.md); local copy is `~/dev/Forma/Tickets/THURSDAY-BACKLOG.md`. It records exact evidence paths, stopped workers, guarded founder commands and the validator gap. No false audit/burn-in artifact may substitute for deferred work. Ordinary green main CI alone does not authorize the current final publisher.

This Markdown snapshot is committed now at the founder's request. PDF/HTML/DOCX rendering and post-final archival reconciliation are deferred; no rendered delivery or final publication is claimed. On an explicit resumption, finish the release-policy implementation or original evidence chain, publish through trusted Actions, verify all seven final packages, and append actual final facts. Halt before any consumer migration.
