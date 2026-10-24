"""Bounded credential/privacy scan of original artifact members, without printing values."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

root = Path(__file__).resolve().parent
patterns = {
    'github-credential': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'),
    'aws-access-key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'slack-credential': re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{12,}'),
    'url-userinfo': re.compile(r'https?://[^/\s:@]+:[^/\s@]+@'),
    'signed-download-url': re.compile(r'https?://[^\s"<>]+[?&](?:sig|X-Amz-Signature|token)=[^\s"<>]+', re.I),
}
secret_key = re.compile(r'^(?:authorization|proxy-authorization|password|passwd|secret|token|accessToken|refreshToken|privateKey|credentials|RUNNER_TRACKING_ID)$', re.I)
findings, binaries, environment_fields = [], [], []
texts = 0

def add(file, kind, value, key=None):
    findings.append({'file': file, 'kind': kind, 'key': key,
                     'valueSha256': hashlib.sha256(str(value).encode()).hexdigest()})

def walk(file, value, key=''):
    if isinstance(value, dict):
        for name, item in value.items():
            pointer = key + '/' + name
            if secret_key.fullmatch(name) and item not in (None, '', [], {}):
                add(file, 'sensitive-key', item, pointer)
            if name in ('Name', 'DockerRootDir', 'hostFreeDisk', 'kernel', 'cpu', 'hostCpuModel') and item:
                environment_fields.append({'file': file, 'key': pointer})
            walk(file, item, pointer)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            walk(file, item, key + '/' + str(i))

with zipfile.ZipFile(root / 'artifact.zip') as archive:
    for item in archive.infolist():
        if item.is_dir():
            continue
        data = archive.read(item)
        try:
            text = data.decode('utf8')
            if '\x00' in text:
                raise UnicodeError('binary NUL')
        except UnicodeError:
            binaries.append({'file': item.filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            continue
        texts += 1
        for label, pattern in patterns.items():
            for match in pattern.finditer(text):
                add(item.filename, label, match.group())
        if item.filename.endswith('.json'):
            walk(item.filename, json.loads(text))

result = {'textFilesScanned': texts, 'patterns': list(patterns), 'findings': findings,
          'binaryFiles': binaries, 'ephemeralRunnerMetadataLocations': environment_fields,
          'limitations': ['Pattern and key scan plus independent source review; it cannot prove that arbitrary binary contents contain no secret.',
                          'CPU/kernel, container/image IDs, disk figures, ephemeral runner hostnames and filesystem paths are expected benchmark provenance, not credentials.',
                          'Campaign machine and runner-tracking identities are SHA-256 hashes; temporary signed download URLs are excluded from publication manifests.']}
(root / 'privacy-scan.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'textFilesScanned': texts, 'findings': len(findings), 'binaryFiles': len(binaries)}))
raise SystemExit(bool(findings))
