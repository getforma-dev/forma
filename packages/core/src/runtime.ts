/**
 * Explicit HTML runtime (FORMA-108; DR-14/DR-15).
 *
 * mountMarkup(root, trustedHtml(markup), { tier, grants, config }) is the only
 * binding entry. It binds the supplied markup beneath that root and returns
 * update/unmount lifecycle methods. Every mount names its trust tier; omitted
 * grants grant nothing. No document scan, body observer or script/global
 * configuration can create or configure a mount.
 *
 * ── FILE MAP
 *   Attribute safety & scope
 *   $refetch registry
 *   Configuration & diagnostics
 *   Mount boundaries
 *   Performance utilities
 *   Pre-compiled regexes (avoid re-creation in hot paths)
 *   Per-scope evaluator cache
 *   Compiled template cache
 *   Parsing utilities
 *   Template text caching for data-list
 *   CSS Transitions
 *   Expression evaluator
 *   Handler compiler
 *   State initialization
 *   DOM scanner
 *   Element binding
 *   Scope mounting / unmounting (single data-forma-state element)
 *   DevTools API — State Inspector
 *   Tiered mount
 *
 * ── SUPPORTED DIRECTIVES
 * See docs/HTML-RUNTIME.md for the current directive grammar and mount contract.
 *
 * The allowlist expression interpreter is shared by every runtime build.
 * Unreviewed markup is confined to the opaque-origin preview frame.
 */
import { createSignal, internalEffect, createComputed, createUnownedRoot, registerDisposer, batch } from './reactive';
import { reconcileList, type ListTransitionHooks } from './dom/list';
import { createReconciler } from './dom/reconcile';
import { isTrustedHtml, trustedHtml, RUNTIME_SRCDOC_CODE, type TrustedHtml } from './dom/trusted-html';
import { isDangerousUrl, isUrlAttr, isEventHandlerAttr, isRawHtmlAttr } from './security/url-safety';
import {
  compileExpression,
  exprError,
  compileHandler,
  evaluateExpression,
  GROW,
  hostFn,
  hostObject,
  isExprError,
  isHost,
  LIMITS,
  runHandler,
  running,
  weigh,
  type Bound,
  type ExprGrant,
  type FormaExprError,
  type Meter,
  type TextCost,
  WAITING_CAP,
} from './expr';
import { sourceIsDev, warnDeprecated } from './deprecated';

/**
 * The build flag (FORMA-169). What only a development build does here (the
 * report of the grants a mount used and the obsolete manual-attribute warning) is guarded
 * by the condition `(typeof __FORMA_DEV_BUILD__ === 'boolean' &&
 * __FORMA_DEV_BUILD__) || (typeof __FORMA_DEV_BUILD__ !== 'boolean' &&
 * sourceIsDev())`, written out at each site: every build folds it there to a
 * literal, chunked or not, where a `const` holding it is not inlined into the
 * IIFE. Run from source, it follows NODE_ENV, as `__DEV__` does.
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a production build carries neither the grant report nor the obsolete manual-switch warning"
 */
declare const __FORMA_DEV_BUILD__: boolean | undefined;

// ── Attribute safety & scope ──

/**
 * True if writing `value` to attribute `name` on a `<tag>` element via
 * setAttribute would create an XSS sink: an `on*` inline event handler, or a
 * URL attribute carrying a script-executing scheme. Shared by data-bind:* and
 * list-template binding.
 *
 * `tag` is the lower-case name of the element receiving the attribute and is
 * always passed: `isDangerousUrl` needs it to tell a `data:image/svg+xml` that
 * is inert on an `<img>` from the same value on an `<a href>`, where it is a
 * navigable document.
 * Verified by: src/__tests__/runtime-bind-security.test.ts > "does not set a javascript: URL from data-bind:href"
 * Verified by: src/__tests__/runtime-bind-security.test.ts > "forwards the element tag to the URL scheme check"
 */
function isUnsafeAttrBinding(name: string, value: string, tag: string): boolean {
  if (isEventHandlerAttr(name)) return true;
  if (isUrlAttr(name) && isDangerousUrl(value, tag)) return true;
  return false;
}

type Getter = () => unknown;
type Setter = (v: unknown) => void;

interface Scope {
  getters: Record<string, Getter>;
  setters: Record<string, Setter>;
  /** Every bound scope belongs to an explicit mount. */
  mount: MountCtx;
  /** The mount's step budget, read by the interpreter (`ScopeLike.budget`). */
  budget: number;
}

// ── $refetch registry ──
// Maps data-fetch-id values to their doFetch() functions so handlers can
// trigger imperative refetches via $refetch('id').

/**
 * How long a `data-fetch` request may take, in ms, before it is aborted into
 * its `error:` target: `createFetch`'s default (decision brief L-46). A tiered
 * mount's `fetch` grant may shorten it, never lengthen it (FORMA-128).
 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Run the `data-fetch` registered as `id` in this mount's own registry, so
 * a widget reaches only its own fetches and nothing else reaches them.
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "$refetch reaches only the fetches of its own mount"
 */
function $refetch(id: string, registry: Map<string, () => void>): void {
  const fn = registry.get(id);
  if (fn) {
    fn();
  } else if (_debug) {
    dbg(`$refetch: no data-fetch with id "${id}" found`);
  }
}

function createChildScope(parent: Scope, locals: Record<string, unknown>): Scope {
  const localGetters: Record<string, Getter> = Object.create(null);
  for (const key of Object.keys(locals)) {
    localGetters[key] = () => locals[key];
  }

  const child: Scope = {
    getters: new Proxy(parent.getters, {
      get(target, prop: string) {
        if (prop in localGetters) return localGetters[prop];
        return target[prop];
      },
      has(target, prop: string) {
        return prop in localGetters || prop in target;
      },
    }),
    setters: parent.setters,
    mount: parent.mount,
    budget: parent.budget,
  };
  return child;
}

// Internal debug branches are compiled away; configuration belongs to mounts.
const _debug = false;

// ── Configuration & diagnostics ──

function dbg(...args: unknown[]): void {
  if (_debug) {
    console.log('[FormaJS]', ...args);
  }
}

interface RuntimeDiagnostic {
  kind: 'handler-unsupported' | 'expression-unsupported' | 'grant-denied' | 'markup-refused';
  expr: string;
  reason: string;
  /** Stable machine-readable cause, e.g. `FORMA_E_METHOD_DENIED`. */
  code: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Under a tiered mount (FORMA-128): the mount's name and tier. */
  mount?: string;
  tier?: MountTier;
  /** For `grant-denied`: the grant the mount did not give. */
  grant?: 'fetch' | ExprGrant;
}

const diagnostics = new Map<string, RuntimeDiagnostic>();

/**
 * Record a diagnostic, and the first time it is seen log it and dispatch it as
 * `formajs:diagnostic` on `window`.
 *
 * Under a tiered mount the mount's own `diagnostics` setting decides, never the
 * page's (its configuration comes only from its call), and a denied grant is
 * reported whatever either says (SR37's runtime half): its detail carries the
 * code, the grant, and the mount's name and tier, and it is counted per mount,
 * so two mounts denied the same thing are two diagnostics.
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a seeded denial raises one coded diagnostic, whatever the page's diagnostics switch says"
 */
function reportDiagnostic(
  kind: RuntimeDiagnostic['kind'],
  expr: string,
  reason: string,
  code = 'FORMA_E_UNSUPPORTED',
  mount?: MountCtx | null,
  grant?: RuntimeDiagnostic['grant'],
): void {
  if (kind !== 'grant-denied' && kind !== 'markup-refused' && mount?.diagnostics === false) return;

  const key = mount ? `${kind}|${mount.id}|${reason}|${expr}` : `${kind}|${reason}|${expr}`;
  const now = Date.now();
  const existing = diagnostics.get(key);

  if (existing) {
    // Seen before: count it and say nothing. A 1,000-row list sharing one
    // denied expression must not produce 1,000 console lines or 1,000
    // CustomEvents — the running total is on the record, for anyone who wants
    // it, via getDiagnostics().
    existing.count += 1;
    existing.lastSeenAt = now;
    return;
  }

  const detail: Omit<RuntimeDiagnostic, 'firstSeenAt' | 'lastSeenAt'> = { kind, expr, reason, code, count: 1 };
  if (mount) {
    detail.mount = mount.name;
    detail.tier = mount.tier;
  }
  if (grant) detail.grant = grant;
  diagnostics.set(key, { ...detail, firstSeenAt: now, lastSeenAt: now });
  console.warn(`[FormaJS] ${reason}: ${expr}`);

  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('formajs:diagnostic', { detail: { ...detail } }));
    }
  } catch {
    // Ignore event dispatch failures
  }
}

/** The removed A2 opt-out can only produce a development migration warning. */
function warnManualMountRemoved(): void {
  if (typeof document === 'undefined') return;
  const own = document.currentScript as HTMLScriptElement | null;
  if (own?.getAttribute('data-forma-mount') === 'manual'
    || document.querySelector('[data-forma-mount="manual"]')) {
    warnDeprecated('FORMA_W_MANUAL_MOUNT_REMOVED');
  }
}
if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
  || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && sourceIsDev())) {
  warnManualMountRemoved();
}

// ── Mount boundaries ──
//
// What a tiered mount (FORMA-128; decision brief DR-14, DR-15, L-36, L-47)
// carries to every binding under its root: its tier, its grants, the
// configuration its call gave, its own `$refetch` registry and, in a
// development build, the grants it has used. The call itself is the last
// section of this file, "Tiered mount".

/**
 * DR-14's three tiers. `compiled`: markup the application's own build made.
 * `reviewed`: a directive widget the application reviewed and admitted, on its
 * origin, with the grants its reviewer wrote. `unreviewed`: content nobody
 * reviewed, which mounts only in an opaque-origin document (the preview frame)
 * and with no grants. Which tier a mount uses is the application's decision.
 */
export type MountTier = 'compiled' | 'reviewed' | 'unreviewed';

/** The methods `data-fetch` sends. */
export type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const FETCH_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** What a mount's `data-fetch` may send. */
export interface FetchGrant {
  /** Methods it may send. Default: `['GET']`. */
  readonly methods?: readonly FetchMethod[];
  /**
   * Where it may send them: path prefixes on the page's own origin
   * (`'/api/widgets/'`), or absolute `http(s):` prefixes on another
   * (`'https://api.example.com/v1/'`). A prefix without a trailing slash
   * matches that path and the paths below it, never a sibling that merely
   * starts with the same characters.
   */
  readonly paths: readonly string[];
  /** Whether the user's cookies go with a same-origin request. Default: false. */
  readonly cookies?: boolean;
  /** Abort a request after this many milliseconds: at most, and by default, 30,000. */
  readonly timeoutMs?: number;
}

/**
 * A mount's grants (DR-15). A grant absent from the object is not given;
 * an absent object also grants nothing (FORMA-108).
 */
export interface MountGrants {
  /** `data-fetch`. */
  readonly fetch?: FetchGrant;
  /** The page beyond the mount root: elements outside it, and selectors that ask about them. */
  readonly dom?: boolean;
  /** `click()`, which can follow a link or submit a form in the user's session. */
  readonly navigate?: boolean;
}

/** A mount's configuration. It comes only from its call: no script tag or global reaches it. */
export interface MountConfig {
  /** How diagnostics and the grant report name the mount. Default: `#<root id>`, else `mount-<n>`. */
  readonly name?: string;
  /** The interpreter's step budget per task for this mount. Default: 100,000. */
  readonly exprBudget?: number;
  /** Expression diagnostics; a denied grant is reported regardless. Default: true. */
  readonly diagnostics?: boolean;
  /** CSS containment hints on `[data-forma-contain]` elements under the root. Default: false. */
  readonly autoContainment?: boolean;
}

/** The third argument of `mountMarkup()`. */
export interface MountOptions {
  readonly tier: MountTier;
  readonly grants?: MountGrants;
  readonly config?: MountConfig;
}

/**
 * The grants a mount has used, written as grants, so a reviewer can approve
 * one as the widget's grant set (DR-15, L-36). Only the grants used appear; a
 * `fetch` lists the methods and exact paths it sent and whether the user's
 * cookies went with a request.
 */
export interface GrantReport {
  fetch?: { methods: FetchMethod[]; paths: string[]; cookies: boolean };
  dom?: true;
  navigate?: true;
}

/** What `mountMarkup()` returns. */
export interface MountHandle {
  readonly root: Element;
  readonly tier: MountTier;
  readonly name: string;
  /** Render new markup into the root: reconciled, so scopes whose shape is unchanged keep their state. */
  update(markup: TrustedHtml): void;
  /** Dispose every binding of the mount and empty its root. */
  unmount(): void;
  /** Development builds: the grants used so far. Production builds: `null`. */
  grantsUsed(): GrantReport | null;
}

/** One `fetch` grant prefix: on the page's own origin (`origin` null) or on another. */
interface FetchPrefix {
  origin: string | null;
  path: string;
}

