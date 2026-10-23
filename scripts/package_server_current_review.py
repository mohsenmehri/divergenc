"""Current SERVER source review, emphasizing Python device SSH operations."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'releases/FAM-SERVER-Current-Python-Review.zip'
STAMP = (2026, 10, 17, 0, 0, 0)
TRACKED = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
REVISION = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
PREFIXES = ('server/', 'src/', 'patches/fam-custom-access-server/', 'tests/helpers/')
EXACT = {'FAM.html', 'package.json', 'package-lock.json', 'INSTALL-FAM.cmd',
         'PREPARE-OFFLINE.cmd', 'assets/fam-1-glass.png',
         'releases/FAM-Custom-Access-SERVER-Patch.zip',
         'releases/FAM-Custom-Access-SERVER-Patch.zip.sha256',
         'scripts/build_shared.py', 'scripts/package_custom_access_updates.py',
         'scripts/package_shared.py', 'scripts/fetch_offline_wheels.py',
         'scripts/package_server_current_review.py',
         'docs/EQUIPMENT_MANAGEMENT_FA.md', 'docs/EQUIPMENT_OPENSSH_TEST_REPORT.md',
         'docs/EQUIPMENT_SERVER_RELEASE.md', 'docs/EQUIPMENT_V2_REDESIGN.md',
         'docs/SECURITY_NOTES.md', 'docs/PRIVATE_APPLICATION_BOUNDARY_FA.md',
         'docs/SHARED_IIS_FA.md', 'docs/AUTO_INSTALL_FAM_FA.md',
         'docs/OFFLINE_SERVER_2019_FA.md', 'docs/PRIMARY_SERVER_CLIENT_QUICK_DEPLOY_FA.md'}
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
    return name in EXACT or name.startswith(PREFIXES) or (name.startswith('tests/') and name.endswith('.test.cjs'))


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
for name in ['docs/CURRENT_SERVER_PYTHON_REVIEW_PROMPT_FA.md', 'docs/CURRENT_SERVER_REVIEW_README_FA.md',
             'scripts/package_server_current_review.py']:
    entries[name] = (ROOT / name).read_bytes()
entries['REVIEW_PROMPT_FA.md'] = entries['docs/CURRENT_SERVER_PYTHON_REVIEW_PROMPT_FA.md']
entries['README_REVIEW_FA.md'] = entries['docs/CURRENT_SERVER_REVIEW_README_FA.md']
entries['SOURCE_REVISION.txt'] = (
    'Repository: mohsenmehri/divergenc\nSource base revision: ' + REVISION +
    '\nSnapshot date: 2026-10-17\nPurpose: current SERVER review, Python equipment SSH first.'\
    '\nDeployment files were not retrieved from the running server; installation parity is unverified.'
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
