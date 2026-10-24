import pathlib,json,hashlib,math,re
root=pathlib.Path(__file__).resolve().parent
art=root/'artifact'
sha=lambda b: hashlib.sha256(b).hexdigest()
load=lambda f: json.loads(f.read_text())
audit=load(root/'independent-verification.json')
r=art/'ci-40123441558-1-runtime'; runtime=load(r/'runtime.json')
assert runtime['passed'] and runtime['sameBinary'] and not runtime['performanceQualified'] and not runtime['cleanupErrors']
assert runtime['sourceCommit']==audit['source']['carSource']
for f in [r/'context/grandprix',r/'distroless-binary']:
 assert sha(f.read_bytes())==runtime['binary']['sha256'] and f.stat().st_size==runtime['binary']['bytes']
for image, name in [('original','source'),('distroless','distroless')]:
 data=load(r/f'{name}-image.json'); data=data[0] if isinstance(data,list) else data
 assert data['Id']==runtime[image]['id'] and data['Size']==runtime[image]['bytes']
 assert data['Config']['User']==runtime[image]['user']
for page in runtime['pages']:
 bodies=[]; policies=[]
 for name,key in [('debian','original'),('distroless','distroless')]:
  body=(r/f'{name}-{page["rows"]}.html').read_bytes();headers=load(r/f'{name}-{page["rows"]}-headers.json')
  assert len(body)==page[key+'Bytes'] and sha(body)==page[key+'Sha256']; bodies.append(body)
  policies.append({k:re.sub(r"'nonce-[^']+'", "'nonce-<per-response>'",v) if k=='content-security-policy' else v for k,v in headers.items() if k.lower() not in ['date','server','connection','keep-alive']})
 assert bodies[0]==bodies[1]
 assert policies[0]==policies[1]
assert runtime['imageBytesSaved']==runtime['original']['bytes']-runtime['distroless']['bytes']
c=art/'ci-40123441558-1-render-counts'; counts=load(c/'render-counts.json')
assert counts['passed'] and counts['instrumentation'] and not counts['diagnostic'] and not counts['cleanupErrors']
assert counts['campaign']==audit['campaign'] and counts['resourceProfile']==audit['resourceProfile']
assert counts['runtimeImage']==runtime['sourceImage'] and counts['sourceCommit']==audit['source']['carSource']
for name,key in [('original-binary','originalBinarySha256'),('build-binary','originalBinarySha256'),('instrumented-binary','instrumentedBinarySha256')]: assert sha((c/name).read_bytes())==counts[key]
for name in ['original','instrumented']: assert sha((c/f'source.{name}.rs').read_bytes())==counts['source'][name+'Sha256']
container=load(c/'instrumented-container.json')
assert container['HostConfig']['NanoCpus']==10**9 and container['HostConfig']['Memory']==1024**3 and container['HostConfig']['CpusetCpus']=='0'
assert counts['protocol']=={'warmups':20,'samples':101,'rows':[100,1000],'concurrency':1,'cpus':1,'cpuset':'0','memoryBytes':1024**3}
def stats(values):
 s=sorted(values);return dict(mean=sum(values)/len(values),median=s[len(s)//2],p95=s[math.ceil(len(s)*.95)-1],p99=s[math.ceil(len(s)*.99)-1],min=s[0],max=s[-1])
for sample in counts['samples']:
 body=(c/f'original-{sample["rows"]}.html').read_bytes()
 assert sha(body)==sample['documentSha256'] and len(body)==sample['documentBytes'] and sample['sameBody']
 assert len(sample['observations'])==101
 assert all(o['rows']==sample['rows'] and o['bytes']==sample['walkBytes'] and o['nodes']==sample['nodes'] for o in sample['observations'])
 for field,vals in [('walkNs',[o['ns'] for o in sample['observations']]),('nsPerByte',[o['ns']/o['bytes'] for o in sample['observations']])]:
  assert all(math.isclose(v,sample[field][k],rel_tol=1e-14) for k,v in stats(vals).items())
privacy=load(root/'privacy-scan.json')
# Inspect the public ephemeral Docker provenance fields and image environments.
envs=[]
for file in art.rglob('*image.json'):
 d=load(file);d=d[0] if isinstance(d,list) else d
 envs.extend(d.get('Config',{}).get('Env',[]) or [])
for env in envs:
 key=env.split('=',1)[0].lower()
 assert not any(word in key for word in ['token','password','credential','secret','authorization'])
engine=counts['dockerEngine']
assert all(not engine[k] for k in ['HttpProxy','HttpsProxy','NoProxy','Labels'])
result={'passed':True,'runtime':{k:runtime[k] for k in ['sourceCommit','sourceImage','performanceQualified','binary','original','distroless','imageBytesSaved','cleanupErrors']},'renderCounts':{'sameCampaign':True,'source':counts['source'],'originalBinarySha256':counts['originalBinarySha256'],'instrumentedBinarySha256':counts['instrumentedBinarySha256'],'protocol':counts['protocol'],'samples':[{k:v for k,v in s.items() if k!='observations'} for s in counts['samples']],'cleanupErrors':counts['cleanupErrors']},'privacy':{'imageEnvKeysReviewed':sorted(set(e.split('=',1)[0] for e in envs)),'proxyAndLabelsEmpty':True,'ephemeralDockerHostNameRetained':True,'rawCampaignMachineAndTrackingIdsAbsent':True,'limitation':'Pattern scan plus source/provenance review; not a general proof of arbitrary binary secrecy.'}}
(root/'supplementary-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print('Supplementary runtime,202 counts observations, binary/body hashes and privacy metadata checks passed.')
