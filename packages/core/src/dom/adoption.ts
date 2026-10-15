/** Private descriptor walker. Activation is switched only after its remaining
 * control-flow/control/raw-HTML checkpoints and compiled product review. */
import { AdoptionDom, AdoptionDomError, type AdoptionCursor } from './adoption-plan.js';
import { withAdoptionDescription, type ComponentDescription } from './adoption-description.js';
import { registerDisposer } from '../reactive/root.js';
import { untrack } from '../reactive/untrack.js';
import { createSignal } from '../reactive/signal.js';
import { longestIncreasingSubsequence } from './list.js';
import { deactivateIsland, deactivateAllIslands } from './activate.js';
import { AdoptionLifecycle, type PreparationOptions, type PreparedGroup } from '../reactive/adoption-lifecycle.js';
import { contentNs, SVG_NS, MATHML_NS, withNamespace } from './namespace.js';
import { isEventHandlerAttr } from '../security/url-safety.js';
import { prepareAttribute } from './adoption-attributes.js';
import { isFormControlProperty } from './form-control.js';
import type { HydrationDescriptor, FragmentDescriptor, ShowDescriptor, ListDescriptor } from './hydrate.js';

interface Listener { element:Element; event:string; listener:EventListener; controller?:AbortController }
export interface PreparedAdoption {
  readonly phase: AdoptionLifecycle['phase'];
  commit(): void;
  dispose(): void;
}
export interface AdoptionOptions {
  /** Source-private compiled caller supplies the real 103 scope; the default
   * direct-API kernel has no capture/enroll methods or setter authority. */
  scope?: (options:PreparationOptions)=>AdoptionLifecycle;
  failure?: PreparationOptions['failure'];
}
function refuse():never {throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');}
function text(value:unknown):string {
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
  return refuse();
}
function ownProps(props:Record<string,unknown>):[string,unknown][] {
  return Object.entries(Object.getOwnPropertyDescriptors(props)).map(([key,property])=>{
    if(!('value'in property))refuse();return [key,property.value];
  });
}

/** Snapshot first, build once, then retain every prepared observation. The
 * returned object is private: no status write/event/activation occurs here. */
export function prepareAdoption(host:Element,build:()=>unknown,options:AdoptionOptions={}):PreparedAdoption {
  const dom=new AdoptionDom(host);
  const scopeOptions:PreparationOptions={check:()=>dom.assertUnchanged(),failure:options.failure};
  const scope=options.scope?.(scopeOptions)??new AdoptionLifecycle(scopeOptions);
  const listeners:Listener[]=[];
  const dispose=():void=>{scope.abort();dom.release();};
  function construct<T>(fn:()=>T,ns:string|null):T {
    return scope.run(()=>withNamespace(ns,()=>withAdoptionDescription(fn)));
  }
  function attribute(element:Element,key:string,value:unknown):void {
    let binding: ReturnType<typeof prepareAttribute>;
    const initial=typeof value==='function'?scope.observe(value as ()=>unknown,next=>binding.write(next)):value;
    binding=prepareAttribute(element,key,initial);
    dom.expectAttribute(element,binding.local,binding.initial,binding.namespace);
  }

  function props(element:Element,values:Record<string,unknown>|null):void {
    if(!values)return;
    for(const [key,value]of ownProps(values)){
      if(key==='children')continue;
      if(key==='ref'){if(typeof value==='function')scope.deferRef(()=>value(element));continue;}
      if(key.startsWith('on')&&key.length>2){
        // Listener installation has no user callback. Objects/accessor-backed
        // handlers remain outside this private checkpoint until shared policy.
        if(typeof value==='function'){
          const item:Listener={element,event:key.slice(2).toLowerCase(),listener:function(event){if(scope.phase==='live')value.call(this,event);}};
          listeners.push(item);registerDisposer(()=>item.controller?.abort());
        }
        else if(value!=null&&typeof value==='object')refuse();
        dom.expectAttribute(element,key.toLowerCase(),null);continue;
      }
      if(key==='style'||key==='dangerouslySetInnerHTML'||isFormControlProperty(element,key))refuse();
      if(isEventHandlerAttr(key)){dom.expectAttribute(element,key.toLowerCase(),null);continue;}
      attribute(element,key,value);
    }
  }
  function element(desc:HydrationDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    const own=desc.tag==='svg'?SVG_NS:desc.tag==='math'?MATHML_NS:ns;
    const target=cursor.element(desc.tag,own);props(target,desc.props);
    const nested=dom.children(target),inner=contentNs(target);
    for(const child of desc.children)walk(child,nested,inner);
    nested.finish();
  }
  function fresh(value:unknown):Node|null {
    if(value==null||typeof value==='boolean')return null;
    if(typeof value==='string'||typeof value==='number')return host.ownerDocument.createTextNode(String(value));
    if(value instanceof Node)return value;
    return refuse();
  }
  function show(desc:ShowDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    const range=cursor.range('s');
    let active:PreparedGroup<unknown>,initial=true,current:boolean;
    const cached=new Map<boolean,{fragment:DocumentFragment;owner:PreparedGroup<unknown>}>();
    let owner:PreparedGroup<void>;
    owner=scope.group(()=>{
      current=scope.observe(()=>!!desc.condition(),next=>{
        if(next===current)return;
        const parent=range.start.parentNode;
        if(!parent||range.end.parentNode!==parent)refuse();
        // Validate the range before moving anything; factory failure also
        // leaves the original live range intact (callbacks are already live).
        const leaving:Node[]=[];
        for(let node=range.start.nextSibling;node!==range.end;node=node?.nextSibling??null){
          if(!node)refuse();leaving.push(node);
        }
        let entering=cached.get(next);
        if(entering)cached.delete(next);
        else{
          const branch=owner.child(()=>untrack(()=>withNamespace(ns,()=>withAdoptionDescription(
            ()=>fresh((next?desc.whenTrue:desc.whenFalse)?.()),false,
          ))));
          const fragment=host.ownerDocument.createDocumentFragment();
          if(branch.value)fragment.appendChild(branch.value);
          entering={fragment,owner:branch};
        }
        if(initial)active.dispose();
        // Factories and cleanup are application callbacks now. Disposal or
        // range relocation during either callback revokes the pending move.
        if(scope.phase!=='live'||range.start.parentNode!==parent||range.end.parentNode!==parent)refuse();
        let checked=range.start.nextSibling;
        for(const node of leaving){if(checked!==node)refuse();checked=node.nextSibling;}
        if(checked!==range.end)refuse();
        const fragment=host.ownerDocument.createDocumentFragment();
        for(const node of leaving)fragment.appendChild(node);
        if(initial)initial=false;
        else cached.set(current,{fragment,owner:active});
        active=entering.owner;current=next;
        parent.insertBefore(entering.fragment,range.end);
      });
      active=scope.group(()=>{
        const inside=dom.within(range);
        const selected=current?desc.whenTrue:desc.whenFalse;
        if(selected)walk(construct(selected,ns),inside,ns);
        inside.finish();
      });
      registerDisposer(()=>{cached.clear();});
    });
  }
  function list(desc:ListDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    const range=cursor.range('l');
    // This private checkpoint covers one element per row. Fragment/range rows
    // retain an explicit implementation requirement before activation switches.
    type Key=string|number;
    type Row={owner:PreparedGroup<unknown>;node:Element;item:unknown;setIndex:(value:number)=>void};
    let cache=new Map<Key,Row>(),ordered:Row[]=[];
    let owner:PreparedGroup<void>,keyOwner:PreparedGroup<{items:unknown[];keys:Key[]}>;
    function keys(values:unknown):{items:unknown[];keys:Key[]} {
      if(!Array.isArray(values))refuse();
      const output:Key[]=[],seen=new Set<string>();
      for(let i=0;i<values.length;i++){
        if(!Object.hasOwn(values,i))refuse();
        const key=untrack(()=>desc.keyFn(values[i]));
        if(typeof key!=='string'&&(typeof key!=='number'||!Number.isFinite(key)))refuse();
        const printed=String(key);if(seen.has(printed))refuse();seen.add(printed);output.push(key);
      }
      return {items:values.slice(),keys:output};
    }
    function contents():Node[] {
      const result:Node[]=[];
      for(let node=range.start.nextSibling;node!==range.end;node=node?.nextSibling??null){
        if(!node)refuse();result.push(node);
      }
      return result;
    }
    owner=scope.group(()=>{
      const initial=scope.observe(desc.items,value=>{
        const parent=range.start.parentNode;
        if(!parent||range.end.parentNode!==parent)refuse();
        const before=contents(),oldElements=before.filter(node=>node.nodeType===1);
        if(oldElements.length!==ordered.length||ordered.some((row,i)=>row.node!==oldElements[i]))refuse();
        const check=()=>{
          if(scope.phase!=='live'||range.start.parentNode!==parent||range.end.parentNode!==parent)refuse();
        };
        const unchanged=()=>{check();const now=contents();if(now.length!==before.length||now.some((node,i)=>node!==before[i]))refuse();};
        const nextOwner=owner.child(()=>withAdoptionDescription(()=>keys(value),false));
        const next=nextOwner.value,planned=new Map<Key,Row>(),rows:Row[]=[];unchanged();
        // Execute all row factories before the first move. Each candidate is
        // already owned, so a later factory failure also disposes prior ones.
        for(let i=0;i<next.items.length;i++){
          const item=next.items[i],key=next.keys[i]!,prior=cache.get(key);
          let row=prior;
          if(!row||(desc.options?.updateOnItemChange==='rerender'&&row.item!==item)){
            let setIndex!:(value:number)=>void;
            const child=owner.child(()=>untrack(()=>withNamespace(ns,()=>withAdoptionDescription(()=>{
              const [getIndex,set]=createSignal(i);setIndex=set;
              const node=fresh(desc.renderFn(item,getIndex));
              if(!node||node.nodeType!==1||node.parentNode)refuse();return node as Element;
            },false))));
            row={owner:child,node:child.value,item,setIndex};
          }
          planned.set(key,row);rows.push(row);unchanged();
        }
        const retained=new Set(rows),leaving=ordered.filter(row=>!retained.has(row));
        keyOwner.dispose();unchanged();keyOwner=nextOwner;
        // Disposal and nested-island teardown are user callback boundaries.
        // Complete and recheck them before any framework list mutation.
        for(const row of leaving){
          row.owner.dispose();unchanged();
          if(row.node.hasAttribute('data-forma-island'))deactivateIsland(row.node as HTMLElement);
          deactivateAllIslands(row.node);unchanged();
        }
        unchanged();
        const oldIndex=new Map(ordered.map((row,i)=>[row,i]));
        const reused:number[]=[],positions:number[]=[];
        rows.forEach((row,i)=>{const index=oldIndex.get(row);if(index!==undefined){reused.push(index);positions.push(i);}});
        const stationary=new Set(longestIncreasingSubsequence(reused).map(index=>positions[index]!));
        for(const row of leaving){check();parent.removeChild(row.node);}
        let anchor:Node=range.end;
        for(let i=rows.length-1;i>=0;i--){
          check();const row=rows[i]!;
          if(!stationary.has(i))parent.insertBefore(row.node,anchor);
          anchor=row.node;
        }
        check();cache=planned;ordered=rows;
        for(let i=0;i<rows.length;i++){check();rows[i]!.setIndex(i);}
      });
      keyOwner=scope.group(()=>keys(initial));
      const prepared=keyOwner.value,elements=contents().filter(node=>node.nodeType===1) as Element[];
      if(elements.length!==prepared.items.length)throw new AdoptionDomError('FORMA_E_HYDRATE_LIST_COUNT');
      const keyed=elements.filter(element=>element.hasAttribute('data-forma-key'));
      if(keyed.length&&keyed.length!==elements.length)refuse();
      const originalRows=new Map<string,Element>();
      for(const element of keyed){const key=element.getAttribute('data-forma-key')!;if(originalRows.has(key))refuse();originalRows.set(key,element);}
      const inside=dom.within(range);
      for(let i=0;i<prepared.items.length;i++){
        const item=prepared.items[i],key=prepared.keys[i]!,target=inside.elementHead();
        // Retain the key→original-row association. Until181 this private
        // checkpoint requires order parity and never moves rows during bind.
        if(keyed.length&&originalRows.get(String(key))!==target)refuse();
        let setIndex!:(value:number)=>void;
        const child=scope.group(()=>{
          const [getIndex,set]=createSignal(i);setIndex=set;
          walk(construct(()=>desc.renderFn(item,getIndex),ns),inside,ns);
          if(!inside.immediatelyAfter(target))refuse();
        });
        const row={owner:child,node:target,item,setIndex};cache.set(key,row);ordered.push(row);
      }
      inside.finish();
      registerDisposer(()=>{cache.clear();ordered=[];});
    });
  }
  function walk(value:unknown,cursor:AdoptionCursor,ns:string|null,root=false):void {
    if(value==null||typeof value==='boolean')return;
    if(typeof value==='string'||typeof value==='number'){cursor.text(String(value));return;}
    if(typeof value==='function'){
      let target:Text|undefined,previous:string;
      const initial=scope.observe(()=>withNamespace(ns,()=>withAdoptionDescription(value as ()=>unknown)),next=>{
        const normalized=text(next);if(normalized===previous)return;
        target!.data=normalized;previous=normalized;
      });
      previous=text(initial);target=cursor.textRange(previous);return;
    }
    if(typeof value!=='object')return refuse();
    const description=value as HydrationDescriptor|FragmentDescriptor|ComponentDescription|ShowDescriptor|ListDescriptor;
    switch(description.type){
      case 'element':element(description,cursor,ns);return;
      case 'show':show(description,cursor,ns);return;
      case 'list':list(description,cursor,ns);return;
      case 'fragment':for(const child of description.children)walk(child,cursor,ns);return;
      case 'component':{
        // Registered nested hosts are opaque and must use their own checked
        // 103 claim. Until that joint mapping lands, this cannot consume one.
        if(!root&&cursor.isIslandBoundary())refuse();
        scope.group(()=>walk(construct(()=>Reflect.apply(description.component,description.receiver,description.args),ns),cursor,ns,root));return;
      }
      default:return refuse();
    }
  }
  try{
    const cursor=dom.root();
    scope.run(()=>walk(construct(build,contentNs(host.parentNode)),cursor,contentNs(host.parentNode),true));
    cursor.finish();scope.seal();
  }catch(error){dispose();throw error;}
  return {
    get phase(){return scope.phase;},dispose,
    commit(){
      if(scope.phase!=='validated')return refuse();
      try{
        // Recheck before any listener installation; seed/publish recheck again.
        dom.assertUnchanged();
        if(listeners.length){
          const Controller=host.ownerDocument.defaultView?.AbortController??AbortController;
          for(const item of listeners){
            item.controller=new Controller();item.element.addEventListener(item.event,item.listener,{signal:item.controller.signal});
          }
        }
        scope.seed();scope.publish();
        listeners.length=0;dom.release();
      }catch(error){dispose();throw error;}
    },
  };
}
