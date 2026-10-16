//! Static HTML walker — walks the IR opcode stream to produce HTML output.
//!
//! This is the core SSR rendering engine. It takes a parsed `IrModule` plus
//! populated `SlotData`, walks the opcode stream linearly, and produces an
//! HTML string suitable for embedding in the page.

pub use crate::contracts::state::IslandState;
use crate::contracts::state::StateBuilder;
#[cfg(feature = "tracing")]
use crate::format::SlotSource;
use crate::format::{IrError, IslandTrigger, ListKeyReason, ListKeyViolation, Opcode};
use crate::parser::IrModule;
use crate::slot::{SlotData, SlotValue};
use crate::text::{normalize_text, normalized_chars};
use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;

// ---------------------------------------------------------------------------
// Walk state
// ---------------------------------------------------------------------------

/// Pending island info to be injected on the next OPEN_TAG or VOID_TAG.
struct IslandPending {
    id: u16,
    component_name: String,
    occurrence: usize,
    hash: String,
    trigger: IslandTrigger,
}

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

/// One row of a keyed LIST while its body is walked (FORMA-181, DR-8).
///
/// The row-owned guard for `data-forma-key`: the key is attached to the
/// first element opened at the depth the row was entered at, which is the
/// row's own root, never a descendant and never an element a later row or
/// the code after the list opens. At its own level the row admits exactly
/// that one root, optionally wholly enclosed by one registered child's
/// `<!--f:iN-->` envelope (the child's host is the root); text, a
/// conditional or list range, a second element, an envelope that does not
/// enclose the root, a close of an element the row did not open, or an
/// element left open refuse the render. The compiler proves the shape from
/// the source (BUILD-613), so this is the defence for a hand-built module,
/// under the same code the key itself refuses with (RENDER-503).
struct KeyedRow {
    /// Byte offset of the LIST, as section `0x0006` names it.
    list_offset: u32,
    /// Zero-based position of the row in the array this execution iterates.
    ordinal: usize,
    /// The key path, dotted, for the row's diagnostics.
    path: Rc<str>,
    /// The canonical key, until the row's root element takes it.
    key: Option<Rc<str>>,
    /// [`WalkState::element_depth`] when the row's body started.
    entry_depth: usize,
    /// Elements opened at `entry_depth` so far.
    roots: usize,
    /// Whether anything but the root and its envelope was written at
    /// `entry_depth`.
    stray_content: bool,
    /// The registered child whose island envelope opened at `entry_depth`
    /// before the root and has not closed yet.
    envelope: Option<u16>,
}

impl KeyedRow {
    fn refuse(&self, reason: ListKeyReason) -> IrError {
        list_key_error(self.list_offset, self.ordinal, &self.path, reason)
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
    /// Elements opened (`OPEN_TAG`) and not yet closed (`CLOSE_TAG`) at this
    /// point of the walk. A keyed row's root is the element opened at the
    /// depth the row was entered at ([`KeyedRow::entry_depth`]).
    element_depth: usize,
    /// The keyed rows the walk is inside, outermost first (FORMA-181). Only
    /// the innermost can still be waiting for its root: an inner row is
    /// entered at a deeper element depth than the root its outer row already
    /// opened. Pushed and popped by the LIST item loop, never cleared at a
    /// range end.
    keyed_rows: Vec<KeyedRow>,
    /// Whether the start tag still open is a keyed row's root, so a DYN_ATTR
    /// named `data-forma-key` on it is refused as an authored identity.
    open_tag_is_row_root: bool,
    /// Checked, owned snapshots in execution order, separate from body HTML.
    island_state: StateBuilder,
    /// True when an OpenTag or VoidTag has been opened but the `>` has not
    /// been written yet. DYN_ATTR opcodes may still append attributes.
    pending_tag_close: bool,
    /// Tag name of the element currently being opened — needed to decide
    /// whether a `data:image/svg+xml` URL is in an image context.
    pending_tag_name: String,
    /// The output length right after an HTML `pre` or `listing` start tag
    /// closed, while nothing has been written since. The parser drops one
    /// line feed that is the first content token of those elements, so the
    /// first text written at exactly this length gets an extra LF when its
    /// normalized text starts with one. Any serialized token (a marker
    /// comment, a child element, a closing tag) moves the length past it and
    /// so consumes the boundary; an empty text or a value-only opcode writes
    /// nothing and leaves it. Selected by tag spelling, as `TextOnlyTag` is:
    /// the walker has no namespace stack, and neither SVG nor MathML has an
    /// element of either name.
    ///
    /// Verified by: crates/forma-ir/src/walker.rs > "pre_children_protect_only_an_initial_normalized_line_feed"
    pre_boundary: Option<usize>,
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
    /// The text-only element (`textarea`, `title`, `style`, `script`) the
    /// walk is inside, if any. Inside one, no hydration marker is written; see
    /// [`TextOnlyTag`].
    text_only: Option<TextOnlyParent>,
    /// Form-control state gathered from the attributes of the start tag that
    /// is still open, resolved when its `>` is written ([`close_start_tag`]).
    pending_control: PendingControl,
    /// The bound `select` the walk is inside, if any.
    select: Option<SelectBinding>,
    /// An `option` of a bound select with no `value` attribute: its value is
    /// its text, which is known only when the option ends.
    option_by_text: Option<OptionByText>,
    /// Elements and text nodes written so far ([`WalkCounts::nodes`]).
    nodes: usize,
    /// The islands open at this point of the walk, outermost first: the
    /// component path a failure reports ([`WalkFailure::component_path`]).
    islands: Vec<u16>,
    /// Whether `fault_injection::FAULT_TRIGGER` may fire: set only by
    /// [`walk_to_html_counted`], which catches the panic, so the uncaught
    /// `walk_to_html` path can never take it.
    #[cfg(any(test, feature = "__fault-injection"))]
    fault_armed: bool,
}

impl WalkState {
    fn new(limits: WalkLimits) -> Self {
        WalkState {
            list_depth: 0,
            pending_island: None,
            element_depth: 0,
            keyed_rows: Vec::new(),
            open_tag_is_row_root: false,
            island_state: StateBuilder::new(),
            pending_tag_close: false,
            pending_tag_name: String::new(),
            pre_boundary: None,
            max_output_bytes: limits.max_output_bytes,
            list_iterations: 0,
            max_list_iterations: limits.max_list_iterations,
            slot_journal: Vec::new(),
            text_only: None,
            pending_control: PendingControl::None,
            select: None,
            option_by_text: None,
            nodes: 0,
            islands: Vec::new(),
            #[cfg(any(test, feature = "__fault-injection"))]
            fault_armed: false,
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

    /// The innermost keyed row, when the walk is at the depth it was
    /// entered at: the level where its root element and nothing else belongs.
    fn keyed_row_at_entry_depth(&mut self) -> Option<&mut KeyedRow> {
        let depth = self.element_depth;
        self.keyed_rows
            .last_mut()
            .filter(|row| row.entry_depth == depth)
    }

    /// An element is being opened: if it is the innermost keyed row's root,
    /// count it and hand back the key it carries.
    fn open_row_root(&mut self) -> Option<Rc<str>> {
        let row = self.keyed_row_at_entry_depth()?;
        row.roots += 1;
        row.key.take()
    }

    /// Text or a marker is being written: at a keyed row's own level that is
    /// content beside its root, which the row's shape does not admit.
    fn note_row_level_content(&mut self) {
        if let Some(row) = self.keyed_row_at_entry_depth() {
            row.stray_content = true;
        }
    }

    /// An island starts: at a keyed row's own level it is admitted only as
    /// the envelope of a registered child whose host is the row's root, so
    /// only before that root and only once.
    fn note_row_level_island_start(&mut self, island_id: u16) {
        if let Some(row) = self.keyed_row_at_entry_depth() {
            if row.roots == 0 && row.envelope.is_none() && !row.stray_content {
                row.envelope = Some(island_id);
            } else {
                row.stray_content = true;
            }
        }
    }

    /// An island ends: at a keyed row's own level it must close the envelope
    /// that opened before the root, right after that one root.
    fn note_row_level_island_end(&mut self, island_id: u16) {
        if let Some(row) = self.keyed_row_at_entry_depth() {
            if row.envelope == Some(island_id) && row.roots == 1 {
                row.envelope = None;
            } else {
                row.stray_content = true;
            }
        }
    }

    /// A CLOSE_TAG at a keyed row's own level closes an element the row did
    /// not open (the list's parent): the row is not balanced.
    fn closes_outside_keyed_row(&self) -> bool {
        self.keyed_rows
            .last()
            .is_some_and(|row| row.entry_depth == self.element_depth)
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
    let mut out = String::with_capacity(initial_capacity(len));
    let mut state = WalkState::new(limits);
    let mut slots_mut = slots.clone();
    slots_mut.apply_module_constants(module);
    walk_range(module, &mut slots_mut, ops, 0, len, &mut out, &mut state, 0)?;
    Ok(out)
}

/// The output buffer's first reservation for a module's opcode stream.
///
/// Capped: `len * 4` is a fine estimate for a real page (measured modules are
/// tens of bytes to low KiB) but a 4x reservation on an attacker-sized section
/// is a free amplifier, and `len * 4` can itself overflow on wasm32 where
/// `usize` is 32 bits. Beyond the cap, String's amortized doubling costs
/// O(log n) reallocs.
fn initial_capacity(opcodes_len: usize) -> usize {
    opcodes_len.saturating_mul(4).min(1 << 20)
}

/// What a walk wrote, or what it had reached when it stopped.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct WalkCounts {
    /// Elements and text nodes written from the module's opcodes. Hydration
    /// markers and comments are not nodes. State is counted by the server.
    pub nodes: usize,
    /// Bytes of HTML written: what [`WalkLimits::max_output_bytes`] bounds.
    pub bytes: usize,
    /// LIST rows walked, across every nesting depth: what
    /// [`WalkLimits::max_list_iterations`] bounds.
    pub list_iterations: usize,
}

/// A whole page's HTML and what writing it took.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct WalkOutput {
    /// The page's HTML, as [`walk_to_html_with_limits`] writes it.
    pub html: String,
    /// Declared inputs captured at each executed ISLAND_START. The server
    /// places this envelope once in the head before sending body HTML.
    pub island_state: IslandState,
    /// What the walk wrote.
    pub counts: WalkCounts,
}

/// A walk that stopped: why, where, and how far it had got.
///
/// The partial HTML is dropped: nothing a failed walk wrote leaves it.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct WalkFailure {
    /// Why it stopped.
    pub error: IrError,
    /// The component names of the islands open where it stopped, outermost
    /// first; empty when it stopped outside every island. The decoded v3
    /// source-position metadata is available for later diagnostic integration;
    /// this path continues to name declared islands.
    pub component_path: Vec<String>,
    /// What it had written by then.
    pub counts: WalkCounts,
}

impl fmt::Display for WalkFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.error)?;
        if !self.component_path.is_empty() {
            write!(f, " (in {})", self.component_path.join(" > "))?;
        }
        Ok(())
    }
}

impl std::error::Error for WalkFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

/// [`walk_to_html_with_limits`], reporting what the walk wrote, and on
/// failure where it stopped and how far it had got.
///
/// The same HTML, byte for byte, and the same errors, with two additions: the
/// counts (nodes, bytes, list rows), returned on success and on failure alike
/// so an over-budget page reports how far it got; and the component
/// path, the islands open at the failure. A panic inside the walk is caught
/// and returned as [`IrError::Panicked`] with the same path and counts, so
/// one bad page cannot take its request's connection down with it.
/// That holds only while the application unwinds on panic: under
/// `panic = "abort"` the process ends instead.
///
/// Verified by: crates/forma-ir/src/walker.rs > "counted_walk_returns_the_counts_reached_when_a_budget_stops_it"
/// Verified by: crates/forma-ir/src/walker.rs > "counted_walk_catches_a_panic_and_names_its_island"
pub fn walk_to_html_counted(
    module: &IrModule,
    slots: &SlotData,
    limits: WalkLimits,
) -> Result<WalkOutput, WalkFailure> {
    let ops = &module.opcodes;
    let len = ops.len();
    let mut out = String::with_capacity(initial_capacity(len));
    let mut state = WalkState::new(limits);
    #[cfg(any(test, feature = "__fault-injection"))]
    {
        state.fault_armed = true;
    }
    let mut slots_mut = slots.clone();
    slots_mut.apply_module_constants(module);

    // The closure only borrows: after an unwind, `state` and `out` still say
    // where the walk was and how much it had written. Nothing they hold is
    // used again except to read those counts.
    let walked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        walk_range(module, &mut slots_mut, ops, 0, len, &mut out, &mut state, 0)
    }));
    let counts = WalkCounts {
        nodes: state.nodes,
        bytes: out.len(),
        list_iterations: state.list_iterations,
    };
    let error = match walked {
        Ok(Ok(())) => match state.island_state.finish() {
            Ok(island_state) => {
                return Ok(WalkOutput {
                    html: out,
                    island_state,
                    counts,
                })
            }
            Err(error) => {
                return Err(WalkFailure {
                    error,
                    component_path: Vec::new(),
                    counts,
                })
            }
        },
        Ok(Err(error)) => error,
        Err(payload) => IrError::Panicked {
            message: panic_message(payload.as_ref()),
        },
    };
    let component_path = state
        .islands
        .iter()
        .map(|&id| {
            module
                .island_entry(id)
                .and_then(|entry| module.strings.get(entry.name_str_idx).ok())
                .map_or_else(|| format!("island {id}"), str::to_string)
        })
        .collect();
    Err(WalkFailure {
        error,
        component_path,
        counts,
    })
}

/// A panic payload's message: `panic!` with a literal gives a `&str`, with
/// formatting a `String`.
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "a panic with no message".to_string()
    }
}

/// Walk a single island's content and produce an HTML string.
///
/// This internal fragment path has no supported caller (DR-10). It finds
/// the island by `island_id` in the module's island table, seeks to its
/// `byte_offset` in the opcode stream, and walks from after the ISLAND_START
/// opcode until the matching ISLAND_END opcode.
///
/// Returns the island ROOT element carrying the full `data-forma-*` attribute
/// set (`data-forma-island`, `-component`, `-status`, `-hydrate`, and
/// the occurrence/hash markers). Internal diagnostics may inspect this root with
/// `replaceWith`/`outerHTML` and MUST NOT use `innerHTML` — that would discard
/// exactly the attributes the runtime selects on.
///
/// The `<!--f:iN-->` / `<!--/f:iN-->` marker comments are deliberately NOT
/// emitted: they live outside the root element and survive an `outerHTML`
/// swap, so re-emitting them would duplicate them.
///
/// This internal diagnostic fragment returns body HTML only; it is not a
/// supported page-response path. The complete counted walk returns the state
/// envelope required to activate its occurrence markers.
#[allow(dead_code)] // Internal fragment path; no supported caller since the WASM walker retired.
pub(crate) fn walk_island(
    module: &IrModule,
    slots: &SlotData,
    island_id: u16,
) -> Result<String, IrError> {
    walk_island_with_limits(module, slots, island_id, WalkLimits::default())
}

