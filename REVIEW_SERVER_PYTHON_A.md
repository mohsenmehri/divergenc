# گزارش بررسی مستقل SERVER — تمرکز Python تجهیزات

شناسهٔ بازبین: **A**  
مرجع بسته: `FAM-SERVER-Current-Python-Review.zip`  
`SOURCE_REVISION.txt`: `b29bd1c8da336798df8b0c36a00fac337206d153` (2026-10-17)  
این بسته export سرور عملیاتی نیست؛ تطبیق با نصب واقعی انجام نشده است.

---

## A. خلاصه و آمادگی

مسیر Python اتصال تجهیزات از نظر مدل تهدید داخلی **جدی و عمدتاً درست طراحی شده**: فرمان ثابت، IP فقط RFC1918+`100.64.0.0/10`، عدم ذخیرهٔ رمز، ASKPASS بدون راز در فایل، host-key خاموش‌نشده، cipher فقط با `Ciphers=+aes128-cbc`، parser محافظه‌کار، ticket وابسته به کاربر/میزبان/نام‌کاربری/اینترفیس، و اعمال scope سمت سرور در call chain واقعی.

آمادگی:

- **برای بررسی وضعیت / show int des روی سوئیچ‌های IOS، پس از smoke test واقعی Windows OpenSSH:** مشروطًا قابل استفاده.
- **برای «رفع پورت» بدون نظارت اپراتور روی قطع ارتباط نیمه‌کاره:** هنوز نه. مسیر کد می‌تواند پس از `shutdown` و قبل از `no shutdown` شکست بخورد و retry داخل برنامه پورت admin-down را برنمی‌گرداند.
- **Windows ssh.exe / csc.exe / IIS ARR / RADIUS / سخت‌افزار:** در این بررسی اثبات نشده (فقط mock).

آسیب‌پذیری Critical از نوع تزریق فرمان، SSRF عمومی، دور زدن scope محدود، یا نشت رمز به DB/argv/URL در مسیر تجهیزات **یافت نشد**. چند ایراد تأییدشدهٔ High/Medium در دسترس‌پذیری، اعمال kind=switch، replay ticket، و backup با role قدیمی وجود دارد.

محدودیت بررسی در بخش E آمده است. هیچ فایلی در بسته تغییر داده نشد و به تجهیزی وصل نشد.

---

## B. گزارش اختصاصی Python تجهیزات

### فایل‌ها و توابع واقعاً خوانده‌شده

| فایل | پوشش |
|---|---|
| `server/equipment_probe.py` | کامل، خط‌به‌خط (حمل‌ونقل، ASKPASS، parser، inspect/recover/execute) |
| `server/equipment_ops.py` | کامل |
| `server/equipment_inventory.py` | کامل |
| `server/app.py` | کامل؛ تمرکز `equipment_allowed`، session/CSRF/Origin، bootstrap، ثبت ops |
| `src/equipment-live-server.js` | کامل |
| `src/equipment-configuration.js` | کامل از نظر مرز اجرا (dry-run) |
| `src/equipment-excel.js`، `src/equipment-inventory.js`، `src/shared-access.js`، `src/shared-sync.js` | خوانده‌شده |
| تست‌های `test_equipment_{probe,ops,inventory}.py` | کامل خوانده سپس اجرا |
| `server/www/web.config`، `windows/start.ps1`، `install.ps1`، بخش عمدهٔ `setup-ertebatat.ps1`، پچ APPLY، `manage.py` | خوانده‌شده |
| `server/private_ui/FAM.html` | فقط جست‌وجو/نمونه‌برداری، نه خط‌به‌خط ۳.۳MB |

پچ `patches/fam-custom-access-server/payload/{app,equipment_*}.py` با سورس `server/` یکسان است (`diff` خالی).

### مسیر اجرای واقعی (مرورگر → SSH)

