<!-- codex-live-start -->
# START HERE — bounded CI repair resumed by founder, 2026-10-17

## Resumed bounded work — 2026-10-17

Founder explicitly resumed quick wins with 8% quota; this supersedes the earlier blanket pause for this bounded session only. Monitor and sub-agents remain stopped. No expensive campaign or release dispatch is authorized by this update. PR112's b58 CI39052507411 failed four documentation consistency assertions in three jobs; FORMA-216 records the fix. Existing docs-truth20/20 passed locally with locked Vitest4.1.12. Five prose files changed; no product/test/threshold changes. The next pushed head needs ordinary CI and independent review; no merge/tag yet. Main remains be8beb7d; stableLatest is server-v0.2.2, while beta.4 is a published prerelease. Thursday deferrals and validator blocker remain unchanged. See3-in-review/FORMA-216.md.

**Read [THURSDAY-BACKLOG.md](THURSDAY-BACKLOG.md) first.** L-66-QUOTA is distinct from the earlier L-66 attribution record. Stop agents/monitors; no new campaigns. Resume Thursday 2026-10-22 only when the founder asks.

Beta.4 is published and verified on main be8beb7d. RC P17 completed 61/61 on e75eeaaa with all 40 mobile traces/observers clear. Mutation 249 killed + 3 equivalents, six SR14 probes, and 20/20 average-cost indexed runs passed with original source scope preserved. Reviewed fixes (including six helper tests and clock correction) pushed to PR112 as 72179d43. Independent source approval is saved; whole-release audit, current-source timed campaign and CI acceptance remain pending.

Founder deferred the 3600-second soak to post-release Thursday and final audit sign-off to backlog. **Release validators still require their evidence: a version bump/tag alone cannot publish final.** No fabricated success or reference. Backlog contains exact guarded founder commands, implementation blocker, evidence locations and remaining work. Final manifests/locks/template seeds are saved at 3.0.0 on PR112; version consistency passed, final-source review/CI and validator implementation pending. No RC/final tag exists; main remains be8beb7d. v3 is a concise pre-final as-built snapshot, not proof of final publication.

All earlier START HERE sections below are historical. Do not restart workers or follow their superseded queue automatically. Hard stop before application migrations.
Additional bounded fix: root and all seven package changelogs now identify the prepared3.0.0set without a publication claim. Real changelog parser8/8 and release-record tests11/11 pass. Thursday backlog now includes the exact cross-layer implementation map for the founder deferrals. No merge/tag; inspect latest PR112 head, not obsolete cancelled runs.
<!-- codex-live-end -->

# START HERE: HANDOFF TO THE NEXT LEAD (written 2026-10-15 19:10 EDT by the Claude lead; the Codex lead takes over)

**Goal and the stopping point (founder, L-57/L-58 in `~/dev/design-doc-factory/tasks/forma-stack/decision-brief.md`).**
Finish Forma 3.0.0 inside `getforma-dev/forma` only: beta.1 → rc.1 → 3.0.0 final, then write v3 (the as-built
design record in `design-doc-factory/tasks/forma-stack/`), then **HALT**. No application repository is touched
(no appendix E migration; ksx/fAuth/Ledger runs are informational only). Release gates are ONLY: the internal
suite R17 (`scripts/check.sh`), the two create-app templates, the parity harness (FORMA-183, `e2e/parity/`), and
the fixture apps + P17 (FORMA-188). The first consumer of 3.0.0 is a new application: do not design or ticket it.

**Founder decisions in force.** L-57: D9 (Q10 reserve `s`; Q11 `renderBoth` Forma-internal; Q12 Lighthouse mobile
+ the ksx dev machine; Q13 refuse to start on a bad module) and Q14-Q18 defaults confirmed; public names
`previousDist`, `security`, `FORMA_SECURITY_RELEASE`, `RouteMapping.canvas` approved; L-56 accepted (a failed
dynamic import is the application's). 182's three proposals deferred to 3.1 unless a failing parity case needs
one (F2 does). **L-58: N2 = 27,500 B gzip -9 of Forma code per route for 3.0.0; core's package caps are
re-anchored by the lead after each reviewed feature to measured + 300 B, with a CHANGELOG line.**

**Repository state.** `main` = `6096f6b` (3.0.0-dev; `3.0.0-alpha.2` published on npm `next` + crates.io).
Integration branch **`codex/forma-upgrade-review` = `29121e5`** (draft PR #44 into main; it merges into main
as ONE history-preserving PR at beta.1). Merged into it today: #57, #60 (181 seam, B), #58, #62 (183 slices
1-2), #61, #63, #70 (186 identity, stamp, follow-up), #59 (190 size report).

**Open PRs, in merge order (all against the integration branch; merge commits only; each was reviewed by an
independent agent of a different model; review URLs are on each PR):**
| PR | Ticket | State at 19:10 | Next |
|---|---|---|---|
| #64 `forma-182-rules-2-7@a86d555` | 182 value rules 2-7 | approved twice (5540291543, 5540861009); round 2's fix `3afcdda` checked by the lead (getter-as-call only for createShow's argument; an uncalled getter elsewhere is BUILD-615 naming the call); CI green on every job; **CONFLICTING** with the integration head (#59/#62/#70 landed after its last merge of 49c6146) | FIRST: merge `29121e5` into it (merge commit), resolve, CI green, merge. Then 182's F2/F3: `forma-182-attribute-values@062bb96` is done and green locally (three engines 558/558), no PR: merge the head in (expect `typed_pages.rs`: keep both), gate, open its PR with `work/FORMA-182-rules/tmp/pr-body-FORMA-182-attributes.md`, review, merge, then delete 183's three F2/F3 expected-divergent entries |
| #75 `forma-190-n2-27500@a52a559` | 190, L-58 | N2 constant 25,500 → 27,500; 19 green, 2 pending | needs an independent review (small), then merge; it unblocks #71 |
| #71 `forma-181-checkpoint-c` | 181 C, adoption by key | **approved** (5541015649); CI red ONLY at BUILD-819 (ledger-arrival 17 B over the old 25,500) | after #75: merge the head into it, CI green, merge. Should-fix after: a focus/selection/listener assertion across a reorder; document or pin that unkeyed ranges now refuse fractional/lone-surrogate keys |
| #72 `sync-main-into-integration@459fb0e` | main → integration | 10 conflicts resolved (table in the PR body; handoff comment issuecomment-6204236415); on the first head 6f8e602: CI all green, R17 local 280 s, **P17 with `packages/*/dist` removed 36/36**, no ERR_MODULE_NOT_FOUND; 459fb0e re-merged the base (one CHANGELOG conflict), its CI pending | independent review, then merge; then regenerate 188's P17 evidence with `packages/*/dist` removed |
| #73 `forma-181-f1-list-source` | 181 F1 (compiler refuses a non-function createList source) | Windows CRLF hash fix pushed (`ba9df32`) | CI green, independent review, merge |
| #69 `forma-186-retention@59085be` | 186 S2 retention + security mark | changes requested (5540952771): flag failed open; fixed in `59085be` (`FORMA_SECURITY_RELEASE` parses like `FORMA_STRICT`; an unknown value fails with new BUILD-822; trust note added); local build 317 + compiler 978 pass; CI had just started | back to a reviewer (check `FORMA_SECURITY_RELEASE` parsing: 1/true mark, 0/false/empty don't, anything else fails the build), merge |
| #67 `forma-190-frame-minify@2bba607` | 190 frame runtime minified into the app's dist | approved before (5540559068); retargeted + head merged in; 18 green, `windows-node` failed (log unread: `gh run view 38821251414 --job 116718083379 --log-failed`) | read the failure (rerun if a timeout), fix, quick re-review, merge |
| #65 `@7481fab` → #66 `@ff2f247` → #68 `@6b2acc7` (ready, no longer draft) | 188 fixture apps, bench pages, P17 fixtures | #65 changes requested (variant pages could pass with no island activated; private-repo strings replaced); #66 approved; #68 changes (same gap; N2 must be read from the packed build's size-report.json, never hard-coded); fixes pushed | fixes pushed but NOT yet re-reviewed: re-review #65 and #68 first (the variant-activation fix and the synthetic strings; #68's N2 read from the packed size-report.json), then merge in order; then regenerate the P17 evidence with `packages/*/dist` removed (after #72 and #75) and move the fixtures' lists back into islands (L-58); steps in FORMA-188's 19:13 log line |
| #74 `forma-183-parity-step1@dadfe09` | 183 slice 3 (28 modules, 100 states, 3 engines; 87/87 local) | CI restarted on dadfe09 | independent review, merge; slice 4 (the blocking switch) when expected-divergent.json is empty for P1/P2 |

**Work with no PR yet.** 182 F2/F3 (`forma-182-attribute-values@062bb96`, done and green locally; see #64's row):
bool-slot attributes on data-*/aria-* take core's "true"/"false" (walker presence only for HTML boolean
attributes), '' is not null on the server, `aria-pressed` no longer writes "". 016 F5 (`forma-016-show-text-branch@de568e3`, wip, tests and core change done, no PR): createShow, createSwitch
and createList rows accept a string/number as a Text node (helper `branchNode`); remaining gate: cargo fmt/clippy,
`cargo test --locked -p forma-ir`, the parity harness; then the PR. Size +68 B on core's entry measured on the
base WITHOUT #71: with #71 (+171) the entry is ~46,534 B, over 46,500: re-anchor the cap per L-58 in whichever
of #71/016 merges second. 186 S4 (core skew compare: read
`data-forma-build` from the root element, not the first match) and S5 (the drill) start after #64 and #71 merge;
re-anchor caps per L-58. Each ticket's last Log line has branch@SHA and the exact next step.

**Parity findings (FORMA-183's harness), each an expected-divergent entry naming its ticket until fixed:** F1 →
181 (#73); F2, F3 → 182; F4 `a[href]` BUILD-206 by design (entry must cite its record); F5 → 016; F6 → 181 C (#71).

**Size now:** core entry 46,466 / 46,500 B after #71 (34 B left; re-anchor per L-58 when a feature passes it);
Counter route ~25,200 B, ledger-arrival ~25,520 B, a list island ~26,400 B, all under 27,500 once #75 lands.

**Remaining to 3.0.0 (order):** beta.1 = the PRs above + 182 F2/F3 + 016 F5 + 183 slice 4 (blocking) + 184
(`renderBoth`, Forma-internal) + 188 done, then #44 into main and the beta.1 tag per `docs/release/ALPHA-RUNBOOK.md`
(never retag; a failed tag is fixed by the next version). rc.1 = 101, 139, 129/108, 186 S4/S5, 190 rest, 141, 116,
189, the whole-release audit on a different model (D14). final = 144 slice 3, 191, 192's rc run (informational),
147, the soak. Then v3, then halt. Inventory: `work/inventory-3.0/INVENTORY.md`.

**How the lead works here.** Read this block, then each ticket's Log, then GitHub (another lead may have moved
things). Merge only after CI green + an independent review by a fresh agent (different model from the author when
possible); subagents never merge, tag or publish; never retag; trusted publishing only, no tokens; never touch
`~/dev/FormaStackDev`, `~/dev/FormaBuiltApps` or any application repository; agents work in `~/dev/Forma/work/<ticket>/`
fresh clones with their own ports (76xx) and kill only their own PIDs; cap build parallelism on this Mac (16 GB,
10 cores): `CARGO_BUILD_JOBS=3`, vitest `--maxWorkers=2`, Playwright `--workers=2`, one heavy suite at a time
(seven uncapped agents drove load to 100 today); delete `node_modules/`/`target/` when done; read `date` before
any timestamp here. Machine notes: if `syspolicyd` pins a core, new binaries stall at launch: `sudo killall
syspolicyd`; Docker Desktop off frees 8 GB.

---

# START HERE (next session; written 2026-10-15 18:26 EDT by the Claude lead before a machine restart)

**State.** Forma Stack v2 programme, package 3.0.0. `3.0.0-alpha.2` is published (npm `next`, crates.io).
`main` = `6096f6b` (3.0.0-dev). Integration branch **`codex/forma-upgrade-review` = `7b7b575`** (draft
PR #44 into main; do not merge until beta.1). Merged into it this session: #57 (181 seam), #60 (181
checkpoint B), #58 (183 harness slice 1), #61 (186 identity).

**The founder's decisions (L-57 in the decision brief, 2026-10-15):** D9 and Q14-Q18 confirmed;
`previousDist`, `security`, `FORMA_SECURITY_RELEASE=1`, `RouteMapping.canvas` approved; L-56 accepted;
the lead may restate N2 to 26,000 B if FORMA-186 lands at most 500 B over 25,500 (record the figure);
182's three proposals deferred to 3.1 unless a failing 183 parity case needs one (F2 does: in scope).
**beta.1, rc.1 and 3.0.0 are gated ONLY on forma's own gates**: R17, the two create-app templates,
FORMA-183's parity harness, FORMA-188's fixture apps + P17. No application repository is touched;
FORMA-192/147's application runs are informational. **Drive beta.1 -> rc.1 -> 3.0.0, write v3 (the
as-built record), then HALT** before any appendix E migration. Do not design or ticket the first
consumer application.

