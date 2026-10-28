/** Application policy is separate from immutable framework measurements. */
import { routeCeilings, type RouteSize, type SizeReport } from './route-size.js';
import type { BuildConfig } from './types.js';

export type SizeMetric = 'forma' | 'javascript';
export interface SizeBudgetThresholds {
  /** Warn strictly above this integer number of gzip -9 bytes. */
  warning?: number;
  /** Fail strictly above this integer number of gzip -9 bytes; null explicitly selects warning-only. */
  error?: number | null;
}
export type SizeBudgetMetrics = Partial<Record<SizeMetric, SizeBudgetThresholds>>;
export interface SizeBudgets {
  version: 1;
  defaults?: SizeBudgetMetrics;
  /** Exact configured route keys; no patterns or inferred routes. */
  routes?: Record<string, SizeBudgetMetrics>;
}
export type SizePolicy = 'application' | 'framework';
export interface SizeBudgetEvaluation {
  version: 1;
  policy: SizePolicy;
  metrics: Record<SizeMetric, {
    actual: number;
    estimated: boolean;
    default: { warning: number; error: number };
    effective: { warning: number; error: number | null };
    source: 'default' | 'application' | 'route' | 'framework' | 'no-javascript';
    configured?: SizeBudgetThresholds;
    severity: 'ok' | 'warning' | 'error';
    warningExcess: number;
    errorExcess: number;
    defaultExcess: number;
  }>;
  severity: 'ok' | 'warning' | 'error';
}

const metrics: SizeMetric[] = ['forma', 'javascript'];
const fail = (message: string): never => { throw new Error(`BUILD-826 invalid size budget: ${message}`); };
function record(value: unknown, at: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${at} must be a plain object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || (allowed && !allowed.includes(key))) fail(`${at}.${key} is unknown`);
  }
  return object;
}
function validateMetrics(value: unknown, at: string): void {
  const object = record(value, at, metrics);
  if (!Object.keys(object).length) fail(`${at} must name at least one metric`);
  for (const [metric, thresholds] of Object.entries(object)) {
    const rule = record(thresholds, `${at}.${metric}`, ['warning', 'error']);
    if (!Object.keys(rule).length) fail(`${at}.${metric} must supply a warning or error threshold`);
    for (const [name, threshold] of Object.entries(rule)) {
      if (name === 'error' && threshold === null) continue;
      if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 0) fail(`${at}.${metric}.${name} must be a non-negative safe integer byte count`);
    }
    if (rule.error === null && rule.warning === undefined) fail(`${at}.${metric}: warning-only requires an explicit warning`);
    if (typeof rule.warning === 'number' && typeof rule.error === 'number' && rule.warning > rule.error) fail(`${at}.${metric}: warning must not exceed error`);
  }
}
export function validateSizeBudgets(value: unknown, routes: readonly string[]): void {
  if (value === undefined) return;
  const config = record(value, 'sizeBudgets', ['version', 'defaults', 'routes']);
  if (config.version !== 1) fail('sizeBudgets.version must be 1');
  if (config.defaults !== undefined) validateMetrics(config.defaults, 'sizeBudgets.defaults');
  if (config.routes !== undefined) for (const [route, rule] of Object.entries(record(config.routes, 'sizeBudgets.routes'))) {
    if (!routes.includes(route)) fail(`sizeBudgets.routes[${JSON.stringify(route)}] is not a configured route`);
    validateMetrics(rule, `sizeBudgets.routes[${JSON.stringify(route)}]`);
  }
}
/** Resolve inherited fields before compilation, including watch builds. Compiler
 * static elimination can only tighten the final class to mandatory zero-JS. */
