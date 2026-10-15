/** Private read-only control observations. The caller owns readers and seeds. */
import { AdoptionDomError } from './adoption-plan.js';
import { AdoptionScopeError } from '../reactive/adoption-lifecycle.js';
import type { AdoptionCodec } from '../reactive/adoption-hooks.js';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLOptionElement;
type Key = 'value' | 'checked' | 'selected' | 'text';
type Initial = string | number | boolean | null | undefined | readonly string[];
declare const tokenBrand: unique symbol;
export type ControlToken = { readonly [tokenBrand]: true };
export type ControlKind = 'initial' | 'binding';
export interface ControlBinding { element: Element; key: Key; initial: unknown; codec?: AdoptionCodec; kind?: ControlKind }
export interface ControlObservation { readonly token: ControlToken; readonly kind: ControlKind; readonly edited: boolean; readonly value: unknown }
type Attributes = readonly (readonly [string, string])[];
type Snapshot = {
  element: Control; parent: Node | null; previous: Node | null; next: Node | null;
  attrs: Attributes; text: string; form: HTMLFormElement | null; type: string;
  value: string; checked: boolean; selected: boolean; number: number;
  options: HTMLOptionElement[]; selectedOptions: boolean[]; files: File[];
  selection: readonly [number | null, number | null, string | null];
};
type Binding = { snapshot: Snapshot; key: Key; initial: Initial; codec?: AdoptionCodec; kind: ControlKind; token: ControlToken };
type Group = { name: string; form: HTMLFormElement | null; members: HTMLInputElement[] };
const HTML = 'http://www.w3.org/1999/xhtml';
const MODEL_ATTRS = new Set(['type','name','value','alpha','colorspace','checked','selected','min','max','step','multiple','size','disabled','readonly','required','maxlength','minlength','pattern','label']);
function structure(): never { throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE'); }
function mismatch(): never { throw new AdoptionDomError('FORMA_E_HYDRATE_VALUE'); }
function target(): never { throw new AdoptionScopeError('FORMA_E_HYDRATE_INPUT_TARGET'); }
function control(element: Element): element is Control {
  return element.namespaceURI === HTML && ['input','textarea','select','option'].includes(element.localName);
}
const attributes = (element: Element): Attributes => Array.from(element.attributes, item => [item.name,item.value] as const).sort(([a],[b]) => a.localeCompare(b));
function same(a: readonly unknown[], b: readonly unknown[]): boolean { return a.length === b.length && a.every((value,index) => Object.is(value,b[index])); }
function initial(value: unknown): Initial {
  if (value == null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value as Initial;
  if (Array.isArray(value)) {
    const copy:string[]=[];
    for(let i=0;i<value.length;i++) {
      const property=Object.getOwnPropertyDescriptor(value,String(i));
      if(!property || !('value' in property) || typeof property.value !== 'string')mismatch();
      copy.push(property.value);
    }
    return Object.freeze(copy);
  }
  return mismatch();
}
function text(value: Initial): string { return value == null ? '' : Array.isArray(value) ? value.join(',') : String(value); }
function selection(element: Control): Snapshot['selection'] {
  if(element.localName!=='input'&&element.localName!=='textarea')return [null,null,null];
  const input=element as HTMLInputElement|HTMLTextAreaElement;
  return [input.selectionStart,input.selectionEnd,input.selectionDirection];
}
function snapshot(element: Control): Snapshot {
  const input=element as HTMLInputElement,select=element as HTMLSelectElement;
  const options=element.localName==='select'?Array.from(select.options):[];
  return {element,parent:element.parentNode,previous:element.previousSibling,next:element.nextSibling,
    attrs:attributes(element),text:element.localName==='textarea'?(element as HTMLTextAreaElement).defaultValue:element.textContent??'',
    form:element.form,type:element.localName==='input'?input.type:'',value:element.value,
    checked:element.localName==='input'?input.checked:false,selected:element.localName==='option'?(element as HTMLOptionElement).selected:false,
    number:element.localName==='input'?input.valueAsNumber:NaN,options,selectedOptions:options.map(option=>option.selected),
    files:element.localName==='input'?Array.from(input.files??[]):[],selection:selection(element)};
}
function attrEqual(a: Attributes,b: Attributes):boolean {return a.length===b.length&&a.every(([name,value],i)=>b[i]?.[0]===name&&b[i]?.[1]===value);}

/** Capture before component code. No public signal authority or live writer. */
export class AdoptionControls {
  private host: Element | undefined;
  private document: Document | undefined;
  private readonly owned=new Set<Control>();
  private readonly snapshots=new Map<Control,Snapshot>();
  private readonly groups:Group[]=[];
  private readonly optgroups=new Map<Element,{attrs:Attributes;parent:Node|null;previous:Node|null;next:Node|null}>();
  private readonly bindings:Binding[]=[];
  private observations:readonly ControlObservation[]|undefined;
  private focus:Element|null;
  constructor(host:Element) {
    this.host=host;this.document=host.ownerDocument;this.focus=this.document.activeElement;
    if(!this.document.contains(host))structure();
    const pending=[host];
    while(pending.length) {
      const element=pending.pop()!;
      if(element!==host&&element.hasAttribute('data-forma-island'))continue;
      if(control(element)){this.owned.add(element);this.snapshots.set(element,snapshot(element));}
      for(let child=element.lastElementChild;child;child=child.previousElementSibling)pending.push(child);
    }
    // An option/optgroup can be the island root. Its enclosing select and
    // sibling options remain observation-only peers, just like outside radios.
    for(const element of this.owned)if(element.localName==='option') {
      let parent=element.parentElement;
      while(parent&&parent.localName!=='select')parent=parent.parentElement;
      if(parent&&control(parent)&&!this.snapshots.has(parent))this.snapshots.set(parent,snapshot(parent));
    }
    const radios=Array.from(this.document.querySelectorAll<HTMLInputElement>('input')).filter(input=>input.type==='radio');
    for(const item of this.snapshots.values())if(item.type==='radio'&&(item.element as HTMLInputElement).name) {
      const name=(item.element as HTMLInputElement).name;
      if(this.groups.some(group=>group.name===name&&group.form===item.form))continue;
      const members=radios.filter(input=>input.name===name&&input.form===item.form);
      this.groups.push({name,form:item.form,members});
      for(const peer of members)if(!this.snapshots.has(peer))this.snapshots.set(peer,snapshot(peer));
    }
    // Select normalization observes every option/optgroup even when a nested
    // boundary means that option is not a bindable target of this island.
    for(const item of [...this.snapshots.values()])for(const option of item.options)if(!this.snapshots.has(option))this.snapshots.set(option,snapshot(option));
    for(const item of this.snapshots.values())for(const option of item.options){const group=option.parentElement;if(group?.localName==='optgroup'&&!this.optgroups.has(group))this.optgroups.set(group,{attrs:attributes(group),parent:group.parentNode,previous:group.previousSibling,next:group.nextSibling});}
    const ordered=[...this.snapshots].sort(([a],[b])=>a===b?0:a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    this.snapshots.clear();for(const [element,item]of ordered)this.snapshots.set(element,item);
  }
  add({element,key,initial:value,codec,kind='binding'}:ControlBinding):ControlToken {
    if(!this.host||this.observations||!control(element)||!this.owned.has(element))structure();
    if(kind!=='initial'&&kind!=='binding')structure();
    const tag=element.localName;
    if(!['value','checked','selected','text'].includes(key))structure();
    if((key==='checked'&&tag!=='input')||(key==='selected'&&tag!=='option')||(key==='text'&&tag!=='textarea'))structure();
    if(this.bindings.some(binding=>binding.snapshot.element===element&&(binding.key===key||((key==='text'||key==='value')&&(binding.key==='text'||binding.key==='value')))))structure();
    const token=Object.freeze({}) as ControlToken;
    this.bindings.push({snapshot:this.snapshots.get(element)!,key,initial:initial(value),codec,kind,token});return token;
  }
  private mirror(expected:boolean):Map<Control,Control> {
    const doc=this.document!.implementation.createHTMLDocument(),map=new Map<Control,Control>(),forms=new Map<HTMLFormElement,HTMLFormElement>();
    const bound=(element:Control,key:Key)=>expected?this.bindings.find(binding=>binding.snapshot.element===element&&binding.key===key):undefined;
    const copyAttrs=(element:Element,attrs:Attributes):void=>{for(const [name,value]of attrs)if(MODEL_ATTRS.has(name))element.setAttribute(name,value);};
    const applyAttr=(clone:Element,key:string,value:Initial):void=>{
      // Native initial attributes: true is bare; false/nullish are absent.
      if(value==null||value===false)clone.removeAttribute(key);else clone.setAttribute(key,value===true?'':text(value));
    };
    const make=(item:Snapshot):Control=>{
      const clone=doc.createElement(item.element.localName) as Control;copyAttrs(clone,item.attrs);
      if(clone.localName==='textarea') (clone as HTMLTextAreaElement).defaultValue=item.text;
      if(clone.localName==='option')clone.textContent=item.text;
      const value=bound(item.element,'value')??bound(item.element,'text');
      if(value&&clone.localName!=='select') {
        if(clone.localName==='textarea')(clone as HTMLTextAreaElement).defaultValue=text(value.initial);
        else applyAttr(clone,'value',value.initial);
      }
      for(const key of ['checked','selected'] as const){const binding=bound(item.element,key);if(binding)applyAttr(clone,key,binding.initial);}
      map.set(item.element,clone);return clone;
    };
    for(const item of this.snapshots.values())if(item.element.localName!=='option') {
      const clone=make(item);
      if(clone.localName==='select') {
        const groups=new Map<Element,HTMLOptGroupElement>();
        for(const option of item.options) {
          const optionClone=make(this.snapshots.get(option)!);const parent=this.snapshots.get(option)!.parent as Element|null;
          if(parent?.localName==='optgroup') {
            let group=groups.get(parent);if(!group){group=doc.createElement('optgroup');copyAttrs(group,this.optgroups.get(parent)!.attrs);groups.set(parent,group);clone.appendChild(group);}group.appendChild(optionClone);
          }else clone.appendChild(optionClone);
        }
        const value=bound(item.element,'value');
        if(value) {
          const select=clone as HTMLSelectElement;
          if(select.multiple&&Array.isArray(value.initial)) {const wanted=new Set(value.initial);for(const option of Array.from(select.options))option.selected=wanted.has(option.value);}
          else select.value=text(value.initial);
        }
      }
      let parent:HTMLElement=doc.body;
      if(item.form){let form=forms.get(item.form);if(!form){form=doc.createElement('form');forms.set(item.form,form);doc.body.appendChild(form);}parent=form;}
      parent.appendChild(clone);
    }
    for(const item of this.snapshots.values())if(!map.has(item.element))doc.body.appendChild(make(item));
    return map;
  }
  private observed(element:Control,key:Key):unknown {
    if(key==='checked')return (element as HTMLInputElement).checked;
    if(key==='selected')return (element as HTMLOptionElement).selected;
    if(element.localName==='select')return Array.from((element as HTMLSelectElement).options,option=>option.selected);
    return element.value;
  }
  private live(binding:Binding):unknown {
    const {snapshot:item,key}=binding;
    return key==='checked'?item.checked:key==='selected'?item.selected:item.element.localName==='select'?item.selectedOptions:item.value;
  }
  private rawValue(binding:Binding):unknown {
    const {snapshot:item,key}=binding;
    if(key==='checked'||key==='selected')return this.live(binding);
    if(item.element.localName==='select'&&(item.element as HTMLSelectElement).multiple)return Object.freeze(item.options.filter((_,i)=>item.selectedOptions[i]).map(option=>this.snapshots.get(option)!.value));
    return item.value;
  }
  private converted(binding:Binding):unknown {
    const {snapshot:item,key,codec}=binding,tag=item.element.localName;
    if(key==='checked'||key==='selected') {if(codec!=='boolean')return target();return this.live(binding);}
    if(item.type==='file')return target();
    if(codec==='number') {if(tag!=='input'||!['number','range'].includes(item.type)||!Number.isFinite(item.number))return target();return item.number;}
    if(codec==='string-array') {
      if(tag!=='select'||!(item.element as HTMLSelectElement).multiple)return target();
      return Object.freeze(item.options.filter((_,i)=>item.selectedOptions[i]).map(option=>this.snapshots.get(option)!.value));
    }
    if(codec!=='string'||(tag==='select'&&(item.element as HTMLSelectElement).multiple))return target();
    return item.value;
  }
  finish():readonly ControlObservation[] {
    if(!this.host)structure();this.check();if(this.observations)return this.observations;
    const defaults=this.mirror(false),expected=this.mirror(true);
    // WebKit's parser and native detached construction disagree for an
    // implicit single-select winner inside a disabled optgroup. No captured
    // property can distinguish that parser default from an early edit. Refuse
    // only selection observations affected by the two competing candidates.
    for(const binding of this.bindings) {
      const clone=defaults.get(binding.snapshot.element)!;
      const select=clone.localName==='select'?clone as HTMLSelectElement:binding.key==='selected'?clone.closest('select'):null;
      if(!select||select.multiple||select.size>1)continue;
      const options=Array.from(select.options);
      if(options.some(option=>option.hasAttribute('selected')))continue;
      const first=options.find(option=>!option.disabled);
      const enabled=options.find(option=>!option.disabled&&!(option.parentElement?.localName==='optgroup'&&(option.parentElement as HTMLOptGroupElement).disabled));
      if(first&&enabled&&first!==enabled&&(clone===select||clone===first||clone===enabled))mismatch();
    }
    // Never report/seed an early edit until every server default is validated.
    for(const binding of this.bindings) {
      const a=this.observed(defaults.get(binding.snapshot.element)!,binding.key),b=this.observed(expected.get(binding.snapshot.element)!,binding.key);
      if(Array.isArray(a)&&Array.isArray(b)?!same(a,b):!Object.is(a,b))mismatch();
    }
    const result=this.bindings.map(binding=>{
      const baseline=this.observed(defaults.get(binding.snapshot.element)!,binding.key),live=this.live(binding);
      const edited=(Array.isArray(baseline)&&Array.isArray(live)?!same(baseline,live):!Object.is(baseline,live))||(binding.snapshot.type==='file'&&binding.snapshot.files.length>0);
      // Literal initialization has no reader or seed authority. The owner must
      // preserve its edit; reactive readers still require a reversible codec.
      return Object.freeze({token:binding.token,kind:binding.kind,edited,value:edited&&binding.kind==='binding'?this.converted(binding):this.rawValue(binding)});
    });
    this.observations=Object.freeze(result);return this.observations;
  }
  check():void {
    if(!this.host||!this.document||this.host.ownerDocument!==this.document||!this.document.contains(this.host))structure();
    const radios=Array.from(this.document.querySelectorAll<HTMLInputElement>('input')).filter(input=>input.type==='radio');
    for(const group of this.groups)if(!same(group.members,radios.filter(input=>input.name===group.name&&input.form===group.form)))structure();
    for(const [group,old]of this.optgroups){if(group.parentNode!==old.parent||group.previousSibling!==old.previous||group.nextSibling!==old.next)structure();if(!attrEqual(attributes(group),old.attrs))mismatch();}
    for(const item of this.snapshots.values()) {
      const current=snapshot(item.element);
      if(current.parent!==item.parent||current.previous!==item.previous||current.next!==item.next||current.form!==item.form||current.type!==item.type||!same(current.options,item.options))structure();
      if(!attrEqual(current.attrs,item.attrs)||current.text!==item.text||current.value!==item.value||current.checked!==item.checked||current.selected!==item.selected||!same(current.selectedOptions,item.selectedOptions)||!same(current.files,item.files)||!same(current.selection,item.selection))mismatch();
    }
    if(this.document.activeElement!==this.focus&&this.focus&&this.owned.has(this.focus as Control))mismatch();
  }
  release():void {this.host=undefined;this.document=undefined;this.focus=null;this.owned.clear();this.snapshots.clear();this.groups.length=0;this.optgroups.clear();this.bindings.length=0;this.observations=undefined;}
}
