//! CSP nonce generation and policy construction: the enforced policy, its
//! typed extensions, and Trusted Types in Report-Only (DR-17, DR-20).

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};
use std::fmt;

/// A validated CSP nonce.
///
/// The nonce is interpolated **unescaped** into HTML attributes
/// (`nonce="{nonce}"` on every script/style tag) and raw into the CSP header
/// value. That is only safe because the value comes from
/// [`CspNonce::generate`], whose base64 alphabet contains nothing that is
/// attribute- or directive-significant. The newtype exists so a caller that
/// supplies its own nonce — which cache-aware callers must, see
/// [`crate::template::render_page_with_nonce`] — cannot hand in
/// `" onload="alert(1)` (attribute breakout on every script tag) or
/// `x' 'unsafe-inline` (rewriting the policy from outside).
///
/// It also makes `generate()` the obvious path, which blunts the other failure
/// mode: a caller hard-coding one static, publicly-known nonce for all users
/// defeats nonce-based CSP entirely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CspNonce(String);

/// Returned by [`CspNonce::parse`] for a value that is not safe to interpolate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidNonce;

impl fmt::Display for InvalidNonce {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid CSP nonce: must be at least 22 characters of [A-Za-z0-9+/=_-]"
        )
    }
}

impl std::error::Error for InvalidNonce {}

/// Returned by [`CspNonce::try_generate`] when the operating system's random
/// source fails: there is no nonce, so there is no page (DR-12).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct NonceError;

impl fmt::Display for NonceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the system random source failed to draw a CSP nonce")
    }
}

impl std::error::Error for NonceError {}

/// Minimum accepted nonce length — 22 base64 characters is 128 bits, the
/// floor the CSP spec recommends for unguessability.
const MIN_NONCE_LEN: usize = 22;

impl CspNonce {
    /// Draw a cryptographically random nonce (32 bytes → 44 base64 chars), or
    /// say that the system random source failed. The render path uses this
    /// one, so a failed draw is a [`crate::RenderError`], not a panic.
    pub fn try_generate() -> Result<Self, NonceError> {
        let rng = SystemRandom::new();
        let mut bytes = [0u8; 32];
        rng.fill(&mut bytes).map_err(|_| NonceError)?;
        Ok(CspNonce(STANDARD.encode(bytes)))
    }

    /// Generate a cryptographically random nonce (32 bytes → 44 base64 chars).
    ///
    /// # Panics
    ///
    /// If the system random source fails, as at 0.2.1; its signature has no
    /// room for the error. [`CspNonce::try_generate`] returns it instead.
    #[allow(clippy::panic)] // the 0.2.1 signature; `try_generate` is the fallible one
    pub fn generate() -> Self {
        match Self::try_generate() {
            Ok(nonce) => nonce,
            Err(error) => panic!("{error}"),
        }
    }

    /// Validate a caller-supplied nonce.
    ///
    /// Accepts the base64 and base64url alphabets only; anything that could
    /// break out of an HTML attribute or a CSP directive is rejected.
    pub fn parse(value: &str) -> Result<Self, InvalidNonce> {
        if value.len() < MIN_NONCE_LEN {
            return Err(InvalidNonce);
        }
        if !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'_' | b'-'))
        {
            return Err(InvalidNonce);
        }
        Ok(CspNonce(value.to_string()))
    }

    /// The nonce value, for use in a `nonce="..."` attribute.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CspNonce {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Generate a cryptographically random CSP nonce (base64, 44 chars).
///
/// Alias for [`CspNonce::generate`].
pub fn generate_csp_nonce() -> CspNonce {
    CspNonce::generate()
}

/// The strict policy's directives, in the order [`build_csp_header`] writes
/// them, for a nonce. One table, so the plain header and an extended one can
/// never disagree about the base.
fn strict_directives(nonce: &str) -> [(&'static str, Vec<String>); 12] {
    let nonce_source = format!("'nonce-{nonce}'");
    let words = |w: &[&str]| w.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    [
        ("default-src", words(&["'none'"])),
        (
            "script-src",
            vec![
                nonce_source.clone(),
                "'strict-dynamic'".to_string(),
                "'self'".to_string(),
            ],
        ),
        ("style-src", vec![nonce_source, "'self'".to_string()]),
        ("style-src-attr", words(&["'unsafe-inline'"])),
        ("worker-src", words(&["'self'"])),
        ("object-src", words(&["'none'"])),
        ("connect-src", words(&["'self'"])),
        ("img-src", words(&["'self'", "data:"])),
        ("font-src", words(&["'self'"])),
        ("frame-ancestors", words(&["'none'"])),
        ("base-uri", words(&["'none'"])),
        ("form-action", words(&["'self'"])),
    ]
}

/// Write a policy from its directives: `name source source; name ...`.
fn write_policy<'a>(directives: impl IntoIterator<Item = (&'a str, &'a [String])>) -> String {
    let mut out = String::with_capacity(512);
    for (name, sources) in directives {
        if !out.is_empty() {
            out.push_str("; ");
        }
        out.push_str(name);
        for source in sources {
            out.push(' ');
            out.push_str(source);
        }
    }
    out
}

/// Build a strict Content-Security-Policy header value.
///
/// Policy notes, because "strict CSP" is easy to claim and easy to get wrong:
///
/// * `script-src` carries `'strict-dynamic'`. Without it a browser keeps
///   honouring the `'self'` host-source alongside the nonce, so any
///   same-origin URL that reflects attacker-controlled bytes (a JSON API, an
///   uploaded file, an error page) can be loaded as `<script src>` and the
///   nonce buys nothing. `'self'` is retained for engines that do not
///   understand `'strict-dynamic'` — they ignore the unknown keyword and fall
///   back to today's behavior.
/// * `worker-src 'self'` is explicit because `'strict-dynamic'` does not cover
///   workers. The inheritance chain is worker-src → child-src → script-src →
///   default-src, so the service worker used to load via script-src's
///   `'self'`; neutralizing `'self'` therefore requires stating it here.
/// * `style-src-attr 'unsafe-inline'` permits inline `style=""` ATTRIBUTES.
///   Per CSP, a nonce in `style-src` drops `unsafe-inline` semantics, and a
///   nonce cannot be attached to an attribute — so the nonce-only policy
///   silently broke every component compiled with a `style:` binding, i.e. the
///   framework's own compiler output. `style-src-elem` still falls back to the
///   nonce-locked `style-src`, so `<style>` blocks and `<link rel=stylesheet>`
///   stay strict.
///
///   Browser support: `style-src-attr` is CSP3 (Chrome/Edge 75+, Firefox 74+,
///   Safari 15.4+). Older engines ignore the unknown directive and fall back
///   to `style-src`, so attribute styles stay blocked there — a fail-closed
///   degradation to the previous behavior, not a security regression.
/// * `object-src 'none'` is explicit defence in depth: it inherits from
///   `default-src 'none'` today, but that stops being true the moment
///   `default-src` is loosened.
pub fn build_csp_header(nonce: &CspNonce) -> String {
    let directives = strict_directives(nonce.as_str());
    write_policy(directives.iter().map(|(n, s)| (*n, s.as_slice())))
}