1. UI (`equipment-live-server.js`) حداکثر ۵ نود را **سریال** به `POST /api/equipment/inspect` می‌فرستد (نه `/check`). Credential فقط در closure RAM است؛ `textContent` برای CLI؛ با logout/pagehide پاک می‌شود.
2. `app.py` `before_request`: Origin دقیق، JSON، نشست HttpOnly، CSRF. سپس `register_equipment_ops`.
3. `authorize()` سپس `authorize(operation, host)` با `equipment_allowed`:
   - ops خاموش → 404
   - نیاز به `equipment-operations`/`manage-users` **و** `equipment-scan` یا `equipment-repair`
   - اگر هر پنج scope برابر `*` نباشد: host باید دقیقاً یک نود در `view(user, inventory)` باشد؛ در غیر این صورت 403 **قبل از executor**
4. `_input()`: فقط فیلدهای مشخص، IPv4 در چهار شبکهٔ مجاز، username allowlist، password printable ASCII.
5. `_execute`: `python.exe equipment_probe.py` با JSON روی stdin؛ رمز در argv/env والد helper نیست؛ timeout هماهنگ (inspect 65 > 55، recover 95 > 85).
6. Helper: `ssh.exe -F NUL -T -p 22` + گزینه‌های ثابت، `-l username host`، stdin فرمان‌های ثابت. رمز فقط در env فرزند `FAM_EQUIPMENT_SSH_SECRET` + ASKPASS.
7. Recover: ticket HMAC ۵ دقیقه → pre-check جدول کامل → فقط اگر همان اینترفیس err-disabled است `configure terminal` / `interface X` / `shutdown` / `no shutdown` / `end` → post-check همان جدول/پورت. موفقیت = وضعیت پورت، نه exit code.

### نقاط درست (با شواهد call chain)

- **Scope محدود با IP دستی API:** تست موجود + اسکریپت اضافه: میزبان خارج از منطقه 403 و `calls==[]`. کاربر `*` می‌تواند IP خصوصی خارج از موجودی بزند؛ این در UI و مستند عمدی است، نه دور زدن حساب محدود.
- **تفکیک scan/repair:** `onlyscan` نمی‌تواند recover کند (403). `onlyfix` نمی‌تواند check/inspect/descriptions کند. ticket کاربر دیگر 409 است و به SSH نمی‌رسد.
- **Injection:** host به `str(IPv4Address)` کاننیکال می‌شود؛ username `-oProxyCommand` رد می‌شود؛ interface `;`/`space` با regex رد می‌شود؛ فرمان آزاد/enable/write در argv و stdin نیست. ویرایشگر آفلاین فقط dry-run است و endpoint اجرا ندارد.
- **رنج IP:** `100.64.0.0/10` پذیرفته؛ `100.1.1.22` و `100.128.0.0` و عمومی رد. در probe، ops، inventory و تست‌ها یکسان.
- **رمز:** در تست mock در argv/ASKPASS source/DB/JSON پاسخ نیست. در env کوتاه‌عمر `ssh.exe` هست (مدل تهدید پردازش، نه فایل دائمی).
- **Host key:** `StrictHostKeyChecking=no` در سورس نیست؛ `accept-new`/`yes`؛ سیاست ناشناخته fail-closed. `CheckHostIP=no` با اتصال بر اساس IP منطقی است.
- **Cipher:** دقیقاً یک `-o Ciphers=+aes128-cbc`؛ 3des/aes192/aes256 در ثابت نیست. این **افزودن** به پیش‌فرض OpenSSH است نه محدود کردن کل لیست به CBC.
- **Parser:** `disabled`/`notconnect`/`connected` و نام حاوی «err-disabled» به‌عنوان err-disabled گزارش نمی‌شوند. جدول خالی، `--More--`، CLI `% ...`، ردیف تکراری/پارس‌نشدهٔ حاوی err-disabled → `status_unreadable` نه clean.
- **تأیید پورت:** ticket به `user_id` + host + sha256(username) + interface + expiry. تغییر host در recover → 409. رمز تازه در recover به SSH می‌رود. پیش از write وجود پورت و err-disabled دوباره چک می‌شود.
- **show int des:** فقط جدول پس از header؛ بنر/prompt حذف؛ راز در description ردکت؛ API دوباره `descriptions_table` را اعمال می‌کند؛ UI با `textContent`.
- **پیام recovered:** «دیگر Err-disabled نیست»؛ علت ریشه‌ای BPDU/Port-Security ادعا نمی‌شود. `still_errdisabled` جدا است.

