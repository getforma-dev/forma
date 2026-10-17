import {readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname} from 'node:path';

/** One synchronous compiler product reads each source and resolution once. */
export class SourceSnapshot {
  readonly files = new Map<string,string>();
  readonly directories = new Set<string>();
  readonly dependencies = new Set<string>();
  private readonly resolutions = new Map<string,{value:string|null;read:()=>string|null}>();
  read(file:string):string {
    file=realpathSync(file);
    if(!this.files.has(file))this.files.set(file,readFileSync(file,'utf8'));
    return this.files.get(file)!;
  }
  resolution(base:string,read:()=>string|null,candidates:readonly string[]):string|null {
    for(const candidate of candidates) {
      // Erased type imports have no esbuild resolver dependency. Track absent
      // candidates too, including index files and the nearest existing parent
      // when a directory itself has yet to be created.
      this.dependencies.add(candidate);
      let directory=dirname(candidate);
      while(true) {
        try {if(statSync(directory).isDirectory()){this.directories.add(directory);break;}} catch {}
        const parent=dirname(directory);if(parent===directory)break;directory=parent;
      }
    }
    if(!this.resolutions.has(base))this.resolutions.set(base,{value:read(),read});
    return this.resolutions.get(base)!.value;
  }
  unchanged():boolean {
    try {
      for(const [file,source] of this.files)if(readFileSync(file,'utf8')!==source)return false;
      for(const {value,read} of this.resolutions.values())if(read()!==value)return false;
      return true;
    } catch { return false; }
  }
}

let current:SourceSnapshot|undefined;
export function withSourceSnapshot<T>(snapshot:SourceSnapshot,run:()=>T):T {
  const previous=current;current=snapshot;
  try{return run();}finally{current=previous;}
}
export const readSourceFile=(file:string):string=>current?current.read(file):readFileSync(file,'utf8');
export const resolveSourceFile=(base:string,read:()=>string|null,candidates:readonly string[]=[base]):string|null=>{
  const canonical=()=>{const value=read();return value===null?null:realpathSync(value);};
  return current?current.resolution(base,canonical,candidates):canonical();
};
