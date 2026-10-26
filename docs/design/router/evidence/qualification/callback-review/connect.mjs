import {Window} from '/Users/victorvillacis/dev/Forma/work/FORMA-301/forma/node_modules/happy-dom/lib/index.js';
import {createRouter} from '/tmp/forma-301-callback-review-33ae/node_modules/@getforma/router/dist/index.js';
import {writeFileSync} from 'node:fs';
const w=new Window({url:'https://example.test/a'});const root=w.document.createElement('main');w.document.body.append(root);const calls=[];let router;
const adapter={kind:'browser',connect(){calls.push('connect');router.dispose();return{initialize(){calls.push('initialize-after-dispose')},async prepare(){throw Error()},dispose(){calls.push('session-disposed')}}}};
router=createRouter({root,routes:[{id:'all',path:'*'}],adapter});try{await router.ready}catch{}await Promise.resolve();
writeFileSync('/tmp/forma-301-callback-review-33ae/connect.json',JSON.stringify({calls},null,2)+'\n');console.log(calls);await w.happyDOM.close();
