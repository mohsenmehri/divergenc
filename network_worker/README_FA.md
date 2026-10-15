# FAM Network Worker

Worker روی سرور مرکزی FAM اجرا می‌شود و اتصال SSH به تجهیزات فقط از همان سرور انجام می‌گیرد؛ کاربران فقط UI مرورگر FAM را می‌بینند.

قابلیت‌ها:

- Inventory فقط‌خواندنی Cisco IOS با commandهای ثابت `show`.
- بررسی مستقیم Err-disabled: کاربر IP/hostname، username و password را در مرورگر وارد می‌کند؛ مرورگر آن‌ها را برای کلید DPAPI/RSA Worker رمز می‌کند و FAM هیچ متن‌واضحی نمی‌بیند.
- رفع کنترل‌شدهٔ یک Interface Err-disabled: فقط پورت گزارش‌شده از بررسی موفق، با pre-check، توالی محدود `shutdown` / `no shutdown`، post-check و بدون `write memory`.

Worker ترمینال یا اجرای دستور آزاد نیست. هیچ Command عمومی، تغییر global configuration، backup/restore یا auto-remediation ندارد.

- راهنمای معماری و استقرار: [`../docs/NETWORK_OPERATIONS_PHASE1_FA.md`](../docs/NETWORK_OPERATIONS_PHASE1_FA.md)
- فایل نمونهٔ فاقد Credential: `worker.example.json`
- فایل واقعی `worker.json` و همهٔ `*.dpapi` طبق `.gitignore` محلی Worker هرگز نباید وارد repository شوند.

Worker می‌تواند روی همان سرور FAM/IIS باشد، ولی باید با حساب Windows مستقل از IIS/FAM اجرا و خارج از مسیر public نصب شود. ارتباط کنترل‌پلین FAM همیشه مستقیم و بدون Proxy/PAC است؛ در صورت گواهی خصوصی، `caFile` می‌تواند گواهی عمومی PEM یا Windows DER `.cer` تأییدشدهٔ FAM باشد.
