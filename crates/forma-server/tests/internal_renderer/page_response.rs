//! PageResponse sends HTML, no-store and its nonce-bound policy together.
//! Existing policy/property cases exercise the retained SSR and browser-shell paths.

use super::{
    render_shell as render_browser_shell, render_ssr as try_render, RenderFixture as PageConfig,
    RenderPath as RenderMode,
};
use crate as forma_server;
use axum::body::to_bytes;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use forma_server::csp::{build_csp_header, PolicyExtensions};
use forma_server::{
    AssetManifest, CspNonce, PageResponse, PolicyError, RenderCtx, RenderError, RouteAssets,
};
use std::collections::HashMap;

// -- Fixtures ---------------------------------------------------------------

fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        "/".to_string(),
        RouteAssets {
            mode: forma_server::RouteMode::Browser,
            modulepreload: Vec::new(),
            js: vec!["app.a1b2c3d4.js".to_string()],
            css: vec!["style.e5f6.css".to_string()],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        },
    );
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

/// A page through the A2 bridge: render, then the typed response.
fn page(manifest: &AssetManifest, extensions: &PolicyExtensions) -> PageResponse {
    render_browser_shell(
        &PageConfig {
            title: "Home",
            route_pattern: "/",
            manifest,
            config_json: None,
            body_class: None,
            personality_css: Some("body{margin:0}"),
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        },
        &RenderCtx::new().with_policy(extensions.clone()),
    )
    .expect("a page with valid extensions becomes a response")
}

/// Every public way to make a `PageResponse`.
#[derive(Debug, Clone, Copy)]
enum Path {
    /// `try_render`, on a module that renders `<p>hello</p>`.
    TryRender,
    /// `render_browser_shell`.
    Shell,
}
const PATHS: [Path; 2] = [Path::TryRender, Path::Shell];

/// A page with `extensions` along `path`, or the extension it refused.
fn make(
    path: Path,
    manifest: &AssetManifest,
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
        route_pattern: "/",
        manifest,
        config_json: None,
        body_class: None,
        personality_css: Some("body{margin:0}"),
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

/// What a client sees: status, headers and body.
async fn fetch(response: Response) -> (StatusCode, HeaderMap, String) {
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a page body is in memory");
    (
        status,
        headers,
        String::from_utf8(body.to_vec()).expect("utf-8 page"),
    )
}

/// The one value of a header, failing if it is absent or repeated.
fn one<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    let values: Vec<_> = headers.get_all(name).iter().collect();
    assert_eq!(values.len(), 1, "exactly one {name} header, got {values:?}");
    values[0].to_str().expect("ascii header")
}

/// The nonce the HTML's module script carries.
fn html_nonce(html: &str) -> String {
    let start = html
        .find("<script type=\"module\" nonce=\"")
        .expect("module script")
        + "<script type=\"module\" nonce=\"".len();
    let end = html[start..].find('"').expect("nonce end") + start;
    html[start..end].to_string()
}

/// A directive's sources, or None when the policy does not name it.
fn directive<'a>(csp: &'a str, name: &str) -> Option<Vec<&'a str>> {
    csp.split(';').map(str::trim).find_map(|d| {
        let mut words = d.split_ascii_whitespace();
        (words.next() == Some(name)).then(|| words.collect())
    })
}

// -- The headers ------------------------------------------------------------

