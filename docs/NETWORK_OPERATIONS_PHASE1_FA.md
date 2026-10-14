# عملیات شبکه FAM — فاز اول: اعتبارسنجی و Inventory فقط‌خواندنی

این فاز با هدف اتصال کنترل‌شده به تجهیزات Cisco شروع شده است، اما عمداً یک سامانهٔ تغییر کانفیگ یا اجرای دستور عمومی نیست.

## مرز مسئولیت‌ها

| جزء | مسئولیت | آنچه هرگز نگه نمی‌دارد/انجام نمی‌دهد |
|---|---|---|
| **FAM / IIS** | احراز هویت کاربران، مجوز، Inventory متادیتا، صف Job، گزارش ساخت‌یافته و Audit | IP مدیریت، رمز، Enable Secret، RADIUS Secret، SNMP Community، raw running-config، raw CLI output، SSH مستقیم |
| **Network Worker** | اتصال SSH به تجهیزی که در mapping محلی آن تعریف شده، اجرای مجموعهٔ ثابت show-commandها، ارسال نتیجهٔ ساخت‌یافته | UI، اجرای دستور آزاد، config mode، `write memory`، remediation، ذخیرهٔ token در log |
| **Windows DPAPI** | رمزگشایی Credential فقط زیر حساب سرویس مستقل Worker | دسترسی برای هویت IIS/FAM یا کاربر مرورگر |

FAM فقط شناسهٔ تجهیز را به Worker می‌دهد. آدرس SSH و `credentialRef` فقط در فایل محلی Worker هستند. Worker نیز فقط شناسه را از Job می‌پذیرد و اگر در mapping محلی یافت نشود، اتصال نمی‌گیرد.

## قابلیت‌های فعلی

- صفحهٔ جداگانهٔ کنترل: `/network-operations`
- Inventory متادیتای آزمایشگاهی: شناسه، نام، Site، Device Group اختیاری و وضعیت فعال/غیرفعال؛ بدون فیلد آدرس یا Credential
- Scope اجباری: **Site → Device Group اختیاری → فهرست صریح Device IDها**
- حداکثر ۱۰ تجهیز آزمایشگاهی در هر Job و قفل هم‌زمانی هر Device ID
- فقط Job ثابت `read_only_inventory`
- Worker با Token مجزا و قابل چرخش؛ Token فقط هنگام Pair شدن نشان داده می‌شود و هش آن در FAM ذخیره می‌شود.
- نتایج ساخت‌یافته: hostname، model، OS version، شمارنده‌های کلی interface و هشدارهای محدود. Raw CLI output پذیرفته یا ذخیره نمی‌شود.
- Worker فقط commandهای ثابت زیر را اجرا می‌کند و `enable()`، config mode، `send_config_set` و هر command آزاد در آن وجود ندارد:
  - `show version`
  - `show inventory`
  - `show ip interface brief`
  - `show interfaces status`
  - `show interfaces counters errors`
  - `show errdisable recovery`

## پیش‌نیازهای امنیتی پیش از فعال‌سازی

1. `bac.zip` عمومی را یک رخداد افشای اطلاعات در نظر بگیرید؛ Credentialهای FTP، RADIUS Shared Secret، SNMP Community، Local Account و Enable Secret را طبق Change Plan rotate کنید.
2. Worker را روی سرور یا VM جدا از IIS/FAM نصب کنید و **با حساب سرویس Windows مستقل** اجرا کنید. استفاده از همان Identity مربوط به Application Pool یا `LocalSystem` مجاز نیست.
3. IP ثابت Worker را فقط به ACL مدیریت تجهیزات اضافه کنید. وجود `access-class` روی VTY باید قبل از تست هر تجهیز بررسی شود.
4. در Worker یک حساب اختصاصی با کمترین سطح مجاز برای commandهای ثابت Read-only بسازید. حساب‌های RADIUS فعلی با Full Access نباید Credential سرویس باشند.
5. Token Pairing را فقط یک‌بار مشاهده و فوراً زیر حساب Worker نگهداری کنید؛ در FAM، IIS، repository، فایل نمونه یا ticket قرار ندهید.
6. فایل DPAPI و `worker.json` فقط باید برای حساب Worker مجوز خواندن داشته باشند. فایل نمونه را کپی کنید اما هرگز `worker.json` یا `*.dpapi` را commit نکنید.

## فعال‌سازی کنترل‌پلین

به‌صورت پیش‌فرض API شبکه غیرفعال است. پس از آماده‌سازی Worker مستقل، روی سرور FAM متغیرهای زیر را تنظیم و سرویس را با روش عملیاتی تأییدشدهٔ سازمان restart کنید:

```text
FAM_NETWORK_OPS_ENABLED=1
FAM_NETWORK_OPS_MAX_LAB_DEVICES=10
FAM_NETWORK_OPS_JOB_LEASE_SECONDS=600
```

در مدل دسترسی سفارشی FAM، فقط حساب دارای مجوز **مدیریت کاربران و دسترسی‌ها** (`manage-users`) می‌تواند Inventory آزمایشگاهی را ثبت، Worker را pair، Job را ایجاد یا آن را در حالت queued لغو کند. حساب دارای مجوز **مشاهدهٔ تاریخچه** (`view-history`) فقط گزارش‌ها را می‌بیند. حساب‌های نقش‌محور قدیمی صرفاً برای سازگاری تا زمان مهاجرت باقی می‌مانند و هیچ «سطح‌بندی» جدیدی در UI عملیات شبکه نمایش داده نمی‌شود.

## راه‌اندازی Worker آزمایشگاهی

1. پوشهٔ `network_worker/` را روی میزبان Worker جداگانه کپی کنید؛ آن را در IIS یا مسیر public قرار ندهید.
2. Python و وابستگی‌های همان پوشه را زیر حساب سرویس Worker نصب کنید:

   ```powershell
   py -m venv C:\FAM-NetworkWorker\venv
   C:\FAM-NetworkWorker\venv\Scripts\pip.exe install -r C:\FAM-NetworkWorker\requirements.txt
   ```

3. `worker.example.json` را به `worker.json` کپی کنید. تنها در همین فایل محلی Device ID، آدرس SSH، پورت، `credentialRef` و timeout قرار می‌گیرد. URL کنترل‌پلین باید HTTPS باشد. اگر FAM از گواهی خصوصی یا self-signed استفاده می‌کند، فایل عمومی گواهیِ تأییدشدهٔ FAM را در `caFile` قرار دهید؛ Worker هر دو قالب رایج PEM و Windows DER `.cer` را می‌پذیرد.
4. از صفحهٔ `/network-operations` یک Worker ثبت کنید. Token یک‌بار نمایش‌داده‌شده را به متغیر محیطی تعریف‌شده در `tokenEnv` همان حساب سرویس بدهید. Worker درخواست‌های کنترل‌پلین را صریحاً و مستقیم ارسال می‌کند و هر Proxy/PAC سیستمی را برای این Token دور می‌زند؛ Token را هرگز در تنظیمات Proxy، URL، log یا فایل JSON قرار ندهید.
5. تحت **همان حساب Worker**، Credential اختصاصی فقط‌خواندنی را با دستور زیر وارد DPAPI کنید. این فرمان رمز را نمایش یا ذخیرهٔ متن‌واضح نمی‌کند:

   ```powershell
   C:\FAM-NetworkWorker\venv\Scripts\python.exe -m network_worker.provision_secret --store C:\FAM-NetworkWorker\private\secrets.json.dpapi --ref cisco-readonly-lab
   ```

6. ابتدا فقط یک تجهیز lab را به Inventory کنترل‌پلین اضافه کنید و Device ID آن را با mapping محلی یکسان بگذارید. سپس Worker را یک مرتبه اجرا کنید:

   ```powershell
   C:\FAM-NetworkWorker\venv\Scripts\python.exe -m network_worker.main --config C:\FAM-NetworkWorker\worker.json --once
   ```

7. پس از بررسی نتیجه، Worker را با Service Manager سازمان، زیر همان حساب مستقل، به‌صورت سرویس اجرا کنید. هم‌زمانی فاز اول حداکثر ۲ اتصال است؛ افزایش آن نیازمند تست ظرفیت جداگانه است.

## ممنوعیت‌های فاز اول

- هیچ endpoint یا UI برای Command آزاد، config mode، backup restore، تغییر ACL، shutdown/no shutdown، err-disable recovery یا ذخیرهٔ config وجود ندارد.
- تشخیص `err-disabled` فقط گزارش می‌شود. حتی Link Flap هرگز به auto-remediation تبدیل نمی‌شود.
- raw output، running-config و بکاپ FTP نباید در FAM، SQLite، log مرورگر یا گزارش Job ذخیره شود.
- این فاز جایگزین سامانهٔ بکاپ نیست و فایل‌های FTP موجود را دریافت یا پردازش نمی‌کند.

## معیار عبور به مرحلهٔ بعد

تنها پس از ثبت موفق تست نماینده روی تجهیزات واقعی، تأیید ACL مبدأ Worker، بررسی خروجی‌های ساخت‌یافته و تأیید امنیت Credentialها می‌توان inventory/reporting گسترده‌تر را مطرح کرد. هر remediation بعدی باید feature جداگانه، approval انسانی، allow-list سیاست، pre-check/post-check، ثبت Audit و امکان توقف داشته باشد.