**Open PRs at the pause (all against `codex/forma-upgrade-review` unless noted):**
| PR | Ticket | State | Next |
|---|---|---|---|
| #64 | 182 rules 2-7 | approved (5540291543); review items 1-5 done at `a74f610` | CI run 38817103018 on `a74f610` was running: if green, merge. F2/F3 WIP on `forma-182-attribute-values@09c22e7` (deliberately red): next core (`true` -> "true" off the boolean set), compiler (F2 static `true`, F3 static `name=""`), tests, corpus regen, own PR |
| #59 | 190 size report | approved (5540558906) | `forma-190-size-report@c0ac415`: integration `7b7b575` merged in (186's banner attribution + route classes both kept), forma-server CHANGELOG line, `an_embedded_size_report_is_not_served_through_the_route`; CI run 38817203225 was running: if green, merge (self-check the conflict resolution first). Then #67's retarget, merge-in and nits (ticket log) |
| #67 | 190 frame minify (base `forma-190-size-report`) | approved (5540559068) | after #59: retarget to integration, fix CHANGELOG conflict, nits; merge |
| #62 | 183 slice 2 | **changes requested** (5540626685): P2 vacuity B1/B2, S1-S5 | `forma-183-parity-suite@be5aecd` = wip: B1, B2, S1-S4 written, untested; next S5, the tests for B1-S3, wording; CI green; back to the same reviewer. Slice 3 WIP `forma-183-parity-step1@aae04c4` (no PR) resumes after |
| #63 | 186 S3 server stamp | **approved** (5540680822) at `1e15ba6` | merge once `candidate-scaffold (windows)` is green; after merge: fix the vacuous `phase1_renders_empty_app_div` negative (check no `data-forma-ssr` at all) and two stale lines in docs/compatibility.md; S4 must read `data-forma-build` from the root element, not the first match |
| #69 | 186 S2 retention | head merged in at `1d46b10` (+30 s timeouts on two load-sensitive build tests), CI re-running | author runs `work/FORMA-186/tmp/check-rest2.sh` (gate remainder, capped); then independent review |
| #65, #66, #68 | 188 S1 fixture apps `89678b4`, S2 bench pages `333736c`, S3 P17 fixtures `2c170c4` (draft) | all green, stacked, NOT yet reviewed | independent reviews in that order; mark #68 ready after #66; plan at `work/FORMA-188/PLAN.md` |

**Agents** were all told to commit/push WIP and log their stopping point before the restart; each
ticket's last Log line has branch@SHA and its next step. In flight: 181 checkpoint C
(`work/FORMA-181-B/forma`, branch `forma-181-checkpoint-c`), 182 (`work/FORMA-182-rules`), 183
(`work/FORMA-183`, slice 3 paused until #62 is fixed), 186 (`work/FORMA-186`; S4 core waits for 181 C
and 182), 188 (`work/FORMA-188`), 190 (`work/FORMA-190`). Findings: F1 (compiler accepts a plain-array
`createList` source) -> 181 after C; F2 (bool-slot attributes on data-*/aria-*) and F3 ('' decoded as
Null on the server) -> 182 after #64; F4 by design (cite its record).

**181 C:** paused at `forma-181-checkpoint-c@a8ab0f9` (pushed, clean); next: open its PR, dispatch
`e2e-engines.yml` on the branch (one Firefox timing test SR33 failed only under load), CI green, review.

**ANSWERED 18:41 EDT as L-58: N2 = 27,500 B for 3.0.0; core caps re-anchored by the lead (measured + 300 B) after each reviewed feature. 190 changes the constant; 181 C and 186 S4 re-anchor caps in their PRs; 188 moves lists back into islands.** Was: an island that holds a client-side
`createList` is **26,366 B** of Forma code, over N2's 25,500 B and over the pre-approved 26,000 B
(`createShow` +241 B, `createList` +1,282 B on the smallest island). Real consumer shapes (the
studio's chips, the service's results table) are lists in islands. The fixtures keep lists outside
islands to build (routes 25,317-25,415 B, 85-183 B under; 181 C's +94 B and 182 will trip them);
`negative/list-island` pins it. Options: restate N2 again (with figures), cut list code, or a route
class for list islands. Ask the founder; do not raise a cap without the answer.

**Also on resume:** merge `main` (holds #54, P17's packed-set resolution) into the integration branch:
P17 with `packages/*/dist` removed still fails there with alpha.1's `ERR_MODULE_NOT_FOUND`. 188's
other findings (fixtures README): computed conditions, prop spreads into islands and conditional
attributes are BUILD-610 on real shapes; `has_oauth` derives `hasOauth`; a reactive boolean
`aria-pressed` writes `""` (with F2 in 182).

**Size (tight):** with 181 C the Counter route is 25,195 of 25,500 B (N2) and core's entry 46,466 of its
46,500 cap (34 B left); 182 adds +12/+15 B to core, 186 S4 needs ~300-400 B. Expect: N2 to 26,000
(pre-approved by the founder for 186, record the figure) and a decision on core's package cap
(ratchet set by L-55 under L-51): measure after 181 C, 182 (#64, F2/F3) and 186 S4, then decide or
take it to the founder if any cap rises beyond what L-57 allows.

**How the lead works here:** autonomy; merge (merge commit) after CI green + an independent fresh
review by a different model from the author (Sonnet author -> Opus reviewer and the reverse; Fable's
credits are out); subagents never merge, tag or publish; never retag; never touch
`~/dev/FormaStackDev`, `~/dev/FormaBuiltApps` or any application repository; no tokens; agents use
their own port ranges (7600-7699 assigned per ticket) and kill only their own PIDs; cap build
parallelism (`CARGO_BUILD_JOBS=3`, vitest `--maxWorkers=2`, Playwright `--workers=2`): the Mac has
16 GB and 10 cores; delete `node_modules/`/`target/` when done; never hard-link from another agent's
folder; read `date` before writing a timestamp here. No tag is cut from the integration branch
between 181 B and C.

**Before relaunching anything:** check each ticket's last Log line and its branch on GitHub; the
restart killed every agent, so all of them need relaunching from their folders.


**Resumed 18:38 EDT after the restart (same lead session):** machine healthy (swap 1 GB, Docker off,
83 GB free). **#63 merged** → integration = `49c6146`. Resumed from their transcripts: 182 (F2/F3),
183 (#62 fixes), 181 (C's PR), 186 (#63 follow-up, #69 gate), 190 (#59, #67). New: a reviewer for
#65/#66/#68 (Opus) and an agent merging `main` into the integration branch (PR). The N2/list-island
and core-cap questions put to the founder.

- 18:48 EDT: L-58 recorded (decision brief `f27cce6`). #64 green but held: commit `aea680a` (new
  compiler folds after the review) sent back to its reviewer. #65 (188 S1) changes requested
  (5540856505): variant adoption tests could pass with no island activated (`interact` fallback);
  fixtures carried verbatim strings/classes/colour from the PRIVATE gatewasm and ledger repos into
  public forma: replaced with synthetic ones. The reviewer continues with #66.

- 18:57 EDT: 188 reviews done: #65 changes (variants unproven; private-repo strings), #66 approve
  (after #65), #68 changes (same variant gap; N2 hard-coded 25,500 → read the packed build's
  size-report.json after #59; mark ready so CI runs; regenerate evidence with dist removed after the
  main sync). #64 held for the ternary-getter fix. #69 and #70 (186) with the Opus reviewer (#70's
  lead self-review was refused by the auto-mode classifier as self-approval).

- 19:02 EDT: **merged #70** (186 #63 follow-up; reviewed 5540917867) and **#59** (190 size report;
  round 2 5540959300). Integration = `a42319a`. #69 changes requested (5540952771): the security flag
  failed open (only exactly `1`); fix: `1`/`true` mark, `0`/`false`/empty don't, anything else fails
  the build. #62 round 2 with its reviewer. F5 (createShow string branch throws in core) → FORMA-016
  (no agent yet). 190 now on #67 and the N2 27,500 PR.

---

# Lead resumed 2026-10-15, 09:10 EDT (Claude Code on Fable 5.1)

Resumed at the founder's request from the Codex lead's stop checkpoint
(`work/STOP-CHECKPOINT-20261015-0858.json`) and the two agent handoffs (181, 182). Everything
recorded below from "PAUSED AT USER REQUEST" down is the work of the Codex lead and its agents
(recover_history, review_merge, resume_fmir) between 2026-10-14 ~21:45 and 2026-10-15 08:58 EDT:
the repository cut (PR28, history preserved), PR29 to PR31 and PR37 to PR43, the old repositories'
retirement, FMIR v3, declared props, Trusted Types enforcement, the typed render API, asset
integrity, the templates' slice 1, strict adoption in integration, and the evidence folders under
`work/`. Their branches, WIP, archives, failed runs and logs are kept as they left them. The resume
follows their recorded order: fresh packed qualification from `3e27c5c6`, then 181 checkpoint A,
then 182 normalization, then the size caps and the remaining gates before any PR.

Housekeeping on resume: reproducible build output (`node_modules/`, `target/`, `dist/`) was deleted
from the work folders of finished tickets only (disk was at 12 GB free); sources, patches, logs and
archives untouched; in-progress folders (103, 104, 105, 181, 182, 021, 144 and their reviews) untouched.
Commits made from here carry `Co-Authored-By: Claude Fable 5.1`; the Codex commits keep theirs.

## Lead log (Claude, from 09:10 EDT)

- ~09:50 EDT: **Resume step 2 done, the packed set from `3e27c5c6` is qualified on darwin**
  (`work/qual-3e27/EVIDENCE.md`): 171/171 scaffold cases (153 light + 18 heavy, both templates) and
  P17 35/35; DS11 record `ef9b00b8…0953`. The core, compiler and build tarballs are byte-identical to
  the 12fc set, so the production code is the one the 166/167 run exercised; the one failure is gone
  (release profile: no Report-Only header, zero console errors in all three engines). The P17 per-wire
  fix `a444ee7` holds in a real replay. Open as before: Linux/Windows lanes, the four size caps, core
  browser 351/354 (182), 181 WIP. `codex/forma-upgrade-review` is now on origin unchanged (safety copy).
- Dependabot #32 to #35 merged after an independent review (every SHA = its tag; actionlint and SR43
  pass; checkout v7's fork-PR block affects no workflow; setup-node 7 makes `package-manager-cache:
  false` a real input, so rule N1 now bites); #36 after its rebase. Follow-up on FORMA-117: 33 pins
  without a version comment, and no lint for the comment.

---
- ~09:40 EDT: Dependabot #36 merged after its rebase (`de0358e`); main CI green at `b68a795`.
  Draft PR #44 opened from `codex/forma-upgrade-review` so the hosted lanes run on the integration
  branch (not for merge until the gates close).
- ~09:45 EDT: **FORMA-021 D6 taken (L-55)**: DR-35's fallback; N2 restated to 25,500 B gzip -9 of
  Forma code per route; safe cuts C1 to C3 before the tag (branch `forma-021-safe-cuts` in progress);
  core/browser caps ratchet to 46,500 after them. G3's 20 KB put to the founder.
- ~10:00 EDT: **FORMA-181 checkpoint A done** (`bb6435f..4d51d90`, branch on GitHub, CI dispatched
  38744835856): compiler 924/11 → 973/0, originals archived with a ledger before regenerating six
  fixtures, BUILD-612/613 catalogued, the 182 seam at `packages/compiler/src/key-text.ts`. Under
  independent review (`work/review-FORMA-181/`). B/C deferred.
- ~10:02 EDT: **FORMA-182 rule 1 done** (`f1b2e536..e695c160`, branch pushed to GitHub by the lead;
  CI 38745227708): shared vectors `crates/forma-ir/tests/fixtures/parity/normalization.json`;
  forma-ir and core first failures kept; after: core 2646/2646, **browsers 354/354 in all three
  engines** (was 351/354). Review point: `java\0script:` now written normalized, not refused. Under
  independent review (`work/review-FORMA-182/`). Size caps unchanged (FORMA-021).
- ~10:05 EDT (the times in this lead log before 11:00 were estimated, not read from a clock; the order is right): **Inventory of the remaining 3.0.0 work** (`work/inventory-3.0/INVENTORY.md`, verified
  on `3e27c5c6`: core 2,382, compiler 924, build 271; size gate reproduces; hosted `check` fails only
  at the caps; `windows-node` fails 4 tests; both candidate-scaffold lanes pass; the FMIR nightly fuzz
  is green on hosted CI; `maint/*` branches exist in all four old repositories). About 345
  agent-hours remain (43 agent-days, range 30 to 70; FORMA-183 the parity suite is the largest).
  **Order to the release:** (0) now: C1 to C3 + ratchets, the 4 Windows fixes, merge `3e27` into 181
  and 182, their reviews, close 185, 192's A2 baseline; (1) `3.0.0-alpha.1` from `main` (which holds
  every M2 ticket) once 187's gate is milestone-aware, in one session with the founder's registry
  re-pointing (npm's two-day window); (2) `beta.1`: the integration branch into `main` as one
  history-preserving PR, then 183, 184, 188, 182 rules 2 to 7; (3) `rc.1`: 101, 139, 129/108, 186,
  190, 141, 116, 189, D14 audit; (4) final: 144 slice 3, 188/191, 192 rc run, 147, the soak.
  Reviews: 181 checkpoint A requests changes (B1 stale props-contract fixtures; S1 to S4); 182 approve
  with should-fix (NUL in URLs refused again, the `pre` rule, the seam moves to core); both authors
  are applying them. Launched: the Windows fixes, 185's seeded qualification, 192's baseline, 187's
  alpha gate and runbook.
- ~10:20 EDT: **FORMA-192 run 1, the A2 baseline, done** (`work/FORMA-192/A2-BASELINE.md`; ksx is
  `Victor-Villacis/ksx` `0cb57e2`, fAuth `getforma-dev/gatewasm` `b750ca5`, fresh clones, nothing
  pushed): ksx clean under strict (0 errors, 60 notes); fAuth 110 coded errors at 96 sites (its
  migration, FORMA-152); depth count 0 for both, so L-26 stands and FORMA-101 reads 0. Two ksx
  migration items logged on FORMA-149. 181 round 2: approve with two Windows residues, being fixed,
  then its PR against the integration branch.
- ~10:35 EDT: integration branch moved: `7b6bf99` (lead, one line: PRs against
  `codex/forma-upgrade-review` now trigger CI) and PR #46 merged (`385a17f`: the four Windows-only
  test failures; `windows-node` green on run 38748570860; test and CI files only, self-reviewed).
  FORMA-181 PR #47 open against the integration branch (head `1e0877c`, CI 38749725820 being
  watched). FORMA-182 at `43b5bdfc` (NUL in URLs refused again; the `pre` rule; 426/426 across
  engines) under re-review. 185, 187 and 021's PRs in progress.
- 11:05 EDT (clock read): two authors (021, 187) were cut by a Fable session limit at about 10:55
  and resumed at 11:02 after the reset.
- ~10:50 EDT: **FORMA-185 done**: PR #48 (the seeded-bug qualification, replayed on every PR)
  reviewed and merged into `main` as `6afe461`. FORMA-181 PR #47 green on Windows at `6e0ecb5`;
  FORMA-182 PR #50 at `45d1d49`; FORMA-021 PR #45 (`74eed0b`: all bundles under their caps, the
  route report with N2 at 25,500) under review; past the size gate the `check` job reaches the e2e
  SSR lane and fails on BUILD-611 for `e2e/ssr/cases/browser-only/app.tsx` (a base defect from the
  Codex integration, rule `861228d` vs fixture `3c34b9e`), being fixed on its own PR. FORMA-187 PR
  #49 (the milestone-aware alpha gate and `docs/release/ALPHA-RUNBOOK.md`) green, under review.
- 11:40 EDT (clock read): **FORMA-187 PR #49 merged into main as `6118f80`** after two review
  rounds (approve; "nothing blocks a live publish of v3.0.0-alpha.1 from this head"): the
  milestone-aware live gate (alpha M2 ready; beta/rc/final refused before packing; contract
  `version` 3.0.0; lint rules C1 to C5, 13 contract seeds), `--tag next` for pre-releases, the
  `--prerelease` GitHub Release, `docs/release/ALPHA-RUNBOOK.md`, regenerated evidence. The founder
  confirmed G3's restatement (L-55) and does the registry entries this afternoon. L1 (the
  `3.0.0-alpha.1` version PR) in progress.
- 11:38 EDT (clock read): integration branch: **PR #45 merged** (`e708fc9`; FORMA-021's safe
  cuts, the ratchets and the N2 route gate; every bundle under its cap) and **PR #53 merged** (the
  five `e2e/full-stack.spec.ts` failures were a stale tracked bundle from before `trustedHtml()`;
  bundles untracked, a guard case added). Remaining red on the branch: the e2e SSR lane's BUILD-611,
  **PR #51** (the lane migrated to the 3.0.0 contract, 33/33; under review). After it: #47 (181) and
  #50 (182) merge the head and go green; then draft PR #44's hosted lanes. Alpha: L1 in progress.
- 12:05 EDT (clock read): **the alpha tag `v3.0.0-alpha.1` on `8ba2930` did not publish.** Release
  run 38764599499: `check`, `engines` ×3, `pack` green; `verify` failed at 16:00Z in P17:
  `ERR_MODULE_NOT_FOUND … node_modules/@getforma/compiler/dist/index.js imported from
  .release-verify-520…` (the packed build package resolves its compiler peer through the repo's
  workspace symlink, which the verify job never builds; local dry runs had a built tree). Publish
  jobs skipped; nothing published; the founder's four npm entries (added 11:49 EDT, "Pending
  validation", window to 2026-10-17 15:49 UTC) stay valid. Per the runbook (never retag): the fix to
  the verify harness plus a bump to `3.0.0-alpha.2` in one PR, then a new tag. Earlier today: #52
  (the version PR) merged as `8ba2930` after review; #51 merged into the integration branch
  (`50143f7`), whose `check` now passes everything but core's `state-roundtrip.spec.ts:72` (#50).
- 12:29 EDT (clock read): **PR #54 merged into main as `119c12c`** after review (approve): P17 now
  links the packed `@getforma/*` packages inside its scratch and asserts, with Node's resolver, that
  every internal specifier resolves inside the packed set (the workspace can no longer stand in; a
  five-test guard reproduces the runner's state); version `3.0.0-alpha.2`; runbook L1 runs P17 after
  `rm -rf packages/*/dist`. Tag `v3.0.0-alpha.2` goes on `119c12c` once its push run is green.
  #47 (181) merged the integration head (`44e78e2`); #50 (182) merging it by hand (element.ts
  conflicts with the size cuts).
- 12:59 EDT (clock read): **`3.0.0-alpha.2` is published, the first live run of the unified
  pipeline.** Tag `v3.0.0-alpha.2` on `119c12c` pushed 16:46:12Z; run 38771766038: `check`,
  `engines` ×3, `pack`, `verify` (P17 34/34 with the packed-set resolution), `publish-crates`,
  `publish-npm` green; `record` last. Registries: npm `next` = 3.0.0-alpha.2 for core, compiler,
  build, create-app (provenance, published by GitHub Actions through the founder's new
  `getforma-dev/forma` entries, now validated), `latest` unchanged (2.1.0 / 0.3.7 / 0.3.1 / 0.6.2);
  crates.io forma-ir, forma-ir-derive, forma-server 3.0.0-alpha.2 via trusted publishing,
  `max_stable` unchanged. Alpha.1's tag stands as a record of the harness gap; never retagged.
  `record` green: GitHub Release "Forma 3.0.0-alpha.2 (alpha, M2)", prerelease, with p17.json,
  release-record.json and SHA256SUMS; published 16:59:04Z, so **G6 = 772 s** from the tag push
  (target 1,800; the runbook had expected the first figure to exceed it). The seven published files
  are byte-identical to the run's packed artefacts (lead's check). L7/L8 (P17 on the published
  bytes, the fault check) in progress. FORMA-113's
  last founder step (the npm entries) is done; the crates' entries already pointed at forma.
- 13:09 EDT (clock read): **PR #47 (181 checkpoint A) merged; the integration branch is at
  `f2e7a4e`** with 021, #53, #51, 182 rule 1 and 181 A all in; draft PR #44's hosted lanes rerun on
  it (expected the first fully green `check`). Next on the branch: the 181 seam wiring, 181 B/C,
  182 rules 2 to 7, 183's harness, 184, 188's fixture apps, 144 slice 3, the 103/104/105 residues.
- 13:30 EDT (clock read): **the integration branch `codex/forma-upgrade-review` at `f2e7a4e` is
  fully green on hosted CI for the first time** (dispatched run 38775349600: every job success,
  `scaffold` skipped by design at 3.0.0-dev). Alpha close-out: L7 P17 on the published bytes 34/34,
  nine hashes match the record, L8 `fmir_v3` 8 and `fuzz_regressions` 6 on the published crate,
  G6 768.9 s by the record (772 s tag push to Release); evidence PR #55 merged (`bd8bd1b`), whose
  CI ran the `scaffold` lane for the first time against the published set on both OSes.
  FORMA-113 closed (62 done). In flight on the branch: 181 seam + checkpoint B, 182 rules 2 to 7,
  183 plan and first slice; on main: the post-alpha `3.0.0-dev` PR.
- 13:31 EDT (clock read): launched on the integration branch (`f2e7a4e`), each with its own
  clone, branch and PR against `codex/forma-upgrade-review`: FORMA-181 seam wiring then checkpoint B
  (`forma-181-checkpoint-b`), FORMA-182 rules 2 to 7 (`forma-182-rules-2-7`), FORMA-183 plan and
  first slice (`forma-183-parity-harness`; the lead approves the plan before the full build),
  FORMA-190 size report with route classes (`forma-190-size-report`), FORMA-186 identity, retention
  and the skew drill (`forma-186-identity-retention`; plan first), FORMA-188 fixture applications and
  the P17 measurement step (`forma-188-fixture-apps`). On main: the post-alpha `3.0.0-dev` PR.
  If a session stops: each agent's work folder is `work/FORMA-<n>*/`; resume from its branch and
  ticket log.
- 14:11 EDT (clock read): PR #56 merged (`6096f6b`, main back to 3.0.0-dev; the alpha cycle
  closed). **All six Fable agents stopped: Fable usage credits ran out.** The session moved to
  Opus 5.5. State left on disk (nothing lost; WIP uncommitted where marked):
  181: seam PR #57 open (`forma-181-seam`); checkpoint B `work/FORMA-181-B/forma`, branch
  `forma-181-checkpoint-b` @ `330b65a` (1 commit) + 23 dirty files. 182 rules 2 to 7:
  `work/FORMA-182-rules/forma` @ `6ef6eb3` (3 commits) + 10 dirty. 183: `work/FORMA-183/forma`
  @ `f2e7a4e` + 2 dirty (the plan, likely). 190, 186, 188: clones only, not started.
  Resume each from its folder: verify the dirty files, commit what is coherent, continue.
- 15:41 EDT (clock read): **lead resumed after a /clear, on Opus 5.5** (Fable's credits still out;
  nothing had moved on GitHub since 14:11; the two subagents listed in the session were old and
  completed). FORMA-183's PLAN.md approved (decisions in its ticket log). Relaunched, each from its
  folder without resetting WIP, PRs against `codex/forma-upgrade-review`, ports in brackets:
  PR #57 independent review (Sonnet); 181 checkpoint B (Opus, 7600-7609); 182 rules 2 to 7 (Opus,
  7610-7619); 183 slice 1 then slice 2 stacked (Opus, 7620-7629); 190 size report on route-size.ts
  (Sonnet, 7630-7639); 186 plan only (Sonnet, 7640-7649). 188 held until a slot frees (Opus budget).
- 15:45 EDT (clock read): PR #57 independent review: **approve**, no blocking (review
  5538965116; one should-fix, the key-text.ts header's present tense about the native walker, plus
  nits; all passed to 181 B's agent to fold into its PR). **Merge not done**: this session's
  auto-mode classifier refused `gh pr merge` ("Merge Without Review"); waiting on the head to allow
  it or merge #57 themselves (merge commit into `codex/forma-upgrade-review`).
- 16:00 EDT (clock read): **FORMA-186 plan approved** (`work/FORMA-186/PLAN.md`; dispositions in its
  ticket log and as **L-56** in the decision brief: L-6, L-16, L-20 amended because core has no chunk
  loader; identity over pass-1 outputs incl. `.ir`; option names `previousDist`/`security` provisional
  for the founder before beta; no ratchet pre-raised). Its agent implements S1 to S3 now; S4 (core)
  and S5 wait for 182 rules 2 to 7 and 181 B/C (the same 399 B of N2 headroom). **FORMA-188** launched
  (Sonnet, ports 7650-7659): plan first, then fixture apps and the P17 measurement step.
- 16:25 EDT (clock read): **FORMA-183 slice 1, PR #58**, green (20 checks; the parity step in `check`
  runs 42 `node --test` tests in ~4 s on Node 24; renderBoth `create-show#0` and `nested-islands#3`
  equal). Under independent review (Sonnet). Flake to ticket: `packages/build` `static-product.test.ts`
  on windows-node (watch test, `vi.waitFor` 1 s default) failed once, passed on rerun. Slice 2 in
  progress, stacked.