### اشکالات مسیر تجهیزات (جزئیات در جدول C)

تأییدشده از کد + تست ایزوله:

1. قطع ارتباط بین `shutdown` و `no shutdown` → خطای کلی؛ retry بعدی اگر پورت `disabled` باشد `not_errdisabled` می‌دهد و `no shutdown` نمی‌فرستد.
2. API kind=switch را enforce نمی‌کند؛ روتر داخل scope با فراخوانی مستقیم check می‌شود (200 در تست اضافه).
3. Ticket یک‌بارمصرف نیست؛ همان ticket تا ۵ دقیقه دوباره recover را از لایهٔ API قبول می‌کند.
4. سقف سریال/قفل per-host در سرور نیست (Waitress `threads=16`).
5. UI فقط `inspect` می‌زند؛ نبودن header توضیحات کل بررسی پورت را 502 می‌کند.

نیازمند Windows/تجهیز:

- ASKPASS (`csc.exe`، `SSH_ASKPASS_REQUIRE` روی OpenSSH قدیمی، `DETACHED_PROCESS` و یتیم ماندن `ssh.exe` اگر helper از بیرون کشته شود)
- مذاکرهٔ واقعی cipher با Catalyst فقط-CBC
- اولین اتصال `accept-new` در برابر MITM
- timeout ARR در برابر 110s مرورگر
- خروجی واقعی جدول IOS با wrapping/صفحه‌بندی پس از `terminal length 0`

---

## C. جدول یافته‌ها

