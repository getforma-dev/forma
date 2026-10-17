/** Private construction mode. Description does not allocate or change DOM. */
export let describingAdoption = false;

export function withAdoptionDescription<T>(build: () => T, describe = true): T {
  const previous = describingAdoption;
  describingAdoption = describe;
  try { return build(); } finally { describingAdoption = previous; }
}

export interface ComponentDescription {
  readonly type: 'component';
  readonly component: (...args: never[]) => unknown;
  readonly receiver: undefined;
  readonly args: readonly unknown[];
}

/**
 * @internal Compiler output for admitted direct registered-child calls.
 * Callee and arguments are already evaluated once by JavaScript at this call.
 * Ordinary calls retain their exact argument count, including zero arguments.
 */
export function __adoptionChild<A extends unknown[], R>(
  receiver: undefined,
  component: (...args: A) => R,
  args: A,
): R {
  if (!describingAdoption) return Reflect.apply(component, receiver, args) as R;
  return Object.freeze({ type: 'component', receiver, component, args: Object.freeze([...args]) }) as R;
}

/** @internal Original DOM ternaries keep their ordinary lazy evaluation outside
 * description. The strict walker owns condition reads and branch preparation. */
// Verified by: src/dom/__tests__/adoption-conditional.test.ts > "describes without executing any thunk or allocating DOM, then retains the original readers"
export function __adoptionConditional<T, F>(
  test: () => unknown,
  consequent: () => T,
  alternate: () => F,
): T | F {
  if (!describingAdoption) return test() ? consequent() : alternate();
  return { type: 'show', conditional: true, condition: test, whenTrue: consequent, whenFalse: alternate } as T | F;
}

/** Descriptor returned by h() during adoption description instead of a real Element. */
export interface HydrationDescriptor {
  type: 'element';
  tag: string;
  props: Record<string, unknown> | null;
  children: unknown[];
}

/** Descriptor returned by createShow() during adoption description. */
export interface ShowDescriptor {
  type: 'show';
  /** Original compiler ternaries rerun selected values, unlike createShow. */
  conditional?: true;
  condition: () => unknown;
  whenTrue: () => unknown;
  whenFalse?: () => unknown;
}

/** Descriptor returned by createList() during adoption description. */
export interface ListDescriptor {
  type: 'list';
  items: () => unknown[];
  keyFn: (item: unknown) => string | number;
  renderFn: (item: unknown, index: () => number) => HTMLElement;
  options?: Record<string, unknown>;
}

/**
 * Descriptor returned by `h(Fragment, …)` and `fragment(…)` during adoption description.
 * A Fragment has no element of its own on the server: its children are
 * rendered in place, so adoption walks them as a range of the parent's nodes.
 */
export interface FragmentDescriptor {
  type: 'fragment';
  children: unknown[];
}

