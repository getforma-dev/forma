# Monday release handoff — 2026-10-19

The founder corrected the resume date: **Monday, October19**, not ThursdayOctober22. Release work is ACTIVE by today's explicit instruction. Earlier pause/Thursday statements below and in historical records are superseded for scheduling. Post-release soak authorization remains recorded separately; no unrun gate is a pass.

## Verified now

- PR112 merged with merge commit `ee7e5751e5d0df5b285e9d176554314fe60e5dca`; remote main unchanged.
- Main CI39056716276 checked ONCE today: completedSUCCESS at that exact commit. https://github.com/getforma-dev/forma/actions/runs/39056716276
- Main prepares all seven packages at3.0.0. No rc.1/final tag exists. Beta.4 remains published; stableLatest badge still refers to the prior stable release.
- No open PRs at resumption. New working branch:codex/forma-monday-release-resume, based on exactmain.
- Prior focused independent review approved2e98b588, identicaltree679e9718a0036ed853e31b0f6e94f70f6fee966e. This is not whole-release audit acceptance.

## Active next steps

1. Existing fresh-context independent reviewer rc1_whole_release_audit resumed read-only on exactmain. Confirm D14-001 closure and report remaining evidence gaps; do not manufacture acceptance.
2. Collect the still-missing exact-composed-source packed P17 and complete20-run R17 qualification on Actions, preserving every outcome. Earlier e75 evidence stays source-bound.
3. Resolve the implementation gap between founder-approved post-release soak and the existing pre-final validators. Keep actual audit/soak statuses distinct from passed; retain OIDC, immutabletags, exact-source P17 and independent review. No tag while preflightfails.
4. Complete required release preparation, review/CI and trusted publication; verify seven final packages. Then update the concise v3 record with actual final facts and complete delivery.
5. Hard stop before AppendixE consumer migrations. FORMA207monitor remains paused to avoid duplicate monitoring; recurrence evidence can be checked in newP17 artifacts.

Original evidence locations and failed outcomes remain in THURSDAY-BACKLOG.md (historicalfilename retained for existinglinks). The20-run average-cost result and61/61P17 on e75 remain valid for that source, not substitutes for new outcomes. Auditandsoak creditedcompletion remainpending/zero until verified.

## Monday work in progress

The resume branch now prepares **3.0.0-rc.1** (`e4d59b9e`), preserving beta → audited published RC → final. Main remains `ee7e5751` and its successful CI is unchanged. Canonical version consistency and20/20 docs checks pass on the RC preparation.

- Main-source packed P17:39285412822; full20-run R17:39285416133, measured sourceee7e5751 (donorworkflow0c380a2e). Both were still queued at the latest observation; no repeated dispatches. Actual handles saved inwork/codex-release-lead/MONDAY-QUALIFICATION-RUNS.json.
- Existing fresh-context auditor completed the ee7 source/evidence recheck: no new blocking product/security defect, D14-001 resolved. This is not final acceptance of the upcoming combinedRCtree. Receipt:work/FORMA-d14-final-rc1/RESUMED-MAIN-REVIEW-20261019.md.
- recover_ci_fixes implements the narrowly scoped post-final soak path in isolated work/FORMA-187-release-overlap/forma. Actual audited published RC, originalP17, exact reviewed finaldiff and immutable packageidentities remain required. Normal completed-soak path remains. New controls belong torelease-workflowCI; do not silently weaken or replace R17 samples.
- Founder decision captured separately in design-doc-factory tasks/forma-stack/decisions/L-66-QUOTA.md (e652402) and mirrored indocs/release/L-66-QUOTA.md. This is a decisionrecord, not proof of any test or audit.

Next: integrate the finite policy patch, independently review/freeze exactRCsource, validate CI andqualification applicability, then obtain actual D14acceptance. No tag untiltheactual preflight succeeds. After final publication run theexisting authenticatedRC burn-in and complete v3 withactualoutcomes, thenhalt.