// ---------------------------------------------------------------------------
// Trusted Types, Report-Only (DR-20) and the reporting endpoint
// ---------------------------------------------------------------------------

/// The Trusted Types directives (DR-20): every write to a script-carrying
/// DOM sink must pass a Trusted Type, and only Forma's two policies may make
/// one: `forma` (`trustedHtml`, the raw entry, DR-19) and `forma-runtime` (the
/// zero-build runtime's parser). No `'allow-duplicates'`: a second copy of
/// core creating `forma` is itself a violation (TH18).
///
/// In 0.2.2 they are sent in `Content-Security-Policy-Report-Only`, beside
/// the unchanged enforced policy, for one release; 3.0.0 enforces them.
const TRUSTED_TYPES: [(&str, &[&str]); 2] = [
    ("require-trusted-types-for", &["'script'"]),
    ("trusted-types", &["forma", "forma-runtime"]),
];

/// The reporting group a named endpoint gets in `Reporting-Endpoints`, and
/// the `report-to` directive's value.
pub(crate) const REPORTING_GROUP: &str = "forma-csp";

/// Where a page's violations go, and how they are asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Reporting {
    /// `report-to` with `Reporting-Endpoints`, and `report-uri`
    /// ([`PolicyExtensions::report_to`]).
    Both(String),
    /// `report-uri` alone ([`PolicyExtensions::report_uri`]).
    UriOnly(String),
}

impl Reporting {
    fn endpoint(&self) -> &str {
        match self {
            Reporting::Both(endpoint) | Reporting::UriOnly(endpoint) => endpoint,
        }
    }

    /// The method that named it, for a refusal.
    fn method(&self) -> &'static str {
        match self {
            Reporting::Both(_) => "report-to",
            Reporting::UriOnly(_) => "report-uri",
        }
    }

    /// The reporting directives each policy carries.
    fn directives(&self) -> Vec<(&'static str, Vec<String>)> {
        let uri = ("report-uri", vec![self.endpoint().to_string()]);
        match self {
            Reporting::Both(_) => vec![("report-to", vec![REPORTING_GROUP.to_string()]), uri],
            Reporting::UriOnly(_) => vec![uri],
        }
    }
}

/// The Report-Only policy: the Trusted Types directives, then the reporting
/// directives when an endpoint is named.
fn report_only_text(reporting: Option<&Reporting>) -> String {
    let mut directives: Vec<(&str, Vec<String>)> = TRUSTED_TYPES
        .iter()
        .map(|(name, sources)| (*name, sources.iter().map(|s| s.to_string()).collect()))
        .collect();
    if let Some(reporting) = reporting {
        directives.extend(reporting.directives());
    }
    write_policy(directives.iter().map(|(n, s)| (*n, s.as_slice())))
}

/// The Report-Only policy a page without a reporting endpoint carries.
pub(crate) fn report_only_policy() -> String {
    report_only_text(None)
}

// ---------------------------------------------------------------------------
// Typed extensions (DR-17, L-38)
// ---------------------------------------------------------------------------

/// What a handler may add to a page's policy, and nothing else.
///
/// The strict policy ([`build_csp_header`]) is the floor. A page that needs
/// another image or frame source, a form target, or a login popup adds it
/// here; it cannot remove a directive, loosen `script-src` or `style-src`,
/// or write the policy as text. The same builder names the application's
/// reporting endpoint ([`PolicyExtensions::report_to`]) and relaxes Trusted
/// Types on a route ([`PolicyExtensions::relax_trusted_types`], DR-20). A [`crate::PageResponse`] applies the
/// extensions when it is made, and an invalid one fails the page with a
/// [`PolicyError`] instead of reaching a header (DR-17, SR5).
///
/// Each source must be one CSP source expression: `'self'`, a scheme
/// (`https:`, `blob:`, `data:`, `wss:`), or a host (`cdn.example.com`,
/// `https://*.example.com:8443/images/`). Nonces, hashes, `'none'`,
/// `'unsafe-*'`, `'strict-dynamic'`, a bare `*`, and anything carrying `;`,
/// `,`, a quote or whitespace are refused: each of those either loosens script
/// execution or injects a directive. So are the `javascript` and `vbscript`
/// schemes in either form (`javascript:`, `javascript://host`), and `data:` and
/// `filesystem:` as a frame or form target.
///
/// ```
/// use forma_server::PolicyExtensions;
///
/// // A console showing pasted logo URLs and a same-origin preview frame.
/// let console = PolicyExtensions::new().img_src("https:").frame_src("'self'");
/// // A login page posting to an identity provider in a popup.
/// let login = PolicyExtensions::new()
///     .form_action("https://idp.example.com")
///     .allow_popups();
/// # let _ = (console, login);
/// ```
///
/// Verified by: crates/forma-server/tests/page_response.rs > "no_policy_extension_yields_a_response_without_the_policy"
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PolicyExtensions {
    img_src: Vec<String>,
    frame_src: Vec<String>,
    form_action: Vec<String>,
    allow_popups: bool,
    reporting: Option<Reporting>,
    relax_trusted_types: Option<String>,
}

impl PolicyExtensions {
    /// No extensions: the strict policy and `Cross-Origin-Opener-Policy:
    /// same-origin`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Allow images from `source` too (`img-src` keeps `'self' data:`).
    #[must_use]
    pub fn img_src(mut self, source: impl Into<String>) -> Self {
        self.img_src.push(source.into());
        self
    }

    /// Allow frames from `source`. The strict policy names no `frame-src`, so
    /// frames fall back to `default-src 'none'`; the first extension adds the
    /// directive.
    #[must_use]
    pub fn frame_src(mut self, source: impl Into<String>) -> Self {
        self.frame_src.push(source.into());
        self
    }

    /// Allow forms on this page to submit to `source` too (`form-action`
    /// keeps `'self'`).
    #[must_use]
    pub fn form_action(mut self, source: impl Into<String>) -> Self {
        self.form_action.push(source.into());
        self
    }

    /// Send `Cross-Origin-Opener-Policy: same-origin-allow-popups` instead of
    /// `same-origin`, so a popup this page opens (an OAuth login) keeps its
    /// `window.opener`. The page itself stays isolated from its own opener.
    #[must_use]
    pub fn allow_popups(mut self) -> Self {
        self.allow_popups = true;
        self
    }

