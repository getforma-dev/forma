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

## Release wiring and toolchain claims

The tag workflow's `check` job reads the complete GitHub release inventory and
validates every unified row before filtering drafts or prereleases. It downloads
all stable DS12 records and the latest prior prerelease, verifies each GitHub
asset digest, and checks six-month spacing before any publish job can start.
A rerun may finish the current tag's incomplete DS12, but cannot omit a different
stable release. Unreadable or malformed history fails closed.

After GitHub acknowledges publication, DS12 records the original `published_at`
as `publishedAt`, plus the derived support policy and authenticated history.
`recordedAt` still measures that workflow run and never determines support dates.
The generated complete `SECURITY.md` is uploaded alongside DS12. After the first
final, reproduce its marked block in the source document from those exact inputs;
do not invent a final date while working on prereleases.

All four npm packages declare Node >=22. `toolchain-matrix.mjs` supplies CI's
22/24 matrix and adds26 at 2026-10-28T00:00:00Z. The parsed workflow policy and its
seeded-drift controls prove that these versions are actually installed and tested.
Each crate's exact declared Rust floor is checked with the committed lock and a
separate fresh dependency resolution. The latter exports the committed source,
seeds only lock format3 (no dependency entries), resolves with stable Cargo's
MSRV-aware fallback, then builds with the declared older Rust. It refuses a changed
format and preserves the original candidate lock. It does not hand-edit a resolved
lock's format or silently replace the release's dependency graph.

The first S4 maintenance drill remains due after the final release, on `maint/2.x`,
with a seeded security patch shipped within seven days and two drills per year.
That future operational event and a founder-only live recall are not claimed by
these source checks. See `docs/evidence/forma-189/README.md` for actual local proof.
