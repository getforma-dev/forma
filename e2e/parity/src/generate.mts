/**
 * Generated states for the parity harness (FORMA-183, DR-9; e2e/parity/README.md, 'Generated states').
 *
 * A generated state is one value assignment for a declared props schema (FMIR v3 section 0x0005,
 * FORMA-102's closed set), drawn deterministically from a seed, an index and the schema alone:
 * the same three inputs give the same bytes on any platform. Each leaf type has an ordered edge
 * list, and each field a rotation into it: its rank among the same-typed fields of the schema, in
 * schema order (the first string field 0, the second 1, ...). State `i` takes edge
 * `(i + rank) mod edges.length`. So the first `edges.length` states of a field visit every edge of
 * its type once, two same-typed fields hold different edges in every one of those states (a value
 * routed into the wrong slot cannot pass), and the first fields still meet the ticket's priority
 * edges (empty, long, `</script>`, NUL, CRLF) within ten states, which a hash of the path would
 * scatter across the whole list. After the list, a coin decides
 * between an edge and a random draw. The string domain includes every `input` of the shared rule-1 vectors
 * (crates/forma-ir/tests/fixtures/parity/normalization.json), so a vector added there joins the
 * generator without a code change.
 *
 * Output is the wire's own JSON: an absent optional object field is omitted, an absent optional
 * array element is `null`, a date is epoch milliseconds. The server's typed API and the browser's
 * decoded props both read exactly this.
 */
import { readFileSync } from 'node:fs';

export type SchemaType =
  | { readonly kind: 'boolean' | 'string' | 'number' | 'date' }
  | { readonly kind: 'enum'; readonly variants: readonly string[] }
  | { readonly kind: 'array'; readonly element: SchemaType }
  | { readonly kind: 'optional'; readonly inner: SchemaType }
  | { readonly kind: 'object'; readonly object: number };
export interface SchemaField { readonly name: string; readonly type: SchemaType }
/** Object 0 is the page's (or the island's) props type. The compiler's `PropsSchema` and core's `IslandSchema` both have this shape. */
export type Schema = readonly (readonly SchemaField[])[];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------
// The PRNG: splitmix32 seeded by FNV-1a over "<seed>:<module>:<index>:<path>"
// ---------------------------------------------------------------------------

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  /** The next uint32. */
  next(): number;
  /** A float in [0, 1). */
  float(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** An independent stream for a labelled sub-draw (a field, an element). */
  fork(label: string): Rng;
}

export function splitmix32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  const rng: Rng = {
    next,
    float: () => next() / 0x100000000,
    int: n => (n <= 0 ? 0 : next() % n),
    fork: label => splitmix32(fnv1a(`${seed}/${label}`)),
  };
  return rng;
}

// ---------------------------------------------------------------------------
// Edge lists (the ticket's list and the shared vectors)
// ---------------------------------------------------------------------------

const VECTORS_URL = new URL('../../../crates/forma-ir/tests/fixtures/parity/normalization.json', import.meta.url);

/** Every `values[*].input` of the shared rule-1 vector file, in file order. Missing file: a hard failure (TESTING.md P7). */
export function sharedVectorInputs(): readonly string[] {
  const file = JSON.parse(readFileSync(VECTORS_URL, 'utf8')) as { values: { id: string; input: string }[] };
  if (!Array.isArray(file.values) || file.values.length === 0) throw new Error(`${VECTORS_URL.pathname}: no values`);
  return file.values.map(value => value.input);
}

const LONG_STRING = Array.from({ length: 2048 }, (_, i) => String.fromCodePoint(0x61 + (i % 26))).join('');

/** The ticket's string edges, then the shared vectors as the scalar domain, each once. */
export const STRING_EDGES: readonly string[] = [...new Set([
  '',
  'a',
  LONG_STRING,
  '</script>',
  '<!--f:t0-->',
  '&<>"\'',
  '\0',
  '\r\n',
  '\r',
  '\nleading line feed',
  '😀',
  'é',
  '​',
  'null',
  'true',
  '0',
  ' ',
  ...sharedVectorInputs(),
])];

/**
 * `-0` is not an edge: every path the harness drives carries numbers as JSON (`JSON.stringify`
 * writes `-0` as `0`, and the island-state envelope canonicalizes it to `0`), so it would arrive as
 * `0` on both sides and test nothing. Rule 2's own vectors (FORMA-182) cover `-0` where it can occur.
 */
