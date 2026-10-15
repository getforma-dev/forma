# FORMA-103 state and binding wire proposal

Status: exact grammar proposed for independent review, 2026-10-15. This document
does not describe an implemented reader. The existing `FMIR-FORMAT.md` remains
the implemented contract until this proposal is approved and the paired reader,
writer, dump and ordinary controls land. No package version changes in this
development stage. Entry selection is separately fixed in `06d31a5`.

Authority: DR-4, DR-21, L-30, L-35's disclosure rule, L-43, L-44(a), SR19 and
SR35, FORMA-103, and the lead's transfer of the identity/pre-trigger part of
FORMA-105. FORMA-105 retains islands-only/static-page/template rollout;
FORMA-104 owns adoption's structural/value transaction. The final typed server
API comes from FORMA-107 and the mandatory policy from FORMA-109.

## 1. Physical section and compatibility

All integers below are unsigned little-endian unless stated otherwise. A length
counts bytes, never code points, and excludes its own prefix. Every bounded
record must be consumed exactly; these records have no optional trailing bytes.
The existing island entry's documented trailing-extension rule is unchanged.

Reserve required section `0x000A`, **island contracts**, with descriptor flags
exactly `SECTION_REQUIRED` (1). New writers emit it even when there are no
islands or closed constants, in which case its complete payload is `00 00 00 00`. New readers accept an
absent section only when the island table is empty and the bytecode has no
COALESCE. A nonempty island table without it is `LOAD-105 MissingSection(10)`
with a rebuild diagnostic. This explicitly retires pre-contract development
islands even though their package base version is also 3.0.0. There is no
legacy capture-list inference. Old readers refuse a new required section with
`LOAD-106`; they never interpret ordered inputs as legacy captures.

```
contract_count u16
repeat contract_count times:
  record_len u32
  island_id u16
  bindings_len u32
  binding_bytes[bindings_len]
  schema_len u32
  schema_bytes[schema_len]
constant_count u16
repeat constant_count times:
  slot_id u16
  constant_len u32
  constant_bytes[constant_len]   constant grammar from section3
```

`record_len = 10 + bindings_len + schema_len`. Records are in strictly ascending
static `island_id` order, with exactly one record per island-table entry. Static
ids need not be dense. Counts are at most `MAX_ISLANDS` (4096). Check this and
`count * 22 <= remaining_bytes - 2` before allocating: the shortest record is its
4-byte length, 10-byte prefix, 3-byte binding program and 5-byte empty-root schema; retain two bytes for the
constant count. No subtraction occurs before checking those two bytes exist.
Each byte array is at most 1,048,576 bytes and the existing 16,777,216-byte module
limit still bounds their sum. Checked addition/multiplication is mandatory.

The closed constant table is sorted by unique global slot id, at most65,535
records. Check `constant_count * 7 <= remaining_bytes` before allocating; each
constant is at least its one-byte tag and at most65,538 bytes. Each referenced
slot is CLIENT, has zero default bytes in0x0003, and is never the destination of
PROP/COALESCE or the item slot of LIST. This table initializes it at module load
with the explicit typed constant. Zero default bytes without such an entry still
mean Null. This explicit table is necessary for empty strings: legacy text
default bytes cannot distinguish an empty string from absence. It adds no
implicit text quoting and changes no old slot encoding. The map's global ids
are excluded from identity; corresponding literal values are already in the
component binding bytes. Unreferenced constants are refused.


An island entry now requires `schema_object != 0xffff` and `digest_len = 8`.
`slot_count` equals the number of fields of its referenced global schema object.
Input `slot_ids[k]` supplies that object's kth field, in the global object's
stored field order, including optional and unused-in-markup fields. A repeated
slot id is valid: `{left:p.title,right:p.title}` has two ordered inputs pointing
to one value. Remove the legacy duplicate-capture check, retain declared-id,
count and type checks. Each island still has one static ISLAND_START offset.
Execution of that offset in a list can produce any number of request instances.

The compiler emits input preparation immediately before ISLAND_START. A skipped
branch produces no instance. Inputs are read at execution, not cached at module
load; a list input is the current row's value. No variable-name or encoded-path
slot convention becomes an API. The page's root SERVER mapping remains the
FORMA-102 contract; nested inputs use PROP and local scratch remains CLIENT.

