//! Static HTML walker — walks the IR opcode stream to produce HTML output.
//!
//! This is the core SSR rendering engine. It takes a parsed `IrModule` plus
//! populated `SlotData`, walks the opcode stream linearly, and produces an
//! HTML string suitable for embedding in the page.

use crate::format::{IrError, IslandTrigger, Opcode, PropsMode, SlotSource};
use crate::parser::IrModule;
use crate::slot::{SlotData, SlotValue};

// ---------------------------------------------------------------------------
// Walk state
// ---------------------------------------------------------------------------

/// Pending island info to be injected on the next OPEN_TAG or VOID_TAG.
struct IslandPending {
    id: u16,
    component_name: String,
    inline_props: Option<String>,
    trigger: IslandTrigger,
}

/// Mutable state threaded through recursive `walk_range` calls.
///
/// This avoids adding extra parameters every time we need new walker state
/// (e.g., list depth, fallback tracking).
struct WalkState {
    /// Current nesting depth for LIST opcodes.
    list_depth: u8,
    /// Stack of fallback body lengths pushed by TRY_START, popped by FALLBACK.
    fallback_stack: Vec<usize>,
    /// Pending island info to inject on the next OPEN_TAG/VOID_TAG.
    pending_island: Option<IslandPending>,
    /// Pending list-item key to inject on the next OPEN_TAG/VOID_TAG.
    pending_list_key: Option<String>,
    /// Accumulated props for ScriptTag mode, keyed by island id.
    script_tag_props: std::collections::BTreeMap<u16, serde_json::Value>,
    /// True when an OpenTag or VoidTag has been opened but the `>` has not
    /// been written yet. DYN_ATTR opcodes may still append attributes.
    pending_tag_close: bool,
}

