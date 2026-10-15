
---

## Retired at the repository merge (FORMA-113, @MERGE_DATE@)

formajs, forma-tools and create-forma-app were merged into this repository.
formajs's and create-forma-app's documents moved whole, as `packages/core/`
and `packages/create-app/`, and stay current there. forma-tools' two packages
moved to `packages/compiler/` and `packages/build/`; its repository-level
documents, which described a repository that no longer exists, are retired
here. Each old repository stays readable, read-only, with its history at the
commit the merge took.

| File | What it was | Retired | Why |
|---|---|---|---|
| [`@MERGE_DATE@-forma-tools-README.md`](@MERGE_DATE@-forma-tools-README.md) | forma-tools' repository README | @MERGE_DATE@ | The repository was merged here; the package READMEs (`packages/compiler/README.md`, `packages/build/README.md`) carry the user-facing content and the root README the orientation. |
| [`@MERGE_DATE@-forma-tools-CONTRIBUTING.md`](@MERGE_DATE@-forma-tools-CONTRIBUTING.md) | forma-tools' contributor guide | @MERGE_DATE@ | Its gates are in the root `CONTRIBUTING.md` and `scripts/check.sh`; its test guidance is `docs/TESTING.md`'s. |
| [`@MERGE_DATE@-forma-tools-docs-README.md`](@MERGE_DATE@-forma-tools-docs-README.md) | forma-tools' documentation index | @MERGE_DATE@ | `docs/DIAGNOSTICS.md` and `docs/HANDOFF-imported-signal-defaults.md` moved to this directory's parent and are indexed by `docs/README.md`. |
| forma's repository `README.md` and `CONTRIBUTING.md` | The crates' README and contributor guide, which were the repository's | @MERGE_DATE@ | Not retired: moved to `crates/README.md` and `crates/CONTRIBUTING.md`, still current for the Rust half; the root files now describe the whole stack. Their "one product, four repos" orientation and clone commands are stale until the docs sweep that follows the merge. |

### forma-tools' archive index, as it stood

