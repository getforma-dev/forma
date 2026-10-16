/** Original lexical proof of the Element owned by an SSR registration.
 * Source locations are diagnostic bookkeeping, never canonical identity data. */
import {parse} from '@babel/parser';
import _traverse,{type Binding,type NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {resolveExportedFunction,type ComponentFunction} from './export-resolver';
import type {ModuleLoader} from './module-loader';
import {PropsSchemaError} from './props-schema';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
const callable=(node:t.Node|null|undefined):node is ComponentFunction=>t.isFunctionDeclaration(node)||t.isFunctionExpression(node)||t.isArrowFunctionExpression(node);
const unwrap=(input:t.Node):t.Node=>{let node=input;while(t.isTSAsExpression(node)||t.isTSTypeAssertion(node)||t.isTSNonNullExpression(node)||t.isTSSatisfiesExpression(node)||t.isParenthesizedExpression(node))node=node.expression;return node;};
const name=(node:t.Node):string|undefined=>t.isIdentifier(node)||t.isJSXIdentifier(node)?node.name:t.isStringLiteral(node)?node.value:undefined;
interface Module {file:string;source:string;paths:Map<t.Node,NodePath>;functions:Map<number,ComponentFunction>}
export function createIslandRootProofs(load:ModuleLoader,isRegistered:(identity:string)=>boolean) {
 const modules=new Map<string,Module>();
 function module(file:string,source:string):Module {
  const old=modules.get(file);if(old){if(old.source!==source)throw new Error('island root proof source changed');return old;}
  const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']}),paths=new Map<t.Node,NodePath>(),functions=new Map<number,ComponentFunction>();
  traverse(ast,{enter(path){paths.set(path.node,path);if(callable(path.node))functions.set(path.node.start!,path.node);}});
  const result={file,source,paths,functions};modules.set(file,result);return result;
 }
 function fail(mod:Module,node:t.Node,detail:string):never {throw new PropsSchemaError(mod.file,node.loc?.start.line??1,(node.loc?.start.column??0)+1,detail,'BUILD-621');}
 function binding(mod:Module,node:t.Node):Binding {
  const key=name(node),value=key?mod.paths.get(node)?.scope.getBinding(key):undefined;
  if(!value||!value.constant||value.constantViolations.length)fail(mod,node,'island root needs an immutable lexical helper or an intrinsic Element');
  return value;
 }
 function core(mod:Module,node:t.Node):string|undefined {
  const key=name(node),value=key?mod.paths.get(node)?.scope.getBinding(key):undefined,decl=value?.path.node,owner=value?.path.parentPath?.node;
  return value?.constant&&t.isImportSpecifier(decl)&&decl.importKind!=='type'&&t.isImportDeclaration(owner)&&owner.importKind!=='type'&&['@getforma/core','formajs'].includes(owner.source.value)?name(decl.imported):undefined;
 }
 function resolve(mod:Module,input:t.Node,seen=new Set<Binding>()):{mod:Module;fn:ComponentFunction} {
  const node=unwrap(input);if(callable(node))return {mod,fn:node};
  const found=binding(mod,node),decl=found.path.node;
  if(seen.has(found))fail(mod,node,'cyclic island root helper alias');seen.add(found);
  if(callable(decl))return {mod,fn:decl};
  if(t.isVariableDeclarator(decl)&&decl.init)return resolve(mod,decl.init,seen);
  if(t.isImportSpecifier(decl)||t.isImportDefaultSpecifier(decl)) {
   const owner=found.path.parentPath?.node;
   if(t.isImportDeclaration(owner)&&owner.importKind!=='type'&&(!t.isImportSpecifier(decl)||decl.importKind!=='type')) {
    const loaded=load(mod.file,owner.source.value);
    if(loaded){const result=resolveExportedFunction(loaded.source,loaded.path,t.isImportDefaultSpecifier(decl)?'default':name(decl.imported)!,{loadModule:load});
     if(result.kind==='found'){const target=module(result.filePath,result.source);return {mod:target,fn:target.functions.get(result.fn.start!)!};}
    }
   }
  }
  fail(mod,node,'cannot prove island root through this helper; return one authored Element');
 }
 function containsReturn(node:t.Node):boolean {
  if(t.isReturnStatement(node))return true;if(t.isFunction(node))return false;
  return (t.VISITOR_KEYS[node.type]??[]).some(key=>{const value=(node as any)[key];return (Array.isArray(value)?value:[value]).some(child=>child&&typeof child.type==='string'&&containsReturn(child));});
 }
 function returned(mod:Module,fn:ComponentFunction):t.Expression {
  if(!t.isBlockStatement(fn.body))return fn.body;
  for(const statement of fn.body.body) {
   if(t.isReturnStatement(statement)){if(statement.argument)return statement.argument;break;}
   if(containsReturn(statement))fail(mod,statement,'island root has a conditional return path; keep conditions inside one owned Element');
  }
  fail(mod,fn,'island has no single provable Element return');
 }
 function helper(mod:Module,node:t.Node,active:Set<string>):number {
  const target=resolve(mod,node),identity=`${target.mod.file}\0${target.fn.start}`;
  if(active.has(identity))throw new PropsSchemaError(mod.file,node.loc?.start.line??1,(node.loc?.start.column??0)+1,'recursive registered island root helper');
  if(isRegistered(identity))fail(mod,node,'another registered island owns this root; add an Element owned by this island around the child');
  if(active.has(identity)||active.size>=64)fail(mod,node,'recursive or excessive island root helper chain');
  active.add(identity);try{return roots(target.mod,returned(target.mod,target.fn),active);}finally{active.delete(identity);}
 }
 function roots(mod:Module,input:t.Node,active:Set<string>):number {
  const node=unwrap(input);
  if(t.isNullLiteral(node)||t.isBooleanLiteral(node)||t.isStringLiteral(node,{value:''})||t.isJSXEmptyExpression(node))return 0;
  if(t.isJSXExpressionContainer(node))return roots(mod,node.expression,active);
  if(t.isJSXFragment(node))return t.react.buildChildren(node).reduce((sum,child)=>sum+roots(mod,child,active),0);
  if(t.isJSXElement(node)) {
   const tag=node.openingElement.name;
   if(!t.isJSXIdentifier(tag))fail(mod,tag,'island root needs a lexical component or intrinsic Element');
   if(core(mod,tag)==='Fragment')return t.react.buildChildren(node).reduce((sum,child)=>sum+roots(mod,child,active),0);
   if(tag.name==='Fragment')fail(mod,tag,'the native Fragment spelling must resolve to the original core Fragment import');
   if(/^[a-z]/.test(tag.name)){if(!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(tag.name))fail(mod,tag,'island root tag is outside the native Element-name grammar');return 1;}
   return helper(mod,tag,active);
  }
  if(t.isCallExpression(node)) {
   const called=core(mod,node.callee);
   if(called==='h') {
    const tag=node.arguments[0];if(t.isStringLiteral(tag)){if(!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(tag.value))fail(mod,tag,'island root tag is outside the native Element-name grammar');return 1;}
    if(tag&&core(mod,tag)==='Fragment')return node.arguments.slice(2).reduce((sum,child)=>sum+roots(mod,child,active),0);
    if(t.isIdentifier(tag,{name:'Fragment'}))fail(mod,tag,'the native Fragment spelling must resolve to the original core Fragment import');
    if(tag)return helper(mod,tag,active);
   }
   if(called==='Fragment')return node.arguments.reduce((sum,child)=>sum+roots(mod,child,active),0);
   if(t.isIdentifier(node.callee,{name:'Fragment'}))fail(mod,node,'the native Fragment spelling must resolve to the original core Fragment import');
   if(called==='createShow'||called==='createList')fail(mod,node,'island control markers must be inside its owned Element, even when one request produces one root');
   if(t.isIdentifier(node.callee))return helper(mod,node.callee,active);
  }
  fail(mod,node,'SSR island must return exactly one stable owned Element; text, empty, multiple and conditional roots are unsupported');
 }
 return (source:string,file:string,fn:ComponentFunction):void=>{
  const mod=module(file,source),original=mod.functions.get(fn.start!);
  if(!original)fail(mod,fn,'island root declaration is absent from the original source');
  const value=returned(mod,original),found=roots(mod,value,new Set([`${file}\0${original.start}`]));
  if(found!==1)fail(mod,value,'SSR island must return exactly one stable owned Element; put fragments and ranges inside its host');
 };
}
