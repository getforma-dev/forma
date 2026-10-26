import {Window} from '/Users/victorvillacis/dev/Forma/work/FORMA-301/forma/node_modules/happy-dom/lib/index.js';
import {createRouter} from '/tmp/forma-301-callback-review-33ae/node_modules/@getforma/router/dist/index.js';
import {createEffect} from '/tmp/forma-301-callback-review-33ae/node_modules/@getforma/core/dist/index.js';
import {writeFileSync} from 'node:fs';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const records=[];
for(const scenario of ['mutation-revalidating-navigate','title-dispose']){
 const w=new Window({url:'https://example.test/a'});const root=w.document.createElement('main');w.document.body.append(root);const commits=[],activations=[];let router;
 const adapter={kind:'browser',connect(){return{async prepare({url}){return{validate(){},commit(){commits.push(url.pathname)},async activate(){activations.push(url.pathname)},dispose(){}}},allowsAction(){return true},admitAction(x){return x},dispose(){}}}};
 router=createRouter({root,routes:[{id:'all',path:'*'}],adapter,...(scenario==='title-dispose'?{title(){router.dispose();return 'stale-title'}}:{})});await router.ready;
 if(scenario==='mutation-revalidating-navigate'){
  let fired=false;const off=createEffect(()=>{if(router.mutation()==='revalidating'&&!fired){fired=true;void router.navigate('/c')}});
  globalThis.fetch=async()=>new Response(JSON.stringify({outcome:'success',status:200,data:{}}),{headers:{'Content-Type':'application/vnd.forma.action+json','Cache-Control':'no-store','Vary':'Accept'}});
  const f=w.document.createElement('form');f.method='post';f.action='/save';root.append(f);await router.submit(f);await flush();off();
 }else await router.navigate('/b');
 records.push({scenario,commits,activations,path:router.location().url.pathname,title:w.document.title});router.dispose();await w.happyDOM.close();
}
writeFileSync('/tmp/forma-301-callback-review-33ae/observable.json',JSON.stringify(records,null,2)+'\n');console.log(records);
