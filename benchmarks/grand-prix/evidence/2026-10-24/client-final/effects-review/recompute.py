from pathlib import Path
import json,hashlib,statistics,math,zipfile
base=Path(__file__).resolve().parent.parent;out=base/'effects-review';root=base/'artifact/forma/forma/benchmarks/grand-prix/results/client-40140319634-1-client'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
auth=json.loads((base/'AUTHENTICATED.json').read_text());assert sha(base/'artifact.zip')==auth['sha256']=='b1c5d2493248a7607dda7105a948a8b57158db41f6e367b233fe2b4268ce8a2c'
provider=json.loads((base/'provider-artifacts.json').read_text())['artifacts'];matches=[x for x in provider if x['id']==12579300297];assert len(matches)==1;asset=matches[0];assert asset['digest']=='sha256:'+auth['sha256'] and asset['size_in_bytes']==(base/'artifact.zip').stat().st_size==138657;assert asset['workflow_run']['id']==40140319634 and asset['workflow_run']['head_sha']==auth['source']
with zipfile.ZipFile(base/'artifact.zip') as z:
 assert z.testzip() is None
 names=[i.filename for i in z.infolist() if not i.is_dir()];assert len(names)==50;assert set(names)==set(auth['members'])
 for name in names:assert z.read(name)==(base/'artifact'/name).read_bytes()
run=json.loads((root/'run.json').read_text());assert run['sourceCommit']=='9ac07a446ebe8aaad407a895fa8aaece189bc69e' and run['passed'] and run['qualifiedProfile'] and not run['diagnostic']
refs=['published','f5be8647439e560c71c27b8c5f4bde26507b8bbb','9ac07a446ebe8aaad407a895fa8aaece189bc69e'];assert [t['ref'] for t in run['trials']]==refs
records={};inputs={};counts={'signalsRecords':0,'signalsSamples':0,'domRecords':0,'domSamples':0,'bundles':0}
def close(a,b):assert math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-9),(a,b)
for trial in run['trials']:
 ref=trial['ref'];assert trial['passed'] and trial['campaign']==run['campaign'] and trial['resourceProfile']==run['resourceProfile'];records[ref]={}
 for name,key in [('client-race','clientLock'),('signals-race','signalsLock')]:assert sha(root/ref/name/'package-lock.json')==trial[key]
 own=trial['signalVersionControl'];assert not own['scored'] and own['engineVersion']=='3.1.2';assert own['container']['cpuset']=='0' and own['container']['nanoCpus']==1000000000 and own['container']['memoryBytes']==1073741824
 assert sha(root/ref/'raw/signals-version-check/alien-signals-3.1.2.json')==own['resultSha256']
 for p in sorted((root/ref/'raw').rglob('*.json')):
  d=json.loads(p.read_text());inputs[str(p.relative_to(base))]=sha(p);kind=p.parent.name;car=d['car'];assert d['campaign']==run['campaign'] and d['resourceProfile']==run['resourceProfile']
  if kind in ['signals','signals-version-check']:
   assert d['correct'] and all(x['ok'] for x in d['checks']) and d['runs']==5 and d['warmups']==2 and d['node']=='v22.23.4';assert d['processAffinity']==d['runnerProcessAffinity']==[0]
   assert len(d['benches'])==9;metrics={}
   for op,v in d['benches'].items():
    samples=v['runs'];assert len(samples)==5 and all(math.isfinite(x) and x>0 for x in samples);m=statistics.mean(samples);sd=statistics.stdev(samples);close(m,v['mean']);close(sd,v['sd']);metrics[op]={'mean':m,'sd':sd,'samples':samples};counts['signalsSamples']+=5
   geo=math.exp(statistics.mean(math.log(x['mean']) for x in metrics.values()));close(geo,d['geomeanOpsPerSec']);counts['signalsRecords']+=1
  elif kind=='dom':
   assert d['verified'] and not d['pageErrors'] and d['runs']==5 and d['warmups']==2 and d['processAffinity']==d['browserProcessAffinity']==[1,2,3];assert len(d['ops'])==9;metrics={}
   for op,v in d['ops'].items():
    samples=v['runs'];assert len(samples)==5 and all(math.isfinite(x) and x>=0 for x in samples);m=statistics.mean(samples);sd=statistics.stdev(samples);close(m,v['mean']);close(sd,v['sd']);metrics[op]={'mean':m,'sd':sd,'samples':samples};counts['domSamples']+=5
   geo=math.exp(statistics.mean(math.log(max(.1,x['mean'])) for x in metrics.values()));close(geo,d['geomeanMs']);counts['domRecords']+=1
  else:
   assert kind=='bundle';assert all(sum(f[k] for f in d['files'])==d[k] for k in ['bytes','gzip','brotli']);records[ref].setdefault(kind,{})[car]={k:d[k] for k in ['bytes','gzip','brotli']};counts['bundles']+=1;continue
  records[ref].setdefault(kind,{})[car]={'metrics':metrics,'geomean':geo}
pub,main,selected=refs;comparison={}
for kind,control in [('signals','alien-signals-3.1.2'),('dom','vanilla')]:
 controlKind='signals-version-check' if kind=='signals' else kind;rows=[]
 for op in records[selected][kind]['forma']['metrics']:
  row={'operation':op,'values':{ref:{'forma':records[ref][kind]['forma']['metrics'][op],'control':records[ref][controlKind][control]['metrics'][op]} for ref in refs}}
  a=records[selected][kind]['forma']['metrics'][op]['mean']
  for ref,label in [(pub,'published'),(main,'main')]:
   b=records[ref][kind]['forma']['metrics'][op]['mean'];row['selectedChangeVs'+label+'Percent']=100*(a/b-1)
  row['sameTrialRatios']={ref:row['values'][ref]['forma']['mean']/row['values'][ref]['control']['mean'] for ref in refs};rows.append(row)
 comparison[kind]=rows
 ownRatios=[x['sameTrialRatios'][selected] for x in rows];comparison[kind+'SameTrialGeoRatio']=math.exp(statistics.mean(map(math.log,ownRatios)))
result={'source':run['sourceCommit'],'artifact':auth['sha256'],'campaign':run['campaign'],'cpu':run['cpu'],'counts':counts,'records':records,'comparison':comparison,'inputs':inputs,'trialSequence':refs,'note':'All samples retained. Signal change percentages are throughput (higher better); DOM percentages are time (lower better). Samples are sequential, not paired or host-randomized. SD overlap does not establish equivalence or disprove regression.'}
(out/'recomputed.json').write_text(json.dumps(result,indent=2)+'\n')
for kind in ['signals','dom']:
 print('\n'+kind)
 for r in comparison[kind]:
  cells=['%s %.3f ± %.3f'%(k[:8],v['forma']['mean'],v['forma']['sd']) for k,v in r['values'].items()]
  print(r['operation'],' | '.join(cells),'vsP %.2f%% vsM %.2f%% ratio %.5f'%(r['selectedChangeVspublishedPercent'],r['selectedChangeVsmainPercent'],r['sameTrialRatios'][selected]))
 print('own geo',comparison[kind+'SameTrialGeoRatio'])
print(counts)
