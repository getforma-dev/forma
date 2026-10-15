//! A plain string in `body_prefix` keeps working and warns: `RAW-101`, once per
//! process, in debug builds only; a `RawHtml` never warns (DR-19, v2 11.1's
//! "the old path keeps working and warns in development builds"; FORMA-126).
//!
//! Its own test binary with one test: the warning is once per process, so no
//! other test may render a string first.
// `render_page` and `render_page_with_nonce` (deprecated in 0.2.2) are render
// paths too, and `config_script` is a field every 0.2.x literal names.
#![allow(deprecated)]

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData};
use forma_server::{
    render_browser_shell, render_page, render_page_with_nonce, try_render, AssetManifest, CspNonce,
    PageConfig, RawHtml, RenderCtx, RenderMode,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

/// Every warning's message and `code` field.
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
        struct Fields {
            message: String,
            code: String,
        }
        impl Visit for Fields {
            fn record_str(&mut self, field: &Field, value: &str) {
                if field.name() == "code" {
                    self.code = value.to_string();
                }
            }
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                if field.name() == "message" {
                    self.message = format!("{value:?}");
                }
            }
        }
        if *event.metadata().level() == tracing::Level::WARN {
            let mut fields = Fields::default();
            event.record(&mut fields);
            // `render_page` logs its own deprecation once; only the raw
            // entry's warnings are counted here.
            if fields.code == "RAW-101" || fields.message.contains("body_prefix") {
                self.0
                    .lock()
                    .expect("not poisoned")
                    .push((fields.code, fields.message));
            }
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

fn module() -> IrModule {
    let mut ops = encode_open_tag(0, &[]);
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    IrModule::parse(&build_minimal_ir(&["p", "walked"], &[], &ops, &[])).expect("module")
}

struct Fixture {
    manifest: AssetManifest,
    module: IrModule,
    slots: SlotData,
}

fn config<'a>(f: &'a Fixture, route: &'a str, body_prefix: Option<&'a str>) -> PageConfig<'a> {
    PageConfig {
        title: "Warn",
        route_pattern: route,
        manifest: &f.manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(&f.module),
        slots: Some(&f.slots),
    }
}

/// Each render path that writes a document, as the HTML it wrote.
fn render_everywhere(config: &PageConfig) -> Vec<String> {
    let nonce = CspNonce::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").expect("nonce");
    let parts = |page: Result<forma_server::PageResponse, forma_server::RenderError>| {
        page.expect("renders").into_parts_unchecked().html
    };
    vec![
        render_page(config).html,
        render_page_with_nonce(config, &nonce).html,
        parts(try_render(config, &RenderCtx::new())),
        parts(render_browser_shell(config, &RenderCtx::new())),
    ]
}

#[test]
fn a_string_body_prefix_warns_once_per_process_in_debug_builds_and_a_raw_html_never_does() {
    let f = Fixture {
        manifest: AssetManifest {
            version: 2,
            writer: "3.0.0".into(),
            app: "ledger".into(),
            aliases: HashMap::new(),
            build: "test".to_string(),
            assets: HashMap::new(),
            routes: HashMap::new(),
        },
        module: module(),
        slots: SlotData::new(0),
    };
    let warnings = Warnings::default();
    let shell = RawHtml::trusted("<main id=\"shell\"></main>");
    let copy = shell.clone();
    let tenant_logo = String::from("<img src=\"/logo.svg\" alt=\"\">");
    let other = String::from("<nav>n</nav>");

    tracing::subscriber::with_default(warnings.clone(), || {
        // A RawHtml, and its clone, on every path, three times: no warning.
        for _ in 0..3 {
            for raw in [&shell, &copy] {
                for html in render_everywhere(&config(&f, "/studio", Some(raw))) {
                    assert_eq!(html.matches("<main id=\"shell\"></main>").count(), 1);
                }
            }
        }
        // No prefix, and an empty one, write nothing raw: no warning.
        render_everywhere(&config(&f, "/none", None));
        render_everywhere(&config(&f, "/empty", Some("")));
        assert!(
            warnings.0.lock().expect("not poisoned").is_empty(),
            "no warning before a plain string: {:?}",
            warnings.0.lock().expect("not poisoned")
        );

        // A plain string, as every 0.2.1 caller passes it: written as it is...
        let pages = render_everywhere(&config(&f, "/t/:tenant", Some(&tenant_logo)));
        assert_eq!(pages.len(), 4);
        for html in &pages {
            assert_eq!(html.matches("<img src=\"/logo.svg\" alt=\"\">").count(), 1);
        }
        // ...and the same bytes as the same text vouched for as a RawHtml.
        let vouched = RawHtml::trusted(tenant_logo.as_str());
        let nonce = CspNonce::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").expect("nonce");
        assert_eq!(
            render_page_with_nonce(&config(&f, "/t/:tenant", Some(&tenant_logo)), &nonce).html,
            render_page_with_nonce(&config(&f, "/t/:tenant", Some(&vouched)), &nonce).html
        );
        // More strings, other routes: still the one warning.
        for _ in 0..3 {
            render_everywhere(&config(&f, "/other", Some(&other)));
            render_everywhere(&config(&f, "/literal", Some("<hr>")));
        }
    });

    let seen = warnings.0.lock().expect("not poisoned").clone();
    if cfg!(debug_assertions) {
        assert_eq!(seen.len(), 1, "one warning per process: {seen:?}");
        let (code, message) = &seen[0];
        assert_eq!(code, "RAW-101");
        assert!(message.starts_with("RAW-101 "), "{message}");
        // The form it suggests binds the value first, as the MSRV needs.
        assert!(
            message.contains("let markup = RawHtml::trusted(..);"),
            "{message}"
        );
        assert!(message.contains("body_prefix: Some(&markup)"), "{message}");
        // It names the first route that passed a string.
        assert!(message.contains("route /t/:tenant"), "{message}");
    } else {
        assert!(seen.is_empty(), "release builds never warn: {seen:?}");
    }
}
