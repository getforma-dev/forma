import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),work=resolve(here,'.local');
const output=resolve(process.argv[2]??resolve(here,'evidence/browser.json'));
assert(!existsSync(output),'Keep previous browser receipts.');
const require=createRequire(resolve(work,'site/package.json'));
const {chromium,firefox,webkit}=require('playwright');
const preparation=JSON.parse(await readFile(resolve(work,'preparation.json'),'utf8'));
const receipt={complete:false,at:new Date().toISOString(),scope:preparation.scope,preparation,results:[],browsers:[],failures:[]};
const child=spawn(process.execPath,[resolve(here,'serve.mjs')],{stdio:['ignore','pipe','pipe']});
let serverOutput='';child.stdout.on('data',data=>serverOutput+=data);child.stderr.on('data',data=>serverOutput+=data);
const origin=await new Promise((resolveOrigin,reject)=>{
 const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('owned server did not bind'));},15000);
 child.on('exit',code=>{clearTimeout(timer);reject(Error('owned server exited '+code));});
 child.stdout.on('data',()=>{const match=/FORMA_SITE_PILOT (http:\/\/127\.0\.0\.1:\d+)/.exec(serverOutput);if(match){clearTimeout(timer);resolveOrigin(match[1]);}});
});
const select=async build=>assert.equal((await fetch(origin+'/__pilot/select?build='+build,{method:'POST'})).status,204);
try {
 for(const [engine,launcher]of Object.entries({chromium,firefox,webkit})) {
  if(process.env.SITE_PILOT_ENGINE&&process.env.SITE_PILOT_ENGINE!==engine)continue;
  const browser=await launcher.launch();receipt.browsers.push({engine,version:browser.version()});
  async function scenario(name,callback,options={}) {
   await select('candidate');
   const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',...options});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   try {const detail=await callback(page,context);assert.deepEqual(errors,[]);receipt.results.push({engine,name,passed:true,...detail});console.log('PASS',engine,name);}
   catch(error){const failure={engine,name,passed:false,error:String(error.message)};receipt.failures.push(failure);receipt.results.push(failure);console.error('FAIL',engine,name,error.message);}
   finally{await context.close();await writeFile(output,JSON.stringify(receipt,null,2)+'\n');}
  }
  async function open(page){await page.goto(origin+'/project/');await page.waitForFunction(()=>window.__formaSitePilot||window.__formaSitePilotFailure);assert.equal(await page.evaluate(()=>window.__formaSitePilotFailure),undefined);}
  async function remember(page){await page.evaluate(()=>{window.__oldDocument=document;window.__oldHeader=document.querySelector('.portal-header');window.__oldSearch=document.querySelector('#search-dialog');window.__oldMain=document.querySelector('main');window.__oldTime=performance.timeOrigin;});}
  async function same(page){assert.equal(await page.evaluate(()=>window.__oldDocument===document&&window.__oldHeader===document.querySelector('.portal-header')&&window.__oldSearch===document.querySelector('#search-dialog')&&window.__oldTime===performance.timeOrigin),true);}
  async function settled(page,path){await page.waitForFunction(path=>window.__formaSitePilot?.router.location().url.pathname===path&&!window.__formaSitePilot.router.pending(),path);}
  await scenario('real pages retain header/search and release each departing page',async page=>{
   const scripts=[];page.on('request',r=>{if(r.resourceType()==='script')scripts.push(r.url());});
   await open(page);await remember(page);
   await page.locator('.search-trigger').click();await page.locator('#docs-search-input').fill('signals');
   await page.locator('#search-results a').first().waitFor();const results=await page.locator('#search-results a').count();
   await page.keyboard.press('Escape');const scriptCount=scripts.length;
   await page.locator('[data-portal-content] a[href="/releases/"]').click();await settled(page,'/releases/');await same(page);
   assert.equal(await page.title(),'Forma 3.0 — Forma');
   assert.equal(await page.evaluate(()=>window.__oldMain.isConnected),false);
   assert.equal(await page.locator('#docs-search-input').inputValue(),'signals');
   assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('h1')),true);
   await page.goBack();await settled(page,'/project/');await same(page);
   await page.goForward();await settled(page,'/releases/');await same(page);
   await page.locator('.portal-footer a[href="/project/"]').click();await settled(page,'/project/');await same(page);
   const lifecycle=await page.evaluate(()=>window.__formaSitePilot.observations);
   assert.equal(lifecycle.mounts,5);assert.equal(lifecycle.disposals,4);assert.deepEqual(lifecycle.errors,[]);
   assert.equal(scripts.length,scriptCount,'same-build navigation fetched a new executable');
   return {searchResults:results,lifecycle,newExecutableRequests:0,documentPreserved:true,headerPreserved:true,searchPreserved:true};
  });
  await scenario('changed destination bytes refuse enhancement and recover by document',async page=>{
   let altered=0;await page.route('**/releases/',async route=>{
    if(route.request().resourceType()==='fetch'){const response=await route.fetch();altered++;await route.fulfill({response,body:await response.text()+'<!--changed document bytes-->'});}else await route.continue();
   });
   await open(page);await remember(page);await page.locator('[data-portal-content] a[href="/releases/"]').click();
   await page.waitForURL('**/releases/');await page.waitForFunction(()=>window.__formaSitePilot);
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);assert.equal(altered,1);
   return {changedDocumentRejected:true,documentRecovery:true};
  });
  await scenario('initial build mismatch leaves ordinary links usable',async page=>{
   await page.route('**/forma-router-pilot.json',async route=>{const response=await route.fetch();const body=await response.json();body.build='different-build';await route.fulfill({response,json:body});});
   await page.goto(origin+'/project/');await page.waitForFunction(()=>window.__formaSitePilotFailure);await remember(page);
   await page.locator('[data-portal-content] a[href="/releases/"]').click();await page.waitForURL('**/releases/');
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);return {initialMismatchRefused:true,documentNavigation:true};
  });
  await scenario('atomic rollback restores original navigator and homepage document boundary',async page=>{
   await open(page);await remember(page);await select('original');
   const rollbackBytes=await (await fetch(origin+'/assets/portal.js')).arrayBuffer();
   assert.equal(createHash('sha256').update(Buffer.from(rollbackBytes)).digest('hex'),preparation.originalPortalSha256,'rollback did not serve the original bundle');
   await page.locator('[data-portal-content] a[href="/releases/"]').click();await page.waitForURL('**/releases/');
   await page.waitForFunction(()=>document.querySelector('meta[name="forma-portal-build"]')?.content!==window.__formaSitePilot?.build);
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);
   assert.equal(await page.evaluate(()=>window.__formaSitePilot),undefined);
   await page.waitForLoadState('networkidle');await remember(page);
   await page.locator('.portal-footer a[href="/project/"]').click();await page.waitForURL('**/project/');
   await page.waitForFunction(()=>document.querySelector('h1')?.textContent?.includes('small stack'));
   await same(page);
   await page.locator('.portal-header a[data-navigation-home]').click();await page.waitForURL(origin+'/');
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);
   return {atomicRollback:true,priorNavigatorRestored:true,homepageDocumentNavigation:true};
  });
  await scenario('allowlist and native-lab boundary keep document navigation',async page=>{
   await open(page);await remember(page);
   await page.locator('.portal-nav a[href="/labs/"]').click();await page.waitForURL('**/labs/');
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);
   await page.waitForLoadState('networkidle');await remember(page);
   await page.locator('a[href="/lab/native/?count=7"]').first().click();await page.waitForURL(url=>url.pathname==='/lab/native/');
   assert.equal(await page.evaluate(()=>window.__oldDocument),undefined);
   return {unregisteredPortalDocumentNavigation:true,nativeLabDocumentNavigation:true,nativeLabExecution:'static-preview landing only; Rust handler is outside this pilot'};
  });
  await scenario('ordinary public links work with JavaScript disabled',async page=>{
   await page.goto(origin+'/project/');await page.locator('[data-portal-content] a[href="/releases/"]').click();await page.waitForURL('**/releases/');
   assert.equal(await page.locator('h1').textContent(),'Forma 3.0');
   await page.locator('.portal-footer a[href="/project/"]').click();await page.waitForURL('**/project/');
   return {noJavaScript:true};
  },{javaScriptEnabled:false});
  await browser.close();
 }
 receipt.complete=true;
}catch(error){receipt.failures.push({fatal:true,error:String(error.message)});throw error;}finally{await select('candidate').catch(()=>{});child.kill('SIGTERM');await new Promise(resolveExit=>child.once('exit',resolveExit));await writeFile(output,JSON.stringify(receipt,null,2)+'\n');}
assert.equal(receipt.failures.length,0,`${receipt.failures.length} site pilot scenario(s) failed`);
