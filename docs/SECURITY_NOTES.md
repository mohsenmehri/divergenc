# یادداشت‌های امنیتی FAM

این سند تصمیم‌های امنیتی فعال و مسیرهای بهبود آینده را ثبت می‌کند تا تغییرهای
مرتبط با production قابل بازبینی باشند.

## پچ hardening فعلی

این انتشار موارد زیر را اعمال می‌کند:

- HSTS یک‌ساله (`max-age=31536000`) برای سایت HTTPS داخلی؛ عمداً
  `includeSubDomains` و `preload` ندارد.
- خطای کنترل‌شده و fail-closed برای ستون‌های JSON آسیب‌دیدهٔ جدول `users`.
- رد صریح نام شیت‌های سیستمی غیرمجاز در ورودی browser. دو شیت
  `SYSTEM_SHEET_CONFIG` و `SYSTEM_KEYS` به‌علت فرادادهٔ persist‌شده و
  `CHANGE_LOG` به‌علت نمایش read-only تاریخچه همچنان سازگار هستند؛ لاگ از
  ورودی پاک می‌شود و هرگز از client persist نمی‌گردد.
- allowlist صریح فایل‌های deployment به‌جای copy کردن wildcard همهٔ `*.py`.
- یکسان‌سازی اولویت Python ماشین: `3.14 → 3.13 → 3.12`.

## Rate limiting پشت IIS/ARR

bucket فعلی login از username و `request.remote_addr` ساخته می‌شود. چون backend
پشت IIS/ARR فقط روی loopback شنود می‌کند، در استقرار استاندارد مقدار IP نزد
Flask معمولاً `127.0.0.1` است. بنابراین محدودسازی فعلی عمداً **per-username
سراسری** است، نه per-client-IP.

این رفتار جلوی تلاش نامحدود روی یک username را می‌گیرد، اما یک کاربر داخلی
می‌تواند با ۱۰ تلاش ناموفق ورود همان username را برای ۱۵ دقیقه محدود کند.

`X-Forwarded-For` در backend خوانده نمی‌شود. اضافه کردن آن بدون آزمون واقعی
ARR خطرناک است، چون header قابل جعل است. برای تبدیل این مدل به IP-aware باید
همهٔ این مراحل تکمیل شوند:

1. IIS/ARR header ارسالی کاربر را پیش از proxy پاک یا با IP واقعی overwrite کند.
2. backend فقط در یک تنظیم صریح `TRUSTED_PROXY` و تنها از proxy loopback آن
   header را بپذیرد.
3. آزمون IIS واقعی ثابت کند header جعل‌شده روی bucket اثر ندارد.
4. regression test رفتار trusted/untrusted را پوشش دهد.

تا آن زمان، مدل per-username سراسری از اعتماد نادرست به header ناامن بهتر است.

## PBKDF2

رمزها با `PBKDF2-HMAC-SHA256` و ۲۱۰٬۰۰۰ iteration ذخیره می‌شوند. این مقدار
برای انتشار فعلی حفظ شده تا migration ناگهانی و فشار نامشخص CPU روی Windows
Server ایجاد نشود.

راهنماهای جدیدتر معمولاً iteration بالاتری برای PBKDF2-SHA256 پیشنهاد می‌کنند.
هر افزایش باید migration کنترل‌شده داشته باشد:

1. ستون additive مانند `kdf_iter` اضافه شود.
2. رمز قدیمی با iteration ثبت‌شده تأیید شود.
3. هنگام login موفق، hash با target benchmark‌شدهٔ سرور دوباره ساخته شود.
4. پیش از فعال‌سازی، latency و CPU روی Windows Server واقعی اندازه‌گیری شود.

## رمز اولیه در نصب fresh

`FAM_INITIAL_PASSWORD` باید در نصب production صریحاً تعیین شود. fallback فعلی
فقط برای سازگاری نصب‌های موجود باقی مانده است؛ عملیات نصب باید بلافاصله رمز
مدیر را به مقدار منحصر‌به‌فرد سازمان تغییر دهد. حذف fallback یا تولید رمز اولیه
تصادفی نیازمند تغییر کنترل‌شدهٔ installer و روش امن تحویل رمز به Administrator
است.

