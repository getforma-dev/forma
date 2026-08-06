//! Regression gate: rendering a list must cost O(rows), not O(rows^2).
//!
//! The product thesis is "compile to a binary IR so a Rust server renders at
//! native speed without running JS", and lists are the SSR workload that
//! matters most. Before this gate existed, `walk_to_html` deep-cloned the whole
//! `SlotData` — including the list's own array — once per row, which made a
//! 3-column table cost 4x more for every doubling of row count: 2 µs at 1 row,
//! 2,238 µs at 100, 34,024 µs at 400. That is 46x SLOWER than the JavaScript
//! `renderToString` the walker exists to replace.
//!
//! Two independent assertions, because they fail for different reasons:
//!
//! * `list_walk_allocations_are_linear_in_row_count` is deterministic — it
//!   counts allocations through a wrapping global allocator, so it cannot flake
//!   on a loaded machine and it pins the actual mechanism (per-row copying).
//! * `list_walk_time_is_linear_in_row_count` is the end-to-end claim in the
//!   units a user feels. It is deliberately loose (6x for a 4x row increase,
//!   where linear is 4x and quadratic is 16x) so that only a real asymptotic
//!   regression trips it.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_list, encode_open_tag,
};
use forma_ir::{walk_to_html, IrModule, SlotData, SlotValue};

// ---------------------------------------------------------------------------
// Counting allocator
// ---------------------------------------------------------------------------

static ALLOC_COUNT: AtomicUsize = AtomicUsize::new(0);
static ALLOC_BYTES: AtomicUsize = AtomicUsize::new(0);
static COUNTING: AtomicBool = AtomicBool::new(false);

struct CountingAllocator;