export function validateResolvedSizeBudgets(config: BuildConfig): void {
  for (const [route, mapping] of Object.entries(config.routes)) {
    if (mapping.js.length === 0) continue; // No application threshold can change mandatory zero-JS.
    const grouped = config.navigationGroups?.some(group => group.owners.includes(mapping.js[0]));
    const ceilings = routeCeilings(grouped ? 'navigation-group' : mapping.js.length ? 'whole-page-mount' : 'no-interactive-region', mapping.canvas);
    for (const metric of metrics) {
      resolveThresholds(route, metric, ceilings[metric], config.sizeBudgets?.routes?.[route]?.[metric] ?? config.sizeBudgets?.defaults?.[metric]);
    }
  }
}
function resolveThresholds(route: string, metric: SizeMetric, ceiling: number, configured: SizeBudgetThresholds | undefined): { warning: number; error: number | null } {
  const error = configured?.error === undefined ? ceiling : configured.error;
  const warning = configured?.warning ?? Math.floor((error ?? ceiling) * 0.9);
  if (error !== null && warning > error) fail(`${route}.${metric}: effective warning ${warning} exceeds error ${error}`);
  return { warning, error };
}
export function sizePolicyFromEnvironment(value: string | undefined): SizePolicy {
  if (value === undefined || value === '' || value === 'application') return 'application';
  if (value === 'framework') return 'framework';
  return fail('FORMA_SIZE_POLICY must be application or framework');
}

/** A complete metric override replaces that metric; omitted metrics inherit. */
export function applySizeBudgets(sizes: RouteSize[], config: SizeBudgets | undefined, policy: SizePolicy): void {
  for (const size of sizes) {
    const evaluated = {} as SizeBudgetEvaluation['metrics'];
    for (const metric of metrics) {
      const ceiling = size.ceilings[metric];
      const baseline = { warning: Math.floor(ceiling * 0.9), error: ceiling };
      const routeRule = config?.routes?.[size.route]?.[metric];
      const applicationRule = config?.defaults?.[metric];
      const configured = routeRule ?? applicationRule;
      let source: SizeBudgetEvaluation['metrics'][SizeMetric]['source'] = routeRule ? 'route' : applicationRule ? 'application' : 'default';
      // Validate resolved values even in framework mode; invalid app policy never disappears.
      let effective = size.class === 'no-interactive-region' ? baseline : resolveThresholds(size.route, metric, ceiling, configured);
      if (policy === 'framework') { effective = baseline; source = 'framework'; }
      if (size.class === 'no-interactive-region') { effective = { warning: 0, error: 0 }; source = 'no-javascript'; }
      const actual = size[metric].gzip;
      const warningExcess = Math.max(0, actual - effective.warning);
      const errorExcess = effective.error === null ? 0 : Math.max(0, actual - effective.error);
      evaluated[metric] = {
        actual, estimated: metric === 'forma', default: baseline, effective, source,
        ...(configured ? { configured: { ...configured } } : {}),
        severity: errorExcess > 0 ? 'error' : warningExcess > 0 ? 'warning' : 'ok',
        warningExcess, errorExcess, defaultExcess: Math.max(0, actual - ceiling),
      };
    }
    size.budget = {
      version: 1, policy, metrics: evaluated,
      severity: metrics.some(metric => evaluated[metric].severity === 'error') ? 'error'
        : metrics.some(metric => evaluated[metric].severity === 'warning') ? 'warning' : 'ok',
    };
  }
}
export function sizeBudgetWarnings(sizes: readonly RouteSize[]): string[] {
  return sizes.flatMap(size => metrics.flatMap(metric => {
    const result = size.budget?.metrics[metric];
    return result?.severity === 'warning'
      ? [`BUILD-819 warning: ${size.route} ${metric === 'forma' ? 'estimated Forma code' : 'cold JavaScript'} ${result.actual} B exceeds warning ${result.effective.warning} B by ${result.warningExcess} B (${result.source}; error ${result.effective.error === null ? 'disabled explicitly' : `${result.effective.error} B`}; default error ${result.default.error} B)`]
      : [];
  }));
}

/** The rejected build remains inspectable through the thrown error as well as its JSON report. */
export class SizeBudgetError extends Error {
  readonly code = 'BUILD-819';
  constructor(message: string, readonly sizeReport: SizeReport, readonly reportPath: string) {
    super(message);
    this.name = 'SizeBudgetError';
  }
}
