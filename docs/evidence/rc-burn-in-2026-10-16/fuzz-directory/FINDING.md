# First actual packed setup failure: cargo-fuzz project discovery

Run 38949340060, PR head 4cbd098d, tested GitHub merge commit
fe549a5c8a7dd7a748fec5902e516685affeda50. Candidate DS11 SHA-256:
5338f99cd4e8cc6c1d9726bfa9d32d31a825c611194a667df83fb3e9b7fd7525.
The retained artifact 12068105957 is 7,272 bytes, authenticated against its
GitHub SHA-256 823cf092333808b580d7492569b810ef8652b672df0b5d6ddf8b6e3a2a4c871f.

Both packed templates, fixture applications, all five deployment builds and
their native release servers completed. Locked fuzz dependency fetch/metadata
and corpus seeding completed. The first ASan build refused before compiling:
`Error: could not find a cargo project`. No seed replay or soak credit occurred.
The worker failed and the supervisor proved complete cleanup/no surviving PID.

Pinned cargo-fuzz 0.13.2 commit 984c861c8dfea28055254c5f1d2659ab2cd63f76
explains the failure: `FuzzProject::manage_initial_instance` calls `find_package`
when `--fuzz-dir` is absent. That search deliberately skips any fuzz manifest
and seeks a non-fuzz Cargo.toml in an ancestor. Our isolated consumer has no
such parent. An explicit `--fuzz-dir` chooses the same existing fuzz manifest
without this discovery. The pinned build parser accepts the option and still
uses the same Cargo command, target triple and ASan flags. All three primary
upstream files are byte-equal to the installed pinned crate and archived with
URLs/hashes. The repair adds only `--fuzz-dir <existing staged fuzz directory>`
to the four original build commands. No package, manifest, lock, target,
sanitizer, output directory, seed count or timeout changes.

No local cargo/compiler/browser command was run for this repair because the
shared machine is qualifying R17/P17. The next reviewed hosted setup must prove
all four actual ASan builds and seed replays. An optional finite discovery-only
control is `cargo fuzz list` versus `cargo fuzz list --fuzz-dir <isolated fuzz>`
using the exact existing manifest; it compiles nothing, but remains unexecuted.
This record is a source diagnosis, not successful setup or burn-in evidence.