| ID | بخش | شدت | اطمینان | وضعیت | فایل و خط/تابع | شواهد و شرایط | اثر | اصلاح حداقلی | تست regression امن |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Recover / دسترس‌پذیری | High | بالا | تأییدشده (مسیر کد؛ گیر کردن واقعی پورت نیازمند تجهیز) | `equipment_probe.py` `_recover` ~541–554؛ `recovery_commands` 525–529؛ UI `repair()` | فرمان‌ها پشت‌سرهم `shutdown` سپس `no shutdown`. اگر `session_output` در جلسهٔ config timeout/قطع شود، post-check نیست و خطا `connection_timeout`/`connection_failed` است. retry: pre-check اگر پورت `disabled` باشد `not_errdisabled` برمی‌گردد و config نمی‌فرستد. | پورت ممکن است admin-down بماند؛ برنامه راه `no shutdown` ندارد؛ اپراتور ممکن است پیام «تغییری اعمال نشد» را با سلامت اشتباه بگیرد. | خطای جلسهٔ config را `recovery_uncertain` کنید (نه recovered/not_errdisabled). در UI صریحاً بگویید وضعیت running نامشخص است و باید `show int status` دستی/بررسی مجدد شود. retry را روی پورت disabled به bounce تبدیل نکنید مگر با تأیید جدا. Enable/write اضافه نکنید. | mock: قطع پس از stdin حاوی shutdown و قبل از پایان جلسه → API 502 با کد نامشخص؛ recover دوم روی جدول `disabled` نباید recovered بدهد. سپس تست آزمایشگاه: kill ssh بین دو خط. |
| E2 | مجوز مقصد | Medium | بالا | تأییدشده | `app.py` `equipment_allowed` 592–599؛ UI `switches()` فقط `kind==='switch'` | اسکریپت اضافه: نود `type-router` در region-1، کاربر scan با types=`*` و regions=`region-1` → `POST /check` = 200 و executor صدا شد. | حساب دارای scan می‌تواند SSH وضعیت/با ticket+repair حتی bounce روی روتر/غیرسوئیچ داخل محدوده انجام دهد. برای کاربر `*` هر IP خصوصی. | در `equipment_allowed` اگر host در موجودی است، `catalog.types[node.typeId].kind=='switch'` الزامی شود. IP دستی فقط برای پنج-`*` بماند. | تست inventory: روتر in-scope → 403 روی check/inspect/recover/descriptions؛ سوئیچ همان منطقه 200. |
| E3 | Ticket | Medium | بالا | تأییدشده | `equipment_ops.py` `_ticket`/`_verify_ticket` 80–92؛ `equipment_recover` | اسکریپت اضافه: همان ticket دو بار → هر دو 200 `recovered` (executor mock). لایهٔ API nonce/جایگاه یک‌بارمصرف ندارد. Probe در بار دوم اگر دیگر err-disabled نباشد config نمی‌فرستد؛ اگر هنوز باشد دوباره cycle می‌شود. | replay تا 300s؛ دو تب هم‌زمان دو جلسهٔ config روی یک پورت. | jti یک‌بارمصرف در حافظهٔ فرایند (user, host, iface, ticket-hash) تا انقضا؛ قفل per-host. کلید را پایدار کنید (E7). | تست: recover دوم با همان ticket → 409؛ کاربر دیگر 409 (موجود). |
| E4 | همزمانی سرور | Medium | بالا | تأییدشده | `app.py` 847 `threads=16`؛ نبود mutex در ops | UI سریال است؛ دو نشست/تب محدودیتی روی سرور ندارند. | چند SSH هم‌زمان به یک سوئیچ (قفل config IOS) یا فشار روی سرور. | صف سراسری کوچک (مثلاً 1–2 ssh) و قفل per-host. | دو recover موازی mock روی یک host؛ دومی باید 429/صف شود. |
| E5 | Inspect به‌جای status | Medium | بالا | تأییدشده | `inspect_device` 506–523؛ `equipment-live-server.js` `scan()` → `equipment/inspect` | اگر header `Interface Status Protocol Description` نباشد کل inspect با `descriptions_unreadable` fail می‌شود (تست `test_inspect_never_reconnects_on_ambiguous_boundary`). مسیر `/check` جدا وجود دارد اما UI استفاده نمی‌کند. اگر جدول status معتبر و description خراب باشد، `inspect` پورت‌ها را نگه می‌دارد (تست جدا). | سوئیچی که فقط status می‌دهد در UI «نامشخص» است و ticket صادر نمی‌شود. | UI در شکست description به نتیجهٔ status همان پاسخ inspect (در صورت وجود) یا `/check` برگردد؛ header گم = کل کار fail نماند. | دستگاه/fixture بدون جدول des → err-disabled از status نمایش داده شود. |
| E6 | فرآیند SSH ویندوز | Medium | متوسط | نیازمند تست Windows | `equipment_probe.py` `_creation_flags` 341–344؛ `run_ssh` finally 354+؛ `_execute` TimeoutExpired 115–125 | `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`. اگر executor helper را بکشد، `finally` helper اجرا نمی‌شود؛ ssh جداشده ممکن است زنده بماند و بقیهٔ فرمان‌ها را بفرستد. بودجهٔ داخلی معمولاً زودتر kill می‌کند. | فرمان نیمه‌کاره پس از timeout والد؛ فایل ASKPASS باقی. | Job Object / `CREATE_NO_WINDOW` به‌جای detach، و kill درخت فرایند در `_execute`. بعد از آزمون واقعی Windows انتخاب شود. | روی Server 2019: timeout عمدی؛ Process Explorer نشان دهد ssh.exe نماند. |
| E7 | عمر ticket key | Low | بالا | تأییدشده | `app.py` 491؛ `start.ps1` (کلید set نمی‌شود) | هر `create_app` بدون env کلید تصادفی می‌سازد؛ دو نمونه کلید متفاوت. | پس از restart همهٔ ticketها 409 (fail-closed، نسبتاً امن). چند worker = recover تصادفی 409. | کلید را در `settings.json`/محیط سرویس پایدار با ACL خصوصی بگذارید. | restart فرایند → recover با ticket قبلی 409؛ همان فرایند 200. |
| E8 | Host-key اولین تماس | Info | بالا | طراحی مستند | `HOST_KEY_POLICIES` accept-new پیش‌فرض؛ `start.ps1` 22 | MITM در اولین SSH می‌تواند کلید را ثبت کند؛ تغییر بعدی رد می‌شود. | اعتماد اولیه به شبکهٔ مسیر FAM→دستگاه. | برای دارایی حساس `strict` + ثبت قبلی. خاموش کردن check پیشنهاد نمی‌شود. | تعویض کلید دستگاه → `connection_failed` بدون جدول. |
| E9 | ASKPASS/OpenSSH نسخه | Medium | متوسط | نیازمند تست Windows | `prepare_askpass`؛ env `SSH_ASKPASS_REQUIRE=force` و `DISPLAY` | Win32 نیاز به exe دارد؛ کامپایل csc ۵ثانیه. OpenSSH<8.4 ممکن است `REQUIRE` را نشناسد. | شکست اتصال یا hang تا timeout در سرور واقعی. | پیش‌نیاز نسخه در installer (تا حدی هست) + smoke test. | یک check واقعی به سوئیچ آزمایشی. |
| E10 | معنای recovered | Info | بالا | تأییدشده به‌عنوان محدودیت عملیاتی نه باگ ادعا | پیام UI recovered؛ cycle فقط bounce | BPDU Guard دوباره err-disable می‌کند. پیام ادعا نمی‌کند علت رفع شده. | اپراتور ممکن است bounce را علاج بداند. | جملهٔ کوتاه «بازگشت خطا محتمل است اگر علت باقی باشد». | — |

