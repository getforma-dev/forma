//! Staged FORMA-105 native policy. Synthetic modules exercise the public typed
//! boundary; actual zero-JS compiler/browser qualification remains integrated work.
use base64::Engine;
use forma_ir::parser::test_helpers::{
    build_declared_fixture, build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, sw, AssetManifest, RenderCtx, WalkLimits};
use rust_embed::{Embed, EmbeddedFile, Metadata};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Once;

thread_local! {
    static FILES: RefCell<HashMap<String, Vec<u8>>> = RefCell::new(HashMap::new());
}
struct Files;
impl Embed for Files {
    fn get(path: &str) -> Option<EmbeddedFile> {
        FILES
            .with(|files| files.borrow().get(path).cloned())
            .map(|bytes| EmbeddedFile {
                data: Cow::Owned(bytes),
                metadata: Metadata::__rust_embed_new([0; 32], None, None),
            })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        FILES
            .with(|files| {
                files
                    .borrow()
                    .keys()
                    .cloned()
                    .map(Cow::Owned)
                    .collect::<Vec<_>>()
            })
            .into_iter()
    }
}
fn write(name: &str, bytes: impl Into<Vec<u8>>) {
    FILES.with(|files| files.borrow_mut().insert(name.into(), bytes.into()));
}
fn module(island: bool) -> Vec<u8> {
    let body = [encode_open_tag(0, &[]), encode_text(1), encode_close_tag(0)].concat();
    if island {
        build_declared_fixture(
            &["p", "native", "Panel"],
            &[],
            &[vec![11, 0, 0], body, vec![12, 0, 0]].concat(),
            &[(0, 1, 0, 2, 0, &[])],
        )
    } else {
        build_minimal_ir(&["p", "native"], &[], &body, &[])
    }
}
fn metadata(bytes: &[u8]) -> Value {
    let digest = base64::engine::general_purpose::STANDARD
        .encode(ring::digest::digest(&ring::digest::SHA384, bytes));
    json!({"immutable":false,"integrity":format!("sha384-{digest}")})
}
fn manifest(js: bool, preload: bool, island: bool) -> Value {
    json!({"version":2,"writer":"3.0.0","app":"static-policy","build":"fixture",
        "aliases":{"home.ir":"home.ir"},"assets":{
            "home.ir":metadata(&module(island)),"app.js":metadata(b"export {};"),
            "chunk.js":metadata(b"export const x=1;"),"site.css":metadata(b"p{color:green}"),"font.woff2":metadata(b"fixture-font")},
        "routes":{"/":{"mode":"ssr","ir":"home.ir","js":if js{vec!["app.js"]}else{vec![]},
            "css":["site.css"],"fonts":["font.woff2"],"modulepreload":if preload{vec!["chunk.js"]}else{vec![]},"total_size_br":0,"budget_warn_threshold":0}}})
}
fn install(js: bool, preload: bool, island: bool) -> AssetManifest {
    FILES.with(|files| files.borrow_mut().clear());
    write("manifest.json", manifest(js, preload, island).to_string());
    write("home.ir", module(island));
    write("sw.js", "/* actual embedded worker delivery control */");
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    static SETUP: Once = Once::new();
    SETUP.call_once(|| {
        sw::configure_for_manifest(
            sw::ServiceWorker::for_app("static-policy")
                .unwrap()
                .enabled(),
            &manifest,
        )
        .unwrap()
    });
    manifest
}
#[derive(PageProps)]
struct Empty {}
fn page(manifest: &AssetManifest) -> forma_server::PageHandle<Empty> {
    let pages = load_ir_modules::<Files>(manifest).unwrap();
    let page = pages.bind::<Empty>("home").unwrap();
    pages.finalize().unwrap();
    page
}
fn render(page: &forma_server::PageHandle<Empty>, ctx: &RenderCtx) -> forma_server::PageParts {
    page.render(&Empty {}, ctx).unwrap().into_parts_unchecked()
}
const STATE: &str =
    "<script type=\"application/json\" data-island-state>{\"v\":1,\"s\":[],\"i\":[]}</script>";

