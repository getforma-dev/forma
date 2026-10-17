//! Checked, bounded request snapshots. No request slot is retained by this module.
use crate::format::{IrError, IslandEntry, MAX_ISLAND_STATE_BYTES};
use crate::parser::IrModule;
use crate::schema::{PropField, PropType};
use crate::slot::{SlotData, SlotValue};

const PREFIX: &str = "{\"v\":1,\"s\":[],\"i\":[";
const SUFFIX: &str = "]}";
static NULL: SlotValue = SlotValue::Null;

/// A complete, checked island-state envelope for one rendered page.
///
/// The encoded bytes own each occurrence's declared inputs as they were at its
/// ISLAND_START. They contain no references to mutable slots. Construction is
/// private, and the complete escaped UTF-8 envelope is capped at one MiB.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IslandState {
    json: String,
    count: usize,
}
impl IslandState {
    /// Compact JSON safe as the text of an application/json script: every `<`
    /// is escaped. The server places it once in the head and charges its bytes
    /// to the final response budget.
    pub fn as_json(&self) -> &str {
        &self.json
    }
    /// Whether the walk executed no island occurrences.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
    /// Number of executed island occurrences, including repeated list rows.
    pub fn len(&self) -> usize {
        self.count
    }
}

pub(crate) struct StateBuilder {
    encoded: String,
    count: usize,
}
impl StateBuilder {
    pub(crate) fn new() -> Self {
        Self {
            encoded: PREFIX.to_owned(),
            count: 0,
        }
    }
    /// Encode directly into capped owned storage, transactionally. The suffix
    /// is reserved on every append; a failed entry is discarded in its entirety.
    pub(crate) fn snapshot(
        &mut self,
        module: &IrModule,
        entry: &IslandEntry,
        slots: &SlotData,
    ) -> Result<(usize, String), IrError> {
        let before = self.encoded.len();
        let occurrence = self.count;
        let hash = entry
            .digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let result = (|| {
            if entry.digest.len() != 8 {
                return Err(invalid(entry.id, &[], "identity digest is not eight bytes"));
            }
            let fields = module
                .schema
                .objects
                .get(entry.schema_object as usize)
                .ok_or_else(|| invalid(entry.id, &[], "missing declared island object"))?;
            if fields.len() != entry.slot_ids.len() {
                return Err(invalid(
                    entry.id,
                    &[],
                    "ordered input count differs from declared fields",
                ));
            }
            if occurrence > 0 {
                self.push(",")?;
            }
            self.push("{\"h\":\"")?;
            self.push(&hash)?;
            self.push("\",\"p\":")?;
            self.project(
                module,
                entry.id,
                Task::Object {
                    fields,
                    values: ObjectValues::Inputs(&entry.slot_ids, slots),
                    index: 0,
                    emitted: false,
                },
            )?;
            self.push("}")?;
            Ok(())
        })();
        if let Err(error) = result {
            self.encoded.truncate(before);
            return Err(error);
        }
        self.count += 1;
        Ok((occurrence, hash))
    }
    pub(crate) fn finish(mut self) -> Result<IslandState, IrError> {
        let charged = self
            .encoded
            .len()
            .checked_add(SUFFIX.len())
            .ok_or_else(limit)?;
        if charged > MAX_ISLAND_STATE_BYTES {
            return Err(limit());
        }
        self.encoded.push_str(SUFFIX);
        // Finalization reads only owned bytes, never the module or slots.
        if self.encoded.len() != charged {
            return Err(limit());
        }
        Ok(IslandState {
            json: self.encoded,
            count: self.count,
        })
    }
    fn push(&mut self, text: &str) -> Result<(), IrError> {
        let next = self
            .encoded
            .len()
            .checked_add(text.len())
            .and_then(|n| n.checked_add(SUFFIX.len()))
            .ok_or_else(limit)?;
        if next > MAX_ISLAND_STATE_BYTES {
            return Err(limit());
        }
        self.encoded.push_str(text);
        Ok(())
    }
    fn string(&mut self, text: &str) -> Result<(), IrError> {
        self.push("\"")?;
        for ch in text.chars() {
            match ch {
                '"' => self.push("\\\"")?,
                '\\' => self.push("\\\\")?,
                '\n' => self.push("\\n")?,
                '\r' => self.push("\\r")?,
                '\t' => self.push("\\t")?,
                '\u{08}' => self.push("\\b")?,
                '\u{0c}' => self.push("\\f")?,
                '<' => self.push("\\u003c")?,
                '\0'..='\u{1f}' => {
                    self.push(&format!("\\u{:04x}", ch as u8))?;
                }
                _ => {
                    let mut bytes = [0; 4];
                    self.push(ch.encode_utf8(&mut bytes))?;
                }
            }
        }
        self.push("\"")
    }
    fn project<'a>(
        &mut self,
        module: &'a IrModule,
        island: u16,
        first: Task<'a>,
    ) -> Result<(), IrError> {
        let mut tasks = vec![first];
        let mut path = Vec::new();
        // Array and object frames schedule one child at a time. The work stack
        // is bounded by the already validated acyclic schema, not request size.
        while let Some(task) = tasks.pop() {
            match task {
                Task::PathEnd => {
                    path.pop();
                }
                Task::Value(kind, value) => match (kind, value) {
                    (PropType::Optional(_), SlotValue::Null) => self.push("null")?,
                    (PropType::Optional(inner), _) => tasks.push(Task::Value(inner, value)),
                    (PropType::Boolean, SlotValue::Bool(value)) => {
                        self.push(if *value { "true" } else { "false" })?
                    }
                    (PropType::String, SlotValue::Text(value)) => self.string(value)?,
                    (PropType::Number, SlotValue::Number(number)) if number.is_finite() => {
                        self.push(&value.to_text())?
                    }
                    (PropType::Date, SlotValue::Number(number))
                        if number.is_finite()
                            && number.fract() == 0.0
                            && number.abs() <= 8_640_000_000_000_000.0 =>
                    {
                        self.push(&value.to_text())?
                    }
                    (PropType::Enum(members), SlotValue::Text(value))
                        if members.iter().any(|id| {
                            module.strings.get(*id).is_ok_and(|member| member == value)
                        }) =>
                    {
                        self.string(value)?
                    }
                    (PropType::Array(inner), SlotValue::Array(values)) => tasks.push(Task::Array {
                        kind: inner,
                        values,
                        index: 0,
                    }),
                    (PropType::Object(id), SlotValue::Object(values)) => {
                        let fields = module
                            .schema
                            .objects
                            .get(*id as usize)
                            .ok_or_else(|| invalid(island, &path, "missing declared object"))?;
                        tasks.push(Task::Object {
                            fields,
                            values: ObjectValues::Named(values),
                            index: 0,
                            emitted: false,
                        });
                    }
                    _ => return Err(invalid(island, &path, "missing or invalid declared value")),
                },
                Task::Array {
                    kind,
                    values,
                    index,
                } => {
                    if index == 0 {
                        self.push("[")?;
                    }
                    if let Some(value) = values.get(index) {
                        if index > 0 {
                            self.push(",")?;
                        }
                        tasks.push(Task::Array {
                            kind,
                            values,
                            index: index + 1,
                        });
                        path.push(Path::Index(index));
                        tasks.push(Task::PathEnd);
                        tasks.push(Task::Value(kind, value));
                    } else {
                        self.push("]")?;
                    }
                }
                Task::Object {
                    fields,
                    values,
                    index,
                    emitted,
                } => {
                    if index == 0 {
                        self.push("{")?;
                    }
                    if let Some(field) = fields.get(index) {
                        let name = module.strings.get(field.name)?;
                        let value = match values {
                            ObjectValues::Inputs(ids, slots) => slots.get(ids[index]),
                            ObjectValues::Named(entries) => {
                                let mut matches = entries.iter().filter(|(key, _)| key == name);
                                let value = matches.next().map_or(&NULL, |(_, value)| value);
                                if matches.next().is_some() {
                                    path.push(Path::Field(name));
                                    return Err(invalid(
                                        island,
                                        &path,
                                        "duplicate declared input field",
                                    ));
                                }
                                value
                            }
                        };
                        if matches!(field.kind, PropType::Optional(_))
                            && matches!(value, SlotValue::Null)
                        {
                            tasks.push(Task::Object {
                                fields,
                                values,
                                index: index + 1,
                                emitted,
                            });
                            continue;
                        }
                        if emitted {
                            self.push(",")?;
                        }
                        self.string(name)?;
                        self.push(":")?;
                        tasks.push(Task::Object {
                            fields,
                            values,
                            index: index + 1,
                            emitted: true,
                        });
                        path.push(Path::Field(name));
                        tasks.push(Task::PathEnd);
                        tasks.push(Task::Value(&field.kind, value));
                    } else {
                        self.push("}")?;
                    }
                }
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy)]
enum ObjectValues<'a> {
    Inputs(&'a [u16], &'a SlotData),
    Named(&'a [(String, SlotValue)]),
}
enum Task<'a> {
    Value(&'a PropType, &'a SlotValue),
    Array {
        kind: &'a PropType,
        values: &'a [SlotValue],
        index: usize,
    },
    Object {
        fields: &'a [PropField],
        values: ObjectValues<'a>,
        index: usize,
        emitted: bool,
    },
    PathEnd,
}
enum Path<'a> {
    Field(&'a str),
    Index(usize),
}
fn invalid(island: u16, path: &[Path<'_>], reason: &'static str) -> IrError {
    use std::fmt::Write;
    let mut name = String::from("$");
    for segment in path {
        match segment {
            Path::Field(field) => {
                let _ = write!(name, "[{field:?}]");
            }
            Path::Index(index) => {
                let _ = write!(name, "[{index}]");
            }
        }
    }
    IrError::InvalidIslandState(Box::new(crate::format::IslandStateViolation {
        island,
        path: name,
        reason,
    }))
}
fn limit() -> IrError {
    IrError::IslandStateLimitExceeded {
        limit: MAX_ISLAND_STATE_BYTES,
    }
}
