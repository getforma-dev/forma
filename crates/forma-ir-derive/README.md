# forma-ir-derive

`#[derive(PageProps)]` supplies Forma's Rust page contract. Use its re-export
from `forma-ir`; applications do not need a direct dependency on this proc-macro
crate. The historical version 0.0.0 was a reservation placeholder. The current
3.0.0 implementation supports the declared FMIR props schema.

```rust
use forma_ir::PageProps;

#[derive(PageProps)]
struct User {
    display_name: String, // TypeScript displayName
    #[props(rename = "account-id")]
    account_id: u64,
    last_seen: Option<std::time::SystemTime>,
    roles: Vec<Role>,
}

#[derive(PageProps)]
enum Role {
    #[props(rename = "reader")]
    Reader,
    #[props(rename = "editor")]
    Editor,
}
```

Named structs and unit enums may contain `bool`, `String`, integer types through
64 bits, `f32`, `f64`, `SystemTime`, `Option<T>`, `Vec<T>`, and other derived named
types. Struct fields default to camelCase; enum literals retain their variant
names unless renamed. Attributes belong on fields or enum variants. Tuples,
unit structs, enum payloads/discriminants, generic declarations, recursive shapes,
maps, sets, references and unrestricted JSON values are unsupported. Invalid
shapes, attributes and duplicate final names report the offending declaration.
Recursive shapes return a bind error before value encoding.

The derive uses FMIR's actual `PropsSchema` and records each Rust field's source
file, line and column. Binding compares fields by name, regardless of order.
Every TypeScript field must exist in Rust, including optional fields. A required
Rust field may satisfy an optional TypeScript field; a Rust `Option` cannot
satisfy a required TypeScript field. Enum sets must match exactly. Extra Rust
fields produce warnings and are never encoded.

`forma_ir::props::BoundProps<P>` verifies a module once and retains it immutably.
Each call to `encode` projects only the declared fields, omits absent object
fields, and preserves absent array elements as null placeholders. Integer checks
run before any floating-point conversion and enforce ±(2^53−1); floats must be
finite. Dates encode signed epoch milliseconds, truncating sub-millisecond
precision toward zero, with the valid JavaScript Date bound ±8.64e15 ms. Failures
include route, property path and both declarations where available. A development
reload constructs a fresh binding for the new module.

Licensed under the MIT licence.