## 2. Text and canonical schema bytes

`text := byte_len:u16, utf8[byte_len]`. UTF-8 must be well formed. There is no BOM
prefix, terminator, Unicode normalization, case folding, or locale comparison.
A U+FEFF that is part of a declared name is ordinary data. NUL is allowed in
string values/names; the three forbidden names below are exact scalar sequences.
The TypeScript writer refuses unpaired UTF-16 surrogates before UTF-8 encoding,
rather than allowing TextEncoder replacement to collapse two inputs.

All ordering of names/literals is lexicographic comparison of unsigned UTF-8
bytes, shorter prefix first. This is not JS's UTF-16 `.sort()` order. Strings
which differ only by Unicode normalization remain distinct.

```
schema_bytes:
  schema_version u8 = 1
  object_count u16
  repeat object_count times:
    field_count u16
    repeat field_count times:
      name text
      type

type:
  01 boolean
  02 string
  03 number
  04 date
  05 enum: variant_count u16; variant text[variant_count]
  06 array: type
  07 optional: type
  08 object: local_object_index u16
```

Object zero is the island's declared props object. Field names and enum variants
are sorted by the byte rule above and unique; an enum has at least one variant.
Field names and enum literal strings may be empty. Optional optional is normalized to one optional; an optional array
element remains optional and is not lifted onto the array. Consecutive array/
optional wrappers are limited to 16 exactly. Object-reference depth is separate:
the graph must be acyclic, with at most 1024 objects, 1024 fields per object and
1024 enum variants. A schema contains at least empty object zero. The minimum
schema is 5 bytes: `01 01 00 00 00`.

Canonical object numbering is determined by shape, not source aliases. First
merge structurally equal objects (same sorted field names and recursively equal
types; enum sets are sorted). Starting with root zero, visit sorted fields and
their types in preorder, traversing through wrapper tags; assign an unseen
structural object the next index before visiting its fields. Repeated references
reuse that index. All objects must be reachable from root zero. Source object
ids, aliases, imports, source files/positions, global string-table indices and
the order in which an analyzer discovered types do not enter these bytes.

The reader validates this canonical representation, not merely a graph that
would mean the same thing. Its root must be structurally equal to the island's
referenced `0x0005` object, comparing resolved names/literals and ignoring source
positions. Use bounded graph traversal/memoized equality, not exponential schema
expansion or unbounded host recursion. The global diagnostic schema remains
unchanged and supplies source locations for failures.

Any declared island field named `__proto__`, `constructor`, or `prototype` at
any reachable object depth is `BUILD-610`; a reader also refuses it. Such a
field cannot be declared required and then silently removed by the decoder.
Undeclared nested keys with those names are still stripped as a second guard.

## 3. Canonical binding program

Binding bytes describe the component's local data uses. They are metadata for
identity and validation, not a second evaluator or a bytecode replacement.
They contain no module slot ids, marker ids, byte offsets, call-site static
island ids, source positions or global string ids.

```
binding_bytes := binding_version:u8 (=1), block
block := record_count:u16, record[record_count]
record := payload_len:u32, kind:u8, kind_payload

kind 01 SIGNAL: value
kind 02 TEXT: value
kind 03 ATTRIBUTE: name:text, value
kind 04 SHOW: value, then:block, else:block
kind 05 LIST: value, key_count:u8, key_segment:text[key_count], body:block
kind 06 CHILD: registration_name:text, field_count:u16,
               (field_name:text, value)[field_count]
```

`payload_len` includes kind and its payload. Every record consumes exactly that
many bytes. Total records across all blocks are at most 65,535; block nesting is
at most 64 and nested LIST depth at most 4. Before each allocation check the
ceiling then `record_count * 5 <= remaining`. A LIST's key path is the existing
row-identity path, zero segments if no key is emitted, otherwise at most 32.
It is not a props delivery path. CHILD fields are unique and sorted by UTF-8;
they include every declared child field, including optional absent inputs.

The writer emits SIGNAL records in lexical execution order for the statically
executed declarations of that component scope. It emits dynamic output records
in render traversal order, preserving each SHOW branch and LIST body. Ordinary
non-island helper components are inlined into that traversal using resolved
bindings. A registered nested island contributes CHILD with its registration
key and call's field expressions; its own internal bindings belong to its own
contract and are not inlined into its parent's contract.

