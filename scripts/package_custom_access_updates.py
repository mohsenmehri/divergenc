"""Build reproducible offline/reference and central IIS custom-access ZIPs."""
from pathlib import Path
import hashlib
import re
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
STAMP=(2026,10,18,0,0,0)
# The server patch must never carry runtime secrets, databases, keys, logs,
# a virtual environment, or the retired Netmiko/Paramiko wheels.
FORBIDDEN_SUFFIXES={'.pfx','.p12','.pem','.key','.sqlite3','.sqlite3-wal','.sqlite3-shm','.log','.whl','.pyc'}
FORBIDDEN_PARTS={'.venv','venv','private','__pycache__','wheels','node_modules','settings.json','known_hosts'}
SECRET_MARKERS=(re.compile(r'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'),re.compile(r'Transport\._preferred_ciphers'),
                re.compile(r'StrictHostKeyChecking=no\b'),re.compile(r'Ciphers=[^\s"\']*(3des-cbc|aes192-cbc|aes256-cbc)'))

def guard(source:Path,path:Path):
    relative=path.relative_to(source)
    if path.suffix.lower() in FORBIDDEN_SUFFIXES or set(relative.parts)&FORBIDDEN_PARTS:
        raise SystemExit(f'Refusing to package {relative}: forbidden artifact type')
    if path.suffix.lower() in {'.py','.ps1','.cmd','.js'}:
        text=path.read_text(encoding='utf8',errors='ignore')
        for marker in SECRET_MARKERS:
            if marker.search(text):
                raise SystemExit(f'Refusing to package {relative}: matches {marker.pattern!r}')

def add_archive(source:Path,output:Path):
    files=sorted(path for path in source.rglob('*') if path.is_file())
    for path in files:guard(source,path)
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as archive:
        for path in files:
            info=ZipInfo(path.relative_to(source).as_posix(),STAMP)
            info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            archive.writestr(info,path.read_bytes(),compress_type=ZIP_DEFLATED,compresslevel=9)
    digest=hashlib.sha256(output.read_bytes()).hexdigest()
    (output.with_suffix(output.suffix+'.sha256')).write_text(f'{digest}  {output.name}\n',encoding='utf8')
    print(output.relative_to(ROOT),output.stat().st_size,'bytes',digest)

# The two patches are releases of tracked source, not independently maintained
# forks. The central patch moves the large application client outside IIS www;
# only the small login shell remains static and the Python service authorises
# every release of the interactive UI.
server=ROOT/'patches'/'fam-custom-access-server'
payload=server/'payload';payload.mkdir(parents=True,exist_ok=True)
for stale in ('network_ops.py','network_operations.html'):
    (payload/stale).unlink(missing_ok=True)
# Direct ssh.exe mode: no bundled SSH wheels or wheel manifest.
(server/'WHEELS-SHA256SUMS.txt').unlink(missing_ok=True)
wheels=server/'wheels'
if wheels.exists():
    for stale in wheels.iterdir():stale.unlink()
    wheels.rmdir()
FILES=(
    (ROOT/'server'/'app.py','app.py'),
    (ROOT/'server'/'account_policy.py','account_policy.py'),
    (ROOT/'server'/'equipment_guard.py','equipment_guard.py'),
    (ROOT/'server'/'equipment_diagnostics.py','equipment_diagnostics.py'),
    (ROOT/'server'/'equipment_replacement.py','equipment_replacement.py'),
    (ROOT/'server'/'equipment_group.py','equipment_group.py'),
    (ROOT/'server'/'manage.py','manage.py'),
    (ROOT/'server'/'bootstrap_admin.py','bootstrap_admin.py'),
    (ROOT/'server'/'windows'/'preflight_backup.py','preflight_backup.py'),
    (ROOT/'server'/'windows'/'install.ps1','install.ps1'),
    (ROOT/'server'/'windows'/'setup-ertebatat.ps1','setup-ertebatat.ps1'),
    (ROOT/'server'/'windows'/'setup-common.psm1','setup-common.psm1'),
    (ROOT/'server'/'windows'/'backup-daily.ps1','backup-daily.ps1'),
    (ROOT/'server'/'windows'/'verify_deployment.py','verify_deployment.py'),
    (ROOT/'server'/'equipment_ops.py','equipment_ops.py'),
    (ROOT/'server'/'equipment_inventory.py','equipment_inventory.py'),
    (ROOT/'server'/'equipment_probe.py','equipment_probe.py'),
    (ROOT/'server'/'windows'/'start.ps1','start.ps1'),
    (ROOT/'server'/'private_ui'/'FAM.html','FAM.html'),
    (ROOT/'server'/'www'/'login.html','login.html'),
    (ROOT/'server'/'www'/'login.css','login.css'),
    (ROOT/'server'/'www'/'login.js','login.js'),
    (ROOT/'server'/'www'/'web.config','web.config'),
)
for source,name in FILES:
    (payload/name).write_bytes(source.read_bytes())
expected=''.join(f'{hashlib.sha256((payload/name).read_bytes()).hexdigest()}  {name}\n' for _,name in FILES)
(payload/'SHA256SUMS.txt').write_text(expected,encoding='utf8')
(server/'README_FA.txt').write_bytes((ROOT/'docs'/'SERVER_REVIEW_FIX_PATCH_FA.md').read_bytes())
(server/'CLIENT-MOVE-DIAGNOSIS-FA.txt').write_bytes((ROOT/'docs'/'CLIENT_MOVE_DIAGNOSIS_FA.md').read_bytes())
(server/'GROUP-RECOVERY-FA.txt').write_bytes((ROOT/'docs'/'GROUP_RECOVERY_FA.md').read_bytes())
(server/'CLIENT-MAC-REPLACEMENT-FA.txt').write_bytes((ROOT/'docs'/'CLIENT_MAC_REPLACEMENT_FA.md').read_bytes())
local=ROOT/'patches'/'fam-custom-access-local'
local.mkdir(parents=True,exist_ok=True)
(local/'FAM.html').write_bytes((ROOT/'FAM.html').read_bytes())
local_expected=hashlib.sha256((local/'FAM.html').read_bytes()).hexdigest()+'  FAM.html\n'
(local/'SHA256SUMS.txt').write_text(local_expected,encoding='utf8')
add_archive(local,ROOT/'releases'/'FAM-Custom-Access-LOCAL-Patch.zip')
add_archive(server,ROOT/'releases'/'FAM-Custom-Access-SERVER-Patch.zip')
