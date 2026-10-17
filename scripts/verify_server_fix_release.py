"""Verify shipped SERVER bytes and execute acceptance tests from an isolated install.

No production DB or real SSH: the copied tests use disposable fixtures/mocks.
Does not execute the Windows installer; run on the repository's Python environment.
"""
from pathlib import Path, PurePosixPath
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'releases/FAM-Custom-Access-SERVER-Patch.zip'
PYTHON = sys.executable
WINDOWS = {'start.ps1', 'preflight_backup.py', 'install.ps1', 'setup-ertebatat.ps1',
           'setup-common.psm1', 'backup-daily.ps1', 'verify_deployment.py'}
WEB = {'login.html', 'login.css', 'login.js', 'web.config'}


def main():
    expected = RELEASE.with_suffix('.zip.sha256').read_text().split()[0]
    assert hashlib.sha256(RELEASE.read_bytes()).hexdigest() == expected
    with tempfile.TemporaryDirectory(prefix='fam-extracted-release-') as temp:
        base = Path(temp)
        server = base / 'server'
        with ZipFile(RELEASE) as archive:
            names = archive.namelist()
            assert len(names) == len(set(names))
            for name in names:
                path = PurePosixPath(name)
                assert not path.is_absolute() and '..' not in path.parts
            manifest = dict((name, digest) for digest, name in
                            (line.split('  ', 1) for line in archive.read('payload/SHA256SUMS.txt').decode().splitlines()))
            assert len(manifest) == 20
            assert {n for n in names if n.startswith('payload/')} == {'payload/SHA256SUMS.txt', *('payload/' + n for n in manifest)}
            for name, digest in manifest.items():
                data = archive.read('payload/' + name)
                assert hashlib.sha256(data).hexdigest() == digest
                directory = server / ('windows' if name in WINDOWS else 'www' if name in WEB else 'private_ui' if name == 'FAM.html' else '')
                directory.mkdir(parents=True, exist_ok=True)
                (directory / name).write_bytes(data)
                source = ROOT / 'server' / directory.relative_to(server) / name
                assert data == source.read_bytes(), name
            assert archive.read('README_FA.txt') == (ROOT / 'docs/SERVER_REVIEW_FIX_PATCH_FA.md').read_bytes()
        tests = server / 'tests'
        tests.mkdir()
        # These are the repository's test harness, NOT replacements for payload code.
        modules = ['test_api', 'test_equipment_inventory', 'test_equipment_ops', 'test_review_fixes']
        for module in modules + ['test_equipment_probe']:
            shutil.copy2(ROOT / 'server/tests' / (module + '.py'), tests)
        env = dict(os.environ)
        env.pop('FAM_INITIAL_PASSWORD', None)
        env['PYTHONPATH'] = str(base)
        subprocess.run([PYTHON, '-m', 'unittest', *('server.tests.' + n for n in modules), '-v'],
                       cwd=base, env=env, check=True, timeout=90)
    print('PASS: ZIP hash, 20 shipped files, source parity, Persian guide parity and isolated extracted-runtime acceptance. No real SSH.')


if __name__ == '__main__':
    main()
