//! A reserved capability cannot silently become an ordinary SSR route.
use forma_server::AssetManifest;
use serde_json::{json, Value};

fn ordinary() -> Value {
    json!({"version":2,"writer":"3.1.0","app":"capability-proof","build":"fixture",
        "aliases":{},"assets":{
            "group.js":{"immutable":true,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"},
            "page.ir":{"immutable":true,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"}},
        "routes":{"/":{"mode":"ssr","ir":"page.ir","js":["group.js"],"css":[],"fonts":[],"total_size_br":0,"budget_warn_threshold":0}}})
}

#[test]
fn ordinary_routes_and_unrelated_forward_fields_remain_compatible() {
    let mut manifest = ordinary();
    manifest["future_metadata"] = json!({"value":true});
    manifest["routes"]["/"]["future_metadata"] = json!({"value":true});
    assert!(AssetManifest::from_json(&manifest.to_string()).is_ok());
}

#[cfg(not(feature = "navigation"))]
#[test]
fn disabled_reader_refuses_reserved_navigation_before_binding_instead_of_dropping_it() {
    for capability in [
        json!({"group":"main","owner":"home","outlet":null}),
        Value::Null,
        json!(false),
        json!({"unknown":true}),
    ] {
        let mut manifest = ordinary();
        manifest["routes"]["/"]["navigation"] = capability;
        let mut bound = false;
        let result = (|| {
            AssetManifest::from_json(&manifest.to_string())?;
            let listener =
                std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
            bound = true;
            Ok::<_, String>(listener)
        })();
        assert!(!bound, "reserved capability reached listener binding");
        let error = result.unwrap_err();
        assert!(
            error.contains("MANIFEST-103") && error.contains("navigation feature"),
            "{error}"
        );
    }
}

#[cfg(feature = "navigation")]
#[test]
fn enabled_reader_admits_valid_capability_but_keeps_schema_and_writer_guards() {
    let mut manifest = ordinary();
    manifest["routes"]["/"]["navigation"] = json!({"group":"main","owner":"home","outlet":null});
    let parsed = AssetManifest::from_json(&manifest.to_string()).unwrap();
    assert_eq!(
        parsed.routes["/"].navigation.as_ref().unwrap().owner,
        "home"
    );
    manifest["routes"]["/"]["navigation"]["unknown"] = json!(true);
    assert!(AssetManifest::from_json(&manifest.to_string())
        .unwrap_err()
        .contains("unknown field"));
    manifest["routes"]["/"]["navigation"]
        .as_object_mut()
        .unwrap()
        .remove("unknown");
    let reader = forma_ir::format::reader_version();
    manifest["writer"] = format!("{}.{}.0", reader[0], reader[1] + 1).into();
    assert!(AssetManifest::from_json(&manifest.to_string())
        .unwrap_err()
        .contains("MANIFEST-102"));
}
