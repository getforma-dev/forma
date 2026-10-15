import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readPageProps } from '../src/props-schema';

const dirs: string[] = [];
function files(sources: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'forma-props-schema-')); dirs.push(dir);
  for (const [file, source] of Object.entries(sources)) { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), source); }
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('declared page props', () => {
  it('uses the same relative source coordinates through a directory alias',()=>{
    const dir=files({'app.ts':'export {Page} from "./page";','page.ts':'export function Page(p:{title:string}){return null;}'});
    const links=files({});symlinkSync(dir,join(links,'source'),'junction');
    expect(readPageProps(join(links,'source','app.ts'),'Page')).toEqual(readPageProps(join(dir,'app.ts'),'Page'));
    expect(readPageProps(join(links,'source','app.ts'),'Page').schema[0]![0]!.file).toBe('page.ts');
  });
  it('reads original TSX types, imported aliases and every closed type with original positions', () => {
    const dir = files({
      'barrel.ts': "export { Actual as Page } from './page';",
      'types.ts': "export type User = { name: string; mode: 'on' | 'off' };\nexport type Count = number;",
      'page.tsx': "import type { User, Count } from './types';\ntype Props = {\n  count: Count;\n  user: User;\n  enabled: boolean;\n  date: Date;\n  rows: User[];\n  error?: string;\n  nullable: string | null;\n};\nexport function Actual(props: Props) { return <p>{props.count}</p>; }",
    });
    const result = readPageProps(join(dir, 'barrel.ts'), 'Page');
    expect(result.parameter).toEqual({ kind: 'named', name: 'props' });
    expect(result.schema[0]!.map(f => [f.name, f.type])).toEqual([
      ['count', { kind: 'number' }], ['user', { kind: 'object', object: 1 }],
      ['enabled', { kind: 'boolean' }], ['date', { kind: 'date' }],
      ['rows', { kind: 'array', element: { kind: 'object', object: 1 } }],
      ['error', { kind: 'optional', inner: { kind: 'string' } }],
      ['nullable', { kind: 'optional', inner: { kind: 'string' } }],
    ]);
    expect(result.schema[0]![0]).toMatchObject({ file: 'page.tsx', line: 3, column: 3 });
    expect(result.schema[1]).toMatchObject([{ name: 'name', type: { kind: 'string' }, file: 'types.ts', line: 1 }, { name: 'mode', type: { kind: 'enum', variants: ['on', 'off'] } }]);
  });
  it('retains exact declared property names while resolving destructuring aliases', () => {
    const dir = files({ 'page.ts': 'type Props = { count: number; "tenant-name": string }; export function Page({ count: localCount, "tenant-name": tenant }: Props) { return null; }' });
    const result = readPageProps(join(dir, 'page.ts'), 'Page');
    expect(result.parameter).toEqual({ kind: 'destructured', fields: [['count', 'localCount'], ['tenant-name', 'tenant']] });
    expect(result.schema[0]!.map(f => f.name)).toEqual(['count', 'tenant-name']);
  });
  it('allows a page with no parameter and follows imported interface declarations', () => {
    const dir = files({ 'page.ts': "import type { Props } from './types'; export function Empty() { return null; } export function Page(props: Props) { return null; }", 'types.ts': 'export interface Props { ok: boolean }' });
    expect(readPageProps(join(dir, 'page.ts'), 'Empty').schema).toEqual([[]]);
    expect(readPageProps(join(dir, 'page.ts'), 'Page').schema[0]![0]).toMatchObject({ name: 'ok', type: { kind: 'boolean' } });
  });
  it.each([
    '[key: string]: string', 'value: Map<string, string>', 'value: Set<string>',
    'value: [number, string]', 'value: () => void', 'value: Custom',
    'value: { kind: "a"; a: string } | { kind: "b"; b: number }',
    'value: unknown', 'value: any', 'value: never', 'value: bigint',
    'value: Promise<string>', 'value: { next: Props }',
  ])('refuses unsupported or cyclic props: %s', field => {
    const dir = files({ 'page.ts': `class Custom {}\ntype Props = { ${field} };\nexport function Page(props: Props) { return null; }` });
    expect(() => readPageProps(join(dir, 'page.ts'), 'Page')).toThrow(/BUILD-610.*page.ts:2:/);
  });
  it('refuses an untyped parameter, duplicate field, unresolved alias and rest/default destructuring', () => {
    for (const [declaration, parameter] of [
      ['', 'props'], ['type Props = { value: string; value: number }', 'props: Props'],
      ['type Props = Missing', 'props: Props'], ['type Props = { value: string }', '{ ...rest }: Props'],
      ['type Props = { value: string }', '{ value = "fallback" }: Props'],
    ]) {
      const dir = files({ 'page.ts': `${declaration}; export function Page(${parameter}) { return null; }` });
      expect(() => readPageProps(join(dir, 'page.ts'), 'Page')).toThrow(/BUILD-610/);
    }
  });
  it('matches FMIR wrapper depth independently of acyclic object depth', () => {
    for (const [wrappers, optional, valid] of [[16, false, true], [17, false, false], [15, true, true], [16, true, false]] as const) {
      const dir = files({ 'page.ts': `type Props = { value${optional ? '?' : ''}: string${'[]'.repeat(wrappers)} }; export function Page(p: Props) { return null; }` });
      const run = () => readPageProps(join(dir, 'page.ts'), 'Page');
      if (valid) expect(run).not.toThrow(); else expect(run).toThrow(/BUILD-610.*nesting/);
    }
    const nested = Array.from({ length: 24 }, (_, i) => `type Level${i} = { value: ${i === 23 ? 'string' : `Level${i + 1}`} };`).join('\n');
    const dir = files({ 'page.ts': `${nested} export function Page(p: Level0) { return null; }` });
    expect(readPageProps(join(dir, 'page.ts'), 'Page').schema).toHaveLength(24);
    const cyclic = files({ 'page.ts': 'type A = { value: B }; type B = { value: A }; export function Page(p: A) { return null; }' });
    expect(() => readPageProps(join(cyclic, 'page.ts'), 'Page')).toThrow(/BUILD-610.*recursive/);
  });

});
