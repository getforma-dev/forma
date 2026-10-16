// FORMA-104 D5: the actual compiler/native product must retain both initially
// selected and initially empty element ternaries, then own each live generation.
import {h,mount,activateIslands,createSignal} from '@getforma/core';

function ConditionalElement(p:{label:string;initial:boolean}) {
  const [on,setOn]=createSignal(p.initial);
  const [hits,setHits]=createSignal(0);
  return <section data-case={p.label}>
    <button className="toggle" onClick={()=>setOn(!on())}>Toggle</button>
    <output>{()=>hits()}</output>
    {()=>on()?<button className="branch" onClick={()=>setHits(hits()+1)}>Branch</button>:null}
  </section>;
}
function Page() {
  return <main><ConditionalElement label="selected" initial={true}/><ConditionalElement label="empty" initial={false}/></main>;
}
activateIslands({ConditionalElement});
mount(Page,'#app');
