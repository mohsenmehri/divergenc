"""Reproducible deployment ZIP; explicit allowlist excludes real DBs/credentials."""
from pathlib import Path
import hashlib
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
files=[*root.glob('server/*.py'),*root.glob('server/windows/*.ps1'),*root.glob('server/windows/*.psm1'),*root.glob('server/windows/*.py'),*root.glob('server/tests/*.py'),root/'server/windows/dependencies.json',root/'INSTALL-FAM.cmd',root/'server/requirements.txt',root/'server/www/FAM.html',root/'server/www/web.config',root/'docs/SHARED_IIS_FA.md',root/'docs/SHARED_TEST_REPORT.md',root/'docs/AUTO_INSTALL_FAM_FA.md',root/'docs/AUTO_INSTALL_TEST_REPORT.md']
entries={p.relative_to(root).as_posix():p.read_bytes() for p in files}
entries['START_HERE.txt']=('فام مرکزی — نصب خودکار سرور 10.16.243.18\n\nآدرس موردنظر کاربران: https://ertebatat-fam\n\n۱. کل ZIP را روی خود سرور استخراج کنید.\n۲. INSTALL-FAM.cmd را اجرا و Administrator/UAC را تأیید کنید.\n۳. گواهی مناسب موجود استفاده می‌شود؛ ساخت گواهی جدید یا تغییر سایت قبلی فقط با تأیید شماست.\n۴. تا اعلام موفقیت واقعی HTTPS/API، نصب کامل محسوب نمی‌شود.\n\nراهنمای کامل/آفلاین/گواهی کاربران: docs/AUTO_INSTALL_FAM_FA.md\nگزارش دقیق آزمون‌ها: docs/AUTO_INSTALL_TEST_REPORT.md\nWindows/IIS واقعی و پنج کامپیوتر فیزیکی هنوز در این محیط آزمایش نشده‌اند.\n\nپیش‌نیازهای Microsoft/Python داخل این ZIP نیستند؛ اینترنت سرور یا آماده‌سازی آفلاین لازم است.\nداده‌ها و حساب‌های موجود حذف/بازنشانی نمی‌شوند؛ فقط دادهٔ نصب شناخته‌شدهٔ سرور حفظ می‌شود، نه انتقال خودکار مرورگر محلی.\nاین بسته دادهٔ واقعی، رمز صادراتی، کلید خصوصی یا دیتابیس آماده ندارد.\nریشهٔ عمومی IIS فقط server/www است. پوشهٔ FAMData را Share نکنید.\n\nSource: https://github.com/mohsenmehri/divergenc/tree/arena/a50077cc-divergenc\n').encode('utf8')
entries['SHA256SUMS.txt']=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(entries.items())).encode()
output=root/'releases/FAM-Central-IIS.zip';output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(entries.items()):
        info=ZipInfo(name,(2026,10,11,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,data,compresslevel=9)
print(output.relative_to(root),output.stat().st_size,'bytes',hashlib.sha256(output.read_bytes()).hexdigest())
