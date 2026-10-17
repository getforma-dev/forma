//! Binding identity grammar and lexical reference validation; not an evaluator.
use super::{
    constant, invalid,
    schema::{Schema, Type},
    text,
};
use crate::format::{
    limit, IrError, MAX_BINDING_RECORDS, MAX_CONTROL_DEPTH, MAX_KEY_SEGMENTS, MAX_LIST_DEPTH,
    MAX_PROP_PATH_SEGMENTS, MAX_SCHEMA_ITEMS, MAX_VALUE_DEPTH, SECTION_ISLAND_CONTRACTS,
};
use crate::schema::Cursor;

pub(crate) fn validate(bytes: &[u8], schema: &Schema) -> Result<u8, IrError> {
    let mut r = Cursor::new(bytes);
    if r.u8()? != 1 {
        return Err(invalid("unknown binding version"));
    }
    let mode = r.u8()?;
    if mode > 1 {
        return Err(invalid("unknown island render mode"));
    }
    let mut check = Check {
        schema,
        records: 0,
        signals: Vec::new(),
        rows: Vec::new(),
        captures: Vec::new(),
        next_capture: 0,
    };
    check.block(&mut r, 0, 0, mode)?;
    r.finish(SECTION_ISLAND_CONTRACTS)?;
    if check.next_capture != check.captures.len() {
        return Err(invalid("unused capture declaration"));
    }
    Ok(mode)
}
struct Check<'a> {
    schema: &'a Schema,
    records: usize,
    signals: Vec<bool>,
    rows: Vec<bool>,
    captures: Vec<bool>,
    next_capture: usize,
}
impl Check<'_> {
    fn path(&self, r: &mut Cursor<'_>, root: bool) -> Result<Vec<String>, IrError> {
        let n = r.u16()? as usize;
        limit("binding path segments", n, MAX_PROP_PATH_SEGMENTS)?;
        r.bound(n, 2)?;
        if root && n == 0 {
            return Err(invalid("PROP binding needs a field path"));
        }
        let mut result = Vec::with_capacity(n);
        for _ in 0..n {
            result.push(text(r)?);
        }
        if root {
            let mut kind = &Type::Object(0);
            for segment in &result {
                while let Type::Optional(child) = kind {
                    kind = child;
                }
                let Type::Object(id) = kind else {
                    return Err(invalid("PROP binding projects a non-object"));
                };
                kind = &self.schema.objects[*id as usize]
                    .iter()
                    .find(|(name, _)| name == segment)
                    .ok_or_else(|| invalid("unknown PROP binding field"))?
                    .1;
            }
        }
        Ok(result)
    }
    fn expression(&mut self, r: &mut Cursor<'_>, depth: usize) -> Result<(), IrError> {
        limit("binding value depth", depth, MAX_VALUE_DEPTH)?;
        // Cursor has no rewind; keep the grammar in one dispatch.
        let tag = r.u8()?;
        match tag {
            0 => {
                constant::read(r)?;
            }
            1 => {
                self.path(r, true)?;
            }
            2 | 3 | 7 => {
                let id = r.u16()? as usize;
                match tag {
                    2 if self.signals.get(id) != Some(&true) => {
                        return Err(invalid(
                            "signal reference is not dominated in lexical scope",
                        ))
                    }
                    3 if self.rows.get(id) != Some(&true) => {
                        return Err(invalid("row reference is outside its LIST body"))
                    }
                    7 => {
                        let used = self
                            .captures
                            .get_mut(id)
                            .ok_or_else(|| invalid("unknown capture reference"))?;
                        if !*used {
                            if id != self.next_capture {
                                return Err(invalid("capture first-use order differs from prefix"));
                            }
                            *used = true;
                            self.next_capture += 1;
                        }
                    }
                    _ => {}
                }
                self.path(r, false)?;
            }
            4 => {
                self.expression(r, depth + 1)?;
                constant::read(r)?;
            }
            5 => {
                if !(1..=3).contains(&r.u8()?) {
                    return Err(invalid("unknown unary operator"));
                }
                self.expression(r, depth + 1)?;
            }
            6 => {
                if !(1..=14).contains(&r.u8()?) {
                    return Err(invalid("unknown binary operator"));
                }
                self.expression(r, depth + 1)?;
                self.expression(r, depth + 1)?;
            }
            _ => return Err(invalid("unknown binding value tag")),
        }
        Ok(())
    }
    fn block(
        &mut self,
        r: &mut Cursor<'_>,
        depth: usize,
        lists: usize,
        mode: u8,
    ) -> Result<(), IrError> {
        limit("binding block depth", depth, MAX_CONTROL_DEPTH)?;
        let count = r.u16()? as usize;
        self.records = self
            .records
            .checked_add(count)
            .ok_or_else(|| invalid("binding record overflow"))?;
        limit("binding records", self.records, MAX_BINDING_RECORDS)?;
        r.bound(count, 5)?;
        if mode == 1 && count != 0 {
            return Err(invalid("browserOnly contract must have an empty block"));
        }
        let signal_start = self.signals.len();
        let mut prefix = depth == 0;
        for _ in 0..count {
            let length = r.u32()? as usize;
            let mut record = Cursor::new(r.take(length)?);
            let tag = record.u8()?;
            if tag != 7 {
                prefix = false;
            }
            match tag {
                1 => {
                    self.expression(&mut record, 0)?;
                    self.signals.push(true);
                }
                2 => self.expression(&mut record, 0)?,
                3 => {
                    text(&mut record)?;
                    self.expression(&mut record, 0)?;
                }
                4 => {
                    self.expression(&mut record, 0)?;
                    self.block(&mut record, depth + 1, lists, mode)?;
                    self.block(&mut record, depth + 1, lists, mode)?;
                }
                5 => {
                    self.expression(&mut record, 0)?;
                    let count = record.u8()? as usize;
                    limit("binding list key segments", count, MAX_KEY_SEGMENTS)?;
                    record.bound(count, 2)?;
                    for _ in 0..count {
                        text(&mut record)?;
                    }
                    limit("binding list depth", lists + 1, MAX_LIST_DEPTH)?;
                    let id = self.rows.len();
                    self.rows.push(true);
                    self.block(&mut record, depth + 1, lists + 1, mode)?;
                    self.rows[id] = false;
                }
                6 => {
                    text(&mut record)?;
                    let fields = record.u16()? as usize;
                    limit("binding child fields", fields, MAX_SCHEMA_ITEMS)?;
                    record.bound(fields, 4)?;
                    let mut previous = None;
                    for _ in 0..fields {
                        let name = text(&mut record)?;
                        if matches!(name.as_str(), "__proto__" | "constructor" | "prototype")
                            || previous.as_ref().is_some_and(|last| last >= &name)
                        {
                            return Err(invalid("child fields are not unique UTF-8 order"));
                        }
                        previous = Some(name);
                        self.expression(&mut record, 0)?;
                    }
                }
                7 => {
                    if !prefix {
                        return Err(invalid("CAPTURE is not in the outer prefix"));
                    }
                    constant::read(&mut record)?;
                    self.captures.push(false);
                }
                _ => return Err(invalid("unknown binding record tag")),
            }
            record.finish(SECTION_ISLAND_CONTRACTS)?;
        }
        for active in &mut self.signals[signal_start..] {
            *active = false;
        }
        Ok(())
    }
}
