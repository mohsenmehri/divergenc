# بستهٔ کامل سورس SERVER برای بررسی مستقل

این بسته را بدون تغییر به هر سه بازبین بدهید؛ هر بار متن REVIEW_PROMPT_FA.md را با شناسهٔ A، B یا C استفاده کنید. گزارش دیگران را تا پایان بررسی مستقل نفر بعدی نفرستید. سپس گزارش‌ها را کامل و با ID یافته‌ها برگردانید تا ادعاها، شواهد، موارد تکراری و اصلاحات پیشنهادی با کد تطبیق داده شوند.

## داخل بسته

- تمام فایل‌های version-controlled پوشهٔ server/: backend پایتون، UI فعلی محافظت‌شده، www عمومی، اسکریپت‌های Windows/IIS، requirements و تست‌ها.
- سورس‌های src/، اسکریپت‌های scripts/، تست‌های tests/ و مستندات متنی docs/ (شامل فایل‌های تاریخی که لزوماً مسیر فعال SERVER نیستند)؛ فایل FAM.html در ریشه ورودی مشترک build است، نه UI عمومی قابل استقرار SERVER.
- پچ فعلی SERVER در releases/ و سورس همان پچ در patches/fam-custom-access-server/ برای بررسی updater و تطبیق payload.
- پروژهٔ مستقل Ansible در exports/equipment-ansible/ صرفاً جهت بررسی جداگانه؛ در سرویس فعلی FAM ادغام/مستقر نشده است.
- SOURCE_REVISION.txt برای نسخهٔ مرجع و SHA256SUMS.txt برای بررسی یکپارچگی محتویات. README_REVIEW_FA.md و REVIEW_PROMPT_FA.md راهنمای همین تحویل‌اند.

## مرزها و محرمانگی

این بسته **برای code review است، نه کیت نصب آفلاین آمادهٔ اجرا**. نصب‌کننده‌ها، wheelها، venv، node_modules، runtime تنظیمات، known_hosts، دیتابیس، backup، لاگ، session/token و کلید خصوصی کپی نشده‌اند. workbook اصلی XLSM، خروجی داده و screenshotها نیز در بسته نیستند. فایل‌های سورس و HTML ساخته‌شده، رشته‌های پیش‌فرض/fixture و مستندات پروژه را دارند؛ بسته anonymized نیست و ممکن است نام، دامنه یا IPهای نمونه/سازمانی داخل سورس دیده شود. آن را فقط به بازبین مورداعتماد بدهید و اطلاعات واقعی ورود یا خروجی حساس دستگاه را اضافه نکنید. مقادیر bootstrap/fixture در سورس، مدرک رمز واقعی محیط نیستند؛ خود طراحی bootstrap باید بررسی شود.

هیچ نصب، تغییر DB یا کانفیگ، تماس با تجهیزات یا اجرای installer هنگام تهیهٔ این خروجی انجام نشده است. این تحویل نسخهٔ فعال برنامه را تغییر نمی‌دهد. مرجع صحت، مسیر اجرای کد است نه ادعاهای مستندات قدیمی؛ docs شامل سابقهٔ نسخه‌ها هم هست.

## نقطهٔ شروع بررسی

1. server/app.py و server/equipment_inventory.py: احراز هویت/نشست/مجوز/محدوده، persistence و import.
2. server/equipment_ops.py: مجوز مقصد، دادهٔ transient و ticket تأیید.
3. server/equipment_probe.py: Windows OpenSSH، parser، pre-check/write/post-check و cleanup.
4. src/equipment-live-server.js، src/shared-access.js و src/shared-sync.js: رابط و API؛ سپس UI نهایی server/private_ui/FAM.html.
5. server/windows/، server/www/web.config و patches/fam-custom-access-server/: نصب، HTTPS/IIS، backup، مسیرهای عمومی و updater.
6. Ansible را با مرز اعتماد متفاوت کنترلر و افزونه‌های واقعی‌اش جدا بررسی کنید.

## تست ایزولهٔ بخش اصلی Python

ابتدا کد و وابستگی‌ها را بخوانید. فقط در محیط ایزوله و با DB موقت/SSH mock، از ریشهٔ بسته:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r server/requirements.txt
python -m unittest server.tests.test_api server.tests.test_equipment_probe server.tests.test_equipment_ops server.tests.test_equipment_inventory server.tests.test_hardening -v
```

این فرمان سرویس واقعی تجهیزات را هدف نمی‌گیرد؛ تست‌ها از Flask test client و helperهای ساختگی استفاده می‌کنند. اجرای این تست‌ها معادل تست Windows OpenSSH، RADIUS، IIS یا سخت‌افزار نیست. اسکریپت نصب و restore را برای بررسی روی سیستم واقعی اجرا نکنید.

برای JS، package.json و package-lock.json موجود است؛ محیط مرورگر/dependency لازم را جدا آماده کنید. **تمام تست‌های تاریخی مخزن با این بستهٔ بدون داده قابل اجرا نیستند**: نمونه‌ها شامل تست XLSM اصلی، پچ/previewهای قدیمی Nava، connector کنارگذاشته‌شده و کیت‌های آفلاین/باینری هستند که عمداً کپی نشده‌اند. missing artifact را به عنوان محدودیت بسته ثبت کنید، نه باگ runtime یا موفقیت تست. نصب یا اجرای وابستگی‌ها نیز باید مطابق سیاست محیط ایزولهٔ خود بازبین باشد.

تست synthetic آنسیبل علاوه بر dependencies پروژه به pexpect و collectionهای pin‌شده در مسیر موردانتظار tests/test_equipment_ansible.py نیاز دارد. آن تست actionهای SSH را جایگزین می‌کند و دلیل سازگاری transport واقعی نیست. راهنمای کامل نسخهٔ مستقل داخل exports/equipment-ansible/README_FA.md است.

## شکل بازگرداندن نظرها

هر گزارش را جدا با «بازبین A/B/C» بفرستید. مسیر فایل/تابع، شواهد، شدت، روش بازتولید و پیشنهاد تغییر را حفظ کنید؛ اگر طولانی است در چند پیام یا فایل متنی بدهید. اطلاعات ورود، DB و screenshot حساس نفرستید. گزارش اولیه نباید به‌صورت خودکار به تغییر کد تبدیل شود؛ اول یافته‌ها با نسخهٔ مرجع تطبیق و سپس اصلاحات کم‌ریسک انتخاب می‌شوند.
