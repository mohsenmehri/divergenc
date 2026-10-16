به‌روزرسانی مدیریت کاربران و دسترسی‌های سفارشی + کنترل‌پلین عملیات شبکه — سرور مرکزی / IIS

این پچ برای نصب مرکزی FAM در C:\FAM و C:\FAMData است. رابط مدیریت کاربران را با نسخهٔ محلی یکسان می‌کند: محدودهٔ دسته‌ها، زیرمحدودهٔ مناطق برای استان‌ها، و مجوزهای ریزعملیاتی. «سطح کاربر» در فرم نمایش داده نمی‌شود.

این revision کنترل‌پلین عملیات شبکه را اضافه/به‌روزرسانی می‌کند: صفحهٔ `/network-operations`، Inventory متادیتا، بررسی مستقیم Err-disabled و رفع کنترل‌شدهٔ همان Interface گزارش‌شده. مرورگر اطلاعات اتصال را فقط برای کلید عمومی Worker رمز می‌کند؛ FAM/IIS هیچ IP یا Credential متن‌واضحی را ذخیره نمی‌کند. رفع خطا فقط بعد از انتخاب پورت گزارش‌شده، تأیید انسانی، pre-check و post-check انجام می‌شود؛ هیچ Command آزاد یا `write memory` وجود ندارد. Network Operations به‌صورت پیش‌فرض غیرفعال می‌ماند تا `FAM_NETWORK_OPS_ENABLED=1` تنظیم شود. سپس Worker داخلی خودکار سرور با هویت Built-in `NT AUTHORITY\LOCAL SERVICE` اجرا می‌شود؛ Pairing دستی، Token Worker، حساب نام‌دار یا Password سرویس وجود ندارد. Worker فقط به `http://127.0.0.1:8765/_internal` وصل می‌شود و IIS این مسیر را Proxy نمی‌کند. راهنمای کامل و script مهاجرت: `docs/NETWORK_OPERATIONS_PHASE1_FA.md` در بستهٔ Worker.

روش اجرا
1) ZIP را روی خود سرور Extract کنید.
2) APPLY-CUSTOM-ACCESS-UPDATE.cmd را با Run as administrator اجرا کنید.
3) فقط پیام سبز `CUSTOM ACCESS + PRIVATE FAM UI UPDATE APPLIED.` معتبر است.
4) سپس Worker ZIP هم‌نسخه را در `C:\FAM-NetworkWorker` Extract و `network_worker\windows\UPDATE-COHOSTED-WORKER.ps1` را با Administrator اجرا کنید. هیچ Token وارد نکنید.

ایمنی و بازگشت
- پیش از تغییر، app.py، FAM.html و web.config فعلی زیر C:\FAMData\backups\custom-access-<date> ذخیره می‌شوند.
- اگر `network_ops.py` یا `network_operations.html` از قبل وجود داشته باشد، آن‌ها نیز backup می‌شوند. اگر قبلاً وجود نداشته‌اند و Patch ناموفق شود، خودکار حذف می‌شوند.
- وظیفهٔ شناخته‌شدهٔ FAM-Central کنترل‌شده متوقف و پس از جایگزینی، شنود پورت داخلی 8765 بررسی می‌شود.
- پچ هیچ فایل SQLite، worksheet، داده، نام worksheet، رمز یا رکورد کاربر را پاک/جابه‌جا نمی‌کند.

مهاجرت حساب‌ها
در راه‌اندازی، ستون‌های nullable categories و permissions به جدول users اضافه می‌شوند. حساب‌های قدیمی نقش‌محور تا نخستین ذخیره از ویرایشگر جدید سازگار می‌مانند. پس از ذخیره، مجوزهای ریز و محدوده‌ها روی سرور، نه فقط رابط مرورگر، اجرا می‌شوند.

این revision علاوه بر custom access، hardening کم‌ریسک سرور را نیز دارد: HSTS یک‌ساله، خواندن fail-closed دادهٔ JSON کاربران، رد صریح شیت سیستمی غیرمجاز و allowlist نصب کامل.

بعد از اجرا، صفحه را دوباره باز کنید. FAM با no-cache پاسخ می‌دهد؛ پاک‌کردن دستی cache لازم نیست.
