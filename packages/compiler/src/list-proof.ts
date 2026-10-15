/** Original-source proof for keyed SSR LISTs. This is source bookkeeping only:
 * it never contributes coordinates, names or shape facts to identity bytes. */
import {parse} from '@babel/parser';
import _traverse, {type Binding, type NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {dirname} from 'node:path';
import {resolveExportedFunction, type ComponentFunction} from './export-resolver';
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
 function fail(mod:Module,node:t.Node,code:'BUILD-612'|'BUILD-613'|'BUILD-616',detail:string):never {
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
   if(name==='')fail(mod,node.property,'BUILD-612','LIST key segment must be a nonempty field name');
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
 /** The one return of a key, row or row-helper function: an expression body, or a block of
  * variable declarations plus exactly one `return` with a value. A second return path (an `if`,
  * a `try`, a loop) would make the key or the row shape depend on data, which DR-8 refuses at
  * build time rather than at adoption. */
 function singleReturn(mod:Module,fn:ComponentFunction,code:'BUILD-612'|'BUILD-613',what:string):t.Expression {
  if(!t.isBlockStatement(fn.body))return fn.body;
  let found:t.Expression|undefined;
  for(const statement of fn.body.body) {
   if(t.isVariableDeclaration(statement))continue;
   if(t.isReturnStatement(statement)&&statement.argument&&!found){found=statement.argument;continue;}
   fail(mod,statement,code,`${what} must have exactly one return path: an expression body, or variable declarations and one return`);
  }
  if(!found)fail(mod,fn,code,`${what} has no single provable return`);
  return found;
 }
 function helper(mod:Module,node:t.Node,active:Set<string>):Root[] {
  const target=resolveFunction(mod,node),id=`${target.mod.file}\0${target.fn.start}`;
  if(active.has(id)||active.size>=64)fail(mod,node,'BUILD-613','recursive or excessive row-root helper chain');
  const value=singleReturn(target.mod,target.fn,'BUILD-613','LIST row helper');
  active.add(id);try{return roots(target.mod,value,active);}finally{active.delete(id);}
 }
 /** The expression read by a core getter, when its initializer/return is visible. A
  * signal can hold a function, and a computed callback can return one; neither is
  * inherently data. Opaque results stay unknown rather than being refused. */
 function getterValue(mod:Module,node:t.Node):t.Node|undefined {
  if(!t.isIdentifier(node))return undefined;
  const found=mod.paths.get(node)?.scope.getBinding(node.name),decl=found?.path.node;
  if(!found||found.constantViolations.length||!t.isVariableDeclarator(decl)||!t.isCallExpression(decl.init))return undefined;
  const made=core(mod,decl.init.callee),initial=decl.init.arguments[0];
  if(!initial||t.isSpreadElement(initial)||t.isArgumentPlaceholder(initial))return undefined;
  if(made==='createSignal'&&t.isArrayPattern(decl.id)&&decl.id.elements[0]===found.identifier)return initial;
  if((made==='createComputed'||made==='createMemo')&&decl.id===found.identifier&&callable(unwrap(initial))) {
   const fn=unwrap(initial) as ComponentFunction;
   if(!t.isBlockStatement(fn.body))return fn.body;
   // Multiple/control-dependent returns have no single provable value.
   const statements=fn.body.body.filter(statement=>!t.isVariableDeclaration(statement));
   if(statements.length===1&&t.isReturnStatement(statements[0]))return statements[0].argument??undefined;
  }
  return undefined;
 }
 /** Follow only visible immutable values. For a member, require one unambiguous
  * property on a literal object; a spread/computed key could replace it. */
 function visibleValue(mod:Module,input:t.Node,active=new Set<Binding>(),depth=0):t.Node|undefined {
  if(depth>=64)return undefined;
  const node=unwrap(input);
  if(t.isIdentifier(node)) {
   const found=mod.paths.get(node)?.scope.getBinding(node.name),decl=found?.path.node;
   if(!found)return node;
   if(found.constantViolations.length||active.has(found))return undefined;
   if(t.isVariableDeclarator(decl)&&t.isIdentifier(decl.id)&&decl.init) {
    active.add(found);try{return visibleValue(mod,decl.init,active,depth+1);}finally{active.delete(found);}
   }
   return undefined;
  }
  if(t.isCallExpression(node)) {
   const value=getterValue(mod,unwrap(node.callee));
   return value?visibleValue(mod,value,active,depth+1):undefined;
  }
  if(t.isMemberExpression(node)) {
   const name=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
   const object=visibleValue(mod,node.object,active,depth+1);
   if(name===undefined||!t.isObjectExpression(object)||object.properties.some(property=>!t.isObjectProperty(property)||property.computed))return undefined;
   const properties=object.properties.filter(property=>t.isObjectProperty(property)&&field(property.key)===name) as t.ObjectProperty[];
   return properties.length===1?visibleValue(mod,properties[0]!.value,active,depth+1):undefined;
  }
  return node;
 }
 /** An exported binding's declaration in a module: `export const x = …`, `export function x`, or
  * `export { local as x }` of a local declaration. Undefined for a re-export or anything else. */
 function exported(mod:Module,name:string):{mod:Module;node:t.Node}|undefined {
  const program=[...mod.paths.values()].find(path=>path.isProgram()) as NodePath<t.Program>|undefined;
  for(const statement of program?.node.body??[]) {
   if(!t.isExportNamedDeclaration(statement)||statement.exportKind==='type')continue;
   const decl=statement.declaration;
   if(t.isFunctionDeclaration(decl)&&decl.id?.name===name)return {mod,node:decl};
   if(t.isVariableDeclaration(decl))for(const item of decl.declarations)if(t.isIdentifier(item.id)&&item.id.name===name&&item.init) {
    const local=program!.scope.getBinding(name);
    if(!local||local.constantViolations.length)return undefined;
    return {mod,node:item.init};
   }
   if(!statement.source)for(const spec of statement.specifiers)if(t.isExportSpecifier(spec)&&field(spec.exported)===name){
    const local=program!.scope.getBinding(spec.local.name),node=local?.path.node;
    if(!local||local.constantViolations.length)return undefined;
    if(t.isFunctionDeclaration(node))return {mod,node};
    if(t.isVariableDeclarator(node)&&t.isIdentifier(node.id)&&node.init)return {mod,node:node.init};
   }
  }
  return undefined;
 }
 const literal=(mod:Module,node:t.Node):string|undefined=>t.isArrayExpression(node)?'an array':t.isObjectExpression(node)?'an object'
  :t.isLiteral(node)||t.isIdentifier(node,{name:'undefined'})&&!mod.paths.get(node)?.scope.getBinding('undefined')?'a literal value':undefined;
 const dataType=(type:t.Node|null|undefined):boolean=>!!type&&(t.isTSArrayType(type)||t.isTSTupleType(type)
  ||t.isTSStringKeyword(type)||t.isTSNumberKeyword(type)||t.isTSBooleanKeyword(type)||t.isTSLiteralType(type)
  ||t.isTSTypeReference(type)&&t.isIdentifier(type.typeName)&&['Array','ReadonlyArray','Date'].includes(type.typeName.name)
  ||t.isTSTypeOperator(type)&&dataType(type.typeAnnotation)
  ||t.isTSUnionType(type)&&type.types.every(member=>dataType(member)||t.isTSUndefinedKeyword(member)||t.isTSNullKeyword(member)));
 /**
  * F1 (FORMA-183's parity harness): core's createList calls its source to read the rows, so a
  * source the compiler can prove is not a function refuses with BUILD-616: a literal (an array, an
  * object, a string, a number…), a binding whose value is one (a local `const`, or a named export
  * of an imported module), a provably data-valued core getter result or field (`rows()`,
  * `data().rows`), or a field that an inline parameter annotation types as data (`p.rows` with
  * `p: {rows: Row[]}`). A function, a getter, and anything the compiler cannot see through (an
  * untyped parameter's field, another call's result) stay admitted. The refusal names the call's
  * own argument, wherever the literal was declared.
  */
 function source(mod:Module,node:t.Node,at:t.Node,active=new Set<Binding>()):void {
  node=unwrap(node);
  if(callable(node))return;
  const refuse=(what:string):never=>fail(mod,at,'BUILD-616',`LIST source is ${what}, not a function: core calls it to read the rows, so pass the getter itself or a function returning them, such as () => rows`);
  const value=literal(mod,node);if(value)refuse(value);
  let origin=node;
  while(t.isMemberExpression(origin))origin=unwrap(origin.object);
  if(t.isCallExpression(origin)&&getterValue(mod,unwrap(origin.callee))) {
   const resolved=visibleValue(mod,node),data=resolved?literal(mod,resolved):undefined;
   if(data)refuse(`${data} read from a getter or field`);
  }
  if(t.isMemberExpression(node)) {
   const name=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
   const object=unwrap(node.object);
   if(name!==undefined&&t.isIdentifier(object)) {
    const found=mod.paths.get(object)?.scope.getBinding(object.name);
    const annotation=found?.kind==='param'&&t.isIdentifier(found.path.node)?found.path.node.typeAnnotation:undefined;
    const literalType=t.isTSTypeAnnotation(annotation)&&t.isTSTypeLiteral(annotation.typeAnnotation)?annotation.typeAnnotation:undefined;
    const member=literalType?.members.find(item=>t.isTSPropertySignature(item)&&field(item.key)===name) as t.TSPropertySignature|undefined;
    if(dataType(member?.typeAnnotation?.typeAnnotation))refuse(`a field its parameter's type declares as data (${object.name}.${name})`);
   }
   return;
  }
  if(!t.isIdentifier(node))return;
  const found=mod.paths.get(node)?.scope.getBinding(node.name);
  if(!found||found.constantViolations.length||active.has(found))return;
  active.add(found);
  const decl=found.path.node;
  if(t.isVariableDeclarator(decl)&&t.isIdentifier(decl.id)&&decl.init){source(mod,decl.init,at,active);return;}
  if(t.isImportSpecifier(decl)&&decl.importKind!=='type') {
   const owner=found.path.parentPath?.node;
   if(!t.isImportDeclaration(owner)||owner.importKind==='type')return;
   const loaded=loadModule(mod.file,owner.source.value);if(!loaded)return;
   const target=module(loaded.path,loaded.source),declared=exported(target,field(decl.imported)!);
   if(declared&&!callable(declared.node)){const what=literal(target,unwrap(declared.node));if(what)refuse(`${what} (imported)`);}
  }
 }
 function prove(mod:Module,path:NodePath<t.CallExpression>):ListProof {
  const call=path.node,[items,key,row]=call.arguments;
  if(items&&!t.isSpreadElement(items)&&!t.isArgumentPlaceholder(items))source(mod,items,items);
  if(!callable(key)||!t.isIdentifier(key.params[0]))fail(mod,key??call,'BUILD-612','LIST key must be an inline function with a named row parameter');
  const body=singleReturn(mod,key,'BUILD-612','LIST key function');
  const parameter=binding(mod,key.params[0],'BUILD-612'),keyParts=keyPath(mod,body,parameter);
  if(!keyParts.length)fail(mod,body,'BUILD-612','LIST key cannot be the row itself; use a nonempty path such as row.id');
  if(!callable(row)||!t.isIdentifier(row.params[0]))fail(mod,row??call,'BUILD-613','LIST row needs an inline callback with a named item');
  const result=singleReturn(mod,row,'BUILD-613','LIST row callback');
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
