//! Cross-implementation contract: FMIR emitted by the REAL TypeScript
//! compiler, read by the REAL Rust consumer.
//!
//! Every other pin on the compiler's binary output is a hand-written FMIR
//! reader living inside the compiler's own vitest suite. Those readers were
//! written from the same mental model as the emitter, so they agree with it by
//! construction — including where both are wrong about what this crate's
//! parser actually requires. Measured over 32 binary mutation probes at audit
//! time, the JS suite killed 22 and a Rust reader lane killed 22, but the
//! UNION killed 27 (68.8% → 84.4%). Five defect classes were invisible to the
//! JS suite as it then stood, each one "the emitted FMIR is mis-read by the
//! real consumer":
//!
//! | Defect | Case that catches it |
//! | --- | --- |
//! | list array slot emitted `TYPE_TEXT` instead of `TYPE_ARRAY` | `list-same-source` |
//! | string length prefix counting UTF-16 units, not UTF-8 bytes | `unicode-emoji` |
//! | `DYN_TEXT` marker collision | `dynamic-text` |
//! | `DYN_ATTR` off-by-one on the slot id | `dynamic-attrs` |
//! | `SHOW_IF` branch-length swap | `ternary-asymmetric` |
//!
//! The compiler lane has since added a slot-table assertion that also kills
//! the first row, by pinning the literal `0x04` the emitter writes. That is a
//! different claim from this one: it says the emitter wrote what its test
//! author expected, not that the consumer can iterate the result — both would
//! pass together if both were wrong about the same byte. Only this side turns
//! the wrong byte into missing rows.
//!
//! The `.ir` files in `tests/fixtures/js-emitter/` are produced by
//! `npm run emit:corpus` in the forma-tools repo, which runs `generateRealIr`
//! — the same function the esbuild SSR plugin calls for a production page —
//! over `packages/compiler/tests/fixtures/ir-corpus/`. They are committed here
//! so this suite needs no Node toolchain; forma-tools' own CI re-emits them
//! and fails if they drift (see `.github/workflows/ci.yml` there, job
//! `fmir-contract`).
//!
//! ## Why the slot data is deliberately distinguishing
//!
//! Uniform slot data hides binding mix-ups: if every Text slot holds `"x"`,
//! swapping two slot ids produces identical HTML. So every Text slot gets a
//! marker naming itself, and every list row gets per-row per-column values.
//!
//! The page is then rendered again with every Bool flipped, so no SHOW_IF
//! branch goes unrendered — `ternary-asymmetric` exists because branches of
//! equal length make `then_len` and `else_len` interchangeable, and a reader
//! and an emitter that disagree about their order still agree on the output.
//! A third render empties every Text slot, because a marker cannot pin what an
//! EMPTY value renders as, and a fourth uses the slot table's own defaults.
//!
//! ## Updating
//!
//! After an intentional emitter change: re-run `npm run emit:corpus`, copy the
//! `.ir` files into `tests/fixtures/js-emitter/`, then
//! `UPDATE_GOLDEN=1 cargo test -p forma-ir --test js_emitter_contract` and
//! review the golden diff. A golden diff you cannot explain is the finding.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use forma_ir::{
    walk_island, walk_to_html, IrError, IrModule, SlotData, SlotTable, SlotType, SlotValue,
    StringTable, HEADER_SIZE,
};

/// Every case the corpus is required to contain.
///
/// Listed rather than discovered so that deleting a case — or an emit run that
/// silently dropped one — fails here instead of shrinking the contract to
/// whatever happens to be on disk.
const EXPECTED_CASES: &[&str] = &[
    "create-show",
    "dynamic-attrs",
    "dynamic-text",
    "list-same-source",
    "nested-islands",
    "static-page",
    "ternary-asymmetric",
    "unicode-emoji",
];

/// Rows handed to every LIST. More than one, because a single row cannot tell
/// "iterated the array" from "rendered the body once".
const LIST_ROWS: usize = 3;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/js-emitter")
}

/// The `.ir` bytes for one case.
fn read_case(name: &str) -> Vec<u8> {
    let path = fixture_dir().join(format!("{name}.ir"));
    fs::read(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()))
}

fn parse_case(name: &str) -> IrModule {
    IrModule::parse(&read_case(name))
        .unwrap_or_else(|e| panic!("{name}.ir must parse as FMIR, got {e:?}"))
}

fn string_at(module: &IrModule, str_idx: u32) -> &str {
    module
        .strings
        .get(str_idx)
        .expect("parse() validated every name_str_idx against the string table")
}

