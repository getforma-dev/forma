/** Private strict descriptor walker and owned postcommit updates. */
import { AdoptionDom, AdoptionDomError, AdoptionCursor } from './adoption-plan.js';
import { AdoptionRow } from './adoption-row.js';
import { liveList, listItems, type LiveListRow, type ListItems, type ListKey } from './adoption-live-list.js';
import { liveRanges } from './adoption-live-ranges.js';
import { materializeAdoption } from './adoption-materialize.js';
import { withAdoptionDescription, type ComponentDescription } from './adoption-description.js';
import { registerDisposer } from '../reactive/root.js';
import { untrack } from '../reactive/untrack.js';
import { createSignal } from '../reactive/signal.js';
import { deactivateIsland, deactivateAllIslands } from './activate.js';
import { AdoptionLifecycle, type PreparationOptions, type PreparedGroup } from '../reactive/adoption-lifecycle.js';
import { contentNs, SVG_NS, MATHML_NS, withNamespace } from './namespace.js';
import { isEventHandlerAttr } from '../security/url-safety.js';
import { prepareAttribute } from './adoption-attributes.js';
import { prepareStyle, prepareRaw, type PreparedRaw } from './adoption-content.js';
import { warnInnerHtmlChildren } from './trusted-html.js';
import { currentAdoptionDiagnostic, withAdoptionDiagnostic, type AdoptionDiagnostic } from '../reactive/adoption-diagnostics.js';
import { isFormControlProperty, writeFormControlProperty } from './form-control.js';
import { AdoptionControls, type ControlToken } from './adoption-controls.js';
import { normalizeDomText } from './normalize-text.js';
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
  /** Preserve initial thrown primitive values without wrapping user exceptions. */
  errorContext?: (diagnostic:AdoptionDiagnostic)=>void;
}
function refuse():never {throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');}
/** An admitted text expectation or later value, under rule 1: the served DOM
 * holds the walker's normalized text, so the client's value is compared and
 * later written the same way. Transport (the props themselves) stays exact.
 * A null or a boolean is the empty string, as h() writes nothing for either
 * (rules 5 and 6, docs/parity-rules.md); the word of a boolean is String()'s.
 * Verified by: src/dom/__tests__/normalize-text.test.ts > "a served normalized range matches a client value $id without a write"
 * Verified by: src/dom/__tests__/value-rule-6-boolean-text.test.ts > "$id: the mixed idiom writes nothing for its boolean and the string otherwise; its served range adopts without a write" */
function text(value:unknown):string {
  if(value==null||typeof value==='boolean')return '';
  if(typeof value==='string'||typeof value==='number')return normalizeDomText(String(value));
  return refuse();
}
function collectText(children:unknown[]):()=>string {
  return ()=>children.map(child=>text(typeof child==='function'?(child as ()=>unknown)():child)).join('');
}
function ownProps(props:Record<string,unknown>):[string,unknown][] {
  // Snapshot every descriptor before validating, then reuse these private pairs.
  const entries:[string,unknown][]=Object.entries(Object.getOwnPropertyDescriptors(props));
  for(const pair of entries){
    const property=pair[1] as PropertyDescriptor;
    if(!('value'in property))refuse();pair[1]=property.value;
  }
  return entries;
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
  const scopeOptions:PreparationOptions={callback:fn=>withAdoptionDescription(fn,false),check:()=>{dom.assertUnchanged();controls.check();for(const child of children)checkIslandClaim(child);},failure:options.failure};
  const scope=options.scope?.(scopeOptions)??new AdoptionLifecycle(scopeOptions);
  const listeners:Listener[]=[];
  let nextBinding=0,initialFailure=false;
  function rememberFailure(diagnostic:AdoptionDiagnostic|undefined):void {
    if(diagnostic&&!initialFailure){initialFailure=true;options.errorContext?.(diagnostic);}
  }
  function at<T>(label:string,fn:()=>T):T {
    const binding=nextBinding++,parent=currentAdoptionDiagnostic();
    const diagnostic=Object.freeze({binding,path:`${parent?.path??''}/${label}[${binding}]`});
    try{return withAdoptionDiagnostic(diagnostic,fn);}catch(error){
      rememberFailure(diagnostic);throw error;
    }
  }
  const controlBindings=new Map<ControlToken,{read?:()=>unknown;skip?:{value:unknown};diagnostic?:AdoptionDiagnostic}>();
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
    const binding:{read?:()=>unknown;skip?:{value:unknown};diagnostic?:AdoptionDiagnostic}={read:authority??read,diagnostic:currentAdoptionDiagnostic()};
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
    const collect=collectText(children);
    // A sole original compiler wrapper retains its exact getter authority;
    // composed text remains a reactive binding with no invented setter.
    control(element,'text',reads.length?collect:collect(),children.length===1&&reads.length===1?reads[0]:undefined);
  }

  function title(element:Element,children:unknown[]):void {
    const collect=collectText(children);
    let previous:string;
    const write=(next:string)=>{if(next!==previous){element.textContent=next;previous=next;}};
    const initial=children.some(child=>typeof child==='function')?scope.observe(collect,write):collect();
    const inside=dom.children(element);inside.text(initial);inside.finish();previous=initial;
  }
  function props(element:Element,values:Record<string,unknown>|null,raw:(value:unknown)=>void):void {
    if(!values)return;
    for(const [key,value]of ownProps(values))at('@'+key,()=>{
      if(key==='children')return;
      if(key==='ref'){if(typeof value==='function')scope.deferRef(()=>value(element));return;}
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
        dom.expectAttribute(element,key.toLowerCase(),null);return;
      }
      if(key==='style'){
        let binding:ReturnType<typeof prepareStyle>;
        const initial=typeof value==='function'?scope.observe(value as ()=>unknown,next=>binding.write(next)):value;
        binding=prepareStyle(element,initial);return;
      }
      if(key==='dangerouslySetInnerHTML'){raw(value);return;}
      if(isFormControlProperty(element,key)){control(element,key as 'value'|'checked'|'selected',value);return;}
      if(isEventHandlerAttr(key)){dom.expectAttribute(element,key.toLowerCase(),null);return;}
      attribute(element,key,value);
    });
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
      if(target.namespaceURI==='http://www.w3.org/1999/xhtml'&&target.localName==='title'){title(target,desc.children);return;}
      const nested=dom.children(target),inner=contentNs(target);
      for(const child of desc.children)walk(child,nested,inner);
      nested.finish();
    };
    if(raw)fallback=scope.group(children);else children();
  }
  const materialization=liveRanges(scope,host.ownerDocument,element=>{
    if(element.hasAttribute('data-forma-island'))deactivateIsland(element);deactivateAllIslands(element);
  });
  function fresh(value:unknown,ns:string|null):Node|null {
    return materializeAdoption(value,ns,materialization);
  }
  type ConditionalSnapshot={parent:Node;nodes:Node[]};
  type ConditionalValue={kind:'conditional';branch:PreparedGroup<unknown>;before?:ConditionalSnapshot};
  function conditionalBranch(desc:ShowDescriptor,ns:string|null,initial:boolean,parent?:PreparedGroup<unknown>,snapshot?:()=>ConditionalSnapshot):ConditionalValue {
    const before=snapshot?.(),selected=desc.condition()?desc.whenTrue:desc.whenFalse;
    const build=()=>{
      const value=withNamespace(ns,()=>withAdoptionDescription(()=>selected?.()));
      return initial?value:fresh(value,ns);
    };
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
          const branch=owner.child(()=>untrack(()=>{
            const value=observed?.description()??desc;
            return fresh(withNamespace(ns,()=>withAdoptionDescription(()=>(next?value.whenTrue:value.whenFalse)?.())),ns);
          }));
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
    type Row=LiveListRow;
    const cache=new Map<ListKey,Row>(),tail:Node[]=[];
    let ordered:Row[]=[];
    let owner:PreparedGroup<void>,keyOwner!:PreparedGroup<ListItems>,reconciler:ReturnType<typeof liveList>;
    const keys=(values:unknown)=>listItems(values,desc.keyFn);
    owner=scope.group(()=>{
      const initial=scope.observe(desc.items,value=>{
        reconciler.update(value);
      });
      keyOwner=scope.group(()=>keys(initial));
      const prepared=keyOwner.value,count=prepared.items.length,units=dom.rows(range);
      const mismatch=(extent:string)=>new AdoptionDomError('FORMA_E_HYDRATE_LIST_COUNT',`client has ${count} item${count===1?'':'s'}, ${extent}`);
      // Keyed rows (FORMA-181): each client item adopts the served row whose
      // decoded data-forma-key equals its canonical key, through a cursor
      // bounded to that row. Nothing moves; `ordered` keeps the served order,
      // which the first real update reconciles against the client's order.
      // Verified by: src/dom/__tests__/adoption-keyed-list.test.ts
      // Every client key finds its served row before any row runs. The client's
      // keys are unique, so equal counts and every key found also mean every
      // served row has a key and no served key repeats.
      const byKey=new Map(units?.map(unit=>[unit.key,unit]));
      if(units&&(units.length!==count||prepared.keys.some(key=>!byKey.has(key))))throw new AdoptionDomError('FORMA_E_HYDRATE_KEY');
      const inside=units?undefined:dom.within(range);
      for(let i=0;i<count;i++){
        const item=prepared.items[i],key=prepared.keys[i]!,unit=byKey.get(key);
        // A cursor bounded to the one served row: it cannot reach the next.
        const rows=unit?new AdoptionCursor(dom,unit.start,unit.next):inside!;
        let setIndex!:(value:number)=>void,span!:AdoptionRow;
        const child=scope.group(()=>{
          const [getIndex,set]=createSignal(i);setIndex=set;
          const empty=rows.atEnd;
          try{
            const captured=rows.capture(()=>walk(construct(()=>desc.renderFn(item,getIndex),ns),rows,ns));
            if(unit)rows.finish();
            span=new AdoptionRow(captured.pieces);
          }catch(error){
            if(empty&&error instanceof AdoptionDomError&&(error.code==='FORMA_E_HYDRATE_NODE'||error.code==='FORMA_E_HYDRATE_MARKER'))throw mismatch(`server range exhausted after ${i} prepared items`);
            throw error;
          }
        });
        const row:Row={owner:child,span,item,setIndex};
        cache.set(key,row);ordered.push(row);
      }
      // The reconciler starts from the served (physical) order.
      if(units)ordered=units.map(unit=>cache.get(unit.key!)!);
      else{
        try{inside!.finish();}catch(error){if(error instanceof AdoptionDomError&&error.code==='FORMA_E_HYDRATE_STRUCTURE')throw mismatch(inside!.remainder());throw error;}
        let last:Node|null=null;for(const row of ordered)if(row.span.last)last=row.span.last;
        let node=last?last.nextSibling:range.start.nextSibling;
        for(;node!==range.end;node=node?.nextSibling??null){if(!node)refuse();tail.push(node);}
      }
      registerDisposer(()=>reconciler?.clear());
    });
    reconciler=liveList({range,owner,live:()=>scope.phase==='live',
      keys:value=>withAdoptionDescription(()=>keys(value),false),
      render:(item,index)=>fresh(withNamespace(ns,()=>withAdoptionDescription(()=>desc.renderFn(item,index))),ns),
      rerender:desc.options?.updateOnItemChange==='rerender',removeChildren:element=>{
        if(element.hasAttribute('data-forma-island'))deactivateIsland(element);deactivateAllIslands(element);
      }},{cache,ordered,tail,keyOwner});
  }
  function walk(value:unknown,cursor:AdoptionCursor,ns:string|null,root=false):void {
    at('node',()=>visit(value,cursor,ns,root));
  }
  function visit(value:unknown,cursor:AdoptionCursor,ns:string|null,root=false):void {
    if(value==null||typeof value==='boolean'){
      if(cursor.rangeKind()==='t')cursor.textRange(text(value));return;
    }
    if(typeof value==='string'||typeof value==='number'){
      if(cursor.rangeKind()==='t')cursor.textRange(text(value));else cursor.text(text(value));return;
    }
    if(typeof value==='function'){
      let owner:PreparedGroup<void>,first=true,snapshot:(()=>ConditionalSnapshot)|undefined;
      owner=scope.group(()=>{
        type Read=ConditionalValue|{kind:'show';value:boolean;description:ShowDescriptor}|string;
        let write:(value:Read)=>void;
        const initial=scope.observe<Read>(()=>{
          const result=withNamespace(ns,()=>withAdoptionDescription(value as ()=>unknown));
          if(result&&typeof result==='object'&&(result as ShowDescriptor).type==='show'){
            const description=result as ShowDescriptor;
            if(description.conditional)return conditionalBranch(description,ns,first,owner,snapshot);
            return {kind:'show',description,value:!!description.condition()};
          }
          return text(result);
        },next=>write(next));first=false;
        if(typeof initial!=='string'&&initial.kind==='conditional'){
          conditional(initial,cursor,ns,(update,read)=>{snapshot=read;write=next=>{if(typeof next==='string'||next.kind!=='conditional')refuse();update(next);};});
        }else if(typeof initial!=='string'&&initial.kind==='show'){
          let description=initial.description;
          show(description,cursor,ns,{initial:initial.value,description:()=>description,connect:update=>{
            write=next=>{if(typeof next==='string'||next.kind!=='show')refuse();description=next.description;update(next.value);};
          }});
        }else{
          const target=cursor.textRange(initial),parent=target.parentNode;
          const start=target.previousSibling as Comment,end=target.nextSibling as Comment;
          const startData=start.data,endData=end.data;let previous=initial,written=target.data;
          write=next=>{
            // A changed binding checks only its owned hole. Initial adoption still
            // validates the complete island; live keyed item edits need no scan of
            // unrelated rows, but must not write through a detached/rewritten hole.
            if(typeof next!=='string'||!target.isConnected||!host.contains(target)||target.parentNode!==parent
              ||target.previousSibling!==start||target.nextSibling!==end
              ||start.data!==startData||end.data!==endData||target.data!==written)refuse();
            if(next!==previous){target.data=next;written=next;previous=next;}
          };
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
    for(const observation of controls.finish(token=>rememberFailure(controlBindings.get(token)?.diagnostic)))if(observation.kind==='binding'&&observation.edited){
      const binding=controlBindings.get(observation.token)!;
      if(!binding.read)refuse();
      try{withAdoptionDiagnostic(binding.diagnostic,()=>scope.queueEdit(binding.read!,observation.value));}
      catch(error){rememberFailure(binding.diagnostic);throw error;}
      binding.skip={value:observation.value};
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
            if(scope.phase!=='validated')refuse();
            item.controller=new Controller();
            try{item.element.addEventListener(item.event,item.listener,{signal:item.controller.signal});}
            finally{
              // Installation can reenter teardown before or after native add,
              // including an attach-then-throw. Remove this exact callback too.
              if(scope.phase!=='validated')item.element.removeEventListener(item.event,item.listener);
            }
          }
        }
        scope.seed();scope.publish();
        listeners.length=0;release();
      }catch(error){dispose();throw error;}
    },
  };
}
