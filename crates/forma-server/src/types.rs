use serde::Deserialize;
use std::collections::HashMap;

/// Per-route render strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    /// Phase 1: empty `<div id="app"></div>`, client JS mounts from scratch.
    Phase1ClientMount,
    /// Phase 2: server renders HTML into `#app` via IR walker, client reconciles.
    Phase2SsrReconcile,
}

/// Configuration for rendering an HTML page with external assets.
pub struct PageConfig<'a> {
    pub title: &'a str,
    pub route_pattern: &'a str,
    pub manifest: &'a AssetManifest,
    /// Optional inline `<script>` content (e.g. window.__CONFIG__ = {...})
    pub config_script: Option<&'a str>,
    pub body_class: Option<&'a str>,
    /// Optional inline `<style>` for personality/theme overrides
    pub personality_css: Option<&'a str>,
    /// Optional extra HTML before `<div id="app">`
    pub body_prefix: Option<&'a str>,
    pub render_mode: RenderMode,
    /// Pre-parsed IR module for Phase 2 SSR
    pub ir_module: Option<&'a forma_ir::parser::IrModule>,
    /// Slot data for Phase 2 SSR
    pub slots: Option<&'a forma_ir::slot::SlotData>,
}

/// Output from render_page: HTML body + CSP header value.
pub struct PageOutput {
    pub html: String,
    pub csp: String,
}

/// Asset manifest loaded from `manifest.json` in the embedded dist directory.
#[derive(Debug, Clone, Deserialize)]
pub struct AssetManifest {
    pub version: u32,
    pub build_hash: String,
    pub assets: HashMap<String, String>,
    pub routes: HashMap<String, RouteAssets>,
    #[serde(default)]
    pub wasm: Option<WasmAssets>,
}

/// Per-route asset references.
#[derive(Debug, Clone, Deserialize)]
pub struct RouteAssets {
    pub js: Vec<String>,
    pub css: Vec<String>,
    pub fonts: Vec<String>,
    pub total_size_br: u64,
    pub budget_warn_threshold: u64,
    #[serde(default)]
    pub ir: Option<String>,
}

/// WASM asset references.
#[derive(Debug, Clone, Deserialize)]
pub struct WasmAssets {
    pub loader: String,
    pub binary: String,
}

impl AssetManifest {
    /// Resolve a logical asset name to its content-hashed filename.
    pub fn resolve<'a>(&'a self, logical_name: &'a str) -> &'a str {
        self.assets
            .get(logical_name)
            .map(|s| s.as_str())
            .unwrap_or(logical_name)
    }

    /// Get route assets for a route pattern.
    pub fn route(&self, pattern: &str) -> Option<&RouteAssets> {
        self.routes.get(pattern)
    }
}
