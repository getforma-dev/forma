/**
 * Supplied effect nodes on the shared alien-signals 3.1.2 graph.
 *
 * The initialization and teardown glue mirrors src/index.ts at upstream
 * 836130c4837f8184ae0079e6d550b0adba07b936 (v3.1.2). Graph algorithms stay in
 * the installed package. An upgrade must requalify these explicit invariants.
 * MIT: Copyright (c) 2024-present Johnson Chu; see licenses/alien-signals.txt.
 */
import { setActiveSub } from 'alien-signals';
import { createReactiveSystem, type ReactiveNode } from 'alien-signals/system';

export interface EffectNode extends ReactiveNode { fn(): void; }

const enum Flag { Mutable = 1, Watching = 2, RecursedCheck = 4, Dirty = 16 }

// link/unlink only use the unwatched callback. These traps deliberately refuse
// any accidental use of this local system for scheduling or value updates.
const { link, unlink } = createReactiveSystem({
  update() { throw new Error('Effect node adapter cannot update values'); },
  notify() { throw new Error('Effect node adapter cannot schedule effects'); },
  unwatched(node) {
    if (!(node.flags & Flag.Mutable)) stopEffectNode(node);
    else if (node.depsTail !== undefined) {
      node.depsTail = undefined;
      node.flags = Flag.Mutable | Flag.Dirty;
      purgeDeps(node);
    }
  },
});

function purgeDeps(node: ReactiveNode): void {
  const tail = node.depsTail;
  let dep = tail !== undefined ? tail.nextDep : node.deps;
  while (dep !== undefined) dep = unlink(dep, node);
}

/** Initialize an already allocated node; fn runs on the original engine graph. */
export function startEffectNode(node: EffectNode): void {
  const previous = setActiveSub(node);
  if (previous !== undefined) link(node, previous, 0);
  try { node.fn(); } finally {
    setActiveSub(previous);
    node.flags &= ~Flag.RecursedCheck;
  }
}

/** Graph teardown only. The owning Forma effect drains user cleanup separately. */
export function stopEffectNode(node: ReactiveNode): void {
  node.depsTail = undefined;
  node.flags = 0;
  purgeDeps(node);
  const sub = node.subs;
  if (sub !== undefined) unlink(sub);
}