Signal ids are the zero-based preorder ordinal of SIGNAL records across this
component program; list ids are the equivalent LIST ordinals. Their namespaces
are separate. The second `createSignal(p.hits)` is a new SIGNAL even if its
initializer bytes equal the first. Lexical aliases resolve to their target;
variable renaming alone does not change an ordinal or its data expression.
An id may only be referenced where its declaration dominates execution and is
in lexical scope. Row ids are available only in that LIST's body. Signals in a
row have one static ordinal but separate runtime instances for each row.
Conditional/loop declaration execution is represented in the corresponding
block; unsupported control flow refuses rather than inventing an ordinal.

```
value := tag:u8, payload
  00 CONSTANT: constant
  01 PROP: segment_count:u16, segment:text[segment_count]
  02 SIGNAL_READ: signal_id:u16, segment_count:u16, segment:text[segment_count]
  03 ROW_READ: list_id:u16, segment_count:u16, segment:text[segment_count]
  04 NULLISH: source:value, fallback:constant
  05 UNARY: operator:u8, operand:value
  06 BINARY: operator:u8, left:value, right:value

constant := tag:u8, payload
  00 null
  01 false
  02 true
  03 number: IEEE-754 binary64 little-endian[8]
  04 string: text
  05 empty array

unary operators: 01 !, 02 unary +, 03 unary -
binary operators: 01 +, 02 -, 03 *, 04 /, 05 %, 06 **,
                  07 ===, 08 !==, 09 <, 0a <=, 0b >, 0c >=,
                  0d &&, 0e ||
```

PROP has at least one segment and resolves against root schema zero. SIGNAL_READ
and ROW_READ may have zero segments (read the value). Path length is at most
1024, separate from the 32-segment list key ceiling. Value-expression nesting is
at most 64; every variable-sized value consumes an enclosing bounded record.
CHILD field counts are at most1024, checked against remaining bytes with a
four-byte minimum per field. Path/key segment counts are checked against two
bytes per text before allocation. Schema objects/fields/variants use minima
2/3/2 respectively, with their ceilings checked first. Truncated scalars and
unknown tags/versions/operator values are LOAD-103; exceeded named ceilings
are LOAD-107. No tag/operator outside this grammar is accepted. Constant numbers must be
finite, and negative zero is encoded as positive zero. A source integer literal
beyond the safe integer range is a compile refusal, before rounding. An absent
optional object-field input uses null and is omitted when producing `p`; array
null elements keep their positions.

UNARY/BINARY preserve a local expression's semantic structure in the identity,
even where the existing SSR evaluator folds its initial value. They do not add
native arithmetic opcodes. Computed expressions that depend on declared props
remain BUILD-610 as in102, except the explicitly admitted NULLISH initializer.
Unknown calls/coercions/dynamic property names are not encoded as opaque source
text. If a rendered island binding cannot be represented, it fails BUILD-610
with the original location. Event-handler bodies, setters' event-time updates,
effects unrelated to rendering, static tags/text/attributes, CSS, trigger choice
and declaration locations do not enter these bytes. SIGNAL initializers do,
including unused local signals; text and dynamic attribute names/values do;
SHOW conditions and both branch bindings do; LIST sources, key paths and body
bindings do; nested island prop mappings do. A literal participates when it is
part of one of those expressions, not merely static markup.

This is intentionally a closed first contract: nonempty object/array constant
initializers and arbitrary call expressions are not newly admitted by103.
This limitation needs review against the repository fixtures before wire code;
there is no fallback digest for an omitted binding.

## 4. Identity bytes and checks

For each component contract, compute:

```
digest = SHA256(binding_bytes || schema_bytes)[0..8]
h = exactly 16 lowercase ASCII hexadecimal digits of digest
```

The payloads themselves carry their version bytes and counts; no extra separator,
record length, section prefix, name, schema index or module id enters the hash.
The eight stored island digest bytes are the digest byte order, not an integer.
Identical component-local programs/schemas at different page call sites share a
digest even when their ordered input slots/values differ. Repeated source slots
do not collapse declared fields. Reordering global source declarations/types or
global strings cannot change this digest. Changing a declared field or an
internal binding path does. Static-only markup changes do not claim a new
binding identity; structural adoption validation remains104's separate check.

