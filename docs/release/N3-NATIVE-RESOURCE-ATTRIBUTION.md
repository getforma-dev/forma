# Mobile task attribution

## General correlated rule (L-66)

The founder's `N3-startup-correlated-v1` rule classifies a task over 50 ms as
`browser-internal-unattributed` and nonblocking only when its readable trace has
no stack frames or script URLs attributable to Forma bundles or inline
application scripts, and all forty independent PerformanceObserver/input-response
runs record zero long tasks. Both original routes must have twenty complete,
correct activation and response observations under the unchanged profile.
Any independent long-task observation prevents this correlated classification
across the entire campaign. The deliberately slow negative control remains
separate and must still demonstrate observation and refusal of the injected task.

The classifier derives the application inventory from the actual main-frame
script requests, module compilations and script/context metadata in the same
navigation. Inline scripts in the application's context count as application
code, including anonymous scripts. Referenced nonapplication scripts require
complete captured source and an isolated-context binding to that same document;
anonymous evaluation wrappers must bind to that recorded execution. Missing or
ambiguous inventory, unreadable traces, unknown script references, application
stacks and foreign-frame execution cannot establish absence. This general rule
adds no Chromium-feature name or source-hash allowlist.

The category records the accepted correlation, not proof that every instruction
was implemented by the browser. Raw tasks, durations, traces, whole-page TBT/LCP
and `wholePageTargetMiss` remain unchanged. Application-attributed tasks retain
the 50 ms ceiling; response correctness and the 500 ms deadline, whole-page TBT
limit, sample count, profile and all negative controls remain enforced. Producer
finalization occurs only after both routes; validation independently recomputes
the all-forty condition and source attribution rather than trusting labels.

L-66 does not require repeating a full campaign solely to change attribution.
A retained complete campaign may be analyzed under the identified rule without
rewriting its original result. This does not complete missing stages, supply
missing observations or qualify changed products. Earlier failed P17 reports
remain failed; an analytical mobile result is not a whole-P17 pass.

## Earlier positive native-work proofs

`N3-startup-strict50-v6` and its predecessors separated positively proved browser
work outside island activation. Those proofs remain available independently of
L-66. Their historical requirement that all other unknown work count is now
qualified only by the general correlated rule above. No product code, fixture,
profile, sample count, response deadline or whole-page metric changes.

Native navigation lifecycle events use the existing complete main-document
request/response/commit, parser, V8-context and pinned audit-source proof. Their
duration does not establish origin: version 5 removes the former 1 ms internal
heuristic for `pagehide`, visibility-change and `unload` dispatch. The whole
task must still precede the observed first application script, contain only
the exact admitted native records, and satisfy every frame, resource and
nesting check. Any handler execution, unknown or foreign-frame child, or
post-script work keeps the whole task counted. This is not a general exemption
for lifecycle event names or long pre-script tasks.

Version 6 also accepts the observed thread-scoped instant form of those native
lifecycle records (`EventDispatch`, `devtools.timeline`, phase `I`, scope `t`,
no recorded duration and a positive safe-integer `sampleTraceId`). It requires
the same complete task and origin proof as the complete-event form. The instant
record is not evidence of zero execution cost or absence of listeners; any
execution or unknown record in the task still prevents exclusion.

A stylesheet task requires one parser-initiated same-origin request from the
committed main document, its matching successful response/data/finish, and the
matching `ParseAuthorStyleSheet` span in causal order. All four events must fit
the task with their native categories and phases. An arbitrary stylesheet URL
or an early timestamp is insufficient.

An SVG image requires more evidence. Its parser-initiated image resource must
create one blank internal document, with exact native loader flow identities,
parser and layout order and no ordinary browser-frame commit. A later main-page
`PaintImage` for the same resource must contain that internal frame's layout,
viewport, prepaint and SVG-root statistics. Both complete tasks must precede
the observed first application script. Missing, duplicated, foreign or
misnested identities, executable children and unknown events retain the whole
task. The internal frame is admitted only through this resource-and-paint
relationship; other child frames do not gain an exemption.