- 16:37 EDT (clock read): **FORMA-186 S1 (identity), PR #61**, green on every job; 16 tests in
  `packages/build/tests/identity.test.ts`; no core size change. Under independent review (Opus; the
  question to settle is whether the identity depends on the process cwd). S3 (server stamp) is PR #63,
  CI running; S2 (retention) built, gate next.
- 16:40 EDT (clock read): PR #58 review (5539594812): **changes requested**. B1 the transport strip ran
  on the client twin too (a client writing `data-forma-island`/`-key` compared equal); S1 the edge index
  shared across fields (same-typed props identical for 43 states); S2/S3/S5 false equals (attribute
  namespace, `__proto__`, no test pinning "normalizes nothing"); S4 the U+200B holder ambiguity. Lead's
  rulings sent: fix all now; S4: a holder matches client "" or "\u200B", counted as `holderAmbiguous`,
  documented as a wire property, question logged on FORMA-182 (rule 5). Round 2 goes to the same reviewer.
- 16:47 EDT (clock read): **FORMA-190, PR #59** green (route classes on `route-size.ts`, BUILD-819,
  `size-report.json`, worker and frame rows). Lead's rulings: (1) the frame entry stays readable in
  the npm package (L-55 C10, the Socket.dev incident): `3b658e9` reverted; instead `@getforma/build`
  minifies the frame runtime into the application's `dist/` (second PR on the ticket); (2)
  `RouteMapping.canvas` accepted, provisional public config, listed for the founder with 186's names;
  (3) build times stay out of `size-report.json`. Review after the revert's CI.
- 16:50 EDT (clock read): PR #61 (186 S1) review 5539731471: **approve**. The cwd question: the
  identity moves with cwd only where esbuild's published names already move (code-split from a
  monorepo root); never a different identity for equal bytes. Should-fix being added: the per-file
  banner counts as Forma's code (lead's ruling), so N2's route figure rises ~21 B; the `types.ts`
  comment. **Merges waiting on the head's permission: #57, #61.**
- 16:53 EDT (clock read): the head allowed the lead's merges. **PR #57 merged** (integration branch
  `codex/forma-upgrade-review` = `40bc8fc`). **FORMA-181 checkpoint B, PR #60**, green (Rust 469 → 492,
  compiler 974 → 978, core 2668 → 2670; size unchanged; the stopped agent's WIP committed as found in
  3 commits after fixing a `\u0000` escape and 4 expectations). Lead's calls: no per-key cap, keys
  charged to the output budget; key segments checked against row data at render (a compile-time check
  against a declared row schema is a follow-up). Under independent review (Sonnet). C waits for it.
