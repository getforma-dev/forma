//! Manifest validation happens before module loading or binding, including callers
//! that construct a manifest themselves. This binary also owns its worker setting.
use forma_server::{assets, load_ir_modules_strict, sw, AssetManifest};
use rust_embed::Embed;
use serde_json::{json, Value};

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Files;

fn valid() -> Value {
    json!({"version":2,"writer":"3.0.0","app":"ledger","build":"fixture",
        "aliases":{"home.js":"chunk-X.js"},"assets":{"chunk-X.js":{"immutable":true}},
        "routes":{"/":{"mode":"browser","js":["chunk-X.js"],"css":[],"fonts":[],"total_size_br":0,"budget_warn_threshold":0}}})
}
fn load(value: &Value) -> Result<AssetManifest, String> {
    AssetManifest::from_json(&value.to_string())
}

#[test]
fn schema_writer_and_mode_refusals_happen_before_binding() {
    let mut cases = Vec::new();
    for version in [1, 3] {
        let mut v = valid();
        v["version"] = json!(version);
        v.as_object_mut().unwrap().remove("writer");
        cases.push((v, "MANIFEST-101"));
    }
    let mut v = valid();
    v.as_object_mut().unwrap().remove("app");
    cases.push((v, "schema-1"));
    for writer in ["3.1.0", "2.9.99", "4.0.0"] {
        let mut v = valid();
        v["writer"] = writer.into();
        cases.push((v, "reader 3.0.0"));
    }
    for writer in ["3.0.0-dev", "3.0.0+build", "03.0.0", "3.0", "3.0.65536"] {
        let mut v = valid();
        v["writer"] = writer.into();
        cases.push((v, "MANIFEST-102"));
    }
    let mut v = valid();
    v["routes"]["/"]["mode"] = "ssr".into();
    cases.push((v, "requires an .ir"));
    let mut v = valid();
    v["routes"]["/"]["mode"] = "unknown".into();
    cases.push((v, "unknown variant"));
    let mut v = valid();
    v["assets"]["chunk-X.js"]
        .as_object_mut()
        .unwrap()
        .remove("immutable");
    cases.push((v, "immutable"));
    let mut v = valid();
    v["aliases"]["home.js"] = "foreign.js".into();
    cases.push((v, "unlisted asset"));
    let mut v = valid();
    v["routes"]["/"]["js"] = json!(["foreign.js"]);
    cases.push((v, "not one of the build's files"));
    let mut v = valid();
    v["app"] = "INVALID_APP".into();
    cases.push((v, "MANIFEST-103"));
    for (v, diagnostic) in cases {
        let mut bound = false;
        let result = (|| {
            let manifest = load(&v)?;
            load_ir_modules_strict::<Files>(&manifest).map_err(|e| format!("{e:?}"))?;
            let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
            bound = true;
            Ok::<_, String>(listener)
        })();
        assert!(!bound, "{v}");
        let error = result.unwrap_err();
        assert!(error.contains(diagnostic), "{v}: {error}");
    }
    for writer in ["3.0.0", "3.0.1", "3.0.65535"] {
        let mut v = valid();
        v["writer"] = writer.into();
        assert!(load(&v).is_ok(), "{writer}");
    }
    let mut constructed = load(&valid()).unwrap();
    constructed.writer = "3.1.0".into();
    let errors = load_ir_modules_strict::<Files>(&constructed).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].ir_file, "manifest.json");
    assert!(errors[0].reason.contains("3.1.0"));
}

#[test]
fn checked_worker_configuration_does_not_seal_defaults_and_rejects_cross_app() {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    assert_eq!(manifest.app, "ledger");
    let on = sw::ServiceWorker::for_app("ledger").unwrap().enabled();
    assert!(matches!(
        sw::configure(on.clone()),
        Err(sw::ConfigureError::ManifestRequired)
    ));
    let error = sw::configure_for_manifest(
        sw::ServiceWorker::for_app("other").unwrap().enabled(),
        &manifest,
    )
    .unwrap_err();
    assert!(error.to_string().contains("ledger") && error.to_string().contains("other"));
    let mut invalid = manifest.clone();
    invalid.version = 1;
    assert!(matches!(
        sw::configure_for_manifest(on.clone(), &invalid),
        Err(sw::ConfigureError::InvalidManifest(_))
    ));
    sw::configure_for_manifest(on, &manifest).unwrap();
    assert_eq!(sw::configured().app(), Some("ledger"));
    assert!(sw::configured().is_enabled());
    assert!(matches!(
        sw::configure_for_manifest(sw::ServiceWorker::off(), &manifest),
        Err(sw::ConfigureError::AlreadyConfigured(_))
    ));
}
