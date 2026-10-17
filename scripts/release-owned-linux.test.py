#!/usr/bin/env python3
"""Actual Linux process controls; no browser, timeout retries, or workload credit."""
import importlib.util
import json
import pathlib
import os
import signal
import subprocess
import sys
import tempfile
import time
import textwrap
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
            self.last_worker_log = (pathlib.Path(root)/'attempt/worker.log').read_text()
            return result
    def test_normal(self):
        self.assertTrue(self.launch('print("actual child")')['complete'])
    def test_complete_buffered_tail_is_retained(self):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)/'attempt'
            result = owned.supervise([sys.executable, '-c', 'import os;os.write(1,b"a"*65536+b"FINAL-TAIL")'], directory, 3)
            self.assertTrue(result['complete'])
            self.assertEqual((directory/'worker.log').read_bytes(), b'a'*65536+b'FINAL-TAIL')
    def test_adopted_burst_is_reaped_while_worker_is_alive(self):
        intermediate = textwrap.dedent('''
            import json,os,pathlib
            rows=[]
            for _ in range(24):
                pid=os.fork()
                if pid == 0: os._exit(0)
                stat=pathlib.Path(f'/proc/{pid}/stat').read_text()
                rows.append([pid,stat[stat.rfind(')')+2:].split()[19]])
            print(json.dumps(rows),flush=True)
        ''')
        worker = textwrap.dedent(f'''
            import json,pathlib,subprocess,sys,time
            rows=json.loads(subprocess.check_output([sys.executable,'-c',{intermediate!r}],text=True))
            def remains(row):
                try: stat=pathlib.Path(f'/proc/{{row[0]}}/stat').read_text()
                except FileNotFoundError: return False
                return stat[stat.rfind(')')+2:].split()[19] == row[1]
            deadline=time.monotonic()+3
            while any(map(remains,rows)) and time.monotonic()<deadline: time.sleep(.01)
            assert not any(map(remains,rows)), 'adopted zombies remained while worker was alive'
            print('all 24 exited children reaped before worker exit',flush=True)
        ''')
        result=self.launch(worker,timeout=6)
        self.assertTrue(result['complete'],f"{result['faults']}\n{self.last_worker_log}")
        self.assertEqual(result['exitCode'],0)
        self.assertEqual(result['reapedDuringRun'],24)
        self.assertEqual(result['cleanup']['remainingOwnedPids'],[])
    def test_reaping_preserves_waitable_main_exit_and_signal_status(self):
        # Both main and its orphan are already zombies before reaping. A live
        # waitpid(-1) would consume the Popen status and can turn failure into 0.
        self.assertEqual(owned.ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0),0)
        for ending,expected in [('sys.exit(7)',7),('os.kill(os.getpid(),signal.SIGTERM)',-signal.SIGTERM)]:
            with self.subTest(expected=expected):
                code=textwrap.dedent(f'''
                    import os,signal,sys
                    pid=os.fork()
                    if pid == 0: os._exit(0)
                    print(pid,flush=True)
                    {ending}
                ''')
                child=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.PIPE)
                orphan=None
                try:
                    os.set_blocking(child.stdout.fileno(),False)
                    deadline=time.monotonic()+3
                    line=b''
                    while b'\n' not in line:
                        self.assertLess(time.monotonic(),deadline)
                        try: line+=os.read(child.stdout.fileno(),64)
                        except BlockingIOError: pass
                        time.sleep(.01)
                    orphan=int(line)
                    while True:
                        main=owned.status(child.pid);leaf=owned.status(orphan)
                        if main and leaf and main['state']=='Z' and leaf['state']=='Z' and leaf['ppid']==os.getpid(): break
                        self.assertLess(time.monotonic(),deadline)
                        time.sleep(.01)
                    self.assertEqual(owned.reap_adopted_zombies(child.pid),1)
                    self.assertIsNone(owned.status(orphan))
                    self.assertEqual(child.wait(timeout=3),expected)
                finally:
                    if child.poll() is None: child.kill()
                    child.wait(timeout=3)
                    child.stdout.close()
                    if orphan is not None:
                        try: os.waitpid(orphan,os.WNOHANG)
                        except ChildProcessError: pass
    def test_worker_failure_codes_remain_failures(self):
        for code,expected in [('import sys;sys.exit(7)',7),('import os,signal;os.kill(os.getpid(),signal.SIGTERM)',-signal.SIGTERM)]:
            with self.subTest(expected=expected):
                result=self.launch(code)
                self.assertEqual(result['exitCode'],expected)
                self.assertFalse(result['complete'])
                self.assertIn('owned worker failed',result['faults'])
                self.assertTrue(result['cleanup']['complete'])
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
