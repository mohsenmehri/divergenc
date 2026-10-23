# اجرای FAM Next روی VM — مسیر توسعه تا پذیرش

## 1. این VM چیست؟

این VM محیط توسعه/پذیرش است، نه Production و نه محیطی برای اتصال به Router/Switch
واقعی. برای آن یک DNS/Certificate آزمایشی مستقل تعیین کنید. URL Production
`communication-02.toosbank.corp` تا زمان Cutover تغییر نمی‌کند.

## 2. پیش‌نیازهای Administrator VM

1. Snapshot بگیرید.
2. IIS، SQL Server Developer یا Express، .NET SDK **10.0.402 x64** و ASP.NET
   Core Hosting Bundle **10.0.13 x64** را از رسانه/Feed تأییدشده نصب کنید.
   نسخهٔ SDK در `global.json` قفل شده است؛ Visual Studio باید Stable باشد، نه Preview/Insiders.
3. SQL را فقط Local یا شبکهٔ مدیریت VM نگه دارید؛ Port 1433 را برای کاربران باز
   نکنید.
4. Script زیر را با Administrator اجرا کنید:

```powershell
.\deploy\vm\Test-FamNextVm.ps1 -TestHostName '<VM-TEST-FQDN>'
```

5. برای IIS گواهی Test با SAN همان نام VM بسازید/متصل کنید. HTTP فقط Redirect
   به HTTPS است.

## 3. Database

- یک Database جدا با نام `FAMNextVm` بسازید.
- فقط Designer migration identity اجازهٔ اجرای `deploy\sql\001_initial.sql` دارد.
- سرویس Web در آینده با Windows Integrated identity و حداقل مجوز `EXECUTE` روی
  Stored Procedureهای محصول متصل می‌شود؛ Browser و IIS App Pool Login SQL ندارند.
- فایل Import ابتدا در `staging` قرار می‌گیرد، Macro اجرا نمی‌شود، سپس بعد از
  Validation و تأیید TenantAdmin به دادهٔ Tenant منتقل می‌شود.

## 4. مسیر Build

```text
SDK/Source خصوصی -> Restore از NuGet Feed تأییدشده -> Test -> Publish signed -> VM
```

Source، کلید امضای Code و کلید صدور License هرگز روی VM مشتری یا Browser قرار
نمی‌گیرند. DLL Release امضاشده و Obfuscate می‌شود، ولی Obfuscation جای SaaS یا
کنترل License را نمی‌گیرد.

## 5. پذیرش اولیه

- Browser ناشناس فقط Login می‌بیند.
- TenantAdmin فقط دادهٔ Tenant خودش را Import می‌کند.
- Import فقط `.csv` و `.xlsx` بدون Macro است.
- درخواست Tenant/Sheet خارج از Scope در Server با `403` رد می‌شود.
- SQL، Source، Backup، Excel اصلی و Secret URL عمومی ندارند.
- Network module تا پایان پذیرش داده/Roleها غیرفعال است و فقط با Lab Device
  فعال می‌شود.

## 6. عبور به Production

بعد از قبولی تمام تست‌ها، Migration روی Copy دادهٔ Production اجرا می‌شود؛ سپس
در Maintenance Window، Certificate و Binding واقعی
`communication-02.toosbank.corp` اعمال می‌شود. نسخهٔ FAM فعلی تا پایان دورهٔ
پذیرش به‌عنوان Rollback نگه داشته می‌شود.
