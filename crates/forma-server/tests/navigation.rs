//! Experimental typed native-response admission and POST-safe outcome contracts.
#![cfg(feature = "experimental-router")]
use axum::{
    body::to_bytes,
    http::{header, StatusCode},
    response::IntoResponse,
};
use base64::Engine;
use forma_ir::{
    parser::test_helpers::{build_declared_fixture, encode_close_tag, encode_open_tag},
    PageProps,
};
use forma_server::{
    assets, load_ir_modules,
    navigation::{ACTION_MEDIA_TYPE, NAVIGATION_MEDIA_TYPE},
    ActionResponse, NavigationConfig, PolicyExtensions, RenderCtx, WalkLimits,
};
use rust_embed::{Embed, EmbeddedFile, Metadata};
use serde_json::{json, Value};
use std::borrow::Cow;
fn module() -> Vec<u8> {
    build_declared_fixture(
        &["div", "Panel", "value"],
        &[(0, 2, 1, 0, &[])],
        &[
            vec![11, 0, 0],
            encode_open_tag(0, &[]),
            encode_close_tag(0),
            vec![12, 0, 0],
        ]
        .concat(),
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
struct Files;
impl Embed for Files {
    fn get(path: &str) -> Option<EmbeddedFile> {
        let bytes = match path {
            "manifest.json" => json!({"version":2,"writer":"3.1.0","app":"router-proof","build":"0123456789abcdef","aliases":{"a.ir":"a.ir","b.ir":"b.ir"},
                "assets":{"a.ir":{"immutable":false,"integrity":digest(&module())},"b.ir":{"immutable":false,"integrity":digest(&module())},"group.js":{"immutable":false,"integrity":digest(b"export {};")}},
                "routes":{"/a":{"mode":"ssr","ir":"a.ir","js":["group.js"],"css":[],"fonts":[],"modulepreload":[],"total_size_br":0,"budget_warn_threshold":0},"/b":{"mode":"ssr","ir":"b.ir","js":["group.js"],"css":[],"fonts":[],"modulepreload":[],"total_size_br":0,"budget_warn_threshold":0}}}).to_string().into_bytes(),
            "a.ir"|"b.ir" => module(), "group.js" => b"export {};".to_vec(), _ => return None,
        };
        Some(EmbeddedFile {
            data: Cow::Owned(bytes),
            metadata: Metadata::__rust_embed_new([0; 32], None, None),
        })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        ["manifest.json", "a.ir", "b.ir", "group.js"]
            .into_iter()
            .map(Cow::Borrowed)
    }
}
#[derive(PageProps)]
struct Props {
    value: String,
    secret: String,
}
fn handles() -> (
    forma_server::PageHandle<Props>,
    forma_server::PageHandle<Props>,
) {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let pages = load_ir_modules::<Files>(&manifest).unwrap();
    let a = pages.bind("/a").unwrap();
    let b = pages.bind("/b").unwrap();
    pages.finalize().unwrap();
    (a, b)
}
fn ctx() -> RenderCtx {
    RenderCtx::new()
        .with_navigation(NavigationConfig::new("proof", "shell-v1", "public-v1").unwrap())
}
fn props() -> Props {
    Props {
        value: "fresh </script> state".into(),
        secret: "never serialize".into(),
    }
}
async fn body(
    response: impl IntoResponse,
) -> (axum::http::StatusCode, axum::http::HeaderMap, String) {
    let (parts, body) = response.into_response().into_parts();
    (
        parts.status,
        parts.headers,
        String::from_utf8(to_bytes(body, 2 * 1024 * 1024).await.unwrap().to_vec()).unwrap(),
    )
}
fn initial(html: &str) -> Value {
    let open = "<script type=\"application/json\" data-forma-navigation>";
    let value = html
        .split(open)
        .nth(1)
        .unwrap()
        .split("</script>")
        .next()
        .unwrap();
    serde_json::from_str(value).unwrap()
}
#[tokio::test]
async fn native_response_shares_checked_state_and_stable_policy_with_fresh_nonce_documents() {
    let (a, b) = handles();
    let (_, ha, da) = body(a.render(&props(), &ctx()).unwrap()).await;
    let (_, hb, db) = body(b.render(&props(), &ctx()).unwrap()).await;
    assert_ne!(
        ha[header::CONTENT_SECURITY_POLICY],
        hb[header::CONTENT_SECURITY_POLICY]
    );
    assert_eq!(initial(&da)["policy"], initial(&db)["policy"]);
    assert_eq!(ha[header::VARY], "Accept");
    assert!(da.starts_with("<!DOCTYPE html>"));
    let (_, headers, text) = body(b.render_navigation(&props(), &ctx()).unwrap()).await;
    assert_eq!(headers[header::CONTENT_TYPE], NAVIGATION_MEDIA_TYPE);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    let payload: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(payload["policy"], initial(&da)["policy"]);
    assert_eq!(payload["assets"], initial(&da)["assets"]);
    assert_eq!(payload["route"], "/b");
    assert_eq!(payload["kind"], "page");
    assert_eq!(payload["state"]["i"][0]["p"]["value"], props().value);
    assert!(payload["html"].as_str().unwrap().contains("data-forma-ssr"));
    assert!(!payload["html"].as_str().unwrap().contains("<script"));
    assert!(!text.contains("never serialize"));
    assert_eq!(payload["assets"][0]["integrity"], digest(b"export {};"));
}
#[tokio::test]
async fn every_typed_document_policy_change_changes_admission_identity() {
    let (a, _) = handles();
    let (_, _, plain) = body(a.render(&props(), &ctx()).unwrap()).await;
    let expected = initial(&plain)["policy"].clone();
    for extension in [
        PolicyExtensions::new().img_src("https:"),
        PolicyExtensions::new().frame_src("'self'"),
        PolicyExtensions::new().form_action("https://example.test"),
        PolicyExtensions::new().allow_popups(),
        PolicyExtensions::new().report_uri("/reports"),
        PolicyExtensions::new().report_to("/reports"),
        PolicyExtensions::new().relax_trusted_types("proof; owner: router; expires: 2026-11-01"),
    ] {
        let (_, _, document) =
            body(a.render(&props(), &ctx().with_policy(extension)).unwrap()).await;
        assert_ne!(expected, initial(&document)["policy"]);
    }
}
#[test]
fn navigation_requires_opt_in_and_preserves_binding_and_representation_budget_refusals() {
    let (a, _) = handles();
    assert_eq!(
        a.render_navigation(&props(), &RenderCtx::new())
            .unwrap_err()
            .code(),
        "RENDER-601"
    );
    assert_eq!(
        a.render_navigation(&props(), &ctx().with_config_json(json!({"ignored":false})))
            .unwrap_err()
            .code(),
        "RENDER-601"
    );
    let limited = ctx().with_limits(WalkLimits {
        max_output_bytes: 300,
        ..a.limits()
    });
    assert_eq!(
        a.render_navigation(&props(), &limited).unwrap_err().code(),
        "RENDER-301"
    );
    let bad = ctx().with_policy(PolicyExtensions::new().img_src("https:; script-src *"));
    assert_eq!(
        a.render_navigation(&props(), &bad).unwrap_err().code(),
        "RENDER-201"
    );
    let invalid = Props {
        value: "<".repeat(300_000),
        secret: String::new(),
    };
    assert_eq!(
        a.render_navigation(&invalid, &ctx()).unwrap_err().code(),
        "RENDER-502"
    );
}
#[test]
fn identities_are_bounded_and_not_arbitrary_markup_or_empty_context() {
    for bad in ["", "user@email.test", "a b", "</script>"] {
        assert!(NavigationConfig::new("group", "shell", bad).is_err());
    }
    assert!(NavigationConfig::new("x".repeat(129), "shell", "context").is_err());
}
#[tokio::test]
async fn enhanced_actions_keep_validation_status_and_represent_post_redirect_get_without_following()
{
    let (a, _) = handles();
    let admission = a.action_context(&ctx(), "/update").unwrap();
    let (status, headers, text) =
        body(ActionResponse::validation(&admission, json!({"name":"Required"})).unwrap()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(headers[header::CONTENT_TYPE], ACTION_MEDIA_TYPE);
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        serde_json::from_str::<Value>(&text).unwrap()["outcome"],
        "validation"
    );
    let (status, headers, text) =
        body(ActionResponse::redirect(&admission, "/b?updated=1").unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::LOCATION));
    let action: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(action["status"], 200);
    assert_eq!(action["data"]["status"], 303);
    assert_eq!(action["data"]["location"], "/b?updated=1");
    for bad in [
        "https://elsewhere.test",
        "//elsewhere.test",
        "/\\elsewhere.test",
        "/line\nfeed",
    ] {
        assert!(ActionResponse::redirect(&admission, bad).is_err());
    }
    assert!(ActionResponse::error(&admission, StatusCode::OK, json!(null)).is_err());
    assert!(ActionResponse::success(&admission, "x".repeat(1_048_576)).is_err());
}
#[tokio::test]
async fn non_opted_in_document_remains_unchanged_and_has_no_router_metadata() {
    let (a, _) = handles();
    let (_, headers, document) = body(a.render(&props(), &RenderCtx::new()).unwrap()).await;
    assert!(!document.contains("data-forma-navigation"));
    assert!(!headers.contains_key(header::VARY));
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    assert!(document.contains("data-island-state"));
}

#[test]
fn a_faulting_application_action_serializer_returns_no_partial_outcome() {
    struct Fault;
    impl serde::Serialize for Fault {
        fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
            panic!("application serializer failure");
        }
    }
    let (a, _) = handles();
    let admission = a.action_context(&ctx(), "/update").unwrap();
    assert_eq!(
        ActionResponse::success(&admission, Fault)
            .unwrap_err()
            .to_string(),
        "action serialization panicked"
    );
}

