/** Private compiler/state handshake. No DOM writes or component calls occur here. */
import type { IslandHydrateFn } from './activate.js';
import { AdoptionDomError } from './adoption-plan.js';
import type { ComponentDescription } from './adoption-description.js';

export type IslandSchemaType =
  | { readonly kind: 'boolean' | 'string' | 'number' | 'date' }
  | { readonly kind: 'enum'; readonly variants: readonly string[] }
  | { readonly kind: 'array'; readonly element: IslandSchemaType }
  | { readonly kind: 'optional'; readonly inner: IslandSchemaType }
  | { readonly kind: 'object'; readonly object: number };
export type IslandSchema = readonly (readonly { readonly name: string; readonly type: IslandSchemaType }[])[];
export interface IslandRegistrationMetadata {
  readonly h: string;
  readonly schema: IslandSchema;
  readonly mode: 0 | 1;
}
interface Registration extends IslandRegistrationMetadata {
  readonly hydrate: IslandHydrateFn;
  readonly component: (...args: never[]) => unknown;
}
export interface ValidatedIsland {
  readonly host: HTMLElement;
  readonly occurrence: number;
  readonly registration: Registration;
  readonly props: Record<string, unknown>;
}
export type IslandStateCode = 'FORMA_E_ISLAND_STATE' | 'FORMA_E_ISLAND_IDENTITY'
  | 'FORMA_E_ISLAND_REGISTRATION' | 'FORMA_E_ISLAND_SCHEMA';
export class IslandStateError extends Error {
  constructor(readonly code: IslandStateCode, detail: string) {
    super(`[forma] ${code}: ${detail}`);
    this.name = 'IslandStateError';
  }
}
export type IslandPreflight = { readonly host: HTMLElement; readonly value: ValidatedIsland }
  | { readonly host: HTMLElement; readonly error: IslandStateError };

const MAX_STATE_BYTES = 1_048_576;
const HASH = /^[0-9a-f]{16}$/;
const stateEncoder = /* @__PURE__ */ new TextEncoder();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const registrations = new WeakMap<(...args: never[]) => unknown, Registration>();
const registeredComponents = new WeakSet<(...args: never[]) => unknown>();
/** @internal Identity only; per-host checked registration retains all authority. */
export function isRegisteredIslandComponent(component:(...args:never[])=>unknown):boolean {
  return registeredComponents.has(component);
}
const own = (value: object, name: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, name);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function refuse(code: IslandStateCode, detail: string): never { throw new IslandStateError(code, detail); }

/**
 * @internal Compiler output only. Its metadata is copied before it is retained;
 * no caller can mint a ValidatedIsland or bypass document preflight.
 *
 * A future adoption transaction may receive actual getter/setter pairs through
 * a compiler-owned scope sink. This helper does not infer setters from props,
 * source slots or names, and never recreates captured/imported getters.
 */
export function __islandRegistration<P extends object>(
  component: (props: P) => unknown,
  metadata: IslandRegistrationMetadata,
): IslandHydrateFn {
  if (typeof component !== 'function' || !object(metadata) || typeof metadata.h !== 'string' || !HASH.test(metadata.h) || (metadata.mode !== 0 && metadata.mode !== 1)) {
    refuse('FORMA_E_ISLAND_REGISTRATION', 'invalid compiled island metadata');
  }
  const schema = copySchema(metadata.schema);
  const hydrate: IslandHydrateFn = (_host, props) => component(props as P);
  registrations.set(hydrate, { hydrate, component, h: metadata.h, schema, mode: metadata.mode });
  registeredComponents.add(component);
  return hydrate;
}

