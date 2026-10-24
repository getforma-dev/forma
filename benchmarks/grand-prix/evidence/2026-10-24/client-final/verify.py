"""Replay final-client arithmetic offline; no benchmark or release qualification."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import math
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
load = lambda path: json.loads(path.read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
auth = load(ROOT / 'AUTHENTICATED.json')
provider = load(ROOT / 'provider-artifacts.json')['artifacts']
asset, = [row for row in provider if row['id'] == auth['artifact']]
archive = (ROOT / 'artifact.zip').read_bytes()
assert len(archive) == auth['bytes'] == asset['size_in_bytes']
assert sha(archive) == auth['sha256'] == asset['digest'].removeprefix('sha256:')
assert auth['run'] == asset['workflow_run']['id'] == 40140319634
assert auth['source'] == asset['workflow_run']['head_sha'] == '9ac07a446ebe8aaad407a895fa8aaece189bc69e'

expected = load(ROOT / 'independent/scored-analysis.json')
comparison = load(ROOT / 'independent/root-comparison.json')
assert comparison['analysisSha256'] == sha((ROOT / 'independent/scored-analysis.json').read_bytes())
for name, digest in load(ROOT / 'effects-review/SHA256SUMS.json').items():
    assert sha((ROOT / 'effects-review' / name).read_bytes()) == digest
with zipfile.ZipFile(ROOT / 'artifact.zip') as zipped:
    names = zipped.namelist()
    assert len(names) == len(set(names)) and sorted(names) == sorted(auth['members'])
    for member in zipped.infolist():
        path = PurePosixPath(member.filename)
        assert not path.is_absolute() and '..' not in path.parts
        assert not stat.S_ISLNK(member.external_attr >> 16)
    assert zipped.testzip() is None
    with tempfile.TemporaryDirectory(prefix='forma-final-client-audit-') as temporary:
        scratch = Path(temporary)
        zipped.extractall(scratch / 'artifact')
        (scratch / 'independent').mkdir()
        shutil.copy2(ROOT / 'independent/scored-analysis.py', scratch / 'independent/scored-analysis.py')
        subprocess.run([sys.executable, str(scratch / 'independent/scored-analysis.py')], check=True, capture_output=True)
        assert load(scratch / 'independent/scored-analysis.json') == expected
        (scratch / 'effects-review').mkdir()
        shutil.copy2(ROOT / 'effects-review/recompute.py', scratch / 'effects-review/recompute.py')
        for name in ['artifact.zip', 'AUTHENTICATED.json', 'provider-artifacts.json']:
            shutil.copy2(ROOT / name, scratch / name)
        subprocess.run([sys.executable, str(scratch / 'effects-review/recompute.py')], check=True, capture_output=True)
        assert load(scratch / 'effects-review/recomputed.json') == load(ROOT / 'effects-review/recomputed.json')
    run_path, = [name for name in names if name.endswith('/run.json')]
    run = json.loads(zipped.read(run_path))
    prefix = str(PurePosixPath(run_path).parent)
    bundles = []
    for trial in run['trials']:
        bundle = json.loads(zipped.read(f"{prefix}/{trial['ref']}/raw/bundle/forma.json"))
        assert bundle['campaign'] == run['campaign'] and bundle['resourceProfile'] == run['resourceProfile']
        assert bundle['car'] == 'forma' and bundle['event'] == 10
        for key in ['bytes', 'gzip', 'brotli']:
            assert sum(file[key] for file in bundle['files']) == bundle[key]
        bundles.append({'source': trial['ref'], **{key: bundle[key] for key in ['bytes', 'gzip', 'brotli']}})
    cleanup = json.loads(zipped.read(f"{prefix.rsplit('/', 1)[0]}/client-40140319634-1-cleanup.json"))
    assert run['passed'] is True and run['diagnostic'] is False and run['qualifiedProfile'] is True
    assert cleanup['id'] == run['id'] == 'client-40140319634-1' and cleanup['dry'] is False
    assert isinstance(cleanup['actions'], list) and cleanup['after']

def close(actual, expected):
    assert math.isclose(actual, expected, rel_tol=1e-11, abs_tol=1e-10), (actual, expected)

trials = expected['results']
assert [trial['source'] for trial in trials] == ['published', 'f5be8647439e560c71c27b8c5f4bde26507b8bbb', auth['source']]
for group, value_key, change_key in [('signals', 'forma', 'ChangePercent'), ('dom', 'forma', 'DurationChangePercent')]:
    for index, row in enumerate(comparison[group]):
        for label, trial in zip(['published', 'main', 'candidate'], trials):
            assert row['name'] == trial[group][index]['name']
            assert row[label] == trial[group][index][value_key]
        for label in ['Published', 'Main']:
            close(row['candidateVs' + label + change_key], (row['candidate']['mean'] / row[label.lower()]['mean'] - 1) * 100)
        if group == 'signals':
            close(row['ownEnginePercent'], trials[-1][group][index]['ratioPercent'])
        else:
            assert row['sameTrialVanilla'] == trials[-1][group][index]['vanilla']
            close(row['sameTrialVanillaRatio'], trials[-1][group][index]['formaToVanillaRatio'])

summary = {'runId': auth['run'], 'source': auth['source'], 'archiveSha256': auth['sha256'],
           'campaign': expected['campaign'], 'resourceProfile': expected['resourceProfile'],
           'phase': expected['phase'], 'results': trials, 'bundles': bundles,
           'signalsComparison': comparison['signals'], 'domComparison': comparison['dom'],
           'arithmeticReplayed': True, 'originalFanOutTargetPassed': False,
           'originalRowCreationTargetPassed': False, 'releaseQualification': False}
assert trials[-1]['numeric259Gates'] == {'write80': True, 'fan80': False, 'createDispose80': True, 'overall85': True}
assert trials[-1]['numeric260CreateWithin110Percent'] is False
assert sys.argv[1:] in [[], ['--write-summary']], 'unknown option'
if sys.argv[1:] == ['--write-summary']:
    (ROOT / 'publication-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
else:
    assert load(ROOT / 'publication-summary.json') == summary
print('PASS: provider-bound ZIP, two independent arithmetic replays, all29 timing/11 bundle records, retained cleanup record and report summary')
