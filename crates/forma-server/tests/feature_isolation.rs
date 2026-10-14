//! A forma-server consumer never gets forma-ir's internal `__fault-injection`
//! feature, even with `test-helpers` on (the review of FORMA-120).
//!
//! forma-server enables `__fault-injection` for its own tests through a
//! dev-dependency, which never reaches a consumer. This resolves a scratch
//! consumer's features exactly as a build would (`cargo tree -e features`;
//! nothing is compiled): an edition-2018 crate, so resolver 1, depending on
//! this forma-server and on forma-ir with `test-helpers` as normal
//! dependencies. Offline: it uses only crates this workspace already fetched.

use std::path::Path;
use std::process::Command;

#[test]
fn a_consumer_with_test_helpers_never_resolves_the_fault_injection_feature() {
    let server = Path::new(env!("CARGO_MANIFEST_DIR"));
    let ir = server.join("../forma-ir");
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("server-fault-isolation-probe");
    std::fs::create_dir_all(dir.join("src")).expect("scratch dir");
    std::fs::write(
        dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"server-fault-isolation-probe\"\nversion = \"0.0.0\"\n\
             edition = \"2018\"\npublish = false\n\n[dependencies]\n\
             forma-server = {{ path = '{}' }}\n\
             forma-ir = {{ path = '{}', features = [\"test-helpers\"] }}\n\n[workspace]\n",
            server.display(),
            ir.display()
        ),
    )
    .expect("scratch manifest");
    std::fs::write(dir.join("src/lib.rs"), "").expect("scratch lib");

    let output = Command::new(env!("CARGO"))
        .args(["tree", "--offline", "-e", "features", "-i", "forma-ir"])
        .current_dir(&dir)
        .env("CARGO_TARGET_DIR", dir.join("target"))
        .output()
        .expect("cargo runs");
    let tree = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{tree}{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // Two-sided: the tree does show forma-ir's features, test-helpers among
    // them, and not the internal one.
    assert!(tree.contains("forma-ir feature \"test-helpers\""), "{tree}");
    assert!(tree.contains("forma-server"), "{tree}");
    assert!(!tree.contains("__fault-injection"), "{tree}");
}
