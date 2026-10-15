/** Private descriptor walker. Activation is switched only after its remaining
 * control-flow/control/raw-HTML checkpoints and compiled product review. */
import { AdoptionDom, AdoptionDomError, type AdoptionCursor } from './adoption-plan.js';
import { AdoptionRow, materializeRows } from './adoption-row.js';
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
import { prepareStyle, prepareRaw, type PreparedRaw } from './adoption-content.js';
import { warnInnerHtmlChildren } from './trusted-html.js';
import { isFormControlProperty, writeFormControlProperty } from './form-control.js';
import { AdoptionControls, type ControlToken } from './adoption-controls.js';
import { checkIslandClaim, isRegisteredIslandComponent, matchAdoptionChild, type ValidatedIsland } from './island-state.js';
import type { HydrationDescriptor, FragmentDescriptor, ShowDescriptor, ListDescriptor } from './adoption-description.js';

interface Listener { element:Element; event:string; listener:EventListener; controller?:AbortController }
export interface PreparedAdoption {
  readonly phase: AdoptionLifecycle['phase'];
  commit(): void;
  dispose(): void;
}
export interface AdoptionOptions {
  /** Public hydrate keeps its explicit marked-host/container convention.
   * Compiled activation leaves this unset and consumes only its owned host. */
  target?: 'host'|'public';
  /** Original document preflight results, indexed by their exact light-DOM host. */
  children?: ReadonlyMap<Element,ValidatedIsland>;
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

function listenerObject(value:unknown):value is EventListenerObject {
  if(value===null||typeof value!=='object')return false;
  // Class methods are valid too. Do not execute an accessor before commit;
  // native handleEvent lookup remains dynamic inside the owned live callback.
  for(let object=value;object;object=Object.getPrototypeOf(object)){
    const descriptor=Object.getOwnPropertyDescriptor(object,'handleEvent');
    if(descriptor)return 'value'in descriptor?typeof descriptor.value==='function':typeof descriptor.get==='function';
  }
  return false;
}

/** Snapshot first, build once, then retain every prepared observation. The
 * returned object is private: no status write/event/activation occurs here. */
export function prepareAdoption(host:Element,build:()=>unknown,options:AdoptionOptions={}):PreparedAdoption {
  const dom=new AdoptionDom(host);
  const controls=new AdoptionControls(host);
  const children=new Set<ValidatedIsland>();
  const scopeOptions:PreparationOptions={check:()=>{dom.assertUnchanged();controls.check();for(const child of children)checkIslandClaim(child);},failure:options.failure};
  const scope=options.scope?.(scopeOptions)??new AdoptionLifecycle(scopeOptions);
  const listeners:Listener[]=[];
  const controlBindings=new Map<ControlToken,{read?:()=>unknown;skip?:{value:unknown}}>();
  const release=():void=>{dom.release();controls.release();controlBindings.clear();children.clear();};
  const dispose=():void=>{scope.abort();release();};
  function construct<T>(fn:()=>T,ns:string|null):T {
    return scope.run(()=>withNamespace(ns,()=>withAdoptionDescription(fn)));
  }
  function attribute(element:Element,key:string,value:unknown):void {
    let binding: ReturnType<typeof prepareAttribute>;
    const initial=typeof value==='function'?scope.observe(value as ()=>unknown,next=>binding.write(next)):value;
    binding=prepareAttribute(element,key,initial);
    dom.expectAttribute(element,binding.local,binding.initial,binding.namespace);
  }

  function control(element:Element,key:'value'|'checked'|'selected'|'text',value:unknown,authority?:()=>unknown):void {
    const read=typeof value==='function'?value as ()=>unknown:undefined;
    const binding:{read?:()=>unknown;skip?:{value:unknown}}={read:authority??read};
    const write=(next:unknown)=>{
      // Seeding only suppresses this edited control's matching notification.
      // Other dependents remain live; a later different value is never skipped,
      // including when an enclosing user batch delays the first notification.
      if(binding.skip){
        const expected=binding.skip.value;binding.skip=undefined;
        if(Object.is(next,expected)||(Array.isArray(next)&&Array.isArray(expected)&&next.length===expected.length&&next.every((item,i)=>item===expected[i])))return;
      }
      writeFormControlProperty(element,key,next);
    };
    const initial=read?scope.observe(read,write):value;
    const token=controls.add({element,key,initial,kind:read?'binding':'initial',codec:binding.read?scope.inputCodec(binding.read):undefined});
    controlBindings.set(token,binding);
  }
  function textarea(element:Element,children:unknown[]):void {
    const reads=children.filter(child=>typeof child==='function') as (()=>unknown)[];
    const collect=()=>children.map(child=>{
      const value=typeof child==='function'?(child as ()=>unknown)():child;
      return value==null||typeof value==='boolean'?'':text(value);
    }).join('');
    // A sole original compiler wrapper retains its exact getter authority;
    // composed text remains a reactive binding with no invented setter.
    control(element,'text',reads.length?collect:collect(),children.length===1&&reads.length===1?reads[0]:undefined);
  }

  function props(element:Element,values:Record<string,unknown>|null,raw:(value:unknown)=>void):void {
    if(!values)return;
    for(const [key,value]of ownProps(values)){
      if(key==='children')continue;
      if(key==='ref'){if(typeof value==='function')scope.deferRef(()=>value(element));continue;}
      if(key.startsWith('on')&&key.length>2){
        // Preserve function receiver and native object handleEvent lookup,
        // while keeping all callback-created work in this prepared owner.
        if(typeof value==='function'||listenerObject(value)){
          const listener=scope.liveCallback((event:Event)=>{
            if(typeof value==='function')value.call(element,event);
            else value.handleEvent(event);
          });
          const item:Listener={element,event:key.slice(2).toLowerCase(),listener};
          listeners.push(item);registerDisposer(()=>item.controller?.abort());
        }
        dom.expectAttribute(element,key.toLowerCase(),null);continue;
      }
      if(key==='style'){
        let binding:ReturnType<typeof prepareStyle>;
        const initial=typeof value==='function'?scope.observe(value as ()=>unknown,next=>binding.write(next)):value;
        binding=prepareStyle(element,initial);continue;
      }
      if(key==='dangerouslySetInnerHTML'){raw(value);continue;}
      if(isFormControlProperty(element,key)){control(element,key as 'value'|'checked'|'selected',value);continue;}
      if(isEventHandlerAttr(key)){dom.expectAttribute(element,key.toLowerCase(),null);continue;}
      attribute(element,key,value);
    }
  }
  function element(desc:HydrationDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    const own=desc.tag==='svg'?SVG_NS:desc.tag==='math'?MATHML_NS:ns;
    const target=cursor.element(desc.tag,own);
    const area=target.namespaceURI==='http://www.w3.org/1999/xhtml'&&target.localName==='textarea';
    const valueProp=area&&desc.props&&Object.hasOwn(desc.props,'value');
    // Static holes render nothing. A reactive child is still real ownership,
    // even if it would read empty; never evaluate it to decide this boundary.
    if(valueProp&&desc.children.some(child=>child!=null&&typeof child!=='boolean'&&child!==''))refuse();
    let raw:PreparedRaw|undefined,fallback:PreparedGroup<void>|undefined;
    const isTemplate=target.namespaceURI==='http://www.w3.org/1999/xhtml'&&target.localName==='template';
    const content=isTemplate?(target as HTMLTemplateElement).content:target;
    const beforeReplace=()=>{
      const parent=target.parentNode,previous=target.previousSibling,next=target.nextSibling;
      if(!parent||scope.phase!=='live')refuse();
      fallback?.dispose();fallback=undefined;
      deactivateAllIslands(content);
      // Cleanup is user code. Do not replace a revoked or moved target afterward.
      if(scope.phase!=='live'||target.parentNode!==parent||target.previousSibling!==previous||target.nextSibling!==next
        ||(isTemplate&&(target as HTMLTemplateElement).content!==content))refuse();
    };
    props(target,desc.props,value=>{
      let binding:PreparedRaw;
      const initial=typeof value==='function'?scope.observe(value as ()=>unknown,next=>binding.write(next,beforeReplace)):value;
      raw=binding=prepareRaw(target,initial);
    });
    if(raw?.ownsContent){warnInnerHtmlChildren(desc.props,desc.children);return;}
    const children=()=>{
      if(area){if(!valueProp)textarea(target,desc.children);return;}
      const nested=dom.children(target),inner=contentNs(target);
      for(const child of desc.children)walk(child,nested,inner);
      nested.finish();
    };
    if(raw)fallback=scope.group(children);else children();
  }
  function fresh(value:unknown):Node|null {
    if(value==null||typeof value==='boolean')return null;
    if(typeof value==='string'||typeof value==='number')return host.ownerDocument.createTextNode(String(value));
    if(value instanceof Node)return value;
    return refuse();
  }
  type ConditionalSnapshot={parent:Node;nodes:Node[]};
  type ConditionalValue={kind:'conditional';branch:PreparedGroup<unknown>;before?:ConditionalSnapshot};
  function conditionalBranch(desc:ShowDescriptor,ns:string|null,initial:boolean,parent?:PreparedGroup<unknown>,snapshot?:()=>ConditionalSnapshot):ConditionalValue {
    const before=snapshot?.(),selected=desc.condition()?desc.whenTrue:desc.whenFalse;
    const build=()=>withNamespace(ns,()=>withAdoptionDescription(
      ()=>initial?selected?.():fresh(selected?.()),initial,
    ));
    const branch=parent?parent.trackedChild(build):scope.trackedGroup(build);
    return {kind:'conditional',branch,before};
  }
  function conditional(initial:ConditionalValue,cursor:AdoptionCursor,ns:string|null,connect:(write:(next:ConditionalValue)=>void,snapshot:()=>ConditionalSnapshot)=>void):void {
    const range=cursor.range('s');let active=initial.branch;
    const snapshot=():ConditionalSnapshot=>{
      const parent=range.start.parentNode;if(!parent||range.end.parentNode!==parent)refuse();
      const nodes:Node[]=[];
      for(let node=range.start.nextSibling;node!==range.end;node=node?.nextSibling??null){if(!node)refuse();nodes.push(node);}
      return {parent,nodes};
    };
    const check=(before:ConditionalSnapshot)=>{
      if(scope.phase!=='live'||range.start.parentNode!==before.parent||range.end.parentNode!==before.parent)refuse();
      let node=range.start.nextSibling;for(const expected of before.nodes){if(node!==expected)refuse();node=node.nextSibling;}
      if(node!==range.end)refuse();
    };
    active.run(()=>{const inside=dom.within(range);walk(active.value,inside,ns);inside.finish();});
    connect(next=>{
      const before=next.before;if(!before)refuse();check(before);
      active.dispose();check(before);
      for(const node of before.nodes)if(node.nodeType===1)deactivateAllIslands(node as Element);
      check(before);
      for(const node of before.nodes)before.parent.removeChild(node);
      if(next.branch.value)before.parent.insertBefore(next.branch.value as Node,range.end);
      active=next.branch;
    },snapshot);
  }
  function directConditional(desc:ShowDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    let owner:PreparedGroup<void>,initial=true,write!:(next:ConditionalValue)=>void,snapshot:(()=>ConditionalSnapshot)|undefined;
    owner=scope.group(()=>{
      const first=scope.observe(()=>conditionalBranch(desc,ns,initial,owner,snapshot),next=>write(next));initial=false;
      conditional(first,cursor,ns,(update,read)=>{write=update;snapshot=read;});
    });
  }
  function show(desc:ShowDescriptor,cursor:AdoptionCursor,ns:string|null,observed?:{
    initial:boolean;description:()=>ShowDescriptor;connect:(write:(next:boolean)=>void)=>void;
  }):void {
    const range=cursor.range('s');
    let active:PreparedGroup<unknown>,initial=true,current:boolean;
    const cached=new Map<boolean,{fragment:DocumentFragment;owner:PreparedGroup<unknown>}>();
    let owner:PreparedGroup<void>;
    owner=scope.group(()=>{
      const update=(next:boolean)=>{
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
            ()=>{const value=observed?.description()??desc;return fresh((next?value.whenTrue:value.whenFalse)?.());},false,
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
      };
      if(observed){current=observed.initial;observed.connect(update);}
      else current=scope.observe(()=>!!desc.condition(),update);
      active=scope.group(()=>{
        const inside=dom.within(range);
        const value=observed?.description()??desc,selected=current?value.whenTrue:value.whenFalse;
        if(selected)walk(construct(selected,ns),inside,ns);
        inside.finish();
      });
      registerDisposer(()=>{cached.clear();});
    });
  }
  function list(desc:ListDescriptor,cursor:AdoptionCursor,ns:string|null):void {
    const range=cursor.range('l');
    type Key=string|number;
    type Row={owner:PreparedGroup<unknown>;span:AdoptionRow;item:unknown;setIndex:(value:number)=>void};
    let cache=new Map<Key,Row>(),ordered:Row[]=[],tail:Node[]=[];
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
        const before=contents(),covered:Node[]=[];
        for(const row of ordered)for(const node of row.span.nodes())if(covered[covered.length-1]!==node)covered.push(node);
        covered.push(...tail);
        if(covered.length!==before.length||covered.some((node,i)=>node!==before[i]))refuse();
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
              if(node&&node.parentNode)refuse();return node;
            },false))));
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
            if(element.hasAttribute('data-forma-island'))deactivateIsland(element);
            deactivateAllIslands(element);unchanged();
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
      });
      keyOwner=scope.group(()=>keys(initial));
      const prepared=keyOwner.value,elements=contents().filter(node=>node.nodeType===1) as Element[];
      const keyed=elements.filter(element=>element.hasAttribute('data-forma-key'));
      if(keyed.length&&keyed.length!==prepared.items.length)refuse();
      if(keyed.some((element,i)=>element.getAttribute('data-forma-key')!==String(prepared.keys[i])))refuse();
      const originalRows=new Map<string,Element>();
      for(const element of keyed){const key=element.getAttribute('data-forma-key')!;if(originalRows.has(key))refuse();originalRows.set(key,element);}
      const inside=dom.within(range);
      for(let i=0;i<prepared.items.length;i++){
        const item=prepared.items[i],key=prepared.keys[i]!;
        let setIndex!:(value:number)=>void,span!:AdoptionRow;
        const child=scope.group(()=>{
          const [getIndex,set]=createSignal(i);setIndex=set;
          const empty=inside.atEnd;
          try{
            const captured=inside.capture(()=>walk(construct(()=>desc.renderFn(item,getIndex),ns),inside,ns));
            span=new AdoptionRow(captured.pieces);
          }catch(error){
            if(empty&&error instanceof AdoptionDomError&&(error.code==='FORMA_E_HYDRATE_NODE'||error.code==='FORMA_E_HYDRATE_MARKER'))throw new AdoptionDomError('FORMA_E_HYDRATE_LIST_COUNT');
            throw error;
          }
        });
        if(keyed.length){
          // The key-to-original-span seam survives multiple-node rows. Initial
          // order parity remains the explicit pre181 limitation; no bind moves.
          const firstElement=span.nodes().find(node=>node.nodeType===1);
          if(originalRows.get(String(key))!==firstElement)refuse();
        }
        cache.set(key,{owner:child,span,item,setIndex});ordered.push(cache.get(key)!);
      }
      try{inside.finish();}catch(error){if(error instanceof AdoptionDomError&&error.code==='FORMA_E_HYDRATE_STRUCTURE')throw new AdoptionDomError('FORMA_E_HYDRATE_LIST_COUNT');throw error;}
      let last:Node|null=null;for(const row of ordered)if(row.span.last)last=row.span.last;
      let node=last?last.nextSibling:range.start.nextSibling;
      for(;node!==range.end;node=node?.nextSibling??null){if(!node)refuse();tail.push(node);}
      registerDisposer(()=>{cache.clear();ordered=[];tail=[];});
    });
  }
  function walk(value:unknown,cursor:AdoptionCursor,ns:string|null,root=false):void {
    if(value==null||typeof value==='boolean'){
      if(cursor.rangeKind()==='t')cursor.textRange(text(value));return;
    }
    if(typeof value==='string'||typeof value==='number'){
      if(cursor.rangeKind()==='t')cursor.textRange(String(value));else cursor.text(String(value));return;
    }
    if(typeof value==='function'){
      let owner:PreparedGroup<void>,first=true,snapshot:(()=>ConditionalSnapshot)|undefined;
      owner=scope.group(()=>{
        type Read=ConditionalValue|{kind:'show';value:boolean;description:ShowDescriptor}|{kind:'text';value:string};
        let write:(value:Read)=>void;
        const initial=scope.observe<Read>(()=>{
          const result=withNamespace(ns,()=>withAdoptionDescription(value as ()=>unknown));
          if(result&&typeof result==='object'&&(result as ShowDescriptor).type==='show'){
            const description=result as ShowDescriptor;
            if(description.conditional)return conditionalBranch(description,ns,first,owner,snapshot);
            return {kind:'show',description,value:!!description.condition()};
          }
          return {kind:'text',value:text(result)};
        },next=>write(next));first=false;
        if(initial.kind==='conditional'){
          conditional(initial,cursor,ns,(update,read)=>{snapshot=read;write=next=>{if(next.kind!=='conditional')refuse();update(next);};});
        }else if(initial.kind==='show'){
          let description=initial.description;
          show(description,cursor,ns,{initial:initial.value,description:()=>description,connect:update=>{
            write=next=>{if(next.kind!=='show')refuse();description=next.description;update(next.value);};
          }});
        }else{
          const target=cursor.textRange(initial.value);let previous=initial.value;
          write=next=>{if(next.kind!=='text')refuse();if(next.value!==previous){target.data=next.value;previous=next.value;}};
        }
      });return;
    }
    if(typeof value!=='object')return refuse();
    const description=value as HydrationDescriptor|FragmentDescriptor|ComponentDescription|ShowDescriptor|ListDescriptor;
    switch(description.type){
      case 'element':element(description,cursor,ns);return;
      case 'show':if(description.conditional)directConditional(description,cursor,ns);else show(description,cursor,ns);return;
      case 'list':list(description,cursor,ns);return;
      case 'fragment':for(const child of description.children)walk(child,cursor,ns);return;
      case 'component':{
        if(!root&&isRegisteredIslandComponent(description.component)){
          const host=cursor.island(),checked=options.children?.get(host);
          if(!checked)refuse();
          matchAdoptionChild(host,description,checked);children.add(checked);return;
        }
        // A genuine unregistered helper can produce the registered child
        // description. Its body executes once under this parent's ownership.
        scope.group(()=>walk(construct(()=>Reflect.apply(description.component,description.receiver,description.args),ns),cursor,ns,root));return;
      }
      default:return refuse();
    }
  }
  try{
    const start=(value:unknown):void=>{
      if(options.target==='public'&&value&&typeof value==='object'&&(value as ComponentDescription).type==='component'){
        const component=value as ComponentDescription;
        scope.group(()=>start(construct(()=>Reflect.apply(component.component,component.receiver,component.args),contentNs(host))));return;
      }
      const own=options.target!=='public'||(value&&typeof value==='object'
        &&(value as HydrationDescriptor).type==='element'&&host.hasAttribute('data-forma-island'));
      const cursor=own?dom.root():dom.children(host),ns=own?contentNs(host.parentNode):contentNs(host);
      walk(value,cursor,ns,true);cursor.finish();
    };
    scope.run(()=>start(construct(build,options.target==='public'?contentNs(host):contentNs(host.parentNode))));
    for(const observation of controls.finish())if(observation.kind==='binding'&&observation.edited){
      const binding=controlBindings.get(observation.token)!;
      if(!binding.read)refuse();
      scope.queueEdit(binding.read,observation.value);binding.skip={value:observation.value};
    }
    scope.seal();
  }catch(error){dispose();throw error;}
  return {
    get phase(){return scope.phase;},dispose,
    commit(){
      if(scope.phase!=='validated')return refuse();
      try{
        // Recheck before any listener installation; seed/publish recheck again.
        dom.assertUnchanged();controls.check();
        if(listeners.length){
          const Controller=host.ownerDocument.defaultView?.AbortController??AbortController;
          for(const item of listeners){
            item.controller=new Controller();item.element.addEventListener(item.event,item.listener,{signal:item.controller.signal});
          }
        }
        scope.seed();scope.publish();
        listeners.length=0;release();
      }catch(error){dispose();throw error;}
    },
  };
}
