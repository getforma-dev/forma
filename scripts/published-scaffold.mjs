#!/usr/bin/env node
// The optional registry lane tests the exact coordinated published release. The
// required candidate lane is independent of its publication/readiness result.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleepFor } from 'node:timers/promises';
import { ROOT, NPM, CRATES, SEMVER, json, save, digest, run, packedRuntimeLock } from './release-set.mjs';
import { runCandidate } from './candidate-scaffold.mjs';

export function sourceVersion(root = ROOT) {
  const version = /\[workspace.package\]\s*\nversion = "([^"]+)"/.exec(readFileSync(join(root,'Cargo.toml'),'utf8'))?.[1];
  assert(SEMVER.test(version ?? '') && Number(version.split('.')[0]) >= 3);
  for (const name of NPM) assert.equal(json(join(root,`packages/${name}/package.json`)).version, version, 'source versions must be coordinated');
  return version;
}
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
function transientNetworkError(error) {
  // Native fetch wraps connection failures in TypeError.cause; a generic
  // TypeError, AbortError or malformed JSON is not evidence of a transient outage.
  for (let cause = error, depth = 0; cause && depth < 4; cause = cause.cause, depth++) {
    if (cause.name === 'TimeoutError' || TRANSIENT_NETWORK_CODES.has(cause.code)) return true;
  }
  return false;
}
export async function publishedStatus(version, request = fetch, { sleep = sleepFor, warn = console.warn } = {}) {
  assert(SEMVER.test(version) && Number(version.split('.')[0]) >= 3);
  if (version.endsWith('-dev')) return {ready:false, version, missing:['development versions are not published'], packages:[]};
  const packages = [], missing = [];
  // Two retries across the entire seven-record lookup, not per package. Even
  // nine 20-second timeouts plus 1s/2s backoff total at most 183s of network
  // waits, leaving room for setup within the five-minute preflight job.
  let retries = 0;
  async function readRecord(url, name) {
    for (;;) {
      let response, metadata, failure;
      try {
        response = await request(url, {headers:{'User-Agent':'getforma-scaffold-ci'}, signal:AbortSignal.timeout(20_000)});
        if (response.ok) metadata = await response.json();
      } catch (error) {
        if (!transientNetworkError(error)) throw error;
        failure = error;
      }
      if (!failure && RETRY_STATUSES.has(response.status)) {
        failure = Error(`${name}: registry readiness unreadable (${response.status})`);
        // Release unread error bodies before requesting again; cleanup failure
        // must not replace the original registry failure or reset its budget.
        try { await response.body?.cancel(); }
        catch (error) { warn(`::warning::${name}: registry error-body cleanup failed`, error); }
      }
      if (!failure) return { response, metadata };
      if (retries === 2) throw failure;
      const delay = ++retries * 1_000;
      warn(`::warning::${name}: transient registry metadata failure; shared retry ${retries}/2 in ${delay}ms`, failure);
      await sleep(delay);
    }
  }
  for (const [registry, names] of [['npm', NPM.map(n=>`@getforma/${n}`)], ['crates', CRATES]]) {
    for (const name of names) {
      const url = registry === 'npm' ? `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}` : `https://crates.io/api/v1/crates/${name}/${version}`;
      const { response, metadata } = await readRecord(url, name);
      if(response.status === 404) {missing.push(`${name}@${version}`); continue;}
      assert(response.ok, `${name}: registry readiness unreadable (${response.status})`);
      if(registry === 'npm') {
        assert.equal(metadata.name,name); assert.equal(metadata.version,version);
        assert(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist?.integrity ?? ''), `${name}: registry archive lacks SHA-512`);
        assert.equal(metadata.dist.tarball,`https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`);
      } else {
        assert.equal(metadata.version?.num,version); assert.equal(metadata.version?.yanked,false);
        assert(/^[a-f0-9]{64}$/.test(metadata.version?.checksum ?? ''), `${name}: registry archive lacks SHA-256`);
      }
      packages.push({registry,name,version,metadata});
    }
  }
  return {ready:missing.length === 0,version,missing,packages};
}

