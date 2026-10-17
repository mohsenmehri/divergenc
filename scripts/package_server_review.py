"""Source-only SERVER review snapshot: tracked allowlist, no runtime data."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'releases/FAM-SERVER-Full-Review.zip'
STAMP = (2026, 10, 17, 0, 0, 0)
TRACKED = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
REVISION = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
PREFIXES = ('server/', 'src/', 'scripts/', 'tests/', 'exports/equipment-ansible/',
            'exports/equipment-python/', 'patches/fam-custom-access-server/')
EXACT = {'FAM.html', 'package.json', 'package-lock.json', 'INSTALL-FAM.cmd',
         'PREPARE-OFFLINE.cmd', 'assets/fam-1-glass.png',
         'releases/FAM-Custom-Access-SERVER-Patch.zip',
         'releases/FAM-Custom-Access-SERVER-Patch.zip.sha256'}
DENIED_PARTS = {'.git', '.venv', 'node_modules', '__pycache__', '.cache',
                'private', 'backups', 'wheels'}
DENIED_SUFFIXES = {'.sqlite3', '.sqlite', '.db', '.db3', '.pyc', '.pfx', '.p12',
                   '.key', '.pem', '.log', '.xlsm', '.xlsx', '.exe', '.msi', '.whl'}


def safe_name(name):
    path = Path(name)
    return (not path.is_absolute() and '..' not in path.parts and
            not DENIED_PARTS.intersection(path.parts) and
            not any(part.startswith('.') for part in path.parts) and
            path.suffix.lower() not in DENIED_SUFFIXES and
            path.name.lower() not in {'settings.json', 'known_hosts', 'credentials', '.env'})


def selected(name):
    return name in EXACT or name.startswith(PREFIXES) or (name.startswith('docs/') and name.endswith('.md'))


entries = {}
for name in TRACKED:
    if not name or not selected(name):
        continue
    if not safe_name(name):
        raise ValueError('Unexpected sensitive/runtime file in source allowlist: ' + name)
    path = ROOT / name
    if path.is_symlink():
        raise ValueError('Symlinks not permitted: ' + name)
    entries[name] = path.read_bytes()

# Review instructions are new packaging-only files, explicitly included.
for name in ['docs/SERVER_REVIEW_PROMPT_FA.md', 'docs/SERVER_REVIEW_README_FA.md',
             'scripts/package_server_review.py']:
    entries[name] = (ROOT / name).read_bytes()
entries['REVIEW_PROMPT_FA.md'] = entries['docs/SERVER_REVIEW_PROMPT_FA.md']
entries['README_REVIEW_FA.md'] = entries['docs/SERVER_REVIEW_README_FA.md']
entries['SOURCE_REVISION.txt'] = (
    'Repository: mohsenmehri/divergenc\nSource base revision: ' + REVISION +
    '\nSnapshot date: 2026-10-17\nPurpose: independent review, not an offline installation kit.'
    '\nNew review instructions and packaging script are additional to the source base.\n'
).encode()
# The sole nested archive is the existing, source-only SERVER update. Inspect it too.
from io import BytesIO
with ZipFile(BytesIO(entries['releases/FAM-Custom-Access-SERVER-Patch.zip'])) as patch:
    assert patch.testzip() is None
    assert all(safe_name(name) for name in patch.namelist())
entries['SHA256SUMS.txt'] = ''.join(
    hashlib.sha256(data).hexdigest() + '  ' + name + '\n'
    for name, data in sorted(entries.items())
).encode()
OUTPUT.parent.mkdir(exist_ok=True)
with ZipFile(OUTPUT, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(entries.items()):
        assert safe_name(name), name
        info = ZipInfo(name, STAMP)
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compresslevel=9)
digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
OUTPUT.with_suffix('.zip.sha256').write_text(digest + '  ' + OUTPUT.name + '\n')
print(OUTPUT.relative_to(ROOT), len(entries), 'files,', OUTPUT.stat().st_size, 'bytes, SHA256', digest)
