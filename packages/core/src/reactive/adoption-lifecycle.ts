/** Private, unprivileged ownership kernel shared by direct and compiled adoption. */
import { effect as rawEffect, getActiveSub } from 'alien-signals';
import { withAdoptionSink, type AdoptionSink, type DeferredEffect } from './adoption-hooks.js';
import { openBatch, closeBatchWithoutRoot } from './batch.js';
import { createUnownedRoot, registerDisposer } from './root.js';
import { reportError } from './dev.js';
import { withAdoptionEffectFailure } from './effect.js';

type Phase = 'preparing' | 'validated' | 'seeding' | 'live' | 'aborted';
type Code = 'FORMA_E_HYDRATE_INPUT_TARGET' | 'FORMA_E_HYDRATE_INPUT_CONFLICT'
  | 'FORMA_E_HYDRATE_VALUE' | 'FORMA_E_HYDRATE_STRUCTURE'
  | 'FORMA_E_HYDRATE_EFFECT' | 'FORMA_E_HYDRATE_REF';
export class AdoptionScopeError extends Error {
  constructor(readonly code: Code, readonly site?: number) {
    super(`[forma] ${code}`); this.name = 'AdoptionScopeError';
  }
}

/** Internal owner identity, never a serialized site or a signal authority. */
export type PreparationGroup = {
  alive: boolean;
  disposers: (() => void)[];
  children: Set<PreparationGroup>;
  parent?: PreparationGroup;
};
export interface PreparedGroup<T> {
  readonly value: T;
  readonly alive: boolean;
  run<U>(fn: () => U): U;
  child<U>(fn: () => U): PreparedGroup<U>;
  dispose(): void;
}
export interface PreparationOptions {
  /** Recheck exact DOM observations; compiled scope adds its original claim. */
  check?: () => void;
  failure?: (error: unknown, code: Code) => void;
}
function group(): PreparationGroup { return { alive: true, disposers: [], children: new Set() }; }

/**
 * No ValidatedIsland, capture/enroll methods or built-in setter registry exists
 * here. Direct public hydrate can use this kernel without gaining seed authority.
 */
export class AdoptionLifecycle implements AdoptionSink {
  protected state: Phase = 'preparing';
  protected currentGroup = group();
  private readonly rootGroup = this.currentGroup;
  private invalidated = false;
  private batchOpen = false;
  private readonly readers: { flags: { flags: number }; group: PreparationGroup }[] = [];
  private readonly callbacks: (() => void)[] = [];

  constructor(private readonly options: PreparationOptions = {}) {}
  get phase(): Phase { return this.state; }
  protected require(phase: Phase): void {
    if (this.state !== phase || !this.currentGroup.alive) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
  }

  /** A disposer created after synchronous abort must run immediately as well. */
  protected own(dispose: () => void, owner = this.currentGroup): void {
    if (!owner.alive || this.state === 'aborted') dispose();
    else owner.disposers.push(dispose);
  }

  run<T>(fn: () => T): T {
    this.require('preparing');
    const owner = this.currentGroup;
    let result!: T, error: unknown, failed = false, dispose!: () => void;
    // Catch inside the raw root so a partial construction still returns its disposer.
    withAdoptionSink(this, () => createUnownedRoot(rootDispose => {
      dispose = rootDispose;
      try { result = fn(); } catch (cause) { failed = true; error = cause; }
    }));
    this.own(dispose, owner);
    if (failed) { this.abort(); throw error; }
    if (this.state === 'aborted' || !owner.alive) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
    return result;
  }

  /** Postcommit regions create fresh ordinary reactive owners, never another
   * preparation sink. Catch setup inside the root so partial construction and
   * late work after synchronous callback failure are still disposed. */
  private runLive<T>(fn: () => T): T {
    this.require('live');
    const owner=this.currentGroup;
    let result!:T, error:unknown, failed=false, dispose!:()=>void;
    withAdoptionSink(undefined,()=>withAdoptionEffectFailure(
      cause=>this.fail(cause,'FORMA_E_HYDRATE_EFFECT'),
      ()=>createUnownedRoot(rootDispose=>{
        dispose=rootDispose;
        try{result=fn();}catch(cause){failed=true;error=cause;}
      }),
    ));
    this.own(dispose,owner);
    if(failed){this.fail(error,'FORMA_E_HYDRATE_EFFECT');throw error;}
    if(this.state==='aborted'||!owner.alive)throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
    return result;
  }

  group<T>(fn: () => T): PreparedGroup<T> {
    if(this.state!=='preparing'&&this.state!=='live')throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
    this.require(this.state);
    const child=group();
    child.parent=this.currentGroup;
    this.currentGroup.children.add(child);
    const enter=<U>(build:()=>U):U=>{
      const previous=this.currentGroup;this.currentGroup=child;
      try{return build();}finally{this.currentGroup=previous;}
    };
    const run=<U>(build:()=>U):U=>enter(()=>this.state==='live'?this.runLive(build):this.run(build));
    const value=run(fn);
    return {value,get alive(){return child.alive;},run,
      child:<U>(build:()=>U)=>enter(()=>this.group(build)),
      dispose:()=>this.disposeGroup(child)};
  }

  private disposeGroup(owner: PreparationGroup): void {
    if (!owner.alive) return;
    owner.alive = false;
    owner.parent?.children.delete(owner);
    owner.parent = undefined;
    if (this.state !== 'live' && this.state !== 'aborted') this.invalidated = true;
    for (const child of owner.children) this.disposeGroup(child);
    owner.children.clear();
    for (const dispose of owner.disposers.splice(0)) {
      try { dispose(); } catch (error) { reportError(error, 'adoption cleanup'); }
    }
  }