The compiler's paired native/browser output consumes one compilation product;
the browser descriptor receives these same schema bytes and digest. Watch mode
must replace both outputs atomically from the successful current build and
cannot reuse the preceding build's contract. The Rust reader validates the
canonical data and schema/input correspondence; it does not recompile JavaScript
or cryptographically authenticate a producer. No new production crypto crate
is proposed. Independent golden controls compare the exact bytes and truncated
SHA-256 computed by Node and Python, then require the native dump to expose those
same validated bytes/digest. This identity is a compatibility check, not a
replacement for module/asset integrity validation.

## 5. COALESCE bytecode and typed flow

Reserve opcode `0x13` (decimal19), seven bytes total:

```
13 source_slot:u16 fallback_slot:u16 destination_slot:u16
```

At execution, choose fallback only when the source is Null, otherwise source.
Missing optional fields are Null in native slots. Zero, false and empty string
are values. Clone/copy the selected SlotValue into destination. This is ordinary
bytecode inside the current control region; budgets and structural boundaries
apply, with no instruction hidden inside contract metadata.

All three slots must exist. Destination is CLIENT, distinct from source and
fallback, with no default and a single static defining instruction. Repeated
execution of that instruction inside a list is permitted; sharing a destination
between two lexical signals is not. Fallback is a CLIENT constant initialized by the explicit0x000A constant
table, with no defining instruction anywhere in the module and no SERVER
ownership. Initial103 admission is scalar boolean/string/number or enum
fallback; dates and nonempty aggregate fallback are BUILD-610. An empty-string fallback is constant tag04 followed by length0000 in the
constant table; its source slot still has zero legacy default bytes, but the
table initializes it to Text("") rather than Null. An ordinary empty-string
source is likewise Text("") and must not select the fallback.

Typed validation must not mistake a slot hint for a full props type. Establish
SERVER root types from the page schema/name mapping; PROP refines a known object
field (and propagates optionality from its base); LIST gives its separate CLIENT
row temporary the array element type. Prop-seeded SIGNAL uses retain that known
type. Explicit constants have their literal primitive type; enum compatibility
checks the exact literal against the source enum set. COALESCE requires a known
`T` or `optional(T)` source, a non-null closed constant assignable to T, and a
destination hint matching T. NUMBER hints alone cannot equate Date and number.
Unknown provenance, incompatible enum literal, mismatched hints, overwritten
fallback, SERVER destination or ambiguous/differing control-flow definitions
refuse at load (`LOAD-103`) and at compile (`BUILD-610`). Definitions must
dominate uses on every executable path; a branch's temporary cannot be consumed
from its sibling or from a join without a proven compatible definition.

## 6. Request state and browser preflight

The native walk returns typed state entries separately from body HTML. At each
executed ISLAND_START it appends `{h,p}`, before visiting that island's children.
Its occurrence index is the array position. Parent precedes nested child;
different list iterations have different indices even with one static id.
The native host keeps `data-forma-island` for the static id and
`data-forma-component` for the registration key, and adds
`data-forma-state="<occurrence>"` and `data-forma-h="<16 lowercase hex>"`.
Occurrence is canonical unsigned decimal, no sign/leading zero except "0".
The block contains no redundant static id. `browserOnly` has an entry and empty
host. Browser-shell routes emit no state block and mount through their browser
entry; they do not attempt SSR-state preflight.

After the complete walk, project all declared fields through the actual schema;
omit undeclared extras and absent/null optional object fields, preserve optional
array positions as null, and check values before producing a PageResponse.
Numbers preserve102's contract: Rust integers are range-checked before numeric
conversion; f64 values must be finite. JSON cannot recover a Rust numeric type
that was not encoded, so the decoder does not invent integer provenance from a
generic TypeScript number. Dates are integer signed epoch milliseconds within
±8.64e15 and reconstruct Date by schema, not key name. Required null/missing,
wrong enum members/types and malformed dates refuse.

