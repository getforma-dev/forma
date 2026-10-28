//! Actual TypeScript-emitted FMIR -> derived handler -> typed handle -> native renderer.
//! The combined list/show/SVG/form canvas contract is in `composition_canvas.rs`.
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
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    let page = pages.bind("home").unwrap();
    bind_empty(&pages);
    pages.finalize().unwrap();
    page
}
fn bind_empty(pages: &forma_server::Pages) {
    pages.bind::<Empty>("empty").unwrap();
    pages.bind::<Empty>("empty-typed").unwrap();
}
fn assert_send_sync<T: Send + Sync>() {}

static SLOW_BIND: std::sync::OnceLock<(
    std::sync::mpsc::SyncSender<()>,
    std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
)> = std::sync::OnceLock::new();
struct SlowEmpty;
impl forma_ir::props::PropValue for SlowEmpty {
    fn describe(
        builder: &mut forma_ir::props::SchemaBuilder,
    ) -> Result<forma_ir::schema::PropType, forma_ir::props::PropsError> {
        let (entered, release) = SLOW_BIND.get().unwrap();
        entered.send(()).unwrap();
        release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        Empty::describe(builder)
    }
    fn encode_value(
        &self,
        context: &forma_ir::props::EncodeContext<'_>,
        kind: &forma_ir::schema::PropType,
        path: &str,
    ) -> Result<Option<serde_json::Value>, forma_ir::props::PropsError> {
        Empty {}.encode_value(context, kind, path)
    }
}
impl forma_ir::PageProps for SlowEmpty {}

