# عملیات شبکه FAM — فاز اول: Inventory و بررسی مستقیم Err-disabled فقط‌خواندنی

فاز اول فقط برای مشاهدهٔ کنترل‌شدهٔ وضعیت Cisco IOS است. این فاز نه یک ترمینال عمومی است و نه سامانهٔ تغییر کانفیگ.

## دو مسیر مجاز

1. **Inventory محلی:** تجهیز با یک شناسه در FAM ثبت می‌شود و IP/credential فقط در فایل محلی Worker قرار می‌گیرد.
2. **بررسی مستقیم یک‌باره:** کاربر مجاز، IP یا نام میزبان، نام کاربری و رمز SSH را در فرم «بررسی مستقیم Err-disabled» وارد می‌کند. مرورگر قبل از ارسال، کل این چهار مقدار را با کلید عمومی Worker رمز می‌کند. FAM/IIS فقط ciphertext موقت را حمل می‌کند؛ نه IP و نه نام کاربری/رمز متن‌واضح را دریافت، لاگ یا ذخیره نمی‌کند. Worker همان ciphertext را فقط در حافظه و زیر کلید خصوصی DPAPI خود باز می‌کند؛ پس از پایان یا لغو Job، ciphertext نیز از FAM حذف می‌شود.

مسیر دوم برای زمانی است که تجهیز آزمایشگاهی جداگانه وجود ندارد. هر درخواست فقط **یک تجهیز** را بررسی می‌کند و هیچ Credential یا آدرس پایداری در FAM نمی‌سازد.

## مرز مسئولیت‌ها

| جزء | مسئولیت | آنچه هرگز نگه نمی‌دارد/انجام نمی‌دهد |
|---|---|---|
| **FAM / IIS** | احراز هویت، مجوز، صف Job، گزارش ساخت‌یافته و Audit؛ حمل کوتاه‌مدت ciphertext بررسی مستقیم | رمز یا IP متن‌واضح، Enable Secret، RADIUS Secret، SNMP Community، raw running-config، raw CLI output، SSH مستقیم |
| **مرورگر کاربر مجاز** | ورود موقت اطلاعات برای بررسی مستقیم و رمزگذاری Web Crypto با کلید عمومی Worker | ذخیره‌سازی Credential؛ ارسال متن‌واضح به API FAM |
| **Network Worker** | اتصال SSH، اجرای show-commandهای ثابت و ارسال نتیجهٔ ساخت‌یافته | UI، دستور آزاد، config mode، `write memory`، remediation، نگهداری Credential بررسی مستقیم |
| **Windows DPAPI** | محافظت از کلید خصوصی بررسی مستقیم و credentialهای mapping محلی، فقط زیر حساب Worker | دسترسی برای هویت IIS/FAM یا کاربر مرورگر |

## دستورات مجاز و نتیجهٔ Err-disabled

Worker فقط commandهای ثابت زیر را اجرا می‌کند:

- `show version`
- `show inventory`
- `show ip interface brief`
- `show interfaces status`
- `show interfaces counters errors`
- `show errdisable recovery`

اگر عبارت `err-disabled` در خروجی‌های status/errors دیده شود، Worker فقط شمارش رابط‌ها و هشدار `err-disabled interfaces detected` را برمی‌گرداند. نام پورت و raw CLI output ذخیره نمی‌شود. Worker هرگز `enable()`، config mode، `send_config_set` یا دستور آزاد اجرا نمی‌کند.

## استقرار هم‌مکان روی همان سرور FAM/IIS

Worker می‌تواند روی همان سرور ویندوزی FAM/IIS باشد، اما نباید داخل IIS، پوشهٔ public یا هویت Application Pool اجرا شود.

1. یک حساب Windows مستقل و کم‌دسترسی فقط برای Worker بسازید؛ از `LocalSystem` و Identity مربوط به IIS/FAM استفاده نکنید.
2. Worker و فایل‌های خصوصی آن را بیرون از مسیر IIS، مثلاً `C:\FAM-NetworkWorker`، قرار دهید. روی `worker.json`، `*.dpapi` و پوشهٔ `private` فقط همان حساب Worker مجوز بخواند/بنویسد.
3. IP سرور Worker را فقط به ACL مدیریت تجهیز اضافه کنید. قبل از هر اجرا، VTY `access-class` و مسیر SSH تجهیز را بررسی کنید.
4. حساب SSH تجهیزات باید اختصاصی و با کمترین دسترسی لازم برای show-commandهای بالا باشد. از حساب RADIUS دارای Full Access به عنوان حساب سرویس استفاده نکنید.
5. فایل `worker.json` هیچ credential ندارد. برای بررسی مستقیم، Worker در اولین اجرا یک کلید RSA 3072-bit می‌سازد و با DPAPI همان حساب محافظت می‌کند؛ کلید عمومی آن از طریق Token Pairing به FAM ثبت می‌شود.

