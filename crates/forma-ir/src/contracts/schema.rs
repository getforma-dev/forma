//! Canonical component-local schema, with iterative graph validation.
use super::{invalid, text};
use crate::format::{limit, IrError, MAX_SCHEMA_ITEMS, MAX_TYPE_DEPTH, SECTION_ISLAND_CONTRACTS};
use crate::parser::StringTable;
use crate::schema::{Cursor, PropType, PropsSchema};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Type {
    Boolean,
    String,
    Number,
    Date,
    Enum(Vec<String>),
    Array(Box<Type>),
    Optional(Box<Type>),
    Object(u16),
}
#[derive(Debug, Clone)]
pub(crate) struct Schema {
    pub(crate) objects: Vec<Vec<(String, Type)>>,
}

fn read_type(r: &mut Cursor<'_>, count: usize, depth: usize) -> Result<Type, IrError> {
    limit("contract type wrappers", depth, MAX_TYPE_DEPTH)?;
    Ok(match r.u8()? {
        1 => Type::Boolean,
        2 => Type::String,
        3 => Type::Number,
        4 => Type::Date,
        5 => {
            let n = r.u16()? as usize;
            limit("contract enum variants", n, MAX_SCHEMA_ITEMS)?;
            r.bound(n, 2)?;
            if n == 0 {
                return Err(invalid("empty contract enum"));
            }
            let mut values = Vec::with_capacity(n);
            for _ in 0..n {
                let name = text(r)?;
                if values.last().is_some_and(|last| last >= &name) {
                    return Err(invalid("contract enum is not unique UTF-8 order"));
                }
                values.push(name);
            }
            Type::Enum(values)
        }
        6 => Type::Array(Box::new(read_type(r, count, depth + 1)?)),
        7 => {
            let child = read_type(r, count, depth + 1)?;
            if matches!(child, Type::Optional(_)) {
                return Err(invalid("nested optional must be normalized"));
            }
            Type::Optional(Box::new(child))
        }
        8 => {
            let id = r.u16()?;
            if id as usize >= count {
                return Err(invalid("contract object index out of range"));
            }
            Type::Object(id)
        }
        _ => return Err(invalid("unknown contract schema type")),
    })
}
fn object_ref(kind: &Type) -> Option<usize> {
    let mut current = kind;
    loop {
        match current {
            Type::Array(child) | Type::Optional(child) => current = child,
            Type::Object(id) => return Some(*id as usize),
            _ => return None,
        }
    }
}
fn forbidden(name: &str) -> bool {
    matches!(name, "__proto__" | "constructor" | "prototype")
}

impl Schema {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, IrError> {
        let mut r = Cursor::new(bytes);
        if r.u8()? != 1 {
            return Err(invalid("unknown contract schema version"));
        }
        let count = r.u16()? as usize;
        limit("contract schema objects", count, MAX_SCHEMA_ITEMS)?;
        r.bound(count, 2)?;
        if count == 0 {
            return Err(invalid("contract schema needs object zero"));
        }
        let mut objects = Vec::with_capacity(count);
        for _ in 0..count {
            let n = r.u16()? as usize;
            limit("contract schema fields", n, MAX_SCHEMA_ITEMS)?;
            r.bound(n, 3)?;
            let mut fields: Vec<(String, Type)> = Vec::with_capacity(n);
            for _ in 0..n {
                let name = text(&mut r)?;
                if forbidden(&name) || fields.last().is_some_and(|(last, _)| last >= &name) {
                    return Err(invalid("forbidden, duplicate or unordered contract field"));
                }
                fields.push((name, read_type(&mut r, count, 0)?));
            }
            objects.push(fields);
        }
        r.finish(SECTION_ISLAND_CONTRACTS)?;
        let schema = Self { objects };
        let order = schema.order(0, true)?;
        let mut shapes = HashMap::new();
        schema.intern(&order, &mut shapes, true)?;
        Ok(schema)
    }