    /// Send this page's policy violations to `endpoint`, an endpoint the
    /// application runs (DR-20, SR8), for pages served over HTTPS. Name it
    /// once, on the `PolicyExtensions` every route starts from, so no page
    /// leaves without it.
    ///
    /// `endpoint` is a path on the application's own origin (`/csp-reports`,
    /// the usual choice), an `https://` URL, or, in a development build only
    /// (`cfg(debug_assertions)`), an `http://` URL on `localhost`,
    /// `127.0.0.1` or `[::1]`: deployed, a loopback endpoint would send each
    /// visitor's reports to the visitor's own machine, so a release build
    /// refuses it like any invalid endpoint. An absolute URL's authority is
    /// a host (letters, digits, `.` and `-`, or a bracketed IPv6 address) and
    /// an optional port of digits, never userinfo: a credential written there
    /// would go to every visitor. It is written into both policies,
    /// the enforced one and the Trusted Types Report-Only one, twice over:
    ///
    /// - `report-to forma-csp`, with a `Reporting-Endpoints: forma-csp="<endpoint>"`
    ///   header: the Reporting API (Chrome and Edge 96+, Safari 16.4+, Firefox
    ///   149+ for CSP), which POSTs `application/reports+json` batches, an
    ///   array of `{"type": "csp-violation", "body": {..}}`;
    /// - `report-uri <endpoint>`, for engines without `report-to` for CSP
    ///   (Firefox before 149), which POST one `application/csp-report`
    ///   document per violation. An engine with `report-to` ignores it.
    ///
    /// So the endpoint accepts both bodies. A cross-origin endpoint must also
    /// answer CORS preflights; a same-origin path needs none. Browsers send
    /// reports outside the page, so the policy's `connect-src` does not apply.
    ///
    /// **Over plain HTTP, `http://localhost` included, use
    /// [`PolicyExtensions::report_uri`].** Chrome and Firefox take
    /// `Reporting-Endpoints` only from an HTTPS page, and once a policy names
    /// `report-to` they ignore `report-uri`, so a page served over plain HTTP
    /// with both reports nothing to the endpoint. That holds on
    /// `http://localhost` too, although it is a secure context, so in
    /// development name the endpoint with `report_uri`. Measured with Chrome
    /// 155 and 156 and Firefox Nightly 155 (this PR and its review): the same
    /// page and endpoint over HTTP, on `localhost` or another host, sent no
    /// report; over HTTPS each sent one `application/reports+json` report and
    /// no `report-uri` copy.
    ///
    /// **The endpoint's obligations are the application's (SR8, L-38):**
    ///
    /// - Store each report's URLs (`documentURL` / `document-uri`,
    ///   `blockedURL` / `blocked-uri`, `referrer`, `sourceFile`) **without
    ///   their query strings or fragments**: they can carry tokens and
    ///   personal data. A Trusted Types report's `sample` / `script-sample`
    ///   holds the first characters of the value written to the sink, so
    ///   treat it as personal data too.
    /// - Bound each report's size (refuse a body over, say, 64 KiB) and the
    ///   rate it accepts (per client and in total): anyone can POST to it.
    /// - Alert **per route and directive above a baseline**, deduplicated:
    ///   never a ticket per report. One page in a loop sends thousands.
    ///
    /// Without an endpoint, a violation of either policy is reported only in
    /// the browser's console, as in 0.2.1, and the enforced policy is
    /// byte-identical to 0.2.1's. An endpoint that is empty, carries `;`,
    /// `,`, a quote, a backslash, whitespace, a fragment or a non-ASCII byte,
    /// starts with `//`, or uses another scheme fails the page with a
    /// [`PolicyError`] for `report-to`. The last of `report_to` and
    /// `report_uri` called is the one written.
    ///
    /// ```
    /// use forma_server::PolicyExtensions;
    ///
    /// // At start: every route's policy starts from this one.
    /// let base = PolicyExtensions::new().report_to("/csp-reports");
    /// // A route that also needs a frame source.
    /// let preview = base.clone().frame_src("'self'");
    /// # let _ = preview;
    /// ```
    ///
    /// Verified by: crates/forma-server/tests/trusted_types_report_only.rs > "a_named_endpoint_is_written_into_both_policies_and_reporting_endpoints"
    #[must_use]
    pub fn report_to(mut self, endpoint: impl Into<String>) -> Self {
        self.reporting = Some(Reporting::Both(endpoint.into()));
        self
    }

    /// Send this page's policy violations to `endpoint` through `report-uri`
    /// alone, for pages served over plain HTTP: a development server on
    /// `http://localhost`, a CI run. Every current engine sends a
    /// `report-uri` report from an HTTP page (one `application/csp-report`
    /// POST per violation), where Chrome and Firefox send none for
    /// [`PolicyExtensions::report_to`]'s pair, on `http://localhost` too. The
    /// same endpoint rules and obligations apply; a refusal is a
    /// [`PolicyError`] for `report-uri`.
    ///
    /// ```
    /// use forma_server::PolicyExtensions;
    ///
    /// let served_over_https = false; // the application's own setting
    /// let base = if served_over_https {
    ///     PolicyExtensions::new().report_to("/csp-reports")
    /// } else {
    ///     PolicyExtensions::new().report_uri("/csp-reports")
    /// };
    /// # let _ = base;
    /// ```
    ///
    /// Verified by: crates/forma-server/tests/trusted_types_report_only.rs > "a_named_endpoint_is_written_into_both_policies_and_reporting_endpoints"
    #[must_use]
    pub fn report_uri(mut self, endpoint: impl Into<String>) -> Self {
        self.reporting = Some(Reporting::UriOnly(endpoint.into()));
        self
    }

    /// Relax Trusted Types on this route, for a page whose string sinks have
    /// not moved to `trustedHtml` yet (DR-20's bridge). One of SR8's
    /// allowlisted exits: each call belongs on the application's allowlist
    /// with an owner and an end date, and `reason` should name them.
    ///
    /// What it does: in 0.2.x Trusted Types are Report-Only on every route,
    /// so the headers do not change; from 3.0.0, when the other routes
    /// enforce Trusted Types, this route keeps them Report-Only. Either way
    /// its violations are still reported, so the sinks left to move stay
    /// visible. A relaxed route is logged, once per route and reason per
    /// process, as a `tracing` warning naming the route and `reason`;
    /// `route_pattern` must be the route's pattern (`/users/:id`), not a
    /// request's path, and the log stops naming new pairs past 1,024. An
    /// empty `reason` fails the page with a [`PolicyError`] for
    /// `trusted-types`.
    ///
    /// ```
    /// use forma_server::PolicyExtensions;
    ///
    /// let studio = PolicyExtensions::new()
    ///     .report_to("/csp-reports")
    ///     .relax_trusted_types("app.ts writes innerHTML in four places; owner: studio, until 2027-01-31");
    /// # let _ = studio;
    /// ```
    ///
    /// Verified by: crates/forma-server/tests/trusted_types_report_only.rs > "a_relaxed_route_keeps_reporting_and_is_logged_once_per_route_and_reason"
    #[must_use]
    pub fn relax_trusted_types(mut self, reason: impl Into<String>) -> Self {
        self.relax_trusted_types = Some(reason.into());
        self
    }
}

/// An extension [`PolicyExtensions`] refused: the page fails instead of
/// going out with a policy nobody meant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyError {
    directive: &'static str,
    source: String,
    reason: &'static str,
}

impl PolicyError {
    /// A `PageOutput::csp` edited as text, refused by the bridge.
    pub(crate) fn edited_as_text(csp: String) -> Self {
        PolicyError {
            directive: "content-security-policy",
            source: csp,
            reason: "the policy was edited as text; express the edit as PolicyExtensions",
        }
    }