/** Copy a finite acyclic schema iteratively; all producer limits remain explicit. */
function copySchema(input: IslandSchema): IslandSchema {
  const fail = (): never => refuse('FORMA_E_ISLAND_REGISTRATION', 'invalid compiled props schema');
  if (!Array.isArray(input) || input.length < 1 || input.length > 1024) fail();
  const dependencies: number[][] = [], result: { name: string; type: IslandSchemaType }[][] = [];
  let bytes = 3; // schema version:u8 and object_count:u16
  const charge = (size: number): void => { bytes += size; if (bytes > MAX_STATE_BYTES) fail(); };
  const text = (value: string): void => {
    const size = schemaTextBytes(value);
    if (size < 0) fail();
    charge(2 + size);
  };
  for (const fields of input) {
    if (!Array.isArray(fields) || fields.length > 1024) fail();
    charge(2); // field_count:u16
    const names = new Set<string>(), edges: number[] = [], copy: { name: string; type: IslandSchemaType }[] = [];
    for (const field of fields) {
      if (!object(field) || typeof field.name !== 'string' || forbidden.has(field.name) || names.has(field.name)) fail();
      names.add(field.name); text(field.name);
      const wrappers: ('array' | 'optional')[] = [];
      let type = field.type;
      while (object(type) && (type.kind === 'array' || type.kind === 'optional')) {
        if (wrappers.length === 16) fail();
        wrappers.push(type.kind); charge(1);
        type = type.kind === 'array' ? type.element : type.inner;
      }
      if (!object(type)) fail();
      let leaf: IslandSchemaType;
      switch (type.kind) {
        case 'boolean': case 'string': case 'number': case 'date': charge(1); leaf = { kind: type.kind }; break;
        case 'enum': {
          if (!Array.isArray(type.variants) || !type.variants.length || type.variants.length > 1024
            || type.variants.some((item: unknown) => typeof item !== 'string') || new Set(type.variants).size !== type.variants.length) fail();
          charge(3); for (const variant of type.variants) text(variant);
          leaf = { kind: 'enum', variants: Object.freeze([...type.variants]) }; break;
        }
        case 'object':
          if (!Number.isInteger(type.object) || type.object < 0 || type.object >= input.length) fail();
          charge(3); edges.push(type.object); leaf = { kind: 'object', object: type.object }; break;
        default: fail();
      }
      for (let i = wrappers.length - 1; i >= 0; i--) {
        Object.freeze(leaf!);
        leaf = wrappers[i] === 'array' ? { kind: 'array', element: leaf! } : { kind: 'optional', inner: leaf! };
      }
      copy.push(Object.freeze({ name: field.name, type: Object.freeze(leaf!) }));
    }
    dependencies.push(edges); result.push(copy);
  }
  const colors = new Uint8Array(input.length);
  const stack = [{ id: 0, next: 0 }]; colors[0] = 1;
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    const edges = dependencies[frame.id]!;
    if (frame.next === edges.length) { colors[frame.id] = 2; stack.pop(); continue; }
    const child = edges[frame.next++]!;
    if (colors[child] === 1) fail();
    if (colors[child] === 0) { colors[child] = 1; stack.push({ id: child, next: 0 }); }
  }
  if (colors.some(color => color !== 2)) fail();
  return Object.freeze(result.map(fields => Object.freeze(fields)));
}

/** Count encoded bytes without allocating an unbounded TextEncoder result. */
function schemaTextBytes(text: string): number {
  if (text.length > 65535) return -1;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else {
      if (code >= 0xd800 && code <= 0xdfff) return -1;
      bytes += 3;
    }
    if (bytes > 65535) return -1;
  }
  return bytes;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => own(value, key));
}
interface Entry { h: string; p: Record<string, unknown> }
interface Claim { boundary: string | null; component: string | null; h: string | null; occurrence: number | null; duplicate: boolean }
interface DocumentState {
  entries: (Entry | null)[];
  claims: WeakMap<Element, Claim>;
  error?: IslandStateError;
}
const documents = new WeakMap<Document, DocumentState>();
interface IslandAuthority {
  readonly root: Document | HTMLElement;
  readonly document: Document;
  readonly state: DocumentState;
  active: boolean;
}
const validatedAuthorities = new WeakMap<ValidatedIsland, IslandAuthority>();

/** Experimental navigation authority. Never replaces the original Document snapshot. */
interface NavigationState extends IslandAuthority {
  readonly root: HTMLElement;
  readonly checked: readonly IslandPreflight[];
  phase: 'prepared' | 'active' | 'disposed';
}
const navigationRoots = new WeakSet<HTMLElement>();
const navigationHandles = new WeakMap<object, NavigationState>();
/** @internal Opaque proof handle; callers cannot mint validated island claims. */
export interface NavigationIslandState { readonly kind: 'forma-navigation-islands'; }