/** A mount's `fetch` grant, resolved. */
interface FetchRule {
  methods: ReadonlySet<string>;
  prefixes: readonly FetchPrefix[];
  cookies: boolean;
  timeoutMs: number;
}

/** The grants a mount used, kept in development builds only. */
interface UsedGrants {
  methods: Set<string>;
  paths: Set<string>;
  cookies: boolean;
  dom: boolean;
  navigate: boolean;
}

interface MountCtx {
  /** Unique per mount, for counting diagnostics per mount. */
  id: number;
  root: Element;
  tier: MountTier;
  name: string;
  /** Null: no `fetch` grant. */
  fetch: FetchRule | null;
  budget: number;
  diagnostics: boolean;
  containment: boolean;
  /** What the interpreter checks on every element hop and grant-needing call. */
  bound: Bound;
  refetch: Map<string, () => void>;
  /** Actual binding ownership survives movement or removal from the DOM. */
  scopes: Set<Element>;
  /** Development builds only. */
  used: UsedGrants | null;
}

/** A mount call's misuse: thrown at the call, with a stable code. */
function mountError(code: string, message: string): Error {
  const err = new TypeError(`[forma] ${code}: ${message}`) as TypeError & { code: string };
  err.code = code;
  return err;
}

/**
 * Every explicit mount, by its root. A mount binds and disposes only its own
 * scopes; nested mounts retain their own grants and lifecycle handles.
 * Verified by: src/__tests__/runtime-explicit-mount.test.ts > "import, DOMContentLoaded, injected nodes and state-attribute changes never bind without a handed root"
 */
const tieredRoots = new WeakMap<Node, MountCtx>();
let tieredCount = 0;
let mountSeq = 0;

/** The tiered mount whose root is `node` or its nearest such ancestor, across shadow roots; null for none. */
function ownerOf(node: Node | null): MountCtx | null {
  if (tieredCount === 0) return null;
  for (let n = node; n; n = n.parentNode ?? (n.nodeType === 11 ? (n as ShadowRoot).host ?? null : null)) {
    const ctx = tieredRoots.get(n);
    if (ctx) return ctx;
  }
  return null;
}

/** Whether a tiered root lies between `el` (inclusive) and `top` (exclusive): `el` belongs to a mount nested inside. */
function ownedBelow(el: Element, top: Element): boolean {
  if (tieredCount === 0) return false;
  for (let n: Node | null = el; n && n !== top; n = n.parentNode) {
    if (tieredRoots.has(n)) return true;
  }
  return false;
}

/** A path prefix or absolute URL prefix from a `fetch` grant, or a mount error. */
function parsePrefix(raw: unknown): FetchPrefix {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) {
    return { origin: null, path: raw };
  }
  if (typeof raw === 'string' && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return { origin: u.origin, path: u.pathname };
    } catch { /* reported below */ }
  }
  throw mountError('FORMA_E_MOUNT_ARGS', `fetch.paths: ${String(raw)}`);
}

/** Resolve the grants a mount call names, after checking their shape. */
function resolveGrants(tier: MountTier, grants: MountGrants | undefined): { fetch: FetchRule | null; dom: boolean; navigate: boolean } {
  if (tier === 'unreviewed') {
    if (grants !== undefined) {
      throw mountError('FORMA_E_MOUNT_ARGS', 'an unreviewed mount takes no grants');
    }
    return { fetch: null, dom: false, navigate: false };
  }
  if (grants === undefined) return { fetch: null, dom: false, navigate: false };
  if (typeof grants !== 'object' || grants === null) {
    throw mountError('FORMA_E_MOUNT_ARGS', 'grants must be an object');
  }
  let fetchRule: FetchRule | null = null;
  const f = grants.fetch;
  if (f !== undefined) {
    if (typeof f !== 'object' || f === null || !Array.isArray(f.paths)) {
      throw mountError('FORMA_E_MOUNT_ARGS', 'a fetch grant needs paths');
    }
    const methods = f.methods ?? ['GET'];
    for (const m of methods) {
      if (!FETCH_METHODS.has(m)) throw mountError('FORMA_E_MOUNT_ARGS', `fetch.methods: ${String(m)}`);
    }
    const timeoutMs = f.timeoutMs ?? FETCH_TIMEOUT_MS;
    if (!(typeof timeoutMs === 'number' && timeoutMs > 0 && timeoutMs <= FETCH_TIMEOUT_MS)) {
      throw mountError('FORMA_E_MOUNT_ARGS', `fetch.timeoutMs: 1 to ${FETCH_TIMEOUT_MS}`);
    }
    fetchRule = {
      methods: new Set(methods),
      prefixes: f.paths.map(parsePrefix),
      cookies: f.cookies === true,
      timeoutMs,
    };
  }
  return { fetch: fetchRule, dom: grants.dom === true, navigate: grants.navigate === true };
}

/** Whether `path` is `prefix` or lies below it. */
function underPrefix(path: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return path.startsWith(prefix);
  return path === prefix || path.startsWith(prefix + '/');
}

/** How one `data-fetch` of a tiered mount may be sent, or why it may not. */
type FetchVerdict =
  | { ok: true; credentials: RequestCredentials; timeoutMs: number; path: string; cookies: boolean }
  | { ok: false; reason: string };

/**
 * Check one `data-fetch` against its mount's `fetch` grant (DR-15). The URL is
 * resolved against the document and normalised by the URL parser first, so
 * `/api/widgets/../admin` is checked as `/admin`; a path that hides a slash or
 * a backslash in an escape (`%2F`, `%5C`) is refused, since a server may
 * decode it into a segment the prefix did not grant.
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a fetch grant admits only its methods and path prefixes: %j %s"
 */
function fetchVerdict(rule: FetchRule | null, method: string, raw: string): FetchVerdict {
  if (!rule) return { ok: false, reason: 'the mount grants no fetch' };
  let url: URL | null = null;
  try {
    url = new URL(raw, document.baseURI);
  } catch {
    url = null;
  }
  const sameOrigin = url !== null && url.origin === location.origin;
  const path = url === null ? raw : sameOrigin ? url.pathname : url.origin + url.pathname;
  if (!rule.methods.has(method)) return { ok: false, reason: `the fetch grant does not allow ${method}` };
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return { ok: false, reason: `the fetch grant does not cover ${raw}` };
  }
  if (/%2f|%5c|\\/i.test(url.pathname)) {
    return { ok: false, reason: `the path of ${raw} hides a separator in an escape` };
  }
  const covered = rule.prefixes.some((p) => (p.origin === null ? sameOrigin : url!.origin === p.origin) && underPrefix(url!.pathname, p.path));
  if (!covered) return { ok: false, reason: `the fetch grant does not cover ${path}` };
  const cookies = rule.cookies && sameOrigin;
  return { ok: true, credentials: rule.cookies ? 'same-origin' : 'omit', timeoutMs: rule.timeoutMs, path, cookies };
}

/** The development report, written as grants. */
function grantReport(used: UsedGrants): GrantReport {
  const report: GrantReport = {};
  if (used.methods.size > 0) {
    report.fetch = {
      methods: [...used.methods].sort() as FetchMethod[],
      paths: [...used.paths].sort(),
      cookies: used.cookies,
    };
  }
  if (used.dom) report.dom = true;
  if (used.navigate) report.navigate = true;
  return report;
}

const noUse = (): void => {};

// ── Performance utilities ──

interface SchedulerLike {
  yield?: () => Promise<unknown>;
  postTask?: (
    callback: () => void,
    options?: { priority?: 'user-blocking' | 'user-visible' | 'background' },
  ) => Promise<unknown>;
}

function getScheduler(): SchedulerLike | undefined {
  const candidate = (globalThis as any)?.scheduler as SchedulerLike | undefined;
  if (!candidate) return undefined;
  if (typeof candidate.yield === 'function' || typeof candidate.postTask === 'function') {
    return candidate;
  }
  return undefined;
}

/** Yield control to keep the main thread responsive during large batches. */
async function yieldToMain(): Promise<void> {
  const scheduler = getScheduler();
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  if (scheduler?.postTask) {
    await scheduler.postTask(() => {}, { priority: 'background' });
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

interface ContainmentHintsOptions {
  selector?: string;
  contain?: string;
  contentVisibility?: string;
  containIntrinsicSize?: string;
  skipIfAlreadySet?: boolean;
}

/** Apply CSS containment hints to opt-in containers for lower layout/paint cost. */
function applyContainmentHints(
  root: ParentNode = document,
  options: ContainmentHintsOptions = {},
): number {
  const selector = options.selector ?? '[data-forma-contain]';
  if (!selector) return 0;
  if (typeof (root as ParentNode).querySelectorAll !== 'function') return 0;

  const nodes = root.querySelectorAll(selector);
  let applied = 0;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (!el?.style) continue;

    const contain = el.getAttribute('data-forma-contain') ?? options.contain ?? 'layout style paint';
    const contentVisibility = el.getAttribute('data-forma-content-visibility')
      ?? options.contentVisibility
      ?? 'auto';
    const containIntrinsicSize = el.getAttribute('data-forma-contain-intrinsic-size')
      ?? options.containIntrinsicSize
      ?? 'auto 800px';
    const skipExisting = options.skipIfAlreadySet === true;
    let changed = false;

    const containCurrent = el.style.getPropertyValue('contain');
    const contentVisCurrent = el.style.getPropertyValue('content-visibility');
    const containSizeCurrent = el.style.getPropertyValue('contain-intrinsic-size');

    if (contain !== 'off' && (!skipExisting || !containCurrent)) {
      el.style.setProperty('contain', contain);
      changed = true;
    }
    if (contentVisibility !== 'off' && (!skipExisting || !contentVisCurrent)) {
      el.style.setProperty('content-visibility', contentVisibility);
      changed = true;
    }
    if (containIntrinsicSize !== 'off' && (!skipExisting || !containSizeCurrent)) {
      el.style.setProperty('contain-intrinsic-size', containIntrinsicSize);
      changed = true;
    }

    if (changed) applied++;
  }

  if (_debug && applied > 0) {
    dbg('applyContainmentHints: applied to', applied, 'element(s)');
  }
  return applied;
}

// ── Pre-compiled regexes (avoid re-creation in hot paths) ──

const RE_STRIP_BRACES = /^\{|\}$/g;
// RE_UNQUOTED_KEYS removed in v0.5.0 — relaxed JSON parsing corrupted URLs
// and string values containing colons. Use valid JSON in data-forma-state.
const RE_COMPUTED = /^(\w+)\s*=\s*(.+)$/;
const RE_FETCH = /^(.+?)(?:→|->)\s*(\S+)(.*)$/;
const RE_FETCH_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i;
const RE_STRIP_ITEM_BRACES = /^\{item\.?|\}$/g;

interface TransitionSpec {
  enter: string[];
  enterFrom: string[];
  enterTo: string[];
  leave: string[];
  leaveFrom: string[];
  leaveTo: string[];
  enterDurationMs?: number;
  leaveDurationMs?: number;
}

interface ElementTransitionState {
  token: number;
  cancel: (() => void) | null;
}

const TRANSITION_STATE_SYM = Symbol.for('forma-transition-state');

// ── Per-scope evaluator cache ──
interface HandlerBuildResult {
  handler: (e: Event) => void;
  supported: boolean;
}

// Compiling an expression is scope-independent (src/expr caches the AST by
// source text), but the CLOSURE that binds it to a scope is not, so it is
// memoised per scope — one entry per (scope, expression) instead of one per
// (scope, expression, evaluation).
/** A compiled expression bound to a scope; `text` prices what the caller will convert. */
type Evaluate = (text?: TextCost) => unknown;
const scopeExpressionCache = new WeakMap<Scope, Map<string, Evaluate>>();
const scopeHandlerCache = new WeakMap<Scope, Map<string, HandlerBuildResult>>();

// ── Compiled template cache ──
// Pre-splits template text into static/dynamic segments for fast re-evaluation.
interface CompiledTemplate {
  statics: string[];
  dynamics: string[]; // expression strings between {item.xxx}
  hasItemRef: boolean;
}

const compiledTemplateCache = new Map<string, CompiledTemplate>();
const COMPILED_TEMPLATE_CACHE_MAX = 2048;
function cacheCompiledTemplate(key: string, template: CompiledTemplate): void {
  if (compiledTemplateCache.size >= COMPILED_TEMPLATE_CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const first = compiledTemplateCache.keys().next().value;
    if (first !== undefined) compiledTemplateCache.delete(first);
  }
  compiledTemplateCache.set(key, template);
}
const TEXT_BINDING_SYM = Symbol.for('forma-text-binding-cache');

interface TextBindingCache {
  initialized: boolean;
  last: string;
  node: Text | null;
}

function toTextValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'symbol') return value.toString();
  return String(value);
}

