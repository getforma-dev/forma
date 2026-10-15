use crate::format::{IrError, SlotType};
use crate::parser::{IrModule, SlotTable};
use std::sync::Arc;

/// Runtime values populated by page handlers before IR walking.
///
/// `Array` and `Object` payloads are `Arc`-backed so that handing one item of a
/// list to the walker is a refcount bump rather than a deep copy of the whole
/// tree. `Arc` rather than `Rc` because `SlotData` is borrowed into page
/// configs inside async handlers and must stay `Send + Sync`.
#[derive(Debug, Clone)]
pub enum SlotValue {
    /// No value. Renders as empty text and is falsy, like JS `null`.
    Null,
    /// A string, emitted HTML-escaped.
    Text(String),
    /// A boolean. As a DYN_ATTR value, `true` emits the bare attribute name
    /// and `false` omits the attribute entirely.
    Bool(bool),
    /// A double, rendered exactly as ECMAScript's `Number::toString` would.
    Number(f64),
    /// An array. The only value a LIST can iterate; `Arc` so binding one item
    /// per row is a refcount bump, not a deep copy.
    Array(Arc<[SlotValue]>),
    /// A key/value object. The only value PROP can read a property from.
    Object(Arc<[(String, SlotValue)]>),
}

/// A static Null reference returned for out-of-bounds slot lookups.
static NULL_SLOT: SlotValue = SlotValue::Null;

/// Largest integer f64 that ECMAScript renders without exponent games —
/// `Number.MAX_SAFE_INTEGER + 1` (2^53).
const JS_SAFE_INTEGER_LIMIT: f64 = 9007199254740992.0;