یافته‌های ردشده / غیرآسیب‌پذیری:

- دور زدن region/site با IP دستی برای حساب محدود: **رد** (403، executor صدا نشد).
- تزریق command از host/username/interface در لایه‌های خوانده‌شده: **رد**.
- نشت رمز به SQLite/argv/پاسخ JSON در تست‌ها: **رد**.
- باز بودن 100/8 یا اینترنت: **رد**.
- `StrictHostKeyChecking=no`: در سورس **نیست**.
- Enable/write/copy از helper: **نیست**.
- Ticket کاربر دیگر: 409.

---

## D. سایر بخش‌های SERVER

| ID | بخش | شدت | اطمینان | وضعیت | فایل | شواهد | اثر | اصلاح حداقلی | تست |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Backup/restore | Medium | بالا | تأییدشده | `manage.py:34`؛ `preflight_backup.py:27` | اسکریپت: پس از `UPDATE users SET role=4` با permissions کامل مدیر، `check()` → `No active administrator`. حساب سفارشی جدید role=4 است. | backup روزانه/پیش از نصب روی استقرار fully-custom می‌شکند؛ restore هم همان check را دارد. | شرط را `may_manage_users`/وجود `manage-users` فعال کنید نه `role=1`. | DB فقط با مدیر custom role=4 → backup موفق؛ بدون مدیر → رد. |
| S2 | رمز اولیه | High (عملیاتی) | بالا | تأییدشده / مستند | `app.py:544`؛ `docs/SECURITY_NOTES.md` | Fresh DB: `FAM_INITIAL_PASSWORD` یا `'1109'`. `start.ps1` آن را set نمی‌کند. تست‌ها با admin/1109 وارد می‌شوند. | اگر نصب fresh بدون تغییر رمز در شبکه باشد، ورود پیش‌فرض. | نصب اجباری رمز یکتا؛ حذف fallback فقط با مسیر تحویل امن. | نصب بدون env در lab (اینجا اجرا نشد). |
| S3 | Login lockout | Low | بالا | طراحی مستند | `app.py` login + SECURITY_NOTES | bucket عمدتاً per-username چون `remote_addr` پشت ARR معمولاً 127.0.0.1 است. | DoS روی یک نام کاربری (۱۵ دقیقه). بهتر از اعتماد به XFF جعلی. | تا TRUSTED_PROXY+ARR overwrite کامل نشود XFF اضافه نکنید. | — |
| S4 | IIS/UI عمومی | Info | متوسط | نیازمند تست IIS | `web.config` rewrite `app\|FAM.html` به loopback؛ پچ `www\FAM.html` قدیمی را لازم دارد | اگر URL Rewrite نباشد، HTML کامل ممکن است static شود. تست API: بدون نشست `/FAM.html` ریدایرکت login. | افشای UI (نه DB) در پیکربندی غلط. | پس از پچ، `www\FAM.html` را حذف یا deny کنید. | درخواست IIS به `/FAM.html` بدون کوکی. |
| S5 | Auth جلسه | — | بالا | سالم در تست | cookie HttpOnly, SameSite=Strict, Secure در prod؛ Origin+CSRF؛ PBKDF2 210k؛ تغییر scope تجهیزات نشست را 401 می‌کند | 96 تست شامل csrf/origin/role. | — | — | اجرا شد. |
| S6 | Inventory/Excel | Low | متوسط | محتمل | نام‌ها `=` را رد نمی‌کنند؛ import سلول دارای `cell.f` را رد می‌کند | SheetJS معمولاً رشته را type string می‌نویسد. | تزریق فرمول هنگام باز کردن export در Excel اگر type اشتباه باشد. | پیشوند `'` روی فیلدهای متنی export. | باز کردن export با نام `=cmd\|'/c calc'!A0`. |
| S7 | Config آفلاین | — | بالا | سالم نسبت به سؤال آزاد-CLI | `equipment-configuration.js` صریحاً بدون executor | متن دستور در RAM؛ API SSH ندارد. | ساخت مسیر اجرا روی دستگاه از این صفحه دیده نشد. | — | — |
| S8 | Payload پچ | — | بالا | یکسان با سورس فعلی | diff خالی برای app/probe/ops/inventory | updater هش SHA256 و OpenSSH/csc را قبل از کپی چک می‌کند. | — | — | `test_installer` به‌خاطر نبود artifact لوکال خطا داد (E). |
| S9 | CSP | Info | بالا | تأییدشده | web.config CSP فقط frame-ancestors/object-src/base-uri | XSS به اسکریپت محدود نمی‌شود؛ اتکا به textContent و JSON. | اگر XSS در FAM.html باشد CSP کمکی نمی‌کند. | CSP سخت‌تر نیازمند nonce و کار زیاد روی باندل است. | — |
| S10 | شناسه‌های سازمانی در installer | Info | بالا | مستند غیرناشناس | `setup-ertebatat.ps1` پیش‌فرض hostname/IP | بسته anonymized نیست. | افشای نام محیط در سورس. | پیش‌فرض خنثی. | — |

