# عملیات شبکه FAM — بررسی و رفع کنترل‌شدهٔ Err-disabled

این قابلیت برای معماری زیر طراحی شده است:

```text
مرورگر کاربر ── HTTPS/443 ──> FAM/IIS روی سرور مرکزی
                                   │
                                   └── Worker با حساب Windows مستقل ── SSH/22 ──> سوئیچ Cisco IOS
```

کاربر فقط با مرورگر به صفحهٔ FAM متصل می‌شود؛ هیچ اتصال SSH از رایانهٔ کاربر به تجهیزات لازم نیست. اتصال SSH و تمام عملیات شبکه فقط از Worker نصب‌شده روی سرور مرکزی انجام می‌شود. Worker هیچ پورت ورودی جدیدی باز نمی‌کند.

## دو جریان کار

### ۱. بررسی مستقیم Err-disabled

کاربر مجاز در FAM، Worker، IP/hostname سوئیچ، username و password SSH را وارد می‌کند. مرورگر این داده‌ها را قبل از ارسال با کلید عمومی Worker رمز می‌کند. FAM/IIS فقط ciphertext موقت را در صف Job حمل می‌کند؛ IP و Credential متن‌واضح را نمی‌بیند، لاگ نمی‌کند و ذخیره نمی‌کند. Worker زیر هویت مستقل خود و با کلید خصوصی DPAPI آن را فقط در حافظه باز می‌کند.

Worker فقط دستورهای ثابت زیر را اجرا می‌کند:

- `show version`
- `show inventory`
- `show ip interface brief`
- `show interfaces status`
- `show interfaces counters errors`
- `show errdisable recovery`

نتیجه شامل شمارش Err-disabled و نام‌های Interfaceهایی است که از خروجی ثابت `show interfaces status` به‌صورت ساخت‌یافته استخراج شده‌اند؛ raw CLI output نگهداری نمی‌شود.

### ۲. رفع کنترل‌شدهٔ یک پورت

کاربر نمی‌تواند Command آزاد وارد کند. فقط پس از یک بررسی موفق، FAM دکمهٔ رفع را برای همان Interface گزارش‌شده نمایش می‌دهد. کاربر علت خطا را خارج از سیستم بررسی و رفع می‌کند، سپس دوباره اطلاعات اتصال همان سوئیچ را وارد و تأیید صریح می‌دهد.

FAM فقط در صورتی درخواست رفع را می‌پذیرد که:

1. پورت انتخاب‌شده دقیقاً در نتیجهٔ همان Job بررسی گزارش شده باشد.
2. همان Worker که بررسی را انجام داده انتخاب شود.
3. هیچ بررسی یا بازیابی هم‌زمان دیگری برای آن Worker در صف نباشد.
4. مرورگر اطلاعات اتصال را برای همان Worker رمز کرده باشد.

Worker پیش از تغییر، دوباره `show interfaces status` را اجرا می‌کند. اگر پورت دیگر Err-disabled نباشد، عملیات متوقف می‌شود. در صورت تأیید live pre-check، فقط توالی محدود زیر روی همان Interface اجرا می‌شود:

```text
interface <پورت گزارش‌شده>
shutdown
no shutdown
```

سپس Worker دوباره وضعیت را بررسی و فقط نتیجهٔ ساخت‌یافتهٔ `recovered`، `precheck_failed` یا `recovery_failed` را برمی‌گرداند. هیچ `write memory`، تغییر global configuration، Command آزاد، backup/restore یا auto-remediation وجود ندارد.

> Err-disabled یک مکانیزم حفاظتی است. ابتدا علت را رفع کنید: Loop/BPDU Guard، Port Security، Link flap، UDLD، Storm Control یا اشکال کابل/Optic. بازیابی بدون رفع علت می‌تواند سرویس را قطع یا Loop را بازگرداند.

## مرز مسئولیت‌ها

