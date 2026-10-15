//! The strict loader report errors without logging a fallback they never take.
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
fn the_default_loader_logs_no_fallback_it_does_not_take() {
    // The strict loader hands every failure back for the server to refuse
    // start on; a "Phase 1 fallback" line from it would be untrue.
    let manifest = try_load_manifest::<Flipped>().expect("manifest");
    let fallbacks = count_warnings(&["Phase 1 fallback"], || {
        assert_eq!(
            forma_server::load_ir_modules::<Flipped>(&manifest)
                .unwrap_err()
                .len(),
            5
        );
    });
    assert_eq!(fallbacks, 0);
}