impl WalkState {
    fn new() -> Self {
        WalkState {
            list_depth: 0,
            fallback_stack: Vec::new(),
            pending_island: None,
            pending_list_key: None,
            script_tag_props: std::collections::BTreeMap::new(),
            pending_tag_close: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Dev-mode slot source check
// ---------------------------------------------------------------------------

/// Log a warning when a server-sourced slot has no value at render time.
///
/// This is a dev-mode diagnostic: if a slot is declared as `SlotSource::Server`
/// but the handler never populated it (still `SlotValue::Null`), the page
/// handler likely has a bug. The warning is informational and does not affect
/// output.
fn check_slot_source(module: &IrModule, slot_id: u16, value: &SlotValue) {
    if let Some(entry) = module.slots.entries().iter().find(|e| e.slot_id == slot_id) {
        if entry.source == SlotSource::Server && matches!(value, SlotValue::Null) {
            #[cfg(feature = "tracing")]
            tracing::warn!(
                slot_id = slot_id,
                "Server-sourced slot has no value at render time — handler may have a bug"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Walk the IR opcode stream and produce an HTML string.
///
/// This is the main entry point for SSR rendering. It processes every opcode
/// in the module's bytecode section, looking up strings in the string table
/// and slot values in `slots`.
pub fn walk_to_html(module: &IrModule, slots: &SlotData) -> Result<String, IrError> {
    let ops = &module.opcodes;
    let len = ops.len();
    let mut out = String::with_capacity(len * 4); // rough estimate
    let mut state = WalkState::new();
    let mut slots_mut = slots.clone();
    walk_range(module, &mut slots_mut, ops, 0, len, &mut out, &mut state, 0)?;

    // Emit script tag for ScriptTag props mode islands
    if !state.script_tag_props.is_empty() {
        let json = serde_json::to_string(&state.script_tag_props)
            .unwrap_or_else(|_| "{}".to_string());
        out.push_str("<script id=\"__forma_islands\" type=\"application/json\">");
        out.push_str(&json.replace("</", "<\\/"));
        out.push_str("</script>");
    }

    Ok(out)
}

/// Walk a single island's content and produce an HTML string.
///
/// This is the fragment rendering entry point for WASM re-renders. It finds
/// the island by `island_id` in the module's island table, seeks to its
/// `byte_offset` in the opcode stream, and walks from after the ISLAND_START
/// opcode until the matching ISLAND_END opcode.
///
/// Returns all content between ISLAND_START and ISLAND_END, including the
/// island root element. The client can use `outerHTML` or strip the wrapper
/// as needed.
pub fn walk_island(
    module: &IrModule,
    slots: &SlotData,
    island_id: u16,
) -> Result<String, IrError> {
    // 1. Find the island entry by id
    let entry = module
        .islands
        .entries()
        .iter()
        .find(|e| e.id == island_id)
        .ok_or(IrError::IslandNotFound(island_id))?;

    let byte_offset = entry.byte_offset as usize;
    let ops = &module.opcodes;

    // 2. Validate byte_offset is in bounds
    if byte_offset >= ops.len() {
        return Err(IrError::BufferTooShort {
            expected: byte_offset + 1,
            actual: ops.len(),
        });
    }

    // 3. Verify we're at an ISLAND_START opcode
    let opcode = Opcode::from_byte(ops[byte_offset])?;
    if opcode != Opcode::IslandStart {
        return Err(IrError::InvalidOpcode(ops[byte_offset]));
    }

    // 4. Skip ISLAND_START opcode(1) + island_id(2) = 3 bytes
    let content_start = byte_offset + 3;
    if content_start > ops.len() {
        return Err(IrError::BufferTooShort {
            expected: content_start,
            actual: ops.len(),
        });
    }

    // 5. Find the matching ISLAND_END to determine the range end.
    //    We walk the range using walk_range_until_island_end which stops
    //    at the ISLAND_END for our island_id.
    let mut out = String::with_capacity(256);
    let mut state = WalkState::new();
    let mut slots_mut = slots.clone();
    walk_range_until_island_end(module, &mut slots_mut, ops, content_start, island_id, &mut out, &mut state, 0)?;

    Ok(out)
}

// ---------------------------------------------------------------------------
// Internal: recursive sub-range walker
// ---------------------------------------------------------------------------

/// Maximum nesting depth for LIST opcodes. Prevents stack overflow from
/// deeply nested or malicious input.
const MAX_LIST_DEPTH: u8 = 4;

/// Maximum recursion depth for control-flow opcodes (SHOW_IF, SWITCH, LIST,
/// TRY/FALLBACK). Prevents stack overflow from deeply nested or malicious IR.
const MAX_RECURSION_DEPTH: usize = 64;

/// Walk a sub-range of the opcode stream `ops[start..end]`, appending HTML to `out`.
///
/// This is structured as a sub-range function so that control-flow opcodes
/// (ShowIf, List, Switch) can recurse into their body ranges.
///
/// `state` carries mutable walker context (list depth, fallback stack, etc.).
#[allow(clippy::too_many_arguments)]
fn walk_range(
    module: &IrModule,
    slots: &mut SlotData,
    ops: &[u8],
    start: usize,
    end: usize,
    out: &mut String,
    state: &mut WalkState,
    depth: usize,
) -> Result<(), IrError> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(IrError::RecursionLimitExceeded);
    }

    let strings = &module.strings;
    let mut pos = start;

    while pos < end {
        if pos >= ops.len() {
            return Err(IrError::BufferTooShort {
                expected: pos + 1,
                actual: ops.len(),
            });
        }

        let opcode = Opcode::from_byte(ops[pos])?;
        pos += 1; // advance past the opcode byte

        // Flush pending tag close before any opcode that is NOT DYN_ATTR.
        // DYN_ATTR needs the tag still open so it can append attributes.
        if state.pending_tag_close && opcode != Opcode::DynAttr {
            out.push('>');
            state.pending_tag_close = false;
        }

        match opcode {
            // ----- Fully implemented opcodes -----

            Opcode::OpenTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                out.push('<');
                out.push_str(tag);
                for (key, val) in &attrs {
                    if val.is_empty() {
                        // Boolean attribute
                        out.push(' ');
                        out.push_str(key);
                    } else {
                        out.push(' ');
                        out.push_str(key);
                        out.push_str("=\"");
                        push_escaped_attr(out, val);
                        out.push('"');
                    }
                }
                // Inject pending island attributes
                if let Some(island) = state.pending_island.take() {
                    out.push_str(" data-forma-island=\"");
                    out.push_str(&island.id.to_string());
                    out.push_str("\" data-forma-component=\"");
                    push_escaped_attr(out, &island.component_name);
                    out.push_str("\" data-forma-status=\"pending\"");
                    // Hydration trigger
                    let trigger_str = match island.trigger {
                        IslandTrigger::Load => "load",
                        IslandTrigger::Visible => "visible",
                        IslandTrigger::Interaction => "interaction",
                        IslandTrigger::Idle => "idle",
                    };
                    out.push_str(" data-forma-hydrate=\"");
                    out.push_str(trigger_str);
                    out.push('"');
                    if let Some(ref props_json) = island.inline_props {
                        out.push_str(" data-forma-props=\"");
                        push_escaped_attr(out, props_json);
                        out.push('"');
                    }
                }
                // Inject pending list-item key
                if let Some(key) = state.pending_list_key.take() {
                    out.push_str(" data-forma-key=\"");
                    push_escaped_attr(out, &key);
                    out.push('"');
                }
                // Don't close the tag yet — DYN_ATTR opcodes may follow.
                state.pending_tag_close = true;
                pos = new_pos;
            }

            Opcode::CloseTag => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let tag = strings.get(str_idx)?;
                out.push_str("</");
                out.push_str(tag);
                out.push('>');
            }

            Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                out.push('<');
                out.push_str(tag);
                for (key, val) in &attrs {
                    if val.is_empty() {
                        // Boolean attribute
                        out.push(' ');
                        out.push_str(key);
                    } else {
                        out.push(' ');
                        out.push_str(key);
                        out.push_str("=\"");
                        push_escaped_attr(out, val);
                        out.push('"');
                    }
                }
                // Inject pending island attributes
                if let Some(island) = state.pending_island.take() {
                    out.push_str(" data-forma-island=\"");
                    out.push_str(&island.id.to_string());
                    out.push_str("\" data-forma-component=\"");
                    push_escaped_attr(out, &island.component_name);
                    out.push_str("\" data-forma-status=\"pending\"");
                    // Hydration trigger
                    let trigger_str = match island.trigger {
                        IslandTrigger::Load => "load",
                        IslandTrigger::Visible => "visible",
                        IslandTrigger::Interaction => "interaction",
                        IslandTrigger::Idle => "idle",
                    };
                    out.push_str(" data-forma-hydrate=\"");
                    out.push_str(trigger_str);
                    out.push('"');
                    if let Some(ref props_json) = island.inline_props {
                        out.push_str(" data-forma-props=\"");
                        push_escaped_attr(out, props_json);
                        out.push('"');
                    }
                }
                // Inject pending list-item key
                if let Some(key) = state.pending_list_key.take() {
                    out.push_str(" data-forma-key=\"");
                    push_escaped_attr(out, &key);
                    out.push('"');
                }
                // Don't close the tag yet — DYN_ATTR opcodes may follow.
                state.pending_tag_close = true;
                pos = new_pos;
            }

            Opcode::Text => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                push_escaped_html(out, text);
            }

            Opcode::DynText => {
                // slot_id(u16) + marker_id(u16)
                let slot_id = read_u16(ops, pos)?;
                pos += 2;
                let marker_id = read_u16(ops, pos)?;
                pos += 2;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let value = slots.get(slot_id).to_text();

                out.push_str("<!--f:t");
                out.push_str(&marker_id.to_string());
                out.push_str("-->");
                if value.is_empty() {
                    // Always emit at least a zero-width space so the browser
                    // creates a Text node between the markers. Without this,
                    // <!--f:t0--><!--/f:t0--> produces no Text node in the DOM
                    // and the hydration walker has nothing to bind the reactive
                    // effect to.
                    out.push('\u{200B}');
                } else {
                    push_escaped_html(out, &value);
                }
                out.push_str("<!--/f:t");
                out.push_str(&marker_id.to_string());
                out.push_str("-->");
            }

            Opcode::DynAttr => {
                // attr_str_idx(u32) + slot_id(u16) = 6 bytes
                let attr_str_idx = read_u32(ops, pos)?;
                let slot_id = read_u16(ops, pos + 4)?;
                pos += 6;
                check_slot_source(module, slot_id, slots.get(slot_id));

                if state.pending_tag_close {
                    let attr_name = strings.get(attr_str_idx)?;
                    let value = slots.get(slot_id).to_text();
                    if !value.is_empty() {
                        out.push(' ');
                        out.push_str(attr_name);
                        out.push_str("=\"");
                        push_escaped_attr(out, &value);
                        out.push('"');
                    }
                }
                // If not inside a tag opening (shouldn't happen in well-formed IR), skip silently.
            }

            Opcode::IslandStart => {
                // island_id(u16)
                let island_id = read_u16(ops, pos)?;
                pos += 2;
                out.push_str("<!--f:i");
                out.push_str(&island_id.to_string());
                out.push_str("-->");

                // Look up island entry from the island table by matching id
                if let Some(entry) = module.islands.entries().iter().find(|e| e.id == island_id) {
                    let component_name = strings.get(entry.name_str_idx)?.to_string();

                    // Build props JSON from the island's slot_ids
                    let inline_props = match entry.props_mode {
                        PropsMode::Inline => {
                            if entry.slot_ids.is_empty() {
                                None
                            } else {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                Some(serde_json::to_string(&props).unwrap_or_else(|_| "{}".to_string()))
                            }
                        }
                        PropsMode::ScriptTag => {
                            // Accumulate for script tag emission after walk
                            if !entry.slot_ids.is_empty() {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                state.script_tag_props.insert(island_id, serde_json::Value::Object(props));
                            }
                            None
                        }
                        PropsMode::Deferred => None,
                    };

                    state.pending_island = Some(IslandPending {
                        id: island_id,
                        component_name,
                        inline_props,
                        trigger: entry.trigger,
                    });
                }
            }

            Opcode::IslandEnd => {
                // island_id(u16)
                let island_id = read_u16(ops, pos)?;
                pos += 2;
                out.push_str("<!--/f:i");
                out.push_str(&island_id.to_string());
                out.push_str("-->");
            }

            Opcode::Comment => {
                // str_idx(u32)
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                out.push_str("<!--");
                out.push_str(&text.replace("--", "&#45;&#45;"));
                out.push_str("-->");
            }

            // ----- Stub opcodes (skip header, bodies walked as normal) -----

            Opcode::ShowIf => {
                // slot_id(2) + then_len(4) + else_len(4) = 10 bytes header
                let slot_id = read_u16(ops, pos)?;
                let then_len = read_u32(ops, pos + 2)? as usize;
                let else_len = read_u32(ops, pos + 6)? as usize;
                pos += 10;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let condition = slots.get(slot_id).as_bool();
                let then_start = pos;
                let then_end = pos + then_len;
                // After then body: 1 byte for SHOW_ELSE marker
                let else_start = then_end + 1; // skip SHOW_ELSE byte
                let else_end = else_start + else_len;

                // Emit conditional marker
                out.push_str("<!--f:s");
                out.push_str(&slot_id.to_string());
                out.push_str("-->");

                if condition {
                    walk_range(module, slots, ops, then_start, then_end, out, state, depth + 1)?;
                } else {
                    walk_range(module, slots, ops, else_start, else_end, out, state, depth + 1)?;
                }

                out.push_str("<!--/f:s");
                out.push_str(&slot_id.to_string());
                out.push_str("-->");

                // Advance pos past both branches + SHOW_ELSE marker byte
                pos = else_end;
            }

            Opcode::ShowElse => {
                // SHOW_ELSE should never be reached during normal walking — it is
                // skipped over by the SHOW_IF handler. If we reach it, the opcode
                // stream is malformed, but we tolerate it gracefully by doing nothing.
            }

            Opcode::Switch => {
                let slot_id = read_u16(ops, pos)?;
                let case_count = read_u16(ops, pos + 2)? as usize;
                pos += 4;

                // Read case headers: [(val_str_idx, body_len)]
                let mut cases = Vec::with_capacity(case_count);
                for _ in 0..case_count {
                    let val_str_idx = read_u32(ops, pos)?;
                    let body_len = read_u32(ops, pos + 4)? as usize;
                    cases.push((val_str_idx, body_len));
                    pos += 8;
                }

                // Now pos points to start of first case body
                let slot_text = slots.get(slot_id).to_text();
                let mut body_pos = pos;

                for (val_str_idx, body_len) in &cases {
                    let case_val = strings.get(*val_str_idx)?;
                    if case_val == slot_text {
                        walk_range(module, slots, ops, body_pos, body_pos + body_len, out, state, depth + 1)?;
                    }
                    body_pos += body_len;
                }

                pos = body_pos; // past all case bodies
            }

            Opcode::List => {
                // slot_id(2) + item_slot_id(2) + body_len(4) = 8 bytes header
                let slot_id = read_u16(ops, pos)?;
                let item_slot_id = read_u16(ops, pos + 2)?;
                let body_len = read_u32(ops, pos + 4)? as usize;
                pos += 8;

                check_slot_source(module, slot_id, slots.get(slot_id));

                let body_start = pos;
                let body_end = pos + body_len;

                // Emit list markers
                let list_marker_id = slot_id;
                out.push_str("<!--f:l");
                out.push_str(&list_marker_id.to_string());
                out.push_str("-->");

                // Get array items from slot and iterate.
                // Clone the items first to release the borrow on slots before
                // creating mutable shadow copies for each iteration.
                let items: Vec<SlotValue> = slots
                    .get(slot_id)
                    .as_array()
                    .map(|a| a.to_vec())
                    .unwrap_or_default();

                if !items.is_empty() {
                    state.list_depth += 1;
                    if state.list_depth > MAX_LIST_DEPTH {
                        return Err(IrError::ListDepthExceeded { max: MAX_LIST_DEPTH });
                    }
                    for item in &items {
                        let mut shadow_slots = slots.clone();
                        shadow_slots.set(item_slot_id, item.clone());
                        walk_range(module, &mut shadow_slots, ops, body_start, body_end, out, state, depth + 1)?;
                    }
                    state.list_depth -= 1;
                }

                out.push_str("<!--/f:l");
                out.push_str(&list_marker_id.to_string());
                out.push_str("-->");

                pos = body_end;
            }

            Opcode::TryStart => {
                // fallback_len(4) = 4 bytes header
                let fallback_len = read_u32(ops, pos)? as usize;
                pos += 4;
                // Push fallback_len so FALLBACK knows how many bytes to skip.
                // Main body follows inline and is walked by the outer loop.
                state.fallback_stack.push(fallback_len);
            }

            Opcode::Fallback => {
                // Phase 2: always render main body, skip fallback.
                // Pop the fallback_len pushed by the preceding TRY_START.
                if let Some(skip) = state.fallback_stack.pop() {
                    pos += skip;
                }
            }

            Opcode::Preload => {
                if pos >= ops.len() {
                    return Err(IrError::BufferTooShort {
                        expected: pos + 1,
                        actual: ops.len(),
                    });
                }
                let resource_type = ops[pos];
                let url_str_idx = read_u32(ops, pos + 1)?;
                let url = strings.get(url_str_idx)?;
                pos += 5;

                let (as_val, type_attr) = match resource_type {
                    1 => ("font", " type=\"font/woff2\" crossorigin"),
                    2 => ("style", ""),
                    3 => ("script", ""),
                    4 => ("image", ""),
                    _ => ("fetch", ""),
                };
                out.push_str("<link rel=\"preload\" href=\"");
                push_escaped_attr(out, url);
                out.push_str("\" as=\"");
                out.push_str(as_val);
                out.push('"');
                out.push_str(type_attr);
                out.push_str(">\n");
            }

            Opcode::ListItemKey => {
                // key_str_idx(u32) — 4 bytes (simplified format, no source byte)
                let key_str_idx = read_u32(ops, pos)?;
                pos += 4;
                let key_val = strings.get(key_str_idx)?;
                state.pending_list_key = Some(key_val.to_string());
            }

            Opcode::Prop => {
                // src_slot_id(u16) + prop_str_idx(u32) + target_slot_id(u16) = 8 bytes
                let src_slot_id = read_u16(ops, pos)?;
                let prop_str_idx = read_u32(ops, pos + 2)?;
                let target_slot_id = read_u16(ops, pos + 6)?;
                pos += 8;

                let prop_name = strings.get(prop_str_idx)?;
                let value = slots.get(src_slot_id).get_property(prop_name);
                // Mutate slots directly — safe because PROP is used inside LIST
                // bodies where slots is already a shadow copy (cloned per iteration).
                slots.set(target_slot_id, value);
            }
        }
    }

    // Flush any pending tag close at the end of the opcode range.
    if state.pending_tag_close {
        out.push('>');
        state.pending_tag_close = false;
    }

    Ok(())
}

/// Walk the opcode stream starting at `start` until we encounter an ISLAND_END
/// with the matching `target_island_id`. Appends HTML output to `out`.
///
/// This is used by `walk_island()` to render just one island's content.
/// It shares the same opcode interpretation as `walk_range` but has a different
/// termination condition: it stops at ISLAND_END instead of a fixed end position.
#[allow(clippy::too_many_arguments)]
fn walk_range_until_island_end(
    module: &IrModule,
    slots: &mut SlotData,
    ops: &[u8],
    start: usize,
    target_island_id: u16,
    out: &mut String,
    state: &mut WalkState,
    depth: usize,
) -> Result<(), IrError> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(IrError::RecursionLimitExceeded);
    }

    let strings = &module.strings;
    let mut pos = start;

    while pos < ops.len() {
        let opcode = Opcode::from_byte(ops[pos])?;
        pos += 1;

        // Flush pending tag close before any opcode that is NOT DYN_ATTR.
        if state.pending_tag_close && opcode != Opcode::DynAttr {
            out.push('>');
            state.pending_tag_close = false;
        }

        match opcode {
            Opcode::IslandEnd => {
                let island_id = read_u16(ops, pos)?;
                pos += 2;
                if island_id == target_island_id {
                    // We've reached the end of our target island — stop.
                    // Flush any pending tag close first.
                    if state.pending_tag_close {
                        out.push('>');
                        state.pending_tag_close = false;
                    }
                    return Ok(());
                }
                // Nested island end — emit the marker comment and continue
                out.push_str("<!--/f:i");
                out.push_str(&island_id.to_string());
                out.push_str("-->");
            }

            // All other opcodes are handled identically to walk_range.
            // We delegate to the shared walk_one_opcode helper.

            Opcode::OpenTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                out.push('<');
                out.push_str(tag);
                for (key, val) in &attrs {
                    if val.is_empty() {
                        out.push(' ');
                        out.push_str(key);
                    } else {
                        out.push(' ');
                        out.push_str(key);
                        out.push_str("=\"");
                        push_escaped_attr(out, val);
                        out.push('"');
                    }
                }
                if let Some(island) = state.pending_island.take() {
                    out.push_str(" data-forma-island=\"");
                    out.push_str(&island.id.to_string());
                    out.push_str("\" data-forma-component=\"");
                    push_escaped_attr(out, &island.component_name);
                    out.push_str("\" data-forma-status=\"pending\"");
                    let trigger_str = match island.trigger {
                        IslandTrigger::Load => "load",
                        IslandTrigger::Visible => "visible",
                        IslandTrigger::Interaction => "interaction",
                        IslandTrigger::Idle => "idle",
                    };
                    out.push_str(" data-forma-hydrate=\"");
                    out.push_str(trigger_str);
                    out.push('"');
                    if let Some(ref props_json) = island.inline_props {
                        out.push_str(" data-forma-props=\"");
                        push_escaped_attr(out, props_json);
                        out.push('"');
                    }
                }
                if let Some(key) = state.pending_list_key.take() {
                    out.push_str(" data-forma-key=\"");
                    push_escaped_attr(out, &key);
                    out.push('"');
                }
                state.pending_tag_close = true;
                pos = new_pos;
            }

            Opcode::CloseTag => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let tag = strings.get(str_idx)?;
                out.push_str("</");
                out.push_str(tag);
                out.push('>');
            }

            Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                out.push('<');
                out.push_str(tag);
                for (key, val) in &attrs {
                    if val.is_empty() {
                        out.push(' ');
                        out.push_str(key);
                    } else {
                        out.push(' ');
                        out.push_str(key);
                        out.push_str("=\"");
                        push_escaped_attr(out, val);
                        out.push('"');
                    }
                }
                if let Some(island) = state.pending_island.take() {
                    out.push_str(" data-forma-island=\"");
                    out.push_str(&island.id.to_string());
                    out.push_str("\" data-forma-component=\"");
                    push_escaped_attr(out, &island.component_name);
                    out.push_str("\" data-forma-status=\"pending\"");
                    let trigger_str = match island.trigger {
                        IslandTrigger::Load => "load",
                        IslandTrigger::Visible => "visible",
                        IslandTrigger::Interaction => "interaction",
                        IslandTrigger::Idle => "idle",
                    };
                    out.push_str(" data-forma-hydrate=\"");
                    out.push_str(trigger_str);
                    out.push('"');
                    if let Some(ref props_json) = island.inline_props {
                        out.push_str(" data-forma-props=\"");
                        push_escaped_attr(out, props_json);
                        out.push('"');
                    }
                }
                if let Some(key) = state.pending_list_key.take() {
                    out.push_str(" data-forma-key=\"");
                    push_escaped_attr(out, &key);
                    out.push('"');
                }
                state.pending_tag_close = true;
                pos = new_pos;
            }

            Opcode::Text => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                push_escaped_html(out, text);
            }

            Opcode::DynText => {
                let slot_id = read_u16(ops, pos)?;
                pos += 2;
                let marker_id = read_u16(ops, pos)?;
                pos += 2;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let value = slots.get(slot_id).to_text();

                out.push_str("<!--f:t");
                out.push_str(&marker_id.to_string());
                out.push_str("-->");
                if value.is_empty() {
                    out.push('\u{200B}');
                } else {
                    push_escaped_html(out, &value);
                }
                out.push_str("<!--/f:t");
                out.push_str(&marker_id.to_string());
                out.push_str("-->");
            }

            Opcode::DynAttr => {
                let attr_str_idx = read_u32(ops, pos)?;
                let slot_id = read_u16(ops, pos + 4)?;
                pos += 6;
                check_slot_source(module, slot_id, slots.get(slot_id));

                if state.pending_tag_close {
                    let attr_name = strings.get(attr_str_idx)?;
                    let value = slots.get(slot_id).to_text();
                    if !value.is_empty() {
                        out.push(' ');
                        out.push_str(attr_name);
                        out.push_str("=\"");
                        push_escaped_attr(out, &value);
                        out.push('"');
                    }
                }
            }

            Opcode::IslandStart => {
                let island_id = read_u16(ops, pos)?;
                pos += 2;
                out.push_str("<!--f:i");
                out.push_str(&island_id.to_string());
                out.push_str("-->");

                if let Some(entry) = module.islands.entries().iter().find(|e| e.id == island_id) {
                    let component_name = strings.get(entry.name_str_idx)?.to_string();
                    let inline_props = match entry.props_mode {
                        PropsMode::Inline => {
                            if entry.slot_ids.is_empty() {
                                None
                            } else {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                Some(serde_json::to_string(&props).unwrap_or_else(|_| "{}".to_string()))
                            }
                        }
                        PropsMode::ScriptTag => {
                            if !entry.slot_ids.is_empty() {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                state.script_tag_props.insert(island_id, serde_json::Value::Object(props));
                            }
                            None
                        }
                        PropsMode::Deferred => None,
                    };
                    state.pending_island = Some(IslandPending {
                        id: island_id,
                        component_name,
                        inline_props,
                        trigger: entry.trigger,
                    });
                }
            }

            Opcode::Comment => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                out.push_str("<!--");
                out.push_str(&text.replace("--", "&#45;&#45;"));
                out.push_str("-->");
            }

            Opcode::ShowIf => {
                let slot_id = read_u16(ops, pos)?;
                let then_len = read_u32(ops, pos + 2)? as usize;
                let else_len = read_u32(ops, pos + 6)? as usize;
                pos += 10;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let condition = slots.get(slot_id).as_bool();
                let then_start = pos;
                let then_end = pos + then_len;
                let else_start = then_end + 1;
                let else_end = else_start + else_len;

                out.push_str("<!--f:s");
                out.push_str(&slot_id.to_string());
                out.push_str("-->");

                if condition {
                    walk_range(module, slots, ops, then_start, then_end, out, state, depth + 1)?;
                } else {
                    walk_range(module, slots, ops, else_start, else_end, out, state, depth + 1)?;
                }

                out.push_str("<!--/f:s");
                out.push_str(&slot_id.to_string());
                out.push_str("-->");

                pos = else_end;
            }

            Opcode::ShowElse => {
                // Should not be reached during normal walking
            }

            Opcode::Switch => {
                let slot_id = read_u16(ops, pos)?;
                let case_count = read_u16(ops, pos + 2)? as usize;
                pos += 4;

                let mut cases = Vec::with_capacity(case_count);
                for _ in 0..case_count {
                    let val_str_idx = read_u32(ops, pos)?;
                    let body_len = read_u32(ops, pos + 4)? as usize;
                    cases.push((val_str_idx, body_len));
                    pos += 8;
                }

                let slot_text = slots.get(slot_id).to_text();
                let mut body_pos = pos;

                for (val_str_idx, body_len) in &cases {
                    let case_val = strings.get(*val_str_idx)?;
                    if case_val == slot_text {
                        walk_range(module, slots, ops, body_pos, body_pos + body_len, out, state, depth + 1)?;
                    }
                    body_pos += body_len;
                }

                pos = body_pos;
            }

            Opcode::List => {
                let slot_id = read_u16(ops, pos)?;
                let item_slot_id = read_u16(ops, pos + 2)?;
                let body_len = read_u32(ops, pos + 4)? as usize;
                pos += 8;

                check_slot_source(module, slot_id, slots.get(slot_id));

                let body_start = pos;
                let body_end = pos + body_len;

                let list_marker_id = slot_id;
                out.push_str("<!--f:l");
                out.push_str(&list_marker_id.to_string());
                out.push_str("-->");

                let items: Vec<SlotValue> = slots
                    .get(slot_id)
                    .as_array()
                    .map(|a| a.to_vec())
                    .unwrap_or_default();

                if !items.is_empty() {
                    state.list_depth += 1;
                    if state.list_depth > MAX_LIST_DEPTH {
                        return Err(IrError::ListDepthExceeded { max: MAX_LIST_DEPTH });
                    }
                    for item in &items {
                        let mut shadow_slots = slots.clone();
                        shadow_slots.set(item_slot_id, item.clone());
                        walk_range(module, &mut shadow_slots, ops, body_start, body_end, out, state, depth + 1)?;
                    }
                    state.list_depth -= 1;
                }

                out.push_str("<!--/f:l");
                out.push_str(&list_marker_id.to_string());
                out.push_str("-->");

                pos = body_end;
            }

            Opcode::TryStart => {
                let fallback_len = read_u32(ops, pos)? as usize;
                pos += 4;
                state.fallback_stack.push(fallback_len);
            }

            Opcode::Fallback => {
                if let Some(skip) = state.fallback_stack.pop() {
                    pos += skip;
                }
            }

            Opcode::Preload => {
                if pos >= ops.len() {
                    return Err(IrError::BufferTooShort {
                        expected: pos + 1,
                        actual: ops.len(),
                    });
                }
                let resource_type = ops[pos];
                let url_str_idx = read_u32(ops, pos + 1)?;
                let url = strings.get(url_str_idx)?;
                pos += 5;

                let (as_val, type_attr) = match resource_type {
                    1 => ("font", " type=\"font/woff2\" crossorigin"),
                    2 => ("style", ""),
                    3 => ("script", ""),
                    4 => ("image", ""),
                    _ => ("fetch", ""),
                };
                out.push_str("<link rel=\"preload\" href=\"");
                push_escaped_attr(out, url);
                out.push_str("\" as=\"");
                out.push_str(as_val);
                out.push('"');
                out.push_str(type_attr);
                out.push_str(">\n");
            }

            Opcode::ListItemKey => {
                let key_str_idx = read_u32(ops, pos)?;
                pos += 4;
                let key_val = strings.get(key_str_idx)?;
                state.pending_list_key = Some(key_val.to_string());
            }

            Opcode::Prop => {
                let src_slot_id = read_u16(ops, pos)?;
                let prop_str_idx = read_u32(ops, pos + 2)?;
                let target_slot_id = read_u16(ops, pos + 6)?;
                pos += 8;

                let prop_name = strings.get(prop_str_idx)?;
                let value = slots.get(src_slot_id).get_property(prop_name);
                slots.set(target_slot_id, value);
            }
        }
    }

    // If we reach the end of the opcode stream without finding ISLAND_END,
    // that means the IR is malformed. Return an error.
    Err(IrError::IslandNotFound(target_island_id))
}