function setElementTextFast(el: Element, next: string): void {
  let cache = (el as any)[TEXT_BINDING_SYM] as TextBindingCache | undefined;
  if (!cache) {
    cache = { initialized: false, last: '', node: null };
    (el as any)[TEXT_BINDING_SYM] = cache;
  }

  if (cache.initialized && cache.last === next) return;

  // Reuse direct text-node writes when this element is a single text child.
  let node = cache.node;
  if (!node || node.parentNode !== el || el.childNodes.length !== 1 || el.firstChild !== node) {
    if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) {
      node = el.firstChild as Text;
      cache.node = node;
    } else {
      el.textContent = next;
      const first = el.firstChild;
      cache.node = (first && first.nodeType === Node.TEXT_NODE && el.childNodes.length === 1)
        ? (first as Text)
        : null;
      cache.last = next;
      cache.initialized = true;
      return;
    }
  }

  node.data = next;
  cache.last = next;
  cache.initialized = true;
}

// ── Parsing utilities ──

function readBalancedSegment(
  input: string,
  start: number,
  open: string,
  close: string,
): { inner: string; end: number } | null {
  if (input[start] !== open) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escaped = true;
      continue;
    }

    if (inSingle) {
      if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === open) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return {
          inner: input.slice(start + 1, i),
          end: i,
        };
      }
    }
  }

  return null;
}

function compileTemplate(text: string): CompiledTemplate {
  const cached = compiledTemplateCache.get(text);
  if (cached) return cached;

  const statics: string[] = [];
  const dynamics: string[] = [];
  let lastIndex = 0;
  // Use a fresh regex each time since it has the 'g' flag
  const re = /\{item\.?(\w*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    statics.push(text.slice(lastIndex, m.index));
    dynamics.push(m[1]!); // the key after "item." (empty string means whole item)
    lastIndex = re.lastIndex;
  }
  statics.push(text.slice(lastIndex));

  const result: CompiledTemplate = {
    statics,
    dynamics,
    hasItemRef: dynamics.length > 0,
  };
  cacheCompiledTemplate(text, result);
  return result;
}

// ── Template text caching for data-list ──

/** Maps text nodes to their compiled template (pre-split static/dynamic segments). */
const templateTexts = new WeakMap<Node, CompiledTemplate>();

/**
 * Evaluate a pre-compiled template against an item.
 * Only evaluates dynamic parts and concatenates with static segments.
 */
function evaluateCompiledTemplate(compiled: CompiledTemplate, item: unknown): string {
  if (!compiled.hasItemRef) return compiled.statics[0]!;
  let result = compiled.statics[0]!;
  for (let i = 0; i < compiled.dynamics.length; i++) {
    const key = compiled.dynamics[i]!;
    if (!key) {
      result += typeof item === 'object' ? JSON.stringify(item) : String(item ?? '');
    } else {
      result += String((item as Record<string, unknown>)?.[key] ?? '');
    }
    result += compiled.statics[i + 1] ?? '';
  }
  return result;
}

/**
 * Clone a template element and apply item data to all text node placeholders.
 * Stores the original template text in a WeakMap so updates can re-apply without re-cloning.
 */
function cloneWithTemplateData(template: Element, item: unknown, mount: MountCtx): Element {
  const clone = template.cloneNode(true) as Element;
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? '';
    if (text.includes('{item')) {
      const compiled = compileTemplate(text);
      templateTexts.set(node, compiled); // Store compiled template
      node.textContent = evaluateCompiledTemplate(compiled, item);
    }
  }
  // Also process attributes (e.g. data-key, href, src, etc.)
  cloneAttributeTemplates(clone, item, mount);
  return clone;
}

/**
 * Update an existing cloned element's text and safe attributes with new item data.
 * Uses the cached original template patterns from the WeakMap.
 */
function updateTemplateData(el: Element, item: unknown): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const compiled = templateTexts.get(node);
    if (compiled) {
      node.textContent = evaluateCompiledTemplate(compiled, item);
    }
  }
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const { attr, compiled } of templateAttrs.get(node) ?? []) {
      applyTemplateAttribute(node, attr, compiled, item);
    }
  }
}

/** WeakMap for caching compiled attribute templates */
const templateAttrs = new WeakMap<Element, Array<{ attr: string; compiled: CompiledTemplate }>>();
const RUNTIME_SRCDOC_REASON = `${RUNTIME_SRCDOC_CODE}: srcdoc is refused; use h() with trustedHtml()`;

/**
 * Process attribute templates on a cloned element and its descendants.
 * Pre-compiles patterns and resolves them with item data.
 */
/** Directive attribute names/prefixes that bindElement processes — these must NOT be
 *  template-interpolated by cloneAttributeTemplates because their values will be
 *  evaluated by the reactive binding system using the child scope. */
const DIRECTIVE_ATTR_PREFIXES = [
  'data-list', 'data-show', 'data-text', 'data-if', 'data-model',
  'data-on:', 'data-class:', 'data-bind:', 'data-computed', 'data-persist', 'data-fetch',
  'data-transition', 'data-transition:',
];
function isDirectiveAttr(name: string): boolean {
  for (const prefix of DIRECTIVE_ATTR_PREFIXES) {
    if (name === prefix || name.startsWith(prefix)) return true;
  }
  return false;
}

function splitClassTokens(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── CSS Transitions ──

function parseDurationTokenMs(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t.endsWith('ms')) {
    const n = Number(t.slice(0, -2));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (t.endsWith('s')) {
    const n = Number(t.slice(0, -1));
    return Number.isFinite(n) && n >= 0 ? n * 1000 : null;
  }
  return null;
}

function parseClassTokensAndDuration(raw: string | null): { classes: string[]; durationMs?: number } {
  const classes: string[] = [];
  let durationMs: number | undefined;
  for (const token of splitClassTokens(raw)) {
    const parsed = parseDurationTokenMs(token);
    if (parsed != null) {
      durationMs = parsed;
    } else {
      classes.push(token);
    }
  }
  return { classes, durationMs };
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter(Boolean)));
}

function parseCssTimeListMs(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => parseDurationTokenMs(part.trim()))
    .filter((ms): ms is number => ms != null);
}

function maxCombinedTimingsMs(durations: number[], delays: number[]): number {
  if (durations.length === 0 && delays.length === 0) return 0;
  if (durations.length === 0) return Math.max(...delays, 0);
  if (delays.length === 0) return Math.max(...durations, 0);

  const len = Math.max(durations.length, delays.length);
  let max = 0;
  for (let i = 0; i < len; i++) {
    const d = durations[i % durations.length] ?? 0;
    const delay = delays[i % delays.length] ?? 0;
    if (d + delay > max) max = d + delay;
  }
  return max;
}

function resolveTransitionDurationMs(el: HTMLElement, explicitMs?: number): number {
  if (typeof explicitMs === 'number') return explicitMs;
  const cs = window.getComputedStyle(el);
  const trans = maxCombinedTimingsMs(
    parseCssTimeListMs(cs.transitionDuration),
    parseCssTimeListMs(cs.transitionDelay),
  );
  const anim = maxCombinedTimingsMs(
    parseCssTimeListMs(cs.animationDuration),
    parseCssTimeListMs(cs.animationDelay),
  );
  return Math.max(trans, anim);
}

function getTransitionState(el: HTMLElement): ElementTransitionState {
  const existing = (el as any)[TRANSITION_STATE_SYM] as ElementTransitionState | undefined;
  if (existing) return existing;
  const created: ElementTransitionState = { token: 0, cancel: null };
  (el as any)[TRANSITION_STATE_SYM] = created;
  return created;
}

function clearTransitionState(el: HTMLElement): void {
  const state = (el as any)[TRANSITION_STATE_SYM] as ElementTransitionState | undefined;
  if (state?.cancel) {
    state.cancel();
  }
  delete (el as any)[TRANSITION_STATE_SYM];
}

function parseTransitionSpec(el: Element): TransitionSpec | null {
  const hasTransitionAttr = el.hasAttribute('data-transition')
    || Array.from(el.attributes).some((a) => a.name.startsWith('data-transition:'));
  if (!hasTransitionAttr) return null;

  const base = parseClassTokensAndDuration(el.getAttribute('data-transition')).classes;

  const enter = parseClassTokensAndDuration(el.getAttribute('data-transition:enter'));
  const leave = parseClassTokensAndDuration(el.getAttribute('data-transition:leave'));
  const enterFrom = splitClassTokens(
    el.getAttribute('data-transition:enter-from')
    ?? el.getAttribute('data-transition:enter-start'),
  );
  const enterTo = splitClassTokens(
    el.getAttribute('data-transition:enter-to')
    ?? el.getAttribute('data-transition:enter-end'),
  );
  const leaveFrom = splitClassTokens(
    el.getAttribute('data-transition:leave-from')
    ?? el.getAttribute('data-transition:leave-start'),
  );
  const leaveTo = splitClassTokens(
    el.getAttribute('data-transition:leave-to')
    ?? el.getAttribute('data-transition:leave-end'),
  );

  const durationBoth = parseDurationTokenMs(el.getAttribute('data-transition:duration') ?? '');
  const enterDuration = parseDurationTokenMs(el.getAttribute('data-transition:duration-enter') ?? '')
    ?? enter.durationMs
    ?? durationBoth
    ?? undefined;
  const leaveDuration = parseDurationTokenMs(el.getAttribute('data-transition:duration-leave') ?? '')
    ?? leave.durationMs
    ?? durationBoth
    ?? undefined;

  return {
    enter: uniqueTokens([...base, ...enter.classes]),
    enterFrom: uniqueTokens(enterFrom),
    enterTo: uniqueTokens(enterTo),
    leave: uniqueTokens([...base, ...leave.classes]),
    leaveFrom: uniqueTokens(leaveFrom),
    leaveTo: uniqueTokens(leaveTo),
    enterDurationMs: enterDuration,
    leaveDurationMs: leaveDuration,
  };
}

function removeClasses(el: Element, classes: string[]): void {
  for (const cls of classes) {
    el.classList.remove(cls);
  }
}

function addClasses(el: Element, classes: string[]): void {
  for (const cls of classes) {
    el.classList.add(cls);
  }
}

function runTransitionPhase(
  el: HTMLElement,
  phaseClasses: { base: string[]; from: string[]; to: string[]; durationMs?: number },
  onDone: () => void,
): () => void {
  const cleanupClasses = uniqueTokens([
    ...phaseClasses.base,
    ...phaseClasses.from,
    ...phaseClasses.to,
  ]);

  let done = false;
  let timeoutId: number | null = null;
  let raf1: number | null = null;
  let raf2: number | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (timeoutId != null) window.clearTimeout(timeoutId);
    if (raf1 != null) cancelAnimationFrame(raf1);
    if (raf2 != null) cancelAnimationFrame(raf2);
    removeClasses(el, cleanupClasses);
    onDone();
  };

  addClasses(el, phaseClasses.base);
  addClasses(el, phaseClasses.from);
  removeClasses(el, phaseClasses.to);

  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => {
      if (done) return;
      removeClasses(el, phaseClasses.from);
      addClasses(el, phaseClasses.to);

      const ms = resolveTransitionDurationMs(el, phaseClasses.durationMs);
      if (ms <= 0) {
        finish();
        return;
      }
      timeoutId = window.setTimeout(finish, ms + 25);
    });
  });

  return finish;
}

/**
 * Insert an element into the DOM and optionally run an enter transition.
 * The element is functional immediately — the animation is purely visual.
 */
function transitionInsert(
  el: HTMLElement,
  parent: Node,
  ref: Node | null,
  spec: TransitionSpec | null,
): void {
  parent.insertBefore(el, ref);
  if (!spec) return;

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();

  state.cancel = runTransitionPhase(
    el,
    {
      base: spec.enter,
      from: spec.enterFrom,
      to: spec.enterTo,
      durationMs: spec.enterDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token === token) current.cancel = null;
    },
  );
}

/**
 * Run a leave transition on an element, then call onDone when complete.
 * Sets data-forma-leaving immediately so the element is excluded from diffs.
 * If no transition spec, calls onDone synchronously.
 */
function transitionRemove(
  el: HTMLElement,
  spec: TransitionSpec | null,
  onDone: () => void,
): void {
  // Guard: if already leaving, don't start another leave
  if (el.hasAttribute('data-forma-leaving')) {
    onDone();
    return;
  }

  if (!spec) {
    onDone();
    return;
  }

  el.setAttribute('data-forma-leaving', '');

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();

  state.cancel = runTransitionPhase(
    el,
    {
      base: spec.leave,
      from: spec.leaveFrom,
      to: spec.leaveTo,
      durationMs: spec.leaveDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token === token) current.cancel = null;
      el.removeAttribute('data-forma-leaving');
      onDone();
    },
  );
}

