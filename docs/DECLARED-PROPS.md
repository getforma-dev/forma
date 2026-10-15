# Declared page props (3.0.0 staging)

A page declares its data in TypeScript. A Rust handler derives the same contract and binds it before the application opens its listener. The renderer accepts that verified handle and checked request values; application code does not search or fill slot names.

```ts
import { h, createSignal, createList } from '@getforma/core';
type Props = { title: string; rows: { id: number; label: string }[]; flash?: string };
export function Home(props: Props) {
  const [title] = createSignal(props.title);
  return h('main', null, title(), props.flash,
    createList(() => props.rows, row => row.id, row => h('p', null, row.label)),
    createList(() => props.rows, row => row.id, row => h('b', null, row.id)));
}
```

```rust,ignore
use forma_ir::PageProps;
use forma_server::{assets, load_ir_modules, RenderCtx};
#[derive(PageProps)]
struct Row { id: u64, label: String }
#[derive(PageProps)]
struct HomeProps { title: String, rows: Vec<Row>, flash: Option<String> }
let manifest = assets::try_load_manifest::<Assets>()?;
let pages = load_ir_modules::<Assets>(&manifest)?;
let home = pages.bind::<HomeProps>("home")?;
pages.finalize()?;
// Only after finalization succeeds should application startup open a port.
let response = home.render(&props, &RenderCtx::new().with_title("This request").with_body_class("home"))?;
```

`bind` accepts an exact route pattern or the manifest's logical `<page>.ir` alias. An alias used by multiple routes is ambiguous; bind each exact route. Unknown and explicit browser-only routes refuse SSR binding. The title defaults to the supplied page name and can be overridden per request. Existing typed head links, preloads and policy extensions remain on `RenderCtx`; the handle exposes no raw script or HTML string fields.

The closed type set is bool/boolean, string, finite number, signed epoch-millisecond Date/SystemTime, exact string-literal enum sets/unit enums, arrays/Vec, optional/null/Option and nested named structs/objects. Rust names default to snake_case→camelCase; `#[props(rename = "wireName")]` overrides a field or enum variant. Relative TypeScript aliases, imported interfaces and named re-exports resolve before JSX lowering; diagnostics retain declaration positions.

Every TypeScript field must exist in Rust metadata, including optional fields. `Option<T>` cannot satisfy required `T`; required Rust `T` can satisfy optional TypeScript `T`. A present `None` omits an object field; inside arrays it retains a null position. Extra Rust fields warn at bind and are omitted from the value projection, including unsafe values in those unused fields. This explicit DR-3/comparer-table rule takes precedence over shorthand that all additions/removals fail. Comparison uses names and enum sets, so declaration order does not define compatibility.

Integers must fit ±(2^53−1) before conversion. Floats must be finite. Dates truncate sub-millisecond precision toward zero and must remain within JavaScript's ±8.64e15 millisecond Date range; ordinary `SystemTime::now()` is supported. Each request checks values and reports the route, declared path (including array indices) and available source positions before any response is returned.

Direct nested fields, renamed child props, declared prop-seeded signals, `createShow`, direct/reactive ternaries and `createList` use the existing root slots and PROP instructions. Repeated lists share one declared array input and own separate row temporaries. Local signals and scratch slots are CLIENT-owned and are never handler-filled. Boolean text children are omitted like core's `h()`; direct object/array/Date text or attributes, runtime coercion and other computed declared expressions refuse BUILD-610. Pass a computed presentation value as a declared scalar. Unsupported schemas and binding expressions fail even without `--strict`; no placeholder output substitutes for declared data.

A handle is cloneable and Send+Sync and compares the contract once. In development, corrupt/missing module writes retain the last good module and its matching asset manifest. A valid new schema is bound again; incompatibility returns RENDER-405 until the handler/page is corrected. Release builds use immutable embedded modules. Finalization verifies every SSR route, seals binding and freezes the route topology; low-level `try_render` and the tuple loader have been removed. FORMA-103 owns browser state decoding/activation: two independently mutable signals seeded from one prop must keep separate activation identities even though SSR reads one server value.

## Evidence and preserved consumers

The fixture in `packages/compiler/tests/fixtures/props-contract` is emitted by `scripts/emit-props-contract.mjs` and consumed by `crates/forma-server/tests/typed_pages.rs` through the real parser, derive, bind, native walker and document renderer. `npm run check` verifies those bytes against this compiler. The no-parameter and typed-empty fixtures prove local empty lists need no handler keys. Rust's dedicated comparer/value and compile-refusal tests cover the closed/refused type matrix and source positions.

Read-only inventory used preserved clones under `work/review-FORMA-126-lint/consumers`, never application worktrees. These are shape references, not a claim that applications already build against3.0.0:

| Pinned source | Inspected data and fixture coverage |
|---|---|
| ksx `0cb57e2c5a0ae2d8c0f43f9fadd41f0ecdb62399`, CheckPage/CheckIsland, `snapshot.rs:28`, `render_check.rs` | Nested mapper/session objects, display strings, bool conditions and row arrays → nested `user`, rows and scalar fields. |
| same ksx, PadsPage/PadsIsland, `snapshot.rs:51`, `render_pads.rs` | Nested pads/session, `confirm`, optional unavailable/flash and six local list families → bool, optional fields, declared array plus separate local defaults. |
| same ksx, DevicesPage/DevicesIsland, `snapshot.rs:86`, `render_devices.rs` | Scan/residue/session nesting, error strings and optional flash → nested objects and nullable/optional controls. |
| same ksx, NocturnePage/NocturneIsland, `snapshot.rs:1527`, `render_nocturne.rs:35` | Optional nested settings, arrays and explicit `list:nGameRows#2:array` duplication → two real list views filled by one `rows` prop. |
| fAuth/GateWASM `b750ca534ae89066714f100eb2b76ee71edf1ab1`, `handlers/onboarding.rs` get-started/login renders | Three scanned OAuth bool slots and optional provider/client config → declared boolean and optional scalar shape. |
| same fAuth, `handlers/benchmark.rs:103`, platform benchmark store | Defaults-only slot population, numeric IDs/scores, row objects, nullable error and sort/search strings → finite numbers, array objects and nullable fields. |
| same fAuth, platform login app's five islands: AuthCard, MfaPanel, InviteBanner, LoginCardHead, OnboardingCta | Shared bool/string/null state, optional nested MFA setup and invite data → nested optional shape; DOM refs, promises, callbacks and browser actions stay local, outside PageProps. |
| same fAuth, RegistrationForm; BenchmarkFilterBar, BenchmarkDataTable, PerfPanel | Nine registered islands total across login/onboarding/benchmark; local controls, shared dataset and derived filtering → local-state isolation and shared declared dataset. Application-specific filtering moves to a declared rendered value or later compiler work, not ad hoc slot injection. |

Application migration remains in its assigned follow-up tickets. Fixture expansion is FORMA-188; row-key policy is106; browser activation is103. No live application repository was changed.

## Startup completion and document extensions

After all `pages.bind`/`bind_with` calls, call `pages.finalize()` before opening the listener. Unbound SSR routes fail startup; Browser routes need no typed binding. Handles refuse rendering until finalization succeeds. Failed finalization permits binding the missing routes and retrying; success seals registration. `bind_with` sets page limits and RenderCtx inherits them unless explicitly overridden.

The final handle preserves request JSON, branding CSS and explicit RawHtml through `with_config_json`, `with_personality_css` and `with_body_prefix`. It accepts no raw script or nonce. The legacy try_render/tuple loader/SSR PageConfig fields are removed. Walker timing excludes props conversion and document assembly; measure complete requests separately.