- 17:04 EDT (clock read): **PAUSE at the head's request** for a checkpoint report. Every agent told to
  finish only its current step, push, log where it stopped, and start nothing new (183: #58 fixes, no
  slice-2 PR; 186: #61 should-fix, #63 CI, S2 gate, no S2 PR; 190: #59 revert only; 182: current rule
  only; 188: plan only; 181: #60 merge-in only, no C). The #60 review continues. Resume only on the
  head's reply.
- 17:05 EDT (clock read): FORMA-182 paused with **rules 2 to 7 all committed, PR #64** (opened 16:37,
  before the pause; head `0b3f7f0`; CI green except the Windows scaffold leg still running at the pause).
  New BUILD-614 (boolean in text), BUILD-615 (provably non-boolean condition); rule 5 fixes `h()`'s
  class writer; size +12/+15 B (index.js/forma.esm.js), caps pass; three proposals in
  `docs/parity-rules.md` (ARIA booleans, walker show-condition refusal, a namespace stack: SVG `<title>`
  dynamic child refused by adoption today). Next on resume: independent review of #64.
- 17:06 EDT (clock read): FORMA-190 paused. **PR #59** head `6ac3e40`, green (revert `45fc0f9` of the
  frame minification; frame gate 40,000 B again, 39,612 used; README section on route classes and
  `canvas`). **PR #67** (`forma-190-frame-minify` @ `970efbe`, stacked on #59, opened before the pause):
  `@getforma/build` minifies core's frame runtime into `dist/` before hashing/SRI (served 84,996 B raw
  vs published 164,316 B; BUILD-820 for an unparsable runtime); its CI was running at the pause, left
  to finish. Next on resume: reviews of #59 then #67.
- 17:11 EDT (clock read): **resumed on the founder's decisions (L-57)**. Reviews launched: #64 (182,
  Sonnet), #59 and #67 (190, Opus). #60 (181 B) at `c77b288`, green, its review still running; C waits.
- 17:18 EDT (clock read): #58 (183 s1) round-1 fixes green at `4284bf4` (56 parity tests); round 2
  with the same reviewer. Slice 2 is PR #62 (stacked; slice 1 merged into it). Finding **F2** (walker
  writes a reactive `true` on data-* bare, core writes "true") assigned to FORMA-182 as a follow-up
  after #64 (in scope under L-57; absorbs the ARIA proposal); expected-divergent in 183 meanwhile.
  Local note: freshly linked Rust binaries hang at launch while syspolicyd scans them; agents verify on CI.
- 17:31 EDT (clock read): **PR #60 (181 checkpoint B) merged** after review 5540187076 (approve; parse5
  over 42 hostile keys and every BMP scalar). Integration branch = `2c7d4f6`. **No tag is cut from the
  integration branch between B and C** (core still compares `String(key)`, refusing CR/NUL string keys
  until C). Checkpoint C started (same agent; branch `forma-181-checkpoint-c`), with the review's
  should-fix: a three-engine spec pinning decode-to-canonical. syspolicyd at ~100% CPU stalls exec of
  every new binary for 20+ min; reviewers fell back to hand traces and CI.
- 17:46 EDT (clock read): PR #64 (182 rules 2-7) review 5540291543: approve. Before merge the author
  merges the integration head, adds BUILD-614/615 to build's always-error set, labels them Breaking in
  the CHANGELOGs with the output changes, and corrects BUILD-614's hint; then F2. PR #63 (186 S3)
  green, review pending; 186 measured the banner at ~30 B gzip per cold JS file (Counter 25,101 ->
  ~25,130; the SSR lane's ledger-arrival route 25,423 B, 77 B headroom: S4 will need the N2
  restatement L-57 allows). Mac: swap 12/13 GB, Docker VM 8.2 GB, syspolicyd ~100% CPU stalls new
  binaries; 76 stale target/node_modules deleted (12.1 GB). Docker cleanup and the syspolicyd restart
  are with the head. No new local reviews until syspolicyd recovers; CI verifies.
- 17:56 EDT (clock read): **PR #58 (183 slice 1) merged** after round 2 (5540416268). Integration branch
  = `491f68f`. #62 (slice 2, step 0: 14 modules, 23 states, P1 19 equal + 4 expected-divergent, P2 14
  equal, 2 structural classes, job 1m22s) under review by the same reviewer. Findings: F1 (compiler
  accepts a plain-array `createList` source) → FORMA-181 after C; F2 and F3 ('' decoded as Null on the
  server) → FORMA-182; F4 (`a[href]`, BUILD-206) by design, entry to cite its record. Slice 3 started
  with R1/R2 (optional presence bits, priority edges first).
- 18:16 EDT (clock read): **PR #61 (186 S1, identity) merged**: integration branch = `7b7b575`. The
  banner counts as Forma's code: ~30 B gzip per cold JS file (Counter ~25,130 B). #59 and #67 (190)
  both approved (5540558906, 5540559068); #59 conflicts with #61 in route-size.ts, its author merges
  the head in and adds the forma-server CHANGELOG line and a handler-level denial test; then #67 is
  retargeted. #63 (186 S3) under independent review (Opus); #69 (186 S2, stacked) next. syspolicyd was
  restarted by the head (0% CPU); Docker build cache and unused images pruned by the head.
- 18:22 EDT (clock read): PR #62 (183 slice 2) review 5540626685: **changes requested**, two P2
  vacuity blockers: hosts with interaction/idle/visible triggers silently skipped (P2 equal with 1 of
  3 activated); the positive control used a second observer (a real observer on a detached div still
  passed). Rulings sent: activated == hosts by driving triggers; control through the real observer;
  typed-path fallback fails; expected-divergent entries validated (no catch-alls); per-state catch.
  Slice 3 paused until #62 is fixed.

---

# PAUSED AT USER REQUEST — 2026-10-15 08:58 EDT

**Stop checkpoint:** `/Users/victorvillacis/dev/Forma/work/STOP-CHECKPOINT-20261015-0858.json`. All agents are stopped. No build, test, server, or implementation task owned by this session remains running. Resume only when the user asks. The historical entries below describe earlier activity and do not authorize restarting it.

- **Integration:** `work/review-FORMA-104/forma`, branch `codex/forma-upgrade-review`, clean at `3e27c5c622f5f9df4f46566a505d1e65bc4a8098`. Release-profile harness correction is committed. Final immediate checks completed: **153 create-app light tests**, strict types, and **5 release-corpus controls passed**; 18 opt-in heavy cases were not run.
- **181 keyed rows:** branch `forma-181-keyed-rows`, HEAD `bb6435f4e8ab867cf187a93cc746e0aa1a689313`. WIP deliberately remains uncommitted and unaccepted. Exact patch, all 13 source files, seven logs and hashes are saved in [181 handoff](../work/FORMA-181/PAUSED-CHECKPOINT-2026-10-15/HANDOFF.md); all 13 source/archive hashes verified during shutdown. Focused 11 tests/types pass; full compiler has **924 pass / 11 fail**. Native/core checkpoints B/C remain deferred.
- **182 normalization:** branch `forma-182-dom-normalization`, clean at `f1b2e53646f988715ef733d14e1f2e96da22f381`; approved plan, no implementation/tests started. [182 handoff](../work/FORMA-182/STOP-CHECKPOINT.json) records the original and corrected state fixture, exact patch, and evidence. This is the known **NUL parity gap affecting all three browser engines**; latest full browser run was **351/354**.
- **Packed qualification remains open:** last actual seven-archive scaffold run **166/167**; the release-profile correction and P17 corpus-name fix have passed focused checks but **have not had a fresh actual packed replay**. Four unchanged bundle caps still fail. Counter whole-route gzip is 25,726 bytes; About has no route JavaScript. Measurement and provenance remain in `work/FORMA-021/MEASUREMENT.md`.
- **History preserved:** PR28 was merged with a merge commit, PR29 and subsequent authorized merges are complete; all 631 source commits, 111 imported refs and preservation bundles remain. No publication or application migration occurred.

## Resume in this order

1. Read this stop checkpoint and both agent handoffs. Reuse the existing branches and evidence; do not reset or discard WIP.
2. Pack a fresh seven-package set from accepted `3e27c5c6`; replay heavy scaffold/P17 with source/hash/template-restoration authentication.
3. Continue181 checkpointA: resolve its 11 classified failures, preserve BUILD107 precedence, add612/613 catalogue/conformance, archive native fixture originals before intentional migrations, strengthen exact canonical/ordinal checks, then obtain independent review.
4. Continue182 from its approved plan: shared finite vectors and baseline failures first, then paired TS/Rust normalization and the three-engine browser replay. Coordinate its helper with181. Broader namespace changes require their concrete proposal.
5. Integrate reviewed slices, resolve unchanged size/remaining contract gates, then run full local and hosted CI before a PR or release. Designv2 is delivered; package3.0.0 implements it; designv3 is the later as-built record, before application migration.

No new campaigns, cap/minification-policy changes, application-tree work, tags or publishing. Registry settings are a first-alpha prerequisite already specified below, not work to perform during this pause.

---

# Resume point (updated 2026-10-15, 08:21 EDT)

The recovered upgrade is continuing in the merged `getforma-dev/forma` repository. Design v2 is delivered; package **3.0.0** implements it. **FMIR v3** is the active binary-format change. Design v3 is the future as-built record after 3.0.0. L-54 remains: no application migration before the final release.

## Current result

- **PR28 merged** with the required two-parent merge commit `faeea4588e390924a3efc68c301c26931771379a`; never squashed or rebased. Independent review and exact-head CI passed. Fresh GitHub clone verifies all **631 source commits** (523 imported commits through rewrite maps, plus 108 unchanged forma commits), all **111 imported refs**, and the browser benchmark checkpoint. Original repositories, refs, tags, maps and preservation bundles remain available.
- **PR29 merged** as `def4254c5bae535082f11b636cb3c2415b48c431`, after independent review, full CI and all three browser engines. Includes scripts-off installs, advisory checks, offline controls and dependency update configuration.
- **PR30 merged** as `9f5357fe58dc28022ecf1122bc6ba46610789882`, after independent review fixes and green CI. Seven-package release foundation, strict artifact verification and exact published A2 packed-set rehearsal are complete. **Live publishing remains disabled** pending the 3.0.0 contracts.
- Post-merge main CI **38666667616** passed in full at `9f5357fe`, including Windows scaffolding and release-profile tests.
- **PR31 merged** as `3d56c44dfa74be9c62b79d9bc42dae1fbda05340` after final-head CI38668641921 passed. Fresh GitHub clone verifies parents9f5357fe/d46d99b and the exact reviewed tree. FMIR v3 source is integrated; explicit qualification remains open. Post-merge CI38669593985 was cancelled by newer main CI concurrency; exact reviewed-head CI remains fully passed.
- **PR37 merged / FORMA-110 Done** as `0f5abafb37dd441ecc9edd5b5039177ce8ac021f` after all exact975d0b2 CI38669454143 jobs passed. Fresh GitHub clone verifies parents3d56c44/975d0b2 and identical reviewed tree. Post-merge main CI38670567808 passed all17 jobs; saved in `work/review-FORMA-110/tmp/main37-final-ci.json`.
- **PR38 merged / FORMA-112 Done** as `0d4e43488c9fb2ed46df58bd86bf6a620d750ac1` after all 17 exact-head CI38671809169 jobs passed at `a52b95d`. Fresh GitHub fetch verified parents `0f5abaf`/`a52b95d` and the identical reviewed tree. Independent review, seven-artifact P17, both templates and watch recovery checks passed. Post-merge main CI38672859926 passed all 17 jobs; evidence is saved in `work/review-FORMA-112/tmp/main38-final-ci.json`.
- **PR39 merged / FORMA-102 Done** as `2b2e8bd8a54a243bc06cdde0803cbaf2161d9d48`; all22 final c5ac4fc checks passed (CI38678939019, engines38678939020). Two parents and exact reviewed tree verified from GitHub.
- **PR40 merged / FORMA-109 Done** as `3d9314b2367bf5e004a7624acf894449c2dd7591`; all22 final42826be checks passed (CI38679672879, engines38679672898). Two parents2b2e8bd/42826be and exact reviewed tree verified.
- **PR41 merged / FORMA-107 Done** as `c2c106a96a4a9f86096189911dacd947bc88aca1`; all22 final8d4e541 checks passed (CI38679716651, engines38679716875). Two parents3d9314b/8d4e541 and exact reviewed tree verified. Main CI38680885226 passed all17 jobs; earlier39/40 main runs were superseded by concurrency, not failed.
- **PR42 merged / FORMA-111 Done** as `96b81c5e6e00d2984889d7204a7a262f820e25dd`; all19 final86b34e3 checks passed (CI38681810842 all17 plus two Socket checks). Two parents c2c106a/86b34e3 and identical reviewed tree verified from GitHub. Main CI38682742898 passed all17 jobs; `work/review-FORMA-111/tmp/main42-final-ci.json` preserves the final result.
- **PR43 merged / FORMA-144 slice 1 accepted** as `1279ccdb924817dc35e00b8bc8252b1a41ee39c2`. All 21 final-head checks passed at `3e25f2a`, including CI38687008773's 19 jobs and both complete candidate consumers. Linux and Windows each pass 162 tests, including 17 heavy cases, against the same authenticated DS11 set. Fresh GitHub fetch verifies parents `96b81c5`/`3e25f2a` and the exact reviewed tree. Post-merge main CI38688007730 passed all19 jobs (18 successful, published-only scaffold correctly skipped).144 remains open for slices 2/3.
- Old repository mains now point to forma: formajs `512af2d`, forma-tools `e2831f7`, create-forma-app `275d063`. Old main publishers, dispatch receiver and obsolete schedules are retired. Main-only read-only rulesets preserve maintenance branch writes. Legacy Pages remains available. All three post-retirement CI runs passed (38666582180, 38666586356, 38666590421).
- Actual Dependabot execution is observed: bot PRs **32–36** update stale GitHub Actions pins. Evidence: `work/FORMA-113/tmp/cutover/dependabot-prs-after-cut.json`. These incidental major dependency updates have not been reviewed or merged.
- Final hosted timing run **38665152723**: all 20 samples passed, p95 **221 seconds**, median 207, range 136–225. The earlier failed attempt is retained; its parallel test port race was fixed and independently reviewed before the successful rerun.

