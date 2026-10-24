import json
from pathlib import Path
E=Path(__file__).resolve().parent
out=E/'round-2.json'
islands=json.loads((E/'islands/summary.json').read_text())
def run(n): return f'https://github.com/getforma-dev/forma/actions/runs/{n}'
def src(label,url): return {'label':label,'url':url}
def stat(s): return 'unavailable' if not s or not s.get('n') else f"{s['mean']:.2f} ± {s['sampleSd']:.2f}"
def median_range(s): return 'unavailable' if not s or not s.get('n') else f"{s['median']:.2f} ({s['min']:.2f}–{s['max']:.2f})"
sections=[{
 'title':'FORMA-264 — Linux protocol and evidence boundaries',
 'description':'Round 2 uses the dated gha-4-v1 profile on standard GitHub Actions Linux VMs with four available vCPUs. This profile preserves complete sample counts and separates server and load-generator CPUs; it does not claim an exclusive physical host.',
 'columns':['Workload','Server allocation','Driver allocation'],
 'rows':[['Single-core HTTP','1 CPU, 1 GiB, CPU 0','2 CPUs, CPUs 2–3'],['Multicore HTTP','2 CPUs, 2 GiB, CPUs 0–1','2 CPUs, CPUs 2–3'],['Native islands','1 CPU, 1 GiB, CPU 0','Chromium and driver, CPUs 1–3'],['Signals','1 CPU, 1 GiB, CPU 0','Sequential own-engine control in the same campaign']],
 'note':'Each campaign records source and lock hashes, actual container limits, CPU affinity, browser hashes where applicable, smoke checks and cleanup. Earlier oversubscribed runs remain diagnostic. Only trials in the same campaign support before/after ratios. The original October 23 results remain in the separate historical report.',
 'sources':[src('Round 2 protocol','https://github.com/getforma-dev/forma/blob/e50cec7fe9221aba25740b366c4430ef6544f556/benchmarks/grand-prix/ROUND-2.md')]
},{
 'title':'FORMA-261 — optional response compression',
 'description':'Same executable and runner, three 10-second samples after 5-second warmups. Source 87ecea92 includes the walker improvement and precedes static-route suppression. These are compression costs, not final-release or published-baseline speedups.',
 'columns':['Measure','Identity','Brotli 4','gzip 4'],
 'rows':[['Wire bytes','33,193','2,491','2,794'],['Sprint requests/s','2,778.61','2,055.57','1,972.31'],['Sprint p99, ms','27.74','37.23','39.52'],['Two-CPU requests/s','3,764.66','2,687.76','2,485.92'],['Mean memory peaks, MiB','3.92','7.02','4.44']],
 'note':'Brotli saves 92.5% of bytes with 26.0% lower Sprint throughput and 34.2% higher p99. gzip saves 91.6% with 29.0% lower throughput and 42.4% higher p99. Compression remains off by default; opt in only after the response-specific BREACH decision. Decoded content, response policy, resources and cleanup passed.',
 'sources':[src('Qualified compression campaign',run(40116661885)),src('Reviewed implementation','https://github.com/getforma-dev/forma/pull/179')]
},{
 'title':'FORMA-264 — eleven native island implementations',
 'description':'Published Forma 3.0.0 baseline. Each car passed one JavaScript-disabled SSR check, two warmups and five fresh measured contexts. All 154 counter increments, server-rendered counter-node identity and 100-row content checks passed. Timing cells show median (minimum–maximum) in milliseconds, as specified by the island protocol.',
 'columns':['Car','HTML body, B','Transferred JS, B','Ready, ms','Activation, ms','Click, ms'],
 'rows':[[c['car'],f"{c['serverHtmlBytes']:,}",f"{c['statistics']['transferredJavaScriptBytes']['mean']:,.0f}",median_range(c['statistics']['readinessMs']),median_range(c['statistics'].get('activationMs')),median_range(c['statistics']['clickMs'])] for c in islands['cars']],
 'note':'Ready runs from navigation start to the framework hook. Activation spans differ by native framework API; Next and Astro have no comparable explicit start. JS transfer includes HTTP overhead and is not Brotli bundle size. Click measures programmatic dispatch to matching text, not physical input or paint. Row content is verified; row-node identity is not measured. This baseline makes no candidate speedup claim.',
 'sources':[src('Qualified island campaign',run(40116670629))]
},{
 'title':'FORMA-259, FORMA-260 and FORMA-263 — retained failed client trial',
 'description':'The first qualified Linux comparison tested published 3.0.0 against candidate 54a836c0. It exposed DOM regressions. The row optimizations were withdrawn; a subsequent three-trial comparison tested the published version, this failed candidate and rollback 16862984.',
 'columns':['Measure','Published 3.0.0','Candidate 54a836c0','Finding'],
 'rows':[['Brotli bundle, B','8,652','8,490','162 B smaller; 422 B behind Preact'],['Create 1,000 rows, ms','25.66 ± 3.63','31.74 ± 9.60','Within 10% of paired vanilla 21.66 ms: failed'],['Swap rows, ms','1.72 ± 0.22','2.24 ± 0.18','30% slower'],['Remove row, ms','1.40 ± 0.26','2.14 ± 0.30','53% slower'],['Clear rows, ms','2.82 ± 0.16','4.26 ± 1.18','51% slower']],
 'note':'All nine DOM operations and raw samples are retained. These mean ± SD values are not a non-regression claim for unlisted operations. The official signal comparator was alien-signals 3.2.1; it cannot establish the target against Forma’s own 3.1.2 dependency. The successor campaign adds that exact control. No favorable-run selection or pooling across campaigns.',
 'sources':[src('Original failed acceptance comparison',run(40116672499)),src('Three-trial rollback comparison',run(40118323052)),src('Reviewed rollback and retained changes','https://github.com/getforma-dev/forma/pull/184')]
},{
 'title':'Qualification still being assembled',
 'description':'Completed workflow status is followed by an independent audit of raw evidence before any performance claim or ticket completion.',
 'columns':['Campaign','Status'],
 'rows':[['Full 14-stack server championship','First run unresolved; corrected full rerun in progress'],['Paired static routes and walker','Audited; byte, mean-based tail and strength budgets pass'],['Client rollback and own-engine signals','Audited; effect and row-creation targets failed']],
 'note':'The effect and row-creation acceptance targets remain open. No release or deployment is claimed by this report.',
 'sources':[src('Retained unresolved server campaign',run(40116667052)),src('Corrected full server rerun',run(40123441558)),src('Paired server campaign',run(40116668819)),src('Client campaign',run(40118323052))]
}]
client=json.loads((E/'client-rollback/verified.json').read_text())
trials=client['trials']
ops=list(trials[0]['dom']['forma']['ops'])
sections.insert(-1,{
 'title':'FORMA-259 and FORMA-263 — verified rollback comparison',
 'description':'One new Linux campaign tests published 3.0.0, withdrawn candidate 54a836c0 and rollback 16862984 sequentially, with five samples after two warmups. The exact alien-signals 3.1.2 control runs separately in each trial under the same resource profile.',
 'columns':['Measure','Published 3.0.0','Withdrawn 54a836c0','Rollback 16862984'],
 'rows':[['Brotli bundle, B']+[f"{t['bundle']['forma']['brotli']:,}" for t in trials]]+[[k+' / own engine']+[f"{t['effectRatios'][k]*100:.2f}%" for t in trials] for k in trials[0]['effectRatios']]+[['Nine-benchmark geomean / own engine']+[f"{t['signalGeomeanRatio']*100:.2f}%" for t in trials]],
 'note':'The rollback saves 228 B Brotli versus published 3.0.0 (2.64%), leaving a 356 B gap to Preact. The three effect targets of at least 80% each and overall target of at least 85% remain unmet. This VM has a different CPU model from the original campaign; absolute timings must not be compared across the two runs.',
 'sources':[src('Qualified rollback and own-engine campaign',run(40118323052)),src('Candidate and rollback review','https://github.com/getforma-dev/forma/pull/184')]
})
def domstat(t,car,op):
 x=t['dom'][car]['ops'][op]
 return f"{x['mean']:.2f} ± {x['sd']:.2f}"
