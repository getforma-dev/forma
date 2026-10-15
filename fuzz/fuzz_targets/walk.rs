#![no_main]
use libfuzzer_sys::fuzz_target;
use forma_ir::fuzz_support::{exercise, Target};
fuzz_target!(|bytes: &[u8]| { exercise(Target::Walk, bytes); });
