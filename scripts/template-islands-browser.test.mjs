import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { verifyMinimalIsland, verifyStaticTemplate } from './release-template-islands.mjs';

const csp = "default-src 'self'; script-src 'self' 'nonce-template-test'; style-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime";
const state = value => `<script type="application/json" data-island-state>${JSON.stringify({v:1,s:[],i:value})}</script>`;
const host = '<section data-forma-island="0" data-forma-component="Counter" data-forma-state="0" data-forma-h="0123456789abcdef"><p class="count">Count: <span>7</span></p><button>Increment</button><button>Reset</button></section>';
const listeners = `let value=7; const span=document.querySelector('.count span'), buttons=document.querySelectorAll('button'); buttons[0].addEventListener('click',()=>{span.textContent=String(++value)}); buttons[1].addEventListener('click',()=>{value=0;span.textContent='0'});`;
const manifest = { routes: { '/': {mode:'ssr',js:['entry.js'],css:['style.css'],ir:'home.ir'}, '/about': {mode:'ssr',js:[],css:['style.css'],ir:'about.ir'} } };
async function fixture({script=listeners, staticScript=false, earlyScript='', hangDocument=false}, visit) {
  const server=createServer((request,response)=>{
    const headers={'cache-control':'no-store','content-security-policy':csp};
    if(hangDocument&&request.url==='/')return;
    if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
    if(request.url==='/_assets/entry.js'){response.writeHead(200,{'content-type':'text/javascript',...headers});response.end(script);return;}
    if(request.url==='/_assets/style.css'){response.writeHead(200,{'content-type':'text/css',...headers});response.end('main{color:rgb(1,2,3)}');return;}
    const about=request.url==='/about';
    response.writeHead(200,{'content-type':'text/html',...headers});
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/_assets/style.css">${state(about?[]:[{h:'0123456789abcdef',p:{count:7}}])}</head><body><main><h1>${about?'About this app':'Home'}</h1>${about?'<p>Static body</p>':host}</main>${earlyScript?`<script nonce="template-test">${earlyScript}</script>`:''}${!about||staticScript?'<script type="module" nonce="template-test" src="/_assets/entry.js"></script>':''}</body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{return await visit(browser,`http://127.0.0.1:${server.address().port}`);}
  finally{await browser.close();server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}

test('template observation admits listener-only activation and requires all three value transitions',async()=>{
  const result=await fixture({},(browser,origin)=>verifyMinimalIsland(browser,origin,manifest));
  assert.deepEqual(result.adoption.mutations,[]);assert.equal(result.adoption.sameNodes,true);
  assert.deepEqual(result.transitions,[7,8,0,1]);
});
test('template observation rejects a same-value text rewrite during activation',async()=>{
  await fixture({script:`document.querySelector('.count span').textContent='7';${listeners}`},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest),/wrote to the DOM/);
  });
});
test('template observation rejects an attribute write before listeners attach',async()=>{
  await fixture({script:`document.querySelector('section').setAttribute('data-active','true');${listeners}`},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest),/wrote to the DOM/);
  });
});
test('template observation refuses an inert page even when original markup remains unchanged',async()=>{
  await fixture({script:'export {};'},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest,7,{timeout:1000}),/Timeout/);
  });
});
test('static template observation preserves markup and stylesheet with no executable requests',async()=>{
  const result=await fixture({},(browser,origin)=>verifyStaticTemplate(browser,origin,manifest));
  assert.equal(result.executableScripts,0);assert(result.requests.some(request=>request.type==='stylesheet'));
});
test('static template observation rejects a script even if it performs no writes',async()=>{
  await fixture({script:'export {};',staticScript:true},async(browser,origin)=>{
    await assert.rejects(verifyStaticTemplate(browser,origin,manifest),/executable inventory|executable or preloaded code/);
  });
});
test('static template observation refuses contradictory accepted route metadata',async()=>{
  await assert.rejects(verifyStaticTemplate(undefined,'http://localhost',{routes:{'/about':{...manifest.routes['/about'],js:['entry.js']}}}));
  await assert.rejects(verifyStaticTemplate(undefined,'http://localhost',{routes:{'/about':{...manifest.routes['/about'],modulepreload:['entry.js']}}}));
});

test('template observation refuses an inline rewrite that precedes the held module',async()=>{
  await fixture({earlyScript:"document.querySelector('.count span').textContent='7';"},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest),/executable inventory/);
  });
});
test('template observation retains parser-time inventory when an early inline script removes itself',async()=>{
  await fixture({earlyScript:"document.querySelector('.count span').textContent='7';document.currentScript.remove();"},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest),/executable inventory/);
  });
});

test('static observation refuses a self-removing inline executable seen during parsing',async()=>{
  await fixture({earlyScript:"globalThis.__unexpectedStaticExecution=true;document.currentScript.remove();"},async(browser,origin)=>{
    await assert.rejects(verifyStaticTemplate(browser,origin,manifest),/static executable inventory/);
  });
});

test('a navigation that never commits keeps its error message and carries the page timeline (FORMA-252)',async()=>{
  await fixture({hangDocument:true},async(browser,origin)=>{
    await assert.rejects(verifyMinimalIsland(browser,origin,manifest,7,{timeout:1000}),error=>{
      assert.match(error.message,/page\.goto: Timeout 1000ms exceeded/);
      assert.doesNotMatch(error.message,/\+\d+ms /,'the timeline stays out of the message');
      assert.equal(Object.getOwnPropertyDescriptor(error,'formaTimeline')?.enumerable,false,'the timeline stays out of enumerations and serialisation');
      assert.equal(Object.keys(error).includes('formaTimeline'),false);
      const timeline=error.formaTimeline.join('\n');
      assert.match(timeline,/^\+\d+ms goto http:\/\/127\.0\.0\.1:\d+ \(waitUntil commit, timeout 1000 ms\)\n\+\d+ms request GET document http:\/\/127\.0\.0\.1:\d+\/$/m,timeline);
      assert.doesNotMatch(timeline,/response|navigated/,'the server never answered the document');
      return true;
    });
  });
});
test('a completed observation records its timeline without exposing it in the result',async()=>{
  const result=await fixture({},(browser,origin)=>verifyMinimalIsland(browser,origin,manifest));
  assert.equal(Object.hasOwn(result,'timeline'),false);
});
