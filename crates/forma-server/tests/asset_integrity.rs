//! External assets use their finalized manifest digests on both public document paths.
use base64::Engine;
use forma_ir::PageProps;
use forma_server::{
    assets, load_ir_modules, render_browser_shell, AssetManifest, PageConfig, RenderCtx,
};
use rust_embed::{Embed, EmbeddedFile, Metadata};
use serde_json::{json, Value};
use std::borrow::Cow;

const SCRIPT: &[u8] = b"globalThis.fixtureLoaded = true;\n";
const STYLE: &[u8] = b"body { color: navy; }\n";
const CHUNK: &[u8] = b"export const fixture = 1;\n";
const MODULE: &[u8] = include_bytes!("fixtures/props-contract/empty.ir");
fn digest(bytes: &[u8]) -> String {
    format!(
        "sha384-{}",
        base64::engine::general_purpose::STANDARD
            .encode(ring::digest::digest(&ring::digest::SHA384, bytes))
    )
}
fn manifest_json() -> Value {
    let route = json!({"mode":"browser","js":["app.js"],"css":["style.css"],"fonts":[],"modulepreload":["app.js","chunk.js","chunk.js"],"total_size_br":0,"budget_warn_threshold":0});
    let mut ssr = route.clone();
    ssr["mode"] = json!("ssr");
    ssr["ir"] = json!("home.ir");
    json!({"version":2,"writer":"3.0.0","app":"integrity-fixture","build":"current",
      "aliases":{"home.ir":"home.ir"},"assets":{
      "app.js":{"immutable":true,"integrity":digest(SCRIPT)},
      "style.css":{"immutable":true,"integrity":digest(STYLE)},
      "chunk.js":{"immutable":true,"integrity":digest(CHUNK)},
      "home.ir":{"immutable":false,"integrity":digest(MODULE)}},
      "routes":{"/":ssr,"/browser":route}})
}
struct Files;
impl Embed for Files {
    fn get(path: &str) -> Option<EmbeddedFile> {
        let bytes = match path {
            "manifest.json" => manifest_json().to_string().into_bytes(),
            "home.ir" => MODULE.to_vec(),
            "app.js" => SCRIPT.to_vec(),
            "style.css" => STYLE.to_vec(),
            "chunk.js" => CHUNK.to_vec(),
            _ => return None,
        };
        Some(EmbeddedFile {
            data: Cow::Owned(bytes),
            metadata: Metadata::__rust_embed_new([0; 32], None, None),
        })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        [
            "manifest.json",
            "home.ir",
            "app.js",
            "style.css",
            "chunk.js",
        ]
        .into_iter()
        .map(Cow::Borrowed)
    }
}
fn browser_config(manifest: &AssetManifest) -> PageConfig<'_> {
    PageConfig {
        title: "integrity",
        route_pattern: "/browser",
        manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
    }
}
#[derive(PageProps)]
struct Empty {}

#[test]
fn both_public_document_paths_write_exact_integrity_and_keep_nonces() {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let preloads = assets::try_load_module_preloads::<Files>().unwrap();
    let ctx = RenderCtx::new()
        .with_module_preloads(&preloads)
        .with_config_json(json!({"value":"</script>"}))
        .with_personality_css("body{color:navy}");
    let pages = load_ir_modules::<Files>(&manifest).unwrap();
    let home = pages.bind::<Empty>("/").unwrap();
    pages.finalize().unwrap();
    for response in [
        home.render(&Empty {}, &ctx).unwrap(),
        render_browser_shell(&browser_config(&manifest), &ctx).unwrap(),
    ] {
        let parts = response.into_parts_unchecked();
        let html = &parts.html;
        for (file, bytes, count) in [
            ("app.js", SCRIPT, 2),
            ("style.css", STYLE, 1),
            ("chunk.js", CHUNK, 1),
        ] {
            let ending = format!(
                "/_assets/{file}\" integrity=\"{}\" crossorigin=\"anonymous\"",
                digest(bytes)
            );
            assert_eq!(html.matches(&ending).count(), count, "{html}");
        }
        assert_eq!(html.matches("integrity=\"").count(), 4, "{html}");
        for tag in html.split('<').filter(|tag| {
            tag.starts_with("script ") || tag.starts_with("link rel=\"modulepreload\"")
        }) {
            if tag.starts_with("script type=\"application/json\" data-island-state>") {
                assert_eq!(tag, "script type=\"application/json\" data-island-state>{\"v\":1,\"s\":[],\"i\":[]}");
            } else {
                assert!(tag.split('>').next().unwrap().contains("nonce=\""), "{tag}");
            }
        }
        let policy = parts
            .headers
            .iter()
            .find(|(name, _)| name == "content-security-policy")
            .unwrap()
            .1
            .to_str()
            .unwrap();
        assert!(policy.contains("require-trusted-types-for 'script'"));
    }
}

#[test]
fn every_asset_requires_full_canonical_integrity_before_startup() {
    for bad in [
        Value::Null,
        json!(""),
        json!("sha384-short"),
        json!(format!("sha256-{}", "A".repeat(64))),
        json!(format!("sha384-{}=", "A".repeat(64))),
        json!(format!("sha384-{}\n", "A".repeat(64))),
    ] {
        let mut value = manifest_json();
        value["assets"]["chunk.js"]["integrity"] = bad;
        let error = AssetManifest::from_json(&value.to_string()).unwrap_err();
        assert!(
            error.contains("MANIFEST-103") && error.contains("chunk.js"),
            "{error}"
        );
    }
    let mut value = manifest_json();
    value["assets"]["home.ir"]
        .as_object_mut()
        .unwrap()
        .remove("integrity");
    assert!(AssetManifest::from_json(&value.to_string())
        .unwrap_err()
        .contains("home.ir"));
    // Even an unreferenced retained file belongs to the manifest's checked contract.
    value = manifest_json();
    value["assets"]["old.js"] = json!({"immutable":true,"retained":true});
    assert!(AssetManifest::from_json(&value.to_string())
        .unwrap_err()
        .contains("old.js"));
}

#[test]
fn constructed_browser_manifests_and_stale_preload_tables_refuse_unchecked_tags() {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let mut invalid = manifest.clone();
    invalid.assets.get_mut("app.js").unwrap().integrity = "sha384-short".into();
    let error = render_browser_shell(&browser_config(&invalid), &RenderCtx::new()).unwrap_err();
    assert_eq!((error.code(), error.route()), ("RENDER-104", "/browser"));
    assert!(error.to_string().contains("app.js"));
    let preloads = assets::try_load_module_preloads::<Files>().unwrap();
    let mut changed = manifest_json();
    changed["assets"]
        .as_object_mut()
        .unwrap()
        .remove("chunk.js");
    for route in changed["routes"].as_object_mut().unwrap().values_mut() {
        route["modulepreload"] = json!([]);
    }
    let changed = AssetManifest::from_json(&changed.to_string()).unwrap();
    let error = render_browser_shell(
        &browser_config(&changed),
        &RenderCtx::new().with_module_preloads(&preloads),
    )
    .unwrap_err();
    assert_eq!(error.code(), "RENDER-104");
    assert!(error.to_string().contains("chunk.js"));
}
