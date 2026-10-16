// The shared P17 observers must cover yielded module evaluation, not a network-idle guess.
import {createServer} from 'node:http';
import {test,expect} from '@playwright/test';
import {verifyMinimalIsland} from '../../../scripts/release-template-islands.mjs';
import {verifyIslandPage} from './lib/verify-page.mjs';

const manifest={routes:{'/':{mode:'ssr',js:['entry.js'],css:[],ir:'home.ir'}}};
async function fixture(lateWrite:boolean, run:(origin:string,evaluations:()=>number)=>Promise<void>){
 let evaluations=0;
 const csp="default-src 'self'; script-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime";
 const server=createServer((request,response)=>{
  response.setHeader('cache-control','no-store');response.setHeader('content-security-policy',csp);
  if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(request.url==='/evaluated'){evaluations++;response.writeHead(204);response.end();return;}
  if(request.url==='/_assets/entry.js'){
   response.setHeader('content-type','text/javascript');
   response.end(`await fetch('/evaluated');let value=7;const span=document.querySelector('.count span'),buttons=document.querySelectorAll('button');buttons[0].addEventListener('click',()=>span.textContent=String(++value));buttons[1].addEventListener('click',()=>{value=0;span.textContent='0'});await new Promise(resolve=>setTimeout(resolve,1500));${lateWrite?"span.setAttribute('data-late-adoption','1');":''}`);return;
  }
  response.setHeader('content-type','text/html');
  response.end('<!doctype html><html><head><script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"0123456789abcdef","p":{"count":7}}]}</script><script type="module" src="/_assets/entry.js"></script></head><body><main><section data-forma-island="0" data-forma-component="Counter" data-forma-state="0" data-forma-h="0123456789abcdef"><p class="count"><span>7</span></p><button>Increment</button><button>Reset</button></section></main></body></html>');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run(`http://127.0.0.1:${(server.address() as {port:number}).port}`,()=>evaluations);}
 finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
for(const kind of ['minimal','fixture'] as const){
 test(`${kind}: a write after yielded module evaluation starts remains inside adoption observation`,async({browser})=>{
  await fixture(true,async origin=>{
   const observed=kind==='minimal'?verifyMinimalIsland(browser,origin,manifest,7,{timeout:5000})
    :verifyIslandPage(browser,origin,'/',manifest,{timeout:5000,expected:{serverValues:[{selector:'.count span',text:'7'}],hosts:{Counter:1},state:{Counter:[{count:7}]}},interact:async page=>{await page.getByRole('button',{name:'Increment',exact:true}).click();await expect(page.locator('.count span')).toHaveText('8');return true;}});
   await expect(observed).rejects.toThrow(/adoption wrote to the DOM/);
  });
 });
}
test('DOMContentLoaded can precede TLA completion; importing the existing module awaits it without reexecution',async({page})=>{
 await fixture(false,async(origin,evaluations)=>{
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const observed=await page.evaluate(async url=>{
   let complete=false;
   const completion=import(url).then(()=>{complete=true;});
   await Promise.resolve();
   const initiallyComplete=complete;
   await completion;await import(url);
   return {initiallyComplete,complete};
  },`${origin}/_assets/entry.js`);
  expect(observed).toEqual({initiallyComplete:false,complete:true});expect(evaluations()).toBe(1);
 });
});
