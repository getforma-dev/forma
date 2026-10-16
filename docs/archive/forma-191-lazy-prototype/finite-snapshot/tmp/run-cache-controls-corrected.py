from pathlib import Path
import subprocess, os, json, hashlib, datetime
root=Path(__file__).resolve().parents[1]/"forma"
out=Path(__file__).resolve().parent
source=root/"packages/core/src/dom/element.ts"
test=root/"packages/core/src/dom/__tests__/element-prototype-cache.test.ts"
original=out/"original/element.ts"
candidate=source.read_bytes()
test_bytes=test.read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest()
env=os.environ.copy()
env["PATH"]="/Users/victorvillacis/.nvm/versions/node/v24.22.0/bin:"+env["PATH"]
env["CARGO_BUILD_JOBS"]="3"
env["PLAYWRIGHT_SKIP_BROWSER_GC"]="1"
cmd=["npm","test","-w","packages/core","--","src/dom/__tests__/element-prototype-cache.test.ts","--maxWorkers=2"]
results={"sourceBase":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip(),"command":cmd,"node":subprocess.check_output(["node","--version"],env=env,text=True).strip(),"sourceSha256":sha(candidate),"originalSha256":sha(original.read_bytes()),"testSha256":sha(test_bytes),"startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()}
def run(label):
    with (out/(label+".log")).open("wb") as f:
        try:
            r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=120)
            return {"exitCode":r.returncode}
        except subprocess.TimeoutExpired:
            return {"timedOut":True}
try:
    source.write_bytes(original.read_bytes())
    results["before"]=run("cache-controls-corrected-before")
finally:
    source.write_bytes(candidate)
    results["candidateRestored"]=sha(source.read_bytes())==sha(candidate)
    results["testUnchanged"]=test.read_bytes()==test_bytes
    (out/"cache-controls-corrected-results.json").write_text(json.dumps(results,indent=2)+"\n")
if not results["candidateRestored"] or not results["testUnchanged"]:
    raise SystemExit("source restoration mismatch")
if results.get("before",{}).get("exitCode") != 1:
    raise SystemExit("unexpected before disposition; stop for inspection")
results["after"]=run("cache-controls-corrected-after")
results["finishedAt"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
(out/"cache-controls-corrected-results.json").write_text(json.dumps(results,indent=2)+"\n")
print(json.dumps(results,indent=2))