function applyShowVisibility(
  el: HTMLElement,
  visible: boolean,
  transition: TransitionSpec | null,
  initial: boolean,
): void {
  if (!transition || initial) {
    el.style.display = visible ? '' : 'none';
    if (transition) {
      removeClasses(el, uniqueTokens([
        ...transition.enter, ...transition.enterFrom, ...transition.enterTo,
        ...transition.leave, ...transition.leaveFrom, ...transition.leaveTo,
      ]));
    }
    return;
  }

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();
  state.cancel = null;

  if (visible) {
    el.style.display = '';
    state.cancel = runTransitionPhase(
      el,
      {
        base: transition.enter,
        from: transition.enterFrom,
        to: transition.enterTo,
        durationMs: transition.enterDurationMs,
      },
      () => {
        const current = getTransitionState(el);
        if (current.token === token) current.cancel = null;
      },
    );
    return;
  }

  state.cancel = runTransitionPhase(
    el,
    {
      base: transition.leave,
      from: transition.leaveFrom,
      to: transition.leaveTo,
      durationMs: transition.leaveDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token !== token) return;
      el.style.display = 'none';
      current.cancel = null;
    },
  );
}

function applyTemplateAttribute(node: Element, attr: string, compiled: CompiledTemplate, item: unknown): void {
  const value = evaluateCompiledTemplate(compiled, item);
  if (isUnsafeAttrBinding(attr, value, node.tagName.toLowerCase())) {
    node.removeAttribute(attr);
  } else {
    node.setAttribute(attr, value);
  }
}

function cloneAttributeTemplates(el: Element, item: unknown, mount?: MountCtx): void {
  const all = [el, ...Array.from(el.querySelectorAll('*'))];
  for (const node of all) {
    const entries: Array<{ attr: string; compiled: CompiledTemplate }> = [];
    for (const attr of Array.from(node.attributes)) {
      // Skip directive attributes — they'll be evaluated by bindElement with the child scope
      if (isDirectiveAttr(attr.name)) continue;
      if (attr.value.includes('{item')) {
        if (isRawHtmlAttr(attr.name)) {
          reportDiagnostic('markup-refused', `row ${attr.name}="${attr.value}"`,
            RUNTIME_SRCDOC_REASON, RUNTIME_SRCDOC_CODE, mount);
          node.removeAttribute(attr.name);
          continue;
        }
        const compiled = compileTemplate(attr.value);
        entries.push({ attr: attr.name, compiled });
        applyTemplateAttribute(node, attr.name, compiled, item);
      }
    }
    if (entries.length > 0) {
      templateAttrs.set(node, entries);
    }
  }
}

// ── Expression evaluator ──

function getScopeCache<T>(cache: WeakMap<Scope, Map<string, T>>, scope: Scope): Map<string, T> {
  let scoped = cache.get(scope);
  if (!scoped) {
    scoped = new Map<string, T>();
    cache.set(scope, scoped);
  }
  return scoped;
}

/**
 * Sentinel returned by a binding whose expression did not evaluate. It is a
 * unique symbol precisely so it cannot be confused with a legitimate
 * `undefined` — the whole failure model rests on those being distinguishable
 * (R1). Every directive checks for it and leaves the DOM alone.
 * Verified by: src/__tests__/failure-semantics.test.ts > "a denied expression leaves the previous text in place and never renders undefined"
 */
const EXPR_FAILED = Symbol('forma-expression-failed');

/**
 * THE TASK'S BUDGET (FORMA-028). Every binding evaluated in one task counts on
 * from what the evaluations before it in that task spent, so the step and
 * allocation budgets bound a task, not each binding in it: ten bindings at the
 * cap in one widget ran 382 ms in one task when each had its own.
 *
 * A binding refused only because earlier work in its task spent the budget is
 * not reported: it re-runs in the next task, where it starts first (`later`).
 * One that is over the budget on its own, in a task it started, is reported
 * as before. The meter is zeroed by a timer armed when a task first spends
 * from it, and when an event it has not seen reaches a handler or a
 * `data-model` input (`begin`).
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "ten bindings at the cap spend one budget per task and all of them render"
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a binding over the budget on its own is reported, not retried"
 */
const meter: Required<Meter> = { steps: 0, cost: 0, cap: Infinity, lost: 0 };
let meterEvent: Event | null = null;
let armed = false;
let deferred = false;
const [retries, setRetries] = createSignal(0);
/** Computeds to evaluate first, at the top of the next task, before their readers. */
const staleCells = new Set<() => unknown>();

/**
 * An event the runtime has not seen starts a task: the meter is zeroed, as the
 * timer would have, in case the event ran first (input is scheduled ahead of
 * timers). Handlers, and `data-model` writes, run under it. An event
 * dispatched from inside an evaluation (`$dispatch`, `$el.click()`) is part
 * of that evaluation's task: the meter, and the cap a wait set, are kept.
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a binding a keystroke updates starts on a fresh budget"
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a $dispatch from inside a binding keeps the task's cap"
 */
function begin(e: Event): void {
  if (e !== meterEvent && !running()) {
    meter.steps = meter.cost = meter.lost = 0;
    meter.cap = Infinity;
    meterEvent = e;
  }
  spend();
}

/** Arm the timer that zeroes the meter once this task is over. */
function spend(): void {
  if (!armed) {
    armed = true;
    setTimeout(nextTask);
  }
}

function nextTask(): void {
  armed = false;
  meter.steps = meter.cost = meter.lost = 0;
  meter.cap = Infinity;
  meterEvent = null;
  if (!deferred) return;
  deferred = false;
  const cells = [...staleCells];
  staleCells.clear();
  batch(() => {
    setRetries((n) => n + 1);
    for (const cell of cells) cell();
  });
}

/**
 * What the charges refused while capped may count in all in one task. The cap
 * bounds what each binding after a wait counts; this bounds them together:
 * once they pass it the cap drops to 0, and every later charge in the task is
 * refused at once (a list on its length alone), so a light binding that
 * charges anything waits a tick too. The refusals after a wait then count at
 * most this and one cap, however many bindings wait: without it, 400 bindings
 * each a little over the cap counted 10,000 units apiece, a 71 ms task at 4x
 * (FORMA-173 review, H1).
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "the cap drops to 0 once the task's refusals have counted the allowance"
 */
const WAITING_ALLOWANCE = 50_000;

/**
 * Cap each charge the rest of this task counts (`WAITING_CAP`, or 0 once the
 * refusals have counted `WAITING_ALLOWANCE`). Armed by a binding that has to
 * wait, and by a reported budget refusal: bindings each too heavy for any
 * task were each weighed to the whole budget in one task, 20 of them 53 ms at
 * 4x and 40 about 99 ms (FORMA-178, from FORMA-173's final review). A
 * reported refusal counts toward the allowance as a wait does (`charge`), and
 * the bindings after it are priced only to the cap: one that is too heavy for
 * any task waits, is weighed in full once in a task where it runs first, and
 * is reported there. They are reported one to a task, not all at once.
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "bindings each too heavy for any task are reported one to a task, each weighed in full once"
 */
function armCap(): void {
  meter.cap = Math.min(meter.cap, meter.lost > WAITING_ALLOWANCE ? 0 : WAITING_CAP);
}

/** A budget refusal that is reported, not retried: it arms the cap as a wait does (`armCap`). */
function reported(err: FormaExprError): void {
  if (err.code === 'FORMA_E_BUDGET') armCap();
}

/**
 * Re-run the binding (or computed) being evaluated in the next task, and cap
 * each charge the rest of this task counts (`armCap`).
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "bindings that each weigh most of the budget are refused cheaply while they wait"
 */
function later(): void {
  retries();
  deferred = true;
  armCap();
  spend();
}

/**
 * What the runtime's own conversion of a result to text builds (FORMA-025):
 * `String()` of an array or object joins every element, so a list of a
 * thousand references to one long string is three hundred million
 * characters. A string is written as it is; a host value renders as a label.
 * Verified by: src/__tests__/runtime-text-cost.test.ts > "data-text of a value heavier than the budget is refused before it is converted"
 */
const asText: TextCost = (v, room) => (typeof v === 'object' && v !== null && !isHost(v) ? weigh(v, room) : 0);

/**
 * Charge a conversion of a value no expression returned (a `data-model` or
 * `data-persist` state key read directly), as `evaluator` charges a result.
 * False when refused: reported, or retried in the next task.
 * Verified by: src/__tests__/runtime-text-cost.test.ts > "every other conversion of a result to text is refused before it runs"
 */
function converts(el: Element, scope: Scope, what: string, value: unknown): boolean {
  try {
    spend();
    evaluateExpression(NOTHING, scope, meter, (_, room) => asText(value, room));
    return true;
  } catch (err) {
    if (!isExprError(err)) throw err;
    if (err.defer) later();
    else {
      reportExprFailure(el, what, err, scope.mount);
      reported(err);
    }
    return false;
  }
}

/** An expression that does nothing, for pricing a value no expression returned. */
const NOTHING = compileExpression('0');

/** A value a `data-list` row template places in text, once per row it appears in. */
const placed = (v: unknown, room: number): number => (typeof v === 'string' ? v.length * GROW : asText(v, room));

/** Strip one balanced `{ … }` wrapper, honouring string and template literals. */
function stripBraces(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  const seg = readBalancedSegment(trimmed, 0, '{', '}');
  if (!seg || seg.end !== trimmed.length - 1) return trimmed;
  return seg.inner.trim();
}

/** The console half of a failure report: expression, cause, and the element. */
function logExprFailure(el: Element | null, expr: string, err: FormaExprError, what: string): void {
  const where = err.column >= 0 ? ` at column ${err.column + 1}` : '';
  const head = el ? `\n  on: ${el.outerHTML.slice(0, 120)}` : '';
  console.error(`[FormaJS] ${what} not evaluated${where}: ${expr}\n  ${err.code}: ${err.message}${head}`);
}

/**
 * A value expression could not be compiled or could not be evaluated. Both are
 * reported the same way — console error, `formajs:diagnostic`, an entry in
 * `getDiagnostics()` with a stable code, and a `data-forma-expr-error` marker
 * on the element — and in both cases the binding writes NOTHING.
 * Verified by: src/__tests__/failure-semantics.test.ts > "reports one diagnostic per distinct expression, however many elements share it"
 */
function reportExprFailure(el: Element | null, expr: string, err: FormaExprError, mount?: MountCtx): void {
  logExprFailure(el, expr, err, 'expression');
  reportFailure('expression-unsupported', expr, err, mount);
  el?.setAttribute('data-forma-expr-error', 'unsupported');
}

function reportHandlerFailure(el: Element | null, expr: string, err: FormaExprError, mount?: MountCtx): void {
  logExprFailure(el, expr, err, 'handler');
  reportFailure('handler-unsupported', expr, err, mount);
  el?.setAttribute('data-forma-handler-error', 'unsupported');
}

/** The diagnostic for a failure: a denied grant is `grant-denied`, with its grant, whatever directive met it. */
function reportFailure(kind: RuntimeDiagnostic['kind'], expr: string, err: FormaExprError, mount?: MountCtx): void {
  if (err.code === 'FORMA_E_GRANT_DOM' || err.code === 'FORMA_E_GRANT_NAVIGATE') {
    reportDiagnostic('grant-denied', expr, err.message, err.code, mount, err.code === 'FORMA_E_GRANT_DOM' ? 'dom' : 'navigate');
  } else {
    reportDiagnostic(kind, expr, err.message, err.code, mount);
  }
}

/**
 * Compile one value expression against a scope.
 *
 * Returns `null` when the expression is outside the grammar — already reported,
 * so the caller only has to decide what "no binding" looks like for its
 * directive. The returned closure THROWS `FormaExprError` on an evaluation-time
 * denial; it never answers `undefined` to mean "failed".
 */
