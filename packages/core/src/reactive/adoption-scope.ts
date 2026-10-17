/** Private compiled signal authority layered over unprivileged preparation. */
import { setActiveSub } from 'alien-signals';
import { checkIslandClaim, type ValidatedIsland } from '../dom/island-state.js';
import type { AdoptionCodec } from './adoption-hooks.js';
import { AdoptionLifecycle, AdoptionScopeError, type PreparationGroup, type PreparationOptions } from './adoption-lifecycle.js';
import type { SignalGetter, SignalSetter } from './signal.js';
export { AdoptionScopeError } from './adoption-lifecycle.js';

type Value = string | number | boolean | string[];
type Local = { get: SignalGetter<unknown>; set: SignalSetter<unknown>; group: PreparationGroup };
type Binding = { local: Local; codec: AdoptionCodec; site: number; group: PreparationGroup };
type Edit = Binding & { before: Value; baseline: Value; next: Value };

function untracked<T>(read: () => T): T {
  const previous = setActiveSub(undefined);
  try { return read(); } finally { setActiveSub(previous); }
}

function accepts(codec: AdoptionCodec, value: unknown): value is Value {
  switch (codec) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'string-array': {
      if (!Array.isArray(value)) return false;
      for (const item of value) if (typeof item !== 'string') return false;
      return true;
    }
  }
}

function copy(value: Value): Value { return Array.isArray(value) ? [...value] : value; }
function equal(a: unknown, b: Value): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : Object.is(a, b);
}

/** @internal Only the original checked 103 object permits local seed authority. */
export class AdoptionScope extends AdoptionLifecycle {
  private readonly builtins = new WeakMap<SignalGetter<unknown>, Local>();
  private readonly locals = new WeakMap<SignalGetter<unknown>, Local>();
  private readonly bindings = new WeakMap<() => unknown, Binding>();
  private readonly edits = new Map<SignalGetter<unknown>, Edit>();

  constructor(private readonly island: ValidatedIsland, options: PreparationOptions = {}) {
    super(options);
    checkIslandClaim(island);
    if (island.registration.mode !== 0) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
  }
  protected override check(): void { checkIslandClaim(this.island); super.check(); }

  capture<T>(get: SignalGetter<T>, set: SignalSetter<T>): void {
    if (this.state === 'preparing' && this.currentGroup.alive) {
      this.builtins.set(get, { get, set: set as SignalSetter<unknown>, group: this.currentGroup });
    }
  }
  enroll<T>(_site: number, [get, set]: [SignalGetter<T>, SignalSetter<T>]): void {
    const local = this.builtins.get(get);
    if (this.state === 'preparing' && local?.set === set && local.group.alive) this.locals.set(get, local);
  }
  writable<T>(read: () => T, get: SignalGetter<T>, codec: AdoptionCodec, site: number): () => T {
    const local = this.locals.get(get);
    if (this.state !== 'preparing' || !local?.group.alive || !this.currentGroup.alive) return read;
    const wrapper = () => read();
    this.bindings.set(wrapper, { local, codec, site, group: this.currentGroup });
    return wrapper;
  }

  override inputCodec(read:()=>unknown):AdoptionCodec|undefined {
    const binding=this.bindings.get(read);
    return this.state==='preparing'&&binding?.group.alive&&binding.local.group.alive?binding.codec:undefined;
  }

  /** Called only after the DOM planner detects a real normalized early edit. */
  override queueEdit(read: () => unknown, value: unknown): void {
    this.require('preparing');
    try {
      const binding = this.bindings.get(read);
      if (!binding?.group.alive || !binding.local.group.alive) throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET');
      const before = untracked(binding.local.get);
      if (!accepts(binding.codec, value) || !accepts(binding.codec, before)) {
        throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET', binding.site);
      }
      const prior = this.edits.get(binding.local.get);
      if (prior && (prior.codec !== binding.codec || !equal(prior.next, value))) {
        throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_CONFLICT', binding.site);
      }
      if (!prior) this.edits.set(binding.local.get, { ...binding, before, baseline: copy(before), next: copy(value) });
    } catch (cause) { this.abort(); throw cause; }
  }
  protected override checkSeeds(): void {
    for (const edit of this.edits.values()) {
      if (!edit.group.alive || !edit.local.group.alive) throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET', edit.site);
      if (!equal(untracked(edit.local.get), edit.baseline)) throw new AdoptionScopeError('FORMA_E_HYDRATE_VALUE', edit.site);
    }
  }
  protected override applySeeds(): void { for (const edit of this.edits.values()) edit.local.set(edit.next); }
  protected override rollbackSeeds(): void {
    // Default createSignal assignments only: no updater or equality callback.
    // Restore the exact original array reference before releasing the batch.
    for (const edit of this.edits.values()) edit.local.set(edit.before);
  }
  protected override clearSeeds(): void { this.edits.clear(); }
}
