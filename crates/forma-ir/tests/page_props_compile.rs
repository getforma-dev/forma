//! Ordinary scratch-consumer compilation verifies diagnostics at their real fields.
//! Offline resolution uses only the dependency versions already fetched for the workspace.
use std::path::Path;
use std::process::Command;

#[test]
fn derive_refuses_unsupported_shapes_at_the_offending_declaration() {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("page-props-compile");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("Cargo.toml"),format!("[package]\nname='page-props-compile'\nversion='0.0.0'\nedition='2021'\npublish=false\n[dependencies]\nforma-ir={{path='{}',default-features=false}}\n[workspace]\n",env!("CARGO_MANIFEST_DIR"))).unwrap();
    let cases=[
        ("struct Bad {\n    value: u128,\n}", "unsupported PageProps field type", 4),
        ("struct Bad {\n    value: (String, bool),\n}", "PageProps field must be", 4),
        ("struct Bad {\n    value: std::collections::HashMap<String, String>,\n}", "unsupported PageProps field type", 4),
        ("struct Bad {\n    value: &'static str,\n}", "PageProps field must be", 4),
        ("struct Bad {\n    first_name: String,\n    #[props(rename=\"firstName\")]\n    second: String,\n}", "duplicate PageProps field name", 6),
        ("struct Bad {\n    #[props(rename=\"\")]\n    value: String,\n}", "PageProps rename must be nonempty", 4),
        ("struct Bad {\n    #[props(skip)]\n    value: String,\n}", "PageProps supports only", 4),
        ("enum Bad {\n    Payload(String),\n}", "PageProps enum variants must be unit", 4),
        ("enum Bad {\n    #[props(rename=\"same\")] One,\n    #[props(rename=\"same\")] Two,\n}", "duplicate PageProps enum literal", 5),
        ("struct Bad(String);", "PageProps structs require named fields", 3),
        ("struct Bad;", "PageProps structs require named fields", 3),
        ("struct Bad<T> {\n    value: T,\n}", "PageProps requires a concrete named type", 3),
        ("struct Bad {\n    value: std::path::PathBuf,\n}", "PropValue", 4),
        ("union Bad { value: u32, other: f32 }", "PageProps does not support unions", 3),
        ("enum Bad {}", "PageProps unit enums require at least one variant", 3),
        ("enum Bad {\n    One = 1,\n}", "PageProps unit enums do not support explicit discriminants", 4),
        ("struct Bad {\n    value: [u32; 3],\n}", "PageProps field must be", 4),
        ("struct Bad {\n    value: fn() -> bool,\n}", "PageProps field must be", 4),
        ("struct Bad {\n    value: char,\n}", "unsupported PageProps field type", 4),
        ("struct Bad {\n    value: std::collections::HashSet<String>,\n}", "unsupported PageProps field type", 4),
        ("struct Bad {\n    #[props(rename=\"one\", rename=\"two\")]\n    value: String,\n}", "duplicate PageProps rename", 4),
        ("struct Bad {\n    #[props(rename=\"bad\\nname\")]\n    value: String,\n}", "PageProps rename must be nonempty", 4),
        ("struct Bad {\n    #[props()]\n    value: String,\n}", "empty attributes are unsupported", 4),
    ];
    // A working derive proves that later failures are semantic, not missing dependencies.
    std::fs::write(dir.join("src/lib.rs"),"use forma_ir::PageProps;\n#[derive(PageProps)]\npub struct Good { pub first_name: String, pub value: Option<Vec<u32>> }\n").unwrap();
    let check = |locked: bool| {
        let mut command = Command::new(env!("CARGO"));
        command.arg("check");
        if locked {
            command.arg("--locked");
        }
        command
            .args(["--offline", "--quiet", "--message-format=json"])
            .current_dir(&dir)
            .env("CARGO_TARGET_DIR", dir.join("target"))
            .output()
            .expect("cargo check runs")
    };
    let good = check(false);
    assert!(
        good.status.success(),
        "positive control failed: {}{}",
        String::from_utf8_lossy(&good.stdout),
        String::from_utf8_lossy(&good.stderr)
    );
    for (body, expected, line) in cases {
        std::fs::write(
            dir.join("src/lib.rs"),
            format!("use forma_ir::PageProps;\n#[derive(PageProps)]\n{body}\n"),
        )
        .unwrap();
        let output = check(true);
        assert!(
            !output.status.success(),
            "unsupported shape compiled: {body}"
        );
        let text = String::from_utf8_lossy(&output.stdout);
        let diagnostics = text
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter(|v| v["reason"] == "compiler-message")
            .map(|v| v["message"].clone())
            .collect::<Vec<_>>();
        let matching = diagnostics
            .iter()
            .filter(|d| {
                d["level"] == "error" && d["message"].as_str().unwrap_or("").contains(expected)
            })
            .collect::<Vec<_>>();
        assert!(
            !matching.is_empty(),
            "missing diagnostic {expected:?} for {body}: {text}"
        );
        assert!(
            matching.iter().any(|d| d["spans"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["is_primary"] == true
                    && s["line_start"] == line
                    && s["file_name"] == "src/lib.rs")),
            "diagnostic must point at line {line}, not the derive invocation: {text}"
        );
    }
}
