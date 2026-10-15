//! The server half of the parity harness (FORMA-183, DR-9): `e2e/parity/`
//! drives this example to describe a module's declared schema and to render
//! generated states with the real walker. It writes a JSON protocol to stdout
//! and nothing else; every failure is a JSON `error` or a non-zero exit with
//! the reason on stderr.
//!
//! ```text
//! parity_render describe <module.ir>
//!     -> {"schema": [[{"name", "type"}]], "islands": [...], "slots": [...]}
//! parity_render render <module.ir> < {"states": [ {slot name: value}, ... ]}
//!     -> [ {"html", "state", "counts": {"nodes", "bytes", "listIterations"}} | {"error"} ]
//! ```
//!
//! `render` is the low-level path: `SlotData::from_json` by slot name and
//! `walk_to_html_counted`, as `crates/forma-ir/src/js_emitter_contract.rs`
//! renders the corpus. The typed path through `Pages::bind` (a harness
//! `PageProps` built from the module's own schema) is FORMA-183's second
//! slice; `e2e/parity/README.md` describes the harness.
// A protocol on stdout and the reason for a failure on stderr is this example's whole job.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::error::Error;
use std::io::Read;

use forma_ir::schema::PropType;
use forma_ir::{walk_to_html_counted, IrModule, SlotData, WalkLimits};
use serde_json::{json, Value};

fn main() {
    if let Err(err) = run() {
        eprintln!("parity_render: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, path) = match args.as_slice() {
        [command, path] => (command.as_str(), path.as_str()),
        _ => return Err("usage: parity_render describe|render <module.ir>".into()),
    };
    let bytes = std::fs::read(path).map_err(|e| format!("reading {path}: {e}"))?;
    let module = IrModule::parse(&bytes).map_err(|e| format!("{path} is not FMIR: {e:?}"))?;
    match command {
        "describe" => {
            println!("{}", describe(&module)?);
            Ok(())
        }
        "render" => {
            let mut input = String::new();
            std::io::stdin().read_to_string(&mut input)?;
            let request: Value = serde_json::from_str(&input)?;
            let states = request
                .get("states")
                .and_then(Value::as_array)
                .ok_or("render: stdin must be {\"states\": [...]}")?;
            let rendered: Vec<Value> = states.iter().map(|state| render(&module, state)).collect();
            println!("{}", Value::Array(rendered));
            Ok(())
        }
        other => Err(format!("unknown command {other}; use describe or render").into()),
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
    Ok(json!({ "schema": objects, "islands": islands, "slots": slots }).to_string())
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
