# FORMA-252: Windows scaffold-lane timeouts, CI history

Read 2026-10-23 from the 80 most recent `CI` workflow runs (2026-10-17 to 2026-10-23, every attempt):
`gh api repos/getforma-dev/forma/actions/runs/{run}/attempts/{n}/jobs` for job and step times,
`gh api .../actions/jobs/{job}/logs` for the vitest default-reporter lines, and the retained
`candidate-scaffold-*` / `published-scaffold-*` artifacts (vitest JSON and scaffold report) for the
failing jobs. A re-run attempt lists the jobs it carried over from the earlier attempt under new ids
with the same start, end and log; those nine copies (three Windows: 120192218569, 119634838193,
119639722261; six Ubuntu) are counted once. That leaves 186 unique scaffold-lane jobs that printed
vitest results. Four more ran the suite step without results and are unrelated: two published jobs of
39711631725 stopped in the registry preflight fetch (`DOMException TimeoutError`, before vitest), and
two Windows jobs of 39882962322 hit the CRLF-shebang transform error FORMA-164 fixed.

- `scaffold-lane-timings.csv`: one row per unique job (both lanes, both OSes): job, suite-step and
  setup-step seconds, runner image and region, vitest start indicators (transform/import), file
  durations, and the per-test durations the default reporter prints (tests over 300 ms; Windows prints
  nearly all of them). Setup-step and start-indicator columns are filled for Windows rows only.
- `failures.json`: the original failure messages, the observations each failing job recorded before it
  failed (the engine evidence) and its timings, kept because job logs and 14-day artifacts expire. Its
  `commit` is the tree the job built; for the two pull-request runs that is GitHub's merge ref
  (`226950be` merges PR152 head `dd886ad5`; `7ee70a17` merges PR147 head `ae2eb36f`).

## Outcomes

| Lane | Unique jobs with results | Failed | Failure |
|---|---|---|---|
| candidate-scaffold (windows-latest) | 58 | 2 | CLI `spawnSync ETIMEDOUT` (39883361936 a1); `page.goto` 15 s (39980387199) |
| scaffold (windows-latest) | 31 | 1 | `locator.boundingBox` 15 s (39715843496 a2, FORMA-236) |
| candidate-scaffold (ubuntu-latest) | 65 | 0 | |
| scaffold (ubuntu-latest) | 32 | 0 | |

## Distributions (ms unless marked; Windows over 89 unique jobs)

| Measure | Windows | Ubuntu | Budget |
|---|---|---|---|
| Suite step (s) | candidate p50 592, p90 650, max 775 (n 58); published p50 577, max 692 (n 31) | candidate p50 157, max 188 (n 65); published p50 152, max 177 (n 32) | job 45 min |
| CLI-backed tests (runCli, some plus an IR compile) | p50 940, p90 1,730, p99 6,823, max 32,012 (n 621); all six over 10,000 in two jobs | at most 1,646 when printed | each child 25,000; test/hook 60,000 |
| `tells an npm user ...` (runCli alone) | p50 884, p90 1,574, p99 3,780, max 5,629 (n 176) | | 25,000 per child |
| `minimal: packed native island ...` (npm ci, builds, three engines) | candidate p50 103,387, p90 122,787, max 140,580 (n 58); published p50 104,314, max 138,855 | candidate p50 47,716, max 70,756 | test 900,000; each Playwright step 15,000 |
| `dashboard: chart tooltip ...` | candidate p50 40,516, max 55,924; published p50 43,523, max 64,529 | candidate p50 15,428, max 17,071 | test 900,000; each Playwright step 15,000 |
| vitest transform at suite start (s) | p50 1.31, p90 2.10, max 9.42 | | none |
| vitest import at suite start (s) | p50 2.81, p90 4.02, max 10.78 | | none |
| Suite preparation before vitest (s) | p50 5.40, p99 11.1, max 23.0 | | none |
| Playwright browser install step (s) | p50 217, p90 237, max 342 | | 8 min |

Vitest prints no hook durations and no per-engine browser times, so neither the `beforeAll` CLI calls
nor a single `page.goto` can be read from history; the diagnostics this ticket adds now record both.

## The three Windows failures