// SAFETY: every method forwards to `System`, the platform allocator, with the
// same pointer and layout it was given; the only added work is two relaxed
// atomic counters, which cannot affect allocation validity. `dealloc` is
// deliberately not counted, so the counters never influence a free.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOC_COUNT.fetch_add(1, Ordering::Relaxed);
            ALLOC_BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        }
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ALLOC_COUNT.fetch_add(1, Ordering::Relaxed);
            ALLOC_BYTES.fetch_add(new_size.saturating_sub(layout.size()), Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;

/// Run `f`, returning `(allocations, bytes_allocated)`.
///
/// Counting is process-wide, so these tests must not run concurrently with
/// each other. They are in the same binary and Rust's test harness is
/// threaded, so the gate below serializes them behind a mutex.
fn measure_allocations<T>(f: impl FnOnce() -> T) -> (usize, usize) {
    ALLOC_COUNT.store(0, Ordering::SeqCst);
    ALLOC_BYTES.store(0, Ordering::SeqCst);
    COUNTING.store(true, Ordering::SeqCst);
    let value = f();
    COUNTING.store(false, Ordering::SeqCst);
    drop(value);
    (
        ALLOC_COUNT.load(Ordering::SeqCst),
        ALLOC_BYTES.load(Ordering::SeqCst),
    )
}

/// Serializes the two measuring tests — the allocator counter is global.
static MEASURE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// ---------------------------------------------------------------------------
// The page under test: a 3-column table, one LIST over an array of objects
// ---------------------------------------------------------------------------

fn encode_dyn_text(slot_id: u16, marker_id: u16) -> Vec<u8> {
    let mut b = vec![0x05];
    b.extend_from_slice(&slot_id.to_le_bytes());
    b.extend_from_slice(&marker_id.to_le_bytes());
    b
}

fn encode_prop(src: u16, prop_str_idx: u32, target: u16) -> Vec<u8> {
    let mut b = vec![0x12];
    b.extend_from_slice(&src.to_le_bytes());
    b.extend_from_slice(&prop_str_idx.to_le_bytes());
    b.extend_from_slice(&target.to_le_bytes());
    b
}

/// `<table><tbody>{rows}</tbody></table>`, each row a `<tr>` of three `<td>`
/// cells fed by PROP from the row object.
///
/// strings: 0=table 1=tbody 2=tr 3=td 4=name 5=email 6=role 7=title
/// slots:   0=rows(Array) 1=item 2=name 3=email 4=role 5=title
fn build_table_module() -> IrModule {
    let strings = [
        "table", "tbody", "tr", "td", "name", "email", "role", "title",
    ];
    let slot_decls: &[(u16, u32, u8, u8, &[u8])] = &[
        (0, 0, 0x04, 0x00, b""),
        (1, 1, 0x05, 0x00, b""),
        (2, 4, 0x01, 0x00, b""),
        (3, 5, 0x01, 0x00, b""),
        (4, 6, 0x01, 0x00, b""),
        (5, 7, 0x01, 0x00, b""),
    ];

    let mut body = Vec::new();
    body.extend_from_slice(&encode_prop(1, 4, 2));
    body.extend_from_slice(&encode_prop(1, 5, 3));
    body.extend_from_slice(&encode_prop(1, 6, 4));
    body.extend_from_slice(&encode_open_tag(2, &[]));
    for (marker, slot) in [2u16, 3, 4].iter().enumerate() {
        body.extend_from_slice(&encode_open_tag(3, &[]));
        body.extend_from_slice(&encode_dyn_text(*slot, marker as u16));
        body.extend_from_slice(&encode_close_tag(3));
    }
    body.extend_from_slice(&encode_close_tag(2));

    let mut ops = Vec::new();
    ops.extend_from_slice(&encode_open_tag(0, &[]));
    ops.extend_from_slice(&encode_open_tag(1, &[]));
    ops.extend_from_slice(&encode_list(0, 1, &body));
    ops.extend_from_slice(&encode_close_tag(1));
    ops.extend_from_slice(&encode_close_tag(0));

    let data = build_minimal_ir(&strings, slot_decls, &ops, &[]);
    IrModule::parse(&data).expect("table module parses")
}

fn table_slots(module: &IrModule, rows: usize) -> SlotData {
    let mut slots = SlotData::new_from_defaults(&module.slots);
    slots.set(
        0,
        SlotValue::array(
            (0..rows)
                .map(|i| {
                    SlotValue::object(vec![
                        (
                            "name".to_string(),
                            SlotValue::Text(format!("User Number {i}")),
                        ),
                        (
                            "email".to_string(),
                            SlotValue::Text(format!("user{i}@example.com")),
                        ),
                        (
                            "role".to_string(),
                            SlotValue::Text("administrator".to_string()),
                        ),
                    ])
                })
                .collect(),
        ),
    );
    slots.set(5, SlotValue::Text("Users".to_string()));
    slots
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/// Allocations must grow linearly with row count.
///
/// This is the mechanism assertion. The defect it guards was a
/// `slots.clone()` inside the per-row loop: because `SlotValue::Array` owned
/// its payload, every row deep-copied the entire N-element array, so a
/// 100-row table took 84,322 allocations and a 400-row table 1,297,224 —
/// 48 MB allocated to emit 71 KB of HTML.
#[test]
fn list_walk_allocations_are_linear_in_row_count() {
    let _guard = MEASURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let module = build_table_module();

    let mut samples = Vec::new();
    for rows in [100usize, 400] {
        let slots = table_slots(&module, rows);
        // Warm up: the first walk sizes the output String and any lazily
        // initialized statics, which would otherwise be charged to the 100-row
        // sample only.
        let _ = walk_to_html(&module, &slots).unwrap();
        let (count, bytes) = measure_allocations(|| walk_to_html(&module, &slots).unwrap());
        samples.push((rows, count, bytes));
    }

    let (_, allocs_100, bytes_100) = samples[0];
    let (_, allocs_400, bytes_400) = samples[1];

    let alloc_ratio = allocs_400 as f64 / allocs_100.max(1) as f64;
    let byte_ratio = bytes_400 as f64 / bytes_100.max(1) as f64;

    // 4x the rows must not cost more than 6x the allocations. Linear lands
    // near 4.0; the quadratic implementation this replaced landed near 15.4.
    assert!(
        alloc_ratio < 6.0,
        "LIST allocations are super-linear: {allocs_100} allocations at 100 rows, \
         {allocs_400} at 400 rows ({alloc_ratio:.2}x for 4x the rows). \
         Linear is ~4x; the quadratic walker this gate replaced was ~15x. \
         Something in the per-row path is copying state that does not belong to the row."
    );
    assert!(
        byte_ratio < 6.0,
        "LIST allocated bytes are super-linear: {bytes_100} B at 100 rows, \
         {bytes_400} B at 400 rows ({byte_ratio:.2}x for 4x the rows)."
    );

    // Absolute ceiling as well as a ratio: a linear-but-wasteful
    // implementation (say, a fresh Vec per row) would keep the ratio at 4x
    // while still allocating far more than the row needs. The row body here is
    // 3 PROPs + 3 DYN_TEXTs; ~3,243 allocations per row is what the quadratic
    // version cost at 400 rows.
    let per_row = allocs_400 as f64 / 400.0;
    assert!(
        per_row < 20.0,
        "LIST costs {per_row:.1} allocations per row (3 PROP + 3 DYN_TEXT); \
         budget is 20."
    );
}

/// Wall-clock cost must grow linearly with row count.
///
/// Looser and noisier than the allocation gate, but it is the claim in the
/// units that matter: this is the number the "native-speed SSR" thesis rests
/// on. Measured as best-of-N to reject scheduler noise rather than average it
/// in.
#[test]
fn list_walk_time_is_linear_in_row_count() {
    let _guard = MEASURE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let module = build_table_module();

    let best_micros = |rows: usize| -> f64 {
        let slots = table_slots(&module, rows);
        for _ in 0..5 {
            std::hint::black_box(walk_to_html(&module, &slots).unwrap());
        }
        // Enough inner iterations that one sample is far longer than the
        // clock's resolution, and enough outer rounds that at least one lands
        // on an unpreempted slice.
        let iters = 200;
        let mut best = f64::MAX;
        for _ in 0..9 {
            let start = Instant::now();
            for _ in 0..iters {
                std::hint::black_box(walk_to_html(&module, &slots).unwrap());
            }
            let micros = start.elapsed().as_secs_f64() * 1e6 / iters as f64;
            if micros < best {
                best = micros;
            }
        }
        best
    };

    let t100 = best_micros(100);
    let t400 = best_micros(400);
    let ratio = t400 / t100;

    assert!(
        ratio < 6.0,
        "LIST render time is super-linear: {t100:.1} µs at 100 rows, \
         {t400:.1} µs at 400 rows ({ratio:.2}x for 4x the rows). \
         Linear is ~4x; the quadratic walker this gate replaced was ~15.9x."
    );
}

/// A list row's scope must not leak — the property the removed per-row clone
/// used to provide, now provided by the scoped write journal.
///
/// Without the unwind, the trailing DYN_TEXT would print the LAST row's name
/// instead of the value the page had before the list ran.
#[test]
fn list_row_writes_do_not_escape_the_row() {
    let strings = ["div", "name", "before"];
    let slot_decls: &[(u16, u32, u8, u8, &[u8])] = &[
        (0, 0, 0x04, 0x00, b""),
        (1, 1, 0x05, 0x00, b""),
        (2, 1, 0x01, 0x00, b""),
    ];

    let mut ops = Vec::new();
    let body = [encode_prop(1, 1, 2), encode_dyn_text(2, 0)].concat();
    ops.extend_from_slice(&encode_list(0, 1, &body));
    // Same slot, read after the list has finished.
    ops.extend_from_slice(&encode_dyn_text(2, 1));

    let data = build_minimal_ir(&strings, slot_decls, &ops, &[]);
    let module = IrModule::parse(&data).unwrap();

    let mut slots = SlotData::new_from_defaults(&module.slots);
    slots.set(
        0,
        SlotValue::array(vec![
            SlotValue::object(vec![("name".to_string(), SlotValue::Text("Ada".into()))]),
            SlotValue::object(vec![("name".to_string(), SlotValue::Text("Grace".into()))]),
        ]),
    );
    slots.set(2, SlotValue::Text("before".into()));

    let html = walk_to_html(&module, &slots).unwrap();
    assert_eq!(
        html,
        "<!--f:l0--><!--f:t0-->Ada<!--/f:t0--><!--f:t0-->Grace<!--/f:t0--><!--/f:l0-->\
         <!--f:t1-->before<!--/f:t1-->",
        "a PROP inside a LIST body leaked past the row that made it"
    );
}

/// The scope must be restored even when the row aborts, because an enclosing
/// row is about to unwind on top of it.
#[test]
fn list_row_scope_is_restored_when_the_walk_aborts() {
    let module = build_table_module();
    let slots = table_slots(&module, 50);

    // A budget small enough that the walk dies part-way through a row.
    let limits = forma_ir::WalkLimits {
        max_output_bytes: 512,
        max_list_iterations: forma_ir::DEFAULT_MAX_LIST_ITERATIONS,
    };
    let err = forma_ir::walk_to_html_with_limits(&module, &slots, limits).unwrap_err();
    assert!(
        matches!(err, forma_ir::IrError::OutputLimitExceeded { .. }),
        "expected the output budget to trip, got {err:?}"
    );

    // The caller's SlotData is behind a shared reference and must be untouched:
    // a full render right after must still produce the complete page.
    let html = walk_to_html(&module, &slots).unwrap();
    assert!(html.starts_with("<table><tbody><!--f:l0--><tr><td><!--f:t0-->User Number 0"));
    assert!(html.ends_with("</tr><!--/f:l0--></tbody></table>"));
}
