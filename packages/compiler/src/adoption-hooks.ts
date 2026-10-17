/** Compiler bookkeeping is consumed only after original canonical contracts exist. */
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;
import type { BindingValue } from './fmir-contracts';
import type { PropsSchema, SchemaType } from './fmir-payload';
import type { AdoptionCodec, AdoptionSources, AdoptionSite, AdoptionTuple, AdoptionRead } from './island-bindings';
import type { IslandRegistry, RegisteredIsland } from './island-registry';
import type { SourceEdit } from './source-edits';

type Shape = { type: SchemaType } | { constant: unknown };
function codec(shape: Shape | undefined): AdoptionCodec | undefined {
  if (!shape) return undefined;
  if ('constant' in shape) {
    const value = shape.constant;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return typeof value as AdoptionCodec;
    return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string') ? 'string-array' : undefined;
  }
  const type = shape.type;
  if (type.kind === 'string' || type.kind === 'number' || type.kind === 'boolean') return type.kind;
  return type.kind === 'array' && type.element.kind === 'string' ? 'string-array' : undefined;
}
function codecOf(tuple: AdoptionTuple, evidence: AdoptionSources, schema: PropsSchema): AdoptionCodec | undefined {
  const tuples = new Map(evidence.tuples.map(item => [item.signal, item]));
  const rows = new Map(evidence.rows.map(item => [item.id, item.source]));
  function project(shape: Shape | undefined, path: readonly string[]): Shape | undefined {
    for (const part of path) {
      if (!shape) return undefined;
      if ('constant' in shape) {
        const value: unknown = shape.constant;
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
        shape = { constant: (value as Record<string, unknown>)[part] };
      } else {
        const type: SchemaType = shape.type;
        if (type.kind !== 'object') return undefined;
        const field = schema[type.object]?.find(item => item.name === part);
        shape = field ? { type: field.type } : undefined;
      }
    }
    return shape;
  }
  function shape(value: BindingValue, depth = 0): Shape | undefined {
    if (depth > 64) return undefined;
    switch (value.kind) {
      case 'constant': return { constant: value.value };
      case 'prop': return project({ type: { kind: 'object', object: 0 } }, value.path);
      case 'signal': {
        const local = tuples.get(value.id);
        if (!local || local.annotation === null) return undefined;
        const initial = shape(local.initial, depth + 1);
        if (local.annotation !== undefined && local.annotation !== codec(initial)) return undefined;
        return project(initial, value.path);
      }
      case 'row': {
        const source = rows.get(value.id); if (!source) return undefined;
        const list = shape(source, depth + 1);
        return list && 'type' in list && list.type.kind === 'array' ? project({type:list.type.element},value.path) : undefined;
      }
      case 'nullish': {
        let source = shape(value.source, depth + 1);
        if (source && 'type' in source && source.type.kind === 'optional') source = {type:source.type.inner};
        const fallback = {constant:value.fallback};
        return codec(source) && codec(source) === codec(fallback) ? source : undefined;
      }
      default: return undefined;
    }
  }
  const initial = shape(tuple.initial);
  const inferred = codec(initial);
  if (tuple.annotation === undefined) return inferred;
  if (tuple.annotation === null) return undefined;
  if (tuple.annotation === 'string-array' && initial && 'constant' in initial && Array.isArray(initial.constant) && initial.constant.length === 0) return tuple.annotation;
  return tuple.annotation === inferred ? inferred : undefined;
}
const siteKey = (site: AdoptionSite): string => `${site.file}\0${site.start}:${site.end}`;
interface FileHooks {
  source: string;
  tuples: Map<string, AdoptionSite>;
  reads: Map<string, AdoptionRead & {codec:AdoptionCodec | undefined}>;
  children: Map<string, AdoptionSources['children'][number]>;
  conditionals: Map<string, AdoptionSources['conditionals'][number]>;
}

/** Union all split-build registrations before choosing one import per module.
 * No transformed module may replace another plugin's original snapshot. */