function occurrenceOf(text: string | null): number | null {
  if (text === null || !/^(0|[1-9][0-9]*)$/.test(text)) return null;
  const index = Number(text);
  return Number.isSafeInteger(index) ? index : null;
}
function readDocument(doc: Document): DocumentState {
  const cached = documents.get(doc);
  if (cached) return cached;
  const state: DocumentState = { entries: [], claims: new WeakMap() };
  // Retain even a refusal. Later head/body changes never replace its authority.
  documents.set(doc, state);
  const counts = new Map<number, Claim>();
  for (const host of doc.querySelectorAll<HTMLElement>('[data-forma-island]')) {
    const text = host.getAttribute('data-forma-state');
    const claim: Claim = { boundary: host.getAttribute('data-forma-island'), component: host.getAttribute('data-forma-component'), h: host.getAttribute('data-forma-h'), occurrence: occurrenceOf(text), duplicate: false };
    state.claims.set(host, claim);
    if (claim.occurrence !== null) {
      const previous = counts.get(claim.occurrence);
      if (previous) { claim.duplicate = true; previous.duplicate = true; }
      else counts.set(claim.occurrence, claim);
    }
  }
  try {
    const block = doc.head?.querySelector('script[type="application/json"][data-island-state]');
    if (!block) refuse('FORMA_E_ISLAND_STATE', 'missing first head state block');
    state.entries = readStateEntries(block.textContent ?? '');
  } catch (error) {
    state.error = error instanceof IslandStateError ? error : new IslandStateError('FORMA_E_ISLAND_STATE', 'cannot read state block');
  }
  return state;
}

function readStateEntries(text: string): (Entry | null)[] {
  // A UTF-16 code unit needs at least one encoded byte, so reject before
  // allocation when that lower bound exceeds the ceiling. encodeInto writes
  // only to this capped buffer and reports incomplete input on overflow.
  if (text.length > MAX_STATE_BYTES) refuse('FORMA_E_ISLAND_STATE', 'state block exceeds one MiB');
  const target = new Uint8Array(Math.min(MAX_STATE_BYTES, text.length * 3));
  if (stateEncoder.encodeInto(text, target).read !== text.length) {
    refuse('FORMA_E_ISLAND_STATE', 'state block exceeds one MiB');
  }
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { refuse('FORMA_E_ISLAND_STATE', 'invalid state JSON'); }
  if (!object(envelope) || !exactKeys(envelope, ['v', 's', 'i']) || envelope.v !== 1
    || !Array.isArray(envelope.s) || envelope.s.length !== 0 || !Array.isArray(envelope.i)) {
    refuse('FORMA_E_ISLAND_STATE', 'invalid v1 state envelope');
  }
  // The capped decoded JSON stays private. A null sentinel avoids allocating
  // an Error and stack for each malformed entry; only requested hosts need
  // diagnostics, and valid siblings remain independently eligible.
  return envelope.i.map((entry: unknown) => object(entry) && exactKeys(entry, ['h', 'p'])
    && typeof entry.h === 'string' && HASH.test(entry.h) && object(entry.p)
    ? entry as unknown as Entry : null);
}

