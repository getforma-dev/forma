#!/bin/bash
set -eu
export PATH=/Users/victorvillacis/.nvm/versions/node/v24.22.0/bin:$PATH
cd /Users/victorvillacis/dev/Forma/work/FORMA-108/forma/packages/core
python3 - <<'META'
from pathlib import Path
import hashlib, json, subprocess, datetime
core=Path.cwd()
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()==''
metadata={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'sourceClean':True,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'runtimeSha256':sha(core/'dist/formajs-runtime.global.js'),'harnessSha256':sha(core/'scripts/measure-task-budget.mjs'),'runs':5,'rate':4,'only':['F','O3','S6'],'classification':'Diagnostic timing qualification with historical context-dependent slow-search residual retained; not a universal 50ms pass.'}
Path('/Users/victorvillacis/dev/Forma/work/FORMA-108/tmp/l50-current-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
META
node scripts/measure-task-budget.mjs --runs=5 --rate=4 --only=F,O3,S6 > /Users/victorvillacis/dev/Forma/work/FORMA-108/tmp/l50-current.log 2>&1
python3 - <<'VERIFY'
from pathlib import Path
import hashlib, json, subprocess
p=Path('/Users/victorvillacis/dev/Forma/work/FORMA-108/tmp/l50-current-metadata.json')
d=json.loads(p.read_text())
d['runtimeRestored']=hashlib.sha256(Path('dist/formajs-runtime.global.js').read_bytes()).hexdigest()==d['runtimeSha256']
d['sourceCleanAfter']=subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()==''
assert d['runtimeRestored'] and d['sourceCleanAfter']
p.write_text(json.dumps(d,indent=2)+'\n')
VERIFY
cat /Users/victorvillacis/dev/Forma/work/FORMA-108/tmp/l50-current.log
