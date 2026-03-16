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

pub mod assets;
pub mod csp;
pub mod ir_compat;
pub mod sw;
pub mod template;
pub mod types;

pub use ir_compat::{check_ir_compatibility, load_ir_modules};
pub use template::render_page;
pub use types::*;
