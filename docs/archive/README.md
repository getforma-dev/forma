# Archive — `forma`

Nothing here is current. Everything here was once believed, published, or
relied on, and is kept so that a reader who meets a stale claim in the wild can
find out what replaced it and why.

**How to use this file.** Each entry says *what* the material was, *when* it
was retired, and *why*. Files that were removed from circulation are stored in
this directory next to this index. Where the material was a claim inside a live
document rather than a whole file, the entry records the claim and its
correction — there is no file to keep, but the history is the point.

**How to add an entry.** Never delete a superseded document. Move it here,
prefix the filename with the retirement date (`YYYY-MM-DD-`), and add a row
below. If you corrected a false claim instead of retiring a document, add a row
anyway: the next person to write that sentence should be able to find out why
it was wrong the first time.

---

## Retired documents

| File | Retired | Replacement and reason |
|---|---|---|
| [`2026-10-15-pre-key-adoption/`](2026-10-15-pre-key-adoption/) | 2026-10-15 | The three core list adoption test files from before FORMA-181 checkpoint C bound keyed rows by key. Five cases changed expectation on purpose (initial key order, keyed counts and duplicate served keys now adopt or refuse `FORMA_E_HYDRATE_KEY`); the mapping is in its README. |
| [`2026-10-15-pre-attribute-values/`](2026-10-15-pre-attribute-values/) | 2026-10-15 | The js-emitter contract corpus outputs from before FORMA-182's attribute table (findings F2 and F3): a reactive `true` on a non-boolean attribute is the word `"true"`, and an attribute whose server value is `""` is a static `value=""`. Regenerated with a before/after ledger (`dynamic-attrs` `.ir`/`.dump`/`.html`, `jsx-page.html`, `sub-component-scopes.html`). |
| [`2026-10-15-pre-value-rules/`](2026-10-15-pre-value-rules/) | 2026-10-15 | The inline compiler test sources from before FORMA-182's value rules 6 and 7 refused a boolean in text (BUILD-614) and a condition that is not boolean-typed (BUILD-615). The tests were migrated to the admitted forms; the archived sources stay executable as refusal evidence ([`docs/parity-rules.md`](../parity-rules.md)). |

| [`2026-10-15-pre-list-source/`](2026-10-15-pre-list-source/) | 2026-10-15 | The `list-same-source` corpus sources from before BUILD-616 refused a `createList` source that is not a function (FORMA-183 finding F1): the page passed its array itself. Only the source text changed; every compiled output is byte-identical. The archived page still compiles to BUILD-616 and is the parity harness's twin that cannot build. |
| [`2026-10-15-pre-native-keys/`](2026-10-15-pre-native-keys/) | 2026-10-15 | The `list-same-source` js-emitter contract golden from before FORMA-181 checkpoint B made the walker write `data-forma-key` on every keyed row. Regenerated with a before/after ledger; the module bytes, dump and state snapshot are unchanged. |
| [`2026-10-15-pre-keyed-rows/`](2026-10-15-pre-keyed-rows/) | 2026-10-15 | The native `island-emitter` fixtures, the `list-same-source` contract corpus outputs and the inline test sources from before FORMA-181 checkpoint A proved list key paths and emitted FMIR section `0x0006`. Four native binaries and one corpus case were regenerated with a before/after ledger; row-root conditionals and scalar keys became BUILD-613/BUILD-612 refusals, and the archived sources stay executable as refusal evidence. |
| [`2026-10-15-declared-props/`](2026-10-15-declared-props/) | 2026-10-15 | Server guide and FMIR format before FORMA-102 replaced the lenient loader and caller-supplied slots with declared props and typed page handles. [`DECLARED-PROPS.md`](../DECLARED-PROPS.md) describes the current contract. |
| [`2026-10-15-legacy-apis/`](2026-10-15-legacy-apis/) | 2026-10-15 | Compiler/build and crate guides, architecture and diagnostics before FORMA-110 removed the Vite plugins, Node RPC/SSR and WASM walker. The live guides describe the remaining native FMIR pipeline. |
| [`2026-10-15-islands-only-e2e/`](2026-10-15-islands-only-e2e/) | 2026-10-15 | The SSR e2e lane before FORMA-105's entry contract: conditional entries, whole-page adoption by `mount()`, Phase 1 from the server route's bundle, activation observed as `data-forma-status="active"`. The live lane (`e2e/ssr/`, [`e2e/README.md`](../../e2e/README.md)) uses the one entry shape `BUILD-611` accepts, islands only, an explicit Browser route for Phase 1, and strict activation's contract. |
| [`2026-10-15-FMIR-FORMAT-v2.md`](2026-10-15-FMIR-FORMAT-v2.md) | 2026-10-15 | [`FMIR-FORMAT.md`](../FMIR-FORMAT.md) defines v3: new signature, exact writer version, CRC, variable sections and schema metadata. The old fixed-header promise is superseded; legacy modules require rebuilding. |

