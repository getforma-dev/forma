/** Private compiler/state handshake. No DOM writes or component calls occur here. */
import type { IslandHydrateFn } from './activate.js';

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
interface Registration extends IslandRegistrationMetadata { readonly hydrate: IslandHydrateFn }
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
const stateEncoder = new TextEncoder();
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const registrations = new WeakMap<IslandHydrateFn, Registration>();
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
  registrations.set(hydrate, { hydrate, h: metadata.h, schema, mode: metadata.mode });
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
interface Claim { component: string | null; h: string | null; occurrence: number | null; duplicate: boolean }
interface DocumentState {
  entries: (Entry | null)[];
  claims: WeakMap<Element, Claim>;
  error?: IslandStateError;
}
const documents = new WeakMap<Document, DocumentState>();
const validatedDocuments = new WeakMap<ValidatedIsland, Document>();
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
    const claim: Claim = { component: host.getAttribute('data-forma-component'), h: host.getAttribute('data-forma-h'), occurrence: occurrenceOf(text), duplicate: false };
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
    const text = block.textContent ?? '';
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
    state.entries = envelope.i.map((entry: unknown) => object(entry) && exactKeys(entry, ['h', 'p'])
      && typeof entry.h === 'string' && HASH.test(entry.h) && object(entry.p)
      ? entry as unknown as Entry : null);
  } catch (error) {
    state.error = error instanceof IslandStateError ? error : new IslandStateError('FORMA_E_ISLAND_STATE', 'cannot read state block');
  }
  return state;
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
        value = out; pending.push({ kind: 'array', value: work.value, type: type.element, out, index: 0 }); break;
      }
    }
    (work.out as Record<string | number, unknown>)[work.key] = value;
  }
  return output;
}
function originalClaim(host: HTMLElement, state: DocumentState): Claim {
  const claim = state.claims.get(host);
  if (!claim || claim.duplicate || claim.occurrence === null
    || host.getAttribute('data-forma-state') !== String(claim.occurrence)
    || host.getAttribute('data-forma-component') !== claim.component
    || host.getAttribute('data-forma-h') !== claim.h) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island does not match its original document claim');
  }
  return claim;
}
/** Recheck at the moment a deferred component would execute. Still no DOM write. */
export function checkIslandClaim(value: ValidatedIsland): void {
  const document = validatedDocuments.get(value);
  if (!document || value.host.ownerDocument !== document) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island validation belongs to a different document');
  }
  const state = readDocument(document);
  const claim = originalClaim(value.host, state);
  if (claim.occurrence !== value.occurrence || claim.h !== value.registration.h) {
    refuse('FORMA_E_ISLAND_IDENTITY', 'island identity changed before activation');
  }
}

/** Validate the whole requested set before any caller may arm a trigger. */
export function preflightIslands(registry: Record<string, IslandHydrateFn>, root: ParentNode): IslandPreflight[] {
  const doc = (root as Node).nodeType === 9 ? root as Document : (root as Node).ownerDocument;
  if (!doc) return [];
  const state = readDocument(doc);
  const results: IslandPreflight[] = [];
  for (const host of root.querySelectorAll<HTMLElement>('[data-forma-island]')) {
    try {
      if (state.error) throw state.error;
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
      const value: ValidatedIsland = { host, occurrence: claim.occurrence!, registration, props };
      validatedDocuments.set(value, doc);
      results.push({ host, value });
    } catch (error) {
      results.push({ host, error: error instanceof IslandStateError ? error : new IslandStateError('FORMA_E_ISLAND_STATE', 'cannot validate island state') });
    }
  }
  return results;
}
