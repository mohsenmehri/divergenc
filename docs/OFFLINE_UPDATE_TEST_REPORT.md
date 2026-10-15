# گزارش آزمون به‌روزرسانی آفلاین و اصلاح تم ۲ — ۲۰۲۶-۱۰-۱۱

## هدف این انتشار

- Windows Server 2019 x64 بدون اینترنت، نشانی داخلی `https://ertebatat-fam` و IP سرور `10.16.243.18`.
- پیش‌نیازهای Python / IIS URL Rewrite / ARR نباید از سرور دانلود شوند؛ نصب باید قبل از هر تغییر، کامل‌بودن و اعتبار فایل‌های انتقالی را بررسی کند.
- در تم ۲، حالت کلیک/فوکوس فیلدها نباید به پس‌زمینهٔ تیرهٔ CSS اصلی برگردد. کنترل‌های «شدت بک‌گراند» و «پس‌زمینه» فقط در تم ۱ دیده شوند.

## موارد بررسی‌شده و نتیجه

| بررسی | روش | نتیجه |
|---|---|---|
| wheelهای آفلاین | 11 فایل، SHA-256 هر فایل با metadata رسمی PyPI تطبیق داده شد | موفق |
| سازگاری wheelhouse | `pip download --no-index --only-binary=:all: --platform win_amd64` برای CPython 3.12، 3.13 و 3.14 | موفق برای هر سه ABI |
| برنامهٔ نصب آفلاین | آزمون‌های Python ثابت: manifest، نام امن فایل، hash، سه ABI، نبود pip دانلود در آماده‌ساز، `--no-index` و `--only-binary` در نصب، و استثنای محدود زنجیرهٔ امضای آفلاین | 9 آزمون موفق |
| API و backup قبلی | `server.tests.test_installer` و `server.tests.test_api` | 29 آزمون موفق |
| CSS/ساخت مرکزی | تست‌های ساخت و سالم‌ماندن XLSM | 4 آزمون موفق |
| مرورگر واقعی | Chromium برای نسخهٔ مستقل و نسخهٔ مرکزی با Flask و SQLite آزمایشی جدا، دسکتاپ 1440×1000 و موبایل 390×844 | 4 آزمون موفق |
| حالت فوکوس/کلیک تم ۲ | ورود، پنل سریع، افزودن/حذف، فرم کاربر، wizard، سلول spreadsheet و input/textarea modal؛ کنترل تم ۱ نیز دوباره بررسی شد | 2 آزمون مرورگر موفق |
| certificate/SNI hardening | SAN گواهی تولیدی پیش از bind کنترل و binding دقیق `10.16.243.18:443:ertebatat-fam` در IIS SSL provider دوباره‌خوانی می‌شود | guard ثابت موفق |
| parse PowerShell | 8 فایل PowerShell با tree-sitter | بدون خطای syntax |
| ساخت ZIP | allowlist، hash wheelها و عدم حضور دادهٔ واقعی/تنظیمات/کلید خصوصی | در مرحلهٔ انتشار اجرا می‌شود |

فرمان‌های اجراشده در محیط Linux:

```text
.venv/bin/python -m unittest server.tests.test_offline_kit server.tests.test_installer server.tests.test_api
node --test tests/sidebar-theme.test.cjs tests/shared-build.test.cjs
```

نتایج نهایی این اجرای محیط: **37 آزمون Python** و **8 آزمون Node/Chromium** موفق. برای build، تمام wheelهای همراه نیز hash شدند.

## محدودیت‌های شفاف

- Windows Server 2019، IIS/ARR واقعی، certificate store، DISM، اعتبارسنجی Authenticode در محیط کاملاً آفلاین و نصب روی `10.16.243.18` در این محیط اجرا نشده‌اند. این گزارش ادعای موفقیت نصب تولیدی یا تست پنج کامپیوتر فیزیکی ندارد.
- فایل‌های رسمی Python/ARR/Rewrite در این محیط دریافت یا اجرا نشدند. نام، URL، hash و ناشر از `dependencies.json` گرفته می‌شود. آماده‌ساز اینترنت‌دار status=`Valid` امضا را الزام می‌کند؛ روی سرور ایزوله فقط `UnknownError`/`NotTrusted` ناشی از زنجیرهٔ غیرقابل‌دسترسی، پس از SHA-256 پین‌شده و تطبیق ناشر embedded، قابل ادامه است. این مسیر روی Windows واقعی اجرا نشده است.
- برای وجودنداشتن payload قابلیت‌های IIS، رسانهٔ معتبر Windows Server 2019 مطابق همان سرور لازم است. نصب‌کننده با `-LimitAccess` سراغ Windows Update نمی‌رود؛ اگر منبع مناسب نباشد متوقف می‌شود.
- اعتماد گواهی self-signed، DNS داخلی برای `ertebatat-fam` و سیاست فایروال/GPO سازمان هنوز اقدام مدیر شبکه است. این انتشار خودسرانه آنها را تغییر نمی‌دهد.

## اثر داده و رابط

- هیچ جدول، حساب، رمز، فایل XLSM یا داده‌ای reset/migrate نشده است.
- در HTML مرکزی و محلی، خارج از CSS تم، هیچ رفتار ورود/مجوز/داده‌ای برای اصلاح حالت فوکوس تغییر نکرده است.
- نسخهٔ مرکزی دارای API/SQLite اشتراکی است؛ HTML مستقل فقط برای تست ظاهری محلی مناسب است.
