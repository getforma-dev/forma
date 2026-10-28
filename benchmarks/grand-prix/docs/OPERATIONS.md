# Running and retaining the laboratory

A single `.grandprix/active.json` serializes managed runs and dependency mutations
within this checkout. It records owner and worker PIDs. Do not run builds, installs,
other benchmarks or another checkout's campaign on the measurement host. The
existing drivers verify CPU placement and settling; those checks cannot prove the
absence of every external workload.

New sessions write into `runs/<id>/artifacts` through `GP_RESULTS_DIR`. Existing
CI workflows without that variable retain their established `results/` contract.
This compatibility boundary avoids invalidating frozen protocol consumers.

## Storage policy

Automatically removable: regenerable `node_modules`, `dist`, `target`, framework
caches and production build directories inside that session's recognized workspaces.
Protected: raw samples, probe bodies/headers, failures, locks, source, source hashes,
reports, lineage and logs. Plans fingerprint each deletion target and refuse stale
plans or linked ancestors. Cleanup reports bytes planned and disk before/after.

Docker cleanup uses run labels and the builder ownership receipt. Existing drivers
remove their own images/builder when done. The app's `cleanup --docker` also requires
that exact receipt; it never deletes unowned resources or shared base images.

No automatic age-based deletion of scientific evidence. Keep the original ZIP,
its SHA-256, run manifest, report and lineage link when promoting a result into
version control. CI upload-artifact retention is currently 30 days; import/archive
meaningful campaigns before expiry. The retained Round 2 archive is already in Git.
Do not commit regenerated dependencies/builds or copy the full repository into a
result archive. Log growth and retained source snapshots are visible in disk usage;
compression/export policy can be revised without changing measurements.

## Interruption and integrity

SIGINT/SIGTERM forwards to the owned driver, which performs its Docker cleanup.
Hard kills can leave a lock and resources; recovery must prove the same-host owner
and recorded worker are dead. Never remove a live or other-host lock by guessing.
`npm run gp -- recover RUN_ID` previews recovery; add `--apply` only after inspecting
the plan. It preserves the original lock/manifest, then you can clean exact owned
resources after the run is marked interrupted. Malformed locks require manual
investigation because ownership cannot be proved safely.

`verify` detects changed/missing retained files and unexpected additions. Generated
build/dependency directories are intentionally outside the evidence manifest.
Reports are derived outputs: the CLI verifies integrity before regenerating them.
A SHA-256 manifest detects accidental drift; it is not a cryptographic signature
against an attacker who can replace both evidence and manifest. Versioned archive
hashes and Git commits provide the independent reference.

An interrupted dependency apply keeps `updates/<id>/before/`, an intent receipt,
and original hashes. Run recovery deliberately refuses update-operation locks;
inspect the staged and original files, resolve the partial update, then clear that
lock only after proving its owner is dead. Do not blindly rerun apply on mixed inputs.
