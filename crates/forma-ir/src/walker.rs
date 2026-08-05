//! Static HTML walker — walks the IR opcode stream to produce HTML output.
//!
//! This is the core SSR rendering engine. It takes a parsed `IrModule` plus
//! populated `SlotData`, walks the opcode stream linearly, and produces an
//! HTML string suitable for embedding in the page.

#[cfg(feature = "tracing")]
use crate::format::SlotSource;
use crate::format::{IrError, IslandTrigger, Opcode, PropsMode};
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

/// Serialized-JSON size above which `PropsMode::Inline` props are spilled into
/// the shared `__forma_islands` block instead of a `data-forma-props`
/// attribute.
///
/// Matches the client's documented guidance ("inline for small props, < 1KB;
/// the script block for larger props"). Measured on the *JSON*, before HTML
/// attribute escaping — a string-heavy payload inflates roughly 1.8x on the
/// wire because every `"` becomes `&quot;`, so the attribute this bounds is
/// closer to 2 KiB in the worst case.
///
/// The spill needs no client change: `loadIslandProps`
/// (`@getforma/core`, src/dom/activate.ts) reads `data-forma-props` first and
/// falls back to the shared block, and the walker emits exactly one channel
/// per island so that precedence never has two answers to choose between.
///
/// A *fragment* render ([`walk_island`]) never spills — it cannot legally emit
/// a second `__forma_islands` block — so an over-size fragment keeps its props
/// inline.
///
/// Verified by: crates/forma-ir/src/walker.rs > "inline_props_over_the_ceiling_spill_to_the_shared_block"
/// Verified by: crates/forma-ir/src/walker.rs > "island_fragment_keeps_over_size_props_inline"
pub const INLINE_PROPS_MAX_BYTES: usize = 1024;

/// Default cap on the HTML a single walk may produce.
///
/// A structurally valid module can otherwise force an arbitrarily large
/// `String` allocation inside one request handler, and Rust answers allocation
/// failure with `handle_alloc_error` → process abort, which kills every
/// in-flight request. Raise it via [`WalkLimits`] for an app with a
/// legitimately large data-driven page rather than accepting a silent
/// degradation.
pub const DEFAULT_MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

/// Default cap on total LIST item iterations per render, across all depths.
///
/// `MAX_LIST_DEPTH` bounds nesting but not volume: four LISTs bound to the
/// same array give n^4 body walks from one small module plus one large
/// request array.
pub const DEFAULT_MAX_LIST_ITERATIONS: usize = 50_000;

/// Resource budgets for a single walk.
///
/// Both are per-render totals, not per-nesting-level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalkLimits {
    /// Maximum bytes of HTML the walk may emit.
    pub max_output_bytes: usize,
    /// Maximum total LIST item iterations across all nesting depths.
    pub max_list_iterations: usize,
}

impl Default for WalkLimits {
    fn default() -> Self {
        WalkLimits {
            max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
            max_list_iterations: DEFAULT_MAX_LIST_ITERATIONS,
        }
    }
}

/// Mutable state threaded through recursive `walk_range` calls.
///
/// This avoids adding extra parameters every time we need new walker state
/// (e.g., list depth, output budget).
struct WalkState {
    /// Current nesting depth for LIST opcodes.
    list_depth: u8,
    /// Pending island info to inject on the next OPEN_TAG/VOID_TAG.
    pending_island: Option<IslandPending>,
    /// Pending list-item key to inject on the next OPEN_TAG/VOID_TAG.
    pending_list_key: Option<String>,
    /// Accumulated props for ScriptTag mode, keyed by island id.
    script_tag_props: std::collections::BTreeMap<u16, serde_json::Value>,
    /// True when an OpenTag or VoidTag has been opened but the `>` has not
    /// been written yet. DYN_ATTR opcodes may still append attributes.
    pending_tag_close: bool,
    /// Tag name of the element currently being opened — needed to decide
    /// whether a `data:image/svg+xml` URL is in an image context.
    pending_tag_name: String,
    /// Output-size budget. Lives on the state (not as a `walk_range`
    /// parameter) so every recursive call sharing the same `out` enforces the
    /// same cumulative budget by construction.
    max_output_bytes: usize,
    /// Running total of LIST item iterations, counted across all depths and
    /// never decremented.
    list_iterations: usize,
    /// Cap for `list_iterations`.
    max_list_iterations: usize,
    /// Undo log for slot writes made inside a LIST body.
    ///
    /// A list row must render from its own scope: the item binding and any
    /// PROP the body extracts from it are visible to that row and to nothing
    /// else. The loop used to buy that by deep-cloning the whole `SlotData`
    /// per row, which costs O(rows x slots) — the walk was measurably
    /// quadratic in row count. Instead each write swaps the new value in and
    /// pushes the displaced one here; the row's `Drop`-equivalent pops back to
    /// the mark it took on entry, restoring exactly the state the caller had.
    ///
    /// Entries are strictly LIFO across nesting: an inner list unwinds its own
    /// entries before its enclosing row unwinds. The `Vec` keeps its capacity
    /// between rows, so steady-state pushes do not allocate.
    slot_journal: Vec<(u16, SlotValue)>,
    /// When true, `PropsMode::ScriptTag` islands inline their props on the
    /// root instead of accumulating into the shared `__forma_islands` block.
    /// Set for fragment renders, where a shared block would be dropped on
    /// return (or, if emitted, would duplicate the page's own block).
    force_inline_props: bool,
}

impl WalkState {
    fn new(limits: WalkLimits) -> Self {
        WalkState {
            list_depth: 0,
            pending_island: None,
            pending_list_key: None,
            script_tag_props: std::collections::BTreeMap::new(),
            pending_tag_close: false,
            pending_tag_name: String::new(),
            max_output_bytes: limits.max_output_bytes,
            list_iterations: 0,
            max_list_iterations: limits.max_list_iterations,
            slot_journal: Vec::new(),
            force_inline_props: false,
        }
    }

    /// Record a slot write so the enclosing LIST row can undo it.
    ///
    /// Outside a list there is nothing to undo — a PROP at depth 0 writes to
    /// the walk's own `SlotData` copy for the rest of the page, which is what
    /// the clone-per-row implementation did too.
    fn journal_write(&mut self, slot_id: u16, previous: SlotValue) {
        if self.list_depth > 0 {
            self.slot_journal.push((slot_id, previous));
        }
    }