This follows pinned Chromium 156.0.8078.4 implementation:

- [`StyleSheetContents::ParseAuthorStyleSheet`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/css/style_sheet_contents.cc#435) emits the parser span for the external resource.
- [`SVGImage::DataChanged`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/svg/graphics/svg_image.cc#877) creates an isolated document with a blank URL.
- [`IsolatedSVGDocumentHost`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/svg/graphics/isolated_svg_document_host.cc#83) disables script execution and synchronously installs and lays out that document; native lifecycle events still occur.
- [`ImagePainter`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/paint/image_painter.cc#245) scopes `PaintImage` around drawing; [`SVGImage::PaintRecordForCurrentFrame`](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.4/third_party/blink/renderer/core/svg/graphics/svg_image.cc#454) updates the isolated frame's lifecycle during drawing.

The motivating beta.2 d602 tenant-login observation 19 recorded 81.598 ms of
stylesheet task, 124.643 ms of SVG document task and 171.892 ms of main-page
layout/paint. All ended before the first module compile at 1602.348 ms. The
retained trace provides the complete resource/frame/paint chain above. It does
not establish why that browser work was unusually slow.

That original P17 remains failed: 60 recorded checks passed, the client
comparison was not reached, and the report and raw traces are unchanged.
Separate analytical replay is not acceptance. Finite controls also retain the
earlier genuine 60.473 ms application task and the separate 57 ms independent
observer failure. Every raw task, whole-page TBT/LCP and `wholePageTargetMiss`
remains visible. At that policy revision, a fresh full campaign was required;
L-66 now permits separate retained-evidence analysis as described above.

The trusted beta.2 release run 38999734034 retains its failed outcome. Its first
tenant-login audit recorded a 66.737 ms document bootstrap task containing a
5.815 ms native `pagehide` dispatch, with no executable child; the task ended
711.757 ms before the first application module compile. Version 4's 1 ms
heuristic kept that task counted. Separate version 5 analysis preserves the
66.737 ms raw duration while proving its origin. The ninth audit's separate
`NO_NAVSTART` capture failure remains a failed observation; neither reanalysis
nor the eight retained pairs constitutes a completed P17 qualification.

The later beta.3 rehearsal remains failed at 60 of 61 checks. Its tenant-login
run 1 retained a 52.182 ms navigation task with an instant native `unload`
record; the task ended 714.431 ms before the first application compile. Separate
version 6 replay changes only that task's attribution across the 40 saved
observations, retaining its raw duration and every other task and metric. This
replay does not qualify the original P17 or complete its unfinished stages.

A subsequent beta.3 rehearsal on source `34aa2978` failed after 58 recorded
checks: its second tenant-login capture lacked the audited main frame's
`navigationStart`, `fetchStart`, main-document request and `CommitLoad`. The
main-frame ID stayed unchanged, but the renderer changed from 75033 to 75035.
That renderer's first positive-timestamp event appeared 596.832 ms after tracing
began. Its only `navigationStart` belonged to a different, empty-URL document;
Lighthouse correctly refused to use it. A successful earlier capture contained
a similar secondary-document event, so that event does not establish a target
redirect or changed main-frame identity. Late trace enablement during renderer
creation is a plausible explanation, not a proven Chromium internal cause.

The capture harness now uses a fixed inert same-origin neutral page before
Lighthouse's normal cache/storage reset, throttling and trace start. Destination
renderer initialization moves outside measurement; target navigation, resources
and application work remain cold and measured. The setup contract and remaining
qualification requirement are described in [RELEASING](../RELEASING.md).
Six predeclared captures, each with a fresh browser and origin, recorded the real
target navigation in the initial trace renderer and passed the pinned trace
processor. Measured response ordinals proved the target HTML and JavaScript
were first fetched during measurement, with no disk-cache or service-worker
response. Those diagnostic pages are not the release fixtures and do not
constitute P17 acceptance. The original missing-navigation trace still fails.
This change neither rewrites the retained trace nor accepts its missing sample.
The failed P17 and its scratch/backup evidence remain preserved; only a fresh
complete P17 can qualify the changed measurement setup.
