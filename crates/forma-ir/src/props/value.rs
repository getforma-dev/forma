use super::{compare_schema, field_path, PageProps, PropsError, PropsSource, SchemaBuilder};
use crate::{
    schema::{PropField, PropType},
    IrModule,
};
use serde_json::Value;

/// A closed-set value used by a derived props field. Unsupported Rust types do
/// not implement this trait; derive emits bounds at each offending field.
pub trait PropValue: Sized + 'static {
    /// The actual FMIR type representation for this Rust value.
    fn describe(builder: &mut SchemaBuilder) -> Result<PropType, PropsError>;
    /// Project this value through the declared TypeScript type. None means an
    /// omitted object field; an array caller converts it to a null placeholder.
    fn encode_value(
        &self,
        context: &EncodeContext<'_>,
        kind: &PropType,
        path: &str,
    ) -> Result<Option<Value>, PropsError>;
    /// Root declaration; field declarations override this in value diagnostics.
    fn source() -> PropsSource {
        PropsSource::new(std::any::type_name::<Self>(), 0, 0)
    }
}

/// Context passed by generated implementations; encoding always follows the
/// parsed schema and never serializes an unrestricted Rust object.
#[doc(hidden)]
#[derive(Debug)]
pub struct EncodeContext<'a> {
    module: &'a IrModule,
    route: &'a str,
    typescript: Option<PropsSource>,
    rust: Option<PropsSource>,
    depth: usize,
}
impl<'a> EncodeContext<'a> {
    /// Strip optional schema wrappers for a Rust field that always provides a value.
    pub fn required<'b>(&self, mut kind: &'b PropType) -> &'b PropType {
        while let PropType::Optional(inner) = kind {
            kind = inner;
        }
        kind
    }
    /// A value violation with the active route and both declarations.
    pub fn error(&self, code: &'static str, path: &str, message: impl Into<String>) -> PropsError {
        PropsError {
            code,
            route: self.route.into(),
            path: path.into(),
            message: message.into(),
            typescript: self.typescript.clone().map(Box::new),
            rust: self.rust.clone().map(Box::new),
        }
    }
    /// Fields of a declared object; used by a struct derive to project by name.
    pub fn object(&self, kind: &PropType, path: &str) -> Result<&'a [PropField], PropsError> {
        if let PropType::Object(index) = self.required(kind) {
            return self
                .module
                .schema
                .objects
                .get(*index as usize)
                .map(Vec::as_slice)
                .ok_or_else(|| self.error("RENDER-404", path, "invalid object reference"));
        }
        Err(self.error("RENDER-404", path, "expected a declared object"))
    }
    /// Resolve a schema string without unchecked indexing.
    pub fn name(&self, index: u32, path: &str) -> Result<&'a str, PropsError> {
        self.module
            .strings
            .get(index)
            .map_err(|e| self.error("RENDER-404", path, e.to_string()))
    }
    /// Enter a field, preserving the declaration metadata and limiting recursion.
    pub fn field(
        &self,
        field: &PropField,
        rust: PropsSource,
        path: &str,
    ) -> Result<Self, PropsError> {
        self.descend(path).map(|mut child| {
            child.typescript = self
                .module
                .strings
                .get(field.file)
                .ok()
                .map(|file| PropsSource::new(file, field.line, field.column));
            child.rust = Some(rust);
            child
        })
    }
    fn descend(&self, path: &str) -> Result<Self, PropsError> {
        if self.depth >= crate::format::MAX_SCHEMA_ITEMS {
            return Err(self.error(
                "RENDER-404",
                path,
                "props value depth exceeds the schema limit",
            ));
        }
        Ok(Self {
            module: self.module,
            route: self.route,
            typescript: self.typescript.clone(),
            rust: self.rust.clone(),
            depth: self.depth + 1,
        })
    }
    /// Encode a literal only if it belongs to the bound enum set.
    pub fn enumeration(
        &self,
        kind: &PropType,
        path: &str,
        literal: &str,
    ) -> Result<Option<Value>, PropsError> {
        if let PropType::Enum(names) = self.required(kind) {
            for index in names {
                if self.name(*index, path)? == literal {
                    return Ok(Some(Value::String(literal.into())));
                }
            }
        }
        Err(self.error(
            "RENDER-404",
            path,
            "enum value is absent from the declared literal set",
        ))
    }
}

