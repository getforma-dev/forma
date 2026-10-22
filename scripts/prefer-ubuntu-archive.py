#!/usr/bin/env python3
"""Prefer the runner's existing official Ubuntu mirror; retain apt trust policy."""
import argparse
import os
from pathlib import Path
import platform
import shlex
import subprocess


MIRRORS = Path('/etc/apt/apt-mirrors.txt')
SOURCES = Path('/etc/apt/sources.list.d/ubuntu.sources')
ORIGINAL = ('http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
            'https://archive.ubuntu.com/ubuntu/\tpriority:2\n'
            'https://security.ubuntu.com/ubuntu/\tpriority:3\n')
PREFERRED = ORIGINAL.replace('priority:1', 'priority:2', 1).replace(
    'https://archive.ubuntu.com/ubuntu/\tpriority:2',
    'https://archive.ubuntu.com/ubuntu/\tpriority:1', 1)
ACQUIRE_KEYS = ('Acquire::Retries', 'Acquire::http::Timeout', 'Acquire::https::Timeout')


def preferred_mirrors(text):
    if text not in (ORIGINAL, PREFERRED):
        raise ValueError('Unexpected Ubuntu mirror list; refusing to modify it')
    return PREFERRED


def validate_host(release_text, runner_environment, system, machine, github_actions):
    release = dict(line.split('=', 1) for line in release_text.splitlines()
                   if '=' in line and not line.startswith('#'))
    if (runner_environment != 'github-hosted' or github_actions != 'true'
            or system != 'Linux' or machine != 'x86_64'
            or shlex.split(release.get('ID', '')) != ['ubuntu']
            or shlex.split(release.get('VERSION_ID', '')) != ['24.04']):
        raise ValueError('Mirror preference requires a GitHub-hosted Ubuntu 24.04 x64 runner')


def validate_sources(text):
    # Read-only: never rewrite suites, components, signing keys or security sources.
    fields, stanzas = {}, []
    for line in text.splitlines() + ['']:
        if line.startswith('#'):
            continue
        if not line.strip():
            if fields:
                stanzas.append(fields)
                fields = {}
            continue
        if ':' not in line or line[0].isspace():
            raise ValueError('Unexpected Ubuntu source format; refusing mirror change')
        key, value = line.split(':', 1)
        if key in fields:
            raise ValueError('Duplicate Ubuntu source field; refusing mirror change')
        fields[key] = value.strip()
    suites = set()
    allowed = {'Types', 'URIs', 'Suites', 'Components', 'Signed-By', 'Architectures'}
    for fields in stanzas:
        if (not fields.keys() <= allowed
                or fields.get('URIs') != 'mirror+file:/etc/apt/apt-mirrors.txt'
                or fields.get('Signed-By') != '/usr/share/keyrings/ubuntu-archive-keyring.gpg'
                or not set(fields.get('Types', '').split()) <= {'deb', 'deb-src'}
                or not fields.get('Types') or not fields.get('Components')
                or not set(fields['Components'].split()) <= {'main', 'restricted', 'universe', 'multiverse'}):
            raise ValueError('Unexpected Ubuntu source policy; refusing mirror change')
        suites.update(fields.get('Suites', '').split())
    if suites != {'noble', 'noble-updates', 'noble-backports', 'noble-security'}:
        raise ValueError('Unexpected Ubuntu suites; refusing mirror change')


def configure(mirrors=MIRRORS, sources_file=SOURCES, run=subprocess.run):
    before, sources = mirrors.read_text(), sources_file.read_text()
    after = preferred_mirrors(before)
    validate_sources(sources)
    # Query only these public numeric settings; never dump proxy/credential config.
    effective = run(['apt-config', 'shell',
        'APT_RETRIES', ACQUIRE_KEYS[0], 'APT_HTTP_TIMEOUT', ACQUIRE_KEYS[1],
        'APT_HTTPS_TIMEOUT', ACQUIRE_KEYS[2]], check=True, capture_output=True,
        text=True, timeout=10).stdout
    print('apt mirror preference before:\n' + before, end='', flush=True)
    print('Effective apt retry/timeouts (unset values use apt defaults):\n' + effective, end='', flush=True)
    if before != after:
        run(['sudo', 'tee', str(mirrors)], input=after, text=True,
            stdout=subprocess.DEVNULL, check=True, timeout=10)
    if mirrors.read_text() != after or sources_file.read_text() != sources:
        raise RuntimeError('Unexpected apt configuration change during mirror preference')
    print('apt mirror preference after:\n' + after, end='', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runner-environment', required=True, choices=['github-hosted'])
    args = parser.parse_args()
    validate_host(Path('/etc/os-release').read_text(), args.runner_environment,
                  platform.system(), platform.machine(), os.environ.get('GITHUB_ACTIONS'))
    configure()


if __name__ == '__main__':
    main()
