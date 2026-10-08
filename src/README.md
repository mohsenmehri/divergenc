# NetScope Console — معماری لایه‌ای (Architecture)

خروجی نهایی یک فایل تک‌فایلی `Mohsen_FINAL_v5.html` است که با اسکریپت زیر از لایه‌های
جداگانه ساخته می‌شود:

```bash
python3 src/build.py          # -> Mohsen_FINAL_v5.html
```

## لایه‌ها (Layers)

| لایه | فایل | مسئولیت |
|---|---|---|
| **DATA** | `data.js` | پوسته برنامه (`APP_SHELL` — شروع خام، بدون داده تجاری) + سورس ماژول‌های VBA (`VBA_MODULES`) |
| **CORE** | `core.js` | مدل داده (`WB`)، قرارداد state، helper ها، مودال‌ها، **لایه تراکنش** (`withTransaction`)، **validation ورودی**، verify/recover ایندکس |
| **STORAGE** | `storage.js` | فقط persistence: ذخیره/بازیابی localStorage با fallback سلسله‌مراتبی، پشتیبان JSON |
| **MACROS** | `macros.js` | پورت وفادارانه ماکروهای VBA (جستجو، افزودن، حذف، undo، …) |
| **UI** | `ui.js` | رندر (فقط از روی `WB`/`state`)، ورود/خروجی فایل، رجیستری ماکروها، بوت |
| **VENDOR** | `vendor/xlsx.full.min.js` | SheetJS — پارس/ساخت xlsx کاملاً آفلاین |

## قرارداد Source of Truth (state management)

- **`WB` (order + sheets) تنها مرجع داده تجاری است.** UI فقط *رندر* می‌کند؛ import
  به‌صورت اتمیک جایگزین می‌کند؛ saveState سریالایز می‌کند؛ export و undo از روی همان
  می‌خوانند/کپی می‌گیرند.
- **`state` فقط فلگ‌های UI/نشست** است (انتخاب‌ها، فیلدهای پنل، اشاره‌گر undo، قفل‌ها)؛
  هیچ مقدار تجاری که بتواند از `WB` منحرف شود در آن کش نمی‌شود.
- **هر تغییر `WB` باید از `withTransaction` بگذرد**: snapshot → اجرا → ذخیره یک‌بار؛
  در خطا → rollback کامل + لاگ مشاهده‌پذیر.
- **`SYSTEM_SEARCH_INDEX` داده مشتق‌شده است**: همیشه از `WB` + `SYSTEM_SHEET_CONFIG`
  به‌صورت دترمینیستیک بازسازی می‌شود؛ از storage هرگز به‌عنوان حقیقت پذیرفته نمی‌شود
  (`verifySearchIndex` / `recoverSearchIndex`).

## امنیت — شفاف‌سازی (Security — transparency)

⚠️ **رمزها و قفل‌های این برنامه (پنل: `1234`، شیت‌ها: `12346`) فقط شبیه‌سازی رفتار
فایل Excel اصلی هستند و امنیت واقعی ایجاد نمی‌کنند.** این یک اپلیکیشن تماماً
کلاینتی است؛ هرکسی به فایل HTML یا داده‌های مرورگر دسترسی داشته باشد می‌تواند
همه‌چیز را بخواند. امنیت واقعی نیازمند معماری سمت سرور (authentication/authorization
در backend) است که خارج از scope این ابزار مبتنی بر فایل است.

- همه ورودی‌های `innerHTML` که از داده (import / ورودی کاربر / localStorage) می‌آیند
  escape می‌شوند (`escapeHtml` / `escapeHtmlAttr` / `encJs`).
- نام شیت‌های واردشده sanitize می‌شوند (کلیدهای `__proto__`/`constructor`/`prototype`
  مسدود؛ طول ≤۳۱).
- فایل ورودی قبل از دست زدن به state اعتبارسنجی می‌شود (`validateWorkbookData`)؛
  فایل خراب/ناقص رد می‌شود و وضعیت برنامه دست‌نخورده می‌ماند.

## تست‌ها

```bash
cd src/test
npm install jsdom          # فقط برای تست
node test_app.js           # مجموعه رفتاری (66+ assertion)
```

فهرست معادل‌سازی رفتاری ماکروها با فایل Excel اصلی: [`BEHAVIORAL_TESTS.md`](../BEHAVIORAL_TESTS.md)
