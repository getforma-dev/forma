"""Offline integrity check; this does not rerun or replace performance acceptance."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import stat
import zipfile

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'archives.json').read_text())
checksums = json.loads((root / 'SHA256SUMS.json').read_text())
expected = [record['path'] for record in checksums]
assert len(expected) == len(set(expected)), 'duplicate manifest paths'
actual = [str(path.relative_to(root)) for path in root.rglob('*')
          if path.is_file() and path != root / 'SHA256SUMS.json']
assert sorted(actual) == sorted(expected), 'snapshot files differ from manifest'

for record in checksums:
    path = (root / record['path']).resolve()
    assert path.is_relative_to(root), record['path']
    data = path.read_bytes()
    assert len(data) == record['bytes'], record['path']
    assert hashlib.sha256(data).hexdigest() == record['sha256'], record['path']

for record in manifest['archives']:
    path = root / record['archive']
    data = path.read_bytes()
    assert len(data) == record['bytes'], record['name']
    assert hashlib.sha256(data).hexdigest() == record['sha256'], record['name']
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), record['name']
        for member in archive.infolist():
            name = PurePosixPath(member.filename)
            assert not name.is_absolute() and '..' not in name.parts, member.filename
            assert not stat.S_ISLNK(member.external_attr >> 16), member.filename
        assert archive.testzip() is None, record['name']

print(f'PASS: {len(checksums)} file hashes and {len(manifest["archives"])} original archive digests/ZIP checks')
