# مدیریت تجهیزات FAM — بررسی مستقیم Switch و Router

این نسخه صفحهٔ مستقل «عملیات شبکه»، Worker Token، Pairing و Scheduled Worker را حذف می‌کند. ابزار در یک تب **تجهیزات** داخل صفحهٔ اصلی FAM قرار دارد.

## جریان کار ساده

1. کاربر مجاز از HTTPS تأییدشدهٔ FAM وارد می‌شود.
2. در تب **تجهیزات**، IP خصوصی تجهیز، نام کاربری SSH/RADIUS و رمز موقت را وارد می‌کند.
3. FAM همان درخواست HTTPS را فقط در حافظهٔ process سرور نگه می‌دارد و یک helper محلی و یک‌بارمصرف را اجرا می‌کند.
4. helper از خود سرور FAM با SSH/22 به همان IP خصوصی متصل و فقط `show interfaces status` را اجرا می‌کند.
5. فقط نام پورت‌های `err-disabled` به UI برمی‌گردد؛ raw CLI output بازگردانده یا ذخیره نمی‌شود.
6. کاربر برای هر پورت گزارش‌شده دکمهٔ «تأیید رفع خطا» را می‌زند. سرور پیش از تغییر دوباره وضعیت همان پورت را بررسی می‌کند، فقط `shutdown` / `no shutdown` همان Interface را اجرا و دوباره کنترل می‌کند. `enable`، command آزاد و `write memory` وجود ندارد.

## حفاظت اطلاعات ورود

- username/password فقط در حافظهٔ مرورگرِ صفحهٔ باز، درخواست HTTPS و process موقت سرور است.
- در SQLite، Worker config، URL، log معمولی، browser storage یا command-line نوشته نمی‌شود.
- رمز هر بار پس از پاسخ سرور از فرم پاک می‌شود. برای recovery، کاربر رمز را دوباره وارد می‌کند.
- عملیات recovery فقط تا پنج دقیقه پس از همان بررسی و فقط برای همان IP، همان username و همان پورت با ticket امضاشدهٔ سرور مجاز است.

## پیش‌نیاز سرور

Patch، Netmiko و وابستگی‌های آن را از wheelهای همراه و hash-verified داخل `C:\\FAM\\server\\.venv` نصب می‌کند. Helper یک‌بارمصرف با همان runtime خود FAM اجرا می‌شود؛ Scheduled Task قدیمی `FAM-NetworkWorker` غیرفعال می‌شود و دیگر token، pairing یا worker polling وجود ندارد.

فقط SSH/22 از `10.16.243.18` به تجهیزات مجاز باشد. هدف فقط IP خصوصی IPv4 است؛ FAM یک proxy SSH عمومی نیست.
