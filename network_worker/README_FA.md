# FAM Network Worker

Worker یک جزء مستقل برای فاز اول عملیات شبکه است. فقط Jobهای `read_only_inventory` را از FAM می‌گیرد و فقط commandهای ثابت show را با Netmiko روی Cisco IOS اجرا می‌کند.

- برای معماری، نصب ایمن، Pair کردن و محدودیت‌ها: [`../docs/NETWORK_OPERATIONS_PHASE1_FA.md`](../docs/NETWORK_OPERATIONS_PHASE1_FA.md)
- فایل نمونهٔ فاقد Credential: `worker.example.json`
- فایل واقعی `worker.json` و همهٔ `*.dpapi` طبق `.gitignore` محلی Worker هرگز نباید وارد repository شوند.

Worker باید با حساب Windows مستقل از IIS/FAM اجرا شود. این پروژه هیچ fallback برای secret در Environment Variable ندارد؛ Credential تجهیز فقط در store رمز‌شدهٔ DPAPI زیر هویت Worker خوانده می‌شود.
