# Run Grand Prix on GitHub Actions

Use hosted Ubuntu as the routine qualification environment and a Mac for local
correctness/debugging. Both environments can run Docker; on macOS Docker runs
inside Docker Desktop's Linux VM. Do not combine Mac ARM observations with Linux
x64 results or claim that the change in machine proves a framework improvement.

GitHub standard Ubuntu runners for this public repository currently provide four
vCPUs and 16 GB RAM. They are virtual machines, not dedicated physical machines.
The reviewed `gha-4-v1` protocol records actual CPU affinity and separates the
server/load generator allocations. It intentionally differs from `native-8-v1`.
For more precise long-term measurements, a quiet dedicated Linux host with fixed
hardware is a separate useful profile; Actions remains useful for orchestration.

References: [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [Docker Desktop's Mac VM](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/#containers-running-as-root-within-the-linux-vm).
Specs checked 2026-10-28; actual runner metadata and profile validation are authoritative.

## Qualified hosted inputs

Choose the exact reviewed branch in **Actions → workflow → Run workflow**. Use
`runner=ubuntu-24.04`, `profile=gha-4-v1`, and `diagnostic=false`. Pinning the Ubuntu
release avoids the `ubuntu-latest` alias moving to a different OS release; GitHub
still updates that image and the host hardware may vary. Preserve those identities.

| Purpose | Existing workflow | Additional inputs |
| --- | --- | --- |
| Full server comparison | `grand-prix.yml` | `cars=all`, `events=1-8`; exact `forma_ref` if testing candidate Rust crates |
| Controlled server before/after | `grand-prix-paired.yml` | `forma_refs` = exact candidate commits, comma-separated |
| DOM, bundle and reactive cores | `grand-prix-client.yml` | `forma_refs` = exact candidates; `profile_rows=false`, `compiler_templates=false` for the default core |
| Native activation/islands | `grand-prix-islands.yml` | Default complete entrant set |
| Explicit compression experiment | `grand-prix-compression.yml` | Exact candidate source; keep this distinct from identity-response tests |

Forma 3.2.0's registered source is
`fc76ea8531f0e3a85d0224087384e41f52040e3c`. Inspect the current ledger and candidate
configuration before selecting it. Server source replacement is a controlled
Rust-component experiment with frozen compiler/app inputs, not a complete new
all-package stack cohort. Related package and crate updates need coordinated locks.

Every before/after pair runs sequentially within one job/VM. Do not compare a
candidate from today's VM directly with last week's baseline as a causal speedup.
Rerun the control beside it. Keep different campaigns and resource profiles visible.
No concurrent builds/installations may overlap timing within the measurement host.

## Pull requests are diagnostic

The existing pull-request workflows intentionally force diagnostic mode and run
correctness/strength checks. A green pull request is not a new qualified performance
baseline. A qualified campaign requires the explicit hosted inputs above and all
original source, transport, correctness, browser and CPU-allocation checks.

The workflow defaults still use `native-8-v1` with diagnostics allowed. Do not
leave those defaults unchanged and then label the output `gha-4-v1` afterward.

## Keep readable, durable results

Existing workflows upload raw measurements, driver manifests and ownership/cleanup
receipts. They do not yet automatically generate the new laboratory dashboard or
HTML/Markdown/CSV reports. Download the exact artifact ZIP, record its GitHub run,
attempt and SHA-256, and promote it into the retained `evidence/` collection before
importing it through the application:

```sh
npm run gp -- import-evidence evidence/REVIEWED-CAMPAIGN/artifact.zip --id historic-UNIQUE-ID
npm run gp -- verify historic-UNIQUE-ID
npm run gp -- dashboard
```

Replace the example paths/ID with reviewed lowercase identifiers. Importing is
analysis of the original observations, not a rerun or a qualification upgrade.
Record accepted changes and costs in `config/change-ledger.json` with exact sources
and the original evidence link. Never overwrite the prior baseline.

Artifacts currently expire after **30 days**. Workflow logs and temporary artifact
URLs are not a permanent scientific archive. Meaningful results need their original
ZIP and digest retained in version control. Cleanup remains run-owned: no global
Docker pruning or deletion of other jobs' resources.