sections.insert(-1,{
 'title':'FORMA-260 — all nine DOM operations after rollback',
 'description':'All measurements are milliseconds, mean ± sample SD. The last column retains each trial’s contemporaneous vanilla baseline. Creation remains above the required 1.10× vanilla limit.',
 'columns':['Operation','Published','Withdrawn 54a836c0','Rollback 16862984','Vanilla means P / W / R'],
 'rows':[[op]+[domstat(t,'forma',op) for t in trials]+[' / '.join(f"{t['dom']['vanilla']['ops'][op]['mean']:.2f}" for t in trials)] for op in ops],
 'note':'Rollback create-1,000 is 47.74 ms versus 28.34 ms for vanilla, a 1.685× ratio. No rollback-versus-published mean increase exceeds the sum of their observed SDs, but that descriptive check does not prove equivalence. Baseline drift and clock-resolution effects remain visible. The rollback does not establish which earlier optimization caused the regressions or close the row-creation ticket.',
 'sources':[src('Full three-trial DOM evidence',run(40118323052))]
})
sections[-1]['rows'][-1]=['Client rollback and own-engine signals','Audited; effect and row-creation targets failed']
paired=json.loads((E/'paired-server/summary.json').read_text())
pt=paired['trials']
sections[1:1]=[{
 'title':'FORMA-257 and FORMA-258 — same-runner server comparison',
 'description':'Published 3.0.0 → walker-only be029708 → static-only d00f231a → combined 81d1fd81. Three 10-second samples after 5-second warmups on one Linux VM. Values show mean ± sample SD; multicore uses two CPUs.',
 'columns':['Source','100-row HTML, B','Sprint, req/s','Endurance, req/s','Two-CPU, req/s','Endurance p99/p50'],
 'rows':[[t['label'],f"{t['events']['sprint']['bytes']:,}"]+[stat(t['events'][e]['metric']) for e in ['sprint','endurance','multicore']]+[f"{t['events']['endurance']['tailRatioOfMeans']:.4f}"] for t in pt],
 'note':'Static output is 48.32% smaller and passes the 17,500 B target. Combined Sprint improves 3.74%; Endurance changes −0.10%. The estimated 3,300/5,000 req/s did not materialize. The historical tail rule is mean p99 divided by mean p50; all four pass ≤1.5. Walker-only sample 3 individually reached 1.5264 and is retained. Sequential order and three samples limit causal attribution.',
 'sources':[src('Qualified paired campaign',run(40116668819)),src('Static routes','https://github.com/getforma-dev/forma/pull/177'),src('Walker optimization','https://github.com/getforma-dev/forma/pull/175')]
},{
 'title':'FORMA-258 — walker cost and unchanged work',
 'description':'A separate post-race instrumented executable reports existing RenderCounts; the raced binary is unchanged. Twenty warmups precede 101 measurements at each row count. The original binary and all document bodies are authenticated.',
 'columns':['Source','Rows','Walker bytes','Nodes / list iterations','Walker µs ± SD','Walker ns/B'],
 'rows':[[t['label'],str(r['rows']),f"{r['walkBytes']:,}",f"{r['nodes']:,} / {r['listIterations']:,}",f"{r['walkNs']['mean']/1000:.2f} ± {r['walkNs']['sampleSd']/1000:.2f}",f"{r['nsPerByte']['mean']:.3f}"] for t in pt for r in t['renderCounts']],
 'note':'All reported walker mean costs are below 10 ns/B; individual samples and spread remain in the raw evidence. This is not the HTTP marginal-cost metric: HTTP also includes data preparation, projection, response construction and transport. Static mode removes output bytes while retaining all nodes/list iterations, so ns per output byte can rise while total work falls. Separate macOS allocation counts were 1,937→1,133 at 100 rows and 19,044→11,040 at 1,000; those counts are not Linux measurements.',
 'sources':[src('RenderCounts and paired raw evidence',run(40116668819))]
},{
 'title':'FORMA-264 — server budgets and runtime image experiment',
 'description':'All four trials pass unchanged memory ≤8 MiB, application boot ≤50 ms and image ≤150,000,000 B budgets. Every individual memory/boot observation also passes.',
 'columns':['Source','Peak MiB ± SD','Readiness remainder, ms','Total startup ms','Debian image, B','Distroless image, B'],
 'rows':[[t['label'],stat(t['budgets']['memory']),stat(t['budgets']['boot']),f"{t['budgets']['totalContainerBoot']['mean']:.2f}",f"{t['runtime']['debianBytes']:,}",f"{t['runtime']['distrolessBytes']:,}"] for t in pt],
 'note':'Memory is the mean of observed per-run peaks. The readiness remainder runs from the Docker command returning until the first HTTP 200; it is not pure process startup. The pinned distroless image saves 47,156,656 B using the identical executable, runs as UID 65532 and passes 10/100/1,000-row body/policy parity. This is a size/correctness experiment; no distroless throughput, memory or boot claim, and no default image change.',
 'sources':[src('Budgets and same-binary image evidence',run(40116668819))]
}]
sections[-1]['rows'][1]=['Paired static routes and walker','Audited; byte, mean-based tail and strength budgets pass']
sections.insert(-1,{
 'title':'FORMA-262 — release-build caching',
 'description':'One cold/warm pair per authenticated published starter on separate hosted runners. The warm run edits a page, restores the exact reviewed cache and rebuilds no registry artifacts. Each cold run reports 113 registry compilation artifacts across 89 unique package IDs.',
 'columns':['Starter','Cold Rust release build','Warm after page edit','Warm frontend build'],
 'rows':[['Minimal','35.84 s','2.87 s','0.79 s'],['Dashboard','38.70 s','4.11 s','1.13 s']],
 'note':'These are measured starter examples, not universal build-time guarantees. The shipped CI cache policy is read-only outside the default branch. Release loading of FMIR from disk remains deferred after evaluating authentication, atomic updates and version skew; development already reloads pages from disk.',
 'sources':[src('Hosted cold/warm cache experiment',run(40108274094)),src('Reviewed cache implementation','https://github.com/getforma-dev/forma/pull/176')]
})
sections.insert(-1,{
 'title':'FORMA-264 — retained unresolved server campaign',
 'description':'The first 14-stack Linux workflow completed, but each of its 12 React Router load samples reported a floored mean response size 660 bytes shorter than its separate smoke response: 30,473 vs 31,133 bytes at 100 rows, and 276,112 vs 276,772 at 1,000 rows.',
 'columns':['Evidence','Finding'],
 'rows':[['Source, resource allocation, coverage and cleanup','Audited'],['Timed samples','All 168 retained; 12 React Router response-length mismatches'],['Other cars','All 156 timed lengths match the corresponding probes'],['Ranking qualification','Unresolved; not promoted into the round 2 leaderboard']],
 'note':'The load generator and Node probes sent different user agents. React Router can choose different streaming behavior for bots, but timed response bodies were not retained, so that explanation cannot retrospectively establish equivalence. A new full campaign fixes explicit user-agent, Accept and encoding headers, retains exact probes and raw load output, and refuses identity-body length differences. No framework bytes are normalized and no results are spliced across VMs.',
 'sources':[src('Original retained archive',run(40116667052)),src('Corrected full rerun',run(40123441558))]
})
baseline_client=json.loads((E/'client-withdrawn/verified.json').read_text())['trials'][0]
assert baseline_client['ref']=='published'
sections.insert(-1,{
 'title':'FORMA-264 — seven-client Linux baseline',
 'description':'The published-source trial of the first qualified client campaign, selected as the baseline independently of its timings. Five measured samples follow two warmups. Bundle values are all statically loaded application JavaScript; create-1,000 values are milliseconds, mean ± sample SD.',
 'columns':['Client','Raw JS, B','gzip 9, B','Brotli 11, B','Create 1,000, ms'],
 'rows':[[car]+[f"{bundle[k]:,}" for k in ['bytes','gzip','brotli']]+[f"{baseline_client['dom'][car]['create1000']['mean']:.2f} ± {baseline_client['dom'][car]['create1000']['sd']:.2f}"] for car,bundle in baseline_client['bundle'].items()],
 'note':'All nine operation samples are retained in the original archive. Each later candidate trial has its own contemporaneous vanilla measurement; do not substitute this baseline for those paired controls. These figures do not change the separate historical leaderboard.',
 'sources':[src('First qualified client baseline',run(40116672499))]
})
signal_cars=list(baseline_client['signals'])
sections.insert(-1,{
 'title':'FORMA-264 — five reactive-core Linux baselines',
 'description':'Published-source trial from the same first client campaign. Each reactive-core process runs alone in its recorded one-CPU/1-GiB container. Values are millions of operations per second, mean ± sample SD across five samples after two warmups; higher is better.',
 'columns':['Benchmark']+[car+' '+baseline_client['signals'][car]['version'] for car in signal_cars],
 'rows':[[bench]+[f"{baseline_client['signals'][car]['benches'][bench]['mean']/1e6:.4f} ± {baseline_client['signals'][car]['benches'][bench]['sd']/1e6:.4f}" for car in signal_cars] for bench in baseline_client['signals']['forma']['benches']],
 'note':'Work differs across benchmark rows, so compare libraries within a row. Large spreads are retained. The official alien-signals entry is 3.2.1; the later effect-acceptance comparison separately pins Forma’s own 3.1.2 engine. They are different controls.',
 'sources':[src('Five-core baseline and raw samples',run(40116672499))]
})
standalone=E/'local-bundle'
bundle_baseline=json.loads((standalone/'main.json').read_text())
bundle_candidate=json.loads((standalone/'candidate.json').read_text())
sections.insert(-1,{
 'title':'FORMA-263 — independently extracted bundle change',
 'description':'A separate bundle-only change at 8b56026e excludes the effect optimization and all withdrawn row optimizations. Fresh local production builds use identical app sources, external dependencies and Node 24.22.0 / Vite 8.3.5.',
 'columns':['Source','Raw JS, B','gzip 9, B','Brotli 11, B'],
 'rows':[[label]+[f"{bundle[k]:,}" for k in ['bytes','gzip','brotli']] for label,bundle in [('Main ea0adee8',bundle_baseline),('Bundle-only 8b56026e',bundle_candidate)]],
 'note':'The isolated change saves 237 B Brotli (2.74%). A separate source-map build shows activation code (666 mapped bytes) and state-encoder setup (16) disappear from this client-only app. Compression savings are not additive by module. All 4,164 unit tests, 42 three-engine checks and existing package/route size limits pass. These are local static byte measurements, not new Linux timings or the earlier combined candidate’s 8,424 B result.',
 'sources':[src('Independent bundle extraction','https://github.com/getforma-dev/forma/pull/187')]
})
server=json.loads((E/'server-qualified/publication-summary.json').read_text())
assert server['outcome']['passed'] and server['outcome']['matchingByteSamples']==168
scored=server['scores']
standings=scored['championship']
by_event={c['id']:{r['car']:r for r in c['standings']} for c in scored['contests']}
def server_stat(car,event,scale=1):
 r=by_event[event][car]
 return f"{r['mean']/scale:,.2f} ± {r['sd']/scale:,.2f}"
