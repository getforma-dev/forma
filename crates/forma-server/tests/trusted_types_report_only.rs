//! Enforced Trusted Types, optional reporting, and scoped route relaxation.
//! Both retained document renderers enforce without a reporting endpoint; only
//! the named relaxation moves those directives to Report-Only.

use axum::body::to_bytes;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use forma_server::csp::build_csp_header;
use forma_server::{
    render_browser_shell, try_render, AssetManifest, CspNonce, PageConfig, PageResponse,
    PolicyError, PolicyExtensions, RenderCtx, RenderError, RenderMode, RouteAssets,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

const TRUSTED_TYPES: &str = "require-trusted-types-for 'script'; trusted-types forma forma-runtime";

fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    for route in ["/", "/studio", "/vector", "/plain"] {
        routes.insert(
            route.to_string(),
            RouteAssets {
                mode: forma_server::RouteMode::Browser,
                modulepreload: Vec::new(),
                js: vec!["app.a1b2c3d4.js".to_string()],
                css: vec![],
                fonts: vec![],
                total_size_br: 0,
                budget_warn_threshold: 0,
                ir: None,
            },
        );
    }
    AssetManifest {
        version: 2,
        writer: "3.0.0".into(),
        app: "ledger".into(),
        aliases: HashMap::new(),
        build: "test".to_string(),
        assets: HashMap::new(),
        routes,
    }
}

/// Every public way to make a `PageResponse`.
#[derive(Debug, Clone, Copy)]
enum Path {
    /// `try_render`.
    TryRender,
    /// `render_browser_shell`.
    Shell,
}
const PATHS: [Path; 2] = [Path::TryRender, Path::Shell];

/// A page on `route` with `extensions` along `path`, or the extension it
/// refused.
fn make(
    path: Path,
    manifest: &AssetManifest,
    route: &str,
    extensions: &PolicyExtensions,
) -> Result<PageResponse, PolicyError> {
    use forma_ir::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
    };
    let mut ops = encode_open_tag(0, &[]);
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    let module = forma_ir::IrModule::parse(&build_minimal_ir(&["p", "hello"], &[], &ops, &[]))
        .expect("module");
    let slots = forma_ir::SlotData::new(0);
    let config = PageConfig {
        title: "Home",
        route_pattern: route,
        manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(&module),
        slots: Some(&slots),
    };
    let ctx = RenderCtx::new().with_policy(extensions.clone());
    let policy = |result: Result<PageResponse, RenderError>| match result {
        Ok(page) => Ok(page),
        Err(RenderError::Policy { cause, .. }) => Err(cause),
        Err(other) => panic!("{path:?}: only the policy may fail here, got {other}"),
    };
    match path {
        Path::TryRender => policy(try_render(&config, &ctx)),
        Path::Shell => policy(render_browser_shell(&config, &ctx)),
    }
}

/// The headers a client receives, and the nonce the page carries.
async fn sent(page: PageResponse) -> (HeaderMap, CspNonce) {
    let response = page.into_response();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let html = String::from_utf8(body.to_vec()).expect("utf-8");
    let start = html
        .find("<script type=\"module\" nonce=\"")
        .expect("module script")
        + "<script type=\"module\" nonce=\"".len();
    let end = html[start..].find('"').expect("nonce end") + start;
    (headers, CspNonce::parse(&html[start..end]).expect("nonce"))
}

/// The one value of a header, failing if it is absent or repeated; `None`
/// when absent is expected.
fn one(headers: &HeaderMap, name: &str) -> Option<String> {
    let values: Vec<_> = headers.get_all(name).iter().collect();
    assert!(
        values.len() <= 1,
        "at most one {name} header, got {values:?}"
    );
    values
        .first()
        .map(|v| v.to_str().expect("ascii header").to_string())
}

#[tokio::test]
async fn trusted_types_are_enforced_without_an_endpoint_in_every_build() {
    let manifest = manifest();
    for path in PATHS {
        let page = make(path, &manifest, "/", &PolicyExtensions::new()).expect("renders");
        let (headers, nonce) = sent(page).await;
        // Both directives are enforced without an endpoint. The additional
        // diagnostic Report-Only header remains optional on strict routes.
        assert_eq!(
            one(&headers, "content-security-policy").as_deref(),
            Some(build_csp_header(&nonce).as_str()),
            "{path:?}"
        );
        assert_eq!(
            one(&headers, "content-security-policy-report-only").as_deref(),
            cfg!(debug_assertions).then_some(TRUSTED_TYPES),
            "{path:?}"
        );
        assert_eq!(one(&headers, "reporting-endpoints"), None, "{path:?}");
        assert!(
            one(&headers, "content-security-policy")
                .unwrap()
                .contains(TRUSTED_TYPES),
            "{path:?}: enforcement requires no endpoint"
        );
        // Name an endpoint and every build sends it.
        let page = make(
            path,
            &manifest,
            "/",
            &PolicyExtensions::new().report_uri("/csp-reports"),
        )
        .expect("renders");
        let (headers, _) = sent(page).await;
        assert_eq!(
            one(&headers, "content-security-policy-report-only").as_deref(),
            Some(format!("{TRUSTED_TYPES}; report-uri /csp-reports").as_str()),
            "{path:?}"
        );
        assert_eq!(one(&headers, "cache-control").as_deref(), Some("no-store"));
    }
}

