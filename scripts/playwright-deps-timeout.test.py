#!/usr/bin/env python3
"""Linux control for the workflow's privileged timeout; never touches apt/dpkg."""
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import unittest


@unittest.skipUnless(sys.platform == 'linux', 'privileged process control runs in Linux CI')
class PrivilegedTimeout(unittest.TestCase):
    def test_root_timeout_releases_a_privileged_descendants_lock(self):
        repo = Path(__file__).resolve().parents[1]
        prefixes = []
        for workflow in ['ci.yml', 'e2e-engines.yml']:
            text = (repo / '.github/workflows' / workflow).read_text()
            match = re.search(r'if (.+?) env "PATH=\$PATH"', text)
            self.assertIsNotNone(match, workflow)
            prefix = shlex.split(match[1])
            self.assertEqual(prefix, ['sudo', 'timeout', '--kill-after=20s', '4m'])
            prefixes.append(prefix)
        self.assertEqual(prefixes[0], prefixes[1])
        self.assertNotEqual(os.getuid(), 0, 'run as the hosted runner user')

        with tempfile.TemporaryDirectory(prefix='forma-deps-timeout-') as folder:
            root = Path(folder)
            fixture = root / 'holder.py'
            fixture.write_text('''import fcntl,json,os,pathlib,signal,sys,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child=os.fork()
if child == 0:
    with open(sys.argv[1], 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ready=pathlib.Path(sys.argv[2])
        pending=ready.with_suffix('.tmp')
        pending.write_text(json.dumps({'pid':os.getpid(),'group':os.getpgrp(),'uid':os.getuid()}))
        pending.replace(ready)
        while True: time.sleep(1)
else:
    os.waitpid(child, 0)
''')
            lock, ready = root / 'fixture.lock', root / 'ready.json'
            # Execute the workflows' supervisor placement with short test-only
            # durations. Parent and child ignore TERM to exercise escalation.
            command = prefixes[0][:]
            command[2:] = ['--kill-after=0.3s', '5s']
            command.insert(1, '-n')
            process = subprocess.Popen(command + [sys.executable, str(fixture), str(lock), str(ready)])
            details = None
            try:
                deadline = time.monotonic() + 4
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue(ready.exists(), 'root fixture did not start before the deadline')
                details = json.loads(ready.read_text())
                self.assertEqual(details['uid'], 0)
                # Negative control: the runner really cannot signal this root
                # descendant, which is why runner-owned timeout was inadequate.
                with self.assertRaises(PermissionError):
                    os.kill(details['pid'], signal.SIGTERM)
                with lock.open('rb') as handle:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self.assertEqual(process.wait(timeout=8), 137)
                    # Kernel advisory locks disappear only after the holder
                    # closes/exits; this cannot pass merely because Node exited.
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                if details:
                    # Only the isolated fixture's group; no apt processes or
                    # system locks are inspected or signalled by this control.
                    subprocess.run(['sudo', '-n', 'kill', '-KILL', '--', f"-{details['group']}"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