#[tokio::test]
async fn page_response_writes_no_store_the_policy_and_the_document_headers() {
    let manifest = manifest();
    let (status, headers, html) =
        fetch(page(&manifest, &PolicyExtensions::new()).into_response()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(one(&headers, "cache-control"), "no-store");
    assert_eq!(one(&headers, "content-type"), "text/html; charset=utf-8");
    assert_eq!(one(&headers, "x-content-type-options"), "nosniff");
    assert_eq!(
        one(&headers, "referrer-policy"),
        "strict-origin-when-cross-origin"
    );
    assert_eq!(
        one(&headers, "permissions-policy"),
        "geolocation=(), camera=(), microphone=()"
    );
    assert_eq!(one(&headers, "cross-origin-opener-policy"), "same-origin");

    // The policy is exactly the strict one, for the nonce the HTML carries:
    // not a looser copy, and not a policy for some other nonce.
    let nonce = CspNonce::parse(&html_nonce(&html)).expect("the HTML's nonce is valid");
    assert_eq!(
        one(&headers, "content-security-policy"),
        build_csp_header(&nonce)
    );
    assert!(
        html.contains("<style nonce=\""),
        "the page itself is written"
    );
}

#[tokio::test]
async fn two_fetches_get_no_store_and_two_different_nonces() {
    // SR6: a cached page would ship one public nonce to every user. The
    // handler below is the A2 shape a template's page takes (FORMA-133 runs
    // the same assertion against both templates).
    async fn handler(manifest: &AssetManifest) -> Response {
        page(manifest, &PolicyExtensions::new()).into_response()
    }
    let manifest = manifest();

    let mut nonces = Vec::new();
    for _ in 0..2 {
        let (status, headers, html) = fetch(handler(&manifest).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(one(&headers, "cache-control"), "no-store");
        let nonce = html_nonce(&html);
        // The header blesses exactly the nonce this response's HTML carries.
        let script_src =
            directive(one(&headers, "content-security-policy"), "script-src").expect("script-src");
        assert!(
            script_src.contains(&format!("'nonce-{nonce}'").as_str()),
            "the policy blesses this page's own nonce: {script_src:?}"
        );
        nonces.push(nonce);
    }
    assert_eq!(nonces[0].len(), 44, "a 32-byte nonce, base64");
    assert_ne!(nonces[0], nonces[1], "each response draws its own nonce");
}

// -- The typed extensions ---------------------------------------------------

#[tokio::test]
async fn extensions_add_sources_to_their_own_directive_only() {
    // GateWASM's console rewrote the policy as text to add `https:` images
    // and same-origin frames; Generative UI appended `frame-src blob:`; a
    // login page needs a form target and COOP for its popup (DR-17, L-38).
    let manifest = manifest();
    let extensions = PolicyExtensions::new()
        .img_src("https:")
        .frame_src("'self'")
        .frame_src("blob:")
        .form_action("https://idp.example.com")
        .allow_popups();
    let (_, headers, html) = fetch(page(&manifest, &extensions).into_response()).await;
    let csp = one(&headers, "content-security-policy");

    assert_eq!(
        directive(csp, "img-src"),
        Some(vec!["'self'", "data:", "https:"])
    );
    assert_eq!(directive(csp, "frame-src"), Some(vec!["'self'", "blob:"]));
    assert_eq!(
        directive(csp, "form-action"),
        Some(vec!["'self'", "https://idp.example.com"])
    );
    assert_eq!(
        one(&headers, "cross-origin-opener-policy"),
        "same-origin-allow-popups"
    );

    // Every other directive is the strict policy's, word for word.
    let nonce = CspNonce::parse(&html_nonce(&html)).expect("nonce");
    let strict = build_csp_header(&nonce);
    for d in strict.split(';').map(str::trim) {
        let name = d.split_ascii_whitespace().next().expect("directive name");
        if matches!(name, "img-src" | "form-action") {
            continue;
        }
        assert_eq!(
            directive(csp, name),
            directive(&strict, name),
            "{name} is not extensible and must be unchanged"
        );
    }
    assert_eq!(one(&headers, "cache-control"), "no-store");
}

#[test]
fn an_invalid_extension_fails_instead_of_sending_a_page_without_the_policy() {
    let manifest = manifest();
    // Each is either directive injection, a keyword that would loosen script
    // or style, or a wildcard; each must fail the page, never reach a header.
    let hostile = [
        "https://a.example; script-src *",
        "https://a.example;script-src 'unsafe-inline'",
        "https://a.example, script-src *",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "'strict-dynamic'",
        "'nonce-AAAAAAAAAAAAAAAAAAAAAAAA'",
        "'sha256-abc='",
        "'none'",
        "*",
        "https://*",
        "",
        "https://a.example\r\nset-cookie: x=1",
        "https://a.example script-src",
        "javascript:",
        "javascript://x",
        "JAVASCRIPT://x/%0aalert(1)",
        "vbscript://x",
        "'self",
        "https://a.example/'x'",
    ];
    for source in hostile {
        for (directive, extensions) in [
            ("img-src", PolicyExtensions::new().img_src(source)),
            ("frame-src", PolicyExtensions::new().frame_src(source)),
            ("form-action", PolicyExtensions::new().form_action(source)),
        ] {
            // A valid sibling in the same builder does not rescue it.
            let extensions = extensions.img_src("https://cdn.example.com");
            for path in PATHS {
                let error = make(path, &manifest, &extensions).expect_err(&format!(
                    "{path:?}: {directive} {source:?} must fail the page"
                ));
                assert_eq!(error.directive(), directive, "for {source:?}");
                assert_eq!(error.source_expression(), source);
                assert!(
                    error.to_string().contains(directive),
                    "the message names the directive: {error}"
                );
            }
        }
    }

    // The negative space: the same builder with only valid sources is a page.
    let extensions = PolicyExtensions::new()
        .img_src("https://cdn.example.com")
        .img_src("https://*.example.com:8443/images/")
        .frame_src("blob:")
        .form_action("'self'");
    let page = page(&manifest, &extensions);
    let parts = page.into_parts_unchecked();
    assert!(parts.html.starts_with("<!DOCTYPE html>"));
}

// -- SR5's property ---------------------------------------------------------

/// xorshift64*: a deterministic stream, so a failure reproduces from its seed.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn pick<'a>(&mut self, from: &[&'a str]) -> &'a str {
        from[(self.next() % from.len() as u64) as usize]
    }
}