/// Format an `f64` exactly the way ECMAScript's `Number::toString` does.
///
/// The SSR text node has to agree byte-for-byte with what `@getforma/core`
/// renders client-side for the same value, otherwise hydration reconciles a
/// difference that is not really there. Rust's `Display` for f64 never uses
/// exponential notation (`format!("{}", 1e300)` is a 301-character integer),
/// so the general path is built from `LowerExp` — also shortest-round-trip —
/// and re-assembled using the spec's exponent rule.
fn format_js_number(n: f64) -> String {
    if n.is_nan() {
        // Rust and JS agree here already.
        return "NaN".to_string();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }

    // Fast path: integers inside the JS safe range. This also deliberately
    // keeps -0.0 → "0" (matching `String(-0)`); routing it through the general
    // path would print "-0".
    if n.fract() == 0.0 && n.abs() < JS_SAFE_INTEGER_LIMIT {
        return format!("{}", n as i64);
    }

    // `{:e}` yields "1e300", "1.5e-7", "1.2345678901234568e20", ...
    let exp_form = format!("{:e}", n);
    let (mantissa, exp_str) = match exp_form.split_once('e') {
        Some(parts) => parts,
        None => return exp_form, // unreachable for finite f64
    };
    let exp: i32 = match exp_str.parse() {
        Ok(e) => e,
        Err(_) => return exp_form, // unreachable
    };

    let negative = mantissa.starts_with('-');
    let digits: String = mantissa
        .trim_start_matches('-')
        .chars()
        .filter(|c| *c != '.')
        .collect();
    let k = digits.len() as i32; // significant digits
    let pos = exp + 1; // the spec's `n`: value = 0.<digits> x 10^pos

    let mut out = String::with_capacity(digits.len() + 8);
    if negative {
        out.push('-');
    }

    if k <= pos && pos <= 21 {
        // Integer with trailing zeros: 1e16 -> "10000000000000000"
        out.push_str(&digits);
        for _ in 0..(pos - k) {
            out.push('0');
        }
    } else if 0 < pos && pos <= 21 {
        // Decimal point inside the digits: 123.456
        out.push_str(&digits[..pos as usize]);
        out.push('.');
        out.push_str(&digits[pos as usize..]);
    } else if -6 < pos && pos <= 0 {
        // Leading zeros: 1e-6 -> "0.000001"
        out.push_str("0.");
        for _ in 0..(-pos) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        // Exponential. JS writes an explicit '+' on positive exponents;
        // Rust's `{:e}` does not, so insert it.
        if k == 1 {
            out.push_str(&digits);
        } else {
            out.push_str(&digits[..1]);
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let e = pos - 1;
        if e >= 0 {
            out.push('+');
        }
        out.push_str(&e.to_string());
    }

    out
}

impl SlotValue {
    /// Render to string for DYN_TEXT output.
    ///
    /// Numbers follow ECMAScript `Number::toString` so the SSR text node
    /// matches the client renderer exactly. Note this also drives SWITCH case
    /// comparison, whose case strings are authored on the JS side.
    pub fn to_text(&self) -> String {
        match self {
            SlotValue::Null => String::new(),
            SlotValue::Text(s) => s.clone(),
            SlotValue::Bool(true) => "true".to_string(),
            SlotValue::Bool(false) => "false".to_string(),
            SlotValue::Number(n) => format_js_number(*n),
            // `String(["a","b"])` is "a,b", not "[Array]" — the client
            // renderer produces the join, so anything else is a visible
            // SSR→hydration flip on the text node. Nesting flattens because
            // `Array.prototype.join` calls `toString` on each element, which
            // for an array is `join` again; `null`/`undefined` become "".
            SlotValue::Array(items) => {
                let mut out = String::new();
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&item.to_text());
                }
                out
            }
            // `String({})` — every plain object, whatever its keys.
            SlotValue::Object(_) => "[object Object]".to_string(),
        }
    }

    /// Build an `Array` value from a `Vec`.
    ///
    /// Convenience constructor for the `Arc`-backed payload — prefer it over
    /// naming the variant so call sites do not have to spell the conversion.
    pub fn array(items: Vec<SlotValue>) -> Self {
        SlotValue::Array(items.into())
    }

    /// Build an `Object` value from a `Vec` of key/value pairs.
    pub fn object(pairs: Vec<(String, SlotValue)>) -> Self {
        SlotValue::Object(pairs.into())
    }

    /// Truthiness for SHOW_IF evaluation, following ECMAScript `ToBoolean`.
    ///
    /// Every object is truthy in JS, empty arrays included (`!![]` is `true`).
    /// The server used to call an empty array falsy, so a SHOW_IF bound
    /// straight to a list slot hid its block during SSR and then un-hid it the
    /// moment the client evaluated the same condition — a guaranteed visible
    /// flip on the empty-list case, which is exactly the state a fresh page
    /// starts in.
    ///
    /// NaN is falsy (`n != 0.0` is true for NaN), matching `ToBoolean`.
    ///
    /// Verified by: crates/forma-ir/src/slot.rs > "as_bool_matches_javascript_tobool"
    pub fn as_bool(&self) -> bool {
        match self {
            SlotValue::Null => false,
            SlotValue::Bool(b) => *b,
            SlotValue::Text(s) => !s.is_empty(),
            SlotValue::Number(n) => *n != 0.0 && !n.is_nan(),
            SlotValue::Array(_) | SlotValue::Object(_) => true,
        }
    }

    /// Extract a named property from an Object. Returns Null if not Object or key not found.
    pub fn get_property(&self, name: &str) -> SlotValue {
        match self {
            SlotValue::Object(pairs) => {
                for (k, v) in pairs.iter() {
                    if k == name {
                        return v.clone();
                    }
                }
                SlotValue::Null
            }
            _ => SlotValue::Null,
        }
    }

    /// For LIST iteration — returns the inner slice if Array, None otherwise.
    pub fn as_array(&self) -> Option<&[SlotValue]> {
        match self {
            SlotValue::Array(a) => Some(a),
            _ => None,
        }
    }

    /// Borrow text without cloning. Returns the inner &str for Text variant,
    /// "" for all others (Number requires allocation via to_text()).
    pub fn as_text_ref(&self) -> &str {
        match self {
            SlotValue::Text(s) => s.as_str(),
            _ => "",
        }
    }

    /// Convert to a serde_json::Value for props serialization.
    ///
    /// Non-finite numbers become `null`, which is not a defect but exact
    /// parity: `JSON.stringify(Infinity)` is `null` in JS too, so a props
    /// payload matches what a formajs SSR render would produce even though
    /// [`SlotValue::to_text`] says `"Infinity"` for the same value.
    ///
    /// The serialized *text* is not byte-identical to `JSON.stringify` (serde
    /// emits `1e16` where JS emits `10000000000000000`); the parsed values are.
    /// Props are always consumed via `JSON.parse`, never string-compared.
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            SlotValue::Null => serde_json::Value::Null,
            SlotValue::Text(s) => serde_json::Value::String(s.clone()),
            SlotValue::Bool(b) => serde_json::Value::Bool(*b),
            SlotValue::Number(n) => {
                // Only take the integer shortcut inside the JS safe range —
                // `*n as i64` saturates above 2^63 and would silently corrupt
                // the value.
                if n.fract() == 0.0 && n.abs() < JS_SAFE_INTEGER_LIMIT {
                    serde_json::Value::Number(serde_json::Number::from(*n as i64))
                } else {
                    serde_json::Number::from_f64(*n)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                }
            }
            SlotValue::Array(items) => {
                serde_json::Value::Array(items.iter().map(|v| v.to_json()).collect())
            }
            SlotValue::Object(pairs) => {
                let map: serde_json::Map<String, serde_json::Value> = pairs
                    .iter()
                    .map(|(k, v)| (k.clone(), v.to_json()))
                    .collect();
                serde_json::Value::Object(map)
            }
        }
    }
}

