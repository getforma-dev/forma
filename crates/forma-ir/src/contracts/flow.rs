//! Typed bytecode provenance. Branch journals avoid cloning the entire slot
//! table per control region; unions live in an indexed arena, never deep boxes.
use super::invalid;
use crate::format::{le_u16, le_u32, IrError, Opcode, SlotSource, SlotType};
use crate::parser::IrModule;
use crate::schema::PropType;
use crate::slot::{SlotData, SlotValue};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone)]
enum Known {
    Type(PropType),
    Literal(SlotValue),
    Either(usize, usize),
    Never,
}
struct Env {
    values: Vec<Option<usize>>,
    journal: Vec<(u16, Option<usize>)>,
}
impl Env {
    fn set(&mut self, id: u16, value: Option<usize>) {
        self.journal.push((id, self.values[id as usize]));
        self.values[id as usize] = value;
    }
    fn read(&self, id: u16) -> Result<usize, IrError> {
        self.values[id as usize]
            .ok_or_else(|| invalid("slot definition does not dominate this use"))
    }
    fn restore(&mut self, mark: usize) -> BTreeMap<u16, Option<usize>> {
        let mut delta = BTreeMap::new();
        while self.journal.len() > mark {
            if let Some((id, previous)) = self.journal.pop() {
                delta.entry(id).or_insert(self.values[id as usize]);
                self.values[id as usize] = previous;
            }
        }
        delta
    }
}
struct Flow<'a> {
    module: &'a IrModule,
    arena: Vec<Known>,
    representatives: Vec<usize>,
    projections: HashMap<(usize, u32), usize>,
    elements: HashMap<usize, usize>,
    definitions: Vec<usize>,
    referenced_constants: HashSet<u16>,
}
fn base(kind: &PropType) -> &PropType {
    if let PropType::Optional(child) = kind {
        base(child)
    } else {
        kind
    }
}
fn hint(kind: &PropType) -> Option<SlotType> {
    Some(match base(kind) {
        PropType::Boolean => SlotType::Bool,
        PropType::String | PropType::Enum(_) => SlotType::Text,
        PropType::Number | PropType::Date => SlotType::Number,
        PropType::Array(_) => SlotType::Array,
        PropType::Object(_) => SlotType::Object,
        PropType::Optional(_) => return None,
    })
}
fn primitive(value: &SlotValue) -> Option<PropType> {
    match value {
        SlotValue::Bool(_) => Some(PropType::Boolean),
        SlotValue::Text(_) => Some(PropType::String),
        SlotValue::Number(_) => Some(PropType::Number),
        _ => None,
    }
}

