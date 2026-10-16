# FAM Next — پایهٔ محصول قابل‌فروش

این مسیر، بازنویسی تدریجی FAM برای مدل **SaaS-first** است. مشتری فقط Browser
و پنل Tenant خودش را دارد؛ کد منبع، Database، Ruleهای محصول، کلیدهای امضا و
فایل‌های Backup روی زیرساخت محصول باقی می‌مانند.

## مرزهای قطعی

- UI با ASP.NET Core Razor Pages به‌صورت Server-rendered خواهد بود؛ Browser فقط
  HTML/CSS و داده‌ای را می‌گیرد که همان کاربر مجاز به دیدنش است.
- `F12` قابل مسدودکردن نیست. این محصول تضمین می‌کند که Source C#، Connection
  String، Ruleها، Database، Formulaهای Server، کلیدها و دادهٔ Tenant دیگر هرگز
  به Browser ارسال نشوند.
- هر دادهٔ مشتری در SQL Server با `TenantId` جدا می‌شود. Scope کاربر در Server
  اعمال می‌شود، نه از پارامتر ارسالی Browser.
- مشتری `TenantAdmin` می‌تواند دادهٔ خودش را از پنل Import و کاربران Tenant
  خودش را مدیریت کند. Import فقط داده است؛ Macro، VBA، Script و SQL اجرا
  نمی‌شوند.
- Designer فقط مالک محصول است. Runtime service نیز حداقل دسترسی لازم را دارد؛
  هیچ کاربر Browser یا IIS App Pool دسترسی مستقیم Database ندارد.

## مدل استقرار

```text
Browser -> HTTPS/IIS -> ASP.NET Core (loopback) -> SQL Server
                                      -> Equipment Management helper (one-shot) -> SSH
```

محیط اول: VM آزمایشی. هیچ Migration یا Deployment روی `10.16.243.18` تا زمان
عبور کامل از آزمون VM انجام نمی‌شود.

## وضعیت این Commit

این Commit پایهٔ محصول را می‌سازد: قراردادهای Tenant/Role/Import، SQL schema،
سیاست License و اسکریپت Preflight VM. Runtime .NET فقط بعد از نصب SDK فعلی
و SQL Server روی VM Build و Test می‌شود؛ این محیط توسعه SDK .NET ندارد و
نباید خروجی کامپایل‌نشده را محصول آماده اعلام کرد.

راهنمای VM: [`docs/VM_IMPLEMENTATION_FA.md`](docs/VM_IMPLEMENTATION_FA.md)
