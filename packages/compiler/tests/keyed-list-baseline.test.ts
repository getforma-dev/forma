/** The six canonical keyed-list fixtures were captured from the unchanged pre-181 compiler
 *  (fixtures/keyed-lists/baseline.json). FORMA-181 must not move a byte of their schema,
 *  binding or digest, nor a local, capture or row ordinal; section 6 is added beside them and
 *  must name every emitted LIST at its exact offset with the canonical record's key path. */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createIslandRegistry} from '../src/island-registry';
import {makeIslandContract, type BindingRecord} from '../src/fmir-contracts';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {readFmirContainer} from '../src/fmir';
import {OP_LIST, SECTION_BYTECODE, SECTION_KEY_PATHS} from '../src/fmir-constants';
import {getStrings} from './helpers/fmir';

const ROOT = resolve(__dirname, 'fixtures/keyed-lists');
const CASES = ['child', 'helper-twice', 'nested-list', 'nested-path', 'repeated', 'simple'] as const;
interface Frozen {name: string; schema: string; bindings: string; digest: string; locals: unknown[]; captures: unknown[]; rows: unknown[]}
const baseline = JSON.parse(readFileSync(join(ROOT, 'baseline.json'), 'utf8')) as {cases: Record<string, {sourceSha256: string; records: Frozen[]}>};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true, force: true}); vi.restoreAllMocks(); });

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** Key paths of every list record in lexical (preorder) order, nested lists included. */
function listKeys(records: readonly BindingRecord[]): string[][] {
  const out: string[][] = [];
  for (const record of records) {
    if (record.kind === 'list') { out.push([...record.key]); out.push(...listKeys(record.body)); }
    else if (record.kind === 'show') { out.push(...listKeys(record.then)); out.push(...listKeys(record.else)); }
  }
  return out;
}
function contracts(file: string) {
  return createIslandRegistry(file).entries().map(({island}, id) => {
    const analysis = island.analyze(), contract = makeIslandContract(id, island.declared.schema, 0, island.mode, analysis.bindings);
    return {
      frozen: {name: island.name, schema: hex(contract.schemaBytes), bindings: hex(contract.bindingBytes), digest: hex(contract.digest),
        locals: analysis.locals.map(x => ({ordinal: x.ordinal, getter: x.getter, setter: x.setter})), captures: analysis.captures.map(x => ({ordinal: x.ordinal, getter: x.getter})), rows: analysis.adoption?.rows} as Frozen,
      keys: listKeys(analysis.bindings),
    };
  });
}
interface Entry {offset: number; path: string[]; bodyStart: number; bodyEnd: number}
/** Section 6 decoded against the bytecode: each offset must be a LIST opcode, and the body range follows its header. */
function keyPaths(binary: Uint8Array): Entry[] {
  const container = readFmirContainer(binary), section = container.sections.find(x => x.id === SECTION_KEY_PATHS), code = container.sections.find(x => x.id === SECTION_BYTECODE)!.bytes;
  expect(section?.flags, 'section 6 is required when present').toBe(1);
  const bytes = section!.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), strings = getStrings(binary), out: Entry[] = [];
  let at = 4;
  for (let i = 0; i < view.getUint32(0, true); i++) {
    const offset = view.getUint32(at, true); at += 4;
    const count = bytes[at++]!, path: string[] = [];
    for (let j = 0; j < count; j++) { path.push(strings[view.getUint32(at, true)]!); at += 4; }
    expect(code[offset], `offset ${offset} is a LIST opcode`).toBe(OP_LIST);
    const bodyLen = new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(offset + 5, true);
    out.push({offset, path, bodyStart: offset + 9, bodyEnd: offset + 9 + bodyLen});
  }
  expect(at).toBe(bytes.length);
  return out;
}
function emit(file: string): Uint8Array { vi.spyOn(console, 'warn').mockImplementation(() => {}); return generateRealIr(file)!.binary; }