    /// The directive the source was added to, such as `img-src`, or
    /// `content-security-policy` for a whole policy edited as text.
    pub fn directive(&self) -> &'static str {
        self.directive
    }

    /// The source expression as the handler wrote it (the whole policy text,
    /// for one edited as text).
    pub fn source_expression(&self) -> &str {
        &self.source
    }

    /// Why it was refused.
    pub fn reason(&self) -> &'static str {
        self.reason
    }
}

impl fmt::Display for PolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid {} extension {:?}: {}",
            self.directive, self.source, self.reason
        )
    }
}

impl std::error::Error for PolicyError {}

/// A page's policy after its extensions: the two header values a page
/// response writes from it.
#[derive(Debug, Clone)]
///
/// Its fields are private to this module, so a policy is made only here, by
/// [`page_policy`] (the strict policy, extended) or [`frame_policy`] (the
/// preview frame's): no other code can write one, which is what makes
/// `PageResponse::frame` the only response whose policy is rewritten.
pub(crate) struct PagePolicy {
    /// `Content-Security-Policy`.
    csp: axum::http::HeaderValue,
    /// `Content-Security-Policy-Report-Only`: Trusted Types (DR-20).
    report_only: axum::http::HeaderValue,
    /// `Reporting-Endpoints`, when the extensions name an endpoint.
    reporting_endpoints: Option<axum::http::HeaderValue>,
    /// Why Trusted Types are relaxed on this route, when they are.
    relaxed: Option<String>,
    /// `Cross-Origin-Opener-Policy`.
    opener: axum::http::HeaderValue,
}

impl PagePolicy {
    /// `Content-Security-Policy`.
    pub(crate) fn csp(&self) -> &axum::http::HeaderValue {
        &self.csp
    }

    /// `Content-Security-Policy-Report-Only`.
    pub(crate) fn report_only(&self) -> &axum::http::HeaderValue {
        &self.report_only
    }

    /// `Reporting-Endpoints`, when an endpoint is named.
    pub(crate) fn reporting_endpoints(&self) -> Option<&axum::http::HeaderValue> {
        self.reporting_endpoints.as_ref()
    }

    /// Why Trusted Types are relaxed, when they are.
    pub(crate) fn relaxed(&self) -> Option<&str> {
        self.relaxed.as_deref()
    }

    /// `Cross-Origin-Opener-Policy`.
    pub(crate) fn opener(&self) -> &axum::http::HeaderValue {
        &self.opener
    }
}

/// The strict policy for `nonce` with `extensions` applied, or the first
/// refused extension.
pub(crate) fn page_policy(
    nonce: &CspNonce,
    extensions: &PolicyExtensions,
) -> Result<PagePolicy, PolicyError> {
    let added: [(&'static str, &[String]); 3] = [
        ("img-src", &extensions.img_src),
        ("frame-src", &extensions.frame_src),
        ("form-action", &extensions.form_action),
    ];
    for (directive, sources) in added {
        for source in sources {
            check_source(directive, source)?;
        }
    }
    if let Some(reporting) = &extensions.reporting {
        check_endpoint(reporting.method(), reporting.endpoint())?;
    }
    if let Some(reason) = &extensions.relax_trusted_types {
        if reason.trim().is_empty() {
            return Err(PolicyError {
                directive: "trusted-types",
                source: reason.clone(),
                reason: "a relaxation names why, and on the allowlist its owner and end date",
            });
        }
    }

    let mut directives: Vec<(&'static str, Vec<String>)> =
        strict_directives(nonce.as_str()).into_iter().collect();
    for (directive, sources) in added {
        if sources.is_empty() {
            continue;
        }
        let index = match directives.iter().position(|(n, _)| *n == directive) {
            Some(index) => index,
            None => {
                directives.push((directive, Vec::new()));
                directives.len() - 1
            }
        };
        if let Some((_, list)) = directives.get_mut(index) {
            for source in sources {
                if !list.contains(source) {
                    list.push(source.clone());
                }
            }
        }
    }

    let reporting = extensions.reporting.as_ref();
    if let Some(reporting) = reporting {
        directives.extend(reporting.directives());
    }

    // Unreachable for sources and an endpoint the checks accepted, which are
    // visible ASCII; kept as an error so that no path drops a header.
    let header = |directive: &'static str, text: String| {
        axum::http::HeaderValue::from_str(&text).map_err(|_| PolicyError {
            directive,
            source: text,
            reason: "not a valid header value",
        })
    };
    let csp = header(
        "content-security-policy",
        write_policy(directives.iter().map(|(n, s)| (*n, s.as_slice()))),
    )?;
    let report_only = header(
        "content-security-policy-report-only",
        report_only_text(reporting),
    )?;
    let reporting_endpoints = match reporting {
        Some(Reporting::Both(endpoint)) => Some(header(
            "report-to",
            format!("{REPORTING_GROUP}=\"{endpoint}\""),
        )?),
        Some(Reporting::UriOnly(_)) | None => None,
    };
    let opener = axum::http::HeaderValue::from_static(if extensions.allow_popups {
        "same-origin-allow-popups"
    } else {
        "same-origin"
    });
    Ok(PagePolicy {
        csp,
        report_only,
        reporting_endpoints,
        relaxed: extensions.relax_trusted_types.clone(),
        opener,
    })
}

/// How many distinct (route, reason) relaxations are logged before the log
/// stops naming new ones: a bound on the set the log keeps.
const RELAXATIONS_LOGGED: usize = 1024;

/// Log a render of a route whose Trusted Types are relaxed: once per route
/// and reason per process, so a busy route does not flood the log. `route`
/// is `None` for a page made by `PageOutput::into_page_response`, which does
/// not know its route; its relaxations are told apart by their reasons.
///
/// After a pair's first render this takes the lock, finds the pair and
/// allocates nothing. The set is bounded: past [`RELAXATIONS_LOGGED`] pairs
/// (an application passing request paths, not route patterns, as
/// `route_pattern` would get there) one warning says so and later new pairs
/// are not logged.
///
/// Verified by: crates/forma-server/tests/trusted_types_report_only.rs > "a_relaxed_route_keeps_reporting_and_is_logged_once_per_route_and_reason"
pub(crate) fn log_relaxation(route: Option<&str>, reason: &str) {
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::Mutex;
    struct Logged {
        pairs: BTreeMap<String, BTreeSet<String>>,
        count: usize,
    }
    static LOGGED: Mutex<Logged> = Mutex::new(Logged {
        pairs: BTreeMap::new(),
        count: 0,
    });
    let route = route.unwrap_or("(a page made by PageOutput::into_page_response)");
    // Nothing panics while holding the lock; a poisoned set is still a set.
    let mut logged = LOGGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if logged
        .pairs
        .get(route)
        .is_some_and(|reasons| reasons.contains(reason))
    {
        return;
    }
    if logged.count > RELAXATIONS_LOGGED {
        return;
    }
    logged.count += 1;
    if logged.count > RELAXATIONS_LOGGED {
        tracing::warn!(
            "Trusted Types relaxed on more than {RELAXATIONS_LOGGED} (route, reason) pairs; \
             further ones are not logged. route_pattern is a route's pattern (/users/:id), \
             not a request's path (DR-20)."
        );
        return;
    }
    logged
        .pairs
        .entry(route.to_string())
        .or_default()
        .insert(reason.to_string());
    drop(logged);
    tracing::warn!(
        route,
        reason,
        "Trusted Types relaxed on route {route}: {reason}. An SR8 allowlist exit: in 0.2.x every \
         route reports them (Report-Only); from 3.0.0 this route keeps reporting while the \
         others enforce (DR-20). Logged once per route and reason per process."
    );
}

/// Accept a reporting endpoint, or say why not: a path on the page's own
/// origin, an `https://` URL, or `http://` on a loopback host for
/// development; written as visible ASCII that cannot end a directive (`;`),
/// split a header list (`,`), close the `Reporting-Endpoints` string (`"`,
/// `\`), or add a source (whitespace, `'`).
fn check_endpoint(directive: &'static str, endpoint: &str) -> Result<(), PolicyError> {
    let refuse = |reason| {
        Err(PolicyError {
            directive,
            source: endpoint.to_string(),
            reason,
        })
    };
    if endpoint.is_empty() {
        return refuse("empty endpoint");
    }
    if endpoint.len() > 2048 {
        return refuse("longer than 2048 bytes");
    }
    // RFC 3986 characters, less `;`, `,` and `'` (and so no quote,
    // backslash, whitespace, control or non-ASCII byte), and no fragment.
    let chars_ok = endpoint.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'.'
                    | b'_'
                    | b'~'
                    | b':'
                    | b'/'
                    | b'?'
                    | b'['
                    | b']'
                    | b'@'
                    | b'!'
                    | b'$'
                    | b'&'
                    | b'('
                    | b')'
                    | b'*'
                    | b'+'
                    | b'='
                    | b'%'
            )
    });
    if !chars_ok {
        return refuse(
            "an endpoint is visible ASCII URL characters, without ';', ',', quotes, a fragment \
             or whitespace",
        );
    }
    if endpoint.starts_with("//") {
        return refuse("a scheme-relative endpoint; write https:// or a path");
    }
    if endpoint.starts_with('/') {
        return Ok(());
    }
    let lower = endpoint.to_ascii_lowercase();
    let (secure, rest) = if let Some(rest) = lower.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = lower.strip_prefix("http://") {
        (false, rest)
    } else {
        return refuse(
            "an endpoint is a path on the page's origin (/csp-reports) or an https:// URL",
        );
    };
    let Some(host) = endpoint_host(rest) else {
        return refuse(
            "an endpoint's authority is a host (letters, digits, '.' and '-', or a bracketed \
             IPv6 address) and an optional port of digits: no userinfo ('@'), nothing else",
        );
    };
    if secure {
        return Ok(());
    }
    if !matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
        return refuse(
            "http:// only on localhost, 127.0.0.1 or [::1]: browsers send reports only to a \
             secure endpoint",
        );
    }
    // A loopback endpoint on a deployed page sends every visitor's reports
    // to the visitor's own machine: allowed in development builds only.
    // Verified by: crates/forma-server/src/csp.rs > "endpoints_accept_a_path_https_or_loopback_http_and_refuse_the_rest"
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        refuse(
            "a loopback http:// endpoint in a release build would send each visitor's reports to \
             their own machine; name a path on the page's origin (/csp-reports) or an https:// URL",
        )
    }
}