pub(crate) fn validate(module: &IrModule, starts: &[(u32, Opcode)]) -> Result<(), IrError> {
    let size = module
        .slots
        .entries()
        .iter()
        .map(|slot| slot.slot_id as usize + 1)
        .max()
        .unwrap_or(0);
    let mut flow = Flow {
        module,
        arena: Vec::new(),
        representatives: Vec::new(),
        projections: HashMap::new(),
        elements: HashMap::new(),
        definitions: vec![0; size],
        referenced_constants: HashSet::new(),
    };
    for &(offset, op) in starts {
        let at = offset as usize + 1;
        let destination = match op {
            Opcode::Prop => Some(le_u16(&module.opcodes[at + 6..])),
            Opcode::Coalesce => Some(le_u16(&module.opcodes[at + 4..])),
            Opcode::List => Some(le_u16(&module.opcodes[at + 2..])),
            _ => None,
        };
        if let Some(id) = destination {
            flow.definitions[id as usize] += 1;
        }
    }
    let mut env = Env {
        values: vec![None; size],
        journal: Vec::new(),
    };
    let defaults = SlotData::new_from_defaults(&module.slots);
    for slot in module.slots.entries() {
        let id = slot.slot_id;
        let known = if slot.source == SlotSource::Server {
            let name = module.strings.get(slot.name_str_idx)?;
            let field = module.schema.objects[0]
                .iter()
                .find(|field| module.strings.get(field.name).ok() == Some(name));
            field.map(|field| Known::Type(field.kind.clone()))
        } else if let Some(value) = module
            .contracts
            .as_ref()
            .and_then(|contracts| contracts.constants.get(&id))
        {
            if flow.definitions[id as usize] != 0 {
                return Err(invalid("a closed constant is overwritten by bytecode"));
            }
            Some(Known::Literal(value.clone()))
        } else if flow.definitions[id as usize] != 0 {
            None
        } else {
            Some(Known::Literal(defaults.get(id).clone()))
        };
        if let Some(known) = known {
            let index = flow.add(known);
            flow.require_hint(index, slot.type_hint)?;
            env.values[id as usize] = Some(index);
        }
    }
    // One static start per declared island, independent of repeated execution.
    let mut island_starts = HashSet::new();
    for &(offset, op) in starts {
        if op == Opcode::IslandStart {
            let id = le_u16(&module.opcodes[offset as usize + 1..]);
            if !island_starts.insert(id) {
                return Err(invalid("island has more than one static start"));
            }
            if module
                .contracts
                .as_ref()
                .and_then(|contracts| contracts.islands.get(&id))
                .is_some_and(|contract| contract.mode == 1)
            {
                browser_body(module, offset as usize, id)?;
            }
        }
    }
    flow.region(&mut env, 0, module.opcodes.len())?;
    if let Some(contracts) = &module.contracts {
        for id in contracts.constants.keys() {
            if !flow.referenced_constants.contains(id) {
                return Err(invalid("unreferenced closed constant"));
            }
        }
    }
    Ok(())
}
impl Flow<'_> {
    fn add(&mut self, value: Known) -> usize {
        let id = self.arena.len();
        let representative = match &value {
            Known::Either(a, _) => self.representatives[*a],
            _ => id,
        };
        self.arena.push(value);
        self.representatives.push(representative);
        id
    }
    fn union(&mut self, a: usize, b: usize) -> usize {
        if a == b {
            a
        } else {
            self.add(Known::Either(a, b))
        }
    }
    fn merge_definitions(&mut self, a: usize, b: usize) -> Result<usize, IrError> {
        if a == b {
            return Ok(a);
        }
        let ar = self.representatives[a];
        let br = self.representatives[b];
        match (&self.arena[ar], &self.arena[br]) {
            (Known::Never, _) => return Ok(b),
            (_, Known::Never) => return Ok(a),
            (Known::Type(actual), Known::Type(expected)) => {
                self.assign(a, expected)?;
                self.assign(b, actual)?;
                return Ok(self.add(Known::Type(actual.clone())));
            }
            (Known::Type(kind), _) => {
                self.assign(b, kind)?;
                return Ok(self.add(Known::Type(kind.clone())));
            }
            (_, Known::Type(kind)) => {
                self.assign(a, kind)?;
                return Ok(self.add(Known::Type(kind.clone())));
            }
            (Known::Literal(a), Known::Literal(b)) => same_literal_shape(a, b)?,
            _ => return Err(invalid("ambiguous branch provenance")),
        }
        Ok(self.union(a, b))
    }
    fn read(&mut self, env: &Env, id: u16) -> Result<usize, IrError> {
        if self
            .module
            .contracts
            .as_ref()
            .is_some_and(|contracts| contracts.constants.contains_key(&id))
        {
            self.referenced_constants.insert(id);
        }
        env.read(id)
    }
    fn require_hint(&self, id: usize, expected: SlotType) -> Result<(), IrError> {
        let mut pending = vec![id];
        let mut seen = HashSet::new();
        while let Some(id) = pending.pop() {
            if !seen.insert(id) {
                continue;
            }
            match &self.arena[id] {
                Known::Either(a, b) => {
                    pending.push(*a);
                    pending.push(*b);
                }
                Known::Never | Known::Literal(SlotValue::Null) => {}
                Known::Type(kind) if hint(kind) == Some(expected) => {}
                Known::Literal(value)
                    if match value {
                        SlotValue::Text(_) => expected == SlotType::Text,
                        SlotValue::Bool(_) => expected == SlotType::Bool,
                        SlotValue::Number(_) => expected == SlotType::Number,
                        SlotValue::Array(_) => expected == SlotType::Array,
                        SlotValue::Object(_) => expected == SlotType::Object,
                        SlotValue::Null => true,
                    } => {}
                _ => return Err(invalid("slot hint disagrees with full typed provenance")),
            }
        }
        Ok(())
    }
    fn target(&mut self, env: &mut Env, id: u16, value: usize) -> Result<(), IrError> {
        let slot = self
            .module
            .slot_entry(id)
            .ok_or(IrError::UnknownSlotId(id))?;
        if slot.source != SlotSource::Client {
            return Err(invalid("bytecode destination must be CLIENT"));
        }
        self.require_hint(value, slot.type_hint)?;
        env.set(id, Some(value));
        Ok(())
    }
    fn project(&mut self, root: usize, name: u32) -> Result<usize, IrError> {
        let mut todo = vec![(root, false)];
        while let Some((id, finish)) = todo.pop() {
            if self.projections.contains_key(&(id, name)) {
                continue;
            }
            let value = self.arena[id].clone();
            let projected = match value {
                Known::Either(a, b) => {
                    if !finish {
                        todo.push((id, true));
                        todo.push((b, false));
                        todo.push((a, false));
                        continue;
                    }
                    let a = *self
                        .projections
                        .get(&(a, name))
                        .ok_or_else(|| invalid("missing projected branch"))?;
                    let b = *self
                        .projections
                        .get(&(b, name))
                        .ok_or_else(|| invalid("missing projected branch"))?;
                    self.union(a, b)
                }
                Known::Never => self.add(Known::Never),
                Known::Literal(SlotValue::Null) => self.add(Known::Literal(SlotValue::Null)),
                Known::Literal(SlotValue::Object(fields)) => {
                    let name = self.module.strings.get(name)?;
                    self.add(Known::Literal(
                        fields
                            .iter()
                            .find(|(field, _)| field == name)
                            .map(|(_, value)| value.clone())
                            .unwrap_or(SlotValue::Null),
                    ))
                }
                Known::Type(kind) => {
                    let PropType::Object(object) = base(&kind) else {
                        return Err(invalid("PROP source is not a known object"));
                    };
                    let name = self.module.strings.get(name)?;
                    let field = self.module.schema.objects[*object as usize]
                        .iter()
                        .find(|field| self.module.strings.get(field.name).ok() == Some(name))
                        .ok_or_else(|| invalid("PROP source has no declared field"))?;
                    let projected = if matches!(kind, PropType::Optional(_))
                        && !matches!(field.kind, PropType::Optional(_))
                    {
                        PropType::Optional(Box::new(field.kind.clone()))
                    } else {
                        field.kind.clone()
                    };
                    self.add(Known::Type(projected))
                }
                _ => return Err(invalid("PROP source has unknown object provenance")),
            };
            self.projections.insert((id, name), projected);
        }
        self.projections
            .get(&(root, name))
            .copied()
            .ok_or_else(|| invalid("missing projection"))
    }
    fn element(&mut self, root: usize) -> Result<usize, IrError> {
        let mut todo = vec![(root, false)];
        while let Some((id, finish)) = todo.pop() {
            if self.elements.contains_key(&id) {
                continue;
            }
            let value = match self.arena[id].clone() {
                Known::Either(a, b) => {
                    if !finish {
                        todo.push((id, true));
                        todo.push((b, false));
                        todo.push((a, false));
                        continue;
                    }
                    let a = *self
                        .elements
                        .get(&a)
                        .ok_or_else(|| invalid("missing row type"))?;
                    let b = *self
                        .elements
                        .get(&b)
                        .ok_or_else(|| invalid("missing row type"))?;
                    self.union(a, b)
                }
                Known::Never | Known::Literal(SlotValue::Null) => self.add(Known::Never),
                Known::Type(kind) => {
                    let PropType::Array(child) = base(&kind) else {
                        return Err(invalid("LIST source is not a known array"));
                    };
                    self.add(Known::Type((**child).clone()))
                }
                Known::Literal(SlotValue::Array(items)) => {
                    let mut rows: Vec<_> = items
                        .iter()
                        .map(|value| self.add(Known::Literal(value.clone())))
                        .collect();
                    if rows.is_empty() {
                        self.add(Known::Never)
                    } else {
                        while rows.len() > 1 {
                            rows = rows
                                .chunks(2)
                                .map(|pair| {
                                    if pair.len() == 1 {
                                        pair[0]
                                    } else {
                                        self.union(pair[0], pair[1])
                                    }
                                })
                                .collect();
                        }
                        rows[0]
                    }
                }
                _ => return Err(invalid("LIST source has unknown array provenance")),
            };
            self.elements.insert(id, value);
        }
        self.elements
            .get(&root)
            .copied()
            .ok_or_else(|| invalid("missing row provenance"))
    }
    fn assign(&self, known: usize, expected: &PropType) -> Result<(), IrError> {
        let mut todo = vec![known];
        let mut seen = HashSet::new();
        while let Some(id) = todo.pop() {
            if !seen.insert(id) {
                continue;
            }
            match &self.arena[id] {
                Known::Either(a, b) => {
                    todo.push(*a);
                    todo.push(*b);
                }
                Known::Never => {}
                Known::Type(actual) => assign_types(self.module, actual, expected)?,
                Known::Literal(value) => assign_literal(self.module, value, expected)?,
            }
        }
        Ok(())
    }
    fn coalesced_type(&self, known: usize) -> Result<Option<PropType>, IrError> {
        let mut todo = vec![known];
        let mut seen = HashSet::new();
        let mut result: Option<PropType> = None;
        while let Some(id) = todo.pop() {
            if !seen.insert(id) {
                continue;
            }
            let kind = match &self.arena[id] {
                Known::Either(a, b) => {
                    todo.push(*a);
                    todo.push(*b);
                    continue;
                }
                Known::Never => continue,
                Known::Type(kind) => base(kind).clone(),
                Known::Literal(value) => primitive(value)
                    .ok_or_else(|| invalid("COALESCE source needs a known declared type"))?,
            };
            if let Some(previous) = &result {
                assign_types(self.module, &kind, previous)?;
                assign_types(self.module, previous, &kind)?;
            } else {
                result = Some(kind);
            }
        }
        Ok(result)
    }
    fn region(&mut self, env: &mut Env, start: usize, end: usize) -> Result<(), IrError> {
        let ops = &self.module.opcodes;
        let mut pos = start;
        while pos < end {
            let op = Opcode::from_byte(ops[pos])?;
            pos += 1;
            match op {
                Opcode::OpenTag | Opcode::VoidTag => {
                    pos += 6 + le_u16(&ops[pos + 4..]) as usize * 8
                }
                Opcode::Text | Opcode::CloseTag => pos += 4,
                Opcode::ShowElse => {}
                Opcode::IslandEnd => pos += 2,
                Opcode::DynText => {
                    self.read(env, le_u16(&ops[pos..]))?;
                    pos += 4;
                }
                Opcode::DynAttr => {
                    self.read(env, le_u16(&ops[pos + 4..]))?;
                    pos += 6;
                }
                Opcode::Prop => {
                    let source = le_u16(&ops[pos..]);
                    let name = le_u32(&ops[pos + 2..]);
                    let target = le_u16(&ops[pos + 6..]);
                    let source = self.read(env, source)?;
                    let value = self.project(source, name)?;
                    self.target(env, target, value)?;
                    pos += 8;
                }
                Opcode::Coalesce => {
                    let source = le_u16(&ops[pos..]);
                    let fallback = le_u16(&ops[pos + 2..]);
                    let target = le_u16(&ops[pos + 4..]);
                    let destination = self
                        .module
                        .slot_entry(target)
                        .ok_or(IrError::UnknownSlotId(target))?;
                    if target == source
                        || target == fallback
                        || self.definitions[target as usize] != 1
                        || !destination.default_bytes.is_empty()
                    {
                        return Err(invalid("COALESCE destination must be distinct and singly defined with no default"));
                    }
                    let constant = self
                        .module
                        .contracts
                        .as_ref()
                        .and_then(|contracts| contracts.constants.get(&fallback))
                        .ok_or_else(|| {
                            invalid("COALESCE fallback is not an explicit closed constant")
                        })?;
                    if matches!(constant, SlotValue::Null) {
                        return Err(invalid("COALESCE fallback must be non-null"));
                    }
                    let source = self.read(env, source)?;
                    self.read(env, fallback)?;
                    let result = if let Some(kind) = self.coalesced_type(source)? {
                        assign_literal(self.module, constant, &kind)?;
                        self.add(Known::Type(kind))
                    } else {
                        self.add(Known::Never)
                    };
                    self.target(env, target, result)?;
                    pos += 6;
                }
                Opcode::IslandStart => {
                    let island = self
                        .module
                        .island_entry(le_u16(&ops[pos..]))
                        .ok_or_else(|| invalid("missing island"))?;
                    let fields = &self.module.schema.objects[island.schema_object as usize];
                    for (id, field) in island.slot_ids.iter().zip(fields) {
                        let value = self.read(env, *id)?;
                        self.assign(value, &field.kind)?;
                    }
                    pos += 2;
                }
                Opcode::List => {
                    let source = le_u16(&ops[pos..]);
                    let target = le_u16(&ops[pos + 2..]);
                    let length = le_u32(&ops[pos + 4..]) as usize;
                    pos += 8;
                    if source == target || self.definitions[target as usize] != 1 {
                        return Err(invalid(
                            "LIST needs a separate singly defined row temporary",
                        ));
                    }
                    let source = self.read(env, source)?;
                    let row = self.element(source)?;
                    let mark = env.journal.len();
                    self.target(env, target, row)?;
                    self.region(env, pos, pos + length)?;
                    env.restore(mark);
                    pos += length;
                }
                Opcode::ShowIf => {
                    self.read(env, le_u16(&ops[pos..]))?;
                    let then_len = le_u32(&ops[pos + 2..]) as usize;
                    let else_len = le_u32(&ops[pos + 6..]) as usize;
                    pos += 10;
                    let mark = env.journal.len();
                    self.region(env, pos, pos + then_len)?;
                    let then = env.restore(mark);
                    let else_start = pos + then_len + 1;
                    self.region(env, else_start, else_start + else_len)?;
                    let otherwise = env.restore(mark);
                    let ids: HashSet<_> = then.keys().chain(otherwise.keys()).copied().collect();
                    for id in ids {
                        let a = then.get(&id).copied().unwrap_or(env.values[id as usize]);
                        let b = otherwise
                            .get(&id)
                            .copied()
                            .unwrap_or(env.values[id as usize]);
                        let value = match (a, b) {
                            (Some(a), Some(b)) => Some(self.merge_definitions(a, b)?),
                            _ => None,
                        };
                        env.set(id, value);
                    }
                    pos = else_start + else_len;
                }
            }
        }
        Ok(())
    }
}

