//! FORMA-191: ordinary release-profile walker measurements over the actual
//! compiler-produced fixture modules and the HTTP handlers' identical typed data.
use axum::response::IntoResponse;
use forma_fixture_apps::{self as fixture, bench_data::*};
use forma_ir::{
    json_to_slot_value, props::BoundProps, walk_to_html_counted, IrModule, PageProps, SlotData,
    SlotSource, WalkLimits,
};
use forma_server::RenderCtx;
use rust_embed::Embed;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[derive(Embed)]
#[folder = "out/bench/dist/"]
struct Assets;
static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);
struct CountingAllocator;
// SAFETY: every operation forwards the unchanged pointer/layout to System.
// Only this single-threaded binary enables the counters, around one walk.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
            BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
            BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        }
        System.alloc_zeroed(layout)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout)
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
            BYTES.fetch_add(size.saturating_sub(layout.size()), Ordering::Relaxed);
        }
        System.realloc(pointer, layout, size)
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn percentile(sorted: &[u64], numerator: usize, denominator: usize) -> u64 {
    sorted[(sorted.len() * numerator).div_ceil(denominator) - 1]
}
struct Prepared {
    module: Arc<IrModule>,
    slots: SlotData,
    module_hash: String,
    input_hash: String,
}
fn prepare<P: PageProps>(dist: &Path, route: &str, props: &P) -> Prepared {
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(dist.join("manifest.json")).unwrap()).unwrap();
    let file = manifest["routes"][route]["ir"]
        .as_str()
        .expect("actual manifest route module");
    assert!(
        Path::new(file).components().count() == 1,
        "module must be a flat asset name"
    );
    let bytes = std::fs::read(dist.join(file)).unwrap();
    let module = Arc::new(IrModule::parse(&bytes).unwrap());
    let bound = BoundProps::<P>::bind(Arc::clone(&module), route).unwrap();
    assert!(bound.warnings().is_empty());
    let input = bound.encode(props).unwrap();
    let mut slots = SlotData::new_from_defaults(&module.slots);
    for slot in module.slots.entries() {
        if slot.source == SlotSource::Server {
            let name = module.strings.get(slot.name_str_idx).unwrap();
            let value = input
                .get(name)
                .expect("declared SERVER root is in typed projection");
            slots.set(slot.slot_id, json_to_slot_value(value));
        }
    }
    Prepared {
        module,
        slots,
        module_hash: hash(&bytes),
        input_hash: hash(&serde_json::to_vec(&input).unwrap()),
    }
}
fn walk(p: &Prepared) -> forma_ir::WalkOutput {
    walk_to_html_counted(&p.module, &p.slots, WalkLimits::default()).unwrap()
}
fn n1(p: Prepared, nominal: usize, samples: usize) -> Value {
    let first = walk(&p);
    let counts = first.counts;
    let output_hash = hash(first.html.as_bytes());
    assert!(
        counts.nodes.abs_diff(nominal) * 100 <= nominal * 3,
        "fixture node count differs by more than3%"
    );
    for _ in 0..100 {
        black_box(walk(&p));
    }
    let mut durations = Vec::with_capacity(samples);
    for index in 0..samples {
        let start = Instant::now();
        let output = black_box(walk(&p));
        let nanos = start.elapsed().as_nanos() as u64;
        assert_eq!(output.counts, counts);
        durations.push(nanos);
        drop(output);
        if (index + 1) % 2000 == 0 {
            eprintln!("N1 {nominal}: {}/{samples} walks", index + 1);
        }
    }
    let mut sorted = durations.clone();
    sorted.sort_unstable();
    let p50 = percentile(&sorted, 50, 100);
    let p99 = percentile(&sorted, 99, 100);
    json!({"nominalNodes":nominal,"nodes":counts.nodes,"bytes":counts.bytes,"listIterations":counts.list_iterations,"walks":samples,"p50Nanoseconds":p50,"p99Nanoseconds":p99,"p50NodesPerSecond":counts.nodes as f64*1e9/p50 as f64,"p99NodesPerSecond":counts.nodes as f64*1e9/p99 as f64,"samplesNanoseconds":durations,"moduleSha256":p.module_hash,"inputSha256":p.input_hash,"outputSha256":output_hash})
}
fn n5(dist: &Path) -> Value {
    let mut points = Vec::new();
    for rows in [100, 200, 400, 800, 1600, 3200] {
        let p = prepare(dist, "/pages/1500", &console_with_rows(rows));
        black_box(walk(&p));
        ALLOCS.store(0, Ordering::SeqCst);
        BYTES.store(0, Ordering::SeqCst);
        COUNTING.store(true, Ordering::SeqCst);
        let output = walk(&p);
        COUNTING.store(false, Ordering::SeqCst);
        let allocations = ALLOCS.load(Ordering::SeqCst);
        let bytes = BYTES.load(Ordering::SeqCst);
        drop(output);
        let mut times = Vec::new();
        for _ in 0..41 {
            let start = Instant::now();
            black_box(walk(&p));
            times.push(start.elapsed().as_nanos() as u64);
        }
        let mut sorted = times.clone();
        sorted.sort_unstable();
        points.push(json!({"rows":rows,"allocations":allocations,"allocatedBytes":bytes,"medianNanoseconds":percentile(&sorted,50,100),"samplesNanoseconds":times,"moduleSha256":p.module_hash,"inputSha256":p.input_hash}));
    }
    let small = prepare(dist, "/pages/1500", &console_with_rows(100));
    let large = prepare(dist, "/pages/1500", &console_with_rows(3200));
    let per_walk = |p: &Prepared, n: usize| {
        let start = Instant::now();
        for _ in 0..n {
            black_box(walk(p));
        }
        start.elapsed().as_secs_f64() / n as f64
    };
    per_walk(&small, 32);
    per_walk(&large, 1);
    let mut paired = Vec::new();
    for round in 0..41 {
        let (s, l) = if round % 2 == 0 {
            let s = per_walk(&small, 32);
            (s, per_walk(&large, 1))
        } else {
            let l = per_walk(&large, 1);
            (per_walk(&small, 32), l)
        };
        paired.push(l / s);
    }
    let mut sorted = paired.clone();
    sorted.sort_by(f64::total_cmp);
    json!({"shape":"actual console1500 five-field rows with fixed nav and islands","points":points,"pairedRounds":41,"pairedTimeRatios":paired,"medianTimeRatio":sorted[20],"rowRatio":32,"timeRatioLimit":64,"allocation100To400Limit":6})
}
fn boundaries() -> Value {
    let start = fixture::load::<Assets>();
    let _login = fixture::bind::<Login300Props>(&start.pages, "/pages/300");
    let console = fixture::bind::<Console1500Props>(&start.pages, "/pages/1500");
    let _doc = fixture::bind::<Doc10000Props>(&start.pages, "/pages/10000");
    let _canvas = fixture::bind::<Canvas15000Props>(&start.pages, "/pages/15000");
    let _ledger = fixture::bind::<Ledger20000Props>(&start.pages, "/pages/20000");
    let _islands = fixture::bind::<Islands100Props>(&start.pages, "/pages/islands-100");
    fixture::finalize(&start.pages);
    let props = console_props();
    let page = console.render(&props, &RenderCtx::new()).unwrap();
    let counts = page.counts();
    // Walk counts cover the body; the public output budget also covers the
    // shell/state/asset tags. Measure the real response body through Axum.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let response = page.into_response();
    let complete_bytes = runtime
        .block_on(axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024))
        .unwrap()
        .len();
    let exact = WalkLimits {
        max_output_bytes: complete_bytes,
        max_list_iterations: counts.list_iterations,
    };
    console
        .render(&props, &RenderCtx::new().with_limits(exact))
        .expect("exact combined output/iteration budgets pass");
    let iteration = match console.render(
        &props,
        &RenderCtx::new().with_limits(WalkLimits {
            max_list_iterations: counts.list_iterations - 1,
            ..exact
        }),
    ) {
        Err(error) => error,
        Ok(_) => panic!("one iteration over refuses"),
    };
    let output = match console.render(
        &props,
        &RenderCtx::new().with_limits(WalkLimits {
            max_output_bytes: complete_bytes - 1,
            ..exact
        }),
    ) {
        Err(error) => error,
        Ok(_) => panic!("one output byte over refuses"),
    };
    assert_eq!(iteration.code(), "RENDER-302");
    assert_eq!(output.code(), "RENDER-301");
    json!({"route":"/pages/1500","exactBytes":complete_bytes,"exactIterations":counts.list_iterations,"exactPass":true,"onePastIteration":{"code":iteration.code(),"limit":counts.list_iterations-1},"onePastOutput":{"code":output.code(),"limit":complete_bytes-1},"partialHtmlReturned":false})
}
fn main() {
    if cfg!(debug_assertions) {
        panic!("N1 requires the ordinary application release profile");
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert!(
        args.len() == 2 || args.len() == 3,
        "usage: fixture-measure <bench-dist> <report.json> [pilot]"
    );
    let pilot = args.get(2).is_some_and(|arg| arg == "pilot");
    assert!(args.len() == 2 || pilot, "unknown mode");
    let dist = Path::new(&args[0]);
    let samples = if pilot { 100 } else { 20000 };
    let mut rows = vec![n1(
        prepare(dist, "/pages/300", &login_props()),
        300,
        samples,
    )];
    if !pilot {
        rows.push(n1(
            prepare(dist, "/pages/1500", &console_props()),
            1500,
            samples,
        ));
        rows.push(n1(
            prepare(dist, "/pages/10000", &document_props()),
            10000,
            samples,
        ));
        rows.push(n1(
            prepare(dist, "/pages/15000", &canvas_props()),
            15000,
            samples,
        ));
        rows.push(n1(
            prepare(dist, "/pages/20000", &ledger_props()),
            20000,
            samples,
        ));
    }
    let report = json!({"schema":1,"pilot":pilot,"profile":"cargo build --release --locked; default application release profile; typed projection and parsing outside timer; returned output disposal outside N1 timer","n1":rows,"n5":n5(dist),"boundaries":boundaries()});
    std::fs::write(&args[1], serde_json::to_vec_pretty(&report).unwrap()).unwrap();
}
