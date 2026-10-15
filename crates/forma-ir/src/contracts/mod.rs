//! Validated component-local island contracts (required section0x000A).
mod bindings;
mod constant;
mod flow;
mod schema;
pub(crate) mod state;
use crate::format::{
    limit, IrError, SlotSource, MAX_CONTRACT_BYTES, MAX_ISLANDS, MAX_SLOTS,
    SECTION_ISLAND_CONTRACTS,
};
use crate::parser::IrModule;
use crate::schema::Cursor;
use crate::slot::SlotValue;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub(crate) struct IslandContract {
    pub(crate) mode: u8,
    pub(crate) binding_bytes: Vec<u8>,
    pub(crate) schema_bytes: Vec<u8>,
    schema: schema::Schema,
}
#[derive(Debug, Clone, Default)]
pub(crate) struct Contracts {
    pub(crate) islands: BTreeMap<u16, IslandContract>,
    pub(crate) constants: BTreeMap<u16, SlotValue>,
}
fn invalid(reason: &'static str) -> IrError {
    IrError::InvalidSchema(reason)
}
fn text(r: &mut Cursor<'_>) -> Result<String, IrError> {
    let length = r.u16()? as usize;
    std::str::from_utf8(r.take(length)?)
        .map(str::to_owned)
        .map_err(|error| IrError::InvalidUtf8(error.to_string()))
}
impl Contracts {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, IrError> {
        let mut r = Cursor::new(bytes);
        let count = r.u16()? as usize;
        limit("island contracts", count, MAX_ISLANDS)?;
        if r.remaining() < 2 {
            return Err(invalid("island contract section has no constant count"));
        }
        if count > (r.remaining() - 2) / 23 {
            return Err(invalid("truncated island contract records"));
        }
        let mut islands = BTreeMap::new();
        let mut previous = None;
        for _ in 0..count {
            let record_len = r.u32()? as usize;
            let mut record = Cursor::new(r.take(record_len)?);
            let id = record.u16()?;
            if previous.is_some_and(|last| last >= id) {
                return Err(invalid("island contracts are not in unique id order"));
            }
            previous = Some(id);
            let n = record.u32()? as usize;
            limit("binding program bytes", n, MAX_CONTRACT_BYTES)?;
            let binding_bytes = record.take(n)?.to_vec();
            let n = record.u32()? as usize;
            limit("canonical schema bytes", n, MAX_CONTRACT_BYTES)?;
            let schema_bytes = record.take(n)?.to_vec();
            record.finish(SECTION_ISLAND_CONTRACTS)?;
            let schema = schema::Schema::parse(&schema_bytes)?;
            let mode = bindings::validate(&binding_bytes, &schema)?;
            islands.insert(
                id,
                IslandContract {
                    mode,
                    binding_bytes,
                    schema_bytes,
                    schema,
                },
            );
        }
        let count = r.u16()? as usize;
        limit("closed constants", count, MAX_SLOTS)?;
        r.bound(count, 7)?;
        let mut constants = BTreeMap::new();
        let mut previous = None;
        for _ in 0..count {
            let id = r.u16()?;
            if previous.is_some_and(|last| last >= id) {
                return Err(invalid("closed constants are not in unique slot order"));
            }
            previous = Some(id);
            let size = r.u32()? as usize;
            limit("closed constant bytes", size, MAX_CONTRACT_BYTES)?;
            let mut value = Cursor::new(r.take(size)?);
            let parsed = constant::read(&mut value)?;
            value.finish(SECTION_ISLAND_CONTRACTS)?;
            constants.insert(id, parsed);
        }
        r.finish(SECTION_ISLAND_CONTRACTS)?;
        Ok(Self { islands, constants })
    }
    pub(crate) fn validate(
        &self,
        module: &IrModule,
        starts: &[(u32, crate::format::Opcode)],
    ) -> Result<(), IrError> {
        if self.islands.len() != module.islands.len() {
            return Err(invalid("one contract per island is required"));
        }
        for island in module.islands.entries() {
            let contract = self
                .islands
                .get(&island.id)
                .ok_or_else(|| invalid("missing island contract record"))?;
            if island.digest.len() != 8 || island.schema_object == 0xffff {
                return Err(invalid(
                    "islands need an eight-byte digest and declared schema",
                ));
            }
            let fields = module
                .schema
                .objects
                .get(island.schema_object as usize)
                .ok_or_else(|| invalid("island schema is absent"))?;
            if island.slot_ids.len() != fields.len() {
                return Err(invalid(
                    "ordered island inputs do not match declared fields",
                ));
            }
            contract.schema.matches_global(
                &module.schema,
                &module.strings,
                island.schema_object,
            )?;
        }
        for id in self.constants.keys() {
            let slot = module.slot_entry(*id).ok_or(IrError::UnknownSlotId(*id))?;
            if slot.source != SlotSource::Client || !slot.default_bytes.is_empty() {
                return Err(invalid(
                    "closed constant must own a CLIENT slot with empty legacy default",
                ));
            }
        }
        flow::validate(module, starts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(s: &str) -> Vec<u8> {
        s.as_bytes()
            .chunks_exact(2)
            .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
            .collect()
    }
    #[test]
    fn independent_paper_vectors_parse_exactly() {
        let all: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/island-contracts/wire-vectors.json"
        ))
        .unwrap();
        for vector in all["vectors"].as_array().unwrap() {
            let contracts = Contracts::parse(&hex(vector["sectionHex"].as_str().unwrap()))
                .unwrap_or_else(|error| panic!("{}: {error}", vector["name"]));
            let entry = contracts.islands.get(&7).unwrap();
            assert_eq!(
                entry.binding_bytes,
                hex(vector["bindingHex"].as_str().unwrap())
            );
            assert_eq!(
                entry.schema_bytes,
                hex(vector["schemaHex"].as_str().unwrap())
            );
        }
    }
    #[test]
    fn canonical_schema_rejects_duplicate_shapes_unreachable_and_cycles() {
        for bytes in [
            "01020000000000",
            "0101000100010061080000",
            "010300020001006108010001006208020000000000",
        ] {
            assert!(schema::Schema::parse(&hex(bytes)).is_err(), "{bytes}");
        }
    }
    #[test]
    fn count_limits_precede_truncation() {
        assert_eq!(
            Contracts::parse(&4097u16.to_le_bytes()).unwrap_err().code(),
            "LOAD-107"
        );
        assert_eq!(
            schema::Schema::parse(&[1, 1, 4]).unwrap_err().code(),
            "LOAD-107"
        );
        let mut cursor = Cursor::new(&[5, 0, 0, 1, 0]);
        assert_eq!(constant::read(&mut cursor).unwrap_err().code(), "LOAD-107");
    }
    #[test]
    fn constants_keep_empty_and_null_distinct_and_require_finite_canonical_numbers() {
        assert!(
            matches!(constant::read(&mut Cursor::new(&[4,0,0])).unwrap(), SlotValue::Text(s) if s.is_empty())
        );
        assert!(matches!(
            constant::read(&mut Cursor::new(&[0])).unwrap(),
            SlotValue::Null
        ));
        for value in [f64::NAN, f64::INFINITY, -0.0] {
            let mut bytes = vec![3];
            bytes.extend(value.to_le_bytes());
            assert_eq!(
                constant::read(&mut Cursor::new(&bytes)).unwrap_err().code(),
                "LOAD-103"
            );
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod native_tests;