## Equipment Management (direct ssh.exe)

- Equipment checks run on the FAM server itself via `server/equipment_probe.py`, which spawns the Windows OpenSSH client (`ssh.exe`). Netmiko/Paramiko and the `Transport._preferred_ciphers` workaround are gone.
- Only one legacy cipher is appended for the Catalyst switches that offer CBC only: `-o Ciphers=+aes128-cbc`. `3des-cbc`, `aes192-cbc`, `aes256-cbc` and wildcards are never offered; `scripts/package_custom_access_updates.py` refuses to package a payload that enables them or sets `StrictHostKeyChecking=no`.
- The device password is never in argv, files, SQLite, URLs or logs. It is placed only in the `ssh.exe` child environment (`FAM_EQUIPMENT_SSH_SECRET`); the per-session secret-free C# source is compiled with the in-box .NET Framework compiler to `askpass.exe`. Both files are deleted in `finally`. Win32 OpenSSH requires an executable ASKPASS helper, not a CMD script. Compilation is bounded at 5 seconds within the session deadline and runs without the device password in its environment. Usernames are restricted to `[A-Za-z0-9._@\-]` and passwords to printable ASCII and no command shell is used.
- Host keys are verified against `C:\FAMData\equipment\known_hosts` with `StrictHostKeyChecking=accept-new` (first contact recorded, later change refused with `connection_failed`); `FAM_EQUIPMENT_HOST_KEY_POLICY=strict` requires pre-trusted keys.
- Timeouts are layered: `ConnectTimeout=10`, 25 s per ssh session, 30/30/85 s helper deadline (status/descriptions/recovery), 40/40/95 s backend executor timeout, 110 s browser wait — the parent never kills the helper before it has killed its own `ssh.exe`.
- ASKPASS refuses prompts other than password prompts. Device host-key changes, runtime setup failures and configuration-command errors map to `connection_failed`; only the four requested public error codes are used. Legacy connector broker and endpoints are removed from this build.

## Manual IP and fixed description read (2026-10-17)

The user explicitly requested `show int des` in the UI. This adds only the fixed read-only sequence `terminal length 0`, `show interfaces description`, `exit`; it is not a terminal/freeform CLI capability. `/api/equipment/descriptions` requires equipment-scan plus the current equipment entry permission, valid session/Origin/CSRF and the same target scope check as status. Scoped users must target a permitted inventory IP; five-wildcard users may enter a private IP manually. No arbitrary command or interface argument is accepted by this read endpoint.

Only a complete bounded interface-description table crosses the API, not raw session output: banners/prompts/SSH diagnostics are discarded; malformed, paginated, control-bearing, oversized and unknown output fails closed. Credential-bearing or secret-like description fields are redacted. The API validates/redacts again even if the child claims success. Whitespace/newlines in the resulting table are preserved in a textContent-backed monospace pre; device content never becomes HTML. The table and manual targets remain document RAM only, cleared with FAM identity/logout/refresh and invalidated with edited credentials/targets. Descriptor-read failure does not turn a failed port scan into a clean result, nor grant a recovery ticket.

## Request-scoped SSH optimization

The new inspect read performs the existing two allowlisted read commands in one supervised SSH child, not two authenticated sessions. It neither accepts commands from a caller nor retries authentication automatically. Recovery still performs verified pre-check, bounded port action and verified post-check; only the secret-free ASKPASS executable is reused within the same request. Deadline starts before its compilation, and request-owned cleanup runs in finally. There is no cross-user helper/credential/SSH-session cache. Inspection timing fields contain only validated nonnegative bounded integers; no debug CLI, device output or secret is logged for profiling.

## Equipment workspace v2

The replacement UI preserves existing server authorization/storage and native SSH boundaries. Inventory and offline tools no longer ask for device credentials. Only the direct server port page accepts SSH/RADIUS credentials in document RAM. Opening equipment details never automatically runs SSH. LOCAL no longer has a fake authentication gate or fabricated scan/recovery UI; it explicitly requires SERVER for connection. No database reset, broadened scope, credential persistence or new configuration-execution permission was introduced. See `EQUIPMENT_V2_REDESIGN.md`.
