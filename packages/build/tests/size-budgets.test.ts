import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from './helpers/named-build';
import { assembleRoute, formatSizeReport, routeCeilings, routeSizeFailure, type RouteClass } from '../src/route-size';
import { applySizeBudgets, SizeBudgetError, sizePolicyFromEnvironment, validateSizeBudgets, validateResolvedSizeBudgets, type SizeBudgets } from '../src/size-budgets';
const temporary: string[] = [];
afterEach(() => { temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.unstubAllEnvs(); });
const bytes = (gzip: number) => ({ raw: gzip * 3, gzip, brotli: gzip });
const route = (forma: number, javascript: number, name = '/', kind: RouteClass = 'islands', canvas = false) =>
  assembleRoute(name, kind, canvas, [{ file: 'app.hash.js', ...bytes(javascript), forma: bytes(forma) }]);
const policy = (rule: object): SizeBudgets => ({ version: 1, defaults: { javascript: rule } });

describe('versioned application size budgets', () => {
  it.each(['islands', 'whole-page-mount', 'navigation-group', 'no-interactive-region'] as RouteClass[])('preserves exact framework boundaries despite permissive overrides: %s', kind => {
    for (const canvas of [false, true]) for (const metric of ['forma', 'javascript'] as const) {
      const ceiling = routeCeilings(kind, canvas)[metric];
      for (const delta of [-1, 0, 1]) {
        const actual = Math.max(0, ceiling + delta);
        const size = route(metric === 'forma' ? actual : 0, actual, '/', kind, canvas);
        applySizeBudgets([size], { version: 1, defaults: { forma: { warning: 999999, error: null }, javascript: { warning: 999999, error: null } } }, 'framework');
        expect(size.budget!.metrics[metric].effective.error).toBe(ceiling);
        expect(size.budget!.metrics[metric].severity).toBe(delta > 0 ? 'error' : actual > Math.floor(ceiling * .9) ? 'warning' : 'ok');
        expect(Boolean(routeSizeFailure([size]))).toBe(delta > 0);
        expect(size[metric].gzip).toBe(actual);
      }
    }
  });
  it.each([[9,'ok'],[10,'ok'],[11,'warning'],[19,'warning'],[20,'warning'],[21,'error']] as const)('compares strict warning/error boundaries at %s B', (actual, severity) => {
    const size = route(0, actual);
    applySizeBudgets([size], policy({ warning: 10, error: 20 }), 'application');
    expect(size.budget!.metrics.javascript).toMatchObject({ actual, severity, effective: { warning: 10, error: 20 } });
    expect(Boolean(routeSizeFailure([size]))).toBe(severity === 'error');
  });
  it('keeps default nonconformance visible when an explicit warning-only policy permits publication', () => {
    const size = route(29_000, 80_000);
    applySizeBudgets([size], { version: 1, defaults: { forma: { warning: 28_420, error: null }, javascript: { warning: 76_800, error: null } } }, 'application');
    expect(size.over).toBe(true);
    expect(size.exceeded).toEqual(['forma', 'javascript']);
    expect(size.budget!.severity).toBe('warning');
    expect(size.budget!.metrics.forma).toMatchObject({ actual: 29_000, estimated: true, defaultExcess: 580, source: 'application', effective: { warning: 28_420, error: null } });
    expect(routeSizeFailure([size])).toBeUndefined();
    expect(formatSizeReport({ version: 1, ceilings: { forma: 28420, page: 76800, canvas: 373760 }, routes: [size] }).join('\n')).toContain('default excess 580 B');
  });
  it('uses exact route metric replacement and retains defaults for omitted metrics', () => {
    const sizes = [route(100, 30, '/'), route(100, 30, '/other')];
    applySizeBudgets(sizes, { version: 1, defaults: { javascript: { warning: 20, error: 25 } }, routes: { '/': { javascript: { error: 100 } } } }, 'application');
    expect(sizes[0].budget!.metrics.javascript).toMatchObject({ source: 'route', effective: { warning: 90, error: 100 }, severity: 'ok' });
    expect(sizes[0].budget!.metrics.forma).toMatchObject({ source: 'default', effective: { warning: 25_578, error: 28_420 } });
    expect(sizes[1].budget!.metrics.javascript).toMatchObject({ source: 'application', severity: 'error' });
    expect(routeSizeFailure(sizes)?.message).toContain('/other');
    expect(routeSizeFailure(sizes)?.message).not.toContain('/ (');
  });
  it('never relaxes the zero-JavaScript contract', () => {
    const size = route(1, 1, '/', 'no-interactive-region');
    applySizeBudgets([size], { version: 1, defaults: { forma: { error: 900_000 }, javascript: { warning: 900_000, error: null } } }, 'application');
    expect(size.budget!.metrics.javascript).toMatchObject({ source: 'no-javascript', effective: { warning: 0, error: 0 }, severity: 'error' });
    expect(routeSizeFailure([size])?.message).toContain('against 0 B');
  });
  it.each([
    null, [], { version: 2 }, { version: 1, defualts: {} },
    { version: 1, defaults: { javaScript: { error: 10 } } },
    { version: 1, defaults: { javascript: {} } },
    { version: 1, defaults: { javascript: { warn: 10 } } },
    { version: 1, defaults: { javascript: { warning: 11, error: 10 } } },
    { version: 1, defaults: { javascript: { error: null } } },
    { version: 1, routes: { '/typo': { javascript: { error: 10 } } } },
    ...[NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER+1, '100', undefined].map(error => ({ version: 1, defaults: { javascript: { error } } })),
    JSON.parse('{"version":1,"defaults":{"__proto__":{"error":100}}}'),
    JSON.parse('{"version":1,"routes":{"constructor":{"javascript":{"error":100}}}}'),
    Object.assign(Object.create({ version: 1 }), { defaults: { javascript: { error: 10 } } }),
  ])('rejects malformed and hostile policy %# before publication', value => {
    expect(() => validateSizeBudgets(value, ['/'])).toThrow('BUILD-826');
    const valid = { version: 1, routes: { '/': { javascript: { warning: 10, error: null } } } };
    validateSizeBudgets(valid, ['/']);
    const size = route(0, 11);
    applySizeBudgets([size], valid as SizeBudgets, 'application');
    expect(size.budget!.severity).toBe('warning');
  });
  it('refuses an inherited default error lower than an explicit warning', () => {
    const size = route(0, 1);
    expect(() => applySizeBudgets([size], policy({ warning: 100_000 }), 'application')).toThrow('effective warning');
    expect(size.javascript.gzip).toBe(1);
  });
  it('requires an explicit valid qualification selector', () => {
    expect(sizePolicyFromEnvironment(undefined)).toBe('application');
    expect(sizePolicyFromEnvironment('framework')).toBe('framework');
    expect(() => sizePolicyFromEnvironment('framwork')).toThrow('BUILD-826');
    expect(sizePolicyFromEnvironment('application')).toBe('application');
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-app-budget-')); temporary.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/app.ts'), 'document.body.textContent = "Application ready";');
  const config = { entryPoints: [{ entry: join(root, 'src/app.ts'), outfile: 'app.js' }], outputDir: join(root, 'dist'), routes: { '/': { js: ['app'], css: [] } } };
  return { root, config };
}

describe('application budget build publication', () => {
  it('warns successfully, persists the same report, and exposes raw measurements on refused builds without touching the previous product', async () => {
    vi.stubEnv('FORMA_SIZE_POLICY', 'application');
    const { config } = fixture();
    const result = await build({ ...config, sizeBudgets: policy({ warning: 0, error: null }) });
    const previous = readFileSync(join(config.outputDir, 'manifest.json'), 'utf8');
    expect(result.warnings.some(warning => warning.startsWith('BUILD-819 warning:'))).toBe(true);
    expect(result.sizeReport.routes[0].budget!.severity).toBe('warning');
    const reportPath = `${config.outputDir}.size-report.json`;
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).routes).toEqual(result.sizes);
    let caught: unknown;
    try { await build({ ...config, sizeBudgets: policy({ warning: 0, error: 0 }) }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SizeBudgetError);
    const failure = caught as SizeBudgetError;
    expect(failure.sizeReport.routes[0].javascript.gzip).toBe(result.sizes[0].javascript.gzip);
    expect(failure.sizeReport.routes[0].budget!.severity).toBe('error');
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).routes).toEqual(failure.sizeReport.routes);
    expect(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8')).toBe(previous);
  }, 60_000);
  it('validates configuration before producing any files', async () => {
    const { root, config } = fixture();
    await expect(build({ ...config, sizeBudgets: { version: 1, routes: { '/typo': { javascript: { error: 100 } } } } })).rejects.toThrow('BUILD-826');
    expect(existsSync(config.outputDir)).toBe(false);
    expect(existsSync(`${config.outputDir}.size-report.json`)).toBe(false);
    await expect(build({ ...config, sizeReportJson: join(config.outputDir, 'report.json') })).rejects.toThrow('outside outputDir');
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toContain('Application ready');
  });
});