/// [`walk_island`] with explicit resource budgets.
#[allow(dead_code)]
pub(crate) fn walk_island_with_limits(
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
    let mut slots_mut = slots.clone();
    slots_mut.apply_module_constants(module);

    let component_name = module.strings.get(entry.name_str_idx)?.to_string();
    let (occurrence, hash) = state.island_state.snapshot(module, entry, &slots_mut)?;
    state.pending_island = Some(IslandPending {
        id: island_id,
        component_name,
        occurrence,
        hash,
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
const MAX_LIST_DEPTH: u8 = crate::format::MAX_LIST_DEPTH as u8;

/// Maximum recursion depth for control-flow opcodes (SHOW_IF, SWITCH, LIST,
/// TRY/FALLBACK). Prevents stack overflow from deeply nested or malicious IR.
const MAX_RECURSION_DEPTH: usize = crate::format::MAX_CONTROL_DEPTH;

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
            close_start_tag(out, state, limit)?;
        }

        match opcode {
            // ----- Fully implemented opcodes -----
            Opcode::OpenTag | Opcode::VoidTag => {
                let (tag_str_idx, attrs, new_pos) = read_tag_with_attrs(ops, pos, strings)?;
                let tag = strings.get(tag_str_idx)?;
                let has_content = opcode == Opcode::OpenTag;
                emit_open_tag(out, tag, &attrs, has_content, state, limit)?;
                state.nodes += 1;
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
                // A keyed row closes only elements it opened (FORMA-181): a
                // CLOSE_TAG at its own level would end the list's parent from
                // inside one row.
                if state.closes_outside_keyed_row() {
                    return Err(innermost_row_error(
                        state,
                        ListKeyReason::UnbalancedRow,
                        IrError::InvalidSection,
                    ));
                }
                leave_element(out, tag, state, limit)?;
                // Saturating: a CLOSE_TAG without its OPEN_TAG outside any
                // keyed row is tolerated as before.
                state.element_depth = state.element_depth.saturating_sub(1);
                push_checked(out, "</", limit)?;
                push_checked(out, tag, limit)?;
                push_checked(out, ">", limit)?;
            }

            Opcode::Text => {
                let str_idx = read_u32(ops, pos)?;
                pos += 4;
                let text = strings.get(str_idx)?;
                state.note_row_level_content();
                if let Some(parent) = state.text_only.as_mut() {
                    if !parent.value_bound {
                        write_text_only(out, parent, text, limit)?;
                    }
                } else {
                    if state.pre_boundary == Some(out.len())
                        && normalized_chars(text).next() == Some('\n')
                    {
                        // First content token of a `pre`/`listing` starting
                        // with a line feed: the parser drops one, so write one
                        // more (the textarea rule, by output position).
                        push_checked(out, "\n", limit)?;
                    }
                    push_escaped_html(out, text, limit)?;
                    if let Some(option) = state.option_by_text.as_mut() {
                        // The text as the parser reads it: normalized.
                        option.text.extend(normalized_chars(text));
                    }
                }
                state.nodes += 1;
            }

            Opcode::DynText => {
                // slot_id(u16) + marker_id(u16)
                let slot_id = read_u16(ops, pos)?;
                pos += 2;
                let marker_id = read_u16(ops, pos)?;
                pos += 2;

                check_slot_source(module, slot_id, slots.get(slot_id));
                state.note_row_level_content();
                let value = slots.get(slot_id).to_text();

                // SR44's stand-in for a component that panics: this crate's
                // tests and the internal `__fault-injection` feature only, and
                // armed only inside `walk_to_html_counted`, which catches it.
                #[cfg(any(test, feature = "__fault-injection"))]
                #[allow(clippy::panic)]
                if state.fault_armed && value == crate::fault_injection::FAULT_TRIGGER {
                    panic!("stand-in component panicked (FAULT_TRIGGER)");
                }

                if let Some(parent) = state.text_only.as_mut() {
                    // Inside a text-only element a marker comment is literal
                    // text, so the value is written on its own (TextOnlyTag).
                    if !parent.value_bound {
                        write_text_only(out, parent, &value, limit)?;
                    }
                } else {
                    push_checked(out, "<!--f:t", limit)?;
                    push_u16(out, marker_id, limit)?;
                    push_checked(out, "-->", limit)?;
                    // Always emit at least a zero-width space so the browser
                    // creates a Text node between the markers. Without this,
                    // <!--f:t0--><!--/f:t0--> produces no Text node in the DOM
                    // and the hydration walker has nothing to bind the
                    // reactive effect to.
                    let written = if value.is_empty() {
                        "\u{200B}"
                    } else {
                        value.as_str()
                    };
                    push_escaped_html(out, written, limit)?;
                    push_checked(out, "<!--/f:t", limit)?;
                    push_u16(out, marker_id, limit)?;
                    push_checked(out, "-->", limit)?;
                    if let Some(option) = state.option_by_text.as_mut() {
                        option.text.extend(normalized_chars(written));
                    }
                }
                state.nodes += 1;
            }

            Opcode::DynAttr => {
                // attr_str_idx(u32) + slot_id(u16) = 6 bytes
                let attr_str_idx = read_u32(ops, pos)?;
                let slot_id = read_u16(ops, pos + 4)?;
                pos += 6;
                check_slot_source(module, slot_id, slots.get(slot_id));

                if state.pending_tag_close {
                    let attr_name = strings.get(attr_str_idx)?;
                    if state.open_tag_is_row_root
                        && attr_name.eq_ignore_ascii_case("data-forma-key")
                    {
                        return Err(innermost_row_error(
                            state,
                            ListKeyReason::AuthoredKey,
                            IrError::InvalidName(attr_name.to_string()),
                        ));
                    }
                    // `value` on a textarea or select, and `selected` on an
                    // option of a bound select, are written another way.
                    if consume_control_attr(state, attr_name, Prop::Slot(slots.get(slot_id))) {
                        continue;
                    }
                    // `text` outlives the borrow only for the Valued case; it
                    // is declared here so the &str can point into it.
                    let text;
                    let value = match slots.get(slot_id) {
                        // An HTML boolean attribute is ON whenever it is
                        // present, so the old `disabled="false"` meant
                        // DISABLED: scalar truthiness selects presence. Any
                        // other attribute takes the word `h()` writes for
                        // true, `data-live="true"` (FORMA-182 finding F2,
                        // docs/parity-rules.md rule 6's attribute table).
                        SlotValue::Bool(false) | SlotValue::Null => None,
                        other if is_html_boolean_attribute(attr_name) => {
                            other.as_bool().then_some(AttrValue::Bare)
                        }
                        SlotValue::Bool(true) => Some(AttrValue::Valued("true")),
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
                state.islands.push(island_id);
                // A registered child's envelope may wrap a keyed row's root
                // (its host); anything else at the row's level is refused.
                state.note_row_level_island_start(island_id);

                // No marker inside a text-only element, where it is text.
                if state.text_only.is_none() {
                    push_checked(out, "<!--f:i", limit)?;
                    push_u16(out, island_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }

                // Look up island entry from the island table (O(1) index).
                // `IrModule::validate` rejects an ISLAND_START naming an
                // island the table does not declare, so the `else` below is
                // reachable only for a module that skipped validation.
                // Verified by: crates/forma-ir/src/parser.rs > "validate_rejects_island_start_missing_from_table"
                if let Some(entry) = module.island_entry(island_id) {
                    let component_name = strings.get(entry.name_str_idx)?.to_string();

                    // Capture ordered declared inputs before the island body or
                    // its surrounding list can mutate scratch/row slots.
                    let (occurrence, hash) = state.island_state.snapshot(module, entry, slots)?;

                    state.pending_island = Some(IslandPending {
                        id: island_id,
                        component_name,
                        occurrence,
                        hash,
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
                if state.islands.last() == Some(&island_id) {
                    state.islands.pop();
                }
                state.note_row_level_island_end(island_id);

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
                            close_start_tag(out, state, limit)?;
                        }
                        return Ok(());
                    }
                }

                // Either Range mode, or a nested (non-matching) island end —
                // emit the closing marker comment and continue (no marker
                // inside a text-only element, where it is text).
                if state.text_only.is_none() {
                    push_checked(out, "<!--/f:i", limit)?;
                    push_u16(out, island_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }
            }

            Opcode::ShowIf => {
                // slot_id(2) + then_len(4) + else_len(4) = 10 bytes header
                let slot_id = read_u16(ops, pos)?;
                let then_len = read_u32(ops, pos + 2)? as usize;
                let else_len = read_u32(ops, pos + 6)? as usize;
                pos += 10;
                // A conditional at a keyed row's own level is a range, not
                // the one stable root the key needs (BUILD-613 from source).
                state.note_row_level_content();

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

                // Emit conditional marker — none inside a text-only element,
                // where it is text. Decided once, so the pair always matches.
                let markers = state.text_only.is_none();
                if markers {
                    push_checked(out, "<!--f:s", limit)?;
                    push_u16(out, slot_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }

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

                if markers {
                    push_checked(out, "<!--/f:s", limit)?;
                    push_u16(out, slot_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }

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
            Opcode::List => {
                // `pos` already passed the opcode byte: the LIST's own offset,
                // the one section 0x0006 names, is one before it.
                let list_offset = (pos - 1) as u32;
                // slot_id(2) + item_slot_id(2) + body_len(4) = 8 bytes header
                let slot_id = read_u16(ops, pos)?;
                let item_slot_id = read_u16(ops, pos + 2)?;
                let body_len = read_u32(ops, pos + 4)? as usize;
                pos += 8;

                check_slot_source(module, slot_id, slots.get(slot_id));
                // A list at a keyed row's own level is a range beside the
                // row's root, not the root (BUILD-613 from source).
                state.note_row_level_content();

                let body_start = pos;
                let body_end = bounded_offset(pos, body_len, region_limit)?;

                // The key path section 0x0006 attaches to this LIST, if any,
                // resolved once per LIST execution, not per row: the entries
                // are sorted by offset (the parser refuses anything else), so
                // this is one binary search, and every segment index was
                // checked against the string table at load. A LIST without an
                // entry is unkeyed and renders exactly as before.
                let key_path = match module
                    .key_paths
                    .binary_search_by_key(&list_offset, |path| path.list_offset)
                {
                    Ok(index) => Some(ListKey::resolve(
                        list_offset,
                        &module.key_paths[index].segments,
                        strings,
                    )?),
                    Err(_) => None,
                };

                // Emit list markers — none inside a text-only element, where
                // they are text. Decided once, so the pair always matches.
                let list_marker_id = slot_id;
                let markers = state.text_only.is_none();
                if markers {
                    push_checked(out, "<!--f:l", limit)?;
                    push_u16(out, list_marker_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }

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
                    let walked = if state.list_depth > MAX_LIST_DEPTH {
                        Err(IrError::ListDepthExceeded {
                            max: MAX_LIST_DEPTH,
                        })
                    } else {
                        walk_list_rows(
                            module,
                            slots,
                            ops,
                            ListRows {
                                items: &items,
                                item_slot_id,
                                body_start,
                                body_end,
                                key: key_path.as_ref(),
                            },
                            out,
                            state,
                            depth,
                        )
                    };
                    // Restored on every path, as the slot journal and the
                    // keyed-row stack are inside `walk_list_rows`: an error
                    // leaves the walk state as the LIST found it.
                    state.list_depth -= 1;
                    walked?;
                }

                if markers {
                    push_checked(out, "<!--/f:l", limit)?;
                    push_u16(out, list_marker_id, limit)?;
                    push_checked(out, "-->", limit)?;
                }

                pos = body_end;
            }

            Opcode::Coalesce => {
                let source = read_u16(ops, pos)?;
                let fallback = read_u16(ops, pos + 2)?;
                let destination = read_u16(ops, pos + 4)?;
                pos += 6;
                let chosen = if matches!(slots.get(source), SlotValue::Null) {
                    slots.get(fallback)
                } else {
                    slots.get(source)
                };
                let previous = slots.replace(destination, chosen.clone());
                state.journal_write(destination, previous);
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
            // NOTE: `pending_island` / `keyed_rows` are deliberately NOT
            // cleared here. This function runs for every nested control-flow
            // body with the same state, so clearing at range end would wipe
            // the island attributes of a legitimate
            // ISLAND_START → SHOW_IF → OPEN_TAG stream (the island root would
            // silently never hydrate). They are cleared at their owning
            // boundaries instead: ISLAND_END and the LIST item loop.
            if state.pending_tag_close {
                close_start_tag(out, state, limit)?;
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
// Keyed list rows (FORMA-181, DR-8)
// ---------------------------------------------------------------------------

/// A keyed LIST's identity source, resolved once per execution of the LIST.
struct ListKey<'m> {
    /// Byte offset of the LIST, as section `0x0006` names it.
    list_offset: u32,
    /// The key path's segments, as field names.
    segments: Vec<&'m str>,
    /// The path dotted, for diagnostics: shared by every row of the
    /// execution, so a row costs a refcount, not a copy.
    path: Rc<str>,
}

impl<'m> ListKey<'m> {
    fn resolve(
        list_offset: u32,
        segments: &[u32],
        strings: &'m crate::parser::StringTable,
    ) -> Result<Self, IrError> {
        let segments = segments
            .iter()
            .map(|segment| strings.get(*segment))
            .collect::<Result<Vec<&str>, IrError>>()?;
        let path = Rc::from(dotted_path(&segments));
        Ok(ListKey {
            list_offset,
            segments,
            path,
        })
    }
}

/// A key path for a diagnostic: segments joined by dots, and a segment that
/// a dot would make ambiguous (empty, or holding `.`, `[` or `]`) quoted in
/// brackets, so `user.id` is two fields and `["user.id"]` is one.
fn dotted_path(segments: &[&str]) -> String {
    let mut path = String::new();
    for segment in segments {
        if segment.is_empty() || segment.contains(['.', '[', ']']) {
            path.push_str(&format!("[{segment:?}]"));
        } else {
            if !path.is_empty() {
                path.push('.');
            }
            path.push_str(segment);
        }
    }
    path
}

/// What one execution of a LIST iterates (see [`walk_list_rows`]).
struct ListRows<'a, 'm> {
    items: &'a [SlotValue],
    item_slot_id: u16,
    body_start: usize,
    body_end: usize,
    key: Option<&'a ListKey<'m>>,
}

/// Walk every row of one LIST execution.
///
/// Before any error propagates, the slot journal is unwound to the row's mark
/// and a keyed row's guard is popped, and the caller restores the list depth.
/// The rest of the walk state (the element depth, an open start tag, the
/// island stack) is not restored: a `WalkState` serves one walk, and an error
/// ends that walk, which returns no partial page.
fn walk_list_rows(
    module: &IrModule,
    slots: &mut SlotData,
    ops: &[u8],
    rows: ListRows<'_, '_>,
    out: &mut String,
    state: &mut WalkState,
    depth: usize,
) -> Result<(), IrError> {
    let limit = state.max_output_bytes;
    // A list longer than what is left of the budget fails here, before its
    // first row, instead of walking up to the budget and failing there
    // (DR-13, SR38): a hostile 60,000-row list costs a comparison, not 50,000
    // rows. It fails exactly when the per-row check below would have, sooner,
    // and before any error the rows would have raised first (an output
    // budget, a malformed row, a keyed row's identity). That check stays: rows
    // of nested lists can spend the budget after this list was let in.
    //
    // Verified by: crates/forma-ir/src/walker.rs > "a_list_longer_than_the_remaining_budget_fails_before_its_first_row"
    // Verified by: crates/forma-ir/src/walker.rs > "a_list_exactly_at_the_remaining_budget_still_renders"
    let remaining = state
        .max_list_iterations
        .saturating_sub(state.list_iterations);
    if rows.items.len() > remaining {
        return Err(IrError::ListBudgetExceeded {
            max: state.max_list_iterations,
        });
    }
    // The keys this execution of the list has rendered, each with the row
    // that rendered it. Scoped to one execution: an inner list under two
    // outer rows, or two lists over the same array, may reuse a key. Bounded
    // by the output budget: a key is admitted only when its normalized text
    // fits in what is left of the budget, and every admitted key is then
    // written, escaped, on its row's root, so the keys held here never
    // outgrow the output.
    // One allocation per key: the set and the row's guard share it.
    let mut seen_keys: HashMap<Rc<str>, usize> = HashMap::new();
    for (ordinal, item) in rows.items.iter().enumerate() {
        // Total across all depths, never decremented: depth alone does not
        // bound volume, and four nested LISTs over the same array give n^4
        // body walks.
        //
        // Checked before counting, so at the error the count is the rows
        // actually walked (`WalkCounts`).
        if state.list_iterations >= state.max_list_iterations {
            return Err(IrError::ListBudgetExceeded {
                max: state.max_list_iterations,
            });
        }
        state.list_iterations += 1;

        // A keyed row's identity is read from the row's own data before its
        // body runs, so a row without one writes nothing, and the whole render
        // is refused: no page carries a list the client could not adopt.
        if let Some(key) = rows.key {
            let refuse = |reason| list_key_error(key.list_offset, ordinal, &key.path, reason);
            let value = crate::keys::key_value_at(item, &key.segments).map_err(refuse)?;
            // The text is built only once it is known to fit: a key longer
            // than what is left of the output budget could never be written,
            // and copying it first would let one row allocate past the budget.
            if crate::keys::normalized_len_exceeds(value, limit.saturating_sub(out.len())) {
                return Err(IrError::OutputLimitExceeded { limit });
            }
            let text: Rc<str> = crate::keys::canonical_key_text(value)
                .map_err(refuse)?
                .into();
            if let Some(&first_row) = seen_keys.get(&text) {
                // The two ordinals, never the key: it is the row's data.
                return Err(refuse(ListKeyReason::Duplicate { first_row }));
            }
            seen_keys.insert(Rc::clone(&text), ordinal);
            state.keyed_rows.push(KeyedRow {
                list_offset: key.list_offset,
                ordinal,
                path: Rc::clone(&key.path),
                key: Some(text),
                entry_depth: state.element_depth,
                roots: 0,
                stray_content: false,
                envelope: None,
            });
        }

        // Scoped binding instead of a per-row `SlotData` clone: swap the item
        // in, walk, swap back. Same isolation between rows, without copying
        // every other slot on the page once per row.
        let mark = state.slot_journal.len();
        let previous = slots.replace(rows.item_slot_id, item.clone());
        state.slot_journal.push((rows.item_slot_id, previous));

        let walked = walk_range(
            module,
            slots,
            ops,
            rows.body_start,
            rows.body_end,
            out,
            state,
            depth + 1,
        );
        // Unwind before propagating: an aborted walk must still hand `slots`
        // back exactly as it was, because an enclosing row is about to unwind
        // on top of it.
        state.unwind_slot_journal(slots, mark);
        // The row's guard ends with the row, whatever the walk returned; a key
        // it still holds met no root element.
        let keyed_row = if rows.key.is_some() {
            state.keyed_rows.pop()
        } else {
            None
        };
        walked?;

        if let Some(row) = keyed_row {
            if state.element_depth != row.entry_depth {
                // An element the row opened is still open: its root (or what
                // follows it) did not close where the row ends.
                return Err(row.refuse(ListKeyReason::UnbalancedRow));
            }
            if row.roots != 1 || row.stray_content || row.envelope.is_some() {
                return Err(row.refuse(ListKeyReason::RowShape {
                    roots: row.roots,
                    stray_content: row.stray_content || row.envelope.is_some(),
                }));
            }
        }
    }
    Ok(())
}

/// The whole-render refusal for one keyed row (RENDER-503).
fn list_key_error(list_offset: u32, row: usize, path: &str, reason: ListKeyReason) -> IrError {
    IrError::InvalidListKey(Box::new(ListKeyViolation::new(
        list_offset,
        row,
        path,
        reason,
    )))
}

/// A refusal inside the innermost keyed row, or `fallback` when the walk is in
/// none (unreachable through the callers, which act only inside a row).
fn innermost_row_error(state: &WalkState, reason: ListKeyReason, fallback: IrError) -> IrError {
    match state.keyed_rows.last() {
        Some(row) => row.refuse(reason),
        None => fallback,
    }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Offset arithmetic
// ---------------------------------------------------------------------------

/// `base + len`, rejected if it overflows or leaves the enclosing region.
///
/// Plain `+` on `usize` can overflow on a 32-bit target. The parser accepts
/// arbitrary bytes, so the offset must be checked before indexing.
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
    // A NUL anywhere in a URL attribute value is refused outright (FORMA-182
    // review S1): no author writes one, and the normalized U+FFFD it would
    // become is not ignored by the URL parser, so `java\0script:` would be
    // written as `java\u{FFFD}script:` and resolved and fetched as a
    // same-origin relative reference in every engine. The guard therefore
    // classifies the raw value; for every other character the strip below
    // makes the raw and normalized views agree.
    // Verified by: crates/forma-ir/src/walker.rs > "url_attributes_are_checked_as_the_normalized_string_that_is_written"
    if value.contains('\0') {
        return true;
    }
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

/// Core's HTML boolean attribute set (`BOOLEAN_ATTRS` in
/// packages/core/src/dom/element.ts): the attributes a `true` writes bare.
/// Matched as written, as core matches its prop keys.
/// Verified by: crates/forma-ir/src/walker.rs > "rule_6_attribute_values_follow_one_table"
const HTML_BOOLEAN_ATTRIBUTES: [&str; 22] = [
    "async",
    "autofocus",
    "autoplay",
    "checked",
    "controls",
    "default",
    "defer",
    "disabled",
    "formnovalidate",
    "hidden",
    "ismap",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "readonly",
    "required",
    "reversed",
    "selected",
];

fn is_html_boolean_attribute(name: &str) -> bool {
    HTML_BOOLEAN_ATTRIBUTES.contains(&name)
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
/// CLOSE_TAG follows (`has_content`). The `>` is deliberately not written yet:
/// DYN_ATTR opcodes may still append attributes.
fn emit_open_tag(
    out: &mut String,
    tag: &str,
    attrs: &[(&str, &str)],
    has_content: bool,
    state: &mut WalkState,
    limit: usize,
) -> Result<(), IrError> {
    if !is_valid_name(tag) {
        return Err(IrError::InvalidName(tag.to_string()));
    }
    // Decided before the depth moves: an element opened at the depth the
    // innermost keyed row was entered at is that row's root (FORMA-181).
    let row_key = state.open_row_root();
    state.open_tag_is_row_root = row_key.is_some();
    if row_key.is_some()
        && attrs
            .iter()
            .any(|(key, _)| key.eq_ignore_ascii_case("data-forma-key"))
    {
        // The identity attribute is the walker's to write, once, from the
        // key path; an authored one would be a second, silently first-wins
        // identity on the same root.
        return Err(innermost_row_error(
            state,
            ListKeyReason::AuthoredKey,
            IrError::InvalidName("data-forma-key".to_string()),
        ));
    }
    if has_content {
        enter_element(out, tag, state, limit)?;
        state.element_depth += 1;
    }
    push_checked(out, "<", limit)?;
    push_checked(out, tag, limit)?;

    for (key, val) in attrs {
        // `value` on a textarea or select, and `selected` on an option of a
        // bound select, are written another way.
        if consume_control_attr(state, key, Prop::Static(val)) {
            continue;
        }
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
        push_checked(out, " data-forma-state=\"", limit)?;
        push_checked(out, &island.occurrence.to_string(), limit)?;
        push_checked(out, "\" data-forma-h=\"", limit)?;
        push_checked(out, &island.hash, limit)?;
        push_checked(out, "\"", limit)?;
    }

    // The keyed row's identity, on its root (FORMA-181, DR-8). The canonical
    // text is already normalized (value rule 1); `push_escaped_attr` applies
    // the same rule again, which is idempotent, and escapes for the
    // attribute, so the browser decodes exactly the canonical text.
    if let Some(key) = row_key {
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
// Parsing context: text-only parents and form controls
// ---------------------------------------------------------------------------

/// An element whose content the HTML tokenizer reads as text, not markup.
///
/// `textarea` and `title` are RCDATA: character references are decoded, but
/// a comment is not a comment. `style` (RAWTEXT) and `script` (script data)
/// decode nothing. A hydration marker inside any of them is literal text:
/// before JavaScript it is the control's value, what a form submits, and the
/// title the reader sees. So inside these four the walker writes no `f:`
/// marker of any kind (text, conditional, list or island) and no zero-width
/// space: the content is the element's static and dynamic text, in order.
///
/// The client adopts `textarea` and `title` text as a whole, by the element
/// (formajs, FORMA-003). A reactive child of `style` or `script` is not
/// supported for adoption in 0.2.x: its text is right before JavaScript, but
/// adoption may rewrite it. DR-7 makes it a build error in 3.0.0.
///
/// Dynamic text is still HTML-escaped. In RCDATA the parser decodes it back,
/// so the text is exact. In `style` and `script` nothing is decoded, so a
/// value holding `&`, `<` or `>` reads as the entity until the client writes
/// the element; that is the price of a hole that can neither close its
/// element (`</style>`) nor, in a script, swallow the rest of the page. A
/// hole there is still a code sink: the escaping does not make the value safe
/// as JavaScript or CSS.
///
/// Matched ASCII case-insensitively and in any namespace. An SVG `title` has
/// ordinary content, but its text written without markers is equally right,
/// and a single rule is one the client can match exactly.
///
/// Verified by: crates/forma-ir/src/walker.rs > "dyn_text_in_a_text_only_parent_is_written_without_markers"
/// Verified by: crates/forma-ir/src/walker.rs > "no_marker_kind_is_written_inside_a_text_only_parent"
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextOnlyTag {
    Textarea,
    Title,
    Style,
    Script,
}

impl TextOnlyTag {
    fn from_tag(tag: &str) -> Option<Self> {
        [Self::Textarea, Self::Title, Self::Style, Self::Script]
            .into_iter()
            .find(|t| tag.eq_ignore_ascii_case(t.name()))
    }

    fn name(self) -> &'static str {
        match self {
            TextOnlyTag::Textarea => "textarea",
            TextOnlyTag::Title => "title",
            TextOnlyTag::Style => "style",
            TextOnlyTag::Script => "script",
        }
    }
}

/// The text-only element the walk is inside.
#[derive(Debug)]
struct TextOnlyParent {
    tag: TextOnlyTag,
    /// Whether any content has been written: the leading-LF rule looks at the
    /// first byte only.
    started: bool,
    /// A `textarea` whose `value` is bound: the value is its whole content,
    /// as it is on the live control, so its children are not written.
    value_bound: bool,
}

/// Write text into a text-only parent: escaped, with no marker and no
/// zero-width space, under the textarea's leading-LF rule.
///
/// The parser drops one line feed straight after `<textarea>`. A marker used
/// to stand between the tag and the first line; without one, content that
/// starts with a line break gets one more, so the parsed value is the value
/// written. Under rule 1 a leading CR or CRLF is already a line feed when it
/// is written, so only an initial LF of the normalized text is doubled. An
/// empty chunk does not consume the boundary.
///
/// Verified by: crates/forma-ir/src/walker.rs > "a_textarea_doubles_a_leading_line_feed"
/// Verified by: crates/forma-ir/src/walker.rs > "textarea_children_protect_only_an_initial_normalized_line_feed"
fn write_text_only(
    out: &mut String,
    parent: &mut TextOnlyParent,
    text: &str,
    limit: usize,
) -> Result<(), IrError> {
    if text.is_empty() {
        return Ok(());
    }
    if parent.tag == TextOnlyTag::Textarea
        && !parent.started
        && normalized_chars(text).next() == Some('\n')
    {
        push_checked(out, "\n", limit)?;
    }
    parent.started = true;
    push_escaped_html(out, text, limit)
}

/// Form-control state gathered from a start tag that is still open.
///
/// A `value` on a `textarea` or a `select` is a property: HTML never reads it
/// as an attribute, so the server shipped an empty textarea and a select
/// showing its first option, and a form submitted those before JavaScript.
/// The client's writer (`writeFormControlProperty` in `@getforma/core`) sets
/// `value == null ? '' : String(value)`; the walker writes the HTML that
/// parses to the same control, and no `value` attribute.
#[derive(Debug, Default)]
enum PendingControl {
    #[default]
    None,
    /// A `textarea`; `value` is the text its bound value stands for.
    Textarea { value: Option<String> },
    /// A `select`; `multiple` records whether that attribute is written.
    Select {
        value: Option<SlotValue>,
        multiple: bool,
    },
    /// An `option` of a bound select; `value` is its `value` attribute as
    /// written, `None` when it has none.
    OptionTag { value: Option<String> },
}

/// What a bound `select` selects.
///
/// Mirrors the client's writer. A `multiple` select given an array selects
/// every option whose value is in it (`value.map(String)`). Anything else is
/// `select.value = String(value)`, which selects the FIRST option with that
/// value; a second `selected` in the HTML would win instead, since the parser
/// keeps the last. An option's value is its `value` attribute or, without
/// one, its text, stripped and collapsed. A value no option has selects
/// nothing, and the browser then shows the first option: HTML cannot write
/// the client's `selectedIndex = -1`.
///
/// Verified by: crates/forma-ir/src/walker.rs > "a_select_value_binding_selects_the_matching_option"
/// Verified by: crates/forma-ir/src/walker.rs > "a_single_select_selects_only_the_first_matching_option"
/// Verified by: crates/forma-ir/src/walker.rs > "a_multiple_select_selects_every_option_in_an_array_value"
#[derive(Debug)]
struct SelectBinding {
    wanted: SelectWanted,
    /// A single select has selected its option.
    matched: bool,
}

#[derive(Debug)]
enum SelectWanted {
    One(String),
    Any(Vec<String>),
}

impl SelectBinding {
    fn new(value: &SlotValue, multiple: bool) -> Self {
        // Each wanted value is compared with option values that are written
        // normalized (rule 1), so it is normalized the same way: a requested
        // NUL matches the option whose attribute the browser reads as U+FFFD.
        let wanted = match value {
            SlotValue::Array(items) if multiple => {
                SelectWanted::Any(items.iter().map(js_string).collect())
            }
            // `value == null ? '' : String(value)` is exactly `to_text`.
            other => SelectWanted::One(normalize_text(&other.to_text()).into_owned()),
        };
        SelectBinding {
            wanted,
            matched: false,
        }
    }

    /// Whether the option valued `option_value` is selected.
    fn selects(&mut self, option_value: &str) -> bool {
        match &self.wanted {
            SelectWanted::Any(values) => values.iter().any(|v| v == option_value),
            SelectWanted::One(value) => {
                let hit = !self.matched && value == option_value;
                self.matched |= hit;
                hit
            }
        }
    }
}

/// `String(value)` for one member of an array: unlike a text hole, `null` is
/// `"null"`.
fn js_string(value: &SlotValue) -> String {
    match value {
        SlotValue::Null => "null".to_string(),
        other => normalize_text(&other.to_text()).into_owned(),
    }
}

/// An option of a bound select with no `value` attribute. Its value is its
/// text, known only when the option ends, so ` selected` is inserted then.
#[derive(Debug)]
struct OptionByText {
    /// Byte offset of the `>` that ends the option's start tag. The walker
    /// only ever appends to its output, so the offset stays valid.
    insert_at: usize,
    /// The option's text as the parser will read it.
    text: String,
}

/// An attribute value as the IR gives it: authored text, or a slot.
#[derive(Clone, Copy)]
enum Prop<'a> {
    Static(&'a str),
    Slot(&'a SlotValue),
}

impl Prop<'_> {
    /// The client's control text: `value == null ? '' : String(value)`, under
    /// rule 1, since it is compared with and written as DOM text.
    fn control_text(self) -> String {
        match self {
            Prop::Static(s) => normalize_text(s).into_owned(),
            Prop::Slot(v) => normalize_text(&v.to_text()).into_owned(),
        }
    }

    /// Whether the generic path writes the attribute at all (DYN_ATTR's
    /// boolean rule: `false` and `null` omit it).
    fn is_written(self) -> bool {
        !matches!(
            self,
            Prop::Slot(SlotValue::Null) | Prop::Slot(SlotValue::Bool(false))
        )
    }

    /// The value the attribute is written with: `None` when omitted, `""`
    /// when bare.
    fn written(self) -> Option<String> {
        match self {
            _ if !self.is_written() => None,
            Prop::Slot(SlotValue::Bool(true)) => Some(String::new()),
            other => Some(other.control_text()),
        }
    }

    fn to_slot(self) -> SlotValue {
        match self {
            Prop::Static(s) => SlotValue::Text(s.to_string()),
            Prop::Slot(v) => v.clone(),
        }
    }
}

/// Apply the form-control rules to one attribute of the open start tag.
/// Returns true when the attribute is consumed and must not be written.
///
/// Keys match exactly, as the client's `isFormControlProperty` does.
fn consume_control_attr(state: &mut WalkState, key: &str, prop: Prop<'_>) -> bool {
    match &mut state.pending_control {
        PendingControl::None => false,
        PendingControl::Textarea { value } => {
            if key != "value" {
                return false;
            }
            *value = Some(prop.control_text());
            true
        }
        PendingControl::Select { value, multiple } => match key {
            "value" => {
                *value = Some(prop.to_slot());
                true
            }
            "multiple" => {
                *multiple |= match prop {
                    Prop::Static(_) => true,
                    Prop::Slot(value) => value.as_bool(),
                };
                false
            }
            _ => false,
        },
        PendingControl::OptionTag { value } => match key {
            // The binding decides, as on the client, where the select's
            // value is written after its options.
            "selected" => true,
            "value" => {
                // The parser keeps the first of two same-named attributes.
                if value.is_none() {
                    *value = prop.written();
                }
                false
            }
            _ => false,
        },
    }
}

/// Set up the parsing context for an element whose start tag (OPEN_TAG) is
/// about to be written.
fn enter_element(
    out: &mut String,
    tag: &str,
    state: &mut WalkState,
    limit: usize,
) -> Result<(), IrError> {
    let is = |name: &str| tag.eq_ignore_ascii_case(name);
    // A new option or optgroup ends the open option: `</option>` is optional.
    if is("option") || is("optgroup") {
        finish_option_by_text(out, state, limit)?;
    }
    state.pending_control = if is("textarea") {
        PendingControl::Textarea { value: None }
    } else if is("select") {
        PendingControl::Select {
            value: None,
            multiple: false,
        }
    } else if is("option") && state.select.is_some() {
        PendingControl::OptionTag { value: None }
    } else {
        PendingControl::None
    };
    if state.text_only.is_none() {
        state.text_only = TextOnlyTag::from_tag(tag).map(|tag| TextOnlyParent {
            tag,
            started: false,
            value_bound: false,
        });
    }
    Ok(())
}

/// Tear down the parsing context at a CLOSE_TAG, before `</tag>` is written.
fn leave_element(
    out: &mut String,
    tag: &str,
    state: &mut WalkState,
    limit: usize,
) -> Result<(), IrError> {
    let is = |name: &str| tag.eq_ignore_ascii_case(name);
    if is("option") || is("optgroup") || is("select") {
        finish_option_by_text(out, state, limit)?;
    }
    if is("select") {
        state.select = None;
    }
    // `</pre>` is a token too; the length check would already miss, but an
    // explicit clear keeps the state's meaning local to its element.
    state.pre_boundary = None;
    if state
        .text_only
        .as_ref()
        .is_some_and(|parent| is(parent.tag.name()))
    {
        state.text_only = None;
    }
    Ok(())
}

/// Write the `>` that ends the open start tag, resolving the form-control
/// state gathered from its attributes.
///
/// Every place that used to write a bare `>` for `pending_tag_close` calls
/// this instead, so a control is resolved whichever opcode ends its tag.
fn close_start_tag(out: &mut String, state: &mut WalkState, limit: usize) -> Result<(), IrError> {
    state.pending_tag_close = false;
    state.open_tag_is_row_root = false;
    match std::mem::take(&mut state.pending_control) {
        PendingControl::None => {}
        PendingControl::Textarea { value } => {
            push_checked(out, ">", limit)?;
            if let (Some(value), Some(parent)) = (value, state.text_only.as_mut()) {
                if parent.tag == TextOnlyTag::Textarea {
                    parent.value_bound = true;
                    write_text_only(out, parent, &value, limit)?;
                }
            }
            return Ok(());
        }
        PendingControl::Select { value, multiple } => {
            state.select = value.map(|value| SelectBinding::new(&value, multiple));
        }
        PendingControl::OptionTag { value: Some(value) } => {
            if state.select.as_mut().is_some_and(|s| s.selects(&value)) {
                push_checked(out, " selected", limit)?;
            }
        }
        PendingControl::OptionTag { value: None } => {
            state.option_by_text = Some(OptionByText {
                insert_at: out.len(),
                text: String::new(),
            });
        }
    }
    push_checked(out, ">", limit)?;
    let tag = &state.pending_tag_name;
    if tag.eq_ignore_ascii_case("pre") || tag.eq_ignore_ascii_case("listing") {
        state.pre_boundary = Some(out.len());
    }
    Ok(())
}

/// End an option whose value is its text, selecting it now if the text
/// matches. Runs at `</option>` and wherever the parser ends one implicitly.
///
/// Verified by: crates/forma-ir/src/walker.rs > "a_select_value_binding_matches_an_option_without_a_value_by_its_text"
fn finish_option_by_text(
    out: &mut String,
    state: &mut WalkState,
    limit: usize,
) -> Result<(), IrError> {
    let Some(option) = state.option_by_text.take() else {
        return Ok(());
    };
    let value = strip_and_collapse_ascii_whitespace(&option.text);
    if state.select.as_mut().is_some_and(|s| s.selects(&value)) {
        const SELECTED: &str = " selected";
        if out.len().saturating_add(SELECTED.len()) > limit {
            return Err(IrError::OutputLimitExceeded { limit });
        }
        out.insert_str(option.insert_at, SELECTED);
    }
    Ok(())
}

/// HTML's "strip and collapse ASCII whitespace", which turns an option's text
/// into its value.
fn strip_and_collapse_ascii_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for word in text.split_ascii_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
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
    Ok(u16::from_le_bytes([data[pos], data[pos + 1]]))
}

/// Read a little-endian u32 from `data` at `pos`.
pub(crate) fn read_u32(data: &[u8], pos: usize) -> Result<u32, IrError> {
    if pos + 4 > data.len() {
        return Err(IrError::BufferTooShort {
            expected: pos + 4,
            actual: data.len(),
        });
    }
    Ok(u32::from_le_bytes([
        data[pos],
        data[pos + 1],
        data[pos + 2],
        data[pos + 3],
    ]))
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
    // ASCII digits are always UTF-8; the error arm is unreachable and costs
    // nothing, where `expect` would put a panic on the hottest write.
    match core::str::from_utf8(&buf[start..]) {
        Ok(digits) => push_checked(out, digits, limit),
        Err(e) => Err(IrError::InvalidUtf8(e.to_string())),
    }
}

/// Append one normalized character, refusing to exceed the output budget by
/// its actual encoded length: U+FFFD (NUL's replacement) is three bytes, an
/// astral character four, so a check of `out.len() >= limit` before the push
/// could overshoot the budget by up to three bytes.
///
/// Verified by: crates/forma-ir/src/walker.rs > "the_output_budget_counts_the_normalized_and_escaped_bytes_actually_written"
fn push_char_checked(out: &mut String, ch: char, limit: usize) -> Result<(), IrError> {
    if out.len().saturating_add(ch.len_utf8()) > limit {
        return Err(IrError::OutputLimitExceeded { limit });
    }
    out.push(ch);
    Ok(())
}

/// Escape text for HTML content (`& < >`), within the output budget.
///
/// The text is written under rule 1 (`crate::text`): CRLF and CR become LF
/// and NUL becomes U+FFFD, per value, before escaping. A NUL grows from one
/// byte to three, which the fast path's worst-case bound (six per input
/// byte) already covers.
///
/// Verified by: crates/forma-ir/src/walker.rs > "text_and_dyn_text_write_each_value_normalized"
fn push_escaped_html(out: &mut String, text: &str, limit: usize) -> Result<(), IrError> {
    // Fast path: even worst-case expansion fits, so no per-character checks.
    if out
        .len()
        .saturating_add(text.len().saturating_mul(MAX_ESCAPE_EXPANSION))
        <= limit
    {
        for ch in normalized_chars(text) {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                _ => out.push(ch),
            }
        }
        return Ok(());
    }
    for ch in normalized_chars(text) {
        match ch {
            '&' => push_checked(out, "&amp;", limit)?,
            '<' => push_checked(out, "&lt;", limit)?,
            '>' => push_checked(out, "&gt;", limit)?,
            _ => push_char_checked(out, ch, limit)?,
        }
    }
    Ok(())
}

/// Escape text for HTML attribute values (`& " < >`), within the output budget.
/// Normalized under rule 1 exactly as [`push_escaped_html`] is.
///
/// Verified by: crates/forma-ir/src/walker.rs > "static_and_dynamic_attributes_write_each_value_normalized"
fn push_escaped_attr(out: &mut String, text: &str, limit: usize) -> Result<(), IrError> {
    if out
        .len()
        .saturating_add(text.len().saturating_mul(MAX_ESCAPE_EXPANSION))
        <= limit
    {
        for ch in normalized_chars(text) {
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
    for ch in normalized_chars(text) {
        match ch {
            '&' => push_checked(out, "&amp;", limit)?,
            '"' => push_checked(out, "&quot;", limit)?,
            '<' => push_checked(out, "&lt;", limit)?,
            '>' => push_checked(out, "&gt;", limit)?,
            _ => push_char_checked(out, ch, limit)?,
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
        build_declared_fixture, encode_close_tag, encode_list, encode_open_tag, encode_show_if,
        encode_text, encode_void_tag,
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

    /// Helper: build an IrModule, walk it with empty slots, return the HTML.
    fn walk_static(strings: &[&str], opcodes: &[u8]) -> String {
        let data = build_declared_fixture(strings, &[], opcodes, &[]);
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
        let data = build_declared_fixture(strings, slot_decls, opcodes, &[]);
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
        let data = build_declared_fixture(strings, slot_decls, opcodes, island_decls);
        let module = IrModule::parse(&data).unwrap();
        walk_to_html(&module, slots).unwrap()
    }

    fn walk_with_islands_output(
        strings: &[&str],
        slot_decls: &[(u16, u32, u8, u8, &[u8])],
        island_decls: &[(u16, u8, u8, u32, u32, &[u16])],
        opcodes: &[u8],
        slots: &SlotData,
    ) -> WalkOutput {
        let data = build_declared_fixture(strings, slot_decls, opcodes, island_decls);
        let module = IrModule::parse(&data).unwrap();
        walk_to_html_counted(&module, slots, WalkLimits::default()).unwrap()
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
    fn dyn_attr_empty_string_and_zero_follow_boolean_presence() {
        // The original expected ordinary value semantics on `disabled`.
        // Its exact source is archived with the FORMA-182 review evidence.
        // Ordinary empty values remain covered by attributes.json.
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Text(String::new())),
            "<input>"
        );
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Text("yes".into())),
            "<input disabled>"
        );
        assert_eq!(walk_dyn_attr_with(SlotValue::Number(0.0)), "<input>");
        assert_eq!(
            walk_dyn_attr_with(SlotValue::Number(1.0)),
            "<input disabled>"
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

        let data = build_declared_fixture(
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

    // -- Test 27: walk_switch_no_match ------------------------------------

    // -- Test 28: walk_switch_first_case ----------------------------------

    // -- Test 29: walk_switch_with_elements -------------------------------

    // -- Test 30: walk_try_renders_main -----------------------------------

    // -- Test 31: walk_preload_font ---------------------------------------

    // -- Test 32: walk_preload_style --------------------------------------

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

        let ir = build_declared_fixture(
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

        let ir = build_declared_fixture(
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

        let ir = build_declared_fixture(
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

        let ir = build_declared_fixture(
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

        let ir = build_declared_fixture(
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
            r#"<!--f:i0--><div data-forma-island="0" data-forma-component="AuthForm" data-forma-status="pending" data-forma-hydrate="load" data-forma-state="0" data-forma-h="0000000000000000">Hello</div><!--/f:i0-->"#
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
            r#"<!--f:i0--><div class="form" data-forma-island="0" data-forma-component="AuthForm" data-forma-status="pending" data-forma-hydrate="load" data-forma-state="0" data-forma-h="0000000000000000"></div><!--/f:i0-->"#
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
            r#"<!--f:i0--><input data-forma-island="0" data-forma-component="Widget" data-forma-status="pending" data-forma-hydrate="load" data-forma-state="0" data-forma-h="0000000000000000"><!--/f:i0-->"#
        );
    }

    // -- Declared state is separate from body markup -------------------------

    #[test]
    fn declared_props_are_separate_from_body_html() {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // Island entry has ordered inputs [0, 1]; all props use typed state.
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

        let output = walk_with_islands_output(
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
        assert!(!output.html.contains("data-forma-props"));
        assert!(!output.html.contains("<script"));
        assert!(output.html.contains("data-forma-component=\"MyComponent\""));
        let json: serde_json::Value = serde_json::from_str(output.island_state.as_json()).unwrap();
        assert_eq!(json["i"][0]["p"]["title"], "Hello");
        assert_eq!(json["i"][0]["p"]["count"], 42);
    }

    // -- Test 37: walk_list_item_key_on_first_open_tag -----------------------

    // -- Test 38: walk_list_item_key_on_void_tag -----------------------------

    // -- Test 39: walk_list_item_key_with_attrs ------------------------------

    // -- Test 40: walk_script_tag_props_mode ---------------------------------

    // -- Test 41: walk_deferred_props_mode -----------------------------------

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

        let data = build_declared_fixture(&["div", "Hello"], &[], &opcodes, &[]);
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
        let data = build_declared_fixture(
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

    // -- Empty declared props still have an occurrence ---------------------

    #[test]
    fn empty_declared_inputs_do_not_emit_inline_props() {
        // An empty declaration carries identity but no inferred slot props.
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

    // -- State always has one channel, independent of payload size -----------

    /// Build a one-island page whose single prop slot holds `payload`.
    fn walk_island_with_prop_payload(payload: &str) -> WalkOutput {
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(payload.to_string()));
        walk_with_islands_output(
            &["div", "Big", "blob"],
            &[(0, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x01, 1, 0, &[0])],
            &opcodes,
            &slots,
        )
    }

    #[test]
    fn duplicate_slot_names_do_not_invent_declared_island_props() {
        // Both SERVER slots have the same lookup name. This island declares
        // no inputs, so neither slot is implicitly serialized by name.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text("first".into()));
        slots.set(1, SlotValue::Text("second".into()));

        let output = walk_with_islands_output(
            &["div", "Comp", "dup"],
            &[(0, 2, 0x01, 0x00, &[]), (1, 2, 0x01, 0x00, &[])],
            &[(0, 0x01, 0x01, 1, 0, &[])],
            &opcodes,
            &slots,
        );
        let json: serde_json::Value = serde_json::from_str(output.island_state.as_json()).unwrap();
        assert_eq!(json["i"][0]["p"], serde_json::json!({}));
        assert!(!output.html.contains("data-forma-props"));
    }

    #[test]
    fn small_props_use_the_owned_state_channel() {
        let output = walk_island_with_prop_payload("small");
        assert!(output.island_state.as_json().contains("\"blob\":\"small\""));
        assert!(!output.html.contains("data-forma-props"));
        assert!(!output.html.contains("__forma_islands"));
    }

    #[test]
    fn larger_props_use_the_same_owned_state_channel() {
        let payload = "x".repeat(1025);
        let output = walk_island_with_prop_payload(&payload);
        assert!(!output.html.contains("data-forma-props"));
        assert!(!output.html.contains("__forma_islands"));
        assert!(output.island_state.as_json().contains(&payload));
    }

    #[test]
    fn diagnostic_fragment_does_not_restore_an_inline_state_channel() {
        // Diagnostic fragments cannot restore either retired props channel.
        // Supported page rendering consumes the counted walk's state separately.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let payload = "x".repeat(1024 + 1);
        let mut slots = SlotData::new(1);
        slots.set(0, SlotValue::Text(payload));

        let data = build_declared_fixture(
            &["div", "Big", "blob"],
            &[(0, 2, 0x01, 0x00, &[])],
            &opcodes,
            &[(0, 0x01, 0x01, 1, 0, &[0])],
        );
        let module = IrModule::parse(&data).unwrap();
        let fragment = walk_island(&module, &slots, 0).unwrap();
        assert!(!fragment.contains("data-forma-props"));
        assert!(!fragment.contains("__forma_islands"));
    }

    // -- Test 44: walk_island_and_list_key_combined --------------------------

    // -- Test 45: walk_multiple_islands_script_tag ---------------------------

    #[test]
    fn multiple_islands_share_one_owned_envelope() {
        // Two islands append entries to the same independently owned envelope.
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

        let mut slots = SlotData::new(3);
        slots.set(0, SlotValue::Text("hello".to_string()));
        slots.set(1, SlotValue::Bool(true));
        slots.set(2, SlotValue::Text("x".repeat(1024)));

        let output = walk_with_islands_output(
            &["div", "span", "CompA", "CompB", "msg", "flag", "padding"],
            &[
                (0, 4, 0x01, 0x00, &[]), // slot 0, name="msg", Text
                (1, 5, 0x02, 0x00, &[]),
                (2, 6, 0x01, 0, &[]), // slot 1, name="flag", Bool
            ],
            &[
                (0, 0x01, 0x02, 2, 0, &[0, 2]), // island 0, ScriptTag, name="CompA", byte_offset=0, slots=[0]
                (1, 0x01, 0x02, 3, island1_offset, &[1, 2]), // island 1, ScriptTag, name="CompB", slots=[1]
            ],
            &opcodes,
            &slots,
        );
        let json: serde_json::Value = serde_json::from_str(output.island_state.as_json()).unwrap();
        assert_eq!(json["i"][0]["p"]["msg"], "hello");
        assert_eq!(json["i"][1]["p"]["flag"], true);
        assert_eq!(output.island_state.len(), 2);
        assert!(!output.html.contains("<script"));
    }

    // -- Test 46: walk_list_item_key_consumed_once --------------------------

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

        let data = build_declared_fixture(
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
             data-forma-status=\"pending\" data-forma-hydrate=\"load\" data-forma-state=\"0\" data-forma-h=\"0000000000000000\">hello</p>"
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

        let data = build_declared_fixture(
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
            "data-forma-state=\"0\"",
            "data-forma-h=\"0000000000000000\"",
        ] {
            assert!(page.contains(attr), "page missing {attr}: {page}");
            assert!(
                fragment.contains(attr),
                "fragment missing {attr}: {fragment}"
            );
        }
    }

    #[test]
    fn obsolete_mode_cannot_restore_fragment_inline_props() {
        // The obsolete tuple mode is ignored by the declared fixture builder.
        // It cannot reactivate either retired body/inline props channel.
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let data = build_declared_fixture(
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
            !fragment.contains("data-forma-props="),
            "diagnostic fragment must not inline props: {fragment}"
        );
        assert!(
            !fragment.contains("__forma_islands"),
            "fragment must not emit a second islands block: {fragment}"
        );
    }

    #[test]
    fn nested_diagnostic_fragment_has_occurrence_markers() {
        // Nested diagnostic roots retain distinct occurrence identities.
        // Actual page state is carried separately by the counted whole walk.
        let mut opcodes = encode_island_start(0);
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        let inner_offset = opcodes.len() as u32;
        opcodes.extend_from_slice(&encode_island_start(1));
        opcodes.extend_from_slice(&encode_open_tag(1, &[]));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(1));
        opcodes.extend_from_slice(&encode_close_tag(1));
        opcodes.extend_from_slice(&encode_island_end(0));

        let data = build_declared_fixture(
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
            fragment.contains("data-forma-state=\"1\""),
            "nested island must retain its own occurrence: {fragment}"
        );
        assert!(!fragment.contains("__forma_islands"), "{fragment}");
    }

    #[test]
    fn walk_island_not_found() {
        // Build IR with no islands, then request island_id=5
        let opcodes = encode_text(0);
        let data = build_declared_fixture(&["Hello"], &[], &opcodes, &[]);
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

        let data = build_declared_fixture(
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
             data-forma-state=\"0\" data-forma-h=\"0000000000000000\">\
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

        let data = build_declared_fixture(
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

    /// Return body HTML and the separately owned, script-safe state JSON.
    fn script_tag_props_html(payload: &str) -> (String, String) {
        // ISLAND_START(0) + OPEN_TAG("div") + CLOSE_TAG + ISLAND_END(0)
        // strings: 0="div", 1="Comp", 2="payload"
        let mut opcodes = Vec::new();
        opcodes.extend_from_slice(&encode_island_start(0));
        opcodes.extend_from_slice(&encode_open_tag(0, &[]));
        opcodes.extend_from_slice(&encode_close_tag(0));
        opcodes.extend_from_slice(&encode_island_end(0));

        let mut slots = SlotData::new(2);
        slots.set(0, SlotValue::Text(payload.to_string()));
        slots.set(1, SlotValue::Text("x".repeat(1024)));

        let output = walk_with_islands_output(
            &["div", "Comp", "payload", "padding"],
            &[(0, 2, 0x01, 0x00, &[]), (1, 3, 0x01, 0, &[])],
            &[(0, 0x01, 0x01, 1, 0, &[0, 1])],
            &opcodes,
            &slots,
        );

        (output.html, output.island_state.as_json().to_owned())
    }

    #[test]
    fn owned_state_has_no_raw_script_openers() {
        // No bare '<' survives, so the JSON cannot terminate or reopen a
        // script element. Greater-than remains ordinary value-preserving text.
        let (_html, body) = script_tag_props_html("</script>alert(1)");
        assert!(
            !body.contains('<'),
            "state envelope must contain no raw script openers, got: {body}"
        );
        assert!(body.contains("\\u003c/script>"), "got: {body}");

        // ...and the escaping is value-preserving: JSON.parse (here
        // serde_json::from_str, which decodes \u003c identically) round-trips
        // back to the original prop value.
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["i"][0]["p"]["payload"], "</script>alert(1)");
    }

    #[test]
    fn owned_state_escapes_existing_comment_script_regression() {
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
        assert!(!body.contains('<'), "got: {body}");

        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["i"][0]["p"]["payload"], payload);
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

        let data = build_declared_fixture(&["div", "data-x", &big], &[], &opcodes, &[]);
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
        let data = build_declared_fixture(&["msg"], &[(0, 0, 0x01, 0x00, &[])], &opcodes, &[]);
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

        let data = build_declared_fixture(
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
        let data =
            build_declared_fixture(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
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
        let data =
            build_declared_fixture(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
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
        let data = build_declared_fixture(
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
    fn parse_accepts_zero_length_else_branch_known_residual() {
        // DOCUMENTED RESIDUAL: an under-long length whose orphaned bytes still
        // decode as a legal sibling sequence is structurally indistinguishable
        // from a legitimate module. No length check can reject it; only module
        // integrity (a CRC that the producer did not restamp) would. This test exists so the
        // case is not later mistaken for a fixed hole.
        let opcodes = encode_show_if(0, &encode_text(1), &[]);
        let data =
            build_declared_fixture(&["flag", "hi"], &[(0, 0, 0x02, 0x00, &[])], &opcodes, &[]);
        assert!(IrModule::parse(&data).is_ok());
    }

    // -- TRY/FALLBACK scoping (F-10) ----------------------------------------

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

    // -- Name validation (S13) ----------------------------------------------

    #[test]
    fn walk_rejects_hostile_tag_name() {
        // Tag names are written unescaped, so an IR-authored name is direct
        // markup injection.
        let opcodes = encode_open_tag(0, &[]);
        let data = build_declared_fixture(&["div onload=\"alert(1)\""], &[], &opcodes, &[]);
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
        let data = build_declared_fixture(&["div", "div><script"], &[], &opcodes, &[]);
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
        let data =
            build_declared_fixture(&["div", "x\"><script", "v", "ok-attr"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        let html = walk_to_html(&module, &slots).unwrap();
        assert_eq!(html, "<div ok-attr=\"v\">");
    }

    #[test]
    fn walk_drops_hostile_boolean_attribute_name() {
        // Same, via the boolean (empty-value) branch.
        let opcodes = encode_open_tag(0, &[(1, 2)]);
        let data = build_declared_fixture(&["div", "y\"><script", ""], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        let slots = SlotData::new(0);
        assert_eq!(walk_to_html(&module, &slots).unwrap(), "<div>");
    }

    #[test]
    fn walk_drops_hostile_dyn_attr_name() {
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_declared_fixture(
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
        let data = build_declared_fixture(
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
        let data = build_declared_fixture(
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
        let data = build_declared_fixture(
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
        let data = build_declared_fixture(&["div", "onmouseover", "alert(1)"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        assert_eq!(
            walk_to_html(&module, &SlotData::new(0)).unwrap(),
            "<div>",
            "static on* attribute must be dropped"
        );

        // ...and the dynamic one.
        let mut opcodes = encode_open_tag(0, &[]);
        opcodes.extend_from_slice(&encode_dyn_attr(1, 0));
        let data = build_declared_fixture(
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
        let data =
            build_declared_fixture(&["a", "href", "javascript:alert(1)"], &[], &opcodes, &[]);
        let module = IrModule::parse(&data).unwrap();
        assert_eq!(walk_to_html(&module, &SlotData::new(0)).unwrap(), "<a>");
    }

    // -- Number rendering parity (F-05) -------------------------------------

    // -- Parsing context: text-only parents and form controls (FORMA-002) ---
    //
    // The tokenizer reads the content of `textarea` and `title` (RCDATA) and
    // of `style` and `script` (RAWTEXT, script data) as text, so a marker
    // comment there is literal text: it becomes the control's value and what a
    // form submits before JavaScript. A bound `value` on a `select` or a
    // `textarea` is a property HTML never reads as an attribute. Each test
    // asserts exact bytes for the affected element AND for a sibling in normal
    // content, so a rule cannot pass by dropping markers everywhere (P3).

    /// A small opcode assembler with an interning string table, so these
    /// tests read as markup rather than as string indices.
    struct Page {
        strings: Vec<String>,
        ops: Vec<u8>,
        slots: Vec<(u8, SlotValue)>,
        islands: Vec<(u16, u32, u32)>,
    }

    impl Page {
        fn new() -> Self {
            Page {
                strings: Vec::new(),
                ops: Vec::new(),
                slots: Vec::new(),
                islands: Vec::new(),
            }
        }

        fn intern(&mut self, s: &str) -> u32 {
            let index = match self.strings.iter().position(|x| x == s) {
                Some(i) => i,
                None => {
                    self.strings.push(s.to_string());
                    self.strings.len() - 1
                }
            };
            u32::try_from(index).unwrap()
        }

        /// Declare the next slot holding `value`; ids are assigned in order.
        fn slot(&mut self, value: SlotValue) -> u16 {
            let type_byte = match &value {
                SlotValue::Null | SlotValue::Text(_) => 0x01,
                SlotValue::Bool(_) => 0x02,
                SlotValue::Number(_) => 0x03,
                SlotValue::Array(_) => 0x04,
                SlotValue::Object(_) => 0x05,
            };
            self.slots.push((type_byte, value));
            u16::try_from(self.slots.len() - 1).unwrap()
        }

        fn open(&mut self, tag: &str, attrs: &[(&str, &str)]) -> &mut Self {
            let tag = self.intern(tag);
            let attrs: Vec<(u32, u32)> = attrs
                .iter()
                .map(|(k, v)| (self.intern(k), self.intern(v)))
                .collect();
            self.ops.extend_from_slice(&encode_open_tag(tag, &attrs));
            self
        }

        fn close(&mut self, tag: &str) -> &mut Self {
            let tag = self.intern(tag);
            self.ops.extend_from_slice(&encode_close_tag(tag));
            self
        }

        fn text(&mut self, text: &str) -> &mut Self {
            let text = self.intern(text);
            self.ops.extend_from_slice(&encode_text(text));
            self
        }

        /// DYN_TEXT whose marker id is its slot id, so ids stay distinct.
        fn dyn_text(&mut self, slot: u16) -> &mut Self {
            self.ops.extend_from_slice(&encode_dyn_text(slot, slot));
            self
        }

        fn dyn_attr(&mut self, name: &str, slot: u16) -> &mut Self {
            let name = self.intern(name);
            self.ops.extend_from_slice(&encode_dyn_attr(name, slot));
            self
        }

        /// PROP: `target = source[name]`.
        fn prop(&mut self, source: u16, name: &str, target: u16) -> &mut Self {
            let name = self.intern(name);
            self.ops
                .extend_from_slice(&encode_prop(source, name, target));
            self
        }

        /// Assemble `f`'s opcodes on their own, sharing the string table.
        fn body(&mut self, f: impl FnOnce(&mut Self)) -> Vec<u8> {
            let outer = std::mem::take(&mut self.ops);
            f(self);
            std::mem::replace(&mut self.ops, outer)
        }

        fn show_if(
            &mut self,
            slot: u16,
            then_ops: impl FnOnce(&mut Self),
            else_ops: impl FnOnce(&mut Self),
        ) -> &mut Self {
            let then_ops = self.body(then_ops);
            let else_ops = self.body(else_ops);
            self.ops
                .extend_from_slice(&encode_show_if(slot, &then_ops, &else_ops));
            self
        }

        fn list(&mut self, slot: u16, item: u16, body: impl FnOnce(&mut Self)) -> &mut Self {
            let body = self.body(body);
            self.ops.extend_from_slice(&encode_list(slot, item, &body));
            self
        }

        /// An island at the top level (its table offset is taken here, so it
        /// must not be nested inside a `body`).
        fn island(&mut self, id: u16, body: impl FnOnce(&mut Self)) -> &mut Self {
            let name = self.intern(&format!("Island{id}"));
            let offset = u32::try_from(self.ops.len()).unwrap();
            self.islands.push((id, name, offset));
            self.ops.extend_from_slice(&encode_island_start(id));
            body(self);
            self.ops.extend_from_slice(&encode_island_end(id));
            self
        }

        fn module_and_slots(&self) -> (IrModule, SlotData) {
            let mut strings = self.strings.clone();
            let mut decls = Vec::new();
            for (id, (type_byte, _)) in self.slots.iter().enumerate() {
                strings.push(format!("slot{id}"));
                let name = u32::try_from(strings.len() - 1).unwrap();
                decls.push((u16::try_from(id).unwrap(), name, *type_byte, 0x00, &[][..]));
            }
            let islands: Vec<(u16, u8, u8, u32, u32, &[u16])> = self
                .islands
                .iter()
                .map(|&(id, name, offset)| (id, 0x01, 0x01, name, offset, &[][..]))
                .collect();
            let strings: Vec<&str> = strings.iter().map(String::as_str).collect();
            let data = build_declared_fixture(&strings, &decls, &self.ops, &islands);
            let module = IrModule::parse(&data).unwrap();
            let mut slots = SlotData::new(self.slots.len());
            for (id, (_, value)) in self.slots.iter().enumerate() {
                slots.set(u16::try_from(id).unwrap(), value.clone());
            }
            (module, slots)
        }

        fn render(&self) -> String {
            let (module, slots) = self.module_and_slots();
            walk_to_html(&module, &slots).unwrap()
        }

        fn render_island(&self, id: u16) -> String {
            let (module, slots) = self.module_and_slots();
            walk_island(&module, &slots, id).unwrap()
        }
    }

    fn text(s: &str) -> SlotValue {
        SlotValue::Text(s.to_string())
    }

    #[test]
    fn dyn_text_in_a_text_only_parent_is_written_without_markers() {
        // One table over every text-only parent (P2), plus an upper-case tag:
        // HTML tag names are case-insensitive. The value is still escaped:
        // RCDATA decodes the references back, and in RAWTEXT the escaping is
        // what stops a value from closing the element.
        for parent in ["textarea", "title", "style", "script", "TEXTAREA"] {
            let mut page = Page::new();
            let inside = page.slot(text("a<b&c"));
            let outside = page.slot(text("world"));
            page.open("div", &[])
                .open(parent, &[])
                .dyn_text(inside)
                .close(parent)
                .open("p", &[])
                .dyn_text(outside)
                .close("p")
                .close("div");
            assert_eq!(
                page.render(),
                format!(
                    "<div><{parent}>a&lt;b&amp;c</{parent}>\
                     <p><!--f:t1-->world<!--/f:t1--></p></div>"
                ),
                "inside <{parent}>"
            );
        }
    }

    #[test]
    fn dyn_text_outside_the_text_only_parents_keeps_its_markers() {
        // Negative space (P5): the rule is four exact names, not a prefix or
        // substring match, and not every element with special parsing.
        for parent in ["pre", "option", "span", "titles", "xtextarea", "noscript"] {
            let mut page = Page::new();
            let value = page.slot(text("hello"));
            page.open(parent, &[]).dyn_text(value).close(parent);
            assert_eq!(
                page.render(),
                format!("<{parent}><!--f:t0-->hello<!--/f:t0--></{parent}>"),
                "inside <{parent}>"
            );
        }
    }

    #[test]
    fn an_empty_value_in_a_text_only_parent_writes_nothing() {
        // The zero-width space exists so a marker pair encloses a Text node.
        // With no markers it would only become part of the control's value.
        let mut page = Page::new();
        let inside = page.slot(text(""));
        let outside = page.slot(text(""));
        page.open("textarea", &[])
            .dyn_text(inside)
            .close("textarea")
            .open("p", &[])
            .dyn_text(outside)
            .close("p");
        assert_eq!(
            page.render(),
            "<textarea></textarea><p><!--f:t1-->\u{200B}<!--/f:t1--></p>"
        );
    }

    #[test]
    fn a_textarea_doubles_a_leading_line_feed() {
        // The parser drops one LF straight after `<textarea>` (CR and CRLF are
        // LF by then). The marker used to shield it; without one, the first
        // line of the value would be lost before JavaScript runs.
        fn textarea(build: impl FnOnce(&mut Page)) -> String {
            let mut page = Page::new();
            page.open("textarea", &[]);
            build(&mut page);
            page.close("textarea");
            page.render()
        }
        let cases: [(&str, String, &str); 5] = [
            (
                "a dynamic value",
                textarea(|p| {
                    let v = p.slot(text("\nhello"));
                    p.dyn_text(v);
                }),
                "<textarea>\n\nhello</textarea>",
            ),
            (
                "a CRLF value",
                textarea(|p| {
                    let v = p.slot(text("\r\nhello"));
                    p.dyn_text(v);
                }),
                // Rule 1 (FORMA-182): the CRLF is written as LF, and that
                // initial LF is the one doubled.
                "<textarea>\n\nhello</textarea>",
            ),
            (
                "an empty value first: the first written byte decides",
                textarea(|p| {
                    let empty = p.slot(text(""));
                    let v = p.slot(text("\nx"));
                    p.dyn_text(empty).dyn_text(v);
                }),
                "<textarea>\n\nx</textarea>",
            ),
            (
                "an LF after other content is kept as is",
                textarea(|p| {
                    let v = p.slot(text("\nb"));
                    p.text("a").dyn_text(v);
                }),
                "<textarea>a\nb</textarea>",
            ),
            (
                "static text",
                textarea(|p| {
                    p.text("\nstatic");
                }),
                "<textarea>\n\nstatic</textarea>",
            ),
        ];
        for (case, html, expected) in cases {
            assert_eq!(html, expected, "{case}");
        }

        // The rule is the textarea's alone: the parser drops no LF in a title.
        let mut page = Page::new();
        let v = page.slot(text("\nhello"));
        page.open("title", &[]).dyn_text(v).close("title");
        assert_eq!(page.render(), "<title>\nhello</title>");
    }

    #[test]
    fn no_marker_kind_is_written_inside_a_text_only_parent() {
        // SHOW_IF still chooses its branch and LIST still repeats its body;
        // only their markers go. The same SHOW_IF in a `p` keeps them.
        let mut page = Page::new();
        let loading = page.slot(SlotValue::Bool(false));
        let name = page.slot(text("Ada"));
        let tags = page.slot(SlotValue::array(vec![text("x"), text("y")]));
        let tag = page.slot(SlotValue::Null);
        page.open("title", &[])
            .show_if(
                loading,
                |p| {
                    p.text("Loading");
                },
                |p| {
                    p.dyn_text(name);
                },
            )
            .text(" | ")
            .list(tags, tag, |p| {
                p.dyn_text(tag).text(";");
            })
            .close("title")
            .open("p", &[])
            .show_if(
                loading,
                |p| {
                    p.text("Loading");
                },
                |p| {
                    p.dyn_text(name);
                },
            )
            .close("p");
        assert_eq!(
            page.render(),
            "<title>Ada | x;y;</title>\
             <p><!--f:s0--><!--f:t1-->Ada<!--/f:t1--><!--/f:s0--></p>"
        );

        // An island marker would be text too.
        let mut page = Page::new();
        page.open("textarea", &[])
            .island(0, |p| {
                p.text("x");
            })
            .close("textarea")
            .island(1, |p| {
                p.open("div", &[]).close("div");
            });
        assert_eq!(
            page.render(),
            "<textarea>x</textarea><!--f:i1--><div data-forma-island=\"1\" \
             data-forma-component=\"Island1\" data-forma-status=\"pending\" \
             data-forma-hydrate=\"load\" data-forma-state=\"1\" data-forma-h=\"0101010101010101\"></div><!--/f:i1-->"
        );
    }

    #[test]
    fn a_textarea_value_binding_is_written_as_its_text() {
        // `<textarea value>` is a property: HTML ignores the attribute, so the
        // server shipped an empty control. The client writes
        // `value == null ? '' : String(value)`, and so does the walker.
        let cases = [
            (text("hello"), "hello"),
            (
                text("</textarea><script>x</script>"),
                "&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;",
            ),
            (text("\nhello"), "\n\nhello"),
            (SlotValue::Null, ""),
            (SlotValue::Number(0.0), "0"),
            (SlotValue::Bool(false), "false"),
        ];
        for (value, inner) in cases {
            let mut page = Page::new();
            let v = page.slot(value.clone());
            let note = page.slot(text("note"));
            page.open("textarea", &[("name", "t")])
                .dyn_attr("value", v)
                .close("textarea")
                .open("p", &[])
                .dyn_text(note)
                .close("p");
            assert_eq!(
                page.render(),
                format!(
                    "<textarea name=\"t\">{inner}</textarea><p><!--f:t1-->note<!--/f:t1--></p>"
                ),
                "value {value:?}"
            );
        }

        // The static form, `<textarea value="hello">`, is the same property.
        let mut page = Page::new();
        page.open("textarea", &[("name", "t"), ("value", "hello")])
            .close("textarea");
        assert_eq!(page.render(), "<textarea name=\"t\">hello</textarea>");
    }

    #[test]
    fn a_textarea_value_binding_wins_over_its_children() {
        // The live control shows the bound value whatever its children say,
        // so the server writes the value and not the children.
        let mut page = Page::new();
        let v = page.slot(text("bound"));
        let child = page.slot(text("child"));
        page.open("textarea", &[])
            .dyn_attr("value", v)
            .dyn_text(child)
            .text(" default")
            .close("textarea")
            .open("p", &[])
            .dyn_text(child)
            .close("p");
        assert_eq!(
            page.render(),
            "<textarea>bound</textarea><p><!--f:t1-->child<!--/f:t1--></p>"
        );
    }

    /// `<select name="c" value={value}>` over options a, b and c, each label
    /// distinct from its value so a match on the wrong one shows.
    fn select_page(value: SlotValue) -> String {
        let mut page = Page::new();
        let v = page.slot(value);
        page.open("select", &[("name", "c")]).dyn_attr("value", v);
        for (value, label) in [("a", "Apple"), ("b", "Banana"), ("c", "Cherry")] {
            page.open("option", &[("value", value)])
                .text(label)
                .close("option");
        }
        page.close("select");
        page.render()
    }

    fn option(value: &str, label: &str, selected: bool) -> String {
        let selected = if selected { " selected" } else { "" };
        format!("<option value=\"{value}\"{selected}>{label}</option>")
    }

    #[test]
    fn a_select_value_binding_selects_the_matching_option() {
        // HTML ignores `value` on a select, so the server used to ship the
        // first option selected, and a form submitted it before JavaScript.
        for (value, chosen) in [("a", "a"), ("b", "b"), ("c", "c"), ("z", "")] {
            let expected = format!(
                "<select name=\"c\">{}{}{}</select>",
                option("a", "Apple", chosen == "a"),
                option("b", "Banana", chosen == "b"),
                option("c", "Cherry", chosen == "c"),
            );
            assert_eq!(select_page(text(value)), expected, "value {value}");
        }
    }

    #[test]
    fn a_select_value_binding_compares_as_the_client_string() {
        // `String(2)` is "2"; `null` is '' (the placeholder option).
        for (value, chosen) in [(SlotValue::Number(2.0), "2"), (SlotValue::Null, "")] {
            let mut page = Page::new();
            let v = page.slot(value.clone());
            page.open("select", &[]).dyn_attr("value", v);
            for (value, label) in [("", "Choose"), ("1", "One"), ("2", "Two")] {
                page.open("option", &[("value", value)])
                    .text(label)
                    .close("option");
            }
            page.close("select");
            // An empty static attribute is written bare (`emit_open_tag`).
            let placeholder = if chosen.is_empty() {
                "<option value selected>Choose</option>"
            } else {
                "<option value>Choose</option>"
            };
            let expected = format!(
                "<select>{placeholder}{}{}</select>",
                option("1", "One", chosen == "1"),
                option("2", "Two", chosen == "2"),
            );
            assert_eq!(page.render(), expected, "value {value:?}");
        }
    }

    #[test]
    fn a_select_value_binding_matches_an_option_without_a_value_by_its_text() {
        // An option without `value` is valued by its text, stripped and
        // collapsed: `<option> Dark \n green </option>` is "Dark green".
        let render = |value: &str| {
            let mut page = Page::new();
            let v = page.slot(text(value));
            let label = page.slot(text("Blue"));
            page.open("select", &[])
                .dyn_attr("value", v)
                .open("option", &[])
                .text("Red")
                .close("option")
                .open("option", &[])
                .text(" Dark \n  green ")
                .close("option")
                .open("option", &[])
                .dyn_text(label)
                .close("option")
                .close("select");
            page.render()
        };
        assert_eq!(
            render("Dark green"),
            "<select><option>Red</option><option selected> Dark \n  green </option>\
             <option><!--f:t1-->Blue<!--/f:t1--></option></select>"
        );
        assert_eq!(
            render("Blue"),
            "<select><option>Red</option><option> Dark \n  green </option>\
             <option selected><!--f:t1-->Blue<!--/f:t1--></option></select>"
        );
    }

    #[test]
    fn a_select_value_binding_reaches_options_rendered_by_a_list() {
        // A combination (P2): list rows, PROP, a dynamic attribute and the
        // select. Labels differ from values, so an option that lost its
        // `value` and fell back to its text would match nothing. Three rows,
        // then 45 with the match past row 32 (TESTING.md P4's depth floor).
        let short: Vec<(String, String)> = [("a", "Apple"), ("b", "Banana"), ("c", "Cherry")]
            .iter()
            .map(|(id, label)| (id.to_string(), label.to_string()))
            .collect();
        let long: Vec<(String, String)> = (0..45)
            .map(|i| (format!("r{i}"), format!("Row {i}")))
            .collect();
        let cases: [(&[(String, String)], &str, usize); 4] = [
            (&short, "a", 0),
            (&short, "c", 2),
            (&long, "r40", 40),
            (&long, "r44", 44),
        ];
        for (rows_in, value, chosen) in cases {
            let mut page = Page::new();
            let v = page.slot(text(value));
            let rows = rows_in
                .iter()
                .map(|(id, label)| {
                    SlotValue::object(vec![
                        ("id".to_string(), text(id)),
                        ("label".to_string(), text(label)),
                    ])
                })
                .collect();
            let items = page.slot(SlotValue::array(rows));
            let item = page.slot(SlotValue::Null);
            let id = page.slot(SlotValue::Null);
            let label = page.slot(SlotValue::Null);
            page.open("select", &[])
                .dyn_attr("value", v)
                .list(items, item, |p| {
                    p.prop(item, "id", id)
                        .prop(item, "label", label)
                        .open("option", &[])
                        .dyn_attr("value", id)
                        .dyn_text(label)
                        .close("option");
                })
                .close("select");
            let expected: String = rows_in
                .iter()
                .enumerate()
                .map(|(i, (id, label))| {
                    let selected = if i == chosen { " selected" } else { "" };
                    format!(
                        "<option value=\"{id}\"{selected}><!--f:t4-->{label}<!--/f:t4--></option>"
                    )
                })
                .collect();
            assert_eq!(
                page.render(),
                format!("<select><!--f:l1-->{expected}<!--/f:l1--></select>"),
                "value {value}"
            );
        }
    }

    #[test]
    fn a_select_binding_ends_with_its_select() {
        // A `datalist` option after a bound select is a suggestion, not a
        // choice: the binding must not reach it. The select has no option
        // valued "b", so its single match is still unspent when the datalist
        // opens; only ending the binding at `</select>` keeps it off.
        let mut page = Page::new();
        let v = page.slot(text("b"));
        page.open("select", &[])
            .dyn_attr("value", v)
            .open("option", &[("value", "a")])
            .text("A")
            .close("option")
            .close("select")
            .open("datalist", &[])
            .open("option", &[("value", "b")])
            .text("B")
            .close("option")
            .close("datalist");
        assert_eq!(
            page.render(),
            format!(
                "<select>{}</select><datalist>{}</datalist>",
                option("a", "A", false),
                option("b", "B", false)
            )
        );
    }

    #[test]
    fn an_options_first_value_attribute_is_its_value() {
        // `<option value="a" value="b">`: the parser keeps the first of two
        // same-named attributes, so the option's value is "a".
        for (bound, selected) in [("a", " selected"), ("b", "")] {
            let mut page = Page::new();
            let v = page.slot(text(bound));
            let second = page.slot(text("b"));
            page.open("select", &[])
                .dyn_attr("value", v)
                .open("option", &[("value", "a")])
                .dyn_attr("value", second)
                .text("Only")
                .close("option")
                .close("select");
            assert_eq!(
                page.render(),
                format!("<select><option value=\"a\" value=\"b\"{selected}>Only</option></select>"),
                "bound to {bound}"
            );
        }
    }

    #[test]
    fn multiple_counts_only_when_the_attribute_is_written() {
        // A `DYN_ATTR multiple` that is false writes no attribute, so the
        // select is single and an array value is `String(array)`, "a,c",
        // which matches none of these options. True writes it, and the
        // array then selects each member.
        for (multiple, attr, chosen) in [
            (SlotValue::Bool(false), "", false),
            (SlotValue::Bool(true), " multiple", true),
            (SlotValue::Text(String::new()), "", false),
            (SlotValue::Number(0.0), "", false),
            (SlotValue::Number(-0.0), "", false),
            (SlotValue::Text("false".into()), " multiple", true),
            (SlotValue::Number(1.0), " multiple", true),
        ] {
            let mut page = Page::new();
            let flag = page.slot(multiple.clone());
            let v = page.slot(SlotValue::array(vec![text("a"), text("c")]));
            page.open("select", &[])
                .dyn_attr("multiple", flag)
                .dyn_attr("value", v);
            for (value, label) in [("a", "Apple"), ("b", "Banana"), ("c", "Cherry")] {
                page.open("option", &[("value", value)])
                    .text(label)
                    .close("option");
            }
            page.close("select");
            assert_eq!(
                page.render(),
                format!(
                    "<select{attr}>{}{}{}</select>",
                    option("a", "Apple", chosen),
                    option("b", "Banana", false),
                    option("c", "Cherry", chosen)
                ),
                "multiple {multiple:?}"
            );
        }
    }

    #[test]
    fn a_null_member_of_a_multiple_value_compares_as_null() {
        // The client builds its set with `value.map(String)`, and
        // `String(null)` is "null", not '' as it is for a text hole.
        let mut page = Page::new();
        let v = page.slot(SlotValue::array(vec![SlotValue::Null, text("b")]));
        page.open("select", &[("multiple", "")])
            .dyn_attr("value", v);
        for (value, label) in [("null", "Null"), ("x", "Empty"), ("b", "Banana")] {
            page.open("option", &[("value", value)])
                .text(label)
                .close("option");
        }
        page.close("select");
        // The middle option's static value cannot be empty (it would be
        // written bare), so it is `x`; the empty-string case is the
        // placeholder in `a_select_value_binding_compares_as_the_client_string`.
        assert_eq!(
            page.render(),
            format!(
                "<select multiple>{}{}{}</select>",
                option("null", "Null", true),
                option("x", "Empty", false),
                option("b", "Banana", true)
            )
        );
    }

    #[test]
    fn an_option_ends_at_the_next_option_or_optgroup() {
        // `</option>` is optional: the parser ends an option at the next
        // `<option>` or `<optgroup>`, and an option valued by its text is
        // valued by the text up to there.
        let mut page = Page::new();
        let v = page.slot(text("A"));
        page.open("select", &[])
            .dyn_attr("value", v)
            .open("option", &[])
            .text("A")
            .open("option", &[])
            .text("B")
            .close("select");
        assert_eq!(
            page.render(),
            "<select><option selected>A<option>B</select>",
            "ended by <option>"
        );

        let mut page = Page::new();
        let v = page.slot(text("A"));
        page.open("select", &[])
            .dyn_attr("value", v)
            .open("option", &[])
            .text("A")
            .open("optgroup", &[("label", "g")])
            .open("option", &[("value", "x")])
            .text("X")
            .close("option")
            .close("optgroup")
            .close("select");
        assert_eq!(
            page.render(),
            "<select><option selected>A<optgroup label=\"g\">\
             <option value=\"x\">X</option></optgroup></select>",
            "ended by <optgroup>"
        );
    }

    #[test]
    fn a_single_select_selects_only_the_first_matching_option() {
        // `select.value = v` selects the first option with that value. Two
        // `selected` options would let the parser keep the last instead.
        let mut page = Page::new();
        let v = page.slot(text("b"));
        page.open("select", &[])
            .dyn_attr("value", v)
            .open("option", &[("value", "b")])
            .text("First")
            .close("option")
            .open("option", &[("value", "b")])
            .text("Second")
            .close("option")
            .close("select");
        assert_eq!(
            page.render(),
            format!(
                "<select>{}{}</select>",
                option("b", "First", true),
                option("b", "Second", false)
            )
        );
    }

    #[test]
    fn a_multiple_select_selects_every_option_in_an_array_value() {
        // The client selects each option whose value is in the array, for a
        // `multiple` select only. A single select takes `String(array)`,
        // "a,c", which matches none of these options.
        let render = |attrs: &[(&str, &str)]| {
            let mut page = Page::new();
            let v = page.slot(SlotValue::array(vec![text("a"), text("c")]));
            page.open("select", attrs).dyn_attr("value", v);
            for (value, label) in [("a", "Apple"), ("b", "Banana"), ("c", "Cherry")] {
                page.open("option", &[("value", value)])
                    .text(label)
                    .close("option");
            }
            page.close("select");
            page.render()
        };
        assert_eq!(
            render(&[("multiple", "")]),
            format!(
                "<select multiple>{}{}{}</select>",
                option("a", "Apple", true),
                option("b", "Banana", false),
                option("c", "Cherry", true)
            )
        );
        assert_eq!(
            render(&[]),
            format!(
                "<select>{}{}{}</select>",
                option("a", "Apple", false),
                option("b", "Banana", false),
                option("c", "Cherry", false)
            )
        );
    }

    #[test]
    fn a_bound_select_overrides_authored_selected_on_its_options() {
        // The binding decides, as it does on the client. An unbound select
        // keeps what the author wrote, static and dynamic.
        let render = |bound: bool| {
            let mut page = Page::new();
            let v = page.slot(text("a"));
            let on = page.slot(SlotValue::Bool(true));
            page.open("select", &[]);
            if bound {
                page.dyn_attr("value", v);
            }
            page.open("option", &[("value", "a")])
                .text("A")
                .close("option")
                .open("option", &[("value", "b"), ("selected", "")])
                .text("B")
                .close("option")
                .open("option", &[("value", "c")])
                .dyn_attr("selected", on)
                .text("C")
                .close("option")
                .close("select");
            page.render()
        };
        assert_eq!(
            render(true),
            format!(
                "<select>{}{}{}</select>",
                option("a", "A", true),
                option("b", "B", false),
                option("c", "C", false)
            )
        );
        assert_eq!(
            render(false),
            format!(
                "<select>{}{}{}</select>",
                option("a", "A", false),
                option("b", "B", true),
                option("c", "C", true)
            )
        );
    }

    #[test]
    fn a_static_select_value_attribute_selects_its_option() {
        let mut page = Page::new();
        page.open("select", &[("value", "b")])
            .open("option", &[("value", "a")])
            .text("A")
            .close("option")
            .open("option", &[("value", "b")])
            .text("B")
            .close("option")
            .close("select");
        assert_eq!(
            page.render(),
            format!(
                "<select>{}{}</select>",
                option("a", "A", false),
                option("b", "B", true)
            )
        );
    }

    #[test]
    fn the_context_rules_hold_in_an_island_fragment() {
        // The internal fragment path must write what the
        // full page writes for the same island (P2).
        let mut page = Page::new();
        let body = page.slot(text("hello"));
        let choice = page.slot(text("b"));
        page.island(0, |p| {
            p.open("form", &[])
                .open("textarea", &[])
                .dyn_text(body)
                .close("textarea")
                .open("select", &[])
                .dyn_attr("value", choice)
                .open("option", &[("value", "a")])
                .text("A")
                .close("option")
                .open("option", &[("value", "b")])
                .text("B")
                .close("option")
                .close("select")
                .close("form");
        });
        let inner = format!(
            "<textarea>hello</textarea><select>{}{}</select>",
            option("a", "A", false),
            option("b", "B", true)
        );
        let full = page.render();
        let fragment = page.render_island(0);
        for (path, html) in [("walk_to_html", &full), ("walk_island", &fragment)] {
            assert!(html.contains(&inner), "{path}: {html}");
        }
        assert!(
            full.starts_with("<!--f:i0--><form data-forma-island=\"0\""),
            "{full}"
        );
    }

    // -- Counted walk (FORMA-120) -------------------------------------------

    /// A "Branding" island: `<div>` + the tenant's name + one `<i>` per colour.
    ///
    /// Strings: 0 div, 1 Branding, 2 i, 3 name, 4 colors, 5 color.
    /// Slots: 0 name (text), 1 colors (array), 2 color (the row's item).
    fn branding_module() -> IrModule {
        let mut row = encode_open_tag(2, &[]);
        row.extend_from_slice(&encode_dyn_text(2, 1));
        row.extend_from_slice(&encode_close_tag(2));
        let mut ops = encode_island_start(0);
        ops.extend_from_slice(&encode_open_tag(0, &[]));
        ops.extend_from_slice(&encode_dyn_text(0, 0));
        ops.extend_from_slice(&encode_list(1, 2, &row));
        ops.extend_from_slice(&encode_close_tag(0));
        ops.extend_from_slice(&encode_island_end(0));
        let data = build_declared_fixture(
            &["div", "Branding", "i", "name", "colors", "color"],
            &[
                (0, 3, 0x01, 0x00, &[]),
                (1, 4, 0x04, 0x00, &[]),
                (2, 5, 0x01, 0x01, &[]),
            ],
            &ops,
            &[(0, 0x01, 0x01, 1, 0, &[])],
        );
        IrModule::parse(&data).unwrap()
    }

    fn branding(name: &str, colors: usize) -> SlotData {
        let mut slots = SlotData::new(3);
        slots.set(0, SlotValue::Text(name.to_string()));
        slots.set(
            1,
            SlotValue::array(
                (0..colors)
                    .map(|i| SlotValue::Text(format!("c{i}")))
                    .collect(),
            ),
        );
        slots
    }

    #[test]
    fn counted_walk_writes_what_walk_to_html_writes_and_counts_it() {
        let module = branding_module();
        let slots = branding("Acme", 3);
        let out = walk_to_html_counted(&module, &slots, WalkLimits::default()).unwrap();

        assert_eq!(out.html, walk_to_html(&module, &slots).unwrap());
        assert_eq!(out.counts.bytes, out.html.len());
        // div + the name's text + 3 x (i + its text) = 8 nodes; markers and
        // comments are not nodes.
        assert_eq!(out.counts.nodes, 8);
        assert_eq!(out.counts.list_iterations, 3);
    }

    #[test]
    fn counted_walk_returns_the_counts_reached_when_a_budget_stops_it() {
        let module = branding_module();

        // The list budget: 5 rows allowed, 9 asked for. The list is refused
        // before its first row (FORMA-122): the div and the name were written.
        let limits = WalkLimits {
            max_list_iterations: 5,
            ..WalkLimits::default()
        };
        let failure = walk_to_html_counted(&module, &branding("Acme", 9), limits).unwrap_err();
        assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 5 });
        assert_eq!(failure.counts.list_iterations, 0);
        assert_eq!(failure.counts.nodes, 2);
        assert_eq!(failure.component_path, vec!["Branding".to_string()]);
        assert!(failure.counts.bytes > 0);

        // The output budget, set to stop the walk part-way down the list: it
        // stops inside the limit, never past it, and says how far it got.
        let limits = WalkLimits {
            max_output_bytes: 400,
            ..WalkLimits::default()
        };
        let failure = walk_to_html_counted(&module, &branding("Acme", 50), limits).unwrap_err();
        assert_eq!(failure.error, IrError::OutputLimitExceeded { limit: 400 });
        let counts = failure.counts;
        assert!(counts.bytes <= 400 && counts.bytes > 300, "{counts:?}");
        assert!(
            counts.list_iterations > 1 && counts.list_iterations < 50,
            "{counts:?}"
        );
        assert!(
            counts.nodes >= 2 + 2 * (counts.list_iterations - 1),
            "{counts:?}"
        );
        assert_eq!(failure.component_path, vec!["Branding".to_string()]);
    }

    #[test]
    fn counted_walk_names_no_component_for_a_failure_outside_every_island() {
        // Invalid HTML names remain a render error; bad indices now fail at load.
        let mut ops = encode_open_tag(0, &[]);
        ops.extend_from_slice(&encode_open_tag(1, &[]));
        let data = build_declared_fixture(&["p", "bad name"], &[], &ops, &[]);
        let module = IrModule::parse(&data).unwrap();
        let failure =
            walk_to_html_counted(&module, &SlotData::new(0), WalkLimits::default()).unwrap_err();
        assert_eq!(failure.error, IrError::InvalidName("bad name".into()));
        assert!(failure.component_path.is_empty());
        assert_eq!(failure.counts.nodes, 1);
    }

    #[test]
    fn counted_walk_names_every_island_around_a_failure_outermost_first() {
        // Outer "Shell" > inner "Card", the failure inside "Card", and a
        // closed sibling island before it that must not appear in the path.
        // Strings: 0 div, 1 Shell, 2 Card, 3 Done, 4 x.
        let mut ops = encode_island_start(0); // Shell, at byte 0
        ops.extend_from_slice(&encode_open_tag(0, &[]));
        let done_at = ops.len() as u32;
        ops.extend_from_slice(&encode_island_start(2)); // Done
        ops.extend_from_slice(&encode_open_tag(0, &[]));
        ops.extend_from_slice(&encode_close_tag(0));
        ops.extend_from_slice(&encode_island_end(2));
        let card_at = ops.len() as u32;
        ops.extend_from_slice(&encode_island_start(1)); // Card
        ops.extend_from_slice(&encode_open_tag(0, &[]));
        ops.extend_from_slice(&encode_open_tag(4, &[])); // invalid HTML name fails here
        ops.extend_from_slice(&encode_close_tag(0));
        ops.extend_from_slice(&encode_island_end(1));
        ops.extend_from_slice(&encode_close_tag(0));
        ops.extend_from_slice(&encode_island_end(0));
        let data = build_declared_fixture(
            &["div", "Shell", "Card", "Done", "bad name"],
            &[],
            &ops,
            &[
                (0, 0x01, 0x01, 1, 0, &[]),
                (1, 0x01, 0x01, 2, card_at, &[]),
                (2, 0x01, 0x01, 3, done_at, &[]),
            ],
        );
        let module = IrModule::parse(&data).unwrap();
        let failure =
            walk_to_html_counted(&module, &SlotData::new(0), WalkLimits::default()).unwrap_err();
        assert_eq!(
            failure.component_path,
            vec!["Shell".to_string(), "Card".to_string()]
        );
    }

    #[test]
    fn the_fault_trigger_is_armed_only_by_the_counted_walk() {
        // With the trigger compiled in (this crate's tests), the uncaught
        // 0.2.1 path renders the value as text; only the counted walk, which
        // catches the panic, ever takes it.
        let module = branding_module();
        let slots = branding(crate::fault_injection::FAULT_TRIGGER, 1);
        let html = walk_to_html(&module, &slots).expect("walk_to_html never arms it");
        assert!(html.contains("forma-test-fault"), "{html}");
        let failure = walk_to_html_counted(&module, &slots, WalkLimits::default()).unwrap_err();
        assert!(matches!(failure.error, IrError::Panicked { .. }));
    }

    #[test]
    fn counted_walk_catches_a_panic_and_names_its_island() {
        // SR44's stand-in: a component that panics on one tenant's data. The
        // trigger exists only in test builds and under the internal
        // `__fault-injection` feature.
        let module = branding_module();
        let slots = branding(crate::fault_injection::FAULT_TRIGGER, 2);
        let failure = walk_to_html_counted(&module, &slots, WalkLimits::default()).unwrap_err();
        match &failure.error {
            IrError::Panicked { message } => {
                assert!(message.contains("stand-in"), "{message}")
            }
            other => panic!("expected Panicked, got {other:?}"),
        }
        assert_eq!(failure.component_path, vec!["Branding".to_string()]);
        // ...and the next walk, on the same module, renders.
        let out =
            walk_to_html_counted(&module, &branding("Acme", 2), WalkLimits::default()).unwrap();
        assert!(out.html.contains("Acme"));
    }

    // -- A list's length checked before its first row (FORMA-122, DR-13) ------

    /// `<div>` around one LIST per entry of `lists`, each over its own slot
    /// (slot 2k, item slot 2k+1) and writing `<i>` + the item per row; a list
    /// may nest an inner LIST over the item slot's array.
    fn lists_module(lists: usize, nested: bool) -> IrModule {
        let mut ops = encode_open_tag(0, &[]);
        let mut slots: Vec<(u16, u32, u8, u8, &[u8])> = Vec::new();
        for k in 0..lists as u16 {
            let (list_slot, item_slot) = (2 * k, 2 * k + 1);
            let mut row = encode_open_tag(1, &[]);
            if nested {
                // the inner list iterates the row's item, itself an array,
                // binding its rows to slot 2*lists (shared, rebound per row)
                let inner_item = 2 * lists as u16;
                let mut inner_row = encode_open_tag(1, &[]);
                inner_row.extend_from_slice(&encode_close_tag(1));
                row.extend_from_slice(&encode_list(item_slot, inner_item, &inner_row));
            }
            row.extend_from_slice(&encode_close_tag(1));
            ops.extend_from_slice(&encode_list(list_slot, item_slot, &row));
            slots.push((list_slot, 2, 0x04, 0x00, &[]));
            slots.push((item_slot, 3, if nested { 0x04 } else { 0x01 }, 0x00, &[]));
        }
        if nested {
            slots.push((2 * lists as u16, 3, 0x01, 0x00, &[]));
        }
        ops.extend_from_slice(&encode_close_tag(0));
        let data = build_declared_fixture(&["div", "i", "items", "item"], &slots, &ops, &[]);
        IrModule::parse(&data).unwrap()
    }

    fn rows(n: usize) -> SlotValue {
        SlotValue::array((0..n).map(|_| SlotValue::Text("x".into())).collect())
    }

    fn limits(max_list_iterations: usize) -> WalkLimits {
        WalkLimits {
            max_list_iterations,
            ..WalkLimits::default()
        }
    }

    #[test]
    fn a_list_longer_than_the_remaining_budget_fails_before_its_first_row() {
        // SR38: one row too many, and not one row is walked.
        let module = lists_module(1, false);
        let mut slots = SlotData::new(2);
        slots.set(0, rows(51));
        let failure = walk_to_html_counted(&module, &slots, limits(50)).unwrap_err();
        assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 50 });
        assert_eq!(failure.counts.list_iterations, 0);
        assert_eq!(failure.counts.nodes, 1, "only the wrapping div was written");

        // The negative space: exactly the budget renders, every row.
        slots.set(0, rows(50));
        let out = walk_to_html_counted(&module, &slots, limits(50)).unwrap();
        assert_eq!(out.counts.list_iterations, 50);
        assert_eq!(out.html.matches("<i>").count(), 50);
    }

    #[test]
    fn a_list_exactly_at_the_remaining_budget_still_renders() {
        // The budget is per render: a first list spends 20 of 50 rows, so a
        // second of exactly 30 renders and one of 31 fails before its first.
        let module = lists_module(2, false);
        let mut slots = SlotData::new(4);
        slots.set(0, rows(20));
        slots.set(2, rows(30));
        let out = walk_to_html_counted(&module, &slots, limits(50)).unwrap();
        assert_eq!(out.counts.list_iterations, 50);
        assert_eq!(out.html.matches("<i>").count(), 50);

        slots.set(2, rows(31));
        let failure = walk_to_html_counted(&module, &slots, limits(50)).unwrap_err();
        assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 50 });
        assert_eq!(
            failure.counts.list_iterations, 20,
            "the first list, and no more"
        );
        assert_eq!(failure.counts.nodes, 1 + 20);
    }

    #[test]
    fn a_nested_list_is_checked_against_what_its_parents_left() {
        // 3 outer rows of 20 inner rows each, under 59: the outer list fits
        // (3 <= 59); rows and inner rows spend 1 + 20 + 1 + 20 + 1 = 43; the
        // third inner list (20 > 16 left) fails at its entry. At 0.2.1 the
        // walk ran 16 of its rows first.
        let module = lists_module(1, true);
        let mut slots = SlotData::new(3);
        slots.set(0, SlotValue::array((0..3).map(|_| rows(20)).collect()));
        let failure = walk_to_html_counted(&module, &slots, limits(59)).unwrap_err();
        assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 59 });
        assert_eq!(failure.counts.list_iterations, 43);

        // In all, 3 outer and 60 inner rows: a budget of 63 renders, 62 does not.
        let out = walk_to_html_counted(&module, &slots, limits(63)).unwrap();
        assert_eq!(out.counts.list_iterations, 63);
        assert!(walk_to_html_counted(&module, &slots, limits(62)).is_err());
    }

    #[test]
    fn the_per_row_check_still_stops_a_list_whose_nested_rows_spend_the_budget() {
        // 3 outer rows of 11 inner rows under 24: every list fits on entry
        // (3 <= 24, 11 <= 23, 11 <= 11), and the inner rows spend the rest, so
        // the outer list's third row is the one refused, by the per-row check.
        let module = lists_module(1, true);
        let mut slots = SlotData::new(3);
        slots.set(0, SlotValue::array((0..3).map(|_| rows(11)).collect()));
        let failure = walk_to_html_counted(&module, &slots, limits(24)).unwrap_err();
        assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 24 });
        assert_eq!(failure.counts.list_iterations, 24);
    }

    // -- FORMA-182 rule 1: the shared normalization vectors ------------------
    //
    // One finite JSON file, read by this crate and by @getforma/core's suite
    // (packages/core/src/dom/__tests__/normalize-text.test.ts), so a vector
    // changed on one side fails the other. Every case walks the real opcode
    // stream through `walk_to_html`; nothing here calls a helper directly.
    // Each test collects every disagreeing vector before failing, so a first
    // run reports the whole gap, not its first line.
    mod normalization_vectors {
        use super::*;
        use serde_json::Value;

        const VECTORS: &str = include_str!("../tests/fixtures/parity/normalization.json");

        fn cases(section: &str) -> Vec<Value> {
            let all: Value = serde_json::from_str(VECTORS).unwrap();
            all[section].as_array().unwrap().clone()
        }

        fn field<'a>(case: &'a Value, key: &str) -> &'a str {
            case[key].as_str().unwrap()
        }

        fn children(case: &Value) -> Vec<String> {
            case["children"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect()
        }

        fn escape_html(text: &str) -> String {
            text.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        }

        fn escape_attr(text: &str) -> String {
            escape_html(text).replace('"', "&quot;")
        }

        /// A DYN_TEXT range as the walker writes it: an empty value is held
        /// by a zero-width space so the browser creates a Text node.
        fn marker(id: u16, text: &str) -> String {
            let inner = if text.is_empty() {
                "\u{200B}".to_string()
            } else {
                escape_html(text)
            };
            format!("<!--f:t{id}-->{inner}<!--/f:t{id}-->")
        }

        /// The text a browser would show for a marker-separated output: the
        /// marker comments and the empty-range zero-width spaces removed. No
        /// `children` vector contains a zero-width space of its own.
        fn visible(rendered: &str) -> String {
            let mut out = String::new();
            let mut rest = rendered;
            while let Some(start) = rest.find("<!--") {
                out.push_str(&rest[..start]);
                let end = rest[start..].find("-->").unwrap() + start + 3;
                rest = &rest[end..];
            }
            out.push_str(rest);
            out.replace('\u{200B}', "")
        }

        fn check(failures: &mut Vec<String>, label: &str, actual: &str, expected: &str) {
            if actual != expected {
                failures.push(format!(
                    "{label}: expected {expected:?}, walker wrote {actual:?}"
                ));
            }
        }

        fn finish(failures: Vec<String>) {
            assert!(
                failures.is_empty(),
                "{} disagreeing vector(s):\n{}",
                failures.len(),
                failures.join("\n")
            );
        }

        #[test]
        fn text_and_dyn_text_write_each_value_normalized() {
            let mut failures = Vec::new();
            for case in cases("values") {
                let (id, input, expected) = (
                    field(&case, "id"),
                    field(&case, "input"),
                    field(&case, "expected"),
                );
                let mut page = Page::new();
                let slot = page.slot(text(input));
                page.open("p", &[])
                    .text(input)
                    .close("p")
                    .open("p", &[])
                    .dyn_text(slot)
                    .close("p");
                let want = format!(
                    "<p>{}</p><p>{}</p>",
                    escape_html(expected),
                    marker(slot, expected)
                );
                check(
                    &mut failures,
                    &format!("values/{id} text+dyn_text"),
                    &page.render(),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn static_and_dynamic_attributes_write_each_value_normalized() {
            let mut failures = Vec::new();
            for case in cases("values") {
                let (id, input, expected) = (
                    field(&case, "id"),
                    field(&case, "input"),
                    field(&case, "expected"),
                );
                let mut page = Page::new();
                let slot = page.slot(text(input));
                page.open("p", &[("title", input), ("id", "ok")])
                    .close("p")
                    .open("p", &[("id", "ok")])
                    .dyn_attr("title", slot)
                    .close("p");
                let e = escape_attr(expected);
                // A static empty value is written as the bare name (the
                // walker's existing byte-stable shorthand; same DOM value).
                let static_attr = if expected.is_empty() {
                    " title".to_string()
                } else {
                    format!(" title=\"{e}\"")
                };
                let want = format!("<p{static_attr} id=\"ok\"></p><p id=\"ok\" title=\"{e}\"></p>");
                check(
                    &mut failures,
                    &format!("values/{id} attr+dyn_attr"),
                    &page.render(),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn adjacent_values_normalize_each_before_composition() {
            // `['\r', '\n']` is two line feeds and `['\r\n']` is one: the rule
            // is per authored value, so a normalizer that buffered the output
            // stream would fold the first case and fail here. Three shapes of
            // the same children: adjacent TEXT, adjacent DYN_TEXT ranges, and
            // a static first value before dynamic ones.
            let mut failures = Vec::new();
            for case in cases("children") {
                let (id, expected) = (field(&case, "id"), field(&case, "expected"));
                let values = children(&case);

                let mut page = Page::new();
                page.open("p", &[]);
                for value in &values {
                    page.text(value);
                }
                page.close("p");
                let want = format!("<p>{}</p>", escape_html(expected));
                check(
                    &mut failures,
                    &format!("children/{id} adjacent TEXT"),
                    &page.render(),
                    &want,
                );

                let mut page = Page::new();
                let slots: Vec<u16> = values.iter().map(|v| page.slot(text(v))).collect();
                page.open("p", &[]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("p");
                check(
                    &mut failures,
                    &format!("children/{id} adjacent DYN_TEXT (visible text)"),
                    &visible(&page.render()),
                    &want,
                );

                let mut page = Page::new();
                let slots: Vec<u16> = values[1..].iter().map(|v| page.slot(text(v))).collect();
                page.open("p", &[]).text(&values[0]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("p");
                check(
                    &mut failures,
                    &format!("children/{id} TEXT then DYN_TEXT (visible text)"),
                    &visible(&page.render()),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn textarea_children_protect_only_an_initial_normalized_line_feed() {
            // The parser drops one LF straight after `<textarea>`, so the
            // writer doubles an initial LF. After normalization that is the
            // only initial break there is; an empty chunk does not consume
            // the boundary, and a separate `\r` then `\n` is two values.
            let mut failures = Vec::new();
            for case in cases("textarea") {
                let (id, html) = (field(&case, "id"), field(&case, "html"));
                let values = children(&case);

                let mut page = Page::new();
                page.open("textarea", &[]);
                for value in &values {
                    page.text(value);
                }
                page.close("textarea");
                check(
                    &mut failures,
                    &format!("textarea/{id} static"),
                    &page.render(),
                    html,
                );

                let mut page = Page::new();
                let slots: Vec<u16> = values.iter().map(|v| page.slot(text(v))).collect();
                page.open("textarea", &[]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("textarea");
                check(
                    &mut failures,
                    &format!("textarea/{id} dynamic"),
                    &page.render(),
                    html,
                );
            }
            finish(failures);
        }

        #[test]
        fn url_attributes_are_checked_as_the_normalized_string_that_is_written() {
            // The URL policy classifies the raw value: a NUL anywhere in a URL
            // attribute refuses the write, a CR or CRLF inside a scheme is
            // refused as before, and an admitted value is written normalized.
            // The benign sibling attribute stays in both branches (P3).
            let mut failures = Vec::new();
            for case in cases("unsafeUrlNearMiss") {
                let (id, input) = (field(&case, "id"), field(&case, "input"));
                let attribute = case["attribute"].as_str().unwrap_or("href");
                let tag = case["tag"].as_str().unwrap_or("a");
                let refused = case["refused"].as_bool().unwrap();
                let mut page = Page::new();
                let slot = page.slot(text(input));
                page.open(tag, &[(attribute, input), ("id", "ok")])
                    .close(tag)
                    .open(tag, &[("id", "ok")])
                    .dyn_attr(attribute, slot)
                    .close(tag);
                let want = if refused {
                    format!("<{tag} id=\"ok\"></{tag}><{tag} id=\"ok\"></{tag}>")
                } else {
                    let written = escape_attr(field(&case, "written"));
                    format!(
                        "<{tag} {attribute}=\"{written}\" id=\"ok\"></{tag}>\
                         <{tag} id=\"ok\" {attribute}=\"{written}\"></{tag}>"
                    )
                };
                check(
                    &mut failures,
                    &format!("unsafeUrlNearMiss/{id}"),
                    &page.render(),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn pre_children_protect_only_an_initial_normalized_line_feed() {
            // `pre` and `listing` share the textarea rule, by output position:
            // the first content token starting with a normalized LF gets one
            // more. A DYN_TEXT writes its marker comment first, which the
            // parser treats as the first token, so the dynamic shape is never
            // doubled (`htmlDynamic`).
            let mut failures = Vec::new();
            for case in cases("pre") {
                let (id, html, dynamic) = (
                    field(&case, "id"),
                    field(&case, "html"),
                    field(&case, "htmlDynamic"),
                );
                let values = children(&case);
                for tag in ["pre", "listing", "PRE"] {
                    let mut page = Page::new();
                    page.open(tag, &[]);
                    for value in &values {
                        page.text(value);
                    }
                    page.close(tag);
                    let want = html
                        .replace("<pre>", &format!("<{tag}>"))
                        .replace("</pre>", &format!("</{tag}>"));
                    check(
                        &mut failures,
                        &format!("pre/{id} static <{tag}>"),
                        &page.render(),
                        &want,
                    );
                }
                let mut page = Page::new();
                let slots: Vec<u16> = values.iter().map(|v| page.slot(text(v))).collect();
                page.open("pre", &[]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("pre");
                check(
                    &mut failures,
                    &format!("pre/{id} dynamic"),
                    &page.render(),
                    dynamic,
                );
            }
            finish(failures);
        }

        #[test]
        fn the_pre_boundary_is_consumed_by_any_token_but_not_by_a_value_only_opcode() {
            // A child element, a conditional's marker and the closing tag of
            // an inner element are tokens: the LF after them is not the first
            // content token, so it is written once. PROP writes nothing, so
            // the boundary survives it. A sibling `pre` starts its own.
            let mut page = Page::new();
            page.open("pre", &[])
                .open("b", &[])
                .close("b")
                .text("\nx")
                .close("pre");
            assert_eq!(page.render(), "<pre><b></b>\nx</pre>");

            let mut page = Page::new();
            let shown = page.slot(SlotValue::Bool(true));
            page.open("pre", &[])
                .show_if(
                    shown,
                    |p| {
                        p.text("\nx");
                    },
                    |_| {},
                )
                .close("pre");
            let rendered = page.render();
            assert!(rendered.starts_with("<pre><!--f:s"), "{rendered:?}");
            assert!(rendered.contains("-->\nx<!--/f:s"), "{rendered:?}");
            assert!(!rendered.contains("\n\n"), "{rendered:?}");

            let mut page = Page::new();
            let object = page.slot(SlotValue::object(vec![]));
            let target = page.slot(text(""));
            page.open("pre", &[])
                .prop(object, "name", target)
                .text("\nx")
                .close("pre")
                .open("pre", &[])
                .text("\ny")
                .close("pre")
                .open("p", &[])
                .text("\nz")
                .close("p");
            assert_eq!(page.render(), "<pre>\n\nx</pre><pre>\n\ny</pre><p>\nz</p>");
        }

        #[test]
        fn the_output_budget_counts_the_normalized_and_escaped_bytes_actually_written() {
            // A top-level TEXT with no closing tag, so the budget ends inside
            // the text itself: exactly-at renders, one byte under refuses. The
            // ten-byte prefix forces the per-character slow path (worst-case
            // expansion no longer fits). Before this check a three-byte U+FFFD
            // or four-byte astral character was pushed when `out.len()` was
            // merely below the limit, overshooting it by up to three bytes.
            for (input, written) in [
                ("xxxxxxxxxx\0", "xxxxxxxxxx\u{FFFD}"),
                ("xxxxxxxxxx😀", "xxxxxxxxxx😀"),
                ("xxxxxxxxxx&", "xxxxxxxxxx&amp;"),
                ("xxxxxxxxxx\r\n", "xxxxxxxxxx\n"),
            ] {
                let mut page = Page::new();
                page.text(input);
                let (module, slots) = page.module_and_slots();
                let limits = |max_output_bytes| WalkLimits {
                    max_output_bytes,
                    ..WalkLimits::default()
                };
                let exact = written.len();
                assert_eq!(
                    walk_to_html_with_limits(&module, &slots, limits(exact)).as_deref(),
                    Ok(written),
                    "{input:?} at its exact budget"
                );
                assert_eq!(
                    walk_to_html_with_limits(&module, &slots, limits(exact - 1)),
                    Err(IrError::OutputLimitExceeded { limit: exact - 1 }),
                    "{input:?} one byte under its budget"
                );
            }
        }
    }

    // -- FORMA-182 rules 2 to 7: the shared value-rule vectors ---------------
    //
    // One JSON file per rule under tests/fixtures/parity/, each read by this
    // crate and by @getforma/core's per-rule suites (packages/core/src/dom/
    // __tests__/value-rule-<n>-*.test.ts); the compiled shapes of rules 4, 6
    // and 7 are read by @getforma/compiler's (packages/compiler/tests/
    // value-rule-<n>-*.test.ts). Every case walks the real opcode stream.
    mod value_rule_vectors {
        use super::*;
        use serde_json::Value;

        const NUMBERS: &str = include_str!("../tests/fixtures/parity/numbers.json");
        const INTEGERS: &str = include_str!("../tests/fixtures/parity/integers.json");
        const NULL: &str = include_str!("../tests/fixtures/parity/null.json");
        const BOOLEAN_TEXT: &str = include_str!("../tests/fixtures/parity/boolean-text.json");
        const CONDITIONS: &str = include_str!("../tests/fixtures/parity/conditions.json");
        const ATTRIBUTES: &str = include_str!("../tests/fixtures/parity/attributes.json");

        fn cases(file: &str, section: &str) -> Vec<Value> {
            let all: Value = serde_json::from_str(file).unwrap();
            all[section].as_array().unwrap().clone()
        }

        fn field<'a>(case: &'a Value, key: &str) -> &'a str {
            case[key].as_str().unwrap()
        }

        /// A DYN_TEXT range as the walker writes it (an empty value is held
        /// by a zero-width space).
        fn marker(id: u16, text: &str) -> String {
            let inner = if text.is_empty() {
                "\u{200B}".to_string()
            } else {
                text.to_string()
            };
            format!("<!--f:t{id}-->{inner}<!--/f:t{id}-->")
        }

        /// The text a browser shows: marker comments and the empty-range
        /// zero-width spaces removed.
        fn visible(rendered: &str) -> String {
            let mut out = String::new();
            let mut rest = rendered;
            while let Some(start) = rest.find("<!--") {
                out.push_str(&rest[..start]);
                let end = rest[start..].find("-->").unwrap() + start + 3;
                rest = &rest[end..];
            }
            out.push_str(rest);
            out.replace('\u{200B}', "")
        }

        fn check(failures: &mut Vec<String>, label: &str, actual: &str, expected: &str) {
            if actual != expected {
                failures.push(format!(
                    "{label}: expected {expected:?}, walker wrote {actual:?}"
                ));
            }
        }

        fn finish(failures: Vec<String>) {
            assert!(
                failures.is_empty(),
                "{} disagreeing vector(s):\n{}",
                failures.len(),
                failures.join("\n")
            );
        }

        /// What a vector's JSON value reads as on the page: null is empty,
        /// a string itself, a number or boolean its JSON spelling.
        fn vector_text(value: &Value) -> String {
            match value {
                Value::Null => String::new(),
                Value::String(s) => s.clone(),
                other => other.to_string(),
            }
        }

        /// A slot value from a vector's JSON value: a string, a number, a
        /// boolean or null (the shapes the vectors use).
        fn slot_value(value: &Value) -> SlotValue {
            match value {
                Value::Null => SlotValue::Null,
                Value::Bool(b) => SlotValue::Bool(*b),
                Value::Number(n) => SlotValue::Number(n.as_f64().unwrap()),
                Value::String(s) => SlotValue::Text(s.clone()),
                other => panic!("unsupported vector value {other}"),
            }
        }

        #[test]
        fn rule_2_numbers_are_written_in_ecmascript_formatting_as_text_and_attribute() {
            let mut failures = Vec::new();
            for case in cases(NUMBERS, "values") {
                let (id, lexeme, expected) = (
                    field(&case, "id"),
                    field(&case, "lexeme"),
                    field(&case, "expected"),
                );
                let number: f64 = lexeme.parse().unwrap();
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Number(number));
                page.open("p", &[]).dyn_text(slot).close("p");
                page.open("span", &[("id", "ok")])
                    .dyn_attr("title", slot)
                    .close("span");
                let want = format!(
                    "<p>{}</p><span id=\"ok\" title=\"{expected}\"></span>",
                    marker(slot, expected)
                );
                check(
                    &mut failures,
                    &format!("numbers/{id}"),
                    &page.render(),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn rule_3_an_admitted_exact_integer_is_written_as_its_decimal_digits() {
            // The admission itself is tests/page_props.rs (encode_props on
            // the integer origin). Here: an admitted value's text is exact,
            // and a float origin formats by rule 2 whatever its magnitude.
            let mut failures = Vec::new();
            for case in cases(INTEGERS, "exact") {
                if !case["admitted"].as_bool().unwrap() {
                    continue;
                }
                let (id, lexeme) = (field(&case, "id"), field(&case, "lexeme"));
                let number: f64 = lexeme.parse().unwrap();
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Number(number));
                page.open("p", &[]).dyn_text(slot).close("p");
                let want = format!("<p>{}</p>", marker(slot, lexeme));
                check(
                    &mut failures,
                    &format!("integers/exact/{id}"),
                    &page.render(),
                    &want,
                );
            }
            for case in cases(INTEGERS, "floatOrigin") {
                let (id, lexeme, expected) = (
                    field(&case, "id"),
                    field(&case, "lexeme"),
                    field(&case, "expected"),
                );
                let number: f64 = lexeme.parse().unwrap();
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Number(number));
                page.open("p", &[]).dyn_text(slot).close("p");
                let want = format!("<p>{}</p>", marker(slot, expected));
                check(
                    &mut failures,
                    &format!("integers/floatOrigin/{id}"),
                    &page.render(),
                    &want,
                );
            }
            finish(failures);
        }

        #[test]
        fn rule_5_null_writes_nothing_as_text_attribute_and_textarea_child() {
            let mut failures = Vec::new();
            for case in cases(NULL, "children") {
                let (id, expected) = (field(&case, "id"), field(&case, "expected"));
                let values = case["children"].as_array().unwrap();

                // Dynamic children: each value in its own range; a Null range
                // is held by the zero-width space and shows nothing.
                let mut page = Page::new();
                let slots: Vec<u16> = values.iter().map(|v| page.slot(slot_value(v))).collect();
                page.open("p", &[]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("p");
                let rendered = page.render();
                check(
                    &mut failures,
                    &format!("null/children/{id} dynamic (visible text)"),
                    &visible(&rendered),
                    &format!("<p>{expected}</p>"),
                );
                // The exact ranges, which the three-engine replay
                // (packages/core/e2e/value-rules.spec.ts) serves: a Null range
                // holds only the zero-width space.
                let ranges: String = slots
                    .iter()
                    .zip(values)
                    .map(|(slot, value)| marker(*slot, &vector_text(value)))
                    .collect();
                check(
                    &mut failures,
                    &format!("null/children/{id} dynamic"),
                    &rendered,
                    &format!("<p>{ranges}</p>"),
                );
                if rendered.contains("null") {
                    failures.push(format!(
                        "null/children/{id}: the word null was written: {rendered:?}"
                    ));
                }

                // Inside a textarea the same children compose to the value.
                let mut page = Page::new();
                let slots: Vec<u16> = values.iter().map(|v| page.slot(slot_value(v))).collect();
                page.open("textarea", &[]);
                for slot in &slots {
                    page.dyn_text(*slot);
                }
                page.close("textarea");
                check(
                    &mut failures,
                    &format!("null/children/{id} textarea"),
                    &page.render(),
                    &format!("<textarea>{expected}</textarea>"),
                );
            }
            for case in cases(NULL, "attribute") {
                let (id, attribute) = (field(&case, "id"), field(&case, "attribute"));
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Null);
                page.open("span", &[("id", "ok")])
                    .dyn_attr(attribute, slot)
                    .close("span");
                check(
                    &mut failures,
                    &format!("null/attribute/{id}"),
                    &page.render(),
                    "<span id=\"ok\"></span>",
                );
            }
            finish(failures);
        }

        #[test]
        fn rule_6_the_string_near_miss_writes_the_boolean_word_and_the_idiom_its_range() {
            // The build error itself is the compiler's (BUILD-614). What the
            // walker writes for the admitted `String(flag)` is DYN_TEXT on the
            // boolean slot. An attribute bound to a boolean follows rule 6's
            // attribute table, read by rule_6_attribute_values_follow_one_table.
            let mut failures = Vec::new();
            for case in cases(BOOLEAN_TEXT, "nearMissText") {
                let (id, expected) = (field(&case, "id"), field(&case, "expected"));
                let value = case["value"].as_bool().unwrap();
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Bool(value));
                page.open("p", &[]).dyn_text(slot).close("p");
                check(
                    &mut failures,
                    &format!("boolean-text/nearMissText/{id}"),
                    &page.render(),
                    &format!("<p>{}</p>", marker(slot, expected)),
                );
            }
            // The mixed idiom `() => ready() && 'Go'`: the compiler gives its
            // Text slot no default at false and the string at true.
            for case in cases(BOOLEAN_TEXT, "idiom") {
                let (id, expected) = (field(&case, "id"), field(&case, "expected"));
                let mut page = Page::new();
                let slot = page.slot(if expected.is_empty() {
                    SlotValue::Null
                } else {
                    SlotValue::Text(expected.to_string())
                });
                page.open("p", &[]).dyn_text(slot).close("p");
                check(
                    &mut failures,
                    &format!("boolean-text/idiom/{id}"),
                    &page.render(),
                    &format!("<p>{}</p>", marker(slot, expected)),
                );
            }
            finish(failures);
        }

        #[test]
        fn rule_6_attribute_values_follow_one_table() {
            // Findings F2 and F3: presence only for the HTML boolean set; any
            // other attribute is the value's string, `true` the word and `""`
            // a value; false and Null omit it.
            let mut failures = Vec::new();
            for case in cases(ATTRIBUTES, "values") {
                let (id, attribute, html) = (
                    field(&case, "id"),
                    field(&case, "attribute"),
                    field(&case, "html"),
                );
                let mut page = Page::new();
                let slot = page.slot(slot_value(&case["value"]));
                page.open("input", &[("id", "ok")])
                    .dyn_attr(attribute, slot)
                    .close("input");
                check(
                    &mut failures,
                    &format!("attributes/values/{id}"),
                    &page.render(),
                    &format!("<input id=\"ok\"{html}></input>"),
                );
            }
            // The walker's boolean set is the vector's: each member is bare for
            // true, and a name beside each (its `data-` twin) is the word.
            for name in cases(ATTRIBUTES, "booleanAttributes") {
                let name = name.as_str().unwrap();
                for (attribute, want) in [
                    (name.to_string(), format!(" {name}")),
                    (format!("data-{name}"), format!(" data-{name}=\"true\"")),
                ] {
                    let mut page = Page::new();
                    let slot = page.slot(SlotValue::Bool(true));
                    page.open("input", &[("id", "ok")])
                        .dyn_attr(&attribute, slot)
                        .close("input");
                    check(
                        &mut failures,
                        &format!("attributes/booleanAttributes/{attribute}"),
                        &page.render(),
                        &format!("<input id=\"ok\"{want}></input>"),
                    );
                }
            }
            finish(failures);
        }

        #[test]
        fn rule_7_a_boolean_condition_selects_the_branch() {
            // The type refusal itself is the compiler's (BUILD-615); a
            // compiled SHOW_IF reads a Bool slot, and its range is what core's
            // suite and the three-engine replay adopt.
            let mut failures = Vec::new();
            for case in cases(CONDITIONS, "walker") {
                let (id, branch) = (field(&case, "id"), field(&case, "branch"));
                let value = case["value"].as_bool().unwrap();
                let mut page = Page::new();
                let slot = page.slot(SlotValue::Bool(value));
                page.open("div", &[])
                    .show_if(
                        slot,
                        |p| {
                            p.open("b", &[]).text("then").close("b");
                        },
                        |p| {
                            p.open("i", &[]).text("else").close("i");
                        },
                    )
                    .close("div");
                let inner = if branch == "then" {
                    "<b>then</b>"
                } else {
                    "<i>else</i>"
                };
                check(
                    &mut failures,
                    &format!("conditions/walker/{id}"),
                    &page.render(),
                    &format!("<div><!--f:s{slot}-->{inner}<!--/f:s{slot}--></div>"),
                );
            }
            finish(failures);
        }
    }

    /// FORMA-181 checkpoint B: keyed rows. Hand-built modules with a real FMIR section
    /// `0x0006`, so the walker's own refusals (RENDER-503) are reached without the
    /// compiler's source proof in front of them, and the unkeyed low-level form is pinned
    /// beside each keyed case.
    mod keyed_rows {
        use super::*;
        use crate::format::{ListKeyReason, ListKeyViolation};
        use crate::parser::test_helpers::with_key_paths;

        const STRINGS: &[&str] = &[
            "rows",           // 0
            "row",            // 1
            "li",             // 2
            "id",             // 3
            "span",           // 4
            "label",          // 5
            "input",          // 6
            "type",           // 7
            "checkbox",       // 8
            "data-forma-key", // 9
            "authored",       // 10
            "tags",           // 11
            "b",              // 12
            "Child",          // 13
            "ul",             // 14
            "DATA-FORMA-KEY", // 15
            "text",           // 16
            "user",           // 17
            "tag",            // 18
        ];
        const LI: u32 = 2;
        const ID: u32 = 3;
        const SPAN: u32 = 4;
        const INPUT: u32 = 6;
        const TYPE: u32 = 7;
        const CHECKBOX: u32 = 8;
        const KEY_ATTR: u32 = 9;
        const AUTHORED: u32 = 10;
        const TAGS: u32 = 11;
        const B: u32 = 12;
        const CHILD: u32 = 13;
        const UL: u32 = 14;
        const KEY_ATTR_UPPER: u32 = 15;
        const TEXT: u32 = 16;
        const USER: u32 = 17;
        /// rows (0), row (1), tags (2, read from the row), tag (3), label (4). The row
        /// slots are client-sourced so the declared-fixture builder leaves them out of the
        /// page schema it writes for the island cases (it encodes scalars only).
        const SLOTS: &[(u16, u32, u8, u8, &[u8])] = &[
            (0, 0, 0x04, 0x00, &[]),
            (1, 1, 0x05, 0x01, &[]),
            (2, 11, 0x04, 0x01, &[]),
            (3, 18, 0x05, 0x01, &[]),
            (4, 5, 0x01, 0x00, &[]),
        ];
        /// A LIST's header: opcode, array slot, item slot, body length.
        const LIST_HEADER: usize = 9;

        fn keyed(opcodes: &[u8], paths: &[(u32, &[u32])]) -> IrModule {
            let base = build_declared_fixture(STRINGS, SLOTS, opcodes, &[]);
            IrModule::parse(&with_key_paths(&base, paths)).unwrap()
        }

        /// With an island table the module's typed flow is checked, and the fixture
        /// builder declares `rows` as `string[]`, so the row slot is a string slot. The
        /// walker binds whatever rows the data holds; the object rows below carry the key.
        fn keyed_with_islands(
            opcodes: &[u8],
            paths: &[(u32, &[u32])],
            islands: &[(u16, u8, u8, u32, u32, &[u16])],
        ) -> IrModule {
            const ISLAND_SLOTS: &[(u16, u32, u8, u8, &[u8])] =
                &[(0, 0, 0x04, 0x00, &[]), (1, 1, 0x01, 0x01, &[])];
            let base = build_declared_fixture(STRINGS, ISLAND_SLOTS, opcodes, islands);
            IrModule::parse(&with_key_paths(&base, paths)).unwrap()
        }

        fn unkeyed(opcodes: &[u8]) -> IrModule {
            IrModule::parse(&build_declared_fixture(STRINGS, SLOTS, opcodes, &[])).unwrap()
        }

        fn rows(values: Vec<SlotValue>) -> SlotData {
            let mut slots = SlotData::new(5);
            slots.set(0, SlotValue::array(values));
            slots.set(4, SlotValue::Text("x".into()));
            slots
        }

        fn object(pairs: Vec<(&str, SlotValue)>) -> SlotValue {
            SlotValue::object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
        }

        fn id(value: SlotValue) -> SlotValue {
            object(vec![("id", value), ("name", text("secret"))])
        }

        fn text(value: &str) -> SlotValue {
            SlotValue::Text(value.into())
        }

        fn num(value: f64) -> SlotValue {
            SlotValue::Number(value)
        }

        fn refused(module: &IrModule, slots: &SlotData) -> ListKeyViolation {
            match walk_to_html(module, slots) {
                Err(IrError::InvalidListKey(violation)) => {
                    let message = IrError::InvalidListKey(violation.clone()).to_string();
                    assert!(message.starts_with("RENDER-503: LIST at bytecode offset "));
                    // A diagnostic names positions and the path, never row data.
                    assert!(!message.contains("secret"), "{message}");
                    *violation
                }
                other => panic!("expected RENDER-503, got {other:?}"),
            }
        }

        fn violation(
            list_offset: u32,
            row: usize,
            path: &str,
            reason: ListKeyReason,
        ) -> ListKeyViolation {
            ListKeyViolation {
                list_offset,
                row,
                path: path.into(),
                reason,
            }
        }

        /// `<li><span></span></li>`: the key belongs on the `li`.
        fn li_body() -> Vec<u8> {
            [
                encode_open_tag(LI, &[]),
                encode_open_tag(SPAN, &[]),
                encode_close_tag(SPAN),
                encode_close_tag(LI),
            ]
            .concat()
        }

        #[test]
        fn a_keyed_list_writes_each_rows_canonical_key_once_on_its_root() {
            let ops = encode_list(0, 1, &li_body());
            let data = rows(vec![
                id(num(1.0)),
                id(text("a&\"<b>'")),
                id(num(-0.0)),
                id(text("x\r\ny\0")),
                id(num(-9_007_199_254_740_991.0)),
                id(text("")),
            ]);
            let html = walk_to_html(&keyed(&ops, &[(0, &[ID])]), &data).unwrap();
            assert_eq!(
                html,
                concat!(
                    "<!--f:l0-->",
                    "<li data-forma-key=\"1\"><span></span></li>",
                    "<li data-forma-key=\"a&amp;&quot;&lt;b&gt;'\"><span></span></li>",
                    "<li data-forma-key=\"0\"><span></span></li>",
                    "<li data-forma-key=\"x\ny\u{FFFD}\"><span></span></li>",
                    "<li data-forma-key=\"-9007199254740991\"><span></span></li>",
                    "<li data-forma-key=\"\"><span></span></li>",
                    "<!--/f:l0-->"
                )
            );
        }

        #[test]
        fn an_unkeyed_list_renders_byte_identically_with_no_key_and_no_key_rules() {
            let ops = encode_list(0, 1, &li_body());
            let data = rows(vec![id(num(1.0)), id(text("a"))]);
            let keyed_out =
                walk_to_html_counted(&keyed(&ops, &[(0, &[ID])]), &data, WalkLimits::default())
                    .unwrap();
            let plain = walk_to_html_counted(&unkeyed(&ops), &data, WalkLimits::default()).unwrap();
            assert_eq!(
                plain.html,
                "<!--f:l0--><li><span></span></li><li><span></span></li><!--/f:l0-->"
            );
            assert_eq!(
                keyed_out
                    .html
                    .replace(" data-forma-key=\"1\"", "")
                    .replace(" data-forma-key=\"a\"", ""),
                plain.html
            );
            assert_eq!(
                keyed_out.counts.list_iterations,
                plain.counts.list_iterations
            );
            assert_eq!(keyed_out.counts.nodes, plain.counts.nodes);
            // Without section 6 none of the key rules apply: scalar, missing and repeated
            // values, several roots, text beside a root and an authored attribute all render
            // as the low-level reader always did.
            let anything = rows(vec![text("a"), text("a"), SlotValue::Null, object(vec![])]);
            assert_eq!(
                walk_to_html(&unkeyed(&ops), &anything).unwrap(),
                format!(
                    "<!--f:l0-->{}<!--/f:l0-->",
                    "<li><span></span></li>".repeat(4)
                )
            );
            let loose = [
                encode_open_tag(LI, &[(KEY_ATTR, AUTHORED)]),
                encode_close_tag(LI),
                encode_text(TEXT),
                encode_void_tag(INPUT, &[]),
            ]
            .concat();
            assert_eq!(
                walk_to_html(&unkeyed(&encode_list(0, 1, &loose)), &rows(vec![text("a")])).unwrap(),
                "<!--f:l0--><li data-forma-key=\"authored\"></li>text<input><!--/f:l0-->"
            );
        }

        #[test]
        fn a_void_root_carries_the_key_and_admits_nothing_beside_it() {
            let void = encode_void_tag(INPUT, &[(TYPE, CHECKBOX)]);
            let html = walk_to_html(
                &keyed(&encode_list(0, 1, &void), &[(0, &[ID])]),
                &rows(vec![id(num(7.0)), id(num(8.0))]),
            )
            .unwrap();
            assert_eq!(
                html,
                "<!--f:l0--><input type=\"checkbox\" data-forma-key=\"7\"><input type=\"checkbox\" data-forma-key=\"8\"><!--/f:l0-->"
            );
            let beside = [void.clone(), encode_text(TEXT)].concat();
            assert_eq!(
                refused(
                    &keyed(&encode_list(0, 1, &beside), &[(0, &[ID])]),
                    &rows(vec![id(num(7.0))])
                ),
                violation(
                    0,
                    0,
                    "id",
                    ListKeyReason::RowShape {
                        roots: 1,
                        stray_content: true
                    }
                )
            );
        }

        /// A registered child as the row: `<!--f:iN-->` wholly encloses the host, which is
        /// the row's root and carries both the island attributes and the key.
        #[test]
        fn a_registered_child_envelope_enclosing_the_root_puts_the_key_on_the_host() {
            let body = [
                encode_island_start(0),
                encode_open_tag(B, &[]),
                encode_close_tag(B),
                encode_island_end(0),
            ]
            .concat();
            let ops = encode_list(0, 1, &body);
            let island = (0, 0x01, 0x01, CHILD, LIST_HEADER as u32, &[][..]);
            let module = keyed_with_islands(&ops, &[(0, &[ID])], &[island]);
            let html = walk_to_html(&module, &rows(vec![id(num(1.0)), id(num(2.0))])).unwrap();
            let host = |occurrence: usize, key: &str| {
                format!("<!--f:i0--><b data-forma-island=\"0\" data-forma-component=\"Child\" data-forma-status=\"pending\" data-forma-hydrate=\"load\" data-forma-state=\"{occurrence}\" data-forma-h=\"0000000000000000\" data-forma-key=\"{key}\"></b><!--/f:i0-->")
            };
            assert_eq!(
                html,
                format!("<!--f:l0-->{}{}<!--/f:l0-->", host(0, "1"), host(1, "2"))
            );
        }

        #[test]
        fn an_island_envelope_that_does_not_wholly_enclose_the_root_refuses() {
            // (body, ISLAND_START's offset inside the body, roots counted)
            let empty_island_then_root = [
                encode_island_start(0),
                encode_island_end(0),
                encode_open_tag(LI, &[]),
                encode_close_tag(LI),
            ]
            .concat();
            let root_then_child = [
                encode_open_tag(LI, &[]),
                encode_close_tag(LI),
                encode_island_start(0),
                encode_open_tag(B, &[]),
                encode_close_tag(B),
                encode_island_end(0),
            ]
            .concat();
            let cases: [(&[u8], usize, usize); 2] = [
                (&empty_island_then_root, 0, 1),
                (
                    &root_then_child,
                    encode_open_tag(LI, &[]).len() + encode_close_tag(LI).len(),
                    2,
                ),
            ];
            for (body, at, roots) in cases {
                let island = (0, 0x01, 0x01, CHILD, (LIST_HEADER + at) as u32, &[][..]);
                let module = keyed_with_islands(&encode_list(0, 1, body), &[(0, &[ID])], &[island]);
                assert_eq!(
                    refused(&module, &rows(vec![id(num(1.0))])),
                    violation(
                        0,
                        0,
                        "id",
                        ListKeyReason::RowShape {
                            roots,
                            stray_content: true
                        }
                    )
                );
            }
        }

        /// `<li>` PROP(row.tags) LIST(tags){ `<b></b>` } `</li>`, both lists keyed by `id`.
        fn nested() -> (Vec<u8>, u32) {
            let inner = encode_list(
                2,
                3,
                &[encode_open_tag(B, &[]), encode_close_tag(B)].concat(),
            );
            let outer_body = [
                encode_open_tag(LI, &[]),
                encode_prop(1, TAGS, 2),
                inner,
                encode_close_tag(LI),
            ]
            .concat();
            let inner_offset =
                LIST_HEADER + encode_open_tag(LI, &[]).len() + encode_prop(1, TAGS, 2).len();
            (encode_list(0, 1, &outer_body), inner_offset as u32)
        }

        fn group(key: f64, tags: Vec<SlotValue>) -> SlotValue {
            object(vec![("id", num(key)), ("tags", SlotValue::array(tags))])
        }

        #[test]
        fn each_execution_of_a_list_is_its_own_duplicate_scope() {
            let (ops, inner) = nested();
            let module = keyed(&ops, &[(0, &[ID]), (inner, &[ID])]);
            // The inner LIST runs once per outer row: the same keys under two outer rows,
            // and an inner key equal to its outer row's key, are not duplicates.
            let data = rows(vec![
                group(1.0, vec![id(text("a")), id(num(1.0))]),
                group(2.0, vec![id(text("a"))]),
            ]);
            assert_eq!(
                walk_to_html(&module, &data).unwrap(),
                concat!(
                    "<!--f:l0-->",
                    "<li data-forma-key=\"1\"><!--f:l2--><b data-forma-key=\"a\"></b><b data-forma-key=\"1\"></b><!--/f:l2--></li>",
                    "<li data-forma-key=\"2\"><!--f:l2--><b data-forma-key=\"a\"></b><!--/f:l2--></li>",
                    "<!--/f:l0-->"
                )
            );
            // Within one execution they are: the inner LIST's offset, its row, the path.
            let duplicate = rows(vec![
                group(1.0, vec![id(text("a"))]),
                group(2.0, vec![id(text("b")), id(text("a")), id(text("b"))]),
            ]);
            assert_eq!(
                refused(&module, &duplicate),
                violation(inner, 2, "id", ListKeyReason::Duplicate { first_row: 0 })
            );
            // Two sibling LISTs over the same rows are two executions too.
            let twice = [encode_list(0, 1, &li_body()), encode_list(0, 1, &li_body())].concat();
            let second = encode_list(0, 1, &li_body()).len() as u32;
            let html = walk_to_html(
                &keyed(&twice, &[(0, &[ID]), (second, &[ID])]),
                &rows(vec![id(num(1.0)), id(num(2.0))]),
            )
            .unwrap();
            assert_eq!(html.matches("data-forma-key=\"1\"").count(), 2, "{html}");
            assert_eq!(html.matches("data-forma-key=\"2\"").count(), 2, "{html}");
        }

        #[test]
        fn keys_collide_on_their_canonical_text_not_on_their_type_or_spelling() {
            let module = keyed(&encode_list(0, 1, &li_body()), &[(0, &[ID])]);
            let collide = [
                (num(1.0), text("1")),
                (num(0.0), num(-0.0)),
                (text("0"), num(-0.0)),
                (text("a\r\nb"), text("a\nb")),
                (text("a\rb"), text("a\nb")),
                (text("\0"), text("\u{FFFD}")),
            ];
            for (first, second) in collide {
                let label = format!("{first:?} {second:?}");
                assert_eq!(
                    refused(&module, &rows(vec![id(first), id(second)])),
                    violation(0, 1, "id", ListKeyReason::Duplicate { first_row: 0 }),
                    "{label}"
                );
            }
            let distinct = [
                (num(1.0), text("01")),
                (text("A"), text("a")),
                (text("a"), text("a ")),
                (text("\u{e9}"), text("e\u{301}")),
                (text("-0"), num(0.0)),
            ];
            for (first, second) in distinct {
                let label = format!("{first:?} {second:?}");
                assert!(
                    walk_to_html(&module, &rows(vec![id(first), id(second)])).is_ok(),
                    "{label}"
                );
            }
        }

        #[test]
        fn a_row_without_an_identity_at_the_path_refuses_with_its_reason() {
            let module = keyed(&encode_list(0, 1, &li_body()), &[(0, &[ID])]);
            let not_identity = |kind| ListKeyReason::NotAnIdentity { kind };
            let twice = SlotValue::object(vec![("id".into(), num(1.0)), ("id".into(), num(2.0))]);
            let cases = [
                (
                    object(vec![("name", text("secret"))]),
                    ListKeyReason::MissingField {
                        segment: "id".into(),
                    },
                ),
                (id(SlotValue::Null), not_identity("null")),
                (id(SlotValue::Bool(true)), not_identity("a boolean")),
                (
                    id(object(vec![("secret", num(1.0))])),
                    not_identity("an object"),
                ),
                (
                    id(SlotValue::array(vec![text("secret")])),
                    not_identity("an array"),
                ),
                (id(num(1.5)), ListKeyReason::NotASafeInteger),
                (id(num(f64::NAN)), ListKeyReason::NotASafeInteger),
                (id(num(f64::INFINITY)), ListKeyReason::NotASafeInteger),
                (id(num(f64::NEG_INFINITY)), ListKeyReason::NotASafeInteger),
                (
                    id(num(9_007_199_254_740_992.0)),
                    ListKeyReason::NotASafeInteger,
                ),
                (
                    id(num(-9_007_199_254_740_992.0)),
                    ListKeyReason::NotASafeInteger,
                ),
                (
                    text("secret"),
                    ListKeyReason::NotAnObject {
                        segment: "id".into(),
                    },
                ),
                (
                    twice,
                    ListKeyReason::DuplicateField {
                        segment: "id".into(),
                    },
                ),
            ];
            for (bad, reason) in cases {
                // The refused row is the second: the first rendered nothing the page keeps.
                assert_eq!(
                    refused(&module, &rows(vec![id(num(1.0)), bad])),
                    violation(0, 1, "id", reason)
                );
            }
            // A nested path reads objects only, and names itself dotted.
            let nested = keyed(&encode_list(0, 1, &li_body()), &[(0, &[USER, ID])]);
            let user = |value| object(vec![("user", value)]);
            assert_eq!(
                walk_to_html(&nested, &rows(vec![user(id(text("u1")))])).unwrap(),
                "<!--f:l0--><li data-forma-key=\"u1\"><span></span></li><!--/f:l0-->"
            );
            for value in [
                text("u1"),
                SlotValue::Null,
                SlotValue::array(vec![id(num(1.0))]),
            ] {
                assert_eq!(
                    refused(&nested, &rows(vec![user(value)])),
                    violation(
                        0,
                        0,
                        "user.id",
                        ListKeyReason::NotAnObject {
                            segment: "id".into()
                        }
                    )
                );
            }
        }

        #[test]
        fn a_keyed_row_renders_exactly_one_balanced_root_and_nothing_beside_it() {
            let shape = |roots, stray_content| ListKeyReason::RowShape {
                roots,
                stray_content,
            };
            let li = [encode_open_tag(LI, &[]), encode_close_tag(LI)].concat();
            let cases: Vec<(&str, Vec<u8>, ListKeyReason)> = vec![
                ("empty row", Vec::new(), shape(0, false)),
                (
                    "two roots",
                    [li.clone(), li.clone()].concat(),
                    shape(2, false),
                ),
                (
                    "text beside",
                    [li.clone(), encode_text(TEXT)].concat(),
                    shape(1, true),
                ),
                ("text only", encode_text(TEXT), shape(0, true)),
                ("dynamic text only", encode_dyn_text(4, 0), shape(0, true)),
                (
                    "conditional root",
                    encode_show_if(4, &li, &li),
                    shape(1, true),
                ),
                (
                    // Its one row's `li` is at the outer row's level too, so it counts as
                    // the outer row's root; the range around it is the refusal.
                    "list at the row's level",
                    encode_list(2, 3, &li),
                    shape(1, true),
                ),
                (
                    "closes the list's parent",
                    encode_close_tag(UL),
                    ListKeyReason::UnbalancedRow,
                ),
                (
                    "closes the parent after its root",
                    [li.clone(), encode_close_tag(UL), encode_open_tag(UL, &[])].concat(),
                    ListKeyReason::UnbalancedRow,
                ),
                (
                    "leaves its root open",
                    encode_open_tag(LI, &[]),
                    ListKeyReason::UnbalancedRow,
                ),
            ];
            for (name, body, reason) in cases {
                let ops = [
                    encode_open_tag(UL, &[]),
                    encode_list(0, 1, &body),
                    encode_close_tag(UL),
                ]
                .concat();
                let offset = encode_open_tag(UL, &[]).len() as u32;
                let module = keyed(&ops, &[(offset, &[ID])]);
                let mut data = rows(vec![id(num(1.0))]);
                data.set(2, SlotValue::array(vec![text("t")]));
                assert_eq!(
                    refused(&module, &data),
                    violation(offset, 0, "id", reason),
                    "{name}"
                );
            }
        }

        #[test]
        fn an_authored_data_forma_key_on_the_root_refuses_and_on_a_descendant_renders() {
            let authored = |body: Vec<u8>| {
                refused(
                    &keyed(&encode_list(0, 1, &body), &[(0, &[ID])]),
                    &rows(vec![id(num(1.0))]),
                )
            };
            let expected = violation(0, 0, "id", ListKeyReason::AuthoredKey);
            for attr in [KEY_ATTR, KEY_ATTR_UPPER] {
                assert_eq!(
                    authored(
                        [
                            encode_open_tag(LI, &[(attr, AUTHORED)]),
                            encode_close_tag(LI)
                        ]
                        .concat()
                    ),
                    expected
                );
                assert_eq!(
                    authored(encode_void_tag(INPUT, &[(attr, AUTHORED)])),
                    expected
                );
                assert_eq!(
                    authored(
                        [
                            encode_open_tag(LI, &[]),
                            encode_dyn_attr(attr, 4),
                            encode_close_tag(LI)
                        ]
                        .concat()
                    ),
                    expected
                );
            }
            let descendant = [
                encode_open_tag(LI, &[]),
                encode_open_tag(SPAN, &[(KEY_ATTR, AUTHORED)]),
                encode_close_tag(SPAN),
                encode_close_tag(LI),
            ]
            .concat();
            assert_eq!(
                walk_to_html(
                    &keyed(&encode_list(0, 1, &descendant), &[(0, &[ID])]),
                    &rows(vec![id(num(1.0))])
                )
                .unwrap(),
                "<!--f:l0--><li data-forma-key=\"1\"><span data-forma-key=\"authored\"></span></li><!--/f:l0-->"
            );
        }

        #[test]
        fn a_refused_row_leaves_the_slot_journal_keyed_rows_and_list_depth_as_found() {
            let (ops, inner) = nested();
            let module = keyed(&ops, &[(0, &[ID]), (inner, &[ID])]);
            let bad_inner_key = rows(vec![
                group(1.0, vec![id(text("a"))]),
                group(2.0, vec![id(text("a")), id(text("a"))]),
            ]);
            // The inner row's key is fine, but the output budget runs out inside it (50 bytes
            // end within its `<b data-forma-key="a">`): a non-key error unwinds the same way.
            let over_budget_inside = rows(vec![group(1.0, vec![id(text("a"))])]);
            let cases = [
                (
                    bad_inner_key,
                    WalkLimits::default(),
                    IrError::InvalidListKey(Box::new(violation(
                        inner,
                        1,
                        "id",
                        ListKeyReason::Duplicate { first_row: 0 },
                    ))),
                ),
                (
                    over_budget_inside,
                    WalkLimits {
                        max_output_bytes: 50,
                        ..WalkLimits::default()
                    },
                    IrError::OutputLimitExceeded { limit: 50 },
                ),
            ];
            for (data, limits, expected) in cases {
                let mut slots = data.clone();
                let before = format!("{slots:?}");
                let mut state = WalkState::new(limits);
                let mut out = String::new();
                let error = walk_range(
                    &module,
                    &mut slots,
                    &module.opcodes,
                    0,
                    module.opcodes.len(),
                    &mut out,
                    &mut state,
                    0,
                )
                .unwrap_err();
                assert_eq!(error, expected);
                assert_eq!(state.list_depth, 0, "{error:?}");
                assert!(state.keyed_rows.is_empty(), "{error:?}");
                assert!(state.slot_journal.is_empty(), "{error:?}");
                assert_eq!(format!("{slots:?}"), before, "{error:?}");
            }
        }

        #[test]
        fn a_key_is_charged_to_the_output_budget_before_it_is_built() {
            let module = keyed(&encode_list(0, 1, &li_body()), &[(0, &[ID])]);
            let long = "k".repeat(1000);
            let opened = "<!--f:l0-->".len();
            let limits = WalkLimits {
                max_output_bytes: opened + 999,
                ..WalkLimits::default()
            };
            let failure =
                walk_to_html_counted(&module, &rows(vec![id(text(&long))]), limits).unwrap_err();
            assert_eq!(
                failure.error,
                IrError::OutputLimitExceeded {
                    limit: opened + 999
                }
            );
            // Refused before the row wrote anything: only the list's opening marker.
            assert_eq!(failure.counts.bytes, opened);
            // A NUL is counted as the three bytes U+FFFD takes.
            let nul = "\0".repeat(400);
            let limits = WalkLimits {
                max_output_bytes: opened + 1000,
                ..WalkLimits::default()
            };
            let failure =
                walk_to_html_counted(&module, &rows(vec![id(text(&nul))]), limits).unwrap_err();
            assert_eq!(failure.counts.bytes, opened);
            // Exactly at the budget the page renders.
            let html = walk_to_html(&module, &rows(vec![id(text("key"))])).unwrap();
            let exact = WalkLimits {
                max_output_bytes: html.len(),
                ..WalkLimits::default()
            };
            assert_eq!(
                walk_to_html_with_limits(&module, &rows(vec![id(text("key"))]), exact).unwrap(),
                html
            );
        }

        #[test]
        fn the_iteration_budget_refuses_a_keyed_list_before_any_key_is_read() {
            let module = keyed(&encode_list(0, 1, &li_body()), &[(0, &[ID])]);
            let limits = WalkLimits {
                max_list_iterations: 1,
                ..WalkLimits::default()
            };
            let failure = walk_to_html_counted(
                &module,
                &rows(vec![id(SlotValue::Null), id(num(1.0))]),
                limits,
            )
            .unwrap_err();
            assert_eq!(failure.error, IrError::ListBudgetExceeded { max: 1 });
            assert_eq!(failure.counts.list_iterations, 0);
        }

        /// FORMA-181 checkpoint C: the `served` markup of every keys.json vector is exactly
        /// what this walker writes for that key, because the browser spec parses that markup
        /// in Chromium, Firefox and WebKit and checks it decodes to the canonical text
        /// (packages/core/e2e/keyed-adoption.spec.ts). A change to the attribute escaping
        /// fails here before it can drift from what the browsers were shown.
        #[test]
        fn every_shared_key_vector_is_written_as_its_served_markup() {
            let vectors: serde_json::Value =
                serde_json::from_str(include_str!("../tests/fixtures/parity/keys.json")).unwrap();
            let module = keyed(&encode_list(0, 1, &li_body()), &[(0, &[ID])]);
            let mut checked = 0;
            for case in vectors["values"].as_array().unwrap() {
                let Some(served) = case.get("served").and_then(serde_json::Value::as_str) else {
                    continue;
                };
                let row = object(vec![(
                    "id",
                    crate::slot::json_to_slot_value(&case["value"]),
                )]);
                assert_eq!(
                    walk_to_html(&module, &rows(vec![row])).unwrap(),
                    format!(
                        "<!--f:l0--><li data-forma-key=\"{served}\"><span></span></li><!--/f:l0-->"
                    ),
                    "{}",
                    case["id"]
                );
                checked += 1;
            }
            assert!(
                checked >= 20,
                "the vector file lost its served markup: {checked}"
            );
        }

        #[test]
        fn a_diagnostic_path_quotes_a_segment_a_dot_would_make_ambiguous() {
            assert_eq!(dotted_path(&["user", "id"]), "user.id");
            assert_eq!(dotted_path(&["user.id"]), "[\"user.id\"]");
            assert_eq!(dotted_path(&["a", "b.c", "d"]), "a[\"b.c\"].d");
            assert_eq!(dotted_path(&["", "x[0]"]), "[\"\"][\"x[0]\"]");
        }
    }
}
