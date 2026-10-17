//! The original public startup names carry errors, just like their try_* aliases.
use forma_server::{assets, AssetManifest};
use rust_embed::{Embed, EmbeddedFile};
use std::borrow::Cow;

#[derive(Embed)]
#[folder = "test_fixtures/"]
struct Files;

// Keep the real valid embedded manifest, changing only one failure per case:
// missing, non-UTF8, malformed JSON, legacy schema, incompatible writer.
struct Manifest<const CASE: u8>;
impl<const CASE: u8> Embed for Manifest<CASE> {
    fn get(path: &str) -> Option<EmbeddedFile> {
        if CASE == 0 || path != "manifest.json" {
            return None;
        }
        let mut file = Files::get(path)?;
        match CASE {
            1 => file.data = Cow::Borrowed(b"\xff"),
            2 => file.data = Cow::Borrowed(b"{"),
            3 | 4 => {
                let mut value: serde_json::Value = serde_json::from_slice(&file.data).unwrap();
                if CASE == 3 {
                    value["version"] = 1.into();
                } else {
                    value["writer"] = "4.0.0".into();
                }
                file.data = Cow::Owned(serde_json::to_vec(&value).unwrap());
            }
            _ => {}
        }
        Some(file)
    }

    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        (CASE != 0)
            .then_some(Cow::Borrowed("manifest.json"))
            .into_iter()
    }
}

#[test]
fn text_asset_results_preserve_bytes_and_read_errors() {
    assert_eq!(
        assets::asset::<Files>("style.css").unwrap(),
        "body{color:red}\n"
    );
    assert_eq!(
        assets::asset::<Files>("style.css"),
        assets::try_asset::<Files>("style.css")
    );
    assert_eq!(
        assets::asset::<Files>("missing.txt").unwrap_err(),
        "Missing asset: missing.txt"
    );
    assert_eq!(
        assets::asset::<Manifest<1>>("manifest.json").unwrap_err(),
        "Non-UTF8 asset: manifest.json"
    );
    assert_eq!(
        assets::asset::<Manifest<1>>("manifest.json"),
        assets::try_asset::<Manifest<1>>("manifest.json")
    );
}

fn refuses_before_startup<const CASE: u8>(diagnostic: &str) {
    let mut started = false;
    let result = (|| -> Result<AssetManifest, String> {
        let manifest = assets::load_manifest::<Manifest<CASE>>()?;
        started = true;
        Ok(manifest)
    })();
    assert!(!started, "invalid manifest reached application startup");
    let error = result.unwrap_err();
    assert!(error.contains(diagnostic), "{error}");
    assert_eq!(
        assets::try_load_manifest::<Manifest<CASE>>().unwrap_err(),
        error
    );
}

#[test]
fn manifest_refusals_propagate_before_startup() {
    refuses_before_startup::<0>("Missing asset: manifest.json");
    refuses_before_startup::<1>("Non-UTF8 asset: manifest.json");
    refuses_before_startup::<2>("manifest.json:");
    refuses_before_startup::<3>("MANIFEST-101");
    refuses_before_startup::<4>("MANIFEST-102");
}

#[test]
fn valid_manifest_and_compatibility_alias_keep_the_same_values() {
    let manifest = assets::load_manifest::<Files>().unwrap();
    let alias = assets::try_load_manifest::<Files>().unwrap();
    assert_eq!(manifest.app, "ledger");
    assert_eq!(manifest.build, "fixture");
    assert_eq!(manifest.version, 2);
    assert_eq!(manifest.writer, "3.0.0");
    assert_eq!(manifest.assets.len(), 2);
    assert!(manifest.routes.is_empty());
    assert_eq!(manifest.app, alias.app);
    assert_eq!(
        manifest.assets["style.css"].integrity,
        alias.assets["style.css"].integrity
    );
    assert!(manifest.validate().is_ok());
}
