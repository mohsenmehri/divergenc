"""Build reproducible offline/reference and central IIS custom-access ZIPs."""
from pathlib import Path
import hashlib
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
STAMP=(2026,10,13,0,0,0)

def add_archive(source:Path,output:Path):
    files=sorted(path for path in source.rglob('*') if path.is_file())
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as archive:
        for path in files:
            info=ZipInfo(path.relative_to(source).as_posix(),STAMP)
            info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            archive.writestr(info,path.read_bytes(),compress_type=ZIP_DEFLATED,compresslevel=9)
    print(output.relative_to(ROOT),output.stat().st_size,'bytes',hashlib.sha256(output.read_bytes()).hexdigest())

# The two patches are releases of tracked source, not independently maintained
# forks. Synchronise first, then write the manifest the Windows updater checks.
server=ROOT/'patches'/'fam-custom-access-server'
payload=server/'payload';payload.mkdir(parents=True,exist_ok=True)
for source,name in ((ROOT/'server'/'app.py','app.py'),(ROOT/'server'/'www'/'FAM.html','FAM.html'),(ROOT/'server'/'www'/'web.config','web.config')):
    (payload/name).write_bytes(source.read_bytes())
expected=''.join(f'{hashlib.sha256((payload/name).read_bytes()).hexdigest()}  {name}\n' for name in ('app.py','FAM.html','web.config'))
(payload/'SHA256SUMS.txt').write_text(expected,encoding='utf8')
local=ROOT/'patches'/'fam-custom-access-local'
local.mkdir(parents=True,exist_ok=True)
(local/'FAM.html').write_bytes((ROOT/'FAM.html').read_bytes())
local_expected=hashlib.sha256((local/'FAM.html').read_bytes()).hexdigest()+'  FAM.html\n'
(local/'SHA256SUMS.txt').write_text(local_expected,encoding='utf8')
add_archive(local,ROOT/'releases'/'FAM-Custom-Access-LOCAL-Patch.zip')
add_archive(server,ROOT/'releases'/'FAM-Custom-Access-SERVER-Patch.zip')
