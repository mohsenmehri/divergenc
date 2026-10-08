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

- **ماندگاری داده‌ها (سه‌لایه)** — همه‌ی تغییرات به‌صورت خودکار ذخیره می‌شوند:
  (۱) `localStorage` با **فشرده‌سازی LZ17 داخلی** (۸–۱۲ برابر کوچک‌تر؛ سازگار با
  ذخیره‌های قدیمی JSON خام) + fallback های سلسله‌مراتبی؛ (۲) **ذخیره‌ی عمیق IndexedDB**
  با ظرفیت بزرگ (آینه‌ی کامل payload، async)؛ (۳) **پشتیبان‌گیری JSON** دستی.
  هنگام باز شدن، نسخه‌ی جدیدتر (localStorage یا عمیق) انتخاب می‌شود؛
  دکمه‌ی «ذخیره» (`data-act="save-now"`) ذخیره‌ی صریح + تأیید بازخوانی + گزارش نتیجه را
  انجام می‌دهد. آخرین شیت/فیلتر باز هم به‌خاطر سپرده می‌شود (کلید `..._ui`) تا بعد از
  reload روی همان شیت برگردید. رمزها/قفل‌ها همچنان فقط شبیه‌سازی رفتار Excel هستند.
- همه‌ی rendering ها با DOM API خالص انجام می‌شوند (`el`/`txt`/`sEl`/`button`/`frag`/`clear`
  در `src/core.js`)؛ هیچ `innerHTML`/`insertAdjacentHTML` در سورس‌های برنامه وجود ندارد
  (داده فقط به `textContent`/`setAttribute`/`.value` می‌رود). modal ها `opts.contentNode`
  می‌گیرند؛ کانال `opts.html` حذف شده. نگهبان تست روی هر اجرا این را قفل نگه می‌دارد —
  جزئیات طبقه‌بندی نهایی: [INNERHTML_AUDIT.md](../INNERHTML_AUDIT.md).
- نام شیت‌های واردشده sanitize می‌شوند (کلیدهای `__proto__`/`constructor`/`prototype`
  مسدود؛ طول ≤۳۱).
- فایل ورودی قبل از دست زدن به state اعتبارسنجی می‌شود (`validateWorkbookData`)؛
  فایل خراب/ناقص رد می‌شود و وضعیت برنامه دست‌نخورده می‌ماند.


## وضعیت صادقانه (Honest status)

ادعاهای تست **فقط از مسیر repository قابل اثبات‌اند، نه از فایل HTML خروجی**:

```bash
cd src/test && npm install jsdom && node test_app.js
# => SUMMARY: 108/108 passed
```

- ✅ حذف کامل inline event handler ها (0 عدد در خروجی) — event delegation با `data-act` + CSP `script-src-attr 'none'`
- ✅ **DOM-API refactor کامل شد** — صفر `innerHTML` در سورس‌های برنامه؛ تنها استثنای مستند:
  vendor `xlsx.full.min.js` ([INNERHTML_AUDIT.md](../INNERHTML_AUDIT.md)). نگهبان DoD در تست‌ها.
- ✅ تست مرورگری واقعی: Playwright smoke روی Chromium واقعی (۲۵/۲۵) — CSP و file dialog
  در مرورگر واقعی اثبات می‌شوند، نه شبیه‌سازی.
- 🔶 enterprise-grade نیست: فاقد backend/auth و CI.

## تست‌ها — دو لایه اثبات

**۱) مجموعه رفتاری (jsdom) — unit/integration:**
```bash
cd src/test
npm install jsdom          # فقط برای تست
node test_app.js           # => SUMMARY: 108/108 passed  (۱۰۶ رفتاری + ۲ نگهبان DoD)
```

**۲) Playwright smoke (مرورگر واقعی Chromium — نه شبیه‌سازی):**
```bash
cd src/e2e
npm install
npm test                   # => SMOKE SUMMARY: 25/25 passed
# با مرورگر خودتان:  CHROME_PATH=".../chrome.exe" npm test
```
پوشش smoke: اجرای **واقعی** CSP (مسدود شدن handler درون‌خطی + رویداد violation)،
صفر بودن inline handler ها در DOM واقعی، **باز شدن واقعی پنجره انتخاب فایل**،
import با filechooser واقعی، رندر merge ها مثل اکسل، اجرای ماکروها روی داده
واردشده، بی‌اثر بودن XSS، و بازگشت به حالت خام — همه در Chromium 131 headless.

فهرست معادل‌سازی رفتاری ماکروها با فایل Excel اصلی: [`BEHAVIORAL_TESTS.md`](../BEHAVIORAL_TESTS.md)