function buildEvaluator(expr: string, scope: Scope, el: Element | null): Evaluate | null {
  const cleaned = stripBraces(expr);
  const cache = getScopeCache(scopeExpressionCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  let compiled;
  try {
    compiled = compileExpression(cleaned);
  } catch (err) {
    if (!isExprError(err)) throw err;
    reportExprFailure(el, cleaned, err, scope.mount);
    return null;
  }
  const run: Evaluate = (text) => {
    spend();
    return evaluateExpression(compiled, scope, meter, text);
  };
  cache.set(cleaned, run);
  return run;
}

// ── Handler compiler ──

/**
 * Compile a `data-on:*` handler body: `;`-separated statements over the same
 * grammar, plus assignment, `++`/`--`, `if`/`else` and bare method calls.
 *
 * `$event` / `event` are not scope state — they exist only for the duration of
 * one dispatch — so they are bound through a child scope whose two locals are
 * refreshed on every invocation and restored afterwards. That keeps a
 * re-entrant dispatch correct and stops a compiled handler retaining the Event.
 * Verified by: src/__tests__/runtime-csp-default.test.ts > "does not leak the Event between dispatches"
 */
function buildHandler(expr: string, scope: Scope, el: Element | null): HandlerBuildResult {
  const cleaned = stripBraces(expr);
  const cache = getScopeCache(scopeHandlerCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  let program;
  try {
    program = compileHandler(cleaned);
  } catch (err) {
    if (!isExprError(err)) throw err;
    reportHandlerFailure(el, cleaned, err, scope.mount);
    const failed: HandlerBuildResult = { handler: () => {}, supported: false };
    cache.set(cleaned, failed);
    return failed;
  }

  const eventLocals: Record<string, unknown> = { $event: undefined, event: undefined };
  const eventScope = createChildScope(scope, eventLocals);

  const handler = (e: Event) => {
    const outer = eventLocals.$event;
    // Under a tiered mount the event carries the mount's bound, so
    // `$event.target` cannot hand back an element outside the root.
    const wrapped = hostObject('event', e, '$event', scope.mount.bound);
    eventLocals.$event = wrapped;
    eventLocals.event = wrapped;
    // A handler cannot be retried later, so an event it has not seen starts a
    // task: the meter is zeroed. Every handler the same event reaches (one per
    // element it bubbles through) shares what is left, and so do the bindings
    // they update. A handler dispatched from inside an evaluation (`$el.click()`,
    // `$dispatch`) spends that evaluation's budget whatever the meter holds.
    // Verified by: src/__tests__/runtime-task-budget.test.ts > "the handlers one event reaches share one budget"
    begin(e);
    try {
      batch(() => runHandler(program, eventScope, meter));
    } catch (err) {
      if (!isExprError(err)) throw err;
      reportHandlerFailure((e.currentTarget as Element | null) ?? el, cleaned, err, scope.mount);
    } finally {
      eventLocals.$event = outer;
      eventLocals.event = outer;
    }
  };

  const result: HandlerBuildResult = { handler, supported: true };
  cache.set(cleaned, result);
  return result;
}

// ── State initialization ──

const FORBIDDEN_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse a `data-forma-state` attribute into the plain object a scope is built
 * from. Anything else — invalid JSON, but equally the *valid* JSON values
 * `null`, `7`, `"str"` and `[1,2]` — yields `{}`.
 *
 * Rejecting the valid-but-wrong-shape values is not tidiness. `initScope` feeds
 * the result to `Object.entries`, and the pollution sweep below uses `in`,
 * which throws a TypeError on a primitive: `data-forma-state='null'` on ONE
 * element used to throw out of parseState, out of `mount()`, and leave every
 * other scope on the page unbound.
 *
 * Verified by: src/__tests__/runtime-state-parsing.test.ts > "a JSON scalar in data-forma-state does not stop the rest of the page from binding"
 * Verified by: src/__tests__/runtime-state-parsing.test.ts > "treats every non-object JSON value as empty state"
 */
function parseState(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (_debug) {
      dbg('parseState: Invalid JSON in data-forma-state — use valid JSON with quoted keys. Got:', raw.slice(0, 200));
    }
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (_debug) {
      dbg('parseState: data-forma-state must be a JSON object. Got:', raw.slice(0, 200));
    }
    return {};
  }
  const state = parsed as Record<string, unknown>;
  // Strip prototype-pollution keys. JSON.parse materializes `"__proto__"` as a
  // real own property, so this delete is not a no-op the way it would be for an
  // object literal.
  // Verified by: src/__tests__/runtime-state-parsing.test.ts > "a __proto__ key in data-forma-state never reaches Object.prototype"
  for (const key of FORBIDDEN_STATE_KEYS) {
    if (Object.hasOwn(state, key)) delete state[key];
  }
  return state;
}

// A binding can throw before internalEffect returns its disposer. Catch inside
// the root callback so its graph disposer is returned, then tear down all work
// before rethrowing. Explicit mounts own their work independently of a caller root.
function ownBindings(bind: (disposers: (() => void)[]) => void): () => void {
  let failure: { error: unknown } | undefined;
  const dispose = createUnownedRoot(dispose => {
    const disposers: (() => void)[] = [];
    registerDisposer(() => {
      for (const cleanup of disposers) {
        try { cleanup(); } catch { /* one cleanup must not strand the others */ }
      }
      disposers.length = 0;
    });
    try { bind(disposers); } catch (error) { failure = { error }; }
    return dispose;
  });
  if (failure) {
    dispose();
    throw failure.error;
  }
  return dispose;
}

// ── DOM scanner ──

function initScope(stateEl: Element, mount: MountCtx): Scope {
  const raw = stateEl.getAttribute('data-forma-state') ?? '{}';
  const state = parseState(raw);
  const keys = Object.keys(state);
  if (_debug) {
    dbg('initScope: parsed', keys.length, 'keys:', keys.join(', '));
    if (keys.length === 0) {
      dbg('initScope: WARNING — empty state! Raw attribute:', raw.slice(0, 200));
    }
  }
  // Null-prototype, so an expression naming a member of Object.prototype does
  // not resolve to one. With a `{}` literal here, `data-text="{constructor}"`
  // read `Object` off the prototype chain and the parser's `getters[expr]?.()`
  // CALLED it — the same reach applied to `toString`, `valueOf` and
  // `hasOwnProperty`. That is the sandbox escape the FORBIDDEN_STATE_KEYS sweep
  // in parseState only looked like it closed: it strips the keys from the
  // parsed state, but inheritance put them back on the scope.
  // Verified by: src/__tests__/runtime-state-parsing.test.ts > "an expression naming an Object.prototype member reads undefined, not the prototype"
  const getters: Record<string, Getter> = Object.create(null);
  const setters: Record<string, Setter> = Object.create(null);

  for (const [key, initial] of Object.entries(state)) {
    const [get, set] = createSignal(initial);
    getters[key] = get;
    setters[key] = set as Setter;
  }

  // $refetch is a captured callable, not a bare function in scope. A tiered
  // mount's reaches its own registry only.
  const registry = mount.refetch;
  const refetchHost = hostFn('$refetch', (id: unknown) => $refetch(String(id), registry), 1);
  getters['$refetch'] = () => refetchHost;

  return { getters, setters, mount, budget: mount.budget };
}

// ── Element binding ──

/**
 * Event types an engine treats as activation when an untrusted event of that
 * type is dispatched on an element, so dispatching one can follow a link,
 * submit or reset a form, or toggle a label's control or a `<details>`. Measured
 * with `new CustomEvent(type)`: WebKit runs activation for `click`, `auxclick`
 * and `DOMActivate`; Firefox submits on `submit` and resets on `reset`;
 * Chromium runs none. Under a tiered mount `$dispatch` of one needs `navigate`,
 * as `click()` does (formajs#30, review S1); the comparison ignores case.
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "$dispatch of an activation event needs navigate: %s"
 */
const ACTIVATION_EVENTS: ReadonlySet<string> = new Set(['click', 'auxclick', 'domactivate', 'submit', 'reset']);

function bindElement(el: Element, scope: Scope, disposers: (() => void)[]): void {
  // Per-element magics. Both are HOST values (src/expr/host.ts): the element is
  // reachable only through the element property allowlist, and $dispatch is a
  // captured callable rather than a function sitting in scope — a function held
  // in state is never invocable, so only magics like this one can be called.
  // Under a tiered mount `$el` carries the mount's bound (L-36): no hop from
  // it reaches past the mount root without the `dom` grant.
  const elMagics: Record<string, unknown> = {
    $el: hostObject('element', el, '$el', scope.mount.bound),
    $dispatch: hostFn('$dispatch', (name: unknown, detail?: unknown) => {
      const type = String(name);
      const mount = scope.mount;
      if (mount && ACTIVATION_EVENTS.has(type.toLowerCase())) {
        if (!mount.bound.navigate) {
          throw exprError('FORMA_E_GRANT_NAVIGATE', `$dispatch('${type}') (no navigate grant)`);
        }
        mount.bound.use('navigate');
      }
      el.dispatchEvent(new CustomEvent(type, {
        bubbles: true,
        composed: true, // crosses Shadow DOM boundaries (important for <forma-stage>)
        detail,
      }));
    }, 2),
  };
  scope = createChildScope(scope, elMagics);

  // A marker left by an EARLIER bind of this element (reconcile re-binds in
  // place) is cleared here, up front, and never again. It used to be cleared in
  // a trailer at the end of bindElement, guarded by a flag that only knew about
  // COMPILE failures — so a denial raised while EVALUATING, which marks the
  // element from inside the effect that bindElement is still setting up, was
  // reported to the console and to getDiagnostics() and then had its marker
  // wiped off the element on the way out. `{items.push(4)}`, `{items[key]}`
  // with a hostile key, `{$el.ownerDocument}` and every budget denial were
  // silent in the DOM. Clearing before, and only setting after, makes the
  // marker mean "this element has an expression that did not run", whenever
  // that was discovered.
  // Verified by: src/__tests__/failure-semantics.test.ts > "a denial while evaluating marks the element, not just the console"
  if (el.hasAttribute('data-forma-expr-error')) el.removeAttribute('data-forma-expr-error');
  if (el.hasAttribute('data-forma-handler-error')) el.removeAttribute('data-forma-handler-error');

  // Every directive on this element goes through `evaluator()`. An expression
  // that cannot compile, or that is denied while evaluating, reports once and
  // yields EXPR_FAILED — which each directive treats as "do not write", so the
  // DOM keeps whatever it had instead of being handed the string "undefined".
  // Verified by: src/__tests__/runtime-csp-default.test.ts > "marks the element with data-forma-expr-error when an expression cannot be compiled"
  // Verified by: src/__tests__/failure-semantics.test.ts > "a denied expression leaves the previous text in place and never renders undefined"
  // A refusal marked `defer` (the task's budget was spent before this binding
  // started) is not reported: the binding re-runs in the next task.
  // `text` prices the conversion the directive makes of the result (FORMA-025).
  const evaluator = (expression: string, text?: TextCost): (() => unknown) => {
    const fn = buildEvaluator(expression, scope, el);
    if (!fn) return () => EXPR_FAILED;
    return () => {
      try {
        return fn(text);
      } catch (err) {
        if (!isExprError(err)) throw err;
        if (err.defer) later();
        else {
          reportExprFailure(el, stripBraces(expression), err, scope.mount);
          reported(err);
        }
        return EXPR_FAILED;
      }
    };
  };

  // data-computed="name = expr" or "a = expr1; b = expr2"
  const computedAttr = el.getAttribute('data-computed');
  if (computedAttr) {
    // Split multi-statement computed: "a = expr1; b = expr2; c = expr3"
    // Uses lookahead to split at "; identifier =" boundaries without
    // breaking arrow functions (=>) or comparisons (===, ==).
    const parts = computedAttr.split(/;\s*(?=\w+\s*=[^=])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(RE_COMPUTED);
      if (match) {
        const name = match[1]!;
        const expr = match[2]!;
        // Remove the computed name from getters before building evaluator
        // to prevent self-referential cycle (computed reading itself)
        const prevGetter = scope.getters[name];
        delete scope.getters[name];
        // The raw evaluator is used here, not the reporting one: a computed
        // that cannot evaluate must make its READERS fail loudly (each with its
        // own element and diagnostic) rather than caching a sentinel that would
        // then be rendered as text.
        // `buildEvaluator` has already reported the failure and marked the
        // element, so there is nothing to do here but leave the name unbound —
        // which makes every reader of it fail loudly with its own diagnostic.
        const evaluate = buildEvaluator(`{${expr}}`, scope, el);
        if (evaluate) {
          // Read inside a binding, a computed spends that binding's budget. If
          // it is refused for what was spent before it, it is evaluated again
          // at the top of the next task, before the bindings that read it.
          // Verified by: src/__tests__/runtime-task-budget.test.ts > "a computed refused inside a heavy reader is evaluated again on its own"
          const cell: () => { ok: true; v: unknown } | { ok: false; e: FormaExprError } = createComputed(() => {
            try {
              return { ok: true, v: evaluate() };
            } catch (err) {
              if (!isExprError(err)) throw err;
              if (err.defer) {
                later();
                staleCells.add(cell);
              }
              return { ok: false, e: err };
            }
          });
          scope.getters[name] = () => {
            const r = cell();
            if (!r.ok) throw r.e;
            return r.v;
          };
        }
        // Keep the original setter so manual overrides still work
        if (!prevGetter) {
          // If there was no initial state entry, remove the setter too
          delete scope.setters[name];
        }
      }
    }
  }

  // data-text="{expr}"
  const textExpr = el.getAttribute('data-text');
  if (textExpr) {
    const evaluate = evaluator(textExpr, asText);
    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      setElementTextFast(el, toTextValue(value));
    });
    disposers.push(dispose);
  }

  // data-show="{expr}"
  const showExpr = el.getAttribute('data-show');
  if (showExpr) {
    const evaluate = evaluator(showExpr);
    const transition = parseTransitionSpec(el);
    if (_debug) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
      dbg(`bindElement: data-show="${showExpr}" on <${tag}${cls}>`);
    }
    let initialized = false;
    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      const visible = !!value;
      if (_debug) dbg(`data-show effect: "${showExpr}" → ${visible}`);
      applyShowVisibility(el as HTMLElement, visible, transition, !initialized);
      initialized = true;
    });
    disposers.push(dispose);
    if (transition) {
      disposers.push(() => clearTransitionState(el as HTMLElement));
    }
  }

  // data-if="{expr}" — conditional DOM insertion/removal with optional transitions
  const ifExpr = el.getAttribute('data-if');
  if (ifExpr) {
    const evaluate = evaluator(ifExpr);
    const transition = parseTransitionSpec(el);
    const placeholder = document.createComment('forma-if');
    const parent = el.parentNode;
    let inserted = true;
    let initialized = false;

    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      const show = !!value;

      if (show && !inserted) {
        // Cancel any in-flight leave
        clearTransitionState(el as HTMLElement);
        el.removeAttribute('data-forma-leaving');
        if (initialized && transition) {
          transitionInsert(el as HTMLElement, parent!, placeholder, transition);
        } else {
          parent?.insertBefore(el, placeholder);
        }
        inserted = true;
      } else if (!show && inserted) {
        if (initialized && transition) {
          transitionRemove(el as HTMLElement, transition, () => {
            if (el.parentNode) {
              parent?.insertBefore(placeholder, el);
              el.remove();
            }
          });
        } else {
          parent?.insertBefore(placeholder, el);
          el.remove();
        }
        inserted = false;
      }
      initialized = true;
    });

    disposers.push(dispose);
    if (transition) {
      disposers.push(() => clearTransitionState(el as HTMLElement));
    }
  }

  // data-model="{prop}"
  const modelExpr = el.getAttribute('data-model');
  if (modelExpr) {
    const prop = modelExpr.replace(RE_STRIP_BRACES, '').trim();
    let getter = scope.getters[prop];
    let setter = scope.setters[prop];
    if ((!getter || !setter) && prop.includes('.')) {
      // Member path (e.g. {item.name} inside a data-list row): evaluate to read,
      // and set the last key on the resolved parent object to write. Reactive
      // when the parent is a store proxy; a plain object still round-trips the
      // input value.
      getter = evaluator(prop);
      const lastDot = prop.lastIndexOf('.');
      const basePath = prop.slice(0, lastDot);
      const key = prop.slice(lastDot + 1);
      const baseGet = evaluator(basePath);
      setter = (v: unknown) => {
        const base = baseGet();
        if (base !== EXPR_FAILED && base != null && typeof base === 'object') {
          (base as Record<string, unknown>)[key] = v;
        }
      };
    }
    if (getter && setter) {
      const input = el as HTMLInputElement;
      const tag = input.tagName;
      const dispose = internalEffect(() => {
        const val = getter();
        if (val === EXPR_FAILED || !converts(el, scope, prop, val)) return;
        const type = input.type;
        if (type === 'checkbox') {
          input.checked = !!val;
          // Optional indeterminate companion attribute (opt-in, non-breaking).
          const indetExpr = el.getAttribute('data-model-indeterminate');
          if (indetExpr) {
            const indetGetter = scope.getters[indetExpr.replace(RE_STRIP_BRACES, '').trim()];
            if (indetGetter) input.indeterminate = !!indetGetter();
          }
        } else if (type === 'radio') {
          input.checked = String(val) === input.value;
        } else if (tag === 'SELECT' && (input as unknown as HTMLSelectElement).multiple) {
          const sel = input as unknown as HTMLSelectElement;
          const arr = Array.isArray(val) ? val.map(String) : [];
          for (const opt of Array.from(sel.options)) opt.selected = arr.includes(opt.value);
        } else {
          input.value = String(val ?? '');
        }
      });
      disposers.push(dispose);
      const event = (input.type === 'checkbox' || input.type === 'radio' || tag === 'SELECT') ? 'change' : 'input';
      const onModelInput = (e: Event) => {
        begin(e);
        const type = input.type;
        if (type === 'checkbox') {
          setter(input.checked);
        } else if (type === 'radio') {
          if (input.checked) setter(input.value);
        } else if (tag === 'SELECT' && (input as unknown as HTMLSelectElement).multiple) {
          const sel = input as unknown as HTMLSelectElement;
          setter(Array.from(sel.selectedOptions).map((o) => o.value));
        } else if (type === 'number' || type === 'range') {
          const raw = input.value;
          if (raw === '') {
            setter(null); // empty numeric clears rather than writing NaN
          } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) setter(n); // ignore partial input like '-' or '1.'
          }
        } else {
          setter(input.value);
        }
      };
      input.addEventListener(event, onModelInput);
      disposers.push(() => {
        input.removeEventListener(event, onModelInput);
      });
    }
  }

  // Single-pass over attributes for data-on:*, data-class:*, data-bind:*
  // When directive map is available, skip the loop entirely if none of these are present.
  // Snapshot the NamedNodeMap before binding. data-bind effects run
  // synchronously and can add/remove attributes; iterating the live map would
  // otherwise skip the following directive when its indices shift.
  const attrs = Array.from(el.attributes);
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]!;
    const name = attr.name;

    if (name.startsWith('data-on:')) {
      const event = name.slice(8); // 'data-on:'.length === 8
      const built = buildHandler(attr.value, scope, el);
      const handler = built.handler;
      if (_debug) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
        dbg(`bindElement: data-on:${event}="${attr.value}" on <${tag}${id}${cls}>`);
      }
      // Set only. A stale marker was cleared at the top of bindElement, so an
      // element carrying two handlers cannot have the second one erase the
      // first one's failure.
      // Verified by: src/__tests__/failure-semantics.test.ts > "a second, working handler does not erase the first one's failure marker"
      if (!built.supported) {
        el.setAttribute('data-forma-handler-error', 'unsupported');
      }
      if (_debug) {
        const attrVal = attr.value;
        const tracedHandler = (e: Event) => {
          dbg(`HANDLER FIRED: data-on:${event}="${attrVal}"`, 'isTrusted:', e.isTrusted);
          handler(e);
        };
        el.addEventListener(event, tracedHandler);
        disposers.push(() => { el.removeEventListener(event, tracedHandler); });
      } else {
        el.addEventListener(event, handler);
        disposers.push(() => { el.removeEventListener(event, handler); });
      }
    } else if (name.startsWith('data-class:')) {
      const cls = name.slice(11); // 'data-class:'.length === 11
      const evaluate = evaluator(attr.value);
      const dispose = internalEffect(() => {
        const value = evaluate();
        if (value === EXPR_FAILED) return;
        el.classList.toggle(cls, !!value);
      });
      disposers.push(dispose);
    } else if (name.startsWith('data-bind:')) {
      const attrName = name.slice(10); // 'data-bind:'.length === 10
      if (isRawHtmlAttr(attrName)) {
        // An unreviewed mount renders no srcdoc (see refuseUnreviewed): the
        // one binding that could write one is refused before it runs, and
        // reported (formajs#35's review, S2).
        // Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount renders no srcdoc: the attribute is removed, a binding that would write one is refused, and each is reported"
        reportDiagnostic(
          'markup-refused',
          `${name}="${attr.value}"`,
          scope.mount?.tier === 'unreviewed'
            ? 'srcdoc binding is refused in an unreviewed mount'
            : RUNTIME_SRCDOC_REASON,
          scope.mount?.tier === 'unreviewed' ? 'FORMA_E_UNREVIEWED_SRCDOC' : RUNTIME_SRCDOC_CODE,
          scope.mount,
        );
        el.removeAttribute(attrName);
        continue;
      }
      const evaluate = evaluator(attr.value, asText);
      const dispose = internalEffect(() => {
        const val = evaluate();
        if (val === EXPR_FAILED) return;
        if (val == null || val === false) {
          el.removeAttribute(attrName);
          return;
        }
        // `true` writes a BARE attribute, matching h(), hydration adoption, the
        // SSR renderer and the Rust walker. Writing String(true) here produced
        // `disabled="true"` where every other path produced `disabled`, so an
        // SSR page and its bound self disagreed byte-for-byte.
        // Verified by: src/__tests__/renderer-contract.test.ts > "true renders a bare attribute — present with an empty value"
        const str = val === true ? '' : String(val);
        // The safety check runs for EVERY accepted value, including the bare
        // one: an `on*` name must not be written even with an empty value, and
        // splitting the true-case out above the guard is exactly how it would
        // be. Applies to standard and hardened builds alike.
        // Verified by: src/__tests__/runtime-bind-security.test.ts > "does not set an inline event-handler attribute via data-bind:onclick"
        // Verified by: src/__tests__/renderer-contract.test.ts > "refuses an on* name whatever the value type: %j"
        if (isUnsafeAttrBinding(attrName, str, el.tagName.toLowerCase())) {
          el.removeAttribute(attrName);
        } else {
          el.setAttribute(attrName, str);
        }
      });
      disposers.push(dispose);
    }
  }

  // data-persist="{prop}"
  const persistExpr = el.getAttribute('data-persist');
  if (persistExpr) {
    const prop = persistExpr.replace(RE_STRIP_BRACES, '').trim();
    const getter = scope.getters[prop];
    const setter = scope.setters[prop];
    if (getter && setter) {
      const key = 'forma:' + prop;
      try {
        const saved = localStorage.getItem(key);
        if (saved !== null) setter(JSON.parse(saved));
      } catch { /* ignore parse errors */ }
      const dispose = internalEffect(() => {
        const value = getter();
        if (!converts(el, scope, prop, value)) return;
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
      });
      disposers.push(dispose);
    }
  }

  // data-list="{expr}" — keyed reconciliation with LIS
  const listExpr = el.getAttribute('data-list');
  if (listExpr) {
    const templateEl = el.children[0] as Element | undefined;
    if (templateEl) {
      const template = templateEl.cloneNode(true) as Element;
      // Remove original template from DOM
      el.removeChild(templateEl);

      // Detect key attribute: data-key="{item.id}" -> extracts "id"
      const keyAttr = template.getAttribute('data-key');
      const keyProp = keyAttr
        ? keyAttr.replace(RE_STRIP_ITEM_BRACES, '').trim()
        : null;

      // Every row places its item's `{item.x}` values in text, and its key is
      // converted with String(): priced with the list's evaluation, per row,
      // before any row is built (FORMA-025).
      // Verified by: src/__tests__/runtime-text-cost.test.ts > "every other conversion of a result to text is refused before it runs"
      const fields = [...template.outerHTML.matchAll(/\{item\.?(\w*)\}/g)].map((m) => m[1]!);
      if (keyProp) fields.push(keyProp);
      const evaluate = evaluator(listExpr, (items, room) => {
        let n = 0;
        if (Array.isArray(items)) {
          for (const item of items) {
            for (const f of fields) {
              if (n > room) return n;
              n += placed(f ? (item as Record<string, unknown> | null)?.[f] : item, room);
            }
          }
        }
        return n;
      });

      // Parse transition spec from the list container element
      const listTransition = parseTransitionSpec(el);

      let oldItems: unknown[] = [];
      let oldNodes: Node[] = [];

      // For index-based keying (no data-key), we wrap items in objects
      // that carry their index so the keyFn can extract it without a
      // second argument. For property-based keying, items pass through raw.
      interface IndexWrapped { __idx: number; __item: unknown }

      // Include rows created before a later row refuses, even when reconcileList
      // has not returned its new node array yet. Removed rows leave this set.
      const boundRows = new Set<Node>();
      disposers.push(() => {
        for (const node of boundRows) {
          // Row enter work is scheduled by the reconciler after bindings return.
          // Final scope disposal must cancel that visual work as well.
          try { clearTransitionState(node as HTMLElement); } catch { /* continue row cleanup */ }
          disposeCloneBindings(node);
        }
      });

      /** Dispose all bindings stored on a clone element */
      function disposeCloneBindings(node: Node): void {
        boundRows.delete(node);
        const el = node as any;
        if (Array.isArray(el.__formaDisposers)) {
          for (const d of el.__formaDisposers) {
            try { d(); } catch { /* ensure all disposers run */ }
          }
          delete el.__formaDisposers;
        }
      }

      /** Clone template, bind directives via child scope */
      function createBoundClone(item: unknown, index: number): Element {
        const clone = cloneWithTemplateData(template, item, scope.mount);
        const childScope = createChildScope(scope, { item, index });
        const dispose = ownBindings(itemDisposers => {
          bindElement(clone, childScope, itemDisposers);
          for (const desc of Array.from(clone.querySelectorAll('*'))) {
            bindElement(desc, childScope, itemDisposers);
          }
        });
        (clone as any).__formaDisposers = [dispose];
        boundRows.add(clone);
        return clone;
      }

      /** Dispose old bindings and rebind with fresh data */
      function updateBoundClone(node: Node, item: unknown, index: number): void {
        disposeCloneBindings(node);
        updateTemplateData(node as Element, item);
        const childScope = createChildScope(scope, { item, index });
        const dispose = ownBindings(itemDisposers => {
          bindElement(node as Element, childScope, itemDisposers);
          for (const desc of Array.from((node as Element).querySelectorAll('*'))) {
            bindElement(desc, childScope, itemDisposers);
          }
        });
        (node as any).__formaDisposers = [dispose];
        boundRows.add(node);
      }

      // Build transition hooks for reconcileList (only when transition attrs present)
      const listHooks: ListTransitionHooks | undefined = listTransition ? {
        onInsert: (node: Node) => {
          const htmlEl = node as HTMLElement;
          if (!htmlEl.setAttribute) return; // text node guard
          const state = getTransitionState(htmlEl);
          state.token += 1;
          const token = state.token;
          if (state.cancel) state.cancel();
          state.cancel = runTransitionPhase(
            htmlEl,
            {
              base: listTransition.enter,
              from: listTransition.enterFrom,
              to: listTransition.enterTo,
              durationMs: listTransition.enterDurationMs,
            },
            () => {
              const current = getTransitionState(htmlEl);
              if (current.token === token) current.cancel = null;
            },
          );
        },
        onBeforeRemove: (node: Node, done: () => void) => {
          const htmlEl = node as HTMLElement;
          if (!htmlEl.setAttribute) { done(); return; } // text node guard
          disposeCloneBindings(node);
          transitionRemove(htmlEl, listTransition, () => {
            done();
          });
        },
      } : undefined;

      const dispose = internalEffect(() => {
        const rawItems = evaluate();
        if (rawItems === EXPR_FAILED) return;
        if (!Array.isArray(rawItems)) {
          // Remove all — dispose bindings first
          for (const n of oldNodes) {
            disposeCloneBindings(n);
            el.removeChild(n);
          }
          oldItems = [];
          oldNodes = [];
          return;
        }

        // Cancel any in-flight leave animations before reconciliation
        if (listTransition) {
          const leavingNodes = el.querySelectorAll('[data-forma-leaving]');
          for (const ln of Array.from(leavingNodes)) {
            clearTransitionState(ln as HTMLElement);
            ln.removeAttribute('data-forma-leaving');
            if (ln.parentNode) ln.parentNode.removeChild(ln);
          }
        }

        // Snapshot old nodes before reconciliation to detect removals
        const prevNodes = new Set(oldNodes);

        // Wrap items so each carries its TRUE loop index. This replaces
        // rawItems.indexOf(item) (which returned the first match for duplicate /
        // primitive items, giving wrong/duplicated {index}, and was O(n^2)).
        const wrapped: IndexWrapped[] = rawItems.map((item, i) => ({ __idx: i, __item: item }));
        const oldWrapped = oldItems as IndexWrapped[];
        const keyFn = keyProp
          ? (w: IndexWrapped) => String((w.__item as Record<string, unknown>)?.[keyProp] ?? '')
          : (w: IndexWrapped) => w.__idx;

        const result = reconcileList<IndexWrapped>(
          el,
          oldWrapped,
          wrapped,
          oldNodes,
          keyFn,
          (w: IndexWrapped) => createBoundClone(w.__item, w.__idx),
          (node: Node, w: IndexWrapped) => updateBoundClone(node, w.__item, w.__idx),
          undefined, // beforeNode
          listHooks,
        );
        // Dispose bindings on nodes that were removed by reconcileList
        const nextNodes = new Set(result.nodes);
        for (const n of prevNodes) {
          if (!nextNodes.has(n)) {
            // Skip nodes mid-leave — onBeforeRemove already disposed them
            if ((n as Element).hasAttribute?.('data-forma-leaving')) continue;
            disposeCloneBindings(n);
          }
        }
        oldItems = result.items;
        oldNodes = result.nodes;
      });
      disposers.push(dispose);
    }
  }

  // data-fetch="[METHOD] url → prop [|loading:prop] [|error:prop] [|poll:ms]"
  const fetchExpr = el.getAttribute('data-fetch');
  if (fetchExpr) {
    const arrowMatch = fetchExpr.match(RE_FETCH);
    if (arrowMatch) {
      const urlPart = arrowMatch[1]!.trim();
      const target = arrowMatch[2]!.trim();
      const modifiers = arrowMatch[3]?.trim() ?? '';

      let method = 'GET';
      let url = urlPart;
      const methodMatch = urlPart.match(RE_FETCH_METHOD);
      if (methodMatch) {
        method = methodMatch[1]!.toUpperCase();
        url = methodMatch[2]!.trim();
      }

      let loadingTarget: string | undefined;
      let errorTarget: string | undefined;
      let interval: number | undefined;
      for (const mod of modifiers.split('|').filter(Boolean)) {
        const [k, v] = mod.split(':').map(s => s.trim());
        if (k === 'loading') loadingTarget = v;
        else if (k === 'error') errorTarget = v;
        else if (k === 'poll') interval = parseInt(v ?? '0', 10);
      }

      // Create signals for target, loading, and error
      const [getTarget, setTarget] = createSignal<unknown>(null);
      scope.getters[target] = getTarget;
      scope.setters[target] = setTarget as Setter;
      if (loadingTarget) {
        const [gl, sl] = createSignal(false);
        scope.getters[loadingTarget] = gl;
        scope.setters[loadingTarget] = sl as Setter;
      }
      if (errorTarget) {
        const [ge, se] = createSignal<unknown>(null);
        scope.getters[errorTarget] = ge;
        scope.setters[errorTarget] = se as Setter;
      }

      // Under a tiered mount the request must be one its `fetch` grant
      // covers (DR-15). One it does not is never sent, polled or registered
      // for `$refetch`: it is reported as a coded denial and its `error:`
      // target says so. Every request has this explicit mount verdict.
      // Verified by: src/__tests__/runtime-tiered-mount.test.ts > "with explicit empty grants a generated tree binds neither data-fetch nor $el.click()"
      const mount = scope.mount;
      const verdict = fetchVerdict(mount.fetch, method, url);
      if (!verdict.ok) {
        reportDiagnostic('grant-denied', fetchExpr, verdict.reason, 'FORMA_E_GRANT_FETCH', mount, 'fetch');
        el.setAttribute('data-forma-expr-error', 'unsupported');
        if (errorTarget) scope.setters[errorTarget]!(`data-fetch denied: ${verdict.reason}`);
      } else {
        const timeoutMs = verdict.timeoutMs;

        // A request the server never answers is aborted after FETCH_TIMEOUT_MS
        // (or a tiered mount's shorter grant), its own timer per request, and the
        // abort lands in the error: target.
        // The timer is the only thing that aborts a live request, and the message
        // is written here: an engine rejects with its own AbortError (WebKit
        // ignores a reason). Tearing the scope down stops every request in
        // flight: its timer is cleared and the request aborted. (Rationale: a
        // request checks it is still in flight before writing, so a stopped one
        // does not write into the disposed scope's signals.)
        // Every response outside 200-299 is an error, written to the error:
        // target and never to the data target.
        // Verified by: src/__tests__/runtime-fetch-timeout.test.ts > "a data-fetch to a stalled endpoint aborts at 30 s into its error: target"
        // Verified by: src/__tests__/runtime-fetch-timeout.test.ts > "a data-fetch answered before 30 s lands in its target and is never aborted"
        // Verified by: src/__tests__/runtime-fetch-timeout.test.ts > "handle.unmount() stops every in-flight request of a polling data-fetch, and disposal after removing the root does too"
        // Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a 404 with a JSON body lands in the error: target, not the data target"
        // Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a fetch grant's timeout shortens the abort"
        const inflight = new Set<() => void>();
        const doFetch = () => {
          if (loadingTarget) scope.setters[loadingTarget]!(true);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          const stop = () => { clearTimeout(timer); ctrl.abort(); };
          inflight.add(stop);
          const init: RequestInit = { method, signal: ctrl.signal };
          init.credentials = verdict.credentials;
          // The grant authorizes this URL, not a server's redirect target.
          // Browsers hide Location on manual redirects, so refuse before a
          // second request can escape its method/path/cookie boundary.
          init.redirect = 'error';
          if (mount.used) {
            mount.used.methods.add(method);
            mount.used.paths.add(verdict.path);
            if (verdict.cookies) mount.used.cookies = true;
          }
          fetch(url, init)
            .then(r => {
              if (!r.ok) throw new Error(`data-fetch answered HTTP ${r.status}`);
              return r.json();
            }, err => {
              // Fetch intentionally gives network and redirect failures the
              // same rejection. Do not claim to identify which one occurred.
              if (!ctrl.signal.aborted) {
                throw new Error('FORMA_E_FETCH_REQUEST: data-fetch failed before a response; redirects are not followed');
              }
              throw err;
            })
            .then(data => {
              if (!inflight.has(stop)) return;
              setTarget(data);
              if (loadingTarget) scope.setters[loadingTarget]!(false);
            })
            .catch(err => {
              if (!inflight.has(stop)) return;
              if (errorTarget) {
                scope.setters[errorTarget]!(
                  ctrl.signal.aborted ? `data-fetch timed out after ${timeoutMs} ms` : err.message,
                );
              }
              if (loadingTarget) scope.setters[loadingTarget]!(false);
            })
            .finally(() => { clearTimeout(timer); inflight.delete(stop); });
        };
        disposers.push(() => {
          for (const stop of inflight) stop();
          inflight.clear();
        });

        // Register only in this mount's $refetch registry.
        const fetchId = el.getAttribute('data-fetch-id');
        if (fetchId) {
          const registry = mount.refetch;
          registry.set(fetchId, doFetch);
          disposers.push(() => registry.delete(fetchId));
        }

        doFetch();
        if (interval && interval > 0) {
          const id = setInterval(doFetch, interval);
          disposers.push(() => clearInterval(id));
        }
      }
    }
  }

}

