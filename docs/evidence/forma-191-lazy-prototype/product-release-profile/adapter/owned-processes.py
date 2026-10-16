#!/usr/bin/env python3
"""macOS-only, bounded shutdown-time ownership checks; no measurement polling.

Layout/constants are from this Mac's SDK sys/proc_info.h, sys/proc.h, libproc.h.
libproc interfaces are platform-specific; unexpected sizes/results fail closed.
"""
import ctypes as C
import errno
import json
import os
import signal
import sys
import time

assert sys.platform == 'darwin', 'owned process proof requires macOS'
lib = C.CDLL('/usr/lib/libproc.dylib', use_errno=True)
class Bsd(C.Structure):
    _fields_ = [(key, C.c_uint32) for key in (
        'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid', 'ruid', 'rgid',
        'svuid', 'svgid', 'reserved')] + [('comm', C.c_char * 16), ('name', C.c_char * 32)] + [
        (key, C.c_uint32) for key in ('nfiles', 'pgid', 'jobc', 'tdev', 'tpgid')
    ] + [('nice', C.c_int32), ('startSec', C.c_uint64), ('startUsec', C.c_uint64)]
assert C.sizeof(Bsd) == 136, 'unexpected proc_bsdinfo layout'
lib.proc_pidinfo.argtypes = [C.c_int, C.c_int, C.c_uint64, C.c_void_p, C.c_int]
lib.proc_pidinfo.restype = C.c_int
lib.proc_listpids.argtypes = [C.c_uint32, C.c_uint32, C.c_void_p, C.c_int]
lib.proc_listpids.restype = C.c_int

def info(pid):
    value = Bsd()
    C.set_errno(0)
    count = lib.proc_pidinfo(pid, 3, 0, C.byref(value), C.sizeof(value))
    if count == 0 and C.get_errno() in (0, errno.ESRCH, errno.ENOENT):
        return None
    assert count == C.sizeof(value), f'cannot read process identity {pid}: {count}/{C.get_errno()}'
    assert value.pid == pid and value.startSec > 0
    return {key: int(getattr(value, key)) for key in ('pid', 'ppid', 'pgid', 'status', 'startSec', 'startUsec')}

def same(a, b):
    return b is not None and all(a[k] == b[k] for k in ('pid', 'startSec', 'startUsec'))

def checked(identity, allow_dead=False):
    current = info(identity['pid'])
    if current is None and allow_dead:
        return None
    assert same(identity, current), f'process identity changed/unavailable: {identity["pid"]}'
    return current

def send(identity, sig):
    current = checked(identity, allow_dead=True)
    if current is None or current['status'] == 5:
        return
    # No process-group signals: each individual PID has just been revalidated.
    try:
        os.kill(identity['pid'], sig)
    except ProcessLookupError:
        pass

def children(identity):
    checked(identity)
    buffer = (C.c_int * 4096)()
    C.set_errno(0)
    count = lib.proc_listpids(6, identity['pid'], buffer, C.sizeof(buffer))
    assert 0 <= count < C.sizeof(buffer) and count % C.sizeof(C.c_int) == 0, 'child inventory failed/exceeded bound'
    assert count != 0 or C.get_errno() == 0, 'child inventory unavailable'
    result = []
    for pid in buffer[:count // C.sizeof(C.c_int)]:
        if not pid:
            continue
        value = info(pid)
        assert value is not None and value['ppid'] == identity['pid'], 'child disappeared/reparented during capture'
        result.append(value)
    return result

def freeze(identity):
    send(identity, signal.SIGSTOP)
    for _ in range(100):
        current = checked(identity)
        if current['status'] in (4, 5):
            return
        time.sleep(.001)
    raise RuntimeError(f'process did not stop: {identity["pid"]}')

def shutdown(root, stop_root):
    owned = []
    proof = {'complete': False, 'root': root, 'captured': owned, 'stopRoot': stop_root}
    try:
        checked(root)
        pending = [root]
        while pending:
            identity = pending.pop(0)
            assert len(owned) < 4096, 'descendant count exceeded bound'
            owned.append(identity)
            freeze(identity)
            pending.extend(children(identity))
        victims = owned if stop_root else owned[1:]
        for identity in reversed(victims):
            send(identity, signal.SIGKILL)
        # Permit the supervised root to reap its children and complete its IPC handshake.
        if not stop_root:
            send(root, signal.SIGCONT)
        for _ in range(100):
            remaining = []
            for identity in victims:
                current = info(identity['pid'])
                # A reused PID is never signalled; it is not the original owned process.
                if same(identity, current) and current['status'] != 5:
                    remaining.append(identity['pid'])
            if not remaining:
                proof['complete'] = True
                proof['remainingOwnedPids'] = []
                return proof
            time.sleep(.01)
        raise RuntimeError(f'owned processes still executing: {remaining}')
    except Exception as error:
        proof['error'] = str(error)
        # Best effort only for identities already captured. Never signal a new identity.
        for identity in reversed(owned):
            try:
                send(identity, signal.SIGKILL if stop_root or identity != root else signal.SIGCONT)
            except Exception:
                pass
        return proof

try:
    if sys.argv[1] == 'identity':
        result = info(int(sys.argv[2]))
        assert result is not None, 'supervised worker identity unavailable'
    else:
        assert sys.argv[1] == 'shutdown'
        result = shutdown(json.loads(sys.argv[2]), sys.argv[3] == 'stop-root')
    print(json.dumps(result), flush=True)
except Exception as error:
    print(json.dumps({'complete': False, 'error': str(error)}), flush=True)
    sys.exit(1)
