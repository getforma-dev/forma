// Deliberately invalid synthetic pages prove the harness rejects replacement
// and fake readiness. These are controls, never framework entrants or scores.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../contestants/_shared/render.vanilla.mjs';
const [chrome,out]=process.argv.slice(2);
if(!chrome||!out)throw new Error('usage: node verify-controls.mjs CHROME OUTPUT_DIRECTORY');
await mkdir(out,{recursive:true});
let control='replace';
const counter='<section id="gp-counter"><button id="gp-increment" type="button">Increment</button><output id="gp-count">0</output></section>';
const server=createServer((request,response)=>{
 if(request.url==='/favicon.ico'){response.writeHead(204);return response.end();}
 if(request.url==='/control.js'){
  response.writeHead(200,{'content-type':'text/javascript'});
  const replace="const old=document.getElementById('gp-counter');old.replaceWith(old.cloneNode(true));";
  return response.end((control==='replace'?replace:'')+"const readyAt=performance.now();window.__gpIsland={ready:true,readyAt,activationStart:0,activationMs:readyAt};"+(control==='bad-clock'?"window.__gpIsland.activationStart=NaN;":""));
 }
 response.writeHead(200,{'content-type':'text/html'});
 response.end(renderPage(100).replace('<table',counter+'<table').replace('</body>','<script src="/control.js"></script></body>'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 for(const [name,expected] of [['replace','replaced or failed to capture'],['fake-ready','counter update timeout'],['bad-clock','invalid native activation boundary']]){
  control=name;
  const result=path.resolve(out,`${name}.json`);
  const args=[fileURLToPath(new URL('run.mjs',import.meta.url)),'--car','react-node','--url',`http://127.0.0.1:${server.address().port}`,'--chrome',chrome,'--out',result,'--diagnostic'];
  const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});
  const report=JSON.parse(await readFile(result,'utf8'));
  if(exit===0||report.verified||!report.failure?.includes(expected))throw new Error(`control ${name} did not fail at expected gate: ${report.failure}`);
 }
 console.log('All deliberately invalid island controls were rejected.');
} finally {await new Promise(resolve=>server.close(resolve));}