export function collectAdoptionEdits(registries: IslandRegistry | readonly IslandRegistry[]): Map<string, readonly SourceEdit[]> {
  const all: readonly IslandRegistry[] = Array.isArray(registries) ? registries : [registries as IslandRegistry];
  const files = new Map<string, FileHooks>();
  const analyzed = new Set<RegisteredIsland>();
  for (const registry of all) for (const {island} of registry.entries()) {
    if (analyzed.has(island)) continue; analyzed.add(island);
    const evidence = island.analyze().adoption; if (!evidence) continue;
    for (const [file, source] of evidence.modules) {
      const prior = files.get(file);
      if (prior && prior.source !== source) throw new Error('adoption source snapshots disagree');
      if (!prior) files.set(file,{source,tuples:new Map(),reads:new Map(),children:new Map(),conditionals:new Map()});
    }
    const tuples = new Map(evidence.tuples.map(tuple => [tuple.signal, tuple]));
    const codecs = new Map<number, AdoptionCodec | undefined>();
    for (const tuple of evidence.tuples) files.get(tuple.file)!.tuples.set(siteKey(tuple),tuple);
    for (const read of evidence.reads) {
      const tuple = tuples.get(read.signal);
      if (tuple && !codecs.has(read.signal)) codecs.set(read.signal,codecOf(tuple,evidence,island.declared.schema));
      const proven = codecs.get(read.signal);
      const hooks = files.get(read.file)!, key = siteKey(read), old = hooks.reads.get(key);
      hooks.reads.set(key,{...read,codec:old && (old.codec !== proven || old.getter !== read.getter) ? undefined : proven});
    }
    for (const child of evidence.children) files.get(child.file)!.children.set(siteKey(child),child);
    for (const conditional of evidence.conditionals) files.get(conditional.file)!.conditionals.set(siteKey(conditional),conditional);
  }
  const result = new Map<string,readonly SourceEdit[]>();
  for (const [file,hooks] of files) {
    const reads = [...hooks.reads.values()].filter(read => read.codec !== undefined);
    if (!hooks.tuples.size && !reads.length && !hooks.children.size && !hooks.conditionals.size) continue;
    const ast = parse(hooks.source,{sourceType:'module',plugins:['typescript','jsx'],tokens:true});
    const names = new Set<string>();
    traverse(ast,{Identifier(path){names.add(path.node.name);},JSXIdentifier(path){names.add(path.node.name);}});
    const unique = (base:string):string => { let name=base;while(names.has(name))name+='_';names.add(name);return name; };
    const tupleName=unique('__forma_adoptSignal'),readName=unique('__forma_adoptWritable'),childName=unique('__forma_adoptChild'),conditionalName=unique('__forma_adoptConditional');
    const imports:string[]=[];const edits:SourceEdit[]=[];
    const wrap=(site:AdoptionSite,before:string,after:string):void=>{
      edits.push({start:site.start,end:site.start,text:before},{start:site.end,end:site.end,text:after});
    };
    if(hooks.tuples.size){imports.push(`__adoptionSignal as ${tupleName}`);for(const tuple of hooks.tuples.values())wrap(tuple,`${tupleName}(${tuple.start}, `,')');}
    if(reads.length){imports.push(`__adoptionWritable as ${readName}`);for(const read of reads)wrap(read,`${read.shorthand ? `${read.shorthand}: ` : ''}${readName}(`,`, ${read.getter}, ${JSON.stringify(read.codec)}, ${read.start})`);}
    if(hooks.children.size){
      imports.push(`__adoptionChild as ${childName}`);
      for(const child of hooks.children.values()){
        // Replace only invocation punctuation. Argument expressions (including
        // nested hooks) keep original coordinates and execute exactly once.
        const callee=hooks.source.slice(child.calleeStart,child.calleeEnd)+(child.typeArguments??'');
        edits.push({start:child.start,end:child.argumentsStart,text:`${childName}(undefined, ${callee}, [`});
        edits.push({start:child.end-1,end:child.end,text:'])'});
      }
    }
    if(hooks.conditionals.size){
      imports.push(`__adoptionConditional as ${conditionalName}`);
      const separator=(label:string,start:number,end:number):SourceEdit=>{
        // Babel offsets and SourceEdit offsets are both original UTF-16 indices.
        // A comment containing punctuation is never an operator token.
        const matches=ast.tokens!.filter(token=>typeof token.type==='object' && token.type.label===label && token.start>=start && token.end<=end);
        if(matches.length!==1)throw new Error('adoption conditional punctuation disagrees with original operands');
        const token=matches[0]!;
        return {start:token.start,end:token.end,text:'), () => ('};
      };
      for(const conditional of hooks.conditionals.values()){
        wrap(conditional,`${conditionalName}(() => (`,'))');
        edits.push(separator('?',conditional.test.end,conditional.consequent.start),separator(':',conditional.consequent.end,conditional.alternate.start));
      }
    }
    const importAt=ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0;
    edits.push({start:importAt,end:importAt,text:`\nimport { ${imports.join(', ')} } from '@getforma/core';\n`});
    result.set(file,edits);
  }
  return result;
}
