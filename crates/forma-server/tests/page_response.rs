//! `PageResponse`: the page response that always carries `no-store`, the
//! policy and the document headers (DR-17, SR5, SR6; FORMA-124).
//!
//! Everything here goes through the public API a handler uses: render, turn
//! the page into a `PageResponse`, and let axum's `IntoResponse` write it.

use axum::body::to_bytes;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use forma_server::csp::{build_csp_header, PolicyExtensions};
use forma_server::{
    render_page, AssetManifest, CspNonce, PageConfig, PageResponse, RenderMode, RouteAssets,
};
use std::collections::HashMap;

// -- Fixtures ---------------------------------------------------------------

fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        "/".to_string(),
        RouteAssets {
            js: vec!["app.a1b2c3d4.js".to_string()],
            css: vec!["style.e5f6.css".to_string()],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        },
    );
    AssetManifest {
        version: 1,
        build_hash: "test".to_string(),
        assets: HashMap::new(),
        routes,
        wasm: None,
    }
}

/// A page through the A2 bridge: render, then the typed response.
#[allow(deprecated)] // `config_script` is a field every 0.2.x literal names
fn page(manifest: &AssetManifest, extensions: &PolicyExtensions) -> PageResponse {
    render_page(&PageConfig {
        title: "Home",
        route_pattern: "/",
        manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: Some("body{margin:0}"),
        body_prefix: None,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    })
    .into_page_response(extensions)
    .expect("a page with valid extensions becomes a response")
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
            #[allow(deprecated)]
            let output = render_page(&PageConfig {
                title: "Home",
                route_pattern: "/",
                manifest: &manifest,
                config_script: None,
                config_json: None,
                body_class: None,
                personality_css: None,
                body_prefix: None,
                render_mode: RenderMode::Phase1ClientMount,
                ir_module: None,
                slots: None,
            });
            let error = output
                .into_page_response(&extensions)
                .expect_err(&format!("{directive} {source:?} must fail the page"));
            assert_eq!(error.directive(), directive, "for {source:?}");
            assert_eq!(error.source_expression(), source);
            assert!(
                error.to_string().contains(directive),
                "the message names the directive: {error}"
            );
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
        "",
    ];
    let manifest = manifest();
    let mut rng = Rng(0x5EED_F0E1_A2B3_C4D5);
    let (mut accepted, mut refused) = (0, 0);

    for case in 0..2_000 {
        let mut extensions = PolicyExtensions::new();
        let mut added: Vec<(&str, String)> = Vec::new();
        for _ in 0..(rng.next() % 5) {
            // A source is one fragment or two glued together, so injection
            // can arrive inside an otherwise valid-looking source.
            let source = if rng.next() % 3 == 0 {
                format!("{}{}", rng.pick(FRAGMENTS), rng.pick(FRAGMENTS))
            } else {
                rng.pick(FRAGMENTS).to_string()
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

        #[allow(deprecated)]
        let output = render_page(&PageConfig {
            title: "Home",
            route_pattern: "/",
            manifest: &manifest,
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase1ClientMount,
            ir_module: None,
            slots: None,
        });
        let Ok(page) = output.into_page_response(&extensions) else {
            refused += 1;
            continue;
        };
        accepted += 1;

        let (_, headers, html) = fetch(page.into_response()).await;
        assert_eq!(one(&headers, "cache-control"), "no-store", "case {case}");
        let opener = one(&headers, "cross-origin-opener-policy");
        assert!(
            opener == "same-origin" || opener == "same-origin-allow-popups",
            "case {case}: {opener}"
        );
        let csp = one(&headers, "content-security-policy");
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
    }

    // The generator must exercise both sides, or the property says nothing.
    assert!(
        accepted > 200 && refused > 200,
        "{accepted} accepted, {refused} refused"
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
            config_script: None,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
            render_mode,
            ir_module,
            slots: Some(slots),
        }
    }

    let ssr = render_page(&config(
        &manifest,
        &slots,
        RenderMode::Phase2SsrReconcile,
        Some(&module),
    ))
    .into_page_response(&PolicyExtensions::new())
    .expect("page");
    // The walk wrote `<p>hello</p>`: its bytes, not the document's.
    assert_eq!(ssr.counts().bytes, "<p>hello</p>".len());

    // A shell walks nothing, and says so.
    let shell = render_page(&config(
        &manifest,
        &slots,
        RenderMode::Phase1ClientMount,
        None,
    ))
    .into_page_response(&PolicyExtensions::new())
    .expect("page");
    assert_eq!(shell.counts().bytes, 0);
    assert_eq!(shell.counts().walk_time, std::time::Duration::ZERO);
}
