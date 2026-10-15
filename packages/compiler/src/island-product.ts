import {parse} from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
import {createIslandRegistry,type IslandRegistry} from './island-registry';
import {makeIslandContract} from './fmir-contracts';
import {PropsSchemaError} from './props-schema';
import {readSourceFile} from './source-snapshot';
import type {IrResult} from './esbuild-ssr-plugin';

/** Inject only the literal registrations authenticated by this FMIR product. */
export function injectIslandMetadata(file:string,server:IslandRegistry,result:IrResult|null):string {
  const source=readSourceFile(file),browser=createIslandRegistry(file);
  const fail=(message:string):never=>{throw new PropsSchemaError(file,1,1,message);};
  const native=new Map(server.entries().map(entry=>[entry.island.name,entry.island]));
  const emitted=new Map(result?.islands.map(island=>[island.name,island.contract])??[]);
  if(browser.entries().length!==native.size)fail('SSR and browser entries must register the same resolved island declarations');
  if(!browser.entries().length)return source;
  const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});
  const names=new Set<string>();traverse(ast,{Identifier(path){names.add(path.node.name);}});
  let helper='__formaIslandRegistration';while(names.has(helper))helper+='_' ;
  const edits:{start:number;end:number;text:string}[]=[];
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
    const metadata={h,schema:contract.schema,mode:item.mode==='ssr'?0:1};
    edits.push({start:entry.start,end:entry.end,text:`${JSON.stringify(item.name)}: ${helper}(${entry.local}, ${JSON.stringify(metadata)})`});
  }
  for(const name of emitted.keys())if(!native.has(name))fail(`emitted island ${name} has no declared browser registration`);
  let output=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
  const offset=ast.program.interpreter?.end??0;
  return output.slice(0,offset)+`\nimport {__islandRegistration as ${helper}} from "@getforma/core";\n`+output.slice(offset);
}