describe('budget policy does not weaken native contracts', () => {
  it('keeps a static SSR page at zero script bytes and refuses unsupported source under permissive policy', async () => {
    vi.stubEnv('FORMA_SIZE_POLICY', 'application');
    const { root, config } = fixture();
    const stub = join(root, 'src/core.js');
    writeFileSync(stub, 'export const h=()=>{}; export const mount=()=>{};');
    writeFileSync(config.entryPoints[0].entry, "import {h,mount} from 'formajs'; mount(() => h('main', null, 'safe static'), '#app');");
    const permissive = { ...config, ssr: true, formaAlias: stub, sizeBudgets: { version: 1 as const, defaults: { forma: { error: 999999 }, javascript: { error: 999999 } } } };
    const result = await build(permissive);
    expect(result.manifest.routes['/'].js).toEqual([]);
    expect(result.sizes[0]).toMatchObject({ class: 'no-interactive-region', javascript: { gzip: 0 }, budget: { metrics: { javascript: { source: 'no-javascript', effective: { warning: 0, error: 0 } } } } });
    const original = readFileSync(join(config.outputDir, 'manifest.json'), 'utf8');
    writeFileSync(config.entryPoints[0].entry, "import {h,mount} from 'formajs'; function lookup(){return 'bad'}; mount(() => h('main', {class:()=>lookup()}, 'still refused'), '#app');");
    await expect(build(permissive)).rejects.toThrow(/BUILD-(206|610)/);
    expect(readFileSync(join(config.outputDir, 'manifest.json'), 'utf8')).toBe(original);
  });
});


