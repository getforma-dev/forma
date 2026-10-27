// Owns only an ephemeral loopback listener and atomic pointers under this pilot's .local.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, symlink, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),work=resolve(here,'.local');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://127.0.0.1');
  if (req.method==='POST' && url.pathname==='/__pilot/select') {
   const selected=url.searchParams.get('build');assert(['original','candidate'].includes(selected));
   const temporary=resolve(work,'next');await unlink(temporary).catch(()=>{});await symlink(selected,temporary);await rename(temporary,resolve(work,'current'));
   res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const root=resolve(work,'current');let file=resolve(root,'.'+decodeURIComponent(url.pathname));
  assert(file===root||file.startsWith(root+sep));if((await stat(file)).isDirectory())file=resolve(file,'index.html');
  const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end('Not found');}
});
server.listen(0,'127.0.0.1',()=>console.log('FORMA_SITE_PILOT http://127.0.0.1:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