## Active implementation

1. **FORMA-185 / PR31**: `work/FORMA-185/forma`, branch `forma-185-fmir-v3`, final head `d46d99b592059f086560da5daf3dbd7ca81787a9`. Production and release integration independently approved. Signature auditing now preserves all external graph edges while authenticating unpublished candidates against DS11. Final hosted CI **38668641921** passed; PR31 merged as **3d56c44**. Earlier complete CI at `f7d9976` passed. Development P17 is explicitly partial: packed reader/emitter, crate advisories, registry signatures and minimal frontend pass, but preserved A2 Cargo template requirements refuse v3 candidates until144. Seeded-input minimization/replay and observed hosted nightly remain open qualification; no new fuzz experiments.
2. **FORMA-102 Done / PR39 merged**: exact packed source153972d, reviewed finalc5ac4fc. Declared TS/Rust props, derive and strict typed Pages are integrated. Review closed composition, manifest/module reload and Windows date construction findings. All20 P17 checks pass61.524 seconds, seven archives and ten restored source files authenticated independently. Full gate passed162 seconds before the private portable-date extraction; focused numeric/props/typed controls and final hosted lanes cover that extraction. Full review/evidence: `work/review-FORMA-102/`; source `work/FORMA-102/forma`. Historical attempts remain preserved.
3. **FORMA-112 Done / PR38 merged**: source `work/FORMA-112/forma`, final head `a52b95d`, main merge `0d4e434`. Root review `work/review-FORMA-112/review.md` is approved. Final CI38671809169 passed all 17 jobs. All 41 independent watch/compatibility controls and 20 packed/API/release controls passed; full local gate passed in 164 seconds. Seven exact DS11 archives and both templates passed P17 in 39.996 seconds. Source A2 template pins are restored. The final follow-up corrected test readiness synchronization without changing production behavior. Original reports and failed attempts remain available; live release is still false.

4. **FORMA-109 Done / PR40 merged**: exact packed source2110f01, final42826be adds docs/evidence and test-only Windows watcher cleanup. Enforced Trusted Types, typed raw sinks and private PageResponse are integrated. Independent review covered Rust60, runtime/types474, all42 built artifacts, three-engine native enforcement54, document/row6 and packed9 controls. Size ceilings unchanged. Final P17 passes22 checks/59.826 seconds, both actual templates enforce Trusted Types with zero violations/page errors. All archive/VCS/checksum/restoration records authenticated. Final owned-process cleanup passes54 independent controls. Full review: `work/review-FORMA-109/`.
5. **FORMA-107 Done / PR41 merged**: exact packed source858666f, final8d4e541 includes the same test-only cleanup. Sole typed load/bind/finalize/render API, immutable inherited limits, concurrency sealing, rejected manifest/topology retention and request metadata are integrated. Root isolated23 functional/startup/reload and32 documentation controls pass. Final P1722 checks/49.928 seconds includes16 typed controls and both enforcing templates. Archive provenance and all ten restorations independently authenticated. Invalid earlier shared-target run is explicitly retained as invalid. Full review: `work/review-FORMA-107/`.

6. **FORMA-103 In Progress**: compiler/build ownerreview_merge in `work/FORMA-103/forma`; native/core ownerrecover_history in `work/FORMA-103/native`. Paperfeb600f, original corpus4692758 and source/evidence archives remain. All earlier wire/codec/native/state/decoder checkpoints are source-approved; numeric4f54, unitfixture5a33, actual100-case/three-engine harness28ed and optionalprops4c5 are independently accepted. Pairedpublication548+c9f1b4e now passes the original missing-type-directory recovery reproduction,33 combined controls and both newly/existing-directory cases. Safe decodere914 saves75 browser/51core bytes but actual package limits still fail (31522>29000 browser,32075>30000 core). No minification/cap change approved.

   Public callable804 passes actual packed strict JSX consumer without changing private runtime authority. Aggregate34de initially failed2 semantic controls;842b57a repairs row-call/null-intermediate coercions and inherited data reads, with88 independent controls and11 actual native cases passing. Strict fallback retirement32fe587 has full source review and28 controls; legacy fixture migration/full gate remain. Original-host detach finding is closed by506ece2: root86 decoder/activation controls and41 seam controls pass, including the unchanged original reproduction. Full details/logs in `work/review-FORMA-103/paper-review.md`;103 is not merge-ready.

7. **FORMA-111 Done / PR42 merged**: final production sourceac7c51b, evidence head86b34e3, main merge96b81c5. Required canonical SHA384 and external resource SRI, on-demand cache/network digest enforcement, waiting upgrade and precise retirement are integrated. Full R17 passes146s; P17 passes31 checks/66.053s with all12 worker/lifecycle assertions and both paired SRI template controls. Root authenticated seven archives/VCS/three internal checksum edges/ten restored files and report copies; independent native, build, browser and helper controls pass. All19 final checks passed. Review and original failed attempts remain in `work/review-FORMA-111/` and `work/FORMA-111/`. Main CI38682742898 passed all17 jobs, including Windows scaffolding.
8. **FORMA-104 In Progress**: `work/FORMA-104/forma`, branchforma-104-adoption-transaction. Approved plan and private runtime seam b95f313; root read all8 files and independently passes2028 core tests/strict typecheck, including3 extra rollback/identity/cleanup controls. Concrete integration map and private structural8524a32+d4c84bb are approved; root81 seam/static controls, strict types and all three browser structural replays pass. The original detached-host finding is closed by103/506. Private ownership/dormant callbacksdde34+419 are now approved after293independentcontrols and strict types. Current work is lazy descriptors/per-host matching and original-AST compiler hooks, followed by dynamic/control integration. No successful zero-write DOM adoption claim yet. Evidence `work/review-FORMA-104/review.md`.

9. **FORMA-105 In Progress**: refined `work/FORMA-105/PLAN.md` approved, including accepted per-entry product, finite authenticated mount retirement, mode/IR preservation for static routes, explicit config/preload refusal, JS-page-scoped SW registration and governed raw-markup qualification. Native9c, mount211 and producttransport1c are independently accepted staged slices. recover_history owns compilerentry transformation and review_merge owns buildgraph/manifest consumption in coordinated clones;104 owns componenthooks. Final integrated template144slice2 and unchanged size/full/hosted gates remain required.

10. **FORMA-144 slice 1 accepted / PR43 merged**: source `work/FORMA-144/forma`; final artifact source `bfb722c`, final reviewed head `3e25f2a`, merge `1279ccd`. Full R17 passes204s; actual packed CLI scaffold162/162 including17 required heavy cases in87.41s; final P17 passes33 checks in74.091s. Root authenticated seven archives/VCS, three internal checksum edges, all ten restorations against Git/live files, three exact packed sources, both sealed template npm/Cargo locks, source seed exclusion, two TT reports and five identical evidence copies. The historical single-esbuild-copy guarantee is explicitly deferred to slice3, with real installed copies and optional omission recorded. Whole-page mount remains until slice2; handler7 proof is raw SSR only.

   Initial CI38686430679 exposed two older watch-test races. Test-only3e25f2a preserves all assertions and independently passes29 controls. Final CI38687008773 passed all19 jobs, including both candidate consumers, plus two Socket checks. Root downloaded both raw reports:162/162 and17 heavy cases on each platform, matching producer DS11 hash30c5c28dcf39e585bd8a9ecc7e42900db6b8d4209957afc6ae7edeee37efc158 and GitHub synthetic merge903467b. Required producer, consumer and R17 steps all executed. Main CI38688007730 passed all19 jobs (18 successful, published-only scaffold correctly skipped); exact head1279ccd and all results saved in `work/review-FORMA-144/tmp/main43-final-ci.json`.144 remains open for slices2/3. Resume_fmir has completed103 fixture checkpoint5a33 and104 private seam; the adoption walker follows.

Root owns independent reviews, finalCI/merges, board/docstatus, post-mergeobservation and103browserperformance/size measurement. Allthreeagentscontinue. Current main1279ccd/PR43 passed all19 post-merge CI jobs, with published-only scaffold correctly skipped; previous main42 passed all17 jobs. Keep user applicationtrees untouched.

### Evidence and unresolved gates

- Final packed source102153972d:20 checks/61.524s;1092110f01:22/59.826s;107858666f:22/49.928s. Seven archive hashes, crate VCS, three internal candidate checksum edges and ten restored files authenticated for each. Committed report copies match. Documentation/evidence and final test-only watcher cleanup are explicit deltas after package sources.
- The Windows date conversion and watcher teardown findings are fixed and final Windows lanes pass. The original failed jobs and prior P17 attempts remain preserved. Do not restart old pending states from archived notes.
-185 explicit seeded qualification/replay and observed hosted nightly remain open; no new fuzz/minimization experiments. Latest read-only nightly query returned no runs, with no dispatch.
- Live publication remains false. Template source migration144, later contracts/qualification and L-54 application sequencing are unchanged.

## Remaining registry action near the first alpha

GitHub settings are complete: admin-only `v*` tags; `npm-publish` and `crates-publish` tag environments; no required-reviewer gate (D3 declined). The user's npm/crates account session is still required for registry-side settings; authenticated `gh` does not manage them.

Near the first `3.0.0-alpha.1` publication, preserve maintenance entries and add/reconcile:

- npm packages `@getforma/core`, `@getforma/compiler`, `@getforma/build`, `@getforma/create-app`: owner `getforma-dev`, repository `forma`, workflow filename `release.yml`, environment `npm-publish`, explicitly **Allow npm publish**.
- crates `forma-ir`, `forma-ir-derive`, `forma-server`: owner `getforma-dev`, repository `forma`, workflow `release.yml`, environment `crates-publish`; preserve/reconcile existing maintenance registrations.

Current npm documentation requires a first successful publication within two days of creating an entry, so do not add these weeks before the alpha. Source cut is complete independently of this first-publication gate. No token or throwaway publication is needed. Source: https://docs.npmjs.com/trusted-publishers/.

## Durable evidence and constraints

- Board: `~/dev/Forma/Tickets`; tracker generated with `TZ=America/New_York python3 _tools/tracker.py`. The old chat CWD `~/Documents/Forma` does not exist.
- Recovery archive: `work/codex-recovery-2026-10-14/pre-resume-evidence.tar.gz`, SHA-256 `94af31570b5e9ef469fb8be01bdc94f5914d73c08829e9e06ad8bf3513410917`. Original running notes preserved in `work/codex-recovery-2026-10-14/RESUME-before-consolidation-20261014-2145.md`.
- Cut evidence: `work/FORMA-113/tmp/cutover/`; original/all-ref bundles and verified final preservation bundle retained. Independent merge review: `work/review-FORMA-113-codex/review.md`.
- PR30 review: `work/review-FORMA-187-independent/review.md`. Exact published A2 P17 passed in 33.558 seconds after review. The earlier same-version current-source rehearsal is explicitly invalid/superseded because it hid dependent crate checksum drift; preserve its reports, never cite it as passing evidence.
- FORMA-185 independent reviews: `work/review-FORMA-185-production/`. FMIR specification archive and original drafts remain in `work/FORMA-114-spec/`.
- A2 is shipped; FORMA-136 token removal/trusted-only and derive0.0.0 placeholder are complete. Ticket rewrites181–192 are complete; parents106/114/115/118 are pointers. FORMA-142 is Won't do per D3. Reference fold-in `9c203d4` and FORMA-173 are completed, not stranded work.
- No new PRs to the three retired repos. Maintenance branches and old publisher entries stay. Never touch the user's `~/dev/FormaStackDev` or `~/dev/FormaBuiltApps` trees.
- User explicitly authorized review/fixes/CI/merge of28 then29 without further confirmation, with28 merge-commit only; the existing lead workflow continues for the upgrade. No tag, live publication or application migration has occurred.
- Keep honest Codex attribution; the old protocol's Claude footer is stale. Preserve other agents' files/processes. Use shared caches, and clean only owned reproducible build output after completion.

### 01:53 EDT review continuation

- Numeric importer4f54bbd is independently accepted: two fixed importer controls pass and Cargo.lock is byte-identical to its parent. The existing serde_json feature changes no dependency resolution.
- Existing unit-fixture migration5a33bb1 is independently accepted: all17 original files authenticate against Git and saved SHA256; the reviewer reran all245 tests successfully at c9399f6.
- Native/browser harness28ed39e and documentation/browser migrationc9399f6 are under independent review. Author reports1990 core tests and100 fixed values in each engine passing; independent replay is in progress.
- Actual package size check fails unchanged ceilings: core graph32126>30000 gzip bytes, browser ESM31597>29000. Decoder-only measurement2754 is not a package delta. Native owner is investigating reductions; no cap was raised.
- Paired product/publication5480145 is under source review. New F1 optional-props correction4c5d561 is awaiting independent replay. Compiler owner continues strict fallback/corpus work.
- Concrete104 plan is lead-approved with actual built-in local setter identity, edited-only input-target refusal, and explicit post-commit application-callback failure semantics. resume_fmir may start only the isolated private seam checkpoint; overall103 acceptance remains pending.

### 02:01 EDT accepted checkpoints

Paired publication5480145+c9f1b4e is independently accepted after the fixed missing-type-directory reproduction,33 combined controls and two directory-creation cases pass. F1 optionalprops4c5d561 is accepted after17 writer/product and7 native controls. Native/browser28ed39e passes independent54-test three-engine replay (100 fixed native cases per engine,51 adoption checks). Safe decoder reductione91410b passes77 independent controls, but package sizes still exceed unchanged ceilings: core32075/browser31522. Readable output policy remains in place. Public typed unary registration needs a separate declaration correction; native owner owns it and then105 concrete planning.

