from pathlib import Path
import subprocess,os,json,datetime,re,hashlib
root=Path(__file__).resolve().parents[1]/'forma'
out=root.parent/'tmp/browser-collection-cjs'
env=os.environ.copy();env['PATH']='/Users/victorvillacis/.nvm/versions/node/v24.22.0/bin:'+env['PATH']
env.update(CARGO_BUILD_JOBS='3',PLAYWRIGHT_SKIP_BROWSER_GC='1',FORMA_STATIC_E2E_PORT='35627',FORMA_SSR_E2E_PORT='35628',FORMA_TEST_PORT='35629')
for name in ['CARGO_TARGET_DIR','FORMAJS_DIR','FORMA_DIR','FORMA_TEST_BROWSER_CHANNEL','FORMA_FIXTURE_PORT_BASE']:env.pop(name,None)
commands=[
 ('fauth',51,['--config','../root-three-engine-cjs.config.ts','e2e/fixtures/apps/apps.spec.ts','--grep','fixture application fauth']),
 ('namespaces',12,['--config','../root-three-engine-cjs.config.ts','e2e/ssr/namespaces.spec.ts']),
 ('conditional',3,['--config','e2e/ssr/beta-acceptance.config.ts','conditional-element.spec.ts']),
 ('core',15,['--config','packages/core/playwright.config.ts','core-regressions.spec.ts']),
]
out.mkdir();results=[]
for name,expected,args in commands:
 cmd=['npx','playwright','test',*args,'--workers=2','--list','--reporter=list']
 with (out/(name+'.log')).open('wb') as f:r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=60)
 text=(out/(name+'.log')).read_text();match=re.search(r'Total: (\d+) tests? in (\d+) files?',text)
 counts={engine:len(re.findall(r'^\s*\['+engine+r'\]',text,re.M))for engine in ['chromium','firefox','webkit']}
 result={'name':name,'command':cmd,'exitCode':r.returncode,'expected':expected,'actual':int(match[1])if match else None,'engines':counts,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};results.append(result)
 (out/'results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if r.returncode!=0 or result['actual']!=expected or any(c!=expected//3 for c in counts.values()):raise SystemExit('collection did not match expected scope')
