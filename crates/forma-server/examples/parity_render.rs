//! The server half of the parity harness (FORMA-183, DR-9): `e2e/parity/`
//! drives this example to describe a module's declared schema and to render
//! generated states with the real walker. It writes a JSON protocol to stdout
//! and nothing else; every failure is a JSON entry or a non-zero exit with the
//! reason on stderr.
//!
//! ```text
//! parity_render describe <module.ir>
//!     -> {"schema": [[{"name", "type"}]], "islands": [...], "slots": [...], "keys": [...]}
//! parity_render render <module.ir> < {"states": [ {slot name: value}, ... ]}
//!     -> [ {"html", "state", "counts"} | {"error", "componentPath"} ]
//! parity_render typed < {"modules": [{"name", "route", "manifest", "files", "states"}]}
//!     -> [ {"name", "bind": [] | [refusal...], "renders": [ {"document", "headers"}
//!                                                          | {"refused": refusal} | {"error"} ]} ]
//! ```
//!
//! `typed` is the application's path: the manifest (synthesized by the
//! harness around the one module), `load_ir_modules`, `Pages::bind` with
//! [`DynProps`], `finalize`, and `PageHandle::render` per state, whose
//! document and headers the browser then serves as they are. `render` is the
//! low-level path, `SlotData::from_json` by slot name and
//! `walk_to_html_counted`, as `crates/forma-ir/src/js_emitter_contract.rs`
//! renders the corpus. `e2e/parity/README.md` describes the harness.
// A protocol on stdout and the reason for a failure on stderr is this example's whole job.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;
use std::error::Error;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use forma_ir::props::{
    child_path, EncodeContext, PageProps, PropValue, PropsError, PropsSource, SchemaBuilder,
};
use forma_ir::schema::{PropField, PropType};
use forma_ir::{walk_to_html_counted, IrModule, SlotData, WalkLimits};
use forma_server::{load_ir_modules, AssetManifest, RenderCtx, RenderError};
use rust_embed::{EmbeddedFile, Metadata};
use serde_json::{json, Value};

fn main() {
    if let Err(err) = run() {
        eprintln!("parity_render: {err}");
        std::process::exit(1);
    }
}

fn stdin_json() -> Result<Value, Box<dyn Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(serde_json::from_str(&input)?)
}

fn read_module(path: &str) -> Result<IrModule, Box<dyn Error>> {
    let bytes = std::fs::read(path).map_err(|e| format!("reading {path}: {e}"))?;
    Ok(IrModule::parse(&bytes).map_err(|e| format!("{path} is not FMIR: {e:?}"))?)
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["describe", path] => {
            println!("{}", describe(&read_module(path)?)?);
            Ok(())
        }
        ["render", path] => {
            let module = read_module(path)?;
            let request = stdin_json()?;
            let states = request
                .get("states")
                .and_then(Value::as_array)
                .ok_or("render: stdin must be {\"states\": [...]}")?;
            let rendered: Vec<Value> = states.iter().map(|state| render(&module, state)).collect();
            println!("{}", Value::Array(rendered));
            Ok(())
        }
        ["typed"] => {
            let request = stdin_json()?;
            let modules = request
                .get("modules")
                .and_then(Value::as_array)
                .ok_or("typed: stdin must be {\"modules\": [...]}")?;
            let mut out = Vec::with_capacity(modules.len());
            for module in modules {
                out.push(typed(module)?);
            }
            println!("{}", Value::Array(out));
            Ok(())
        }
        _ => Err("usage: parity_render describe <module.ir> | render <module.ir> | typed".into()),
    }
}