// ---------------------------------------------------------------------------
// Island props helpers
// ---------------------------------------------------------------------------

/// Build a JSON object from the island's slot_ids, looking up names from
/// the slot table and values from the current SlotData.
fn build_island_props(
    module: &IrModule,
    slots: &SlotData,
    slot_ids: &[u16],
) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for &slot_id in slot_ids {
        // Look up slot name from the slot table
        if let Some(entry) = module.slots.entries().iter().find(|e| e.slot_id == slot_id) {
            if let Ok(name) = module.strings.get(entry.name_str_idx) {
                let value = slots.get(slot_id).to_json();
                map.insert(name.to_string(), value);
            }
        }
    }
    map
}

// ---------------------------------------------------------------------------
// Byte-reading helpers
// ---------------------------------------------------------------------------

/// Read a little-endian u16 from `data` at `pos`.
pub(crate) fn read_u16(data: &[u8], pos: usize) -> Result<u16, IrError> {
    if pos + 2 > data.len() {
        return Err(IrError::BufferTooShort {
            expected: pos + 2,
            actual: data.len(),
        });
    }
    Ok(u16::from_le_bytes(data[pos..pos + 2].try_into().unwrap()))
}

/// Read a little-endian u32 from `data` at `pos`.
pub(crate) fn read_u32(data: &[u8], pos: usize) -> Result<u32, IrError> {
    if pos + 4 > data.len() {
        return Err(IrError::BufferTooShort {
            expected: pos + 4,
            actual: data.len(),
        });
    }
    Ok(u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()))
}

/// Read an OPEN_TAG or VOID_TAG operand block:
/// `str_idx(u32) + attr_count(u16) + [(key_str_idx(u32), val_str_idx(u32))] x attr_count`
///
/// Returns `(tag_str_idx, vec of (key, val) string refs, new position)`.
pub(crate) fn read_tag_with_attrs<'a>(
    ops: &[u8],
    pos: usize,
    strings: &'a crate::parser::StringTable,
) -> Result<(u32, Vec<(&'a str, &'a str)>, usize), IrError> {
    let tag_str_idx = read_u32(ops, pos)?;
    let attr_count = read_u16(ops, pos + 4)? as usize;
    let mut cursor = pos + 6; // past str_idx(4) + attr_count(2)

    let mut attrs = Vec::with_capacity(attr_count);
    for _ in 0..attr_count {
        let key_idx = read_u32(ops, cursor)?;
        let val_idx = read_u32(ops, cursor + 4)?;
        let key = strings.get(key_idx)?;
        let val = strings.get(val_idx)?;
        attrs.push((key, val));
        cursor += 8;
    }

    Ok((tag_str_idx, attrs, cursor))
}

// ---------------------------------------------------------------------------
// HTML escaping helpers
// ---------------------------------------------------------------------------

/// Escape text for HTML content: `& < >`.
fn push_escaped_html(out: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
}