| جزء | مسئولیت | هرگز انجام نمی‌دهد / نگه نمی‌دارد |
|---|---|---|
| **FAM / IIS** | احراز هویت، CSRF، مجوز، صف Job، Audit و گزارش ساخت‌یافته | SSH مستقیم، IP یا Credential متن‌واضح، raw config/CLI |
| **مرورگر کاربر مجاز** | ورود موقت اطلاعات و رمزگذاری Web Crypto برای کلید Worker | نگهداری Credential یا ارسال متن‌واضح به API FAM |
| **Network Worker** | اتصال SSH از سرور مرکزی، بررسی ثابت، recovery محدود و post-check | UI، Command آزاد، تغییر خارج از پورت تأییدشده، `write memory` |
| **Windows DPAPI** | حفاظت از کلید خصوصی Worker و Credentialهای inventory محلی زیر حساب Worker | دسترسی برای IIS/FAM یا مرورگر |

## استقرار هم‌مکان روی همان سرور FAM/IIS

Worker می‌تواند روی همان سرور FAM/IIS باشد، اما باید خارج از مسیر IIS و با حساب Windows مستقل اجرا شود.

1. حساب Windows مستقل و کم‌دسترسی برای Worker بسازید؛ از `LocalSystem` و هویت Application Pool استفاده نکنید.
2. Worker را در مسیری مانند `C:\FAM-NetworkWorker` نصب کنید، نه زیر `C:\FAM\server\www`.
3. روی `worker.json`، `*.dpapi` و پوشهٔ `private` فقط حساب Worker مجوز بخواند/بنویسد.
4. ACL مدیریت تجهیزات باید اجازهٔ SSH از IP سرور Worker را بدهد؛ رایانه‌های کاربران نیازی به مسیر SSH به تجهیزات ندارند.
5. FAM باید فقط از HTTPS و نامی استفاده کند که در SAN گواهی آن وجود دارد. `controlPlaneUrl` همان HTTPS origin واقعی FAM است.

## فعال‌سازی و راه‌اندازی

کنترل‌پلین به‌صورت پیش‌فرض غیرفعال است. پس از اعمال Patch سرور، متغیرهای زیر را روی سرور FAM تنظیم و سرویس FAM را restart کنید:

```text
FAM_NETWORK_OPS_ENABLED=1
FAM_NETWORK_OPS_MAX_LAB_DEVICES=10
FAM_NETWORK_OPS_JOB_LEASE_SECONDS=600
```

1. Worker را با `worker.example.json` پیکربندی کنید. برای بررسی مستقیم، `devices` می‌تواند خالی باشد.
2. در `/network-operations` یک Worker ثبت و Token یک‌بارمصرف را فقط در محیط حساب Worker نگهداری کنید.
3. Worker را یک‌بار اجرا کنید تا کلید DPAPI/RSA خود را ثبت کند:

   ```powershell
   C:\FAM-NetworkWorker\venv\Scripts\python.exe -m network_worker.main --config C:\FAM-NetworkWorker\worker.json --once
   ```

4. سپس Worker را زیر همان حساب مستقل به‌صورت سرویس یا Scheduled Task اجرا کنید.
5. کاربر دارای مجوز `manage-users` می‌تواند بررسی و recovery کنترل‌شده را درخواست کند؛ حساب دارای `view-history` فقط گزارش‌ها را می‌بیند.

## ممنوعیت‌ها

- Command آزاد یا ترمینال مرورگری وجود ندارد.
- Worker هیچ اطلاعات متن‌واضح اتصال را به FAM بازنمی‌گرداند.
- هیچ remediation خودکار یا گروهی وجود ندارد.
- یک recovery فقط برای یک پورت گزارش‌شده، با تأیید انسانی، pre-check و post-check اجرا می‌شود.
- raw output، running-config و backup FTP در FAM، SQLite، مرورگر یا Audit ذخیره نمی‌شوند.