/// A props contract checked once against an immutable module. A development reload
/// creates a new binding; an existing binding always projects through its own module.
#[derive(Debug)]
pub struct BoundProps<P: PageProps> {
    module: std::sync::Arc<IrModule>,
    route: String,
    source: PropsSource,
    warnings: Vec<super::PropsWarning>,
    marker: std::marker::PhantomData<fn() -> P>,
}
impl<P: PageProps> BoundProps<P> {
    /// Derive and compare metadata once, retaining the exact module used at bind.
    pub fn bind(module: std::sync::Arc<IrModule>, route: &str) -> Result<Self, Vec<PropsError>> {
        let rust = P::rust_type().map_err(|e| vec![e.with_route(route)])?;
        let warnings = compare_schema(&module, &rust, route)?;
        Ok(Self {
            module,
            route: route.into(),
            source: rust.source,
            warnings,
            marker: std::marker::PhantomData,
        })
    }
    /// The verified module, also used for value projection and rendering.
    pub fn module(&self) -> &IrModule {
        &self.module
    }
    /// Stable module identity for development reload detection.
    pub fn module_arc(&self) -> &std::sync::Arc<IrModule> {
        &self.module
    }
    /// Extra Rust fields reported once at bind.
    pub fn warnings(&self) -> &[super::PropsWarning] {
        &self.warnings
    }
    /// Check each value and encode only the already-bound TypeScript fields.
    pub fn encode(&self, props: &P) -> Result<Value, PropsError> {
        project(&self.module, props, &self.route, self.source.clone())
    }
}

fn project<P: PageProps>(
    module: &IrModule,
    props: &P,
    route: &str,
    source: PropsSource,
) -> Result<Value, PropsError> {
    let context = EncodeContext {
        module,
        route,
        typescript: None,
        rust: Some(source),
        depth: 0,
    };
    props
        .encode_value(&context, &PropType::Object(0), "")?
        .ok_or_else(|| context.error("RENDER-404", "", "page props cannot be absent"))
}

/// Encode only declared fields after checking assignability. A typed page handle
/// may cache bind metadata, but value validation always uses its current module.
pub fn encode_props<P: PageProps>(
    module: &IrModule,
    props: &P,
    route: &str,
) -> Result<Value, PropsError> {
    let rust = P::rust_type().map_err(|e| e.with_route(route))?;
    if let Err(errors) = compare_schema(module, &rust, route) {
        if let Some(error) = errors.into_iter().next() {
            return Err(error);
        }
    }
    project(module, props, route, rust.source)
}