/// Escape text for HTML attribute values: `& " < >`.
fn push_escaped_attr(out: &mut String, text: &str) {
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_list, encode_open_tag, encode_preload,
        encode_show_if, encode_switch, encode_text, encode_try, encode_void_tag,
    };
    use crate::slot::{SlotData, SlotValue};

    // -- Opcode encoding helpers local to walker tests ----------------------

    /// Encode a DYN_TEXT opcode: opcode(1) + slot_id(2) + marker_id(2)
    fn encode_dyn_text(slot_id: u16, marker_id: u16) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.push(0x05); // Opcode::DynText
        buf.extend_from_slice(&slot_id.to_le_bytes());
        buf.extend_from_slice(&marker_id.to_le_bytes());
        buf
    }

    /// Encode an ISLAND_START opcode: opcode(1) + island_id(2)
    fn encode_island_start(island_id: u16) -> Vec<u8> {
        let mut buf = vec![0x0B];
        buf.extend_from_slice(&island_id.to_le_bytes());
        buf
    }

    /// Encode an ISLAND_END opcode: opcode(1) + island_id(2)
    fn encode_island_end(island_id: u16) -> Vec<u8> {
        let mut buf = vec![0x0C];
        buf.extend_from_slice(&island_id.to_le_bytes());
        buf
    }

    /// Encode a COMMENT opcode: opcode(1) + str_idx(4)
    fn encode_comment(str_idx: u32) -> Vec<u8> {
        let mut buf = vec![0x10];
        buf.extend_from_slice(&str_idx.to_le_bytes());
        buf
    }

    /// Helper: build an IrModule, walk it with empty slots, return the HTML.
    fn walk_static(strings: &[&str], opcodes: &[u8]) -> String {
        let data = build_minimal_ir(strings, &[], opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        walk_to_html(&module, &slots).unwrap()
    }

    /// Helper: build an IrModule with slot declarations, walk with given SlotData.
    fn walk_with_slots(
        strings: &[&str],
        slot_decls: &[(u16, u32, u8, u8, &[u8])],
        opcodes: &[u8],
        slots: &SlotData,
    ) -> String {
        let data = build_minimal_ir(strings, slot_decls, opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        walk_to_html(&module, slots).unwrap()
    }

    /// Helper: build an IrModule with slots AND islands, walk with given SlotData.
    fn walk_with_islands(
        strings: &[&str],
        slot_decls: &[(u16, u32, u8, u8, &[u8])],
        island_decls: &[(u16, u8, u8, u32, u32, &[u16])],
        opcodes: &[u8],
        slots: &SlotData,
    ) -> String {
        let data = build_minimal_ir(strings, slot_decls, opcodes, island_decls);
        let module = IrModule::parse(&data).unwrap();
        walk_to_html(&module, slots).unwrap()
    }

    /// Encode a LIST_ITEM_KEY opcode: opcode(1) + key_str_idx(4)
    fn encode_list_item_key(key_str_idx: u32) -> Vec<u8> {
        let mut buf = vec![0x11]; // Opcode::ListItemKey
        buf.extend_from_slice(&key_str_idx.to_le_bytes());
        buf
    }

    /// Encode a DYN_ATTR opcode: opcode(1) + attr_str_idx(4) + slot_id(2)
    fn encode_dyn_attr(attr_str_idx: u32, slot_id: u16) -> Vec<u8> {
        let mut bytes = vec![0x06]; // Opcode::DynAttr
        bytes.extend_from_slice(&attr_str_idx.to_le_bytes());
        bytes.extend_from_slice(&slot_id.to_le_bytes());
        bytes
    }

    // -- Test 1: walk_static_div -------------------------------------------

    #[test]
    fn walk_static_div() {
        // <div class="container">Hello</div>
        // strings: 0="div", 1="class", 2="container", 3="Hello"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_text(3));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["div", "class", "container", "Hello"], &opcodes);
        assert_eq!(html, r#"<div class="container">Hello</div>"#);
    }

    // -- Test 2: walk_void_tag ---------------------------------------------

    #[test]
    fn walk_void_tag() {
        // <input type="email">
        // strings: 0="input", 1="type", 2="email"
        let opcodes = encode_void_tag(0, &[(1, 2)]);

        let html = walk_static(&["input", "type", "email"], &opcodes);
        assert_eq!(html, r#"<input type="email">"#);
    }

    // -- Test 3: walk_nested_elements --------------------------------------

    #[test]
    fn walk_nested_elements() {
        // <div><span>Hi</span></div>
        // strings: 0="div", 1="span", 2="Hi"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_text(2));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["div", "span", "Hi"], &opcodes);
        assert_eq!(html, "<div><span>Hi</span></div>");
    }

    // -- Test 4: walk_text_escaping ----------------------------------------

    #[test]
    fn walk_text_escaping() {
        // TEXT with "<script>alert('xss')</script>"
        let opcodes = encode_text(0);

        let html = walk_static(&["<script>alert('xss')</script>"], &opcodes);
        assert_eq!(html, "&lt;script&gt;alert('xss')&lt;/script&gt;");
    }

    // -- Test 5: walk_attr_escaping ----------------------------------------

    #[test]
    fn walk_attr_escaping() {
        // OPEN_TAG with attr value containing a double quote
        // strings: 0="div", 1="title", 2=r#"a"b"#
        let opcodes = encode_open_tag(0, &[(1, 2)]);

        let html = walk_static(&["div", "title", "a\"b"], &opcodes);
        assert_eq!(html, r#"<div title="a&quot;b">"#);
    }

    // -- Test 6: walk_empty_element ----------------------------------------

    #[test]
    fn walk_empty_element() {
        // <div></div> (no children)
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["div"], &opcodes);
        assert_eq!(html, "<div></div>");
    }

    // -- Test 7: walk_dyn_text ---------------------------------------------

    #[test]
    fn walk_dyn_text() {
        // DYN_TEXT with slot data produces marker comments + value
        // strings: 0="greeting" (slot name)
        // slot decl: slot_id=0, name_str_idx=0, type=Text(0x01)
        let opcodes = encode_dyn_text(0, 0);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".to_string()));

        let html = walk_with_slots(&["greeting"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &slots);
        assert_eq!(html, "<!--f:t0-->World<!--/f:t0-->");
    }

    #[test]
    fn walk_dyn_text_null_emits_zwsp() {
        // DYN_TEXT with null slot value must emit a zero-width space between
        // markers so the browser creates a Text node for hydration to bind to.
        let opcodes = encode_dyn_text(0, 0);
        let slots = SlotData::new(1); // slot 0 defaults to Null

        let html = walk_with_slots(&["msg"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &slots);
        assert_eq!(html, "<!--f:t0-->\u{200B}<!--/f:t0-->");
    }

    #[test]
    fn walk_dyn_text_empty_string_emits_zwsp() {
        // DYN_TEXT with explicit empty string also needs the ZWSP placeholder.
        let opcodes = encode_dyn_text(0, 0);
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(String::new()));

        let html = walk_with_slots(&["msg"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &slots);
        assert_eq!(html, "<!--f:t0-->\u{200B}<!--/f:t0-->");
    }

    // -- Test 8: walk_dyn_text_escaping ------------------------------------

    #[test]
    fn walk_dyn_text_escaping() {
        // DYN_TEXT value with HTML chars is escaped
        let opcodes = encode_dyn_text(0, 1);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("<b>bold</b>".to_string()));

        let html = walk_with_slots(&["content"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &slots);
        assert_eq!(html, "<!--f:t1-->&lt;b&gt;bold&lt;/b&gt;<!--/f:t1-->");
    }

    // -- Test 9: walk_island_markers ---------------------------------------

    #[test]
    fn walk_island_markers() {
        // ISLAND_START(0) + TEXT content + ISLAND_END(0)
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_text(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let html = walk_static(&["Hello"], &opcodes);
        assert_eq!(html, "<!--f:i0-->Hello<!--/f:i0-->");
    }

    // -- Test 10: walk_comment ---------------------------------------------

    #[test]
    fn walk_comment() {
        let opcodes = encode_comment(0);

        let html = walk_static(&["This is a comment"], &opcodes);
        assert_eq!(html, "<!--This is a comment-->");
    }

    // -- Test 11: walk_boolean_attr ----------------------------------------

    #[test]
    fn walk_boolean_attr() {
        // <input disabled> — attribute with empty string value renders as valueless
        // strings: 0="input", 1="disabled", 2="" (empty string for boolean attr)
        let opcodes = encode_void_tag(0, &[(1, 2)]);

        let html = walk_static(&["input", "disabled", ""], &opcodes);
        assert_eq!(html, "<input disabled>");
    }

    // -- Test 12: walk_multiple_attrs --------------------------------------

    #[test]
    fn walk_multiple_attrs() {
        // <div id="main" class="container" data-x="42"></div>
        // strings: 0="div", 1="id", 2="main", 3="class", 4="container", 5="data-x", 6="42"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2), (3, 4), (5, 6)]));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(
            &["div", "id", "main", "class", "container", "data-x", "42"],
            &opcodes,
        );
        assert_eq!(
            html,
            r#"<div id="main" class="container" data-x="42"></div>"#
        );
    }

    // -- Test 13: walk_show_if_true_branch ---------------------------------

    #[test]
    fn walk_show_if_true_branch() {
        // SHOW_IF(slot=0): then=TEXT("Yes"), else=TEXT("No")
        // slot 0 = Bool(true) → render "Yes"
        // strings: 0="visible", 1="Yes", 2="No"
        let then_ops = encode_text(1); // TEXT "Yes"
        let else_ops = encode_text(2); // TEXT "No"
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Bool(true));

        let html = walk_with_slots(
            &["visible", "Yes", "No"],
            &[(0, 0, 0x02, 0x00, &[])], // slot 0, name="visible", type=Bool
            &opcodes,
            &slots,
        );
        assert!(html.contains("Yes"), "should contain then-branch text");
        assert!(!html.contains("No"), "should NOT contain else-branch text");
        assert!(html.contains("<!--f:s0-->"), "should have opening marker");
        assert!(html.contains("<!--/f:s0-->"), "should have closing marker");
    }

    // -- Test 14: walk_show_if_false_branch --------------------------------

    #[test]
    fn walk_show_if_false_branch() {
        // SHOW_IF(slot=0): then=TEXT("Yes"), else=TEXT("No")
        // slot 0 = Bool(false) → render "No"
        let then_ops = encode_text(1);
        let else_ops = encode_text(2);
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Bool(false));

        let html = walk_with_slots(
            &["visible", "Yes", "No"],
            &[(0, 0, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(html.contains("No"), "should contain else-branch text");
        assert!(!html.contains("Yes"), "should NOT contain then-branch text");
        assert!(html.contains("<!--f:s0-->"), "should have opening marker");
        assert!(html.contains("<!--/f:s0-->"), "should have closing marker");
    }

    // -- Test 15: walk_show_if_truthy_text ---------------------------------

    #[test]
    fn walk_show_if_truthy_text() {
        // slot 0 = Text("hello") → truthy → render then branch
        let then_ops = encode_text(1);
        let else_ops = encode_text(2);
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("hello".to_string()));

        let html = walk_with_slots(
            &["greeting", "Shown", "Hidden"],
            &[(0, 0, 0x01, 0x00, &[])], // type=Text
            &opcodes,
            &slots,
        );
        assert!(html.contains("Shown"), "truthy text should render then branch");
        assert!(!html.contains("Hidden"), "truthy text should NOT render else branch");
    }

    // -- Test 16: walk_show_if_falsy_null ----------------------------------

    #[test]
    fn walk_show_if_falsy_null() {
        // slot 0 = Null (default) → falsy → render else branch
        let then_ops = encode_text(1);
        let else_ops = encode_text(2);
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let slots = SlotData::new(1); // slot 0 is Null by default

        let html = walk_with_slots(
            &["maybe", "Present", "Missing"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(html.contains("Missing"), "null should render else branch");
        assert!(!html.contains("Present"), "null should NOT render then branch");
    }

    // -- Test 17: walk_show_if_no_else ------------------------------------

    #[test]
    fn walk_show_if_no_else() {
        // SHOW_IF with empty else branch. When false, nothing rendered between markers.
        let then_ops = encode_text(1);
        let else_ops: Vec<u8> = vec![]; // empty else
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let slots = SlotData::new(1); // Null → false

        let html = walk_with_slots(
            &["flag", "Content"],
            &[(0, 0, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "<!--f:s0--><!--/f:s0-->", "empty else should produce only markers");
    }

    // -- Test 18: walk_show_if_nested -------------------------------------

    #[test]
    fn walk_show_if_nested() {
        // Outer SHOW_IF(slot=0, true) → then branch contains inner SHOW_IF(slot=1, false)
        // Inner then=TEXT("inner-yes"), inner else=TEXT("inner-no")
        // strings: 0="outer", 1="inner", 2="outer-yes", 3="outer-no", 4="inner-yes", 5="inner-no"
        let inner_then = encode_text(4);
        let inner_else = encode_text(5);
        let inner_show_if = encode_show_if(1, &inner_then, &inner_else);

        let outer_then = inner_show_if; // outer then = inner SHOW_IF
        let outer_else = encode_text(3);
        let opcodes = encode_show_if(0, &outer_then, &outer_else);

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Bool(true));  // outer true
        slots.set(1, SlotValue::Bool(false)); // inner false

        let html = walk_with_slots(
            &["outer", "inner", "outer-yes", "outer-no", "inner-yes", "inner-no"],
            &[(0, 0, 0x02, 0x00, &[]), (1, 1, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        );
        // Outer is true → walk inner. Inner is false → render "inner-no"
        assert!(html.contains("inner-no"), "nested: inner false should render inner else");
        assert!(!html.contains("inner-yes"), "nested: inner true branch should not render");
        assert!(!html.contains("outer-no"), "nested: outer else should not render");
        // Verify correct nesting of markers
        assert!(html.contains("<!--f:s0-->"), "should have outer opening marker");
        assert!(html.contains("<!--/f:s0-->"), "should have outer closing marker");
        assert!(html.contains("<!--f:s1-->"), "should have inner opening marker");
        assert!(html.contains("<!--/f:s1-->"), "should have inner closing marker");
    }

    // -- Test 19: walk_show_if_with_elements ------------------------------

    #[test]
    fn walk_show_if_with_elements() {
        // Then branch contains OPEN_TAG("span") + TEXT("Hello") + CLOSE_TAG("span")
        // strings: 0="flag", 1="span", 2="Hello", 3="Bye"
        let mut then_ops = Vec::new();
        then_ops.extend_from_slice(&encode_open_tag(1, &[]));
        then_ops.extend_from_slice(&encode_text(2));
        then_ops.extend_from_slice(&encode_close_tag(1));

        let else_ops = encode_text(3);
        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Bool(true));

        let html = walk_with_slots(
            &["flag", "span", "Hello", "Bye"],
            &[(0, 0, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html,
            "<!--f:s0--><span>Hello</span><!--/f:s0-->",
            "then branch should produce full HTML element"
        );
    }

    // -- Test 20: walk_list_renders_items -----------------------------------

    #[test]
    fn walk_list_renders_items() {
        // LIST(slot=0, item_slot=1): body = DYN_TEXT(slot=1, marker=0)
        // slot 0 = Array([Text("Alice"), Text("Bob")])
        // strings: 0="items", 1="item"
        let body = encode_dyn_text(1, 0);
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Text("Alice".to_string()),
                SlotValue::Text("Bob".to_string()),
            ]),
        );

        let html = walk_with_slots(
            &["items", "item"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])], // slot 0=Array, slot 1=Text
            &opcodes,
            &slots,
        );
        assert!(html.contains("Alice"), "should contain first item");
        assert!(html.contains("Bob"), "should contain second item");
        assert!(html.starts_with("<!--f:l0-->"), "should start with list open marker");
        assert!(html.ends_with("<!--/f:l0-->"), "should end with list close marker");
    }

    // -- Test 21: walk_list_empty_array ------------------------------------

    #[test]
    fn walk_list_empty_array() {
        // LIST(slot=0, item_slot=1): body = DYN_TEXT(slot=1, marker=0)
        // slot 0 = Array([])
        let body = encode_dyn_text(1, 0);
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Array(vec![]));

        let html = walk_with_slots(
            &["items", "item"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "<!--f:l0--><!--/f:l0-->", "empty array should produce only markers");
    }

    // -- Test 22: walk_list_with_elements ----------------------------------

    #[test]
    fn walk_list_with_elements() {
        // LIST(slot=0, item_slot=1): body = <li>DYN_TEXT(slot=1)</li>
        // slot 0 = Array([Text("A"), Text("B")])
        // strings: 0="items", 1="item", 2="li"
        let mut body = Vec::new();
        body.extend_from_slice(&encode_open_tag(2, &[]));
        body.extend_from_slice(&encode_dyn_text(1, 0));
        body.extend_from_slice(&encode_close_tag(2));

        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Text("A".to_string()),
                SlotValue::Text("B".to_string()),
            ]),
        );

        let html = walk_with_slots(
            &["items", "item", "li"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            html.contains("<li><!--f:t0-->A<!--/f:t0--></li><li><!--f:t0-->B<!--/f:t0--></li>"),
            "should render li elements with content, got: {html}"
        );
    }

    // -- Test 23: walk_list_null_slot --------------------------------------

    #[test]
    fn walk_list_null_slot() {
        // LIST(slot=0, item_slot=1): body = DYN_TEXT(slot=1, marker=0)
        // slot 0 = Null (not Array) → no iteration, empty markers
        let body = encode_dyn_text(1, 0);
        let opcodes = encode_list(0, 1, &body);

        let slots = SlotData::new(2); // slot 0 remains Null

        let html = walk_with_slots(
            &["items", "item"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "<!--f:l0--><!--/f:l0-->", "null slot should produce only markers");
    }

    // -- Test 24: walk_list_nested -----------------------------------------

    #[test]
    fn walk_list_nested() {
        // Outer LIST(slot=0, item_slot=1): each item is an Array
        // Inner LIST(slot=1, item_slot=2): each sub-item is Text
        // Body of inner: DYN_TEXT(slot=2, marker=0)
        // strings: 0="outer", 1="inner", 2="item"
        let inner_body = encode_dyn_text(2, 0);
        let inner_list = encode_list(1, 2, &inner_body);
        let opcodes = encode_list(0, 1, &inner_list);

        let mut slots = SlotData::new(3);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Array(vec![
                    SlotValue::Text("a".to_string()),
                    SlotValue::Text("b".to_string()),
                ]),
                SlotValue::Array(vec![
                    SlotValue::Text("c".to_string()),
                ]),
            ]),
        );

        let html = walk_with_slots(
            &["outer", "inner", "item"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x04, 0x00, &[]), (2, 2, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        // Verify all items rendered
        assert!(html.contains("a"), "should contain nested item 'a'");
        assert!(html.contains("b"), "should contain nested item 'b'");
        assert!(html.contains("c"), "should contain nested item 'c'");
        // Verify outer list markers
        assert!(html.starts_with("<!--f:l0-->"), "should have outer list open marker");
        assert!(html.ends_with("<!--/f:l0-->"), "should have outer list close marker");
        // Verify inner list markers present
        assert!(html.contains("<!--f:l1-->"), "should have inner list open marker");
        assert!(html.contains("<!--/f:l1-->"), "should have inner list close marker");
    }

    // -- Test 25: walk_list_depth_exceeded ---------------------------------

    #[test]
    fn walk_list_depth_exceeded() {
        // Nest 5 lists deep (exceeds MAX_LIST_DEPTH of 4)
        // Innermost body is a DYN_TEXT
        // strings: 0..=5 = "s0".."s5"
        let innermost_body = encode_dyn_text(5, 0);
        // Build from inside out: level 5 (innermost) → level 1 (outermost)
        let level5 = encode_list(4, 5, &innermost_body);
        let level4 = encode_list(3, 4, &level5);
        let level3 = encode_list(2, 3, &level4);
        let level2 = encode_list(1, 2, &level3);
        let level1 = encode_list(0, 1, &level2);

        let mut slots = SlotData::new(6);
        // Each level needs an array with at least one item to trigger iteration
        slots.set(0, SlotValue::Array(vec![SlotValue::Array(vec![
            SlotValue::Array(vec![SlotValue::Array(vec![
                SlotValue::Array(vec![SlotValue::Text("deep".to_string())]),
            ])]),
        ])]));
        // Inner slots get shadowed during iteration

        let data = build_minimal_ir(
            &["s0", "s1", "s2", "s3", "s4", "s5"],
            &[
                (0, 0, 0x04, 0x00, &[]), (1, 1, 0x04, 0x00, &[]), (2, 2, 0x04, 0x00, &[]),
                (3, 3, 0x04, 0x00, &[]), (4, 4, 0x04, 0x00, &[]), (5, 5, 0x01, 0x00, &[]),
            ],
            &level1,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();
        let result = walk_to_html(&module, &slots);
        assert!(result.is_err(), "should fail with depth exceeded");
        match result.unwrap_err() {
            IrError::ListDepthExceeded { max: 4 } => {}
            other => panic!("expected ListDepthExceeded {{ max: 4 }}, got {other:?}"),
        }
    }

    // -- Test 26: walk_switch_matching_case --------------------------------

    #[test]
    fn walk_switch_matching_case() {
        // SWITCH(slot=0): cases [("home", TEXT "Home"), ("about", TEXT "About")]
        // slot 0 = Text("about") → render "About"
        // strings: 0="page", 1="home", 2="Home", 3="about", 4="About"
        let case_home_body = encode_text(2); // TEXT "Home"
        let case_about_body = encode_text(4); // TEXT "About"
        let opcodes = encode_switch(0, &[(1, &case_home_body), (3, &case_about_body)]);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("about".to_string()));

        let html = walk_with_slots(
            &["page", "home", "Home", "about", "About"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(html.contains("About"), "should contain matching case text");
        assert!(!html.contains("Home"), "should NOT contain non-matching case text");
    }

    // -- Test 27: walk_switch_no_match ------------------------------------

    #[test]
    fn walk_switch_no_match() {
        // SWITCH(slot=0): cases [("home", TEXT "Home"), ("about", TEXT "About")]
        // slot 0 = Text("missing") → no match, empty output
        // strings: 0="page", 1="home", 2="Home", 3="about", 4="About"
        let case_home_body = encode_text(2);
        let case_about_body = encode_text(4);
        let opcodes = encode_switch(0, &[(1, &case_home_body), (3, &case_about_body)]);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("missing".to_string()));

        let html = walk_with_slots(
            &["page", "home", "Home", "about", "About"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(html.is_empty(), "no match should produce empty output, got: {html}");
    }

    // -- Test 28: walk_switch_first_case ----------------------------------

    #[test]
    fn walk_switch_first_case() {
        // SWITCH(slot=0): cases [("home", TEXT "Home"), ("about", TEXT "About")]
        // slot 0 = Text("home") → matches first case, render "Home"
        let case_home_body = encode_text(2);
        let case_about_body = encode_text(4);
        let opcodes = encode_switch(0, &[(1, &case_home_body), (3, &case_about_body)]);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("home".to_string()));

        let html = walk_with_slots(
            &["page", "home", "Home", "about", "About"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(html.contains("Home"), "should contain first case text");
        assert!(!html.contains("About"), "should NOT contain second case text");
    }

    // -- Test 29: walk_switch_with_elements -------------------------------

    #[test]
    fn walk_switch_with_elements() {
        // SWITCH(slot=0): matching case body = <span>Active</span>
        // strings: 0="page", 1="active", 2="span", 3="Active", 4="inactive", 5="Inactive"
        let mut active_body = Vec::new();
        active_body.extend_from_slice(&encode_open_tag(2, &[]));
        active_body.extend_from_slice(&encode_text(3));
        active_body.extend_from_slice(&encode_close_tag(2));

        let inactive_body = encode_text(5);
        let opcodes = encode_switch(0, &[(1, &active_body), (4, &inactive_body)]);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("active".to_string()));

        let html = walk_with_slots(
            &["page", "active", "span", "Active", "inactive", "Inactive"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "<span>Active</span>", "should produce full HTML element from matching case");
    }

    // -- Test 30: walk_try_renders_main -----------------------------------

    #[test]
    fn walk_try_renders_main() {
        // TRY_START with main body TEXT "Main" + FALLBACK TEXT "Fallback"
        // strings: 0="Main", 1="Fallback"
        let main_ops = encode_text(0);
        let fallback_ops = encode_text(1);
        let opcodes = encode_try(&main_ops, &fallback_ops);

        let html = walk_static(&["Main", "Fallback"], &opcodes);
        assert!(html.contains("Main"), "should contain main body text");
        assert!(!html.contains("Fallback"), "should NOT contain fallback text");
    }

    // -- Test 31: walk_preload_font ---------------------------------------

    #[test]
    fn walk_preload_font() {
        // PRELOAD resource_type=1 (font), url="/_assets/dm-mono.woff2"
        // strings: 0="/_assets/dm-mono.woff2"
        let opcodes = encode_preload(1, 0);

        let html = walk_static(&["/_assets/dm-mono.woff2"], &opcodes);
        assert!(
            html.contains(r#"<link rel="preload" href="/_assets/dm-mono.woff2" as="font" type="font/woff2" crossorigin>"#),
            "should produce preload link for font, got: {html}"
        );
    }

    // -- Test 32: walk_preload_style --------------------------------------

    #[test]
    fn walk_preload_style() {
        // PRELOAD resource_type=2 (style), url="/_assets/styles.css"
        // strings: 0="/_assets/styles.css"
        let opcodes = encode_preload(2, 0);

        let html = walk_static(&["/_assets/styles.css"], &opcodes);
        assert!(
            html.contains(r#"as="style""#),
            "should contain as=\"style\", got: {html}"
        );
        assert!(
            html.contains(r#"href="/_assets/styles.css""#),
            "should contain correct href, got: {html}"
        );
    }

    // =========================================================================
    // Hydration-roundtrip tests — verify walker produces exact expected HTML
    // from programmatically-built IR. These tests complement the TS-side
    // roundtrip tests (ir-roundtrip.test.ts) to ensure the binary contract
    // between the TS emitter and the Rust walker is correct.
    // =========================================================================

    // -- Roundtrip 1: Full page skeleton ------------------------------------

    #[test]
    fn roundtrip_page_structure() {
        // Build IR for a realistic page skeleton:
        // <html lang="en"><head><meta charset="utf-8"><title>Test</title></head>
        // <body><div id="app"></div></body></html>
        //
        // strings: 0="html", 1="lang", 2="en", 3="head", 4="meta",
        //          5="charset", 6="utf-8", 7="title", 8="Test",
        //          9="body", 10="div", 11="id", 12="app"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));           // <html lang="en">
        opcodes.extend_from_slice(&encode_open_tag(3, &[]));                 // <head>
        opcodes.extend_from_slice(&encode_void_tag(4, &[(5, 6)]));           // <meta charset="utf-8">
        opcodes.extend_from_slice(&encode_open_tag(7, &[]));                 // <title>
        opcodes.extend_from_slice(&encode_text(8));                          // Test
        opcodes.extend_from_slice(&encode_close_tag(7));                     // </title>
        opcodes.extend_from_slice(&encode_close_tag(3));                     // </head>
        opcodes.extend_from_slice(&encode_open_tag(9, &[]));                 // <body>
        opcodes.extend_from_slice(&encode_open_tag(10, &[(11, 12)]));        // <div id="app">
        opcodes.extend_from_slice(&encode_close_tag(10));                    // </div>
        opcodes.extend_from_slice(&encode_close_tag(9));                     // </body>
        opcodes.extend_from_slice(&encode_close_tag(0));                     // </html>

        let ir = build_minimal_ir(
            &[
                "html", "lang", "en", "head", "meta", "charset", "utf-8",
                "title", "Test", "body", "div", "id", "app",
            ],
            &[],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&ir).unwrap();
        let slots = SlotData::new(0);
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(
            html,
            r#"<html lang="en"><head><meta charset="utf-8"><title>Test</title></head><body><div id="app"></div></body></html>"#
        );
    }

    // -- Roundtrip 2: Dynamic greeting with DYN_TEXT ------------------------

    #[test]
    fn roundtrip_dynamic_greeting() {
        // Build IR for: <div class="greeting"><!--f:t0-->Hello, World<!--/f:t0--></div>
        // with slot 0 = Text("Hello, World")
        //
        // strings: 0="div", 1="class", 2="greeting", 3="content"
        // slot decl: slot_id=0, name_str_idx=3 ("content"), type=Text
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)])); // <div class="greeting">
        opcodes.extend_from_slice(&encode_dyn_text(0, 0));         // DYN_TEXT slot=0 marker=0
        opcodes.extend_from_slice(&encode_close_tag(0));           // </div>

        let ir = build_minimal_ir(
            &["div", "class", "greeting", "content"],
            &[(0, 3, 0x01, 0x00, &[])], // slot 0, name="content", type=Text
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&ir).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("Hello, World".into()));
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(
            html,
            r#"<div class="greeting"><!--f:t0-->Hello, World<!--/f:t0--></div>"#
        );
    }

    // -- Roundtrip 3: Conditional content (SHOW_IF both branches) -----------

    #[test]
    fn roundtrip_conditional_content() {
        // SHOW_IF slot=0
        //   then: <span class="badge">Logged In</span>
        //   else: <span class="badge">Guest</span>
        //
        // strings: 0="auth", 1="span", 2="class", 3="badge",
        //          4="Logged In", 5="Guest"
        let mut then_ops = Vec::new();
        then_ops.extend_from_slice(&encode_open_tag(1, &[(2, 3)]));
        then_ops.extend_from_slice(&encode_text(4));
        then_ops.extend_from_slice(&encode_close_tag(1));

        let mut else_ops = Vec::new();
        else_ops.extend_from_slice(&encode_open_tag(1, &[(2, 3)]));
        else_ops.extend_from_slice(&encode_text(5));
        else_ops.extend_from_slice(&encode_close_tag(1));

        let opcodes = encode_show_if(0, &then_ops, &else_ops);

        let ir = build_minimal_ir(
            &["auth", "span", "class", "badge", "Logged In", "Guest"],
            &[(0, 0, 0x02, 0x00, &[])], // slot 0, name="auth", type=Bool
            &opcodes,
            &[],
        );

        // Test true branch
        {
            let module = IrModule::parse(&ir).unwrap();
            let mut slots = SlotData::new(1);
            slots.set(0, SlotValue::Bool(true));
            let html = walk_to_html(&module, &slots).unwrap();
            assert_eq!(
                html,
                r#"<!--f:s0--><span class="badge">Logged In</span><!--/f:s0-->"#
            );
        }

        // Test false branch
        {
            let module = IrModule::parse(&ir).unwrap();
            let mut slots = SlotData::new(1);
            slots.set(0, SlotValue::Bool(false));
            let html = walk_to_html(&module, &slots).unwrap();
            assert_eq!(
                html,
                r#"<!--f:s0--><span class="badge">Guest</span><!--/f:s0-->"#
            );
        }
    }

    // -- Roundtrip 4: List rendering ----------------------------------------

    #[test]
    fn roundtrip_list_rendering() {
        // LIST slot=0 item=1 → <li><!--f:t0-->{item}<!--/f:t0--></li>
        // Items: ["Alice", "Bob", "Charlie"]
        //
        // strings: 0="items", 1="item", 2="li"
        // slot decls: slot 0=Array, slot 1=Text (item)
        let mut body = Vec::new();
        body.extend_from_slice(&encode_open_tag(2, &[]));    // <li>
        body.extend_from_slice(&encode_dyn_text(1, 0));      // DYN_TEXT slot=1 marker=0
        body.extend_from_slice(&encode_close_tag(2));        // </li>

        let opcodes = encode_list(0, 1, &body);

        let ir = build_minimal_ir(
            &["items", "item", "li"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])], // slot 0=Array, slot 1=Text
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&ir).unwrap();
        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Text("Alice".into()),
                SlotValue::Text("Bob".into()),
                SlotValue::Text("Charlie".into()),
            ]),
        );
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(
            html,
            "<!--f:l0-->\
             <li><!--f:t0-->Alice<!--/f:t0--></li>\
             <li><!--f:t0-->Bob<!--/f:t0--></li>\
             <li><!--f:t0-->Charlie<!--/f:t0--></li>\
             <!--/f:l0-->"
        );
    }

    // -- Roundtrip 5: Switch view -------------------------------------------

    #[test]
    fn roundtrip_switch_view() {
        // SWITCH slot=0, cases: "home" → <h1>Home</h1>, "about" → <h1>About</h1>
        // slot = "about"
        //
        // strings: 0="page", 1="home", 2="h1", 3="Home", 4="about", 5="About"
        let mut home_body = Vec::new();
        home_body.extend_from_slice(&encode_open_tag(2, &[]));
        home_body.extend_from_slice(&encode_text(3));
        home_body.extend_from_slice(&encode_close_tag(2));

        let mut about_body = Vec::new();
        about_body.extend_from_slice(&encode_open_tag(2, &[]));
        about_body.extend_from_slice(&encode_text(5));
        about_body.extend_from_slice(&encode_close_tag(2));

        let opcodes = encode_switch(0, &[(1, &home_body), (4, &about_body)]);

        let ir = build_minimal_ir(
            &["page", "home", "h1", "Home", "about", "About"],
            &[(0, 0, 0x01, 0x00, &[])], // slot 0, name="page", type=Text
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&ir).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("about".into()));
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(html, "<h1>About</h1>");
    }

    // -- Roundtrip 6: Nested realistic structure ----------------------------

    #[test]
    fn roundtrip_nested_structure() {
        // Realistic page fragment: nav with conditional auth + list of links
        //
        // <nav class="main-nav">
        //   <!--f:s0-->  (SHOW_IF: logged in?)
        //     <span>Welcome</span>
        //   <!--/f:s0-->
        //   <ul>
        //     <!--f:l1-->  (LIST: nav items)
        //       <li><!--f:t0-->{item}<!--/f:t0--></li>
        //     <!--/f:l1-->
        //   </ul>
        // </nav>
        //
        // strings: 0="nav", 1="class", 2="main-nav", 3="auth",
        //          4="span", 5="Welcome", 6="items", 7="item",
        //          8="ul", 9="li"
        //
        // slots: 0=Bool (auth), 1=Array (items), 2=Text (item shadow)

        // SHOW_IF then body: <span>Welcome</span>
        let mut then_ops = Vec::new();
        then_ops.extend_from_slice(&encode_open_tag(4, &[]));
        then_ops.extend_from_slice(&encode_text(5));
        then_ops.extend_from_slice(&encode_close_tag(4));

        let show_if_ops = encode_show_if(0, &then_ops, &[]);

        // LIST body: <li>DYN_TEXT(slot=2)</li>
        let mut list_body = Vec::new();
        list_body.extend_from_slice(&encode_open_tag(9, &[]));
        list_body.extend_from_slice(&encode_dyn_text(2, 0));
        list_body.extend_from_slice(&encode_close_tag(9));

        let list_ops = encode_list(1, 2, &list_body);

        // Full opcode stream
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)])); // <nav class="main-nav">
        opcodes.extend_from_slice(&show_if_ops);                    // SHOW_IF auth
        opcodes.extend_from_slice(&encode_open_tag(8, &[]));       // <ul>
        opcodes.extend_from_slice(&list_ops);                       // LIST items
        opcodes.extend_from_slice(&encode_close_tag(8));           // </ul>
        opcodes.extend_from_slice(&encode_close_tag(0));           // </nav>

        let ir = build_minimal_ir(
            &[
                "nav", "class", "main-nav", "auth", "span", "Welcome",
                "items", "item", "ul", "li",
            ],
            &[
                (0, 3, 0x02, 0x00, &[]), // slot 0 = Bool (auth)
                (1, 6, 0x04, 0x00, &[]), // slot 1 = Array (items)
                (2, 7, 0x01, 0x00, &[]), // slot 2 = Text (item)
            ],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&ir).unwrap();
        let mut slots = SlotData::new(3);
        slots.set(0, SlotValue::Bool(true));
        slots.set(
            1,
            SlotValue::Array(vec![
                SlotValue::Text("Home".into()),
                SlotValue::Text("About".into()),
            ]),
        );

        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(
            html,
            r#"<nav class="main-nav"><!--f:s0--><span>Welcome</span><!--/f:s0--><ul><!--f:l1--><li><!--f:t0-->Home<!--/f:t0--></li><li><!--f:t0-->About<!--/f:t0--></li><!--/f:l1--></ul></nav>"#
        );
    }

    // =========================================================================
    // Island attribute injection tests
    // =========================================================================

    // -- Test 33: walk_island_attrs_on_open_tag --------------------------------

    #[test]
    fn walk_island_attrs_on_open_tag() {
        // ISLAND_START(0) + OPEN_TAG("div") + TEXT("Hello") + CLOSE_TAG("div") + ISLAND_END(0)
        // With island table entry: id=0, trigger=Load, props=Inline, name="AuthForm", no slots
        // strings: 0="div", 1="Hello", 2="AuthForm"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_text(1));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["div", "Hello", "AuthForm"],
            &[],
            // island: id=0, trigger=Load(0x01), props=Inline(0x01), name_str_idx=2, byte_offset=0, no slot_ids
            &[(0, 0x01, 0x01, 2, 0, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html,
            r#"<!--f:i0--><div data-forma-island="0" data-forma-component="AuthForm" data-forma-status="pending" data-forma-hydrate="load">Hello</div><!--/f:i0-->"#
        );
    }

    // -- Test 34: walk_island_attrs_with_existing_attrs -----------------------

    #[test]
    fn walk_island_attrs_with_existing_attrs() {
        // ISLAND_START(0) + OPEN_TAG("div" class="form") + CLOSE_TAG + ISLAND_END(0)
        // strings: 0="div", 1="class", 2="form", 3="AuthForm"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["div", "class", "form", "AuthForm"],
            &[],
            &[(0, 0x01, 0x01, 3, 0, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html,
            r#"<!--f:i0--><div class="form" data-forma-island="0" data-forma-component="AuthForm" data-forma-status="pending" data-forma-hydrate="load"></div><!--/f:i0-->"#
        );
    }

    // -- Test 35: walk_island_attrs_on_void_tag -------------------------------

    #[test]
    fn walk_island_attrs_on_void_tag() {
        // ISLAND_START(0) + VOID_TAG("input") + ISLAND_END(0)
        // strings: 0="input", 1="Widget"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_void_tag(0, &[]));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["input", "Widget"],
            &[],
            &[(0, 0x01, 0x01, 1, 0, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html,
            r#"<!--f:i0--><input data-forma-island="0" data-forma-component="Widget" data-forma-status="pending" data-forma-hydrate="load"><!--/f:i0-->"#
        );
    }

    // -- Test 36: walk_inline_props_attribute ---------------------------------

    #[test]
    fn walk_inline_props_attribute() {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Island entry has slots [0, 1], PropsMode::Inline
        // Slot 0 = "title" (Text), Slot 1 = "count" (Number)
        // strings: 0="div", 1="MyComponent", 2="title", 3="count"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("Hello".to_string()));
        slots.set(1, SlotValue::Number(42.0));

        let html = walk_with_islands(
            &["div", "MyComponent", "title", "count"],
            &[
                (0, 2, 0x01, 0x00, &[]), // slot 0, name="title", Text, Server
                (1, 3, 0x03, 0x00, &[]), // slot 1, name="count", Number, Server
            ],
            // island: id=0, Load, Inline, name_str_idx=1, byte_offset=0, slot_ids=[0, 1]
            &[(0, 0x01, 0x01, 1, 0, &[0, 1])],
            &opcodes,
            &slots,
        );
        // Props should be JSON: {"title":"Hello","count":42}
        assert!(
            html.contains("data-forma-props="),
            "should contain data-forma-props, got: {html}"
        );
        assert!(
            html.contains(r#"data-forma-island="0""#),
            "should contain island id, got: {html}"
        );
        assert!(
            html.contains(r#"data-forma-component="MyComponent""#),
            "should contain component name, got: {html}"
        );
        // Parse the JSON from the props attribute to verify correctness.
        // The attribute uses double quotes with HTML entity escaping:
        //   data-forma-props="{&quot;title&quot;:&quot;Hello&quot;,&quot;count&quot;:42}"
        // Browsers auto-decode &quot; back to " when reading getAttribute(),
        // so we simulate that here by reversing the entity encoding.
        let marker = "data-forma-props=\"";
        let props_start = html.find(marker).unwrap() + marker.len();
        let props_end = html[props_start..].find('"').unwrap() + props_start;
        let raw_attr = &html[props_start..props_end];
        let decoded = raw_attr
            .replace("&quot;", "\"")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">");
        let props_json: serde_json::Value = serde_json::from_str(&decoded).unwrap();
        assert_eq!(props_json["title"], "Hello");
        assert_eq!(props_json["count"], 42);
    }

    // -- Test 37: walk_list_item_key_on_first_open_tag -----------------------

    #[test]
    fn walk_list_item_key_on_first_open_tag() {
        // LIST_ITEM_KEY(key_str_idx=1) + OPEN_TAG("li") + TEXT("item") + CLOSE_TAG
        // strings: 0="li", 1="user-123", 2="item"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_list_item_key(1));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_text(2));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["li", "user-123", "item"], &opcodes);
        assert_eq!(
            html,
            r#"<li data-forma-key="user-123">item</li>"#
        );
    }

    // -- Test 38: walk_list_item_key_on_void_tag -----------------------------

    #[test]
    fn walk_list_item_key_on_void_tag() {
        // LIST_ITEM_KEY(key_str_idx=1) + VOID_TAG("hr")
        // strings: 0="hr", 1="key-42"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_list_item_key(1));
        opcodes.extend_from_slice(&encode_void_tag(0, &[]));

        let html = walk_static(&["hr", "key-42"], &opcodes);
        assert_eq!(
            html,
            r#"<hr data-forma-key="key-42">"#
        );
    }

    // -- Test 39: walk_list_item_key_with_attrs ------------------------------

    #[test]
    fn walk_list_item_key_with_attrs() {
        // LIST_ITEM_KEY + OPEN_TAG("li" class="item") + TEXT + CLOSE_TAG
        // strings: 0="li", 1="class", 2="item", 3="k1", 4="content"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_list_item_key(3));
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)]));
        opcodes.extend_from_slice(&encode_text(4));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["li", "class", "item", "k1", "content"], &opcodes);
        assert_eq!(
            html,
            r#"<li class="item" data-forma-key="k1">content</li>"#
        );
    }

    // -- Test 40: walk_script_tag_props_mode ---------------------------------

    #[test]
    fn walk_script_tag_props_mode() {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Island entry: PropsMode::ScriptTag with slots [0]
        // strings: 0="div", 1="Counter", 2="label"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("Click me".to_string()));

        let html = walk_with_islands(
            &["div", "Counter", "label"],
            &[(0, 2, 0x01, 0x00, &[])], // slot 0, name="label", Text, Server
            // island: id=0, Load, ScriptTag(0x02), name_str_idx=1, byte_offset=0, slot_ids=[0]
            &[(0, 0x01, 0x02, 1, 0, &[0])],
            &opcodes,
            &slots,
        );
        // Should NOT have inline data-forma-props
        assert!(
            !html.contains("data-forma-props"),
            "ScriptTag mode should not emit inline props, got: {html}"
        );
        // Should have island attrs
        assert!(
            html.contains(r#"data-forma-island="0""#),
            "should contain island id"
        );
        // Should have script tag at the end
        assert!(
            html.contains(r#"<script id="__forma_islands" type="application/json">"#),
            "should contain script tag, got: {html}"
        );
        assert!(html.contains("</script>"), "should close script tag");
        // Parse the JSON from the script tag
        let script_start = html.find(r#"type="application/json">"#).unwrap()
            + r#"type="application/json">"#.len();
        let script_end = html[script_start..].find("</script>").unwrap() + script_start;
        let json: serde_json::Value =
            serde_json::from_str(&html[script_start..script_end]).unwrap();
        assert_eq!(json["0"]["label"], "Click me");
    }

    // -- Test 41: walk_deferred_props_mode -----------------------------------

    #[test]
    fn walk_deferred_props_mode() {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Island entry: PropsMode::Deferred — should not emit props at all
        // strings: 0="div", 1="LazyWidget", 2="data"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("ignored".to_string()));

        let html = walk_with_islands(
            &["div", "LazyWidget", "data"],
            &[(0, 2, 0x01, 0x00, &[])],
            // island: id=0, Load, Deferred(0x03), name_str_idx=1, byte_offset=0, slot_ids=[0]
            &[(0, 0x01, 0x03, 1, 0, &[0])],
            &opcodes,
            &slots,
        );
        assert!(
            !html.contains("data-forma-props"),
            "Deferred mode should not emit inline props, got: {html}"
        );
        assert!(
            !html.contains("__forma_islands"),
            "Deferred mode should not emit script tag, got: {html}"
        );
        // Should still have island attrs
        assert!(
            html.contains(r#"data-forma-island="0""#),
            "should contain island id"
        );
        assert!(
            html.contains(r#"data-forma-component="LazyWidget""#),
            "should contain component name"
        );
    }

    // -- Test 42: walk_island_no_entry_in_table -------------------------------

    #[test]
    fn walk_island_no_entry_in_table() {
        // ISLAND_START(5) with no matching entry in island table
        // Should still emit comment markers but no data-forma attrs
        // strings: 0="div", 1="Hello"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(5));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_text(1));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(5));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["div", "Hello"],
            &[],
            &[], // no islands in table
            &opcodes,
            &slots,
        );
        assert_eq!(
            html,
            "<!--f:i5--><div>Hello</div><!--/f:i5-->"
        );
    }

    // -- Test 43: walk_inline_props_empty_slots ------------------------------

    #[test]
    fn walk_inline_props_empty_slots() {
        // Island with Inline props mode but no slot_ids — should not emit data-forma-props
        // strings: 0="div", 1="Simple"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["div", "Simple"],
            &[],
            &[(0, 0x01, 0x01, 1, 0, &[])], // no slot_ids
            &opcodes,
            &slots,
        );
        assert!(
            !html.contains("data-forma-props"),
            "empty slot_ids should not emit props, got: {html}"
        );
        assert!(
            html.contains(r#"data-forma-island="0""#),
            "should contain island id"
        );
    }

    // -- Test 44: walk_island_and_list_key_combined --------------------------

    #[test]
    fn walk_island_and_list_key_combined() {
        // ISLAND_START(0) + LIST_ITEM_KEY + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Both pending_island and pending_list_key active on same OPEN_TAG
        // strings: 0="div", 1="Card", 2="item-1"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_list_item_key(2));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["div", "Card", "item-1"],
            &[],
            &[(0, 0x01, 0x01, 1, 0, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            html.contains(r#"data-forma-island="0""#),
            "should contain island attrs"
        );
        assert!(
            html.contains(r#"data-forma-key="item-1""#),
            "should contain list key attr, got: {html}"
        );
    }

    // -- Test 45: walk_multiple_islands_script_tag ---------------------------

    #[test]
    fn walk_multiple_islands_script_tag() {
        // Two islands, both ScriptTag mode, should produce a single script tag
        // with both entries
        // strings: 0="div", 1="span", 2="CompA", 3="CompB", 4="msg", 5="flag"
        let mut opcodes = Vec::new();
        // Island 0
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));
        // Island 1
        opcodes.extend_from_slice(&encode_island_start(1));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(1));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("hello".to_string()));
        slots.set(1, SlotValue::Bool(true));

        let html = walk_with_islands(
            &["div", "span", "CompA", "CompB", "msg", "flag"],
            &[
                (0, 4, 0x01, 0x00, &[]), // slot 0, name="msg", Text
                (1, 5, 0x02, 0x00, &[]), // slot 1, name="flag", Bool
            ],
            &[
                (0, 0x01, 0x02, 2, 0, &[0]), // island 0, ScriptTag, name="CompA", byte_offset=0, slots=[0]
                (1, 0x01, 0x02, 3, 0, &[1]), // island 1, ScriptTag, name="CompB", byte_offset=0, slots=[1]
            ],
            &opcodes,
            &slots,
        );
        // Parse the script tag JSON
        let script_start = html.find(r#"type="application/json">"#).unwrap()
            + r#"type="application/json">"#.len();
        let script_end = html[script_start..].find("</script>").unwrap() + script_start;
        let json: serde_json::Value =
            serde_json::from_str(&html[script_start..script_end]).unwrap();
        assert_eq!(json["0"]["msg"], "hello");
        assert_eq!(json["1"]["flag"], true);
    }

    // -- Test 46: walk_list_item_key_consumed_once --------------------------

    #[test]
    fn walk_list_item_key_consumed_once() {
        // LIST_ITEM_KEY + OPEN_TAG("li") + OPEN_TAG("span") + TEXT + CLOSE_TAG("span") + CLOSE_TAG("li")
        // Key should only appear on the first tag (li), not span
        // strings: 0="li", 1="span", 2="abc", 3="text"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_list_item_key(2));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_text(3));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let html = walk_static(&["li", "span", "abc", "text"], &opcodes);
        assert_eq!(
            html,
            r#"<li data-forma-key="abc"><span>text</span></li>"#
        );
    }

    // -- Test 47: walk_slot_value_to_json -----------------------------------

    #[test]
    fn slot_value_to_json_all_types() {
        // Verify SlotValue::to_json() for all variants
        assert_eq!(SlotValue::Null.to_json(), serde_json::Value::Null);
        assert_eq!(
            SlotValue::Text("hello".to_string()).to_json(),
            serde_json::Value::String("hello".to_string())
        );
        assert_eq!(SlotValue::Bool(true).to_json(), serde_json::Value::Bool(true));
        assert_eq!(SlotValue::Bool(false).to_json(), serde_json::Value::Bool(false));
        assert_eq!(
            SlotValue::Number(42.0).to_json(),
            serde_json::json!(42)
        );
        assert_eq!(
            SlotValue::Number(3.15).to_json(),
            serde_json::json!(3.15)
        );
        assert_eq!(
            SlotValue::Array(vec![SlotValue::Text("a".to_string()), SlotValue::Number(1.0)]).to_json(),
            serde_json::json!(["a", 1])
        );
        assert_eq!(
            SlotValue::Object(vec![
                ("key".to_string(), SlotValue::Text("val".to_string())),
            ]).to_json(),
            serde_json::json!({"key": "val"})
        );
    }

    // -- Test 48: dyn_attr_emits_attribute_with_value ----------------------

    #[test]
    fn dyn_attr_emits_attribute_with_value() {
        // OPEN_TAG("input") + DYN_ATTR("type", slot=0) + CLOSE_TAG("input")
        // slot 0 = Text("password") → <input type="password"></input>
        // strings: 0="input", 1="type", 2="input_type" (slot name)
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("password".to_string()));

        let html = walk_with_slots(
            &["input", "type", "input_type"],
            &[(0, 2, 0x01, 0x01, b"password")], // slot_id=0, name_str_idx=2, Text, Client, default="password"
            &opcodes,
            &slots,
        );
        assert_eq!(html, r#"<input type="password"></input>"#);
    }

    // -- Test 49: dyn_attr_skips_when_slot_null ----------------------------

    #[test]
    fn dyn_attr_skips_when_slot_null() {
        // DYN_ATTR with Null slot value should emit no attribute at all.
        // <div> (no class attr) </div>
        // strings: 0="div", 1="class", 2="cls" (slot name)
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let slots = SlotData::new(1); // slot 0 is Null by default

        let html = walk_with_slots(
            &["div", "class", "cls"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "<div></div>");
    }

    // -- Test 50: dyn_attr_multiple_on_same_element ------------------------

    #[test]
    fn dyn_attr_multiple_on_same_element() {
        // OPEN_TAG("input") + DYN_ATTR("type", slot=0) + DYN_ATTR("class", slot=1) + CLOSE_TAG
        // strings: 0="input", 1="type", 2="class", 3="slot_type", 4="slot_class"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        opcodes.extend_from_slice(&encode_dyn_attr(2, 1));
        opcodes.extend_from_slice(&encode_close_tag(0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("email".to_string()));
        slots.set(1, SlotValue::Text("form-input".to_string()));

        let html = walk_with_slots(
            &["input", "type", "class", "slot_type", "slot_class"],
            &[
                (0, 3, 0x01, 0x01, b"text"),
                (1, 4, 0x01, 0x01, b""),
            ],
            &opcodes,
            &slots,
        );
        assert_eq!(html, r#"<input type="email" class="form-input"></input>"#);
    }

    // -- Test 51: dyn_attr_on_void_tag -------------------------------------

    #[test]
    fn dyn_attr_on_void_tag() {
        // VOID_TAG("input") + DYN_ATTR("type", slot=0)
        // slot 0 = Text("checkbox") → <input type="checkbox">
        // strings: 0="input", 1="type", 2="slot_type"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_void_tag(0, &[]));
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("checkbox".to_string()));

        let html = walk_with_slots(
            &["input", "type", "slot_type"],
            &[(0, 2, 0x01, 0x01, b"text")],
            &opcodes,
            &slots,
        );
        assert_eq!(html, r#"<input type="checkbox">"#);
    }

    // -- walk_island tests -------------------------------------------------

    #[test]
    fn walk_island_basic() {
        // Build IR with an island containing <p>hello</p>
        // strings: 0="MyIsland", 1="div", 2="p", 3="hello"
        // We need a wrapper div before the island, the island content, and wrapper close.
        //
        // Opcodes layout:
        // OPEN_TAG "div" []       -> offset 0
        // ISLAND_START id=0       -> offset X (byte_offset for island table)
        // OPEN_TAG "p" []
        // TEXT "hello"
        // CLOSE_TAG "p"
        // ISLAND_END id=0
        // CLOSE_TAG "div"

        let pre_island = encode_open_tag(1, &[]); // OPEN_TAG "div" -> str_idx=1
        let island_start = encode_island_start(0);
        let open_p = encode_open_tag(2, &[]); // OPEN_TAG "p" -> str_idx=2
        let text_hello = encode_text(3);
        let close_p = encode_close_tag(2);
        let island_end = encode_island_end(0);
        let close_div = encode_close_tag(1);

        let byte_offset = pre_island.len() as u32; // island starts after the div open

        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&pre_island);
        opcodes.extend_from_slice(&island_start);
        opcodes.extend_from_slice(&open_p);
        opcodes.extend_from_slice(&text_hello);
        opcodes.extend_from_slice(&close_p);
        opcodes.extend_from_slice(&island_end);
        opcodes.extend_from_slice(&close_div);

        let data = build_minimal_ir(
            &["MyIsland", "div", "p", "hello"],
            &[],
            &opcodes,
            &[(0, 0x01, 0x01, 0, byte_offset, &[])], // island 0, Load, Inline, name="MyIsland"
        );
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);

        let html = walk_island(&module, &slots, 0).unwrap();
        assert_eq!(html, "<p>hello</p>");
    }

    #[test]
    fn walk_island_not_found() {
        // Build IR with no islands, then request island_id=5
        let opcodes = encode_text(0);
        let data = build_minimal_ir(&["Hello"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);

        let result = walk_island(&module, &slots, 5);
        assert!(result.is_err());
        match result.unwrap_err() {
            IrError::IslandNotFound(5) => {} // expected
            other => panic!("expected IslandNotFound(5), got {other:?}"),
        }
    }

    #[test]
    fn walk_island_with_dyn_text() {
        // Island containing DYN_TEXT that references a slot
        // strings: 0="IslandComp", 1="div", 2="greeting"
        // slot 0: name_str_idx=2 ("greeting"), type=Text

        let island_start = encode_island_start(0);
        let open_div = encode_open_tag(1, &[]); // str_idx=1 -> "div"
        let dyn_text = encode_dyn_text(0, 0); // slot_id=0, marker_id=0
        let close_div = encode_close_tag(1);
        let island_end = encode_island_end(0);

        let byte_offset = 0u32; // island starts at beginning of opcodes

        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&island_start);
        opcodes.extend_from_slice(&open_div);
        opcodes.extend_from_slice(&dyn_text);
        opcodes.extend_from_slice(&close_div);
        opcodes.extend_from_slice(&island_end);

        let data = build_minimal_ir(
            &["IslandComp", "div", "greeting"],
            &[(0, 2, 0x01, 0x00, &[])], // slot_id=0, name="greeting", Text, Server
            &opcodes,
            &[(0, 0x01, 0x01, 0, byte_offset, &[0])], // island 0, slot_ids=[0]
        );
        let module = IrModule::parse(&data).unwrap();

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".to_string()));

        let html = walk_island(&module, &slots, 0).unwrap();
        assert_eq!(html, "<div><!--f:t0-->World<!--/f:t0--></div>");
    }

    #[test]
    fn walk_island_byte_offset_out_of_bounds() {
        // Island table entry with byte_offset pointing past the opcode stream
        let opcodes = encode_text(0); // just a small opcode stream

        let data = build_minimal_ir(
            &["BadIsland", "hello"],
            &[],
            &opcodes,
            &[(0, 0x01, 0x01, 0, 9999, &[])], // byte_offset=9999, way past end
        );
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);

        let result = walk_island(&module, &slots, 0);
        assert!(result.is_err());
        match result.unwrap_err() {
            IrError::BufferTooShort { .. } => {} // expected
            other => panic!("expected BufferTooShort, got {other:?}"),
        }
    }

    // -- PROP opcode tests -------------------------------------------------

    /// Encode a PROP opcode: opcode(1) + src_slot_id(2) + prop_str_idx(4) + target_slot_id(2)
    fn encode_prop(src_slot_id: u16, prop_str_idx: u32, target_slot_id: u16) -> Vec<u8> {
        let mut buf = vec![0x12]; // Opcode::Prop
        buf.extend_from_slice(&src_slot_id.to_le_bytes());
        buf.extend_from_slice(&prop_str_idx.to_le_bytes());
        buf.extend_from_slice(&target_slot_id.to_le_bytes());
        buf
    }

    // -- Test: PROP extracts object property inside LIST body ----------------

    #[test]
    fn walk_prop_in_list_body() {
        // LIST(slot=0, item_slot=1):
        //   PROP(src=1, "name", target=2)
        //   DYN_TEXT(slot=2, marker=0)
        //
        // Slot 0 = Array([Object{name:"Alice"}, Object{name:"Bob"}])
        // Strings: 0="items", 1="item", 2="name"
        let mut body = Vec::new();
        body.extend_from_slice(&encode_prop(1, 2, 2)); // PROP(item_slot=1, prop="name", target=2)
        body.extend_from_slice(&encode_dyn_text(2, 0)); // DYN_TEXT(slot=2)
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(3);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Object(vec![("name".to_string(), SlotValue::Text("Alice".to_string()))]),
                SlotValue::Object(vec![("name".to_string(), SlotValue::Text("Bob".to_string()))]),
            ]),
        );

        let html = walk_with_slots(
            &["items", "item", "name"],
            &[
                (0, 0, 0x04, 0x00, &[]), // slot 0: Array, Server
                (1, 1, 0x05, 0x00, &[]), // slot 1: Object, Server
                (2, 2, 0x01, 0x00, &[]), // slot 2: Text, Server
            ],
            &opcodes,
            &slots,
        );
        assert!(html.contains("Alice"), "should contain Alice, got: {html}");
        assert!(html.contains("Bob"), "should contain Bob, got: {html}");
    }

    // -- Test: PROP with multiple properties ---------------------------------

    #[test]
    fn walk_prop_multiple_properties() {
        // LIST(slot=0, item_slot=1):
        //   PROP(src=1, "name", target=2)
        //   PROP(src=1, "email", target=3)
        //   <tr><td>DYN_TEXT(2)</td><td>DYN_TEXT(3)</td></tr>
        //
        // Strings: 0="rows", 1="row", 2="name", 3="email", 4="tr", 5="td"
        let mut body = Vec::new();
        body.extend_from_slice(&encode_prop(1, 2, 2)); // PROP(1, "name", 2)
        body.extend_from_slice(&encode_prop(1, 3, 3)); // PROP(1, "email", 3)
        body.extend_from_slice(&encode_open_tag(4, &[])); // <tr>
        body.extend_from_slice(&encode_open_tag(5, &[])); // <td>
        body.extend_from_slice(&encode_dyn_text(2, 0));   // name
        body.extend_from_slice(&encode_close_tag(5));      // </td>
        body.extend_from_slice(&encode_open_tag(5, &[])); // <td>
        body.extend_from_slice(&encode_dyn_text(3, 1));   // email
        body.extend_from_slice(&encode_close_tag(5));      // </td>
        body.extend_from_slice(&encode_close_tag(4));      // </tr>
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(4);
        slots.set(
            0,
            SlotValue::Array(vec![
                SlotValue::Object(vec![
                    ("name".to_string(), SlotValue::Text("Alice".to_string())),
                    ("email".to_string(), SlotValue::Text("alice@test.com".to_string())),
                ]),
                SlotValue::Object(vec![
                    ("name".to_string(), SlotValue::Text("Bob".to_string())),
                    ("email".to_string(), SlotValue::Text("bob@test.com".to_string())),
                ]),
            ]),
        );

        let html = walk_with_slots(
            &["rows", "row", "name", "email", "tr", "td"],
            &[
                (0, 0, 0x04, 0x00, &[]),
                (1, 1, 0x05, 0x00, &[]),
                (2, 2, 0x01, 0x00, &[]),
                (3, 3, 0x01, 0x00, &[]),
            ],
            &opcodes,
            &slots,
        );
        assert!(html.contains("<td><!--f:t0-->Alice<!--/f:t0--></td>"), "should contain Alice td, got: {html}");
        assert!(html.contains("<td><!--f:t1-->alice@test.com<!--/f:t1--></td>"), "should contain alice email, got: {html}");
        assert!(html.contains("<td><!--f:t0-->Bob<!--/f:t0--></td>"), "should contain Bob td, got: {html}");
        assert!(html.contains("<td><!--f:t1-->bob@test.com<!--/f:t1--></td>"), "should contain bob email, got: {html}");
    }

    // -- Test: PROP on non-Object returns Null (empty string for DYN_TEXT) ----

    #[test]
    fn walk_prop_on_non_object() {
        // PROP(src=0, "name", target=1) then DYN_TEXT(1)
        // Slot 0 = Text("hello") — not an object
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_prop(0, 1, 1));
        opcodes.extend_from_slice(&encode_dyn_text(1, 0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("hello".to_string()));

        let html = walk_with_slots(
            &["src", "name"],
            &[
                (0, 0, 0x01, 0x00, &[]),
                (1, 1, 0x01, 0x00, &[]),
            ],
            &opcodes,
            &slots,
        );
        // PROP on non-Object produces Null → DYN_TEXT renders zero-width space (U+200B)
        assert!(html.contains("<!--f:t0-->\u{200B}<!--/f:t0-->"), "non-object PROP should produce empty text, got: {html}");
    }

    // -- Test: PROP with missing property returns Null -----------------------

    #[test]
    fn walk_prop_missing_property() {
        // PROP(src=0, "missing", target=1) then DYN_TEXT(1)
        // Slot 0 = Object with only "name" key
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_prop(0, 2, 1));
        opcodes.extend_from_slice(&encode_dyn_text(1, 0));

        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::Object(vec![("name".to_string(), SlotValue::Text("Alice".to_string()))]),
        );

        let html = walk_with_slots(
            &["src", "target", "missing"],
            &[
                (0, 0, 0x05, 0x00, &[]),
                (1, 1, 0x01, 0x00, &[]),
            ],
            &opcodes,
            &slots,
        );
        assert!(html.contains("<!--f:t0-->\u{200B}<!--/f:t0-->"), "missing property should produce empty text, got: {html}");
    }

    // -- Recursion depth limit tests ----------------------------------------

    #[test]
    fn walk_nested_show_if_within_limit() {
        // 5 levels of nested SHOW_IF — well within the 64-level limit.
        // Each level wraps the next; innermost renders TEXT "deep".
        // strings: 0..=4 = "s0".."s4", 5 = "deep"
        let inner = encode_text(5);
        let level4 = encode_show_if(4, &inner, &[]);
        let level3 = encode_show_if(3, &level4, &[]);
        let level2 = encode_show_if(2, &level3, &[]);
        let level1 = encode_show_if(1, &level2, &[]);
        let level0 = encode_show_if(0, &level1, &[]);

        let mut slots = SlotData::new(5);
        for i in 0..5 {
            slots.set(i, SlotValue::Bool(true));
        }

        let html = walk_with_slots(
            &["s0", "s1", "s2", "s3", "s4", "deep"],
            &[
                (0, 0, 0x02, 0x00, &[]),
                (1, 1, 0x02, 0x00, &[]),
                (2, 2, 0x02, 0x00, &[]),
                (3, 3, 0x02, 0x00, &[]),
                (4, 4, 0x02, 0x00, &[]),
            ],
            &level0,
            &slots,
        );
        assert!(
            html.contains("deep"),
            "5 levels of nesting should succeed, got: {html}"
        );
    }

    #[test]
    fn walk_script_tag_props_escapes_close_script() {
        // Script tag JSON containing "</" should be escaped to "<\/"
        // to prevent premature close of the <script> tag.
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Island with ScriptTag mode, slot value contains "</script>"
        // strings: 0="div", 1="Comp", 2="payload"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("</script>alert(1)".to_string()));

        let html = walk_with_islands(
            &["div", "Comp", "payload"],
            &[(0, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x02, 1, 0, &[0])],
            &opcodes,
            &slots,
        );
        // The JSON inside the script tag must not contain a literal "</script>"
        assert!(
            !html.contains("</script>alert"),
            "script tag content must escape </script>, got: {html}"
        );
        assert!(
            html.contains("<\\/script>"),
            "should replace </ with <\\/ in script JSON, got: {html}"
        );
    }

    #[test]
    #[ignore = "requires admin/dist IR files — run in monorepo or after `npm run build`"]
    fn walk_real_benchmark_ir() {
        // Find the benchmark IR file dynamically (hash changes on rebuild)
        let dist_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../admin/dist");
        let ir_path = std::fs::read_dir(&dist_dir)
            .expect("admin/dist must exist")
            .filter_map(|e| e.ok())
            .find(|e| {
                let name = e.file_name();
                let s = name.to_string_lossy();
                s.starts_with("platform-benchmark.") && s.ends_with(".ir")
            })
            .map(|e| e.path())
            .expect("platform-benchmark.*.ir must exist in admin/dist");
        let data = std::fs::read(&ir_path).expect("benchmark IR file must exist");
        let module = IrModule::parse(&data).expect("IR must parse");

        // Walk with default slots
        let slots = SlotData::new_from_defaults(&module.slots);
        let html = walk_to_html(&module, &slots).expect("walk must succeed");

        // Verify island markers exist
        assert!(html.contains("<!--f:i0-->"), "missing island 0 start");
        assert!(html.contains("<!--/f:i0-->"), "missing island 0 end");
        assert!(html.contains("data-forma-island=\"0\""), "missing island 0 attr");

        // The key assertion: island content must include FilterBar's children
        // (not just an empty shell div)
        assert!(html.contains("Search"), "FilterBar must contain 'Search' label text in SSR");
        assert!(html.contains("filter-group"), "FilterBar must contain filter-group divs in SSR");
        assert!(html.contains("Sort by"), "FilterBar must contain 'Sort by' label text in SSR");

        // PerfPanel content
        assert!(html.contains("Performance"), "PerfPanel must contain 'Performance' heading in SSR");

        // BenchmarkDataTable — SHOW_IF may pick either branch depending on slot defaults
        // Just check the structure exists
        assert!(html.contains("benchmark-data-table"), "BenchmarkDataTable root class must exist");

        // Print a section for manual inspection
        if let Some(start) = html.find("<!--f:i0-->") {
            let end = html.find("<!--/f:i0-->").unwrap_or(start + 200) + 12;
            eprintln!("\n=== FilterBar island HTML ===");
            eprintln!("{}", &html[start..end.min(html.len())]);
        }
    }
}
