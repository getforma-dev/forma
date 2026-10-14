//! In development, a page whose module the build's watch mode rewrites is
//! served from the new module on the next request, with no restart; a write
//! that does not load keeps the previous page and logs its code (FORMA-166;
//! L-31, N7; FORMA-022 is the watch mode's half).
//!
//! This is the debug-build behaviour, through the real rust-embed, which in a
//! debug build reads `tests/fixtures/dev-reload/` from disk on every call: the
//! test writes that folder as the watch mode does, each file by rename. The
//! file is compiled for debug builds only, because in a release build
//! rust-embed reads the bytes compiled in and nothing on disk can change
//! them; what a release build does instead (no read after start) is pinned
//! on the release profile by
//! `ir_compat::reload_tests::a_release_build_reads_nothing_per_request_and_a_debug_build_rereads`.
#![cfg(debug_assertions)]
// `config_script` is a field every 0.2.x literal names.
#![allow(deprecated)]

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData};
use forma_server::assets::try_load_manifest;
use forma_server::{try_render, AssetManifest, IrModules, PageConfig, RenderCtx, RenderMode};
use rust_embed::Embed;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

#[derive(Embed)]
#[folder = "tests/fixtures/dev-reload/"]
struct DevDist;

fn dist() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/dev-reload")
}

/// Publish a file as the watch mode does: write beside it, then rename over
/// it, so a reader sees the old file or the new one, never half of one.
fn publish(name: &str, bytes: &[u8]) {
    let staged = dist().join(format!(".{name}.staged"));
    std::fs::write(&staged, bytes).expect("write");
    std::fs::rename(&staged, dist().join(name)).expect("rename");
}

/// A module rendering `<main><p>{text}</p></main>`.
fn page(text: &str) -> Vec<u8> {
    let mut ops = encode_open_tag(0, &[]);
    ops.extend_from_slice(&encode_open_tag(1, &[]));
    ops.extend_from_slice(&encode_text(2));
    ops.extend_from_slice(&encode_close_tag(1));
    ops.extend_from_slice(&encode_close_tag(0));
    build_minimal_ir(&["main", "p", text], &[], &ops, &[])
}

/// The dev manifest the watch mode writes: identity names, `build_hash` "dev".
const DEV_MANIFEST: &str = r#"{"version":1,"build_hash":"dev","assets":{"app.js":"app.js","page.ir":"page.ir"},"routes":{"/":{"js":["app.js"],"css":[],"fonts":[],"total_size_br":0,"budget_warn_threshold":0,"ir":"page.ir"}}}"#;

/// The application's handler: the route's module as it is now, rendered.
fn serve(manifest: &AssetManifest, modules: &IrModules<DevDist>) -> String {
    let module: Option<Arc<IrModule>> = modules.get("/");
    let slots = SlotData::new(0);
    let config = PageConfig {
        title: "Dev",
        route_pattern: "/",
        manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: module.as_deref(),
        slots: Some(&slots),
    };
    try_render(&config, &RenderCtx::new())
        .expect("renders")
        .into_parts_unchecked()
        .html
}

/// The warnings logged, as (code, message).
#[derive(Clone, Default)]
struct Warnings(Arc<Mutex<Vec<(String, String)>>>);

impl Subscriber for Warnings {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, event: &Event<'_>) {
        #[derive(Default)]
        struct Fields(String, String);
        impl Visit for Fields {
            fn record_str(&mut self, field: &Field, value: &str) {
                if field.name() == "code" {
                    self.0 = value.to_string();
                }
            }
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.1 = format!("{value:?}");
                }
            }
        }
        if *event.metadata().level() == tracing::Level::WARN {
            let mut fields = Fields::default();
            event.record(&mut fields);
            self.0.lock().expect("lock").push((fields.0, fields.1));
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

/// Removes what the test wrote into the fixture folder when it ends, passed
/// or failed, so a failed run leaves the source tree as it was.
struct Cleanup;

impl Drop for Cleanup {
    fn drop(&mut self) {
        for name in [
            "manifest.json",
            "page.ir",
            ".manifest.json.staged",
            ".page.ir.staged",
        ] {
            let _ = std::fs::remove_file(dist().join(name));
        }
    }
}

#[test]
fn an_edited_page_is_served_on_the_next_request_and_a_broken_edit_keeps_the_previous_page() {
    let _cleanup = Cleanup;
    // The build's first output, then the server's start.
    publish("manifest.json", DEV_MANIFEST.as_bytes());
    publish("page.ir", &page("first"));
    let manifest = try_load_manifest::<DevDist>().expect("manifest");
    let modules = IrModules::<DevDist>::load(&manifest).expect("loads");
    assert!(serve(&manifest, &modules).contains("<main><p>first</p></main>"));

    let warnings = Warnings::default();
    tracing::subscriber::with_default(warnings.clone(), || {
        // An edit: the watcher publishes the page's new module. The next
        // request serves it, from the same process.
        publish("page.ir", &page("second"));
        let html = serve(&manifest, &modules);
        assert!(html.contains("<main><p>second</p></main>"), "{html}");
        assert!(!html.contains("first"));

        // A broken edit (a module cut short): the previous page, every time,
        // and the coded error once.
        let good = page("third");
        publish("page.ir", &good[..good.len() / 2]);
        for _ in 0..3 {
            assert!(serve(&manifest, &modules).contains("<main><p>second</p></main>"));
        }
        let logged = warnings.0.lock().expect("lock").clone();
        assert_eq!(logged.len(), 1, "{logged:?}");
        assert_eq!(logged[0].0, "LOAD-103");
        assert!(
            logged[0].1.contains("route /: IR file page.ir: LOAD-103"),
            "{logged:?}"
        );

        // The fix: served on the next request.
        publish("page.ir", &good);
        assert!(serve(&manifest, &modules).contains("<main><p>third</p></main>"));
    });
}

// An application holds its modules in axum state, shared by every handler
// thread: checked when this file compiles.
const _: () = {
    fn shared<T: Send + Sync + 'static>() {}
    let _ = shared::<IrModules<DevDist>>;
};
