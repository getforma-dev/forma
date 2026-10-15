import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { withOwnedServer } from './owned-server.mjs';

const program = `
 const http=require('node:http');
 const server=http.createServer((req,res)=>res.end('owned response'));
 server.on('error',error=>{console.error(error.code);process.exit(2);});
 server.listen(Number(process.env.FORMA_PORT),'127.0.0.1',()=>console.log('FORMA_LISTENING http://127.0.0.1:'+server.address().port));
`;
test('owned process reports its OS-assigned listener before any request',async()=>{
  await withOwnedServer(process.execPath,['-e',program],process.cwd(),async(response,origin,output)=>{
    assert.equal(await response.text(),'owned response');
    assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
    assert(output().includes('FORMA_LISTENING '+origin));
  });
});
test('a foreign occupied listener cannot satisfy readiness or receive the refused process requests',async()=>{
  let requests=0;
  const foreign=http.createServer((req,res)=>{requests++;res.end('foreign');});foreign.listen(0,'127.0.0.1');await once(foreign,'listening');
  try{
    const result=await withOwnedServer(process.execPath,['-e',program],process.cwd(),()=>assert.fail('refused child was visited'),{refusal:true,env:{FORMA_PORT:String(foreign.address().port)}});
    assert.equal(result.accepted,false);assert.equal(result.code,2);assert.match(result.output,/EADDRINUSE/);assert.equal(requests,0);
    assert.equal(await (await fetch(`http://127.0.0.1:${foreign.address().port}`)).text(),'foreign');
  }finally{foreign.closeAllConnections();await new Promise(resolve=>foreign.close(resolve));}
});
test('a process that exits without readiness refuses independently of any listening service',async()=>{
  await assert.rejects(withOwnedServer(process.execPath,['-e','process.exit(3)'],process.cwd(),()=>assert.fail('unexpected visit')),/before readiness \(3\)/);
});
