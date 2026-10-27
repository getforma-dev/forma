import {expect,it,vi} from 'vitest';
import type {BuildContext,BuildFailure,BuildResult,PluginBuild} from 'esbuild';
import {watchSourceRecovery} from '../src/watch-source-recovery';

function deferred(){let resolve!:(result?:BuildResult)=>void,reject!:(error:unknown)=>void;const promise=new Promise<BuildResult>((yes,no)=>{resolve=result=>yes(result!);reject=no;});return {promise,resolve,reject};}
const refused=Object.assign(new Error('unchanged invalid source'),{errors:[{text:'original diagnostic'}],warnings:[]}) as BuildFailure;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
  let start!:()=>void,end!:()=>void,disposed!:()=>void;
  const recovery=watchSourceRecovery();
  recovery.plugin.setup({onStart:callback=>{start=callback as ()=>void;},onEnd:callback=>{end=callback as ()=>void;},onDispose:callback=>{disposed=callback;}} as PluginBuild);
  const rebuild=vi.fn<BuildContext['rebuild']>(),cancel=vi.fn(async()=>{}),dispose=vi.fn(async()=>{disposed();});
  const context=recovery.attach({rebuild,cancel,dispose} as unknown as BuildContext);
  return {recovery,rebuild,cancel,dispose,context,start,end,disposed};
}

it('joins the failed active build without deadlocking, then runs only one fresh unchanged failing generation',async()=>{
  const f=fixture(),active=deferred();
  f.rebuild.mockImplementationOnce(()=>active.promise).mockImplementationOnce(async()=>{f.start();f.end();throw refused;});
  f.start();f.recovery.changed();f.recovery.changed();f.end();
  await flush();expect(f.rebuild).toHaveBeenCalledTimes(1);
  active.reject(refused);await flush();expect(f.rebuild).toHaveBeenCalledTimes(2);
  await flush();expect(f.rebuild).toHaveBeenCalledTimes(2);
  await f.context.dispose();
});

it('lets a spontaneous fresh build supersede a queued stale generation',async()=>{
  const f=fixture();f.start();f.recovery.changed();f.end();
  f.start();f.end();await flush();expect(f.rebuild).not.toHaveBeenCalled();
  await f.context.dispose();
});

it('recovers a second observed edit during the fresh build but never repeats unchanged errors',async()=>{
  const f=fixture();
  f.rebuild.mockImplementationOnce(async()=>{f.start();f.recovery.changed();f.end();throw refused;})
    .mockImplementationOnce(async()=>{f.start();f.end();return {} as BuildResult;});
  f.start();f.recovery.changed();f.end();await flush();expect(f.rebuild).toHaveBeenCalledTimes(2);
  await f.context.dispose();
});

for(const operation of ['cancel','dispose'] as const){
  it(`${operation} invalidates a queued callback before it can rebuild`,async()=>{
    const f=fixture();f.start();f.recovery.changed();f.end();await f.context[operation]();await flush();
    expect(f.rebuild).not.toHaveBeenCalled();
    if(operation==='cancel')await f.context.dispose();
  });
  it(`${operation} invalidates a pending join before it can start a fresh build`,async()=>{
    const f=fixture(),active=deferred();f.rebuild.mockImplementationOnce(()=>active.promise);
    f.start();f.recovery.changed();f.end();await flush();expect(f.rebuild).toHaveBeenCalledTimes(1);
    await f.context[operation]();active.reject(refused);await flush();expect(f.rebuild).toHaveBeenCalledTimes(1);
    if(operation==='cancel'){
      f.rebuild.mockImplementationOnce(async()=>{f.start();f.end();return {} as BuildResult;});
      f.start();f.recovery.changed();f.end();await flush();expect(f.rebuild).toHaveBeenCalledTimes(2);
      await f.context.dispose();
    }else{
      f.recovery.changed();f.end();await flush();expect(f.rebuild).toHaveBeenCalledTimes(1);
    }
  });
}

it.each([new Error('service stopped'),Object.assign(new Error('context unavailable'),{errors:[],warnings:[]})])('surfaces an unexpected context failure once without an unhandled rejection or retry loop (%s)',async failure=>{
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    const f=fixture();f.rebuild.mockRejectedValue(failure);
    f.start();f.recovery.changed();f.end();await flush();
    expect(f.rebuild).toHaveBeenCalledTimes(1);expect(error).toHaveBeenCalledWith('Watch source recovery failed:',failure);
    await f.context.dispose();
  }finally{error.mockRestore();}
});