104 moved to In progress: branch forma-104-adoption-transaction at a54290c combines c9399f6 and main1279ccd. Only private tuple/writable and dormant-reader seam work is authorized before its next review. Compiler owner continues aggregate defaults and strict corpus migration. All original failures and snapshots remain preserved.

## Lead continuation 2026-10-15, 02:18 EDT

Current main remains1279ccd, with all19 post-merge jobs passed. Latest reviews accepted804,842 and32fe source checkpoints and104 private seam b95f313.103 full integration/size and current-document claim fix remain open;104 walker and105 native/static policy proceed independently. No registry action is needed yet, no live publication or application migration.

### 02:41 EDT accepted review checkpoints

103: claimant506ece2, historical-inspector1e5/f88, declared-fixture4477/8c907, active-corpusf88 and second walk-migrationac807 are independently accepted. Rebuilding14 corpus sources reproduces28 IR/dump files exactly;11 native and13 server checks pass. Nine HTML files are byte-identical,13 bodies match after removing only transport markers; nested-island input declarations are the one additional source change. All original archives authenticate Git/SHA/length. Callable-provenancefdae initially left one alias defect;2335059 closes it. Root combined8-suite check277/277 passes, plus an additional helper-prop refusal and19 standalone schema-coordinate controls for522c1b9. Remaining diagnostics/conformance migration and integrated full/packed/size gates are open.

104: source8524a32+d4c84bb is accepted as private structural utilities only. Root81 focused tests and strict typecheck pass; independent replay of actual source passes all three browsers for namespaces, repeated/nested ranges, empty sentinel, zero mutations and connected ancestor relocation. Original detached-host reproduction passes unchanged after506ece2 (41 seam checks). No completed activation/early-edit claim.105 native/static policy proceeds; no new user action required at this point.

### 02:52 EDT diagnostics and static server

103fa0593d diagnostics checkpoint accepted:198 independent controls;99 original files/150018bytes authenticated. Scalar/structural unresolved text now mandatory610; remaining catalogue/strict work is not marked done.105 native9c3159c accepted as staged slice after32 independent controls including original-pair SRI retention/recovery, no-walk guard and preserved3file archive. Its owner now implements mount-only refusal and preserves adoption controls through caller-owned public hydrate, coordinated with104. Root review105 reuses review-FORMA-103/native at9c3159c; its logs/source are in review-FORMA-105.104 owns effect groups and deferred callbacks; no activation switch yet. Root drafted only a finite182 source map at work/FORMA-182/PLAN-DRAFT.md;182 remains Backlog and no generation/fuzz campaign is started. Completed root144 dependencies were removed; all source/evidence remains.

### 03:05 EDT compiler/build completion and ownership finding

103 compiler5b6bd0b accepted: all nine archived originals authenticate Git/SHA/length (159583bytes), all active test changes reviewed, full independent compiler824/824 passes. The first run's one failure was the reviewer's old CWD-relative fixture lookup; original test/log preserved, only that reviewer path corrected, then the complete suite rerun. Build7767059 accepted after full source/test review, four original archives/35949bytes authenticated, and54 independent controls. Mandatory failures now await every page, write the complete diagnostics report, preserve original rejection identity and accepted output, then refuse; no late publication. Author full JS workspace/core1997/compiler792/build248/create145 passes with17 pre-existing heavy skips; exact-source packed/hosted and unchanged size gates remain open.

104 ownershipdde34c2 is under review, not accepted. Root56 existing focused controls pass, but a new fixed live-callback regression fails: a nested effect aborts its island during a parent rerun, after which a later-created effect leaks and continues updating. Exact source and valid failing log are in work/review-FORMA-104; the owner is fixing it.105 mount/adoption controls and native browser fixture migration continue, with no executable hydrate/activate changes in that slice. No release publication or application migration.

### 03:23 EDT accepted source checkpoints and next ownership

104dde34c2+419b470 private ownership lifecycle is now accepted. Original root-authored live-parent failure is copied unchanged into the product tests and passes; the corrected source drains work constructed after abort and attaches owned roots to the actual effect owner. Root293 reactive/structural controls and strict types pass; author2096full core/42artifacts pass. Original failures remain. Root/agent size records still fail unchanged ceilings; activation remains unchanged. resume_fmir now owns private lazy descriptors, original-host child matching and a separate compiler component-hook module, coordinating105's entry transformer.

105211f64f mount-only slice accepted after complete active diff review,13exact original archives297196bytes,261 independent unit/doc controls,42artifactbuild and132native-browser controls across3engines (21.8s). First root browser invocation omitted the package's required runtime-fixture copy;87pass/45missing-runtime failures are preserved as invalid, then all132 rerun successfully after staging the exact built file. Only mount.ts executable production behavior changed; old hydrate/activate remained.1c0d09c result-keyed compiler product transport also accepted: all5filediffs read and10independent direct-plugin/paired controls pass. The compiler's exact output object/path/hash, error guard and deeply frozen record arrays are checked; missing native product cannot establish static policy. This checkpoint does not yet removeJS.

1033c34b9e E2E migration accepted with13oldfiles33902bytes authenticated; all9actual compiler/typedRustcases rebuilt and33Chromiumchecks pass6.6s, including native7→activation7→increment8 and Ledger unary props without manual seeding.07d7436 is example-only stdout lint annotation.08a2f53 typed fixture migration accepted:5originalfiles4059bytes authenticated, three actual emitted binaries/SHA384checked, home5oldsectionpayloadsexact plus empty section10, both empty-list outputs/native stateequal,19typedPages/integrity+oneindependentcomparisonpass. Author R17 inventory now passes every observed stage except unchanged core/browser size; packedP17/finalhosted remain outstanding. Remaining named checks after size were run explicitly, not reported as green R17.

Current assignment: recover_history owns105 compiler entryrewrite/product in work/FORMA-105/server, review_merge owns105 build graph/manifest publication in work/FORMA-105/build, resume_fmir owns104 runtime/componenthooks in work/FORMA-104/forma. Root reviews and integrates. Root103review/forma is temporarily1c0d09c; native at08a2f53; root104 at419b470. Closed review102/109/110/111/112 reproducible dependency/target output removed after no active users,13directories; sources/evidence retained.182 remainsBacklog: original design4 settles CRLF/CR→LF andNUL→U+FFFD; design3 distinguishes finite floats from exact Rust integers. Draft33explicitvectors saved under work/FORMA-182 only, no runtimeconsumers/acceptance/generationcampaign. No newPR, tag, publication or application migration.

### 03:36 EDT active checkpoint

104 lazy description103b7a0 is independently source-approved (all11files;2114root tests/strict types). Root discovered a separate original-boundary-marker hole: data-forma-island removal/change after preflight was not rechecked. Fixed reproduction2fail/1pass and full source retained under work/review-FORMA-104; owner fixing separately.104 compiler hook plan approved within the agreed SourceSnapshot/per-module integration seam.105 compiler entry rewrite and build graph/publication remain in active implementation; no new PR or release claim. Root review checkout now103b7a0 with four retained reviewer test files, the newest deliberately failing until correction.

### 03:50 EDT continuation

Original boundary-marker hole closed by104d22058e: unchanged root regression plus full2124core/strict types pass. Lazy103b7a0 remains source-approved.105build2f14ba0 and explicit fixture55ccb77 accepted (root34+17 controls, exactarchives). Compiler861228d has a blocking optionalnamespace extra-mount escape (root2fail/27pass); recover_history is correcting finite namespace proof and a separately found public-registry-key versus local-identifier fallback bug. review_merge integrates then owns144slice2 minimalCounter+static/about route; resume_fmir owns104original-module hooks/dynamicplanner. Hooks need a build-scope union for shared modules across split entries, every snapshot guard retained. Root reviewJS checkout861228d with an additional deliberately failing reviewer-entry-optional-mount.test.ts until correction. Root104 checkoutd22058e, all its tests pass. No newPR/tag/publish.

Finite181 preparation is saved at work/FORMA-181/PLAN-DRAFT.md, not implementation or acceptance; ticket stays Backlog. Wire section6 already exists and low-level unkeyed LIST remains permitted by the agreed reader spec. Future compiler key-path refusal, native row-key production and104key-to-original-row matching must align with182 normalization and preserve zero initial moves for reordered client data. No new generated campaign.

### 03:58 EDT entry correction accepted

105 compiler861228d+58b4f523ecbe554082eaf3a149b6c3eb0ecf772a accepted: full869root compiler tests/38files and strict types pass. Original optionalnamespace failures unchanged and now pass; finite namespace escape/dynamic policy and localregistryalias classification reviewed. One old reviewer shadow test now expects earlier611 rather than610; exact original and initialfailure archived. f42b1d6 buildfixture migration accepted14root tests and24178bytes exactoriginals. recover_history implements separate buildscope source-edit coordinator with all snapshotguards; resume_fmir builds original-source hook collector; review_merge owns144slice2 provisionaltemplate source, whose3actualcompiler/148structural tests pass (17heavy existing opt-in, not finalpackedacceptance). RootJSreviewcheckout58b4f523; core104reviewd22058e. All root test commands completed; no active rootservers/processes. LatestdesignSTATUS localcommitde8d345. No newPR/tag/publish.

### 04:18 EDT source integration review

105 coordinator3a1e025 is source-accepted after complete5file review,52 independent context/composer/entry/product controls and strict types.104 composer40db172 is accepted; its hook collector566da22 remains blocked on3fixed narrow-alias failures (literal assertion, union assertion, readonly tuple); ordinary unannotated alias positive passes. Exact test is root review103/forma/packages/compiler/tests/reviewer-adoption-alias-contract.test.ts; original logreview104/tmp/hooks-alias-contract-original-independent.log.104owner owns correction; runtime activation stays unchanged.105actual split hook-unionf5d42d is under independent replay.

144slice2 source44d2674 accepted as staged source: allactivefiles read,9archived originals76,597bytes authenticateGit/SHA/length,8dependencyfilesunchanged; independent CLI/fullstructural149pass/17preexisting heavy skips. Author actual source Rust/browser checks are source-only; no packed/104adoption qualification. review_merge builds stricter shared packedbrowser verifier with sourceTemplates islands-v1 and unchanged stateBlock declared-v1; historical verifier preserved. Root review103/forma integrates58+566+3a+44d+f5 by ordinary review-only merges, preserving10untrackedrootcontrols. Newaliasfile deliberately fails untilcorrection. No newPR/tag/publication/apps.

### 04:25 EDT hook correction accepted; verifier gap retained

104collector566+37a56c now source-accepted after907root coherentcompiler tests/strict types and unchanged original4case reproduction. RootJSreview integrates all accepted105entry/coordinator/union,104hook/lifecycle,144source44d and verifier312 through review-only merges; generated core/compiler distributions are rebuilding before actual package bridge988 replay. Rootnew reviewer-template-observation.test.mjs deliberately fails until144owner closes the pre-observation executable-script gap (1fail10authorpass). Source-only verifier is not finalframework acceptance. Thinbridge988 needs observable distinct recoveredIR before acceptance.

recover_history is moving from105bridge to a separate104control-normalization private module after its concreteplan; resume_fmir retains dynamicplanner, reader/codec association, seed/conflict/suppression andactivation. review_merge owns packedtemplate verifier/wiring/3engine installs and source mock passthrough. Firstprivatewalkercheckpoint forthcoming. Current designSTATUS commitc2b34c5 is local; no newPR/tag/publish/apps.

### 04:43 EDT independent recovery checkpoints

104 scalar3b6+b421 is source-accepted after the unchanged alias regression, all2188rootcore tests/strict types and actual Chromium/Firefox/WebKit replay with retained MutationObserver batches. Original inherited-name failure and superseded observer evidence remain preserved. Root review104 is nowc783466 for private Show review; fixed live reentrancy controls were requested before approval. Sole textarea hook353 is separately replaying. recover_history owns the isolated readonly control kernel and native normalization checks; resume_fmir owns dynamic regions, actual getter/codec authority and activation.

105 package bridge988+25dd accepted after actual rebuilt package replay and observably distinct recovery publication.144 acceptance75be9d7 plus executable-inventory correctionscee/1749 accepted as a harness only: root15helper/reviewer/source,149structural (18heavyopt-in skipped),51release/candidate, types, workflow/actionlint;7originalarchives131139bytes exact. Both original review gaps now pass unchanged. Final packed adoption still waits104. review_merge is auditing concrete size reductions under unchanged caps; no code/readability/cap exception. Root JS integration contains accepted compiler/build/template sources and scalar b421. No new PR/tag/publication/apps.

Textarea353832d independently accepted after37 coherent compiler hook/alias/union/product controls and strict TypeScript. Logs work/review-FORMA-104/tmp/textarea-hooks-{independent,types-independent}.log. Canonical binary production is unchanged; activation remains pending.

### 04:50 EDT private conditional-region checkpoint accepted

104 Showc783466 +22a42fc417490ca63f1ab4f40487701468a11c54 is independently accepted. All5+3 changed file deltas read; root2195core tests/156files, strict types and actual scalar/Show source in Chromium/Firefox/WebKit pass. Logs work/review-FORMA-104/tmp/show-corrected-{core,types,native}-independent.log. The requested fixed callback tests first failed2/16: a disposer could continue inserting after abort, and a self-written condition could leave stale output. Exact original author failure remains at work/FORMA-104/tmp/walker-show-reentrant-before.log. Correction checks live ownership and original range after callbacks before movement, and uses the existing bounded Pending self-write policy for live observations only. Initial preparation remains one read and no writes.

Source-only checkpoint: production activation remains unchanged. resume_fmir continues lists and later dynamic/control orchestration. recover_history is checking WebKit implicit selection normalization and enclosing-select peer observations before a separate controls checkpoint. No packed/size/hosted acceptance claim.