/// Read the string and slot tables straight out of the file, without
/// `IrModule::parse`.
///
/// `parse` runs `validate`, which already rejects a duplicate slot id — so a
/// uniqueness check on a parsed module could never fail on its own and would
/// be decoration. Reading the two tables directly makes the uniqueness tests
/// independent of validation: they report which NAMES collide even for a
/// module `parse` would reject outright, so an emitter regression produces the
/// finding rather than a bare error enum.
///
/// The offsets are the frozen ones — 16-byte header, then (offset u32,
/// size u32) descriptors in the order bytecode, strings, slots, islands.
/// Verified by: crates/forma-ir/tests/fmir_contract.rs > "frozen_section_order_is_bytecode_strings_slots_islands"
/// Verified by: crates/forma-ir/tests/fmir_contract.rs > "frozen_header_and_section_table_sizes"
fn raw_tables(bytes: &[u8]) -> (StringTable, SlotTable) {
    let descriptor = |index: usize| -> (usize, usize) {
        let base = HEADER_SIZE + index * 8;
        let offset = u32::from_le_bytes(bytes[base..base + 4].try_into().unwrap()) as usize;
        let size = u32::from_le_bytes(bytes[base + 4..base + 8].try_into().unwrap()) as usize;
        (offset, size)
    };
    let (str_off, str_len) = descriptor(1);
    let (slot_off, slot_len) = descriptor(2);
    (
        StringTable::parse(&bytes[str_off..str_off + str_len]).expect("string table must parse"),
        SlotTable::parse(&bytes[slot_off..slot_off + slot_len]).expect("slot table must parse"),
    )
}

// ---------------------------------------------------------------------------
// Distinguishing slot data
// ---------------------------------------------------------------------------

/// Property names a list body extracts, recovered from the slot table.
///
/// The emitter mints `list:<base>:array`, `list:<base>:item` and one
/// `list:<base>:<prop>` per property the row body reads. Feeding the rows the
/// properties the body actually asks for is what makes a cross-wired PROP
/// visible: the row values it prints belong to a named column of a named row.
fn list_props(module: &IrModule, array_slot_name: &str) -> Option<(String, Vec<String>)> {
    let base = array_slot_name
        .strip_prefix("list:")
        .and_then(|rest| rest.strip_suffix(":array"))?;
    let prefix = format!("list:{base}:");
    let props = module
        .slots
        .entries()
        .iter()
        .filter_map(|e| {
            string_at(module, e.name_str_idx)
                .strip_prefix(&prefix)
                .map(str::to_string)
        })
        .filter(|p| p != "item" && p != "array")
        .collect();
    Some((base.to_string(), props))
}

/// One row of a list: an object carrying every property the body reads, each
/// value naming its own list, row index and column.
fn list_row(base: &str, props: &[String], row: usize) -> SlotValue {
    if props.is_empty() {
        // A body that reads no property still iterates; give it something that
        // names the row so an off-by-one in the row loop is visible.
        return SlotValue::Text(format!("{base}[{row}]"));
    }
    SlotValue::object(
        props
            .iter()
            .map(|p| (p.clone(), SlotValue::Text(format!("{base}[{row}].{p}"))))
            .collect(),
    )
}

/// Populate every declared slot with a value of its DECLARED type that names
/// the slot it belongs to.
///
/// Keying off `type_hint` is what turns a mislabelled slot into a render
/// difference: a list's array slot emitted as `TYPE_TEXT` gets a string, the
/// LIST finds no array to iterate, and the rows vanish from the golden.
///
/// `bools` sets every Bool slot, which drives both the SHOW_IF branch taken
/// and the presence of every boolean DYN_ATTR.
fn distinguishing_slots(module: &IrModule, bools: bool) -> SlotData {
    let capacity = module
        .slots
        .entries()
        .iter()
        .map(|e| e.slot_id as usize + 1)
        .max()
        .unwrap_or(0);
    let mut data = SlotData::new(capacity);

    for entry in module.slots.entries() {
        let name = string_at(module, entry.name_str_idx);
        let id = entry.slot_id;
        let value = match entry.type_hint {
            SlotType::Text => SlotValue::Text(format!("[{name}#{id}]")),
            SlotType::Bool => SlotValue::Bool(bools),
            SlotType::Number => SlotValue::Number(1000.0 + f64::from(id)),
            SlotType::Array => match list_props(module, name) {
                Some((base, props)) => {
                    SlotValue::array((0..LIST_ROWS).map(|r| list_row(&base, &props, r)).collect())
                }
                None => SlotValue::array(
                    (0..LIST_ROWS)
                        .map(|r| SlotValue::Text(format!("[{name}#{id}][{r}]")))
                        .collect(),
                ),
            },
            // Per-row scratch storage the LIST overwrites. Seeding it with a
            // value that says so means a row that never got bound prints
            // `<unbound …>` instead of quietly inheriting the previous row.
            SlotType::Object => SlotValue::object(vec![(
                "unbound".to_string(),
                SlotValue::Text(format!("<unbound {name}#{id}>")),
            )]),
        };
        data.set(id, value);
    }

    data
}

