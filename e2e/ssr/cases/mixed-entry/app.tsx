// This exact file is both the SSR and explicit Browser root in one split graph.
import {h,mount,activateIslands,createSignal} from '@getforma/core';
import {Panel} from './panel';
import {sharedIdentity} from './shared';
function Local(){const [count,setCount]=createSignal(0);return <button id="mixed-local" onClick={()=>setCount(count()+1)}>{()=>count()}</button>;}
function Page(){return <main id="mixed-page"><Local/><Panel/></main>;}
(globalThis as any).mixedEntryIdentity={core:h,shared:sharedIdentity};
activateIslands({Local,Panel});
mount(Page,'#app');
