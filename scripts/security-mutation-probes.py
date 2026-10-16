#!/usr/bin/env python3
"""SR14: compile real isolated source weakenings; only named assertion failures kill them.

Never modifies the checkout or its target directory. All logs and scratch bytes
survive failure. Run on committed clean source with CARGO_BUILD_JOBS <= 3.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
WALKER = 'crates/forma-ir/src/walker.rs'
CSP = 'crates/forma-server/src/csp.rs'
PROBES = [
    dict(id='text-fast', path=WALKER, function='push_escaped_html', old="'<' => out.push_str(\"&lt;\"),", new="'<' => out.push('<'),", crate='forma-ir', test='walker::tests::walk_text_escaping'),
    dict(id='text-bounded', path=WALKER, function='push_escaped_html', old="'<' => push_checked(out, \"&lt;\", limit)?,", new="'<' => push_char_checked(out, '<', limit)?,", crate='forma-ir', test='walker::tests::security_probe_bounded_text_escaping'),
    dict(id='attribute-fast', path=WALKER, function='push_escaped_attr', old="'\"' => out.push_str(\"&quot;\"),", new="'\"' => out.push('\"'),", crate='forma-ir', test='walker::tests::walk_attr_escaping'),
    dict(id='attribute-bounded', path=WALKER, function='push_escaped_attr', old="'\"' => push_checked(out, \"&quot;\", limit)?,", new="'\"' => push_char_checked(out, '\"', limit)?,", crate='forma-ir', test='walker::tests::security_probe_bounded_attribute_escaping'),
    dict(id='name-tail', path=WALKER, function='is_valid_name', old="chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))", new='true', crate='forma-ir', test='walker::tests::walk_rejects_hostile_tag_name'),
    dict(id='script-policy', path=CSP, function='strict_directives', old='"\'strict-dynamic\'".to_string(),', new='"\'unsafe-inline\'".to_string(),', crate='forma-server', test='csp::tests::csp_is_strict'),
]


def mutate(source, probe):
    start = source.index('fn ' + probe['function'] + '(')
    end = source.index('\n}', start) + 2
    body = source[start:end]
    if body.count(probe['old']) != 1:
        raise ValueError('mutation anchor drift: ' + probe['id'])
    return source[:start] + body.replace(probe['old'], probe['new']) + source[end:]


def outcome(code, output, name):
    """Timeouts, compiler errors, zero tests and a different failure never count."""
    if re.search(r'^error(?:\[|: could not compile)', output, re.M) or 'running 1 test\n' not in output:
        return 'invalid'
    if code == 0 and f'test {name} ... ok' in output and '1 passed; 0 failed;' in output:
        return 'pass'
    if code == 101 and f'test {name} ... FAILED' in output and 'panicked at' in output and '0 passed; 1 failed;' in output:
        return 'killed'
    return 'invalid'


def execute(args, cwd, log, env):
    with log.open('wb') as stream:
        child = subprocess.Popen(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        try:
            code = child.wait(timeout=240)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            stream.write(b'\nPROBE_TIMEOUT: no mutation credit\n')
            raise RuntimeError('security probe timed out: ' + str(log))
    return code, log.read_text(errors='replace')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT).strip():
        raise RuntimeError('commit tracked source before qualifying it')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    scratch = Path(tempfile.mkdtemp(prefix='forma-security-probes-'))
    # git archive contains only this reviewed commit. Refuse links and escaping
    # paths explicitly, including on Python versions without tar's data filter.
    archive = subprocess.check_output(['git', 'archive', commit], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not (member.isfile() or member.isdir()) or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('unsupported archive member: ' + member.name)
        tar.extractall(scratch)
    env = {**os.environ, 'CARGO_BUILD_JOBS': str(min(3, max(1, int(os.environ.get('CARGO_BUILD_JOBS', '3'))))), 'CARGO_TARGET_DIR': str(scratch / 'target'), 'CARGO_TERM_COLOR': 'never'}
    report = dict(schema=1, passed=False, commit=commit, scratch=str(scratch), startedAt=time.time(), probes=[])
    destination = out / 'qualification.json'
    save = lambda: destination.write_text(json.dumps(report, indent=2) + '\n')
    originals = {name: (scratch / name).read_text() for name in {p['path'] for p in PROBES}}
    report['sourceSha256'] = {name: hashlib.sha256(text.encode()).hexdigest() for name, text in originals.items()}
    save()
    try:
        for probe in PROBES:
            source = scratch / probe['path']
            original = originals[probe['path']]
            changed = mutate(original, probe)
            row = dict(id=probe['id'], test=probe['test'], path=probe['path'], mutantSha256=hashlib.sha256(changed.encode()).hexdigest(), runs=[])
            report['probes'].append(row)
            command = ['cargo', 'test', '--locked', '-p', probe['crate'], '--lib', probe['test'], '--', '--exact', '--nocapture', '--test-threads=1']
            try:
                for mode in ['before', 'mutant', 'corrected']:
                    source.write_text(changed if mode == 'mutant' else original)
                    log = out / (probe['id'] + '-' + mode + '.log')
                    code, output = execute(command, scratch, log, env)
                    verdict = outcome(code, output, probe['test'])
                    row['runs'].append(dict(mode=mode, exit=code, verdict=verdict, log=log.name, sha256=hashlib.sha256(log.read_bytes()).hexdigest()))
                    save()
                    if verdict != ('killed' if mode == 'mutant' else 'pass'):
                        raise RuntimeError(f'{probe["id"]}/{mode}: {verdict}; see {log}')
            finally:
                source.write_text(original)
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        report['elapsedSeconds'] = time.time() - report['startedAt']
        report['sourceRestored'] = all((scratch / name).read_text() == text for name, text in originals.items())
        save()
        print(destination)


if __name__ == '__main__':
    main()
