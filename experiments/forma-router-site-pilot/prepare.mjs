import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, renameSync, symlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), framework = resolve(here, '../..');
const site = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Supply the private site checkout explicitly; it is read-only.');
const work = resolve(here, '.local');
assert(!existsSync(work), 'Keep prior local attempts; move .local before another preparation.');
mkdirSync(work);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args, cwd, log) => {
  try { const output = execFileSync(program, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, CARGO_BUILD_JOBS:'3' }, stdio:['ignore','pipe','pipe'] }); if (log) writeFileSync(join(work,log),output); return output; }
  catch (error) { if (log) writeFileSync(join(work,log),String(error.stdout ?? '') + String(error.stderr ?? '')); throw error; }
};
const commit = run('git',['rev-parse','HEAD'],site).trim();
const state = run('git',['status','--porcelain=v1'],site);
const privateDiff = sha(Buffer.from(run('git',['diff','--binary','HEAD'],site)));
const archive = execFileSync('git',['archive','--format=tar',commit],{cwd:site,maxBuffer:128*1024*1024});
writeFileSync(join(work,'site.tar'),archive);
const copy=join(work,'site');mkdirSync(copy);run('tar',['-xf',join(work,'site.tar'),'-C',copy],work);
run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],copy,'install-original.log');
run('npm',['run','build'],copy,'build-original.log');
renameSync(join(copy,'dist'),join(work,'original'));
const artifacts=join(work,'archives');mkdirSync(artifacts);
const packages=[];
for (const name of ['core','router']) {
  const output=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',artifacts],join(framework,'packages',name)))[0];
  const file=join(artifacts,output.filename); packages.push({name:output.name,version:output.version,file:output.filename,sha256:sha(readFileSync(file))});
}
const candidates=join(work,'candidate-packages');mkdirSync(candidates);
writeFileSync(join(candidates,'package.json'),JSON.stringify({name:'forma-site-pilot-candidates',private:true,type:'module'}));
run('npm',['install','--ignore-scripts','--no-audit','--no-fund',...packages.map(p=>join(artifacts,p.file))],candidates,'install-candidates.log');
// Existing versioned API docs must still inspect the site's published 3.0 graph.
// Only the portal runtime uses candidate archives, through source build aliases.
const builder=join(copy,'scripts/build-portal.mjs');
let buildSource=readFileSync(builder,'utf8');
assert(buildSource.includes('import { build } from "esbuild";'));
const aliases={
 '@getforma/core/navigation':join(candidates,'node_modules/@getforma/core/dist/navigation.js'),
 '@getforma/core':join(candidates,'node_modules/@getforma/core/dist/index.js'),
 '@getforma/router':join(candidates,'node_modules/@getforma/router/dist/index.js'),
};
buildSource=buildSource.replace('import { build } from "esbuild";', 'import { build as esbuildBuild } from "esbuild";\nconst build = options => esbuildBuild({ ...options, alias: '+JSON.stringify(aliases)+' });');
writeFileSync(builder,buildSource);
const layout=join(copy,'scripts/lib/layout.mjs'), original=readFileSync(layout,'utf8');
const selector='<div data-portal-content>${body}</div>';
assert.equal(original.split(selector).length,2,'source layout changed: review marker insertion');
writeFileSync(layout,original.replace(selector,'<div data-portal-content><!--forma:region:start-->${body}<!--forma:region:end--></div>'));
cpSync(join(here,'navigation.js'),join(copy,'src/portal/navigation.js'));
run('npm',['run','build'],copy,'build-candidate.log');
const pages=[];let build,assets;
for (const path of ['/project/','/releases/']) {
 const html=readFileSync(join(copy,'dist',path,'index.html'),'utf8');
 const meta=name=>new RegExp(`<meta name="${name}" content="([^"]+)">`).exec(html)?.[1];
 build ??= meta('forma-portal-build');assets ??= meta('forma-portal-assets');
 assert.equal(meta('forma-portal-build'),build);assert.equal(meta('forma-portal-assets'),assets);
 const region=html.split('<!--forma:region:start-->')[1]?.split('<!--forma:region:end-->')[0];
 assert(region?.startsWith('<main '),'selected real page is not one main region');
 assert(!/<(?:script|style|svg|iframe|img|form|template)\b/i.test(region),'selected real page exceeds pilot profile');
 pages.push({path,sha256:sha(Buffer.from(html)),title:/<title>([^<]+)<\/title>/.exec(html)[1].replace(/&(amp|lt|gt|quot|#39);/g, (_,name)=>({amp:'&',lt:'<',gt:'>',quot:'\"','#39':"'"})[name])});
}
const head=sha(Buffer.from(JSON.stringify({build,assets})));
writeFileSync(join(copy,'dist/forma-router-pilot.json'),JSON.stringify({build,assets,head,pages:pages.map(p=>({...p,head}))},null,2)+'\n');
renameSync(join(copy,'dist'),join(work,'candidate'));
symlinkSync('candidate',join(work,'current'));
assert.equal(run('git',['status','--porcelain=v1'],site),state,'private source checkout changed');
assert.equal(sha(Buffer.from(run('git',['diff','--binary','HEAD'],site))),privateDiff,'private source changes were modified');
const receipt={scope:'Local static public portal pilot; no native-server qualification, deployment or private source publication.',siteCommit:commit,privateCheckoutUntouched:true,frameworkCommit:run('git',['rev-parse','HEAD'],framework).trim(),frameworkRouterSourceSha256:sha(readFileSync(join(framework,'packages/router/src/html.ts'))),packages,build,assets,head,pages,originalPortalSha256:sha(readFileSync(join(work,'original/assets/portal.js'))),candidatePortalSha256:sha(readFileSync(join(work,'candidate/assets/portal.js')))};
writeFileSync(join(work,'preparation.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