/** Bounded iterative projection. Only schema fields can enter the fresh output. */
function project(input: Record<string, unknown>, schema: IslandSchema): Record<string, unknown> {
  type Destination = Record<string, unknown> | unknown[];
  type Work = { kind: 'value'; value: unknown; type: IslandSchemaType; out: Destination; key: string | number }
    | { kind: 'object'; value: Record<string, unknown>; fields: IslandSchema[number]; out: Record<string, unknown>; index: number }
    | { kind: 'array'; value: unknown[]; type: IslandSchemaType; out: unknown[]; index: number };
  const output: Record<string, unknown> = Object.create(null);
  const pending: Work[] = [{ kind: 'object', value: input, fields: schema[0]!, out: output, index: 0 }];
  let count = 0;
  const fail = (): never => refuse('FORMA_E_ISLAND_SCHEMA', 'state does not match the declared props schema');
  while (pending.length) {
    const work = pending.pop()!;
    if (work.kind === 'object') {
      if (work.index === work.fields.length) continue;
      const field = work.fields[work.index++]!;
      pending.push(work);
      // Declared forbidden keys are refused at registration; undeclared keys,
      // including every nested pollution key, are never copied or traversed.
      const value = own(work.value, field.name) ? work.value[field.name] : undefined;
      if ((value === null || value === undefined) && field.type.kind === 'optional') continue;
      pending.push({ kind: 'value', value, type: field.type, out: work.out, key: field.name });
      continue;
    }
    if (work.kind === 'array') {
      if (work.index === work.value.length) continue;
      const index = work.index++;
      pending.push(work, { kind: 'value', value: work.value[index], type: work.type, out: work.out, key: index });
      continue;
    }
    if (++count > MAX_STATE_BYTES) fail();
    let { type } = work;
    while (type.kind === 'optional' && work.value !== null) type = type.inner;
    let value: unknown = work.value;
    switch (type.kind) {
      case 'optional': value = null; break;
      case 'boolean': case 'string': if (typeof value !== type.kind) fail(); break;
      case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail(); break;
      case 'date':
        if (typeof work.value !== 'number' || !Number.isInteger(work.value) || Math.abs(work.value) > 8.64e15) return fail();
        value = new Date(work.value); break;
      case 'enum': if (typeof value !== 'string' || !type.variants.includes(value)) fail(); break;
      case 'object': {
        if (!object(work.value)) return fail();
        const out: Record<string, unknown> = Object.create(null);
        value = out; pending.push({ kind: 'object', value: work.value, fields: schema[type.object]!, out, index: 0 }); break;
      }
      case 'array': {
        if (!Array.isArray(work.value)) return fail();
        const out: unknown[] = [];
        value = out;
        const kind = type.element.kind;
        if (kind === 'string' || kind === 'boolean' || kind === 'number') {
          // These immutable leaves need no nested work frame. Keep the same
          // per-value budget and type checks while copying into a fresh array.
          out.length = work.value.length;
          for (let i = 0; i < work.value.length; i++) {
            const item = work.value[i];
            if (++count > MAX_STATE_BYTES || typeof item !== kind
              || (kind === 'number' && !Number.isFinite(item))) fail();
            out[i] = item;
          }
        } else pending.push({ kind: 'array', value: work.value, type: type.element, out, index: 0 });
        break;
      }
    }
    (work.out as Record<string | number, unknown>)[work.key] = value;
  }
  return output;
}
function originalClaim(host: HTMLElement, state: DocumentState): Claim {
  const claim = state.claims.get(host);
  if (!claim || claim.duplicate || claim.occurrence === null
    || host.getAttribute('data-forma-island') !== claim.boundary
    || host.getAttribute('data-forma-state') !== String(claim.occurrence)
    || host.getAttribute('data-forma-component') !== claim.component
    || host.getAttribute('data-forma-h') !== claim.h) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island does not match its original document claim');
  }
  return claim;
}
/** Recheck at the moment a deferred component would execute. Still no DOM write. */
export function checkIslandClaim(value: ValidatedIsland): void {
  const authority = validatedAuthorities.get(value);
  // Containment also proves ownerDocument: DOM adoption moves an entire subtree.
  if (!authority?.active || !authority.document.contains(authority.root) || !authority.root.contains(value.host)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island is outside its validated document');
  }
  const claim = originalClaim(value.host, authority.state);
  if (claim.occurrence !== value.occurrence || claim.h !== value.registration.h) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island identity changed before activation');
  }
}

function validateHost(registry: Record<string, (...args: never[]) => unknown>, host: HTMLElement, state: DocumentState): ValidatedIsland {
  const claim = originalClaim(host, state);
  const entry = state.entries[claim.occurrence!];
  if (entry === undefined) refuse('FORMA_E_ISLAND_IDENTITY', 'state occurrence is out of range');
  if (entry === null) refuse('FORMA_E_ISLAND_STATE', 'invalid state entry');
  if (!claim.component || !own(registry, claim.component)) refuse('FORMA_E_ISLAND_REGISTRATION', 'missing own compiled registration');
  const hydrate = registry[claim.component]!;
  const registration = registrations.get(hydrate);
  if (!registration) refuse('FORMA_E_ISLAND_REGISTRATION', 'SSR registration has no compiled contract');
  if (claim.h !== entry.h || claim.h !== registration.h) refuse('FORMA_E_ISLAND_IDENTITY', 'root, state and compiled digests differ');
  const props = project(entry.p, registration.schema);
  return { host, occurrence: claim.occurrence!, registration, props };
}