/// The host of an absolute endpoint's authority (the text after `scheme://`
/// up to the first `/` or `?`), or `None` when the authority is not a host
/// and an optional port: a reg-name of `[a-z0-9.-]` with no empty label, or
/// a bracketed IPv6 literal with nothing after `]` but a port; a port of one
/// to five digits; never userinfo. `rest` is lower-cased.
fn endpoint_host(rest: &str) -> Option<&str> {
    let authority = rest.split(['/', '?']).next().unwrap_or("");
    if authority.contains('@') {
        return None;
    }
    let (host, port) = if authority.starts_with('[') {
        let close = authority.find(']')?;
        let (host, after) = authority.split_at(close + 1);
        let literal = &host[1..host.len() - 1];
        if literal.parse::<std::net::Ipv6Addr>().is_err() {
            return None;
        }
        match after {
            "" => (host, None),
            _ => (host, Some(after.strip_prefix(':')?)),
        }
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    let host_ok = host.starts_with('[') || is_reg_name(host);
    let port_ok = port.is_none_or(is_port);
    (host_ok && port_ok).then_some(host)
}

/// A host name as an endpoint or origin may write it, already lower-cased:
/// dot-separated labels of `[a-z0-9-]`, none empty and none starting or
/// ending with `-`.
fn is_reg_name(host: &str) -> bool {
    !host.is_empty()
        && host.split('.').all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// A port as an endpoint or origin may write it: digits only (`u16`'s
/// parser would take a `+`), no leading zero (which also refuses 0), and a
/// `u16`.
fn is_port(port: &str) -> bool {
    !port.is_empty()
        && port.bytes().all(|b| b.is_ascii_digit())
        && !port.starts_with('0')
        && port.parse::<u16>().is_ok()
}

// ---------------------------------------------------------------------------
// The preview frame's policy (DR-14 tier (c), L-17, L-27)
// ---------------------------------------------------------------------------

/// The preview frame document's policy: the strict policy with exactly
/// nine directives written in their place, the one exception to SR5's rule
/// against rewriting the policy (L-17, L-27, L-52, SR32):
///
/// - `sandbox allow-scripts`, without `allow-same-origin`: the document gets
///   an opaque origin, so it reaches none of the application's cookies,
///   storage or same-origin windows; scripts may run, and nothing else the
///   sandbox gates (forms, popups, top navigation, downloads);
/// - `frame-ancestors <app_origin>`: only the application's own pages may
///   frame it;
/// - `script-src 'sha256-<runtime>'`: the inline runtime runs, by its hash,
///   and no other script, not one it creates or imports, which a nonce would
///   have let through (a dynamic `import()` inherits its importer's nonce);
/// - `connect-src 'none'`: no `fetch`, XHR, WebSocket, EventSource or beacon;
/// - `img-src data:`, `style-src 'nonce-N'` alone, `font-src 'none'`,
///   `worker-src 'none'` and `form-action 'none'`: in an opaque-origin
///   document CSP's `'self'` still names the application's origin, so the
///   strict policy's `'self'` sources would let markup alone (an `<img>`, a
///   stylesheet, a `url()` in a `style` attribute, a font) send requests to
///   the application, with its `SameSite=None` cookies (L-52).
///
/// The rest are the strict policy's, unchanged: `default-src`, `object-src`
/// and `base-uri 'none'`, and `style-src-attr 'unsafe-inline'` (inline
/// `style` attributes, whose `url()`s `img-src` and `font-src` now confine).
/// Trusted Types are reported as on every page, with no reporting endpoint:
/// an unreviewed document's violations are not the application's reports.
/// The header must be the enforced one: `sandbox` is ignored in Report-Only
/// and in `meta`. `app_origin` is checked by [`check_origin`] first, and
/// `runtime_sha256` is base64; `None` only if a header value could not be
/// made, which those rule out.
///
/// Verified by: crates/forma-server/tests/preview_frame.rs > "the_frame_policy_replaces_exactly_its_nine_directives"
pub(crate) fn frame_policy(
    nonce: &CspNonce,
    runtime_sha256: &str,
    app_origin: &str,
) -> Option<PagePolicy> {
    let mut directives: Vec<(&str, Vec<String>)> =
        strict_directives(nonce.as_str()).into_iter().collect();
    let none = || vec!["'none'".to_string()];
    for (name, sources) in directives.iter_mut() {
        match *name {
            "script-src" => *sources = vec![format!("'sha256-{runtime_sha256}'")],
            "style-src" => *sources = vec![format!("'nonce-{}'", nonce.as_str())],
            "worker-src" | "connect-src" | "font-src" | "form-action" => *sources = none(),
            "img-src" => *sources = vec!["data:".to_string()],
            "frame-ancestors" => *sources = vec![app_origin.to_string()],
            _ => {}
        }
    }
    directives.push(("sandbox", vec!["allow-scripts".to_string()]));
    let csp = write_policy(directives.iter().map(|(n, s)| (*n, s.as_slice())));
    Some(PagePolicy {
        csp: axum::http::HeaderValue::from_str(&csp).ok()?,
        report_only: axum::http::HeaderValue::from_str(&report_only_policy()).ok()?,
        reporting_endpoints: None,
        relaxed: None,
        opener: axum::http::HeaderValue::from_static("same-origin"),
    })
}

/// Accept the application's own origin for the frame's `frame-ancestors`, or
/// say why not: `https://host[:port]`, or `http://` on `localhost`,
/// `127.0.0.1` or `[::1]` for development. An origin has no path, query,
/// userinfo or wildcard, and its host is ASCII letters, digits, `-` and `.`
/// (an IPv6 host only as `[::1]`). Returned in lower case.
pub(crate) fn check_origin(origin: &str) -> Result<String, &'static str> {
    let lower = origin.to_ascii_lowercase();
    let (secure, authority) = if let Some(rest) = lower.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = lower.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err("an origin is https://host[:port], or http:// on a loopback host");
    };
    let (host, port) = if authority.starts_with('[') {
        match authority.split_once(']') {
            Some((v6, rest)) => {
                if !rest.is_empty() && !rest.starts_with(':') {
                    return Err("an origin is a scheme, a host and an optional port, nothing more");
                }
                (format!("{v6}]"), rest.strip_prefix(':'))
            }
            None => return Err("an unclosed IPv6 host"),
        }
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host.to_string(), Some(port)),
            None => (authority.to_string(), None),
        }
    };
    let host_ok = host == "[::1]" || is_reg_name(&host);
    let port_ok = port.is_none_or(is_port);
    if !host_ok || !port_ok {
        return Err("an origin is a scheme, a host and an optional port, nothing more");
    }
    if !secure && !matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
        return Err(
            "http:// only on localhost, 127.0.0.1 or [::1]; serve the application over https",
        );
    }
    Ok(lower)
}

