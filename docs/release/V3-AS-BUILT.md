# Forma 3.0 as built

Forma **3.0.0 was published on 2026-10-20 at 04:09:01 UTC**, from
[`2006423b`](https://github.com/getforma-dev/forma/commit/2006423b21fe0f8dd5a510bd09bfe3b8748327a5).
All four npm packages and three Rust crates were verified against the original
packed archives. This public summary reconciles the delivered v3 design record
with the published evidence. It supersedes this path's
[beta-era checkpoint](https://github.com/getforma-dev/forma/blob/4d521384dd89319aea2ccfe4efbb603815cecc8c/docs/release/V3-AS-BUILT.md),
which remains historical.

## What shipped

The coordinated set is `@getforma/core`, `@getforma/compiler`, `@getforma/build`,
`@getforma/create-app`, `forma-ir`, `forma-ir-derive` and `forma-server`.

TypeScript/TSX components use fine-grained signals in the browser. For native
rendering, the compiler accepts a defined subset, emits FMIR v3 and declares
page/island schemas. Rust binds handwritten `PageProps` types at startup,
finalizes every SSR route before listening, and renders typed request data into
a complete `PageResponse`. That response keeps HTML, nonce, CSP and `no-store`
headers together. Type mismatches refuse binding; optional Rust code generation
is not part of 3.0.

The browser validates state and adopts compatible server nodes. Island activation
yields between batches; it cannot preempt an expensive individual component.
Static native routes omit executable JavaScript. Explicit Browser routes and the
separate HTML runtime remain supported; the HTML runtime requires an owner,
security tier and explicit capability grants.

Build assets, modules, manifests and deployment identity form one output.
Digest checks, strict adoption, explicit raw-HTML trust boundaries, bounded
expressions and skew/retention behavior defend different contracts. They do not
establish universal security or application-level production guarantees.
See [architecture](../ARCHITECTURE-3.0.md), [upgrade guidance](../UPGRADING-3.0.md)
and [security/support](../../SECURITY.md).

## Actual qualification

These are historical results for their identified producers, not measurements of
every later `main` commit or every consumer device.

| Evidence | Result and scope |
|---|---|
| [Final release record](https://github.com/getforma-dev/forma/releases/download/v3.0.0/release-record.json) | Seven coordinated 3.0.0 archives; trusted publication completed on attempt 2 of run 39364435446. Attempt 1 uploaded core but timed out waiting for registry visibility; its failure remains recorded. |
| [Final P17](https://github.com/getforma-dev/forma/releases/download/v3.0.0/p17.json) | 61/61 checks, 1,312.457 seconds. Its producer remains run 39364435446 attempt 1; publication retry did not rerun P17. |
| Mobile startup and input | 20 runs each for tenant login and 100 islands, with 40 clean independent probes and zero input errors. Raw traces retain 20 pre-application layout tasks and one 54.1 ms browser-internal unattributed task. A passing counted-application gate is not a claim that every raw browser task was below 50 ms. |
| Complete 1 MiB decoder | Demanding 20,000-string array p95 21.6 ms, max 23.2 ms; ASCII p95 15.9 ms, max 16.2 ms. Security stripping and schema checks remain enabled. These are full-decoder measurements, not the earlier approximate raw-JSON-parse estimate. |
| Indexed update statistic | L-67 uses each run's mean complete-update cost across all 101 samples, with ≤10% scaling growth, sampled <16 ms guards and 20 successful runs. It does not report individual-edit latency p95. |
| Mutation evidence | [Full campaign 39334278798](https://github.com/getforma-dev/forma/actions/runs/39334278798) on 329d5655: 252 cases, 249 killed and three predeclared equivalents, zero survivors/unqualified cases. Its unchanged-input applicability is retained in the accepted RC audit chain. SR14's six native production-mutation probes passed separately; neither campaign is relabeled as a fresh run on final. |
| Whole-release audit | Independent accepted D14 review and its RC binding are retained with [published RC.5](https://github.com/getforma-dev/forma/releases/tag/v3.0.0-rc.5). Final follows the reviewed canonical RC-to-final delta. |
| Outer release duration | 2,460.096 seconds: the separate 1,800-second outer target was missed even though P17 met its own limit. |

The 28,100-byte gzip N2 limit applies to Forma code attributed to the release
fixture routes; package bundle caps are separate. It is not a maximum for an
entire application's code or a responsiveness guarantee. Keep framework
regression budgets strict and measure real browser behavior for an application.

## Completed post-release soak

L-66-QUOTA allowed the required active burn-in after final publication. The
original final record therefore correctly says **deferred, zero credit**. It
has not been rewritten to claim a pre-publication pass.

The separate [completion receipt](https://github.com/getforma-dev/forma/releases/download/v3.0.0/post-release-soak-verification-v2.json)
and [independent review](https://github.com/getforma-dev/forma/releases/download/v3.0.0/post-release-soak-independent-review.md)
verify **3,660 active seconds, 15 complete rounds, zero faults and complete
cleanup** in [run 39372081554](https://github.com/getforma-dev/forma/actions/runs/39372081554).
The payload was the authenticated published RC.5 set; a separately reviewed
donor supplied orchestration. The original failed post-final campaign remains
failed. See [burn-in procedure and provenance](RC-BURN-IN.md).

## Limits and work outside this release

- No JavaScript SSR, WASM walker, server-function API, arbitrary native TypeScript
  execution, streaming native-page response or integrated server-component cache.
  Hashed asset caching and explicit asset retention are different mechanisms.
- Native props/schema agreement is checked; matching TypeScript declarations and
  Rust structs are still authored separately.
- Lab results do not certify reference-phone performance, field reliability,
  every hardware target or any external application's migration.
- L-60's distinct agent identity, new live protection enforcement and external
  alert delivery remain deferred. Existing review, CI, tag policy and trusted
  publishing still apply.
- Older supported lines receive Critical/High maintenance through 2027-04-20
  under the [published support policy](SUPPORT-AND-RECALL.md). That is an ongoing
  obligation, not proof of future response times.

The release and delivered v3 record are complete. Application migrations and
feature proposals are separate work; this record does not start them. Current
maintenance commits do not retag or replace the immutable 3.0.0 archives.
