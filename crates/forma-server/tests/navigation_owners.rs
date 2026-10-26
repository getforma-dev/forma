//! Typed production native owner composition and sealed-policy admission.
#![cfg(feature = "navigation")]
use axum::{
    body::to_bytes,
    http::{header, StatusCode},
    response::IntoResponse,
};
use base64::Engine;
use forma_ir::{
    parser::test_helpers::{
        build_declared_fixture, encode_close_tag, encode_open_tag, encode_text,
    },
    PageProps,
};
use forma_server::{
    assets, load_ir_modules, ActionResponse, NavigationBranch, NavigationConfig, NavigationOwner,
    PageHandle, PolicyExtensions, RenderCtx, SealedNavigationPolicy, WalkLimits,
};
use rust_embed::{Embed, EmbeddedFile, Metadata};
use serde_json::{json, Value};
use std::{borrow::Cow, collections::HashMap};

fn module(kind: &str) -> Vec<u8> {
    let outlet = [encode_open_tag(0, &[(3, 4)]), encode_close_tag(0)].concat();
    let mut ops = vec![11, 0, 0];
    ops.extend(encode_open_tag(0, &[]));
    if kind == "inside" {
        ops.extend(&outlet);
    }
    ops.extend(encode_close_tag(0));
    ops.extend([12, 0, 0]);
    if matches!(kind, "shell" | "duplicate") {
        ops.extend(&outlet);
    }
    if kind == "duplicate" {
        ops.extend(&outlet);
    }
    // Text resembling an attribute must never be changed by occurrence reindex.
    ops.extend(encode_open_tag(0, &[(6, 5)]));
    ops.extend(encode_text(5));
    ops.extend(encode_close_tag(0));
    build_declared_fixture(
        &[
            "div",
            "Panel",
            "value",
            "data-forma-outlet",
            "main",
            "data-forma-state=\"0\"",
            "title",
        ],
        &[(0, 2, 1, 0, &[])],
        &ops,
        &[(0, 1, 0, 1, 0, &[0])],
    )
}
fn digest(bytes: &[u8]) -> String {
    format!(
        "sha384-{}",
        base64::engine::general_purpose::STANDARD
            .encode(ring::digest::digest(&ring::digest::SHA384, bytes))
    )
}
const ROUTES: [&str; 7] = [
    "shell",
    "leaf",
    "other",
    "inside",
    "duplicate",
    "missing",
    "foreign",
];
struct Files;
fn manifest_value() -> Value {
    let mut routes = serde_json::Map::new();
    let mut assets = serde_json::Map::new();
    let mut aliases = serde_json::Map::new();
    for route in ROUTES {
        let file = format!("{route}.ir");
        aliases.insert(file.clone(), json!(file));
        assets.insert(
            file.clone(),
            json!({"immutable":false,"integrity":digest(&module(route))}),
        );
        routes.insert(format!("/{route}"), json!({"mode":"ssr","ir":file,"js":[if route == "foreign" {"foreign.js"} else {"group.js"}],"css":[],"fonts":[],"modulepreload":[],"total_size_br":0,"budget_warn_threshold":0,
            "navigation":{"group":"native","owner":route,"outlet":if matches!(route,"shell"|"inside"|"duplicate"|"missing") {Some("main")} else {None}}}));
    }
    assets.insert(
        "group.js".into(),
        json!({"immutable":false,"integrity":digest(b"export {}; ")}),
    );
    assets.insert(
        "foreign.js".into(),
        json!({"immutable":false,"integrity":digest(b"export {}; ")}),
    );
    json!({"version":2,"writer":"3.1.0","app":"native-tests","build":"0123456789abcdef","aliases":aliases,"assets":assets,"routes":routes})
}
impl Embed for Files {
    fn get(path: &str) -> Option<EmbeddedFile> {
        let data = match path {
            "manifest.json" => manifest_value().to_string().into_bytes(),
            "group.js" | "foreign.js" => b"export {}; ".to_vec(),
            file => {
                let name = file.strip_suffix(".ir")?;
                if !ROUTES.contains(&name) {
                    return None;
                }
                module(name)
            }
        };
        Some(EmbeddedFile {
            data: Cow::Owned(data),
            metadata: Metadata::__rust_embed_new([0; 32], None, None),
        })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        [
            "manifest.json",
            "shell.ir",
            "leaf.ir",
            "other.ir",
            "inside.ir",
            "duplicate.ir",
            "missing.ir",
            "foreign.ir",
            "group.js",
            "foreign.js",
        ]
        .into_iter()
        .map(Cow::Borrowed)
    }
}
#[derive(PageProps)]
struct Props {
    value: String,
    secret: String,
}
fn props(value: &str) -> Props {
    Props {
        value: value.into(),
        secret: "unexposed secret".into(),
    }
}
fn handles() -> HashMap<&'static str, PageHandle<Props>> {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let pages = load_ir_modules::<Files>(&manifest).unwrap();
    let handles = ROUTES
        .into_iter()
        .map(|route| (route, pages.bind(&format!("/{route}")).unwrap()))
        .collect();
    pages.finalize().unwrap();
    handles
}
fn ctx() -> RenderCtx {
    RenderCtx::new().with_navigation(
        NavigationConfig::new("native", "shell-v1", "public-v1")
            .unwrap()
            .with_sealed_policy(SealedNavigationPolicy::page_response_only(["/save"]).unwrap()),
    )
}
fn owner(handles: &HashMap<&str, PageHandle<Props>>, name: &str) -> NavigationOwner {
    handles[name]
        .render_owner(
            &props("</script><script>bad</script>"),
            &ctx().with_title(name),
            "stable",
        )
        .unwrap()
}
fn branch(handles: &HashMap<&str, PageHandle<Props>>) -> NavigationBranch {
    NavigationBranch::new(
        "/leaf",
        vec![owner(handles, "shell"), owner(handles, "leaf")],
    )
    .unwrap()
}
async fn body(response: impl IntoResponse) -> (StatusCode, axum::http::HeaderMap, String) {
    let (parts, body) = response.into_response().into_parts();
    (
        parts.status,
        parts.headers,
        String::from_utf8(to_bytes(body, 2 * 1024 * 1024).await.unwrap().to_vec()).unwrap(),
    )
}
fn script(html: &str, attr: &str) -> Value {
    let marker = format!("<script type=\"application/json\" {attr}>");
    serde_json::from_str(
        html.split(&marker)
            .nth(1)
            .unwrap()
            .split("</script>")
            .next()
            .unwrap(),
    )
    .unwrap()
}
#[tokio::test]
async fn full_document_reindexes_only_real_occurrences_and_native_owners_remain_local() {
    let handles = handles();
    let (_, headers, html) = body(branch(&handles).into_document_response().unwrap()).await;
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(headers[header::VARY], "Accept");
    assert!(html.contains(
        "id=\"app\" data-forma-build=\"0123456789abcdef\" data-forma-router-root data-forma-ssr"
    ));
    assert_eq!(html.matches("data-forma-state=\"0\"").count(), 3);
    assert_eq!(html.matches("data-forma-state=\"1\"").count(), 1);
    assert_eq!(html.matches("data-forma-state=&quot;0&quot;").count(), 2);
    assert!(html.contains("<div data-forma-outlet=\"main\"><div data-forma-owner=\"leaf\""));
    assert_eq!(html.matches("data-island-state>").count(), 1);
    let state = script(&html, "data-island-state");
    assert_eq!(state["i"].as_array().unwrap().len(), 2);
    assert_eq!(state["i"][0]["p"]["value"], "</script><script>bad</script>");
    assert!(!html.contains("unexposed secret"));
    let initial = script(&html, "data-forma-navigation");
    assert_eq!(initial["policyProfile"], "page-response-only-v1");
    assert_eq!(initial["actions"], json!(["/save"]));
    assert!(initial["owners"][0].get("state").is_none());
    assert!(initial["owners"][0].get("html").is_none());
    let (status, _, json) = body(branch(&handles).into_navigation_response().unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    let native: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(native["policy"], initial["policy"]);
    assert_eq!(native["assets"], initial["assets"]);
    assert_eq!(native["title"], "leaf");
    assert_eq!(native["owners"][0]["parent"], Value::Null);
    assert_eq!(native["owners"][1]["parent"], "shell");
    for owner in native["owners"].as_array().unwrap() {
        assert!(owner["html"]
            .as_str()
            .unwrap()
            .contains("data-forma-state=\"0\""));
        assert_eq!(owner["state"]["i"].as_array().unwrap().len(), 1);
        for field in ["contract", "propsDigest", "reuseKey"] {
            assert_eq!(owner[field].as_str().unwrap().len(), 64);
        }
    }
}
#[tokio::test]
async fn props_and_security_context_determine_reuse_identity_but_extra_rust_fields_do_not() {
    let handles = handles();
    async fn identity(owner: NavigationOwner) -> Value {
        let (_, _, body) = body(
            NavigationBranch::new("/leaf", vec![owner])
                .unwrap()
                .into_navigation_response()
                .unwrap(),
        )
        .await;
        serde_json::from_str::<Value>(&body).unwrap()["owners"][0].clone()
    }
    let first = identity(
        handles["leaf"]
            .render_owner(&props("one"), &ctx(), "stable")
            .unwrap(),
    )
    .await;
    let mut extra = props("one");
    extra.secret = "different".into();
    let second = identity(
        handles["leaf"]
            .render_owner(&extra, &ctx(), "stable")
            .unwrap(),
    )
    .await;
    assert_eq!(first, second);
    let changed = identity(
        handles["leaf"]
            .render_owner(&props("two"), &ctx(), "stable")
            .unwrap(),
    )
    .await;
    assert_ne!(first["propsDigest"], changed["propsDigest"]);
    assert_ne!(first["reuseKey"], changed["reuseKey"]);
    assert_eq!(first["contract"], changed["contract"]);
    let context = RenderCtx::new().with_navigation(
        NavigationConfig::new("native", "shell-v1", "private-v2")
            .unwrap()
            .with_sealed_policy(SealedNavigationPolicy::page_response_only(["/save"]).unwrap()),
    );
    let changed = identity(
        handles["leaf"]
            .render_owner(&props("one"), &context, "stable")
            .unwrap(),
    )
    .await;
    assert_ne!(first["reuseKey"], changed["reuseKey"]);
}
#[test]
fn malformed_outlet_claims_and_unsealed_policy_fail_before_owner_issuance() {
    let handles = handles();
    for route in ["inside", "duplicate", "missing"] {
        assert_eq!(
            handles[route]
                .render_owner(&props("x"), &ctx(), "stable")
                .unwrap_err()
                .code(),
            "RENDER-601"
        );
    }
    let unsealed = RenderCtx::new()
        .with_navigation(NavigationConfig::new("native", "shell-v1", "public-v1").unwrap());
    assert!(handles["leaf"]
        .render_owner(&props("x"), &unsealed, "stable")
        .is_err());
    let expanded = ctx().with_policy(PolicyExtensions::new().form_action("https://other.example"));
    assert!(handles["leaf"]
        .render_owner(&props("x"), &expanded, "stable")
        .is_err());
    assert!(handles["leaf"].render(&props("x"), &ctx()).is_err());
    assert!(handles["leaf"]
        .render_owner(&props("x"), &ctx(), "")
        .is_err());
}
#[test]
fn branch_rejects_duplicate_incomplete_or_incompatible_owners() {
    let handles = handles();
    assert!(NavigationBranch::new("/leaf", vec![]).is_err());
    assert!(NavigationBranch::new("/leaf", vec![owner(&handles, "shell")]).is_err());
    assert!(NavigationBranch::new(
        "/leaf",
        vec![owner(&handles, "leaf"), owner(&handles, "other")]
    )
    .is_err());
    assert!(NavigationBranch::new(
        "/leaf",
        vec![
            owner(&handles, "shell"),
            owner(&handles, "shell"),
            owner(&handles, "leaf")
        ]
    )
    .is_err());
    assert!(NavigationBranch::new(
        "/foreign",
        vec![owner(&handles, "shell"), owner(&handles, "foreign")]
    )
    .is_err());
    let changed = ctx().with_policy(PolicyExtensions::new().img_src("https:"));
    assert!(NavigationBranch::new(
        "/leaf",
        vec![
            owner(&handles, "shell"),
            handles["leaf"]
                .render_owner(&props("x"), &changed, "stable")
                .unwrap()
        ]
    )
    .is_err());
    assert!(NavigationBranch::new("//example.test", vec![owner(&handles, "leaf")]).is_err());
    assert!(NavigationBranch::new("/../leaf", vec![owner(&handles, "leaf")]).is_err());
}
#[tokio::test]
async fn typed_errors_preserve_http_status_and_redirects_preserve_admission() {
    let handles = handles();
    for code in [404, 410, 500, 503] {
        let status = StatusCode::from_u16(code).unwrap();
        let (http, _, html) = body(
            branch(&handles)
                .with_status(status)
                .unwrap()
                .into_document_response()
                .unwrap(),
        )
        .await;
        assert_eq!(http, status);
        assert_eq!(script(&html, "data-forma-navigation")["status"], code);
        let (http, _, json) = body(
            branch(&handles)
                .with_status(status)
                .unwrap()
                .into_navigation_response()
                .unwrap(),
        )
        .await;
        assert_eq!(http, status);
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["kind"], "error");
        assert_eq!(value["status"], code);
    }
    for code in [201, 301, 400, 401, 403, 422, 502] {
        assert!(branch(&handles)
            .with_status(StatusCode::from_u16(code).unwrap())
            .is_err());
    }
    let (http, _, json) = body(
        branch(&handles)
            .into_redirect("/other?q=1#section")
            .unwrap(),
    )
    .await;
    assert_eq!(http, StatusCode::OK);
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["kind"], "redirect");
    assert_eq!(value["policyProfile"], "page-response-only-v1");
    assert_eq!(value["actions"], json!(["/save"]));
    for location in [
        "https://outside.test",
        "//outside.test",
        "/\\outside.test",
        "/other\n",
    ] {
        assert!(branch(&handles).into_redirect(location).is_err());
    }
}
#[tokio::test]
async fn action_endpoints_are_declared_canonical_and_bound_to_sealed_policy() {
    let handles = handles();
    assert!(handles["leaf"].action_context(&ctx(), "/other").is_err());
    for endpoint in ["/save?x=1", "/save/..", "/s%61ve", "//save", "/save/"] {
        assert!(SealedNavigationPolicy::page_response_only([endpoint]).is_err());
    }
    let action = handles["leaf"].action_context(&ctx(), "/save").unwrap();
    let (status, _, json) =
        body(ActionResponse::validation(&action, json!({"field":"required"})).unwrap()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["policyProfile"], "page-response-only-v1");
    assert_eq!(value["endpoint"], "/save");
    assert_eq!(value["actions"], json!(["/save"]));
}
#[test]
fn combined_response_budget_is_charged_after_successful_owner_walks() {
    let handles = handles();
    let context = ctx().with_limits(WalkLimits {
        max_output_bytes: 600,
        ..WalkLimits::default()
    });
    let leaf = handles["leaf"]
        .render_owner(&props("x"), &context, "stable")
        .unwrap();
    let branch = NavigationBranch::new("/leaf", vec![leaf]).unwrap();
    assert_eq!(
        branch.into_navigation_response().unwrap_err().code(),
        "RENDER-301"
    );
    let leaf = handles["leaf"]
        .render_owner(&props("x"), &context, "stable")
        .unwrap();
    assert_eq!(
        NavigationBranch::new("/leaf", vec![leaf])
            .unwrap()
            .into_document_response()
            .unwrap_err()
            .code(),
        "RENDER-301"
    );
}
#[test]
fn manifest_rejects_unverified_owner_identifiers_and_multiple_bootstraps() {
    for bad in ["", "1owner", "owner.name", "x/y"] {
        let mut manifest = manifest_value();
        manifest["routes"]["/leaf"]["navigation"]["owner"] = json!(bad);
        assert!(serde_json::from_value::<forma_server::AssetManifest>(manifest).is_err());
    }
    let mut manifest = manifest_value();
    manifest["routes"]["/leaf"]["js"] = json!(["group.js", "foreign.js"]);
    assert!(serde_json::from_value::<forma_server::AssetManifest>(manifest).is_err());
}

#[cfg(feature = "compression")]
#[tokio::test]
async fn compressed_native_documents_preserve_the_typed_error_status() {
    let handles = handles();
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(header::ACCEPT_ENCODING, "gzip".parse().unwrap());
    let response = branch(&handles)
        .with_status(StatusCode::NOT_FOUND)
        .unwrap()
        .into_document_response()
        .unwrap()
        .with_compression(&headers)
        .into_response();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let compressed = to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    let mut decoder = flate2::read::GzDecoder::new(compressed.as_ref());
    let mut html = String::new();
    std::io::Read::read_to_string(&mut decoder, &mut html).unwrap();
    assert_eq!(script(&html, "data-forma-navigation")["status"], 404);
}
