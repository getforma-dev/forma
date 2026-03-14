use crate::format::{IrError, SlotType};
use crate::parser::{IrModule, SlotTable};

/// Runtime values populated by page handlers before IR walking.
#[derive(Debug, Clone)]
pub enum SlotValue {
    Null,
    Text(String),
    Bool(bool),
    Number(f64),
    Array(Vec<SlotValue>),
    Object(Vec<(String, SlotValue)>),
}

/// A static Null reference returned for out-of-bounds slot lookups.
static NULL_SLOT: SlotValue = SlotValue::Null;

impl SlotValue {
    /// Render to string for DYN_TEXT output.
    pub fn to_text(&self) -> String {
        match self {
            SlotValue::Null => String::new(),
            SlotValue::Text(s) => s.clone(),
            SlotValue::Bool(true) => "true".to_string(),
            SlotValue::Bool(false) => "false".to_string(),
            SlotValue::Number(n) => {
                if n.fract() == 0.0 && n.is_finite() {
                    format!("{}", *n as i64)
                } else {
                    // Format with enough precision, then trim trailing zeros
                    let s = format!("{}", n);
                    s
                }
            }
            SlotValue::Array(_) => "[Array]".to_string(),
            SlotValue::Object(_) => "[Object]".to_string(),
        }
    }

    /// Truthiness for SHOW_IF evaluation.
    pub fn as_bool(&self) -> bool {
        match self {
            SlotValue::Null => false,
            SlotValue::Bool(b) => *b,
            SlotValue::Text(s) => !s.is_empty(),
            SlotValue::Number(n) => *n != 0.0,
            SlotValue::Array(a) => !a.is_empty(),
            SlotValue::Object(_) => true,
        }
    }

    /// Extract a named property from an Object. Returns Null if not Object or key not found.
    pub fn get_property(&self, name: &str) -> SlotValue {
        match self {
            SlotValue::Object(pairs) => {
                for (k, v) in pairs {
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
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            SlotValue::Null => serde_json::Value::Null,
            SlotValue::Text(s) => serde_json::Value::String(s.clone()),
            SlotValue::Bool(b) => serde_json::Value::Bool(*b),
            SlotValue::Number(n) => {
                if n.fract() == 0.0 && n.is_finite() {
                    serde_json::Value::Number(
                        serde_json::Number::from(*n as i64),
                    )
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
    pub fn new(capacity: usize) -> Self {
        let mut slots = Vec::with_capacity(capacity);
        slots.resize_with(capacity, || SlotValue::Null);
        Self { slots }
    }

    /// Set a slot value. No-op if slot_id is out of bounds.
    pub fn set(&mut self, slot_id: u16, value: SlotValue) {
        let idx = slot_id as usize;
        if idx < self.slots.len() {
            self.slots[idx] = value;
        }
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
        let parsed: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| IrError::JsonParseError(e.to_string()))?;

        let obj = match parsed {
            serde_json::Value::Object(map) => map,
            _ => return Err(IrError::JsonParseError("expected JSON object".to_string())),
        };

        // Build name → slot_id map from the slot table + string table
        let mut name_to_slot: std::collections::HashMap<String, u16> =
            std::collections::HashMap::new();
        for entry in module.slots.entries() {
            if let Ok(name) = module.strings.get(entry.name_str_idx) {
                name_to_slot.insert(name.to_string(), entry.slot_id);
            }
        }

        // Start from defaults
        let mut data = Self::new_from_defaults(&module.slots);

        // Override with JSON values
        for (key, value) in &obj {
            if let Some(&slot_id) = name_to_slot.get(key) {
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
                        SlotValue::Array(vec![])
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
        serde_json::Value::Number(n) => {
            SlotValue::Number(n.as_f64().unwrap_or(0.0))
        }
        serde_json::Value::Array(arr) => {
            SlotValue::Array(arr.iter().map(json_to_slot_value).collect())
        }
        serde_json::Value::Object(map) => {
            SlotValue::Object(
                map.iter()
                    .map(|(k, v)| (k.clone(), json_to_slot_value(v)))
                    .collect(),
            )
        }
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
    fn slot_value_as_bool_truthy() {
        assert!(SlotValue::Text("x".to_string()).as_bool());
        assert!(SlotValue::Number(1.0).as_bool());
        assert!(SlotValue::Bool(true).as_bool());
        assert!(SlotValue::Array(vec![SlotValue::Null]).as_bool());
        assert!(SlotValue::Object(vec![]).as_bool());
    }

    #[test]
    fn slot_value_as_bool_falsy() {
        assert!(!SlotValue::Null.as_bool());
        assert!(!SlotValue::Text("".to_string()).as_bool());
        assert!(!SlotValue::Number(0.0).as_bool());
        assert!(!SlotValue::Bool(false).as_bool());
        assert!(!SlotValue::Array(vec![]).as_bool());
    }

    #[test]
    fn slot_value_as_array() {
        let arr = SlotValue::Array(vec![SlotValue::Text("a".to_string())]);
        assert!(arr.as_array().is_some());
        assert_eq!(arr.as_array().unwrap().len(), 1);

        assert!(SlotValue::Null.as_array().is_none());
        assert!(SlotValue::Text("x".to_string()).as_array().is_none());
        assert!(SlotValue::Number(1.0).as_array().is_none());
        assert!(SlotValue::Bool(true).as_array().is_none());
        assert!(SlotValue::Object(vec![]).as_array().is_none());
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
            (2, 2, 0x03, 0x00, b"nope"), // Number, Server, invalid default
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        assert!(matches!(data.get(0), SlotValue::Number(n) if (*n - 42.0).abs() < f64::EPSILON));
        assert!(matches!(data.get(1), SlotValue::Number(n) if (*n - 3.15).abs() < f64::EPSILON));
        // Invalid number -> Null
        assert!(matches!(data.get(2), SlotValue::Null));
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
    fn slot_data_new_from_defaults_object_ignored() {
        // Object type always yields Null even with default bytes
        let bytes = build_slot_table_bytes(&[
            (0, 0, 0x05, 0x00, b"{}"), // Object, Server, default "{}"
        ]);
        let table = SlotTable::parse(&bytes).unwrap();
        let data = SlotData::new_from_defaults(&table);

        assert!(matches!(data.get(0), SlotValue::Null));
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
        let module = build_module_for_json(
            &["name"],
            &[(0, 0, 0x01, 0x00, &[])],
        );

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
        let module = build_module_for_json(
            &["title"],
            &[(0, 0, 0x01, 0x00, &[])],
        );

        // "extra_key" is not in the slot table — should be silently ignored
        let data = SlotData::from_json(r#"{"title": "Hi", "extra_key": "ignored"}"#, &module).unwrap();
        assert_eq!(data.get(0).to_text(), "Hi");
    }

    #[test]
    fn from_json_invalid_json() {
        let module = build_module_for_json(
            &["x"],
            &[(0, 0, 0x01, 0x00, &[])],
        );

        let result = SlotData::from_json(r#"not valid json"#, &module);
        assert!(result.is_err());
        match result.unwrap_err() {
            crate::format::IrError::JsonParseError(_) => {} // expected
            other => panic!("expected JsonParseError, got {other:?}"),
        }
    }
}