#[test]
fn empty_js_is_explicit_and_static_module_preloads_are_refused() {
    let mut input = manifest(false, false, false);
    assert!(AssetManifest::from_json(&input.to_string()).is_ok());
    input["routes"]["/"].as_object_mut().unwrap().remove("js");
    assert!(AssetManifest::from_json(&input.to_string())
        .unwrap_err()
        .contains("js"));
    let error = AssetManifest::from_json(&manifest(false, true, false).to_string()).unwrap_err();
    assert!(error.contains("MANIFEST-103"), "{error}");
    assert!(error.contains("module preloads"), "{error}");
}

#[test]
fn startup_refuses_islands_without_js_and_accepts_both_valid_products() {
    let manifest = install(false, false, true);
    let errors = load_ir_modules::<Files>(&manifest).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code(), Some("LOAD-109"));
    assert_eq!(errors[0].route, "/");
    assert_eq!(errors[0].ir_file, "home.ir");
    assert!(errors[0].reason.contains("JavaScript entry"));
    let manifest = install(true, false, true);
    assert!(render(&page(&manifest), &RenderCtx::new())
        .html
        .contains("data-forma-component=\"Panel\""));
    let manifest = install(false, false, false);
    assert!(render(&page(&manifest), &RenderCtx::new())
        .html
        .contains(STATE));
}

#[test]
fn static_ssr_keeps_inert_state_css_fonts_headers_and_exact_response_budget() {
    let manifest = install(false, false, false);
    let page = page(&manifest);
    let ctx = RenderCtx::new()
        .with_title("Native é")
        .with_personality_css("p{display:block}");
    let response = render(&page, &ctx);
    assert!(response.html.contains("<p>native</p>"));
    assert_eq!(response.html.matches("<script").count(), 1);
    assert!(response.html.contains(STATE));
    assert!(!response.html.contains("modulepreload"));
    assert!(!response.html.contains("serviceWorker"));
    assert!(!response.html.contains("__FORMA_CONFIG__"));
    assert!(response
        .html
        .contains("href=\"/_assets/site.css\" integrity=\"sha384-"));
    assert!(response.html.contains("href=\"/_assets/font.woff2\""));
    assert!(response.html.contains("p{display:block}"));
    let csp = response
        .headers
        .iter()
        .find(|(name, _)| name == "content-security-policy")
        .unwrap()
        .1
        .to_str()
        .unwrap();
    assert!(csp.contains("require-trusted-types-for 'script'"));
    assert!(csp.contains("trusted-types forma"));
    assert!(sw::configured().is_enabled());
    let exact = response.html.len();
    assert_eq!(
        render(
            &page,
            &ctx.clone().with_limits(WalkLimits {
                max_output_bytes: exact,
                ..page.limits()
            })
        )
        .html
        .len(),
        exact
    );
    assert_eq!(
        page.render(
            &Empty {},
            &ctx.with_limits(WalkLimits {
                max_output_bytes: exact - 1,
                ..page.limits()
            })
        )
        .unwrap_err()
        .code(),
        "RENDER-301"
    );
}

#[test]
fn explicit_config_refuses_static_ssr_but_remains_supported_with_a_js_entry() {
    let manifest = install(false, false, false);
    let error = page(&manifest)
        .render(
            &Empty {},
            &RenderCtx::new().with_config_json(json!({"value":"</script>"})),
        )
        .unwrap_err();
    assert_eq!(error.code(), "RENDER-105");
    assert_eq!(error.route(), "/");
    assert_eq!(error.counts(), None);
    assert!(error.to_string().contains("config_json"));
    let manifest = install(true, false, false);
    let response = render(
        &page(&manifest),
        &RenderCtx::new().with_config_json(json!({"value":"</script>"})),
    );
    assert!(response
        .html
        .contains("window.__FORMA_CONFIG__={\"value\":\"\\u003c/script>\"}"));
    assert!(response.html.contains("serviceWorker.register('/sw.js')"));
}

