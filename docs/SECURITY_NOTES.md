# یادداشت‌های امنیتی FAM

این سند تصمیم‌های امنیتی فعال و مسیرهای بهبود آینده را ثبت می‌کند تا تغییرهای
مرتبط با production قابل بازبینی باشند.

## پچ hardening فعلی

این انتشار موارد زیر را اعمال می‌کند:

- HSTS یک‌ساله (`max-age=31536000`) برای سایت HTTPS داخلی؛ عمداً
  `includeSubDomains` و `preload` ندارد.
- خطای کنترل‌شده و fail-closed برای ستون‌های JSON آسیب‌دیدهٔ جدول `users`.
- رد صریح نام شیت‌های سیستمی غیرمجاز در ورودی browser. دو شیت
  `SYSTEM_SHEET_CONFIG` و `SYSTEM_KEYS` به‌علت فرادادهٔ persist‌شده و
  `CHANGE_LOG` به‌علت نمایش read-only تاریخچه همچنان سازگار هستند؛ لاگ از
  ورودی پاک می‌شود و هرگز از client persist نمی‌گردد.
- allowlist صریح فایل‌های deployment به‌جای copy کردن wildcard همهٔ `*.py`.
- یکسان‌سازی اولویت Python ماشین: `3.14 → 3.13 → 3.12`.

## Rate limiting پشت IIS/ARR

bucket فعلی login از username و `request.remote_addr` ساخته می‌شود. چون backend
پشت IIS/ARR فقط روی loopback شنود می‌کند، در استقرار استاندارد مقدار IP نزد
Flask معمولاً `127.0.0.1` است. بنابراین محدودسازی فعلی عمداً **per-username
سراسری** است، نه per-client-IP.

این رفتار جلوی تلاش نامحدود روی یک username را می‌گیرد، اما یک کاربر داخلی
می‌تواند با ۱۰ تلاش ناموفق ورود همان username را برای ۱۵ دقیقه محدود کند.

`X-Forwarded-For` در backend خوانده نمی‌شود. اضافه کردن آن بدون آزمون واقعی
ARR خطرناک است، چون header قابل جعل است. برای تبدیل این مدل به IP-aware باید
همهٔ این مراحل تکمیل شوند:

1. IIS/ARR header ارسالی کاربر را پیش از proxy پاک یا با IP واقعی overwrite کند.
2. backend فقط در یک تنظیم صریح `TRUSTED_PROXY` و تنها از proxy loopback آن
   header را بپذیرد.
3. آزمون IIS واقعی ثابت کند header جعل‌شده روی bucket اثر ندارد.
4. regression test رفتار trusted/untrusted را پوشش دهد.

تا آن زمان، مدل per-username سراسری از اعتماد نادرست به header ناامن بهتر است.

## PBKDF2

رمزها با `PBKDF2-HMAC-SHA256` و ۲۱۰٬۰۰۰ iteration ذخیره می‌شوند. این مقدار
برای انتشار فعلی حفظ شده تا migration ناگهانی و فشار نامشخص CPU روی Windows
Server ایجاد نشود.

راهنماهای جدیدتر معمولاً iteration بالاتری برای PBKDF2-SHA256 پیشنهاد می‌کنند.
هر افزایش باید migration کنترل‌شده داشته باشد:

1. ستون additive مانند `kdf_iter` اضافه شود.
2. رمز قدیمی با iteration ثبت‌شده تأیید شود.
3. هنگام login موفق، hash با target benchmark‌شدهٔ سرور دوباره ساخته شود.
4. پیش از فعال‌سازی، latency و CPU روی Windows Server واقعی اندازه‌گیری شود.

## رمز اولیه در نصب fresh

`FAM_INITIAL_PASSWORD` باید در نصب production صریحاً تعیین شود. fallback فعلی
فقط برای سازگاری نصب‌های موجود باقی مانده است؛ عملیات نصب باید بلافاصله رمز
مدیر را به مقدار منحصر‌به‌فرد سازمان تغییر دهد. حذف fallback یا تولید رمز اولیه
تصادفی نیازمند تغییر کنترل‌شدهٔ installer و روش امن تحویل رمز به Administrator
است.
