use forma_server::{AssetMetadata, RouteAssets};
/// Metadata-only renderer fixtures model each declared resource as an empty file.
/// Actual embedded-file integrity controls live in asset_integrity.rs.
pub(crate) fn fixture_assets(
    routes: &std::collections::HashMap<String, RouteAssets>,
) -> std::collections::HashMap<String, AssetMetadata> {
    routes
        .values()
        .flat_map(|route| {
            route
                .js
                .iter()
                .chain(&route.css)
                .chain(&route.fonts)
                .chain(&route.modulepreload)
                .chain(route.ir.iter())
        })
        .map(|file| {
            (
                file.clone(),
                AssetMetadata {
                    immutable: false,
                    integrity:
                        "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"
                            .into(),
                    retained: false,
                },
            )
        })
        .collect()
}
