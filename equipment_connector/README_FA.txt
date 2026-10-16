FAM Equipment Connector — اجرای آزمایشی روی VDI بدون Administrator

این برنامه فقط وقتی FAM Server اجازهٔ SSH به تجهیزات ندارد استفاده می‌شود. روی VDI که به تجهیزات SSH/22 دسترسی دارد اجرا می‌شود و فقط به‌صورت خروجی با HTTPS به FAM وصل می‌ماند. هیچ پورت ورودی، Windows Service، Token یا Pairing لازم ندارد.

روش اجرا
1) ZIP را در یک پوشهٔ قابل‌نوشتن برای کاربر Extract کنید.
2) START-FAM-EQUIPMENT-CONNECTOR.cmd را اجرا کنید.
3) در اولین اجرا Python 3.12 / 3.13 / 3.14 موجود روی VDI را پیدا می‌کند، venv را فقط در %LOCALAPPDATA%\FAM-Equipment-Connector می‌سازد و Netmiko را فقط از wheelهای داخل ZIP نصب می‌کند. Administrator یا Internet لازم نیست.
4) آدرس FAM، username و password معمولی FAM خودتان را وارد کنید. این موارد در فایل ذخیره نمی‌شوند.
5) پنجره را باز نگه دارید. سپس در Browser با همان حساب FAM، تب تجهیزات را باز کنید و بررسی را بزنید.

محدودیت امنیتی
- Connector فقط با همان حساب FAM که در شروع وارد شده کارهای تجهیزات را می‌گیرد.
- IP خصوصی، username/password تجهیز فقط در RAM همان درخواست است.
- فقط show interfaces status و recovery محدود همان پورت اجرا می‌شود؛ command آزاد، enable و ذخیره‌سازی تنظیمات وجود ندارد.
- اگر VDI Sign-out یا Restart شود، Connector باید دوباره با همین CMD اجرا شود.
- اگر Python روی VDI قابل اجرا نیست یا AppLocker فایل را مسدود می‌کند، تیم VDI باید Python machine/user-accessible یا یک Jump Host مدیریت‌شده فراهم کند.
