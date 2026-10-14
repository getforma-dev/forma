//! CSP nonce generation and policy construction.

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

/// Minimum accepted nonce length — 22 base64 characters is 128 bits, the
/// floor the CSP spec recommends for unguessability.
const MIN_NONCE_LEN: usize = 22;

impl CspNonce {
    /// Generate a cryptographically random nonce (32 bytes → 44 base64 chars).
    pub fn generate() -> Self {
        let rng = SystemRandom::new();
        let mut bytes = [0u8; 32];
        rng.fill(&mut bytes).expect("RNG failure");
        CspNonce(STANDARD.encode(bytes))
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
// Typed extensions (DR-17, L-38)
// ---------------------------------------------------------------------------

/// What a handler may add to a page's policy, and nothing else.
///
/// The strict policy ([`build_csp_header`]) is the floor. A page that needs
/// another image or frame source, a form target, or a login popup adds it
/// here; it cannot remove a directive, loosen `script-src` or `style-src`,
/// or write the policy as text. A [`crate::PageResponse`] applies the
/// extensions when it is made, and an invalid one fails the page with a
/// [`PolicyError`] instead of reaching a header (DR-17, SR5).
///
/// Each source must be one CSP source expression: `'self'`, a scheme
/// (`https:`, `blob:`, `data:`, `wss:`), or a host (`cdn.example.com`,
/// `https://*.example.com:8443/images/`). Nonces, hashes, `'none'`,
/// `'unsafe-*'`, `'strict-dynamic'`, a bare `*`, and anything carrying `;`,
/// `,`, a quote or whitespace are refused: each of those either loosens script
/// execution or injects a directive.
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
    /// The directive the source was added to, such as `img-src`.
    pub fn directive(&self) -> &'static str {
        self.directive
    }

    /// The source expression as the handler wrote it.
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
pub(crate) struct PagePolicy {
    /// `Content-Security-Policy`.
    pub(crate) csp: axum::http::HeaderValue,
    /// `Cross-Origin-Opener-Policy`.
    pub(crate) opener: axum::http::HeaderValue,
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

    let text = write_policy(directives.iter().map(|(n, s)| (*n, s.as_slice())));
    let csp = axum::http::HeaderValue::from_str(&text).map_err(|_| PolicyError {
        // Unreachable for sources `check_source` accepted, which are visible
        // ASCII; kept as an error so that no path drops the header.
        directive: "content-security-policy",
        source: text.clone(),
        reason: "not a valid header value",
    })?;
    let opener = axum::http::HeaderValue::from_static(if extensions.allow_popups {
        "same-origin-allow-popups"
    } else {
        "same-origin"
    });
    Ok(PagePolicy { csp, opener })
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
            let scheme = scheme.to_ascii_lowercase();
            return if scheme == "javascript" || scheme == "vbscript" {
                refuse("a script scheme is never a source")
            } else {
                Ok(())
            };
        }
    }

    // Host source: [scheme "://"] host [":" port] [path].
    let rest = match source.split_once("://") {
        Some((scheme, rest)) if is_scheme(scheme) => rest,
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
    }
}
