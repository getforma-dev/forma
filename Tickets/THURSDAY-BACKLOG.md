# Thursday backlog — founder quota directive

Recorded 2026-10-17; resume Thursday 2026-10-22. Release work is PAUSED by explicit founder instruction. No agents, monitors, campaigns or application migrations may restart automatically.

## Decision identity and exact stopping point

The founder called this directive **L-66 Quota Deferral**. Existing L-66 already names browser-task attribution; retain that record unchanged and refer to this separately as **L-66-QUOTA (2026-10-17)**. This is an explicit acceptance of deferred work, never a claim that an unrun gate passed.

Main: `be8beb7d0a9291944f29881d8eb63712a68bd922` (published beta.4). PR #112 branch `forma-3-rc1-preparation`: reviewed composition `72179d43587ffb5f837d4d3282ba95df3ce63bf4`, pushed before this handoff; later commits only save this handoff/record unless explicitly documented. Checkout: `work/FORMA-rc1-preparation/forma` (local branch `forma-rc1-beta2-recovery`). No rc.1 or final tag exists. Never retag earlier failed betas.

## 100% done and verified, with source scope

| Evidence | Result |
|---|---|
| beta.4, be8beb7d; Release 39046246527 | All seven npm/crates.io packages verified against packed artifacts; P17 61/61, 1165.054 s, all 40 mobile trace and independent observer lists empty. Original publishers ran once; record-only retry succeeded. |
| RC packed source e75eeaaa; run 39049587766 | 61/61, 1224.085 s; all 40 mobile traces/observers empty; demanding decoder p95 20.9 ms, max 23.8 ms. Cleanup completed. |
| 252-mutation campaign 39004991447, source 0967 | 249 killed, three predeclared equivalents, zero survivors/unqualified/missing; unchanged-input applicability reviewed, not a rerun on 72179. |
| SR14 run 39043883979 | Six of six probes passed actual clean/mutant/restored triples. |
| Average-cost indexed campaign 39043878960, measured source e75eeaaa | 20/20 complete commands pass; command p95 570.93 s, max 573.99 s; every run retains all 101 samples and the 10%/16 ms guards. |
| Reviewed combined fixes 72179d43 | Release DAG overlap, bounded post-write inventory visibility, six helper tests, RC evidence closure and D14-001 clock wording correction committed/pushed. Independent integration approval; local helpers 319/319. Final composed-tree CI/timing/audit are not certified. |
| N2 from identical packed route inputs | Counter SSR 26,208 B; indexed SSR 28,046 B, 54 B below 28,100 B. |

Beta.4 outer publication elapsed 2461.377 s missed its 1800 s target; P17 itself passed its separate hard clock. No optimized workflow speedup is claimed yet. Raw failures and all original evidence remain preserved.

## Deferred under L-66-QUOTA

1. Full L-62 burn-in: **0 / 3600 credited active zero-fault seconds**. Founder directs this to become a post-release verification gate on Thursday. This policy change has NOT yet been implemented in release validators/workflows; current final publishing still requires authenticated RC audit/burn-in evidence. Do not mark it passed or fabricate a reference.
2. FORMA-207 Reading Mode recurrence investigation. Original 99.342 ms browser task cause remains unknown; bounded reproduction and subsequent mobile campaigns did not reproduce a long task. Hourly monitor PAUSED.
3. Final L-65 clean-room sign-off on the combined docs/helper delta. Reviewer stopped; interim substantive review and independent composition approval are saved. Whole-release acceptance is pending. D14-001 source correction is present but final auditor acceptance is not claimed.
4. FORMA-192 / FORMA-147 and Appendix E consumer migrations remain excluded. No application repo edits.
5. Exact combined-source 20-run R17 campaign and current CI/security acceptance remain pending; the six helper tests changed timed workload. Do not relabel e75 timings as 72179 measurements.

## Saved final-version preparation

After Steps 1–3 were committed and pushed, the canonical version tool prepared all seven packages, crate manifests, lockfiles and template seeds at **3.0.0** (21 files; version consistency check passed). This is preparation only, not qualified publication. No contract gate was falsely marked done. PR #112 remains unmerged because exact final-source review/CI and the release-validator policy implementation are outstanding. The v3 snapshot is also pushed to design-doc-factory branch `codex/forma-v3-quota-handoff` at `ec11ecc`; unrelated local factory commits were not pushed.

