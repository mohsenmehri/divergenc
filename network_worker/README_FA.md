# FAM Network Worker — مدل هم‌مکان خودکار

Worker فقط روی همان سرور FAM اجرا می‌شود و اتصال SSH به Router/Switch فقط از همان سرور برقرار می‌شود. کاربران فقط UI مرورگر FAM را روی HTTPS می‌بینند.

- مرورگر اپراتور IP/hostname و credential موقت SSH را وارد می‌کند: Router با RADIUS اپراتور و Switch با حساب Local تجهیز.
- مرورگر داده را برای کلید عمومی Worker رمز می‌کند؛ FAM آن را متن‌واضح ذخیره نمی‌کند و Worker آن را فقط در حافظه باز می‌کند.
- Worker روی همان سرور، زیر `NT AUTHORITY\LOCAL SERVICE`، به SSH/22 تجهیز وصل می‌شود.
- ارتباط داخلی Worker با FAM فقط `http://127.0.0.1:8765/_internal` است. IIS این مسیر را Proxy نمی‌کند؛ مرورگر و شبکه به آن دسترسی ندارند.
- Token Pairing مرورگر، حساب نام‌دار Worker و Password سرویس وجود ندارد. Local Service و مسیر loopback مرز داخلی Worker هستند.
- هیچ credential تجهیزی در Worker config یا DPAPI store نگهداری نمی‌شود؛ credential واردشده فقط در حافظهٔ process Worker برای همان Job است.
- Worker فقط commandهای ثابت show و recovery محدود همان Interface گزارش‌شده را اجرا می‌کند؛ `enable`، Enable Secret، `write memory` و command آزاد وجود ندارد.

بعد از Extract نسخهٔ Worker، با Administrator اجرا کنید:

```powershell
C:\FAM-NetworkWorker\network_worker\windows\UPDATE-COHOSTED-WORKER.ps1
```

این script `worker.json` و Scheduled Task را بدون Token می‌سازد. فایل واقعی config و DPAPI هرگز وارد repository نمی‌شوند.
