// An additional Browser entry on the SSR route shares core and ordinary modules,
// and owns a separate mount target outside the server-rendered page root.
import {h,mount,createSignal} from '@getforma/core';
import {sharedIdentity} from './shared';
(globalThis as any).mixedAddonIdentity={core:h,shared:sharedIdentity};
const host=document.createElement('aside');host.id='mixed-addon';document.body.append(host);
function Addon(){const [count,setCount]=createSignal(10);return h('button',{id:'mixed-addon-count',onClick:()=>setCount(count()+1)},count);}
mount(Addon,host);
