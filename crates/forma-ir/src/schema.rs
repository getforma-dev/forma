//! FMIR v3 schema, key-path and source-position tables.

use crate::format::{
    limit, IrError, Opcode, MAX_KEY_SEGMENTS, MAX_SCHEMA_ITEMS, MAX_TYPE_DEPTH, SCHEMA_ARRAY,
    SCHEMA_BOOLEAN, SCHEMA_DATE, SCHEMA_ENUM, SCHEMA_NUMBER, SCHEMA_OBJECT, SCHEMA_OPTIONAL,
    SCHEMA_STRING, SECTION_KEY_PATHS, SECTION_PROPS_SCHEMA, SECTION_SOURCE_POSITIONS,
};
use crate::parser::StringTable;
use std::collections::HashSet;

/// One field's closed-set props type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PropType {
    /// Boolean value.
    Boolean,
    /// UTF-8 string.
    String,
    /// Number, checked for range at bind/render.
    Number,
    /// Date represented as epoch milliseconds.
    Date,
    /// Unit-enum string-table indices.
    Enum(Vec<u32>),
    /// Homogeneous array.
    Array(Box<PropType>),
    /// Optional value.
    Optional(Box<PropType>),
    /// Object-table index.
    Object(u16),
}
/// A props field and its declaration position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropField {
    /// Field name in the string table.
    pub name: u32,
    /// Project-relative declaring file in the string table.
    pub file: u32,
    /// One-based source line.
    pub line: u32,
    /// One-based UTF-16 source column.
    pub column: u32,
    /// Declared type.
    pub kind: PropType,
}
/// Props schema; object zero is always the page's props type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropsSchema {
    /// Objects in declaration order, containing fields in source order.
    pub objects: Vec<Vec<PropField>>,
}
/// The row-key property path attached to one LIST opcode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyPath {
    /// Bytecode offset of the LIST.
    pub list_offset: u32,
    /// Property names as string-table indices.
    pub segments: Vec<u32>,
}
/// Source location for an eligible structural opcode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourcePosition {
    /// Bytecode opcode offset.
    pub opcode_offset: u32,
    /// Project-relative file index.
    pub file: u32,
    /// One-based line.
    pub line: u32,
    /// One-based UTF-16 column.
    pub column: u32,
    /// Component name index.
    pub component: u32,
}