/// Whether an endpoint may be named.
#[derive(Debug, Clone, Copy)]
enum Endpoint {
    /// Anywhere.
    Valid,
    /// Loopback `http://`: in development builds only.
    Loopback,
    /// Never.
    Hostile,
}

/// Reporting endpoints for the property: the shapes applications name, and
/// the hostile and malformed ones review 5517672933 found (FORMA-127).
const ENDPOINTS: &[(&str, Endpoint)] = &[
    ("/csp-reports", Endpoint::Valid),
    ("/r?app=studio&v=1", Endpoint::Valid),
    ("https://reports.example/csp", Endpoint::Valid),
    ("https://reports.example:8443/csp?x=1", Endpoint::Valid),
    ("https://[2001:db8::1]:8443/csp", Endpoint::Valid),
    ("http://localhost:3000/csp", Endpoint::Loopback),
    ("http://127.0.0.1/csp", Endpoint::Loopback),
    ("http://[::1]:8080/csp", Endpoint::Loopback),
    ("https://user:pw@reports.example/csp", Endpoint::Hostile),
    ("https://user@reports.example", Endpoint::Hostile),
    ("http://evil.com@localhost/csp", Endpoint::Hostile),
    ("http://[::1]evil.com", Endpoint::Hostile),
    ("http://[::1", Endpoint::Hostile),
    ("http://localhost:3000]", Endpoint::Hostile),
    ("https://reports.example:8443x", Endpoint::Hostile),
    ("https://%0d%0a", Endpoint::Hostile),
    ("https://]", Endpoint::Hostile),
    ("http://evil.example/csp", Endpoint::Hostile),
    ("//evil.example/csp", Endpoint::Hostile),
    ("/a; script-src *", Endpoint::Hostile),
    ("/a, default-src *", Endpoint::Hostile),
    ("/a\" b", Endpoint::Hostile),
    ("/a#x", Endpoint::Hostile),
    ("javascript:alert(1)", Endpoint::Hostile),
    ("", Endpoint::Hostile),
];