    /// Undo every journalled write back to `mark`, restoring `slots`.
    fn unwind_slot_journal(&mut self, slots: &mut SlotData, mark: usize) {
        while self.slot_journal.len() > mark {
            // `len() > mark >= 0`, so the pop cannot be None.
            if let Some((slot_id, previous)) = self.slot_journal.pop() {
                slots.set(slot_id, previous);
            }
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
#[cfg_attr(not(feature = "tracing"), allow(unused_variables))]
fn check_slot_source(module: &IrModule, slot_id: u16, value: &SlotValue) {
    // Gated as a whole: with `tracing` off there is nothing to report, so the
    // lookup should not run at all. (It is an O(1) index lookup now either
    // way, but the source should say what it means.)
    #[cfg(feature = "tracing")]
    if let Some(entry) = module.slot_entry(slot_id) {
        if entry.source == SlotSource::Server && matches!(value, SlotValue::Null) {
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
    walk_to_html_with_limits(module, slots, WalkLimits::default())
}

/// Walk the IR opcode stream with explicit resource budgets.
///
/// Use this when the default 8 MiB output cap or 50,000-iteration LIST budget
/// is wrong for the page — raising the limit is the right answer for a
/// legitimately large list, rather than letting the render fail and silently
/// degrade to a client-mounted page.
pub fn walk_to_html_with_limits(
    module: &IrModule,
    slots: &SlotData,
    limits: WalkLimits,
) -> Result<String, IrError> {
    let ops = &module.opcodes;
    let len = ops.len();
    // Cap the pre-reservation: `len * 4` is a fine estimate for a real page
    // (measured modules are tens of bytes to low KiB) but a 4x reservation on
    // an attacker-sized section is a free amplifier, and `len * 4` can itself
    // overflow on wasm32 where `usize` is 32 bits. Beyond the cap, String's
    // amortized doubling costs O(log n) reallocs.
    let mut out = String::with_capacity(len.saturating_mul(4).min(1 << 20));
    let mut state = WalkState::new(limits);
    let mut slots_mut = slots.clone();
    walk_range(module, &mut slots_mut, ops, 0, len, &mut out, &mut state, 0)?;

    // Emit script tag for ScriptTag props mode islands
    if !state.script_tag_props.is_empty() {
        let json =
            serde_json::to_string(&state.script_tag_props).unwrap_or_else(|_| "{}".to_string());
        push_checked(
            &mut out,
            "<script id=\"__forma_islands\" type=\"application/json\">",
            state.max_output_bytes,
        )?;
        push_json_script_body(&mut out, &json, state.max_output_bytes)?;
        push_checked(&mut out, "</script>", state.max_output_bytes)?;
    }

    Ok(out)
}

/// Append a JSON document as the body of a `<script type="application/json">`
/// data block, escaped so it cannot terminate or re-open the enclosing
/// element.
///
/// Escaping `<` is total: `<` cannot appear in JSON outside a string literal,
/// and `<` is a valid JSON string escape, so `JSON.parse` yields
/// byte-identical *values*. It simultaneously kills `</script`, `<!--` and
/// `<script`. The previous `</` → `<\/` replace only covered the first of
/// those: a payload containing `<!--` followed later by `<script` drives a
/// spec-compliant tokenizer into the *script-data-double-escaped* state, in
/// which our own trailing `</script>` no longer closes the element and the
/// entire rest of the page is swallowed as script text.
///
/// `>` is escaped for symmetry and U+2028/U+2029 as defence in depth — those
/// two are not needed for a `JSON.parse(textContent)` consumer, only if the
/// payload is ever inlined as JS source instead of as a data block.
///
/// HYDRATION CONTRACT: the `__forma_islands` payload is JSON with `<`/`>`
/// escaped as `<`/`>`. Consumers MUST decode it with `JSON.parse`
/// (which undoes the escapes) and MUST NOT string-match the raw script text.
fn push_json_script_body(out: &mut String, json: &str, limit: usize) -> Result<(), IrError> {
    for ch in json.chars() {
        match ch {
            '<' => push_checked(out, "\\u003c", limit)?,
            '>' => push_checked(out, "\\u003e", limit)?,
            '\u{2028}' => push_checked(out, "\\u2028", limit)?,
            '\u{2029}' => push_checked(out, "\\u2029", limit)?,
            _ => {
                if out.len() >= limit {
                    return Err(IrError::OutputLimitExceeded { limit });
                }
                out.push(ch);
            }
        }
    }
    Ok(())
}

/// Walk a single island's content and produce an HTML string.
///
/// This is the fragment rendering entry point for WASM re-renders. It finds
/// the island by `island_id` in the module's island table, seeks to its
/// `byte_offset` in the opcode stream, and walks from after the ISLAND_START
/// opcode until the matching ISLAND_END opcode.
///
/// Returns the island ROOT element carrying the full `data-forma-*` attribute
/// set (`data-forma-island`, `-component`, `-status`, `-hydrate`, and
/// `-props` when the island has any). Clients MUST swap it in with
/// `replaceWith`/`outerHTML` and MUST NOT use `innerHTML` — that would discard
/// exactly the attributes the runtime selects on.
///
/// The `<!--f:iN-->` / `<!--/f:iN-->` marker comments are deliberately NOT
/// emitted: they live outside the root element and survive an `outerHTML`
/// swap, so re-emitting them would duplicate them.
///
/// Props are always inlined on the root as `data-forma-props`, even for an
/// island declared `PropsMode::ScriptTag`. A fragment must be self-contained:
/// emitting a second `__forma_islands` block would duplicate a DOM id and,
/// because the injected copy precedes the SSR one in document order, would
/// shadow it for every other ScriptTag island on the page. The client already
/// reads `data-forma-props` first, so this needs no JS change.
pub fn walk_island(module: &IrModule, slots: &SlotData, island_id: u16) -> Result<String, IrError> {
    walk_island_with_limits(module, slots, island_id, WalkLimits::default())
}

/// [`walk_island`] with explicit resource budgets.
pub fn walk_island_with_limits(
    module: &IrModule,
    slots: &SlotData,
    island_id: u16,
    limits: WalkLimits,
) -> Result<String, IrError> {
    // 1. Find the island entry by id
    let entry = module
        .island_entry(island_id)
        .ok_or(IrError::IslandNotFound(island_id))?;

    let byte_offset = entry.byte_offset as usize;
    let ops = &module.opcodes;

    // 2. Validate byte_offset is in bounds. Saturating arithmetic: byte_offset
    //    is u32-wide and `usize` is 32 bits on wasm32.
    if byte_offset >= ops.len() {
        return Err(IrError::BufferTooShort {
            expected: byte_offset.saturating_add(1),
            actual: ops.len(),
        });
    }

    // 3. Verify we're at an ISLAND_START opcode
    let opcode = Opcode::from_byte(ops[byte_offset])?;
    if opcode != Opcode::IslandStart {
        return Err(IrError::InvalidOpcode(ops[byte_offset]));
    }

    // 4. Skip ISLAND_START opcode(1) + island_id(2) = 3 bytes
    let content_start = byte_offset.saturating_add(3);
    if content_start > ops.len() {
        return Err(IrError::BufferTooShort {
            expected: content_start,
            actual: ops.len(),
        });
    }

    // 5. Replicate the ISLAND_START handler: seeking past the opcode means it
    //    never runs, so without this the island root comes back with none of
    //    its data-forma-* attributes and would never hydrate.
    let mut out = String::with_capacity(256);
    let mut state = WalkState::new(limits);
    // Applies to nested islands inside this one as well, so a ScriptTag island
    // nested in the fragment keeps its props instead of losing them on return.
    state.force_inline_props = true;
    let mut slots_mut = slots.clone();

    let component_name = module.strings.get(entry.name_str_idx)?.to_string();
    let inline_props = match entry.props_mode {
        // ScriptTag is deliberately treated as Inline here — see the doc
        // comment: a fragment must carry its own props.
        PropsMode::Inline | PropsMode::ScriptTag => {
            if entry.slot_ids.is_empty() {
                None
            } else {
                let props = build_island_props(module, &slots_mut, &entry.slot_ids);
                Some(serde_json::to_string(&props).unwrap_or_else(|_| "{}".to_string()))
            }
        }
        PropsMode::Deferred => None,
    };
    state.pending_island = Some(IslandPending {
        id: island_id,
        component_name,
        inline_props,
        trigger: entry.trigger,
    });

    // 6. Walk until the matching ISLAND_END, which stops the range.
    walk_range_until_island_end(
        module,
        &mut slots_mut,
        ops,
        content_start,
        island_id,
        &mut out,
        &mut state,
        0,
    )?;

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

/// Controls how the walker decides when to stop processing opcodes.
enum WalkMode {
    /// Walk a fixed byte range `ops[start..end]`.  Used for the top-level
    /// full-page walk **and** for all recursive sub-range calls inside
    /// control-flow opcodes (ShowIf, Switch, List).
    Range { end: usize },
    /// Walk until we encounter an ISLAND_END opcode whose `island_id` matches
    /// `target_island_id`.  Used by `walk_island()` for fragment rendering.
    UntilIslandEnd { target_island_id: u16 },
}

/// Walk a sub-range of the opcode stream `ops[start..end]`, appending HTML to `out`.
///
/// This is structured as a sub-range function so that control-flow opcodes
/// (ShowIf, List, Switch) can recurse into their body ranges.
///
/// `state` carries mutable walker context (list depth, output budget, etc.).
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
    walk_range_impl(
        module,
        slots,
        ops,
        start,
        WalkMode::Range { end },
        out,
        state,
        depth,
    )
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
    walk_range_impl(
        module,
        slots,
        ops,
        start,
        WalkMode::UntilIslandEnd { target_island_id },
        out,
        state,
        depth,
    )
}

/// Shared implementation for both `walk_range` and `walk_range_until_island_end`.
///
/// The `mode` parameter controls the termination condition:
/// - `WalkMode::Range { end }` — stop when `pos >= end` (with bounds check)
/// - `WalkMode::UntilIslandEnd { target_island_id }` — stop when we hit an
///   ISLAND_END opcode matching the target id
///
/// All opcode handling is identical regardless of mode. The only differences
/// are:
/// 1. The loop termination condition
/// 2. How ISLAND_END is handled (in Range mode it emits the comment marker
///    and continues; in UntilIslandEnd mode a match causes an early return)
/// 3. What happens when the loop ends without an explicit stop (Range returns
///    Ok, UntilIslandEnd returns an error)
#[allow(clippy::too_many_arguments)]
fn walk_range_impl(
    module: &IrModule,
    slots: &mut SlotData,
    ops: &[u8],
    start: usize,
    mode: WalkMode,
    out: &mut String,
    state: &mut WalkState,
    depth: usize,
) -> Result<(), IrError> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(IrError::RecursionLimitExceeded);
    }

    let strings = &module.strings;
    let mut pos = start;
    let limit = state.max_output_bytes;
    // Range-local, not shared on WalkState: a TRY_START and its FALLBACK are
    // emitted in the same opcode range by construction, so a FALLBACK reached
    // inside a nested range must never pop an entry pushed by an outer
    // TRY_START and skip that many bytes of the wrong region. A stray FALLBACK
    // then finds an empty stack and is a no-op, mirroring how a stray
    // SHOW_ELSE is already tolerated. This also removes the unbounded growth
    // when a TRY_START is walked but its FALLBACK never is.
    let mut fallback_stack: Vec<usize> = Vec::new();

    // The loop bound depends on the mode:
    // - Range: stop at `end`, but also guard against `pos >= ops.len()`
    // - UntilIslandEnd: stop at `ops.len()` (or earlier via ISLAND_END match)
    let loop_bound = match mode {
        WalkMode::Range { end } => end,
        WalkMode::UntilIslandEnd { .. } => usize::MAX, // guarded by ops.len() check below
    };

    // Upper bound every derived offset (branch/body ends) must respect. In
    // Range mode that is the enclosing region; on the island path there is no
    // `end`, so the opcode stream itself is the bound.
    let region_limit = match mode {
        WalkMode::Range { end } => end.min(ops.len()),
        WalkMode::UntilIslandEnd { .. } => ops.len(),
    };

    while pos < loop_bound {
        // Cheap redundancy: every append also goes through a checked push, so
        // a single opcode cannot blow past the budget between iterations.
        if out.len() > limit {
            return Err(IrError::OutputLimitExceeded { limit });
        }

        // In Range mode, `end` could exceed ops.len()` for a malformed stream.
        // In UntilIslandEnd mode, loop_bound is MAX so we always need this check.
        if pos >= ops.len() {
            match mode {
                WalkMode::Range { .. } => {
                    return Err(IrError::BufferTooShort {
                        expected: pos + 1,
                        actual: ops.len(),
                    });
                }
                WalkMode::UntilIslandEnd { .. } => break, // fall through to IslandNotFound error
            }
        }

        let opcode = Opcode::from_byte(ops[pos])?;
        pos += 1; // advance past the opcode byte

        // Flush pending tag close before any opcode that is NOT DYN_ATTR.
        // DYN_ATTR needs the tag still open so it can append attributes.
        if state.pending_tag_close && opcode != Opcode::DynAttr {
            push_checked(out, ">", limit)?;
            state.pending_tag_close = false;
        }

        match opcode {
            // ----- Fully implemented opcodes -----
            Opcode::OpenTag | Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                emit_open_tag(out, tag, &attrs, state, limit)?;
                pos = new_pos;
            }

            Opcode::CloseTag => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let tag = strings.get(str_idx)?;
                // Names are written to the output stream unescaped, so an
                // IR-authored name is markup injection unless it is validated.
                if !is_valid_name(tag) {
                    return Err(IrError::InvalidName(tag.to_string()));
                }
                push_checked(out, "</", limit)?;
                push_checked(out, tag, limit)?;
                push_checked(out, ">", limit)?;
            }

            Opcode::Text => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                push_escaped_html(out, text, limit)?;
            }

            Opcode::DynText => {
                // slot_id(u16) + marker_id(u16)
                let slot_id = read_u16(ops, pos)?;
                pos += 2;
                let marker_id = read_u16(ops, pos)?;
                pos += 2;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let value = slots.get(slot_id).to_text();

                push_checked(out, "<!--f:t", limit)?;
                push_u16(out, marker_id, limit)?;
                push_checked(out, "-->", limit)?;
                if value.is_empty() {
                    // Always emit at least a zero-width space so the browser
                    // creates a Text node between the markers. Without this,
                    // <!--f:t0--><!--/f:t0--> produces no Text node in the DOM
                    // and the hydration walker has nothing to bind the reactive
                    // effect to.
                    push_checked(out, "\u{200B}", limit)?;
                } else {
                    push_escaped_html(out, &value, limit)?;
                }
                push_checked(out, "<!--/f:t", limit)?;
                push_u16(out, marker_id, limit)?;
                push_checked(out, "-->", limit)?;
            }

            Opcode::DynAttr => {
                // attr_str_idx(u32) + slot_id(u16) = 6 bytes
                let attr_str_idx = read_u32(ops, pos)?;
                let slot_id = read_u16(ops, pos + 4)?;
                pos += 6;
                check_slot_source(module, slot_id, slots.get(slot_id));

                if state.pending_tag_close {
                    let attr_name = strings.get(attr_str_idx)?;
                    // `text` outlives the borrow only for the Valued case; it
                    // is declared here so the &str can point into it.
                    let text;
                    let value = match slots.get(slot_id) {
                        // An HTML boolean attribute is ON whenever it is
                        // present, so the old `disabled="false"` meant
                        // DISABLED. Absent for false/null, bare for true —
                        // byte-for-byte what `renderAttr` in @getforma/core
                        // produces for the same value.
                        SlotValue::Bool(false) | SlotValue::Null => None,
                        SlotValue::Bool(true) => Some(AttrValue::Bare),
                        other => {
                            text = other.to_text();
                            // An empty string is a value, not an absence:
                            // `renderAttr` emits `value=""`, and dropping the
                            // attribute instead is a hydration mismatch on the
                            // common `value=""` / `alt=""` case.
                            Some(AttrValue::Valued(text.as_str()))
                        }
                    };
                    if let Some(value) = value {
                        // `pending_tag_name` is the element this attribute is
                        // being written to — it decides whether a
                        // data:image/svg+xml value is in an image context.
                        let tag = std::mem::take(&mut state.pending_tag_name);
                        emit_attr(out, &tag, attr_name, value, limit)?;
                        state.pending_tag_name = tag;
                    }
                }
                // If not inside a tag opening (shouldn't happen in well-formed IR), skip silently.
            }

            Opcode::IslandStart => {
                // island_id(u16)
                let island_id = read_u16(ops, pos)?;
                pos += 2;

                // Only one element can carry a `data-forma-island` set. If an
                // island's body starts another island before opening a tag of
                // its own, the outer island's attributes are silently
                // discarded and it never hydrates, never disposes, and cannot
                // be found by `activateIslands`. Fail the render instead: the
                // compiler owes every island a shell element.
                if let Some(outer) = &state.pending_island {
                    return Err(IrError::NestedIslandRoot {
                        outer: outer.id,
                        inner: island_id,
                    });
                }

                push_checked(out, "<!--f:i", limit)?;
                push_u16(out, island_id, limit)?;
                push_checked(out, "-->", limit)?;

                // Look up island entry from the island table (O(1) index).
                // `IrModule::validate` rejects an ISLAND_START naming an
                // island the table does not declare, so the `else` below is
                // reachable only for a module that skipped validation.
                // Verified by: crates/forma-ir/src/parser.rs > "validate_rejects_island_start_missing_from_table"
                if let Some(entry) = module.island_entry(island_id) {
                    let component_name = strings.get(entry.name_str_idx)?.to_string();

                    // Build props JSON from the island's slot_ids
                    let inline_props = match entry.props_mode {
                        PropsMode::Inline => {
                            if entry.slot_ids.is_empty() {
                                None
                            } else {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                let json = serde_json::to_string(&props)
                                    .unwrap_or_else(|_| "{}".to_string());
                                if json.len() > INLINE_PROPS_MAX_BYTES && !state.force_inline_props
                                {
                                    // Spill: the payload goes into the shared
                                    // block instead of a multi-kilobyte
                                    // attribute. Exactly one channel is used,
                                    // so the client's inline-wins precedence
                                    // never has two answers to choose between.
                                    state
                                        .script_tag_props
                                        .insert(island_id, serde_json::Value::Object(props));
                                    None
                                } else {
                                    Some(json)
                                }
                            }
                        }
                        PropsMode::ScriptTag if state.force_inline_props => {
                            // Fragment render: keep this island self-contained
                            // rather than pushing into a shared block that the
                            // fragment cannot legally emit.
                            if entry.slot_ids.is_empty() {
                                None
                            } else {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                Some(
                                    serde_json::to_string(&props)
                                        .unwrap_or_else(|_| "{}".to_string()),
                                )
                            }
                        }
                        PropsMode::ScriptTag => {
                            // Accumulate for script tag emission after walk
                            if !entry.slot_ids.is_empty() {
                                let props = build_island_props(module, slots, &entry.slot_ids);
                                state
                                    .script_tag_props
                                    .insert(island_id, serde_json::Value::Object(props));
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
                } else {
                    #[cfg(feature = "tracing")]
                    tracing::warn!(
                        island_id = island_id,
                        "ISLAND_START names an island that is not in the island table — \
                         markers emitted but no data-forma-* attributes, so it will not hydrate \
                         (module was not validated)"
                    );
                }
            }

            Opcode::IslandEnd => {
                // island_id(u16)
                let island_id = read_u16(ops, pos)?;
                pos += 2;

                // The island is over: anything still pending belongs to no
                // element inside it. Without this, an ISLAND_START not
                // followed by a tag leaks its identity attributes onto
                // whatever element comes next — possibly one emitted after the
                // island's own closing marker.
                if state.pending_island.take().is_some() {
                    #[cfg(feature = "tracing")]
                    tracing::warn!(
                        island_id = island_id,
                        "ISLAND_START was not followed by an element — island attributes dropped, \
                         this island will not hydrate (compiler should emit a shell element)"
                    );
                }

                // In UntilIslandEnd mode, a matching island_id means we are done.
                if let WalkMode::UntilIslandEnd { target_island_id } = mode {
                    if island_id == target_island_id {
                        // Flush any pending tag close before returning.
                        if state.pending_tag_close {
                            push_checked(out, ">", limit)?;
                            state.pending_tag_close = false;
                        }
                        return Ok(());
                    }
                }

                // Either Range mode, or a nested (non-matching) island end —
                // emit the closing marker comment and continue.
                push_checked(out, "<!--/f:i", limit)?;
                push_u16(out, island_id, limit)?;
                push_checked(out, "-->", limit)?;
            }

            Opcode::Comment => {
                // str_idx(u32)
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                push_checked(out, "<!--", limit)?;
                // A leading ">" or "->" closes an HTML comment immediately per
                // the tokenizer, spilling the rest of the text into the
                // document as markup. A single leading space makes that
                // impossible and cannot collide with the hydration markers,
                // which are emitted directly and never through this opcode.
                if text.starts_with('>') || text.starts_with("->") {
                    push_checked(out, " ", limit)?;
                }
                push_checked(out, &text.replace("--", "&#45;&#45;"), limit)?;
                push_checked(out, "-->", limit)?;
            }

            // ----- Control-flow opcodes (recurse via walk_range) -----
            Opcode::ShowIf => {
                // slot_id(2) + then_len(4) + else_len(4) = 10 bytes header
                let slot_id = read_u16(ops, pos)?;
                let then_len = read_u32(ops, pos + 2)? as usize;
                let else_len = read_u32(ops, pos + 6)? as usize;
                pos += 10;

                check_slot_source(module, slot_id, slots.get(slot_id));
                let condition = slots.get(slot_id).as_bool();
                let then_start = pos;
                // Checked, and bounded by the enclosing region: a corrupt
                // length would otherwise silently relocate content across the
                // hydration markers, and plain `+` can wrap on wasm32.
                let then_end = bounded_offset(pos, then_len, region_limit)?;
                // The SHOW_ELSE marker byte must itself be inside the region
                // (`<` not `<=`), or a SHOW_IF at the tail of a sub-range would
                // read a byte its parent never granted.
                if then_end >= region_limit || ops[then_end] != Opcode::ShowElse as u8 {
                    return Err(IrError::InvalidSection);
                }
                let else_start = then_end + 1; // skip SHOW_ELSE byte
                let else_end = bounded_offset(else_start, else_len, region_limit)?;

                // Emit conditional marker
                push_checked(out, "<!--f:s", limit)?;
                push_u16(out, slot_id, limit)?;
                push_checked(out, "-->", limit)?;

                if condition {
                    walk_range(
                        module,
                        slots,
                        ops,
                        then_start,
                        then_end,
                        out,
                        state,
                        depth + 1,
                    )?;
                } else {
                    walk_range(
                        module,
                        slots,
                        ops,
                        else_start,
                        else_end,
                        out,
                        state,
                        depth + 1,
                    )?;
                }

                push_checked(out, "<!--/f:s", limit)?;
                push_u16(out, slot_id, limit)?;
                push_checked(out, "-->", limit)?;

                // Advance pos past both branches + SHOW_ELSE marker byte
                pos = else_end;
            }

            Opcode::ShowElse => {
                // SHOW_ELSE should never be reached during normal walking — it is
                // skipped over by the SHOW_IF handler. If we reach it, the opcode
                // stream is malformed, but we tolerate it gracefully by doing nothing.
            }

            // LIMITATION, not an oversight: SWITCH emits no `<!--f:…-->`
            // marker pair, because the hydration wire contract has no switch
            // marker — it defines exactly `f:tN` (text), `f:sN` (conditional),
            // `f:lN` (list) and `f:iN` (island), and those bytes are shared
            // with @getforma/core and ksx Studio. A switched region is
            // therefore server-rendered only: the client cannot locate it to
            // re-render when the slot changes. Adding one is a coordinated
            // change to both renderers and the client walker, not a
            // walker-local fix. SWITCH also has no default case in the opcode
            // layout; a non-matching value renders nothing.
            Opcode::Switch => {
                let slot_id = read_u16(ops, pos)?;
                let case_count = read_u16(ops, pos + 2)? as usize;
                pos += 4;

                // Read case headers: [(val_str_idx, body_len)]
                // Bound the reservation by the bytes actually available — a
                // valid stream still gets a single exact allocation.
                let mut cases =
                    Vec::with_capacity(case_count.min(ops.len().saturating_sub(pos) / 8));
                for _ in 0..case_count {
                    let val_str_idx = read_u32(ops, pos)?;
                    let body_len = read_u32(ops, pos + 4)? as usize;
                    cases.push((val_str_idx, body_len));
                    pos += 8;
                }

                // Now pos points to start of first case body
                check_slot_source(module, slot_id, slots.get(slot_id));
                let slot_text = slots.get(slot_id).to_text();
                let mut body_pos = pos;
                // SWITCH is first-match-wins, like the `switch` it compiles
                // from. Without this, a module with two cases carrying the
                // same value rendered BOTH bodies concatenated.
                let mut matched = false;

                for (val_str_idx, body_len) in &cases {
                    // Hoisted above the match test so a non-matching case is
                    // validated too — otherwise a bad length in an unselected
                    // case still corrupts `body_pos` for its siblings.
                    let case_end = bounded_offset(body_pos, *body_len, region_limit)?;
                    let case_val = strings.get(*val_str_idx)?;
                    if !matched && case_val == slot_text {
                        matched = true;
                        walk_range(
                            module,
                            slots,
                            ops,
                            body_pos,
                            case_end,
                            out,
                            state,
                            depth + 1,
                        )?;
                    }
                    body_pos = case_end;
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
                let body_end = bounded_offset(pos, body_len, region_limit)?;

                // Emit list markers
                let list_marker_id = slot_id;
                push_checked(out, "<!--f:l", limit)?;
                push_u16(out, list_marker_id, limit)?;
                push_checked(out, "-->", limit)?;

                // Take a cheap handle on the array to release the borrow on
                // `slots` before the loop mutates it. The payload is
                // Arc-backed, so this is a refcount bump — and holding it
                // means a body that writes to the list's own slot cannot
                // change what we are iterating.
                let items = match slots.get(slot_id) {
                    SlotValue::Array(a) => Some(a.clone()),
                    _ => None,
                };

                if let Some(items) = items.filter(|a| !a.is_empty()) {
                    state.list_depth += 1;
                    if state.list_depth > MAX_LIST_DEPTH {
                        return Err(IrError::ListDepthExceeded {
                            max: MAX_LIST_DEPTH,
                        });
                    }
                    for item in items.iter() {
                        // Total across all depths, never decremented: depth
                        // alone does not bound volume, and four nested LISTs
                        // over the same array give n^4 body walks.
                        state.list_iterations += 1;
                        if state.list_iterations > state.max_list_iterations {
                            return Err(IrError::ListBudgetExceeded {
                                max: state.max_list_iterations,
                            });
                        }
                        // Scoped binding instead of a per-row `SlotData`
                        // clone: swap the item in, walk, swap back. Same
                        // isolation between rows, without copying every other
                        // slot on the page once per row.
                        let mark = state.slot_journal.len();
                        let previous = slots.replace(item_slot_id, item.clone());
                        state.slot_journal.push((item_slot_id, previous));

                        let walked = walk_range(
                            module,
                            slots,
                            ops,
                            body_start,
                            body_end,
                            out,
                            state,
                            depth + 1,
                        );
                        // Unwind before propagating: an aborted walk must
                        // still hand `slots` back exactly as it was, because
                        // an enclosing row is about to unwind on top of it.
                        state.unwind_slot_journal(slots, mark);
                        walked?;

                        // A LIST_ITEM_KEY that never met an element belongs to
                        // this item only — do not let it leak onto whatever
                        // element the next item (or the code after the list)
                        // happens to open.
                        state.pending_list_key = None;
                    }
                    state.list_depth -= 1;
                }
                state.pending_list_key = None;

                push_checked(out, "<!--/f:l", limit)?;
                push_u16(out, list_marker_id, limit)?;
                push_checked(out, "-->", limit)?;

                pos = body_end;
            }

            Opcode::TryStart => {
                // fallback_len(4) = 4 bytes header
                let fallback_len = read_u32(ops, pos)? as usize;
                pos += 4;
                // Push fallback_len so FALLBACK knows how many bytes to skip.
                // Main body follows inline and is walked by the outer loop.
                fallback_stack.push(fallback_len);
            }

            Opcode::Fallback => {
                // Phase 2: always render main body, skip fallback.
                // Pop the fallback_len pushed by the preceding TRY_START.
                if let Some(skip) = fallback_stack.pop() {
                    pos = bounded_offset(pos, skip, region_limit)?;
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
                // NOTE: this tag carries no CSP nonce. Under a
                // `script-src 'strict-dynamic'` policy an `as="script"`
                // preload hint is dropped by the browser (a degradation, not a
                // breakage — the real module tag is nonced). Threading a nonce
                // in here would change shared emitted HTML and needs the
                // matching JS-walker change; the compiler emits no PRELOAD
                // opcode today, so it is latent.
                push_checked(out, "<link rel=\"preload\" href=\"", limit)?;
                push_escaped_attr(out, url, limit)?;
                push_checked(out, "\" as=\"", limit)?;
                push_checked(out, as_val, limit)?;
                push_checked(out, "\"", limit)?;
                push_checked(out, type_attr, limit)?;
                push_checked(out, ">\n", limit)?;
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
                // Mutate `slots` directly and journal the displaced value, so
                // the enclosing LIST row restores it when the row ends. A PROP
                // outside any list writes for the rest of the page, which is
                // what it did when each row got its own clone.
                let previous = slots.replace(target_slot_id, value);
                state.journal_write(target_slot_id, previous);
            }
        }
    }

    // Post-loop handling depends on the mode:
    match mode {
        WalkMode::Range { .. } => {
            // Flush any pending tag close at the end of the opcode range.
            //
            // NOTE: `pending_island` / `pending_list_key` are deliberately NOT
            // cleared here. This function runs for every nested control-flow
            // body with the same state, so clearing at range end would wipe
            // the island attributes of a legitimate
            // ISLAND_START → SHOW_IF → OPEN_TAG stream (the island root would
            // silently never hydrate). They are cleared at their owning
            // boundaries instead: ISLAND_END and the LIST item loop.
            if state.pending_tag_close {
                push_checked(out, ">", limit)?;
                state.pending_tag_close = false;
            }
            Ok(())
        }
        WalkMode::UntilIslandEnd { target_island_id } => {
            // If we reach the end of the opcode stream without finding ISLAND_END,
            // that means the IR is malformed. Return an error.
            Err(IrError::IslandNotFound(target_island_id))
        }
    }
}

// ---------------------------------------------------------------------------
// Island props helpers
// ---------------------------------------------------------------------------

/// Build a JSON object from the island's slot_ids, looking up names from
/// the slot table and values from the current SlotData.
///
/// DUPLICATE-NAME RULE: two of the island's slots can carry the same name (the
/// compiler derives some names per-element, not per-module). The first one in
/// `slot_ids` order wins, matching [`IrModule::slot_id_by_name`] and
/// [`SlotData::from_json`]; a plain `insert` made the LAST one win here, so the
/// island's props disagreed with every other name lookup in the crate and one
/// of the two values vanished with no diagnostic.
///
/// Verified by: crates/forma-ir/src/walker.rs > "island_props_keep_the_first_slot_for_a_duplicated_name"
fn build_island_props(
    module: &IrModule,
    slots: &SlotData,
    slot_ids: &[u16],
) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for &slot_id in slot_ids {
        // Look up slot name from the slot table (O(1) index)
        if let Some(entry) = module.slot_entry(slot_id) {
            if let Ok(name) = module.strings.get(entry.name_str_idx) {
                if map.contains_key(name) {
                    #[cfg(feature = "tracing")]
                    tracing::warn!(
                        slot_id = slot_id,
                        name = name,
                        "Island declares two slots with the same name — keeping the first, \
                         the later value is not reachable from the props object"
                    );
                    continue;
                }
                let value = slots.get(slot_id).to_json();
                map.insert(name.to_string(), value);
            }
        } else {
            // `IrModule::validate` rejects this at parse time; keep the branch
            // observable in case a module reaches the walker unvalidated,
            // since a silently dropped prop means the island's SSR props
            // disagree with what the client expects.
            #[cfg(feature = "tracing")]
            tracing::warn!(
                slot_id = slot_id,
                "Island references a slot id that is not in the slot table — prop dropped"
            );
        }
    }
    map
}

// ---------------------------------------------------------------------------
// Offset arithmetic
// ---------------------------------------------------------------------------

/// `base + len`, rejected if it overflows or leaves the enclosing region.
///
/// Plain `+` on `usize` cannot wrap on 64-bit but can on wasm32, where
/// `usize` is 32 bits — and this crate ships a WASM build whose `render()` /
/// `render_island()` entry points take arbitrary bytes fetched at runtime.
fn bounded_offset(base: usize, len: usize, limit: usize) -> Result<usize, IrError> {
    base.checked_add(len)
        .filter(|e| *e <= limit)
        .ok_or(IrError::InvalidSection)
}

// ---------------------------------------------------------------------------
// Name and URL safety
// ---------------------------------------------------------------------------

/// True if `name` is safe to emit verbatim as a tag or attribute name.
///
/// Names are written to the output stream unescaped (only *values* go through
/// the escapers), so a string-table entry used as a tag name — `div onload=x`
/// — or as an attribute key — `x"><script` — is direct markup injection. The
/// accepted class is `[A-Za-z_:][-A-Za-z0-9_:.]*`, byte-identical to
/// formajs's `isSafeAttrName`/`isSafeTagName`, and covers every valid HTML,
/// SVG and custom-element name (`data-*`, `aria-*`, `xlink:href`, `viewBox`,
/// dotted component names).
fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == ':' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

/// True for any `on…` event-handler attribute name (case-insensitive).
fn is_event_handler_attr(name: &str) -> bool {
    name.len() >= 2 && name.as_bytes()[..2].eq_ignore_ascii_case(b"on")
}

/// Attributes whose value the browser resolves as a URL.
///
/// Mirrors formajs's `URL_ATTRS` exactly. `srcset` is deliberately absent (a
/// comma-separated candidate list that a single scheme test would misparse,
/// and always fetched in image mode) and so is `cite`; adding either would
/// make the Rust walker stricter than the JS renderer, which is itself a
/// hydration divergence.
const URL_ATTRS: [&str; 8] = [
    "href",
    "src",
    "action",
    "formaction",
    "xlink:href",
    "poster",
    "background",
    "data",
];

/// Tags whose URL-bearing attributes are always fetched as an image or media
/// resource and never parsed as a document — the only places a
/// `data:image/svg+xml` value is safe. Mirrors formajs's `IMAGE_CONTEXT_TAGS`.
const IMAGE_CONTEXT_TAGS: [&str; 13] = [
    "img", "image", "video", "audio", "source", "body", "table", "thead", "tbody", "tfoot", "tr",
    "td", "th",
];

/// True if `name` is a URL-bearing attribute (case-insensitive).
fn is_url_attr(name: &str) -> bool {
    URL_ATTRS.iter().any(|a| name.eq_ignore_ascii_case(a))
}

/// True if writing `value` to a URL attribute on `<tag>` would create an XSS
/// sink.
///
/// Browsers strip ASCII whitespace and C0/C1 control characters out of a URL
/// before resolving its scheme, so `java\tscript:alert(1)` executes even
/// though a naive prefix test does not match it. The value is normalized the
/// same way before testing — byte-identical to formajs's `isDangerousUrl`, so
/// the server emits exactly what the client would have produced.
fn is_dangerous_url(value: &str, tag: &str) -> bool {
    let normalized: String = value
        .chars()
        .filter(|c| {
            let n = *c as u32;
            !((n <= 0x20) || (0x7F..=0x9F).contains(&n))
        })
        .collect();
    let lower = normalized.to_ascii_lowercase();

    if lower.starts_with("javascript") || lower.starts_with("vbscript") {
        return true;
    }
    if lower.starts_with("data:text/html") {
        return true;
    }
    // `data:image/svg+xml` is a *conditional* hazard: through an image sink it
    // decodes in image mode where script never runs; through a document sink
    // an `onload=` inside it fires. It is not blanket-blocked because the
    // stock CSP explicitly permits `img-src data:`.
    if lower.starts_with("data:image/svg+xml") {
        return !IMAGE_CONTEXT_TAGS
            .iter()
            .any(|t| tag.eq_ignore_ascii_case(t));
    }
    false
}

/// How an attribute's value is written out.
///
/// The distinction exists because `key` and `key=""` are the same DOM but
/// `key` and `key="false"` are not: an HTML boolean attribute is ON whenever
/// it is present, whatever its value, so `disabled="false"` disables the
/// control. See [`AttrValue::from_slot`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttrValue<'a> {
    /// Write the bare name, no `="…"`.
    Bare,
    /// Write `key="escaped"`, including when `value` is empty.
    Valued(&'a str),
}

/// Emit one attribute, dropping it entirely if it is unsafe.
///
/// Dropping (rather than emitting an empty value) is what the client does:
/// `renderAttr` returns null and hydration calls `removeAttribute`. An
/// SSR-emitted `href=""` resolves to the current page — a real navigation —
/// and would not match the client DOM.
fn emit_attr(
    out: &mut String,
    tag: &str,
    key: &str,
    val: AttrValue<'_>,
    limit: usize,
) -> Result<(), IrError> {
    if !is_valid_name(key) {
        // Skip silently (matching the walker's existing convention for
        // malformed attribute operands) rather than failing the whole page
        // for one bad key.
        #[cfg(feature = "tracing")]
        tracing::warn!(attr = key, "Dropping attribute with an unsafe name");
        return Ok(());
    }
    if is_event_handler_attr(key) {
        #[cfg(feature = "tracing")]
        tracing::warn!(attr = key, "Dropping event-handler attribute from IR");
        return Ok(());
    }
    if let AttrValue::Valued(v) = val {
        if is_url_attr(key) && is_dangerous_url(v, tag) {
            #[cfg(feature = "tracing")]
            tracing::warn!(attr = key, "Dropping URL attribute with a dangerous scheme");
            return Ok(());
        }
    }

    push_checked(out, " ", limit)?;
    push_checked(out, key, limit)?;
    if let AttrValue::Valued(v) = val {
        push_checked(out, "=\"", limit)?;
        push_escaped_attr(out, v, limit)?;
        push_checked(out, "\"", limit)?;
    }
    Ok(())
}

/// Emit `<tag ...attrs`, plus any pending island / list-item attributes.
///
/// Shared by OPEN_TAG and VOID_TAG, which differ only in whether a matching
/// CLOSE_TAG follows. The `>` is deliberately not written yet: DYN_ATTR
/// opcodes may still append attributes.
fn emit_open_tag(
    out: &mut String,
    tag: &str,
    attrs: &[(&str, &str)],
    state: &mut WalkState,
    limit: usize,
) -> Result<(), IrError> {
    if !is_valid_name(tag) {
        return Err(IrError::InvalidName(tag.to_string()));
    }
    push_checked(out, "<", limit)?;
    push_checked(out, tag, limit)?;

    for (key, val) in attrs {
        // A static attribute is authored text, never a boolean. An empty value
        // stays the bare name: `key` and `key=""` parse to the same DOM, and
        // keeping the shorthand leaves already-compiled modules byte-stable.
        let value = if val.is_empty() {
            AttrValue::Bare
        } else {
            AttrValue::Valued(val)
        };
        emit_attr(out, tag, key, value, limit)?;
    }

    // Inject pending island attributes
    if let Some(island) = state.pending_island.take() {
        push_checked(out, " data-forma-island=\"", limit)?;
        push_u16(out, island.id, limit)?;
        push_checked(out, "\" data-forma-component=\"", limit)?;
        push_escaped_attr(out, &island.component_name, limit)?;
        push_checked(out, "\" data-forma-status=\"pending\"", limit)?;
        let trigger_str = match island.trigger {
            IslandTrigger::Load => "load",
            IslandTrigger::Visible => "visible",
            IslandTrigger::Interaction => "interaction",
            IslandTrigger::Idle => "idle",
        };
        push_checked(out, " data-forma-hydrate=\"", limit)?;
        push_checked(out, trigger_str, limit)?;
        push_checked(out, "\"", limit)?;
        if let Some(ref props_json) = island.inline_props {
            push_checked(out, " data-forma-props=\"", limit)?;
            push_escaped_attr(out, props_json, limit)?;
            push_checked(out, "\"", limit)?;
        }
    }

    // Inject pending list-item key
    if let Some(key) = state.pending_list_key.take() {
        push_checked(out, " data-forma-key=\"", limit)?;
        push_escaped_attr(out, &key, limit)?;
        push_checked(out, "\"", limit)?;
    }

    // Don't close the tag yet — DYN_ATTR opcodes may follow.
    state.pending_tag_close = true;
    state.pending_tag_name.clear();
    state.pending_tag_name.push_str(tag);
    Ok(())
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

    // `attr_count` is u16-bounded but each pair costs 8 bytes on disk and a
    // fat-pointer pair in memory — bound the reservation by what is actually
    // left. A valid stream still gets one exact allocation.
    let mut attrs = Vec::with_capacity(attr_count.min(ops.len().saturating_sub(cursor) / 8));
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
// Budgeted output helpers
// ---------------------------------------------------------------------------

/// Longest escape sequence any of the escapers can emit for one character
/// (`&amp;`, `&quot;`, `<`).
const MAX_ESCAPE_EXPANSION: usize = 6;

/// Append `s`, refusing to exceed the walk's output budget.
///
/// Every append routes through here (or one of the escaping variants below)
/// because a *single* opcode can emit gigabytes: OPEN_TAG accepts up to 65,535
/// attributes, each with a 65,535-character value that escapes 5x, so a check
/// only at the top of the opcode loop never runs in time.
fn push_checked(out: &mut String, s: &str, limit: usize) -> Result<(), IrError> {
    if out.len().saturating_add(s.len()) > limit {
        return Err(IrError::OutputLimitExceeded { limit });
    }
    out.push_str(s);
    Ok(())
}

/// Append a `u16` in decimal, within the output budget, without allocating.
///
/// Marker ids are the hottest thing the walker writes — every DYN_TEXT emits
/// its id twice, every SHOW_IF and LIST likewise, and a list body repeats all
/// of that once per row. `to_string()` heap-allocated for each one.
fn push_u16(out: &mut String, value: u16, limit: usize) -> Result<(), IrError> {
    // u16::MAX is 65535: five digits, never more.
    let mut buf = [0u8; 5];
    let mut remaining = value;
    let mut start = buf.len();
    loop {
        start -= 1;
        buf[start] = b'0' + (remaining % 10) as u8;
        remaining /= 10;
        if remaining == 0 {
            break;
        }
    }
    let digits = core::str::from_utf8(&buf[start..]).expect("ASCII digits are valid UTF-8");
    push_checked(out, digits, limit)
}

/// Escape text for HTML content (`& < >`), within the output budget.
fn push_escaped_html(out: &mut String, text: &str, limit: usize) -> Result<(), IrError> {
    // Fast path: even worst-case expansion fits, so no per-character checks.
    if out
        .len()
        .saturating_add(text.len().saturating_mul(MAX_ESCAPE_EXPANSION))
        <= limit
    {
        for ch in text.chars() {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                _ => out.push(ch),
            }
        }
        return Ok(());
    }
    for ch in text.chars() {
        match ch {
            '&' => push_checked(out, "&amp;", limit)?,
            '<' => push_checked(out, "&lt;", limit)?,
            '>' => push_checked(out, "&gt;", limit)?,
            _ => {
                if out.len() >= limit {
                    return Err(IrError::OutputLimitExceeded { limit });
                }
                out.push(ch);
            }
        }
    }
    Ok(())
}

/// Escape text for HTML attribute values (`& " < >`), within the output budget.
fn push_escaped_attr(out: &mut String, text: &str, limit: usize) -> Result<(), IrError> {
    if out
        .len()
        .saturating_add(text.len().saturating_mul(MAX_ESCAPE_EXPANSION))
        <= limit
    {
        for ch in text.chars() {
            match ch {
                '&' => out.push_str("&amp;"),
                '"' => out.push_str("&quot;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                _ => out.push(ch),
            }
        }
        return Ok(());
    }
    for ch in text.chars() {
        match ch {
            '&' => push_checked(out, "&amp;", limit)?,
            '"' => push_checked(out, "&quot;", limit)?,
            '<' => push_checked(out, "&lt;", limit)?,
            '>' => push_checked(out, "&gt;", limit)?,
            _ => {
                if out.len() >= limit {
                    return Err(IrError::OutputLimitExceeded { limit });
                }
                out.push(ch);
            }
        }
    }
    Ok(())
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
        // ISLAND_START(0) + TEXT content + ISLAND_END(0). The island body
        // opens no element, so the island contributes markers only — its
        // attributes are dropped at ISLAND_END with a warning.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_text(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["Hello"],
            &[],
            &[(0, 0x01, 0x01, 0, 0, &[])],
            &opcodes,
            &slots,
        );
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

    // -- DYN_ATTR value semantics (W2 / F15) --------------------------------

    /// Helper: `<input DYN_ATTR(disabled, slot 0)>` with slot 0 set to `value`.
    fn walk_dyn_attr_with(value: SlotValue) -> String {
        let mut opcodes = encode_void_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let mut slots = SlotData::new(1);
        slots.set(0, value);
        walk_with_slots(
            &["input", "disabled"],
            &[(0, 1, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        )
    }

    #[test]
    fn dyn_attr_bool_matches_the_client_renderer() {
        // An HTML boolean attribute is ON whenever it is PRESENT, whatever its
        // value — `disabled="false"` disables the control. The walker used to
        // emit exactly that, so SSR shipped a disabled/hidden/checked control
        // that only un-broke itself after hydration, and never at all for a
        // visible/idle/interaction island the user had not reached, or with JS
        // off. These are byte-for-byte what `renderAttr` in @getforma/core
        // produces for the same values.
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Bool(true)),
            "<input disabled>",
            "true must render the bare attribute"
        );
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Bool(false)),
            "<input>",
            "false must omit the attribute, not write disabled=\"false\""
        );
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Null),
            "<input>",
            "null must omit the attribute"
        );
    }