describe('resolved budgets before watch publication', () => {
  it('refuses inherited inverted thresholds before watch creates output and accepts a complete route replacement', async () => {
    const { config } = fixture();
    await expect(build({ ...config, watch: true, sizeBudgets: policy({ warning: 100_000 }) })).rejects.toThrow('effective warning 100000 exceeds error 76800');
    expect(existsSync(config.outputDir)).toBe(false);
    expect(existsSync(`${config.outputDir}.size-report.json`)).toBe(false);
    const replacement: SizeBudgets = { version: 1, defaults: { javascript: { warning: 100_000 } }, routes: { '/': { javascript: { error: 120_000 } } } };
    validateResolvedSizeBudgets({ ...config, watch: true, sizeBudgets: replacement });
    const size = route(0, 100_001);
    applySizeBudgets([size], replacement, 'application');
    expect(size.budget!.metrics.javascript).toMatchObject({ source: 'route', effective: { warning: 108_000, error: 120_000 }, severity: 'ok' });
  });
});


describe('framework build policy integration', () => {
  it('refuses oversized bundled Forma despite permissive application settings', async () => {
    vi.stubEnv('FORMA_SIZE_POLICY', 'framework');
    const { root, config } = fixture();
    const packageDir = join(root, 'node_modules/@getforma/core');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@getforma/core', type: 'module', exports: './index.js' }));
    let seed = 41;
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const text = Array.from({length: 60_000}, () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return alphabet[seed % alphabet.length]; }).join('');
    writeFileSync(join(packageDir, 'index.js'), `export const fixture = ${JSON.stringify(text)};`);
    writeFileSync(config.entryPoints[0].entry, 'import {fixture} from "@getforma/core"; document.body.textContent = fixture;');
    const permissive: SizeBudgets = { version: 1, defaults: { forma: { warning: 0, error: null }, javascript: { warning: 0, error: null } } };
    await expect(build({ ...config, sizeBudgets: permissive })).rejects.toThrow('BUILD-819');
    expect(existsSync(config.outputDir)).toBe(false);
    const report = JSON.parse(readFileSync(`${config.outputDir}.size-report.json`, 'utf8'));
    expect(report.routes[0].forma.gzip).toBeGreaterThan(28_420);
    expect(report.routes[0].budget.metrics.forma).toMatchObject({ source: 'framework', effective: { error: 28_420 }, configured: { warning: 0, error: null }, severity: 'error' });
    vi.stubEnv('FORMA_SIZE_POLICY', 'application');
    const allowed = await build({ ...config, sizeBudgets: permissive });
    expect(allowed.sizes[0].forma.gzip).toBe(report.routes[0].forma.gzip);
    expect(allowed.sizes[0].over).toBe(true);
    expect(allowed.sizes[0].budget!.severity).toBe('warning');
  });
});


describe('external report path defaults', () => {
  it('normalizes a trailing output separator and treats explicit undefined like omission', async () => {
    const { config } = fixture();
    const result = await build({ ...config, outputDir: `${config.outputDir}/`, sizeReportJson: undefined });
    expect(JSON.parse(readFileSync(`${config.outputDir}.size-report.json`, 'utf8')).routes).toEqual(result.sizes);
    expect(existsSync(join(config.outputDir, '.size-report.json'))).toBe(false);
  });
});
