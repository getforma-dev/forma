// Exercise the immutable published reader, rather than a simulated version predicate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [manifestInput,outputInput]=process.argv.slice(2);
assert(manifestInput&&outputInput,'usage: navigation-reader-compatibility.mjs GENERATED-MANIFEST NEW-RECEIPT');
const output=resolve(outputInput);assert(!existsSync(output),'preserve earlier receipts');
const manifest=readFileSync(resolve(manifestInput));const value=JSON.parse(manifest);
assert(Object.values(value.routes).some(route=>route.navigation),'use a real generated navigation manifest');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,CARGO_BUILD_JOBS:'3'},stdio:['ignore','pipe','pipe']});
const commit=run('git',['rev-parse','v3.1.0^{commit}']).trim();
const work=mkdtempSync(join(tmpdir(),'forma-published-reader-'));
const receipt={at:new Date().toISOString(),sourceTag:'v3.1.0',sourceCommit:commit,manifestSha256:createHash('sha256').update(manifest).digest('hex'),originalWriter:value.writer,scope:'Actual published reader manifest admission. Future writer is an explicit test mutation; no package versions or generated production outputs are changed.',passed:false};
try {
 writeFileSync(join(work,'source.tar'),execFileSync('git',['archive','--format=tar',commit,'Cargo.toml','Cargo.lock','crates'],{cwd:root,maxBuffer:128*1024*1024}));
 run('tar',['-xf',join(work,'source.tar'),'-C',work],work);
 const tests=join(work,'crates/forma-server/tests');mkdirSync(tests,{recursive:true});
 writeFileSync(join(tests,'router-generated-manifest.json'),manifest);
 writeFileSync(join(tests,'router_reader_probe.rs'),String.raw`
use forma_server::AssetManifest;
use serde_json::Value;
fn generated() -> Value { serde_json::from_str(include_str!("router-generated-manifest.json")).unwrap() }
#[test]
fn real_published_reader_rejects_future_navigation_writer_before_binding() {
    let mut manifest=generated(); manifest["writer"]="3.2.0".into();
    let mut bound=false;
    let result=(|| { AssetManifest::from_json(&manifest.to_string())?;
        let listener=std::net::TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;
        bound=true; Ok::<_,String>(listener) })();
    assert!(!bound);
    let error=result.unwrap_err();
    assert!(error.contains("MANIFEST-102") && error.contains("writer 3.2.0") && error.contains("reader 3.1.0"), "{error}");
}
#[test]
fn real_published_reader_keeps_its_older_equal_and_patch_writer_rules() {
    for writer in ["3.0.0","3.1.0","3.1.65535"] {
        let mut manifest=generated(); manifest["writer"]=writer.into();
        assert!(AssetManifest::from_json(&manifest.to_string()).is_ok(),"{writer}");
    }
}
#[test]
fn same_version_development_labels_do_not_authenticate_new_capability_support() {
    let mut manifest=generated(); manifest["writer"]="3.1.0".into();
    // Historical serde ignores this then-unknown field. The coordinated future
    // minor is therefore required before these new products may be published.
    assert!(AssetManifest::from_json(&manifest.to_string()).is_ok());
    assert!(manifest["routes"].as_object().unwrap().values().any(|route|route.get("navigation").is_some()));
}
`);
 receipt.command='CARGO_BUILD_JOBS=3 cargo test --locked --offline -p forma-server --test router_reader_probe';
 receipt.rustc=run('rustc',['--version'],work).trim();
 receipt.log=run('cargo',['test','--locked','--offline','-p','forma-server','--test','router_reader_probe'],work).replaceAll(work,'<isolated-published-reader>');
 receipt.cases=3;receipt.passed=true;
} catch(error) {receipt.error=String(error.message).replaceAll(work,'<isolated-published-reader>');receipt.log=String(error.stdout??'')+String(error.stderr??'');throw error;}
finally {mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');rmSync(work,{recursive:true,force:true});}
console.log(JSON.stringify({sourceCommit:commit,passed:receipt.passed,cases:receipt.cases}));
