"""Reproducible deployment ZIP; explicit allowlist excludes real DBs/credentials."""
from pathlib import Path
import hashlib
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
files=[*root.glob('server/*.py'),*root.glob('server/windows/*.ps1'),*root.glob('server/tests/*.py'),root/'server/requirements.txt',root/'server/www/FAM.html',root/'server/www/web.config',root/'docs/SHARED_IIS_FA.md',root/'docs/SHARED_TEST_REPORT.md']
entries={p.relative_to(root).as_posix():p.read_bytes() for p in files}
entries['START_HERE.txt']=('فام مرکزی — نسخهٔ آزمایشی پنج‌کاربره\n\nراهنمای نصب: docs/SHARED_IIS_FA.md\nریشهٔ عمومی IIS فقط server/www است.\nفقط HTML را جایگزین نکنید؛ سرویس Python و ARR نیز باید نصب شوند.\nاین بسته هیچ دادهٔ واقعی یا دیتابیس آماده ندارد.\nپیش از دسترسی عمومی، رمز اولیهٔ مدیر را تغییر دهید.\nWindows/IIS واقعی هنوز باید طبق چک‌لیست راهنما آزمایش شود.\n\nSource: https://github.com/mohsenmehri/divergenc/tree/arena/a50077cc-divergenc\n').encode('utf8')
entries['SHA256SUMS.txt']=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(entries.items())).encode()
output=root/'releases/FAM-Central-IIS.zip';output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(entries.items()):
        info=ZipInfo(name,(2026,10,11,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,data,compresslevel=9)
print(output.relative_to(root),output.stat().st_size,'bytes',hashlib.sha256(output.read_bytes()).hexdigest())
