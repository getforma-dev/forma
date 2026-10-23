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

// FORMA-252: the server's side of a failed visit, so a browser timeout is told from a server hang.
const stopsAfterFirst = `
 const http=require('node:http');let served=0;
 const server=http.createServer((req,res)=>{res.end('first');if(++served===1)server.close();});
 server.listen(Number(process.env.FORMA_PORT),'127.0.0.1',()=>console.log('FORMA_LISTENING http://127.0.0.1:'+server.address().port));
 setInterval(()=>{},1000);
`;
const exitsAfterFirst = `
 const http=require('node:http');
 const server=http.createServer((req,res)=>{res.end('first');setTimeout(()=>{console.error('leaving on purpose');process.exit(4);},20);});
 server.listen(Number(process.env.FORMA_PORT),'127.0.0.1',()=>console.log('FORMA_LISTENING http://127.0.0.1:'+server.address().port));
`;
test('visit receives timings from spawn: the listening line, then the answered readiness request',async()=>{
  await withOwnedServer(process.execPath,['-e',program],process.cwd(),async(response,origin,output,timings)=>{
    const state=timings();
    assert(Number.isInteger(state.listeningMs)&&Number.isInteger(state.readyMs),JSON.stringify(state));
    assert(state.listeningMs>=0&&state.readyMs>=state.listeningMs&&state.elapsedMs>=state.readyMs,JSON.stringify(state));
    assert.equal(state.exited,false);assert.equal(typeof state.pid,'number');
  });
});
test('a failed visit keeps its error and carries the server side: timings, a fresh probe and the output tail',async()=>{
  const failure=new RangeError('browser check failed');
  await assert.rejects(withOwnedServer(process.execPath,['-e',program],process.cwd(),()=>{throw failure;}),error=>{
    assert.equal(error,failure);
    assert.match(error.message,/^browser check failed\n\[owned server\] pid \d+ at http:\/\/127\.0\.0\.1:\d+: FORMA_LISTENING \d+ ms after spawn, readiness GET \/ answered \d+ ms after spawn; the visit failed \d+ ms after spawn; the server was still running; probe after the failure: GET \/ answered 200 in \d+ ms\n\[owned server\] output FORMA_LISTENING http:\/\/127\.0\.0\.1:\d+/);
    assert.match(error.stack,/\[owned server\] pid/);
    return true;
  });
});
test('a server that stopped accepting is reported by the probe, not mistaken for a slow browser',async()=>{
  await assert.rejects(withOwnedServer(process.execPath,['-e',stopsAfterFirst],process.cwd(),()=>{throw new Error('page.goto: Timeout');}),
    /the server was still running; probe after the failure: GET \/ failed after \d+ ms \(TypeError: /);
});
test('a server that exits during the visit is reported as exited, with its last output',async()=>{
  await assert.rejects(withOwnedServer(process.execPath,['-e',exitsAfterFirst],process.cwd(),async(response,origin,output,timings)=>{
    for(let wait=0;wait<100&&!timings().exited;wait++)await new Promise(resolve=>setTimeout(resolve,50));
    throw new Error('visit saw the server go');
  }),/the server exited \(4\) \d+ ms after spawn; probe after the failure: not taken: the server had exited\n\[owned server\] output [\s\S]*leaving on purpose/);
});
test('a server that never announces readiness is refused with the budget it had',async()=>{
  await assert.rejects(withOwnedServer(process.execPath,['-e','setTimeout(()=>{},10_000)'],process.cwd(),()=>assert.fail('unexpected visit'),{timeout:300}),/never reported its bound address within 300 ms/);
});