// ── Scope mounting / unmounting (single data-forma-state element) ──

/** Filter the captured descendant snapshot to actual directive elements. */
function hasDirective(el: Element): boolean {
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i]!.name;
    if (name.startsWith('data-text') || name.startsWith('data-show') ||
        name.startsWith('data-if') || name.startsWith('data-model') ||
        name.startsWith('data-computed') || name.startsWith('data-persist') ||
        name.startsWith('data-list') || name.startsWith('data-fetch') ||
        name.startsWith('data-on:') || name.startsWith('data-class:') ||
        name.startsWith('data-bind:') || name.startsWith('data-transition')) {
      return true;
    }
  }
  return false;
}

/**
 * Bind one `data-forma-state` element and the directive-bearing elements under
 * it. The mount context is required. A scope owned by a different nested
 * mount is left alone, as are that mount's directive descendants.
 * Verified by: src/__tests__/runtime-explicit-mount.test.ts > "import, DOMContentLoaded, injected nodes and state-attribute changes never bind without a handed root"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "a mount nested in another binds with its own grants, and the outer one never binds its markup"
 */
function mountScope(root: Element, mount: MountCtx): void {
  if (ownerOf(root) !== mount) return;
  // Idempotency guard — never double-bind
  if ((root as any).__formaDisposers) {
    if (_debug) dbg('mountScope: SKIPPED (already mounted)');
    return;
  }

  const scope = initScope(root, mount);
  const dispose = ownBindings(disposers => {
    // Build $refs — a lazy proxy that resolves data-ref="name" to elements.
    // Scanned once at mount time; the proxy resolves lazily on access.
    const refsMap = new Map<string, Element>();
    const refEls = root.querySelectorAll('[data-ref]');
    for (let i = 0; i < refEls.length; i++) {
      const el = refEls[i]!;
      if (ownedBelow(el, root)) continue;
      const name = el.getAttribute('data-ref');
      if (name) refsMap.set(name, el);
    }
    // Also check the root itself
    const rootRefName = root.getAttribute('data-ref');
    if (rootRefName) refsMap.set(rootRefName, root);

    // $refs hands back ELEMENT HOSTS, not raw elements. Before this, a `data-ref`
    // element came out unwrapped and `$refs.r.ownerDocument.location.href` read
    // the real page URL from inside a "CSP-safe" expression, with no diagnostic.
    // Verified by: src/expr/__tests__/adversarial.test.ts > "$refs.r.ownerDocument.location.href is denied"
    const refsHost = hostObject('refs', refsMap, '$refs', mount.bound);
    scope.getters['$refs'] = () => refsHost;

    // Bind the root itself
    bindElement(root, scope, disposers);

    // The descendant query takes a SNAPSHOT, and binding an earlier element can detach a
    // later one: `data-list` lifts its first child out as the row template with
    // `removeChild`, so that node is still in the snapshot and no longer in the
    // tree. Binding it evaluated the row's expressions against the PARENT scope,
    // where `item` does not exist — silently undefined under the old parser, and
    // a bogus "item is not declared" diagnostic under this one. The template's
    // descendants still have parents inside that detached subtree, so test their
    // membership in this captured scope root, not only their immediate parent.
    // A scope may itself be detached or inside a shadow root: document-level
    // isConnected would incorrectly skip those legitimate descendants.
    // Verified by: src/__tests__/failure-semantics.test.ts > "a data-list row template is not bound against the parent scope"
    let boundCount = 0;
    const targets = root.querySelectorAll('*');
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i]!;
      if (!root.contains(el)) continue;
      if (!hasDirective(el)) continue;
      if (ownedBelow(el, root)) continue;
      bindElement(el, scope, disposers);
      boundCount++;
    }

    if (_debug) dbg('mountScope: DONE —', boundCount, 'elements bound,', disposers.length, 'disposers');
  });
  // Store disposers on the root element for cleanup
  (root as any).__formaDisposers = [dispose];
  // Expose scope for devtools (State Inspector panel)
  (root as any).__formaScope = scope;
  (root as any).__formaInitialState = root.getAttribute('data-forma-state') ?? '{}';
  mount.scopes.add(root);
}

