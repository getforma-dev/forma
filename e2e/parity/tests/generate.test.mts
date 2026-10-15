import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_LENGTH_EDGES, DATE_EDGES, NUMBER_EDGES, STRING_EDGES, edgesOf, fnv1a, generate, sharedVectorInputs, splitmix32,
  type Json, type Schema,
} from '../src/generate.mts';

const one = (kind: 'string' | 'number' | 'boolean' | 'date'): Schema => [[{ name: 'v', type: { kind } }]];

test('the same seed, module and index give the same state; another seed, module or index differs', () => {
  const schema: Schema = [[
    { name: 'title', type: { kind: 'string' } },
    { name: 'count', type: { kind: 'number' } },
    { name: 'rows', type: { kind: 'array', element: { kind: 'object', object: 1 } } },
  ], [{ name: 'id', type: { kind: 'number' } }, { name: 'label', type: { kind: 'string' } }]];
  for (let index = 0; index < 40; index++) {
    assert.equal(JSON.stringify(generate(schema, 'forma-183', index, { module: 'a' })), JSON.stringify(generate(schema, 'forma-183', index, { module: 'a' })));
  }
  const distinct = new Set<string>();
  for (let index = 0; index < 40; index++) distinct.add(JSON.stringify(generate(schema, 'forma-183', index, { module: 'a' })));
  assert.equal(distinct.size, 40, 'forty indices give forty states');
  assert.notEqual(JSON.stringify(generate(schema, 'forma-183', 25, { module: 'a' })), JSON.stringify(generate(schema, 'other', 25, { module: 'a' })));
  assert.notEqual(JSON.stringify(generate(schema, 'forma-183', 25, { module: 'a' })), JSON.stringify(generate(schema, 'forma-183', 25, { module: 'b' })));
});

test('the PRNG is a fixed function of its seed (the published splitmix32 sequence is stable across runs)', () => {
  const a = splitmix32(fnv1a('forma-183:nested-islands:0'));
  const b = splitmix32(fnv1a('forma-183:nested-islands:0'));
  const first = [a.next(), a.next(), a.next()];
  assert.deepEqual([b.next(), b.next(), b.next()], first);
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.notEqual(a.fork('x').next(), a.fork('y').next(), 'forks are independent streams');
});

for (const kind of ['string', 'number', 'boolean', 'date'] as const) {
  test(`${kind}: the first states visit every edge in order, so ten states cover ten edges`, () => {
    const edges = edgesOf(kind);
    for (let index = 0; index < edges.length; index++) {
      const value = generate(one(kind), 'seed', index).v;
      assert.ok(Object.is(value, edges[index]), `${kind} state ${index} is edge ${index}: ${String(edges[index])}, got ${String(value)}`);
    }
  });
}

test('string: the ticket edges and every shared rule-1 vector are in the domain', () => {
  for (const edge of ['', '</script>', '<!--f:t0-->', '\0', '\r\n', '\r', '​', 'null', 'true', '0', '😀']) assert.ok(STRING_EDGES.includes(edge), JSON.stringify(edge));
  assert.ok(STRING_EDGES.some(s => s.length >= 2048), 'a long string');
  assert.ok(STRING_EDGES.some(s => s.startsWith('\n')), 'a leading line feed for the pre/textarea rule');
  const vectors = sharedVectorInputs();
  assert.ok(vectors.length >= 26, `the vector file holds its 26 values (got ${vectors.length})`);
  const seen = new Set<Json>();
  for (let index = 0; index < STRING_EDGES.length; index++) seen.add(generate(one('string'), 'seed', index).v);
  for (const vector of vectors) assert.ok(seen.has(vector), `vector ${JSON.stringify(vector)} is generated within ${STRING_EDGES.length} states`);
});

test('number: negative zero, both safe bounds, 2^53, 1e21 and the subnormal are edges; no NaN or infinity is ever generated', () => {
  assert.ok(NUMBER_EDGES.some(n => Object.is(n, -0)));
  assert.ok(NUMBER_EDGES.includes(2 ** 53 - 1) && NUMBER_EDGES.includes(-(2 ** 53 - 1)) && NUMBER_EDGES.includes(2 ** 53));
  assert.ok(NUMBER_EDGES.includes(1e21) && NUMBER_EDGES.includes(Number.MIN_VALUE));
  for (let index = 0; index < 500; index++) {
    const value = generate(one('number'), 'seed', index).v as number;
    assert.ok(Number.isFinite(value), `state ${index} is finite`);
  }
});