/** Validate the whole requested set before any caller may arm a trigger. */
export function preflightIslands(registry: Record<string, (...args: never[]) => unknown>, root: ParentNode): IslandPreflight[] {
  const doc = (root as Node).nodeType === 9 ? root as Document : (root as Node).ownerDocument;
  if (!doc) return [];
  const state = readDocument(doc);
  const authority: IslandAuthority = { root: doc, document: doc, state, active: true };
  const results: IslandPreflight[] = [];
  for (const host of root.querySelectorAll<HTMLElement>('[data-forma-island]')) {
    try {
      if (state.error) throw state.error;
      const value = validateHost(registry, host, state);
      validatedAuthorities.set(value, authority);
      results.push({ host, value });
    } catch (error) {
      results.push({ host, error: error instanceof IslandStateError ? error : new IslandStateError('FORMA_E_ISLAND_STATE', 'cannot validate island state') });
    }
  }
  return results;
}

/**
 * @internal Experimental FORMA-301 feasibility boundary, not a supported public
 * transport. The caller must first validate response app/build/policy and import
 * inert markup into the destination document. Root must be a detached non-island
 * wrapper owned by that document. No component executes and no DOM write occurs.
 *
 * Unlike initial Document preflight, an invalid navigation candidate fails as a
 * unit before the router can replace the committed view. A handle is single-use.
 */
export function prepareNavigationIslandState(
  registry: Record<string, (...args: never[]) => unknown>, root: HTMLElement,
  stateJson: string, document: Document = root.ownerDocument,
): NavigationIslandState {
  if (root.ownerDocument !== document || root.isConnected || document.contains(root)
    || root.hasAttribute('data-forma-island') || navigationRoots.has(root)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation requires a fresh detached route wrapper');
  }
  const state: DocumentState = { entries: readStateEntries(stateJson), claims: new WeakMap() };
  const hosts = Array.from(root.querySelectorAll<HTMLElement>('[data-forma-island]'));
  if (hosts.length > 1024) refuse('FORMA_E_ISLAND_STATE', 'navigation exceeds 1024 islands');
  const occurrences = new Set<number>();
  for (const host of hosts) {
    const occurrence = occurrenceOf(host.getAttribute('data-forma-state'));
    if (occurrence === null || occurrences.has(occurrence)) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'invalid or duplicate navigation occurrence');
    }
    occurrences.add(occurrence);
    state.claims.set(host, {
      boundary: host.getAttribute('data-forma-island'), component: host.getAttribute('data-forma-component'),
      h: host.getAttribute('data-forma-h'), occurrence, duplicate: false,
    });
  }
  const checked = hosts.map(host => {
    const value = validateHost(registry, host, state);
    if (value.registration.mode !== 0) {
      refuse('FORMA_E_ISLAND_REGISTRATION', 'native navigation requires adopting registrations');
    }
    return { host, value };
  });
  const scope: NavigationState = { root, document, state, checked, phase: 'prepared', active: false };
  const handle: NavigationIslandState = Object.freeze({ kind: 'forma-navigation-islands' });
  for (const result of checked) validatedAuthorities.set(result.value, scope);
  navigationRoots.add(root);
  navigationHandles.set(handle, scope);
  return handle;
}

/** @internal Admission of the exact prepared subtree, once the router inserts it. */
export function activateNavigationIslandState(handle: NavigationIslandState): readonly IslandPreflight[] {
  const scope = navigationHandles.get(handle);
  if (!scope || scope.phase !== 'prepared' || scope.root.ownerDocument !== scope.document
    || !scope.document.contains(scope.root)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation scope cannot activate');
  }
  const hosts = scope.root.querySelectorAll<HTMLElement>('[data-forma-island]');
  if (hosts.length !== scope.checked.length || scope.checked.some((result, index) => hosts[index] !== result.host)) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'navigation host set changed after preparation');
  }
  // Validate all claims before changing the scope to active or arming any work.
  for (const result of scope.checked) {
    const claim = originalClaim(result.host, scope.state);
    if ('value' in result && (claim.occurrence !== result.value.occurrence || claim.h !== result.value.registration.h)) {
      refuse('FORMA_E_ISLAND_IDENTITY', 'navigation claim changed after preparation');
    }
  }
  scope.phase = 'active'; scope.active = true;
  return scope.checked;
}

