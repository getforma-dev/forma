import importlib.util
import contextlib
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location('mirror_policy', Path(__file__).with_name('prefer-ubuntu-archive.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

SOURCES = '''# Ubuntu's signed noble archive
Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
'''


class MirrorPreferenceTests(unittest.TestCase):
    def test_known_mirrors_change_only_two_priority_digits(self):
        actual = policy.preferred_mirrors(policy.ORIGINAL)
        self.assertEqual(len(actual), len(policy.ORIGINAL))
        changes = [(a, b) for a, b in zip(policy.ORIGINAL, actual) if a != b]
        self.assertEqual(changes, [('1', '2'), ('2', '1')])
        self.assertEqual(actual.splitlines()[-1], policy.ORIGINAL.splitlines()[-1])

    def test_idempotent(self):
        self.assertEqual(policy.preferred_mirrors(policy.PREFERRED), policy.PREFERRED)

    def test_unexpected_mirror_lists_are_rejected(self):
        for text in ['', policy.ORIGINAL * 2, policy.ORIGINAL.replace('priority:1', 'priority:9'),
                     policy.ORIGINAL.replace('https://archive.ubuntu.com', 'https://other.example'),
                     policy.ORIGINAL.replace('priority:3', 'priority:2'),
                     policy.ORIGINAL.replace('https://security.ubuntu.com/ubuntu/\tpriority:3\n', '')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                policy.preferred_mirrors(text)

    def test_fixture_write_preserves_sources_and_only_queries_public_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            mirrors, sources = Path(directory) / 'mirrors', Path(directory) / 'sources'
            mirrors.write_text(policy.ORIGINAL)
            sources.write_text(SOURCES)
            calls = []

            def run(args, **options):
                calls.append(args)
                if args[0] == 'apt-config':
                    self.assertEqual(args, ['apt-config', 'shell', 'APT_RETRIES', 'Acquire::Retries',
                        'APT_HTTP_TIMEOUT', 'Acquire::http::Timeout', 'APT_HTTPS_TIMEOUT', 'Acquire::https::Timeout'])
                    return SimpleNamespace(stdout="APT_RETRIES='1'\nAPT_HTTP_TIMEOUT='15'\nAPT_HTTPS_TIMEOUT='15'\n")
                self.assertEqual(args, ['sudo', 'tee', str(mirrors)])
                mirrors.write_text(options['input'])
                return SimpleNamespace(returncode=0)

            with contextlib.redirect_stdout(io.StringIO()):
                policy.configure(mirrors, sources, run)
                policy.configure(mirrors, sources, run)
            self.assertEqual(mirrors.read_text(), policy.PREFERRED)
            self.assertEqual(sources.read_bytes(), SOURCES.encode())
            self.assertEqual(sum(args[0] == 'sudo' for args in calls), 1)

    def test_unexpected_fixture_configuration_does_not_write(self):
        for bad_mirrors, bad_sources in [(policy.ORIGINAL + '# unexpected\n', SOURCES),
                                        (policy.ORIGINAL, SOURCES + 'Trusted: yes\n')]:
            with self.subTest(bad_mirrors=bad_mirrors), tempfile.TemporaryDirectory() as directory:
                mirrors, sources = Path(directory) / 'mirrors', Path(directory) / 'sources'
                mirrors.write_text(bad_mirrors)
                sources.write_text(bad_sources)
                def forbidden_run(*args, **kwargs):
                    self.fail('unexpected configuration must fail before any subprocess/write')
                with self.assertRaises(ValueError):
                    policy.configure(mirrors, sources, forbidden_run)
                self.assertEqual(mirrors.read_text(), bad_mirrors)
                self.assertEqual(sources.read_text(), bad_sources)

    def test_unexpected_source_or_trust_policy_is_rejected(self):
        for text in ['', SOURCES.replace('noble-security', 'jammy-security'),
                     SOURCES.replace('ubuntu-archive-keyring.gpg', 'other-key.gpg'),
                     SOURCES.replace('mirror+file:/etc/apt/apt-mirrors.txt', 'http://other.example/'),
                     SOURCES + 'Trusted: yes\n', SOURCES.replace('Types: deb', 'Types: deb\nTypes: deb')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                policy.validate_sources(text)

    def test_only_github_hosted_ubuntu24_x64_is_supported(self):
        supported = ['ID=ubuntu\nVERSION_ID="24.04"\n', 'github-hosted', 'Linux', 'x86_64', 'true']
        policy.validate_host(*supported)
        for index, value in [(0, 'ID=ubuntu\nVERSION_ID="26.04"\n'), (1, 'self-hosted'),
                             (2, 'Windows'), (3, 'aarch64'), (4, None)]:
            wrong = supported[:]
            wrong[index] = value
            with self.subTest(index=index), self.assertRaises(ValueError):
                policy.validate_host(*wrong)


if __name__ == '__main__':
    unittest.main()
