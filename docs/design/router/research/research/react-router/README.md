# React Router research package

Read [report.md](report.md) first for the implementation explanation, source
links, website-specific findings, REA limitations and reconstruction test matrix.
The [40-question ledger](questions.md) separates answered questions from future
Forma design choices. [Code examples](snippets/README.md) include attributed
upstream excerpts and a small original concurrency pattern with executed tests.

The library baseline is React Router **8.5.0**, release commit
`4fe4525102870a2b21a4a0568a651d118f5e5dbb`. The separate docs application snapshot
is `remix-run/react-router-website` at
`e9b619c5b05209d1eaf0ba02218633732347c789`. The website's exact deployed Git commit
was not established. The public asset manifest build is `b63cec8d`.

## Evidence map

| Item | Location |
|---|---|
| Source commits, hashes, HTTP headers, asset URLs and REA IDs | [sources.json](sources.json) |
| Captured boot configuration | [site-context.json](site-context.json) |
| Inert JSON extraction of 13 route records | [site-manifest-summary.json](site-manifest-summary.json) |
| Selected REA observations with original IDs/locations/limitations | [rea-observations.json](rea-observations.json) |
| License notices | [licenses](licenses/) |
| Library and website clones | [library](../../.local/upstream/react-router/), [website](../../.local/upstream/react-router-website/) |
| Public document and seven selected JS assets | [captures](../../.local/captures/react-router/) |
| Four-file and two-file successful REA runs | [doc chunks](../../.local/rea/react-router-doc-chunks/), [layout chunks](../../.local/rea/react-router-layout-chunks/) |
| Entry bundle timeout and partial evidence | [entry run](../../.local/rea/react-router-entry/) |
| Corrected browser sample | [browser evidence](../../evidence/browser-react-router.json) |

Local `.local` material is an ignored working evidence cache. Preserve it when
archiving the study or recover exact public revisions/asset URLs from the manifest;
content-hashed public asset URLs are not guaranteed to remain hosted forever.

## Repeat a bounded local REA observation

From the project root, with the shared installation described in
[/Users/victorvillacis/dev/tools/REA-SETUP.md](/Users/victorvillacis/dev/tools/REA-SETUP.md):

```sh
python3 scripts/run_rea.py react-router-doc-repeat-001 \
  .local/captures/react-router/assets \
  --source root-CmiqwOFp.js \
  --source doc-CVbegNQE.js \
  --source utils-CTsB3O1x.js \
  --source manifest-b63cec8d.js
```

Choose a fresh run name; the helper refuses overwriting an existing run. It uses
a shared serial lock, per-source deadline, memory/semantic caps and retained
stdout/stderr/metadata. Repeating the timed-out large entry without a new reason
is not necessary to use the source-derived report. Static REA analysis does not
execute downloaded JavaScript.

Run the original example's tests without installing upstream dependencies:

```sh
node --test --test-reporter=tap research/react-router/snippets/transaction-pattern.test.mjs
```

No upstream build or test suite was run, no production actions were submitted,
and no deployed website was changed. Findings are scoped to their evidence label
and pinned revision.
