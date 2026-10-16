# عملیات شبکه FAM — بررسی و رفع کنترل‌شدهٔ Err-disabled

این قابلیت برای معماری زیر طراحی شده است:

```text
مرورگر کاربر ── HTTPS/443 ──> communication-02.toosbank.corp
                                   │
                                   ▼
                         سرور اصلی FAM / IIS — 10.16.243.18
                                   │
                                   └── سرویس داخلی Worker با هویت Built-in Local Service ── SSH/22 ──> Router / Switch Cisco IOS
```

کاربر فقط با مرورگر به صفحهٔ FAM متصل می‌شود؛ هیچ اتصال SSH از رایانهٔ کاربر به تجهیزات لازم نیست. اتصال SSH و تمام عملیات شبکه فقط از Worker نصب‌شده روی سرور مرکزی انجام می‌شود. Worker هیچ پورت ورودی جدیدی باز نمی‌کند.

## دو جریان کار

### ۱. بررسی مستقیم Err-disabled

کاربر مجاز در FAM، Worker، IP/hostname همان Router یا Switch، username و password SSH را وارد می‌کند. برای Router، کاربر نام کاربری/رمز RADIUS خودش را وارد می‌کند؛ برای Switch، حساب Local همان Switch را. مرورگر این داده‌ها را قبل از ارسال با کلید عمومی Worker رمز می‌کند. FAM/IIS فقط ciphertext موقت را در صف Job حمل می‌کند؛ IP و Credential متن‌واضح را نمی‌بیند، لاگ نمی‌کند و ذخیره نمی‌کند. Worker زیر هویت داخلی غیرتعاملی `NT AUTHORITY\LOCAL SERVICE` و با کلید خصوصی DPAPI همان هویت آن را فقط در حافظه باز می‌کند. این هویت Password، Desktop Login یا حساب FAM برای اپراتورها ندارد. هیچ اتصال SSH از سیستم کاربران ساخته نمی‌شود؛ تمام SSH فقط از IP سرور `10.16.243.18` برقرار است.

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

سپس Worker دوباره وضعیت را بررسی و فقط نتیجهٔ ساخت‌یافتهٔ `recovered`، `precheck_failed` یا `recovery_failed` را برمی‌گرداند. هیچ `enable`، Enable Secret، `write memory`، تغییر global configuration، Command آزاد، backup/restore یا auto-remediation وجود ندارد.

> Err-disabled یک مکانیزم حفاظتی است. ابتدا علت را رفع کنید: Loop/BPDU Guard، Port Security، Link flap، UDLD، Storm Control یا اشکال کابل/Optic. بازیابی بدون رفع علت می‌تواند سرویس را قطع یا Loop را بازگرداند.

## مرز مسئولیت‌ها

| جزء | مسئولیت | هرگز انجام نمی‌دهد / نگه نمی‌دارد |
|---|---|---|
| **FAM / IIS** | احراز هویت، CSRF، مجوز، صف Job، Audit و گزارش ساخت‌یافته | SSH مستقیم، IP یا Credential متن‌واضح، raw config/CLI |
| **مرورگر کاربر مجاز** | ورود موقت اطلاعات و رمزگذاری Web Crypto برای کلید Worker | نگهداری Credential یا ارسال متن‌واضح به API FAM |
| **Network Worker** | اتصال SSH از سرور مرکزی، بررسی ثابت، recovery محدود و post-check | UI، Command آزاد، تغییر خارج از پورت تأییدشده، `write memory` |
| **Windows DPAPI** | حفاظت از کلید خصوصی Worker و Credentialهای inventory محلی زیر حساب Worker | دسترسی برای IIS/FAM یا مرورگر |

## استقرار هم‌مکان خودکار روی همان سرور FAM/IIS

Worker فقط یک process داخلی روی همان سرور FAM/IIS است. مسیر واقعی عملیات این است:

```text
مرورگر کاربر ─ HTTPS/443 ─> communication-02.toosbank.corp
                              │
                              └─ FAM/IIS روی 10.16.243.18
                                   │
                                   └─ Worker داخلی Local Service ─ SSH/22 ─> Router / Switch
```

- کاربر هرگز SSH Client، Agent، Token Worker یا حساب سرویس دریافت نمی‌کند.
- Worker با هویت Built-in غیرتعاملی `NT AUTHORITY\LOCAL SERVICE` اجرا می‌شود؛ حساب نام‌دار و Password سرویس لازم نیست.
- Worker به‌جای HTTPS عمومی، فقط به `http://127.0.0.1:8765/_internal` وصل می‌شود. IIS این namespace داخلی را Proxy نمی‌کند و browser/شبکه نمی‌تواند به آن برسد.
- مسیر `private` Worker فقط برای Local Service، SYSTEM و Administratorهای مجاز ACL می‌شود.
- تجهیزات فقط باید SSH/22 را از IP سرور `10.16.243.18` مجاز کنند؛ workstation کاربران نیازی به SSH ندارد.

### راه‌اندازی

1. Patch جدید سرور را با Administrator روی FAM اعمال کنید.
2. Worker ZIP جدید را روی `C:\FAM-NetworkWorker` Extract و فایل‌های `network_worker` را overwrite کنید؛ venv و private موجود را حذف نکنید.
3. Worker را بدون Token پیکربندی و Task را بازسازی کنید:

   ```powershell
   C:\FAM-NetworkWorker\network_worker\windows\UPDATE-COHOSTED-WORKER.ps1
   ```

4. در `/network-operations` بعد از حدود 20 ثانیه Worker داخلی خودکار آماده می‌شود.
5. اپراتور مجاز در همان UI IP/hostname، username و password موقت SSH را وارد می‌کند. Router از RADIUS اپراتور و Switch از حساب Local تجهیز استفاده می‌کند.

## ممنوعیت‌ها

- Command آزاد یا ترمینال مرورگری وجود ندارد.
- Worker هیچ اطلاعات متن‌واضح اتصال را به FAM بازنمی‌گرداند.
- هیچ remediation خودکار یا گروهی وجود ندارد.
- یک recovery فقط برای یک پورت گزارش‌شده، با تأیید انسانی، pre-check و post-check اجرا می‌شود.
- raw output، running-config و backup FTP در FAM، SQLite، مرورگر یا Audit ذخیره نمی‌شوند.