Serialize exactly one head script before body content:
`<script type="application/json" data-island-state>` with the compact envelope
`{"v":1,"s":[],"i":[{"h":"…","p":{…}}]}`. All declared props are disclosure,
including unused fields. Every literal `<` becomes the six ASCII bytes `\u003c`
after JSON string escaping. The final encoded UTF-8 JSON, including envelope and
escapes but excluding tags, is at most1,048,576 bytes. Exactly the limit passes;
one byte over is RENDER-502, never truncation. Malformed mapping/value is
RENDER-501 with route and island/field path. These are separate from111's
RENDER-104. State bytes also count toward107's final response-byte budget.

Core finds only `document.head.querySelector('script[type="application/json"][data-island-state]')`
once per Document (cached success or refusal in a WeakMap), never a subtree/body
fallback. Parse a strict version1 envelope with empty `s`, dense entries, `h` as
exact16 lowercase hex and `p` as a non-array object. Bound the encoded input
before JSON.parse, and use bounded iterative traversal/projection after parsing.
Always strip forbidden keys at every depth; copy declared values into fresh
per-instance objects so two occurrences never share mutable decoded data.

Before arming any trigger or running a component, scan the original Document
host set to establish occurrence claims, even when activation was requested for
a subtree; arm only the requested valid hosts afterward. Preflight requires: each occurrence is in range and uniquely claimed, root h equals entry h
equals compiled registration h, the registration schema validates its p, and
the component registration exists. Detect duplicate references before either
claimant can activate. Missing/malformed global state refuses all islands;
per-entry schema/hash failure leaves that island inert. No DOM write, status
attribute, marker removal, component invocation, effect or trigger installation
occurs on state/hash/schema refusal. Diagnostics and internal WeakMap state are
permitted. Later body blocks, inline `data-forma-props` and `__forma_islands`
are never read. The last two channels are removed, not fallback paths.

The private success result is conceptually
`ValidatedIsland { host, occurrence, registration, props }`, not a public bypass.
The compiler's private registration factory receives props before component
execution/createSignal. Each lexical SIGNAL ordinal creates its own getter/
setter pair; one prop can seed two independently mutable signals. For104,
associate a writable getter with its actual setter through compiler-known
signal identity/closure metadata. Never infer a setter from a prop name or shared
source slot.104 may consume a validated island only after state preflight; its
separate adoption transaction retains the stricter zero-write success rule.

## 7. Old evidence, paired checks and remaining review points

Before changing fixtures, copy the previous full corpus and byte/dump/HTML hashes
to a dated archive with source commit. Keep every existing release-evidence
report/archive immutable. The pre-contract islands become explicit old-dev
LOAD-105 refusal inputs; they no longer qualify successful new-reader rendering.
Non-island older modules retain their documented acceptance. Generate a new
contract-qualified corpus deliberately, and distinguish intentional state/head/
host-marker changes from unchanged visible content. Native checks run with
UPDATE_GOLDEN absent.

`FORMA-103-WIRE-VECTORS.json` contains six proposed exact byte vectors (empty,
two signals, repeated inputs, nested row mapping, empty-string fallback and
UTF-8 ordering without normalization). Python constructs the vectors and Node
independently agrees on hash/length/section boundaries in retained scratch
logs. These are spec vectors, not evidence that the current native reader
accepts the new grammar. The native dump/parser replay follows approval.

The paired checkpoint must cover exact bytes/hash for empty props and two
signals reading one optional prop; equal schemas with different source/global
ids; enum/name UTF-8 ordering; duplicate input slots; nested/renamed inputs;
list iteration and nested islands; all COALESCE ownership/type failures and
0/false/empty semantics; malformed lengths/tags/count boundaries; old-reader
required-section refusal; new-reader old-island refusal. These are fixed
functional regressions, not a new fuzz campaign. Actual SSR→browser checks add
the ticket's100 deterministic values/schema, all declaration disclosure tests,
zero MutationRecords on state refusal, strict-policy events and byte limits.

Review the explicit closed-constant table needed for empty-string defaults,
the closed binding-expression admission against fixtures, and the preserved
generic-number versus Rust-integer distinction in section6. These are concrete
grammar choices, not permission to omit bindings or silently weaken a test.
The spec can be amended before its reader/emitter checkpoint; no production
parser or opcode is changed here.