/// The declared props schema in the registration form core reads
/// (`IslandSchema`: `[[{name, type}]]`, object 0 the page), plus the island
/// and slot tables so the harness can decide how a state reaches the walker.
fn describe(module: &IrModule) -> Result<String, Box<dyn Error>> {
    let string = |idx: u32| -> Result<String, Box<dyn Error>> {
        Ok(module
            .strings
            .get(idx)
            .map_err(|e| format!("{e:?}"))?
            .to_string())
    };
    let mut objects = Vec::new();
    for fields in &module.schema.objects {
        let mut out = Vec::with_capacity(fields.len());
        for field in fields {
            out.push(
                json!({ "name": string(field.name)?, "type": prop_type(module, &field.kind)? }),
            );
        }
        objects.push(Value::Array(out));
    }
    let mut islands = Vec::new();
    for entry in module.islands.entries() {
        islands.push(json!({
            "id": entry.id,
            "name": string(entry.name_str_idx)?,
            "schemaObject": entry.schema_object,
            "h": entry.digest.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        }));
    }
    let mut slots = Vec::new();
    for entry in module.slots.entries() {
        slots.push(json!({
            "id": entry.slot_id,
            "name": string(entry.name_str_idx)?,
            "type": format!("{:?}", entry.type_hint).to_lowercase(),
            "source": format!("{:?}", entry.source).to_lowercase(),
            "default": String::from_utf8_lossy(&entry.default_bytes),
        }));
    }
    // Each keyed LIST (FMIR section 0x0006, FORMA-181) with the slot it iterates, read
    // from the LIST opcode's operands (slot_id, u16 little-endian, after the opcode byte).
    let mut keys = Vec::new();
    for key in &module.key_paths {
        let at = key.list_offset as usize + 1;
        let slot_id = module
            .opcodes
            .get(at..at + 2)
            .and_then(|bytes| <[u8; 2]>::try_from(bytes).ok())
            .map(u16::from_le_bytes);
        let slot =
            match slot_id.and_then(|id| module.slots.entries().iter().find(|s| s.slot_id == id)) {
                Some(entry) => Some(string(entry.name_str_idx)?),
                None => None,
            };
        let mut path = Vec::with_capacity(key.segments.len());
        for segment in &key.segments {
            path.push(string(*segment)?);
        }
        keys.push(json!({ "listOffset": key.list_offset, "slot": slot, "path": path }));
    }
    Ok(json!({ "schema": objects, "islands": islands, "slots": slots, "keys": keys }).to_string())
}

fn prop_type(module: &IrModule, kind: &PropType) -> Result<Value, Box<dyn Error>> {
    Ok(match kind {
        PropType::Boolean => json!({ "kind": "boolean" }),
        PropType::String => json!({ "kind": "string" }),
        PropType::Number => json!({ "kind": "number" }),
        PropType::Date => json!({ "kind": "date" }),
        PropType::Enum(variants) => {
            let mut names = Vec::with_capacity(variants.len());
            for idx in variants {
                names.push(module.strings.get(*idx).map_err(|e| format!("{e:?}"))?);
            }
            json!({ "kind": "enum", "variants": names })
        }
        PropType::Array(element) => {
            json!({ "kind": "array", "element": prop_type(module, element)? })
        }
        PropType::Optional(inner) => {
            json!({ "kind": "optional", "inner": prop_type(module, inner)? })
        }
        PropType::Object(index) => json!({ "kind": "object", "object": index }),
    })
}

/// One state through the real walker: the page HTML, the head state block
/// and the walk's counts, or the walker's error.
fn render(module: &IrModule, state: &Value) -> Value {
    let slots = match SlotData::from_json(&state.to_string(), module) {
        Ok(slots) => slots,
        Err(e) => return json!({ "error": format!("state is not slot JSON: {e:?}") }),
    };
    match walk_to_html_counted(module, &slots, WalkLimits::default()) {
        Ok(output) => json!({
            "html": output.html,
            "state": output.island_state.as_json(),
            "counts": {
                "nodes": output.counts.nodes,
                "bytes": output.counts.bytes,
                "listIterations": output.counts.list_iterations,
            },
        }),
        Err(failure) => json!({
            "error": format!("{:?}", failure.error),
            "componentPath": failure.component_path,
        }),
    }
}

// ---------------------------------------------------------------------------
// The typed path
// ---------------------------------------------------------------------------

/// The files of the module being rendered, by the name the manifest gives
/// them. The examples run one module at a time, so one table suffices.
fn files() -> &'static Mutex<HashMap<String, PathBuf>> {
    static FILES: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    FILES.get_or_init(Default::default)
}

/// The production loader's `Embed`, over the files the harness names.
struct HarnessFiles;
impl rust_embed::Embed for HarnessFiles {
    fn get(name: &str) -> Option<EmbeddedFile> {
        let path = files()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(name)
            .cloned()?;
        Some(EmbeddedFile {
            data: Cow::Owned(std::fs::read(path).ok()?),
            metadata: Metadata::__rust_embed_new([0; 32], None, None),
        })
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        let names: Vec<String> = files()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .keys()
            .cloned()
            .collect();
        names.into_iter().map(Cow::Owned)
    }
}

