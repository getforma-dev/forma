import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { verifyMinimalIsland } from './release-template-islands.mjs';

test('minimal observation refuses additional executable code that ran before the held entry', async () => {
  const entry = `let value=7;const span=document.querySelector('.count span'),buttons=document.querySelectorAll('button');buttons[0].addEventListener('click',()=>span.textContent=String(++value));buttons[1].addEventListener('click',()=>{value=0;span.textContent='0'});`;
  const csp = "default-src 'self'; script-src 'self' 'nonce-review'; style-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime";
  const manifest = {routes:{'/':{mode:'ssr',js:['entry.js'],css:['style.css'],ir:'home.ir'}}};
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const headers = {'cache-control':'no-store','content-security-policy':csp};
    if (request.url === '/_assets/entry.js') { response.writeHead(200, {...headers, 'content-type':'text/javascript'}); response.end(entry); return; }
    if (request.url === '/style.css') { response.writeHead(200, {...headers, 'content-type':'text/css'}); response.end('main{color:black}'); return; }
    response.writeHead(200, {...headers, 'content-type':'text/html'});
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/style.css"><script type="application/json" data-island-state>{"v":1,"s":[],"i":[{"h":"0123456789abcdef","p":{"count":7}}]}</script></head><body><main><section data-forma-island="0" data-forma-component="Counter" data-forma-state="0" data-forma-h="0123456789abcdef"><p class="count"><span>7</span></p><button>Increment</button><button>Reset</button></section></main><script nonce="review">document.querySelector('.count span').textContent='7';</script><script type="module" nonce="review" src="/_assets/entry.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true});
  try {
    await assert.rejects(verifyMinimalIsland(browser, `http://127.0.0.1:${server.address().port}`, manifest), /executable|unobserved|unexpected.*script/i);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