/// Dense Vec indexed by slot_id — the bridge between Rust page handlers and the IR walker.
///
/// Handlers create a SlotData, populate it with values (title, user name, nav items, etc.),
/// then the walker reads slot values when it encounters DYN_TEXT, DYN_ATTR, SHOW_IF, LIST opcodes.
#[derive(Debug, Clone)]
pub struct SlotData {
    slots: Vec<SlotValue>,
}

impl SlotData {
    /// Create a new SlotData with `capacity` Null-initialized slots.
    ///
    /// This is the only constructor that can be undersized relative to a
    /// module's slot table. Prefer [`SlotData::new_from_defaults`] or
    /// [`SlotData::from_json`], which size themselves from the module; `new`
    /// is for tests and for callers that know their own slot count.
    pub fn new(capacity: usize) -> Self {
        let mut slots = Vec::with_capacity(capacity);
        slots.resize_with(capacity, || SlotValue::Null);
        Self { slots }
    }

    /// Set a slot value, growing the backing storage if `slot_id` is past the
    /// end (new entries are `Null`).
    ///
    /// This used to be a silent no-op when out of bounds, which made a LIST
    /// whose `item_slot_id` exceeded the SlotData length render every row
    /// identically with no error at all. Growing is cheap, and a write outside
    /// the module's declared slot table cannot reach here from a parsed module
    /// — `IrModule::validate` rejects an opcode naming an undeclared slot at
    /// parse time — so the branch only catches a caller that sized its own
    /// `SlotData` too small, and warns under the `tracing` feature.
    ///
    /// Verified by: crates/forma-ir/src/slot.rs > "set_grows_instead_of_silently_dropping"
    /// Verified by: crates/forma-ir/src/parser.rs > "validate_rejects_list_item_slot_not_in_table"
    pub fn set(&mut self, slot_id: u16, value: SlotValue) {
        self.replace(slot_id, value);
    }

    /// Set a slot value and return the previous one.
    ///
    /// This is the primitive the walker's LIST loop is built on: it binds the
    /// row's item (and any PROP the body extracts from it) by swapping values
    /// in, then swaps the saved originals back when the row ends. That keeps
    /// per-row scoping without the deep `SlotData` clone the loop used to take,
    /// which made a list cost O(rows x slots) instead of O(rows).
    ///
    /// Verified by: crates/forma-ir/tests/list_scaling.rs > "list_walk_allocations_are_linear_in_row_count"
    pub fn replace(&mut self, slot_id: u16, value: SlotValue) -> SlotValue {
        let idx = slot_id as usize;
        if idx >= self.slots.len() {
            #[cfg(feature = "tracing")]
            tracing::warn!(
                slot_id = slot_id,
                len = self.slots.len(),
                "Slot write past the end of SlotData — growing (SlotData sized smaller than the module's slot table)"
            );
            self.slots.resize_with(idx + 1, || SlotValue::Null);
        }
        std::mem::replace(&mut self.slots[idx], value)
    }

    /// Get a reference to a slot value. Returns &Null if out of bounds.
    pub fn get(&self, slot_id: u16) -> &SlotValue {
        let idx = slot_id as usize;
        self.slots.get(idx).unwrap_or(&NULL_SLOT)
    }

