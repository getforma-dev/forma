"use strict";
var FormaJS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target2, all) => {
    for (var name in all)
      __defProp(target2, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/core/dist/forma.esm.js
  var forma_esm_exports = {};
  __export(forma_esm_exports, {
    $: () => $,
    $$: () => $$,
    Fragment: () => Fragment,
    __adoptionChild: () => __adoptionChild,
    __adoptionConditional: () => __adoptionConditional,
    __adoptionSignal: () => __adoptionSignal,
    __adoptionWritable: () => __adoptionWritable,
    __islandRegistration: () => __islandRegistration,
    activateIslands: () => activateIslands,
    addClass: () => addClass,
    batch: () => batch,
    browserOnly: () => browserOnly,
    children: () => children,
    cleanup: () => cleanup,
    closest: () => closest,
    createBus: () => createBus,
    createComputed: () => createComputed,
    createContext: () => createContext,
    createEffect: () => createEffect,
    createErrorBoundary: () => createErrorBoundary,
    createHistory: () => createHistory,
    createList: () => createList,
    createMemo: () => createMemo,
    createPortal: () => createPortal,
    createReducer: () => createReducer,
    createRef: () => createRef,
    createResource: () => createResource,
    createRoot: () => createRoot,
    createShow: () => createShow,
    createSignal: () => createSignal,
    createStore: () => createStore,
    createSuspense: () => createSuspense,
    createSwitch: () => createSwitch,
    createText: () => createText,
    createUnownedRoot: () => createUnownedRoot,
    deactivateAllIslands: () => deactivateAllIslands,
    deactivateIsland: () => deactivateIsland,
    defineComponent: () => defineComponent,
    delegate: () => delegate,
    disposeComponent: () => disposeComponent,
    fragment: () => fragment,
    getBatchDepth: () => getBatchDepth,
    getOwner: () => getOwner,
    getSignalName: () => getSignalName,
    h: () => h,
    hydrateIsland: () => hydrateIsland,
    inject: () => inject,
    isComputed: () => isComputed,
    isEffect: () => isEffect,
    isEffectScope: () => isEffectScope,
    isSignal: () => isSignal,
    mount: () => mount,
    nextSibling: () => nextSibling,
    on: () => on,
    onCleanup: () => onCleanup,
    onError: () => onError,
    onIntersect: () => onIntersect,
    onKey: () => onKey,
    onMount: () => onMount,
    onMutation: () => onMutation,
    onResize: () => onResize,
    onUnmount: () => onUnmount,
    parent: () => parent,
    persist: () => persist,
    prevSibling: () => prevSibling,
    provide: () => provide,
    reconcileList: () => reconcileList,
    removeClass: () => removeClass,
    runWithOwner: () => runWithOwner,
    sanitizePropsDeep: () => sanitizePropsDeep,
    setAttr: () => setAttr,
    setHTMLUnsafe: () => setHTMLUnsafe,
    setStyle: () => setStyle,
    setText: () => setText,
    siblings: () => siblings,
    svg: () => svg,
    template: () => template,
    templateMany: () => templateMany,
    toggleClass: () => toggleClass,
    trackDisposer: () => trackDisposer,
    trigger: () => trigger,
    trustedHtml: () => trustedHtml,
    unprovide: () => unprovide,
    untrack: () => untrack,
    value: () => value
  });
  function createReactiveSystem({ update, notify, unwatched }) {
    return {
      link: link2,
      unlink: unlink2,
      propagate: propagate2,
      checkDirty: checkDirty2,
      shallowPropagate: shallowPropagate2
    };
    function link2(dep, sub, version) {
      let prevDep = sub.depsTail;
      if (prevDep !== void 0 && prevDep.dep === dep)
        return;
      let nextDep = prevDep !== void 0 ? prevDep.nextDep : sub.deps;
      if (nextDep !== void 0 && nextDep.dep === dep) {
        nextDep.version = version, sub.depsTail = nextDep;
        return;
      }
      let prevSub = dep.subsTail;
      if (prevSub !== void 0 && prevSub.version === version && prevSub.sub === sub)
        return;
      let newLink = sub.depsTail = dep.subsTail = {
        version,
        dep,
        sub,
        prevDep,
        nextDep,
        prevSub,
        nextSub: void 0
      };
      nextDep !== void 0 && (nextDep.prevDep = newLink), prevDep !== void 0 ? prevDep.nextDep = newLink : sub.deps = newLink, prevSub !== void 0 ? prevSub.nextSub = newLink : dep.subs = newLink;
    }
    function unlink2(link3, sub = link3.sub) {
      let dep = link3.dep, prevDep = link3.prevDep, nextDep = link3.nextDep, nextSub = link3.nextSub, prevSub = link3.prevSub;
      return nextDep !== void 0 ? nextDep.prevDep = prevDep : sub.depsTail = prevDep, prevDep !== void 0 ? prevDep.nextDep = nextDep : sub.deps = nextDep, nextSub !== void 0 ? nextSub.prevSub = prevSub : dep.subsTail = prevSub, prevSub !== void 0 ? prevSub.nextSub = nextSub : (dep.subs = nextSub) === void 0 && unwatched(dep), nextDep;
    }
    function propagate2(link3) {
      let next = link3.nextSub, stack;
      top: do {
        let sub = link3.sub, flags = sub.flags;
        if (flags & 60 ? flags & 12 ? flags & 4 ? !(flags & 48) && isValidLink(link3, sub) ? (sub.flags = flags | 40, flags &= 1) : flags = 0 : sub.flags = flags & -9 | 32 : flags = 0 : sub.flags = flags | 32, flags & 2 && notify(sub), flags & 1) {
          let subSubs = sub.subs;
          if (subSubs !== void 0) {
            let nextSub = (link3 = subSubs).nextSub;
            nextSub !== void 0 && (stack = { value: next, prev: stack }, next = nextSub);
            continue;
          }
        }
        if ((link3 = next) !== void 0) {
          next = link3.nextSub;
          continue;
        }
        for (; stack !== void 0; )
          if (link3 = stack.value, stack = stack.prev, link3 !== void 0) {
            next = link3.nextSub;
            continue top;
          }
        break;
      } while (true);
    }
    function checkDirty2(link3, sub) {
      let stack, checkDepth = 0, dirty = false;
      top: do {
        let dep = link3.dep, flags = dep.flags;
        if (sub.flags & 16)
          dirty = true;
        else if ((flags & 17) === 17) {
          if (update(dep)) {
            let subs = dep.subs;
            subs.nextSub !== void 0 && shallowPropagate2(subs), dirty = true;
          }
        } else if ((flags & 33) === 33) {
          (link3.nextSub !== void 0 || link3.prevSub !== void 0) && (stack = { value: link3, prev: stack }), link3 = dep.deps, sub = dep, ++checkDepth;
          continue;
        }
        if (!dirty) {
          let nextDep = link3.nextDep;
          if (nextDep !== void 0) {
            link3 = nextDep;
            continue;
          }
        }
        for (; checkDepth--; ) {
          let firstSub = sub.subs, hasMultipleSubs = firstSub.nextSub !== void 0;
          if (hasMultipleSubs ? (link3 = stack.value, stack = stack.prev) : link3 = firstSub, dirty) {
            if (update(sub)) {
              hasMultipleSubs && shallowPropagate2(firstSub), sub = link3.sub;
              continue;
            }
            dirty = false;
          } else
            sub.flags &= -33;
          sub = link3.sub;
          let nextDep = link3.nextDep;
          if (nextDep !== void 0) {
            link3 = nextDep;
            continue top;
          }
        }
        return dirty;
      } while (true);
    }
    function shallowPropagate2(link3) {
      do {
        let sub = link3.sub, flags = sub.flags;
        (flags & 48) === 32 && (sub.flags = flags | 16, (flags & 6) === 2 && notify(sub));
      } while ((link3 = link3.nextSub) !== void 0);
    }
    function isValidLink(checkLink, sub) {
      let link3 = sub.depsTail;
      for (; link3 !== void 0; ) {
        if (link3 === checkLink)
          return true;
        link3 = link3.prevDep;
      }
      return false;
    }
  }
  var cycle = 0;
  var batchDepth = 0;
  var notifyIndex = 0;
  var queuedLength = 0;
  var activeSub;
  var queued = [];
  var { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
    update(node) {
      return node.depsTail !== void 0 ? updateComputed(node) : updateSignal(node);
    },
    notify(effect2) {
      let insertIndex = queuedLength, firstInsertedIndex = insertIndex;
      do
        if (queued[insertIndex++] = effect2, effect2.flags &= -3, effect2 = effect2.subs?.sub, effect2 === void 0 || !(effect2.flags & 2))
          break;
      while (true);
      for (queuedLength = insertIndex; firstInsertedIndex < --insertIndex; ) {
        let left = queued[firstInsertedIndex];
        queued[firstInsertedIndex++] = queued[insertIndex], queued[insertIndex] = left;
      }
    },
    unwatched(node) {
      node.flags & 1 ? node.depsTail !== void 0 && (node.depsTail = void 0, node.flags = 17, purgeDeps(node)) : effectScopeOper.call(node);
    }
  });
  function getActiveSub() {
    return activeSub;
  }
  function setActiveSub(sub) {
    let prevSub = activeSub;
    return activeSub = sub, prevSub;
  }
  function getBatchDepth() {
    return batchDepth;
  }
  function startBatch() {
    ++batchDepth;
  }
  function endBatch() {
    --batchDepth || flush();
  }
  function isSignal(fn) {
    return fn.name === "bound " + signalOper.name;
  }
  function isComputed(fn) {
    return fn.name === "bound " + computedOper.name;
  }
  function isEffect(fn) {
    return fn.name === "bound " + effectOper.name;
  }
  function isEffectScope(fn) {
    return fn.name === "bound " + effectScopeOper.name;
  }
  function signal(initialValue) {
    return signalOper.bind({
      currentValue: initialValue,
      pendingValue: initialValue,
      subs: void 0,
      subsTail: void 0,
      flags: 1
    });
  }
  function computed(getter) {
    return computedOper.bind({
      value: void 0,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 0,
      getter
    });
  }
  function effect(fn) {
    let e = {
      fn,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 6
    }, prevSub = setActiveSub(e);
    prevSub !== void 0 && link(e, prevSub, 0);
    try {
      e.fn();
    } finally {
      activeSub = prevSub, e.flags &= -5;
    }
    return effectOper.bind(e);
  }
  function effectScope(fn) {
    let e = {
      deps: void 0,
      depsTail: void 0,
      subs: void 0,
      subsTail: void 0,
      flags: 0
    }, prevSub = setActiveSub(e);
    prevSub !== void 0 && link(e, prevSub, 0);
    try {
      fn();
    } finally {
      activeSub = prevSub;
    }
    return effectScopeOper.bind(e);
  }
  function trigger(fn) {
    let sub = {
      deps: void 0,
      depsTail: void 0,
      flags: 2
    }, prevSub = setActiveSub(sub);
    try {
      fn();
    } finally {
      activeSub = prevSub;
      let link2 = sub.deps;
      for (; link2 !== void 0; ) {
        let dep = link2.dep;
        link2 = unlink(link2, sub);
        let subs = dep.subs;
        subs !== void 0 && (sub.flags = 0, propagate(subs), shallowPropagate(subs));
      }
      batchDepth || flush();
    }
  }
  function updateComputed(c) {
    ++cycle, c.depsTail = void 0, c.flags = 5;
    let prevSub = setActiveSub(c);
    try {
      let oldValue = c.value;
      return oldValue !== (c.value = c.getter(oldValue));
    } finally {
      activeSub = prevSub, c.flags &= -5, purgeDeps(c);
    }
  }
  function updateSignal(s) {
    return s.flags = 1, s.currentValue !== (s.currentValue = s.pendingValue);
  }
  function run(e) {
    let flags = e.flags;
    if (flags & 16 || flags & 32 && checkDirty(e.deps, e)) {
      ++cycle, e.depsTail = void 0, e.flags = 6;
      let prevSub = setActiveSub(e);
      try {
        e.fn();
      } finally {
        activeSub = prevSub, e.flags &= -5, purgeDeps(e);
      }
    } else
      e.flags = 2;
  }
  function flush() {
    try {
      for (; notifyIndex < queuedLength; ) {
        let effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0, run(effect2);
      }
    } finally {
      for (; notifyIndex < queuedLength; ) {
        let effect2 = queued[notifyIndex];
        queued[notifyIndex++] = void 0, effect2.flags |= 10;
      }
      notifyIndex = 0, queuedLength = 0;
    }
  }
  function computedOper() {
    let flags = this.flags;
    if (flags & 16 || flags & 32 && (checkDirty(this.deps, this) || (this.flags = flags & -33, false))) {
      if (updateComputed(this)) {
        let subs = this.subs;
        subs !== void 0 && shallowPropagate(subs);
      }
    } else if (!flags) {
      this.flags = 5;
      let prevSub = setActiveSub(this);
      try {
        this.value = this.getter();
      } finally {
        activeSub = prevSub, this.flags &= -5;
      }
    }
    let sub = activeSub;
    return sub !== void 0 && link(this, sub, cycle), this.value;
  }
  function signalOper(...value2) {
    if (value2.length) {
      if (this.pendingValue !== (this.pendingValue = value2[0])) {
        this.flags = 17;
        let subs = this.subs;
        subs !== void 0 && (propagate(subs), batchDepth || flush());
      }
    } else {
      if (this.flags & 16 && updateSignal(this)) {
        let subs = this.subs;
        subs !== void 0 && shallowPropagate(subs);
      }
      let sub = activeSub;
      for (; sub !== void 0; ) {
        if (sub.flags & 3) {
          link(this, sub, cycle);
          break;
        }
        sub = sub.subs?.sub;
      }
      return this.currentValue;
    }
  }
  function effectOper() {
    effectScopeOper.call(this);
  }
  function effectScopeOper() {
    this.depsTail = void 0, this.flags = 0, purgeDeps(this);
    let sub = this.subs;
    sub !== void 0 && unlink(sub);
  }
  function purgeDeps(sub) {
    let depsTail = sub.depsTail, dep = depsTail !== void 0 ? depsTail.nextDep : sub.deps;
    for (; dep !== void 0; )
      dep = unlink(dep, sub);
  }
  var _errorHandlers = /* @__PURE__ */ new Set();
  function onError(handler) {
    return _errorHandlers.add(handler), () => {
      _errorHandlers.delete(handler);
    };
  }
  function reportError(error, source) {
    for (let handler of _errorHandlers)
      try {
        handler(error, source ? { source } : {});
      } catch {
      }
  }
  var active;
  function withAdoptionSink(sink, fn) {
    let previous = active;
    active = sink;
    try {
      return fn();
    } finally {
      active = previous;
    }
  }
  function recordAdoptionSignal(get, set) {
    active?.capture?.(get, set);
  }
  function __adoptionSignal(site, pair) {
    return active?.enroll?.(site, pair), pair;
  }
  function __adoptionWritable(read, get, codec, site) {
    return active?.writable?.(read, get, codec, site) ?? read;
  }
  function deferAdoptionEffect(fn, start) {
    return active?.deferEffect?.((fail) => start(fn, fail));
  }
  var callbacks;
  function withAdoptionCallbacks(runner, fn) {
    let previous = callbacks;
    callbacks = runner;
    try {
      return fn();
    } finally {
      callbacks = previous;
    }
  }
  function getAdoptionCallbacks() {
    return callbacks;
  }
  function bindAdoptionCallback(fn, runner) {
    return () => {
      let current3 = runner ?? callbacks;
      return current3 ? withAdoptionCallbacks(current3, () => current3(fn)) : fn();
    };
  }
  var signalNames = /* @__PURE__ */ new WeakMap();
  function getSignalName(fn) {
    return typeof fn == "function" ? signalNames.get(fn) : void 0;
  }
  function value(v) {
    return () => v;
  }
  function applySignalSet(s, v, equals) {
    if (typeof v != "function") {
      if (!equals) {
        s(v);
        return;
      }
      let prevSub2 = setActiveSub(void 0), prev2 = s();
      if (setActiveSub(prevSub2), equals(prev2, v)) return;
      s(v), Object.is(prev2, v) && forceNotify(s);
      return;
    }
    let prevSub = setActiveSub(void 0), prev = s();
    setActiveSub(prevSub);
    let next = v(prev);
    equals && equals(prev, next) || (s(next), equals && Object.is(prev, next) && forceNotify(s));
  }
  function forceNotify(s) {
    trigger(() => {
      s();
    });
  }
  function createSignal(initialValue, options) {
    let s = signal(initialValue), getter = s, eq = options?.equals, setter = (v) => applySignalSet(s, v, eq);
    return eq || recordAdoptionSignal(getter, setter), [getter, setter];
  }
  var currentOwner = null;
  function getOwner() {
    return currentOwner;
  }
  function runWithOwner(owner, fn) {
    let prev = currentOwner;
    currentOwner = owner;
    try {
      return fn();
    } finally {
      currentOwner = prev;
    }
  }
  function runWithoutRoot(fn) {
    let prevOwner = currentOwner;
    currentOwner = null;
    try {
      return fn();
    } finally {
      currentOwner = prevOwner;
    }
  }
  function registerOwnerDisposer(owner, dispose) {
    owner.disposers.push(dispose);
  }
  function createChildOwner() {
    return { disposers: [] };
  }
  function disposeOwner(owner) {
    let ds = owner.disposers;
    for (let d of ds)
      try {
        d();
      } catch {
      }
    ds.length = 0;
  }
  function createRootImpl(fn, owned) {
    let scope = { disposers: [], scopeDispose: null }, parentOwner = owned ? currentOwner : null;
    let prevOwner = currentOwner;
    currentOwner = scope;
    let disposed = false, setupComplete = false, disposeRequestedDuringSetup = false, runDisposers = () => {
      for (let d of scope.disposers)
        try {
          d();
        } catch {
        }
      scope.disposers.length = 0;
    }, runTeardown = () => {
      if (scope.scopeDispose) {
        try {
          scope.scopeDispose();
        } catch {
        }
        scope.scopeDispose = null;
      }
      runDisposers();
    }, dispose = () => {
      if (!disposed) {
        if (disposed = true, !setupComplete) {
          disposeRequestedDuringSetup = true, runDisposers();
          return;
        }
        runTeardown();
      }
    };
    parentOwner && parentOwner.disposers.push(dispose);
    let result;
    try {
      if (owned)
        scope.scopeDispose = effectScope(() => {
          result = fn(dispose);
        });
      else {
        let prevSub = setActiveSub(void 0);
        try {
          scope.scopeDispose = effectScope(() => {
            result = fn(dispose);
          });
        } finally {
          setActiveSub(prevSub);
        }
      }
      setupComplete = true, disposeRequestedDuringSetup && runTeardown();
    } finally {
      currentOwner = prevOwner;
    }
    return result;
  }
  function createRoot(fn) {
    return createRootImpl(fn, true);
  }
  function createUnownedRoot(fn) {
    return createRootImpl(fn, false);
  }
  function registerDisposer(dispose) {
    currentOwner && currentOwner.disposers.push(dispose);
  }
  function hasActiveRoot() {
    return currentOwner !== null;
  }
  var currentCleanupCollector = null;
  function onCleanup(fn) {
    currentCleanupCollector?.(fn);
  }
  function setCleanupCollector(collector) {
    let prev = currentCleanupCollector;
    return currentCleanupCollector = collector, prev;
  }
  var active2;
  function withAdoptionEvents(wrap, build) {
    let previous = active2;
    active2 = wrap;
    try {
      return build();
    } finally {
      active2 = previous;
    }
  }
  var getAdoptionEvents = () => active2;
  function adoptionListener(listener) {
    return active2?.(listener) ?? listener;
  }
  var adoptionFailure;
  var adoptionInternalEffect;
  function withAdoptionEffectFailure(failure, fn) {
    let previous = adoptionFailure, previousReader = adoptionInternalEffect;
    adoptionFailure = failure, adoptionInternalEffect = (reader) => createEffectNow(reader, failure, true);
    try {
      return fn();
    } finally {
      adoptionFailure = previous, adoptionInternalEffect = previousReader;
    }
  }
  var POOL_SIZE = 32;
  var MAX_REENTRANT_RUNS = 100;
  var pool = [];
  var poolIdx = POOL_SIZE;
  var PENDING = 32;
  function acquireArray() {
    if (poolIdx > 0) {
      let arr = pool[--poolIdx] ?? [];
      return arr.length = 0, arr;
    }
    return [];
  }
  function releaseArray(arr) {
    arr.length = 0, poolIdx < POOL_SIZE && (pool[poolIdx++] = arr);
  }
  function runCleanup(fn) {
    if (fn !== void 0)
      try {
        fn();
      } catch (e) {
        reportError(e, "effect cleanup");
      }
  }
  function runCleanups(bag) {
    if (bag !== void 0)
      for (let i = 0; i < bag.length; i++)
        try {
          bag[i]();
        } catch (e) {
          reportError(e, "effect cleanup");
        }
  }
  function internalEffect(fn) {
    if (adoptionInternalEffect) return adoptionInternalEffect(fn);
    let events = getAdoptionEvents(), callback = bindAdoptionCallback(fn, getAdoptionCallbacks()), run2 = () => withAdoptionEvents(events, callback), firstRun = true, dispose = effect(() => {
      if (firstRun) {
        firstRun = false, run2();
        return;
      }
      try {
        run2();
      } catch (e) {
        reportError(e, "binding");
      }
    });
    return hasActiveRoot() && registerDisposer(dispose), dispose;
  }
  function createEffect(fn) {
    return deferAdoptionEffect(fn, createEffectNow) ?? createEffectNow(fn, adoptionFailure);
  }
  function createEffectNow(fn, failure, initialThrow = false) {
    let ownerAtCreate = getOwner(), callbacks2 = getAdoptionCallbacks(), runCallback = bindAdoptionCallback(fn, callbacks2), events = getAdoptionEvents(), childOwner = createChildOwner(), internalReader = failure ? (reader) => createEffectNow(reader, failure, true) : void 0, cleanup2, cleanupBag, nextCleanup, nextCleanupBag, disposed = false, firstRun = true, initialError, addCleanup = (cb) => {
      if (cb = bindAdoptionCallback(cb, callbacks2), nextCleanupBag !== void 0) {
        nextCleanupBag.push(cb);
        return;
      }
      if (nextCleanup !== void 0) {
        let bag = acquireArray();
        bag.push(nextCleanup, cb), nextCleanup = void 0, nextCleanupBag = bag;
        return;
      }
      nextCleanup = cb;
    }, cleanCurrentRun = () => {
      disposeOwner(childOwner), cleanup2 !== void 0 && (runCleanup(cleanup2), cleanup2 = void 0), cleanupBag !== void 0 && (runCleanups(cleanupBag), releaseArray(cleanupBag), cleanupBag = void 0);
    }, runOnce = () => {
      let initial2 = firstRun;
      firstRun = false, cleanCurrentRun(), nextCleanup = void 0, nextCleanupBag = void 0;
      let prevCollector = setCleanupCollector(addCleanup), previousFailure = adoptionFailure, previousReader = adoptionInternalEffect;
      adoptionFailure = failure, adoptionInternalEffect = internalReader;
      try {
        let result = withAdoptionEvents(events, () => runWithOwner(childOwner, runCallback));
        typeof result == "function" && addCleanup(result), nextCleanupBag !== void 0 ? cleanupBag = nextCleanupBag : nextCleanup !== void 0 && (cleanup2 = nextCleanup);
      } catch (e) {
        if (nextCleanupBag !== void 0 ? cleanupBag = nextCleanupBag : nextCleanup !== void 0 && (cleanup2 = nextCleanup), initialThrow && initial2)
          return initialError = { error: e }, false;
        if (failure)
          return failure(e), false;
        reportError(e, "effect");
      } finally {
        setCleanupCollector(prevCollector), adoptionFailure = previousFailure, adoptionInternalEffect = previousReader, disposed && cleanCurrentRun();
      }
    }, dispose = effect(() => {
      let node = getActiveSub(), reentrantRuns = 0;
      do {
        if (node && (node.flags &= ~PENDING), runOnce() === false || disposed || node === void 0 || (node.flags & PENDING) === 0) break;
        if (++reentrantRuns >= MAX_REENTRANT_RUNS) {
          node.flags &= ~PENDING;
          let error = new Error(`createEffect exceeded ${MAX_REENTRANT_RUNS} self-triggered re-runs (cycle?)`);
          failure ? failure(error) : reportError(error, "effect");
          break;
        }
      } while (true);
    }), wrappedDispose = () => {
      disposed || (disposed = true, dispose(), cleanCurrentRun());
    };
    if (initialError)
      throw wrappedDispose(), initialError.error;
    return ownerAtCreate && registerOwnerDisposer(ownerAtCreate, wrappedDispose), wrappedDispose;
  }
  var ERR = /* @__PURE__ */ Symbol("formaComputedError");
  function isErrBox(v) {
    return typeof v == "object" && v !== null && ERR in v;
  }
  function createComputed(fn) {
    let errored = false, error, lastGood, raw = computed(() => {
      try {
        let v = fn(lastGood);
        return errored = false, error = void 0, lastGood = v, v;
      } catch (e) {
        return errored = true, error = e, reportError(e, "computed"), { [ERR]: e };
      }
    }), reader = () => {
      let v = raw();
      if (errored || isErrBox(v)) throw error;
      return v;
    };
    return Object.defineProperty(reader, "name", { value: raw.name, configurable: true }), reader;
  }
  var createMemo = createComputed;
  function batch(fn) {
    startBatch();
    try {
      fn();
    } finally {
      endBatch();
    }
  }
  function openBatch() {
    startBatch();
  }
  function closeBatchWithoutRoot() {
    runWithoutRoot(endBatch);
  }
  function untrack(fn) {
    let prev = setActiveSub(void 0);
    try {
      return fn();
    } finally {
      setActiveSub(prev);
    }
  }
  function on(deps, fn, options) {
    let prev, isFirst = true;
    return () => {
      let value2 = deps();
      if (options?.defer && isFirst) {
        isFirst = false, prev = value2;
        return;
      }
      let result = untrack(() => fn(value2, prev));
      return prev = value2, result;
    };
  }
  function createRef(initialValue) {
    return { current: initialValue };
  }
  function createReducer(reducer, initialState) {
    let [state, setState] = createSignal(initialState);
    return [state, (action) => {
      setState((prev) => reducer(prev, action));
    }];
  }
  var currentSuspenseContext = null;
  var suspenseStack = [];
  function pushSuspenseContext(ctx) {
    suspenseStack.push(currentSuspenseContext), currentSuspenseContext = ctx;
  }
  function popSuspenseContext() {
    currentSuspenseContext = suspenseStack.pop() ?? null;
  }
  function getSuspenseContext() {
    return currentSuspenseContext;
  }
  function createResource(source, fetcher, options) {
    let [data2, setData] = createSignal(options?.initialValue), [loading, setLoading] = createSignal(false), [error, setError] = createSignal(void 0), suspenseCtx = getSuspenseContext(), abortController = null, fetchVersion = 0, doFetch = () => {
      let sourceValue = untrack(source);
      abortController && abortController.abort();
      let controller = new AbortController();
      abortController = controller;
      let version = ++fetchVersion, isLatest = () => version === fetchVersion, suspensePending = false;
      suspenseCtx && (suspenseCtx.increment(), suspensePending = true), batch(() => {
        setLoading(true), setError(void 0);
      });
      let promise;
      try {
        promise = Promise.resolve(fetcher(sourceValue, { signal: controller.signal }));
      } catch (err) {
        promise = Promise.reject(err);
      }
      promise.then((result) => {
        isLatest() && !controller.signal.aborted && batch(() => {
          setData(() => result), setLoading(false);
        });
      }).catch((err) => {
        isLatest() && !controller.signal.aborted && err?.name !== "AbortError" && batch(() => {
          setError(err), setLoading(false);
        });
      }).finally(() => {
        suspensePending && suspenseCtx?.decrement(), isLatest() && abortController === controller && (abortController = null);
      });
    };
    internalEffect(() => {
      source(), doFetch();
    }), hasActiveRoot() && registerDisposer(() => {
      fetchVersion++, abortController && (abortController.abort(), abortController = null);
    });
    let resource = (() => data2());
    return resource.loading = loading, resource.error = error, resource.refetch = doFetch, resource.mutate = (value2) => setData(() => value2), resource;
  }
  var describingAdoption = false;
  function withAdoptionDescription(build, describe2 = true) {
    let previous = describingAdoption;
    describingAdoption = describe2;
    try {
      return build();
    } finally {
      describingAdoption = previous;
    }
  }
  function __adoptionChild(receiver, component, args) {
    return describingAdoption ? Object.freeze({ type: "component", receiver, component, args: Object.freeze([...args]) }) : Reflect.apply(component, receiver, args);
  }
  function __adoptionConditional(test, consequent, alternate) {
    return describingAdoption ? { type: "show", conditional: true, condition: test, whenTrue: consequent, whenFalse: alternate } : test() ? consequent() : alternate();
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  var MATHML_NS = "http://www.w3.org/1998/Math/MathML";
  var current = null;
  function getNamespace() {
    return current;
  }
  function withNamespace(ns, build) {
    if (ns === void 0 || ns === current) return build();
    let prev = current;
    current = ns;
    try {
      return build();
    } finally {
      current = prev;
    }
  }
  var MATHML_TEXT_POINTS = /* @__PURE__ */ new Set(["mi", "mo", "mn", "ms", "mtext"]);
  function contentNs(parent2) {
    let el = parent2, ns = el && el.namespaceURI;
    if (ns === SVG_NS) {
      let name = el.localName;
      return name === "foreignObject" || name === "desc" || name === "title" ? null : SVG_NS;
    }
    if (ns === MATHML_NS) {
      let name = el.localName;
      return MATHML_TEXT_POINTS.has(name) || name === "annotation-xml" && /^(text\/html|application\/xhtml\+xml)$/i.test(el.getAttribute("encoding") ?? "") ? null : MATHML_NS;
    }
    return null;
  }
  function insertNs(parent2) {
    return parent2.nodeType === 1 ? contentNs(parent2) : void 0;
  }
  function isFormControlProperty(el, key) {
    return key === "value" ? el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLOptionElement : key === "checked" && el instanceof HTMLInputElement || key === "selected" && el instanceof HTMLOptionElement;
  }
  function writeFormControlProperty(el, key, value2) {
    if (key === "text") {
      let area = el, next2 = value2 == null ? "" : String(value2);
      area.defaultValue !== next2 && (area.defaultValue = next2), area.value !== next2 && (area.value = next2);
      return;
    }
    if (key === "value") {
      let control2 = el;
      if (control2 instanceof HTMLSelectElement && control2.multiple && Array.isArray(value2)) {
        let selected = new Set(value2.map(String));
        for (let option of Array.from(control2.options)) {
          let next3 = selected.has(option.value);
          option.selected !== next3 && (option.selected = next3);
        }
        return;
      }
      let next2 = value2 == null ? "" : String(value2);
      if (control2 instanceof HTMLInputElement && control2.type === "file" && next2 !== "" || (value2 == null ? el.removeAttribute("value") : el.getAttribute("value") !== next2 && el.setAttribute("value", next2), control2 instanceof HTMLOptionElement)) return;
      control2.value !== next2 && (control2.value = next2);
      return;
    }
    let next = !!value2;
    if (key === "checked") {
      let input = el;
      input.checked !== next && (input.checked = next);
    } else {
      let option = el;
      option.selected !== next && (option.selected = next);
    }
    let attribute = key === "checked" ? "checked" : "selected";
    next ? el.setAttribute(attribute, "") : el.removeAttribute(attribute);
  }
  function isReactiveTextOnly(children2) {
    let reactive = false;
    for (let child2 of children2)
      if (typeof child2 == "function") reactive = true;
      else if (child2 != null && typeof child2 != "string" && typeof child2 != "number" && typeof child2 != "boolean") return false;
    return reactive;
  }
  function childText(children2) {
    let text3 = "";
    for (let child2 of children2) {
      let value2 = typeof child2 == "function" ? child2() : child2;
      value2 != null && typeof value2 != "boolean" && (text3 += String(value2));
    }
    return text3;
  }
  var URL_IGNORED_CHARS_RE = /[\u0000-\u0020\u007F-\u009F]/g;
  var DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data:text\/html)/i;
  var SVG_DATA_URL_RE = /^data:image\/svg\+xml/i;
  var IMAGE_CONTEXT_TAGS = /* @__PURE__ */ new Set([
    "img",
    "image",
    "video",
    "audio",
    "source",
    "body",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th"
  ]);
  var URL_ATTRS = /* @__PURE__ */ new Set([
    "href",
    "src",
    "action",
    "formaction",
    "xlink:href",
    "poster",
    "background",
    "data"
  ]);
  function isUrlAttr(name) {
    return URL_ATTRS.has(name.toLowerCase());
  }
  function isDangerousUrl(value2, tag) {
    let normalized = value2.replace(URL_IGNORED_CHARS_RE, "");
    return DANGEROUS_SCHEME_RE.test(normalized) ? true : SVG_DATA_URL_RE.test(normalized) ? tag === void 0 || !IMAGE_CONTEXT_TAGS.has(tag.toLowerCase()) : false;
  }
  function isEventHandlerAttr(name) {
    return /^on/i.test(name);
  }
  function isUnsafeAttrWrite(tag, name, value2) {
    return isEventHandlerAttr(name) ? true : isUrlAttr(name) && isDangerousUrl(value2, tag);
  }
  var RAW_HTML_ATTRS = /* @__PURE__ */ new Set(["srcdoc"]);
  function isRawHtmlAttr(name) {
    return RAW_HTML_ATTRS.has(name.toLowerCase());
  }
  var REGISTRY_KEY = /* @__PURE__ */ Symbol.for("@getforma/core#trusted-types");
  function registry() {
    let host = globalThis;
    return host[REGISTRY_KEY] ??= Object.assign(/* @__PURE__ */ Object.create(null), {
      minted: /* @__PURE__ */ new WeakMap(),
      warned: /* @__PURE__ */ new Set()
    });
  }
  function factory() {
    let tt = globalThis.trustedTypes;
    return tt && typeof tt.createPolicy == "function" && typeof tt.isHTML == "function" ? tt : void 0;
  }
  function createPolicy(name) {
    let tt = factory();
    if (!tt) return null;
    try {
      return tt.createPolicy(name, { createHTML: (input) => input });
    } catch {
      return null;
    }
  }
  function formaMint() {
    let reg = registry();
    if (reg.forma === void 0) {
      let forma = createPolicy("forma");
      reg.forma = forma && ((markup) => forma.createHTML(markup));
    }
    return reg.forma;
  }
  function trustedHtml(markup) {
    let html = String(markup), mint = formaMint();
    if (mint) return mint(html);
    let standIn = Object.freeze({ toString: () => html, toJSON: () => html });
    return registry().minted.set(standIn, html), standIn;
  }
  function isTrustedHtml(value2) {
    if (typeof value2 != "object" || value2 === null) return false;
    if (registry().minted.has(value2)) return true;
    let tt = factory();
    return !!tt && tt.isHTML(value2);
  }
  function htmlOf(value2) {
    return registry().minted.get(value2) ?? value2;
  }
  function rawHtml(value2, sink) {
    if (isTrustedHtml(value2)) return htmlOf(value2);
    throw new TypeError(`[forma] ${RAW_HTML_CODES[sink]}: ${sink} requires trustedHtml()`);
  }
  var RAW_HTML_CODES = {
    innerHTML: "FORMA_E_RAW_INNER_HTML",
    setHTMLUnsafe: "FORMA_E_RAW_SET_HTML",
    template: "FORMA_E_RAW_TEMPLATE",
    reconcile: "FORMA_E_RAW_RECONCILE",
    srcdoc: "FORMA_E_RAW_SRCDOC"
  };
  function checkRawAttr(name, value2) {
    isRawHtmlAttr(name) && rawHtml(value2, "srcdoc");
  }
  function refuseScriptElement(tag) {
    if (tag.toLowerCase() === "script")
      throw new TypeError("[forma] FORMA_E_SCRIPT_ELEMENT: h('script') is refused; load code through the page's bundle");
  }
  var Fragment = /* @__PURE__ */ Symbol.for("forma.fragment");
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var DUAL_USE_SVG_TAGS = /* @__PURE__ */ new Set(["a", "title", "script", "style", "font"]);
  function svg(build) {
    return withNamespace(SVG_NS, build);
  }
  var SVG_TAGS = /* @__PURE__ */ new Set([
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "g",
    "text",
    "tspan",
    "textPath",
    "defs",
    "use",
    "symbol",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "filter",
    "feGaussianBlur",
    "feColorMatrix",
    "feOffset",
    "feBlend",
    "feMerge",
    "feMergeNode",
    "feComposite",
    "feFlood",
    "feMorphology",
    "feTurbulence",
    "feDisplacementMap",
    "feImage",
    "foreignObject",
    "animate",
    "animateTransform",
    "animateMotion",
    "set",
    "image",
    "switch",
    "desc",
    "title",
    "metadata",
    "mpath",
    "view",
    "feComponentTransfer",
    "feFuncR",
    "feFuncG",
    "feFuncB",
    "feFuncA",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feSpecularLighting",
    "feDistantLight",
    "fePointLight",
    "feSpotLight",
    "feTile",
    "feDropShadow"
  ]);
  var MATHML_TAGS = /* @__PURE__ */ new Set([
    "math",
    "maction",
    "annotation",
    "annotation-xml",
    "merror",
    "mfrac",
    "mi",
    "mmultiscripts",
    "mn",
    "mo",
    "mover",
    "mpadded",
    "mphantom",
    "mprescripts",
    "mroot",
    "mrow",
    "ms",
    "mspace",
    "msqrt",
    "mstyle",
    "msub",
    "msubsup",
    "msup",
    "mtable",
    "mtd",
    "mtext",
    "mtr",
    "munder",
    "munderover",
    "semantics",
    "mglyph",
    "malignmark"
  ]);
  var BOOLEAN_ATTRS = /* @__PURE__ */ new Set([
    "disabled",
    "checked",
    "readonly",
    "required",
    "autofocus",
    "autoplay",
    "controls",
    "default",
    "defer",
    "formnovalidate",
    "hidden",
    "ismap",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "reversed",
    "selected",
    "async"
  ]);
  var ELEMENT_PROTOS = null;
  function getProto(tag) {
    if (!ELEMENT_PROTOS) {
      ELEMENT_PROTOS = /* @__PURE__ */ Object.create(null);
      for (let t of [
        "div",
        "span",
        "p",
        "a",
        "li",
        "ul",
        "ol",
        "button",
        "input",
        "label",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "section",
        "header",
        "footer",
        "main",
        "nav",
        "table",
        "tr",
        "td",
        "th",
        "tbody",
        "img",
        "form",
        "select",
        "option",
        "textarea",
        "i",
        "b",
        "strong",
        "em",
        "small",
        "article",
        "aside",
        "details",
        "summary"
      ])
        ELEMENT_PROTOS[t] = document.createElement(t);
    }
    return ELEMENT_PROTOS[tag] ?? (ELEMENT_PROTOS[tag] = document.createElement(tag));
  }
  var EVENT_NAMES = /* @__PURE__ */ Object.create(null);
  function eventName(key) {
    return EVENT_NAMES[key] ?? (EVENT_NAMES[key] = key.slice(2).toLowerCase());
  }
  var ABORT_SYM = /* @__PURE__ */ Symbol.for("forma-abort");
  function getAbortController(el) {
    let controller = el[ABORT_SYM];
    return controller || (controller = new AbortController(), el[ABORT_SYM] = controller), controller;
  }
  function cleanup(el) {
    let controller = el[ABORT_SYM];
    controller && (controller.abort(), delete el[ABORT_SYM]);
  }
  var CACHE_SYM = /* @__PURE__ */ Symbol.for("forma-attr-cache");
  var DYNAMIC_CHILD_SYM = /* @__PURE__ */ Symbol.for("forma-dynamic-child");
  function getCache(el) {
    return el[CACHE_SYM] ?? (el[CACHE_SYM] = /* @__PURE__ */ Object.create(null));
  }
  function innerHtmlOf(value2) {
    if (value2 === null || typeof value2 != "object" || !("__html" in value2))
      throw new TypeError(
        "FORMA_E_RAW_INNER_HTML: dangerouslySetInnerHTML requires { __html: trustedHtml() }, got " + typeof value2
      );
    let html = value2.__html;
    if (!isTrustedHtml(html))
      throw new TypeError(
        "FORMA_E_RAW_INNER_HTML: dangerouslySetInnerHTML requires trustedHtml(), got " + typeof html
      );
    return html;
  }
  function handleClass(el, _key, value2) {
    if (typeof value2 == "function")
      internalEffect(() => {
        let v = value2(), cache2 = getCache(el);
        cache2.class !== v && (cache2.class = v, el instanceof HTMLElement ? el.className = v : el.setAttribute("class", v));
      });
    else {
      let cache2 = getCache(el);
      if (cache2.class === value2) return;
      cache2.class = value2, el instanceof HTMLElement ? el.className = value2 : el.setAttribute("class", value2);
    }
  }
  function parseCssString(css) {
    let obj = {};
    for (let decl of css.split(";")) {
      let colon = decl.indexOf(":");
      if (colon < 0) continue;
      let prop = decl.slice(0, colon).trim(), val = decl.slice(colon + 1).trim();
      if (prop && val) {
        let camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        obj[camel] = val;
      }
    }
    return obj;
  }
  function applyStyleObj(el, obj, prevKeys) {
    let style = el.style, nextKeys = Object.keys(obj);
    for (let k of prevKeys)
      k in obj || style.removeProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
    return Object.assign(style, obj), nextKeys;
  }
  function handleStyle(el, _key, value2) {
    if (typeof value2 == "function") {
      let prevKeys = [];
      internalEffect(() => {
        let v = value2();
        if (typeof v == "string") {
          let cache2 = getCache(el);
          if (cache2.style === v) return;
          cache2.style = v, prevKeys = applyStyleObj(el, parseCssString(v), prevKeys);
        } else v && typeof v == "object" && (prevKeys = applyStyleObj(el, v, prevKeys));
      });
    } else if (typeof value2 == "string") {
      let cache2 = getCache(el);
      if (cache2.style === value2) return;
      cache2.style = value2, applyStyleObj(el, parseCssString(value2), []);
    } else value2 && typeof value2 == "object" && Object.assign(el.style, value2);
  }
  function handleEvent(el, key, value2) {
    if (!(typeof value2 == "function" || typeof value2 == "object" && value2 !== null && typeof value2.handleEvent == "function"))
      return void 0;
    let controller = getAbortController(el);
    el.addEventListener(
      eventName(key),
      adoptionListener(value2),
      { signal: controller.signal }
    );
  }
  function handleInnerHTML(el, _key, value2) {
    if (typeof value2 == "function")
      bindInnerHTML(el, value2, false);
    else {
      if (value2 == null) {
        el.replaceChildren();
        return;
      }
      el.innerHTML = rawHtml(innerHtmlOf(value2), "innerHTML");
    }
  }
  function bindInnerHTML(el, value2, adopt) {
    let first = adopt, write = (resolved) => {
      let adopting = first;
      first = false;
      let cache2 = getCache(el);
      if (resolved == null || resolved === false) {
        cache2.innerHTML = null, !adopting && el.firstChild && el.replaceChildren();
        return;
      }
      let html = innerHtmlOf(resolved), markup = String(html);
      if (cache2.innerHTML === markup) return;
      let sink = rawHtml(html, "innerHTML");
      (!adopting || !holdsMarkup(el, markup, sink)) && (el.innerHTML = sink), cache2.innerHTML = markup;
    };
    typeof value2 == "function" ? internalEffect(() => {
      write(value2());
    }) : write(value2);
  }
  function holdsMarkup(el, markup, sink) {
    let current3 = el.innerHTML;
    if (current3 === markup) return true;
    if (current3 === "") return false;
    let tpl = document.createElement("template");
    return tpl.innerHTML = sink, tpl.innerHTML === current3;
  }
  function handleXLink(el, key, value2) {
    let localName = key.slice(6), write = (v) => {
      if (v == null || v === false) {
        el.removeAttributeNS(XLINK_NS, localName);
        return;
      }
      let strVal = String(v);
      if (isUnsafeAttrWrite(el.localName, key, strVal)) {
        el.removeAttributeNS(XLINK_NS, localName);
        return;
      }
      el.setAttributeNS(XLINK_NS, key, strVal);
    };
    typeof value2 == "function" ? internalEffect(() => {
      write(value2());
    }) : write(value2);
  }
  function handleBooleanAttr(el, key, value2) {
    if (typeof value2 == "function")
      internalEffect(() => {
        let v = value2(), cache2 = getCache(el);
        cache2[key] !== v && (cache2[key] = v, v ? el.setAttribute(key, "") : el.removeAttribute(key));
      });
    else {
      let cache2 = getCache(el);
      if (cache2[key] === value2) return;
      cache2[key] = value2, value2 ? el.setAttribute(key, "") : el.removeAttribute(key);
    }
  }
  function handleGenericAttr(el, key, value2) {
    if (isEventHandlerAttr(key))
      return;
    let urlAttr = isUrlAttr(key), write = (v) => {
      let cache2 = getCache(el);
      if (v != null && v !== false) {
        checkRawAttr(key, v);
        let strVal = String(v);
        if (cache2[key] === strVal) return;
        if (!urlAttr || !isDangerousUrl(strVal, el.localName)) {
          el.setAttribute(key, typeof v == "object" && isRawHtmlAttr(key) && isTrustedHtml(v) ? htmlOf(v) : strVal), cache2[key] = strVal;
          return;
        }
      }
      cache2[key] !== null && (cache2[key] = null, el.removeAttribute(key));
    };
    typeof value2 == "function" ? internalEffect(() => {
      write(value2());
    }) : write(value2);
  }
  var PROP_HANDLERS = /* @__PURE__ */ new Map();
  PROP_HANDLERS.set("class", handleClass);
  PROP_HANDLERS.set("className", handleClass);
  PROP_HANDLERS.set("style", handleStyle);
  PROP_HANDLERS.set("ref", () => {
  });
  PROP_HANDLERS.set("dangerouslySetInnerHTML", handleInnerHTML);
  for (let attr of BOOLEAN_ATTRS)
    PROP_HANDLERS.set(attr, handleBooleanAttr);
  function applyProp(el, key, value2) {
    if (isFormControlProperty(el, key)) {
      typeof value2 == "function" ? internalEffect(() => writeFormControlProperty(el, key, value2())) : writeFormControlProperty(el, key, value2);
      return;
    }
    if (key === "class") {
      handleClass(el, key, value2);
      return;
    }
    if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
      handleEvent(el, key, value2);
      return;
    }
    let handler = PROP_HANDLERS.get(key);
    if (handler) {
      handler(el, key, value2);
      return;
    }
    if (key.charCodeAt(0) === 120 && key.startsWith("xlink:")) {
      handleXLink(el, key, value2);
      return;
    }
    handleGenericAttr(el, key, value2);
  }
  function applyStaticProp(el, key, value2) {
    if (value2 == null || value2 === false) return;
    if (key === "class" || key === "className") {
      el instanceof HTMLElement ? el.className = value2 : el.setAttribute("class", value2);
      return;
    }
    if (key === "style") {
      typeof value2 == "string" ? applyStyleObj(el, parseCssString(value2), []) : value2 && typeof value2 == "object" && Object.assign(el.style, value2);
      return;
    }
    if (key === "dangerouslySetInnerHTML") {
      el.innerHTML = rawHtml(innerHtmlOf(value2), "innerHTML");
      return;
    }
    if (key.charCodeAt(0) === 120 && key.startsWith("xlink:")) {
      let strVal2 = String(value2);
      if (isUnsafeAttrWrite(el.localName, key, strVal2))
        return;
      el.setAttributeNS(XLINK_NS, key, strVal2);
      return;
    }
    if (BOOLEAN_ATTRS.has(key)) {
      value2 && el.setAttribute(key, "");
      return;
    }
    if (isEventHandlerAttr(key))
      return;
    if (checkRawAttr(key, value2), value2 === true) {
      el.setAttribute(key, "");
      return;
    }
    let strVal = String(value2);
    isUrlAttr(key) && isDangerousUrl(strVal, el.localName) || el.setAttribute(key, typeof value2 == "object" && isRawHtmlAttr(key) && isTrustedHtml(value2) ? htmlOf(value2) : strVal);
  }
  function appendChild(parent2, child2) {
    if (child2 instanceof Node) {
      parent2.appendChild(child2);
      return;
    }
    if (typeof child2 == "string") {
      parent2.appendChild(new Text(child2));
      return;
    }
    if (!(child2 == null || child2 === false || child2 === true)) {
      if (typeof child2 == "number") {
        parent2.appendChild(new Text(String(child2)));
        return;
      }
      if (typeof child2 == "function") {
        parent2 instanceof Element && (parent2[DYNAMIC_CHILD_SYM] = true);
        let currentNode = null, currentFragChildren = null, ns = insertNs(parent2), clearCurrent = () => {
          if (currentFragChildren) {
            for (let c of currentFragChildren)
              c.parentNode === parent2 && parent2.removeChild(c);
            currentFragChildren = null;
          }
          currentNode && currentNode.parentNode === parent2 && parent2.removeChild(currentNode), currentNode = null;
        };
        internalEffect(() => {
          let v = withNamespace(ns, child2), resolved = v;
          if (Array.isArray(v)) {
            let frag = document.createDocumentFragment();
            for (let item of v)
              item instanceof Node ? frag.appendChild(item) : !Array.isArray(item) && item != null && item !== false && item !== true && frag.appendChild(new Text(String(item)));
            resolved = frag.childNodes.length > 0 ? frag : null;
          }
          if (resolved instanceof Node) {
            clearCurrent();
            let isNewFrag = resolved instanceof DocumentFragment;
            isNewFrag && (currentFragChildren = Array.from(resolved.childNodes)), parent2.appendChild(resolved), currentNode = isNewFrag ? null : resolved;
          } else if (resolved == null || resolved === false || resolved === true)
            clearCurrent();
          else {
            if (currentFragChildren) {
              for (let c of currentFragChildren)
                c.parentNode === parent2 && parent2.removeChild(c);
              currentFragChildren = null;
            }
            let text3 = String(typeof resolved == "symbol" ? resolved : resolved ?? "");
            if (!currentNode)
              currentNode = new Text(text3), parent2.appendChild(currentNode);
            else if (currentNode.nodeType === 3)
              currentNode.data = text3;
            else {
              let tn = new Text(text3);
              parent2.replaceChild(tn, currentNode), currentNode = tn;
            }
          }
        });
        return;
      }
      if (Array.isArray(child2)) {
        for (let item of child2)
          appendChild(parent2, item);
        return;
      }
    }
  }
  function h(tag, props, ...children2) {
    if (typeof tag == "function" && tag !== Fragment) {
      let mergedProps = { ...props ?? {}, children: children2 };
      return describingAdoption ? __adoptionChild(void 0, tag, [mergedProps]) : tag(mergedProps);
    }
    if (tag === Fragment) {
      if (describingAdoption) return { type: "fragment", children: children2 };
      let frag = document.createDocumentFragment();
      for (let child2 of children2)
        appendChild(frag, child2);
      return frag;
    }
    let tagName = tag;
    if (refuseScriptElement(tagName), describingAdoption)
      return { type: "element", tag: tagName, props: props ?? null, children: children2 };
    let el;
    if (DUAL_USE_SVG_TAGS.has(tagName)) {
      let ns = getNamespace();
      el = ns ? document.createElementNS(ns, tagName) : getProto(tagName).cloneNode(false);
    } else ELEMENT_PROTOS && ELEMENT_PROTOS[tagName] ? el = ELEMENT_PROTOS[tagName].cloneNode(false) : SVG_TAGS.has(tagName) ? el = document.createElementNS(SVG_NS, tagName) : MATHML_TAGS.has(tagName) ? el = document.createElementNS(MATHML_NS, tagName) : el = getProto(tagName).cloneNode(false);
    return fillElement(el, props, children2);
  }
  function fillElement(el, props, children2, resolveChildren) {
    let formProps;
    if (props) {
      let hasDynamic = false;
      for (let key in props) {
        if (key === "ref") continue;
        let value2 = props[key];
        if (isFormControlProperty(el, key)) {
          (formProps ??= []).push(key);
          continue;
        }
        if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
          handleEvent(el, key, value2);
          continue;
        }
        if (typeof value2 == "function") {
          hasDynamic || (el[CACHE_SYM] = /* @__PURE__ */ Object.create(null), hasDynamic = true), applyProp(el, key, value2);
          continue;
        }
        applyStaticProp(el, key, value2);
      }
    }
    let resolved = resolveChildren?.();
    resolved && (children2 = resolved.children);
    let target2 = resolved?.target ?? el, childLen = children2.length;
    if (el instanceof HTMLTextAreaElement && isReactiveTextOnly(children2)) {
      let read = resolved?.textReader?.(() => childText(children2)) ?? (() => childText(children2));
      internalEffect(() => writeFormControlProperty(el, "text", read()));
    } else if (childLen === 1) {
      let only = children2[0];
      typeof only == "string" ? target2.textContent = only : typeof only == "number" ? target2.textContent = String(only) : appendChild(target2, only);
    } else if (childLen > 1)
      for (let child2 of children2)
        appendChild(target2, child2);
    if (formProps && props)
      for (let key of formProps) applyProp(el, key, props[key]);
    return props && typeof props.ref == "function" && props.ref(el), el;
  }
  function fragment(...children2) {
    if (describingAdoption) return { type: "fragment", children: children2 };
    let frag = document.createDocumentFragment();
    for (let child2 of children2)
      appendChild(frag, child2);
    return frag;
  }
  function createText(value2) {
    if (typeof value2 == "function") {
      let node = new Text("");
      return internalEffect(() => {
        node.data = value2();
      }), node;
    }
    return new Text(value2);
  }
  function mount(component, container) {
    let target2 = typeof container == "string" ? document.querySelector(container) : container;
    if (!target2)
      throw new Error(`mount: container not found \u2014 "${container}"`);
    if (target2.hasAttribute("data-forma-ssr"))
      throw new Error("FORMA_E_MOUNT_SSR: mount cannot render a server-marked root; use declared activateIslands");
    let disposeRoot, dom = createUnownedRoot((dispose) => (disposeRoot = dispose, withNamespace(contentNs(target2), component)));
    target2.replaceChildren(), target2.appendChild(dom);
    let unmounted = false;
    return () => {
      unmounted || (unmounted = true, disposeRoot(), target2.replaceChildren());
    };
  }
  var HTML_NS = "http://www.w3.org/1999/xhtml";
  var AdoptionDomError = class extends Error {
    constructor(code, detail) {
      super(`[forma] ${code}${detail ? `: ${detail}` : ""}`);
      this.code = code;
      this.name = "AdoptionDomError";
    }
    code;
  };
  function refuse(code) {
    throw new AdoptionDomError(code);
  }
  function marker(node) {
    if (node.nodeType !== 8) return;
    let match = /^(\/?)f:([tsli])(\d+)$/.exec(node.data);
    if (!match) return;
    let id = Number(match[3]);
    return (id > 65535 || String(id) !== match[3]) && refuse("FORMA_E_HYDRATE_MARKER"), { kind: match[2], id, closing: match[1] === "/" };
  }
  function position(node) {
    return { node, parent: node.parentNode, previous: node.previousSibling, next: node.nextSibling };
  }
  function samePosition(item) {
    return item.node.parentNode === item.parent && item.node.previousSibling === item.previous && item.node.nextSibling === item.next;
  }
  var AdoptionDom = class {
    constructor(host) {
      this.host = host;
      this.document = host.ownerDocument, this.document.contains(host) || refuse("FORMA_E_HYDRATE_STRUCTURE");
      for (let node = host.parentNode; node && node !== this.document; node = node.parentNode)
        this.ancestry.push(position(node));
      let pending = [{ node: host, inert: false }];
      for (; pending.length; ) {
        let { node, inert } = pending.pop(), element = node.nodeType === 1 ? node : null, opaque = !inert && node !== host && !!element?.hasAttribute("data-forma-island");
        if (this.nodes.set(node, {
          ...position(node),
          first: node.firstChild,
          last: node.lastChild,
          data: node.nodeType === 3 || node.nodeType === 8 ? node.data : null,
          attributes: element ? Array.from(element.attributes, (attr) => ({
            namespace: attr.namespaceURI,
            local: attr.localName,
            value: attr.value
          })) : null,
          opaque
        }), !opaque) {
          for (let child2 = node.lastChild; child2; child2 = child2.previousSibling) pending.push({ node: child2, inert });
          if (element?.namespaceURI === HTML_NS && element.localName === "template") {
            let template2 = element, fragment3 = template2.content;
            this.templates.set(template2, fragment3), pending.push({ node: fragment3, inert: true });
          }
        }
      }
    }
    host;
    document;
    nodes = /* @__PURE__ */ new Map();
    ancestry = [];
    templates = /* @__PURE__ */ new Map();
    parsed = /* @__PURE__ */ new Set();
    ranges = /* @__PURE__ */ new Map();
    released = false;
    /** Commit/refusal ends the snapshot lifetime; live regions retain only their own nodes. */
    release() {
      this.released = true, this.nodes.clear(), this.templates.clear(), this.ancestry.length = 0, this.parsed.clear(), this.ranges.clear();
    }
    assertUnchanged() {
      (this.released || this.host.ownerDocument !== this.document || !this.document.contains(this.host) || this.ancestry.some((item) => !samePosition(item))) && refuse("FORMA_E_HYDRATE_STRUCTURE");
      for (let [template2, fragment3] of this.templates) template2.content !== fragment3 && refuse("FORMA_E_HYDRATE_STRUCTURE");
      for (let item of this.nodes.values()) {
        let node = item.node;
        if ((!samePosition(item) || !item.opaque && (node.firstChild !== item.first || node.lastChild !== item.last)) && refuse("FORMA_E_HYDRATE_STRUCTURE"), item.data !== null && node.data !== item.data && refuse("FORMA_E_HYDRATE_VALUE"), item.attributes) {
          let element = node;
          (element.attributes.length !== item.attributes.length || item.attributes.some((attr) => element.getAttributeNS(attr.namespace, attr.local) !== attr.value)) && refuse("FORMA_E_HYDRATE_VALUE");
        }
      }
    }
    expectElement(node, tag, namespace = null) {
      (!this.nodes.has(node) || node.nodeType !== 1) && refuse("FORMA_E_HYDRATE_NODE");
      let element = node, ns = namespace ?? HTML_NS;
      return (element.namespaceURI !== ns || element.localName !== (ns === HTML_NS ? tag.toLowerCase() : tag)) && refuse("FORMA_E_HYDRATE_NODE"), element;
    }
    /** Expected attribute values are normalized by the shared prop policy first. */
    expectAttribute(element, local, value2, namespace = null) {
      this.nodes.has(element) || refuse("FORMA_E_HYDRATE_STRUCTURE"), element.getAttributeNS(namespace, local) !== value2 && refuse("FORMA_E_HYDRATE_VALUE");
    }
    /** A component root consumes the original host itself, never its siblings. */
    root() {
      return new AdoptionCursor(this, this.host, this.host.nextSibling);
    }
    children(parent2 = this.host) {
      return this.parse(parent2), new AdoptionCursor(this, parent2.firstChild, null);
    }
    within(range) {
      return this.ranges.get(range.start) !== range && refuse("FORMA_E_HYDRATE_STRUCTURE"), new AdoptionCursor(this, range.start.nextSibling, range.end);
    }
    rangeAt(start) {
      return this.ranges.get(start);
    }
    /**
     * Parse only a visited parent's immediate children. A raw HTML region is
     * validated as raw markup, never interpreted as compiler marker syntax.
     * Opening-node identity matters: repeated SHOW/LIST source uses and list
     * rows legitimately repeat the same numeric operands.
     */
    parse(parent2) {
      let observed = this.nodes.get(parent2);
      if ((!observed || observed.opaque) && refuse("FORMA_E_HYDRATE_STRUCTURE"), this.parsed.has(parent2)) return;
      let stack = [], completed = [];
      for (let node = parent2.firstChild; node; node = node.nextSibling) {
        let token = marker(node);
        if (token)
          if (!token.closing) stack.push({ marker: token, start: node });
          else {
            let opening = stack.pop();
            if ((!opening || opening.marker.kind !== token.kind || opening.marker.id !== token.id) && refuse("FORMA_E_HYDRATE_MARKER"), token.kind === "t") {
              let text3 = opening.start.nextSibling;
              (!text3 || text3.nodeType !== 3 || text3.nextSibling !== node) && refuse("FORMA_E_HYDRATE_MARKER");
            }
            completed.push(Object.freeze({
              kind: token.kind,
              id: token.id,
              start: opening.start,
              end: node
            }));
          }
      }
      stack.length && refuse("FORMA_E_HYDRATE_MARKER");
      for (let range of completed) this.ranges.set(range.start, range);
      this.parsed.add(parent2);
    }
  };
  var AdoptionCursor = class {
    constructor(dom, next, end) {
      this.dom = dom;
      this.next = next;
      this.end = end;
    }
    dom;
    next;
    end;
    offset = 0;
    current() {
      for (; this.next !== this.end && this.next?.nodeType === 8 && !marker(this.next); ) this.next = this.next.nextSibling;
      return this.next === this.end ? null : this.next;
    }
    /** Nested claim matching happens before its independently owned component runs. */
    isIslandBoundary() {
      let node = this.current();
      return !!node && (node.nodeType === 1 && node.hasAttribute("data-forma-island") || this.dom.rangeAt(node)?.kind === "i");
    }
    /** Consume one original child shell, optionally inside its exact native i range. */
    island() {
      if (this.rangeKind() === "i") {
        let inside = this.dom.within(this.range("i")), host = inside.islandElement();
        return inside.finish(), host;
      }
      return this.islandElement();
    }
    islandElement() {
      let node = this.current();
      (!node || this.offset || node.nodeType !== 1 || !node.hasAttribute("data-forma-island")) && refuse("FORMA_E_HYDRATE_STRUCTURE");
      let element = node;
      return this.dom.expectElement(node, element.localName, element.namespaceURI), this.next = node.nextSibling, element;
    }
    rangeKind() {
      let node = this.current();
      return node ? this.dom.rangeAt(node)?.kind : void 0;
    }
    get atEnd() {
      return this.next === this.end && this.offset === 0;
    }
    /** Diagnostic DOM extent only; nodes are not inferred list rows. */
    remainder() {
      let count = 0;
      for (let node = this.next; node && node !== this.end; node = node.nextSibling) count++;
      return count ? `${count} unconsumed top-level DOM node${count === 1 ? "" : "s"}${this.offset ? ` (first Text consumed through offset ${this.offset})` : ""}` : "no unconsumed DOM nodes";
    }
    /** Retain exactly what this operation consumed, including authored comments
     * skipped while walking and partial/static Text shared by adjacent rows. */
    capture(visit) {
      let start = this.next, offset = this.offset, value2 = visit(), pieces = [], node = start, from = offset;
      for (; node !== this.next; ) {
        node || refuse("FORMA_E_HYDRATE_STRUCTURE");
        let data2 = node.nodeType === 3 ? node.data : null;
        pieces.push({ node, from, to: data2?.length ?? 0, text: data2 }), node = node.nextSibling, from = 0;
      }
      return node && this.offset > from && (node.nodeType !== 3 && refuse("FORMA_E_HYDRATE_STRUCTURE"), pieces.push({ node, from, to: this.offset, text: node.data })), { value: value2, pieces };
    }
    element(tag, namespace = null) {
      let node = this.current();
      (!node || this.offset) && refuse("FORMA_E_HYDRATE_NODE");
      let element = this.dom.expectElement(node, tag, namespace);
      return this.next = node.nextSibling, element;
    }
    /** Adjacent authored text descriptors may share one parser-coalesced Text. */
    text(value2) {
      if (!value2) return;
      let node = this.current();
      (!node || node.nodeType !== 3) && refuse("FORMA_E_HYDRATE_NODE");
      let data2 = node.data;
      data2.slice(this.offset, this.offset + value2.length) !== value2 && refuse("FORMA_E_HYDRATE_VALUE"), this.offset += value2.length, this.offset === data2.length && (this.offset = 0, this.next = node.nextSibling);
    }
    range(kind) {
      let node = this.current(), range = node && this.dom.rangeAt(node);
      return (!range || this.offset || range.kind !== kind) && refuse("FORMA_E_HYDRATE_MARKER"), this.next = range.end.nextSibling, range;
    }
    textRange(value2) {
      let text3 = this.range("t").start.nextSibling;
      return text3.data !== (value2 === "" ? "\u200B" : value2) && refuse("FORMA_E_HYDRATE_VALUE"), text3;
    }
    finish() {
      this.current(), (this.next !== this.end || this.offset) && refuse("FORMA_E_HYDRATE_STRUCTURE");
    }
  };
  var current2;
  function currentAdoptionDiagnostic() {
    return current2;
  }
  function withAdoptionDiagnostic(detail, fn) {
    let previous = current2;
    current2 = detail;
    try {
      return fn();
    } finally {
      current2 = previous;
    }
  }
  var AdoptionScopeError = class extends Error {
    constructor(code, site) {
      super(`[forma] ${code}`);
      this.code = code;
      this.site = site;
      this.name = "AdoptionScopeError";
    }
    code;
    site;
  };
  function group(diagnostic = currentAdoptionDiagnostic()) {
    return { alive: true, disposers: [], children: /* @__PURE__ */ new Set(), diagnostic };
  }
  var AdoptionLifecycle = class {
    constructor(options = {}) {
      this.options = options;
    }
    options;
    state = "preparing";
    currentGroup = group();
    rootGroup = this.currentGroup;
    invalidated = false;
    batchOpen = false;
    readers = [];
    callbacks = [];
    callback(fn) {
      return withAdoptionCallbacks(this.options.callback, () => this.options.callback ? this.options.callback(fn) : fn());
    }
    get phase() {
      return this.state;
    }
    require(phase) {
      if (this.state !== phase || !this.currentGroup.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
    }
    /** A disposer created after synchronous abort must run immediately as well. */
    own(dispose, owner = this.currentGroup) {
      !owner.alive || this.state === "aborted" ? this.callback(dispose) : owner.disposers.push(dispose);
    }
    run(fn) {
      this.require("preparing");
      let owner = this.currentGroup, result, error, failed = false, dispose;
      if (withAdoptionSink(this, () => createUnownedRoot((rootDispose) => {
        dispose = rootDispose;
        try {
          result = fn();
        } catch (cause) {
          failed = true, error = cause;
        }
      })), this.own(dispose, owner), failed)
        throw this.abort(), error;
      if (this.state === "aborted" || !owner.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
      return result;
    }
    /** Postcommit regions create fresh ordinary reactive owners, never another
     * preparation sink. Catch setup inside the root so partial construction and
     * late work after synchronous callback failure are still disposed. */
    runLive(fn) {
      this.require("live");
      let owner = this.currentGroup, result, error, failed = false, dispose;
      if (withAdoptionSink(void 0, () => withAdoptionEffectFailure(
        (cause) => this.fail(cause, "FORMA_E_HYDRATE_EFFECT", owner.diagnostic),
        () => withAdoptionEvents(this.eventWrapper(owner), () => createUnownedRoot((rootDispose) => {
          dispose = rootDispose;
          try {
            result = withAdoptionCallbacks(this.options.callback, () => withAdoptionDiagnostic(owner.diagnostic, fn));
          } catch (cause) {
            failed = true, error = cause;
          }
        }))
      )), this.own(dispose, owner), failed)
        throw this.fail(error, "FORMA_E_HYDRATE_EFFECT", owner.diagnostic), error;
      if (this.state === "aborted" || !owner.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
      return result;
    }
    /** A listener retains the preparing region's owner. Calls are inert until
     * publication; each live invocation owns synchronous work and contains its
     * failure, including work constructed after reentrant teardown. */
    liveCallback(invoke) {
      return this.require("preparing"), this.callbackFor(this.currentGroup, invoke, currentAdoptionDiagnostic());
    }
    eventWrapper(owner) {
      return (listener) => this.callbackFor(owner, (event) => {
        typeof listener == "function" ? listener.call(event.currentTarget, event) : listener.handleEvent(event);
      });
    }
    callbackFor(parent2, invoke, diagnostic = parent2.diagnostic) {
      if (!parent2.alive || this.state === "aborted") return () => {
      };
      let owner = group(diagnostic);
      return owner.parent = parent2, parent2.children.add(owner), registerDisposer(() => this.disposeGroup(owner)), (value2) => {
        if (this.state !== "live" || !owner.alive) return;
        let previous = this.currentGroup;
        this.currentGroup = owner;
        try {
          this.runLive(() => this.callback(() => invoke(value2)));
        } catch {
        } finally {
          this.currentGroup = previous;
        }
      };
    }
    group(fn) {
      if (this.state !== "preparing" && this.state !== "live") throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
      this.require(this.state);
      let child2 = group(currentAdoptionDiagnostic() ?? this.currentGroup.diagnostic);
      child2.parent = this.currentGroup, this.currentGroup.children.add(child2);
      let enter = (build) => {
        let previous = this.currentGroup;
        this.currentGroup = child2;
        try {
          return build();
        } finally {
          this.currentGroup = previous;
        }
      }, run2 = (build) => enter(() => this.state === "live" ? this.runLive(build) : this.run(build));
      return {
        value: run2(fn),
        get alive() {
          return child2.alive;
        },
        run: run2,
        child: (build) => enter(() => this.group(build)),
        trackedChild: (build) => enter(() => this.trackedGroup(build)),
        dispose: () => this.disposeGroup(child2)
      };
    }
    /** Keep a ternary's selected-value reads on its current observer while its
     * callbacks and resources belong to a separate, disposable generation. */
    trackedGroup(fn) {
      let observer = getActiveSub();
      return this.group(() => {
        let previous = setActiveSub(observer);
        try {
          return fn();
        } finally {
          setActiveSub(previous);
        }
      });
    }
    disposeGroup(owner) {
      if (owner.alive) {
        owner.alive = false, owner.parent?.children.delete(owner), owner.parent = void 0, this.state !== "live" && this.state !== "aborted" && (this.invalidated = true);
        for (let child2 of owner.children) this.disposeGroup(child2);
        owner.children.clear();
        for (let dispose of owner.disposers.splice(0))
          try {
            this.callback(dispose);
          } catch (error) {
            reportError(error, "adoption cleanup");
          }
      }
    }
    /** One tracked initial read; no second read just to install a writer. */
    observe(read, write) {
      this.require("preparing");
      let owner = this.currentGroup, diagnostic = currentAdoptionDiagnostic() ?? owner.diagnostic, initial2, error, first = true, failed = false, dispose;
      try {
        dispose = this.run(() => effect(() => {
          if (first) {
            first = false, this.readers.push({ flags: getActiveSub(), group: owner });
            try {
              initial2 = withAdoptionDiagnostic(diagnostic, read);
            } catch (cause) {
              failed = true, error = cause;
            }
          } else if (this.state === "live" && owner.alive) {
            let node = getActiveSub(), runs = 0;
            try {
              do {
                node && (node.flags &= -33);
                let next = withAdoptionDiagnostic(diagnostic, read);
                if (this.state !== "live" || !owner.alive || (withAdoptionDiagnostic(diagnostic, () => write(next)), this.state !== "live" || !owner.alive || !node || (node.flags & 32) === 0)) break;
                if (++runs >= 100)
                  throw node.flags &= -33, new AdoptionScopeError("FORMA_E_HYDRATE_VALUE");
              } while (true);
            } catch (cause) {
              this.fail(cause, "FORMA_E_HYDRATE_VALUE", diagnostic);
            }
          } else this.invalidated = true;
        }));
      } catch (cause) {
        throw failed ? error : cause;
      }
      if (this.own(dispose, owner), failed)
        throw this.abort(), error;
      if (this.state === "aborted" || !owner.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
      return initial2;
    }
    /** Read-only codec lookup; direct adoption never grants writeback authority. */
    inputCodec(_read) {
    }
    /** Unprivileged direct adoption can observe, but can never seed an early edit. */
    queueEdit(_read, _value) {
      throw this.abort(), new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_TARGET");
    }
    deferEffect(start) {
      return this.defer(start, "FORMA_E_HYDRATE_EFFECT");
    }
    deferRef(callback) {
      return this.defer(() => (callback(), () => {
      }), "FORMA_E_HYDRATE_REF");
    }
    defer(start, code) {
      this.require("preparing");
      let group2 = this.currentGroup, diagnostic = currentAdoptionDiagnostic() ?? group2.diagnostic, cancelled = false, dispose, cancel = () => {
        cancelled || (cancelled = true, dispose?.());
      };
      return registerDisposer(cancel), this.own(cancel, group2), this.callbacks.push(() => {
        if (cancelled || !group2.alive || this.state !== "live") return;
        let failed = false, cause;
        try {
          let startRoot = () => createUnownedRoot((rootDispose) => {
            dispose = rootDispose;
            try {
              registerDisposer(withAdoptionDiagnostic(diagnostic, () => this.callback(() => start((error) => this.fail(error, code, diagnostic)))));
            } catch (error) {
              failed = true, cause = error;
            }
          });
          withAdoptionSink(void 0, () => withAdoptionEffectFailure(
            (error) => this.fail(error, "FORMA_E_HYDRATE_EFFECT", diagnostic),
            () => withAdoptionEvents(this.eventWrapper(group2), startRoot)
          )), failed && this.fail(cause, code, diagnostic), (cancelled || !group2.alive || this.state !== "live") && dispose?.();
        } catch (error) {
          this.fail(error, code, diagnostic);
        }
      }), cancel;
    }
    fail(error, code, diagnostic) {
      if (this.state === "aborted") return;
      let detail = diagnostic ?? currentAdoptionDiagnostic();
      this.abort();
      try {
        this.options.failure ? withAdoptionDiagnostic(detail, () => this.options.failure(error, code)) : reportError(error, "adoption callback");
      } catch (reportingError) {
        reportError(reportingError, "adoption error reporting");
      }
    }
    check() {
      this.options.check?.();
    }
    checkSeeds() {
    }
    applySeeds() {
    }
    rollbackSeeds() {
    }
    clearSeeds() {
    }
    checkPrepared() {
      if (this.check(), this.invalidated || this.readers.some((item) => item.group.alive && (item.flags.flags & 48) !== 0))
        throw new AdoptionScopeError("FORMA_E_HYDRATE_VALUE");
    }
    seal() {
      this.require("preparing");
      try {
        this.checkPrepared(), this.state = "validated";
      } catch (error) {
        throw this.abort(), error;
      }
    }
    seed() {
      this.require("validated");
      try {
        this.checkPrepared(), this.checkSeeds(), openBatch(), this.batchOpen = true, this.state = "seeding", this.applySeeds();
      } catch (error) {
        throw this.abort(), error;
      }
    }
    publish() {
      this.require("seeding");
      try {
        this.check(), this.state = "live", this.clearSeeds(), this.readers.length = 0, withAdoptionSink(void 0, () => this.closeBatch());
        for (let callback of this.callbacks.splice(0)) {
          if (this.state !== "live") break;
          callback();
        }
      } catch (error) {
        throw this.abort(), error;
      }
    }
    closeBatch() {
      this.batchOpen && (this.batchOpen = false, closeBatchWithoutRoot());
    }
    abort() {
      if (this.state === "aborted") return;
      let rollback = this.state === "seeding";
      this.state = "aborted", this.disposeGroup(this.rootGroup), rollback && this.rollbackSeeds(), this.clearSeeds(), this.readers.length = 0, this.callbacks.length = 0, this.closeBatch();
    }
  };
  function isHydrateError(error) {
    return error instanceof AdoptionDomError || error instanceof AdoptionScopeError;
  }
  function reportHydrateError(error, where = "") {
    console.error(error instanceof Error ? error.message + where : error), reportError(error, "hydration");
  }
  var refuse2 = () => {
    throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
  };
  var AdoptionRow = class _AdoptionRow {
    constructor(initial2, first, last) {
      this.initial = initial2;
      this.first = first === void 0 ? initial2?.[0]?.node ?? null : first, this.last = last === void 0 ? initial2?.[initial2.length - 1]?.node ?? null : last;
    }
    initial;
    first;
    last;
    static fresh(value2) {
      return value2?.nodeType === 11 ? new _AdoptionRow(void 0, value2.firstChild, value2.lastChild) : new _AdoptionRow(void 0, value2, value2);
    }
    nodes() {
      if (!this.first)
        return this.last && refuse2(), [];
      (!this.last || this.first.parentNode !== this.last.parentNode) && refuse2();
      let nodes = [];
      for (let node = this.first; node; node = node.nextSibling)
        if (nodes.push(node), node === this.last) return nodes;
      return refuse2();
    }
  };
  function materializeRows(rows, check) {
    let cuts = /* @__PURE__ */ new Map();
    for (let row of rows) for (let piece of row.initial ?? []) {
      if (piece.text === null || piece.from === 0 && piece.to === piece.text.length) continue;
      let node = piece.node, item = cuts.get(node);
      item || (item = { text: piece.text, offsets: /* @__PURE__ */ new Set([0, piece.text.length]) }, cuts.set(node, item)), item.text !== piece.text && refuse2(), item.offsets.add(piece.from), item.offsets.add(piece.to);
    }
    for (let [node, item] of cuts) if (node.data !== item.text) throw new AdoptionDomError("FORMA_E_HYDRATE_VALUE");
    let parts = /* @__PURE__ */ new Map();
    for (let [original, item] of cuts) {
      let offsets = [...item.offsets].sort((a, b) => a - b), nodes = [original], node = original;
      for (let i = 1; i < offsets.length - 1; i++)
        check(), node = node.splitText(offsets[i] - offsets[i - 1]), nodes.push(node), check();
      parts.set(original, { offsets, nodes });
    }
    for (let row of rows) {
      let first = row.initial?.[0], last = row.initial?.[row.initial.length - 1];
      if (first) {
        let split = parts.get(first.node);
        split && (row.first = split.nodes[split.offsets.indexOf(first.from)] ?? refuse2());
      }
      if (last) {
        let split = parts.get(last.node);
        split && (row.last = split.nodes[split.offsets.indexOf(last.to) - 1] ?? refuse2());
      }
      row.initial = void 0;
    }
  }
  function refuse3() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
  }
  function listItems(values, keyFn) {
    Array.isArray(values) || refuse3();
    let output = [], seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < values.length; i++) {
      Object.hasOwn(values, i) || refuse3();
      let key = untrack(() => keyFn(values[i]));
      typeof key != "string" && (typeof key != "number" || !Number.isFinite(key)) && refuse3();
      let printed = String(key);
      seen.has(printed) && refuse3(), seen.add(printed), output.push(key);
    }
    return { items: values.slice(), keys: output };
  }
  function liveList(options, initial2) {
    let { range, owner, live, keys, render, rerender, removeChildren } = options, { cache: cache2, ordered, tail, keyOwner } = initial2;
    function contents() {
      let nodes = [];
      for (let node = range.start.nextSibling; node !== range.end; node = node?.nextSibling ?? null)
        node || refuse3(), nodes.push(node);
      return nodes;
    }
    return { update(value2) {
      let parent2 = range.start.parentNode;
      (!parent2 || range.end.parentNode !== parent2) && refuse3();
      let before = contents(), covered = [];
      for (let row of ordered) for (let node of row.span.nodes()) covered[covered.length - 1] !== node && covered.push(node);
      covered.push(...tail), (covered.length !== before.length || covered.some((node, i) => node !== before[i])) && refuse3();
      let check = () => {
        (!live() || range.start.parentNode !== parent2 || range.end.parentNode !== parent2) && refuse3();
      }, unchanged = () => {
        check();
        let now = contents();
        (now.length !== before.length || now.some((node, i) => node !== before[i])) && refuse3();
      }, nextOwner = owner.child(() => keys(value2)), next = nextOwner.value, planned = /* @__PURE__ */ new Map(), rows = [];
      unchanged();
      for (let i = 0; i < next.items.length; i++) {
        let item = next.items[i], key = next.keys[i], row = cache2.get(key);
        if (!row || rerender && row.item !== item) {
          let setIndex, child2 = owner.child(() => untrack(() => {
            let [getIndex, set] = createSignal(i);
            setIndex = set;
            let node = render(item, getIndex);
            return node && node.parentNode && refuse3(), node;
          }));
          row = { owner: child2, span: AdoptionRow.fresh(child2.value), item, setIndex };
        }
        planned.set(key, row), rows.push(row), unchanged();
      }
      let retained = new Set(rows), leaving = ordered.filter((row) => !retained.has(row));
      keyOwner.dispose(), unchanged(), keyOwner = nextOwner;
      for (let row of leaving) {
        row.owner.dispose(), unchanged();
        for (let node of row.span.nodes()) node.nodeType === 1 && (removeChildren(node), unchanged());
      }
      if (unchanged(), rows.length !== ordered.length || rows.some((row, i) => row !== ordered[i])) {
        materializeRows(ordered.map((row) => row.span), check);
        let oldIndex = new Map(ordered.map((row, i) => [row, i])), reused = [], positions = [];
        rows.forEach((row, i) => {
          let index = oldIndex.get(row);
          index !== void 0 && row.span.first && (reused.push(index), positions.push(i));
        });
        let stationary = new Set(longestIncreasingSubsequence(reused).map((index) => positions[index]));
        for (let row of leaving) for (let node of row.span.nodes())
          check(), parent2.removeChild(node);
        let anchor = tail[0] ?? range.end;
        for (let i = rows.length - 1; i >= 0; i--) {
          check();
          let row = rows[i], nodes = row.span.nodes();
          if (!stationary.has(i)) for (let node of nodes)
            check(), parent2.insertBefore(node, anchor);
          row.span.first && (anchor = row.span.first);
        }
      }
      check(), cache2 = planned, ordered = rows;
      for (let i = 0; i < rows.length; i++)
        check(), rows[i].setIndex(i);
    }, clear() {
      cache2.clear(), ordered = [], tail = [];
    } };
  }
  function refuse4() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
  }
  function liveRanges(scope, document2, removeChildren) {
    let range = () => {
      let fragment3 = document2.createDocumentFragment(), start = document2.createComment(""), end = document2.createComment("");
      return fragment3.append(start, end), { fragment: fragment3, start, end };
    };
    function dynamic(read, materialize2, truthiness = false) {
      let { fragment: fragment3, start, end } = range(), owner = scope.group(() => {
      }), active3, shown;
      return owner.run(() => {
        registerDisposer(() => {
          active3 = void 0;
        }), internalEffect(() => {
          let parent2 = start.parentNode;
          (!parent2 || end.parentNode !== parent2) && refuse4();
          let contents = () => {
            let nodes = [];
            for (let node = start.nextSibling; node !== end; node = node?.nextSibling ?? null)
              node || refuse4(), nodes.push(node);
            return nodes;
          }, before = contents(), check = () => {
            (scope.phase !== "live" || !owner.alive || start.parentNode !== parent2 || end.parentNode !== parent2) && refuse4();
            let now = contents();
            (now.length !== before.length || now.some((node, index) => node !== before[index])) && refuse4();
          }, nextShown;
          if (truthiness && (nextShown = !!read(), active3 && shown === nextShown)) {
            check();
            return;
          }
          let next = truthiness ? owner.child(() => untrack(() => materialize2(nextShown))) : owner.trackedChild(() => materialize2(read()));
          next.value?.parentNode && refuse4(), check(), active3?.dispose(), check();
          for (let node of before) node.nodeType === 1 && (removeChildren(node), check());
          for (let node of before) parent2.removeChild(node);
          next.value && parent2.insertBefore(next.value, end), active3 = next, shown = nextShown;
        });
      }), fragment3;
    }
    return {
      /** Keep a real-element reader's ownership outside its ordinary writer's
       * automatically retired generation. The shared writer retains Text nodes
       * and textarea/property semantics after this checked read returns. */
      reader(target2, read) {
        let owner = scope.group(() => {
        }), active3;
        return owner.run(() => registerDisposer(() => {
          active3 = void 0;
        })), () => {
          let parent2 = target2.parentNode, previous = target2.previousSibling, following = target2.nextSibling, nodes = [...target2.childNodes], check = () => {
            (scope.phase !== "live" || !owner.alive || target2.parentNode !== parent2 || target2.previousSibling !== previous || target2.nextSibling !== following) && refuse4();
            let current3 = target2.childNodes;
            (current3.length !== nodes.length || nodes.some((node, index) => node !== current3[index])) && refuse4();
          }, next = owner.trackedChild(read);
          return check(), active3?.dispose(), check(), active3 = next, next.value;
        };
      },
      list(desc, _namespace, render) {
        let { fragment: fragment3, start, end } = range(), owner = scope.group(() => {
        });
        return owner.run(() => {
          let keyOwner = owner.child(() => ({ items: [], keys: [] })), coordinator = liveList({
            range: { start, end },
            owner,
            live: () => scope.phase === "live" && owner.alive,
            keys: (values) => withAdoptionDescription(() => listItems(values, desc.keyFn), false),
            render,
            rerender: desc.options?.updateOnItemChange === "rerender",
            removeChildren
          }, { cache: /* @__PURE__ */ new Map(), ordered: [], tail: [], keyOwner });
          registerDisposer(coordinator.clear), internalEffect(() => coordinator.update(desc.items()));
        }), fragment3;
      },
      dynamic: (read, materialize2) => dynamic(read, materialize2),
      show: (condition, materialize2) => dynamic(condition, (value2) => materialize2(value2), true)
    };
  }
  function describe(read, ns) {
    return withNamespace(ns, () => withAdoptionDescription(read));
  }
  function child(value2, ns, context2, target2, aggregate = false) {
    if (typeof value2 == "function" && target2) {
      let read = () => child(describe(value2, ns), ns, context2, target2, aggregate);
      return aggregate ? read : context2.reader(target2, read);
    }
    return Array.isArray(value2) ? value2.map((item) => child(item, ns, context2, target2, aggregate)) : value2 == null || typeof value2 == "boolean" || typeof value2 == "string" || typeof value2 == "number" ? value2 : materializeAdoption(value2, ns, context2);
  }
  function materializeAdoption(value2, ns, context2) {
    return withNamespace(ns, () => withAdoptionDescription(() => materialize(value2, ns, context2), false));
  }
  function materialize(value2, ns, context2) {
    if (value2 == null || typeof value2 == "boolean") return null;
    if (value2 instanceof Node) {
      if (value2.parentNode) throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
      return value2;
    }
    if (typeof value2 == "string" || typeof value2 == "number") return document.createTextNode(String(value2));
    if (typeof value2 == "function")
      return context2.dynamic(() => describe(value2, ns), (next) => materializeAdoption(next, ns, context2));
    if (Array.isArray(value2)) return fragment2(value2, ns, context2);
    if (typeof value2 != "object") throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
    let desc = value2;
    switch (desc.type) {
      case "element": {
        let element = h(desc.tag, null);
        return fillElement(element, desc.props, desc.children, () => {
          let inner = contentNs(element), template2 = element.namespaceURI === "http://www.w3.org/1999/xhtml" && element.localName === "template", aggregate = element instanceof HTMLTextAreaElement && isReactiveTextOnly(desc.children);
          return {
            children: desc.children.map((value3) => child(value3, inner, context2, template2 ? void 0 : element, aggregate)),
            target: template2 ? element.content : element,
            textReader: aggregate ? (read) => context2.reader(element, read) : void 0
          };
        });
      }
      case "fragment":
        return fragment2(desc.children, ns, context2);
      case "component":
        return materializeAdoption(describe(() => Reflect.apply(desc.component, desc.receiver, desc.args), ns), ns, context2);
      case "show":
        return desc.conditional ? context2.dynamic(
          () => describe(() => (desc.condition() ? desc.whenTrue : desc.whenFalse)?.(), ns),
          (next) => materializeAdoption(next, ns, context2)
        ) : context2.show(
          () => describe(desc.condition, ns),
          (shown) => materializeAdoption(describe(() => (shown ? desc.whenTrue : desc.whenFalse)?.(), ns), ns, context2)
        );
      case "list":
        return context2.list(desc, ns, (item, index) => materializeAdoption(describe(() => desc.renderFn(item, index), ns), ns, context2));
      default:
        throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
    }
  }
  function fragment2(children2, ns, context2) {
    let result = document.createDocumentFragment();
    for (let child2 of children2) {
      let node = materializeAdoption(child2, ns, context2);
      node && result.appendChild(node);
    }
    return result;
  }
  var XLINK_NS2 = "http://www.w3.org/1999/xlink";
  var ALIASES = { className: "class", htmlFor: "for", tabIndex: "tabindex" };
  function prepareAttribute(element, key, value2) {
    let qualified = Object.hasOwn(ALIASES, key) ? ALIASES[key] : key, namespace = qualified.startsWith("xlink:") ? XLINK_NS2 : null, local = namespace ? qualified.slice(6) : element.namespaceURI === "http://www.w3.org/1999/xhtml" ? qualified.toLowerCase() : qualified, normalize = (next) => {
      if (next == null || next === false || isEventHandlerAttr(qualified)) return null;
      if (isRawHtmlAttr(qualified)) return String(rawHtml(next, "srcdoc"));
      if (!["string", "number", "boolean"].includes(typeof next)) throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
      let result = next === true ? "" : String(next);
      return isUnsafeAttrWrite(element.localName, qualified, result) ? null : result;
    }, initial2 = normalize(value2), previous = initial2;
    return {
      local,
      namespace,
      initial: initial2,
      write(next) {
        let normalized = normalize(next);
        normalized !== previous && (normalized === null ? namespace ? element.removeAttributeNS(namespace, local) : element.removeAttribute(qualified) : namespace ? element.setAttributeNS(namespace, qualified, normalized) : element.setAttribute(qualified, isRawHtmlAttr(qualified) ? rawHtml(next, "srcdoc") : normalized), previous = normalized);
      }
    };
  }
  function mismatch() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_VALUE");
  }
  function context(element) {
    let document2 = element.ownerDocument.implementation.createHTMLDocument(), mirror = document2.createElementNS(element.namespaceURI, element.localName);
    if (element.namespaceURI === "http://www.w3.org/1998/Math/MathML" && element.localName === "annotation-xml") {
      let encoding = element.getAttribute("encoding");
      encoding !== null && mirror.setAttribute("encoding", encoding);
    }
    for (let parent2 = element.parentElement; parent2; parent2 = parent2.parentElement)
      if (parent2.namespaceURI === "http://www.w3.org/1999/xhtml" && parent2.localName === "form") {
        document2.createElement("form").appendChild(mirror);
        break;
      }
    return mirror;
  }
  function cssOf(element) {
    let style = element.style;
    if (!style) throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
    return style;
  }
  function declarations(value2) {
    if (value2 == null || value2 === false) return /* @__PURE__ */ Object.create(null);
    let input = typeof value2 == "string" ? parseCssString(value2) : value2;
    (!input || typeof input != "object" || Array.isArray(input)) && mismatch();
    let result = /* @__PURE__ */ Object.create(null);
    for (let key of Reflect.ownKeys(input)) {
      let field = Object.getOwnPropertyDescriptor(input, key);
      if (!field.enumerable) continue;
      (typeof key != "string" || key === "cssText" || key in Object.prototype || !("value" in field)) && mismatch();
      let item = field.value;
      typeof item != "string" && !(typeof item == "number" && Number.isFinite(item)) && mismatch(), result[key] = String(item);
    }
    return result;
  }
  function applyDeclarations(element, fields, keys) {
    let style = cssOf(element);
    for (let key of Object.keys(fields)) {
      let member = style[key];
      member !== void 0 && typeof member != "string" && mismatch();
    }
    return applyStyleObj(element, fields, keys);
  }
  function normalizedStyle(element) {
    let style = cssOf(element);
    return JSON.stringify(Array.from({ length: style.length }, (_, i) => style.item(i)).sort().map((key) => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]));
  }
  function prepareStyle(element, initial2) {
    let expected = context(element), first = declarations(initial2), keys = applyDeclarations(expected, first, []), previous = normalizedStyle(expected);
    return normalizedStyle(element) !== previous && mismatch(), {
      write(next) {
        if (next == null || next === false) return;
        let fields = declarations(next), mirror = context(element);
        applyDeclarations(mirror, fields, []), normalizedStyle(mirror) !== previous && (keys = applyDeclarations(element, fields, keys), previous = normalizedStyle(element));
      }
    };
  }
  function typedMarkup(value2) {
    if (value2 === null || typeof value2 != "object") return rawHtml(value2, "innerHTML");
    let field = Object.getOwnPropertyDescriptor(value2, "__html");
    return rawHtml(field && "value" in field ? field.value : void 0, "innerHTML");
  }
  function preparedMarkup(element, value2) {
    let sink = typedMarkup(value2);
    if (element.namespaceURI === "http://www.w3.org/1999/xhtml" && element.localName === "noscript")
      throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
    return sink;
  }
  function prepareRaw(element, initial2) {
    let ownsContent = initial2 != null && initial2 !== false, content = element.namespaceURI === "http://www.w3.org/1999/xhtml" && element.localName === "template" ? element.content : element, previous = null;
    if (ownsContent) {
      let sink = preparedMarkup(element, initial2), expected = context(element);
      expected.innerHTML = sink, expected.innerHTML !== element.innerHTML && mismatch(), previous = String(sink);
    }
    return {
      ownsContent,
      write(next, beforeReplace) {
        if (next == null || next === false) {
          content.firstChild && (beforeReplace?.(), content.replaceChildren()), previous = null;
          return;
        }
        let sink = preparedMarkup(element, next), markup = String(sink);
        markup !== previous && (beforeReplace?.(), element.innerHTML = sink, previous = markup);
      }
    };
  }
  var HTML = "http://www.w3.org/1999/xhtml";
  var MODEL_ATTRS = /* @__PURE__ */ new Set(["type", "name", "value", "alpha", "colorspace", "checked", "selected", "min", "max", "step", "multiple", "size", "disabled", "readonly", "required", "maxlength", "minlength", "pattern", "label"]);
  function structure() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
  }
  function mismatch2() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_VALUE");
  }
  function target() {
    throw new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_TARGET");
  }
  function control(element) {
    return element.namespaceURI === HTML && ["input", "textarea", "select", "option"].includes(element.localName);
  }
  var attributes = (element) => Array.from(element.attributes, (item) => [item.name, item.value]).sort(([a], [b]) => a.localeCompare(b));
  function same(a, b) {
    return a.length === b.length && a.every((value2, index) => Object.is(value2, b[index]));
  }
  function initial(value2) {
    if (value2 == null || typeof value2 == "string" || typeof value2 == "boolean" || typeof value2 == "number" && Number.isFinite(value2)) return value2;
    if (Array.isArray(value2)) {
      let copy2 = [];
      for (let i = 0; i < value2.length; i++) {
        let property = Object.getOwnPropertyDescriptor(value2, String(i));
        (!property || !("value" in property) || typeof property.value != "string") && mismatch2(), copy2.push(property.value);
      }
      return Object.freeze(copy2);
    }
    return mismatch2();
  }
  function text(value2) {
    return value2 == null ? "" : Array.isArray(value2) ? value2.join(",") : String(value2);
  }
  function selection(element) {
    if (element.localName !== "input" && element.localName !== "textarea") return [null, null, null];
    let input = element;
    return [input.selectionStart, input.selectionEnd, input.selectionDirection];
  }
  function snapshot(element) {
    let input = element, select = element, options = element.localName === "select" ? Array.from(select.options) : [];
    return {
      element,
      parent: element.parentNode,
      previous: element.previousSibling,
      next: element.nextSibling,
      attrs: attributes(element),
      text: element.localName === "textarea" ? element.defaultValue : element.textContent ?? "",
      form: element.form,
      type: element.localName === "input" ? input.type : "",
      value: element.value,
      checked: element.localName === "input" ? input.checked : false,
      selected: element.localName === "option" ? element.selected : false,
      number: element.localName === "input" ? input.valueAsNumber : NaN,
      options,
      selectedOptions: options.map((option) => option.selected),
      files: element.localName === "input" ? Array.from(input.files ?? []) : [],
      selection: selection(element)
    };
  }
  function attrEqual(a, b) {
    return a.length === b.length && a.every(([name, value2], i) => b[i]?.[0] === name && b[i]?.[1] === value2);
  }
  var AdoptionControls = class {
    host;
    document;
    owned = /* @__PURE__ */ new Set();
    snapshots = /* @__PURE__ */ new Map();
    groups = [];
    optgroups = /* @__PURE__ */ new Map();
    bindings = [];
    observations;
    focus;
    constructor(host) {
      this.host = host, this.document = host.ownerDocument, this.focus = this.document.activeElement, this.document.contains(host) || structure();
      let pending = [host];
      for (; pending.length; ) {
        let element = pending.pop();
        if (!(element !== host && element.hasAttribute("data-forma-island"))) {
          control(element) && (this.owned.add(element), this.snapshots.set(element, snapshot(element)));
          for (let child2 = element.lastElementChild; child2; child2 = child2.previousElementSibling) pending.push(child2);
        }
      }
      for (let element of this.owned) if (element.localName === "option") {
        let parent2 = element.parentElement;
        for (; parent2 && parent2.localName !== "select"; ) parent2 = parent2.parentElement;
        parent2 && control(parent2) && !this.snapshots.has(parent2) && this.snapshots.set(parent2, snapshot(parent2));
      }
      let radios = Array.from(this.document.querySelectorAll("input")).filter((input) => input.type === "radio");
      for (let item of this.snapshots.values()) if (item.type === "radio" && item.element.name) {
        let name = item.element.name;
        if (this.groups.some((group2) => group2.name === name && group2.form === item.form)) continue;
        let members = radios.filter((input) => input.name === name && input.form === item.form);
        this.groups.push({ name, form: item.form, members });
        for (let peer of members) this.snapshots.has(peer) || this.snapshots.set(peer, snapshot(peer));
      }
      for (let item of [...this.snapshots.values()]) for (let option of item.options) this.snapshots.has(option) || this.snapshots.set(option, snapshot(option));
      for (let item of this.snapshots.values()) for (let option of item.options) {
        let group2 = option.parentElement;
        group2?.localName === "optgroup" && !this.optgroups.has(group2) && this.optgroups.set(group2, { attrs: attributes(group2), parent: group2.parentNode, previous: group2.previousSibling, next: group2.nextSibling });
      }
      let ordered = [...this.snapshots].sort(([a], [b]) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      this.snapshots.clear();
      for (let [element, item] of ordered) this.snapshots.set(element, item);
    }
    add({ element, key, initial: value2, codec, kind = "binding" }) {
      (!this.host || this.observations || !control(element) || !this.owned.has(element)) && structure(), kind !== "initial" && kind !== "binding" && structure();
      let tag = element.localName;
      ["value", "checked", "selected", "text"].includes(key) || structure(), (key === "checked" && tag !== "input" || key === "selected" && tag !== "option" || key === "text" && tag !== "textarea") && structure(), this.bindings.some((binding) => binding.snapshot.element === element && (binding.key === key || (key === "text" || key === "value") && (binding.key === "text" || binding.key === "value"))) && structure();
      let token = Object.freeze({});
      return this.bindings.push({ snapshot: this.snapshots.get(element), key, initial: initial(value2), codec, kind, token }), token;
    }
    mirror(expected) {
      let doc = this.document.implementation.createHTMLDocument(), map = /* @__PURE__ */ new Map(), forms = /* @__PURE__ */ new Map(), bound = (element, key) => expected ? this.bindings.find((binding) => binding.snapshot.element === element && binding.key === key) : void 0, copyAttrs = (element, attrs) => {
        for (let [name, value2] of attrs) MODEL_ATTRS.has(name) && element.setAttribute(name, value2);
      }, applyAttr = (clone, key, value2) => {
        value2 == null || value2 === false ? clone.removeAttribute(key) : clone.setAttribute(key, value2 === true ? "" : text(value2));
      }, make = (item) => {
        let clone = doc.createElement(item.element.localName);
        copyAttrs(clone, item.attrs), clone.localName === "textarea" && (clone.defaultValue = item.text), clone.localName === "option" && (clone.textContent = item.text);
        let value2 = bound(item.element, "value") ?? bound(item.element, "text");
        value2 && clone.localName !== "select" && (clone.localName === "textarea" ? clone.defaultValue = text(value2.initial) : applyAttr(clone, "value", value2.initial));
        for (let key of ["checked", "selected"]) {
          let binding = bound(item.element, key);
          binding && applyAttr(clone, key, binding.initial);
        }
        return map.set(item.element, clone), clone;
      };
      for (let item of this.snapshots.values()) if (item.element.localName !== "option") {
        let clone = make(item);
        if (clone.localName === "select") {
          let groups = /* @__PURE__ */ new Map();
          for (let option of item.options) {
            let optionClone = make(this.snapshots.get(option)), parent3 = this.snapshots.get(option).parent;
            if (parent3?.localName === "optgroup") {
              let group2 = groups.get(parent3);
              group2 || (group2 = doc.createElement("optgroup"), copyAttrs(group2, this.optgroups.get(parent3).attrs), groups.set(parent3, group2), clone.appendChild(group2)), group2.appendChild(optionClone);
            } else clone.appendChild(optionClone);
          }
          let value2 = bound(item.element, "value");
          if (value2) {
            let select = clone;
            if (select.multiple && Array.isArray(value2.initial)) {
              let wanted = new Set(value2.initial);
              for (let option of Array.from(select.options)) option.selected = wanted.has(option.value);
            } else select.value = text(value2.initial);
          }
        }
        let parent2 = doc.body;
        if (item.form) {
          let form = forms.get(item.form);
          form || (form = doc.createElement("form"), forms.set(item.form, form), doc.body.appendChild(form)), parent2 = form;
        }
        parent2.appendChild(clone);
      }
      for (let item of this.snapshots.values()) map.has(item.element) || doc.body.appendChild(make(item));
      return map;
    }
    observed(element, key) {
      return key === "checked" ? element.checked : key === "selected" ? element.selected : element.localName === "select" ? Array.from(element.options, (option) => option.selected) : element.value;
    }
    live(binding) {
      let { snapshot: item, key } = binding;
      return key === "checked" ? item.checked : key === "selected" ? item.selected : item.element.localName === "select" ? item.selectedOptions : item.value;
    }
    rawValue(binding) {
      let { snapshot: item, key } = binding;
      return key === "checked" || key === "selected" ? this.live(binding) : item.element.localName === "select" && item.element.multiple ? Object.freeze(item.options.filter((_, i) => item.selectedOptions[i]).map((option) => this.snapshots.get(option).value)) : item.value;
    }
    converted(binding) {
      let { snapshot: item, key, codec } = binding, tag = item.element.localName;
      return key === "checked" || key === "selected" ? codec !== "boolean" ? target() : this.live(binding) : item.type === "file" ? target() : codec === "number" ? tag !== "input" || !["number", "range"].includes(item.type) || !Number.isFinite(item.number) ? target() : item.number : codec === "string-array" ? tag !== "select" || !item.element.multiple ? target() : Object.freeze(item.options.filter((_, i) => item.selectedOptions[i]).map((option) => this.snapshots.get(option).value)) : codec !== "string" || tag === "select" && item.element.multiple ? target() : item.value;
    }
    /** Reports only the opaque binding that failed; group/topology failures have
     * no binding authority. Reporting cannot replace the original refusal. */
    finish(onFailure) {
      if (this.host || structure(), this.check(), this.observations) return this.observations;
      let defaults = this.mirror(false), expected = this.mirror(true), at = (binding, read) => {
        try {
          return read();
        } catch (error) {
          try {
            onFailure?.(binding.token, error);
          } finally {
            throw error;
          }
        }
      };
      for (let binding of this.bindings) at(binding, () => {
        let clone = defaults.get(binding.snapshot.element), select = clone.localName === "select" ? clone : binding.key === "selected" ? clone.closest("select") : null;
        if (!select || select.multiple || select.size > 1) return;
        let options = Array.from(select.options);
        if (options.some((option) => option.hasAttribute("selected"))) return;
        let first = options.find((option) => !option.disabled), enabled = options.find((option) => !option.disabled && !(option.parentElement?.localName === "optgroup" && option.parentElement.disabled));
        first && enabled && first !== enabled && (clone === select || clone === first || clone === enabled) && mismatch2();
      });
      for (let binding of this.bindings) at(binding, () => {
        let a = this.observed(defaults.get(binding.snapshot.element), binding.key), b = this.observed(expected.get(binding.snapshot.element), binding.key);
        (Array.isArray(a) && Array.isArray(b) ? !same(a, b) : !Object.is(a, b)) && mismatch2();
      });
      let result = this.bindings.map((binding) => at(binding, () => {
        let baseline = this.observed(defaults.get(binding.snapshot.element), binding.key), live = this.live(binding), edited = (Array.isArray(baseline) && Array.isArray(live) ? !same(baseline, live) : !Object.is(baseline, live)) || binding.snapshot.type === "file" && binding.snapshot.files.length > 0;
        return Object.freeze({ token: binding.token, kind: binding.kind, edited, value: edited && binding.kind === "binding" ? this.converted(binding) : this.rawValue(binding) });
      }));
      return this.observations = Object.freeze(result), this.observations;
    }
    check() {
      (!this.host || !this.document || this.host.ownerDocument !== this.document || !this.document.contains(this.host)) && structure();
      let radios = Array.from(this.document.querySelectorAll("input")).filter((input) => input.type === "radio");
      for (let group2 of this.groups) same(group2.members, radios.filter((input) => input.name === group2.name && input.form === group2.form)) || structure();
      for (let [group2, old] of this.optgroups)
        (group2.parentNode !== old.parent || group2.previousSibling !== old.previous || group2.nextSibling !== old.next) && structure(), attrEqual(attributes(group2), old.attrs) || mismatch2();
      for (let item of this.snapshots.values()) {
        let current3 = snapshot(item.element);
        (current3.parent !== item.parent || current3.previous !== item.previous || current3.next !== item.next || current3.form !== item.form || current3.type !== item.type || !same(current3.options, item.options)) && structure(), (!attrEqual(current3.attrs, item.attrs) || current3.text !== item.text || current3.value !== item.value || current3.checked !== item.checked || current3.selected !== item.selected || !same(current3.selectedOptions, item.selectedOptions) || !same(current3.files, item.files) || !same(current3.selection, item.selection)) && mismatch2();
      }
      this.document.activeElement !== this.focus && this.focus && this.owned.has(this.focus) && mismatch2();
    }
    release() {
      this.host = void 0, this.document = void 0, this.focus = null, this.owned.clear(), this.snapshots.clear(), this.groups.length = 0, this.optgroups.clear(), this.bindings.length = 0, this.observations = void 0;
    }
  };
  var IslandStateError = class extends Error {
    constructor(code, detail) {
      super(`[forma] ${code}: ${detail}`);
      this.code = code;
      this.name = "IslandStateError";
    }
    code;
  };
  var MAX_STATE_BYTES = 1048576;
  var HASH = /^[0-9a-f]{16}$/;
  var stateEncoder = new TextEncoder();
  var forbidden = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var registrations = /* @__PURE__ */ new WeakMap();
  var registeredComponents = /* @__PURE__ */ new WeakSet();
  function isRegisteredIslandComponent(component) {
    return registeredComponents.has(component);
  }
  var own = (value2, name) => Object.prototype.hasOwnProperty.call(value2, name);
  var object = (value2) => value2 !== null && typeof value2 == "object" && !Array.isArray(value2);
  function refuse5(code, detail) {
    throw new IslandStateError(code, detail);
  }
  function __islandRegistration(component, metadata) {
    (typeof component != "function" || !object(metadata) || typeof metadata.h != "string" || !HASH.test(metadata.h) || metadata.mode !== 0 && metadata.mode !== 1) && refuse5("FORMA_E_ISLAND_REGISTRATION", "invalid compiled island metadata");
    let schema = copySchema(metadata.schema), hydrate = (_host, props) => component(props);
    return registrations.set(hydrate, { hydrate, component, h: metadata.h, schema, mode: metadata.mode }), registeredComponents.add(component), hydrate;
  }
  function copySchema(input) {
    let fail = () => refuse5("FORMA_E_ISLAND_REGISTRATION", "invalid compiled props schema");
    (!Array.isArray(input) || input.length < 1 || input.length > 1024) && fail();
    let dependencies = [], result = [], bytes = 3, charge = (size) => {
      bytes += size, bytes > MAX_STATE_BYTES && fail();
    }, text3 = (value2) => {
      let size = schemaTextBytes(value2);
      size < 0 && fail(), charge(2 + size);
    };
    for (let fields of input) {
      (!Array.isArray(fields) || fields.length > 1024) && fail(), charge(2);
      let names = /* @__PURE__ */ new Set(), edges = [], copy2 = [];
      for (let field of fields) {
        (!object(field) || typeof field.name != "string" || forbidden.has(field.name) || names.has(field.name)) && fail(), names.add(field.name), text3(field.name);
        let wrappers = [], type = field.type;
        for (; object(type) && (type.kind === "array" || type.kind === "optional"); )
          wrappers.length === 16 && fail(), wrappers.push(type.kind), charge(1), type = type.kind === "array" ? type.element : type.inner;
        object(type) || fail();
        let leaf;
        switch (type.kind) {
          case "boolean":
          case "string":
          case "number":
          case "date":
            charge(1), leaf = { kind: type.kind };
            break;
          case "enum": {
            (!Array.isArray(type.variants) || !type.variants.length || type.variants.length > 1024 || type.variants.some((item) => typeof item != "string") || new Set(type.variants).size !== type.variants.length) && fail(), charge(3);
            for (let variant of type.variants) text3(variant);
            leaf = { kind: "enum", variants: Object.freeze([...type.variants]) };
            break;
          }
          case "object":
            (!Number.isInteger(type.object) || type.object < 0 || type.object >= input.length) && fail(), charge(3), edges.push(type.object), leaf = { kind: "object", object: type.object };
            break;
          default:
            fail();
        }
        for (let i = wrappers.length - 1; i >= 0; i--)
          Object.freeze(leaf), leaf = wrappers[i] === "array" ? { kind: "array", element: leaf } : { kind: "optional", inner: leaf };
        copy2.push(Object.freeze({ name: field.name, type: Object.freeze(leaf) }));
      }
      dependencies.push(edges), result.push(copy2);
    }
    let colors = new Uint8Array(input.length), stack = [{ id: 0, next: 0 }];
    for (colors[0] = 1; stack.length; ) {
      let frame = stack[stack.length - 1], edges = dependencies[frame.id];
      if (frame.next === edges.length) {
        colors[frame.id] = 2, stack.pop();
        continue;
      }
      let child2 = edges[frame.next++];
      colors[child2] === 1 && fail(), colors[child2] === 0 && (colors[child2] = 1, stack.push({ id: child2, next: 0 }));
    }
    return colors.some((color) => color !== 2) && fail(), Object.freeze(result.map((fields) => Object.freeze(fields)));
  }
  function schemaTextBytes(text3) {
    if (text3.length > 65535) return -1;
    let bytes = 0;
    for (let i = 0; i < text3.length; i++) {
      let code = text3.charCodeAt(i);
      if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319 && text3.charCodeAt(i + 1) >= 56320 && text3.charCodeAt(i + 1) <= 57343)
        bytes += 4, i++;
      else {
        if (code >= 55296 && code <= 57343) return -1;
        bytes += 3;
      }
      if (bytes > 65535) return -1;
    }
    return bytes;
  }
  function exactKeys(value2, keys) {
    return Object.keys(value2).length === keys.length && keys.every((key) => own(value2, key));
  }
  var documents = /* @__PURE__ */ new WeakMap();
  var validatedDocuments = /* @__PURE__ */ new WeakMap();
  function occurrenceOf(text3) {
    if (text3 === null || !/^(0|[1-9][0-9]*)$/.test(text3)) return null;
    let index = Number(text3);
    return Number.isSafeInteger(index) ? index : null;
  }
  function readDocument(doc) {
    let cached = documents.get(doc);
    if (cached) return cached;
    let state = { entries: [], claims: /* @__PURE__ */ new WeakMap() };
    documents.set(doc, state);
    let counts = /* @__PURE__ */ new Map();
    for (let host of doc.querySelectorAll("[data-forma-island]")) {
      let text3 = host.getAttribute("data-forma-state"), claim = { boundary: host.getAttribute("data-forma-island"), component: host.getAttribute("data-forma-component"), h: host.getAttribute("data-forma-h"), occurrence: occurrenceOf(text3), duplicate: false };
      if (state.claims.set(host, claim), claim.occurrence !== null) {
        let previous = counts.get(claim.occurrence);
        previous ? (claim.duplicate = true, previous.duplicate = true) : counts.set(claim.occurrence, claim);
      }
    }
    try {
      let block = doc.head?.querySelector('script[type="application/json"][data-island-state]');
      block || refuse5("FORMA_E_ISLAND_STATE", "missing first head state block");
      let text3 = block.textContent ?? "";
      text3.length > MAX_STATE_BYTES && refuse5("FORMA_E_ISLAND_STATE", "state block exceeds one MiB");
      let target2 = new Uint8Array(Math.min(MAX_STATE_BYTES, text3.length * 3));
      stateEncoder.encodeInto(text3, target2).read !== text3.length && refuse5("FORMA_E_ISLAND_STATE", "state block exceeds one MiB");
      let envelope;
      try {
        envelope = JSON.parse(text3);
      } catch {
        refuse5("FORMA_E_ISLAND_STATE", "invalid state JSON");
      }
      (!object(envelope) || !exactKeys(envelope, ["v", "s", "i"]) || envelope.v !== 1 || !Array.isArray(envelope.s) || envelope.s.length !== 0 || !Array.isArray(envelope.i)) && refuse5("FORMA_E_ISLAND_STATE", "invalid v1 state envelope"), state.entries = envelope.i.map((entry) => object(entry) && exactKeys(entry, ["h", "p"]) && typeof entry.h == "string" && HASH.test(entry.h) && object(entry.p) ? entry : null);
    } catch (error) {
      state.error = error instanceof IslandStateError ? error : new IslandStateError("FORMA_E_ISLAND_STATE", "cannot read state block");
    }
    return state;
  }
  function project(input, schema) {
    let output = /* @__PURE__ */ Object.create(null), pending = [{ kind: "object", value: input, fields: schema[0], out: output, index: 0 }], count = 0, fail = () => refuse5("FORMA_E_ISLAND_SCHEMA", "state does not match the declared props schema");
    for (; pending.length; ) {
      let work = pending.pop();
      if (work.kind === "object") {
        if (work.index === work.fields.length) continue;
        let field = work.fields[work.index++];
        pending.push(work);
        let value3 = own(work.value, field.name) ? work.value[field.name] : void 0;
        if (value3 == null && field.type.kind === "optional") continue;
        pending.push({ kind: "value", value: value3, type: field.type, out: work.out, key: field.name });
        continue;
      }
      if (work.kind === "array") {
        if (work.index === work.value.length) continue;
        let index = work.index++;
        pending.push(work, { kind: "value", value: work.value[index], type: work.type, out: work.out, key: index });
        continue;
      }
      ++count > MAX_STATE_BYTES && fail();
      let { type } = work;
      for (; type.kind === "optional" && work.value !== null; ) type = type.inner;
      let value2 = work.value;
      switch (type.kind) {
        case "optional":
          value2 = null;
          break;
        case "boolean":
        case "string":
          typeof value2 !== type.kind && fail();
          break;
        case "number":
          (typeof value2 != "number" || !Number.isFinite(value2)) && fail();
          break;
        case "date":
          if (typeof work.value != "number" || !Number.isInteger(work.value) || Math.abs(work.value) > 864e13) return fail();
          value2 = new Date(work.value);
          break;
        case "enum":
          (typeof value2 != "string" || !type.variants.includes(value2)) && fail();
          break;
        case "object": {
          if (!object(work.value)) return fail();
          let out = /* @__PURE__ */ Object.create(null);
          value2 = out, pending.push({ kind: "object", value: work.value, fields: schema[type.object], out, index: 0 });
          break;
        }
        case "array": {
          if (!Array.isArray(work.value)) return fail();
          let out = [];
          value2 = out, pending.push({ kind: "array", value: work.value, type: type.element, out, index: 0 });
          break;
        }
      }
      work.out[work.key] = value2;
    }
    return output;
  }
  function originalClaim(host, state) {
    let claim = state.claims.get(host);
    return (!claim || claim.duplicate || claim.occurrence === null || host.getAttribute("data-forma-island") !== claim.boundary || host.getAttribute("data-forma-state") !== String(claim.occurrence) || host.getAttribute("data-forma-component") !== claim.component || host.getAttribute("data-forma-h") !== claim.h) && refuse5("FORMA_E_ISLAND_IDENTITY", "island does not match its original document claim"), claim;
  }
  function checkIslandClaim(value2) {
    let document2 = validatedDocuments.get(value2);
    (!document2 || value2.host.ownerDocument !== document2 || !document2.contains(value2.host)) && refuse5("FORMA_E_ISLAND_IDENTITY", "island is outside its validated document");
    let state = readDocument(document2), claim = originalClaim(value2.host, state);
    (claim.occurrence !== value2.occurrence || claim.h !== value2.registration.h) && refuse5("FORMA_E_ISLAND_IDENTITY", "island identity changed before activation");
  }
  function preflightIslands(registry2, root) {
    let doc = root.nodeType === 9 ? root : root.ownerDocument;
    if (!doc) return [];
    let state = readDocument(doc), results = [];
    for (let host of root.querySelectorAll("[data-forma-island]"))
      try {
        if (state.error) throw state.error;
        let claim = originalClaim(host, state), entry = state.entries[claim.occurrence];
        entry === void 0 && refuse5("FORMA_E_ISLAND_IDENTITY", "state occurrence is out of range"), entry === null && refuse5("FORMA_E_ISLAND_STATE", "invalid state entry"), (!claim.component || !own(registry2, claim.component)) && refuse5("FORMA_E_ISLAND_REGISTRATION", "missing own compiled registration");
        let hydrate = registry2[claim.component], registration = registrations.get(hydrate);
        registration || refuse5("FORMA_E_ISLAND_REGISTRATION", "SSR registration has no compiled contract"), (claim.h !== entry.h || claim.h !== registration.h) && refuse5("FORMA_E_ISLAND_IDENTITY", "root, state and compiled digests differ");
        let props = project(entry.p, registration.schema), value2 = { host, occurrence: claim.occurrence, registration, props };
        validatedDocuments.set(value2, doc), results.push({ host, value: value2 });
      } catch (error) {
        results.push({ host, error: error instanceof IslandStateError ? error : new IslandStateError("FORMA_E_ISLAND_STATE", "cannot validate island state") });
      }
    return results;
  }
  function mismatch3() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_VALUE");
  }
  function data(value2, key, required = false) {
    let field = Object.getOwnPropertyDescriptor(value2, key);
    if (!field) {
      required && mismatch3();
      return;
    }
    return "value" in field || mismatch3(), field.value;
  }
  function sameProps(input, expected, schema) {
    input == null && (input = /* @__PURE__ */ Object.create(null)), object(input) || mismatch3();
    let pending = [{ kind: "object", left: input, right: expected, fields: schema[0], index: 0 }], count = 0;
    for (; pending.length; ) {
      let work = pending.pop();
      if (work.kind === "object") {
        if (work.index === work.fields.length) continue;
        let field = work.fields[work.index++];
        pending.push(work, { kind: "value", left: data(work.left, field.name), right: data(work.right, field.name), type: field.type });
        continue;
      }
      if (work.kind === "array") {
        if (work.index === work.length) continue;
        let index = work.index++;
        pending.push(work, { kind: "value", left: data(work.left, index, true), right: data(work.right, index, true), type: work.type });
        continue;
      }
      ++count > MAX_STATE_BYTES && mismatch3();
      let { type } = work, { left, right } = work;
      if (!(type.kind === "optional" && left == null && right == null)) {
        for (; type.kind === "optional"; ) type = type.inner;
        switch (type.kind) {
          case "object":
            (!object(left) || !object(right)) && mismatch3(), pending.push({ kind: "object", left, right, fields: schema[type.object], index: 0 });
            break;
          case "array": {
            (!Array.isArray(left) || !Array.isArray(right)) && mismatch3();
            let length = data(right, "length");
            data(left, "length") !== length && mismatch3(), pending.push({ kind: "array", left, right, type: type.element, length, index: 0 });
            break;
          }
          case "date": {
            let epoch;
            try {
              epoch = Date.prototype.getTime.call(left);
            } catch {
              mismatch3();
            }
            (!Number.isFinite(epoch) || epoch !== right) && mismatch3();
            break;
          }
          default:
            left !== right && mismatch3();
        }
      }
    }
  }
  function matchAdoptionChild(host, description, value2) {
    if (checkIslandClaim(value2), value2.host !== host || description.component !== value2.registration.component || description.args.length > 1)
      throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
    let entry = readDocument(validatedDocuments.get(value2)).entries[value2.occurrence];
    entry || refuse5("FORMA_E_ISLAND_STATE", "original child state is unavailable"), sameProps(description.args[0], entry.p, value2.registration.schema);
  }
  function refuse6() {
    throw new AdoptionDomError("FORMA_E_HYDRATE_STRUCTURE");
  }
  function text2(value2) {
    return value2 == null ? "" : typeof value2 == "string" || typeof value2 == "number" || typeof value2 == "boolean" ? String(value2) : refuse6();
  }
  function ownProps(props) {
    return Object.entries(Object.getOwnPropertyDescriptors(props)).map(([key, property]) => ("value" in property || refuse6(), [key, property.value]));
  }
  function listenerObject(value2) {
    if (value2 === null || typeof value2 != "object") return false;
    for (let object2 = value2; object2; object2 = Object.getPrototypeOf(object2)) {
      let descriptor = Object.getOwnPropertyDescriptor(object2, "handleEvent");
      if (descriptor) return "value" in descriptor ? typeof descriptor.value == "function" : typeof descriptor.get == "function";
    }
    return false;
  }
  function prepareAdoption(host, build, options = {}) {
    let dom = new AdoptionDom(host), controls = new AdoptionControls(host), children2 = /* @__PURE__ */ new Set(), scopeOptions = { callback: (fn) => withAdoptionDescription(fn, false), check: () => {
      dom.assertUnchanged(), controls.check();
      for (let child2 of children2) checkIslandClaim(child2);
    }, failure: options.failure }, scope = options.scope?.(scopeOptions) ?? new AdoptionLifecycle(scopeOptions), listeners = [], nextBinding = 0, initialFailure = false;
    function rememberFailure(diagnostic) {
      diagnostic && !initialFailure && (initialFailure = true, options.errorContext?.(diagnostic));
    }
    function at(label, fn) {
      let binding = nextBinding++, parent2 = currentAdoptionDiagnostic(), diagnostic = Object.freeze({ binding, path: `${parent2?.path ?? ""}/${label}[${binding}]` });
      try {
        return withAdoptionDiagnostic(diagnostic, fn);
      } catch (error) {
        throw rememberFailure(diagnostic), error;
      }
    }
    let controlBindings = /* @__PURE__ */ new Map(), release = () => {
      dom.release(), controls.release(), controlBindings.clear(), children2.clear();
    }, dispose = () => {
      scope.abort(), release();
    };
    function construct(fn, ns) {
      return scope.run(() => withNamespace(ns, () => withAdoptionDescription(fn)));
    }
    function attribute(element2, key, value2) {
      let binding, initial2 = typeof value2 == "function" ? scope.observe(value2, (next) => binding.write(next)) : value2;
      binding = prepareAttribute(element2, key, initial2), dom.expectAttribute(element2, binding.local, binding.initial, binding.namespace);
    }
    function control2(element2, key, value2, authority) {
      let read = typeof value2 == "function" ? value2 : void 0, binding = { read: authority ?? read, diagnostic: currentAdoptionDiagnostic() }, write = (next) => {
        if (binding.skip) {
          let expected = binding.skip.value;
          if (binding.skip = void 0, Object.is(next, expected) || Array.isArray(next) && Array.isArray(expected) && next.length === expected.length && next.every((item, i) => item === expected[i])) return;
        }
        writeFormControlProperty(element2, key, next);
      }, initial2 = read ? scope.observe(read, write) : value2, token = controls.add({ element: element2, key, initial: initial2, kind: read ? "binding" : "initial", codec: binding.read ? scope.inputCodec(binding.read) : void 0 });
      controlBindings.set(token, binding);
    }
    function textarea(element2, children3) {
      let reads = children3.filter((child2) => typeof child2 == "function"), collect = () => children3.map((child2) => {
        let value2 = typeof child2 == "function" ? child2() : child2;
        return value2 == null || typeof value2 == "boolean" ? "" : text2(value2);
      }).join("");
      control2(element2, "text", reads.length ? collect : collect(), children3.length === 1 && reads.length === 1 ? reads[0] : void 0);
    }
    function title(element2, children3) {
      let collect = () => children3.map((child2) => {
        let value2 = typeof child2 == "function" ? child2() : child2;
        return value2 == null || typeof value2 == "boolean" ? "" : text2(value2);
      }).join(""), previous, write = (next) => {
        next !== previous && (element2.textContent = next, previous = next);
      }, initial2 = children3.some((child2) => typeof child2 == "function") ? scope.observe(collect, write) : collect(), inside = dom.children(element2);
      inside.text(initial2), inside.finish(), previous = initial2;
    }
    function props(element2, values, raw) {
      if (values)
        for (let [key, value2] of ownProps(values)) at("@" + key, () => {
          if (key !== "children") {
            if (key === "ref") {
              typeof value2 == "function" && scope.deferRef(() => value2(element2));
              return;
            }
            if (key.startsWith("on") && key.length > 2) {
              if (typeof value2 == "function" || listenerObject(value2)) {
                let listener = scope.liveCallback((event) => {
                  typeof value2 == "function" ? value2.call(element2, event) : value2.handleEvent(event);
                }), item = { element: element2, event: key.slice(2).toLowerCase(), listener };
                listeners.push(item), registerDisposer(() => item.controller?.abort());
              }
              dom.expectAttribute(element2, key.toLowerCase(), null);
              return;
            }
            if (key === "style") {
              let binding, initial2 = typeof value2 == "function" ? scope.observe(value2, (next) => binding.write(next)) : value2;
              binding = prepareStyle(element2, initial2);
              return;
            }
            if (key === "dangerouslySetInnerHTML") {
              raw(value2);
              return;
            }
            if (isFormControlProperty(element2, key)) {
              control2(element2, key, value2);
              return;
            }
            if (isEventHandlerAttr(key)) {
              dom.expectAttribute(element2, key.toLowerCase(), null);
              return;
            }
            attribute(element2, key, value2);
          }
        });
    }
    function element(desc, cursor, ns) {
      let own2 = desc.tag === "svg" ? SVG_NS : desc.tag === "math" ? MATHML_NS : ns, target2 = cursor.element(desc.tag, own2), area = target2.namespaceURI === "http://www.w3.org/1999/xhtml" && target2.localName === "textarea", valueProp = area && desc.props && Object.hasOwn(desc.props, "value");
      valueProp && desc.children.some((child2) => child2 != null && typeof child2 != "boolean" && child2 !== "") && refuse6();
      let raw, fallback, isTemplate = target2.namespaceURI === "http://www.w3.org/1999/xhtml" && target2.localName === "template", content = isTemplate ? target2.content : target2, beforeReplace = () => {
        let parent2 = target2.parentNode, previous = target2.previousSibling, next = target2.nextSibling;
        (!parent2 || scope.phase !== "live") && refuse6(), fallback?.dispose(), fallback = void 0, deactivateAllIslands(content), (scope.phase !== "live" || target2.parentNode !== parent2 || target2.previousSibling !== previous || target2.nextSibling !== next || isTemplate && target2.content !== content) && refuse6();
      };
      if (props(target2, desc.props, (value2) => {
        let binding, initial2 = typeof value2 == "function" ? scope.observe(value2, (next) => binding.write(next, beforeReplace)) : value2;
        raw = binding = prepareRaw(target2, initial2);
      }), raw?.ownsContent) {
        desc.props, desc.children;
        return;
      }
      let children3 = () => {
        if (area) {
          valueProp || textarea(target2, desc.children);
          return;
        }
        if (target2.namespaceURI === "http://www.w3.org/1999/xhtml" && target2.localName === "title") {
          title(target2, desc.children);
          return;
        }
        let nested = dom.children(target2), inner = contentNs(target2);
        for (let child2 of desc.children) walk(child2, nested, inner);
        nested.finish();
      };
      raw ? fallback = scope.group(children3) : children3();
    }
    let materialization = liveRanges(scope, host.ownerDocument, (element2) => {
      element2.hasAttribute("data-forma-island") && deactivateIsland(element2), deactivateAllIslands(element2);
    });
    function fresh(value2, ns) {
      return materializeAdoption(value2, ns, materialization);
    }
    function conditionalBranch(desc, ns, initial2, parent2, snapshot2) {
      let before = snapshot2?.(), selected = desc.condition() ? desc.whenTrue : desc.whenFalse, build2 = () => {
        let value2 = withNamespace(ns, () => withAdoptionDescription(() => selected?.()));
        return initial2 ? value2 : fresh(value2, ns);
      };
      return { kind: "conditional", branch: parent2 ? parent2.trackedChild(build2) : scope.trackedGroup(build2), before };
    }
    function conditional(initial2, cursor, ns, connect) {
      let range = cursor.range("s"), active3 = initial2.branch, snapshot2 = () => {
        let parent2 = range.start.parentNode;
        (!parent2 || range.end.parentNode !== parent2) && refuse6();
        let nodes = [];
        for (let node = range.start.nextSibling; node !== range.end; node = node?.nextSibling ?? null)
          node || refuse6(), nodes.push(node);
        return { parent: parent2, nodes };
      }, check = (before) => {
        (scope.phase !== "live" || range.start.parentNode !== before.parent || range.end.parentNode !== before.parent) && refuse6();
        let node = range.start.nextSibling;
        for (let expected of before.nodes)
          node !== expected && refuse6(), node = node.nextSibling;
        node !== range.end && refuse6();
      };
      active3.run(() => {
        let inside = dom.within(range);
        walk(active3.value, inside, ns), inside.finish();
      }), connect((next) => {
        let before = next.before;
        before || refuse6(), check(before), active3.dispose(), check(before);
        for (let node of before.nodes) node.nodeType === 1 && deactivateAllIslands(node);
        check(before);
        for (let node of before.nodes) before.parent.removeChild(node);
        next.branch.value && before.parent.insertBefore(next.branch.value, range.end), active3 = next.branch;
      }, snapshot2);
    }
    function directConditional(desc, cursor, ns) {
      let owner, initial2 = true, write, snapshot2;
      owner = scope.group(() => {
        let first = scope.observe(() => conditionalBranch(desc, ns, initial2, owner, snapshot2), (next) => write(next));
        initial2 = false, conditional(first, cursor, ns, (update, read) => {
          write = update, snapshot2 = read;
        });
      });
    }
    function show(desc, cursor, ns, observed) {
      let range = cursor.range("s"), active3, initial2 = true, current3, cached = /* @__PURE__ */ new Map(), owner;
      owner = scope.group(() => {
        let update = (next) => {
          if (next === current3) return;
          let parent2 = range.start.parentNode;
          (!parent2 || range.end.parentNode !== parent2) && refuse6();
          let leaving = [];
          for (let node = range.start.nextSibling; node !== range.end; node = node?.nextSibling ?? null)
            node || refuse6(), leaving.push(node);
          let entering = cached.get(next);
          if (entering) cached.delete(next);
          else {
            let branch = owner.child(() => untrack(() => {
              let value2 = observed?.description() ?? desc;
              return fresh(withNamespace(ns, () => withAdoptionDescription(() => (next ? value2.whenTrue : value2.whenFalse)?.())), ns);
            })), fragment4 = host.ownerDocument.createDocumentFragment();
            branch.value && fragment4.appendChild(branch.value), entering = { fragment: fragment4, owner: branch };
          }
          initial2 && active3.dispose(), (scope.phase !== "live" || range.start.parentNode !== parent2 || range.end.parentNode !== parent2) && refuse6();
          let checked = range.start.nextSibling;
          for (let node of leaving)
            checked !== node && refuse6(), checked = node.nextSibling;
          checked !== range.end && refuse6();
          let fragment3 = host.ownerDocument.createDocumentFragment();
          for (let node of leaving) fragment3.appendChild(node);
          initial2 ? initial2 = false : cached.set(current3, { fragment: fragment3, owner: active3 }), active3 = entering.owner, current3 = next, parent2.insertBefore(entering.fragment, range.end);
        };
        observed ? (current3 = observed.initial, observed.connect(update)) : current3 = scope.observe(() => !!desc.condition(), update), active3 = scope.group(() => {
          let inside = dom.within(range), value2 = observed?.description() ?? desc, selected = current3 ? value2.whenTrue : value2.whenFalse;
          selected && walk(construct(selected, ns), inside, ns), inside.finish();
        }), registerDisposer(() => {
          cached.clear();
        });
      });
    }
    function list(desc, cursor, ns) {
      let range = cursor.range("l"), cache2 = /* @__PURE__ */ new Map(), ordered = [], tail = [], owner, keyOwner, reconciler, keys = (values) => listItems(values, desc.keyFn);
      function contents() {
        let result = [];
        for (let node = range.start.nextSibling; node !== range.end; node = node?.nextSibling ?? null)
          node || refuse6(), result.push(node);
        return result;
      }
      owner = scope.group(() => {
        let initial2 = scope.observe(desc.items, (value2) => {
          reconciler.update(value2);
        });
        keyOwner = scope.group(() => keys(initial2));
        let prepared = keyOwner.value, keyed = contents().filter((node2) => node2.nodeType === 1).filter((element2) => element2.hasAttribute("data-forma-key")), mismatch4 = (extent) => new AdoptionDomError("FORMA_E_HYDRATE_LIST_COUNT", `client has ${prepared.items.length} item${prepared.items.length === 1 ? "" : "s"}, ${extent}`);
        if (keyed.length && keyed.length !== prepared.items.length) throw mismatch4(`server range has ${keyed.length} keyed root elements`);
        keyed.some((element2, i) => element2.getAttribute("data-forma-key") !== String(prepared.keys[i])) && refuse6();
        let originalRows = /* @__PURE__ */ new Map();
        for (let element2 of keyed) {
          let key = element2.getAttribute("data-forma-key");
          originalRows.has(key) && refuse6(), originalRows.set(key, element2);
        }
        let inside = dom.within(range);
        for (let i = 0; i < prepared.items.length; i++) {
          let item = prepared.items[i], key = prepared.keys[i], setIndex, span, child2 = scope.group(() => {
            let [getIndex, set] = createSignal(i);
            setIndex = set;
            let empty = inside.atEnd;
            try {
              let captured = inside.capture(() => walk(construct(() => desc.renderFn(item, getIndex), ns), inside, ns));
              span = new AdoptionRow(captured.pieces);
            } catch (error) {
              throw empty && error instanceof AdoptionDomError && (error.code === "FORMA_E_HYDRATE_NODE" || error.code === "FORMA_E_HYDRATE_MARKER") ? mismatch4(`server range exhausted after ${i} prepared items`) : error;
            }
          });
          if (keyed.length) {
            let firstElement = span.nodes().find((node2) => node2.nodeType === 1);
            originalRows.get(String(key)) !== firstElement && refuse6();
          }
          cache2.set(key, { owner: child2, span, item, setIndex }), ordered.push(cache2.get(key));
        }
        try {
          inside.finish();
        } catch (error) {
          throw error instanceof AdoptionDomError && error.code === "FORMA_E_HYDRATE_STRUCTURE" ? mismatch4(inside.remainder()) : error;
        }
        let last = null;
        for (let row of ordered) row.span.last && (last = row.span.last);
        let node = last ? last.nextSibling : range.start.nextSibling;
        for (; node !== range.end; node = node?.nextSibling ?? null)
          node || refuse6(), tail.push(node);
        registerDisposer(() => reconciler?.clear());
      }), reconciler = liveList({
        range,
        owner,
        live: () => scope.phase === "live",
        keys: (value2) => withAdoptionDescription(() => keys(value2), false),
        render: (item, index) => fresh(withNamespace(ns, () => withAdoptionDescription(() => desc.renderFn(item, index))), ns),
        rerender: desc.options?.updateOnItemChange === "rerender",
        removeChildren: (element2) => {
          element2.hasAttribute("data-forma-island") && deactivateIsland(element2), deactivateAllIslands(element2);
        }
      }, { cache: cache2, ordered, tail, keyOwner });
    }
    function walk(value2, cursor, ns, root = false) {
      at("node", () => visit(value2, cursor, ns, root));
    }
    function visit(value2, cursor, ns, root = false) {
      if (value2 == null || typeof value2 == "boolean") {
        cursor.rangeKind() === "t" && cursor.textRange(text2(value2));
        return;
      }
      if (typeof value2 == "string" || typeof value2 == "number") {
        cursor.rangeKind() === "t" ? cursor.textRange(String(value2)) : cursor.text(String(value2));
        return;
      }
      if (typeof value2 == "function") {
        let owner, first = true, snapshot2;
        owner = scope.group(() => {
          let write, initial2 = scope.observe(() => {
            let result = withNamespace(ns, () => withAdoptionDescription(value2));
            if (result && typeof result == "object" && result.type === "show") {
              let description2 = result;
              return description2.conditional ? conditionalBranch(description2, ns, first, owner, snapshot2) : { kind: "show", description: description2, value: !!description2.condition() };
            }
            return { kind: "text", value: text2(result) };
          }, (next) => write(next));
          if (first = false, initial2.kind === "conditional")
            conditional(initial2, cursor, ns, (update, read) => {
              snapshot2 = read, write = (next) => {
                next.kind !== "conditional" && refuse6(), update(next);
              };
            });
          else if (initial2.kind === "show") {
            let description2 = initial2.description;
            show(description2, cursor, ns, { initial: initial2.value, description: () => description2, connect: (update) => {
              write = (next) => {
                next.kind !== "show" && refuse6(), description2 = next.description, update(next.value);
              };
            } });
          } else {
            let target2 = cursor.textRange(initial2.value), previous = initial2.value;
            write = (next) => {
              next.kind !== "text" && refuse6(), next.value !== previous && (target2.data = next.value, previous = next.value);
            };
          }
        });
        return;
      }
      if (typeof value2 != "object") return refuse6();
      let description = value2;
      switch (description.type) {
        case "element":
          element(description, cursor, ns);
          return;
        case "show":
          description.conditional ? directConditional(description, cursor, ns) : show(description, cursor, ns);
          return;
        case "list":
          list(description, cursor, ns);
          return;
        case "fragment":
          for (let child2 of description.children) walk(child2, cursor, ns);
          return;
        case "component": {
          if (!root && isRegisteredIslandComponent(description.component)) {
            let host2 = cursor.island(), checked = options.children?.get(host2);
            checked || refuse6(), matchAdoptionChild(host2, description, checked), children2.add(checked);
            return;
          }
          scope.group(() => walk(construct(() => Reflect.apply(description.component, description.receiver, description.args), ns), cursor, ns, root));
          return;
        }
        default:
          return refuse6();
      }
    }
    try {
      let start = (value2) => {
        if (options.target === "public" && value2 && typeof value2 == "object" && value2.type === "component") {
          let component = value2;
          scope.group(() => start(construct(() => Reflect.apply(component.component, component.receiver, component.args), contentNs(host))));
          return;
        }
        let own2 = options.target !== "public" || value2 && typeof value2 == "object" && value2.type === "element" && host.hasAttribute("data-forma-island"), cursor = own2 ? dom.root() : dom.children(host), ns = own2 ? contentNs(host.parentNode) : contentNs(host);
        walk(value2, cursor, ns, true), cursor.finish();
      };
      scope.run(() => start(construct(build, options.target === "public" ? contentNs(host) : contentNs(host.parentNode))));
      for (let observation of controls.finish((token) => rememberFailure(controlBindings.get(token)?.diagnostic))) if (observation.kind === "binding" && observation.edited) {
        let binding = controlBindings.get(observation.token);
        binding.read || refuse6();
        try {
          withAdoptionDiagnostic(binding.diagnostic, () => scope.queueEdit(binding.read, observation.value));
        } catch (error) {
          throw rememberFailure(binding.diagnostic), error;
        }
        binding.skip = { value: observation.value };
      }
      scope.seal();
    } catch (error) {
      throw dispose(), error;
    }
    return {
      get phase() {
        return scope.phase;
      },
      dispose,
      commit() {
        if (scope.phase !== "validated") return refuse6();
        try {
          if (dom.assertUnchanged(), controls.check(), listeners.length) {
            let Controller = host.ownerDocument.defaultView?.AbortController ?? AbortController;
            for (let item of listeners)
              item.controller = new Controller(), item.element.addEventListener(item.event, item.listener, { signal: item.controller.signal });
          }
          scope.seed(), scope.publish(), listeners.length = 0, release();
        } catch (error) {
          throw dispose(), error;
        }
      }
    };
  }
  function untracked(read) {
    let previous = setActiveSub(void 0);
    try {
      return read();
    } finally {
      setActiveSub(previous);
    }
  }
  function accepts(codec, value2) {
    switch (codec) {
      case "string":
        return typeof value2 == "string";
      case "number":
        return typeof value2 == "number" && Number.isFinite(value2);
      case "boolean":
        return typeof value2 == "boolean";
      case "string-array": {
        if (!Array.isArray(value2)) return false;
        for (let item of value2) if (typeof item != "string") return false;
        return true;
      }
    }
  }
  function copy(value2) {
    return Array.isArray(value2) ? [...value2] : value2;
  }
  function equal(a, b) {
    return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : Object.is(a, b);
  }
  var AdoptionScope = class extends AdoptionLifecycle {
    constructor(island, options = {}) {
      super(options);
      this.island = island;
      if (checkIslandClaim(island), island.registration.mode !== 0) throw new AdoptionScopeError("FORMA_E_HYDRATE_STRUCTURE");
    }
    island;
    builtins = /* @__PURE__ */ new WeakMap();
    locals = /* @__PURE__ */ new WeakMap();
    bindings = /* @__PURE__ */ new WeakMap();
    edits = /* @__PURE__ */ new Map();
    check() {
      checkIslandClaim(this.island), super.check();
    }
    capture(get, set) {
      this.state === "preparing" && this.currentGroup.alive && this.builtins.set(get, { get, set, group: this.currentGroup });
    }
    enroll(_site, [get, set]) {
      let local = this.builtins.get(get);
      this.state === "preparing" && local?.set === set && local.group.alive && this.locals.set(get, local);
    }
    writable(read, get, codec, site) {
      let local = this.locals.get(get);
      if (this.state !== "preparing" || !local?.group.alive || !this.currentGroup.alive) return read;
      let wrapper = () => read();
      return this.bindings.set(wrapper, { local, codec, site, group: this.currentGroup }), wrapper;
    }
    inputCodec(read) {
      let binding = this.bindings.get(read);
      return this.state === "preparing" && binding?.group.alive && binding.local.group.alive ? binding.codec : void 0;
    }
    /** Called only after the DOM planner detects a real normalized early edit. */
    queueEdit(read, value2) {
      this.require("preparing");
      try {
        let binding = this.bindings.get(read);
        if (!binding?.group.alive || !binding.local.group.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_TARGET");
        let before = untracked(binding.local.get);
        if (!accepts(binding.codec, value2) || !accepts(binding.codec, before))
          throw new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_TARGET", binding.site);
        let prior = this.edits.get(binding.local.get);
        if (prior && (prior.codec !== binding.codec || !equal(prior.next, value2)))
          throw new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_CONFLICT", binding.site);
        prior || this.edits.set(binding.local.get, { ...binding, before, baseline: copy(before), next: copy(value2) });
      } catch (cause) {
        throw this.abort(), cause;
      }
    }
    checkSeeds() {
      for (let edit of this.edits.values()) {
        if (!edit.group.alive || !edit.local.group.alive) throw new AdoptionScopeError("FORMA_E_HYDRATE_INPUT_TARGET", edit.site);
        if (!equal(untracked(edit.local.get), edit.baseline)) throw new AdoptionScopeError("FORMA_E_HYDRATE_VALUE", edit.site);
      }
    }
    applySeeds() {
      for (let edit of this.edits.values()) edit.local.set(edit.next);
    }
    rollbackSeeds() {
      for (let edit of this.edits.values()) edit.local.set(edit.before);
    }
    clearSeeds() {
      this.edits.clear();
    }
  };
  var activationPhase = /* @__PURE__ */ new WeakMap();
  var FORBIDDEN_PROP_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var scheduledOrActiveIslands = 0;
  function trackIsland(el) {
    el.__formaTracked || (el.__formaTracked = true, scheduledOrActiveIslands++);
  }
  function untrackIsland(el) {
    el.__formaTracked && (delete el.__formaTracked, scheduledOrActiveIslands--);
  }
  function hasScheduledOrActiveIslands() {
    return scheduledOrActiveIslands > 0;
  }
  function sanitizePropsDeep(props) {
    let stack = [props], seen = /* @__PURE__ */ new WeakSet();
    for (; stack.length > 0; ) {
      let current3 = stack.pop();
      if (!(current3 === null || typeof current3 != "object") && !seen.has(current3)) {
        seen.add(current3);
        for (let key of FORBIDDEN_PROP_KEYS)
          Object.prototype.hasOwnProperty.call(current3, key) && Object.getOwnPropertyDescriptor(current3, key)?.configurable && delete current3[key];
        for (let k of Object.keys(current3))
          stack.push(current3[k]);
      }
    }
    return props;
  }
  function activateIslands(registry2, root = document) {
    let checked = preflightIslands(registry2, root), children2 = /* @__PURE__ */ new Map();
    for (let result of checked) "value" in result && children2.set(result.host, result.value);
    for (let result of checked) {
      if ("error" in result) {
        console.error(result.error.message);
        continue;
      }
      let value2 = result.value, island = value2.host;
      if (activationPhase.has(island) || island.__formaScheduled) continue;
      try {
        checkIslandClaim(value2);
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        continue;
      }
      delete island.__formaDisposed, trackIsland(island), activationPhase.set(island, "scheduled");
      let trigger2 = island.getAttribute("data-forma-hydrate") || "load";
      if (trigger2 === "visible") {
        island.__formaScheduled = true;
        let observer = new IntersectionObserver(
          (entries) => {
            for (let entry of entries)
              entry.isIntersecting && (observer.disconnect(), delete island.__formaObserver, hydrateIslandRoot(value2, children2));
          },
          { rootMargin: "200px" }
        );
        island.__formaObserver = observer, observer.observe(island);
      } else if (trigger2 === "idle") {
        island.__formaScheduled = true;
        let hydrate = () => hydrateIslandRoot(value2, children2);
        if (typeof requestIdleCallback == "function") {
          let handle = requestIdleCallback(hydrate);
          island.__formaIdleCancel = () => cancelIdleCallback(handle);
        } else {
          let handle = setTimeout(hydrate, 200);
          island.__formaIdleCancel = () => clearTimeout(handle);
        }
      } else if (trigger2 === "interaction") {
        island.__formaScheduled = true;
        let hydrate = () => {
          island.removeEventListener("pointerdown", hydrate, true), island.removeEventListener("focusin", hydrate, true), delete island.__formaInteractionHandler, hydrateIslandRoot(value2, children2);
        };
        island.__formaInteractionHandler = hydrate, island.addEventListener("pointerdown", hydrate, { capture: true, once: true }), island.addEventListener("focusin", hydrate, { capture: true, once: true });
      } else
        hydrateIslandRoot(value2, children2);
    }
  }
  function deactivateIsland(el) {
    let previous = activationPhase.get(el);
    activationPhase.set(el, "disposed");
    let observer = el.__formaObserver;
    observer && (observer.disconnect(), delete el.__formaObserver);
    let interactionHandler = el.__formaInteractionHandler;
    interactionHandler && (el.removeEventListener("pointerdown", interactionHandler, true), el.removeEventListener("focusin", interactionHandler, true), delete el.__formaInteractionHandler);
    let idleCancel = el.__formaIdleCancel;
    idleCancel && (idleCancel(), delete el.__formaIdleCancel), delete el.__formaScheduled, untrackIsland(el), el.__formaDisposed = true;
    let dispose = el.__formaDispose;
    typeof dispose == "function" && (dispose(), delete el.__formaDispose, previous === "live" && el.setAttribute("data-forma-status", "disposed"));
  }
  function deactivateAllIslands(root = document) {
    let islands = root.querySelectorAll("[data-forma-island]");
    for (let island of islands)
      deactivateIsland(island);
  }
  function hydrateIslandRoot(value2, children2) {
    let root = value2.host;
    if (root.__formaDisposed || activationPhase.get(root) !== "scheduled") return;
    try {
      checkIslandClaim(value2);
    } catch (error) {
      deactivateIsland(root), console.error(error instanceof Error ? error.message : error);
      return;
    }
    delete root.__formaScheduled, activationPhase.set(root, "preparing");
    let componentName = root.getAttribute("data-forma-component"), occurrence = value2.occurrence, plan, scope, disposeRoot, activeRoot = root, reported = false, initialDiagnostic, dispose = () => {
      scope?.abort(), plan?.dispose(), disposeRoot?.();
    };
    root.__formaDispose = dispose;
    let failed = (error, fallback = "FORMA_E_HYDRATE_COMPONENT") => {
      if (reported) return;
      if (reported = true, dispose(), delete activeRoot.__formaDispose, untrackIsland(activeRoot), activationPhase.set(activeRoot, "error"), error instanceof IslandStateError) {
        console.error(error.message);
        return;
      }
      activeRoot.setAttribute("data-forma-status", "error");
      let code = isHydrateError(error) ? error.code : fallback, context2 = currentAdoptionDiagnostic() ?? initialDiagnostic, detail = Object.freeze({ island: componentName, occurrence, binding: context2?.binding ?? null, code, ...context2 ? { path: context2.path } : {} }), EventType = activeRoot.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
      activeRoot.dispatchEvent(new EventType("forma:error", { bubbles: true, detail })), reportHydrateError(error, ` (island "${componentName}", id=${occurrence})`);
    };
    try {
      if (value2.registration.mode === 1) {
        if (createUnownedRoot((stop) => {
          disposeRoot = stop;
          let result = value2.registration.hydrate(root, value2.props);
          if (root.__formaDisposed) {
            stop();
            return;
          }
          if (checkIslandClaim(value2), result instanceof Element) {
            for (let attr of Array.from(root.attributes)) attr.name.startsWith("data-forma-") && result.setAttribute(attr.name, attr.value);
            root.replaceWith(result), activeRoot = result, delete root.__formaDispose, result.__formaDispose = dispose, untrackIsland(root), trackIsland(result), activationPhase.set(root, "disposed");
          } else result instanceof Node && root.appendChild(result);
        }), root.__formaDisposed) return;
        activationPhase.set(activeRoot, "live"), activeRoot.setAttribute("data-forma-status", "active");
        return;
      }
      plan = prepareAdoption(root, () => value2.registration.hydrate(root, value2.props), {
        children: children2,
        scope: (options) => scope = new AdoptionScope(value2, options),
        failure: failed,
        errorContext: (context2) => {
          initialDiagnostic = context2;
        }
      }), plan.commit(), plan.phase === "live" && activationPhase.set(root, "live");
    } catch (error) {
      failed(error);
    }
  }
  function longestIncreasingSubsequence(arr) {
    let n = arr.length;
    if (n === 0) return [];
    let tails = new Int32Array(n), tailIndices = new Int32Array(n), predecessor = new Int32Array(n).fill(-1), tailsLen = 0;
    for (let i = 0; i < n; i++) {
      let val = arr[i], lo = 0, hi = tailsLen;
      for (; lo < hi; ) {
        let mid = lo + hi >> 1;
        tails[mid] < val ? lo = mid + 1 : hi = mid;
      }
      tails[lo] = val, tailIndices[lo] = i, lo > 0 && (predecessor[i] = tailIndices[lo - 1]), lo >= tailsLen && tailsLen++;
    }
    let result = new Array(tailsLen), idx = tailIndices[tailsLen - 1];
    for (let i = tailsLen - 1; i >= 0; i--)
      result[i] = idx, idx = predecessor[idx];
    return result;
  }
  var SMALL_LIST_THRESHOLD = 32;
  function deactivateIslandsIn(node) {
    if (hasScheduledOrActiveIslands() && node instanceof Element) {
      node.hasAttribute("data-forma-island") && deactivateIsland(node);
      for (let nested of node.querySelectorAll("[data-forma-island]"))
        deactivateIsland(nested);
    }
  }
  function removeRow(parent2, node, hooks) {
    if (hooks?.onBeforeRemove) {
      hooks.onBeforeRemove(node, () => {
        deactivateIslandsIn(node), node.parentNode && node.parentNode.removeChild(node);
      });
      return;
    }
    deactivateIslandsIn(node), parent2.removeChild(node);
  }
  var REPLACES_ROW = /* @__PURE__ */ Symbol("forma.replacesRow");
  function updateRowNode(parent2, node, item, updateFn) {
    let next = updateFn(node, item);
    return updateFn[REPLACES_ROW] && next instanceof Node && next !== node ? (deactivateIslandsIn(node), parent2.replaceChild(next, node), next) : node;
  }
  function reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    let oldLen = oldItems.length, newLen = newItems.length, oldKeys = new Array(oldLen);
    for (let i = 0; i < oldLen; i++)
      oldKeys[i] = keyFn(oldItems[i]);
    let oldIndices = new Array(newLen), oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      let key = keyFn(newItems[i]), found = -1;
      for (let j = 0; j < oldLen; j++)
        if (!oldUsed[j] && oldKeys[j] === key) {
          found = j, oldUsed[j] = 1;
          break;
        }
      oldIndices[i] = found;
    }
    for (let i = 0; i < oldLen; i++)
      oldUsed[i] || removeRow(parent2, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      if (allSameOrder) {
        let nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++)
          nodes[i] = updateRowNode(parent2, oldNodes[i], newItems[i], updateFn);
        return { nodes, items: newItems };
      }
    }
    let reusedIndices = [], reusedPositions = [];
    for (let i = 0; i < newLen; i++)
      oldIndices[i] !== -1 && (reusedIndices.push(oldIndices[i]), reusedPositions.push(i));
    let lisOfReused = longestIncreasingSubsequence(reusedIndices), lisFlags = new Uint8Array(newLen);
    for (let li of lisOfReused)
      lisFlags[reusedPositions[li]] = 1;
    let newNodes = new Array(newLen), nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = false;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = true;
      else if (node = updateRowNode(parent2, oldNodes[oldIndices[i]], newItems[i], updateFn), lisFlags[i]) {
        newNodes[i] = node, nextSibling2 = node;
        continue;
      }
      nextSibling2 ? parent2.insertBefore(node, nextSibling2) : parent2.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function reconcileList(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks) {
    let oldLen = oldItems.length, newLen = newItems.length;
    if (newLen === 0) {
      for (let i = 0; i < oldLen; i++)
        removeRow(parent2, oldNodes[i], hooks);
      return { nodes: [], items: [] };
    }
    if (oldLen === 0) {
      let nodes = new Array(newLen);
      for (let i = 0; i < newLen; i++) {
        let node = createFn(newItems[i]);
        beforeNode ? parent2.insertBefore(node, beforeNode) : parent2.appendChild(node), hooks?.onInsert?.(node), nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
    if (oldLen < SMALL_LIST_THRESHOLD)
      return reconcileSmall(parent2, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
    let oldKeyMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < oldLen; i++) {
      let k = keyFn(oldItems[i]), bucket = oldKeyMap.get(k);
      bucket ? bucket.push(i) : oldKeyMap.set(k, [i]);
    }
    let oldIndices = new Array(newLen), oldUsed = new Uint8Array(oldLen);
    for (let i = 0; i < newLen; i++) {
      let key = keyFn(newItems[i]), bucket = oldKeyMap.get(key);
      if (bucket && bucket.length > 0) {
        let oldIdx = bucket.shift();
        oldIndices[i] = oldIdx, oldUsed[oldIdx] = 1;
      } else
        oldIndices[i] = -1;
    }
    for (let i = 0; i < oldLen; i++)
      oldUsed[i] || removeRow(parent2, oldNodes[i], hooks);
    if (oldLen === newLen) {
      let allSameOrder = true;
      for (let i = 0; i < newLen; i++)
        if (oldIndices[i] !== i) {
          allSameOrder = false;
          break;
        }
      if (allSameOrder) {
        let nodes = new Array(newLen);
        for (let i = 0; i < newLen; i++)
          nodes[i] = updateRowNode(parent2, oldNodes[i], newItems[i], updateFn);
        return { nodes, items: newItems };
      }
    }
    let reusedIndices = [], reusedPositions = [];
    for (let i = 0; i < newLen; i++)
      oldIndices[i] !== -1 && (reusedIndices.push(oldIndices[i]), reusedPositions.push(i));
    let lisOfReused = longestIncreasingSubsequence(reusedIndices), lisFlags = new Uint8Array(newLen);
    for (let li of lisOfReused)
      lisFlags[reusedPositions[li]] = 1;
    let newNodes = new Array(newLen), nextSibling2 = beforeNode ?? null;
    for (let i = newLen - 1; i >= 0; i--) {
      let node, isNew = false;
      if (oldIndices[i] === -1)
        node = createFn(newItems[i]), isNew = true;
      else if (node = updateRowNode(parent2, oldNodes[oldIndices[i]], newItems[i], updateFn), lisFlags[i]) {
        newNodes[i] = node, nextSibling2 = node;
        continue;
      }
      nextSibling2 ? parent2.insertBefore(node, nextSibling2) : parent2.appendChild(node), isNew && hooks?.onInsert?.(node), newNodes[i] = node, nextSibling2 = node;
    }
    return { nodes: newNodes, items: newItems };
  }
  function createList(items, keyFn, renderFn, options) {
    if (describingAdoption)
      return { type: "list", items, keyFn, renderFn, options };
    let startMarker = document.createComment("forma-list-start"), endMarker = document.createComment("forma-list-end"), fragment3 = document.createDocumentFragment();
    fragment3.appendChild(startMarker), fragment3.appendChild(endMarker);
    let ns = getNamespace(), cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [], updateOnItemChange = options?.updateOnItemChange ?? "none", renderOwned = (item, getIndex) => {
      let dispose, failure, failed = false, element = createRoot((stop) => {
        dispose = stop;
        try {
          return untrack(() => withNamespace(ns, () => renderFn(item, getIndex)));
        } catch (error) {
          failed = true, failure = error;
          return;
        }
      });
      if (failed)
        throw dispose(), failure;
      return { element, dispose };
    };
    return internalEffect(() => {
      let newItems = items(), parent2 = startMarker.parentNode;
      if (!parent2)
        return;
      let into = insertNs(parent2);
      if (into !== void 0 && (ns = into), !Array.isArray(newItems)) {
        for (let node of currentNodes)
          node.parentNode === parent2 && (deactivateIslandsIn(node), parent2.removeChild(node));
        for (let cached of cache2.values()) cached.dispose();
        cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [];
        return;
      }
      let cleanItems = newItems;
      for (let i = 0; i < newItems.length; i++)
        if (newItems[i] == null) {
          cleanItems = newItems.filter((item) => item != null);
          break;
        }
      let updateRow = updateOnItemChange === "rerender" ? (_node, item) => {
        let key = keyFn(item), cached = cache2.get(key);
        if (!cached || cached.item === item) return;
        let next = renderOwned(item, cached.getIndex);
        return cached.dispose(), cached.item = item, cached.element = next.element, cached.dispose = next.dispose, next.element;
      } : (_node, item) => {
        let key = keyFn(item), cached = cache2.get(key);
        cached && (cached.item = item);
      };
      updateRow[REPLACES_ROW] = updateOnItemChange === "rerender";
      let oldCache = cache2, result = reconcileList(
        parent2,
        currentItems,
        cleanItems,
        currentNodes,
        keyFn,
        // createFn: create element + cache entry.
        // Each item is rendered inside createRoot + untrack so that inner
        // effects are owned by the item's root (not the parent), and are
        // disposed when the item is removed from the list.
        (item) => {
          let key = keyFn(item), [getIndex, setIndex] = createSignal(0), rendered = renderOwned(item, getIndex);
          return cache2.set(key, { ...rendered, item, getIndex, setIndex }), rendered.element;
        },
        updateRow,
        // beforeNode: insert items before the end marker
        endMarker
      ), newCache = /* @__PURE__ */ new Map();
      for (let i = 0; i < cleanItems.length; i++) {
        let key = keyFn(cleanItems[i]), cached = oldCache.get(key);
        cached && (cached.setIndex(i), newCache.set(key, cached));
      }
      for (let [key, cached] of oldCache)
        newCache.has(key) || cached.dispose();
      cache2 = newCache, currentNodes = result.nodes, currentItems = result.items;
    }), registerDisposer(() => {
      for (let cached of cache2.values())
        deactivateIslandsIn(cached.element), cached.dispose();
      cache2 = /* @__PURE__ */ new Map(), currentNodes = [], currentItems = [];
    }), fragment3;
  }
  function createShow(when, thenFn, elseFn = () => null) {
    if (describingAdoption)
      return { type: "show", condition: when, whenTrue: thenFn, whenFalse: elseFn };
    let startMarker = document.createComment("forma-show"), endMarker = document.createComment("/forma-show"), fragment3 = document.createDocumentFragment();
    fragment3.appendChild(startMarker), fragment3.appendChild(endMarker);
    let currentNode = null, lastTruthy = null, currentDispose = null, ns = getNamespace(), showDispose = internalEffect(() => {
      let truthy = !!when();
      if (truthy === lastTruthy) return;
      lastTruthy = truthy;
      let parent2 = startMarker.parentNode;
      if (!parent2) return;
      let into = insertNs(parent2);
      if (into !== void 0 && (ns = into), currentDispose && (currentDispose(), currentDispose = null), currentNode)
        if (currentNode.parentNode === parent2)
          parent2.removeChild(currentNode);
        else
          for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            parent2.removeChild(startMarker.nextSibling);
      let branchFn = truthy ? thenFn : elseFn;
      if (branchFn) {
        let branchDispose;
        currentNode = createRoot((dispose) => (branchDispose = dispose, untrack(() => withNamespace(ns, branchFn)))), currentDispose = branchDispose;
      } else
        currentNode = null;
      currentNode && parent2.insertBefore(currentNode, endMarker);
    });
    return registerDisposer(() => {
      currentDispose && (currentDispose(), currentDispose = null), currentNode = null;
    }), fragment3.__showDispose = () => {
      showDispose(), currentDispose && (currentDispose(), currentDispose = null);
    }, fragment3;
  }
  function createSwitch(value2, cases, fallback) {
    let startMarker = document.createComment("forma-switch"), endMarker = document.createComment("/forma-switch"), fragment3 = document.createDocumentFragment();
    fragment3.appendChild(startMarker), fragment3.appendChild(endMarker);
    let cache2 = /* @__PURE__ */ new Map(), currentNode = null, currentMatch = UNSET, ns = getNamespace(), switchDispose = internalEffect(() => {
      let val = value2();
      if (val === currentMatch) return;
      currentMatch = val;
      let parent2 = startMarker.parentNode;
      if (!parent2) return;
      let into = insertNs(parent2);
      if (into !== void 0 && (ns = into), currentNode)
        if (currentNode.parentNode === parent2)
          parent2.removeChild(currentNode);
        else if (currentNode.nodeType === 11)
          for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            currentNode.appendChild(startMarker.nextSibling);
        else
          for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
            parent2.removeChild(startMarker.nextSibling);
      let matchedCase = cases.find((c) => c.match === val);
      if (matchedCase) {
        let entry = cache2.get(val);
        if (!entry) {
          let branchDispose;
          entry = { node: createRoot((dispose) => (branchDispose = dispose, untrack(() => withNamespace(ns, matchedCase.render)))), dispose: branchDispose }, cache2.set(val, entry);
        }
        currentNode = entry.node;
      } else
        currentNode = fallback ? withNamespace(ns, fallback) : null;
      currentNode && parent2.insertBefore(currentNode, endMarker);
    });
    return registerDisposer(() => {
      for (let entry of cache2.values())
        entry.dispose();
      cache2.clear(), currentNode = null;
    }), fragment3.__switchDispose = () => {
      switchDispose();
      for (let entry of cache2.values())
        entry.dispose();
      cache2.clear();
    }, fragment3;
  }
  var UNSET = /* @__PURE__ */ Symbol("unset");
  function createPortal(children2, target2) {
    let placeholder = document.createComment("forma-portal"), resolvedTarget = typeof target2 == "string" ? document.querySelector(target2) : target2 ?? document.body;
    if (!resolvedTarget)
      throw new Error(`createPortal: target not found: ${target2}`);
    let mountedNode = null, removeMountedNode = () => {
      mountedNode && mountedNode.parentNode === resolvedTarget && resolvedTarget.removeChild(mountedNode), mountedNode = null;
    }, ns = contentNs(resolvedTarget);
    return createEffect(() => {
      let node = withNamespace(ns, children2);
      return mountedNode = node, resolvedTarget.appendChild(node), () => {
        removeMountedNode();
      };
    }), placeholder;
  }
  function createErrorBoundary(tryFn, catchFn) {
    let startMarker = document.createComment("forma-error-boundary"), endMarker = document.createComment("/forma-error-boundary"), fragment3 = document.createDocumentFragment();
    fragment3.appendChild(startMarker), fragment3.appendChild(endMarker);
    let [retryCount, setRetryCount] = createSignal(0), currentNode = null;
    return internalEffect(() => {
      retryCount();
      let parent2 = startMarker.parentNode;
      if (parent2) {
        currentNode && currentNode.parentNode === parent2 && parent2.removeChild(currentNode);
        try {
          currentNode = tryFn();
        } catch (e) {
          let error = e instanceof Error ? e : new Error(String(e));
          currentNode = catchFn(error, () => setRetryCount((c) => c + 1));
        }
        currentNode && parent2.insertBefore(currentNode, endMarker);
      }
    }), fragment3;
  }
  function createSuspense(fallback, children2) {
    let startMarker = document.createComment("forma-suspense"), endMarker = document.createComment("/forma-suspense"), fragment3 = document.createDocumentFragment();
    fragment3.appendChild(startMarker), fragment3.appendChild(endMarker);
    let [pending, setPending] = createSignal(0), currentNode = null, resolvedNode = null, fallbackNode = null;
    pushSuspenseContext({
      increment() {
        setPending((p) => p + 1);
      },
      decrement() {
        setPending((p) => Math.max(0, p - 1));
      }
    });
    try {
      resolvedNode = children2();
    } finally {
      popSuspenseContext();
    }
    return internalEffect(() => {
      let parent2 = startMarker.parentNode;
      if (!parent2) return;
      let newNode = pending() > 0 ? fallbackNode ??= fallback() : resolvedNode;
      if (newNode !== currentNode) {
        if (currentNode) {
          if (currentNode.parentNode === parent2)
            parent2.removeChild(currentNode);
          else if (currentNode.nodeType === 11)
            for (; startMarker.nextSibling && startMarker.nextSibling !== endMarker; )
              currentNode.appendChild(startMarker.nextSibling);
        }
        newNode && parent2.insertBefore(newNode, endMarker), currentNode = newNode;
      }
    }), fragment3;
  }
  var cache = /* @__PURE__ */ new Map();
  function template(html) {
    let sink = rawHtml(html, "template"), markup = String(sink), node = cache.get(markup);
    if (!node) {
      let tpl = document.createElement("template");
      tpl.innerHTML = sink, node = tpl.content.firstChild, cache.set(markup, node);
    }
    return node;
  }
  function templateMany(html) {
    let sink = rawHtml(html, "template"), markup = String(sink), node = cache.get(markup);
    if (!node) {
      let tpl = document.createElement("template");
      tpl.innerHTML = sink, node = tpl.content, cache.set(markup, node);
    }
    return node.cloneNode(true);
  }
  function hydrateIsland(component, target2) {
    let plan;
    try {
      plan = prepareAdoption(target2, component, {
        target: "public",
        failure: (error) => reportHydrateError(error),
        scope: (options) => {
          let owner = new AdoptionLifecycle(options);
          return registerDisposer(() => owner.abort()), owner;
        }
      }), plan.commit();
    } catch (error) {
      if (plan?.dispose(), !isHydrateError(error)) throw error;
      reportHydrateError(error);
    }
    return target2;
  }
  function browserOnly(component) {
    function rendered(first, second) {
      return typeof document > "u" ? null : arguments.length >= 2 && typeof Element < "u" && first instanceof Element ? component(second ?? {}) : component(first);
    }
    return rendered;
  }
  var currentLifecycleContext = null;
  var lifecycleStack = [];
  function pushLifecycleContext(ctx) {
    lifecycleStack.push(currentLifecycleContext), currentLifecycleContext = ctx;
  }
  function popLifecycleContext() {
    currentLifecycleContext = lifecycleStack.pop() ?? null;
  }
  function onMount(fn) {
    if (currentLifecycleContext === null)
      throw new Error("onMount() must be called inside a component setup function");
    currentLifecycleContext.mountCallbacks.push(fn);
  }
  function onUnmount(fn) {
    if (currentLifecycleContext === null)
      throw new Error("onUnmount() must be called inside a component setup function");
    currentLifecycleContext.unmountCallbacks.push(fn);
  }
  function registerContextDisposer(dispose) {
    return currentLifecycleContext !== null ? (currentLifecycleContext.contextDisposers.push(dispose), true) : false;
  }
  var DISPOSE_KEY = /* @__PURE__ */ Symbol("forma:component:dispose");
  function defineComponent(setupOrDef) {
    let setup = typeof setupOrDef == "function" ? setupOrDef : setupOrDef.setup, name = typeof setupOrDef == "function" ? void 0 : setupOrDef.name, where = (phase) => name ? `${name}: ${phase}` : phase;
    return function() {
      let ctx = {
        disposers: [],
        mountCallbacks: [],
        unmountCallbacks: [],
        contextDisposers: []
      };
      pushLifecycleContext(ctx);
      let dom;
      try {
        dom = setup();
      } catch (e) {
        for (let i = ctx.contextDisposers.length - 1; i >= 0; i--)
          try {
            ctx.contextDisposers[i]();
          } catch {
          }
        throw ctx.contextDisposers.length = 0, e;
      } finally {
        popLifecycleContext();
      }
      let disposed = false, dispose = () => {
        if (!disposed) {
          disposed = true;
          for (let cb of ctx.unmountCallbacks)
            try {
              cb();
            } catch (e) {
              reportError(e, where("onUnmount"));
            }
          for (let d of ctx.disposers)
            try {
              d();
            } catch (e) {
              reportError(e, where("component disposer"));
            }
          for (let i = ctx.contextDisposers.length - 1; i >= 0; i--)
            try {
              ctx.contextDisposers[i]();
            } catch (e) {
              reportError(e, where("context disposer"));
            }
          ctx.disposers.length = 0, ctx.mountCallbacks.length = 0, ctx.unmountCallbacks.length = 0, ctx.contextDisposers.length = 0;
        }
      };
      if (dom[DISPOSE_KEY] = dispose, dom.nodeType === 11)
        for (let child2 of Array.from(dom.childNodes))
          child2[DISPOSE_KEY] = dispose;
      pushLifecycleContext(ctx);
      try {
        for (let cb of ctx.mountCallbacks)
          try {
            let cleanup2 = cb();
            typeof cleanup2 == "function" && ctx.unmountCallbacks.push(cleanup2);
          } catch (e) {
            reportError(e, where("onMount"));
          }
      } finally {
        popLifecycleContext();
      }
      return dom;
    };
  }
  function disposeComponent(dom) {
    let disposable = dom;
    typeof disposable[DISPOSE_KEY] == "function" && (disposable[DISPOSE_KEY](), delete disposable[DISPOSE_KEY]);
  }
  function trackDisposer(dispose) {
    currentLifecycleContext !== null && currentLifecycleContext.disposers.push(dispose);
  }
  var contextStacks = /* @__PURE__ */ new Map();
  function removeFrame(id, token) {
    let stack = contextStacks.get(id);
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].token === token) {
          stack.splice(i, 1);
          break;
        }
      stack.length === 0 && contextStacks.delete(id);
    }
  }
  function createContext(defaultValue) {
    return {
      id: /* @__PURE__ */ Symbol("forma:context"),
      defaultValue
    };
  }
  function provide(ctx, value2) {
    let stack = contextStacks.get(ctx.id);
    stack === void 0 && (stack = [], contextStacks.set(ctx.id, stack));
    let token = /* @__PURE__ */ Symbol("forma:context-frame");
    stack.push({ token, value: value2 }), registerContextDisposer(() => removeFrame(ctx.id, token));
  }
  function inject(ctx) {
    let stack = contextStacks.get(ctx.id);
    return stack === void 0 || stack.length === 0 ? ctx.defaultValue : stack[stack.length - 1].value;
  }
  function unprovide(ctx) {
    let stack = contextStacks.get(ctx.id);
    stack !== void 0 && stack.length > 0 && (stack.pop(), stack.length === 0 && contextStacks.delete(ctx.id));
  }
  var RAW = /* @__PURE__ */ Symbol("forma-raw");
  var PROXY = /* @__PURE__ */ Symbol("forma-proxy");
  var ARRAY_MUTATORS = /* @__PURE__ */ new Set([
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin"
  ]);
  var FORBIDDEN_STORE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  function shouldWrap(v) {
    return !(v == null || typeof v != "object" || v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet || v instanceof Error || v instanceof Promise || v[PROXY]);
  }
  function deepClone(obj, seen) {
    if (obj === null || typeof obj != "object" || (seen || (seen = /* @__PURE__ */ new WeakSet()), seen.has(obj))) return obj;
    if (seen.add(obj), Array.isArray(obj)) return obj.map((item) => deepClone(item, seen));
    let out = {};
    for (let key of Object.keys(obj))
      key !== "__proto__" && (out[key] = deepClone(obj[key], seen));
    return out;
  }
  function createStore(initial2) {
    let signals = /* @__PURE__ */ new Map(), children2 = /* @__PURE__ */ new Map(), arrayVersions = /* @__PURE__ */ new Map();
    function getArrayVersion(path) {
      let p = arrayVersions.get(path);
      return p || (p = createSignal(0), arrayVersions.set(path, p)), p;
    }
    function bumpArrayVersion(path) {
      let p = arrayVersions.get(path);
      p && p[1]((n) => n + 1);
    }
    function registerChild(path) {
      let lastDot = path.lastIndexOf(".");
      if (lastDot === -1) return;
      let parentPath = path.substring(0, lastDot), set = children2.get(parentPath);
      set || (set = /* @__PURE__ */ new Set(), children2.set(parentPath, set)), set.add(path);
    }
    function getSignal(path, initialValue) {
      let pair = signals.get(path);
      return pair || (pair = createSignal(initialValue), signals.set(path, pair), registerChild(path)), pair;
    }
    let proxyCache = /* @__PURE__ */ new WeakMap();
    function invalidateChildren(parentPath) {
      let childSet = children2.get(parentPath);
      if (childSet) {
        for (let childPath of childSet)
          invalidateChildren(childPath), signals.delete(childPath), children2.delete(childPath);
        childSet.clear();
      }
    }
    function lastSegment(path) {
      let d = path.lastIndexOf(".");
      return d === -1 ? path : path.substring(d + 1);
    }
    function setLiteral(pair, v) {
      pair[1](typeof v == "function" ? value(v) : v);
    }
    function reconcileChildren(parentPath, rawParent) {
      let set = children2.get(parentPath);
      if (set)
        for (let childPath of set) {
          let key = lastSegment(childPath), nv = rawParent[key], pair = signals.get(childPath);
          pair && setLiteral(pair, nv), nv != null && typeof nv == "object" ? reconcileChildren(childPath, nv) : invalidateChildren(childPath);
        }
    }
    function wrap(raw, basePath) {
      if (!shouldWrap(raw)) return raw;
      let byPath = proxyCache.get(raw);
      if (byPath) {
        let hit = byPath.get(basePath);
        if (hit) return hit;
      }
      let isArr = Array.isArray(raw), basePrefix = basePath ? basePath + "." : "", proxy = new Proxy(raw, {
        // -------------------------------------------------------------------
        // GET
        // -------------------------------------------------------------------
        get(target2, prop, receiver) {
          if (prop === RAW) return target2;
          if (prop === PROXY) return true;
          if (typeof prop == "symbol")
            return Reflect.get(target2, prop, receiver);
          let key = String(prop), childPath = basePrefix + key;
          if (isArr && ARRAY_MUTATORS.has(key))
            return (...args) => {
              let result;
              return batch(() => {
                let rawArgs = args.map(
                  (a) => a != null && typeof a == "object" && a[RAW] ? a[RAW] : a
                );
                result = target2[key].apply(target2, rawArgs), reconcileChildren(basePath, target2);
                let lenPair = signals.get(basePrefix + "length");
                lenPair && lenPair[1](target2.length), basePath && bumpArrayVersion(basePath);
              }), result;
            };
          if (isArr && key === "length") {
            let [getter] = getSignal(childPath, target2.length);
            return getter(), target2.length;
          }
          let value2 = Reflect.get(target2, prop);
          return getSignal(childPath, value2)[0](), Array.isArray(value2) && getArrayVersion(childPath)[0](), shouldWrap(value2) ? wrap(value2, childPath) : value2;
        },
        // -------------------------------------------------------------------
        // SET
        // -------------------------------------------------------------------
        set(target2, prop, value2) {
          if (typeof prop == "symbol")
            return Reflect.set(target2, prop, value2);
          let key = String(prop);
          if (FORBIDDEN_STORE_KEYS.has(key))
            return true;
          let childPath = basePrefix + key, rawValue = value2 != null && typeof value2 == "object" && value2[RAW] ? value2[RAW] : value2, oldRaw = Reflect.get(target2, prop);
          if (Reflect.set(target2, prop, rawValue), rawValue != null && typeof rawValue == "object" && oldRaw !== rawValue && (invalidateChildren(childPath), evictProxy(oldRaw, childPath)), isArr && key !== "length") {
            let lengthPath = basePrefix + "length", lenPair = signals.get(lengthPath);
            lenPair && lenPair[1](target2.length);
          }
          isArr && key === "length" && batch(() => {
            reconcileChildren(basePath, target2), basePath && bumpArrayVersion(basePath);
          });
          let [, setter2] = getSignal(childPath, rawValue);
          return setter2(rawValue), true;
        },
        // -------------------------------------------------------------------
        // HAS — track membership checks
        // -------------------------------------------------------------------
        has(target2, prop) {
          if (typeof prop == "symbol")
            return Reflect.has(target2, prop);
          let key = String(prop), childPath = basePrefix + key, [getter] = getSignal(childPath, Reflect.get(target2, prop));
          return getter(), Reflect.has(target2, prop);
        },
        // -------------------------------------------------------------------
        // OWNKEYS — return keys from the raw target
        // -------------------------------------------------------------------
        ownKeys(target2) {
          return Reflect.ownKeys(target2);
        },
        // -------------------------------------------------------------------
        // GETOWNPROPERTYDESCRIPTOR — needed for Object.keys / spread / ...
        // -------------------------------------------------------------------
        getOwnPropertyDescriptor(target2, prop) {
          return Object.getOwnPropertyDescriptor(target2, prop);
        },
        // -------------------------------------------------------------------
        // DELETEPROPERTY — clean up signals when a key is removed
        // -------------------------------------------------------------------
        deleteProperty(target2, prop) {
          if (typeof prop == "symbol")
            return Reflect.deleteProperty(target2, prop);
          let key = String(prop), childPath = basePrefix + key, oldRaw = Reflect.get(target2, prop), result = Reflect.deleteProperty(target2, prop), delPair = signals.get(childPath);
          return delPair && delPair[1](void 0), evictProxy(oldRaw, childPath), invalidateChildren(childPath), result;
        }
      });
      return byPath || (byPath = /* @__PURE__ */ new Map(), proxyCache.set(raw, byPath)), byPath.set(basePath, proxy), proxy;
    }
    function evictProxy(oldRaw, path) {
      if (oldRaw == null || typeof oldRaw != "object") return;
      let om = proxyCache.get(oldRaw);
      om && (om.delete(path), om.size === 0 && proxyCache.delete(oldRaw));
    }
    let rootProxy = wrap(initial2, "");
    function getCurrentSnapshot() {
      return untrack(() => deepClone(initial2));
    }
    return [rootProxy, (partial) => {
      let updates = typeof partial == "function" ? partial(getCurrentSnapshot()) : partial;
      batch(() => {
        for (let key of Object.keys(updates))
          FORBIDDEN_STORE_KEYS.has(key) || (rootProxy[key] = updates[key]);
      });
    }];
  }
  function cloneEntry(v, seen) {
    if (v === null || typeof v != "object") return v;
    let proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null || (seen || (seen = /* @__PURE__ */ new WeakSet()), seen.has(v))) return v;
    if (seen.add(v), Array.isArray(v)) return v.map((i) => cloneEntry(i, seen));
    let out = {};
    for (let k of Object.keys(v))
      out[k] = cloneEntry(v[k], seen);
    return out;
  }
  function createHistory(source, options) {
    let [sourceGet, sourceSet] = source, maxLength = Math.max(1, options?.maxLength ?? 100), _stack = [cloneEntry(sourceGet())], _cursor = 0, [stackSignal, setStackSignal] = createSignal([..._stack]), [cursorSignal, setCursorSignal] = createSignal(_cursor), [stackLenSignal, setStackLenSignal] = createSignal(_stack.length);
    function syncSignals() {
      batch(() => {
        setStackSignal([..._stack]), setCursorSignal(_cursor), setStackLenSignal(_stack.length);
      });
    }
    let NONE = /* @__PURE__ */ Symbol("none"), _expected = NONE, isFirstRun = true, disposeEffect = internalEffect(() => {
      let value2 = sourceGet();
      if (isFirstRun) {
        isFirstRun = false;
        return;
      }
      if (_expected !== NONE && Object.is(value2, _expected)) {
        _expected = NONE;
        return;
      }
      _expected = NONE, _stack = _stack.slice(0, _cursor + 1), _stack.push(cloneEntry(value2)), _stack.length > maxLength && _stack.splice(0, _stack.length - maxLength), _cursor = _stack.length - 1, syncSignals();
    });
    return {
      undo: () => {
        if (_cursor <= 0) return;
        _cursor--;
        let restored = cloneEntry(_stack[_cursor]);
        _expected = restored, sourceSet(restored), syncSignals();
      },
      redo: () => {
        if (_cursor >= _stack.length - 1) return;
        _cursor++;
        let restored = cloneEntry(_stack[_cursor]);
        _expected = restored, sourceSet(restored), syncSignals();
      },
      canUndo: () => cursorSignal() > 0,
      canRedo: () => cursorSignal() < stackLenSignal() - 1,
      history: () => stackSignal(),
      cursor: () => cursorSignal(),
      clear: () => {
        let currentValue = sourceGet();
        _stack = [cloneEntry(currentValue)], _cursor = 0, syncSignals();
      },
      destroy: () => {
        disposeEffect();
      }
    };
  }
  var ENVELOPE_TAG = "$forma:v";
  function persist(source, key, options) {
    let [sourceGet, sourceSet] = source, storage = options?.storage ?? globalThis.localStorage, serialize = options?.serialize ?? JSON.stringify, deserialize = options?.deserialize ?? JSON.parse, validate = options?.validate, version = options?.version, migrate = options?.migrate, onError2 = options?.onError, writing = false;
    function unwrap(stored) {
      let parsed = deserialize(stored);
      if (parsed != null && typeof parsed == "object" && Object.prototype.hasOwnProperty.call(parsed, ENVELOPE_TAG)) {
        let env = parsed;
        return { value: env.value, version: Number(env[ENVELOPE_TAG]) };
      }
      return { value: parsed, version: 0 };
    }
    function hydrate() {
      let stored;
      try {
        stored = storage.getItem(key);
      } catch (err) {
        onError2?.(err, "hydrate");
        return;
      }
      if (stored !== null)
        try {
          let { value: raw, version: storedVersion } = unwrap(stored), value2 = raw;
          if (version !== void 0 && storedVersion < version) {
            if (!migrate) return;
            try {
              value2 = migrate(raw, storedVersion);
            } catch (err) {
              onError2?.(err, "migrate");
              return;
            }
          }
          if (!validate || validate(value2)) {
            writing = true;
            try {
              sourceSet(value2);
            } finally {
              writing = false;
            }
          }
        } catch (err) {
          onError2?.(err, "hydrate");
        }
    }
    hydrate();
    let stopEffect = internalEffect(() => {
      let value2 = sourceGet();
      if (!writing)
        try {
          let serialized = serialize(version !== void 0 ? { [ENVELOPE_TAG]: version, value: value2 } : value2);
          storage.setItem(key, serialized);
        } catch (err) {
          onError2?.(err, err?.name === "QuotaExceededError" ? "write" : "serialize");
        }
    }), enableSync = options?.syncTabs ?? (typeof window < "u" && storage === globalThis.localStorage), onStorage;
    return enableSync && typeof window < "u" && (onStorage = (e) => {
      e.storageArea === storage && (e.key !== null && e.key !== key || hydrate());
    }, window.addEventListener("storage", onStorage)), () => {
      stopEffect(), onStorage && typeof window < "u" && window.removeEventListener("storage", onStorage);
    };
  }
  function createBus() {
    let listeners = /* @__PURE__ */ new Map();
    function getHandlers(event) {
      let set = listeners.get(event);
      return set || (set = /* @__PURE__ */ new Set(), listeners.set(event, set)), set;
    }
    function on2(event, handler) {
      let set = getHandlers(event);
      return set.add(handler), () => {
        set.delete(handler);
      };
    }
    function once(event, handler) {
      let wrapper = (payload) => {
        off(event, wrapper), handler(payload);
      };
      return on2(event, wrapper);
    }
    function emit(event, payload) {
      let set = listeners.get(event);
      if (set)
        for (let handler of [...set])
          try {
            handler(payload);
          } catch (e) {
            console.error(`[forma] Bus handler error on "${String(event)}":`, e);
          }
    }
    function off(event, handler) {
      let set = listeners.get(event);
      set && set.delete(handler);
    }
    function clear() {
      listeners.clear();
    }
    return { on: on2, once, emit, off, clear };
  }
  function delegate(container, selector, event, handler, options) {
    let listener = (e) => {
      let target2 = e.target;
      if (!(target2 instanceof HTMLElement)) return;
      let root = container instanceof Document ? container.documentElement : container, matched = target2.closest(selector);
      matched instanceof HTMLElement && root.contains(matched) && handler(e, matched);
    };
    return container.addEventListener(event, listener, options), () => {
      container.removeEventListener(event, listener, options);
    };
  }
  function parseCombo(combo) {
    let parts = combo.toLowerCase().split("+").map((p) => p.trim()), modifiers = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: ""
    };
    for (let part of parts)
      switch (part) {
        case "ctrl":
        case "control":
          modifiers.ctrl = true;
          break;
        case "shift":
          modifiers.shift = true;
          break;
        case "alt":
          modifiers.alt = true;
          break;
        case "meta":
        case "cmd":
        case "command":
          modifiers.meta = true;
          break;
        default:
          modifiers.key = part;
      }
    return modifiers;
  }
  function matchesCombo(e, parsed) {
    return e.ctrlKey !== parsed.ctrl || e.shiftKey !== parsed.shift || e.altKey !== parsed.alt || e.metaKey !== parsed.meta ? false : e.key.toLowerCase() === parsed.key;
  }
  function onKey(combo, handler, options) {
    let target2 = options?.target ?? document, shouldPreventDefault = options?.preventDefault ?? true, parsed = parseCombo(combo), listener = (e) => {
      e instanceof KeyboardEvent && matchesCombo(e, parsed) && (shouldPreventDefault && e.preventDefault(), handler(e));
    };
    return target2.addEventListener("keydown", listener), () => {
      target2.removeEventListener("keydown", listener);
    };
  }
  function $(selector, parent2) {
    return (parent2 ?? document).querySelector(selector);
  }
  function $$(selector, parent2) {
    return Array.from((parent2 ?? document).querySelectorAll(selector));
  }
  function addClass(el, ...classes) {
    el.classList.add(...classes);
  }
  function removeClass(el, ...classes) {
    el.classList.remove(...classes);
  }
  function toggleClass(el, className, force) {
    return el.classList.toggle(className, force);
  }
  function setStyle(el, styles) {
    for (let [key, value2] of Object.entries(styles))
      value2 !== void 0 && (el.style[key] = value2);
  }
  function setAttr(el, attrs) {
    for (let [name, value2] of Object.entries(attrs))
      value2 === false || value2 === null ? el.removeAttribute(name) : value2 === true ? (checkRawAttr(name, value2), el.setAttribute(name, "")) : (checkRawAttr(name, value2), el.setAttribute(name, isTrustedHtml(value2) ? htmlOf(value2) : value2));
  }
  function setText(el, text3) {
    el.textContent = text3;
  }
  function setHTMLUnsafe(el, html) {
    el.innerHTML = rawHtml(html, "setHTMLUnsafe");
  }
  function closest(el, selector) {
    return el.closest(selector);
  }
  function children(el, selector) {
    let all = Array.from(el.children);
    return selector ? all.filter((child2) => child2.matches(selector)) : all;
  }
  function siblings(el, selector) {
    let parentEl = el.parentElement;
    if (!parentEl) return [];
    let sibs = Array.from(parentEl.children).filter((child2) => child2 !== el);
    return selector ? sibs.filter((child2) => child2.matches(selector)) : sibs;
  }
  function parent(el) {
    return el.parentElement;
  }
  function nextSibling(el, selector) {
    let sib = el.nextElementSibling;
    for (; sib; ) {
      if (sib instanceof HTMLElement && (!selector || sib.matches(selector)))
        return sib;
      sib = sib.nextElementSibling;
    }
    return null;
  }
  function prevSibling(el, selector) {
    let sib = el.previousElementSibling;
    for (; sib; ) {
      if (sib instanceof HTMLElement && (!selector || sib.matches(selector)))
        return sib;
      sib = sib.previousElementSibling;
    }
    return null;
  }
  function onResize(el, handler) {
    let observer = new ResizeObserver((entries) => {
      for (let entry of entries)
        handler(entry);
    });
    return observer.observe(el), () => {
      observer.disconnect();
    };
  }
  function onIntersect(el, handler, options) {
    let observer = new IntersectionObserver((entries) => {
      for (let entry of entries)
        handler(entry);
    }, options);
    return observer.observe(el), () => {
      observer.disconnect();
    };
  }
  function onMutation(el, handler, options) {
    let observer = new MutationObserver((mutations) => {
      handler(mutations);
    });
    return observer.observe(el, options ?? { childList: true, subtree: true }), () => {
      observer.disconnect();
    };
  }
  return __toCommonJS(forma_esm_exports);
})();