sections[1:1]=[{
 'title':'FORMA-264 — qualified fourteen-server championship',
 'description':'The corrected full Linux campaign independently passes source, resource, transport and score replay checks. It measures published Forma 3.0.0 and thirteen other server entrants on one VM, under the frozen gha-4-v1 profile. This is a server-only baseline.',
 'columns':['Rank','Server','Points','Events'],
 'rows':[[str(r['rank']),r['car'],f"{r['points']:.3f}",str(r['events'])] for r in standings],
 'note':'The unchanged points schedule is 25,18,15,12,10,8,6,4,2,1; ties share occupied positions. Event 7 splits its points equally between image and gzip-response weight. Forma ranks 7 of 14 with 59.5 points, first in memory and image size and second in Grid start. No client or overall-combined ranking is inferred. Earlier unresolved server results remain archived separately.',
 'sources':[src('Qualified full server campaign',run(40123441558)),src('Exact harness source','https://github.com/getforma-dev/forma/tree/be858597a42c3fbcbd0146d111c2f3bc7bc8d67a/benchmarks/grand-prix')]
},{
 'title':'FORMA-264 — all server HTTP measurements',
 'description':'Three ten-second samples per event follow five-second warmups. Values are mean ± sample SD. Single-core events use one server CPU; multicore uses two; the two-CPU driver has disjoint affinity.',
 'columns':['Server','Sprint, req/s','Endurance, req/s','Two-CPU, req/s','Reaction p99, ms'],
 'rows':[[r['car']]+[server_stat(r['car'],e) for e in ['sprint','endurance','multicore','reaction']] for r in standings],
 'note':'All 168 timed loads, 56 warmups, 112 probe bodies and 294 transport records are retained. Probes and loads share explicit headers. Each identity aggregate equals the verified probe length multiplied by completed responses, including React Router. This validates aggregate representation length with sampled semantic checks; it does not prove every individual timed response. Compare absolute timings only within this campaign.',
 'sources':[src('Full raw HTTP and transport evidence',run(40123441558))]
},{
 'title':'FORMA-264 — all server resource and build measurements',
 'description':'Memory, Grid start and build cells show mean ± sample SD. Image and gzip-response sizes are byte measurements. Grid start includes the Docker command; builds are warm page-only release builds under the recorded four-CPU build allocation.',
 'columns':['Server','Peak memory, MiB','Grid start, ms','Image, MB','gzip HTML, B','Build, ms'],
 'rows':[[r['car'],server_stat(r['car'],'fuel'),server_stat(r['car'],'grid'),f"{by_event['weight-image'][r['car']]['mean']/1e6:,.2f}",f"{by_event['weight-gzip'][r['car']]['mean']:,.0f}",server_stat(r['car'],'pitstop')] for r in standings],
 'note':'Forma passes the separate strength budgets: mean memory peak 4.033333 MiB ≤8, readiness remainder after docker run returns 18.144030 ms ≤50, and image 78,187,609 B ≤150,000,000. The boot remainder is not pure process startup; the scored Grid event is 178.014610 ms. A separate same-executable distroless check saves 47,156,656 B with body/policy parity; it establishes image size and correctness only.',
 'sources':[src('Resource, build and separate runtime evidence',run(40123441558))]
}]
sections[-1]['rows'][0]=['Full 14-stack server championship','Corrected full campaign independently passes; prior unresolved run retained']
final=json.loads((E/'client-final/publication-summary.json').read_text())
assert final['runId']==40140319634 and final['source']=='9ac07a446ebe8aaad407a895fa8aaece189bc69e'
ft=final['results']
labels=['Published 3.0.0','Main f5be8647','Final candidate 9ac07a44']
assert [t['source'] for t in ft]==['published','f5be8647439e560c71c27b8c5f4bde26507b8bbb',final['source']]
def final_stat(value,scale=1):
 return f"{value['mean']/scale:,.3f} ± {value['sd']/scale:,.3f}"
