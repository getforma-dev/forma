# FORMA-113 cut plan — DO NOT EXECUTE FROM THE REHEARSAL

The history merge is prepared on `merge/forma-stack`. Keep its PR draft until
the lead coordinates the actual cut. This document is a reviewed command plan;
no command below has pushed a tag, published a package, changed a setting, or
merged main during the rehearsal.

## Before the cut

1. Confirm the freeze: no new PRs to formajs, forma-tools or create-forma-app.
   Compare all four current mains to `inputs.json`; stop for an unreviewed
   difference. Resolve outstanding old-repository PRs before making main
   read-only. Preserve each original bare repository and the complete merged
   repository with `git bundle create <outside-repo>.bundle --all`; verify each
   with `git bundle verify` and record its SHA-256 outside the repo.
2. Complete FORMA-117 and FORMA-187 against the merged tree. Run the release
   workflow's non-publishing dry run with the existing 2.x/0.x package set.
   No old version is republished. Keep package names and maintenance lines.
3. Obtain an independent review and green CI on the exact final branch head.
   Record twenty CI `check` durations and their p95 against G6's 600 seconds;
   a local warm run is not that measurement. `npm run check` is the R17
   command; separate jobs retain MSRV, targets, Windows, release/security,
   scaffold and three-engine coverage.
4. Founder registry work: re-point all four npm trusted publishers to
   `getforma-dev/forma`, the exact FORMA-187 workflow filename and `npm-publish` environment.
   The three crates must likewise name `crates-publish` in their trusted
   publisher registrations when the new workflow adds that environment
   (the earlier registrations omitted environments). Inspect all seven
   registrations against the final workflow; naming only the four npm entries
   is insufficient if crate environment names still need updating.
   Verify tag-limited environments/rulesets and the agreed six-month
   maintenance publishing route. Do not assume the registry supports multiple
   trusted-publisher entries: confirm the actual settings allow the agreed
   maintenance route before disabling the old one. The derive 0.0.0 placeholder
   is already published with trusted publishing; no new token is needed here.
   M1's manual approval gate was explicitly declined.

## Preserve the reference graph

From the validated complete rehearsal repository, inspect these dry runs.
These refspecs add incoming branches and prefixed historical tags only, and
leave forma's existing tags untouched. The founder/lead performs their real
(non-dry-run) versions only during the coordinated cut.

```sh
git push --dry-run origin 'refs/heads/formajs/*:refs/heads/formajs/*'
git push --dry-run origin 'refs/heads/forma-tools/*:refs/heads/forma-tools/*'
git push --dry-run origin 'refs/heads/create-forma-app/*:refs/heads/create-forma-app/*'
git push --dry-run origin 'refs/tags/formajs/*:refs/tags/formajs/*'
git push --dry-run origin 'refs/tags/forma-tools/*:refs/tags/forma-tools/*'
git push --dry-run origin 'refs/tags/create-forma-app/*:refs/tags/create-forma-app/*'
git push --dry-run origin 'refs/heads/checkpoint/browser-benchmark:refs/heads/checkpoint/browser-benchmark'
```

No `--mirror`, no forced update, no unprefixed incoming tags. Prefixed tags
must not match release triggers. Verify remote ref IDs against the maps after
pushing. A PR branch alone does not preserve old commits that exist only on
unmerged historical branches; the explicit refs and bundles do.

## Maintenance branches and merge

The old repositories retain these branches, made from the peeled A2 tags:

| Repository | Maintenance branch | Base |
|---|---|---|
| formajs | `maint/2.x` | `v2.1.0^{commit}` |
| forma-tools | `maint/0.3.x` | `build-v0.3.1^{commit}` (same commit as `compiler-v0.3.7`) |
| create-forma-app | `maint/0.6.x` | `v0.6.2^{commit}` |
| forma | `maint/0.2.x` | `server-v0.2.2^{commit}` (same commit as `ir-v0.2.2`) |

In each original clone, the coordinated cut uses:

```sh
git branch <maintenance-branch> '<base-tag>^{commit}'
git push --dry-run origin '<maintenance-branch>:<maintenance-branch>'
```

Inspect the branches, then push explicitly during the cut. Run maintenance
workflow dry runs before changing old-main protections. Keep each repository
available for six months after 3.0.0, and put the pointer/read-only policy on
old main; do not archive repositories whose maintenance workflows still run.

Merge the reviewed PR with **Create a merge commit**. Do not squash and do not
use GitHub's rebase merge: both would discard the imported-parent topology.
Afterward fetch into a fresh clone and verify the merged tree, every imported
ref, npm workspace and both Cargo locks. Confirm the benchmark branch remains
available. Old `core-release` dispatch retirement belongs to FORMA-117.

## Rollback and final evidence

Before main merges, keep the draft and restore the publisher settings if the
registry dry run fails. After merging, do not force-rewrite main or delete
historical refs: stop new releases, coordinate a forward fix or revert of the
setup commit, and restore the old publishers/maintenance workflows if needed.
Keep the signed registry checksums and release records. Record evidence that
an old-main publish attempt is rejected and maintenance dry runs still pass;
no real package upload is needed for the rejection test.