#[tokio::test]
async fn actions_carry_bound_admission_and_actual_status_before_data_can_be_used() {
    let (a, _) = handles();
    let (_, _, document) = body(a.render(&props(), &ctx()).unwrap()).await;
    let initial = initial(&document);
    let admission = a.action_context(&ctx(), "/update").unwrap();
    let responses = [
        (
            ActionResponse::success(&admission, json!({"ok":true})).unwrap(),
            200,
            "success",
        ),
        (
            ActionResponse::validation(&admission, json!({"name":"Required"})).unwrap(),
            422,
            "validation",
        ),
        (
            ActionResponse::error(
                &admission,
                StatusCode::FORBIDDEN,
                json!({"message":"Refused"}),
            )
            .unwrap(),
            403,
            "error",
        ),
        (
            ActionResponse::redirect(&admission, "/b").unwrap(),
            200,
            "redirect",
        ),
    ];
    for (response, status, outcome) in responses {
        let (actual_status, headers, text) = body(response).await;
        let envelope: Value = serde_json::from_str(&text).unwrap();
        for field in [
            "version", "app", "build", "group", "layout", "context", "policy",
        ] {
            assert_eq!(envelope[field], initial[field], "{field}");
        }
        assert_eq!(envelope["endpoint"], "/update");
        assert_eq!(envelope["kind"], "action");
        assert_eq!(envelope["outcome"], outcome);
        assert_eq!(envelope["status"], status);
        assert_eq!(actual_status.as_u16(), status);
        assert!(!headers.contains_key(header::LOCATION));
    }
    for changed in [
        ctx().with_policy(PolicyExtensions::new().img_src("https:")),
        RenderCtx::new()
            .with_navigation(NavigationConfig::new("proof", "shell-v1", "public-v2").unwrap()),
    ] {
        let admission = a.action_context(&changed, "/update").unwrap();
        let (_, _, text) = body(ActionResponse::success(&admission, json!(null)).unwrap()).await;
        let envelope: Value = serde_json::from_str(&text).unwrap();
        assert!(
            envelope["policy"] != initial["policy"] || envelope["context"] != initial["context"]
        );
    }
    for invalid_status in [
        StatusCode::CONTINUE,
        StatusCode::OK,
        StatusCode::CREATED,
        StatusCode::SEE_OTHER,
    ] {
        assert!(ActionResponse::error(&admission, invalid_status, json!(null)).is_err());
    }
}