    /// Get the text content of a slot. Returns Some(&str) if Text, None otherwise.
    pub fn get_text(&self, slot_id: u16) -> Option<&str> {
        match self.get(slot_id) {
            SlotValue::Text(s) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Create SlotData from a named-key JSON string, resolving names to slot IDs
    /// via the module's string table and slot table.
    ///
    /// The JSON must be an object (e.g., `{"title": "Hello", "count": 42}`).
    /// Each key is resolved against the slot table: the slot entry's `name_str_idx`
    /// is looked up in the string table to find the slot name. If it matches a JSON
    /// key, the JSON value is converted to a `SlotValue` and stored at that slot_id.
    ///
    /// Unknown JSON keys (not in the slot table) are silently ignored.
    /// Starts from slot table defaults so missing keys retain their defaults.
    pub fn from_json(json_str: &str, module: &IrModule) -> Result<Self, IrError> {
        let parsed: serde_json::Value =
            serde_json::from_str(json_str).map_err(|e| IrError::JsonParseError(e.to_string()))?;

        let obj = match parsed {
            serde_json::Value::Object(map) => map,
            _ => return Err(IrError::JsonParseError("expected JSON object".to_string())),
        };

        // Build name → slot_id map from the slot table + string table.
        //
        // Slot names are not unique (see `IrModule::slot_id_by_name`), and the
        // first entry in table order wins — `insert` alone would have made the
        // LAST one win here while `slot_id_by_name` returned the first, so a
        // handler setting a value by name filled a different slot than a
        // lookup by the same name resolved to.
        let mut name_to_slot: std::collections::HashMap<&str, u16> =
            std::collections::HashMap::new();
        for entry in module.slots.entries() {
            if let Ok(name) = module.strings.get(entry.name_str_idx) {
                name_to_slot.entry(name).or_insert(entry.slot_id);
            }
        }

        // Start from defaults
        let mut data = Self::new_from_defaults(&module.slots);

        // Override with JSON values
        for (key, value) in &obj {
            if let Some(&slot_id) = name_to_slot.get(key.as_str()) {
                data.set(slot_id, json_to_slot_value(value));
            }
            // Unknown keys silently ignored
        }

        Ok(data)
    }

    /// Create SlotData pre-populated from the IR slot table defaults.
    /// Server-sourced slots with no default -> Null.
    /// Client-sourced slots with defaults -> parsed from default_bytes.
    pub fn new_from_defaults(table: &SlotTable) -> Self {
        let entries = table.entries();
        let capacity = entries
            .iter()
            .map(|e| e.slot_id as usize + 1)
            .max()
            .unwrap_or(0);
        let mut slots = Vec::with_capacity(capacity);
        slots.resize_with(capacity, || SlotValue::Null);

        for entry in entries {
            let idx = entry.slot_id as usize;
            if idx >= slots.len() {
                continue;
            }
            if entry.default_bytes.is_empty() {
                continue;
            }

            let default_str = std::str::from_utf8(&entry.default_bytes).unwrap_or("");
            let value = match entry.type_hint {
                SlotType::Bool => match default_str {
                    "true" => SlotValue::Bool(true),
                    "false" => SlotValue::Bool(false),
                    _ => SlotValue::Null,
                },
                SlotType::Text => SlotValue::Text(default_str.to_string()),
                SlotType::Number => default_str
                    .parse::<f64>()
                    .map(SlotValue::Number)
                    .unwrap_or(SlotValue::Null),
                SlotType::Array => {
                    if default_str == "[]" {
                        SlotValue::array(vec![])
                    } else {
                        SlotValue::Null
                    }
                }
                SlotType::Object => SlotValue::Null,
            };
            slots[idx] = value;
        }

        Self { slots }
    }
}

/// Convert a `serde_json::Value` to a `SlotValue` recursively.
///
/// Type mapping:
/// - null → Null
/// - string → Text
/// - bool → Bool
/// - number → Number (as f64)
/// - array → Array (each element converted recursively)
/// - object → Object (each key-value pair converted recursively)
pub fn json_to_slot_value(value: &serde_json::Value) -> SlotValue {
    match value {
        serde_json::Value::Null => SlotValue::Null,
        serde_json::Value::String(s) => SlotValue::Text(s.clone()),
        serde_json::Value::Bool(b) => SlotValue::Bool(*b),
        serde_json::Value::Number(n) => SlotValue::Number(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::Array(arr) => {
            SlotValue::Array(arr.iter().map(json_to_slot_value).collect())
        }
        serde_json::Value::Object(map) => SlotValue::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), json_to_slot_value(v)))
                .collect(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::{IrModule, SlotTable};

    /// Build valid v2 slot table binary data from a slice of
    /// (slot_id, name_str_idx, type_hint_byte, source_byte, default_bytes).
    fn build_slot_table_bytes(entries: &[(u16, u32, u8, u8, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for &(slot_id, name_str_idx, type_hint, source, default_bytes) in entries {
            buf.extend_from_slice(&slot_id.to_le_bytes());
            buf.extend_from_slice(&name_str_idx.to_le_bytes());
            buf.push(type_hint);
            buf.push(source);
            buf.extend_from_slice(&(default_bytes.len() as u16).to_le_bytes());
            buf.extend_from_slice(default_bytes);
        }
        buf
    }

    #[test]
    fn slot_value_text_to_text() {
        assert_eq!(SlotValue::Text("hello".to_string()).to_text(), "hello");
    }

    #[test]
    fn slot_value_bool_to_text() {
        assert_eq!(SlotValue::Bool(true).to_text(), "true");
        assert_eq!(SlotValue::Bool(false).to_text(), "false");
    }

    #[test]
    fn slot_value_number_integer() {
        assert_eq!(SlotValue::Number(42.0).to_text(), "42");
    }

    #[test]
    fn slot_value_number_float() {
        assert_eq!(SlotValue::Number(3.15).to_text(), "3.15");
    }

    #[test]
    fn slot_value_null_to_text() {
        assert_eq!(SlotValue::Null.to_text(), "");
    }

    #[test]
    fn as_bool_matches_javascript_tobool() {
        // Each row is (value, exactly what `Boolean(value)` gives in JS). The
        // SSR condition has to agree with the client's, or the block flips
        // visible/hidden the moment hydration runs.
        assert!(SlotValue::Text("x".to_string()).as_bool());
        assert!(SlotValue::Number(1.0).as_bool());
        assert!(SlotValue::Number(-1.0).as_bool());
        assert!(SlotValue::Bool(true).as_bool());
        assert!(SlotValue::array(vec![SlotValue::Null]).as_bool());
        assert!(SlotValue::object(vec![]).as_bool());
        // `!![]` is true. This is the row the old `!a.is_empty()` got wrong,
        // and an empty list is the state a fresh page starts in.
        assert!(SlotValue::array(vec![]).as_bool());

        assert!(!SlotValue::Null.as_bool());
        assert!(!SlotValue::Text("".to_string()).as_bool());
        assert!(!SlotValue::Number(0.0).as_bool());
        assert!(!SlotValue::Number(-0.0).as_bool());
        assert!(!SlotValue::Number(f64::NAN).as_bool());
        assert!(!SlotValue::Bool(false).as_bool());
    }

    #[test]
    fn to_text_matches_javascript_string_for_containers() {
        // `String(value)` in JS, for the container variants.
        assert_eq!(SlotValue::array(vec![]).to_text(), "");
        assert_eq!(
            SlotValue::array(vec![
                SlotValue::Text("a".into()),
                SlotValue::Text("b".into())
            ])
            .to_text(),
            "a,b"
        );
        // null and undefined join as empty strings, not as "null".
        assert_eq!(
            SlotValue::array(vec![
                SlotValue::Null,
                SlotValue::Number(1.0),
                SlotValue::Null
            ])
            .to_text(),
            ",1,"
        );
        // Nested arrays flatten, because join calls toString on each element.
        assert_eq!(
            SlotValue::array(vec![
                SlotValue::array(vec![SlotValue::Number(1.0), SlotValue::Number(2.0)]),
                SlotValue::array(vec![SlotValue::Number(3.0)]),
            ])
            .to_text(),
            "1,2,3"
        );
        assert_eq!(SlotValue::object(vec![]).to_text(), "[object Object]");
        assert_eq!(
            SlotValue::array(vec![SlotValue::object(vec![])]).to_text(),
            "[object Object]"
        );
    }

    #[test]
    fn slot_value_as_array() {
        let arr = SlotValue::array(vec![SlotValue::Text("a".to_string())]);
        assert!(arr.as_array().is_some());
        assert_eq!(arr.as_array().unwrap().len(), 1);

        assert!(SlotValue::Null.as_array().is_none());
        assert!(SlotValue::Text("x".to_string()).as_array().is_none());
        assert!(SlotValue::Number(1.0).as_array().is_none());
        assert!(SlotValue::Bool(true).as_array().is_none());
        assert!(SlotValue::object(vec![]).as_array().is_none());
    }

    #[test]
    fn slot_data_set_and_get() {
        let mut data = SlotData::new(4);
        data.set(0, SlotValue::Text("title".to_string()));
        data.set(2, SlotValue::Number(99.0));

        assert_eq!(data.get(0).to_text(), "title");
        assert_eq!(data.get(2).to_text(), "99");
        // Unset slots remain Null
        assert_eq!(data.get(1).to_text(), "");
    }

    #[test]
    fn slot_data_out_of_bounds() {
        let data = SlotData::new(2);
        // Beyond capacity returns Null
        assert_eq!(data.get(5).to_text(), "");
        assert!(!data.get(100).as_bool());
    }

    #[test]
    fn slot_data_get_text() {
        let mut data = SlotData::new(3);
        data.set(0, SlotValue::Text("hello".to_string()));
        data.set(1, SlotValue::Number(42.0));

        assert_eq!(data.get_text(0), Some("hello"));
        assert_eq!(data.get_text(1), None); // Number, not Text
        assert_eq!(data.get_text(2), None); // Null, not Text
    }

    // -- new_from_defaults tests --------------------------------------------

    #[test]
    fn slot_data_new_from_defaults_basic() {
        // Build a v2 slot table with 3 slots:
        // Slot 0: Array, Server, default "[]"
        // Slot 1: Bool, Client, default "false"
        // Slot 2: Text, Client, default "hello"
        let bytes = build_slot_table_bytes(&[
            (0, 0, 0x04, 0x00, b"[]"),    // Array, Server, default "[]"
            (1, 1, 0x02, 0x01, b"false"), // Bool, Client, default "false"
            (2, 2, 0x01, 0x01, b"hello"), // Text, Client, default "hello"
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        // Slot 0: Array with default "[]" -> empty array
        assert!(matches!(data.get(0), SlotValue::Array(v) if v.is_empty()));
        // Slot 1: Bool with default "false" -> Bool(false)
        assert!(matches!(data.get(1), SlotValue::Bool(false)));
        // Slot 2: Text with default "hello" -> Text("hello")
        assert_eq!(data.get_text(2), Some("hello"));
    }

    #[test]
    fn slot_data_new_from_defaults_empty_table() {
        // Empty slot table -> empty SlotData
        let bytes = build_slot_table_bytes(&[]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        // Out of bounds returns Null
        assert!(matches!(data.get(0), SlotValue::Null));
    }

    #[test]
    fn slot_data_new_from_defaults_no_default_bytes() {
        // Slot with empty default_bytes -> Null
        let bytes = build_slot_table_bytes(&[
            (0, 0, 0x01, 0x00, b""), // Text, Server, no default
            (1, 1, 0x03, 0x01, b""), // Number, Client, no default
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        assert!(matches!(data.get(0), SlotValue::Null));
        assert!(matches!(data.get(1), SlotValue::Null));
    }

    #[test]
    fn slot_data_new_from_defaults_number() {
        // Verify Number parsing
        let bytes = build_slot_table_bytes(&[
            (0, 0, 0x03, 0x00, b"42"),   // Number, Server, default "42"
            (1, 1, 0x03, 0x01, b"3.15"), // Number, Client, default "3.15"
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        assert!(matches!(data.get(0), SlotValue::Number(n) if (*n - 42.0).abs() < f64::EPSILON));
        assert!(matches!(data.get(1), SlotValue::Number(n) if (*n - 3.15).abs() < f64::EPSILON));
        let bad = build_slot_table_bytes(&[(2, 2, 0x03, 0, b"nope")]);
        assert_eq!(
            SlotTable::parse(&bad).unwrap_err(),
            IrError::InvalidDefault(2)
        );
    }

    #[test]
    fn slot_data_new_from_defaults_bool_true() {
        let bytes = build_slot_table_bytes(&[
            (0, 0, 0x02, 0x00, b"true"), // Bool, Server, default "true"
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        assert!(matches!(data.get(0), SlotValue::Bool(true)));
    }

    #[test]
    fn slot_data_nonempty_object_default_is_refused_at_load() {
        let bytes = build_slot_table_bytes(&[(0, 0, 0x05, 0, b"{}")]);
        assert_eq!(
            SlotTable::parse(&bytes).unwrap_err(),
            IrError::InvalidDefault(0)
        );
    }

    // -- from_json tests ---------------------------------------------------

    use crate::parser::test_helpers::{build_minimal_ir, encode_text};

    /// Helper to build an IrModule with slots whose names are in the string table.
    fn build_module_for_json(
        strings: &[&str],
        slot_decls: &[(u16, u32, u8, u8, &[u8])],
    ) -> IrModule {
        // Minimal opcodes: just a TEXT referencing string 0
        let opcodes = encode_text(0);
        let data = build_minimal_ir(strings, slot_decls, &opcodes, &[]);
        IrModule::parse(&data).unwrap()
    }

    #[test]
    fn from_json_basic() {
        // strings: 0="title", 1="count"
        // slot 0: name_str_idx=0 (title), type=Text
        // slot 1: name_str_idx=1 (count), type=Number
        let module = build_module_for_json(
            &["title", "count"],
            &[
                (0, 0, 0x01, 0x00, &[]), // slot_id=0, name="title", Text, Server
                (1, 1, 0x03, 0x00, &[]), // slot_id=1, name="count", Number, Server
            ],
        );

        let data = SlotData::from_json(r#"{"title": "Hello", "count": 42}"#, &module).unwrap();
        assert_eq!(data.get(0).to_text(), "Hello");
        assert_eq!(data.get(1).to_text(), "42");
    }

    #[test]
    fn from_json_missing_key_uses_default() {
        // slot 0: name="greeting", Text, default "hi"
        let module = build_module_for_json(
            &["greeting"],
            &[
                (0, 0, 0x01, 0x00, b"hi"), // slot_id=0, name="greeting", Text, Server, default "hi"
            ],
        );

        // JSON does not contain "greeting" key
        let data = SlotData::from_json(r#"{}"#, &module).unwrap();
        assert_eq!(data.get(0).to_text(), "hi");
    }

    #[test]
    fn from_json_null_value() {
        let module = build_module_for_json(&["name"], &[(0, 0, 0x01, 0x00, &[])]);

        let data = SlotData::from_json(r#"{"name": null}"#, &module).unwrap();
        assert!(matches!(data.get(0), SlotValue::Null));
    }

    #[test]
    fn from_json_bool_values() {
        let module = build_module_for_json(
            &["active", "hidden"],
            &[
                (0, 0, 0x02, 0x00, &[]), // Bool
                (1, 1, 0x02, 0x00, &[]), // Bool
            ],
        );

        let data = SlotData::from_json(r#"{"active": true, "hidden": false}"#, &module).unwrap();
        assert!(matches!(data.get(0), SlotValue::Bool(true)));
        assert!(matches!(data.get(1), SlotValue::Bool(false)));
    }

    #[test]
    fn from_json_array() {
        let module = build_module_for_json(
            &["items"],
            &[(0, 0, 0x04, 0x00, &[])], // Array
        );

        let data = SlotData::from_json(r#"{"items": ["a", "b", 3]}"#, &module).unwrap();
        if let SlotValue::Array(arr) = data.get(0) {
            assert_eq!(arr.len(), 3);
            assert_eq!(arr[0].to_text(), "a");
            assert_eq!(arr[1].to_text(), "b");
            assert_eq!(arr[2].to_text(), "3");
        } else {
            panic!("expected Array, got {:?}", data.get(0));
        }
    }

    #[test]
    fn from_json_nested_object() {
        let module = build_module_for_json(
            &["config"],
            &[(0, 0, 0x05, 0x00, &[])], // Object
        );

        let data = SlotData::from_json(r#"{"config": {"key": "value", "n": 7}}"#, &module).unwrap();
        if let SlotValue::Object(pairs) = data.get(0) {
            assert_eq!(pairs.len(), 2);
            assert_eq!(pairs[0].0, "key");
            assert_eq!(pairs[0].1.to_text(), "value");
            assert_eq!(pairs[1].0, "n");
            assert_eq!(pairs[1].1.to_text(), "7");
        } else {
            panic!("expected Object, got {:?}", data.get(0));
        }
    }

    #[test]
    fn from_json_unknown_key_ignored() {
        let module = build_module_for_json(&["title"], &[(0, 0, 0x01, 0x00, &[])]);

        // "extra_key" is not in the slot table — should be silently ignored
        let data =
            SlotData::from_json(r#"{"title": "Hi", "extra_key": "ignored"}"#, &module).unwrap();
        assert_eq!(data.get(0).to_text(), "Hi");
    }

    #[test]
    fn from_json_invalid_json() {
        let module = build_module_for_json(&["x"], &[(0, 0, 0x01, 0x00, &[])]);

        let result = SlotData::from_json(r#"not valid json"#, &module);
        assert!(result.is_err());
        match result.unwrap_err() {
            crate::format::IrError::JsonParseError(_) => {} // expected
            other => panic!("expected JsonParseError, got {other:?}"),
        }
    }

    // -- ECMAScript number parity (F-05) ------------------------------------

    #[test]
    fn number_to_text_matches_javascript_string() {
        // Each row is (value, exactly what `String(value)` produces in JS).
        // The SSR text node must agree with the client renderer byte for byte.
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            // -0.0 stays on the integer fast path: String(-0) is "0", but
            // Rust's Display for -0.0 is "-0", so routing it through the
            // general path would silently regress it.
            (-0.0, "0"),
            (1.0, "1"),
            (-42.0, "-42"),
            (1.5, "1.5"),
            (123.456, "123.456"),
            (0.1, "0.1"),
            // Above 2^53 the fast path does not apply, but the general path
            // must still expand: this is the row that catches a naive
            // "above 2^53 means exponential" implementation.
            (1e16, "10000000000000000"),
            (1e20, "100000000000000000000"),
            // ...and 1e21 is where ECMAScript switches to exponent notation,
            // with an explicit '+' that Rust's {:e} does not write.
            (1e21, "1e+21"),
            (1e300, "1e+300"),
            (9007199254740992.0, "9007199254740992"), // 2^53
            (9007199254740994.0, "9007199254740994"), // beyond MAX_SAFE_INTEGER
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (-1.5e-7, "-1.5e-7"),
            (f64::MAX, "1.7976931348623157e+308"),
            // Only ±Infinity change here; Rust already prints "NaN".
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
            (f64::NAN, "NaN"),
        ];
        for (value, expected) in cases {
            assert_eq!(
                SlotValue::Number(*value).to_text(),
                *expected,
                "String({value:?})"
            );
        }
    }

    #[test]
    fn number_to_text_never_saturates_above_i64() {
        // `*n as i64` saturates at 2^63, which silently corrupted every value
        // above it into 9223372036854775807.
        let huge = 1e19_f64; // > i64::MAX, integral
        assert_eq!(SlotValue::Number(huge).to_text(), "10000000000000000000");
        assert!(!SlotValue::Number(huge)
            .to_text()
            .contains("9223372036854775807"));
    }

    #[test]
    fn number_to_json_round_trips_by_value_not_by_text() {
        // serde emits `1e16` where JS emits `10000000000000000` — different
        // bytes, identical parsed f64. Props are consumed with JSON.parse and
        // never string-compared, so assert on the parsed value.
        for value in [0.0_f64, -0.0, 1.5, 1e16, 1e21, 1e300, -1e19] {
            let json = SlotValue::Number(value).to_json();
            let parsed: f64 = json.as_f64().unwrap_or_else(|| panic!("{value} -> {json}"));
            assert_eq!(parsed, value, "value {value} did not round-trip");
        }
    }

    #[test]
    fn number_to_json_non_finite_is_null_matching_js() {
        // NOT a residual defect: JSON.stringify(Infinity) is null in JS too,
        // so `null` here while to_text says "Infinity" is exactly ES-faithful.
        for value in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
            assert_eq!(SlotValue::Number(value).to_json(), serde_json::Value::Null);
        }
    }

    // -- Slot writes past the end (F-16) ------------------------------------

    #[test]
    fn set_grows_instead_of_silently_dropping() {
        // A LIST whose item_slot_id exceeded the SlotData length used to make
        // every row render identically, with no error anywhere.
        let mut data = SlotData::new(1);
        data.set(5, SlotValue::Text("late".into()));
        assert_eq!(data.get(5).to_text(), "late");
        // Intervening slots are Null, not garbage.
        assert!(matches!(data.get(3), SlotValue::Null));
    }
}