/// A declared type, with enum literals and field names resolved.
#[derive(Debug, Clone)]
enum DynType {
    Boolean,
    String,
    Number,
    Date,
    Enum(Vec<String>),
    Array(Box<DynType>),
    Optional(Box<DynType>),
    Object(usize),
}
type DynSchema = Vec<Vec<(String, DynType)>>;

thread_local! {
    /// The schema [`DynProps::describe`] mirrors. `describe` is a static
    /// function, so the module being bound is set here before `bind`.
    static SCHEMA: RefCell<DynSchema> = const { RefCell::new(Vec::new()) };
}

fn dyn_type(module: &IrModule, kind: &PropType) -> Result<DynType, Box<dyn Error>> {
    Ok(match kind {
        PropType::Boolean => DynType::Boolean,
        PropType::String => DynType::String,
        PropType::Number => DynType::Number,
        PropType::Date => DynType::Date,
        PropType::Enum(variants) => DynType::Enum(
            variants
                .iter()
                .map(|idx| module.strings.get(*idx).map(str::to_owned))
                .collect::<Result<_, _>>()
                .map_err(|e| format!("{e:?}"))?,
        ),
        PropType::Array(inner) => DynType::Array(Box::new(dyn_type(module, inner)?)),
        PropType::Optional(inner) => DynType::Optional(Box::new(dyn_type(module, inner)?)),
        PropType::Object(index) => DynType::Object(usize::from(*index)),
    })
}

fn dyn_schema(module: &IrModule) -> Result<DynSchema, Box<dyn Error>> {
    let mut objects = Vec::with_capacity(module.schema.objects.len());
    for fields in &module.schema.objects {
        let mut out = Vec::with_capacity(fields.len());
        for field in fields {
            let name = module
                .strings
                .get(field.name)
                .map_err(|e| format!("{e:?}"))?;
            out.push((name.to_owned(), dyn_type(module, &field.kind)?));
        }
        objects.push(out);
    }
    Ok(objects)
}

/// A harness `PageProps`: its Rust schema is the module's own declared schema
/// (set in [`SCHEMA`] before `bind`), and its value is a JSON state projected
/// by the declared types with the codes a derived struct refuses with
/// (`RENDER-402` a non-finite number, `RENDER-403` a date out of range,
/// `RENDER-404` a value of the wrong kind or an enum literal not declared).
/// A number may also be `{"$number": "NaN" | "Infinity" | "-Infinity"}`, the
/// values JSON cannot carry, for the refusal table. It lives in this example,
/// not in the crate's API, and goes through the real `bind`,
/// `compare_schema`, `finalize`, `render`, `WalkLimits` and head-block
/// encoder, as an application's request does.
struct DynProps(Value);

/// One marker type per schema object: `SchemaBuilder::object` keys objects by
/// type, so object `N` of the module is `Object<N>` here.
struct Object<const N: usize>;

fn harness_refusal(message: impl Into<String>) -> PropsError {
    PropsError {
        code: "BIND-105",
        route: String::new(),
        path: String::new(),
        message: message.into(),
        typescript: None,
        rust: None,
    }
}

fn describe_object(
    builder: &mut SchemaBuilder,
    schema: &DynSchema,
    index: usize,
) -> Result<PropType, PropsError> {
    macro_rules! objects {
        ($($n:literal)*) => {
            match index {
                $($n => builder.object::<Object<$n>>(|b| describe_fields(b, schema, $n)),)*
                _ => Err(harness_refusal(format!("schema object {index} is past the harness's 64 object markers"))),
            }
        };
    }
    objects!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
             32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63)
}

fn describe_fields(
    builder: &mut SchemaBuilder,
    schema: &DynSchema,
    index: usize,
) -> Result<Vec<PropField>, PropsError> {
    let declared = schema
        .get(index)
        .ok_or_else(|| harness_refusal(format!("schema object {index} does not exist")))?;
    let mut fields = Vec::with_capacity(declared.len());
    for (name, kind) in declared {
        let kind = describe_type(builder, schema, kind)?;
        fields.push(builder.field(name, PropsSource::new("parity_render.rs", 1, 1), kind)?);
    }
    Ok(fields)
}