/// The same data with every Text slot emptied.
///
/// Distinguishing markers cannot pin what an EMPTY value renders as, and the
/// two implementations have to agree: an empty string is a present attribute
/// with an empty value (`value=""`), not an omitted one — dropping it makes a
/// controlled input keep whatever the browser had. Null is the omitted case,
/// and the `defaults` render covers that.
fn empty_text_slots(module: &IrModule) -> SlotData {
    let mut data = distinguishing_slots(module, true);
    for entry in module.slots.entries() {
        if entry.type_hint == SlotType::Text {
            data.set(entry.slot_id, SlotValue::Text(String::new()));
        }
    }
    data
}

// ---------------------------------------------------------------------------
// Golden rendering
// ---------------------------------------------------------------------------

fn push_section(out: &mut String, label: &str, html: &str) {
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&format!("<!-- @{label} -->\n{html}\n"));
}

/// Every render this contract pins, in one document: the page under
/// distinguishing data at both Bool polarities, with every Text slot empty,
/// under the slot table's own defaults, and one fragment per island entry.
fn render_all(module: &IrModule) -> Result<String, IrError> {
    let mut out = String::new();

    let on = distinguishing_slots(module, true);
    let off = distinguishing_slots(module, false);
    let empty = empty_text_slots(module);
    let defaults = SlotData::new_from_defaults(&module.slots);

    push_section(&mut out, "page bools=true", &walk_to_html(module, &on)?);
    push_section(&mut out, "page bools=false", &walk_to_html(module, &off)?);
    push_section(&mut out, "page text-empty", &walk_to_html(module, &empty)?);
    push_section(&mut out, "page defaults", &walk_to_html(module, &defaults)?);

    for entry in module.islands.entries() {
        let name = string_at(module, entry.name_str_idx);
        let label = format!("island {} {}", entry.id, name);
        push_section(&mut out, &label, &walk_island(module, &on, entry.id)?);
    }

    Ok(out)
}

/// Read a golden, normalizing line endings.
///
/// The repo is cloned with `core.autocrlf=true` on Windows, so a golden
/// committed as LF arrives as CRLF. Comparing normalized text keeps the same
/// bytes authoritative on both platforms; `.gitattributes` pins the committed
/// form to LF so the diffs match too.
fn read_golden(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.replace("\r\n", "\n"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn corpus_contains_every_expected_case() {
    let dir = fixture_dir();
    for name in EXPECTED_CASES {
        let ir = dir.join(format!("{name}.ir"));
        assert!(
            ir.is_file(),
            "corpus case '{name}' has no {} — re-run `npm run emit:corpus` in forma-tools and copy the .ir files here",
            ir.display()
        );
    }

    // And nothing extra: an .ir with no entry in EXPECTED_CASES is a case
    // nobody listed, which means nobody is maintaining its golden either.
    let mut on_disk: Vec<String> = fs::read_dir(&dir)
        .expect("fixture directory must exist")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "ir"))
        .filter_map(|p| Some(p.file_stem()?.to_str()?.to_string()))
        .collect();
    on_disk.sort();
    assert_eq!(
        on_disk, EXPECTED_CASES,
        "the .ir files on disk and EXPECTED_CASES must agree"
    );
}

#[test]
fn every_case_parses_as_fmir() {
    for name in EXPECTED_CASES {
        let module = parse_case(name);
        // A parse that succeeds but yields nothing to walk would pass every
        // other assertion here vacuously.
        assert!(
            !module.opcodes.is_empty(),
            "{name}: parsed module has an empty bytecode section"
        );
    }
}

#[test]
fn slot_names_are_pairwise_unique() {
    // Slot NAMES are the addressing scheme every server handler and every
    // island props payload uses, and nothing in `IrModule::parse` checks them:
    // `slot_id_by_name` just resolves a duplicate to one of the two, so the
    // other slot becomes unreachable by name and silently keeps whatever the
    // handler could not write to it.
    for case in EXPECTED_CASES {
        let bytes = read_case(case);
        let (strings, slots) = raw_tables(&bytes);
        let mut seen: HashMap<&str, u16> = HashMap::new();
        for entry in slots.entries() {
            let name = strings
                .get(entry.name_str_idx)
                .unwrap_or_else(|e| panic!("{case}: slot name index out of range: {e:?}"));
            if let Some(prev) = seen.insert(name, entry.slot_id) {
                panic!(
                    "{case}: slot name '{name}' is minted twice — slots {prev} and {}",
                    entry.slot_id
                );
            }
        }
    }
}