test('date: the epoch extremes are edges and every generated date is inside the Date range', () => {
  assert.ok(DATE_EDGES.includes(8.64e15) && DATE_EDGES.includes(-8.64e15) && DATE_EDGES.includes(0));
  for (let index = 0; index < 500; index++) {
    const value = generate(one('date'), 'seed', index).v as number;
    assert.ok(Number.isInteger(value) && Math.abs(value) <= 8.64e15, `state ${index} is epoch milliseconds in range`);
  }
});

test('optional: absent and present alternate, absent is an omitted key', () => {
  const schema: Schema = [[{ name: 'maybe', type: { kind: 'optional', inner: { kind: 'string' } } }]];
  for (let index = 0; index < 10; index++) {
    const state = generate(schema, 'seed', index);
    if (index % 2 === 0) assert.ok('maybe' in state, `state ${index} present`);
    else assert.ok(!('maybe' in state), `state ${index} absent`);
  }
});

test('array: the lengths 0, 1, 2, 3 and 32 come first, elements differ, an absent optional element is null', () => {
  const schema: Schema = [[{ name: 'list', type: { kind: 'array', element: { kind: 'optional', inner: { kind: 'number' } } } }]];
  for (let index = 0; index < ARRAY_LENGTH_EDGES.length; index++) {
    const list = generate(schema, 'seed', index).list as Json[];
    assert.equal(list.length, ARRAY_LENGTH_EDGES[index]);
  }
  const long = generate(schema, 'seed', 4).list as Json[];
  assert.equal(long.length, 32);
  assert.ok(long.includes(null), 'an absent optional element is a null position');
  assert.ok(new Set(long.map(v => JSON.stringify(v))).size > 2, 'elements are not all alike');
});

test('enum: every variant in declaration order, then only variants', () => {
  const schema: Schema = [[{ name: 'mode', type: { kind: 'enum', variants: ['ready', 'offline', 'away'] } }]];
  assert.deepEqual([0, 1, 2].map(index => generate(schema, 'seed', index).mode), ['ready', 'offline', 'away']);
  for (let index = 3; index < 50; index++) assert.ok(['ready', 'offline', 'away'].includes(generate(schema, 'seed', index).mode as string));
});

test('nested objects and arrays of objects produce the declared shape, and dates inside them stay epoch milliseconds', () => {
  const schema: Schema = [
    [{ name: 'user', type: { kind: 'object', object: 1 } }, { name: 'rows', type: { kind: 'array', element: { kind: 'object', object: 2 } } }],
    [{ name: 'displayName', type: { kind: 'string' } }, { name: 'active', type: { kind: 'boolean' } }],
    [{ name: 'id', type: { kind: 'number' } }, { name: 'at', type: { kind: 'date' } }, { name: 'detail', type: { kind: 'object', object: 1 } }],
  ];
  const state = generate(schema, 'seed', 2) as { user: { displayName: string; active: boolean }; rows: { id: number; at: number; detail: { displayName: string } }[] };
  assert.equal(typeof state.user.displayName, 'string');
  assert.equal(typeof state.user.active, 'boolean');
  assert.equal(state.rows.length, 2);
  for (const row of state.rows) {
    assert.equal(typeof row.id, 'number');
    assert.ok(Number.isInteger(row.at));
    assert.equal(typeof row.detail.displayName, 'string');
  }
});

test('a schema with no fields yields an empty state for every index; a recursive schema and a bad index are refused', () => {
  for (let index = 0; index < 5; index++) assert.deepEqual(generate([[]], 'seed', index), {});
  const recursive: Schema = [[{ name: 'self', type: { kind: 'object', object: 0 } }]];
  assert.throws(() => generate(recursive, 'seed', 0), /recursive/);
  assert.throws(() => generate([[]], 'seed', -1), RangeError);
  assert.throws(() => generate([], 'seed', 0), /object 0/);
});