احراز هویت، revision/idempotency شیت‌ها، عدم last-writer-wins، تراکنش IMMEDIATE، audit، WAL backup API، جدا بودن DB از `www`، و سرو UI از `private_ui` پس از نشست در کد و تست‌های اجراشده سازگار به‌نظر می‌رسند. `restore-data` مرورگر فایل DB را برنمی‌گرداند؛ restore واقعی CLI با `--server-stopped` است.

---

## E. تست‌ها و پوشش خواندن

### اجراشده

```text
cd /tmp/fam-review
python3 -m venv /tmp/fam-venv
/tmp/fam-venv/bin/python -m pip install -r server/requirements.txt
PYTHONPATH=/tmp/fam-review /tmp/fam-venv/bin/python -m unittest \
  server.tests.test_api server.tests.test_equipment_probe \
  server.tests.test_equipment_ops server.tests.test_equipment_inventory \
  server.tests.test_hardening -v
```

نتیجهٔ مستقل این بازبین: **۹۶ تست، OK، ~17s** (Python 3.11.2، Flask از PyPI). بدون شبکه به تجهیز.

اسکریپت اضافه `/tmp/fam-extra-review.py` (DB موقت، executor mock):

- ticket ناقص → 409 (در 3.11.2 `compare_digest` طول متفاوت raise نکرد)
- replay ticket → دو بار 200
- روتر in-scope → check 200
- `manage.check` بدون role=1 → ValueError
- کلید ticket بین دو `create_app` متفاوت
- onlyscan recover 403؛ ticket دزدیده‌شده 409

