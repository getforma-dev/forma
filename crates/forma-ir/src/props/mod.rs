//! Declared page props: derived Rust metadata compared with FMIR's actual schema,
//! followed by projection and checked encoding of only the declared fields.
mod compare;
mod value;
use crate::schema::{PropField, PropType, PropsSchema};
pub use compare::compare_schema;
use std::any::TypeId;
use std::collections::HashMap;
#[doc(hidden)]
pub use value::{child_path, JsonMap, JsonValue};
pub use value::{encode_props, BoundProps, EncodeContext, PropValue};

/// A source declaration on either side of a binding diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropsSource {
    /// Source file reported by the compiler or derive expansion.
    pub file: String,
    /// One-based declaration line.
    pub line: u32,
    /// One-based declaration column (UTF-16 for TypeScript).
    pub column: u32,
}
impl PropsSource {
    /// Construct declaration metadata; generated derives use the field's span.
    pub fn new(file: &str, line: u32, column: u32) -> Self {
        Self {
            file: file.into(),
            line,
            column,
        }
    }
}

/// A bind or checked-value refusal. Diagnostics identify the route, declared path
/// and both declarations whenever both sides have a field at that path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropsError {
    /// Stable BIND or RENDER code.
    pub code: &'static str,
    /// Route being bound or rendered.
    pub route: String,
    /// Declared property path, including array indices at render.
    pub path: String,
    /// Specific incompatibility or value violation.
    pub message: String,
    /// TypeScript declaration, if present.
    pub typescript: Option<Box<PropsSource>>,
    /// Rust declaration, if present.
    pub rust: Option<Box<PropsSource>>,
}
impl PropsError {
    /// Stable diagnostic code.
    pub fn code(&self) -> &'static str {
        self.code
    }
    /// Route associated with the refusal.
    pub fn route(&self) -> &str {
        &self.route
    }
    /// Full property path.
    pub fn path(&self) -> &str {
        &self.path
    }
    /// Attach the route to a derive-schema error discovered before binding.
    pub fn with_route(mut self, route: &str) -> Self {
        self.route = route.into();
        self
    }
}
impl std::fmt::Display for PropsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} route {} props {}: {}",
            self.code,
            self.route,
            if self.path.is_empty() {
                "<root>"
            } else {
                &self.path
            },
            self.message
        )?;
        for (label, source) in [("TypeScript", &self.typescript), ("Rust", &self.rust)] {
            if let Some(source) = source {
                write!(
                    f,
                    "; {label} {}:{}:{}",
                    source.file, source.line, source.column
                )?;
            }
        }
        Ok(())
    }
}
impl std::error::Error for PropsError {}

/// An extra Rust field is visible at bind as a warning, and never encoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropsWarning {
    /// Stable warning code (BIND-201).
    pub code: &'static str,
    /// Bound route.
    pub route: String,
    /// Extra field's path.
    pub path: String,
    /// Explanation of the ignored Rust field.
    pub message: String,
    /// Closest TypeScript declaration, when available.
    pub typescript: Option<PropsSource>,
    /// Extra Rust field's declaration.
    pub rust: Option<PropsSource>,
}
impl std::fmt::Display for PropsWarning {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        PropsError {
            code: self.code,
            route: self.route.clone(),
            path: self.path.clone(),
            message: self.message.clone(),
            typescript: self.typescript.clone().map(Box::new),
            rust: self.rust.clone().map(Box::new),
        }
        .fmt(f)
    }
}

/// Rust's derived schema uses the same closed type representation as parsed FMIR.
#[derive(Debug, Clone)]
pub struct RustType {
    /// The actual FMIR object/field/type representation, with Rust source positions.
    pub schema: PropsSchema,
    /// Names, enum literals and source files referenced by that schema.
    pub strings: Vec<String>,
    /// Root kind; a page binding requires an object.
    pub root: PropType,
    /// Root Rust declaration, useful when a TypeScript field is missing in Rust.
    pub source: PropsSource,
}

/// A named struct or unit enum declared with `#[derive(PageProps)]`.
/// The trait and derive share their public name in Rust's separate namespaces.
pub trait PageProps: PropValue {
    /// Build the schema once at startup. Recursive Rust types return BIND-105.
    fn rust_type() -> Result<RustType, PropsError> {
        let mut builder = SchemaBuilder::default();
        let root = Self::describe(&mut builder)?;
        Ok(RustType {
            schema: PropsSchema {
                objects: builder.objects,
            },
            strings: builder.strings,
            root,
            source: Self::source(),
        })
    }
}