#[tokio::test]
async fn a_named_endpoint_is_written_into_both_policies_and_reporting_endpoints() {
    let manifest = manifest();
    for endpoint in ["/csp-reports", "https://reports.example.com/csp?app=studio"] {
        // `report_to`: the Reporting API and `report-uri`; `report_uri`:
        // `report-uri` alone, for pages served over plain HTTP.
        for (extensions, reporting, endpoints_header) in [
            (
                PolicyExtensions::new()
                    .img_src("https:")
                    .report_to(endpoint),
                format!("report-to forma-csp; report-uri {endpoint}"),
                Some(format!("forma-csp=\"{endpoint}\"")),
            ),
            (
                PolicyExtensions::new()
                    .img_src("https:")
                    .report_uri(endpoint),
                format!("report-uri {endpoint}"),
                None,
            ),
            (
                // The last one named wins.
                PolicyExtensions::new()
                    .report_to("/elsewhere")
                    .img_src("https:")
                    .report_uri(endpoint),
                format!("report-uri {endpoint}"),
                None,
            ),
        ] {
            for path in PATHS {
                let page = make(path, &manifest, "/", &extensions).expect("renders");
                let (headers, nonce) = sent(page).await;
                let csp = one(&headers, "content-security-policy").expect("policy");
                // The strict policy with the image source, then the reporting
                // directives; nothing else moved.
                let strict = build_csp_header(&nonce)
                    .replace("img-src 'self' data:", "img-src 'self' data: https:");
                assert_eq!(csp, format!("{strict}; {reporting}"), "{path:?} {endpoint}");
                assert_eq!(
                    one(&headers, "content-security-policy-report-only"),
                    Some(format!("{TRUSTED_TYPES}; {reporting}")),
                    "{path:?} {endpoint}"
                );
                assert_eq!(
                    one(&headers, "reporting-endpoints"),
                    endpoints_header,
                    "{path:?} {endpoint}"
                );
            }
        }
    }
}

#[test]
fn an_invalid_endpoint_fails_the_page_on_every_path() {
    let manifest = manifest();
    for endpoint in [
        "",
        "csp-reports",
        "//evil.example/x",
        "http://evil.example/x",
        "javascript:alert(1)",
        "/a; script-src *",
        "/a, default-src *",
        "/a\" b",
        "/a\r\nSet-Cookie: x=1",
    ] {
        for path in PATHS {
            for (extensions, method) in [
                (PolicyExtensions::new().report_to(endpoint), "report-to"),
                (PolicyExtensions::new().report_uri(endpoint), "report-uri"),
            ] {
                let error = make(path, &manifest, "/", &extensions)
                    .err()
                    .unwrap_or_else(|| panic!("{path:?} accepted {endpoint:?}"));
                assert_eq!(error.directive(), method, "{path:?} {endpoint:?}");
                assert_eq!(error.source_expression(), endpoint);
            }
        }
    }
}

/// Every warning, as (route field, message).
#[derive(Clone, Default)]
struct Warnings(Arc<Mutex<Vec<(String, String)>>>);