def effect_ratio(trial,name):
 return next(row['ratioPercent'] for row in trial['signals'] if row['name']==name)
policy_url='https://github.com/getforma-dev/forma/blob/2cbf169f78cba285805915f0f1440aabc97894ed/docs/release/3.1-PERFORMANCE-TRADEOFFS.md'
final_sources=[src('Final client campaign and original samples',run(40140319634)),src('Exact measured candidate','https://github.com/getforma-dev/forma/tree/'+final['source']),src('Prospective 3.1 product decisions',policy_url)]
sections[1:1]=[{
 'title':'Final client campaign — measured outcome and release decision',
 'description':'Run 40140319634 measures published 3.0.0, pre-effect main f5be8647 and final integrated candidate 9ac07a44 sequentially on one Linux VM. Each workload retains two warmups and five measured samples. The full source IDs, original ZIP, own-engine controls and raw samples accompany this report. Row profiling was disabled.',
 'columns':['Original criterion']+labels+['Original target'],
 'rows':[[label]+[f"{effect_ratio(t,name):.2f}%" for t in ft]+['At least 80%'] for label,name in [('Write / own engine','write with one effect'),('Fan-out / own engine','fan-out to 100 effects'),('Effect create/dispose / own engine','effect create and dispose')]]+[
  ['Nine-signal geometric mean / own engine']+[f"{t['overallRatioPercent']:.2f}%" for t in ft]+['At least 85%'],
  ['Create 1,000 / same-trial vanilla']+[f"{t['dom'][0]['formaToVanillaRatio']:.3f}×" for t in ft]+['At most 1.100×'],
 ],
 'note':'The original fan-out and row-creation targets are still missed. Write, effect creation/disposal and the overall signal ratio meet their individual numerical targets in this campaign. The maintainer accepted the remaining misses as explicit 3.1 product tradeoffs while retaining default row and native listener semantics; no experimental compiler is included. This prospective decision does not turn failed historical targets into passes, establish packed qualification, publish an RC or satisfy burn-in.',
 'sources':final_sources
},{
 'title':'Final client campaign — all nine reactive-core workloads',
 'description':'Values are millions of operations per second, mean ± sample SD; higher is better. The last column divides final Forma mean throughput by its contemporaneous pristine alien-signals 3.1.2 mean, which matches Forma’s own engine dependency. The separate official alien-signals race entry is 3.2.1.',
 'columns':['Workload']+labels+['Final / own 3.1.2'],
 'rows':[[row['name']]+[final_stat(row[label],1e6) for label in ['published','main','candidate']]+[f"{row['ownEnginePercent']:.2f}%"] for row in final['signalsComparison']],
 'note':'Final writes improve 70.74%, fan-out 145.77% and effect creation/disposal 251.34% versus published Forma in this campaign. The batch-of-100-writes mean regresses 13.79% versus published and 6.93% versus pre-effect main. All five samples and their substantial spreads remain visible in the evidence; overlapping SDs do not prove equivalence. The 86.62% overall own-engine ratio does not erase that batching point regression or the 71.64% fan-out miss.',
 'sources':final_sources
},{
 'title':'Final client campaign — all nine DOM operations',
 'description':'Milliseconds, mean ± sample SD; lower is better. Each source has its own same-trial vanilla control in the archive; the table shows the final candidate’s paired vanilla. Percentage changes compare the final candidate with published and pre-effect main in this same campaign.',
 'columns':['Operation']+labels+['Final-trial vanilla','Final vs published','Final vs main'],
 'rows':[[row['name']]+[final_stat(row[label]) for label in ['published','main','candidate','sameTrialVanilla']]+[f"{row['candidateVsPublishedDurationChangePercent']:+.2f}%",f"{row['candidateVsMainDurationChangePercent']:+.2f}%"] for row in final['domComparison']],
 'note':'Create-1,000 is 44.56 ± 4.11 ms versus vanilla 26.14 ± 2.40 ms: 1.705×, above the original 1.10× target. Selection is 1.36 ms versus published 0.68 ms, though pre-effect main is already 1.58 ms. Clear rises from main’s 4.60 ms to 6.00 ms (+30.43%), with published at 6.04 ms. These point regressions are disclosed, not hidden by a geometric mean. Five sequential samples and nonrandomized source order limit causal attribution; no blanket non-regression claim is made.',
 'sources':final_sources
},{
 'title':'Final client campaign — application bytes and evidence boundaries',
 'description':'All statically loaded JavaScript for the unchanged client benchmark application. These bytes belong to each source in run 40140319634; they are separate from package import-graph and island-route budgets.',
 'columns':['Source','Raw JavaScript, B','gzip 9, B','Brotli 11, B'],
 'rows':[[label]+[f"{bundle[key]:,}" for key in ['bytes','gzip','brotli']] for label,bundle in zip(labels,final['bundles'])],
 'note':'The final application is 8,498 B Brotli: 154 B smaller than published Forma and 81 B larger than pre-effect main. The independent package/route size decisions, their old-limit misses and their new ceilings are documented separately. This campaign uses gha-4-v1: signal processes receive one CPU/1 GiB on CPU 0, and the browser/driver use CPUs 1–3 with the locked Chromium 156.0.8078.4. No cross-campaign timing gains, final server rerace, publication or deployment are inferred.',
 'sources':final_sources
}]
sections[-1].update({
 'title':'Qualification and disclosed limitations',
 'description':'Each campaign keeps its source, VM, raw samples and outcome. Product acceptance decisions are separate from whether the original numerical target passed.',
 'rows':[
  ['Full 14-stack server championship','Corrected full campaign independently passes; prior unresolved run retained'],
  ['Paired static routes and walker','Audited; byte, mean-based tail and strength budgets pass'],
  ['Final client 9ac07a44','Measured and audited; original fan-out and row-creation targets missed, batching point regression disclosed'],
  ['3.1 product decision','Stable row behavior and explicit remaining performance costs accepted prospectively'],
  ['Release qualification and publication','Packed checks, independent release audit, RC publication and active burn-in remain separate requirements'],
 ],
 'note':'The retained failed and rollback campaigns stay unchanged. No package release or deployment is established by this report.',
 'sources':[src('Qualified full server campaign',run(40123441558)),src('Paired server campaign',run(40116668819))]+final_sources,
})
j={'status':'The final client candidate is measured alongside published Forma and pre-effect main. Public effects improve substantially; the original fan-out and row-creation targets remain missed, with batching and DOM point regressions disclosed below. These limitations are accepted as prospective 3.1 product tradeoffs. Packed release qualification, publication and burn-in are not established by this report.','method':'Fresh Linux campaigns use separately recorded VM identities and the dated gha-4-v1 allocation. Compare trials only within a campaign; all samples, spreads and earlier failed outcomes are retained. Historical October 23 standings remain in the separate historical report.','sections':sections}
out.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
print(out)
