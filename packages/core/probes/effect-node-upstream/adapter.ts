export * from 'alien-signals';
import { startEffectNode, stopEffectNode, type EffectNode } from '../../src/reactive/effect-node.js';
export function effect(fn: () => void): () => void {
  const node: EffectNode = {fn, subs: undefined, subsTail: undefined, deps: undefined, depsTail: undefined, flags: 2 | 4};
  startEffectNode(node);
  return () => stopEffectNode(node);
}
