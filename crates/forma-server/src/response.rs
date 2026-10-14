//! The page response: HTML that never leaves without its policy (DR-17).

use crate::csp::{self, CspNonce, PagePolicy, PolicyError, PolicyExtensions};
use axum::http::{header, HeaderName, HeaderValue};
use axum::response::{IntoResponse, Response};
use std::time::Duration;

/// A rendered page, ready to send.
///
/// As axum's [`IntoResponse`] it always writes, together with the HTML:
///
/// - `Cache-Control: no-store`, because the HTML embeds a nonce minted for
///   this one response; a cached copy would hand that nonce to every later
///   reader, and another user's page with it (INV3, TH3);
/// - `Content-Security-Policy`, the strict policy for that nonce
///   ([`csp::build_csp_header`]) with only the handler's typed
///   [`PolicyExtensions`] added (INV2);
/// - `Content-Security-Policy-Report-Only`: Trusted Types,
///   `require-trusted-types-for 'script'; trusted-types forma forma-runtime`,
///   reported, not enforced, for 0.2.2's release (DR-20), when the
///   extensions name a reporting endpoint ([`PolicyExtensions::report_to`],
///   [`PolicyExtensions::report_uri`]), with the reporting directives in both
///   policies (and, for `report_to`, a `Reporting-Endpoints` header), or, with
///   no endpoint, in a development build only;
/// - `Cross-Origin-Opener-Policy: same-origin` (or `same-origin-allow-popups`
///   when the extensions ask for it), `X-Content-Type-Options`,
///   `Referrer-Policy` and `Permissions-Policy`;
/// - `Content-Type: text/html; charset=utf-8`.
///
/// A handler cannot take the HTML out and send it some other way except
/// through [`PageResponse::into_parts_unchecked`], the one named exit, which
/// a consumer's CI can search for (SR5, SR8):
///
/// ```compile_fail,E0616
/// # fn page() -> forma_server::PageResponse { unimplemented!() }
/// let html = page().html; // private: the HTML leaves only with its headers
/// ```
///
/// ```no_run
/// # fn page() -> forma_server::PageResponse { unimplemented!() }
/// let parts = page().into_parts_unchecked(); // the named, searchable exit
/// # let _ = parts.html;
/// ```
///
/// Verified by: crates/forma-server/tests/page_response.rs > "page_response_writes_no_store_the_policy_and_the_document_headers"
#[derive(Debug)]
pub struct PageResponse {
    html: String,
    nonce: CspNonce,
    policy: PagePolicy,
    counts: RenderCounts,
}

/// What one render did, for the application's own logs and metrics (R14).
///
/// On a [`crate::RenderError`] for a budget or a fault, the same counts say
/// how far the walk got (SR22). For a page served without a walk (a browser
/// shell, or the deprecated `render_page`'s fallback) every count is zero.
/// `nodes` and `list_iterations` are counted by [`crate::try_render`]; a page
/// from the deprecated `render_page` reports them as zero.
///
/// The walk time is the number to watch for moving a page off an async
/// worker: see [`crate::try_render`]'s `spawn_blocking` recipe.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct RenderCounts {
    /// Elements and text nodes the walk wrote (hydration markers and
    /// comments are not nodes).
    pub nodes: usize,
    /// Bytes of HTML the walk wrote into the page's root, the quantity the
    /// walker's output budget (`WalkLimits::max_output_bytes`) bounds; the
    /// document around it is not counted.
    pub bytes: usize,
    /// List rows the walk wrote, across every nesting depth, the quantity
    /// `WalkLimits::max_list_iterations` bounds.
    pub list_iterations: usize,
    /// Time spent in the walk.
    pub walk_time: Duration,
}

impl RenderCounts {
    /// The walker's counts, with the time the walk took.
    pub(crate) fn from_walk(counts: forma_ir::WalkCounts, walk_time: Duration) -> Self {
        RenderCounts {
            nodes: counts.nodes,
            bytes: counts.bytes,
            list_iterations: counts.list_iterations,
            walk_time,
        }
    }
}

