# Compiled island state

This internal contract implements section 6 of
[the reviewed wire specification](../../../docs/proposals/FORMA-103-STATE-WIRE.md).
`activateIslands` validates every requested host before scheduling a trigger or
running a component. Immediately before execution, including deferred execution,
it rechecks the frozen claim. A refusal leaves host markup and status unchanged.

The compiler emits `__islandRegistration(component, { h, schema, mode })` from
`@getforma/core`. It is a compiler helper, not an application escape hatch.
`h` is the 16-character lowercase digest, `schema` is the canonical root-first
array of object-field arrays, and `mode` is 0 for SSR or 1 for `browserOnly`.
The wrapper receives the projected props and calls the component with that one
argument. Existing lexical and imported getter identities are preserved.
The schema is validated, copied and frozen at registration; metadata is held in
a private WeakMap. A bare SSR callback has no compiled contract and is refused.

The private decoder reads only the first matching application/json state block
in the document head. It caches success or refusal once per Document, bounds
UTF-8 bytes before JSON.parse, requires the exact v1 envelope, and isolates
malformed entries. It snapshots all original document hosts before checking a
requested subtree, so duplicate occurrence claims cannot win through scheduling
order. Added hosts cannot acquire claims; changed markers and hosts moved to
another document are refused immediately before activation.

Projection is iterative and copies declared fields into fresh per-occurrence
objects, arrays and Dates. Forbidden and undeclared keys never enter the result.
Optional null object fields are omitted; optional array positions retain null.
No component, trigger, effect, status attribute or other DOM write occurs in
preflight. Its success result is private and weakly branded; copying its shape
does not produce a valid activation capability.

`FORMA_E_ISLAND_STATE` identifies envelope or entry refusal;
`FORMA_E_ISLAND_IDENTITY` identifies occurrence or digest refusal;
`FORMA_E_ISLAND_REGISTRATION` identifies missing or invalid compiled metadata;
`FORMA_E_ISLAND_SCHEMA` identifies a value outside the declared schema.

Browser-shell routes mount through their browser entry without SSR preflight.
Future adoption work may receive actual getter/setter pairs from a compiler-owned
scope sink. This decoder does not infer setters from prop names or source slots,
and does not implement that separate adoption transaction.

The fixed controls are in `src/dom/__tests__/island-state.test.ts`. They include
100 values for each supported schema kind, numeric/text boundary values, exact
UTF-8 byte limits, forbidden-key projection, per-entry isolation, frozen claims,
and zero DOM mutations. Activation controls are in `src/dom/__tests__/island-state-activation.test.ts`.
Browser timing and the complete compiler/build/browser acceptance remain separate
integration gates; these unit results do not claim either one.