    #[test]
    fn dyn_attr_empty_string_is_a_value_not_an_absence() {
        // `renderAttr(key, "")` emits `key=""`, and the client hydrating the
        // same slot calls setAttribute(key, "") — dropping the attribute here
        // is a real DOM difference on the common `value=""` / `alt=""` case.
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Text(String::new())),
            "<input disabled=\"\">"
        );
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Text("yes".into())),
            "<input disabled=\"yes\">"
        );
        // Numbers stringify, they do not vanish: 0 is a value.
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Number(0.0)),
            "<input disabled=\"0\">"
        );
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
        assert!(
            html.contains("Shown"),
            "truthy text should render then branch"
        );
        assert!(
            !html.contains("Hidden"),
            "truthy text should NOT render else branch"
        );
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
        assert!(
            !html.contains("Present"),
            "null should NOT render then branch"
        );
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
        assert_eq!(
            html, "<!--f:s0--><!--/f:s0-->",
            "empty else should produce only markers"
        );
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
        slots.set(0, SlotValue::Bool(true)); // outer true
        slots.set(1, SlotValue::Bool(false)); // inner false

        let html = walk_with_slots(
            &[
                "outer",
                "inner",
                "outer-yes",
                "outer-no",
                "inner-yes",
                "inner-no",
            ],
            &[(0, 0, 0x02, 0x00, &[]), (1, 1, 0x02, 0x00, &[])],
            &opcodes,
            &slots,
        );
        // Outer is true → walk inner. Inner is false → render "inner-no"
        assert!(
            html.contains("inner-no"),
            "nested: inner false should render inner else"
        );
        assert!(
            !html.contains("inner-yes"),
            "nested: inner true branch should not render"
        );
        assert!(
            !html.contains("outer-no"),
            "nested: outer else should not render"
        );
        // Verify correct nesting of markers
        assert!(
            html.contains("<!--f:s0-->"),
            "should have outer opening marker"
        );
        assert!(
            html.contains("<!--/f:s0-->"),
            "should have outer closing marker"
        );
        assert!(
            html.contains("<!--f:s1-->"),
            "should have inner opening marker"
        );
        assert!(
            html.contains("<!--/f:s1-->"),
            "should have inner closing marker"
        );
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
            html, "<!--f:s0--><span>Hello</span><!--/f:s0-->",
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
            SlotValue::array(vec![
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
        assert!(
            html.starts_with("<!--f:l0-->"),
            "should start with list open marker"
        );
        assert!(
            html.ends_with("<!--/f:l0-->"),
            "should end with list close marker"
        );
    }

    // -- Test 21: walk_list_empty_array ------------------------------------

    #[test]
    fn walk_list_empty_array() {
        // LIST(slot=0, item_slot=1): body = DYN_TEXT(slot=1, marker=0)
        // slot 0 = Array([])
        let body = encode_dyn_text(1, 0);
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::array(vec![]));

        let html = walk_with_slots(
            &["items", "item"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html, "<!--f:l0--><!--/f:l0-->",
            "empty array should produce only markers"
        );
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
            SlotValue::array(vec![
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
        assert_eq!(
            html, "<!--f:l0--><!--/f:l0-->",
            "null slot should produce only markers"
        );
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
            SlotValue::array(vec![
                SlotValue::array(vec![
                    SlotValue::Text("a".to_string()),
                    SlotValue::Text("b".to_string()),
                ]),
                SlotValue::array(vec![SlotValue::Text("c".to_string())]),
            ]),
        );

        let html = walk_with_slots(
            &["outer", "inner", "item"],
            &[
                (0, 0, 0x04, 0x00, &[]),
                (1, 1, 0x04, 0x00, &[]),
                (2, 2, 0x01, 0x00, &[]),
            ],
            &opcodes,
            &slots,
        );
        // Verify all items rendered
        assert!(html.contains("a"), "should contain nested item 'a'");
        assert!(html.contains("b"), "should contain nested item 'b'");
        assert!(html.contains("c"), "should contain nested item 'c'");
        // Verify outer list markers
        assert!(
            html.starts_with("<!--f:l0-->"),
            "should have outer list open marker"
        );
        assert!(
            html.ends_with("<!--/f:l0-->"),
            "should have outer list close marker"
        );
        // Verify inner list markers present
        assert!(
            html.contains("<!--f:l1-->"),
            "should have inner list open marker"
        );
        assert!(
            html.contains("<!--/f:l1-->"),
            "should have inner list close marker"
        );
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
        slots.set(
            0,
            SlotValue::array(vec![SlotValue::array(vec![SlotValue::array(vec![
                SlotValue::array(vec![SlotValue::array(vec![SlotValue::Text(
                    "deep".to_string(),
                )])]),
            ])])]),
        );
        // Inner slots get shadowed during iteration

        let data = build_minimal_ir(
            &["s0", "s1", "s2", "s3", "s4", "s5"],
            &[
                (0, 0, 0x04, 0x00, &[]),
                (1, 1, 0x04, 0x00, &[]),
                (2, 2, 0x04, 0x00, &[]),
                (3, 3, 0x04, 0x00, &[]),
                (4, 4, 0x04, 0x00, &[]),
                (5, 5, 0x01, 0x00, &[]),
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
        assert!(
            !html.contains("Home"),
            "should NOT contain non-matching case text"
        );
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
        assert!(
            html.is_empty(),
            "no match should produce empty output, got: {html}"
        );
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
        assert!(
            !html.contains("About"),
            "should NOT contain second case text"
        );
    }

    #[test]
    fn walk_switch_stops_at_the_first_match() {
        // Two cases carrying the SAME value. Without a break the walker
        // rendered both bodies concatenated — a `switch` statement does not.
        let opcodes = encode_switch(0, &[(1, &encode_text(2)), (1, &encode_text(3))]);

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("home".to_string()));

        let html = walk_with_slots(
            &["page", "home", "FIRST", "SECOND"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(html, "FIRST");
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
        assert_eq!(
            html, "<span>Active</span>",
            "should produce full HTML element from matching case"
        );
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
        assert!(
            !html.contains("Fallback"),
            "should NOT contain fallback text"
        );
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
        opcodes.extend_from_slice(&encode_open_tag(0, &[(1, 2)])); // <html lang="en">
        opcodes.extend_from_slice(&encode_open_tag(3, &[])); // <head>
        opcodes.extend_from_slice(&encode_void_tag(4, &[(5, 6)])); // <meta charset="utf-8">
        opcodes.extend_from_slice(&encode_open_tag(7, &[])); // <title>
        opcodes.extend_from_slice(&encode_text(8)); // Test
        opcodes.extend_from_slice(&encode_close_tag(7)); // </title>
        opcodes.extend_from_slice(&encode_close_tag(3)); // </head>
        opcodes.extend_from_slice(&encode_open_tag(9, &[])); // <body>
        opcodes.extend_from_slice(&encode_open_tag(10, &[(11, 12)])); // <div id="app">
        opcodes.extend_from_slice(&encode_close_tag(10)); // </div>
        opcodes.extend_from_slice(&encode_close_tag(9)); // </body>
        opcodes.extend_from_slice(&encode_close_tag(0)); // </html>

        let ir = build_minimal_ir(
            &[
                "html", "lang", "en", "head", "meta", "charset", "utf-8", "title", "Test", "body",
                "div", "id", "app",
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
        opcodes.extend_from_slice(&encode_dyn_text(0, 0)); // DYN_TEXT slot=0 marker=0
        opcodes.extend_from_slice(&encode_close_tag(0)); // </div>

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
        body.extend_from_slice(&encode_open_tag(2, &[])); // <li>
        body.extend_from_slice(&encode_dyn_text(1, 0)); // DYN_TEXT slot=1 marker=0
        body.extend_from_slice(&encode_close_tag(2)); // </li>

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
            SlotValue::array(vec![
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
        opcodes.extend_from_slice(&show_if_ops); // SHOW_IF auth
        opcodes.extend_from_slice(&encode_open_tag(8, &[])); // <ul>
        opcodes.extend_from_slice(&list_ops); // LIST items
        opcodes.extend_from_slice(&encode_close_tag(8)); // </ul>
        opcodes.extend_from_slice(&encode_close_tag(0)); // </nav>

        let ir = build_minimal_ir(
            &[
                "nav", "class", "main-nav", "auth", "span", "Welcome", "items", "item", "ul", "li",
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
            SlotValue::array(vec![
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
        assert_eq!(html, r#"<li data-forma-key="user-123">item</li>"#);
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
        assert_eq!(html, r#"<hr data-forma-key="key-42">"#);
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
        assert_eq!(html, r#"<li class="item" data-forma-key="k1">content</li>"#);
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
        let script_start =
            html.find(r#"type="application/json">"#).unwrap() + r#"type="application/json">"#.len();
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
        // An ISLAND_START whose id is absent from the island table used to
        // render happily: markers, but no `data-forma-*` attributes, so the
        // client could never hydrate that island and nothing said why. It is
        // now a load-time error instead of an invisible one at runtime.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(5));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_text(1));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(5));

        let data = build_minimal_ir(&["div", "Hello"], &[], &opcodes, &[]);
        assert_eq!(
            IrModule::parse(&data).unwrap_err(),
            IrError::UnknownIslandId(5)
        );
    }

    #[test]
    fn walk_nested_island_start_before_a_root_element_is_an_error() {
        // Only one element can carry a data-forma-island set, so an island
        // that opens another island before its own root element would have
        // silently lost its identity — never hydrated, never disposed.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_island_start(1));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let data = build_minimal_ir(
            &["div", "Outer", "Inner"],
            &[],
            &opcodes,
            &[(0, 0x01, 0x01, 1, 0, &[]), (1, 0x01, 0x01, 2, 3, &[])],
        );
        let module = IrModule::parse(&data).unwrap();
        assert_eq!(
            walk_to_html(&module, &slots).unwrap_err(),
            IrError::NestedIslandRoot { outer: 0, inner: 1 }
        );
    }

    #[test]
    fn walk_island_nested_inside_another_islands_root_is_fine() {
        // The legal shape: each island opens its own element first.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_island_start(1));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(1));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(0);
        let inner_offset = (encode_island_start(0).len() + encode_open_tag(0, &[]).len()) as u32;
        let html = walk_with_islands(
            &["div", "Outer", "Inner"],
            &[],
            &[
                (0, 0x01, 0x01, 1, 0, &[]),
                (1, 0x01, 0x01, 2, inner_offset, &[]),
            ],
            &opcodes,
            &slots,
        );
        assert!(html.contains(r#"data-forma-component="Outer""#));
        assert!(html.contains(r#"data-forma-component="Inner""#));
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

    // -- Inline props size ceiling (F8) --------------------------------------

    /// Build a one-island page whose single prop slot holds `payload`.
    fn walk_island_with_prop_payload(payload: &str) -> String {
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(payload.to_string()));
        walk_with_islands(
            &["div", "Big", "blob"],
            &[(0, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x01, 1, 0, &[0])],
            &opcodes,
            &slots,
        )
    }

    #[test]
    fn island_props_keep_the_first_slot_for_a_duplicated_name() {
        // Slots 0 and 1 are both named "dup". The three name-resolving paths
        // in this crate used to pick differently (first / last / last by
        // ascending id); they all keep the first now.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("first".into()));
        slots.set(1, SlotValue::Text("second".into()));

        let html = walk_with_islands(
            &["div", "Comp", "dup"],
            &[(0, 2, 0x01, 0x00, &[]), (1, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x01, 1, 0, &[0, 1])],
            &opcodes,
            &slots,
        );
        assert!(
            html.contains(r#"data-forma-props="{&quot;dup&quot;:&quot;first&quot;}""#),
            "expected the first slot to win, got: {html}"
        );
    }

    #[test]
    fn inline_props_under_the_ceiling_stay_inline() {
        let html = walk_island_with_prop_payload("small");
        assert!(html.contains(r#"data-forma-props="{&quot;blob&quot;:&quot;small&quot;}""#));
        assert!(!html.contains("__forma_islands"));
    }

    #[test]
    fn inline_props_over_the_ceiling_spill_to_the_shared_block() {
        // An unbounded `data-forma-props` is a multi-kilobyte attribute
        // repeated on every island root. Above the ceiling the payload moves
        // to the shared block — and to EXACTLY one of the two channels, since
        // the client reads the inline attribute first and would never look at
        // the block if both were present.
        let payload = "x".repeat(INLINE_PROPS_MAX_BYTES + 1);
        let html = walk_island_with_prop_payload(&payload);
        assert!(
            !html.contains("data-forma-props"),
            "over-size props must not stay in the attribute"
        );
        assert!(
            html.contains(r#"<script id="__forma_islands" type="application/json">"#),
            "over-size props must land in the shared block, got: {}",
            &html[..html.len().min(200)]
        );
        assert!(html.contains(&payload), "the payload itself must survive");
    }

    #[test]
    fn island_fragment_keeps_over_size_props_inline() {
        // A fragment cannot emit a second `__forma_islands` block: it would
        // duplicate a DOM id and, being earlier in document order after the
        // swap, shadow the page's own block for every other island.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let payload = "x".repeat(INLINE_PROPS_MAX_BYTES + 1);
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(payload));

        let data = build_minimal_ir(
            &["div", "Big", "blob"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[(0, 0x01, 0x01, 1, 0, &[0])],
        );
        let module = IrModule::parse(&data).unwrap();
        let fragment = walk_island(&module, &slots, 0).unwrap();
        assert!(fragment.contains("data-forma-props"));
        assert!(!fragment.contains("__forma_islands"));
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
        // Island 1 — its byte_offset must point at its own ISLAND_START.
        let island1_offset = opcodes.len() as u32;
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
                (1, 0x01, 0x02, 3, island1_offset, &[1]), // island 1, ScriptTag, name="CompB", slots=[1]
            ],
            &opcodes,
            &slots,
        );
        // Parse the script tag JSON
        let script_start =
            html.find(r#"type="application/json">"#).unwrap() + r#"type="application/json">"#.len();
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
        assert_eq!(html, r#"<li data-forma-key="abc"><span>text</span></li>"#);
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
        assert_eq!(
            SlotValue::Bool(true).to_json(),
            serde_json::Value::Bool(true)
        );
        assert_eq!(
            SlotValue::Bool(false).to_json(),
            serde_json::Value::Bool(false)
        );
        assert_eq!(SlotValue::Number(42.0).to_json(), serde_json::json!(42));
        assert_eq!(SlotValue::Number(3.15).to_json(), serde_json::json!(3.15));
        assert_eq!(
            SlotValue::array(vec![
                SlotValue::Text("a".to_string()),
                SlotValue::Number(1.0)
            ])
            .to_json(),
            serde_json::json!(["a", 1])
        );
        assert_eq!(
            SlotValue::object(vec![(
                "key".to_string(),
                SlotValue::Text("val".to_string())
            ),])
            .to_json(),
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
            &[(0, 3, 0x01, 0x01, b"text"), (1, 4, 0x01, 0x01, b"")],
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
        // The fragment is the island ROOT carrying the full data-forma-* set —
        // seeking past ISLAND_START used to drop all of it, so a fragment
        // swapped in via outerHTML never hydrated.
        assert_eq!(
            html,
            "<p data-forma-island=\"0\" data-forma-component=\"MyIsland\" \
             data-forma-status=\"pending\" data-forma-hydrate=\"load\">hello</p>"
        );
        // The f:iN markers live outside the root and survive an outerHTML
        // swap, so the fragment must not re-emit them.
        assert!(!html.contains("<!--f:i0-->"));
        assert!(!html.contains("<!--/f:i0-->"));
    }

    #[test]
    fn walk_island_attrs_match_walk_to_html() {
        // Parity: the fragment's root must carry the same data-forma-*
        // attribute set that the full-page walk produces for the same island.
        let island_start = encode_island_start(0);
        let open_div = encode_open_tag(1, &[]);
        let dyn_text = encode_dyn_text(0, 0);
        let close_div = encode_close_tag(1);
        let island_end = encode_island_end(0);

        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&island_start);
        opcodes.extend_from_slice(&open_div);
        opcodes.extend_from_slice(&dyn_text);
        opcodes.extend_from_slice(&close_div);
        opcodes.extend_from_slice(&island_end);

        let data = build_minimal_ir(
            &["IslandComp", "div", "greeting"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[(0, 0x02, 0x01, 0, 0, &[0])], // trigger=Visible, Inline props
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".to_string()));

        let page = walk_to_html(&module, &slots).unwrap();
        let fragment = walk_island(&module, &slots, 0).unwrap();

        for attr in [
            "data-forma-island=\"0\"",
            "data-forma-component=\"IslandComp\"",
            "data-forma-status=\"pending\"",
            "data-forma-hydrate=\"visible\"",
            "data-forma-props=",
        ] {
            assert!(page.contains(attr), "page missing {attr}: {page}");
            assert!(
                fragment.contains(attr),
                "fragment missing {attr}: {fragment}"
            );
        }
    }

    #[test]
    fn walk_island_script_tag_mode_inlines_props_in_fragment() {
        // A ScriptTag island rendered as a fragment must inline its props
        // rather than emit a second __forma_islands block: that would
        // duplicate a DOM id, and because the injected copy precedes the SSR
        // one in document order it would shadow it — every other ScriptTag
        // island would then read a truncated shared-props map.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let data = build_minimal_ir(
            &["IslandComp", "div", "greeting"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[(0, 0x01, 0x02, 0, 0, &[0])], // props_mode = ScriptTag
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".to_string()));

        let fragment = walk_island(&module, &slots, 0).unwrap();
        assert!(
            fragment.contains("data-forma-props="),
            "ScriptTag island fragment must inline its props: {fragment}"
        );
        assert!(
            !fragment.contains("__forma_islands"),
            "fragment must not emit a second islands block: {fragment}"
        );
    }

    #[test]
    fn walk_island_nested_script_tag_island_keeps_its_props() {
        // A nested ScriptTag island would otherwise push into the shared
        // script_tag_props map, which a fragment render drops on return — so
        // the nested island would mount with null props.
        let mut opcodes = encode_island_start(0);
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        let inner_offset = opcodes.len() as u32;
        opcodes.extend_from_slice(&encode_island_start(1));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(1));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let data = build_minimal_ir(
            &["Outer", "div", "greeting", "Inner"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[
                (0, 0x01, 0x01, 0, 0, &[]),
                (1, 0x01, 0x02, 3, inner_offset, &[0]), // nested, ScriptTag
            ],
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("World".into()));

        let fragment = walk_island(&module, &slots, 0).unwrap();
        assert!(
            fragment.contains("data-forma-component=\"Inner\""),
            "nested island must render: {fragment}"
        );
        assert!(
            fragment.contains("data-forma-props="),
            "nested ScriptTag island must keep its props inline: {fragment}"
        );
        assert!(!fragment.contains("__forma_islands"), "{fragment}");
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
        // Root element keeps its island identity AND its props.
        assert_eq!(
            html,
            "<div data-forma-island=\"0\" data-forma-component=\"IslandComp\" \
             data-forma-status=\"pending\" data-forma-hydrate=\"load\" \
             data-forma-props=\"{&quot;greeting&quot;:&quot;World&quot;}\">\
             <!--f:t0-->World<!--/f:t0--></div>"
        );
    }

    #[test]
    fn walk_island_byte_offset_out_of_bounds() {
        // Island table entry with byte_offset pointing past the opcode stream.
        // This is now rejected at parse time: a byte_offset must point at that
        // island's own ISLAND_START opcode, which is both a bounds check and a
        // structural one (an in-range offset landing mid-operand on a stray
        // 0x0B byte would pass a bare bounds check).
        let opcodes = encode_text(0); // just a small opcode stream

        let data = build_minimal_ir(
            &["BadIsland", "hello"],
            &[],
            &opcodes,
            &[(0, 0x01, 0x01, 0, 9999, &[])], // byte_offset=9999, way past end
        );
        let err = IrModule::parse(&data).unwrap_err();
        assert_eq!(
            err,
            IrError::IslandOffsetMismatch {
                island_id: 0,
                byte_offset: 9999
            }
        );
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
            SlotValue::array(vec![
                SlotValue::object(vec![(
                    "name".to_string(),
                    SlotValue::Text("Alice".to_string()),
                )]),
                SlotValue::object(vec![(
                    "name".to_string(),
                    SlotValue::Text("Bob".to_string()),
                )]),
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
        body.extend_from_slice(&encode_dyn_text(2, 0)); // name
        body.extend_from_slice(&encode_close_tag(5)); // </td>
        body.extend_from_slice(&encode_open_tag(5, &[])); // <td>
        body.extend_from_slice(&encode_dyn_text(3, 1)); // email
        body.extend_from_slice(&encode_close_tag(5)); // </td>
        body.extend_from_slice(&encode_close_tag(4)); // </tr>
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(4);
        slots.set(
            0,
            SlotValue::array(vec![
                SlotValue::object(vec![
                    ("name".to_string(), SlotValue::Text("Alice".to_string())),
                    (
                        "email".to_string(),
                        SlotValue::Text("alice@test.com".to_string()),
                    ),
                ]),
                SlotValue::object(vec![
                    ("name".to_string(), SlotValue::Text("Bob".to_string())),
                    (
                        "email".to_string(),
                        SlotValue::Text("bob@test.com".to_string()),
                    ),
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
        assert!(
            html.contains("<td><!--f:t0-->Alice<!--/f:t0--></td>"),
            "should contain Alice td, got: {html}"
        );
        assert!(
            html.contains("<td><!--f:t1-->alice@test.com<!--/f:t1--></td>"),
            "should contain alice email, got: {html}"
        );
        assert!(
            html.contains("<td><!--f:t0-->Bob<!--/f:t0--></td>"),
            "should contain Bob td, got: {html}"
        );
        assert!(
            html.contains("<td><!--f:t1-->bob@test.com<!--/f:t1--></td>"),
            "should contain bob email, got: {html}"
        );
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
            &[(0, 0, 0x01, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        // PROP on non-Object produces Null → DYN_TEXT renders zero-width space (U+200B)
        assert!(
            html.contains("<!--f:t0-->\u{200B}<!--/f:t0-->"),
            "non-object PROP should produce empty text, got: {html}"
        );
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
            SlotValue::object(vec![(
                "name".to_string(),
                SlotValue::Text("Alice".to_string()),
            )]),
        );

        let html = walk_with_slots(
            &["src", "target", "missing"],
            &[(0, 0, 0x05, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            html.contains("<!--f:t0-->\u{200B}<!--/f:t0-->"),
            "missing property should produce empty text, got: {html}"
        );
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

    /// Build a one-island ScriptTag-mode page whose single prop is `payload`,
    /// and return (full html, the raw script-block body).
    fn script_tag_props_html(payload: &str) -> (String, String) {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // strings: 0="div", 1="Comp", 2="payload"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(payload.to_string()));

        let html = walk_with_islands(
            &["div", "Comp", "payload"],
            &[(0, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x02, 1, 0, &[0])],
            &opcodes,
            &slots,
        );

        const OPEN: &str = "type=\"application/json\">";
        let start = html.find(OPEN).expect("islands script block") + OPEN.len();
        let end = html[start..].find("</script>").expect("script close") + start;
        let body = html[start..end].to_string();
        (html, body)
    }

    #[test]
    fn walk_script_tag_props_body_has_no_raw_angle_brackets() {
        // The property that actually makes the escaping total: no bare '<' or
        // '>' survives into the data block, so nothing in it can terminate or
        // re-open the enclosing <script> element. Escaping only "</" (as this
        // used to) is not enough — see the breakout test below.
        let (_html, body) = script_tag_props_html("</script>alert(1)");
        assert!(
            !body.contains('<') && !body.contains('>'),
            "islands block must contain no raw angle brackets, got: {body}"
        );
        assert!(body.contains("\\u003c/script\\u003e"), "got: {body}");

        // ...and the escaping is value-preserving: JSON.parse (here
        // serde_json::from_str, which decodes \u003c identically) round-trips
        // back to the original prop value.
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["0"]["payload"], "</script>alert(1)");
    }

    #[test]
    fn walk_script_tag_props_escapes_comment_script_breakout() {
        // The payload the old "</" replace did NOT handle. `<!--` followed by
        // `<script` drives a spec-compliant HTML tokenizer into the
        // script-data-double-escaped state, where our own trailing </script>
        // is consumed as text instead of ending the element — swallowing the
        // whole rest of the page and leaving an inert page.
        let payload = "<!--<script>PAYLOAD";
        let (html, body) = script_tag_props_html(payload);

        assert!(
            !html.contains("<!--<script"),
            "must not emit the script-data-double-escape trigger, got: {html}"
        );
        assert!(!body.contains('<') && !body.contains('>'), "got: {body}");

        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["0"]["payload"], payload);
    }

    #[test]
    #[ignore = "requires admin/dist IR files — run in monorepo or after `npm run build`"]
    fn walk_real_benchmark_ir() {
        // Find the benchmark IR file dynamically (hash changes on rebuild)
        let dist_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../admin/dist");
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
        assert!(
            html.contains("data-forma-island=\"0\""),
            "missing island 0 attr"
        );

        // The key assertion: island content must include FilterBar's children
        // (not just an empty shell div)
        assert!(
            html.contains("Search"),
            "FilterBar must contain 'Search' label text in SSR"
        );
        assert!(
            html.contains("filter-group"),
            "FilterBar must contain filter-group divs in SSR"
        );
        assert!(
            html.contains("Sort by"),
            "FilterBar must contain 'Sort by' label text in SSR"
        );

        // PerfPanel content
        assert!(
            html.contains("Performance"),
            "PerfPanel must contain 'Performance' heading in SSR"
        );

        // BenchmarkDataTable — SHOW_IF may pick either branch depending on slot defaults
        // Just check the structure exists
        assert!(
            html.contains("benchmark-data-table"),
            "BenchmarkDataTable root class must exist"
        );

        // The FilterBar island must be a real, closed region, not just a
        // stray opening marker. (This replaced a pair of `eprintln!`s that
        // printed the region "for manual inspection" and asserted nothing.)
        let start = html
            .find("<!--f:i0-->")
            .expect("FilterBar island start marker");
        let end = html
            .find("<!--/f:i0-->")
            .expect("FilterBar island end marker");
        assert!(end > start, "island end marker must follow its start");
    }

    // -- Output budget (F-02) -----------------------------------------------

    #[test]
    fn walk_output_limit_trips_inside_one_opcode() {
        // The case a top-of-loop check cannot catch: ONE OpenTag opcode can
        // emit hundreds of megabytes, because attr_count goes to u16::MAX and
        // every value escapes up to 5x. The budget must be enforced by the
        // append itself, not once per iteration.
        let big = "&".repeat(4096); // escapes to 5x = 20 KiB each
        let attrs: Vec<(u32, u32)> = (0..200).map(|_| (1u32, 2u32)).collect();
        let opcodes = encode_open_tag(0, &attrs);

        let data = build_minimal_ir(&["div", "data-x", &big], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);

        let limits = WalkLimits {
            max_output_bytes: 64 * 1024,
            ..WalkLimits::default()
        };
        let err = walk_to_html_with_limits(&module, &slots, limits).unwrap_err();
        assert_eq!(err, IrError::OutputLimitExceeded { limit: 64 * 1024 });

        // ...and a generous budget still renders it.
        let ok = WalkLimits {
            max_output_bytes: 64 * 1024 * 1024,
            ..WalkLimits::default()
        };
        assert!(walk_to_html_with_limits(&module, &slots, ok).is_ok());
    }

    #[test]
    fn walk_output_limit_trips_on_a_single_dyn_text_value() {
        // DynText emits a whole slot value in one iteration too.
        let opcodes = encode_dyn_text(0, 0);
        let data = build_minimal_ir(&["msg"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("x".repeat(100_000)));

        let limits = WalkLimits {
            max_output_bytes: 4096,
            ..WalkLimits::default()
        };
        assert!(matches!(
            walk_to_html_with_limits(&module, &slots, limits),
            Err(IrError::OutputLimitExceeded { .. })
        ));
    }

    // -- LIST iteration budget (F-08) ---------------------------------------

    #[test]
    fn walk_list_budget_exceeded() {
        // Depth bounds nesting, not volume: two nested LISTs over the same
        // 300-element array is 90,000 body walks from a tiny module.
        let body = encode_text(2);
        let inner = encode_list(0, 1, &body);
        let opcodes = encode_list(0, 1, &inner);

        let data = build_minimal_ir(
            &["items", "item", "x"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::array((0..300).map(|_| SlotValue::Text("a".into())).collect()),
        );

        let err = walk_to_html(&module, &slots).unwrap_err();
        assert_eq!(
            err,
            IrError::ListBudgetExceeded {
                max: DEFAULT_MAX_LIST_ITERATIONS
            }
        );
        // Deliberately a DIFFERENT error from ListDepthExceeded — an operator
        // reading "nested LIST depth exceeded maximum of 4" for this case
        // would be chasing the wrong thing.
        assert_ne!(
            err,
            IrError::ListDepthExceeded {
                max: MAX_LIST_DEPTH
            }
        );
    }

    // -- Offset arithmetic and structural tiling (F-06 / F-07) --------------

    /// Corrupt a u32 length field inside an opcode buffer.
    fn patch_u32(buf: &mut [u8], at: usize, value: u32) {
        buf[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn parse_rejects_show_if_then_len_past_the_stream() {
        // SHOW_IF: opcode(1) slot_id(2) then_len(4) else_len(4)
        let mut opcodes = encode_show_if(0, &encode_text(1), &encode_text(1));
        patch_u32(&mut opcodes, 3, 0xFFFF_FF00); // then_len
        let data = build_minimal_ir(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
        assert!(matches!(
            IrModule::parse(&data),
            Err(IrError::MalformedControlFlow { .. })
        ));
    }

    #[test]
    fn parse_rejects_show_if_marker_byte_that_is_not_show_else() {
        // then_len short by one, so the byte at then_end is a TEXT opcode
        // rather than the SHOW_ELSE marker.
        let mut opcodes = encode_show_if(0, &encode_text(1), &encode_text(1));
        patch_u32(&mut opcodes, 3, 4); // then body is 5 bytes; claim 4
        let data = build_minimal_ir(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
        assert!(matches!(
            IrModule::parse(&data),
            Err(IrError::MalformedControlFlow { .. })
        ));
    }

    #[test]
    fn parse_rejects_list_body_len_past_the_stream() {
        // LIST: opcode(1) slot_id(2) item_slot_id(2) body_len(4)
        let mut opcodes = encode_list(0, 1, &encode_text(2));
        patch_u32(&mut opcodes, 5, 0xFFFF_FF00);
        let data = build_minimal_ir(
            &["items", "item", "x"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        assert!(matches!(
            IrModule::parse(&data),
            Err(IrError::MalformedControlFlow { .. })
        ));
    }

    #[test]
    fn parse_rejects_switch_case_body_len_past_the_stream() {
        // The over-long length is in case 0, which does NOT match the slot
        // value at render time — a non-matching case must be validated too.
        let mut opcodes = encode_switch(0, &[(1, &encode_text(2)), (3, &encode_text(2))]);
        // header 0 body_len is at opcode(1)+slot(2)+count(2)+val_idx(4) = 9
        patch_u32(&mut opcodes, 9, 0xFFFF_FF00);
        let data = build_minimal_ir(
            &["mode", "a", "x", "b"],
            &[(0, 0, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        assert!(matches!(
            IrModule::parse(&data),
            Err(IrError::MalformedControlFlow { .. })
        ));
    }

    #[test]
    fn parse_rejects_fallback_skip_past_the_stream() {
        // TRY_START: opcode(1) fallback_len(4)
        let mut opcodes = encode_try(&encode_text(0), &encode_text(0));
        patch_u32(&mut opcodes, 1, 0xFFFF_FF00);
        let data = build_minimal_ir(&["hi"], &[], &opcodes, &[]);
        assert!(matches!(
            IrModule::parse(&data),
            Err(IrError::MalformedControlFlow { .. })
        ));
    }

    #[test]
    fn parse_accepts_zero_length_else_branch_known_residual() {
        // DOCUMENTED RESIDUAL: an under-long length whose orphaned bytes still
        // decode as a legal sibling sequence is structurally indistinguishable
        // from a legitimate module. No length check can reject it; only module
        // integrity (a populated source_hash) would. This test exists so the
        // case is not later mistaken for a fixed hole.
        let opcodes = encode_show_if(0, &encode_text(1), &[]);
        let data = build_minimal_ir(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
        assert!(IrModule::parse(&data).is_ok());
    }

    // -- TRY/FALLBACK scoping (F-10) ----------------------------------------

    #[test]
    fn walk_stray_fallback_in_a_nested_range_is_rejected_at_load() {
        // Layout: TRY_START [ SHOW_IF(then = FALLBACK) TEXT("main") ] FALLBACK TEXT("fb")
        //
        // The FALLBACK inside the then-branch belongs to no TRY_START in its
        // own range. The walker's `fallback_stack` is range-local so it cannot
        // pop the outer entry and skip the wrong region — but it would still
        // fall through and walk the fallback body as if it were main content,
        // which is a silently wrong page. Validation rejects the module first.
        let then_ops = vec![0x0E]; // stray FALLBACK inside the then-branch
        let mut main_ops = encode_show_if(0, &then_ops, &[]);
        main_ops.extend_from_slice(&encode_text(1));
        let opcodes = encode_try(&main_ops, &encode_text(2));

        let data = build_minimal_ir(
            &["flag", "main", "fb"],
            &[(0, 0, 0x02, 0x00, &[])],
            &opcodes,
            &[],
        );
        assert!(matches!(
            IrModule::parse(&data).unwrap_err(),
            IrError::MalformedControlFlow { .. }
        ));
    }

    #[test]
    fn walk_try_without_a_fallback_is_rejected_at_load() {
        // A TRY_START whose FALLBACK never arrives ships a page with no
        // fallback and no diagnostic.
        let mut opcodes = vec![0x0D]; // TRY_START
        opcodes.extend_from_slice(&4u32.to_le_bytes()); // fallback_len
        opcodes.extend_from_slice(&encode_text(0));

        let data = build_minimal_ir(&["main"], &[], &opcodes, &[]);
        assert!(matches!(
            IrModule::parse(&data).unwrap_err(),
            IrError::MalformedControlFlow { .. }
        ));
    }

    // -- Pending island / list-key scoping (F-11) ---------------------------

    #[test]
    fn walk_island_attrs_survive_an_empty_show_if_before_the_root() {
        // ISLAND_START, SHOW_IF (both branches empty), then the root element.
        // Clearing pending state at the end of every walk_range would wipe the
        // island attributes here and the island would never hydrate — the
        // reason the clear lives on ISLAND_END instead.
        let mut opcodes = encode_island_start(0);
        opcodes.extend_from_slice(&encode_show_if(0, &[], &[]));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let slots = SlotData::new(1);
        let html = walk_with_islands(
            &["Comp", "div", "flag"],
            &[(0, 2, 0x02, 0x00, &[])],
            &[(0, 0x01, 0x01, 0, 0, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            html.contains("<div data-forma-island=\"0\""),
            "island root must keep its attributes, got: {html}"
        );
    }

    #[test]
    fn walk_list_key_survives_an_empty_show_if_before_the_item_element() {
        let mut body = encode_list_item_key(3);
        body.extend_from_slice(&encode_show_if(1, &[], &[]));
        body.extend_from_slice(&encode_open_tag(2, &[]));
        body.extend_from_slice(&encode_close_tag(2));
        let opcodes = encode_list(0, 1, &body);

        let mut slots = SlotData::new(2);
        slots.set(
            0,
            SlotValue::array(vec![
                SlotValue::Text("a".into()),
                SlotValue::Text("b".into()),
            ]),
        );

        let html = walk_with_slots(
            &["items", "item", "li", "k"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert_eq!(
            html.matches("data-forma-key=\"k\"").count(),
            2,
            "every item element must keep its key, got: {html}"
        );
    }

    #[test]
    fn walk_island_attrs_do_not_leak_past_the_island_end() {
        // ISLAND_START with no element inside, then an element AFTER the
        // island's closing marker. The island's identity attributes must not
        // land on it.
        let mut opcodes = encode_island_start(0);
        opcodes.extend_from_slice(&encode_island_end(0));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));

        let slots = SlotData::new(0);
        let html = walk_with_islands(
            &["Comp", "div"],
            &[],
            &[(0, 0x01, 0x01, 0, 0, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            !html.contains("data-forma-island"),
            "island attributes must not leak onto an element outside the island, got: {html}"
        );
    }

    #[test]
    fn walk_list_key_does_not_leak_past_the_list() {
        let body = encode_list_item_key(2); // key, but no element to carry it
        let mut opcodes = encode_list(0, 1, &body);
        opcodes.extend_from_slice(&encode_open_tag(3, &[]));
        opcodes.extend_from_slice(&encode_close_tag(3));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::array(vec![SlotValue::Text("a".into())]));

        let html = walk_with_slots(
            &["items", "item", "k", "div"],
            &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x00, &[])],
            &opcodes,
            &slots,
        );
        assert!(
            !html.contains("data-forma-key"),
            "list key must not leak onto an element after the list, got: {html}"
        );
    }

    // -- Name validation (S13) ----------------------------------------------

    #[test]
    fn walk_rejects_hostile_tag_name() {
        // Tag names are written unescaped, so an IR-authored name is direct
        // markup injection.
        let opcodes = encode_open_tag(0, &[]);
        let data = build_minimal_ir(&["div onload=\"alert(1)\""], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        assert!(matches!(
            walk_to_html(&module, &slots),
            Err(IrError::InvalidName(_))
        ));
    }

    #[test]
    fn walk_rejects_hostile_close_tag_name() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_close_tag(1));
        let data = build_minimal_ir(&["div", "div><script"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        assert!(matches!(
            walk_to_html(&module, &slots),
            Err(IrError::InvalidName(_))
        ));
    }

    #[test]
    fn walk_drops_hostile_attribute_names() {
        // Attribute names are skippable, so one bad key costs the attribute
        // rather than the whole page.
        let opcodes = encode_open_tag(0, &[(1, 2), (3, 2)]);
        let data = build_minimal_ir(&["div", "x\"><script", "v", "ok-attr"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(html, "<div ok-attr=\"v\">");
    }

    #[test]
    fn walk_drops_hostile_boolean_attribute_name() {
        // Same, via the boolean (empty-value) branch.
        let opcodes = encode_open_tag(0, &[(1, 2)]);
        let data = build_minimal_ir(&["div", "y\"><script", ""], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        assert_eq!(walk_to_html(&module, &slots).unwrap(), "<div>");
    }

    #[test]
    fn walk_drops_hostile_dyn_attr_name() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_minimal_ir(
            &["div", "z\"><script", "val"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("x".into()));
        assert_eq!(walk_to_html(&module, &slots).unwrap(), "<div>");
    }

    // -- URL / event-handler attribute safety (S14) -------------------------

    #[test]
    fn walk_drops_javascript_url_in_dyn_attr() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_minimal_ir(
            &["a", "href", "url"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        // Also covers the normalization step: browsers strip control chars
        // before resolving the scheme, so `java\tscript:` executes.
        for payload in [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "java\tscript:alert(1)",
            "  javascript:alert(1)",
            "vbscript:msgbox(1)",
            "data:text/html,<script>alert(1)</script>",
        ] {
            let mut slots = SlotData::new(1);
            slots.set(0, SlotValue::Text(payload.to_string()));
            let html = walk_to_html(&module, &slots).unwrap();
            // Dropped entirely, not emitted empty: href="" resolves to the
            // current page and would not match the client DOM either.
            assert_eq!(html, "<a>", "payload {payload:?} was not dropped");
        }
    }

    #[test]
    fn walk_keeps_safe_urls_and_data_images() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_minimal_ir(
            &["img", "src", "url"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        for payload in [
            "/about",
            "https://example.com/x?a=1",
            "data:image/png;base64,AAAA",
            // svg+xml is allowed here because <img> is an image context — the
            // stock CSP permits img-src data:, so a blanket data: block would
            // break legitimate inline images.
            "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
        ] {
            let mut slots = SlotData::new(1);
            slots.set(0, SlotValue::Text(payload.to_string()));
            let html = walk_to_html(&module, &slots).unwrap();
            assert!(html.contains("src="), "payload {payload:?} was dropped");
        }
    }

    #[test]
    fn walk_blocks_svg_data_url_outside_image_context() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_minimal_ir(
            &["a", "href", "url"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(
            0,
            SlotValue::Text("data:image/svg+xml,%3Csvg onload=alert(1)%3E".into()),
        );
        // Through a document sink the SVG is parsed as a document and its
        // onload fires, so it is blocked here even though <img> allows it.
        assert_eq!(walk_to_html(&module, &slots).unwrap(), "<a>");
    }

    #[test]
    fn walk_drops_event_handler_attributes() {
        // Static attribute path...
        let opcodes = encode_open_tag(0, &[(1, 2)]);
        let data = build_minimal_ir(&["div", "onmouseover", "alert(1)"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        assert_eq!(
            walk_to_html(&module, &SlotData::new(0)).unwrap(),
            "<div>",
            "static on* attribute must be dropped"
        );

        // ...and the dynamic one.
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_minimal_ir(
            &["div", "ONCLICK", "h"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text("alert(1)".into()));
        assert_eq!(walk_to_html(&module, &slots).unwrap(), "<div>");
    }

    #[test]
    fn walk_drops_javascript_url_in_static_attr() {
        // Static values come from the string table (template-author level),
        // but renderAttr applies identical rules to static props — leaving
        // them unchecked would preserve an SSR/CSR divergence.
        let opcodes = encode_open_tag(0, &[(1, 2)]);
        let data = build_minimal_ir(&["a", "href", "javascript:alert(1)"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        assert_eq!(walk_to_html(&module, &SlotData::new(0)).unwrap(), "<a>");
    }

    #[test]
    fn walk_comment_cannot_self_close() {
        // A leading ">" or "->" closes an HTML comment immediately per the
        // tokenizer, spilling the rest into the document as markup.
        for text in ["><img src=x onerror=alert(1)>", "-><img src=x>"] {
            let opcodes = encode_comment(0);
            let data = build_minimal_ir(&[text], &[], &opcodes, &[]);
            let module = IrModule::parse(&data).unwrap();
            let html = walk_to_html(&module, &SlotData::new(0)).unwrap();
            assert!(
                html.starts_with("<!-- "),
                "comment must not start with a closing sequence, got: {html}"
            );
        }
    }

    // -- Number rendering parity (F-05) -------------------------------------

    #[test]
    fn walk_switch_matches_on_js_number_text() {
        // to_text also drives SWITCH case comparison, and the case strings are
        // authored on the JS side — so branch selection follows JS semantics.
        let opcodes = encode_switch(0, &[(1, &encode_text(2)), (3, &encode_text(4))]);
        let data = build_minimal_ir(
            &["n", "1e+21", "big", "1000", "small"],
            &[(0, 0, 0x03, 0x00, &[])],
            &opcodes,
            &[],
        );
        let module = IrModule::parse(&data).unwrap();

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Number(1e21));
        assert!(walk_to_html(&module, &slots).unwrap().contains("big"));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Number(1000.0));
        assert!(walk_to_html(&module, &slots).unwrap().contains("small"));
    }
}
