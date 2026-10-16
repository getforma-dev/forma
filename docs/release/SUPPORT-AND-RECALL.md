# Release support and recall (FORMA-189)

The supported-lines block of `SECURITY.md` is generated from DS12 records and the
original GitHub Release `published_at` dates. Pre-releases do not start the v1
maintenance clock. The first unified final starts six calendar months of Critical
and High fixes for core 2.x, crates 0.2.x, build 0.3.x and compiler 0.3.x (L-29).
Later unified majors must be at least six calendar months apart. Month ends clamp
to the last day of the destination month, in UTC; patch releases and reruns do not
restart a clock. The first maintenance drill is due after the final release; no
live drill has been claimed by adding these tools.

`node scripts/security-md.mjs --history history.json --template SECURITY.md
--out SECURITY.md` replaces only the marked support block. Add `--check` to require
byte equality instead of writing. The history file has `schema: 1`, an `inventory`
path, and a `releases` array with `record`, `metadata` and trusted `sha256` fields.
Paths are relative to the history file. Record files are the original DS12 bytes;
metadata is the corresponding GitHub Release API response. Obtain the complete
inventory using `gh api repos/getforma-dev/forma/releases --paginate --slurp`.
Every advertised stable unified release must be present. A fetch failure, missing
record, invalid hash, inconsistent tag/date, draft, or unsupported schema is a
failure, not evidence that there was no previous release. The digest authenticates
bytes against the trusted input supplied by the release process; it is not itself
a signature or a proof of who published them.

## Recall

A recall is a founder operation under L-49, on a machine where no agent runs.
Trusted publishing cannot deprecate or yank a release. The script accepts no token
argument and does not create or persist credentials. The founder uses their own
npm sign-in with two-factor authentication and their crates.io web session.

First obtain the bad set's original `release-record.json` from its GitHub Release
and verify its source and digest. A dry run is the default:

```sh
node scripts/recall.mjs --record release-record.json --sha256 TRUSTED_SHA256 \
  --reason 'Security recall: upgrade to the replacement release.'
```

It prints all four exact npm versions and all three exact crate versions, without
registry access. It refuses omitted or duplicated package identities, a dry-run
set, a version mismatch or failed P17 evidence. Review the seven actions before
executing anything.

On the founder's separate machine only, add `--execute --confirm-tag vX.Y.Z
--receipt new-recall-receipt.json`. This runs the four `npm deprecate` commands
through the interactive sign-in (the registry's two-factor requirement applies),
then prints the three crate-version web pages for the founder to yank. The script
cannot verify the human identity or second factor; those are founder account
controls. It refuses CI execution and an existing receipt, records progress before
each operation, and stops on an error. Partial success must be checked against the
registry before any retry. The final exit code remains 2 and `complete` remains
false until the founder has performed and verified the web yanks and recorded all
seven registry outcomes. Completing only the npm half is never a completed recall.

This source slice provides validation, generation and the recall dry run. Wiring
support generation into DS12/release preflight and proving current toolchain
floors remain part of FORMA-189; their absence is not a completed-ticket claim.
