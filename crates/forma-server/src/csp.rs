use base64::{engine::general_purpose::STANDARD, Engine as _};
use ring::rand::{SecureRandom, SystemRandom};

/// Generate a cryptographically random CSP nonce (base64, 44 chars).
pub fn generate_csp_nonce() -> String {
    let rng = SystemRandom::new();
    let mut bytes = [0u8; 32];
    rng.fill(&mut bytes).expect("RNG failure");
    STANDARD.encode(bytes)
}

/// Build a strict Content-Security-Policy header value.
///
/// Allows scripts and styles only via nonce. No inline, no eval.
pub fn build_csp_header(nonce: &str) -> String {
    format!(
        "default-src 'none'; \
         script-src 'nonce-{nonce}' 'self'; \
         style-src 'nonce-{nonce}' 'self'; \
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

    #[test]
    fn nonce_is_unique() {
        let a = generate_csp_nonce();
        let b = generate_csp_nonce();
        assert_ne!(a, b);
    }

    #[test]
    fn nonce_is_base64() {
        let nonce = generate_csp_nonce();
        assert_eq!(nonce.len(), 44); // 32 bytes -> 44 base64 chars
        assert!(STANDARD.decode(&nonce).is_ok());
    }

    #[test]
    fn csp_contains_nonce() {
        let nonce = generate_csp_nonce();
        let csp = build_csp_header(&nonce);
        assert!(csp.contains(&format!("'nonce-{nonce}'")));
    }

    #[test]
    fn csp_is_strict() {
        let csp = build_csp_header("test");
        assert!(csp.contains("default-src 'none'"));
        assert!(!csp.contains("unsafe-inline"));
        assert!(!csp.contains("unsafe-eval"));
    }
}
