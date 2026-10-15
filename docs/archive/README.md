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
| [`2026-10-15-legacy-apis/`](2026-10-15-legacy-apis/) | 2026-10-15 | Compiler/build and crate guides, architecture and diagnostics before FORMA-110 removed the Vite plugins, Node RPC/SSR and WASM walker. The live guides describe the remaining native FMIR pipeline. |
| [`2026-10-15-FMIR-FORMAT-v2.md`](2026-10-15-FMIR-FORMAT-v2.md) | 2026-10-15 | [`FMIR-FORMAT.md`](../FMIR-FORMAT.md) defines v3: new signature, exact writer version, CRC, variable sections and schema metadata. The old fixed-header promise is superseded; legacy modules require rebuilding. |

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| `CONTRIBUTING.md` described setup and PR mechanics only, and named no standard for tests or docs | `CONTRIBUTING.md` | 2026-08-05 | Superseded, not deleted: the file was rewritten to point at [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/TESTING.md`](../TESTING.md) and to state the citation contract. The mechanics it carried are all still in the new file. |
| The root `README.md` was the only narrative documentation for the whole server framework, and the pipeline diagram in it was the only place the stack was explained | `README.md` | 2026-08-05 | The design rationale now lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the binary contract in [`docs/FMIR-FORMAT.md`](../FMIR-FORMAT.md), both written 2026-08-05. The README keeps the four questions a README should answer and delegates the rest. |

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
