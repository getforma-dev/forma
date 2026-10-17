//! Closed data parsing without host-stack recursion or unbounded reservations.
use super::{invalid, text};
use crate::format::{
    limit, IrError, MAX_CONSTANT_ARRAY_ELEMENTS, MAX_CONSTANT_DEPTH, MAX_CONSTANT_NODES,
    MAX_SCHEMA_ITEMS,
};
use crate::schema::Cursor;
use crate::slot::SlotValue;
use std::sync::Arc;

enum Node {
    Scalar(SlotValue),
    Array(Vec<usize>),
    Object(Vec<(String, usize)>),
}
struct Frame {
    id: usize,
    remaining: usize,
    last: Option<String>,
}

fn node(r: &mut Cursor<'_>, promised: &mut usize) -> Result<(Node, usize), IrError> {
    let (value, children) = match r.u8()? {
        0 => (Node::Scalar(SlotValue::Null), 0),
        1 => (Node::Scalar(SlotValue::Bool(false)), 0),
        2 => (Node::Scalar(SlotValue::Bool(true)), 0),
        3 => {
            let raw = r.take(8)?;
            let n = f64::from_le_bytes([
                raw[0], raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7],
            ]);
            if !n.is_finite() || (n == 0.0 && n.is_sign_negative()) {
                return Err(invalid("noncanonical constant number"));
            }
            (Node::Scalar(SlotValue::Number(n)), 0)
        }
        4 => (Node::Scalar(SlotValue::Text(text(r)?)), 0),
        5 => {
            let n = r.u32()? as usize;
            limit("constant array elements", n, MAX_CONSTANT_ARRAY_ELEMENTS)?;
            r.bound(n, 1)?;
            limit(
                "constant value nodes",
                promised.saturating_add(n),
                MAX_CONSTANT_NODES,
            )?;
            (Node::Array(Vec::with_capacity(n)), n)
        }
        6 => {
            let n = r.u16()? as usize;
            limit("constant object fields", n, MAX_SCHEMA_ITEMS)?;
            r.bound(n, 3)?;
            limit(
                "constant value nodes",
                promised.saturating_add(n),
                MAX_CONSTANT_NODES,
            )?;
            (Node::Object(Vec::with_capacity(n)), n)
        }
        _ => return Err(invalid("unknown closed constant tag")),
    };
    *promised = promised
        .checked_add(children)
        .ok_or_else(|| invalid("constant node overflow"))?;
    Ok((value, children))
}

pub(crate) fn read(r: &mut Cursor<'_>) -> Result<SlotValue, IrError> {
    let mut promised = 1usize;
    let (root, remaining) = node(r, &mut promised)?;
    let mut nodes = vec![root];
    let mut stack = vec![Frame {
        id: 0,
        remaining,
        last: None,
    }];
    while let Some(frame) = stack.last_mut() {
        if frame.remaining == 0 {
            stack.pop();
            continue;
        }
        frame.remaining -= 1;
        let parent = frame.id;
        let name = if matches!(nodes[parent], Node::Object(_)) {
            let name = text(r)?;
            if frame
                .last
                .as_ref()
                .is_some_and(|previous| previous >= &name)
            {
                return Err(invalid("closed object fields are not unique UTF-8 order"));
            }
            frame.last = Some(name.clone());
            Some(name)
        } else {
            None
        };
        limit("constant depth", stack.len(), MAX_CONSTANT_DEPTH)?;
        let (next, remaining) = node(r, &mut promised)?;
        let id = nodes.len();
        nodes.push(next);
        match (&mut nodes[parent], name) {
            (Node::Array(children), None) => children.push(id),
            (Node::Object(fields), Some(name)) => fields.push((name, id)),
            _ => return Err(invalid("invalid closed constant tree")),
        }
        if remaining != 0 {
            stack.push(Frame {
                id,
                remaining,
                last: None,
            });
        }
    }
    // Children were appended after parents. Build from the leaves and move each
    // value once; no recursive clone, object expansion or unbounded JSON parse.
    let mut values: Vec<Option<SlotValue>> = vec![None; nodes.len()];
    for (id, item) in nodes.into_iter().enumerate().rev() {
        values[id] = Some(match item {
            Node::Scalar(value) => value,
            Node::Array(children) => {
                let collected = children
                    .into_iter()
                    .map(|child| {
                        values[child]
                            .take()
                            .ok_or_else(|| invalid("missing constant child"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                SlotValue::Array(Arc::from(collected))
            }
            Node::Object(fields) => {
                let collected = fields
                    .into_iter()
                    .map(|(name, child)| {
                        Ok((
                            name,
                            values[child]
                                .take()
                                .ok_or_else(|| invalid("missing constant child"))?,
                        ))
                    })
                    .collect::<Result<Vec<_>, IrError>>()?;
                SlotValue::Object(Arc::from(collected))
            }
        });
    }
    values[0]
        .take()
        .ok_or_else(|| invalid("missing constant root"))
}
