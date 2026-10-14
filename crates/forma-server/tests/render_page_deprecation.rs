//! `render_page` warns, at run time, that it is deprecated: once per process,
//! in debug builds (the bridge's "warns in development builds", v2 11.1).
//!
//! Its own test binary with one test: the warning is once per process, so
//! no other test may render first.
#![allow(deprecated)]

use forma_server::{render_page, AssetManifest, PageConfig, RenderMode};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

/// Counts the warning events whose message names `render_page`'s deprecation.
struct Deprecations(Arc<AtomicUsize>);

impl Subscriber for Deprecations {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, event: &Event<'_>) {
        struct Message(String);
        impl Visit for Message {
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.0 = format!("{value:?}");
                }
            }
        }
        let mut message = Message(String::new());
        event.record(&mut message);
        if *event.metadata().level() == tracing::Level::WARN
            && message.0.contains("render_page is deprecated")
            && message.0.contains("try_render")
        {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

#[test]
fn render_page_logs_its_deprecation_once_per_process_in_debug_builds() {
    let manifest = AssetManifest {
        version: 1,
        build_hash: "test".to_string(),
        assets: HashMap::new(),
        routes: HashMap::new(),
        wasm: None,
    };
    let config = PageConfig {
        title: "Old",
        route_pattern: "/",
        manifest: &manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: None,
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    };
    let seen = Arc::new(AtomicUsize::new(0));

    tracing::subscriber::with_default(Deprecations(seen.clone()), || {
        for _ in 0..3 {
            // Still renders as it did: the log is the only change.
            assert!(render_page(&config).html.contains("<div id=\"app\"></div>"));
        }
    });

    let expected = if cfg!(debug_assertions) { 1 } else { 0 };
    assert_eq!(
        seen.load(Ordering::SeqCst),
        expected,
        "three renders, debug_assertions = {}",
        cfg!(debug_assertions)
    );
}
