# The alpha day: `v3.0.0-alpha.1` from `main`

The first live publish of the unified pipeline (FORMA-187's M2 exit; FORMA-145 step 2's first
pre-release; PLAN-merge-and-3.0.0 T10: the seven re-pointed publisher entries are tested while the
delta is small). One sitting, two people: the founder on npmjs.com and crates.io, the lead on the
repository. Nothing here needs a token; every publish runs through `release.yml` by trusted
publishing. Times are estimates for one person at the keyboard; the whole session is about three
and a half hours, of which the founder's part is about an hour.

Why one sitting: npm expires a new trusted-publisher entry that has not completed a successful
publish within two days of its creation, and an expired entry cannot be reused or edited [npm-tp].
So the founder's re-pointing (F2, F3) and the lead's tag (L3) happen back to back, with the version
pull request (L1) merged and green beforehand.

## Before the day (lead, the day before)

| Step | What | Time |
|---|---|---|
| P1 | This gate PR is on `main` and `ruby scripts/check-release-workflow.rb --self-test` on `main` ends with `milestones ready to publish: alpha`. If it says `none`, a gate of the alpha is still `pending` in `scripts/release-contracts.json`; stop. | 5 min |
| P2 | The board agrees with the contract: FORMA-110, 185, 112, 102, 107, 109, 111 and 144 slice 1 are on `main` (185's seeded qualification merged as PR 48, `6afe461`; 144 slice 1 as PR 43, `1279ccd`, the ticket staying open for slices 2 and 3, which are beta and final gates). The contract's `version` is `3.0.0`, the release these gates are written for. | 10 min |
| P3 | Repository settings, unchanged since FORMA-113: the admin-only `v*` tag ruleset; environments `npm-publish` and `crates-publish` limited to release tags, no required reviewer (D3 declined). No settings change today. | 5 min |
| P4 | Sessions: the lead's `gh` is authenticated as the repository admin (the `v*` ruleset lets only an admin push the tag); the founder can sign in to npmjs.com and crates.io with 2FA. | 5 min |
| P5 | No other release, maintenance publish or long CI run is in flight on the Mac or on `main`. | 2 min |

## L1. The version pull request (lead; about 90 minutes, mostly CI)

Can be done the day before; it must be merged and green on `main` before F2.

```
git fetch origin && git checkout -b release-3.0.0-alpha.1 origin/main
node scripts/release-set.mjs version 3.0.0-alpha.1
```

Then, by hand:

1. `CHANGELOG.md`: rename `## [Unreleased]` to `## [3.0.0-alpha.1] - <date>` (its body is the
   release's notes; `record` fails on a missing or empty entry) and put a fresh, empty
   `## [Unreleased]` heading above it.
2. Review the diff: seven manifests, exact internal requirements (`=3.0.0-alpha.1`), the three
   Cargo locks, `package-lock.json`, the npm `repository.url` set to
   `git+https://github.com/getforma-dev/forma.git` (npm requires it to match the publishing
   repository exactly [npm-tp]), the template seeds and ranges. No external pin changes.
3. Locally:

```
node scripts/release-set.mjs check v3.0.0-alpha.1          # prints 3.0.0-alpha.1
bash scripts/install-deps.sh && npm run check               # R17, about 4 minutes
ruby scripts/check-release-workflow.rb --self-test          # ... milestones ready to publish: alpha
npm run build
node scripts/release-set.mjs pack "$TMP/alpha-ds11" --dry-run
bash scripts/release-artifacts.sh record "$TMP/alpha-ds11"
node scripts/verify-release-set.mjs "$TMP/alpha-ds11" "$TMP/alpha-p17.json"
```

   `release-set.json` and the P17 report carry `milestone: { name: "alpha", plan: "M2",
   ready: true, later: {...} }`; the report says `passed: true`.

4. Open the PR (`release: 3.0.0-alpha.1`), wait for CI green, merge as a merge commit, then wait
   for the **push** run of `ci.yml` on the merge commit to finish green, including the jobs SR13
   requires: `check`, `release-workflow`, `candidate-pack`, `candidate-scaffold (ubuntu-latest)`
   and `candidate-scaffold (windows-latest)`. Note the merge commit's SHA; that is what the tag
   points at. Until then the alpha cannot start (`check-release-ci.mjs` refuses an incomplete or
   missing run).

## F1 to F3. The founder's registry steps (about 45 minutes, immediately before L3)

Start these only when L1 is merged and green, with the lead ready to tag: the two-day window
opens at F2.

### F1. Check what is there (10 minutes)

On npmjs.com, for each of `@getforma/core`, `@getforma/compiler`, `@getforma/build`,
`@getforma/create-app`: Settings → Trusted publishing. Note the existing entries (the maintenance
line's). They stay: a package may hold up to ten entries, each added or deleted independently, and
an entry can never be edited, only deleted and recreated [npm-tp]. Publishing access should already
read "Require two-factor authentication and disallow tokens" (FORMA-136); trusted publishers are
unaffected by that setting [npm-tp]. Leave it.

On crates.io, for each of `forma-ir`, `forma-ir-derive`, `forma-server`: Settings → Trusted
Publishing. Note the existing entries. `forma-ir-derive` was published as 0.0.0 by the founder on
2026-10-14 with trusted-publishing-only on (D2 done), which satisfies crates.io's prerequisite that
a crate exist before an entry is made [crates-tp].

### F2. npm: add the `forma` entry to each of the four packages (20 minutes, 5 per package)

Settings → Trusted publishing → Add trusted publisher → GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `getforma-dev` |
| Repository | `forma` |
| Workflow filename | `release.yml` (the filename only, with its extension) |
| Environment name | `npm-publish` |
| Allowed actions | tick **Allow npm publish** |

The tick is not optional: an entry created after 2026-09-03 defaults to `npm stage publish` only,
and the workflow runs `npm publish` directly (D3 declined, no approval click) [npm-tp]. Leave "Allow
npm dist-tag" off: the job publishes the alpha with `npm publish --tag next`, which is a publish,
not a `npm dist-tag` command; the dist-tag permission covers `npm dist-tag add/rm/ls` [npm-tp]. If
`publish-npm` nevertheless fails with a dist-tag permission error, tick it and rerun the failed job
(L4). npm does not validate the entry when saved; a typo surfaces only as `ENEEDAUTH` in `publish-npm`
[npm-tp]. Keep the maintenance entries.

### F3. crates.io: the `forma` entry with the environment on each of the three crates (15 minutes)

Settings → Trusted Publishing → Add → GitHub:

| Field | Value |
|---|---|
| Repository owner | `getforma-dev` |
| Repository name | `forma` |
| Workflow filename | `release.yml` |
| Environment | `crates-publish` |

crates.io matches an entry by repository owner and name (case-insensitive), by the owner's GitHub
id (an entry made before an organisation was renamed or recreated must be recreated), and by the
workflow filename; the environment is optional on the entry: an entry with no environment accepts
the job whatever environment it runs in, and an entry with one accepts only a job running in that
environment, case-insensitive [crates-src]. So an existing entry for `getforma-dev/forma` and
`release.yml` without an environment would already let the job through; add the environment-scoped
entry anyway so the credential is bound to `crates-publish`, and keep the maintenance line's entry.
The exchanged token lives 30 minutes and the action revokes it when the job ends [crates-tp]
[crates-action].

Tell the lead "entries in" and stay available for L4.

## L2 to L8. The lead's steps (about two hours)

### L2. Confirm (5 minutes)

`git fetch origin main` and check that `origin/main` is still the merge commit of L1, its push run
is green, and nothing was merged after it.

### L3. The tag (5 minutes)

From the admin session, on the merge commit, within minutes of F2:

```
git tag -a v3.0.0-alpha.1 <merge-sha> -m "Forma 3.0.0-alpha.1 (alpha, M2)"
git push origin v3.0.0-alpha.1
```

The tag push is the workflow's only trigger. Note the time: G6's thirty minutes run from here.

### L4. Watch the run (about 40 to 50 minutes on the first tag)

```
gh run list --workflow release.yml --limit 1
gh run watch <run-id> --exit-status
```

G6's target is 1,800 seconds from the tag push to the GitHub Release written, and the rows below
sum to about 37 to 47 minutes on cold runners (`engines` runs beside `pack`, so they overlap; the
rest is serial). Expect the first real G6 figure to exceed 1,800 seconds. `release-record.mjs`
records the figure and fails nothing on it; the ticket log takes it as the first measurement, and
the beta is where the time is trimmed (caching `cargo-deny` and the browser in `verify` are the
obvious cuts).

| Job | Expected | If it fails |
|---|---|---|
| `check` (1 min) | `CI <id> attempt 1 passed for <sha>, including R17/probes.` | The push run is not complete or not green: wait, then `gh run rerun <run-id>`. Nothing was published. |
| `engines` (10 min) | Chromium, Firefox and WebKit green on the tag. | A real failure: stop, fix on `main`, next version. Nothing was published. |
| `pack` (5 min) | `release-set.mjs check` prints the version; the milestone resolves to `alpha`, ready; DS11 recorded. | A gate of the alpha is `pending` in the contract, or a manifest disagrees with the tag: fix on `main`, next version. |
| `verify` (15 to 25 min) | P17 passes; the milestone check passes. The job's 25-minute budget holds a cold `cargo install cargo-deny` compile, a Chromium install and P17, unmeasured on a tag so far. | A P17 failure: stop, nothing was published. A timeout on a slow runner is rerun-safe: nothing was published, `gh run rerun <run-id> --failed` repeats only `verify` and what follows. |
| `publish-crates` (5 to 15 min) | three crates present on crates.io with DS11's checksums, polled until visible. | `ENEEDAUTH`-like exchange error: F3's entry fields; fix, then `gh run rerun <run-id> --failed`. The rerun skips any version already present with identical bytes and refuses one with different bytes. |
| `publish-npm` (5 min) | four packages on `next`. | Entry fields or the publish tick (F2); fix, `gh run rerun <run-id> --failed`. Same skip rule. |
| `record` (1 min) | the GitHub Release written with the record attached. | `gh run rerun <run-id> --failed`; a rerun edits the existing Release. |

Never retag, never rebuild different bytes under the same version: if bytes must change, it is
`3.0.0-alpha.2`.

### L5. Verify on the registries (15 minutes)

```
gh release download v3.0.0-alpha.1 -p SHA256SUMS -p release-record.json -p p17.json -D "$TMP/alpha-release"
for c in forma-ir forma-ir-derive forma-server; do
  curl -s -A 'forma-release-check' "https://crates.io/api/v1/crates/$c/3.0.0-alpha.1" \
    | jq -r '.version | "\(.crate)-\(.num).crate yanked=\(.yanked) \(.checksum)"'
done                                                        # each checksum is its line in SHA256SUMS
for p in core compiler build create-app; do
  npm view "@getforma/$p@3.0.0-alpha.1" dist.integrity dist.tarball
  npm view "@getforma/$p" dist-tags                         # next: 3.0.0-alpha.1; latest unchanged
done
```

Plain `npm install @getforma/core` must still resolve `latest` (2.1.0): a pre-release on `next` is
excluded from ordinary ranges, as L-41 intends [npm-dist-tag]. In a scratch directory,
`npm init -y && npm install @getforma/core@next --ignore-scripts && npm audit signatures` checks the
registry signature and the provenance attestation npm generated for the trusted publish [npm-tp].

### L6. The GitHub Release (5 minutes)

```
gh release view v3.0.0-alpha.1 --json name,isPrerelease,assets,body
jq '{milestone: .milestone.name, ready: .milestone.ready, elapsedSeconds, timingBasis}' "$TMP/alpha-release/release-record.json"
```

Name `Forma 3.0.0-alpha.1 (alpha, M2)`, pre-release, three assets (`release-record.json`,
`p17.json`, `SHA256SUMS`), the body naming the milestone, `next`, and every gate still pending
before the beta, the rc and the final. `elapsedSeconds` is G6's first real figure (target 1800);
record it in FORMA-187's log whatever it is.

### L7. P17 replay on the published set (30 minutes)

The same check the A2 rehearsal did, over the bytes the registries now serve, from the tagged tree:

```
git checkout v3.0.0-alpha.1 && bash scripts/install-deps.sh
gh run download <run-id> -n release-packed -D "$TMP/published"      # for release-set.json and Cargo.lock
cd "$TMP/published" && rm -- *.crate *.tgz
for c in forma-ir forma-ir-derive forma-server; do
  curl -sSL -A 'forma-release-check' -o "$c-3.0.0-alpha.1.crate" "https://static.crates.io/crates/$c/$c-3.0.0-alpha.1.crate"
done
for p in core compiler build create-app; do npm pack "@getforma/$p@3.0.0-alpha.1" --pack-destination . >/dev/null; done
shasum -a 256 -c SHA256SUMS                                          # every line OK
cd - && node scripts/verify-release-set.mjs "$TMP/published" "$TMP/alpha-published-p17.json"
```

The set is live (`dryRun: false`), so P17 also enforces the milestone. Expected `passed: true`,
`milestone.name` `alpha`. Commit the report as `docs/release-evidence/alpha-published-p17.json`
with a README paragraph in a follow-up PR.

### L8. The fault-injection check the plan names (20 minutes)

M2's gate "fault injection refusals (185 tests)": the published reader refuses FORMA-185's seeded
faults with their stable codes. The reader comes from the registry, the committed regression corpus
from the tagged tree (the replay test reads `../../fuzz/regressions` from the crate's manifest
directory, so the crate is unpacked under `crates/forma-ir` beside a copy of that directory):

```
mkdir -p "$TMP/fault/crates" "$TMP/fault/fuzz"
tar -xzf "$TMP/published/forma-ir-3.0.0-alpha.1.crate" -C "$TMP/fault/crates"
mv "$TMP/fault/crates/forma-ir-3.0.0-alpha.1" "$TMP/fault/crates/forma-ir"
cp -R fuzz/regressions "$TMP/fault/fuzz/regressions"                 # from the v3.0.0-alpha.1 checkout
cd "$TMP/fault/crates/forma-ir" && printf '\n[workspace]\n' >> Cargo.toml
cargo test --locked --features test-helpers,__fuzzing,__fault-injection --test fmir_v3 --test fuzz_regressions
```

`forma-ir-derive =3.0.0-alpha.1` resolves from crates.io with the checksum the packed lock pins.
Expected: every test passes; on the tagged tree that is `fmir_v3` 8 (the v3 header, section and
refusal paths) and `fuzz_regressions` 6 (the fault corpus is total and accepted cases walk; every
committed regression replays through its real adapter; the seeded decoder defects of FORMA-185's
qualification are caught deterministically; malformed and oversized input never looks like a
successful replay). Rehearsed on the `3.0.0-dev` dry-run crate of the merged tree on 2026-10-15
with the derive crate patched in by path: 8 and 6 passed. `fmir_contract` is not in this list
because it reads `docs/FMIR-FORMAT.md` from the tree; P17's staged run covers it. Count both
results in the ticket log.

### L9. Close out (20 minutes)

- FORMA-187: log the run id, G6's figure, the replay and the fault check; M2 exit met.
- FORMA-145: step 2's first pre-release done; FORMA-113: the publisher step done, move to done.
- The post-release PR: `node scripts/release-set.mjs version 3.0.0-dev`, `## [Unreleased]` back
  on top of the changelog; `main` carries `3.0.0-dev` between releases.
- Delete `"$TMP"` and the build output in the work folder.

## Rollback

Triggers: L5 shows bytes that differ from SHA256SUMS, L7 fails, or a template cannot install the
published set. Registry data is immutable: a version, once published, can never be republished with
other bytes even after an unpublish [npm-unpublish-policy] [cargo-publishing]; the fix is always
`3.0.0-alpha.2`.

| Step | Who | What | Time |
|---|---|---|---|
| R1 | lead | Stop: no retag, no rebuild. If the run is still going, let it finish; it is resumable, not cancellable mid-publish (`cancel-in-progress: false`). | 2 min |
| R2 | founder | npm, from a 2FA session (OIDC cannot run these): `npm deprecate @getforma/<p>@3.0.0-alpha.1 "recalled: <reason>; wait for 3.0.0-alpha.2"` for the four packages, then `npm dist-tag rm @getforma/<p> next` so `@next` resolves to nothing until the next alpha. Unpublishing an existing package's version is allowed only while nothing on the registry depends on it, it had under 300 downloads in the last week and the package has a single owner (the 72-hour clause is for newly created packages); the number is burned either way, and deprecate is npm's recommended path [npm-deprecate] [npm-unpublish-policy]. | 10 min |
| R3 | founder | crates.io, in reverse dependency order, `forma-server`, `forma-ir`, `forma-ir-derive`: `cargo yank <crate>@3.0.0-alpha.1` (or the version page's yank), reversible with `--undo`. A yank deletes nothing and breaks no existing lockfile; it stops new resolutions from choosing the version [cargo-yank]. | 10 min |
| R4 | founder | Re-point back only if an entry was the fault: delete the new `forma`/`release.yml` entry (npm entries cannot be edited, only deleted and recreated [npm-tp]; crates.io entries likewise are deleted from Settings). The maintenance entries were never touched. If no publish succeeded through a new npm entry, its two-day window is still running from F2; a successful publish has bound it. | 10 min |
| R5 | lead | `gh release edit v3.0.0-alpha.1 --draft` or prepend "RECALLED: see 3.0.0-alpha.2" to its notes; keep the tag as the record. Log the recall in FORMA-187 and FORMA-145. | 5 min |
| R6 | lead | Fix on `main`, then L1 again at `3.0.0-alpha.2`. | — |

## Time table

| | Lead | Founder |
|---|---|---|
| Day before | P1 to P5 (30 min), L1 (90 min, mostly CI) | — |
| Alpha day, hour 0 | L2 (5 min) | F1 (10 min), F2 (20 min), F3 (15 min) |
| Hour 0:45 | L3 tag (5 min), L4 watch (40 to 50 min; G6's 30 is the target, not the first figure) | on call for F2/F3 fixes |
| Hour 1:40 | L5 (15 min), L6 (5 min) | — |
| Hour 2:00 | L7 (30 min), L8 (20 min) | — |
| Hour 2:50 | L9 (20 min) | — |

## Sources

Fetched 2026-10-15 with User-Agent `design-doc-factory-research/1.0`. crates.io serves its
documentation page only to a browser, so its text was taken from the page's source in the
crates.io repository, and the matching rules from the server's token-exchange controller.

- [npm-tp] npm Docs, "Trusted publishing for npm packages", https://docs.npmjs.com/trusted-publishers/ :
  GitHub Actions fields (organisation, repository, workflow filename with extension, optional
  environment, allowed actions); "a newly created trusted publisher configuration must complete its
  first successful publish within 2 days"; expired entries cannot be used or edited; up to 10
  entries per package; entries cannot be changed, only deleted and recreated; entries created after
  Sep 03, 2026 default to `npm stage publish` and direct `npm publish` must be chosen; "Allow npm
  dist-tag" is separate and off by default; the "disallow tokens" setting does not affect trusted
  publishers; `repository.url` must match the repository exactly; provenance is generated
  automatically; `ENEEDAUTH` on a field mismatch.
- [npm-dist-tag] npm CLI docs, `npm dist-tag`, https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/ :
  publishing sets `latest` unless `--tag` is given; `npm install <pkg>` installs `latest`;
  pre-releases belong on another tag.
- [npm-deprecate] npm CLI docs, `npm deprecate`, https://docs.npmjs.com/cli/v11/commands/npm-deprecate/ :
  a deprecation warns every installer of the version; `npm undeprecate` reverses it.
- [npm-unpublish-policy] npm Docs, "Unpublish policy", https://docs.npmjs.com/policies/unpublish/ :
  registry data is immutable, a name@version can never be reused; a newly created package may be
  unpublished within 72 hours while nothing depends on it; any package, regardless of age, only
  when nothing depends on it, it had under 300 downloads in the last week and it has a single
  owner; otherwise deprecate.
- [npm-cli-11] npm CLI changelog, 11.0.0-pre.0 (2024-11-26), https://github.com/npm/cli/blob/latest/CHANGELOG.md :
  "publishing prerelease requires explicit tag" (npm/cli#7910), the reason the job passes
  `--tag next` for every `-alpha.N`, `-beta.N` and `-rc.N`.
- [crates-tp] crates.io, "Trusted Publishing" (page source `svelte/src/routes/docs/trusted-publishing/+page.svelte`
  in https://github.com/rust-lang/crates.io, served at https://crates.io/docs/trusted-publishing) :
  prerequisites (the crate already published, the user an owner); GitHub fields (repository owner,
  repository name, workflow filename, optional environment); tokens expire after 30 minutes;
  `rust-lang/crates-io-auth-action` exchanges the OIDC token.
- [crates-src] crates.io server, `src/controllers/trustpub/tokens/exchange/mod.rs` (main, 2026-10-15),
  https://github.com/rust-lang/crates.io : entries matched by repository owner and name
  (case-insensitive), by repository owner id, by workflow filename; an entry with no environment is
  kept for any JWT, an entry with one requires that environment, case-insensitive; `pull_request_target`
  and `workflow_run` triggers are refused.
- [crates-action] rust-lang/crates-io-auth-action README, https://github.com/rust-lang/crates-io-auth-action :
  the token is an output of the action and is revoked in its post step.
- [cargo-publishing] The Cargo Book, "Publishing on crates.io", https://doc.rust-lang.org/cargo/reference/publishing.html :
  a publish is permanent, a version can never be overwritten and code cannot be deleted; yank
  semantics.
- [cargo-yank] The Cargo Book, `cargo yank`, https://doc.rust-lang.org/cargo/commands/cargo-yank.html :
  a yank removes the version from new resolutions, leaves existing lockfiles working, deletes
  nothing, and `--undo` reverses it.