fn describe_type(
    builder: &mut SchemaBuilder,
    schema: &DynSchema,
    kind: &DynType,
) -> Result<PropType, PropsError> {
    Ok(match kind {
        DynType::Boolean => PropType::Boolean,
        DynType::String => PropType::String,
        DynType::Number => PropType::Number,
        DynType::Date => PropType::Date,
        DynType::Enum(names) => {
            builder.enumeration(&names.iter().map(String::as_str).collect::<Vec<_>>())?
        }
        DynType::Array(inner) => PropType::Array(Box::new(describe_type(builder, schema, inner)?)),
        DynType::Optional(inner) => {
            PropType::Optional(Box::new(describe_type(builder, schema, inner)?))
        }
        DynType::Object(index) => describe_object(builder, schema, *index)?,
    })
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| match value.get("$number")?.as_str()? {
            "NaN" => Some(f64::NAN),
            "Infinity" => Some(f64::INFINITY),
            "-Infinity" => Some(f64::NEG_INFINITY),
            _ => None,
        })
}

/// The largest JavaScript `Date`, in milliseconds either side of the epoch.
const MAX_DATE: f64 = 8.64e15;

/// Project one JSON value by its declared type. Wherever the crate has a public `PropValue`
/// implementation the value is handed to it, so a change to the crate's own checks is seen here:
/// `Option` (absent and `null` are `None`), `bool`, `String`, `f64` (a non-finite number is
/// `RENDER-402`), `Vec` (the crate's own row paths, `null` placeholders and depth limit), and
/// enums through `EncodeContext::enumeration`. The harness keeps only what has no public
/// counterpart: a JSON value of the wrong kind or missing (`RENDER-404`), dates (the crate's
/// `SystemTime` implementation cannot represent the ±8.64e15 bounds on every platform, so the
/// bound and the truncation toward zero are mirrored, `RENDER-403`), and the object projection
/// (the derive's own pattern: `context.object`, `context.name`, `context.field`). `RENDER-401`
/// (an integer origin beyond ±(2^53 − 1)) is unreachable: every JSON number is an f64.
fn encode(
    context: &EncodeContext<'_>,
    kind: &PropType,
    path: &str,
    value: Option<&Value>,
) -> Result<Option<Value>, PropsError> {
    let mismatch = || context.error("RENDER-404", path, "value does not match the declared type");
    if let PropType::Optional(_) = kind {
        let present = match value {
            None | Some(Value::Null) => None,
            Some(value) => Some(DynProps(value.clone())),
        };
        return present.encode_value(context, kind, path);
    }
    let value =
        value.ok_or_else(|| context.error("RENDER-404", path, "declared value is missing"))?;
    match kind {
        PropType::Boolean => value
            .as_bool()
            .ok_or_else(mismatch)?
            .encode_value(context, kind, path),
        PropType::String => value
            .as_str()
            .map(str::to_owned)
            .ok_or_else(mismatch)?
            .encode_value(context, kind, path),
        PropType::Number => number(value)
            .ok_or_else(mismatch)?
            .encode_value(context, kind, path),
        PropType::Date => {
            let n = number(value).ok_or_else(mismatch)?;
            if !n.is_finite() || n.abs() > MAX_DATE {
                return Err(context.error(
                    "RENDER-403",
                    path,
                    "date exceeds the valid JavaScript Date range ±8.64e15 milliseconds",
                ));
            }
            // Integer milliseconds, truncated toward zero, as a derived SystemTime is.
            #[allow(clippy::cast_possible_truncation)]
            let millis = n.trunc() as i64;
            Ok(Some(Value::Number(millis.into())))
        }
        PropType::Enum(_) => context.enumeration(kind, path, value.as_str().ok_or_else(mismatch)?),
        PropType::Array(_) => value
            .as_array()
            .ok_or_else(mismatch)?
            .iter()
            .map(|item| DynProps(item.clone()))
            .collect::<Vec<_>>()
            .encode_value(context, kind, path),
        PropType::Object(_) => {
            let map = value.as_object().ok_or_else(mismatch)?;
            let mut out = serde_json::Map::new();
            for field in context.object(kind, path)? {
                let name = context.name(field.name, path)?;
                let field_path = child_path(path, name);
                let inner = context.field(
                    field,
                    PropsSource::new("parity_render.rs", 1, 1),
                    &field_path,
                )?;
                if let Some(encoded) = encode(&inner, &field.kind, &field_path, map.get(name))? {
                    out.insert(name.to_owned(), encoded);
                }
            }
            Ok(Some(Value::Object(out)))
        }
        PropType::Optional(_) => Err(mismatch()),
    }
}

