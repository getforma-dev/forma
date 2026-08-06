//! Byte-identity corpus for the LIST opcode.
//!
//! Renders a fixed set of list-bearing pages and prints one `name<TAB>html`
//! line per case. Any change to how the walker scopes a list row must leave
//! this output byte-identical:
//!
//! ```text
//! cargo run --release -p forma-ir --example list_corpus > before.txt
//! # ...change the walker...
//! cargo run --release -p forma-ir --example list_corpus > after.txt
//! diff before.txt after.txt
//! ```
//!
//! The cases deliberately cover the seams where per-row scoping is observable:
//! a PROP whose target is read again after the list, two sibling lists writing
//! the same target, a list nested inside another list's body, and a body that
//! writes the list's own array slot.

// This is a measurement harness: printing the table IS its output.
#![allow(clippy::print_stdout)]

use forma_ir::parser::test_helpers::*;
use forma_ir::{walk_to_html, IrModule, SlotData, SlotValue};

// -- Local opcode encoders (the shared helpers do not cover these) -----------

fn encode_dyn_text(slot_id: u16, marker_id: u16) -> Vec<u8> {
    let mut b = vec![0x05];
    b.extend_from_slice(&slot_id.to_le_bytes());
    b.extend_from_slice(&marker_id.to_le_bytes());
    b
}

fn encode_dyn_attr(attr_str_idx: u32, slot_id: u16) -> Vec<u8> {
    let mut b = vec![0x06];
    b.extend_from_slice(&attr_str_idx.to_le_bytes());
    b.extend_from_slice(&slot_id.to_le_bytes());
    b
}

fn encode_prop(src: u16, prop_str_idx: u32, target: u16) -> Vec<u8> {
    let mut b = vec![0x12];
    b.extend_from_slice(&src.to_le_bytes());
    b.extend_from_slice(&prop_str_idx.to_le_bytes());
    b.extend_from_slice(&target.to_le_bytes());
    b
}

fn encode_list_item_key(key_str_idx: u32) -> Vec<u8> {
    let mut b = vec![0x11];
    b.extend_from_slice(&key_str_idx.to_le_bytes());
    b
}

fn encode_island_start(island_id: u16) -> Vec<u8> {
    let mut b = vec![0x0B];
    b.extend_from_slice(&island_id.to_le_bytes());
    b
}

fn encode_island_end(island_id: u16) -> Vec<u8> {
    let mut b = vec![0x0C];
    b.extend_from_slice(&island_id.to_le_bytes());
    b
}

fn cat(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}

// -- Slot value helpers ------------------------------------------------------

fn text(s: &str) -> SlotValue {
    SlotValue::Text(s.to_string())
}

fn row(name: &str, email: &str) -> SlotValue {
    SlotValue::object(vec![
        ("name".to_string(), text(name)),
        ("email".to_string(), text(email)),
        ("n".to_string(), SlotValue::Number(7.5)),
        ("ok".to_string(), SlotValue::Bool(true)),
    ])
}

// -- Case runner -------------------------------------------------------------

/// Shared string table for every case, so string indices are stable.
///
/// 0=ul 1=li 2=div 3=span 4=name 5=email 6=class 7=row 8=static 9=n 10=ok
/// 11=table 12=tr 13=td 14=a 15=b 16=items
const STRINGS: &[&str] = &[
    "ul", "li", "div", "span", "name", "email", "class", "row", "static", "n", "ok", "table", "tr",
    "td", "a", "b", "items",
];

/// Shared slot table: slot 0 = outer array, 1 = item, 2 = name, 3 = email,
/// 4 = inner array, 5 = inner item, 6 = flag, 7 = spare text.
fn slot_decls() -> Vec<(u16, u32, u8, u8, &'static [u8])> {
    vec![
        (0, 16, 0x04, 0x00, &[][..]),
        (1, 7, 0x05, 0x00, &[][..]),
        (2, 4, 0x01, 0x00, &[][..]),
        (3, 5, 0x01, 0x00, &[][..]),
        (4, 16, 0x04, 0x00, &[][..]),
        (5, 7, 0x05, 0x00, &[][..]),
        (6, 10, 0x02, 0x00, &[][..]),
        (7, 8, 0x01, 0x00, &[][..]),
    ]
}

type IslandDecl<'a> = (u16, u8, u8, u32, u32, &'a [u16]);