export const NUMBER_EDGES: readonly number[] = [
  0,
  1,
  -1,
  2 ** 53 - 1,
  -(2 ** 53 - 1),
  2 ** 53,
  1e21,
  1e-7,
  0.1,
  1.5,
  -2.5,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  123456789.123,
];

export const BOOLEAN_EDGES: readonly boolean[] = [true, false];

/** Epoch milliseconds; the JavaScript Date range is ±8.64e15. */
export const DATE_EDGES: readonly number[] = [0, -1, 1, 8.64e15, -8.64e15, 1_792_000_000_000];

export const ARRAY_LENGTH_EDGES: readonly number[] = [0, 1, 2, 3, 32];

/** Values the typed API must refuse (not parity cases: the typed path's refusal table, FORMA-183's second slice). */
export const REFUSALS: readonly { readonly type: SchemaType['kind']; readonly value: number; readonly code: string }[] = [
  { type: 'number', value: Number.NaN, code: 'RENDER-402' },
  { type: 'number', value: Number.POSITIVE_INFINITY, code: 'RENDER-402' },
  { type: 'number', value: Number.NEGATIVE_INFINITY, code: 'RENDER-402' },
  { type: 'date', value: 8.64e15 + 1, code: 'RENDER-403' },
  { type: 'date', value: -8.64e15 - 1, code: 'RENDER-403' },
];

// ---------------------------------------------------------------------------
// Random draws, for states past the edge lists
// ---------------------------------------------------------------------------

const ALPHABET = ['a', 'b', 'z', 'A', ' ', '0', '9', '<', '>', '&', '"', "'", '/', '\\', 'é', 'ß', '中', '😀', '‍', '\n'];

function randomString(rng: Rng): string {
  const length = rng.int(17);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[rng.int(ALPHABET.length)];
  return out;
}

function randomNumber(rng: Rng): number {
  switch (rng.int(4)) {
    case 0: return rng.int(1000);
    case 1: return -rng.int(1000);
    case 2: return (rng.next() - 0x80000000) / 1024;
    default: return rng.float() * 10 ** rng.int(12);
  }
}

