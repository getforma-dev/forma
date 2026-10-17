// FORMA-104: each real browser sanitizes these server attributes before the
// delayed compiler-generated registration activates. Untouched normalization
// must not seed a signal; a genuine early edit must seed its owning signal.
import {h,mount,activateIslands,createSignal} from '@getforma/core';

function SanitizedControls(p:{color:string;range:string;email:string;number:string;date:string;time:string;url:string}) {
  const [color,setColor]=createSignal(p.color);
  const [range,setRange]=createSignal(p.range);
  const [email,setEmail]=createSignal(p.email);
  const [number,setNumber]=createSignal(p.number);
  const [date,setDate]=createSignal(p.date);
  const [time,setTime]=createSignal(p.time);
  const [url,setUrl]=createSignal(p.url);
  return <form id="sanitized">
    <input id="color" name="color" type="color" value={()=>color()} onInput={(e:Event)=>setColor((e.target as HTMLInputElement).value)}/>
    <output id="echo-color">{()=>color()}</output><button id="set-color" type="button" onClick={()=>setColor('#abcdef')}>Update color</button>
    <input id="range" name="range" type="range" min="10" max="20" value={()=>range()} onInput={(e:Event)=>setRange((e.target as HTMLInputElement).value)}/>
    <output id="echo-range">{()=>range()}</output><button id="set-range" type="button" onClick={()=>setRange('12')}>Update range</button>
    <input id="email" name="email" type="email" value={()=>email()} onInput={(e:Event)=>setEmail((e.target as HTMLInputElement).value)}/>
    <output id="echo-email">{()=>email()}</output><button id="set-email" type="button" onClick={()=>setEmail('later@example.test')}>Update email</button>
    <input id="number" name="number" type="number" value={()=>number()} onInput={(e:Event)=>setNumber((e.target as HTMLInputElement).value)}/>
    <output id="echo-number">{()=>number()}</output><button id="set-number" type="button" onClick={()=>setNumber('42')}>Update number</button>
    <input id="date" name="date" type="date" value={()=>date()} onInput={(e:Event)=>setDate((e.target as HTMLInputElement).value)}/>
    <output id="echo-date">{()=>date()}</output><button id="set-date" type="button" onClick={()=>setDate('2026-11-20')}>Update date</button>
    <input id="time" name="time" type="time" value={()=>time()} onInput={(e:Event)=>setTime((e.target as HTMLInputElement).value)}/>
    <output id="echo-time">{()=>time()}</output><button id="set-time" type="button" onClick={()=>setTime('18:40')}>Update time</button>
    <input id="url" name="url" type="url" value={()=>url()} onInput={(e:Event)=>setUrl((e.target as HTMLInputElement).value)}/>
    <output id="echo-url">{()=>url()}</output><button id="set-url" type="button" onClick={()=>setUrl('https://forma.test/later')}>Update url</button>
  </form>;
}
function Page() {
  return <main><SanitizedControls color="not-a-color" range="99" email="  saved@example.test  " number="not-a-number" date="2026-02-30" time="25:99" url="  https://forma.test/saved  "/></main>;
}
activateIslands({SanitizedControls});
mount(Page,'#app');