/**
 * Unmount a single `data-forma-state` element — disposes all effects,
 * intervals, and event listeners. Safe to call on already-unmounted elements.
 * Like `mountScope`, it leaves alone a scope another mount owns: a tiered
 * mount's scopes are disposed through its handle only.
 */
function unmountScope(root: Element, mount: MountCtx): void {
  // DOM ancestry can change after binding. Dispose by captured ownership.
  if (((root as any).__formaScope as Scope | undefined)?.mount !== mount) return;
  mount.scopes.delete(root);
  const disposers = (root as any).__formaDisposers as (() => void)[] | undefined;
  if (disposers) {
    for (const d of disposers) {
      try { d(); } catch { /* ensure all disposers run */ }
    }
    delete (root as any).__formaDisposers;
    delete (root as any).__formaScope;
    delete (root as any).__formaInitialState;
  }
}

/** Runtime diagnostics captured while parsing/binding templates. */
function getDiagnostics(): RuntimeDiagnostic[] {
  return Array.from(diagnostics.values()).map(d => ({ ...d }));
}

/** Clear runtime diagnostics collected so far. */
function clearDiagnostics(): void {
  diagnostics.clear();
}

// ── DevTools API — State Inspector ──

interface ScopeDescriptor {
  element: Element;
  id: string;
  values: Record<string, { value: unknown; type: string }>;
  initialJSON: string;
}

