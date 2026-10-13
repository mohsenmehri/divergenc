"""Build the checked IIS client-update ZIP without guessing the IIS web root."""
from pathlib import Path
import hashlib
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root=Path(__file__).resolve().parents[1]
source=root/'patches'/'fam-iis-verified-client-update'
payload=source/'payload'
manifest={name:hashlib.sha256((payload/name).read_bytes()).hexdigest() for name in ('FAM.html','web.config')}
expected=''.join(f'{digest}  {name}\n' for name,digest in manifest.items())
if (payload/'SHA256SUMS.txt').read_text(encoding='utf8')!=expected:
    raise SystemExit('payload/SHA256SUMS.txt does not match the payload; rebuild or inspect it first.')
files=sorted(path for path in source.rglob('*') if path.is_file())
output=root/'releases'/'FAM-IIS-Verified-UI17-Update.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as archive:
    for path in files:
        info=ZipInfo(path.relative_to(source).as_posix(),(2026,10,13,0,0,0))
        info.compress_type=ZIP_DEFLATED
        info.external_attr=0o100644 << 16
        archive.writestr(info,path.read_bytes(),compress_type=ZIP_DEFLATED,compresslevel=9)
print(output.relative_to(root),output.stat().st_size,'bytes',hashlib.sha256(output.read_bytes()).hexdigest())
