/** A held real entry build proves rejection waits for every page's report. */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {BuildConfig} from '../src/types';

const control = vi.hoisted(() => ({
  hold: undefined as Promise<void> | undefined,
  started: undefined as (() => void) | undefined,
  refused: undefined as (() => void) | undefined,
  error: undefined as unknown,
  finished: false,
}));
vi.mock('esbuild', async importOriginal => {
  const actual = await importOriginal<typeof import('esbuild')>();
  return {...actual, build: async (options: import('esbuild').BuildOptions) => {
    const held = options.outfile?.endsWith('delayed.js') && control.hold;
    if (held) { control.started?.(); await held; }
    try {
      const result = await actual.build(options);
      if (held) control.finished = true;
      return result;
    } catch (error) {
      if (options.outfile?.endsWith('mandatory.js')) { control.error = error; control.refused?.(); }
      throw error;
    }
  }};
});
import {build} from './helpers/named-build';

const roots: string[] = [];
afterEach(() => {
  control.hold = undefined; control.started = undefined; control.refused = undefined;
  control.error = undefined; control.finished = false;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});
function fixture(codeSplitting = false) {
  const root = mkdtempSync(join(tmpdir(), 'forma-mandatory-report-')); roots.push(root);
  const outputDir = join(root, 'dist'); mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'manifest.json'), 'accepted-manifest');
  writeFileSync(join(outputDir, 'accepted.js'), 'accepted-browser-bytes');
  const stub = join(root, 'stub.js'); writeFileSync(stub, 'export const h=()=>{}; export const mount=()=>{};');
  const mandatory = join(root, 'mandatory.ts');
  const delayed = join(root, 'delayed.ts');
  writeFileSync(mandatory, `import {h,mount} from 'formajs';\nconst helper={extra:()=>h('b',null,'x')};\nmount(()=>h('main',null,helper.extra()),'#app');`);
  writeFileSync(delayed, `import {h,mount} from 'formajs';\nfunction name(){return 'x';}\nmount(()=>h('main',{title:'title '+name()},'delayed'),'#app');`);
  const report = join(root, 'diagnostics.json');
  const config: BuildConfig = {ssr: true, strict: false, codeSplitting, outputDir, diagnosticsJson: report, formaAlias: stub,
    entryPoints: [{entry: mandatory, outfile: 'mandatory.js'}, {entry: delayed, outfile: 'delayed.js'}],
    routes: {'/mandatory': {js: ['mandatory'], css: []}, '/delayed': {js: ['delayed'], css: []}},
  };
  return {root, outputDir, report, config};
}
function preserved(f: ReturnType<typeof fixture>) {
  expect(readFileSync(join(f.outputDir, 'manifest.json'), 'utf8')).toBe('accepted-manifest');
  expect(readFileSync(join(f.outputDir, 'accepted.js'), 'utf8')).toBe('accepted-browser-bytes');
  expect(readdirSync(f.outputDir).sort()).toEqual(['accepted.js', 'manifest.json']);
}
function reportComplete(f: ReturnType<typeof fixture>) {
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  expect(report.strict).toBe(true);
  expect(report.diagnostics.map((d: {page:string;code:string;severity:string}) => [d.page,d.code,d.severity])).toEqual([
    ['mandatory','BUILD-101','error'], ['mandatory','BUILD-610','error'], ['delayed','BUILD-207','error'],
  ]);
}

describe('mandatory refusal reports', () => {
  it('waits for a held page, writes its complete report, and returns the aggregate refusal without late publication', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fixture();
    let release!: () => void;
    control.hold = new Promise(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { control.started = resolve; });
    const refused = new Promise<void>(resolve => { control.refused = resolve; });
    let settled = false;
    const attempt = build(f.config).then(value => { settled = true; return {value,error:undefined}; }, error => { settled = true; return {value:undefined,error}; });
    try {
      await Promise.all([started, refused]);
      await new Promise(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(control.finished).toBe(false);
      expect(existsSync(f.report)).toBe(false);
      preserved(f);
    } finally { release(); }
    const result = await attempt;
    expect(result.error.name).toBe('FormaStrictBuildError');
    expect(String(result.error)).toContain('BUILD-610');
    expect(control.finished).toBe(false); // the held entry also reaches its mandatory refusal
    reportComplete(f); preserved(f);
    expect(readdirSync(f.root).filter(name => name.includes('forma-staging'))).toEqual([]);
    await new Promise(resolve => setImmediate(resolve));
    preserved(f);
    expect(readdirSync(f.root).filter(name => name.includes('forma-staging'))).toEqual([]);
  }, 30_000);

  it('also writes the complete diagnostic report for a split build refusal', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
    const f = fixture(true);
    await expect(build(f.config)).rejects.toThrow(/BUILD-610/);
    reportComplete(f); preserved(f);
    expect(readdirSync(f.root).filter(name => name.includes('forma-staging'))).toEqual([]);
  });
});