/// Accept one CSP source expression a handler may add, or say why not.
///
/// CSP3's `source-expression` narrowed to what an extension may add:
/// `'self'`, a scheme source, or a host source. Every accepted byte is
/// visible ASCII other than `;`, `,` and `'` (bar `'self'` itself), so an
/// accepted source cannot end its directive, start another, or add a keyword.
fn check_source(directive: &'static str, source: &str) -> Result<(), PolicyError> {
    let refuse = |reason| {
        Err(PolicyError {
            directive,
            source: source.to_string(),
            reason,
        })
    };
    const WILDCARD: &str = "a bare * allows every host; name a scheme (https:) or a host";
    if source.is_empty() {
        return refuse("empty source");
    }
    if source.len() > 1024 {
        return refuse("longer than 1024 bytes");
    }
    if source == "'self'" {
        return Ok(());
    }
    if source.starts_with('\'') {
        return refuse(
            "only 'self' may be added; nonces, hashes, 'none', 'strict-dynamic' and \
             'unsafe-*' stay the policy's own",
        );
    }
    if source == "*" {
        return refuse(WILDCARD);
    }

    // Scheme source: `scheme:` and nothing after.
    if let Some(scheme) = source.strip_suffix(':') {
        if is_scheme(scheme) {
            return match refused_scheme(directive, scheme) {
                Some(reason) => refuse(reason),
                None => Ok(()),
            };
        }
    }

    // Host source: [scheme "://"] host [":" port] [path]. The scheme part is
    // held to the same rules as a scheme source: `javascript://x` is still a
    // script scheme.
    let rest = match source.split_once("://") {
        Some((scheme, rest)) if is_scheme(scheme) => {
            if let Some(reason) = refused_scheme(directive, scheme) {
                return refuse(reason);
            }
            rest
        }
        Some(_) => return refuse("not a CSP source expression"),
        None => source,
    };
    let (authority, path) = match rest.find('/') {
        Some(at) => rest.split_at(at),
        None => (rest, ""),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    if host == "*" {
        return refuse(WILDCARD);
    }
    let labels = host.strip_prefix("*.").unwrap_or(host);
    let host_ok = !labels.is_empty()
        && labels.split('.').all(|label| {
            !label.is_empty()
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        });
    let port_ok = match port {
        None => true,
        Some(p) => p == "*" || (!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())),
    };
    // RFC 3986 path characters, less `;`, `,` and `'`.
    let path_ok = path.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'/' | b'-'
                    | b'.'
                    | b'_'
                    | b'~'
                    | b'%'
                    | b'!'
                    | b'$'
                    | b'&'
                    | b'('
                    | b')'
                    | b'*'
                    | b'+'
                    | b'='
                    | b':'
                    | b'@'
            )
    });
    if host_ok && port_ok && path_ok {
        Ok(())
    } else {
        refuse("not a CSP source expression")
    }
}

/// Why `scheme` (in either source form) may not be added to `directive`, if
/// it may not. Schemes compare without case, as browsers do.
///
/// - `javascript:` and `vbscript:` are never a source.
/// - `data:` and `filesystem:` are not a frame or form target: no consumer
///   frames or posts to them (GateWASM adds `'self'`, Generative UI `blob:`),
///   and each carries content the page chose instead of naming a place.
///   Images may still use `data:`, as the strict policy's own `img-src` does.
fn refused_scheme(directive: &str, scheme: &str) -> Option<&'static str> {
    let scheme = scheme.to_ascii_lowercase();
    if scheme == "javascript" || scheme == "vbscript" {
        return Some("a script scheme is never a source");
    }
    if matches!(directive, "frame-src" | "form-action")
        && (scheme == "data" || scheme == "filesystem")
    {
        return Some("data: and filesystem: are not a frame or form target");
    }
    None
}