impl PropValue for DynProps {
    fn describe(builder: &mut SchemaBuilder) -> Result<PropType, PropsError> {
        let schema = SCHEMA.with(|schema| schema.borrow().clone());
        describe_object(builder, &schema, 0)
    }
    fn encode_value(
        &self,
        context: &EncodeContext<'_>,
        kind: &PropType,
        path: &str,
    ) -> Result<Option<Value>, PropsError> {
        encode(context, kind, path, Some(&self.0))
    }
}
impl PageProps for DynProps {}

fn refusal(error: &PropsError) -> Value {
    json!({ "code": error.code, "route": error.route, "path": error.path, "message": error.message })
}

/// One module: load it through the production loader, bind [`DynProps`],
/// finalize, then render each state.
fn typed(request: &Value) -> Result<Value, Box<dyn Error>> {
    let name = request
        .get("name")
        .and_then(Value::as_str)
        .ok_or("typed: a module needs a name")?;
    let route = request.get("route").and_then(Value::as_str).unwrap_or("/");
    // Whatever stops this one module (its manifest refused, a file missing, the loader's
    // refusal, a bind refusal) is this module's entry, not the batch's failure.
    let refused = |errors: Vec<Value>| json!({ "name": name, "bind": errors, "renders": [] });
    let harness = |code: &str, message: String| {
        refused(vec![
            json!({ "code": code, "route": route, "path": "", "message": message }),
        ])
    };
    let manifest: AssetManifest = match serde_json::from_value(
        request
            .get("manifest")
            .cloned()
            .ok_or("typed: a module needs a manifest")?,
    ) {
        Ok(manifest) => manifest,
        Err(e) => return Ok(harness("MANIFEST", e.to_string())),
    };
    let named = request
        .get("files")
        .and_then(Value::as_object)
        .ok_or("typed: a module needs its files")?;
    let mut table = HashMap::new();
    for (file, path) in named {
        let path = path.as_str().ok_or("typed: a file path must be a string")?;
        table.insert(file.clone(), PathBuf::from(path));
    }
    let ir_path = manifest
        .route(route)
        .and_then(|assets| assets.ir.as_ref())
        .and_then(|ir| table.get(ir))
        .cloned();
    *files().lock().unwrap_or_else(|p| p.into_inner()) = table;

    let pages = match load_ir_modules::<HarnessFiles>(&manifest) {
        Ok(pages) => pages,
        Err(errors) => {
            return Ok(refused(
                errors
                    .iter()
                    .map(|e| json!({ "code": e.code().unwrap_or("LOAD"), "route": e.route, "path": e.ir_file, "message": e.reason }))
                    .collect(),
            ))
        }
    };
    // The loader accepted the module; DynProps mirrors its declared schema.
    let Some(ir_path) = ir_path else {
        return Ok(harness("MANIFEST", format!("no module file for {route}")));
    };
    let module = match read_module(&ir_path.to_string_lossy()) {
        Ok(module) => module,
        Err(e) => return Ok(harness("LOAD", e.to_string())),
    };
    let schema = match dyn_schema(&module) {
        Ok(schema) => schema,
        Err(e) => return Ok(harness("BIND-105", e.to_string())),
    };
    SCHEMA.with(|current| *current.borrow_mut() = schema);
    let handle = match pages.bind::<DynProps>(route) {
        Ok(handle) => handle,
        Err(errors) => return Ok(refused(errors.iter().map(refusal).collect())),
    };
    if let Err(errors) = pages.finalize() {
        return Ok(refused(errors.iter().map(refusal).collect()));
    }
    let states = request
        .get("states")
        .and_then(Value::as_array)
        .ok_or("typed: a module needs its states")?;
    let mut renders = Vec::with_capacity(states.len());
    for state in states {
        renders.push(
            match handle.render(&DynProps(state.clone()), &RenderCtx::new()) {
                Ok(response) => {
                    let parts = response.into_parts_unchecked();
                    let mut headers = serde_json::Map::new();
                    for (header, value) in &parts.headers {
                        headers.insert(
                            header.as_str().to_owned(),
                            Value::String(value.to_str().unwrap_or_default().to_owned()),
                        );
                    }
                    json!({ "document": parts.html, "headers": headers })
                }
                Err(RenderError::Props { cause, .. }) => json!({ "refused": refusal(&cause) }),
                Err(other) => {
                    json!({ "error": { "code": other.code(), "message": other.to_string() } })
                }
            },
        );
    }
    Ok(json!({ "name": name, "bind": [], "renders": renders }))
}
