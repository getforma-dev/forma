# Evidence, provenance and reproducibility

## Scope

Research was conducted on 2026-10-26 against public official documentation,
public source repositories, selected public JavaScript assets, and a published
Astro package. Existing Forma source was read locally for the adaptation note.
The project contains source-derived explanations, static-analysis output, live
browser samples and original executable examples. None is silently substituted
for another.

## Evidence hierarchy

| Kind | What it establishes | What it does not establish |
| --- | --- | --- |
| Official documentation | Intended supported API and advertised modes at the viewed version | Exact internal control flow or deployed-byte identity |
| Pinned source | Implementation and tests at an immutable revision | Every branch's real execution or current live deployment commit |
| Downloaded asset/package | Actual observed bytes with URLs, headers and digests | Complete application source or private backend behavior |
| REA output | Static relationships, locations, route candidates and coverage limits | Complete runtime reachability, visual fidelity or inferred route-table completeness |
| Browser observation | A specific interaction in a specific browser/context | Every route, engine, device or accessibility experience |
| Original prototype tests | The restricted contracts exercised by those tests | Upstream framework conformance or production qualification |

The reports label derivations and unknowns. A matching version string or similar
configuration is not a byte-level deployment attestation. Angular's footer gives
a self-reported source SHA. Astro/React Router website source snapshots are
explicitly distinguished from verified deployment commits.

## Local artifact layout

```text
research/<framework>/       explanations, question ledgers, snippets, sources, licenses
evidence/                   compact shared observations and integrity indexes
.local/upstream/            pinned source checkouts and downloaded packages
.local/captures/            raw captured public HTML, JS, headers and manifests
.local/rea/<run>/           full REA evidence.json, stderr.log and run.json
.local/forma-site/          private read-only source snapshot for the adaptation note
reference-router/          original implementation, local demo and tests
scripts/                   reproducible analysis, browser and integrity helpers
```

Framework-specific manifests are authoritative about exact paths; some package
captures sit next to their source checkout. `.local` is ignored by Git but is
retained on disk. Preserve it when archiving the **complete local evidence**.
Review the private Forma snapshot before sharing a complete archive publicly.
The concise reports and manifests remain useful without copying the raw data.

## REA procedure and limits

The shared CLI is REA **6.8.0**, commit
`6381aa0b1dcb7092673db5ac739af57ce220ed37`, using its isolated Node runtime.
No MCP registration or native decompiler setup was required. Downloaded code
was analyzed as text; REA did not run its bundle bootstrap.

`scripts/run_rea.py` records input hashes, source selections, the exact command,
REA version, timestamps, elapsed time, exit status, output hash and parser
statistics. A file lock serializes runs across researchers. Default experimental
budgets were 15 seconds per source, a 512 MiB worker heap, 2,000 semantic
nodes/unknowns per file, 10,000 across the selection and 120 seconds total. These
are research bounds, not claims about inherent framework complexity or REA's
maximum capability. A successful exit can still contain partial/truncated graphs.

One React Router entry artifact reached the per-source timeout. Its result and
partial evidence remain saved. An Astro download failed a Python certificate
preflight before analysis; a standard verified curl download succeeded, and the
preflight record is retained. Source inspection answered questions that did not
justify repeated or unbounded analysis attempts. No failed result was relabeled
as complete.

Example rerun with a fresh run name:

```sh
python3 scripts/run_rea.py another-angular-history \
  .local/captures/angular/assets --source chunk-BOHxeupa.js
```

Use each existing run's `run.json` for its actual input and selection; the
example repeats the captured history chunk with a fresh run name. Run names
never overwrite prior results. The scripts
do not fetch dependencies recursively or treat unselected modules as examined.

## Browser procedure

`scripts/browser-probe.js` runs in fresh Playwright contexts with JavaScript on
and off. It discovers the target link from DOM anchors, clicks it, records
request types/URLs, title/heading, time origin, a document marker, focus/history
metadata, and a Back transition. History methods are wrapped and Navigation API
events observed. This instrumentation is part of the method, not a passive
packet capture. No authenticated browser profiles were used.

The selected links are Angular routing → define routes, Astro routing → view
transitions, and React Router home → picking a mode. The initial React Router
Back snapshot captured the URL before its heading settled. That record is
preserved; the corrected probe waits for the destination heading and original
Back heading. This distinguishes address-bar success from view completion.

Observed browser: Chromium 155.0.8059.85. Firefox/WebKit, mobile gestures,
screen readers, every route, and all failure paths were not observed upstream.
Network lists may include third-party requests initiated by a public page; REA
inputs were selected public first-party/package assets.

## Source and licensing

Each framework's `sources.json` stores immutable source URLs and digests, and
license notices are retained alongside attributed excerpts. The source reports
explain logic rather than copying whole manuals. The prototype and pseudocode
are original educational work. This project does not change upstream licenses
or grant rights beyond the retained upstream notices. Upstream tests were
inspected for contracts, not run or reported passing.

## Validation and remaining limits

Per-framework validation checks source/asset/evidence hashes, local links,
source-line bounds and excerpt fidelity where applicable. Shared
`scripts/check_evidence.py` validates saved REA receipts/input bytes and report
links, then regenerates the compact shared index. The original reference has
separate Node and Chromium evidence. A test of our example is never counted as
an upstream framework test.

No performance comparison, private server audit, exhaustive route crawl,
upstream build campaign or production Forma change was conducted. Remaining
runtime and product questions are explicitly listed in the ledgers and rebuild
blueprint.
