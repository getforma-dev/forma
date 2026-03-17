# Security Policy

## Reporting Vulnerabilities

Report security vulnerabilities to **victor@getforma.dev**. Do not open public issues for security reports. We will respond within 48 hours.

## Security Properties

### forma-ir
- All dynamic HTML text and attributes are escaped (`&`, `<`, `>`, `"`)
- Recursion depth limited to 64 (prevents stack overflow from malicious IR)
- List nesting limited to 4 levels
- HTML comment content escaped (`--` → `&#45;&#45;`)
- Script tag props escaped (`</script>` → `<\/script>`)
- Binary parser validates all bounds before reading (no buffer overflows)
- Zero `unsafe` blocks

### forma-server
- CSP headers with 256-bit cryptographic nonces (ring CSPRNG)
- No `unsafe-inline`, no `unsafe-eval` in CSP policy
- Asset serving via `rust-embed` prevents path traversal
- All template interpolations HTML-escaped
- Graceful fallback from Phase 2 SSR to Phase 1 on any error

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x | Yes |