`diff` پچ با `server/*.py`: یکسان.

### اجرا نشده / ناقص

| مورد | علت |
|---|---|
| SSH واقعی، RADIUS، cipher روی Catalyst، ASKPASS/csc | ممنوع و محیط Linux است |
| installer / IIS / پورت 8765 واقعی | ممنوع |
| `npm test` و تست‌های `tests/*.cjs` | `node_modules` در بسته نیست؛ مرورگر اجرا نشد |
| `test_installer` کامل | ERROR: `patches/fam-custom-access-local/FAM.html` در ZIP نیست (artifact تاریخی) |
| `test_equipment_connector` | `equipment_connector/connector.ps1` در بسته نیست |
| `test_offline_kit` | ۳ OK؛ ۲ skip احتمالی وابسته به wheel (طبق README محدودیت بسته است نه باگ runtime) |
| `test_nava_*` | خارج از مسیر SSH |
| FAM.html باندل ۳.۳MB خط‌به‌خط | فقط grep |
| CSS و بخش‌های غیرتجهیز UI | مرور سطحی |
| ZIPهای دیگر مخزن (Central-IIS، Security-Hardening، XLSM، mq5) | خارج از محدودهٔ این بسته |
| تطبیق hash با سرور عملیاتی | فایل نصب‌شده در دسترس نیست |

نبود artifact تاریخی به‌عنوان باگ runtime ثبت نشد.

---

## F. پنج اصلاح اولویت‌دار (هنوز اعمال نشده)

1. **E1 — نتیجهٔ نامشخص پس از شکست جلسهٔ config**  
   ریسک تغییر: کم روی داده؛ رفتار recover در خطا عوض می‌شود (پیام دقیق‌تر). ممکن است اپراتورهایی که به retry عادت دارند یک کلیک اضافه ببینند. بدون Enable/write.

2. **E2 — الزام kind=switch در `equipment_allowed`**  
   ریسک: حساب‌هایی که عمداً روی روتر scan می‌زنند 403 می‌گیرند. داده عوض نمی‌شود. با UI فعلی هم‌تراز است.

3. **E3+E4 — ticket یک‌بارمصرف + قفل per-host**  
   ریسک: recover موازی/دوباره تا 300s شکست می‌خورد (409). رفتار عمدی‌تر و کمی سخت‌گیرانه‌تر.

4. **S1 — backup با مدیر custom**  
   ریسک: کم؛ backupهایی که امروز روی role=4 می‌شکنند درست می‌شوند. شرط «حداقل یک مدیر فعال» باید بماند.

5. **E6+E7 پس از آزمون Windows — درخت فرایند و کلید پایدار ticket**  
   ریسک: متوسط روی سازگاری OpenSSH (جایگزینی `DETACHED_PROCESS`). کلید پایدار recover بعد از restart را تا 300s ممکن می‌کند (اثر امنیتی محدود اگر فایل کلید ACL درست داشته باشد).

پیشنهادهای صریحاً ممنوع (انجام نشود): خاموش کردن host-key، ذخیرهٔ رمز دستگاه، باز کردن IP عمومی، ضعیف کردن cipher، دور زدن scope، افزودن Enable یا write memory.

---

شناسهٔ بازبین: **A**
