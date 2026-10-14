//! Axum middleware for Forma SSR.
//!
//! Provides page rendering (`render_page`), content-hashed asset serving,
//! CSP headers with cryptographic nonces, service worker handling, and
//! the Phase 1 (client mount) / Phase 2 (SSR reconcile) rendering pipeline.
//!
//! # Quick Start
//!
//! ```rust,no_run
//! use forma_server::{render_page, PageConfig, PageResponse, PolicyExtensions, RenderMode};
//! ```
//!
//! # Serving a page
//!
//! A page's HTML embeds a per-request nonce that only its policy blesses, so
//! the HTML, the policy and `Cache-Control: no-store` travel together. Send a
//! page as a [`PageResponse`]: as axum's `IntoResponse` it writes all of
//! them, and it cannot be sent without them (DR-17). A handler that needs a
//! looser policy adds typed [`PolicyExtensions`]; it never edits the policy's
//! text.
//!
//! ```rust,no_run
//! # #![allow(deprecated)]
//! use axum::response::{IntoResponse, Response};
//! use axum::http::StatusCode;
//! use forma_server::{render_page, PageConfig, PolicyExtensions};
//!
//! fn home(config: &PageConfig) -> Response {
//!     match render_page(config).into_page_response(&PolicyExtensions::new()) {
//!         Ok(page) => page.into_response(),
//!         Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
//!     }
//! }
//! ```
//!
//! [`PageOutput`]'s public fields and `headers()` are deprecated in 0.2.2 and
//! go private in 3.0.0.

// Makes README.md's and SECURITY.md's "Zero `unsafe` blocks" a property the
// compiler enforces rather than a claim.
#![forbid(unsafe_code)]

/// Serving content-hashed files out of the embedded `dist` directory.
pub mod assets;
/// Content-Security-Policy construction and nonce generation.
pub mod csp;
/// Doctests pinning each deprecation; built only by `cargo test --doc`.
#[cfg(doctest)]
mod deprecations;
/// Loading and version-checking the per-route `.ir` modules at startup.
pub mod ir_compat;
/// The page response: HTML that never leaves without its policy.
pub mod response;
/// The service-worker response and its headers.
pub mod sw;
/// The HTML page template and the SSR render entry points.
pub mod template;
/// Request/response types: page config, manifest, render mode.
pub mod types;

/// Re-exported because it appears in [`assets::asset_bytes`]'s signature.
pub use axum::body::Bytes;
pub use csp::{
    build_csp_header, generate_csp_nonce, CspNonce, InvalidNonce, PolicyError, PolicyExtensions,
};
pub use ir_compat::{load_ir_modules, load_ir_modules_strict, IrLoadError};
pub use response::{PageParts, PageResponse, RenderCounts};
#[allow(deprecated)]
pub use template::{render_page, render_page_with_nonce};
pub use types::*;
