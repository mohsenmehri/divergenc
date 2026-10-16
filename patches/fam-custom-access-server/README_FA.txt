به‌روزرسانی مدیریت کاربران و دسترسی‌های سفارشی + مدیریت تجهیزات — سرور مرکزی / IIS

این پچ برای نصب مرکزی FAM در C:\FAM و C:\FAMData است. رابط مدیریت کاربران را با نسخهٔ محلی یکسان می‌کند: محدودهٔ دسته‌ها، زیرمحدودهٔ مناطق برای استان‌ها، و مجوزهای ریزعملیاتی. «سطح کاربر» در فرم نمایش داده نمی‌شود.

این revision صفحهٔ مستقل عملیات شبکه و Worker Token را حذف می‌کند و تب «تجهیزات» را داخل صفحهٔ اصلی FAM اضافه می‌کند. وقتی FAM Server به تجهیزات SSH دسترسی ندارد، Connector پرتابل روی VDI دارای SSH، فقط از طریق HTTPS خروجی به FAM متصل می‌شود. کاربر مجاز IP خصوصی تجهیز و نام کاربری/رمز موقت SSH یا RADIUS را وارد می‌کند؛ این اطلاعات فقط در RAM همان درخواست می‌مانند. گزارش پورت‌های Err-disabled و Description پورت است. برای رفع، کاربر همان پورت را تأیید می‌کند؛ Connector pre-check، `shutdown` / `no shutdown` محدود و post-check انجام می‌دهد. command آزاد، Enable، ذخیرهٔ تنظیمات، Worker Pairing و Token وجود ندارد.

روش اجرا
1) ZIP Patch را روی خود سرور Extract کنید.
2) APPLY-CUSTOM-ACCESS-UPDATE.cmd را با Run as administrator اجرا کنید.
3) ZIP جداگانهٔ `FAM-Equipment-Connector-Portable.zip` را روی VDI دارای SSH Extract و `START-FAM-EQUIPMENT-CONNECTOR.cmd` را بدون Administrator، Python یا pip اجرا کنید. در Connector با همان حساب FAM وارد شوید.
4) فقط پیام سبز `CUSTOM ACCESS + PRIVATE FAM UI UPDATE APPLIED.` معتبر است. سپس FAM را refresh کنید و تب «تجهیزات» را باز کنید.

ایمنی و بازگشت
- پیش از تغییر، app.py، start.ps1، FAM.html و web.config فعلی زیر C:\FAMData\backups\custom-access-<date> ذخیره می‌شوند.
- اگر `network_ops.py` یا `network_operations.html` از قبل وجود داشته باشد، آن‌ها نیز backup می‌شوند. اگر قبلاً وجود نداشته‌اند و Patch ناموفق شود، خودکار حذف می‌شوند.
- وظیفهٔ شناخته‌شدهٔ FAM-Central کنترل‌شده متوقف و پس از جایگزینی، شنود پورت داخلی 8765 بررسی می‌شود.
- پچ هیچ فایل SQLite، worksheet، داده، نام worksheet، رمز یا رکورد کاربر را پاک/جابه‌جا نمی‌کند.

مهاجرت حساب‌ها
در راه‌اندازی، ستون‌های nullable categories و permissions به جدول users اضافه می‌شوند. حساب‌های قدیمی نقش‌محور تا نخستین ذخیره از ویرایشگر جدید سازگار می‌مانند. پس از ذخیره، مجوزهای ریز و محدوده‌ها روی سرور، نه فقط رابط مرورگر، اجرا می‌شوند.

این revision علاوه بر custom access، hardening کم‌ریسک سرور را نیز دارد: HSTS یک‌ساله، خواندن fail-closed دادهٔ JSON کاربران، رد صریح شیت سیستمی غیرمجاز و allowlist نصب کامل.

بعد از اجرا، صفحه را دوباره باز کنید. FAM با no-cache پاسخ می‌دهد؛ پاک‌کردن دستی cache لازم نیست.
