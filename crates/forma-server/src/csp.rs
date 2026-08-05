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
    let nonce = nonce.as_str();
    format!(
        "default-src 'none'; \
         script-src 'nonce-{nonce}' 'strict-dynamic' 'self'; \
         style-src 'nonce-{nonce}' 'self'; \
         style-src-attr 'unsafe-inline'; \
         worker-src 'self'; \
         object-src 'none'; \
         connect-src 'self'; \
         img-src 'self' data:; \
         font-src 'self'; \
         frame-ancestors 'none'; \
         base-uri 'none'; \
         form-action 'self'"
    )
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
