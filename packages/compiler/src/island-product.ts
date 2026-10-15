import {parse} from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import {dirname} from 'node:path';
import {realpathSync} from 'node:fs';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
import {createIslandRegistry,rawModuleLoader,type IslandRegistry} from './island-registry';
import {makeIslandContract} from './fmir-contracts';
import {PropsSchemaError} from './props-schema';
import {readSourceFile} from './source-snapshot';
import {ComponentAnalyzer} from './component-analyzer';
import {resolveExportedFunction} from './export-resolver';
import {resolveFilePath} from './module-loader';
import {inspectEntryMounts,isCoreCall,refuseEntry} from './entry-policy';
import {applySourceEdits,type SourceEdit} from './source-edits';
import type {IrResult} from './esbuild-ssr-plugin';

/** Resolve the original page declaration, never the emitted function's text/name. */
function pageIdentity(file:string):string|undefined {
  const source=readSourceFile(file),info=new ComponentAnalyzer(dirname(file)).parseEntryPoint(source,file);
  if(!info)return undefined;
  if(info.componentName==='__inline__')return `${realpathSync(file)}\0inline:${inspectEntryMounts(source,file)?.start}`;
  const imported=info.importBindings?.get(info.componentName);
  const owner=info.localComponent?file:resolveFilePath(dirname(file),info.importPath);
  if(!owner)return undefined;
  const found=resolveExportedFunction(readSourceFile(owner),owner,imported?.imported??info.componentName,
    {loadModule:rawModuleLoader,allowLocal:!!info.localComponent});
  return found.kind==='found'?`${realpathSync(found.filePath)}\0${found.fn.start}`:undefined;
}

export type EntrySourceEdit = SourceEdit;

/**
 * Rewrite the captured original entry only after its native contracts exist.
 * Module initialization/capture identity stays in place; only the authenticated
 * compile-time mount and unreachable literal activation entries are omitted.
 */
export function collectIslandEntryEdits(file:string,server:IslandRegistry,result:IrResult|null,sourceEntry=file):readonly EntrySourceEdit[] {
  const source=readSourceFile(file),browser=createIslandRegistry(file);
  const fail=(message:string):never=>{throw new PropsSchemaError(file,1,1,message);};
  const native=new Map(server.entries().map(entry=>[entry.island.name,entry.island]));
  const emitted=new Map(result?.islands.map(island=>[island.name,island.contract])??[]);
  if(browser.entries().length!==native.size)fail('SSR and browser entries must register the same resolved island declarations');
  const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
  const mount=inspectEntryMounts(source,file);
  if(mount&&realpathSync(file)!==realpathSync(sourceEntry)) {
    const identity=pageIdentity(file),expected=pageIdentity(sourceEntry);
    if(!identity||!expected||identity!==expected)refuseEntry(file,ast.program,
      'the browser mount must select the same original native page declaration; otherwise use an activation-only browser entry');
  }
  const names=new Set<string>();traverse(ast,{Identifier(path){names.add(path.node.name);}});
  let helper='__formaIslandRegistration';while(names.has(helper))helper+='_' ;
  const replacements=new Map<number,string>();
  for(const entry of browser.entries()) {
    const item=entry.island,expected=native.get(item.name);
    if(!expected) return fail(`island ${item.name} has no SSR registration`);
    if(expected.identity!==item.identity)fail(`island ${item.name} resolves to different SSR and browser declarations`);
    const contract=makeIslandContract(0,item.declared.schema,0,item.mode,item.analyze().bindings);
    const paired=makeIslandContract(0,expected.declared.schema,0,expected.mode,expected.analyze().bindings);
    const h=Buffer.from(contract.digest).toString('hex');
    if(!Buffer.from(contract.digest).equals(paired.digest)||JSON.stringify(contract.schema)!==JSON.stringify(paired.schema))fail(`island ${item.name} has different SSR and browser contracts`);
    const actual=emitted.get(item.name);
    if(actual&&(actual.digest!==h||actual.mode!==item.mode||JSON.stringify(actual.schema)!==JSON.stringify(contract.schema)))fail(`island ${item.name} metadata disagrees with the emitted FMIR contract`);
    // Even unused registrations are authenticated above. Only emitted native
    // definitions make it into the browser activation registry.
    if(actual) {
      const metadata={h,schema:contract.schema,mode:item.mode==='ssr'?0:1};
      replacements.set(entry.start,`${JSON.stringify(item.name)}: ${helper}(${entry.local}, ${JSON.stringify(metadata)})`);
    }
  }
  for(const name of emitted.keys())if(!native.has(name))fail(`emitted island ${name} has no declared browser registration`);
  const edits:{start:number;end:number;text:string}[]=mount?[{...mount,text:''}]:[];
  traverse(ast,{CallExpression(path){
    if(!isCoreCall(path,'activateIslands'))return;
    const arg=path.node.arguments[0];
    if(!t.isObjectExpression(arg))return fail('activateIslands needs a literal registry');
    const kept=arg.properties.flatMap(property=>{
      const replacement=replacements.get(property.start!);return replacement?[replacement]:[];
    });
    if(kept.length)edits.push({start:arg.start!,end:arg.end!,text:`{${kept.join(',')}}`});
    else {
      if(!path.parentPath.isExpressionStatement()||!path.parentPath.parentPath?.isProgram())refuseEntry(file,path.node,
        'an empty activation registry must be a standalone top-level expression so it can be omitted safely');
      const args=path.get('arguments');
      if(args.slice(1).some(argument=>!argument.isPure()))refuseEntry(file,path.node,
        'an empty activation registry has an effectful root or extra argument; move required effects outside the activation call');
      edits.push({start:path.parentPath.node.start!,end:path.parentPath.node.end!,text:''});
    }
  }});
  if(replacements.size) {
    const offset=ast.program.interpreter?.end??0;
    edits.push({start:offset,end:offset,text:`\nimport {__islandRegistration as ${helper}} from "@getforma/core";\n`});
  }
  return edits;
}

/** Apply original-coordinate edits;104 composes its module hooks at this seam. */
export function injectIslandMetadata(file:string,server:IslandRegistry,result:IrResult|null,sourceEntry=file):string {
  const edits=collectIslandEntryEdits(file,server,result,sourceEntry);
  return applySourceEdits(readSourceFile(file),edits);
}