describe('frozen canonical keyed-list baselines', () => {
  it.each(CASES)('%s: schema, binding and digest bytes and the local, capture and row ordinal tables are byte-exact', name => {
    const file = join(ROOT, name, 'app.ts');
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(baseline.cases[name]!.sourceSha256);
    expect(contracts(file).map(x => x.frozen)).toEqual(baseline.cases[name]!.records);
  });
  /** `helper-twice` passes canonical analysis (its bytes are frozen above) but the page walk
   *  refuses `Rows({rows:p.rows})`: a declared prop expression through a helper call is outside
   *  the SSR subset before and after FORMA-181 (the baseline capture ran analysis only). Pinned
   *  so the limitation is explicit; emission-level helper reuse is proved below. */
  const EMITTED = CASES.filter(name => name !== 'helper-twice');
  it('helper-twice: the page walk still refuses the declared-prop helper call with BUILD-610 at the call', () => {
    expect(() => emit(join(ROOT, 'helper-twice', 'app.ts'))).toThrow(/^BUILD-610 .*helper-twice\/app\.ts:3:49: this declared prop expression is outside the SSR subset/);
  });
  it.each(EMITTED)('%s: section 6 names every emitted LIST once, at its offset, with the canonical record key path', name => {
    const file = join(ROOT, name, 'app.ts'), records = contracts(file), entries = keyPaths(emit(file));
    expect(entries.map(x => x.path)).toEqual(records.flatMap(x => x.keys));
    expect(entries).toHaveLength(records.reduce((n, x) => n + x.frozen.rows.length, 0));
    expect(new Set(entries.map(x => x.offset)).size).toBe(entries.length);
    expect(entries.map(x => x.offset)).toEqual([...entries.map(x => x.offset)].sort((a, b) => a - b));
  });
  it('repeated same-source lists keep distinct offsets and their own paths', () => {
    const entries = keyPaths(emit(join(ROOT, 'repeated', 'app.ts')));
    expect(entries.map(x => x.path)).toEqual([['id'], ['user', 'id']]);
    expect(entries[0]!.offset).toBeLessThan(entries[1]!.offset);
    expect(entries[1]!.offset).toBeGreaterThanOrEqual(entries[0]!.bodyEnd);
  });
  it('a helper containing a LIST, invoked twice, emits two entries with equal paths at distinct offsets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forma-keyed-helper-')); dirs.push(dir);
    const file = join(dir, 'app.ts');
    writeFileSync(file, `import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';
type Row={id:string,label:string};
const [shared]=createSignal<Row[]>([{id:'a',label:'A'},{id:'b',label:'B'}]);
function Rows(){return h('ul',null,createList(shared,r=>r.id,r=>h('li',null,r.label)));} export function Counter(){return h('main',null,Rows(),Rows());}
function Page(){return h('main',null,Counter());}
mount(()=>Page(), '#app');
activateIslands({Counter});
`);
    const records = contracts(file), entries = keyPaths(emit(file));
    expect(records.map(x => x.keys)).toEqual([[['id'], ['id']]]);
    expect(records[0]!.frozen.rows).toEqual([{id: 0, source: {kind: 'capture', id: 0, path: []}}, {id: 1, source: {kind: 'capture', id: 0, path: []}}]);
    expect(entries.map(x => x.path)).toEqual([['id'], ['id']]);
    expect(entries[0]!.offset).toBeLessThan(entries[1]!.offset);
    expect(entries[1]!.offset).toBeGreaterThanOrEqual(entries[0]!.bodyEnd);
  });
  it('a nested list keeps its own entry inside the outer body and its row source is the outer row', () => {
    const file = join(ROOT, 'nested-list', 'app.ts'), [outer, inner] = keyPaths(emit(file));
    expect(inner!.offset).toBeGreaterThanOrEqual(outer!.bodyStart);
    expect(inner!.bodyEnd).toBeLessThanOrEqual(outer!.bodyEnd);
    expect([outer!.path, inner!.path]).toEqual([['id'], ['id']]);
    const rows = contracts(file)[0]!.frozen.rows as {id: number; source: unknown}[];
    expect(rows).toEqual([{id: 0, source: {kind: 'prop', path: ['rows']}}, {id: 1, source: {kind: 'row', id: 0, path: ['children']}}]);
  });
  it('a registered child as the row body leaves the parent list keyed and the child without rows', () => {
    const file = join(ROOT, 'child', 'app.ts'), records = contracts(file);
    expect(records.map(x => [x.frozen.name, x.frozen.rows.length])).toEqual([['Counter', 1], ['Badge', 0]]);
    expect(keyPaths(emit(file)).map(x => x.path)).toEqual([['id']]);
  });
  it('an imported core alias proves the same identity: same canonical bytes, digest and section 6 as the plain spelling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forma-keyed-alias-')); dirs.push(dir);
    const plain = readFileSync(join(ROOT, 'simple', 'app.ts'), 'utf8');
    const aliased = plain
      .replace("import {h,mount,activateIslands,createSignal,createList} from '@getforma/core';", "import {h,mount,activateIslands,createSignal,createList as list} from '@getforma/core';")
      .replace('createList(', 'list(');
    expect(aliased).not.toBe(plain);
    const file = join(dir, 'app.ts'); writeFileSync(file, aliased);
    expect(contracts(file).map(x => x.frozen)).toEqual(baseline.cases.simple!.records);
    expect(keyPaths(emit(file)).map(x => x.path)).toEqual([['id']]);
    expect(Buffer.from(emit(file))).toEqual(Buffer.from(emit(join(ROOT, 'simple', 'app.ts'))));
  });
});