pub(crate) struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}
impl<'a> Cursor<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }
    pub(crate) fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }
    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8], IrError> {
        let end = self.pos.checked_add(n).ok_or(IrError::InvalidSection)?;
        let bytes = self
            .data
            .get(self.pos..end)
            .ok_or(IrError::BufferTooShort {
                expected: end,
                actual: self.data.len(),
            })?;
        self.pos = end;
        Ok(bytes)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, IrError> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u16(&mut self) -> Result<u16, IrError> {
        Ok(crate::format::le_u16(self.take(2)?))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, IrError> {
        Ok(crate::format::le_u32(self.take(4)?))
    }
    pub(crate) fn bound(&self, count: usize, min: usize) -> Result<(), IrError> {
        if count > self.remaining() / min {
            Err(IrError::BufferTooShort {
                expected: count.saturating_mul(min),
                actual: self.remaining(),
            })
        } else {
            Ok(())
        }
    }
    pub(crate) fn finish(&self, section: u16) -> Result<(), IrError> {
        if self.remaining() != 0 {
            Err(IrError::TrailingBytes { section })
        } else {
            Ok(())
        }
    }
    fn str_idx(&mut self, strings: &StringTable) -> Result<u32, IrError> {
        let i = self.u32()?;
        strings.get(i)?;
        Ok(i)
    }
}

impl PropsSchema {
    pub(crate) fn parse(data: &[u8], strings: &StringTable) -> Result<Self, IrError> {
        let mut r = Cursor::new(data);
        let count = r.u16()? as usize;
        limit("schema objects", count, MAX_SCHEMA_ITEMS)?;
        r.bound(count, 2)?;
        if count == 0 {
            return Err(IrError::InvalidSchema("object zero is required"));
        }
        let mut objects = Vec::with_capacity(count);
        let mut edges = Vec::with_capacity(count);
        for _ in 0..count {
            let n = r.u16()? as usize;
            limit("schema fields", n, MAX_SCHEMA_ITEMS)?;
            r.bound(n, 17)?;
            let mut fields = Vec::with_capacity(n);
            let mut names = HashSet::with_capacity(n);
            let mut refs = Vec::new();
            for _ in 0..n {
                let name = r.str_idx(strings)?;
                let file = r.str_idx(strings)?;
                let line = r.u32()?;
                let column = r.u32()?;
                if !names.insert(strings.get(name)?) {
                    return Err(IrError::InvalidSchema("duplicate field name"));
                }
                if line == 0 || column == 0 {
                    return Err(IrError::InvalidSchema(
                        "source coordinates must be positive",
                    ));
                }
                let kind = read_type(&mut r, strings, count, 0, &mut refs)?;
                fields.push(PropField {
                    name,
                    file,
                    line,
                    column,
                    kind,
                });
            }
            objects.push(fields);
            edges.push(refs);
        }
        r.finish(SECTION_PROPS_SCHEMA)?;
        // Iterative DFS: a 1,024-object chain does not consume the call stack.
        let mut color = vec![0u8; count];
        for root in 0..count {
            if color[root] != 0 {
                continue;
            }
            color[root] = 1;
            let mut stack = vec![(root, 0usize)];
            while let Some((node, next)) = stack.last_mut() {
                if *next == edges[*node].len() {
                    color[*node] = 2;
                    stack.pop();
                    continue;
                }
                let child = edges[*node][*next] as usize;
                *next += 1;
                match color[child] {
                    1 => return Err(IrError::InvalidSchema("cyclic object references")),
                    0 => {
                        color[child] = 1;
                        stack.push((child, 0));
                    }
                    _ => {}
                }
            }
        }
        Ok(Self { objects })
    }
}
fn read_type(
    r: &mut Cursor<'_>,
    strings: &StringTable,
    objects: usize,
    depth: usize,
    refs: &mut Vec<u16>,
) -> Result<PropType, IrError> {
    limit("schema type nesting", depth, MAX_TYPE_DEPTH)?;
    Ok(match r.u8()? {
        SCHEMA_BOOLEAN => PropType::Boolean,
        SCHEMA_STRING => PropType::String,
        SCHEMA_NUMBER => PropType::Number,
        SCHEMA_DATE => PropType::Date,
        SCHEMA_ENUM => {
            let n = r.u16()? as usize;
            limit("enum variants", n, MAX_SCHEMA_ITEMS)?;
            r.bound(n, 4)?;
            let mut v = Vec::with_capacity(n);
            for _ in 0..n {
                v.push(r.str_idx(strings)?);
            }
            PropType::Enum(v)
        }
        SCHEMA_ARRAY => PropType::Array(Box::new(read_type(r, strings, objects, depth + 1, refs)?)),
        SCHEMA_OPTIONAL => {
            let inner = read_type(r, strings, objects, depth + 1, refs)?;
            if matches!(inner, PropType::Optional(_)) {
                return Err(IrError::InvalidSchema("optional of optional"));
            }
            PropType::Optional(Box::new(inner))
        }
        SCHEMA_OBJECT => {
            let i = r.u16()?;
            if i as usize >= objects {
                return Err(IrError::InvalidSchema("object index out of range"));
            }
            refs.push(i);
            PropType::Object(i)
        }
        _ => return Err(IrError::InvalidSchema("unknown type tag")),
    })
}

pub(crate) fn key_paths(
    data: &[u8],
    strings: &StringTable,
    starts: &[(u32, Opcode)],
) -> Result<Vec<KeyPath>, IrError> {
    let mut r = Cursor::new(data);
    let count = r.u32()? as usize;
    r.bound(count, 9)?;
    limit(
        "key paths",
        count,
        starts.iter().filter(|(_, op)| *op == Opcode::List).count(),
    )?;
    let mut result = Vec::with_capacity(count);
    let mut previous = None;
    for _ in 0..count {
        let off = r.u32()?;
        let index = starts
            .binary_search_by_key(&off, |(o, _)| *o)
            .map_err(|_| IrError::InvalidKeyPath("offset is not a LIST boundary"))?;
        if starts[index].1 != Opcode::List || previous.is_some_and(|p| off <= p) {
            return Err(IrError::InvalidKeyPath(
                "offset is not a unique ascending LIST",
            ));
        }
        let n = r.u8()? as usize;
        if n == 0 {
            return Err(IrError::InvalidKeyPath("zero segments"));
        }
        limit("key segments", n, MAX_KEY_SEGMENTS)?;
        r.bound(n, 4)?;
        let mut segments = Vec::with_capacity(n);
        for _ in 0..n {
            segments.push(r.str_idx(strings)?);
        }
        result.push(KeyPath {
            list_offset: off,
            segments,
        });
        previous = Some(off);
    }
    r.finish(SECTION_KEY_PATHS)?;
    Ok(result)
}
pub(crate) fn source_positions(
    data: &[u8],
    strings: &StringTable,
    starts: &[(u32, Opcode)],
) -> Result<Vec<SourcePosition>, IrError> {
    let mut r = Cursor::new(data);
    let count = r.u32()? as usize;
    r.bound(count, 20)?;
    limit("source positions", count, starts.len())?;
    let mut result = Vec::with_capacity(count);
    let mut previous = None;
    for _ in 0..count {
        let off = r.u32()?;
        let index = starts
            .binary_search_by_key(&off, |(o, _)| *o)
            .map_err(|_| IrError::InvalidSourcePosition("not an opcode boundary"))?;
        if !matches!(
            starts[index].1,
            Opcode::OpenTag | Opcode::VoidTag | Opcode::IslandStart | Opcode::ShowIf | Opcode::List
        ) || previous.is_some_and(|p| off <= p)
        {
            return Err(IrError::InvalidSourcePosition(
                "ineligible or nonascending opcode",
            ));
        }
        let file = r.str_idx(strings)?;
        let line = r.u32()?;
        let column = r.u32()?;
        let component = r.str_idx(strings)?;
        if line == 0 || column == 0 {
            return Err(IrError::InvalidSourcePosition(
                "source coordinates must be positive",
            ));
        }
        result.push(SourcePosition {
            opcode_offset: off,
            file,
            line,
            column,
            component,
        });
        previous = Some(off);
    }
    r.finish(SECTION_SOURCE_POSITIONS)?;
    Ok(result)
}
