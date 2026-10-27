import type {BuildContext,BuildFailure,Plugin} from 'esbuild';

/** Recover only source changes observed by a paired compiler snapshot. esbuild
 * reads plugin watchFiles after onLoad, so its new baseline can already contain
 * an edit that happened after the compiler captured its source. */
export function watchSourceRecovery(): {
  plugin: Plugin;
  changed(): void;
  attach(context: BuildContext): BuildContext;
} {
  let context: BuildContext | undefined;
  let generation=0,requested:number|undefined,cancellation=0;
  let draining=false,stopped=false,cancelling=false;
  const stop=()=>{stopped=true;requested=undefined;cancellation++;};
  const schedule=()=>{
    if(!context||draining||stopped||cancelling||requested===undefined)return;
    draining=true;
    const ticket=cancellation;
    // Never return/await this promise from onEnd: rebuild() may join the build
    // whose callback is currently running, including a build that will reject.
    void Promise.resolve().then(async()=>{
      while(!stopped&&!cancelling&&ticket===cancellation&&requested!==undefined){
        const stale=requested;
        if(generation>stale){requested=undefined;break;}
        try {await context!.rebuild();}
        catch(error){
          if(stopped||cancelling||ticket!==cancellation)break;
          // Genuine build failures are already reported by esbuild. A joined
          // stale failure still needs its requested fresh generation; a fresh
          // unchanged failure clears the request below and is never retried.
          const errors=(error as BuildFailure)?.errors;
          if(!Array.isArray(errors)||errors.length===0){
            requested=undefined;
            console.error('Watch source recovery failed:',error);
            break;
          }
        }
        if(generation>stale&&requested===stale)requested=undefined;
      }
    }).finally(()=>{draining=false;schedule();});
  };
  return {
    changed(){if(!stopped&&!cancelling)requested=generation;},
    plugin:{name:'forma-watch-source-recovery',setup(builder){
      builder.onStart(()=>{
        generation++;
        // A spontaneous watch build already supersedes the requested snapshot.
        // Do not let its predecessor enqueue another build after it completes.
        if(requested!==undefined&&generation>requested)requested=undefined;
      });
      builder.onEnd(()=>{schedule();});
      builder.onDispose(stop);
    }},
    attach(value){
      if(context)throw new Error('Watch source recovery already owns a context');
      context=value;
      return {...value,
        async cancel(){
          cancellation++;requested=undefined;cancelling=true;
          try {await value.cancel();}finally{cancelling=false;schedule();}
        },
        async dispose(){stop();await value.dispose();},
      };
    },
  };
}
