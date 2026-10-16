/** Finite HTML-context subset for 3.0.0. This is not a complete HTML validator.
 * Ancestors describe emitted nesting, so helpers never reset parser context. */
import * as t from '@babel/types';
import {parse} from '@babel/parser';
import _traverse from '@babel/traverse';
import {readSourceFile} from './source-snapshot';
import {PropsSchemaError} from './props-schema';
import {originalPosition} from './diagnostics';
import {foreignAttributeMismatch,type AttributeNamespace} from './attribute-name';

type Namespace='html'|'svg'|'math';
type Conditions=ReadonlyMap<symbol,boolean>;
interface Label {target:string|symbol|undefined;controls:Conditions[];repetition:number}
interface ElementContext {tag:string;namespace:Namespace;childNamespace:Namespace;attributeNamespaces:readonly AttributeNamespace[];attributeChildren:readonly AttributeNamespace[];label?:Label;labelControl:boolean}
export interface HtmlContext {ancestors:readonly ElementContext[];conditions:Conditions;repetition:number}
const UNKNOWN=Symbol('dynamic attribute');
const P_CLOSE=new Set('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form li dd dt plaintext table hr xmp'.split(' '));
// The in-body li/dt/dd scan stops at a special element other than these three.
const LIST_BARRIER=new Set('applet area article aside base basefont bgsound blockquote body br button caption center col colgroup details dialog dir div dl dt dd embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp'.split(' '));
const P_SCOPE=new Set('applet button caption html table td th marquee object template'.split(' '));
const ALWAYS_INTERACTIVE=new Set('button details embed iframe label select textarea'.split(' '));
const LABELABLE=new Set('button meter output progress select textarea'.split(' '));
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
const undefinedModules=new Map<string,{source:string;unbound:Set<string>}>();
function unboundUndefined(node:t.Node,file:string):boolean {
 // esbuild spells the global undefined as literal void 0 in transformed TSX.
 if(t.isUnaryExpression(node,{operator:'void'})&&t.isNumericLiteral(node.argument,{value:0}))return true;
 if(!t.isIdentifier(node,{name:'undefined'})||!node.loc)return false;
 try {
  const source=readSourceFile(file);let saved=undefinedModules.get(file);
  if(!saved||saved.source!==source){
   const unbound=new Set<string>(),ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
   traverse(ast,{Identifier(path){if(path.node.name==='undefined'&&!path.scope.getBinding('undefined'))unbound.add(`${path.node.loc!.start.line}:${path.node.loc!.start.column+1}`);}});
   saved={source,unbound};undefinedModules.set(file,saved);
  }
  const at=originalPosition(file,node.loc.start);return saved.unbound.has(`${at.line}:${at.column}`);
 }catch{return false;}
}
const key=(node:t.Node):string|undefined=>t.isIdentifier(node)||t.isStringLiteral(node)?(t.isIdentifier(node)?node.name:node.value):undefined;
function prop(props:t.Node|undefined,names:readonly string[],file:string):string|boolean|symbol|undefined {
 if(!t.isObjectExpression(props))return undefined;
 const values:(string|boolean|symbol|undefined)[]=[];
 for(const entry of props.properties) {
  if(!t.isObjectProperty(entry)||entry.computed)continue;
  const name=key(entry.key)?.toLowerCase();if(!name||!names.includes(name))continue;
  const value=entry.value;
  if(t.isNullLiteral(value)||t.isBooleanLiteral(value,{value:false})||unboundUndefined(value,file))values.push(undefined);
  else if(t.isStringLiteral(value))values.push(value.value);
  else if(t.isNumericLiteral(value))values.push(String(value.value));
  else if(t.isBooleanLiteral(value))values.push(value.value);
  else values.push(UNKNOWN);
 }
 // Native duplicate attributes can retain their first value while a JS object
 // retains its last. Disagreeing values cannot establish safe ancestry.
 return values.some(value=>value!==values[0])?UNKNOWN:values[0];
}
const present=(props:t.Node|undefined,name:string,file:string)=>prop(props,[name],file)!==undefined;
const hiddenInput=(props:t.Node|undefined,file:string):boolean=>{const type=prop(props,['type'],file);return typeof type==='string'&&type.toLowerCase()==='hidden';};
const interactive=(tag:string,props:t.Node|undefined,file:string):boolean=>ALWAYS_INTERACTIVE.has(tag)
 ||tag==='a'&&present(props,'href',file)||(tag==='audio'||tag==='video')&&present(props,'controls',file)
 ||tag==='img'&&present(props,'usemap',file)||tag==='input'&&!hiddenInput(props,file);