/// Derive support for constructing indexed FMIR metadata; no alternate schema.
#[doc(hidden)]
#[derive(Debug, Default)]
pub struct SchemaBuilder {
    strings: Vec<String>,
    names: HashMap<String, u32>,
    objects: Vec<Vec<PropField>>,
    types: HashMap<TypeId, u16>,
    active: Vec<TypeId>,
    wrappers: usize,
}
impl SchemaBuilder {
    fn failure(message: &str) -> PropsError {
        PropsError {
            code: "BIND-105",
            route: String::new(),
            path: String::new(),
            message: message.into(),
            typescript: None,
            rust: None,
        }
    }
    /// Intern a name or source path using the same bounded indices as FMIR.
    pub fn intern(&mut self, name: &str) -> Result<u32, PropsError> {
        if let Some(index) = self.names.get(name) {
            return Ok(*index);
        }
        if name.len() > u16::MAX as usize || self.strings.len() >= crate::format::MAX_STRINGS {
            return Err(Self::failure("Rust schema string exceeds the FMIR limit"));
        }
        let index = self.strings.len() as u32;
        self.strings.push(name.into());
        self.names.insert(name.into(), index);
        Ok(index)
    }
    /// Describe an object once, rejecting recursive shapes before recursing again.
    pub fn object<T: 'static>(
        &mut self,
        fields: impl FnOnce(&mut Self) -> Result<Vec<PropField>, PropsError>,
    ) -> Result<PropType, PropsError> {
        let ty = TypeId::of::<T>();
        if self.active.contains(&ty) {
            return Err(Self::failure("recursive Rust props are not supported"));
        }
        if let Some(index) = self.types.get(&ty) {
            return Ok(PropType::Object(*index));
        }
        if self.objects.len() >= crate::format::MAX_SCHEMA_ITEMS {
            return Err(Self::failure("too many Rust schema objects"));
        }
        let index = self.objects.len() as u16;
        self.objects.push(Vec::new());
        self.types.insert(ty, index);
        self.active.push(ty);
        let wrappers = std::mem::replace(&mut self.wrappers, 0);
        let result = fields(self);
        self.wrappers = wrappers;
        self.active.pop();
        let fields = result?;
        if fields.len() > crate::format::MAX_SCHEMA_ITEMS {
            return Err(Self::failure("too many Rust schema fields"));
        }
        let mut names = std::collections::HashSet::new();
        if fields.iter().any(|f| !names.insert(f.name)) {
            return Err(Self::failure("duplicate Rust props field names"));
        }
        self.objects[index as usize] = fields;
        Ok(PropType::Object(index))
    }
    /// Make a field with its source declaration.
    pub fn field(
        &mut self,
        name: &str,
        source: PropsSource,
        kind: PropType,
    ) -> Result<PropField, PropsError> {
        Ok(PropField {
            name: self.intern(name)?,
            file: self.intern(&source.file)?,
            line: source.line,
            column: source.column,
            kind,
        })
    }
    /// Build one bounded array/optional wrapper.
    pub fn nested<T: PropValue>(&mut self) -> Result<PropType, PropsError> {
        if self.wrappers >= crate::format::MAX_TYPE_DEPTH {
            return Err(Self::failure(
                "Rust props type nesting exceeds the FMIR limit",
            ));
        }
        self.wrappers += 1;
        let result = T::describe(self);
        self.wrappers -= 1;
        result
    }
    /// Unit enum literal names.
    pub fn enumeration(&mut self, names: &[&str]) -> Result<PropType, PropsError> {
        if names.is_empty() || names.len() > crate::format::MAX_SCHEMA_ITEMS {
            return Err(Self::failure(
                "Rust enum must contain a bounded nonempty set of literals",
            ));
        }
        let names = names
            .iter()
            .map(|name| self.intern(name))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(PropType::Enum(names))
    }
}

/// Unambiguous readable field paths, including quoted unusual property names.
#[doc(hidden)]
pub fn field_path(parent: &str, name: &str) -> String {
    let simple = !name.is_empty()
        && name.chars().enumerate().all(|(i, c)| {
            c == '_' || c == '$' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())
        });
    if simple {
        if parent.is_empty() {
            name.into()
        } else {
            format!("{parent}.{name}")
        }
    } else {
        format!("{parent}[{}]", serde_json::Value::String(name.into()))
    }
}