/** @internal Revoke first, then let the caller dispose every captured host. */
export function revokeNavigationIslandState(handle: NavigationIslandState): readonly HTMLElement[] {
  const scope = navigationHandles.get(handle);
  if (!scope || scope.phase === 'disposed') return [];
  scope.phase = 'disposed'; scope.active = false;
  return scope.checked.map(result => result.host);
}

function mismatch(): never { throw new AdoptionDomError('FORMA_E_HYDRATE_VALUE'); }
function data(value: object, key: string | number, required = false): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field) { if (required) mismatch(); return undefined; }
  if (!('value' in field)) mismatch();
  return field.value;
}

/**
 * Declared data only: do not invoke accessors, inspect extras or stringify.
 * The admitted compiler grammar supplies plain data and decoded Dates. This
 * is not a trap-free inspector for arbitrary hand-written Proxy arguments;
 * JavaScript descriptor reflection itself may invoke a Proxy trap.
 */
function sameProps(input: unknown, expected: Record<string, unknown>, schema: IslandSchema): void {
  type Work = { kind: 'value'; left: unknown; right: unknown; type: IslandSchemaType }
    | { kind: 'object'; left: Record<string, unknown>; right: Record<string, unknown>; fields: IslandSchema[number]; index: number }
    | { kind: 'array'; left: unknown[]; right: unknown[]; type: IslandSchemaType; length: number; index: number };
  if (input === null || input === undefined) input = Object.create(null);
  if (!object(input)) mismatch();
  const pending: Work[] = [{ kind: 'object', left: input, right: expected, fields: schema[0]!, index: 0 }];
  let count = 0;
  while (pending.length) {
    const work = pending.pop()!;
    if (work.kind === 'object') {
      if (work.index === work.fields.length) continue;
      const field = work.fields[work.index++]!;
      pending.push(work, { kind: 'value', left: data(work.left, field.name), right: data(work.right, field.name), type: field.type });
      continue;
    }
    if (work.kind === 'array') {
      if (work.index === work.length) continue;
      const index = work.index++;
      pending.push(work, { kind: 'value', left: data(work.left, index, true), right: data(work.right, index, true), type: work.type });
      continue;
    }
    if (++count > MAX_STATE_BYTES) mismatch();
    let { type } = work;
    const { left, right } = work;
    if (type.kind === 'optional' && (left === null || left === undefined) && (right === null || right === undefined)) continue;
    while (type.kind === 'optional') type = type.inner;
    switch (type.kind) {
      case 'object':
        if (!object(left) || !object(right)) mismatch();
        pending.push({ kind: 'object', left, right, fields: schema[type.object]!, index: 0 }); break;
      case 'array': {
        if (!Array.isArray(left) || !Array.isArray(right)) mismatch();
        const length = data(right, 'length') as number;
        if (data(left, 'length') !== length) mismatch();
        pending.push({ kind: 'array', left, right, type: type.element, length, index: 0 }); break;
      }
      case 'date': {
        // Calling the intrinsic bypasses arbitrary instance getTime overrides.
        let epoch: number;
        try { epoch = Date.prototype.getTime.call(left); }
        catch { mismatch(); }
        if (!Number.isFinite(epoch!) || epoch! !== right) mismatch();
        break;
      }
      default: if (left !== right) mismatch();
    }
  }
}

/**
 * Private planner match against the exact host's original state. Components may
 * mutate handed-out props, including Date internals; the original envelope is
 * retained privately and is never exposed to this caller or any component.
 */
export function matchAdoptionChild(host: Element, description: ComponentDescription, value: ValidatedIsland): void {
  checkIslandClaim(value);
  if (value.host !== host || description.component !== value.registration.component || description.args.length > 1) {
    throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
  }
  const entry = validatedAuthorities.get(value)!.state.entries[value.occurrence];
  if (!entry) refuse('FORMA_E_ISLAND_STATE', 'original child state is unavailable');
  sameProps(description.args[0], entry.p, value.registration.schema);
}
