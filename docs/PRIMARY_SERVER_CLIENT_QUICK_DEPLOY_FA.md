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

## مدیریت تجهیزات

پس از Login، کاربر مجاز در تب **تجهیزات** داخل همان صفحهٔ اصلی FAM، سوئیچ‌های مجاز یا IP دستی مجاز و حساب موقت SSH/RADIUS را وارد می‌کند. خود سرور FAM مستقیم با Windows OpenSSH به تجهیز وصل می‌شود؛ Connector، VDI، Worker Token، Pairing یا سرویس جداگانه وجود ندارد.

- مسیر بررسی/رفع فعلی switch-only است؛ روتر شناخته‌شده در API هم رد می‌شود.
- پیش‌فرض host key برابر strict است؛ ابتدا کلید تجهیز را مستقل تأیید و ثبت کنید.
- حساب SSH/RADIUS در RAM می‌ماند؛ حساب Local+Enable و favorites به این نسخه اضافه نشده‌اند.
- `enable`، Enable Secret و `write memory` در این مسیر وجود ندارد.
- برای رفع، فقط پورت گزارش‌شده، پس از تأیید کاربر و pre-check/post-check،
  `shutdown` / `no shutdown` محدود دریافت می‌کند.

راهنمای کامل: [EQUIPMENT_MANAGEMENT_FA.md](EQUIPMENT_MANAGEMENT_FA.md).
