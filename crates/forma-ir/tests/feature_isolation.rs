//! `test-helpers` alone never compiles in the stand-in panicking component.
//!
//! At 0.2.1, `test-helpers` added fixture encoders only. The fault trigger
//! (SR44's tests) lives behind the internal `__fault-injection` feature, which
//! `test-helpers` must not imply: under Cargo's resolver 1 a consumer's
//! dev-dependency line is enough to turn `test-helpers` on in its release
//! build, and a trigger there would let one JSON string panic the walker.
//!
//! This builds a scratch consumer, an edition-2018 crate (resolver 1) that
//! depends on this forma-ir with `features = ["test-helpers"]` as a NORMAL
//! dependency, the strongest way to have it on, and type-checks it twice:
//! naming the trigger must fail to compile, naming a fixture encoder must not.
//! Offline: it uses only crates this workspace's own build already fetched.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Write the scratch consumer with `lib_rs` as its library, and `cargo check`
/// it; return whether it compiled, with cargo's output.
fn check_consumer(dir: &Path, lib_rs: &str) -> (bool, String) {
    let forma_ir = Path::new(env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(dir.join("src")).expect("scratch dir");
    std::fs::write(
        dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"fault-isolation-probe\"\nversion = \"0.0.0\"\nedition = \"2018\"\n\
             publish = false\n\n[dependencies]\n\
             forma-ir = {{ path = '{}', default-features = false, features = [\"test-helpers\"] }}\n\n\
             # Its own workspace, not this one.\n[workspace]\n",
            forma_ir.display()
        ),
    )
    .expect("scratch manifest");
    std::fs::write(dir.join("src/lib.rs"), lib_rs).expect("scratch lib");
    let output = Command::new(env!("CARGO"))
        .args(["check", "--offline", "--quiet"])
        .current_dir(dir)
        .env("CARGO_TARGET_DIR", dir.join("target"))
        .output()
        .expect("cargo runs");
    let report = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.success(), report)
}

#[test]
fn test_helpers_alone_does_not_compile_the_fault_trigger_in() {
    let dir: PathBuf = Path::new(env!("CARGO_TARGET_TMPDIR")).join("fault-isolation-probe");

    // The negative space first: with `test-helpers` on, its encoders are
    // there, so a failure below is about the trigger and nothing else.
    let (compiled, report) = check_consumer(
        &dir,
        "pub fn encoders() -> Vec<u8> { \
         forma_ir::parser::test_helpers::build_minimal_ir(&[\"p\"], &[], &[], &[]) }\n",
    );
    assert!(compiled, "test-helpers' encoders must compile:\n{report}");

    let (compiled, report) = check_consumer(
        &dir,
        "pub fn trigger() -> &'static str { forma_ir::fault_injection::FAULT_TRIGGER }\n",
    );
    assert!(
        !compiled,
        "test-helpers must not compile in the fault trigger, yet this built:\n{report}"
    );
    assert!(
        report.contains("fault_injection"),
        "it failed for another reason:\n{report}"
    );
}
