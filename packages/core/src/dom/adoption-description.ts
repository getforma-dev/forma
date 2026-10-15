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