impl Subscriber for Warnings {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, event: &Event<'_>) {
        #[derive(Default)]
        struct Fields(String, String);
        impl Visit for Fields {
            fn record_str(&mut self, field: &Field, value: &str) {
                if field.name() == "route" {
                    self.0 = value.to_string();
                }
            }
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.1 = format!("{value:?}");
                }
            }
        }
        if *event.metadata().level() == tracing::Level::WARN {
            let mut fields = Fields::default();
            event.record(&mut fields);
            if fields.1.contains("Trusted Types relaxed") {
                self.0.lock().expect("lock").push((fields.0, fields.1));
            }
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

#[tokio::test]
async fn a_relaxed_route_keeps_reporting_and_is_logged_once_per_route_and_reason() {
    let manifest = manifest();
    let base = PolicyExtensions::new().report_to("/csp-reports");
    let studio = base
        .clone()
        .relax_trusted_types("app.ts sinks; owner studio; until 2027-01-31");
    let warnings = Warnings::default();
    let guard = tracing::subscriber::set_default(warnings.clone());

    // Relaxation changes only the two enforcement directives; reporting remains.
    for path in PATHS {
        let (relaxed, relaxed_nonce) =
            sent(make(path, &manifest, "/studio", &studio).expect("renders")).await;
        let (plain, plain_nonce) =
            sent(make(path, &manifest, "/plain", &base).expect("renders")).await;
        for name in ["content-security-policy-report-only", "reporting-endpoints"] {
            assert_eq!(
                one(&relaxed, name).map(|v| v.replace(relaxed_nonce.as_str(), "N")),
                one(&plain, name).map(|v| v.replace(plain_nonce.as_str(), "N")),
                "{path:?} {name}"
            );
        }
        let enforced = one(&relaxed, "content-security-policy").expect("enforced");
        assert!(!enforced.contains("trusted-types"));
        let strict = one(&plain, "content-security-policy").expect("strict");
        assert!(strict.contains(TRUSTED_TYPES));
        assert_eq!(
            enforced.replace(relaxed_nonce.as_str(), "N"),
            strict
                .replace(plain_nonce.as_str(), "N")
                .replace(&format!("; {TRUSTED_TYPES}"), "")
        );
        assert!(one(&relaxed, "content-security-policy-report-only")
            .expect("reported")
            .starts_with(TRUSTED_TYPES));
    }
    // Repeated renders and a second route retain bounded per-route logging.
    for _ in 0..3 {
        make(Path::TryRender, &manifest, "/studio", &studio).expect("renders");
    }
    make(Path::Shell, &manifest, "/vector", &studio).expect("renders");
    // A second reason on the same route is a separate log entry.
    let canvas = base
        .clone()
        .relax_trusted_types("canvas reconcile; owner canvas; until 2027-02-28");
    for _ in 0..2 {
        make(Path::TryRender, &manifest, "/studio", &canvas).expect("renders");
    }
    drop(guard);

    // Logged once for each route/reason pair.
    let logged = warnings.0.lock().expect("lock").clone();
    let first = "app.ts sinks; owner studio; until 2027-01-31";
    let second = "canvas reconcile; owner canvas; until 2027-02-28";
    let seen: Vec<(&str, &str)> = logged
        .iter()
        .map(|(route, message)| {
            let reason = if message.contains(first) {
                first
            } else if message.contains(second) {
                second
            } else {
                panic!("a relaxation without its reason: {message}")
            };
            (route.as_str(), reason)
        })
        .collect();
    assert_eq!(
        seen,
        [("/studio", first), ("/vector", first), ("/studio", second),],
        "{logged:?}"
    );
    for (_, message) in &logged {
        // The log names the relaxation as an allowlisted exit, in words a
        // reader of the log knows (no decision-record id, FORMA-138).
        assert!(message.contains("An allowlisted exit"), "{message}");
    }

    // A relaxation names why.
    for path in PATHS {
        let error = make(
            path,
            &manifest,
            "/studio",
            &PolicyExtensions::new().relax_trusted_types("  "),
        )
        .expect_err("refused");
        assert_eq!(error.directive(), "trusted-types", "{path:?}");
    }

    // The same route-scoped boundary holds in release without any endpoint.
    for path in PATHS {
        let extensions = PolicyExtensions::new()
            .relax_trusted_types("legacy sink; owner example; until 2027-01-31");
        let (relaxed, nonce) = sent(make(path, &manifest, "/studio", &extensions).unwrap()).await;
        let strict = build_csp_header(&nonce);
        assert_eq!(
            one(&relaxed, "content-security-policy").unwrap(),
            strict.replace(&format!("; {TRUSTED_TYPES}"), "")
        );
        assert_eq!(
            one(&relaxed, "content-security-policy-report-only").as_deref(),
            Some(TRUSTED_TYPES)
        );
        assert_eq!(one(&relaxed, "cache-control").as_deref(), Some("no-store"));
        assert_eq!(
            one(&relaxed, "x-content-type-options").as_deref(),
            Some("nosniff")
        );
        let (sibling, _) =
            sent(make(path, &manifest, "/plain", &PolicyExtensions::new()).unwrap()).await;
        assert!(one(&sibling, "content-security-policy")
            .unwrap()
            .contains(TRUSTED_TYPES));
    }
}
