# Bounded pre-RC setup rehearsal

This validates the new staging code before publishing an immutable RC. It does
not authenticate a published RC, run an hour, or earn any L-62 soak credit.

Use a Linux CI job dependent on the existing `candidate-pack` job. Download its
same seven original dry-pack archives and exact DS11 output hash, require its
commit to equal the actual checkout, and call the existing `validateCandidate`.
Require `dryRun: true`; preserve and rehash each archive and DS11 before/after.
Do not reuse earlier 51486 dry packs for the changed ca755 source. The existing
candidate pack will produce a matching set for the reviewed rehearsal head.

Add a small setup-only driver which invokes `prepareBurnIn` unchanged in purpose:
actual packed CLI, both templates, native fixture applications, five deployment
products, original extracted crate dependencies and four pinned nightly ASan
fuzz binaries. It makes no browser calls. After compilation, each target reads
the committed seed corpus with one bounded `-runs=1000` control; these finite
controls earn zero active-hour credit. No source-runtime fallback or repacking.

One necessary reuse correction: derive the coordinated dependency version from
all seven authenticated `set.packages[].version` values, not `set.tag.slice(1)`.
A dry-pack descriptor deliberately names a `*-dry-run` tag. The live RC reader
already independently proves all package versions equal the RC tag; this change
preserves that requirement and allows the same staging function to be rehearsed.

The new setup-only entry point requires explicit `worker DIRECTORY DS11_SHA256 COMMIT
WORK EVIDENCE` arguments; it cannot call the real worker or finalizer and cannot
write `burn-in.json`. Its report has `rehearsal: true`, `rcAuthenticated: false`,
`activeNanoseconds: "0"`, `burnInPassed: false`, exact source/DS11/archive/tool and
compiled-binary hashes, locked dependency provenance, and actual step results.
Any failure remains failure with original logs and partial evidence.

Host it under the same Linux subreaper with an initial 45-minute worker limit and
60-minute job limit; uploads of report/log/ownership are unconditional. Install
only pinned stable/nightly/cargo-fuzz and existing locked npm tools, Cargo jobs 3.
No browsers are installed or started. Source and ownership finite controls run
first. Successful setup closes FORMA-194's current locked graph/build question,
while actual published-RC authentication and the full hour remain separately due.

Proposed invocation after source review (inside the new CI job):

```
python3 scripts/release-owned-linux.py "$RUNNER_TEMP/burn-in-setup-owned" 2700 -- \
  node scripts/release-burn-in-setup.mjs worker \
  "$RUNNER_TEMP/candidate artifacts" "$RECORD_SHA256" "$GITHUB_SHA" \
  "$RUNNER_TEMP/burn-in-setup-work" "$RUNNER_TEMP/burn-in-setup-evidence"
```

The exact source/command must be independently reviewed before execution. This
plan creates no permission to start a local build during another measurement.
