from pathlib import Path
import hashlib,json,math,statistics
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'independent'
RUN=next((ROOT/'artifact').rglob('run.json')).parent
run=json.loads((RUN/'run.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
OPS=['create1000','replace1000','update10th','select','swap','remove','create10000','append1000','clear']
BENCHES=['signal create','signal read','write with one effect','computed cache hit','chain of 100','diamond (500 middles)','fan-out to 100 effects','effect create and dispose','batch of 100 writes']
records=[];results=[]
def approx(a,b):assert math.isclose(a,b,rel_tol=1e-11,abs_tol=1e-10),(a,b)
def stat(s,kind):
 xs=s['runs'];assert len(xs)==5 and all(math.isfinite(x)and x>=0 for x in xs)
 approx(statistics.mean(xs),s['mean']);approx(statistics.stdev(xs),s['sd'])
 if kind=='dom':approx(min(xs),s['min']);approx(max(xs),s['max'])
def read(t,group,car):
 p=RUN/t['ref']/'raw'/group/(car+'.json');j=json.loads(p.read_text())
 assert j['car']==car and j['campaign']==run['campaign']and j['resourceProfile']==run['resourceProfile']
 assert t['before']['at']<=j['measuredAt']<=t['after']['at']
 assert j['runs']==5 and j['warmups']==2
 if group=='dom':
  assert j['event']==9 and j['verified']is True and j['pageErrors']==[]
  assert j['processAffinity']==j['browserProcessAffinity']==[1,2,3]
  assert list(j['ops'])==OPS
  assert j['machine']['chrome']=='Chrome/156.0.8078.4'and j['machine']['node']=='v24.22.0'
  assert j['machine']['cpu']==run['cpu']and j['machine']['cores']==4
  for s in j['ops'].values():stat(s,'dom')
  approx(math.exp(statistics.mean([math.log(s['mean'])for s in j['ops'].values()])),j['geomeanMs'])
 else:
  assert j['event']==11 and j['correct']is True and len(j['checks'])==14 and all(c['ok']is True for c in j['checks'])
  assert j['processAffinity']==j['runnerProcessAffinity']==[0]
  assert j['node']==j['machine']['node']=='v22.23.4'and j['machine']['cpu']==run['cpu']and j['machine']['visibleCores']==4
  assert j['machine']['platform']=='linux/x64'and j['machine']['cgroupCpuMax']=='100000 100000'
  assert list(j['benches'])==BENCHES,list(j['benches'])
  for s in j['benches'].values():stat(s,'signals')
  approx(math.exp(statistics.mean([math.log(s['mean'])for s in j['benches'].values()])),j['geomeanOpsPerSec'])
 records.append({'path':str(p.relative_to(ROOT)),'sha256':sha(p),'event':j['event'],'car':car,'source':t['ref'],'samples':45,'correct':True})
 return j
for t in run['trials']:
 assert t['passed']and t['campaign']==run['campaign']and t['resourceProfile']==run['resourceProfile']
 assert sha(RUN/t['ref']/'client-race/package-lock.json')==t['clientLock']
 assert sha(RUN/t['ref']/'signals-race/package-lock.json')==t['signalsLock']
 for container in [t['signalsContainer'],t['signalVersionControl']['container']]:
  assert container['nanoCpus']==1000000000 and container['memoryBytes']==1073741824 and container['cpuset']=='0'and container['image']==t['signalsImage']
 dom={c:read(t,'dom',c)for c in t['cars']}
 signals={c:read(t,'signals',c)for c in ['forma','solid','preact-signals','vue-reactivity','alien-signals']}
 a=read(t,'signals-version-check','alien-signals-3.1.2');f=signals['forma'];v=dom['vanilla'];d=dom['forma']
 assert a['library']=='alien-signals'and a['version']=='3.1.2'
 assert t['signalVersionControl']['engineVersion']=='3.1.2'and t['signalVersionControl']['scored']is False
 assert sha(RUN/t['ref']/'raw/signals-version-check/alien-signals-3.1.2.json')==t['signalVersionControl']['resultSha256']
 bs=[{'name':name,'forma':f['benches'][name],'raw312':a['benches'][name],'ratioPercent':100*f['benches'][name]['mean']/a['benches'][name]['mean']}for name in BENCHES]
 ds=[{'name':name,'forma':d['ops'][name],'vanilla':v['ops'][name],'formaToVanillaRatio':d['ops'][name]['mean']/v['ops'][name]['mean']}for name in OPS]
 ratios={b['name']:b['ratioPercent']for b in bs};geo=100*f['geomeanOpsPerSec']/a['geomeanOpsPerSec']
 gates={'write80':ratios['write with one effect']>=80,'fan80':ratios['fan-out to 100 effects']>=80,'createDispose80':ratios['effect create and dispose']>=80,'overall85':geo>=85}
 results.append({'source':t['ref'],'signals':bs,'overallRatioPercent':geo,'numeric259Gates':gates,'numeric259Pass':all(gates.values()),'dom':ds,'domGeomeanFormaMs':d['geomeanMs'],'domGeomeanVanillaMs':v['geomeanMs'],'numeric260CreateWithin110Percent':ds[0]['formaToVanillaRatio']<=1.10})
report={'runId':40140319634,'harness':run['sourceCommit'],'campaign':run['campaign'],'resourceProfile':run['resourceProfile'],'phase':'fixed final-source campaign; row profiling disabled','validation':'All11 DOM records and18 signals/control records verified: five samples/two warmups, exact operation sets, correctness, shared campaign, resource allocation/affinity, locks, measured timestamps and arithmetic. Original SD and all samples retained. No cross-host raw-rate comparison or nonnumeric acceptance is asserted.','records':records,'results':results,'sampleCounts':{'dom':11*45,'signals':18*45},'priorRunComparison':'Earlier campaigns40134851617 and40136359826 retain their original results. This is exact integrated source9ac, not either prior flat source. No cross-host pooling, threshold change, or favorable-run selection.'}
(OUT/'scored-analysis.json').write_text(json.dumps(report,indent=2)+'\n')
for r in results:print(r['source'][:9],r['numeric259Gates'],r['overallRatioPercent'],r['dom'][0]['formaToVanillaRatio'])
print('SHA256',sha(OUT/'scored-analysis.json'))
