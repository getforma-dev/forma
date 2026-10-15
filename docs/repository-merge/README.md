# FORMA-113 repository merge rehearsal

This is the preserved rehearsal, not the registry cut. The root Cargo workspace
contains `forma-ir`, the published `forma-ir-derive` 0.0.0 placeholder, and
`forma-server`. The npm workspace contains the four unchanged package names.
The SSR and preview-frame harnesses share a separate Cargo workspace and lock
under `e2e/`, using this repository's crates by path.

The incoming histories were rewritten with git-filter-repo 2.47.0. Every
historical commit keeps its author, committer, timestamp and message, and its
files keep their blob IDs and modes at the new paths. `maps/` translates old
commit and ref IDs. All 523 incoming commits, 108 original forma commits, and
73 existing tags survive in the rehearsal, including branches never merged to
main. Incoming tags and branches have repository prefixes. The merged branch
reaches 437 commits before the follow-up recovery/evidence commits.

`inputs.json` pins every input ref. The original local snapshots and both
pre-interruption outputs remain under `work/FORMA-113/`; nothing was replaced.
The checkpoint branch `checkpoint/browser-benchmark` reapplies only the
founder's `8bd8b65` benchmark commit to the merged tree and migrates its new
dev dependencies into the root lock. The preceding DOM checkpoint and the
build/service-worker checkpoint already landed as A2 squash commits; their
original commits also survive in the imported branches.

## Repeat the rewrite

Run with Node 24.22.0/npm 11.19.1, Python 3, Git, curl, and the same Git identity
as the recorded run. The vendored filter-repo executable is verified by SHA-256
before execution; its license files are beside it. The root/e2e Cargo locks
are frozen in `overlay/`, so no Cargo resolve is needed.

```sh
bash rewrite.sh /absolute/empty/run1 /absolute/frozen-sources
bash rewrite.sh /absolute/empty/run2 /absolute/frozen-sources
bash verify.sh /absolute/empty/run1
bash verify.sh /absolute/empty/run2
```

The frozen source directory contains bare repositories named `forma`,
`formajs`, `forma-tools`, `create-forma-app`, with the refs in `inputs.json`.
Using live GitHub URLs instead intentionally takes a new snapshot and must be
reviewed against that manifest. Both repeat runs after recovery produced setup
commit `c0e9ce0e2c10526224eb80fea2fed5c248ed7159`, tree
`44d2cea29c85223a6b7ab47b971824c7a9b71df2`. The shared working branch retains
its original setup commit `72c2804` and applies the recovered late test fix as
a follow-up, so collaborators' branches remain valid.

`verify.sh` checks every commit tree, metadata, mapped branch and tag, the
merged ancestry/counts, clean state, and representative `git log --follow`
paths. Its expected follow counts include the two intentional setup edits.
Run it before builds: the inherited fixture-sync commands regenerate tracked
browser fixtures.

## Packed artifacts

See `evidence/artifact-comparison.json`. The core and compiler npm archives
match the published A2 archives byte for byte. The build and compiler npm
archives also match builds of frozen forma-tools main. Build's difference from
published A2 is the already merged FORMA-180 F3 production summary fix; the
create-app difference is solely the already merged dashboard README advisory.
The merged create-app README is the exact frozen-main blob.

The crates' sources and package manifests are unchanged by the merge. Compared
with A2, their changelogs, the IR linearity test, and resolved locks include the
already merged FORMA-180 follow-up. Repackaging changes `.cargo_vcs_info.json`.
When both crates are packaged together, Cargo records the newly packed IR
archive checksum in server's lock; that checksum also changes with VCS
metadata. Against frozen main, those VCS metadata and derived checksum fields
are the only differences. Claiming every A2 archive is byte-identical would be
false. No existing version is republished.

## Validation

The complete `npm run check` passed locally in **163 seconds** with warm
caches. It included 2,135 core, 681 compiler, 172 build and 139 create-app
unit tests, the Rust workspace, cross-language FMIR corpus, packaging/size/type
gates, and 145 Chromium tests (2 worker, 53 stack/SSR/frame, 90 core). The 16
create-app scaffold tests run in their dedicated CI jobs instead. Actionlint
passed; the release lint caught all 62 seeded violations across 31 rules.
The recovered MSRV and cargo-deny logs also pass. See `evidence/` for compact
outputs; the full logs remain in the ticket work directory.

The benchmark checkpoint quick Chromium smoke passed with one sample and one
warmup; it leaves the founder's recorded Markdown/JSON evidence unchanged.
This is a wiring check, not a new performance claim.

## What remains before the cut

Follow [CUT.md](CUT.md). The draft must remain unmerged until the founder's
publisher re-pointing, release workflow dry run, and history-preserving cut are
ready. This PR must use a merge commit, never squash or rebase merging.
Twenty CI timing samples/p95, maintenance publication dry runs, registry
rejection checks, and repository settings are cut acceptance, not facts proved
by this rehearsal. The current rehearsal does not claim those are complete.