fn assign_types(module: &IrModule, actual: &PropType, expected: &PropType) -> Result<(), IrError> {
    let mut todo = vec![(actual, expected)];
    let mut seen = HashSet::new();
    while let Some((actual, expected)) = todo.pop() {
        // References point into immutable schemas/arena types for this check.
        if !seen.insert((
            actual as *const PropType as usize,
            expected as *const PropType as usize,
        )) {
            continue;
        }
        match (actual, expected) {
            (PropType::Optional(a), PropType::Optional(b)) => todo.push((a, b)),
            (_, PropType::Optional(b)) => todo.push((actual, b)),
            (PropType::Boolean, PropType::Boolean)
            | (PropType::String, PropType::String)
            | (PropType::Number, PropType::Number)
            | (PropType::Date, PropType::Date) => {}
            (PropType::Enum(_), PropType::String) => {}
            (PropType::Enum(a), PropType::Enum(b)) => {
                for variant in a {
                    let name = module.strings.get(*variant)?;
                    if !b
                        .iter()
                        .any(|id| module.strings.get(*id).ok() == Some(name))
                    {
                        return Err(invalid("enum provenance is not assignable"));
                    }
                }
            }
            (PropType::Array(a), PropType::Array(b)) => todo.push((a, b)),
            (PropType::Object(a), PropType::Object(b)) => {
                let fields = &module.schema.objects[*a as usize];
                let mut names = HashMap::with_capacity(fields.len());
                for field in fields {
                    names.insert(module.strings.get(field.name)?, &field.kind);
                }
                for field in &module.schema.objects[*b as usize] {
                    let name = module.strings.get(field.name)?;
                    if let Some(actual) = names.get(name) {
                        todo.push((actual, &field.kind));
                    } else if !matches!(field.kind, PropType::Optional(_)) {
                        return Err(invalid("object provenance omits a required field"));
                    }
                }
            }
            _ => return Err(invalid("incompatible full props types")),
        }
    }
    Ok(())
}
fn assign_literal(
    module: &IrModule,
    actual: &SlotValue,
    expected: &PropType,
) -> Result<(), IrError> {
    let mut todo = vec![(actual, expected)];
    while let Some((actual, expected)) = todo.pop() {
        match (actual, expected) {
            (SlotValue::Null, PropType::Optional(_)) => {}
            (_, PropType::Optional(child)) => todo.push((actual, child)),
            (SlotValue::Bool(_), PropType::Boolean) | (SlotValue::Text(_), PropType::String) => {}
            (SlotValue::Number(n), PropType::Number) if n.is_finite() => {}
            (SlotValue::Text(value), PropType::Enum(variants))
                if variants
                    .iter()
                    .any(|id| module.strings.get(*id).ok() == Some(value.as_str())) => {}
            (SlotValue::Array(values), PropType::Array(child)) => {
                for value in values.iter() {
                    todo.push((value, child));
                }
            }
            (SlotValue::Object(values), PropType::Object(id)) => {
                for field in &module.schema.objects[*id as usize] {
                    let name = module.strings.get(field.name)?;
                    if let Some((_, value)) = values.iter().find(|(key, _)| key == name) {
                        todo.push((value, &field.kind));
                    } else if !matches!(field.kind, PropType::Optional(_)) {
                        return Err(invalid("closed object misses a required declared field"));
                    }
                }
            }
            _ => return Err(invalid("closed value is not assignable to declared type")),
        }
    }
    Ok(())
}
fn browser_body(module: &IrModule, start: usize, id: u16) -> Result<(), IrError> {
    let ops = &module.opcodes;
    let mut pos = start + 3;
    let op = ops
        .get(pos)
        .copied()
        .ok_or_else(|| invalid("browserOnly host missing"))?;
    pos += 1;
    if op != Opcode::OpenTag as u8 && op != Opcode::VoidTag as u8 {
        return Err(invalid(
            "browserOnly region must have one static empty host",
        ));
    }
    let name = le_u32(&ops[pos..]);
    let count = le_u16(&ops[pos + 4..]) as usize;
    pos += 6 + count * 8;
    if op == Opcode::OpenTag as u8 {
        if ops.get(pos) != Some(&(Opcode::CloseTag as u8)) {
            return Err(invalid("browserOnly host must be empty"));
        }
        pos += 1;
        if module.strings.get(le_u32(&ops[pos..]))? != module.strings.get(name)? {
            return Err(invalid("browserOnly close tag differs"));
        }
        pos += 4;
    }
    if ops.get(pos) != Some(&(Opcode::IslandEnd as u8))
        || ops.get(pos + 1..pos + 3).map(le_u16) != Some(id)
    {
        return Err(invalid(
            "browserOnly region contains content or nested islands",
        ));
    }
    Ok(())
}