#[tokio::test]
async fn no_policy_extension_yields_a_response_without_the_policy() {
    // SR5, the property half: whatever a handler adds, a response either
    // carries the whole strict policy (extended only where extension is
    // allowed) or does not exist. The compile-fail half (no way to the HTML
    // without `into_parts_unchecked`) is the doctest on `PageResponse`.
    const FRAGMENTS: &[&str] = &[
        // valid
        "'self'",
        "https:",
        "blob:",
        "data:",
        "wss:",
        "https://cdn.example.com",
        "https://*.example.com",
        "cdn.example.com:8443",
        "https://a.example/path/to/",
        // hostile
        ";",
        "; script-src *",
        "default-src *",
        "'unsafe-inline'",
        "'unsafe-hashes'",
        "'none'",
        "*",
        ",",
        " ",
        "\t",
        "\n",
        "'",
        "\"",
        "'nonce-x'",
        "report-uri https://evil.example",
        "https://evil.example; object-src *",
        "javascript",
        "vbscript",
        "://",
        "x",
        "filesystem:",
        // the script and frame forms whole, so every run meets them
        "javascript://x",
        "JAVASCRIPT://a.example/%0aalert(1)",
        "vbscript://x",
        "data://x",
        "",
    ];
    let manifest = manifest();
    let mut rng = Rng(0x5EED_F0E1_A2B3_C4D5);
    let (mut accepted, mut refused) = (0, 0);
    let (mut endpoints_accepted, mut endpoints_refused) = (0, 0);

    for case in 0..2_000 {
        let mut extensions = PolicyExtensions::new();
        let mut added: Vec<(&str, String)> = Vec::new();
        for _ in 0..(rng.next() % 5) {
            // A source is one to three fragments glued together, so
            // injection can arrive inside an otherwise valid-looking source
            // (`javascript` + `://` + `x` is one).
            let source = match rng.next() % 4 {
                0 => format!("{}{}", rng.pick(FRAGMENTS), rng.pick(FRAGMENTS)),
                1 => format!(
                    "{}{}{}",
                    rng.pick(FRAGMENTS),
                    rng.pick(FRAGMENTS),
                    rng.pick(FRAGMENTS)
                ),
                _ => rng.pick(FRAGMENTS).to_string(),
            };
            let which = rng.next() % 3;
            extensions = match which {
                0 => extensions.img_src(source.clone()),
                1 => extensions.frame_src(source.clone()),
                _ => extensions.form_action(source.clone()),
            };
            added.push((
                ["img-src", "frame-src", "form-action"][which as usize],
                source,
            ));
        }
        if rng.next() % 4 == 0 {
            extensions = extensions.allow_popups();
        }
        // A reporting endpoint, valid or hostile, through either method,
        // named up to twice: the last one named is the one written
        // (FORMA-127).
        let mut reporting: Option<(bool, &str, Endpoint)> = None;
        for _ in 0..(rng.next() % 3) {
            let (endpoint, kind) = ENDPOINTS[(rng.next() as usize) % ENDPOINTS.len()];
            let both = rng.next() % 2 == 0;
            extensions = if both {
                extensions.report_to(endpoint)
            } else {
                extensions.report_uri(endpoint)
            };
            reporting = Some((both, endpoint, kind));
        }
        let endpoint_ok = reporting.is_none_or(|(_, _, kind)| match kind {
            Endpoint::Valid => true,
            Endpoint::Loopback => cfg!(debug_assertions),
            Endpoint::Hostile => false,
        });

        let path = PATHS[case % PATHS.len()];
        let page = match make(path, &manifest, &extensions) {
            Ok(page) => page,
            Err(error) => {
                refused += 1;
                if endpoint_ok {
                    assert!(
                        !matches!(error.directive(), "report-to" | "report-uri"),
                        "case {case}: a valid endpoint refused: {error}"
                    );
                } else {
                    endpoints_refused += 1;
                }
                continue;
            }
        };
        assert!(endpoint_ok, "case {case}: accepted {reporting:?}");
        accepted += 1;
        if reporting.is_some() {
            endpoints_accepted += 1;
        }

        let (_, headers, html) = fetch(page.into_response()).await;
        assert_eq!(one(&headers, "cache-control"), "no-store", "case {case}");
        let opener = one(&headers, "cross-origin-opener-policy");
        assert!(
            opener == "same-origin" || opener == "same-origin-allow-popups",
            "case {case}: {opener}"
        );
        // The reporting directives close both policies, exactly; the rest of
        // the enforced policy is checked below without them.
        let suffix = match reporting {
            Some((true, endpoint, _)) => format!("; report-to forma-csp; report-uri {endpoint}"),
            Some((false, endpoint, _)) => format!("; report-uri {endpoint}"),
            None => String::new(),
        };
        let reported = one(&headers, "content-security-policy");
        let csp = reported
            .strip_suffix(suffix.as_str())
            .unwrap_or_else(|| panic!("case {case}: {reported} does not end {suffix:?}"));
        assert!(!csp.contains("report-"), "case {case}: {reported}");
        let endpoints_header: Vec<_> = headers.get_all("reporting-endpoints").iter().collect();
        match reporting {
            Some((true, endpoint, _)) => assert_eq!(
                endpoints_header,
                [&format!("forma-csp=\"{endpoint}\"")],
                "case {case}"
            ),
            _ => assert!(endpoints_header.is_empty(), "case {case}"),
        }
        let nonce = CspNonce::parse(&html_nonce(&html)).expect("nonce");
        let strict = build_csp_header(&nonce);

        // No directive twice: a browser honours the first and ignores the
        // rest, so a duplicate is how a looser copy would hide.
        let names: Vec<_> = csp
            .split(';')
            .filter_map(|d| d.split_ascii_whitespace().next())
            .collect();
        let mut unique = names.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), names.len(), "case {case}: {csp}");

        for d in strict.split(';').map(str::trim) {
            let name = d.split_ascii_whitespace().next().expect("name");
            let ours = directive(&strict, name).expect("strict directive");
            let theirs = directive(csp, name)
                .unwrap_or_else(|| panic!("case {case}: {name} dropped from {csp}"));
            if matches!(name, "img-src" | "form-action") {
                assert_eq!(&theirs[..ours.len()], &ours[..], "case {case}: {csp}");
            } else {
                assert_eq!(theirs, ours, "case {case}: {name} changed in {csp}");
            }
        }
        // Only frame-src may be new, and every source in the policy is either
        // the strict policy's own or one the handler added to that directive.
        for name in &names {
            assert!(
                directive(&strict, name).is_some() || *name == "frame-src",
                "case {case}: new directive {name} in {csp}"
            );
            for source in directive(csp, name).expect("listed") {
                let strict_has = directive(&strict, name).is_some_and(|s| s.contains(&source));
                let added_here = added.iter().any(|(d, s)| d == name && s == source);
                assert!(
                    strict_has || added_here,
                    "case {case}: {source} appeared in {name}: {csp}"
                );
            }
        }
        assert!(!csp.contains('\n') && !csp.contains(','), "case {case}");
        // SR39: `style-src-attr`'s is the policy's only `'unsafe-inline'`,
        // and the Report-Only policy is Trusted Types alone, whatever a
        // handler added (DR-20).
        assert_eq!(
            csp.matches("'unsafe-inline'").count(),
            1,
            "case {case}: {csp}"
        );
        assert_eq!(
            directive(csp, "style-src-attr"),
            Some(vec!["'unsafe-inline'"]),
            "case {case}"
        );
        // Trusted Types in Report-Only: with an endpoint in every build, and
        // with none in development builds only (FORMA-127, WebKit).
        if reporting.is_none() && !cfg!(debug_assertions) {
            assert!(
                headers.get("content-security-policy-report-only").is_none(),
                "case {case}: a release page with no endpoint sends no Report-Only"
            );
        } else {
            assert_eq!(
                one(&headers, "content-security-policy-report-only"),
                format!(
                    "require-trusted-types-for 'script'; trusted-types forma forma-runtime{suffix}"
                ),
                "case {case}"
            );
        }
        // No script scheme in any form, and no data: or filesystem: target
        // for a frame or a form.
        for name in &names {
            for source in directive(csp, name).expect("listed") {
                let scheme = source
                    .split_once(':')
                    .map(|(s, _)| s.to_ascii_lowercase())
                    .unwrap_or_default();
                assert!(
                    scheme != "javascript" && scheme != "vbscript",
                    "case {case}: {source} in {csp}"
                );
                if matches!(*name, "frame-src" | "form-action") {
                    assert!(
                        scheme != "data" && scheme != "filesystem",
                        "case {case}: {source} in {name}"
                    );
                }
            }
        }
    }

    // The generator must exercise both sides, or the property says nothing.
    assert!(
        accepted > 200 && refused > 200,
        "{accepted} accepted, {refused} refused"
    );
    assert!(
        endpoints_accepted > 50 && endpoints_refused > 50,
        "{endpoints_accepted} endpoints accepted, {endpoints_refused} refused"
    );
}