macro_rules! primitive {
    ($ty:ty,$kind:ident,$convert:expr) => {
        impl PropValue for $ty {
            fn describe(_: &mut SchemaBuilder) -> Result<PropType, PropsError> {
                Ok(PropType::$kind)
            }
            fn encode_value(
                &self,
                context: &EncodeContext<'_>,
                kind: &PropType,
                path: &str,
            ) -> Result<Option<Value>, PropsError> {
                if !matches!(context.required(kind), PropType::$kind) {
                    return Err(context.error(
                        "RENDER-404",
                        path,
                        "value does not match the declared type",
                    ));
                }
                ($convert)(self, context, path).map(Some)
            }
        }
    };
}
primitive!(bool, Boolean, |value: &bool,
                           _: &EncodeContext<'_>,
                           _: &str| Ok::<
    Value,
    PropsError,
>(
    Value::Bool(*value)
));
primitive!(String, String, |value: &String,
                            _: &EncodeContext<'_>,
                            _: &str| Ok::<
    Value,
    PropsError,
>(
    Value::String(value.clone())
));
const MAX_SAFE: i64 = 9_007_199_254_740_991;
macro_rules! integers {
    ($($ty:ty),*)=>{$(primitive!($ty,Number,|value:&$ty,context:&EncodeContext<'_>,path:&str|{
        // Compare in the integer domain before any conversion can round the input.
        let number=*value as i128;
        if !(-(MAX_SAFE as i128)..=MAX_SAFE as i128).contains(&number){return Err(context.error("RENDER-401",path,"integer exceeds JavaScript's exact range ±(2^53 - 1)"));}
        Ok(Value::Number(serde_json::Number::from(number as i64)))
    });)*};
}
integers!(i8, i16, i32, i64, u8, u16, u32, u64, isize, usize);
macro_rules! floats {($($ty:ty),*)=>{$(primitive!($ty,Number,|value:&$ty,context:&EncodeContext<'_>,path:&str|{
    serde_json::Number::from_f64(*value as f64).map(Value::Number).ok_or_else(||context.error("RENDER-402",path,"number must be finite"))
});)*};}
floats!(f32, f64);
primitive!(
    std::time::SystemTime,
    Date,
    |value: &std::time::SystemTime, context: &EncodeContext<'_>, path: &str| {
        let (negative, duration) = match value.duration_since(std::time::UNIX_EPOCH) {
            Ok(d) => (false, d),
            Err(e) => (true, e.duration()),
        };
        // JS Date precision is integer milliseconds. Truncate fractional milliseconds
        // toward zero on both sides of the epoch, matching this documented wire rule.
        let millis = duration.as_millis();
        if millis > 8_640_000_000_000_000 || millis > MAX_SAFE as u128 {
            return Err(context.error(
                "RENDER-403",
                path,
                "date exceeds the valid JavaScript Date range ±8.64e15 milliseconds",
            ));
        }
        let value = millis as i64 * if negative { -1 } else { 1 };
        Ok(Value::Number(value.into()))
    }
);
impl<T: PropValue> PropValue for Option<T> {
    fn describe(builder: &mut SchemaBuilder) -> Result<PropType, PropsError> {
        Ok(PropType::Optional(Box::new(builder.nested::<T>()?)))
    }
    fn encode_value(
        &self,
        context: &EncodeContext<'_>,
        kind: &PropType,
        path: &str,
    ) -> Result<Option<Value>, PropsError> {
        let PropType::Optional(inner) = kind else {
            return Err(context.error(
                "RENDER-404",
                path,
                "Option needs an optional declared type",
            ));
        };
        match self {
            Some(value) => value.encode_value(context, inner, path),
            None => Ok(None),
        }
    }
}
impl<T: PropValue> PropValue for Vec<T> {
    fn describe(builder: &mut SchemaBuilder) -> Result<PropType, PropsError> {
        Ok(PropType::Array(Box::new(builder.nested::<T>()?)))
    }
    fn encode_value(
        &self,
        context: &EncodeContext<'_>,
        kind: &PropType,
        path: &str,
    ) -> Result<Option<Value>, PropsError> {
        let PropType::Array(inner) = context.required(kind) else {
            return Err(context.error("RENDER-404", path, "Vec needs an array declared type"));
        };
        let context = context.descend(path)?;
        let mut values = Vec::with_capacity(self.len());
        for (index, value) in self.iter().enumerate() {
            values.push(
                value
                    .encode_value(&context, inner, &format!("{path}[{index}]"))?
                    .unwrap_or(Value::Null),
            );
        }
        Ok(Some(Value::Array(values)))
    }
}

// Used by generated derives without requiring consumers to depend on serde_json.
#[doc(hidden)]
pub use serde_json::{Map as JsonMap, Value as JsonValue};
#[doc(hidden)]
pub fn child_path(parent: &str, name: &str) -> String {
    field_path(parent, name)
}
