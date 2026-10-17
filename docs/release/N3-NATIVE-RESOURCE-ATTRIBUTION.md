# Native navigation, parser and SVG-image attribution

`N3-startup-strict50-v5` keeps every application, mixed, unknown and independent
observer task subject to 50 ms. It extends positive attribution of browser work
outside island activation; it changes no product code, fixture, profile, sample
count, response deadline or whole-page metric.

Native navigation lifecycle events use the existing complete main-document
request/response/commit, parser, V8-context and pinned audit-source proof. Their
duration does not establish origin: version 5 removes the former 1 ms internal
heuristic for `pagehide`, visibility-change and `unload` dispatch. The whole
task must still precede the observed first application script, contain only
the exact admitted native records, and satisfy every frame, resource and
nesting check. Any handler execution, unknown or foreign-frame child, or
post-script work keeps the whole task counted. This is not a general exemption
for lifecycle event names or long pre-script tasks.

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
remains visible. A fresh full campaign is required for the new policy.

The trusted beta.2 release run 38999734034 retains its failed outcome. Its first
tenant-login audit recorded a 66.737 ms document bootstrap task containing a
5.815 ms native `pagehide` dispatch, with no executable child; the task ended
711.757 ms before the first application module compile. Version 4's 1 ms
heuristic kept that task counted. Separate version 5 analysis preserves the
66.737 ms raw duration while proving its origin. The ninth audit's separate
`NO_NAVSTART` capture failure remains unresolved; neither reanalysis nor the
eight retained pairs constitutes a completed P17 qualification.