// -- The raw parts and the counts -------------------------------------------

#[tokio::test]
async fn into_parts_unchecked_returns_exactly_what_the_response_writes() {
    let manifest = manifest();
    let extensions = PolicyExtensions::new().img_src("https:");
    let parts = page(&manifest, &extensions).into_parts_unchecked();
    let (_, headers, html) = fetch(page(&manifest, &extensions).into_response()).await;

    // Same header names, in the same order, as the response writes.
    let response_names: Vec<_> = headers.keys().map(|n| n.as_str().to_string()).collect();
    let parts_names: Vec<_> = parts
        .headers
        .iter()
        .map(|(n, _)| n.as_str().to_string())
        .collect();
    assert_eq!(parts_names, response_names);
    let get = |name: header::HeaderName| {
        parts
            .headers
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.to_str().expect("ascii").to_string())
    };
    assert_eq!(get(header::CACHE_CONTROL).as_deref(), Some("no-store"));
    // The parts' policy blesses the parts' nonce, which the parts' HTML uses.
    let csp = get(header::CONTENT_SECURITY_POLICY).expect("policy");
    assert!(csp.contains(&format!("'nonce-{}'", parts.nonce)));
    assert_eq!(html_nonce(&parts.html), parts.nonce.as_str());
    assert!(directive(&csp, "img-src")
        .expect("img-src")
        .contains(&"https:"));
    // Two renders, two nonces: the parts are this page's, not a shared copy.
    assert_ne!(html_nonce(&html), parts.nonce.as_str());
}

