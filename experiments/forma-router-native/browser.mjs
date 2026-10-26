import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const origin = process.argv[2], output = process.argv[3] ?? resolve(here,'evidence/browser.json');
if (existsSync(output)) throw Error('Refusing to overwrite an existing browser receipt');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? '')) throw Error('Explicit loopback origin required');
const sha = data => createHash('sha256').update(data).digest('hex');
async function artifacts() {
  const entries = {};
  for (const folder of ['dist','dist-next']) for (const file of await readdir(resolve(here,folder))) entries[`${folder}/${file}`] = sha(await readFile(resolve(here,folder,file)));
  return entries;
}
async function sourceFiles() {
  const files = {};
  async function visit(dir) {
    for (const entry of await readdir(dir,{withFileTypes:true})) {
      if (['node_modules','dist','dist-next','dist-perf','dist-perf-document','target','evidence','.git'].includes(entry.name)) continue;
      const path=resolve(dir,entry.name);
      if(entry.isDirectory()) await visit(path); else files[path.slice(process.cwd().length+1)] = sha(await readFile(path));
    }
  }
  for (const dir of ['packages/core/src','packages/router/src','packages/compiler/src','packages/build/src','crates/forma-server/src','experiments/forma-router-native']) await visit(resolve(dir));
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
const result = { at:new Date().toISOString(), command:process.argv, node:process.version, source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}), diffSha256:sha(execFileSync('git',['diff','--binary'])), artifacts:await artifacts(), sourceFiles:await sourceFiles(), serverBinarySha256:sha(await readFile(process.env.NATIVE_SERVER_BINARY ?? resolve(here,"server/target/debug/forma-router-native-fixture"))), scope:'Source integration of actual public compiler/build/core/router/server; not packed release, deployment or manual accessibility qualification.', browsers:[], results:[], failures:[] };
for (const [engine, launcher] of Object.entries({chromium,firefox,webkit})) {
  if (process.env.NATIVE_ENGINES && !process.env.NATIVE_ENGINES.split(',').includes(engine)) continue;
  const browser = await launcher.launch(); result.browsers.push({engine,version:browser.version()});
  async function scenario(name, ids, callback, options={}) {
    if (process.env.NATIVE_CASE && !name.includes(process.env.NATIVE_CASE)) return;
    const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',...options});
    const page = await context.newPage(); const errors = []; page.on('pageerror', error=>errors.push(error.message));
    await context.request.post(origin+'/__native/reset');
    try { await callback(page,context); assert.deepEqual(errors,[],'uncaught browser errors'); result.results.push({engine,name,ids,status:'passed'}); console.log('PASS',engine,name); }
    catch(error) { const item={engine,name,ids,status:'failed',error:String(error.stack??error)}; result.results.push(item);result.failures.push(item);console.error('FAIL',engine,name,error.message); }
    finally {await context.close();}
  }
  async function ready(page) {await page.waitForFunction(()=>window.__native);await page.evaluate(()=>window.__native.ready);}
  async function recovered(page,release) {const navigation=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());release();await navigation;await page.waitForLoadState('load');await ready(page);}
  async function open(page,path='/native/a') {await page.goto(origin+path);await ready(page);await page.evaluate(()=>{window.__document=document;window.__layout=document.querySelector('#native-layout');window.__layoutIsland=document.querySelector('#layout-counter').closest('[data-forma-island]');window.__timeOrigin=performance.timeOrigin;});}
  async function same(page) {assert.equal(await page.evaluate(()=>document===window.__document&&document.querySelector('#native-layout')===window.__layout&&document.querySelector('#layout-counter').closest('[data-forma-island]')===window.__layoutIsland&&performance.timeOrigin===window.__timeOrigin),true,'normal transition must preserve actual document and layout island');}
  async function go(page,path,options={}) {const outcome=await page.evaluate(async([path,options])=>{const value=await window.__native.router.navigate(path,options);if(value.kind==='committed')await value.ready;return {kind:value.kind,code:value.code};},[path,options]);assert.equal(outcome.kind,'committed',JSON.stringify(outcome));return outcome;}
  async function state(context) {return (await context.request.get(origin+'/__native/state')).json();}
  async function hidden(page,name,value) {await page.evaluate(([name,value])=>{const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;document.querySelector('#update-form').append(input);},[name,value]);}
  async function submit(page) {return page.evaluate(()=>window.__native.router.submit(document.querySelector('#update-form')));}
  async function holdBack(page) {
    await open(page,'/native/a?entry=first');await go(page,'/native/b?entry=middle');await go(page,'/native/a?entry=current');
    const length=await page.evaluate(()=>{let first=true;window.__backGuardEntered=false;window.__removeBackGuard=window.__native.router.beforeLeave(()=>{if(!first)return true;first=false;window.__backGuardEntered=true;return new Promise(resolve=>window.__releaseBackGuard=resolve);});history.back();return history.length;});
    await page.waitForFunction(()=>window.__backGuardEntered&&location.search==='?entry=middle');
    assert.equal(await page.locator('#route-title').innerText(),'Native route A');return length;
  }
  async function repairedBack(page,length) {
    await page.waitForFunction(()=>location.pathname==='/native/a'&&location.search==='?entry=current'&&window.__native.router.location().url.search==='?entry=current');
    assert.equal(await page.evaluate(()=>history.length),length);await page.evaluate(()=>{window.__removeBackGuard();window.__releaseBackGuard(true);});await page.waitForTimeout(80);
    assert.equal(new URL(page.url()).search,'?entry=current');await same(page);
    await page.evaluate(()=>history.back());await page.waitForFunction(()=>window.__native.router.location().url.search==='?entry=middle'&&!window.__native.router.pending());assert.equal(new URL(page.url()).pathname,'/native/b');await same(page);
  }

  await scenario('native nested owner A-B-A retains layout island and disposes departing leaf', ['RT-N01','RT-O01','RT-N04'], async page=>{
    await open(page);await page.locator('#layout-counter').click();await page.locator('#layout-note').fill('retained');
    await page.evaluate(()=>{window.__oldButton=document.querySelector('#counter-a');window.__oldOutput=document.querySelector('#value-a');window.__oldLeaf=document.querySelector('[data-forma-owner=a]');});
    await page.locator('#to-b').click();await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/b'&&document.querySelector('#counter-b'));
    await page.locator('#counter-b').click();assert.equal(await page.locator('#value-b').innerText(),'1');await same(page);
    assert.equal(await page.locator('#layout-count').innerText(),'1');assert.equal(await page.locator('#layout-note').inputValue(),'retained');
    assert.equal(await page.evaluate(()=>{window.__oldButton.click();return window.__oldOutput.textContent;}),'0');
    assert.equal(await page.evaluate(()=>window.__oldLeaf.isConnected),false);
    await go(page,'/native/a');await same(page);assert.equal(await page.locator('#value-a').innerText(),'0');
    assert.deepEqual(await page.evaluate(()=>window.__native.metrics.errors),[]);
  });
  await scenario('scheduled island readiness preserves original served nodes', ['RT-C04','RT-N04'], async page=>{
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/_assets/*.js',async route=>{await gate;await route.continue();});
    await page.goto(origin+'/native/a',{waitUntil:'commit'});await page.locator('#island-input-a').waitFor();
    await page.locator('#island-input-a').fill('9');await page.evaluate(()=>window.__served=document.querySelector('#island-input-a'));
    release();await ready(page);assert.equal(await page.evaluate(()=>window.__served===document.querySelector('#island-input-a')),true);
    assert.equal(await page.locator('#island-input-a').inputValue(),'9');assert.equal(await page.locator('#value-a').innerText(),'9');
  });
  await scenario('latest held GET wins and stale response cannot change title URL or layout', ['RT-C01','RT-C02'], async page=>{
    await open(page);const results=await page.evaluate(async()=>{const old=window.__native.router.navigate('/native/a?delay=250');const current=window.__native.router.navigate('/native/b');return Promise.all([old,current]).then(values=>values.map(value=>value.kind));});
    assert.equal(results[1],'committed');await page.waitForTimeout(350);assert.equal(new URL(page.url()).pathname,'/native/b');assert.equal(await page.title(),'Proof B');await same(page);
  });
  await scenario('hash query revalidation Back Forward and replace preserve history ownership', ['RT-H01','RT-U05','RT-A02'], async(page,context)=>{
    await open(page);await page.evaluate(()=>history.replaceState({...history.state,applicationValue:42},'',location.href));const first=await page.evaluate(()=>history.length);
    await go(page,'/native/b');await page.evaluate(()=>window.__leaf=document.querySelector('[data-forma-owner=b]'));
    const before=await state(context);await go(page,'#route-title');assert.equal((await state(context)).gets,before.gets);
    assert.equal(await page.evaluate(()=>window.__leaf===document.querySelector('[data-forma-owner=b]')),true);
    await page.goBack();await page.waitForFunction(()=>!location.hash);await page.goBack();await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/a');
    await page.goForward();await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/b');await same(page);
    const length=await page.evaluate(()=>history.length);await go(page,'/native/a',{replace:true});assert.equal(await page.evaluate(()=>history.length),length);assert.equal(length,first+2);
    assert.equal(await page.evaluate(()=>history.state.applicationValue),42);
    const revalidated=await page.evaluate(async()=>{const value=await window.__native.router.revalidate();if(value.kind==='committed')await value.ready;return value.kind;});assert.equal(revalidated,'committed');
  });
  await scenario('revalidation repairs a held POP cursor before current-view data refresh', ['RT-H01','RT-H02','RT-U03','RT-F05'], async page=>{
    const length=await holdBack(page);const value=await page.evaluate(async()=>{const result=await window.__native.router.revalidate();if(result.kind==='committed')await result.ready;return result.kind;});assert.equal(value,'committed');await repairedBack(page,length);
  });
  await scenario('valid foreground context verification restores the cancelled POP cursor', ['RT-H02','RT-H03','RT-S05'], async page=>{
    const length=await holdBack(page);const verified=page.waitForResponse(response=>response.url().endsWith('/__native/context'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal((await verified).status(),200);await repairedBack(page,length);
  });
  await scenario('POST during a held POP restores the committed cursor and refreshes that branch', ['RT-H02','RT-F05','RT-F06'], async(page,context)=>{
    const length=await holdBack(page);await page.locator('#name-input').fill('Mutation on committed A');assert.equal((await submit(page)).kind,'success');await page.waitForFunction(()=>document.querySelector('#server-name').textContent==='Mutation on committed A');assert.equal((await state(context)).posts,1);await repairedBack(page,length);
  });
  await scenario('validation preserves form values and accessible summary without push', ['RT-F03','RT-A01'], async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('');const history=await page.evaluate(()=>window.history.length);const outcome=await submit(page);assert.equal(outcome.kind,'validation');
    assert.equal(await page.locator('#name-input').inputValue(),'');assert.match(await page.locator('#form-error').innerText(),/Name must/);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'form-error');assert.equal(await page.evaluate(()=>window.history.length),history);assert.equal((await state(context)).posts,0);await same(page);
  });
  await scenario('successful typed POST refreshes props and replaces leaf while retaining layout', ['RT-F01','RT-F05','RT-O03'], async(page,context)=>{
    await open(page);await page.locator('#layout-counter').click();await page.locator('#name-input').fill('Fresh server value');await page.evaluate(()=>window.__leaf=document.querySelector('[data-forma-owner=a]'));
    assert.equal((await submit(page)).kind,'success');await page.waitForFunction(()=>document.querySelector('#server-name').textContent==='Fresh server value');await same(page);
    assert.equal(await page.locator('#value-a').innerText(),'1');assert.equal(await page.locator('#layout-count').innerText(),'1');assert.equal(await page.evaluate(()=>window.__leaf===document.querySelector('[data-forma-owner=a]')),false);assert.equal((await state(context)).posts,1);
  });
  await scenario('managed GET form preserves query serialization without POST', ['RT-F01','RT-F02'], async(page,context)=>{
    await open(page);await page.evaluate(()=>{const form=document.createElement('form');form.method='get';form.action='/native/b';form.id='search-form';for(const [name,value] of [['q','a+b c'],['q','second']]){const input=document.createElement('input');input.name=name;input.value=value;form.append(input);}document.querySelector('#native-layout').append(form);});
    const value=await page.evaluate(()=>window.__native.router.submit(document.querySelector('#search-form')));assert.equal(value.kind,'success');assert.equal(new URL(page.url()).pathname,'/native/b');assert.deepEqual(new URL(page.url()).searchParams.getAll('q'),['a+b c','second']);assert.equal((await state(context)).posts,0);await same(page);
  });
  await scenario('navigation during delayed POST revalidates newer current route', ['RT-F05','RT-F06'], async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('Delayed current');await hidden(page,'delay','250');
    const transmitted=page.waitForRequest(request=>request.url().endsWith('/native/update')&&request.method()==='POST');await page.evaluate(()=>{window.__action=window.__native.router.submit(document.querySelector('#update-form'));});await transmitted;await go(page,'/native/b');const value=await page.evaluate(()=>window.__action);
    assert.equal(value.kind,'success');await page.waitForFunction(()=>document.querySelector('#server-name').textContent==='Delayed current');assert.equal(new URL(page.url()).pathname,'/native/b');await same(page);assert.equal((await state(context)).posts,1);
  });
  await scenario('competing submissions are busy and never queue a second send', ['RT-F04'], async(page,context)=>{
    await open(page);await hidden(page,'delay','200');const values=await page.evaluate(()=>{const form=document.querySelector('#update-form');return Promise.all([window.__native.router.submit(form),window.__native.router.submit(form)]);});assert.equal(values[1].kind,'busy');assert.equal((await state(context)).posts,1);
  });
  await scenario('lost action result remains uncertain across GET and reload with one POST', ['RT-F07'], async(page,context)=>{
    await open(page);await hidden(page,'fail_after','true');assert.equal((await submit(page)).kind,'uncertain');assert.match(await page.locator('[data-forma-router-status]').innerText(),/unknown/i);
    await go(page,'/native/b');assert.match(await page.locator('[data-forma-router-status]').innerText(),/unknown/i);assert.equal((await state(context)).posts,1);
    await page.reload();await ready(page);assert.match(await page.locator('[data-forma-router-status]').innerText(),/unknown/i);assert.equal((await state(context)).posts,1);
  });
  await scenario('real CSRF refusal revokes safely and undeclared endpoint never transmits', ['RT-F08','RT-F09','RT-S05'], async(page,context)=>{
    await open(page);await page.locator('#update-form').evaluate(form=>form.action='/native/undeclared');assert.equal((await submit(page)).kind,'unsupported');assert.equal((await state(context)).posts,0);
    await page.locator('#update-form').evaluate(form=>form.action='/native/update');await page.locator('input[name=csrf]').evaluate(input=>input.value='forged');
    let release,received;const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve);let documents=0;
    await page.route('**/native/a',async route=>{if(route.request().isNavigationRequest()){documents++;received();await gate;}await route.continue();});
    const value=await page.evaluate(async()=>{const root=document.querySelector('[data-forma-router-root]');const result=await window.__native.router.submit(document.querySelector('#update-form'));return {kind:result.kind,html:root.innerHTML};});assert.equal(value.kind,'uncertain');assert.equal(value.html,'');await requested;assert.equal((await state(context)).posts,0);assert.equal(documents,1);
    await recovered(page,release);assert.equal((await state(context)).posts,0);
  });
  await scenario('explicit POST redirect becomes one admitted GET and preserves document', ['RT-F09'], async(page,context)=>{
    await open(page);await hidden(page,'redirect','true');assert.equal((await submit(page)).kind,'success');await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/b');await same(page);assert.equal((await state(context)).posts,1);
  });
  await scenario('formdata reentrant submission reserves one POST and dispose transmits none', ['RT-F04','RT-F02'], async(page,context)=>{
    await open(page);await page.evaluate(()=>{const form=document.querySelector('#update-form');const second=form.cloneNode(true);second.id='second-form';document.querySelector('#native-layout').append(second);form.addEventListener('formdata',()=>window.__reentrant=window.__native.router.submit(second),{once:true});});
    assert.equal((await submit(page)).kind,'success');assert.equal(await page.evaluate(async()=>(await window.__reentrant).kind),'busy');assert.equal((await state(context)).posts,1);
    await context.request.post(origin+'/__native/reset');await open(page);await page.evaluate(()=>document.querySelector('#update-form').addEventListener('formdata',()=>window.__native.router.dispose(),{once:true}));assert.equal((await submit(page)).kind,'disposed');assert.equal((await state(context)).posts,0);
  });
  await scenario('late validation settlement cannot discard the newer held GET destination', ['RT-F05','RT-F06'], async(page,context)=>{
    await open(page);await page.locator('#name-input').fill('');let release,received;const gate=new Promise(resolve=>release=resolve),posted=new Promise(resolve=>received=resolve);
    await page.route('**/native/update',async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response});});
    await page.evaluate(()=>{window.__validation=window.__native.router.submit(document.querySelector('#update-form'));});await posted;
    await page.evaluate(()=>{window.__navigation=window.__native.router.navigate('/native/b?delay=250');});release();assert.equal(await page.evaluate(async()=>(await window.__validation).kind),'validation');
    await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/b'&&!window.__native.router.pending());assert.equal(await page.locator('#server-name').innerText(),'Initial');assert.equal((await state(context)).posts,0);await same(page);
  });
  await scenario('explicit context revocation clears owners before recovery and stale GET cannot reactivate', ['RT-S05','RT-C02'], async(page,context)=>{
    await open(page);await page.locator('#layout-counter').click();await context.request.post(origin+'/__native/context');let release,received;const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve);let documents=0;
    await page.route('**/native/a',async route=>{if(route.request().isNavigationRequest()){documents++;received();await gate;}await route.continue();});
    const revoked=await page.evaluate(()=>{const root=document.querySelector('[data-forma-router-root]'),oldButton=document.querySelector('#layout-counter'),oldCount=document.querySelector('#layout-count');void window.__native.router.navigate('/native/b?delay=250');window.__native.router.invalidateContext();oldButton.click();return {html:root.innerHTML,state:document.querySelectorAll('script[data-island-state]').length,count:oldCount.textContent};});assert.deepEqual(revoked,{html:'',state:0,count:'1'});await requested;assert.equal(documents,1);
    await recovered(page,release);await page.waitForTimeout(300);assert.equal(new URL(page.url()).pathname,'/native/a');assert.equal(await page.locator('#layout-count').innerText(),'0');
  });
  await scenario('foreground context check and persisted pageshow each use a fresh document boundary', ['RT-S05','RT-H03'], async(page,context)=>{
    await open(page);let time=await page.evaluate(()=>performance.timeOrigin);await context.request.post(origin+'/__native/context');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(before=>performance.timeOrigin!==before,time);await ready(page);time=await page.evaluate(()=>performance.timeOrigin);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.waitForFunction(before=>performance.timeOrigin!==before,time);await ready(page);
    assert.equal(await page.locator('#route-title').innerText(),'Native route A');
  });
  await scenario('held valid context verification blocks new navigation and POST until admission', ['RT-S05','RT-F08'], async(page,context)=>{
    for (const operation of ['navigation','post']) {
      await context.request.post(origin+'/__native/reset');await open(page);let release,received;const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve);
      await page.route('**/__native/context',async route=>{received();await gate;await route.continue();});
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await requested;const before=await state(context);
      await page.evaluate(operation=>{window.__blockedSettled=false;window.__blocked=operation==='navigation'?window.__native.router.navigate('/native/b'):window.__native.router.submit(document.querySelector('#update-form'));window.__blocked.then(()=>window.__blockedSettled=true);},operation);
      await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__blockedSettled),false);const held=await state(context);assert.equal(held.gets,before.gets);assert.equal(held.posts,0);
      release();assert.equal(await page.evaluate(async()=>(await window.__blocked).kind),operation==='navigation'?'committed':'success');await same(page);await page.unroute('**/__native/context');
    }
  });
  await scenario('held stale context verification refuses a queued mutation before transmission', ['RT-S05','RT-F08'], async(page,context)=>{
    await open(page);await context.request.post(origin+'/__native/context');let release,received,releaseDocument,receivedDocument;
    const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve),documentGate=new Promise(resolve=>releaseDocument=resolve),documentRequested=new Promise(resolve=>receivedDocument=resolve);
    await page.route('**/__native/context',async route=>{received();await gate;await route.continue();});
    await page.route('**/native/a',async route=>{if(route.request().isNavigationRequest()){receivedDocument();await documentGate;}await route.continue();});
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await requested;
    await page.evaluate(()=>{const root=document.querySelector('[data-forma-router-root]');window.__blocked=window.__native.router.submit(document.querySelector('#update-form')).then(value=>({kind:value.kind,html:root.innerHTML}));});await page.waitForTimeout(75);assert.equal((await state(context)).posts,0);
    const settled=page.evaluate(()=>{window.__awaitingBlocked=true;return window.__blocked;});await page.waitForFunction(()=>window.__awaitingBlocked);release();const value=await settled;assert.equal(value.kind,'disposed');assert.equal(value.html,'');await documentRequested;assert.equal((await state(context)).posts,0);await recovered(page,releaseDocument);
  });
  await scenario('real changed policy makes one explicit document boundary', ['RT-S01','RT-X02'], async page=>{
    await open(page);const before=await page.evaluate(()=>performance.timeOrigin);
    await Promise.all([page.waitForURL('**/native/b?policy=changed'),page.evaluate(()=>window.__native.router.navigate('/native/b?policy=changed')).catch(()=>{})]);await page.waitForLoadState('load');await ready(page);
    assert.notEqual(await page.evaluate(()=>performance.timeOrigin),before);assert.equal(await page.locator('#route-title').innerText(),'Native route B');
  });
  await scenario('actual second compiled build cannot mix owners and requires document boundary', ['RT-S02','RT-X02'], async page=>{
    await open(page);const before=await page.evaluate(()=>({time:performance.timeOrigin,build:window.__native.bootstrap.build}));
    await Promise.all([page.waitForURL('**/native/b?build=changed'),page.evaluate(()=>window.__native.router.navigate('/native/b?build=changed')).catch(()=>{})]);await page.waitForLoadState('load');await ready(page);
    const after=await page.evaluate(()=>({time:performance.timeOrigin,build:window.__native.bootstrap.build,generation:document.documentElement.dataset.nativeGeneration}));assert.notEqual(after.time,before.time);assert.notEqual(after.build,before.build);assert.equal(after.generation,'next');
  });
  await scenario('malformed scoped state refuses destination activation before one document recovery', ['RT-N02','RT-N03','RT-X02'], async page=>{
    await open(page);let release,received;const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve);let documents=0;
    await page.route('**/native/b',async route=>{if(route.request().isNavigationRequest()){documents++;received();await gate;return route.continue();}const response=await route.fetch();const data=await response.json();data.owners[1].state={v:999,s:[],i:[]};await route.fulfill({response,body:JSON.stringify(data)});});
    const value=await page.evaluate(async()=>{const root=document.querySelector('[data-forma-router-root]'),layout=document.querySelector('#native-layout');const outcome=await window.__native.router.navigate('/native/b');return {kind:outcome.kind,title:root.querySelector('#route-title')?.textContent,destinations:root.querySelectorAll('#counter-b').length,same:layout===root.querySelector('#native-layout')};});assert.deepEqual(value,{kind:'document-navigation',title:'Native route A',destinations:0,same:true});await requested;assert.equal(documents,1);
    release();await page.waitForURL('**/native/b');await page.waitForLoadState('load');await ready(page);assert.equal(await page.locator('#route-title').innerText(),'Native route B');
  });
  await scenario('hostile markup never upgrades and repeated recovery is bounded', ['RT-S04','RT-S06','RT-X02'], async page=>{
    for(const [index,fragment] of ['<native-hostile></native-hostile>','<div/is="native-hostile"></div>','<div shadowrootmode="open"></div>'].entries()) {
      await open(page);await page.evaluate(()=>{window.__upgrades=0;customElements.define('native-hostile',class extends HTMLElement{constructor(){super();window.__upgrades++;}});});
      let release,received;const gate=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>received=resolve);let documents=0;
      await page.route('**/native/b',async route=>{if(route.request().isNavigationRequest()){documents++;received();await gate;return route.continue();}const response=await route.fetch();const data=await response.json();data.owners[1].html=data.owners[1].html.replace('</div>',fragment+'</div>');await route.fulfill({response,body:JSON.stringify(data)});});
      const value=await page.evaluate(async()=>{const root=document.querySelector('[data-forma-router-root]'),layout=document.querySelector('#native-layout');const result=await window.__native.router.navigate('/native/b');return {kind:result.kind,code:result.code,upgrades:window.__upgrades,same:layout===root.querySelector('#native-layout')};});assert.equal(value.upgrades,0);assert.equal(value.same,true);
      if(index===0){assert.equal(value.kind,'document-navigation');await requested;assert.equal(documents,1);release();await page.waitForURL('**/native/b');await page.waitForLoadState('load');await ready(page);}else{assert.equal(value.kind,'failed');assert.equal(value.code,'ROUTER_RECOVERY_LIMIT');assert.equal(documents,0);release();}
      await page.unroute('**/native/b');
    }
  });
  await scenario('typed404 and GET redirect preserve status semantics and one final history entry', ['RT-X01','RT-H04'], async(page,context)=>{
    await open(page);const direct=await context.request.get(origin+'/native/b?status=404',{headers:{Accept:'application/vnd.forma.navigation+json'}});assert.equal(direct.status(),404);assert.equal((await direct.json()).kind,'error');
    await go(page,'/native/b?status=404');await same(page);assert.equal(await page.locator('#route-title').innerText(),'Native route B');
    const length=await page.evaluate(()=>history.length);await go(page,'/native/a?redirect=1');assert.equal(new URL(page.url()).pathname,'/native/b');assert.equal(await page.evaluate(()=>history.length),length+1);await same(page);
  });
  await scenario('direct refresh and no-JavaScript native forms render fresh typed HTML', ['RT-N05','RT-F01'], async(page,context)=>{
    const response=await page.goto(origin+'/native/a');assert.equal(response.status(),200);assert.equal(response.headers()['cache-control'],'no-store');assert.equal(await page.locator('#server-name').innerText(),'Initial');
    await page.locator('#name-input').fill('Native form update');await Promise.all([page.waitForURL('**/native/a'),page.locator('#submit-update').click()]);await page.waitForLoadState('load');assert.equal(await page.locator('#server-name').innerText(),'Native form update');assert.equal((await state(context)).posts,1);
    await page.locator('#to-b').click();await page.waitForURL('**/native/b');await page.reload();assert.equal(await page.locator('#server-name').innerText(),'Native form update');assert.equal(await page.locator('#value-b').innerText(),'1');
  },{javaScriptEnabled:false});
  await scenario('100 retained-layout route cycles leave departing click handlers inactive', ['RT-O02','RT-M03'], async page=>{
    await page.addInitScript(()=>{
      const entries=[];window.__nativeListeners=entries;
      const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
      const capture=options=>typeof options==='boolean'?options:!!options?.capture;
      EventTarget.prototype.addEventListener=function(type,listener,options){if(this instanceof Element&&this.closest('[data-forma-island]')&&listener&&!entries.some(entry=>entry.target===this&&entry.type===type&&entry.listener===listener&&entry.capture===capture(options))){const entry={target:this,type,listener,capture:capture(options)};entries.push(entry);if(options&&typeof options==='object'&&options.signal){const forget=()=>{const at=entries.indexOf(entry);if(at>=0)entries.splice(at,1);};if(options.signal.aborted)forget();else add.call(options.signal,'abort',forget,{once:true});}}return add.call(this,type,listener,options);};
      EventTarget.prototype.removeEventListener=function(type,listener,options){const at=entries.findIndex(entry=>entry.target===this&&entry.type===type&&entry.listener===listener&&entry.capture===capture(options));if(at>=0)entries.splice(at,1);return remove.call(this,type,listener,options);};
      const timers=new Set;window.__nativeTimers=timers;const timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
      window.setTimeout=(callback,ms,...args)=>{const id=timeout(()=>{timers.delete(id);callback(...args);},ms);timers.add(id);return id;};window.clearTimeout=id=>{timers.delete(id);clear(id);};
    });
    await open(page);await page.locator('#layout-counter').click();const baseline=await page.evaluate(()=>({listeners:window.__nativeListeners.length,timers:window.__nativeTimers.size}));assert.ok(baseline.listeners>0);
    const values=await page.evaluate(async()=>{const departed=[];for(let i=0;i<100;i++){const button=document.querySelector('[id^=counter-]'),output=document.querySelector('[id^=value-]');departed.push({button,output,value:output.textContent});const result=await window.__native.router.navigate(i%2?'/native/a':'/native/b');if(result.kind!=='committed')throw Error(result.kind);await result.ready;}return {retained:document.querySelector('#layout-count').textContent,dead:departed.every(item=>{item.button.click();return !item.button.isConnected&&item.output.textContent===item.value;}),active:document.querySelectorAll('[data-forma-island]').length,listeners:window.__nativeListeners.length,detached:window.__nativeListeners.filter(entry=>!entry.target.isConnected).length,timers:window.__nativeTimers.size};});
    assert.equal(values.retained,'1');assert.equal(values.dead,true);assert.equal(values.active,2);assert.equal(values.listeners,baseline.listeners);assert.equal(values.detached,0);assert.equal(values.timers,baseline.timers);await same(page);assert.deepEqual(await page.evaluate(()=>window.__native.metrics.errors),[]);
  });
  await scenario('API focus and keyed Back Forward scroll restoration target the destination', ['RT-A01','RT-A02'], async page=>{
    await open(page);await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,700);});await go(page,'/native/b');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'route-title');assert.equal(await page.evaluate(()=>window.scrollY),0);
    await page.evaluate(()=>window.scrollTo(0,400));await page.goBack();await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/a'&&!window.__native.router.pending());assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-700)<=2);
    await page.goForward();await page.waitForFunction(()=>window.__native.router.location().url.pathname==='/native/b'&&!window.__native.router.pending());assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-400)<=2);
    await go(page,'#route-title');assert.ok(await page.evaluate(()=>window.scrollY)>0);await same(page);
  });
  await scenario('retained focus and layout input selection survive sibling transition', ['RT-A01'], async page=>{
    await open(page);await page.locator('#layout-note').fill('retained focus');await page.locator('#layout-note').evaluate(input=>{input.focus();input.setSelectionRange(2,7);});await go(page,'/native/b');
    assert.deepEqual(await page.evaluate(()=>({id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})),{id:'layout-note',start:2,end:7});assert.equal(await page.title(),'Proof B');assert.match(await page.locator('[data-forma-router-status]').innerText(),/ready/i);await same(page);
  });
  await browser.close();
}
result.finishedAt=new Date().toISOString();result.finalDiffSha256=sha(execFileSync('git',['diff','--binary']));result.sourceChangedDuringRun=JSON.stringify(result.sourceFiles)!==JSON.stringify(await sourceFiles());result.artifactsChangedDuringRun=JSON.stringify(result.artifacts)!==JSON.stringify(await artifacts());
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.results.length-result.failures.length,failed:result.failures.length,output,sourceChangedDuringRun:result.sourceChangedDuringRun}));
if(result.failures.length)process.exitCode=1;
