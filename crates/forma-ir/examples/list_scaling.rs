//! Timing + allocation table for `walk_to_html` over a 3-column table page.
//!
//! ```text
//! cargo run --release -p forma-ir --example list_scaling
//! ```
//!
//! This is the human-readable companion to `tests/list_scaling.rs`, which
//! turns the same measurement into a pass/fail gate. Use this when you want
//! the shape of the curve rather than a verdict — the `x/row` column should be
//! flat, and the `growth` column should read ~2x per doubling. A walker that
//! copies per-row state it should not shows ~4x per doubling instead.
//!
//! The module under test mirrors the workload the SSR claim rests on: one LIST
//! over an array of objects, three PROP extractions and three DYN_TEXT cells
//! per row.

// This is a measurement harness: printing the table IS its output.
#![allow(clippy::print_stdout)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_list, encode_open_tag,
};
use forma_ir::{walk_to_html, IrModule, SlotData, SlotValue};

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

fn main() {
    let module = build_table_module();

    println!(
        "{:>5}  {:>10}  {:>9}  {:>8}  {:>10}  {:>10}  {:>8}",
        "rows", "µs", "µs/row", "growth", "allocs", "alloc B", "html B"
    );

    let mut previous: Option<(usize, f64)> = None;
    for rows in [1usize, 5, 10, 25, 50, 100, 200, 400] {
        let slots = table_slots(&module, rows);

        for _ in 0..5 {
            std::hint::black_box(walk_to_html(&module, &slots).unwrap());
        }

        let iters = if rows <= 25 { 4000 } else { 400 };
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

        ALLOC_COUNT.store(0, Ordering::SeqCst);
        ALLOC_BYTES.store(0, Ordering::SeqCst);
        COUNTING.store(true, Ordering::SeqCst);
        let html = walk_to_html(&module, &slots).unwrap();
        COUNTING.store(false, Ordering::SeqCst);
        let allocs = ALLOC_COUNT.load(Ordering::SeqCst);
        let alloc_bytes = ALLOC_BYTES.load(Ordering::SeqCst);

        let growth = match previous {
            Some((prev_rows, prev_micros)) => {
                format!("x{:.2}/x{}", best / prev_micros, rows / prev_rows.max(1))
            }
            None => "-".to_string(),
        };
        println!(
            "{:>5}  {:>10.1}  {:>9.3}  {:>8}  {:>10}  {:>10}  {:>8}",
            rows,
            best,
            best / rows as f64,
            growth,
            allocs,
            alloc_bytes,
            html.len()
        );
        previous = Some((rows, best));
    }
}
