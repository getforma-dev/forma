//! Axum middleware for Forma SSR.
//!
//! Provides page rendering (`render_page`), content-hashed asset serving,
//! CSP headers with cryptographic nonces, an opt-in service worker ([`sw`]), and
//! the Phase 1 (client mount) / Phase 2 (SSR reconcile) rendering pipeline.
//!
//! # Quick Start
//!
//! ```rust,no_run
//! use forma_server::{render_page, PageConfig, RenderMode};
//! ```
//!
//! # Serving a page
//!
//! [`PageOutput`]'s `html` and `csp` are a single unit — the HTML embeds a
//! per-request nonce that only that policy blesses. Send them together with
//! `Cache-Control: no-store` (see [`PageOutput::headers`]) and never cache the
//! HTML across requests.

// Makes README.md's and SECURITY.md's "Zero `unsafe` blocks" a property the
// compiler enforces rather than a claim.
#![forbid(unsafe_code)]

/// Serving content-hashed files out of the embedded `dist` directory.
pub mod assets;
/// Content-Security-Policy construction and nonce generation.
pub mod csp;
/// Loading and version-checking the per-route `.ir` modules at startup.
pub mod ir_compat;
// Documented by its own `//!` docs: an outer `///` line here would merge with
// them and resolve their intra-doc links from the crate root.
pub mod sw;
/// The HTML page template and the SSR render entry points.
pub mod template;
/// Request/response types: page config, manifest, render mode.
pub mod types;

/// Re-exported because it appears in [`assets::asset_bytes`]'s signature.
pub use axum::body::Bytes;
pub use csp::{build_csp_header, generate_csp_nonce, CspNonce, InvalidNonce};
pub use ir_compat::{load_ir_modules, load_ir_modules_strict, IrLoadError};
pub use template::{render_page, render_page_with_nonce};
pub use types::*;
