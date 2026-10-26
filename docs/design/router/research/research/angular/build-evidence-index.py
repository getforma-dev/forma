"""Rebuild Angular's offline provenance index from retained source and REA evidence."""
from pathlib import Path
import collections
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
REPO = ROOT / '.local/upstream/angular'
SHA = 'ecaec13db4fde7ceb0104105ee356bf00596f3d6'
SPECS = '''
A01 packages/router/src/url_tree.ts 472 498
A02 packages/router/src/url_tree.ts 572 642
A03 packages/router/src/recognize.ts 120 172
A04 packages/router/src/recognize.ts 251 284
A05 packages/router/src/utils/config_matching.ts 54 118
A06 packages/router/src/shared.ts 153 235
A07 packages/router/src/directives/router_link.ts 480 533
A08 packages/router/src/navigation_transition.ts 447 985
A09 packages/router/src/statemanager/state_manager.ts 193 325
A10 packages/router/src/statemanager/navigation_state_manager.ts 117 239
A11 packages/router/src/statemanager/navigation_state_manager.ts 402 541
A12 packages/router/src/operators/check_guards.ts 56 171
A13 packages/router/src/operators/resolve_data.ts 28 126
A14 packages/router/src/router_config_loader.ts 40 110
A15 packages/router/src/route_reuse_strategy.ts 117 165
A16 packages/router/src/operators/activate_routes.ts 1 260
A17 packages/router/src/router_preloader.ts 60 198
A18 packages/router/src/router_scroller.ts 55 165
A19 packages/router/src/utils/preactivation.ts 176 205
A20 packages/router/src/provide_router.ts 906 956
A21 packages/router/src/operators/setup_and_run_resources.ts 28 215
A22 adev/src/app/routing/router_providers.ts 32 89
A23 adev/src/app/routing/routes.ts 19 164
A24 adev/shared-docs/utils/navigation.utils.ts 94 152
A25 adev/src/app/core/services/content-loader.service.ts 15 46
A26 adev/shared-docs/components/viewers/docs-viewer/docs-viewer.component.ts 87 139
A27 adev/shared-docs/components/viewers/docs-viewer/docs-viewer.component.ts 355 399
A28 adev/src/app/app-scroller.ts 44 119
A29 adev/src/app/app.config.ts 30 59
A30 adev/src/app/core/services/routing/adev-url-serializer.ts 15 25
A31 adev/src/app/features/tutorial/tutorials-route-reuse-strategy.ts 14 41
A32 adev/src/app/core/services/a-dev-title-strategy.ts 23 58
A33 adev/firebase.json 1 86
A34 packages/router/test/url_serializer.spec.ts 20 320
A35 packages/router/src/url_tree.ts 643 662
A36 packages/router/src/provide_router.ts 195 270
A37 adev/src/app/app.component.ts 57 87
A38 packages/router/src/url_tree.ts 810 884
A39 packages/router/test/integration/navigation.spec.ts 478 612
A40 packages/router/test/computed_state_restoration.spec.ts 45 235
'''

sources = []
for spec in SPECS.strip().splitlines():
    key, path, start, end = spec.split()
    blob = (REPO / path).read_bytes()
    start, end = int(start), min(int(end), len(blob.decode().splitlines()))
    assert start <= end
    sources.append(dict(id=key, repository='angular/angular', commit=SHA, path=path,
                        line_start=start, line_end=end,
                        url=f'https://github.com/angular/angular/blob/{SHA}/{path}#L{start}-L{end}',
                        sha256=hashlib.sha256(blob).hexdigest()))

(HERE / 'snippets').mkdir(exist_ok=True)
(HERE / 'LICENSE.angular.txt').write_bytes((REPO / 'LICENSE').read_bytes())
for name, path, start, end in [
    ('first-successful-recognition', 'packages/router/src/recognize.ts', 251, 284),
    ('navigation-ownership', 'packages/router/src/navigation_transition.ts', 452, 459),
    ('content-promise-cache', 'adev/src/app/core/services/content-loader.service.ts', 19, 44),
    ('url-parser-host-alignment', 'adev/src/app/core/services/routing/adev-url-serializer.ts', 15, 25),
]:
    lines = (REPO / path).read_text().splitlines()
    header = ('// Upstream excerpt; not a standalone module.\n'
              '// Copyright Google LLC. MIT license: ../LICENSE.angular.txt\n'
              f'// Source: https://github.com/angular/angular/blob/{SHA}/{path}#L{start}-L{end}\n'
              f'// Exact source lines {start}–{end}; indentation retained.\n\n')
    (HERE / 'snippets' / f'{name}.excerpt.ts').write_text(header + '\n'.join(lines[start-1:end]) + '\n')

runs = []
for name in ['angular-history', 'angular-main']:
    run = json.loads((ROOT / f'.local/rea/{name}/run.json').read_text())
    ev = json.loads((ROOT / f'.local/rea/{name}/evidence.json').read_text())
    n = ev['normalized_result']
    sem, inv = n['semantic_graph'], n['route_inventory']
    runs.append(dict(name=name, run=run, evidence_id=ev['evidence_id'], statistics=n['statistics'],
                     route_inventory={key: inv[key] for key in ['statistics', 'coverage', 'routes']},
                     semantic_coverage={k: v for k, v in sem['coverage'].items() if k != 'families'},
                     graph_relation_counts=dict(collections.Counter(e.get('kind') for e in n['graph']['edges'])),
                     limitations=ev['limitations']))
(HERE / 'rea-summary.json').write_text(json.dumps(runs, indent=2) + '\n')
capture = json.loads((ROOT / '.local/captures/angular/capture.json').read_text())
documents = []
for doc in sorted((REPO / 'adev/src/content/guide/routing').glob('*.md')):
    rel = str(doc.relative_to(REPO))
    live_path = '' if doc.stem == 'overview' else '/' + doc.stem
    documents.append(dict(path=rel, sha256=hashlib.sha256(doc.read_bytes()).hexdigest(),
                          official_url='https://angular.dev/guide/routing' + live_path,
                          pinned_url=f'https://github.com/angular/angular/blob/{SHA}/{rel}',
                          retention='Sparse checkout; fetched as source documentation, not individual live HTML captures'))
manifest = dict(retrieved_date='2026-10-26', source_repo='https://github.com/angular/angular', commit=SHA,
                pin_basis='Public footer reported v22.2.3+sha-ecaec13; GitHub commit API resolved the prefix. Self-reported deployment identity, not a reproducible-byte attestation.',
                local_checkout='.local/upstream/angular', site_entry='https://angular.dev/guide/routing',
                site_source='adev/', library_source='packages/router/', source_license='MIT',
                documentation_license='CC BY 4.0 according to the website footer; prose is linked rather than broadly copied.',
                sources=sources, documentation=documents, capture_manifest='.local/captures/angular/capture.json', capture=capture,
                rea_runs=[dict(name=r['name'], path=f".local/rea/{r['name']}", evidence_id=r['evidence_id']) for r in runs])
(HERE / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
with (HERE / 'source-index.md').open('w') as f:
    f.write(f'# Angular pinned source index\n\nAll entries use `{SHA}`. Local source is under `../../.local/upstream/angular/`. Full hashes are in [sources.json](sources.json).\n\n| ID | Source | Lines |\n| --- | --- | --- |\n')
    for source in sources:
        f.write(f"| {source['id']} | [{source['path']}]({source['url']}) | {source['line_start']}–{source['line_end']} |\n")
print(f'Indexed {len(sources)} source references, four excerpts, two REA runs, and capture manifest.')
