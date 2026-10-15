/** Private fresh ranges for postcommit descriptor materialization. They share
 * row reconciliation with retained SSR spans and never grant adoption claims. */
import { AdoptionDomError } from './adoption-plan.js';
import { liveList, listItems } from './adoption-live-list.js';
import { internalEffect } from '../reactive/effect.js';
import { untrack } from '../reactive/untrack.js';
import { registerDisposer } from '../reactive/root.js';
import { withAdoptionDescription } from './adoption-description.js';
import type { ListDescriptor } from './adoption-description.js';
import type { AdoptionLifecycle, PreparedGroup } from '../reactive/adoption-lifecycle.js';
function refuse():never {throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');}
export function liveRanges(scope:AdoptionLifecycle,document:Document,removeChildren:(element:HTMLElement)=>void){
  const range=()=>{
    const fragment=document.createDocumentFragment(),start=document.createComment(''),end=document.createComment('');
    fragment.append(start,end);return {fragment,start,end};
  };
  function dynamic(read:()=>unknown,materialize:(value:unknown)=>Node|null,truthiness=false):DocumentFragment {
      const {fragment,start,end}=range(),owner=scope.group(()=>undefined);
      let active:PreparedGroup<Node|null>|undefined,shown:boolean|undefined;
      owner.run(()=>{
        registerDisposer(()=>{active=undefined;});
        internalEffect(()=>{
          const parent=start.parentNode;if(!parent||end.parentNode!==parent)refuse();
          const contents=()=>{const nodes:Node[]=[];for(let node=start.nextSibling;node!==end;node=node?.nextSibling??null){if(!node)refuse();nodes.push(node);}return nodes;};
          const before=contents();
          const check=()=>{
            if(scope.phase!=='live'||!owner.alive||start.parentNode!==parent||end.parentNode!==parent)refuse();
            const now=contents();if(now.length!==before.length||now.some((node,index)=>node!==before[index]))refuse();
          };
          let nextShown:boolean|undefined;
          if(truthiness){nextShown=Boolean(read());if(active&&shown===nextShown){check();return;}}
          // The selected expression can construct owned work while it is
          // described. Keep that read and its conversion in the candidate,
          // rather than the outer observer's automatically retired generation.
          const next=truthiness
            ?owner.child(()=>untrack(()=>materialize(nextShown!)))
            :owner.trackedChild(()=>materialize(read()));
          if(next.value?.parentNode)refuse();check();
          active?.dispose();check();
          for(const node of before)if(node.nodeType===1){removeChildren(node as HTMLElement);check();}
          // All user callback boundaries completed before the first mutation.
          for(const node of before)parent.removeChild(node);
          if(next.value)parent.insertBefore(next.value,end);
          active=next;shown=nextShown;
        });
      });
      return fragment;
  }
  return {
    /** Keep a real-element reader's ownership outside its ordinary writer's
     * automatically retired generation. The shared writer retains Text nodes
     * and textarea/property semantics after this checked read returns. */
    reader<T>(target:Element|DocumentFragment,read:()=>T):()=>T {
      const owner=scope.group(()=>undefined);let active:PreparedGroup<T>|undefined;
      owner.run(()=>registerDisposer(()=>{active=undefined;}));
      return ()=>{
        const parent=target.parentNode,previous=target.previousSibling,following=target.nextSibling,nodes=[...target.childNodes];
        const check=()=>{
          if(scope.phase!=='live'||!owner.alive||target.parentNode!==parent||target.previousSibling!==previous||target.nextSibling!==following)refuse();
          const current=target.childNodes;if(current.length!==nodes.length||nodes.some((node,index)=>node!==current[index]))refuse();
        };
        const next=owner.trackedChild(read);check();
        active?.dispose();check();active=next;return next.value;
      };
    },
    list(desc:ListDescriptor,_namespace:string|null,render:(item:unknown,index:()=>number)=>Node|null):DocumentFragment {
      const {fragment,start,end}=range(),owner=scope.group(()=>undefined);
      owner.run(()=>{
        const keyOwner=owner.child(()=>({items:[],keys:[]}));
        const coordinator=liveList({range:{start,end},owner,live:()=>scope.phase==='live'&&owner.alive,
          keys:values=>withAdoptionDescription(()=>listItems(values,desc.keyFn),false),render,
          rerender:desc.options?.updateOnItemChange==='rerender',removeChildren,
        },{cache:new Map(),ordered:[],tail:[],keyOwner});
        registerDisposer(coordinator.clear);
        internalEffect(()=>coordinator.update(desc.items()));
      });
      return fragment;
    },
    dynamic:(read:()=>unknown,materialize:(value:unknown)=>Node|null)=>dynamic(read,materialize),
    show:(condition:()=>unknown,materialize:(shown:boolean)=>Node|null)=>dynamic(condition,value=>materialize(value as boolean),true),
  };
}