### 05:04 EDT frame guard accepted

Frame capability correctionebb9790fa79d366cd300de8b4a04931046c4948c is independently accepted. All3file deltas read;74 focused signal/custom-equality/adoption/frame controls and strict types pass. Root rebuilt all42 artifacts with unchanged production definitions/options. Frame SHA256515079ee4fcc2871ecb1ddd3579c5ae73aed4206e53d9f395ac01d68bc82fbbd exactly matches preserved103 output and passes39,973/40,000 gzip. Root current core32,302/30,000 and browser31,711/29,000 still fail; runtime41,421/41,500 and hardened40,379/40,500 pass. Overall size command correctly exits1. Logs work/review-FORMA-105/tmp/frame-guard-{focused,types,build,size}-independent.*, frame-authentication-independent.json; root before-distribution archive retained. No core savings, cap exception, fullR17 or release readiness claimed.

### 05:04 EDT controls review remains open

All3files of431e54c and browser-only observer correctioncf663e1 have been read. Root80 controls/walker/scope tests, strict types and15 actual native browser controls pass; the corrected helper retains delivered MutationObserver batches through a macrotask and proves a subsequent positive write. Logs tmp/controls-{unit,browser,types}-independent.log. This does not close review: a second independent reviewer found untouched color inputs using alpha/colorspace lose those normalization attributes in the detached mirror, becoming false edits in Firefox/WebKit. Original fixed evidence is work/review-FORMA-104-controls/tmp/native-fixed.json and probe.mjs. Owner will authenticate actual producer admission and correct it separately; no kernel integration by runtime owner yet.

Runtime query settled under DR-5: literal static value/checked/textarea initialization with no installed reactive reader still validates decoded defaults, but retains an early edit without conversion/seed. Actual reactive captured/computed/read-only bindings retain edited-only INPUT_TARGET refusal. The private kernel must distinguish initialization explicitly, never infer it from missing codec. recover_history owns the kernel extension; resume_fmir owns walker classification, actual getter/codec queries and integration. Wrong-default and reactive-readonly controls remain mandatory.

### 05:19 EDT list and control preparation checkpoints accepted

Private single-element list32fd92bab0fa16d329e27292d40a6d4ed3722464 is independently accepted as a checkpoint. All3file deltas read; root actual-source scalar/Show/list checks pass in Chromium, Firefox and WebKit, strict types pass, and the new unchanged reviewer nested-list case verifies repeated local marker numbers, inner updates, outer removal disposal and zero initial writes. Original combined full run had2235passes/1failure solely from the newly added detached control oracle missing renderer inventory; its exact log remains tmp/list-core-independent.log. Generalized shared-Text/empty/Fragment row support remains ongoing. Read-only audit at work/FORMA-104/list-admission-audit/REPORT.md preserves23 actual compiler cases and13 native products, distinguishing row shapes from the registered island's own root. No adoption authority extends outside the original host.

Controls431e54c +cf663e1 +3983c6c42085da3e48484b69b4966432da4ada44 +81fc2ea081c2cde64fa87aeb005233fa430d9e89 are accepted for private integration. All source/test changes read. The exact original color cases now pass after preserving alpha/colorspace; renderer NON_SINK documents detached-only writes without weakening inventory. Explicit kind initial validates defaults and preserves early edits without conversion or seed; reactive binding is the default and still refuses edited non-reversible targets. Root combined2239core/159files, strict types and24native controls across3engines pass, with retained observer batches and a positive control. Logs work/review-FORMA-104/tmp/controls-corrected-{core,types,browser}-independent.log. A second independent review passes32units and24native cases; its original18 grouping/color observations are unchanged. This is private preparation, not successful compiled activation.

Codec query88b4ed6c7b0fbbf44d3f4262689ef30bddd7c8b0 and exact read-only cursor spans1e2e1b8b0228cc3a7458452d176421c8b9dd00f9 are also accepted after all5file deltas read,79root focused tests and strict types. Only an actual live local wrapper in the preparing scope exposes a codec; direct hydrate never grants authority. Cursor spans retain partial shared Text offsets and zero-width rows without splitting or inserting nodes. Logs tmp/codec-span-{independent,types-independent}.log.

Confirmed open producer/context mismatch: native parent select.value overrides a nested registered Choice option's selected:false; the independently activated child cannot reconstruct that parent binding from its own state. Actual628-byte IR/native HTML/state and all3browser VALUE refusals are preserved in work/review-FORMA-104-controls/tmp/select-source and select-peer.*. No DOM-derived parent authority or silent broad restriction is introduced. Root and recover_history are settling the explicit subset/context contract. review_merge now owns a narrow compiler-authenticated conditional descriptor hook, with original-source provenance/ordinary evaluation/canonical bytes to be reviewed before implementation. resume_fmir retains generalized rows, control orchestration and activation. Unchanged package sizes and final packed/hosted qualification remain open; no new PR, publication or application migration.

### 05:28 EDT generalized rows accepted; finite subset follow-up recorded

Private rangesb520b547c473dddd57b8ec356b39a23ef7b59beb accepted after all5changedfiles, handoff and native harness read. Root141 relevant row/walker/structure/lifecycle/scope controls pass, including unchanged reviewer nested-list; strict types pass. All three engines pass the actual-source harness against eight exact compiler/native HTML products: every initial subtree node retains identity, retained observer batches show zero writes, and three later updates succeed. Logs work/review-FORMA-104/tmp/ranges-{independent,types-independent,native-independent}.log; original author failed assumptions remain preserved. Shared literal Text splits only on an ordinary later structural change after candidate factories/cleanup; empty rows gain no synthetic anchor. Initial key order remains the explicit pre181 limitation.

Root adopted the finite101 ownership follow-up in ROOT-CONTROL-CONTRACT-AUDIT.md: independently registered option/optgroup boundaries under an externally value-bound select require a coded source refusal until evaluated parent authority is supported. Unbound select roots remain eligible. This is newly explicit initial3.0 subset scope, not an existing139 parser ban or a current implementation.139's root wording now matches DR-7's single stable owned Element, with transparent single-Element Fragment near miss and interior ranges retained. No silent runtime workaround or wider host authority. Conditional helper plan at work/FORMA-105/CONDITIONAL-PLAN.md approved for original DOM-record-only source edits/canonical-byte proof. recover_history now owns separate style/raw helpers; resume_fmir owns their integration plus controls/activation.

### 05:34 EDT event-ownership acceptance controls prepared

Three fixed independent cases now exercise the planned but not-yet-implemented event boundary: work created by a successful listener must die at island disposal; a throwing listener must fail its owner once and drain partial work; work created after a listener synchronously disposes its island must not leak. The exact installed callback is invoked to avoid relying on a test DOM's uncaught-event reporting, and every failed baseline cleans its temporary effect. Source work/review-FORMA-104/forma/packages/core/src/dom/__tests__/reviewer-adoption-events.test.ts; original log tmp/events-original-independent.log records3failures. Assigned to runtime owner for unchanged replay at its listener checkpoint; this does not invalidate prior scoped scalar/row/control preparation acceptance, which explicitly excluded event ownership. The root full suite now intentionally includes these outstanding controls until that checkpoint lands.

Style helper audit clarified current strictness:206/207 remain optional warnings unless strict:true, while610/611 are mandatory at current esbuild-ssr-plugin.ts626. Thus object-style omission under nonstrict plugin invocation is pending101 strict-only debt, not an approved mandatory-refusal regression; earlier lead assumption that206/207 were already mandatory was incorrect. Exact lower-level and directplugin examples are preserved under work/FORMA-104/tmp/content-style-admission. Private object-style validation still supports the caller-owned facade and refuses missing nonempty server CSS without repair; no compiler policy change is bundled with content helpers.

### 05:53 EDT conditional source hook accepted; textarea correction pending

Compiler/private descriptor756864b80d90bb6fa7974ed2924278751cfe232c is source-accepted after all10changedfiles read. Root59 compiler hook/binding/product/split-union tests plus15 exact committed emission controls,50 core description/surface/docs controls and both strict TypeScript checks pass. Logs work/review-FORMA-103/tmp/conditional-{compiler,core,compiler-types,core-types,union-emission,docs}-independent.log. Initial commands named two nonexistent filters, so those first results are accurately53compiler/31core; separate exact union/docs runs supply6/19. Ordinary test/selected branch evaluation remains once, function-valued results retain identity, original UTF16 source edits compose, and whole actual FMIR is unchanged. Runtime activation integration is still pending.

Control integrationa863aa8 is explicitly not accepted: four independent unit cases and the unchanged initial portions of a three-engine native replay expose later textarea children updating only defaultValue, retaining stale live value. DR-7 requires controlled later value writes while initial early edit/zero-write behavior stays intact. Original tests/logs are work/review-FORMA-104/forma/packages/core/src/dom/__tests__/reviewer-adoption-textarea.test.ts and tmp/textarea-controlled-original-independent.log, textarea-controlled-native-original-independent.log. Owner has the correction in progress; no acceptance from the obsolete later-value expectation.

Event-only132fadeed5894ea85eb05f35e47167831e9aa563 and content-helperbc83a7e15c0feeed13467234d030b2bc8abaab42 are in independent review. Original event three-case failure and ancestor-form three-engine failure remain preserved. A finite actual compiler/native audit additionally found shorthand textarea value getter emits an empty anonymous attr:value slot while an explicit arrow emits its real local signal default. Sources/IR/dumps/HTML remain under work/FORMA-104/textarea-admission-audit; root is investigating producer correction without runtime repair. Remote main remains1279ccd; onlyDependabot32–36 open. No new PR/tag/publication/application work.

### 05:58 EDT controlled textarea accepted; event/content review findings retained

Control integrationa863aa8 plusfcf4b7546d734ca82e3f653ef6e63e0a4e7b7c94 is independently accepted for its scoped control behavior. All11fixfiles read; original four reviewer controls authenticate unchanged (SHA2562b93f3daae4b77e5b6ee3cb67f8b777f08d1679fc642a4fd032ae43f30f41e25). Root2274core/163files, strict types and independent Chromium/Firefox/WebKit replay pass, with zero initial property/DOM writes, early seeds/focus/selection and controlled later writes. Logs tmp/textarea-corrected-{core,types}-independent.log and textarea-controlled-native-corrected-independent.log. Obsolete2.x default-only tests/probe are archived before explicit3.0 expectation migration.

This full run does not close events: a separate exact132fade reviewer test shows a listener created during a later effect rerun loses ownership; its callback-created effect survives disposal in all3engines. Evidence work/review-FORMA-104-events/review.md. Runtime owner is correcting generation-specific listener ownership while preserving ordinary CSR independence.

Contentbc83 review requested changes: CSS rejected-value cache suppresses later clear; template raw clearing ignores content fragment; noscript inert parsing cannot reproduce the original document's scripting mode. All3cases reproduced in all3engines, with exact original files/logs preserved in work/review-FORMA-104-controls/content-review.md. Authorb6d64a corrects CSS cache and awaits replay; template support is being fixed. Lead explicitly approved a narrow STRUCTURE refusal for non-null raw HTML on HTML noscript in this private facade, including later transitions from fallback, because no authenticated scripting context exists; keep typed validation, null/false fallback/clear and ordinary CSR unchanged. This is documented compatibility scope, not a claim that compiler205 is already mandatory.

Root-authored compiler correctiona4b6c6fb8 reuses the actual lexical signal slot for direct function-valued attributes. Original five fixed source-pair controls all failed; now924compiler/45files, strict types and copied actual native textarea products pass. Direct/arrow FMIR now matches exactly, canonical binding hash remainsd2f7fa9546ee1f66, and existing committed fixtures are unchanged. Independent review assigned to review_merge before acceptance. Evidence work/review-FORMA-103/tmp/direct-getter-*. No new PR/tag/publication/application work; original merge authorization remains active.

### 06:12 EDT content, template snapshots and attribute producer accepted

Content helpers bc83a7e plus b6d64a,550413b,91832de are independently accepted for private integration. Root read every combined source/test/doc delta and replayed419 focused controls, strict types and39 native cases across3engines. Reviewer separately replayed345 unit/inventory,36 contextual/TT checks and6 unchanged original CSS/template reproductions. The CSS cache reflects actual live CSSOM results; template clears its content fragment; the approved noscript limitation has explicit STRUCTURE/typed-policy/fallback controls and accurate staged docs. Original failures remain preserved. Logs work/review-FORMA-104/tmp/content-corrected-{focused,native,types}-independent.log.

Template snapshot17c89c77ce399a8b1516308253855756698266ba is accepted after both file deltas and native harness read,88 root structural/walker/list controls, strict types and all3engine replay. The original template.content fragment and recursively inert children are observed before component execution; same-markup replacement refuses, marker-looking comments remain unparsed, and inert fake island attributes do not grant opacity. Connected owned child islands remain opaque. Logs tmp/template-snapshot-{focused,native,types}-independent.log.

Direct attribute producera4b6c6fb8681629f4ea8ddb8d55cedfc4ce7c8ce is independently accepted: root924 compiler/types, reviewer56 focused lexical/import/refusal controls and actual strict-plugin/native products pass. Direct/arrow textarea produces identical282-byte FMIR with canonical hashd2f7fa9546ee1f66. Existing committed fixtures unchanged; original wrong product retained. Reviewer report work/review-FORMA-104-attribute/review.md. Assertion-placementd0edaca2a03a6ca7fae9a0f693cc5101b7718498 is also reviewed and root10 frame/policy controls pass; it preserves all assertions and changes no production source/caps.

Event2d4 fixes the original later public-effect listener leak but two internal h binding failures remained: removed generation resources survived and a later reader error did not abort its owner. Both failures reproduced all3engines, with no uncaught page errors; exact originals remain in work/review-FORMA-104-events. Runtime correctiona463ca57a735c172a617c12cb024b754f38b6286 is under independent review, not yet accepted; author2289fullcore/types and native evidence are not substituted for that review. Root has read all its3file delta and surrounding effect path.

