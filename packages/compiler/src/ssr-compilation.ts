import {clientTemplatesEnabled,transformClientTemplates} from './client-template';
import {collectJsxNamespaceEdits} from '../../shared/jsx-namespace.mjs';
import {realpathSync} from 'node:fs';
import type {BuildOptions,Plugin,PluginBuild} from 'esbuild';
import type {IslandRegistry} from './island-registry';
import {PropsSchemaError} from './props-schema';
import {SourceSnapshot,withSourceSnapshot} from './source-snapshot';
import {collectAdoptionEdits} from './adoption-hooks';
import {applySourceEdits,type SourceEdit} from './source-edits';

type Setup = Plugin['setup'];
const factories = new WeakSet<Setup>();
const contexts = new WeakMap<BuildOptions,CompilationContext>();

export interface EntryCompilation {
  readonly snapshot:SourceSnapshot;
  readonly registry?:IslandRegistry;
  readonly valid:boolean;
  readonly entry?:string;
  readonly edits:readonly SourceEdit[];
}
interface Participant {epoch:number;done:boolean;input?:EntryCompilation}
interface Prepared {snapshot:SourceSnapshot;sources:Map<string,string>;browserSources:Map<string,string>}

/** One setup group is captured by its callbacks; later contexts cannot replace it. */
class CompilationContext {
  readonly participants=new Map<Setup,Participant>();
  private prepared?:Prepared;
  constructor(readonly expected:ReadonlySet<Setup>,readonly namespaceOptions:{factory:string;runtime?:string},readonly optimizeClient:boolean) {}
  get setupComplete():boolean {return this.participants.size===this.expected.size;}
  begin(setup:Setup):void {
    const current=this.participants.get(setup)!;
    current.epoch++;current.done=false;current.input=undefined;this.prepared=undefined;
  }
  complete(setup:Setup,input:EntryCompilation):void {
    const current=this.participants.get(setup)!;current.input=input;current.done=true;
  }
  private prepare():Prepared {
    if(this.prepared)return this.prepared;
    const records=[...this.participants.values()],epoch=records[0]?.epoch;
    if(!this.setupComplete||!epoch||records.some(record=>!record.done||record.epoch!==epoch)) {
      throw new Error('BUILD-610 all SSR entry analyses must complete for this build cycle before loading browser modules');
    }
    const inputs=records.map(record=>record.input!),snapshot=new SourceSnapshot();
    for(const input of inputs) {
      for(const [file,source] of input.snapshot.files) {
        if(snapshot.files.has(file)&&snapshot.files.get(file)!==source)throw new PropsSchemaError(file,1,1,
          'SSR entries captured different original source bytes; retry the complete build');
        snapshot.files.set(file,source);
      }
      for(const file of input.snapshot.dependencies)snapshot.dependencies.add(file);
      for(const directory of input.snapshot.directories)snapshot.directories.add(directory);
    }
    const byFile=new Map<string,SourceEdit[]>();
    const entryEdits=new Map<string,SourceEdit[]>();
    // A refused native contribution never lends partial instrumentation authority.
    // Its owning onEnd retains the original source-located diagnostic.
    if(inputs.every(input=>input.valid)) {
      const registries=inputs.flatMap(input=>input.registry?[input.registry]:[]);
      // One collector sees every original registry before any onLoad wins. Its
      // helper reads use the same union snapshot and are guarded at publication.
      const hooks=withSourceSnapshot(snapshot,()=>collectAdoptionEdits(registries));
      for(const [file,edits] of hooks)byFile.set(file,[...edits]);
      for(const [file,source] of snapshot.files)if(/\.[jt]sx$/.test(file))byFile.set(file,[...(byFile.get(file)??[]),...collectJsxNamespaceEdits(source,this.namespaceOptions)]);
      for(const input of inputs)if(input.entry) {
        const edits=entryEdits.get(input.entry)??[];
        for(const edit of input.edits)if(!edits.some(previous=>previous.start===edit.start&&previous.end===edit.end&&previous.text===edit.text))edits.push(edit);
        entryEdits.set(input.entry,edits);
      }
    }
    // Component hooks have one graph-wide meaning. Entry policy (mount removal
    // and registration metadata) belongs only to the SSR entry identity.
    const transform=(includeEntryPolicy:boolean)=>{
      const editsByFile=new Map([...byFile].map(([file,edits])=>[file,[...edits]]));
      if(includeEntryPolicy)for(const [file,edits] of entryEdits)editsByFile.set(file,[...(editsByFile.get(file)??[]),...edits]);
      const sources=new Map(snapshot.files);
      for(const [file,edits] of editsByFile) {
        const source=snapshot.files.get(file);
        if(source===undefined)throw new PropsSchemaError(file,1,1,'compiler edits have no original source snapshot');
        try {const edited=applySourceEdits(source,edits);sources.set(file,this.optimizeClient?transformClientTemplates(edited,{...this.namespaceOptions,filename:file}):edited);}
        catch(error) {throw new PropsSchemaError(file,1,1,`conflicting original compiler edits: ${(error as Error).message}`);}
      }
      if(this.optimizeClient)for(const [file,source] of sources)if(!editsByFile.has(file)&&/\.[jt]sx$/.test(file))sources.set(file,transformClientTemplates(source,{...this.namespaceOptions,filename:file}));
      return sources;
    };
    this.prepared={snapshot,sources:transform(true),browserSources:transform(false)};return this.prepared;
  }
  read(file:string,entryPolicy=true):{contents:string;watchFiles:string[];watchDirs:string[]}|undefined {
    const prepared=this.prepare(),canonical=realpathSync(file),sources=entryPolicy?prepared.sources:prepared.browserSources;
    let source=sources.get(canonical);
    if(source===undefined&&/\.[jt]sx$/.test(canonical)) {
      const original=prepared.snapshot.read(canonical);
      source=applySourceEdits(original,collectJsxNamespaceEdits(original,this.namespaceOptions));
      if(this.optimizeClient)source=transformClientTemplates(source,{...this.namespaceOptions,filename:canonical});
      prepared.sources.set(canonical,source);prepared.browserSources.set(canonical,source);
    }
    if(source===undefined)return undefined;
    return {contents:source,watchFiles:[...prepared.snapshot.files.keys(),...prepared.snapshot.dependencies],watchDirs:[...prepared.snapshot.directories]};
  }
  unchanged():boolean {
    // Keep each contributor's resolution checks, plus any union-only reads that
    // the adoption collector makes through the prepared source snapshot.
    // Refused builds may never have prepared a browser product. Inspect only
    // snapshots actually observed; preparing here can throw for conflicting
    // contributions and would hide the source change that needs recovery.
    return [...this.participants.values()].every(record=>record.input?.snapshot.unchanged())
      &&(!this.prepared||this.prepared.snapshot.unchanged());
  }
}

