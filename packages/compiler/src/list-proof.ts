/** Original-source proof for keyed SSR LISTs. This is source bookkeeping only:
 * it never contributes coordinates, names or shape facts to identity bytes. */
import {parse} from '@babel/parser';
import _traverse, {type Binding, type NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {dirname} from 'node:path';
import {resolveExportedFunction, returnExpressionOf, type ComponentFunction} from './export-resolver';
import {resolveFilePath, type ModuleLoader} from './module-loader';
import {readSourceFile} from './source-snapshot';
import {originalPosition} from './diagnostics';
import {isCoreCall} from './entry-policy';
import {PropsSchemaError} from './props-schema';
import {MAX_KEY_SEGMENTS} from './fmir-constants';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
const callable=(node:t.Node|null|undefined):node is ComponentFunction=>t.isFunctionDeclaration(node)||t.isFunctionExpression(node)||t.isArrowFunctionExpression(node);
const unwrap=(input:t.Node):t.Node=>{let node=input;while(t.isTSAsExpression(node)||t.isTSTypeAssertion(node)||t.isTSNonNullExpression(node)||t.isTSSatisfiesExpression(node)||t.isParenthesizedExpression(node))node=node.expression;return node;};
const field=(node:t.Node):string|undefined=>t.isIdentifier(node)||t.isJSXIdentifier(node)?node.name:t.isStringLiteral(node)?node.value:undefined;
export interface ListProof {readonly file:string;readonly start:number;readonly end:number;readonly key:readonly string[];readonly root:{file:string;start:number;end:number}}
/** A resolved original core `createList` site. Resolution is separate from proof so the legacy
 * shape checks (BUILD-107 in the walker, the BUILD-610 callback check in island analysis) keep
 * their precedence: `prove()` runs only after a call has all three arguments in their old form. */
export interface ListSite {readonly file:string;readonly start:number;readonly end:number;prove():ListProof}
interface Module {file:string;source:string;paths:Map<t.Node,NodePath>;calls:NodePath<t.CallExpression>[];functions:Map<number,ComponentFunction>}
const rawLoad:ModuleLoader=(from,specifier)=>{
 if(!specifier.startsWith('.')&&!specifier.startsWith('/'))return null;
 const file=resolveFilePath(dirname(from),specifier);return file?{path:file,source:readSourceFile(file)}:null;
};
export function createListProofs(loadModule:ModuleLoader=rawLoad) {
 const modules=new Map<string,Module>();
 function module(file:string,source:string):Module {
  const old=modules.get(file);if(old){if(old.source!==source)throw new Error('LIST proof source snapshot changed');return old;}
  const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']}),paths=new Map<t.Node,NodePath>(),calls:NodePath<t.CallExpression>[]=[],functions=new Map<number,ComponentFunction>();
  traverse(ast,{enter(path){paths.set(path.node,path);if(callable(path.node))functions.set(path.node.start!,path.node);},CallExpression(path){if(isCoreCall(path,'createList'))calls.push(path);}});
  const result={file,source,paths,calls,functions};modules.set(file,result);return result;
 }
 function fail(mod:Module,node:t.Node,code:'BUILD-612'|'BUILD-613',detail:string):never {
  throw new PropsSchemaError(mod.file,node.loc?.start.line??1,(node.loc?.start.column??0)+1,detail,code);
 }
 function binding(mod:Module,node:t.Node,code:'BUILD-612'|'BUILD-613'):Binding {
  const name=field(node), found=name?mod.paths.get(node)?.scope.getBinding(name):undefined;
  if(!found||found.constantViolations.length)fail(mod,node,code,'LIST proof requires an immutable resolved lexical binding');
  return found;
 }
 function core(mod:Module,node:t.Node):string|undefined {
  const name=field(node);if(!name)return undefined;
  const found=mod.paths.get(node)?.scope.getBinding(name),decl=found?.path.node,owner=found?.path.parentPath?.node;
  if(!found?.constant||!t.isImportSpecifier(decl)||decl.importKind==='type'||!t.isImportDeclaration(owner)||owner.importKind==='type'||!['@getforma/core','formajs'].includes(owner.source.value))return undefined;
  return field(decl.imported);
 }
 function keyPath(mod:Module,node:t.Node,row:Binding,active=new Set<Binding>()):string[] {
  node=unwrap(node);
  if(t.isMemberExpression(node)) {
   const name=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
   if(name===undefined)fail(mod,node,'BUILD-612','LIST key needs literal row property names, not computed values or indexes');
   const path=keyPath(mod,node.object,row,active);path.push(name);
   if(path.length>MAX_KEY_SEGMENTS)fail(mod,node,'BUILD-612','LIST key path exceeds32 segments');
   return path;
  }
  if(t.isIdentifier(node)) {
   const found=binding(mod,node,'BUILD-612');if(found===row)return [];
   const decl=found.path.node;
   if(t.isVariableDeclarator(decl)&&t.isIdentifier(decl.id)&&decl.init&&!active.has(found)) {
    active.add(found);try{return keyPath(mod,decl.init,row,active);}finally{active.delete(found);}
   }
  }
  fail(mod,node,'BUILD-612','LIST key must be a nonempty property path of its own row parameter, such as row.id');
 }
 function resolveFunction(mod:Module,node:t.Node,active=new Set<Binding>()):{mod:Module;fn:ComponentFunction} {
  node=unwrap(node);if(callable(node))return {mod,fn:node};
  const found=binding(mod,node,'BUILD-613'),decl=found.path.node;
  if(active.has(found))fail(mod,node,'BUILD-613','cyclic row-root helper alias');active.add(found);
  if(callable(decl))return {mod,fn:decl};
  if(t.isVariableDeclarator(decl)&&decl.init)return resolveFunction(mod,decl.init,active);
  if(t.isImportSpecifier(decl)||t.isImportDefaultSpecifier(decl)) {
   const owner=found.path.parentPath?.node;
   if(t.isImportDeclaration(owner)&&owner.importKind!=='type'&&(!t.isImportSpecifier(decl)||decl.importKind!=='type')) {
    const loaded=loadModule(mod.file,owner.source.value);
    if(loaded){const imported=t.isImportDefaultSpecifier(decl)?'default':field(decl.imported)!;
     const result=resolveExportedFunction(loaded.source,loaded.path,imported,{loadModule});
     if(result.kind==='found'){const target=module(result.filePath,result.source);return {mod:target,fn:target.functions.get(result.fn.start!)!};}
    }
   }
  }
  fail(mod,node,'BUILD-613','LIST row root must resolve to one owned Element through an ordinary lexical helper');
 }
 type Root={file:string;start:number;end:number};
 function props(mod:Module,node:t.Node|null|undefined):void {
  if(!node||t.isNullLiteral(node))return;
  if(!t.isObjectExpression(node))fail(mod,node,'BUILD-613','row-root props must be explicit; data-forma-key is reserved');
  for(const prop of node.properties){
   if(!t.isObjectProperty(prop)||prop.computed)fail(mod,prop,'BUILD-613','row-root spread/computed attributes cannot prove reserved key ownership');
   if(field(prop.key)?.toLowerCase()==='data-forma-key')fail(mod,prop,'BUILD-613','data-forma-key is reserved for the compiler-proved row identity');
  }
 }
 function roots(mod:Module,input:t.Node,active:Set<string>):Root[] {
  const node=unwrap(input);
  if(t.isNullLiteral(node)||t.isBooleanLiteral(node)||t.isStringLiteral(node,{value:''})||t.isJSXEmptyExpression(node))return [];
  if(t.isJSXExpressionContainer(node))return roots(mod,node.expression,active);
  if(t.isJSXFragment(node))return t.react.buildChildren(node).flatMap(child=>roots(mod,child,active));
  if(t.isJSXElement(node)) {
   const name=node.openingElement.name;
   if(!t.isJSXIdentifier(name))fail(mod,name,'BUILD-613','row root requires a lexical component or intrinsic tag');
   if(/^[a-z]/.test(name.name)) {
    for(const attr of node.openingElement.attributes){
     if(t.isJSXSpreadAttribute(attr)||!t.isJSXIdentifier(attr.name))fail(mod,attr,'BUILD-613','row-root attributes must prove reserved key ownership');
     if(attr.name.name.toLowerCase()==='data-forma-key')fail(mod,attr,'BUILD-613','data-forma-key is reserved for the compiler-proved row identity');
    }
    return [{file:mod.file,start:node.start!,end:node.end!}];
   }
   return helper(mod,name,active);
  }
  if(t.isCallExpression(node)) {
   const call=core(mod,node.callee);
   if(call==='h') {
    const tag=node.arguments[0],attributes=node.arguments[1];
    if(tag&&t.isStringLiteral(tag)){props(mod,attributes);return [{file:mod.file,start:node.start!,end:node.end!}];}
    if(tag&&core(mod,tag)==='Fragment')return node.arguments.slice(2).flatMap(child=>roots(mod,child,active));
    if(tag){props(mod,attributes);return helper(mod,tag,active);}
   }
   if(call==='Fragment')return node.arguments.flatMap(child=>roots(mod,child,active));
   if(call==='createShow'||call==='createList')fail(mod,node,'BUILD-613','row control markers must be inside a stable owned Element');
   if(t.isIdentifier(node.callee))return helper(mod,node.callee,active);
  }
  fail(mod,node,'BUILD-613','LIST row must have exactly one stable owned Element; text, empty, multiple and conditional roots are unsupported');
 }
 function helper(mod:Module,node:t.Node,active:Set<string>):Root[] {
  const target=resolveFunction(mod,node),id=`${target.mod.file}\0${target.fn.start}`;
  if(active.has(id)||active.size>=64)fail(mod,node,'BUILD-613','recursive or excessive row-root helper chain');
  const value=returnExpressionOf(target.fn);if(!value)fail(target.mod,target.fn,'BUILD-613','row helper has no single provable return');
  active.add(id);try{return roots(target.mod,value,active);}finally{active.delete(id);}
 }
 function prove(mod:Module,path:NodePath<t.CallExpression>):ListProof {
  const call=path.node,[,key,row]=call.arguments;
  if(!callable(key)||!t.isIdentifier(key.params[0]))fail(mod,key??call,'BUILD-612','LIST key must be an inline function with a named row parameter');
  const body=returnExpressionOf(key);if(!body)fail(mod,key,'BUILD-612','LIST key function needs a single property-path return');
  const parameter=binding(mod,key.params[0],'BUILD-612'),keyParts=keyPath(mod,body,parameter);
  if(!keyParts.length)fail(mod,body,'BUILD-612','LIST key cannot be the row itself; use a nonempty path such as row.id');
  if(!callable(row)||!t.isIdentifier(row.params[0]))fail(mod,row??call,'BUILD-613','LIST row needs an inline callback with a named item');
  const result=returnExpressionOf(row);if(!result)fail(mod,row,'BUILD-613','LIST row has no single provable return');
  const found=roots(mod,result,new Set());if(found.length!==1)fail(mod,result,'BUILD-613','LIST row must contain exactly one stable owned Element');
  return {file:mod.file,start:call.start!,end:call.end!,key:keyParts,root:found[0]!};
 }
 function site(mod:Module,path:NodePath<t.CallExpression>):ListSite {
  return {file:mod.file,start:path.node.start!,end:path.node.end!,prove:()=>prove(mod,path)};
 }
 return {
  original(file:string,source:string,node:t.CallExpression):ListSite {
   const mod=module(file,source),path=mod.calls.find(path=>path.node.start===node.start&&path.node.end===node.end);
   if(!path)fail(mod,node,'BUILD-612','LIST call does not resolve to the original core createList import');
   return site(mod,path);
  },
  lowered(file:string,node:t.CallExpression):ListSite|undefined {
   const mod=module(file,readSourceFile(file)),at=originalPosition(file,node.loc?.start??{line:1,column:0});
   const matches=mod.calls.filter(path=>path.node.loc?.start.line===at.line&&path.node.loc.start.column+1===at.column);
   if(matches.length>1)fail(mod,matches[0]!.node,'BUILD-612','lowered LIST position has ambiguous original source identity');
   return matches.length?site(mod,matches[0]!):undefined;
  },
 };
}