/// CSP's `scheme-part`: a letter, then letters, digits, `+`, `-` or `.`.
fn is_scheme(s: &str) -> bool {
    let mut bytes = s.bytes();
    matches!(bytes.next(), Some(b) if b.is_ascii_alphabetic())
        && bytes.all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extract one directive's value from a policy string.
    fn directive<'a>(csp: &'a str, name: &str) -> Option<&'a str> {
        csp.split(';')
            .map(str::trim)
            .find_map(|d| d.strip_prefix(name).filter(|rest| rest.starts_with(' ')))
            .map(str::trim)
    }

    #[test]
    fn nonce_is_unique() {
        let a = generate_csp_nonce();
        let b = generate_csp_nonce();
        assert_ne!(a, b);
    }

    #[test]
    fn try_generate_draws_distinct_44_character_nonces() {
        let a = CspNonce::try_generate().unwrap();
        let b = CspNonce::try_generate().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.as_str().len(), 44);
        assert_eq!(CspNonce::parse(a.as_str()), Ok(a));
    }

    #[test]
    fn nonce_is_base64() {
        let nonce = generate_csp_nonce();
        assert_eq!(nonce.as_str().len(), 44); // 32 bytes -> 44 base64 chars
        assert!(STANDARD.decode(nonce.as_str()).is_ok());
    }

    #[test]
    fn csp_contains_nonce() {
        let nonce = generate_csp_nonce();
        let csp = build_csp_header(&nonce);
        assert!(csp.contains(&format!("'nonce-{nonce}'")));
    }

    #[test]
    fn parse_rejects_attribute_and_directive_breakout() {
        // These are exactly the payloads the newtype exists to stop: the first
        // breaks out of nonce="..." on every script tag, the second rewrites
        // the policy into an unsafe-inline one from outside.
        for bad in [
            "\" onload=\"alert(1)",
            "x' 'unsafe-inline",
            "short",
            "has spaces in it here",
            "semi;colon;value;padding",
        ] {
            assert_eq!(CspNonce::parse(bad), Err(InvalidNonce), "accepted {bad:?}");
        }
    }

    #[test]
    fn parse_accepts_a_generated_nonce() {
        let generated = CspNonce::generate();
        assert_eq!(CspNonce::parse(generated.as_str()), Ok(generated));
    }

    #[test]
    fn build_csp_header_is_byte_identical_to_0_2_1() {
        // `build_csp_header` now writes from the directive table the typed
        // extensions share; the text an application already sends must not
        // move by a byte.
        let nonce = CspNonce::parse("test-nonce-value-0123456789").unwrap();
        assert_eq!(
            build_csp_header(&nonce),
            "default-src 'none'; \
             script-src 'nonce-test-nonce-value-0123456789' 'strict-dynamic' 'self'; \
             style-src 'nonce-test-nonce-value-0123456789' 'self'; \
             style-src-attr 'unsafe-inline'; \
             worker-src 'self'; \
             object-src 'none'; \
             connect-src 'self'; \
             img-src 'self' data:; \
             font-src 'self'; \
             frame-ancestors 'none'; \
             base-uri 'none'; \
             form-action 'self'"
        );
    }

    #[test]
    fn extension_sources_accept_what_consumers_add() {
        // The negative space of the refusals below: every shape GateWASM,
        // Generative UI and a login page need must pass.
        for source in [
            "'self'",
            "https:",
            "http:",
            "blob:",
            "data:",
            "wss:",
            "cdn.example.com",
            "https://cdn.example.com",
            "https://*.example.com",
            "https://cdn.example.com:8443",
            "https://cdn.example.com:*",
            "https://cdn.example.com/images/",
            "https://cdn.example.com/a-b_c~d%20e/f.png",
            "localhost:3000",
            "127.0.0.1:8080",
        ] {
            assert_eq!(check_source("img-src", source), Ok(()), "{source:?}");
        }
    }

    #[test]
    fn extension_sources_refuse_injection_and_loosening() {
        for (source, why) in [
            ("", "empty"),
            ("*", "every host"),
            ("https://*", "every host"),
            ("'none'", "only 'self'"),
            ("'unsafe-inline'", "only 'self'"),
            ("'unsafe-eval'", "only 'self'"),
            ("'unsafe-hashes'", "only 'self'"),
            ("'strict-dynamic'", "only 'self'"),
            ("'nonce-abcdefghijklmnopqrstuv'", "only 'self'"),
            ("'sha256-abc='", "only 'self'"),
            ("'SELF'", "only 'self'"),
            ("javascript:", "script scheme"),
            ("JavaScript:", "script scheme"),
            ("vbscript:", "script scheme"),
            ("javascript://x", "script scheme"),
            ("JAVASCRIPT://x/%0aalert(1)", "script scheme"),
            ("vbscript://x/%0aalert(1)", "script scheme"),
            ("VBScript://x", "script scheme"),
            ("https://a.example; script-src *", "source expression"),
            ("https://a.example;", "source expression"),
            ("https://a.example,b.example", "source expression"),
            ("https://a.example b.example", "source expression"),
            ("https://a.example\tb", "source expression"),
            ("https://a.example\r\nx: y", "source expression"),
            ("https://a.example/'x'", "source expression"),
            ("https://a.example/\"x\"", "source expression"),
            ("https://a..example", "source expression"),
            ("https://a.example:80x", "source expression"),
            ("https://a.example:", "source expression"),
            ("1https://a.example", "source expression"),
            ("ht tp://a.example", "source expression"),
            ("https://", "source expression"),
            ("https://[::1]", "source expression"),
            ("a.example/ü", "source expression"),
        ] {
            let error = check_source("frame-src", source).expect_err(source);
            assert_eq!(error.directive(), "frame-src");
            assert_eq!(error.source_expression(), source);
            assert!(
                error.reason().contains(why),
                "{source:?}: {} should say {why:?}",
                error.reason()
            );
        }
        // Over-long input is refused before it is parsed.
        let long = format!("https://{}.example", "a".repeat(1100));
        assert!(check_source("img-src", &long).is_err());
    }

    #[test]
    fn frame_and_form_targets_refuse_data_and_filesystem() {
        // No consumer frames or posts to them (GateWASM: `'self'`; Generative
        // UI: `blob:`), and both carry content the page chose rather than a
        // place it loads from. Images may still use `data:`, as the strict
        // policy's own `img-src` does.
        for directive in ["frame-src", "form-action"] {
            for source in [
                "data:",
                "DATA:",
                "data://x",
                "filesystem:",
                "FileSystem://x/y",
            ] {
                let error = check_source(directive, source).expect_err(source);
                assert!(
                    error.reason().contains("frame or form"),
                    "{directive} {source:?}: {}",
                    error.reason()
                );
            }
        }
        for (directive, source) in [
            ("img-src", "data:"),
            ("img-src", "blob:"),
            ("frame-src", "blob:"),
            ("frame-src", "'self'"),
            ("frame-src", "https:"),
            ("form-action", "https://idp.example.com"),
        ] {
            assert_eq!(
                check_source(directive, source),
                Ok(()),
                "{directive} {source}"
            );
        }
    }

    #[test]
    fn csp_is_strict() {
        let csp = build_csp_header(&CspNonce::parse("test-nonce-value-0123456789").unwrap());

        assert_eq!(directive(&csp, "default-src"), Some("'none'"));

        // Scripts: nonce + strict-dynamic, never unsafe-*.
        let script = directive(&csp, "script-src").expect("script-src");
        assert!(script.contains("'nonce-"));
        assert!(
            script.contains("'strict-dynamic'"),
            "without strict-dynamic the 'self' host-source is still honoured"
        );
        assert!(!script.contains("unsafe-inline"));
        assert!(!script.contains("unsafe-eval"));

        // Style ELEMENTS stay nonce-locked...
        let style = directive(&csp, "style-src").expect("style-src");
        assert!(style.contains("'nonce-"));
        assert!(!style.contains("unsafe-inline"));

        // ...while style ATTRIBUTES are permitted, because compiled `style:`
        // bindings emit them.
        assert_eq!(directive(&csp, "style-src-attr"), Some("'unsafe-inline'"));
        // No style-src-elem override: the fallback to nonce-locked style-src
        // is what keeps <style> blocks strict.
        assert_eq!(directive(&csp, "style-src-elem"), None);

        // strict-dynamic does not cover workers, so this must be explicit.
        assert_eq!(directive(&csp, "worker-src"), Some("'self'"));
        assert_eq!(directive(&csp, "object-src"), Some("'none'"));

        // SR39: that attribute allowance is the policy's only
        // 'unsafe-inline', in the strict policy and in one extended every way
        // a handler can, reporting endpoint included.
        let nonce = CspNonce::parse("test-nonce-value-0123456789").unwrap();
        let extended = page_policy(
            &nonce,
            &PolicyExtensions::new()
                .img_src("https:")
                .frame_src("'self'")
                .form_action("https://idp.example.com")
                .allow_popups()
                .report_to("/csp-reports")
                .relax_trusted_types("a page not moved yet"),
        )
        .unwrap();
        let extended_csp = extended.csp.to_str().unwrap();
        for policy in [csp.as_str(), extended_csp] {
            assert_eq!(policy.matches("'unsafe-inline'").count(), 1, "{policy}");
            assert_eq!(directive(policy, "style-src-attr"), Some("'unsafe-inline'"));
            assert!(!policy.contains("unsafe-eval") && !policy.contains("unsafe-hashes"));
        }

        // Trusted Types (DR-20), in Report-Only for 0.2.2: both directives,
        // with Forma's two policies and no 'allow-duplicates' (TH18), and no
        // 'unsafe-*' at all. The enforced policy names neither.
        let report_only = report_only_policy();
        assert_eq!(
            report_only,
            "require-trusted-types-for 'script'; trusted-types forma forma-runtime"
        );
        assert_eq!(
            directive(&report_only, "require-trusted-types-for"),
            Some("'script'")
        );
        assert_eq!(
            directive(&report_only, "trusted-types"),
            Some("forma forma-runtime")
        );
        assert!(!report_only.contains("unsafe") && !report_only.contains("allow-duplicates"));
        let extended_report_only = extended.report_only.to_str().unwrap();
        assert!(
            extended_report_only.starts_with(&report_only),
            "{extended_report_only}"
        );
        assert!(!extended_report_only.contains("unsafe"));
        for policy in [csp.as_str(), extended_csp] {
            assert_eq!(directive(policy, "require-trusted-types-for"), None);
            assert_eq!(directive(policy, "trusted-types"), None);
        }
    }

    #[test]
    fn endpoints_accept_a_path_https_or_loopback_http_and_refuse_the_rest() {
        for endpoint in [
            "/csp-reports",
            "/r?app=studio&v=1",
            "/a-b_c.d~e/%20f",
            "https://reports.example.com/csp",
            "HTTPS://Reports.Example.com/x",
            "https://reports.example.com:8443/csp?x=1",
            "https://reports.example.com?app=studio",
            "https://127.0.0.1:8443/csp",
            "https://[2001:db8::1]:8443/csp",
            "https://[::ffff:192.0.2.1]/csp",
            "https://reports.example:65535/csp",
        ] {
            assert_eq!(
                check_endpoint("report-to", endpoint),
                Ok(()),
                "{endpoint:?}"
            );
        }
        // Loopback http:// in development builds only: deployed, it would
        // send each visitor's reports to the visitor's own machine (N5).
        for endpoint in [
            "http://localhost:3000/csp",
            "http://127.0.0.1/csp",
            "http://[::1]:8080/csp",
            "HTTP://LOCALHOST/csp",
        ] {
            let checked = check_endpoint("report-uri", endpoint);
            if cfg!(debug_assertions) {
                assert_eq!(checked, Ok(()), "{endpoint:?}");
            } else {
                let error = checked.expect_err(endpoint);
                assert!(error.reason().contains("release build"), "{error}");
            }
        }
        for endpoint in [
            "",
            "csp-reports",
            "//evil.example/x",
            "http://evil.example/x",
            "http://localhost.evil.example/x",
            "http://localhost@evil.example/x",
            "http://127.0.0.1.evil.example/x",
            "https://",
            "https:///x",
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "data:,x",
            "ftp://reports.example.com/x",
            "/a;script-src *",
            "/a; script-src *",
            "/a,b",
            "/a b",
            "/a\tb",
            "/a\nb",
            "/a\"b",
            "/a'b",
            "/a\\b",
            "/a#frag",
            "/ü",
            "/a<b>",
            // Userinfo would publish a credential to every visitor, and
            // authorities a URL parser refuses would send reports nowhere
            // (review 5517672933, S1).
            "https://user:pw@reports.example/csp",
            "https://user@reports.example",
            "https://@reports.example/csp",
            "http://evil.com@localhost/csp",
            "http://[::1]evil.com",
            "http://[::1",
            "http://localhost:3000]",
            "https://reports.example:8443x",
            "https://reports.example:",
            "https://reports.example:123456",
            "https://%0d%0a",
            "https://]",
            "https://[]",
            "https://[zz::1]",
            "https://[::1]x:80",
            "https://reports..example/csp",
            "https://.example/csp",
            "https://reports_example/csp",
            "https://*.example/csp",
            "https://reports.example:8443:1/csp",
            // Ports as a u16 (no 0, none above 65535, no leading zero) and a
            // bracketed address that `Ipv6Addr` parses.
            "https://reports.example:0/csp",
            "https://reports.example:65536/csp",
            "https://reports.example:00443/csp",
            "https://[::1::2]/csp",
            "https://[12345::1]/csp",
            "https://[::1%25eth0]/csp",
            "https://-/csp",
            "https://-reports.example/csp",
        ] {
            let error = check_endpoint("report-to", endpoint).expect_err(endpoint);
            assert_eq!(error.directive(), "report-to", "{endpoint:?}");
            assert_eq!(error.source_expression(), endpoint);
        }
        let long = format!("/{}", "a".repeat(2048));
        assert!(check_endpoint("report-uri", &long).is_err());
    }
}