fn same_literal_shape(a: &SlotValue, b: &SlotValue) -> Result<(), IrError> {
    let mut todo = vec![(a, b)];
    let mut seen = HashSet::new();
    while let Some((a, b)) = todo.pop() {
        if !seen.insert((
            a as *const SlotValue as usize,
            b as *const SlotValue as usize,
        )) {
            continue;
        }
        match (a, b) {
            (SlotValue::Null, SlotValue::Null)
            | (SlotValue::Bool(_), SlotValue::Bool(_))
            | (SlotValue::Number(_), SlotValue::Number(_))
            | (SlotValue::Text(_), SlotValue::Text(_)) => {}
            (SlotValue::Object(a), SlotValue::Object(b)) => {
                if a.len() != b.len() {
                    return Err(invalid("branch objects have different full shapes"));
                }
                for (name, value) in a.iter() {
                    let (_, other) = b
                        .iter()
                        .find(|(key, _)| key == name)
                        .ok_or_else(|| invalid("branch objects have different full shapes"))?;
                    todo.push((value, other));
                }
            }
            (SlotValue::Array(a), SlotValue::Array(b)) => {
                if let (Some(first), Some(other)) = (a.first(), b.first()) {
                    todo.push((first, other));
                    for value in a.iter().skip(1) {
                        todo.push((first, value));
                    }
                    for value in b.iter().skip(1) {
                        todo.push((other, value));
                    }
                }
            }
            _ => return Err(invalid("branch definitions have differing full types")),
        }
    }
    Ok(())
}