#[test]
fn a_page_response_counts_its_walk() {
    use forma_ir::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
    };
    let mut ops = Vec::new();
    ops.extend_from_slice(&encode_open_tag(0, &[]));
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    let module = forma_ir::IrModule::parse(&build_minimal_ir(&["p", "hello"], &[], &ops, &[]))
        .expect("module");
    let slots = forma_ir::SlotData::new(0);
    let manifest = manifest();

    #[allow(deprecated)]
    fn config<'a>(
        manifest: &'a AssetManifest,
        slots: &'a forma_ir::SlotData,
        render_mode: RenderMode,
        ir_module: Option<&'a forma_ir::IrModule>,
    ) -> PageConfig<'a> {
        PageConfig {
            title: "Home",
            route_pattern: "/",
            manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode,
            ir_module,
            slots: Some(slots),
        }
    }

    let ssr = try_render(
        &config(
            &manifest,
            &slots,
            RenderMode::Phase2SsrReconcile,
            Some(&module),
        ),
        &RenderCtx::new(),
    )
    .expect("page");
    // The walk wrote `<p>hello</p>`: its bytes, not the document's.
    assert_eq!(ssr.counts().bytes, "<p>hello</p>".len());

    // A shell walks nothing, and says so.
    let shell = render_browser_shell(
        &config(&manifest, &slots, RenderMode::Phase1ClientMount, None),
        &RenderCtx::new(),
    )
    .expect("page");
    assert_eq!(shell.counts().bytes, 0);
    assert_eq!(shell.counts().walk_time, std::time::Duration::ZERO);
}
