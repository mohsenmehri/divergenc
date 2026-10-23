FAM Equipment Connector — اجرای آزمایشی روی VDI بدون Administrator یا Python

این برنامه فقط وقتی FAM Server به تجهیزات SSH دسترسی ندارد استفاده می‌شود. روی VDI که به تجهیزات SSH/22 دسترسی دارد اجرا می‌شود و فقط به‌صورت خروجی با HTTPS به FAM وصل می‌ماند. هیچ پورت ورودی، Windows Service، Token یا Pairing لازم ندارد.

روش اجرا
1) ZIP را در یک پوشهٔ قابل‌نوشتن برای کاربر Extract کنید.
2) START-FAM-EQUIPMENT-CONNECTOR.cmd را اجرا کنید.
3) Connector با Windows PowerShell و OpenSSH Client خود VDI اجرا می‌شود؛ Python، pip، Internet و Administrator لازم نیست.
4) آدرس FAM، username و password معمولی FAM خودتان را وارد کنید. این موارد در فایل ذخیره نمی‌شوند.
5) پنجره را باز نگه دارید. سپس در Browser با همان حساب FAM، تب تجهیزات را باز کنید و بررسی را بزنید.

پیش‌نیاز کوتاه
- Windows PowerShell و OpenSSH Client (`ssh.exe`) باید روی VDI موجود باشند. در Windows 10/11 معمولاً موجودند. اگر Connector پیام «ssh.exe» داد، تیم VDI باید فقط OpenSSH Client را فعال کند؛ برای شما Administrator لازم نیست.
- VDI باید به https://communication-02.toosbank.corp با HTTPS و به تجهیزات با SSH/22 دسترسی داشته باشد.
- در اولین SSH برای تجهیز ناشناخته، OpenSSH fingerprint آن را با روش امن TOFU ثبت می‌کند؛ fingerprint در known_hosts کاربر است و credential نیست.

محدودیت امنیتی
- Connector فقط با همان حساب FAM که در شروع وارد شده کارهای تجهیزات را می‌گیرد.
- IP خصوصی، username/password تجهیز فقط در RAM همان درخواست است.
- فقط show interfaces status و recovery محدود همان پورت اجرا می‌شود؛ command آزاد، enable و ذخیره‌سازی تنظیمات وجود ندارد.
- اگر VDI Sign-out یا Restart شود، Connector باید دوباره با همین CMD اجرا شود.
