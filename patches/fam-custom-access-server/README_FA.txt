به‌روزرسانی مدیریت کاربران و دسترسی‌های سفارشی + مدیریت تجهیزات — سرور مرکزی / IIS

این پچ برای نصب مرکزی FAM در C:\FAM و C:\FAMData است. رابط مدیریت کاربران را با نسخهٔ محلی یکسان می‌کند: محدودهٔ دسته‌ها، زیرمحدودهٔ مناطق برای استان‌ها، و مجوزهای ریزعملیاتی. «سطح کاربر» در فرم نمایش داده نمی‌شود.

این revision صفحهٔ مستقل عملیات شبکه و Worker Token را حذف می‌کند و تب «تجهیزات» را داخل صفحهٔ اصلی FAM اضافه می‌کند. اتصال SSH مستقیماً از خود سرور FAM (10.16.243.18) به تجهیز انجام می‌شود؛ VDI Connector، Worker، Token، Pairing، سرویس ویندوز یا ذخیرهٔ credential وجود ندارد. به‌جای Netmiko/Paramiko از Windows OpenSSH (ssh.exe) با استثنای موقت و محدود `-o Ciphers=+aes128-cbc` استفاده می‌شود (3des-cbc، aes192-cbc و aes256-cbc فعال نمی‌شوند). کاربر مجاز IP خصوصی تجهیز و نام کاربری/رمز موقت SSH یا RADIUS را وارد می‌کند؛ رمز فقط در RAM همان درخواست و environment همان child process ssh.exe است و هرگز در command-line، فایل، دیتابیس یا log قرار نمی‌گیرد. عملیات status فقط `terminal length 0` / `show interfaces status` / `exit` است و اگر پورت err-disabled وجود نداشته باشد پیام «وضعیت پاک» نمایش داده می‌شود. برای رفع، کاربر همان پورت را تأیید می‌کند؛ سرور pre-check، `shutdown` / `no shutdown` محدود روی همان Interface و post-check انجام می‌دهد. command آزاد، Enable، ذخیرهٔ تنظیمات وجود ندارد. Host key با فایل اختصاصی C:\FAMData\equipment\known_hosts و سیاست accept-new بررسی می‌شود (StrictHostKeyChecking=no استفاده نمی‌شود).

پیش‌نیاز: «OpenSSH Client» ویندوز روی سرور FAM نصب باشد (C:\Windows\System32\OpenSSH\ssh.exe) و `ssh -Q cipher` شامل aes128-cbc باشد. نصاب این را پیش از هر تغییر بررسی می‌کند و هیچ wheel یا بستهٔ Python نصب نمی‌کند.

روش اجرا
1) ZIP Patch را روی خود سرور Extract کنید.
2) APPLY-CUSTOM-ACCESS-UPDATE.cmd را با Run as administrator اجرا کنید.
3) فقط پیام سبز `CUSTOM ACCESS + PRIVATE FAM UI UPDATE APPLIED.` معتبر است. سپس FAM را refresh کنید و تب «تجهیزات» را باز کنید.

ایمنی و بازگشت
- پیش از تغییر، app.py، equipment_ops.py، equipment_probe.py، start.ps1، FAM.html، login.* و web.config فعلی زیر C:\FAMData\backups\custom-access-<date> ذخیره می‌شوند و فقط همین فایل‌ها جایگزین می‌شوند.
- اگر فایلی قبلاً وجود نداشته و Patch ناموفق شود، خودکار حذف و بقیه از backup بازگردانده می‌شوند.
- Patch هیچ رمز، Token، دیتابیس، PFX، private key، log یا venv همراه ندارد؛ صحت payload با SHA256SUMS.txt پیش از هر تغییر بررسی می‌شود.
- وظیفهٔ شناخته‌شدهٔ FAM-Central کنترل‌شده متوقف و پس از جایگزینی، شنود پورت داخلی 8765 بررسی می‌شود.
- پچ هیچ فایل SQLite، worksheet، داده، نام worksheet، رمز یا رکورد کاربر را پاک/جابه‌جا نمی‌کند.

مهاجرت حساب‌ها
در راه‌اندازی، ستون‌های nullable categories و permissions به جدول users اضافه می‌شوند. حساب‌های قدیمی نقش‌محور تا نخستین ذخیره از ویرایشگر جدید سازگار می‌مانند. پس از ذخیره، مجوزهای ریز و محدوده‌ها روی سرور، نه فقط رابط مرورگر، اجرا می‌شوند.

این revision علاوه بر custom access، hardening کم‌ریسک سرور را نیز دارد: HSTS یک‌ساله، خواندن fail-closed دادهٔ JSON کاربران، رد صریح شیت سیستمی غیرمجاز و allowlist نصب کامل.

بعد از اجرا، صفحه را دوباره باز کنید. FAM با no-cache پاسخ می‌دهد؛ پاک‌کردن دستی cache لازم نیست.
