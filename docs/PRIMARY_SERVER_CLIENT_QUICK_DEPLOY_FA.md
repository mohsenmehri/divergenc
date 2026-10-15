# راهنمای ارتقای امن FAM مرکزی

**سرور:** `10.16.243.18`
**تنها URL کاربران:** `https://communication-02.toosbank.corp`

> این راهنما جایگزین دستور قدیمیِ کپی‌کردن `FAM.html` در IIS است. آن روش UI
> اصلی را به یک فایل عمومی تبدیل می‌کرد و برای مدل خصوصی فعلی مجاز نیست.

## پیش از شروع

- کاربر نهایی فقط Browser خود را باز می‌کند و به سرور یا Router/Switch وصل نمی‌شود.
- Administrator سرور، Patch را روی `10.16.243.18` اجرا می‌کند؛ هیچ Credential
  دستگاه شبکه یا Password واقعی در Chat، Script یا فایل Patch وارد نمی‌شود.
- Patch دادهٔ `C:\FAMData` را Reset نمی‌کند، اما زمان نگهداری کوتاه لازم است چون
  Task `FAM-Central` موقتاً Restart می‌شود.

## ارتقای نصب مرکزی موجود

1. `FAM-Custom-Access-SERVER-Patch.zip` را فقط روی خود سرور کامل Extract کنید.
2. روی `APPLY-CUSTOM-ACCESS-UPDATE.cmd` راست‌کلیک و **Run as administrator** را
   بزنید.
3. فقط پیام زیر موفقیت محسوب می‌شود:

   ```text
   CUSTOM ACCESS + PRIVATE FAM UI UPDATE APPLIED.
   ```

4. اسکریپت پیش از تغییر، SHA-256 همهٔ فایل‌های Patch را کنترل و از `app.py`،
   `web.config`، UI قدیمی و فایل‌های مربوط Backup می‌گیرد. مسیر Backup زیر
   `C:\FAMData\backups\custom-access-...` نمایش داده می‌شود.
5. هیچ فایل SQLite، Sheet، حساب FAM، رمز حساب یا Backup داده حذف/بازنویسی نمی‌شود.

پس از ارتقا، IIS فقط `login.html` کوچک را از `C:\FAM\server\www` می‌خواند.
رابط اصلی در `C:\FAM\server\private_ui\FAM.html` است و Flask فقط بعد از
Session معتبر آن را ارائه می‌کند. جزئیات و آزمون پذیرش در
[PRIVATE_APPLICATION_BOUNDARY_FA.md](PRIVATE_APPLICATION_BOUNDARY_FA.md) است.

## بررسی از Workstation

```bat
curl.exe --noproxy "*" -I https://communication-02.toosbank.corp/
```

انتظار: `200 OK` برای صفحهٔ Login روی HTTPS. سپس کاربر URL اصلی را در Browser
باز می‌کند و Login می‌کند. قبل از Login، مسیر `/app` یا `/FAM.html` باید به
`/login.html` بازگردد.

## Network Operations

همان URL اصلی FAM صفحهٔ `/network-operations` را در اختیار کاربر مجاز قرار
می‌دهد. Worker فقط یک سرویس داخلی روی همین سرور و تحت `NT AUTHORITY\LOCAL SERVICE`
است؛ هیچ حساب دستی `FAMNetworkWorker`، سرور دوم یا Agent روی Workstation کاربران
ساخته نمی‌شود. تمام SSH از `10.16.243.18` انجام می‌شود.

- Router: کاربر RADIUS username/password خودش را وارد می‌کند.
- Switch: کاربر local username/password خودش را وارد می‌کند.
- `enable` و Enable Secret در این مسیر وجود ندارد.

راهنمای محدودیت‌ها و Recovery کنترل‌شده: [NETWORK_OPERATIONS_PHASE1_FA.md](NETWORK_OPERATIONS_PHASE1_FA.md).
