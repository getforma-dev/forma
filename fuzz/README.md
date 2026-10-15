# FMIR decoder and walker fuzzing

The four libFuzzer targets share `forma_ir::fuzz_support` with ordinary stable tests.
`__fuzzing` is an internal opt-in feature; the shipped reader always checks CRC.
Input is capped at 65,536 bytes, render output at 65,536 bytes plus the escaper's final
character allowance, and total list iterations at 256. The container itself allows 16 MiB;
separate stable boundary tests exercise that exact limit and one byte beyond it.

| Target | Input |
|---|---|
| `parse_raw` | Whole arbitrary file, including invalid signature or checksum |
| `parse_body` | Arbitrary body prefixed by a correctly stamped v3 header |
| `parse_mutated` | One seed selector byte (modulo14), then `(u16 LE offset, u8 XOR)` triples; offsets wrap within the selected corpus module and CRC is restamped |
| `walk` | `u32 LE module length`, module bytes, slot value bytes |

Slot values are decoded in ascending declared slot-id order. Each starts with a u16 byte
length; truncation stops decoding and remaining slots are Null. Text is lossy UTF-8, Bool
uses first-byte parity, Number is zero-padded little-endian i32, and Array/Object are empty.
No recursive JSON adapter runs in either the fuzzer or stable replay. Validated modules
must tile, pass structural validation, and survive a lossless canonical-dump reconstruction.
Both direct and counted walks use the same budgets; an uncaught panic fails the target.

Run from the repository root:

```sh
cargo test -p forma-ir --test fuzz_regressions
python3 fuzz/seed-corpus.py
cd fuzz
cargo install cargo-fuzz --version 0.13.2 --locked
cargo fuzz run parse_body --sanitizer address -- -max_total_time=1200 -timeout=10 -rss_limit_mb=2048 -max_len=65536
```

`rust-toolchain.toml` pins `nightly-2026-10-01`; libfuzzer-sys and cargo-fuzz are pinned too.
The scheduled workflow runs all four targets for twenty minutes each under AddressSanitizer,
retains the growing corpus in the cache and uploads finding artifacts. PRs replay every
committed regression and frozen module on stable, without installing nightly.

A panic, sanitizer report, exceeded resource budget, invalid accepted structure or lossy dump
is a finding. An ordinary parse/render error is not. Minimize a finding with `cargo fuzz tmin`,
put the input under `regressions/<target>/`, and add a test that states the violated guarantee.
Fix it before a release; an unresolved nightly finding blocks a tag. The initial regression
files are adapter controls, not claims that production bugs were discovered. Evidence of the
local qualification run and deliberate test mutation is in `evidence/QUALIFICATION.md`.
