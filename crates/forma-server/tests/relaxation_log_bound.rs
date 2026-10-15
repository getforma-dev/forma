//! The relaxation log is bounded (FORMA-127, review 5517672933 N2): an
//! application that passed request paths as `route_pattern` would otherwise
//! grow it with every distinct URL.
//!
//! Its own test binary: the bound is per process.
// `config_script` is a field each remaining legacy page literal names.
#![allow(deprecated)]

use forma_server::{
    render_browser_shell, AssetManifest, PageConfig, PolicyExtensions, RenderCtx, RenderMode,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

#[derive(Clone, Default)]
struct Warnings(Arc<Mutex<Vec<String>>>);

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
        struct Message(String);
        impl Visit for Message {
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.0 = format!("{value:?}");
                }
            }
        }
        if *event.metadata().level() == tracing::Level::WARN {
            let mut message = Message(String::new());
            event.record(&mut message);
            if message.0.contains("Trusted Types relaxed") {
                self.0.lock().expect("lock").push(message.0);
            }
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

#[test]
fn the_relaxation_log_names_at_most_1024_pairs_and_then_says_so_once() {
    let manifest = AssetManifest {
        version: 1,
        build_hash: "test".to_string(),
        assets: HashMap::new(),
        routes: HashMap::new(),
    };
    let ctx = RenderCtx::new().with_policy(
        PolicyExtensions::new().relax_trusted_types("migrating; owner app; until 2027-01-31"),
    );
    let render = |route: &str| {
        let config = PageConfig {
            title: "Relaxed",
            route_pattern: route,
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
        render_browser_shell(&config, &ctx).expect("a relaxed page still renders");
    };
    let warnings = Warnings::default();
    tracing::subscriber::with_default(warnings.clone(), || {
        // Request paths passed as patterns: one new pair per render.
        for user in 0..1_100 {
            render(&format!("/users/{user}"));
        }
        // A pair already logged, again.
        render("/users/0");
    });
    let logged = warnings.0.lock().expect("lock").clone();
    assert_eq!(logged.len(), 1_025, "1,024 pairs and one notice");
    assert!(logged[..1_024]
        .iter()
        .all(|m| m.contains("on route /users/")));
    assert!(
        logged[1_024].contains("more than 1024") && logged[1_024].contains("not a request's path"),
        "{}",
        logged[1_024]
    );
}
