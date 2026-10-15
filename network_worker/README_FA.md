# FAM Network Worker

Worker روی سرور مرکزی FAM اجرا می‌شود و اتصال SSH به تجهیزات فقط از همان سرور انجام می‌گیرد؛ کاربران فقط UI مرورگر FAM را می‌بینند.

قابلیت‌ها:

- Inventory فقط‌خواندنی Cisco IOS با commandهای ثابت `show`.
- بررسی مستقیم Err-disabled برای Router یا Switch Cisco IOS: کاربر IP/hostname، username و password را در مرورگر وارد می‌کند؛ برای Router از RADIUS خودش و برای Switch از حساب Local همان تجهیز. مرورگر آن‌ها را برای کلید DPAPI/RSA Worker رمز می‌کند و FAM هیچ متن‌واضحی نمی‌بیند.
- رفع کنترل‌شدهٔ یک Interface Err-disabled: فقط پورت گزارش‌شده از بررسی موفق، با pre-check، توالی محدود `shutdown` / `no shutdown`، post-check و بدون `enable`، Enable Secret یا `write memory`.

Worker ترمینال یا اجرای دستور آزاد نیست. هیچ Command عمومی، تغییر global configuration، backup/restore یا auto-remediation ندارد.

- راهنمای معماری و استقرار: [`../docs/NETWORK_OPERATIONS_PHASE1_FA.md`](../docs/NETWORK_OPERATIONS_PHASE1_FA.md)
- فایل نمونهٔ فاقد Credential: `worker.example.json`
- فایل واقعی `worker.json` و همهٔ `*.dpapi` طبق `.gitignore` محلی Worker هرگز نباید وارد repository شوند.

Worker فقط یک سرویس داخلی روی همان سرور FAM/IIS است؛ سرور دوم، Agent روی Workstation کاربران یا حساب نام‌دار `FAMNetworkWorker` لازم نیست. آن را خارج از مسیر public و با هویت Built-in غیرتعاملی `NT AUTHORITY\LOCAL SERVICE` اجرا کنید؛ این هویت Password یا Desktop Login ندارد و از هویت Application Pool/IIS جدا می‌ماند. ارتباط کنترل‌پلین FAM همیشه مستقیم و بدون Proxy/PAC است؛ در صورت گواهی خصوصی، `caFile` می‌تواند گواهی عمومی PEM یا Windows DER `.cer` تأییدشدهٔ FAM باشد.