1. **CLI ETIMEDOUT, 39883361936 attempt 1, job 120186406762** (eastus, image 20261021.278.1). This
   runner was slow before any test ran, against the Windows medians: Rust toolchain 20 s (1.67x, 94th
   percentile), npm ci 33 s (1.50x, 92nd), Playwright install 342 s (1.58x, the maximum), suite
   preparation 23.0 s (4.3x, the maximum), vitest transform 7.87 s (6.0x) and import 9.25 s (3.3x). Every
   runCli in the first ~90 s of the suite (both scaffolding `beforeAll` hooks, the first E2E case, three
   template-islands cases and the templates compile case) was killed at the 25 s child budget, at least
   28x the 0.88 s median of the runCli-only test; partial stdout ends at "Scaffolding project...". The
   EPERM cleanup failures and the one-file listing difference followed in the same directories; the
   templates case's ETIMEDOUT was hidden by its own `finally` cleanup EPERM. Later cases passed
   (`minimal: npm ci ...` took 89.8 s against a 38 s median). Windows jobs running at the same time on
   other runners (39883361936's published job, 39884039158's candidate job) were not slow, so the
   slowness was this runner's, not load from concurrent runs. The only other job with CLI-backed tests
   over 10 s (39828037957, job 119997038988, 12.6 s, passed) had normal setup steps but a slow vitest
   start (transform 5.04 s). **Counterexample:** job 118397441756 (run 39351576082) had the slowest
   transform (9.42 s) and import (10.78 s) of all 89 and 9.4 s of preparation, yet its CLI-backed tests
   took 0.97-3.0 s. The image's runner build disables Defender real-time monitoring and excludes C:\ and
   D:\ (actions/runner-images `Configure-WindowsDefender.ps1`), so on-access scanning is not the
   expected cause.
2. **page.goto 15 s, 39980387199, job 120506279341** (westus3, image 20261021.278.1). This runner was
   fast: setup steps at or below the 25th percentile except a 5 s cache restore, transform 1.13 s, suite
   512 s (9th percentile). The owned server had printed FORMA_LISTENING and answered the readiness GET /
   (withOwnedServer waits for both before any visit), then served Chromium's whole island and
   static-route checks: the report holds `minimal: chromium actual native island and static route` and
   nothing for Firefox or WebKit, and the engines run in that order, so the navigation that never
   committed was **Firefox's**. Firefox then passed the dashboard test later in the same job against
   another server.
3. **boundingBox 15 s, 39715843496 attempt 2, job 119634921005** (FORMA-236, published lane; centralus,
   image 20261007.264.1). Also a fast runner (Playwright install 149 s, 1st percentile; suite 474 s). The
   report holds all three minimal observations and only `dashboard: chromium tooltip text and policy`,
   so the stalled engine was again **Firefox**.

No other browser step timed out in 186 unique jobs (89 Windows, about 178 Windows Firefox sessions),
and none on Ubuntu. Two of the three failures ran on image 20261021.278.1 (20 of 89 Windows jobs); with
three events that is not a significant difference, and the image's medians match the older image's.

## Conclusions

- **The PR152 runner was anomalously slow (high confidence):** every setup and suite-start phase ran
  1.5x to 6x its median, two of them the slowest of 89 jobs, while concurrent runners were normal.
- **That generic slowness explains the 25 s kills (moderate confidence; mechanism unknown):** the CLI
  stall was at least 28x its median against 1.5x-6x for setup, and the counterexample above shows a
  slower suite start without any CLI stall, so whatever stalled the CLI was more than the slowness the
  setup steps measured. The calls were censored at 25 s, so the history cannot say what budget would
  have sufficed; across all 621 CLI-backed tests p99 is 6.8 s. The 25 s child budget is unchanged.
- **The two browser timeouts are not runner slowness and not a readiness race (high confidence):**
  both runners were fast, readiness is proved before any visit, and the same server had just served
  Chromium. **Both stalls are Windows Firefox** (inferred from observation order, not named by the
  error). Whether the server stopped answering, the request never left Firefox, or Firefox stalled after
  commit cannot be told from what the failures recorded (moderate confidence that it is a
  Firefox-on-Windows stall). The 15 s step budget is unchanged; nothing in the history measures a
  single step's normal duration.

The added diagnostics name the engine and version, keep the page's own timeline (goto, each request and
response), probe the owned server after a failed visit and print its output, report a killed CLI's
elapsed time, how far its scaffold got and a host process snapshot, and record every CLI call, server
start and engine run in the scaffold report with a one-line summary per job. Their first healthy
Windows runs (PR159, CI 40011784991) measured scaffold CLI calls at p50 0.42-0.47 s, max 0.9-1.1 s;
owned-server listening at p50 22-29 ms; and Firefox checks at p50 6.4-7.2 s against about 2 s for
Chromium and WebKit, all inside their budgets.
