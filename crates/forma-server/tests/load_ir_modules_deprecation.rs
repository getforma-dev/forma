//! The lenient loader warns, at run time, that it is deprecated (once per
//! process, in debug builds), and the strict loader, the default, logs no
//! "Phase 1 fallback" for a failure it hands back instead (FORMA-121).
//!
//! Its own test binary: the deprecation warning is once per process, so only
//! one test here may call the lenient loader.

use forma_server::assets::try_load_manifest;
use rust_embed::Embed;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

#[derive(Embed)]
#[folder = "tests/fixtures/modules/flipped/"]
struct Flipped;

/// Counts warnings whose message contains every one of `needles`.
struct Warnings {
    needles: &'static [&'static str],
    seen: Arc<AtomicUsize>,
}

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
        let mut message = Message(String::new());
        event.record(&mut message);
        if *event.metadata().level() == tracing::Level::WARN
            && self.needles.iter().all(|n| message.0.contains(n))
        {
            self.seen.fetch_add(1, Ordering::SeqCst);
        }
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

fn count_warnings(needles: &'static [&'static str], run: impl FnOnce()) -> usize {
    let seen = Arc::new(AtomicUsize::new(0));
    tracing::subscriber::with_default(
        Warnings {
            needles,
            seen: seen.clone(),
        },
        run,
    );
    seen.load(Ordering::SeqCst)
}

#[test]
#[allow(deprecated)]
fn load_ir_modules_logs_its_deprecation_once_per_process_in_debug_builds() {
    let manifest = try_load_manifest::<Flipped>().expect("manifest");
    let deprecations = count_warnings(&["load_ir_modules is deprecated", "strict"], || {
        for _ in 0..3 {
            // Still degrades as at 0.2.1: the log is the only change.
            let (modes, _) = forma_server::load_ir_modules::<Flipped>(&manifest);
            assert_eq!(modes.len(), 6);
        }
    });
    let expected = if cfg!(debug_assertions) { 1 } else { 0 };
    assert_eq!(deprecations, expected);

    // And it still logs each fallback, as at 0.2.1.
    let fallbacks = count_warnings(&["Phase 1 fallback"], || {
        let _ = forma_server::load_ir_modules::<Flipped>(&manifest);
    });
    assert_eq!(fallbacks, 4, "one per bad module");
}

#[test]
fn the_default_loader_logs_no_fallback_it_does_not_take() {
    // The strict loader hands every failure back for the server to refuse
    // start on; a "Phase 1 fallback" line from it would be untrue.
    let manifest = try_load_manifest::<Flipped>().expect("manifest");
    let fallbacks = count_warnings(&["Phase 1 fallback"], || {
        let errors = forma_server::load_ir_modules_strict::<Flipped>(&manifest).unwrap_err();
        assert_eq!(errors.len(), 4);
    });
    assert_eq!(fallbacks, 0);
}
