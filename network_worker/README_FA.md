# FAM Network Worker

Worker جزء اجرایی فاز اول عملیات شبکه است و فقط Jobهای `read_only_inventory` را از FAM می‌گیرد. روی Cisco IOS فقط commandهای ثابت `show` را اجرا می‌کند و هیچ Command آزاد یا config mode ندارد.

دو روش کار دارد:

- **Inventory محلی:** Device ID به mapping محلی IP و credentialRef در `worker.json` متصل می‌شود و Credential در DPAPI حساب Worker است.
- **بررسی مستقیم یک‌باره:** کاربر مجاز IP/hostname، username و password را در فرم FAM وارد می‌کند. مرورگر، payload را با کلید عمومی RSA همین Worker رمز می‌کند. کلید خصوصی با DPAPI حساب Worker نگهداری می‌شود؛ FAM/IIS فقط ciphertext موقت را حمل می‌کند و هرگز دادهٔ متن‌واضح را نمی‌بیند.

- راهنمای معماری، استقرار هم‌مکان و محدودیت‌ها: [`../docs/NETWORK_OPERATIONS_PHASE1_FA.md`](../docs/NETWORK_OPERATIONS_PHASE1_FA.md)
- فایل نمونهٔ فاقد Credential: `worker.example.json`
- فایل واقعی `worker.json` و همهٔ `*.dpapi` طبق `.gitignore` محلی Worker هرگز نباید وارد repository شوند.

Worker می‌تواند روی همان سرور FAM/IIS باشد، ولی باید با حساب Windows مستقل از IIS/FAM اجرا و خارج از مسیر public نصب شود. ارتباط کنترل‌پلین FAM همیشه مستقیم و بدون Proxy/PAC است؛ در صورت گواهی خصوصی، `caFile` می‌تواند گواهی عمومی PEM یا Windows DER `.cer` تأییدشدهٔ FAM باشد.