## FORMA-112 compatibility transition (2026-10-15)

The prior build/compiler/scaffolder guides and diagnostic text are preserved in
[`2026-10-15-compatibility/`](2026-10-15-compatibility/). Manifest schema 1,
`build_hash`, logical mappings in `assets`, exact-base writer matching and the
unnamed-worker bridge are replaced by manifest 2, the major/minor window, aliases,
metadata and checked worker startup. BUILD-802 is retired; raw-lint810–814 keep
their meanings, while identity/duplicate-core/missing-output diagnostics use
815–817. [compatibility.md](../compatibility.md) states the current contract and
migration; historical release evidence remains unchanged.

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| `CONTRIBUTING.md` described setup and PR mechanics only, and named no standard for tests or docs | `CONTRIBUTING.md` | 2026-08-05 | Superseded, not deleted: the file was rewritten to point at [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/TESTING.md`](../TESTING.md) and to state the citation contract. The mechanics it carried are all still in the new file. |
| The root `README.md` was the only narrative documentation for the whole server framework, and the pipeline diagram in it was the only place the stack was explained | `README.md` | 2026-08-05 | The design rationale now lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the binary contract in [`docs/FMIR-FORMAT.md`](../FMIR-FORMAT.md), both written 2026-08-05. The README keeps the four questions a README should answer and delegates the rest. |
| `e2e/fixtures/formajs-runtime.global.js` and `e2e/fixtures/formajs.global.js` were tracked, as "auto-synced from the formajs build" | `e2e/fixtures/`, last refreshed in `495c459` | 2026-10-15 | Untracked and ignored (FORMA-105). The tracked bundles predated `trustedHtml()` (FORMA-126, `366d40e`), so the five template and cross-cutting cases of `e2e/full-stack.spec.ts` failed with `trustedHtml is not a function` whenever Playwright ran without `e2e/sync-fixtures.sh`, and passed after it; the same stale-copy finding is `FD-003` in `packages/core/docs/DOGFOOD.md`. The originals are in git history at `495c459`; `e2e/README.md` states the rule, and the spec now refuses to run without the synced bundles. |

## Retirements in the other repos

The other three repos keep their own archive index, because the material and
the reasons are local to them:

- `formajs/docs/archive/` — the monolithic README's narrative sections and the
  completed hardening audit
- `forma-tools/docs/archive/`
- `create-forma-app/docs/archive/`

---

## Retired at the repository merge (FORMA-113, 2026-10-15)

formajs, forma-tools and create-forma-app were merged into this repository.
formajs's and create-forma-app's documents moved whole, as `packages/core/`
and `packages/create-app/`, and stay current there. forma-tools' two packages
moved to `packages/compiler/` and `packages/build/`; its repository-level
documents, which described a repository that no longer exists, are retired
here. Each old repository stays readable, read-only, with its history at the
commit the merge took.

| File | What it was | Retired | Why |
|---|---|---|---|
| [`2026-10-15-forma-tools-README.md`](2026-10-15-forma-tools-README.md) | forma-tools' repository README | 2026-10-15 | The repository was merged here; the package READMEs (`packages/compiler/README.md`, `packages/build/README.md`) carry the user-facing content and the root README the orientation. |
| [`2026-10-15-forma-tools-CONTRIBUTING.md`](2026-10-15-forma-tools-CONTRIBUTING.md) | forma-tools' contributor guide | 2026-10-15 | Its gates are in the root `CONTRIBUTING.md` and `scripts/check.sh`; its test guidance is `docs/TESTING.md`'s. |
| [`2026-10-15-forma-tools-docs-README.md`](2026-10-15-forma-tools-docs-README.md) | forma-tools' documentation index | 2026-10-15 | `docs/DIAGNOSTICS.md` and `docs/HANDOFF-imported-signal-defaults.md` moved to this directory's parent and are indexed by `docs/README.md`. |
| forma's repository `README.md` and `CONTRIBUTING.md` | The crates' README and contributor guide, which were the repository's | 2026-10-15 | Not retired: moved to `crates/README.md` and `crates/CONTRIBUTING.md`, still current for the Rust half; the root files now describe the whole stack. Their "one product, four repos" orientation and clone commands are stale until the docs sweep that follows the merge. |

### forma-tools' archive index, as it stood


Nothing here is current. Everything here was once published or relied on, and
is kept so a reader who meets a stale claim can find out what replaced it and
why.

**How to add an entry.** Never delete a superseded document: move it into this
directory with a `YYYY-MM-DD-` prefix and add a row below. If you corrected a
false claim inside a live document instead of retiring the whole file, still
add a row — the next person to write that sentence should be able to find out
why it was wrong the first time.

---

## Retired documents

*(none yet — this directory was created 2026-08-05 with the docs restructure)*

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| "`npm test` — run all workspace tests (162 tests)" | `README.md`, Development | 2026-08-05 | False. The suite is 336 tests across 10 files, measured by running `npm test` on 2026-08-05. The count was **removed rather than refreshed**: a hard-coded total in a README is wrong again within days, and the command itself prints the number. |
| Migration notes dated `(0.2.1)` and `(0.2.x)` for the show-slot renaming, the literal-source list naming, and the `attr:` / `text:` occurrence suffixes | `packages/compiler/README.md`, Slot Naming → Migration | 2026-08-05 | Version-shaped claims nobody could check. `0.2.1` does not exist — npm's latest is 0.2.0 — and the two `(0.2.x)` items describe changes that are still under `[Unreleased]` in `CHANGELOG.md`, i.e. *later* than the versions they were attributed to. All three are now labelled `(unreleased)` with `CHANGELOG.md` named as the authority, and the one change that really did ship in 0.2.0 (per-list slot names) is listed under its own version. |
| The repo had no `CONTRIBUTING.md`, no `docs/` directory, and no link to the stack it belongs to | repo root | 2026-08-05 | A reader landing here learned nothing about the pipeline this compiler sits in the middle of. Added [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md), [`../README.md`](../README.md), and an orientation header in the repo README linking the other three repos and the stack architecture. |

## Notes on material that is *not* archived

- **The historical notes inside `packages/compiler/README.md` and
  `packages/build/README.md`** — "through 0.2.0 the plugin also dropped a
  `<page>.islands.json` sidecar", "through 0.1.9 it also wrote
  `<page>.islands.js`" — stay where they are on purpose. They describe files a
  user's `outputDir` may still contain after upgrading, so they are current
  guidance about the past, not retired documentation.
- **Package CHANGELOGs** are the record of what changed and when. This archive
  is for material that was *wrong or superseded*, which is a different
  question.

- [FORMA-185 exact-stage FMIR v3 contract](2026-10-15-FMIR-FORMAT-exact-stage.md): superseded only in version acceptance by FORMA-112; the maintained format keeps its bytes and structural rules.

- `2026-10-15-bound-render/forma-server-README.md`: exact pre-FORMA-107 staged102/109 README, archived by Codex when finalization, bind limits and the bound-only render API replaced the interim SSR bridge.

- [Schema2 test manifests before mandatory SHA-384](2026-10-15-asset-integrity/README.md): exact prior metadata and hashes; original FMIR/document byte fixtures remain unchanged.

## FORMA-103 local entry correction (2026-10-15)

The compiler's resolver table already admitted named same-file components, but
entry selection treated them as an anonymous inline mount with an empty props
schema. A declared prop read then failed BUILD-610. The current compiler guide
now states the corrected named-root behavior explicitly. The original failing
source and log are preserved in `work/FORMA-103/tmp/same-file-entry/` and
`same-file-entry.log`; ordinary regression tests cover the corrected roots and
the unchanged inline path. No historical FMIR fixture or report was replaced.

- [Pre-state-contract corpus](2026-10-15-pre-state-contract-corpus/README.md): immutable compiler inputs, emitted bytes/dumps/HTML and native corpus at FORMA-103 wire start; old island modules become explicit refusal inputs.
- [Pre-keyed-rows originals](2026-10-15-pre-keyed-rows/README.md): the native island-emitter directory, the list-same-source corpus outputs and the inline sources from before FORMA-181 checkpoint A, with the migration map and the regeneration ledger.
## FORMA-144 source-template migration — 2026-10-15

[The slice 1 archive](2026-10-15-template-slice1/README.md) preserves the A2
source templates, the temporary candidate source adapter and superseded
rendering/lock guidance, with original path/SHA-256 records. Current package
inputs use typed handlers and identified source lock seeds; packed candidates
carry actual archive checksums. Island adoption remains a later slice.

- [Signal defaults before explicit closed constants](2026-10-15-state-signal-defaults/README.md): original array/object warning and handler-injection advice, replaced by FORMA-103 native constant provenance.

- [Boolean attribute review originals](2026-10-15-boolean-attribute-review/README.md): FORMA-182 native/core tests before scalar-presence correction, authenticated at b5f1905.
- [FORMA-101 strict subset migration](FORMA-101-strict-subset/README.md): original warning-only/placeholder guides, tests and list-source evidence; replaced by mandatory native admission and explicit select ownership.

- [FORMA-101 strict corpus originals](FORMA-101-strict-corpus/README.md): exact BUILD-206 unknown-getter and BUILD-503 duplicate-name pages with their pre-migration native products; executable publication refusals remain beside the admitted corpus.

- [FORMA-139 HTML context/root originals](FORMA-139-html-context/README.md): exact sources and compiler products before the finite refusals.