## فعال‌سازی کنترل‌پلین

به‌صورت پیش‌فرض API شبکه غیرفعال است. پس از نصب Patch سرور و آماده‌سازی Worker، روی سرور FAM متغیرهای زیر را تنظیم و سرویس FAM را با روش عملیاتی تأییدشدهٔ سازمان restart کنید:

```text
FAM_NETWORK_OPS_ENABLED=1
FAM_NETWORK_OPS_MAX_LAB_DEVICES=10
FAM_NETWORK_OPS_JOB_LEASE_SECONDS=600
```

فقط حساب دارای مجوز **مدیریت کاربران و دسترسی‌ها** (`manage-users`) می‌تواند Worker را pair، Inventory آزمایشگاهی را ثبت، یا بررسی مستقیم یک‌باره را درخواست کند. حساب دارای مجوز **مشاهدهٔ تاریخچه** (`view-history`) فقط گزارش‌ها را می‌بیند.

## راه‌اندازی Worker هم‌مکان

1. محتویات `network_worker/` را در `C:\FAM-NetworkWorker\network_worker` کپی کنید؛ آن را زیر `C:\FAM\server\www` قرار ندهید.
2. Python و وابستگی‌ها را زیر حساب سرویس Worker نصب کنید:

   ```powershell
   py -m venv C:\FAM-NetworkWorker\venv
   C:\FAM-NetworkWorker\venv\Scripts\pip.exe install -r C:\FAM-NetworkWorker\network_worker\requirements.txt
   ```

3. `worker.example.json` را به `worker.json` کپی کنید. `controlPlaneUrl` باید HTTPS باشد. اگر FAM از گواهی خصوصی یا self-signed استفاده می‌کند، فایل عمومی گواهیِ تأییدشدهٔ FAM را در `caFile` قرار دهید. `devices` برای بررسی مستقیم می‌تواند خالی بماند.
4. در `/network-operations` یک Worker ثبت کنید. Token یک‌بار نمایش‌داده‌شده را فقط زیر هویت همان حساب Worker در متغیر تعریف‌شده توسط `tokenEnv` قرار دهید؛ Token را در IIS، repository، URL یا ticket وارد نکنید.
5. Worker را یک‌بار زیر همان هویت اجرا کنید تا کلید DPAPI و کلید عمومی بررسی مستقیم ثبت شود:

   ```powershell
   C:\FAM-NetworkWorker\venv\Scripts\python.exe -m network_worker.main --config C:\FAM-NetworkWorker\worker.json --once
   ```

6. در صفحهٔ عملیات شبکه، فرم «بررسی مستقیم Err-disabled» را باز کنید، همان Worker را انتخاب کنید و IP/نام میزبان، username و password SSH را وارد کنید. این داده‌ها قبل از درخواست API در مرورگر رمز می‌شوند؛ پس از دریافت نتیجهٔ Job در هیچ‌جا نگهداری نمی‌شوند.
7. پس از مشاهدهٔ نتیجه، Worker را زیر همان حساب مستقل با Service Manager سازمان یا Scheduled Task تأییدشده اجرا کنید. این Worker هیچ پورت ورودی ایجاد نمی‌کند.

## ممنوعیت‌های فاز اول

- هیچ endpoint یا UI برای Command آزاد، config mode، backup restore، تغییر ACL، shutdown/no shutdown، err-disable recovery یا ذخیرهٔ config وجود ندارد.
- تشخیص `err-disabled` فقط گزارش می‌شود و هرگز auto-remediation نیست.
- raw output، running-config و بکاپ FTP در FAM، SQLite، لاگ مرورگر یا گزارش Job ذخیره نمی‌شود.
- رمز یا IP بررسی مستقیم در FAM به‌صورت متن‌واضح ذخیره نمی‌شود؛ فقط Worker دارای کلید DPAPI می‌تواند ciphertext یک‌باره را باز کند.

## معیار عبور به مرحلهٔ بعد

پس از مشاهدهٔ موفق یک بررسی مستقیم فقط‌خواندنی، تأیید ACL مبدأ Worker و بازبینی نتیجهٔ ساخت‌یافته، Inventory گسترده‌تر قابل طرح است. هر remediation بعدی باید یک قابلیت جدا، محدودهٔ تجهیز صریح، approval انسانی، pre-check/post-check، Audit و امکان توقف داشته باشد.