#[test]
fn finalization_refuses_a_bind_already_comparing_on_another_thread() {
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    SLOW_BIND
        .set((entered_tx, std::sync::Mutex::new(release_rx)))
        .unwrap();
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    let home = pages.bind::<Handler>("home").unwrap();
    bind_empty(&pages);
    let other = pages.clone();
    let pending = std::thread::spawn(move || other.bind::<SlowEmpty>("empty"));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    pages.finalize().unwrap();
    release_tx.send(()).unwrap();
    let errors = pending.join().unwrap().unwrap_err();
    assert_eq!(errors[0].code, "BIND-111");
    assert_eq!(errors[0].route, "/empty");
    assert!(home.render(&props(), &RenderCtx::new()).is_ok());
    pages.clone().finalize().unwrap();
}

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
    // Both lists remain keyed and validated (FORMA-181), but this no-JS
    // route writes no adoption vocabulary (FORMA-257). `data-enabled` still
    // follows value rule 6: true writes the word, false omits the attribute.
    assert_eq!(html.matches("<b>").count(), 2, "{html}");
    for row in [
        "<label data-enabled=\"true\">First &lt;row&gt;",
        "<label>Second",
        "<b>7</b>",
        "<b>8</b>",
    ] {
        assert!(html.contains(row), "missing {row}: {html}");
    }
    for marker in [
        "<!--f:",
        "data-forma-key",
        "data-island-state",
        "data-forma-build",
        "data-forma-ssr",
    ] {
        assert!(!html.contains(marker), "unexpected {marker}: {html}");
    }
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
    value.at = UNIX_EPOCH
        .checked_sub(Duration::from_millis(1))
        .expect("the millisecond before the Unix epoch is representable");
    assert!(handle.render(&value, &RenderCtx::new()).is_ok());
    // Windows SystemTime cannot represent the JS Date boundary. The private
    // numeric conversion test in forma-ir checks both bounds on every platform;
    // exercise the full typed-render error wherever SystemTime can reach it.
    for negative in [false, true] {
        let outside = Duration::from_millis(8_640_000_000_000_001);
        let date = if negative {
            UNIX_EPOCH.checked_sub(outside)
        } else {
            UNIX_EPOCH.checked_add(outside)
        };
        if let Some(date) = date {
            value.at = date;
            let error = handle.render(&value, &RenderCtx::new()).unwrap_err();
            assert_eq!(
                (error.code(), error.route(), error.property_path()),
                ("RENDER-403", "/", Some("at"))
            );
        }
    }
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
    static SERIAL: Mutex<()> = Mutex::new(());
    fn files() -> &'static Mutex<HashMap<String, Option<Vec<u8>>>> {
        static FILES: OnceLock<Mutex<HashMap<String, Option<Vec<u8>>>>> = OnceLock::new();
        FILES.get_or_init(Default::default)
    }
    struct Memory;
    impl Embed for Memory {
        fn get(name: &str) -> Option<rust_embed::EmbeddedFile> {
            let mut file = Assets::get(name).or_else(|| Assets::get("home.ir"))?;
            if let Some(bytes) = files().lock().unwrap().get(name) {
                file.data = Cow::Owned(bytes.clone()?);
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
        files().lock().unwrap().insert(name.into(), Some(bytes));
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
    fn rejected_or_missing_manifest_freezes_the_entire_pair_until_valid_recovery() {
        let _serial = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let _reset = Reset;
        let original = Assets::get("home.ir").unwrap().data.into_owned();
        let manifest_bytes = Assets::get("manifest.json").unwrap().data.into_owned();
        let manifest = try_load_manifest::<Memory>().unwrap();
        let pages = load_ir_modules::<Memory>(&manifest).unwrap();
        let handle = pages.bind::<Handler>("home").unwrap();
        bind_empty(&pages);
        pages.finalize().unwrap();
        let render = || {
            handle
                .render(&props(), &RenderCtx::new())
                .unwrap()
                .into_parts_unchecked()
                .html
        };
        let mut incompatible: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
        incompatible["writer"] = "4.0.0".into();
        incompatible["assets"]["fresh.js"] = serde_json::json!({"immutable":false,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"});
        incompatible["routes"]["/"]["js"] = serde_json::json!(["fresh.js"]);
        let rejected_candidates = [
            Some(incompatible.to_string().into_bytes()),
            Some(b"{broken".to_vec()),
            None,
        ];
        for rejected in rejected_candidates.clone() {
            write("home.ir", original.clone());
            write("manifest.json", manifest_bytes.clone());
            assert!(render().contains("local-only"));
            files()
                .lock()
                .unwrap()
                .insert("manifest.json".into(), rejected);
            for text in [b"edited-one", b"edited-two"] {
                write("home.ir", replace(&original, b"local-only", text));
                for _ in 0..2 {
                    let html = render();
                    assert!(
                        html.contains("local-only"),
                        "rejected manifest must preserve old IR: {html}"
                    );
                    assert!(!html.contains("edited-"));
                    assert!(
                        !html.contains("fresh.js"),
                        "rejected manifest must preserve old assets"
                    );
                }
            }
            // Restoring exactly the old valid bytes must reopen reload, including
            // after a missing manifest; an unchanged-byte fast path cannot trap it.
            write("manifest.json", manifest_bytes.clone());
            let recovered = render();
            assert!(recovered.contains("edited-two"), "{recovered}");
            assert!(!recovered.contains("fresh.js"));
            let mut valid = incompatible.clone();
            valid["writer"] = "3.0.0".into();
            write("manifest.json", valid.to_string().into_bytes());
            write("home.ir", replace(&original, b"local-only", b"edited-one"));
            let paired = render();
            assert!(paired.contains("edited-one"));
            assert!(paired.contains("fresh.js"));
        }
        // The disk may change after the caller reads its valid startup manifest
        // but before constructing Pages. A refused initial baseline also freezes
        // the caller's loaded pair, rather than blessing subsequent IR-only edits.
        for rejected in rejected_candidates {
            write("home.ir", original.clone());
            files()
                .lock()
                .unwrap()
                .insert("manifest.json".into(), rejected);
            let pages = load_ir_modules::<Memory>(&manifest).unwrap();
            let startup = pages.bind::<Handler>("home").unwrap();
            bind_empty(&pages);
            pages.finalize().unwrap();
            write("home.ir", replace(&original, b"local-only", b"edited-one"));
            let render_startup = || {
                startup
                    .render(&props(), &RenderCtx::new())
                    .unwrap()
                    .into_parts_unchecked()
                    .html
            };
            for _ in 0..2 {
                let frozen = render_startup();
                assert!(frozen.contains("local-only"));
                assert!(!frozen.contains("edited-one"));
            }
            write("manifest.json", manifest_bytes.clone());
            assert!(render_startup().contains("edited-one"));
        }
    }

    #[test]
    fn finalized_topology_refusal_freezes_edited_modules_and_assets_until_compatible_recovery() {
        let _serial = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let _reset = Reset;
        let original = Assets::get("home.ir").unwrap().data.into_owned();
        let manifest_bytes = Assets::get("manifest.json").unwrap().data.into_owned();
        let manifest = try_load_manifest::<Memory>().unwrap();
        let pages = load_ir_modules::<Memory>(&manifest).unwrap();
        let handle = pages.bind::<Handler>("home").unwrap();
        bind_empty(&pages);
        pages.finalize().unwrap();
        let render = || {
            handle
                .render(&props(), &RenderCtx::new())
                .unwrap()
                .into_parts_unchecked()
                .html
        };
        let baseline: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
        // Each independently valid manifest changes only one topology rule.
        for change in ["add", "remove", "ssr-to-browser", "browser-to-ssr"] {
            write("home.ir", original.clone());
            write("manifest.json", manifest_bytes.clone());
            assert!(render().contains("local-only"));
            let mut next = baseline.clone();
            next["assets"]["fresh.js"] = serde_json::json!({"immutable": false,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"});
            next["routes"]["/"]["js"] = serde_json::json!(["fresh.js"]);
            match change {
                "add" => next["routes"]["/added"] = baseline["routes"]["/empty"].clone(),
                "remove" => {
                    next["routes"].as_object_mut().unwrap().remove("/empty");
                }
                "ssr-to-browser" => {
                    next["routes"]["/"]["mode"] = "browser".into();
                    next["routes"]["/"].as_object_mut().unwrap().remove("ir");
                }
                "browser-to-ssr" => {
                    next["routes"]["/client"] = baseline["routes"]["/empty"].clone()
                }
                _ => unreachable!(),
            }
            serde_json::from_value::<forma_server::AssetManifest>(next.clone()).unwrap();
            write("manifest.json", next.to_string().into_bytes());
            for replacement in [b"edited-one", b"edited-two"] {
                write("home.ir", replace(&original, b"local-only", replacement));
                for _ in 0..2 {
                    let html = render();
                    assert!(html.contains("local-only"), "{change}: {html}");
                    assert!(!html.contains("edited-"));
                    assert!(!html.contains("fresh.js"));
                }
            }
            // Restoring the exact prior manifest allows the pending module edit.
            write("manifest.json", manifest_bytes.clone());
            assert!(render().contains("edited-two"));
            // A compatible asset-only build then updates the complete pair.
            let mut compatible = baseline.clone();
            compatible["assets"]["fresh.js"] = serde_json::json!({"immutable": false,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"});
            compatible["routes"]["/"]["js"] = serde_json::json!(["fresh.js"]);
            write("manifest.json", compatible.to_string().into_bytes());
            let html = render();
            assert!(html.contains("edited-two") && html.contains("fresh.js"));
        }
    }

    #[test]
    fn reload_keeps_last_good_files_and_rechecks_new_schema_with_matching_asset_snapshot() {
        let _serial = SERIAL.lock().unwrap_or_else(|p| p.into_inner());
        let _reset = Reset;
        let original = Assets::get("home.ir").unwrap().data.into_owned();
        let manifest = try_load_manifest::<Memory>().unwrap();
        let pages = load_ir_modules::<Memory>(&manifest).unwrap();
        let handle = pages.bind::<Handler>("home").unwrap();
        bind_empty(&pages);
        pages.finalize().unwrap();
        assert!(handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html
            .contains("local-only"));
        let mut next: serde_json::Value =
            serde_json::from_slice(&Assets::get("manifest.json").unwrap().data).unwrap();
        next["assets"]["fresh.js"] = serde_json::json!({"immutable":false,"integrity":"sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"});
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
        let previous = handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html;
        assert!(previous.contains("data-forma-ssr"));
        assert!(
            previous.contains("local-only"),
            "changed route mode must keep the finalized snapshot"
        );
        next["routes"]["/new-ssr"] = next["routes"]["/empty"].clone();
        write("manifest.json", next.to_string().into_bytes());
        assert!(handle
            .render(&props(), &RenderCtx::new())
            .unwrap()
            .into_parts_unchecked()
            .html
            .contains("local-only"));
        assert_eq!(
            pages.bind::<Empty>("/new-ssr").unwrap_err()[0].code,
            "BIND-111"
        );
    }
}

#[test]
fn no_parameter_and_typed_empty_pages_bind_without_handler_filling_local_lists() {
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    pages.bind::<Handler>("home").unwrap();
    let handles: Vec<_> = ["empty", "empty-typed"]
        .into_iter()
        .map(|name| (name, pages.bind::<Empty>(name).unwrap()))
        .collect();
    pages.finalize().unwrap();
    for (name, handle) in handles {
        let page = handle
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

#[test]
fn finalization_refuses_every_unbound_route_without_partly_sealing_then_repairs() {
    let manifest = try_load_manifest::<Assets>().unwrap();
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    assert!(pages.bind::<Empty>("home").is_err());
    let errors = pages.finalize().unwrap_err();
    assert_eq!(
        errors
            .iter()
            .map(|e| (e.code, e.route.as_str()))
            .collect::<Vec<_>>(),
        [
            ("BIND-110", "/"),
            ("BIND-110", "/empty"),
            ("BIND-110", "/empty-typed")
        ]
    );
    assert!(errors[0].to_string().contains("home.ir"));
    let home = pages.bind::<Handler>("home").unwrap();
    assert_eq!(
        home.render(&props(), &RenderCtx::new()).unwrap_err().code(),
        "RENDER-406"
    );
    // A successful duplicate alias binding still counts for this route alone.
    let duplicate = pages.clone().bind::<Handler>("/").unwrap();
    assert_eq!(pages.finalize().unwrap_err().len(), 2);
    bind_empty(&pages);
    pages.finalize().unwrap();
    pages.clone().finalize().unwrap();
    assert!(home
        .render(&props(), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked()
        .html
        .contains("Ada &amp; Bob"));
    assert!(duplicate.render(&props(), &RenderCtx::new()).is_ok());
    assert_eq!(
        pages.bind::<Handler>("home").unwrap_err()[0].code,
        "BIND-111"
    );
}

#[test]
fn two_routes_sharing_an_alias_need_two_successful_exact_bindings() {
    let mut manifest = try_load_manifest::<Assets>().unwrap();
    manifest
        .routes
        .insert("/other".into(), manifest.routes["/"].clone());
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    bind_empty(&pages);
    pages.bind::<Handler>("/").unwrap();
    let errors = pages.finalize().unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].route, "/other");
    pages.bind::<Handler>("/other").unwrap();
    pages.finalize().unwrap();
}

#[test]
fn bind_limits_inherit_and_request_overrides_never_change_sibling_defaults() {
    use forma_server::Limits;
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    let strict = pages
        .bind_with::<Handler>(
            "home",
            Limits {
                max_list_iterations: 3,
                ..Limits::default()
            },
        )
        .unwrap();
    let loose = pages
        .bind_with::<Handler>(
            "/",
            Limits {
                max_list_iterations: 4,
                ..Limits::default()
            },
        )
        .unwrap();
    bind_empty(&pages);
    pages.finalize().unwrap();
    let data = props();
    let failure = strict.render(&data, &RenderCtx::new()).unwrap_err();
    assert_eq!((failure.code(), failure.route()), ("RENDER-302", "/"));
    assert_eq!(
        failure.counts().unwrap().list_iterations,
        2,
        "second view refuses before its first row"
    );
    assert_eq!(
        loose
            .render(&data, &RenderCtx::new())
            .unwrap()
            .counts()
            .list_iterations,
        4
    );
    assert_eq!(
        strict
            .render(&data, &RenderCtx::new().with_limits(loose.limits()))
            .unwrap()
            .counts()
            .list_iterations,
        4
    );
    assert_eq!(strict.limits().max_list_iterations, 3);
    assert_eq!(
        strict.render(&data, &RenderCtx::new()).unwrap_err().code(),
        "RENDER-302"
    );
    let zero = Limits {
        max_output_bytes: 0,
        ..Limits::default()
    };
    let error = loose
        .render(&data, &RenderCtx::new().with_limits(zero))
        .unwrap_err();
    assert_eq!(error.code(), "RENDER-301");
    assert_eq!(error.counts().unwrap().bytes, 0);
    assert!(loose.render(&data, &RenderCtx::new()).is_ok());
}

#[test]
fn typed_ssr_preserves_escaped_json_css_and_explicit_raw_prefix_with_response_policy() {
    let data = serde_json::json!({"note":"</script><img src=x onerror=alert(1)>", "other":"<!--"});
    let css = "@media (width < 600px){p::after{content:\"</style><img src=x>\"}}";
    let prefix = "<aside data-reviewed>Brand</aside>";
    let ctx = RenderCtx::new()
        .with_config_json(data.clone())
        .with_personality_css(css)
        .with_body_prefix(forma_server::RawHtml::trusted(prefix));
    // Executable request configuration belongs to a JS-enabled route. This
    // document-metadata fixture models its additional module as an empty file;
    // actual resource bytes and browser enforcement have separate integrity tests.
    let mut manifest = try_load_manifest::<Assets>().unwrap();
    manifest.routes.get_mut("/").unwrap().js = vec!["config.js".into()];
    manifest.assets.insert(
        "config.js".into(),
        forma_server::AssetMetadata {
            immutable: false,
            integrity: "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"
                .into(),
            retained: false,
        },
    );
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    let page = pages.bind::<Handler>("home").unwrap();
    bind_empty(&pages);
    pages.finalize().unwrap();
    let parts = page.render(&props(), &ctx).unwrap().into_parts_unchecked();
    assert!(parts.html.contains(&format!(
        "{prefix}<div id=\"app\" data-forma-build=\"{}\" data-forma-ssr>",
        manifest.build
    )));
    assert!(parts.html.contains("@media (width < 600px)"));
    assert!(parts.html.contains(r"<\/style><img src=x>"));
    assert!(!parts.html.contains("</style><img"));
    let json = parts
        .html
        .split("window.__FORMA_CONFIG__=")
        .nth(1)
        .unwrap()
        .split(";</script>")
        .next()
        .unwrap();
    assert!(!json.contains('<'));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(json).unwrap(),
        data
    );
    assert!(parts
        .html
        .contains(&format!("<style nonce=\"{}\">", parts.nonce)));
    let header = |name: &str| {
        parts
            .headers
            .iter()
            .find(|(n, _)| n.as_str() == name)
            .unwrap()
            .1
            .to_str()
            .unwrap()
    };
    assert_eq!(header("cache-control"), "no-store");
    assert!(header("content-security-policy").contains("require-trusted-types-for 'script'"));
    assert!(header("content-security-policy").contains(&format!("'nonce-{}'", parts.nonce)));
}

#[test]
fn only_declared_browser_routes_have_shells_and_an_empty_registry_can_finalize() {
    let mut manifest = try_load_manifest::<Assets>().unwrap();
    let shell = |route| forma_server::PageConfig {
        title: "Browser",
        route_pattern: route,
        manifest: &manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
    };
    for route in ["/", "/missing"] {
        let error =
            forma_server::render_browser_shell(&shell(route), &RenderCtx::new()).unwrap_err();
        assert_eq!((error.code(), error.route()), ("RENDER-103", route));
    }
    let page = forma_server::render_browser_shell(&shell("/client"), &RenderCtx::new())
        .unwrap()
        .into_parts_unchecked();
    assert!(page.html.contains(&format!(
        "<div id=\"app\" data-forma-build=\"{}\"></div>",
        manifest.build
    )));
    assert!(!page.html.contains("data-forma-ssr"));
    assert!(page
        .headers
        .iter()
        .any(|(name, value)| name == "cache-control" && value == "no-store"));
    manifest
        .routes
        .retain(|_, route| route.mode == forma_server::RouteMode::Browser);
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    pages.finalize().unwrap();
}

#[test]
#[allow(clippy::print_stderr)] // Explicitly report both timing scopes for this measurement.
fn a_sixty_thousand_row_typed_request_refuses_before_its_first_row() {
    use std::time::Instant;
    let handle = handle();
    let mut data = props();
    data.rows = (0..60_000)
        .map(|_| Row {
            enabled: true,
            detail: Detail {
                label: "row".into(),
            },
            id: 1.0,
        })
        .collect();
    let start = Instant::now();
    let error = handle.render(&data, &RenderCtx::new()).unwrap_err();
    let total = start.elapsed();
    assert_eq!(error.code(), "RENDER-302");
    let counts = error.counts().unwrap();
    assert_eq!(counts.list_iterations, 0);
    eprintln!(
        "60000-row refusal: walker={:?}; total typed encoding/render={total:?}",
        counts.walk_time
    );
    // The SR38 timing is the walker refusal, not the preceding checked encoding.
    #[cfg(not(debug_assertions))]
    assert!(
        counts.walk_time < Duration::from_millis(1),
        "{:?}",
        counts.walk_time
    );
}

/// FORMA-181 checkpoint B: a duplicate or non-identity row key in the handler's own data is a
/// native render failure before any response (RENDER-503): no page, no partial state, a message
/// that names the LIST, the rows and the path but no row data; the next good request renders.
#[test]
fn a_duplicate_or_non_identity_row_key_refuses_the_request_as_render_503() {
    let handle = handle();
    let refused = |rows: [f64; 2]| {
        let mut data = props();
        data.rows[0].id = rows[0];
        data.rows[1].id = rows[1];
        let error = handle.render(&data, &RenderCtx::new()).unwrap_err();
        assert_eq!(error.code(), "RENDER-503", "{error}");
        let text = error.to_string();
        assert!(text.contains("row 1, key path `id`: "), "{text}");
        assert!(
            !text.contains("First") && !text.contains("Second"),
            "{text}"
        );
        text
    };
    assert!(refused([7.0, 7.0]).contains("the row repeats the key row 0 already rendered"));
    assert!(refused([0.0, -0.0]).contains("the row repeats the key row 0 already rendered"));
    // A fraction is a valid declared number but not a row identity: the key-only rule does not
    // narrow the declared type, it refuses the key.
    assert!(refused([7.0, 1.5]).contains("not an integer within the safe range"));
    assert!(
        refused([7.0, 9_007_199_254_740_992.0]).contains("not an integer within the safe range")
    );
    assert!(handle.render(&props(), &RenderCtx::new()).is_ok());
}

struct PanickingHandler {
    panic_now: bool,
}
impl forma_ir::props::PropValue for PanickingHandler {
    fn describe(
        builder: &mut forma_ir::props::SchemaBuilder,
    ) -> Result<forma_ir::schema::PropType, forma_ir::props::PropsError> {
        Empty::describe(builder)
    }
    fn encode_value(
        &self,
        context: &forma_ir::props::EncodeContext<'_>,
        kind: &forma_ir::schema::PropType,
        path: &str,
    ) -> Result<Option<serde_json::Value>, forma_ir::props::PropsError> {
        assert!(!self.panic_now, "tenant branding conversion failed");
        Empty {}.encode_value(context, kind, path)
    }
}
impl forma_ir::PageProps for PanickingHandler {}

#[test]
fn a_props_conversion_unwind_is_one_request_fault_and_the_next_request_renders() {
    let pages = load_ir_modules::<Assets>(&try_load_manifest::<Assets>().unwrap()).unwrap();
    pages.bind::<Handler>("home").unwrap();
    pages.bind::<Empty>("empty-typed").unwrap();
    let page = pages.bind::<PanickingHandler>("empty").unwrap();
    pages.finalize().unwrap();
    let error = page
        .render(&PanickingHandler { panic_now: true }, &RenderCtx::new())
        .unwrap_err();
    assert_eq!((error.code(), error.route()), ("RENDER-399", "/empty"));
    assert!(error
        .to_string()
        .contains("tenant branding conversion failed"));
    assert!(error.component_path().is_empty());
    let good = page
        .render(&PanickingHandler { panic_now: false }, &RenderCtx::new())
        .unwrap();
    assert!(good.into_parts_unchecked().html.contains("empty-local"));
}

#[test]
fn typed_ssr_and_browser_execute_every_declared_entry_but_not_preload_chunks() {
    use forma_server::{render_browser_shell, AssetManifest, Limits, PageConfig};
    use std::borrow::Cow;
    use std::sync::OnceLock;
    static MANIFEST: OnceLock<Vec<u8>> = OnceLock::new();
    struct PreloadManifest;
    impl Embed for PreloadManifest {
        fn get(name: &str) -> Option<rust_embed::EmbeddedFile> {
            if name != "manifest.json" {
                return None;
            }
            let mut file = Assets::get(name)?;
            file.data = Cow::Owned(MANIFEST.get()?.clone());
            Some(file)
        }
        fn iter() -> impl Iterator<Item = Cow<'static, str>> {
            std::iter::once(Cow::Borrowed("manifest.json"))
        }
    }
    // These native serialization controls use metadata for empty modules. The
    // actual compiled two-entry/shared-chunk execution is tested in e2e/ssr.
    let mut json: serde_json::Value =
        serde_json::from_slice(&Assets::get("manifest.json").unwrap().data).unwrap();
    let integrity = "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb";
    for file in ["owner.js", "addon.js", "preload-only.js"] {
        json["assets"][file] = serde_json::json!({"immutable": false, "integrity": integrity});
    }
    for route in ["/", "/client"] {
        json["routes"][route]["js"] = serde_json::json!(["owner.js", "addon.js"]);
        json["routes"][route]["modulepreload"] = serde_json::json!(["preload-only.js"]);
    }
    let text = serde_json::to_string(&json).unwrap();
    MANIFEST.set(text.as_bytes().to_vec()).unwrap();
    let manifest = AssetManifest::from_json(&text).unwrap();
    let preloads = forma_server::assets::try_load_module_preloads::<PreloadManifest>().unwrap();
    let ctx = RenderCtx::new().with_module_preloads(&preloads);
    let pages = load_ir_modules::<Assets>(&manifest).unwrap();
    let page = pages.bind::<Handler>("home").unwrap();
    bind_empty(&pages);
    pages.finalize().unwrap();
    let shell = PageConfig {
        title: "Browser",
        route_pattern: "/client",
        manifest: &manifest,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
    };
    let data = props();
    let outputs = [
        page.render(&data, &ctx).unwrap(),
        render_browser_shell(&shell, &ctx).unwrap(),
    ];
    let mut sizes = Vec::new();
    for output in outputs {
        let parts = output.into_parts_unchecked();
        let tags: Vec<_> = parts
            .html
            .split("<script type=\"module\"")
            .skip(1)
            .map(|tail| {
                format!(
                    "<script type=\"module\"{}",
                    tail.split("</script>").next().unwrap()
                )
            })
            .collect();
        assert_eq!(
            tags.len(),
            2,
            "every declared entry must execute: {}",
            parts.html
        );
        for (tag, file) in tags.iter().zip(["owner.js", "addon.js"]) {
            assert!(tag.contains(&format!("src=\"/_assets/{file}\"")), "{tag}");
            assert!(tag.contains(&format!("nonce=\"{}\"", parts.nonce)), "{tag}");
            assert!(tag.contains(&format!("integrity=\"{integrity}\"")), "{tag}");
            assert!(tag.contains("crossorigin=\"anonymous\""), "{tag}");
        }
        assert!(parts.html.contains("href=\"/_assets/preload-only.js\""));
        assert!(!parts.html.contains("src=\"/_assets/preload-only.js\""));
        sizes.push(parts.html.len());
    }
    // Full document charging includes both entry tags, not just the final one.
    let limited = |bytes| {
        ctx.clone().with_limits(Limits {
            max_output_bytes: bytes,
            ..Limits::default()
        })
    };
    assert_eq!(
        page.render(&data, &limited(sizes[0] - 1))
            .unwrap_err()
            .code(),
        "RENDER-301"
    );
    assert_eq!(
        render_browser_shell(&shell, &limited(sizes[1] - 1))
            .unwrap_err()
            .code(),
        "RENDER-301"
    );
}
