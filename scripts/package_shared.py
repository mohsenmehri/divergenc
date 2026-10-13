"""Reproducible deployment ZIP; explicit allowlist excludes real DBs/credentials."""
from pathlib import Path
import hashlib
import json
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
files=[*root.glob('server/*.py'),*root.glob('server/windows/*.ps1'),*root.glob('server/windows/*.psm1'),*root.glob('server/windows/*.py'),*root.glob('server/tests/*.py'),root/'server/windows/dependencies.json',root/'server/windows/offline-wheels.json',root/'INSTALL-FAM.cmd',root/'PREPARE-OFFLINE.cmd',root/'server/requirements.txt',root/'server/www/FAM.html',root/'server/www/web.config',root/'docs/SHARED_IIS_FA.md',root/'docs/SHARED_TEST_REPORT.md',root/'docs/AUTO_INSTALL_FAM_FA.md',root/'docs/AUTO_INSTALL_TEST_REPORT.md',root/'docs/OFFLINE_SERVER_2019_FA.md',root/'docs/OFFLINE_UPDATE_TEST_REPORT.md',root/'docs/PRIMARY_SERVER_CLIENT_QUICK_DEPLOY_FA.md',root/'docs/HTML_THEME2_PATCH_FA.md']
entries={p.relative_to(root).as_posix():p.read_bytes() for p in files}
# Wheels are required in this release, exactly pinned by filename + SHA256.
# Installer EXE/MSIs can be added by the operator; never bundle arbitrary payload.
wheel_manifest=json.loads((root/'server/windows/offline-wheels.json').read_text())
for spec in wheel_manifest['files']:
    path=root/'server/windows/payload/wheels'/spec['file']
    if not path.is_file():raise SystemExit('Run python scripts/fetch_offline_wheels.py first: '+spec['file'])
    data=path.read_bytes()
    assert hashlib.sha256(data).hexdigest()==spec['sha256'],spec['file']
    entries[path.relative_to(root).as_posix()]=data
prerequisites=json.loads((root/'server/windows/dependencies.json').read_text())
for name in ('python','rewrite','arr'):
    spec=prerequisites[name];path=root/'server/windows/payload'/spec['file']
    if path.is_file():
        data=path.read_bytes();assert hashlib.sha256(data).hexdigest().upper()==spec['sha256'].upper(),spec['file']
        entries[path.relative_to(root).as_posix()]=data
entries['START_HERE.txt']=('فام — Windows Server 2019 آفلاین — 10.16.243.18\n\nبرای به‌روزرسانی رابط سرورِ در حال کار، docs/PRIMARY_SERVER_CLIENT_QUICK_DEPLOY_FA.md را دنبال کنید: بستهٔ تأییدشده، Physical Path واقعی IIS را پیدا و فقط FAM.html و web.config را جایگزین می‌کند؛ داده/حساب/تنظیمات دست‌نخورده می‌مانند.\n\nبرای نصب کامل آفلاین: docs/OFFLINE_SERVER_2019_FA.md\n۱. روی کامپیوتر ویندوزی اینترنت‌دار، بسته را استخراج و PREPARE-OFFLINE.cmd را اجرا کنید. Python یا Administrator لازم نیست.\n۲. پس از OFFLINE KIT READY، کل پوشهٔ استخراج‌شده را به سرور منتقل کنید؛ نه ZIP اولیه را.\n۳. روی سرور 10.16.243.18 فایل INSTALL-FAM.cmd را با تأیید Administrator اجرا کنید.\n\nتمام wheelهای لازم داخل این ZIP هستند. سه نصب‌کنندهٔ Python/Rewrite/ARR باید قبل از انتقال طبق راهنما اضافه شوند؛ آدرس رسمی و نام دقیقشان در راهنماست. در حالت پیش‌فرض روی سرور دانلود نصب‌کننده، pip اینترنتی یا Windows Update انجام نمی‌شود.\n\nآدرس کاربران: https://ertebatat-fam — DNS داخلی، Proxy/PAC bypass و اعتماد گواهی باید صحیح باشند.\nاین انتشار: مدیریت کاربران مرکزی دقیقاً با مدل دسترسی سفارشی نسخهٔ محلی همسو است: محدودهٔ دسته‌ها، محدودهٔ مناطق برای استان‌ها و مجوزهای ریزعملیاتی. سطح کاربر در رابط مدیریت نمایش داده نمی‌شود و سرور نیز هر مجوز و محدوده را مستقل از مرورگر اعمال می‌کند. مهاجرت SQLite افزایشی است؛ حساب‌های نقش‌محور قدیمی تا اولین ذخیره از ویرایشگر جدید سازگار می‌مانند. همچنین مدیریت عنوان‌های منطقی بخش در همهٔ دسته‌های غیر استانی برقرار است؛ عنوان بخش و نام واقعی شیت مستقل‌اند و حذف عنوان هرگز شیت یا داده را حذف/تغییر نام نمی‌دهد. دکمه‌های «جستجو»، «اضافه کردن داده» و «پاک کردن داده» نیز در هر دو پوسته روی یک خط افقی مشترک قرار می‌گیرند.\nآزمون واقعی Windows/IIS در این محیط اجرا نشده؛ گزارش دقیق: docs/OFFLINE_UPDATE_TEST_REPORT.md\n\nSource: https://github.com/mohsenmehri/divergenc/tree/arena/a50077cc-divergenc\n').encode('utf8')
entries['SHA256SUMS.txt']=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(entries.items())).encode()
output=root/'releases/FAM-Central-IIS.zip';output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(entries.items()):
        info=ZipInfo(name,(2026,10,11,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
        z.writestr(info,data,compresslevel=9)
print(output.relative_to(root),output.stat().st_size,'bytes',hashlib.sha256(output.read_bytes()).hexdigest())
