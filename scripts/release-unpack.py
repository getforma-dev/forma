#!/usr/bin/env python3
"""Extract only fresh, regular archive members with explicit count/byte limits."""
import os
import pathlib
import stat
import sys
import tarfile
import zipfile


def unpack(kind, archive, destination, limit):
    target = pathlib.Path(destination)
    target.mkdir()  # Exclusive ownership; never overwrite an existing tree.
    seen, total = set(), 0
    source = zipfile.ZipFile(archive) if kind == 'zip' else tarfile.open(archive, 'r:gz')
    with source:
        members = source.infolist() if kind == 'zip' else source.getmembers()
        assert 0 < len(members) <= 16384, 'archive member bound'
        for member in members:
            name = member.filename if kind == 'zip' else member.name
            path = pathlib.PurePosixPath(name)
            assert name and not path.is_absolute() and '\\' not in name and all(p not in ('..', '') for p in path.parts)
            assert ':' not in path.parts[0] and name not in seen, 'unsafe or duplicate member'
            seen.add(name)
            directory = member.is_dir() if kind == 'zip' else member.isdir()
            mode = (member.external_attr >> 16) if kind == 'zip' else member.mode
            if kind == 'zip':
                assert stat.S_IFMT(mode) in (0, stat.S_IFDIR if directory else stat.S_IFREG), 'archive link or special member'
                size = member.file_size
            else:
                assert directory or member.isfile(), 'archive link or special member'
                size = member.size
            total += size
            assert total <= limit and size >= 0, 'archive uncompressed byte bound'
            out = target.joinpath(*path.parts)
            if directory:
                out.mkdir(parents=True, exist_ok=True)
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            reader = source.open(member) if kind == 'zip' else source.extractfile(member)
            with reader, out.open('xb') as writer:
                remaining = size
                while remaining:
                    block = reader.read(min(1024 * 1024, remaining))
                    assert block, 'short archive member'
                    writer.write(block)
                    remaining -= len(block)
                assert reader.read(1) == b'', 'oversized archive member'
            os.chmod(out, 0o755 if mode & 0o111 else 0o644)


if __name__ == '__main__':
    assert len(sys.argv) == 5 and sys.argv[1] in ('zip', 'tar')
    unpack(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
