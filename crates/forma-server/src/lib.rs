//! Axum middleware for Forma SSR.
//!
//! Provides page rendering (`render_page`), content-hashed asset serving,
//! CSP headers with cryptographic nonces, service worker handling, and
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

pub mod assets;
pub mod csp;
pub mod ir_compat;
pub mod sw;
pub mod template;
pub mod types;

/// Re-exported because it appears in [`assets::asset_bytes`]'s signature.
pub use axum::body::Bytes;
pub use csp::{build_csp_header, generate_csp_nonce, CspNonce, InvalidNonce};
pub use ir_compat::{load_ir_modules, load_ir_modules_strict, IrLoadError};
pub use template::{render_page, render_page_with_nonce};
pub use types::*;