const labelable=(tag:string,props:t.Node|undefined,file:string)=>LABELABLE.has(tag)||tag==='input'&&!hiddenInput(props,file);
function compatible(a:Conditions,b:Conditions):boolean {for(const [key,value] of a)if(b.has(key)&&b.get(key)!==value)return false;return true;}
function fail(file:string,node:t.Node,code:'BUILD-610'|'BUILD-618'|'BUILD-619'|'BUILD-620',detail:string):never {
 const at=originalPosition(file,node.loc?.start??{line:1,column:0});throw new PropsSchemaError(file,at.line,at.column,detail,code);
}
export function htmlBranch(context:HtmlContext|undefined,branch:symbol,value:boolean):HtmlContext|undefined {
 return context?{...context,conditions:new Map([...context.conditions,[branch,value]])}:undefined;
}
export function htmlList(context:HtmlContext|undefined):HtmlContext|undefined {return context?{...context,repetition:context.repetition+1}:undefined;}
export function enterHtmlElement(parent:HtmlContext|undefined,tagName:string,props:t.Node|undefined,node:t.Node,file:string):HtmlContext {
 const context=parent??{ancestors:[],conditions:new Map(),repetition:0},ancestors=context.ancestors;
 const tag=tagName.toLowerCase(),parentFrame=ancestors.at(-1);
 let namespace=parentFrame?.childNamespace??'html';
 if(parentFrame?.namespace==='math'&&['mi','mo','mn','ms','mtext'].includes(parentFrame.tag)&&['mglyph','malignmark'].includes(tag))namespace='math';
 if(namespace==='html'&&tag==='svg')namespace='svg';else if(namespace==='html'&&tag==='math')namespace='math';
 let childNamespace=namespace;
 if(namespace==='svg'&&['foreignobject','desc','title'].includes(tag))childNamespace='html';
 if(namespace==='math'&&(['mi','mo','mn','ms','mtext'].includes(tag)||tag==='annotation-xml'&&(prop(props,['encoding'],file)===UNKNOWN||['text/html','application/xhtml+xml'].includes(String(prop(props,['encoding'],file)).toLowerCase()))))childNamespace='html';
 // An unknown annotation encoding may choose either parser namespace. Keep
 // this proof separate from the existing conservative ancestry approximation.
 let inherited:readonly AttributeNamespace[]=parentFrame?.attributeChildren??['html'];
 if(parentFrame&&['mi','mo','mn','ms','mtext'].includes(parentFrame.tag)&&['mglyph','malignmark'].includes(tag)&&parentFrame.attributeNamespaces.includes('math')){
  inherited=parentFrame.attributeNamespaces.every(value=>value==='math')?['math']:[...inherited,'math'];
 }
 const attributeNamespaces=[...new Set(inherited.map(ns=>{
  // The tree-construction dispatcher handles a direct svg child of MathML
  // annotation-xml with HTML rules regardless of the annotation's encoding.
  if(tag==='svg'&&(ns==='html'||parentFrame?.tag==='annotation-xml'&&parentFrame.attributeNamespaces.includes('math')))return 'svg';
  return ns==='html'&&tag==='math'?'math':ns;
 }))] as AttributeNamespace[];
 const attributeChildren=[...new Set(attributeNamespaces.flatMap((ns):AttributeNamespace[]=>{
  if(ns==='svg'&&['foreignobject','desc','title'].includes(tag)||ns==='math'&&['mi','mo','mn','ms','mtext'].includes(tag))return ['html'];
  if(ns==='math'&&tag==='annotation-xml'){
   const encoding=prop(props,['encoding'],file);
   if(encoding===UNKNOWN)return ['html','math'];
   if(['text/html','application/xhtml+xml'].includes(String(encoding).toLowerCase()))return ['html'];
  }
  return [ns];
 }))];
 if(t.isObjectExpression(props))for(const entry of props.properties){
  if(!t.isObjectProperty(entry)||entry.computed)continue;
  const name=key(entry.key);if(name===undefined||/^on/i.test(name)||name==='ref')continue;
  for(const ns of attributeNamespaces){const detail=foreignAttributeMismatch(name,ns);if(detail)fail(file,entry,'BUILD-610',detail);}
 }
 const htmlAncestors=ancestors.filter(frame=>frame.namespace==='html');
 let labelControl=false;
 if(namespace==='html') {
  if(tag==='title')fail(file,node,'BUILD-619','a component HTML <title> does not own the document title; pass the page title to the server render call');
  const refuse=(reason:string):never=>fail(file,node,'BUILD-618',`<${tagName}> ${reason}; write explicit sibling elements or move this content into its own valid host`);
  if(P_CLOSE.has(tag))for(let i=ancestors.length-1;i>=0;i--){const frame=ancestors[i]!;if(frame.namespace!=='html'||P_SCOPE.has(frame.tag))break;if(frame.tag==='p')refuse('would implicitly close its ancestor <p>');}
  if(tag==='a'&&htmlAncestors.some(frame=>frame.tag==='a'))refuse('is nested inside <a>');
  if(tag==='form'&&htmlAncestors.some(frame=>frame.tag==='form'))refuse('is nested inside <form>');
  if(tag==='li'||tag==='dt'||tag==='dd')for(let i=ancestors.length-1;i>=0;i--){const frame=ancestors[i]!;if(frame.namespace!=='html')break;if(tag==='li'?frame.tag==='li':frame.tag==='dt'||frame.tag==='dd')refuse(`would implicitly close its ancestor <${frame.tag}>`);if(LIST_BARRIER.has(frame.tag)&&!['address','div','p'].includes(frame.tag))break;}
  if(tag==='option'||tag==='optgroup') {
   const select=htmlAncestors.map(frame=>frame.tag).lastIndexOf('select');
   if(select<0)refuse('is outside <select> in the native subset');
   for(const frame of htmlAncestors.slice(select+1))if(frame.tag==='option'||tag==='optgroup'&&frame.tag==='optgroup')refuse(`would implicitly close its ancestor <${frame.tag}>`);
  }
  const isInteractive=interactive(tag,props,file),isLabelable=labelable(tag,props,file);
  if(isInteractive) {
   const outer=htmlAncestors.find(frame=>frame.tag==='a'||frame.tag==='button'||frame.labelControl);
   if(outer)refuse(`is interactive content inside <${outer.tag}>${outer.labelControl?' (the label\'s control)':''}`);
  }
  const label=[...htmlAncestors].reverse().find(frame=>frame.label)?.label;
  if(label&&(isInteractive||isLabelable)) {
   if(!isLabelable)refuse('is interactive content in a label beyond its labelled control');
   if(label.target!==undefined&&(typeof label.target!=='string'||prop(props,['id'],file)!==label.target))refuse('does not prove the explicit label\'s target control');
   if(context.repetition>label.repetition||label.controls.some(previous=>compatible(previous,context.conditions)))refuse('would give one label several controls');
   label.controls.push(context.conditions);labelControl=true;
  }
 }
 const target=tag==='label'?prop(props,['for','htmlfor'],file):undefined;
 const frame:ElementContext={tag,namespace,childNamespace,attributeNamespaces,attributeChildren,labelControl,...(namespace==='html'&&tag==='label'?{label:{target:typeof target==='string'?target:target===undefined?undefined:UNKNOWN,controls:[],repetition:context.repetition}}:{})};
 return {...context,ancestors:[...ancestors,frame]};
}
export function checkRawTextChildren(tag:string,children:readonly t.Node[],file:string):void {
 if(!['style','script'].includes(tag.toLowerCase()))return;
 for(const child of children) {
  let value=child;while(t.isTSAsExpression(value)||t.isTSTypeAssertion(value)||t.isTSNonNullExpression(value)||t.isTSSatisfiesExpression(value)||t.isParenthesizedExpression(value))value=value.expression;
  if(t.isStringLiteral(value)||t.isNumericLiteral(value)||t.isBooleanLiteral(value)||t.isNullLiteral(value))continue;
  if(unboundUndefined(value,file))continue;
  fail(file,child,'BUILD-620',`dynamic or reactive child of <${tag}> is executable CSS/JavaScript content; keep authored literal text here and pass data through ordinary text or declared attributes`);
 }
}
