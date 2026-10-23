# FORMA-252: Windows scaffold-lane timeouts, CI history

Read 2026-10-23 from the 80 most recent `CI` workflow runs (2026-10-17 to 2026-10-23, every attempt):
`gh api repos/getforma-dev/forma/actions/runs/{run}/attempts/{n}/jobs` for job and step times,
`gh api .../actions/jobs/{job}/logs` for the vitest default-reporter lines, and the retained
`candidate-scaffold-*` / `published-scaffold-*` artifacts (vitest JSON and scaffold report) for the
failing jobs. 199 scaffold-lane jobs ran their suite step; 195 printed vitest results. The four that
did not are unrelated: two Windows/Ubuntu published jobs of 39711631725 stopped in the registry
preflight fetch (`DOMException TimeoutError`, before vitest), and two Windows jobs of 39882962322 hit the
CRLF-shebang transform error FORMA-164 fixed.

- `scaffold-lane-timings.csv`: one row per job (both lanes, both OSes): job, suite-step and setup-step
  seconds, runner image and region, vitest start indicators (transform/import), file durations, and the
  per-test durations the default reporter prints (tests over 300 ms; Windows prints nearly all of them).
- `failures.json`: the original failure messages, the observations each failing job recorded before it
  failed (the engine evidence) and its timings, kept because job logs and 14-day artifacts expire.

## Outcomes

| Lane | Jobs with results | Failed | Failure |
|---|---|---|---|
| candidate-scaffold (windows-latest) | 60 | 2 | CLI `spawnSync ETIMEDOUT` (39883361936 a1); `page.goto` 15 s (39980387199) |
| scaffold (windows-latest) | 32 | 1 | `locator.boundingBox` 15 s (39715843496 a2, FORMA-236) |
| candidate-scaffold (ubuntu-latest) | 69 | 0 | |
| scaffold (ubuntu-latest) | 34 | 0 | |

## Distributions (ms unless marked)

| Measure | Windows | Ubuntu | Budget |
|---|---|---|---|
| Suite step, candidate (s) | p50 594, p90 647, max 775 (n 60) | p50 156, max 188 (n 69) | job 45 min |
| CLI-backed tests, both Windows lanes (runCli, some plus an IR compile) | p50 944, p90 1,694, p99 6,510, max 32,012 (n 642); all six over 10,000 in two jobs | at most 1,646 when printed | each child 25,000; test/hook 60,000 |
| `tells an npm user ...` (runCli alone) | p50 888, p90 1,563, p99 3,764, max 5,629 (n 182) | | 25,000 per child |
| `minimal: packed native island ...` (npm ci, builds, three engines) | candidate p50 102,837, p90 122,404, max 140,580 (n 60) | p50 47,119, max 70,756 | test 900,000; each Playwright step 15,000 |
| `dashboard: chart tooltip ...` | candidate p50 40,259, max 55,924; published p50 43,523, max 64,529 | p50 15,408, max 17,071 | test 900,000; each Playwright step 15,000 |
| vitest transform at suite start (s) | p50 1.32, p90 2.06, max 9.42 (n 92) | | none |
| Suite preparation before vitest (s) | p50 5.45, p99 10.7, max 23.0 (n 92) | | none |
| Playwright browser install step (s) | p50 217, max 342 (n 92) | | 8 min |

Vitest prints no hook durations and no per-engine browser times, so neither the `beforeAll` CLI calls
nor a single `page.goto` can be read from history; the diagnostics this ticket adds now record both.

## The three Windows failures

1. **CLI ETIMEDOUT, 39883361936 attempt 1, job 120186406762** (eastus, image 20261021.278.1). Every
   step on this runner was slow before any test ran: Playwright install 342 s (the maximum of 92, p50
   217), npm ci 33 s (89th percentile), Rust toolchain 20 s (95th), suite preparation 23.0 s (maximum),
   vitest transform 7.87 s and import 9.25 s (p50 1.32 and 2.81). Every runCli in the first ~90 s of the
   suite (both scaffolding `beforeAll` hooks, the first E2E case, three template-islands cases and the
   templates compile case) was killed at the 25 s child budget; partial stdout ends at "Scaffolding
   project...". The EPERM cleanup failures and the one-file listing difference followed in the same
   directories; the templates case's ETIMEDOUT was hidden by its own `finally` cleanup EPERM. Later cases
   passed (`minimal: npm ci ...` took 89.8 s against p50 38.2 s). Windows jobs running at the same time
   on other runners (39883361936 published, 39884039158 candidate) were not slow, so the slowness was
   this runner's, not load from concurrent runs. The only other job with CLI-backed tests over 10 s
   (39828037957, 12.6 s, passed) also started slowly (transform 5.04 s). The image's runner build disables
   Defender real-time monitoring and excludes C:\ and D:\ (actions/runner-images
   `Configure-WindowsDefender.ps1`), so on-access scanning is not the expected cause.
2. **page.goto 15 s, 39980387199, job 120506279341** (westus3, image 20261021.278.1). This runner was
   fast: setup steps at or below the 24th percentile except a 5 s cache restore, transform 1.13 s, suite 512 s (10th percentile). The
   owned server had printed FORMA_LISTENING and answered the readiness GET / (withOwnedServer waits for
   both before any visit), then served Chromium's whole island and static-route checks: the report holds
   `minimal: chromium actual native island and static route` and nothing for Firefox or WebKit, and the
   engines run in that order, so the navigation that never committed was **Firefox's**. Firefox then
   passed the dashboard test later in the same job against another server.
3. **boundingBox 15 s, 39715843496 attempt 2, job 119634921005** (FORMA-236, published lane; centralus,
   image 20261007.264.1). Also a fast runner (Playwright install 149 s, 1st percentile; suite 474 s). The
   report holds all three minimal observations and only `dashboard: chromium tooltip text and policy`,
   so the stalled engine was again **Firefox**.

No other browser step timed out in 195 jobs (92 Windows, about 184 Windows Firefox sessions), and none on
Ubuntu. Two of the three failures ran on image 20261021.278.1 (21 of 92 Windows jobs); with three events
that is not a significant difference, and the image's medians match the older image's.

## Conclusions

- The CLI ETIMEDOUT is runner slowness (high confidence for this runner; mechanism unknown), with the
  25 s per-child spawnSync budget the limiting one (the 60 s hook budget was never reached). The calls
  were censored at 25 s, so the history cannot say what budget would have sufficed; across all 642
  CLI-backed tests p99 is 6.5 s, and every one over 10 s came from the two slow-start jobs. The budget is
  unchanged.
- The two browser timeouts are not runner slowness and not a readiness race: both runners were fast,
  readiness is proved before any visit, and the same server had just served Chromium. Both stalls are
  Windows Firefox (inferred from observation order, not named by the error). Whether the server stopped
  answering, the request never left Firefox, or Firefox stalled after commit cannot be told from what the
  failures recorded (moderate confidence that it is a Firefox-on-Windows stall). The 15 s step budget
  is unchanged; nothing in the history measures a single step's normal duration.

The added diagnostics name the engine and version, keep the page's own timeline (goto, each request and
response), probe the owned server after a failed visit and print its output, report a killed CLI's
elapsed time, how far its scaffold got and a host process snapshot, and record every CLI call, server
start and engine run in the scaffold report with a one-line summary per job.