#[test]
fn action_context_refuses_unfinalized_handles_missing_opt_in_bad_policy_and_ambiguous_endpoints() {
    let manifest = assets::try_load_manifest::<Files>().unwrap();
    let pages = load_ir_modules::<Files>(&manifest).unwrap();
    let a = pages.bind::<Props>("/a").unwrap();
    assert_eq!(
        a.action_context(&ctx(), "/update").unwrap_err().code(),
        "RENDER-406"
    );
    let (a, _) = handles();
    assert_eq!(
        a.action_context(&RenderCtx::new(), "/update")
            .unwrap_err()
            .code(),
        "RENDER-601"
    );
    assert_eq!(
        a.action_context(
            &ctx().with_policy(PolicyExtensions::new().img_src("https:; script-src *")),
            "/update"
        )
        .unwrap_err()
        .code(),
        "RENDER-201"
    );
    assert_eq!(
        a.action_context(
            &ctx().with_config_json(json!({"unsupported":true})),
            "/update"
        )
        .unwrap_err()
        .code(),
        "RENDER-601"
    );
    for bad in [
        "",
        "update",
        "https://example.test/update",
        "//example.test/update",
        "/update?x=1",
        "/update#fragment",
        "/update/",
        "/update//child",
        "/./update",
        "/x/../update",
        "/%75pdate",
        "/x%2fupdate",
        "/x%5cupdate",
        "/two words",
        "/\\host",
        "/line\nfeed",
        "/é",
    ] {
        assert_eq!(
            a.action_context(&ctx(), bad).unwrap_err().code(),
            "RENDER-601",
            "{bad:?}"
        );
    }
    assert!(a
        .action_context(&ctx(), &format!("/{}", "a".repeat(2048)))
        .is_err());
    for valid in ["/", "/proof/update", "/.well-known/action-v1_~"] {
        assert!(a.action_context(&ctx(), valid).is_ok());
    }
}
