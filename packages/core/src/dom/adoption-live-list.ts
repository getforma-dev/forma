/** Shared private live list reconciler. Initial adoption supplies retained
 * spans; fresh materialization supplies an empty, newly allocated range. */
import { AdoptionDomError } from './adoption-plan.js';
import { AdoptionRow, materializeRows } from './adoption-row.js';
import { canonicalKeyText } from './key-text.js';
import { longestIncreasingSubsequence } from './list.js';
import { createSignal } from '../reactive/signal.js';
import { untrack } from '../reactive/untrack.js';
import type { PreparedGroup } from '../reactive/adoption-lifecycle.js';
/** A row's canonical key text (FORMA-181): the cache identity, so a
 * type-only change such as 1 to "1" keeps the same row. */
export type ListKey=string;
export type ListItems={items:unknown[];keys:ListKey[]};
export type LiveListRow={owner:PreparedGroup<unknown>;span:AdoptionRow;item:unknown;setIndex:(value:number)=>void};
export interface LiveListState {
  cache:Map<ListKey,LiveListRow>;ordered:LiveListRow[];tail:Node[];keyOwner:PreparedGroup<ListItems>;
}
export interface LiveListOptions {
  range:{start:Comment;end:Comment};owner:PreparedGroup<unknown>;live:()=>boolean;
  keys:(values:unknown)=>ListItems;render:(item:unknown,index:()=>number)=>Node|null;
  rerender:boolean;removeChildren:(element:HTMLElement)=>void;
}
function refuse():never {throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');}
/** Items and their canonical keys (`canonicalKeyText`, the walker's
 * `data-forma-key` text). A key outside the domain or a repeated canonical
 * key refuses FORMA_E_HYDRATE_KEY. */
export function listItems(values:unknown,keyFn:(item:unknown)=>unknown):ListItems {
  if(!Array.isArray(values))refuse();
  const keys:ListKey[]=[],seen=new Set<ListKey>();
  for(let i=0;i<values.length;i++){
    if(!Object.hasOwn(values,i))refuse();
    // The key function's own exception propagates as it is; only its
    // value is judged against the key domain.
    const key=canonicalKeyText(untrack(()=>keyFn(values[i])));
    if(key===undefined||seen.has(key))throw new AdoptionDomError('FORMA_E_HYDRATE_KEY');
    seen.add(key);keys.push(key);
  }
  return {items:values.slice(),keys};
}
export function liveList(options:LiveListOptions,initial:LiveListState):{update:(value:unknown)=>void;clear:()=>void} {
  const {range,owner,live,keys,render,rerender,removeChildren}=options;
  let {cache,ordered,tail,keyOwner}=initial;
  function contents():Node[]{
    const nodes:Node[]=[];for(let node=range.start.nextSibling;node!==range.end;node=node?.nextSibling??null){if(!node)refuse();nodes.push(node);}return nodes;
  }
  return {update(value){
    const parent=range.start.parentNode;
    if(!parent||range.end.parentNode!==parent)refuse();
    const before=contents(),covered:Node[]=[];
    for(const row of ordered)for(const node of row.span.nodes())if(covered[covered.length-1]!==node)covered.push(node);
    covered.push(...tail);
    if(covered.length!==before.length||covered.some((node,i)=>node!==before[i]))refuse();
    const check=()=>{
      if(!live()||range.start.parentNode!==parent||range.end.parentNode!==parent)refuse();
    };
    const unchanged=()=>{check();const now=contents();if(now.length!==before.length||now.some((node,i)=>node!==before[i]))refuse();};
    const nextOwner=owner.child(()=>keys(value));
    const next=nextOwner.value,planned=new Map<ListKey,LiveListRow>(),rows:LiveListRow[]=[];unchanged();
    // Execute all row factories before the first move. Each candidate is
    // already owned, so a later factory failure also disposes prior ones.
    for(let i=0;i<next.items.length;i++){
      const item=next.items[i],key=next.keys[i]!,prior=cache.get(key);
      let row=prior;
      if(!row||(rerender&&row.item!==item)){
        let setIndex!:(value:number)=>void;
        const child=owner.child(()=>untrack(()=>{
          const [getIndex,set]=createSignal(i);setIndex=set;
          const node=render(item,getIndex);
          if(node&&node.parentNode)refuse();return node;
        }));
        row={owner:child,span:AdoptionRow.fresh(child.value),item,setIndex};
      }
      planned.set(key,row);rows.push(row);unchanged();
    }
    const retained=new Set(rows),leaving=ordered.filter(row=>!retained.has(row));
    keyOwner.dispose();unchanged();keyOwner=nextOwner;
    // Disposal and nested-island teardown are user callback boundaries.
    // Complete and recheck them before any framework list mutation.
    for(const row of leaving){
      row.owner.dispose();unchanged();
      for(const node of row.span.nodes())if(node.nodeType===1){
        const element=node as HTMLElement;
        removeChildren(element);unchanged();
      }
    }
    unchanged();
    const changed=rows.length!==ordered.length||rows.some((row,i)=>row!==ordered[i]);
    if(changed){
      materializeRows(ordered.map(row=>row.span),check);
      const oldIndex=new Map(ordered.map((row,i)=>[row,i]));
      const reused:number[]=[],positions:number[]=[];
      rows.forEach((row,i)=>{const index=oldIndex.get(row);if(index!==undefined&&row.span.first){reused.push(index);positions.push(i);}});
      const stationary=new Set(longestIncreasingSubsequence(reused).map(index=>positions[index]!));
      for(const row of leaving)for(const node of row.span.nodes()){check();parent.removeChild(node);}
      let anchor:Node=tail[0]??range.end;
      for(let i=rows.length-1;i>=0;i--){
        check();const row=rows[i]!,nodes=row.span.nodes();
        if(!stationary.has(i))for(const node of nodes){check();parent.insertBefore(node,anchor);}
        if(row.span.first)anchor=row.span.first;
      }
    }
    check();cache=planned;ordered=rows;
    for(let i=0;i<rows.length;i++){check();rows[i]!.setIndex(i);}
  },clear(){cache.clear();ordered=[];tail=[];}};
}