function randomDate(rng: Rng): number {
  const magnitude = rng.float() * 8.64e15;
  return Math.trunc(rng.int(2) === 0 ? magnitude : -magnitude);
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/** Edge `(index + offset) mod n` first; past the list, a coin between an edge and a random draw. */
function pick<T>(edges: readonly T[], index: number, offset: number, rng: Rng, random: () => T): T {
  if (index < edges.length) return edges[(index + offset) % edges.length]!;
  return rng.int(2) === 0 ? edges[rng.int(edges.length)]! : random();
}

/**
 * Each field's rotation into its edge list, keyed by the field's path pattern in the schema
 * (`rows[].id`; `a?` for an optional's presence, `a#length` for an array's length). Derived from
 * the schema alone, never from a state, so a field keeps its rotation in every state (an absent
 * optional or a shorter array never shifts another field's). The offset is the field's rank among
 * the fields of its family (string, number, boolean, date, one enum's literal set, optional
 * presence, array length) in schema order, modulo the list's length.
 */
type Offsets = ReadonlyMap<string, number>;
const offsetCache = new WeakMap<Schema, Offsets>();

export function fieldOffsets(schema: Schema): Offsets {
  const cached = offsetCache.get(schema);
  if (cached) return cached;
  const offsets = new Map<string, number>();
  const ranks = new Map<string, number>();
  const assign = (family: string, size: number, key: string): void => {
    if (size === 0 || offsets.has(key)) return;
    const rank = ranks.get(family) ?? 0;
    ranks.set(family, rank + 1);
    offsets.set(key, rank % size);
  };
  const visit = (type: SchemaType, key: string, active: number[]): void => {
    switch (type.kind) {
      case 'string': case 'number': case 'boolean': case 'date': assign(type.kind, edgesOf(type.kind).length, key); return;
      case 'enum': assign(`enum:${JSON.stringify(type.variants)}`, type.variants.length, key); return;
      case 'optional': assign('optional', 2, `${key}?`); visit(type.inner, key, active); return;
      case 'array': assign('array', ARRAY_LENGTH_EDGES.length, `${key}#length`); visit(type.element, `${key}[]`, active); return;
      case 'object': visitObject(type.object, key, active); return;
    }
  };
  const visitObject = (id: number, key: string, active: number[]): void => {
    const fields = schema[id];
    if (!fields || active.includes(id)) return; // generate() refuses both, naming the path
    for (const field of fields) visit(field.type, key ? `${key}.${field.name}` : field.name, [...active, id]);
  };
  visitObject(0, '', []);
  offsetCache.set(schema, offsets);
  return offsets;
}

interface Walk { readonly schema: Schema; readonly offsets: Offsets; readonly active: number[] }

function leaf(type: SchemaType, walk: Walk, index: number, rng: Rng, path: string, key: string): Json | undefined {
  const offset = (suffix = '') => walk.offsets.get(key + suffix) ?? 0;
  switch (type.kind) {
    case 'string': return pick(STRING_EDGES, index, offset(), rng, () => randomString(rng));
    case 'number': return pick(NUMBER_EDGES, index, offset(), rng, () => randomNumber(rng));
    case 'boolean': return pick(BOOLEAN_EDGES, index, offset(), rng, () => rng.int(2) === 1);
    case 'date': return pick(DATE_EDGES, index, offset(), rng, () => randomDate(rng));
    case 'enum': {
      if (type.variants.length === 0) throw new Error(`${path}: enum with no variants`);
      return pick(type.variants, index, offset(), rng, () => type.variants[rng.int(type.variants.length)]!);
    }
    case 'optional':
      // Present and absent alternate (by the field's own phase), so both occur for every Option
      // within two states; the inner value advances once per presence, so ten states visit five
      // inner edges.
      return (index + offset('?')) % 2 === 0 ? leaf(type.inner, walk, index >> 1, rng.fork('some'), path, key) : undefined;
    case 'array': {
      const length = pick(ARRAY_LENGTH_EDGES, index, offset('#length'), rng, () => rng.int(9));
      const out: Json[] = [];
      for (let i = 0; i < length; i++) {
        // Each element has its own stream and its own edge step, so elements differ.
        const value = leaf(type.element, walk, index + i, rng.fork(`[${i}]`), `${path}[${i}]`, `${key}[]`);
        out.push(value === undefined ? null : value);
      }
      return out;
    }
    case 'object': return object(type.object, walk, index, rng, path, key);
    default: throw new Error(`${path}: unknown schema kind ${JSON.stringify(type)}`);
  }
}

function object(id: number, walk: Walk, index: number, rng: Rng, path: string, key: string): { [key: string]: Json } {
  const fields = walk.schema[id];
  if (!fields) throw new Error(`${path}: schema object ${id} does not exist`);
  if (walk.active.includes(id)) throw new Error(`${path}: schema object ${id} is recursive`);
  walk.active.push(id);
  const out: { [key: string]: Json } = {};
  for (const field of fields) {
    const value = leaf(field.type, walk, index, rng.fork(field.name), path ? `${path}.${field.name}` : field.name, key ? `${key}.${field.name}` : field.name);
    if (value !== undefined) out[field.name] = value;
  }
  walk.active.pop();
  return out;
}

export interface GenerateOptions {
  /** Names the module, so two modules with equal schemas get different states under one seed. */
  readonly module?: string;
}

/** State `index` for `schema` under `seed`: object 0's fields, as wire JSON. */
export function generate(schema: Schema, seed: string | number, index: number, options: GenerateOptions = {}): { [key: string]: Json } {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`state index must be a non-negative integer, got ${index}`);
  if (schema.length === 0) throw new Error('schema has no object 0');
  const rng = splitmix32(fnv1a(`${seed}:${options.module ?? ''}:${index}`));
  return object(0, { schema, offsets: fieldOffsets(schema), active: [] }, index, rng, '', '');
}

/** The edge list of a scalar kind, for tests and documentation. */
export function edgesOf(kind: 'string' | 'number' | 'boolean' | 'date'): readonly Json[] {
  switch (kind) {
    case 'string': return STRING_EDGES;
    case 'number': return NUMBER_EDGES;
    case 'boolean': return BOOLEAN_EDGES;
    case 'date': return DATE_EDGES;
  }
}
