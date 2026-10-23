"""Package the v2 LOCAL workspace for visual/offline review. No SSH or fake scan."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'FAM.html').read_bytes()
name='FAM-Equipment-V2-LOCAL-Preview.html'
(ROOT/'releases'/name).write_bytes(html)
readme='''مرکز تجهیزات FAM — طراحی دوم

فایل HTML را باز کنید. حساب اولیهٔ نسخهٔ محلی: admin با رمز 1109 (فقط حساب برنامهٔ محلی، نه رمز تجهیز).
این نسخه برای بازبینی ظاهر، ثبت مشخصات و ابزارهای آفلاین است. هیچ اتصال SSH یا نتیجهٔ ساختگی پورت ندارد.
برای اتصال واقعی از نسخهٔ SERVER استفاده کنید. رمز واقعی تجهیزات را در فایل محلی وارد نکنید.
اطلاعات قبلی مرورگر پاک نمی‌شود؛ پیش از جایگزینی نسخهٔ کاری از داده‌ها خروجی و بکاپ مستقل بگیرید.
'''.encode()
out=ROOT/'releases/FAM-Equipment-V2-LOCAL-Preview.zip'
with ZipFile(out,'w',ZIP_DEFLATED,compresslevel=9) as z:
 for path,data in [(name,html),('README_FA.txt',readme)]:
  i=ZipInfo(path,(2026,10,17,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,data)
print(out.relative_to(ROOT),out.stat().st_size,hashlib.sha256(out.read_bytes()).hexdigest())