fn render(name: &str, opcodes: &[u8], islands: &[IslandDecl<'_>], slots: SlotData) {
    let decls = slot_decls();
    let data = build_minimal_ir(STRINGS, &decls, opcodes, islands);
    let line = match IrModule::parse(&data) {
        Ok(module) => match walk_to_html(&module, &slots) {
            Ok(html) => html,
            Err(e) => format!("<WALK-ERROR {e:?}>"),
        },
        Err(e) => format!("<PARSE-ERROR {e:?}>"),
    };
    println!("{name}\t{line}");
}

fn base_slots() -> SlotData {
    let mut s = SlotData::new(8);
    s.set(
        0,
        SlotValue::array(vec![
            row("Ada", "ada@example.com"),
            row("Grace", "grace@example.com"),
            row("Alan", "alan@example.com"),
        ]),
    );
    s.set(2, text("PRE-NAME"));
    s.set(3, text("PRE-EMAIL"));
    s.set(6, SlotValue::Bool(true));
    s.set(7, text("SPARE"));
    s
}

fn main() {
    // 1. Plain list of text items.
    let mut s = SlotData::new(8);
    s.set(
        0,
        SlotValue::array(vec![text("one"), text("two"), text("three")]),
    );
    render(
        "plain-text-items",
        &cat(&[
            &encode_open_tag(0, &[]),
            &encode_list(
                0,
                1,
                &cat(&[
                    &encode_open_tag(1, &[]),
                    &encode_dyn_text(1, 0),
                    &encode_close_tag(1),
                ]),
            ),
            &encode_close_tag(0),
        ]),
        &[],
        s,
    );

    // 2. Empty array, and 3. non-array slot: both render markers only.
    let mut s = SlotData::new(8);
    s.set(0, SlotValue::array(vec![]));
    render(
        "empty-array",
        &encode_list(0, 1, &encode_dyn_text(1, 0)),
        &[],
        s,
    );
    let mut s = SlotData::new(8);
    s.set(0, text("not-an-array"));
    render(
        "non-array-slot",
        &encode_list(0, 1, &encode_dyn_text(1, 0)),
        &[],
        s,
    );

    // 4. PROP-driven 2-column table — the audit's shape.
    let body = cat(&[
        &encode_prop(1, 4, 2),
        &encode_prop(1, 5, 3),
        &encode_open_tag(12, &[]),
        &encode_open_tag(13, &[]),
        &encode_dyn_text(2, 0),
        &encode_close_tag(13),
        &encode_open_tag(13, &[]),
        &encode_dyn_text(3, 1),
        &encode_close_tag(13),
        &encode_close_tag(12),
    ]);
    render(
        "prop-table",
        &cat(&[
            &encode_open_tag(11, &[]),
            &encode_list(0, 1, &body),
            &encode_close_tag(11),
        ]),
        &[],
        base_slots(),
    );

    // 5. THE restore case: a PROP target read again *after* the list. With
    //    per-row clones the trailing DYN_TEXT sees the pre-list value; the
    //    scoped-journal implementation must agree exactly.
    render(
        "prop-target-read-after-list",
        &cat(&[
            &encode_list(0, 1, &cat(&[&encode_prop(1, 4, 2), &encode_dyn_text(2, 0)])),
            &encode_open_tag(3, &[]),
            &encode_dyn_text(2, 9),
            &encode_close_tag(3),
        ]),
        &[],
        base_slots(),
    );

    // 6. Two sibling lists writing the same target slot.
    render(
        "sibling-lists-same-target",
        &cat(&[
            &encode_list(0, 1, &cat(&[&encode_prop(1, 4, 2), &encode_dyn_text(2, 0)])),
            &encode_dyn_text(2, 1),
            &encode_list(0, 1, &cat(&[&encode_prop(1, 5, 2), &encode_dyn_text(2, 2)])),
            &encode_dyn_text(2, 3),
        ]),
        &[],
        base_slots(),
    );

    // 7. PROP whose target IS the item slot (self-overwrite mid-row).
    render(
        "prop-target-is-item-slot",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_dyn_text(1, 0),
                &encode_prop(1, 4, 1),
                &encode_dyn_text(1, 1),
            ]),
        ),
        &[],
        base_slots(),
    );

    // 8. Nested lists over the same array (item slots distinct).
    let inner = cat(&[
        &encode_open_tag(3, &[]),
        &encode_prop(5, 4, 3),
        &encode_dyn_text(3, 1),
        &encode_close_tag(3),
    ]);
    let outer = cat(&[
        &encode_prop(1, 4, 2),
        &encode_open_tag(1, &[]),
        &encode_dyn_text(2, 0),
        &encode_list(0, 5, &inner),
        &encode_dyn_text(2, 2),
        &encode_close_tag(1),
    ]);
    render(
        "nested-lists-same-array",
        &cat(&[
            &encode_open_tag(0, &[]),
            &encode_list(0, 1, &outer),
            &encode_close_tag(0),
        ]),
        &[],
        base_slots(),
    );

    // 9. Nested lists where the inner list is bound to a slot the outer row's
    //    PROP just filled — the only way an inner list sees per-row data.
    let mut s = base_slots();
    s.set(
        0,
        SlotValue::array(vec![
            SlotValue::object(vec![
                ("name".to_string(), text("Ada")),
                (
                    "items".to_string(),
                    SlotValue::array(vec![text("x"), text("y")]),
                ),
            ]),
            SlotValue::object(vec![
                ("name".to_string(), text("Grace")),
                ("items".to_string(), SlotValue::array(vec![text("z")])),
            ]),
        ]),
    );
    render(
        "nested-list-over-per-row-array",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_prop(1, 4, 2),
                &encode_prop(1, 16, 4),
                &encode_open_tag(1, &[]),
                &encode_dyn_text(2, 0),
                &encode_list(4, 5, &encode_dyn_text(5, 1)),
                &encode_close_tag(1),
            ]),
        ),
        &[],
        s,
    );

    // 10. Body writes the list's own array slot mid-iteration.
    render(
        "body-writes-own-array-slot",
        &encode_list(0, 1, &cat(&[&encode_prop(1, 4, 0), &encode_dyn_text(1, 0)])),
        &[],
        base_slots(),
    );

    // 11. LIST_ITEM_KEY, including an item that opens no element.
    render(
        "list-item-key",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_list_item_key(8),
                &encode_open_tag(1, &[]),
                &encode_dyn_text(1, 0),
                &encode_close_tag(1),
            ]),
        ),
        &[],
        base_slots(),
    );
    render(
        "list-item-key-no-element",
        &cat(&[
            &encode_list(0, 1, &encode_list_item_key(8)),
            &encode_open_tag(2, &[]),
            &encode_close_tag(2),
        ]),
        &[],
        base_slots(),
    );

    // 12. SHOW_IF inside a list body, over a per-row PROP value.
    render(
        "show-if-in-list",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_prop(1, 10, 6),
                &encode_show_if(6, &encode_dyn_text(2, 0), &encode_text(8)),
            ]),
        ),
        &[],
        base_slots(),
    );

    // 13. SWITCH inside a list body.
    render(
        "switch-in-list",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_prop(1, 4, 2),
                &encode_switch(2, &[(14, &encode_text(14)), (15, &encode_text(15))]),
                &encode_dyn_text(2, 0),
            ]),
        ),
        &[],
        base_slots(),
    );

    // 14. DYN_ATTR bound to a per-row PROP value.
    render(
        "dyn-attr-in-list",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_prop(1, 4, 2),
                &encode_open_tag(1, &[]),
                &encode_dyn_attr(6, 2),
                &encode_dyn_text(2, 0),
                &encode_close_tag(1),
            ]),
        ),
        &[],
        base_slots(),
    );

    // 15. A list inside a SHOW_IF branch.
    render(
        "list-inside-show-if",
        &encode_show_if(
            6,
            &encode_list(0, 1, &cat(&[&encode_prop(1, 4, 2), &encode_dyn_text(2, 0)])),
            &encode_text(8),
        ),
        &[],
        base_slots(),
    );

    // 16. Island inside a list body (props built per row).
    let island_body = cat(&[
        &encode_island_start(0),
        &encode_open_tag(2, &[]),
        &encode_dyn_text(2, 0),
        &encode_close_tag(2),
        &encode_island_end(0),
    ]);
    let ops = cat(&[
        &encode_open_tag(0, &[]),
        &encode_list(0, 1, &cat(&[&encode_prop(1, 4, 2), &island_body])),
        &encode_close_tag(0),
    ]);
    // ISLAND_START sits after OPEN_TAG(ul) + the LIST header + the PROP.
    let island_offset = (encode_open_tag(0, &[]).len() + 9 + encode_prop(1, 4, 2).len()) as u32;
    render(
        "island-in-list-inline-props",
        &ops,
        &[(0, 0x01, 0x01, 4, island_offset, &[2])],
        base_slots(),
    );

    // 17. Numbers and bools flowing out of an item object.
    render(
        "number-and-bool-props",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_prop(1, 9, 2),
                &encode_prop(1, 10, 3),
                &encode_dyn_text(2, 0),
                &encode_dyn_text(3, 1),
            ]),
        ),
        &[],
        base_slots(),
    );

    // 18. Missing property → Null → empty text (zero-width space marker body).
    render(
        "missing-property",
        &encode_list(0, 1, &cat(&[&encode_prop(1, 8, 2), &encode_dyn_text(2, 0)])),
        &[],
        base_slots(),
    );

    // 19. Item slot id == list slot id.
    render(
        "item-slot-equals-list-slot",
        &encode_list(0, 0, &encode_dyn_text(0, 0)),
        &[],
        base_slots(),
    );

    // 20. Escaping inside a row.
    let mut s = SlotData::new(8);
    s.set(
        0,
        SlotValue::array(vec![text("<script>alert(1)</script>"), text("a & b \" c")]),
    );
    render(
        "escaping-in-rows",
        &encode_list(
            0,
            1,
            &cat(&[
                &encode_open_tag(1, &[]),
                &encode_dyn_attr(6, 1),
                &encode_dyn_text(1, 0),
                &encode_close_tag(1),
            ]),
        ),
        &[],
        s,
    );

    // 21. Three-deep nesting over the same array, at the depth limit.
    let d3 = encode_dyn_text(1, 2);
    let d2 = encode_list(0, 1, &cat(&[&encode_dyn_text(1, 1), &d3]));
    render(
        "triple-nested-same-array",
        &encode_list(0, 1, &cat(&[&encode_dyn_text(1, 0), &d2])),
        &[],
        base_slots(),
    );
}
