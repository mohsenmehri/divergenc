# مرز خصوصی برنامهٔ FAM — داده، Sheet و کد اصلی

**آدرس واحد کاربران:** `https://communication-02.toosbank.corp`
**سرور مرکزی:** `10.16.243.18`

این نسخه برای جلوگیری از قرارگرفتن منطق اصلی و دادهٔ FAM در مسیر عمومی IIS طراحی
شده است. Browser کاربر فقط Login سبک و بعد از احراز هویت، رابط برنامه را دریافت
می‌کند. Excel اصلی، دیتابیس، Backup، کد Backend، Ruleها و Secretها در Browser
ارسال یا در IIS Web Root نگهداری نمی‌شوند.

## مرز فایل‌ها

```text
C:\FAM\server\www\
  login.html / login.css / login.js / web.config     ← تنها محتوای عمومی IIS

C:\FAM\server\private_ui\FAM.html                 ← فقط Backend بعد از Session می‌خواند
C:\FAM\server\app.py                               ← Backend، خارج از Web Root
C:\FAMData\fam.sqlite3                              ← دادهٔ خصوصی
C:\FAMData\backups\                                ← Backup خصوصی
```

IIS فقط `C:\FAM\server\www` را سرو می‌کند. مسیرهای `/app` و `/FAM.html` به
Backend loopback بازنویسی می‌شوند. Backend پیش از فرستادن UI کامل، Cookie نشست
`HttpOnly` FAM را بررسی می‌کند؛ Session نامعتبر به `/login.html` بازگردانده
می‌شود. مسیرهای API نیز همان کنترل نشست، Origin و CSRF را دارند.

## چیزهایی که کاربر می‌بیند و چیزهایی که نمی‌بیند

- Browser همیشه می‌تواند HTML/CSS/JavaScript لازم برای نمایش صفحه‌ای را که
  مجاز به استفاده از آن است مشاهده کند. این ویژگی ذاتی وب است و با Minify یا
  Obfuscation امنیت ایجاد نمی‌شود.
- دادهٔ Sheetها فقط پس از Login و فقط در محدودهٔ مجاز نقش/Region دریافت می‌شود.
- فایل Excel اصلی، VBA، Database، کد Python، Backup، کلیدهای خصوصی و Tokenها
  هرگز URL عمومی ندارند.
- کاربری که مجاز به دیدن یک رکورد است می‌تواند همان رکورد را Copy یا Screenshot
  کند؛ کنترل دسترسی می‌تواند افشای کل Workbook یا دادهٔ خارج از محدوده را منع
  کند، نه مشاهدهٔ داده‌ای را که عمداً روی صفحه نمایش داده شده است.

## استقرار/ارتقا

برای سرور مرکزی فعال، `FAM-Custom-Access-SERVER-Patch.zip` را کامل Extract کنید
و `APPLY-CUSTOM-ACCESS-UPDATE.cmd` را با **Run as administrator** اجرا کنید. Patch:

1. هش SHA-256 همهٔ payloadها را پیش از تغییر کنترل می‌کند؛
2. از `app.py`، `web.config`، UI قدیمی و فایل‌های جدید Backup می‌گیرد؛
3. سرویس شناخته‌شدهٔ `FAM-Central` را موقتاً متوقف می‌کند؛
4. UI اصلی را در `private_ui` با ACL فقط Administrator / SYSTEM / LOCAL SERVICE
   قرار می‌دهد؛
5. Login سبک و Ruleهای IIS را نصب می‌کند؛
6. Backend را دوباره راه می‌اندازد و شنود داخلی `127.0.0.1:8765` را کنترل می‌کند؛
7. در خطا، فایل‌های قبل را از Backup بازمی‌گرداند.

Patch هیچ فایل SQLite، حساب، Password، Sheet یا Backup را حذف یا Reset نمی‌کند.
پس از پیام سبز موفقیت، کاربر فقط URL اصلی HTTPS را باز می‌کند؛ آدرس `/FAM.html`
را لازم نیست Bookmark کند.

## بررسی پذیرش پس از استقرار

از یک Workstation:

1. `https://communication-02.toosbank.corp` باید صفحهٔ Login سبک را نمایش دهد.
2. بازکردن `https://communication-02.toosbank.corp/app` یا `/FAM.html` بدون Login
   باید به `/login.html` بازگردد.
3. پس از Login، برنامه و فقط Sheetهای مجاز کاربر باز می‌شوند.
4. درخواست مستقیم این مسیرها باید `403` یا `404` بدهد، نه دانلود فایل:

   ```text
   /app.py
   /fam.sqlite3
   /Mohsen_FINAL_v5.xlsm
   /backups/
   /secrets/
   ```

5. بعد از Session معتبر، تب «تجهیزات» داخل `/app` قابل استفاده است؛ SSH فقط
   از سرور مرکزی انجام می‌شود و صفحهٔ مستقل `/network-operations` وجود ندارد.

## محدودیت مدیریتی

Administrator محلی ویندوز ذاتاً می‌تواند فایل‌ها را با اختیارات Administrator
باز کند یا ACL را تغییر دهد. این طراحی از Browser، کاربران معمولی و Application
Pool IIS محافظت می‌کند؛ برای کنترل Administratorها باید سیاست دسترسی سازمانی،
حساب‌های جداگانه، ثبت رویداد و کنترل فیزیکی/Domain اعمال شود.
