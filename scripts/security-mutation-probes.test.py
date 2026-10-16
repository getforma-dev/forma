import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('probes', Path(__file__).with_name('security-mutation-probes.py'))
probes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probes)


class QualificationControls(unittest.TestCase):
    def test_only_the_named_executed_assertion_kills_a_mutant(self):
        name = 'walker::tests::example'
        markers = ['assertion `left == right` failed']
        failed = f"running 1 test\nthread '{name}' panicked at src.rs:1\nassertion `left == right` failed\ntest {name} ... FAILED\ntest result: FAILED. 0 passed; 1 failed; 0 ignored\nerror: test failed, to rerun pass `-p forma-ir --lib`\n"
        self.assertEqual(probes.outcome(101, failed, name, markers), 'killed')
        multiline = failed.replace(f'test {name} ... FAILED', 'FAILED').replace('running 1 test\n', f'running 1 test\ntest {name} ... \n')
        self.assertEqual(probes.outcome(101, multiline, name, markers), 'killed')
        for code, text in [(0, failed), (-9, failed), (101, failed.replace(name, 'unrelated')), (101, failed.replace('running 1 test', 'running 0 tests')), (101, failed + 'error[E0308]: types differ\n'), (101, failed.replace('panicked at', 'never executed'))]:
            self.assertEqual(probes.outcome(code, text, name, markers), 'invalid')
        for reason in ['called Result::unwrap() on an Err value: setup failed', 'explicit panic', 'assertion failed: unrelated setup']:
            self.assertEqual(probes.outcome(101, failed.replace(markers[0], reason), name, markers), 'invalid')
        passed = f'running 1 test\ntest {name} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored\n'
        self.assertEqual(probes.outcome(0, passed, name, markers), 'pass')
        self.assertEqual(probes.outcome(101, passed, name, markers), 'invalid')

    def test_every_mutation_changes_exactly_its_current_production_body(self):
        for probe in probes.PROBES:
            source = (probes.ROOT / probe['path']).read_text()
            changed = probes.mutate(source, probe)
            self.assertNotEqual(changed, source)
            self.assertEqual(changed.count(probe['new']), source.count(probe['new']) + 1)
            with self.assertRaises((ValueError, IndexError)):
                probes.mutate(changed, probe)


if __name__ == '__main__':
    unittest.main()
