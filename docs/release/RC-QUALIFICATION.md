# RC qualification evidence

This record distinguishes original measured sources from later evidence and
release commits. The normal packed RC qualification tested
`e75eeaaa35c98370146c4df81e7a0a4e6bec89ad`, tree
`1bf25cb8c327c6711fe8d858acea0ee43b3633a3`, against the actual published beta.4
baseline. [Run 39049587766](https://github.com/getforma-dev/forma/actions/runs/39049587766)
passed **all 61 checks in 1,224.085 seconds**, within the unchanged 1,800-second
P17 limit. The original result and every raw observation remain retained.

Both twenty-run routes had empty raw Lighthouse and independent observer
long-task lists; whole-page TBT p95 was zero, with no attribution exclusion or
whole-page target miss. The demanding 1 MiB decoder's forty samples had p95
20.9 ms and maximum 23.8 ms; ASCII p95 was 9.2 ms and maximum 9.8 ms. All
correctness and refusal controls passed. These are current observations, not a
universal hardware or worst-case bound.

The original seven archives, source restoration and published baseline were
authenticated. The 197-record evidence journal covers 110,080,468 bytes,
including all forty raw LHR/trace/input pairs and 93 ordered decoder rows.
All eleven deployment-skew cases passed in each of three browser engines.
The packed compiler/corpus, typed pages, both templates, native adoption,
Trusted Types/CSP/integrity, hostile matrix and expression controls passed.
The Linux owner completed cleanup with no faults or remaining owned processes;
707 adopted children were reaped. No campaign or sample was retried.

Native p99 throughput was 3.75–7.56 million nodes/s across the five shapes.
All retained 20,000-walk vectors pass the 1.5-million floor and greater-than-half
previous-release requirement. Rates are 0.779–0.901 of beta.4 on a different
runner CPU; this is not a controlled causal comparison or a claimed speedup.
The N5 paired median ratio was 22.99, below 64.

RC/final publication, combined-source CI and timing, D14 and active burn-in
remain separate pending steps; this qualification does not claim them.

## Published beta baseline

The actual [beta.4 release](https://github.com/getforma-dev/forma/releases/tag/v3.0.0-beta.4)
uses source `be8beb7d0a9291944f29881d8eb63712a68bd922`, tree
`08268ec1cb0fc0c2322641abbe793a9ec942b507`, annotated tag object
`ac4548b6d6c4981418adedfd83a2f5e2d563319b` and
[trusted Release39046246527](https://github.com/getforma-dev/forma/actions/runs/39046246527).
Exact-main CI39045127278 passed. All four npm archives and all three crate
archives were compared byte-for-byte with authenticated DS11. The crates are
unyanked; npm `next` points to `3.0.0-beta.4`, while the stable `latest` tags
remain unchanged. The seven-package set is `@getforma/{core,compiler,build,create-app}`
and `{forma-ir,forma-ir-derive,forma-server}` at the same version.

Original tagged P17 passed **61/61 in 1,165.054 seconds**. All forty Lighthouse
raw and forty independent-observer long-task lists are empty. All three browser
engines passed their full core and indexed lanes; the two parity engines passed
their recorded corpus. These are beta observations, not RC P17 evidence.

The original record job failed after creating the GitHub Release because its
complete list response omitted the current publication; that list body was not
retained, so the backend cause remains unproven. After a verified visibility
change, one record-only recovery succeeded. Attempt1 remains failed; attempt2
succeeded without retagging, republishing packages or rerunning producers/P17.
Release415924154 retains original `published_at=2026-10-17T16:21:03Z`.

The final [DS12](https://github.com/getforma-dev/forma/releases/download/v3.0.0-beta.4/release-record.json)
asset650949688 has 73,390,026 bytes and SHA-256
`3e613f5709a618fcdd6374b6a208730d7fecc6066ccdc0c73c73b9778d73f09a`.
Its P17 pointer retains producer attempt1, artifact `release-p17` and manifest
`fccecddeeeb7d28199a6771dddaa926c7d553fe6d40785da62d041559182562b`.
The published P17, SHA256SUMS and generated SECURITY assets were authenticated;
prerelease support has no invented stable-line dates. The unchanged RC baseline
reader accepted this actual beta DS12 as **comparable**. This supplies the
published baseline, not RC qualification.

DS12 records outer elapsed **2,461.377 seconds**, from workflow creation to its
acknowledged release write after recovery. This misses the **1,800-second outer
release target**; the passing P17 invocation does not satisfy that distinct
clock or measure maintainer effort. FORMA-187/145 retain the open release-duration
work. No waiver or predicted future pass is recorded here.

## Completed source-bound RC evidence

| Evidence | Actual producer and bounded conclusion |
|---|---|
| Ordinary RC CI/security | Runs39043883993/39043883979, source synthetic9851f0c601d7f0a3244d4f9bab47ef247db393ab with exact e75 tree. CI19 successes/one intentional legacy skip; Linux and Windows packed scaffolds172/172 including19 heavy cases. Six actual SR14 clean0/mutant101/corrected0 triples from18 logs. Setup rehearsal earns zero active burn-in credit. |
| Full252 mutation | Original0967b1a3e67386847f094812fdda9daf7b5f2332, run39004991447:249 caught+3 predeclared equivalent, no survivors/unqualified/missing;147 security/74 expression kills and matching3458 clean/restored test identities. Independent unchanged-subject/oracle applicability extends through e75 and the reviewed50d+215 delta. This is not a new exact-head campaign or D14. |
| Internal build/rebuild N7 | Original e60599fa37b986eb9c4a3418a4b013ef3d2cdb44, run39024338687, separate donor c2e4ffe63ae2a75b9f6f761bd264911361c15ea1. All20 pass: full build p95/max8,904.672518/8,969.879744 ms; save-to-visible784.399536/790.456168 ms. Fixed300-component/12-page, dependency-warm workload; external largest-application and cold-toolchain performance unmeasured. Relevant inputs remain unchanged in the reviewed prospective delta. |
| Original e75 R17 N7 | Run39043878960, separate workflow donor0c380a2e14010d1341bf829270521fdc5974331e. All20 complete commands succeeded; GNU-time rank19 p95 **570.93 s**, max **573.99 s**, strict p95<600 s. All101 edit/no-op vectors retained per owner/run under L-67; ratio p95/max1.0167561107074237/1.0344226876362221 and sampled single maximum≈0.2 ms. No whole-command descendant-cleanup proof or beta timing transfer is claimed. |
| RC CI-pack route bytes | Original CI39043883993 artifact12105585323, DS11c4fe6c36f5a99794dac71f3961a2fb22345dc4fbb4e4dd92b3341ca5c54d2570, source9851/e75 tree. Counter SSR/CSR Forma gzip26,208/25,531 B; indexed SSR/CSR28,046/27,403 B. Total page JS27,853/27,174/29,838/29,195 B respectively. All caps pass; indexed SSR margin54 B. Fresh RC pack12106822256 has byte-identical core/compiler/build archives and86 dist files, with the same complete source tree, fixture/lock inputs and recipe; these measurements apply without a repeat build. |
| Maintained public documentation | Finite claim review at d0c7c8a6 and approved four-file correction d2504f5c7082dd0559d13ac4cc3088be16caf860 resolve the recorded API, identity and scaffolder wording findings. Later release evidence prose still needs final factual review; no repeated broad discovery review is implied. |

Original failed campaigns and immutable failed tags retain their outcomes.
The indexed all-101 cost statistic is the founder's prospective L-67 contract,
with the disclosed intermittent-relative-spike tradeoff; it is neither measured
individual-edit latency p95 nor a product speedup. See
[gate dispositions](3.0-GATE-DISPOSITIONS.md).

## Nine non-audit RC rows

The following evidence closes these nine RC contract rows. FORMA-141 was
already complete. This does not close the independent D14 audit row or the
final milestone, and PR/source CI still governs integration.

| Contract row | Accepted evidence and scope |
|---|---|
| FORMA-101 | Reviewed subset/diagnostics and source controls, plus fresh RC packed compiler/native corpus and typed-page output. |
| FORMA-139 | Finite conformance/near-miss controls, blocking parity, reviewed diagnostic catalogue and fresh packed conformance. |
| FORMA-108 | Original 252 campaign with unchanged-input applicability, six actual SR14 probes, and fresh packed hostile/SR33 and 100,000-case expression proof. |
| FORMA-186 | Reviewed deployment identity/retention/rollback and all eleven fresh packed deployment cases in each of three engines. Direct application-owned hydration/import limitations remain documented. |
| FORMA-188 skew drill | Complete fresh 61-check RC P17 within 1,800 seconds, with authentic published-beta comparison, actual fixtures/skew and complete owned cleanup. |
| FORMA-190 | Packed template/fixture/static proofs and authenticated route-input equality to the measured RC pack. N2 remains 28,100 B; whole-page JavaScript remains 76,800 B. |
| FORMA-145 documentation | Completed finite public-surface review/corrections and factual beta/RC evidence prose. Actual outer G6 miss and pending audit/publication/final facts remain explicit. |
| FORMA-116 | Reviewed source controls and six real SR14 clean/mutant/corrected triples. Live distinct identity, protection enforcement and external alert delivery remain L-60 deferred. |
| FORMA-189 | Authentic beta DS12, all seven registries, generated SECURITY, history/baseline acceptance and recall/support controls; reviewed bounded record-visibility repair. Later releases require their own records. Live recall remains founder-only; the first S4 maintenance drill is after final. |

## Combined source and remaining sequence

Reviewed `50d5802a46fdb7a7f02b4a5ebaf4712d7aba4daa` lets P17 overlap independent
engine qualification; both publishers and the record writer still directly
require both successful gates. Reviewed
`7126fc6e8347a3027be357622e053b89a0d42cf7` bounds only post-write current-release
inventory visibility, preserving strict history, errors and original producer
identity. Neither fix predicts a future outer release-time pass.

The main-ancestry merge added no content. These fixes leave the packed P17,
route, native build/rebuild and full-252 subject/oracle inputs unchanged;
original measured identities above are preserved. FORMA-215 adds six finite
release-history controls inside R17. The original e75 twenty-run distribution
is therefore not relabeled as a measurement of this combined suite. One new
complete twenty-command campaign and ordinary CI must qualify that source;
its actual results will be recorded here before release acceptance.

The fresh L-65 auditor must assess the exact combined source, all completed
evidence and an empty blocking list. After accepted review and green CI, merge
with a merge commit, require exact-main CI, then create the immutable RC tag.
The tagged workflow performs its own complete verification and trusted
publication. Only the actual published RC set can earn the required 3,600
active fault-free burn-in seconds. Final metadata changes receive independent
review and normal qualification before trusted 3.0.0 publication. The fresh
v3 as-built record then ends this programme before consumer migrations, and
the recurrence monitor stops. No calendar waiting period is required.