  /** One tracked initial read; no second read just to install a writer. */
  observe<T>(read: () => T, write: (value: T) => void): T {
    this.require('preparing');
    const owner = this.currentGroup;
    let initial!: T, error: unknown, first = true, failed = false;
    // The owned initial root also catches roots/effects created by a reader;
    // these must not leak into an ambient effect that happened to trigger it.
    const dispose = this.run(() => rawEffect(() => {
      if (first) {
        first = false;
        this.readers.push({ flags: getActiveSub()!, group: owner });
        try { initial = read(); } catch (cause) { failed = true; error = cause; }
      } else if (this.state === 'live' && owner.alive) {
        try { write(read()); } catch (cause) { this.fail(cause, 'FORMA_E_HYDRATE_VALUE'); }
      } else this.invalidated = true;
    }));
    this.own(dispose, owner);
    if (failed) { this.abort(); throw error; }
    if (this.state === 'aborted' || !owner.alive) throw new AdoptionScopeError('FORMA_E_HYDRATE_STRUCTURE');
    return initial;
  }

  /** Unprivileged direct adoption can observe, but can never seed an early edit. */
  queueEdit(_read: () => unknown, _value: unknown): void {
    this.abort(); throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET');
  }

  deferEffect(start: DeferredEffect): (() => void) | undefined {
    return this.state === 'preparing' ? this.defer(start, 'FORMA_E_HYDRATE_EFFECT') : undefined;
  }
  deferRef(callback: () => void): () => void {
    return this.defer(() => { callback(); return () => {}; }, 'FORMA_E_HYDRATE_REF');
  }

  private defer(start: DeferredEffect, code: Code): () => void {
    this.require('preparing');
    const group = this.currentGroup;
    let cancelled = false, dispose: (() => void) | undefined;
    const cancel = () => { if (!cancelled) { cancelled = true; dispose?.(); } };
    registerDisposer(cancel);
    this.own(cancel, group);
    this.callbacks.push(() => {
      if (cancelled || !group.alive || this.state !== 'live') return;
      let failed = false, cause: unknown;
      try {
        // A separate owned root prevents an ambient effect flushing this commit
        // from accidentally owning these callbacks. cancel is also registered
        // with the original construction owner, preserving that owner's lifetime.
        // Catch inside setup so even a throwing ref leaves its partial roots and
        // effects disposable; nested effects inherit effect.ts's failure boundary.
        const startRoot = () => createUnownedRoot(rootDispose => {
          dispose = rootDispose;
          try { registerDisposer(start(error => this.fail(error, code))); }
          catch (error) { failed = true; cause = error; }
        });
        withAdoptionSink(undefined, () => withAdoptionEffectFailure(
          error => this.fail(error, 'FORMA_E_HYDRATE_EFFECT'), startRoot,
        ));
        if (failed) this.fail(cause, code);
        if (cancelled || !group.alive || this.state !== 'live') dispose?.();
      } catch (error) { this.fail(error, code); }
    });
    return cancel;
  }

  private fail(error: unknown, code: Code): void {
    if (this.state === 'aborted') return;
    this.abort();
    try {
      if (this.options.failure) this.options.failure(error, code);
      else reportError(error, 'adoption callback');
    } catch (reportingError) { reportError(reportingError, 'adoption error reporting'); }
  }

  protected check(): void { this.options.check?.(); }
  protected checkSeeds(): void {}
  protected applySeeds(): void {}
  protected rollbackSeeds(): void {}
  protected clearSeeds(): void {}
  private checkPrepared(): void {
    this.check();
    // alien-signals 3.1.2 Dirty/Pending, also used by effect.ts.
    if (this.invalidated || this.readers.some(item => item.group.alive && (item.flags.flags & (16 | 32)) !== 0)) {
      throw new AdoptionScopeError('FORMA_E_HYDRATE_VALUE');
    }
  }
  seal(): void {
    this.require('preparing');
    try { this.checkPrepared(); this.state = 'validated'; }
    catch (error) { this.abort(); throw error; }
  }
  seed(): void {
    this.require('validated');
    try {
      this.checkPrepared(); this.checkSeeds();
      openBatch(); this.batchOpen = true; this.state = 'seeding'; this.applySeeds();
    } catch (error) { this.abort(); throw error; }
  }
  publish(): void {
    this.require('seeding');
    try {
      this.check(); this.state = 'live'; this.clearSeeds();
      // Pending flags are only needed before commit. Do not retain stopped row
      // effect nodes in an island-wide observation inventory after publication.
      this.readers.length = 0;
      withAdoptionSink(undefined, () => this.closeBatch());
      for (const callback of this.callbacks.splice(0)) {
        if (this.state !== 'live') break;
        callback();
      }
    } catch (error) { this.abort(); throw error; }
  }
  private closeBatch(): void {
    if (!this.batchOpen) return;
    this.batchOpen = false; closeBatchWithoutRoot();
  }
  abort(): void {
    if (this.state === 'aborted') return;
    const rollback = this.state === 'seeding';
    this.state = 'aborted'; this.disposeGroup(this.rootGroup);
    if (rollback) this.rollbackSeeds();
    this.clearSeeds(); this.readers.length = 0; this.callbacks.length = 0; this.closeBatch();
  }
}
