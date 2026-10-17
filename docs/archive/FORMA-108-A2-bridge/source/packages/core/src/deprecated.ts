/** Runtime reconcile deprecation; its removal belongs to FORMA-108. */
export const DEPRECATIONS = {
  FORMA_W_DEPRECATED_RECONCILE:
    'reconcile() from @getforma/core/runtime binds markup with every power the runtime has (the tierless ' +
    'path) and will be removed in 3.0.0. Mount through mountMarkup(root, markup, { tier, grants }), ' +
    'which binds only under the root it is handed, with the grants it names.',
} as const;

/** The code a deprecated entry logs. */
export type DeprecationCode = keyof typeof DEPRECATIONS;

declare const process: { env?: Record<string, string | undefined> } | undefined;
declare const __FORMA_DEV__: boolean | undefined;

/**
 * What `__DEV__` falls back to when nothing replaced the build flag, that is
 * when core runs from source: `isDev()` in `src/reactive/dev.ts`, restated.
 * It is restated rather than imported because importing `dev.ts` also runs its
 * duplicate-instance registration. Keeping this check local lets production
 * builds eliminate the runtime warning without an extra reactive import.
 */
export function sourceIsDev(): boolean {
  if (typeof process !== 'undefined') {
    return process!.env?.NODE_ENV !== 'production';
  }
  return typeof __FORMA_DEV__ !== 'undefined' ? !!__FORMA_DEV__ : false;
}

/**
 * Log `code`'s deprecation once per process. The codes already logged live on
 * `globalThis` under a `Symbol.for` key, so a second copy of an entry (a test
 * that resets modules, a development server that reloads one) stays quiet.
 *
 * Verified by: src/__tests__/runtime-tiered-mount.test.ts > "reconcile behaves as at 2.0.x and warns once in development"
 */
export function warnDeprecated(code: DeprecationCode): void {
  const host = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  const key = Symbol.for('@getforma/core#deprecations');
  const logged = host[key] ?? (host[key] = new Set<string>());
  if (logged.has(code)) return;
  logged.add(code);
  console.warn(`[forma] ${code}: ${DEPRECATIONS[code]}`);
}