Runtime continues accepted conditional/content integration before activation. review_merge prepares a read-only legacy hydration retirement plan/caller inventory to parallelize the later size work; recover_history reviewsa463 before a small diagnostic-catalogue documentation task. No new PR/tag/publication/application work. Root review104 now integrates17 (therefore conditional/template harness ancestry and unaccepted2d4), while review103 contains accepted attribute fix and test-only frame correction. Durable continuation inventory is work/continuation-checkpoint-20261015-0600.json; designSTATUS latest localcommit69351e3.

### 06:36 EDT strict adoption continuation checkpoint

Scoped events through 2ffab756b724912d6d3643d5af1c5ed10ea24836 are independently accepted: reviewer 2,314 core tests/165 files, types and 21 original browser controls pass; root 2,325 tests/170 files plus types pass (extra root regressions included). The caught initial reader exception now obtains and runs the engine disposer before rethrowing the exact original exception. Original failures remain unchanged. Staged diagnostic docs f379a7a are read and integrated.

Content integration 91843747f6c3b3a081f190a436cb72e9e9307dba has full root source review plus independent 101 focused controls, two actual active-child ownership controls and three enforcing-CSP native replays. No content finding remains. Conditional 7f26764 is NOT accepted: real strict-plugin/native n()?h('b',null,n()):null stays 1 after n becomes 2 in all three engines. Exact original evidence is work/review-FORMA-104-events/conditional-adoption-independent/same-branch*; runtime author is distinguishing compiler ternary tracking from createShow boolean caching.

Root strict facade source is staged at c77a31a161f8b9c5843ddccfa6b5860049a7e7c6 in review-FORMA-104/forma, based on explicit target seam d9e03e1. It removes the old repairing walker, moves descriptor interfaces, removes old hydrating branches/listener recorder/initial form repairs and retains the public signature using an unprivileged caller-owned lifecycle. Exact 41 originals (883,887 bytes) are archived with Git/SHA/length manifest and a pending migration ledger. This is an integration checkpoint, not acceptance: old activation imports and broader test/doc migrations remain. Root error helper d967e676 passes three focused classification/reporting controls. Root cleanup/form migration c5632bd3713b56c998f432865910cd41442e0d0f passes 15 tests and records explicit original-to-new case mapping.

The original new facade test also found a precommit revocation leak: a component disposes its caller then creates an effect; the stale sink falls through to ordinary immediate execution. Exact source tmp/original-hydrate-strict.test.ts and log tmp/retirement-facade-first.log preserve 1 fail/16 pass; runtime author owns the lifecycle fix. No expectation weakening. recover_history now owns four larger legacy direct-helper suites in isolated FORMA-104/direct-fixtures; root owns public facade/caller suites, cleanup/form controls and the shared migration ledger. resume_fmir owns conditional correction, lifecycle leak, nested child claims (new scoped 3d040889 pending review), activation and diagnostics.

Frame guard 209ca405cee536f39d5daf6815347bbd03c5fe4c is fully source-read; root 64 focused controls/eight files and types pass. Author 72 controls, all 42 artifacts and 21 browser checks pass. Actual frame is 39,980/40,000; core32,608/browser31,924/runtime42,465 still exceed unchanged caps, hardened40,467 passes. Root approved a separate private internal-effect delegate dependency refactor after reading RUNTIME-EFFECT-DEPENDENCY-PLAN.md; review_merge owns effect.ts only. No new flag/cap/minification change.

Remote remains previously recorded main1279ccd; no new PR, tag, publication or application work. All authorized prior merges remain preserved.

### 06:59 EDT strict adoption review and retirement checkpoint

Conditional ccab2727 plus583ebb52 is independently accepted for its scoped generation tracking. The original actual strict-plugin/native same-truthiness regression now updates in all three engines; the unchanged nine earlier browser controls and three product replays pass. Reviewer71 focused checks plus original-exception ownership control pass. The initial tracked-reader exception masking failure is preserved, and the author corrected an earlier inaccurate60/61-pass claim. Evidence work/review-FORMA-104-events/conditional-review.md and tmp/conditional-583-independent.json.

Effect-dependency ab77ebe145ef1730dcc055093b336d9628e6599e and frame209 are source-reviewed and accepted as scoped refactors. Root coherent pre-retirement full run passes2,328 core tests/167 files and strict types; original sparse-checkout author failures remain recorded. Runtime41,530/41,500 still fails by30 bytes, core32,665/30,000 and browser31,975/29,000 fail; frame39,980/40,000 and hardened40,467/40,500 pass. No cap/readability change or overall size acceptance. Logs work/review-FORMA-105/tmp/effect-delegate-{core,types}-independent.log.

Root facade/error/cleanup/form/security retirement throughfa352 is independently reviewed: all source deltas read,41 original files authenticated,354 authored plus7 reviewer boundary controls pass. Root296 security/trusted checks and31 raw controls pass, including unchanged once-only warning fixed byd3537cc. Precommit revocationa9 closes the exact caller-abort effect leak. Root104 now composes583+ab77; overall integration is not yet green because activation and migration work remains.

Root91877d55 maps all38 original cases across owned-adoption, form-control-adoption, list-disposal and multi-island-integration, adding a separate empty-SSR refusal/count control. Eighteen public control cases keep matching positives and explicitly refuse unprivileged edited bindings or older mismatched defaults; compiled writable positives remain in adoption-control-bindings. Current public controls16pass/3fail: retained matching HTML title RCDATA is a real production gap, assigned to runtime author. List/multi await strict activation. Original30fail/8pass baseline and migrated failures are preserved.

Agentdirect-fixturesa5c18147 checkpoints four legacy suites and a private helper; exact121,660 original bytes and139 declarations mapped.135/137 tests pass; two unchanged enabled activation-isolation controls await integration. review_merge owns four further public suites and a narrow postcommit descriptor materializer for a preserved nested HTML link namespace failure inside SVG foreignObject. resume_fmir owns strict activation/actual AdoptionScope/child claims/internal SSR phases/diagnostic context and title; recover_history owns only the small control-token diagnostic follow-up. No skips, fabricated authority or retired repairing adopter.

No new PR/tag/publication or application work. Previous authorized history-preserving merges remain complete; remote last recorded main1279ccd. Continue integration, independent native/full/package verification and unchanged size gates before the next PR.

### 07:29 EDT activation, native verification and owned materializer checkpoint

Strict activation855 plus19655/7195 is source-reviewed and integrated: successful original hosts/subtrees receive no initial DOM writes; malformed state stays inert; adoption failure emits one coded event and one error-status write. Root replayed the unchanged actual365-byte compiled Counter product in all3engines: same host/nodes, zero records on success,1→2 live update, exact refusal diagnostics on mismatch. Callback24b3408 is independently accepted after all5file deltas,318 controls/38files, strict types and3native replays. It isolates ordinary effect/ref/event/cleanup DOM construction from describing factories without transferring unrelated ownership.

Root last complete core run at729eab:2,324pass/9fail/2,333tests. Two preserved namespace failures remain production work; two stale keyed-count expectations plus9 assertion-policy cases are fixed in reviewed0df9480 (143 author controls pass), and root owns probe retirement while recover_history updates docs. Browser migrationff575ed4 preserves all21 original cases, adds one readonly/literal boundary, and passes66 cases across3engines. Root independently replayed those66 plus54 Trusted Types cases against fresh42artifacts. First TT attempt omitted requiredruntimefixturecopy (45fail/75pass); exact failed logs/results are preserved and prepared rerun54/54 passes.

Archive now51 exact originals/1,092,243bytes authenticated byGit/SHA/length. The54 removed-implementation probe definitions remain verbatim in an explicit retirement ledger and complete originalcorpus archive; all255 applicable JSONentries are unchanged and check-only255/255 +5integritytests pass. No new mutation definitions/runs or new detection-rate claim. Independent retirement review remains requested. Six activation suites and four namespace/Fragment/list suites are mapped; all58 cases retained,56pass/two realnamespace failures. Root3state fixture migration is independently accepted40/40 with allparameterizedcases recorded.

Materializer05b6a81 is a scoped newmodule/sharedfillElement proposal under review; actualwiring remains pending. Runtime8677046 extracts existing owned live-list range reconciliation (author63controls/types/24native), root source-read, independent replay next. Nested explicitShow must preserve candidate-before-replacement semantics, so ordinarycreateShow is not its adapter. Existingmulti-node/empty/sharedText rows must retain owned spans. resume_fmir owns runtime adapters/wiring; review_merge owns materializer and reviews range integration; recover_history owns docs and subsequent archive/probe review.

Fresh root34666481 build passes42artifactchecks, but **all unchanged size caps fail**: core45,791/30,000; browser45,081/29,000; runtime41,686/41,500; frame40,032/40,000; hardened40,509/40,500. This is not release orwhole104acceptance; dependency/size work, finalpacked andhostedgates remain. No newPR/tag/publication/application work. Durable inventory:work/continuation-checkpoint-20261015-0729.json.

### 08:07 EDT integrated adoption and retained review checkpoint

Root integration is preserved on named branch `codex/forma-upgrade-review` at `12fc78688eb8f7ff40bb6d7fd6d3429c8e51f26f`. All scoped source through shared list867704, live ranges0f6+b70, materializer05b6+f147+fd5, real adapter controls0dcca, wiring23abd, element/textarea readerc4a+89a and effect-pooldab is independently reviewed and integrated. The two original namespace failures now pass unchanged. Real element readers and composed textarea values build the complete candidate generation before retiring the old one; failure preserves the old content and ownership. Full source/native comparisons preserve exact original failures and products.

Production source at689bc9 passes **2,382 core tests/191 files**, strict types, all four workspace builds and42 artifact checks. Twelve previously untracked103 reviewer files are now committed at12fc:11 byte-identical; one only replaces its absolute evidence output directory with a temporary local directory, with exact original archived. Full compiler **924/45** and build **271/24** pass; scaffolder **149 pass/18 opt-in heavy omitted**. Core publint/ATTW/development packaging passes. Six packed compatibility/raw/integrity controls, the actual packed raw-lint bin,10 template browser verifier controls and two original reviewer browser regressions pass. Production npm audit has zero vulnerabilities. Fresh full three-engine core browser and seven-archive candidate preparation are running; these are not yet claimed passed.

Root and independent reviewer each replayed all **15 actual strict compiler/native cases across Chromium, Firefox and WebKit**. Thirty-five actual source/IR/HTML/state/dump outputs match preserved products. They cover later namespace/template/keyed-row construction, sole/composed controlled textarea and retained scalar Text identity; initial retained DOM has zero writes. Original four low-level-emitter inputs remain separately authenticated and are not relabeled strict compiler successes. Reviewer report:work/FORMA-104/retirement-tests-evidence/RUNTIME-WIRING-REVIEW.md.

Archive/probe retirement and browser case mapping are independently accepted:51 exact originals/1,092,243 bytes;255 active definitions plus54 verbatim retired definitions partition the309 original definitions. Check-only255/255 passes; no mutation campaign or new score claim. Benchmark and documentation changes are reviewed; historical released content and fixed source failures remain preserved.

Four unchanged package caps still fail: **core47,546/30,000; browser47,203/29,000; runtime41,648/41,500; hardened40,509/40,500** gzip bytes. Frame39,997/40,000 passes. Pool allocation improves frame/runtime without changed ceilings or readability policy. A raw-writer cleanup proposal is deferred because it would invalidate six retained probe anchors, including two live semantics. Size or overall104/release acceptance is not claimed. FORMA-021 now has an independent exact A2/current route-graph measurement underway; route10KB and package caps remain separate decisions.

Agentresume_fmir is preparing181's concrete keyed-row implementation plan (no code yet): existing canonical nonempty key bytes and row ordinals stay stable, native section6 carries opcode-offset paths, and native whole-render key refusal is distinct from browser island isolation. review_merge owns fresh full core browser validation; recover_history owns route-size evidence; root owns package acceptance and integration. No new PR, tag, live publication or application work. Earlier authorized history-preserving merges remain complete. Durable inventory:`work/continuation-checkpoint-20261015-0807.json`.

### 08:21 EDT full-browser and actual-package findings

Root codex/forma-upgrade-review is f1b2e53646f988715ef733d14e1f2e96da22f381, preserving12fc plus independently accepted P17 per-wire semantic-name fixa444. Fullcore three-engine run at exact689 production tree is351pass/3same-state-roundtrip failures, notgreen. Correct matching descriptor fixture exposes actualNUL parser disagreement;182 owner is preparing shared normalization, preserving all100 original transport values and failure artifacts. Seven12fc archives DS11ed8e0da11681a4a0d62fc23764a6512d1cc7d628a14e7fbdd51f367b14585f64 passed packaging/source restoration. Heavy scaffold167executed:166pass/1debugReport-Only-console failure. Explicit separate release-profile acceptance is in progress;debugfile-corruptioncontrols remain. P17 firstactualfailure(name lookup) is fixed/reviewed; full replayawaitsprofilefix.

181checkpointA is approved and started on forma-181-keyed-rows in work/FORMA-181/forma; ticketmoved In progress, trackerregenerated. Preserve canonicaldigests/ordinals and exactlowlevelunkeyedinputs; onlycompilerkey/rootproof+section6now.182normalizationownerreview_merge;releaseprofileownerrecover_history;rootintegrates/reviews. Route-size reportwork/FORMA-021/MEASUREMENT.md independently authenticates10outputs/fivefixtures; currentCounter25,726gzip9, dashboard17,906, About0JS, workersseparate. Allfourpackagecapfailures remain; noceilingschanged. No newPR/tag/publication/app work.
