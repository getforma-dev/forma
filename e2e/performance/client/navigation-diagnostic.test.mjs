import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNavigationDiagnostic,observeNavigation,finishDiagnostic} from './navigation-diagnostic.mjs';
function setup(t,options={}){
 const root=mkdtempSync(join(tmpdir(),'forma-nav-control-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'diagnostic'),diagnostic=createNavigationDiagnostic(directory,{snapshot:()=>({processes:[]}),...options});
 const browser=Object.assign(new EventEmitter(),{isConnected:()=>true,version:()=> 'test-only'});
 const frame={url:()=> 'http://127.0.0.1:123/?bundle=forma.js'};
 const page=Object.assign(new EventEmitter(),{url:()=>frame.url(),isClosed:()=>false,mainFrame:()=>frame});
 diagnostic.engine('webkit','before');diagnostic.browser(browser,'webkit');
 const report=()=>JSON.parse(readFileSync(join(directory,'01-webkit-forma.js.json'),'utf8'));
 return {directory,diagnostic,page,browser,frame,report};
}
test('disabled observations run the original operation once without creating listeners',async()=>{
 let called=0;assert.equal(createNavigationDiagnostic(),null);
 assert.equal(await observeNavigation(null,null,null,'forma.js',()=>++called),1);assert.equal(called,1);
});
test('success records navigation and server response then removes hooks before benchmark samples',async t=>{
 const x=setup(t);let calls=0;
 const response=Object.assign(new EventEmitter(),{statusCode:200,getHeader:name=>({'content-type':'text/html','cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp'}[name])});
 const result=await observeNavigation(x.diagnostic,x.page,x.browser,'forma.js',async()=>{
  calls++;x.diagnostic.request({method:'GET',url:'/?bundle=forma.js'},response);response.emit('finish');
  x.page.emit('framenavigated',x.frame);x.page.emit('domcontentloaded');x.page.emit('load');return x.page;
 });
 assert.equal(result,x.page);assert.equal(calls,1);assert.deepEqual(x.page.eventNames(),[]);assert.deepEqual(response.eventNames(),[]);
 x.page.emit('pageerror',new Error('later sample'));assert.equal(x.report().passed,true);
 assert.deepEqual(x.report().events.map(r=>r.event),['begin','server-request','server-response-finish','main-frame-navigation','domcontentloaded','load','outcome']);
 assert.equal(x.report().events[2].data.coep,'require-corp');x.diagnostic.finish();assert.deepEqual(x.browser.eventNames(),[]);
});
test('original navigation error survives with request failure and no retry or evaluation',async t=>{
 const x=setup(t),original=new Error('goto timeout30000');let calls=0;
 await assert.rejects(observeNavigation(x.diagnostic,x.page,x.browser,'forma.js',async()=>{
  calls++;x.page.emit('requestfailed',{url:()=> 'http://127.0.0.1:123/assets/forma.js',failure:()=>({errorText:'connection failed'})});x.page.emit('pageerror',new Error('module refused'));throw original;
 }),error=>error===original);
 assert.equal(calls,1);assert.equal(x.report().passed,false);assert.match(x.report().outcome.error,/goto timeout30000/);assert.deepEqual(x.page.eventNames(),[]);
 assert(x.report().events.some(e=>e.event==='requestfailed'));assert(x.report().events.some(e=>e.event==='pageerror'));
});
test('bounded events explicitly report overflow and retain the final failure separately',async t=>{
 const x=setup(t),original=new Error('retained final error');
 await assert.rejects(observeNavigation(x.diagnostic,x.page,x.browser,'forma.js',async()=>{
  for(let i=0;i<700;i++)x.page.emit('load');throw original;
 }),error=>error===original);
 const r=x.report();assert.equal(r.events.length,512);assert(r.droppedEvents>0);assert.match(r.outcome.error,/retained final error/);assert(JSON.stringify(r).length<1024*1024);
});
test('diagnostic write failure is explicit and does not replace the original navigation error',async t=>{
 const x=setup(t,{write:(file,...args)=>{if(file.endsWith('forma.js.json'))throw new Error('disk full');return importWrite(file,...args);}});
 const original=new Error('navigation failed'),diagnosticErrors=[];
 await assert.rejects(observeNavigation(x.diagnostic,x.page,x.browser,'forma.js',()=>{throw original;},{reportError:error=>diagnosticErrors.push(error)}),error=>error===original);
 assert.equal(diagnosticErrors.length,1);assert.match(diagnosticErrors[0].message,/disk full/);assert.deepEqual(x.page.eventNames(),[]);
});
import {writeFileSync as importWrite} from 'node:fs';

test('outer diagnostic finish preserves a pending original failure',()=>{
 const original=new Error('original benchmark failure'),finishError=new Error('finish disk error'),reported=[];
 assert.throws(()=>{try{throw original;}finally{finishDiagnostic(()=>{throw finishError;},original,{reportError:error=>reported.push(error)});}},error=>error===original);
 assert.deepEqual(reported,[finishError]);
});
test('a diagnostic finish failure alone fails the diagnostic run',()=>{
 const error=new Error('finish disk error');assert.throws(()=>finishDiagnostic(()=>{throw error;}),caught=>caught===error);
});
