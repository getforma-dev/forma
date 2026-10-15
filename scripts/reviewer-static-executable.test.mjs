import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { verifyStaticTemplate } from './release-template-islands.mjs';

test('static observation rejects a self-removing parser-time inline executable', async () => {
  const csp = "default-src 'self'; script-src 'self' 'nonce-review'; style-src 'self'; require-trusted-types-for 'script'; trusted-types forma forma-runtime";
  const manifest = { routes: { '/about': { mode: 'ssr', js: [], css: ['style.css'], ir: 'about.ir' } } };
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const headers = { 'cache-control': 'no-store', 'content-security-policy': csp };
    if (request.url === '/style.css') { response.writeHead(200, { ...headers, 'content-type': 'text/css' }); response.end('main{color:black}'); return; }
    response.writeHead(200, { ...headers, 'content-type': 'text/html' });
    response.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><script type="application/json" data-island-state>{"v":1,"s":[],"i":[]}</script></head><body><main><h1>About this app</h1></main><script nonce="review">globalThis.executedUnexpectedly=true;document.currentScript.remove();</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    await assert.rejects(verifyStaticTemplate(browser, `http://127.0.0.1:${server.address().port}`, manifest), /executable|script/i);
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
