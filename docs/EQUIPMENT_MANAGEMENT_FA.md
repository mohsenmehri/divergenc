# مدیریت تجهیزات FAM — اتصال مستقیم از سرور FAM (Windows OpenSSH)

این نسخه صفحهٔ مستقل «عملیات شبکه»، Worker Token، Pairing، VDI Connector و سرویس ویندوز را ندارد. ابزار در تب **تجهیزات** داخل FAM قرار دارد و خود سرور FAM (`10.16.243.18`) مستقیماً با SSH به تجهیز وصل می‌شود. Firewall از سرور FAM به تجهیز باز شده است.

```text
Browser کاربر → HTTPS → FAM روی 10.16.243.18 → ssh.exe (Windows OpenSSH) → TCP/22 تجهیز (مثلاً 10.2.35.2)
```

## چرا ssh.exe و نه Netmiko/Paramiko

تجهیز فقط cipherهای قدیمی CBC ارائه می‌دهد. Windows OpenSSH و PuTTY با `aes128-cbc` وارد می‌شوند، اما Netmiko/Paramiko در این محیط با timeout عمومی SSH مواجه می‌شد. بنابراین `server/equipment_probe.py` به‌جای کتابخانهٔ Python، همان `ssh.exe` سیستم را با گزینهٔ زیر اجرا می‌کند:

```text
-o Ciphers=+aes128-cbc
```

فقط `aes128-cbc` به فهرست پیش‌فرض اضافه می‌شود. `3des-cbc`، `aes192-cbc`، `aes256-cbc` یا wildcard الگوریتم‌های ضعیف هرگز فعال نمی‌شوند. workaround دستی `Transport._preferred_ciphers` در نسخهٔ نهایی وجود ندارد و Netmiko دیگر وابستگی FAM نیست.

## جریان کار

1. کاربر مجاز (نقش ≤ 2 یا مجوز `equipment-operations`) در HTTPS تأییدشدهٔ FAM وارد تب **تجهیزات** می‌شود.
2. IP خصوصی تجهیز (فقط IPv4 RFC1918)، نام کاربری SSH/RADIUS و رمز موقت را وارد و «بررسی وضعیت پورت‌ها» را می‌زند؛ بررسی بلافاصله شروع می‌شود.
3. Backend، helper یک‌بارمصرف `equipment_probe.py` را اجرا می‌کند؛ helper یک جلسهٔ `ssh.exe` باز می‌کند و فقط این دستورهای ثابت را می‌فرستد:
   ```text
   terminal length 0
   show interfaces status
   exit
   ```
4. خروجی جدول Port / Name / Status / Vlan روی سرور parse و دور ریخته می‌شود. فقط پورت‌هایی با Status دقیق `err-disabled` به‌صورت `{interface, description}` برمی‌گردند. `disabled`، `connected`، `notconnect` و … خطا محسوب نمی‌شوند. اگر جدول معتبر دریافت نشود، نتیجه هرگز «پاک» گزارش نمی‌شود و خطای redacted برمی‌گردد.
5. اگر هیچ پورت err-disabled نباشد، UI پیام واضح «وضعیت پاک» نمایش می‌دهد.
6. برای رفع، کاربر همان Interface را صریحاً تأیید می‌کند و رمز را دوباره وارد می‌کند. helper ابتدا `show interfaces status` را دوباره اجرا می‌کند؛ فقط اگر همان پورت هنوز err-disabled باشد، در یک جلسهٔ جداگانه:
   ```text
   terminal length 0
   configure terminal
   interface <validated-interface>
   shutdown
   no shutdown
   end
   exit
   ```
   و سپس در جلسهٔ سوم دوباره `show interfaces status`. اگر تجهیز دستور config را رد کند (مثلاً سطح دسترسی ناکافی)، `recovery_rejected` برمی‌گردد و چیزی تغییر نمی‌کند.
7. `enable`، command آزاد، `write memory`، `copy running-config` و ذخیرهٔ تنظیمات وجود ندارد.

## حفاظت اطلاعات ورود

- username/password تجهیز فقط در حافظهٔ Browser، درخواست HTTPS، stdin helper و RAM همان child process است.
- رمز هرگز در command-line، URL، SQLite، log معمولی، فایل تنظیمات یا فایل دائمی قرار نمی‌گیرد.
- helper برای هر جلسه یک فایل موقت `askpass.cmd` می‌سازد که **فقط** متغیر محیطی `FAM_EQUIPMENT_SSH_SECRET` را echo می‌کند؛ خود فایل حاوی رمز نیست و در `finally` حذف می‌شود. رمز فقط در environment همان `ssh.exe` قرار می‌گیرد (`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`).
- نام کاربری به مجموعهٔ `[A-Za-z0-9._@\-]` و رمز به ASCII چاپ‌شدنی (۱ تا ۵۱۲ نویسه) محدود است تا هیچ متاکاراکتری به مسیر `cmd.exe`/askpass نرسد.
- رمز تجهیز پس از هر پاسخ سرور از فرم پاک می‌شود. recovery فقط تا پنج دقیقه پس از همان بررسی، برای همان IP، همان username و همان پورت با ticket امضاشدهٔ سرور مجاز است.
- CSRF، Origin، permission، session و محدودیت‌های قبلی تغییری نکرده‌اند.

## Host Key

- `StrictHostKeyChecking=no` استفاده نمی‌شود.
- کلیدهای میزبان در فایل اختصاصی `C:\FAMData\equipment\known_hosts` (فقط کلید عمومی تجهیز) ذخیره می‌شوند.
- سیاست پیش‌فرض `accept-new` است: کلید تجهیز در نخستین اتصال ثبت و هر تغییر بعدی رد می‌شود (`host_key_rejected`). برای الزام به کلید از پیش‌تأییدشده، در `start.ps1` مقدار `FAM_EQUIPMENT_HOST_KEY_POLICY='strict'` بگذارید و کلید را با `ssh-keyscan` یا یک اتصال دستی به همان فایل اضافه کنید.

## زمان‌بندی

- `ConnectTimeout=10` برای TCP/SSH.
- هر جلسهٔ `ssh.exe` حداکثر ۲۵ ثانیه (`SESSION_TIMEOUT`)، کل helper ۳۰ ثانیه برای status و ۸۵ ثانیه برای recovery (`HELPER_DEADLINE`).
- Backend حداکثر ۴۰ / ۹۵ ثانیه برای helper صبر می‌کند (`EXECUTOR_TIMEOUT`) تا هرگز قبل از `ssh.exe` فرزند را نکشد. UI تا ۱۱۰ ثانیه منتظر می‌ماند.

## کدهای خطا

فقط کدهای redacted به Browser می‌رسند: `authentication_failed`، `connection_timeout`، `connection_failed`، `invalid_request`، `host_key_rejected`، `recovery_rejected`، `executor_unavailable`. خروجی CLI خام، Banner، Prompt، نام کاربری، رمز یا جزئیات شبکه هرگز برنمی‌گردد.

## پیش‌نیاز سرور FAM

- «OpenSSH Client» ویندوز (`C:\Windows\System32\OpenSSH\ssh.exe`) نصب باشد و `ssh -Q cipher` شامل `aes128-cbc` باشد؛ نصاب Patch این را پیش از هر تغییر بررسی می‌کند.
- Python، pip یا wheel اضافه‌ای لازم نیست.