/**
 * DevTools: enumerate all active scopes and their current signal values.
 * Only called when the State Inspector panel is open — zero overhead otherwise.
 */
function getScopes(): ScopeDescriptor[] {
  const roots = document.querySelectorAll('[data-forma-state]');
  const result: ScopeDescriptor[] = [];

  for (const root of Array.from(roots)) {
    if (root.closest('[data-forma-leaving]')) continue;
    const scope = (root as any).__formaScope as Scope | undefined;
    const initialJSON = (root as any).__formaInitialState as string | undefined;
    if (!scope) continue;

    const values: Record<string, { value: unknown; type: string }> = {};
    for (const key of Object.keys(scope.getters)) {
      const val = scope.getters[key]!();
      values[key] = { value: val, type: typeof val };
    }

    result.push({
      element: root,
      id: root.getAttribute('data-forma-id') || root.id || root.tagName.toLowerCase(),
      values,
      initialJSON: initialJSON ?? '{}',
    });
  }
  return result;
}

/**
 * DevTools: set a state value on a specific scope element.
 * Triggers normal reactive effects (data-show, data-text, etc.).
 */
function setScopeValue(element: Element, key: string, value: unknown): void {
  const scope = (element as any).__formaScope as Scope | undefined;
  if (!scope?.setters[key]) return;
  batch(() => { scope.setters[key]!(value); });
}

/**
 * DevTools: reset all values on a scope to their initial JSON state.
 */
function resetScope(element: Element): void {
  const scope = (element as any).__formaScope as Scope | undefined;
  const initialJSON = (element as any).__formaInitialState as string | undefined;
  if (!scope || !initialJSON) return;

  const initial = parseState(initialJSON);
  batch(() => {
    for (const [key, val] of Object.entries(initial)) {
      scope.setters[key]?.(val);
    }
  });
}

// ── Tiered mount ──

/**
 * What unreviewed markup never renders (FORMA-128's follow-up; the A2 audit,
 * S1; formajs#35's review, B1 and S2), removed from `content` with a coded
 * diagnostic for each: every `<link>` (`FORMA_E_UNREVIEWED_LINK`), because
 * WebKit opens a connection for a `<link rel="preconnect">` in the preview
 * frame whatever the frame's policy says (`connect-src 'none'`,
 * `default-src 'none'` and the sandbox do not govern it), so a module could
 * reach any host it names from markup alone, and under the frame's policy no
 * `<link>` does anything else; and every `srcdoc` attribute
 * (`FORMA_E_UNREVIEWED_SRCDOC`), because an `<iframe srcdoc>` parses a child
 * document the strip cannot see into, and WebKit connects for a `<link>` in
 * it. Nested `<template>` contents are walked too.
 *
 * It runs twice per render. First on the fragment the reconciler parsed in
 * the root's own context, which the reconciler then writes as nodes: the root
 * is never given a string, because a strip done in one parse and written
 * through another let foreign content and foster parenting re-create a
 * `<link>` the strip had not seen (`<form><math><mtext></form><form><mglyph>
 * <style></math><link …>`, measured in all three engines). Then, `live`, on
 * the root after the write, as defence in depth: anything found there is
 * removed, reported as having reached the document, and the caller fails
 * closed. A binding cannot create an element, and the one that could write a
 * `srcdoc` (`data-bind:srcdoc`) is refused in this tier before it runs.
 * Returns the code of the last thing removed, null when nothing was.
 *
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount renders no <link>: each is removed before the markup reaches the document"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount parses its markup once, in the root's context, and writes no string to the root"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount renders no srcdoc: the attribute is removed, a binding that would write one is refused, and each is reported"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount fails closed: a <link> that reaches the root after the strip is removed, reported, and the markup refused"
 */
function refuseUnreviewed(content: ParentNode, mount: MountCtx, live: boolean): string | null {
  let code: string | null = null;
  const refuse = (el: Element, what: string, found: string): void => {
    code = found;
    reportDiagnostic(
      'markup-refused',
      el.outerHTML.slice(0, 200),
      `unreviewed markup renders no ${what}: ${live ? 'one reached the document after the strip; removed, and the markup refused' : 'removed'}`,
      code,
      mount,
    );
  };
  for (const link of Array.from(content.querySelectorAll('link'))) {
    refuse(link, '<link>', 'FORMA_E_UNREVIEWED_LINK');
    link.remove();
  }
  for (const el of Array.from(content.querySelectorAll('[srcdoc]'))) {
    refuse(el, 'srcdoc', 'FORMA_E_UNREVIEWED_SRCDOC');
    el.removeAttribute('srcdoc');
  }
  for (const nested of Array.from(content.querySelectorAll('template'))) {
    code = refuseUnreviewed(nested.content, mount, live) ?? code;
  }
  return code;
}

/**
 * Mount `markup` under `root` in a tier, with grants (FORMA-128; decision
 * brief DR-14, DR-15, L-36, L-47). The runtime binds only under the root it is
 * handed, never by watching `body`, and the mount takes its configuration
 * only from this call.
 *
 * - **Tier.** `compiled`, `reviewed` or `unreviewed` (DR-14). An
 *   `unreviewed` mount takes no grants and refuses to mount on any origin but
 *   an opaque one: content nobody reviewed renders only in the preview frame.
 * - **Grants** (DR-15): `fetch` (methods, path prefixes, cookies or not, a
 *   timeout up to 30 s), `dom` (the page beyond the root) and `navigate`
 *   (`click()`). A grant the object leaves out is not given; leaving out the
 *   whole object also gives none. Every
 *   denial is a coded `formajs:diagnostic` (`kind: 'grant-denied'`).
 * - **`$el`, `$event`, `$refs`** reach only the root's descendants: a hop
 *   to any other element, or a selector asking about one, needs `dom` (L-36).
 * - **`data-fetch`** answered with a status outside 200-299 writes an error
 *   to its `error:` target, never data.
 * - **Development builds** keep a report of the grants the mount used
 *   (`grantsUsed()`), so a reviewer writes grants from observed use.
 *
 * The shared responsibility (v2 10.1): the application chooses the tier and
 * passes grants only for content whose hash matches what its reviewer
 * approved (L-47); Forma enforces what the mount grants. DOM binding begins
 * only at this call and subsequent handle.update calls; handle.unmount ends it.
 * An initial binding failure disposes partial and completed scopes before it
 * rethrows. Already written DOM may remain inert; the root can be mounted again.
 *
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "binds only under the root it is handed: markup injected outside it stays unbound"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "an unreviewed mount refuses any origin but an opaque one, and any grant"
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "the development report lists exactly the grants a fixture widget used"
 */
function mountMarkup(root: Element, markup: TrustedHtml, options: MountOptions): MountHandle {
  if (!root || typeof root !== 'object' || root.nodeType !== 1) {
    throw mountError('FORMA_E_MOUNT_ARGS', 'the root must be an element');
  }
  if (!isTrustedHtml(markup)) {
    throw mountError('FORMA_E_MOUNT_ARGS', 'the markup must be trustedHtml()');
  }
  const tier = options?.tier;
  if (tier !== 'compiled' && tier !== 'reviewed' && tier !== 'unreviewed') {
    throw mountError('FORMA_E_MOUNT_ARGS', "options.tier must be 'compiled', 'reviewed' or 'unreviewed'");
  }
  if (tier === 'unreviewed' && (globalThis as { origin?: unknown }).origin !== 'null') {
    throw mountError('FORMA_E_MOUNT_ORIGIN', 'an unreviewed mount renders only in an opaque-origin frame');
  }
  if (tieredRoots.has(root)) throw mountError('FORMA_E_MOUNT_TWICE', 'this root is already mounted; update() its handle');
  const granted = resolveGrants(tier, options.grants);
  const config = options.config ?? {};
  let budget: number = LIMITS.STEP_BUDGET;
  if (config.exprBudget !== undefined) {
    if (!(typeof config.exprBudget === 'number' && Number.isFinite(config.exprBudget) && config.exprBudget > 0)) {
      throw mountError('FORMA_E_MOUNT_ARGS', 'config.exprBudget');
    }
    budget = Math.min(config.exprBudget, 10_000_000);
  }

  const id = ++mountSeq;
  // The development report: kept only in a development build (the build flag).
  const used: UsedGrants | null = (typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
    || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && sourceIsDev())
    ? { methods: new Set(), paths: new Set(), cookies: false, dom: false, navigate: false }
    : null;
  const ctx: MountCtx = {
    id,
    root,
    tier,
    name: config.name ?? (root.id ? `#${root.id}` : `mount-${id}`),
    fetch: granted.fetch,
    budget,
    diagnostics: config.diagnostics !== false,
    containment: config.autoContainment === true,
    bound: {
      root,
      dom: granted.dom,
      navigate: granted.navigate,
      use: used ? (grant: ExprGrant) => { used[grant] = true; } : noUse,
    },
    refetch: new Map(),
    scopes: new Set(),
    used,
  };

  tieredRoots.set(root, ctx);
  tieredCount++;
  root.replaceChildren();

  const reconcileInto = createReconciler({
    mountScope: (el) => mountScope(el, ctx),
    unmountScope: (el) => unmountScope(el, ctx),
    // Shared reconciler hooks: the explicit runtime has no body observer.
    disconnectObserver: () => {},
    reconnectObserver: () => {},
    batch,
    // Unreviewed markup is parsed once, in the root's context, stripped on
    // those nodes, and written as nodes (see refuseUnreviewed).
    strip: tier === 'unreviewed' ? (fragment) => { refuseUnreviewed(fragment, ctx, false); } : undefined,
  });
  const disposeAll = (): void => {
    for (const scope of Array.from(ctx.scopes)) unmountScope(scope, ctx);
  };
  const clear = (): void => {
    disposeAll();
    root.replaceChildren();
  };
  const render = (html: TrustedHtml): void => {
    if (!String(html).trim()) {
      clear();
      return;
    }
    reconcileInto(root, html);
    if (tier === 'unreviewed') {
      // Defence in depth: the strip ran on the nodes that were written, so
      // nothing should be here; if it is, fail closed.
      const reached = refuseUnreviewed(root, ctx, true);
      if (reached) {
        clear();
        throw mountError(reached, `${ctx.name}: unreviewed markup reached the document unstripped; the root was cleared`);
      }
    }
    if (ctx.containment) applyContainmentHints(root, { skipIfAlreadySet: true });
  };
  let live = true;
  const alive = (): void => {
    if (!live) throw mountError('FORMA_E_MOUNT_GONE', `${ctx.name} was unmounted`);
  };

  try {
    render(markup);
  } catch (err) {
    // A refused first render leaves no live work, including earlier scopes
    // completed before the failing scope. The original error remains the cause.
    disposeAll();
    ctx.refetch.clear();
    tieredRoots.delete(root);
    tieredCount--;
    throw err;
  }

  return {
    root,
    tier,
    name: ctx.name,
    update(next: TrustedHtml): void {
      alive();
      if (!isTrustedHtml(next)) {
        throw mountError('FORMA_E_MOUNT_ARGS', 'the markup must be trustedHtml()');
      }
      render(next);
    },
    unmount(): void {
      if (!live) return;
      live = false;
      disposeAll();
      root.replaceChildren();
      ctx.refetch.clear();
      tieredRoots.delete(root);
      tieredCount--;
    },
    grantsUsed(): GrantReport | null {
      return (typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
        || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && sourceIsDev())
        ? grantReport(used!)
        : null;
    },
  };
}

export type { TrustedHtml };

export {
  mountMarkup,
  trustedHtml,
  yieldToMain,
  applyContainmentHints,
  getDiagnostics,
  clearDiagnostics,
  getScopes,
  setScopeValue,
  resetScope,
};
