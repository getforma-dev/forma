//! Final public Pages -> typed handler -> checked state -> PageResponse path.
//! Synthetic native fixture; paired compiler production fixtures are separate.
use base64::Engine;
use forma_ir::parser::test_helpers::{build_declared_fixture, encode_close_tag, encode_open_tag};
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, RenderCtx, WalkLimits};
use rust_embed::{Embed, EmbeddedFile, Metadata};
use serde_json::json;
use std::borrow::Cow;

fn module() -> Vec<u8> {
    let ops = [
        vec![11, 0, 0],
        encode_open_tag(0, &[]),
        encode_close_tag(0),
        vec![12, 0, 0],
    ]
    .concat();
    build_declared_fixture(
        &["div", "Panel", "value"],
        &[(0, 2, 1, 0, &[])],
        &ops,
        &[(0, 1, 0, 1, 0, &[0])],
    )
}
fn manifest() -> Vec<u8> {
    let digest = format!(
        "sha384-{}",
        base64::engine::general_purpose::STANDARD
            .encode(ring::digest::digest(&ring::digest::SHA384, &module()))
    );
    json!({"version":2,"writer":"3.0.0","app":"state-fixture","build":"fixture",
        "aliases":{"home.ir":"home.ir"},"assets":{"home.ir":{"immutable":false,"integrity":digest},"app.js":{"immutable":false,"integrity":format!("sha384-{}", base64::engine::general_purpose::STANDARD.encode(ring::digest::digest(&ring::digest::SHA384, b"export {};")))}},
        "routes":{"/state":{"mode":"ssr","ir":"home.ir","js":["app.js"],"css":[],"fonts":[],"modulepreload":[],"total_size_br":0,"budget_warn_threshold":0}}}).to_string().into_bytes()
}
struct Files;
impl Embed for Files {
    fn get(path: &str) -> Option<EmbeddedFile> {
        let bytes = match path {
            "manifest.json" => manifest(),
            "home.ir" => module(),
            "app.js" => b"export {};".to_vec(),
            _ => return None,
        };
        Some(EmbeddedFile {
            data: Cow::Owned(bytes),
            metadata: Metadata::__rust_embed_new([0; 32], None, None),
        })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        ["manifest.json", "home.ir", "app.js"]
            .into_iter()
            .map(Cow::Borrowed)
    }
}
#[derive(PageProps)]
struct Handler {
    value: String,
    secret: u64,
}
fn page() -> forma_server::PageHandle<Handler> {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let pages = load_ir_modules::<Files>(&manifest).unwrap();
    let page = pages.bind::<Handler>("home").unwrap();
    pages.finalize().unwrap();
    page
}
#[test]
fn finalized_typed_handle_emits_only_declared_state_in_the_head() {
    let page = page();
    let value = "</script><é😀";
    let response = page
        .render(
            &Handler {
                value: value.into(),
                secret: u64::MAX,
            },
            &RenderCtx::new(),
        )
        .unwrap()
        .into_parts_unchecked();
    let open = "<script type=\"application/json\" data-island-state>";
    assert_eq!(response.html.matches(open).count(), 1);
    let begin = response.html.find(open).unwrap() + open.len();
    let end = begin + response.html[begin..].find("</script>").unwrap();
    assert!(end < response.html.find("</head>").unwrap());
    let state: serde_json::Value = serde_json::from_str(&response.html[begin..end]).unwrap();
    assert_eq!(state["i"][0]["p"], json!({"value":value}));
    assert_eq!(page.warnings()[0].path, "secret");
    assert!(!response.html.contains("data-forma-props"));
    assert!(!response.html.contains("__forma_islands"));
}
#[test]
fn public_state_and_document_refusals_are_distinct_and_request_limits_do_not_persist() {
    let page = page();
    let huge = Handler {
        value: "<".repeat(200_000),
        secret: u64::MAX,
    };
    let error = page.render(&huge, &RenderCtx::new()).unwrap_err();
    assert_eq!(error.code(), "RENDER-502");
    assert_eq!(error.route(), "/state");
    assert_eq!(error.component_path(), ["Panel"]);
    let small = Handler {
        value: "ok".into(),
        secret: u64::MAX,
    };
    let normal = page
        .render(&small, &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    let limit = normal.html.len() - 1;
    let ctx = RenderCtx::new().with_limits(WalkLimits {
        max_output_bytes: limit,
        ..page.limits()
    });
    let error = page.render(&small, &ctx).unwrap_err();
    assert_eq!(error.code(), "RENDER-301");
    assert!(error.counts().unwrap().bytes < limit);
    assert!(page.render(&small, &RenderCtx::new()).is_ok());
    assert_eq!(
        page.limits().max_output_bytes,
        forma_ir::DEFAULT_MAX_OUTPUT_BYTES
    );
}