/** Private marker preserves ordinary cloned plugin objects with the same setup. */
export function registerSsrPlugin(plugin:Plugin):Plugin {factories.add(plugin.setup);return plugin;}

export function joinSsrCompilation(build:PluginBuild,setup:Setup):{
  begin():void;complete(input:EntryCompilation):void;
  read(file:string,entryPolicy?:boolean):ReturnType<CompilationContext['read']>;unchanged():boolean;
} {
  // esbuild creates a fresh PluginBuild per setup but shares initialOptions.
  // All onStart callbacks finish before onLoad. A later setup using the same
  // options may create a new group once the preceding group has all members.
  const members=(build.initialOptions.plugins??[]).map(plugin=>plugin.setup).filter(candidate=>factories.has(candidate));
  const expected=new Set(members);
  if(!expected.has(setup)||expected.size!==members.length)throw new Error('BUILD-611 SSR plugins must have distinct registered setup instances');
  let context=contexts.get(build.initialOptions);
  if(context?.setupComplete)context=undefined;
  else if(context?.participants.has(setup))throw new Error('BUILD-611 overlapping setup with the same options object is ambiguous; use a distinct options object for concurrent builds');
  if(!context){context=new CompilationContext(expected,{factory:build.initialOptions.jsxFactory??'React.createElement',runtime:build.initialOptions.jsx},clientTemplatesEnabled(build.initialOptions));contexts.set(build.initialOptions,context);}
  if(context.expected.size!==expected.size||[...expected].some(member=>!context!.expected.has(member)))throw new Error('BUILD-611 SSR plugin membership changed during setup');
  context.participants.set(setup,{epoch:0,done:false});
  const captured=context;
  return {begin:()=>captured.begin(setup),complete:input=>captured.complete(setup,input),read:(file,entryPolicy)=>captured.read(file,entryPolicy),unchanged:()=>captured.unchanged()};
}
