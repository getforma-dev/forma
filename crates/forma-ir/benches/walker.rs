//! Counted walker latency and allocations on the frozen Grand Prix dashboard.
#![allow(clippy::print_stdout, missing_docs)]

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use forma_ir::{props::BoundProps, walk_to_html_counted, IrModule, SlotData, WalkLimits};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[path = "fixtures/grand-prix/props.rs"]
mod props;

static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
struct CountingAllocator;

// SAFETY: all operations forward the original pointer/layout to System. The
// counters only observe allocation calls; they never influence allocation/free.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, size)
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn benchmark(c: &mut Criterion) {
    let module = Arc::new(
        IrModule::parse(include_bytes!("fixtures/grand-prix/page.ir")).expect("dashboard FMIR"),
    );
    let binding = BoundProps::<props::Props>::bind(module.clone(), "/ssr")
        .expect("same typed props as the Grand Prix server");
    let mut group = c.benchmark_group("grand-prix-walk");
    group.sample_size(50);
    group.warm_up_time(Duration::from_secs(2));
    group.measurement_time(Duration::from_secs(5));
    for rows in [100, 1_000] {
        let encoded = binding.encode(&props::build(rows)).expect("typed props");
        let slots = SlotData::from_json(&encoded.to_string(), &module).expect("slots");
        // Count only the walk, excluding fixture construction and Criterion.
        ALLOCATIONS.store(0, Ordering::Relaxed);
        COUNTING.store(true, Ordering::Relaxed);
        let output = walk_to_html_counted(&module, &slots, WalkLimits::default()).expect("walk");
        COUNTING.store(false, Ordering::Relaxed);
        let allocations = ALLOCATIONS.load(Ordering::Relaxed);
        assert_eq!(output.counts.list_iterations, rows);
        assert_eq!(output.html.matches("data-id=\"").count(), rows);
        println!(
            "rows={rows} bytes={} allocations={allocations} allocations/row={:.3}",
            output.html.len(),
            allocations as f64 / rows as f64
        );
        // A bounded standalone loop makes this same target usable by native
        // sampling profilers without sampling Criterion's analysis/rendering.
        if let Ok(seconds) = std::env::var("FORMA_WALK_PROFILE_SECONDS") {
            if rows == 1_000 {
                let end = Instant::now() + Duration::from_secs(seconds.parse().expect("seconds"));
                while Instant::now() < end {
                    black_box(walk_to_html_counted(
                        black_box(&module),
                        black_box(&slots),
                        WalkLimits::default(),
                    ))
                    .expect("walk");
                }
            }
            continue;
        }
        group.throughput(Throughput::Bytes(output.html.len() as u64));
        group.bench_with_input(BenchmarkId::from_parameter(rows), &rows, |b, _| {
            b.iter(|| {
                black_box(walk_to_html_counted(
                    black_box(&module),
                    black_box(&slots),
                    WalkLimits::default(),
                ))
                .expect("walk")
            });
        });
    }
    group.finish();
}

criterion_group!(benches, benchmark);
criterion_main!(benches);