export async function preparePublished(work, request = fetch, version = sourceVersion()) {
  const status = await publishedStatus(version,request); assert(status.ready,'coordinated release is not fully published');
  work=resolve(work); assert(!existsSync(work),'published scaffold work must be fresh'); mkdirSync(work,{recursive:true});
  const cliRecord=status.packages.find(p=>p.name==='@getforma/create-app');
  const response=await request(cliRecord.metadata.dist.tarball,{signal:AbortSignal.timeout(30_000)}); assert(response.ok);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`,cliRecord.metadata.dist.integrity,'published CLI archive integrity');
  const archive=join(work,'published-cli.tgz');writeFileSync(archive,bytes);
  const paths=run('tar',['-tzf',archive]).trim().split(/\r?\n/);assert(paths.every(p=>p.startsWith('package/')&&!p.split('/').includes('..')),'unsafe published archive');
  const packed=JSON.parse(run('tar',['-xOf',archive,'package/package.json']));
  assert.equal(packed.name,cliRecord.name);assert.equal(packed.version,status.version);
  const runtime=packedRuntimeLock(packed,json(join(ROOT,'package-lock.json')),'packages/create-app');
  const manifest={name:'forma-published-scaffold',version:'0.0.0',private:true,dependencies:{[packed.name]:`=${packed.version}`}};
  const metadata={version:packed.version,resolved:cliRecord.metadata.dist.tarball,integrity:cliRecord.metadata.dist.integrity};
  for(const kind of ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','engines','bin'])if(packed[kind])metadata[kind]=packed[kind];
  const location=`node_modules/${packed.name}`;
  const lock={name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':{name:manifest.name,version:manifest.version,dependencies:manifest.dependencies},[location]:metadata}};
  for(const [path,entry] of Object.entries(runtime.lock.packages))if(path)lock.packages[`${location}/${path}`]=entry;
  save(join(work,'package.json'),manifest);save(join(work,'package-lock.json'),lock);
  const before=digest(join(work,'package-lock.json'));
  run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],work,{stdio:'inherit'});
  assert.equal(digest(join(work,'package-lock.json')),before);
  run('npm',['audit','signatures'],work,{stdio:'inherit'});
  const cli=join(work,location);
  assert(!existsSync(join(cli,'template-lock-seeds.json')),'published CLI must not carry source seed identity');
  for(const template of ['minimal','dashboard']) {
    const project=join(cli,'templates',template), npm=json(join(project,'admin/package-lock.json'));
    for(const [path,entry] of Object.entries(npm.packages)) {
      const name=/(?:^|\/)node_modules\/(@getforma\/[^/]+)$/.exec(path)?.[1];if(!name)continue;
      const record=status.packages.find(p=>p.name===name);assert(record,`unknown published internal package ${name}`);
      assert.equal(entry.version,status.version);assert.equal(entry.resolved,record.metadata.dist.tarball);assert.equal(entry.integrity,record.metadata.dist.integrity);
    }
    for(const block of readFileSync(join(project,'Cargo.lock'),'utf8').split(/(?=\[\[package\]\])/)) {
      const name=/^name = "([^"]+)"/m.exec(block)?.[1];if(!CRATES.includes(name))continue;
      const record=status.packages.find(p=>p.name===name);
      assert.equal(/^version = "([^"]+)"/m.exec(block)?.[1],status.version);
      assert.equal(/^checksum = "([^"]+)"/m.exec(block)?.[1],record.metadata.version.checksum);
    }
  }
  save(join(work,'published-record.json'),status);
  return {mode:'published',commit:run('git',['rev-parse','HEAD']).trim(),recordSha256:digest(join(work,'published-record.json')),work,cli:join(cli,'dist/index.js'),target:join(work,'target')};
}

async function main() {
  const [command,work,report]=process.argv.slice(2);
  if(command==='preflight') {
    const result=await publishedStatus(sourceVersion());console.log(JSON.stringify(result,null,2));
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.ready}\nmissing=${result.missing.join(', ')}\n`);
  } else if(command==='run')runCandidate(await preparePublished(work),resolve(report));
  else throw Error('usage: published-scaffold.mjs preflight | run WORK REPORT');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error);process.exitCode=1;});
