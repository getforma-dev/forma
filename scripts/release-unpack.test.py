#!/usr/bin/env python3
import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('unpack',pathlib.Path(__file__).with_name('release-unpack.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Archives(unittest.TestCase):
    def test_regular_and_caps(self):
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root);archive=root/'test.zip'
            with zipfile.ZipFile(archive,'w') as out:out.writestr('nested/actual.json',b'123')
            module.unpack('zip',archive,root/'good',3)
            self.assertEqual((root/'good/nested/actual.json').read_bytes(),b'123')
            with self.assertRaises(AssertionError):module.unpack('zip',archive,root/'small',2)
            with self.assertRaises(FileExistsError):module.unpack('zip',archive,root/'good',3)
    def test_traversal_link_and_duplicates_refuse(self):
        for name in ['../escape','/absolute','C:/drive','x\\y']:
            with tempfile.TemporaryDirectory() as root:
                root=pathlib.Path(root);archive=root/'test.zip'
                with zipfile.ZipFile(archive,'w') as out:out.writestr(name,b'x')
                with self.assertRaises(AssertionError):module.unpack('zip',archive,root/'out',10)
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root);archive=root/'test.tar.gz'
            with tarfile.open(archive,'w:gz') as out:
                member=tarfile.TarInfo('package/link');member.type=tarfile.SYMTYPE;member.linkname='/tmp/outside';out.addfile(member)
            with self.assertRaises(AssertionError):module.unpack('tar',archive,root/'out',100)
    def test_tar_original_bytes_and_executable_mode(self):
        with tempfile.TemporaryDirectory() as root:
            root=pathlib.Path(root);archive=root/'test.tar.gz'
            with tarfile.open(archive,'w:gz') as out:
                member=tarfile.TarInfo('package/bin');member.size=3;member.mode=0o755;out.addfile(member,io.BytesIO(b'abc'))
            module.unpack('tar',archive,root/'out',3)
            self.assertEqual((root/'out/package/bin').read_bytes(),b'abc')
            self.assertTrue((root/'out/package/bin').stat().st_mode&0o100)

if __name__=='__main__':unittest.main()