#[test]
fn slot_ids_are_pairwise_unique() {
    // `IrModule::parse` rejects a duplicate id too (`IrError::DuplicateSlotId`);
    // asserting it here off the raw table names the colliding slots, which is
    // what the emitter author needs to see.
    for case in EXPECTED_CASES {
        let bytes = read_case(case);
        let (strings, slots) = raw_tables(&bytes);
        let mut seen: HashMap<u16, &str> = HashMap::new();
        for entry in slots.entries() {
            let name = strings
                .get(entry.name_str_idx)
                .unwrap_or_else(|e| panic!("{case}: slot name index out of range: {e:?}"));
            if let Some(prev) = seen.insert(entry.slot_id, name) {
                panic!(
                    "{case}: slot id {} is declared twice — '{prev}' and '{name}'",
                    entry.slot_id
                );
            }
        }
    }
}

#[test]
fn every_case_walks_to_html() {
    for name in EXPECTED_CASES {
        let module = parse_case(name);
        let slots = distinguishing_slots(&module, true);
        walk_to_html(&module, &slots)
            .unwrap_or_else(|e| panic!("{name}: walk_to_html failed with {e:?}"));
    }
}

#[test]
fn every_island_entry_walks_as_a_fragment() {
    let mut islands_seen = 0usize;
    for name in EXPECTED_CASES {
        let module = parse_case(name);
        let slots = distinguishing_slots(&module, true);
        for entry in module.islands.entries() {
            let html = walk_island(&module, &slots, entry.id)
                .unwrap_or_else(|e| panic!("{name}: walk_island({}) failed with {e:?}", entry.id));
            // A fragment the client can swap in has to carry the island's
            // identity on its root; an island whose body opened no element
            // would come back as bare content that `activateIslands` can
            // never find.
            assert!(
                html.contains("data-forma-island="),
                "{name}: island {} fragment has no data-forma-island root: {html}",
                entry.id
            );
            islands_seen += 1;
        }
    }
    assert!(
        islands_seen >= 3,
        "the corpus must keep exercising islands (nested-islands alone declares 3), saw {islands_seen}"
    );
}

#[test]
fn corpus_exercises_multibyte_utf8() {
    // The FMIR length prefix counts BYTES. An all-ASCII corpus cannot tell a
    // byte count from a UTF-16 code-unit count, which is exactly how that
    // defect survived the JS suite — it has no non-ASCII fixture at all.
    let module = parse_case("unicode-emoji");
    let mut multibyte = 0usize;
    let mut four_byte = 0usize;
    for idx in 0..module.strings.len() {
        let s = module.strings.get(idx as u32).expect("in-bounds index");
        if s.len() != s.chars().count() {
            multibyte += 1;
        }
        if s.chars().any(|c| c.len_utf8() == 4) {
            four_byte += 1;
        }
    }
    assert!(
        multibyte > 0 && four_byte > 0,
        "unicode-emoji must keep strings whose byte length differs from their \
         character count, including 4-byte sequences (multibyte={multibyte}, four_byte={four_byte})"
    );

    // The non-ASCII signal default has to survive the slot table too — it is
    // length-prefixed separately from the string table.
    let has_multibyte_default = module
        .slots
        .entries()
        .iter()
        .any(|e| !e.default_bytes.is_empty() && e.default_bytes.iter().any(|b| *b >= 0x80));
    assert!(
        has_multibyte_default,
        "unicode-emoji must keep a slot whose default_bytes are non-ASCII"
    );
}

#[test]
fn rendered_html_matches_golden() {
    let update = std::env::var_os("UPDATE_GOLDEN").is_some();
    let mut stale = Vec::new();

    for name in EXPECTED_CASES {
        let module = parse_case(name);
        let rendered = render_all(&module)
            .unwrap_or_else(|e| panic!("{name}: rendering the golden set failed with {e:?}"));
        let path = fixture_dir().join(format!("{name}.html"));

        if update {
            fs::write(&path, &rendered)
                .unwrap_or_else(|e| panic!("writing {}: {e}", path.display()));
            continue;
        }

        match read_golden(&path) {
            Some(golden) if golden == rendered => {}
            Some(golden) => {
                stale.push(format!(
                    "--- {name} ---\nexpected (golden):\n{golden}\nactual (this walker):\n{rendered}"
                ));
            }
            None => stale.push(format!("--- {name} ---\nno golden at {}", path.display())),
        }
    }

    assert!(
        stale.is_empty(),
        "the compiler's FMIR no longer renders to the committed HTML.\n\
         If the change was intentional, re-run with UPDATE_GOLDEN=1 and review the diff.\n\n{}",
        stale.join("\n\n")
    );
}
