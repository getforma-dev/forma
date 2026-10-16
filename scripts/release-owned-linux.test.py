#!/usr/bin/env python3
"""Actual Linux process controls; no browser, timeout retries, or workload credit."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('owned', pathlib.Path(__file__).with_name('release-owned-linux.py'))
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)

@unittest.skipUnless(sys.platform == 'linux', 'actual Linux subreaper controls run in Linux CI')
class Ownership(unittest.TestCase):
    def launch(self, code, timeout=3, cap=16384):
        with tempfile.TemporaryDirectory() as root:
            result = owned.supervise([sys.executable, '-c', code], pathlib.Path(root)/'attempt', timeout, cap)
            self.assertEqual(json.loads((pathlib.Path(root)/'attempt/supervisor.json').read_text()), result)
            return result
    def test_normal(self):
        self.assertTrue(self.launch('print("actual child")')['complete'])
    def test_complete_buffered_tail_is_retained(self):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)/'attempt'
            result = owned.supervise([sys.executable, '-c', 'import os;os.write(1,b"a"*65536+b"FINAL-TAIL")'], directory, 3)
            self.assertTrue(result['complete'])
            self.assertEqual((directory/'worker.log').read_bytes(), b'a'*65536+b'FINAL-TAIL')
    def test_closed_stdout_still_observes_cancellation(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            marker = root/'ready'
            code = f'import os,pathlib,time;os.close(1);os.close(2);pathlib.Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(30)'
            supervisor = subprocess.Popen([sys.executable, owned.__file__, str(root/'attempt'), '30', '--', sys.executable, '-c', code])
            try:
                deadline = time.monotonic()+3
                while not marker.exists():
                    self.assertLess(time.monotonic(),deadline)
                    time.sleep(.01)
                supervisor.terminate()
                self.assertEqual(supervisor.wait(timeout=5), 1)
                result=json.loads((root/'attempt/supervisor.json').read_text())
                self.assertFalse(result['complete']);self.assertTrue(result['cleanup']['complete'])
                self.assertEqual(result['cleanup']['remainingOwnedPids'], [])
                self.assertTrue(any('interruption' in fault for fault in result['faults']))
            finally:
                if supervisor.poll() is None:
                    supervisor.kill();supervisor.wait(timeout=5)
    def test_detached_grandchild_survives_intermediate_exit(self):
        # The intermediate exits before cleanup. Subreaping retains the leaf,
        # unlike a process-group-only sweep or a later worker ancestry lookup.
        intermediate = 'import subprocess,sys;subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)'
        result = self.launch(f'import subprocess,sys;subprocess.run([sys.executable,"-c",{intermediate!r}],check=True)')
        self.assertFalse(result['complete']);self.assertTrue(result['cleanup']['complete']);self.assertGreater(len(result['cleanup']['captured']),0)
        self.assertEqual(result['cleanup']['remainingOwnedPids'],[])
    def test_timeout(self):
        result=self.launch('import time;time.sleep(30)',timeout=.1)
        self.assertFalse(result['complete']);self.assertTrue(result['cleanup']['complete'])
    def test_log_failure_and_unrelated_process(self):
        unrelated=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
        # Supervise in another process: the negative control is not its child.
        try:
            with tempfile.TemporaryDirectory() as root:
                code=f'import importlib.util;s=importlib.util.spec_from_file_location("x",{owned.__file__!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m);r=m.supervise([{sys.executable!r},"-c","print(\\\"x\\\"*10000)"],{str(pathlib.Path(root)/"attempt")!r},3,10);assert not r["complete"] and r["cleanup"]["complete"]'
                subprocess.run([sys.executable,'-c',code],check=True,timeout=10)
                self.assertIsNone(unrelated.poll())
        finally:
            unrelated.terminate();unrelated.wait(timeout=5)

if __name__ == '__main__': unittest.main()