/// A page's raw parts, from [`PageResponse::into_parts_unchecked`].
///
/// Whoever sends these owns what [`PageResponse`] guaranteed: every header
/// in `headers` goes out with `html`, and `html` is never cached or sent to a
/// second request.
#[derive(Debug)]
#[non_exhaustive]
pub struct PageParts {
    /// The complete HTML document.
    pub html: String,
    /// The nonce `html` carries and the policy in `headers` blesses.
    pub nonce: CspNonce,
    /// Every header the response would have written, in its order.
    pub headers: Vec<(HeaderName, HeaderValue)>,
    /// What the render did.
    pub counts: RenderCounts,
}

impl PageResponse {
    /// Wrap a rendered document: the policy is built here, from the nonce
    /// the HTML embeds, so the two cannot disagree.
    pub(crate) fn new(
        html: String,
        nonce: CspNonce,
        extensions: &PolicyExtensions,
        counts: RenderCounts,
    ) -> Result<Self, PolicyError> {
        let policy = csp::page_policy(&nonce, extensions)?;
        if let Some(reason) = policy.relaxed() {
            csp::log_relaxation(None, reason);
        }
        Ok(Self::with_policy(html, nonce, policy, counts))
    }

    /// Wrap a rendered document whose policy was built, from the same nonce,
    /// before the walk (so an invalid extension costs no walk).
    pub(crate) fn with_policy(
        html: String,
        nonce: CspNonce,
        policy: PagePolicy,
        counts: RenderCounts,
    ) -> Self {
        PageResponse {
            html,
            nonce,
            policy,
            counts,
        }
    }

    /// What the render did: nodes, bytes and list rows walked, and time spent.
    pub fn counts(&self) -> RenderCounts {
        self.counts
    }

    /// The HTML, its nonce and every header, apart.
    ///
    /// The one way to reach the HTML without sending it as this response. It
    /// exists for the rare handler that must assemble its own response (a
    /// streaming body, a framework other than axum); each call site belongs
    /// on the application's raw-sink allowlist with an owner (SR8).
    pub fn into_parts_unchecked(self) -> PageParts {
        let headers = self.headers();
        PageParts {
            html: self.html,
            nonce: self.nonce,
            headers,
            counts: self.counts,
        }
    }

    /// The headers this response writes, in order.
    fn headers(&self) -> Vec<(HeaderName, HeaderValue)> {
        let mut headers = Vec::with_capacity(9);
        headers.push((
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        ));
        headers.push((header::CACHE_CONTROL, HeaderValue::from_static("no-store")));
        headers.push((header::CONTENT_SECURITY_POLICY, self.policy.csp().clone()));
        if let Some(report_only) = self.policy.report_only() {
            headers.push((
                header::CONTENT_SECURITY_POLICY_REPORT_ONLY,
                report_only.clone(),
            ));
        }
        if let Some(endpoints) = self.policy.reporting_endpoints() {
            headers.push((
                HeaderName::from_static("reporting-endpoints"),
                endpoints.clone(),
            ));
        }
        for (name, value) in crate::types::document_security_headers() {
            // The opener policy is the page's own: the extensions may ask for
            // `same-origin-allow-popups`, and a second COOP header would leave
            // the browser to pick one.
            if name.as_str() != "cross-origin-opener-policy" {
                headers.push((name.clone(), value.clone()));
            }
        }
        headers.push((
            HeaderName::from_static("cross-origin-opener-policy"),
            self.policy.opener().clone(),
        ));
        headers
    }
}

impl IntoResponse for PageResponse {
    fn into_response(self) -> Response {
        let headers = self.headers();
        let mut response = Response::new(axum::body::Body::from(self.html));
        let map = response.headers_mut();
        for (name, value) in headers {
            map.append(name, value);
        }
        response
    }
}