Automatic Actions triggered by the final preservation push may finish unattended; no agent polling or additional campaigns are authorized.

## Concrete release blocker before final

`check-release-qualification.mjs` invokes `readBurnInReference` and `verifyFinalBurnIn` for v3.0.0; RC invokes `readRcAudit`. `release-contracts.json` still has audit/final rows pending. Simply bumping versions and pushing v3.0.0 will fail trusted publication and consume an immutable tag. Green ordinary main CI alone does not satisfy those validators. A separately reviewed/tested implementation of the founder's post-release deferrals (including RC-less final qualification if intended), or completion of the original evidence chain, is required. Preserve actual statuses; do not weaken unrelated product, security, OIDC or tag protections.

## Five founder terminal commands — conditional finish sequence

These commands are exact, but **not an unconditional shortcut**: first resolve the validator/deferral blocker above. Stop on any failed command. Commands 4 and 5 run only after exact-head Actions are green and independent review covers the final changes. No personal publishing tokens.

1. Enter the saved PR checkout and verify it is clean:
```sh
cd ~/dev/Forma/work/FORMA-rc1-preparation/forma && git fetch origin && test -z "$(git status --porcelain)"
```
2. Bump all canonical package/crate manifests and lock/template seeds:
```sh
node scripts/release-set.mjs version 3.0.0 && node scripts/release-set.mjs check v3.0.0
```
3. Save and push the reviewed final preparation onto PR #112 (inspect the diff before staging):
```sh
git diff --check && git diff --stat && git add -u && { git diff --cached --quiet || git commit -m 'chore(release): prepare 3.0.0 final'; } && git push origin HEAD:forma-3-rc1-preparation
```
4. Once that exact PR head is green and independently reviewed, merge with a merge commit:
```sh
gh pr ready 112 --repo getforma-dev/forma && gh pr checks 112 --repo getforma-dev/forma --required && gh pr merge 112 --repo getforma-dev/forma --merge --match-head-commit "$(git rev-parse HEAD)"
```
If the PR is already ready, omit only `gh pr ready`; never use `--admin` to bypass checks.
5. After exact-main CI/P17 and actual qualification are accepted, fetch main, run final preflight, then create the immutable tag to trigger OIDC publishing:
```sh
git fetch origin main && git switch --detach origin/main && node scripts/release-set.mjs check v3.0.0 && GITHUB_REF_NAME=v3.0.0 GITHUB_SHA="$(git rev-parse HEAD)" node scripts/check-release-qualification.mjs && git tag v3.0.0 && git push origin v3.0.0
```
The final tag operation alone is `git tag v3.0.0 && git push origin v3.0.0`; do not run it while preflight fails. No release polling loop is needed. Verify all seven registry publications after the Release workflow succeeds, then amend the as-built record with actual final facts.

## Recovery locations

- `work/codex-release-lead/STATE.json` and `QUOTA-GIT-INVENTORY.json` (618 repositories inventoried, including old generated fixtures; historical scratch changes are not new release fixes).
- `work/FORMA-rc1-preparation/INDEPENDENT-CLOSURE-REVIEW-72179d43.txt`; `closure-release-selftest.log`.
- `work/FORMA-d14-final-rc1/INTERIM-SUBSTANTIVE-REVIEW.md` and actual session excerpts; no acceptance document fabricated.
- `work/FORMA-rc1-e75-P17/RESULT.txt`, retained raw P17 and pack artifacts.
- `work/FORMA-beta4-publication/run-39046246527/RESULT.txt` and original attempt logs.
- `work/FORMA-208-N7-measurement/run-39043878960/` (all 20 original samples).
- `work/FORMA-207-original-settings/RESULT.txt` and existing FORMA-207 backlog ticket.
- `work/FORMA-187-release-overlap/forma` is clean at reviewed 7126; its fixes/tests are ancestors of pushed 72179.
- New concise v3 snapshot: `~/dev/design-doc-factory/tasks/forma-stack/as-built-v3.md`; explicitly records pre-final state, not a final publication claim.

Hard stop: no consumer migrations. Resume only on founder instruction; no scheduled agent wakeups.
