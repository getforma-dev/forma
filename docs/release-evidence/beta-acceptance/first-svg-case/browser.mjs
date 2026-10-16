import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {basename,join} from 'node:path';
import {chromium,firefox,webkit} from '../../forma/node_modules/@playwright/test/index.mjs';
const root=import.meta.dirname,reports=[];
const server=createServer((request,response)=>{
 const path=new URL(request.url,'http://localhost').pathname;
 if(path==='/__csp-reports'){let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{reports.push(body);response.writeHead(204);response.end();});return;}
 if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
 if(path==='/sw.js'){response.writeHead(200,{'content-type':'text/javascript'});response.end('');return;}
 if(path==='/ssr'||path==='/csr'){
  const stem=path==='/ssr'?'index':'csr',file=join(root,'out/site/probe',stem);
  response.writeHead(200,JSON.parse(readFileSync(file+'.headers.json','utf8')));response.end(readFileSync(file+'.html'));return;
 }
 if(path.startsWith('/_assets/')){
  const file=join(root,'out/build/probe',basename(path));
  if(existsSync(file)){response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript; charset=utf-8':'application/octet-stream','cache-control':'no-store'});response.end(readFileSync(file));return;}
 }
 response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const results=[];
try {
 for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
  const browser=await type.launch();
  try{
   for(const phase of ['ssr','csr']){
    const page=await browser.newPage(),consoleErrors=[],pageErrors=[],held=[];let release=false;
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('pageerror',error=>pageErrors.push(error.message));
    await page.addInitScript(()=>{window.probeErrors=[];document.addEventListener('forma:error',event=>window.probeErrors.push(event.detail));});
    if(phase==='ssr')await page.route('**/_assets/*.js',route=>{if(release)return route.continue();held.push(route);});
    const response=await page.goto(`${origin}/${phase}`,{waitUntil:phase==='ssr'?'commit':'load'});
    const snapshot=()=>page.evaluate(()=>Object.fromEntries(['bad-tab','bad-data','good'].map(id=>{const element=document.getElementById(id);return [id,element?{namespace:element.namespaceURI,attributes:Object.fromEntries([...element.attributes].map(attribute=>[attribute.name,attribute.value]))}:null];})));
    let before=null;
    if(phase==='ssr'){
     await page.waitForFunction(()=>document.readyState!=='loading');before=await snapshot();
     release=true;for(const route of held.splice(0))await route.continue();await page.waitForLoadState('load');
    }
    await page.waitForTimeout(100);const after=await snapshot();
    await page.evaluate(()=>{for(const id of ['bad-tab','bad-data','good'])document.getElementById(id)?.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    const clicked=await snapshot(),errors=await page.evaluate(()=>window.probeErrors);
    results.push({engine,phase,headers:response.headers(),before,after,clicked,errors,consoleErrors,pageErrors});await page.close();
   }
  }finally{await browser.close();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}
const result={diagnosticOnly:true,source:'cases/probe/app.tsx',compilerAccepted:true,actualTypedNative:true,results,reports};
writeFileSync(join(root,'browser-results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
