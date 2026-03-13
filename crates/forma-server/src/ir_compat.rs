use forma_ir::IR_VERSION;
use forma_ir::parser::IrModule;
use rust_embed::Embed;
use std::collections::HashMap;

use crate::{AssetManifest, RenderMode};

/// Check that an IR module's version is compatible with the current runtime.
pub fn check_ir_compatibility(module: &IrModule) -> Result<(), String> {
    if module.header.version != IR_VERSION {
        return Err(format!(
            "IR version {} is not compatible with runtime version {}",
            module.header.version, IR_VERSION
        ));
    }
    Ok(())
}

/// Load and parse all IR modules from the asset manifest.
///
/// For each route with an `.ir` file, loads the binary from embedded assets,
/// parses it, and checks compatibility. Returns render mode decisions and
/// parsed modules.
///
/// Routes with valid IR get `Phase2SsrReconcile`. Invalid or missing IR
/// falls back to `Phase1ClientMount`.
pub fn load_ir_modules<A: Embed>(
    manifest: &AssetManifest,
) -> (HashMap<String, RenderMode>, HashMap<String, IrModule>) {
    let mut render_modes = HashMap::new();
    let mut ir_modules = HashMap::new();

    for (route_pattern, route_assets) in &manifest.routes {
        if let Some(ref ir_filename) = route_assets.ir {
            if let Some(ir_bytes) = crate::assets::asset_bytes::<A>(ir_filename) {
                match IrModule::parse(&ir_bytes) {
                    Ok(module) => match check_ir_compatibility(&module) {
                        Ok(()) => {
                            tracing::info!(route = %route_pattern, ir_file = %ir_filename, "Loaded IR module for SSR");
                            render_modes
                                .insert(route_pattern.clone(), RenderMode::Phase2SsrReconcile);
                            ir_modules.insert(route_pattern.clone(), module);
                        }
                        Err(e) => {
                            tracing::warn!(route = %route_pattern, error = %e, "IR compatibility check failed — Phase 1 fallback");
                            render_modes
                                .insert(route_pattern.clone(), RenderMode::Phase1ClientMount);
                        }
                    },
                    Err(e) => {
                        tracing::warn!(route = %route_pattern, error = %e, "Failed to parse IR module — Phase 1 fallback");
                        render_modes.insert(route_pattern.clone(), RenderMode::Phase1ClientMount);
                    }
                }
            }
        }
    }

    if !ir_modules.is_empty() {
        tracing::info!(
            ssr_routes = ir_modules.len(),
            "Phase 2 SSR enabled for {} route(s)",
            ir_modules.len()
        );
    }

    (render_modes, ir_modules)
}
