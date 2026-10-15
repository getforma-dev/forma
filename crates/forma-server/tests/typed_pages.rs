//! Actual TypeScript-emitted FMIR -> derived handler -> typed handle -> native renderer.
use forma_ir::PageProps;
use forma_server::{assets::try_load_manifest, load_ir_modules, PageHandle, RenderCtx};
use rust_embed::Embed;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Embed)]
#[folder = "tests/fixtures/props-contract/"]
struct Assets;

#[derive(PageProps)]
struct User {
    active: bool,
    display_name: String,
}
#[derive(PageProps)]
struct Detail {
    label: String,
}
#[derive(PageProps)]
struct Row {
    enabled: bool,
    detail: Detail,
    id: f64,
}
#[derive(PageProps)]
enum Mode {
    #[props(rename = "offline")]
    Offline,
    #[props(rename = "ready")]
    Ready,
}
#[derive(PageProps)]
struct Handler {
    // Intentionally reordered and renamed relative to the emitted TS declaration.
    safe_count: u64,
    title: String,
    user: User,
    rows: Vec<Row>,
    mode: Mode,
    flash: Option<String>,
    nullable: Option<String>,
    at: SystemTime,
    optional_rows: Vec<Option<String>>,
    secret: u64,
}
fn props() -> Handler {
    Handler {
        title: "Handler <title>".into(),
        user: User {
            active: true,
            display_name: "Ada & Bob".into(),
        },
        rows: vec![
            Row {
                id: 7.0,
                detail: Detail {
                    label: "First <row>".into(),
                },
                enabled: true,
            },
            Row {
                id: 8.0,
                detail: Detail {
                    label: "Second".into(),
                },
                enabled: false,
            },
        ],
        mode: Mode::Ready,
        flash: None,
        nullable: Some("notice".into()),
        at: SystemTime::now(),
        safe_count: 42,
        optional_rows: vec![Some("one".into()), None, Some("three".into())],
        secret: u64::MAX,
    }
}
fn handle() -> PageHandle<Handler> {
    let manifest = try_load_manifest::<Assets>().unwrap();
    load_ir_modules::<Assets>(&manifest)
        .unwrap()
        .bind("home")
        .unwrap()
}
fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn actual_compiler_module_binds_by_declared_names_and_renders_two_list_views() {
    assert_send_sync::<PageHandle<Handler>>();
    let handle = handle();
    assert_eq!(handle.route(), "/");
    assert_eq!(
        handle
            .warnings()
            .iter()
            .map(|w| (w.code, w.path.as_str()))
            .collect::<Vec<_>>(),
        [("BIND-201", "secret")]
    );
    let page = handle
        .clone()
        .render(
            &props(),
            &RenderCtx::new()
                .with_title("Request <one>")
                .with_body_class("page\"safe"),
        )
        .unwrap()
        .into_parts_unchecked();
    let html = page.html;
    assert!(
        html.contains("<title>Request &lt;one&gt;</title>"),
        "{html}"
    );
    assert!(html.contains("class=\"page&quot;safe\""), "{html}");
    assert_eq!(html.matches("Handler &lt;title&gt;").count(), 4, "{html}");
    for content in [
        "Ada &amp; Bob",
        "First &lt;row&gt;",
        "Second",
        "local-only",
        "notice",
    ] {
        assert!(html.contains(content), "missing {content}: {html}");
    }
    let mut inactive = props();
    inactive.user.active = false;
    let inactive_html = handle
        .render(&inactive, &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked()
        .html;
    assert_eq!(
        inactive_html.matches("Handler &lt;title&gt;").count(),
        2,
        "{inactive_html}"
    );
    assert!(inactive_html.contains("hidden"), "{inactive_html}");
    assert_eq!(html.matches("<label").count(), 2, "{html}");
    assert_eq!(html.matches("<b>").count(), 2, "{html}");
    assert!(
        !html.contains(&u64::MAX.to_string()),
        "extra unsafe values are not encoded"
    );
    assert!(handle
        .render(&props(), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked()
        .html
        .contains("<title>home</title>"));
}

#[test]
fn every_request_checks_numeric_and_date_bounds_with_declared_paths() {
    let handle = handle();
    let mut value = props();
    value.safe_count = (1u64 << 53) - 1;
    assert!(handle.render(&value, &RenderCtx::new()).is_ok());
    value.safe_count += 1;
    let error = handle.render(&value, &RenderCtx::new()).unwrap_err();
    assert_eq!(
        (error.code(), error.route(), error.property_path()),
        ("RENDER-401", "/", Some("safeCount"))
    );
    value.safe_count = 1;
    value.rows[0].id = f64::NAN;
    let error = handle.render(&value, &RenderCtx::new()).unwrap_err();
    assert_eq!(
        (error.code(), error.property_path()),
        ("RENDER-402", Some("rows[0].id"))
    );
    value.rows[0].id = 7.0;
    value.at = UNIX_EPOCH - Duration::from_nanos(1);
    assert!(handle.render(&value, &RenderCtx::new()).is_ok());
    value.at = UNIX_EPOCH + Duration::from_millis(8_640_000_000_000_001);
    assert_eq!(
        handle.render(&value, &RenderCtx::new()).unwrap_err().code(),
        "RENDER-403"
    );
    value.mode = Mode::Offline;
}

#[derive(PageProps)]
struct Empty {}
#[test]
fn bind_errors_stop_startup_before_listener_and_keep_both_source_positions() {
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    let mut listener_reached = false;
    let mut start = || -> Result<(), Vec<forma_server::PropsError>> {
        let _handle = pages.bind::<Empty>("home")?;
        listener_reached = true;
        Ok(())
    };
    let errors = start().unwrap_err();
    assert!(!listener_reached);
    assert_eq!(errors.len(), 9);
    assert!(errors
        .iter()
        .all(|e| e.code == "BIND-101" && e.typescript.is_some() && e.rust.is_some()));
    let optional = errors.iter().find(|e| e.path == "flash").unwrap();
    assert_eq!(optional.typescript.as_ref().unwrap().file, "page.ts");
    assert_eq!(optional.typescript.as_ref().unwrap().line, 8);
    assert!(optional
        .rust
        .as_ref()
        .unwrap()
        .file
        .ends_with("typed_pages.rs"));
}

#[test]
fn unknown_browser_and_ambiguous_pages_refuse_binding() {
    let mut manifest = try_load_manifest::<Assets>().unwrap();
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    assert_eq!(
        pages.bind::<Handler>("missing").unwrap_err()[0].code,
        "BIND-107"
    );
    assert_eq!(
        pages.bind::<Handler>("/client").unwrap_err()[0].code,
        "BIND-108"
    );
    manifest
        .routes
        .insert("/other".into(), manifest.routes["/"].clone());
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    assert_eq!(
        pages.bind::<Handler>("home").unwrap_err()[0].code,
        "BIND-109"
    );
    assert!(pages.bind::<Handler>("/").is_ok());
    assert!(pages.bind::<Handler>("/other").is_ok());
}

#[cfg(debug_assertions)]
mod reload {
    use super::*;
    use std::{
        borrow::Cow,
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };
    fn files() -> &'static Mutex<HashMap<String, Vec<u8>>> {
        static FILES: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
        FILES.get_or_init(Default::default)
    }
    struct Memory;
    impl Embed for Memory {
        fn get(name: &str) -> Option<rust_embed::EmbeddedFile> {
            let mut file = Assets::get(name).or_else(|| Assets::get("home.ir"))?;
            if let Some(bytes) = files().lock().unwrap().get(name) {
                file.data = Cow::Owned(bytes.clone());
            } else if Assets::get(name).is_none() {
                return None;
            }
            Some(file)
        }
        fn iter() -> impl Iterator<Item = Cow<'static, str>> {
            Assets::iter()
        }
    }
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            files().lock().unwrap().clear();
        }
    }
    fn write(name: &str, bytes: Vec<u8>) {
        files().lock().unwrap().insert(name.into(), bytes);
    }
    fn replace(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        assert_eq!(from.len(), to.len());
        let mut changed = bytes.to_vec();
        let at = changed
            .windows(from.len())
            .position(|part| part == from)
            .unwrap();
        changed[at..at + from.len()].copy_from_slice(to);
        let crc = forma_ir::format::crc32(&[&changed[..18], &changed[22..]]);
        changed[18..22].copy_from_slice(&crc.to_le_bytes());
        forma_ir::IrModule::parse(&changed).unwrap();
        changed
    }
    #[test]
    fn reload_keeps_last_good_files_and_rechecks_new_schema_with_matching_asset_snapshot() {
        let _reset = Reset;
        let original = Assets::get("home.ir").unwrap().data.into_owned();
        let manifest = try_load_manifest::<Memory>().unwrap();
        let handle = load_ir_modules::<Memory>(&manifest)
            .unwrap()
            .bind::<Handler>("home")
            .unwrap();
        assert!(handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html
            .contains("local-only"));
        let mut next: serde_json::Value =
            serde_json::from_slice(&Assets::get("manifest.json").unwrap().data).unwrap();
        next["assets"]["fresh.js"] = serde_json::json!({"immutable":false});
        next["routes"]["/"]["js"] = serde_json::json!(["fresh.js"]);
        write("manifest.json", next.to_string().into_bytes());
        write("home.ir", b"broken".to_vec());
        let previous = handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html;
        assert!(previous.contains("local-only"));
        assert!(
            !previous.contains("fresh.js"),
            "a broken module must keep its previous asset snapshot"
        );
        write("home.ir", replace(&original, b"local-only", b"edited-one"));
        let changed = handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html;
        assert!(changed.contains("edited-one"));
        assert!(changed.contains("fresh.js"));
        write("home.ir", replace(&original, b"title", b"other"));
        let failure = handle.render(&props(), &RenderCtx::new()).unwrap_err();
        assert_eq!(failure.code(), "RENDER-405");
        assert!(failure.to_string().contains("BIND-101"));
        assert!(failure.to_string().contains("other"));
        // Recovery rebinds against the good immutable module; poisoned values from
        // a previous attempt never reach this request.
        write("home.ir", original);
        assert!(handle.render(&props(), &RenderCtx::new()).is_ok());
        next["routes"]["/"]["mode"] = "browser".into();
        next["routes"]["/"].as_object_mut().unwrap().remove("ir");
        write("manifest.json", next.to_string().into_bytes());
        assert_eq!(
            handle
                .render(&props(), &RenderCtx::new())
                .unwrap_err()
                .code(),
            "RENDER-405"
        );
    }
}

#[test]
fn no_parameter_and_typed_empty_pages_bind_without_handler_filling_local_lists() {
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    for name in ["empty", "empty-typed"] {
        let page = pages
            .bind::<Empty>(name)
            .unwrap()
            .render(&Empty {}, &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked();
        assert!(
            page.html.contains(&format!("{name}-local")),
            "{}",
            page.html
        );
        assert!(
            !page.html.contains("<p>"),
            "the unseeded local array starts empty"
        );
    }
}
