#!/usr/bin/env python3
"""Linux CI child subreaper: detached descendants remain owned after a parent exits.

PR_SET_CHILD_SUBREAPER: https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html
Signals use pidfds, so a recycled numeric PID is never a signal target.
This supervises only its own subprocess tree; it never sweeps unrelated jobs.
"""
import ctypes
import json
import os
import pathlib
import selectors
import signal
import subprocess
import sys
import time


def status(pid):
    try:
        data = pathlib.Path(f'/proc/{pid}/stat').read_text()
    except FileNotFoundError:
        return None
    fields = data[data.rfind(')') + 2:].split()
    return {'pid': pid, 'ppid': int(fields[1]), 'state': fields[0], 'start': int(fields[19])}


def children(parent):
    result = []
    for entry in pathlib.Path('/proc').iterdir():
        if entry.name.isdigit():
            row = status(int(entry.name))
            if row and row['ppid'] == parent:
                result.append(row)
    return result


def reap_adopted_zombies(main_pid):
    # This dedicated subreaper creates only the Popen worker. Other direct
    # children were adopted from its tree. Popen alone owns the worker status.
    reaped = 0
    parent = os.getpid()
    for row in children(parent):
        if row['pid'] == main_pid or row['state'] != 'Z':
            continue
        actual = status(row['pid'])
        if actual != row:
            continue
        try:
            pid, _ = os.waitpid(row['pid'], os.WNOHANG)
        except ChildProcessError:
            continue
        reaped += pid != 0
    return reaped


def sweep_owned(deadline):
    captured, failures, signalled = {}, [], []
    def capture(row):
        pid = row['pid']
        if pid in captured:
            assert captured[pid][0]['start'] == row['start'], 'owned PID identity changed'
            return
        assert len(captured) < 4096, 'owned process count exceeded'
        try:
            fd = os.pidfd_open(pid)
        except ProcessLookupError:
            return
        actual = status(pid)
        if actual is None:
            os.close(fd)
            return
        assert actual['start'] == row['start'], 'PID changed before pidfd capture'
        captured[pid] = (actual, fd)
        if actual['state'] != 'Z':
            try:
                signal.pidfd_send_signal(fd, signal.SIGSTOP)
            except ProcessLookupError:
                return
            while True:
                actual = status(pid)
                if actual is None or actual['state'] in ('T', 't', 'Z'):
                    break
                assert time.monotonic() < deadline, 'owned stop deadline'
                time.sleep(0.005)  # Shutdown only, never credited as workload.
        # A stopped parent cannot fork after its children are enumerated.
        for child in children(pid):
            capture(child)
    try:
        while True:
            before = len(captured)
            for row in children(os.getpid()):
                capture(row)
            if len(captured) == before:
                break
            assert time.monotonic() < deadline, 'owned capture deadline'
    except BaseException as error:
        failures.append(str(error))
    finally:
        try:
            for row, fd in reversed(list(captured.values())):
                try:
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
                    signalled.append({'pid': row['pid'], 'start': row['start']})
                except ProcessLookupError:
                    pass
            while True:
                try:
                    while os.waitpid(-1, os.WNOHANG)[0]:
                        pass
                except ChildProcessError:
                    pass
                remaining = children(os.getpid())
                if not remaining:
                    break
                assert time.monotonic() < deadline, 'owned reap deadline'
                time.sleep(0.005)
        except BaseException as error:
            failures.append(str(error))
        for _, fd in captured.values():
            os.close(fd)
    remaining = children(os.getpid())
    return {'complete': not failures and not remaining, 'remainingOwnedPids': [r['pid'] for r in remaining], 'failures': failures, 'captured': [r for r, _ in captured.values()], 'signalled': signalled}


def supervise(command, directory, timeout, max_log_bytes=16 * 1024 * 1024):
    assert sys.platform == 'linux', 'owned supervisor requires Linux'
    assert hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal')
    libc = ctypes.CDLL(None, use_errno=True)
    assert libc.prctl(36, 1, 0, 0, 0) == 0, 'cannot establish child subreaper'
    result = {'schema': 1, 'complete': False, 'command': command, 'faults': [], 'exitCode': None, 'reapedDuringRun': 0}
    directory = pathlib.Path(directory)
    directory.mkdir()  # Fresh evidence; no overwrite or deletion on failure.
    interrupted = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda value, _frame: interrupted.append(value))
    child = None
    selector = selectors.DefaultSelector()
    at = time.monotonic()
    next_reap = at
    try:
        with (directory / 'worker.log').open('xb', buffering=0) as output:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            os.set_blocking(child.stdout.fileno(), False)
            selector.register(child.stdout, selectors.EVENT_READ)
            size = 0
            while selector.get_map() or child.poll() is None:
                assert not interrupted, f'owned interruption {interrupted}'
                assert time.monotonic() - at < timeout, 'worker deadline exceeded'
                for key, _ in selector.select(0.1):
                    part = os.read(key.fd, 65536)
                    if not part:
                        selector.unregister(key.fd)
                        continue
                    size += len(part)
                    assert size <= max_log_bytes, 'worker log cap exceeded'
                    output.write(part)  # I/O failures follow this same cleanup path.
                if time.monotonic() >= next_reap:
                    result['reapedDuringRun'] += reap_adopted_zombies(child.pid)
                    next_reap = time.monotonic() + 1
                if child.poll() is not None:
                    # Drain bytes already in the pipe without waiting for a
                    # detached descendant that inherited the write descriptor.
                    while True:
                        try:
                            part = os.read(child.stdout.fileno(), 65536)
                        except BlockingIOError:
                            break
                        if not part:
                            break
                        size += len(part)
                        assert size <= max_log_bytes, 'worker log cap exceeded'
                        output.write(part)
                    break
            os.fsync(output.fileno())
            result['exitCode'] = child.poll()
            assert result['exitCode'] is not None, 'worker exit was not observed'
            assert result['exitCode'] == 0, 'owned worker failed'
    except BaseException as error:
        result['faults'].append(str(error))
    finally:
        selector.close()
        if child and child.poll() is None:
            result['faults'].append('worker had not exited before forced cleanup')
        cleanup = sweep_owned(time.monotonic() + 15)
        result['cleanup'] = cleanup
        # Successful producers must close their own browsers/servers. Forced
        # removal of a live descendant is useful cleanup, never a passing run.
        if any(row['state'] != 'Z' for row in cleanup['captured']):
            result['faults'].append('producer left live descendants')
        result['complete'] = result['exitCode'] == 0 and cleanup['complete'] and not result['faults']
        with (directory / 'supervisor.json').open('x') as output:
            json.dump(result, output, indent=2)
            output.flush()
            os.fsync(output.fileno())
    return result


if __name__ == '__main__':
    assert len(sys.argv) >= 5 and sys.argv[3] == '--'
    result = supervise(sys.argv[4:], sys.argv[1], float(sys.argv[2]))
    sys.exit(0 if result['complete'] else 1)
