//! Doctests that pin the `wasm` exports' deprecation (DR-23), compiled only by
//! `cargo test -p forma-ir --doc --features wasm`.
//!
//! As forma-server's: each export has two snippets of the same code, one under
//! `#![allow(deprecated)]` that must compile, proving the 0.2.1 call still
//! works, and one under `#![deny(deprecated)]` that must not, proving the
//! deprecation reaches a caller. Each export also carries
//! `#[allow(deprecated)]`, so wasm-bindgen's generated call to it stays quiet;
//! the `compile_fail` half shows that the allow stops there. The pair is what
//! makes the `compile_fail` honest: the only difference is the lint level.

/// `render`, the WASM walker's page render (DR-23).
///
/// ```
/// #![allow(deprecated)]
/// fn page(ir: &[u8]) -> String { forma_ir::render(ir, "{}") }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn page(ir: &[u8]) -> String { forma_ir::render(ir, "{}") }
/// ```
pub(crate) struct WasmRender;

/// `render_island`, the WASM walker's island render (DR-23).
///
/// ```
/// #![allow(deprecated)]
/// fn island(ir: &[u8]) -> String { forma_ir::render_island(ir, "{}", 0) }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn island(ir: &[u8]) -> String { forma_ir::render_island(ir, "{}", 0) }
/// ```
pub(crate) struct WasmRenderIsland;
