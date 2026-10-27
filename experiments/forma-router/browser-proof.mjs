import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw Error('loopback origin required');
const output = process.argv[3] || 'experiments/forma-router/evidence/browser-proof.json';
const result = { observedAt: new Date().toISOString(), origin, scope: 'Experimental native two-route/static-shell proof; not nested-layout, packed-release or complete ticket qualification.', browsers: [], results: [], failures: [] };
const engines = Object.fromEntries(Object.entries({ chromium, firefox, webkit }).filter(([name])=>!process.env.PROOF_ENGINES || process.env.PROOF_ENGINES.split(",").includes(name)));
for (const [engine, launcher] of Object.entries(engines)) {
  const browser = await launcher.launch(); result.browsers.push({ engine, version: browser.version() });
  async function scenario(name, callback, options={}) {
    if(process.env.PROOF_CASE && !name.includes(process.env.PROOF_CASE))return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', ...options });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.request.post(origin+'/__proof/reset');
    try {
      await callback(page, context);
      assert.deepEqual(errors, [], 'uncaught browser errors');
      result.results.push({ engine, name, status: 'passed' });
      console.log('PASS', engine, name);
    } catch(error) {
      const failure = { engine, name, status: 'failed', error: String(error.stack || error) };
      result.results.push(failure); result.failures.push(failure); console.error('FAIL', engine, name, error.message);
    } finally { await context.close(); }
  }
  async function open(page, path='/proof/a') {
    await page.goto(origin+path); await page.waitForFunction(()=>window.__formaProof);
    await page.evaluate(()=>window.__formaProof.ready);
    await page.evaluate(()=>{ window.__documentIdentity=document; window.__layoutIdentity=document.querySelector('#proof-layout'); window.__timeOrigin=performance.timeOrigin; });
  }
  async function same(page) {
    assert.equal(await page.evaluate(()=>document===window.__documentIdentity && document.querySelector('#proof-layout')===window.__layoutIdentity && performance.timeOrigin===window.__timeOrigin),true);
  }
  async function go(page,path,options={}) {
    const outcome=await page.evaluate(([p,o])=>window.__formaProof.navigate(p,o),[path,options]);
    assert.equal(outcome.kind,'committed',JSON.stringify(outcome));
  }
  await scenario('typed A-B-A keeps document/layout, fresh adopted controls and departing listeners stop',async page=>{
    await open(page); await page.locator('#layout-note').fill('retained');
    await page.evaluate(()=>{window.__oldButton=document.querySelector('#counter-a');window.__oldValue=document.querySelector('#value-a')});
    await page.locator('#to-b').click(); await page.waitForFunction(()=>window.__formaProof.committed.endsWith('/proof/b')&&document.querySelector('#proof-status').textContent==='Page ready');
    await same(page); assert.equal(await page.locator('#layout-note').inputValue(),'retained');
    await page.locator('#counter-b').click(); assert.equal(await page.locator('#value-b').innerText(),'1');
    assert.equal(await page.evaluate(()=>{window.__oldButton.click();return window.__oldValue.textContent}),'0');
    await page.locator('#island-input-b').fill('7'); assert.equal(await page.locator('#value-b').innerText(),'7');
    await go(page,'/proof/a'); await same(page); assert.equal(await page.locator('#value-a').innerText(),'0');
    assert.deepEqual(await page.evaluate(()=>window.__formaProof.metrics.errors),[]);
  });
  await scenario('latest navigation wins when delayed A finishes after B',async page=>{
    await open(page); const outcomes=await page.evaluate(async()=>{const a=window.__formaProof.navigate('/proof/a?delay=250');const b=window.__formaProof.navigate('/proof/b');return Promise.all([a,b])});
    assert.equal(outcomes[1].kind,'committed');await page.waitForTimeout(350);assert.equal(new URL(page.url()).pathname,'/proof/b');await same(page);
  });
  await scenario('hash, Back and Forward retain owners and avoid additional push',async page=>{
    await open(page); await go(page,'/proof/b');
    await page.evaluate(()=>window.__routeIdentity=document.querySelector('#proof-route'));
    const length=await page.evaluate(()=>history.length);await go(page,'/proof/b#route-title');
    assert.equal(await page.evaluate(()=>window.__routeIdentity===document.querySelector('#proof-route')),true);
    await page.goBack();await page.waitForFunction(()=>!location.hash);await page.goBack();await page.waitForFunction(()=>window.__formaProof.committed.endsWith('/proof/a'));
    await page.goForward();await page.waitForFunction(()=>window.__formaProof.committed.endsWith('/proof/b'));await same(page);
    assert.equal(await page.evaluate(()=>history.length),length+1);
  });
  await scenario('enhanced validation preserves form and valid submission refreshes Rust props once',async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('');await page.locator('#submit-update').click();
    await page.waitForFunction(()=>document.querySelector('#form-error').textContent.includes('Name must'));
    await same(page);assert.equal(await page.locator('#name-input').inputValue(),'');
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,0);
    await page.locator('#name-input').fill('Updated');await page.locator('#submit-update').click();
    await page.waitForFunction(()=>document.querySelector('#server-name').textContent==='Updated'&&window.__formaProof.actionPhase==='idle');
    await same(page);assert.equal(await page.locator('#value-a').innerText(),'1');
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('navigation during delayed POST keeps latest destination and revalidates it',async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('Late action');
    await page.evaluate(()=>{const i=document.createElement('input');i.type='hidden';i.name='delay';i.value='250';document.querySelector('#update-form').append(i)});
    const outcomes=await page.evaluate(async()=>{const p=window.__formaProof.submit(document.querySelector('#update-form'));await window.__formaProof.navigate('/proof/b');return p});
    assert.equal(outcomes.kind,'success');assert.equal(new URL(page.url()).pathname,'/proof/b');
    assert.equal(await page.locator('#server-name').innerText(),'Late action');await same(page);
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('busy competing submissions do not queue a second POST',async(page,context)=>{
    await open(page);await page.evaluate(()=>{const i=document.createElement('input');i.type='hidden';i.name='delay';i.value='200';document.querySelector('#update-form').append(i)});
    const results=await page.evaluate(()=>{const f=document.querySelector('#update-form');return Promise.all([window.__formaProof.submit(f),window.__formaProof.submit(f)])});
    assert.equal(results[1].kind,'busy');assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('security: lost mutation warning survives GET recovery without repeating POST',async(page,context)=>{
    await open(page);await page.evaluate(()=>{const i=document.createElement('input');i.type='hidden';i.name='fail_after';i.value='true';document.querySelector('#update-form').append(i)});
    const outcome=await page.evaluate(()=>window.__formaProof.submit(document.querySelector('#update-form')));
    assert.equal(outcome.kind,'uncertain');assert.match(await page.locator('#proof-status').innerText(),/unknown/);
    await go(page,'/proof/a',{revalidate:true});
    assert.match(await page.locator('#proof-status').innerText(),/outcome unknown/);
    const record=await page.evaluate(()=>window.__formaProof.uncertain);
    assert.equal(record.endpoint,'/proof/update');assert.equal(record.version,1);assert.ok(JSON.stringify(record).length<512);
    assert.deepEqual(Object.keys(record).sort(),['at','endpoint','reason','version']);
    await same(page);await page.reload();await page.waitForFunction(()=>window.__formaProof);await page.evaluate(()=>window.__formaProof.ready);
    assert.match(await page.locator('#proof-status').innerText(),/outcome unknown/);
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('forged CSRF is rejected before any mutation',async(page,context)=>{
    await open(page);await page.locator('input[name=csrf]').evaluate(e=>e.value='forged');
    const outcome=await page.evaluate(()=>window.__formaProof.submit(document.querySelector('#update-form')));assert.equal(outcome.kind,'error');
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,0);await same(page);
  });
  await scenario('typed 303 action redirects through GET and preserves document',async page=>{
    await open(page);await page.evaluate(()=>{const i=document.createElement('input');i.type='hidden';i.name='redirect';i.value='true';document.querySelector('#update-form').append(i)});
    const outcome=await page.evaluate(()=>window.__formaProof.submit(document.querySelector('#update-form')));assert.equal(outcome.kind,'success');
    assert.equal(new URL(page.url()).pathname,'/proof/b');await same(page);
  });
  await scenario('policy mismatch is an explicit document fallback',async page=>{
    await open(page); const before=await page.evaluate(()=>performance.timeOrigin);
    await Promise.all([page.waitForURL('**/proof/b?policy=changed'),page.evaluate(()=>window.__formaProof.navigate('/proof/b?policy=changed')).catch(()=>{})]);
    await page.waitForLoadState('load');assert.notEqual(await page.evaluate(()=>performance.timeOrigin),before);
    assert.equal(await page.locator('#route-title').innerText(),'Native route B');
  });
  await scenario('malformed native state is refused without replacing current route',async page=>{
    await open(page);await page.route('**/proof/b',async route=>{const r=await route.fetch();const d=await r.json();d.state={version:999};await route.fulfill({response:r,body:JSON.stringify(d)})});
    const outcome=await page.evaluate(()=>window.__formaProof.navigate('/proof/b'));assert.equal(outcome.kind,'failed');
    assert.equal(await page.locator('#route-title').innerText(),'Native route A');await same(page);
  });
  await scenario('security: slash attributes and custom markup are refused before import or constructors',async page=>{
    await open(page);
    await page.evaluate(()=>{
      window.__constructors=0;window.__imports=0;
      customElements.define('x-autonomous-proof',class extends HTMLElement{constructor(){super();window.__constructors++}});
      try{customElements.define('x-proof',class extends HTMLButtonElement{constructor(){super();window.__constructors++}},{extends:'button'})}catch{/* WebKit does not implement customized built-ins. */}
      const imported=Document.prototype.importNode;Document.prototype.importNode=function(...args){window.__imports++;return imported.apply(this,args)};
    });
    for(const malicious of ['<button/is="x-proof">bad</button>','<div/shadowrootmode="open">bad</div>','<div/srcdoc="bad">bad</div>','<x-autonomous-proof>bad</x-autonomous-proof>']){
      await page.route('**/proof/b',async route=>{const response=await route.fetch();const data=await response.json();data.html=data.html.replace('<h1',malicious+'<h1');await route.fulfill({response,body:JSON.stringify(data)})});
      const outcome=await page.evaluate(()=>window.__formaProof.navigate('/proof/b'));
      assert.equal(outcome.kind,'failed');assert.match(outcome.reason,/markup/);await page.unroute('**/proof/b');
    }
    assert.deepEqual(await page.evaluate(()=>({constructors:window.__constructors,imports:window.__imports})),{constructors:0,imports:0});
    assert.equal(await page.locator('#route-title').innerText(),'Native route A');await same(page);
  });
  await scenario('security: only the exact declared POST endpoint is enhanced and unsupported forms stay native',async(page,context)=>{
    await open(page);const requests=[];page.on('request',r=>{if(r.method()==='POST')requests.push({url:r.url(),accept:r.headers().accept,type:r.resourceType()})});
    const outcomes=await page.evaluate(async()=>{
      const form=document.querySelector('#update-form');const results=[];
      for(const path of ['/proof/not-declared','/proof/update?extra=1','/proof/update#fragment','/proof/../proof/update','/proof/%75pdate','http://','//'+location.host+'/proof/update']){
        form.setAttribute('action',path);results.push(await window.__formaProof.submit(form));
      }
      return results;
    });
    assert.ok(outcomes.every(x=>x.kind==='unsupported'));assert.equal(requests.length,0);
    assert.equal(await page.evaluate(()=>window.__formaProof.metrics.posts),0);
    await page.route('**/proof/not-declared',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><p id="native-fallback">Native unsupported endpoint</p>'}));
    await page.locator('#update-form').evaluate(form=>form.action='/proof/not-declared');
    await page.locator('#submit-update').click();await page.waitForURL('**/proof/not-declared');
    assert.equal(requests.length,1);assert.equal(requests[0].type,'document');assert.ok(!requests[0].accept.includes('application/vnd.forma.action+json'));
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,0);
  });
  await scenario('security: recursive formdata submission from a distinct form reserves exactly one POST',async(page,context)=>{
    await open(page);
    const outcomes=await page.evaluate(async()=>{
      const first=document.querySelector('#update-form');const second=first.cloneNode(true);second.id='second-form';document.querySelector('#proof-route').append(second);
      let nested;first.addEventListener('formdata',()=>{nested=window.__formaProof.submit(second)},{once:true});
      const outer=await window.__formaProof.submit(first);return {outer,nested:await nested,posts:window.__formaProof.metrics.posts};
    });
    assert.equal(outcomes.outer.kind,'success');assert.equal(outcomes.nested.kind,'busy');assert.equal(outcomes.posts,1);
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('security: disposed or revoked formdata ownership sends no POST',async(page,context)=>{
    for(const mode of ['before-dispose','during-dispose','during-invalidate','during-detach']){
      await open(page);const outcome=await page.evaluate(async mode=>{
        const form=document.querySelector('#update-form');
        if(mode==='before-dispose')window.__formaProof.dispose();
        else form.addEventListener('formdata',()=>{
          if(mode==='during-dispose')window.__formaProof.dispose();
          else if(mode==='during-invalidate')window.__formaProof.invalidateContext();
          else form.remove();
        },{once:true});
        return {result:await window.__formaProof.submit(form),posts:window.__formaProof.metrics.posts};
      },mode);
      assert.equal(outcome.result.kind,mode==='during-invalidate'?'context-invalidated':mode==='during-detach'?'stale-form':'disposed');assert.equal(outcome.posts,0);
    }
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,0);
  });
  await scenario('security: failed form serialization releases the reserved action slot',async(page,context)=>{
    await open(page);
    const outcomes=await page.evaluate(async()=>{
      const form=document.querySelector('#update-form');const foreign=document.createElement('button');foreign.type='submit';
      const failed=await window.__formaProof.submit(form,foreign);const before=window.__formaProof.metrics.posts;
      const succeeded=await window.__formaProof.submit(form);return {failed,before,succeeded};
    });
    assert.equal(outcomes.failed.kind,'failed');assert.equal(outcomes.before,0);assert.equal(outcomes.succeeded.kind,'success');
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('security: native context mismatch revokes live owners and private DOM before recovery',async page=>{
    await open(page);await go(page,'/proof/b');
    const outcomes=await page.evaluate(async()=>{
      const api=window.__formaProof,button=document.querySelector('#counter-b'),value=document.querySelector('#value-b'),form=document.querySelector('#update-form');
      const recoveries=[];api.setDocumentRecoveryForTest((url,replace)=>{button.click();recoveries.push({url,replace,value:value.textContent,privateNodes:document.querySelectorAll('#proof-route,#proof-layout,input,script[data-island-state]').length,scopes:api.metrics.scopes})});
      const stale=api.navigate('/proof/b?delay=250');const changed=api.navigate('/proof/a?context=changed');
      const result=await Promise.all([stale,changed]);return {result,recoveries,invalidated:api.invalidated,staleSubmit:await api.submit(form)};
    });
    assert.equal(outcomes.result[1].kind,'document');assert.equal(outcomes.invalidated,true);assert.equal(outcomes.staleSubmit.kind,'context-invalidated');
    assert.equal(outcomes.recoveries.length,1);assert.equal(outcomes.recoveries[0].value,'0');assert.equal(outcomes.recoveries[0].privateNodes,0);assert.equal(outcomes.recoveries[0].scopes,0);
    assert.equal(new URL(outcomes.recoveries[0].url).pathname,'/proof/a');await page.waitForTimeout(300);assert.equal(await page.locator('#proof-route').count(),0);
  });
  await scenario('security: explicit context invalidation revokes captured deferred island callbacks',async page=>{
    await open(page);
    await page.route('**/proof/b',async route=>{const response=await route.fetch();const data=await response.json();data.html=data.html.replace('data-forma-hydrate="load"','data-forma-hydrate="interaction"');await route.fulfill({response,body:JSON.stringify(data)})});
    await go(page,'/proof/b');
    const state=await page.evaluate(()=>{
      const api=window.__formaProof,host=document.querySelector('[data-forma-component="CounterB"]'),button=document.querySelector('#counter-b'),value=document.querySelector('#value-b');
      const deferred=host.__formaInteractionHandler;if(typeof deferred!=='function')throw Error('deferred callback was not armed');
      api.invalidateContext();deferred();button.click();
      return {value:value.textContent,disposed:host.__formaDisposed,connected:host.isConnected,scopes:api.metrics.scopes,errors:api.metrics.errors};
    });
    assert.deepEqual(state,{value:'0',disposed:true,connected:false,scopes:0,errors:[]});
  });
  await scenario('security: persisted pageshow revokes private owners before document recovery',async page=>{
    await open(page);await go(page,'/proof/b');
    const state=await page.evaluate(()=>{
      const api=window.__formaProof,button=document.querySelector('#counter-b'),value=document.querySelector('#value-b'),calls=[];
      api.setDocumentRecoveryForTest((url,replace)=>{button.click();calls.push({url,replace,value:value.textContent,privateNodes:document.querySelectorAll('#proof-route,input').length,scopes:api.metrics.scopes})});
      dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));return {invalidated:api.invalidated,calls};
    });
    assert.equal(state.invalidated,true);assert.equal(state.calls.length,1);assert.equal(state.calls[0].value,'0');assert.equal(state.calls[0].privateNodes,0);assert.equal(state.calls[0].scopes,0);assert.equal(state.calls[0].replace,true);
  });
  for(const field of ['context','endpoint'])await scenario(`security: action ${field} mismatch accepts no data and recovers without repeating POST`,async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('Actual server value');
    await page.evaluate(()=>{window.__recoveries=[];window.__formaProof.setDocumentRecoveryForTest((url,replace)=>window.__recoveries.push({url,replace,privateNodes:document.querySelectorAll('#proof-route,input').length}))});
    await page.route('**/proof/update',async route=>{const response=await route.fetch();const data=await response.json();data[field]=field==='context'?'unaccepted-context':'/proof/other';data.outcome='validation';data.data={message:'UNTRUSTED ACTION DATA'};await route.fulfill({response,body:JSON.stringify(data)})});
    const outcome=await page.evaluate(()=>window.__formaProof.submit(document.querySelector('#update-form')));
    assert.equal(outcome.kind,'uncertain');assert.equal(await page.evaluate(()=>window.__formaProof.invalidated),true);
    assert.ok(!(await page.locator('body').innerText()).includes('UNTRUSTED ACTION DATA'));
    const recoveries=await page.evaluate(()=>window.__recoveries);assert.equal(recoveries.length,1);assert.equal(recoveries[0].privateNodes,0);assert.equal(recoveries[0].url,origin+'/proof/a');
    await page.waitForTimeout(100);assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
    await page.unroute('**/proof/update');await page.reload();await page.waitForFunction(()=>window.__formaProof);await page.evaluate(()=>window.__formaProof.ready);
    assert.equal(await page.locator('#server-name').innerText(),'Actual server value');assert.match(await page.locator('#proof-status').innerText(),/outcome unknown/);
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  });
  await scenario('security: recovery loop storage omits query data and stops after 32 distinct attempts',async page=>{
    await open(page);
    const result=await page.evaluate(()=>{
      const api=window.__formaProof,calls=[];api.setDocumentRecoveryForTest((url,replace)=>calls.push({url,replace}));
      const codes=['foreign-history','bfcache-restore','action-identity','unknown-recovery',...['app','build','group','layout','context','policy'].flatMap(key=>[`incompatible-${key}`,`action-incompatible-${key}`])];
      const outcomes=[];for(const path of ['/proof/a','/proof/b'])for(const code of codes)outcomes.push(api.requestDocumentRecoveryForTest(path+'?secret=never-store-this#private',code));
      const capped=api.requestDocumentRecoveryForTest('/proof/a?another=private','foreign-history');
      const keys=Object.keys(sessionStorage),raw=keys.map(key=>key+':'+sessionStorage.getItem(key)).join('\n');
      const record=JSON.parse(sessionStorage.getItem('forma-proof-recovery:forma-router-proof'));
      return {outcomes,capped,calls:calls.length,keys,raw,record,metrics:api.metrics.fallbacks.length,status:document.querySelector('#proof-status').textContent};
    });
    assert.equal(result.outcomes.length,32);assert.ok(result.outcomes.every(x=>x.kind==='document'));
    assert.equal(result.calls,32);assert.equal(result.capped.kind,'refused');assert.equal(result.capped.reason,'recovery limit reached');
    assert.equal(result.record.attempts.length,32);assert.equal(new Set(result.record.attempts).size,32);assert.equal(result.metrics,32);
    assert.deepEqual(result.keys,['forma-proof-recovery:forma-router-proof']);assert.ok(result.raw.length<4096);
    for(const privateValue of ['secret','never-store-this','private','http:','/proof/','?','#'])assert.ok(!result.raw.includes(privateValue));
    assert.match(result.status,/recovery limit reached/);
  });
  await scenario('security: stale validation and error outcomes cannot announce over a newer route',async(page,context)=>{
    for(const outcomeKind of ['validation','error']){
      await open(page);
      if(outcomeKind==='validation')await page.locator('#name-input').fill('');
      else await page.locator('input[name=csrf]').evaluate(input=>input.value='invalid');
      let release,observed;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>observed=resolve);
      await page.route('**/proof/update',async route=>{const response=await route.fetch();observed();await gate;await route.fulfill({response})});
      const pending=page.evaluate(()=>window.__formaProof.submit(document.querySelector('#update-form')));
      await seen;await go(page,'/proof/b');const before=await page.locator('#proof-status').innerText();release();
      const outcome=await pending;assert.equal(outcome.kind,outcomeKind);assert.equal(before,'Page ready');
      assert.equal(await page.locator('#proof-status').innerText(),before);assert.ok(!(await page.locator('#form-error').innerText()).includes('Submission'));
      await page.unroute('**/proof/update');
    }
    assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,0);
  });
  await scenario('100 route cycles keep one scope and exactly one click handler',async page=>{
    await open(page);
    const rounds=await page.evaluate(async()=>{for(let i=0;i<100;i++){const r=await window.__formaProof.navigate(i%2?'/proof/a':'/proof/b');if(r.kind!=='committed')return {i,r}}return window.__formaProof.metrics});
    assert.ok(!('i' in rounds), JSON.stringify(rounds)); assert.equal(rounds.scopes,1);assert.equal(rounds.commits,100);assert.equal(rounds.disposed,99);
    await page.locator('#counter-a').click();assert.equal(await page.locator('#value-a').innerText(),'1');assert.deepEqual(rounds.errors,[]);await same(page);
  });
  await scenario('dispose revokes route and restores scroll policy',async page=>{
    await open(page);await go(page,'/proof/b');
    const state=await page.evaluate(()=>{const b=document.querySelector('#counter-b');const v=document.querySelector('#value-b');window.__formaProof.dispose();b.click();return {value:v.textContent,scopes:window.__formaProof.metrics.scopes,scroll:history.scrollRestoration}});
    assert.equal(state.value,'0');assert.equal(state.scopes,0);assert.equal(state.scroll,'auto');
  });
  await scenario('direct entry and explicit refresh render complete native HTML',async page=>{
    await open(page,'/proof/b');const before=await page.evaluate(()=>performance.timeOrigin);await page.reload();await page.waitForFunction(()=>window.__formaProof);
    assert.notEqual(await page.evaluate(()=>performance.timeOrigin),before);assert.equal(await page.locator('#route-title').innerText(),'Native route B');
  });
  await scenario('no-JavaScript links, validation and form mutation use same Rust handler',async(page,context)=>{
    await page.goto(origin+'/proof/a');await page.locator('#to-b').click();assert.equal(new URL(page.url()).pathname,'/proof/b');
    await page.locator('#name-input').fill('');await page.locator('#submit-update').click();assert.match(await page.locator('#form-error').innerText(),/Name must/);
    await page.locator('#name-input').fill('Native submit');await page.locator('#submit-update').click();await page.waitForURL('**/proof/a');
    assert.equal(await page.locator('#server-name').innerText(),'Native submit');assert.equal((await(await context.request.get(origin+'/__proof/state')).json()).posts,1);
  },{javaScriptEnabled:false});
  await browser.close();
}
const source=await readFile('experiments/forma-router/client.ts');
result.clientSha256=createHash('sha256').update(source).digest('hex');
result.manifest=JSON.parse(await readFile('experiments/forma-router/dist/manifest.json','utf8'));
result.passed=result.failures.length===0;
await mkdir(new URL('.',new URL(output,`file://${process.cwd()}/`)),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,checks:result.results.length,failures:result.failures.length,output}));
process.exitCode=result.passed?0:1;