#[test]
fn static_ssr_refuses_a_stale_preload_table_even_when_the_asset_is_retained() {
    install(true, true, false);
    let preloads = assets::try_load_module_preloads::<Files>().unwrap();
    assert_eq!(preloads.route("/"), ["chunk.js"]);
    let mut manifest = install(false, false, false);
    let chunk = manifest.assets.get_mut("chunk.js").unwrap();
    // A retained file is immutable (FORMA-186: the manifest refuses one that is not).
    chunk.retained = true;
    chunk.immutable = true;
    // Retention is valid metadata, not permission for a static route to fetch JS.
    manifest.validate().unwrap();
    let error = page(&manifest)
        .render(&Empty {}, &RenderCtx::new().with_module_preloads(&preloads))
        .unwrap_err();
    assert_eq!(error.code(), "RENDER-105");
    assert!(error.to_string().contains("preload"));
    assert_eq!(error.counts(), None);
}

#[cfg(debug_assertions)]
#[test]
fn reload_keeps_the_good_pair_and_retries_same_bytes_after_route_policy_changes() {
    let initial = install(false, false, false);
    let page = page(&initial);
    assert!(render(&page, &RenderCtx::new()).html.contains(STATE));
    write("home.ir", module(true));
    for _ in 0..3 {
        let html = render(&page, &RenderCtx::new()).html;
        assert!(html.contains(STATE));
        assert!(!html.contains("data-forma-island"));
        assert!(!html.contains("/_assets/app.js"));
    }
    // Same rejected bytes now have a valid JS route; the refusal cache must retry.
    write("manifest.json", manifest(true, false, true).to_string());
    let html = render(&page, &RenderCtx::new()).html;
    assert!(html.contains("data-forma-component=\"Panel\""));
    assert!(html.contains("src=\"/_assets/app.js\""));
    // Same accepted IR now points at a static manifest: do not use the unchanged
    // byte fast path to install the invalid manifest alongside the old islands.
    write("manifest.json", manifest(false, false, true).to_string());
    for _ in 0..3 {
        let html = render(&page, &RenderCtx::new()).html;
        assert!(html.contains("data-forma-component=\"Panel\""));
        assert!(html.contains("src=\"/_assets/app.js\""));
    }
    write("home.ir", module(false));
    write("manifest.json", manifest(false, false, false).to_string());
    let html = render(&page, &RenderCtx::new()).html;
    assert!(html.contains(STATE));
    assert!(!html.contains("/_assets/app.js"));
    assert!(!html.contains("serviceWorker"));
}

#[tokio::test]
async fn a_static_page_does_not_remove_the_enabled_worker_delivery_endpoint() {
    let manifest = install(false, false, false);
    assert!(!render(&page(&manifest), &RenderCtx::new())
        .html
        .contains("serviceWorker"));
    let response = sw::serve_sw::<Files>().await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(
        response.headers()["cache-control"],
        "no-cache, no-store, must-revalidate"
    );
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(&body[..], b"/* actual embedded worker delivery control */");
}

#[test]
fn an_explicit_browser_shell_keeps_request_configuration_without_native_state() {
    let mut manifest = install(false, false, false);
    let route = manifest.routes.get_mut("/").unwrap();
    route.mode = forma_server::RouteMode::Browser;
    route.ir = None;
    let config = json!({"client":true});
    let response = forma_server::render_browser_shell(
        &forma_server::PageConfig {
            title: "Browser",
            route_pattern: "/",
            manifest: &manifest,
            config_json: Some(&config),
            body_class: None,
            personality_css: None,
            body_prefix: None,
        },
        &RenderCtx::new(),
    )
    .unwrap()
    .into_parts_unchecked();
    assert!(response
        .html
        .contains("window.__FORMA_CONFIG__={\"client\":true}"));
    assert!(!response.html.contains("data-island-state"));
    assert!(!response.html.contains("serviceWorker"));
}