    // Postorder plus preorder numbering, without expanding shared object graphs.
    fn order(&self, root: usize, canonical: bool) -> Result<Vec<usize>, IrError> {
        if root >= self.objects.len() {
            return Err(invalid("missing schema root"));
        }
        let mut colors = vec![0u8; self.objects.len()];
        let mut next_index = 1;
        colors[root] = 1;
        let mut stack = vec![(root, 0usize)];
        let mut order = Vec::new();
        while let Some((id, field)) = stack.last_mut() {
            if *field == self.objects[*id].len() {
                colors[*id] = 2;
                order.push(*id);
                stack.pop();
                continue;
            }
            let (name, kind) = &self.objects[*id][*field];
            *field += 1;
            if forbidden(name) {
                return Err(invalid("forbidden declared island field"));
            }
            if let Some(child) = object_ref(kind) {
                if child >= colors.len() {
                    return Err(invalid("object reference out of range"));
                }
                match colors[child] {
                    1 => return Err(invalid("cyclic contract schema")),
                    0 => {
                        if canonical && child != next_index {
                            return Err(invalid("noncanonical object preorder"));
                        }
                        next_index += 1;
                        colors[child] = 1;
                        stack.push((child, 0));
                    }
                    _ => {}
                }
            }
        }
        if canonical && colors.contains(&0) {
            return Err(invalid("unreachable contract schema object"));
        }
        Ok(order)
    }
    fn intern(
        &self,
        order: &[usize],
        shapes: &mut HashMap<Vec<(String, Type)>, u16>,
        reject_duplicates: bool,
    ) -> Result<Vec<Option<u16>>, IrError> {
        let mut ids = vec![None; self.objects.len()];
        for &id in order {
            let fields: Vec<_> = self.objects[id]
                .iter()
                .map(|(name, kind)| Ok((name.clone(), shape(kind, &ids)?)))
                .collect::<Result<_, IrError>>()?;
            let next =
                u16::try_from(shapes.len()).map_err(|_| invalid("too many schema shapes"))?;
            let number = match shapes.get(&fields) {
                Some(&existing) if !reject_duplicates => existing,
                Some(_) => return Err(invalid("duplicate structural contract object")),
                None => {
                    shapes.insert(fields, next);
                    next
                }
            };
            ids[id] = Some(number);
        }
        Ok(ids)
    }
    pub(crate) fn matches_global(
        &self,
        global: &PropsSchema,
        strings: &StringTable,
        root: u16,
    ) -> Result<(), IrError> {
        fn convert(kind: &PropType, strings: &StringTable) -> Result<Type, IrError> {
            Ok(match kind {
                PropType::Boolean => Type::Boolean,
                PropType::String => Type::String,
                PropType::Number => Type::Number,
                PropType::Date => Type::Date,
                PropType::Enum(values) => {
                    let mut names = values
                        .iter()
                        .map(|id| strings.get(*id).map(str::to_owned))
                        .collect::<Result<Vec<_>, _>>()?;
                    names.sort();
                    Type::Enum(names)
                }
                PropType::Array(child) => Type::Array(Box::new(convert(child, strings)?)),
                PropType::Optional(child) => {
                    let kind = convert(child, strings)?;
                    if matches!(kind, Type::Optional(_)) {
                        kind
                    } else {
                        Type::Optional(Box::new(kind))
                    }
                }
                PropType::Object(id) => Type::Object(*id),
            })
        }
        let mut objects = Vec::with_capacity(global.objects.len());
        for fields in &global.objects {
            let mut converted = fields
                .iter()
                .map(|field| {
                    Ok((
                        strings.get(field.name)?.to_owned(),
                        convert(&field.kind, strings)?,
                    ))
                })
                .collect::<Result<Vec<_>, IrError>>()?;
            converted.sort_by(|a, b| a.0.cmp(&b.0));
            objects.push(converted);
        }
        let other = Self { objects };
        let mut shapes = HashMap::new();
        let ours = self.intern(&self.order(0, false)?, &mut shapes, false)?;
        let theirs = other.intern(&other.order(root as usize, false)?, &mut shapes, false)?;
        if ours[0] != theirs[root as usize] {
            return Err(invalid(
                "island local schema differs from declared global schema",
            ));
        }
        Ok(())
    }
}
fn shape(kind: &Type, ids: &[Option<u16>]) -> Result<Type, IrError> {
    Ok(match kind {
        Type::Object(id) => Type::Object(
            ids.get(*id as usize)
                .copied()
                .flatten()
                .ok_or_else(|| invalid("schema not in postorder"))?,
        ),
        Type::Array(child) => Type::Array(Box::new(shape(child, ids)?)),
        Type::Optional(child) => Type::Optional(Box::new(shape(child, ids)?)),
        other => other.clone(),
    })
}
