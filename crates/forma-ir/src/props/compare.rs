use super::{field_path, PropsError, PropsSource, PropsWarning, RustType};
use crate::{schema::PropType, IrModule};
use std::collections::{BTreeSet, HashMap, HashSet};

struct Work {
    ts: PropType,
    rs: PropType,
    path: String,
    ts_source: Option<PropsSource>,
    rs_source: Option<PropsSource>,
}
fn error(work: &Work, route: &str, code: &'static str, message: String) -> PropsError {
    PropsError {
        code,
        route: route.into(),
        path: work.path.clone(),
        message,
        typescript: work.ts_source.clone().map(Box::new),
        rust: work.rs_source.clone().map(Box::new),
    }
}
fn kind(kind: &PropType) -> &'static str {
    match kind {
        PropType::Boolean => "boolean",
        PropType::String => "string",
        PropType::Number => "number",
        PropType::Date => "Date",
        PropType::Enum(_) => "enum",
        PropType::Array(_) => "array",
        PropType::Optional(_) => "optional",
        PropType::Object(_) => "object",
    }
}

/// Compare the module's actual object-zero schema to the derived Rust schema by
/// name. Every declared TypeScript field must exist in Rust, even if optional.
/// Extra Rust fields warn; declaration order does not participate in comparison.
pub fn compare_schema(
    module: &IrModule,
    rust: &RustType,
    route: &str,
) -> Result<Vec<PropsWarning>, Vec<PropsError>> {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();
    let mut work = vec![Work {
        ts: PropType::Object(0),
        rs: rust.root.clone(),
        path: String::new(),
        ts_source: None,
        rs_source: Some(rust.source.clone()),
    }];
    let mut steps = 0usize;
    while let Some(mut item) = work.pop() {
        steps += 1;
        if steps > crate::format::MAX_SCHEMA_ITEMS * crate::format::MAX_SCHEMA_ITEMS {
            errors.push(error(
                &item,
                route,
                "BIND-105",
                "schema comparison exceeds its bounded work limit".into(),
            ));
            break;
        }
        match (&item.ts, &item.rs) {
            (PropType::Optional(ts), PropType::Optional(rs)) => {
                item.ts = (**ts).clone();
                item.rs = (**rs).clone();
                work.push(item);
            }
            (PropType::Optional(ts), _) => {
                item.ts = (**ts).clone();
                work.push(item);
            }
            (_, PropType::Optional(_)) => errors.push(error(
                &item,
                route,
                "BIND-103",
                "TypeScript requires a value but Rust declares Option".into(),
            )),
            (PropType::Boolean, PropType::Boolean)
            | (PropType::String, PropType::String)
            | (PropType::Number, PropType::Number)
            | (PropType::Date, PropType::Date) => {}
            (PropType::Array(ts), PropType::Array(rs)) => {
                item.ts = (**ts).clone();
                item.rs = (**rs).clone();
                item.path.push_str("[]");
                work.push(item);
            }
            (PropType::Enum(ts), PropType::Enum(rs)) => {
                let ts = ts
                    .iter()
                    .map(|i| module.strings.get(*i))
                    .collect::<Result<BTreeSet<_>, _>>();
                let rs = rs
                    .iter()
                    .map(|i| rust.strings.get(*i as usize).map(String::as_str))
                    .collect::<Option<BTreeSet<_>>>();
                match (ts, rs) {
                    (Ok(ts), Some(rs)) if ts == rs => {}
                    (Ok(ts), Some(rs)) => errors.push(error(
                        &item,
                        route,
                        "BIND-104",
                        format!("enum literals differ: TypeScript {ts:?}, Rust {rs:?}"),
                    )),
                    _ => errors.push(error(
                        &item,
                        route,
                        "BIND-105",
                        "invalid enum literal reference".into(),
                    )),
                }
            }
            (PropType::Object(ts), PropType::Object(rs)) => {
                if !seen.insert((*ts, *rs)) {
                    continue;
                }
                let fields = module
                    .schema
                    .objects
                    .get(*ts as usize)
                    .zip(rust.schema.objects.get(*rs as usize));
                let Some((ts_fields, rs_fields)) = fields else {
                    errors.push(error(
                        &item,
                        route,
                        "BIND-105",
                        "invalid object reference".into(),
                    ));
                    continue;
                };
                let mut rs_by_name = HashMap::new();
                for field in rs_fields {
                    let Some(name) = rust.strings.get(field.name as usize) else {
                        errors.push(error(
                            &item,
                            route,
                            "BIND-105",
                            "invalid Rust field-name reference".into(),
                        ));
                        continue;
                    };
                    if rs_by_name.insert(name.as_str(), field).is_some() {
                        errors.push(error(
                            &item,
                            route,
                            "BIND-105",
                            format!("duplicate Rust field {name}"),
                        ));
                    }
                }
                let mut declared = HashSet::new();
                for field in ts_fields {
                    let Ok(name) = module.strings.get(field.name) else {
                        errors.push(error(
                            &item,
                            route,
                            "BIND-105",
                            "invalid TypeScript field-name reference".into(),
                        ));
                        continue;
                    };
                    declared.insert(name);
                    let ts_source = module
                        .strings
                        .get(field.file)
                        .ok()
                        .map(|file| PropsSource::new(file, field.line, field.column));
                    let path = field_path(&item.path, name);
                    if let Some(other) = rs_by_name.get(name) {
                        let rs_source = rust
                            .strings
                            .get(other.file as usize)
                            .map(|file| PropsSource::new(file, other.line, other.column));
                        work.push(Work {
                            ts: field.kind.clone(),
                            rs: other.kind.clone(),
                            path,
                            ts_source,
                            rs_source,
                        });
                    } else {
                        let mut names = rs_by_name.keys().copied().collect::<Vec<_>>();
                        names.sort_unstable();
                        errors.push(PropsError{code:"BIND-101",route:route.into(),path,message:format!("TypeScript declares {name:?}, but Rust has no such field (Rust fields: {names:?})"),typescript:ts_source.map(Box::new),rust:item.rs_source.clone().map(Box::new)});
                    }
                }
                for field in rs_fields {
                    let Some(name) = rust.strings.get(field.name as usize) else {
                        continue;
                    };
                    if !declared.contains(name.as_str()) {
                        warnings.push(PropsWarning {
                            code: "BIND-201",
                            route: route.into(),
                            path: field_path(&item.path, name),
                            message: "extra Rust field is ignored and never encoded".into(),
                            typescript: item.ts_source.clone(),
                            rust: rust
                                .strings
                                .get(field.file as usize)
                                .map(|file| PropsSource::new(file, field.line, field.column)),
                        });
                    }
                }
            }
            _ => errors.push(error(
                &item,
                route,
                "BIND-102",
                format!(
                    "TypeScript declares {}, Rust declares {}",
                    kind(&item.ts),
                    kind(&item.rs)
                ),
            )),
        }
    }
    errors.sort_by(|a, b| (&a.path, a.code).cmp(&(&b.path, b.code)));
    warnings.sort_by(|a, b| a.path.cmp(&b.path));
    if errors.is_empty() {
        Ok(warnings)
    } else {
        Err(errors)
    }
}
